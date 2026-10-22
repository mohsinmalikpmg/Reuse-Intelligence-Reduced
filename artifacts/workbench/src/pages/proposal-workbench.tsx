import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Cable, Info, Lock, Minus, Play, Plus, Undo2 } from "lucide-react";
import { ErrorView, LoadingView, Page, StageEyebrow, Tag, btn, useUndoToast } from "@/components/bits";
import { CompositionSummary, RefinePanel } from "@/components/composition-panel";
import { FeatureRedundancy } from "@/components/feature-redundancy";
import { InputUpload } from "@/components/input-upload";
import { cn } from "@/lib/utils";
import {
  DISPOSITION, baselineOf, compKeys, compMsg, compStatus, evidenceOf, loginHref, useComposition, useSavePlan, useUndoComposition,
  type Composition, type CompositionPlan, type Disposition, type SourceEv,
} from "@/lib/composition";

type Step = CompositionPlan["flow"][number];
const darkTool = "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40";
const iconTool = "grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30";
const EXCLUDE_REASON = "Removed from the proposed flow in the workbench.";

/** cmp_ ids: a proposal-only combination, shaped in the workbench itself. A is the pinned base; B is the persisted plan. */
export function ProposalWorkbenchPage({ id }: { id: string }) {
  const q = useComposition(id);
  if (q.isLoading) return <LoadingView />;
  const st = compStatus(q.error);
  if (st === 401) return <Page><div className="card-soft max-w-xl p-7" data-testid="state-composition-signin"><StageEyebrow stage="connect" /><h1 className="mt-3 text-[26px]">Sign in to open this combination.</h1><p className="mt-2 text-[15px] text-muted-foreground">Proposed combinations are saved to your account.</p><a href={loginHref()} className={cn(btn.primary, "mt-5")}>Sign in</a></div></Page>;
  if (st === 404) return <Page><div className="card-soft max-w-xl p-7" data-testid="state-case-gone"><StageEyebrow stage="connect" /><h1 className="mt-3 text-[26px]">That combination is not here.</h1><p className="mt-2 text-[15px] text-muted-foreground">It may belong to another account. Compare solutions in the library to start one.</p><Link href="/library" className={cn(btn.primary, "mt-5")}>Library</Link></div></Page>;
  if (q.isError || !q.data) return <ErrorView onRetry={() => void q.refetch()} message="This combination could not load." />;
  return <ProposalWorkbench c={q.data} />;
}

function ProposalWorkbench({ c }: { c: Composition }) {
  const qc = useQueryClient();
  const say = useUndoToast();
  const save = useSavePlan();
  const undoM = useUndoComposition();
  const [err, setErr] = useState<string | null>(null);
  // Reasons the user or model gave for an exclusion, kept so a source moved back and forth does not lose them.
  const [keptReasons, setKeptReasons] = useState<Record<string, string>>({});
  const ev = evidenceOf(c);
  const plan = c.plan;
  const base = baselineOf(c);
  const baseEv = ev.find((s) => s.solutionId === plan.baseSolutionId);
  const nameOf = (sid: string) => ev.find((s) => s.solutionId === sid)?.name ?? sid;
  const capName = (sid: string, cap: string) => (ev.find((s) => s.solutionId === sid)?.capabilities.find((x) => x.id === cap)?.name as string | undefined) ?? cap;
  const inPlan = useMemo(() => new Set(plan.flow.map((s) => s.capabilityId)), [plan.flow]);
  const busy = save.isPending || undoM.isPending;
  const disp = (sid: string) => plan.decisions.find((d) => d.solutionId === sid);

  const commit = (next: CompositionPlan, label: string) => {
    setErr(null);
    save.mutate({ id: c.id, expectedRevision: c.revision, plan: next }, {
      onSuccess: (n) => say(label, n.canUndo ? () => undoM.mutate({ id: c.id, expectedRevision: n.revision }, { onSuccess: () => say("Undone"), onError: (e) => setErr(compMsg(e)) }) : undefined),
      onError: (e) => {
        if (compStatus(e) === 409) void qc.invalidateQueries({ queryKey: compKeys.one(c.id) });
        setErr(compMsg(e));
      },
    });
  };
  const withDecision = (p: CompositionPlan, sid: string, disposition: Disposition, reason: string): CompositionPlan => ({
    ...p, decisions: p.decisions.map((d) => (d.solutionId === sid ? { ...d, disposition, reason } : d)),
  });
  const remember = (sid: string) => { const d = disp(sid); if (d) setKeptReasons((m) => ({ ...m, [`${sid}:${d.disposition}`]: d.reason })); };

  const removeStep = (i: number) => {
    const step = plan.flow[i];
    const flow = plan.flow.filter((_, j) => j !== i);
    let next: CompositionPlan = { ...plan, flow };
    // An included source must keep a step; when its last one goes, the source is marked not needed instead of saving an invalid plan.
    if (!flow.some((s) => s.sourceSolutionId === step.sourceSolutionId)) {
      remember(step.sourceSolutionId);
      next = withDecision(next, step.sourceSolutionId, "unnecessary", keptReasons[`${step.sourceSolutionId}:unnecessary`] ?? EXCLUDE_REASON);
    }
    commit(next, `${capName(step.sourceSolutionId, step.capabilityId)} removed from B`);
  };
  const addStep = (sid: string, capId: string) => {
    const reason = `Added by you from ${nameOf(sid)}.`;
    let next: CompositionPlan = { ...plan, flow: [...plan.flow, { sourceSolutionId: sid, capabilityId: capId, reason }] };
    if (disp(sid)?.disposition !== "included") {
      remember(sid);
      next = withDecision(next, sid, "included", keptReasons[`${sid}:included`] ?? `Contributes ${capName(sid, capId)}.`);
    }
    commit(next, `${capName(sid, capId)} added to B`);
  };
  const move = (i: number, dir: -1 | 1) => {
    const flow = [...plan.flow]; const j = i + dir;
    if (j < 0 || j >= flow.length) return;
    [flow[i], flow[j]] = [flow[j], flow[i]];
    commit({ ...plan, flow }, "Proposed order changed");
  };
  const setDisposition = (sid: string, d: Disposition) => {
    const cur = disp(sid);
    if (!cur || cur.disposition === d) return;
    remember(sid);
    if (d === "included") {
      const first = ev.find((s) => s.solutionId === sid)?.capabilities[0];
      if (!first) { setErr(`${nameOf(sid)} has no capabilities to contribute.`); return; }
      const flow = plan.flow.some((s) => s.sourceSolutionId === sid) ? plan.flow : [...plan.flow, { sourceSolutionId: sid, capabilityId: first.id, reason: `Added by you from ${nameOf(sid)}.` }];
      commit(withDecision({ ...plan, flow }, sid, d, keptReasons[`${sid}:included`] ?? `Contributes ${capName(sid, first.id)}.`), `${nameOf(sid)} included`);
      return;
    }
    const flow = plan.flow.filter((s) => s.sourceSolutionId !== sid);
    if (flow.length === 0) { setErr("Keep at least one step in B."); return; }
    commit(withDecision({ ...plan, flow }, sid, d, keptReasons[`${sid}:${d}`] ?? (cur.disposition === "included" ? EXCLUDE_REASON : cur.reason)), `${nameOf(sid)} marked ${DISPOSITION[d].l.toLowerCase()}`);
  };
  const undo = () => undoM.mutate({ id: c.id, expectedRevision: c.revision }, { onSuccess: () => say("Undone"), onError: (e) => { if (compStatus(e) === 409) void qc.invalidateQueries({ queryKey: compKeys.one(c.id) }); setErr(compMsg(e)); } });

  const baseCaps = (base.capabilities ?? baseEv?.capabilities ?? []) as SourceEv["capabilities"];

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-5 md:px-6" data-testid="view-proposal-workbench">
      <StageEyebrow stage="connect" className="mb-2" />
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        <span>Workbench</span><span>/</span><Link href={`/solutions/${plan.baseSolutionId}`} className="hover:text-primary hover:underline">{nameOf(plan.baseSolutionId)}</Link>
        <Tag tone="sienna" testid="tag-proposal-only">Proposal · cannot run</Tag>
        <Tag tone="slate" testid="text-revision">Saved · rev {c.revision}</Tag>
      </div>
      <h1 className="mt-0.5 break-words text-[24px] md:text-[30px]" data-testid="text-headline">{plan.title}</h1>
      <blockquote className="mt-2 max-w-3xl border-l-4 border-sienna pl-3 text-[15px] text-muted-foreground" data-testid="text-need">
        {plan.goal}{plan.goalInferred && <span className="ml-2 align-middle"><Tag tone="sienna">Inferred goal</Tag></span>}
      </blockquote>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <section id="wiring" className="scroll-mt-24 rounded-[20px] bg-[hsl(var(--primary))] p-5 text-primary-foreground md:p-6" data-testid="panel-map" aria-label="Proposed map">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-semibold">Version B · proposed steps</h2>
                        <button onClick={undo} disabled={!c.canUndo || busy} className={cn(darkTool, "ml-auto")} data-testid="button-undo"><Undo2 className="h-4 w-4" /> Undo</button>
          </div>
          <ol className="space-y-3">
            <li className="rounded-xl border border-dashed border-white/30 px-4 py-3" data-testid="node-baseline-a">
              <div className="flex flex-wrap items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-md bg-white/15 text-[12px] font-bold">A</span><span className="font-semibold">{base.name ?? nameOf(plan.baseSolutionId)} v{base.version ?? baseEv?.version}</span><Lock className="h-3.5 w-3.5 opacity-70" aria-label="Pinned" /></div>
              <details className="mt-1 text-[12.5px] opacity-75"><summary className="cursor-pointer">Pinned base · {baseCaps.length} capabilities</summary>{baseCaps.map((x) => x.name ?? x.id).join(", ")}</details>
            </li>
            {plan.flow.map((s, i) => {
              const prev = i > 0 ? plan.flow[i - 1] : null;
              const handoff = prev && prev.sourceSolutionId !== s.sourceSolutionId ? handoffFor(ev, plan.integrationGaps, prev.sourceSolutionId, s.sourceSolutionId) : null;
              return (
                <li key={`${s.sourceSolutionId}:${s.capabilityId}`}>
                  {handoff && prev && <div className={cn("mx-auto my-1 w-fit max-w-full rounded-2xl border border-dashed px-3 py-1 text-center text-[12px]", handoff.gaps.length ? "border-[#F2B8A0]/60 text-[#F7D4C4]" : "border-white/30 text-white/80")} data-testid={`handoff-${i}`}>
                    <span className="inline-flex items-center gap-2"><Cable className="h-3.5 w-3.5" /> {nameOf(prev.sourceSolutionId)} to {nameOf(s.sourceSolutionId)} · hand-off not run</span>
                    {(handoff.adapter || handoff.gaps.length > 0) && <details className="mt-1"><summary className="cursor-pointer opacity-80">{handoff.gaps.length ? `${handoff.gaps.length} connection details` : "Adapter details"}</summary>
                      {handoff.adapter && <span className="block opacity-80">Adapter exists: {handoff.adapter}</span>}
                      {handoff.gaps.map((g, k) => <span key={k} className="mt-1 block opacity-90">{g}</span>)}
                    </details>}
                  </div>}
                  <StepRow s={s} i={i} last={plan.flow.length - 1} name={capName(s.sourceSolutionId, s.capabilityId)} src={nameOf(s.sourceSolutionId)} busy={busy}
                    onUp={() => move(i, -1)} onDown={() => move(i, 1)} onRemove={() => removeStep(i)} canRemove={plan.flow.length > 1 && !(s.sourceSolutionId === plan.baseSolutionId && plan.flow.filter((x) => x.sourceSolutionId === plan.baseSolutionId).length <= 1)} />
                </li>
              );
            })}
            <li className="rounded-xl border border-dashed border-white/30 px-4 py-3" data-testid="node-not-runnable">
              <div className="font-semibold">Not runnable yet</div>
              <div className="text-[12.5px] opacity-75">{plan.integrationGaps.length ? `${plan.integrationGaps.length} gap${plan.integrationGaps.length === 1 ? "" : "s"} to close` : "No combined engine for these sources"}</div>
            </li>
          </ol>
        </section>

        <aside className="space-y-4">
          <CompositionSummary c={c} names={nameOf} />
          <section className="card-soft p-5" data-testid="panel-sources">
            <h2 className="text-[16px] font-semibold">Sources</h2>
            <ul className="mt-3 space-y-3">
              {ev.map((s) => {
                const d = disp(s.solutionId);
                const isBase = s.solutionId === plan.baseSolutionId;
                const unused = s.capabilities.filter((x) => !plan.flow.some((f) => f.sourceSolutionId === s.solutionId && f.capabilityId === x.id));
                return (
                  <li key={s.solutionId} className="rounded-lg border border-border p-3 text-[13.5px]" data-testid={`source-${s.solutionId}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/solutions/${s.solutionId}`} className="font-semibold text-primary hover:underline">{s.name}</Link>
                      <span className="text-muted-foreground">v{s.version}</span>
                      {isBase && <Tag tone="slate">Base A</Tag>}
                      {s.execution !== "live" && s.execution !== "registered-recipe" && <Tag tone="muted">Preview only</Tag>}
                      <label className="ml-auto"><span className="sr-only">Decision for {s.name}</span>
                        <select value={d?.disposition ?? "included"} disabled={busy || isBase} onChange={(e) => setDisposition(s.solutionId, e.target.value as Disposition)} className="h-8 rounded-lg border border-input bg-card px-2 text-[12.5px]" data-testid={`select-disposition-${s.solutionId}`}>
                          <option value="included">Included</option><option value="unnecessary">Not needed</option><option value="not_suitable">Not suitable</option>
                        </select></label>
                    </div>
                    
                    {unused.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">
                      {unused.map((x) => <button key={x.id} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border px-2.5 text-[12.5px] hover:border-primary hover:text-primary disabled:opacity-40" disabled={busy} onClick={() => addStep(s.solutionId, x.id)} data-testid={`button-add-${s.solutionId}-${x.id}`}><Plus className="h-3.5 w-3.5" /> {x.name ?? x.id}</button>)}
                    </div>}
                  </li>
                );
              })}
            </ul>
          </section>
          <RefinePanel c={c} />
          <section className="card-soft p-5">
            <h2 className="text-[16px] font-semibold">Try it</h2>
            <p className="mt-1 text-[13.5px] text-muted-foreground" data-testid="text-not-runnable">Close the gaps to run it.</p>
            <button disabled className={cn(btn.accent, "mt-3 min-h-12 px-6")} data-testid="button-run-disabled"><Play className="h-4 w-4" /> Fuse B · unavailable</button>
            <InputUpload key={`${c.id}:${c.revision}`} targetId={c.id} />
          </section>
          {err && <p role="alert" className="rounded-lg bg-accent px-3 py-2 text-[13px] text-siennaink" data-testid="text-proposal-error">{err}</p>}
        </aside>
      </div>

      <details className="mt-6" data-testid="details-redundancy">
        <summary className="cursor-pointer text-[14px] font-medium text-primary">Where these sources overlap</summary>
        <div className="mt-3"><FeatureRedundancy target={{ compositionId: c.id }} scope={`rev:${c.revision}`} names={nameOf} inPlan={inPlan} /></div>
      </details>

      <details className="mt-6 text-[13px]" data-testid="details-technical">
        <summary className="cursor-pointer text-muted-foreground"><Info className="mr-1 inline h-3.5 w-3.5" /> Technical details</summary>
        <dl className="mt-3 grid gap-1 font-mono text-[12px] text-muted-foreground">
          <div className="break-all">source fingerprint <span className="text-foreground">{c.sourceFingerprint}</span></div>
          {ev.map((s) => <div key={s.solutionId} className="break-all">{s.solutionId} v{s.version} · {s.execution}{s.registeredSource ? ` · sha256 ${s.registeredSource.sha256}` : ""}</div>)}
        </dl>
      </details>
    </div>
  );
}

type Edge = { id: string; from: string; to: string; contract?: string };
const edgesOf = (s?: SourceEv): Edge[] => { const c = s?.constraints as { edges?: Edge[] } | undefined; return Array.isArray(c?.edges) ? c.edges : []; };
/** What the evidence says about one source-to-source hand-off: an existing recipe adapter, recorded gaps, or neither. */
function handoffFor(ev: SourceEv[], gaps: string[], from: string, to: string) {
  const a = ev.find((s) => s.solutionId === from); const b = ev.find((s) => s.solutionId === to);
  const touches = (e: Edge, id: string) => e.from === id || e.to === id;
  const shared = edgesOf(a).filter((e) => edgesOf(b).some((x) => x.id === e.id));
  const both = shared.some((e) => touches(e, from)) && shared.some((e) => touches(e, to));
  const names = [a?.name, b?.name].filter((x): x is string => !!x).map((n) => n.toLowerCase());
  return {
    adapter: both ? shared.filter((e) => touches(e, from) || touches(e, to)).map((e) => e.id).join(", ") : null,
    gaps: gaps.filter((g) => names.some((n) => g.toLowerCase().includes(n))),
  };
}

function StepRow({ s, i, last, name, src, busy, canRemove, onUp, onDown, onRemove }: {
  s: Step; i: number; last: number; name: string; src: string; busy: boolean; canRemove: boolean; onUp: () => void; onDown: () => void; onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-3" data-testid={`node-step-${s.capabilityId}`}>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-siennaink text-[12px] font-bold text-white">B</span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{name}</div>
        <div className="text-[12.5px] opacity-75" title={s.reason}>from {src}</div>
      </div>
      <div className="flex shrink-0 items-center">
        <button className={iconTool} onClick={onUp} disabled={busy || i === 0} aria-label={`Move ${name} up`} data-testid={`button-up-${s.capabilityId}`}><ArrowUp className="h-4 w-4" /></button>
        <button className={iconTool} onClick={onDown} disabled={busy || i === last} aria-label={`Move ${name} down`} data-testid={`button-down-${s.capabilityId}`}><ArrowDown className="h-4 w-4" /></button>
        <button className={darkTool} onClick={onRemove} disabled={busy || !canRemove} title={canRemove ? "Remove from B" : "The base and B need at least one step"} data-testid={`button-remove-${s.capabilityId}`}><Minus className="h-3.5 w-3.5" /> Remove</button>
      </div>
    </div>
  );
}
