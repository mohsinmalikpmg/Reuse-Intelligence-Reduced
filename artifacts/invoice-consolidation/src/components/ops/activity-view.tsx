import type { DecisionEvent } from "@/domain/engine";
import { stamp } from "./shared";

export function ActivityView({ ledger, onOpen, onUndo, canUndo }: { ledger: readonly DecisionEvent[]; onOpen: (id: string, ev?: string) => void; onUndo: () => void; canUndo: boolean }) {
  if (!ledger.length) return (
    <div className="border border-dashed border-border p-10 text-center">
      <p className="font-display text-xl">No decisions yet.</p>
      <p className="mt-1 text-sm text-muted-foreground">Every approval step and rejection recorded in this snapshot appears here, newest first.</p>
    </div>
  );
  const groups: { key: string; events: DecisionEvent[] }[] = [];
  for (const e of [...ledger].reverse()) {
    const k = e.batchId ?? e.id; const last = groups[groups.length - 1];
    if (last && last.key === k) last.events.push(e); else groups.push({ key: k, events: [e] });
  }
  return (
    <div className="space-y-5">
      {canUndo && <div className="flex justify-end"><button onClick={onUndo} title="Demo exception: removes the last batch from this browser-only ledger" className="border border-border bg-card px-3 py-1.5 text-xs hover:border-foreground/40">Undo last batch (demo)</button></div>}
      {groups.map(g => (
        <section key={g.key} className="grid gap-3 md:grid-cols-[10rem_1fr]">
          <div className="text-xs">
            <p className="num text-accent">{g.events[0].batchId ?? "Single event"}</p>
            <p className="num text-muted-foreground">{stamp(g.events[0].at)}</p>
            <p className="mt-1 capitalize text-muted-foreground">{g.events[0].role}</p>
          </div>
          <ol className="border border-border bg-card text-sm">
            {g.events.map(e => (
              <li key={e.id} className="grid grid-cols-[3rem_1fr] gap-3 border-b border-border/60 px-4 py-2 last:border-0 md:grid-cols-[3rem_1fr_auto]">
                <button onClick={() => onOpen(e.invoiceId)} className="num text-left text-xs underline decoration-accent underline-offset-2">{e.invoiceId}</button>
                <span><span className="capitalize">{e.action}</span> <span className="num text-xs text-muted-foreground">{e.fromStatus}/{e.fromStage ?? "-"} &rarr; {e.toStatus}/{e.toStage ?? "-"}</span>{e.reason && <span className="block text-xs text-muted-foreground">"{e.reason}"</span>}</span>
                <button data-testid={`link-event-${e.id}`} onClick={() => onOpen(e.invoiceId, e.id)} title="Open this event in the invoice history" className="num col-start-2 text-left text-[11px] text-muted-foreground underline md:col-start-auto md:text-right">#{e.seq} <time dateTime={e.at}>{stamp(e.at)}</time></button>
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">Isolated to this recipe snapshot, in this browser only. Not append-only: as a demo exception, undo deletes the last batch.</p>
    </div>
  );
}
