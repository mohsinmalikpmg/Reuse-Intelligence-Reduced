import { useDeferredValue, useState } from "react";
import { Search } from "lucide-react";
import { useListBusinessProblems, useListCapabilities, useListSolutions, type SolutionStatus } from "@workspace/api-client-react";
import { SolutionCard } from "@/components/blocks";
import { EmptyState, ErrorState, PageHeader, Skel } from "@/components/kit";
import { solutionStatus } from "@/lib/labels";
import { cn } from "@/lib/utils";

export default function Library() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<SolutionStatus | undefined>();
  const [problem, setProblem] = useState<string | null>(null);
  const dq = useDeferredValue(q);
  const list = useListSolutions({ q: dq || undefined, status });
  const caps = useListCapabilities();
  const problems = useListBusinessProblems();
  const shown = list.data?.filter((s) => !problem || s.businessProblemIds.includes(problem));

  return (
    <div>
      <PageHeader
        eyebrow="Solution library"
        title="Everything already built, ordered by maturity."
        sub={list.data && caps.data ? `${list.data.length} solutions · ${caps.data.length} reusable capabilities. Certified products first.` : "Certified products first."}
      />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <label className="flex flex-1 items-center gap-2 rounded-md border-2 bg-card px-3 py-2 focus-within:border-foreground">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by outcome, team or workflow" data-testid="input-library-search" className="flex-1 bg-transparent text-sm outline-none" />
        </label>
        <div className="flex flex-wrap gap-1">
          {([undefined, "certified", "pilot", "experimental", "deprecated"] as const).map((s) => (
            <button key={s ?? "all"} onClick={() => setStatus(s)} data-testid={`button-status-${s ?? "all"}`} className={cn("rounded border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors", status === s ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted")}>
              {s ? solutionStatus[s][0] : "All"}
            </button>
          ))}
        </div>
      </div>
      {problems.data && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          <span className="eyebrow mr-1 self-center">Problem</span>
          {problems.data.map((p) => (
            <button key={p.id} onClick={() => setProblem(problem === p.id ? null : p.id)} data-testid={`button-problem-${p.id}`} className={cn("rounded-full border px-2.5 py-0.5 text-xs", problem === p.id ? "border-primary bg-accent text-accent-foreground" : "bg-card text-muted-foreground hover:text-foreground")}>
              {p.title}
            </button>
          ))}
        </div>
      )}
      {list.isError && <ErrorState onRetry={() => list.refetch()} />}
      {list.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skel key={i} className="h-48" />)}</div>
      ) : shown?.length === 0 ? (
        <EmptyState icon={<Search className="h-5 w-5" />} title="Nothing matches that search" body="Try a broader outcome, or clear the status filter." action={<button className="text-sm font-medium text-primary" onClick={() => { setQ(""); setStatus(undefined); setProblem(null); }}>Clear filters</button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{shown?.map((s, i) => <SolutionCard key={s.id} s={s} i={i} />)}</div>
      )}
    </div>
  );
}
