/**
 * Executive Decision View: one read-only page per experiment, assembled from the same persisted records the workbench
 * and Decide views read (case, catalog, runs, votes, decisions, dispositions). Nothing here estimates or projects;
 * where nothing has been measured the view says so.
 */
import type { Case, Decision, DecisionView, Experiment } from "@workspace/api-zod";
import { businessProblems, getCapability, solutions } from "../data/catalog";
import { sampleInputById } from "../engine/workorders";
import { allowedActions } from "./analysis";
import { caseContext, type CaseContext } from "./configuration";
import { describeEvidence, evidenceSummary, type ABEvidence } from "./evidence";
import { configDiff } from "./lineage";
import { enrichDiff, latestPairs } from "./workbench";
import { diffOutputs } from "../engine/diff";

function baseWhy(ctx: CaseContext): string {
  const s = ctx.base;
  const maturity = s.status === "certified" ? "the certified product" : s.status === "pilot" ? "in pilot" : "experimental";
  const users = s.activeUsers > 0 ? `${s.activeUsers} active users` : "no recorded users";
  return `${s.name} is ${maturity} for this problem with ${users}, ${s.evidenceLevel} evidence and support from ${s.ownerTeam || s.ownerName}. Experiments change a copy of it; the standard version stays as it is until IT publishes a successor.`;
}

function decisionRequired(c: Case, decisions: Decision[]): DecisionView["decisionRequired"] {
  const allowed = allowedActions(c, decisions);
  const can = (role: "owner" | "it", action: string) => allowed.find((a) => a.role === role)?.actions.includes(action as never) ?? false;
  if (c.status === "folded") return { role: null, label: "No decision outstanding", detail: "IT published the approved change as a successor version. Only a withdrawal would reopen it." };
  if (c.status === "rejected") return { role: null, label: "No decision outstanding", detail: "The owner rejected this change." };
  if (can("it", "approve_consolidation")) return { role: "it", label: "IT: publish as the governed successor version", detail: "The owner approved the change. IT decides whether it becomes the next version of the product and what happens to the overlapping products." };
  if (can("owner", "approve_pilot")) return { role: "owner", label: "Owner: approve the pilot or request changes", detail: c.status === "deferred" ? "The decision was deferred; it is still the owner's to make." : "A pilot has been proposed on the evidence above." };
  if (c.status === "changes_requested") return { role: "seeker", label: "Requester: revise the configuration", detail: "The owner asked for changes before deciding." };
  if (c.status === "tested") return { role: "seeker", label: "Requester: propose a pilot", detail: "Both versions have run on the same input. Nothing has been proposed to the owner yet." };
  return { role: "seeker", label: "Not ready for a decision", detail: "Version B has not been compared with Version A on real input yet." };
}

export async function buildDecisionView(c: Case, decisions: Decision[], experiment: Experiment | null, evidence: ABEvidence): Promise<DecisionView> {
  const ctx = caseContext(c);
  const bp = businessProblems.find((b) => ctx.base.businessProblemIds.includes(b.id)) ?? businessProblems.find((b) => b.activeSolutionIds.includes(ctx.base.id));
  const { added, removed, changedConfig } = configDiff(c, ctx);

  const candidateIds = new Set(ctx.candidates.map((s) => s.id));
  const members = solutions
    .filter((s) => s.id === ctx.base.id || (bp ? s.businessProblemIds.includes(bp.id) : candidateIds.has(s.id)) || candidateIds.has(s.id))
    .filter((s) => s.status !== "deprecated")
    .sort((a, b) => Number(b.id === ctx.base.id) - Number(a.id === ctx.base.id) || Number(candidateIds.has(b.id)) - Number(candidateIds.has(a.id)) || b.activeUsers - a.activeUsers);

  // Newest A/B pair of the current configuration only; older pairs compared a Version B that no longer exists.
  const pairs = await latestPairs(c.id, evidence.currentFingerprint);
  const latest = pairs[0] ?? null;
  let latestComparison: DecisionView["evidence"]["latestComparison"] = null;
  if (latest) {
    const diff = enrichDiff(diffOutputs(latest.runA.output, latest.runB.output), ctx.base.id);
    latestComparison = {
      inputName: latest.runA.sampleInputId ? sampleInputById.get(latest.runA.sampleInputId)?.name ?? "sample input" : "pasted text",
      ranAt: latest.runB.createdAt,
      added: diff.added, removed: diff.removed, changed: diff.changed, unchanged: diff.unchanged,
      stepsResponsible: diff.stepsResponsible.map((s) => s.name),
    };
  }

  const measured: string[] = [];
  if (evidence.labelled) {
    measured.push(`Recall on ${evidence.labelled.inputs} labelled input${evidence.labelled.inputs === 1 ? "" : "s"}: ${evidence.labelled.recallA} (current) → ${evidence.labelled.recallB} (proposed)`);
    measured.push(`Precision on the same inputs: ${evidence.labelled.precisionA} (current) → ${evidence.labelled.precisionB} (proposed)`);
  }
  if (evidence.runtimeA !== null && evidence.runtimeB !== null) measured.push(`Median runtime: ${evidence.runtimeA} ms (current) vs ${evidence.runtimeB} ms (proposed)`);
  if (evidence.votes && evidence.votes.tests > 0) measured.push(`${evidence.votes.tests} recorded preference${evidence.votes.tests === 1 ? "" : "s"}: ${evidence.votes.bPreferred} for the proposed version, ${evidence.votes.aPreferred} for the current one, ${evidence.votes.neither} neither`);
  const baseline = ctx.base.baselineMetrics;
  const measuredValue = {
    lines: measured,
    note: measured.length
      ? `Measured on real runs and recorded votes only. The current product's recorded baseline is ${baseline.taskMinutes} minutes per task at ${baseline.successRate}% success; no projection of what the change would do to that is shown.`
      : "No measured value yet. Both versions have to run on the same input before FUSEBOX reports any difference; nothing is projected.",
  };

  const newDeps = [...new Set(added.flatMap((a) => getCapability(a.capability.id)?.dependsOn ?? []).map((id) => getCapability(id)?.name ?? id))].filter((n) => !ctx.baseCapabilities.some((cap) => cap.name === n));
  const riskLines = [
    ctx.base.riskTier === "high" ? `High-risk output: ${ctx.base.outputType.toLowerCase()} must stay draft-only inside FUSEBOX until the owner approves.` : null,
    added.length ? `${added.length} capabilit${added.length === 1 ? "y" : "ies"} from other products would enter the governed version; each keeps its source owner.` : null,
    removed.length ? `${removed.length} current capabilit${removed.length === 1 ? "y" : "ies"} would be switched off.` : null,
    ctx.base.knownGaps.length ? `Known gaps of the base product remain: ${ctx.base.knownGaps[0]}` : null,
  ].filter((x): x is string => !!x);

  const proposedSummary = c.lineage.summary || (added.length + removed.length + changedConfig.length === 0 ? "No change from the current version yet." : "");

  return {
    caseId: c.id,
    title: c.title,
    status: c.status,
    businessProblem: bp
      ? { id: bp.id, title: bp.title, businessFunction: bp.businessFunction, primaryUser: bp.primaryUser, description: bp.description }
      : { id: "", title: ctx.base.outcome, businessFunction: ctx.base.businessFunction, primaryUser: ctx.base.primaryUsers[0] ?? "", description: ctx.base.description },
    overlappingSolutions: members.map((s) => ({
      id: s.id, name: s.name, status: s.status, ownerName: s.ownerName, ownerTeam: s.ownerTeam, activeUsers: s.activeUsers,
      role: s.id === ctx.base.id ? "base" : candidateIds.has(s.id) ? "candidate" : "other",
      disposition: s.disposition?.label ?? null,
    })),
    recommendedBase: { id: ctx.base.id, name: ctx.base.name, status: ctx.base.status, version: ctx.base.currentVersion, outputType: ctx.base.outputType, why: baseWhy(ctx) },
    proposedImprovement: {
      summary: proposedSummary,
      added: added.map((a) => ({ name: a.capability.name, sourceSolutionName: a.sourceSolutionName, workflowStep: a.capability.workflowStep })),
      removed: removed.map((r) => r.capability.name),
      changedSettings: changedConfig,
    },
    evidence: { summary: evidenceSummary(evidence), description: describeEvidence(evidence), latestComparison },
    risksAndControls: {
      riskTier: ctx.base.riskTier,
      controls: ctx.base.controls,
      newDependencies: newDeps,
      knownGaps: ctx.base.knownGaps,
      mainRisk: riskLines[0] ?? "No additional risk recorded beyond the base product's controls.",
    },
    measuredValue,
    ownerRecommendation: experiment
      ? { recommendation: experiment.recommendation, narrative: `From the simulated pilot plan (seeded, not a live result): ${experiment.narrative}`, confidence: experiment.confidence }
      : { recommendation: null, narrative: "No owner recommendation recorded yet.", confidence: null },
    decisionRequired: decisionRequired(c, decisions),
    decisions,
    generatedAt: new Date().toISOString(),
  };
}
