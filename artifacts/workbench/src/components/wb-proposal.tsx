/**
 * Proposed workflow map: Version A (the locked baseline) against Version B (the case's saved configuration).
 * A comes from the baseline blocks; B from the configured lane (steps + recorded requests in place).
 * Every chain wraps freely; measured SVG connectors join each node to the next, including across wrapped rows.
 */
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { HelpCircle, Lock, Plus, Undo2, X } from "lucide-react";
import type { CapabilityRequest } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import type { LaneEntry } from "@/components/wb-schematic";
import type { LaneRow } from "@/components/wb-lanes";
import { cn } from "@/lib/utils";

type BKind = "same" | "added" | "on" | "off" | "setting" | "build";
export type PNode = { id: string; kind: BKind; name: string; stage: string; origin: string; why: string; row?: LaneRow; req?: CapabilityRequest; aOff?: boolean };

/** Version A: only steps that exist in the baseline. A base step listed but inactive in A is shown as off there. */
export function aNodes(lane: LaneEntry[], baseName: string): PNode[] {
  return lane.flatMap((x) => (x.kind === "step" && x.row.a ? [{ id: x.row.id, kind: "same" as BKind, name: x.row.name, stage: x.row.stage, origin: baseName, why: x.row.description, row: x.row, aOff: !x.row.a.active }] : []));
}

/** Version B, in configured order. Deviation comes from buildRows, which treats a base step missing from A as off in A, never as added. */
export function bNodes(lane: LaneEntry[], baseName: string): PNode[] {
  return lane.map((x) => {
    if (x.kind === "request") return { id: `req:${x.req.id}`, kind: "build" as BKind, name: x.req.need, stage: "To build", origin: "Still needed in this workflow", why: x.req.missing, req: x.req };
    const r = x.row;
    const kind: BKind = r.deviation === "added" ? "added" : r.deviation ?? "same";
    // An added step that is not active is not part of B either way; show it as off so the sequence stays honest.
    return { id: r.id, kind: !r.b.active ? "off" : kind, name: r.name, stage: r.stage, origin: r.deviation === "added" ? r.source : baseName, why: r.description, row: r };
  });
}
/** Kept for callers that only want the runnable B chain. */
export const proposalNodes = (lane: LaneEntry[], baseName: string) => bNodes(lane, baseName).filter((n) => n.kind !== "off");

const TAG: Record<BKind, string> = { same: "Unchanged", added: "Added", on: "Turned on", off: "Off in B", setting: "Setting changed", build: "To build" };

/* ---------- measured connectors ---------- */

function useConnectors(ref: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  const [paths, setPaths] = useState<{ d: string; dashed: boolean }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const measure = () => {
      const o = host.getBoundingClientRect();
      const els = Array.from(host.querySelectorAll<HTMLElement>("[data-chain-node]"));
      const out: { d: string; dashed: boolean }[] = [];
      for (let i = 1; i < els.length; i++) {
        const p = els[i - 1].getBoundingClientRect(), n = els[i].getBoundingClientRect();
        const dashed = els[i - 1].dataset.dashed === "1" || els[i].dataset.dashed === "1";
        const px = p.right - o.left, py = p.top + p.height / 2 - o.top, nx = n.left - o.left, ny = n.top + n.height / 2 - o.top;
        let d: string;
        if (Math.abs(p.top - n.top) < 6 && nx > px) d = `M${px},${py} H${nx - 2}`;
        else if (Math.abs(p.left - n.left) < 6) { const cx = p.left + p.width / 2 - o.left; d = `M${cx},${p.bottom - o.top} V${n.top - o.top - 2}`; }
        else {
          // Wrapped: out of the last node, down into the gap, back left, and into the first node of the next row.
          const gy = (p.bottom + n.top) / 2 - o.top;
          const rx = Math.min(px + 10, o.width - 3), lx = Math.max(nx - 10, 3);
          d = `M${px},${py} H${rx} V${gy} H${lx} V${ny} H${nx - 2}`;
        }
        out.push({ d, dashed });
      }
      setPaths(out); setSize({ w: o.width, h: o.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    host.querySelectorAll("[data-chain-node]").forEach((e) => ro.observe(e));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { paths, size };
}

function Chain({ testid, items, empty }: { testid: string; items: ReactNode[]; empty: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { paths, size } = useConnectors(ref, [items.length]);
  if (!items.length) return <p className="rounded-xl border border-dashed border-[#2A4E59] p-5 text-center text-[13px] text-[#9FC2CB]">{empty}</p>;
  return (
    <div ref={ref} className="relative" data-testid={testid}>
      <svg aria-hidden className="pointer-events-none absolute inset-0 overflow-visible" width={size.w} height={size.h}>
        <defs><marker id={`ar-${testid}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#5FB4C4" /></marker></defs>
        {paths.map((p, i) => <path key={i} d={p.d} fill="none" stroke={p.dashed ? "#CE7642" : "#3C8C9E"} strokeWidth={2} strokeDasharray={p.dashed ? "5 4" : undefined} strokeLinejoin="round" markerEnd={`url(#ar-${testid})`} />)}
      </svg>
      <ol className="relative flex flex-col items-stretch gap-6 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-9 sm:gap-y-8">{items}</ol>
    </div>
  );
}

function Card({ n, v, open, onPick, controls }: { n: PNode; v: "A" | "B"; open: boolean; onPick: () => void; controls?: ReactNode }) {
  const build = n.kind === "build";
  const dimmed = (v === "A" && n.aOff) || (v === "B" && n.kind === "off");
  const changed = v === "B" && n.kind !== "same";
  return (
    <div data-chain-node data-dashed={build || dimmed ? "1" : "0"} data-testid={`proposal-${v.toLowerCase()}-node-${n.id}`} data-kind={v === "B" ? n.kind : n.aOff ? "off" : "on"}
      className={cn("relative flex min-h-[84px] w-full flex-col sm:w-[168px]", build ? "rounded-xl border border-dashed border-[#CE7642]/80 bg-[#3B2B26]/60 text-[#FFD9B8]" : cn("blk", changed && n.kind !== "off" && "inserted", dimmed && "off"), open && (build ? "ring-1 ring-[#FFD09F]" : "open"))}>
      <button type="button" onClick={onPick} aria-pressed={open} className="flex flex-1 flex-col px-3 pb-1 pt-2 text-left">
        <span className={cn("inline-flex max-w-full items-center gap-1 self-start truncate rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[.1em]",
          v === "A" ? "bg-cyan/15 text-[#9ED9E3]" : n.kind === "same" ? "bg-cyan/15 text-[#9ED9E3]" : build ? "text-[#E6A274]" : "bg-[#FF9B4C]/20 text-[#FFD09F]")}>
          {build && <HelpCircle className="h-2.5 w-2.5" />}{v === "A" ? (n.aOff ? "Off in A" : "In A") : n.kind === "added" ? `From ${n.origin}` : TAG[n.kind]}
        </span>
        <span className={cn("mt-1 line-clamp-2 text-[13px] font-semibold leading-tight", build ? "italic" : "text-[#E2F5F7]", v === "B" && n.kind === "off" && "line-through")}>{n.name}</span>
        {v === "B" && n.kind === "setting" && n.row && <span className="mt-0.5 truncate text-[11px] text-[#FFD09F]"><s className="opacity-60">{n.row.a?.value}</s> → {n.row.b.value}</span>}
        <span className="mt-auto pt-1 font-mono text-[9.5px] uppercase tracking-[.1em] text-[#8EAEB7]">{build ? "does not run" : dimmed ? "does not run" : n.stage}</span>
      </button>
      {controls && <div className="flex flex-wrap items-center gap-1.5 border-t border-white/10 px-2 py-1.5">{controls}</div>}
    </div>
  );
}

export type ProposalEdit = {
  editable: boolean; busy: boolean;
  onSwitch: (id: string, name: string, on: boolean) => void;
  onSetOption: (id: string, name: string, v: string) => void;
  onRemoveRequest: (req: CapabilityRequest) => void;
  picker: (afterId: string | null, afterName: string | null, close: () => void) => ReactNode;
  canUndo: boolean; onUndo: () => void;
};

export function ProposalMap({ lane, baseName, edit }: { lane: LaneEntry[]; baseName: string; edit: ProposalEdit }) {
  const [sel, setSel] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const A = aNodes(lane, baseName), B = bNodes(lane, baseName);
  const all = [...A.map((n) => ({ n, v: "A" as const })), ...B.map((n) => ({ n, v: "B" as const }))];
  const picked = all.find((x) => `${x.v}:${x.n.id}` === sel) ?? null;
  const c = (k: BKind) => B.filter((n) => n.kind === k).length;
  const lock = !edit.editable || edit.busy;
  const plus = (afterId: string | null, afterName: string | null) => {
    const key = afterId ?? "start";
    return (
      <li key={`slot-${key}`} className="relative z-10 flex justify-center sm:block">
        <button type="button" disabled={lock} onClick={() => setSlot(slot === key ? null : key)} data-testid={`button-proposal-add-${key}`} aria-expanded={slot === key}
          aria-label={afterName ? `Add a step after ${afterName}` : "Add a step at the start"}
          className={cn("grid h-7 w-7 place-items-center rounded-full border bg-[#0D2C38] text-[#FFD09F] transition-colors hover:bg-[#3B2B26] disabled:opacity-40", slot === key ? "border-[#FFD09F]" : "border-[#CE7642]")}><Plus className="h-3.5 w-3.5" /></button>
      </li>
    );
  };
  const controlsFor = (n: PNode) => {
    if (!edit.editable) return undefined;
    if (n.req) return <button type="button" disabled={lock} onClick={() => edit.onRemoveRequest(n.req!)} data-testid={`button-proposal-remove-${n.id}`} className="inline-flex items-center gap-1 rounded px-1 text-[11.5px] text-[#FFD09F] hover:bg-white/10 disabled:opacity-40"><X className="h-3 w-3" /> Remove</button>;
    const r = n.row!;
    if (r.b.kind === "configurable" && (r.b.options ?? []).length > 0)
      return <select aria-label={`${r.name} setting`} disabled={lock} value={r.b.value ?? ""} onChange={(e) => edit.onSetOption(r.id, r.name, e.target.value)} data-testid={`select-proposal-${r.id}`} className="h-7 w-full rounded border border-[#426879] bg-[#0D2C38] px-1 text-[11.5px] text-[#E2F5F7]">{(r.b.options ?? []).map((o) => <option key={o}>{o}</option>)}</select>;
    if (r.b.added) return <button type="button" disabled={lock} onClick={() => edit.onSwitch(r.id, r.name, !r.b.active)} data-testid={`button-proposal-remove-${r.id}`} className="inline-flex items-center gap-1 rounded px-1 text-[11.5px] text-[#FFD09F] hover:bg-white/10 disabled:opacity-40">{r.b.active ? <><X className="h-3 w-3" /> Remove</> : <><Plus className="h-3 w-3" /> Re-add</>}</button>;
    if (r.b.kind === "optional") return <label className="inline-flex items-center gap-1.5 text-[11.5px] text-[#9FC2CB]"><Switch checked={r.b.active} disabled={lock} onCheckedChange={(on) => edit.onSwitch(r.id, r.name, on)} aria-label={`Turn ${r.name} ${r.b.active ? "off" : "on"}`} data-testid={`switch-proposal-${r.id}`} />{r.b.active ? "On" : "Off"}</label>;
    return <span className="inline-flex items-center gap-1 text-[11px] text-[#7AA9B9]"><Lock className="h-3 w-3" /> Required</span>;
  };
  const bItems: ReactNode[] = [];
  if (edit.editable) bItems.push(plus(null, null));
  B.forEach((n) => {
    bItems.push(<li key={n.id} className="relative z-10"><Card n={n} v="B" open={sel === `B:${n.id}`} onPick={() => setSel(sel === `B:${n.id}` ? null : `B:${n.id}`)} controls={controlsFor(n)} /></li>);
    // Requests are recorded after a real step; offer the plus only after steps so afterStepId stays meaningful.
    if (edit.editable && n.row) bItems.push(plus(n.id, n.name));
  });
  const slotName = slot && slot !== "start" ? B.find((n) => n.id === slot)?.name ?? null : null;
  return (
    <section className="schem relative" data-testid="proposal-map" aria-label="Version A and Version B workflows">
      <div className="relative z-10 flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-4">
        <span className="text-[13.5px] font-semibold text-[#EAF9FB]">A → B workflow comparison</span>
        <span className="font-mono text-[10px] uppercase tracking-[.1em] text-[#7AA9B9]" data-testid="text-proposal-counts">{c("added")} added · {c("on")} turned on · {c("off")} off · {c("setting")} setting changed · {c("build")} to build</span>
        {edit.editable && <button type="button" data-testid="button-proposal-undo" disabled={!edit.canUndo || edit.busy} onClick={edit.onUndo} className="ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-[#9ED9E3] hover:bg-white/10 disabled:opacity-40"><Undo2 className="h-4 w-4" /> Undo</button>}
      </div>
      <div className="relative z-10 flex flex-wrap gap-x-4 gap-y-1 px-5 pt-2 text-[11px] text-[#9FC2CB]">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-cyan/70" />Unchanged from {baseName}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#FF9B4C]" />Changed in B</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm border border-dashed border-[#CE7642]" />Does not run</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-[2px] w-4 bg-[#3C8C9E]" />Flow: left → right, row by row, top to bottom</span>
      </div>
      <div className="relative z-10 space-y-4 px-5 pb-5 pt-4">
        <div className="schem-row p-4" data-testid="proposal-lane-a">
          <div className="mb-3 flex items-center gap-2 text-[12px] text-[#9FC2CB]"><span className="grid h-6 w-6 place-items-center rounded bg-primary text-[12px] font-bold text-primary-foreground">A</span><span className="font-semibold text-[#E2F5F7]">{baseName}</span><Lock className="h-3 w-3" /> read-only baseline</div>
          <Chain testid="proposal-chain-a" empty="The baseline has no steps loaded." items={A.map((n) => <li key={n.id} className="relative z-10"><Card n={n} v="A" open={sel === `A:${n.id}`} onPick={() => setSel(sel === `A:${n.id}` ? null : `A:${n.id}`)} /></li>)} />
        </div>
        <div className="schem-row editable p-4" data-testid="proposal-lane-b">
          <div className="mb-3 flex items-center gap-2 text-[12px] text-[#9FC2CB]"><span className="grid h-6 w-6 place-items-center rounded bg-siennaink text-[12px] font-bold text-white">B</span><span className="font-semibold text-[#E2F5F7]">Proposed version</span>{edit.editable ? (edit.busy ? "saving…" : "use + to add a step") : "view only"}</div>
          <Chain testid="proposal-chain-b" empty="No steps configured yet." items={bItems} />
          {slot && (
            <div className="mt-4 rounded-xl bg-card p-1 text-foreground" data-testid="proposal-picker">{edit.picker(slot === "start" ? null : slot, slotName, () => setSlot(null))}</div>
          )}
        </div>
      </div>
      {picked && (
        <div className="relative z-10 border-t border-white/10 bg-[#0D2C38] px-5 py-4" data-testid="proposal-detail" aria-live="polite">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] uppercase tracking-[.1em] text-[#E6A274]">Version {picked.v} · {picked.v === "A" ? (picked.n.aOff ? "Off in A" : "In A") : TAG[picked.n.kind]}</div>
              <h3 className="mt-0.5 break-words text-[16px] font-semibold text-[#EAF9FB]">{picked.n.name}</h3>
              <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-[13px] text-[#C9E4EA] sm:grid-cols-[auto_1fr]">
                {picked.n.kind === "build" ? <Fragment><dt className="text-[#7AA9B9]">Missing today</dt><dd className="break-words">{picked.n.why}</dd></Fragment>
                  : <Fragment><dt className="text-[#7AA9B9]">What it does</dt><dd className="break-words">{picked.n.why}</dd></Fragment>}
                <dt className="text-[#7AA9B9]">Origin</dt><dd className="break-words">{picked.n.origin}</dd>
              </dl>
            </div>
            <button type="button" onClick={() => setSel(null)} aria-label="Close detail" data-testid="button-close-proposal-detail" className="rounded p-1 text-[#9FC2CB] hover:bg-white/10"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </section>
  );
}
