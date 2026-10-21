import { Link, useParams } from "wouter";
import { ArrowRight, CheckCircle2, FileText, Lock, ShieldCheck } from "lucide-react";
import { getGetCaseDecisionViewQueryKey, useGetCaseDecisionView, type DecisionView } from "@workspace/api-client-react";
import { ErrorView, LoadingView, Page, StatusPill, Tag, btn, StageEyebrow } from "@/components/bits";
import { RiskTag } from "@/components/enterprise";
import { caseStatusLabel } from "@/components/wb-pilot";
import { cn } from "@/lib/utils";

/**
 * Executive Decision View: one read-oriented page per experiment. Nothing on it can be edited; every number comes
 * from a persisted run, vote or decision, and where nothing has been measured the page says so.
 */

const RECOMMENDATION: Record<NonNullable<DecisionView["ownerRecommendation"]["recommendation"]>, { l: string; tone: "green" | "sky" | "sienna" | "muted" }> = {
  proceed_to_pilot: { l: "Proceed to pilot", tone: "green" },
  revise_configuration: { l: "Revise the configuration", tone: "sky" },
  gather_more_evidence: { l: "Gather more evidence", tone: "sky" },
  do_not_proceed: { l: "Do not proceed", tone: "sienna" },
};
const ROLE_LABEL = { seeker: "Requester", owner: "Solution owner", it: "IT governance" } as const;
const ACTION_LABEL: Record<string, string> = {
  propose_pilot: "Pilot proposed", propose_capability: "Capability proposed as reusable", request_new_family: "New solution family requested",
  approve_pilot: "Pilot approved", request_changes: "Changes requested", defer: "Deferred", reject: "Rejected",
  approve_consolidation: "Published as the governed successor", withdraw_consolidation: "Consolidation withdrawn", adopt_approach: "Approach adopted",
};

export default function DecisionPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const q = useGetCaseDecisionView(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseDecisionViewQueryKey(caseId) } });
  if (q.isLoading) return <LoadingView />;
  if (q.isError || !q.data) return <ErrorView onRetry={() => q.refetch()} message="The decision view could not load." />;
  const v = q.data;
  const st = caseStatusLabel({ status: v.status, foldedInto: null });
  const base = v.recommendedBase;
  const ev = v.evidence;
  const n = (x: number) => x.toLocaleString();

  return (
    <Page className="max-w-[1040px]">
      <nav className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/library" className="hover:text-primary hover:underline">Library</Link><span>/</span>
        <Link href={`/solutions/${base.id}`} className="hover:text-primary hover:underline">{base.name}</Link><span>/</span>
        <span>Decision view</span>
      </nav>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone="slate"><Lock className="h-3 w-3" /> Read-only decision view</Tag>
            <Tag tone={st.tone} testid="tag-decision-status">{st.l}</Tag>
            <span className="text-[13px] text-muted-foreground">Prepared {new Date(v.generatedAt).toLocaleString()}</span>
          </div>
          <StageEyebrow stage="converge" className="mt-3" note="One stronger circuit. Not another app." />
          <h1 data-testid="text-headline" className="mt-2 text-[30px] md:text-[36px]">{v.title}</h1>
          <p className="mt-2 text-[15px] text-skyink">{v.businessProblem.businessFunction} · {v.businessProblem.title} · primary user: {v.businessProblem.primaryUser}</p>
        </div>
        <Link href={`/workbench/${v.caseId}?mode=compare`} className={btn.secondary} data-testid="link-decision-workbench"><FileText className="h-4 w-4" /> Open the evidence in the workbench</Link>
      </div>

      {/* Decision required: the one thing the reader came for, first */}
      <section className={cn("card-soft mt-6 border-l-4 p-5", v.decisionRequired.role ? "border-l-sienna" : "border-l-ok")} data-testid="panel-decision-required">
        <div className="eyebrow">Decision required</div>
        <div className="mt-1 text-[20px] font-bold leading-snug" data-testid="text-decision-required">{v.decisionRequired.label}</div>
        <p className="mt-1 text-[14.5px] text-muted-foreground">{v.decisionRequired.detail}</p>
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Block title="Business problem" testid="panel-problem">
          <p className="text-[15px]">{v.businessProblem.description}</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[14px]">
            <div><dt className="eyebrow">Function</dt><dd>{v.businessProblem.businessFunction}</dd></div>
            <div><dt className="eyebrow">Primary user</dt><dd>{v.businessProblem.primaryUser}</dd></div>
          </dl>
        </Block>

        <Block title="Overlapping solutions" sub={`${v.overlappingSolutions.length} live product${v.overlappingSolutions.length === 1 ? "" : "s"} address this problem.`} testid="panel-overlap">
          <ul className="divide-y divide-border">
            {v.overlappingSolutions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-[14px]" data-testid={`overlap-${s.id}`}>
                <Link href={`/solutions/${s.id}`} className="font-semibold text-foreground hover:text-primary hover:underline">{s.name}</Link>
                <StatusPill status={s.status} />
                {s.role === "base" && <Tag tone="green">Recommended base</Tag>}
                {s.role === "candidate" && <Tag tone="sky">Capabilities considered</Tag>}
                {s.disposition && <Tag>{s.disposition}</Tag>}
                <span className="ml-auto text-[13px] text-muted-foreground">{n(s.activeUsers)} users · {s.ownerName}{s.ownerTeam ? `, ${s.ownerTeam}` : ""}</span>
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Recommended base" testid="panel-base">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/solutions/${base.id}`} className="text-[18px] font-bold text-foreground hover:text-primary hover:underline">{base.name}</Link>
            <StatusPill status={base.status} />
            <span className="text-[13px] text-muted-foreground">v{base.version} · {base.outputType}</span>
          </div>
          <p className="mt-2 text-[14.5px]" data-testid="text-base-why">{base.why}</p>
        </Block>

        <Block title="Proposed improvement" sub={v.proposedImprovement.summary} testid="panel-improvement">
          {v.proposedImprovement.added.length > 0 && (
            <div>
              <div className="eyebrow">Added</div>
              <ul className="mt-1 space-y-1 text-[14.5px]">{v.proposedImprovement.added.map((a) => <li key={a.name} data-testid={`added-${a.name}`}><span className="font-semibold">{a.name}</span> <span className="text-muted-foreground">from {a.sourceSolutionName} · {a.workflowStep} step</span></li>)}</ul>
            </div>
          )}
          {v.proposedImprovement.removed.length > 0 && (
            <div className="mt-3"><div className="eyebrow">Switched off</div><ul className="mt-1 space-y-1 text-[14.5px]">{v.proposedImprovement.removed.map((r) => <li key={r}>{r}</li>)}</ul></div>
          )}
          {v.proposedImprovement.changedSettings.length > 0 && (
            <div className="mt-3"><div className="eyebrow">Settings changed</div><ul className="mt-1 space-y-1 text-[14.5px]">{v.proposedImprovement.changedSettings.map((c) => <li key={c.capabilityName}><span className="font-semibold">{c.capabilityName}</span>: {c.from} → {c.to}</li>)}</ul></div>
          )}
          {v.proposedImprovement.added.length + v.proposedImprovement.removed.length + v.proposedImprovement.changedSettings.length === 0 && <p className="text-[14.5px] text-muted-foreground">Version B still equals the current product.</p>}
        </Block>

        <Block title="A/B evidence" sub="Real runs of both versions on the same input, and the preferences people recorded." testid="panel-evidence">
          <p className="text-[14.5px]" data-testid="text-evidence-description">{ev.description}</p>
          {ev.latestComparison ? (
            <div className="mt-3 rounded-xl border border-border bg-secondary/50 p-3 text-[13.5px]" data-testid="panel-latest-comparison">
              <div className="eyebrow">Latest comparison · {ev.latestComparison.inputName} · {new Date(ev.latestComparison.ranAt).toLocaleString()}</div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="font-semibold">{ev.latestComparison.added}</span> lines added</span>
                <span><span className="font-semibold">{ev.latestComparison.changed}</span> changed</span>
                <span><span className="font-semibold">{ev.latestComparison.removed}</span> removed</span>
                <span><span className="font-semibold">{ev.latestComparison.unchanged}</span> the same</span>
              </div>
              {ev.latestComparison.stepsResponsible.length > 0 && <p className="mt-1.5 text-muted-foreground">Steps responsible: {ev.latestComparison.stepsResponsible.join(", ")}</p>}
            </div>
          ) : (
            <p className="mt-3 text-[14px] text-muted-foreground" data-testid="text-no-comparison">The current configuration has not been compared with the current product yet.</p>
          )}
          {ev.summary.votes && (
            <div className="mt-3 grid grid-cols-3 gap-2 text-center" data-testid="panel-votes">
              {([["Prefer current", ev.summary.votes.aPreferred], ["Prefer proposed", ev.summary.votes.bPreferred], ["Neither", ev.summary.votes.neither]] as const).map(([l, c]) => (
                <div key={l} className="rounded-lg border border-border bg-card px-2 py-2"><div className="text-[22px] font-bold leading-none">{c}</div><div className="mt-1 text-[12px] text-muted-foreground">{l}</div></div>
              ))}
            </div>
          )}
          {ev.summary.setAside > 0 && <p className="mt-2 text-[13px] text-muted-foreground">{ev.summary.setAside} vote{ev.summary.setAside === 1 ? "" : "s"} on earlier configurations set aside, not counted.</p>}
        </Block>

        <Block title="Risks and controls" testid="panel-risks">
          <div className="flex flex-wrap items-center gap-2"><RiskTag tier={v.risksAndControls.riskTier} testid="tag-risk-tier" /><span className="text-[14px]" data-testid="text-main-risk">{v.risksAndControls.mainRisk}</span></div>
          <div className="mt-3"><div className="eyebrow">Controls on the base product</div><div className="mt-1 flex flex-wrap gap-1.5">{v.risksAndControls.controls.map((c) => <Tag key={c} tone="green"><ShieldCheck className="h-3 w-3" />{c}</Tag>)}</div></div>
          {v.risksAndControls.newDependencies.length > 0 && <div className="mt-3"><div className="eyebrow">New dependencies</div><p className="mt-1 text-[14px]">{v.risksAndControls.newDependencies.join(", ")}</p></div>}
          {v.risksAndControls.knownGaps.length > 0 && <div className="mt-3"><div className="eyebrow">Known gaps that remain</div><ul className="mt-1 list-disc space-y-0.5 pl-5 text-[14px]">{v.risksAndControls.knownGaps.map((g) => <li key={g}>{g}</li>)}</ul></div>}
        </Block>

        <Block title="Measured value" sub="Only what has been measured. FUSEBOX does not project savings." testid="panel-value">
          {v.measuredValue.lines.length > 0 ? (
            <ul className="space-y-1.5 text-[14.5px]">{v.measuredValue.lines.map((l) => <li key={l} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" />{l}</li>)}</ul>
          ) : (
            <p className="text-[15px] font-semibold" data-testid="text-no-value">No measured value yet</p>
          )}
          <p className="mt-2 text-[13px] text-muted-foreground" data-testid="text-value-note">{v.measuredValue.note}</p>
        </Block>

        <Block title="Owner recommendation" testid="panel-owner-recommendation">
          {v.ownerRecommendation.recommendation ? (
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone={RECOMMENDATION[v.ownerRecommendation.recommendation].tone} testid="tag-recommendation">{RECOMMENDATION[v.ownerRecommendation.recommendation].l}</Tag>
              {v.ownerRecommendation.confidence !== null && <span className="text-[13px] text-muted-foreground">confidence {Math.round(v.ownerRecommendation.confidence * 100)}%</span>}
            </div>
          ) : <Tag>None recorded</Tag>}
          <p className="mt-2 text-[14.5px]" data-testid="text-recommendation-narrative">{v.ownerRecommendation.narrative}</p>
        </Block>
      </div>

      <section className="mt-6" data-testid="panel-decisions">
        <h2 className="text-[17px] font-semibold">Decisions recorded</h2>
        {v.decisions.length === 0 ? (
          <p className="mt-1 text-[14px] text-muted-foreground">No decision has been recorded on this experiment yet.</p>
        ) : (
          <ol className="card-soft mt-2 divide-y divide-border">
            {v.decisions.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[14px]" data-testid={`decision-${d.id}`}>
                <span className="font-semibold">{ACTION_LABEL[d.action] ?? d.action}</span>
                <span className="text-muted-foreground">by {d.actor} ({ROLE_LABEL[d.role]})</span>
                {d.reason && <span className="text-muted-foreground">· {d.reason}</span>}
                <span className="ml-auto text-[13px] text-muted-foreground">{new Date(d.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="mt-8 flex items-center gap-2 text-[13px] text-muted-foreground">
        <Lock className="h-3.5 w-3.5" /> Decisions are taken in the workbench by the owner and in the Decide view by IT; this page only reports them.
        <Link href={`/workbench/${v.caseId}?mode=compare`} className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline">Go there <ArrowRight className="h-3.5 w-3.5" /></Link>
      </p>
    </Page>
  );
}

function Block({ title, sub, children, testid }: { title: string; sub?: string; children: React.ReactNode; testid: string }) {
  return (
    <section className="card-soft p-5" data-testid={testid}>
      <h2 className="text-[17px] font-semibold">{title}</h2>
      {sub && <p className="mt-0.5 text-[13.5px] text-muted-foreground">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
