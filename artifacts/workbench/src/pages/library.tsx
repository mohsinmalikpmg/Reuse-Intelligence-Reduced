import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, LayoutGrid, Network, Search, SlidersHorizontal, X } from "lucide-react";
import { useListBusinessProblems, useListCapabilities, useListSolutions, type Solution, type SolutionStatus } from "@workspace/api-client-react";
import { DispositionBadge, Drawer, Empty, ErrorView, Page, Skel, StatusPill, Tag, btn } from "@/components/bits";
import { LibraryTree } from "@/components/library-tree";
import { cn } from "@/lib/utils";

type Filters = { fn: string; problem: string; step: string; status: string; owner: string; capability: string; data: string };
const NONE: Filters = { fn: "", problem: "", step: "", status: "", owner: "", capability: "", data: "" };
const CHIPS = [
  { k: "all", label: "Everything" },
  { k: "full", label: "Full workflow solutions" },
  { k: "cap", label: "Reusable capabilities" },
  { k: "certified", label: "Certified" },
] as const;
const SORTS = [
  { k: "recommended", label: "Recommended" },
  { k: "used", label: "Most used" },
  { k: "recent", label: "Recently updated" },
  { k: "certified", label: "Certified first" },
] as const;
const RANK: Record<SolutionStatus, number> = { certified: 0, pilot: 1, experimental: 2, deprecated: 3 };

export default function Library() {
  const [, setLocation] = useLocation();
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<(typeof CHIPS)[number]["k"]>("all");
  const [view, setView] = useState<"grid" | "tree">("grid");
  const [sort, setSort] = useState<(typeof SORTS)[number]["k"]>("recommended");
  const [f, setF] = useState<Filters>(NONE);
  const [drawer, setDrawer] = useState(false);
  const sols = useListSolutions(q.trim() ? { q: q.trim() } : undefined);
  const all = useListSolutions();
  const problems = useListBusinessProblems();
  const caps = useListCapabilities();

  const opts = useMemo(() => {
    const s = all.data ?? [];
    const uniq = (a: string[]) => [...new Set(a)].filter(Boolean).sort();
    return {
      fn: uniq(s.flatMap((x) => x.businessUnits)), step: uniq(s.flatMap((x) => x.workflowSteps)), owner: uniq(s.map((x) => x.ownerName)),
      data: uniq(s.flatMap((x) => x.dependencies)),
    };
  }, [all.data]);

  const list = useMemo(() => {
    let s: Solution[] = [...(sols.data ?? [])];
    if (chip === "full") s = s.filter((x) => x.kind !== "capability_module");
    if (chip === "cap") s = s.filter((x) => x.kind === "capability_module");
    if (chip === "certified") s = s.filter((x) => x.status === "certified");
    if (f.fn) s = s.filter((x) => x.businessUnits.includes(f.fn));
    if (f.problem) s = s.filter((x) => x.businessProblemIds.includes(f.problem));
    if (f.step) s = s.filter((x) => x.workflowSteps.includes(f.step));
    if (f.status) s = s.filter((x) => x.status === f.status);
    if (f.owner) s = s.filter((x) => x.ownerName === f.owner);
    if (f.capability) s = s.filter((x) => x.capabilityIds.includes(f.capability));
    if (f.data) s = s.filter((x) => x.dependencies.includes(f.data));
    if (sort === "used") s.sort((a, b) => b.activeUsers - a.activeUsers);
    if (sort === "recent") s.sort((a, b) => b.lastReviewedAt.localeCompare(a.lastReviewedAt));
    if (sort === "certified") s.sort((a, b) => RANK[a.status] - RANK[b.status]);
    return s;
  }, [sols.data, chip, f, sort]);
  const active = Object.values(f).filter(Boolean).length;
  const pTitle = (id: string) => problems.data?.find((p) => p.id === id)?.title;

  if (sols.isError) return <ErrorView onRetry={() => sols.refetch()} message="The library could not load." />;

  return (
    <Page>
      <h1 data-testid="text-headline" className="text-[32px] font-bold md:text-[40px]">Explore what already exists</h1>
      <div className="relative mt-5 max-w-3xl">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input data-testid="input-library-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by problem, solution name, capability or owner"
          className="h-14 w-full rounded-xl border border-input bg-card pl-12 pr-4 text-[16.5px] outline-none transition-colors focus:border-primary" />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {CHIPS.map((c) => (
          <button key={c.k} data-testid={`chip-${c.k}`} onClick={() => setChip(c.k)} aria-pressed={chip === c.k}
            className={cn("min-h-9 rounded-full border px-3.5 text-[14px] font-medium transition-colors", chip === c.k ? "border-primary bg-primary text-white" : "border-input bg-card text-foreground hover:border-primary/50")}>{c.label}</button>
        ))}
        <div className="flex-1" />
        <button data-testid="button-filters" onClick={() => setDrawer(true)} className={btn.secondary}><SlidersHorizontal className="h-4 w-4" /> Filters{active > 0 && <span className="rounded-full bg-siennaink px-1.5 text-[12px] text-white">{active}</span>}</button>
        <select data-testid="select-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-11 rounded-xl border border-input bg-card px-3 text-[14.5px]">
          {SORTS.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
        </select>
        <div className="flex rounded-xl border border-input bg-card p-0.5" role="radiogroup" aria-label="View">
          {([["grid", LayoutGrid, "Grid"], ["tree", Network, "Tree"]] as const).map(([k, I, l]) => (
            <button key={k} role="radio" aria-checked={view === k} data-testid={`button-view-${k}`} onClick={() => setView(k)} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-[14px] font-medium", view === k ? "bg-secondary text-primary" : "text-muted-foreground hover:text-foreground")}><I className="h-4 w-4" />{l}</button>
          ))}
        </div>
      </div>
      {active > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(f) as (keyof Filters)[]).filter((k) => f[k]).map((k) => (
            <button key={k} onClick={() => setF({ ...f, [k]: "" })} className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[12.5px] font-medium text-accent-foreground">
              {k === "problem" ? pTitle(f[k]) : k === "capability" ? caps.data?.find((c) => c.id === f[k])?.name : f[k]} <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      <div className="mt-6">
        {view === "tree" ? (
          problems.data && all.data && caps.data ? <LibraryTree problems={problems.data} solutions={all.data} capabilities={caps.data} onOpen={(id) => setLocation(`/solutions/${id}`)} /> : <Skel className="h-[600px]" />
        ) : sols.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skel key={i} className="h-52" />)}</div>
        ) : list.length === 0 ? (
          <Empty title="Nothing matches those filters" sub="Loosen a filter or try a plainer description of the problem."><button className={btn.secondary} onClick={() => { setF(NONE); setChip("all"); setQ(""); }}>Clear everything</button></Empty>
        ) : (
          <>
            <div className="mb-3 text-[13.5px] text-muted-foreground" data-testid="text-result-count">{list.length} record{list.length === 1 ? "" : "s"}</div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {list.map((s) => (
                <Link key={s.id} href={`/solutions/${s.id}`} data-testid={`card-solution-${s.id}`} className="card-soft group flex flex-col p-5 transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md">
                  <div className="flex items-start gap-2">
                    <h3 className="min-w-0 flex-1 text-[17px] font-semibold leading-snug">{s.name}</h3>
                    <StatusPill status={s.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5"><Tag tone={s.kind === "capability_module" ? "sky" : "slate"}>{s.kind === "capability_module" ? "Reusable capability" : "Full workflow"}</Tag><DispositionBadge disposition={s.disposition} solutionId={s.id} /></div>
                  <p className="mt-2.5 text-[14.5px] leading-snug">{s.outcome}</p>
                  <p className="mt-2 text-[13px] text-muted-foreground">{s.businessProblemIds.map(pTitle).filter(Boolean)[0] ?? ""}</p>
                  <div className="mt-auto flex items-center justify-between pt-4 text-[13px] text-muted-foreground">
                    <span>{s.ownerName} · v{s.currentVersion}</span>
                    <span className="inline-flex items-center gap-1 font-semibold text-primary group-hover:gap-2 transition-[gap]">Open <ArrowRight className="h-4 w-4" /></span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Filters" sub="Narrow the library. Search, cards and tree all use the same records." testid="drawer-filters">
        <FSelect label="Business function" v={f.fn} on={(v) => setF({ ...f, fn: v })} opts={opts.fn.map((x) => [x, x])} id="fn" />
        <FSelect label="Business problem" v={f.problem} on={(v) => setF({ ...f, problem: v })} opts={(problems.data ?? []).map((p) => [p.id, p.title])} id="problem" />
        <FSelect label="Workflow step" v={f.step} on={(v) => setF({ ...f, step: v })} opts={opts.step.map((x) => [x, x])} id="step" />
        <FSelect label="Status" v={f.status} on={(v) => setF({ ...f, status: v })} opts={["certified", "pilot", "experimental", "deprecated"].map((x) => [x, x[0].toUpperCase() + x.slice(1)])} id="status" />
        <FSelect label="Owner" v={f.owner} on={(v) => setF({ ...f, owner: v })} opts={opts.owner.map((x) => [x, x])} id="owner" />
        <FSelect label="Capability" v={f.capability} on={(v) => setF({ ...f, capability: v })} opts={(caps.data ?? []).map((c) => [c.id, c.name])} id="capability" />
        <FSelect label="Data sources" v={f.data} on={(v) => setF({ ...f, data: v })} opts={opts.data.map((x) => [x, x])} id="data" />
        <div className="flex gap-2"><button className={btn.primary} onClick={() => setDrawer(false)} data-testid="button-apply-filters">Show {list.length} results</button><button className={btn.quiet} onClick={() => setF(NONE)}>Clear</button></div>
      </Drawer>
    </Page>
  );
}

function FSelect({ label, v, on, opts, id }: { label: string; v: string; on: (v: string) => void; opts: (readonly [string, string])[] | string[][]; id: string }) {
  return (
    <label className="block">
      <span className="eyebrow mb-1.5 block">{label}</span>
      <select data-testid={`filter-${id}`} value={v} onChange={(e) => on(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-card px-3 text-[15px]">
        <option value="">Any</option>
        {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );
}
