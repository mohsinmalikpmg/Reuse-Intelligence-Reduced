/**
 * Closing the consolidation loop. Owner approval records a draft successor version on the parent product with the
 * folded capabilities and their provenance, plus proposed dispositions for every product under the case. IT's
 * approval publishes the version and confirms the dispositions; withdrawal reverses both. Nothing here changes the
 * static catalog.
 */
import type { Case, DecisionAction } from "@workspace/api-zod";
import { addedExternalModules, caseContext } from "./configuration";
import { caseEvidence } from "./evidence";
import { lineageChanges } from "./lineage";
import { versionBCapabilities } from "./workbench";
import {
  type DispositionChoice,
  type FoldedCapabilityInput,
  ensureDraftVersion,
  seedDispositions,
  setDispositionsState,
  setVersionState,
  versionForCase,
} from "./governance";

/** Provenance line for a folded capability: where it came from and the evidence behind it. */
function provenanceFor(sourceSolutionName: string, owner: string, tests: number, preferredPercent: number | null): string {
  const evidence = tests === 0 ? "no recorded votes" : `${tests} test${tests === 1 ? "" : "s"}, ${preferredPercent ?? 0}% preferred`;
  return `from ${sourceSolutionName}, via experiment by ${owner}, ${evidence}`;
}

/** Owner approval (single or grouped): a draft successor version plus proposed dispositions, both idempotent. */
export async function recordDraftSuccessor(c: Case, actor: string): Promise<void> {
  const ctx = caseContext(c);
  const added = addedExternalModules(c, ctx);
  const evidence = await caseEvidence(c);
  const tests = evidence.votes?.tests ?? 0;
  const preferredPercent = evidence.votes && tests > 0 ? Math.round((evidence.votes.bPreferred / tests) * 100) : null;
  const folded: FoldedCapabilityInput[] = added.map((cap) => ({
    capabilityId: cap.id,
    name: cap.name,
    sourceSolutionId: cap.sourceSolutionId,
    sourceSolutionName: cap.sourceSolutionName,
    experimentOwner: c.ownerName,
    tests,
    preferredPercent,
    provenance: provenanceFor(cap.sourceSolutionName, c.ownerName, tests, preferredPercent),
  }));
  const changes = lineageChanges(c.lineage);
  const summary = `${changes.length ? changes.join("; ") : "Configuration confirmed without changes"}. From the experiment "${c.title}" by ${c.ownerName}${c.ownerTeam ? ` (${c.ownerTeam})` : ""}, approved by ${actor}.`;
  // The approved production configuration is the experiment's Version B, exactly as it was tested: which optional
  // modules are on (base and folded) and which option each configurable setting uses.
  const b = versionBCapabilities(c, ctx);
  const members = new Set([...ctx.baseCapabilities.map((cap) => cap.id), ...folded.map((cap) => cap.capabilityId)]);
  const moduleStates: Record<string, boolean> = {};
  for (const cap of [...ctx.baseCapabilities, ...ctx.candidateCapabilities]) {
    if (cap.controlType === "optional" && members.has(cap.id)) moduleStates[cap.id] = b.active.some((a) => a.id === cap.id);
  }
  const configValues: Record<string, string> = {};
  for (const [id, value] of Object.entries(b.configValues)) if (members.has(id)) configValues[id] = value;
  const version = await ensureDraftVersion(c, {
    summary,
    folded,
    changedSettings: c.lineage.changedSettings.map((s) => `${s.capabilityName}: ${s.from} → ${s.to}`),
    moduleStates,
    configValues,
    createdBy: actor,
  });

  // Proposed dispositions mirror the computed fates; IT's own choices, if already made, are kept.
  const addedSources = new Set(added.map((cap) => cap.sourceSolutionId));
  const choices: DispositionChoice[] = [
    { solutionId: ctx.base.id, kind: "retain", preferred: true, targetSolutionId: null, targetVersion: null },
    ...ctx.candidates.map((s): DispositionChoice =>
      s.retirementCandidate || !addedSources.has(s.id)
        ? { solutionId: s.id, kind: "retire" }
        : { solutionId: s.id, kind: "fold_into", targetSolutionId: ctx.base.id, targetVersion: version.version },
    ),
  ];
  await seedDispositions(c.id, choices);
}

/** IT approval: the draft becomes the current governed version and every disposition is confirmed. */
export async function publishSuccessor(c: Case, actor: string): Promise<void> {
  if (!versionForCase(c.id)) await recordDraftSuccessor(c, actor);
  const version = versionForCase(c.id);
  await setVersionState(c.id, "current", actor);
  await setDispositionsState(c.id, "confirmed", version?.version);
}

/** Withdrawal: successor back to draft, dispositions back to proposals. The record itself is kept. */
export async function withdrawSuccessor(c: Case): Promise<void> {
  await setVersionState(c.id, "draft");
  await setDispositionsState(c.id, "proposed");
}

/** Side effects of a recorded decision on the governance overlay. */
export async function applyGovernanceEffects(c: Case, action: DecisionAction, actor: string): Promise<void> {
  switch (action) {
    case "approve_pilot":
    case "adopt_approach":
      await recordDraftSuccessor(c, actor);
      return;
    case "approve_consolidation":
      await publishSuccessor(c, actor);
      return;
    case "withdraw_consolidation":
      await withdrawSuccessor(c);
      return;
    case "reject":
    case "decline":
      // An approved-then-rejected change leaves no draft behind.
      if (versionForCase(c.id)) await setVersionState(c.id, "withdrawn");
      return;
    default:
      return;
  }
}
