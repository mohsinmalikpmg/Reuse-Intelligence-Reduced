import type { AppState, DecisionAction, Invoice, Role, Status } from "./types.ts";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const TRANSITIONS: Record<DecisionAction, { from: Status; to: Status }> = {
  approve: { from: "pending", to: "approved" },
  reject: { from: "pending", to: "rejected" },
  pay: { from: "approved", to: "paid" },
};

/** Basic variant A/C: demo reviewer approves/rejects pending (reject needs reason); approved may be marked paid. */
export function canDecide(inv: Invoice, action: DecisionAction, role: Role): Result<Status> {
  if (role !== "reviewer") return { ok: false, error: "Viewer role cannot record decisions." };
  const t = TRANSITIONS[action];
  if (inv.status === "paid" || inv.status === "rejected") return { ok: false, error: `Invoice ${inv.id} is ${inv.status} (terminal).` };
  if (inv.status !== t.from) return { ok: false, error: `Cannot ${action} invoice ${inv.id}: status is ${inv.status}, needs ${t.from}.` };
  return { ok: true, value: t.to };
}

export function applyDecision(
  state: AppState, invoiceId: string, action: DecisionAction, role: Role, reason: string, at: string,
): Result<AppState> {
  const inv = state.invoices.find((i) => i.id === invoiceId);
  if (!inv) return { ok: false, error: `Invoice ${invoiceId} does not exist.` };
  const check = canDecide(inv, action, role);
  if (!check.ok) return check;
  const trimmed = reason.trim();
  if (action === "reject" && trimmed === "") return { ok: false, error: "A reject reason is required." };
  const seq = state.decisions.reduce((m, d) => Math.max(m, d.seq), 0) + 1;
  return {
    ok: true,
    value: {
      ...state,
      invoices: state.invoices.map((i) => (i.id === invoiceId ? { ...i, status: check.value } : i)),
      decisions: [...state.decisions, { seq, invoiceId, action, from: inv.status, to: check.value, role, reason: trimmed || null, at }],
    },
  };
}
