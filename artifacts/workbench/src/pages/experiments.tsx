import { Link } from "wouter";
import { ArrowRight, FlaskConical } from "lucide-react";
import { useListExperiments } from "@workspace/api-client-react";
import { EmptyState, ErrorState, LoadingRows, PageHeader, Rise, Tag } from "@/components/kit";
import { date, pct, recommendation } from "@/lib/labels";

export default function Experiments() {
  const q = useListExperiments();
  return (
    <div>
      <PageHeader eyebrow="Experiments" title="Simulations against your products." sub="Projected outcomes against synthetic users. Nothing here has touched production." />
      {q.isError && <ErrorState onRetry={() => q.refetch()} />}
      {q.isLoading && <LoadingRows rows={4} />}
      {q.data?.length === 0 && <EmptyState icon={<FlaskConical className="h-5 w-5" />} title="No simulations yet" body="When a case runs a simulation, the result is listed here." />}
      <div className="space-y-2">
        {q.data?.map((e, i) => {
          const r = recommendation[e.recommendation];
          const lead = e.metrics.find((m) => m.primary) ?? e.metrics[0];
          return (
            <Rise key={e.id} i={i}>
              <Link href={`/cases/${e.caseId}?tab=test`} data-testid={`row-experiment-${e.id}`} className="group grid items-center gap-3 rounded-md border bg-card px-4 py-3 hover:border-foreground/40 md:grid-cols-[1fr_auto_auto_auto]">
                <div>
                  <div className="font-semibold group-hover:text-primary">{e.challengerName}</div>
                  <div className="text-xs text-muted-foreground">vs {e.baselineName} · {e.cohort.length} synthetic personas · {date(e.createdAt)}</div>
                </div>
                {lead && <span className={`font-mono text-sm ${lead.improved ? "text-ok" : "text-bad"}`}>{lead.label} {pct(lead.deltaPct)}</span>}
                <Tag tone={r[1]}>{r[0]}</Tag>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
              </Link>
            </Rise>
          );
        })}
      </div>
    </div>
  );
}
