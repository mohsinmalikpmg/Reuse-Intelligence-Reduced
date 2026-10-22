import assert from "node:assert/strict";
import { fixtureAssessCode as assessCode } from "./assessment-fixture";
import manifest from "../src/data/solution-code-manifest.json";
import type { Brief, LibraryCodePackage } from "@workspace/api-zod";
import { acceptancePlan, runAcceptance, verifyAcceptanceEngine } from "../src/lib/acceptance-checks";

const { objectPath: _privatePath, ...pkg } = manifest;
function brief(requirements: string[], context = "Maintenance supervisors reviewing equipment work-order notes"): Brief {
  const empty = { value: "", confidence: 0 };
  return {
    id: "fixture", rawText: context,
    fields: { user: empty, job: empty, currentProcess: empty, painPoint: empty, desiredOutcome: empty, constraints: empty, data: empty, requiredControls: empty, successMeasures: empty },
    today: context, better: "", requirements: requirements.map((text, i) => ({ id: `r${i}`, text, source: "added" })),
    source: "ai", confirmed: true, createdAt: new Date(0).toISOString(), clarifyingQuestion: null, clarification: null, valueStatement: "",
  };
}
const input = brief([
  "Summarize maintenance notes",
  "Identify recurring equipment issues",
  "Provide a supervisor review queue",
  "Cluster similar equipment issues across sites",
  "Highlight safety hazards",
  "Predictive machine learning for failures",
]);
const report = await assessCode(input, pkg as LibraryCodePackage);
assert.equal(report.bestSolutionId, "sol-workorder-insight");
assert.deepEqual(report.requirements.map(r => r.priority), [1, 2, 3, 4, 5, 6]);
assert.deepEqual(report.requirements.slice(0, 3).map(r => r.status), ["covered", "covered", "covered"]);
assert.equal(report.requirements[3]?.status, "borrow");
assert.equal(report.requirements[4]?.status, "borrow");
assert.equal(report.requirements[5]?.status, "missing");
assert.equal(new Set(report.requirements.slice(3, 5).flatMap(r => r.matches.map(m => m.solutionId))).size, 2);
assert(report.requirements.filter(r => r.status !== "missing").every(r => r.matches.every(m => m.evidence.file && m.evidence.symbol && m.evidence.lines.length === 2)));
assert.equal((await assessCode(brief(["Provide original work-order links"]), pkg as LibraryCodePackage)).requirements[0]?.status, "partial");
assert.equal((await assessCode(brief(["Require human approval"]), pkg as LibraryCodePackage)).requirements[0]?.status, "partial");
const unrelated = await assessCode(brief(["Summarize invoices"], "Finance teams review invoices"), pkg as LibraryCodePackage);
assert.equal(unrelated.bestSolutionId, null);
assert.equal(unrelated.requirements[0]?.status, "missing");
const absent = await assessCode(brief(["Translate maintenance notes into Japanese"]), pkg as LibraryCodePackage);
assert.equal(absent.bestSolutionId, null);
assert.equal(absent.requirements[0]?.status, "missing");
const controls = await assessCode(brief(["Do not perform automatic updates.", "Support read-only review across two sites."]), pkg as LibraryCodePackage);
assert.deepEqual(controls.requirements.map(r => r.status), ["constraint", "constraint"]);
process.stdout.write("Code assessment checks passed: base selection, ordered coverage, two-donor reuse, gaps, partial claims, unrelated-domain rejection, source evidence.\n");

const plan = acceptancePlan(report);
const engineFingerprint = await verifyAcceptanceEngine(report);
const request = {
  planFingerprint: plan.planFingerprint, borrowedIds: ["cap-clustering", "cap-safety-signals"],
  reviewedCriterionIds: plan.criteria.map(c => c.id), inputMode: "fixture" as const, inputText: "",
};
const combined = runAcceptance(report, request, engineFingerprint);
assert.deepEqual(combined.results.map(r => r.status), ["passed", "passed", "passed", "passed", "passed", "not_testable"]);
assert(combined.trace.some(t => t.stepId === "cap-clustering" && t.status === "ran"));
assert(combined.output.sections.some(s => s.items.some(i => i.kind === "safety")));
assert.equal(combined.packageFingerprint, pkg.sha256);
assert.equal(combined.configurationFingerprint.length, 64);
const repeated = runAcceptance(report, request, engineFingerprint);
assert.equal(combined.configurationFingerprint, repeated.configurationFingerprint);
assert.equal(combined.inputFingerprint, repeated.inputFingerprint);
assert.deepEqual(combined.output, repeated.output);
assert.deepEqual(combined.results, repeated.results);
const baseOnly = runAcceptance(report, { ...request, borrowedIds: [] }, engineFingerprint);
assert.equal(baseOnly.results[3]?.status, "failed");
assert.equal(baseOnly.results[4]?.status, "failed");
assert.notEqual(baseOnly.configurationFingerprint, combined.configurationFingerprint);
const supplied = runAcceptance(report, { ...request, inputMode: "supplied", inputText: "WO-1 | 2026-10-01 | Test Site | P-1 (centrifugal pump) | Routine inspection." }, engineFingerprint);
assert.equal(supplied.inputMode, "supplied");
assert.equal(supplied.results[1]?.status, "failed");
assert.equal(supplied.results[3]?.status, "failed");
assert.equal(supplied.results[4]?.status, "failed");
assert.notEqual(supplied.inputFingerprint, combined.inputFingerprint);
const safetyOnly = runAcceptance(report, {
  ...request, inputMode: "supplied",
  inputText: "WO-SAFETY | 2026-10-01 | Test Site | P-1 (centrifugal pump) | Gas leak detected.",
}, engineFingerprint);
assert.equal(safetyOnly.results[1]?.status, "failed"); // no recurring issue
assert.equal(safetyOnly.results[2]?.status, "passed"); // safety-only item still enters the queue
assert.equal(safetyOnly.results[4]?.status, "passed");
assert(safetyOnly.output.sections.find(s => s.key === "review")?.items.some(item => item.kind === "review" && item.stepId === "cap-safety-signals"));
assert.throws(() => runAcceptance(report, { ...request, reviewedCriterionIds: [] }, engineFingerprint), /Review every/);
assert.throws(() => runAcceptance(report, { ...request, planFingerprint: "old" }, engineFingerprint), /Assessment changed/);
assert.throws(() => runAcceptance(report, { ...request, borrowedIds: ["uploaded-script"] }, engineFingerprint), /Only proposed/);
assert.throws(() => runAcceptance(report, { ...request, inputMode: "supplied", inputText: "" }, engineFingerprint), /Supply/);
assert.throws(() => runAcceptance(report, { ...request, inputMode: "supplied", inputText: "line\n".repeat(501) }, engineFingerprint), /Supply/);
const partialPlan = acceptancePlan(await assessCode(brief(["Require human approval", "Do not summarize maintenance notes", "Provide original work-order links", "No automatic updates", "Don't summarize maintenance notes", "No safety alerts"]), pkg as LibraryCodePackage));
assert(partialPlan.criteria.every(c => !c.testable));
const rankReport = await assessCode(brief(["Summarize maintenance notes", "Provide supervisor review", "Rank issues"]), pkg as LibraryCodePackage);
const rankPlan = acceptancePlan(rankReport);
assert(rankPlan.borrowedOptions.some(o => o.capabilityId === "cap-clustering"));
assert.throws(() => runAcceptance(rankReport, { ...request, planFingerprint: rankPlan.planFingerprint, reviewedCriterionIds: rankPlan.criteria.map(c => c.id), borrowedIds: ["cap-similarity"] }, engineFingerprint), /requires cap-clustering/);
await assert.rejects(() => verifyAcceptanceEngine({ ...report, package: { ...report.package, files: report.package.files.map(f => f.path === "engine/run.ts" ? { ...f, sha256: "changed" } : f) } }), /engine/);
process.stdout.write("Acceptance checks passed: actual fixture and supplied outputs, deterministic fingerprints, unselected failures, untestable constraints, dependencies, input bounds, explicit review, stale plans and package drift rejection.\n");
