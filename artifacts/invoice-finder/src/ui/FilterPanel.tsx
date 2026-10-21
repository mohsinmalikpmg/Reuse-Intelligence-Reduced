import { useState } from "react";
import { parseDollarsToCents } from "../domain/money.ts";
import { STATUSES } from "../domain/types.ts";
import type { AppState, Status } from "../domain/types.ts";
import type { SearchCriteria } from "../domain/search.ts";
import { EMPTY_CRITERIA } from "../domain/search.ts";

interface Props { state: AppState; criteria: SearchCriteria; onChange: (c: SearchCriteria) => void; errors: string[] }

export function FilterPanel({ state, criteria: c, onChange, errors }: Props) {
  const [minText, setMinText] = useState(c.minCents === null ? "" : String(c.minCents / 100));
  const [maxText, setMaxText] = useState(c.maxCents === null ? "" : String(c.maxCents / 100));
  const set = (patch: Partial<SearchCriteria>) => onChange({ ...c, ...patch });
  const minParsed = parseDollarsToCents(minText);
  const maxParsed = parseDollarsToCents(maxText);
  const toggleStatus = (s: Status) =>
    set({ statuses: c.statuses.includes(s) ? c.statuses.filter((x) => x !== s) : [...c.statuses, s] });
  const parsForAfe = state.pars.filter((p) => !c.afeId || p.afeId === c.afeId);

  return (
    <aside className="filters" aria-label="Structured filters">
      <p className="muted small filters-note">Every filter is AND-ed with the search box. Fuzzy matching never loosens these.</p>
      <div className="filters-head">
        <h2>Structured filters</h2>
        <button className="link-btn" data-testid="button-clear-filters"
          onClick={() => { setMinText(""); setMaxText(""); onChange({ ...EMPTY_CRITERIA, text: c.text, mode: c.mode }); }}>Clear filters</button>
      </div>
      <label className="field">
        <span>Supplier</span>
        <select data-testid="select-supplier" value={c.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
          <option value="">Any supplier</option>
          {state.suppliers.map((s) => <option key={s.id} value={s.id}>{s.id} - {s.name}</option>)}
        </select>
      </label>
      <div className="pair">
        <label className="field"><span>Date from</span>
          <input type="date" data-testid="input-date-from" value={c.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} /></label>
        <label className="field"><span>Date to</span>
          <input type="date" data-testid="input-date-to" value={c.dateTo} onChange={(e) => set({ dateTo: e.target.value })} /></label>
      </div>
      <div className="pair">
        <label className="field"><span>Min CAD</span>
          <input inputMode="decimal" data-testid="input-min" value={minText} placeholder="0.00"
            aria-invalid={Number.isNaN(minParsed)}
            onChange={(e) => { setMinText(e.target.value); const v = parseDollarsToCents(e.target.value); if (!Number.isNaN(v)) set({ minCents: v }); }} /></label>
        <label className="field"><span>Max CAD</span>
          <input inputMode="decimal" data-testid="input-max" value={maxText} placeholder="any"
            aria-invalid={Number.isNaN(maxParsed)}
            onChange={(e) => { setMaxText(e.target.value); const v = parseDollarsToCents(e.target.value); if (!Number.isNaN(v)) set({ maxCents: v }); }} /></label>
      </div>
      {(Number.isNaN(minParsed) || Number.isNaN(maxParsed)) && (
        <p className="field-err" data-testid="error-amount">Amounts must be dollars like 10000 or 10,000.50. Last valid value still applies.</p>
      )}
      <fieldset className="field">
        <legend>Status</legend>
        <div className="status-toggles">
          {STATUSES.map((s) => (
            <button key={s} data-testid={`toggle-status-${s}`} aria-pressed={c.statuses.includes(s)}
              className={`toggle chip-${s}`} onClick={() => toggleStatus(s)}>{s}</button>
          ))}
        </div>
      </fieldset>
      <label className="field">
        <span>AFE</span>
        <select data-testid="select-afe" value={c.afeId}
          onChange={(e) => {
            const afeId = e.target.value;
            const parOk = !c.parId || state.pars.find((p) => p.id === c.parId)?.afeId === afeId || !afeId;
            set({ afeId, parId: parOk ? c.parId : "" });
          }}>
          <option value="">Any AFE</option>
          {state.afes.map((a) => <option key={a.id} value={a.id}>{a.id} {a.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>PAR</span>
        <select data-testid="select-par" value={c.parId} onChange={(e) => set({ parId: e.target.value })}>
          <option value="">Any PAR</option>
          {parsForAfe.map((p) => <option key={p.id} value={p.id}>{p.id} {p.name}</option>)}
        </select>
      </label>
      {errors.map((e) => <p key={e} className="field-err" data-testid="error-criteria">{e}</p>)}
    </aside>
  );
}
