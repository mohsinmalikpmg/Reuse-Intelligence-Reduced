import { useState } from "react";
import { findDuplicates } from "../domain/duplicates.ts";
import { formatCad } from "../domain/money.ts";
import { normalizeInvoiceNumber } from "../domain/search.ts";
import { canDecide } from "../domain/workflow.ts";
import type { AppState, DecisionAction, Role } from "../domain/types.ts";
import { StatusChip } from "./StatusChip.tsx";

interface Props {
  state: AppState; invoiceId: string | null; role: Role; visibleIds: Set<string>;
  onSelect: (id: string) => void; onDecide: (id: string, a: DecisionAction, reason: string) => string | null;
}

export function InvoiceDetail({ state, invoiceId, role, visibleIds, onSelect, onDecide }: Props) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const inv = state.invoices.find((i) => i.id === invoiceId);
  if (!inv) {
    return (
      <section className="detail empty-detail" data-testid="detail-empty">
        <p className="empty-title">Pick a row.</p>
        <p>The detail keeps duplicate checks against every invoice in the ledger, not just what your filters show.</p>
      </section>
    );
  }
  const sup = state.suppliers.find((s) => s.id === inv.supplierId);
  const par = state.pars.find((p) => p.id === inv.parId);
  const afe = state.afes.find((a) => a.id === inv.afeId);
  const dups = findDuplicates(inv, state.invoices);
  const log = state.decisions.filter((d) => d.invoiceId === inv.id);
  const act = (a: DecisionAction) => {
    const e = onDecide(inv.id, a, a === "reject" ? reason : "");
    setErr(e);
    if (!e) setReason("");
  };
  const gate = (a: DecisionAction) => canDecide(inv, a, role);

  return (
    <section className="detail" data-testid={`detail-${inv.id}`} key={inv.id}>
      <div className="detail-head">
        <div>
          <p className="eyebrow mono">{inv.id}</p>
          <h2 className="mono">{inv.invoiceNumber}</h2>
        </div>
        <StatusChip status={inv.status} />
      </div>
      <p className="amount mono" data-testid="text-detail-amount">{formatCad(inv.cents)}</p>
      <dl className="kv">
        <dt>Supplier</dt><dd>{inv.supplierId} - {sup?.name ?? "MISSING"}</dd>
        <dt>Date</dt><dd className="mono">{inv.date}</dd>
        <dt>AFE</dt><dd>{inv.afeId} {afe?.name ?? "MISSING"}</dd>
        <dt>PAR</dt><dd>{inv.parId} {par?.name ?? "MISSING"}</dd>
        <dt>Match key</dt><dd className="mono">{inv.supplierId}::{normalizeInvoiceNumber(inv.invoiceNumber)}</dd>
      </dl>

      {dups.length > 0 ? (
        <div className="dup-warn" role="alert" data-testid="warning-duplicate">
          <p className="dup-title">Strict duplicate warning</p>
          <p className="small">Same supplier and identical invoice number after removing case and punctuation. Fuzzy search similarity is never used here.</p>
          <p>Same supplier and invoice number after normalizing to uppercase alphanumerics. This is a warning only: amounts still count and decisions are not blocked.</p>
          <ul>
            {dups.map((d) => (
              <li key={d.id}>
                <button className="link-btn mono" data-testid={`link-duplicate-${d.id}`} onClick={() => onSelect(d.id)}>
                  {d.id} "{d.invoiceNumber}" {d.date} {formatCad(d.cents)}
                </button>{" "}
                <StatusChip status={d.status} />
                {!visibleIds.has(d.id) && <span className="hidden-note"> hidden by current filters</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="no-dup" data-testid="text-no-duplicate">No duplicate across all {state.invoices.length} invoices.</p>
      )}

      <div className="actions">
        <h3>Decision <span className="muted small">(simulation only)</span></h3>
        {role === "viewer" && <p className="muted small">Viewer role is read-only. Switch the demo role to reviewer in the header.</p>}
        <div className="btn-row">
          <button className="btn btn-approve" data-testid="button-approve" disabled={!gate("approve").ok}
            title={gate("approve").ok ? "" : (gate("approve") as { error: string }).error} onClick={() => act("approve")}>Approve</button>
          <button className="btn btn-pay" data-testid="button-pay" disabled={!gate("pay").ok}
            title={gate("pay").ok ? "" : (gate("pay") as { error: string }).error} onClick={() => act("pay")}>Mark paid</button>
        </div>
        {gate("reject").ok && (
          <div className="reject-box">
            <label className="field"><span>Reject reason (required)</span>
              <textarea data-testid="input-reject-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <button className="btn btn-reject" data-testid="button-reject" onClick={() => act("reject")}>Reject</button>
          </div>
        )}
        {(inv.status === "paid" || inv.status === "rejected") && <p className="muted small">Terminal status. No further decisions.</p>}
        {err && <p className="field-err" role="alert" data-testid="error-decision">{err}</p>}
      </div>

      <div className="log">
        <h3>Decision record</h3>
        {log.length === 0 ? <p className="muted small">No decisions recorded in this browser.</p> : (
          <ol data-testid="list-decisions">
            {log.map((d) => (
              <li key={d.seq} className="mono small">#{d.seq} {d.from} to {d.to} by demo {d.role} at {d.at.replace("T", " ").slice(0, 19)}{d.reason ? ` - "${d.reason}"` : ""}</li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
