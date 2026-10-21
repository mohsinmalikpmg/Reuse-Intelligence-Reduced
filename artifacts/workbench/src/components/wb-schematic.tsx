/**
 * The kit's "Live workflow schematic": Version A and Version B as horizontal block chains inside a dark viewport.
 * It renders the same lane rows, drag ids, slot ids and open-row state as the list layout; nothing here decides
 * when a weld or a light plays, the page does that from confirmed server responses.
 */
import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ArrowRight, HelpCircle, Lock, Plus, X } from "lucide-react";
import type { CapabilityRequest, DiffEntry } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/bits";
import { DiffLines, TraceBody, deviationLabel, laneGrid, type LaneRow } from "@/components/wb-lanes";
import { cn } from "@/lib/utils";

export type LaneEntry = { kind: "step"; row: LaneRow } | { kind: "request"; req: CapabilityRequest };

/* ---------- Pieces ---------- */

function Wire({ hot, flow }: { hot?: boolean; flow?: boolean }) {
  return <span aria-hidden className={cn("wire", hot && "hot", flow && "flow")} />;
}

function optionLine(r: LaneRow, v: "a" | "b"): string {
  const b = v === "a" ? r.a! : r.b;
  if (b.kind === "configurable" && b.value) return b.value;
  if (b.kind === "optional") return b.active ? "Optional · on" : "Optional · off";
  return "Required";
}

/** One block of the Version A chain: read-only, locked, dark ports when the step is off in production. */
function BlockA({ r, open, onToggle }: { r: LaneRow; open: boolean; onToggle: () => void }) {
  const a = r.a!;
  return (
    <div data-testid={`block-a-${r.id}`} className={cn("blk flex min-h-[64px] w-[128px] flex-col px-2.5 py-2", !a.active && "off", open && "open")}>
      <span aria-hidden className="port l" /><span aria-hidden className="port r" />
      <span className="flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[.12em] text-[#8EAEB7]">{r.kind === "required" && <Lock className="h-2.5 w-2.5" />}{r.stage}</span>
      <button type="button" aria-expanded={open} onClick={onToggle} className="mt-0.5 line-clamp-2 text-left text-[12.5px] font-semibold leading-tight text-[#E2F5F7] hover:underline">{r.name}</button>
      <span className="mt-auto truncate text-[10.5px] text-[#9FC2CB]">{optionLine(r, "a")}</span>
    </div>
  );
}

/** One block of the Version B chain: the editable one; its controls are the same ones the list rows carry. */
function BlockB({ r, open, onToggle, editable, busy, onSetOption, onSwitch, onRemove, welded, lit }: {
  r: LaneRow; open: boolean; onToggle: () => void; editable: boolean; busy: boolean;
  onSetOption: (v: string) => void; onSwitch: (on: boolean) => void; onRemove: () => void; welded: boolean; lit: boolean;
}) {
  const offB = !r.b.active;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const accent = r.deviation ? "bg-[#FF9B4C]" : r.b.active ? "bg-cyan/80" : "bg-transparent";
  return (
    <div id={`blk-${r.id}`} data-testid={`block-${r.id}`} data-welded={welded ? "true" : undefined} data-energized={lit ? "true" : undefined}
      className={cn("blk flex min-h-[64px] w-[136px] flex-col px-2.5 py-2", r.deviation && "inserted", offB && "off", open && "open", lit && "lit", welded && "seat charged")}>
      {welded && <span aria-hidden className="weld" style={{ left: -16, top: "calc(50% - 11px)" }} data-testid={`weld-${r.id}`} />}
      <span aria-hidden className={cn("absolute bottom-2 left-0 top-2 w-[3px] rounded-r", accent)} />
      <span aria-hidden className="port l" /><span aria-hidden className="port r" />
      <span className="flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[.12em] text-[#8EAEB7]">
        {r.kind === "required" && <Lock className="h-2.5 w-2.5" />}{r.stage}
        {r.changes > 0 && <span data-testid={`changes-${r.id}`} className="ml-auto rounded bg-[#FF9B4C]/20 px-1 font-sans text-[10px] font-semibold tracking-normal text-[#FFD09F]" title={`${r.changes} changed line${r.changes === 1 ? "" : "s"}`}>{r.changes}</span>}
        {editable && r.b.added && <button type="button" data-testid={`button-remove-${r.id}`} disabled={busy} onClick={(e) => { stop(e); onRemove(); }} aria-label={`Remove ${r.name} from Version B`} title="Remove" className="ml-auto rounded p-0.5 text-[#E6A274] hover:bg-white/10 hover:text-white disabled:opacity-40"><X className="h-3 w-3" /></button>}
      </span>
      <button type="button" aria-expanded={open} onClick={onToggle} className={cn("mt-0.5 line-clamp-2 text-left text-[12.5px] font-semibold leading-tight hover:underline", r.deviation === "added" ? "text-[#FFD9B8]" : "text-[#E2F5F7]", r.deviation === "off" && "line-through")}>{r.name}</button>
      <span className="mt-auto flex min-h-[18px] items-center gap-1 text-[10.5px] text-[#9FC2CB]" onClick={stop}>
        {editable && r.b.kind === "configurable" && (r.b.options ?? []).length > 0 ? (
          <select aria-label={`${r.name} setting`} data-testid={`select-${r.id}`} disabled={busy} value={r.b.value ?? ""} onChange={(e) => onSetOption(e.target.value)}
            className={cn("h-6 w-full min-w-0 truncate rounded border bg-[#0D3441] px-1 text-[10.5px] text-[#D9EFF2] outline-none focus:border-[#FF9B4C]", r.deviation === "setting" ? "border-[#CE7642]" : "border-[#2C7182]")}>
            {(r.b.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : editable && r.b.kind === "optional" && !r.b.added ? (
          <label className="inline-flex cursor-pointer items-center gap-1.5"><Switch aria-label={`Turn ${r.name} ${r.b.active ? "off" : "on"}`} data-testid={`switch-${r.id}`} checked={r.b.active} disabled={busy} onCheckedChange={onSwitch} className="h-4 w-7 data-[state=checked]:bg-[#FF9B4C] data-[state=unchecked]:bg-white/25 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3" />{r.b.active ? "on" : "off"}</label>
        ) : r.deviation === "added" ? <span className="truncate text-[#E6A274]">from {r.source}</span>
        : r.deviation === "setting" ? <span className="truncate"><span className="line-through opacity-70">{r.a?.value}</span> <ArrowRight className="inline h-2.5 w-2.5" /> <span className="text-[#FFD09F]">{r.b.value}</span></span>
        : <span className="truncate">{optionLine(r, "b")}</span>}
      </span>
    </div>
  );
}

/** A recorded capability request sits where it was asked for; it never runs. */
function RequestBlock({ req, editable, busy, onRemove }: { req: CapabilityRequest; editable: boolean; busy: boolean; onRemove: () => void }) {
  const id = `req:${req.id}`;
  return (
    <div data-testid={`block-${id}`} className="relative flex min-h-[64px] w-[136px] flex-col rounded-xl border border-dashed border-[#CE7642]/70 bg-[#3B2B26]/40 px-2.5 py-2 text-[#FFD9B8]" title={`Missing today: ${req.missing}`}>
      <span className="flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[.12em] text-[#E6A274]"><HelpCircle className="h-2.5 w-2.5" /> Requested
        {editable && <button type="button" data-testid={`button-remove-${id}`} disabled={busy} onClick={onRemove} aria-label="Remove request" title="Remove" className="ml-auto rounded p-0.5 text-[#E6A274] hover:bg-white/10 hover:text-white disabled:opacity-40"><X className="h-3 w-3" /></button>}
      </span>
      <span className="mt-0.5 truncate text-[12.5px] font-semibold italic leading-tight">{req.need}</span>
      <span className="mt-auto text-[10.5px] text-[#E6A274]" data-testid={`tag-not-built-${req.id}`}>Not built yet · does not run</span>
    </div>
  );
}

/** A dashed socket at an allowed insertion point. Compact between blocks, labelled at the end of the chain and while dragging.
 *  The droppable ref stays on one wrapper across states so dnd-kit re-measures it when it grows at drag start. */
function Socket({ id, afterName, dragging, openId, setOpenId, full }: { id: string; afterName: string | null; dragging: boolean; openId: string | null; setOpenId: (id: string | null) => void; full: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${id}` });
  const open = openId === id;
  const label = afterName ? `Add a step after ${afterName}` : "Add a step";
  return (
    <div ref={setNodeRef} className="flex items-center">
      {dragging ? (
        <div data-testid={`drop-${id}`} data-over={isOver ? "true" : "false"} className={cn("socket grid min-h-[64px] w-[96px] place-items-center px-2 text-center text-[11px] font-semibold leading-tight", isOver ? "socket-over border-orange text-[#FFD09F]" : "socket-ready")}>
          <span className="inline-flex flex-col items-center gap-1"><span className={cn("inline-block h-2 w-2 rounded-full", isOver ? "bg-orange" : "bg-cyan")} />{isOver ? "Release to connect" : "Drop to connect"}</span>
        </div>
      ) : full ? (
        <button type="button" data-testid={`button-add-slot-${id}`} aria-label={label} aria-expanded={open} onClick={() => setOpenId(open ? null : id)}
          className={cn("socket flex min-h-[64px] w-[150px] flex-col items-center justify-center px-2 text-center", open && "border-orange text-[#FFD09F]")}>
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold"><Plus className="h-3.5 w-3.5" /> Connect component</span>
          <span className="mt-0.5 text-[9.5px] opacity-80">drop here or click library</span>
        </button>
      ) : (
        <button type="button" data-testid={`button-add-slot-${id}`} aria-label={label} aria-expanded={open} title="Connect component here" onClick={() => setOpenId(open ? null : id)}
          className={cn("socket grid h-6 w-6 shrink-0 place-items-center rounded-full", open && "border-orange text-[#FFD09F]")}>
          <Plus className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function ChainDrop({ enabled, dragging, children }: { enabled: boolean; dragging: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "workflow-b", disabled: !enabled });
  return <div ref={setNodeRef} data-testid="workflow-b" className={cn("schem-row editable rounded-2xl p-3.5 transition-[box-shadow]", dragging && "shadow-[inset_0_0_0_2px_hsl(var(--cyan)/.5)]", dragging && isOver && "shadow-[inset_0_0_0_2px_hsl(var(--cyan)/.9)]")}>{children}</div>;
}

/* ---------- The viewport ---------- */

export function Schematic({ lane, rows, aLabel, editable, busy, open, onToggle, onSetOption, onSwitch, onRemove, onRemoveRequest, requestBusy, dragging, slotOpen, setSlotOpen, welded, energized, running, status, tools, changes }: {
  lane: LaneEntry[]; rows: LaneRow[]; aLabel: string; editable: boolean; busy: boolean;
  open: Set<string>; onToggle: (id: string) => void;
  onSetOption: (r: LaneRow, v: string) => void; onSwitch: (r: LaneRow, on: boolean) => void; onRemove: (r: LaneRow) => void;
  onRemoveRequest: (req: CapabilityRequest) => void; requestBusy: boolean;
  dragging: boolean; slotOpen: string | null; setSlotOpen: (id: string | null) => void;
  /** Step the server just confirmed joined Version B (seat + weld), steps a real run lit, and whether a run is in flight. */
  welded: string | null; energized: Set<string>; running: boolean;
  /** Footer status text, e.g. "Connected: Safety Signals · source Incident Commander". */
  status: string; tools?: ReactNode; changes: number;
}) {
  const aRows = rows.filter((r) => r.a);
  const flowA = running && aRows.length > 0;
  return (
    <section className="schem relative" data-testid="schematic-viewport" aria-label="Live workflow schematic">
      <div className="relative z-10 flex flex-wrap items-center gap-2 px-5 pt-4">
        <span className="text-[13.5px] font-semibold text-[#EAF9FB]">Live workflow schematic</span>
        <span className="font-mono text-[10px] uppercase tracking-[.1em] text-[#7AA9B9]">{aRows.length} current · {rows.length} proposed</span>
        <span className="ml-auto inline-flex items-center gap-1">{tools}</span>
      </div>
      <div className="relative z-10 space-y-3 px-5 pb-3 pt-3">
        {/* A: locked baseline */}
        <div className="schem-row p-3.5" data-testid="workflow-a">
          <div className="mb-3 flex items-center justify-between gap-3 font-mono text-[10.5px] font-semibold uppercase tracking-[.08em]">
            <span className="text-[#D9F2F4]">A · Current</span>
            <span className="truncate text-[#88AEB9]" data-testid="text-lane-a-label">Locked · {aLabel}</span>
          </div>
          <div className="flex flex-wrap items-center gap-y-3">
            {aRows.map((r, i) => (
              <div key={r.id} className="flex items-center">
                {i > 0 && <Wire flow={flowA && r.a!.active} />}
                <BlockA r={r} open={open.has(r.id)} onToggle={() => onToggle(r.id)} />
              </div>
            ))}
          </div>
        </div>
        {/* B: the experimental chain with its sockets */}
        <ChainDrop enabled={editable} dragging={dragging}>
          <div className="mb-3 flex items-center justify-between gap-3 font-mono text-[10.5px] font-semibold uppercase tracking-[.08em]">
            <span className="text-[#FFE3CB]">B · Proposed</span>
            <span className="text-[#E6A274]">Experimental · {changes === 0 ? "no changes yet" : `${changes} change${changes === 1 ? "" : "s"} from A`}</span>
          </div>
          <div className="flex flex-wrap items-center gap-y-3">
            {lane.map((x, i) => {
              const isLast = i === lane.length - 1;
              if (x.kind === "request") {
                return (
                  <div key={`req:${x.req.id}`} className="flex items-center">
                    {i > 0 && <Wire hot />}
                    <RequestBlock req={x.req} editable={editable} busy={requestBusy} onRemove={() => onRemoveRequest(x.req)} />
                    {editable && isLast && <><Wire /><Socket id="end" afterName={null} dragging={dragging} openId={slotOpen} setOpenId={setSlotOpen} full /></>}
                  </div>
                );
              }
              const r = x.row;
              const hot = r.deviation === "added" || welded === r.id;
              return (
                <div key={r.id} className="flex items-center">
                  {i > 0 && <Wire hot={hot} flow={running && r.b.active} />}
                  <BlockB r={r} open={open.has(r.id)} onToggle={() => onToggle(r.id)} editable={editable} busy={busy}
                    onSetOption={(v) => onSetOption(r, v)} onSwitch={(on) => onSwitch(r, on)} onRemove={() => onRemove(r)} welded={welded === r.id} lit={energized.has(r.id)} />
                  {editable && <><Wire hot={hot && isLast} flow={running && r.b.active && !isLast} /><Socket id={r.id} afterName={r.name} dragging={dragging} openId={slotOpen} setOpenId={setSlotOpen} full={isLast} /></>}
                </div>
              );
            })}
          </div>
        </ChainDrop>
      </div>
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-white/10 px-5 py-2.5 text-[11px] text-[#87AAB5]">
        <span>{editable ? "Snap components into the sockets · click a block to inspect it · locked steps stay in place" : "Governance view: inspect any block; Version B cannot be changed here"}</span>
        <span className="font-mono text-[11px] tracking-[.02em] text-[#9ED9E3]" data-testid="text-connect-status" aria-live="polite">{status}</span>
      </div>
    </section>
  );
}

/* ---------- Inspector: the open steps, with the same A/B trace and diff lines the list rows show ---------- */

export function StepDetail({ r, no, labelA, labelB, picked, onPick, explanation, onClose }: {
  r: LaneRow; no: number; labelA: string; labelB: string; picked: DiffEntry | null; onPick: (e: DiffEntry) => void; explanation: string[]; onClose: () => void;
}) {
  const removed = r.entries.filter((e) => e.change === "removed");
  const addedOrChanged = r.entries.filter((e) => e.change !== "removed");
  const dev = deviationLabel(r);
  return (
    <section id={`row-${r.id}`} data-testid={`row-${r.id}`} className="card-soft reveal scroll-mt-[calc(var(--shell-top)+5.25rem)] p-4" aria-label={`${r.name} detail`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full border border-border text-[11px] font-semibold text-muted-foreground">{r.deviation === "added" ? "+" : no}</span>
        <span className="font-mono text-[10.5px] uppercase tracking-[.12em] text-muted-foreground">{r.stage}</span>
        <h3 className="text-[16px] font-semibold text-primary">{r.name}</h3>
        {dev && <Tag tone="sienna">{dev}{r.deviation === "added" ? ` · ${r.source}` : ""}</Tag>}
        {r.inputChanged && <Tag tone="slate" testid={`mark-input-changed-${r.id}`}>input changed</Tag>}
        <button type="button" onClick={onClose} aria-label={`Close ${r.name}`} data-testid={`button-close-${r.id}`} className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
      </div>
      <p className="mb-3 text-[13px] text-muted-foreground">{r.description}</p>
      <div className={cn(laneGrid, "gap-y-3 max-lg:grid-cols-1")}>
        <div className="card-block p-3.5">
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold"><span className="grid h-5 w-5 place-items-center rounded bg-primary text-[11px] text-white">A</span>{r.a ? "Current product" : "Not in the current product"}</div>
          {r.a ? <><TraceBody t={r.traceA} label={labelA} /><DiffLines entries={removed} picked={picked} onPick={onPick} title={`Lines only A produced (${removed.length})`} /></>
            : <p className="text-[13px] text-muted-foreground">This step only runs in Version B.</p>}
        </div>
        <div className="hidden lg:block" />
        <div className={cn("card-block p-3.5", r.deviation && "border-sienna/50")}>
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold"><span className="grid h-5 w-5 place-items-center rounded bg-siennaink text-[11px] text-white">B</span>Proposed version</div>
          {!r.b.active ? <p className="text-[13px] text-muted-foreground">Switched off in Version B, so it does not run.</p> : <TraceBody t={r.traceB} label={labelB} />}
          <DiffLines entries={addedOrChanged} picked={picked} onPick={onPick} title={`Lines this step ${r.entries.some((e) => e.change === "changed") && !r.entries.some((e) => e.change === "added") ? "changed" : "added"} in B (${addedOrChanged.length})`} />
        </div>
      </div>
      {explanation.length > 0 && <div className="mt-3 rounded-lg bg-[hsl(196_30%_93%)] px-3 py-2 text-[13px] text-skyink" data-testid={`explanation-${r.id}`}>{explanation.map((x, i) => <div key={i}>{x}</div>)}</div>}
    </section>
  );
}
