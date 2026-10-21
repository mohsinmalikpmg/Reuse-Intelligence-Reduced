import { test } from "node:test";
import assert from "node:assert/strict";
import { createSeedState } from "../src/domain/fixture.ts";
import { validateState } from "../src/domain/validate.ts";
import { EMPTY_CRITERIA, searchInvoices, compileCriteria, normalizeInvoiceNumber, predicateExclusions } from "../src/domain/search.ts";
import { findDuplicates, duplicateIndex } from "../src/domain/duplicates.ts";
import { spendOverall, spendByAfe } from "../src/domain/spend.ts";
import { applyDecision } from "../src/domain/workflow.ts";
import { parseStored } from "../src/domain/storage.ts";
import { parseDollarsToCents, formatCad } from "../src/domain/money.ts";
import type { Invoice } from "../src/domain/types.ts";

const seed = createSeedState();
const ids = (xs: Invoice[]) => xs.map((x) => x.id);
const AT = "2026-09-20T00:00:00.000Z";

test("fixture is valid and matches spec", () => {
  assert.deepEqual(validateState(seed), []);
  assert.equal(seed.invoices.length, 8);
  assert.equal(seed.afes.reduce((n, a) => n + a.budgetCents, 0), 15000000);
});

test("baseline overall totals", () => {
  assert.deepEqual(spendOverall(seed.invoices, seed.afes), {
    budget: 15000000, pending: 8000000, approvedUnpaid: 4000000, paid: 3000000, rejected: 500000,
    committed: 7000000, remaining: 8000000, projectedRemaining: 0,
  });
});

test("baseline AFE totals", () => {
  const [a1, a2] = spendByAfe(seed.invoices, seed.afes).map((x) => x.totals);
  assert.deepEqual([a1.pending, a1.approvedUnpaid, a1.paid, a1.rejected, a1.committed, a1.remaining, a1.projectedRemaining],
    [2000000, 2500000, 2000000, 500000, 4500000, 5500000, 3500000]);
  assert.deepEqual([a2.pending, a2.approvedUnpaid, a2.paid, a2.rejected, a2.committed, a2.remaining, a2.projectedRemaining],
    [6000000, 1500000, 1000000, 0, 2500000, 2500000, -3500000]);
});

test("missing references fail validation", () => {
  for (const patch of [{ supplierId: "S9" }, { parId: "PAR-999" }, { afeId: "AFE-999" }, { afeId: "AFE-200" }]) {
    const s = createSeedState();
    s.invoices[0] = { ...s.invoices[0], ...patch };
    assert.ok(validateState(s).length > 0, JSON.stringify(patch));
  }
  const s = createSeedState();
  s.pars[0] = { ...s.pars[0], afeId: "AFE-404" };
  assert.ok(validateState(s).length > 0);
});

test("combined filters compose with AND, dates and amounts inclusive", () => {
  const c = { ...EMPTY_CRITERIA, supplierId: "S1", dateFrom: "2026-09-01", dateTo: "2026-09-01", minCents: 1000000, maxCents: 1000000, statuses: ["pending" as const], afeId: "AFE-100", parId: "PAR-110" };
  assert.deepEqual(ids(searchInvoices(seed.invoices, seed.suppliers, c)), ["I1", "I2"]);
  assert.deepEqual(ids(searchInvoices(seed.invoices, seed.suppliers, { ...c, text: "bp-100" })), ["I1", "I2"]);
  assert.deepEqual(ids(searchInvoices(seed.invoices, seed.suppliers, { ...c, maxCents: 999999 })), []);
  assert.deepEqual(ids(searchInvoices(seed.invoices, seed.suppliers, { ...EMPTY_CRITERIA, dateFrom: "2026-09-12", dateTo: "2026-09-15" })), ["I6", "I7"]);
  assert.deepEqual(ids(searchInvoices(seed.invoices, seed.suppliers, { ...EMPTY_CRITERIA, text: "prairie", statuses: ["paid", "rejected"] })), ["I5", "I8"]);
  assert.deepEqual(ids(searchInvoices(seed.invoices, seed.suppliers, { ...EMPTY_CRITERIA, afeId: "AFE-200", minCents: 1500000 })), ["I6", "I7"]);
  assert.equal(searchInvoices(seed.invoices, seed.suppliers, EMPTY_CRITERIA).length, 8);
});

test("contradictory criteria are reported and exclusions explained", () => {
  assert.equal(compileCriteria({ ...EMPTY_CRITERIA, dateFrom: "2026-09-10", dateTo: "2026-09-01" }).errors.length, 1);
  assert.equal(compileCriteria({ ...EMPTY_CRITERIA, minCents: 5, maxCents: 4 }).errors.length, 1);
  const ex = predicateExclusions(seed.invoices, seed.suppliers, { ...EMPTY_CRITERIA, supplierId: "S3" });
  assert.deepEqual(ex, [{ label: "supplier = S3", excluded: 6 }]);
});

test("normalized duplicates and false positives", () => {
  assert.equal(normalizeInvoiceNumber("bp 100"), "BP100");
  const all = seed.invoices;
  assert.deepEqual(ids(findDuplicates(all[0], all)), ["I2"]);
  assert.deepEqual(ids(findDuplicates(all[1], all)), ["I1"]);
  assert.deepEqual([...duplicateIndex(all).keys()].sort(), ["I1", "I2"]);
  // same amount/date/supplier is NOT a duplicate (I8 vs I1 amount; BP-101 vs BP-100 near number)
  assert.deepEqual(ids(findDuplicates(all[6], all)), []);
  // same normalized number but different supplier is NOT a duplicate
  const other: Invoice = { ...all[0], id: "X", supplierId: "S2" };
  assert.deepEqual(ids(findDuplicates(other, [...all, other])), []);
  // duplicates computed against all invoices even when the result list is filtered
  const filtered = searchInvoices(all, seed.suppliers, { ...EMPTY_CRITERIA, text: "BP-100", statuses: ["rejected"] });
  assert.equal(filtered.length, 0);
  assert.deepEqual(ids(findDuplicates(all[0], all)), ["I2"]);
});

test("transition boundaries", () => {
  const ok = applyDecision(seed, "I1", "approve", "reviewer", "", AT);
  assert.ok(ok.ok && ok.value.invoices[0].status === "approved" && ok.value.decisions.length === 1);
  assert.equal(seed.invoices[0].status, "pending", "pure");
  assert.ok(!applyDecision(seed, "I1", "approve", "viewer", "", AT).ok);
  assert.ok(!applyDecision(seed, "I1", "reject", "reviewer", "   ", AT).ok);
  const rej = applyDecision(seed, "I1", "reject", "reviewer", "dup of I2", AT);
  assert.ok(rej.ok && rej.value.invoices[0].status === "rejected" && rej.value.decisions[0].reason === "dup of I2");
  assert.ok(!applyDecision(seed, "I1", "pay", "reviewer", "", AT).ok, "pending cannot be paid");
  assert.ok(applyDecision(seed, "I3", "pay", "reviewer", "", AT).ok);
  assert.ok(!applyDecision(seed, "I3", "approve", "reviewer", "", AT).ok);
  for (const term of ["I4", "I5"]) for (const a of ["approve", "reject", "pay"] as const)
    assert.ok(!applyDecision(seed, term, a, "reviewer", "x", AT).ok);
  assert.ok(!applyDecision(seed, "I99", "approve", "reviewer", "", AT).ok);
  // duplicates do not block decisions
  assert.ok(applyDecision(seed, "I2", "approve", "reviewer", "", AT).ok);
});

test("storage parsing surfaces corruption", () => {
  assert.equal(parseStored(null).kind, "empty");
  assert.equal(parseStored("{oops").kind, "error");
  assert.equal(parseStored(JSON.stringify({ schemaVersion: 2 })).kind, "error");
  const bad = createSeedState(); bad.invoices[0].parId = "PAR-X";
  assert.equal(parseStored(JSON.stringify(bad)).kind, "error");
  assert.equal(parseStored(JSON.stringify(seed)).kind, "ok");
});

test("money helpers", () => {
  assert.equal(parseDollarsToCents("10,000.5"), 1000050);
  assert.equal(parseDollarsToCents(""), null);
  assert.ok(Number.isNaN(parseDollarsToCents("abc") as number));
  assert.equal(formatCad(-3500000), "-$35,000.00");
});
