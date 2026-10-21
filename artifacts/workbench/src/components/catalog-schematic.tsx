import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Eye, Lock, Zap } from "lucide-react";
import type { BusinessProblem, Capability, Solution } from "@workspace/api-client-react";
import { functionRank, isLive } from "@/components/enterprise";
import { cn } from "@/lib/utils";

/**
 * Schematic for the filtered catalogue. Two roots, chosen by the category the person selected:
 *  - problems: each business function is a busbar; every problem on it is wired to the filtered products that address it.
 *  - capabilities: each workflow step is a busbar; every capability on it is wired to the products that use it, the
 *    source product first. Only records that passed the search and filters are drawn.
 */

const STEP_ORDER = ["Ingest", "Analyze", "Review", "Decide", "Track"];
const stepRank = (s: string) => { const i = STEP_ORDER.indexOf(s); return i === -1 ? STEP_ORDER.length : i; };

const nodeBase = "press block rounded-r-xl border-l-[4px] bg-navy2/95 px-2.5 py-2 text-left ring-1 outline-none focus-visible:ring-2 focus-visible:ring-orange";

function SolutionNode({ s, tone, hot, testid }: { s: Solution; tone: "cyan" | "blue" | "green"; hot?: boolean; testid: string }) {
  return (
    <Link href={`/solutions/${s.id}`} data-testid={testid} title={`Open ${s.name}`}
      className={cn(nodeBase, "w-[170px]", tone === "cyan" ? "border-cyan" : tone === "green" ? "border-[#A9B94C]" : "border-[#8CB6C4]", hot ? "ring-2 ring-white shadow-[0_0_0_4px_rgba(100,216,232,.25)]" : "ring-white/15 hover:ring-white/45")}>
      <span className="flex items-center gap-1 truncate font-mono text-[9.5px] uppercase tracking-[0.12em] text-white/55">{isLive(s) ? <><Zap className="h-2.5 w-2.5 text-cyan" /> Live · {s.status}</> : <><Eye className="h-2.5 w-2.5" /> Preview · {s.status}</>}</span>
      <span className="block truncate text-[12.5px] font-semibold leading-tight">{s.name}</span>
      <span className="block truncate text-[10.5px] text-white/60">{s.kind === "capability_module" ? "Reusable capability" : s.outputType}</span>
    </Link>
  );
}

function Busbar({ title, sub, children, testid }: { title: string; sub: string; children: React.ReactNode; testid: string }) {
  return (
    <li className="grid gap-2 md:grid-cols-[150px_minmax(0,1fr)]" data-testid={testid}>
      <div className="flex items-start gap-2 pt-2 md:border-r-2 md:border-cyan/60 md:pr-3">
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cyan shadow-[0_0_8px_#64D8E8]" />
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold leading-tight">{title}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">{sub}</div>
        </div>
      </div>
      <ul className="space-y-2">{children}</ul>
    </li>
  );
}

function Board({ label, right, legend, children, testid }: { label: string; right: string; legend: React.ReactNode; children: React.ReactNode; testid: string }) {
  return (
    <div className="circuit-grid relative overflow-hidden rounded-2xl border border-navy2 p-4 pb-12 text-white" data-testid={testid}>
      <div className="mb-3 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/55">
        <span>Schematic · {label}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-cyan" /> {right}</span>
      </div>
      <ol className="space-y-3">{children}</ol>
      <div className="pointer-events-none absolute inset-x-4 bottom-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/55">{legend}</div>
    </div>
  );
}

/** Problems → the filtered products that address them, one busbar per business function. */
export function ProblemSchematic({ solutions, problems }: { solutions: Solution[]; problems: BusinessProblem[] }) {
  const rows = useMemo(() => {
    const byProblem = new Map<string, Solution[]>();
    const loose: Solution[] = [];
    for (const s of solutions) {
      const pid = s.businessProblemIds.find((id) => problems.some((p) => p.id === id));
      if (pid) byProblem.set(pid, [...(byProblem.get(pid) ?? []), s]); else loose.push(s);
    }
    const byFn = new Map<string, { p: BusinessProblem; sols: Solution[] }[]>();
    for (const p of problems) {
      const sols = byProblem.get(p.id);
      if (!sols) continue;
      sols.sort((a, b) => Number(!!b.disposition?.preferred) - Number(!!a.disposition?.preferred) || b.activeUsers - a.activeUsers);
      byFn.set(p.businessFunction, [...(byFn.get(p.businessFunction) ?? []), { p, sols }]);
    }
    const out = [...byFn.entries()].sort((a, b) => functionRank(a[0]) - functionRank(b[0]));
    return { out, loose };
  }, [solutions, problems]);
  const liveCount = solutions.filter(isLive).length;
  const problemCount = rows.out.reduce((n, [, r]) => n + r.length, 0);
  return (
    <Board label="Filtered catalogue · by problem" right={`${solutions.length} products · ${problemCount} problems`} testid="catalog-schematic-problems"
      legend={<>
        <span>Click a product to open it</span><span className="flex-1" />
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded bg-cyan" />Runs on real input ({liveCount})</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded bg-[#8CB6C4]" />Output preview ({solutions.length - liveCount})</span>
      </>}>
      {rows.out.map(([fn, items]) => (
        <Busbar key={fn} title={fn} sub={`${items.length} problem${items.length === 1 ? "" : "s"}`} testid={`catalog-busbar-${fn}`}>
          {items.map(({ p, sols }) => (
            <li key={p.id} className="flex items-stretch" data-testid={`catalog-problem-${p.id}`}>
              <div className="w-[150px] shrink-0 rounded-l-xl border-l-[4px] border-white/70 bg-navy2/95 px-2.5 py-2 ring-1 ring-white/15">
                <span className="block truncate font-mono text-[9.5px] uppercase tracking-[0.12em] text-white/55">Problem</span>
                <span className="line-clamp-2 text-[12.5px] font-semibold leading-tight">{p.title}</span>
              </div>
              <span aria-hidden="true" className="my-auto h-0.5 w-5 shrink-0 bg-cyan/80" />
              <ul className="flex flex-wrap gap-2">
                {sols.map((s) => <li key={s.id}><SolutionNode s={s} tone={isLive(s) ? "cyan" : "blue"} testid={`catalog-solution-${p.id}-${s.id}`} /></li>)}
              </ul>
            </li>
          ))}
        </Busbar>
      ))}
      {rows.loose.length > 0 && (
        <Busbar title="No business problem recorded" sub={`${rows.loose.length} product${rows.loose.length === 1 ? "" : "s"}`} testid="catalog-busbar-other">
          <li className="flex flex-wrap gap-2">{rows.loose.map((s) => <SolutionNode key={s.id} s={s} tone={isLive(s) ? "cyan" : "blue"} testid={`catalog-solution-none-${s.id}`} />)}</li>
        </Busbar>
      )}
    </Board>
  );
}

/** Capabilities → the products that use them, one busbar per workflow step. The source product is wired first. */
export function CapabilitySchematic({ capabilities, solutions }: { capabilities: Capability[]; solutions: Solution[] }) {
  const [sel, setSel] = useState<string | null>(null);
  const rows = useMemo(() => {
    const by = new Map<string, { c: Capability; users: Solution[] }[]>();
    for (const c of capabilities) {
      const users = solutions.filter((s) => s.capabilityIds.includes(c.id)).sort((a, b) => Number(b.id === c.sourceSolutionId) - Number(a.id === c.sourceSolutionId) || b.activeUsers - a.activeUsers);
      by.set(c.workflowStep, [...(by.get(c.workflowStep) ?? []), { c, users }]);
    }
    for (const list of by.values()) list.sort((a, b) => b.users.length - a.users.length || a.c.name.localeCompare(b.c.name));
    return [...by.entries()].sort((a, b) => stepRank(a[0]) - stepRank(b[0]));
  }, [capabilities, solutions]);
  const reused = capabilities.filter((c) => solutions.filter((s) => s.capabilityIds.includes(c.id)).length > 1).length;
  const current = sel ? capabilities.find((c) => c.id === sel) ?? null : null;
  return (
    <Board label="Filtered catalogue · by capability" right={`${capabilities.length} capabilities · ${reused} reused by more than one product`} testid="catalog-schematic-capabilities"
      legend={<>
        <span>Click a capability for its record · a product to open it</span><span className="flex-1" />
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded bg-cyan" />Source product</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded bg-[#A9B94C]" />Reuses it</span>
      </>}>
      {rows.map(([step, items]) => (
        <Busbar key={step} title={`${step} step`} sub={`${items.length} capabilit${items.length === 1 ? "y" : "ies"}`} testid={`catalog-busbar-${step}`}>
          {items.map(({ c, users }) => {
            const on = sel === c.id;
            return (
              <li key={c.id} data-testid={`catalog-capability-${c.id}`} data-on={on ? "true" : "false"}>
                <div className="flex items-stretch">
                  <button type="button" aria-pressed={on} onClick={() => setSel(on ? null : c.id)} data-testid={`catalog-capability-node-${c.id}`}
                    className={cn("press w-[170px] shrink-0 rounded-l-xl border-l-[4px] bg-navy2/95 px-2.5 py-2 text-left ring-1 outline-none focus-visible:ring-2 focus-visible:ring-orange", c.controlType === "locked" ? "border-white/70" : "border-orange", on ? "ring-2 ring-white" : "ring-white/15 hover:ring-white/45")}>
                    <span className="flex items-center gap-1 truncate font-mono text-[9.5px] uppercase tracking-[0.12em] text-white/55">{c.controlType === "locked" && <Lock className="h-2.5 w-2.5" />} Capability · {c.controlType}</span>
                    <span className="line-clamp-2 text-[12.5px] font-semibold leading-tight">{c.name}</span>
                    <span className="block truncate text-[10.5px] text-white/60">Used in {users.length} product{users.length === 1 ? "" : "s"}</span>
                  </button>
                  <span aria-hidden="true" className="my-auto h-0.5 w-5 shrink-0 bg-cyan/80" />
                  <ul className="flex flex-wrap gap-2">
                    {users.length === 0
                      ? <li className="self-center font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">No product in this view uses it</li>
                      : users.map((s) => <li key={s.id}><SolutionNode s={s} tone={s.id === c.sourceSolutionId ? "cyan" : "green"} hot={on} testid={`catalog-user-${c.id}-${s.id}`} /></li>)}
                  </ul>
                </div>
                {on && current && (
                  <div className="reveal ml-[2px] mt-1.5 max-w-3xl rounded-lg bg-white/10 px-3 py-2 text-[13px] text-white/90" data-testid={`catalog-capability-detail-${c.id}`} aria-live="polite">
                    <span className="font-semibold">{current.name}</span> · from {current.sourceSolutionName} · owner {current.ownerName} · {current.evidenceLevel} evidence · v{current.version}. {current.description}
                    {current.lockedReason && <span className="block text-white/70">{current.lockedReason}</span>}
                    <Link href={`/solutions/${current.sourceSolutionId}`} className="mt-1 inline-block font-semibold text-cyan underline-offset-2 hover:underline" data-testid={`catalog-capability-open-${c.id}`}>Open {current.sourceSolutionName}</Link>
                  </div>
                )}
              </li>
            );
          })}
        </Busbar>
      ))}
    </Board>
  );
}
