import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Check, Pencil, Plus, X } from "lucide-react";
import {
  useAddCapabilityRequest, useAnalyzePrototype, useCreateCase, useListSampleInputs, useRegisterPrototype,
  type PrototypeAnalysis, type PrototypeComponent, type PrototypeComponentInput, type PrototypeDetail, type PrototypeIntake as Intake, type PrototypePlatformKind,
} from "@workspace/api-client-react";
import { Textarea } from "@/components/ui/textarea";
import { Skel, Tag, btn, useUndoToast } from "@/components/bits";
import { errMsg, useCurrentCase, useInvalidateAll } from "@/lib/case";
import { useRole } from "@/lib/persona";
import { cn } from "@/lib/utils";

const PLATFORM_KIND: { value: PrototypePlatformKind; label: string }[] = [
  { value: "platform", label: "Low-code platform (Copilot Studio, Power Platform)" },
  { value: "saas", label: "SaaS tool" },
  { value: "agent_framework", label: "Agent framework (LangGraph, Semantic Kernel)" },
  { value: "notebook", label: "Notebook or script" },
  { value: "other", label: "Something else" },
];

export const VERDICT: Record<PrototypeComponent["verdict"], { label: string; tone: "green" | "sky" | "sienna" }> = {
  duplicates: { label: "Duplicates", tone: "green" },
  extends: { label: "Extends", tone: "sky" },
  new: { label: "New", tone: "sienna" },
};

type Example = { input: string; output: string; sampleInputId: string };
const emptyExample = (): Example => ({ input: "", output: "", sampleInputId: "" });

/**
 * "I have a prototype": describe it, paste at least one worked example, confirm the components the library found,
 * see where it fits, then register it. Submitted outputs are claims; the only real output shown is an existing
 * product's run on the same input.
 */
export function PrototypeIntake() {
  const role = useRole();
  const say = useUndoToast();
  const analyze = useAnalyzePrototype();
  const register = useRegisterPrototype();
  const samplesQ = useListSampleInputs();
  const [form, setForm] = useState({ name: "", platformKind: "platform" as PrototypePlatformKind, platformName: "", users: "", description: "", ownerName: "", ownerTeam: "", noRestrictedData: false });
  const [examples, setExamples] = useState<Example[]>([emptyExample()]);
  const [components, setComponents] = useState<PrototypeComponentInput[] | null>(null);
  const [registered, setRegistered] = useState<PrototypeDetail | null>(null);
  const analysis = analyze.data ?? null;

  const intake = (comps: PrototypeComponentInput[] | null): Intake => ({
    name: form.name.trim(),
    platformKind: form.platformKind,
    platformName: form.platformName.trim(),
    users: form.users.trim(),
    description: form.description.trim(),
    ...(form.ownerName.trim() ? { ownerName: form.ownerName.trim() } : {}),
    ...(form.ownerTeam.trim() ? { ownerTeam: form.ownerTeam.trim() } : {}),
    noRestrictedData: form.noRestrictedData,
    createdByRole: role,
    examples: examples.filter((e) => e.input.trim() && e.output.trim()).map((e) => ({ input: e.input.trim(), output: e.output.trim(), ...(e.sampleInputId ? { sampleInputId: e.sampleInputId } : {}) })),
    ...(comps ? { components: comps } : {}),
  });

  const problems = (): string | null => {
    if (form.name.trim().length < 2) return "Give the prototype a name.";
    if (form.platformName.trim().length < 2) return "Say what it runs on.";
    if (form.users.trim().length < 2) return "Say who uses it today.";
    if (form.description.trim().length < 10) return "One sentence on what it does, please.";
    const done = examples.filter((e) => e.input.trim().length >= 10 && e.output.trim().length >= 10);
    if (done.length === 0) return "Paste at least one worked example: the input you gave it and the output it produced.";
    return null;
  };

  const runAnalysis = (comps: PrototypeComponentInput[] | null) => {
    const p = problems();
    if (p) { say(p); return; }
    analyze.mutate({ data: intake(comps) }, { onError: (e) => say(errMsg(e)) });
  };

  // The person's list wins: every change re-runs the (deterministic) analysis and can be undone.
  const changeComponents = (next: PrototypeComponentInput[], msg: string) => {
    const before = components ?? (analysis?.components ?? []).map(toInput);
    setComponents(next);
    runAnalysis(next);
    say(msg, () => { setComponents(before); runAnalysis(before); });
  };

  const submitRegistration = () => {
    if (!form.noRestrictedData) { say("Confirm the examples contain no restricted data first."); return; }
    register.mutate({ data: intake(components ?? (analysis?.components ?? []).map(toInput)) }, {
      onSuccess: (d) => { setRegistered(d); say(`${d.prototype.name} is in the library`); },
      onError: (e) => say(errMsg(e)),
    });
  };

  if (registered) return <Registered detail={registered} exampleInput={examples.find((e) => e.input.trim())?.input.trim() ?? ""} />;

  const field = "h-11 w-full rounded-lg border border-input bg-card px-3 text-[15px] outline-none focus:border-primary";
  const label = "mb-1 block text-[13px] font-semibold text-primary";
  return (
    <div className="mt-7" data-testid="prototype-intake">
      <form onSubmit={(e) => { e.preventDefault(); runAnalysis(components); }} className="card-soft p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className={label} htmlFor="pi-name">What is it called?</label><input id="pi-name" data-testid="input-proto-name" className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Pump Watch" /></div>
          <div><label className={label} htmlFor="pi-users">Who uses it today?</label><input id="pi-users" data-testid="input-proto-users" className={field} value={form.users} onChange={(e) => setForm({ ...form, users: e.target.value })} placeholder="Two reliability engineers, Plant Ops North" /></div>
          <div><label className={label} htmlFor="pi-kind">Where does it run?</label>
            <select id="pi-kind" data-testid="select-proto-kind" className={field} value={form.platformKind} onChange={(e) => setForm({ ...form, platformKind: e.target.value as PrototypePlatformKind })}>{PLATFORM_KIND.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></div>
          <div><label className={label} htmlFor="pi-platform">Platform or tool name</label><input id="pi-platform" data-testid="input-proto-platform" className={field} value={form.platformName} onChange={(e) => setForm({ ...form, platformName: e.target.value })} placeholder="Copilot Studio" /></div>
          <div className="sm:col-span-2"><label className={label} htmlFor="pi-desc">What does it do? One sentence.</label><input id="pi-desc" data-testid="input-proto-description" className={field} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Reads a week of work orders and lists which pumps keep failing and what to do next." /></div>
          <div><label className={label} htmlFor="pi-owner">Owner (optional)</label><input id="pi-owner" data-testid="input-proto-owner" className={field} value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} placeholder="Leave blank if nobody owns it yet" /></div>
          <div><label className={label} htmlFor="pi-team">Owner's team (optional)</label><input id="pi-team" data-testid="input-proto-team" className={field} value={form.ownerTeam} onChange={(e) => setForm({ ...form, ownerTeam: e.target.value })} /></div>
        </div>

        <div className="mt-6">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold text-primary">Worked examples</span>
            <span className="text-[13.5px] text-muted-foreground">At least one: the input you gave it and the output it produced. Up to three.</span>
          </div>
          <div className="mt-2 space-y-3">
            {examples.map((ex, i) => (
              <div key={i} className="rounded-xl border border-border bg-background/60 p-3" data-testid={`example-${i + 1}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12px] text-muted-foreground">Example {i + 1}</span>
                  {(samplesQ.data?.length ?? 0) > 0 && (
                    <select data-testid={`select-sample-${i + 1}`} value={ex.sampleInputId} className="h-8 rounded-md border border-input bg-card px-2 text-[13px]"
                      onChange={(e) => { const s = samplesQ.data!.find((x) => x.id === e.target.value); setExamples(examples.map((x, j) => (j === i ? { ...x, sampleInputId: s?.id ?? "", input: s ? s.text : x.input } : x))); }}>
                      <option value="">Use a library sample input…</option>
                      {samplesQ.data!.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                  {examples.length > 1 && <button type="button" aria-label="Remove example" data-testid={`button-remove-example-${i + 1}`} onClick={() => { const before = examples; setExamples(examples.filter((_, j) => j !== i)); say(`Removed example ${i + 1}`, () => setExamples(before)); }} className="ml-auto rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-bad"><X className="h-4 w-4" /></button>}
                </div>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <div><span className={label}>Input</span><Textarea data-testid={`input-example-input-${i + 1}`} value={ex.input} onChange={(e) => setExamples(examples.map((x, j) => (j === i ? { ...x, input: e.target.value, sampleInputId: "" } : x)))} placeholder="Paste the text you gave the prototype" className="min-h-[140px] font-mono text-[12.5px]" /></div>
                  <div><span className={label}>Output it produced</span><Textarea data-testid={`input-example-output-${i + 1}`} value={ex.output} onChange={(e) => setExamples(examples.map((x, j) => (j === i ? { ...x, output: e.target.value } : x)))} placeholder={"Recurring equipment\n- P-104 ...\nWhat to do next\n- ..."} className="min-h-[140px] font-mono text-[12.5px]" /></div>
                </div>
              </div>
            ))}
            {examples.length < 3 && <button type="button" data-testid="button-add-example" onClick={() => setExamples([...examples, emptyExample()])} className={btn.quiet}><Plus className="h-4 w-4" /> Add another example</button>}
          </div>
        </div>

        <label className="mt-5 flex items-start gap-2 text-[14px]">
          <input type="checkbox" data-testid="checkbox-no-restricted" className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" checked={form.noRestrictedData} onChange={(e) => setForm({ ...form, noRestrictedData: e.target.checked })} />
          <span>These examples contain no restricted data. Submitted outputs are kept as examples only; they never count as evidence.</span>
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" data-testid="button-analyze-prototype" disabled={analyze.isPending} className={btn.primary}>{analyze.isPending ? "Looking…" : analysis ? "Look again" : "See where it fits"} <ArrowRight className="h-5 w-5" /></button>
          <span className="text-[13.5px] text-muted-foreground">Nothing is saved until you register it.</span>
        </div>
      </form>

      {analyze.isPending && !analysis && <div className="mt-6 space-y-3"><Skel className="h-24" /><Skel className="h-48" /></div>}
      {analysis && (
        <AnalysisView analysis={analysis} busy={analyze.isPending} onComponents={changeComponents} name={form.name.trim() || "this prototype"}
          footer={
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button data-testid="button-register-prototype" disabled={register.isPending || analyze.isPending} onClick={submitRegistration} className={btn.primary}>{register.isPending ? "Registering…" : "Register it in the library"} <Check className="h-5 w-5" /></button>
              <span className="text-[13.5px] text-muted-foreground">It appears as a prototype, labelled as running on {form.platformName.trim() || "its platform"}, not run by FUSEBOX. You can remove it afterwards.</span>
            </div>
          } />
      )}
    </div>
  );
}

const toInput = (c: PrototypeComponent): PrototypeComponentInput => ({ id: c.id, name: c.name, description: c.description, sectionTitles: c.sectionTitles });

export function AnalysisView({ analysis, busy, onComponents, name, footer, compact }: {
  analysis: PrototypeAnalysis; busy?: boolean; onComponents?: (next: PrototypeComponentInput[], msg: string) => void; name: string; footer?: ReactNode; compact?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [draft, setDraft] = useState("");
  const inputs = analysis.components.map(toInput);
  const cmp = analysis.comparison;
  return (
    <div className={cn("reveal", compact ? "mt-3" : "mt-8")} data-testid="prototype-analysis">
      <section>
        <div className="flex items-baseline gap-2">
          <h3 className="text-[17px] font-semibold">What {name} does</h3>
          <span className="text-[13.5px] text-muted-foreground">{onComponents ? "Read from the examples. Rename, remove or add anything; the verdicts update." : "As confirmed when it was registered."}</span>
        </div>
        <ul className={cn("mt-3 grid gap-2", compact ? "" : "md:grid-cols-2")} data-testid="list-components">
          {analysis.components.map((c) => (
            <li key={c.id} data-testid={`component-${c.id}`} className={cn("rounded-xl border border-border bg-card p-3.5", busy && "opacity-60")}>
              <div className="flex items-start gap-2">
                {editing === c.id ? (
                  <form className="flex flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); setEditing(null); if (editText.trim().length >= 2 && editText.trim() !== c.name) onComponents?.(inputs.map((x) => (x.id === c.id ? { ...x, name: editText.trim() } : x)), `Renamed to "${editText.trim()}"`); }}>
                    <input autoFocus data-testid={`input-component-${c.id}`} value={editText} onChange={(e) => setEditText(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(null)} className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-[15px] outline-none" />
                    <button aria-label="Save" data-testid={`button-save-component-${c.id}`} className="grid h-8 w-8 place-items-center rounded-full text-primary hover:bg-secondary"><Check className="h-4 w-4" /></button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 text-[15.5px] font-semibold text-primary">{c.name}</span>
                    <Tag tone={VERDICT[c.verdict].tone} testid={`verdict-${c.id}`}>{VERDICT[c.verdict].label}</Tag>
                    {onComponents && <>
                      <button aria-label="Rename component" data-testid={`button-edit-component-${c.id}`} onClick={() => { setEditing(c.id); setEditText(c.name); }} className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-primary"><Pencil className="h-3.5 w-3.5" /></button>
                      <button aria-label="Remove component" data-testid={`button-remove-component-${c.id}`} disabled={busy} onClick={() => onComponents(inputs.filter((x) => x.id !== c.id), `Removed "${c.name}"`)} className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-bad"><X className="h-3.5 w-3.5" /></button>
                    </>}
                  </>
                )}
              </div>
              <p className="mt-1 text-[13.5px] text-muted-foreground">{c.description}{c.sectionTitles.length ? ` · from "${c.sectionTitles.join('", "')}"` : ""}</p>
              <p className="mt-1.5 text-[14px]" data-testid={`reason-${c.id}`}>
                {c.matchedSolutionId && c.matchedCapabilityName ? <><Link href={`/solutions/${c.matchedSolutionId}`} className="font-semibold text-primary underline-offset-2 hover:underline">{c.matchedCapabilityName}</Link> · </> : null}{c.reason}
              </p>
            </li>
          ))}
          {onComponents && (
            <li>
              <form onSubmit={(e) => { e.preventDefault(); if (draft.trim().length >= 2) { onComponents([...inputs, { name: draft.trim() }], `Added "${draft.trim()}"`); setDraft(""); } }} className="flex h-full min-h-[56px] items-center gap-2 rounded-xl border border-dashed border-input bg-card px-3">
                <input data-testid="input-add-component" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add something it does that the examples do not show" className="h-9 flex-1 bg-transparent text-[14px] outline-none" />
                <button data-testid="button-add-component" aria-label="Add component" disabled={busy} className="grid h-8 w-8 place-items-center rounded-full text-primary hover:bg-secondary"><Plus className="h-4 w-4" /></button>
              </form>
            </li>
          )}
        </ul>
      </section>

      {cmp ? <Comparison cmp={cmp} compact={compact} /> : (
        <p className="mt-5 rounded-xl border border-dashed border-input bg-card px-4 py-3 text-[14px] text-muted-foreground" data-testid="text-comparison-fallback">{analysis.fallback}</p>
      )}

      <section className="mt-6 rounded-2xl border-l-4 border-l-sienna bg-card p-5 shadow-sm" data-testid="panel-recommendation">
        <div className="eyebrow !text-siennaink">Where it fits</div>
        <p className="mt-1 text-[17px] font-semibold text-primary" data-testid="text-recommendation">{analysis.recommendation}</p>
        <p className="mt-1 text-[13.5px] text-muted-foreground" data-testid="text-basis">{analysis.basis}</p>
        {footer}
      </section>
    </div>
  );
}

function Comparison({ cmp, compact }: { cmp: NonNullable<PrototypeAnalysis["comparison"]>; compact?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const bySection = useMemo(() => {
    const m = new Map<string, typeof cmp.lines>();
    for (const l of cmp.lines) m.set(l.section, [...(m.get(l.section) ?? []), l]);
    return [...m.entries()];
  }, [cmp]);
  const realLines = cmp.run.output.sections.flatMap((s) => s.items.map((it) => ({ section: s.title, text: it.text, key: `${s.key}:${it.key}` })));
  const matched = new Set(cmp.lines.map((l) => l.matchedText).filter(Boolean));
  const onlyReal = realLines.filter((r) => !matched.has(r.text));
  return (
    <section className="mt-6" data-testid="panel-comparison">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[17px] font-semibold">Same input, two outputs</h3>
        <span className="text-[13.5px] text-muted-foreground">{cmp.solutionName} ran your example just now. It reproduced {cmp.reproduced} of {cmp.lines.length} submitted lines and produced {cmp.onlyInReal} the prototype did not.</span>
      </div>
      <div className={cn("mt-3 grid gap-3", compact ? "" : "md:grid-cols-2")}>
        <div className="card-soft p-4" data-testid="panel-submitted">
          <div className="flex items-center gap-2"><Tag tone="slate">{cmp.submittedLabel}</Tag></div>
          <div className="mt-3 space-y-3">
            {bySection.map(([section, lines]) => (
              <div key={section}>
                <div className="eyebrow mb-1">{section}</div>
                <ul className="space-y-1">
                  {lines.map((l) => (
                    <li key={l.key} data-testid={`submitted-line-${l.status}`} className={cn("rounded-md border-l-[3px] px-2.5 py-1.5 text-[14px] leading-snug", l.status === "reproduced" ? "border-l-ok bg-okbg/60" : "border-l-sienna bg-accent/60")}>
                      {l.text}
                      <span className="block text-[12px] font-medium text-muted-foreground">{l.status === "reproduced" ? `Reproduced by ${l.matchedStepName ?? cmp.solutionName}: "${l.matchedText}"` : `Not produced by ${cmp.solutionName}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="card-soft p-4" data-testid="panel-real">
          <div className="flex items-center gap-2"><Tag tone="green">{cmp.realLabel}</Tag><span className="text-[12.5px] text-muted-foreground">{cmp.run.durationMs} ms · {cmp.run.stats.steps} steps</span></div>
          <p className="mt-3 text-[14px] font-semibold">{cmp.run.output.headline}</p>
          <div className="mt-2 space-y-3">
            {cmp.run.output.sections.map((s) => {
              const items = showAll ? s.items : s.items.filter((it) => matched.has(it.text)).concat(s.items.filter((it) => !matched.has(it.text)).slice(0, 2));
              return (
                <div key={s.key}>
                  <div className="eyebrow mb-1">{s.title}</div>
                  {items.length === 0 ? <p className="text-[13px] text-muted-foreground">Nothing produced.</p> : (
                    <ul className="space-y-1">{items.map((it) => <li key={it.id} className={cn("rounded-md border-l-[3px] px-2.5 py-1.5 text-[14px] leading-snug", matched.has(it.text) ? "border-l-ok bg-okbg/60" : "border-l-transparent")}>{it.text}{it.detail && <span className="block text-[12px] text-muted-foreground">{it.detail}</span>}</li>)}</ul>
                  )}
                </div>
              );
            })}
          </div>
          {onlyReal.length > 2 && <button data-testid="button-show-all-real" onClick={() => setShowAll((v) => !v)} className={cn(btn.quiet, "mt-2")}>{showAll ? "Show fewer" : `Show all ${realLines.length} lines`}</button>}
        </div>
      </div>
    </section>
  );
}

/** After registration: the record exists; one next step, matching the recommended path. */
function Registered({ detail, exampleInput }: { detail: PrototypeDetail; exampleInput: string }) {
  const { prototype: p, analysis } = detail;
  const [, setLocation] = useLocation();
  const { setCaseId } = useCurrentCase();
  const role = useRole();
  const say = useUndoToast();
  const invalidate = useInvalidateAll();
  const create = useCreateCase();
  const request = useAddCapabilityRequest();
  const extendsComps = analysis.components.filter((c) => c.verdict === "extends");
  const newComps = analysis.components.filter((c) => c.verdict === "new");
  const example = analysis.comparison ? (p.examples.find((e) => e.id === analysis.comparison!.exampleId)?.input ?? exampleInput) : exampleInput;

  const openExperiment = () => {
    if (!analysis.targetSolutionId) return;
    const names = extendsComps.map((c) => c.name).join(", ");
    create.mutate({ data: {
      baseSolutionId: analysis.targetSolutionId, createdByRole: role, title: `${p.name}: connect ${names}`,
      intent: `Connect ${names} from the ${p.name} prototype to ${analysis.targetSolutionName}, tested on the prototype's own example.`,
      ...(analysis.targetCapabilityId ? { moduleIds: [analysis.targetCapabilityId] } : {}),
      ...(p.reuseEventId ? { reuseEventId: p.reuseEventId } : {}),
      ...(example ? { presetInputText: example } : {}),
    } }, {
      onSuccess: (c) => {
        const go = () => { invalidate(); setCaseId(c.id); setLocation(`/workbench/${c.id}?mode=input`); };
        if (analysis.targetCapabilityId || extendsComps.length === 0) { go(); return; }
        // Nothing in the library can be switched on for this: record it where the owner will see it, as a capability request.
        request.mutate({ caseId: c.id, data: { need: `${p.name} produces ${names} on the same input.`, missing: extendsComps.map((x) => `${x.name}: ${x.description}`).join(" ") } }, { onSuccess: go, onError: (e) => { say(errMsg(e)); go(); } });
      },
      onError: (e) => say(errMsg(e)),
    });
  };

  return (
    <div className="reveal mt-7" data-testid="prototype-registered">
      <div className="card-soft border-l-4 border-l-ok p-6">
        <div className="eyebrow !text-ok">Registered</div>
        <h3 className="mt-1 text-[22px] font-semibold text-primary">{p.name} is in the library</h3>
        <p className="mt-1 text-[15px]">Listed as a prototype that runs on {p.platformName}, not run by FUSEBOX. {analysis.recommendation}</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {analysis.recommendedPath === "connect_module" && analysis.targetLive && (
            <button data-testid="button-open-experiment" disabled={create.isPending || request.isPending} onClick={openExperiment} className={btn.primary}>
              {create.isPending || request.isPending ? "Opening…" : `Try it on ${analysis.targetSolutionName} with your example`} <ArrowRight className="h-5 w-5" />
            </button>
          )}
          {analysis.recommendedPath === "fold_into" && analysis.targetSolutionId && (
            <Link href={`/solutions/${analysis.targetSolutionId}`} data-testid="button-open-target" className={btn.primary}>Open {analysis.targetSolutionName} <ArrowRight className="h-5 w-5" /></Link>
          )}
          <Link href={`/solutions/${p.id}`} data-testid="link-prototype-record" className={analysis.recommendedPath === "register_new" ? btn.primary : btn.secondary}>See the record <ArrowRight className="h-4 w-4" /></Link>
          <button data-testid="button-register-another" onClick={() => setLocation(`/discover?mode=prototype&again=${Date.now()}`)} className={btn.quiet}>Register another</button>
        </div>
        <p className="mt-3 text-[13.5px] text-muted-foreground">
          {analysis.recommendedPath === "connect_module" && (analysis.targetCapabilityId ? `Opens an experiment with ${analysis.targetSolutionName}'s matching module switched on and your example as the input.` : `Opens an experiment on your example and records ${extendsComps.map((c) => c.name).join(", ")} as a capability request for the owner.`)}
          {analysis.recommendedPath === "fold_into" && `Nothing new to build: ${analysis.targetSolutionName} already does this. ${!p.ownerName || p.ownerName === "Unassigned" ? "IT sees the prototype in the decision queue." : "The product's owner sees the prototype on their page."}`}
          {analysis.recommendedPath === "register_new" && `Listed in the library${newComps.length ? ` with ${newComps.map((c) => c.name).join(", ")} as new components` : ""}; the next brief about this lands on it. ${!p.ownerName || p.ownerName === "Unassigned" ? "IT sees it in the decision queue until an owner is named." : "It stays a prototype until it runs inside FUSEBOX."}`}
        </p>
      </div>
    </div>
  );
}
