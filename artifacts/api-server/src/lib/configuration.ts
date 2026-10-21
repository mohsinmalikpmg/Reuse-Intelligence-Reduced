import type {
  Capability,
  Case,
  ComponentConfig,
  Configuration,
  FeatureState,
  Impact,
  ImpactDimension,
  Metrics,
  Solution,
  WorkflowStepConfig,
} from "@workspace/api-zod";
import { WORKFLOW_STEPS, capabilityKeywords, getCapability, getSolution, portableCapabilitiesFor, solutionCapabilities } from "../data/catalog";
import { tokenize } from "./matching";
import { isExecutable } from "../engine/steps";

export class ConfigurationError extends Error {}

/** Small, documented effects of choosing a non-default option on a configurable capability. */
const OPTION_EFFECTS: Record<string, Record<string, Partial<Metrics>>> = {
  "cap-summarize": {
    "Approved model: Compact LLM": { taskMinutes: 3, successRate: -2, costPerTask: -0.8 },
  },
  "cap-review-queue": {
    "Flag after 2 occurrences": { taskMinutes: 8, successRate: 3, errorRate: 2 },
    "Flag after 5 occurrences": { taskMinutes: -6, successRate: -4, errorRate: -1 },
  },
  "cap-notify": {
    Immediate: { effortScore: 0.4, adoption: -2 },
    "Weekly summary": { taskMinutes: -2, successRate: -1 },
  },
  "cap-routing": {
    "Route by equipment class": { errorRate: -1, successRate: 1 },
    "Central queue": { taskMinutes: 5, errorRate: 2, adoption: -3 },
  },
};

const EVIDENCE_WEIGHT: Record<Capability["evidenceLevel"], number> = {
  strong: 1,
  moderate: 0.7,
  limited: 0.4,
  none: 0.1,
};
const RISK_WEIGHT: Record<Capability["riskClass"], number> = { low: 1, medium: 2, high: 3 };

export interface CaseContext {
  base: Solution;
  candidates: Solution[];
  baseCapabilities: Capability[];
  /** Capabilities from candidate solutions, plus portable modules from elsewhere, that may be added as modules */
  candidateCapabilities: Capability[];
  /** Portable modules (source product addresses a different problem); recommended only when the need calls for them */
  portableIds: Set<string>;
  /** Plain-language needs behind the case (brief requirements); decides whether portable modules are recommended */
  needs: string[];
}

export function caseContext(c: Pick<Case, "baseSolutionId" | "candidateSolutionIds"> & { parentVersion?: string }, needs: string[] = []): CaseContext {
  // An experiment keeps comparing against the parent version it branched from, even after a successor is published.
  const base = getSolution(c.baseSolutionId, c.parentVersion || undefined);
  if (!base) throw new ConfigurationError(`Unknown base solution ${c.baseSolutionId}`);
  const candidates = c.candidateSolutionIds
    .map((id) => getSolution(id))
    .filter((s): s is Solution => !!s && s.id !== base.id);
  const baseCapabilities = solutionCapabilities(base);
  const baseIds = new Set(baseCapabilities.map((cap) => cap.id));
  const fromCandidates = candidates
    .flatMap((s) => solutionCapabilities(s))
    .filter((cap, index, arr) => !baseIds.has(cap.id) && arr.findIndex((o) => o.id === cap.id) === index);
  const seen = new Set(fromCandidates.map((cap) => cap.id));
  const portable = portableCapabilitiesFor(base.businessProblemIds).filter((cap) => !baseIds.has(cap.id) && !seen.has(cap.id));
  return {
    base,
    candidates,
    baseCapabilities,
    candidateCapabilities: [...fromCandidates, ...portable],
    portableIds: new Set(portable.map((cap) => cap.id)),
    needs,
  };
}

/** A portable module is recommended only when one of the case's needs uses the words the module is about. */
function needCallsFor(cap: Capability, needs: string[]): boolean {
  if (needs.length === 0) return false;
  const capTokens = new Set(tokenize([cap.name, ...(capabilityKeywords.get(cap.id) ?? [])].join(" ")));
  return needs.some((need) => {
    const t = tokenize(need);
    const hits = t.filter((x) => capTokens.has(x)).length;
    return hits >= 2 || (hits >= 1 && t.length <= 3);
  });
}

export function isUnsupported(cap: Capability): boolean {
  return /unsupported|no owner|none/i.test(cap.supportStatus);
}

/** A candidate capability conflicts with the base product when it is incompatible with a base capability. */
export function conflictingBaseCapability(cap: Capability, ctx: CaseContext): Capability | null {
  for (const baseCap of ctx.baseCapabilities) {
    if (cap.incompatibleWith.includes(baseCap.id) || baseCap.incompatibleWith.includes(cap.id)) return baseCap;
  }
  return null;
}

export function isRecommendedModule(cap: Capability, ctx: CaseContext): boolean {
  if (conflictingBaseCapability(cap, ctx)) return false;
  if (ctx.portableIds.has(cap.id) && !needCallsFor(cap, ctx.needs)) return false;
  if (isUnsupported(cap) && cap.evidenceLevel !== "moderate" && cap.evidenceLevel !== "strong") return false;
  return cap.evidenceLevel === "strong" || cap.evidenceLevel === "moderate";
}

/** Whether an optional capability is on in a product's production configuration: the published successor's choice, else its evidence. */
export function productionModuleOn(solution: Solution, cap: Capability): boolean {
  if (cap.controlType !== "optional") return true;
  const published = solution.production?.moduleStates[cap.id];
  if (published !== undefined) return published;
  return cap.evidenceLevel === "strong" || cap.evidenceLevel === "moderate";
}

/** The production value of a configurable capability: the published successor's choice, else the catalog default. */
export function productionConfigValue(solution: Solution, cap: Capability): string | undefined {
  if (cap.controlType !== "configurable") return undefined;
  return solution.production?.configValues[cap.id] ?? cap.defaultOption ?? undefined;
}

/** Module activation defaults: base optional modules follow production (published choice, else evidence); external modules follow the recommendation. */
export function defaultModuleStates(ctx: CaseContext): Record<string, boolean> {
  const states: Record<string, boolean> = {};
  for (const cap of ctx.baseCapabilities) {
    if (cap.controlType === "optional") states[cap.id] = productionModuleOn(ctx.base, cap);
  }
  for (const cap of ctx.candidateCapabilities) {
    states[cap.id] = isRecommendedModule(cap, ctx);
  }
  return states;
}

export function defaultConfigValues(ctx: CaseContext): Record<string, string> {
  const values: Record<string, string> = {};
  for (const cap of ctx.baseCapabilities) {
    const value = productionConfigValue(ctx.base, cap);
    if (value) values[cap.id] = value;
  }
  return values;
}

function isActive(cap: Capability, ctx: CaseContext, moduleStates: Record<string, boolean>): boolean {
  const isBase = ctx.baseCapabilities.some((b) => b.id === cap.id);
  if (isBase && cap.controlType !== "optional") return true;
  return moduleStates[cap.id] === true;
}

export function buildComponents(c: Case, ctx: CaseContext): ComponentConfig[] {
  const all = [...ctx.baseCapabilities, ...ctx.candidateCapabilities];
  const components: ComponentConfig[] = [];

  for (const cap of all) {
    const isBase = ctx.baseCapabilities.some((b) => b.id === cap.id);
    const active = isActive(cap, ctx, c.moduleStates);
    let state: FeatureState;
    let blockedReason: string | null = null;
    let recommended = false;

    if (isBase && cap.controlType === "locked") {
      state = "required";
    } else if (isBase && cap.controlType === "configurable") {
      state = "configurable";
    } else {
      const conflict = conflictingBaseCapability(cap, ctx);
      if (conflict) {
        state = "incompatible";
        blockedReason = `Conflicts with ${conflict.name} in ${ctx.base.name}. The base product's version is retained.`;
      } else if (isUnsupported(cap) && !isRecommendedModule(cap, ctx)) {
        state = "incompatible";
        blockedReason = `${cap.supportStatus}. Cannot be added without an owner and evidence.`;
      } else {
        recommended = !isBase && isRecommendedModule(cap, ctx);
        state = recommended ? "recommended" : "optional";
        const missing = cap.dependsOn
          .map((id) => getCapability(id))
          .filter((d): d is Capability => !!d)
          .filter((d) => !isActive(d, ctx, c.moduleStates));
        if (missing.length > 0 && !active) {
          blockedReason = `Requires ${missing.map((m) => m.name).join(", ")} to be active.`;
        }
      }
    }

    components.push({
      capability: cap,
      controlType: isBase ? cap.controlType : "optional",
      state,
      active: state === "incompatible" ? false : active,
      executable: isExecutable(cap.id),
      value: cap.controlType === "configurable" && isBase ? (c.configValues[cap.id] ?? productionConfigValue(ctx.base, cap) ?? null) : null,
      options: cap.controlType === "configurable" && isBase ? cap.options : null,
      recommended,
      blockedReason,
      sourceSolutionName: cap.sourceSolutionName,
    });
  }
  return components;
}

export function activeModules(c: Case, ctx: CaseContext): Capability[] {
  return buildComponents(c, ctx)
    .filter((comp) => comp.active && comp.controlType === "optional")
    .map((comp) => comp.capability);
}

export function addedExternalModules(c: Case, ctx: CaseContext): Capability[] {
  const baseIds = new Set(ctx.baseCapabilities.map((b) => b.id));
  return activeModules(c, ctx).filter((cap) => !baseIds.has(cap.id));
}

export function projectedMetrics(c: Case, ctx: CaseContext): Metrics {
  const m: Metrics = { ...ctx.base.baselineMetrics };
  const components = buildComponents(c, ctx);
  for (const comp of components) {
    if (comp.controlType === "optional" && comp.active) {
      addEffects(m, comp.capability.effects);
    }
    if (comp.controlType === "configurable" && comp.value && comp.value !== comp.capability.defaultOption) {
      const eff = OPTION_EFFECTS[comp.capability.id]?.[comp.value];
      if (eff) addEffects(m, eff);
    }
  }
  return clampMetrics(m);
}

export function addEffects(target: Metrics, effects: Partial<Metrics>, scale = 1): void {
  target.taskMinutes += (effects.taskMinutes ?? 0) * scale;
  target.successRate += (effects.successRate ?? 0) * scale;
  target.effortScore += (effects.effortScore ?? 0) * scale;
  target.errorRate += (effects.errorRate ?? 0) * scale;
  target.adoption += (effects.adoption ?? 0) * scale;
  target.costPerTask += (effects.costPerTask ?? 0) * scale;
}

export function clampMetrics(m: Metrics): Metrics {
  return {
    taskMinutes: round1(Math.max(1, m.taskMinutes)),
    successRate: round1(Math.min(99, Math.max(1, m.successRate))),
    effortScore: round1(Math.min(10, Math.max(1, m.effortScore))),
    errorRate: round1(Math.min(99, Math.max(0, m.errorRate))),
    adoption: round1(Math.min(100, Math.max(0, m.adoption))),
    costPerTask: round1(Math.max(0, m.costPerTask)),
  };
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function dim(score: number, label: string, note: string): ImpactDimension {
  return { score: Math.round(Math.min(100, Math.max(0, score))), label, note };
}

export function computeImpact(c: Case, ctx: CaseContext): Impact {
  const baseline = ctx.base.baselineMetrics;
  const projected = projectedMetrics(c, ctx);
  const added = addedExternalModules(c, ctx);
  const active = activeModules(c, ctx);

  const timeGain = (baseline.taskMinutes - projected.taskMinutes) / baseline.taskMinutes;
  const successGain = (projected.successRate - baseline.successRate) / 100;
  const errorGain = (baseline.errorRate - projected.errorRate) / 100;
  const valueScore = 50 + timeGain * 120 + successGain * 150 + errorGain * 100;
  const userValue = dim(
    valueScore,
    valueScore >= 60 ? "Higher" : valueScore >= 45 ? "Same" : "Lower",
    timeGain > 0.02
      ? `Task time ${Math.round(timeGain * 100)}% lower and success rate ${projected.successRate - baseline.successRate >= 0 ? "+" : ""}${round1(projected.successRate - baseline.successRate)} points versus today.`
      : "Little change in task time versus today.",
  );

  // Effort grows with the risk class of what is added; an unsupported source adds an ownership transfer.
  const effortPoints = added.reduce((sum, cap) => sum + RISK_WEIGHT[cap.riskClass] * 8 + (isUnsupported(cap) ? 6 : 0), 0);
  const effort = dim(
    10 + effortPoints,
    effortPoints <= 30 ? "Low" : effortPoints <= 55 ? "Moderate" : "High",
    added.length === 0
      ? "No modules added from other products; configuration only."
      : `${added.length} module${added.length === 1 ? "" : "s"} from ${new Set(added.map((a) => a.sourceSolutionName)).size} other product${new Set(added.map((a) => a.sourceSolutionName)).size === 1 ? "" : "s"} must be integrated and owned.`,
  );

  const riskPoints = active.reduce(
    (sum, cap) => sum + (cap.riskClass === "high" ? 25 : cap.riskClass === "medium" ? 10 : 3) + (isUnsupported(cap) ? 15 : 0) + (cap.evidenceLevel === "limited" || cap.evidenceLevel === "none" ? 8 : 0),
    0,
  );
  const risk = dim(
    riskPoints,
    riskPoints <= 45 ? "Controlled" : riskPoints <= 70 ? "Watch" : "High",
    riskPoints <= 45
      ? "All mandatory controls remain in place; added modules are low to medium risk."
      : "Added modules raise risk; review ownership and evidence before pilot.",
  );

  const dependencyGaps = active.filter((cap) => cap.dependsOn.some((d) => !(active.some((a) => a.id === d) || ctx.baseCapabilities.some((b) => b.id === d && b.controlType !== "optional"))));
  const compatScore = 100 - added.length * 6 - dependencyGaps.length * 25;
  const compatibility = dim(
    compatScore,
    compatScore >= 85 ? "Compatible" : compatScore >= 65 ? "Mostly compatible" : "Needs work",
    dependencyGaps.length > 0
      ? `${dependencyGaps.map((d) => d.name).join(", ")} missing a dependency.`
      : "No conflicts with locked controls; dependencies satisfied.",
  );

  const evidenceAvg = active.length === 0 ? 1 : active.reduce((s, cap) => s + EVIDENCE_WEIGHT[cap.evidenceLevel], 0) / active.length;
  const evidenceScore = evidenceAvg * 100;
  const evidenceConfidence = dim(
    evidenceScore,
    evidenceScore >= 80 ? "Strong" : evidenceScore >= 60 ? "Moderate" : "Limited",
    active.length === 0
      ? "Based on production evidence for the base product."
      : `Average evidence across ${active.length} active module${active.length === 1 ? "" : "s"}; weakest is ${active.reduce((w, cap) => (EVIDENCE_WEIGHT[cap.evidenceLevel] < EVIDENCE_WEIGHT[w.evidenceLevel] ? cap : w)).name}.`,
  );

  return { userValue, effort, risk, compatibility, evidenceConfidence, projected };
}

export function buildConfiguration(c: Case, ctx: CaseContext): Configuration {
  const components = buildComponents(c, ctx);
  const steps: WorkflowStepConfig[] = WORKFLOW_STEPS.map((name) => ({
    name,
    components: components.filter((comp) => comp.capability.workflowStep === name),
  }));
  const activeModuleCount = components.filter((comp) => comp.controlType === "optional" && comp.active).length;
  const lockedCount = components.filter((comp) => comp.state === "required").length;
  const added = addedExternalModules(c, ctx);
  const summary =
    added.length === 0
      ? `${ctx.base.name} v${ctx.base.currentVersion} with no modules added from other products.`
      : `${ctx.base.name} v${ctx.base.currentVersion} plus ${added.map((a) => `${a.name} (from ${a.sourceSolutionName})`).join(" and ")}. ${lockedCount} locked controls unchanged.`;
  const recommended = { moduleStates: defaultModuleStates(ctx), configValues: defaultConfigValues(ctx) };
  const isRecommended =
    Object.entries(recommended.moduleStates).every(([id, on]) => (c.moduleStates[id] ?? false) === on) &&
    Object.entries(recommended.configValues).every(([id, v]) => (c.configValues[id] ?? v) === v);
  return { caseId: c.id, summary, steps, impact: computeImpact(c, ctx), activeModuleCount, lockedCount, recommended, isRecommended };
}

/** Validates a configuration update against the governance rules and returns the new case fields. */
export function applyConfigurationUpdate(
  c: Case,
  ctx: CaseContext,
  update: { moduleStates?: Record<string, boolean>; configValues?: Record<string, string> },
): { moduleStates: Record<string, boolean>; configValues: Record<string, string> } {
  const moduleStates = { ...c.moduleStates };
  const configValues = { ...c.configValues };
  const components = buildComponents(c, ctx);
  const byId = new Map(components.map((comp) => [comp.capability.id, comp]));

  for (const [id, wanted] of Object.entries(update.moduleStates ?? {})) {
    const comp = byId.get(id);
    if (!comp) throw new ConfigurationError(`Unknown capability ${id} for this case.`);
    if (comp.state === "required") throw new ConfigurationError(`${comp.capability.name} is locked: ${comp.capability.lockedReason ?? "required by the base product."}`);
    if (comp.state === "configurable") throw new ConfigurationError(`${comp.capability.name} is always on; choose an option instead.`);
    if (comp.state === "incompatible") throw new ConfigurationError(comp.blockedReason ?? `${comp.capability.name} cannot be added.`);
    if (wanted) {
      const missing = comp.capability.dependsOn
        .map((d) => getCapability(d))
        .filter((d): d is Capability => !!d)
        .filter((d) => {
          const dep = byId.get(d.id);
          if (!dep) return true;
          if (dep.state === "required" || dep.state === "configurable") return false;
          return !(moduleStates[d.id] === true);
        });
      if (missing.length > 0) throw new ConfigurationError(`${comp.capability.name} requires ${missing.map((m) => m.name).join(", ")} to be active.`);
      moduleStates[id] = true;
    } else {
      moduleStates[id] = false;
      // Cascade: dependents cannot stay active without this module.
      for (const other of components) {
        if (other.capability.dependsOn.includes(id) && moduleStates[other.capability.id]) moduleStates[other.capability.id] = false;
      }
    }
  }

  for (const [id, value] of Object.entries(update.configValues ?? {})) {
    const comp = byId.get(id);
    if (!comp) throw new ConfigurationError(`Unknown capability ${id} for this case.`);
    if (comp.state !== "configurable") throw new ConfigurationError(`${comp.capability.name} has no configurable options.`);
    if (!comp.capability.options?.includes(value)) throw new ConfigurationError(`"${value}" is not an approved option for ${comp.capability.name}.`);
    configValues[id] = value;
  }

  return { moduleStates, configValues };
}
