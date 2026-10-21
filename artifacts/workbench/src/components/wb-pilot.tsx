import { useState } from "react";
import { Link } from "wouter";
import { Check, Circle, Rocket, Users } from "lucide-react";
import {
  getGetCaseReviewQueryKey, getListTestSessionsQueryKey, useCreateTestSession, useGetCaseReview, useListTestSessions, useRecordCaseDecision, useUpdateCase,
  type CaseStatus, type DecisionAction, type CaseUpdatePilotPercent,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tag, btn, useUndoToast } from "@/components/bits";
import { errMsg, useInvalidateCase, useMe } from "@/lib/case";
import { usePersona } from "@/lib/persona";
import { cn } from "@/lib/utils";

export const STATUS_LABEL: Record<CaseStatus, { l: string; tone: "muted" | "sienna" | "green" | "sky" | "slate" }> = {
  draft: { l: "Draft", tone: "muted" }, tested: { l: "Tested", tone: "sky" }, pilot_proposed: { l: "Pilot proposed", tone: "sienna" },
  approved: { l: "Pilot approved", tone: "green" }, changes_requested: { l: "Changes requested", tone: "sienna" }, deferred: { l: "Deferred", tone: "muted" }, rejected: { l: "Rejected", tone: "muted" },
};

export function PilotButton({ caseId, status, pilotPercent, quiet }: { caseId: string; status: CaseStatus; pilotPercent: number; quiet?: boolean }) {
  const [open, setOpen] = useState(false);
  const review = useGetCaseReview(caseId, { query: { enabled: open, queryKey: getGetCaseReviewQueryKey(caseId) } });
  const upd = useUpdateCase();
  const dec = useRecordCaseDecision();
  const invalidate = useInvalidateCase();
  const say = useUndoToast();
  const [pct, setPct] = useState(pilotPercent);
  const [note, setNote] = useState("");
  if (status !== "tested") return null;
  const plan = review.data?.pilotPlan;
  const submit = async () => {
    try {
      if (pct !== pilotPercent) await upd.mutateAsync({ caseId, data: { pilotPercent: pct as CaseUpdatePilotPercent } });
      await dec.mutateAsync({ caseId, data: { role: "seeker", action: "propose_pilot", reason: note.trim() || undefined } });
      invalidate(caseId); setOpen(false); say("Pilot proposed. The owner decides next.");
    } catch (e) { say(errMsg(e)); }
  };
  return (
    <>
      <button data-testid="button-propose-pilot" onClick={() => setOpen(true)} className={quiet ? btn.secondary : btn.accent}><Rocket className="h-4 w-4" /> Propose limited pilot</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-primary">Propose a limited pilot</DialogTitle><DialogDescription>The owner approves before anyone else sees Version B.</DialogDescription></DialogHeader>
          {!plan ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : (
            <div className="space-y-4 text-[14.5px]">
              <div><div className="eyebrow mb-1">Pilot group</div><div data-testid="text-pilot-group">{plan.eligibleGroup}</div></div>
              <div><div className="eyebrow mb-1.5">Percentage of that group</div>
                <div className="flex gap-2">{[5, 10, 20].map((p) => <button key={p} data-testid={`pilot-pct-${p}`} onClick={() => setPct(p)} className={cn("min-h-10 rounded-lg border px-4 font-semibold", pct === p ? "border-primary bg-primary text-white" : "border-input bg-card text-primary")}>{p}%</button>)}</div>
              </div>
              <div><div className="eyebrow mb-1">Success criteria</div><ul className="list-disc space-y-0.5 pl-5">{plan.successThresholds.map((s) => <li key={s}>{s}</li>)}</ul></div>
              <div><div className="eyebrow mb-1">Rollback trigger</div><div data-testid="text-rollback">{plan.rollbackTrigger}</div></div>
              <input data-testid="input-pilot-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note to the owner" className="h-11 w-full rounded-xl border border-input px-3 outline-none focus:border-primary" />
              <button data-testid="button-submit-pilot" onClick={submit} disabled={upd.isPending || dec.isPending} className={cn(btn.primary, "w-full")}>Send to owner</button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

const ACTION_LABEL: Partial<Record<DecisionAction, string>> = { approve_pilot: "Approve pilot", request_changes: "Request changes", reject: "Reject", defer: "Defer" };

export function OwnerDecision({ caseId }: { caseId: string }) {
  const review = useGetCaseReview(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseReviewQueryKey(caseId) } });
  const dec = useRecordCaseDecision();
  const invalidate = useInvalidateCase();
  const say = useUndoToast();
  const [need, setNeed] = useState<DecisionAction | null>(null);
  const [reason, setReason] = useState("");
  const r = review.data;
  if (!r) return <div className="h-20 animate-pulse rounded-xl bg-muted" />;
  const actions = (r.availableActions.find((a) => a.role === "owner")?.actions ?? []).filter((a) => ACTION_LABEL[a]);
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
        <p className="text-[13.5px] text-muted-foreground" data-testid="text-no-actions">{last ? <>Last decision: <span className="font-semibold">{ACTION_LABEL[last.action] ?? last.action.replace(/_/g, " ")}</span> by {last.actor}{last.reason ? ` - "${last.reason}"` : ""}</> : "Nothing to decide yet. The proposer needs to test and propose a pilot first."}</p>
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
  if (persona?.role === "it") return null;
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
