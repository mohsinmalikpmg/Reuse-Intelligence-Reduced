/**
 * Experiments stay under their parent product. This module finds experiments that pursue the same intent on the
 * same parent, groups them for the owner, and records grouped decisions. Every count comes from evidence on the
 * current configuration of each experiment; nothing is estimated.
 */
import type { Case, DecisionAction, EvaluationSummary, ImprovementApproach, ImprovementGroup, ImprovementGroupDetail, SimilarExperiment, SimilarExperiments } from "@workspace/api-zod";
import { getSolution, personas } from "../data/catalog";
import { ACTIVE_STATUSES, allowedGroupActions, nextStatus, promotionStateFor } from "./analysis";
import { caseEvidence, type ABEvidence } from "./evidence";
import { hasExplicitIntent, lineageChanges } from "./lineage";
import { getCase, insertDecision, listAllDecisions, listCaseRows, newId, summarizeAll, updateCaseRow } from "./store";

const active = (c: Case) => ACTIVE_STATUSES.includes(c.status);
/** An experiment counts for grouping once the person has saved or proposed it; untouched drafts stay private. */
const visible = (c: Case) => active(c) && (c.saved || c.status !== "draft");

const sharesCapability = (a: Case, b: Case) => a.lineage.added.some((n) => b.lineage.added.includes(n));
const sameFingerprint = (a: Case, b: Case) => a.lineage.fingerprint === b.lineage.fingerprint && a.lineage.added.length + a.lineage.changedSettings.length + a.lineage.removed.length > 0;

/**
 * Two experiments pursue the same improvement when their stated intents match (normalized). When at least one of
 * them has no stated intent, the change itself decides: the same added capability or an identical configuration.
 */
function sharesChange(a: Case, b: Case): boolean {
  if (a.lineage.intentKey !== "none" && a.lineage.intentKey === b.lineage.intentKey) return true;
  if (hasExplicitIntent(a) && hasExplicitIntent(b)) return false;
  return sameFingerprint(a, b) || sharesCapability(a, b);
}

/**
 * Partition experiments into improvement groups. Stated intents define the groups; an experiment without a stated
 * intent joins the one group whose members make the same change, and otherwise forms a group under its own key.
 */
function partition(members: Case[]): Map<string, Case[]> {
  const byKey = new Map<string, Case[]>();
  const put = (key: string, c: Case) => byKey.set(key, [...(byKey.get(key) ?? []), c]);
  const described = members.filter(hasExplicitIntent);
  const rest = members.filter((c) => !hasExplicitIntent(c));
  for (const c of described) put(c.lineage.intentKey, c);
  for (const c of rest) {
    const matches = Array.from(byKey.entries()).filter(([, list]) => list.some((m) => sharesChange(c, m)));
    if (matches.length === 1) { put(matches[0]![0], c); continue; }
    put(c.lineage.intentKey === "none" ? `case-${c.id}` : c.lineage.intentKey, c);
  }
  return byKey;
}

/** Other saved/proposed experiments on the same parent that pursue the same intent or make the same change. */
export async function similarExperiments(c: Case): Promise<SimilarExperiments> {
  const others = (await listCaseRows()).filter((o) => o.id !== c.id && o.baseSolutionId === c.baseSolutionId && visible(o) && sharesChange(c, o));
  const experiments: SimilarExperiment[] = [];
  for (const o of others) {
    const ev = await caseEvidence(o);
    experiments.push({ case: o, sameApproach: o.lineage.fingerprint === c.lineage.fingerprint, changes: lineageChanges(o.lineage), votes: ev.votes, inputsTested: ev.inputsTested });
  }
  return { count: experiments.length, teams: new Set(others.map((o) => o.ownerTeam || o.ownerName)).size, experiments };
}

function mergeVotes(items: (EvaluationSummary | null)[]): EvaluationSummary | null {
  const present = items.filter((v): v is EvaluationSummary => !!v && v.tests > 0);
  if (present.length === 0) return null;
  const sum = (k: keyof EvaluationSummary) => present.reduce((s, v) => s + (Number(v[k]) || 0), 0);
  const rated = present.filter((v) => v.averageRating !== null);
  return {
    tests: sum("tests"),
    aPreferred: sum("aPreferred"),
    bPreferred: sum("bPreferred"),
    neither: sum("neither"),
    averageRating: rated.length ? Math.round((rated.reduce((s, v) => s + (v.averageRating ?? 0), 0) / rated.length) * 10) / 10 : null,
    distinctInputs: sum("distinctInputs"),
    blindVotes: sum("blindVotes"),
    demoVotes: sum("demoVotes"),
  };
}

function groupLabel(members: Case[]): string {
  // The wording most members used; ties go to the earlier experiment. Falls back to the derived intent.
  const counts = new Map<string, number>();
  for (const m of members) { const t = m.intent?.trim(); if (t) counts.set(t, (counts.get(t) ?? 0) + 1); }
  let best: string | null = null;
  for (const [text, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = text;
  return best ?? members[0]!.lineage.intent;
}

async function buildGroup(solutionId: string, key: string, members: Case[], evidence: Map<string, ABEvidence>): Promise<ImprovementGroup> {
  const votes = mergeVotes(members.map((m) => evidence.get(m.id)?.votes ?? null));
  return {
    key,
    solutionId,
    intent: groupLabel(members),
    experiments: await summarizeAll(members),
    teams: new Set(members.map((m) => m.ownerTeam || m.ownerName)).size,
    completedTests: votes?.tests ?? 0,
    preferredModifiedPercent: votes && votes.tests > 0 ? Math.round((votes.bPreferred / votes.tests) * 100) : null,
    approaches: new Set(members.map((m) => m.lineage.fingerprint)).size,
    pendingReview: members.some((m) => m.status === "pilot_proposed"),
  };
}

/** Saved or proposed experiments on one product, grouped by intent. */
export async function improvementGroups(solutionId: string, cases?: Case[]): Promise<ImprovementGroup[]> {
  const members = (cases ?? (await listCaseRows())).filter((c) => c.baseSolutionId === solutionId && visible(c));
  const byKey = partition(members);
  const evidence = new Map<string, ABEvidence>();
  for (const c of members) evidence.set(c.id, await caseEvidence(c));
  const groups: ImprovementGroup[] = [];
  for (const [key, list] of byKey) groups.push(await buildGroup(solutionId, key, list, evidence));
  // Proposals awaiting the owner first, then the groups with the most experiments.
  return groups.sort((a, b) => Number(b.pendingReview) - Number(a.pendingReview) || b.experiments.length - a.experiments.length);
}

export async function improvementGroupDetail(solutionId: string, key: string): Promise<ImprovementGroupDetail | null> {
  const solution = getSolution(solutionId);
  if (!solution) return null;
  const all = await listCaseRows();
  const groups = await improvementGroups(solutionId, all);
  const group = groups.find((g) => g.key === key);
  if (!group) return null;
  const evidence = new Map<string, ABEvidence>();
  for (const s of group.experiments) evidence.set(s.case.id, await caseEvidence(s.case));
  // Proposed experiments first, then the best-evidenced, so "Approach 1" is the one the owner was asked about.
  const members = group.experiments
    .map((s) => s.case)
    .sort((a, b) => Number(b.status === "pilot_proposed") - Number(a.status === "pilot_proposed") || (evidence.get(b.id)?.votes?.tests ?? 0) - (evidence.get(a.id)?.votes?.tests ?? 0));
  const byFingerprint = new Map<string, Case[]>();
  for (const c of members) byFingerprint.set(c.lineage.fingerprint, [...(byFingerprint.get(c.lineage.fingerprint) ?? []), c]);
  const approaches: ImprovementApproach[] = [];
  let n = 0;
  for (const [fingerprint, list] of byFingerprint) {
    n += 1;
    approaches.push({
      fingerprint,
      label: `Approach ${n}`,
      changes: lineageChanges(list[0]!.lineage),
      experiments: group.experiments.filter((s) => list.some((c) => c.id === s.case.id)),
      teams: Array.from(new Set(list.map((c) => c.ownerTeam || c.ownerName))),
      votes: mergeVotes(list.map((c) => evidence.get(c.id)?.votes ?? null)),
      inputsTested: list.reduce((s, c) => s + (evidence.get(c.id)?.inputsTested ?? 0), 0),
    });
  }
  const ids = new Set(members.map((m) => m.id));
  const decisions = (await listAllDecisions()).filter((d) => ids.has(d.caseId));
  return { group, solution, approaches, decisions, availableActions: allowedGroupActions(members) };
}

export class GroupDecisionError extends Error {}

/** One owner decision applied to every experiment in the group; the adopted one, if any, is approved. */
export async function recordGroupDecision(solutionId: string, key: string, input: { action: DecisionAction; caseId?: string; reason?: string }): Promise<ImprovementGroupDetail | null> {
  const detail = await improvementGroupDetail(solutionId, key);
  if (!detail) return null;
  if (!detail.availableActions.includes(input.action)) throw new GroupDecisionError("That decision is not available for this group right now.");
  const reason = input.reason?.trim() || null;
  if ((input.action === "decline" || input.action === "request_more_evidence" || input.action === "merge_approaches") && !reason) throw new GroupDecisionError("Say why, in a sentence: the teams who ran these experiments will read it.");
  const members = detail.group.experiments.map((s) => s.case);
  let adopted: Case | null = null;
  if (input.action === "adopt_approach") {
    adopted = members.find((m) => m.id === input.caseId) ?? null;
    if (!adopted) throw new GroupDecisionError("Choose which experiment's approach to adopt.");
  }
  const actor = personas.find((p) => p.role === "owner")?.name ?? "owner";
  for (const m of members) {
    if (m.status === "rejected" || m.status === "approved") continue;
    // Adopting one approach keeps the others as local experiments: nothing is rejected by that choice.
    const action: DecisionAction = adopted ? (m.id === adopted.id ? "adopt_approach" : "keep_local") : input.action;
    await insertDecision({ id: newId("dec"), caseId: m.id, role: "owner", actor, action, reason: action === "keep_local" && adopted ? `Approach from ${adopted.ownerName} adopted${reason ? `: ${reason}` : "."}` : reason });
    const fresh = (await getCase(m.id)) ?? m;
    await updateCaseRow(m.id, { status: nextStatus(fresh, action), promotionState: promotionStateFor(action, fresh.promotionState), saved: true });
  }
  return improvementGroupDetail(solutionId, key);
}

export function experimentsInProgress(solutionId: string, cases: Case[]): Case[] {
  return cases.filter((c) => c.baseSolutionId === solutionId && visible(c));
}
