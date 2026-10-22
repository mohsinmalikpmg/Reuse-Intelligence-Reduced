import test from "node:test";
import assert from "node:assert/strict";
import { assessCode } from "./code-assessment";
import { analyzePrototype } from "./prototype-intake";
import { matchBrief, savedBriefMatch } from "./matching";
import { analyze } from "./ai-analysis";
import type { Brief, LibraryCodePackage, PrototypeIntake } from "@workspace/api-zod";
import manifest from "../data/solution-code-manifest.json";

const empty = { value: "", confidence: 0 };
const brief: Brief = {
  id: "unit-test-brief", rawText: "Summarize equipment work-order notes", today: "", better: "",
  fields: { user: empty, job: empty, currentProcess: empty, painPoint: empty, desiredOutcome: empty, constraints: empty, data: empty, requiredControls: empty, successMeasures: empty },
  requirements: [{ id: "r", text: "Summarize maintenance notes", source: "added" }], source: "ai", confirmed: true,
  createdAt: new Date(0).toISOString(), clarifyingQuestion: null, clarification: null, valueStatement: "",
};
const prototype: PrototypeIntake = { name: "Notes prototype", platformKind: "other", platformName: "Submitted tool", users: "Supervisors",
  description: "Produces maintenance note summaries", examples: [{ input: "Routine maintenance notes", output: "Summary:\nPump inspection needs review" }] };
const provenance = { id: "unit-analysis", model: "unit-test", promptVersion: "test-v1", inputFingerprint: "test-fingerprint", createdAt: new Date(0).toISOString(), cached: true };
test("a mapped eligible sibling capability remains reusable in matching coverage", async () => {
  const report = await matchBrief(brief, { analyzer: analyzerFor({
    matches: [{ solutionId: "sol-workorder-insight", fitLabel: "good", reason: "Relevant base", gaps: [] }],
    recommendedId: "sol-workorder-insight",
    capabilityMatches: [{ capabilityId: "cap-clustering", reason: "Complementary sibling capability" }],
    missingRequirements: [], headline: "Review reuse", valueStatement: "Proposed documented reuse only.",
    coverage: [{ requirementId: "r", capabilityId: "cap-clustering" }],
  }) });
  assert.ok(report.coverage);
  assert.equal(report.coverage[0].status, "covered_reusable");
  assert.equal(report.coverage[0].capabilityId, "cap-clustering");
});
test("unassessed overview brief returns no recommendation without a provider", async () => {
  let reads = 0;
  const saved = await savedBriefMatch(brief, async () => { reads++; return null; });
  assert.equal(saved, null);
  assert.equal(reads, 1);
});
function analyzerFor(data: unknown): typeof analyze {
  return async opts => ({ data: opts.schema.parse(data), provenance });
}
test("code report grounds IDs in package and exposes mapping as inference", async () => {
  const report = await assessCode(brief, manifest as LibraryCodePackage, { analyzer: analyzerFor({ requirements: [{ id: "r", capabilityIds: ["cap-summarize"], complete: true, constraint: false, reason: "Source emits summary items.", limitations: [] }] }) });
  assert(report.requirements[0].matches[0].evidence.symbol);
  assert.match(report.requirements[0].note, /AI-inferred source mapping/);
  assert(report.limitations.some(s => s.includes("unit-analysis")));
  assert(!report.limitations.some(s => s.includes("explicit maintenance-domain rules")));
});
test("code mapping invalid evidence and provider errors fail closed", async () => {
  await assert.rejects(assessCode(brief, manifest as LibraryCodePackage, { analyzer: analyzerFor({ requirements: [{ id: "r", capabilityIds: ["made-up-code"], complete: true, constraint: false, reason: "Injected ID", limitations: [] }] }) }), /Unknown or repeated/);
  const fail: typeof analyze = async () => { throw new Error("model unavailable"); };
  await assert.rejects(assessCode(brief, manifest as LibraryCodePackage, { analyzer: fail }), /model unavailable/);
  await assert.rejects(analyzePrototype(prototype, { analyzer: fail }), /model unavailable/);
  await assert.rejects(matchBrief(brief, { analyzer: fail }), /model unavailable/);
});
test("drifted source package fails before requesting a model interpretation", async () => {
  let called = false;
  await assert.rejects(assessCode(brief, { ...manifest, files: manifest.files.map(f => f.path === "engine/steps.ts" ? { ...f, sha256: "drifted" } : f) } as LibraryCodePackage, {
    analyzer: async () => { called = true; throw new Error("must not call"); },
  }), /no longer matches/);
  assert.equal(called, false);
});
test("prototype rejects invented capability or target IDs", async () => {
  await assert.rejects(analyzePrototype(prototype, { analyzer: analyzerFor({
    components: [{ id: "c1", name: "Summary", description: "Submitted output", sectionIndices: [0], capabilityId: "invented", verdict: "duplicates", reason: "Injected" }],
    recommendedPath: "fold_into", recommendation: "Injected target", targetSolutionId: "invented", targetCapabilityId: null,
  }) }), /Unknown, repeated or invalid/);
});
test("prototype mappings have no fabricated numeric score or execution claim", async () => {
  const report = await analyzePrototype(prototype, { analyzer: analyzerFor({
    components: [{ id: "c1", name: "Summary", description: "Submitted summary", sectionIndices: [0], capabilityId: "cap-summarize", verdict: "duplicates", reason: "Catalogue describes a summary output." }],
    recommendedPath: "fold_into", recommendation: "Review overlap before folding.", targetSolutionId: "sol-workorder-insight", targetCapabilityId: null,
  }) });
  assert.equal(report.components[0].matchScore, null);
  assert.match(report.components[0].reason, /not prototype execution/);
  assert.match(report.basis, /Submitted prototype was not executed/);
});
test("brief matching validates IDs and retains no fake savings", async () => {
  await assert.rejects(matchBrief(brief, { analyzer: analyzerFor({ matches: [{ solutionId: "invented", fitLabel: "strong", reason: "Injected", gaps: [] }], recommendedId: "invented",
    capabilityMatches: [], missingRequirements: [], headline: "Injected", valueStatement: "Injected", coverage: [{ requirementId: "r", capabilityId: null }] }) }), /Invalid or duplicate/);
});
