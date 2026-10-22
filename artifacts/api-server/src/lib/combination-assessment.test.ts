import test from "node:test";
import assert from "node:assert/strict";
import { assessCombination } from "./combination-assessment";
import { analyze } from "./ai-analysis";
import { requirementMappingSchema } from "./assessment-evidence";

const invoice = {
  recipeId: "invoice", capabilityIds: ["fuzzy-search", "bulk-decisions", "spend-tracing"],
  selectedSources: ["invoice-finder", "approval-desk", "spend-tracker"].map(id => ({ id, sha256: "test-source-hash" })),
  wiring: { edgeIds: ["invoice-to-search", "invoice-to-decisions", "invoice-to-spend"] },
};
const requirements = [{ id: "r", text: "Search invoices", priority: 1 }];
const provenance = { id: "test-analysis", model: "unit-test", promptVersion: "test-v1", inputFingerprint: "test-fingerprint", createdAt: new Date(0).toISOString(), cached: false };
const analyzer: typeof analyze = async opts => ({
  data: opts.schema.parse({ requirements: [{ id: "r", capabilityIds: ["fuzzy-search"], constraint: false, complete: true, reason: "Test fixture source mapping.", limitations: [] }] }), provenance,
});
test("combination interpretation uses validated AI mapping and presents inferred provenance", async () => {
  const result = await assessCombination(requirements, invoice, { analyzer });
  assert.equal(result[0].status, "covered");
  assert.equal(result[0].priority, 1);
  assert.deepEqual(result[0].capabilityIds, ["fuzzy-search"]);
  assert.match(result[0].note, /AI assessment.*not an acceptance test/);
});
test("missing source, capability or wire rejects an invented active capability before persistence", async () => {
  for (const selection of [
    { ...invoice, capabilityIds: [] },
    { ...invoice, selectedSources: [] },
    { ...invoice, wiring: { edgeIds: [] } },
  ]) await assert.rejects(assessCombination(requirements, selection, { analyzer }), /Unknown or repeated capability/);
});
test("AI errors propagate, not a canned result", async () => {
  await assert.rejects(assessCombination(requirements, invoice, { analyzer: async () => { throw new Error("provider unavailable"); } }), /provider unavailable/);
});
test("legacy empty requirements do not call provider", async () => {
  assert.deepEqual(await assessCombination([], invoice, { analyzer: async () => { throw new Error("must not call"); } }), []);
});
test("unknown recipe IDs fail before invoking a provider", async () => {
  await assert.rejects(assessCombination(requirements, { ...invoice, recipeId: "injected" }, { analyzer: async () => { throw new Error("must not call"); } }), /Unknown combination recipe/);
});
test("mapping schemas reject unknown/duplicate/missing IDs and false completeness", () => {
  const schema = requirementMappingSchema(["r"], ["cap"]);
  const valid = { id: "r", capabilityIds: ["cap"], constraint: false, complete: true, reason: "Source supports this fixture", limitations: [] };
  assert(schema.safeParse({ requirements: [valid] }).success);
  for (const requirements of [[], [valid, valid], [{ ...valid, id: "injected" }], [{ ...valid, capabilityIds: ["invented"] }]]) {
    assert.equal(schema.safeParse({ requirements }).success, false);
  }
  for (const r of [{ ...valid, limitations: ["unsupported portion"] }, { ...valid, constraint: true }, { ...valid, capabilityIds: [] }]) {
    assert.equal(schema.parse({ requirements: [r] }).requirements[0].complete, false, "Contradictory completeness can only be downgraded, never upgraded.");
  }
});
