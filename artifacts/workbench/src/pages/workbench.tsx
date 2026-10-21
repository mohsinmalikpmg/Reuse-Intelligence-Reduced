import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearch } from "wouter";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Equal, FileText, Info, Lock, Play, RotateCcw, Save, Undo2 } from "lucide-react";
import {
  getGetCaseComparisonQueryKey, getGetCaseConfigurationQueryKey, getGetCaseQueryKey, getGetSolutionWorkbenchQueryKey, getListCaseEvaluationsQueryKey, getListSampleInputsQueryKey,
  useGetCase, useGetCaseComparison, useGetCaseConfiguration, useGetSolutionWorkbench, useListCaseEvaluations, useListSampleInputs, useRunCaseComparison, useRunWorkflow, useUpdateCase, useUpdateCaseConfiguration,
  type ABComparison, type ComponentConfig, type Configuration, type ConfigurationUpdate, type DiffEntry, type Run, type SampleInput,
} from "@workspace/api-client-react";
import { ErrorView, LoadingView, Skel, Tag, btn, useUndoToast } from "@/components/bits";
import { blocksFromConfig, blocksFromWorkbench, controlsFromConfig } from "@/components/flow";
import { OutputView, RunMeta } from "@/components/output-view";
import { InputPanel, SummaryCounts, Tray } from "@/components/wb-parts";
import { Measures, StaleHint, Vote } from "@/components/wb-compare";
import { AddSlot, BandRow, LaneHeaders, StepRow, WorkflowMap, buildRows, laneGrid, useNarrow, type MapEntry } from "@/components/wb-lanes";
import { InviteTesters, OwnerDecision, PilotButton, STATUS_LABEL } from "@/components/wb-pilot";
import { errMsg, useInvalidateCase } from "@/lib/case";
import { useRole } from "@/lib/persona";
import { cn } from "@/lib/utils";

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

function LanesDrop({ enabled, dragging, children }: { enabled: boolean; dragging: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "workflow-b", disabled: !enabled });
  return <div ref={setNodeRef} data-testid="workflow-b" className={cn("rounded-2xl transition-[background-color,box-shadow]", dragging && "bg-accent/30 shadow-[inset_0_0_0_2px_hsl(var(--sienna)/.4)]", dragging && isOver && "bg-accent/50")}>{children}</div>;
}

function scrollToRow(id: string) {
  document.getElementById(`row-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function Workbench() {
  const { caseId } = useParams<{ caseId: string }>();
  const initialMode = new URLSearchParams(useSearch()).get("mode");
  const role = useRole();
  const qc = useQueryClient();
  const say = useUndoToast();
  const invalidateCase = useInvalidateCase();
  const narrow = useNarrow();
  const coarsePointer = useNarrow("(hover: none)");
  const caseQ = useGetCase(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseQueryKey(caseId) } });
  const baseId = caseQ.data?.baseSolutionId ?? "";
  const cfgQ = useGetCaseConfiguration(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseConfigurationQueryKey(caseId) } });
  const wbQ = useGetSolutionWorkbench(baseId, { query: { enabled: !!baseId, queryKey: getGetSolutionWorkbenchQueryKey(baseId) } });
  const samplesQ = useListSampleInputs({ solutionId: baseId }, { query: { enabled: !!baseId, queryKey: getListSampleInputsQueryKey({ solutionId: baseId }) } });
  const cmpQ = useGetCaseComparison(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseComparisonQueryKey(caseId) } });
  const evalsQ = useListCaseEvaluations(caseId, { query: { enabled: !!caseId, queryKey: getListCaseEvaluationsQueryKey(caseId) } });
  const put = useUpdateCaseConfiguration();
  const runOne = useRunWorkflow();
  const runBoth = useRunCaseComparison();
  const updCase = useUpdateCase();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const [sampleId, setSampleId] = useState("");
  const [text, setText] = useState("");
  const [edited, setEdited] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [undo, setUndo] = useState<Snap[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [picked, setPicked] = useState<DiffEntry | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [current, setCurrent] = useState<string | null>(null);
  const [slotOpen, setSlotOpen] = useState<string | null>(null);
  const [showA, setShowA] = useState(false);
  const jumpedRef = useRef(false);

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
  const editable = role !== "it";
  const inputArgs = edited ? { inputText: text } : { sampleInputId: sampleId };
  const changedFromA = useMemo(() => {
    const a = new Map(aBlocks.map((b) => [b.id, b]));
    // Version A only lists the steps that run in production, so a step missing from A counts as inactive there.
    return bBlocks.filter((b) => { const x = a.get(b.id); return x ? x.active !== b.active || x.value !== b.value : b.active; }).map((b) => b.id);
  }, [aBlocks, bBlocks]);
  const rows = useMemo(() => buildRows(aBlocks, bBlocks, cmp, cmp?.runA ?? wbQ.data?.exampleRun, cmp?.runB ?? run ?? undefined), [aBlocks, bBlocks, cmp, wbQ.data, run]);
  const votes = evalsQ.data?.summary.tests ?? 0;
  const entries = useMemo<MapEntry[]>(() => [{ id: "input", label: "Input" }, ...rows.map((r) => ({ id: r.id, label: r.name, row: r })), { id: "output", label: "Output" }, { id: "verdict", label: "Verdict", votes }], [rows, votes]);

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
    toggle(c.capability.id, c.capability.name, true);
    setOpen((o) => new Set(o).add(c.capability.id));
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
    const over = e.over ? String(e.over.id) : "";
    if (over !== "workflow-b" && !over.startsWith("slot:")) return;
    const c = [...recs, ...more].find((x) => x.capability.id === id);
    if (c) add(c);
  };

  const afterBoth = (r: ABComparison, msg?: string) => {
    qc.setQueryData<ABComparison[]>(getGetCaseComparisonQueryKey(caseId), (old) => [r, ...(old ?? [])]);
    setPicked(null); invalidateCase(caseId);
    if (msg) say(msg);
    window.setTimeout(() => scrollToRow("output"), 50);
  };
  const doRun = () => runOne.mutate({ data: { caseId, version: "B", ...inputArgs } }, { onSuccess: (r) => { setRun(r); invalidateCase(caseId); window.setTimeout(() => scrollToRow("output"), 50); }, onError: (e) => say(errMsg(e)) });
  const doBoth = () => runBoth.mutate({ caseId, data: inputArgs }, { onSuccess: (r) => afterBoth(r), onError: (e) => say(errMsg(e)) });
  const pickSample = (s: SampleInput) => { setSampleId(s.id); setText(s.text); setEdited(false); };
  const tryAnother = () => {
    const i = samples.findIndex((s) => s.id === sampleId);
    const next = samples[(i + 1) % samples.length];
    if (!next) return;
    pickSample(next);
    runBoth.mutate({ caseId, data: { sampleInputId: next.id } }, { onSuccess: (r) => afterBoth(r, `Ran both on "${next.name}".`), onError: (e) => say(errMsg(e)) });
  };

  const toggleRow = useCallback((id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const jump = (id: string) => {
    if (id === "input") { setInputOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); setCurrent("input"); return; }
    if (rows.some((r) => r.id === id)) setOpen((o) => new Set(o).add(id));
    scrollToRow(id);
  };
  const onPick = (e: DiffEntry) => { setPicked(e); setOpen((o) => new Set(o).add(e.stepId)); scrollToRow(e.stepId); };

  // Scroll-spy: the map highlights the row nearest the top of the viewport.
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const line = 200;
      let best: string | null = "input";
      for (const e of entries) {
        if (e.id === "input") continue;
        const el = document.getElementById(`row-${e.id}`);
        if (el && el.getBoundingClientRect().top <= line) best = e.id;
      }
      setCurrent(best);
    };
    const onScroll = () => { if (!raf) raf = window.requestAnimationFrame(measure); };
    window.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => { window.removeEventListener("scroll", onScroll); if (raf) window.cancelAnimationFrame(raf); };
  }, [entries]);

  useEffect(() => {
    if (jumpedRef.current || rows.length === 0 || cmpQ.isLoading) return;
    jumpedRef.current = true;
    if (initialMode === "compare") window.setTimeout(() => scrollToRow(cmp ? "output" : "verdict"), 80);
  }, [rows.length, cmpQ.isLoading, initialMode, cmp]);

  if (caseQ.isLoading || cfgQ.isLoading) return <LoadingView />;
  if (caseQ.isError || cfgQ.isError || !caseQ.data || !cfg) return <ErrorView onRetry={() => { caseQ.refetch(); cfgQ.refetch(); }} message="This workbench could not load." />;
  const theCase = caseQ.data;
  const dragC = [...recs, ...more].find((c) => `add:${c.capability.id}` === dragging);
  const status = STATUS_LABEL[theCase.status];
  const sample = samples.find((s) => s.id === sampleId);
  const needsBoth = changedFromA.length > 0 || !!cmp?.staleB;
  const fresh = !!cmp && !cmp.staleB;
  const busyRun = runOne.isPending || runBoth.isPending;
  const noInput = !sampleId && !text.trim();
  const stepsResponsible = cmp?.diff.stepsResponsible ?? [];

  const stateText = runBoth.isPending ? "Running both..." : runOne.isPending ? "Running..."
    : cmp?.staleB ? "Version B changed since the last run" : fresh ? `Compared on "${samples.find((s) => s.id === cmp.sampleInputId)?.name ?? "edited text"}" · ${new Date(cmp.runB.createdAt).toLocaleTimeString()}`
    : changedFromA.length ? "B differs from A · not compared yet" : "Version B equals the current product";
  const primary = !cmp && !needsBoth
    ? <button data-testid="button-run" onClick={doRun} disabled={busyRun || noInput} className={cn(btn.primary, "min-h-12 px-7")}><Play className="h-5 w-5" /> {runOne.isPending ? "Running..." : "Run"}</button>
    : <button data-testid="button-run-both" onClick={doBoth} disabled={busyRun || noInput} className={cn(fresh ? btn.secondary : btn.accent, "min-h-12 px-7")}><Play className="h-5 w-5" /> {runBoth.isPending ? "Running both..." : cmp ? "Run both again" : "Run both"}</button>;

  const editTools = editable && (
    <div className="flex flex-wrap items-center gap-1">
      <button data-testid="button-undo" disabled={!undo.length || put.isPending} onClick={() => restore(undo[undo.length - 1])} className={btn.quiet}><Undo2 className="h-4 w-4" /> Undo</button>
      <button data-testid="button-reset-b" disabled={put.isPending || changedFromA.length === 0} onClick={resetToA} className={btn.quiet}><RotateCcw className="h-4 w-4" /> Reset B</button>
    </div>
  );
  const labelA = cmp ? "A · comparison run" : "A · saved example";
  const labelB = cmp ? "B · comparison run" : "B · your run";
  const slotFor = (afterId: string | null, afterName: string | null, visible: boolean) => (
    <AddSlot id={afterId ?? "end"} afterName={afterName} dragging={!!dragging} enabled={editable} recs={recs} more={more} busy={put.isPending} onAdd={add} openId={slotOpen} setOpenId={setSlotOpen} visible={visible} />
  );
  const outputCard = (v: "A" | "B", r: Run, marks?: Map<string, DiffEntry>) => (
    <div className={cn("card-soft p-4", v === "B" && "border-t-4 border-t-sienna")} data-testid={`panel-version-${v.toLowerCase()}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={cn("grid h-7 w-7 place-items-center rounded-md text-[13px] font-bold text-white", v === "A" ? "bg-primary" : "bg-siennaink")}>{v}</span>
        <span className="text-[14px] font-semibold">{v === "A" ? "Current product" : "Proposed version"}</span>
        <span className="ml-auto"><RunMeta run={r} testid={`run-meta-${v}`} /></span>
      </div>
      <OutputView output={r.output} marks={marks} selectedKey={picked?.itemKey} onPick={marks ? onPick : undefined} testid={`output-${v.toLowerCase()}`} dim={v === "B" && !!cmp?.staleB} />
    </div>
  );

  return (
    <DndContext sensors={sensors} collisionDetection={dropUnderPointer} onDragStart={(e) => setDragging(String(e.active.id))} onDragCancel={() => setDragging(null)} onDragEnd={onDragEnd}>
      <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-5 md:px-6">
        {/* Title */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              <span>Workbench</span><span>/</span><Link href={`/solutions/${baseId}`} className="hover:text-primary hover:underline">{wbQ.data?.solution.name ?? "Solution"}</Link>
              <Tag tone={status.tone} testid="status-case">{status.l}</Tag>
              {theCase.saved && <Tag tone="slate">Saved</Tag>}
            </div>
            <h1 data-testid="text-headline" className="mt-0.5 truncate text-[24px] font-bold md:text-[28px]">{theCase.title}</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {role === "it" && <span className="inline-flex items-center gap-1.5 text-[13.5px] text-muted-foreground"><Lock className="h-4 w-4" /> Governance view is read-only.</span>}
            {editable && <button data-testid="button-save" disabled={updCase.isPending} onClick={() => updCase.mutate({ caseId, data: { saved: true } }, { onSuccess: () => { invalidateCase(caseId); say("Version B saved."); }, onError: (e) => say(errMsg(e)) })} className={btn.quiet}>
              <Save className="h-4 w-4" /> {theCase.saved ? "Saved" : "Save version"}
            </button>}
          </div>
        </div>

        {/* Pinned input bar */}
        <div id="row-input" className="sticky top-[101px] z-30 mt-4 -mx-1 px-1 pb-2 pt-1 bg-background/95 backdrop-blur-sm">
          <section className="card-soft flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5" data-testid="panel-shared-input">
            <FileText className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-primary" data-testid="text-input-name">{edited ? "Edited text" : sample?.name ?? "Input"}{edited && <Tag tone="sienna">Edited</Tag>}</div>
              <div className="text-[12px] text-muted-foreground">{sample && !edited ? `${sample.noteCount} note${sample.noteCount === 1 ? "" : "s"}${sample.hasExpected ? " · labelled findings" : ""} · ` : ""}shared by A and B</div>
            </div>
            <button data-testid="button-change-input" aria-expanded={inputOpen} onClick={() => setInputOpen((v) => !v)} className={cn(btn.quiet, "px-2")}><ChevronDown className={cn("h-4 w-4 transition-transform", inputOpen && "rotate-180")} /> {inputOpen ? "Hide input" : "Change input"}</button>
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-[12.5px] text-muted-foreground md:block" data-testid="text-compared-input">{stateText}</span>
              {primary}
            </div>
          </section>
        </div>
        {inputOpen && (
          <section className="card-soft reveal mt-1 p-4">
            {samplesQ.isLoading ? <Skel className="h-24" /> : <InputPanel compact samples={samples} sampleId={sampleId} text={text} edited={edited} onPick={pickSample} onText={(t) => { setText(t); setEdited(true); }} />}
          </section>
        )}
        {cmp?.staleB && <div className="mt-3"><StaleHint onRun={doBoth} busy={runBoth.isPending} /></div>}

        {/* Map + lanes */}
        <div className={cn("mt-5", narrow ? "space-y-4" : "grid grid-cols-[224px_minmax(0,1fr)] items-start gap-6")}>
          <div className={narrow ? "" : "sticky top-[12rem] max-h-[calc(100dvh-13rem)] overflow-y-auto pr-1"}>
            <WorkflowMap entries={entries} current={current} open={open} onJump={jump} horizontal={narrow}
              onExpandAll={() => setOpen(new Set(rows.map((r) => r.id)))} onCollapseAll={() => setOpen(new Set())}>
              {!narrow && editable && <div className="mt-4 border-t border-border px-2 pt-3"><Tray recs={recs} more={more} busy={put.isPending} enabled={editable} onAdd={add} /></div>}
            </WorkflowMap>
          </div>

          <div className="min-w-0">
            <LaneHeaders editTools={editTools} narrow={narrow} showA={showA} setShowA={setShowA} controls={controls.map((c) => c.name)} />
            <LanesDrop enabled={editable} dragging={!!dragging}>
              {wbQ.isLoading || rows.length === 0 ? <div className={narrow ? "space-y-2" : laneGrid}><Skel className="h-14" /><div /><Skel className="h-14" /></div> : rows.map((r, i) => (
                <StepRow key={r.id} r={r} no={i + 1} open={open.has(r.id)} onToggle={() => toggleRow(r.id)} editable={editable} busy={put.isPending}
                  onSetOption={(v) => apply({ configValues: { [r.id]: v } }, `${r.name}: ${v}`)} onSwitch={(on) => toggle(r.id, r.name, on)} onRemove={() => toggle(r.id, r.name, false)}
                  picked={picked} onPick={onPick} explanation={(cmp?.explanation ?? []).filter((x) => x.startsWith(r.name))} labelA={labelA} labelB={labelB}
                  narrow={narrow} showA={showA} dragging={!!dragging} slot={slotFor(r.id, r.name, narrow || coarsePointer || i === rows.length - 1)} />
              ))}
            </LanesDrop>

            {/* Output */}
            <BandRow id="output" label="Output" icon={<Equal className="h-3.5 w-3.5" />} narrow={narrow}>
              {runBoth.isPending || runOne.isPending ? (
                <div className={narrow ? "space-y-3" : laneGrid}><Skel className="h-56" /><div /><Skel className="h-56" /></div>
              ) : cmp ? (
                <>
                  <div className={narrow ? "space-y-3" : laneGrid}>
                    {outputCard("A", cmp.runA, new Map(cmp.diff.entries.map((e) => [e.itemKey, e])))}
                    {!narrow && <div />}
                    {outputCard("B", cmp.runB, new Map(cmp.diff.entries.map((e) => [e.itemKey, e])))}
                  </div>
                  <div className="card-soft mt-3 p-4" data-testid="panel-diff">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[16px] font-semibold">What changed</h3>
                      {cmp.diff.entries.length === 0 ? <span data-testid="text-no-diff" className="text-[14px]">Both versions produced the same output for this input.</span> : <>
                        <Tag tone="green">{cmp.diff.added} new</Tag><Tag>{cmp.diff.removed} removed</Tag><Tag tone="sienna">{cmp.diff.changed} changed</Tag>
                        <span className="text-[12.5px] text-muted-foreground">{cmp.diff.unchanged} unchanged · click a highlighted line to open the step that caused it</span>
                      </>}
                    </div>
                    {cmp.explanation.length > 0 && <ul className="mt-2 space-y-1 text-[14px]" data-testid="list-explanation">{cmp.explanation.map((x, i) => <li key={i} className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-skyink" />{x}</li>)}</ul>}
                    {stepsResponsible.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px]">
                        <span className="text-muted-foreground">Steps responsible:</span>
                        {stepsResponsible.map((s) => <button key={s.stepId} data-testid={`button-responsible-${s.stepId}`} onClick={() => jump(s.stepId)} className="inline-flex min-h-8 items-center gap-1 rounded-md border border-input bg-card px-2 font-medium text-primary hover:border-primary/50">{s.name} <span className="rounded bg-accent px-1 text-[11.5px] font-semibold text-siennaink">{s.changes}</span></button>)}
                      </div>
                    )}
                  </div>
                  <div className="mt-3"><Measures cmp={cmp} /></div>
                </>
              ) : run ? (
                <div className={narrow ? "space-y-3" : laneGrid}>
                  {!narrow || showA ? <div className="rounded-[14px] border border-dashed border-input bg-card/60 p-5 text-[14px] text-muted-foreground" data-testid="panel-version-a">
                    {changedFromA.length === 0 ? "Version B equals the current product, so this output is the same for A." : "Run both to see the current product's output beside Version B."}
                  </div> : null}
                  {!narrow && <div />}
                  {outputCard("B", run)}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-input bg-card/60 p-8 text-center" data-testid="state-no-comparison">
                  <div className="text-[16px] font-semibold text-primary">{needsBoth ? "Run both to see A and B side by side" : "Press Run to see the output"}</div>
                  <p className="mt-1 text-[14px] text-muted-foreground">{needsBoth ? "Version B differs from the current product. The same input goes through both." : "Add a step to Version B, or run the current product as it is."}</p>
                </div>
              )}
            </BandRow>

            {/* Verdict */}
            <BandRow id="verdict" label="Verdict" icon={<Check className="h-3.5 w-3.5" />} narrow={narrow} dim={!cmp}>
              {cmp ? (
                <>
                  {role === "it" ? (
                    <section className="card-soft p-6" data-testid="panel-vote-readonly">
                      <h3 className="text-[20px] font-semibold">Recorded preferences</h3>
                      {evalsQ.data && evalsQ.data.summary.tests > 0 ? <div className="mt-4"><SummaryCounts s={evalsQ.data.summary} /></div> : <p className="mt-2 text-[14px] text-muted-foreground">No votes recorded yet for this case.</p>}
                    </section>
                  ) : <>
                    <Vote cmp={cmp} role={role} />
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button data-testid="button-try-another" onClick={tryAnother} disabled={runBoth.isPending || samples.length < 2} className={btn.quiet}><RotateCcw className="h-4 w-4" /> Try another input</button>
                      <InviteTesters caseId={caseId} />
                      <span className="flex-1" />
                      <PilotButton caseId={caseId} status={theCase.status} pilotPercent={theCase.pilotPercent} quiet={!cmp.evaluation} />
                    </div>
                  </>}
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-input bg-card/60 p-6 text-center" data-testid="state-no-verdict">
                  <div className="text-[15px] font-semibold text-primary">Which result better solves the problem?</div>
                  <p className="mt-1 text-[14px] text-muted-foreground">Run both first. Your preference is recorded only against a real comparison.</p>
                </div>
              )}
              {role === "owner" && (
                <section className="card-soft mt-4 p-5" data-testid="panel-owner">
                  <h3 className="mb-2 text-[17px] font-semibold">Owner decision</h3>
                  <OwnerDecision caseId={caseId} />
                </section>
              )}
              {role === "it" && <p className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] text-muted-foreground"><Lock className="h-4 w-4" /> Governance view is read-only: you can inspect every step and result, but not change Version B or vote.</p>}
            </BandRow>
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>{dragC && <div className="lift w-[220px] rotate-[-2deg] rounded-xl border-2 border-sienna bg-card p-3 text-[14px] font-semibold text-primary">{dragC.capability.name}</div>}</DragOverlay>
    </DndContext>
  );
}
