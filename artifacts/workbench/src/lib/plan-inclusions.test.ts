import test from "node:test";
import assert from "node:assert/strict";
import type { Composition, Configuration } from "@workspace/api-client-react";
import { planInclusions } from "./plan-inclusions";
import { blocksFromConfig } from "../components/flow";

const plan = {
  executable: true, plan: { flow: [
    { sourceSolutionId: "donor", capabilityId: "feature", reason: "Accepted" },
    { sourceSolutionId: "preview", capabilityId: "planned", reason: "Proposed" },
  ] },
  sourceEvidence: [
    { solutionId: "donor", name: "Donor app", capabilities: [{ id: "feature", name: "Useful feature" }] },
    { solutionId: "preview", name: "Preview app", capabilities: [{ id: "planned", name: "Planned feature" }] },
  ],
  acceptedSuggestions: [{ sourceSolutionId: "donor", capabilityIds: ["feature"] }],
  supportedExecution: { capabilityIds: ["feature"], omittedCapabilities: [{ capabilityId: "planned", reason: "Needs adapter" }] },
} as unknown as Composition;

test("active donors stay visible with their accepted source attribution", () => {
  const items = planInclusions(plan, [{ id: "feature", sourceId: "donor", active: true, executable: true }]);
  assert.equal(items[0].status, "active");
  assert.equal(items[0].accepted, true);
  assert.equal(items[0].name, "Useful feature");
  assert.equal(items[0].sourceName, "Donor app");
  assert.equal(items[0].represented, true);
  assert.equal(items[1].status, "proposed");
  assert.equal(items[1].represented, false);
  assert.equal(items[1].reason, "Needs adapter");
});
test("current settings override an older execution projection", () => {
  const item = planInclusions(plan, [{ id: "feature", sourceId: "donor", active: false, executable: true }])[0];
  assert.equal(item.status, "off");
  assert.equal(item.represented, true);
});
test("nonexecuting controls and missing adapters never become runnable nodes", () => {
  const item = planInclusions(plan, [{ id: "feature", sourceId: "donor", active: true, executable: false }])[0];
  assert.equal(item.status, "proposed");
  assert.equal(item.represented, false);
});
test("proposal-only plans do not claim runnable features", () => {
  assert.equal(planInclusions({ ...plan, executable: false }, [])[0].status, "proposed");
});
test("only saved plan flow is shown, and source/capability pairs are not duplicated", () => {
  const copy = { ...plan, plan: { ...plan.plan, flow: [plan.plan.flow[0], plan.plan.flow[0]] } };
  assert.equal(planInclusions(copy, []).length, 1);
  assert.equal(planInclusions({ ...plan, plan: { ...plan.plan, flow: [] } }, []).length, 0);
});
test("switched-off included donor steps remain in the actual workflow", () => {
  const cfg = { steps: [{ components: [{
    capability: { id: "feature", sourceSolutionId: "donor", name: "Useful feature" },
    controlType: "optional", executable: true, active: false,
  }] }] } as unknown as Configuration;
  assert.equal(blocksFromConfig(cfg, "base").length, 0);
  assert.equal(blocksFromConfig(cfg, "base", new Set(["feature"]))[0].active, false);
});

test("a proposed-only donor sharing an active base capability ID stays non-running and unmapped", () => {
  const c = { ...plan, acceptedSuggestions: [{
    suggestionId: "shared-audit", sourceSolutionId: "donor", capabilityIds: ["feature"], executable: false, acceptedRevision: 2,
  }] };
  for (const sourceId of ["base", "donor"]) {
    const item = planInclusions(c, [{ id: "feature", sourceId, active: true, executable: true }])[0];
    assert.equal(item.status, "proposed");
    assert.equal(item.represented, false);
    assert.equal(item.sourceId, "donor");
    assert.match(item.reason, /proposed contribution only/);
  }
});

test("a shared capability ID cannot attribute a base step to another source", () => {
  const item = planInclusions(plan, [{ id: "feature", sourceId: "base", active: true, executable: true }])[0];
  assert.equal(item.status, "proposed");
  assert.equal(item.represented, false);
});
