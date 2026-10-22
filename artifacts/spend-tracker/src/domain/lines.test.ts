import { test } from "node:test";
import assert from "node:assert/strict";
import { seedState, applyAction, DomainError } from "./model.ts";
import { SOURCE_LINES, groupTrace, tracedLines, linesOfInvoice, validateLines, type SourceLine } from "./lines.ts";

const AT = "2026-09-20T00:00:00.000Z";
const code = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;

test("fixture: 16 lines, each invoice pair sums to invoice cents", () => {
  const s = seedState();
  assert.equal(SOURCE_LINES.length, 16);
  validateLines(s, SOURCE_LINES);
  for (const inv of Object.values(s.invoices)) {
    assert.deepEqual(linesOfInvoice(s, inv.id).map((t) => t.line.id), [`${inv.id}-L`, `${inv.id}-M`]);
  }
  assert.ok(Object.isFrozen(SOURCE_LINES) && Object.isFrozen(SOURCE_LINES[0]));
});

test("AFE-200 project groups: materials committed 14000/pending 40000, labour 11000/20000", () => {
  const g = groupTrace(seedState(), { level: "afe", id: "AFE-200" });
  assert.deepEqual([g.groups.materials.committed, g.groups.materials.pending], [1400000, 4000000]);
  assert.deepEqual([g.groups.labour.committed, g.groups.labour.pending], [1100000, 2000000]);
  assert.ok(g.reconciles);
});

test("portfolio and every scope reconcile groups -> invoices; rejected excluded from committed", () => {
  const s = seedState();
  const p = groupTrace(s, { level: "portfolio" });
  assert.ok(p.reconciles);
  assert.deepEqual([p.total.pending, p.total.approvedUnpaid, p.total.paid, p.total.rejected, p.total.committed], [8000000, 4000000, 3000000, 500000, 7000000]);
  assert.deepEqual([p.groups.materials.rejected, p.groups.labour.rejected], [100000, 400000]);
  for (const id of ["AFE-100", "AFE-200"]) assert.ok(groupTrace(s, { level: "afe", id }).reconciles);
  for (const id of ["PAR-110", "PAR-120", "PAR-210"]) assert.ok(groupTrace(s, { level: "par", id }).reconciles);
  const a1 = groupTrace(s, { level: "afe", id: "AFE-100" }).groups.materials;
  assert.deepEqual([a1.pending, a1.approvedUnpaid, a1.paid, a1.rejected], [1400000, 500000, 1400000, 100000]);
});

test("provenance: labour lines in AFE-200 carry supplier, invoice, PAR, status", () => {
  const rows = tracedLines(seedState(), { level: "afe", id: "AFE-200" }, "labour");
  assert.deepEqual(rows.map((r) => [r.line.id, r.invoice.number, r.invoice.parId, r.status, r.line.cents]), [
    ["I6-L", "SE-302", "PAR-210", "pending", 2000000],
    ["I7-L", "BP-101", "PAR-210", "approved", 300000],
    ["I8-L", "PS-203", "PAR-210", "paid", 800000],
  ]);
  assert.equal(rows[0].supplierName, "Summit Equipment (synthetic)");
});

test("status movement: approve, pay, reject move both lines of the invoice", () => {
  let s = seedState();
  const sc = { level: "afe", id: "AFE-200" } as const;
  s = applyAction(s, "I6", { kind: "approve" }, "reviewer", AT);
  let g = groupTrace(s, sc);
  assert.deepEqual([g.groups.materials.pending, g.groups.materials.committed, g.groups.labour.committed], [0, 5400000, 3100000]);
  s = applyAction(s, "I6", { kind: "pay" }, "reviewer", AT);
  g = groupTrace(s, sc);
  assert.deepEqual([g.groups.materials.committed, g.groups.materials.paid, g.groups.materials.approvedUnpaid], [5400000, 4200000, 1200000]);
  assert.ok(g.reconciles);
  let r = seedState();
  r = applyAction(r, "I1", { kind: "reject", reason: "duplicate of I2" }, "reviewer", AT);
  const h = groupTrace(r, { level: "par", id: "PAR-110" });
  assert.deepEqual([h.groups.materials.pending, h.groups.materials.rejected, h.groups.labour.rejected], [700000, 700000, 300000]);
  assert.equal(h.groups.materials.committed, 1400000);
  assert.ok(h.reconciles);
});

test("invalid and mismatched lines are refused", () => {
  const s = seedState();
  const swap = (id: string, patch: Partial<SourceLine>) => SOURCE_LINES.map((l) => (l.id === id ? { ...l, ...patch } : l));
  assert.throws(() => validateLines(s, swap("I1-M", { cents: 699999 })), code("line_sum_mismatch"));
  assert.throws(() => validateLines(s, swap("I1-M", { cents: 0 })), code("bad_amount"));
  assert.throws(() => validateLines(s, swap("I1-M", { cents: 7000.5 })), code("bad_amount"));
  assert.throws(() => validateLines(s, swap("I1-M", { invoiceId: "I9", id: "I9-M" })), code("missing_invoice"));
  assert.throws(() => validateLines(s, swap("I1-M", { category: "freight" as never })), code("bad_category"));
  assert.throws(() => validateLines(s, swap("I1-M", { id: "I1-X" })), code("bad_line_id"));
  assert.throws(() => validateLines(s, [...SOURCE_LINES, SOURCE_LINES[0]]), code("duplicate_line"));
  assert.throws(() => validateLines(s, SOURCE_LINES.filter((l) => l.id !== "I8-L")), code("line_count"));
  assert.throws(() => groupTrace(s, { level: "afe", id: "AFE-999" }), code("missing_afe"));
  assert.throws(() => linesOfInvoice(s, "I99"), code("missing_invoice"));
});
