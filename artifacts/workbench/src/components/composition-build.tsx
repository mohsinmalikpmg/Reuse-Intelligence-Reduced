import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Layers, RotateCcw } from "lucide-react";
import { btn } from "@/components/bits";
import { cn } from "@/lib/utils";
import {
  clearAfterSuccess, createMsg, compStatus, compositionHref, forgetBrief, keyForRequest, loadDraft, loginHref, saveDraft, useConfirmedIntake, useCreateComposition,
} from "@/lib/composition";
import { readinessOf, type Entry } from "./seeker-library-model";

const field = "h-11 w-full min-w-0 rounded-xl border border-input bg-card px-3 text-[14.5px] outline-none focus:border-primary";

/** One shared action for 2-3 compared solutions: ask for a source-grounded recommendation and save it as a draft. */
export function BuildFromSelected({ picked, pinned, onRepin }: { picked: Entry[]; pinned: Record<string, string>; onRepin: (ids: string[]) => void }) {
  const [, navigate] = useLocation();
  const create = useCreateComposition();
  const [d, setD] = useState(loadDraft);
  const [err, setErr] = useState<{ status: number; msg: string } | null>(null);
  useEffect(() => { saveDraft({ ...loadDraft(), desiredOutcome: d.desiredOutcome, targetGroup: d.targetGroup, idempotencyKey: d.idempotencyKey, keyFor: d.keyFor, open: d.open }); }, [d]);
  const enough = picked.length >= 2 && picked.length <= 3;
  const preview = picked.filter((e) => readinessOf(e.s) !== "live");
  const intake = useConfirmedIntake();
  const [useIntake, setUseIntake] = useState(true);
  const briefId = intake && useIntake ? intake.id : undefined;
  const locked = create.isPending;
  const versionOf = (e: Entry) => pinned[e.s.id] ?? String(e.s.currentVersion);
  // A pinned version that no longer matches the library must be re-compared, never silently swapped.
  const drifted = picked.filter((e) => pinned[e.s.id] !== undefined && pinned[e.s.id] !== String(e.s.currentVersion));

  const submit = () => {
    if (drifted.length) return;
    const sources = picked.map((e) => ({ solutionId: e.s.id, version: versionOf(e) }));
    const comparisonContext = picked.map((e) => `${e.s.name} v${versionOf(e)}: ${e.s.outcome} [${readinessOf(e.s) === "live" ? "runs on input" : "preview only"}; capabilities: ${e.caps.map((c) => c.name).join(", ") || "none recorded"}]`).join("\n");
    const sig = JSON.stringify({ sources, comparisonContext, o: d.desiredOutcome.trim(), g: d.targetGroup.trim(), briefId });
    const next = keyForRequest(d, sig);
    setD(next); saveDraft({ ...loadDraft(), ...next });
    setErr(null);
    create.mutate({
      idempotencyKey: next.idempotencyKey, sources, comparisonContext, briefId,
      desiredOutcome: d.desiredOutcome.trim() || undefined, targetGroup: d.targetGroup.trim() || undefined,
    }, {
      onSuccess: (c) => { const cleared = clearAfterSuccess(next); setD(cleared); saveDraft({ ...loadDraft(), ...cleared }); navigate(compositionHref(c)); },
      onError: (e) => setErr({ status: compStatus(e), msg: createMsg(e) }),
    });
  };

  return (
    <div className="mt-5 rounded-xl border border-dashed border-primary/40 bg-[hsl(var(--primary)/0.04)] p-4" data-testid="panel-build-selected">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15.5px] font-semibold">Combine what you compared</h3>
          <p className="text-[13.5px] text-muted-foreground">
            {enough ? `Recommend one flow from these ${picked.length}: a base, what each contributes, overlaps and gaps. Saved as a draft you can refine, not an approved product.` : "Pick two or three solutions to combine them."}
          </p>
        </div>
        {!d.open && <button className={btn.primary} disabled={!enough} onClick={() => setD({ ...d, open: true })} data-testid="button-build-selected"><Layers className="h-4 w-4" /> Build from selected solutions</button>}
      </div>
      {d.open && enough && (
        <form className="mt-4 grid gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }} aria-busy={create.isPending}>
          {intake && (
            <label className="flex items-start gap-2 rounded-lg bg-card p-3 text-[13.5px]" data-testid="row-confirmed-intake">
              <input type="checkbox" className="mt-1" checked={useIntake} disabled={locked} onChange={(e) => setUseIntake(e.target.checked)} data-testid="check-use-intake" />
              <span className="min-w-0 flex-1"><span className="font-medium">Use my confirmed intake</span><span className="block text-muted-foreground">{intake.better || intake.rawText.slice(0, 160)} · {intake.requirements.length} requirement{intake.requirements.length === 1 ? "" : "s"}</span></span>
              <button type="button" className={btn.quiet} disabled={locked} onClick={() => { forgetBrief(); setUseIntake(false); }}>Forget</button>
            </label>
          )}
          <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[12.5px] font-medium text-muted-foreground">Desired outcome · optional
              <input className={field} value={d.desiredOutcome} onChange={(e) => setD({ ...d, desiredOutcome: e.target.value })} placeholder="e.g. find duplicate invoices before approval" data-testid="input-desired-outcome" maxLength={500} />
            </label>
            <label className="grid gap-1 text-[12.5px] font-medium text-muted-foreground">Who it is for · optional
              <input className={field} value={d.targetGroup} onChange={(e) => setD({ ...d, targetGroup: e.target.value })} placeholder="e.g. accounts payable clerks" data-testid="input-target-group" maxLength={200} />
            </label>
          </fieldset>
          <p className="text-[12.5px] text-muted-foreground">
            {briefId ? "Your confirmed intake is used as context." : "Leave these blank and a goal will be inferred and labelled as such."}
            {" "}Sources: {picked.map((e) => `${e.s.name} v${versionOf(e)}`).join(", ")}.
            {preview.length > 0 && ` ${preview.map((e) => e.s.name).join(", ")} ${preview.length === 1 ? "is" : "are"} preview only, so any part from ${preview.length === 1 ? "it" : "them"} stays proposed and cannot run.`}
          </p>
          {drifted.length > 0 && (
            <div role="alert" className="rounded-lg bg-accent px-3 py-2 text-[13px] text-siennaink" data-testid="text-version-drift">
              {drifted.map((e) => `${e.s.name} was v${pinned[e.s.id]} when you compared it and is now v${e.s.currentVersion}`).join("; ")}. Check the comparison above against the new version before building.
              <button type="button" className="ml-2 font-semibold underline" onClick={() => onRepin(drifted.map((e) => e.s.id))} data-testid="button-recompare">I have re-checked, use the new version</button>
            </div>
          )}
          {create.isPending && <div className="space-y-2" data-testid="state-composing"><div className="h-3 w-2/3 animate-pulse rounded bg-muted" /><div className="h-3 w-1/2 animate-pulse rounded bg-muted" /><p className="text-[13px] text-muted-foreground">Reading the selected sources and checking compatibility. The selection and inputs are locked until this finishes.</p></div>}
          {err && (
            <div role="alert" className="rounded-lg bg-accent px-3 py-2 text-[13px] text-siennaink" data-testid="text-compose-error">
              {err.msg}
              {err.status === 401 && <a href={loginHref()} className="ml-2 font-semibold underline" data-testid="link-compose-signin">Sign in</a>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={cn(btn.accent, "min-h-11")} disabled={create.isPending || drifted.length > 0} data-testid="button-compose-submit">
              {err ? <><RotateCcw className="h-4 w-4" /> Try again</> : create.isPending ? "Recommending…" : "Recommend and save draft"}
            </button>
            <button type="button" className={btn.quiet} disabled={create.isPending} onClick={() => { setErr(null); setD({ ...d, open: false }); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
