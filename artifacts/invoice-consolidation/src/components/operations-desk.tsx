import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryParams } from "@/components/ops/query-state";
import { InvoiceDetail } from "@/components/ops/invoice-detail";
import { BudgetView } from "@/components/ops/budget-view";
import { InvoiceList } from "@/components/ops/invoice-list";
import { ActivityView } from "@/components/ops/activity-view";
import { useBatch } from "@/components/ops/batch";
import { makeFeat, experienceOf, VIEW_FEATURE, VIEW_LABEL, PageHead, Unavailable, type View, type Feat } from "@/components/ops/shared";
import { allowedActions } from "../../../approval-desk/src/domain/ledger.ts";
import { duplicateIndex } from "../../../invoice-finder/src/domain/duplicates.ts";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { loadRecipe, storageKey, type Recipe, type CapabilityId, type SourceId } from "@/domain/recipe";
import { states, invoiceRows, readLedger, saveLedger, afes, pars, spendState, type DecisionEvent, type Role, type LineCategory } from "@/domain/engine";
import { rollupPar } from "../../../spend-tracker/src/domain/model.ts";

const SOURCE_LABEL: Record<SourceId, string> = { "invoice-finder": "Invoice Finder", "approval-desk": "Approval Desk", "spend-tracker": "Spend Tracker" };
const CAP_LABEL: Record<CapabilityId, string> = { "fuzzy-search": "Fuzzy search", "bulk-decisions": "Bulk decisions", "spend-tracing": "Spend tracing" };
const CAP_SOURCE: Record<CapabilityId, string> = { "fuzzy-search": "invoice-finder/src/domain/search.ts", "bulk-decisions": "approval-desk/src/domain/bulk.ts", "spend-tracing": "spend-tracker/src/domain/lines.ts" };
const VIEWS: View[] = ["invoices", "queue", "budgets", "activity"];

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
      <div className="grid min-h-[100dvh] lg:grid-cols-[15rem_1fr]" aria-busy="true" aria-label="Loading recipe">
        <div className="hidden space-y-3 border-r border-border p-5 lg:block">{[0, 1, 2, 3].map(i => <div key={i} className="h-8 animate-pulse bg-muted" />)}</div>
        <div className="space-y-4 px-6 py-10"><div className="h-10 w-72 animate-pulse bg-muted" /><div className="h-4 w-96 animate-pulse bg-muted" /><div className="h-80 animate-pulse bg-muted/70" /></div>
      </div>
    </Shell>
  );
  return <Shell><Workspace recipe={recipe} /></Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] bg-background text-foreground">{children}</div>;
}

function Workspace({ recipe }: { recipe: Recipe }) {
  const feat = useMemo(() => makeFeat(recipe), [recipe]);
  const [ledger, setLedger] = useState<readonly DecisionEvent[]>([]);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showProv, setShowProv] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [role, setRole] = useState<Role>("reviewer");
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [qp, setQ] = useQueryParams();

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
  const reset = () => {
    try {
      localStorage.removeItem(storageKey(recipe)); setLedger([]); setStoreError(null); setConfirmReset(false); setSelected([]);
      setNotice("Snapshot reset to synthetic seed. Original apps were not touched.");
    } catch (e) { setStoreError(`Reset failed: ${e instanceof Error ? e.message : String(e)}`); setConfirmReset(false); }
  };
  const undo = () => {
    let fresh: readonly DecisionEvent[];
    try { fresh = readLedger(recipe, localStorage); } catch (e) { setStoreError(e instanceof Error ? e.message : String(e)); return; }
    if (!fresh.length) return;
    const last = fresh[fresh.length - 1];
    const next = last.batchId ? fresh.filter(e => e.batchId !== last.batchId) : fresh.slice(0, -1);
    commit(next, last.batchId ? `Undid batch ${last.batchId} (${fresh.length - next.length} events).` : `Undid event ${last.id}.`);
  };

  const batch = useBatch({ recipe, ledger, role, reason, commit, onError: setStoreError, onDone: () => { setSelected([]); setReason(""); } });

  // Legacy deep link: ?trace=X&cat=Y becomes Budgets > X > Cost lines.
  useEffect(() => {
    const t = qp.get("trace");
    if (t !== null) setQ({ trace: null, view: "budgets", budget: t === "portfolio" ? null : t, lens: "lines" });
  }, [qp, setQ]);

  const home: View = (() => {
    const e = experienceOf(recipe);
    const pref: View = e === "review-led" ? "queue" : e === "budget-led" ? "budgets" : "invoices";
    return feat(VIEW_FEATURE[pref]) ? pref : "invoices";
  })();
  const rawView = qp.get("view") ?? (qp.get("budget") ? "budgets" : "");
  const view: View = (VIEWS as string[]).includes(rawView) ? rawView as View : home;
  const viewBlocked = !feat(VIEW_FEATURE[view]);
  const detailId = qp.get("inv") ?? "";
  const go = (v: View) => setQ({ view: v === home ? null : v, inv: null, ev: null }, true);
  const goHome = () => setQ({ view: null, inv: null, ev: null, budget: null, lens: null, cat: null }, true);
  const openInvoice = (id: string, ev?: string) => { setQ({ inv: id, ev: ev && feat("decision-history") ? ev : null }, true); window.scrollTo({ top: 0 }); };

  useEffect(() => {
    const ev = qp.get("ev");
    if (detailId && ev) setTimeout(() => document.getElementById(`ev-${ev}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  }, [detailId, qp]);

  const counts = useMemo(() => {
    try {
      const st = states(ledger);
      const queue = role === "viewer" ? 0 : [...st.values()].filter(s => allowedActions(s, role).some(a => a !== "pay")).length;
      let over = 0;
      if (feat("budget-positions")) { const s = spendState(ledger); over = pars.filter(p => rollupPar(s, p.id).projectedRemaining < 0).length; }
      return { invoices: st.size, queue, over };
    } catch { return { invoices: 0, queue: 0, over: 0 }; }
  }, [ledger, role, feat]);

  const dupes = useMemo(() => {
    if (!feat("duplicate-warnings")) return null;
    try { return duplicateIndex(invoiceRows(ledger)); } catch { return null; }
  }, [ledger, feat]);

  const caseId = qp.get("consolidationCaseId");
  const decide = feat("bulk-actions");

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="border-b border-border bg-card/60 lg:sticky lg:top-0 lg:h-[100dvh] lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col gap-6 p-5">
          <div>
            <button onClick={goHome} className="text-left">
              <span className="font-display block text-2xl leading-none">Invoice Operations</span>
            </button>
            <p className="mt-2 flex items-center gap-2"><span className="num rounded-sm border border-accent px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-accent">Synthetic</span><span className="num truncate text-[10px] text-muted-foreground" title={recipe.snapshotId}>{recipe.snapshotId}</span></p>
          </div>
          <nav aria-label="Destinations" className="flex gap-1 overflow-x-auto lg:flex-col">
            {VIEWS.filter(v => feat(VIEW_FEATURE[v])).map(v => {
              const on = view === v;
              const badge = v === "invoices" ? counts.invoices : v === "queue" ? counts.queue : v === "budgets" ? (counts.over || null) : ledger.length || null;
              return (
                <button key={v} data-testid={`nav-${v}`} onClick={() => go(v)} aria-current={on && !detailId ? "page" : undefined}
                  className={`group flex shrink-0 items-center justify-between gap-3 border-l-2 px-3 py-2 text-left text-sm transition-colors ${on ? "border-accent bg-background font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  <span>{VIEW_LABEL[v]}{v === home && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">home</span>}</span>
                  {badge !== null && <span className={`num text-[11px] ${v === "budgets" ? "text-destructive" : ""}`} title={v === "budgets" ? "PARs projected over budget" : undefined}>{badge}</span>}
                </button>
              );
            })}
          </nav>
          {(decide || feat("review-queue")) && (
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Acting role</p>
              <div className="grid grid-cols-3 border border-input bg-background text-xs" role="radiogroup" aria-label="Acting role">
                {(["viewer", "reviewer", "controller"] as Role[]).map(r => <button key={r} role="radio" aria-checked={role === r} onClick={() => setRole(r)} className={`py-1.5 capitalize ${role === r ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{r}</button>)}
              </div>
            </div>
          )}
          <div className="mt-auto hidden space-y-1.5 text-xs lg:block">
            {caseId && <>
              <a data-testid="link-workbench-wiring" href={`/workbench/${encodeURIComponent(caseId)}#wiring`} className="block text-muted-foreground hover:text-foreground">View wiring in Workbench</a>
              <a data-testid="link-workbench-overlap" href={`/workbench/${encodeURIComponent(caseId)}#invoice-overlap`} className="block text-muted-foreground hover:text-foreground">Compare source overlap</a>
            </>}
            <button onClick={() => setShowProv(v => !v)} className="block text-muted-foreground hover:text-foreground">{showProv ? "Hide" : "Show"} provenance</button>
            <button data-testid="button-reset-snapshot" onClick={() => setConfirmReset(true)} className="block text-destructive hover:underline">Reset snapshot</button>
          </div>
          <div className="flex flex-wrap gap-3 text-xs lg:hidden">
            {caseId && <a href={`/workbench/${encodeURIComponent(caseId)}#wiring`} className="underline">Wiring</a>}
            <button onClick={() => setShowProv(v => !v)} className="underline">Provenance</button>
            <button onClick={() => setConfirmReset(true)} className="text-destructive underline">Reset</button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 px-5 pb-24 pt-8 md:px-10">
        <div className="mx-auto max-w-6xl">
          <p className="mb-6 border-l-2 border-accent pl-3 text-xs text-muted-foreground">This combined configuration is a proposal, not proof that any original app can be retired. Original implementations remain independent. Development and maintenance effort: not measured.</p>

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
              <div className="flex gap-2"><button onClick={reload} className="underline">Retry read</button><button onClick={() => setConfirmReset(true)} className="underline">Reset snapshot</button></div>
            </div>
          )}
          {notice && <div className="rise mb-6 flex justify-between gap-3 border-l-2 border-accent bg-card px-4 py-2 text-sm"><span>{notice}</span><button onClick={() => setNotice(null)} className="text-muted-foreground">Dismiss</button></div>}

          {!storeError && (detailId ? (
            <InvoiceDetail id={detailId} originLabel={viewBlocked ? "Invoices" : VIEW_LABEL[view]} ledger={ledger} feat={feat} role={role} reason={reason} setReason={setReason}
              dupes={dupes} highlight={feat("decision-history") ? qp.get("ev") ?? "" : ""}
              onBack={() => setQ({ inv: null, ev: null }, true)} onOpen={id => openInvoice(id)}
              onBudget={s => setQ({ view: "budgets", budget: s, lens: null, cat: null, inv: null, ev: null }, true)}
              onTrace={(s, c) => setQ({ view: "budgets", budget: s, lens: "lines", cat: c, inv: null, ev: null }, true)}
              onDecide={batch.open} />
          ) : viewBlocked ? <Unavailable what={VIEW_LABEL[view]} onHome={goHome} />
            : <Destination view={view} recipe={recipe} ledger={ledger} feat={feat} role={role} reason={reason} setReason={setReason} qp={qp} setQ={setQ}
              openInvoice={openInvoice} dupes={dupes} openBatch={batch.open} selected={selected} setSelected={setSelected} onUndo={undo} goHome={goHome} />)}
        </div>
      </main>

      {batch.dialog}
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent className="max-w-md rounded-none border-foreground/30 bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Reset this snapshot?</DialogTitle>
            <DialogDescription>All {ledger.length} recorded decisions in this browser for this recipe will be discarded and invoices return to the synthetic seed. This cannot be undone. Original apps are not touched.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button onClick={() => setConfirmReset(false)} className="border border-border px-4 py-2 text-sm">Cancel</button>
            <button data-testid="button-confirm-reset" onClick={reset} className="bg-destructive px-4 py-2 text-sm text-destructive-foreground">Reset snapshot</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Destination({ view, recipe, ledger, feat, role, reason, setReason, qp, setQ, openInvoice, dupes, openBatch, selected, setSelected, onUndo, goHome }: {
  view: View; recipe: Recipe; ledger: readonly DecisionEvent[]; feat: Feat; role: Role; reason: string; setReason: (s: string) => void;
  qp: URLSearchParams; setQ: (p: Record<string, string | null>, push?: boolean) => void; openInvoice: (id: string, ev?: string) => void;
  dupes: Map<string, string[]> | null; openBatch: (ids: string[], a: "approve" | "reject") => void;
  selected: string[]; setSelected: (f: (s: string[]) => string[]) => void; onUndo: () => void; goHome: () => void;
}) {
  if (view === "invoices" || view === "queue") return (
    <>
      <PageHead kicker={view === "queue" ? `Waiting on ${role}` : "Register"} title={VIEW_LABEL[view]}
        note={view === "queue" ? "Invoices the acting role can approve or reject right now. Change the role in the rail to see the other stage." : "Every invoice in the snapshot. Open a row for its full context and decision."} />
      <InvoiceList mode={view} recipe={recipe} ledger={ledger} feat={feat} role={role} reason={reason} setReason={setReason} qp={qp} setQ={setQ}
        openInvoice={id => openInvoice(id)} dupes={dupes} openBatch={openBatch} selected={selected} setSelected={setSelected} />
    </>
  );
  if (view === "budgets") {
    const scope = qp.get("budget") || "portfolio";
    const tracing = feat("spend-tracing");
    const lensParam = qp.get("lens") === "lines" ? "lines" : "positions";
    if (lensParam === "lines" && !tracing) return <Unavailable what="Spend tracing" onHome={goHome} />;
    const cat = (["materials", "labour"].includes(qp.get("cat") ?? "") ? qp.get("cat") : "") as LineCategory | "";
    const name = afes.find(a => a.id === scope)?.name ?? pars.find(p => p.id === scope)?.name;
    return (
      <>
        <PageHead kicker={scope === "portfolio" ? "Portfolio" : scope} title={name ?? "Budgets"} note="Rollups reconcile against invoice rows; drill from portfolio to AFE to PAR to invoice." />
        <BudgetView recipe={recipe} ledger={ledger} scope={scope} tracing={tracing}
          setScope={s => setQ({ budget: s === "portfolio" ? null : s }, true)}
          lens={lensParam} setLens={l => setQ({ lens: l === "lines" ? "lines" : null }, true)}
          cat={cat} setCat={c => setQ({ cat: c || null })} onOpen={id => openInvoice(id)} />
      </>
    );
  }
  return (
    <>
      <PageHead kicker="Decision ledger" title="Activity" note="Newest first, grouped by batch. Timestamps open the event inside the invoice history." />
      <ActivityView ledger={ledger} onOpen={openInvoice} onUndo={onUndo} canUndo={feat("bulk-actions") && ledger.length > 0} />
    </>
  );
}
