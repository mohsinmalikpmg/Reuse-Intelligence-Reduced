import test from "node:test";
import assert from "node:assert/strict";
import { assessCombination } from "./combination-assessment";

const invoice = {
  recipeId: "invoice", capabilityIds: ["fuzzy-search", "bulk-decisions", "spend-tracing"],
  selectedSources: ["invoice-finder", "approval-desk", "spend-tracker"].map(id => ({ id })),
  wiring: { edgeIds: ["invoice-to-search", "invoice-to-decisions", "invoice-to-spend"] },
};
const requirements = ["Search invoices", "Approve multiple invoices", "Track project spend", "Pay invoices via SAP"]
  .map((text, index) => ({ id: `r${index}`, text, priority: index + 1 }));
test("requirements retain priority; actual invoice capabilities, not maintenance matches", () => {
  const result = assessCombination(requirements, invoice);
  assert.deepEqual(result.map(r => r.status), ["covered", "covered", "covered", "missing"]);
  assert.deepEqual(result.map(r => r.priority), [1, 2, 3, 4]);
  assert.deepEqual(result[1].capabilityIds, ["bulk-decisions"]);
});
test("removing capabilities, sources or wiring removes coverage; undo restores it", () => {
  for (const selection of [
    { ...invoice, capabilityIds: ["fuzzy-search", "spend-tracing"] },
    { ...invoice, selectedSources: [{ id: "invoice-finder" }, { id: "spend-tracker" }] },
    { ...invoice, wiring: { edgeIds: ["invoice-to-search", "invoice-to-spend"] } },
  ]) assert.equal(assessCombination(requirements, selection)[1].status, "missing");
  assert.equal(assessCombination(requirements, invoice)[1].status, "covered");
});
test("compound unsupported requirements and broader language cannot become fully covered", () => {
  for (const text of ["Search invoices and pay suppliers", "Approve invoices using SSO", "Search invoices within 2 milliseconds"]) {
    assert.equal(assessCombination([{ id: "r", text, priority: 1 }], invoice)[0].status, "partial");
  }
});
test("negated requirements stay constraints, not inferred positive functionality", () => {
  assert.equal(assessCombination([{ id: "r", text: "Do not approve invoices automatically", priority: 1 }], invoice)[0].status, "constraint");
});
test("finance uses its own engines and bridge; budget words alone are not full coverage", () => {
  const finance = { recipeId: "finance", capabilityIds: ["forecast-projection", "management-reporting"], selectedSources: [{ id: "budget-and-forecast" }, { id: "management-reporting" }], wiring: { edgeIds: ["forecast-to-report"] } };
  const r = ["Create a Q4 forecast", "Generate a monthly management report", "Create an annual budget", "Approve multiple invoices"]
    .map((text, i) => ({ id: `${i}`, text, priority: i + 1 }));
  assert.deepEqual(assessCombination(r, finance).map(r => r.status), ["covered", "covered", "partial", "missing"]);
  assert.equal(assessCombination(r, { ...finance, wiring: { edgeIds: [] } })[0].status, "missing");
});
test("legacy combinations without linked requirements have an empty assessment", () => {
  assert.deepEqual(assessCombination([], invoice), []);
});
