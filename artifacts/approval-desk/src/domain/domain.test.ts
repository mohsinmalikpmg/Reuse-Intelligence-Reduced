import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED, validateSeed, findDuplicates } from "./seed.ts";
import type { Seed } from "./seed.ts";
import { appendDecision, decide, initialStates, overallTotals, totalsByAfe, replay, requiredStages, formatCad } from "./ledger.ts";
import type { DecisionEvent, DecisionInput } from "./ledger.ts";
import { loadLedger, saveLedger, STORAGE_KEY } from "./storage.ts";
import type { KV } from "./storage.ts";

const T = "2026-10-01T10:00:00.000Z";
const T2 = "2026-10-01T11:00:00.000Z";
function mem(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
function must<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
function step(ledger: readonly DecisionEvent[], input: Partial<DecisionInput> & { invoiceId: string }) {
  return appendDecision(SEED, ledger, `e${ledger.length + 1}`, { action: "approve", role: "reviewer", reason: "ok", at: T, ...input });
}

test("seed fixture is valid and baseline totals match SCENARIO", () => {
  assert.deepEqual(validateSeed(SEED), []);
  const t = overallTotals(SEED, initialStates(SEED));
  assert.deepEqual(t, { pending: 8000000, approvedUnpaid: 4000000, paid: 3000000, rejected: 500000, committed: 7000000, budget: 15000000, remaining: 8000000, projectedRemaining: 0 });
  const [a1, a2] = totalsByAfe(SEED, initialStates(SEED));
  assert.deepEqual(a1.totals, { pending: 2000000, approvedUnpaid: 2500000, paid: 2000000, rejected: 500000, committed: 4500000, budget: 10000000, remaining: 5500000, projectedRemaining: 3500000 });
  assert.deepEqual(a2.totals, { pending: 6000000, approvedUnpaid: 1500000, paid: 1000000, rejected: 0, committed: 2500000, budget: 5000000, remaining: 2500000, projectedRemaining: -3500000 });
});

test("missing references fail", () => {
  const bad: Seed = { ...SEED, invoices: [...SEED.invoices, { ...SEED.invoices[0], id: "I9", supplierId: "S9", parId: "PAR-999" }] };
  const errs = validateSeed(bad);
  assert.ok(errs.some((e) => e.includes("supplier S9")));
  assert.ok(errs.some((e) => e.includes("PAR PAR-999")));
  const mismatch: Seed = { ...SEED, invoices: [{ ...SEED.invoices[0], afeId: "AFE-200" }] };
  assert.ok(validateSeed(mismatch).some((e) => e.includes("belongs to AFE-100")));
  const noAfe: Seed = { ...SEED, afes: SEED.afes.slice(1) };
  assert.ok(validateSeed(noAfe).some((e) => e.includes("missing AFE AFE-100")));
  assert.equal(loadLedger(mem(), bad).ok, false);
});

test("duplicates: only I1/I2", () => {
  const d = findDuplicates(SEED.invoices);
  assert.deepEqual([...d.keys()].sort(), ["I1", "I2"]);
});

test("stage threshold boundary: 1000000 single, 1000001 two-stage", () => {
  assert.deepEqual(requiredStages(1000000), ["reviewer"]);
  assert.deepEqual(requiredStages(1000001), ["reviewer", "controller"]);
  const l = must(step([], { invoiceId: "I1" }));
  assert.equal(l[0].toStatus, "approved");
  const custom: Seed = { ...SEED, invoices: SEED.invoices.map((i) => (i.id === "I2" ? { ...i, amountCents: 1000001 } : i)) };
  const s = initialStates(custom);
  const e = must(decide(s, 1, "x", { invoiceId: "I2", action: "approve", role: "reviewer", reason: "ok", at: T }));
  assert.equal(e.toStatus, "pending");
  assert.equal(e.toStage, "controller");
});

test("large invoice: reviewer then controller; first approval keeps pending", () => {
  let l = must(step([], { invoiceId: "I6" }));
  assert.equal(l[0].toStatus, "pending");
  assert.equal(l[0].toStage, "controller");
  assert.equal(step(l, { invoiceId: "I6" }).ok, false, "reviewer cannot approve twice");
  l = must(step(l, { invoiceId: "I6", role: "controller", at: T2 }));
  assert.equal(l[1].toStatus, "approved");
  l = must(step(l, { invoiceId: "I6", role: "controller", action: "pay", reason: "", at: T2 }));
  assert.equal(l[2].toStatus, "paid");
});

test("invalid role, state and reason are refused", () => {
  assert.match((step([], { invoiceId: "I1", role: "viewer" }) as { error: string }).error, /Viewer/);
  assert.equal(step([], { invoiceId: "I1", role: "controller" }).ok, false);
  assert.equal(step([], { invoiceId: "I1", role: "auditor" as never }).ok, false);
  assert.match((step([], { invoiceId: "I1", reason: "   " }) as { error: string }).error, /reason/);
  assert.match((step([], { invoiceId: "I1", action: "reject", reason: "" }) as { error: string }).error, /reason/);
  assert.equal(step([], { invoiceId: "I3", action: "pay", role: "reviewer" }).ok, false);
  assert.equal(step([], { invoiceId: "I1", action: "pay", role: "controller" }).ok, false);
  assert.equal(step([], { invoiceId: "I4", action: "approve" }).ok, false, "paid is terminal");
  assert.equal(step([], { invoiceId: "I5", action: "approve" }).ok, false, "rejected is terminal");
  assert.equal(step([], { invoiceId: "I99" }).ok, false);
  const l = must(step([], { invoiceId: "I6" }));
  assert.equal(step(l, { invoiceId: "I6", role: "controller", action: "reject", reason: "" }).ok, false);
  assert.equal(must(step(l, { invoiceId: "I6", role: "controller", action: "reject", reason: "Over AFE" })).at(-1)!.toStatus, "rejected");
});

test("append is immutable", () => {
  const l0 = must(step([], { invoiceId: "I1" }));
  const l1 = must(step(l0, { invoiceId: "I2", action: "reject", reason: "Duplicate of I1" }));
  assert.equal(l0.length, 1);
  assert.equal(l1.length, 2);
  assert.ok(Object.isFrozen(l1) && Object.isFrozen(l1[0]));
  assert.throws(() => { (l1 as DecisionEvent[]).push(l1[0]); });
});

test("reload replay restores state; replayed/tampered events rejected", () => {
  const kv = mem();
  let l = must(step([], { invoiceId: "I1" }));
  l = must(step(l, { invoiceId: "I6" }));
  must(saveLedger(kv, l));
  const loaded = must(loadLedger(kv, SEED));
  assert.equal(loaded.states.get("I1")!.status, "approved");
  assert.equal(loaded.states.get("I6")!.stage, "controller");

  kv.setItem(STORAGE_KEY, JSON.stringify({ version: 1, events: [...l, { ...l[0], seq: 3 }] }));
  assert.equal(loadLedger(kv, SEED).ok, false, "replayed event");
  kv.setItem(STORAGE_KEY, JSON.stringify({ version: 1, events: [{ ...l[0], toStatus: "paid" }] }));
  assert.equal(loadLedger(kv, SEED).ok, false, "tampered status");
  kv.setItem(STORAGE_KEY, JSON.stringify({ version: 1, events: [{ ...l[0], reason: "" }] }));
  assert.equal(loadLedger(kv, SEED).ok, false, "blank reason");
  kv.setItem(STORAGE_KEY, "{not json");
  assert.equal(loadLedger(kv, SEED).ok, false, "corrupt");
  assert.equal(kv.getItem(STORAGE_KEY), "{not json", "never silently reseeded");
  assert.equal(replay(SEED, [l[1], l[0]]).ok, false, "out of order");
});

test("storage write failure is explicit", () => {
  const kv: KV = { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); }, removeItem: () => {} };
  const r = saveLedger(kv, []);
  assert.equal(r.ok, false);
});

test("totals never double count after transitions", () => {
  let l = must(step([], { invoiceId: "I6" }));
  l = must(step(l, { invoiceId: "I6", role: "controller" }));
  l = must(step(l, { invoiceId: "I6", role: "controller", action: "pay", reason: "" }));
  l = must(step(l, { invoiceId: "I3", role: "controller", action: "pay", reason: "" }));
  l = must(step(l, { invoiceId: "I2", action: "reject", reason: "Duplicate" }));
  const t = overallTotals(SEED, must(replay(SEED, l)));
  assert.equal(t.pending + t.approvedUnpaid + t.paid + t.rejected, 15500000);
  assert.equal(t.paid, 9000000 + 2500000);
  assert.equal(t.approvedUnpaid, 1500000);
  assert.equal(t.committed, 1500000 + 11500000);
  assert.equal(t.rejected, 1500000);
  assert.equal(t.pending, 1000000);
  assert.equal(formatCad(-350000000), "-$3,500,000.00");
});
