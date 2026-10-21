// Bundle with esbuild for an extracted export. Run from the directory containing recipe.json.
// This verifies the exported selection, not an unrelated all-capabilities default.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRecipe } from "../src/domain/recipe";
import { search, preview, apply, trace, invoiceRows, EMPTY_CRITERIA } from "../src/domain/engine";

const recipe = validateRecipe(JSON.parse(readFileSync("recipe.json", "utf8")));
const at = "2026-10-01T12:00:00.000Z";

test("exported saved recipe has a valid source and exact wiring selection", () => {
  assert.ok(recipe.snapshotId);
  assert.ok(recipe.sources.length >= 2 && recipe.sources.length <= 3);
  assert.ok(recipe.sources.includes(recipe.baseSourceId));
  assert.equal(recipe.wiring.edgeIds.length, recipe.capabilities.length);
  assert.equal(invoiceRows([]).length, 8);
});
test("saved fuzzy-search selection is enforced by the actual original engine", () => {
  const run = () => search(recipe, [], { ...EMPTY_CRITERIA, text: "Boreel", mode: "fuzzy" });
  if (recipe.capabilities.includes("fuzzy-search")) {
    assert.ok(run().some(r => r.invoice.id === "I1"));
    assert.ok(search(recipe, [], { ...EMPTY_CRITERIA, text: "BP-100", mode: "exact" }).some(r => r.invoice.id === "I2"));
  } else assert.throws(run, /removed/);
});
test("saved bulk-decisions selection controls writes and staged approval", () => {
  const run = () => preview(recipe, [], ["I1", "I6", "I4"], "approve", "reviewer", "Export verification");
  if (!recipe.capabilities.includes("bulk-decisions")) {
    assert.throws(run, /removed/);
    // apply gates capabilities before consuming even a forged preview.
    assert.throws(() => apply(recipe, [], {} as ReturnType<typeof preview>, "disabled", at), /removed/);
    return;
  }
  const batch = run();
  assert.equal(batch.eligible.length, 2);
  assert.equal(batch.ineligible.length, 1);
  const result = apply(recipe, [], batch, "export-check", at);
  assert.equal(result.applied.length, 2);
  assert.equal(invoiceRows(result.ledger).find(i => i.id === "I1")?.status, "approved");
  assert.equal(invoiceRows(result.ledger).find(i => i.id === "I6")?.status, "pending");
  assert.throws(() => apply(recipe, result.ledger, batch, "stale", at), /stale/);
  if (recipe.capabilities.includes("spend-tracing")) {
    const traced = trace(recipe, result.ledger, { level: "portfolio" });
    assert.ok(traced.summary.reconciles);
    assert.ok(traced.lines.filter(l => l.invoice.id === "I1").every(l => l.bucket === "approvedUnpaid"));
  }
});
test("saved spend-tracing selection controls source-line reconciliation", () => {
  const run = () => trace(recipe, [], { level: "portfolio" });
  if (!recipe.capabilities.includes("spend-tracing")) {
    assert.throws(run, /removed/);
    return;
  }
  const result = run();
  assert.ok(result.summary.reconciles);
  assert.equal(result.lines.length, 16);
  for (const invoice of invoiceRows([])) {
    assert.equal(result.lines.filter(l => l.invoice.id === invoice.id).reduce((sum, l) => sum + l.line.cents, 0), invoice.cents);
  }
});
