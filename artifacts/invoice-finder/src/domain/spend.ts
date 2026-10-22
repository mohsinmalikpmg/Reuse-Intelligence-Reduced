import type { Afe, Invoice } from "./types.ts";

export interface SpendTotals {
  budget: number;
  pending: number;
  approvedUnpaid: number;
  paid: number;
  rejected: number;
  committed: number; // approvedUnpaid + paid
  remaining: number; // budget - committed
  projectedRemaining: number; // remaining - pending
}

export function computeSpend(invoices: Invoice[], budget: number): SpendTotals {
  const t = { pending: 0, approvedUnpaid: 0, paid: 0, rejected: 0 };
  for (const i of invoices) {
    if (i.status === "pending") t.pending += i.cents;
    else if (i.status === "approved") t.approvedUnpaid += i.cents;
    else if (i.status === "paid") t.paid += i.cents;
    else t.rejected += i.cents;
  }
  const committed = t.approvedUnpaid + t.paid;
  const remaining = budget - committed;
  return { budget, ...t, committed, remaining, projectedRemaining: remaining - t.pending };
}

export function spendByAfe(invoices: Invoice[], afes: Afe[]): { afe: Afe; totals: SpendTotals }[] {
  return afes.map((afe) => ({ afe, totals: computeSpend(invoices.filter((i) => i.afeId === afe.id), afe.budgetCents) }));
}

export function spendOverall(invoices: Invoice[], afes: Afe[]): SpendTotals {
  return computeSpend(invoices, afes.reduce((n, a) => n + a.budgetCents, 0));
}
