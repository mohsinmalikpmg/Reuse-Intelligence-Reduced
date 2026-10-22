import { useEffect, useState, type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ArrowRight, Check, ChevronDown, ChevronRight, CornerDownRight, HelpCircle, Lock, Minus, Plus, RefreshCw, SlidersHorizontal, ToggleRight, X } from "lucide-react";
import type { ABComparison, CapabilityRequest, DiffEntry, Run, StepTrace } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/bits";
import type { FlowBlock } from "@/components/flow";
import { cn } from "@/lib/utils";
import { useRole } from "@/lib/persona";

/* ---------- Row model ---------- */

export type Deviation = "added" | "off" | "on" | "setting" | null;
export type LaneRow = {
  id: string; name: string; description: string; kind: FlowBlock["kind"]; source: string; stage: string;
  a: FlowBlock | null; b: FlowBlock;
  deviation: Deviation; inputChanged: boolean; changes: number;
  traceA: StepTrace | null; traceB: StepTrace | null;
  entries: DiffEntry[];
};

export function buildRows(aBlocks: FlowBlock[], bBlocks: FlowBlock[], cmp: ABComparison | undefined, runA: Run | undefined, runB: Run | undefined): LaneRow[] {
  const aById = new Map(aBlocks.map((b) => [b.id, b]));
  const byStep = new Map<string, DiffEntry[]>();
  for (const e of cmp?.diff.entries ?? []) byStep.set(e.stepId, [...(byStep.get(e.stepId) ?? []), e]);
  return bBlocks.map((b) => {
    // Version A only lists the steps that run in production, so a base step missing from A is simply off there.
    const a = b.added ? null : aById.get(b.id) ?? { ...b, active: false };
    let deviation: Deviation = null;
    if (!a) deviation = "added";
    else if (a.active && !b.active) deviation = "off";
    else if (!a.active && b.active) deviation = "on";
    else if (b.kind === "configurable" && a.value !== b.value) deviation = "setting";
    const traceA = runA?.trace.find((t) => t.stepId === b.id) ?? null;
    const traceB = runB?.trace.find((t) => t.stepId === b.id) ?? null;
    const entries = byStep.get(b.id) ?? [];
    return {
      id: b.id, name: b.name, description: b.description, kind: b.kind, source: b.source, stage: b.stage, a, b, deviation,
      inputChanged: !!cmp && !!traceA && !!traceB && traceA.inputSummary !== traceB.inputSummary,
      changes: entries.length, traceA, traceB, entries,
    };
  });
}

export const laneGrid = "grid grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)] items-stretch";
export const KIND = { required: { icon: Lock, label: "Required" }, configurable: { icon: SlidersHorizontal, label: "Configurable" }, optional: { icon: ToggleRight, label: "Optional" } };

export function deviationLabel(r: LaneRow): string | null {
  if (r.deviation === "added") return "B only";
  if (r.deviation === "off") return "Off in B";
  if (r.deviation === "on") return "On in B";
  if (r.deviation === "setting") return "Setting changed";
  return null;
}

/* ---------- Workflow map ---------- */

export type MapEntry = { id: string; label: string; row?: LaneRow; votes?: number; request?: CapabilityRequest };

export function WorkflowMap({ entries, current, open, onJump, onExpandAll, onCollapseAll, horizontal, children, lit }: {
  entries: MapEntry[]; current: string | null; open: Set<string>; onJump: (id: string) => void; onExpandAll: () => void; onCollapseAll: () => void; horizontal?: boolean; children?: ReactNode;
  /** Steps a just-finished real run holds responsible for changed lines; lit briefly. */
  lit?: Set<string>;
}) {
  const stepRows = entries.filter((e) => e.row);
  const allOpen = stepRows.length > 0 && stepRows.every((e) => open.has(e.id));
  return (
    <nav aria-label="Workflow map" data-testid="workflow-map" className={cn(horizontal ? "card-soft px-2 py-2" : "")}>
      <div className={cn("flex items-center gap-2 px-2", horizontal ? "mb-1" : "mb-2")}>
        <span className="eyebrow">Workflow map</span>
        <button data-testid={allOpen ? "button-collapse-all" : "button-expand-all"} onClick={allOpen ? onCollapseAll : onExpandAll} className="ml-auto text-[12.5px] font-semibold text-primary underline-offset-2 hover:underline">
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <ol className={cn("relative", horizontal ? "flex gap-1 overflow-x-auto pb-1" : "space-y-0.5")}>
        {!horizontal && <span aria-hidden className="absolute bottom-5 left-5 top-5 w-px bg-border" />}
        {entries.map((e, i) => {
          const r = e.row;
          const isCurrent = current === e.id;
          const stepNo = r ? stepRows.indexOf(e) + 1 : null;
          const dev = r ? deviationLabel(r) : null;
          const off = r?.deviation === "off";
          const muted = r && !r.b.active && !off;
          if (e.request) {
            return (
              <li key={e.id} className={horizontal ? "shrink-0" : ""}>
                <button data-testid={`map-${e.id}`} aria-current={isCurrent ? "location" : undefined} onClick={() => onJump(e.id)}
                  className={cn("relative flex w-full items-center gap-2.5 rounded-lg text-left transition-colors", horizontal ? "min-h-9 px-2.5 py-1" : "min-h-9 px-2 py-1", isCurrent ? "bg-primary text-primary-foreground" : "text-primary hover:bg-secondary")}>
                  <span className={cn("relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed text-[11px] font-semibold", isCurrent ? "border-white/60 bg-primary text-primary-foreground" : "border-sienna/60 bg-card text-siennaink")}>?</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium italic leading-tight">Requested: {e.request.need}</span>
                    <span className={cn("block text-[11px] leading-tight", isCurrent ? "text-white/80" : "text-siennaink")}>Not built yet</span>
                  </span>
                </button>
              </li>
            );
          }
          return (
            <li key={e.id} className={horizontal ? "shrink-0" : ""}>
              <button
                data-testid={`map-${e.id}`}
                aria-current={isCurrent ? "location" : undefined}
                onClick={() => onJump(e.id)}
                className={cn(
                  "relative flex w-full items-center gap-2.5 rounded-lg text-left transition-colors",
                  horizontal ? "min-h-9 px-2.5 py-1" : "min-h-9 px-2 py-1",
                  isCurrent ? "bg-primary text-primary-foreground" : "text-primary hover:bg-secondary",
                )}
              >
                <span data-lit={lit?.has(e.id) ? "true" : undefined} className={cn(
                  "relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold transition-shadow",
                  isCurrent ? "border-white/40 bg-primary text-primary-foreground" : r?.deviation === "added" ? "border-sienna/50 bg-accent text-siennaink" : "border-border bg-card text-muted-foreground",
                  lit?.has(e.id) && "ring-2 ring-cyan shadow-[0_0_10px_hsl(187_70%_65%/.7)]",
                )}>
                  {e.id === "input" ? <ChevronDown className="h-3.5 w-3.5" /> : e.id === "output" ? "=" : e.id === "verdict" ? <Check className="h-3.5 w-3.5" /> : r?.deviation === "added" ? "+" : stepNo ?? i}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[13px] font-medium leading-tight", off && "line-through opacity-60", muted && "opacity-60")}>{e.label}</span>
                  {dev && <span className={cn("block text-[11px] leading-tight", isCurrent ? "text-white/80" : "text-siennaink")}>{dev}{r?.deviation === "added" ? ` · ${r.source}` : ""}</span>}
                  {!dev && r?.inputChanged && <span className={cn("block text-[11px] leading-tight", isCurrent ? "text-white/80" : "text-skyink")}>Input changed</span>}
                </span>
                {r && r.changes > 0 && <span data-testid={`map-changes-${e.id}`} className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", isCurrent ? "bg-white/15 text-white" : "bg-accent text-siennaink")}>{r.changes}</span>}
                {typeof e.votes === "number" && e.votes > 0 && <span className={cn("shrink-0 text-[11px]", isCurrent ? "text-white/80" : "text-muted-foreground")}>{e.votes} vote{e.votes === 1 ? "" : "s"}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {children}
    </nav>
  );
}

/* ---------- Step row ---------- */

export function TraceBody({ t, label }: { t: StepTrace | null; label: string }) {
  const role = useRole();
  if (role !== "it") return t ? <p className="text-[13.5px]">{t.outputSummary}</p> : null;
  if (!t) return <p className="text-[13px] text-muted-foreground">Run to see what this step received and produced.</p>;
  return (
    <dl className="space-y-1.5 text-[13.5px] leading-snug">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}<Tag>{t.status}</Tag></div>
      <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted-foreground">Received</dt><dd>{t.inputSummary}</dd></div>
      <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted-foreground">Did</dt><dd>{t.transformation}</dd></div>
      <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted-foreground">Produced</dt><dd className="font-semibold">{t.outputSummary}</dd></div>
      <div className="text-[12px] text-muted-foreground">{t.itemCount} items · {t.durationMs} ms</div>
      {t.error && <div className="text-bad">{t.error}</div>}
    </dl>
  );
}

/** Who made a changed line: the step, and the product it came from when it was added to Version B. */
export function provenance(e: Pick<DiffEntry, "change" | "stepName" | "sourceSolutionName" | "addedModule">): string {
  const verb = e.change === "added" ? "Added" : e.change === "removed" ? "Removed" : "Changed";
  return `${verb} by ${e.stepName}${e.addedModule ? ` · from ${e.sourceSolutionName}` : ""}`;
}

const CHANGE = { added: { icon: Plus, cls: "bg-okbg/70 text-foreground", mark: "text-ok" }, removed: { icon: Minus, cls: "bg-muted/70 text-muted-foreground line-through", mark: "text-muted-foreground" }, changed: { icon: RefreshCw, cls: "bg-accent/70 text-foreground", mark: "text-siennaink" } };

export function DiffLines({ entries, picked, onPick, title }: { entries: DiffEntry[]; picked: DiffEntry | null; onPick: (e: DiffEntry) => void; title: string }) {
  if (entries.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul className="space-y-1">
        {entries.map((e, i) => {
          const c = CHANGE[e.change];
          const I = c.icon;
          return (
            <li key={i}>
              <button data-testid="row-diff-line" onClick={() => onPick(e)} className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-snug hover:shadow-[inset_0_0_0_1px_hsl(var(--primary)/.35)]", c.cls, picked === e && "shadow-[inset_0_0_0_2px_hsl(var(--primary))]")}>
                <I className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", c.mark)} />
                <span className="min-w-0 flex-1">{e.after ?? e.before}<span className="block text-[11.5px] text-muted-foreground no-underline">{e.sectionTitle} · {provenance(e)}</span></span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function StepRow({ r, no, open, onToggle, editable, busy, onSetOption, onSwitch, onRemove, picked, onPick, explanation, labelA, labelB, narrow, showA, dragging, slot, welded, energized }: {
  r: LaneRow; no: number; open: boolean; onToggle: () => void; editable: boolean; busy: boolean;
  onSetOption: (v: string) => void; onSwitch: (on: boolean) => void; onRemove: () => void;
  picked: DiffEntry | null; onPick: (e: DiffEntry) => void; explanation: string[]; labelA: string; labelB: string;
  narrow: boolean; showA: boolean; dragging: boolean; slot: ReactNode;
  /** True for a moment right after the server confirmed this step joined Version B: seat + one localized weld. */
  welded?: boolean;
  /** True for a moment after a real run finished and this step produced changed lines: the trace lights up. */
  energized?: boolean;
}) {
  const K = KIND[r.kind];
  const offB = !r.b.active;
  const removed = r.entries.filter((e) => e.change === "removed");
  const addedOrChanged = r.entries.filter((e) => e.change !== "removed");
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const Chevron = open ? ChevronDown : ChevronRight;
  const headerCls = "flex min-h-[52px] w-full items-center gap-2 px-3.5 py-2.5 text-left";
  const aCell = r.a ? (
    <div data-testid={`block-a-${r.id}`} className={cn("card-soft flex flex-col transition-[border-color,box-shadow]", open ? "rounded-b-none border-b-0 border-primary/40" : "hover:border-primary/40", !r.a.active && "bg-muted/40")}>
      <button aria-expanded={open} onClick={onToggle} className={headerCls}>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[14.5px] font-semibold leading-tight text-primary", !r.a.active && "text-muted-foreground")}>{r.name}</span>
          <span className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground"><K.icon className="h-3 w-3" />{r.a.kind === "configurable" && r.a.value ? r.a.value : r.a.kind === "optional" ? (r.a.active ? "Optional · on" : "Optional · off") : K.label}</span>
        </span>
        <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </div>
  ) : (
    <div data-testid={`block-a-${r.id}`} className="grid min-h-[52px] place-items-center rounded-[14px] border border-dashed border-input px-3 text-center text-[12.5px] text-muted-foreground">Not in the current product</div>
  );
  const bCell = (
    <div data-testid={`block-${r.id}`} data-welded={welded ? "true" : undefined} data-energized={energized ? "true" : undefined}
      className={cn("card-soft relative flex flex-col transition-[border-color,box-shadow]", r.deviation ? "border-sienna/50" : "", open ? "rounded-b-none border-b-0" : "hover:border-primary/40", open && (r.deviation ? "border-sienna" : "border-primary/40"), offB && "bg-muted/40",
        welded && "seat shadow-[0_0_0_2px_hsl(var(--orange)),0_0_18px_hsl(29_100%_62%/.35)]",
        energized && "shadow-[0_0_0_2px_hsl(var(--cyan)),0_0_16px_hsl(187_70%_65%/.35)]")}>
      {welded && <span aria-hidden className="weld" style={{ left: -11, top: 15 }} data-testid={`weld-${r.id}`} />}
      <div className="flex items-center gap-1 pr-2">
        <button aria-expanded={open} onClick={onToggle} className={cn(headerCls, "min-w-0 flex-1 pr-0")}>
          <span className="min-w-0 flex-1">
            <span className={cn("block text-[14.5px] font-semibold leading-tight", r.deviation === "added" ? "text-siennaink" : "text-primary", offB && "text-muted-foreground", r.deviation === "off" && "line-through")}>{r.name}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
              {r.deviation === "added" ? <span className="text-siennaink">Added from {r.source}</span>
                : r.deviation === "setting" ? <span><span className="line-through">{r.a?.value}</span> <ArrowRight className="inline h-3 w-3" /> <span className="font-semibold text-siennaink">{r.b.value}</span></span>
                : r.deviation === "on" ? <span className="text-siennaink">Turned on in B</span>
                : r.deviation === "off" ? <span className="text-siennaink">Switched off in B</span>
                : <span className="inline-flex items-center gap-1"><K.icon className="h-3 w-3" />{r.b.kind === "configurable" && r.b.value ? r.b.value : r.b.kind === "optional" ? (r.b.active ? "Optional · on" : "Optional · off") : K.label}</span>}
              {r.inputChanged && <span className="inline-flex items-center gap-0.5 text-skyink" data-testid={`mark-input-changed-${r.id}`}><CornerDownRight className="h-3 w-3" /> input changed</span>}
            </span>
          </span>
          {r.changes > 0 && <span data-testid={`changes-${r.id}`} className="shrink-0 rounded-md bg-accent px-1.5 py-0.5 text-[11.5px] font-semibold text-siennaink">{r.changes} changed line{r.changes === 1 ? "" : "s"}</span>}
          <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
        {editable && (
          <span className="flex shrink-0 items-center gap-1" onClick={stop}>
            {r.b.kind === "configurable" && (r.b.options ?? []).length > 0 && (
              <select aria-label={`${r.name} setting`} data-testid={`select-${r.id}`} disabled={busy} value={r.b.value ?? ""} onChange={(e) => onSetOption(e.target.value)} className={cn("h-8 max-w-[250px] rounded-md border bg-card px-2 text-[13px]", r.deviation === "setting" ? "border-sienna" : "border-input")}>
                {(r.b.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {r.b.kind === "optional" && !r.b.added && <Switch aria-label={`Turn ${r.name} ${r.b.active ? "off" : "on"}`} data-testid={`switch-${r.id}`} checked={r.b.active} disabled={busy} onCheckedChange={onSwitch} />}
            {r.b.added && <button data-testid={`button-remove-${r.id}`} disabled={busy} onClick={onRemove} className="inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-[12.5px] font-medium text-accent-foreground hover:bg-accent"><X className="h-3.5 w-3.5" /> Remove</button>}
          </span>
        )}
      </div>
    </div>
  );
  const bodyA = (
    <div className={cn("card-soft rounded-t-none border-primary/40 px-3.5 pb-4 pt-3", !r.a && "border-dashed border-input bg-card/60")}>
      {r.a ? <>
        <p className="mb-3 text-[13px] text-muted-foreground">{r.description}</p>
        <TraceBody t={r.traceA} label={labelA} />
        <DiffLines entries={removed} picked={picked} onPick={onPick} title={`Lines only A produced (${removed.length})`} />
      </> : <p className="text-[13px] text-muted-foreground">This step only runs in Version B. The next shared step stays aligned below.</p>}
    </div>
  );
  const bodyB = (
    <div className={cn("card-soft rounded-t-none px-3.5 pb-4 pt-3", r.deviation ? "border-sienna" : "border-primary/40")}>
      {!r.a && <p className="mb-3 text-[13px] text-muted-foreground">{r.description}</p>}
      {offB ? <p className="text-[13px] text-muted-foreground">Switched off in Version B, so it does not run.</p> : <TraceBody t={r.traceB} label={labelB} />}
      <DiffLines entries={addedOrChanged} picked={picked} onPick={onPick} title={`Lines this step ${r.entries.some((e) => e.change === "changed") && !r.entries.some((e) => e.change === "added") ? "changed" : "added"} in B (${addedOrChanged.length})`} />
    </div>
  );
  const spine = (hasLine: boolean, label?: ReactNode) => (
    <div className="relative flex justify-center">
      {hasLine && <span aria-hidden className="absolute inset-y-0 w-px bg-border" />}
      {label !== undefined && <span className={cn("relative z-10 mt-[15px] grid h-6 w-6 place-items-center rounded-full border text-[11px] font-semibold", r.deviation === "added" ? "border-sienna/50 bg-accent text-siennaink" : open ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground")}>{label}</span>}
    </div>
  );
  if (narrow) {
    return (
      <div id={`row-${r.id}`} data-testid={`row-${r.id}`} className="scroll-mt-[calc(var(--shell-top)+5.25rem)]">
        {showA && <div className="mb-1"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">A</div>{aCell}{open && bodyA}</div>}
        <div><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-siennaink">B · step {no}</div>{bCell}{open && bodyB}</div>
        {open && explanation.length > 0 && <div className="mt-2 rounded-lg bg-[hsl(196_30%_93%)] px-3 py-2 text-[13px] text-skyink">{explanation.map((x, i) => <div key={i}>{x}</div>)}</div>}
        <div className="my-1">{slot}</div>
      </div>
    );
  }
  return (
    <div id={`row-${r.id}`} data-testid={`row-${r.id}`} className="scroll-mt-[calc(var(--shell-top)+5.25rem)]">
      <div className={laneGrid}>
        {aCell}
        {spine(true, r.deviation === "added" ? "+" : no)}
        {bCell}
      </div>
      {open && (
        <div className={cn(laneGrid, "reveal")}>
          {bodyA}
          {spine(true)}
          {bodyB}
        </div>
      )}
      {open && explanation.length > 0 && (
        <div className={laneGrid}>
          <div className="col-span-3 mt-2 rounded-lg bg-[hsl(196_30%_93%)] px-3 py-2 text-[13px] text-skyink" data-testid={`explanation-${r.id}`}>{explanation.map((x, i) => <div key={i}>{x}</div>)}</div>
        </div>
      )}
      <div className={laneGrid}>
        <div />
        {spine(true)}
        <div className={cn(dragging ? "py-1" : "")}>{slot}</div>
      </div>
    </div>
  );
}

/* ---------- Add-a-step slot ---------- */

export function AddSlot({ id, afterName, dragging, enabled, openId, setOpenId, visible, picker }: {
  id: string; afterName: string | null; dragging: boolean; enabled: boolean;
  openId: string | null; setOpenId: (id: string | null) => void;
  /** Keep the "+ Add a step" button visible without hover (touch screens, last row). */
  visible?: boolean;
  /** The reuse-first picker shown when this slot is open */
  picker: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${id}`, disabled: !enabled });
  const open = openId === id;
  if (!enabled) return <div className="h-3" />;
  return (
    <div ref={setNodeRef} className={cn("group/slot", !dragging && !open && (visible ? "h-8" : "h-4"), open && "pb-2")}>
      {dragging ? (
        <div data-testid={`drop-${id}`} data-over={isOver ? "true" : "false"} className={cn("grid min-h-11 place-items-center rounded-xl border-2 border-dashed bg-card text-[13px] font-semibold transition-colors", isOver ? "socket-over border-orange text-siennaink" : "socket-ready border-cyan/70 text-skyink")}>
          <span className="inline-flex items-center gap-1.5"><span className={cn("inline-block h-2 w-2 rounded-full", isOver ? "bg-orange" : "bg-cyan")} />{isOver ? "Release to connect here" : "Socket · drop to connect"}</span>
        </div>
      ) : (
        <div className={cn("relative flex items-center", visible ? "h-8" : "h-4")}>
          <span aria-hidden className={cn("absolute inset-x-0 top-1/2 h-px transition-colors", open ? "bg-sienna" : visible ? "bg-sienna/30" : "bg-transparent group-hover/slot:bg-sienna/40 group-focus-within/slot:bg-sienna/40")} />
          <button
            data-testid={`button-add-slot-${id}`}
            aria-label={afterName ? `Add a step after ${afterName}` : "Add a step"}
            aria-expanded={open}
            onClick={() => setOpenId(open ? null : id)}
            className={cn("relative z-10 mx-auto inline-flex items-center gap-1 rounded-full border bg-card font-semibold transition-opacity", visible ? "min-h-8 px-3 text-[12.5px]" : "min-h-6 px-2 text-[11.5px]", open ? "border-sienna text-siennaink opacity-100" : visible ? "border-sienna/50 text-siennaink opacity-100" : "border-input text-siennaink opacity-0 focus-visible:opacity-100 group-hover/slot:opacity-100")}
          >
            <Plus className="h-3 w-3" /> Add a step
          </button>
        </div>
      )}
      {open && !dragging && picker}
    </div>
  );
}

/* ---------- Requested capability: recorded, shown in place, never run ---------- */

export function RequestRow({ req, narrow, showA, editable, busy, onRemove }: { req: CapabilityRequest; narrow: boolean; showA: boolean; editable: boolean; busy: boolean; onRemove: () => void }) {
  const id = `req:${req.id}`;
  const bCell = (
    <div data-testid={`block-${id}`} className="flex min-h-[52px] flex-col rounded-[14px] border border-dashed border-sienna/60 bg-accent/20 px-3.5 py-2.5">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-siennaink" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[14.5px] font-semibold italic leading-tight text-siennaink">Requested: {req.need}</span>
            <Tag tone="sienna" testid={`tag-not-built-${req.id}`}>Not built yet</Tag>
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">Missing today: {req.missing}. Does not run and is never counted in the output.</div>
        </div>
        {editable && <button data-testid={`button-remove-${id}`} disabled={busy} onClick={onRemove} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12.5px] font-medium text-accent-foreground hover:bg-accent"><X className="h-3.5 w-3.5" /> Remove</button>}
      </div>
    </div>
  );
  const aCell = <div data-testid={`block-a-${id}`} className="grid min-h-[52px] place-items-center rounded-[14px] border border-dashed border-input px-3 text-center text-[12.5px] text-muted-foreground">Not in the current product</div>;
  if (narrow) {
    return (
      <div id={`row-${id}`} data-testid={`row-${id}`} className="scroll-mt-[calc(var(--shell-top)+5.25rem)]">
        {showA && <div className="mb-1"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">A</div>{aCell}</div>}
        <div><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-siennaink">B · requested</div>{bCell}</div>
        <div className="h-3" />
      </div>
    );
  }
  return (
    <div id={`row-${id}`} data-testid={`row-${id}`} className="scroll-mt-[calc(var(--shell-top)+5.25rem)]">
      <div className={laneGrid}>
        {aCell}
        <div className="relative flex justify-center"><span aria-hidden className="absolute inset-y-0 w-px bg-border" /><span className="relative z-10 mt-[15px] grid h-6 w-6 place-items-center rounded-full border border-dashed border-sienna/60 bg-card text-[11px] font-semibold text-siennaink">?</span></div>
        {bCell}
      </div>
      <div className={laneGrid}><div /><div className="relative flex h-3 justify-center"><span aria-hidden className="absolute inset-y-0 w-px bg-border" /></div><div /></div>
    </div>
  );
}

/* ---------- Lane headers ---------- */

export function LaneHeaders({ editTools, narrow, showA, setShowA, controls, aLabel = "Current product", extra }: { editTools: ReactNode; narrow: boolean; showA: boolean; setShowA: (v: boolean) => void; controls: string[]; aLabel?: string; extra?: ReactNode }) {
  const controlsLine = controls.length > 0 && <span className="text-[12px] text-muted-foreground" data-testid="list-controls">Controls in place: {controls.join(", ")}</span>;
  if (narrow) {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-siennaink text-[13px] font-bold text-white">B</span>
        <span className="font-semibold">Proposed version</span>
        <label className="ml-auto inline-flex items-center gap-2 text-[13px]"><Switch data-testid="switch-show-a" checked={showA} onCheckedChange={setShowA} aria-label="Show Version A" /> Show Version A</label>
        <span className="w-full">{editTools}</span>
        {controlsLine}
      </div>
    );
  }
  return (
    <div className="mb-3">
      <div className={laneGrid}>
        <div data-testid="workflow-a" className="flex min-h-10 flex-wrap items-center gap-2 px-1">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground">A</span>
          <span className="font-semibold" data-testid="text-lane-a-label">{aLabel}</span>
          <span className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground"><Lock className="h-3.5 w-3.5" /> Locked baseline</span>
        </div>
        <div />
        <div className="flex min-h-10 flex-wrap items-center gap-2 px-1">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-siennaink text-[13px] font-bold text-white">B</span>
          <span className="font-semibold">Proposed version</span>
          <span className="ml-auto inline-flex items-center gap-1">{editTools}{extra}</span>
        </div>
      </div>
      {controlsLine && <div className="mt-1 px-1">{controlsLine}</div>}
    </div>
  );
}

/* ---------- Row shell for Output and Verdict ---------- */

export function BandRow({ id, label, icon, narrow, children, dim }: { id: string; label: string; icon: ReactNode; narrow: boolean; children: ReactNode; dim?: boolean }) {
  return (
    <section id={`row-${id}`} data-testid={`row-${id}`} className={cn("scroll-mt-[calc(var(--shell-top)+5.25rem)]", dim && "opacity-70")} aria-label={label}>
      {narrow ? (
        <div className="mt-4"><div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{icon}{label}</div>{children}</div>
      ) : (
        <div className={laneGrid}>
          <div className="col-span-3 relative mt-2">
            <div className="absolute left-[calc(50%-22px)] top-0 flex h-8 w-11 justify-center"><span aria-hidden className="absolute inset-y-0 w-px bg-border" /><span className="relative z-10 mt-1 grid h-6 w-6 place-items-center rounded-full border border-border bg-background text-[11px] font-semibold text-muted-foreground">{icon}</span></div>
            <div className="pt-9">{children}</div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------- Narrow screen hook ---------- */

export function useNarrow(query = "(max-width: 1023px)") {
  const [narrow, setNarrow] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

