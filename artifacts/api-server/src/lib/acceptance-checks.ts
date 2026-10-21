import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AcceptanceChecks, AcceptanceInput, AcceptanceRun, CodeAssessment, CodeAssessmentMatch } from "@workspace/api-zod";
import { capabilityById, getSolution } from "../data/catalog";
import { executeWorkflow } from "../engine/run";
import { isExecutable } from "../engine/steps";
import { formatWorkOrders, workOrders } from "../engine/workorders";

export const acceptanceHash = (value: string) => createHash("sha256").update(value).digest("hex");
declare const __ACCEPTANCE_ENGINE_FILES__: Record<string, string> | undefined;
const enginePaths = ["engine/run.ts", "engine/steps.ts", "engine/workorders.ts", "engine/types.ts", "data/catalog.ts", "data/catalog-enterprise.ts"];
const aliases: Record<string, string> = { "cap-b-summarize": "cap-summarize", "cap-csv-ingest": "cap-wo-ingest" };
const canonical = (id: string) => aliases[id] ?? id;
// Assertions intentionally describe observable local outputs, not semantic requirement fulfillment.
const assertions: Record<string, { kind: string; text: string }> = {
  "cap-wo-ingest": { kind: "count", text: "Parse at least one work-order record" },
  "cap-summarize": { kind: "summary", text: "Produce at least one issue-summary item with source references" },
  "cap-recurring": { kind: "recurring", text: "Produce at least one recurring concern with two source references" },
  "cap-clustering": { kind: "pattern", text: "Produce at least one exact-class/issue pattern with two source references (not necessarily cross-site)" },
  "cap-safety-signals": { kind: "safety", text: "Produce at least one keyword-based safety-signal item" },
  "cap-review-queue": { kind: "review", text: "Produce at least one in-memory supervisor review item" },
};

export function acceptancePlan(report: CodeAssessment): AcceptanceChecks {
  const baseCapabilityIds = report.package.configurations.find(c => c.solutionId === report.bestSolutionId)?.capabilityIds ?? [];
  const options = new Map<string, CodeAssessmentMatch>();
  for (const requirement of report.requirements) for (const match of requirement.matches) {
    if (!baseCapabilityIds.includes(match.capabilityId)) options.set(match.capabilityId, match);
  }
  // Offer indexed dependencies for explicit selection, including missing seed prerequisites.
  const visited = new Set<string>();
  const addDependencies = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of capabilityById.get(id)?.dependsOn ?? []) {
      if (baseCapabilityIds.some(base => canonical(base) === canonical(dep))) continue;
      const evidence = report.package.capabilities.find(c => c.capabilityId === dep);
      const cap = capabilityById.get(dep);
      if (evidence && cap && isExecutable(dep) && !options.has(dep)) options.set(dep, {
        capabilityId: dep, capabilityName: cap.name, solutionId: evidence.solutionId,
        solutionName: getSolution(evidence.solutionId)?.name ?? evidence.solutionId, evidence,
        integration: `Dependency required by ${capabilityById.get(id)?.name ?? id}. Select explicitly to include it; demo behavior only, not a production integration.`,
      });
      addDependencies(dep);
    }
  };
  [...baseCapabilityIds, ...options.keys()].forEach(addDependencies);
  const criteria = report.requirements.map(r => {
    const ids = [...new Set(r.matches.map(m => m.capabilityId))].sort();
    const prohibited = /\b(no|not|never|without|read.only)\b|\bdon['’]t\b/i.test(r.text);
    const testable = !prohibited && (r.status === "covered" || r.status === "borrow") && ids.length > 0 && ids.every(id => assertions[canonical(id)]);
    return {
      id: r.id, requirement: r.text, capabilityIds: ids, testable,
      assertion: testable ? ids.map(id => assertions[canonical(id)]!.text).join("; ") + ". All named steps must execute without errors." : "Not testable by the supported deterministic demo assertions.",
      reason: testable ? "Checks only these observable outputs on the chosen input, not the full requirement or production readiness." : prohibited ? "This restriction requires separate control verification; output presence cannot prove a prohibition." : r.note,
    };
  });
  const fixtureText = formatWorkOrders(workOrders) + "\nWO-FIXTURE-SAFETY | 2026-10-03 | Plant Ops North | P-104 (centrifugal pump) | Gas leak detected near pump.";
  const planFingerprint = acceptanceHash(JSON.stringify({ version: 2, briefId: report.briefId, package: report.package.sha256, base: report.bestSolutionId, baseCapabilityIds, options: [...options.keys()], criteria }));
  return { planFingerprint, baseSolutionId: report.bestSolutionId, baseCapabilityIds, borrowedOptions: [...options.values()], criteria, fixtureText, runs: [] };
}

export class AcceptanceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Only inspect fixed local files. Never load, import or execute archive contents. Fail closed on drift. */
export async function verifyAcceptanceEngine(report: CodeAssessment): Promise<string> {
  const hashes: string[] = [];
  for (const path of enginePaths) {
    const expected = report.package.files.find(file => file.path === path)?.sha256;
    // Production bundles attest the sources actually compiled, not mutable files on disk.
    if (typeof __ACCEPTANCE_ENGINE_FILES__ !== "undefined") {
      if (!expected || __ACCEPTANCE_ENGINE_FILES__[path] !== expected) throw new AcceptanceError("The compiled engine differs from the indexed package. Rebuild and refresh the package before running acceptance checks.", 409);
      hashes.push(`${path}:${expected}`);
      continue;
    }
    let bytes: Buffer | undefined;
    for (const root of [resolve(process.cwd(), "src"), resolve(process.cwd(), "artifacts/api-server/src")]) {
      try { bytes = await readFile(resolve(root, path)); break; } catch { /* try the workspace launch layout */ }
    }
    if (!expected || !bytes || acceptanceHash(bytes.toString("utf8")) !== expected) {
      throw new AcceptanceError("The running local engine cannot be verified against the indexed package. Refresh the package before running acceptance checks.", 409);
    }
    hashes.push(`${path}:${expected}`);
  }
  return acceptanceHash(hashes.join("\n"));
}

export function runAcceptance(report: CodeAssessment, request: AcceptanceInput, engineFingerprint: string): AcceptanceRun {
  const plan = acceptancePlan(report);
  if (request.planFingerprint !== plan.planFingerprint) throw new AcceptanceError("Assessment changed. Reload and review the current criteria.", 409);
  if (!plan.baseSolutionId) throw new AcceptanceError("No supported code-backed base was identified.");
  const reviewed = new Set(request.reviewedCriterionIds);
  if (reviewed.size !== plan.criteria.length || !plan.criteria.every(c => reviewed.has(c.id))) throw new AcceptanceError("Review every acceptance criterion and untestable limitation before running.");
  const allowed = new Set(plan.borrowedOptions.map(o => o.capabilityId));
  if (request.borrowedIds.some(id => !allowed.has(id))) throw new AcceptanceError("Only proposed indexed borrowed elements can be selected.");
  const ids = [...new Set([...plan.baseCapabilityIds, ...request.borrowedIds])].sort();
  const active = ids.map(id => {
    const cap = capabilityById.get(id);
    if (!cap || !isExecutable(id)) throw new AcceptanceError(`Unsupported engine element: ${id}`);
    return cap;
  });
  for (const cap of active) {
    const missing = cap.dependsOn.filter(dep => !ids.some(id => canonical(id) === canonical(dep)));
    const conflicts = cap.incompatibleWith.filter(id => ids.includes(id));
    if (missing.length || conflicts.length) throw new AcceptanceError(`${cap.name}: ${missing.length ? `requires ${missing.join(", ")}. ` : ""}${conflicts.length ? `conflicts with ${conflicts.join(", ")}.` : ""} No elements were added or removed automatically.`);
  }
  const configValues = Object.fromEntries(active.filter(c => c.defaultOption).map(c => [c.id, c.defaultOption!]));
  const inputText = request.inputMode === "fixture" ? plan.fixtureText : request.inputText;
  if (!inputText.trim() || inputText.length > 50000 || inputText.split("\n").length > 500) throw new AcceptanceError("Supply 1–500 lines of work-order text, up to 50,000 characters.");
  const execution = executeWorkflow(active, configValues, inputText);
  const items = execution.output.sections.flatMap(s => s.items);
  const results: AcceptanceRun["results"] = plan.criteria.map(criterion => {
    if (!criterion.testable) return { criterion, status: "not_testable", detail: criterion.reason };
    const observations = criterion.capabilityIds.map(id => {
      const step = execution.trace.find(t => t.stepId === id);
      const rule = assertions[canonical(id)]!;
      // Queue ownership is on the section: priority safety reviews retain their donor stepId.
      const candidates = canonical(id) === "cap-review-queue"
        ? execution.output.sections.filter(section => section.key === "review" && section.stepId === "cap-review-queue").flatMap(section => section.items)
        : items.filter(item => canonical(item.stepId) === canonical(id));
      const matched = candidates.filter(item => item.kind === rule.kind &&
        (rule.kind !== "recurring" && rule.kind !== "pattern" || item.refs.length >= 2) &&
        (rule.kind !== "summary" || item.refs.length > 0));
      const passed = !!step && step.status === "ran" && (rule.kind === "count" ? step.itemCount > 0 : matched.length > 0);
      return { id, passed, count: rule.kind === "count" ? step?.itemCount ?? 0 : matched.length };
    });
    const passed = !execution.errors.length && observations.every(o => o.passed);
    return { criterion, status: passed ? "passed" : "failed", detail: observations.map(o => `${o.id}: ${o.count} qualifying items${ids.includes(o.id) ? "" : " (not selected)"}`).join("; ") + (execution.errors.length ? "; execution errors recorded" : "") };
  });
  return {
    id: randomUUID(), briefId: report.briefId, createdAt: new Date().toISOString(),
    planFingerprint: plan.planFingerprint, packageId: report.package.packageId, packageFingerprint: report.package.sha256, engineFingerprint,
    configurationFingerprint: acceptanceHash(JSON.stringify({ ids, configValues, engineFingerprint })),
    capabilityIds: ids, configValues, borrowedIds: [...new Set(request.borrowedIds)].sort(),
    inputMode: request.inputMode, inputText, inputFingerprint: acceptanceHash(inputText),
    results, output: execution.output, trace: execution.trace, errors: execution.errors,
  };
}
