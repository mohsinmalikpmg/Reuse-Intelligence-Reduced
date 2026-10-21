/**
 * Workbench services: build the executable workflow of a solution (Version A) or of a case's proposed
 * configuration (Version B), run them, persist runs, and compare outputs.
 */
import type { ABComparison, Capability, Case, Evaluation, OutputDiff, Run, SampleInput, Solution, SolutionWorkbench, WorkflowBlock } from "@workspace/api-zod";
import { getCapability, getSolution, solutionCapabilities } from "../data/catalog";
import { diffOutputs, scoreAgainstExpected } from "../engine/diff";
import { executeWorkflow, executableSteps } from "../engine/run";
import { isExecutable } from "../engine/steps";
import { sampleInputById, sampleInputsFor, type SampleInput as SeedInput } from "../engine/workorders";
import { buildComponents, caseContext, defaultConfigValues, defaultModuleStates, type CaseContext } from "./configuration";
import { hashInput, insertRun, listRunsForCase } from "./workbench-store";

export class WorkbenchError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function toSampleInput(s: SeedInput): SampleInput {
  return { id: s.id, name: s.name, description: s.description, solutionIds: s.solutionIds, text: s.text, hasExpected: s.expected !== null, noteCount: s.noteCount };
}

/** Production workflow of a solution: locked and configurable capabilities plus optional ones that ship enabled. */
export function productionCapabilities(solution: Solution): { active: Capability[]; configValues: Record<string, string> } {
  const caps = solutionCapabilities(solution);
  const active = caps.filter((cap) => cap.controlType !== "optional" || cap.evidenceLevel === "strong" || cap.evidenceLevel === "moderate");
  const configValues: Record<string, string> = {};
  for (const cap of caps) if (cap.controlType === "configurable" && cap.defaultOption) configValues[cap.id] = cap.defaultOption;
  return { active, configValues };
}

export function versionACapabilities(ctx: CaseContext): { active: Capability[]; configValues: Record<string, string> } {
  const states = defaultModuleStates(ctx);
  const active = ctx.baseCapabilities.filter((cap) => cap.controlType !== "optional" || states[cap.id]);
  return { active, configValues: defaultConfigValues(ctx) };
}

export function versionBCapabilities(c: Case, ctx: CaseContext): { active: Capability[]; configValues: Record<string, string> } {
  const components = buildComponents(c, ctx);
  const active = components.filter((comp) => comp.active).map((comp) => comp.capability);
  const configValues: Record<string, string> = {};
  for (const comp of components) if (comp.value) configValues[comp.capability.id] = comp.value;
  return { active, configValues };
}

export function toBlocks(solution: Solution, active: Capability[], configValues: Record<string, string>, origin: (cap: Capability) => "base" | "added" = () => "base"): WorkflowBlock[] {
  return executableSteps(active).map((cap) => ({
    capability: cap,
    stage: cap.workflowStep,
    kind: cap.controlType === "locked" ? "required" : cap.controlType,
    active: true,
    executable: true,
    value: cap.controlType === "configurable" ? (configValues[cap.id] ?? cap.defaultOption) : null,
    options: cap.controlType === "configurable" ? cap.options : null,
    origin: origin(cap),
    blockedReason: null,
  }));
}

export function resolveInput(sampleInputId: string | undefined, inputText: string | undefined, solutionId: string): { sampleInputId: string | null; text: string } {
  if (sampleInputId) {
    const sample = sampleInputById.get(sampleInputId);
    if (!sample) throw new WorkbenchError(`Unknown sample input ${sampleInputId}`, 404);
    const text = inputText?.trim() ? inputText : sample.text;
    return { sampleInputId: text === sample.text ? sample.id : null, text };
  }
  if (inputText?.trim()) return { sampleInputId: null, text: inputText };
  // Default to the richest sample so the saved example output shows what the product does at scale.
  const richest = [...sampleInputsFor(solutionId)].sort((a, b) => b.noteCount - a.noteCount)[0];
  if (!richest) throw new WorkbenchError("No input provided and no sample input exists for this solution.");
  return { sampleInputId: richest.id, text: richest.text };
}

interface RunSpec {
  caseId: string | null;
  solution: Solution;
  version: "A" | "B";
  versionLabel: string;
  active: Capability[];
  configValues: Record<string, string>;
  sampleInputId: string | null;
  text: string;
}

function execute(spec: RunSpec): Omit<Run, "id" | "createdAt"> {
  const result = executeWorkflow(spec.active, spec.configValues, spec.text);
  return {
    caseId: spec.caseId,
    solutionId: spec.solution.id,
    version: spec.version,
    versionLabel: spec.versionLabel,
    sampleInputId: spec.sampleInputId,
    inputText: spec.text,
    inputHash: hashInput(spec.text),
    enabledCapabilityIds: executableSteps(spec.active).map((cap) => cap.id),
    configValues: spec.configValues,
    output: result.output,
    trace: result.trace,
    stats: result.stats,
    durationMs: result.durationMs,
    errors: result.errors,
  };
}

/** Run a solution's production workflow (not persisted) — used for the saved example output. */
export function exampleRun(solution: Solution): Run {
  const { active, configValues } = productionCapabilities(solution);
  const input = resolveInput(undefined, undefined, solution.id);
  const run = execute({ caseId: null, solution, version: "A", versionLabel: `${solution.name} v${solution.currentVersion}`, active, configValues, sampleInputId: input.sampleInputId, text: input.text });
  return { id: `example_${solution.id}`, createdAt: new Date(0).toISOString(), ...run };
}

export function buildSolutionWorkbench(solution: Solution): SolutionWorkbench {
  const { active, configValues } = productionCapabilities(solution);
  const controls = solutionCapabilities(solution).filter((cap) => !isExecutable(cap.id) && cap.controlType === "locked");
  return {
    solution,
    blocks: toBlocks(solution, active, configValues),
    controls,
    sampleInputs: sampleInputsFor(solution.id).map(toSampleInput),
    exampleRun: exampleRun(solution),
  };
}

export async function runSolution(solution: Solution, sampleInputId: string | undefined, inputText: string | undefined): Promise<Run> {
  const { active, configValues } = productionCapabilities(solution);
  const input = resolveInput(sampleInputId, inputText, solution.id);
  return insertRun(execute({ caseId: null, solution, version: "A", versionLabel: `${solution.name} v${solution.currentVersion}`, active, configValues, sampleInputId: input.sampleInputId, text: input.text }));
}

export function versionLabels(c: Case, ctx: CaseContext): { a: string; b: string } {
  return { a: `${ctx.base.name} v${ctx.base.currentVersion} (current)`, b: `${c.title} (proposed)` };
}

export async function runCaseVersion(c: Case, version: "A" | "B", sampleInputId: string | undefined, inputText: string | undefined): Promise<Run> {
  const ctx = caseContext(c);
  const labels = versionLabels(c, ctx);
  const input = resolveInput(sampleInputId, inputText, ctx.base.id);
  const caps = version === "A" ? versionACapabilities(ctx) : versionBCapabilities(c, ctx);
  return insertRun(execute({ caseId: c.id, solution: ctx.base, version, versionLabel: version === "A" ? labels.a : labels.b, active: caps.active, configValues: caps.configValues, sampleInputId: input.sampleInputId, text: input.text }));
}

function stepName(id: string): { name: string; source: string } {
  const cap = getCapability(id);
  return cap ? { name: cap.name, source: cap.sourceSolutionName } : { name: id === "input" ? "Read input" : id, source: "" };
}

function enrichDiff(diff: ReturnType<typeof diffOutputs>): OutputDiff {
  const counts = new Map<string, number>();
  for (const e of diff.entries) counts.set(e.stepId, (counts.get(e.stepId) ?? 0) + 1);
  return {
    entries: diff.entries.map((e) => {
      const s = stepName(e.stepId);
      return { ...e, stepName: s.name, sourceSolutionName: s.source };
    }),
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed,
    unchanged: diff.unchanged,
    stepsResponsible: diff.stepsResponsible.map((id) => {
      const s = stepName(id);
      return { stepId: id, name: s.name, sourceSolutionName: s.source, changes: counts.get(id) ?? 0 };
    }),
  };
}

function explain(runA: Run, runB: Run, diff: OutputDiff): string[] {
  if (diff.entries.length === 0) return ["Both versions produced the same output for this input. The change made no difference here."];
  const lines: string[] = [];
  const onlyB = runB.enabledCapabilityIds.filter((id) => !runA.enabledCapabilityIds.includes(id));
  const onlyA = runA.enabledCapabilityIds.filter((id) => !runB.enabledCapabilityIds.includes(id));
  for (const step of diff.stepsResponsible) {
    const added = diff.entries.filter((e) => e.stepId === step.stepId && e.change === "added").length;
    const removed = diff.entries.filter((e) => e.stepId === step.stepId && e.change === "removed").length;
    const changed = diff.entries.filter((e) => e.stepId === step.stepId && e.change === "changed").length;
    const parts = [added ? `added ${added} line${added === 1 ? "" : "s"}` : "", removed ? `removed ${removed}` : "", changed ? `changed ${changed}` : ""].filter(Boolean).join(", ");
    const why = onlyB.includes(step.stepId) ? " because it only runs in Version B" : onlyA.includes(step.stepId) ? " because it only runs in Version A" : " because its input changed upstream";
    lines.push(`${step.name}${step.sourceSolutionName ? ` (from ${step.sourceSolutionName})` : ""} ${parts}${why}.`);
  }
  return lines;
}

export function buildComparison(c: Case, runA: Run, runB: Run, evaluation: Evaluation | null): ABComparison {
  const ctx = caseContext(c);
  const diff = enrichDiff(diffOutputs(runA.output, runB.output));
  const sample = runA.sampleInputId ? sampleInputById.get(runA.sampleInputId) : undefined;
  const expected = sample?.expected ?? null;
  const current = versionBCapabilities(c, ctx);
  const currentIds = executableSteps(current.active).map((cap) => cap.id);
  // jsonb does not preserve key order, so compare sorted entries.
  const sortedEntries = (o: Record<string, string>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const staleB = currentIds.join(",") !== runB.enabledCapabilityIds.join(",") || sortedEntries(current.configValues) !== sortedEntries(runB.configValues);
  return {
    caseId: c.id,
    sampleInputId: runA.sampleInputId,
    inputText: runA.inputText,
    inputHash: runA.inputHash,
    runA,
    runB,
    diff,
    scoreA: expected ? scoreAgainstExpected(runA.output, expected) : null,
    scoreB: expected ? scoreAgainstExpected(runB.output, expected) : null,
    explanation: explain(runA, runB, diff),
    evaluation,
    staleB,
  };
}

/** Run both versions on exactly the same input and persist both runs. */
export async function runComparison(c: Case, sampleInputId: string | undefined, inputText: string | undefined): Promise<{ runA: Run; runB: Run }> {
  const ctx = caseContext(c);
  const input = resolveInput(sampleInputId, inputText, ctx.base.id);
  const labels = versionLabels(c, ctx);
  const a = versionACapabilities(ctx);
  const b = versionBCapabilities(c, ctx);
  const runA = await insertRun(execute({ caseId: c.id, solution: ctx.base, version: "A", versionLabel: labels.a, active: a.active, configValues: a.configValues, sampleInputId: input.sampleInputId, text: input.text }));
  const runB = await insertRun(execute({ caseId: c.id, solution: ctx.base, version: "B", versionLabel: labels.b, active: b.active, configValues: b.configValues, sampleInputId: input.sampleInputId, text: input.text }));
  return { runA, runB };
}

/** Latest A/B pair per input hash for a case, newest first. */
export async function latestPairs(caseId: string): Promise<{ runA: Run; runB: Run }[]> {
  const runs = await listRunsForCase(caseId);
  const byHash = new Map<string, { runA?: Run; runB?: Run }>();
  for (const run of runs) {
    const entry = byHash.get(run.inputHash) ?? {};
    if (run.version === "A" && !entry.runA) entry.runA = run;
    if (run.version === "B" && !entry.runB) entry.runB = run;
    byHash.set(run.inputHash, entry);
  }
  return [...byHash.values()].filter((e): e is { runA: Run; runB: Run } => !!e.runA && !!e.runB);
}

export function solutionOr404(id: string): Solution {
  const s = getSolution(id);
  if (!s) throw new WorkbenchError("Solution not found", 404);
  return s;
}
