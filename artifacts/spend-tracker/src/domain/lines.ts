// Line-item provenance: PROJECT (AFE) -> LINE-ITEM GROUP (materials | labour) ACROSS INVOICES -> source line.
// Source lines are an immutable fixture owned by this module; they are never persisted.
// Line status is NOT stored: it is derived from the persisted invoice status, so existing
// saved decisions keep working and drive line bucket classification.
// In this demo an AFE is the "project"; a PAR remains a suballocation under it.
// Pure functions only. All money is integer CAD cents.

import { DomainError, bucketOf, bucketInvoices, type Buckets, type Invoice, type InvoiceStatus, type SpendState } from "./model.ts";

export type LineCategory = "materials" | "labour";
export const CATEGORIES: readonly LineCategory[] = ["materials", "labour"];
export const CATEGORY_LABEL: Record<LineCategory, string> = { materials: "Materials", labour: "Labour" };
const SUFFIX: Record<LineCategory, string> = { materials: "M", labour: "L" };

export interface SourceLine {
  readonly id: string;          // `${invoiceId}-M` | `${invoiceId}-L`
  readonly invoiceId: string;
  readonly category: LineCategory;
  readonly description: string;
  readonly cents: number;
}

const line = (invoiceId: string, category: LineCategory, cents: number, description: string): SourceLine =>
  Object.freeze({ id: `${invoiceId}-${SUFFIX[category]}`, invoiceId, category, description, cents });

/** Deterministic synthetic source lines. Each pair sums to its invoice amount. */
export const SOURCE_LINES: readonly SourceLine[] = Object.freeze([
  line("I1", "materials", 700000, "Centrifugal pump impeller and wear-ring kit, 6-inch"),
  line("I1", "labour", 300000, "Millwright crew, pump teardown and rebuild, 2 days"),
  line("I2", "materials", 700000, "Centrifugal pump impeller and wear-ring kit, 6-inch"),
  line("I2", "labour", 300000, "Millwright crew, pump teardown and rebuild, 2 days"),
  line("I3", "materials", 500000, "Gravel, culvert pipe and geotextile for lease road"),
  line("I3", "labour", 2000000, "Site services crew, road grading and snow clearing"),
  line("I4", "materials", 1400000, "Replacement mechanical seals and coupling assemblies"),
  line("I4", "labour", 600000, "Field technician, seal installation and alignment"),
  line("I5", "materials", 100000, "Spill kit consumables and absorbent booms"),
  line("I5", "labour", 400000, "Vacuum truck operator, sump clean-out"),
  line("I6", "materials", 4000000, "PLC controller rack, I/O cards and marshalling panel"),
  line("I6", "labour", 2000000, "Instrumentation technicians, panel install and loop checks"),
  line("I7", "materials", 1200000, "Shielded instrument cable, tray and fittings"),
  line("I7", "labour", 300000, "Electrician, cable pull and terminations"),
  line("I8", "materials", 200000, "Calibration gas cylinders and test fittings"),
  line("I8", "labour", 800000, "Controls engineer, commissioning and transmitter calibration"),
]);

/**
 * Validates source lines against the state: id format, unique ids, known invoice,
 * known category, positive integer cents, exactly one line per category per invoice,
 * and per-invoice reconciliation (sum of lines === invoice cents).
 */
export function validateLines(s: SpendState, lines: readonly SourceLine[]): void {
  const seen = new Set<string>();
  const byInvoice = new Map<string, SourceLine[]>();
  for (const l of lines) {
    if (!CATEGORIES.includes(l.category)) throw new DomainError("bad_category", `Line ${l.id} has unknown category ${String(l.category)}`);
    if (!s.invoices[l.invoiceId]) throw new DomainError("missing_invoice", `Line ${l.id} references missing invoice ${l.invoiceId}`);
    if (l.id !== `${l.invoiceId}-${SUFFIX[l.category]}`) throw new DomainError("bad_line_id", `Line ${l.id} should be ${l.invoiceId}-${SUFFIX[l.category]}`);
    if (seen.has(l.id)) throw new DomainError("duplicate_line", `Line ${l.id} appears more than once`);
    seen.add(l.id);
    if (typeof l.cents !== "number" || !Number.isSafeInteger(l.cents) || l.cents <= 0) throw new DomainError("bad_amount", `Line ${l.id} amount must be positive integer cents`);
    if (!l.description || !l.description.trim()) throw new DomainError("bad_description", `Line ${l.id} has no description`);
    byInvoice.set(l.invoiceId, [...(byInvoice.get(l.invoiceId) ?? []), l]);
  }
  for (const inv of Object.values(s.invoices)) {
    const ls = byInvoice.get(inv.id) ?? [];
    if (ls.length !== CATEGORIES.length) throw new DomainError("line_count", `Invoice ${inv.id} has ${ls.length} source lines, expected ${CATEGORIES.length}`);
    const sum = ls.reduce((t, l) => t + l.cents, 0);
    if (sum !== inv.cents) throw new DomainError("line_sum_mismatch", `Invoice ${inv.id} lines sum ${sum} but invoice is ${inv.cents}`);
  }
}

export type Scope = { level: "portfolio" } | { level: "afe"; id: string } | { level: "par"; id: string };

export function scopeLabel(s: SpendState, sc: Scope): string {
  if (sc.level === "portfolio") return "All projects";
  return sc.level === "afe" ? `${sc.id} ${s.afes[sc.id]?.name ?? ""}` : `${sc.id} ${s.pars[sc.id]?.name ?? ""}`;
}

function invoicesInScope(s: SpendState, sc: Scope): Invoice[] {
  if (sc.level === "afe" && !s.afes[sc.id]) throw new DomainError("missing_afe", `Unknown project ${sc.id}`);
  if (sc.level === "par" && !s.pars[sc.id]) throw new DomainError("missing_par", `Unknown PAR ${sc.id}`);
  return Object.values(s.invoices).filter((i) => sc.level === "portfolio" || (sc.level === "afe" ? i.afeId : i.parId) === sc.id);
}

export interface TracedLine {
  line: SourceLine;
  invoice: Invoice;
  supplierName: string;
  status: InvoiceStatus;
  bucket: keyof Buckets;
}

const idOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Lines in a scope (optionally one category), each carrying its invoice provenance and derived status. */
export function tracedLines(s: SpendState, sc: Scope, category?: LineCategory, lines: readonly SourceLine[] = SOURCE_LINES): TracedLine[] {
  validateLines(s, lines);
  const ids = new Set(invoicesInScope(s, sc).map((i) => i.id));
  return lines
    .filter((l) => ids.has(l.invoiceId) && (!category || l.category === category))
    .map((l) => {
      const invoice = s.invoices[l.invoiceId];
      return { line: l, invoice, supplierName: s.suppliers[invoice.supplierId].name, status: invoice.status, bucket: bucketOf(invoice.status) };
    })
    .sort((a, b) => idOrder(a.line.id, b.line.id));
}

export function linesOfInvoice(s: SpendState, invoiceId: string, lines: readonly SourceLine[] = SOURCE_LINES): TracedLine[] {
  if (!s.invoices[invoiceId]) throw new DomainError("missing_invoice", `Unknown invoice ${invoiceId}`);
  validateLines(s, lines);
  return tracedLines(s, { level: "par", id: s.invoices[invoiceId].parId }, undefined, lines).filter((t) => t.invoice.id === invoiceId);
}

export interface GroupTotals extends Buckets { committed: number; lineCount: number; invoiceIds: string[] }

function totalsOf(ts: TracedLine[]): GroupTotals {
  const g: GroupTotals = { pending: 0, approvedUnpaid: 0, paid: 0, rejected: 0, committed: 0, lineCount: ts.length, invoiceIds: [] };
  for (const t of ts) g[t.bucket] += t.line.cents;
  g.committed = g.approvedUnpaid + g.paid;
  g.invoiceIds = [...new Set(ts.map((t) => t.invoice.id))].sort(idOrder);
  return g;
}

export interface GroupTrace {
  scope: Scope;
  groups: Record<LineCategory, GroupTotals>;
  total: GroupTotals;          // sum of the category groups
  invoiceTotals: Buckets & { committed: number }; // independently bucketed from invoice rows
  reconciles: boolean;
  differences: string[];
}

/** Group lines by category across invoices and reconcile group sums against invoice-level totals. */
export function groupTrace(s: SpendState, sc: Scope, lines: readonly SourceLine[] = SOURCE_LINES): GroupTrace {
  const all = tracedLines(s, sc, undefined, lines);
  const groups = Object.fromEntries(CATEGORIES.map((c) => [c, totalsOf(all.filter((t) => t.line.category === c))])) as Record<LineCategory, GroupTotals>;
  const total = totalsOf(all);
  const ib = bucketInvoices(invoicesInScope(s, sc));
  const invoiceTotals = { ...ib, committed: ib.approvedUnpaid + ib.paid };
  const differences: string[] = [];
  for (const k of ["pending", "approvedUnpaid", "paid", "rejected", "committed"] as const) {
    const g = CATEGORIES.reduce((t, c) => t + groups[c][k], 0);
    if (g !== invoiceTotals[k]) differences.push(`${k}: groups ${g} vs invoices ${invoiceTotals[k]}`);
  }
  return { scope: sc, groups, total, invoiceTotals, reconciles: differences.length === 0, differences };
}
