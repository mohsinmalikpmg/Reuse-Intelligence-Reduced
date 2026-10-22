/**
 * Model-inferred prototype decomposition and catalogue overlap, with exact-evidence caching.
 * Only the deterministic library run is execution evidence; submitted prototype outputs remain claims.
 */
import type { PrototypeAnalysis, PrototypeComparison, PrototypeComparisonLine, PrototypeComponent, PrototypeIntake, Run, Solution } from "@workspace/api-zod";
import { z } from "zod";
import { capabilities, getCapability, getSolution, solutions } from "../data/catalog";
import { freshContext, moduleBlockedReason } from "./configuration";
import { adHocRun, productionCapabilities } from "./workbench";
import { analyze } from "./ai-analysis";
import { groundingInstructions, provenanceLabel } from "./assessment-evidence";

export interface Section { exampleIndex: number; title: string; items: string[] }
interface Proposed { id: string; name: string; description: string; sections: Section[] }
const BULLET = /^\s*(?:[-*•▪◦]|\d+[.)]|[a-z][.)]|\[[ x]\])\s+/i;

function isHeading(raw: string, next: string | undefined): boolean {
  const line = raw.trim();
  if (!line || BULLET.test(line)) return false;
  if (/^#{1,4}\s+\S/.test(line) || /^\*\*[^*]{2,70}\*\*:?$/.test(line)) return true;
  if (line.length <= 70 && /:$/.test(line)) return true;
  if (line.length <= 48 && line === line.toUpperCase() && /[A-Z]/.test(line)) return true;
  return line.length <= 48 && !/[.!?;,]/.test(line) && line.split(/\s+/).length <= 6 && next !== undefined && /^[A-Z]/.test(line);
}

/** Formatting-only segmentation; the model performs semantic grouping and interpretation. */
export function splitSections(output: string, exampleIndex: number): Section[] {
  const lines = output.split(/\r?\n/).map(l => l.replace(/\s+$/, "")).filter(l => l.trim().length > 0);
  const sections: Section[] = [];
  let current: Section | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isHeading(line, lines[i + 1])) {
      current = { exampleIndex, title: line.trim().replace(/^#{1,4}\s+/, "").replace(/^\*\*|\*\*:?$/g, "").replace(/:$/, "").trim(), items: [] };
      sections.push(current);
      continue;
    }
    if (!current) { current = { exampleIndex, title: "Output", items: [] }; sections.push(current); }
    const text = line.replace(BULLET, "").replace(/^\*\*|\*\*$/g, "").trim();
    if (text) current.items.push(text);
  }
  return sections.filter(s => s.items.length > 0 || s.title !== "Output");
}

const TAG = /\b([A-Z]{1,3}-\d{2,4})\b/g;
const EQUIPMENT = /\b(pump|compressor|exchanger|vessel|separator|valve|motor|bearing|seal|turbine|boiler|tank)\b/i;
/** Deterministic input-compatibility gate, not semantic capability assessment. */
export function looksLikeWorkOrders(text: string): boolean {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  if (lines.filter(l => l.split("|").length >= 5).length >= 2) return true;
  const tagged = lines.filter(l => new RegExp(TAG.source).test(l) || EQUIPMENT.test(l)).length;
  return tagged >= 2 && tagged / lines.length >= 0.5;
}

function workOrderConsumer(): Solution | null {
  const live = solutions.filter(s => s.execution === "live" && !s.origin && s.status !== "deprecated"
    && productionCapabilities(s).active.some(c => c.id === "cap-wo-ingest" || c.id === "cap-csv-ingest"));
  return live.find(s => s.disposition?.kind === "retain" && s.disposition.preferred) ?? live.find(s => s.status === "certified") ?? live[0] ?? null;
}

function compareExample(exampleId: string, exampleIndex: number, run: Run, consumer: Solution, components: Proposed[]): PrototypeComparison {
  const real = run.output.sections.flatMap(s => s.items.map(it => ({
    text: it.text, stepId: it.stepId, stepName: getCapability(it.stepId)?.name ?? s.title, used: false,
  })));
  const lines: PrototypeComparisonLine[] = [];
  for (const comp of components) for (const section of comp.sections.filter(s => s.exampleIndex === exampleIndex)) for (const text of section.items) {
    // No semantic or lexical similarity can become an executed "reproduced" assertion.
    const match = real.find(line => !line.used && text.trim() === line.text.trim());
    if (match) match.used = true;
    lines.push({ key: `${exampleId}:${lines.length + 1}`, section: section.title, text, status: match ? "reproduced" : "not_produced",
      matchedText: match?.text ?? null, matchedStepId: match?.stepId ?? null, matchedStepName: match?.stepName ?? null, componentId: comp.id });
  }
  return { exampleId, solutionId: consumer.id, solutionName: consumer.name,
    submittedLabel: "Submitted example · not run by FUSEBOX", realLabel: `${consumer.name} v${consumer.currentVersion} · real run`,
    lines, reproduced: lines.filter(l => l.status === "reproduced").length, notProduced: lines.filter(l => l.status === "not_produced").length,
    onlyInReal: real.filter(r => !r.used).length, run };
}

function isAddableTo(capabilityId: string, target: Solution | null): boolean {
  if (!target || target.execution !== "live") return false;
  const cap = getCapability(capabilityId);
  if (!cap || target.capabilityIds.includes(cap.id)) return false;
  return moduleBlockedReason(cap, freshContext(target)) === null;
}

export async function analyzePrototype(intake: PrototypeIntake, options: { force?: boolean; analyzer?: typeof analyze } = {}): Promise<PrototypeAnalysis> {
  const sections = intake.examples.flatMap((ex, i) => splitSections(ex.output, i));
  const consumer = workOrderConsumer();
  const exampleIndex = consumer ? intake.examples.findIndex(ex => looksLikeWorkOrders(ex.input)) : -1;
  const run = consumer && exampleIndex >= 0 ? adHocRun(consumer, intake.examples[exampleIndex]!.input) : null;
  // Wall-clock/timing fields are not semantic evidence and must not invalidate an unchanged read.
  const runEvidence = run ? {
    solutionId: run.solutionId, versionLabel: run.versionLabel, inputHash: run.inputHash,
    enabledCapabilityIds: run.enabledCapabilityIds, configValues: run.configValues, configFingerprint: run.configFingerprint,
    output: run.output, errors: run.errors, trace: run.trace.map(({ durationMs: _timing, ...step }) => step),
  } : null;
  const library = capabilities.filter(c => !getSolution(c.sourceSolutionId)?.origin);
  const schema = z.object({
    components: z.array(z.object({
      id: z.string().min(1), name: z.string().min(1), description: z.string().min(1),
      sectionIndices: z.array(z.number().int().nonnegative()), capabilityId: z.string().nullable(),
      verdict: z.enum(["duplicates", "extends", "new"]), reason: z.string().min(1),
    }).strict()).min(1),
    recommendedPath: z.enum(["connect_module", "fold_into", "register_new"]),
    recommendation: z.string().min(1), targetSolutionId: z.string().nullable(), targetCapabilityId: z.string().nullable(),
  }).strict().superRefine((v, ctx) => {
    if (new Set(v.components.map(c => c.id)).size !== v.components.length) ctx.addIssue({ code: "custom", message: "Repeated component ID." });
    for (const c of v.components) {
      if (c.sectionIndices.some(i => !sections[i])) ctx.addIssue({ code: "custom", message: `Unknown, repeated or invalid section evidence ID in ${c.id}.` });
      if (c.capabilityId && !library.some(cap => cap.id === c.capabilityId)) ctx.addIssue({ code: "custom", message: `Unknown, repeated or invalid capability evidence ID: ${c.capabilityId}.` });
      if (c.verdict === "duplicates" && !c.capabilityId) ctx.addIssue({ code: "custom", message: "Duplicate overlap requires an identified catalogue capability." });
    }
    if (v.targetSolutionId && !solutions.some(s => s.id === v.targetSolutionId && !s.origin && s.status !== "deprecated")) ctx.addIssue({ code: "custom", message: `Unknown, repeated or invalid solution evidence ID: ${v.targetSolutionId}.` });
    if (v.targetCapabilityId && !library.some(c => c.id === v.targetCapabilityId)) ctx.addIssue({ code: "custom", message: `Unknown, repeated or invalid target evidence ID: ${v.targetCapabilityId}.` });
    if (v.recommendedPath !== "register_new" && !v.targetSolutionId) ctx.addIssue({ code: "custom", message: "A target is required." });
    if (v.recommendedPath === "connect_module" && v.targetCapabilityId && !isAddableTo(v.targetCapabilityId, getSolution(v.targetSolutionId ?? "") ?? null)) {
      ctx.addIssue({ code: "custom", message: `Proposed module ${v.targetCapabilityId} is not compatible with target ${v.targetSolutionId}.` });
    }
  });
  const result = await (options.analyzer ?? analyze)({
    purpose: "prototype-assessment", promptVersion: "prototype-evidence-v2", force: options.force, schema,
    instructions: `${groundingInstructions} Decompose submitted prototype outputs into coherent components, respecting confirmed components if supplied. Use zero-based sectionIndices, assign each section at most once. Match catalogue capabilities semantically. verdict MUST be exactly "duplicates" (plural; NOT "duplicate"), "extends", or "new". These verdicts describe inferred overlap, never executed prototype capability. A real library run is supplied only when input is compatible. Never call semantic similarity reproduced; server separately counts exact emitted lines. No numeric fit scores. Recommend fold_into only for substantial inferred duplication. connect_module may propose a capability request on a targetSolutionId with targetCapabilityId=null (clearly state integration remains unimplemented); a nonnull targetCapabilityId MUST occur in that solution's compatibleModules list, never a step already present. Otherwise register_new. Do NOT add any extra JSON keys; especially no limitations field. Put caveats in reason. Return exactly this JSON shape: {"components":[{"id":"c1","name":"...","description":"...","sectionIndices":[0],"capabilityId":null,"verdict":"new","reason":"..."}],"recommendedPath":"register_new","recommendation":"...","targetSolutionId":null,"targetCapabilityId":null}.`,
    input: { intake: { name: intake.name, platformKind: intake.platformKind, platformName: intake.platformName, users: intake.users,
      description: intake.description, examples: intake.examples, components: intake.components, dataInvolved: intake.dataInvolved, riskTier: intake.riskTier },
      sections: sections.map((section, index) => ({ index, ...section })), library, solutions: solutions.filter(s => !s.origin && s.status !== "deprecated"), realLibraryRun: runEvidence,
      compatibleModules: solutions.filter(s => !s.origin && s.status !== "deprecated").map(s => ({ solutionId: s.id, capabilityIds: library.filter(c => isAddableTo(c.id, s)).map(c => c.id) })) },
  });
  const proposed: Proposed[] = result.data.components.map(c => ({ id: c.id, name: c.name, description: c.description, sections: c.sectionIndices.map(i => sections[i]!) }));
  const comparison = consumer && run ? compareExample(`ex${exampleIndex + 1}`, exampleIndex, run, consumer, proposed) : null;
  const target = result.data.targetSolutionId ? getSolution(result.data.targetSolutionId) : undefined;
  return {
    components: result.data.components.map((c, i) => {
      const cap = c.capabilityId ? getCapability(c.capabilityId) : undefined;
      return { id: c.id, name: c.name, description: c.description, sectionTitles: [...new Set(proposed[i]!.sections.map(s => s.title))],
        matchedCapabilityId: cap?.id ?? null, matchedCapabilityName: cap?.name ?? null,
        matchedSolutionId: cap?.sourceSolutionId ?? null, matchedSolutionName: cap?.sourceSolutionName ?? null,
        matchScore: null, verdict: c.verdict, reason: `AI-inferred overlap, not prototype execution: ${c.reason}` };
    }),
    comparison, fallback: comparison ? null : "No existing product ran this input. Submitted outputs remain unverified claims.",
    recommendedPath: result.data.recommendedPath, recommendation: `${result.data.recommendation}${result.data.recommendedPath === "connect_module" && !result.data.targetCapabilityId ? " Proposed integration only: no executable module has been established; record a capability request." : ""} ${provenanceLabel(result.provenance)}`,
    basis: `${provenanceLabel(result.provenance)} Submitted prototype was not executed. ${comparison ? "Reproduced counts measure exact lines emitted by the deterministic library run only." : "No executed comparison available."}`,
    targetSolutionId: target?.id ?? null, targetSolutionName: target?.name ?? null, targetLive: target?.execution === "live", targetCapabilityId: result.data.targetCapabilityId,
  };
}

/** Reads use stored registration judgments, not new model calls. The comparison remains deterministic. */
export function registeredPrototypeAnalysis(intake: PrototypeIntake, stored: {
  components: PrototypeComponent[]; recommendedPath: string; recommendation: string; comparedSolutionId: string | null;
}): PrototypeAnalysis {
  const sections = intake.examples.flatMap((ex, i) => splitSections(ex.output, i));
  const assigned = new Set<Section>();
  const proposed = stored.components.map(c => {
    const supporting = sections.filter(s => c.sectionTitles.includes(s.title) && !assigned.has(s));
    supporting.forEach(s => assigned.add(s));
    return { id: c.id, name: c.name, description: c.description, sections: supporting };
  });
  const consumer = workOrderConsumer();
  const index = consumer ? intake.examples.findIndex(ex => looksLikeWorkOrders(ex.input)) : -1;
  const comparison = consumer && index >= 0 ? compareExample(`ex${index + 1}`, index, adHocRun(consumer, intake.examples[index]!.input), consumer, proposed) : null;
  const target = stored.comparedSolutionId ? getSolution(stored.comparedSolutionId) : undefined;
  return { components: stored.components, comparison,
    fallback: comparison ? null : "No library product ran this input. Submitted output is unverified.",
    recommendedPath: stored.recommendedPath as PrototypeAnalysis["recommendedPath"], recommendation: stored.recommendation,
    basis: `${stored.recommendation.includes("AI assessment ·") ? "Recorded AI registration assessment; provenance is in the recommendation." : "Legacy stored assessment; not model-analyzed. Submit an analysis to obtain a new AI judgment."} This is not a fresh analysis. Submitted prototype was never executed; exact library-output comparison is deterministic.`,
    targetSolutionId: target?.id ?? null, targetSolutionName: target?.name ?? null, targetLive: target?.execution === "live", targetCapabilityId: null };
}
