import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Info, Minus, Plus, RefreshCw } from "lucide-react";
import {
  getListCaseEvaluationsQueryKey, useListCaseEvaluations, useRecordEvaluation, type ABComparison, type DiffEntry, type EvaluationChoice, type ObjectiveScore, type Role,
} from "@workspace/api-client-react";
import { OutputView, RunMeta } from "@/components/output-view";
import { SummaryCounts } from "@/components/wb-parts";
import { Tag, useUndoToast } from "@/components/bits";
import { errMsg, useInvalidateCase, useMe } from "@/lib/case";
import { cn } from "@/lib/utils";

export function CompareOutputs({ cmp, picked, onPick }: { cmp: ABComparison; picked: DiffEntry | null; onPick: (e: DiffEntry) => void }) {
  const marks = new Map(cmp.diff.entries.map((e) => [e.itemKey, e]));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {(["A", "B"] as const).map((v) => {
        const run = v === "A" ? cmp.runA : cmp.runB;
        return (
          <div key={v} className={cn("card-soft p-5", v === "B" && "border-t-4 border-t-sienna")}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className={cn("grid h-7 w-7 place-items-center rounded-md text-[13px] font-bold text-white", v === "A" ? "bg-primary" : "bg-siennaink")}>{v}</span>
              <span className="text-[14px] font-semibold">{v === "A" ? "Current product" : "Proposed version"}</span>
              <span className="ml-auto"><RunMeta run={run} testid={`run-meta-${v}`} /></span>
            </div>
            <OutputView output={run.output} marks={marks} selectedKey={picked?.itemKey} onPick={onPick} testid={`output-${v.toLowerCase()}`} dim={v === "B" && cmp.staleB} />
          </div>
        );
      })}
    </div>
  );
}

export function DiffSummary({ cmp, picked, onPick }: { cmp: ABComparison; picked: DiffEntry | null; onPick: (e: DiffEntry) => void }) {
  const d = cmp.diff;
  if (d.entries.length === 0) return <div data-testid="text-no-diff" className="rounded-xl bg-muted/70 p-4 text-[14.5px]">Both versions produced the same output for this input.</div>;
  const icon = { added: Plus, removed: Minus, changed: RefreshCw };
  return (
    <div className="card-soft p-5" data-testid="panel-diff">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[16px] font-semibold">What changed</h3>
        <Tag tone="green">{d.added} new</Tag><Tag>{d.removed} removed</Tag><Tag tone="sienna">{d.changed} changed</Tag>
        <span className="text-[12.5px] text-muted-foreground">{d.unchanged} unchanged</span>
      </div>
      {cmp.explanation.length > 0 && <ul className="mt-2 space-y-1 text-[14px]" data-testid="list-explanation">{cmp.explanation.map((x, i) => <li key={i} className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-skyink" />{x}</li>)}</ul>}
      <div className="mt-3 text-[12.5px] text-muted-foreground">Click a change to see which step caused it.</div>
      <ul className="mt-2 max-h-[260px] space-y-1 overflow-y-auto pr-1">
        {d.entries.map((e, i) => {
          const I = icon[e.change];
          return (
            <li key={i}>
              <button data-testid="diff-line" onClick={() => onPick(e)} className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] hover:bg-muted", picked === e && "bg-secondary shadow-[inset_0_0_0_1px_hsl(var(--primary)/.4)]")}>
                <I className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", e.change === "added" ? "text-ok" : e.change === "removed" ? "text-muted-foreground" : "text-siennaink")} />
                <span className="min-w-0 flex-1">{e.after ?? e.before}</span>
                <span className="shrink-0 text-[12px] text-muted-foreground">{e.stepName}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {d.stepsResponsible.length > 0 && <p className="mt-3 text-[13px] text-muted-foreground">Steps responsible: {d.stepsResponsible.map((s) => `${s.name} (${s.changes}, from ${s.sourceSolutionName})`).join(" · ")}</p>}
    </div>
  );
}

export function Measures({ cmp }: { cmp: ABComparison }) {
  const rows: [string, string | number, string | number][] = [
    ["Runtime", `${cmp.runA.durationMs} ms`, `${cmp.runB.durationMs} ms`],
    ["Steps executed", cmp.runA.stats.steps, cmp.runB.stats.steps],
    ["Output sections", cmp.runA.stats.sections, cmp.runB.stats.sections],
    ["Issues identified", cmp.runA.stats.issues, cmp.runB.stats.issues],
    ["Recurring patterns", cmp.runA.stats.patterns, cmp.runB.stats.patterns],
    ["Actions produced", cmp.runA.stats.actions, cmp.runB.stats.actions],
    ["Errors", cmp.runA.stats.errors, cmp.runB.stats.errors],
  ];
  const pct = (n: number | null) => (n === null ? "n/a" : `${(n * 100).toFixed(0)}%`);
  const score = (s: ObjectiveScore) => `${s.identified}/${s.expected} found · ${s.falsePositives} false positive${s.falsePositives === 1 ? "" : "s"} · precision ${pct(s.precision)} · recall ${pct(s.recall)}`;
  return (
    <details open className="card-soft group p-5" data-testid="panel-measures">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[15px] font-semibold text-primary">
        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
        Recorded measures <span className="text-[13px] font-normal text-muted-foreground">(counts from these two runs only)</span>
      </summary>
      <table className="mt-3 w-full text-[13.5px]">
        <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium" /><th className="py-1 font-medium">A</th><th className="py-1 font-medium">B</th></tr></thead>
        <tbody>{rows.map(([l, a, b]) => <tr key={l} className="border-t border-border"><td className="py-1.5">{l}</td><td data-testid={`measure-a-${l}`}>{a}</td><td data-testid={`measure-b-${l}`}>{b}</td></tr>)}</tbody>
      </table>
      <div className="mt-3 text-[13.5px]" data-testid="text-objective">
        {cmp.scoreA && cmp.scoreB ? (
          <><div className="font-semibold">Against labelled expected findings</div><div>A: {score(cmp.scoreA)}</div><div>B: {score(cmp.scoreB)}</div></>
        ) : <span className="text-muted-foreground">No labelled expected findings for this input, so no accuracy is claimed.</span>}
      </div>
      <p className="mt-2 text-[12.5px] text-muted-foreground">A longer or more detailed output is not evidence that it is more accurate.</p>
    </details>
  );
}

export function Vote({ cmp, role }: { cmp: ABComparison; role: Role }) {
  const me = useMe();
  const rec = useRecordEvaluation();
  const evals = useListCaseEvaluations(cmp.caseId, { query: { enabled: !!cmp.caseId, queryKey: getListCaseEvaluationsQueryKey(cmp.caseId) } });
  const invalidate = useInvalidateCase();
  const qc = useQueryClient();
  const say = useUndoToast();
  const [reason, setReason] = useState("");
  const done = cmp.evaluation;
  const cast = (choice: EvaluationChoice) =>
    rec.mutate({ caseId: cmp.caseId, data: { runAId: cmp.runA.id, runBId: cmp.runB.id, choice, reason: reason.trim() || undefined, role, evaluator: me?.name ?? role } }, {
      onSuccess: () => { invalidate(cmp.caseId); qc.invalidateQueries({ queryKey: getListCaseEvaluationsQueryKey(cmp.caseId) }); say("Preference recorded."); setReason(""); },
      onError: (e) => say(errMsg(e)),
    });
  const opts: { c: EvaluationChoice; l: string; id: string }[] = [{ c: "A", l: "A is better", id: "vote-a" }, { c: "B", l: "B is better", id: "vote-b" }, { c: "neither", l: "Neither is good enough", id: "vote-neither" }];
  return (
    <section className="card-soft p-6" data-testid="panel-vote">
      <h3 className="text-[20px] font-semibold">Which result better solves the problem?</h3>
      {cmp.staleB && <p className="mt-1 text-[13.5px] text-siennaink">Version B has changed since this run. Run both again before voting.</p>}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {opts.map((o) => (
          <button key={o.c} data-testid={o.id} disabled={rec.isPending || cmp.staleB} onClick={() => cast(o.c)}
            className={cn("flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 px-4 text-[16px] font-semibold transition-colors disabled:opacity-50",
              done?.choice === o.c ? "border-sienna bg-accent text-accent-foreground" : "border-input bg-card text-primary hover:border-primary")}>
            {done?.choice === o.c && <Check className="h-5 w-5" />}{o.l}
          </button>
        ))}
      </div>
      <input data-testid="input-vote-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Optional: one sentence on why"
        className="mt-3 h-11 w-full rounded-xl border border-input bg-card px-3 text-[14.5px] outline-none focus:border-primary" />
      {done && <p className="mt-2 text-[13px] text-muted-foreground" data-testid="text-vote-recorded">You picked {done.choice === "neither" ? "neither" : done.choice}{done.reason ? `: "${done.reason}"` : ""}. Voting again replaces it.</p>}
      {evals.data && evals.data.summary.tests > 0 && <div className="mt-5 border-t border-border pt-4"><SummaryCounts s={evals.data.summary} /></div>}
    </section>
  );
}

export function StaleHint({ onRun, busy }: { onRun: () => void; busy: boolean }) {
  return (
    <div data-testid="hint-stale" className="reveal flex items-center gap-3 rounded-lg bg-accent/70 px-3 py-2 text-[13.5px] text-accent-foreground">
      Version B changed since the last run.
      <button data-testid="button-rerun" onClick={onRun} disabled={busy} className="font-semibold underline underline-offset-2">Run both again</button>
    </div>
  );
}
