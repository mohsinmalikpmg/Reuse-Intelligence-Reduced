import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { loadRecipe, storageKey, type Recipe, type CapabilityId, type SourceId } from "@/domain/recipe";
import {
  EMPTY_CRITERIA, suppliers, afes, pars, states, invoiceRows, search, preview, apply, trace, readLedger, saveLedger,
  type SearchCriteria, type DecisionEvent, type Role, type BulkAction, type BulkPreview, type Scope, type LineCategory,
} from "@/domain/engine";

const cad = (c: number) => (c / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name ?? id;
const SOURCE_LABEL: Record<SourceId, string> = { "invoice-finder": "Invoice Finder", "approval-desk": "Approval Desk", "spend-tracker": "Spend Tracker" };
const CAP_LABEL: Record<CapabilityId, string> = { "fuzzy-search": "Fuzzy search", "bulk-decisions": "Bulk decisions", "spend-tracing": "Spend tracing" };
const CAP_SOURCE: Record<CapabilityId, string> = { "fuzzy-search": "invoice-finder/src/domain/search.ts", "bulk-decisions": "approval-desk/src/domain/bulk.ts", "spend-tracing": "spend-tracker/src/domain/lines.ts" };
const STATUS_TONE: Record<string, string> = {
  pending: "bg-[hsl(40_70%_88%)] text-[hsl(32_60%_28%)] dark:bg-[hsl(38_35%_18%)] dark:text-[hsl(40_75%_72%)]", approved: "bg-[hsl(158_30%_86%)] text-[hsl(158_40%_22%)] dark:bg-[hsl(158_25%_16%)] dark:text-[hsl(158_45%_66%)]",
  rejected: "bg-[hsl(2_60%_90%)] text-[hsl(2_60%_34%)] dark:bg-[hsl(2_35%_18%)] dark:text-[hsl(2_70%_72%)]", paid: "bg-[hsl(222_40%_88%)] text-[hsl(222_52%_24%)] dark:bg-[hsl(222_30%_20%)] dark:text-[hsl(220_60%_78%)]",
};

function Pill({ status }: { status: string }) {
  return <span className={`inline-block rounded-sm px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider ${STATUS_TONE[status] ?? "bg-muted"}`}>{status}</span>;
}
function Section({ n, title, note, children }: { n: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="rise border-t border-foreground/80 pt-5">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="num text-xs text-accent">{n}</span>
        <h2 className="font-display text-2xl">{title}</h2>
        <p className="text-sm text-muted-foreground">{note}</p>
      </div>
      {children}
    </section>
  );
}

export default function OperationsDesk() {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setRecipe(null); setLoadError(null);
    loadRecipe(window.location.search, import.meta.env.BASE_URL)
      .then(r => { if (live) setRecipe(r); })
      .catch(e => { if (live) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [attempt]);

  if (loadError) return (
    <Shell>
      <div className="rise mx-auto mt-24 max-w-lg border border-destructive/40 bg-card p-8">
        <p className="num text-xs uppercase tracking-widest text-destructive">Recipe not loaded</p>
        <h1 className="font-display mt-2 text-3xl">This snapshot could not be opened.</h1>
        <p className="mt-3 text-sm text-muted-foreground">{loadError}</p>
        <button onClick={() => setAttempt(a => a + 1)} className="mt-6 bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90">Retry</button>
      </div>
    </Shell>
  );
  if (!recipe) return (
    <Shell>
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-10" aria-busy="true" aria-label="Loading recipe">
        <div className="h-10 w-72 animate-pulse bg-muted" />
        <div className="h-4 w-96 animate-pulse bg-muted" />
        {[0, 1, 2].map(i => <div key={i} className="h-40 animate-pulse bg-muted/70" />)}
      </div>
    </Shell>
  );
  return <Shell><Workspace recipe={recipe} /></Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] bg-background text-foreground">{children}</div>;
}

function Workspace({ recipe }: { recipe: Recipe }) {
  const has = (c: CapabilityId) => recipe.capabilities.includes(c);
  const [ledger, setLedger] = useState<readonly DecisionEvent[]>([]);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showProv, setShowProv] = useState(false);

  const reload = useCallback(() => {
    try { setLedger(readLedger(recipe, localStorage)); setStoreError(null); }
    catch (e) { setStoreError(e instanceof Error ? e.message : String(e)); }
  }, [recipe]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const key = storageKey(recipe);
    const on = (e: StorageEvent) => { if (e.key === key) reload(); };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, [recipe, reload]);

  const commit = (next: readonly DecisionEvent[], msg: string) => {
    try { saveLedger(recipe, next, localStorage); setLedger(next); setNotice(msg); }
    catch (e) { setStoreError(e instanceof Error ? e.message : String(e)); }
  };
  const reset = () => { localStorage.removeItem(storageKey(recipe)); setLedger([]); setStoreError(null); setNotice("Snapshot reset to synthetic seed. Original apps were not touched."); };
  const undo = () => {
    let fresh: readonly DecisionEvent[];
    try { fresh = readLedger(recipe, localStorage); } catch (e) { setStoreError(e instanceof Error ? e.message : String(e)); return; }
    if (!fresh.length) return;
    const last = fresh[fresh.length - 1];
    const next = last.batchId ? fresh.filter(e => e.batchId !== last.batchId) : fresh.slice(0, -1);
    commit(next, last.batchId ? `Undid batch ${last.batchId} (${fresh.length - next.length} events).` : `Undid event ${last.id}.`);
  };

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-8 md:px-8">
      <header className="rise mb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="num rounded-sm border border-accent px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-accent">Synthetic data</span>
            <span className="num text-[11px] text-muted-foreground">{recipe.snapshotId}</span>
          </div>
          <h1 className="font-display mt-3 text-4xl md:text-5xl">Invoice Operations</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">Find invoices, decide them in batches, and trace project cost back to source lines. One isolated ledger, three original domain engines.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {new URLSearchParams(window.location.search).get("consolidationCaseId") && (
            <>
              <a data-testid="link-workbench-wiring" href={`/workbench/${encodeURIComponent(new URLSearchParams(window.location.search).get("consolidationCaseId")!)}#wiring`} className="border border-border bg-card px-3 py-1.5 hover:border-foreground/40">View wiring in Workbench</a>
              <a data-testid="link-workbench-overlap" href={`/workbench/${encodeURIComponent(new URLSearchParams(window.location.search).get("consolidationCaseId")!)}#invoice-overlap`} className="border border-border bg-card px-3 py-1.5 hover:border-foreground/40">Compare source overlap</a>
            </>
          )}
          <button onClick={() => setShowProv(v => !v)} className="border border-border bg-card px-3 py-1.5 hover:border-foreground/40">{showProv ? "Hide" : "Show"} provenance</button>
          <button onClick={undo} disabled={!ledger.length || !has("bulk-decisions")} className="border border-border bg-card px-3 py-1.5 hover:border-foreground/40 disabled:opacity-40">Undo last</button>
          <button onClick={reset} className="border border-destructive/40 bg-card px-3 py-1.5 text-destructive hover:bg-destructive/5">Reset snapshot</button>
        </div>
      </header>
      <p className="mb-6 border-l-2 border-accent pl-3 text-sm text-muted-foreground">
        This combined configuration is a proposal, not proof that any original app can be retired.
        Original implementations remain independent. Development and maintenance effort: not measured.
      </p>

      {showProv && (
        <div className="rise mb-8 grid gap-px border border-border bg-border text-sm md:grid-cols-3">
          {recipe.sources.map(s => (
            <div key={s} className="bg-card p-4">
              <p className="font-medium">{SOURCE_LABEL[s]}{s === recipe.baseSourceId && <span className="num ml-2 text-[10px] uppercase text-accent">base</span>}</p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {recipe.capabilities.filter(c => CAP_SOURCE[c].startsWith(s)).map(c => <li key={c}><span className="text-foreground">{CAP_LABEL[c]}</span> <span className="num">{CAP_SOURCE[c]}</span></li>)}
                {!recipe.capabilities.some(c => CAP_SOURCE[c].startsWith(s)) && <li>Data only, no capability enabled.</li>}
              </ul>
            </div>
          ))}
          <div className="bg-card p-4 text-xs text-muted-foreground md:col-span-3">
            Ledger key <span className="num break-all text-foreground">{storageKey(recipe).slice(0, 72)}...</span> &middot; {ledger.length} events &middot; stored in this browser only.
          </div>
        </div>
      )}

      {storeError && (
        <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <span className="text-destructive">{storeError}</span>
          <div className="flex gap-2"><button onClick={reload} className="underline">Retry read</button><button onClick={reset} className="underline">Reset snapshot</button></div>
        </div>
      )}
      {notice && <div className="rise mb-6 flex justify-between border-l-2 border-accent bg-card px-4 py-2 text-sm"><span>{notice}</span><button onClick={() => setNotice(null)} className="text-muted-foreground">Dismiss</button></div>}

      {!storeError && <Body recipe={recipe} ledger={ledger} commit={commit} onError={setStoreError} has={has} />}
    </div>
  );
}

function Body({ recipe, ledger, commit, onError, has }: { recipe: Recipe; ledger: readonly DecisionEvent[]; commit: (l: readonly DecisionEvent[], m: string) => void; onError: (m: string) => void; has: (c: CapabilityId) => boolean }) {
  const [criteria, setCriteria] = useState<SearchCriteria>(EMPTY_CRITERIA);
  const [selected, setSelected] = useState<string[]>([]);
  const stateMap = useMemo(() => states(ledger), [ledger]);

  const results = useMemo(() => {
    if (!has("fuzzy-search")) return { rows: invoiceRows(ledger).map(invoice => ({ invoice, match: null as null | { tier: string; score: number } })), error: null as string | null };
    try { return { rows: search(recipe, ledger, criteria), error: null }; }
    catch (e) { return { rows: [], error: e instanceof Error ? e.message : String(e) }; }
  }, [recipe, ledger, criteria, has]);

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const visibleIds = results.rows.map(r => r.invoice.id);
  const allOn = visibleIds.length > 0 && visibleIds.every(id => selected.includes(id));

  return (
    <div className="space-y-12">
      <Section n="01" title="Find" note={has("fuzzy-search") ? "Ranked fuzzy or exact match across number, supplier and ID." : "Search not in this recipe; full register shown."}>
        {has("fuzzy-search") && (
          <div className="mb-4 grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr]">
            <input value={criteria.text} onChange={e => setCriteria({ ...criteria, text: e.target.value })} placeholder="Invoice number, supplier, or ID - try 'Boreal Partz'" className="border border-input bg-card px-3 py-2 text-sm outline-none focus:border-accent" />
            <select value={criteria.mode} onChange={e => setCriteria({ ...criteria, mode: e.target.value as SearchCriteria["mode"] })} className="border border-input bg-card px-2 py-2 text-sm">
              <option value="fuzzy">Fuzzy</option><option value="exact">Exact</option>
            </select>
            <select value={criteria.supplierId} onChange={e => setCriteria({ ...criteria, supplierId: e.target.value })} className="border border-input bg-card px-2 py-2 text-sm">
              <option value="">Any supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={criteria.afeId} onChange={e => setCriteria({ ...criteria, afeId: e.target.value, parId: "" })} className="border border-input bg-card px-2 py-2 text-sm">
              <option value="">Any project</option>{afes.map(a => <option key={a.id} value={a.id}>{a.id} {a.name}</option>)}
            </select>
            <div className="flex flex-wrap gap-1.5 md:col-span-4">
              {(["pending", "approved", "rejected", "paid"] as const).map(s => {
                const on = criteria.statuses.includes(s);
                return <button key={s} onClick={() => setCriteria({ ...criteria, statuses: on ? criteria.statuses.filter(x => x !== s) : [...criteria.statuses, s] })} className={`border px-2.5 py-1 text-xs capitalize ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>{s}</button>;
              })}
              {criteria !== EMPTY_CRITERIA && <button onClick={() => setCriteria(EMPTY_CRITERIA)} className="px-2 text-xs text-muted-foreground underline">Clear</button>}
            </div>
          </div>
        )}
        {results.error ? (
          <p role="alert" className="border border-destructive/40 p-3 text-sm text-destructive">{results.error}</p>
        ) : results.rows.length === 0 ? (
          <div className="border border-dashed border-border p-10 text-center"><p className="font-display text-xl">No invoices match.</p><p className="mt-1 text-sm text-muted-foreground">Loosen a filter or switch to fuzzy mode.</p></div>
        ) : (
          <div className="overflow-x-auto border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  {has("bulk-decisions") && <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Select all visible" checked={allOn} onChange={() => setSelected(allOn ? selected.filter(id => !visibleIds.includes(id)) : [...new Set([...selected, ...visibleIds])])} /></th>}
                  <th className="px-3 py-2">ID</th><th className="px-3 py-2">Number</th><th className="px-3 py-2">Supplier</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">AFE / PAR</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Stage</th>{has("fuzzy-search") && <th className="px-3 py-2">Match</th>}
                </tr>
              </thead>
              <tbody>
                {results.rows.map(({ invoice: i, match }) => (
                  <tr key={i.id} className={`border-b border-border/60 last:border-0 ${selected.includes(i.id) ? "bg-accent/5" : "hover:bg-muted/50"}`}>
                    {has("bulk-decisions") && <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${i.id}`} checked={selected.includes(i.id)} onChange={() => toggle(i.id)} /></td>}
                    <td className="num px-3 py-2 text-xs">{i.id}</td>
                    <td className="num px-3 py-2">{i.invoiceNumber}</td>
                    <td className="px-3 py-2">{supplierName(i.supplierId)}</td>
                    <td className="num px-3 py-2 text-xs">{i.date}</td>
                    <td className="num px-3 py-2 text-xs text-muted-foreground">{i.afeId} / {i.parId}</td>
                    <td className="num px-3 py-2 text-right">{cad(i.cents)}</td>
                    <td className="px-3 py-2"><Pill status={i.status} /></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{stateMap.get(i.id)?.stage ?? "-"}</td>
                    {has("fuzzy-search") && <td className="num px-3 py-2 text-[11px] text-muted-foreground">{match ? `${match.tier} ${match.score.toFixed(2)}` : "-"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Invoice numbers can repeat (I1 and I2 share one); rows are keyed by immutable scenario ID.</p>
      </Section>

      {has("bulk-decisions") && <Decide recipe={recipe} ledger={ledger} selected={selected} clear={() => setSelected([])} commit={commit} onError={onError} />}
      {has("spend-tracing") && <Trace recipe={recipe} ledger={ledger} />}
      {ledger.length > 0 && <LedgerLog ledger={ledger} />}
    </div>
  );
}

function Decide({ recipe, ledger, selected, clear, commit, onError }: { recipe: Recipe; ledger: readonly DecisionEvent[]; selected: string[]; clear: () => void; commit: (l: readonly DecisionEvent[], m: string) => void; onError: (m: string) => void }) {
  const [role, setRole] = useState<Role>("reviewer");
  const [reason, setReason] = useState("");
  const [pv, setPv] = useState<BulkPreview | null>(null);
  const [applyErr, setApplyErr] = useState<string | null>(null);

  const open = (action: BulkAction) => {
    setApplyErr(null);
    try { setPv(preview(recipe, ledger, selected, action, role, reason)); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  const confirm = () => {
    if (!pv) return;
    try {
      const fresh = readLedger(recipe, localStorage);
      const batchId = `B${Date.now().toString(36).toUpperCase()}`;
      const out = apply(recipe, fresh, pv, batchId, new Date().toISOString());
      commit(out.ledger, `Batch ${batchId}: ${out.applied.length} ${pv.action === "reject" ? "rejected" : "approved"}, ${out.skipped.length} skipped.`);
      setPv(null); clear(); setReason("");
    } catch (e) { setApplyErr(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <Section n="02" title="Decide" note="Preview first. Storage is re-read and re-validated before anything is written.">
      <div className="grid gap-3 md:grid-cols-[auto_1fr_auto_auto] md:items-center">
        <div className="flex border border-input bg-card text-sm">
          {(["viewer", "reviewer", "controller"] as Role[]).map(r => <button key={r} onClick={() => setRole(r)} className={`px-3 py-2 capitalize ${role === r ? "bg-primary text-primary-foreground" : ""}`}>{r}</button>)}
        </div>
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason recorded on every event" className="border border-input bg-card px-3 py-2 text-sm outline-none focus:border-accent" />
        <button disabled={!selected.length} onClick={() => open("approve")} className="bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40">Preview approve ({selected.length})</button>
        <button disabled={!selected.length} onClick={() => open("reject")} className="border border-destructive px-4 py-2 text-sm text-destructive disabled:opacity-40">Preview reject</button>
      </div>
      {!selected.length && <p className="mt-2 text-xs text-muted-foreground">Select invoices in Find to build a batch. Amounts above $10,000 require reviewer then controller stage.</p>}

      <Dialog open={!!pv} onOpenChange={o => { if (!o) setPv(null); }}>
        <DialogContent className="max-w-2xl rounded-none border-foreground/30 bg-card">
          {pv && <>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl capitalize">{pv.action} batch preview</DialogTitle>
              <DialogDescription>As <b className="capitalize">{pv.role}</b>. {pv.eligible.length} eligible ({cad(pv.eligibleTotalCents)}) of {pv.lines.length} selected ({cad(pv.selectedTotalCents)}).</DialogDescription>
            </DialogHeader>
            <div className="max-h-72 overflow-y-auto border border-border text-sm">
              {pv.lines.map((l, k) => (
                <div key={`${l.invoiceId}-${k}`} className={`grid grid-cols-[3rem_1fr_auto] gap-3 border-b border-border/60 px-3 py-2 last:border-0 ${l.eligible ? "" : "opacity-70"}`}>
                  <span className="num text-xs">{l.invoiceId}</span>
                  <span><span className={l.eligible ? "text-[hsl(158_40%_28%)]" : "text-destructive"}>{l.eligible ? "Will apply" : "Skipped"}</span> <span className="text-muted-foreground">- {l.why}</span>
                    {l.eligible && <span className="num block text-[11px] text-muted-foreground">{l.fromStatus}/{l.fromStage ?? "-"} &rarr; {l.toStatus}/{l.toStage ?? "-"}</span>}</span>
                  <span className="num text-xs">{cad(l.amountCents)}</span>
                </div>
              ))}
            </div>
            {pv.duplicateIds.length > 0 && <p className="text-xs text-muted-foreground">Duplicates ignored: {pv.duplicateIds.join(", ")}</p>}
            {pv.blockers.map(b => <p key={b} className="text-sm text-destructive">{b}</p>)}
            {applyErr && <p role="alert" className="border border-destructive/40 p-2 text-sm text-destructive">{applyErr} Close and preview again.</p>}
            <DialogFooter>
              <button onClick={() => setPv(null)} className="border border-border px-4 py-2 text-sm">Cancel</button>
              <button onClick={confirm} disabled={pv.blockers.length > 0 || !!applyErr} className="bg-accent px-4 py-2 text-sm text-accent-foreground disabled:opacity-40">Apply {pv.eligible.length} decisions</button>
            </DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function Trace({ recipe, ledger }: { recipe: Recipe; ledger: readonly DecisionEvent[] }) {
  const [scopeKey, setScopeKey] = useState("portfolio");
  const [cat, setCat] = useState<LineCategory | "">("");
  const scope: Scope = scopeKey === "portfolio" ? { level: "portfolio" } : scopeKey.startsWith("AFE") ? { level: "afe", id: scopeKey } : { level: "par", id: scopeKey };
  const data = useMemo(() => {
    try { return { t: trace(recipe, ledger, scope, cat || undefined), error: null }; }
    catch (e) { return { t: null, error: e instanceof Error ? e.message : String(e) }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, ledger, scopeKey, cat]);
  const buckets = ["pending", "approvedUnpaid", "paid", "rejected"] as const;
  const bucketLabel = { pending: "Pending", approvedUnpaid: "Approved unpaid", paid: "Paid", rejected: "Rejected" };

  return (
    <Section n="03" title="Trace" note="Cost lines grouped by category, reconciled against invoice-level totals.">
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={scopeKey} onChange={e => setScopeKey(e.target.value)} className="border border-input bg-card px-2 py-2 text-sm">
          <option value="portfolio">All projects</option>
          {afes.map(a => <optgroup key={a.id} label={`${a.id} ${a.name}`}><option value={a.id}>{a.id} {a.name} (whole AFE)</option>{pars.filter(p => p.afeId === a.id).map(p => <option key={p.id} value={p.id}>{p.id} {p.name}</option>)}</optgroup>)}
        </select>
        {(["", "materials", "labour"] as const).map(c => <button key={c} onClick={() => setCat(c)} className={`border px-3 py-1.5 text-sm ${cat === c ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>{c || "All lines"}</button>)}
      </div>
      {data.error || !data.t ? <p role="alert" className="border border-destructive/40 p-3 text-sm text-destructive">{data.error}</p> : (
        <div className="grid gap-6 md:grid-cols-[1fr_1.4fr]">
          <div className="border border-border bg-card">
            <div className={`flex items-center justify-between px-4 py-3 ${data.t.summary.reconciles ? "bg-[hsl(158_30%_90%)] dark:bg-[hsl(158_25%_14%)]" : "bg-destructive/10"}`}>
              <span className="text-sm font-medium">{data.t.summary.reconciles ? "Reconciles" : "Does not reconcile"}</span>
              <span className="num text-xs">{data.t.summary.total.lineCount} lines / {data.t.summary.total.invoiceIds.length} invoices</span>
            </div>
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-2 text-left">Bucket</th><th className="px-2 py-2 text-right">Materials</th><th className="px-2 py-2 text-right">Labour</th><th className="px-2 py-2 text-right">Lines</th><th className="px-4 py-2 text-right">Invoices</th></tr></thead>
              <tbody className="num text-xs">
                {buckets.map(b => <tr key={b} className="border-t border-border/60"><td className="px-4 py-2 font-sans text-sm">{bucketLabel[b]}</td><td className="px-2 text-right">{cad(data.t!.summary.groups.materials[b])}</td><td className="px-2 text-right">{cad(data.t!.summary.groups.labour[b])}</td><td className="px-2 text-right">{cad(data.t!.summary.total[b])}</td><td className="px-4 text-right">{cad(data.t!.summary.invoiceTotals[b])}</td></tr>)}
                <tr className="border-t border-foreground/60 font-medium"><td className="px-4 py-2 font-sans text-sm">Committed</td><td className="px-2 text-right">{cad(data.t.summary.groups.materials.committed)}</td><td className="px-2 text-right">{cad(data.t.summary.groups.labour.committed)}</td><td className="px-2 text-right">{cad(data.t.summary.total.committed)}</td><td className="px-4 text-right">{cad(data.t.summary.invoiceTotals.committed)}</td></tr>
              </tbody>
            </table>
            {data.t.summary.differences.map(d => <p key={d} className="border-t border-border px-4 py-2 text-xs text-destructive">{d}</p>)}
          </div>
          <div className="max-h-[26rem] overflow-y-auto border border-border bg-card text-sm">
            {data.t.lines.length === 0 ? <p className="p-6 text-center text-muted-foreground">No lines in this scope.</p> : data.t.lines.map(l => (
              <div key={l.line.id} className="grid grid-cols-[3.5rem_1fr_auto] gap-3 border-b border-border/60 px-4 py-2.5 last:border-0">
                <span className="num text-xs text-muted-foreground">{l.line.id}</span>
                <span><span className="block">{l.line.description}</span><span className="text-xs text-muted-foreground">{l.supplierName} &middot; {l.invoice.number} &middot; {l.invoice.parId}</span></span>
                <span className="text-right"><span className="num block text-xs">{cad(l.line.cents)}</span><Pill status={l.status} /></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function LedgerLog({ ledger }: { ledger: readonly DecisionEvent[] }) {
  return (
    <Section n="04" title="Ledger" note="Isolated to this recipe snapshot. Append-only; undo removes the last batch.">
      <ol className="border border-border bg-card text-xs">
        {[...ledger].reverse().map(e => (
          <li key={e.id} className="grid grid-cols-[2.5rem_3rem_1fr_auto] gap-3 border-b border-border/60 px-4 py-2 last:border-0 md:grid-cols-[2.5rem_3rem_7rem_1fr_auto]">
            <span className="num text-muted-foreground">#{e.seq}</span>
            <span className="num">{e.invoiceId}</span>
            <span className="hidden capitalize md:block">{e.action} by {e.role}</span>
            <span className="num">{e.fromStatus}/{e.fromStage ?? "-"} &rarr; {e.toStatus}/{e.toStage ?? "-"} <span className="font-sans text-muted-foreground">{e.reason}</span></span>
            <span className="num text-muted-foreground">{e.batchId ?? ""}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}
