import { useState } from "react";
import { Link, useSearch } from "wouter";
import { ArrowRight, ChevronDown, X } from "lucide-react";
import { useGetPortfolio, type PortfolioMetric, type PortfolioMetrics, type QueueItem, type RedirectEvent } from "@workspace/api-client-react";
import { ErrorView, Headline, LoadingView, Page, Tag, btn } from "@/components/bits";
import { Consolidation } from "@/components/consolidation";
import { cn } from "@/lib/utils";

/** The four questions, in the order the IT leader asks them, then the two failure measures. */
const QUESTIONS: (keyof PortfolioMetrics)[] = ["reuseBeforeBuild", "capabilityAcceptance", "improvementsFolded", "variantsPerFamily"];
const FAILURES: (keyof PortfolioMetrics)[] = ["duplicateAfterBuild", "timeToFirstTest"];

export default function Portfolio() {
  const q = useGetPortfolio();
  // A consolidation record opened from a product's version history; it is not a queue item, so it is shown on request only.
  const requested = new URLSearchParams(useSearch()).get("case");
  const [touched, setTouched] = useState<string | null | undefined>(undefined);
  // The row the person is working in stays on the page after their decision resolves it, until they close it.
  const [pinned, setPinned] = useState<QueueItem | null>(null);
  if (q.isLoading) return <LoadingView />;
  if (q.isError || !q.data) return <ErrorView onRetry={() => q.refetch()} message="The portfolio could not load." />;
  const p = q.data;
  const record: QueueItem | null = requested && !p.queue.some((i) => i.caseId === requested)
    ? { id: `record-${requested}`, kind: "consolidation_approval", title: "Consolidation record", detail: "Opened from the product's version history. Published decisions can be withdrawn here.", usage: null, actionLabel: "Open record", caseId: requested, solutionId: null, demo: false }
    : null;
  const live = record ? [record, ...p.queue] : p.queue;
  const queue = pinned && !live.some((i) => i.id === pinned.id) ? [pinned, ...live] : live;
  // Until the person opens or closes a row, the requested case's row (if any) is the open one.
  const open = touched === undefined ? (queue.find((i) => i.caseId === requested)?.id ?? null) : touched;
  const setOpen = (id: string | null) => { setTouched(id); setPinned(id ? (queue.find((i) => i.id === id) ?? null) : null); };
  return (
    <Page>
      <Headline stage="converge" title="One stronger circuit." accent="Not another app." sub={<>{p.headline} {p.valueStatement}</>} />
      <div className="grid gap-3 sm:grid-cols-2" data-testid="section-questions">{QUESTIONS.map((k) => <Metric key={k} m={p.metrics[k]} question />)}</div>

      <h2 className="mb-1 mt-10 text-[22px] font-semibold">Where it still fails</h2>
      <p className="mb-3 text-[14px] text-muted-foreground">Two measures of effort that reuse did not prevent.</p>
      <div className="grid gap-3 sm:grid-cols-2" data-testid="section-failures">{FAILURES.map((k) => <Metric key={k} m={p.metrics[k]} />)}</div>

      <h2 className="mb-1 mt-10 text-[22px] font-semibold">Needs your decision</h2>
      <p className="mb-3 text-[14px] text-muted-foreground">Only what IT has to act on. Experiments and seeker activity stay with their owners.</p>
      {queue.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input px-5 py-6 text-[14.5px] text-muted-foreground" data-testid="queue-empty">Nothing needs an IT decision right now.</p>
      ) : (
        <ol className="space-y-2" data-testid="queue">
          {queue.map((item) => <QueueRow key={item.id} item={item} open={open === item.id} settled={!live.some((i) => i.id === item.id)} onToggle={() => setOpen(open === item.id ? null : item.id)} />)}
        </ol>
      )}

      <h2 className="mb-1 mt-10 text-[22px] font-semibold">Redirected before build</h2>
      <p className="mb-3 text-[14px] text-muted-foreground">Reuse checks where a person used or improved existing work instead of starting a build.</p>
      {p.redirects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input px-5 py-6 text-[14.5px] text-muted-foreground" data-testid="redirects-empty">No reuse checks have been recorded yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card" data-testid="redirects">{p.redirects.map((r) => <Redirect key={r.id} r={r} />)}</ul>
      )}
    </Page>
  );
}

function Metric({ m, question = false }: { m: PortfolioMetric; question?: boolean }) {
  const [open, setOpen] = useState(false);
  const noData = m.numerator === null && m.denominator === null;
  const ratio = m.numerator !== null && m.denominator !== null && m.denominator > 0 ? `${Math.round((m.numerator / m.denominator) * 100)}%` : null;
  return (
    <div className="card-soft p-5" data-testid={`metric-${m.key}`}>
      <div className="flex items-start gap-2">
        <span className={cn("flex-1", question ? "text-[16px] font-semibold text-primary" : "text-[14px] text-muted-foreground")}>{question ? m.question : m.label}</span>
        {m.demo && !noData && <Tag tone="sienna" testid={`tag-demo-${m.key}`}>demo data</Tag>}
      </div>
      {question && <div className="mt-0.5 text-[13px] text-muted-foreground">{m.label}</div>}
      <div className={cn("mt-1 text-[30px] font-bold", noData ? "text-muted-foreground" : "text-primary")} data-testid={`value-${m.key}`}>{m.value}</div>
      {ratio && <div className="text-[13px] text-muted-foreground">{ratio} ({m.numerator}/{m.denominator})</div>}
      <button data-testid={`button-metric-details-${m.key}`} onClick={() => setOpen((v) => !v)} className={cn(btn.quiet, "-ml-3 mt-1")}><ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} /> How it is measured</button>
      {open && <p className="reveal text-[13.5px] leading-relaxed" data-testid={`definition-${m.key}`}>{m.definition}</p>}
    </div>
  );
}

const KIND_LABEL: Record<QueueItem["kind"], string> = {
  consolidation_approval: "Awaiting IT approval",
  unowned_product: "No owner or support",
  migration_pending: "Migration not recorded",
  new_family_request: "New solution family requested",
  registered_prototype: "Prototype registered",
};

function QueueRow({ item, open, settled, onToggle }: { item: QueueItem; open: boolean; settled: boolean; onToggle: () => void }) {
  const inline = !!item.caseId && item.kind !== "new_family_request";
  const href = item.kind === "new_family_request" && item.caseId ? `/workbench/${item.caseId}?mode=compare` : item.solutionId ? `/solutions/${item.solutionId}` : "/library";
  return (
    <li className={cn("rounded-xl border bg-card transition-[border-color]", open ? "border-primary" : "border-border")} data-testid={`queue-${item.id}`}>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-primary">{item.title}</span>
            <Tag tone={item.kind === "consolidation_approval" && !item.id.startsWith("record-") && !settled ? "sienna" : "muted"}>{item.id.startsWith("record-") ? "Record" : settled ? "Decided" : KIND_LABEL[item.kind]}</Tag>
            {item.demo && <Tag tone="sienna">demo data</Tag>}
          </div>
          <p className="mt-0.5 text-[13.5px]">{item.detail}</p>
          {item.usage && <p className="text-[12.5px] text-muted-foreground">{item.usage}</p>}
        </div>
        {inline ? (
          <button data-testid={`button-queue-action-${item.id}`} onClick={onToggle} className={open ? btn.secondary : btn.primary} aria-expanded={open}>
            {open ? <><X className="h-4 w-4" /> Close</> : item.actionLabel}
          </button>
        ) : (
          <Link href={href} data-testid={`button-queue-action-${item.id}`} className={btn.primary}>{item.actionLabel} <ArrowRight className="h-4 w-4" /></Link>
        )}
      </div>
      {open && item.caseId && (
        <div className="reveal border-t border-border p-4" data-testid={`queue-detail-${item.id}`}>
          <Consolidation caseId={item.caseId} initialSelection={item.kind === "migration_pending" ? item.solutionId : null} />
        </div>
      )}
    </li>
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
