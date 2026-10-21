// Bulk review: preview a multi-invoice approve/reject, then apply only the
// eligible lines as individual append-only events in one ledger write.
// Pure; no storage access. The caller re-reads storage and passes the ledger.
import type { Seed, Status } from "./seed.ts";
import type { DecisionEvent, InvoiceState, Result, Role, Stage } from "./ledger.ts";
import { decide, replay, requiredStages } from "./ledger.ts";

export type BulkAction = "approve" | "reject";

export interface BulkLine {
  readonly invoiceId: string;
  readonly amountCents: number;
  readonly eligible: boolean;
  /** Why it is eligible (the transition) or exactly why it is skipped. */
  readonly why: string;
  readonly fromStatus: Status | null;
  readonly fromStage: Stage | null;
  readonly toStatus: Status | null;
  readonly toStage: Stage | null;
}

export interface BulkPreview {
  readonly action: BulkAction;
  readonly role: Role;
  readonly reason: string;
  /** Selection as given (may contain duplicates), kept for re-validation. */
  readonly selectedIds: readonly string[];
  readonly lines: readonly BulkLine[];
  readonly eligible: readonly BulkLine[];
  readonly ineligible: readonly BulkLine[];
  readonly duplicateIds: readonly string[];
  readonly selectedTotalCents: number;
  readonly eligibleTotalCents: number;
  /** Batch-level reasons nothing can be applied (blank reason, viewer, none eligible). */
  readonly blockers: readonly string[];
  /** status/stage of every selected invoice at preview time. */
  readonly snapshot: string;
}

function snapshotOf(states: ReadonlyMap<string, InvoiceState>, ids: readonly string[]): string {
  return ids.map((id) => { const s = states.get(id); return s ? `${id}:${s.status}:${s.stage ?? "-"}` : `${id}:missing`; }).join("|");
}

function lineFor(s: InvoiceState | undefined, id: string, action: BulkAction, role: Role): BulkLine {
  const base = { invoiceId: id, amountCents: s?.invoice.amountCents ?? 0, fromStatus: s?.status ?? null, fromStage: s?.stage ?? null, toStatus: null, toStage: null };
  const skip = (why: string): BulkLine => ({ ...base, eligible: false, why });
  if (!s) return skip("Unknown invoice; not in the seed fixture.");
  if (role === "viewer") return skip(`Viewer role is read only and cannot ${action}.`);
  if (s.status === "paid") return skip(`Paid is terminal; cannot ${action}.`);
  if (s.status === "rejected") return skip(`Already rejected (terminal); cannot ${action}.`);
  if (s.status === "approved") return skip(`Already approved, unpaid; only the controller's single "mark paid" remains (not a bulk action).`);
  if (s.stage !== role) return skip(`Pending at ${s.stage} stage; the ${role} cannot ${action} it until ${s.stage === "controller" ? "the controller acts" : "the reviewer approves it"}.`);
  if (action === "reject") return { ...base, eligible: true, why: `Rejected at ${role} stage (terminal).`, toStatus: "rejected", toStage: null };
  const stages = requiredStages(s.invoice.amountCents);
  const next = stages[stages.indexOf(s.stage) + 1];
  if (next) return { ...base, eligible: true, why: `Over $10,000.00: reviewer approval forwards to controller stage; stays pending.`, toStatus: "pending", toStage: next };
  return { ...base, eligible: true, why: role === "controller" ? "Controller approval completes the two-stage path." : "At or under $10,000.00: one reviewer approval completes it.", toStatus: "approved", toStage: null };
}

export function previewBulk(states: ReadonlyMap<string, InvoiceState>, selectedIds: readonly string[], action: BulkAction, role: Role, reason: string): BulkPreview {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  const unique: string[] = [];
  for (const id of selectedIds) {
    if (seen.has(id)) dupes.add(id); else { seen.add(id); unique.push(id); }
  }
  const lines = unique.map((id) => lineFor(states.get(id), id, action, role));
  const eligible = lines.filter((l) => l.eligible);
  const ineligible = lines.filter((l) => !l.eligible);
  const blockers: string[] = [];
  if (unique.length === 0) blockers.push("No invoices selected.");
  if (role === "viewer") blockers.push("Viewer role cannot decide. Switch the simulated role to reviewer or controller.");
  if (!reason.trim()) blockers.push(`A nonblank reason is required to bulk ${action}; it is recorded on every event.`);
  if (unique.length > 0 && role !== "viewer" && eligible.length === 0) blockers.push(`None of the selected invoices can be ${action === "approve" ? "approved" : "rejected"} by the ${role} right now.`);
  return {
    action, role, reason, selectedIds: [...selectedIds], lines, eligible, ineligible,
    duplicateIds: [...dupes],
    selectedTotalCents: lines.reduce((a, l) => a + l.amountCents, 0),
    eligibleTotalCents: eligible.reduce((a, l) => a + l.amountCents, 0),
    blockers, snapshot: snapshotOf(states, unique),
  };
}

export interface BulkOutcome {
  readonly ledger: readonly DecisionEvent[];
  readonly applied: readonly DecisionEvent[];
  readonly skipped: readonly BulkLine[];
  readonly batchId: string;
}

/**
 * Re-validates the preview against the given (freshly read) ledger. If any
 * selected invoice changed status or stage since the preview, nothing is
 * applied and the caller must review again. Otherwise each eligible invoice
 * gets its own sequential event sharing batchId. All-or-nothing.
 */
export function applyBulk(seed: Seed, ledger: readonly DecisionEvent[], preview: BulkPreview, opts: { batchId: string; at: string; newId: (i: number) => string }): Result<BulkOutcome> {
  const rep = replay(seed, ledger);
  if (!rep.ok) return rep;
  const fresh = previewBulk(rep.value, preview.selectedIds, preview.action, preview.role, preview.reason);
  if (fresh.snapshot !== preview.snapshot) {
    const before = new Map(preview.lines.map((l) => [l.invoiceId, l]));
    const changed = fresh.lines.filter((l) => { const b = before.get(l.invoiceId); return !b || b.fromStatus !== l.fromStatus || b.fromStage !== l.fromStage; })
      .map((l) => { const b = before.get(l.invoiceId); return `${l.invoiceId} was ${b?.fromStatus ?? "?"}${b?.fromStage ? `/${b.fromStage}` : ""}, now ${l.fromStatus ?? "missing"}${l.fromStage ? `/${l.fromStage}` : ""}`; });
    return { ok: false, error: `Preview is stale; nothing was applied. ${changed.join("; ")}. Review the batch again.` };
  }
  if (fresh.blockers.length) return { ok: false, error: `Nothing was applied. ${fresh.blockers.join(" ")}` };
  if (!opts.batchId) return { ok: false, error: "A batch id is required." };
  const states = new Map(rep.value);
  const out: DecisionEvent[] = [...ledger];
  const applied: DecisionEvent[] = [];
  for (let i = 0; i < fresh.eligible.length; i++) {
    const line = fresh.eligible[i];
    const r = decide(states, out.length + 1, opts.newId(i), { invoiceId: line.invoiceId, action: preview.action, role: preview.role, reason: preview.reason, at: opts.at });
    if (!r.ok) return { ok: false, error: `Nothing was applied. ${line.invoiceId}: ${r.error}` };
    const ev = Object.freeze({ ...r.value, batchId: opts.batchId });
    const st = states.get(ev.invoiceId)!;
    states.set(ev.invoiceId, { ...st, status: ev.toStatus, stage: ev.toStage, events: [...st.events, ev] });
    out.push(ev);
    applied.push(ev);
  }
  return { ok: true, value: { ledger: Object.freeze(out), applied, skipped: fresh.ineligible, batchId: opts.batchId } };
}
