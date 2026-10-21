import { test } from "node:test";
import assert from "node:assert/strict";
import { createSeedState } from "../src/domain/fixture.ts";
import { EMPTY_CRITERIA, rankedSearch, searchInvoices } from "../src/domain/search.ts";
import { editDistance, explainReason } from "../src/domain/fuzzy.ts";
import { findDuplicates } from "../src/domain/duplicates.ts";
import type { SearchCriteria } from "../src/domain/search.ts";

const seed = createSeedState();
const q = (text: string, extra: Partial<SearchCriteria> = {}) => rankedSearch(seed.invoices, seed.suppliers, { ...EMPTY_CRITERIA, text, ...extra });
const ids = (text: string, extra: Partial<SearchCriteria> = {}) => q(text, extra).map((r) => r.invoice.id);

test("edit distance handles transpositions", () => {
  assert.equal(editDistance("borel", "boreal"), 1);
  assert.equal(editDistance("servces", "services"), 1);
  assert.equal(editDistance("pariire", "prairie", 3) <= 2, true);
  assert.equal(editDistance("abc", "abc"), 0);
});

test("supplier typos find the right supplier only", () => {
  assert.deepEqual(ids("borel parts"), ["I1", "I2", "I7"]);
  assert.deepEqual(ids("praire servces"), ["I3", "I5", "I8"]);
  assert.deepEqual(ids("SUMIT"), ["I4", "I6"]);
  for (const r of q("borel parts")) assert.equal(r.match?.tier, "approximate");
});

test("nonsense and short queries are conservative", () => {
  assert.deepEqual(ids("qxzvlm"), []);
  assert.deepEqual(ids("zzz"), []);
  assert.deepEqual(ids("bor"), ["I1", "I2", "I7"]); // prefix, not fuzzy
  assert.deepEqual(ids("brl"), []); // 3 letters never fuzzy
  assert.deepEqual(ids("borel parts qxzvlm"), []); // every word must match
});

test("case and punctuation are normalized; exact numbers do not drag in neighbours", () => {
  assert.deepEqual(ids("bp 100"), ["I1", "I2"]);
  assert.deepEqual(ids("B.P/100"), ["I1", "I2"]);
  assert.deepEqual(ids("bp-100"), ["I1", "I2"]);
  for (const r of q("bp-100")) assert.equal(r.match?.tier, "exact");
});

test("close invoice numbers surface only when no exact number exists", () => {
  const r = q("PS-204");
  assert.deepEqual(r.map((x) => x.invoice.id), ["I3", "I5", "I8"]);
  assert.ok(r.every((x) => x.match?.tier === "approximate" && x.match.reasons[0].field === "invoice number"));
  assert.match(explainReason(r[0].match!.reasons[0]), /1 edit from invoice number PS-201/);
});

test("exact matches rank above approximate", () => {
  const r = q("prairie");
  assert.ok(r.every((x) => x.match?.tier === "exact"));
  const mixed = q("ps20");
  assert.deepEqual(mixed.map((x) => x.invoice.id), ["I3", "I5", "I8"]);
  assert.equal(mixed[0].match?.reasons[0].kind, "partial");
});

test("exact mode disables typo tolerance", () => {
  assert.deepEqual(ids("borel parts", { mode: "exact" }), []);
  assert.deepEqual(ids("boreal", { mode: "exact" }), ["I1", "I2", "I7"]);
});

test("structured filters stay AND-composed with fuzzy text", () => {
  assert.deepEqual(ids("praire servces", { statuses: ["paid"] }), ["I8"]);
  assert.deepEqual(ids("borel", { afeId: "AFE-200" }), ["I7"]);
  assert.deepEqual(searchInvoices(seed.invoices, seed.suppliers, { ...EMPTY_CRITERIA, text: "borel", maxCents: 1 }), []);
});

test("strict duplicates ignore fuzzy similarity", () => {
  const i3 = seed.invoices.find((i) => i.id === "I3")!;
  assert.deepEqual(findDuplicates(i3, seed.invoices), []); // PS-201 vs PS-202/203 are close but not duplicates
  const i1 = seed.invoices.find((i) => i.id === "I1")!;
  assert.deepEqual(findDuplicates(i1, seed.invoices).map((d) => d.id), ["I2"]);
});
