import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, LayoutGrid, Lock, Network, Search, SlidersHorizontal, X } from "lucide-react";
import { useListBusinessProblems, useListCapabilities, useListSolutionFamilies, useListSolutions, type Capability, type Solution, type SolutionFamily, type SolutionStatus } from "@workspace/api-client-react";
import { DispositionBadge, Drawer, Empty, ErrorView, Headline, Page, Skel, StatusPill, Tag, btn } from "@/components/bits";
import { FamilyCard } from "@/components/family-card";
import { LibrarySchematic, type SchematicFilter } from "@/components/library-schematic";
import { EnterpriseSchematic } from "@/components/enterprise-schematic";
import { CapabilitySchematic, ProblemSchematic } from "@/components/catalog-schematic";
import { ExecutionTag, functionRank } from "@/components/enterprise";
import { cn } from "@/lib/utils";
import { useRole } from "@/lib/persona";
import { ITLibrary, SeekerLibrary } from "@/components/library-simple";

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
const TABS = [
  { k: "families", label: "By problem" },
  { k: "all", label: "All solutions" },
] as const;

/** The Library opens on the schematic (Trace); the Cards choice is remembered per browser. */
const VIEW_KEY = "reuse-workbench.library.view";
function readView(): "cards" | "schematic" {
  try { return localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "schematic"; } catch { return "schematic"; }
}

/** Plain text a family can be found by: its problem, its products, approved configurations and reusable capabilities. */
function familyText(f: SolutionFamily): string {
  return [
    f.businessProblem.title, f.businessProblem.description, f.businessProblem.businessFunction, f.businessProblem.primaryUser,
    f.preferred.name, f.preferred.outputType, f.preferred.workflowType, f.preferred.outcome, f.preferred.ownerName,
    ...f.covers.map((c) => c.name),
    ...f.approvedConfigurations.flatMap((c) => [c.title, ...c.changes]),
    ...f.reusableCapabilities.flatMap((c) => [c.capability.name, c.sourceSolutionName]),
    ...f.alternatives.map((s) => s.name), ...f.consolidating.map((s) => s.name),
  ].join(" ").toLowerCase();
}

export default function Library() {
  const isIT = useRole() === "it";
  const [full, setFull] = useState(false);
  if (!isIT) return <SeekerLibrary />;
  if (!full) return <ITLibrary onBrowse={() => setFull(true)} />;
  return <FullLibrary onBack={() => setFull(false)} />;
}

function FullLibrary({ onBack }: { onBack: () => void }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["k"]>("families");
  const families = useListSolutionFamilies();
  const [chip, setChip] = useState<(typeof CHIPS)[number]["k"]>("all");
  const [view, setViewState] = useState<"cards" | "schematic">(readView);
  const setView = (v: "cards" | "schematic") => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* session only */ } };
  const [schematicFilter, setSchematicFilter] = useState<SchematicFilter>("all");
  const [problemId, setProblemId] = useState<string>("");
  const [fnChip, setFnChip] = useState<string>("");
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
      fn: uniq(s.map((x) => x.businessFunction)).sort((a, b) => functionRank(a) - functionRank(b)), step: uniq(s.flatMap((x) => x.workflowSteps)), owner: uniq(s.map((x) => x.ownerName)),
      data: uniq(s.flatMap((x) => x.dependencies)),
    };
  }, [all.data]);

  const prototypes = useMemo(() => (all.data ?? []).filter((x) => !!x.origin), [all.data]);
  const list = useMemo(() => {
    let s: Solution[] = [...(sols.data ?? [])];
    if (chip === "full") s = s.filter((x) => x.kind !== "capability_module");
    if (chip === "cap") s = s.filter((x) => x.kind === "capability_module");
    if (chip === "certified") s = s.filter((x) => x.status === "certified");
    if (f.fn) s = s.filter((x) => x.businessFunction === f.fn);
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
  /** Individual reusable capabilities (not products tagged as modules), narrowed by the same search and filters. */
  const capList = useMemo(() => {
    const sols = all.data ?? [];
    const usersOf = (c: Capability) => sols.filter((x) => x.capabilityIds.includes(c.id));
    const source = (c: Capability) => sols.find((x) => x.id === c.sourceSolutionId);
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let cs = (caps.data ?? []).map((c) => ({ c, users: usersOf(c), src: source(c) }));
    if (words.length) cs = cs.filter(({ c }) => { const t = [c.name, c.description, c.category, c.workflowStep, c.sourceSolutionName, c.ownerName].join(" ").toLowerCase(); return words.every((w) => t.includes(w)); });
    if (f.fn) cs = cs.filter(({ users }) => users.some((x) => x.businessFunction === f.fn));
    if (f.problem) cs = cs.filter(({ users }) => users.some((x) => x.businessProblemIds.includes(f.problem)));
    if (f.step) cs = cs.filter(({ c }) => c.workflowStep === f.step);
    if (f.status) cs = cs.filter(({ src }) => src?.status === f.status);
    if (f.owner) cs = cs.filter(({ c }) => c.ownerName === f.owner);
    if (f.capability) cs = cs.filter(({ c }) => c.id === f.capability);
    if (f.data) cs = cs.filter(({ src }) => src?.dependencies.includes(f.data));
    if (sort === "recommended" || sort === "used") cs.sort((a, b) => b.users.length - a.users.length);
    if (sort === "recent") cs.sort((a, b) => String(b.c.version).localeCompare(String(a.c.version), undefined, { numeric: true }));
    if (sort === "certified") cs.sort((a, b) => RANK[a.src?.status ?? "experimental"] - RANK[b.src?.status ?? "experimental"]);
    return cs;
  }, [caps.data, all.data, q, f, sort]);
  const capMode = chip === "cap";
  const resultCount = capMode ? capList.length : list.length;
  const active = Object.values(f).filter(Boolean).length;
  const pTitle = (id: string) => problems.data?.find((p) => p.id === id)?.title;

  const functions = useMemo(() => [...new Set((families.data ?? []).map((f) => f.businessProblem.businessFunction))].sort((a, b) => functionRank(a) - functionRank(b)), [families.data]);
  const shownFamilies = useMemo(() => {
    let list = [...(families.data ?? [])].sort((a, b) => functionRank(a.businessProblem.businessFunction) - functionRank(b.businessProblem.businessFunction));
    if (fnChip) list = list.filter((f) => f.businessProblem.businessFunction === fnChip);
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return list;
    return list.filter((f) => { const t = familyText(f); return words.every((w) => t.includes(w)); });
  }, [families.data, q, fnChip]);
  /** Cards grouped under a heading per business function, in enterprise order. */
  const grouped = useMemo(() => {
    const by = new Map<string, SolutionFamily[]>();
    for (const f of shownFamilies) by.set(f.businessProblem.businessFunction, [...(by.get(f.businessProblem.businessFunction) ?? []), f]);
    return [...by.entries()];
  }, [shownFamilies]);

  if (sols.isError || families.isError) return <ErrorView onRetry={() => { sols.refetch(); families.refetch(); }} message="The library could not load." />;

  return (
    <Page>
      <button className={btn.quiet} onClick={onBack} data-testid="button-back-attention">Back to what needs attention</button>
      <Headline stage="trace" title="Explore what" accent="already exists." className="mb-0" sub="Every business function, the product to use for each problem, and the capabilities that can be reused around it." />
      <div className="relative mt-6 max-w-3xl">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input data-testid="input-library-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by problem, solution name, capability or owner"
          className="h-14 w-full rounded-xl border border-input bg-card pl-12 pr-4 text-[16.5px] outline-none transition-colors focus:border-primary" />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-input bg-card p-0.5" role="tablist" aria-label="Library view">
          {TABS.map((t) => (
            <button key={t.k} role="tab" aria-selected={tab === t.k} data-testid={`tab-${t.k}`} onClick={() => setTab(t.k)} className={cn("inline-flex min-h-10 items-center rounded-lg px-4 text-[14.5px] font-semibold", tab === t.k ? "bg-secondary text-primary" : "text-muted-foreground hover:text-foreground")}>{t.label}</button>
          ))}
        </div>
        <div className="flex rounded-xl border border-input bg-card p-0.5" role="radiogroup" aria-label="How to show the records">
            {([["schematic", Network, "Schematic"], ["cards", LayoutGrid, "Cards"]] as const).map(([k, I, l]) => (
              <button key={k} role="radio" aria-checked={view === k} data-testid={`button-view-${k}`} onClick={() => setView(k)} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-[14px] font-medium", view === k ? "bg-secondary text-primary" : "text-muted-foreground hover:text-foreground")}><I className="h-4 w-4" />{l}</button>
            ))}
        </div>
        {tab === "families" && view === "cards" && <span className="text-[13.5px] text-muted-foreground" data-testid="text-families-hint">One card per business problem, grouped by business function: the solution to use, what IT approved on top of it, and what can be reused around it.</span>}
        {tab === "families" && view === "schematic" && <span className="text-[13.5px] text-muted-foreground" data-testid="text-schematic-hint">Follow the current: every business function first, then one problem, the solutions that address it and the capabilities that can be reused around it.</span>}
        {tab === "all" && view === "schematic" && <span className="text-[13.5px] text-muted-foreground" data-testid="text-catalog-schematic-hint">{capMode ? "Each capability, wired to every product that uses it. The category, search and filters above decide what is drawn." : "Each business problem, wired to the products that address it. The category, search and filters above decide what is drawn."}</span>}
      </div>
      {tab === "families" && functions.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Business function" data-testid="function-chips">
          {["", ...functions].map((fn) => (
            <button key={fn || "all"} role="radio" aria-checked={fnChip === fn} data-testid={`chip-function-${fn || "all"}`} onClick={() => { setFnChip(fn); if (view === "schematic") setProblemId(""); }}
              className={cn("min-h-9 rounded-full border px-3.5 text-[14px] font-medium transition-colors", fnChip === fn ? "border-primary bg-primary text-white" : "border-input bg-card text-foreground hover:border-primary/50")}>
              {fn || "All functions"}
            </button>
          ))}
        </div>
      )}

      {tab === "families" ? (
        <div className={cn("mt-6 space-y-5", view === "cards" && "max-w-5xl")} data-testid="view-families">
          {families.isLoading ? [0, 1, 2].map((i) => <Skel key={i} className="h-72" />) :
            shownFamilies.length === 0 ? (
              <Empty title={q.trim() ? `No business problem matches "${q.trim()}"` : "No business problems yet"} sub="Try plainer words, or search every record.">
                {q.trim() && <Link href={`/search?q=${encodeURIComponent(q.trim())}`} className={btn.secondary} data-testid="link-search-everything">Search everything <ArrowRight className="h-4 w-4" /></Link>}
              </Empty>
            ) : view === "schematic" ? (
              <SchematicPane families={shownFamilies} problemId={problemId} onProblem={setProblemId} filter={schematicFilter} onFilter={setSchematicFilter} q={q} />
            ) : (
              <>
                <div className="text-[13.5px] text-muted-foreground" data-testid="text-family-count">{shownFamilies.length} business problem{shownFamilies.length === 1 ? "" : "s"} across {grouped.length} business function{grouped.length === 1 ? "" : "s"}</div>
                {grouped.map(([fn, fams]) => (
                  <section key={fn} data-testid={`function-group-${fn}`} className="space-y-4">
                    <h2 className="flex items-center gap-3 pt-2 text-[15px] font-bold uppercase tracking-[0.08em] text-primary"><span className="h-2 w-2 rounded-full bg-primary" />{fn}<span className="h-px flex-1 bg-border" /><span className="text-[12.5px] font-semibold normal-case tracking-normal text-muted-foreground">{fams.length} problem{fams.length === 1 ? "" : "s"}</span></h2>
                    {fams.map((f) => <FamilyCard key={f.businessProblem.id} family={f} />)}
                  </section>
                ))}
              </>
            )}
            {prototypes.length > 0 && (
              <section data-testid="group-prototypes" className="space-y-3">
                <h2 className="flex items-center gap-3 pt-2 text-[15px] font-bold uppercase tracking-[0.08em] text-primary"><span className="h-2 w-2 rounded-full bg-siennaink" />Registered prototypes<span className="h-px flex-1 bg-border" /><span className="text-[12.5px] font-semibold normal-case tracking-normal text-muted-foreground">{prototypes.length} · built outside FUSEBOX, not run here</span></h2>
                <ul className="grid gap-2 md:grid-cols-2">
                  {prototypes.map((p) => (
                    <li key={p.id}>
                      <Link href={`/solutions/${p.id}`} data-testid={`prototype-card-${p.id}`} className="card-soft flex h-full flex-col p-4 transition-[border-color] hover:border-primary/50">
                        <div className="flex flex-wrap items-center gap-2"><span className="text-[16px] font-semibold text-primary">{p.name}</span><ExecutionTag s={p} /></div>
                        <p className="mt-1 text-[14px]">{p.outcome}</p>
                        <span className="mt-2 text-[12.5px] text-muted-foreground">{p.ownerName === "Unassigned" ? "No owner yet" : `Owner ${p.ownerName}`}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
        </div>
      ) : (
      <>
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
        {sols.isLoading || (capMode && (caps.isLoading || all.isLoading)) ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skel key={i} className="h-52" />)}</div>
        ) : resultCount === 0 ? (
          <Empty title="Nothing matches those filters" sub="Loosen a filter or try a plainer description of the problem."><button className={btn.secondary} onClick={() => { setF(NONE); setChip("all"); setQ(""); }}>Clear everything</button></Empty>
        ) : capMode ? (
          <>
            <div className="mb-3 text-[13.5px] text-muted-foreground" data-testid="text-result-count">{capList.length} reusable capabilit{capList.length === 1 ? "y" : "ies"} · {capList.filter((x) => x.users.length > 1).length} used by more than one product</div>
            {view === "schematic" ? <CapabilitySchematic capabilities={capList.map((x) => x.c)} solutions={all.data ?? []} /> : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {capList.map(({ c, users }) => (
                  <Link key={c.id} href={`/solutions/${c.sourceSolutionId}`} data-testid={`card-capability-${c.id}`} className="card-soft group flex flex-col p-5 transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md">
                    <div className="flex items-start gap-2">
                      <h3 className="min-w-0 flex-1 text-[17px] font-semibold leading-snug">{c.name}</h3>
                      <Tag tone={c.controlType === "locked" ? "slate" : c.controlType === "configurable" ? "sky" : "muted"}>{c.controlType === "locked" ? <><Lock className="h-3 w-3" /> Locked</> : c.controlType === "configurable" ? "Configurable" : "Optional"}</Tag>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5"><Tag tone="slate">{c.workflowStep} step</Tag><Tag>{c.category}</Tag><Tag tone={users.length > 1 ? "green" : "muted"} testid={`text-cap-users-${c.id}`}>{users.length > 1 ? `Reused by ${users.length} products` : users.length === 1 ? "Used in 1 product" : "Not in any product"}</Tag></div>
                    <p className="mt-2.5 text-[14.5px] leading-snug">{c.description}</p>
                    <p className="mt-2 text-[13px] text-muted-foreground">{users.filter((u) => u.id !== c.sourceSolutionId).map((u) => u.name).slice(0, 3).join(", ")}{users.filter((u) => u.id !== c.sourceSolutionId).length > 3 ? ` and ${users.filter((u) => u.id !== c.sourceSolutionId).length - 3} more` : ""}</p>
                    <div className="mt-auto flex items-center justify-between pt-4 text-[13px] text-muted-foreground">
                      <span>From {c.sourceSolutionName} · {c.ownerName}</span>
                      <span className="inline-flex items-center gap-1 font-semibold text-primary group-hover:gap-2 transition-[gap]">Open <ArrowRight className="h-4 w-4" /></span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-3 text-[13.5px] text-muted-foreground" data-testid="text-result-count">{list.length} record{list.length === 1 ? "" : "s"}</div>
            {view === "schematic" ? <ProblemSchematic solutions={list} problems={problems.data ?? []} /> : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {list.map((s) => (
                <Link key={s.id} href={`/solutions/${s.id}`} data-testid={`card-solution-${s.id}`} className="card-soft group flex flex-col p-5 transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md">
                  <div className="flex items-start gap-2">
                    <h3 className="min-w-0 flex-1 text-[17px] font-semibold leading-snug">{s.name}</h3>
                    <StatusPill status={s.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5"><Tag tone="slate">{s.businessFunction}</Tag><Tag tone={s.kind === "capability_module" ? "sky" : "muted"}>{s.kind === "capability_module" ? "Reusable capability" : s.outputType}</Tag><ExecutionTag s={s} /><DispositionBadge disposition={s.disposition} solutionId={s.id} /></div>
                  <p className="mt-2.5 text-[14.5px] leading-snug">{s.outcome}</p>
                  <p className="mt-2 text-[13px] text-muted-foreground">{s.businessProblemIds.map(pTitle).filter(Boolean)[0] ?? ""}</p>
                  <div className="mt-auto flex items-center justify-between pt-4 text-[13px] text-muted-foreground">
                    <span>{s.ownerName} · v{s.currentVersion}</span>
                    <span className="inline-flex items-center gap-1 font-semibold text-primary group-hover:gap-2 transition-[gap]">Open <ArrowRight className="h-4 w-4" /></span>
                  </div>
                </Link>
              ))}
            </div>
            )}
          </>
        )}
      </div>
      </>
      )}

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Filters" sub="Narrow the library. Search, cards and the schematic all use the same records." testid="drawer-filters">
        <FSelect label="Business function" v={f.fn} on={(v) => setF({ ...f, fn: v })} opts={opts.fn.map((x) => [x, x])} id="fn" />
        <FSelect label="Business problem" v={f.problem} on={(v) => setF({ ...f, problem: v })} opts={(problems.data ?? []).map((p) => [p.id, p.title])} id="problem" />
        <FSelect label="Workflow step" v={f.step} on={(v) => setF({ ...f, step: v })} opts={opts.step.map((x) => [x, x])} id="step" />
        <FSelect label="Status" v={f.status} on={(v) => setF({ ...f, status: v })} opts={["certified", "pilot", "experimental", "deprecated"].map((x) => [x, x[0].toUpperCase() + x.slice(1)])} id="status" />
        <FSelect label="Owner" v={f.owner} on={(v) => setF({ ...f, owner: v })} opts={opts.owner.map((x) => [x, x])} id="owner" />
        <FSelect label="Capability" v={f.capability} on={(v) => setF({ ...f, capability: v })} opts={(caps.data ?? []).map((c) => [c.id, c.name])} id="capability" />
        <FSelect label="Data sources" v={f.data} on={(v) => setF({ ...f, data: v })} opts={opts.data.map((x) => [x, x])} id="data" />
        <div className="flex gap-2"><button className={btn.primary} onClick={() => setDrawer(false)} data-testid="button-apply-filters">Show {resultCount} result{resultCount === 1 ? "" : "s"}</button><button className={btn.quiet} onClick={() => setF(NONE)}>Clear</button></div>
      </Drawer>
    </Page>
  );
}

/**
 * Schematic: the entire enterprise first (every function and the product to use for each problem), then one business
 * problem at a time. The selector follows the search and the function chips, so a query narrows the choices.
 */
function SchematicPane({ families, problemId, onProblem, filter, onFilter, q }: { families: SolutionFamily[]; problemId: string; onProblem: (id: string) => void; filter: SchematicFilter; onFilter: (f: SchematicFilter) => void; q: string }) {
  const current = families.find((f) => f.businessProblem.id === problemId) ?? null;
  const groups = useMemo(() => {
    const by = new Map<string, SolutionFamily[]>();
    for (const f of families) by.set(f.businessProblem.businessFunction, [...(by.get(f.businessProblem.businessFunction) ?? []), f]);
    return [...by.entries()].sort((a, b) => functionRank(a[0]) - functionRank(b[0]));
  }, [families]);
  if (families.length === 0) return null;
  return (
    <div className="space-y-3">
      <label className="flex flex-wrap items-center gap-3">
        <span className="eyebrow">Trace</span>
        <select data-testid="select-schematic-problem" value={current?.businessProblem.id ?? ""} onChange={(e) => onProblem(e.target.value)} className="h-11 min-w-[260px] rounded-xl border border-input bg-card px-3 text-[15px] font-semibold text-primary">
          <option value="">Entire enterprise</option>
          {groups.map(([fn, fams]) => (
            <optgroup key={fn} label={fn}>
              {fams.map((f) => <option key={f.businessProblem.id} value={f.businessProblem.id}>{f.businessProblem.title}</option>)}
            </optgroup>
          ))}
        </select>
        <span className="text-[13px] text-muted-foreground" data-testid="text-schematic-count">{families.length} business problem{families.length === 1 ? "" : "s"} · {groups.length} function{groups.length === 1 ? "" : "s"}</span>
        {current && <button type="button" onClick={() => onProblem("")} className={cn(btn.quiet, "min-h-9 text-[14px]")} data-testid="button-schematic-enterprise">Back to the entire enterprise</button>}
      </label>
      {current ? <LibrarySchematic family={current} filter={filter} q={q} onFilter={onFilter} /> : <EnterpriseSchematic families={families} onProblem={onProblem} />}
    </div>
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
