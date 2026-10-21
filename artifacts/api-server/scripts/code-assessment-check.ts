import assert from "node:assert/strict";
import { assessCode } from "../src/lib/code-assessment";
import manifest from "../src/data/solution-code-manifest.json";
import type { Brief, LibraryCodePackage } from "@workspace/api-zod";

const { objectPath: _privatePath, ...pkg } = manifest;
function brief(requirements: string[], context = "Maintenance supervisors reviewing equipment work-order notes"): Brief {
  const empty = { value: "", confidence: 0 };
  return {
    id: "fixture", rawText: context,
    fields: { user: empty, job: empty, currentProcess: empty, painPoint: empty, desiredOutcome: empty, constraints: empty, data: empty, requiredControls: empty, successMeasures: empty },
    today: context, better: "", requirements: requirements.map((text, i) => ({ id: `r${i}`, text, source: "added" })),
    source: "ai", confirmed: true, createdAt: new Date(0).toISOString(), clarifyingQuestion: null, clarification: null, valueStatement: "",
  };
}
const input = brief([
  "Summarize maintenance notes",
  "Identify recurring equipment issues",
  "Provide a supervisor review queue",
  "Cluster similar equipment issues across sites",
  "Highlight safety hazards",
  "Predictive machine learning for failures",
]);
const report = assessCode(input, pkg as LibraryCodePackage);
assert.equal(report.bestSolutionId, "sol-workorder-insight");
assert.deepEqual(report.requirements.map(r => r.priority), [1, 2, 3, 4, 5, 6]);
assert.deepEqual(report.requirements.slice(0, 3).map(r => r.status), ["covered", "covered", "covered"]);
assert.equal(report.requirements[3]?.status, "borrow");
assert.equal(report.requirements[4]?.status, "borrow");
assert.equal(report.requirements[5]?.status, "missing");
assert.equal(new Set(report.requirements.slice(3, 5).flatMap(r => r.matches.map(m => m.solutionId))).size, 2);
assert(report.requirements.filter(r => r.status !== "missing").every(r => r.matches.every(m => m.evidence.file && m.evidence.symbol && m.evidence.lines.length === 2)));
assert.equal(assessCode(brief(["Provide original work-order links"]), pkg as LibraryCodePackage).requirements[0]?.status, "partial");
assert.equal(assessCode(brief(["Require human approval"]), pkg as LibraryCodePackage).requirements[0]?.status, "partial");
const unrelated = assessCode(brief(["Summarize invoices"], "Finance teams review invoices"), pkg as LibraryCodePackage);
assert.equal(unrelated.bestSolutionId, null);
assert.equal(unrelated.requirements[0]?.status, "missing");
const absent = assessCode(brief(["Translate maintenance notes into Japanese"]), pkg as LibraryCodePackage);
assert.equal(absent.bestSolutionId, null);
assert.equal(absent.requirements[0]?.status, "missing");
const controls = assessCode(brief(["Do not perform automatic updates.", "Support read-only review across two sites."]), pkg as LibraryCodePackage);
assert.deepEqual(controls.requirements.map(r => r.status), ["constraint", "constraint"]);
process.stdout.write("Code assessment checks passed: base selection, ordered coverage, two-donor reuse, gaps, partial claims, unrelated-domain rejection, source evidence.\n");
