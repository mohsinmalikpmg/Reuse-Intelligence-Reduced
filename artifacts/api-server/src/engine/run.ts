import type { Capability } from "@workspace/api-zod";
import { executionOrder, executorById, readInput } from "./steps";
import type { OutputItem, RunContext, RunOutput, RunStats, StepTrace } from "./types";

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
    const r = readInput(ctx);
    trace.push({ stepId: "input", name: "Read input", stage: "Ingest", status: "ran", ...r, durationMs: ms(t0), error: null });
  }
  for (const cap of steps) {
    const run = executorById.get(cap.id)!;
    const t0 = performance.now();
    try {
      const r = run(ctx);
      trace.push({ stepId: cap.id, name: cap.name, stage: cap.workflowStep, status: "ran", ...r, durationMs: ms(t0), error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${cap.name}: ${message}`);
      trace.push({ stepId: cap.id, name: cap.name, stage: cap.workflowStep, status: "error", inputSummary: "", transformation: "", outputSummary: "", itemCount: 0, durationMs: ms(t0), error: message });
    }
  }
  const sections = ctx.sections.filter((s) => s.items.length > 0);
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
