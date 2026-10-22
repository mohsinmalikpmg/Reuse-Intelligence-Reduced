import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { blankModel, intakeModelSchema, type IntakeModel } from "../src/lib/intake-model";
import { interpretIntake } from "../src/lib/intake-interpret";
import { parseBrief } from "../src/lib/brief-parser";

const make = (sources: [IntakeModel["sources"][number]["id"], string][]) => ({
  ...blankModel(),
  sources: sources.map(([id, text]) => ({ id, name: id, text, files: [], changed: true })),
});
async function run() {
  const only = process.argv[2];
  if (only === "solution") {
    const solution = await interpretIntake(make([["prototype", "A tool imports CSV sensor readings, plots each sensor's hourly temperature on a chart, and exports the chart as PNG. No business purpose, user role, or runtime verification is supplied."]]), [], false, true, "intake-smoke");
    assert.ok(solution.capabilities.length);
    assert.equal(solution.profile.problem.basis, "unknown");
    assert.equal(solution.profile.user.basis, "unknown");
    assert.ok(solution.capabilities.every(c => c.status !== "Confirmed"));
    console.log("PASS solution-only", solution.name?.value, solution.capabilities.length);
    return;
  }
  if (only === "mixed") {
    const mixed = await interpretIntake(make([
      ["problem", "Museum curators need to track artwork loan return dates and flag overdue loans. This museum need is unrelated to the garden tool supplied below."],
      ["prototype", "An unrelated garden tool imports soil moisture CSV files and charts moisture per plant. It does not track artwork or loans."],
    ]), [], false, true, "intake-smoke");
    assert.ok(mixed.requirements.some(r => /loan|artwork/i.test(r.text)));
    const garden = mixed.capabilities.filter(c => /moisture|soil|plant/i.test(`${c.title} ${c.description}`));
    assert.ok(garden.length);
    assert.ok(garden.every(c => !c.requirementIds?.length));
    assert.ok((mixed.groups?.length ?? 0) >= 2);
    for (const id of ["problem", "prototype"]) assert.ok(mixed.coverage?.some(c => c.sourceId === id));
    console.log("PASS unrelated mixed domains", mixed.name?.value, mixed.groups?.length, "no unsupported capability mapping");
    return;
  }
  if (only === "name") {
    const { rows } = await pool.query("SELECT result FROM ai_analysis_records WHERE purpose='intake-interpretation' AND result->'sources'->0->>'text' LIKE 'Library staff lose time%' ORDER BY created_at DESC LIMIT 1");
    assert.ok(rows[0], "Run business smoke first.");
    const business = intakeModelSchema.parse(rows[0].result);
    // Stored provider output precedes server reconciliation.
    const { reconcileInterpretation } = await import("../src/lib/intake-reconcile");
    const reviewed = reconcileInterpretation(business, business);
    const renamed = await interpretIntake(reviewed, [], true, true, "intake-smoke");
    const { name: _oldName, nameAnalysis: _oldMeta, ...oldRest } = reviewed;
    const { name: _newName, nameAnalysis: _newMeta, ...newRest } = renamed;
    assert.deepEqual(newRest, oldRest);
    assert.ok(renamed.nameAnalysis?.id);
    console.log("PASS name-only", renamed.name?.value, "review unchanged");
    return;
  }
  if (only === "brief") {
    const brief = await parseBrief("A school librarian manually checks branch spreadsheets for overdue books. We need one branch-by-branch overdue list; do not issue fines or send patron emails automatically.");
    assert.equal(brief.source, "ai");
    assert.ok(brief.analysis.id);
    assert.ok(brief.requirements.some(r => /overdue|branch/i.test(r)));
    console.log("PASS legacy brief", brief.analysis.model, brief.requirements.length);
    return;
  }
  // Exactly five provider requests. Never use production examples or sensitive data.
  const business = await interpretIntake(make([["problem", "Library staff lose time finding overdue books in separate branch spreadsheets. They need one overdue list by branch. No automatic fines or patron emails."]]), [], false, true, "intake-smoke");
  assert.ok(business.requirements.length);
  assert.equal(business.capabilities.length, 0);
  assert.ok(business.analysis?.id);
  intakeModelSchema.parse(business);
  console.log("PASS business-only", business.name?.value, business.requirements.length);

  const solution = await interpretIntake(make([["prototype", "A tool imports CSV sensor readings, plots each sensor's hourly temperature on a chart, and exports the chart as PNG. No business purpose, user role, or runtime verification is supplied."]]), [], false, true, "intake-smoke");
  assert.ok(solution.capabilities.length);
  assert.equal(solution.profile.problem.basis, "unknown");
  assert.equal(solution.profile.user.basis, "unknown");
  assert.ok(solution.capabilities.every(c => c.status !== "Confirmed"));
  console.log("PASS solution-only", solution.name?.value, solution.capabilities.length);

  const mixed = await interpretIntake(make([
    ["problem", "Museum curators need to track artwork loan return dates and flag overdue loans. This museum need is unrelated to the garden tool supplied below."],
    ["prototype", "An unrelated garden tool imports soil moisture CSV files and charts moisture per plant. It does not track artwork or loans."],
  ]), [], false, true, "intake-smoke");
  assert.ok(mixed.requirements.some(r => /loan|artwork/i.test(r.text)));
  assert.ok(mixed.capabilities.some(c => /moisture|soil|plant/i.test(`${c.title} ${c.description}`)));
  assert.ok(mixed.capabilities.filter(c => /moisture|soil|plant/i.test(`${c.title} ${c.description}`)).every(c => !c.requirementIds?.length));
  assert.ok((mixed.groups?.length ?? 0) >= 2);
  for (const id of ["problem", "prototype"]) assert.ok(mixed.coverage?.some(c => c.sourceId === id));
  console.log("PASS unrelated mixed domains", mixed.name?.value, mixed.groups?.length);

  const brief = await parseBrief("A school librarian manually checks branch spreadsheets for overdue books. We need one branch-by-branch overdue list; do not issue fines or send patron emails automatically.");
  assert.equal(brief.source, "ai");
  assert.ok(brief.analysis.id);
  assert.ok(brief.requirements.some(r => /overdue|branch/i.test(r)));
  console.log("PASS legacy brief", brief.analysis.model, brief.requirements.length);

  const before = structuredClone(business);
  const renamed = await interpretIntake(business, [], true, true, "intake-smoke");
  const { name: _oldName, nameAnalysis: _oldMeta, ...oldRest } = before;
  const { name: _newName, nameAnalysis: _newMeta, ...newRest } = renamed;
  assert.deepEqual(newRest, oldRest);
  assert.ok(renamed.nameAnalysis?.id);
  console.log("PASS name-only", renamed.name?.value, "review unchanged");
}
try { await run(); } finally { await pool.end(); }
