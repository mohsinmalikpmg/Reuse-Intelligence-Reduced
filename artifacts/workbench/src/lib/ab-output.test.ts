import test from "node:test";
import assert from "node:assert/strict";
import { addBackState, isEmptyOutput, sectionPresence } from "./ab-output";

test("sections present on one side only are marked symmetrically", () => {
  const p = sectionPresence([{ key: "issues", items: [1] }, { key: "summary", items: [1] }], [{ key: "issues", items: [1] }, { key: "ranking", items: [1] }, { key: "summary", items: [] }]);
  assert.equal(p.get("issues"), "both");
  assert.equal(p.get("summary"), "a-only");
  assert.equal(p.get("ranking"), "b-only");
});
test("empty output detected", () => {
  assert.equal(isEmptyOutput([{ key: "x", items: [] }]), true);
  assert.equal(isEmptyOutput([]), true);
  assert.equal(isEmptyOutput([{ key: "x", items: [1] }]), false);
});
test("add back shows the server reason instead of a dead button", () => {
  assert.deepEqual(addBackState({ blockedReason: "Requires X to be active." }, false), { kind: "blocked", reason: "Requires X to be active." });
  assert.equal(addBackState({ state: "incompatible" }, false).kind, "blocked");
  assert.equal(addBackState({}, true).kind, "busy");
  assert.equal(addBackState({ state: "optional" }, false).kind, "ok");
});
