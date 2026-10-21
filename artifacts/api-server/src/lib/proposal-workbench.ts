import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Brief, Case, CodeAssessment, LibraryCodePackage } from "@workspace/api-zod";
import { getCapability, getSolution } from "../data/catalog";
import { isExecutable } from "../engine/steps";
import { assessCode } from "./code-assessment";
import { canonicalCapabilityId, defaultModuleStates, freshContext, moduleBlockedReason } from "./configuration";
import { briefsTable, casesTable, createCase, db, toBrief, toCase } from "./store";

export class ProposalWorkbenchError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]));
  return value;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

/** Pure, inspectable plan: only indexed, executable, policy-eligible modules can become active. */
export function deriveWorkbenchPlan(brief: Brief, report: CodeAssessment) {
  if (!brief.confirmed) throw new ProposalWorkbenchError("Confirm the requirements before opening Workbench.", 400);
  const base = report.bestSolutionId ? getSolution(report.bestSolutionId) : undefined;
  if (!base || base.execution !== "live" || base.status === "deprecated") {
    throw new ProposalWorkbenchError("No valid live code-backed base was identified. Revise the brief and reassess before opening Workbench.");
  }
  const indexedBase = report.package.configurations.find(c => c.solutionId === base.id);
  if (!indexedBase) throw new ProposalWorkbenchError("The selected base has no indexed executable configuration.");
  const ctx = freshContext(base);
  const baseIds = new Set(ctx.baseCapabilities.map(c => c.id));
  const baseModuleIds = indexedBase.capabilityIds.map(id => {
    const resolved = ctx.baseCapabilities.find(c => canonicalCapabilityId(c.id) === canonicalCapabilityId(id));
    if (!resolved || !isExecutable(resolved.id)) throw new ProposalWorkbenchError(`The live base no longer supports indexed element ${id}. Refresh the assessment package.`);
    return resolved.id;
  });
  const baseStates = defaultModuleStates(ctx);
  for (const c of ctx.baseCapabilities) if (c.controlType === "optional") baseStates[c.id] = baseModuleIds.includes(c.id);
  const selected = new Set<string>();
  const gaps: { requirementId: string; need: string; missing: string }[] = [];
  const indexed = new Set(report.package.capabilities.map(c => c.capabilityId));
  const resolveId = (id: string) => ctx.baseCapabilities.find(c => canonicalCapabilityId(c.id) === canonicalCapabilityId(id))?.id ?? id;
  const closure = (id: string, group: Set<string>, visiting = new Set<string>()): string | null => {
    id = resolveId(id);
    if (group.has(id)) return null;
    if (visiting.has(id)) return `Dependency cycle at ${id}.`;
    const cap = getCapability(id);
    if (!cap || !isExecutable(id)) return `${cap?.name ?? id} has no available executable module.`;
    if (!indexed.has(id) && !report.package.capabilities.some(c => canonicalCapabilityId(c.capabilityId) === canonicalCapabilityId(id))) {
      return `${cap.name} has no indexed code evidence.`;
    }
    if (!baseIds.has(id) && !ctx.candidateCapabilities.some(c => c.id === id)) return `${cap.name} is not available for ${base.name}.`;
    visiting.add(id);
    for (const dep of cap.dependsOn) {
      const reason = closure(dep, group, visiting);
      if (reason) return `${cap.name}: ${reason}`;
    }
    visiting.delete(id);
    group.add(id);
    return null;
  };
  const eligible = (group: Set<string>): string | null => {
    const on = [...new Set([...selected, ...group])];
    for (const id of group) {
      const cap = getCapability(id)!;
      if (!baseIds.has(id)) {
        const blocked = moduleBlockedReason(cap, ctx, on, baseStates);
        if (blocked) return blocked;
      }
      const conflict = on.find(other => other !== id && (cap.incompatibleWith.includes(other) || getCapability(other)?.incompatibleWith.includes(id)));
      if (conflict) return `${cap.name} conflicts with ${getCapability(conflict)?.name ?? conflict}.`;
    }
    return null;
  };
  // Seed configuration and its dependency closure must be executable before any case is persisted.
  const seed = new Set<string>();
  for (const id of baseModuleIds) {
    const reason = closure(id, seed);
    if (reason) throw new ProposalWorkbenchError(`The assessed base cannot run: ${reason}`);
  }
  const seedReason = eligible(seed);
  if (seedReason) throw new ProposalWorkbenchError(`The assessed base cannot run: ${seedReason}`);
  seed.forEach(id => selected.add(id));
  for (const requirement of report.requirements) {
    if (requirement.status === "constraint") continue;
    const reasons: string[] = [];
    if (requirement.status === "partial" || requirement.status === "missing") reasons.push(requirement.note);
    // Each match is considered, not just the first donor. A failed match never disappears silently.
    for (const match of requirement.matches) {
      const group = new Set<string>();
      const reason = closure(match.capabilityId, group) ?? eligible(group);
      if (reason) reasons.push(`${match.capabilityName}: ${reason}`);
      else group.forEach(id => selected.add(id));
    }
    if (reasons.length) gaps.push({ requirementId: requirement.id, need: requirement.text, missing: [...new Set(reasons)].join(" ") });
  }
  const moduleIds = [...selected].filter(id => !baseIds.has(id)).sort();
  const activeBaseIds = [...new Set([...baseModuleIds, ...[...selected].filter(id => baseIds.has(id))])].sort();
  const fingerprint = hash({ version: 1, brief, report, parentVersion: base.currentVersion, moduleIds, activeBaseIds, gaps });
  return { id: `case-brief-${fingerprint}`, baseSolutionId: base.id, moduleIds, baseModuleIds: activeBaseIds, gaps, fingerprint };
}

/** Brief row lock serializes concurrent clicks and confirmation edits; all setup lives in one insert/transaction. */
export async function createBriefWorkbench(briefId: string, pkg: LibraryCodePackage): Promise<Case> {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`brief-workbench:${briefId}`}, 0))`);
    const [row] = await tx.select().from(briefsTable).where(eq(briefsTable.id, briefId)).for("update");
    if (!row) throw new ProposalWorkbenchError("Brief not found.", 404);
    const brief = toBrief(row);
    if (!brief.confirmed) throw new ProposalWorkbenchError("Confirm the requirements before opening Workbench.", 400);
    const plan = deriveWorkbenchPlan(brief, assessCode(brief, pkg));
    const [existing] = await tx.select().from(casesTable).where(eq(casesTable.id, plan.id));
    if (existing) return toCase(existing);
    const createdAt = new Date().toISOString();
    return createCase({
      id: plan.id, baseSolutionId: plan.baseSolutionId, briefId,
      moduleIds: plan.moduleIds, intent: brief.valueStatement || brief.better,
    }, {
      executor: tx, baseModuleIds: plan.baseModuleIds,
      requirements: brief.requirements.map(r => ({ id: r.id, text: r.text, createdAt })),
      capabilityRequests: plan.gaps.map(gap => ({
        id: `capreq-${hash({ caseId: plan.id, requirementId: gap.requirementId })}`,
        need: gap.need, missing: gap.missing, afterStepId: null, reuseEventId: null, createdAt,
      })),
    });
  });
}
