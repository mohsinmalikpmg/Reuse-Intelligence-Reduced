export type Status = "pending" | "approved" | "rejected" | "paid";
export const STATUSES: readonly Status[] = ["pending", "approved", "rejected", "paid"];

export interface Supplier { id: string; name: string }
export interface Afe { id: string; name: string; budgetCents: number }
export interface Par { id: string; afeId: string; name: string; allocationCents: number }

/** Flat invoice record: every searchable field lives on the row itself. */
export interface Invoice {
  id: string;
  supplierId: string;
  invoiceNumber: string;
  date: string; // YYYY-MM-DD
  cents: number;
  afeId: string;
  parId: string;
  status: Status;
}

export type DecisionAction = "approve" | "reject" | "pay";
export interface Decision {
  seq: number;
  invoiceId: string;
  action: DecisionAction;
  from: Status;
  to: Status;
  role: Role;
  reason: string | null;
  at: string; // ISO timestamp
}

export type Role = "viewer" | "reviewer";

export interface AppState {
  schemaVersion: 1;
  suppliers: Supplier[];
  afes: Afe[];
  pars: Par[];
  invoices: Invoice[];
  decisions: Decision[];
}
