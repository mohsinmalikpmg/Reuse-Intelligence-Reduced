import { sampleInputs } from "../src/engine/workorders";
import { executeWorkflow } from "../src/engine/run";
import { getCapability } from "../src/data/catalog";
const caps = ["cap-wo-ingest", "cap-summarize", "cap-recurring", "cap-safety-signals", "cap-review-queue", "cap-approval", "cap-routing"].map((id) => getCapability(id)!);
let fail = 0;
for (const si of sampleInputs) {
  const active = si.solutionIds.includes("sol-incident-commander") ? [getCapability("cap-safety-signals")!] : caps;
  const r = executeWorkflow(active, {}, si.text);
  const sec = r.output.sections.find((s) => s.key === "safety");
  const lines = (sec?.items ?? []).filter((i) => i.kind === "safety");
  console.log(si.id, "->", lines.map((l) => l.key));
  for (const e of si.expectedSafetySignals ?? []) {
    if (!lines.some((l) => l.refs.includes(e.ref) && l.key.includes(e.signal))) { console.log("  MISSING", e); fail++; }
  }
  const review = (r.output.sections.find((s) => s.key === "review")?.items ?? []).filter((i) => i.kind === "review");
  if (si.id === "wo-related" || si.id === "wo-two-months") console.log(review.map((i) => i.text));
  // Every flagged work order must appear in a priority review item.
  if (active.some((c) => c.id === "cap-review-queue")) for (const l of lines) for (const ref of l.refs) if (!review.some((i) => i.stepId === "cap-safety-signals" && i.refs.includes(ref))) { console.log("  NOT QUEUED", ref); fail++; }
}
console.log(fail ? `FAIL ${fail}` : "OK");
