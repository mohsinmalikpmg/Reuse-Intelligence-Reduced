import test from "node:test";
import assert from "node:assert/strict";
import { groupIssues, normalizeModel, readiness, serializeModel } from "./model.ts";

const legacyRaw = { requirements: [{ id: "r1", text: "Track orders", reviewed: true }], capabilities: [], orderReviewed: true };

test("legacy record without groups stays exempt after a browser edit and save", () => {
  const m = normalizeModel(legacyRaw);
  assert.equal(m.legacyGroups, true);
  assert.deepEqual(m.groups, []);
  const edited = { ...m, requirements: m.requirements.map(r => ({ ...r, text: "Track every order" })) };
  assert.deepEqual(groupIssues(edited), []);
  assert.equal(readiness(edited).groupsReady, true);
  const payload = serializeModel(edited);
  assert.equal("groups" in payload, false);
  assert.equal("legacyGroups" in payload, false);
  const reloaded = normalizeModel(payload);
  assert.equal(reloaded.legacyGroups, true);
  assert.deepEqual(groupIssues(reloaded), []);
});

test("adding a group to a legacy record opts into structured rules", () => {
  const m = normalizeModel(legacyRaw);
  const grouped = { ...m, groups: [{ id: "g1", title: "Orders", boundary: "Order lifecycle" }] };
  assert.equal(groupIssues(grouped).length, 1);
  assert.ok(Array.isArray(serializeModel(grouped).groups));
});

test("structured record with groups: [] requires primary groups", () => {
  const m = normalizeModel({ ...legacyRaw, groups: [] });
  assert.equal(m.legacyGroups, undefined);
  assert.equal(groupIssues(m).length, 1);
  assert.equal(readiness(m).groupsReady, false);
  assert.deepEqual(serializeModel(m).groups, []);
});

test("interpretation returning groups clears legacy status", () => {
  const m = normalizeModel({ ...legacyRaw, groups: [{ id: "g1", title: "Orders", boundary: "Order lifecycle" }], requirements: [{ id: "r1", text: "x", group: "g1" }] });
  assert.equal(m.legacyGroups, undefined);
  assert.deepEqual(groupIssues(m), []);
});
