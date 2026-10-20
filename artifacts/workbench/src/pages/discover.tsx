import { Link } from "wouter";
import { FileText } from "lucide-react";
import { useGetDemoState, useListBriefs } from "@workspace/api-client-react";
import { ProblemInput } from "@/components/blocks";
import { EmptyState, LoadingRows, Rise, Tag } from "@/components/kit";
import { date } from "@/lib/labels";

export default function Discover() {
  const demo = useGetDemoState();
  const briefs = useListBriefs();
  return (
    <div className="mx-auto max-w-3xl">
      <div className="eyebrow mb-3 !text-primary">Discover</div>
      <h1 className="mb-2 text-4xl font-extrabold leading-[1] md:text-5xl">What is slowing your team down?</h1>
      <p className="mb-6 text-muted-foreground">Write it the way you would explain it to a colleague. We will confirm what we heard, then rank every existing product against it.</p>
      <ProblemInput demoPrompt={demo.data?.demoPrompt} large />
      <h2 className="mb-3 mt-10 text-lg font-bold">Previous briefs</h2>
      {briefs.isLoading && <LoadingRows rows={3} />}
      {briefs.data?.length === 0 && <EmptyState title="No briefs yet" body="Your first problem statement will show up here." />}
      <div className="space-y-2">
        {briefs.data?.map((b, i) => (
          <Rise key={b.id} i={i}>
            <Link href={`/discover/${b.id}`} data-testid={`link-brief-${b.id}`} className="flex items-start gap-3 rounded-md border bg-card px-4 py-3 hover:border-foreground/40">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm">{b.rawText}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{b.valueStatement}</span>
              </span>
              <span className="flex flex-col items-end gap-1">
                {b.confirmed && <Tag tone="ok">Confirmed</Tag>}
                <span className="font-mono text-[10.5px] text-muted-foreground">{date(b.createdAt)}</span>
              </span>
            </Link>
          </Rise>
        ))}
      </div>
    </div>
  );
}
