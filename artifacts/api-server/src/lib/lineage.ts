/**
 * Lineage: every case is an experimental branch of its parent product. The exact difference from the parent
 * version is derived from the configuration (the same facts the fingerprint hashes), never typed by hand.
 */
import type { Capability, CapabilityProvenance, Case, CaseLineage, ConfigChange } from "@workspace/api-zod";
import { type CaseContext, activeModules, addedExternalModules, buildComponents, defaultConfigValues, defaultModuleStates } from "./configuration";
import { currentFingerprints } from "./workbench";

export function provenance(cap: Capability, reason: string, state: CapabilityProvenance["state"]): CapabilityProvenance {
  return { capability: cap, sourceSolutionName: cap.sourceSolutionName, reason, evidence: cap.evidence, state };
}

/** What the experiment switches on, switches off and re-configures relative to the parent's production version. */
export function configDiff(c: Case, ctx: CaseContext): { added: CapabilityProvenance[]; removed: CapabilityProvenance[]; changedConfig: ConfigChange[]; currentCaps: Capability[] } {
  const defaults = defaultModuleStates(ctx);
  const defaultValues = defaultConfigValues(ctx);
  const components = buildComponents(c, ctx);
  const baseIds = new Set(ctx.baseCapabilities.map((b) => b.id));
  const currentCaps = ctx.baseCapabilities.filter((cap) => cap.controlType !== "optional" || defaults[cap.id] === true);
  const active = activeModules(c, ctx);
  const added = active
    .filter((cap) => !currentCaps.some((cc) => cc.id === cap.id))
    .map((cap) => provenance(cap, baseIds.has(cap.id) ? `Optional ${ctx.base.name} module switched on.` : `Added from ${cap.sourceSolutionName}: ${cap.description}`, baseIds.has(cap.id) ? "optional" : "recommended"));
  const removed = currentCaps
    .filter((cap) => cap.controlType === "optional" && !active.some((a) => a.id === cap.id))
    .map((cap) => provenance(cap, "Optional module switched off in the proposed version.", "optional"));
  const changedConfig: ConfigChange[] = components
    .filter((comp) => comp.controlType === "configurable" && comp.value && comp.value !== (defaultValues[comp.capability.id] ?? comp.capability.defaultOption))
    .map((comp) => ({ capabilityName: comp.capability.name, from: defaultValues[comp.capability.id] ?? comp.capability.defaultOption ?? "", to: comp.value ?? "" }));
  return { added, removed, changedConfig, currentCaps };
}

const STOP = new Set(["the", "a", "an", "to", "of", "for", "and", "or", "in", "on", "that", "may", "with", "be", "is", "are", "as", "it", "this", "we", "our"]);

function slug(text: string): string {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).slice(0, 6).join("-");
}

/**
 * The intent is what defines the experiment: the person's own words when given, otherwise the capability it adds
 * (the first added external module), otherwise the first requirement recorded while testing.
 * The key normalizes the stated intent so "Safety-risk classification" and "safety risk classification" match;
 * capability ids are the fallback for experiments nobody has described yet.
 */
export function deriveIntent(c: Pick<Case, "intent" | "requirements">, added: Capability[]): { intent: string; intentKey: string } {
  if (c.intent?.trim()) return { intent: c.intent.trim(), intentKey: `intent-${slug(c.intent)}` };
  const external = added[0];
  if (external) return { intent: external.name, intentKey: external.id };
  const req = c.requirements[0];
  if (req) return { intent: req.text, intentKey: `intent-${slug(req.text)}` };
  return { intent: "No change yet", intentKey: "none" };
}

export const hasExplicitIntent = (c: Pick<Case, "intent">) => !!c.intent?.trim();

export function lineageSummary(l: Pick<CaseLineage, "added" | "removed" | "changedSettings">): string {
  const parts: string[] = [];
  if (l.added.length) parts.push(`Adds ${l.added.join(", ")}`);
  if (l.removed.length) parts.push(`Switches off ${l.removed.join(", ")}`);
  if (l.changedSettings.length) parts.push(`${l.changedSettings.length} setting${l.changedSettings.length === 1 ? "" : "s"} changed`);
  return parts.length ? parts.join(" · ") : "Identical to the parent version";
}

export function caseLineage(c: Case, ctx: CaseContext): CaseLineage {
  const diff = configDiff(c, ctx);
  const external = addedExternalModules(c, ctx);
  const { intent, intentKey } = deriveIntent(c, external);
  const partial = { added: diff.added.map((p) => p.capability.name), removed: diff.removed.map((p) => p.capability.name), changedSettings: diff.changedConfig };
  return {
    parentSolutionId: ctx.base.id,
    parentSolutionName: ctx.base.name,
    parentVersion: c.parentVersion || ctx.base.currentVersion,
    fingerprint: currentFingerprints(c, ctx).b,
    ...partial,
    intent,
    intentKey,
    summary: lineageSummary(partial),
  };
}

/** Plain-language list of what one experiment changes, for side-by-side comparisons. */
export function lineageChanges(l: CaseLineage): string[] {
  return [
    ...l.added.map((n) => `Adds ${n}`),
    ...l.removed.map((n) => `Switches off ${n}`),
    ...l.changedSettings.map((s) => `${s.capabilityName}: ${s.from} → ${s.to}`),
  ];
}

export function defaultExperimentTitle(parentName: string, parentVersion: string): string {
  return `Experimental improvement to ${parentName} v${parentVersion}`;
}
