import { reuseCheck, scoreCapability, inferWorkflowSteps } from "../src/lib/reuse-check";
import { getSolution, capabilities } from "../src/data/catalog";
import { caseContext } from "../src/lib/configuration";
const base = getSolution("sol-workorder-insight")!;
const needs = [
  "Flag maintenance issues that may create a safety risk",
  "Identify recurring equipment issues from work-order notes",
  "Standardize the review approach across sites",
  "Reduce the hours spent on weekly manual review",
  "Cluster similar issues across sites",
  "Track approved findings to closure with an owner",
  "Answer operator questions about procedures",
  "Send supervisors an SMS when a finding is approved",
];
for (const need of needs) {
  const r = reuseCheck(need, { base });
  console.log("\n==", need, "| steps:", inferWorkflowSteps(need).join(","));
  for (const o of r.options) console.log(`  [${o.kind}] ${o.title} score=${o.score} path=${o.path} addable=${o.addableTo} ${o.exclusions.join(" | ")}`);
  const ctx = caseContext({ baseSolutionId: base.id, candidateSolutionIds: ["sol-site-pattern-finder", "sol-action-tracker"] }, [need]);
  const top = capabilities.map((c) => scoreCapability(need, c, ctx, inferWorkflowSteps(need))).sort((a, b) => b.score - a.score).slice(0, 4);
  console.log("  caps:", top.map((t) => `${t.capability.id}=${t.score}${t.exclusions.length ? "(X)" : ""}`).join("  "));
  if (need.includes("safety")) console.log("  ", JSON.stringify(top[0]!.dimensions), top[0]!.reasons);
}
