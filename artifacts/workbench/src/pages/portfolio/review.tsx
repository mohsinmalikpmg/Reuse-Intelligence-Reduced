import { useState } from "react";
import { useSearch } from "wouter";
import { useGetPortfolio, type QueueItem } from "@workspace/api-client-react";
import { ErrorView, Headline, LoadingView, Page } from "@/components/bits";
import { QueueRow } from "@/components/portfolio/queue-row";

/** Review: only what IT has to decide. All decisions live here; analytics never records one. */
export default function PortfolioReview() {
  const q = useGetPortfolio();
  // A consolidation record opened from a product's version history; it is not a queue item, so it is shown on request only.
  const requested = new URLSearchParams(useSearch()).get("case");
  const [touched, setTouched] = useState<string | null | undefined>(undefined);
  // The row the person is working in stays on the page after their decision resolves it, until they close it.
  const [pinned, setPinned] = useState<QueueItem | null>(null);
  if (q.isLoading) return <LoadingView />;
  if (q.isError || !q.data) return <ErrorView onRetry={() => q.refetch()} message="The review queue could not load." />;
  const p = q.data;
  const record: QueueItem | null = requested && !p.queue.some((i) => i.caseId === requested)
    ? { id: `record-${requested}`, kind: "consolidation_approval", title: "Consolidation record", detail: "Opened from the product's version history. Published decisions can be withdrawn here.", usage: null, actionLabel: "Open record", caseId: requested, solutionId: null, demo: false }
    : null;
  const live = record ? [record, ...p.queue] : p.queue;
  const queue = pinned && !live.some((i) => i.id === pinned.id) ? [pinned, ...live] : live;
  const open = touched === undefined ? (queue.find((i) => i.caseId === requested)?.id ?? null) : touched;
  const setOpen = (id: string | null) => { setTouched(id); setPinned(id ? (queue.find((i) => i.id === id) ?? null) : null); };
  const waiting = p.queue.length;
  return (
    <Page>
      <Headline stage="converge" eyebrow="Review" title="Needs your decision." accent={waiting ? `${waiting} open.` : "Nothing open."}
        sub="Only what IT has to act on: approvals, unowned products, unrecorded migrations, new family requests and registered prototypes. Experiments and seeker activity stay with their owners." />
      {queue.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input px-5 py-6 text-[14.5px] text-muted-foreground" data-testid="queue-empty">Nothing needs an IT decision right now.</p>
      ) : (
        <ol className="space-y-2" data-testid="queue">
          {queue.map((item) => <QueueRow key={item.id} item={item} open={open === item.id} settled={!live.some((i) => i.id === item.id)} onToggle={() => setOpen(open === item.id ? null : item.id)} />)}
        </ol>
      )}
    </Page>
  );
}
