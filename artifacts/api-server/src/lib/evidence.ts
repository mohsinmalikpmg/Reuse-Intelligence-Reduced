/**
 * Defensible A/B evidence for a case, built only from persisted runs and recorded votes.
 * Nothing here estimates, projects or extrapolates.
 */
import type { Case, EvaluationSummary, EvidenceSummary } from "@workspace/api-zod";
import { sampleInputById } from "../engine/workorders";
import { scoreAgainstExpected } from "../engine/diff";
import { listEvaluations, listRunsForCase, splitByFingerprint, summarizeEvaluations } from "./workbench-store";
import { currentFingerprints, pairRuns } from "./workbench";

export interface ABEvidence {
  /** Fingerprint of the case's current Version B; everything below is restricted to runs and votes on it */
  currentFingerprint: string;
  /** Distinct inputs on which the governed baseline and the current Version B have both been run */
  inputsTested: number;
  /** Median runtime of each version across its latest runs, ms */
  runtimeA: number | null;
  runtimeB: number | null;
  /** Precision/recall against labelled inputs, averaged over labelled inputs that were run (null when none) */
  labelled: { inputs: number; recallA: number; recallB: number; precisionA: number; precisionB: number } | null;
  votes: EvaluationSummary | null;
  /** Votes recorded against earlier Version B configurations: reported, never merged into `votes` */
  setAside: number;
  /** Votes on the current configuration cast by people (not demo accounts) */
  humanVotes: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export async function caseEvidence(c: Case): Promise<ABEvidence> {
  const current = currentFingerprints(c);
  const allEvaluations = await listEvaluations(c.id);
  const split = splitByFingerprint(allEvaluations, current.b);
  // Only pairs where A is the governed baseline and B is the current configuration count.
  const evaluations = split.current.filter((e) => e.fingerprintA === current.a);
  const setAside = allEvaluations.length - evaluations.length;
  const runs = await listRunsForCase(c.id);
  const pairs = pairRuns(runs.filter((r) => r.version !== "A" || r.configFingerprint === current.a), current.b).map((p) => ({ a: p.runA, b: p.runB }));
  if (pairs.length === 0) return { currentFingerprint: current.b, inputsTested: 0, runtimeA: null, runtimeB: null, labelled: null, votes: null, setAside, humanVotes: 0 };
  const scored = pairs
    .map((p) => {
      const expected = p.a.sampleInputId ? sampleInputById.get(p.a.sampleInputId)?.expected : null;
      if (!expected || expected.length === 0) return null;
      return { a: scoreAgainstExpected(p.a.output, expected), b: scoreAgainstExpected(p.b.output, expected) };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
  const avg = (xs: (number | null)[]) => {
    const nums = xs.filter((x): x is number => x !== null);
    return nums.length ? Math.round((nums.reduce((s, x) => s + x, 0) / nums.length) * 100) / 100 : 0;
  };
  return {
    currentFingerprint: current.b,
    inputsTested: pairs.length,
    runtimeA: median(pairs.map((p) => p.a.durationMs)),
    runtimeB: median(pairs.map((p) => p.b.durationMs)),
    labelled: scored.length
      ? {
          inputs: scored.length,
          recallA: avg(scored.map((s) => s.a.recall)),
          recallB: avg(scored.map((s) => s.b.recall)),
          precisionA: avg(scored.map((s) => s.a.precision)),
          precisionB: avg(scored.map((s) => s.b.precision)),
        }
      : null,
    votes: evaluations.length ? summarizeEvaluations(evaluations) : null,
    setAside,
    humanVotes: evaluations.filter((e) => !e.demo).length,
  };
}

/** The API shape of the evidence: everything except the human-vote count used by the gate. */
export function evidenceSummary(e: ABEvidence): EvidenceSummary {
  return { currentFingerprint: e.currentFingerprint, inputsTested: e.inputsTested, runtimeA: e.runtimeA, runtimeB: e.runtimeB, labelled: e.labelled, votes: e.votes, setAside: e.setAside };
}

/** One-sentence, non-fabricated description of what the evidence shows. */
export function describeEvidence(e: ABEvidence): string {
  if (e.inputsTested === 0) return e.setAside > 0 ? `No A/B run of the current configuration yet; ${e.setAside} vote${e.setAside === 1 ? "" : "s"} from earlier configurations set aside.` : "No A/B run has been recorded yet.";
  const parts = [`Both versions ran on ${e.inputsTested} input${e.inputsTested === 1 ? "" : "s"}`];
  if (e.labelled) parts.push(`recall on labelled inputs ${e.labelled.recallA} (A) vs ${e.labelled.recallB} (B)`);
  if (e.votes) {
    const v = e.votes;
    parts.push(`${v.tests} recorded vote${v.tests === 1 ? "" : "s"}: A ${v.aPreferred}, B ${v.bPreferred}, neither ${v.neither}${v.demoVotes ? ` (${v.demoVotes} demo)` : ""}`);
  } else parts.push("no preference recorded for the current configuration yet");
  if (e.setAside > 0) parts.push(`${e.setAside} vote${e.setAside === 1 ? "" : "s"} from earlier configurations set aside`);
  return `${parts.join("; ")}.`;
}

/** True when recorded votes favour B, false when they favour A or are tied, null when there are no votes. */
export function votesFavourB(e: ABEvidence): boolean | null {
  if (!e.votes || e.votes.tests === 0) return null;
  return e.votes.bPreferred > e.votes.aPreferred;
}
