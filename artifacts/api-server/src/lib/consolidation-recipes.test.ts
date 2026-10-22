import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "@workspace/db";
import {
  consolidationCaseInput, consolidationFingerprint, validateConsolidationCase,
  currentConsolidationSourceHash, registerConsolidationSources, type ConsolidationCase,
  validateInvoiceConfig,
} from "./consolidation-recipes";
import { invoiceExportRecipe } from "./consolidation-export-builder";

const base: ConsolidationCase = {
  id: "cc_test", recipeId: "invoice", title: "Test only", need: "Test invoice composition",
  baseSolutionId: "invoice-finder", capabilityIds: ["fuzzy-search","bulk-decisions"],
  selectedSources: ["invoice-finder","approval-desk"].map(id => ({id,solutionId:id,version:"test",sha256:"test"})),
  config: {schemaVersion:1}, wiring: {edgeIds:["invoice-to-search","invoice-to-decisions"]},
  revision:1, createdAt:"",updatedAt:"",fingerprint:"",runUrl:"/invoice-consolidation/",
};
test("trusted recipes reject single-source and unsupported input", async () => {
  assert.equal(consolidationCaseInput.safeParse({recipeId:"invoice",title:"t",need:"n",baseSolutionId:"invoice-finder",selectedSourceIds:["invoice-finder"],capabilityIds:["fuzzy-search"],config:{schemaVersion:1},wiring:{edgeIds:["invoice-to-search"]}}).success,false);
  await assert.rejects(validateConsolidationCase({...base,selectedSources:base.selectedSources.slice(0,1)}), /at least two/);
  await assert.rejects(validateConsolidationCase({...base,capabilityIds:["uploaded-code"]}), /Every capability/);
  await assert.rejects(validateConsolidationCase({...base,wiring:{edgeIds:[]}}), /Wiring must connect/);
  await assert.rejects(validateConsolidationCase({...base,wiring:{edgeIds:["invoice-to-search","invoice-to-decisions","arbitrary-http"]}}), /Wiring must connect/);
});
test("fingerprint pins selected hashes, config, base, capabilities and wires independent of ordering", () => {
  const first = consolidationFingerprint(base);
  assert.equal(first,consolidationFingerprint({...base,selectedSources:[...base.selectedSources].reverse(),capabilityIds:[...base.capabilityIds].reverse(),wiring:{edgeIds:[...base.wiring.edgeIds].reverse()}}));
  assert.notEqual(first,consolidationFingerprint({...base,baseSolutionId:"approval-desk"}));
  assert.notEqual(first,consolidationFingerprint({...base,config:{schemaVersion:2}}));
  assert.notEqual(first,consolidationFingerprint({...base,selectedSources:base.selectedSources.map(s=>({...s,sha256:"changed"}))}));
});
test("invoice config remains schema version 1 and validates granular selections without expanding legacy defaults", () => {
  assert.deepEqual(validateInvoiceConfig(base.config, base.capabilityIds), { schemaVersion: 1 });
  const config = { schemaVersion: 1, featureIds: ["invoice-details", "bulk-actions", "review-queue"], experience: "review-led" };
  assert.deepEqual(validateInvoiceConfig(config, base.capabilityIds), config);
  for (const [config, error] of [
    [{ schemaVersion: 2 }, /unsupported fields or values/],
    [{ schemaVersion: 1, arbitrary: true }, /unsupported fields or values/],
    [{ schemaVersion: 1, featureIds: "invoice-details" }, /unsupported fields or values/],
    [{ schemaVersion: 1, featureIds: ["invoice-details", "unknown"] }, /Unknown invoice feature/],
    [{ schemaVersion: 1, featureIds: ["invoice-details", "invoice-details"] }, /Duplicate/],
    [{ schemaVersion: 1, featureIds: [] }, /invoice-details is required/],
    [{ schemaVersion: 1, featureIds: ["invoice-details", "review-queue"] }, /requires bulk-actions/],
    [{ schemaVersion: 1, featureIds: ["invoice-details", "budget-positions"] }, /requires capability/],
    [{ schemaVersion: 1, featureIds: ["invoice-details"], experience: "review-led" }, /requires review-queue/],
    [{ schemaVersion: 1, experience: "budget-led" }, /requires budget-positions/],
    [{ schemaVersion: 1, experience: "other" }, /unsupported fields or values/],
  ] as const) assert.throws(() => validateInvoiceConfig(config, base.capabilityIds), error);
});
test("invoice feature and experience config is pinned and embedded in exports only when explicit", () => {
  const legacy = invoiceExportRecipe(base);
  assert.deepEqual(legacy, { schemaVersion: 1, snapshotId: base.fingerprint, sources: base.selectedSources.map(s => s.id),
    capabilities: base.capabilityIds, baseSourceId: base.baseSolutionId, wiring: base.wiring });
  assert.equal("featureIds" in legacy, false);
  assert.equal("experience" in legacy, false);
  const explicit = { ...base, config: { schemaVersion: 1, featureIds: ["invoice-details", "bulk-actions", "review-queue"], experience: "review-led" } };
  assert.notEqual(consolidationFingerprint(base), consolidationFingerprint(explicit));
  assert.notEqual(consolidationFingerprint(explicit), consolidationFingerprint({ ...explicit, config: { ...explicit.config, experience: "invoice-led" } }));
  const embedded = JSON.parse(JSON.stringify(invoiceExportRecipe(explicit)));
  assert.deepEqual(embedded.featureIds, explicit.config.featureIds);
  assert.equal(embedded.experience, "review-led");
  assert.throws(() => invoiceExportRecipe({ ...base, config: { schemaVersion: 1, featureIds: [] } }), /invoice-details/);
});
test("invoice config errors are surfaced before source registration or export reads", async () => {
  await assert.rejects(validateConsolidationCase({ ...base, config: { schemaVersion: 1, featureIds: ["invoice-details", "review-queue"] } }), /requires bulk-actions/);
});
test("real allowlisted source archives hash deterministically; arbitrary source paths fail", async () => {
  for (const id of ["invoice-finder","approval-desk","spend-tracker","budget-and-forecast","management-reporting"]) {
    const first = await currentConsolidationSourceHash(id);
    assert.match(first,/^[a-f0-9]{64}$/);
    assert.equal(first,await currentConsolidationSourceHash(id));
  }
  await assert.rejects(currentConsolidationSourceHash("../../etc/passwd"), /outside the trusted registry/);
});
test("source registration cannot grant its caller privileges", async () => {
  const original = pool.query;
  pool.query = (async () => ({rows:[{can_manage_solution_packages:false}]})) as unknown as typeof pool.query;
  try { await assert.rejects(registerConsolidationSources("test-only-unprivileged"), /permission is required/); }
  finally { pool.query = original; }
});
test("validation compares real current source bytes, not only registered metadata", async () => {
  const selectedSources = await Promise.all(base.selectedSources.map(async s => {
    const sha256 = await currentConsolidationSourceHash(s.id);
    return {...s,sha256,version:`sha256:${sha256}`};
  }));
  const original = pool.query;
  let registered = selectedSources;
  pool.query = (async () => ({rows:registered.map(metadata=>({metadata}))})) as unknown as typeof pool.query;
  try {
    const valid = {...base,selectedSources};
    await validateConsolidationCase(valid);
    await assert.rejects(validateConsolidationCase({...valid,fingerprint:"incorrect"}), /fingerprint/);
    registered = selectedSources.map(s => ({...s,sha256:"0".repeat(64)}));
    await assert.rejects(validateConsolidationCase({...valid,selectedSources:registered}), /differs from the pinned registered version/);
  } finally { pool.query = original; }
});
