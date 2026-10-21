import { useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Check, GitCompare } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetImprovementGroupQueryKey, useGetImprovementGroup, useRecordGroupDecision, type DecisionAction, type ImprovementApproach } from "@workspace/api-client-react";
import { ErrorView, LoadingView, Page, Tag, btn, useUndoToast, StageEyebrow } from "@/components/bits";
import { ACTION_LABEL, caseStatusLabel } from "@/components/wb-pilot";
import { groupSentence } from "@/pages/my-solutions";
import { errMsg, useInvalidateCase } from "@/lib/case";
import { cn } from "@/lib/utils";

const GROUP_BUTTONS: { action: DecisionAction; label: string; needsReason?: boolean }[] = [
  { action: "adopt_approach", label: "Adopt one approach" },
  { action: "merge_approaches", label: "Merge strongest elements", needsReason: true },
  { action: "request_more_evidence", label: "Request more evidence", needsReason: true },
  { action: "keep_local", label: "Keep as local experiments" },
  { action: "decline", label: "Decline", needsReason: true },
];

/** One shared improvement on an owned product: every approach side by side, one decision for all of them. */
export default function ImprovementPage() {
  const { solutionId, key } = useParams<{ solutionId: string; key: string }>();
  const q = useGetImprovementGroup(solutionId, key, { query: { enabled: !!solutionId && !!key, queryKey: getGetImprovementGroupQueryKey(solutionId, key) } });
  const decide = useRecordGroupDecision();
  const qc = useQueryClient();
  const invalidate = useInvalidateCase();
  const say = useUndoToast();
  const [pending, setPending] = useState<DecisionAction | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (q.isLoading) return <LoadingView />;
  if (q.isError || !q.data) return <ErrorView onRetry={() => q.refetch()} message="This improvement could not load." />;
  const d = q.data;
  const g = d.group;
  const go = (action: DecisionAction) => {
    const spec = GROUP_BUTTONS.find((b) => b.action === action)!;
    if ((spec.needsReason && !reason.trim()) || (action === "adopt_approach" && !chosen)) { setPending(action); return; }
    decide.mutate({ solutionId, groupKey: key, data: { action, caseId: action === "adopt_approach" ? (chosen ?? undefined) : undefined, reason: reason.trim() || undefined } }, {
      onSuccess: (next) => {
        qc.setQueryData(getGetImprovementGroupQueryKey(solutionId, key), next);
        for (const e of g.experiments) invalidate(e.case.id);
        setPending(null); setReason(""); setChosen(null);
        say(`${ACTION_LABEL[action]}: recorded for ${g.experiments.length} experiment${g.experiments.length === 1 ? "" : "s"}.`);
      },
      onError: (e) => say(errMsg(e)),
    });
  };
  const last = d.decisions[0];
  return (
    <Page>
      <Link href="/my-solutions" className={cn(btn.quiet, "-ml-3 mb-3")} data-testid="link-back"><ArrowLeft className="h-4 w-4" /> My Solutions</Link>
      <div className="mb-6">
        <StageEyebrow stage="converge" className="mb-3" note={<>Shared improvement to {d.solution.name} v{d.solution.currentVersion}</>} />
        <h1 data-testid="text-headline" className="text-[30px] md:text-[38px]">{g.intent}</h1>
        <p className="mt-3 text-[16px] text-skyink" data-testid="text-group-sentence">{groupSentence(g)}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Counts use votes on the current configuration of each experiment only. Demo experiments are labelled.</p>
      </div>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-[18px] font-semibold"><GitCompare className="h-5 w-5 text-primary" /> Approaches, side by side</h2>
        <div className="grid gap-4 md:grid-cols-2" data-testid="panel-approaches">
          {d.approaches.map((a) => <ApproachCard key={a.fingerprint} a={a} selectable={d.availableActions.includes("adopt_approach")} chosen={chosen} onChoose={setChosen} />)}
        </div>
      </section>

      <section className="card-soft mt-8 p-5" data-testid="panel-group-decision">
        <h2 className="text-[18px] font-semibold">Your decision, for all {g.experiments.length}</h2>
        {d.availableActions.length === 0 ? (
          <p className="mt-2 text-[14px] text-muted-foreground" data-testid="text-no-group-actions">
            {last ? <>Last decision: <span className="font-semibold">{ACTION_LABEL[last.action] ?? last.action.replace(/_/g, " ")}</span> by {last.actor}{last.reason ? ` - "${last.reason}"` : ""}.</> : "Nothing to decide yet: no experiment in this group has been tested and proposed."}
          </p>
        ) : (
          <>
            <p className="mt-1 text-[14px] text-muted-foreground">Adopting one approach keeps the others as local experiments; nothing is declined by that choice.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {GROUP_BUTTONS.filter((b) => d.availableActions.includes(b.action)).map((b) => (
                <button key={b.action} data-testid={`button-group-${b.action}`} disabled={decide.isPending} onClick={() => go(b.action)}
                  className={b.action === "adopt_approach" ? cn(btn.primary, "bg-ok hover:bg-[hsl(70_50%_25%)]") : btn.secondary}>{b.action === "adopt_approach" && <Check className="h-4 w-4" />}{b.label}</button>
              ))}
            </div>
            {pending === "adopt_approach" && !chosen && <p className="reveal mt-2 text-[13.5px] text-siennaink" data-testid="text-choose-approach">Pick the experiment to adopt above, then press Adopt again.</p>}
            {pending && pending !== "adopt_approach" && (
              <div className="reveal mt-3 flex gap-2">
                <input autoFocus data-testid="input-group-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={pending === "decline" ? "Why decline? (required)" : pending === "request_more_evidence" ? "What evidence would settle it? (required)" : "Which elements to keep from each? (required)"} className="h-11 flex-1 rounded-xl border border-input px-3 outline-none focus:border-primary" />
                <button data-testid="button-confirm-group" disabled={!reason.trim() || decide.isPending} onClick={() => go(pending)} className={btn.secondary}>Confirm</button>
              </div>
            )}
          </>
        )}
        {d.decisions.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-border pt-3 text-[13px] text-muted-foreground" data-testid="list-group-decisions">
            {d.decisions.slice(0, 6).map((x) => <li key={x.id}>{new Date(x.createdAt).toLocaleDateString()} · {ACTION_LABEL[x.action] ?? x.action.replace(/_/g, " ")} by {x.actor}{x.reason ? ` - "${x.reason}"` : ""}</li>)}
          </ul>
        )}
      </section>
    </Page>
  );
}

function ApproachCard({ a, selectable, chosen, onChoose }: { a: ImprovementApproach; selectable: boolean; chosen: string | null; onChoose: (id: string) => void }) {
  const v = a.votes;
  const pct = v && v.tests > 0 ? Math.round((v.bPreferred / v.tests) * 100) : null;
  return (
    <article className="card-soft p-5" data-testid={`approach-${a.fingerprint}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[17px] font-semibold text-primary">{a.label}</h3>
        <span className="text-[13px] text-muted-foreground">{a.teams.join(", ")}</span>
      </div>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[14.5px]">{a.changes.length ? a.changes.map((c) => <li key={c}>{c}</li>) : <li>Identical to the parent version</li>}</ul>
      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13.5px]">
        <div className="flex items-baseline gap-1.5"><dd className="text-[18px] font-bold text-primary" data-testid={`text-approach-tests-${a.fingerprint}`}>{v?.tests ?? 0}</dd><dt className="text-muted-foreground">completed tests</dt></div>
        <div className="flex items-baseline gap-1.5"><dd className="text-[18px] font-bold text-primary">{pct === null ? "–" : `${pct}%`}</dd><dt className="text-muted-foreground">preferred modified</dt></div>
        <div className="flex items-baseline gap-1.5"><dd className="text-[18px] font-bold text-primary">{a.inputsTested}</dd><dt className="text-muted-foreground">inputs run</dt></div>
      </dl>
      {v && v.demoVotes > 0 && <p className="mt-1 text-[12px] text-muted-foreground">{v.demoVotes} of these are demo votes.</p>}
      <ul className="mt-3 space-y-1.5">
        {a.experiments.map((e) => {
          const st = caseStatusLabel(e.case);
          return (
            <li key={e.case.id} className={cn("flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[14px]", chosen === e.case.id ? "border-primary bg-secondary" : "border-border")} data-testid={`experiment-${e.case.id}`}>
              {selectable && <input type="radio" name="adopt" aria-label={`Adopt ${e.case.ownerName}'s experiment`} data-testid={`radio-adopt-${e.case.id}`} checked={chosen === e.case.id} onChange={() => onChoose(e.case.id)} className="h-4 w-4 accent-[hsl(var(--primary))]" />}
              <span className="font-medium">{e.case.ownerName}</span>
              <span className="min-w-0 truncate text-[13px] text-muted-foreground">{e.case.ownerTeam}</span>
              <Tag tone={st.tone}>{st.l}</Tag>
              {e.case.demo && <Tag>Demo</Tag>}
              <span className="flex-1" />
              <Link href={`/workbench/${e.case.id}?mode=compare`} data-testid={`link-open-${e.case.id}`} className="text-[13.5px] font-semibold text-primary underline-offset-2 hover:underline">Open</Link>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
