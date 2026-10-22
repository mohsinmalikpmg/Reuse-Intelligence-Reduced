import { test } from "node:test";
import assert from "node:assert/strict";
import { blankModel, confirmationIssues, intakeModelSchema, sourceHash, type IntakeModel } from "./intake-model";
import { reconcileInterpretation, trackIntakeEdits, withLegacyName } from "./intake-reconcile";
import { normalizeInterpretation } from "./intake-interpret";

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

test("legacy optional metadata remains backward compatible; provenance survives parsing", () => {
  assert.deepEqual(intakeModelSchema.parse(blankModel()), blankModel());
  const m = fixture();
  assert.deepEqual(intakeModelSchema.parse(m), m);
});
test("duplicate ids and dangling group, requirement and question references are rejected", () => {
  for (const mutate of [
    (m: IntakeModel) => m.requirements.push(m.requirements[0]),
    (m: IntakeModel) => { m.capabilities[0].id = "r1"; },
    (m: IntakeModel) => { m.requirements[0].group = "missing"; },
    (m: IntakeModel) => { m.capabilities[0].requirementIds = ["missing"]; },
    (m: IntakeModel) => { m.coverage![0].capabilityIds = ["missing"]; },
    (m: IntakeModel) => { m.questions = [{ id: "q", text: "?", answer: "", acknowledged: false, itemIds: ["missing"] }]; },
    (m: IntakeModel) => { m.removedItemIds = ["r1"]; },
    (m: IntakeModel) => { m.removedItemIds = ["gone", "gone"]; },
  ]) {
    const m = fixture(); mutate(m);
    assert.equal(intakeModelSchema.safeParse(m).success, false);
  }
});
test("AI output must contain a meaningful name and evidence-rich structure", () => {
  const m = fixture();
  assert.doesNotThrow(() => normalizeInterpretation(m, m));
  const noName = structuredClone(m); delete noName.name;
  assert.throws(() => normalizeInterpretation(noName, m), /meaningful/);
  const generic = structuredClone(m); generic.name!.value = "New intake";
  assert.throws(() => normalizeInterpretation(generic, m), /meaningful/);
  const noEvidence = structuredClone(m); delete noEvidence.requirements[0].provenance;
  assert.throws(() => normalizeInterpretation(noEvidence, m), /evidence/);
  const noCoverage = structuredClone(m); noCoverage.coverage = [];
  assert.throws(() => normalizeInterpretation(noCoverage, m), /coverage/);
});
test("manual and legacy names survive; explicit regenerate opts out", () => {
  const old = withLegacyName(blankModel(), "My finance intake");
  const next = fixture();
  old.sources = next.sources;
  old.interpretedHash = sourceHash(old);
  assert.equal(reconcileInterpretation(old, next).name?.value, "My finance intake");
  assert.equal(reconcileInterpretation(old, next, true).name?.value, next.name!.value);
  assert.equal(reconcileInterpretation(old, next, true).name?.origin, "generated");
  assert.equal(withLegacyName(next, "stale title").name?.value, next.name!.value);
});
test("server detects unconfirmed edits and preserves them when sources change", () => {
  const old = fixture(), edited = structuredClone(old);
  edited.requirements[0].text = "Route only disputed invoices";
  edited.capabilities[0].description = "Manual correction";
  edited.profile.problem.value = "Corrected problem";
  trackIntakeEdits(edited, old);
  assert.equal(edited.requirements[0].edited, true);
  assert.equal(edited.requirements[0].reviewed, false);
  assert.equal(edited.coverage![0].reviewed, false);
  edited.sources[0].changed = true;
  const next = reconcileInterpretation(edited, fixture());
  assert.equal(next.requirements[0].text, edited.requirements[0].text);
  assert.equal(next.capabilities[0].description, "Manual correction");
  assert.equal(next.profile.problem.value, "Corrected problem");
});
test("unaffected reviews and priority order survive; AI cannot approve new items", () => {
  const old = fixture(), generated = fixture();
  generated.requirements.push({ ...generated.requirements[0], id: "r3", text: "New need" });
  const next = reconcileInterpretation(old, generated);
  assert.equal(next.requirements[0].reviewed, true);
  assert.equal(next.capabilities[0].status, "Confirmed");
  assert.equal(next.requirements[2].reviewed, false);
  assert.equal(next.orderReviewed, false);
  assert.equal(next.agreed, false);
  assert.equal(next.confirmed, false);
});
test("concept identity is remapped safely through capabilities and coverage", () => {
  const old = fixture(), generated = fixture();
  generated.requirements[0].id = "new-r1";
  generated.capabilities[0].requirementIds = ["new-r1"];
  generated.coverage![0].requirementIds = ["new-r1"];
  const next = reconcileInterpretation(old, generated);
  assert.equal(next.requirements[0].id, "r1");
  assert.deepEqual(next.capabilities[0].requirementIds, ["r1"]);
  assert.deepEqual(next.coverage![0].requirementIds, ["r1"]);
});
test("deletions become tombstones and generated mappings cannot resurrect items", () => {
  const old = fixture(), edited = structuredClone(old);
  edited.requirements = []; edited.capabilities = []; edited.coverage = [];
  trackIntakeEdits(edited, old);
  assert.deepEqual(new Set(edited.removedItemIds), new Set(["r1", "r2", "c1"]));
  const next = reconcileInterpretation(edited, fixture());
  assert.equal(next.requirements.length, 0);
  assert.equal(next.capabilities.length, 0);
  assert.equal(next.coverage![0].disposition, "unresolved");
  assert.equal(next.coverage![0].reviewed, false);
});
test("answer changes invalidate only linked items and dependent capabilities", () => {
  const old = fixture();
  old.questions = [{ id: "q1", text: "Who receives exceptions?", answer: "", acknowledged: false, itemIds: ["r1"] }];
  const edited = structuredClone(old); edited.questions[0].answer = "Accounts payable";
  trackIntakeEdits(edited, old);
  assert.equal(edited.requirements[0].reviewed, false);
  assert.equal(edited.requirements[1].reviewed, true);
  assert.equal(edited.capabilities[0].status, "Needs clarification");
  const generated = fixture(); generated.requirements[0].text = "Route to accounts payable";
  generated.questions = old.questions;
  const next = reconcileInterpretation(edited, generated);
  assert.equal(next.requirements[0].text, "Route to accounts payable");
  assert.equal(next.questions[0].answer, "Accounts payable");
});
test("unresolved coverage needs acknowledgment, and overlaps block until resolved", () => {
  const m = fixture();
  assert.deepEqual(confirmationIssues(m), []);
  m.coverage![0].disposition = "unresolved"; m.coverage![0].reviewed = false;
  m.overlaps = [{ id: "o", itemIds: ["r1", "r2"], note: "Check boundaries", resolved: false }];
  assert.equal(confirmationIssues(m).length, 2);
  m.coverage![0].reviewed = true; m.overlaps[0].resolved = true;
  assert.deepEqual(confirmationIssues(m), []);
});
test("unresolved prior overlaps cannot silently disappear from AI output", () => {
  const m = fixture();
  m.overlaps = [{ id: "o", itemIds: ["r1", "r2"], note: "Check boundaries", resolved: false }];
  assert.equal(reconcileInterpretation(m, fixture()).overlaps![0].resolved, false);
});
test("name-only regeneration preserves all review state and confirmed content", () => {
  const old = fixture();
  old.confirmed = true;
  old.name!.origin = "manual";
  const generated = fixture();
  generated.name!.value = "Finance exception assignment";
  generated.requirements = [];
  generated.coverage = [];
  const next = reconcileInterpretation(old, generated, true);
  assert.deepEqual(next, { ...old, name: generated.name });
  assert.equal(next.confirmed, true);
  assert.equal(next.agreed, true);
});
test("name regeneration rejects stale sources even when changes were acknowledged", () => {
  const old = fixture();
  old.confirmed = true;
  old.sources[0].text += " Include dispute routing.";
  old.sources[0].changed = false;
  assert.throws(() => reconcileInterpretation(old, fixture(), true), /latest inputs/);
  assert.equal(old.confirmed, true);
});
test("group edits invalidate only members and linked coverage/overlaps; saved boundaries survive AI", () => {
  const old = fixture();
  old.groups!.push({ id: "payment", title: "Payment controls", boundary: "Payment execution only" });
  old.requirements[1].group = "payment";
  old.capabilities[0].group = "payment";
  old.coverage!.push({ ...old.coverage![0], id: "cv2", excerpt: "Payment restriction", requirementIds: ["r2"], capabilityIds: [], reviewed: true });
  old.overlaps = [{ id: "o1", itemIds: ["r1", "r2"], note: "Review boundary", resolved: true }];
  const edited = structuredClone(old);
  edited.groups![0].title = "Exception assignment";
  edited.groups![0].boundary = "Manual assignment, not automated payment";
  trackIntakeEdits(edited, old);
  assert.equal(edited.requirements[0].reviewed, false);
  assert.equal(edited.requirements[1].reviewed, true);
  assert.equal(edited.capabilities[0].status, "Confirmed", "linked capability outside edited group is unaffected");
  assert.equal(edited.coverage![0].reviewed, false);
  assert.equal(edited.coverage![1].reviewed, true);
  assert.equal(edited.overlaps![0].resolved, false);
  const next = reconcileInterpretation(edited, structuredClone(old));
  assert.deepEqual(next.groups![0], edited.groups![0]);
  assert.equal(next.requirements[0].reviewed, false);
  assert.equal(next.requirements[1].reviewed, true);
  assert.equal(next.capabilities[0].status, "Confirmed");
  assert.equal(next.coverage![1].reviewed, true);
});
test("source changes preserve manual content but revoke its reviews including omitted AI items", () => {
  const old = fixture();
  old.requirements[0].edited = true; old.requirements[0].text = "Manually corrected need";
  old.capabilities[0].edited = true; old.capabilities[0].description = "Manually corrected behavior";
  old.sources[0].changed = true;
  for (const omit of [false, true]) {
    const generated = fixture();
    if (omit) { generated.requirements = []; generated.capabilities = []; generated.coverage = []; }
    const next = reconcileInterpretation(old, generated);
    assert.equal(next.requirements[0].text, "Manually corrected need");
    assert.equal(next.requirements[0].reviewed, false);
    assert.equal(next.capabilities[0].description, "Manually corrected behavior");
    assert.equal(next.capabilities[0].status, "Needs clarification");
    assert.equal(next.capabilities[0].carry, false);
  }
});
test("answers invalidate edited content and capability-only coverage without overwriting corrections", () => {
  const old = fixture();
  old.requirements[0].edited = true;
  old.capabilities[0].edited = true;
  old.coverage![0].requirementIds = [];
  old.questions = [{ id: "q1", text: "Who owns exceptions?", answer: "Finance", acknowledged: false, itemIds: ["r1"] }];
  const edited = structuredClone(old);
  edited.questions[0].answer = "Accounts payable";
  trackIntakeEdits(edited, old);
  assert.equal(edited.coverage![0].reviewed, false);
  const generated = fixture();
  generated.requirements[0].text = "An AI rewrite";
  generated.capabilities[0].description = "An AI rewrite";
  const next = reconcileInterpretation(edited, generated);
  assert.equal(next.requirements[0].text, old.requirements[0].text);
  assert.equal(next.requirements[0].reviewed, false);
  assert.equal(next.requirements[1].reviewed, true);
  assert.equal(next.capabilities[0].description, old.capabilities[0].description);
  assert.equal(next.capabilities[0].status, "Needs clarification");
  assert.equal(next.questions[0].answer, "Accounts payable");
});
test("structured confirmation requires primary groups and boundaries while legacy remains confirmable", () => {
  const m = fixture();
  assert.deepEqual(confirmationIssues(m), []);
  delete m.requirements[0].group;
  assert.ok(confirmationIssues(m).some(x => x.includes("primary group")));
  m.requirements[0].group = "routing";
  m.groups![0].boundary = "  ";
  assert.ok(confirmationIssues(m).some(x => x.includes("boundary")));
  delete m.groups;
  for (const item of [...m.requirements, ...m.capabilities]) delete item.group;
  assert.deepEqual(confirmationIssues(m), []);
});
