/**
 * Defensible A/B evidence for a case, built only from persisted runs and recorded votes.
 * Nothing here estimates, projects or extrapolates.
 */
import type { Case, EvaluationSummary } from "@workspace/api-zod";
import { sampleInputById } from "../engine/workorders";
import { scoreAgainstExpected } from "../engine/diff";
import { listEvaluations, listRunsForCase, summarizeEvaluations } from "./workbench-store";

export interface ABEvidence {
  /** Distinct inputs on which both versions have been run */
  inputsTested: number;
  /** Median runtime of each version across its latest runs, ms */
  runtimeA: number | null;
  runtimeB: number | null;
  /** Precision/recall against labelled inputs, averaged over labelled inputs that were run (null when none) */
  labelled: { inputs: number; recallA: number; recallB: number; precisionA: number; precisionB: number } | null;
  votes: EvaluationSummary | null;
}

export const EMPTY_EVIDENCE: ABEvidence = { inputsTested: 0, runtimeA: null, runtimeB: null, labelled: null, votes: null };

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export async function caseEvidence(c: Case): Promise<ABEvidence> {
  const runs = await listRunsForCase(c.id);
  if (runs.length === 0) return EMPTY_EVIDENCE;
  const latest = new Map<string, { a?: (typeof runs)[number]; b?: (typeof runs)[number] }>();
  for (const run of runs) {
    const entry = latest.get(run.inputHash) ?? {};
    if (run.version === "A" && !entry.a) entry.a = run;
    if (run.version === "B" && !entry.b) entry.b = run;
    latest.set(run.inputHash, entry);
  }
  const pairs = [...latest.values()].filter((e): e is { a: (typeof runs)[number]; b: (typeof runs)[number] } => !!e.a && !!e.b);
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
  const evaluations = await listEvaluations(c.id);
  return {
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
  };
}

/** One-sentence, non-fabricated description of what the evidence shows. */
export function describeEvidence(e: ABEvidence): string {
  if (e.inputsTested === 0) return "No A/B run has been recorded yet.";
  const parts = [`Both versions ran on ${e.inputsTested} input${e.inputsTested === 1 ? "" : "s"}`];
  if (e.labelled) parts.push(`recall on labelled inputs ${e.labelled.recallA} (A) vs ${e.labelled.recallB} (B)`);
  if (e.votes) {
    const v = e.votes;
    parts.push(`${v.tests} recorded vote${v.tests === 1 ? "" : "s"}: A ${v.aPreferred}, B ${v.bPreferred}, neither ${v.neither}${v.demoVotes ? ` (${v.demoVotes} demo)` : ""}`);
  } else parts.push("no preference recorded yet");
  return `${parts.join("; ")}.`;
}

/** True when recorded votes favour B, false when they favour A or are tied, null when there are no votes. */
export function votesFavourB(e: ABEvidence): boolean | null {
  if (!e.votes || e.votes.tests === 0) return null;
  return e.votes.bPreferred > e.votes.aPreferred;
}
