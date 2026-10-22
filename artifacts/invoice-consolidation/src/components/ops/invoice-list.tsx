import { useEffect, useMemo, useState } from "react";
import { allowedActions } from "../../../../approval-desk/src/domain/ledger.ts";
import { parseDollarsToCents } from "../../../../invoice-finder/src/domain/money.ts";
import { EMPTY_CRITERIA, suppliers, afes, pars, invoiceRows, search, type SearchCriteria, type DecisionEvent, type Role, type BulkAction, states } from "@/domain/engine";
import type { Recipe } from "@/domain/recipe";
import { FILTER_KEYS } from "./query-state";
import { cad, supplierName, Pill, segBtn, type Feat } from "./shared";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function toCents(v: string, label: string, errs: string[]): number | null {
  if (!v) return null;
  const c = parseDollarsToCents(v);
  if (c === null) return null;
  if (Number.isNaN(c)) { errs.push(`${label} "${v}" is not a dollar amount (digits, optional commas, at most two decimals).`); return null; }
  if (!Number.isSafeInteger(c)) { errs.push(`${label} is too large.`); return null; }
  return c;
}

export function InvoiceList({ mode, recipe, ledger, feat, role, reason, setReason, qp, setQ, openInvoice, dupes, openBatch, selected, setSelected }: {
  mode: "invoices" | "queue"; recipe: Recipe; ledger: readonly DecisionEvent[]; feat: Feat; role: Role;
  reason: string; setReason: (s: string) => void;
  qp: URLSearchParams; setQ: (p: Record<string, string | null>, push?: boolean) => void;
  openInvoice: (id: string) => void; dupes: Map<string, string[]> | null;
  openBatch: (ids: string[], a: BulkAction) => void; selected: string[]; setSelected: (f: (s: string[]) => string[]) => void;
}) {
  const g = (k: string) => qp.get(k) ?? "";
  const qs = qp.toString();
  const fuzzy = feat("fuzzy-matching"), structured = feat("structured-filters");
  const textOn = (fuzzy || structured) && recipe.capabilities.includes("fuzzy-search");
  const bulk = feat("bulk-actions");
  const stageOn = feat("review-queue");
  const stateMap = useMemo(() => states(ledger), [ledger]);
  const stageQ = (stageOn ? g("stage") : "") as "" | "reviewer" | "controller" | "none";

  const { criteria, filterErrors, ignored } = useMemo(() => {
    const p = new URLSearchParams(qs); const errs: string[] = []; const ign: string[] = [];
    const get = (k: string) => p.get(k) ?? "";
    let c: SearchCriteria = { ...EMPTY_CRITERIA };
    if (textOn) c = { ...c, text: get("q"), mode: fuzzy && get("mode") !== "exact" ? "fuzzy" : "exact" };
    else if (get("q")) ign.push("search text");
    if (!fuzzy && get("mode") === "fuzzy") ign.push("fuzzy matching");
    if (structured) {
      const from = get("from"), to = get("to");
      if (from && !ISO.test(from)) errs.push("From date must be YYYY-MM-DD.");
      if (to && !ISO.test(to)) errs.push("To date must be YYYY-MM-DD.");
      if (from && to && ISO.test(from) && ISO.test(to) && from > to) errs.push("From date is after To date.");
      const minCents = toCents(get("min"), "Minimum", errs), maxCents = toCents(get("max"), "Maximum", errs);
      if (minCents !== null && maxCents !== null && minCents > maxCents) errs.push("Minimum is above maximum.");
      const statuses = get("st").split(",").filter((s): s is SearchCriteria["statuses"][number] => ["pending", "approved", "rejected", "paid"].includes(s));
      c = { ...c, supplierId: get("sup"), afeId: get("afe"), parId: get("par"), statuses, dateFrom: ISO.test(from) ? from : "", dateTo: ISO.test(to) ? to : "", minCents, maxCents };
    } else if (["sup", "afe", "par", "st", "from", "to", "min", "max"].some(k => get(k))) ign.push("structured filters");
    return { criteria: c, filterErrors: errs, ignored: ign };
  }, [qs, textOn, fuzzy, structured]);

  const results = useMemo(() => {
    try {
      const active = textOn || structured;
      let rows = !active
        ? invoiceRows(ledger).map(invoice => ({ invoice, match: null as null | { tier: string; score: number } }))
        : filterErrors.length ? [] : search(recipe, ledger, criteria);
      if (stageQ) rows = rows.filter(r => (stateMap.get(r.invoice.id)?.stage ?? "none") === stageQ);
      if (mode === "queue") rows = rows.filter(r => { const s = stateMap.get(r.invoice.id); return !!s && allowedActions(s, role).some(a => a !== "pay"); });
      return { rows, error: filterErrors.length ? filterErrors.join(" ") : null };
    } catch (e) { return { rows: [], error: e instanceof Error ? e.message : String(e) }; }
  }, [recipe, ledger, criteria, filterErrors, textOn, structured, stageQ, mode, role, stateMap]);

  const visibleIds = results.rows.map(r => r.invoice.id);
  const visibleKey = visibleIds.join(",");
  useEffect(() => {
    const vis = new Set(visibleKey ? visibleKey.split(",") : []);
    setSelected(s => { const n = s.filter(id => vis.has(id)); return n.length === s.length ? s : n; });
  }, [visibleKey, setSelected]);

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const allOn = visibleIds.length > 0 && visibleIds.every(id => selected.includes(id));
  const anyFilter = FILTER_KEYS.some(k => qp.get(k));
  const resetFilters = () => setQ(Object.fromEntries(FILTER_KEYS.map(k => [k, null])));
  const [moreOpen, setMoreOpen] = useState(() => ["from", "to", "min", "max"].some(k => qp.get(k)));
  const inputCls = "border border-input bg-card px-2 py-2 text-sm outline-none focus:border-accent";
  const selTotal = results.rows.filter(r => selected.includes(r.invoice.id)).reduce((s, r) => s + r.invoice.cents, 0);
  const queueEmpty = mode === "queue" && role === "viewer";

  return (
    <div className={bulk ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]" : ""}>
      <div className="min-w-0">
        {(textOn || structured || stageOn) && (
          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              {textOn && <input data-testid="input-search" value={g("q")} onChange={e => setQ({ q: e.target.value })} placeholder={fuzzy ? "Number, supplier, or ID - try 'Boreal Partz'" : "Exact number, supplier, or ID"} className={`${inputCls} min-w-[14rem] flex-1 px-3`} />}
              {textOn && fuzzy && (
                <div className="flex" role="group" aria-label="Match mode">
                  {(["fuzzy", "exact"] as const).map(m => <button key={m} onClick={() => setQ({ mode: m === "exact" ? "exact" : null })} className={segBtn(criteria.mode === m)}>{m}</button>)}
                </div>
              )}
              {structured && <>
                <select aria-label="Supplier" value={g("sup")} onChange={e => setQ({ sup: e.target.value })} className={inputCls}>
                  <option value="">Any supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select aria-label="AFE" value={g("afe")} onChange={e => setQ({ afe: e.target.value, par: null })} className={inputCls}>
                  <option value="">Any AFE</option>{afes.map(a => <option key={a.id} value={a.id}>{a.id} {a.name}</option>)}
                </select>
                <select aria-label="PAR" value={g("par")} onChange={e => setQ({ par: e.target.value })} className={inputCls}>
                  <option value="">Any PAR</option>{pars.filter(p => !g("afe") || p.afeId === g("afe")).map(p => <option key={p.id} value={p.id}>{p.id} {p.name}</option>)}
                </select>
                <button onClick={() => setMoreOpen(v => !v)} className="border border-border bg-card px-3 text-xs hover:border-foreground/40">{moreOpen ? "Fewer" : "Dates and amounts"}</button>
              </>}
            </div>
            {structured && moreOpen && (
              <div className="rise grid gap-2 sm:grid-cols-4">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">From<input type="date" aria-label="From date (inclusive)" value={g("from")} onChange={e => setQ({ from: e.target.value })} className={`${inputCls} flex-1`} /></label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">To<input type="date" aria-label="To date (inclusive)" value={g("to")} onChange={e => setQ({ to: e.target.value })} className={`${inputCls} flex-1`} /></label>
                <input inputMode="decimal" aria-label="Minimum amount CAD (inclusive)" placeholder="Min $" value={g("min")} onChange={e => setQ({ min: e.target.value.trim() })} className={inputCls} />
                <input inputMode="decimal" aria-label="Maximum amount CAD (inclusive)" placeholder="Max $" value={g("max")} onChange={e => setQ({ max: e.target.value.trim() })} className={inputCls} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {structured && <>
                <span className="mr-1 text-muted-foreground">Status</span>
                {(["pending", "approved", "rejected", "paid"] as const).map(s => {
                  const on = criteria.statuses.includes(s);
                  return <button key={s} onClick={() => setQ({ st: (on ? criteria.statuses.filter(x => x !== s) : [...criteria.statuses, s]).join(",") })} className={segBtn(on)}>{s}</button>;
                })}
              </>}
              {stageOn && <>
                <span className={`mr-1 text-muted-foreground ${structured ? "ml-3" : ""}`}>Stage</span>
                {(["", "reviewer", "controller", "none"] as const).map(s => <button key={s || "any"} onClick={() => setQ({ stage: s })} className={segBtn(stageQ === s)}>{s || "Any"}</button>)}
              </>}
              {anyFilter && <button data-testid="button-reset-filters" onClick={resetFilters} className="ml-auto px-2 underline">Reset all filters</button>}
            </div>
          </div>
        )}
        {ignored.length > 0 && <p className="mb-3 border-l-2 border-accent pl-3 text-xs text-muted-foreground">This link carried {ignored.join(" and ")}, which this recipe leaves out. Those parameters were ignored.</p>}

        <div className="mb-2 flex items-baseline justify-between text-xs text-muted-foreground">
          <span><span className="num text-foreground">{results.rows.length}</span> {mode === "queue" ? `awaiting ${role}` : "invoices"}</span>
          {bulk && results.rows.length > 0 && !queueEmpty && <span>{selected.length ? `${selected.length} selected` : "Select rows to stage a batch"}</span>}
        </div>

        {queueEmpty ? (
          <div className="border border-dashed border-border p-10 text-center"><p className="font-display text-xl">Viewers have no queue.</p><p className="mt-1 text-sm text-muted-foreground">Switch the acting role to reviewer or controller in the rail to see what is waiting on that stage.</p></div>
        ) : results.error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border border-destructive/40 p-3 text-sm text-destructive"><span>{results.error}</span><button onClick={resetFilters} className="underline">Reset filters</button></div>
        ) : results.rows.length === 0 ? (
          <div className="border border-dashed border-border p-10 text-center">
            <p className="font-display text-xl">{mode === "queue" ? "Queue is clear." : "No invoices match."}</p>
            <p className="mt-1 text-sm text-muted-foreground">{mode === "queue" ? `Nothing currently needs a ${role} decision${anyFilter ? " under these filters" : ""}.` : "Ranges are inclusive. Loosen a filter" + (fuzzy ? " or switch to fuzzy mode." : ".")}</p>
            {anyFilter && <button onClick={resetFilters} className="mt-3 text-sm underline">Reset all filters</button>}
          </div>
        ) : (
          <div className="overflow-x-auto border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  {bulk && <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Select all visible" checked={allOn} onChange={() => setSelected(s => allOn ? s.filter(id => !visibleIds.includes(id)) : [...new Set([...s, ...visibleIds])])} /></th>}
                  <th className="px-3 py-2">ID</th><th className="px-3 py-2">Number</th><th className="px-3 py-2">Supplier</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">AFE / PAR</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Stage</th>{fuzzy && textOn && <th className="px-3 py-2">Match</th>}
                </tr>
              </thead>
              <tbody>
                {results.rows.map(({ invoice: i, match }) => (
                  <tr key={i.id} onClick={e => { if ((e.target as HTMLElement).closest("button,input")) return; openInvoice(i.id); }} className={`cursor-pointer border-b border-border/60 last:border-0 ${selected.includes(i.id) ? "bg-accent/10" : "hover:bg-muted/50"}`}>
                    {bulk && <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${i.id}`} checked={selected.includes(i.id)} onChange={() => toggle(i.id)} /></td>}
                    <td className="num px-3 py-2 text-xs"><button data-testid={`link-invoice-${i.id}`} onClick={() => openInvoice(i.id)} className="underline decoration-accent underline-offset-2">{i.id}</button></td>
                    <td className="num px-3 py-2">{i.invoiceNumber}
                      {dupes?.has(i.id) && <span data-testid={`badge-duplicate-${i.id}`} title={`Same supplier and normalized number as ${dupes.get(i.id)!.join(", ")} across the full ledger`} className="ml-2 inline-block border border-destructive/50 px-1 text-[10px] uppercase tracking-wider text-destructive">Dup {dupes.get(i.id)!.join(",")}</span>}</td>
                    <td className="px-3 py-2">{supplierName(i.supplierId)}</td>
                    <td className="num px-3 py-2 text-xs">{i.date}</td>
                    <td className="num px-3 py-2 text-xs text-muted-foreground">{i.afeId} / {i.parId}</td>
                    <td className="num px-3 py-2 text-right">{cad(i.cents)}</td>
                    <td className="px-3 py-2"><Pill status={i.status} /></td>
                    <td className="px-3 py-2 text-xs capitalize text-muted-foreground">{stateMap.get(i.id)?.stage ?? "-"}</td>
                    {fuzzy && textOn && <td className="num px-3 py-2 text-[11px] text-muted-foreground">{match ? `${match.tier} ${match.score.toFixed(2)}` : "-"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Rows are keyed by immutable scenario ID; invoice numbers can repeat.{dupes ? " Dup badges come from the full ledger regardless of filters (same supplier and normalized number). They warn only; nothing is merged and both amounts count in every total." : ""} Filter state lives in the URL.</p>
      </div>

      {bulk && (
        <aside aria-label="Selection" className="lg:sticky lg:top-6 lg:self-start">
          <div className={`border bg-card transition-colors ${selected.length ? "border-foreground/70" : "border-border"}`}>
            <div className="border-b border-border px-4 py-3">
              <p className="num text-[11px] uppercase tracking-widest text-accent">Staged batch</p>
              <p className="font-display mt-1 text-2xl"><span className="num">{selected.length}</span> <span className="text-base text-muted-foreground">selected</span></p>
              <p className="num text-xs text-muted-foreground">{cad(selTotal)}</p>
            </div>
            <div className="space-y-3 px-4 py-3 text-sm">
              <p className="text-xs text-muted-foreground">Acting as <b className="capitalize text-foreground">{role}</b>. Change role in the rail.</p>
              <label className="block text-xs text-muted-foreground">Reason recorded on every event
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className="mt-1 block w-full resize-none border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
              </label>
              <button data-testid="button-preview-approve" disabled={!selected.length} onClick={() => openBatch(selected, "approve")} className="w-full bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40">Preview approve</button>
              <button data-testid="button-preview-reject" disabled={!selected.length} onClick={() => openBatch(selected, "reject")} className="w-full border border-destructive px-3 py-2 text-sm text-destructive disabled:opacity-40">Preview reject</button>
              {selected.length > 0 && <button onClick={() => setSelected(() => [])} className="w-full text-xs underline">Clear selection</button>}
              <p className="text-[11px] text-muted-foreground">Nothing is written until you confirm the preview. Amounts above $10,000 need reviewer then controller.</p>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
