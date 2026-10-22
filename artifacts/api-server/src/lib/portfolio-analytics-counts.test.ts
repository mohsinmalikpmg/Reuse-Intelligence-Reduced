import { test } from "node:test";
import { strict as assert } from "node:assert";
import { capabilityUsage, isRecentRegistration } from "./portfolio-analytics-counts";

test("capability sharing counts distinct app IDs, not repeated declarations", () => {
  const counts = capabilityUsage([
    { id: "a", capabilityIds: ["shared", "shared", "single"] },
    { id: "a", capabilityIds: ["shared"] },
    { id: "b", capabilityIds: ["shared"] },
  ]);
  assert.equal(counts.get("shared"), 2);
  assert.equal(counts.get("single"), 1);
  assert.equal(counts.get("unknown") ?? 0, 0);
  assert.equal(capabilityUsage([]).size, 0);
});

test("new registrations require valid recorded dates within the closed window", () => {
  const now = Date.parse("2026-10-22T00:00:00Z");
  assert.equal(isRecentRegistration("2026-10-22T00:00:00Z", now, 30), true);
  assert.equal(isRecentRegistration("2026-09-22T00:00:00Z", now, 30), true);
  for (const date of [null, "", "invalid", "2026-09-21T23:59:59Z", "2026-10-23T00:00:00Z"]) {
    assert.equal(isRecentRegistration(date, now, 30), false);
  }
});
