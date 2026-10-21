import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearch } from "wouter";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { GitCompare, Lock, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Play, PencilRuler, RotateCcw, Save, ShieldCheck, Undo2 } from "lucide-react";
import {
  getGetCaseComparisonQueryKey, getGetCaseConfigurationQueryKey, getGetCaseQueryKey, getGetSolutionWorkbenchQueryKey, getListSampleInputsQueryKey,
  useGetCase, useGetCaseComparison, useGetCaseConfiguration, useGetSolutionWorkbench, useListSampleInputs, useRunCaseComparison, useRunWorkflow, useUpdateCase, useUpdateCaseConfiguration,
  type ABComparison, type ComponentConfig, type Configuration, type ConfigurationUpdate, type DiffEntry, type Run, type SampleInput, type StepTrace,
} from "@workspace/api-client-react";
import { DSection, Drawer, ErrorView, LoadingView, Skel, Tag, btn, useUndoToast } from "@/components/bits";
import { Flow, blocksFromConfig, blocksFromWorkbench, controlsFromConfig, type FlowBlock } from "@/components/flow";
import { OutputView, RunMeta } from "@/components/output-view";
import { InputPanel, Tray } from "@/components/wb-parts";
import { CompareOutputs, DiffSummary, Measures, StaleHint, Vote } from "@/components/wb-compare";
import { InviteTesters, OwnerDecision, PilotButton, STATUS_LABEL } from "@/components/wb-pilot";
import { errMsg, useInvalidateCase } from "@/lib/case";
import { useRole } from "@/lib/persona";
import { cn } from "@/lib/utils";

type Mode = "run" | "edit" | "compare";
type Snap = { moduleStates: Record<string, boolean>; configValues: Record<string, string> };
const dropUnderPointer: CollisionDetection = (args) => { const hits = pointerWithin(args); return hits.length ? hits : rectIntersection(args); };

function snapshot(cfg: Configuration): Snap {
  const s: Snap = { moduleStates: {}, configValues: {} };
  for (const st of cfg.steps) for (const c of st.components) {
    if (c.controlType === "optional" && c.state !== "incompatible") s.moduleStates[c.capability.id] = c.active;
    if (c.controlType === "configurable" && c.value) s.configValues[c.capability.id] = c.value;
  }
  return s;
}

export default function Workbench() {
  const { caseId } = useParams<{ caseId: string }>();
  const initialMode = new URLSearchParams(useSearch()).get("mode");
  const role = useRole();
  const qc = useQueryClient();
  const say = useUndoToast();
  const invalidateCase = useInvalidateCase();
  const [mode, setMode] = useState<Mode>(initialMode === "edit" || initialMode === "compare" ? initialMode : "run");
  const caseQ = useGetCase(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseQueryKey(caseId) } });
  const baseId = caseQ.data?.baseSolutionId ?? "";
  const cfgQ = useGetCaseConfiguration(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseConfigurationQueryKey(caseId) } });
  const wbQ = useGetSolutionWorkbench(baseId, { query: { enabled: !!baseId, queryKey: getGetSolutionWorkbenchQueryKey(baseId) } });
  const samplesQ = useListSampleInputs({ solutionId: baseId }, { query: { enabled: !!baseId, queryKey: getListSampleInputsQueryKey({ solutionId: baseId }) } });
  const cmpQ = useGetCaseComparison(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseComparisonQueryKey(caseId) } });
  const put = useUpdateCaseConfiguration();
  const runOne = useRunWorkflow();
  const runBoth = useRunCaseComparison();
  const updCase = useUpdateCase();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const [sampleId, setSampleId] = useState("");
  const [text, setText] = useState("");
  const [edited, setEdited] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [undo, setUndo] = useState<Snap[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  const [picked, setPicked] = useState<DiffEntry | null>(null);
  const [drawer, setDrawer] = useState<{ id: string; name: string } | null>(null);

  const samples = samplesQ.data ?? wbQ.data?.sampleInputs ?? [];
  useEffect(() => {
    if (sampleId || !samples.length) return;
    const pref = wbQ.data?.exampleRun.sampleInputId;
    const s = samples.find((x) => x.id === pref) ?? samples[0];
    setSampleId(s.id); setText(s.text);
  }, [samples, sampleId, wbQ.data]);

  const cfg = cfgQ.data;
  const bBlocks = useMemo(() => (cfg && baseId ? blocksFromConfig(cfg, baseId) : []), [cfg, baseId]);
  const aBlocks = useMemo(() => (wbQ.data ? blocksFromWorkbench(wbQ.data.blocks) : []), [wbQ.data]);
  const controls = useMemo(() => (cfg ? controlsFromConfig(cfg) : []), [cfg]);
  const { recs, more } = useMemo(() => {
    const all = (cfg?.steps ?? []).flatMap((s) => s.components).filter((c) => c.executable && c.controlType === "optional" && !c.active && c.capability.sourceSolutionId !== baseId);
    const sorted = [...all].sort((a, b) => Number(b.recommended) - Number(a.recommended) || Number(a.state === "incompatible") - Number(b.state === "incompatible"));
    return { recs: sorted.slice(0, 2), more: sorted.slice(2) };
  }, [cfg, baseId]);
  const cmp: ABComparison | undefined = cmpQ.data?.[0];
  const editable = role !== "it" && (mode === "edit" || mode === "compare");
  const inputArgs = edited ? { inputText: text } : { sampleInputId: sampleId };
  const changedFromA = useMemo(() => {
    const a = new Map(aBlocks.map((b) => [b.id, b]));
    // Version A only lists the steps that run in production, so a step missing from A counts as inactive there.
    return bBlocks.filter((b) => { const x = a.get(b.id); return x ? x.active !== b.active || x.value !== b.value : b.active; }).map((b) => b.id);
  }, [aBlocks, bBlocks]);

  const apply = (data: ConfigurationUpdate, label: string, record = true) => {
    if (!cfg) return;
    const before = snapshot(cfg);
    put.mutate({ caseId, data }, {
      onSuccess: (next) => {
        qc.setQueryData(getGetCaseConfigurationQueryKey(caseId), next);
        qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes(`/cases/${caseId}`) && String(q.queryKey[0]) !== getGetCaseConfigurationQueryKey(caseId)[0] });
        if (record) { setUndo((u) => [...u, before]); say(label, () => restore(before)); } else say(label);
      },
      onError: (e) => say(errMsg(e)),
    });
  };
  const restore = (s: Snap) => { setUndo((u) => u.slice(0, -1)); apply(s, "Undone", false); };
  const toggle = (id: string, name: string, on: boolean) => apply({ moduleStates: { [id]: on } }, on ? `${name} added to Version B` : `${name} switched off`);
  const add = (c: ComponentConfig) => {
    if (c.blockedReason) { say(c.blockedReason); return; }
    if (mode === "run") setMode("edit");
    toggle(c.capability.id, c.capability.name, true);
  };
  const resetToA = () => {
    if (!cfg) return;
    const a = new Map(aBlocks.map((b) => [b.id, b]));
    const s: Snap = { moduleStates: {}, configValues: {} };
    for (const st of cfg.steps) for (const c of st.components) {
      if (c.controlType === "optional" && c.state !== "incompatible") s.moduleStates[c.capability.id] = a.get(c.capability.id)?.active ?? false;
      if (c.controlType === "configurable") { const v = a.get(c.capability.id)?.value ?? c.capability.defaultOption; if (v) s.configValues[c.capability.id] = v; }
    }
    apply(s, "Version B reset to match Version A");
  };
  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id).replace("add:", "");
    setDragging(null);
    if (!e.over || e.over.id !== "workflow-b") return;
    const c = [...recs, ...more].find((x) => x.capability.id === id);
    if (c) add(c);
  };

  const doRun = () => runOne.mutate({ data: { caseId, version: "B", ...inputArgs } }, { onSuccess: (r) => { setRun(r); invalidateCase(caseId); }, onError: (e) => say(errMsg(e)) });
  const doBoth = () => runBoth.mutate({ caseId, data: inputArgs }, {
    onSuccess: (r) => { qc.setQueryData<ABComparison[]>(getGetCaseComparisonQueryKey(caseId), (old) => [r, ...(old ?? [])]); setPicked(null); invalidateCase(caseId); },
    onError: (e) => say(errMsg(e)),
  });
  const pickSample = (s: SampleInput) => { setSampleId(s.id); setText(s.text); setEdited(false); };
  const tryAnother = () => {
    const i = samples.findIndex((s) => s.id === sampleId);
    const next = samples[(i + 1) % samples.length];
    if (!next) return;
    pickSample(next);
    runBoth.mutate({ caseId, data: { sampleInputId: next.id } }, {
      onSuccess: (r) => { qc.setQueryData<ABComparison[]>(getGetCaseComparisonQueryKey(caseId), (old) => [r, ...(old ?? [])]); setPicked(null); invalidateCase(caseId); say(`Ran both on "${next.name}".`); },
      onError: (e) => say(errMsg(e)),
    });
  };
  const onPick = (e: DiffEntry) => { setPicked(e); setDrawer({ id: e.stepId, name: e.stepName }); };

  if (caseQ.isLoading || cfgQ.isLoading) return <LoadingView />;
  if (caseQ.isError || cfgQ.isError || !caseQ.data || !cfg) return <ErrorView onRetry={() => { caseQ.refetch(); cfgQ.refetch(); }} message="This workbench could not load." />;
  const theCase = caseQ.data;
  const shownRun = run ?? wbQ.data?.exampleRun;
  const traceFor = (id: string): { t: StepTrace; v: string } | undefined => {
    const runs: [Run | undefined, string][] = mode === "compare" ? [[cmp?.runB, "Version B"], [cmp?.runA, "Version A"]] : [[shownRun, run ? "This run" : "Saved example"]];
    for (const [r, v] of runs) { const t = r?.trace.find((x) => x.stepId === id); if (t) return { t, v }; }
    return undefined;
  };
  const drawerBlock = drawer ? bBlocks.find((b) => b.id === drawer.id) ?? aBlocks.find((b) => b.id === drawer.id) : undefined;
  const dragC = [...recs, ...more].find((c) => `add:${c.capability.id}` === dragging);
  const status = STATUS_LABEL[theCase.status];
  const hl = picked ? [picked.stepId] : [];

  const flowProps = {
    editable, busy: put.isPending, dragging: !!dragging,
    onOpen: (b: FlowBlock) => setDrawer({ id: b.id, name: b.name }),
    onToggle: (b: FlowBlock, on: boolean) => toggle(b.id, b.name, on),
    onRemove: (b: FlowBlock) => toggle(b.id, b.name, false),
    onOption: (b: FlowBlock, v: string) => apply({ configValues: { [b.id]: v } }, `${b.name}: ${v}`),
  };
  const editTools = editable && (
    <div className="flex flex-wrap items-center gap-1">
      <button data-testid="button-undo" disabled={!undo.length || put.isPending} onClick={() => restore(undo[undo.length - 1])} className={btn.quiet}><Undo2 className="h-4 w-4" /> Undo</button>
      <button data-testid="button-reset-b" disabled={put.isPending || changedFromA.length === 0} onClick={resetToA} className={btn.quiet}><RotateCcw className="h-4 w-4" /> Reset B</button>
      <button data-testid="button-save" disabled={updCase.isPending} onClick={() => updCase.mutate({ caseId, data: { saved: true } }, { onSuccess: () => { invalidateCase(caseId); say("Version B saved."); }, onError: (e) => say(errMsg(e)) })} className={btn.quiet}>
        <Save className="h-4 w-4" /> {theCase.saved ? "Saved" : "Save version"}
      </button>
    </div>
  );
  const controlsLine = controls.length > 0 && (
    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground" data-testid="list-controls"><ShieldCheck className="h-4 w-4 text-ok" /> Controls in place: {controls.map((c) => c.name).join(", ")}</p>
  );

  return (
    <DndContext sensors={sensors} collisionDetection={dropUnderPointer} onDragStart={(e) => setDragging(String(e.active.id))} onDragCancel={() => setDragging(null)} onDragEnd={onDragEnd}>
      <div className="mx-auto max-w-[1400px] px-4 pb-20 pt-5 md:px-6">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              <span>Workbench</span><span>/</span><Link href={`/solutions/${baseId}`} className="hover:text-primary hover:underline">{wbQ.data?.solution.name ?? "Solution"}</Link>
              <Tag tone={status.tone} testid="status-case">{status.l}</Tag>
              {theCase.saved && <Tag tone="slate">Saved</Tag>}
            </div>
            <h1 data-testid="text-headline" className="mt-0.5 truncate text-[24px] font-bold md:text-[28px]">{theCase.title}</h1>
          </div>
          <div className="ml-auto flex rounded-xl border border-input bg-card p-1" role="tablist">
            {([["run", "Run", Play], ["edit", "Version B", PencilRuler], ["compare", "Compare A/B", GitCompare]] as const).map(([k, l, I]) => (
              <button key={k} role="tab" aria-selected={mode === k} data-testid={`tab-${k}`} onClick={() => setMode(k)}
                className={cn("inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3.5 text-[14px] font-semibold transition-colors", mode === k ? (k === "compare" ? "bg-siennaink text-white" : "bg-primary text-white") : "text-muted-foreground hover:text-primary")}>
                <I className="h-4 w-4" />{l}
              </button>
            ))}
          </div>
        </div>

        {mode !== "compare" ? (
          <div className={cn("mt-5 grid gap-4", left && right ? "lg:grid-cols-[270px_minmax(0,1fr)_380px]" : left ? "lg:grid-cols-[270px_minmax(0,1fr)_44px]" : right ? "lg:grid-cols-[44px_minmax(0,1fr)_380px]" : "lg:grid-cols-[44px_minmax(0,1fr)_44px]")}>
            {/* LEFT */}
            <aside className="card-soft h-fit p-4 lg:sticky lg:top-32" data-testid="panel-left">
              <button aria-label={left ? "Collapse inputs" : "Expand inputs"} data-testid="button-toggle-left" onClick={() => setLeft((v) => !v)} className="mb-2 hidden rounded-md p-1 text-muted-foreground hover:bg-muted lg:block">{left ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}</button>
              {(left || typeof window !== "undefined" && window.innerWidth < 1024) && <div className="space-y-6">
                {samplesQ.isLoading ? <Skel className="h-40" /> : <InputPanel samples={samples} sampleId={sampleId} text={text} edited={edited} onPick={pickSample} onText={(t) => { setText(t); setEdited(true); }} />}
                {role !== "it" && <Tray recs={recs} more={more} busy={put.isPending} enabled={mode === "edit"} onAdd={add} />}
              </div>}
            </aside>

            {/* CENTER */}
            <section className="min-w-0">
              <div className={cn("card-soft p-5", mode === "edit" && "border-sienna/40")}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-[17px] font-semibold">{mode === "edit" ? "Version B · proposed" : "Production workflow"}</h2>
                  {mode === "edit" ? <span className="text-[13px] text-muted-foreground">Drag a capability in, or click Add. Toggle optional steps. Change settings.</span>
                    : <span className="text-[13px] text-muted-foreground">{changedFromA.length ? "Showing Version B with your changes." : "Version B equals the current product until you change it."}</span>}
                  {mode === "edit" && <span className="ml-auto">{editTools}</span>}
                </div>
                {wbQ.isLoading ? <Skel className="h-28" /> : (
                  <Flow blocks={bBlocks} {...flowProps} editable={mode === "edit" && role !== "it"} dropId={mode === "edit" ? "workflow-b" : undefined} highlightIds={changedFromA.length && mode === "edit" ? changedFromA : []} testid="workflow-b" />
                )}
                {controlsLine}
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button data-testid="button-run" onClick={doRun} disabled={runOne.isPending || !sampleId && !text.trim()} className={cn(btn.primary, "min-h-14 px-9 text-[17px]")}>
                  <Play className="h-5 w-5" /> {runOne.isPending ? "Running..." : "Run"}
                </button>
                {mode === "run" && role !== "it" && <button data-testid="button-create-b" onClick={() => setMode("edit")} className={btn.secondary}><PencilRuler className="h-4 w-4" /> Create B version</button>}
                {mode === "edit" && <button data-testid="button-go-compare" onClick={() => setMode("compare")} className={btn.accent}><GitCompare className="h-4 w-4" /> Compare A/B</button>}
                {role === "it" && <span className="inline-flex items-center gap-1.5 text-[13.5px] text-muted-foreground"><Lock className="h-4 w-4" /> Governance view is read-only.</span>}
              </div>
            </section>

            {/* RIGHT */}
            <aside className="card-soft h-fit p-4 lg:sticky lg:top-32" data-testid="panel-output">
              <button aria-label={right ? "Collapse output" : "Expand output"} data-testid="button-toggle-right" onClick={() => setRight((v) => !v)} className="mb-2 hidden rounded-md p-1 text-muted-foreground hover:bg-muted lg:block">{right ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}</button>
              {(right || typeof window !== "undefined" && window.innerWidth < 1024) && (
                runOne.isPending ? <div className="space-y-2"><Skel className="h-5 w-2/3" /><Skel className="h-24" /><Skel className="h-24" /></div> :
                shownRun ? <div className="reveal" key={shownRun.id}>
                  <div className="mb-2 flex flex-wrap items-center gap-2"><span className="eyebrow">{run ? `Output · ${run.versionLabel}` : "Saved example output"}</span></div>
                  <RunMeta run={shownRun} />
                  <div className="mt-3 max-h-[70vh] overflow-y-auto pr-1"><OutputView output={shownRun.output} testid="output-single" /></div>
                </div> : <p className="text-[14px] text-muted-foreground">Press Run to see the output.</p>
              )}
            </aside>
          </div>
        ) : (
          /* COMPARE */
          <div className="mt-5 space-y-5">
            <section className="card-soft p-4" data-testid="panel-shared-input">
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1"><InputPanel compact samples={samples} sampleId={sampleId} text={text} edited={edited} onPick={pickSample} onText={(t) => { setText(t); setEdited(true); }} /></div>
                <div className="flex flex-col items-end gap-2">
                  <button data-testid="button-run-both" onClick={doBoth} disabled={runBoth.isPending} className={cn(btn.accent, "min-h-14 px-8 text-[17px]")}><Play className="h-5 w-5" /> {runBoth.isPending ? "Running both..." : "Run both"}</button>
                  <span className="text-[12px] text-muted-foreground">Same input through A and B.</span>
                </div>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="card-soft p-4" data-testid="panel-version-a">
                <div className="mb-2 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-[13px] font-bold text-white">A</span><span className="font-semibold">Current product</span><span className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground"><Lock className="h-3.5 w-3.5" /> Locked baseline</span></div>
                {wbQ.isLoading ? <Skel className="h-24" /> : <Flow dense blocks={aBlocks} onOpen={(b) => setDrawer({ id: b.id, name: b.name })} highlightIds={picked?.change === "removed" ? hl : []} testid="workflow-a" />}
              </div>
              <div className="card-soft border-sienna/40 p-4" data-testid="panel-version-b">
                <div className="mb-2 flex flex-wrap items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-md bg-siennaink text-[13px] font-bold text-white">B</span><span className="font-semibold">Proposed version</span><span className="ml-auto">{editTools}</span></div>
                <Flow dense blocks={bBlocks} {...flowProps} dropId={editable ? "workflow-b" : undefined} highlightIds={hl.length ? hl : changedFromA} testid="workflow-b" />
                {role !== "it" && (recs.length > 0 || more.length > 0) && <div className="mt-3 border-t border-border pt-3"><Tray recs={recs} more={more} busy={put.isPending} enabled={editable} onAdd={add} /></div>}
              </div>
            </section>
            {controlsLine}

            {cmp?.staleB && <StaleHint onRun={doBoth} busy={runBoth.isPending} />}
            {runBoth.isPending ? <div className="grid gap-4 lg:grid-cols-2"><Skel className="h-72" /><Skel className="h-72" /></div> :
              !cmp ? (
                <div className="rounded-2xl border border-dashed border-input bg-card/60 p-10 text-center" data-testid="state-no-comparison">
                  <div className="text-[17px] font-semibold text-primary">No comparison yet</div>
                  <p className="mt-1 text-[14.5px] text-muted-foreground">Add a capability to Version B, then press Run both to see both outputs side by side.</p>
                </div>
              ) : (
                <>
                  <div className="text-[13px] text-muted-foreground" data-testid="text-compared-input">Ran on: {samples.find((s) => s.id === cmp.sampleInputId)?.name ?? "edited text"} · {new Date(cmp.runB.createdAt).toLocaleTimeString()}</div>
                  <CompareOutputs cmp={cmp} picked={picked} onPick={onPick} />
                  <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
                    <DiffSummary cmp={cmp} picked={picked} onPick={onPick} />
                    <Measures cmp={cmp} />
                  </div>
                  <Vote cmp={cmp} role={role} />
                  <div className="flex flex-wrap items-center gap-3">
                    <button data-testid="button-try-another" onClick={tryAnother} disabled={runBoth.isPending || samples.length < 2} className={btn.secondary}><RotateCcw className="h-4 w-4" /> Try another input</button>
                    <InviteTesters caseId={caseId} />
                    <span className="flex-1" />
                    {role !== "it" && <PilotButton caseId={caseId} status={theCase.status} pilotPercent={theCase.pilotPercent} />}
                  </div>
                </>
              )}
            {role === "owner" && (
              <section className="card-soft p-5" data-testid="panel-owner">
                <h3 className="mb-2 text-[17px] font-semibold">Owner decision</h3>
                <OwnerDecision caseId={caseId} />
              </section>
            )}
          </div>
        )}
      </div>

      <DragOverlay dropAnimation={null}>{dragC && <div className="lift w-[220px] rotate-[-2deg] rounded-xl border-2 border-sienna bg-card p-3 text-[14px] font-semibold text-primary">{dragC.capability.name}</div>}</DragOverlay>

      <Drawer open={!!drawer} onClose={() => { setDrawer(null); }} title={drawer?.name ?? ""} sub={drawerBlock?.description} testid="drawer-step">
        {drawerBlock && <DSection label="Step type">{drawerBlock.kind === "required" ? "Required. Cannot be switched off." : drawerBlock.kind === "configurable" ? `Configurable. Setting: ${drawerBlock.value ?? "default"}` : `Optional. Currently ${drawerBlock.active ? "on" : "off"}.`}{drawerBlock.added && <> Added from <span className="font-semibold">{drawerBlock.source}</span>.</>}</DSection>}
        {picked && picked.stepId === drawer?.id && <DSection label="The change you clicked">
          <div className="rounded-lg bg-accent/60 p-3 text-[13.5px]">{picked.before && <div className="text-muted-foreground line-through">{picked.before}</div>}{picked.after && <div>{picked.after}</div>}<div className="mt-1 text-[12px] text-muted-foreground">{picked.change} by {picked.stepName}, from {picked.sourceSolutionName}</div></div>
        </DSection>}
        {(() => { const tr = drawer ? traceFor(drawer.id) : undefined; return tr ? <>
          <div className="eyebrow">{tr.v} trace</div>
          <DSection label="Input received">{tr.t.inputSummary}</DSection>
          <DSection label="Transformation performed">{tr.t.transformation}</DSection>
          <DSection label="Output produced">{tr.t.outputSummary}</DSection>
          <div className="flex gap-2 text-[13px] text-muted-foreground"><Tag>{tr.t.status}</Tag><span>{tr.t.itemCount} items · {tr.t.durationMs} ms</span></div>
          {tr.t.error && <p className="text-bad">{tr.t.error}</p>}
        </> : <p className="text-[14px] text-muted-foreground">Run the workflow to see what this step received and produced.</p>; })()}
      </Drawer>
    </DndContext>
  );
}
