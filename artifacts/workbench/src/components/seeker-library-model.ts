import type { ApprovedConfiguration, Capability, FamilyCapability, Solution, SolutionFamily } from "@workspace/api-client-react";

export type Role = "preferred" | "alternative" | "consolidating" | "module";
export const ROLE_LABEL: Record<Role, string> = {
  preferred: "Preferred",
  alternative: "Alternative",
  consolidating: "Being consolidated",
  module: "Standalone",
};

const KIND_LABEL: Record<Solution["kind"], string> = {
  complete_solution: "Standalone solution",
  configurable_product: "Standalone configurable product",
  capability_module: "Standalone module",
  prototype: "Standalone prototype",
};
export const roleLabel = (e: Pick<Entry, "role" | "s">) => (e.role === "module" ? KIND_LABEL[e.s.kind] : ROLE_LABEL[e.role]);

export type Entry = {
  key: string;
  s: Solution;
  role: Role;
  problemId: string | null;
  problem: string;
  caps: Capability[];
  configs: ApprovedConfiguration[];
  reusable: FamilyCapability[];
  text: string;
};

export type Readiness = "live" | "preview";
export const readinessOf = (s: Solution): Readiness => (s.execution === "live" ? "live" : "preview");

/** Recorded evidence label only. Never derived from baseline metrics. */
export const EVIDENCE_LABEL: Record<Solution["evidenceLevel"], string> = {
  strong: "Strong recorded evidence",
  moderate: "Moderate recorded evidence",
  limited: "Limited recorded evidence",
  none: "No recorded evidence",
};

export const orUnknown = (v: string | null | undefined) => (v && v.trim() && v !== "Unassigned" ? v : "Unknown");

/** Mirrors server productionCapabilities / productionModuleOn; overrides do not add catalogue membership. */
export function effectiveCapIds(s: Solution, capabilities: Capability[]): string[] {
  const byId = new Map(capabilities.map((c) => [c.id, c]));
  return s.capabilityIds.filter((id) => {
    const c = byId.get(id);
    if (!c) return false;
    if (c.controlType !== "optional") return true;
    return s.production?.moduleStates[id] ?? (c.evidenceLevel === "strong" || c.evidenceLevel === "moderate");
  });
}

/** Discovery includes covered capabilities and recorded reuse opportunities, never conflating the two. */
export function capabilityMatch(e: Entry, id: string): "Covered" | "Available to add" | "Reuse option · not addable yet" | null {
  if (e.caps.some((c) => c.id === id)) return "Covered";
  const opportunity = e.reusable.find((r) => r.capability.id === id);
  if (!opportunity) return null;
  return opportunity.tryIn?.solutionId === e.s.id ? "Available to add" : "Reuse option · not addable yet";
}

export function buildEntries(families: SolutionFamily[], solutions: Solution[], capabilities: Capability[]): Entry[] {
  const capById = new Map(capabilities.map((c) => [c.id, c]));
  const resolve = (ids: string[]) => ids.map((id) => capById.get(id)).filter((c): c is Capability => !!c);
  const out: Entry[] = [];
  const seen = new Set<string>();
  const push = (s: Solution, role: Role, problemId: string | null, problem: string, problemText: string, capIds: string[], configs: ApprovedConfiguration[], reusable: FamilyCapability[]) => {
    const key = `${problemId ?? "none"}:${s.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    seen.add(s.id);
    const caps = resolve(capIds);
    out.push({
      key, s, role, problemId, problem, caps, configs, reusable,
      text: [problem, problemText, s.name, s.outcome, s.description, s.businessFunction, s.outputType, ...caps.map((c) => `${c.name} ${c.description}`), ...reusable.map((r) => `${r.capability.name} ${r.capability.description}`)].join(" ").toLowerCase(),
    });
  };
  for (const f of families) {
    const bp = f.businessProblem;
    push(f.preferred, "preferred", bp.id, bp.title, bp.description, f.covers.map((c) => c.capabilityId), f.approvedConfigurations, f.reusableCapabilities);
    f.alternatives.forEach((s) => push(s, "alternative", bp.id, bp.title, bp.description, effectiveCapIds(s, capabilities), [], []));
    f.consolidating.forEach((s) => push(s, "consolidating", bp.id, bp.title, bp.description, effectiveCapIds(s, capabilities), [], []));
  }
  for (const s of solutions) {
    if (seen.has(s.id)) continue;
    push(s, "module", null, "Not in a problem family", "", effectiveCapIds(s, capabilities), [], []);
  }
  return out;
}
