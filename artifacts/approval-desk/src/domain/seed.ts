// Immutable seed fixture from SCENARIO.md (synthetic invoice scenario v1).
// All money is integer CAD cents.

export type Status = "pending" | "approved" | "rejected" | "paid";

export interface Supplier { readonly id: string; readonly name: string }
export interface Afe { readonly id: string; readonly name: string; readonly budgetCents: number }
export interface Par { readonly id: string; readonly name: string; readonly afeId: string; readonly allocationCents: number }
export interface Invoice {
  readonly id: string;
  readonly supplierId: string;
  readonly invoiceNumber: string;
  readonly date: string;
  readonly amountCents: number;
  readonly afeId: string;
  readonly parId: string;
  readonly initialStatus: Status;
}

export interface Seed {
  readonly suppliers: readonly Supplier[];
  readonly afes: readonly Afe[];
  readonly pars: readonly Par[];
  readonly invoices: readonly Invoice[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value as object).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const SEED: Seed = deepFreeze({
  suppliers: [
    { id: "S1", name: "Boreal Parts (synthetic)" },
    { id: "S2", name: "Prairie Services (synthetic)" },
    { id: "S3", name: "Summit Equipment (synthetic)" },
  ],
  afes: [
    { id: "AFE-100", name: "Field maintenance", budgetCents: 10000000 },
    { id: "AFE-200", name: "Facility upgrade", budgetCents: 5000000 },
  ],
  pars: [
    { id: "PAR-110", name: "Pump renewal", afeId: "AFE-100", allocationCents: 6000000 },
    { id: "PAR-120", name: "Site services", afeId: "AFE-100", allocationCents: 4000000 },
    { id: "PAR-210", name: "Controls", afeId: "AFE-200", allocationCents: 5000000 },
  ],
  invoices: [
    { id: "I1", supplierId: "S1", invoiceNumber: "BP-100", date: "2026-09-01", amountCents: 1000000, afeId: "AFE-100", parId: "PAR-110", initialStatus: "pending" },
    { id: "I2", supplierId: "S1", invoiceNumber: "bp 100", date: "2026-09-01", amountCents: 1000000, afeId: "AFE-100", parId: "PAR-110", initialStatus: "pending" },
    { id: "I3", supplierId: "S2", invoiceNumber: "PS-201", date: "2026-09-04", amountCents: 2500000, afeId: "AFE-100", parId: "PAR-120", initialStatus: "approved" },
    { id: "I4", supplierId: "S3", invoiceNumber: "SE-301", date: "2026-09-07", amountCents: 2000000, afeId: "AFE-100", parId: "PAR-110", initialStatus: "paid" },
    { id: "I5", supplierId: "S2", invoiceNumber: "PS-202", date: "2026-09-10", amountCents: 500000, afeId: "AFE-100", parId: "PAR-120", initialStatus: "rejected" },
    { id: "I6", supplierId: "S3", invoiceNumber: "SE-302", date: "2026-09-12", amountCents: 6000000, afeId: "AFE-200", parId: "PAR-210", initialStatus: "pending" },
    { id: "I7", supplierId: "S1", invoiceNumber: "BP-101", date: "2026-09-15", amountCents: 1500000, afeId: "AFE-200", parId: "PAR-210", initialStatus: "approved" },
    { id: "I8", supplierId: "S2", invoiceNumber: "PS-203", date: "2026-09-18", amountCents: 1000000, afeId: "AFE-200", parId: "PAR-210", initialStatus: "paid" },
  ],
});

/** Validates every supplier/PAR/AFE reference and hierarchy rule. Returns error messages (empty = valid). */
export function validateSeed(seed: Seed): string[] {
  const errors: string[] = [];
  const supplierIds = new Set(seed.suppliers.map((s) => s.id));
  const afeById = new Map(seed.afes.map((a) => [a.id, a]));
  const parById = new Map(seed.pars.map((p) => [p.id, p]));
  for (const par of seed.pars) {
    if (!afeById.has(par.afeId)) errors.push(`${par.id} references missing AFE ${par.afeId}`);
  }
  for (const afe of seed.afes) {
    const alloc = seed.pars.filter((p) => p.afeId === afe.id).reduce((s, p) => s + p.allocationCents, 0);
    if (alloc !== afe.budgetCents) errors.push(`${afe.id} budget ${afe.budgetCents} does not equal PAR allocations ${alloc}`);
  }
  const seen = new Set<string>();
  for (const inv of seed.invoices) {
    if (seen.has(inv.id)) errors.push(`Duplicate invoice id ${inv.id}`);
    seen.add(inv.id);
    if (!supplierIds.has(inv.supplierId)) errors.push(`${inv.id} references missing supplier ${inv.supplierId}`);
    if (!afeById.has(inv.afeId)) errors.push(`${inv.id} references missing AFE ${inv.afeId}`);
    const par = parById.get(inv.parId);
    if (!par) errors.push(`${inv.id} references missing PAR ${inv.parId}`);
    else if (par.afeId !== inv.afeId) errors.push(`${inv.id} PAR ${inv.parId} belongs to ${par.afeId}, not ${inv.afeId}`);
    if (!Number.isInteger(inv.amountCents) || inv.amountCents <= 0) errors.push(`${inv.id} amount must be positive integer cents`);
  }
  return errors;
}

export function normalizeInvoiceNumber(n: string): string {
  return n.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Map invoice id -> ids of other invoices with same supplier + normalized number. */
export function findDuplicates(invoices: readonly Invoice[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const inv of invoices) {
    const key = `${inv.supplierId}|${normalizeInvoiceNumber(inv.invoiceNumber)}`;
    groups.set(key, [...(groups.get(key) ?? []), inv.id]);
  }
  const out = new Map<string, string[]>();
  for (const ids of groups.values()) {
    if (ids.length > 1) for (const id of ids) out.set(id, ids.filter((x) => x !== id));
  }
  return out;
}
