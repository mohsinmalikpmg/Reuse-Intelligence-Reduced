import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useListPortfolioCapabilities, type CapabilityExplorerEntry } from "@workspace/api-client-react";
import { ErrorView, Headline, Page, Skel } from "@/components/bits";
import { CapabilityCard } from "@/components/portfolio/capability-card";
import { cn } from "@/lib/utils";

type GroupBy = "feature" | "problem" | "implementation";
const GROUPS: { v: GroupBy; label: string }[] = [
  { v: "feature", label: "Feature" }, { v: "problem", label: "Business problem" }, { v: "implementation", label: "Implementation" },
];

function keysFor(c: CapabilityExplorerEntry, g: GroupBy): string[] {
  if (g === "feature") return [c.category ?? "Not assessed"];
  if (g === "problem") return c.businessProblems.length ? c.businessProblems.map((b) => b.name) : ["Not assessed"];
  const i = c.implementation;
  return [i.platform ?? i.architecture ?? "Not assessed"];
}

/** Capability Explorer: read-only; searchable and grouped three ways. */
export default function PortfolioCapabilities() {
  const q = useListPortfolioCapabilities();
  const [term, setTerm] = useState("");
  const [by, setBy] = useState<GroupBy>("feature");
  const groups = useMemo(() => {
    const t = term.trim().toLowerCase();
    const list = (q.data ?? []).filter((c) => !t || [c.name, c.purpose ?? "", c.category ?? "", c.ownerName ?? "", c.provenance, ...c.sourceApps.map((s) => s.name), ...c.businessProblems.map((b) => b.name)].some((x) => x.toLowerCase().includes(t)));
    const m = new Map<string, CapabilityExplorerEntry[]>();
    for (const c of list) for (const k of keysFor(c, by)) m.set(k, [...(m.get(k) ?? []), c]);
    return [...m.entries()].sort(([a], [b]) => (a === "Not assessed" ? 1 : b === "Not assessed" ? -1 : a.localeCompare(b)));
  }, [q.data, term, by]);
  if (q.isError) return <ErrorView onRetry={() => q.refetch()} message="Capabilities could not load." />;
  const total = q.data?.length ?? 0;
  return (
    <Page>
      <Headline stage="converge" eyebrow="Capabilities" title="Every capability, once." accent={q.data ? `${total} in the portfolio.` : undefined}
        sub="Purpose, the apps that carry it, who owns it and whether it is reused. Missing metadata is marked Not assessed, never guessed." />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search capabilities, apps, owners, problems" data-testid="input-capability-search"
            className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-[14px] outline-none focus:border-primary" />
        </label>
        <div role="radiogroup" aria-label="Group by" className="flex rounded-lg bg-secondary p-0.5" data-testid="switch-groupby">
          {GROUPS.map((g) => (
            <button key={g.v} role="radio" aria-checked={by === g.v} onClick={() => setBy(g.v)} data-testid={`button-group-${g.v}`}
              className={cn("min-h-9 rounded-md px-3 text-[13.5px] font-semibold transition-colors", by === g.v ? "bg-primary text-primary-foreground" : "text-primary/80 hover:text-primary")}>{g.label}</button>
          ))}
        </div>
      </div>
      {q.isLoading ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skel key={i} className="h-28" />)}</div>
        : groups.length === 0 ? <p className="rounded-xl border border-dashed border-input px-5 py-6 text-[14.5px] text-muted-foreground" data-testid="capabilities-empty">{total ? `Nothing matches “${term}”.` : "No capabilities are catalogued yet."}</p>
        : groups.map(([name, list]) => (
          <section key={name} className="mb-7" data-testid={`group-${name}`}>
            <h2 className="mb-2 flex items-baseline gap-2 text-[17px] font-semibold">{name}<span className="font-mono text-[12px] font-normal text-muted-foreground">{list.length}</span></h2>
            <ul className="space-y-2">{list.map((c) => <CapabilityCard key={c.id} c={c} />)}</ul>
          </section>
        ))}
    </Page>
  );
}
