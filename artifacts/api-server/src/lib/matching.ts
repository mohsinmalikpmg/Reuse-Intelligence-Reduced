import type {
  Brief,
  Capability,
  Solution,
  SolutionMatch,
  CapabilityMatch,
  MatchScoring,
} from "@workspace/api-zod";
import {
  solutions,
  solutionSearchMeta,
  allCapabilities,
  capabilities,
  capabilityKeywords,
  sortByMaturity,
} from "../data/catalog";
import { rankBucket } from "./governance";
import { z } from "zod";
import { analyze, readSavedAnalysis } from "./ai-analysis";
import { briefEvidence, groundingInstructions, provenanceLabel } from "./assessment-evidence";
import { freshContext, moduleBlockedReason } from "./configuration";
import type { CoverageRow } from "./reuse-check";

const STOPWORDS = new Set(
  "the a an and or of to in on for with by from at is are be been it its this that these those we our they their as into than then there here use uses using each week weeks hour hours take takes several different manual manually".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map(stem);
}

function stem(token: string): string {
  return token
    .replace(/ies$/, "y")
    .replace(/(ing|ers|ed|es|s)$/, "")
    .replace(/or$/, "");
}

function briefText(brief: Brief): string {
  const f = brief.fields;
  return [
    brief.rawText,
    f.user.value,
    f.job.value,
    f.currentProcess.value,
    f.painPoint.value,
    f.desiredOutcome.value,
    f.constraints.value,
    f.data.value,
    f.requiredControls.value,
    f.successMeasures.value,
    brief.clarification ?? "",
  ].join(" ");
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / Math.min(a.size, b.size);
}

const WORKFLOW_SYNONYMS: Record<string, string[]> = {
  Ingest: ["ingest", "pull", "import", "collect", "note", "data", "export", "upload"],
  Analyze: ["analy", "identify", "detect", "find", "review", "summar", "cluster", "pattern", "recurr"],
  Review: ["review", "check", "flag", "queue", "triage"],
  Decide: ["approv", "decide", "decision", "assign", "route", "prioriti"],
  Track: ["track", "follow", "close", "action", "report", "monit"],
};

function workflowAlignment(text: string, steps: string[]): number {
  const lower = text.toLowerCase();
  const needed = Object.entries(WORKFLOW_SYNONYMS).filter(([, syns]) => syns.some((s) => lower.includes(s)));
  if (needed.length === 0) return 0.5;
  const covered = needed.filter(([step]) => steps.includes(step)).length;
  return covered / needed.length;
}

const readinessScore: Record<Solution["status"], number> = {
  certified: 1,
  pilot: 0.7,
  experimental: 0.35,
  deprecated: 0.1,
};
const evidenceScore: Record<Solution["evidenceLevel"], number> = {
  strong: 1,
  moderate: 0.7,
  limited: 0.4,
  none: 0.1,
};

function scoreSolution(brief: Brief, solution: Solution): { scoring: MatchScoring; fitScore: number } {
  const meta = solutionSearchMeta.get(solution.id);
  const text = briefText(brief);
  const briefTokens = new Set(tokenize(text));

  const solutionTokens = new Set(
    tokenize(
      [
        solution.name,
        solution.outcome,
        solution.description,
        ...(meta?.keywords ?? []),
        ...solution.businessUnits,
        ...solution.knownGaps,
      ].join(" "),
    ),
  );
  const semantic = Math.min(1, overlap(briefTokens, solutionTokens) * 1.6);

  const workflow = workflowAlignment(text, solution.workflowSteps);

  const userTokens = new Set(tokenize(brief.fields.user.value));
  const intended = new Set(tokenize((meta?.intendedUsers ?? []).join(" ")));
  const persona = userTokens.size === 0 ? 0.5 : Math.min(1, overlap(userTokens, intended) * 1.5);

  const readiness = readinessScore[solution.status];
  const evidence = evidenceScore[solution.evidenceLevel];

  const dataTokens = new Set(tokenize(brief.fields.data.value + " " + brief.fields.constraints.value));
  const sourceTokens = new Set(tokenize((meta?.dataSources ?? []).join(" ") + " " + solution.dependencies.join(" ")));
  const integration = dataTokens.size === 0 ? 0.5 : Math.min(1, overlap(dataTokens, sourceTokens) * 1.5 + 0.2);

  const scoring: MatchScoring = {
    semantic: round(semantic * 100),
    workflow: round(workflow * 100),
    persona: round(persona * 100),
    readiness: round(readiness * 100),
    evidence: round(evidence * 100),
    integration: round(integration * 100),
  };

  // Semantic similarity alone never decides, but readiness and evidence only count in proportion to relevance,
  // so a mature product for a different problem cannot outrank a relevant pilot.
  const relevance = Math.min(1, semantic / 0.5);
  const fitScore =
    semantic * 35 + workflow * 15 + persona * 10 + (readiness * 20 + evidence * 12 + integration * 8) * relevance;

  return { scoring, fitScore: round(fitScore) };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface MatchOutcome {
  matches: SolutionMatch[];
  capabilityMatches: CapabilityMatch[];
  missingRequirements: string[];
  headline: string;
  valueStatement: string;
  coverage?: CoverageRow[];
}

function retrieveBriefCandidates(brief: Brief) {
  const scored = solutions.map((solution) => ({ solution, ...scoreSolution(brief, solution) }));

  // Only keep solutions with a meaningful signal
  return scored
    .filter((s) => s.scoring.semantic >= 12 && s.fitScore >= 20)
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, 5);

}

export async function matchBrief(brief: Brief, options: { force?: boolean; analyzer?: typeof analyze } = {}): Promise<MatchOutcome> {
  const retrieved = retrieveBriefCandidates(brief);
  const candidates = retrieved.filter(m => m.solution.status !== "deprecated");
  const caps = allCapabilities().filter(c => c.supportStatus !== "Unsupported");
  const schema = z.object({
    matches: z.array(z.object({ solutionId: z.string(), fitLabel: z.enum(["strong", "good", "partial", "weak"]), reason: z.string().min(1), gaps: z.array(z.string()) }).strict()),
    recommendedId: z.string().nullable(), capabilityMatches: z.array(z.object({ capabilityId: z.string(), reason: z.string().min(1) }).strict()),
    missingRequirements: z.array(z.string()), headline: z.string().min(1), valueStatement: z.string().min(1),
    coverage: z.array(z.object({ requirementId: z.string(), capabilityId: z.string().nullable() }).strict()),
  }).strict().superRefine((v, ctx) => {
    const ids = v.matches.map(m => m.solutionId);
    if (new Set(ids).size !== ids.length || ids.some(id => !candidates.some(c => c.solution.id === id))
      || (v.recommendedId && !ids.includes(v.recommendedId))
      || v.capabilityMatches.some(m => !caps.some(c => c.id === m.capabilityId))
      || v.coverage.length !== brief.requirements.length || new Set(v.coverage.map(c => c.requirementId)).size !== brief.requirements.length
      || v.coverage.some(c => !brief.requirements.some(r => r.id === c.requirementId) || (c.capabilityId && !caps.some(cap => cap.id === c.capabilityId)))) {
      ctx.addIssue({ code: "custom", message: "Invalid or duplicate catalogue/requirement ID." });
    }
  });
  const result = await (options.analyzer ?? analyze)({
    private: true, purpose: "brief-matching", promptVersion: "brief-matching-evidence-v1", force: options.force, schema,
    instructions: `${groundingInstructions} Semantically assess and order retrieved solution candidates; omit irrelevant candidates. Recommend at most one candidate. Assess reusable capabilities from supplied catalogue. List unmet requirements honestly. coverage maps each requirement to one capability ONLY if its documented scope fully addresses it (null for partial/negative/unknown). No cost savings, time estimates, certainty or execution claims. Numeric retrieval scores are lexical heuristics, not measured fit. Return JSON {"matches":[{"solutionId":"...","fitLabel":"partial","reason":"...","gaps":["..."]}],"recommendedId":null,"capabilityMatches":[{"capabilityId":"...","reason":"..."}],"missingRequirements":["..."],"headline":"...","valueStatement":"...","coverage":[{"requirementId":"...","capabilityId":null}]}.`,
    input: { brief: briefEvidence(brief), candidates: candidates.map(c => ({ solution: c.solution, retrievalScore: c.fitScore })), capabilities: caps },
  });
  const label = provenanceLabel(result.provenance);
  const matches = result.data.matches.map((m, i) => {
    const original = candidates.find(c => c.solution.id === m.solutionId)!;
    return { ...original, rank: i + 1, fitLabel: m.fitLabel, recommended: result.data.recommendedId === m.solutionId,
      whyMatched: [m.reason, "Numeric score is a deterministic retrieval heuristic, not measured fit.", label], gaps: m.gaps };
  });
  const recommended = matches.find(m => m.recommended)?.solution;
  const ctx = recommended ? freshContext(recommended) : null;
  const coverage: CoverageRow[] = brief.requirements.map(r => {
    const mapping = result.data.coverage.find(c => c.requirementId === r.id)!;
    const cap = caps.find(c => c.id === mapping.capabilityId);
    const inBase = !!cap && !!recommended?.capabilityIds.includes(cap.id);
    const eligible = !!cap && !!ctx && (inBase || moduleBlockedReason(cap, ctx) === null);
    return { requirementId: r.id, text: r.text, status: !eligible ? "uncovered" : inBase ? "covered" : "covered_reusable",
      capabilityId: eligible ? cap!.id : null, capabilityName: eligible ? cap!.name : null, coveredBy: eligible ? (inBase ? recommended!.name : cap!.sourceSolutionName) : null, score: null };
  });
  return { matches, capabilityMatches: result.data.capabilityMatches.map(m => {
    const capability = caps.find(c => c.id === m.capabilityId)!;
    const retrievalScore = round(Math.min(100, overlap(new Set(tokenize(briefText(brief))),
      new Set(tokenize([capability.name, capability.description, ...(capabilityKeywords.get(capability.id) ?? [])].join(" ")))) * 130));
    return { capability, fitScore: retrievalScore, whyMatched: [m.reason, "Numeric score is a deterministic lexical retrieval heuristic, not measured fit or AI confidence.", label] };
  }),
    missingRequirements: result.data.missingRequirements, headline: result.data.headline, valueStatement: `${result.data.valueStatement} ${label}`, coverage };
}

class UnassessedBrief extends Error {}

/** Overview reads never generate analysis or replace missing results with catalog guesses. */
export async function savedBriefMatch(brief: Brief, reader = readSavedAnalysis) {
  try {
    return await matchBrief(brief, { analyzer: async opts => {
      const saved = await reader(opts);
      if (!saved) throw new UnassessedBrief();
      return saved;
    } });
  } catch (error) {
    if (error instanceof UnassessedBrief) return null;
    throw error;
  }
}

/** Library text search across problems, roles, workflow, outcomes, capabilities and names. */
export function searchSolutions(q: string | undefined, status: Solution["status"] | undefined): Solution[] {
  let list = solutions;
  if (status) list = list.filter((s) => s.status === status);
  if (q && q.trim().length > 0) {
    const qTokens = new Set(tokenize(q));
    const qLower = q.toLowerCase();
    list = list.filter((s) => {
      const meta = solutionSearchMeta.get(s.id);
      const caps = s.capabilityIds
        .map((id) => capabilities.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => `${c.name} ${c.description}`);
      const haystack = [
        s.name,
        s.outcome,
        s.description,
        s.ownerName,
        s.ownerTeam,
        ...s.businessUnits,
        ...s.workflowSteps,
        ...(meta?.keywords ?? []),
        ...(meta?.intendedUsers ?? []),
        ...(meta?.dataSources ?? []),
        ...caps,
      ].join(" ");
      if (haystack.toLowerCase().includes(qLower)) return true;
      const hay = new Set(tokenize(haystack));
      return [...qTokens].some((t) => hay.has(t));
    });
  }
  // A confirmed disposition moves a product below the preferred one for its problem; maturity decides the rest.
  return sortByMaturity(list).sort((a, b) => rankBucket(a) - rankBucket(b));
}

// ---------- Global search ----------

export interface SearchFilters {
  status?: Solution["status"];
  kind?: Solution["kind"];
  owner?: string;
  businessProblemId?: string;
}

export interface SearchHit {
  solution: Solution;
  score: number;
  reasons: string[];
  matchedCapabilities: Capability[];
}

/**
 * Hybrid search: exact phrase and token overlap on names (keyword) plus overlap with the problem, workflow,
 * intended users and capability descriptions (semantic-ish). Every reason shown is one the data supports.
 */
export function searchLibrary(q: string, filters: SearchFilters): { hits: SearchHit[]; capabilities: Capability[] } {
  const qLower = q.trim().toLowerCase();
  const qTokens = new Set(tokenize(q));
  let list = solutions;
  if (filters.status) list = list.filter((s) => s.status === filters.status);
  if (filters.kind) list = list.filter((s) => s.kind === filters.kind);
  if (filters.owner) list = list.filter((s) => s.ownerName === filters.owner || s.ownerTeam === filters.owner);
  if (filters.businessProblemId) list = list.filter((s) => s.businessProblemIds.includes(filters.businessProblemId!));

  // Declared components of registered prototypes are searchable too, so "someone built this already" surfaces.
  const capHits = allCapabilities()
    .map((cap) => {
      const kw = capabilityKeywords.get(cap.id) ?? [];
      const sim = overlap(qTokens, new Set(tokenize([cap.name, cap.description, ...kw].join(" "))));
      const exact = qLower.length > 2 && cap.name.toLowerCase().includes(qLower);
      return { cap, sim: exact ? Math.max(sim, 0.6) : sim };
    })
    .filter((c) => c.sim >= 0.2)
    .sort((a, b) => b.sim - a.sim);

  const hits: SearchHit[] = list
    .map((s) => {
      const meta = solutionSearchMeta.get(s.id);
      const reasons: string[] = [];
      let score = 0;
      if (qLower.length > 1 && s.name.toLowerCase().includes(qLower)) {
        score += 60;
        reasons.push(`Name matches "${q.trim()}".`);
      }
      const problemSim = overlap(qTokens, new Set(tokenize([s.outcome, s.description, ...(meta?.keywords ?? [])].join(" "))));
      if (problemSim >= 0.15) {
        score += Math.round(problemSim * 60);
        reasons.push(`Addresses the same problem: ${s.outcome}`);
      }
      const workflowSim = overlap(qTokens, new Set(tokenize(s.workflowSteps.join(" "))));
      if (workflowSim >= 0.2) {
        score += Math.round(workflowSim * 25);
        reasons.push(`Covers workflow steps ${s.workflowSteps.join(" > ")}.`);
      }
      const userSim = overlap(qTokens, new Set(tokenize([...(meta?.intendedUsers ?? []), ...s.businessUnits].join(" "))));
      if (userSim >= 0.2) {
        score += Math.round(userSim * 20);
        reasons.push(`Built for ${(meta?.intendedUsers ?? s.businessUnits).slice(0, 2).join(" and ").toLowerCase()}.`);
      }
      const matchedCapabilities = capHits.filter((c) => s.capabilityIds.includes(c.cap.id)).map((c) => c.cap);
      if (matchedCapabilities.length) {
        score += 15 + matchedCapabilities.length * 5;
        reasons.push(`Includes ${matchedCapabilities.map((cap) => cap.name.toLowerCase()).slice(0, 2).join(" and ")}.`);
      }
      if (qLower.length > 2 && (s.ownerName.toLowerCase().includes(qLower) || s.ownerTeam.toLowerCase().includes(qLower))) {
        score += 30;
        reasons.push(`Owned by ${s.ownerName} (${s.ownerTeam}).`);
      }
      if (score > 0) {
        if (s.status === "certified") score += 8;
        else if (s.status === "pilot") score += 4;
        if (s.origin) reasons.push(`Registered prototype, runs on ${s.origin.platformName}; not run by FUSEBOX.`);
        else reasons.push(s.status === "certified" ? `Certified, ${s.activeUsers} active users.` : `${s.status.charAt(0).toUpperCase()}${s.status.slice(1)}, ${s.activeUsers} users.`);
        // Governance: the preferred product for a problem ranks above products IT has disposed of.
        const bucket = rankBucket(s);
        if (bucket === 0) score += 10;
        if (bucket === 2 && s.disposition) {
          score -= 25;
          reasons.unshift(`${s.disposition.label}.`);
        }
      }
      return { solution: s, score: score > 0 ? Math.max(1, Math.min(100, score)) : 0, reasons: reasons.slice(0, 3), matchedCapabilities };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score);

  return { hits, capabilities: capHits.slice(0, 5).map((c) => c.cap) };
}
