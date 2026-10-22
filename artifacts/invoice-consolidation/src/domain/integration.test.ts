import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RECIPE, CAPABILITY_EDGES, validateRecipe, recipeFromCase, storageKey } from "./recipe";
import { apply, preview, search, trace, invoiceRows, readLedger, saveLedger, EMPTY_CRITERIA } from "./engine";

const recipe = DEFAULT_RECIPE;
const at = "2026-10-01T12:00:00.000Z";
test("all three original implementations compose: fuzzy match, bulk approval, source-line buckets", () => {
  const found = search(recipe, [], { ...EMPTY_CRITERIA, text: "Boreel", mode: "fuzzy" });
  assert.ok(found.some(r => r.invoice.id === "I1"));
  const batch = preview(recipe, [], ["I1", "I2", "I4"], "approve", "reviewer", "Verified source invoices");
  assert.equal(batch.eligible.length, 2);
  assert.equal(batch.ineligible.length, 1);
  const result = apply(recipe, [], batch, "batch1", at);
  assert.equal(result.applied.length, 2);
  const spent = trace(recipe, result.ledger, { level: "afe", id: "AFE-100" });
  assert.equal(spent.summary.reconciles, true);
  assert.equal(spent.lines.filter(l => l.invoice.id === "I1").length, 2);
  assert.ok(spent.lines.filter(l => l.invoice.id === "I1").every(l => l.bucket === "approvedUnpaid"));
  assert.equal(spent.lines.filter(l => l.invoice.id === "I1").reduce((sum, l) => sum + l.line.cents, 0), 1000000);
  assert.equal(invoiceRows(result.ledger).find(i => i.id === "I2")?.status, "approved");
});
test("two-stage approval preserves pending until controller and stale previews fail atomically", () => {
  const first = preview(recipe, [], ["I6"], "approve", "reviewer", "Checked");
  const ledger = apply(recipe, [], first, "review", at).ledger;
  assert.equal(invoiceRows(ledger).find(i => i.id === "I6")?.status, "pending");
  assert.throws(() => apply(recipe, ledger, first, "stale", at), /stale/);
  const next = preview(recipe, ledger, ["I6"], "approve", "controller", "Authorized");
  const complete = apply(recipe, ledger, next, "controller", at).ledger;
  assert.equal(invoiceRows(complete).find(i => i.id === "I6")?.status, "approved");
  assert.equal(trace(recipe, complete, { level: "portfolio" }).summary.reconciles, true);
});
test("each two-source composition works and removed capabilities cannot execute", () => {
  for (let omitted = 0; omitted < 3; omitted++) {
    const sources = recipe.sources.filter((_, i) => i !== omitted);
    const capabilities = recipe.capabilities.filter((_, i) => i !== omitted);
    const r = validateRecipe({ ...recipe, sources, capabilities, baseSourceId: sources[0], wiring: { edgeIds: capabilities.map(c => CAPABILITY_EDGES[c]) } });
    const functions = [
      () => search(r, [], EMPTY_CRITERIA),
      () => preview(r, [], ["I1"], "approve", "reviewer", "Checked"),
      () => trace(r, [], { level: "portfolio" }),
    ];
    functions.forEach((fn, i) => i === omitted ? assert.throws(fn, /removed/) : assert.doesNotThrow(fn));
  }
  assert.throws(() => validateRecipe({ ...recipe, sources: ["invoice-finder"] }), /two or three/);
  assert.throws(() => validateRecipe({ ...recipe, capabilities: ["unknown"] }), /Unknown/);
});
test("snapshots isolate browser data and invalid ledgers surface errors", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const ledger = apply(recipe, [], preview(recipe, [], ["I1"], "reject", "reviewer", "Duplicate"), "reject", at).ledger;
  saveLedger(recipe, ledger, storage);
  assert.equal(readLedger(recipe, storage).length, 1);
  assert.equal(readLedger({ ...recipe, snapshotId: "other" }, storage).length, 0);
  assert.notEqual(storageKey(recipe), storageKey({ ...recipe, capabilities: [] }));
  values.set(storageKey(recipe), "corrupt");
  assert.throws(() => readLedger(recipe, storage), /corrupt/);
  assert.ok(![...values.keys()].some(k => !k.startsWith("invoice-consolidation:")));
});
test("saved case envelope maps authoritative fingerprint and selected sources", () => {
  const r = recipeFromCase({ fingerprint: "sha256-test", selectedSources: recipe.sources.map(id => ({ id })), capabilityIds: recipe.capabilities, baseSolutionId: recipe.baseSourceId, config: { schemaVersion: 1 }, wiring: recipe.wiring });
  assert.equal(r.snapshotId, "sha256-test");
  assert.deepEqual(r.sources, recipe.sources);
  assert.throws(() => validateRecipe({ ...r, wiring: { edgeIds: [] } }), /Wiring/);
});
test("read-only and missing reason cannot write; duplicate selections do not double-post", () => {
  assert.throws(() => apply(recipe, [], preview(recipe, [], ["I1"], "approve", "viewer", "Checked"), "viewer", at), /Viewer/);
  assert.throws(() => apply(recipe, [], preview(recipe, [], ["I1"], "approve", "reviewer", " "), "blank", at), /reason/);
  assert.equal(apply(recipe, [], preview(recipe, [], ["I1", "I1"], "approve", "reviewer", "Checked"), "dedupe", at).applied.length, 1);
});
