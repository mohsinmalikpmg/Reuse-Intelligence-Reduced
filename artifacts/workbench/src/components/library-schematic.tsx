import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, Info, X } from "lucide-react";
import type { FamilyCapability, Solution, SolutionFamily } from "@workspace/api-client-react";
import { StatusPill, Tag, btn } from "@/components/bits";
import { useTry } from "@/components/family-card";
import { isLive } from "@/components/enterprise";
import { cn } from "@/lib/utils";

/**
 * Trace view: one business problem, the solutions that address it (≤3) and the capabilities that can be reused
 * around it (≤4), drawn as a circuit. Every node is a real button (keyboard reachable); the SVG only draws traces.
 * Nothing here is generated: every node and edge comes from the family record the API returns.
 */

export type SchematicFilter = "all" | "solutions" | "components";
export const SOLUTION_LIMIT = 3;
export const CAPABILITY_LIMIT = 4;

const TONE = {
  cyan: "#64D8E8",     // preferred / conductive
  blue: "#8CB6C4",     // alternative
  orange: "#FF963D",   // portable from elsewhere (experimental path)
  green: "#A9B94C",    // already reused
  dim: "#4C6B74",      // being consolidated / inactive
} as const;
type Tone = keyof typeof TONE;

type SolRole = "preferred" | "alternative" | "consolidating";
export type SNode =
  | { id: string; kind: "problem"; title: string; eyebrow: string; sub: string; family: SolutionFamily }
  | { id: string; kind: "solution"; title: string; eyebrow: string; sub: string; solution: Solution; role: SolRole }
  | { id: string; kind: "capability"; title: string; eyebrow: string; sub: string; item: FamilyCapability; sourceShown: boolean };
type SEdge = { id: string; from: string; to: string; tone: Tone; dashed?: boolean; label: string };

export function buildSchematic(family: SolutionFamily, filter: SchematicFilter) {
  const nodes: SNode[] = [];
  const edges: SEdge[] = [];
  const pid = `p:${family.businessProblem.id}`;
  nodes.push({ id: pid, kind: "problem", title: family.businessProblem.title, eyebrow: "Business problem", sub: family.businessProblem.description, family });

  const sols: { s: Solution; role: SolRole }[] = [
    { s: family.preferred, role: "preferred" },
    ...family.alternatives.map((s) => ({ s, role: "alternative" as const })),
    ...family.consolidating.map((s) => ({ s, role: "consolidating" as const })),
  ];
  const shownSols = filter === "components" ? [] : sols.slice(0, SOLUTION_LIMIT);
  const hiddenSols = filter === "components" ? 0 : Math.max(0, sols.length - SOLUTION_LIMIT);
  for (const { s, role } of shownSols) {
    const eyebrow = `${role === "preferred" ? `Preferred · ${s.status}` : role === "alternative" ? `Alternative · ${s.status}` : (s.disposition?.label ?? "Being consolidated")}${isLive(s) ? "" : " · preview"}`;
    nodes.push({ id: `s:${s.id}`, kind: "solution", title: s.name, eyebrow, sub: s.outcome, solution: s, role });
    edges.push({
      id: `${pid}>${s.id}`, from: pid, to: `s:${s.id}`,
      tone: role === "preferred" ? "cyan" : role === "alternative" ? "blue" : "dim",
      dashed: role === "consolidating",
      label: role === "preferred" ? "preferred solution" : role === "alternative" ? "also addresses this problem" : "being consolidated",
    });
  }

  const caps = filter === "solutions" ? [] : family.reusableCapabilities.slice(0, CAPABILITY_LIMIT);
  const hiddenCaps = filter === "solutions" ? 0 : Math.max(0, family.reusableCapabilities.length - CAPABILITY_LIMIT);
  const shownIds = new Set(shownSols.map((x) => x.s.id));
  for (const item of caps) {
    const c = item.capability;
    const sourceShown = shownIds.has(item.sourceSolutionId);
    const sub = item.includedInPreferred ? `Already in ${family.preferred.name}` : item.tryIn ? `Can be tried in ${item.tryIn.solutionName}` : `Used in ${item.usedIn.length} product${item.usedIn.length === 1 ? "" : "s"}`;
    nodes.push({ id: `c:${c.id}`, kind: "capability", title: c.name, eyebrow: `From ${item.sourceSolutionName}`, sub, item, sourceShown });
    // Attach to the product it comes from when that product is on the board; otherwise to the product that could take it.
    const anchor = sourceShown ? `s:${item.sourceSolutionId}`
      : item.tryIn && shownIds.has(item.tryIn.solutionId) ? `s:${item.tryIn.solutionId}`
      : shownIds.has(family.preferred.id) ? `s:${family.preferred.id}` : pid;
    const tone: Tone = sourceShown ? "cyan" : item.includedInPreferred ? "green" : "orange";
    edges.push({
      id: `${anchor}>${c.id}`, from: anchor, to: `c:${c.id}`, tone, dashed: !sourceShown && !item.includedInPreferred,
      label: sourceShown ? `provided by ${item.sourceSolutionName}` : item.includedInPreferred ? `reused from ${item.sourceSolutionName}` : `portable from ${item.sourceSolutionName}`,
    });
  }
  return { nodes, edges, hiddenSols, hiddenCaps };
}

/* ---------- geometry ---------- */
const H = { problem: 96, solution: 72, capability: 66 } as const;
const GAP_Y = 22;
const PAD_TOP = 34;
const PAD_BOTTOM = 58; // room for the legend row

function layout(nodes: SNode[], width: number, filter: SchematicFilter) {
  const cols = filter === "all" ? 3 : 2;
  const gapX = width < 760 ? 48 : 72;
  const nodeW = Math.max(176, Math.min(290, Math.floor((width - 40 - (cols - 1) * gapX) / cols)));
  const total = cols * nodeW + (cols - 1) * gapX;
  const x0 = Math.max(20, Math.floor((width - total) / 2));
  const colX = (i: number) => x0 + i * (nodeW + gapX);
  const col = (kind: SNode["kind"]) => kind === "problem" ? 0 : kind === "solution" ? 1 : cols - 1;
  const byCol = new Map<number, SNode[]>();
  for (const n of nodes) { const c = col(n.kind); byCol.set(c, [...(byCol.get(c) ?? []), n]); }
  const colH = (ns: SNode[]) => ns.reduce((a, n) => a + H[n.kind], 0) + Math.max(0, ns.length - 1) * GAP_Y;
  const inner = Math.max(...[...byCol.values()].map(colH), H.problem);
  const height = inner + PAD_TOP + PAD_BOTTOM;
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const [c, ns] of byCol) {
    let y = PAD_TOP + (inner - colH(ns)) / 2;
    for (const n of ns) { pos.set(n.id, { x: colX(c), y, w: nodeW, h: H[n.kind] }); y += H[n.kind] + GAP_Y; }
  }
  return { pos, height, nodeW };
}

/** Orthogonal trace with rounded corners from the right port of `a` to the left port of `b`. */
function trace(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
  const mx = (x1 + x2) / 2;
  const dy = y2 - y1;
  const r = Math.min(10, Math.abs(dy) / 2, (x2 - x1) / 2);
  if (Math.abs(dy) < 1) return { d: `M${x1},${y1} L${x2},${y2}`, len: x2 - x1 };
  const s = dy > 0 ? 1 : -1;
  const d = `M${x1},${y1} L${mx - r},${y1} Q${mx},${y1} ${mx},${y1 + s * r} L${mx},${y2 - s * r} Q${mx},${y2} ${mx + r},${y2} L${x2},${y2}`;
  return { d, len: x2 - x1 + Math.abs(dy) };
}

function matches(n: SNode, words: string[]) {
  if (words.length === 0) return false;
  const t = `${n.title} ${n.sub} ${n.eyebrow}`.toLowerCase();
  return words.every((w) => t.includes(w));
}

/* ---------- component ---------- */
export function LibrarySchematic({ family, filter, q, onFilter }: { family: SolutionFamily; filter: SchematicFilter; q: string; onFilter: (f: SchematicFilter) => void }) {
  const { nodes, edges, hiddenSols, hiddenCaps } = useMemo(() => buildSchematic(family, filter), [family, filter]);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  const [sel, setSel] = useState<string | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [listMode, setListMode] = useState(false);

  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver((es) => { for (const e of es) setWidth(Math.round(e.contentRect.width)); });
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { setSel(null); setHot(null); }, [family.businessProblem.id, filter]);

  const { pos, height } = useMemo(() => layout(nodes, width, filter), [nodes, width, filter]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const focus = hot ?? sel;
  const linked = useMemo(() => {
    if (!focus) return null;
    const s = new Set<string>([focus]);
    for (const e of edges) { if (e.from === focus) s.add(e.to); if (e.to === focus) s.add(e.from); }
    return s;
  }, [focus, edges]);
  const selected = nodes.find((n) => n.id === sel) ?? null;
  const narrow = width < 640;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { setSel(null); (e.currentTarget as HTMLElement).focus(); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="view-schematic">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-input bg-card p-0.5" role="radiogroup" aria-label="Show on the schematic">
            {([["all", "Entire circuit"], ["solutions", "Solutions"], ["components", "Components"]] as const).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={filter === k} data-testid={`button-schematic-${k}`} onClick={() => onFilter(k)}
                className={cn("min-h-9 rounded-lg px-3 text-[14px] font-medium", filter === k ? "bg-secondary text-primary" : "text-muted-foreground hover:text-foreground")}>{l}</button>
            ))}
          </div>
          <div className="flex-1" />
          <button data-testid="button-schematic-list" aria-pressed={listMode} onClick={() => setListMode((v) => !v)} className={cn(btn.secondary, "min-h-9 text-[14px]")}>
            {listMode ? "Show the schematic" : "Prefer a list?"}
          </button>
        </div>

        {listMode || narrow ? (
          <SchematicList nodes={nodes} edges={edges} sel={sel} onSelect={setSel} />
        ) : (
          <div ref={wrap} role="group" aria-label={`Schematic for ${family.businessProblem.title}`} tabIndex={-1} onKeyDown={onKey}
            className="circuit-grid relative overflow-hidden rounded-2xl border border-navy2 text-white" style={{ height }} data-testid="schematic-board">
            <div className="pointer-events-none absolute left-4 top-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/55">Schematic · {family.businessProblem.title}</div>
            <div className="pointer-events-none absolute right-4 top-3 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/55"><span className="h-1.5 w-1.5 rounded-full bg-cyan" /> Live catalogue</div>
            <svg aria-hidden="true" className="absolute inset-0 h-full w-full" width={width} height={height}>
              {edges.map((e) => {
                const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) return null;
                const { d, len } = trace(a, b);
                const on = linked ? e.from === focus || e.to === focus : false;
                const dimmed = linked ? !on : false;
                return (
                  <g key={e.id} data-testid={`edge-${e.id}`} data-on={on ? "true" : "false"}>
                    <path d={d} fill="none" stroke={TONE[e.tone]} strokeWidth={on ? 3 : 2} strokeDasharray={e.dashed ? "6 6" : undefined} strokeLinecap="round" opacity={dimmed ? 0.3 : on ? 1 : 0.75} />
                    {on && <path d={d} fill="none" stroke="#FFFFFF" strokeWidth={1.2} strokeLinecap="round" opacity={0.85} className="trace-in" pathLength={1} />}
                    {on && !e.dashed && <path d={d} fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" className="current-on" opacity={0.7} style={{ animationDuration: `${Math.max(0.8, len / 300)}s` }} />}
                  </g>
                );
              })}
              {nodes.map((n) => {
                const p = pos.get(n.id); if (!p) return null;
                const lit = linked?.has(n.id) ?? false;
                const hasIn = edges.some((e) => e.to === n.id), hasOut = edges.some((e) => e.from === n.id);
                return (
                  <g key={n.id}>
                    {hasIn && <circle cx={p.x} cy={p.y + p.h / 2} r={4.5} fill={lit ? TONE.cyan : "#071D27"} stroke={TONE.cyan} strokeWidth={1.5} />}
                    {hasOut && <circle cx={p.x + p.w} cy={p.y + p.h / 2} r={4.5} fill={lit ? TONE.cyan : "#071D27"} stroke={TONE.cyan} strokeWidth={1.5} />}
                  </g>
                );
              })}
            </svg>
            {nodes.map((n) => {
              const p = pos.get(n.id); if (!p) return null;
              const isSel = sel === n.id;
              const dim = linked ? !linked.has(n.id) : false;
              const hit = matches(n, words);
              const accent = n.kind === "problem" ? "border-white/70" : n.kind === "solution" ? (n.role === "preferred" ? "border-cyan" : n.role === "alternative" ? "border-[#8CB6C4]" : "border-[#4C6B74]") : (n.sourceShown ? "border-cyan" : n.item.includedInPreferred ? "border-[#A9B94C]" : "border-orange");
              return (
                <button key={n.id} type="button" data-testid={`node-${n.id}`} aria-pressed={isSel} aria-label={`${n.eyebrow}: ${n.title}`}
                  onClick={() => setSel((v) => (v === n.id ? null : n.id))} onMouseEnter={() => setHot(n.id)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(n.id)} onBlur={() => setHot(null)}
                  style={{ left: p.x, top: p.y, width: p.w, height: p.h, opacity: dim ? 0.45 : 1 }}
                  className={cn("press absolute flex flex-col justify-center rounded-xl border-l-[5px] bg-navy2/95 px-3.5 text-left transition-[opacity,box-shadow,transform] duration-150 outline-none",
                    accent, isSel ? "ring-2 ring-white shadow-[0_0_0_4px_rgba(100,216,232,.25)]" : "ring-1 ring-white/15 hover:ring-white/45 focus-visible:ring-2 focus-visible:ring-orange",
                    hit && !isSel && "ring-2 ring-orange")}>
                  <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">{n.eyebrow}</span>
                  <span className={cn("font-semibold leading-tight", n.kind === "problem" ? "line-clamp-2 text-[16px]" : "truncate text-[14.5px]")}>{n.title}</span>
                  <span className="truncate text-[11.5px] text-white/60">{n.sub}</span>
                </button>
              );
            })}
            <div className="pointer-events-none absolute inset-x-4 bottom-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/55">
              <span>Tab to move · Enter to inspect · Esc to clear</span>
              <span className="flex-1" />
              {([["cyan", "Preferred / provides"], ["blue", "Alternative"], ["orange", "Portable from elsewhere"], ["green", "Already reused"], ["dim", "Being consolidated"]] as const).map(([t, l]) => (
                <span key={t} className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: TONE[t] }} />{l}</span>
              ))}
            </div>
          </div>
        )}
        {(hiddenSols > 0 || hiddenCaps > 0) && (
          <p className="mt-2 text-[13px] text-muted-foreground" data-testid="text-schematic-overflow">
            The schematic shows at most {SOLUTION_LIMIT} solutions and {CAPABILITY_LIMIT} capabilities.
            {hiddenSols > 0 && ` ${hiddenSols} more solution${hiddenSols === 1 ? "" : "s"}`}{hiddenSols > 0 && hiddenCaps > 0 && " and"}{hiddenCaps > 0 && ` ${hiddenCaps} more capabilit${hiddenCaps === 1 ? "y" : "ies"}`} are on the By problem card.
          </p>
        )}
      </div>
      <Inspector node={selected} family={family} edges={edges} nodes={nodes} onClose={() => setSel(null)} />
    </div>
  );
}

/* ---------- list fallback: same nodes, same actions, no drawing ---------- */
function SchematicList({ nodes, edges, sel, onSelect }: { nodes: SNode[]; edges: SEdge[]; sel: string | null; onSelect: (id: string | null) => void }) {
  const groups: { title: string; kind: SNode["kind"] }[] = [{ title: "Business problem", kind: "problem" }, { title: "Solutions", kind: "solution" }, { title: "Reusable capabilities", kind: "capability" }];
  return (
    <div className="card-soft divide-y divide-border" data-testid="schematic-list">
      {groups.map((g) => {
        const ns = nodes.filter((n) => n.kind === g.kind); if (ns.length === 0) return null;
        return (
          <div key={g.kind} className="px-4 py-3">
            <div className="eyebrow mb-2">{g.title}</div>
            <ul className="space-y-1.5">
              {ns.map((n) => {
                const e = edges.find((x) => x.to === n.id);
                return (
                  <li key={n.id}>
                    <button type="button" data-testid={`list-node-${n.id}`} aria-pressed={sel === n.id} onClick={() => onSelect(sel === n.id ? null : n.id)}
                      className={cn("flex w-full min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors", sel === n.id ? "border-primary bg-secondary" : "border-border hover:border-primary/50")}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14.5px] font-semibold">{n.title}</span>
                        <span className="block text-[12.5px] text-muted-foreground">{n.eyebrow}{e ? ` · ${e.label}` : ""}</span>
                      </span>
                      <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- inspector: provenance first, then the one action that makes sense ---------- */
function Inspector({ node, family, edges, nodes, onClose }: { node: SNode | null; family: SolutionFamily; edges: SEdge[]; nodes: SNode[]; onClose: () => void }) {
  const { go, busy } = useTry();
  const box = "card-soft p-4 lg:sticky lg:top-[116px]";
  if (!node) {
    return (
      <aside className={cn(box, "text-[14px] text-muted-foreground")} data-testid="schematic-inspector-empty">
        <div className="eyebrow mb-1">Signal inspector</div>
        Select a node to see why it is connected, where it comes from and what you can do with it.
      </aside>
    );
  }
  const title = (n: string) => nodes.find((x) => x.id === n)?.title ?? n;
  const links = edges.filter((e) => e.from === node.id || e.to === node.id);
  const Row = ({ k, v, testid }: { k: string; v: ReactNode; testid?: string }) => <div className="border-t border-border py-2.5 first:border-t-0"><div className="eyebrow">{k}</div><div className="mt-0.5 text-[14px]" data-testid={testid}>{v}</div></div>;

  let body: ReactNode;
  if (node.kind === "problem") {
    body = (
      <>
        <Row k="Why this is connected" v={`${family.alternatives.length + family.consolidating.length + 1} product${family.alternatives.length + family.consolidating.length ? "s address" : " addresses"} this problem. ${family.preferred.name} is the one to use.`} />
        <Row k="Preferred solution" v={<Link href={`/solutions/${family.preferred.id}`} className="font-semibold text-primary hover:underline">{family.preferred.name} v{family.preferred.currentVersion}</Link>} />
        <Row k="Support" v={family.support} />
      </>
    );
  } else if (node.kind === "solution") {
    const s = node.solution;
    const why = node.role === "preferred" ? `Covers ${family.covers.length} capabilit${family.covers.length === 1 ? "y" : "ies"} for this problem in its production configuration.`
      : node.role === "alternative" ? `Also addresses this problem. IT has not given it a disposition, so ${family.preferred.name} stays the one to use.`
      : `${s.disposition?.label ?? "Being consolidated"}. Its reusable capabilities are still available around ${family.preferred.name}.`;
    body = (
      <>
        <Row k="Why this is connected" v={why} testid="text-inspector-why" />
        <Row k="Business function" v={`${s.businessFunction} · ${s.outputType}${isLive(s) ? "" : " · sample-data preview only"}`} />
        <Row k="Source" v={s.businessUnits.length ? s.businessUnits.join(", ") : "Demo catalogue"} />
        <Row k="Certification" v={<span className="inline-flex items-center gap-2"><StatusPill status={s.status} /><span className="text-muted-foreground">v{s.currentVersion}</span></span>} />
        <Row k="Owner" v={s.ownerName} />
        <div className="mt-3 flex flex-col gap-2">
          {node.role === "preferred" && isLive(s) && <button data-testid="button-inspector-try" disabled={busy} onClick={() => go({ baseSolutionId: s.id })} className={btn.primary}>Try with my input <ArrowRight className="h-4 w-4" /></button>}
          <Link href={`/solutions/${s.id}`} data-testid="link-inspector-open" className={node.role === "preferred" && isLive(s) ? btn.secondary : btn.primary}>{isLive(s) ? `Open ${s.name}` : `See the output preview of ${s.name}`} <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </>
    );
  } else {
    const { item } = node; const c = item.capability;
    const link = links[0];
    const why = node.sourceShown ? `Provided by ${item.sourceSolutionName}, a solution to this problem.`
      : item.includedInPreferred ? `Reused from ${item.sourceSolutionName} (${item.familyTitle}); already part of ${family.preferred.name}.`
      : `Portable from ${item.sourceSolutionName} (${item.familyTitle}).${item.tryIn ? ` It can be added to ${item.tryIn.solutionName} without changing the standard version.` : ""}`;
    const elsewhere = item.usedIn.filter((u) => u.solutionId !== item.sourceSolutionId);
    body = (
      <>
        <Row k="Why this is connected" v={why} testid="text-inspector-why" />
        <Row k="What it does" v={c.description} />
        <Row k="Source" v={<Link href={`/solutions/${item.sourceSolutionId}`} className="font-semibold text-primary hover:underline">{item.sourceSolutionName} v{c.version}</Link>} />
        <Row k="Certification" v={<span className="inline-flex flex-wrap items-center gap-1.5"><Tag tone={c.evidenceLevel === "strong" ? "green" : c.evidenceLevel === "moderate" ? "sky" : "muted"}>{c.evidenceLevel} evidence</Tag><span className="text-muted-foreground">{c.supportStatus}</span></span>} />
        <Row k="Owner" v={c.ownerName} />
        {elsewhere.length > 0 && <Row k="Also used in" v={elsewhere.map((u) => `${u.solutionName} v${u.version}`).join(", ")} />}
        {link && <Row k="Trace" v={<span className="text-muted-foreground">{title(link.from)} → {title(link.to)} · {link.label}</span>} />}
        <div className="mt-3 flex flex-col gap-2">
          {item.tryIn && !item.includedInPreferred && (
            <button data-testid="button-inspector-try" disabled={busy} onClick={() => go({ baseSolutionId: item.tryIn!.solutionId, moduleIds: [c.id] }, "compare")} className={btn.primary}>
              Try in {item.tryIn.solutionName} <ArrowRight className="h-4 w-4" />
            </button>
          )}
          <Link href={`/solutions/${item.sourceSolutionId}`} data-testid="link-inspector-open" className={btn.secondary}>Open {item.sourceSolutionName} <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </>
    );
  }
  return (
    <aside className={box} data-testid="schematic-inspector" aria-live="polite">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="eyebrow">{node.kind === "problem" ? "Business problem" : node.kind === "solution" ? "Solution" : "Reusable capability"}</div>
          <h3 className="mt-0.5 text-[18px] font-bold leading-snug" data-testid="text-inspector-title">{node.title}</h3>
        </div>
        <button onClick={onClose} aria-label="Close inspector" data-testid="button-inspector-close" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-3">{body}</div>
    </aside>
  );
}
