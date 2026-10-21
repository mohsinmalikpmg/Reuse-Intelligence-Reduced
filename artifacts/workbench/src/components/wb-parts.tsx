import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { ChevronDown, FileText, GripVertical, Plus } from "lucide-react";
import type { ComponentConfig, EvaluationSummary, SampleInput } from "@workspace/api-client-react";
import { Textarea } from "@/components/ui/textarea";
import { Tag, btn } from "@/components/bits";
import { cn } from "@/lib/utils";

export function InputPanel({ samples, sampleId, text, edited, onPick, onText, compact }: {
  samples: SampleInput[]; sampleId: string; text: string; edited: boolean; onPick: (s: SampleInput) => void; onText: (t: string) => void; compact?: boolean;
}) {
  const [open, setOpen] = useState(!compact);
  return (
    <div data-testid="panel-input">
      <div className="mb-2 flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /><span className="text-[14px] font-semibold text-primary">Input</span>{edited && <Tag tone="sienna">Edited</Tag>}</div>
      <div className={cn("flex gap-1.5", compact ? "flex-wrap" : "flex-col")} role="radiogroup" aria-label="Sample input">
        {samples.map((s) => (
          <button key={s.id} role="radio" aria-checked={sampleId === s.id && !edited} data-testid={`sample-${s.id}`} onClick={() => onPick(s)}
            className={cn("rounded-lg border px-3 py-2 text-left transition-colors", sampleId === s.id && !edited ? "border-primary bg-secondary" : "border-border bg-card hover:border-primary/40")}>
            <span className="block text-[13.5px] font-semibold leading-tight">{s.name}</span>
            <span className="block text-[12px] text-muted-foreground">{s.noteCount} note{s.noteCount === 1 ? "" : "s"}{s.hasExpected ? " · labelled findings" : ""}</span>
          </button>
        ))}
      </div>
      <button data-testid="button-toggle-input-text" onClick={() => setOpen((v) => !v)} className={cn(btn.quiet, "mt-2 px-1")}><ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} /> {open ? "Hide text" : "View or edit text"}</button>
      {open && <Textarea data-testid="input-sample-text" value={text} onChange={(e) => onText(e.target.value)} className="mt-1 min-h-[200px] font-mono text-[12.5px] leading-relaxed" placeholder="Paste work-order notes, one per line." />}
    </div>
  );
}

export function Tray({ recs, more, busy, enabled, onAdd }: { recs: ComponentConfig[]; more: ComponentConfig[]; busy: boolean; enabled: boolean; onAdd: (c: ComponentConfig) => void }) {
  const [showMore, setShowMore] = useState(false);
  return (
    <div data-testid="panel-tray">
      <div className="mb-2 text-[14px] font-semibold text-primary">Capabilities</div>
      {!enabled && <p className="mb-2 text-[12.5px] text-muted-foreground">Create a B version to add these.</p>}
      {recs.length === 0 && more.length === 0 && <p className="text-[13px] text-muted-foreground">Every compatible capability is already in Version B.</p>}
      <div className="space-y-2">{recs.map((c) => <TrayItem key={c.capability.id} c={c} rec busy={busy} enabled={enabled} onAdd={onAdd} />)}</div>
      {more.length > 0 && <>
        <button data-testid="button-tray-more" onClick={() => setShowMore((v) => !v)} className={cn(btn.quiet, "mt-1 px-1")}><ChevronDown className={cn("h-4 w-4 transition-transform", showMore && "rotate-180")} /> {showMore ? "Less" : `More (${more.length})`}</button>
        {showMore && <div className="mt-1 space-y-2">{more.map((c) => <TrayItem key={c.capability.id} c={c} busy={busy} enabled={enabled} onAdd={onAdd} />)}</div>}
      </>}
    </div>
  );
}

function TrayItem({ c, rec, busy, enabled, onAdd }: { c: ComponentConfig; rec?: boolean; busy: boolean; enabled: boolean; onAdd: (c: ComponentConfig) => void }) {
  const blocked = c.state === "incompatible" || !!c.blockedReason;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `add:${c.capability.id}`, disabled: !enabled || busy || blocked });
  return (
    <div ref={setNodeRef} data-testid={`tray-${c.capability.id}`} className={cn("flex items-start gap-1.5 rounded-lg border bg-card p-2", rec ? "border-sienna/50" : "border-border", isDragging && "opacity-30", blocked && "opacity-60")}>
      {enabled && !blocked && <button {...listeners} {...attributes} aria-label={`Drag ${c.capability.name} into Version B`} data-testid={`handle-${c.capability.id}`} className="cursor-grab touch-none self-stretch rounded px-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"><GripVertical className="h-4 w-4" /></button>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5"><span className="text-[13.5px] font-semibold leading-tight">{c.capability.name}</span></div>
        {rec && <span className="text-[11px] font-semibold uppercase tracking-wide text-siennaink">Recommended</span>}
        <div className="text-[12px] text-muted-foreground">{blocked ? c.blockedReason ?? "Not compatible with this workflow" : `From ${c.sourceSolutionName}`}</div>
      </div>
      <button data-testid={`button-add-${c.capability.id}`} disabled={!enabled || busy || blocked} onClick={() => onAdd(c)} className="inline-flex min-h-8 items-center gap-1 rounded-md bg-primary px-2 text-[12.5px] font-semibold text-white hover:bg-[hsl(191_30%_23%)] disabled:opacity-40"><Plus className="h-3.5 w-3.5" />Add</button>
    </div>
  );
}

export function SummaryCounts({ s, testid }: { s: EvaluationSummary; testid?: string }) {
  const cells = [
    { k: "tests", l: "Tests completed", v: s.tests },
    { k: "a", l: "A preferred", v: s.aPreferred },
    { k: "b", l: "B preferred", v: s.bPreferred },
    { k: "neither", l: "Neither", v: s.neither },
  ];
  return (
    <div data-testid={testid ?? "summary-evaluations"}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cells.map((c) => <div key={c.k} className="rounded-lg bg-muted/70 px-3 py-2"><div data-testid={`count-${c.k}`} className="text-[22px] font-bold text-primary">{c.v}</div><div className="text-[12px] text-muted-foreground">{c.l}</div></div>)}
      </div>
      <p className="mt-2 text-[12.5px] text-muted-foreground">
        Counted only from recorded votes · {s.distinctInputs} distinct input{s.distinctInputs === 1 ? "" : "s"} · {s.blindVotes} blind
        {s.averageRating !== null && <> · average usefulness {s.averageRating.toFixed(1)} / 5</>}
        {s.demoVotes > 0 && <> · <span className="font-semibold text-siennaink">{s.demoVotes} demo vote{s.demoVotes === 1 ? "" : "s"} (demonstration data)</span></>}
      </p>
    </div>
  );
}
