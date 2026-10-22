import { useEffect } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptCompositionSuggestion, analyzeFeatureRedundancy, applyCompositionRefinement, cancelCompositionRefinement, editCompositionPlan, createComposition, getComposition, getGetBriefQueryKey, getGetCompositionQueryKey, getListCompositionsQueryKey,
  listCompositions, previewCompositionRefinement, undoCompositionRefinement, useGetBrief,
  type Composition, type CompositionCreateInput, type CompositionPlan, type CompositionPlanDecisionsItemDisposition, type CompositionRefinement, type CompositionSource,
  type CompositionAcceptedSuggestion, type CompositionCapabilityGap, type CompositionLibrarySuggestion,
  type FeatureEvidence, type FeatureRedundancyGroup, type FeatureRedundancyResult,
} from "@workspace/api-client-react";
import { errMsg, httpStatus } from "@/lib/case";

export type { Composition, CompositionPlan, CompositionSource };
export type RefinementPreview = CompositionRefinement;
export type Disposition = CompositionPlanDecisionsItemDisposition;

const FRIENDLY: Record<number, string> = {
  401: "Sign in to save a combination. Your selection is kept.",
  404: "That combination is not here, or belongs to another account.",
  409: "This plan changed since you loaded it. The latest version is loaded; review and try again.",
  422: "The recommendation referenced something the selected sources cannot provide. Nothing was saved.",
  502: "The recommendation service did not answer. Nothing was saved and your inputs are kept; try again.",
  503: "The recommendation service is not configured or unavailable. Nothing was saved; try again later.",
};
export const compStatus = (e: unknown) => httpStatus(e) ?? 0;
/** Server explanations win for 409/422 (they name the conflict or bad reference); otherwise plain wording. */
export const compMsg = (e: unknown) => {
  const st = compStatus(e);
  if (FRIENDLY[st] && st !== 409 && st !== 422) return FRIENDLY[st];
  const m = errMsg(e);
  return m.startsWith("Something did not") && FRIENDLY[st] ? FRIENDLY[st] : m;
};
const noRetry = (n: number, e: unknown) => ![401, 403, 404].includes(compStatus(e)) && n < 2;

export const compKeys = {
  one: (id: string) => getGetCompositionQueryKey(id),
  forCase: (caseId: string) => getListCompositionsQueryKey({ caseId }),
};

export const useComposition = (id: string) =>
  useQuery({ queryKey: compKeys.one(id), queryFn: () => getComposition(id), enabled: !!id, retry: noRetry });

/** The recommendation linked to an existing case or combined case, if any. Silent when signed out. */
export const useCaseComposition = (caseId: string) =>
  useQuery({
    queryKey: compKeys.forCase(caseId), enabled: !!caseId, retry: false,
    queryFn: async () => { try { return (await listCompositions({ caseId }))[0] ?? null; } catch (e) { if ([401, 404].includes(compStatus(e))) return null; throw e; } },
  });

/** Call after any manual change to a case so the linked recommendation re-reads the saved state. */
export function useRefreshCaseComposition() {
  const qc = useQueryClient();
  return (caseId: string) => void qc.invalidateQueries({ queryKey: compKeys.forCase(caseId) });
}

export const COMPOSE_KEY = ["createComposition"];
/** True while a recommendation is being created: the selection it was built from is locked meanwhile. */
export const useComposing = () => useIsMutating({ mutationKey: COMPOSE_KEY }) > 0;

export function useCreateComposition() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: COMPOSE_KEY,
    mutationFn: (data: CompositionCreateInput) => createComposition(data),
    onSuccess: (c) => qc.setQueryData(compKeys.one(c.id), c),
  });
}

function useSync() {
  const qc = useQueryClient();
  return (c: Composition) => {
    qc.setQueryData(compKeys.one(c.id), c);
    if (c.caseId) {
      const id = c.caseId;
      qc.setQueryData(compKeys.forCase(id), [c]);
      // Apply/undo changed the same saved case the manual controls use: refresh it, never keep a parallel copy.
      const own = JSON.stringify(compKeys.forCase(id));
      void qc.invalidateQueries({ predicate: (q) => { const k = JSON.stringify(q.queryKey); return k.includes(id) && k !== own; } });
    }
  };
}

export const usePreviewRefinement = () => useMutation({
  mutationFn: ({ id, expectedRevision, instruction }: { id: string; expectedRevision: number; instruction: string }) => previewCompositionRefinement(id, { expectedRevision, instruction }),
});
export function useApplyRefinement() {
  const sync = useSync();
  return useMutation({
    mutationFn: ({ id, previewId, expectedRevision }: { id: string; previewId: string; expectedRevision: number }) => applyCompositionRefinement(id, previewId, { expectedRevision }),
    onSuccess: sync,
  });
}
export const useCancelRefinement = () => useMutation({
  mutationFn: ({ id, previewId }: { id: string; previewId: string }) => cancelCompositionRefinement(id, previewId),
});
export function useUndoComposition() {
  const sync = useSync();
  return useMutation({
    mutationFn: ({ id, expectedRevision }: { id: string; expectedRevision: number }) => undoCompositionRefinement(id, { expectedRevision }),
    onSuccess: sync,
  });
}

/** Where a saved composition lives in this app. Proposal-only plans never pretend to be cases. */
/** Every saved combination opens in the workbench: linked cases by their case id, proposals by their cmp_ id. */
/** Creation failures explained without implying the selected sources are incompatible. Inputs are kept by the caller. */
export const createMsg = (e: unknown) => {
  const st = compStatus(e);
  if (st === 422) return "The recommendation could not be grounded in these sources after an automatic repair attempt, so nothing was saved. That is a drafting failure, not a finding that these solutions are incompatible. Your selection and wording are kept; try again, or add a sentence about the outcome you need.";
  return compMsg(e);
};

export const compositionHref = (c: Composition) => `/workbench/${c.caseId && c.caseKind !== "proposal" ? c.caseId : c.id}`;

export type SourceEv = {
  solutionId: string; version: string; name: string; execution: string;
  capabilities: { id: string; name?: string; [key: string]: unknown }[];
  constraints?: unknown;
  registeredSource?: { id: string; solutionId: string; version: string; sha256: string };
};
export const evidenceOf = (c: Composition) => c.sourceEvidence as unknown as SourceEv[];
export const baselineOf = (c: Composition) => c.baseline as unknown as Partial<SourceEv>;

export type { FeatureEvidence, FeatureRedundancyGroup, FeatureRedundancyResult };
export type RedundancyClass = FeatureRedundancyGroup["classification"];
export type RedundancyTarget = { sources: CompositionSource[] } | { compositionId: string } | { caseId: string };

/** Cache key is target plus a client-side scope fingerprint (revision / updatedAt); the scope never goes into the request body. */
export const redundancyKey = (t: RedundancyTarget, scope = "") => ["/api/feature-redundancy", t, scope] as const;
export function useFeatureRedundancy(target: RedundancyTarget, scope = "") {
  const qc = useQueryClient();
  return useMutation({
    // The originating key is captured per call, so a result lands under the scope it was requested for even if the scope moved meanwhile.
    mutationFn: async (force: boolean) => ({ key: redundancyKey(target, scope), r: await analyzeFeatureRedundancy({ ...target, force }) }),
    onSuccess: ({ key, r }) => qc.setQueryData(key, r),
  });
}
export const useSavedRedundancy = (target: RedundancyTarget, scope = "") =>
  useQuery<FeatureRedundancyResult | null>({ queryKey: redundancyKey(target, scope), queryFn: () => null, staleTime: Infinity, enabled: false });

/* ---- Gaps and explicit Library donors ---- */
export type CapabilityGap = CompositionCapabilityGap;
export type LibrarySuggestion = CompositionLibrarySuggestion;
export type AcceptedSuggestion = CompositionAcceptedSuggestion;
export const gapsOf = (c: Composition) => ({ capabilityGaps: c.plan.capabilityGaps ?? [], suggestions: c.plan.librarySuggestions ?? [], accepted: c.acceptedSuggestions ?? [] });
/** One stable key per (composition, suggestion, revision) so a retry after a network failure never duplicates the donor. */
const acceptKeys = new Map<string, string>();
export const acceptKeyFor = (id: string, sid: string, rev: number) => { const k = `${id}:${sid}:${rev}`; if (!acceptKeys.has(k)) acceptKeys.set(k, newKey()); return acceptKeys.get(k)!; };
export function useAcceptSuggestion() {
  const sync = useSync();
  return useMutation({
    mutationFn: ({ id, suggestionId, expectedRevision }: { id: string; suggestionId: string; expectedRevision: number }) =>
      acceptCompositionSuggestion(id, suggestionId, { expectedRevision, idempotencyKey: acceptKeyFor(id, suggestionId, expectedRevision) }),
    onSuccess: sync,
  });
}

/** Manual edit of the same persisted proposal plan. Revision-checked; Undo uses the shared undo route. */
export function useSavePlan() {
  const sync = useSync();
  return useMutation({
    mutationFn: ({ id, expectedRevision, plan }: { id: string; expectedRevision: number; plan: CompositionPlan }) =>
      editCompositionPlan(id, { expectedRevision, plan }),
    onSuccess: sync,
  });
}

/* ---- Selection + inputs that survive sign-in redirects, errors and retries ---- */
const DRAFT_KEY = "fusebox.compose.draft";
export type ComposeDraft = { pickedIds: string[]; pinned: Record<string, string>; desiredOutcome: string; targetGroup: string; idempotencyKey: string; keyFor: string; open: boolean };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
export function loadDraft(): ComposeDraft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) return { pickedIds: [], pinned: {}, desiredOutcome: "", targetGroup: "", idempotencyKey: newKey(), keyFor: "", open: false, ...(JSON.parse(raw) as Partial<ComposeDraft>) };
  } catch { /* storage unavailable */ }
  return { pickedIds: [], pinned: {}, desiredOutcome: "", targetGroup: "", idempotencyKey: newKey(), keyFor: "", open: false };
}
export function saveDraft(d: ComposeDraft) { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* storage unavailable */ } }
/** The same request content keeps the same key, so repeated submissions return the one saved draft. */
export function keyForRequest(d: ComposeDraft, signature: string): ComposeDraft {
  return d.keyFor === signature ? d : { ...d, keyFor: signature, idempotencyKey: newKey() };
}
export function clearAfterSuccess(d: ComposeDraft): ComposeDraft { return { ...d, open: false, desiredOutcome: "", targetGroup: "", keyFor: "", idempotencyKey: newKey() }; }

/* Intake context: only a confirmed intake is reused. Discover remembers it once the loaded brief is confirmed. */
const BRIEF_KEY = "fusebox.confirmedBriefId";
export function storedBriefId(): string | undefined { try { return sessionStorage.getItem(BRIEF_KEY) ?? undefined; } catch { return undefined; } }
export function forgetBrief() { try { sessionStorage.removeItem(BRIEF_KEY); } catch { /* storage unavailable */ } }
export function useRememberConfirmedBrief(briefId: string) {
  const q = useGetBrief(briefId, { query: { enabled: !!briefId, queryKey: getGetBriefQueryKey(briefId) } });
  const confirmed = q.data?.confirmed;
  useEffect(() => {
    if (!briefId || confirmed === undefined) return;
    try {
      if (confirmed) sessionStorage.setItem(BRIEF_KEY, briefId);
      else if (sessionStorage.getItem(BRIEF_KEY) === briefId) sessionStorage.removeItem(BRIEF_KEY);
    } catch { /* storage unavailable */ }
  }, [briefId, confirmed]);
}
/** The remembered intake, re-checked against the server: returned only while it is still confirmed. */
export function useConfirmedIntake() {
  const id = storedBriefId() ?? "";
  const q = useGetBrief(id, { query: { enabled: !!id, queryKey: getGetBriefQueryKey(id), retry: false } });
  return q.data?.confirmed ? q.data : null;
}

export const DISPOSITION: Record<Disposition, { l: string; tone: "green" | "sienna" | "muted" }> = {
  included: { l: "Included", tone: "green" }, not_suitable: { l: "Not suitable", tone: "sienna" }, unnecessary: { l: "Not needed", tone: "muted" },
};
export const loginHref = () => `/api/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`;
