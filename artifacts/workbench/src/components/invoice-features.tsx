import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Lock, RotateCcw, Save, Sparkles } from "lucide-react";
import { Tag, btn } from "@/components/bits";
import { cn } from "@/lib/utils";
import { SOURCE_NAMES, type CombinedCase, type Recipe } from "@/lib/consolidation";
import { reviewedInvoiceHashes } from "@/lib/invoice-overlap";
import {
  EXPERIENCES, INVOICE_FEATURES, proposedJourneys, proposedNav, retainedPatterns, REQUIRED_FEATURES, byId, recommendInvoice, resolveInvoiceFeatures, savedExperience, savedFeatureIds, validateInvoiceExperience,
  type InvoiceExperience,
} from "@/lib/invoice-features";

type Draft = { featureIds: string[]; experience: InvoiceExperience };

export function InvoiceFeatureSelection({ c, recipe, busy, onSave, onEnableCap, onSetBase }: {
  c: CombinedCase; recipe: Recipe; busy: boolean;
  onSave: (config: Record<string, unknown>) => void; onEnableCap: (capId: string) => void; onSetBase: (sourceId: string) => void;
}) {
  const cfg = c.config as Record<string, unknown> | undefined;
  const legacy = !savedFeatureIds(cfg);
  const saved: Draft = useMemo(() => {
    const ids = resolveInvoiceFeatures(c.capabilityIds, savedFeatureIds(cfg));
    const e = savedExperience(cfg);
    return { featureIds: ids, experience: (validateInvoiceExperience(e, ids) ? e : "invoice-led") as InvoiceExperience };
  }, [c.capabilityIds, cfg]);
  const [draft, setDraft] = useState<Draft>(saved);
  const rev = useRef(c.revision);
  useEffect(() => { if (rev.current !== c.revision) { rev.current = c.revision; setDraft(saved); } }, [c.revision, saved]);
  const [open, setOpen] = useState<string | null>(null);

  const texts = useMemo(() => [c.need, ...(c.assessment ?? []).map((r) => r.text)].filter(Boolean) as string[], [c.need, c.assessment]);
  const rec = useMemo(() => recommendInvoice(texts, c.capabilityIds), [texts, c.capabilityIds]);
  const avail = resolveInvoiceFeatures(c.capabilityIds);
  const dirty = legacy ? true : JSON.stringify(draft) !== JSON.stringify(saved);
  const sel = new Set(draft.featureIds);
  const hasSource = (sid: string) => c.selectedSources.some((s) => s.id === sid);

  const toggle = (id: string) => {
    if (REQUIRED_FEATURES.includes(id)) return;
    const next = new Set(sel);
    if (next.has(id)) { next.delete(id); INVOICE_FEATURES.filter((f) => f.requires.includes(id)).forEach((f) => next.delete(f.id)); }
    else { next.add(id); byId(id)?.requires.forEach((r) => next.add(r)); }
    const ids = resolveInvoiceFeatures(c.capabilityIds, [...next]);
    setDraft((d) => ({ featureIds: ids, experience: validateInvoiceExperience(d.experience, ids) ? d.experience : "invoice-led" }));
  };
  const pnav = proposedNav(draft.featureIds, draft.experience);
  const excludedSel = avail.filter((id) => !sel.has(id));

  return (
    <section className="card-soft overflow-hidden" data-testid="panel-invoice-features" aria-labelledby="feat-title">
      <header className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 id="feat-title" className="text-[18px] font-semibold">Choose the functions</h2>
          <Tag tone="muted">Deterministic rules · not AI</Tag>
          <Tag tone={dirty ? "sienna" : "green"} testid="text-features-state">{legacy ? "Legacy: all available, not yet chosen" : dirty ? "Unsaved draft · not runnable" : `Saved · rev ${c.revision}`}</Tag>
        </div>
        <p className="mt-1 max-w-3xl text-[13.5px] text-muted-foreground">Each function is deconstructed from a reviewed original. Base provenance stays {SOURCE_NAMES[c.baseSolutionId] ?? c.baseSolutionId}; the design only changes which view the combined app opens on; navigation order is fixed. Source evidence shows where behavior lives, not that the combined app executes it.</p>
      </header>

      <div className="grid gap-0 lg:grid-cols-[1.25fr_1fr]">
        <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
          <div className="rounded-xl bg-secondary/60 p-4" data-testid="panel-recommended">
            <div className="flex flex-wrap items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h3 className="font-semibold">Recommended from your need</h3><Tag tone="slate">{EXPERIENCES[rec.experience].name}</Tag></div>
            <p className="mt-1 text-[13px] text-muted-foreground">{rec.expWhy}</p>
            <p className="mt-1 text-[13px]" data-testid="text-base">Current base: <b>{SOURCE_NAMES[c.baseSolutionId] ?? c.baseSolutionId}</b> (saved provenance). Recommended base: <b>{SOURCE_NAMES[rec.baseSourceId] ?? rec.baseSourceId}</b>. {rec.baseWhy}</p>
            {rec.baseSourceId !== c.baseSolutionId && (hasSource(rec.baseSourceId)
              ? <button className="mt-1 text-[12.5px] font-medium text-primary underline" disabled={busy} onClick={() => onSetBase(rec.baseSourceId)} data-testid="button-apply-base">Use {SOURCE_NAMES[rec.baseSourceId]} as base (saves a revision)</button>
              : <p className="mt-1 text-[12px] text-muted-foreground">{SOURCE_NAMES[rec.baseSourceId]} is not a selected source, so the base stays unchanged.</p>)}
            <p className="mt-1 text-[13px]">{rec.featureIds.map((id) => byId(id)?.name).join(" · ")}</p>
            <button className={cn(btn.secondary, "mt-3")} disabled={busy} onClick={() => setDraft({ featureIds: rec.featureIds, experience: rec.experience })} data-testid="button-start-recommended">Start from recommended</button>
            <span className="ml-2 text-[12px] text-muted-foreground">Fills the draft only. Save to persist.</span>
          </div>

          <ul className="mt-4 divide-y divide-border rounded-xl border border-border" data-testid="list-features">
            {INVOICE_FEATURES.map((f) => {
              const req = REQUIRED_FEATURES.includes(f.id);
              const capOn = !f.capabilityId || c.capabilityIds.includes(f.capabilityId);
              const srcOn = hasSource(f.sourceId);
              const state = !f.capabilityId ? (sel.has(f.id) || req ? (req ? "required" : "selected") : "excluded") : !srcOn ? "missing" : !capOn ? "unavailable" : sel.has(f.id) ? "selected" : "excluded";
              const dependents = INVOICE_FEATURES.filter((x) => x.requires.includes(f.id));
              const cap = recipe.capabilities.find((x) => x.id === f.capabilityId);
              const hashOk = c.selectedSources.find((s) => s.id === f.sourceId)?.sha256 === reviewedInvoiceHashes[f.sourceId];
              return (
                <li key={f.id} className={cn("px-3 py-2.5", (state === "unavailable" || state === "missing") && "bg-muted/40")} data-testid={`feature-${f.id}`}>
                  <div className="flex items-start gap-3">
                    <button type="button" role="checkbox" aria-checked={sel.has(f.id)} aria-label={f.name} disabled={busy || req || state === "unavailable" || state === "missing"} onClick={() => toggle(f.id)}
                      className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors", sel.has(f.id) ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card", "disabled:cursor-not-allowed")} data-testid={`checkbox-${f.id}`}>
                      {req ? <Lock className="h-3 w-3" /> : sel.has(f.id) ? <Check className="h-3.5 w-3.5" /> : null}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("font-medium", state === "excluded" && "text-muted-foreground line-through decoration-1")}>{f.name}</span>
                        <Tag tone={state === "selected" || state === "required" ? "green" : state === "excluded" ? "muted" : "sienna"}>{state}</Tag>
                        {rec.featureIds.includes(f.id) && <Tag tone="sky">recommended</Tag>}
                      </div>
                      <p className="text-[12.5px] text-muted-foreground">{f.description} · from {SOURCE_NAMES[f.sourceId] ?? f.sourceId}</p>
                      {f.requires.length > 0 && <p className="text-[12px] text-primary">Requires {f.requires.map((r) => byId(r)?.name).join(", ")}</p>}
                      {dependents.length > 0 && <p className="text-[12px] text-muted-foreground">Needed by {dependents.map((d) => d.name).join(", ")}; excluding this also excludes them.</p>}
                      {state === "unavailable" && cap && <p className="mt-1 text-[12px]">Broad capability "{cap.name}" is switched off. <button className="font-medium text-primary underline" disabled={busy} onClick={() => onEnableCap(cap.id)} data-testid={`button-enable-cap-${f.id}`}>Enable {cap.name}</button> (saves a revision)</p>}
                      {state === "missing" && <p className="mt-1 text-[12px] text-siennaink">{SOURCE_NAMES[f.sourceId] ?? f.sourceId} is not a selected source, so this capability cannot be enabled.</p>}
                      {!f.capabilityId && !srcOn && <p className="mt-1 text-[12px] text-muted-foreground">Baseline: the combined app still uses its imported fixture/replay code, but {SOURCE_NAMES[f.sourceId] ?? f.sourceId} is not in your selection, so the inventory withholds a source-backed proposal for it.</p>}
                      {rec.why[f.id] && <p className="mt-0.5 text-[11.5px] italic text-muted-foreground">Why: {rec.why[f.id]}</p>}
                      <button className="mt-1 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground" onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id} data-testid={`button-evidence-${f.id}`}>Source evidence <ChevronDown className={cn("h-3 w-3 transition-transform", open === f.id && "rotate-180")} /></button>
                      {open === f.id && <div className="mt-1 rounded-lg bg-muted/50 p-2 font-mono text-[11px]">
                        {f.sourcePaths.map((p) => <div key={p} className="break-all">{p}</div>)}
                        <div className={cn("mt-1 break-all", !hashOk && "text-siennaink")}>{hashOk ? `reviewed sha256 ${reviewedInvoiceHashes[f.sourceId]?.slice(0, 16)}…` : "selected source differs from reviewed version, or is not selected"}</div>
                        <div className="mt-1 font-sans text-muted-foreground">Static source location. Not proof the combined app runs it.</div>
                      </div>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <h3 className="font-semibold">Design</h3>
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1" role="radiogroup">
              {(Object.keys(EXPERIENCES) as InvoiceExperience[]).map((e) => {
                const ok = validateInvoiceExperience(e, draft.featureIds);
                return <button key={e} role="radio" aria-checked={draft.experience === e} disabled={!ok || busy} title={ok ? "" : `Needs ${EXPERIENCES[e].needs.map((n) => byId(n)?.name).join(", ")}`} onClick={() => setDraft((d) => ({ ...d, experience: e }))}
                  className={cn("rounded-lg px-2 py-2 text-[12.5px] font-medium transition-colors disabled:opacity-40", draft.experience === e ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")} data-testid={`button-experience-${e}`}>{EXPERIENCES[e].name}{rec.experience === e && " ·  rec"}</button>;
              })}
            </div>
          </div>
          <div data-testid="panel-proposed-nav">
            <h4 className="text-[13px] font-semibold">Proposed navigation</h4>
            <ol className="mt-1 flex flex-wrap gap-1.5 text-[12.5px]" data-testid="list-proposed-nav">{pnav.nav.map((n) => <li key={n} className={cn("rounded-full border px-2.5 py-0.5", n === pnav.landing ? "border-primary bg-primary/10 font-medium text-primary" : "border-border")}>{n}{n === pnav.landing && " · opens here"}</li>)}</ol>
            <p className="mt-1 text-[12px] text-muted-foreground">Invoice detail is a shared destination from every view; spend tracing is a lens inside Budgets.{pnav.landing !== EXPERIENCES[draft.experience].landing && ` ${EXPERIENCES[draft.experience].landing} is not selected, so it opens on Invoices.`}</p>
          </div>
          <div><h4 className="text-[13px] font-semibold">Main journeys</h4><ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12.5px] text-muted-foreground">{proposedJourneys(draft.featureIds, draft.experience).map((j) => <li key={j}>{j}</li>)}</ul></div>
          <div><h4 className="text-[13px] font-semibold">Original UX patterns retained</h4><ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12.5px] text-muted-foreground">{retainedPatterns(draft.featureIds).map((j) => <li key={j}>{j}</li>)}</ul></div>
          <div data-testid="panel-exclusion-consequences">
            <h4 className="text-[13px] font-semibold">If excluded</h4>
            {excludedSel.length === 0 ? <p className="text-[12.5px] text-muted-foreground">Nothing available is excluded.</p>
              : <ul className="mt-1 space-y-0.5 text-[12.5px] text-muted-foreground">{excludedSel.map((id) => <li key={id}><AlertTriangle className="mr-1 inline h-3 w-3 text-siennaink" />{byId(id)?.name}: users fall back to the original {SOURCE_NAMES[byId(id)!.sourceId]} for this.</li>)}</ul>}
            <p className="mt-2 text-[12px] text-siennaink">Known gaps regardless of choice: no mark-paid command (controller-only payment stays in Approval Desk) and no per-predicate match explanations.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <button className={btn.primary} disabled={busy || !dirty} onClick={() => onSave({ ...(cfg ?? {}), schemaVersion: 1, featureIds: draft.featureIds, experience: draft.experience })} data-testid="button-save-features"><Save className="h-4 w-4" /> Save selection</button>
            <button className={btn.quiet} disabled={busy || legacy || !dirty} onClick={() => setDraft(saved)} data-testid="button-revert-features"><RotateCcw className="h-4 w-4" /> Revert</button>
            <p className="w-full text-[12px] text-muted-foreground">{dirty ? "Unsaved. Try it runs the saved revision only." : "Saved. Undo above reverts it."}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
