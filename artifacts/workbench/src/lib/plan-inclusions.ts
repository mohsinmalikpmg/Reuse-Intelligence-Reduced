import type { Composition } from "@workspace/api-client-react";

export type WorkflowCapability = { id: string; sourceId: string; active: boolean; executable?: boolean; visible?: boolean; blockedReason?: string | null };
export type PlanInclusion = {
  key: string; capabilityId: string; sourceId: string; name: string; sourceName: string;
  accepted: boolean; represented: boolean; status: "active" | "off" | "proposed"; reason: string;
};

/** Reconcile the saved plan with the current engine without inventing executable steps. */
export function planInclusions(c: Composition, workflow: WorkflowCapability[]): PlanInclusion[] {
  const evidence = c.sourceEvidence as { solutionId: string; name?: string; capabilities?: { id: string; name?: string }[] }[];
  const seen = new Set<string>();
  return c.plan.flow.flatMap((step) => {
    const key = `${step.sourceSolutionId}:${step.capabilityId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const source = evidence.find((s) => s.solutionId === step.sourceSolutionId);
    const acceptance = (c.acceptedSuggestions ?? []).find((a) =>
      a.sourceSolutionId === step.sourceSolutionId && (!a.capabilityIds || a.capabilityIds.includes(step.capabilityId)));
    // Shared catalogue IDs do not prove that this donor has a runnable adapter.
    const engine = acceptance?.executable === false ? undefined : workflow.find((x) =>
      x.id === step.capabilityId && x.sourceId === step.sourceSolutionId);
    const accepted = !!acceptance;
    const active = c.executable && engine?.active === true && engine.executable !== false;
    const off = c.executable && !!engine && engine.executable !== false && !engine.blockedReason;
    const status = active ? "active" : off ? "off" : "proposed";
    return [{
      key, capabilityId: step.capabilityId, sourceId: step.sourceSolutionId,
      name: source?.capabilities?.find((x) => x.id === step.capabilityId)?.name ?? step.capabilityId,
      sourceName: source?.name ?? step.sourceSolutionId, accepted, represented: !!engine && engine.executable !== false && engine.visible !== false, status,
      reason: active ? "Included in the current runnable workflow."
        : status === "off" ? "In the saved plan, but switched off in the current workflow. Use Add back on its workflow step."
        : acceptance?.executable === false
          ? "Accepted as a proposed contribution only. No runnable adapter was added for this source."
          : engine?.blockedReason
          ?? c.supportedExecution?.omittedCapabilities.find((x) => x.capabilityId === step.capabilityId)?.reason
          ?? "Included in the saved plan only. This workflow has no runnable adapter for this capability.",
    } satisfies PlanInclusion];
  });
}
