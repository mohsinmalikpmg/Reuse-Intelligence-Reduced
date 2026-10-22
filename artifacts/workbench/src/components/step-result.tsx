import type { DiffEntry, StepTrace } from "@workspace/api-client-react";
import { useRole } from "@/lib/persona";
import { cn } from "@/lib/utils";
import { entryKey, localDiff, markOf, sideMarks, stepSnapshot, type Mark, type Snapshot } from "@/lib/step-output";

const BADGE: Record<Mark, { l: string; cls: string; row: string }> = {
  new: { l: "New", cls: "bg-okbg text-ok", row: "bg-okbg/50" },
  removed: { l: "Not in B", cls: "bg-muted text-muted-foreground", row: "bg-muted/50 text-muted-foreground" },
  changed: { l: "Changed", cls: "bg-accent text-siennaink", row: "bg-accent/50" },
  ranking: { l: "Ranked", cls: "border border-primary/30 bg-secondary text-secondary-foreground", row: "" },
};
export const snapshotFor = (t: StepTrace | null, active: boolean): Snapshot => stepSnapshot(t, active);

/**
 * What one step wrote on one side, at the moment it ran, compared with the same step's snapshot on the other side.
 * Final-output diff entries are used only to open the matching final line; they never add lines here.
 */
export function StepResult({ t, active, other, otherActive, side, label, entries, picked, onPick }: {
  t: StepTrace | null; active: boolean; other: StepTrace | null; otherActive: boolean; side: "A" | "B"; label: string;
  entries: DiffEntry[]; picked: DiffEntry | null; onPick: (e: DiffEntry) => void;
}) {
  const role = useRole();
  const snap = snapshotFor(t, active);
  const otherSnap = snapshotFor(other, otherActive);
  const local = side === "A" ? localDiff(snap, otherSnap) : localDiff(otherSnap, snap);
  const marks = sideMarks(local ?? [], side);
  const finalByKey = new Map(entries.map((e) => [entryKey(e.sectionKey, e.itemKey), e]));
  const head = <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}{t && t.status !== "error" && <span className="normal-case tracking-normal">· {t.outputSummary}</span>}</div>;
  const error = t?.error ? <p className="text-[13px] text-bad" data-testid={`step-error-${side.toLowerCase()}`}>{t.error}</p> : null;

  if (snap.kind === "not-run") return <div data-testid={`step-result-${side.toLowerCase()}`}>{head}<p className="text-[13px] text-muted-foreground">{snap.why === "off" ? "Switched off here, so this step did not run." : snap.why === "skipped" ? "Skipped in this run; it produced nothing." : "Not run yet."}</p></div>;
  if (snap.kind === "unavailable") return <div data-testid={`step-result-${side.toLowerCase()}`}>{head}{error}<p className="text-[13px] text-muted-foreground">Run again to see this step's own output.</p></div>;

  return (
    <div data-testid={`step-result-${side.toLowerCase()}`}>
      {head}{error}
      {snap.sections.every((s) => s.items.length === 0) && !error && <p className="text-[13px] text-muted-foreground">Ran, wrote no lines.</p>}
      {snap.sections.filter((s) => s.items.length).map((s) => (
        <div key={s.key} className="mb-2">
          <div className="text-[11px] text-muted-foreground">{s.title}</div>
          <ul className="mt-0.5 space-y-0.5">{s.items.map((it) => {
            const k = entryKey(s.key, it.key);
            const e = marks.get(k);
            const fin = finalByKey.get(k);
            const b = e ? BADGE[markOf(e)] : null;
            return (
              <li key={it.id}>
                <button type="button" disabled={!fin} onClick={() => fin && onPick(fin)} data-testid="step-line" title={fin ? "Show in final output" : undefined}
                  className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-[13px] leading-snug disabled:cursor-default", b?.row, fin && picked === fin && "shadow-[inset_0_0_0_2px_hsl(var(--primary))]")}>
                  <span className="min-w-0 flex-1">{it.text}
                    {e && side === "B" && e.change === "changed" && e.before && <span className="block text-[11.5px] text-muted-foreground">A: {e.before}</span>}
                    {role === "it" && it.originStepId && it.originStepId !== it.stepId && <span className="block text-[11px] text-muted-foreground">found by {it.originStepId}, written by {it.stepId}</span>}
                  </span>
                  {b && <span className={cn("shrink-0 rounded px-1.5 text-[10.5px] font-semibold", b.cls)}>{b.l}</span>}
                </button>
              </li>
            );
          })}</ul>
        </div>
      ))}
      {role === "it" && t && <details className="mt-1 text-[12px] text-muted-foreground"><summary className="cursor-pointer">How it ran</summary><p className="mt-1">Received: {t.inputSummary}</p><p>Did: {t.transformation}</p><p>{t.itemCount} items · {t.durationMs} ms · {t.status}</p></details>}
    </div>
  );
}
