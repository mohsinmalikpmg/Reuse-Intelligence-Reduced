import { useState } from "react";
import { Link, Route, Router, Switch, useLocation } from "wouter";
import type { Role } from "./domain/ledger.ts";
import { useLedger, useRole } from "./store.ts";
import { AboutPage, AllInvoicesPage, DetailPage, HistoryPage, QueuePage, SpendPage } from "./pages.tsx";
import { ErrorBox } from "./ui.tsx";

const NAV = [["/", "Queue"], ["/invoices", "All invoices"], ["/history", "Ledger"], ["/spend", "Spend"], ["/about", "Demo and reset"]] as const;

function Shell() {
  const { view, syncedAt, notice, clearNotice, refresh, decide, bulk, reset } = useLedger();
  const [role, setRole] = useRole();
  const [loc] = useLocation();
  const [confirmReset, setConfirmReset] = useState(false);
  const active = (h: string) => (h === "/" ? loc === "/" : loc.startsWith(h));

  return (
    <div className="min-h-[100dvh]">
      <div className="bg-ink px-4 py-1.5 text-center text-xs text-paper" data-testid="text-demo-banner">
        Single-browser demo with synthetic data. Role selector is a simulation, not authentication. No real approvals or payments.
      </div>
      <header className="border-b border-rule bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" data-testid="link-home" className="flex items-baseline gap-2">
            <span className="display text-2xl">Approval Desk</span>
            <span className="stamp px-1.5 text-[9px] font-bold uppercase text-ochre">synthetic</span>
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map(([h, l]) => (
              <Link key={h} href={h} data-testid={`link-nav-${l.split(" ")[0].toLowerCase()}`} className={`rounded px-2.5 py-1 ${active(h) ? "bg-ink text-paper" : "text-muted hover:bg-ochre-soft hover:text-ink"}`}>{l}</Link>
            ))}
          </nav>
          <label className="ml-auto flex items-center gap-2 text-xs">
            <span className="uppercase tracking-wider text-muted">Simulated role</span>
            <select data-testid="select-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded border border-ink bg-paper px-2 py-1 text-sm font-semibold">
              <option value="viewer">Viewer (read only)</option>
              <option value="reviewer">Reviewer</option>
              <option value="controller">Controller</option>
            </select>
          </label>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        {notice && (
          <div data-testid="status-sync" className="flex items-center justify-between rounded border border-ochre bg-ochre-soft px-3 py-2 text-sm">
            {notice}<button data-testid="button-dismiss-notice" onClick={clearNotice} className="text-xs font-semibold underline">Dismiss</button>
          </div>
        )}
        {view.kind === "error" ? (
          <div className="space-y-3">
            <ErrorBox message={`The stored ledger could not be loaded. Nothing was reseeded. ${view.error}`} onRetry={refresh} />
            {!confirmReset ? (
              <button data-testid="button-error-reset" onClick={() => setConfirmReset(true)} className="rounded border border-oxblood px-3 py-1.5 text-sm font-semibold text-oxblood">Discard stored ledger and reset...</button>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                Erase the unreadable ledger permanently?
                <button data-testid="button-error-confirm-reset" onClick={() => { reset(); setConfirmReset(false); }} className="rounded bg-oxblood px-3 py-1 font-semibold text-paper">Yes, erase</button>
                <button onClick={() => setConfirmReset(false)} data-testid="button-error-cancel-reset" className="rounded border border-rule px-3 py-1">Cancel</button>
              </div>
            )}
          </div>
        ) : (
          <Switch>
            <Route path="/"><QueuePage key={role} states={view.states} role={role} bulk={bulk} /></Route>
            <Route path="/invoices"><AllInvoicesPage key={role} states={view.states} role={role} bulk={bulk} /></Route>
            <Route path="/invoices/:id">{(p) => <DetailPage key={p.id} id={p.id} states={view.states} role={role} decide={decide} />}</Route>
            <Route path="/history"><HistoryPage events={view.events} /></Route>
            <Route path="/spend"><SpendPage states={view.states} /></Route>
            <Route path="/about"><AboutPage reset={reset} fresh={view.fresh} count={view.events.length} /></Route>
            <Route>
              <div className="py-16 text-center"><h1 className="display text-3xl">Page not found</h1><Link href="/" className="mt-2 inline-block underline">Back to queue</Link></div>
            </Route>
          </Switch>
        )}
        <footer className="num pt-6 text-[11px] text-muted" data-testid="text-synced">Ledger read from this browser at {syncedAt.toLocaleTimeString()}. Other tabs update automatically.</footer>
      </main>
    </div>
  );
}

function App() {
  return (
    <Router base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Shell />
    </Router>
  );
}

export default App;
