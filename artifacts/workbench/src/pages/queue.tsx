import { Inbox } from "lucide-react";
import { useGetDecisionQueue } from "@workspace/api-client-react";
import { CaseRow } from "@/components/blocks";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/kit";

export default function Queue() {
  const q = useGetDecisionQueue();
  return (
    <div>
      <PageHeader eyebrow="IT governance" title="Decision queue" sub="Cases waiting for a consolidation decision. Oldest first." right={q.data && <span className="font-display text-5xl font-extrabold text-primary">{q.data.length}</span>} />
      {q.isError && <ErrorState onRetry={() => q.refetch()} />}
      {q.isLoading && <LoadingRows rows={4} />}
      {q.data?.length === 0 && <EmptyState icon={<Inbox className="h-5 w-5" />} title="Queue is clear" body="Nothing is waiting on IT right now." />}
      <div className="space-y-2">{q.data?.map((c, i) => <CaseRow key={c.case.id} c={c} i={i} href={`/cases/${c.case.id}/review`} />)}</div>
    </div>
  );
}
