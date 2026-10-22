import type {
  AffectedGroup,
  Capability,
  CapabilityProvenance,
  Case,
  ChangeReview,
  ConfigChange,
  ConsolidationDecisionView,
  ConsolidationSolution,
  FutureProduct,
  Decision,
  DecisionAction,
  Disposition,
  Experiment,
  GateItem,
  PilotPlan,
  Recommendation,
  Role,
  Solution,
  VersionSnapshot,
} from "@workspace/api-zod";
import { describeEvidence, evidenceSummary, votesFavourB, type ABEvidence } from "./evidence";
import { OWNER_PERSONA_NAME, getCapability, solutionCapabilities } from "../data/catalog";
import {
  type CaseContext,
  activeModules,
  addedExternalModules,
  buildComponents,
  conflictingBaseCapability,
  defaultConfigValues,
  defaultModuleStates,
  isRecommendedModule,
  isUnsupported,
} from "./configuration";
import { bumpVersion, proposedName } from "./simulation";
import { dispositionsForCase, toSolutionVersion, versionForCase } from "./governance";

const READINESS: Record<Solution["status"], number> = { certified: 1, pilot: 0.7, experimental: 0.35, deprecated: 0.1 };
const EVIDENCE: Record<Solution["evidenceLevel"], number> = { strong: 1, moderate: 0.7, limited: 0.4, none: 0.1 };

import { configDiff, provenance } from "./lineage";
import { z } from "zod";
import { analyze } from "./ai-analysis";

export function isDuplicate(cap: Capability, ctx: CaseContext): Capability | null {
  const conflict = conflictingBaseCapability(cap, ctx);
  if (!conflict) return null;
  return cap.riskClass === "high" ? null : conflict;
}

function recommendationFacts(c: Case, ctx: CaseContext, fitFromBrief: number | null): Recommendation {
  const toAdd: CapabilityProvenance[] = [];
  const duplicates: CapabilityProvenance[] = [];
  const incompatible: CapabilityProvenance[] = [];

  for (const cap of ctx.candidateCapabilities) {
    const conflict = conflictingBaseCapability(cap, ctx);
    if (conflict) {
      if (isDuplicate(cap, ctx)) duplicates.push(provenance(cap, `Duplicates ${conflict.name} in ${ctx.base.name} with weaker evidence. The base version is retained.`, "retiring"));
      else incompatible.push(provenance(cap, `Conflicts with ${conflict.name}: ${cap.evidence}`, "incompatible"));
    } else if (isRecommendedModule(cap, ctx)) {
      toAdd.push(provenance(cap, addReason(cap, ctx), "recommended"));
    } else if (isUnsupported(cap)) {
      incompatible.push(provenance(cap, `${cap.supportStatus}; no evidence of benefit.`, "incompatible"));
    } else {
      toAdd.push(provenance(cap, `Optional. ${cap.evidenceLevel} evidence; can be added later if the pilot shows demand.`, "optional"));
    }
  }

  const retain = ctx.baseCapabilities
    .filter((cap) => cap.controlType !== "optional")
    .slice(0, 6)
    .map((cap) =>
      provenance(
        cap,
        cap.controlType === "locked" ? (cap.lockedReason ?? "Required control.") : "Configurable within approved options.",
        cap.controlType === "locked" ? "required" : "configurable",
      ),
    );

  const retirementCandidates = ctx.candidates.filter((s) => s.retirementCandidate);
  const recommendedAdds = toAdd.filter((p) => p.state === "recommended");
  const currentAdds = addedExternalModules(c, ctx);
  const overallFit = Math.round(
    Math.min(94, (fitFromBrief ?? 70) * 0.5 + (READINESS[ctx.base.status] * 25 + EVIDENCE[ctx.base.evidenceLevel] * 12 + Math.min(recommendedAdds.length, 2) * 5) + 8),
  );
  const confidence = Math.round((READINESS[ctx.base.status] * 0.5 + EVIDENCE[ctx.base.evidenceLevel] * 0.4) * 100) / 100;

  const summary = `Use ${ctx.base.name} (${ctx.base.status}, ${ctx.base.activeUsers} users) as the base.${
    recommendedAdds.length
      ? ` Add ${recommendedAdds.map((p) => `${p.capability.name.toLowerCase()} from ${p.sourceSolutionName}`).join(" and ")}.`
      : ""
  }${retirementCandidates.length ? ` Retire ${retirementCandidates.map((s) => s.name).join(", ")} after the pilot.` : ""}`;

  const rationale = [
    `${ctx.base.name} is ${ctx.base.status} with ${ctx.base.evidenceLevel} evidence and already covers ${ctx.base.workflowSteps.length} of 5 workflow steps.`,
    ...recommendedAdds.map((p) => `${p.capability.name} closes a known gap: ${p.capability.evidence}`),
    ...duplicates.map((p) => `${p.capability.name} duplicates ${ctx.base.name}; it is not carried forward.`),
    ...incompatible.map((p) => `${p.capability.name} conflicts with a locked control and is excluded.`),
    ...retirementCandidates.map((s) => `${s.name} has ${s.ownerName === "Unassigned" ? "no active owner" : "limited evidence"} and ${s.activeUsers} users who can move to the consolidated version.`),
  ];

  return {
    caseId: c.id,
    baseSolution: ctx.base,
    overlappingSolutions: ctx.candidates,
    overallFit,
    summary,
    capabilitiesToAdd: toAdd,
    capabilitiesToRetain: retain,
    duplicates,
    incompatible,
    retirementCandidates,
    confidence,
    rationale,
    roleSummaries: {
      seeker: `${ctx.base.name} already does most of what you described. With ${recommendedAdds.length} added module${recommendedAdds.length === 1 ? "" : "s"} it covers the full workflow, and you can test it before anyone commits.`,
      owner:
        currentAdds.length === 0
          ? `Your product stays the base. Nothing has been added from other teams yet; locked controls and approvals are unchanged.`
          : `Your product stays the base. Proposed changes add ${currentAdds.length} module${currentAdds.length === 1 ? "" : "s"} from other teams; locked controls and approvals are unchanged.`,
      it: `Consolidates ${ctx.candidates.length + 1} overlapping products into one certified base, retires ${retirementCandidates.length}, and reuses ${recommendedAdds.length} capabilit${recommendedAdds.length === 1 ? "y" : "ies"} instead of rebuilding.`,
    },
    adoptionEffort: `${ctx.base.adoptionEffort === "low" ? "Low" : ctx.base.adoptionEffort === "medium" ? "Medium" : "High"} for existing ${ctx.base.name} users; ${ctx.base.timeToAdopt} for new sites. Added modules need ${recommendedAdds.some((p) => isUnsupported(p.capability)) ? "an ownership transfer and " : ""}integration work by Operations Platforms.`,
  };
}

export async function buildRecommendation(c: Case, ctx: CaseContext, fitFromBrief: number | null): Promise<Recommendation> {
  const facts = recommendationFacts(c, ctx, fitFromBrief);
  const allowed = new Set(facts.capabilitiesToAdd.map(p => p.capability.id));
  const schema = z.object({
    summary: z.string().min(1),
    rationale: z.array(z.string().min(1)).min(1),
    roleSummaries: z.object({ seeker: z.string(), owner: z.string(), it: z.string() }),
    additions: z.array(z.object({ id: z.string(), recommended: z.boolean(), reason: z.string().min(1) })),
  }).superRefine((r, check) => {
    if (r.additions.length !== allowed.size || new Set(r.additions.map(a => a.id)).size !== allowed.size || r.additions.some(a => !allowed.has(a.id)))
      check.addIssue({ code: "custom", message: "Every allowed capability must be accounted for exactly once." });
  });
  const result = await analyze({
    purpose: "workbench-recommendation", promptVersion: "grounded-recommendation-v1",
    schema,
    instructions: `Return JSON {summary,rationale:string[],roleSummaries:{seeker,owner,it},additions:[{id,recommended:boolean,reason}]}. Assess the actual intent and configured capabilities against source evidence. Account for every allowed addition exactly once. Required controls and server exclusions cannot be changed. Do NOT claim full coverage, measured benefit, retirement or approval without evidence. Recommendations are proposals for testing, not implementation proof. No numerical fit/confidence/savings claims. Explain uncertainties and relevant differences.`,
    input: {
      caseId: c.id, intent: c.intent, title: c.title, base: ctx.base,
      configuration: { modules: c.moduleStates, values: c.configValues },
      allowedAdditions: facts.capabilitiesToAdd.map(p => p.capability),
      retained: facts.capabilitiesToRetain.map(p => p.capability),
      excluded: [...facts.duplicates, ...facts.incompatible],
    },
  });
  const choices = new Map(result.data.additions.map(a => [a.id, a]));
  return {
    ...facts, ...result.data,
    capabilitiesToAdd: facts.capabilitiesToAdd.map(p => {
      const choice = choices.get(p.capability.id)!;
      return { ...p, state: choice.recommended ? "recommended" : "optional", reason: choice.reason };
    }),
    rationale: [...result.data.rationale, `AI analysis · ${result.provenance.model} · ${result.provenance.createdAt} · ${result.provenance.cached ? "saved unchanged analysis" : "new analysis"} · ${result.provenance.inputFingerprint}`],
    retirementCandidates: [],
  };
}

function addReason(cap: Capability, ctx: CaseContext): string {
  const gap = ctx.base.knownGaps.find((g) => g.toLowerCase().includes(cap.category.toLowerCase().split(" ")[0] ?? "") || g.toLowerCase().includes(cap.name.split(" ")[0]!.toLowerCase()));
  return gap ? `Closes a known gap in ${ctx.base.name}: ${gap}` : `Adds ${cap.name.toLowerCase()} that ${ctx.base.name} lacks, with ${cap.evidenceLevel} evidence.`;
}


export function buildPilotPlan(c: Case, ctx: CaseContext, evidence: ABEvidence): PilotPlan {
  const eligibleGroup = ctx.base.businessUnits[0] ?? "Primary business unit";
  const pilotPercent = c.pilotPercent;
  const pilotUsers = Math.max(10, Math.round(ctx.base.activeUsers * (pilotPercent / 100)));
  const added = addedExternalModules(c, ctx);
  const locked = ctx.baseCapabilities.filter((cap) => cap.controlType === "locked");
  const approval = locked.find((cap) => cap.category === "Approval");
  const recallFloor = evidence.labelled ? Math.max(evidence.labelled.recallA, evidence.labelled.recallB) : null;
  return {
    eligibleGroup,
    pilotPercent,
    pilotUsers,
    durationWeeks: 4,
    successThresholds: [
      "Pilot users prefer the proposed output in at least 60% of recorded side-by-side comparisons (minimum 20 votes).",
      recallFloor !== null ? `Recall on labelled work-order sets stays at or above ${recallFloor} (the better of the two versions today).` : "Recall on labelled work-order sets no lower than the current version once labelled inputs exist.",
      evidence.runtimeB !== null && evidence.runtimeA !== null ? `Runtime per input no more than twice the current version (${evidence.runtimeA} ms measured).` : "Runtime per input no more than twice the current version.",
      ...(approval ? [`${approval.name} completed on 100% of items`] : []),
    ],
    guardrails: [
      `All locked controls (${locked.map((cap) => cap.name.toLowerCase()).join(", ")}) unchanged.`,
      "No changes to data access scope; pilot users keep existing site-level permissions.",
      `Pilot limited to ${pilotPercent}% of ${eligibleGroup}; other sites remain on v${ctx.base.currentVersion}.`,
      ...(added.some((a) => isUnsupported(a)) ? ["Ownership of prototype-sourced modules transfers to Operations Platforms before day one."] : []),
    ],
    monitoring: [
      "Daily: recorded A/B preferences and runtime per input for pilot users.",
      "Weekly: recall and precision on any labelled input sets, approval completion, and reported issues.",
      "Continuous: audit log completeness and control checks.",
    ],
    rollbackTrigger: `Any control check fails, recorded preference for the current version exceeds 50% over a full week, or a locked step errors on more than 1% of inputs. Rollback restores v${ctx.base.currentVersion} for pilot users within one business day.`,
    ownerApprovalRequired: true,
    itApprovalRequired: true,
  };
}

const ROLE_ACTIONS: Record<Role, DecisionAction[]> = {
  seeker: ["propose_pilot", "propose_capability", "request_new_family"],
  owner: ["propose_pilot", "propose_capability", "request_new_family", "approve_pilot", "request_changes", "defer", "reject"],
  it: ["approve_consolidation", "withdraw_consolidation", "defer", "reject"],
};

/** IT's consolidation approval stands until it is withdrawn; the latest of the two decisions decides. */
export function consolidationApproved(decisions: Decision[]): boolean {
  const latest = [...decisions]
    .filter((d) => d.action === "approve_consolidation" || d.action === "withdraw_consolidation")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return latest?.action === "approve_consolidation";
}

/** Decisions recorded on a whole improvement group by the owner; never offered on a single case. */
export const GROUP_ACTIONS: DecisionAction[] = ["adopt_approach", "merge_approaches", "request_more_evidence", "keep_local", "decline"];

/** Statuses in which an experiment is still being worked on or awaiting a decision. */
export const ACTIVE_STATUSES: Case["status"][] = ["draft", "tested", "pilot_proposed", "approved", "changes_requested", "deferred"];

export function allowedActions(c: Case, decisions: Decision[]): { role: Role; actions: DecisionAction[] }[] {
  const itApproved = consolidationApproved(decisions);
  const byRole = (role: Role): DecisionAction[] => {
    const candidates = ROLE_ACTIONS[role];
    return candidates.filter((action) => {
      switch (action) {
        case "propose_pilot":
          return c.status === "tested";
        case "propose_capability":
          // Only an experiment that adds a capability can propose it as reusable.
          return c.status === "tested" && c.lineage.added.length > 0;
        case "request_new_family":
          return c.status === "tested";
        case "approve_pilot":
        case "request_changes":
          return c.status === "pilot_proposed" || c.status === "deferred";
        case "approve_consolidation":
          // IT publishes the owner-approved change as the governed successor version; the owner decides first.
          return c.status === "approved" && !itApproved;
        case "withdraw_consolidation":
          // Reversible: the successor returns to draft and every disposition to a proposal.
          return c.status === "folded" && itApproved;
        case "defer":
          return c.status === "pilot_proposed" || c.status === "approved";
        case "reject":
          return c.status !== "rejected" && c.status !== "draft" && c.status !== "folded";
        default:
          return false;
      }
    });
  };
  return (["seeker", "owner", "it"] as Role[]).map((role) => ({ role, actions: byRole(role) }));
}

/** Grouped owner decisions available for a set of experiments sharing an intent. */
export function allowedGroupActions(members: Case[]): DecisionAction[] {
  // Once an approach is adopted the group is settled; what follows is consolidation, not another group decision.
  if (members.some((c) => c.status === "approved" || c.status === "folded")) return [];
  const decidable = members.some((c) => c.status === "pilot_proposed" || c.status === "tested" || c.status === "deferred" || c.status === "changes_requested");
  if (!decidable) return [];
  return GROUP_ACTIONS.filter((a) => a !== "adopt_approach" || members.some((c) => c.status === "pilot_proposed" || c.status === "tested" || c.status === "deferred"));
}

export function nextStatus(c: Case, action: DecisionAction): Case["status"] {
  switch (action) {
    case "propose_pilot":
    case "propose_capability":
    case "request_new_family":
      return "pilot_proposed";
    case "approve_pilot":
    case "adopt_approach":
      return "approved";
    case "approve_consolidation":
      return "folded";
    case "withdraw_consolidation":
      return "approved";
    case "request_changes":
    case "merge_approaches":
    case "request_more_evidence":
      return "changes_requested";
    case "defer":
      return "deferred";
    case "keep_local":
      // Stays an experiment under the parent: testable, not proposed.
      return c.status === "draft" ? "draft" : "tested";
    case "reject":
    case "decline":
      return "rejected";
  }
}

export function promotionStateFor(action: DecisionAction, current: Case["promotionState"]): Case["promotionState"] {
  switch (action) {
    case "propose_pilot":
      return "proposed_to_parent";
    case "propose_capability":
      return "proposed_capability";
    case "request_new_family":
      return "new_family_requested";
    case "keep_local":
    case "request_more_evidence":
    case "merge_approaches":
      return "experiment";
    default:
      return current;
  }
}

export function nextStep(c: Case, evidence: ABEvidence, latest: Decision | null, itApproved = false): string {
  const favour = votesFavourB(evidence);
  switch (c.status) {
    case "draft":
      return "Build Version B in the workbench and run both versions on the same input.";
    case "tested":
      return favour === null
        ? `Record which output better solves the problem, then propose the improvement to ${c.lineage.parentSolutionName}.`
        : favour
          ? `Recorded votes favour the modified version. Propose the improvement to ${c.lineage.parentSolutionName}.`
          : "Recorded votes do not favour the modified version yet. Revise Version B or test more inputs before proposing it.";
    case "pilot_proposed":
      return c.promotionState === "new_family_requested"
        ? "A new solution family was requested. Awaiting the owner's view on whether the parent can absorb the change."
        : c.promotionState === "proposed_capability"
          ? "Proposed as a reusable capability. Awaiting the owner's review."
          : itApproved ? "IT approved the direction. Awaiting the owner's decision on the proposed improvement." : `Awaiting owner review of the proposed improvement to ${c.lineage.parentSolutionName}.`;
    case "approved":
      return itApproved ? "Approved by owner and IT. Pilot can start." : "Owner approved the pilot; a draft successor version is recorded. Awaiting IT's consolidation decision.";
    case "folded":
      return c.foldedInto ? `Published as ${c.foldedInto}. The capability is part of the parent product now.` : "Published as a successor version of the parent product.";
    case "changes_requested":
      return `Owner requested changes${latest?.reason ? `: ${latest.reason}` : ""}. Revise Version B and run the comparison again.`;
    case "deferred":
      return "Deferred. Revisit at the next portfolio review.";
    case "rejected":
      return "Rejected. No further action.";
  }
}

/** Minimum distinct inputs the current configuration must have run on before promotion. */
export const GATE_MIN_INPUTS = 3;

/**
 * Production-promotion checklist with the real values behind each check. Unmet items are returned, not hidden:
 * the owner sees what is missing; nothing here blocks a pilot decision.
 */
export function promotionGate(c: Case, ctx: CaseContext, decisions: Decision[], evidence: ABEvidence): GateItem[] {
  const components = buildComponents(c, ctx);
  const violations = components.filter((comp) => (comp.state === "incompatible" && c.moduleStates[comp.capability.id] === true) || (comp.active && comp.blockedReason)).map((comp) => comp.capability.name);
  const votes = evidence.votes?.tests ?? 0;
  const ownerDecision = decisions.find((d) => d.role === "owner");
  const businessOwner = ctx.base.ownerName.trim();
  const technicalOwner = ctx.base.ownerTeam.trim();
  const n = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  return [
    { key: "inputs", label: `Tested on at least ${GATE_MIN_INPUTS} representative inputs with the current configuration`, met: evidence.inputsTested >= GATE_MIN_INPUTS, value: `${n(evidence.inputsTested, "input")} run on the current configuration` },
    { key: "controls", label: "No blocking control violation", met: violations.length === 0, value: violations.length === 0 ? "None" : `Blocked: ${violations.join(", ")}` },
    { key: "current_only", label: "Evidence comes from the current configuration only", met: evidence.setAside === 0, value: evidence.setAside === 0 ? "No earlier-configuration votes" : `${n(evidence.setAside, "vote")} from earlier configurations (set aside)` },
    { key: "reviewed", label: "Outputs reviewed by a person", met: evidence.humanVotes > 0, value: evidence.humanVotes > 0 ? `${n(evidence.humanVotes, "person")} compared both outputs` : votes > 0 ? "Only demo-account votes so far" : "No one has compared the outputs yet" },
    { key: "evaluation", label: "At least one recorded evaluation", met: votes > 0, value: votes > 0 ? `${n(votes, "recorded vote")}${evidence.votes?.demoVotes ? ` (${evidence.votes.demoVotes} demo)` : ""}` : "No votes recorded" },
    { key: "owners", label: "Named business and technical owner", met: businessOwner.length > 0 && technicalOwner.length > 0, value: [businessOwner || "Business owner missing", technicalOwner || "Technical owner missing"].join(" / ") },
    { key: "decision", label: "Owner decision recorded", met: !!ownerDecision, value: ownerDecision ? `${ownerDecision.action.replace(/_/g, " ")} by ${ownerDecision.actor}` : "No owner decision yet" },
  ];
}

export function buildReview(c: Case, ctx: CaseContext, experiment: Experiment | null, decisions: Decision[], evidence: ABEvidence): ChangeReview {
  const active = activeModules(c, ctx);
  const proposedCaps = [...ctx.baseCapabilities.filter((cap) => cap.controlType !== "optional"), ...active];
  // The same diff the case's lineage shows, so the review and the header never disagree.
  const { added, removed, changedConfig, currentCaps } = configDiff(c, ctx);

  const unchanged = ctx.baseCapabilities
    .filter((cap) => cap.controlType !== "optional" && !changedConfig.some((ch) => ch.capabilityName === cap.name))
    .map((cap) => cap.name);

  const currentVersion: VersionSnapshot = {
    version: ctx.base.currentVersion,
    label: `${ctx.base.name} v${ctx.base.currentVersion} (current production)`,
    workflowSteps: ctx.base.workflowSteps,
    capabilities: currentCaps.map((cap) => cap.name),
    userGroups: ctx.base.businessUnits,
    performance: ctx.base.baselineMetrics,
  };
  const externalAdds = addedExternalModules(c, ctx);
  const proposedSteps = Array.from(new Set([...ctx.base.workflowSteps, ...active.map((a) => a.workflowStep)]));
  const proposedVersion: VersionSnapshot = {
    version: `${bumpVersion(ctx.base.currentVersion)} (proposed)`,
    label: proposedName(ctx, externalAdds),
    workflowSteps: ["Ingest", "Analyze", "Review", "Decide", "Track"].filter((s) => proposedSteps.includes(s)),
    capabilities: proposedCaps.map((cap) => cap.name),
    userGroups: Array.from(new Set([...ctx.base.businessUnits, ...ctx.candidates.filter((s) => s.retirementCandidate).flatMap((s) => s.businessUnits)])),
    // Never projected: the proposed version has no production measurements until it is piloted.
    performance: null,
  };

  const share = ctx.base.activeUsers / Math.max(1, ctx.base.businessUnits.length);
  const affectedUsers: AffectedGroup[] = [
    ...ctx.base.businessUnits.map((unit, i) => ({
      group: unit,
      users: Math.round(share * (i === 0 ? 1.2 : 0.9)),
      impact: i === 0 ? "Pilot group (20%) first; remaining users after pilot review." : "No change until the pilot is approved for rollout.",
    })),
    ...ctx.candidates
      .filter((s) => s.retirementCandidate)
      .map((s) => ({ group: `${s.name} users (${s.businessUnits.join(", ")})`, users: s.activeUsers, impact: `Migrate to the consolidated version; ${s.name} retired after migration.` })),
  ];

  const newDependencies = Array.from(
    new Set(
      externalAdds.flatMap((cap) => {
        const source = ctx.candidates.find((s) => s.capabilityIds.includes(cap.id));
        return [`${cap.name} module (owned by ${source?.ownerTeam ?? "unknown"})`, ...(source?.dependencies.filter((d) => !/personal|shared spreadsheet|manual/i.test(d)) ?? [])];
      }),
    ),
  );

  const pilotPlan = buildPilotPlan(c, ctx, evidence);
  const ownerSummary = `${c.title}: ${added.length} capabilit${added.length === 1 ? "y" : "ies"} added, ${removed.length} removed, ${changedConfig.length} setting${changedConfig.length === 1 ? "" : "s"} changed. ${unchanged.length} locked or configurable controls unchanged. ${describeEvidence(evidence)} Pilot proposed for ${pilotPlan.pilotUsers} users in ${pilotPlan.eligibleGroup} over ${pilotPlan.durationWeeks} weeks.`;

  return {
    case: c,
    baseSolution: ctx.base,
    currentVersion,
    proposedVersion,
    added,
    removed,
    changedConfig,
    unchanged,
    affectedUsers,
    newDependencies,
    experiment,
    pilotPlan,
    ownerSummary,
    decisions,
    availableActions: allowedActions(c, decisions),
    evidence: evidenceSummary(evidence),
    promotionGate: promotionGate(c, ctx, decisions, evidence),
  };
}

export function metricsFromExperiment(experiment: Experiment) {
  const get = (key: string) => experiment.metrics.find((m) => m.key === key)?.proposed ?? 0;
  return {
    taskMinutes: get("taskMinutes"),
    successRate: get("successRate"),
    effortScore: get("effortScore"),
    errorRate: get("errorRate"),
    adoption: get("adoption"),
    costPerTask: get("costPerTask"),
  };
}

export function ownerOf(solution: Solution): string {
  return solution.ownerName === "Unassigned" ? OWNER_PERSONA_NAME : solution.ownerName;
}

export { getCapability };

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** Current-state to future-state summary for the Decide view. Deliberately limited to what an IT leader needs first. */
export function buildConsolidation(c: Case, ctx: CaseContext, decisions: Decision[], evidence: ABEvidence): ConsolidationDecisionView {
  // Recommendation-first: before the seeker has added anything, the direction shown is the recommended configuration.
  const configured = addedExternalModules(c, ctx);
  const recommendedStates = defaultModuleStates(ctx);
  const added = configured.length ? configured : ctx.candidateCapabilities.filter((cap) => recommendedStates[cap.id]);
  const planned = configured.length === 0 && added.length > 0;
  const addedSources = new Set(added.map((cap) => cap.sourceSolutionId));
  const retiring = ctx.candidates.filter((s) => s.retirementCandidate);
  const locked = ctx.baseCapabilities.filter((cap) => cap.controlType === "locked");
  const totalProducts = ctx.candidates.length + 1;

  // Once the owner has approved, the record decides: the successor version lists what is folded in, and each
  // product's disposition says what happens to it. Before that, the view is computed from the configuration.
  const record = versionForCase(c.id);
  const dispositions = dispositionsForCase(c.id);
  const dispositionOf = (id: string) => dispositions.find((d) => d.solutionId === id) ?? null;
  const recordedNote = (s: Solution, d: Disposition): string => {
    const folded = (record?.foldedCapabilities ?? []).filter((cap) => cap.sourceSolutionId === s.id).map((cap) => cap.name);
    const carried = folded.length ? `${folded.join(" and ")} carried into ${ctx.base.name} v${record?.version ?? ""}` : "";
    switch (d.kind) {
      case "retain":
        return d.preferred
          ? record?.state === "current"
            ? `Preferred product for this problem; v${record.version} is the governed version now.`
            : `Preferred product for this problem; becomes v${record?.version ?? bumpVersion(ctx.base.currentVersion)}.`
          : `Retained as a separate product${d.reason ? `: ${d.reason}` : "."}`;
      case "fold_into":
        return `${carried || "Its useful capabilities move"}; standalone use ends after migration.`;
      case "configure":
        return `${carried ? `${carried}; the` : "The"} remaining use is configured on ${d.targetSolutionName ?? ctx.base.name} instead of maintained separately.`;
      case "rebuild":
        return `${carried ? `${carried}; the` : "The"} rest is rebuilt on ${d.targetSolutionName ?? ctx.base.name}.`;
      case "retire":
        return d.migrationNote ? `Migration recorded: ${d.migrationNote}` : `${carried ? `${carried}; the` : "The"} product retires once its ${s.activeUsers} users have migrated.`;
    }
  };

  const computed: ConsolidationSolution[] = [
    { solution: ctx.base, fate: "base", note: `Becomes the certified core of the future product.`, disposition: dispositionOf(ctx.base.id) },
    ...ctx.candidates.map((s): ConsolidationSolution => {
      const reused = added.filter((cap) => cap.sourceSolutionId === s.id);
      const disposition = dispositionOf(s.id);
      if (s.retirementCandidate) {
        return {
          solution: s,
          fate: "retired",
          note: reused.length
            ? `${reused.map((cap) => cap.name).join(" and ")} carried over; the product itself is retired after the pilot.`
            : `Retired after the pilot; its ${s.activeUsers} users move to the consolidated version.`,
          disposition,
        };
      }
      return {
        solution: s,
        fate: addedSources.has(s.id) ? "folded" : "retired",
        note: reused.length
          ? `${reused.map((cap) => cap.name).join(" and ")} ${reused.length === 1 ? "becomes" : "become"} optional module${reused.length === 1 ? "" : "s"} of the future product.`
          : `Nothing unique is carried forward; standalone use ends after the pilot.`,
        disposition,
      };
    }),
  ];
  const current: ConsolidationSolution[] = computed.map((entry) => (entry.disposition ? { ...entry, note: recordedNote(entry.solution, entry.disposition) } : entry));

  const future: FutureProduct = {
    name: record ? `${ctx.base.name} v${record.version}` : proposedName(ctx, added),
    core: `Certified ${ctx.base.name} workflow (${ctx.base.workflowSteps.join(" → ")})`,
    modules: record ? record.foldedCapabilities.map((cap) => ({ name: cap.name, sourceSolutionName: cap.sourceSolutionName })) : added.map((cap) => ({ name: cap.name, sourceSolutionName: cap.sourceSolutionName })),
    controls: locked.map((cap) => cap.name),
  };

  const outcomes = [
    `${numberWord(totalProducts)} solution${totalProducts === 1 ? "" : "s"} become${totalProducts === 1 ? "s" : ""} one governed product`,
    added.length
      ? `${numberWord(added.length)} useful capabilit${added.length === 1 ? "y is" : "ies are"} ${planned ? "kept" : "preserved"} as optional modules`
      : "No duplicate capabilities are rebuilt",
    `${numberWord(ctx.candidates.length)} standalone product${ctx.candidates.length === 1 ? "" : "s"} can be retired`,
    `Existing controls remain in place (${locked.length} locked)`,
  ];

  const unowned = added.find((cap) => ctx.candidates.find((s) => s.id === cap.sourceSolutionId)?.ownerName === "Unassigned");
  const favour = votesFavourB(evidence);
  const risk = unowned
    ? `${unowned.name} comes from an unowned product; ${ctx.base.ownerTeam} must take ownership before the pilot.`
    : favour === false
      ? "Recorded votes do not yet favour the proposed version; the direction rests on reuse, not on a demonstrated output improvement."
      : evidence.inputsTested === 0
        ? "No side-by-side run has been recorded; the direction rests on catalog evidence alone."
        : "Infrequent users may require additional guidance during the pilot.";

  const itDecision = consolidationApproved(decisions) ? decisions.find((d) => d.action === "approve_consolidation") : undefined;
  const evidenceLines = [
    `${ctx.base.name} is ${ctx.base.status} with ${ctx.base.evidenceLevel} evidence and ${ctx.base.activeUsers} active users.`,
    ...added.map((cap) => `${cap.name} (from ${cap.sourceSolutionName}): ${cap.evidence}`),
    describeEvidence(evidence),
    ...(planned ? ["The modules shown are the recommended additions; none have been added to the case configuration yet."] : []),
    ...retiring.map((s) => `${s.name}: ${s.ownerName === "Unassigned" ? "no active owner" : "limited evidence"}, ${s.activeUsers} users, ${s.evidenceLevel} evidence.`),
    ...decisions.map((d) => `${d.actor} (${d.role}): ${d.action.replace(/_/g, " ")}${d.reason ? ` — ${d.reason}` : ""}`),
  ];

  return {
    caseId: c.id,
    headline: `${numberWord(totalProducts)} solutions can become one governed product.`,
    current,
    future,
    outcomes,
    risk,
    evidence: evidenceLines,
    availableActions: allowedActions(c, decisions),
    decided: itDecision ? `${itDecision.actor} approved the consolidation direction on ${new Date(itDecision.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.` : null,
    successor: record ? toSolutionVersion(record) : null,
  };
}
