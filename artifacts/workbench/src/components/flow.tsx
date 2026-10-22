import type { ComponentConfig, Configuration, WorkflowBlock } from "@workspace/api-client-react";

export type FlowBlock = {
  id: string; name: string; description: string; kind: "required" | "configurable" | "optional";
  active: boolean; added: boolean; value: string | null; options: string[] | null; source: string; blockedReason: string | null;
  /** The workflow stage the capability belongs to (Ingest, Analyze, ...): the schematic block's eyebrow. */
  stage: string;
};

export function blocksFromConfig(cfg: Configuration, baseId: string, planIds: ReadonlySet<string> = new Set()): FlowBlock[] {
  const out: FlowBlock[] = [];
  for (const st of cfg.steps)
    for (const c of st.components) {
      if (!c.executable) continue;
      const fromBase = c.capability.sourceSolutionId === baseId;
      if (c.controlType === "optional" && !c.active && !fromBase && !planIds.has(c.capability.id)) continue;
      out.push(fromComp(c, fromBase));
    }
  return out;
}
function fromComp(c: ComponentConfig, fromBase: boolean): FlowBlock {
  return {
    id: c.capability.id, name: c.capability.name, description: c.capability.description,
    kind: c.controlType === "locked" ? "required" : c.controlType, active: c.active, added: !fromBase && c.controlType === "optional",
    value: c.value, options: c.options, source: c.sourceSolutionName, blockedReason: c.blockedReason, stage: c.capability.workflowStep,
  };
}
export function blocksFromWorkbench(blocks: WorkflowBlock[]): FlowBlock[] {
  return blocks.filter((b) => b.executable).map((b) => ({
    id: b.capability.id, name: b.capability.name, description: b.capability.description, kind: b.kind, active: b.active,
    added: b.origin === "added", value: b.value, options: b.options, source: b.capability.sourceSolutionName, blockedReason: b.blockedReason, stage: b.capability.workflowStep,
  }));
}
export function controlsFromConfig(cfg: Configuration) {
  return cfg.steps.flatMap((s) => s.components).filter((c) => !c.executable && c.controlType === "locked").map((c) => c.capability);
}
