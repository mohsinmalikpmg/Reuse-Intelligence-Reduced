import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Sparkles, Undo2, X } from "lucide-react";
import { Tag, btn, useUndoToast } from "@/components/bits";
import { cn } from "@/lib/utils";
import { RequirementLedger } from "@/components/requirement-ledger";
import { CompositionGaps } from "@/components/composition-gaps";
import {
  DISPOSITION, compKeys, evidenceOf, compMsg, compStatus, loginHref, useApplyRefinement, useCancelRefinement, usePreviewRefinement, useUndoComposition,
  type Composition, type RefinementPreview,
} from "@/lib/composition";

const show = (v: unknown): string => (v === null || v === undefined || v === "" ? "nothing" : typeof v === "string" ? v : Array.isArray(v) ? v.map(show).join(", ") || "nothing" : JSON.stringify(v));
const List = ({ title, items, testid }: { title: string; items: string[]; testid: string }) => items.length === 0 ? null : (
  <div data-testid={testid}><h4 className="text-[12.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{title}</h4>
    <ul className="mt-1 list-disc space-y-1 pl-5 text-[13.5px]">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
);

/** The saved recommendation, short: goal, base, open gaps with their one action. Reasons and provenance on request. */
export function CompositionSummary({ c, names, savedAt }: { c: Composition; names: (id: string) => string; savedAt?: string }) {
  const p = c.plan;
  const editedSince = !!savedAt && new Date(savedAt).getTime() > new Date(c.updatedAt).getTime() + 1000;
  const capName = (sid: string, cap: string) => (evidenceOf(c).find((x) => x.solutionId === sid)?.capabilities.find((x) => x.id === cap)?.name as string | undefined) ?? cap;
  return (
    <section className="card-soft p-5" data-testid="panel-recommendation" aria-labelledby="rec-h">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="rec-h" className="text-[16px] font-semibold">Plan</h2>
        <Tag tone={c.executable ? "sky" : "sienna"} testid="text-composition-executable">{c.executable ? "Parts run" : "Proposal"}</Tag>
        <Tag tone="slate" testid="text-composition-revision">rev {c.revision}</Tag>
        {p.goalInferred && <Tag tone="sienna" testid="tag-goal-inferred">Goal inferred</Tag>}
        {editedSince && <Tag tone="muted" testid="text-edited-since">Edited by hand since</Tag>}
      </div>
      <p className="mt-2 text-[14.5px]" data-testid="text-composition-goal">{p.goal}{c.targetGroup ? <span className="text-muted-foreground"> · for {c.targetGroup}</span> : null}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">Starts from {names(p.baseSolutionId)}{p.decisions.filter((d) => d.disposition === "included" && d.solutionId !== p.baseSolutionId).length ? `, borrows from ${p.decisions.filter((d) => d.disposition === "included" && d.solutionId !== p.baseSolutionId).map((d) => names(d.solutionId)).join(", ")}` : ""}.</p>
      {(p.integrationGaps.length > 0 || (p.capabilityGaps?.length ?? 0) > 0 || (p.librarySuggestions?.length ?? 0) > 0 || (c.acceptedSuggestions?.length ?? 0) > 0) && <details className="mt-3 text-[13px]" data-testid="details-gaps">
        <summary className="cursor-pointer font-medium text-primary">Gaps and reuse options{p.librarySuggestions?.length ? ` · ${p.librarySuggestions.length} Library suggestions` : ""}</summary>
        <CompositionGaps c={c} names={names} />
      </details>}
      <details className="mt-3 text-[13px]" data-testid="details-why">
        <summary className="cursor-pointer font-medium text-primary">Why this plan</summary>
        <div className="mt-2 grid gap-3">
          <p>{p.rationale}</p>
          <ul className="space-y-1">{p.decisions.map((d) => (
            <li key={d.solutionId} data-testid={`decision-${d.solutionId}`}><Link href={`/solutions/${d.solutionId}`} className="font-medium text-primary hover:underline">{names(d.solutionId)}</Link> v{c.sources.find((s) => s.solutionId === d.solutionId)?.version} <Tag tone={DISPOSITION[d.disposition].tone}>{DISPOSITION[d.disposition].l}</Tag> <span className="text-muted-foreground">{d.reason}</span></li>
          ))}</ul>
          {p.flow.length > 0 && <ol className="list-decimal space-y-0.5 pl-5" data-testid="list-proposed-order">{p.flow.map((f, i) => <li key={`${f.capabilityId}-${i}`}><span className="font-medium">{capName(f.sourceSolutionId, f.capabilityId)}</span> <span className="text-muted-foreground">· {names(f.sourceSolutionId)}. {f.reason}</span></li>)}</ol>}
          {c.supportedExecution && c.supportedExecution.omittedCapabilities.length > 0 && <List title="Not run" items={c.supportedExecution.omittedCapabilities.map((o) => `${o.capabilityId}: ${o.reason}`)} testid="panel-supported-execution" />}
          <List title="Overlaps" items={p.overlapDecisions} testid="list-overlaps" />
          <List title="Dependencies" items={p.dependencies} testid="list-dependencies" />
          <List title="Limitations" items={c.limitations} testid="list-limitations" />
          <List title="Worth clarifying" items={p.clarifications} testid="list-clarifications" />
          <dl className="grid gap-0.5 font-mono text-[11.5px] text-muted-foreground" data-testid="details-provenance">
            {c.sources.map((s) => <div key={s.solutionId}>{s.solutionId} v{s.version}</div>)}
            <div>saved {new Date(c.updatedAt).toLocaleString()}</div>
            {Object.entries(c.provenance ?? {}).map(([k, v]) => <div key={k} className="break-all">{k} {show(v)}</div>)}
          </dl>
        </div>
      </details>
    </section>
  );
}

/** Text refinement against the saved plan: preview the explicit changes, then apply or cancel. Undo reverses the last applied one. */
export function RefinePanel({ c, onApplied }: { c: Composition; onApplied?: (c: Composition) => void }) {
  const qc = useQueryClient();
  const say = useUndoToast();
  const previewM = usePreviewRefinement();
  const applyM = useApplyRefinement();
  const cancelM = useCancelRefinement();
  const undoM = useUndoComposition();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<RefinementPreview | null>(null);
  const [err, setErr] = useState<{ status: number; msg: string } | null>(null);
  const busy = previewM.isPending || applyM.isPending || cancelM.isPending || undoM.isPending;
  const fail = (e: unknown) => {
    const status = compStatus(e);
    if (status === 409) { setPreview(null); void qc.invalidateQueries({ queryKey: compKeys.one(c.id) }); if (c.caseId) void qc.invalidateQueries({ queryKey: compKeys.forCase(c.caseId) }); }
    setErr({ status, msg: compMsg(e) });
  };
  const undo = (rev: number) => undoM.mutate({ id: c.id, expectedRevision: rev }, { onSuccess: (n) => { say("Last refinement undone"); onApplied?.(n); }, onError: fail });

  return (
    <section className="card-soft p-5" data-testid="panel-refine" aria-labelledby="refine-h">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="refine-h" className="text-[16px] font-semibold">Change it in words</h2>
        <button className={cn(btn.quiet, "ml-auto")} onClick={() => undo(c.revision)} disabled={busy || !c.canUndo} data-testid="button-composition-undo"><Undo2 className="h-4 w-4" /> Undo last change</button>
      </div>
            <form className="mt-3 grid gap-2" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; setErr(null); previewM.mutate({ id: c.id, expectedRevision: c.revision, instruction: text.trim() }, { onSuccess: setPreview, onError: fail }); }}>
        <label htmlFor="refine-text" className="sr-only">Refinement instruction</label>
        <textarea id="refine-text" rows={2} value={text} onChange={(e) => setText(e.target.value)} disabled={busy || !!preview} maxLength={1000} placeholder="e.g. Drop bulk approvals, we only need to catch duplicates" className="w-full rounded-xl border border-input bg-card px-3 py-2 text-[14px] outline-none focus:border-primary" data-testid="input-refine" />
        {!preview && <div><button type="submit" className={btn.primary} disabled={busy || !text.trim()} data-testid="button-refine-preview"><Sparkles className="h-4 w-4" /> {previewM.isPending ? "Working out changes…" : "Preview changes"}</button></div>}
      </form>
      {err && <p role="alert" className="mt-3 rounded-lg bg-accent px-3 py-2 text-[13px] text-siennaink" data-testid="text-refine-error">{err.msg}{err.status === 401 && <a href={loginHref()} className="ml-2 font-semibold underline">Sign in</a>}</p>}
      {preview && (
        <div className="mt-4 rounded-xl border border-primary/30 p-4" data-testid="panel-refine-preview">
          <h3 className="text-[14px] font-semibold">{preview.changes.length === 0 ? "No changes needed for that" : `${preview.changes.length} proposed change${preview.changes.length === 1 ? "" : "s"}`}</h3>
          <ul className="mt-2 space-y-2">{preview.changes.map((ch, i) => (
            <li key={i} className="rounded-lg bg-muted/50 p-3 text-[13px]" data-testid={`refine-change-${i}`}>
              <div className="font-mono text-[12px] text-muted-foreground">{ch.path}</div>
              <div className="mt-1"><span className="text-muted-foreground line-through">{show(ch.before)}</span> <span className="mx-1">to</span> <span className="font-medium">{show(ch.after)}</span></div>
              <p className="mt-1 text-muted-foreground">{ch.reason}</p>
            </li>
          ))}</ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={btn.accent} disabled={busy || preview.changes.length === 0} data-testid="button-refine-apply"
              onClick={() => applyM.mutate({ id: c.id, previewId: preview.id, expectedRevision: preview.expectedRevision }, {
                onSuccess: (n) => { setPreview(null); setText(""); setErr(null); say(`Applied · plan rev ${n.revision}`, () => undo(n.revision)); onApplied?.(n); }, onError: fail,
              })}><Check className="h-4 w-4" /> {applyM.isPending ? "Applying…" : "Apply"}</button>
            <button className={btn.quiet} disabled={busy} data-testid="button-refine-cancel"
              onClick={() => cancelM.mutate({ id: c.id, previewId: preview.id }, { onSettled: () => setPreview(null) })}><X className="h-4 w-4" /> Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Mounted inside the existing case pages: shows only when the case came from a composition. */
export function LinkedComposition({ c, names, savedAt }: { c: Composition; names: (id: string) => string; savedAt?: string }) {
  return <div className="grid gap-4" data-testid="panel-linked-composition"><div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]"><CompositionSummary c={c} names={names} savedAt={savedAt} /><RefinePanel c={c} /></div><RequirementLedger c={c} /></div>;
}
