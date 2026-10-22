import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Brief, LibraryCodePackage } from "@workspace/api-zod";
import { briefsTable, casesTable, db, pool } from "@workspace/db";
import { capabilityById } from "../src/data/catalog";
import manifest from "../src/data/solution-code-manifest.json";
import { fixtureAssessCode as assessCode } from "./assessment-fixture";
import { createBriefWorkbench, deriveWorkbenchPlan } from "../src/lib/proposal-workbench";

const { objectPath: _privatePath, ...metadata } = manifest;
const pkg = metadata as LibraryCodePackage;
const empty = { value: "", confidence: 0 };
const brief: Brief = {
  id: `test-workbench-${randomUUID()}`, rawText: "Maintenance supervisors reviewing equipment work-order notes",
  fields: { user: empty, job: empty, currentProcess: empty, painPoint: empty, desiredOutcome: empty, constraints: empty, data: empty, requiredControls: empty, successMeasures: empty },
  today: "", better: "", valueStatement: "", source: "ai", confirmed: true,
  clarifyingQuestion: null, clarification: null, createdAt: new Date(0).toISOString(),
  requirements: [
    "Summarize maintenance notes", "Identify recurring equipment issues", "Provide a supervisor review queue",
    "Cluster similar equipment issues across sites and highlight safety hazards", "Rank issues",
    "Send email notifications", "Predictive machine learning for failures", "Do not perform automatic updates.",
  ].map((text, i) => ({ id: `r${i}`, text, source: "added" })),
};
const report = await assessCode(brief, pkg);
const plan = deriveWorkbenchPlan(brief, report);
assert.equal(plan.baseSolutionId, "sol-workorder-insight");
assert.deepEqual(plan.moduleIds, ["cap-clustering", "cap-safety-signals", "cap-similarity"]);
assert.equal(new Set(plan.moduleIds).size, plan.moduleIds.length);
assert.deepEqual(plan.gaps.map(g => g.requirementId), ["r5", "r6"]);
assert.equal(deriveWorkbenchPlan(brief, await assessCode(brief, pkg)).id, plan.id, "identical assessment has an idempotency key");
assert.notEqual(deriveWorkbenchPlan(brief, { ...report, package: { ...pkg, sha256: "new-package" } }).id, plan.id);
assert.throws(() => deriveWorkbenchPlan({ ...brief, confirmed: false }, report), /Confirm/);
assert.throws(() => deriveWorkbenchPlan(brief, { ...report, bestSolutionId: null }), /No valid live/);

// A code-backed proposal can still be unavailable to this base under live Workbench policy.
const safety = capabilityById.get("cap-safety-signals")!;
try {
  capabilityById.delete(safety.id);
  const unavailable = deriveWorkbenchPlan(brief, report);
  assert(!unavailable.moduleIds.includes(safety.id));
  assert(unavailable.moduleIds.includes("cap-clustering"), "an unavailable donor must not hide another match");
  assert(unavailable.gaps.some(g => g.requirementId === "r3" && /no available executable/.test(g.missing)));
} finally {
  capabilityById.set(safety.id, safety);
}

const patternBrief = { ...brief, requirements: ["Cluster similar equipment issues across sites", "Rank issues", "Summarize maintenance notes"].map((text, i) => ({ id: `p${i}`, text, source: "added" as const })) };
const patternPlan = deriveWorkbenchPlan(patternBrief, await assessCode(patternBrief, pkg));
assert.equal(patternPlan.baseSolutionId, "sol-site-pattern-finder");
assert(patternPlan.baseModuleIds.includes("cap-b-summarize"));
assert(!patternPlan.moduleIds.includes("cap-summarize"), "base aliases satisfy dependencies without duplicate summarizers");
console.log("Plan checks passed: all matches, dependency closure, deduplication, partial/missing gaps, unavailable donor gap, constraints, base aliases and stable fingerprints.");

// Exercise actual persistence, concurrent clicks, and user-edit preservation without starting the app.
try {
  await db.insert(briefsTable).values({ ...brief, createdAt: new Date(brief.createdAt) });
  const results = await Promise.all(Array.from({ length: 4 }, () => createBriefWorkbench(brief.id, pkg, assessCode)));
  assert(results.every(c => c.id === plan.id));
  const [persisted] = await db.select().from(casesTable).where(eq(casesTable.briefId, brief.id));
  assert(persisted);
  assert.equal((await db.select().from(casesTable).where(eq(casesTable.briefId, brief.id))).length, 1);
  assert.equal(persisted.requirements.length, brief.requirements.length);
  assert.equal(persisted.capabilityRequests.length, plan.gaps.length);
  assert.equal(persisted.briefId, brief.id);
  await db.update(casesTable).set({ title: "User-edited proposal", moduleStates: { ...persisted.moduleStates, "cap-clustering": false } }).where(eq(casesTable.id, plan.id));
  const repeated = await createBriefWorkbench(brief.id, pkg, assessCode);
  assert.equal(repeated.title, "User-edited proposal");
  assert.equal(repeated.moduleStates["cap-clustering"], false);
  await db.update(briefsTable).set({ confirmed: false }).where(eq(briefsTable.id, brief.id));
  await assert.rejects(() => createBriefWorkbench(brief.id, pkg), /Confirm/);
  await assert.rejects(() => createBriefWorkbench(`missing-${randomUUID()}`, pkg), /not found/);
  console.log("Persistence checks passed: one atomic case with linked requirements/requests, four concurrent clicks return one ID, repeat preserves edits, missing/unconfirmed briefs rejected.");
} finally {
  await db.delete(casesTable).where(eq(casesTable.briefId, brief.id));
  await db.delete(briefsTable).where(eq(briefsTable.id, brief.id));
  await pool.end();
}
