// Event-sourced decision ledger. Seed invoices are immutable; current state is
// always derived by replaying validated events in order. No event can be edited.
import type { Invoice, Seed, Status } from "./seed.ts";

export type Role = "viewer" | "reviewer" | "controller";
export type Stage = "reviewer" | "controller";
export type Action = "approve" | "reject" | "pay";

/** Amounts at or below this need reviewer approval only. */
export const SINGLE_APPROVAL_LIMIT_CENTS = 1000000;

export interface DecisionEvent {
  readonly seq: number;
  readonly id: string;
  readonly invoiceId: string;
  readonly action: Action;
  readonly role: Role;
  readonly at: string;
  readonly reason: string;
  readonly fromStatus: Status;
  readonly toStatus: Status;
  readonly fromStage: Stage | null;
  readonly toStage: Stage | null;
  /** Present only on events written by a bulk action; groups one batch. */
  readonly batchId?: string;
}

export interface InvoiceState {
  readonly invoice: Invoice;
  readonly status: Status;
  readonly stage: Stage | null;
  readonly events: readonly DecisionEvent[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function requiredStages(amountCents: number): readonly Stage[] {
  return amountCents <= SINGLE_APPROVAL_LIMIT_CENTS ? ["reviewer"] : ["reviewer", "controller"];
}

export function stageReason(amountCents: number): string {
  return amountCents <= SINGLE_APPROVAL_LIMIT_CENTS
    ? "At or under the $10,000.00 limit: one reviewer approval completes it."
    : "Over the $10,000.00 limit: reviewer approval moves it to controller stage; status stays pending until the controller approves.";
}

export function initialStates(seed: Seed): Map<string, InvoiceState> {
  const m = new Map<string, InvoiceState>();
  for (const inv of seed.invoices) {
    m.set(inv.id, { invoice: inv, status: inv.initialStatus, stage: inv.initialStatus === "pending" ? "reviewer" : null, events: [] });
  }
  return m;
}

/** What a role may do to an invoice right now. */
export function allowedActions(state: InvoiceState, role: Role): Action[] {
  if (role === "viewer") return [];
  if (state.status === "pending" && state.stage === role) return ["approve", "reject"];
  if (state.status === "approved" && role === "controller") return ["pay"];
  return [];
}

export interface DecisionInput {
  invoiceId: string;
  action: Action;
  role: Role;
  reason: string;
  at: string;
}

/** Pure transition: validates and returns the event that would be appended. */
export function decide(states: ReadonlyMap<string, InvoiceState>, nextSeq: number, id: string, input: DecisionInput): Result<DecisionEvent> {
  const st = states.get(input.invoiceId);
  if (!st) return { ok: false, error: `Unknown invoice ${input.invoiceId}` };
  if (!["viewer", "reviewer", "controller"].includes(input.role)) return { ok: false, error: `Unknown role ${String(input.role)}` };
  if (!["approve", "reject", "pay"].includes(input.action)) return { ok: false, error: `Unknown action ${String(input.action)}` };
  if (input.role === "viewer") return { ok: false, error: "Viewer cannot make decisions." };
  if (typeof input.at !== "string" || Number.isNaN(Date.parse(input.at))) return { ok: false, error: "Invalid timestamp." };
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (st.status === "paid" || st.status === "rejected") return { ok: false, error: `${st.invoice.id} is ${st.status}; terminal states cannot change.` };

  const base = { seq: nextSeq, id, invoiceId: st.invoice.id, action: input.action, role: input.role, at: input.at, reason, fromStatus: st.status, fromStage: st.stage };

  if (input.action === "pay") {
    if (st.status !== "approved") return { ok: false, error: "Only approved invoices can be marked paid." };
    if (input.role !== "controller") return { ok: false, error: "Only the controller can mark invoices paid." };
    return { ok: true, value: { ...base, toStatus: "paid", toStage: null } };
  }
  if (st.status !== "pending") return { ok: false, error: `Cannot ${input.action} an invoice that is ${st.status}.` };
  if (st.stage !== input.role) return { ok: false, error: `Invoice is at ${st.stage} stage; ${input.role} cannot ${input.action} it.` };
  if (!reason) return { ok: false, error: `A nonblank reason is required to ${input.action}.` };

  if (input.action === "reject") return { ok: true, value: { ...base, toStatus: "rejected", toStage: null } };
  const stages = requiredStages(st.invoice.amountCents);
  const idx = stages.indexOf(st.stage);
  const next = stages[idx + 1];
  if (next) return { ok: true, value: { ...base, toStatus: "pending", toStage: next } };
  return { ok: true, value: { ...base, toStatus: "approved", toStage: null } };
}

function apply(states: Map<string, InvoiceState>, e: DecisionEvent): void {
  const st = states.get(e.invoiceId)!;
  states.set(e.invoiceId, { ...st, status: e.toStatus, stage: e.toStage, events: [...st.events, e] });
}

const KEYS: (keyof DecisionEvent)[] = ["seq", "id", "invoiceId", "action", "role", "at", "reason", "fromStatus", "toStatus", "fromStage", "toStage", "batchId"];

/** Replays a ledger; any invalid, reordered, replayed or tampered event fails the whole load. */
export function replay(seed: Seed, events: readonly unknown[]): Result<Map<string, InvoiceState>> {
  const states = initialStates(seed);
  const ids = new Set<string>();
  let lastAt = -Infinity;
  for (let i = 0; i < events.length; i++) {
    const raw = events[i] as Record<string, unknown>;
    const where = `Ledger event #${i + 1}`;
    if (!raw || typeof raw !== "object") return { ok: false, error: `${where} is not an object.` };
    const extra = Object.keys(raw).filter((k) => !KEYS.includes(k as keyof DecisionEvent));
    if (extra.length) return { ok: false, error: `${where} has unknown fields: ${extra.join(", ")}.` };
    if (raw.seq !== i + 1) return { ok: false, error: `${where} has seq ${String(raw.seq)}; expected ${i + 1} (reordered or replayed).` };
    if (typeof raw.id !== "string" || !raw.id) return { ok: false, error: `${where} has no id.` };
    if (ids.has(raw.id)) return { ok: false, error: `${where} replays event id ${raw.id}.` };
    const t = Date.parse(String(raw.at));
    if (Number.isNaN(t)) return { ok: false, error: `${where} has invalid timestamp.` };
    if (t < lastAt) return { ok: false, error: `${where} timestamp goes backwards.` };
    const r = decide(states, i + 1, raw.id, { invoiceId: String(raw.invoiceId), action: raw.action as Action, role: raw.role as Role, reason: raw.reason as string, at: raw.at as string });
    if (!r.ok) return { ok: false, error: `${where} (${String(raw.invoiceId)}) rejected: ${r.error}` };
    if (raw.batchId !== undefined && (typeof raw.batchId !== "string" || !raw.batchId)) return { ok: false, error: `${where} has an invalid batchId.` };
    for (const k of KEYS) {
      if (k === "batchId") continue;
      if (r.value[k] !== raw[k]) return { ok: false, error: `${where} field "${k}" does not match the derived transition.` };
    }
    ids.add(raw.id);
    lastAt = t;
    apply(states, raw.batchId === undefined ? r.value : { ...r.value, batchId: raw.batchId as string });
  }
  return { ok: true, value: states };
}

/** Immutable append: returns a new frozen ledger; never mutates the input. */
export function appendDecision(seed: Seed, ledger: readonly DecisionEvent[], id: string, input: DecisionInput): Result<readonly DecisionEvent[]> {
  const rep = replay(seed, ledger);
  if (!rep.ok) return rep;
  const r = decide(rep.value, ledger.length + 1, id, input);
  if (!r.ok) return r;
  return { ok: true, value: Object.freeze([...ledger, Object.freeze(r.value)]) };
}

export interface Totals {
  pending: number; approvedUnpaid: number; paid: number; rejected: number;
  committed: number; budget: number; remaining: number; projectedRemaining: number;
}

/** Each invoice counted exactly once in its current status bucket. */
export function totals(states: Iterable<InvoiceState>, budget: number): Totals {
  const t = { pending: 0, approvedUnpaid: 0, paid: 0, rejected: 0 };
  for (const s of states) {
    const a = s.invoice.amountCents;
    if (s.status === "pending") t.pending += a;
    else if (s.status === "approved") t.approvedUnpaid += a;
    else if (s.status === "paid") t.paid += a;
    else t.rejected += a;
  }
  const committed = t.approvedUnpaid + t.paid;
  return { ...t, committed, budget, remaining: budget - committed, projectedRemaining: budget - committed - t.pending };
}

export function totalsByAfe(seed: Seed, states: ReadonlyMap<string, InvoiceState>): { afeId: string; name: string; totals: Totals }[] {
  return seed.afes.map((afe) => ({
    afeId: afe.id,
    name: afe.name,
    totals: totals([...states.values()].filter((s) => s.invoice.afeId === afe.id), afe.budgetCents),
  }));
}

export function overallTotals(seed: Seed, states: ReadonlyMap<string, InvoiceState>): Totals {
  return totals(states.values(), seed.afes.reduce((s, a) => s + a.budgetCents, 0));
}

export function formatCad(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
