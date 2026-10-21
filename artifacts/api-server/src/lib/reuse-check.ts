/**
 * Reuse-fit scoring: given a plain-language need, score existing capabilities, approved configurations and
 * active experiments on one 0-100 scale, apply hard exclusions, and recommend a path.
 *
 * Weights (published in the assessment): problem fit 30, input/output 20, workflow position 15,
 * user context 10, data/control 15, maturity/evidence 10.
 * Paths: >= 80 try existing, 60-79 start from and improve, < 60 a new experiment is allowed; a hard exclusion
 * overrides the score.
 *
 * Everything here is deterministic. No model produces a number.
 */
import type { Capability, Case, ReuseFitDimensions, ReuseOption, ReusePath, Solution } from "@workspace/api-zod";
import {
  WORKFLOW_STEPS,
  capabilities,
  capabilityIO,
  capabilityKeywords,
  getCapability,
  getSolution,
  solutionCapabilities,
  solutionSearchMeta,
  solutions,
} from "../data/catalog";
import { type CaseContext, caseContext, conflictingBaseCapability, isUnsupported } from "./configuration";

export const WEIGHTS = { problemFit: 30, inputOutput: 20, workflowPosition: 15, userContext: 10, dataControl: 15, maturityEvidence: 10 } as const;
export const TRY_EXISTING_AT = 80;
export const IMPROVE_AT = 60;

export interface ReuseContextInput {
  base?: Solution | null;
  /** Open cases that count as active experiments */
  experiments?: Case[];
  workflowStep?: string | null;
}

export interface ReuseCheckOutcome {
  options: ReuseOption[];
  best: ReuseOption | null;
  recommendedPath: ReusePath;
  surfaced: boolean;
}

// ---------- text ----------

const STOP = new Set(
  "the a an and or of to in on for with by from at is are be been it its this that these those we our they their as into than then there here use uses using each may might can could should would will need needs want wants so any all some more most across when which who what where apply applies make makes get gets have has provide provides ensure allow allows enable enables support keep put set take give before after becomes become every one way".split(
    " ",
  ),
);

/** Normalise words so that "issues" and "issue", "flags" and "flag" compare equal. Conservative on purpose. */
export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map(normalise);
}

function normalise(t: string): string {
  if (t.endsWith("ies") && t.length > 4) return `${t.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(t)) return t;
  if (/(ches|shes|xes|zes|sses)$/.test(t)) return t.slice(0, -2);
  if (t.endsWith("s") && t.length > 3) return t.slice(0, -1);
  return t;
}

function roleWords(text: string): string[] {
  const lower = text.toLowerCase();
  return ["supervisor", "engineer", "planner", "technician", "operator", "analyst", "safety lead", "reviewer", "manager", "leadership", "inspector"].filter((r) => lower.includes(r));
}

// ---------- corpus ----------

interface Doc {
  kind: "capability" | "configuration";
  id: string;
  tokens: Set<string>;
}

function capabilityTokens(cap: Capability): Set<string> {
  const io = capabilityIO.get(cap.id);
  return new Set(terms([cap.name, cap.description, ...(capabilityKeywords.get(cap.id) ?? []), ...(io?.produces ?? [])].join(" ")));
}

function solutionTokens(s: Solution): Set<string> {
  const meta = solutionSearchMeta.get(s.id);
  const caps = solutionCapabilities(s).map((c) => c.name);
  return new Set(terms([s.name, s.outcome, s.description, ...(meta?.keywords ?? []), ...caps].join(" ")));
}

const DOCS: Doc[] = [
  ...capabilities.map((c) => ({ kind: "capability" as const, id: c.id, tokens: capabilityTokens(c) })),
  ...solutions.map((s) => ({ kind: "configuration" as const, id: s.id, tokens: solutionTokens(s) })),
];
const DF = new Map<string, number>();
for (const d of DOCS) for (const t of d.tokens) DF.set(t, (DF.get(t) ?? 0) + 1);

/**
 * Problem fit = weighted share of the need's words that the candidate speaks about. Words that appear in many
 * catalogue entries ("issue", "maintenance") count less than distinctive ones ("safety", "cluster"). Words the
 * catalogue has never seen are ignored rather than penalised.
 */
function problemFit(needTokens: string[], candidate: Set<string>): { fit: number; matched: string[] } {
  let total = 0;
  let hit = 0;
  const matched: string[] = [];
  for (const t of new Set(needTokens)) {
    const df = DF.get(t);
    if (!df) continue;
    const w = 1 / df;
    total += w;
    if (candidate.has(t)) {
      hit += w;
      matched.push(t);
    }
  }
  if (total === 0) return { fit: 0, matched };
  // One shared word is coincidence unless the need is only a word or two long.
  const known = needTokens.filter((t) => DF.has(t)).length;
  if (matched.length < 2 && known > 2) return { fit: 0, matched };
  return { fit: Math.min(1, hit / total), matched: matched.sort((a, b) => (DF.get(a) ?? 0) - (DF.get(b) ?? 0)) };
}

// ---------- workflow ----------

const STEP_WORDS: Record<string, string[]> = {
  Ingest: ["ingest", "pull", "import", "collect", "upload", "read", "load"],
  Analyze: ["analy", "identify", "detect", "find", "summar", "cluster", "pattern", "recurr", "flag", "spot", "classif", "group"],
  Review: ["review", "check", "queue", "triage", "escalat", "notif", "alert"],
  Decide: ["approv", "decide", "decision", "assign", "route", "prioriti"],
  Track: ["track", "follow", "close", "action", "report", "monit", "digest", "trend"],
};

export function inferWorkflowSteps(text: string): string[] {
  const lower = text.toLowerCase();
  return Object.entries(STEP_WORDS).filter(([, words]) => words.some((w) => lower.includes(w))).map(([step]) => step);
}

function stepDistance(a: string, b: string): number {
  const ia = WORKFLOW_STEPS.indexOf(a as (typeof WORKFLOW_STEPS)[number]);
  const ib = WORKFLOW_STEPS.indexOf(b as (typeof WORKFLOW_STEPS)[number]);
  if (ia < 0 || ib < 0) return 2;
  return Math.abs(ia - ib);
}

function workflowPosition(capStep: string, wanted: string[]): number {
  if (wanted.length === 0) return 0.7;
  const best = Math.min(...wanted.map((w) => stepDistance(capStep, w)));
  return best === 0 ? 1 : best === 1 ? 0.7 : 0.4;
}

// ---------- helpers ----------

const EVIDENCE: Record<Capability["evidenceLevel"], number> = { strong: 1, moderate: 0.7, limited: 0.4, none: 0.1 };
const STATUS: Record<Solution["status"], number> = { certified: 1, pilot: 0.7, experimental: 0.35, deprecated: 0 };
const CASE_MATURITY: Record<string, number> = { draft: 0.3, tested: 0.5, pilot_proposed: 0.6, approved: 0.8, changes_requested: 0.4, deferred: 0.2, rejected: 0 };

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / Math.min(a.size, b.size);
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function pathFor(score: number, excluded: boolean): ReusePath {
  if (excluded) return "hard_exclusion";
  if (score >= TRY_EXISTING_AT) return "try_existing";
  if (score >= IMPROVE_AT) return "improve_existing";
  return "new_experiment";
}

function total(d: { problemFit: number; inputOutput: number; workflowPosition: number; userContext: number; dataControl: number; maturityEvidence: number }): number {
  // Problem fit always counts. The other dimensions count in proportion to relevance, so a mature, well-connected
  // step for a different problem cannot outscore the step that is actually about the need.
  const relevance = Math.min(1, d.problemFit / 0.5);
  return (
    d.problemFit * WEIGHTS.problemFit +
    relevance * (d.inputOutput * WEIGHTS.inputOutput + d.workflowPosition * WEIGHTS.workflowPosition + d.userContext * WEIGHTS.userContext + d.dataControl * WEIGHTS.dataControl + d.maturityEvidence * WEIGHTS.maturityEvidence)
  );
}

function dims(d: { problemFit: number; inputOutput: number; workflowPosition: number; userContext: number; dataControl: number; maturityEvidence: number }): ReuseFitDimensions {
  return {
    problemFit: round(d.problemFit * 100),
    inputOutput: round(d.inputOutput * 100),
    workflowPosition: round(d.workflowPosition * 100),
    userContext: round(d.userContext * 100),
    dataControl: round(d.dataControl * 100),
    maturityEvidence: round(d.maturityEvidence * 100),
  };
}

function baseProduces(ctx: CaseContext | null): Set<string> {
  if (!ctx) return new Set();
  const meta = solutionSearchMeta.get(ctx.base.id);
  const words = [...(meta?.dataSources ?? [])];
  for (const cap of ctx.baseCapabilities) words.push(...(capabilityIO.get(cap.id)?.produces ?? []));
  return new Set(terms(words.join(" ")));
}

function baseConsumes(ctx: CaseContext | null): Set<string> {
  if (!ctx) return new Set();
  const words: string[] = [];
  for (const cap of ctx.baseCapabilities) words.push(...(capabilityIO.get(cap.id)?.consumes ?? []));
  return new Set(terms(words.join(" ")));
}

// ---------- scoring: capability ----------

export interface ScoredCapability {
  capability: Capability;
  source: Solution | undefined;
  score: number;
  dimensions: ReuseFitDimensions;
  reasons: string[];
  exclusions: string[];
  inBase: boolean;
  addable: boolean;
}

export function scoreCapability(need: string, cap: Capability, ctx: CaseContext | null, wantedSteps: string[]): ScoredCapability {
  const needTokens = terms(need);
  const source = getSolution(cap.sourceSolutionId);
  const io = capabilityIO.get(cap.id) ?? { consumes: [], produces: [] };
  const reasons: string[] = [];
  const exclusions: string[] = [];

  // 1. Problem fit
  const pf = problemFit(needTokens, capabilityTokens(cap));
  if (pf.fit >= 0.6) reasons.push(`Is about the same thing: ${pf.matched.slice(0, 3).join(", ")}.`);
  else if (pf.fit >= 0.3) reasons.push(`Overlaps with part of the need (${pf.matched.slice(0, 3).join(", ")}).`);

  // 2. Input / output
  const consumes = new Set(terms(io.consumes.join(" ")));
  const produces = new Set(terms(io.produces.join(" ")));
  let inputOutput: number;
  const inBase = !!ctx && ctx.baseCapabilities.some((b) => b.id === cap.id);
  if (ctx && !inBase) {
    const available = baseProduces(ctx);
    const inputOk = consumes.size === 0 ? 0.5 : overlapRatio(consumes, available);
    const wanted = baseConsumes(ctx);
    const needWantsOutput = overlapRatio(produces, new Set(needTokens));
    const outputOk = Math.max(needWantsOutput > 0 ? 1 : 0, produces.size === 0 ? 0.5 : overlapRatio(produces, wanted));
    inputOutput = Math.min(1, inputOk * 0.6 + outputOk * 0.4);
    if (consumes.size > 0 && inputOk === 0) {
      exclusions.push(`Cannot read what ${ctx.base.name} produces: it needs ${io.consumes.slice(0, 2).join(" or ")}.`);
    } else if (inputOk >= 0.5) {
      reasons.push(`Reads ${io.consumes[0] ?? "the same data"}, which ${ctx.base.name} already has.`);
    }
    if (needWantsOutput > 0) reasons.push(`Produces ${io.produces[0]}, which is what the need asks for.`);
  } else {
    const ioTokens = new Set([...consumes, ...produces]);
    inputOutput = Math.min(1, 0.5 + overlapRatio(new Set(needTokens), ioTokens));
    if (inBase && ctx) reasons.push(`Already part of ${ctx.base.name}.`);
  }

  // 3. Workflow position
  const workflowPos = workflowPosition(cap.workflowStep, wantedSteps);
  if (workflowPos === 1) reasons.push(`Sits in the ${cap.workflowStep} step, where this is needed.`);
  else if (workflowPos >= 0.7 && wantedSteps.length) reasons.push(`Sits in the ${cap.workflowStep} step, next to where this is needed.`);

  // 4. User context
  const roles = roleWords(need);
  const sourceMeta = solutionSearchMeta.get(cap.sourceSolutionId);
  const sourceUsers = new Set(terms((sourceMeta?.intendedUsers ?? []).join(" ")));
  let userContext: number;
  if (roles.length > 0) {
    userContext = Math.min(1, overlapRatio(new Set(terms(roles.join(" "))), sourceUsers) * 1.5 + 0.2);
  } else if (ctx && !inBase) {
    const baseUsers = new Set(terms((solutionSearchMeta.get(ctx.base.id)?.intendedUsers ?? []).join(" ")));
    userContext = 0.5 + 0.5 * Math.min(1, overlapRatio(baseUsers, sourceUsers) * 2);
  } else {
    userContext = inBase ? 1 : 0.6;
  }
  if (userContext >= 0.7 && source && !inBase) reasons.push(`Built for ${(sourceMeta?.intendedUsers ?? []).slice(0, 2).join(" and ")}.`);

  // 5. Data and control
  let dataControl = 1;
  if (ctx && !inBase) {
    const conflict = conflictingBaseCapability(cap, ctx);
    if (conflict) {
      exclusions.push(`Control conflict: incompatible with ${conflict.name} in ${ctx.base.name}.`);
      dataControl -= 0.5;
    }
    const addableIds = new Set([...ctx.baseCapabilities, ...ctx.candidateCapabilities].map((c) => c.id));
    const missing = cap.dependsOn.map((id) => getCapability(id)).filter((d): d is Capability => !!d && !addableIds.has(d.id));
    if (missing.length) {
      exclusions.push(`Missing data: needs ${missing.map((m) => m.name).join(", ")}, which ${ctx.base.name} cannot provide.`);
      dataControl -= 0.4;
    }
  }
  if (isUnsupported(cap)) {
    dataControl -= 0.4;
    reasons.push(`${cap.supportStatus}: no owner to keep it working.`);
  }
  if (cap.riskClass === "high") dataControl -= 0.2;
  else if (cap.riskClass === "medium") dataControl -= 0.1;
  dataControl = Math.max(0, dataControl);
  if (dataControl >= 0.85 && exclusions.length === 0) reasons.push(`${cap.supportStatus}, ${cap.riskClass} risk, no control conflicts.`);

  // 6. Maturity and evidence
  const maturityEvidence = EVIDENCE[cap.evidenceLevel] * 0.6 + (source ? STATUS[source.status] : 0.3) * 0.4;
  if (source?.status === "deprecated") exclusions.push(`${source.name} is deprecated.`);
  if (source) reasons.push(`${capitalize(source.status)} in ${source.name} with ${cap.evidenceLevel} evidence.`);

  const d = { problemFit: pf.fit, inputOutput, workflowPosition: workflowPos, userContext, dataControl, maturityEvidence };
  const score = round(total(d));
  const addable = !!ctx && !inBase && ctx.candidateCapabilities.some((c) => c.id === cap.id) && exclusions.length === 0;
  return { capability: cap, source, score, dimensions: dims(d), reasons: reasons.slice(0, 4), exclusions, inBase, addable };
}

// ---------- scoring: configuration (a solution as it ships) ----------

interface ScoredSolution {
  solution: Solution;
  score: number;
  dimensions: ReuseFitDimensions;
  reasons: string[];
  exclusions: string[];
}

function scoreSolution(need: string, s: Solution, wantedSteps: string[]): ScoredSolution {
  const needTokens = terms(need);
  const meta = solutionSearchMeta.get(s.id);
  const reasons: string[] = [];
  const exclusions: string[] = [];
  const pf = problemFit(needTokens, solutionTokens(s));
  if (pf.fit >= 0.6) reasons.push(`Addresses the same need: ${s.outcome}`);
  else if (pf.fit >= 0.3) reasons.push(`Overlaps with part of the need (${pf.matched.slice(0, 3).join(", ")}).`);

  const dataTokens = new Set(terms((meta?.dataSources ?? []).join(" ")));
  const inputOutput = Math.min(1, 0.5 + overlapRatio(new Set(needTokens), dataTokens));

  const covered = wantedSteps.filter((w) => s.workflowSteps.includes(w)).length;
  const workflowPos = wantedSteps.length === 0 ? 0.7 : covered / wantedSteps.length;
  if (workflowPos === 1 && wantedSteps.length) reasons.push(`Covers the ${wantedSteps.join(" and ")} step${wantedSteps.length > 1 ? "s" : ""} the need implies.`);

  const roles = roleWords(need);
  const users = new Set(terms((meta?.intendedUsers ?? []).join(" ")));
  const userContext = roles.length ? Math.min(1, overlapRatio(new Set(terms(roles.join(" "))), users) * 1.5 + 0.2) : 0.6;

  let dataControl = 1;
  if (/missing|no /i.test(s.controlStatus)) dataControl -= 0.4;
  if (/deviation|unsupported/i.test(s.architectureStatus)) dataControl -= 0.2;
  if (s.retirementCandidate) dataControl -= 0.2;
  dataControl = Math.max(0, dataControl);
  if (dataControl >= 0.9) reasons.push(`${s.controlStatus}.`);
  else reasons.push(`${s.controlStatus}.`);

  const maturityEvidence = EVIDENCE[s.evidenceLevel] * 0.5 + STATUS[s.status] * 0.5;
  if (s.status === "deprecated") exclusions.push(`${s.name} is deprecated.`);
  if (s.retirementCandidate && /^none$/i.test(s.supportModel)) exclusions.push(`${s.name} has no owner and no mandatory controls, and is marked for retirement.`);
  reasons.push(`${capitalize(s.status)}, ${s.activeUsers} users, ${s.evidenceLevel} evidence.`);

  const d = { problemFit: pf.fit, inputOutput, workflowPosition: workflowPos, userContext, dataControl, maturityEvidence };
  return { solution: s, score: round(total(d)), dimensions: dims(d), reasons: reasons.slice(0, 4), exclusions };
}

// ---------- scoring: active experiment (an open case) ----------

interface ScoredExperiment {
  experiment: Case;
  base: Solution;
  score: number;
  dimensions: ReuseFitDimensions;
  reasons: string[];
}

function scoreExperiment(need: string, c: Case, wantedSteps: string[]): ScoredExperiment | null {
  const base = getSolution(c.baseSolutionId);
  if (!base) return null;
  const added = Object.entries(c.moduleStates)
    .filter(([, on]) => on)
    .map(([id]) => getCapability(id))
    .filter((cap): cap is Capability => !!cap && !base.capabilityIds.includes(cap.id));
  const tokens = new Set([...terms(c.title), ...solutionTokens(base), ...added.flatMap((cap) => [...capabilityTokens(cap)])]);
  const needTokens = terms(need);
  const pf = problemFit(needTokens, tokens);
  const reasons: string[] = [];
  if (pf.fit >= 0.6) reasons.push(`An open experiment already about this: "${c.title}".`);
  else if (pf.fit >= 0.3) reasons.push(`Open experiment "${c.title}" overlaps with the need.`);
  if (added.length) reasons.push(`Adds ${added.map((a) => a.name).join(", ")} to ${base.name}.`);
  const steps = new Set([...base.workflowSteps, ...added.map((a) => a.workflowStep)]);
  const covered = wantedSteps.filter((w) => steps.has(w)).length;
  const workflowPos = wantedSteps.length === 0 ? 0.7 : covered / wantedSteps.length;
  const maturityEvidence = CASE_MATURITY[c.status] ?? 0.3;
  reasons.push(`Status: ${c.status.replace("_", " ")}; not yet evidence of its own.`);
  const d = { problemFit: pf.fit, inputOutput: 0.6, workflowPosition: workflowPos, userContext: 0.6, dataControl: 0.8, maturityEvidence };
  return { experiment: c, base, score: round(total(d)), dimensions: dims(d), reasons: reasons.slice(0, 4) };
}

// ---------- the check ----------

export function reuseCheck(need: string, input: ReuseContextInput): ReuseCheckOutcome {
  const base = input.base ?? null;
  const ctx = base ? caseContext({ baseSolutionId: base.id, candidateSolutionIds: candidateIdsFor(base) }, [need]) : null;
  const wantedSteps = input.workflowStep ? [input.workflowStep] : inferWorkflowSteps(need);

  const caps = capabilities.map((cap) => scoreCapability(need, cap, ctx, wantedSteps)).sort((a, b) => b.score - a.score);
  const viable = caps.filter((c) => c.exclusions.length === 0 && c.dimensions.problemFit > 0);
  const topExcluded = caps.find((c) => c.exclusions.length > 0 && c.dimensions.problemFit > 0);
  // Show the best usable step. When the only strong match is ruled out by a hard exclusion, show that instead so
  // the person learns it exists and why it cannot be used here.
  const bestCap =
    viable[0] && viable[0].score >= IMPROVE_AT ? viable[0] : topExcluded && topExcluded.score >= IMPROVE_AT ? topExcluded : (viable[0] ?? topExcluded ?? null);

  const configs = solutions
    .filter((s) => !base || s.id !== base.id)
    .map((s) => scoreSolution(need, s, wantedSteps))
    .filter((s) => s.dimensions.problemFit > 0)
    .sort((a, b) => b.score - a.score);
  const experiments = (input.experiments ?? [])
    .map((c) => scoreExperiment(need, c, wantedSteps))
    .filter((e): e is ScoredExperiment => !!e && e.dimensions.problemFit > 0)
    .sort((a, b) => b.score - a.score);

  const options: ReuseOption[] = [];
  if (bestCap) options.push(capabilityOption(bestCap, ctx));

  const viableConfig = configs.find((c) => c.exclusions.length === 0);
  const topConfig = viableConfig && viableConfig.score >= IMPROVE_AT ? viableConfig : (configs[0] && configs[0].score >= IMPROVE_AT ? configs[0] : viableConfig ?? configs[0]);
  const topExp = experiments[0];
  if (topExp && (!topConfig || topExp.score >= topConfig.score)) options.push(experimentOption(topExp));
  else if (topConfig) options.push(configurationOption(topConfig));

  const scoredOptions = options.filter((o) => o.score !== null && o.path !== "hard_exclusion");
  const best = scoredOptions.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null;
  const recommendedPath: ReusePath = best ? best.path : "new_experiment";
  const surfaced = !!best && (best.score ?? 0) >= IMPROVE_AT;

  options.push({
    kind: "create",
    title: "Create a different approach",
    subtitle: best && (best.score ?? 0) >= IMPROVE_AT ? `Only if ${best.title} turns out not to fit after trying it.` : "Nothing existing scores 60 or more, so a new experiment is allowed.",
    score: null,
    path: "new_experiment",
    reasons: best && (best.score ?? 0) >= IMPROVE_AT ? [`${best.title} scores ${best.score}, so try or improve it first.`] : ["No existing step, product or experiment is about this need."],
    exclusions: [],
    dimensions: null,
    capability: null,
    solutionId: null,
    solutionName: null,
    caseId: null,
    addableTo: null,
  });

  return { options: options.slice(0, 3), best, recommendedPath, surfaced };
}

/** Same rule as case creation: sibling products addressing the base's business problem. */
function candidateIdsFor(base: Solution): string[] {
  return solutions
    .filter((s) => s.id !== base.id && s.businessProblemIds.some((bp) => base.businessProblemIds.includes(bp)) && s.status !== "deprecated")
    .map((s) => s.id);
}

function capabilityOption(c: ScoredCapability, ctx: CaseContext | null): ReuseOption {
  const excluded = c.exclusions.length > 0;
  const where = c.inBase && ctx ? `Already in ${ctx.base.name}` : `From ${c.source?.name ?? c.capability.sourceSolutionName} · ${c.capability.ownerName}`;
  return {
    kind: "capability",
    title: c.capability.name,
    subtitle: where,
    score: c.score,
    path: pathFor(c.score, excluded),
    reasons: c.reasons,
    exclusions: c.exclusions,
    dimensions: c.dimensions,
    capability: c.capability,
    solutionId: c.capability.sourceSolutionId,
    solutionName: c.source?.name ?? c.capability.sourceSolutionName,
    caseId: null,
    // A base without an execution engine cannot show the difference, so nothing is offered for addition to it.
    addableTo: c.addable && ctx && ctx.base.execution === "live" ? ctx.base.id : null,
  };
}

function configurationOption(s: ScoredSolution): ReuseOption {
  const excluded = s.exclusions.length > 0;
  return {
    kind: "configuration",
    title: s.solution.name,
    subtitle: `${capitalize(s.solution.status)} v${s.solution.currentVersion} · ${s.solution.ownerName}`,
    score: s.score,
    path: pathFor(s.score, excluded),
    reasons: s.reasons,
    exclusions: s.exclusions,
    dimensions: s.dimensions,
    capability: null,
    solutionId: s.solution.id,
    solutionName: s.solution.name,
    caseId: null,
    addableTo: null,
  };
}

function experimentOption(e: ScoredExperiment): ReuseOption {
  return {
    kind: "experiment",
    title: e.experiment.title,
    subtitle: `Open experiment on ${e.base.name}`,
    score: e.score,
    path: pathFor(e.score, false),
    reasons: e.reasons,
    exclusions: [],
    dimensions: e.dimensions,
    capability: null,
    solutionId: e.base.id,
    solutionName: e.base.name,
    caseId: e.experiment.id,
    addableTo: null,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- requirement coverage (Discover) ----------

export type CoverageRow = {
  requirementId: string;
  text: string;
  status: "covered" | "covered_reusable" | "uncovered";
  coveredBy: string | null;
  capabilityId: string | null;
  capabilityName: string | null;
  score: number | null;
};

/**
 * Coverage of each requirement by the recommended product: its own steps count as covered; a usable module from a
 * sibling product (same business problem) counts as covered by a reusable capability; anything else is uncovered
 * and gets checked against the whole catalogue only when the person asks.
 */
export function coverageFor(requirements: { id: string; text: string }[], recommended: Solution | null): CoverageRow[] {
  if (!recommended) {
    return requirements.map((r) => ({ requirementId: r.id, text: r.text, status: "uncovered", coveredBy: null, capabilityId: null, capabilityName: null, score: null }));
  }
  const ctx = caseContext({ baseSolutionId: recommended.id, candidateSolutionIds: candidateIdsFor(recommended) }, []);
  return requirements.map((r) => {
    const wanted = inferWorkflowSteps(r.text);
    const scored = capabilities
      .map((cap) => scoreCapability(r.text, cap, ctx, wanted))
      .filter((c) => c.exclusions.length === 0 && c.score >= IMPROVE_AT && (c.inBase || (c.addable && !ctx.portableIds.has(c.capability.id))))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) return { requirementId: r.id, text: r.text, status: "uncovered", coveredBy: null, capabilityId: null, capabilityName: null, score: null };
    return {
      requirementId: r.id,
      text: r.text,
      status: best.inBase ? "covered" : "covered_reusable",
      coveredBy: best.inBase ? recommended.name : (best.source?.name ?? best.capability.sourceSolutionName),
      capabilityId: best.capability.id,
      capabilityName: best.capability.name,
      score: best.score,
    };
  });
}
