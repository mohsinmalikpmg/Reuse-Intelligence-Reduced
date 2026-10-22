/**
 * Reuse-first prompts inside the workbench: the "+ Add a step" picker and "Add a requirement" both ask what should
 * happen, check what already exists, and only then offer to try, improve, or deliberately request something new.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, ChevronDown, ChevronRight, Plus, Search, X, Zap } from "lucide-react";
import {
  getGetSolutionWorkbenchQueryKey, useAddCaseRequirement, useGetSolutionWorkbench, useReuseCheck, useUpdateReuseEvent,
  type Capability, type CaseRequirement, type CaseRequirementResult, type ComponentConfig, type Configuration, type ReuseCheckResult, type ReuseOption,
} from "@workspace/api-client-react";
import { Textarea } from "@/components/ui/textarea";
import { Tag, btn, useUndoToast } from "@/components/bits";
import { errMsg } from "@/lib/case";
import { cn } from "@/lib/utils";

export type PathTaken = "use" | "improve" | "create" | "dismissed" | "explored";

/** What the workbench can do with a reuse option. The parent owns configuration changes so every one is undoable. */
export type ReuseActions = {
  caseId: string;
  baseName: string;
  cfg: Configuration;
  busy: boolean;
  /** Switch a capability on in Version B (mode decides the recorded path and whether its settings open). */
  onAdd: (c: ComponentConfig, mode: "use" | "improve") => void;
  onOpenStep: (capId: string) => void;
  onRequest: (input: { need: string; missing: string; afterStepId: string | null; reuseEventId: string }) => Promise<void>;
};

function componentFor(cfg: Configuration, capId: string): ComponentConfig | null {
  for (const st of cfg.steps) for (const c of st.components) if (c.capability.id === capId) return c;
  return null;
}

const SCORE_FLOOR = 60;
const PATH_LABEL: Record<ReuseOption["path"], string> = { try_existing: "Try existing", improve_existing: "Start from and improve", new_experiment: "New experiment allowed", hard_exclusion: "Cannot be used here" };

function usePathTaken(eventId: string) {
  const update = useUpdateReuseEvent();
  return (pathTaken: PathTaken) => update.mutate({ eventId, data: { pathTaken } });
}

/* ---------- Output example: the step's real lines from its home product's saved run ---------- */

export function OutputExample({ cap }: { cap: Capability }) {
  const q = useGetSolutionWorkbench(cap.sourceSolutionId, { query: { queryKey: getGetSolutionWorkbenchQueryKey(cap.sourceSolutionId) } });
  if (q.isLoading) return <p className="text-[13px] text-muted-foreground">Loading the saved example...</p>;
  if (!q.data) return <p className="text-[13px] text-muted-foreground">The example run could not load.</p>;
  const run = q.data.exampleRun;
  const lines = run.output.sections.flatMap((s) => s.items).filter((i) => i.stepId === cap.id).slice(0, 4);
  const sample = q.data.sampleInputs.find((s) => s.id === run.sampleInputId);
  return (
    <div className="rounded-lg bg-muted/60 p-3" data-testid="panel-output-example">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What {cap.name} produced in {cap.sourceSolutionName}{sample ? ` on "${sample.name}"` : ""}</div>
      {lines.length === 0 ? <p className="text-[13px] text-muted-foreground">This step produced no lines in the saved example.</p> : (
        <ul className="space-y-1 text-[13px] leading-snug">{lines.map((l) => <li key={l.id} className="rounded bg-card px-2 py-1">{l.text}</li>)}</ul>
      )}
    </div>
  );
}

/* ---------- Up to three options for a need, in the workbench ---------- */

function CapabilityCard({ o, primary, actions, afterStepId, onTaken }: { o: ReuseOption; primary: boolean; actions: ReuseActions; afterStepId: string | null; onTaken: (p: PathTaken) => void }) {
  const [why, setWhy] = useState(false);
  const [example, setExample] = useState(false);
  const cap = o.capability!;
  const comp = componentFor(actions.cfg, cap.id);
  const excluded = o.path === "hard_exclusion";
  const inB = !!comp?.active;
  const canAdd = !!comp && !comp.active && comp.state !== "incompatible" && !comp.blockedReason && !excluded;
  const blocked = excluded ? o.exclusions[0] ?? "Cannot be used here." : comp?.blockedReason ?? (comp ? null : `Not addable to ${actions.baseName} from here.`);
  void afterStepId;
  return (
    <article data-testid="card-reuse-option-capability" className={cn("card-soft p-4", primary && !excluded && "border-l-4 border-l-sienna")}>
      <div className="text-[12px] font-semibold uppercase tracking-wide text-siennaink">{inB ? "Already in Version B" : excluded ? "Exists, but cannot be used here" : "A similar capability already exists"}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h4 className="text-[16px] font-semibold">{cap.name}</h4>
        <span className="text-[13px] text-muted-foreground">from {cap.sourceSolutionName} · {cap.workflowStep}</span>
      </div>
      <p className="mt-1 text-[14px] text-foreground">{cap.description}</p>
      {blocked && !inB && <p className="mt-1.5 text-[13.5px] text-muted-foreground" data-testid="text-option-blocked">{blocked}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {inB ? (
          <button data-testid="button-open-step" onClick={() => actions.onOpenStep(cap.id)} className={btn.secondary}>Open the step <ArrowRight className="h-4 w-4" /></button>
        ) : canAdd ? (
          <button data-testid="button-try-capability" disabled={actions.busy} onClick={() => { onTaken("use"); actions.onAdd(comp!, "use"); }} className={cn(primary ? btn.primary : btn.secondary, "min-h-11 px-5 text-[15px]")}>
            Try {cap.name} <ArrowRight className="h-4 w-4" />
          </button>
        ) : o.solutionId ? (
          <Link href={`/solutions/${o.solutionId}`} data-testid="button-open-solution" className={btn.secondary} onClick={() => onTaken("explored")}>See it in {cap.sourceSolutionName} <ArrowRight className="h-4 w-4" /></Link>
        ) : null}
        <button data-testid="button-output-example" aria-expanded={example} onClick={() => setExample((v) => !v)} className="text-[13.5px] font-semibold text-primary hover:underline">{example ? "Hide output example" : "See output example"}</button>
        {canAdd && <button data-testid="button-improve-capability" disabled={actions.busy} onClick={() => { onTaken("improve"); actions.onAdd(comp!, "improve"); }} className="text-[13.5px] font-semibold text-primary hover:underline">Improve this capability</button>}
        {o.dimensions && <button data-testid="button-reuse-why" onClick={() => setWhy((v) => !v)} className="ml-auto text-[13px] font-semibold text-siennaink hover:underline">{why ? "Hide" : "Why?"}</button>}
      </div>
      {example && <div className="mt-3"><OutputExample cap={cap} /></div>}
      {why && (
        <p className="mt-3 text-[13px] text-muted-foreground" data-testid="text-reuse-score">
          <span className="font-semibold text-foreground">Reuse fit {Math.round(o.score ?? 0)} of 100 · {PATH_LABEL[o.path]}.</span> {o.reasons.slice(0, 3).join(" ")}
        </p>
      )}
    </article>
  );
}

function ClosestCard({ o, onTaken }: { o: ReuseOption; onTaken: (p: PathTaken) => void }) {
  const isExp = o.kind === "experiment";
  return (
    <article data-testid={`card-reuse-option-${o.kind}`} className="card-soft p-4">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{isExp ? "Closest active experiment" : "Closest approved configuration"}</div>
      <h4 className="mt-1 text-[16px] font-semibold">{o.title}</h4>
      <p className="mt-1 text-[13.5px] text-muted-foreground">{o.subtitle}</p>
      <div className="mt-3">
        {isExp && o.caseId ? (
          <Link href={`/workbench/${o.caseId}`} data-testid="button-open-experiment" className={btn.secondary} onClick={() => onTaken("explored")}>Open the experiment <ArrowRight className="h-4 w-4" /></Link>
        ) : o.solutionId ? (
          <Link href={`/solutions/${o.solutionId}`} data-testid="button-open-solution" className={btn.secondary} onClick={() => onTaken("explored")}>Explore it <ArrowRight className="h-4 w-4" /></Link>
        ) : null}
      </div>
    </article>
  );
}

/** "Create a different approach": one question, then the need is recorded as a capability request, not built. */
function CreateCard({ need, primary, afterStepId, eventId, actions, onDone }: { need: string; primary: boolean; afterStepId: string | null; eventId: string; actions: ReuseActions; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (missing.trim().length < 3) return;
    setSaving(true);
    try { await actions.onRequest({ need, missing: missing.trim(), afterStepId, reuseEventId: eventId }); onDone(); } finally { setSaving(false); }
  };
  if (!open) {
    return (
      <button data-testid="button-create-approach" onClick={() => setOpen(true)} className={cn(primary ? btn.primary : btn.quiet, primary && "min-h-11 px-5 text-[15px]")}>
        <Plus className="h-4 w-4" /> Create a different approach
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="card-soft reveal p-4" data-testid="form-capability-request">
      <label htmlFor="missing" className="block text-[15px] font-semibold">What is missing from the existing approach?</label>
      <p className="mt-0.5 text-[13px] text-muted-foreground">Your answer is recorded as a request on this experiment. Nothing is built or counted in the output until someone owns it.</p>
      <Textarea id="missing" autoFocus data-testid="input-missing" value={missing} onChange={(e) => setMissing(e.target.value)} className="mt-2 min-h-[72px] text-[14px]" placeholder="For example: nothing forecasts which equipment will fail next" />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button data-testid="button-record-request" disabled={saving || missing.trim().length < 3} className={btn.primary}>{saving ? "Recording..." : "Record the request"}</button>
        <button type="button" onClick={() => setOpen(false)} className={btn.quiet}>Back</button>
      </div>
    </form>
  );
}

export function ReuseOptionsWB({ result, actions, afterStepId, browse, onDone, onDismiss }: {
  result: ReuseCheckResult; actions: ReuseActions; afterStepId: string | null;
  /** The old capability list, reachable but not the default view */
  browse?: ReactNode; onDone: () => void; onDismiss: () => void;
}) {
  const taken = usePathTaken(result.eventId);
  const [browsing, setBrowsing] = useState(false);
  const shown = result.options.filter((o) => o.kind !== "create" && o.score !== null && o.score >= SCORE_FLOOR);
  const capOpt = shown.find((o) => o.kind === "capability");
  const closest = shown.find((o) => o.kind !== "capability");
  const capViable = !!capOpt && capOpt.path !== "hard_exclusion" && !!componentFor(actions.cfg, capOpt.capability!.id);
  return (
    <div className="space-y-3" data-testid="panel-reuse-options">
      {shown.length === 0 && (
        <p className="text-[14px] text-muted-foreground" data-testid="text-reuse-nothing">Nothing existing matches this closely. Browse the capabilities, or record what you need.</p>
      )}
      {capOpt && <CapabilityCard o={capOpt} primary={capViable} actions={actions} afterStepId={afterStepId} onTaken={(p) => { taken(p); if (p !== "dismissed") onDone(); }} />}
      {closest && <ClosestCard o={closest} onTaken={taken} />}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <CreateCard need={result.need} primary={!capViable} afterStepId={afterStepId} eventId={result.eventId} actions={actions} onDone={onDone} />
        {browse && <button data-testid="button-browse-capabilities" aria-expanded={browsing} onClick={() => setBrowsing((v) => !v)} className={btn.quiet}><ChevronDown className={cn("h-4 w-4 transition-transform", browsing && "rotate-180")} /> Browse capabilities</button>}
        <button data-testid="button-dismiss-reuse" onClick={() => { taken("dismissed"); onDismiss(); }} className="ml-auto text-[13px] font-semibold text-primary hover:underline">Not now</button>
      </div>
      {browsing && browse && <div className="reveal" data-testid="panel-browse">{browse}</div>}
    </div>
  );
}

/* ---------- "+ Add a step" picker: one question first ---------- */

export function StepPicker({ afterId, afterName, actions, browse, onClose }: { afterId: string | null; afterName: string | null; actions: ReuseActions; browse: ReactNode; onClose: () => void }) {
  const check = useReuseCheck();
  const say = useUndoToast();
  const [need, setNeed] = useState("");
  const [result, setResult] = useState<ReuseCheckResult | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const run = (e: FormEvent) => {
    e.preventDefault();
    const text = need.trim();
    if (text.length < 3) return;
    check.mutate({ data: { need: text, trigger: "add_step", caseId: actions.caseId } }, { onSuccess: setResult, onError: (err) => say(errMsg(err)) });
  };
  return (
    <div className="reveal mt-1 rounded-xl border border-sienna/50 bg-card p-3 shadow-sm" data-testid={`picker-${afterId ?? "end"}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted-foreground">Add to Version B{afterName ? ` after ${afterName}` : ""}</span>
        <button aria-label="Close" data-testid="button-close-picker" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
      </div>
      <form onSubmit={run} className="flex flex-wrap items-center gap-2">
        <label htmlFor={`need-${afterId ?? "end"}`} className="w-full text-[16px] font-semibold text-primary">What should happen here?</label>
        <input
          id={`need-${afterId ?? "end"}`} autoFocus data-testid="input-step-need" value={need} onChange={(e) => setNeed(e.target.value)}
          placeholder="Describe it in a sentence, e.g. flag work orders that could become a safety incident"
          className="h-11 min-w-[200px] flex-1 rounded-lg border border-input bg-card px-3 text-[15px] outline-none focus:border-primary"
        />
        <button data-testid="button-check-step" disabled={check.isPending || need.trim().length < 3} className={cn(btn.primary, "min-h-11 px-5 text-[15px]")}><Search className="h-4 w-4" /> {check.isPending ? "Checking..." : "Check what exists"}</button>
      </form>
      {result ? (
        <div className="mt-3">
          <ReuseOptionsWB result={result} actions={actions} afterStepId={afterId} browse={browse} onDone={onClose} onDismiss={onClose} />
        </div>
      ) : (
        <div className="mt-2">
          <button data-testid="button-browse-capabilities" aria-expanded={browsing} onClick={() => setBrowsing((v) => !v)} className={cn(btn.quiet, "px-1")}><ChevronRight className={cn("h-4 w-4 transition-transform", browsing && "rotate-90")} /> Browse capabilities instead</button>
          {browsing && <div className="reveal mt-1" data-testid="panel-browse">{browse}</div>}
        </div>
      )}
      <p className="mt-2 text-[12px] text-muted-foreground">Steps run in the order the solution defines, so where you add one does not change the result.</p>
    </div>
  );
}

/* ---------- "Add a requirement" from the pinned input bar ---------- */

export function RequirementAdder({ actions, briefRequirements, caseRequirements, onAdded, onRemove, onRunBoth, runBothBusy, needsBoth }: {
  actions: ReuseActions;
  briefRequirements: string[];
  caseRequirements: CaseRequirement[];
  /** Called with the result so the parent can refresh the case and offer undo */
  onAdded: (r: CaseRequirementResult) => void;
  onRemove: (id: string, text: string) => void;
  onRunBoth: () => void; runBothBusy: boolean;
  /** True once Version B differs from A and has not been compared since */
  needsBoth: boolean;
}) {
  const add = useAddCaseRequirement();
  const say = useUndoToast();
  const [text, setText] = useState("");
  const [last, setLast] = useState<CaseRequirementResult | null>(null);
  const [state, setState] = useState<"idle" | "added" | "dismissed">("idle");
  const caseReqs = caseRequirements;
  const briefOnly = briefRequirements.filter((t) => !caseReqs.some((r) => r.text.toLowerCase() === t.toLowerCase()));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (t.length < 3) return;
    add.mutate({ caseId: actions.caseId, data: { text: t } }, {
      onSuccess: (r) => { setLast(r); setState("idle"); setText(""); onAdded(r); },
      onError: (err) => say(errMsg(err)),
    });
  };
  const cov = last?.coverage;
  return (
    <section className="card-soft reveal mt-1 p-4" data-testid="panel-add-requirement">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <label htmlFor="case-requirement" className="w-full text-[16px] font-semibold text-primary">It must also...</label>
        <input id="case-requirement" autoFocus data-testid="input-case-requirement" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. flag maintenance issues that may create a safety risk" className="h-11 min-w-[200px] flex-1 rounded-lg border border-input bg-card px-3 text-[15px] outline-none focus:border-primary" />
        <button data-testid="button-submit-requirement" disabled={add.isPending || text.trim().length < 3} className={cn(btn.primary, "min-h-11 px-5 text-[15px]")}><Plus className="h-4 w-4" /> {add.isPending ? "Checking..." : "Add requirement"}</button>
      </form>
      {(briefOnly.length > 0 || caseReqs.length > 0) && (
        <ul className="mt-3 flex flex-wrap gap-1.5" data-testid="list-case-requirements">
          {briefOnly.map((t) => <li key={t} className="rounded-full border border-input bg-card px-3 py-1 text-[13px]">{t}</li>)}
          {caseReqs.map((r) => (
            <li key={r.id} data-testid={`chip-case-requirement-${r.id}`} className="inline-flex items-center gap-1 rounded-full border border-sienna/60 bg-card py-1 pl-3 pr-1 text-[13px]">
              {r.text}
              <button aria-label="Remove requirement" data-testid={`button-remove-case-requirement-${r.id}`} onClick={() => { onRemove(r.id, r.text); if (last?.requirement.id === r.id) setState("dismissed"); }} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-bad"><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      {last && cov && state !== "dismissed" && (
        <div className="mt-4 border-t border-border pt-3" data-testid="panel-requirement-result">
          <div className="flex flex-wrap items-center gap-2 text-[14px]">
            <span className="font-semibold">"{last.requirement.text}"</span>
            {cov.covered ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-okbg px-2 py-0.5 text-[12.5px] font-semibold text-ok" data-testid="text-covered-by-a"><Check className="h-3.5 w-3.5" /> AI-inferred fit in Version A: {cov.capabilityName}</span>
            ) : (
              <Tag tone="sienna" testid="text-not-covered-by-a">Coverage not established from available evidence</Tag>
            )}
          </div>
          {cov.covered ? (
            <p className="mt-2 text-[13.5px] text-muted-foreground" data-testid="text-covered-note">AI found documented capability fit. This is not execution proof; verify the current configuration before relying on it.</p>
          ) : state === "added" ? (
            <div className="mt-3 flex flex-wrap items-center gap-3" data-testid="panel-run-both-prompt">
              <span className="text-[14px]">Added to Version B. Fuse A/B to see what it changes.</span>
              <button data-testid="button-run-both-prompt" onClick={onRunBoth} disabled={runBothBusy || !needsBoth} className={cn(btn.accent, "min-h-11 px-5 text-[15px]")}><Zap className="h-4 w-4" /> {runBothBusy ? "Fusing..." : "Fuse A/B"}</button>
            </div>
          ) : (
            <div className="mt-3">
              <ReuseOptionsWB result={last.check} actions={{ ...actions, onAdd: (c, mode) => { actions.onAdd(c, mode); setState("added"); } }} afterStepId={null} onDone={() => setState((s) => (s === "idle" ? "dismissed" : s))} onDismiss={() => setState("dismissed")} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
