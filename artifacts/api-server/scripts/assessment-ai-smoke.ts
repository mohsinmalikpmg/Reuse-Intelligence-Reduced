import assert from "node:assert/strict";
import { db, pool, reuseEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Brief, LibraryCodePackage, PrototypeIntake } from "@workspace/api-zod";
import manifest from "../src/data/solution-code-manifest.json";
import { getSolution } from "../src/data/catalog";
import { assessCode } from "../src/lib/code-assessment";
import { assessCombination } from "../src/lib/combination-assessment";
import { matchBrief } from "../src/lib/matching";
import { analyzePrototype } from "../src/lib/prototype-intake";
import { coveredByVersionA, performReuseCheck } from "../src/lib/reuse-service";
import { sampleInputsFor } from "../src/engine/workorders";
import { adHocRun } from "../src/lib/workbench";
import { analyze } from "../src/lib/ai-analysis";
import { z } from "zod";

// Print validation failures (not provider payloads) for this explicit smoke script.
const diagnosedAnalyze: typeof analyze = async opts => analyze({
  ...opts, schema: z.unknown().transform(value => {
    const parsed = opts.schema.safeParse(value);
    if (!parsed.success) { console.error(opts.purpose, parsed.error.issues); throw parsed.error; }
    return parsed.data;
  }),
});

const empty = { value: "", confidence: 0 };
const brief: Brief = {
  id: "assessment-live-smoke-v1", rawText: "Maintenance supervisors need summaries of equipment work-order notes. No automatic updates.",
  today: "Review maintenance notes manually", better: "Produce summaries with work-order IDs", valueStatement: "", source: "ai", confirmed: true,
  fields: { user: { value: "Maintenance supervisors", confidence: 1 }, job: empty, currentProcess: empty, painPoint: empty, desiredOutcome: empty, constraints: empty, data: empty, requiredControls: empty, successMeasures: empty },
  requirements: ["Summarize maintenance notes with work-order identifiers", "Do not perform automatic updates"].map((text, i) => ({ id: `r${i}`, text, source: "added" })),
  createdAt: new Date(0).toISOString(), clarifyingQuestion: null, clarification: null,
};
const base = getSolution("sol-workorder-insight")!;
const sample = [...sampleInputsFor(base.id)].sort((a, b) => b.noteCount - a.noteCount)[0]!;
const run = adHocRun(base, sample.text);
const output = run.output.sections.map(s => `${s.title}:\n${s.items.map(i => `- ${i.text}`).join("\n")}`).join("\n\n");
const intake: PrototypeIntake = { name: "Submitted maintenance summarizer", platformKind: "other", platformName: "Builder's prototype", users: "Maintenance supervisors",
  description: "Produces summaries from exported maintenance notes. Submitted output is an unverified claim.", examples: [{ input: sample.text, output }] };
const eventIds: string[] = [];
const force = process.env.FORCE_ANALYSIS_SMOKE === "1";
try {
  const checks = await Promise.allSettled([
    (async () => {
      const report = await assessCode(brief, manifest as LibraryCodePackage, { force, analyzer: diagnosedAnalyze });
      assert.equal(report.requirements[1].status, "constraint");
      assert(report.requirements[0].matches.length > 0);
      assert(report.limitations.some(s => s.includes("gpt-5.4-mini")));
      const cached = await assessCode({ ...brief, valueStatement: "A rendered label must not invalidate evidence." }, manifest as LibraryCodePackage);
      assert.deepEqual(cached.requirements, report.requirements);
      assert.deepEqual(cached.limitations, report.limitations);
      console.info("PASS real code assessment + exact-evidence persisted cache + negative constraint");
    })(),
    (async () => {
      const report = await analyzePrototype(intake, { force, analyzer: diagnosedAnalyze });
      assert(report.components.length);
      assert(report.components.every(c => c.matchScore === null));
      assert(report.basis.includes("gpt-5.4-mini"));
      assert(report.basis.includes("not executed"));
      assert(report.comparison);
      for (const line of report.comparison.lines.filter(l => l.status === "reproduced")) assert.equal(line.text.trim(), line.matchedText?.trim());
      const cached = await analyzePrototype(intake);
      assert.deepEqual({ ...cached, comparison: null }, { ...report, comparison: null });
      assert.deepEqual(cached.comparison?.lines, report.comparison.lines);
      console.info("PASS real prototype semantic decomposition + cache + exact deterministic emitted-line comparison");
    })(),
    (async () => {
      const report = await matchBrief(brief, { force });
      assert(report.matches.length);
      assert(report.matches.some(m => m.whyMatched.some(s => s.includes("gpt-5.4-mini"))));
      const cached = await matchBrief({ ...brief, valueStatement: "Changed presentation only" });
      assert.deepEqual(cached, report);
      console.info("PASS real semantic brief matching + persisted cache");
    })(),
    (async () => {
      const req = [{ id: "invoice-search", text: "Search invoices with typos", priority: 1 }, { id: "erp-pay", text: "Pay suppliers in SAP", priority: 2 }];
      const selection = { recipeId: "invoice", capabilityIds: ["fuzzy-search", "bulk-decisions", "spend-tracing"],
        selectedSources: ["invoice-finder", "approval-desk", "spend-tracker"].map(id => ({ id })), wiring: { edgeIds: ["invoice-to-search", "invoice-to-decisions", "invoice-to-spend"] } };
      const report = await assessCombination(req, selection, { force, analyzer: diagnosedAnalyze });
      assert.notEqual(report[0].status, "missing");
      assert.notEqual(report[1].status, "covered");
      assert(report[0].note.includes("gpt-5.4-mini"));
      assert.deepEqual(await assessCombination(req, selection), report);
      console.info("PASS real invoice combination assessment + cache + unsupported integration rejection");
    })(),
    (async () => {
      const req = [{ id: "forecast", text: "Create a Q4 forecast", priority: 1 }];
      const selection = { recipeId: "finance", capabilityIds: ["forecast-projection", "management-reporting"],
        selectedSources: [{ id: "budget-and-forecast" }, { id: "management-reporting" }], wiring: { edgeIds: ["forecast-to-report"] } };
      const report = await assessCombination(req, selection, { force, analyzer: diagnosedAnalyze });
      assert(report[0].capabilityIds.includes("forecast-projection"));
      assert.deepEqual(await assessCombination(req, selection), report);
      console.info("PASS real finance combination source assessment + cache");
    })(),
    (async () => {
      const report = await performReuseCheck({ need: "Summarize maintenance equipment work-order notes", trigger: "add_requirement", base, force });
      eventIds.push(report.eventId);
      assert(report.options.some(o => o.reasons.some(s => s.includes("gpt-5.4-mini"))));
      assert(!report.best?.exclusions.length);
      const cached = await performReuseCheck({ need: "Summarize maintenance equipment work-order notes", trigger: "add_requirement", base });
      eventIds.push(cached.eventId);
      assert.deepEqual({ ...cached, eventId: null }, { ...report, eventId: null });
      console.info("PASS real reuse candidate interpretation + persisted cache + hard-exclusion guard");
    })(),
    (async () => {
      const report = await coveredByVersionA("Produce work-order summary output", { baseSolutionId: base.id, candidateSolutionIds: [] });
      assert.equal(typeof report.covered, "boolean");
      if (report.covered) assert(report.capabilityId);
      assert.equal(report.score, null);
      const cached = await coveredByVersionA("Produce work-order summary output", { baseSolutionId: base.id, candidateSolutionIds: [] });
      assert.deepEqual(cached, report);
      console.info("PASS real Version A documented-coverage analysis + cache, no invented score");
    })(),
  ]);
  const failures = checks.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length) throw new AggregateError(failures.map(r => r.reason), "Real assessment smoke checks failed");
} finally {
  for (const id of eventIds) await db.delete(reuseEventsTable).where(eq(reuseEventsTable.id, id));
  await pool.end();
}
