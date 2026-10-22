import { formatCad } from "../domain/money.ts";
import { explainReason } from "../domain/fuzzy.ts";
import type { RankedResult } from "../domain/search.ts";
import type { AppState } from "../domain/types.ts";
import { StatusChip } from "./StatusChip.tsx";

interface Props {
  state: AppState; results: RankedResult[]; selectedId: string | null; onSelect: (id: string) => void;
  dupIndex: Map<string, string[]>; exclusions: { label: string; excluded: number }[]; hasText: boolean;
}

export function ResultsTable({ state, results, selectedId, onSelect, dupIndex, exclusions, hasText }: Props) {
  const sup = new Map(state.suppliers.map((s) => [s.id, s.name]));
  const total = results.reduce((n, r) => n + r.invoice.cents, 0);
  const exactCount = results.filter((r) => r.match?.tier === "exact").length;
  return (
    <section className="results" aria-label="Results">
      <div className="results-head">
        <h2><span data-testid="text-result-count">{results.length}</span> of {state.invoices.length} invoices</h2>
        <span className="mono muted" data-testid="text-result-total">{formatCad(total)} matched</span>
      </div>
      {hasText && results.length > 0 && (
        <p className="tier-summary small" data-testid="text-tier-summary">
          <b>{exactCount}</b> exact, <b>{results.length - exactCount}</b> approximate. Ranked exact first.
        </p>
      )}
      {exclusions.length > 0 && (
        <div className="predicates" data-testid="list-predicates">
          {exclusions.map((p) => (
            <span key={p.label} className="pred mono" title="Invoices this filter excludes on its own">
              {p.label} <b>-{p.excluded}</b>
            </span>
          ))}
        </div>
      )}
      {results.length === 0 ? (
        <div className="empty" data-testid="empty-results">
          <p className="empty-title">Nothing passes every filter.</p>
          <p>Fuzzy search only bends for small typos in words of 4+ letters, so nonsense finds nothing. Filters compose with AND; the chips above show how many invoices each removes on its own.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Supplier</th><th>Invoice no.</th>{hasText && <th>Why it matched</th>}<th>Date</th><th className="num">Amount</th><th>AFE / PAR</th><th>Status</th></tr></thead>
            <tbody>
              {results.map(({ invoice: i, match }) => {
                const dups = dupIndex.get(i.id);
                return (
                  <tr key={i.id} data-testid={`row-invoice-${i.id}`} className={i.id === selectedId ? "sel" : ""}
                    tabIndex={0} onClick={() => onSelect(i.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i.id); } }}>
                    <td className="mono">{i.id}{dups && <span className="dup-flag" title={`Strict duplicate (same supplier + normalized number) of ${dups.join(", ")}`}>DUP</span>}</td>
                    <td>{sup.get(i.supplierId)}</td>
                    <td className="mono">{i.invoiceNumber}</td>
                    {hasText && (
                      <td className="why" data-testid={`text-why-${i.id}`}>
                        {match && (
                          <>
                            <span className={`tier tier-${match.tier}`}>{match.tier === "exact" ? "Exact" : "Close"}</span>
                            <ul>{match.reasons.map((r, k) => <li key={k} className={`r-${r.kind}`}>{explainReason(r)}</li>)}</ul>
                          </>
                        )}
                      </td>
                    )}
                    <td className="mono">{i.date}</td>
                    <td className="mono num">{formatCad(i.cents)}</td>
                    <td className="mono small">{i.afeId} / {i.parId}</td>
                    <td><StatusChip status={i.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {hasText && <p className="muted small fine">Close invoice-number matches are search suggestions only. DUP flags mean a strict duplicate: same supplier and identical normalized number.</p>}
    </section>
  );
}
