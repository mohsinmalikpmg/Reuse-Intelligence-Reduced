import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight } from "lucide-react";
import {
  getListCaseEvaluationsQueryKey, useListCaseEvaluations, useRecordEvaluation, type ABComparison, type EvaluationChoice, type ObjectiveScore, type Role,
} from "@workspace/api-client-react";
import { SummaryCounts } from "@/components/wb-parts";
import { useUndoToast } from "@/components/bits";
import { errMsg, useInvalidateCase, useMe } from "@/lib/case";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { caseCompositionOptions } from "@/lib/composition";
import { RequirementLedger } from "@/components/requirement-ledger";

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
    <details className="card-soft group p-5" data-testid="panel-measures">
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
      <ABLedger caseId={cmp.caseId} />
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
      {cmp.staleB && <p className="mt-1 text-[13.5px] text-siennaink">Version B has changed since this run. Fuse A/B again before voting.</p>}
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
      {role !== "seeker" && evals.data && (evals.data.summary.tests > 0 || evals.data.setAside > 0) && (
        <div className="mt-5 border-t border-border pt-4">
          {evals.data.summary.tests > 0 ? <SummaryCounts s={evals.data.summary} /> : <p className="text-[13.5px] text-muted-foreground" data-testid="text-no-current-votes">No votes yet for the current Version B.</p>}
          {evals.data.setAside > 0 && <p className="mt-2 text-[12.5px] text-muted-foreground" data-testid="text-set-aside">{evals.data.setAside} vote{evals.data.setAside === 1 ? "" : "s"} from earlier configurations (set aside, not counted above).</p>}
        </div>
      )}
    </section>
  );
}

export function StaleHint({ onRun, busy }: { onRun: () => void; busy: boolean }) {
  return (
    <div data-testid="hint-stale" className="reveal flex items-center gap-3 rounded-lg bg-accent/70 px-3 py-2 text-[13.5px] text-accent-foreground">
      Version B changed since the last run.
      <button data-testid="button-rerun" onClick={onRun} disabled={busy} className="font-semibold underline underline-offset-2">Fuse A/B again</button>
    </div>
  );
}

/** A/B results read against the complete original need, including what these runs cannot check. */
function ABLedger({ caseId }: { caseId: string }) {
  const q = useQuery(caseCompositionOptions(caseId));
  if (!q.data) return null;
  return <div className="mt-4" data-testid="ab-requirement-ledger"><p className="mb-2 text-[12.5px] text-muted-foreground">These runs do not test requirements or constraints outside the executable demo.</p><RequirementLedger c={q.data} /></div>;
}
