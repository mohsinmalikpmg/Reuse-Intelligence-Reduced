import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Equal, FileText, GitBranch, Info, ListPlus, Minus, Pencil, Play, Plus, RotateCcw, Save, Undo2, Workflow, Zap } from "lucide-react";
import {
  useGetDemoState, useListSolutions, getListSolutionsQueryKey,
  getGetBriefQueryKey, getGetCaseComparisonQueryKey, getGetCaseConfigurationQueryKey, getGetCaseQueryKey, getGetCaseBaselineQueryKey, getListCaseEvaluationsQueryKey, getListSampleInputsQueryKey,
  getSimilarExperiments, useAddCapabilityRequest, useGetBrief, useGetCase, useGetCaseComparison, useGetCaseBaseline, useGetCaseConfiguration, useListCaseEvaluations, useListSampleInputs, useRemoveCapabilityRequest, useRemoveCaseRequirement,
  getGetRunQueryKey, useGetRun, useRunCaseComparison, useRunWorkflow, useUpdateCase, useUpdateCaseConfiguration,
  type ABComparison, type CapabilityRequest, type Case, type CaseRequirementResult, type ComponentConfig, type Configuration, type ConfigurationUpdate, type DiffEntry, type Run, type SampleInput, type SimilarExperiments,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimilarPrompt } from "@/components/wb-similar";
import { ErrorView, LoadingView, Page, Skel, Tag, btn, useUndoToast, StageEyebrow } from "@/components/bits";
import { blocksFromConfig, blocksFromWorkbench, controlsFromConfig } from "@/components/flow";
import { OutputView, RunMeta, diffKey, marksFrom } from "@/components/output-view";
import { InputPanel, SummaryCounts, Tray } from "@/components/wb-parts";
import { Measures, StaleHint, Vote } from "@/components/wb-compare";
import { AddSlot, BandRow, buildRows, laneGrid, useNarrow } from "@/components/wb-lanes";
import { RequirementAdder, StepPicker, type ReuseActions } from "@/components/wb-reuse";
import { StepDetail, type LaneEntry } from "@/components/wb-schematic";
import { InviteTesters, OwnerDecision, PROMOTION_LABEL, ProposeActions, caseStatusLabel, lineageChanges } from "@/components/wb-pilot";
import { errMsg, httpStatus, useInvalidateCase } from "@/lib/case";
import { useRole } from "@/lib/persona";
import { ProposalMap, proposalNodes } from "@/components/wb-proposal";
import { cn } from "@/lib/utils";
import { CaseExports } from "@/components/solution-exports";
import { WiringEntry } from "@/components/wiring-entry";
import { LinkedComposition } from "@/components/composition-panel";
import { FeatureRedundancy } from "@/components/feature-redundancy";
import { InputUpload } from "@/components/input-upload";
import { addBackState, sectionPresence } from "@/lib/ab-output";
import { outputRanked, summarize } from "@/lib/step-output";
import { useCaseComposition, useRefreshCaseComposition } from "@/lib/composition";

type Snap = { moduleStates: Record<string, boolean>; configValues: Record<string, string> };
const darkTool = "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-[#9ED9E3] transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40";
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
  return <div ref={setNodeRef} data-testid="workflow-b" className={cn("rounded-2xl transition-[background-color,box-shadow]", dragging && "bg-[hsl(187_70%_65%/.08)] shadow-[inset_0_0_0_2px_hsl(var(--cyan)/.5)]", dragging && isOver && "bg-[hsl(187_70%_65%/.14)]")}>{children}</div>;
}

function scrollToRow(id: string, retry = true) {
  // The schematic only mounts a step's detail once it is open; fall back to its block, or try once more next frame.
  const el = document.getElementById(`row-${id}`) ?? document.getElementById(`blk-${id}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  else if (retry) window.requestAnimationFrame(() => scrollToRow(id, false));
}

/** The experiment at this address no longer exists: forget it and open the demo experiment instead. */
function GoneView({ caseId }: { caseId: string }) {
  const demo = useGetDemoState();
  const [, setLocation] = useLocation();
  const target = demo.data?.demoCaseId && demo.data.demoCaseId !== caseId ? demo.data.demoCaseId : null;
  // Navigating is enough: the shell remembers whichever experiment the address bar shows.
  useEffect(() => {
    if (!target) return;
    const t = window.setTimeout(() => setLocation(`/workbench/${target}`, { replace: true }), 1200);
    return () => window.clearTimeout(t);
  }, [target, caseId, setLocation]);
  return (
    <Page>
      <div className="card-soft max-w-xl p-7" data-testid="state-case-gone">
        <StageEyebrow stage="connect" />
        <h1 className="mt-3 text-[26px]">That experiment is no longer here.</h1>
        <p className="mt-2 text-[15px] text-skyink">It was removed, most likely by a demo reset. {target ? "Opening the demo experiment instead." : "Start again from the library."}</p>
        <div className="mt-5 flex gap-2">
          {target && <Link href={`/workbench/${target}`} className={btn.primary} data-testid="link-demo-case">Open the demo experiment</Link>}
          <Link href="/library" className={btn.secondary} data-testid="link-library">Library</Link>
        </div>
      </div>
    </Page>
  );
}

export default function Workbench() {
  const { caseId } = useParams<{ caseId: string }>();
  const search = new URLSearchParams(useSearch());
  const initialMode = search.get("mode");
  const proposalView = search.get("view") === "proposal";
  const [, navigate] = useLocation();
  const role = useRole();
  const qc = useQueryClient();
  const say = useUndoToast();
  const invalidateCase = useInvalidateCase();
  const narrow = useNarrow();
  const caseQ = useGetCase(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseQueryKey(caseId) } });
  const baseId = caseQ.data?.baseSolutionId ?? "";
  const cfgQ = useGetCaseConfiguration(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseConfigurationQueryKey(caseId) } });
  // Version A is the parent as of the branch point, not the live product; the server resolves that per case.
  const wbQ = useGetCaseBaseline(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseBaselineQueryKey(caseId) } });
  const samplesQ = useListSampleInputs({ solutionId: baseId }, { query: { enabled: !!baseId, queryKey: getListSampleInputsQueryKey({ solutionId: baseId }) } });
  const cmpQ = useGetCaseComparison(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseComparisonQueryKey(caseId) } });
  const evalsQ = useListCaseEvaluations(caseId, { query: { enabled: !!caseId, queryKey: getListCaseEvaluationsQueryKey(caseId) } });
  // The remembered experiment can stop existing (a demo reset removes everything but the demo case). Say so and move on.
  const gone = (caseQ.isError && httpStatus(caseQ.error) === 404) || (cfgQ.isError && httpStatus(cfgQ.error) === 404);
  const put = useUpdateCaseConfiguration();
  const runOne = useRunWorkflow();
  const runBoth = useRunCaseComparison();
  const updCase = useUpdateCase();
  const addRequest = useAddCapabilityRequest();
  const removeRequest = useRemoveCapabilityRequest();
  const removeRequirement = useRemoveCaseRequirement();
  const briefQ = useGetBrief(caseQ.data?.briefId ?? "", { query: { enabled: !!caseQ.data?.briefId, queryKey: getGetBriefQueryKey(caseQ.data?.briefId ?? "") } });
  const compQ = useCaseComposition(caseId);
  const refreshComp = useRefreshCaseComposition();
  const solsQ = useListSolutions(undefined, { query: { queryKey: getListSolutionsQueryKey() } });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const [sampleId, setSampleId] = useState("");
  const [text, setText] = useState("");
  const [edited, setEdited] = useState(false);
  const [localRun, setLocalRun] = useState<Run | null>(null);
  // A single B run is persisted; its id lives in the address so a reload rehydrates the real run.
  const runParam = search.get("run") ?? "";
  const runQ = useGetRun(runParam, { query: { enabled: !!runParam && localRun?.id !== runParam, queryKey: getGetRunQueryKey(runParam) } });
  const fetchedRun = runQ.data && runQ.data.caseId === caseId && runQ.data.version === "B" ? runQ.data : null;
  const run = localRun?.caseId === caseId && (!runParam || localRun.id === runParam) ? localRun : fetchedRun;
  const setRun = (r: Run) => {
    setLocalRun(r);
    const q = new URLSearchParams(window.location.search); q.delete("view"); q.set("run", r.id);
    navigate(`/workbench/${caseId}?${q.toString()}`, { replace: true });
  };
  const [undo, setUndo] = useState<Snap[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [picked, setPicked] = useState<DiffEntry | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [slotOpen, setSlotOpen] = useState<string | null>(null);
  // Set only from a confirmed server response; cleared after the short seat/weld (or run-illumination) moment.
  const [welded, setWelded] = useState<string | null>(null);
  const [energized, setEnergized] = useState<Set<string>>(() => new Set());
  // The footer status line: set only from the configuration the server returned.
  const [connected, setConnected] = useState<string | null>(null);
  const [reqOpen, setReqOpen] = useState(false);
  const [similar, setSimilar] = useState<SimilarExperiments | null>(null);
  const [intentOpen, setIntentOpen] = useState(false);
  const [intentDraft, setIntentDraft] = useState("");
  const jumpedRef = useRef(false);

  const samples = samplesQ.data ?? wbQ.data?.sampleInputs ?? [];
  const hydratedRun = useRef<string | null>(null);
  useEffect(() => {
    if (!fetchedRun || hydratedRun.current === fetchedRun.id) return;
    hydratedRun.current = fetchedRun.id;
    setSampleId(fetchedRun.sampleInputId ?? "");
    setText(fetchedRun.inputText);
    setEdited(true);
  }, [fetchedRun]);
  useEffect(() => {
    if (runParam || sampleId || !samples.length) return;
    const pref = wbQ.data?.exampleRun.sampleInputId;
    const s = samples.find((x) => x.id === pref) ?? samples[0];
    setSampleId(s.id);
    // A case opened from a prototype's worked example starts on that same problem instance, as edited text.
    const preset = caseQ.data?.presetInputText;
    if (preset) { setText(preset); setEdited(true); } else setText(s.text);
  }, [samples, sampleId, wbQ.data, caseQ.data?.presetInputText, runParam]);

  const cfg = cfgQ.data;
  const bBlocks = useMemo(() => (cfg && baseId ? blocksFromConfig(cfg, baseId) : []), [cfg, baseId]);
  const aBlocks = useMemo(() => (wbQ.data ? blocksFromWorkbench(wbQ.data.blocks) : []), [wbQ.data]);
  const controls = useMemo(() => (cfg ? controlsFromConfig(cfg) : []), [cfg]);
  const { recs, more } = useMemo(() => {
    const all = (cfg?.steps ?? []).flatMap((s) => s.components).filter((c) => c.executable && c.controlType === "optional" && !c.active && c.capability.sourceSolutionId !== baseId);
    const sorted = [...all].sort((a, b) => Number(b.recommended) - Number(a.recommended) || Number(a.state === "incompatible") - Number(b.state === "incompatible"));
    return { recs: sorted.slice(0, 3), more: sorted.slice(3) };
  }, [cfg, baseId]);
  const cmp: ABComparison | undefined = cmpQ.data?.[0];
  const editable = true;
  const inputArgs = edited ? { inputText: text } : { sampleInputId: sampleId };
  const changedFromA = useMemo(() => {
    const a = new Map(aBlocks.map((b) => [b.id, b]));
    // Version A only lists the steps that run in production, so a step missing from A counts as inactive there.
    return bBlocks.filter((b) => { const x = a.get(b.id); return x ? x.active !== b.active || x.value !== b.value : b.active; }).map((b) => b.id);
  }, [aBlocks, bBlocks]);
  const rows = useMemo(() => buildRows(aBlocks, bBlocks, cmp, cmp?.runA ?? wbQ.data?.exampleRun, cmp?.runB ?? run ?? undefined), [aBlocks, bBlocks, cmp, wbQ.data, run]);
  const requests = caseQ.data?.capabilityRequests ?? [];
  // Requested capabilities sit where they were asked for, as non-executing rows; they never enter a run.
  const lane = useMemo<LaneEntry[]>(() => {
    const out: LaneEntry[] = [];
    const ids = new Set(rows.map((r) => r.id));
    for (const r of rows) {
      out.push({ kind: "step", row: r });
      for (const req of requests) if (req.afterStepId === r.id) out.push({ kind: "request", req });
    }
    for (const req of requests) if (!req.afterStepId || !ids.has(req.afterStepId)) out.push({ kind: "request", req });
    return out;
  }, [rows, requests]);
  const votes = evalsQ.data?.summary.tests ?? 0;

  const apply = (data: ConfigurationUpdate, label: string, record = true, weldId?: string) => {
    if (!cfg) return;
    const before = snapshot(cfg);
    put.mutate({ caseId, data }, {
      onSuccess: (next) => {
        qc.setQueryData(getGetCaseConfigurationQueryKey(caseId), next);
        refreshComp(caseId);
        // The weld is the server's confirmation made visible: only when the step is really active in the saved configuration.
        const joined = weldId ? next.steps.flatMap((st) => st.components).find((c) => c.capability.id === weldId && c.active) : undefined;
        if (joined) setWelded(weldId!);
        setConnected(joined ? `Connected: ${joined.capability.name} · source ${joined.sourceSolutionName}` : null);
        qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes(`/cases/${caseId}`) && String(q.queryKey[0]) !== getGetCaseConfigurationQueryKey(caseId)[0] });
        if (record) { setUndo((u) => [...u, before]); say(label, () => restore(before)); } else say(label);
      },
      onError: (e) => say(errMsg(e)),
    });
  };
  const restore = (s: Snap) => { setUndo((u) => u.slice(0, -1)); apply(s, "Undone", false); };
  const toggle = (id: string, name: string, on: boolean) => apply({ moduleStates: { [id]: on } }, on ? `${name} connected to Version B` : `${name} switched off`, true, on ? id : undefined);
  useEffect(() => { if (!welded) return; const t = window.setTimeout(() => setWelded(null), 900); return () => window.clearTimeout(t); }, [welded]);
  useEffect(() => { if (energized.size === 0) return; const t = window.setTimeout(() => setEnergized(new Set()), 2400); return () => window.clearTimeout(t); }, [energized]);
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

  const setCase = (c: Case) => { qc.setQueryData(getGetCaseQueryKey(caseId), c); qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) }); };
  const recordRequest = (input: { need: string; missing: string; afterStepId: string | null; reuseEventId?: string }, undoable = true) =>
    new Promise<void>((resolve) => {
      addRequest.mutate({ caseId, data: { need: input.need, missing: input.missing, afterStepId: input.afterStepId ?? undefined, reuseEventId: input.reuseEventId } }, {
        onSuccess: (c) => {
          setCase(c);
          const created = c.capabilityRequests[c.capabilityRequests.length - 1];
          if (undoable && created) say("Request recorded. It shows as a row but does not run.", () => dropRequest(created, false)); else say("Request restored");
          if (created) window.setTimeout(() => scrollToRow(`req:${created.id}`), 50);
          resolve();
        },
        onError: (e) => { say(errMsg(e)); resolve(); },
      });
    });
  const dropRequest = (req: CapabilityRequest, undoable = true) =>
    removeRequest.mutate({ caseId, requestId: req.id }, {
      onSuccess: (c) => { setCase(c); if (undoable) say("Request removed", () => void recordRequest({ need: req.need, missing: req.missing, afterStepId: req.afterStepId }, false)); else say("Undone"); },
      onError: (e) => say(errMsg(e)),
    });
  const dropRequirement = (id: string, text: string) =>
    removeRequirement.mutate({ caseId, requirementId: id }, { onSuccess: (c) => { setCase(c); say(`Removed "${text}"`); }, onError: (e) => say(errMsg(e)) });
  const onRequirementAdded = (r: CaseRequirementResult) => {
    setCase(r.case);
    say(`Added "${r.requirement.text}"`, () => dropRequirement(r.requirement.id, r.requirement.text));
  };
  const saveExperiment = () =>
    updCase.mutate({ caseId, data: { saved: true } }, {
      onSuccess: async (c) => {
        setCase(c); invalidateCase(caseId);
        say(`Saved as an experimental improvement to ${c.lineage.parentSolutionName}.`);
        // Other teams on the same change are shown after the save, never instead of it.
        try { const s = await getSimilarExperiments(caseId); if (s.count > 0) setSimilar(s); } catch { /* the save already succeeded */ }
      },
      onError: (e) => say(errMsg(e)),
    });
  const saveIntent = () => {
    const next = intentDraft.trim();
    if (!next) { setIntentOpen(false); return; }
    const before = caseQ.data?.intent ?? null;
    updCase.mutate({ caseId, data: { intent: next } }, {
      onSuccess: (c) => { setCase(c); setIntentOpen(false); say(`Intent: ${c.lineage.intent}`, before ? () => updCase.mutate({ caseId, data: { intent: before } }, { onSuccess: setCase }) : undefined); },
      onError: (e) => say(errMsg(e)),
    });
  };
  const afterBoth = (r: ABComparison, msg?: string) => {
    qc.setQueryData<ABComparison[]>(getGetCaseComparisonQueryKey(caseId), (old) => [r, ...(old ?? [])]);
    setPicked(null); invalidateCase(caseId);
    // Illuminate exactly the steps the real diff holds responsible; nothing lights up when nothing changed.
    setEnergized(new Set(r.diff.stepsResponsible.map((s) => s.stepId)));
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
    if (id === "input") { document.querySelector('[data-testid="panel-input"]')?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (rows.some((r) => r.id === id)) setOpen((o) => new Set(o).add(id));
    window.setTimeout(() => scrollToRow(id), 40);
  };
  // Clicking a block opens its detail below the viewport and brings it into view; clicking again closes it.
  const onPick = (e: DiffEntry) => { setPicked(e); setOpen((o) => new Set(o).add(e.stepId)); scrollToRow(e.stepId); };

  useEffect(() => {
    if (jumpedRef.current || rows.length === 0 || cmpQ.isLoading) return;
    jumpedRef.current = true;
    if (initialMode === "compare") window.setTimeout(() => scrollToRow(cmp ? "output" : "verdict"), 80);
  }, [rows.length, cmpQ.isLoading, initialMode, cmp]);

  if (caseQ.isLoading || cfgQ.isLoading) return <LoadingView />;
  if (gone) return <GoneView caseId={caseId} />;
  if (caseQ.isError || cfgQ.isError || !caseQ.data || !cfg) return <ErrorView onRetry={() => { caseQ.refetch(); cfgQ.refetch(); }} message="This workbench could not load." />;
  const theCase = caseQ.data;
  // Redundancy for any cross-source case: the linked recommendation, else the base plus the donors active in B.
  const donorIds = [...new Set(cfg.steps.flatMap((st) => st.components).map((x) => (x.active ? x.capability.sourceSolutionId : undefined)).filter((id): id is string => !!id && id !== baseId))];
  const donorSources = donorIds.map((id) => { const v = solsQ.data?.find((s) => s.id === id)?.currentVersion; return v === undefined ? null : { solutionId: id, version: String(v) }; });
  const redundancyTarget = compQ.data ? { caseId } : donorIds.length && baseId && donorSources.every((x) => x !== null)
    ? { sources: [{ solutionId: baseId, version: String(theCase.parentVersion) }, ...donorSources.filter((x): x is { solutionId: string; version: string } => x !== null)] } : null;
  const standardA = !!wbQ.data && wbQ.data.liveVersion !== wbQ.data.solution.currentVersion;
  const reuseActions: ReuseActions = {
    caseId, baseName: wbQ.data?.solution.name ?? "this product", cfg, busy: put.isPending,
    onAdd: (c) => { add(c); setSlotOpen(null); window.setTimeout(() => scrollToRow(c.capability.id), 80); },
    onOpenStep: (id) => { setSlotOpen(null); jump(id); },
    onRequest: (input) => recordRequest(input),
  };
  const dragC = [...recs, ...more].find((c) => `add:${c.capability.id}` === dragging);
  const status = caseStatusLabel(theCase);
  const sample = samples.find((s) => s.id === sampleId);
  const needsBoth = changedFromA.length > 0 || !!cmp?.staleB;
  const fresh = !!cmp && !cmp.staleB;
  const busyRun = runOne.isPending || runBoth.isPending;
  const noInput = !sampleId && !text.trim();
  const stepsResponsible = cmp?.diff.stepsResponsible ?? [];
  const connectStatus = busyRun ? "Fusing A and B…" : connected ?? (changedFromA.length ? `${changedFromA.length} change${changedFromA.length === 1 ? "" : "s"} in B · ready to fuse` : "Ready to connect");

  const stateText = runBoth.isPending ? "Running both..." : runOne.isPending ? "Running..."
    : cmp?.staleB ? "Version B changed since the last run" : fresh ? `Compared on "${samples.find((s) => s.id === cmp.sampleInputId)?.name ?? "edited text"}" · ${new Date(cmp.runB.createdAt).toLocaleTimeString()}`
    : changedFromA.length ? "B differs from A · not compared yet" : "Version B equals the current product";
  // The kit's one action: "Fuse A/B" in sienna. Before B differs from A there is only B to fuse.
  const primary = !cmp && !needsBoth
    ? <button data-testid="button-run" onClick={doRun} disabled={busyRun || noInput} className={cn(btn.accent, "min-h-12 px-7")}><Zap className="h-5 w-5" /> {runOne.isPending ? "Fusing..." : "Fuse B"}</button>
    : <button data-testid="button-run-both" onClick={doBoth} disabled={busyRun || noInput} className={cn(fresh ? btn.secondary : btn.accent, "min-h-12 px-7")}><Zap className="h-5 w-5" /> {runBoth.isPending ? "Fusing..." : cmp ? "Fuse A/B again" : "Fuse A/B"}</button>;

  if (proposalView) {
    const baseName = wbQ.data?.solution.name ?? theCase.lineage.parentSolutionName;
    const nodes = proposalNodes(lane, baseName);
    const runnable = nodes.some((n) => n.kind !== "build");
    const openFull = () => navigate(`/workbench/${caseId}`);
    const tryIt = () => {
      runOne.mutate({ data: { caseId, version: "B", ...inputArgs } }, {
        onSuccess: (r) => { setRun(r); invalidateCase(caseId); navigate(`/workbench/${caseId}`); window.setTimeout(() => scrollToRow("output"), 120); },
        onError: (e) => say(errMsg(e)),
      });
    };
    return (
      <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-5 md:px-6" data-testid="view-proposal">
        <StageEyebrow stage="connect" className="mb-2" />
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <span>Workbench</span><span>/</span><Link href={`/solutions/${baseId}`} className="hover:text-primary hover:underline">{theCase.lineage.parentSolutionName}</Link>
          <Tag tone={status.tone} testid="status-case">{status.l}</Tag>
        </div>
        <h1 data-testid="text-headline" className="mt-0.5 break-words text-[24px] md:text-[28px]">{theCase.title}</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">Starts from {baseName}. Version A is the locked baseline; Version B is what you are configuring. Click any block for detail.</p>
        <div className="mt-5">
          {wbQ.isLoading ? <Skel className="h-60 rounded-[20px]" /> : <ProposalMap lane={lane} baseName={baseName} edit={{
            editable, busy: put.isPending || addRequest.isPending || removeRequest.isPending,
            onSwitch: (id, name, on) => toggle(id, name, on),
            onSetOption: (id, name, v) => apply({ configValues: { [id]: v } }, `${name}: ${v}`),
            onRemoveRequest: (req) => dropRequest(req),
            picker: (afterId, afterName, close) => <StepPicker afterId={afterId} afterName={afterName} actions={{ ...reuseActions, onAdd: (c) => { add(c); close(); }, onOpenStep: () => close(), onRequest: async (input) => { await recordRequest(input); close(); } }} browse={<Tray recs={recs} more={more} busy={put.isPending} enabled hideTitle onAdd={(c) => { add(c); close(); }} />} onClose={close} />,
            canUndo: undo.length > 0, onUndo: () => restore(undo[undo.length - 1]),
          }} />}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button data-testid="button-try-proposal" onClick={tryIt} disabled={!runnable || runOne.isPending || noInput} className={cn(btn.accent, "min-h-12 px-6")}>
            <Zap className="h-5 w-5" /> {runOne.isPending ? "Running…" : "Try current workflow"}
          </button>
          <button data-testid="button-open-full-workbench" onClick={openFull} className={btn.secondary}><Workflow className="h-4 w-4" /> Open full workbench</button>
          {!runnable && <span className="text-[13px] text-muted-foreground" data-testid="text-no-runnable">Nothing runnable yet: every step is still to build.</span>}
          {runnable && noInput && <span className="text-[13px] text-muted-foreground">Loading a sample input…</span>}
        </div>
        <div className="mt-6"><CaseExports theCase={theCase} configPending={put.isPending} compact /></div>
      </div>
    );
  }

  const editTools = editable && (
    <div className="flex flex-wrap items-center gap-1">
      <button data-testid="button-undo" disabled={!undo.length || put.isPending} onClick={() => restore(undo[undo.length - 1])} className={darkTool}><Undo2 className="h-4 w-4" /> Undo</button>
      <button data-testid="button-reset-b" disabled={put.isPending || changedFromA.length === 0} onClick={resetToA} className={darkTool}><RotateCcw className="h-4 w-4" /> Reset B</button>
    </div>
  );
  const labelA = cmp ? "A · comparison run" : "A · saved example";
  const labelB = cmp ? "B · comparison run" : "B · your run";
  const slotRow = slotOpen && slotOpen !== "end" ? rows.find((r) => r.id === slotOpen) ?? null : null;
  const browse = <Tray recs={recs} more={more} busy={put.isPending} enabled hideTitle onAdd={(c) => { add(c); setSlotOpen(null); }} />;
  // Insertion sockets between steps: click to open the reuse-first picker for that position, or drop a library capability on it.
  const slotFor = (afterId: string | null, afterName: string | null) => (
    <li className="list-none" data-testid={`slot-${afterId ?? "start"}`}>
      <AddSlot id={afterId ?? "start"} afterName={afterName} dragging={!!dragging} enabled={editable} openId={slotOpen} setOpenId={setSlotOpen} visible
        picker={<div className="mt-2 rounded-xl bg-card p-1 text-foreground"><StepPicker afterId={afterId} afterName={afterName} actions={reuseActions} browse={browse} onClose={() => setSlotOpen(null)} /></div>} />
    </li>
  );
  const presence = cmp ? sectionPresence(cmp.runA.output.sections, cmp.runB.output.sections) : undefined;
  const outputCard = (v: "A" | "B", r: Run, marks?: Map<string, DiffEntry>) => (
    <div className={cn("card-soft p-4", v === "B" && "border-t-4 border-t-sienna")} data-testid={`panel-version-${v.toLowerCase()}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={cn("grid h-7 w-7 place-items-center rounded-md text-[13px] font-bold text-white", v === "A" ? "bg-primary" : "bg-siennaink")}>{v}</span>
        <span className="text-[14px] font-semibold">{v === "A" ? (standardA ? `Standard product · v${theCase.parentVersion}` : "Current product") : "Proposed version"}</span>
        <span className="ml-auto"><RunMeta run={r} testid={`run-meta-${v}`} /></span>
      </div>
      <OutputView output={r.output} marks={marks} selectedKey={picked ? diffKey(picked) : null} onPick={marks ? onPick : undefined} testid={`output-${v.toLowerCase()}`} presence={marks ? presence : undefined} side={v} dim={v === "B" && !!cmp?.staleB} />
    </div>
  );

  return (
    <DndContext sensors={sensors} collisionDetection={dropUnderPointer} onDragStart={(e) => setDragging(String(e.active.id))} onDragCancel={() => setDragging(null)} onDragEnd={onDragEnd}>
      <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-5 md:px-6">
        {/* Title: an experimental branch of the parent product, never a product of its own */}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><StageEyebrow stage="connect" note="Make the connection. Feel the change." /><WiringEntry testid="link-workbench-wiring" /></div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              <span>Workbench</span><span>/</span><Link href={`/solutions/${baseId}`} className="hover:text-primary hover:underline">{theCase.lineage.parentSolutionName}</Link>
              <Tag tone={status.tone} testid="status-case">{status.l}</Tag>
              {theCase.saved && <Tag tone="slate">Saved</Tag>}
              {theCase.demo && <Tag>Demo</Tag>}
            </div>
            <h1 data-testid="text-headline" className="mt-0.5 truncate text-[24px] md:text-[28px]">{theCase.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5" data-testid="text-promotion-state"><GitBranch className="h-3.5 w-3.5" /> {PROMOTION_LABEL[theCase.promotionState]}</span>
              <span>·</span>
              <span data-testid="text-lineage">{theCase.lineage.summary}</span>
              <span>·</span>
              <span data-testid="text-owner">{theCase.ownerName}{theCase.ownerTeam ? `, ${theCase.ownerTeam}` : ""}</span>
              <span>·</span>
              {intentOpen ? (
                <form className="inline-flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); saveIntent(); }}>
                  <input autoFocus data-testid="input-intent" value={intentDraft} onChange={(e) => setIntentDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setIntentOpen(false); }} placeholder="What this experiment is for" className="h-8 w-64 rounded-lg border border-input px-2 text-[13px] text-foreground outline-none focus:border-primary" />
                  <button type="submit" data-testid="button-save-intent" disabled={updCase.isPending} className={cn(btn.quiet, "min-h-8 px-2 text-primary")}>Save</button>
                  <button type="button" onClick={() => setIntentOpen(false)} className={cn(btn.quiet, "min-h-8 px-2")}>Cancel</button>
                </form>
              ) : (
                <button data-testid="button-edit-intent" disabled={!editable} onClick={() => { setIntentDraft(theCase.intent ?? (theCase.lineage.intentKey === "none" ? "" : theCase.lineage.intent)); setIntentOpen(true); }} className="inline-flex items-center gap-1 rounded hover:text-primary disabled:pointer-events-none">
                  Intent: <span className="font-medium text-foreground" data-testid="text-intent">{theCase.lineage.intent}</span>{editable && <Pencil className="h-3 w-3" />}
                </button>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {editable && <button data-testid="button-save" disabled={updCase.isPending} onClick={saveExperiment} className={btn.quiet}>
              <Save className="h-4 w-4" /> {theCase.saved ? "Saved experiment" : "Save experiment"}
            </button>}
            {theCase.briefId && <Link href={`/workbench/${caseId}?view=proposal`} className={btn.quiet} data-testid="link-proposal-view"><Workflow className="h-4 w-4" /> Proposed map</Link>}
          </div>
        </div>
        <Dialog open={!!similar} onOpenChange={(o) => { if (!o) setSimilar(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="text-primary">Saved. Others are on the same change.</DialogTitle><DialogDescription>Your experiment stays under {theCase.lineage.parentSolutionName}; so do theirs.</DialogDescription></DialogHeader>
            {similar && <SimilarPrompt similar={similar} mine={{ changes: lineageChanges(theCase.lineage), votes: `${votes} vote${votes === 1 ? "" : "s"} so far` }} onContinue={() => setSimilar(null)} />}
          </DialogContent>
        </Dialog>

        {compQ.data && <div className="mt-6" id="recommendation"><LinkedComposition c={compQ.data} names={(id) => solsQ.data?.find((s) => s.id === id)?.name ?? (id === baseId ? theCase.lineage.parentSolutionName : id)} savedAt={theCase.updatedAt} /></div>}
        {redundancyTarget && <div className="mt-5" id="feature-redundancy"><FeatureRedundancy key={JSON.stringify(redundancyTarget)} target={redundancyTarget} scope={`case:${theCase.updatedAt}|cfg:${JSON.stringify(snapshot(cfg))}${compQ.data ? `|cmp:${compQ.data.revision}` : ""}`} names={(id) => solsQ.data?.find((s) => s.id === id)?.name ?? id} inPlan={new Set(bBlocks.filter((b) => b.active).map((b) => b.id))} /></div>}

        {/* Included capabilities: the invoice workbench layout, one dark map and straightforward side controls */}
        <div className="mt-6 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <LanesDrop enabled={editable} dragging={!!dragging}>
            <section id="wiring" className="scroll-mt-24 rounded-[20px] bg-[hsl(var(--primary))] p-5 text-primary-foreground md:p-6" data-testid="panel-map" aria-label="Included capabilities">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h2 className="text-[17px] font-semibold text-primary-foreground">Included capabilities</h2>
                <span className="text-[12.5px] opacity-75">Starts from {theCase.lineage.parentSolutionName}. Click a step for A/B detail.</span>
                <span className="ml-auto">{editTools}</span>
              </div>
              <p className="mb-3 text-[12px] opacity-75" data-testid="text-connect-status">{connectStatus}</p>
              {wbQ.isLoading || rows.length === 0 ? <Skel className="h-60 rounded-xl bg-white/10" /> : (
                <ol className="space-y-3">
                  <MapNode title={edited ? "Edited input" : sample?.name ?? "Input"} sub="Shared by Version A and Version B" />
                  {slotFor(null, null)}
                  {lane.map((x) => {
                    if (x.kind === "request") return (
                      <li key={x.req.id} id={`row-req:${x.req.id}`} className="flex items-center gap-3 rounded-xl border border-dashed border-[#FFD09F]/50 px-4 py-3" data-testid={`node-request-${x.req.id}`}>
                        <ListPlus className="h-4 w-4 shrink-0 text-[#FFD09F]" />
                        <div className="min-w-0 flex-1"><div className="font-semibold">Requested: {x.req.need}</div><div className="text-[12.5px] opacity-75">Not built yet · does not run</div></div>
                        <button onClick={() => dropRequest(x.req)} disabled={!editable || removeRequest.isPending} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] hover:bg-white/10 disabled:opacity-40" data-testid={`button-remove-request-${x.req.id}`}><Minus className="h-3.5 w-3.5" /> Remove</button>
                      </li>
                    );
                    const r = x.row;
                    const reused = r.b.added;
                    return (
                      <Fragment key={r.id}><li id={`row-${r.id}`} className="scroll-mt-[calc(var(--shell-top)+6rem)]">
                        <div className={cn("rounded-xl px-4 py-3 transition-colors", r.b.active ? "bg-white/10" : "bg-white/[.04] opacity-70", welded === r.id && "seat", energized.has(r.id) && "ring-2 ring-[#9ED9E3]")} data-testid={`node-cap-${r.id}`}>
                          <div className="flex flex-wrap items-center gap-3">
                            {r.b.active ? <Check className="h-4 w-4 shrink-0 text-[#9ED9E3]" /> : <Minus className="h-4 w-4 shrink-0 opacity-60" />}
                            <button onClick={() => toggleRow(r.id)} className="min-w-0 flex-1 text-left" aria-expanded={open.has(r.id)} data-testid={`button-step-${r.id}`}>
                              <div className="font-semibold">{r.name}{r.deviation && <span className="ml-2 rounded bg-[#FFD09F]/20 px-1.5 py-0.5 text-[11px] font-medium text-[#FFD09F]">{r.deviation === "added" ? "added in B" : r.deviation === "off" ? "off in B" : r.deviation === "on" ? "on in B" : "setting changed"}</span>}</div>
                              <div className="text-[12.5px] opacity-75">{reused ? `from ${r.source}` : r.stage} · {r.kind === "required" ? "required" : r.kind === "configurable" ? "configurable" : "optional"}{r.changes ? ` · ${r.changes} output change${r.changes === 1 ? "" : "s"}` : ""}</div>
                            </button>
                            {r.kind === "configurable" && r.b.options && (
                              <select value={r.b.value ?? ""} disabled={!editable || put.isPending} onChange={(e) => apply({ configValues: { [r.id]: e.target.value } }, `${r.name}: ${e.target.value}`)} aria-label={`${r.name} setting`}
                                className="h-8 rounded-lg border border-white/25 bg-[hsl(var(--primary))] px-2 text-[12.5px] text-primary-foreground" data-testid={`select-option-${r.id}`}>
                                {r.b.options.map((o) => <option key={o} value={o}>{o}</option>)}
                              </select>
                            )}
                            {r.kind === "optional" && (r.b.active
                              ? <button onClick={() => toggle(r.id, r.name, false)} disabled={!editable || put.isPending} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] hover:bg-white/10 disabled:opacity-40" data-testid={`button-remove-${r.id}`}><Minus className="h-3.5 w-3.5" /> Remove</button>
                              : addBackState(r.b, !editable || put.isPending).kind === "blocked"
                                ? <span className="text-[12px] text-[#FFD09F]" data-testid={`text-blocked-${r.id}`}>Can't add</span>
                                : <button onClick={() => toggle(r.id, r.name, true)} disabled={!editable || put.isPending} title="Switch on in Version B" className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] hover:bg-white/10 disabled:opacity-40" data-testid={`button-restore-${r.id}`}><Plus className="h-3.5 w-3.5" /> Add back</button>)}
                            {r.kind === "required" && <span className="text-[11.5px] opacity-70">required</span>}
                          </div>
                          {!r.b.active && (() => { const st = addBackState(r.b, false); return st.kind === "blocked" ? <p className="mt-1 pl-7 text-[12px] opacity-80" data-testid={`text-blocked-reason-${r.id}`}>{st.reason}</p> : null; })()}
                        </div>
                      </li>{slotFor(r.id, r.name)}</Fragment>
                    );
                  })}
                  <MapNode title="Output" sub={`${theCase.lineage.parentSolutionName} result, compared A against B`} />
                </ol>
              )}
              {controls.length > 0 && <p className="mt-3 text-[12px] opacity-75" data-testid="list-controls">Controls in place: {controls.map((c) => c.name).join(", ")}</p>}
            </section>
          </LanesDrop>

          <aside className="space-y-4">
            {editable && (
              <section className="card-soft p-5" data-testid="panel-library">
                <h2 className="text-[16px] font-semibold">Add from other apps</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">Governed capabilities this workflow can actually run. Each shows the app it comes from.</p>
                <div className="mt-3"><Tray recs={recs} more={more} busy={put.isPending} enabled hideTitle onAdd={add} /></div>
                {recs.length + more.length === 0 && <p className="mt-2 text-[13px] text-muted-foreground" data-testid="text-no-reuse">Every compatible capability is already included.</p>}
                <button onClick={() => setSlotOpen(slotOpen ? null : "end")} className={cn(btn.quiet, "mt-2 px-0")} data-testid="button-open-picker"><ListPlus className="h-4 w-4" /> Need something not listed?</button>
                {slotOpen === "end" && <div className="mt-3"><StepPicker afterId={slotRow?.id ?? null} afterName={null} actions={reuseActions} browse={null} onClose={() => setSlotOpen(null)} /></div>}
              </section>
            )}
            <section className="card-soft p-5" data-testid="panel-input">
              <h2 className="text-[16px] font-semibold">Input</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">Shared by A and B. Pick a sample or edit the text.</p>
              <div className="mt-3">{samplesQ.isLoading ? <Skel className="h-24" /> : <InputPanel compact samples={samples} sampleId={sampleId} text={text} edited={edited} onPick={pickSample} onText={(t) => { setText(t); setEdited(true); }} upload={<InputUpload targetId={caseId} currentText={text} onAccept={(t) => { setText(t); setEdited(true); }} />} />}</div>
            </section>
            <section className="card-soft p-5">
              <h2 className="text-[16px] font-semibold">Try the real workflow</h2>
              <p className="mt-1 text-[13px] text-muted-foreground" data-testid="text-compared-input">{stateText}</p>
              <div className="mt-3 flex flex-wrap gap-2">{primary}</div>
              {cmp?.staleB && <div className="mt-3"><StaleHint onRun={doBoth} busy={runBoth.isPending} /></div>}
            </section>
            {editable && (
              <section className="card-soft p-5" data-testid="panel-requirements">
                <div className="flex items-center gap-2"><h2 className="text-[16px] font-semibold">Requirements</h2>
                  <button data-testid="button-add-requirement" aria-expanded={reqOpen} onClick={() => setReqOpen((v) => !v)} className={cn(btn.quiet, "ml-auto px-2")}><ListPlus className="h-4 w-4" /> {reqOpen ? "Hide" : "Add a requirement"}</button></div>
                {reqOpen ? <div className="mt-3"><RequirementAdder actions={reuseActions} briefRequirements={briefQ.data?.requirements.map((r) => r.text) ?? []} caseRequirements={theCase.requirements} onAdded={onRequirementAdded} onRemove={dropRequirement} onRunBoth={doBoth} runBothBusy={runBoth.isPending} needsBoth={needsBoth} /></div>
                  : <p className="mt-1 text-[13px] text-muted-foreground">{theCase.requirements.length} recorded for this experiment.</p>}
              </section>
            )}
          </aside>
        </div>

        {rows.some((r) => open.has(r.id)) && (
          <div className="mt-5 space-y-3" data-testid="panel-step-details">
            {rows.filter((r) => open.has(r.id)).map((r) => (
              <StepDetail key={r.id} r={r} no={rows.indexOf(r) + 1} labelA={labelA} labelB={labelB} picked={picked} onPick={onPick}
                explanation={(cmp?.explanation ?? []).filter((e) => e.startsWith(r.name))} onClose={() => toggleRow(r.id)} />
            ))}
          </div>
        )}

        <div className="mt-6">
          <div className="min-w-0">
            {/* Output */}
            <BandRow id="output" label="Output" icon={<Equal className="h-3.5 w-3.5" />} narrow={narrow}>
              {runParam && runQ.isError && !run ? <div role="alert" className="card-soft p-5">Saved output could not load. <button className={btn.quiet} onClick={() => void runQ.refetch()}>Retry</button></div> : runParam && runQ.isLoading && !run ? <div role="status" className="card-soft p-5">Loading saved output…</div> : runParam && runQ.data && !run ? <div role="alert" className="card-soft p-5">This saved run belongs to a different workflow.</div> : runBoth.isPending || runOne.isPending ? (
                <div className="circuit-grid rounded-2xl border border-navy2 p-5 text-white" role="status" aria-live="polite" data-testid="state-running">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="relative grid h-9 w-9 place-items-center rounded-full border border-cyan/60"><Play className="h-4 w-4 text-cyan" /><span className="absolute inset-0 animate-ping rounded-full border border-cyan/40 motion-reduce:hidden" /></span>
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold">{runBoth.isPending ? "Running A and B on the same input" : "Running Version B"}</div>
                      <div className="text-[12.5px] text-white/65">{edited ? "Edited text" : sample?.name ?? "Input"} · real execution, output appears when both finish</div>
                    </div>
                  </div>
                  <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full w-1/3 rounded-full bg-cyan motion-reduce:w-full" style={{ animation: "running-bar 1.1s ease-in-out infinite alternate" }} /></div>
                </div>
              ) : cmp ? (
                <>
                  <div className={narrow ? "space-y-3" : laneGrid}>
                    {outputCard("A", cmp.runA, marksFrom(cmp.diff.entries))}
                    {!narrow && <div />}
                    {outputCard("B", cmp.runB, marksFrom(cmp.diff.entries))}
                  </div>
                  <div className="card-soft mt-3 p-4" data-testid="panel-diff">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[16px] font-semibold">What changed</h3>
                      {cmp.diff.entries.length === 0 ? <span data-testid="text-no-diff" className="text-[14px]">Both versions produced the same output for this input.</span> : <>
                        <span className="text-[14px] font-medium" data-testid="text-diff-summary">{summarize(cmp.diff.entries, outputRanked(cmp.runA.output.sections), outputRanked(cmp.runB.output.sections))}</span>
                        <span className="text-[12.5px] text-muted-foreground">{cmp.diff.unchanged} unchanged · click a highlighted line to open its step</span>
                      </>}
                    </div>
                    {cmp.explanation.length > 0 && <ul className="mt-2 space-y-1 text-[14px]" data-testid="list-explanation">{cmp.explanation.map((x, i) => <li key={i} className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-skyink" />{x}</li>)}</ul>}
                    {stepsResponsible.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px]">
                        <span className="text-muted-foreground">Steps responsible:</span>
                        {stepsResponsible.map((s) => (
                          <button key={s.stepId} data-testid={`button-responsible-${s.stepId}`} onClick={() => jump(s.stepId)} title={`${s.name} · ${s.workflowStep}${s.addedModule ? ` · from ${s.sourceSolutionName}` : ""}`} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-input bg-card px-2 font-medium text-primary hover:border-primary/50">
                            {s.name}
                            <span className="text-[12px] font-normal text-muted-foreground">{s.addedModule ? `from ${s.sourceSolutionName} · ` : ""}{s.workflowStep}</span>
                            <span className="rounded bg-accent px-1 text-[11.5px] font-semibold text-siennaink">{s.changes}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {role === "it" && <div className="mt-3"><Measures cmp={cmp} /></div>}
                </>
              ) : run ? (
                <div className={narrow ? "space-y-3" : laneGrid}>
                  {!narrow ? <div className="rounded-[14px] border border-dashed border-input bg-card/60 p-5 text-[14px] text-muted-foreground" data-testid="panel-version-a">
                    {changedFromA.length === 0 ? "Version B equals the current product, so this output is the same for A." : "Fuse A/B to see the current product's output beside Version B."}
                  </div> : null}
                  {!narrow && <div />}
                  <div>
                    {run.configFingerprint !== theCase.lineage.fingerprint && <p className="mb-2 rounded-lg bg-accent px-3 py-2 text-[13px] text-siennaink" data-testid="text-run-stale">Saved run from {new Date(run.createdAt).toLocaleString()} · Version B has changed since. Fuse again for the current version.</p>}
                    {outputCard("B", run)}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-input bg-card/60 p-8 text-center" data-testid="state-no-comparison">
                  <div className="text-[16px] font-semibold text-primary">{needsBoth ? "Fuse A/B to see A and B side by side" : "Fuse to see the output"}</div>
                  <p className="mt-1 text-[14px] text-muted-foreground">{needsBoth ? "Version B differs from the current product. The same input goes through both." : "Connect a component to Version B, or fuse the current product as it is."}</p>
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
                      <Link href={`/cases/${caseId}/decision`} className={cn(btn.secondary, "mt-4")} data-testid="link-decision-view"><FileText className="h-4 w-4" /> Decision view</Link>
                    </section>
                  ) : <>
                    <Vote cmp={cmp} role={role} />
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button data-testid="button-try-another" onClick={tryAnother} disabled={runBoth.isPending || samples.length < 2} className={btn.quiet}><RotateCcw className="h-4 w-4" /> Try another input</button>
                      <span className="flex-1" />
                      <button data-testid="button-continue-testing" onClick={() => jump("input")} className={btn.quiet}>Continue testing</button>
                      <ProposeActions theCase={theCase} quiet={!cmp.evaluation} />
                    </div>
                  </>}
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-input bg-card/60 p-6 text-center" data-testid="state-no-verdict">
                  <div className="text-[15px] font-semibold text-primary">Which result better solves the problem?</div>
                  <p className="mt-1 text-[14px] text-muted-foreground">Fuse A/B first. Your preference is recorded only against a real comparison.</p>
                </div>
              )}
              <CaseExports theCase={theCase} configPending={put.isPending} />
              {role === "it" && (
                <section className="card-soft mt-4 p-5" data-testid="panel-owner">
                  <h3 className="mb-2 text-[17px] font-semibold">IT Owner review</h3>
                  <InviteTesters caseId={caseId} />
                  <OwnerDecision caseId={caseId} />
                </section>
              )}
            </BandRow>
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>{dragC && <div className="lift w-[220px] rotate-[-2deg] rounded-xl border-2 border-orange bg-card p-3 text-[14px] font-semibold text-primary"><span className="mb-0.5 block font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">From {dragC.sourceSolutionName}</span>{dragC.capability.name}</div>}</DragOverlay>
    </DndContext>
  );
}

function MapNode({ title, sub }: { title: string; sub: string }) {
  return <li className="rounded-xl border border-dashed border-white/30 px-4 py-3"><div className="font-semibold">{title}</div><div className="text-[12.5px] opacity-75">{sub}</div></li>;
}
