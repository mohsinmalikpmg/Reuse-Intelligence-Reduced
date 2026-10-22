import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seedState, rollupPar, rollupAfe, rollupPortfolio, reconcile, applyAction, overrunTrail,
  duplicateGroups, buildState, FIXTURE_INVOICES, decode, encode, allowedActions, DomainError,
  type SpendState,
} from "./model.ts";

const AT = "2026-09-20T00:00:00.000Z";

test("portfolio fixture totals", () => {
  const r = rollupPortfolio(seedState());
  assert.deepEqual(
    [r.pending, r.approvedUnpaid, r.paid, r.rejected, r.committed, r.budget, r.remaining, r.projectedRemaining],
    [8000000, 4000000, 3000000, 500000, 7000000, 15000000, 8000000, 0],
  );
});

test("AFE-100 rollup", () => {
  const r = rollupAfe(seedState(), "AFE-100");
  assert.deepEqual([r.pending, r.approvedUnpaid, r.paid, r.rejected, r.committed, r.remaining, r.projectedRemaining],
    [2000000, 2500000, 2000000, 500000, 4500000, 5500000, 3500000]);
  assert.equal(r.projectedOverrun, 0);
});

test("AFE-200 rollup: committed remaining 25000, projected overrun 35000", () => {
  const r = rollupAfe(seedState(), "AFE-200");
  assert.deepEqual([r.pending, r.approvedUnpaid, r.paid, r.rejected, r.committed], [6000000, 1500000, 1000000, 0, 2500000]);
  assert.equal(r.remaining, 2500000);
  assert.equal(r.committedOverrun, 0);
  assert.equal(r.projectedRemaining, -3500000);
  assert.equal(r.projectedOverrun, 3500000);
});

test("each PAR rollup", () => {
  const s = seedState();
  const p110 = rollupPar(s, "PAR-110");
  assert.deepEqual([p110.budget, p110.pending, p110.approvedUnpaid, p110.paid, p110.rejected, p110.remaining, p110.projectedRemaining],
    [6000000, 2000000, 0, 2000000, 0, 4000000, 2000000]);
  const p120 = rollupPar(s, "PAR-120");
  assert.deepEqual([p120.budget, p120.pending, p120.approvedUnpaid, p120.paid, p120.rejected, p120.remaining, p120.projectedRemaining],
    [4000000, 0, 2500000, 0, 500000, 1500000, 1500000]);
  const p210 = rollupPar(s, "PAR-210");
  assert.deepEqual([p210.budget, p210.pending, p210.committed, p210.projectedOverrun], [5000000, 6000000, 2500000, 3500000]);
});

test("drilldowns reconcile to invoice rows", () => {
  const s = seedState();
  for (const id of ["AFE-100", "AFE-200"]) assert.ok(reconcile(s, "afe", id).matches);
  for (const id of ["PAR-110", "PAR-120", "PAR-210"]) assert.ok(reconcile(s, "par", id).matches);
  assert.equal(reconcile(s, "afe", "AFE-100").rowCount, 5);
});

test("missing references fail", () => {
  const base = FIXTURE_INVOICES[0];
  const sup = [{ id: "S1", name: "x" }];
  const afes = [{ id: "AFE-100", name: "a", budgetCents: 6000000 }];
  const pars = [{ id: "PAR-110", afeId: "AFE-100", name: "p", allocationCents: 6000000 }];
  const code = (fn: () => unknown) => { try { fn(); return "none"; } catch (e) { return (e as DomainError).code; } };
  assert.equal(code(() => buildState([], afes, pars, [base])), "missing_supplier");
  assert.equal(code(() => buildState(sup, afes, pars, [{ ...base, parId: "PAR-999" }])), "missing_par");
  assert.equal(code(() => buildState(sup, afes, [{ ...pars[0], afeId: "AFE-999" }], [])), "missing_afe");
  assert.equal(code(() => buildState(sup, afes, pars, [{ ...base, afeId: "AFE-200" }])), "missing_afe");
  assert.equal(code(() => buildState(sup, [{ ...afes[0], budgetCents: 1 }], pars, [])), "budget_mismatch");
  assert.equal(code(() => rollupPar(seedState(), "PAR-404")), "missing_par");
  assert.equal(code(() => applyAction(seedState(), "I99", { kind: "approve" }, "reviewer", AT)), "missing_invoice");
});

test("transition boundaries", () => {
  const s = seedState();
  const code = (fn: () => unknown) => { try { fn(); return "none"; } catch (e) { return (e as DomainError).code; } };
  assert.equal(code(() => applyAction(s, "I1", { kind: "approve" }, "viewer", AT)), "forbidden");
  assert.equal(code(() => applyAction(s, "I1", { kind: "reject", reason: "   " }, "reviewer", AT)), "reason_required");
  assert.equal(code(() => applyAction(s, "I1", { kind: "pay" }, "reviewer", AT)), "bad_transition");
  assert.equal(code(() => applyAction(s, "I3", { kind: "approve" }, "reviewer", AT)), "bad_transition");
  assert.equal(code(() => applyAction(s, "I4", { kind: "pay" }, "reviewer", AT)), "bad_transition");
  assert.equal(code(() => applyAction(s, "I5", { kind: "approve" }, "reviewer", AT)), "bad_transition");
  assert.deepEqual(allowedActions(s.invoices.I4, "reviewer"), []);
  assert.deepEqual(allowedActions(s.invoices.I1, "viewer"), []);
  const r = applyAction(s, "I6", { kind: "reject", reason: " duplicate scope " }, "reviewer", AT);
  assert.equal(r.invoices.I6.status, "rejected");
  assert.equal(r.decisions[0].reason, "duplicate scope");
  assert.equal(s.invoices.I6.status, "pending", "input not mutated");
  assert.equal(rollupAfe(r, "AFE-200").projectedOverrun, 0);
  assert.equal(rollupAfe(r, "AFE-200").rejected, 6000000);
});

test("approve moves pending into committed; approved-to-paid leaves committed unchanged", () => {
  const s0 = seedState();
  const s1 = applyAction(s0, "I6", { kind: "approve" }, "reviewer", AT);
  const a1 = rollupAfe(s1, "AFE-200");
  assert.equal(a1.pending, 0);
  assert.equal(a1.committed, 8500000);
  assert.equal(a1.committedOverrun, 3500000);
  const s2 = applyAction(s1, "I6", { kind: "pay" }, "reviewer", AT);
  const a2 = rollupAfe(s2, "AFE-200");
  assert.equal(a2.committed, a1.committed);
  assert.equal(a2.paid, 7000000);
  assert.equal(a2.approvedUnpaid, 1500000);
  assert.equal(s2.decisions.length, 2);
  assert.ok(reconcile(s2, "afe", "AFE-200").matches);
});

test("overrun trail names the pending invoice that crosses zero", () => {
  const t = overrunTrail(seedState(), "afe", "AFE-200");
  assert.equal(t.crossingInvoiceId, "I6");
  assert.deepEqual(t.steps.map((x) => x.runningCents), [5000000, 4000000, 2500000, -3500000]);
  assert.equal(overrunTrail(seedState(), "afe", "AFE-100").crossingInvoiceId, null);
});

test("duplicates: only I1/I2", () => {
  assert.deepEqual(duplicateGroups(seedState()), [["I1", "I2"]]);
});

test("codec: empty, ok, corrupt (never silently reseeded)", () => {
  assert.equal(decode(null).kind, "empty");
  const ok = decode(encode(seedState()));
  assert.equal(ok.kind, "ok");
  assert.equal(decode("{nope").kind, "corrupt");
  assert.equal(decode(JSON.stringify({ schema: "other" })).kind, "corrupt");
  const bad = seedState() as SpendState;
  bad.invoices.I1 = { ...bad.invoices.I1, supplierId: "S9" };
  assert.equal(decode(encode(bad)).kind, "corrupt");
});
