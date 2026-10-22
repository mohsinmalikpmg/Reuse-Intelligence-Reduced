import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { useListCapabilities, useListSolutionFamilies, useListSolutions } from "@workspace/api-client-react";
import { Empty, ErrorView, Headline, Page, Skel, btn } from "@/components/bits";
import { buildEntries, capabilityMatch, readinessOf, type Entry } from "./seeker-library-model";
import { SeekerCard } from "./seeker-library-card";
import { SeekerCompare } from "./seeker-library-compare";

const PER_PAGE = 3;
const SEEKER_PER_PAGE = 6;
const MAX_PICK = 3;
const selectCls = "h-11 min-w-0 rounded-xl border border-input bg-card px-3 text-[14.5px] outline-none focus:border-primary";

/** Seeker library: start from the need, filter by problem, capability and readiness, compare up to three. */
export function SeekerLibrary() {
  const families = useListSolutionFamilies();
  const sols = useListSolutions();
  const caps = useListCapabilities();
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [problem, setProblem] = useState("");
  const [cap, setCap] = useState("");
  const [ready, setReady] = useState("");
  const [page, setPage] = useState(0);
  const [pickedIds, setPickedIds] = useState<string[]>([]);

  const all = useMemo(() => buildEntries(families.data ?? [], sols.data ?? [], caps.data ?? []), [families.data, sols.data, caps.data]);
  const picked = useMemo(() => pickedIds.map((id) => all.find((e) => e.s.id === id)).filter((e): e is Entry => !!e), [pickedIds, all]);
  const functions = useMemo(() => [...new Set(all.map((e) => e.s.businessFunction))].sort(), [all]);
  const capOptions = useMemo(() => [...(caps.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [caps.data]);
  const items = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((e) =>
      words.every((w) => e.text.includes(w)) &&
      (!problem || e.s.businessFunction === problem) &&
      (!cap || capabilityMatch(e, cap) !== null) &&
      (!ready || readinessOf(e.s) === ready));
  }, [all, q, problem, cap, ready]);
  const pages = Math.max(1, Math.ceil(items.length / SEEKER_PER_PAGE));
  const cur = Math.min(page, pages - 1);
  const shown = items.slice(cur * SEEKER_PER_PAGE, cur * SEEKER_PER_PAGE + SEEKER_PER_PAGE);
  const filtered = !!(q || problem || cap || ready);
  const reset = () => { setQ(""); setDraft(""); setProblem(""); setCap(""); setReady(""); setPage(0); };
  const toggle = (id: string) => setPickedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_PICK ? p : [...p, id]);

  const loading = families.isLoading || sols.isLoading || caps.isLoading;
  if (families.isError || sols.isError || caps.isError)
    return <ErrorView onRetry={() => { families.refetch(); sols.refetch(); caps.refetch(); }} message="The library could not load." />;
  return (
    <Page>
      <Headline stage="trace" title="What do you" accent="need to get done?" sub="Search by keywords, or narrow by business function, capability and readiness. Pick up to three to compare." />
      <form role="search" className="relative mt-6 flex max-w-3xl gap-2" onSubmit={(e) => { e.preventDefault(); setQ(draft.trim()); setPage(0); }}>
        <label htmlFor="library-search" className="sr-only">Keyword search: every word must appear in the problem, solution or capability text</label>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input id="library-search" data-testid="input-library-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Keywords, e.g. equipment failures work orders"
          className="h-14 min-w-0 flex-1 rounded-xl border border-input bg-card pl-12 pr-4 text-[16.5px] outline-none focus:border-primary" />
        <button type="submit" className={btn.primary} data-testid="button-library-search">Search keywords</button>
      </form>

      <div className="mt-4 grid max-w-4xl gap-2 sm:grid-cols-3" aria-label="Filters">
        <label className="grid gap-1 text-[12.5px] font-medium text-muted-foreground">Business function
          <select className={selectCls} value={problem} onChange={(e) => { setProblem(e.target.value); setPage(0); }} data-testid="select-function">
            <option value="">All functions</option>
            {functions.map((fn) => <option key={fn} value={fn}>{fn}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[12.5px] font-medium text-muted-foreground">Capability · coverage or reuse
          <select className={selectCls} value={cap} onChange={(e) => { setCap(e.target.value); setPage(0); }} data-testid="select-capability">
            <option value="">Any capability</option>
            {capOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[12.5px] font-medium text-muted-foreground">Readiness
          <select className={selectCls} value={ready} onChange={(e) => { setReady(e.target.value); setPage(0); }} data-testid="select-readiness">
            <option value="">Any</option>
            <option value="live">Runs on your input</option>
            <option value="preview">Preview only</option>
          </select>
        </label>
      </div>
      {filtered && <button className={`${btn.quiet} mt-2`} onClick={reset} data-testid="button-clear-filters">Clear search and filters{q ? ` ("${q}")` : ""}</button>}

      <div className="mt-6 max-w-5xl">
        {loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">{[0, 1, 2, 3, 4, 5].map((i) => <Skel key={i} className="h-56" />)}</div>
          : items.length === 0 ? (
            <Empty title={filtered ? "Nothing in the library matches these choices" : "The library is empty"} sub="Try fewer filters, or describe the need and we will check what can be reused.">
              {filtered && <button className={btn.secondary} onClick={reset}>Clear filters</button>}
              <Link href="/discover" className={btn.primary}>Describe my need <ArrowRight className="h-4 w-4" /></Link>
            </Empty>
          ) : <>
            <p className="mb-3 text-[13.5px] text-muted-foreground" aria-live="polite">{items.length} {items.length === 1 ? "option" : "options"} · {pickedIds.length} of {MAX_PICK} picked to compare</p>
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="library-cards">
              {shown.map((e) => <SeekerCard key={e.key} e={e} matchedCapability={capOptions.find((c) => c.id === cap)?.name} matchLabel={cap ? capabilityMatch(e, cap) : null} selected={pickedIds.includes(e.s.id)} canSelect={pickedIds.length < MAX_PICK} onToggle={() => toggle(e.s.id)} />)}
            </ul>
            {pages > 1 && (
              <nav aria-label="Pagination" className="mt-6 flex items-center gap-3">
                <button className={btn.secondary} disabled={cur === 0} onClick={() => setPage(cur - 1)} data-testid="button-page-prev"><ArrowLeft className="h-4 w-4" /> Previous</button>
                <span className="text-[14px] text-muted-foreground">Page {cur + 1} of {pages}</span>
                <button className={btn.secondary} disabled={cur + 1 >= pages} onClick={() => setPage(cur + 1)} data-testid="button-page-next">Next <ArrowRight className="h-4 w-4" /></button>
              </nav>
            )}
          </>}
        <SeekerCompare picked={picked} onRemove={(id) => setPickedIds((p) => p.filter((x) => x !== id))} onClear={() => setPickedIds([])} />
        {!loading && <p className="mt-8 text-[14px] text-muted-foreground">Not quite it? <Link href="/discover" className="font-semibold text-primary underline-offset-2 hover:underline">Describe your need</Link> and we will compare what exists.</p>}
      </div>
    </Page>
  );
}


/** IT Owner library entry: what needs attention first, the full catalog on request. */
export function ITLibrary({ onBrowse }: { onBrowse: () => void }) {
  const sols = useListSolutions();
  const items = useMemo(() => {
    const out: { id: string; title: string; why: string }[] = [];
    for (const s of sols.data ?? []) {
      const draft = s.versions.find((v) => v.state === "draft");
      if (draft) out.push({ id: s.id, title: s.name, why: `Draft v${draft.version} is waiting for your review.` });
      else if (s.origin && s.ownerName === "Unassigned") out.push({ id: s.id, title: s.name, why: "Registered prototype with no owner yet." });
      else if (s.status === "deprecated" && s.activeUsers > 0) out.push({ id: s.id, title: s.name, why: `Deprecated but still used by ${s.activeUsers} people.` });
    }
    return out;
  }, [sols.data]);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  if (sols.isError) return <ErrorView onRetry={() => sols.refetch()} message="The library could not load." />;
  return (
    <Page>
      <Headline stage="trace" title="What needs" accent="your attention." sub="Library records that are waiting on an IT decision. Code packages, uploads and versions are on each record." />
      <div className="mt-6 max-w-3xl">
        {sols.isLoading ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skel key={i} className="h-20" />)}</div>
          : items.length === 0 ? <Empty title="Nothing in the library is waiting on you" sub="Drafts, ownerless prototypes and deprecated products still in use appear here." />
          : <ul className="space-y-3" data-testid="it-attention">
            {items.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE).map((x) => (
              <li key={x.id + x.why} className="card-soft flex flex-wrap items-center gap-3 p-4">
                <span className="min-w-0 flex-1"><span className="block text-[16px] font-semibold text-primary">{x.title}</span><span className="text-[14px] text-muted-foreground">{x.why}</span></span>
                <Link href={`/solutions/${x.id}`} className={btn.secondary} data-testid={`link-attention-${x.id}`}>Review</Link>
              </li>
            ))}
          </ul>}
        {pages > 1 && <div className="mt-4 flex items-center gap-3"><button className={btn.quiet} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span className="text-[14px] text-muted-foreground">Page {page + 1} of {pages}</span><button className={btn.quiet} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button></div>}
        <div className="mt-8 flex flex-wrap gap-2">
          <button className={btn.primary} onClick={onBrowse} data-testid="button-browse-catalog">Browse the full catalog <ArrowRight className="h-5 w-5" /></button>
          <Link href="/portfolio/review" className={btn.quiet}>Open the decision queue</Link>
        </div>
      </div>
    </Page>
  );
}
