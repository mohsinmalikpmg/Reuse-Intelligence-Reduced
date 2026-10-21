import { useState } from "react";
import { Link, Route, Router, Switch, useLocation } from "wouter";
import { StoreProvider, useStore } from "@/store.tsx";
import { TracePage } from "@/trace.tsx";
import { AboutPage, DrillPage, InvoicePage, InvoicesPage, PortfolioPage } from "@/pages.tsx";

function Nav() {
  const [loc] = useLocation();
  const item = (href: string, label: string, match: (l: string) => boolean) => (
    <Link data-testid={`nav-${label.toLowerCase()}`} href={href}
      className={`px-3 py-1.5 text-[13px] font-medium rounded-sm ${match(loc) ? "bg-petrol text-sheet" : "text-ink hover:bg-petrol-soft"}`}>{label}</Link>
  );
  return (
    <nav className="flex gap-1">
      {item("/", "Trace", (l) => l === "/" || l.startsWith("/trace"))}
      {item("/budget", "Budget", (l) => l === "/budget" || l.startsWith("/afe") || l.startsWith("/par"))}
      {item("/invoices", "Invoices", (l) => l.startsWith("/invoices"))}
      {item("/about", "About", (l) => l === "/about")}
    </nav>
  );
}

function ResetControl() {
  const { reset } = useStore();
  const [confirm, setConfirm] = useState(false);
  if (!confirm) return <button data-testid="button-reset" onClick={() => setConfirm(true)} className="text-[12px] px-2.5 py-1.5 border border-rule rounded-sm hover:border-oxblood hover:text-oxblood">Reset demo data</button>;
  return (
    <span className="flex items-center gap-1.5 text-[12px]">
      <span>Discard all decisions and reseed?</span>
      <button data-testid="button-confirm-reset" onClick={() => { reset(); setConfirm(false); }} className="px-2.5 py-1.5 bg-oxblood text-sheet rounded-sm font-semibold">Reset</button>
      <button data-testid="button-cancel-reset" onClick={() => setConfirm(false)} className="px-2.5 py-1.5 border border-rule rounded-sm">Cancel</button>
    </span>
  );
}

function Shell() {
  const { status, role, setRole, lastError, clearError, externalNotice } = useStore();
  return (
    <div className="min-h-[100dvh] flex flex-col">
      <div data-testid="banner-demo" className="bg-ink text-sheet text-[12px] px-4 py-1.5 text-center">
        Single-browser synthetic demo. No real payments, no enterprise authorization. Data lives only in this browser.
      </div>
      <header className="border-b border-rule bg-sheet/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1320px] mx-auto px-4 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/" className="flex items-baseline gap-2" data-testid="link-home">
            <span className="font-display text-xl font-bold tracking-tight">Spend<span className="text-ochre">/</span>Tracker</span>
            <span className="text-[11px] text-muted uppercase tracking-[0.14em] hidden sm:inline">Project &gt; materials / labour &gt; source line</span>
          </Link>
          <Nav />
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12px]" title="Demo role switch. Not authentication.">
              <span className="text-muted">Demo role</span>
              <select data-testid="select-role" value={role} onChange={(e) => setRole(e.target.value === "viewer" ? "viewer" : "reviewer")} className="bg-sheet border border-rule rounded-sm px-2 py-1">
                <option value="reviewer">Reviewer</option>
                <option value="viewer">Viewer</option>
              </select>
              <span className="text-[10px] text-muted">(not real auth)</span>
            </label>
            <ResetControl />
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-[1320px] w-full mx-auto px-4 py-5 space-y-3">
        {lastError && (
          <div role="alert" data-testid="alert-error" className="flex items-start justify-between gap-3 border-l-4 border-oxblood bg-oxblood-soft px-4 py-2 text-[13px]">
            <span><b>Action not saved.</b> {lastError}</span>
            <button data-testid="button-dismiss-error" onClick={clearError} className="text-oxblood underline">Dismiss</button>
          </div>
        )}
        {externalNotice && <div data-testid="notice-external" className="text-[12px] text-petrol">{externalNotice}</div>}
        {status.kind !== "ready" ? (
          <div role="alert" data-testid="alert-storage" className="border border-oxblood bg-sheet p-6 max-w-2xl space-y-3">
            <h1 className="font-display text-2xl font-semibold text-oxblood">{status.kind === "corrupt" ? "Stored data is corrupt" : "Browser storage unavailable"}</h1>
            <p className="text-sm">{status.message}</p>
            <p className="text-sm text-muted">The app will not silently reseed. Use "Reset demo data" in the header to discard stored data and restore the fixture, or reload after fixing browser storage settings.</p>
            <button data-testid="button-retry" onClick={() => window.location.reload()} className="px-3 py-1.5 border border-rule rounded-sm text-sm">Retry load</button>
          </div>
        ) : (
          <Switch>
            <Route path="/">{() => <TracePage s={status.state} />}</Route>
            <Route path="/trace/:scope">{(p) => <TracePage s={status.state} scopeRaw={p.scope} />}</Route>
            <Route path="/trace/:scope/:group">{(p) => <TracePage s={status.state} scopeRaw={p.scope} groupRaw={p.group} />}</Route>
            <Route path="/budget">{() => <PortfolioPage s={status.state} />}</Route>
            <Route path="/afe/:id">{(p) => <DrillPage s={status.state} level="afe" id={p.id} />}</Route>
            <Route path="/par/:id">{(p) => <DrillPage s={status.state} level="par" id={p.id} />}</Route>
            <Route path="/invoices">{() => <InvoicesPage s={status.state} />}</Route>
            <Route path="/invoices/:id">{(p) => <InvoicePage s={status.state} id={p.id} />}</Route>
            <Route path="/about" component={AboutPage} />
            <Route>{() => <div data-testid="text-404" className="p-8 text-sm">Page not found. <Link href="/" className="text-petrol underline">Back to trace</Link></div>}</Route>
          </Switch>
        )}
      </main>
      <footer className="border-t border-rule text-[11px] text-muted px-4 py-3 text-center">Synthetic scenario v1. Not official company branding or data. Revision {status.kind === "ready" ? status.state.revision : "n/a"}.</footer>
    </div>
  );
}

function App() {
  return (
    <Router base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </Router>
  );
}

export default App;
