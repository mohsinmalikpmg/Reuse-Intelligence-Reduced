import { useMemo } from "react";
import { afes, pars, spendState, requireCapability, trace, type DecisionEvent, type Scope, type LineCategory } from "@/domain/engine";
import type { Recipe } from "@/domain/recipe";
import { rollupPortfolio, rollupAfe, rollupPar, reconcile, overrunTrail, type Rollup } from "../../../../spend-tracker/src/domain/model.ts";
import { cad, Pill, segBtn } from "./shared";

function Figures({ r }: { r: Rollup }) {
  const used = r.budget > 0 ? Math.min(1, r.committed / r.budget) : 0;
  const proj = r.budget > 0 ? Math.min(1, (r.committed + r.pending) / r.budget) : 0;
  const cells: [string, number, boolean?][] = [["Paid", r.paid], ["Approved unpaid", r.approvedUnpaid], ["Pending", r.pending], ["Rejected (excluded)", r.rejected], ["Remaining", r.remaining, r.remaining < 0], ["Projected remaining", r.projectedRemaining, r.projectedRemaining < 0], ["Committed overrun", r.committedOverrun, r.committedOverrun > 0], ["Projected overrun", r.projectedOverrun, r.projectedOverrun > 0]];
  return (
    <div className="border border-border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-4 px-4 pt-4">
        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Committed of budget</p><p className="num text-2xl">{cad(r.committed)} <span className="text-sm text-muted-foreground">/ {cad(r.budget)}</span></p></div>
        <p className="num text-xs text-muted-foreground">{r.invoiceCount} invoices</p>
      </div>
      <div className="relative mx-4 mt-3 h-2 bg-muted" aria-hidden>
        <div className="absolute inset-y-0 left-0 origin-left bg-accent/35" style={{ width: `${proj * 100}%` }} />
        <div className={`absolute inset-y-0 left-0 origin-left ${r.committedOverrun > 0 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${used * 100}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-px border-t border-border bg-border md:grid-cols-4">
        {cells.map(([k, v, bad]) => <div key={k} className="bg-card px-3 py-2"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</p><p className={`num text-sm ${bad ? "text-destructive" : ""}`}>{cad(v)}</p></div>)}
      </div>
    </div>
  );
}

export function BudgetView({ recipe, ledger, scope, setScope, lens, setLens, tracing, cat, setCat, onOpen }: {
  recipe: Recipe; ledger: readonly DecisionEvent[]; scope: string; setScope: (s: string) => void;
  lens: "positions" | "lines"; setLens: (l: "positions" | "lines") => void; tracing: boolean;
  cat: LineCategory | ""; setCat: (c: LineCategory | "") => void; onOpen: (id: string) => void;
}) {
  const level = scope === "portfolio" ? "portfolio" as const : afes.some(a => a.id === scope) ? "afe" as const : pars.some(p => p.id === scope) ? "par" as const : null;
  const data = useMemo(() => {
    try {
      requireCapability(recipe, "spend-tracing");
      const s = spendState(ledger);
      if (level === "portfolio") return { kind: "portfolio" as const, total: rollupPortfolio(s), rows: afes.map(a => ({ a, r: rollupAfe(s, a.id), ps: pars.filter(p => p.afeId === a.id).map(p => ({ p, r: rollupPar(s, p.id) })) })) };
      if (!level) return { kind: "missing" as const };
      return { kind: level, r: level === "afe" ? rollupAfe(s, scope) : rollupPar(s, scope), rec: reconcile(s, level, scope), trail: overrunTrail(s, level, scope), children: level === "afe" ? pars.filter(p => p.afeId === scope).map(p => ({ p, r: rollupPar(s, p.id) })) : [], invoices: Object.values(s.invoices).filter(i => (level === "afe" ? i.afeId : i.parId) === scope).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })) };
    } catch (e) { return { kind: "error" as const, error: e instanceof Error ? e.message : String(e) }; }
  }, [recipe, ledger, scope, level]);

  const par = pars.find(p => p.id === scope);
  const afe = afes.find(a => a.id === (par ? par.afeId : scope));
  const showLines = tracing && lens === "lines" && level !== null;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Budget path" className="flex flex-wrap items-center gap-1.5 text-sm">
          <button onClick={() => setScope("portfolio")} className={scope === "portfolio" ? "font-medium" : "text-muted-foreground underline-offset-2 hover:underline"}>Portfolio</button>
          {afe && <><span className="text-muted-foreground">/</span><button onClick={() => setScope(afe.id)} className={scope === afe.id ? "font-medium" : "text-muted-foreground underline-offset-2 hover:underline"}><span className="num">{afe.id}</span> {afe.name}</button></>}
          {par && <><span className="text-muted-foreground">/</span><span className="font-medium"><span className="num">{par.id}</span> {par.name}</span></>}
        </nav>
        {tracing && level && (
          <div className="flex" role="tablist" aria-label="Budget lens">
            <button role="tab" aria-selected={lens === "positions"} onClick={() => setLens("positions")} className={segBtn(lens === "positions")}>Positions</button>
            <button role="tab" data-testid="button-trace-scope" aria-selected={lens === "lines"} onClick={() => setLens("lines")} className={segBtn(lens === "lines")}>Cost lines</button>
          </div>
        )}
      </div>

      {data.kind === "error" ? <p role="alert" className="border border-destructive/40 p-3 text-sm text-destructive">{data.error}</p>
        : data.kind === "missing" ? <p className="border border-dashed border-border p-6 text-sm">Unknown AFE or PAR <span className="num">{scope}</span>. <button onClick={() => setScope("portfolio")} className="underline">Show portfolio</button></p>
        : showLines ? <Lines recipe={recipe} ledger={ledger} scope={scope} cat={cat} setCat={setCat} onOpen={onOpen} />
        : data.kind === "portfolio" ? (
          <div className="space-y-5">
            <Figures r={data.total} />
            <div className="border border-border bg-card">
              {data.rows.map(({ a, r, ps }) => (
                <div key={a.id} className="border-b border-border last:border-0">
                  <button onClick={() => setScope(a.id)} className="grid w-full grid-cols-[1fr_auto] gap-3 px-4 py-3 text-left hover:bg-muted/50 md:grid-cols-[1fr_8rem_8rem_9rem]">
                    <span><span className="num text-xs text-accent">{a.id}</span> <span className="font-medium">{a.name}</span></span>
                    <span className="num hidden text-right text-xs md:block">{cad(r.budget)}</span>
                    <span className="num hidden text-right text-xs md:block">{cad(r.committed)}</span>
                    <span className={`num text-right text-xs ${r.projectedRemaining < 0 ? "text-destructive" : ""}`}>{cad(r.projectedRemaining)}</span>
                  </button>
                  {ps.map(({ p, r: pr }) => (
                    <button key={p.id} onClick={() => setScope(p.id)} className="grid w-full grid-cols-[1fr_auto] gap-3 border-t border-border/50 py-2 pl-10 pr-4 text-left text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground md:grid-cols-[1fr_8rem_8rem_9rem]">
                      <span><span className="num text-xs">{p.id}</span> {p.name}</span>
                      <span className="num hidden text-right text-xs md:block">{cad(pr.budget)}</span>
                      <span className="num hidden text-right text-xs md:block">{cad(pr.committed)}</span>
                      <span className={`num text-right text-xs ${pr.projectedRemaining < 0 ? "text-destructive" : ""}`}>{cad(pr.projectedRemaining)}</span>
                    </button>
                  ))}
                </div>
              ))}
              <p className="hidden grid-cols-[1fr_8rem_8rem_9rem] gap-3 border-t border-border bg-muted/40 px-4 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground md:grid"><span>Position</span><span className="text-right">Budget</span><span className="text-right">Committed</span><span className="text-right">Projected remaining</span></p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <Figures r={data.r} />
            {data.children.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {data.children.map(({ p, r }) => <button key={p.id} onClick={() => setScope(p.id)} className="border border-border bg-card px-3 py-2 text-left text-sm hover:border-foreground/40"><span className="num text-xs text-accent">{p.id}</span> {p.name}<span className={`num block text-xs ${r.projectedRemaining < 0 ? "text-destructive" : "text-muted-foreground"}`}>{cad(r.projectedRemaining)} projected left</span></button>)}
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="border border-border bg-card">
                <p className={`px-4 py-2 text-sm font-medium ${data.rec.matches ? "bg-[hsl(158_30%_90%)] dark:bg-[hsl(158_25%_14%)]" : "bg-destructive/10"}`}>{data.rec.matches ? "Rollup reconciles with invoice rows" : "Rollup does not reconcile"} <span className="num text-xs text-muted-foreground">({data.rec.rowCount} rows)</span></p>
                {data.rec.differences.map(d => <p key={d} className="border-t border-border px-4 py-1.5 text-xs text-destructive">{d}</p>)}
                <p className="px-4 py-2 text-xs text-muted-foreground">Independent recount from invoice rows filtered by {data.kind.toUpperCase()} id, compared to the budget-centric rollup.</p>
              </div>
              <div className="border border-border bg-card">
                <p className="px-4 py-2 text-sm font-medium">Overrun trail {data.r.committedOverrun > 0 ? <span className="text-destructive">committed already exceeds budget by {cad(data.r.committedOverrun)}</span> : data.trail.crossingInvoiceId ? <span className="text-destructive">crosses at <button onClick={() => onOpen(data.trail.crossingInvoiceId!)} className="num underline">{data.trail.crossingInvoiceId}</button></span> : <span className="text-muted-foreground">stays within budget</span>}</p>
                <ol className="num text-xs">
                  {data.trail.steps.map((s, k) => (
                    <li key={k} className="grid grid-cols-[1fr_auto_auto] gap-3 border-t border-border/60 px-4 py-1.5">
                      <span className="font-sans">{s.label} {s.invoiceIds.map(id => <button key={id} onClick={() => onOpen(id)} className="num ml-1 underline">{id}</button>)}</span>
                      <span>{cad(s.deltaCents)}</span><span className={s.runningCents < 0 ? "text-destructive" : ""}>{cad(s.runningCents)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            <div className="overflow-x-auto border border-border bg-card">
              <p className="border-b border-border px-4 py-2 text-sm font-medium">All {data.invoices.length} invoices in scope <span className="text-xs font-normal text-muted-foreground">including rejected, which the overrun trail omits</span></p>
              <table className="w-full text-sm">
                <tbody className="num text-xs">
                  {data.invoices.map(i => <tr key={i.id} onClick={() => onOpen(i.id)} className="cursor-pointer border-t border-border/50 hover:bg-muted/50"><td className="px-4 py-1.5"><button onClick={() => onOpen(i.id)} className="underline">{i.id}</button></td><td className="px-3">{i.number}</td><td className="px-3">{i.date}</td><td className="px-3">{i.parId}</td><td className="px-3"><Pill status={i.status} /></td><td className="px-4 text-right">{cad(i.cents)}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}
    </div>
  );
}

function Lines({ recipe, ledger, scope: key, cat, setCat, onOpen }: { recipe: Recipe; ledger: readonly DecisionEvent[]; scope: string; cat: LineCategory | ""; setCat: (c: LineCategory | "") => void; onOpen: (id: string) => void }) {
  const data = useMemo(() => {
    const scope: Scope = key === "portfolio" ? { level: "portfolio" } : afes.some(a => a.id === key) ? { level: "afe", id: key } : { level: "par", id: key };
    try { return { t: trace(recipe, ledger, scope, cat || undefined), error: null }; }
    catch (e) { return { t: null, error: e instanceof Error ? e.message : String(e) }; }
  }, [recipe, ledger, key, cat]);
  const buckets = ["pending", "approvedUnpaid", "paid", "rejected"] as const;
  const bucketLabel = { pending: "Pending", approvedUnpaid: "Approved unpaid", paid: "Paid", rejected: "Rejected" };
  return (
    <div className="rise space-y-4">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="mr-1 text-muted-foreground">Category</span>
        {(["", "materials", "labour"] as const).map(c => <button key={c} onClick={() => setCat(c)} className={segBtn(cat === c)}>{c || "All lines"}</button>)}
      </div>
      {data.error || !data.t ? <p role="alert" className="border border-destructive/40 p-3 text-sm text-destructive">{data.error}</p> : (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
          <div className="self-start border border-border bg-card">
            <div className={`flex items-center justify-between px-4 py-3 ${data.t.summary.reconciles ? "bg-[hsl(158_30%_90%)] dark:bg-[hsl(158_25%_14%)]" : "bg-destructive/10"}`}>
              <span className="text-sm font-medium">{data.t.summary.reconciles ? "Lines reconcile to invoices" : "Lines do not reconcile"}</span>
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
          <div className="max-h-[32rem] overflow-y-auto border border-border bg-card text-sm">
            {data.t.lines.length === 0 ? <p className="p-6 text-center text-muted-foreground">No lines in this scope.</p> : data.t.lines.map(l => (
              <div key={l.line.id} className="grid grid-cols-[3.5rem_1fr_auto] gap-3 border-b border-border/60 px-4 py-2.5 last:border-0">
                <span className="num text-xs text-muted-foreground">{l.line.id}</span>
                <span><span className="block">{l.line.description}</span><span className="text-xs text-muted-foreground">{l.supplierName} &middot; <button onClick={() => onOpen(l.invoice.id)} className="num underline">{l.invoice.id} {l.invoice.number}</button> &middot; {l.invoice.parId}</span></span>
                <span className="text-right"><span className="num block text-xs">{cad(l.line.cents)}</span><Pill status={l.status} /></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
