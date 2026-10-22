import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createDiscoveryComposition, materializeDiscoveryComposition,
  type DiscoveryCapabilityReference, type DiscoveryRequirementCoverage, type DiscoveryRequirementCoverageStatus, type DiscoveryRequirementSnapshot,
} from "@workspace/api-client-react";
import { compKeys, compositionHref, evidenceOf, type Composition } from "@/lib/composition";

export type CapRef = DiscoveryCapabilityReference;
export type CoverageStatus = DiscoveryRequirementCoverageStatus;
export type { DiscoveryRequirementCoverage, DiscoveryRequirementSnapshot };

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
/** Per-brief draft: idempotency keys and exclusions survive refresh, errors and sign-in redirects. */
export type DiscoveryDraft = { createKey: string; compositionId?: string; excluded: CapRef[]; materializeKey: string; materializeFor: string };
const dk = (briefId: string) => `fusebox.discovery.${briefId}`;
export function loadDiscoveryDraft(briefId: string): DiscoveryDraft {
  try { const raw = sessionStorage.getItem(dk(briefId)); if (raw) return { createKey: newKey(), excluded: [], materializeKey: newKey(), materializeFor: "", ...(JSON.parse(raw) as Partial<DiscoveryDraft>) }; } catch { /* unavailable */ }
  return { createKey: newKey(), excluded: [], materializeKey: newKey(), materializeFor: "" };
}
export function saveDiscoveryDraft(briefId: string, d: DiscoveryDraft) { try { sessionStorage.setItem(dk(briefId), JSON.stringify(d)); } catch { /* unavailable */ } }
export const capKey = (c: CapRef) => `${c.sourceSolutionId}::${c.capabilityId}`;
export function materializeKeyFor(d: DiscoveryDraft, sig: string): DiscoveryDraft { return d.materializeFor === sig ? d : { ...d, materializeFor: sig, materializeKey: newKey() }; }

export function useDiscoveryComposition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { briefId: string; idempotencyKey: string }) => createDiscoveryComposition(v),
    onSuccess: (c) => qc.setQueryData(compKeys.one(c.id), c),
  });
}
export function useMaterialize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; expectedRevision: number; idempotencyKey: string; excludedCapabilities: CapRef[] }) => materializeDiscoveryComposition(id, body),
    onSuccess: (c) => { qc.setQueryData(compKeys.one(c.id), c); if (c.caseId) void qc.invalidateQueries({ queryKey: compKeys.forCase(c.caseId) }); },
  });
}
export { compositionHref };

/**
 * Review-time preview of the server's coverage with the user's pending exclusions applied.
 * Never upgrades a status: only selected matches that are not excluded can keep coverage; losing all of them reads as user-excluded.
 */
export function previewCoverage(rows: DiscoveryRequirementCoverage[], excluded: CapRef[], composition?: Composition): DiscoveryRequirementCoverage[] {
  if (!excluded.length) return rows;
  const ex = new Set(excluded.map(capKey));
  return rows.map((r) => {
    const live = r.matches.filter((m) => m.selected && !ex.has(capKey(m)));
    if (!r.matches.length) return r;
    const active = new Set(composition?.plan.flow.filter(f => !ex.has(capKey(f))).map(f => f.capabilityId) ?? []);
    const compatible = live.filter(m => {
      if (!composition) return true;
      const cap = evidenceOf(composition).find(s => s.solutionId === m.sourceSolutionId)?.capabilities.find(c => c.id === m.capabilityId);
      return !((cap?.dependsOn ?? []) as string[]).some(id => !active.has(id)) &&
        !((cap?.incompatibleWith ?? []) as string[]).some(id => active.has(id));
    });
    const status: CoverageStatus = live.length === 0 ? "user-excluded" : compatible.length === 0 ? "no-compatible-match" :
      r.status !== "proposed" && r.status !== "partial" ? r.status :
      compatible.length < r.matches.length || r.status === "partial" || compatible.some(m => m.coverage === "partial") ? "partial" : "proposed";
    return { ...r, status, matches: r.matches.map((m) => (ex.has(capKey(m)) ? { ...m, selected: false } : m)) };
  });
}

export const COVERAGE: Record<CoverageStatus, { l: string; tone: "green" | "sky" | "sienna" | "muted" | "slate" }> = {
  proposed: { l: "Proposed coverage", tone: "sky" },
  partial: { l: "Partial", tone: "sienna" },
  "no-match": { l: "No match", tone: "sienna" },
  "no-compatible-match": { l: "No compatible match", tone: "sienna" },
  "user-excluded": { l: "You excluded", tone: "muted" },
};
export const EVIDENCE_LEVEL: Record<string, string> = { documented: "Documented", "code-inspected": "Code inspected", executed: "Executed" };
export type { Composition };
