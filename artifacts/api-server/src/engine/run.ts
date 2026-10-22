import type { Capability } from "@workspace/api-zod";
import { executionOrder, executorById, readInput, readWorkbenchNotes } from "./steps";
import type { OutputItem, OutputSection, RunContext, RunOutput, RunStats, StepTrace } from "./types";

function sectionState(sections:OutputSection[]):Map<string,string>{return new Map(sections.map(s=>[s.key,JSON.stringify(s)]));}
function changedSections(before:Map<string,string>,sections:OutputSection[]):OutputSection[]{
  return structuredClone(sections.filter(s=>before.get(s.key)!==JSON.stringify(s)));
}

export interface ExecutionResult {
  output: RunOutput;
  trace: StepTrace[];
  stats: RunStats;
  durationMs: number;
  errors: string[];
}

/** Executable capabilities in execution order. Anything without an executor (identity, audit, …) is a control, not a step. */
export function executableSteps(active: Capability[]): Capability[] {
  return active
    .filter((cap) => executorById.has(cap.id))
    .sort((a, b) => (executionOrder.get(a.id) ?? 99) - (executionOrder.get(b.id) ?? 99));
}

/**
 * Run the given active capabilities against an input. Deterministic; the only clock use is for durations.
 * A step that throws is recorded as an error and the run continues so the user can see where it broke.
 */
export function executeWorkflow(active: Capability[], configValues: Record<string, string>, input: string): ExecutionResult {
  const started = performance.now();
  const steps = executableSteps(active);
  const unavailableReaders=active.filter(cap=>cap.category==="Data ingestion"&&!["cap-wo-ingest","cap-csv-ingest"].includes(cap.id));
  if(unavailableReaders.length){
    const errors=unavailableReaders.map(cap=>`${cap.name}: selected ingestion has no supported reader. Supply input through a supported ingestion contract; analysis was not run.`);
    return {output:{headline:"Input ingestion unavailable",sections:[{key:"ingestion-error",title:"Input could not be ingested",stepId:"input",items:errors.map((text,i)=>({id:`input:ingestion-${i}`,key:`ingestion-${i}`,kind:"note",text,detail:null,stepId:"input",refs:[]}))}]},
      trace:[...unavailableReaders.map((cap,i)=>({stepId:cap.id,name:cap.name,stage:cap.workflowStep,status:"error" as const,inputSummary:"Input not ingested",transformation:"No supported ingestion executor",outputSummary:"Analysis not run",itemCount:0,durationMs:0,error:errors[i],outputSections:[],outputSnapshotStatus:"available" as const})),
        ...steps.map(cap=>({stepId:cap.id,name:cap.name,stage:cap.workflowStep,status:"skipped" as const,inputSummary:"Input not ingested",transformation:"Skipped because selected ingestion is unavailable",outputSummary:"Not run",itemCount:0,durationMs:0,error:null,outputSections:[],outputSnapshotStatus:"available" as const}))],
      stats:{steps:0,sections:1,items:errors.length,issues:0,patterns:0,actions:0,errors:errors.length},durationMs:ms(started),errors};
  }
  const ctx: RunContext = {
    input,
    config: configValues,
    notes: [],
    summaries: new Map(),
    findings: [],
    clusters: [],
    ranked: false,
    reviewThreshold: 3,
    reviewItems: [],
    actions: [],
    sections: [],
    scratch: {},
  };
  const trace: StepTrace[] = [];
  const errors: string[] = [];
  const hasReader = steps.some((s) => s.id === "cap-wo-ingest" || s.id === "cap-csv-ingest");
  if (!hasReader) {
    const t0 = performance.now();
    // These existing executors consume parsed notes, not raw free text. The workbench
    // input bridge must populate that context without silently enabling CSV ingestion.
    const usesNotes=steps.some(s=>["cap-summarize","cap-b-summarize","cap-recurring","cap-clustering","cap-similarity","cap-action-tracking","cap-reports","cap-exec-digest"].includes(s.id));
    const r = (usesNotes?readWorkbenchNotes:readInput)(ctx);
    trace.push({ stepId: "input", name: "Read input", stage: "Ingest", status: "ran", ...r, durationMs: ms(t0), error: null,outputSections:structuredClone(ctx.sections),outputSnapshotStatus:"available" });
  }
  for (const cap of steps) {
    const run = executorById.get(cap.id)!;
    const t0 = performance.now();
    const before=sectionState(ctx.sections);
    try {
      const r = run(ctx);
      trace.push({ stepId: cap.id, name: cap.name, stage: cap.workflowStep, status: "ran", ...r, durationMs: ms(t0), error: null,outputSections:changedSections(before,ctx.sections),outputSnapshotStatus:"available" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${cap.name}: ${message}`);
      trace.push({ stepId: cap.id, name: cap.name, stage: cap.workflowStep, status: "error", inputSummary: "", transformation: "", outputSummary: "", itemCount: 0, durationMs: ms(t0), error: message,outputSections:changedSections(before,ctx.sections),outputSnapshotStatus:"available" });
    }
  }
  const sections = ctx.sections.filter((s) => s.items.length > 0);
  if(!sections.length)sections.push({key:"no-output",title:"No output produced",stepId:"input",items:[{id:"input:no-output",key:"no-output",kind:"note",stepId:"input",refs:[],detail:null,text:steps.length?"The selected steps produced no output for this input. Check the step trace and required input fields.":"No executable analysis steps are enabled. Add a supported step before testing this input."}]});
  else if(sections.every(s=>s.key==="input"))sections.push({key:"no-analysis",title:"Input read; no analysis result",stepId:"input",items:[{id:"input:no-analysis",key:"no-analysis",kind:"note",stepId:"input",refs:[],detail:null,text:"The input was read, but no selected analysis step produced a result. Enable an analysis step or check its dependencies and trace."}]});
  const output: RunOutput = { headline: headline(ctx, sections.flatMap((s) => s.items)), sections };
  const items = sections.flatMap((s) => s.items);
  const stats: RunStats = {
    steps: trace.filter((t) => t.status === "ran").length,
    sections: sections.length,
    items: items.length,
    issues: items.filter((i) => i.kind === "recurring" || i.kind === "single").length,
    patterns: items.filter((i) => i.kind === "pattern").length,
    actions: items.filter((i) => i.kind === "action").length,
    errors: errors.length,
  };
  return { output, trace, stats, durationMs: Math.max(1, Math.round(performance.now() - started)), errors };
}

function ms(t0: number): number {
  return Math.max(1, Math.round(performance.now() - t0));
}

function headline(ctx: RunContext, items: OutputItem[]): string {
  if (ctx.notes.length > 0) {
    const recurring = ctx.findings.filter((f) => f.refs.length >= 2).length;
    const parts = [`${ctx.notes.length} work order${ctx.notes.length === 1 ? "" : "s"}`];
    parts.push(`${recurring} recurring concern${recurring === 1 ? "" : "s"}`);
    if (ctx.clusters.length) parts.push(`${ctx.clusters.length} cross-site pattern${ctx.clusters.length === 1 ? "" : "s"}`);
    if (ctx.actions.length) parts.push(`${ctx.actions.length} tracked action${ctx.actions.length === 1 ? "" : "s"}`);
    return parts.join(" · ");
  }
  const answer = items.find((i) => i.kind === "answer");
  if (answer) return answer.text;
  const actions = items.filter((i) => i.kind === "action").length;
  if (actions) return `${actions} follow-up action${actions === 1 ? "" : "s"} extracted`;
  return `${items.length} output line${items.length === 1 ? "" : "s"}`;
}
