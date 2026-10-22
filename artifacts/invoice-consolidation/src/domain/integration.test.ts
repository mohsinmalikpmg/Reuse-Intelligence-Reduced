import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RECIPE, CAPABILITY_EDGES, validateRecipe, recipeFromCase, storageKey, featureEnabled, resolveInvoiceFeatures, validateInvoiceExperience } from "./recipe";
import { apply, preview, search, trace, invoiceRows, readLedger, saveLedger, spendState, states, EMPTY_CRITERIA } from "./engine";
import { duplicateIndex } from "../../../invoice-finder/src/domain/duplicates.ts";
import { rollupPortfolio, rollupAfe, rollupPar, reconcile, overrunTrail } from "../../../spend-tracker/src/domain/model.ts";
import { overallTotals } from "../../../approval-desk/src/domain/ledger.ts";
import { SEED } from "../../../approval-desk/src/domain/seed.ts";

const recipe = DEFAULT_RECIPE;
const at = "2026-10-01T12:00:00.000Z";
test("structured bounds are inclusive, compose with fuzzy search, reject reversed ranges and reset", () => {
  const i = invoiceRows([]).find(i => i.id === "I1")!;
  const c = { ...EMPTY_CRITERIA, text: "Boreel", supplierId: i.supplierId, afeId: i.afeId, parId: i.parId,
    dateFrom: i.date, dateTo: i.date, minCents: i.cents, maxCents: i.cents, statuses: [i.status] };
  assert.ok(search(recipe, [], c).some(r => r.invoice.id === i.id));
  assert.equal(search(recipe, [], { ...c, minCents: i.cents + 1, maxCents: null }).length, 0);
  assert.equal(search(recipe, [], { ...c, maxCents: i.cents - 1, minCents: null }).length, 0);
  assert.throws(() => search(recipe, [], { ...c, dateFrom: "2027-01-01" }), /Date from/);
  assert.throws(() => search(recipe, [], { ...c, minCents: i.cents + 1 }), /Min amount/);
  assert.equal(search(recipe, [], EMPTY_CRITERIA).length, invoiceRows([]).length);
});
test("duplicate identity survives filtering and independent decisions without merging records", () => {
  const ledger = apply(recipe, [], preview(recipe, [], ["I1"], "reject", "reviewer", "Review duplicate"), "dup", at).ledger;
  const all = invoiceRows(ledger);
  const duplicates = duplicateIndex(all);
  const visible = search(recipe, ledger, { ...EMPTY_CRITERIA, statuses: ["pending"] });
  assert.ok(!visible.some(r => r.invoice.id === "I1"));
  assert.ok(visible.some(r => r.invoice.id === "I2"));
  assert.deepEqual(duplicates.get("I2"), ["I1"]);
  assert.equal(all.length, invoiceRows([]).length);
  assert.equal(all.find(i => i.id === "I2")!.status, "pending");
});
test("every budget scope reconciles integer invoice and source-line buckets before and after replay", () => {
  const reviewed = apply(recipe, [], preview(recipe, [], ["I1", "I6"], "approve", "reviewer", "Checked"), "budget-review", at).ledger;
  const approved = apply(recipe, reviewed, preview(recipe, reviewed, ["I6"], "approve", "controller", "Checked"), "budget-controller", at).ledger;
  const rejected = apply(recipe, approved, preview(recipe, approved, ["I2"], "reject", "reviewer", "Duplicate"), "budget-reject", at).ledger;
  for (const ledger of [[], reviewed, approved, rejected]) {
    const s = spendState(JSON.parse(JSON.stringify(ledger)));
    const total = rollupPortfolio(s);
    const independent = overallTotals(SEED, states(ledger));
    for (const key of ["pending", "approvedUnpaid", "paid", "rejected", "committed", "budget", "remaining", "projectedRemaining"] as const) {
      assert.ok(Number.isSafeInteger(total[key]));
      assert.equal(total[key], independent[key]);
    }
    for (const level of ["afe", "par"] as const) {
      for (const id of Object.keys(level === "afe" ? s.afes : s.pars)) {
        const r = level === "afe" ? rollupAfe(s, id) : rollupPar(s, id);
        assert.equal(reconcile(s, level, id).matches, true);
        const t = trace(recipe, ledger, { level, id });
        assert.equal(t.summary.reconciles, true);
        for (const bucket of ["pending", "approvedUnpaid", "paid", "rejected", "committed"] as const)
          assert.equal(t.summary.total[bucket], r[bucket]);
        assert.equal(r.committed, r.paid + r.approvedUnpaid);
        assert.equal(r.remaining, r.budget - r.committed);
        assert.equal(r.projectedRemaining, r.remaining - r.pending);
        assert.equal(r.committedOverrun, Math.max(0, -r.remaining));
        assert.equal(r.projectedOverrun, Math.max(0, -r.projectedRemaining));
        assert.equal(overrunTrail(s, level, id).steps.at(-1)!.runningCents, r.projectedRemaining);
      }
    }
    assert.equal(Object.keys(s.invoices).length, total.invoiceCount);
    for (const i of Object.values(s.invoices)) {
      const lines = trace(recipe, ledger, { level: "par", id: i.parId }).lines.filter(l => l.invoice.id === i.id);
      assert.equal(lines.reduce((n, l) => n + l.line.cents, 0), i.cents);
      assert.ok(lines.every(l => l.status === i.status));
    }
  }
});
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
      () => search(r, [], { ...EMPTY_CRITERIA, text: "Boreel" }),
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
test("legacy configuration retains its exact serialization and browser ledger key", () => {
  const validated = validateRecipe(recipe);
  assert.deepEqual(validated, recipe);
  assert.equal("featureIds" in validated, false);
  assert.equal("experience" in validated, false);
  const legacyKey = `invoice-consolidation:v1:${encodeURIComponent(JSON.stringify({ ...recipe, sources: [...recipe.sources].sort(), capabilities: [...recipe.capabilities].sort() }))}`;
  assert.equal(storageKey(validated), legacyKey);
  assert.equal(resolveInvoiceFeatures(recipe.capabilities).length, 9);
  assert.equal(validateInvoiceExperience(undefined, []), "invoice-led");
});
test("explicit config roundtrips through saved cases and isolates storage", () => {
  const config = { schemaVersion: 1, featureIds: ["invoice-details", "bulk-actions", "review-queue"], experience: "review-led" };
  const r = recipeFromCase({ fingerprint: "saved", selectedSources: recipe.sources.map(id => ({ id })), capabilityIds: recipe.capabilities,
    baseSolutionId: recipe.baseSourceId, config, wiring: recipe.wiring });
  assert.deepEqual(r.featureIds, config.featureIds);
  assert.equal(r.experience, "review-led");
  assert.equal(featureEnabled(r, "review-queue"), true);
  assert.equal(featureEnabled(r, "fuzzy-matching"), false);
  assert.notEqual(storageKey(r), storageKey({ ...r, featureIds: ["invoice-details"] }));
  assert.equal(storageKey(r), storageKey({ ...r, featureIds: [...r.featureIds!].reverse() }));
  assert.notEqual(storageKey(r), storageKey({ ...r, experience: "invoice-led" }));
});
test("feature resolver rejects unknown, duplicate, unavailable and incomplete selections and experiences", () => {
  assert.throws(() => resolveInvoiceFeatures(recipe.capabilities, ["unknown"]), /Unknown/);
  assert.throws(() => resolveInvoiceFeatures(recipe.capabilities, ["invoice-details", "invoice-details"]), /Duplicate/);
  assert.throws(() => resolveInvoiceFeatures([], ["invoice-details", "fuzzy-matching"]), /requires capability/);
  assert.throws(() => resolveInvoiceFeatures(recipe.capabilities, ["invoice-details", "review-queue"]), /requires bulk-actions/);
  assert.throws(() => resolveInvoiceFeatures(recipe.capabilities, ["invoice-details", "spend-tracing"]), /requires budget-positions/);
  assert.throws(() => resolveInvoiceFeatures(recipe.capabilities, []), /invoice-details is required/);
  assert.throws(() => validateRecipe({ ...recipe, featureIds: ["invoice-details"], experience: "review-led" }), /requires review-queue/);
  assert.throws(() => validateRecipe({ ...recipe, featureIds: ["invoice-details"], experience: "budget-led" }), /requires budget-positions/);
  assert.throws(() => validateRecipe({ ...recipe, experience: "unknown" }), /Unknown invoice experience/);
  assert.doesNotThrow(() => validateRecipe({ ...recipe, featureIds: ["invoice-details", "budget-positions"], experience: "budget-led" }));
});
test("granular domain gates reject disabled operations even when broad capabilities remain enabled", () => {
  const r = validateRecipe({ ...recipe, featureIds: ["invoice-details"] });
  assert.equal(search(r, [], EMPTY_CRITERIA).length, invoiceRows([]).length);
  assert.ok(search(r, [], { ...EMPTY_CRITERIA, text: "BP-100", mode: "exact" }).length);
  assert.throws(() => search(r, [], { ...EMPTY_CRITERIA, text: "Boreel" }), /fuzzy-matching.*removed/);
  for (const criteria of [
    { supplierId: "SUP-1" }, { afeId: "AFE-100" }, { parId: "PAR-100" }, { dateFrom: "2026-01-01" },
    { dateTo: "2026-12-31" }, { minCents: 0 }, { maxCents: 0 }, { statuses: ["pending"] as const },
  ]) assert.throws(() => search(r, [], { ...EMPTY_CRITERIA, ...criteria, statuses: [...(criteria.statuses ?? [])] }), /structured-filters.*removed/);
  assert.throws(() => preview(r, [], ["I1"], "approve", "reviewer", "Checked"), /bulk-actions.*removed/);
  const batch = preview(recipe, [], ["I1"], "approve", "reviewer", "Checked");
  assert.throws(() => apply(r, [], batch, "disabled", at), /bulk-actions.*removed/);
  assert.throws(() => trace(r, [], { level: "portfolio" }), /spend-tracing.*removed/);
  const filtersOnly = validateRecipe({ ...recipe, featureIds: ["invoice-details", "structured-filters"] });
  assert.doesNotThrow(() => search(filtersOnly, [], { ...EMPTY_CRITERIA, minCents: 0 }));
  assert.throws(() => search(filtersOnly, [], { ...EMPTY_CRITERIA, text: "Boreel" }), /fuzzy-matching/);
  const fuzzyOnly = validateRecipe({ ...recipe, featureIds: ["invoice-details", "fuzzy-matching"] });
  assert.doesNotThrow(() => search(fuzzyOnly, [], { ...EMPTY_CRITERIA, text: "Boreel" }));
  assert.throws(() => search(fuzzyOnly, [], { ...EMPTY_CRITERIA, minCents: 0 }), /structured-filters/);
  const noSearchCapability = validateRecipe({ ...recipe, capabilities: ["bulk-decisions"], wiring: { edgeIds: ["invoice-to-decisions"] } });
  assert.equal(search(noSearchCapability, [], EMPTY_CRITERIA).length, invoiceRows([]).length);
});
test("read-only and missing reason cannot write; duplicate selections do not double-post", () => {
  assert.throws(() => apply(recipe, [], preview(recipe, [], ["I1"], "approve", "viewer", "Checked"), "viewer", at), /Viewer/);
  assert.throws(() => apply(recipe, [], preview(recipe, [], ["I1"], "approve", "reviewer", " "), "blank", at), /reason/);
  assert.equal(apply(recipe, [], preview(recipe, [], ["I1", "I1"], "approve", "reviewer", "Checked"), "dedupe", at).applied.length, 1);
});
