import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useGetPortfolio, type ConsolidationSummary } from "@workspace/api-client-react";
import { CaseBadge, ErrorState, Panel, Rise, Skel, SolutionBadge, Stat, Tag } from "@/components/kit";
import { date, recommendation } from "@/lib/labels";
import { cn } from "@/lib/utils";

const ACTION_TONE: Record<string, "signal" | "ok" | "warn" | "ink"> = { consolidate: "signal", standardize: "ink", retain: "ok", retire: "warn" };

export default function Portfolio() {
  const q = useGetPortfolio();
  const [, setLocation] = useLocation();
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div className="space-y-4"><Skel className="h-24 w-2/3" /><div className="grid grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <Skel key={i} className="h-20" />)}</div><Skel className="h-80" /></div>
    );
  const p = q.data;
  const m = p.metrics;

  return (
    <div>
      <div className="mb-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <div className="eyebrow mb-2">IT portfolio · {p.headline}</div>
          <h1 className="text-3xl font-extrabold leading-[1.02] md:text-[44px]">See duplication, risk, ownership, <span className="text-primary">and reuse in one place.</span></h1>
        </div>
        <div className="max-w-sm rounded-md border-l-[3px] border-primary bg-accent px-4 py-3 text-sm font-medium text-accent-foreground">{p.valueStatement}</div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Active solutions" value={m.activeSolutions} />
        <Stat label="Overlap groups" value={m.overlappingGroups} accent />
        <Stat label="Certified / exp." value={<>{m.certified}<span className="text-muted-foreground">/{m.experimental}</span></>} />
        <Stat label="No owner" value={m.withoutOwner} />
        <Stat label="Consolidate" value={m.consolidationOpportunities} />
        <Stat label="Retire" value={m.retirementCandidates} />
        <Stat label="Shared caps" value={m.sharedCapabilityReuse} />
        <Link href="/portfolio/queue" data-testid="link-pending-reviews"><Stat label="Pending reviews" value={m.pendingReviews} hint="Open queue" /></Link>
      </div>

      <Panel title="Portfolio by business problem" pad={false} className="mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2">Business problem</th><th className="px-3 py-2">Solutions</th><th className="px-3 py-2 text-center">Active</th><th className="px-3 py-2">Recommended action</th><th className="px-3 py-2">Status</th><th />
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr
                  key={r.businessProblem.id}
                  data-testid={`row-portfolio-${r.businessProblem.id}`}
                  onClick={() => setLocation(r.caseId ? `/cases/${r.caseId}` : r.solutions[0] ? `/library/${r.solutions[0].id}` : "/library")}
                  className="group cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50"
                >
                  <td className="px-4 py-3"><div className="font-semibold group-hover:text-primary">{r.businessProblem.title}</div><div className="text-xs text-muted-foreground line-clamp-1">{r.businessProblem.description}</div></td>
                  <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{r.solutions.slice(0, 4).map((s) => <span key={s.id} title={s.name} className={cn("h-2.5 w-6 rounded-sm", s.status === "certified" ? "bg-ok" : s.status === "pilot" ? "bg-foreground/60" : s.status === "experimental" ? "bg-warn" : "bg-muted-foreground/30")} />)}</div></td>
                  <td className="px-3 py-3 text-center font-mono text-base font-semibold">{r.activeSolutions}</td>
                  <td className="px-3 py-3"><Tag tone={ACTION_TONE[r.businessProblem.recommendedAction] ?? "ink"}>{r.recommendedAction}</Tag></td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{r.status}</td>
                  <td className="px-3 py-3"><ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <h2 className="mb-3 text-xl font-bold">Consolidation cases</h2>
      <div className="mb-8 space-y-3">{p.consolidationCases.map((c, i) => <Consolidation key={c.case.id} c={c} i={i} />)}</div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Unsupported solutions" pad={false}>
          {p.unsupportedSolutions.length === 0 && <div className="p-4 text-sm text-muted-foreground">Every solution has an owner and support model.</div>}
          <ul className="divide-y">
            {p.unsupportedSolutions.map((s) => (
              <li key={s.id}><Link href={`/library/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50"><SolutionBadge status={s.status} /><span className="flex-1 text-sm font-medium">{s.name}</span><span className="text-xs text-muted-foreground">{s.supportModel}</span></Link></li>
            ))}
          </ul>
        </Panel>
        <Panel title="Duplicate capabilities by category" pad={false}>
          <ul className="divide-y">
            {p.duplicateCapabilities.map((d) => (
              <li key={d.category} className="px-4 py-2.5">
                <div className="mb-1 flex items-center justify-between"><span className="text-sm font-semibold">{d.category}</span><span className="font-mono text-xs text-primary">{d.capabilities.length}x built</span></div>
                <div className="flex flex-wrap gap-1">{d.capabilities.map((c) => <Tag key={c.id}>{c.sourceSolutionName}</Tag>)}</div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Consolidation({ c, i }: { c: ConsolidationSummary; i: number }) {
  const [open, setOpen] = useState(false);
  const rec = c.experimentRecommendation ? recommendation[c.experimentRecommendation] : null;
  return (
    <Rise i={i}>
      <article className="rounded-md border bg-card" data-testid={`card-consolidation-${c.case.id}`}>
        <div className="grid gap-4 p-4 lg:grid-cols-[1.4fr_1fr_auto]">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2"><CaseBadge status={c.case.status} />{rec && <Tag tone={rec[1]}>{rec[0]}</Tag>}</div>
            <Link href={`/cases/${c.case.id}`} className="font-display text-lg font-semibold hover:text-primary">{c.case.title}</Link>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
              {c.overlappingSolutions.map((s) => (
                <span key={s.id} className={cn("rounded border px-2 py-0.5 text-xs", s.id === c.baseSolution.id ? "border-ok bg-ok/10 font-semibold text-ok" : c.retirementCandidate?.id === s.id ? "border-warn/50 text-warn line-through decoration-1" : "")}>{s.name}</span>
              ))}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{c.valueStatement}</p>
          </div>
          <dl className="grid grid-cols-[100px_1fr] content-start gap-y-1 text-xs">
            <dt className="text-muted-foreground">Base</dt><dd className="font-medium">{c.baseSolution.name}</dd>
            <dt className="text-muted-foreground">Owner</dt><dd>{c.ownerName}</dd>
            <dt className="text-muted-foreground">Reuse</dt><dd>{c.reusableCapabilities.map((r) => r.name).join(", ") || "None"}</dd>
            <dt className="text-muted-foreground">Retire</dt><dd>{c.retirementCandidate?.name ?? "None"}</dd>
            <dt className="text-muted-foreground">Architecture</dt><dd>{c.architectureStatus}</dd>
            <dt className="text-muted-foreground">Controls</dt><dd>{c.controlStatus}</dd>
            <dt className="text-muted-foreground">Migration</dt><dd>{c.migrationEffort}</dd>
          </dl>
          <div className="flex flex-row items-center gap-3 lg:flex-col lg:items-end">
            <div className="text-right"><div className="font-display text-4xl font-extrabold text-primary">-{c.duplicationReductionPct}%</div><div className="eyebrow">duplication</div></div>
            <Link href={`/cases/${c.case.id}/review`} className="text-sm font-medium text-primary hover:underline" data-testid={`link-review-${c.case.id}`}>Review</Link>
          </div>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 border-t px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground" data-testid={`button-trail-${c.case.id}`}>
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} /> Decision and evidence trail ({c.evidenceTrail.length})
        </button>
        {open && (
          <ol className="space-y-1.5 border-t bg-muted/30 px-4 py-3">
            {c.evidenceTrail.map((e, k) => (
              <li key={k} className="grid grid-cols-[100px_140px_1fr] gap-2 text-xs"><span className="font-mono text-muted-foreground">{date(e.at)}</span><span className="font-medium">{e.actor}</span><span>{e.event}</span></li>
            ))}
          </ol>
        )}
      </article>
    </Rise>
  );
}
