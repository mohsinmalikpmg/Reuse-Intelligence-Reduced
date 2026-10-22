import test from "node:test";
import assert from "node:assert/strict";
import { groupIssues, normalizeModel, readiness, serializeModel } from "./model.ts";

const legacyRaw = { requirements: [{ id: "r1", text: "Track orders", reviewed: true }], capabilities: [], orderReviewed: true };
test("saved provider provenance survives normalization, manual corrections and save payloads", () => {
  const analysis = { id: "analysis-1", model: "gpt-5.4-mini", promptVersion: "intake-mece-v4", inputFingerprint: "abc123", createdAt: "2026-01-01T00:00:00.000Z", cached: false };
  const model = normalizeModel({ ...legacyRaw, analysis, nameAnalysis: analysis });
  model.requirements[0].text = "Only track controller-approved orders";
  model.requirements[0].edited = true;
  const saved = normalizeModel(serializeModel(model));
  assert.deepEqual(saved.analysis, analysis);
  assert.deepEqual(saved.nameAnalysis, analysis);
  assert.equal(saved.requirements[0].edited, true);
  assert.equal(saved.requirements[0].text, "Only track controller-approved orders");
});

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

test("single review acceptance covers visible items only and never resolves exceptions", async () => {
  const { acceptReview, reviewExceptions, exceptionCount } = await import("./model.ts");
  const profile = Object.fromEntries(["problem", "user", "scope", "outcome"].map(k => [k, { value: `${k} text` }]));
  const base = normalizeModel({ profile, groups: [], requirements: [{ id: "r1", text: "Group work orders", sources: ["problem"] }], capabilities: [{ id: "c1", title: "CSV grouping", gap: "No live feed", sourceId: "prototype" }], questions: [{ id: "q1", text: "Which plants?" }], coverage: [{ id: "v1", excerpt: "x" }], overlaps: [{ id: "o1", itemIds: ["r1"] }] });
  base.legacyGroups = true;
  const x = reviewExceptions(base);
  assert.equal(x.openGaps.length, 1); assert.equal(x.openQuestions.length, 1); assert.equal(x.coverage, 1); assert.equal(x.overlaps, 1);
  assert.equal(acceptReview(base), null);
  const handled = { ...base, capabilities: base.capabilities.map(c => ({ ...c, carry: true })), questions: base.questions.map(q => ({ ...q, acknowledged: true })), coverage: base.coverage.map(c => ({ ...c, reviewed: true })), overlaps: base.overlaps.map(o => ({ ...o, resolved: true })) };
  assert.equal(exceptionCount(reviewExceptions(handled)), 0);
  const accepted = acceptReview(handled)!;
  assert.equal(readiness(accepted).ready, true);
  assert.equal(accepted.agreed, true);
  assert.equal(accepted.questions[0].answer, "");
  assert.equal(accepted.capabilities[0].status, "Confirmed");
});

test("acceptance refuses missing summary fields and changed sources", async () => {
  const { acceptReview } = await import("./model.ts");
  const m = normalizeModel({ requirements: [{ id: "r1", text: "x" }], groups: [] });
  assert.equal(acceptReview(m), null);
});

const freshAi = () => {
  const profile = Object.fromEntries(["problem", "user", "scope", "outcome"].map(k => [k, { value: `${k} text`, changed: true }]));
  return normalizeModel({ profile, groups: [{ id: "g1", title: "Review", boundary: "Weekly review" }],
    requirements: [{ id: "r1", text: "Group work orders", sources: ["problem"], group: "g1" }, { id: "r2", text: "Link back to orders", sources: ["problem"], group: "g1" }],
    capabilities: [], questions: [], overlaps: [],
    coverage: [{ id: "v1", sourceId: "problem", excerpt: "grouped by equipment", disposition: "accounted", requirementIds: ["r1"] }, { id: "v2", sourceId: "problem", excerpt: "links back", disposition: "accounted", requirementIds: ["r2"] }] });
};

test("a normal fresh AI record reaches readiness through the single acceptance alone", async () => {
  const { acceptReview, reviewExceptions, exceptionCount } = await import("./model.ts");
  const m = freshAi();
  assert.equal(readiness(m).ready, false);
  assert.equal(exceptionCount(reviewExceptions(m)), 0);
  const a = acceptReview(m)!;
  assert.equal(readiness(a).ready, true);
  assert.ok(a.coverage.every(c => c.reviewed && c.disposition === "accounted"));
});

test("unresolved, out-of-scope and badly linked coverage are never silently accepted", async () => {
  const { acceptReview, reviewExceptions } = await import("./model.ts");
  const m = freshAi();
  m.coverage.push({ id: "v3", sourceId: "problem", excerpt: "maybe SAP later", disposition: "unresolved", requirementIds: [], capabilityIds: [], note: "", reviewed: false });
  m.coverage.push({ id: "v4", sourceId: "problem", excerpt: "payroll", disposition: "out-of-scope", requirementIds: [], capabilityIds: [], note: "", reviewed: false });
  m.coverage.push({ id: "v5", sourceId: "problem", excerpt: "ghost", disposition: "accounted", requirementIds: ["gone"], capabilityIds: [], note: "", reviewed: false });
  assert.deepEqual(reviewExceptions(m).openCoverage.map(c => c.id), ["v3", "v4", "v5"]);
  assert.equal(acceptReview(m), null);
  // Explicit acknowledgement keeps the disposition: acknowledged, not resolved.
  const acked = { ...m, coverage: m.coverage.map(c => c.id === "v5" ? c : (c.id === "v3" || c.id === "v4") ? { ...c, reviewed: true } : c) };
  assert.equal(acceptReview(acked), null);
  const fixed = { ...acked, coverage: acked.coverage.filter(c => c.id !== "v5") };
  const a = acceptReview(fixed)!;
  assert.equal(readiness(a).ready, true);
  assert.equal(a.coverage.find(c => c.id === "v3")!.disposition, "unresolved");
});
