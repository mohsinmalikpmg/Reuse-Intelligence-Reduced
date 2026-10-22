import test from "node:test";
import assert from "node:assert/strict";
import { localDiff, sideMarks, stepDiffSummary, stepSnapshot, summarize, type SnapSection } from "./step-output";

const item = (key: string, rank?: number, text?: string) => ({ id: key, key, kind: "pattern", text: text ?? (rank ? `#${rank} ${key}` : key), detail: null, stepId: "s", refs: [], ranking: rank ? { position: rank } : undefined });
const snap = (items: ReturnType<typeof item>[]) => stepSnapshot({ stepId: "s", status: "ran", outputSections: [{ key: "p", title: "Patterns", stepId: "s", items }] as SnapSection[], outputSnapshotStatus: "available" }, true);

test("snapshot states never fall back to final output", () => {
  assert.equal(stepSnapshot(null, true).kind, "not-run");
  assert.deepEqual(stepSnapshot({ stepId: "s", status: "ran" }, false), { kind: "not-run", why: "off" });
  assert.deepEqual(stepSnapshot({ stepId: "s", status: "skipped", outputSections: [], outputSnapshotStatus: "available" }, true), { kind: "not-run", why: "skipped" });
  assert.equal(stepSnapshot({ stepId: "s", status: "ran" }, true).kind, "unavailable");
});

test("local diff compares snapshots, not final output", () => {
  assert.deepEqual(localDiff(snap([item("x")]), snap([item("x")])), []);
  assert.equal(stepDiffSummary(snap([item("x")]), snap([item("x")])), "Same output in A and B");
  const d = localDiff(snap([item("x")]), snap([item("x", 1)]))!;
  assert.equal(d.length, 1); assert.equal(d[0].changeType, "ranking");
  assert.equal(stepDiffSummary(snap([item("x")]), snap([item("x", 1)])), "Same findings; B adds ranking");
  assert.equal(stepDiffSummary(snap([item("x", 1)]), snap([item("x")])), "Same findings; B removes ranking");
});

test("text resembling a rank without metadata is content", () => {
  const d = localDiff(snap([item("x")]), snap([item("x", undefined, "#1 x")]))!;
  assert.equal(d[0].changeType, "content");
});

test("unavailable side gives no summary; added and removed counted", () => {
  assert.equal(stepDiffSummary(snap([item("x")]), { kind: "unavailable" }), null);
  assert.equal(stepDiffSummary(snap([item("x")]), snap([item("y")])), "1 new · 1 gone");
  assert.equal(summarize([{ change: "changed", changeType: "ranking" }], false, true), "Same findings; B adds ranking");
});

test("side marks", () => {
  const e = [{ change: "added", sectionKey: "p", itemKey: "y" }, { change: "removed", sectionKey: "p", itemKey: "z" }];
  assert.deepEqual([...sideMarks(e, "A").keys()], ["p::z"]);
  assert.deepEqual([...sideMarks(e, "B").keys()], ["p::y"]);
});

test("step absent in A: final ranking-only entries explain impact, not new findings", () => {
  const off = stepSnapshot({ stepId: "s", status: "ran" }, false);
  assert.equal(stepDiffSummary(off, snap([item("x", 1)]), [{ change: "changed", changeType: "ranking" }]), "Runs only in B · Same findings; B adds ranking");
  assert.equal(stepDiffSummary(off, snap([item("x", 1)])), "Runs only in B");
});
