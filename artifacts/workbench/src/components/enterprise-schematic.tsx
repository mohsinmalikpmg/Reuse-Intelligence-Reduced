import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Eye, Zap } from "lucide-react";
import type { SolutionFamily } from "@workspace/api-client-react";
import { btn } from "@/components/bits";
import { FUNCTION_ORDER, functionRank, isLive } from "@/components/enterprise";
import { cn } from "@/lib/utils";

/**
 * Enterprise overview: every business function as a busbar, the problems on it and the product to use for each.
 * Shared capabilities on the right light up the products that carry them, across functions. Everything is read from
 * the family records; nothing is drawn that the catalogue does not say.
 */

type Shared = { id: string; name: string; sourceSolutionName: string; solutionIds: Set<string>; familyIds: Set<string>; functions: Set<string>; platform: boolean };

/**
 * Capabilities that more than one business problem runs on: what the preferred products cover, plus reusable modules
 * other products carry. Capabilities present in nearly every product are platform controls and are listed last.
 */
function sharedCapabilities(families: SolutionFamily[]): Shared[] {
  const familyOf = new Map<string, string>();
  for (const f of families) for (const s of [f.preferred, ...f.alternatives, ...f.consolidating]) familyOf.set(s.id, f.businessProblem.id);
  const out = new Map<string, Shared>();
  const get = (id: string, name: string, source: string) => {
    const cur = out.get(id) ?? { id, name, sourceSolutionName: source, solutionIds: new Set<string>(), familyIds: new Set<string>(), functions: new Set<string>(), platform: false };
    out.set(id, cur);
    return cur;
  };
  for (const f of families) {
    for (const c of f.covers) { const cur = get(c.capabilityId, c.name, ""); cur.solutionIds.add(f.preferred.id); cur.familyIds.add(f.businessProblem.id); }
    for (const item of f.reusableCapabilities) {
      const cur = get(item.capability.id, item.capability.name, item.sourceSolutionName);
      if (!cur.sourceSolutionName) cur.sourceSolutionName = item.sourceSolutionName;
      for (const u of item.usedIn) { cur.solutionIds.add(u.solutionId); const fid = familyOf.get(u.solutionId); if (fid) cur.familyIds.add(fid); }
    }
  }
  const fnOf = new Map(families.map((f) => [f.businessProblem.id, f.businessProblem.businessFunction]));
  for (const cur of out.values()) {
    for (const fid of cur.familyIds) { const fn = fnOf.get(fid); if (fn) cur.functions.add(fn); }
    cur.platform = families.length >= 4 && cur.familyIds.size >= Math.ceil(families.length * 0.8);
  }
  return [...out.values()].filter((s) => s.familyIds.size >= 2).sort((a, b) => Number(a.platform) - Number(b.platform) || b.functions.size - a.functions.size || b.familyIds.size - a.familyIds.size || a.name.localeCompare(b.name));
}

export function EnterpriseSchematic({ families, onProblem }: { families: SolutionFamily[]; onProblem: (id: string) => void }) {
  const [hot, setHot] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const shared = useMemo(() => sharedCapabilities(families), [families]);
  const rows = useMemo(() => {
    const by = new Map<string, SolutionFamily[]>();
    for (const f of families) by.set(f.businessProblem.businessFunction, [...(by.get(f.businessProblem.businessFunction) ?? []), f]);
    return [...by.entries()].sort((a, b) => functionRank(a[0]) - functionRank(b[0]));
  }, [families]);
  const focus = hot ?? sel;
  const lit = focus ? shared.find((s) => s.id === focus) : null;
  const liveCount = families.filter((f) => isLive(f.preferred)).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="view-enterprise">
      <div className="circuit-grid relative overflow-hidden rounded-2xl border border-navy2 p-4 pb-12 text-white" data-testid="enterprise-board">
        <div className="mb-3 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/55">
          <span>Schematic · Entire enterprise</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-cyan" /> {families.length} business problems · {FUNCTION_ORDER.filter((fn) => rows.some(([k]) => k === fn)).length} functions</span>
        </div>
        <ol className="space-y-2.5">
          {rows.map(([fn, fams]) => (
            <li key={fn} className="grid gap-2 md:grid-cols-[150px_minmax(0,1fr)]" data-testid={`busbar-${fn}`}>
              <div className="flex items-center gap-2 md:border-r-2 md:border-cyan/60 md:pr-3">
                <span className="h-2 w-2 shrink-0 rounded-full bg-cyan shadow-[0_0_8px_#64D8E8]" />
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold leading-tight">{fn}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">{fams.length} problem{fams.length === 1 ? "" : "s"}</div>
                </div>
              </div>
              <ul className="flex flex-wrap gap-2">
                {fams.map((f) => {
                  const p = f.preferred;
                  const on = lit ? lit.solutionIds.has(p.id) : false;
                  const dim = lit ? !on : false;
                  return (
                    <li key={f.businessProblem.id} className="flex items-stretch transition-opacity" style={{ opacity: dim ? 0.4 : 1 }} data-testid={`enterprise-family-${f.businessProblem.id}`} data-on={on ? "true" : "false"}>
                      <button type="button" data-testid={`enterprise-problem-${f.businessProblem.id}`} onClick={() => onProblem(f.businessProblem.id)} title={`Open the schematic for ${f.businessProblem.title}`}
                        className="press w-[150px] rounded-l-xl border-l-[4px] border-white/70 bg-navy2/95 px-2.5 py-2 text-left ring-1 ring-white/15 outline-none hover:ring-white/45 focus-visible:ring-2 focus-visible:ring-orange">
                        <span className="block truncate font-mono text-[9.5px] uppercase tracking-[0.12em] text-white/55">Problem</span>
                        <span className="line-clamp-2 text-[12.5px] font-semibold leading-tight">{f.businessProblem.title}</span>
                      </button>
                      <span aria-hidden="true" className={cn("my-auto h-0.5 w-5", on ? "bg-white" : "bg-cyan/80")} />
                      <Link href={`/solutions/${p.id}`} data-testid={`enterprise-solution-${p.id}`}
                        className={cn("press block w-[170px] rounded-r-xl border-l-[4px] bg-navy2/95 px-2.5 py-2 text-left ring-1 outline-none focus-visible:ring-2 focus-visible:ring-orange",
                          isLive(p) ? "border-cyan" : "border-[#8CB6C4]", on ? "ring-2 ring-white shadow-[0_0_0_4px_rgba(100,216,232,.25)]" : "ring-white/15 hover:ring-white/45")}>
                        <span className="flex items-center gap-1 truncate font-mono text-[9.5px] uppercase tracking-[0.12em] text-white/55">{isLive(p) ? <><Zap className="h-2.5 w-2.5 text-cyan" /> Live · {p.status}</> : <><Eye className="h-2.5 w-2.5" /> Preview · {p.status}</>}</span>
                        <span className="block truncate text-[12.5px] font-semibold leading-tight">{p.name}</span>
                        <span className="block truncate text-[10.5px] text-white/60">{p.outputType}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
        <div className="pointer-events-none absolute inset-x-4 bottom-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/55">
          <span>Click a problem to trace it · a product to open it</span>
          <span className="flex-1" />
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded bg-cyan" />Runs on real input ({liveCount})</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded bg-[#8CB6C4]" />Output preview ({families.length - liveCount})</span>
        </div>
      </div>

      <aside className="card-soft p-4 lg:sticky lg:top-[calc(var(--shell-top)+16px)]" data-testid="enterprise-shared">
        <div className="eyebrow">Shared across functions</div>
        <p className="mt-1 text-[13.5px] text-muted-foreground">Capabilities more than one business problem already runs on. Point at one to light up every product that carries it.</p>
        {shared.length === 0 ? (
          <p className="mt-3 text-[14px] text-muted-foreground">No capability is shared across business problems yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {shared.map((c) => (
              <li key={c.id}>
                <button type="button" data-testid={`shared-capability-${c.id}`} aria-pressed={sel === c.id}
                  onClick={() => setSel((v) => (v === c.id ? null : c.id))} onMouseEnter={() => setHot(c.id)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(c.id)} onBlur={() => setHot(null)}
                  className={cn("flex w-full min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors", sel === c.id ? "border-primary bg-secondary" : "border-border hover:border-primary/50")}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-semibold">{c.name}</span>
                    <span className="block text-[12.5px] text-muted-foreground">{c.platform ? "Platform control" : c.sourceSolutionName ? `From ${c.sourceSolutionName}` : `In ${c.solutionIds.size} products`} · {c.functions.size} function{c.functions.size === 1 ? "" : "s"}, {c.familyIds.size} business problems</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {lit && (
          <div className="mt-3 rounded-lg bg-secondary/70 p-3 text-[13.5px]" data-testid="text-shared-detail" aria-live="polite">
            <span className="font-semibold">{lit.name}</span> is carried by {lit.solutionIds.size} product{lit.solutionIds.size === 1 ? "" : "s"} across {lit.familyIds.size} business problems in {lit.functions.size} function{lit.functions.size === 1 ? "" : "s"}. One capability, one owner, reused instead of rebuilt.
          </div>
        )}
        <Link href="/discover" className={cn(btn.quiet, "mt-3")} data-testid="link-enterprise-discover">Describe a new problem <ArrowRight className="h-4 w-4" /></Link>
      </aside>
    </div>
  );
}
