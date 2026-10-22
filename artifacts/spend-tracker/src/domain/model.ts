// Budget-centric normalized model. All money is integer CAD cents.
// Pure functions only: no React, no storage, no clock reads.

export type InvoiceStatus = "pending" | "approved" | "paid" | "rejected";
export type Role = "viewer" | "reviewer";

export interface Supplier { id: string; name: string }
export interface Afe { id: string; name: string; budgetCents: number; parIds: string[] }
export interface Par { id: string; afeId: string; name: string; allocationCents: number; invoiceIds: string[] }
export interface Invoice {
  id: string;
  supplierId: string;
  number: string;
  date: string;
  cents: number;
  afeId: string;
  parId: string;
  status: InvoiceStatus;
}
export interface Decision {
  seq: number;
  invoiceId: string;
  action: "approve" | "reject" | "pay";
  from: InvoiceStatus;
  to: InvoiceStatus;
  role: Role;
  reason: string | null;
  at: string;
}

export interface SpendState {
  revision: number;
  suppliers: Record<string, Supplier>;
  afes: Record<string, Afe>;
  pars: Record<string, Par>;
  invoices: Record<string, Invoice>;
  decisions: Decision[];
}

export class DomainError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "DomainError";
  }
}

const SUPPLIERS: Supplier[] = [
  { id: "S1", name: "Boreal Parts (synthetic)" },
  { id: "S2", name: "Prairie Services (synthetic)" },
  { id: "S3", name: "Summit Equipment (synthetic)" },
];
const AFES: Omit<Afe, "parIds">[] = [
  { id: "AFE-100", name: "Field maintenance", budgetCents: 10000000 },
  { id: "AFE-200", name: "Facility upgrade", budgetCents: 5000000 },
];
const PARS: Omit<Par, "invoiceIds">[] = [
  { id: "PAR-110", afeId: "AFE-100", name: "Pump renewal", allocationCents: 6000000 },
  { id: "PAR-120", afeId: "AFE-100", name: "Site services", allocationCents: 4000000 },
  { id: "PAR-210", afeId: "AFE-200", name: "Controls", allocationCents: 5000000 },
];
export const FIXTURE_INVOICES: Invoice[] = [
  { id: "I1", supplierId: "S1", number: "BP-100", date: "2026-09-01", cents: 1000000, afeId: "AFE-100", parId: "PAR-110", status: "pending" },
  { id: "I2", supplierId: "S1", number: "bp 100", date: "2026-09-01", cents: 1000000, afeId: "AFE-100", parId: "PAR-110", status: "pending" },
  { id: "I3", supplierId: "S2", number: "PS-201", date: "2026-09-04", cents: 2500000, afeId: "AFE-100", parId: "PAR-120", status: "approved" },
  { id: "I4", supplierId: "S3", number: "SE-301", date: "2026-09-07", cents: 2000000, afeId: "AFE-100", parId: "PAR-110", status: "paid" },
  { id: "I5", supplierId: "S2", number: "PS-202", date: "2026-09-10", cents: 500000, afeId: "AFE-100", parId: "PAR-120", status: "rejected" },
  { id: "I6", supplierId: "S3", number: "SE-302", date: "2026-09-12", cents: 6000000, afeId: "AFE-200", parId: "PAR-210", status: "pending" },
  { id: "I7", supplierId: "S1", number: "BP-101", date: "2026-09-15", cents: 1500000, afeId: "AFE-200", parId: "PAR-210", status: "approved" },
  { id: "I8", supplierId: "S2", number: "PS-203", date: "2026-09-18", cents: 1000000, afeId: "AFE-200", parId: "PAR-210", status: "paid" },
];

/** Build normalized maps from flat rows; throws DomainError on any broken reference. */
export function buildState(
  suppliers: Supplier[],
  afes: Omit<Afe, "parIds">[],
  pars: Omit<Par, "invoiceIds">[],
  invoices: Invoice[],
): SpendState {
  const s: SpendState = { revision: 0, suppliers: {}, afes: {}, pars: {}, invoices: {}, decisions: [] };
  for (const x of suppliers) s.suppliers[x.id] = { ...x };
  for (const a of afes) s.afes[a.id] = { ...a, parIds: [] };
  for (const p of pars) {
    if (!s.afes[p.afeId]) throw new DomainError("missing_afe", `PAR ${p.id} references missing AFE ${p.afeId}`);
    s.pars[p.id] = { ...p, invoiceIds: [] };
    s.afes[p.afeId].parIds.push(p.id);
  }
  for (const i of invoices) {
    s.invoices[i.id] = { ...i };
    if (s.pars[i.parId]) s.pars[i.parId].invoiceIds.push(i.id);
  }
  validateState(s);
  return s;
}

export function seedState(): SpendState {
  return buildState(SUPPLIERS, AFES, PARS, FIXTURE_INVOICES);
}

const STATUSES: InvoiceStatus[] = ["pending", "approved", "paid", "rejected"];
const isCents = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Reference and invariant validation. Throws DomainError on first problem. */
export function validateState(s: SpendState): void {
  for (const a of Object.values(s.afes)) {
    if (!isCents(a.budgetCents)) throw new DomainError("bad_amount", `AFE ${a.id} budget is not integer cents`);
    let sum = 0;
    for (const pid of a.parIds) {
      const p = s.pars[pid];
      if (!p) throw new DomainError("missing_par", `AFE ${a.id} lists missing PAR ${pid}`);
      sum += p.allocationCents;
    }
    if (sum !== a.budgetCents) throw new DomainError("budget_mismatch", `AFE ${a.id} budget ${a.budgetCents} does not equal PAR allocations ${sum}`);
  }
  for (const p of Object.values(s.pars)) {
    if (!s.afes[p.afeId]) throw new DomainError("missing_afe", `PAR ${p.id} references missing AFE ${p.afeId}`);
    if (!s.afes[p.afeId].parIds.includes(p.id)) throw new DomainError("orphan_par", `PAR ${p.id} not listed under AFE ${p.afeId}`);
    if (!isCents(p.allocationCents)) throw new DomainError("bad_amount", `PAR ${p.id} allocation is not integer cents`);
    for (const iid of p.invoiceIds) {
      if (!s.invoices[iid]) throw new DomainError("missing_invoice", `PAR ${p.id} lists missing invoice ${iid}`);
    }
  }
  for (const i of Object.values(s.invoices)) {
    if (!s.suppliers[i.supplierId]) throw new DomainError("missing_supplier", `Invoice ${i.id} references missing supplier ${i.supplierId}`);
    const p = s.pars[i.parId];
    if (!p) throw new DomainError("missing_par", `Invoice ${i.id} references missing PAR ${i.parId}`);
    if (!s.afes[i.afeId]) throw new DomainError("missing_afe", `Invoice ${i.id} references missing AFE ${i.afeId}`);
    if (p.afeId !== i.afeId) throw new DomainError("afe_mismatch", `Invoice ${i.id} AFE ${i.afeId} is not the parent of ${i.parId} (${p.afeId})`);
    if (!p.invoiceIds.includes(i.id)) throw new DomainError("orphan_invoice", `Invoice ${i.id} not indexed under ${i.parId}`);
    if (!isCents(i.cents)) throw new DomainError("bad_amount", `Invoice ${i.id} amount is not integer cents`);
    if (!STATUSES.includes(i.status)) throw new DomainError("bad_status", `Invoice ${i.id} has unknown status`);
  }
  for (const d of s.decisions) {
    if (!s.invoices[d.invoiceId]) throw new DomainError("missing_invoice", `Decision ${d.seq} references missing invoice ${d.invoiceId}`);
  }
}

// ---------- Rollups ----------

export interface Buckets { pending: number; approvedUnpaid: number; paid: number; rejected: number }
export interface Rollup extends Buckets {
  budget: number;
  committed: number;           // approvedUnpaid + paid
  remaining: number;           // budget - committed
  projectedRemaining: number;  // remaining - pending
  committedOverrun: number;    // max(0, -remaining)
  projectedOverrun: number;    // max(0, -projectedRemaining)
  invoiceCount: number;
}

const emptyBuckets = (): Buckets => ({ pending: 0, approvedUnpaid: 0, paid: 0, rejected: 0 });

export function bucketOf(status: InvoiceStatus): keyof Buckets {
  return status === "approved" ? "approvedUnpaid" : status;
}

export function finish(b: Buckets, budget: number, invoiceCount: number): Rollup {
  const committed = b.approvedUnpaid + b.paid;
  const remaining = budget - committed;
  const projectedRemaining = remaining - b.pending;
  return {
    ...b, budget, committed, remaining, projectedRemaining, invoiceCount,
    committedOverrun: Math.max(0, -remaining),
    projectedOverrun: Math.max(0, -projectedRemaining),
  };
}

export function bucketInvoices(invs: Invoice[]): Buckets {
  const b = emptyBuckets();
  for (const i of invs) b[bucketOf(i.status)] += i.cents;
  return b;
}

export function invoicesOfPar(s: SpendState, parId: string): Invoice[] {
  const p = s.pars[parId];
  if (!p) throw new DomainError("missing_par", `Unknown PAR ${parId}`);
  return p.invoiceIds.map((id) => s.invoices[id]);
}

export function rollupPar(s: SpendState, parId: string): Rollup {
  const invs = invoicesOfPar(s, parId);
  return finish(bucketInvoices(invs), s.pars[parId].allocationCents, invs.length);
}

/** AFE rollup is the sum of its PAR rollups (budget-centric), not a raw invoice scan. */
export function rollupAfe(s: SpendState, afeId: string): Rollup {
  const a = s.afes[afeId];
  if (!a) throw new DomainError("missing_afe", `Unknown AFE ${afeId}`);
  const b = emptyBuckets();
  let n = 0;
  for (const pid of a.parIds) {
    const r = rollupPar(s, pid);
    b.pending += r.pending; b.approvedUnpaid += r.approvedUnpaid; b.paid += r.paid; b.rejected += r.rejected;
    n += r.invoiceCount;
  }
  return finish(b, a.budgetCents, n);
}

export function rollupPortfolio(s: SpendState): Rollup {
  const b = emptyBuckets();
  let budget = 0, n = 0;
  for (const id of Object.keys(s.afes)) {
    const r = rollupAfe(s, id);
    b.pending += r.pending; b.approvedUnpaid += r.approvedUnpaid; b.paid += r.paid; b.rejected += r.rejected;
    budget += r.budget; n += r.invoiceCount;
  }
  return finish(b, budget, n);
}

export interface Reconciliation { rollup: Rollup; rowTotals: Buckets; rowCount: number; matches: boolean; differences: string[] }

/** Independent check: recompute from invoice rows filtered by id fields and compare to the rollup. */
export function reconcile(s: SpendState, level: "afe" | "par", id: string): Reconciliation {
  const rollup = level === "afe" ? rollupAfe(s, id) : rollupPar(s, id);
  const rows = Object.values(s.invoices).filter((i) => (level === "afe" ? i.afeId : i.parId) === id);
  const rowTotals = bucketInvoices(rows);
  const differences: string[] = [];
  for (const k of ["pending", "approvedUnpaid", "paid", "rejected"] as const) {
    if (rowTotals[k] !== rollup[k]) differences.push(`${k}: rows ${rowTotals[k]} vs rollup ${rollup[k]}`);
  }
  if (rows.length !== rollup.invoiceCount) differences.push(`count: rows ${rows.length} vs rollup ${rollup.invoiceCount}`);
  return { rollup, rowTotals, rowCount: rows.length, matches: differences.length === 0, differences };
}

// ---------- Overrun explanation (distinctive capability) ----------

export interface OverrunStep { label: string; deltaCents: number; runningCents: number; invoiceIds: string[] }

/**
 * Walk the budget down: budget, minus paid, minus approved-unpaid (committed line),
 * then each pending invoice largest-first, flagging which pending invoice first crosses zero.
 */
export function overrunTrail(s: SpendState, level: "afe" | "par", id: string): { steps: OverrunStep[]; crossingInvoiceId: string | null } {
  const rows = Object.values(s.invoices).filter((i) => (level === "afe" ? i.afeId : i.parId) === id);
  const budget = level === "afe" ? s.afes[id]?.budgetCents : s.pars[id]?.allocationCents;
  if (budget === undefined) throw new DomainError(level === "afe" ? "missing_afe" : "missing_par", `Unknown ${level.toUpperCase()} ${id}`);
  const steps: OverrunStep[] = [{ label: "Budget", deltaCents: budget, runningCents: budget, invoiceIds: [] }];
  let run = budget;
  const paid = rows.filter((i) => i.status === "paid");
  const appr = rows.filter((i) => i.status === "approved");
  const sum = (xs: Invoice[]) => xs.reduce((t, i) => t + i.cents, 0);
  run -= sum(paid);
  steps.push({ label: "Less paid", deltaCents: -sum(paid), runningCents: run, invoiceIds: paid.map((i) => i.id) });
  run -= sum(appr);
  steps.push({ label: "Less approved, unpaid = committed remaining", deltaCents: -sum(appr), runningCents: run, invoiceIds: appr.map((i) => i.id) });
  let crossing: string | null = null;
  const pend = rows.filter((i) => i.status === "pending").sort((a, b) => b.cents - a.cents || a.id.localeCompare(b.id));
  for (const i of pend) {
    const before = run;
    run -= i.cents;
    if (crossing === null && before >= 0 && run < 0) crossing = i.id;
    steps.push({ label: `Less pending ${i.id}`, deltaCents: -i.cents, runningCents: run, invoiceIds: [i.id] });
  }
  return { steps, crossingInvoiceId: crossing };
}

// ---------- Duplicates ----------

export const normalizeNumber = (n: string) => n.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function duplicateGroups(s: SpendState): string[][] {
  const m = new Map<string, string[]>();
  for (const i of Object.values(s.invoices)) {
    const k = `${i.supplierId}|${normalizeNumber(i.number)}`;
    m.set(k, [...(m.get(k) ?? []), i.id]);
  }
  return [...m.values()].filter((g) => g.length > 1).map((g) => g.sort());
}

export function duplicatesOf(s: SpendState, invoiceId: string): string[] {
  return duplicateGroups(s).find((g) => g.includes(invoiceId))?.filter((x) => x !== invoiceId) ?? [];
}

// ---------- Transitions (variant A/C) ----------

export type Action = { kind: "approve" } | { kind: "reject"; reason: string } | { kind: "pay" };

export function allowedActions(inv: Invoice, role: Role): Action["kind"][] {
  if (role !== "reviewer") return [];
  if (inv.status === "pending") return ["approve", "reject"];
  if (inv.status === "approved") return ["pay"];
  return [];
}

/** Returns a new state; never mutates input. Throws DomainError on invalid transitions. */
export function applyAction(s: SpendState, invoiceId: string, action: Action, role: Role, at: string): SpendState {
  const inv = s.invoices[invoiceId];
  if (!inv) throw new DomainError("missing_invoice", `Unknown invoice ${invoiceId}`);
  if (role !== "reviewer") throw new DomainError("forbidden", `Role "${role}" cannot decide invoices`);
  let to: InvoiceStatus;
  let reason: string | null = null;
  if (action.kind === "approve") {
    if (inv.status !== "pending") throw new DomainError("bad_transition", `Cannot approve ${invoiceId}: status is ${inv.status}`);
    to = "approved";
  } else if (action.kind === "reject") {
    if (inv.status !== "pending") throw new DomainError("bad_transition", `Cannot reject ${invoiceId}: status is ${inv.status}`);
    reason = action.reason.trim();
    if (!reason) throw new DomainError("reason_required", "Rejection requires a nonblank reason");
    to = "rejected";
  } else {
    if (inv.status !== "approved") throw new DomainError("bad_transition", `Cannot mark ${invoiceId} paid: status is ${inv.status}`);
    to = "paid";
  }
  const decision: Decision = { seq: s.decisions.length + 1, invoiceId, action: action.kind, from: inv.status, to, role, reason, at };
  return {
    ...s,
    revision: s.revision + 1,
    invoices: { ...s.invoices, [invoiceId]: { ...inv, status: to } },
    decisions: [...s.decisions, decision],
  };
}

// ---------- Search ----------

export function searchInvoices(s: SpendState, q: string, status: InvoiceStatus | "all"): Invoice[] {
  const needle = q.trim().toUpperCase();
  const nn = normalizeNumber(q);
  return Object.values(s.invoices)
    .filter((i) => status === "all" || i.status === status)
    .filter((i) => {
      if (!needle) return true;
      const sup = s.suppliers[i.supplierId]?.name.toUpperCase() ?? "";
      return (
        i.id.toUpperCase() === needle || (nn !== "" && normalizeNumber(i.number).includes(nn)) ||
        sup.includes(needle) || i.afeId.includes(needle) || i.parId.includes(needle) || i.date.includes(needle)
      );
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

// ---------- Persistence codec ----------

export const STORAGE_KEY = "spend-tracker:v1";
export const SCHEMA = "spend-tracker/v1";

export function encode(s: SpendState): string {
  return JSON.stringify({ schema: SCHEMA, state: s });
}

export type Decoded = { kind: "empty" } | { kind: "ok"; state: SpendState } | { kind: "corrupt"; message: string };

/** Absent data -> empty (first run seeds). Anything unreadable -> corrupt, never silently reseeded. */
export function decode(raw: string | null): Decoded {
  if (raw === null) return { kind: "empty" };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { kind: "corrupt", message: "Stored data is not valid JSON" }; }
  const env = parsed as { schema?: unknown; state?: SpendState };
  if (!env || typeof env !== "object" || env.schema !== SCHEMA) return { kind: "corrupt", message: `Unexpected schema (expected ${SCHEMA})` };
  const st = env.state;
  if (!st || typeof st !== "object" || typeof st.revision !== "number" || !st.suppliers || !st.afes || !st.pars || !st.invoices || !Array.isArray(st.decisions)) {
    return { kind: "corrupt", message: "Stored state is missing required maps" };
  }
  try { validateState(st); } catch (e) { return { kind: "corrupt", message: e instanceof Error ? e.message : String(e) }; }
  return { kind: "ok", state: st };
}
