import test from "node:test";
import assert from "node:assert/strict";
import { reviewDecisions, type MappingRow } from "./package-review";

test("saving a note cannot approve a proposed mapping", () => {
  const row: MappingRow = { capabilityId: "cap-summarize", file: "summary.ts", decision: "proposed", note: "" };
  assert.throws(() => reviewDecisions([{ ...row, note: "Reviewed package description" }]), /Explicitly approve or reject/);
  assert.equal(row.decision, "proposed");
});

test("every mapping needs a decision and explicit decisions are preserved", () => {
  const row: MappingRow = { capabilityId: "cap-summarize", file: "summary.ts", decision: "approved", note: "Inspected source" };
  assert.throws(() => reviewDecisions([row, { ...row, file: "other.ts", decision: "proposed" }]));
  assert.deepEqual(reviewDecisions([row, { ...row, file: "other.ts", decision: "rejected" }]).map(r => r.decision), ["approved", "rejected"]);
});
