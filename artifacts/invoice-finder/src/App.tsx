import { useEffect, useMemo, useState } from "react";
import { duplicateIndex } from "./domain/duplicates.ts";
import { compileCriteria, predicateExclusions, rankedSearch } from "./domain/search.ts";
import { applyDecision } from "./domain/workflow.ts";
import type { DecisionAction, Role } from "./domain/types.ts";
import { useStore } from "./ui/useStore.ts";
import { criteriaFromUrl, criteriaToUrl } from "./ui/criteriaUrl.ts";
import { FilterPanel } from "./ui/FilterPanel.tsx";
import { ResultsTable } from "./ui/ResultsTable.tsx";
import { InvoiceDetail } from "./ui/InvoiceDetail.tsx";
import { SpendSummary } from "./ui/SpendSummary.tsx";
import { SearchHero } from "./ui/SearchHero.tsx";
import { ResetDialog } from "./ui/ResetDialog.tsx";

const initial = criteriaFromUrl(window.location.search);

export default function App() {
  const store = useStore();
  const [criteria, setCriteria] = useState(initial.criteria);
  const [selected, setSelected] = useState<string | null>(initial.selected);
  const [role, setRole] = useState<Role>("reviewer");
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => { window.history.replaceState(null, "", criteriaToUrl(criteria, selected)); }, [criteria, selected]);

  const s = store.state;
  const results = useMemo(() => (s ? rankedSearch(s.invoices, s.suppliers, criteria) : []), [s, criteria]);
  const exclusions = useMemo(() => (s ? predicateExclusions(s.invoices, s.suppliers, criteria) : []), [s, criteria]);
  const dupIdx = useMemo(() => (s ? duplicateIndex(s.invoices) : new Map<string, string[]>()), [s]);
  const errors = compileCriteria(criteria).errors;

  const decide = (id: string, a: DecisionAction, reason: string): string | null => {
    if (!s) return "No data loaded.";
    const r = applyDecision(s, id, a, role, reason, new Date().toISOString());
    if (!r.ok) return r.error;
    return store.commit(r.value) ? null : "Decision not saved: browser storage write failed.";
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden><circle cx="14" cy="14" r="8" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M20 20l7 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
          <div>
            <h1>Invoice Finder</h1>
            <p className="tag">Source A. Find the bill even when you misspell it.</p>
          </div>
        </div>
        <div className="top-controls">
          <label className="role">
            <span>Demo role</span>
            <select data-testid="select-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="reviewer">Reviewer</option>
              <option value="viewer">Viewer (read-only)</option>
            </select>
          </label>
          <button className="btn btn-ghost" data-testid="button-reset" onClick={() => setConfirmReset(true)}>Reset demo data</button>
        </div>
      </header>
      <div className="demo-banner" data-testid="text-demo-banner">
        Synthetic single-browser demo. Data lives only in this browser's localStorage. The role switch is a demo control, not authentication; no enterprise authorization, approvals or payments occur. Not official company software or branding.
      </div>

      {store.externalUpdateAt && <div className="notice" data-testid="text-external-update">Updated from another tab at {store.externalUpdateAt}.</div>}
      {store.saveError && <div className="alert" role="alert" data-testid="error-save">{store.saveError}</div>}

      {store.loadError ? (
        <div className="fatal" role="alert" data-testid="error-load">
          <h2>Stored data could not be loaded</h2>
          <p className="mono small">{store.loadError}</p>
          <p>Nothing was overwritten. Inspect the localStorage key, or reset to the synthetic fixture explicitly.</p>
          <button className="btn btn-reject" data-testid="button-reset-from-error" onClick={() => setConfirmReset(true)}>Reset to fixture...</button>
        </div>
      ) : !s ? (
        <div className="skeleton" data-testid="loading"><div /><div /><div /></div>
      ) : (
        <>
          <SearchHero criteria={criteria} onChange={setCriteria} />
          <main className="workspace">
            <FilterPanel state={s} criteria={criteria} onChange={setCriteria} errors={errors} />
            <ResultsTable state={s} results={results} selectedId={selected} onSelect={setSelected} dupIndex={dupIdx} exclusions={exclusions} hasText={criteria.text.trim() !== ""} />
            <InvoiceDetail state={s} invoiceId={selected} role={role} visibleIds={new Set(results.map((r) => r.invoice.id))}
              onSelect={setSelected} onDecide={decide} />
          </main>
          <SpendSummary state={s} />
        </>
      )}
      <footer className="foot muted small">Synthetic invoice scenario v1. All money in CAD, stored as integer cents. No tax or FX.</footer>
      {confirmReset && <ResetDialog onCancel={() => setConfirmReset(false)} onConfirm={() => { store.reset(); setConfirmReset(false); }} />}
    </div>
  );
}
