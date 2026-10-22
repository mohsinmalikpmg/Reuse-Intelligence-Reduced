import { z } from "zod";

export const compositionInput = z.object({
  idempotencyKey: z.string().min(8).max(200),
  sources: z.array(z.object({ solutionId: z.string().min(1).max(150), version: z.string().min(1).max(150) }).strict()).min(2).max(3),
  desiredOutcome: z.string().max(4000).default(""),
  targetGroup: z.string().max(1000).default(""),
  comparisonContext: z.string().max(12000).default(""),
  briefId: z.string().max(200).optional(),
}).strict();
export const compositionPlan = z.object({
  title: z.string().min(1).max(200), goal: z.string().min(1).max(4000), goalInferred: z.boolean(),
  baseSolutionId: z.string(), rationale: z.string(),
  decisions: z.array(z.object({ solutionId: z.string(), disposition: z.enum(["included", "not_suitable", "unnecessary"]), reason: z.string().min(1) })).min(2).max(12),
  flow: z.array(z.object({ sourceSolutionId: z.string(), capabilityId: z.string(), reason: z.string().min(1) })).min(1).max(160),
  overlapDecisions: z.array(z.string()), dependencies: z.array(z.string()),
  integrationGaps: z.array(z.string()), clarifications: z.array(z.string()),
  capabilityGaps:z.array(z.object({id:z.string().min(1).max(100),need:z.string().min(1).max(2000),reason:z.string().min(1).max(3000)}).strict()).max(20).optional(),
  librarySuggestions:z.array(z.object({
    id:z.string().min(1).max(100),sourceSolutionId:z.string(),version:z.string(),
    capabilityIds:z.array(z.string()).min(1).max(20),gapIds:z.array(z.string()).min(1).max(20),reason:z.string().min(1).max(3000),
    compatibility:z.enum(["supported","proposed-adapter"]).optional(),compatibilityReason:z.string().optional(),
  }).strict()).max(12).optional(),
});
export type CompositionPlan = z.infer<typeof compositionPlan>;
export type SourceEvidence = {
  solutionId: string; version: string; name: string; execution: string;
  capabilities: { id: string; [key: string]: unknown }[];
  constraints: unknown; registeredSource?: { id: string; solutionId: string; version: string; sha256: string };
};
export class CompositionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function validatePlan(plan: CompositionPlan, sources: SourceEvidence[]) {
  const ids = sources.map(s => s.solutionId);
  if (new Set(ids).size !== ids.length) throw new CompositionError(422, "Select distinct solutions.");
  if (plan.decisions.length !== ids.length || new Set(plan.decisions.map(d => d.solutionId)).size !== ids.length || plan.decisions.some(d => !ids.includes(d.solutionId)))
    throw new CompositionError(422, "AI must account for every selected source exactly once.");
  if (!ids.includes(plan.baseSolutionId) || !plan.decisions.some(d => d.solutionId === plan.baseSolutionId && d.disposition === "included"))
    throw new CompositionError(422, "The chosen base must be an included selected source.");
  const seen = new Set<string>();
  for (const step of plan.flow) {
    const source = sources.find(s => s.solutionId === step.sourceSolutionId);
    if (!source?.capabilities.some(c => c.id === step.capabilityId) || !plan.decisions.some(d => d.solutionId === step.sourceSolutionId && d.disposition === "included"))
      throw new CompositionError(422, "AI referenced a capability outside an included source catalog.");
    const key = `${step.sourceSolutionId}:${step.capabilityId}`;
    if (seen.has(key)) throw new CompositionError(422, "AI repeated a flow capability.");
    seen.add(key);
  }
  for (const d of plan.decisions) if (d.disposition === "included" && !plan.flow.some(s => s.sourceSolutionId === d.solutionId))
    throw new CompositionError(422, "Each included source must contribute an explicit capability.");
}
export type Change = { path: string; before: unknown; after: unknown; reason: string };
function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>`${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function changesBetween(before: Record<string, any>, after: Record<string, any>, reason: string): Change[] {
  return Object.keys(after).filter(k => canonical(before[k]) !== canonical(after[k]))
    .map(path => ({ path, before: before[path] ?? null, after: after[path], reason }));
}
/** Reverse only touched fields: unrelated manual changes are intentionally retained. */
export function reverseChanges(current: Record<string, any>, changes: Change[]) {
  const next = { ...current };
  for (const change of changes) {
    if (canonical(current[change.path] ?? null) !== canonical(change.after))
      throw new CompositionError(409, `Manual edits conflict with Undo at ${change.path}.`);
    if (change.before === null) delete next[change.path]; else next[change.path] = change.before;
  }
  return next;
}
