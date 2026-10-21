import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { useListSolutionFamilies, useListSolutions, type Solution } from "@workspace/api-client-react";
import { Empty, ErrorView, Headline, Page, Skel, btn } from "@/components/bits";
import { isLive } from "@/components/enterprise";

const PER_PAGE = 3;

/** Seeker library: start from the need, see a few concise options, open one for examples. */
export function SeekerLibrary() {
  const families = useListSolutionFamilies();
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const items = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = (families.data ?? []).map((f) => ({ s: f.preferred, problem: f.businessProblem.title, text: [f.businessProblem.title, f.businessProblem.description, f.preferred.name, f.preferred.outcome, ...f.covers.map((c) => c.name)].join(" ").toLowerCase() }));
    return words.length ? list.filter((x) => words.every((w) => x.text.includes(w))) : list;
  }, [families.data, q]);
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const shown = items.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  if (families.isError) return <ErrorView onRetry={() => families.refetch()} message="The library could not load." />;
  return (
    <Page>
      <Headline stage="trace" title="What do you" accent="need to get done?" sub="Describe it in your own words. We show the few existing solutions that fit." />
      <form className="relative mt-6 flex max-w-3xl gap-2" onSubmit={(e) => { e.preventDefault(); setQ(draft.trim()); setPage(0); }}>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input data-testid="input-library-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="For example: spot repeat equipment failures in work orders"
          className="h-14 min-w-0 flex-1 rounded-xl border border-input bg-card pl-12 pr-4 text-[16.5px] outline-none focus:border-primary" />
        <button type="submit" className={btn.primary} data-testid="button-library-search">Find</button>
      </form>
      {q && <button className={`${btn.quiet} mt-2`} onClick={() => { setQ(""); setDraft(""); setPage(0); }}>Clear "{q}"</button>}

      <div className="mt-8 max-w-4xl">
        {families.isLoading ? <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skel key={i} className="h-40" />)}</div>
          : items.length === 0 ? (
            <Empty title={q ? `Nothing in the library matches "${q}"` : "The library is empty"} sub="Describe the need instead and we will check what can be reused.">
              <Link href="/discover" className={btn.primary}>Describe my need <ArrowRight className="h-4 w-4" /></Link>
            </Empty>
          ) : <>
            <ul className="grid gap-4 md:grid-cols-2" data-testid="library-cards">
              {shown.map(({ s, problem }) => <SolutionCard key={s.id} s={s} problem={problem} />)}
            </ul>
            {pages > 1 && (
              <div className="mt-6 flex items-center gap-3">
                <button className={btn.secondary} disabled={page === 0} onClick={() => setPage(page - 1)} data-testid="button-page-prev"><ArrowLeft className="h-4 w-4" /> Previous</button>
                <span className="text-[14px] text-muted-foreground">Page {page + 1} of {pages}</span>
                <button className={btn.secondary} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} data-testid="button-page-next">Next <ArrowRight className="h-4 w-4" /></button>
              </div>
            )}
            <p className="mt-8 text-[14px] text-muted-foreground">Not quite it? <Link href="/discover" className="font-semibold text-primary underline-offset-2 hover:underline">Describe your need</Link> and we will compare what exists.</p>
          </>}
      </div>
    </Page>
  );
}

function SolutionCard({ s, problem }: { s: Solution; problem: string }) {
  return (
    <li className="card-soft flex flex-col p-5" data-testid={`card-solution-${s.id}`}>
      <span className="text-[12.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{problem}</span>
      <h3 className="mt-1 text-[18px] font-semibold leading-snug text-primary">{s.name}</h3>
      <p className="mt-1.5 line-clamp-2 text-[14.5px]">{s.outcome}</p>
      {!isLive(s) && <p className="mt-2 text-[12.5px] text-siennaink">Preview</p>}
      <Link href={`/solutions/${s.id}`} className={`${btn.secondary} mt-4 self-start`} data-testid={`link-open-${s.id}`}>See an example <ArrowRight className="h-4 w-4" /></Link>
    </li>
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
          <Link href="/portfolio" className={btn.quiet}>Open the decision queue</Link>
        </div>
      </div>
    </Page>
  );
}
