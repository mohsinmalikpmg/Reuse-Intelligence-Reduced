import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  rollupAfe, rollupPar, rollupPortfolio, reconcile, overrunTrail, duplicatesOf, searchInvoices,
  allowedActions, type InvoiceStatus, type SpendState, type Invoice,
} from "@/domain/model.ts";
import { useStore } from "@/store.tsx";
import { InvoiceLines } from "@/trace.tsx";
import { BudgetBar, Crumbs, Legend, OverrunFlags, Panel, RollupLedger, StatusTag, cad } from "@/ui.tsx";

const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted";
const thr = th + " text-right";
const td = "px-3 py-1.5 text-[13px] border-t border-rule/70";
const tdr = td + " text-right num";

function Missing({ what }: { what: string }) {
  return (
    <Panel title="Not found">
      <p data-testid="text-missing" className="p-4 text-sm">{what} does not exist in this dataset. <Link href="/budget" className="text-petrol underline">Back to budget</Link></p>
    </Panel>
  );
}

// ---------- Portfolio ----------
export function PortfolioPage({ s }: { s: SpendState }) {
  const p = rollupPortfolio(s);
  const afes = Object.values(s.afes);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Budget position</h1>
          <p className="text-sm text-muted">{afes.length} AFEs, {Object.keys(s.pars).length} PARs, {p.invoiceCount} invoices. Every figure below reconciles to invoice rows.</p>
        </div>
        <OverrunFlags r={p} id="portfolio" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 border border-rule bg-sheet rounded-sm rise">
        {[
          ["Budget", p.budget, ""], ["Paid", p.paid, "text-paid"], ["Approved, unpaid", p.approvedUnpaid, "text-petrol"],
          ["Committed", p.committed, ""], ["Pending exposure", p.pending, "text-[hsl(32_80%_32%)]"], ["Projected remaining", p.projectedRemaining, p.projectedRemaining < 0 ? "text-oxblood" : ""],
        ].map(([l, v, c], i) => (
          <div key={i} className="p-3 border-rule border-r border-b md:border-b-0 last:border-r-0">
            <div className="text-[11px] uppercase tracking-[0.1em] text-muted">{l}</div>
            <div data-testid={`kpi-${i}`} className={`num text-lg font-semibold ${c}`}>{cad(v as number)}</div>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-muted">Remaining after committed <span className="num text-ink font-semibold">{cad(p.remaining)}</span>. Rejected <span className="num">{cad(p.rejected)}</span> is shown for audit only and excluded from all totals.</p>

      <Panel title="AFE ledger" aside={<Legend />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead><tr>
              <th className={th}>AFE / PAR</th><th className={th + " w-[22%]"}>Budget use</th><th className={thr}>Budget</th><th className={thr}>Paid</th><th className={thr}>Appr. unpaid</th>
              <th className={thr}>Committed</th><th className={thr}>Remaining</th><th className={thr}>Pending</th><th className={thr}>Projected</th><th className={th}>Flag</th>
            </tr></thead>
            <tbody>
              {afes.map((a) => {
                const r = rollupAfe(s, a.id);
                return [
                  <tr key={a.id} className="bg-paper/60">
                    <td className={td}><Link data-testid={`link-afe-${a.id}`} href={`/afe/${a.id}`} className="font-semibold text-petrol hover:underline">{a.id}</Link> <span className="text-muted">{a.name}</span></td>
                    <td className={td}><BudgetBar r={r} id={a.id} /></td>
                    <td className={tdr}>{cad(r.budget)}</td><td className={tdr}>{cad(r.paid)}</td><td className={tdr}>{cad(r.approvedUnpaid)}</td>
                    <td className={tdr + " font-semibold"}>{cad(r.committed)}</td>
                    <td className={tdr + (r.remaining < 0 ? " text-oxblood" : "")}>{cad(r.remaining)}</td>
                    <td className={tdr}>{cad(r.pending)}</td>
                    <td className={tdr + (r.projectedRemaining < 0 ? " text-oxblood font-semibold" : "")}>{cad(r.projectedRemaining)}</td>
                    <td className={td}><OverrunFlags r={r} id={a.id} /></td>
                  </tr>,
                  ...a.parIds.map((pid) => {
                    const pr = rollupPar(s, pid);
                    return (
                      <tr key={pid}>
                        <td className={td + " pl-8"}><Link data-testid={`link-par-${pid}`} href={`/par/${pid}`} className="text-petrol hover:underline">{pid}</Link> <span className="text-muted">{s.pars[pid].name}</span></td>
                        <td className={td}><BudgetBar r={pr} id={pid} /></td>
                        <td className={tdr}>{cad(pr.budget)}</td><td className={tdr}>{cad(pr.paid)}</td><td className={tdr}>{cad(pr.approvedUnpaid)}</td>
                        <td className={tdr}>{cad(pr.committed)}</td>
                        <td className={tdr + (pr.remaining < 0 ? " text-oxblood" : "")}>{cad(pr.remaining)}</td>
                        <td className={tdr}>{cad(pr.pending)}</td>
                        <td className={tdr + (pr.projectedRemaining < 0 ? " text-oxblood" : "")}>{cad(pr.projectedRemaining)}</td>
                        <td className={td}><OverrunFlags r={pr} id={pid} /></td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ---------- Drilldown (AFE or PAR) ----------
function OverrunExplain({ s, level, id }: { s: SpendState; level: "afe" | "par"; id: string }) {
  const t = overrunTrail(s, level, id);
  const r = level === "afe" ? rollupAfe(s, id) : rollupPar(s, id);
  return (
    <Panel title="Overrun explanation">
      <div className="p-4 space-y-3">
        <p data-testid={`text-overrun-${id}`} className="text-[13px] leading-relaxed">
          {r.committedOverrun > 0
            ? <>Committed spend already exceeds budget by <b className="num text-oxblood">{cad(r.committedOverrun)}</b>. This is a hard overrun: approved and paid invoices alone are over.</>
            : <>Committed spend leaves <b className="num">{cad(r.remaining)}</b>. </>}
          {r.committedOverrun === 0 && (r.projectedOverrun > 0
            ? <>If all pending invoices are approved, the budget is exceeded by <b className="num text-oxblood">{cad(r.projectedOverrun)}</b>{t.crossingInvoiceId && <> &mdash; invoice <Link href={`/invoices/${t.crossingInvoiceId}`} className="text-petrol underline">{t.crossingInvoiceId}</Link> is the one that crosses the budget line</>}. Nothing is overspent yet; this is a projection.</>
            : <>Pending exposure of <b className="num">{cad(r.pending)}</b> still fits: projected remaining is <b className="num">{cad(r.projectedRemaining)}</b>.</>)}
        </p>
        <table className="w-full">
          <thead><tr><th className={th}>Step</th><th className={thr}>Change</th><th className={thr}>Running remaining</th></tr></thead>
          <tbody>
            {t.steps.map((st, i) => (
              <tr key={i} className={st.invoiceIds.includes(t.crossingInvoiceId ?? "-") ? "bg-oxblood-soft" : ""}>
                <td className={td}>{st.label}{st.invoiceIds.length > 0 && !st.label.includes(st.invoiceIds[0]) && <span className="text-muted text-[11px]"> ({st.invoiceIds.join(", ")})</span>}</td>
                <td className={tdr}>{i === 0 ? "" : cad(st.deltaCents)}</td>
                <td className={tdr + (st.runningCents < 0 ? " text-oxblood font-semibold" : "")}>{cad(st.runningCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function InvoiceRows({ s, rows, testPrefix }: { s: SpendState; rows: Invoice[]; testPrefix: string }) {
  const [, nav] = useLocation();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px]">
        <thead><tr><th className={th}>ID</th><th className={th}>Supplier</th><th className={th}>Number</th><th className={th}>Date</th><th className={th}>PAR</th><th className={th}>Status</th><th className={thr}>Amount</th></tr></thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} data-testid={`row-${testPrefix}-${i.id}`} onClick={() => nav(`/invoices/${i.id}`)} className="cursor-pointer hover:bg-petrol-soft/50">
              <td className={td}><Link href={`/invoices/${i.id}`} className="text-petrol font-semibold hover:underline" onClick={(e) => e.stopPropagation()}>{i.id}</Link>{duplicatesOf(s, i.id).length > 0 && <span className="ml-1.5 text-[10px] font-semibold text-ochre uppercase">dup?</span>}</td>
              <td className={td}>{s.suppliers[i.supplierId].name}</td>
              <td className={td + " num"}>{i.number}</td>
              <td className={td + " num"}>{i.date}</td>
              <td className={td}>{i.parId}</td>
              <td className={td}><StatusTag status={i.status} /></td>
              <td className={tdr + (i.status === "rejected" ? " text-slate line-through" : "")}>{cad(i.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReconTable({ s, level, id }: { s: SpendState; level: "afe" | "par"; id: string }) {
  const rc = reconcile(s, level, id);
  const lines: [string, number, number][] = [
    ["Pending", rc.rowTotals.pending, rc.rollup.pending],
    ["Approved, unpaid", rc.rowTotals.approvedUnpaid, rc.rollup.approvedUnpaid],
    ["Paid", rc.rowTotals.paid, rc.rollup.paid],
    ["Rejected (excluded)", rc.rowTotals.rejected, rc.rollup.rejected],
  ];
  return (
    <Panel title="Reconciliation" aside={<span data-testid={`status-recon-${id}`} className={`text-[11px] font-semibold uppercase tracking-wide ${rc.matches ? "text-paid" : "text-oxblood"}`}>{rc.matches ? "Rows = rollup" : "Mismatch"}</span>}>
      <table className="w-full">
        <thead><tr><th className={th}>Bucket</th><th className={thr}>Sum of rows</th><th className={thr}>Rollup</th></tr></thead>
        <tbody>
          {lines.map(([l, a, b]) => (
            <tr key={l}><td className={td}>{l}</td><td className={tdr}>{cad(a)}</td><td className={tdr + (a !== b ? " text-oxblood" : "")}>{cad(b)}</td></tr>
          ))}
          <tr><td className={td}>Invoice rows</td><td className={tdr}>{rc.rowCount}</td><td className={tdr}>{rc.rollup.invoiceCount}</td></tr>
        </tbody>
      </table>
      {!rc.matches && <p className="p-3 text-[12px] text-oxblood">{rc.differences.join("; ")}</p>}
      <p className="px-3 py-2 text-[11px] text-muted border-t border-rule">Row sums are recomputed by filtering every invoice on its {level.toUpperCase()} field, independently of the {level === "afe" ? "PAR-to-AFE" : "PAR index"} rollup.</p>
    </Panel>
  );
}

export function DrillPage({ s, level, id }: { s: SpendState; level: "afe" | "par"; id: string }) {
  const node = level === "afe" ? s.afes[id] : s.pars[id];
  if (!node) return <Missing what={`${level.toUpperCase()} ${id}`} />;
  const r = level === "afe" ? rollupAfe(s, id) : rollupPar(s, id);
  const rows = Object.values(s.invoices).filter((i) => (level === "afe" ? i.afeId : i.parId) === id).sort((a, b) => a.date.localeCompare(b.date));
  const par = level === "par" ? s.pars[id] : null;
  return (
    <div className="space-y-4">
      <Crumbs items={par ? [{ href: "/budget", label: "Budget" }, { href: `/afe/${par.afeId}`, label: par.afeId }, { label: id }] : [{ href: "/budget", label: "Budget" }, { label: id }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{level === "afe" ? "Authorization for expenditure" : "Project appropriation request"}</div>
          <h1 className="font-display text-3xl font-semibold"><span className="num">{id}</span> {node.name}</h1>
        </div>
        <OverrunFlags r={r} id={id} />
      </div>
      <div className="max-w-3xl"><BudgetBar r={r} id={`drill-${id}`} /><div className="mt-1.5"><Legend /></div></div>
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Panel title="Rollup"><div className="px-4 pb-2"><RollupLedger r={r} id={id} /></div></Panel>
          <ReconTable s={s} level={level} id={id} />
        </div>
        <div className="space-y-4 min-w-0">
          <Link data-testid={`link-trace-scope-${id}`} href={`/trace/${id}`} className="block border border-ochre bg-ochre-soft rounded-sm px-4 py-2 text-[13px] font-semibold text-ink hover:-translate-y-0.5 transition-transform">Trace {id} by materials and labour to source invoice lines <span aria-hidden>&rarr;</span></Link>
          <OverrunExplain s={s} level={level} id={id} />
          {level === "afe" && (
            <Panel title="PARs under this AFE">
              <table className="w-full">
                <thead><tr><th className={th}>PAR</th><th className={thr}>Allocation</th><th className={thr}>Committed</th><th className={thr}>Pending</th><th className={thr}>Projected</th></tr></thead>
                <tbody>{s.afes[id].parIds.map((pid) => { const pr = rollupPar(s, pid); return (
                  <tr key={pid}><td className={td}><Link data-testid={`link-subpar-${pid}`} href={`/par/${pid}`} className="text-petrol hover:underline">{pid} {s.pars[pid].name}</Link></td>
                    <td className={tdr}>{cad(pr.budget)}</td><td className={tdr}>{cad(pr.committed)}</td><td className={tdr}>{cad(pr.pending)}</td><td className={tdr + (pr.projectedRemaining < 0 ? " text-oxblood" : "")}>{cad(pr.projectedRemaining)}</td></tr>
                ); })}</tbody>
              </table>
            </Panel>
          )}
          <Panel title={`Invoice rows (${rows.length})`}><InvoiceRows s={s} rows={rows} testPrefix={id} /></Panel>
        </div>
      </div>
    </div>
  );
}

// ---------- Invoices search ----------
export function InvoicesPage({ s }: { s: SpendState }) {
  const [q, setQ] = useState("");
  const [st, setSt] = useState<InvoiceStatus | "all">("all");
  const rows = useMemo(() => searchInvoices(s, q, st), [s, q, st]);
  const sum = rows.filter((i) => i.status !== "rejected").reduce((t, i) => t + i.cents, 0);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-semibold">Invoices</h1>
      <div className="flex flex-wrap gap-2 items-center">
        <input data-testid="input-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ID, number (bp100 finds BP-100), supplier, AFE, PAR, date"
          className="flex-1 min-w-[240px] bg-sheet border border-rule rounded-sm px-3 py-2 text-sm" />
        <div className="flex border border-rule rounded-sm overflow-hidden bg-sheet" role="group" aria-label="Status filter">
          {(["all", "pending", "approved", "paid", "rejected"] as const).map((x) => (
            <button key={x} data-testid={`filter-${x}`} onClick={() => setSt(x)} className={`px-3 py-2 text-[12px] font-medium capitalize ${st === x ? "bg-petrol text-sheet" : "hover:bg-petrol-soft"}`}>{x === "approved" ? "approved-unpaid" : x}</button>
          ))}
        </div>
      </div>
      <Panel title={`${rows.length} matching`} aside={<span className="num text-[12px] text-muted">Non-rejected total {cad(sum)}</span>}>
        {rows.length === 0
          ? <div data-testid="empty-invoices" className="p-8 text-center text-sm text-muted">No invoice matches "{q}"{st !== "all" && ` with status ${st}`}. <button className="text-petrol underline" onClick={() => { setQ(""); setSt("all"); }}>Clear filters</button></div>
          : <InvoiceRows s={s} rows={rows} testPrefix="search" />}
      </Panel>
    </div>
  );
}

// ---------- Invoice detail ----------
export function InvoicePage({ s, id }: { s: SpendState; id: string }) {
  const { role, act } = useStore();
  const [reason, setReason] = useState("");
  const [confirmPay, setConfirmPay] = useState(false);
  const inv = s.invoices[id];
  if (!inv) return <Missing what={`Invoice ${id}`} />;
  const acts = allowedActions(inv, role);
  const dups = duplicatesOf(s, id);
  const parR = rollupPar(s, inv.parId);
  const afeR = rollupAfe(s, inv.afeId);
  const history = s.decisions.filter((d) => d.invoiceId === id);
  const impact = inv.status === "pending"
    ? `Approving moves ${cad(inv.cents)} from pending exposure into committed. ${inv.afeId} committed remaining would become ${cad(afeR.remaining - inv.cents)}; projected remaining stays ${cad(afeR.projectedRemaining)}. Rejecting would lift projected remaining to ${cad(afeR.projectedRemaining + inv.cents)}.`
    : inv.status === "approved"
      ? `Marking paid moves ${cad(inv.cents)} from approved-unpaid to paid. Committed stays ${cad(afeR.committed)} because paid is not counted twice.`
      : `This invoice is ${inv.status}, a terminal state.`;
  return (
    <div className="space-y-4">
      <Crumbs items={[{ href: "/budget", label: "Budget" }, { href: `/afe/${inv.afeId}`, label: inv.afeId }, { href: `/par/${inv.parId}`, label: inv.parId }, { label: inv.id }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold"><span className="num">{inv.id}</span> <span className="text-muted font-normal">{inv.number}</span></h1>
        <StatusTag status={inv.status} testId="status-invoice" />
      </div>
      {dups.length > 0 && (
        <div data-testid="warning-duplicate" className="border-l-4 border-ochre bg-ochre-soft px-4 py-2 text-[13px]">
          Possible duplicate of {dups.map((d) => <Link key={d} href={`/invoices/${d}`} className="text-petrol underline mr-1">{d}</Link>)}: same supplier and invoice number after normalizing to uppercase alphanumerics. Warning only; the amount stays in totals and decisions are not blocked.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Invoice">
          <dl className="grid grid-cols-[140px_1fr] gap-y-1.5 p-4 text-[13px]">
            <dt className="text-muted">Supplier</dt><dd>{s.suppliers[inv.supplierId].name} <span className="num text-muted">({inv.supplierId})</span></dd>
            <dt className="text-muted">Invoice number</dt><dd className="num">{inv.number}</dd>
            <dt className="text-muted">Date</dt><dd className="num">{inv.date}</dd>
            <dt className="text-muted">Amount</dt><dd data-testid="text-amount" className="num font-semibold">{cad(inv.cents)}</dd>
            <dt className="text-muted">AFE</dt><dd><Link href={`/afe/${inv.afeId}`} className="text-petrol underline">{inv.afeId} {s.afes[inv.afeId].name}</Link></dd>
            <dt className="text-muted">PAR</dt><dd><Link href={`/par/${inv.parId}`} className="text-petrol underline">{inv.parId} {s.pars[inv.parId].name}</Link></dd>
          </dl>
        </Panel>
        <Panel title="Budget position">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className={th}></th><th className={thr}>Remaining</th><th className={thr}>Pending</th><th className={thr}>Projected</th></tr></thead>
            <tbody>
              {([[inv.parId, parR], [inv.afeId, afeR]] as const).map(([k, r]) => (
                <tr key={k}><td className={td}>{k}</td><td className={tdr}>{cad(r.remaining)}</td><td className={tdr}>{cad(r.pending)}</td><td className={tdr + (r.projectedRemaining < 0 ? " text-oxblood" : "")}>{cad(r.projectedRemaining)}</td></tr>
              ))}
            </tbody>
          </table>
          </div>
          <p data-testid="text-impact" className="p-3 text-[12px] text-muted border-t border-rule">{impact}</p>
        </Panel>
      </div>

      <InvoiceLines s={s} id={id} />

      <Panel title="Simulated decision" aside={<span className="text-[11px] text-muted">Acting as demo role: <b className="text-ink">{role}</b></span>}>
        <div className="p-4 space-y-3">
          {role === "viewer" && <p data-testid="text-viewer" className="text-[13px] text-muted">Viewer cannot decide. Switch the demo role in the header to reviewer. The role switch is a simulation, not authentication.</p>}
          {role === "reviewer" && acts.length === 0 && <p className="text-[13px] text-muted">No actions available: {inv.status} is terminal.</p>}
          {acts.includes("approve") && (
            <div className="flex flex-wrap gap-2 items-start">
              <button data-testid="button-approve" onClick={() => act(id, { kind: "approve" })} className="bg-petrol text-sheet px-4 py-2 text-sm font-semibold rounded-sm hover:opacity-90">Approve</button>
              <div className="flex-1 min-w-0 basis-[260px] flex gap-2">
                <input data-testid="input-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Rejection reason (required)" className="flex-1 min-w-0 bg-sheet border border-rule rounded-sm px-3 py-2 text-sm" />
                <button data-testid="button-reject" disabled={!reason.trim()} onClick={() => { if (act(id, { kind: "reject", reason })) setReason(""); }}
                  className="border border-oxblood text-oxblood px-4 py-2 text-sm font-semibold rounded-sm hover:bg-oxblood-soft disabled:opacity-40 disabled:cursor-not-allowed">Reject</button>
              </div>
            </div>
          )}
          {acts.includes("pay") && (confirmPay ? (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span>Record {cad(inv.cents)} as paid? No real payment occurs.</span>
              <button data-testid="button-confirm-pay" onClick={() => { act(id, { kind: "pay" }); setConfirmPay(false); }} className="bg-paid text-sheet px-3 py-1.5 font-semibold rounded-sm">Confirm paid</button>
              <button data-testid="button-cancel-pay" onClick={() => setConfirmPay(false)} className="px-3 py-1.5 border border-rule rounded-sm">Cancel</button>
            </div>
          ) : (
            <button data-testid="button-pay" onClick={() => setConfirmPay(true)} className="bg-paid text-sheet px-4 py-2 text-sm font-semibold rounded-sm hover:opacity-90">Mark paid (simulation)</button>
          ))}
        </div>
      </Panel>

      <Panel title="Decision record (append-only via app actions)">
        {history.length === 0 ? <p className="p-4 text-[13px] text-muted">No decisions recorded in this browser. Initial status "{inv.status === "pending" ? "pending" : "from fixture"}" came from the seed.</p> : (
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className={th}>#</th><th className={th}>When</th><th className={th}>Role</th><th className={th}>Change</th><th className={th}>Reason</th></tr></thead>
            <tbody>{history.map((d) => (
              <tr key={d.seq} data-testid={`row-decision-${d.seq}`}><td className={td + " num"}>{d.seq}</td><td className={td + " num"}>{new Date(d.at).toLocaleString()}</td><td className={td}>{d.role}</td><td className={td}>{d.from} to {d.to}</td><td className={td}>{d.reason ?? ""}</td></tr>
            ))}</tbody>
          </table>
          </div>
        )}
        <p className="px-4 py-2 text-[11px] text-muted border-t border-rule">Browser storage is not a security boundary or tamper-proof audit record.</p>
      </Panel>
    </div>
  );
}

export function AboutPage() {
  return (
    <Panel title="About this demo" className="max-w-3xl">
      <div className="p-5 space-y-3 text-[14px] leading-relaxed">
        <p>Spend Tracker is a single-browser demonstration built on a synthetic scenario. Suppliers, AFEs, PARs and invoices are invented; this is not company data, policy or branding.</p>
        <p>All money is integer CAD cents, shown as dollars. No tax or FX. Rejected invoices are excluded from all totals. Committed is approved-unpaid plus paid; paid is never counted again as approved. Projected remaining subtracts pending exposure from remaining after committed.</p>
        <p>The demo role switch (viewer / reviewer) is not authentication or enterprise authorization. Approve, reject and mark-paid are simulations; no payment is made.</p>
        <p>State persists in this browser's localStorage only, isolated to this app. Other open tabs refresh automatically when data changes. Corrupt or unreadable storage is reported, never silently reseeded; reset requires confirmation.</p>
      </div>
    </Panel>
  );
}
