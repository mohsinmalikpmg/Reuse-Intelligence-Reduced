import test from "node:test";
import assert from "node:assert/strict";
import { proposedJourneys, proposedNav, retainedPatterns, pruneInvoiceConfig, recommendInvoice, resolveInvoiceFeatures, validateInvoiceExperience } from "./invoice-features";

const ALL = ["fuzzy-search", "bulk-decisions", "spend-tracing"];
test("legacy absent featureIds resolves to all available", () => {
  assert.equal(resolveInvoiceFeatures(ALL).length, 9);
  assert.deepEqual(pruneInvoiceConfig({ foo: 1 }, ["fuzzy-search"]), { foo: 1 });
});
test("removing a capability prunes dependents and invalid experience", () => {
  const out = pruneInvoiceConfig({ featureIds: ["invoice-details", "bulk-actions", "review-queue", "budget-positions"], experience: "review-led" }, ["spend-tracing"]);
  assert.deepEqual(out.featureIds, ["invoice-details", "budget-positions"]);
  assert.equal(out.experience, undefined);
});
test("dependent without its requirement is dropped", () => {
  assert.deepEqual(resolveInvoiceFeatures(ALL, ["invoice-details", "spend-tracing"]), ["invoice-details"]);
});
test("recommendation is deterministic and grounded", () => {
  const r = recommendInvoice(["Approve the backlog in bulk from a reviewer queue"], ALL);
  assert.equal(r.experience, "review-led");
  assert.equal(r.baseSourceId, "approval-desk");
  assert.ok(r.featureIds.includes("review-queue") && r.featureIds.includes("bulk-actions"));
  assert.ok(validateInvoiceExperience(r.experience, r.featureIds));
  assert.deepEqual(recommendInvoice(["Approve the backlog in bulk from a reviewer queue"], ALL), r);
});
test("budget-led needs budget positions; falls back otherwise", () => {
  assert.equal(recommendInvoice(["Show budget overrun and trace labour lines"], ALL).experience, "budget-led");
  assert.equal(recommendInvoice(["Show budget overrun and trace labour lines"], ["fuzzy-search"]).experience, "invoice-led");
});

test("proposed nav mirrors runtime: fixed order, conditional views, landing only", () => {
  assert.deepEqual(proposedNav(["invoice-details"], "invoice-led"), { nav: ["Invoices"], landing: "Invoices" });
  const all = resolveInvoiceFeatures(ALL);
  assert.deepEqual(proposedNav(all, "budget-led"), { nav: ["Invoices", "Review queue", "Budgets", "Activity"], landing: "Budgets" });
  assert.deepEqual(proposedNav(all, "review-led").nav, proposedNav(all, "invoice-led").nav);
  assert.equal(proposedNav(["invoice-details", "decision-history"], "review-led").landing, "Invoices");
  assert.ok(!proposedNav(all, "invoice-led").nav.some((n) => /detail|trace/i.test(n)));
});
test("journeys and retained patterns never claim excluded functions", () => {
  const j = proposedJourneys(["invoice-details"], "invoice-led").join(" ");
  assert.ok(!/duplicate|history|Activity|Budgets|queue/i.test(j));
  assert.ok(proposedJourneys(resolveInvoiceFeatures(ALL), "review-led")[0].startsWith("Open the Review queue"));
  assert.ok(!retainedPatterns(["invoice-details"]).some((r) => /side panel/.test(r) && !/not/.test(r)));
  assert.equal(retainedPatterns(["invoice-details"]).length, 1);
});
