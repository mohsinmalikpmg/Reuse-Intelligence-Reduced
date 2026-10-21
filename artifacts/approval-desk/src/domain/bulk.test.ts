import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED } from "./seed.ts";
import { appendDecision, initialStates, overallTotals, replay } from "./ledger.ts";
import type { DecisionEvent } from "./ledger.ts";
import { applyBulk, previewBulk } from "./bulk.ts";
import { loadLedger, saveLedger, STORAGE_KEY } from "./storage.ts";
import type { KV } from "./storage.ts";

const AT = "2026-10-02T09:00:00.000Z";
const opts = (b = "batch-1") => ({ batchId: b, at: AT, newId: (i: number) => `${b}-${i}` });
function must<T>(r: { ok: true; value: T } | { ok: false; error: string }): T { if (!r.ok) throw new Error(r.error); return r.value; }
function mem(): KV & { writes: number } {
  const data = new Map<string, string>();
  const kv = { writes: 0, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { kv.writes++; data.set(k, v); }, removeItem: (k: string) => void data.delete(k) };
  return kv;
}
const ALL = ["I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8"];

test("mixed preview names eligible and ineligible with specific reasons", () => {
  const p = previewBulk(initialStates(SEED), ALL, "approve", "reviewer", "Checked");
  assert.deepEqual(p.eligible.map((l) => l.invoiceId), ["I1", "I2", "I6"]);
  const why = Object.fromEntries(p.ineligible.map((l) => [l.invoiceId, l.why]));
  assert.match(why.I3, /approved, unpaid/);
  assert.match(why.I4, /Paid is terminal/);
  assert.match(why.I5, /rejected/);
  assert.equal(p.eligibleTotalCents, 8000000);
  assert.equal(p.selectedTotalCents, 15500000);
  const i6 = p.eligible.find((l) => l.invoiceId === "I6")!;
  assert.equal(i6.toStatus, "pending");
  assert.equal(i6.toStage, "controller");
  assert.deepEqual(p.blockers, []);
});

test("bulk approve: one event per eligible invoice, batch id, thresholds, one write", () => {
  const kv = mem();
  const p = previewBulk(initialStates(SEED), ALL, "approve", "reviewer", "Checked");
  const out = must(applyBulk(SEED, [], p, opts()));
  assert.equal(out.applied.length, 3);
  assert.deepEqual(out.applied.map((e) => e.seq), [1, 2, 3]);
  assert.ok(out.applied.every((e) => e.batchId === "batch-1" && e.reason === "Checked"));
  assert.equal(out.skipped.length, 5);
  must(saveLedger(kv, out.ledger));
  assert.equal(kv.writes, 1);
  const loaded = must(loadLedger(kv, SEED));
  assert.equal(loaded.states.get("I1")!.status, "approved");
  assert.equal(loaded.states.get("I6")!.status, "pending");
  assert.equal(loaded.states.get("I6")!.stage, "controller");
  assert.equal(loaded.states.get("I6")!.events[0].batchId, "batch-1");
  const t = overallTotals(SEED, loaded.states);
  assert.equal(t.pending, 6000000);
  assert.equal(t.approvedUnpaid, 6000000);
  assert.equal(t.pending + t.approvedUnpaid + t.paid + t.rejected, 15500000);
  assert.ok(Object.isFrozen(out.ledger));
});

test("controller second stage completes I6 only after reviewer batch", () => {
  const first = must(applyBulk(SEED, [], previewBulk(initialStates(SEED), ["I6"], "approve", "reviewer", "ok"), opts("b1")));
  const s = must(replay(SEED, first.ledger));
  const p = previewBulk(s, ["I6", "I1"], "approve", "controller", "Final");
  assert.deepEqual(p.eligible.map((l) => l.invoiceId), ["I6"]);
  assert.match(p.ineligible[0].why, /reviewer stage/);
  const out = must(applyBulk(SEED, first.ledger, p, opts("b2")));
  assert.equal(out.ledger.at(-1)!.toStatus, "approved");
  assert.equal(out.ledger.at(-1)!.seq, 2);
});

test("bulk reject requires a nonblank reason", () => {
  for (const reason of ["", "   "]) {
    const p = previewBulk(initialStates(SEED), ["I1", "I2"], "reject", "reviewer", reason);
    assert.ok(p.blockers.some((b) => /nonblank reason/.test(b)));
    assert.equal(applyBulk(SEED, [], p, opts()).ok, false);
  }
  const ok = must(applyBulk(SEED, [], previewBulk(initialStates(SEED), ["I2"], "reject", "reviewer", "Duplicate of I1"), opts()));
  assert.equal(ok.applied[0].toStatus, "rejected");
});

test("viewer is denied for every line", () => {
  const p = previewBulk(initialStates(SEED), ["I1", "I6"], "approve", "viewer", "x");
  assert.equal(p.eligible.length, 0);
  assert.ok(p.ineligible.every((l) => /Viewer/.test(l.why)));
  assert.ok(p.blockers.some((b) => /Viewer/.test(b)));
  assert.equal(applyBulk(SEED, [], p, opts()).ok, false);
});

test("duplicate selections are reported and applied once", () => {
  const p = previewBulk(initialStates(SEED), ["I1", "I1", "I2"], "approve", "reviewer", "ok");
  assert.deepEqual(p.duplicateIds, ["I1"]);
  assert.equal(p.lines.length, 2);
  const out = must(applyBulk(SEED, [], p, opts()));
  assert.equal(out.applied.length, 2);
});

test("terminal-only selection has nothing to apply", () => {
  const p = previewBulk(initialStates(SEED), ["I4", "I5", "I8"], "reject", "reviewer", "x");
  assert.equal(p.eligible.length, 0);
  assert.ok(p.blockers.some((b) => /None of the selected/.test(b)));
  assert.equal(applyBulk(SEED, [], p, opts()).ok, false);
  assert.equal(previewBulk(initialStates(SEED), [], "approve", "reviewer", "x").blockers[0], "No invoices selected.");
});

test("stale preview is refused; nothing applied", () => {
  const p = previewBulk(initialStates(SEED), ["I1", "I6"], "approve", "reviewer", "ok");
  // Another tab approves I6 at reviewer stage after the preview was shown.
  const other = must(appendDecision(SEED, [], "x1", { invoiceId: "I6", action: "approve", role: "reviewer", reason: "other tab", at: AT }));
  const r = applyBulk(SEED, other, p, opts());
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /stale.*I6 was pending\/reviewer, now pending\/controller/);
  // A change to an unselected invoice does not invalidate the preview.
  const unrelated = must(appendDecision(SEED, [], "x2", { invoiceId: "I3", action: "pay", role: "controller", reason: "", at: AT }));
  assert.equal(must(applyBulk(SEED, unrelated, p, opts())).ledger.length, 3);
});

test("storage write failure leaves stored ledger untouched", () => {
  const kv = mem();
  const before = must(appendDecision(SEED, [], "a", { invoiceId: "I1", action: "approve", role: "reviewer", reason: "ok", at: AT }));
  must(saveLedger(kv, before));
  const out = must(applyBulk(SEED, before, previewBulk(must(replay(SEED, before)), ["I2", "I6"], "approve", "reviewer", "ok"), opts()));
  const failing: KV = { ...kv, setItem: () => { throw new Error("QuotaExceeded"); } };
  assert.equal(saveLedger(failing, out.ledger).ok, false);
  assert.equal(must(loadLedger(kv, SEED)).events.length, 1);
});

test("tampered batchId fails replay; legacy events without batchId still load", () => {
  const kv = mem();
  const out = must(applyBulk(SEED, [], previewBulk(initialStates(SEED), ["I1"], "approve", "reviewer", "ok"), opts()));
  kv.setItem(STORAGE_KEY, JSON.stringify({ version: 1, events: [{ ...out.ledger[0], batchId: 7 }] }));
  assert.equal(loadLedger(kv, SEED).ok, false);
  const { batchId: _b, ...legacy } = out.ledger[0] as DecisionEvent;
  kv.setItem(STORAGE_KEY, JSON.stringify({ version: 1, events: [legacy] }));
  assert.equal(must(loadLedger(kv, SEED)).states.get("I1")!.status, "approved");
});
