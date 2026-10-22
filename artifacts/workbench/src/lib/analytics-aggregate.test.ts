import test from "node:test";
import assert from "node:assert/strict";
import { capabilitySharing, composition, registrationDays, stageCounts } from "./analytics-aggregate";

test("empty datasets remain empty and do not fabricate activity", () => {
  assert.deepEqual(registrationDays([]), { days: [], undated: 0, catalog: 0 });
  for (const buckets of [composition([]), capabilitySharing([]), stageCounts([])]) {
    assert.equal(Object.values(buckets).reduce((n, b) => n + b.total, 0), 0);
  }
});

test("registration activity excludes catalog and undated, keeps single date honest", () => {
  const r = registrationDays([
    { id: "a", source: "catalog", registeredAt: null, demo: true },
    { id: "b", source: "prototype", registeredAt: "2025-03-02T10:00:00Z", demo: false },
    { id: "c", source: "consolidation_source", registeredAt: "2025-03-02T18:00:00Z", demo: false },
    { id: "d", source: "prototype", registeredAt: null, demo: false },
  ]);
  assert.deepEqual(r.days, [{ day: "2025-03-02", sources: 1, prototypes: 1 }]);
  assert.equal(r.undated, 1);
  assert.equal(r.catalog, 1);
});

test("composition reconciles to records", () => {
  const c = composition([
    { id: "a", source: "catalog", registeredAt: null, demo: true },
    { id: "b", source: "prototype", registeredAt: null, demo: false },
  ]);
  assert.equal(c.catalog.total + c.prototype.total + c.consolidation_source.total, 2);
  assert.equal(c.catalog.demo, 1);
});

test("capability sharing buckets: >1 shared, 1 single, 0 not assessed, deduped", () => {
  const s = capabilitySharing([
    { id: "x", usedBy: 3, demo: false }, { id: "x", usedBy: 3, demo: false },
    { id: "y", usedBy: 1, demo: true }, { id: "z", usedBy: 0, demo: false },
  ]);
  assert.deepEqual([s.shared.total, s.single.total, s.unassessed.total], [1, 1, 1]);
  assert.equal(s.single.demo, 1);
});

test("stage counts are mutually exclusive", () => {
  const s = stageCounts([
    { caseId: "1", stage: "published", demo: false }, { caseId: "2", stage: "approved", demo: false },
    { caseId: "3", stage: "saved", demo: false }, { caseId: "3", stage: "saved", demo: false },
  ]);
  const sum = Object.values(s).reduce((n, v) => n + v.total, 0);
  assert.equal(sum, 3);
  assert.equal(s.approved.total, 1);
  assert.equal(s.published.total, 1);
});

test("new window uses generatedAt and excludes future", async () => {
  const { isNewRegistration } = await import("./analytics-aggregate");
  const g = "2025-03-10T00:00:00Z";
  assert.equal(isNewRegistration("2025-03-05T00:00:00Z", g, 7), true);
  assert.equal(isNewRegistration("2025-03-11T00:00:00Z", g, 7), false);
  assert.equal(isNewRegistration("2025-02-01T00:00:00Z", g, 7), false);
  assert.equal(isNewRegistration(null, g, 7), false);
});
