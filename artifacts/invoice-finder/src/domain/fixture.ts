import type { AppState } from "./types.ts";

/** Synthetic invoice scenario v1. Generated locally; not real company data. */
export function createSeedState(): AppState {
  return {
    schemaVersion: 1,
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
      { id: "PAR-110", afeId: "AFE-100", name: "Pump renewal", allocationCents: 6000000 },
      { id: "PAR-120", afeId: "AFE-100", name: "Site services", allocationCents: 4000000 },
      { id: "PAR-210", afeId: "AFE-200", name: "Controls", allocationCents: 5000000 },
    ],
    invoices: [
      { id: "I1", supplierId: "S1", invoiceNumber: "BP-100", date: "2026-09-01", cents: 1000000, afeId: "AFE-100", parId: "PAR-110", status: "pending" },
      { id: "I2", supplierId: "S1", invoiceNumber: "bp 100", date: "2026-09-01", cents: 1000000, afeId: "AFE-100", parId: "PAR-110", status: "pending" },
      { id: "I3", supplierId: "S2", invoiceNumber: "PS-201", date: "2026-09-04", cents: 2500000, afeId: "AFE-100", parId: "PAR-120", status: "approved" },
      { id: "I4", supplierId: "S3", invoiceNumber: "SE-301", date: "2026-09-07", cents: 2000000, afeId: "AFE-100", parId: "PAR-110", status: "paid" },
      { id: "I5", supplierId: "S2", invoiceNumber: "PS-202", date: "2026-09-10", cents: 500000, afeId: "AFE-100", parId: "PAR-120", status: "rejected" },
      { id: "I6", supplierId: "S3", invoiceNumber: "SE-302", date: "2026-09-12", cents: 6000000, afeId: "AFE-200", parId: "PAR-210", status: "pending" },
      { id: "I7", supplierId: "S1", invoiceNumber: "BP-101", date: "2026-09-15", cents: 1500000, afeId: "AFE-200", parId: "PAR-210", status: "approved" },
      { id: "I8", supplierId: "S2", invoiceNumber: "PS-203", date: "2026-09-18", cents: 1000000, afeId: "AFE-200", parId: "PAR-210", status: "paid" },
    ],
    decisions: [],
  };
}
