import type {
  AffectedGroup,
  Capability,
  CapabilityPresence,
  CapabilityProvenance,
  Case,
  ChangeReview,
  CompareRow,
  Comparison,
  ConfigChange,
  Decision,
  DecisionAction,
  Experiment,
  PilotPlan,
  Recommendation,
  Role,
  Solution,
  VersionSnapshot,
} from "@workspace/api-zod";
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
  projectedMetrics,
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
      owner: `Your product stays the base. Proposed changes add ${recommendedAdds.length} module${recommendedAdds.length === 1 ? "" : "s"} from other teams; locked controls and approvals are unchanged.`,
      it: `Consolidates ${ctx.candidates.length + 1} overlapping products into one certified base, retires ${retirementCandidates.length}, and reuses ${recommendedAdds.length} capabilit${recommendedAdds.length === 1 ? "y" : "ies"} instead of rebuilding.`,
    },
    adoptionEffort: `${ctx.base.adoptionEffort === "low" ? "Low" : ctx.base.adoptionEffort === "medium" ? "Medium" : "High"} for existing ${ctx.base.name} users; ${ctx.base.timeToAdopt} for new sites. Added modules need ${recommendedAdds.some((p) => isUnsupported(p.capability)) ? "an ownership transfer and " : ""}integration work by Operations Platforms.`,
  };
}

function addReason(cap: Capability, ctx: CaseContext): string {
  const gap = ctx.base.knownGaps.find((g) => g.toLowerCase().includes(cap.category.toLowerCase().split(" ")[0] ?? "") || g.toLowerCase().includes(cap.name.split(" ")[0]!.toLowerCase()));
  return gap ? `Closes a known gap in ${ctx.base.name}: ${gap}` : `Adds ${cap.name.toLowerCase()} that ${ctx.base.name} lacks, with ${cap.evidenceLevel} evidence.`;
}

export function buildComparison(c: Case, ctx: CaseContext): Comparison {
  const solutionsList = [ctx.base, ...ctx.candidates];
  const rows: CompareRow[] = [];
  const consumed = new Set<string>();

  const strengthOf = (cap: Capability): CapabilityPresence["strength"] =>
    cap.evidenceLevel === "strong" ? "strong" : cap.evidenceLevel === "moderate" ? "standard" : "weak";

  for (const baseCap of ctx.baseCapabilities) {
    const presence: CapabilityPresence[] = solutionsList.map((s) => {
      if (s.id === ctx.base.id) return { solutionId: s.id, present: true, strength: strengthOf(baseCap) };
      const dup = solutionCapabilities(s).find((cap) => conflictingBaseCapability(cap, ctx)?.id === baseCap.id && isDuplicate(cap, ctx));
      if (dup) {
        consumed.add(dup.id);
        return { solutionId: s.id, present: true, strength: "weak" };
      }
      return { solutionId: s.id, present: false, strength: "none" };
    });
    const dupCount = presence.filter((p) => p.present).length - 1;
    rows.push({
      capability: baseCap,
      presence,
      verdict: dupCount > 0 ? "common" : "unique",
      verdictNote: dupCount > 0 ? `Also built in ${dupCount} other product${dupCount === 1 ? "" : "s"} with weaker evidence. Keep the ${ctx.base.name} version.` : `Only ${ctx.base.name} provides this; ${baseCap.controlType === "locked" ? "locked control" : "retained"}.`,
      evidence: baseCap.evidence,
    });
  }

  for (const cap of ctx.candidateCapabilities) {
    if (consumed.has(cap.id)) continue;
    const presence: CapabilityPresence[] = solutionsList.map((s) => ({
      solutionId: s.id,
      present: s.capabilityIds.includes(cap.id),
      strength: s.capabilityIds.includes(cap.id) ? strengthOf(cap) : "none",
    }));
    const conflict = conflictingBaseCapability(cap, ctx);
    let verdict: CompareRow["verdict"];
    let note: string;
    const source = ctx.candidates.find((s) => s.capabilityIds.includes(cap.id));
    if (conflict) {
      verdict = "unsupported";
      note = `Conflicts with ${conflict.name}. Not carried forward.`;
    } else if (isRecommendedModule(cap, ctx)) {
      verdict = "stronger";
      note = `Not in ${ctx.base.name}. Recommended to add as a module.`;
    } else if (isUnsupported(cap) || cap.evidenceLevel === "none") {
      verdict = source?.retirementCandidate ? "retire" : "unsupported";
      note = `${cap.supportStatus}; ${cap.evidenceLevel} evidence. ${source?.retirementCandidate ? "Retire with its source product." : "Not carried forward."}`;
    } else {
      verdict = "unique";
      note = `Only in ${cap.sourceSolutionName}; optional with ${cap.evidenceLevel} evidence.`;
    }
    rows.push({ capability: cap, presence, verdict, verdictNote: note, evidence: cap.evidence });
  }

  const stronger = rows.filter((r) => r.verdict === "stronger").length;
  const common = rows.filter((r) => r.verdict === "common").length;
  const dropped = rows.filter((r) => r.verdict === "unsupported" || r.verdict === "retire").length;
  return {
    caseId: c.id,
    baseSolutionId: ctx.base.id,
    solutions: solutionsList,
    rows,
    summary: `${solutionsList.length} products compared across ${rows.length} capabilities: ${common} duplicated in weaker form, ${stronger} worth adding to ${ctx.base.name}, ${dropped} not carried forward.`,
  };
}

export function buildPilotPlan(c: Case, ctx: CaseContext, experiment: Experiment | null): PilotPlan {
  const eligibleGroup = ctx.base.businessUnits[0] ?? "Primary business unit";
  const pilotPercent = 20;
  const pilotUsers = Math.max(10, Math.round(ctx.base.activeUsers * (pilotPercent / 100)));
  const time = experiment?.metrics.find((m) => m.key === "taskMinutes");
  const success = experiment?.metrics.find((m) => m.key === "successRate");
  const errors = experiment?.metrics.find((m) => m.key === "errorRate");
  const added = addedExternalModules(c, ctx);
  const locked = ctx.baseCapabilities.filter((cap) => cap.controlType === "locked");
  const approval = locked.find((cap) => cap.category === "Approval");
  return {
    eligibleGroup,
    pilotPercent,
    pilotUsers,
    durationWeeks: 4,
    successThresholds: [
      time ? `Task time at least ${Math.max(10, Math.round(Math.abs(time.deltaPct) * 0.6))}% lower than baseline` : "Task time at least 15% lower than baseline",
      success ? `Success rate no lower than baseline (${success.baseline}%)` : "Success rate no lower than baseline",
      errors ? `Exception rate at or below ${Math.round(errors.baseline + 1)}%` : "Exception rate no higher than baseline",
      ...(approval ? [`${approval.name} completed on 100% of items`] : []),
    ],
    guardrails: [
      `All locked controls (${locked.map((cap) => cap.name.toLowerCase()).join(", ")}) unchanged.`,
      "No changes to data access scope; pilot users keep existing site-level permissions.",
      `Pilot limited to ${pilotPercent}% of ${eligibleGroup}; other sites remain on v${ctx.base.currentVersion}.`,
      ...(added.some((a) => isUnsupported(a)) ? ["Ownership of prototype-sourced modules transfers to Operations Platforms before day one."] : []),
    ],
    monitoring: [
      "Daily: task time and success rate per pilot user versus the control group.",
      "Weekly: exception rate, approval completion, and segment-level flags (new users, incomplete data).",
      "Continuous: audit log completeness and control checks.",
    ],
    rollbackTrigger: `Exception rate rises more than 3 points above baseline for 5 consecutive days, any control check fails, or success rate falls below baseline for 2 consecutive weeks. Rollback restores v${ctx.base.currentVersion} for pilot users within one business day.`,
    ownerApprovalRequired: true,
    itApprovalRequired: true,
  };
}

const ROLE_ACTIONS: Record<Role, DecisionAction[]> = {
  seeker: ["approve_simulation"],
  owner: ["approve_simulation", "approve_pilot", "request_changes", "defer", "reject"],
  it: ["approve_consolidation", "defer", "reject"],
};

export function allowedActions(c: Case, decisions: Decision[]): { role: Role; actions: DecisionAction[] }[] {
  const itApproved = decisions.some((d) => d.action === "approve_consolidation");
  const byRole = (role: Role): DecisionAction[] => {
    const candidates = ROLE_ACTIONS[role];
    return candidates.filter((action) => {
      switch (action) {
        case "approve_simulation":
          return c.status === "simulated";
        case "approve_pilot":
        case "request_changes":
          return c.status === "pilot_proposed" || c.status === "deferred";
        case "approve_consolidation":
          return (c.status === "pilot_proposed" || c.status === "approved" || c.status === "deferred") && !itApproved;
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
    case "approve_simulation":
      return "pilot_proposed";
    case "approve_pilot":
      return "approved";
    case "approve_consolidation":
      return "approved";
    case "request_changes":
      return "changes_requested";
    case "defer":
      return "deferred";
    case "reject":
      return "rejected";
  }
}

export function nextStep(c: Case, experimentRec: Experiment["recommendation"] | null, latest: Decision | null): string {
  switch (c.status) {
    case "draft":
      return "Configure the proposed version and run the simulated test.";
    case "simulated":
      return experimentRec === "proceed_to_pilot"
        ? "Simulation supports a pilot. Create the controlled pilot recommendation."
        : "Review the simulation and revise the configuration before proposing a pilot.";
    case "pilot_proposed":
      return "Awaiting owner review of the proposed version and pilot plan.";
    case "approved":
      return latest?.action === "approve_consolidation" ? "Approved by owner and IT. Pilot can start." : "Owner approved the pilot. Awaiting IT consolidation decision.";
    case "changes_requested":
      return `Owner requested changes${latest?.reason ? `: ${latest.reason}` : ""}. Revise and re-run the simulation.`;
    case "deferred":
      return "Deferred. Revisit at the next portfolio review.";
    case "rejected":
      return "Rejected. No further action.";
  }
}

export function buildReview(c: Case, ctx: CaseContext, experiment: Experiment | null, decisions: Decision[]): ChangeReview {
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

  const projected = experiment ? metricsFromExperiment(experiment) : projectedMetrics(c, ctx);
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
    performance: projected,
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

  const pilotPlan = buildPilotPlan(c, ctx, experiment);
  const ownerSummary = `${c.title}: ${added.length} capabilit${added.length === 1 ? "y" : "ies"} added, ${removed.length} removed, ${changedConfig.length} setting${changedConfig.length === 1 ? "" : "s"} changed. ${unchanged.length} locked or configurable controls unchanged. ${
    experiment ? `Simulated test: ${experiment.narrative.split(". ")[0]}.` : "No simulated test has been run yet."
  } Pilot proposed for ${pilotPlan.pilotUsers} users in ${pilotPlan.eligibleGroup} over ${pilotPlan.durationWeeks} weeks.`;

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
