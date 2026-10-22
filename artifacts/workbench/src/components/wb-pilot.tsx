import { useState } from "react";
import { Link } from "wouter";
import { Check, Circle, FolderPlus, MoreHorizontal, Puzzle, Rocket, Users } from "lucide-react";
import {
  getGetCaseReviewQueryKey, getGetSimilarExperimentsQueryKey, getListTestSessionsQueryKey, useCreateTestSession, useGetCaseReview, useGetSimilarExperiments, useListTestSessions, useRecordCaseDecision, useUpdateCase,
  type Case, type CaseStatus, type DecisionAction, type CaseUpdatePilotPercent, type PromotionState,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SimilarPrompt } from "@/components/wb-similar";
import { Tag, btn, useUndoToast } from "@/components/bits";
import { errMsg, useInvalidateCase, useMe } from "@/lib/case";
import { usePersona } from "@/lib/persona";
import { cn } from "@/lib/utils";

export const STATUS_LABEL: Record<CaseStatus, { l: string; tone: "muted" | "sienna" | "green" | "sky" | "slate" }> = {
  draft: { l: "Draft", tone: "muted" }, tested: { l: "Tested", tone: "sky" }, pilot_proposed: { l: "Proposed", tone: "sienna" },
  approved: { l: "Approved for pilot", tone: "green" }, changes_requested: { l: "Changes requested", tone: "sienna" }, deferred: { l: "Deferred", tone: "muted" }, rejected: { l: "Declined", tone: "muted" },
  folded: { l: "Folded in", tone: "green" },
};

/** Status label for one experiment; a published one names the successor version it became part of. */
export function caseStatusLabel(c: Pick<Case, "status" | "foldedInto">): { l: string; tone: (typeof STATUS_LABEL)[CaseStatus]["tone"] } {
  const base = STATUS_LABEL[c.status];
  return c.status === "folded" && c.foldedInto ? { l: `Folded into ${c.foldedInto}`, tone: base.tone } : base;
}

export const PROMOTION_LABEL: Record<PromotionState, string> = {
  experiment: "Experimental branch — not a new production solution",
  proposed_to_parent: "Proposed as an improvement to the parent product",
  proposed_capability: "Proposed as a reusable capability",
  new_family_requested: "New solution family requested — awaiting the owner",
};

type ProposeKind = "parent" | "capability" | "family";

/**
 * The ways an experiment can leave the workbench. All of them keep it under the parent product; a new solution
 * family is the exception and asks for a reason. When other teams test the same change, the person sees them
 * before sending anything.
 */
export function ProposeActions({ theCase, quiet }: { theCase: Case; quiet?: boolean }) {
  const [kind, setKind] = useState<ProposeKind | null>(null);
  const caseId = theCase.id;
  const review = useGetCaseReview(caseId, { query: { enabled: kind !== null, queryKey: getGetCaseReviewQueryKey(caseId) } });
  const similar = useGetSimilarExperiments(caseId, { query: { enabled: kind !== null, queryKey: getGetSimilarExperimentsQueryKey(caseId) } });
  const upd = useUpdateCase();
  const dec = useRecordCaseDecision();
  const invalidate = useInvalidateCase();
  const say = useUndoToast();
  const [pct, setPct] = useState(theCase.pilotPercent);
  const [note, setNote] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  if (theCase.status !== "tested") return null;
  const parent = theCase.lineage.parentSolutionName;
  const plan = review.data?.pilotPlan;
  const ownerName = review.data?.baseSolution.ownerName ?? "the owner";
  const canCapability = theCase.lineage.added.length > 0;
  const open = (k: ProposeKind) => { setKind(k); setAcknowledged(false); setNote(""); };
  const close = () => setKind(null);
  const send = async (action: DecisionAction, done: string) => {
    try {
      if (action === "propose_pilot" && pct !== theCase.pilotPercent) await upd.mutateAsync({ caseId, data: { pilotPercent: pct as CaseUpdatePilotPercent } });
      await dec.mutateAsync({ caseId, data: { role: theCase.createdByRole === "owner" ? "owner" : "seeker", action, reason: note.trim() || undefined } });
      invalidate(caseId); close(); say(done);
    } catch (e) { say(errMsg(e)); }
  };
  const showSimilar = !!similar.data && similar.data.count > 0 && !acknowledged;
  const mine = { changes: lineageChanges(theCase.lineage), votes: "Your current configuration" };
  const title = kind === "parent" ? `Propose this improvement to ${parent}` : kind === "capability" ? "Propose as reusable capability" : "Request new solution family";
  const sub = kind === "parent"
    ? `${ownerName} reviews it as a change to ${parent} v${theCase.lineage.parentVersion}. A limited pilot is part of the proposal, not a separate step.`
    : kind === "capability"
      ? `${theCase.lineage.added.join(", ")} would be offered to other products as a capability, with ${parent} as the first adopter.`
      : `Most changes belong under the product they improve. Ask for a new family only when ${parent} cannot absorb this change.`;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button data-testid="button-propose-parent" onClick={() => open("parent")} className={quiet ? btn.secondary : btn.accent}><Rocket className="h-4 w-4" /> Propose this improvement to {parent}</button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button data-testid="button-propose-more" className={btn.quiet} aria-label="Other ways to take this forward"><MoreHorizontal className="h-4 w-4" /> More</button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem data-testid="menu-propose-capability" disabled={!canCapability} onSelect={() => open("capability")}>
              <Puzzle className="h-4 w-4" /><span>Propose as reusable capability{!canCapability && <span className="block text-[12px] text-muted-foreground">Add a capability first</span>}</span>
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="menu-request-family" onSelect={() => open("family")}>
              <FolderPlus className="h-4 w-4" /><span>Request new solution family<span className="block text-[12px] text-muted-foreground">Exception; needs a reason</span></span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog open={kind !== null} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-primary" data-testid="text-propose-title">{title}</DialogTitle><DialogDescription>{sub}</DialogDescription></DialogHeader>
          {similar.isLoading || (kind === "parent" && !plan) ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : showSimilar && similar.data ? (
            <SimilarPrompt similar={similar.data} mine={mine} onContinue={() => setAcknowledged(true)} />
          ) : (
            <div className="space-y-4 text-[14.5px]" data-testid={`form-propose-${kind}`}>
              <div className="rounded-xl bg-muted/50 px-3 py-2 text-[13.5px]" data-testid="text-propose-lineage"><span className="font-semibold text-primary">What changes:</span> {theCase.lineage.summary}</div>
              {kind === "parent" && plan && (
                <>
                  <div><div className="eyebrow mb-1">Pilot group</div><div data-testid="text-pilot-group">{plan.eligibleGroup}</div></div>
                  <div><div className="eyebrow mb-1.5">Percentage of that group</div>
                    <div className="flex gap-2">{[5, 10, 20].map((p) => <button key={p} data-testid={`pilot-pct-${p}`} onClick={() => setPct(p)} className={cn("min-h-10 rounded-lg border px-4 font-semibold", pct === p ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-primary")}>{p}%</button>)}</div>
                  </div>
                  <div><div className="eyebrow mb-1">Success criteria</div><ul className="list-disc space-y-0.5 pl-5">{plan.successThresholds.map((s) => <li key={s}>{s}</li>)}</ul></div>
                  <div><div className="eyebrow mb-1">Rollback trigger</div><div data-testid="text-rollback">{plan.rollbackTrigger}</div></div>
                </>
              )}
              <input data-testid="input-propose-note" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={kind === "family" ? `Why ${parent} cannot absorb this change (required)` : `Optional note to ${ownerName}`}
                className="h-11 w-full rounded-xl border border-input px-3 outline-none focus:border-primary" />
              {kind === "parent" && <button data-testid="button-submit-propose" onClick={() => send("propose_pilot", `Proposed to ${parent}. ${ownerName} decides next.`)} disabled={upd.isPending || dec.isPending} className={cn(btn.primary, "w-full")}>Send to {ownerName}</button>}
              {kind === "capability" && <button data-testid="button-submit-propose" onClick={() => send("propose_capability", `Proposed as a reusable capability. ${ownerName} decides next.`)} disabled={dec.isPending} className={cn(btn.primary, "w-full")}>Send to {ownerName}</button>}
              {kind === "family" && <button data-testid="button-submit-propose" onClick={() => send("request_new_family", `New solution family requested. ${ownerName} reviews the reason first.`)} disabled={dec.isPending || !note.trim()} className={cn(btn.secondary, "w-full")}>Request as an exception</button>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function lineageChanges(l: Case["lineage"]): string[] {
  return [...l.added.map((n) => `Adds ${n}`), ...l.removed.map((n) => `Switches off ${n}`), ...l.changedSettings.map((s) => `${s.capabilityName}: ${s.from} → ${s.to}`)];
}

export const ACTION_LABEL: Partial<Record<DecisionAction, string>> = {
  propose_pilot: "Proposed to the parent product", propose_capability: "Proposed as reusable capability", request_new_family: "New solution family requested",
  approve_pilot: "Approve pilot", request_changes: "Request changes", reject: "Decline", defer: "Defer", approve_consolidation: "Consolidation approved", withdraw_consolidation: "Consolidation approval withdrawn",
  adopt_approach: "Approach adopted", merge_approaches: "Merge strongest elements", request_more_evidence: "More evidence requested", keep_local: "Kept as local experiment", decline: "Declined",
};
const OWNER_BUTTONS: DecisionAction[] = ["approve_pilot", "request_changes", "reject", "defer"];

export function OwnerDecision({ caseId }: { caseId: string }) {
  const review = useGetCaseReview(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseReviewQueryKey(caseId) } });
  const dec = useRecordCaseDecision();
  const invalidate = useInvalidateCase();
  const say = useUndoToast();
  const [need, setNeed] = useState<DecisionAction | null>(null);
  const [reason, setReason] = useState("");
  const r = review.data;
  if (!r) return <div className="h-20 animate-pulse rounded-xl bg-muted" />;
  const actions = (r.availableActions.find((a) => a.role === "owner")?.actions ?? []).filter((a) => OWNER_BUTTONS.includes(a));
  const go = (a: DecisionAction) => {
    if ((a === "request_changes" || a === "reject") && !reason.trim()) { setNeed(a); return; }
    dec.mutate({ caseId, data: { role: "owner", action: a, reason: reason.trim() || undefined } }, {
      onSuccess: () => { invalidate(caseId); setNeed(null); setReason(""); say(`${ACTION_LABEL[a]}: recorded.`); },
      onError: (e) => say(errMsg(e)),
    });
  };
  const last = r.decisions[r.decisions.length - 1];
  const met = r.promotionGate.filter((g) => g.met).length;
  return (
    <div className="space-y-3" data-testid="panel-owner-decision">
      <p className="text-[14.5px]">{r.ownerSummary}</p>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        <span>Pilot: {r.pilotPlan.eligibleGroup}, {r.case.pilotPercent}%</span>
        <span>· Rollback if {r.pilotPlan.rollbackTrigger.charAt(0).toLowerCase() + r.pilotPlan.rollbackTrigger.slice(1)}</span>
      </div>
      <details className="group rounded-xl border border-border bg-muted/40 px-3 py-2" data-testid="panel-promotion-gate">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[13.5px] font-semibold text-primary">
          <span>Ready for production? {met} of {r.promotionGate.length} checks met</span>
          <span className="text-[12.5px] font-normal text-muted-foreground group-open:hidden">Show</span>
        </summary>
        <ul className="mt-2 space-y-1.5 text-[13px]">
          {r.promotionGate.map((g) => (
            <li key={g.key} data-testid={`gate-${g.key}`} data-met={g.met} className="flex items-start gap-2">
              {g.met ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-label="Met" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Not yet" />}
              <span><span className={g.met ? "" : "text-siennaink"}>{g.label}</span><span className="text-muted-foreground"> · {g.value}</span></span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-muted-foreground">A pilot can be approved before every check is met; production promotion cannot.</p>
      </details>
      {actions.length === 0 ? (
        <p className="text-[13.5px] text-muted-foreground" data-testid="text-no-actions">{last ? <>Last decision: <span className="font-semibold">{ACTION_LABEL[last.action] ?? last.action.replace(/_/g, " ")}</span> by {last.actor}{last.reason ? ` - "${last.reason}"` : ""}</> : "Nothing to decide yet. The experiment has to be tested and proposed first."}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <button key={a} data-testid={`button-owner-${a}`} disabled={dec.isPending} onClick={() => go(a)}
                className={a === "approve_pilot" ? cn(btn.primary, "bg-ok hover:bg-[hsl(70_50%_25%)]") : btn.secondary}>{a === "approve_pilot" && <Check className="h-4 w-4" />}{ACTION_LABEL[a]}</button>
            ))}
          </div>
          {need && (
            <div className="reveal flex gap-2">
              <input autoFocus data-testid="input-decision-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={need === "reject" ? "Why reject? (required)" : "What should change? (required)"} className="h-11 flex-1 rounded-xl border border-input px-3 outline-none focus:border-primary" />
              <button data-testid="button-confirm-decision" disabled={!reason.trim() || dec.isPending} onClick={() => go(need)} className={btn.secondary}>Confirm</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function InviteTesters({ caseId }: { caseId: string }) {
  const { persona } = usePersona();
  const me = useMe();
  const sessions = useListTestSessions(caseId, { query: { enabled: !!caseId, queryKey: getListTestSessionsQueryKey(caseId) } });
  const create = useCreateTestSession();
  const invalidate = useInvalidateCase();
  const say = useUndoToast();
  if (persona?.role !== "it") return null;
  const latest = sessions.data?.[0];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button data-testid="button-invite-testers" disabled={create.isPending} onClick={() => create.mutate({ caseId, data: { createdBy: me?.name ?? "Owner" } }, {
        onSuccess: (s) => { invalidate(caseId); say("Blind test session created. Share the link."); void s; }, onError: (e) => say(errMsg(e)),
      })} className={btn.secondary}><Users className="h-4 w-4" /> Invite testers</button>
      {latest && <Link href={`/test/${latest.id}`} data-testid="link-test-session" className="text-[14px] font-semibold text-primary underline underline-offset-2">Open blind test ({latest.responseCount} response{latest.responseCount === 1 ? "" : "s"})</Link>}
      {latest && <Tag>{typeof window !== "undefined" ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/test/${latest.id}` : ""}</Tag>}
    </div>
  );
}
