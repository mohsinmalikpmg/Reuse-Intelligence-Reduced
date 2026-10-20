import { Fragment, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Eye, FlaskConical, Minus, Plus, ShieldCheck } from "lucide-react";
import {
  getGetCaseQueryKey,
  getGetCaseReviewQueryKey,
  getGetDecisionQueueQueryKey,
  getGetOwnerOverviewQueryKey,
  getGetPortfolioQueryKey,
  getListCasesQueryKey,
  useGetCaseReview,
  useRecordCaseDecision,
  type DecisionAction,
  type Metrics,
  type VersionSnapshot,
} from "@workspace/api-client-react";
import { CaseBadge, ErrorState, Panel, Rise, Skel, Tag, btnPrimary, btnSecondary } from "@/components/kit";
import { useRole } from "@/lib/persona";
import { actionLabel, date, fmt, pct, recommendation, roleLabel } from "@/lib/labels";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PRIMARY: DecisionAction[] = ["approve_pilot", "approve_consolidation"];

export default function Review() {
  const { caseId = "" } = useParams<{ caseId: string }>();
  const role = useRole();
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetCaseReview(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseReviewQueryKey(caseId) } });
  const decide = useRecordCaseDecision();
  const [pending, setPending] = useState<DecisionAction | null>(null);
  const [reason, setReason] = useState("");

  if (q.isError) return <ErrorState onRetry={() => q.refetch()} message="This review could not load." />;
  if (!q.data) return <div className="space-y-4"><Skel className="h-20 w-2/3" /><div className="grid gap-4 md:grid-cols-2"><Skel className="h-64" /><Skel className="h-64" /></div></div>;
  const r = q.data;
  const actions = r.availableActions.find((a) => a.role === role)?.actions.filter((a) => a !== "approve_simulation") ?? [];
  const needsReason = pending === "reject";

  const submit = (action: DecisionAction) => {
    if (action === "reject" && !reason.trim()) return;
    decide.mutate(
      { caseId, data: { role, action, reason: reason.trim() || undefined } },
      {
        onSuccess: () => {
          [getGetCaseReviewQueryKey(caseId), getGetCaseQueryKey(caseId), getListCasesQueryKey(), getGetDecisionQueueQueryKey(), getGetOwnerOverviewQueryKey(), getGetPortfolioQueryKey()].forEach((k) => qc.invalidateQueries({ queryKey: k }));
          setPending(null);
          setReason("");
          toast({ title: `Decision recorded: ${actionLabel[action]}` });
        },
      },
    );
  };

  const rec = r.experiment ? recommendation[r.experiment.recommendation] : null;

  return (
    <div>
      <Link href={`/cases/${caseId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Workspace</Link>
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <div className="eyebrow mb-1.5">Change review · {r.baseSolution.name}</div>
          <div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold">{r.case.title}</h1><CaseBadge status={r.case.status} /></div>
          <p className="mt-2 text-muted-foreground">{r.ownerSummary}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
            <Snapshot v={r.currentVersion} />
            <div className="hidden items-center md:flex"><ArrowRight className="h-5 w-5 text-primary" /></div>
            <Snapshot v={r.proposedVersion} proposed base={r.currentVersion.performance} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Panel title={`Added (${r.added.length})`} pad={false}>
              <ul className="divide-y">{r.added.map((a) => <li key={a.capability.id} className="flex gap-2.5 px-4 py-2.5"><Plus className="mt-0.5 h-4 w-4 shrink-0 text-ok" /><div><div className="text-sm font-semibold">{a.capability.name}</div><div className="text-xs text-muted-foreground">from {a.sourceSolutionName} · {a.reason}</div></div></li>)}</ul>
              {r.added.length === 0 && <div className="p-4 text-sm text-muted-foreground">Nothing added.</div>}
            </Panel>
            <Panel title={`Removed (${r.removed.length})`} pad={false}>
              <ul className="divide-y">{r.removed.map((a) => <li key={a.capability.id} className="flex gap-2.5 px-4 py-2.5"><Minus className="mt-0.5 h-4 w-4 shrink-0 text-bad" /><div><div className="text-sm font-semibold">{a.capability.name}</div><div className="text-xs text-muted-foreground">{a.reason}</div></div></li>)}</ul>
              {r.removed.length === 0 && <div className="p-4 text-sm text-muted-foreground">Nothing removed.</div>}
            </Panel>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Changed configuration">
              {r.changedConfig.length === 0 ? <div className="text-sm text-muted-foreground">No configuration changes.</div> : (
                <ul className="space-y-1.5 text-sm">{r.changedConfig.map((c) => <li key={c.capabilityName}><span className="font-medium">{c.capabilityName}</span><div className="font-mono text-xs"><span className="text-muted-foreground line-through">{c.from}</span> <ArrowRight className="inline h-3 w-3" /> <span className="text-primary">{c.to}</span></div></li>)}</ul>
              )}
              <div className="eyebrow mb-1.5 mt-4">Unchanged</div>
              <div className="flex flex-wrap gap-1">{r.unchanged.map((u) => <Tag key={u}>{u}</Tag>)}</div>
            </Panel>
            <Panel title="Affected users">
              <ul className="space-y-2 text-sm">{r.affectedUsers.map((g) => <li key={g.group} className="flex items-start justify-between gap-3"><div><div className="font-medium">{g.group}</div><div className="text-xs text-muted-foreground">{g.impact}</div></div><span className="font-mono text-sm">{fmt(g.users)}</span></li>)}</ul>
              {r.newDependencies.length > 0 && <><div className="eyebrow mb-1.5 mt-4">New dependencies</div><div className="flex flex-wrap gap-1">{r.newDependencies.map((d) => <Tag key={d} tone="warn">{d}</Tag>)}</div></>}
            </Panel>
          </div>

          {r.experiment && (
            <Panel title="Simulation result" right={<Link href={`/cases/${caseId}?tab=test`} className="text-xs font-medium text-primary hover:underline">Open test</Link>}>
              <div className="mb-3 flex items-center gap-2 text-xs font-medium text-primary"><FlaskConical className="h-3.5 w-3.5" />{r.experiment.label}</div>
              <div className="grid gap-3 md:grid-cols-4">
                {r.experiment.metrics.filter((m) => m.primary).slice(0, 4).map((m) => (
                  <div key={m.key} className="rounded border px-3 py-2"><div className="eyebrow">{m.label}</div><div className="font-mono text-sm">{m.baseline} <ArrowRight className="inline h-3 w-3" /> <b>{m.proposed}</b> <span className={m.improved ? "text-ok" : "text-bad"}>{pct(m.deltaPct)}</span></div></div>
                ))}
              </div>
              {rec && <div className="mt-3 flex items-center gap-2 text-sm"><Tag tone={rec[1]}>{rec[0]}</Tag><span className="text-muted-foreground">{r.experiment.narrative}</span></div>}
            </Panel>
          )}

          <Panel title="Proposed pilot plan">
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div><div className="eyebrow">Cohort</div><div className="text-sm font-medium">{r.pilotPlan.eligibleGroup}</div></div>
              <div><div className="eyebrow">Exposure</div><div className="font-display text-2xl font-bold text-primary">{r.pilotPlan.pilotPercent}%</div><div className="text-xs text-muted-foreground">{fmt(r.pilotPlan.pilotUsers)} users</div></div>
              <div><div className="eyebrow">Duration</div><div className="font-display text-2xl font-bold">{r.pilotPlan.durationWeeks}w</div></div>
              <div><div className="eyebrow">Approvals</div><div className="mt-1 flex flex-wrap gap-1">{r.pilotPlan.ownerApprovalRequired && <Tag tone="ink">Owner</Tag>}{r.pilotPlan.itApprovalRequired && <Tag tone="ink">IT</Tag>}</div></div>
            </div>
            <div className="grid gap-4 text-sm md:grid-cols-3">
              <List title="Success thresholds" items={r.pilotPlan.successThresholds} />
              <List title="Guardrails" items={r.pilotPlan.guardrails} />
              <List title="Monitoring" items={r.pilotPlan.monitoring} />
            </div>
            <div className="mt-4 rounded border-l-[3px] border-bad bg-bad/5 px-3 py-2 text-sm"><span className="eyebrow mr-2 !text-bad">Rollback trigger</span>{r.pilotPlan.rollbackTrigger}</div>
          </Panel>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <section className="overflow-hidden rounded-md border-2 border-foreground bg-card">
            <header className="flex items-center gap-2 bg-foreground px-4 py-2.5 text-background"><ShieldCheck className="h-4 w-4" /><span className="font-display text-sm font-bold">Your decision</span><span className="ml-auto font-mono text-[10px] uppercase opacity-70">{roleLabel[role]}</span></header>
            <div className="p-4">
              {role === "seeker" ? (
                <div className="flex gap-2 text-sm text-muted-foreground"><Eye className="mt-0.5 h-4 w-4 shrink-0" />Read-only. The solution owner and IT decide from here.</div>
              ) : actions.length === 0 ? (
                <div className="text-sm text-muted-foreground">No decision is waiting on you for this case.</div>
              ) : (
                <div className="space-y-2">
                  {actions.filter((a) => PRIMARY.includes(a)).map((a) => (
                    <button key={a} onClick={() => submit(a)} disabled={decide.isPending} className={cn(btnPrimary, "w-full")} data-testid={`button-decision-${a}`}><Check className="h-4 w-4" />{actionLabel[a]}</button>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    {actions.filter((a) => !PRIMARY.includes(a)).map((a) => (
                      <button key={a} onClick={() => (a === "reject" || a === "request_changes" ? setPending(pending === a ? null : a) : submit(a))} disabled={decide.isPending} className={cn(btnSecondary, "flex-1", pending === a && "border-foreground", a === "reject" && "text-bad")} data-testid={`button-decision-${a}`}>{actionLabel[a]}</button>
                    ))}
                  </div>
                  {pending && (
                    <div className="space-y-2 pt-1">
                      <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={needsReason ? "Reason (required)" : "What should change? (optional)"} data-testid="input-decision-reason" className="min-h-[80px] w-full rounded border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary" />
                      <button onClick={() => submit(pending)} disabled={decide.isPending || (needsReason && !reason.trim())} className={cn(btnSecondary, "w-full")} data-testid="button-confirm-decision">Confirm {actionLabel[pending].toLowerCase()}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
          <Panel title="Decision history" pad={false}>
            {r.decisions.length === 0 && <div className="p-4 text-sm text-muted-foreground">No decisions recorded yet.</div>}
            <ol className="divide-y">
              {r.decisions.map((d, i) => (
                <Rise key={d.id} i={i}>
                  <li className="px-4 py-2.5">
                    <div className="flex items-center justify-between"><span className="text-sm font-semibold">{actionLabel[d.action]}</span><span className="font-mono text-[10.5px] text-muted-foreground">{date(d.createdAt)}</span></div>
                    <div className="text-xs text-muted-foreground">{d.actor} · {roleLabel[d.role]}</div>
                    {d.reason && <div className="mt-1 text-xs italic">"{d.reason}"</div>}
                  </li>
                </Rise>
              ))}
            </ol>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return <div><div className="eyebrow mb-1.5">{title}</div><ul className="space-y-1">{items.map((x) => <li key={x} className="flex gap-2"><span className="mt-2 h-1 w-1.5 shrink-0 bg-foreground/50" />{x}</li>)}</ul></div>;
}

function Snapshot({ v, proposed, base }: { v: VersionSnapshot; proposed?: boolean; base?: Metrics }) {
  const rows: [keyof Metrics, string, string, boolean][] = [
    ["taskMinutes", "Task time", "min", false],
    ["successRate", "Success", "%", true],
    ["errorRate", "Errors", "%", false],
    ["adoption", "Adoption", "%", true],
  ];
  return (
    <div className={cn("rounded-md border bg-card p-4", proposed && "border-2 border-primary")}>
      <div className="mb-1 flex items-center justify-between"><span className={cn("eyebrow", proposed && "!text-primary")}>{proposed ? "Proposed" : "Current"}</span><span className="font-mono text-xs">v{v.version}</span></div>
      <div className="mb-3 font-display font-semibold">{v.label}</div>
      <div className="mb-3 flex flex-wrap gap-1">{v.workflowSteps.map((w) => <span key={w} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{w}</span>)}</div>
      <dl className="grid grid-cols-2 gap-y-1 font-mono text-xs">
        {rows.map(([k, l, u, higher]) => {
          const val = v.performance[k];
          const better = base ? (higher ? val > base[k] : val < base[k]) : false;
          return <Fragment key={k}><dt className="text-muted-foreground">{l}</dt><dd className={cn("text-right", better && "font-semibold text-ok")}>{val}{u}</dd></Fragment>;
        })}
      </dl>
      <div className="mt-3 border-t pt-2 text-xs text-muted-foreground">{v.capabilities.length} capabilities · {v.userGroups.join(", ")}</div>
    </div>
  );
}
