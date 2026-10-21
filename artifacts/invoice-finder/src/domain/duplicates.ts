import { normalizeInvoiceNumber } from "./search.ts";
import type { Invoice } from "./types.ts";

export function duplicateKey(inv: Invoice): string {
  return `${inv.supplierId}::${normalizeInvoiceNumber(inv.invoiceNumber)}`;
}

/** Always pass the FULL invoice list, never a filtered one. Returns other invoices sharing supplier + normalized number. */
export function findDuplicates(target: Invoice, allInvoices: Invoice[]): Invoice[] {
  const key = duplicateKey(target);
  return allInvoices.filter((i) => i.id !== target.id && duplicateKey(i) === key);
}

/** Map of invoice id -> duplicate ids, computed across all invoices. */
export function duplicateIndex(allInvoices: Invoice[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const i of allInvoices) {
    const k = duplicateKey(i);
    groups.set(k, [...(groups.get(k) ?? []), i.id]);
  }
  const out = new Map<string, string[]>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) out.set(id, ids.filter((x) => x !== id));
  }
  return out;
}
