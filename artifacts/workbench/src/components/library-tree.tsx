import { useCallback, useEffect, useMemo, useState } from "react";
import { ReactFlow, ReactFlowProvider, Background, Controls, useReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowRight, Maximize2 } from "lucide-react";
import type { BusinessProblem, Capability, Solution } from "@workspace/api-client-react";
import { StatusPill, btn } from "@/components/bits";

type Props = { problems: BusinessProblem[]; solutions: Solution[]; capabilities: Capability[]; onOpen: (id: string) => void };
type Sel = { t: "p" | "s" | "c"; id: string } | null;

const COLORS = { p: "hsl(191 28% 29%)", s: "hsl(20 54% 50%)", c: "hsl(196 29% 56%)" };

export function LibraryTree(p: Props) {
  return <ReactFlowProvider><Tree {...p} /></ReactFlowProvider>;
}

function Tree({ problems, solutions, capabilities, onOpen }: Props) {
  const rf = useReactFlow();
  const [openP, setOpenP] = useState<string | null>(null);
  const [openS, setOpenS] = useState<string | null>(null);
  const [openC, setOpenC] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [hover, setHover] = useState<Sel>(null);
  const sById = useMemo(() => new Map(solutions.map((s) => [s.id, s])), [solutions]);
  const cById = useMemo(() => new Map(capabilities.map((c) => [c.id, c])), [capabilities]);

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = []; const edges: Edge[] = [];
    const mk = (id: string, label: string, sub: string, x: number, y: number, t: "p" | "s" | "c", on: boolean) =>
      nodes.push({ id, position: { x, y }, data: { label: <div className="text-left"><div className="text-[13px] font-semibold leading-tight">{label}</div><div className="mt-0.5 text-[11px] opacity-70">{sub}</div></div> },
        style: { width: 230, borderRadius: 10, border: `1.5px solid ${on ? COLORS[t] : "hsl(168 11% 86%)"}`, borderLeft: `5px solid ${COLORS[t]}`, background: on ? "hsl(190 18% 96%)" : "#FFFFFF", color: "hsl(191 22% 19%)", padding: 10, cursor: "pointer" }, sourcePosition: "right" as never, targetPosition: "left" as never });
    problems.forEach((bp, i) => {
      const n = solutions.filter((s) => s.businessProblemIds.includes(bp.id)).length;
      mk(`p:${bp.id}`, bp.title, `${n} solution${n === 1 ? "" : "s"} · ${openP === bp.id ? "click to collapse" : "click to expand"}`, 0, i * 84, "p", openP === bp.id);
    });
    if (openP) {
      const pi = problems.findIndex((x) => x.id === openP);
      const sols = solutions.filter((s) => s.businessProblemIds.includes(openP));
      const y0 = pi * 84 - ((sols.length - 1) * 84) / 2;
      sols.forEach((s, j) => {
        mk(`s:${s.id}`, s.name, `${s.status} · ${s.capabilityIds.length} capabilities`, 320, y0 + j * 84, "s", openS === s.id);
        edges.push({ id: `e:${openP}:${s.id}`, source: `p:${openP}`, target: `s:${s.id}`, style: { stroke: "hsl(191 10% 70%)" } });
      });
      if (openS) {
        const si = sols.findIndex((s) => s.id === openS);
        const sol = sById.get(openS);
        const caps = (sol?.capabilityIds ?? []).map((id) => cById.get(id)).filter(Boolean) as Capability[];
        const cy0 = y0 + si * 84 - ((caps.length - 1) * 70) / 2;
        caps.forEach((c, k) => {
          const used = solutions.filter((s) => s.capabilityIds.includes(c.id)).length;
          mk(`c:${c.id}`, c.name, `Used in ${used} solution${used === 1 ? "" : "s"}`, 640, cy0 + k * 70, "c", openC === c.id);
          edges.push({ id: `e:${openS}:${c.id}`, source: `s:${openS}`, target: `c:${c.id}`, style: { stroke: "hsl(191 10% 70%)" } });
        });
        if (openC) {
          const ci = caps.findIndex((c) => c.id === openC);
          const users = solutions.filter((s) => s.capabilityIds.includes(openC) && s.id !== openS);
          const uy0 = cy0 + ci * 70 - ((users.length - 1) * 70) / 2;
          users.forEach((u, k) => {
            mk(`u:${u.id}`, u.name, "Also uses this capability", 960, uy0 + k * 70, "s", false);
            edges.push({ id: `e:${openC}:${u.id}`, source: `c:${openC}`, target: `u:${u.id}`, animated: true, style: { stroke: COLORS.c } });
          });
        }
      }
    }
    return { nodes, edges };
  }, [problems, solutions, openP, openS, openC, sById, cById]);

  useEffect(() => { const t = setTimeout(() => rf.fitView({ padding: 0.2, duration: 300, maxZoom: 1.1 }), 30); return () => clearTimeout(t); }, [nodes.length, rf]);

  const parse = (id: string): Sel => { const [t, ...r] = id.split(":"); return { t: (t === "u" ? "s" : t) as "p" | "s" | "c", id: r.join(":") }; };
  const onClick = useCallback((_: unknown, n: Node) => {
    const s = parse(n.id); setSel(s); if (!s) return;
    if (n.id.startsWith("p:")) { setOpenP((v) => (v === s.id ? null : s.id)); setOpenS(null); setOpenC(null); }
    else if (n.id.startsWith("s:")) { setOpenS((v) => (v === s.id ? null : s.id)); setOpenC(null); }
    else if (n.id.startsWith("c:")) setOpenC((v) => (v === s.id ? null : s.id));
  }, []);
  const overview = () => { setOpenP(null); setOpenS(null); setOpenC(null); setSel(null); };
  const show = hover ?? sel;

  return (
    <div className="card-soft relative h-[600px] overflow-hidden" data-testid="view-tree">
      <ReactFlow nodes={nodes} edges={edges} onNodeClick={onClick}
        onNodeDoubleClick={(_, n) => { if (n.id.startsWith("s:") || n.id.startsWith("u:")) onOpen(n.id.slice(2)); }}
        onNodeMouseEnter={(_, n) => setHover(parse(n.id))} onNodeMouseLeave={() => setHover(null)}
        nodesDraggable={false} nodesConnectable={false} zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }} minZoom={0.3}>
        <Background gap={24} color="hsl(168 11% 88%)" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      <button data-testid="button-tree-overview" onClick={overview} className={`${btn.secondary} absolute left-3 top-3 z-10 min-h-9 text-[13.5px]`}><Maximize2 className="h-4 w-4" /> Return to overview</button>
      <div className="absolute right-3 top-3 z-10 w-[280px]">
        {show ? <Preview sel={show} problems={problems} sById={sById} cById={cById} solutions={solutions} onOpen={onOpen} /> :
          <div className="rounded-xl border border-border bg-card/95 p-4 text-[13.5px] text-muted-foreground">Click a business problem to see its solutions. Click a solution to see its capabilities. Double-click a solution, or use Open, to view it.</div>}
      </div>
    </div>
  );
}

function Preview({ sel, problems, sById, cById, solutions, onOpen }: { sel: NonNullable<Sel>; problems: BusinessProblem[]; sById: Map<string, Solution>; cById: Map<string, Capability>; solutions: Solution[]; onOpen: (id: string) => void }) {
  const box = "reveal rounded-xl border border-border bg-card p-4 shadow-sm";
  if (sel.t === "p") { const bp = problems.find((x) => x.id === sel.id); return bp ? <div className={box} data-testid="tree-preview"><div className="eyebrow">Business problem</div><div className="mt-1 font-semibold text-primary">{bp.title}</div><p className="mt-1 text-[13.5px] text-muted-foreground">{bp.description}</p></div> : null; }
  if (sel.t === "s") { const s = sById.get(sel.id); return s ? (
    <div className={box} data-testid="tree-preview">
      <div className="flex items-center gap-2"><span className="eyebrow">Solution</span><StatusPill status={s.status} className="ml-auto" /></div>
      <div className="mt-1 font-semibold text-primary">{s.name}</div>
      <p className="mt-1 text-[13.5px] text-muted-foreground">{s.outcome}</p>
      <div className="mt-1 text-[12.5px] text-muted-foreground">Owner {s.ownerName}</div>
      <button data-testid="button-tree-open" onClick={() => onOpen(s.id)} className={`${btn.primary} mt-3 min-h-9 px-4 text-[14px]`}>Open <ArrowRight className="h-4 w-4" /></button>
    </div>) : null; }
  const c = cById.get(sel.id); if (!c) return null;
  const used = solutions.filter((s) => s.capabilityIds.includes(c.id));
  return (
    <div className={box} data-testid="tree-preview">
      <div className="eyebrow">Reusable capability</div>
      <div className="mt-1 font-semibold text-primary">{c.name}</div>
      <p className="mt-1 text-[13.5px] text-muted-foreground">{c.description}</p>
      <div className="mt-2 text-[12.5px] text-muted-foreground">Used in: {used.map((u) => u.name).join(", ")}</div>
    </div>
  );
}
