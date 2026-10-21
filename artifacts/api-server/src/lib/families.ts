/**
 * Solution families: the library grouped by business problem. Each family names the preferred product, the
 * configurations IT has approved on top of its standard setup, the capabilities that can be reused around it, and the
 * products being consolidated into it. Everything here is derived from the catalog plus the governance overlay on each
 * read; nothing is stored. Experiments (cases) never appear.
 */
import type { ApprovedConfiguration, BusinessProblem, Capability, ConfigurationPreview, FamilyCapability, FamilyRole, Solution, SolutionFamily, SolutionVersion } from "@workspace/api-zod";
import { CATALOG_VERSION, businessProblems, capabilities, catalogSolutions, getSolution, portableCapabilitiesFor, solutions, sortByMaturity } from "../data/catalog";
import { diffOutputs } from "../engine/diff";
import { sampleInputsFor } from "../engine/workorders";
import { rankBucket } from "./governance";
import { freshContext, moduleBlockedReason, type CaseContext } from "./configuration";
import { enrichDiff, explain, previewRun, productionCapabilities, toSampleInput, WorkbenchError } from "./workbench";

/** Live (non-deprecated) products addressing a business problem. */
function membersOf(bp: BusinessProblem): Solution[] {
  return solutions.filter((s) => s.businessProblemIds.includes(bp.id) && s.status !== "deprecated");
}

/** The product to use for a problem: the one IT marked preferred, else the most mature product without a disposition. */
export function preferredFor(bp: BusinessProblem): Solution | undefined {
  const members = membersOf(bp);
  const marked = members.find((s) => s.disposition?.preferred);
  if (marked) return marked;
  const open = sortByMaturity(members.filter((s) => !s.disposition));
  return open[0] ?? sortByMaturity(members)[0];
}

export function familyRoleOf(s: Solution): FamilyRole {
  const bp = businessProblems.find((b) => s.businessProblemIds.includes(b.id));
  if (bp && preferredFor(bp)?.id === s.id) return "preferred";
  return s.disposition ? "consolidating" : "alternative";
}

export function familyTitleOf(s: Solution): string {
  return businessProblems.find((b) => s.businessProblemIds.includes(b.id))?.title ?? "";
}

function supportLabel(s: Solution): string {
  const noOwner = /unassigned/i.test(s.ownerName) || /^none$/i.test(s.supportModel);
  if (noOwner) return "Unsupported · no owner";
  if (s.status === "certified") return `Supported · ${s.supportModel}`;
  if (s.status === "pilot") return `Pilot · ${s.supportModel}`;
  return `Experimental · ${s.supportModel}`;
}

/** The standard configuration a published version is compared against: the catalog version of the product. */
export function standardVersionOf(solutionId: string): string | undefined {
  return catalogSolutions.find((s) => s.id === solutionId)?.currentVersion;
}

function configurationTitle(v: SolutionVersion): string {
  const parts = [...v.foldedCapabilities.map((f) => f.name), ...v.changedSettings.map(shortSetting)];
  return parts.length ? parts.join(" + ") : `Version ${v.version}`;
}

/** "Notifications: Daily digest → Immediate" becomes "Immediate notifications"; anything else is kept as written. */
function shortSetting(change: string): string {
  const m = /^(.+?):\s*(.+?)\s*→\s*(.+)$/.exec(change);
  return m ? `${m[3]} ${m[1]!.toLowerCase()}` : change;
}

function configurationChanges(v: SolutionVersion): string[] {
  return [...v.foldedCapabilities.map((f) => `Adds ${f.name} (from ${f.sourceSolutionName})`), ...v.changedSettings];
}

/** Published successor versions of a product, oldest first. Drafts awaiting IT and withdrawn versions are not approved. */
export function approvedConfigurationsOf(s: Solution): ApprovedConfiguration[] {
  const base = standardVersionOf(s.id) ?? s.currentVersion;
  return [...s.versions]
    .filter((v) => v.state === "current")
    .reverse()
    .map((v) => ({ solutionId: s.id, version: v.version, baseVersion: base, title: configurationTitle(v), changes: configurationChanges(v), summary: v.summary, releasedAt: v.releasedAt, caseId: v.caseId }));
}

function usedIn(cap: Capability) {
  return solutions.filter((s) => s.status !== "deprecated" && s.capabilityIds.includes(cap.id)).map((s) => ({ solutionId: s.id, solutionName: s.name, version: s.currentVersion }));
}

const contextCache = new WeakMap<Solution, CaseContext>();
function contextFor(target: Solution): CaseContext {
  let ctx = contextCache.get(target);
  if (!ctx) { ctx = freshContext(target); contextCache.set(target, ctx); }
  return ctx;
}

function toFamilyCapability(cap: Capability, preferred: Solution | undefined, tryIn: Solution | undefined): FamilyCapability {
  const source = solutions.find((s) => s.id === cap.sourceSolutionId);
  // "Already in" is only worth saying when the preferred product is not the capability's own source.
  const included = !!preferred && preferred.id !== cap.sourceSolutionId && preferred.capabilityIds.includes(cap.id);
  // Offer "Try in" only when the module can actually run on the target: no conflict with a base capability, supported
  // (or recommended), dependencies met. Otherwise the case would open with Version B equal to Version A.
  // A product without an execution engine cannot show the difference, so it is never a "Try in" target.
  const tryable = tryIn && tryIn.execution === "live" && !tryIn.capabilityIds.includes(cap.id) && moduleBlockedReason(cap, contextFor(tryIn)) === null;
  return {
    capability: cap,
    familyId: source?.businessProblemIds[0] ?? "",
    familyTitle: source ? familyTitleOf(source) : "",
    sourceSolutionId: cap.sourceSolutionId,
    sourceSolutionName: cap.sourceSolutionName,
    usedIn: usedIn(cap),
    includedInPreferred: included,
    tryIn: tryable ? { solutionId: tryIn.id, solutionName: tryIn.name } : null,
  };
}

/**
 * Capabilities worth reusing around a family: those the sibling products contribute, those portable into the family
 * from elsewhere, and the family's own modules other problems can take. Tryable ones first, then the ones already in.
 */
function reusableCapabilitiesOf(bp: BusinessProblem, preferred: Solution | undefined, members: Solution[]): FamilyCapability[] {
  const out = new Map<string, FamilyCapability>();
  for (const s of members) {
    if (preferred && s.id === preferred.id) continue;
    for (const cap of capabilities) if (cap.sourceSolutionId === s.id) out.set(cap.id, toFamilyCapability(cap, preferred, preferred));
  }
  for (const cap of portableCapabilitiesFor([bp.id])) if (!out.has(cap.id)) out.set(cap.id, toFamilyCapability(cap, preferred, preferred));
  for (const other of businessProblems) {
    if (other.id === bp.id) continue;
    const target = preferredFor(other);
    for (const cap of portableCapabilitiesFor([other.id])) {
      if (!members.some((s) => s.id === cap.sourceSolutionId) || out.has(cap.id)) continue;
      out.set(cap.id, toFamilyCapability(cap, preferred, target));
    }
  }
  return [...out.values()].sort((a, b) => Number(!!b.tryIn) - Number(!!a.tryIn) || a.capability.name.localeCompare(b.capability.name));
}

export function buildFamilies(): SolutionFamily[] {
  const families: SolutionFamily[] = [];
  for (const bp of businessProblems) {
    const members = membersOf(bp);
    const preferred = preferredFor(bp);
    if (!preferred) continue;
    const rest = members.filter((s) => s.id !== preferred.id);
    families.push({
      businessProblem: bp,
      preferred,
      support: supportLabel(preferred),
      covers: productionCapabilities(preferred).active.map((cap) => ({ capabilityId: cap.id, name: cap.name, workflowStep: cap.workflowStep })),
      approvedConfigurations: approvedConfigurationsOf(preferred),
      reusableCapabilities: reusableCapabilitiesOf(bp, preferred, members),
      alternatives: sortByMaturity(rest.filter((s) => !s.disposition)),
      consolidating: sortByMaturity(rest.filter((s) => !!s.disposition)).sort((a, b) => rankBucket(a) - rankBucket(b)),
    });
  }
  // Catalog order of business problems; the list is short enough that maturity ordering would only hide the demo problem.
  return families;
}

export function capabilitiesWithFamily(caps: Capability[]): FamilyCapability[] {
  return caps.map((cap) => {
    const source = solutions.find((s) => s.id === cap.sourceSolutionId);
    const bp = source ? businessProblems.find((b) => source.businessProblemIds.includes(b.id)) : undefined;
    const target = bp ? preferredFor(bp) : undefined;
    return toFamilyCapability(cap, target, target);
  });
}

// ---------- Output preview ----------

const previewCache = new Map<string, ConfigurationPreview>();

/**
 * The same sample input run through the standard configuration and the approved one. Both are real engine runs; the
 * shortest sample on which the two outputs differ is used so the preview stays readable. Cached per catalog version and
 * configuration fingerprint, so a reset that republishes the same configuration reuses it.
 */
export function configurationPreview(solutionId: string, version: string): ConfigurationPreview {
  const live = getSolution(solutionId);
  if (!live) throw new WorkbenchError("Solution not found", 404);
  const approved = approvedConfigurationsOf(live).find((c) => c.version === version);
  if (!approved) throw new WorkbenchError(`v${version} is not an approved configuration of ${live.name}`, 404);
  const standard = getSolution(solutionId, approved.baseVersion);
  const variant = getSolution(solutionId, version);
  if (!standard || !variant) throw new WorkbenchError("Configuration not found", 404);

  const samples = [...sampleInputsFor(solutionId)].sort((a, b) => a.noteCount - b.noteCount);
  if (samples.length === 0) throw new WorkbenchError("No sample input exists for this solution.", 404);
  const key = [CATALOG_VERSION, solutionId, version, approved.baseVersion, JSON.stringify(productionCapabilities(standard)), JSON.stringify(productionCapabilities(variant))].join("|");
  const cached = previewCache.get(key);
  if (cached) return cached;

  let chosen: ConfigurationPreview | null = null;
  for (const sample of samples) {
    const a = previewRun(standard, sample.id, `preview_${solutionId}_${approved.baseVersion}_${sample.id}`, `${live.name} v${approved.baseVersion} (standard)`);
    const b = previewRun(variant, sample.id, `preview_${solutionId}_${version}_${sample.id}`, `${live.name} v${version} (${approved.title})`);
    const diff = enrichDiff(diffOutputs(a.output, b.output), solutionId);
    chosen = { solutionId, version, baseVersion: approved.baseVersion, sampleInput: toSampleInput(sample), standard: a, variant: b, diff, explanation: explain(a, b, diff, { a: "the standard configuration", b: `the ${approved.title} configuration` }), catalogVersion: CATALOG_VERSION };
    if (diff.entries.length > 0) break;
  }
  previewCache.set(key, chosen!);
  return chosen!;
}
