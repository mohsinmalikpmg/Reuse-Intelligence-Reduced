// Bulk review desk: multi-select, a frozen preview that names every skipped
// invoice and why, then one confirmed write of individual ledger events.
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { previewBulk } from "./domain/bulk.ts";
import type { BulkAction, BulkOutcome, BulkPreview } from "./domain/bulk.ts";
import { formatCad } from "./domain/ledger.ts";
import type { InvoiceState, Role } from "./domain/ledger.ts";
import { ErrorBox, inputCls } from "./ui.tsx";
import type { Selection } from "./pages.tsx";

export type BulkFn = (p: BulkPreview) => { ok: true; value: BulkOutcome } | { ok: false; error: string };

const where = (status: string | null, stage: string | null) => (status === "pending" && stage ? `pending / ${stage}` : status ?? "missing");

export function BulkDesk({ states, role, visible, bulk, scope, children }: {
  states: ReadonlyMap<string, InvoiceState>; role: Role; visible: InvoiceState[]; bulk: BulkFn; scope: "queue" | "all";
  children: (s: Selection) => ReactNode;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [action, setAction] = useState<BulkAction | null>(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);

  const visibleIds = useMemo(() => visible.map((s) => s.invoice.id), [visible]);
  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  // Only visible selections count. Hidden ones are surfaced, never silently acted on.
  const effective = useMemo(() => visibleIds.filter((id) => picked.has(id)), [visibleIds, picked]);
  const hidden = [...picked].filter((id) => !visibleSet.has(id));
  const total = effective.reduce((a, id) => a + (states.get(id)?.invoice.amountCents ?? 0), 0);

  const invalidate = () => { setPreview(null); setError(null); };
  const selection: Selection = {
    selected: new Set(effective),
    toggle: (id) => { invalidate(); setOutcome(null); setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); },
    toggleAllVisible: () => {
      invalidate(); setOutcome(null);
      setPicked((p) => {
        const allOn = visibleIds.length > 0 && visibleIds.every((id) => p.has(id));
        const n = new Set(p);
        visibleIds.forEach((id) => (allOn ? n.delete(id) : n.add(id)));
        return n;
      });
    },
  };

  // A frozen preview goes stale if any selected invoice moved since it was built.
  const live = preview ? previewBulk(states, preview.selectedIds, preview.action, preview.role, preview.reason) : null;
  const stale = !!preview && !!live && (live.snapshot !== preview.snapshot || preview.role !== role);
  const selectionDrift = !!preview && (preview.selectedIds.length !== effective.length || preview.selectedIds.some((id, i) => id !== effective[i]));

  const open = (a: BulkAction) => { setAction(a); invalidate(); setOutcome(null); };
  const build = () => { if (action) { setPreview(previewBulk(states, effective, action, role, reason)); setError(null); } };
  const confirm = () => {
    if (!preview) return;
    const r = bulk(preview);
    if (!r.ok) { setError(r.error); return; }
    setOutcome(r.value); setPreview(null); setAction(null); setReason(""); setPicked(new Set()); setError(null);
  };

  return (
    <div className="space-y-4">
      <section data-testid="panel-bulk" className="sticky top-2 z-10 rounded-md border-2 border-ink bg-card shadow-[4px_4px_0_0_var(--color-ink)]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ochre">Bulk review</p>
            <p className="display text-xl" data-testid="text-bulk-count"><span className="num">{effective.length}</span> selected <span className="text-muted">|</span> <span className="num" data-testid="text-bulk-total">{formatCad(total)}</span></p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button data-testid="button-bulk-approve" disabled={!effective.length} onClick={() => open("approve")} className={`rounded px-3 py-1.5 text-sm font-semibold transition-transform active:scale-[.98] disabled:opacity-40 ${action === "approve" ? "bg-verdigris text-paper" : "border border-verdigris text-verdigris hover:bg-verdigris-soft"}`}>Review bulk approve</button>
            <button data-testid="button-bulk-reject" disabled={!effective.length} onClick={() => open("reject")} className={`rounded px-3 py-1.5 text-sm font-semibold transition-transform active:scale-[.98] disabled:opacity-40 ${action === "reject" ? "bg-oxblood text-paper" : "border border-oxblood text-oxblood hover:bg-oxblood-soft"}`}>Review bulk reject</button>
            <button data-testid="button-bulk-clear" disabled={!picked.size} onClick={() => { setPicked(new Set()); setAction(null); invalidate(); }} className="rounded border border-rule px-3 py-1.5 text-sm disabled:opacity-40">Clear</button>
          </div>
        </div>
        {hidden.length > 0 && (
          <div data-testid="text-bulk-hidden" className="flex flex-wrap items-center gap-2 border-t border-rule bg-ochre-soft px-4 py-2 text-xs">
            <span><strong>{hidden.length}</strong> selected invoice{hidden.length === 1 ? " is" : "s are"} hidden by the current {scope === "queue" ? "queue filter" : "search or status filter"} ({hidden.join(", ")}) and will not be included.</span>
            <button data-testid="button-bulk-clear-hidden" onClick={() => setPicked(new Set(effective))} className="font-semibold underline">Drop hidden</button>
          </div>
        )}

        {action && (
          <div className="space-y-3 border-t-2 border-ink px-4 py-4" data-testid="panel-bulk-review">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[260px] flex-1 text-sm">
                <span className="text-[11px] uppercase tracking-wider text-muted">Reason for bulk {action} (required, recorded on every event)</span>
                <input data-testid="input-bulk-reason" className={`${inputCls} mt-1 w-full`} value={reason} onChange={(e) => { setReason(e.target.value); invalidate(); }} placeholder={action === "reject" ? "e.g. Missing field ticket" : "e.g. Rates match contract"} />
              </label>
              <button data-testid="button-bulk-preview" onClick={build} className="rounded bg-ink px-3 py-1.5 text-sm font-semibold text-paper">Build preview</button>
              <button data-testid="button-bulk-cancel" onClick={() => { setAction(null); invalidate(); }} className="rounded border border-rule px-3 py-1.5 text-sm">Cancel</button>
            </div>

            {preview && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span data-testid="text-preview-eligible"><strong className="num text-verdigris">{preview.eligible.length}</strong> will be {action === "approve" ? "approved" : "rejected"} ({formatCad(preview.eligibleTotalCents)})</span>
                  <span data-testid="text-preview-skipped"><strong className="num text-oxblood">{preview.ineligible.length}</strong> skipped, shown below</span>
                  {preview.duplicateIds.length > 0 && <span data-testid="text-preview-duplicates">Duplicate selections counted once: {preview.duplicateIds.join(", ")}</span>}
                  <span className="text-muted">as <strong className="text-ink">{preview.role}</strong></span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-wider text-muted"><tr className="border-b border-ink"><th className="py-1.5 pr-3">Outcome</th><th className="pr-3">Invoice</th><th className="pr-3 text-right">Amount</th><th className="pr-3">Now</th><th className="pr-3">After</th><th>Why</th></tr></thead>
                    <tbody>
                      {preview.lines.map((l) => (
                        <tr key={l.invoiceId} data-testid={`row-preview-${l.invoiceId}`} className={`border-b border-rule/70 align-top ${l.eligible ? "" : "bg-oxblood-soft/40"}`}>
                          <td className="py-2 pr-3"><span data-testid={`status-preview-${l.invoiceId}`} className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${l.eligible ? "bg-verdigris text-paper" : "border border-oxblood text-oxblood"}`}>{l.eligible ? "Eligible" : "Skipped"}</span></td>
                          <td className="py-2 pr-3"><Link href={`/invoices/${l.invoiceId}`} className="num underline underline-offset-4">{l.invoiceId}</Link></td>
                          <td className="num py-2 pr-3 text-right">{formatCad(l.amountCents)}</td>
                          <td className="py-2 pr-3 text-xs">{where(l.fromStatus, l.fromStage)}</td>
                          <td className="py-2 pr-3 text-xs">{l.eligible ? where(l.toStatus, l.toStage) : "unchanged"}</td>
                          <td className="py-2 text-xs" data-testid={`text-preview-why-${l.invoiceId}`}>{l.why}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.blockers.length > 0 && <ErrorBox testId="status-bulk-blockers" message={preview.blockers.join(" ")} />}
                {(stale || selectionDrift) && (
                  <div data-testid="status-bulk-stale" className="rounded border border-ochre bg-ochre-soft px-3 py-2 text-sm">
                    {stale ? "This preview is stale: an invoice in it changed (another tab, a decision, or the role). " : "Your selection changed since this preview. "}
                    Rebuild the preview before confirming.
                  </div>
                )}
                <button data-testid="button-bulk-confirm" onClick={confirm} disabled={preview.blockers.length > 0 || stale || selectionDrift}
                  className={`rounded px-4 py-2 text-sm font-semibold text-paper transition-transform active:scale-[.98] disabled:opacity-40 ${action === "approve" ? "bg-verdigris" : "bg-oxblood"}`}>
                  Confirm: write {preview.eligible.length} event{preview.eligible.length === 1 ? "" : "s"}, skip {preview.ineligible.length}
                </button>
              </div>
            )}
            {error && <ErrorBox testId="status-bulk-error" message={error} />}
          </div>
        )}

        {outcome && (
          <div data-testid="status-bulk-result" className="space-y-2 border-t-2 border-ink px-4 py-3 text-sm">
            <p><strong className="text-verdigris">{outcome.applied.length} event{outcome.applied.length === 1 ? "" : "s"} written</strong> in one save, batch <span className="num text-xs">{outcome.batchId.slice(0, 14)}</span>.
              {" "}<strong className="text-oxblood">{outcome.skipped.length} skipped</strong>, nothing written for them.</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {outcome.applied.map((e) => <li key={e.id} className="num text-xs">#{e.seq} {e.invoiceId}: {where(e.fromStatus, e.fromStage)} to {where(e.toStatus, e.toStage)}</li>)}
              {outcome.skipped.map((l) => <li key={l.invoiceId} className="text-xs text-oxblood"><span className="num">{l.invoiceId}</span> skipped: {l.why}</li>)}
            </ul>
            <button data-testid="button-bulk-dismiss" onClick={() => setOutcome(null)} className="text-xs font-semibold underline">Dismiss</button>
          </div>
        )}
      </section>
      {children(selection)}
    </div>
  );
}
