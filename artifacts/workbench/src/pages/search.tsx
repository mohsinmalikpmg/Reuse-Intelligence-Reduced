import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowRight, Search as SearchIcon } from "lucide-react";
import { useListBusinessProblems, useListSolutions, useSearchLibrary, type SolutionKind, type SolutionStatus } from "@workspace/api-client-react";
import { DispositionBadge, Empty, ErrorView, Page, Skel, StatusPill, Tag, StageEyebrow } from "@/components/bits";
import { CapabilityRow } from "@/components/family-card";
import { ExecutionTag } from "@/components/enterprise";

export default function SearchPage() {
  const params = new URLSearchParams(useSearch());
  const q = params.get("q") ?? "";
  const [, setLocation] = useLocation();
  const [draft, setDraft] = useState(q);
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [owner, setOwner] = useState("");
  const [bp, setBp] = useState("");
  const problems = useListBusinessProblems();
  const all = useListSolutions();
  const owners = [...new Set((all.data ?? []).map((s) => s.ownerName))].sort();
  const r = useSearchLibrary({ q, status: (status || undefined) as SolutionStatus | undefined, kind: (kind || undefined) as SolutionKind | undefined, owner: owner || undefined, businessProblemId: bp || undefined });

  const sel = "h-10 rounded-lg border border-input bg-card px-2.5 text-[14px]";
  return (
    <Page>
      <StageEyebrow stage="trace" note="Search every record" className="mb-1" />
      <form onSubmit={(e) => { e.preventDefault(); setLocation(`/search?q=${encodeURIComponent(draft.trim())}`); }} className="relative mt-2 max-w-3xl">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input data-testid="input-search-page" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Try: identify recurring work-order issues"
          className="h-14 w-full rounded-xl border border-input bg-card pl-12 pr-4 text-[17px] outline-none focus:border-primary" />
      </form>
      <div className="mt-4 flex flex-wrap gap-2">
        <select data-testid="filter-status" className={sel} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{["certified", "pilot", "experimental", "deprecated"].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select data-testid="filter-kind" className={sel} value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Any kind</option><option value="complete_solution">Complete solution</option><option value="configurable_product">Configurable product</option><option value="capability_module">Reusable capability</option><option value="prototype">Prototype</option></select>
        <select data-testid="filter-owner" className={sel} value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Any owner</option>{owners.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        <select data-testid="filter-problem" className={sel} value={bp} onChange={(e) => setBp(e.target.value)}><option value="">Any business problem</option>{(problems.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
      </div>

      <div className="mt-8 max-w-4xl">
        {!q ? <Empty title="Type what you are looking for" sub="Problems, solution names, capabilities, workflow tasks and owners all work." /> :
          r.isLoading ? <div className="space-y-3"><Skel className="h-32" /><Skel className="h-32" /></div> :
          r.isError || !r.data ? <ErrorView onRetry={() => r.refetch()} message="Search did not respond." /> :
          r.data.results.length === 0 && r.data.capabilities.length === 0 ? <Empty title={`Nothing found for "${q}"`} sub="Try different words, or remove a filter." /> : (
          <>
            <div className="mb-4 flex items-center gap-2 text-[14px] text-muted-foreground" data-testid="text-search-count">
              {r.data.results.length} solution{r.data.results.length === 1 ? "" : "s"} for "{r.data.query}"
              <Tag>{r.data.source === "hybrid" ? "Keyword + semantic ranking" : "Keyword match"}</Tag>
            </div>
            <ol className="space-y-3">
              {r.data.results.map((x, i) => (
                <li key={x.solution.id} data-testid={`result-${x.solution.id}`} className="card-soft p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12px] text-muted-foreground">{i + 1}</span>
                    <h2 className="text-[18px] font-semibold">{x.solution.name}</h2>
                    <StatusPill status={x.solution.status} />
                    {x.familyRole === "preferred" && <Tag tone="green" testid={`tag-preferred-${x.solution.id}`}>Preferred for {x.familyTitle.toLowerCase()}</Tag>}
                    {x.familyRole === "consolidating" && <Tag tone="muted" testid={`tag-consolidating-${x.solution.id}`}>Being consolidated</Tag>}
                    <DispositionBadge disposition={x.solution.disposition} solutionId={x.solution.id} />
                    {x.solution.origin && <ExecutionTag s={x.solution} testid={`tag-prototype-${x.solution.id}`} />}
                    <span className="ml-auto text-[13px] text-muted-foreground">{x.solution.ownerName} · v{x.solution.currentVersion}</span>
                  </div>
                  <p className="mt-1.5 text-[15px]">{x.solution.outcome}</p>
                  {x.reasons.length > 0 && <ul className="mt-2 space-y-0.5 text-[13.5px] text-muted-foreground">{x.reasons.slice(0, 3).map((r, j) => <li key={j}><span className="text-siennaink">Matched:</span> {r}</li>)}</ul>}
                  {x.matchedCapabilities.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{x.matchedCapabilities.map((c) => <Tag key={c.id} tone="sky">{c.name}</Tag>)}</div>}
                  <Link href={`/solutions/${x.solution.id}`} data-testid={`link-open-${x.solution.id}`} className="mt-3 inline-flex items-center gap-1 text-[14.5px] font-semibold text-primary hover:gap-2 transition-[gap]">Open <ArrowRight className="h-4 w-4" /></Link>
                </li>
              ))}
            </ol>
            {r.data.capabilities.length > 0 && (
              <div className="mt-8">
                <h3 className="mb-2 text-[16px] font-semibold">Reusable capabilities</h3>
                <ul className="divide-y divide-border rounded-xl border border-border bg-card" data-testid="list-search-capabilities">
                  {r.data.capabilities.map((c) => <CapabilityRow key={c.capability.id} item={c} compact />)}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Page>
  );
}
