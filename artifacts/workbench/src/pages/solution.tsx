import { Link, useParams } from "wouter";
import { ArrowLeft, Lock } from "lucide-react";
import { getGetSolutionQueryKey, useGetSolution } from "@workspace/api-client-react";
import { CaseRow } from "@/components/blocks";
import { EvidenceBadge, ErrorState, Panel, Rise, Skel, SolutionBadge, Stat, Tag } from "@/components/kit";
import { date, fmt, kind } from "@/lib/labels";

export default function SolutionPage() {
  const { solutionId = "" } = useParams<{ solutionId: string }>();
  const q = useGetSolution(solutionId, { query: { enabled: !!solutionId, queryKey: getGetSolutionQueryKey(solutionId) } });
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} message="That solution could not be found." />;
  if (!q.data) return <div className="space-y-3"><Skel className="h-28" /><Skel className="h-24" /><Skel className="h-80" /></div>;
  const { solution: s, capabilities, businessProblems, openCases } = q.data;
  const m = s.baselineMetrics;

  return (
    <div>
      <Link href="/library" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Library</Link>
      <div className="mb-6 flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <div className="mb-2 flex flex-wrap gap-1.5"><SolutionBadge status={s.status} /><Tag>{kind[s.kind]}</Tag><EvidenceBadge level={s.evidenceLevel} />{s.retirementCandidate && <Tag tone="warn">Retiring</Tag>}</div>
          <h1 className="text-4xl font-extrabold">{s.name}</h1>
          <p className="mt-1 text-lg text-muted-foreground">{s.outcome}</p>
          <p className="mt-3 text-sm">{s.description}</p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <span className="text-muted-foreground">Owner</span><span>{s.ownerName}</span>
          <span className="text-muted-foreground">Team</span><span>{s.ownerTeam}</span>
          <span className="text-muted-foreground">Version</span><span className="font-mono">v{s.currentVersion}</span>
          <span className="text-muted-foreground">Reviewed</span><span>{date(s.lastReviewedAt)}</span>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Active users" value={fmt(s.activeUsers)} />
        <Stat label="Task time" value={`${m.taskMinutes}m`} />
        <Stat label="Success" value={`${m.successRate}%`} />
        <Stat label="Errors" value={`${m.errorRate}%`} />
        <Stat label="Adoption" value={`${m.adoption}%`} />
        <Stat label="Cost / task" value={`$${m.costPerTask.toFixed(2)}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Panel title="Workflow">
            <div className="flex flex-wrap items-center gap-1">
              {s.workflowSteps.map((w, i) => (
                <span key={w} className="flex items-center gap-1">
                  {i > 0 && <span className="h-px w-4 bg-foreground/30" />}
                  <span className="rounded border bg-muted px-2.5 py-1 font-mono text-xs">{String(i + 1).padStart(2, "0")} {w}</span>
                </span>
              ))}
            </div>
          </Panel>
          <Panel title={`Capabilities (${capabilities.length})`} pad={false}>
            <ul className="divide-y">
              {capabilities.map((c, i) => (
                <Rise key={c.id} i={i}>
                  <li className="grid gap-1 px-4 py-2.5 md:grid-cols-[1fr_auto]">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold">{c.controlType === "locked" && <Lock className="h-3 w-3 text-muted-foreground" />}{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.description}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1"><Tag>{c.workflowStep}</Tag><Tag tone={c.controlType === "locked" ? "ink" : "muted"}>{c.controlType === "locked" ? "Required" : c.controlType}</Tag></div>
                  </li>
                </Rise>
              ))}
            </ul>
          </Panel>
          {openCases.length > 0 && (
            <section>
              <h3 className="mb-2 font-bold">Open cases using this product</h3>
              <div className="space-y-2">{openCases.map((c, i) => <CaseRow key={c.case.id} c={c} i={i} />)}</div>
            </section>
          )}
        </div>
        <div className="space-y-4">
          <Panel title="Version history" pad={false}>
            <ol className="relative">
              {s.versions.map((v) => (
                <li key={v.version} className="border-b px-4 py-2.5 last:border-0">
                  <div className="flex items-center justify-between"><span className="font-mono text-sm font-semibold">v{v.version}</span><span className="font-mono text-[11px] text-muted-foreground">{date(v.releasedAt)}</span></div>
                  <div className="text-xs text-muted-foreground">{v.summary}</div>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title="Known gaps">
            {s.knownGaps.length === 0 ? <div className="text-sm text-muted-foreground">None recorded.</div> : <ul className="space-y-1 text-sm">{s.knownGaps.map((g) => <li key={g} className="flex gap-2"><span className="mt-2 h-1 w-2 shrink-0 bg-warn" />{g}</li>)}</ul>}
          </Panel>
          <Panel title="Dependencies">
            <div className="flex flex-wrap gap-1.5">{s.dependencies.map((d) => <Tag key={d}>{d}</Tag>)}</div>
          </Panel>
          <Panel title="Governance">
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Architecture</dt><dd>{s.architectureStatus}</dd>
              <dt className="text-muted-foreground">Controls</dt><dd>{s.controlStatus}</dd>
              <dt className="text-muted-foreground">Support</dt><dd>{s.supportModel}</dd>
              <dt className="text-muted-foreground">Adoption</dt><dd>{s.timeToAdopt} · {s.adoptionEffort} effort</dd>
              <dt className="text-muted-foreground">Units</dt><dd>{s.businessUnits.join(", ")}</dd>
            </dl>
          </Panel>
          {businessProblems.length > 0 && (
            <Panel title="Business problems addressed">
              <ul className="space-y-1 text-sm">{businessProblems.map((b) => <li key={b.id}>{b.title}</li>)}</ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
