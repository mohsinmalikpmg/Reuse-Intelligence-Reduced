import { useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useGetPortfolio, type PortfolioMetric, type PortfolioMetrics, type RedirectEvent } from "@workspace/api-client-react";
import { Skel, Tag, btn } from "@/components/bits";
import { cn } from "@/lib/utils";

const KEYS: (keyof PortfolioMetrics)[] = ["reuseBeforeBuild", "capabilityAcceptance", "improvementsFolded", "variantsPerFamily", "duplicateAfterBuild", "timeToFirstTest"];

/** Reuse signals (read-only): the six measured ratios and recent redirects. Reads the same record as Review, shows none of its actions. */
export function ReuseSignals() {
  const q = useGetPortfolio();
  if (q.isLoading) return <div className="grid gap-3 sm:grid-cols-2">{KEYS.map((k) => <Skel key={k} className="h-28" />)}</div>;
  if (q.isError || !q.data) return <p className="text-[14px] text-muted-foreground">Reuse signals could not load. <button className={btn.quiet} onClick={() => q.refetch()}>Retry</button></p>;
  const p = q.data;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2" data-testid="section-questions">{KEYS.map((k) => <Metric key={k} m={p.metrics[k]} />)}</div>
      <h3 className="mb-2 mt-8 text-[17px] font-semibold">Redirected before build</h3>
      {p.redirects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input px-5 py-6 text-[14.5px] text-muted-foreground" data-testid="redirects-empty">No reuse checks have been recorded yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card" data-testid="redirects">{p.redirects.map((r) => <Redirect key={r.id} r={r} />)}</ul>
      )}
    </>
  );
}

function Metric({ m }: { m: PortfolioMetric }) {
  const [open, setOpen] = useState(false);
  const noData = m.numerator === null && m.denominator === null;
  const ratio = m.numerator !== null && m.denominator !== null && m.denominator > 0 ? `${Math.round((m.numerator / m.denominator) * 100)}%` : null;
  return (
    <div className="card-soft p-5" data-testid={`metric-${m.key}`}>
      <div className="flex items-start gap-2">
        <span className="flex-1 text-[14.5px] font-semibold text-primary">{m.question}</span>
        {m.demo && !noData && <Tag tone="sienna" testid={`tag-demo-${m.key}`}>demo data</Tag>}
      </div>
      <div className="mt-0.5 text-[13px] text-muted-foreground">{m.label}</div>
      <div className={cn("mt-1 text-[26px] font-bold", noData ? "text-muted-foreground" : "text-primary")} data-testid={`value-${m.key}`}>{m.value}</div>
      {ratio && <div className="text-[13px] text-muted-foreground">{ratio} ({m.numerator}/{m.denominator})</div>}
      <button data-testid={`button-metric-details-${m.key}`} onClick={() => setOpen((v) => !v)} className={cn(btn.quiet, "-ml-3 mt-1")}><ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} /> How it is measured</button>
      {open && <p className="reveal text-[13.5px] leading-relaxed" data-testid={`definition-${m.key}`}>{m.definition}</p>}
    </div>
  );
}

function Redirect({ r }: { r: RedirectEvent }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3 text-[14px]" data-testid={`redirect-${r.id}`}>
      <span className="font-medium text-primary">{r.actor}</span>
      <span>asked for “{r.need}”</span>
      <ArrowRight className="h-3.5 w-3.5 self-center text-sienna" />
      <span>{r.outcome}</span>
      <span className="ml-auto text-[12.5px] text-muted-foreground">{ago(r.at)}</span>
      {r.demo && <Tag tone="sienna">demo</Tag>}
    </li>
  );
}

function ago(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
