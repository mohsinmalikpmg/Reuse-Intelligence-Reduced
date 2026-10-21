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

const READINESS: Record<Solution["status"], number> = { certified: 1, pilot: 0.7, experimental: 0.35, deprecated: 0.1 };
const EVIDENCE: Record<Solution["evidenceLevel"], number> = { strong: 1, moderate: 0.7, limited: 0.4, none: 0.1 };

function provenance(cap: Capability, reason: string, state: CapabilityProvenance["state"]): CapabilityProvenance {
  return { capability: cap, sourceSolutionName: cap.sourceSolutionName, reason, evidence: cap.evidence, state };
}

export function isDuplicate(cap: Capability, ctx: CaseContext): Capability | null {
  const conflict = conflictingBaseCapability(cap, ctx);
  if (!conflict) return null;
  return cap.riskClass === "high" ? null : conflict;
}

export function buildRecommendation(c: Case, ctx: CaseContext, fitFromBrief: number | null): Recommendation {
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
  seeker: ["propose_pilot"],
  owner: ["propose_pilot", "approve_pilot", "request_changes", "defer", "reject"],
  it: ["approve_consolidation", "defer", "reject"],
};

export function allowedActions(c: Case, decisions: Decision[]): { role: Role; actions: DecisionAction[] }[] {
  const itApproved = decisions.some((d) => d.action === "approve_consolidation");
  const byRole = (role: Role): DecisionAction[] => {
    const candidates = ROLE_ACTIONS[role];
    return candidates.filter((action) => {
      switch (action) {
        case "propose_pilot":
          return c.status === "tested";
        case "approve_pilot":
        case "request_changes":
          return c.status === "pilot_proposed" || c.status === "deferred";
        case "approve_consolidation":
          // IT approves the consolidation direction once a simulated test exists; it does not replace the owner's pilot decision.
          return (c.status === "tested" || c.status === "pilot_proposed" || c.status === "approved" || c.status === "deferred") && !itApproved;
        case "defer":
          return c.status === "pilot_proposed" || c.status === "approved";
        case "reject":
          return c.status !== "rejected" && c.status !== "draft";
      }
    });
  };
  return (["seeker", "owner", "it"] as Role[]).map((role) => ({ role, actions: byRole(role) }));
}

export function nextStatus(c: Case, action: DecisionAction): Case["status"] {
  switch (action) {
    case "propose_pilot":
      return "pilot_proposed";
    case "approve_pilot":
      return "approved";
    case "approve_consolidation":
      return c.status;
    case "request_changes":
      return "changes_requested";
    case "defer":
      return "deferred";
    case "reject":
      return "rejected";
  }
}

export function nextStep(c: Case, evidence: ABEvidence, latest: Decision | null, itApproved = false): string {
  const favour = votesFavourB(evidence);
  switch (c.status) {
    case "draft":
      return "Build Version B in the workbench and run both versions on the same input.";
    case "tested":
      return favour === null
        ? "Record which output better solves the problem, then propose a limited pilot."
        : favour
          ? "Recorded votes favour the proposed version. Propose a limited pilot."
          : "Recorded votes do not favour the proposed version yet. Revise Version B or test more inputs before proposing a pilot.";
    case "pilot_proposed":
      return itApproved ? "IT approved the direction. Awaiting the owner's pilot decision." : "Awaiting owner review of the proposed version and pilot plan.";
    case "approved":
      return itApproved ? "Approved by owner and IT. Pilot can start." : "Owner approved the pilot. Awaiting IT consolidation decision.";
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
  const defaults = defaultModuleStates(ctx);
  const defaultValues = defaultConfigValues(ctx);
  const components = buildComponents(c, ctx);
  const baseIds = new Set(ctx.baseCapabilities.map((b) => b.id));

  const currentCaps = ctx.baseCapabilities.filter((cap) => cap.controlType !== "optional" || defaultBaseActive(cap));
  const active = activeModules(c, ctx);
  const proposedCaps = [...ctx.baseCapabilities.filter((cap) => cap.controlType !== "optional"), ...active];

  const added: CapabilityProvenance[] = active
    .filter((cap) => !currentCaps.some((cc) => cc.id === cap.id))
    .map((cap) => provenance(cap, baseIds.has(cap.id) ? `Optional ${ctx.base.name} module switched on.` : `Added from ${cap.sourceSolutionName}: ${cap.description}`, baseIds.has(cap.id) ? "optional" : "recommended"));
  const removed: CapabilityProvenance[] = currentCaps
    .filter((cap) => cap.controlType === "optional" && !active.some((a) => a.id === cap.id))
    .map((cap) => provenance(cap, "Optional module switched off in the proposed version.", "optional"));

  const changedConfig: ConfigChange[] = components
    .filter((comp) => comp.controlType === "configurable" && comp.value && comp.value !== (defaultValues[comp.capability.id] ?? comp.capability.defaultOption))
    .map((comp) => ({ capabilityName: comp.capability.name, from: defaultValues[comp.capability.id] ?? comp.capability.defaultOption ?? "", to: comp.value ?? "" }));

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

  function defaultBaseActive(cap: Capability): boolean {
    return defaults[cap.id] === true;
  }
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

  const current: ConsolidationSolution[] = [
    { solution: ctx.base, fate: "base", note: `Becomes the certified core of the future product.` },
    ...ctx.candidates.map((s): ConsolidationSolution => {
      const reused = added.filter((cap) => cap.sourceSolutionId === s.id);
      if (s.retirementCandidate) {
        return {
          solution: s,
          fate: "retired",
          note: reused.length
            ? `${reused.map((cap) => cap.name).join(" and ")} carried over; the product itself is retired after the pilot.`
            : `Retired after the pilot; its ${s.activeUsers} users move to the consolidated version.`,
        };
      }
      return {
        solution: s,
        fate: addedSources.has(s.id) ? "folded" : "retired",
        note: reused.length
          ? `${reused.map((cap) => cap.name).join(" and ")} ${reused.length === 1 ? "becomes" : "become"} optional module${reused.length === 1 ? "" : "s"} of the future product.`
          : `Nothing unique is carried forward; standalone use ends after the pilot.`,
      };
    }),
  ];

  const future: FutureProduct = {
    name: proposedName(ctx, added),
    core: `Certified ${ctx.base.name} workflow (${ctx.base.workflowSteps.join(" → ")})`,
    modules: added.map((cap) => ({ name: cap.name, sourceSolutionName: cap.sourceSolutionName })),
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

  const itDecision = decisions.find((d) => d.action === "approve_consolidation");
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
  };
}
