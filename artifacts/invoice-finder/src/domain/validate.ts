import { STATUSES } from "./types.ts";
import type { AppState } from "./types.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns a list of integrity problems; empty means valid. Missing supplier/PAR/AFE references fail. */
export function validateState(s: AppState): string[] {
  const errors: string[] = [];
  const sup = new Set(s.suppliers.map((x) => x.id));
  const afes = new Map(s.afes.map((a) => [a.id, a]));
  const pars = new Map(s.pars.map((p) => [p.id, p]));
  for (const p of s.pars) {
    if (!afes.has(p.afeId)) errors.push(`PAR ${p.id} references missing AFE ${p.afeId}`);
  }
  for (const a of s.afes) {
    const alloc = s.pars.filter((p) => p.afeId === a.id).reduce((n, p) => n + p.allocationCents, 0);
    if (alloc !== a.budgetCents) errors.push(`AFE ${a.id} budget ${a.budgetCents} != PAR allocations ${alloc}`);
  }
  const ids = new Set<string>();
  for (const i of s.invoices) {
    if (ids.has(i.id)) errors.push(`Duplicate invoice id ${i.id}`);
    ids.add(i.id);
    if (!sup.has(i.supplierId)) errors.push(`Invoice ${i.id} references missing supplier ${i.supplierId}`);
    const par = pars.get(i.parId);
    if (!par) errors.push(`Invoice ${i.id} references missing PAR ${i.parId}`);
    if (!afes.has(i.afeId)) errors.push(`Invoice ${i.id} references missing AFE ${i.afeId}`);
    if (par && par.afeId !== i.afeId) errors.push(`Invoice ${i.id} PAR ${i.parId} is not under AFE ${i.afeId}`);
    if (!Number.isInteger(i.cents) || i.cents < 0) errors.push(`Invoice ${i.id} has invalid cents`);
    if (!DATE_RE.test(i.date)) errors.push(`Invoice ${i.id} has invalid date`);
    if (!STATUSES.includes(i.status)) errors.push(`Invoice ${i.id} has invalid status`);
  }
  for (const d of s.decisions) {
    if (!ids.has(d.invoiceId)) errors.push(`Decision ${d.seq} references missing invoice ${d.invoiceId}`);
  }
  return errors;
}
