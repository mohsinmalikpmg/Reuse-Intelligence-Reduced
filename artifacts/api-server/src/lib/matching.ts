import type {
  Brief,
  Solution,
  SolutionMatch,
  CapabilityMatch,
  MatchScoring,
  FitLabel,
} from "@workspace/api-zod";
import {
  solutions,
  solutionSearchMeta,
  capabilities,
  capabilityKeywords,
  sortByMaturity,
} from "../data/catalog";

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

function labelFor(score: number): FitLabel {
  if (score >= 75) return "strong";
  if (score >= 55) return "good";
  if (score >= 35) return "partial";
  return "weak";
}

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
}

export function matchBrief(brief: Brief): MatchOutcome {
  const scored = solutions.map((solution) => ({ solution, ...scoreSolution(brief, solution) }));

  // Only keep solutions with a meaningful signal
  const relevant = scored
    .filter((s) => s.scoring.semantic >= 12 && s.fitScore >= 20)
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, 5);

  const recommendedId = pickRecommended(relevant.map((r) => r.solution), relevant);

  const matches: SolutionMatch[] = relevant.map((r, index) => ({
    rank: index + 1,
    solution: r.solution,
    fitScore: r.fitScore,
    fitLabel: labelFor(r.fitScore),
    recommended: r.solution.id === recommendedId,
    whyMatched: whyMatched(brief, r.solution, r.scoring),
    gaps: r.solution.knownGaps.slice(0, 2),
    scoring: r.scoring,
  }));

  const briefTokens = new Set(tokenize(briefText(brief)));
  const capabilityMatches: CapabilityMatch[] = capabilities
    .map((capability) => {
      const kw = capabilityKeywords.get(capability.id) ?? [];
      const capTokens = new Set(tokenize([capability.name, capability.description, ...kw].join(" ")));
      const sim = overlap(briefTokens, capTokens);
      return { capability, sim };
    })
    .filter((c) => c.sim >= 0.2 && c.capability.controlType === "optional" && c.capability.supportStatus !== "Unsupported")
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 4)
    .map((c) => ({
      capability: c.capability,
      fitScore: round(Math.min(100, c.sim * 130)),
      whyMatched: [
        `Addresses "${c.capability.workflowStep.toLowerCase()}" in the described workflow.`,
        `Reusable from ${c.capability.sourceSolutionName} (${c.capability.evidenceLevel} evidence).`,
      ],
    }));

  const missingRequirements = computeMissing(matches, capabilityMatches);
  const addresses = (m: SolutionMatch) => m.fitScore >= 30 && m.scoring.semantic >= 35;
  const certifiedCount = matches.filter((m) => m.solution.status === "certified" && addresses(m)).length;
  const addressing = matches.filter(addresses).length;

  const headline =
    addressing === 0
      ? "No existing solution closely addresses this need yet."
      : certifiedCount > 0
        ? "A certified solution already addresses most of this need."
        : "Existing work addresses part of this need, but nothing is certified yet.";

  const valueStatement =
    addressing === 0
      ? "Nothing in the library addresses this need directly. Consider submitting it as a new intake."
      : `${numberWord(addressing)} existing ${addressing === 1 ? "product addresses" : "products address"} this need.${
          certifiedCount > 0
            ? ` ${numberWord(certifiedCount)} certified ${certifiedCount === 1 ? "solution" : "solutions"} already ${certifiedCount === 1 ? "covers" : "cover"} most of the required workflow.`
            : ""
        }`;

  return { matches, capabilityMatches, missingRequirements, headline, valueStatement };
}

function pickRecommended(
  list: Solution[],
  scored: { solution: Solution; fitScore: number }[],
): string | null {
  if (list.length === 0) return null;
  if (scored[0]!.fitScore < 30) return null;
  // Prefer the best-fitting certified complete solution when it is within reach of the top score.
  const top = scored[0]!;
  const bestCertified = scored.find((s) => s.solution.status === "certified" && s.solution.kind === "complete_solution");
  if (bestCertified && bestCertified.fitScore >= top.fitScore - 15) return bestCertified.solution.id;
  const ordered = sortByMaturity(list.filter((s) => s.status !== "deprecated"));
  return ordered[0]?.id ?? top.solution.id;
}

function whyMatched(brief: Brief, solution: Solution, scoring: MatchScoring): string[] {
  const reasons: string[] = [];
  if (scoring.semantic >= 40) reasons.push(`Describes the same business problem: ${solution.outcome}`);
  else if (scoring.semantic >= 12) reasons.push(`Overlaps with part of the described problem.`);
  if (scoring.workflow >= 80) reasons.push(`Covers the workflow steps the brief implies (${solution.workflowSteps.join(" > ")}).`);
  else if (scoring.workflow >= 40) reasons.push(`Covers some workflow steps (${solution.workflowSteps.join(", ")}).`);
  if (scoring.persona >= 50) reasons.push(`Built for ${brief.fields.user.value.toLowerCase() || "the same users"}.`);
  if (solution.status === "certified") reasons.push(`Certified and in production with ${solution.activeUsers} users across ${solution.businessUnits.length} business units.`);
  else if (solution.status === "pilot") reasons.push(`In pilot with ${solution.activeUsers} users; ${solution.evidenceLevel} evidence.`);
  else reasons.push(`Experimental prototype with ${solution.evidenceLevel} evidence.`);
  if (scoring.integration >= 60) reasons.push(`Already connected to the data the brief relies on.`);
  return reasons.slice(0, 4);
}

function computeMissing(matches: SolutionMatch[], capabilityMatches: CapabilityMatch[]): string[] {
  const top = matches.find((m) => m.recommended);
  if (!top) return [];
  const missing = capabilityMatches
    .filter((cm) => !top.solution.capabilityIds.includes(cm.capability.id))
    .map((cm) => `${cm.capability.name}: not in ${top.solution.name}; available from ${cm.capability.sourceSolutionName}.`);
  if (missing.length === 0 && top.solution.knownGaps.length > 0) missing.push(top.solution.knownGaps[0]!);
  return missing;
}

function numberWord(n: number): string {
  const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  return words[n] ?? String(n);
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
  return sortByMaturity(list);
}
