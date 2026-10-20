import type {
  Case,
  Capability,
  Experiment,
  ExperimentMetric,
  ExperimentPlan,
  ExperimentRecommendation,
  Metrics,
  SegmentResult,
  SyntheticPersona,
} from "@workspace/api-zod";
import { syntheticPersonas } from "../data/catalog";
import {
  type CaseContext,
  activeModules,
  addedExternalModules,
  clampMetrics,
  isUnsupported,
  projectedMetrics,
  round1,
} from "./configuration";

export const SIMULATION_LABEL = "Simulated result based on synthetic users. Not a measured outcome.";
export const FIXED_SEED = 20261020;

/** Deterministic PRNG (mulberry32). Same seed, same numbers, every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seed depends only on the fixed seed and the configuration, so re-running the same case reproduces the result. */
export function seedFor(c: Case): number {
  const signature = JSON.stringify({
    base: c.baseSolutionId,
    modules: Object.entries(c.moduleStates).sort(),
    config: Object.entries(c.configValues).sort(),
  });
  // Kept within 31 bits so it fits a Postgres integer column.
  return (FIXED_SEED ^ fnv1a(signature)) & 0x7fffffff;
}

const METRIC_DEFS: { key: keyof Metrics; label: string; unit: string; betterWhen: "lower" | "higher"; primary: boolean }[] = [
  { key: "taskMinutes", label: "Task time", unit: "min", betterWhen: "lower", primary: true },
  { key: "successRate", label: "Success rate", unit: "%", betterWhen: "higher", primary: true },
  { key: "errorRate", label: "Exception rate", unit: "%", betterWhen: "lower", primary: true },
  { key: "effortScore", label: "User effort (1-10)", unit: "pts", betterWhen: "lower", primary: true },
  { key: "adoption", label: "Expected adoption", unit: "%", betterWhen: "higher", primary: false },
  { key: "costPerTask", label: "Cost per task", unit: "$", betterWhen: "lower", primary: false },
];

function personaBaseline(base: Metrics, p: SyntheticPersona): Metrics {
  const timeMultiplier = (1.45 - 0.55 * p.experience) * (0.8 + 0.4 * p.processComplexity) * (0.9 + 0.2 * (1 - p.dataQuality));
  return clampMetrics({
    taskMinutes: base.taskMinutes * timeMultiplier,
    successRate: base.successRate - (1 - p.experience) * 10 - (1 - p.dataQuality) * 12 - p.processComplexity * 6,
    effortScore: base.effortScore + (1 - p.experience) * 1.2 + p.processComplexity * 0.8,
    errorRate: base.errorRate + (1 - p.dataQuality) * 8 + p.processComplexity * 4,
    adoption: base.adoption + (p.experience - 0.5) * 10,
    costPerTask: base.costPerTask * (0.9 + 0.2 * p.processComplexity),
  });
}

function dataDependent(modules: Capability[]): boolean {
  return modules.some((m) => m.category === "Analysis" || m.category === "Summarization");
}

function personaProposed(
  baselineP: Metrics,
  base: Metrics,
  projected: Metrics,
  p: SyntheticPersona,
  modules: Capability[],
  rand: () => number,
): Metrics {
  // How much of the projected benefit this persona actually realizes.
  let realization = 0.55 + 0.45 * p.changeTolerance;
  if (dataDependent(modules)) realization *= 0.6 + 0.4 * p.dataQuality;
  realization *= 1 - 0.35 * Math.max(0, p.processComplexity - 0.7) * 2; // one-off failures benefit less from patterns
  const timeScale = baselineP.taskMinutes / base.taskMinutes;
  const noise = () => 1 + (rand() - 0.5) * 0.05;

  const out: Metrics = {
    taskMinutes: baselineP.taskMinutes + (projected.taskMinutes - base.taskMinutes) * timeScale * realization * noise(),
    successRate: baselineP.successRate + (projected.successRate - base.successRate) * realization * noise(),
    effortScore: baselineP.effortScore + (projected.effortScore - base.effortScore) * realization * noise(),
    errorRate: baselineP.errorRate + (projected.errorRate - base.errorRate) * realization * noise(),
    adoption: baselineP.adoption + (projected.adoption - base.adoption) * (0.4 + 0.6 * p.changeTolerance) * noise(),
    costPerTask: baselineP.costPerTask + (projected.costPerTask - base.costPerTask) * noise(),
  };
  // Change costs: low tolerance users pay a small learning overhead during the pilot.
  if (p.changeTolerance < 0.4 && modules.length > 0) {
    out.taskMinutes += baselineP.taskMinutes * 0.04;
    out.effortScore += 0.3;
  }
  return clampMetrics(out);
}

function weightedAverage(rows: { metrics: Metrics; weight: number }[]): Metrics {
  const total = rows.reduce((s, r) => s + r.weight, 0);
  const acc: Metrics = { taskMinutes: 0, successRate: 0, effortScore: 0, errorRate: 0, adoption: 0, costPerTask: 0 };
  for (const r of rows) {
    for (const def of METRIC_DEFS) acc[def.key] += (r.metrics[def.key] * r.weight) / total;
  }
  return clampMetrics(acc);
}

export function buildExperimentPlan(c: Case, ctx: CaseContext): ExperimentPlan {
  const added = addedExternalModules(c, ctx);
  const modules = activeModules(c, ctx);
  const keyRisks = riskList(modules, []);
  const largestUnit = ctx.base.businessUnits[0] ?? "Pilot group";
  return {
    caseId: c.id,
    baselineName: `${ctx.base.name} v${ctx.base.currentVersion} (current production)`,
    challengerName: proposedName(ctx, added),
    metrics: METRIC_DEFS.map((m) => m.label),
    cohort: syntheticPersonas,
    recommendedSample: Math.max(20, Math.round(ctx.base.activeUsers * 0.2)),
    durationWeeks: 4,
    keyRisks: keyRisks.length ? keyRisks : ["No material risks identified beyond normal change management."],
    summary:
      added.length === 0
        ? `Compares the current ${ctx.base.name} configuration against a configuration-only change using ${syntheticPersonas.length} synthetic user profiles.`
        : `Compares current ${ctx.base.name} against the proposed version with ${added.map((a) => a.name.toLowerCase()).join(" and ")} added, across ${syntheticPersonas.length} synthetic user profiles modelled on ${largestUnit}.`,
  };
}

export function proposedName(ctx: CaseContext, added: Capability[]): string {
  const next = bumpVersion(ctx.base.currentVersion);
  return added.length === 0
    ? `${ctx.base.name} v${next} (proposed configuration)`
    : `${ctx.base.name} v${next} + ${added.map((a) => a.name.toLowerCase()).join(" + ")} (proposed)`;
}

export function bumpVersion(v: string): string {
  const [major, minor] = v.split(".");
  const minorNum = Number(minor ?? "0");
  return `${major ?? "1"}.${Number.isNaN(minorNum) ? 1 : minorNum + 1}`;
}

function riskList(modules: Capability[], segments: SegmentResult[]): string[] {
  const risks: string[] = [];
  for (const m of modules) {
    if (isUnsupported(m)) risks.push(`${m.name} comes from an unowned prototype (${m.sourceSolutionName}). Operations Platforms must take ownership before pilot.`);
    if (m.evidenceLevel === "limited" || m.evidenceLevel === "none") risks.push(`${m.name} has ${m.evidenceLevel} evidence; treat its contribution as unproven.`);
    if (m.riskClass === "high") risks.push(`${m.name} is classed high risk and needs a control review.`);
  }
  for (const s of segments) if (s.flag) risks.push(`${s.persona.name}: ${s.flag}`);
  return risks;
}

export function runSimulation(c: Case, ctx: CaseContext, experimentId: string): Omit<Experiment, "createdAt"> {
  const seed = seedFor(c);
  const rand = mulberry32(seed);
  const base = ctx.base.baselineMetrics;
  const projected = projectedMetrics(c, ctx);
  const modules = activeModules(c, ctx);
  const added = addedExternalModules(c, ctx);
  const hasChanges = JSON.stringify(projected) !== JSON.stringify(clampMetrics({ ...base }));

  const perPersona = syntheticPersonas.map((p) => {
    const baselineP = personaBaseline(base, p);
    const proposedP = personaProposed(baselineP, base, projected, p, modules, rand);
    return { persona: p, baselineP, proposedP };
  });

  const baselineAgg = weightedAverage(perPersona.map((r) => ({ metrics: r.baselineP, weight: r.persona.volume })));
  const proposedAgg = weightedAverage(perPersona.map((r) => ({ metrics: r.proposedP, weight: r.persona.volume })));

  const metrics: ExperimentMetric[] = METRIC_DEFS.map((def) => {
    const b = baselineAgg[def.key];
    const pr = proposedAgg[def.key];
    const deltaPct = b === 0 ? 0 : round1(((pr - b) / b) * 100);
    const improved = def.betterWhen === "lower" ? pr < b - 0.05 : pr > b + 0.05;
    return { key: def.key, label: def.label, unit: def.unit, baseline: b, proposed: pr, deltaPct, betterWhen: def.betterWhen, primary: def.primary, improved };
  });

  const segments: SegmentResult[] = perPersona.map(({ persona, baselineP, proposedP }) => {
    const deltaPct = round1(((proposedP.taskMinutes - baselineP.taskMinutes) / baselineP.taskMinutes) * 100);
    let flag: string | null = null;
    if (!hasChanges) flag = null;
    else if (proposedP.successRate < baselineP.successRate - 0.5) flag = "Success rate falls for this group; keep them on the current version until the cause is understood.";
    else if (persona.dataQuality < 0.4 && dataDependent(modules)) flag = "Incomplete notes limit the benefit of pattern analysis; expect more manual checking.";
    else if (persona.processComplexity > 0.9) flag = "One-off failures rarely match a pattern; keep the manual exception path.";
    else if (deltaPct > -8) flag = "Gains are small for this group; expect a slower ramp and plan extra guidance.";
    return {
      persona,
      baselineTaskMinutes: baselineP.taskMinutes,
      proposedTaskMinutes: proposedP.taskMinutes,
      baselineSuccessRate: baselineP.successRate,
      proposedSuccessRate: proposedP.successRate,
      deltaPct,
      flag,
    };
  });

  const risks = riskList(modules, segments);
  const flaggedShare = segments.filter((s) => s.flag).length / segments.length;
  const evidenceWeight = { strong: 1, moderate: 0.7, limited: 0.4, none: 0.1 } as const;
  const evidenceAvg = added.length === 0 ? 0.9 : added.reduce((s, m) => s + evidenceWeight[m.evidenceLevel], 0) / added.length;
  const confidence = round2(Math.min(0.92, Math.max(0.2, 0.25 + evidenceAvg * 0.45 + (1 - flaggedShare) * 0.3)));

  const primary = metrics.filter((m) => m.primary);
  const improvedCount = primary.filter((m) => m.improved).length;
  const successMetric = metrics.find((m) => m.key === "successRate")!;
  let recommendation: ExperimentRecommendation;
  if (!hasChanges) recommendation = "do_not_proceed";
  else if (improvedCount >= 3 && successMetric.proposed >= successMetric.baseline && confidence >= 0.45) recommendation = "proceed_to_pilot";
  else if (improvedCount >= 2 && confidence < 0.45) recommendation = "gather_more_evidence";
  else if (improvedCount >= 2) recommendation = "revise_configuration";
  else recommendation = "do_not_proceed";

  const time = metrics.find((m) => m.key === "taskMinutes")!;
  const narrative = !hasChanges
    ? `The proposed configuration is identical to current production, so there is nothing to test. Add a module or change a setting before running the simulation.`
    : `Across ${syntheticPersonas.length} synthetic user profiles, the proposed version ${time.deltaPct < 0 ? "reduces" : "increases"} task time by ${Math.abs(time.deltaPct)}% (${time.baseline} to ${time.proposed} minutes) and ${successMetric.deltaPct >= 0 ? "raises" : "lowers"} the success rate from ${successMetric.baseline}% to ${successMetric.proposed}%. ${
        improvedCount
      } of ${primary.length} primary metrics improve. ${
        segments.filter((s) => s.flag).length > 0
          ? `${segments.filter((s) => s.flag).length} segment${segments.filter((s) => s.flag).length === 1 ? "" : "s"} need attention during the pilot.`
          : "No segment shows a regression."
      } ${recommendationText(recommendation)}`;

  return {
    id: experimentId,
    caseId: c.id,
    label: SIMULATION_LABEL,
    baselineName: `${ctx.base.name} v${ctx.base.currentVersion} (current production)`,
    challengerName: proposedName(ctx, added),
    seed,
    cohort: syntheticPersonas,
    metrics,
    segments,
    risks,
    confidence,
    recommendation,
    narrative,
  };
}

export function recommendationText(r: ExperimentRecommendation): string {
  switch (r) {
    case "proceed_to_pilot":
      return "Recommendation: proceed to a controlled pilot.";
    case "revise_configuration":
      return "Recommendation: revise the configuration before piloting.";
    case "gather_more_evidence":
      return "Recommendation: gather more evidence before deciding.";
    case "do_not_proceed":
      return "Recommendation: do not proceed with this configuration.";
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
