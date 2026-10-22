import { useMemo } from "react";
import { afes, pars, states, spendState, type DecisionEvent, type BulkAction } from "@/domain/engine";
import { requiredStages, stageReason, allowedActions } from "../../../../approval-desk/src/domain/ledger.ts";
import { linesOfInvoice } from "../../../../spend-tracker/src/domain/lines.ts";
import { cad, supplierName, stamp, Pill, type Feat } from "./shared";
import type { Role } from "@/domain/engine";

export function InvoiceDetail({ id, originLabel, ledger, feat, role, reason, setReason, dupes, highlight, onBack, onOpen, onBudget, onTrace, onDecide }: {
  id: string; originLabel: string; ledger: readonly DecisionEvent[]; feat: Feat; role: Role;
  reason: string; setReason: (s: string) => void; dupes: Map<string, string[]> | null; highlight: string;
  onBack: () => void; onOpen: (id: string) => void; onBudget: (scope: string) => void; onTrace: (scope: string, cat: string) => void;
  onDecide: (ids: string[], a: BulkAction) => void;
}) {
  const tracing = feat("spend-tracing"), budgets = feat("budget-positions"), history = feat("decision-history"), bulk = feat("bulk-actions");
  const data = useMemo(() => {
    try {
      const st = states(ledger).get(id);
      if (!st) return { missing: true as const };
      let lines: ReturnType<typeof linesOfInvoice> | null = null; let lineErr: string | null = null;
      if (tracing) { try { lines = linesOfInvoice(spendState(ledger), id); } catch (e) { lineErr = e instanceof Error ? e.message : String(e); } }
      return { missing: false as const, st, lines, lineErr };
    } catch (e) { return { missing: false as const, error: e instanceof Error ? e.message : String(e) }; }
  }, [id, ledger, tracing]);

  return (
    <div className="rise">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-sm">
        <button data-testid="button-close-detail" onClick={onBack} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">&larr; {originLabel}</button>
        <span className="text-muted-foreground">/</span><span className="num">{id}</span>
      </nav>
      {data.missing ? (
        <div className="border border-dashed border-foreground/40 bg-card p-8" data-testid="state-missing-invoice">
          <h2 className="font-display text-2xl">No invoice with ID <span className="num">{id}</span>.</h2>
          <p className="mt-2 text-sm text-muted-foreground">This link may be from another snapshot. Scenario IDs are immutable; nothing was looked up by invoice number.</p>
          <button onClick={onBack} className="mt-4 text-sm underline">Back to {originLabel}</button>
        </div>
      ) : "error" in data ? (
        <p role="alert" className="border border-destructive/40 p-5 text-sm text-destructive">{data.error}</p>
      ) : (() => {
        const { st, lines, lineErr } = data; const i = st.invoice;
        const afe = afes.find(a => a.id === i.afeId); const par = pars.find(p => p.id === i.parId);
        const dup = dupes?.get(id) ?? null;
        const can = allowedActions(st, role).filter(a => a !== "pay");
        const req = requiredStages(i.amountCents);
        const scopeLink = (s: string) => budgets ? <button onClick={() => onBudget(s)} className="num underline decoration-accent underline-offset-2">{s}</button> : <span className="num">{s}</span>;
        return (
          <>
            <header className="flex flex-wrap items-end justify-between gap-4 border-b border-foreground/80 pb-4">
              <div>
                <p className="num text-[11px] uppercase tracking-widest text-accent">Invoice {i.id} &middot; {supplierName(i.supplierId)}</p>
                <h1 className="font-display num mt-1 text-4xl">{i.invoiceNumber}</h1>
              </div>
              <div className="text-right">
                <p className="num text-3xl">{cad(i.amountCents)}</p>
                <p className="mt-1 flex items-center justify-end gap-2 text-xs text-muted-foreground"><Pill status={st.status} /> stage <span className="capitalize text-foreground">{st.stage ?? "none"}</span></p>
              </div>
            </header>

            <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="min-w-0 space-y-8">
                <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Scenario ID</dt><dd className="num">{i.id}</dd>
                  <dt className="text-muted-foreground">Supplier</dt><dd>{supplierName(i.supplierId)} <span className="num text-xs text-muted-foreground">{i.supplierId}</span></dd>
                  <dt className="text-muted-foreground">Date</dt><dd className="num">{i.date}</dd>
                  <dt className="text-muted-foreground">AFE</dt><dd>{scopeLink(i.afeId)} {afe?.name}</dd>
                  <dt className="text-muted-foreground">PAR</dt><dd>{scopeLink(i.parId)} {par?.name}</dd>
                  <dt className="text-muted-foreground">Seed status</dt><dd className="capitalize">{i.initialStatus}</dd>
                </dl>

                {dupes && (
                  <section>
                    <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground">Duplicates across the full ledger</h2>
                    {!dup?.length ? <p className="mt-1 text-sm">None. Supplier plus normalized number is unique.</p> : (
                      <div className="mt-2 border-l-2 border-destructive pl-3">
                        <p className="text-sm">Same supplier and normalized number as:</p>
                        <div className="mt-1.5 flex flex-wrap gap-2">{dup.map(d => <button key={d} data-testid={`link-duplicate-${d}`} onClick={() => onOpen(d)} className="num border border-destructive/50 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/5">{d}</button>)}</div>
                        <p className="mt-1.5 text-xs text-muted-foreground">Warning only. Nothing is merged; both amounts count in every total.</p>
                      </div>
                    )}
                  </section>
                )}

                {tracing && (
                  <section>
                    <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground">Source cost lines</h2>
                    {lineErr ? <p role="alert" className="mt-1 text-sm text-destructive">{lineErr}</p>
                      : !lines?.length ? <p className="mt-1 text-sm text-muted-foreground">No source lines.</p> : (
                        <ul className="mt-2 border border-border bg-card text-sm">
                          {lines.map(l => <li key={l.line.id} className="flex justify-between gap-3 border-b border-border/60 px-3 py-2 last:border-0"><span><span className="num mr-2 text-xs text-muted-foreground">{l.line.id}</span>{l.line.description} <button title="Trace this PAR and category in Budgets" onClick={() => onTrace(i.parId, l.line.category)} className="ml-1 text-xs capitalize text-muted-foreground underline">{l.line.category}</button></span><span className="num text-xs">{cad(l.line.cents)}</span></li>)}
                          <li className="flex justify-between bg-muted/40 px-3 py-2 text-xs font-medium"><span>Lines total</span><span className="num">{cad(lines.reduce((s, l) => s + l.line.cents, 0))}</span></li>
                        </ul>
                      )}
                  </section>
                )}

                {history && (
                  <section id="detail-history">
                    <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground">Decision history</h2>
                    {st.events.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">No decisions recorded in this snapshot. Status is the synthetic seed value.</p> : (
                      <ol className="relative mt-3 space-y-3 border-l border-border pl-5 text-sm">
                        {st.events.map(e => (
                          <li key={e.id} id={`ev-${e.id}`} className={`relative ${highlight === e.id ? "bg-accent/10 -ml-2 pl-2 py-1" : ""}`}>
                            <span className={`absolute -left-[1.42rem] top-1.5 h-2 w-2 rounded-full ${e.action === "reject" ? "bg-destructive" : "bg-accent"}`} />
                            <p><span className="capitalize">{e.action}</span> by <span className="capitalize">{e.role}</span> <span className="num text-xs text-muted-foreground">{e.fromStatus}/{e.fromStage ?? "-"} &rarr; {e.toStatus}/{e.toStage ?? "-"}</span></p>
                            <p className="num text-[11px] text-muted-foreground">#{e.seq} &middot; <time dateTime={e.at}>{stamp(e.at)}</time>{e.batchId ? ` · ${e.batchId}` : ""}</p>
                            {e.reason && <p className="text-xs text-muted-foreground">"{e.reason}"</p>}
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                )}
              </div>

              <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
                <div className="border border-border bg-card p-4">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Approval path</p>
                  <ol className="mt-2 flex items-center gap-2 text-sm">
                    {req.map((r, k) => <li key={r} className="flex items-center gap-2">{k > 0 && <span className="text-muted-foreground">&rarr;</span>}<span className={`capitalize ${st.stage === r ? "font-medium text-accent" : ""}`}>{r}</span></li>)}
                  </ol>
                  <p className="mt-2 text-xs text-muted-foreground">{stageReason(i.amountCents)}</p>
                </div>
                {bulk && (
                  <div className="border border-foreground/70 bg-card p-4">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Decide as <span className="capitalize text-foreground">{role}</span></p>
                    {can.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No decision available to a {role} at this status and stage.</p> : <>
                      <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Reason recorded on the event" className="mt-2 block w-full resize-none border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-accent" />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button data-testid="button-detail-approve" disabled={!can.includes("approve")} onClick={() => onDecide([i.id], "approve")} className="bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40">Approve</button>
                        <button data-testid="button-detail-reject" disabled={!can.includes("reject")} onClick={() => onDecide([i.id], "reject")} className="border border-destructive px-3 py-2 text-sm text-destructive disabled:opacity-40">Reject</button>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">Opens a preview; storage is re-read before writing.</p>
                    </>}
                  </div>
                )}
              </aside>
            </div>
          </>
        );
      })()}
    </div>
  );
}
