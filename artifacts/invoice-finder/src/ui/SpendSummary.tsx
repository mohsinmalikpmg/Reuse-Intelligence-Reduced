import { formatCad } from "../domain/money.ts";
import { spendByAfe, spendOverall } from "../domain/spend.ts";
import type { SpendTotals } from "../domain/spend.ts";
import type { AppState } from "../domain/types.ts";

const COLS: { key: keyof SpendTotals; label: string }[] = [
  { key: "budget", label: "Budget" },
  { key: "pending", label: "Pending" },
  { key: "approvedUnpaid", label: "Approved unpaid" },
  { key: "paid", label: "Paid" },
  { key: "rejected", label: "Rejected (excluded)" },
  { key: "committed", label: "Committed" },
  { key: "remaining", label: "Remaining" },
  { key: "projectedRemaining", label: "Projected after pending" },
];

function Row({ label, t, id }: { label: string; t: SpendTotals; id: string }) {
  return (
    <tr data-testid={`row-spend-${id}`}>
      <th scope="row">{label}</th>
      {COLS.map((c) => (
        <td key={c.key} className={`mono num ${t[c.key] < 0 ? "neg" : ""}`} data-testid={`text-spend-${id}-${c.key}`}>{formatCad(t[c.key])}</td>
      ))}
    </tr>
  );
}

export function SpendSummary({ state }: { state: AppState }) {
  const all = spendOverall(state.invoices, state.afes);
  return (
    <details className="spend" aria-label="Spend summary" data-testid="details-spend">
      <summary className="spend-summary-toggle">Reference: spend position by AFE (secondary, not this app's focus)</summary>
      <div className="spend-head">
        <p className="muted small">All invoices, unaffected by filters. Committed = approved unpaid + paid. Paid is not counted again as approved. Rejected is excluded.</p>
      </div>
      <div className="table-wrap">
        <table className="spend-table">
          <thead><tr><th>Scope</th>{COLS.map((c) => <th key={c.key} className="num">{c.label}</th>)}</tr></thead>
          <tbody>
            {spendByAfe(state.invoices, state.afes).map(({ afe, totals }) => (
              <Row key={afe.id} id={afe.id} label={`${afe.id} ${afe.name}`} t={totals} />
            ))}
            <Row id="all" label="All AFEs" t={all} />
          </tbody>
        </table>
      </div>
    </details>
  );
}
