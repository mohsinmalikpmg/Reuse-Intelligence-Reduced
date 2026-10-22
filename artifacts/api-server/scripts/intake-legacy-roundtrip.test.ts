import { test } from "node:test";
import assert from "node:assert/strict";
import { blankModel, confirmationIssues, intakeModelSchema, sourceHash, type IntakeModel } from "../src/lib/intake-model";
import { reconcileInterpretation, trackIntakeEdits } from "../src/lib/intake-reconcile";
import { normalizeModel as normalizeWorkbench, serializeModel as serializeWorkbench } from "../../workbench/src/components/intake/model";
import { normalizeModel as normalizeStandalone, serializeModel as serializeStandalone } from "../../fusebox-intake/src/intake/model";

function fixture(): IntakeModel {
  const m = blankModel();
  m.name = { value: "Invoice exception routing", origin: "generated", provenance: "Invoice routing input." };
  m.sources = [{ id: "problem", name: "Needs", text: "Route invoice exceptions to finance.", files: [], changed: false }];
  m.groups = [{ id: "routing", title: "Routing", boundary: "Assignment only; excludes payment execution." }];
  for (const field of Object.values(m.profile)) Object.assign(field, { value: "Invoice exception routing", basis: "explicit", provenance: "Problem input", reviewed: true, changed: false });
  m.requirements = [
    { id: "r1", text: "Route exceptions to finance", sources: ["problem"], reviewed: true, changed: false, group: "routing", kind: "functional", acceptance: "Finance receives exceptions", provenance: "Problem input", edited: false },
    { id: "r2", text: "Do not execute payments", sources: ["problem"], reviewed: true, changed: false, group: "routing", kind: "constraint", acceptance: "No payment execution", provenance: "User constraint", edited: false },
  ];
  m.capabilities = [{ id: "c1", title: "Exception routing", sourceId: "problem", description: "Routes invoices", workflow: "Select finance", input: "Invoice", output: "Assigned invoice", dependency: "Not specified", status: "Confirmed", changed: false, gap: "", carry: false, requirementIds: ["r1"], group: "routing", provenance: "Described in input", edited: false }];
  m.coverage = [{ id: "cv1", sourceId: "problem", excerpt: m.sources[0].text, disposition: "accounted", requirementIds: ["r1"], capabilityIds: ["c1"], note: "Assignment", reviewed: true }];
  m.overlaps = [];
  m.orderReviewed = true; m.agreed = true;
  m.interpretedHash = sourceHash(m);
  return m;
}

test("both frontend legacy round-trips preserve unchanged approvals and acquire groups on reinterpretation", () => {
  for (const [normalize, serialize] of [[normalizeWorkbench, serializeWorkbench], [normalizeStandalone, serializeStandalone]]) {
    const old = fixture();
    delete old.groups;
    for (const r of old.requirements) { delete r.group; delete r.kind; delete r.acceptance; }
    for (const c of old.capabilities) { delete c.group; delete c.requirementIds; }
    const payload = intakeModelSchema.parse(serialize(normalize(old)));
    payload.name = { value: "My renamed intake", origin: "manual", provenance: "User name" };
    trackIntakeEdits(payload, old);
    assert.equal(payload.requirements.every(r => r.reviewed), true);
    assert.equal(payload.capabilities.every(c => c.status === "Confirmed"), true);
    assert.equal(payload.agreed, true);
    assert.equal(payload.groups, undefined);
    const interpreted = reconcileInterpretation(payload, fixture());
    assert.equal(interpreted.name?.value, "My renamed intake");
    assert.equal(interpreted.requirements.every(r => r.group === "routing"), true);
    assert.equal(interpreted.capabilities.every(c => c.group === "routing"), true);
    assert.equal(confirmationIssues(interpreted).some(x => x.includes("primary group")), false);
    assert.deepEqual(interpreted.requirements.map(r => r.text), old.requirements.map(r => r.text));
  }
});
