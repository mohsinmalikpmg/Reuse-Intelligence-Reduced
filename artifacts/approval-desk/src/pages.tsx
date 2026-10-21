import { useMemo, useState } from "react";
import { Link } from "wouter";
import { SEED, findDuplicates } from "./domain/seed.ts";
import type { Status } from "./domain/seed.ts";
import { allowedActions, formatCad, overallTotals, SINGLE_APPROVAL_LIMIT_CENTS, stageReason, totalsByAfe } from "./domain/ledger.ts";
import type { Action, DecisionEvent, InvoiceState, Role, Totals } from "./domain/ledger.ts";
import { BulkDesk } from "./bulk.tsx";
import type { BulkFn } from "./bulk.tsx";
import { Empty, ErrorBox, Panel, StageTrack, StatusPill, inputCls } from "./ui.tsx";

const supplierName = (id: string) => SEED.suppliers.find((s) => s.id === id)?.name ?? id;
const parName = (id: string) => SEED.pars.find((p) => p.id === id)?.name ?? id;
const DUPES = findDuplicates(SEED.invoices);
const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

type States = Map<string, InvoiceState>;

function matches(s: InvoiceState, q: string) {
  if (!q.trim()) return true;
  const hay = `${s.invoice.id} ${s.invoice.invoiceNumber} ${supplierName(s.invoice.supplierId)} ${s.invoice.afeId} ${s.invoice.parId} ${parName(s.invoice.parId)}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

function InvoiceRow({ s, role, sel }: { s: InvoiceState; role: Role; sel?: { checked: boolean; toggle: () => void } }) {
  const inv = s.invoice;
  const mine = allowedActions(s, role).length > 0;
  return (
    <tr data-testid={`row-invoice-${inv.id}`} className={`border-b border-rule/70 last:border-0 hover:bg-ochre-soft/40 ${mine ? "" : ""}`}>
      {sel && <td className="py-2 pl-1 pr-2"><input type="checkbox" aria-label={`Select ${inv.id}`} data-testid={`checkbox-select-${inv.id}`} checked={sel.checked} onChange={sel.toggle} className="h-4 w-4 accent-[var(--color-ink)]" /></td>}
      <td className="py-2 pr-3">
        <Link href={`/invoices/${inv.id}`} data-testid={`link-invoice-${inv.id}`} className="num font-semibold underline decoration-rule underline-offset-4 hover:decoration-ink">{inv.id}</Link>
      </td>
      <td className="py-2 pr-3">
        <div className="text-sm">{supplierName(inv.supplierId)}</div>
        <div className="num text-xs text-muted">{inv.invoiceNumber} | {inv.date}</div>
      </td>
      <td className="num py-2 pr-3 text-xs">{inv.afeId} / {inv.parId}</td>
      <td className="num py-2 pr-3 text-right" data-testid={`text-amount-${inv.id}`}>{formatCad(inv.amountCents)}</td>
      <td className="py-2 pr-3"><StatusPill status={s.status} testId={`status-invoice-${inv.id}`} /></td>
      <td className="py-2 pr-3"><StageTrack state={s} /></td>
      <td className="py-2 text-xs">
        {DUPES.has(inv.id) && <span className="mr-2 rounded border border-ochre px-1.5 py-0.5 font-semibold text-ochre">Possible duplicate of {DUPES.get(inv.id)!.join(", ")}</span>}
        {mine && <span className="font-semibold text-verdigris">Your decision</span>}
      </td>
    </tr>
  );
}

export interface Selection { selected: ReadonlySet<string>; toggle: (id: string) => void; toggleAllVisible: () => void }

export function InvoiceTable({ rows, role, selection }: { rows: InvoiceState[]; role: Role; selection?: Selection }) {
  const allOn = !!selection && rows.length > 0 && rows.every((r) => selection.selected.has(r.invoice.id));
  const someOn = !!selection && rows.some((r) => selection.selected.has(r.invoice.id));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-muted">
          <tr className="border-b border-ink">{selection && <th className="py-1.5 pl-1 pr-2"><input type="checkbox" aria-label="Select all visible" data-testid="checkbox-select-all-visible" checked={allOn} ref={(el) => { if (el) el.indeterminate = someOn && !allOn; }} onChange={selection.toggleAllVisible} className="h-4 w-4 accent-[var(--color-ink)]" /></th>}<th className="py-1.5 pr-3">ID</th><th className="pr-3">Supplier / number</th><th className="pr-3">AFE / PAR</th><th className="pr-3 text-right">Amount CAD</th><th className="pr-3">Status</th><th className="pr-3">Path</th><th>Notes</th></tr>
        </thead>
        <tbody>{rows.map((s) => <InvoiceRow key={s.invoice.id} s={s} role={role} sel={selection ? { checked: selection.selected.has(s.invoice.id), toggle: () => selection.toggle(s.invoice.id) } : undefined} />)}</tbody>
      </table>
    </div>
  );
}

export function QueuePage({ states, role, bulk }: { states: States; role: Role; bulk: BulkFn }) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<"all" | "reviewer" | "controller" | "mine">(role === "viewer" ? "all" : "mine");
  const open = [...states.values()].filter((s) => s.status === "pending" || (s.status === "approved" && role === "controller"));
  const rows = open.filter((s) => matches(s, q)).filter((s) => {
    if (stage === "mine") return allowedActions(s, role).length > 0;
    if (stage === "all") return true;
    return s.status === "pending" && s.stage === stage;
  });
  const mineCount = open.filter((s) => allowedActions(s, role).length > 0).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Decision queue</p>
          <h1 className="display text-3xl" data-testid="text-queue-headline">
            {role === "viewer" ? "Viewing only. No decisions available." : mineCount === 0 ? "Nothing waits on you." : `${mineCount} invoice${mineCount === 1 ? "" : "s"} wait on the ${role}.`}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Invoices over {formatCad(SINGLE_APPROVAL_LIMIT_CENTS)} need a reviewer approval and then a controller approval; the first approval keeps them pending at controller stage.
            {role === "controller" && " Approved invoices also appear here so the controller can mark them paid (simulation)."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input data-testid="input-queue-search" className={inputCls} placeholder="Search id, supplier, number, AFE" value={q} onChange={(e) => setQ(e.target.value)} />
          <select data-testid="select-queue-stage" className={inputCls} value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}>
            <option value="mine">Actionable by my role</option>
            <option value="all">All open</option>
            <option value="reviewer">Reviewer stage</option>
            <option value="controller">Controller stage</option>
          </select>
        </div>
      </div>
      <BulkDesk states={states} role={role} visible={rows} bulk={bulk} scope="queue">
        {(selection) => (
      <Panel title="Open items" aside={<span className="num text-xs text-muted">{rows.length} shown</span>}>
        {rows.length ? <InvoiceTable rows={rows} role={role} selection={selection} /> : <Empty title="No matching open invoices" body={role === "viewer" ? "Viewers cannot decide. Switch the simulated role or widen the filter to All open." : "Try All open, or clear the search."} />}
      </Panel>
        )}
      </BulkDesk>
    </div>
  );
}

export function AllInvoicesPage({ states, role, bulk }: { states: States; role: Role; bulk: BulkFn }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status | "all">("all");
  const rows = [...states.values()].filter((s) => matches(s, q) && (status === "all" || s.status === status));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="display text-3xl">All invoices</h1><p className="text-sm text-muted">Select any mix of statuses and stages. The bulk review shows which ones your role can decide and why the rest are skipped.</p></div>
        <div className="flex flex-wrap gap-2">
          <input data-testid="input-invoice-search" className={inputCls} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <select data-testid="select-invoice-status" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as Status | "all")}>
            <option value="all">Any status</option><option value="pending">Pending</option><option value="approved">Approved, unpaid</option><option value="paid">Paid</option><option value="rejected">Rejected</option>
          </select>
        </div>
      </div>
      <BulkDesk states={states} role={role} visible={rows} bulk={bulk} scope="all">
        {(selection) => (
          <Panel title="Records" aside={<span className="num text-xs text-muted">{rows.length} of {states.size}</span>}>
            {rows.length ? <InvoiceTable rows={rows} role={role} selection={selection} /> : <Empty title="No invoices match" body="Clear the search or status filter." />}
          </Panel>
        )}
      </BulkDesk>
    </div>
  );
}

const ACTION_LABEL: Record<Action, string> = { approve: "Approve", reject: "Reject", pay: "Mark paid (simulation)" };

export function DetailPage({ id, states, role, decide }: { id: string; states: States; role: Role; decide: (id: string, a: Action, r: Role, reason: string) => { ok: true } | { ok: false; error: string } }) {
  const s = states.get(id);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!s) return <ErrorBox message={`Invoice ${id} does not exist in the seed fixture.`} />;
  const inv = s.invoice;
  const actions = allowedActions(s, role);
  const submit = (a: Action) => {
    setDone(null);
    const r = decide(inv.id, a, role, reason);
    if (!r.ok) { setError(r.error); return; }
    setError(null); setReason(""); setDone(`${ACTION_LABEL[a]} recorded as ledger event.`);
  };
  const blocker =
    role === "viewer" ? "Viewer role cannot decide." :
    s.status === "paid" || s.status === "rejected" ? `${s.status} is terminal; no further decisions.` :
    s.status === "approved" ? "Only the controller can mark approved invoices paid." :
    `This invoice sits at ${s.stage} stage; the ${role} cannot act on it now.`;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <div className="space-y-4">
        <Link href="/invoices" data-testid="link-back" className="text-xs uppercase tracking-wider text-muted hover:text-ink">All invoices</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="display text-4xl" data-testid="text-invoice-id">{inv.id}</h1>
          <StatusPill status={s.status} testId="status-detail" />
          {s.status === "pending" && <span data-testid="text-stage" className="text-sm text-muted">at <strong className="text-ink">{s.stage}</strong> stage</span>}
        </div>
        <Panel title="Invoice">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {[["Supplier", supplierName(inv.supplierId)], ["Invoice number", inv.invoiceNumber], ["Date", inv.date], ["AFE", `${inv.afeId} ${SEED.afes.find((a) => a.id === inv.afeId)?.name ?? ""}`], ["PAR", `${inv.parId} ${parName(inv.parId)}`], ["Amount", formatCad(inv.amountCents)]].map(([k, v]) => (
              <div key={k}><dt className="text-[11px] uppercase tracking-wider text-muted">{k}</dt><dd className="num">{v}</dd></div>
            ))}
          </dl>
          {DUPES.has(inv.id) && <p data-testid="text-duplicate-warning" className="mt-3 rounded border border-ochre bg-ochre-soft px-3 py-2 text-sm">Warning: same supplier and normalized invoice number as {DUPES.get(inv.id)!.join(", ")}. Warnings do not remove amounts or block decisions.</p>}
        </Panel>
        <Panel title="Why this approval path">
          <div className="flex items-center gap-4">
            <StageTrack state={s} />
            <p className="text-sm" data-testid="text-stage-reason">{formatCad(inv.amountCents)} {inv.amountCents > SINGLE_APPROVAL_LIMIT_CENTS ? ">" : "<="} {formatCad(SINGLE_APPROVAL_LIMIT_CENTS)}. {stageReason(inv.amountCents)}</p>
          </div>
        </Panel>
        <Panel title="Decision history">
          <EventList events={s.events} initial={inv.initialStatus} />
        </Panel>
      </div>
      <div>
        <Panel title={`Decide as ${role}`} testId="panel-decide">
          {actions.length === 0 ? (
            <p className="text-sm text-muted" data-testid="text-no-actions">{blocker}</p>
          ) : (
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-[11px] uppercase tracking-wider text-muted">Reason {actions.includes("pay") ? "(optional note)" : "(required for approve and reject)"}</span>
                <textarea data-testid="input-reason" rows={4} className={`${inputCls} mt-1 w-full`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you deciding this way?" />
              </label>
              <div className="flex flex-wrap gap-2">
                {actions.map((a) => (
                  <button key={a} data-testid={`button-${a}`} onClick={() => submit(a)}
                    className={`rounded px-3 py-1.5 text-sm font-semibold transition-transform active:scale-[.98] ${a === "reject" ? "border border-oxblood text-oxblood hover:bg-oxblood hover:text-paper" : a === "pay" ? "bg-ink text-paper hover:bg-slate" : "bg-verdigris text-paper hover:brightness-110"}`}>
                    {ACTION_LABEL[a]}
                  </button>
                ))}
              </div>
              {actions.includes("approve") && s.stage === "reviewer" && inv.amountCents > SINGLE_APPROVAL_LIMIT_CENTS && <p className="text-xs text-muted">Approving now forwards to the controller. Status stays pending.</p>}
            </div>
          )}
          {error && <div className="mt-3"><ErrorBox message={error} testId="status-decision-error" /></div>}
          {done && <p data-testid="status-decision-ok" className="mt-3 text-sm font-semibold text-verdigris">{done}</p>}
        </Panel>
      </div>
    </div>
  );
}

function EventList({ events, initial }: { events: readonly DecisionEvent[]; initial: Status }) {
  return (
    <ol className="space-y-2 text-sm">
      <li className="text-muted">Seed fixture: initial status <strong>{initial}</strong> (immutable).</li>
      {events.map((e) => (
        <li key={e.id} data-testid={`event-${e.seq}`} className="border-l-2 border-ochre pl-3">
          <div className="num text-xs text-muted">#{e.seq} | {fmtTime(e.at)} | {e.role} at {e.fromStage ?? "no"} stage</div>
          <div><strong>{e.action}</strong>: {e.fromStatus} to {e.toStatus}{e.toStage ? ` (now ${e.toStage} stage)` : ""}</div>
          {e.reason && <div className="italic">"{e.reason}"</div>}
          {e.batchId && <div className="num text-[10px] uppercase tracking-wider text-ochre">bulk {e.batchId.slice(0, 14)}</div>}
        </li>
      ))}
      {events.length === 0 && <li className="text-muted">No decisions recorded in this browser yet.</li>}
    </ol>
  );
}

export function HistoryPage({ events }: { events: readonly DecisionEvent[] }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => [...events].reverse().filter((e) => !q || `${e.invoiceId} ${e.role} ${e.action} ${e.reason}`.toLowerCase().includes(q.toLowerCase())), [events, q]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl">Decision ledger</h1>
          <p className="text-sm text-muted">Append-only. Events are created only by decisions and replayed against the seed on every load. There is no edit control by design.</p>
        </div>
        <input data-testid="input-history-search" className={inputCls} placeholder="Filter invoice, role, reason" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Panel title="Events" aside={<span className="num text-xs text-muted">{events.length} total</span>}>
        {rows.length === 0 ? <Empty title="Ledger is empty" body="Decisions you make appear here with role, time, stage, status change and reason." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted"><tr className="border-b border-ink"><th className="py-1.5 pr-3">Seq</th><th className="pr-3">Time</th><th className="pr-3">Invoice</th><th className="pr-3">Role</th><th className="pr-3">Stage</th><th className="pr-3">Status</th><th>Reason</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} data-testid={`row-event-${e.seq}`} className="border-b border-rule/70 align-top">
                    <td className="num py-2 pr-3">{e.seq}</td>
                    <td className="num pr-3 py-2 text-xs">{fmtTime(e.at)}</td>
                    <td className="pr-3 py-2"><Link href={`/invoices/${e.invoiceId}`} className="num underline underline-offset-4">{e.invoiceId}</Link></td>
                    <td className="pr-3 py-2">{e.role}</td>
                    <td className="pr-3 py-2 text-xs">{e.fromStage ?? "-"} to {e.toStage ?? "-"}</td>
                    <td className="pr-3 py-2"><span className="flex items-center gap-1"><StatusPill status={e.fromStatus} /><span className="text-muted">to</span><StatusPill status={e.toStatus} /></span></td>
                    <td className="py-2">{e.reason || <span className="text-muted">-</span>}{e.batchId && <div className="num text-[10px] uppercase tracking-wider text-ochre" data-testid={`text-batch-${e.seq}`}>bulk {e.batchId.slice(0, 14)}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

const TOTAL_ROWS: [keyof Totals, string][] = [
  ["pending", "Pending"], ["approvedUnpaid", "Approved, unpaid"], ["paid", "Paid"], ["rejected", "Rejected (excluded)"],
  ["committed", "Committed = approved-unpaid + paid"], ["budget", "Budget"], ["remaining", "Remaining after committed"], ["projectedRemaining", "Projected remaining after pending"],
];

export function SpendPage({ states }: { states: States }) {
  const all = overallTotals(SEED, states);
  const afes = totalsByAfe(SEED, states);
  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Spend totals</h1>
      <p className="max-w-2xl text-sm text-muted">Each invoice counts once, in its current status. Paid is not counted again as approved. Rejected amounts are excluded from committed and projected figures.</p>
      <Panel title="By AFE and overall">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted">
              <tr className="border-b border-ink"><th className="py-1.5 text-left">Measure (CAD)</th>{afes.map((a) => <th key={a.afeId} className="text-right">{a.afeId} {a.name}</th>)}<th className="text-right">All AFEs</th></tr>
            </thead>
            <tbody>
              {TOTAL_ROWS.map(([k, label]) => (
                <tr key={k} className={`border-b border-rule/70 ${k === "committed" || k === "projectedRemaining" ? "font-semibold" : ""}`}>
                  <td className="py-2">{label}</td>
                  {afes.map((a) => <td key={a.afeId} data-testid={`text-${k}-${a.afeId}`} className={`num text-right ${a.totals[k] < 0 ? "text-oxblood" : ""}`}>{formatCad(a.totals[k])}</td>)}
                  <td data-testid={`text-${k}-all`} className={`num text-right ${all[k] < 0 ? "text-oxblood" : ""}`}>{formatCad(all[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export function AboutPage({ reset, fresh, count }: { reset: () => { ok: true } | { ok: false; error: string }; fresh: boolean; count: number }) {
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="display text-3xl">About this demo</h1>
      <Panel title="What this is">
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>Single-browser demonstration using a synthetic invoice scenario. Not Cenovus data, policy or branding.</li>
          <li>The role selector is a <strong>role simulation, not authentication</strong>. Anyone can pick any role. There is no enterprise authorization.</li>
          <li>No real approvals or payments happen. "Mark paid" only appends a ledger event.</li>
          <li>The ledger lives in this browser's localStorage, isolated to this app. It is not a security boundary or tamper-proof audit record. Corrupt or invalid events block loading and are shown as errors, never silently reseeded.</li>
        </ul>
      </Panel>
      <Panel title="Reset ledger" testId="panel-reset">
        <p className="text-sm text-muted">Currently {count} event{count === 1 ? "" : "s"}{fresh ? " (nothing stored yet)" : ""}. Reset removes all decisions and returns every invoice to its seed status.</p>
        {!confirm ? (
          <button data-testid="button-reset" onClick={() => { setConfirm(true); setMsg(null); }} className="mt-3 rounded border border-oxblood px-3 py-1.5 text-sm font-semibold text-oxblood hover:bg-oxblood hover:text-paper">Reset to seed...</button>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-oxblood bg-oxblood-soft p-3 text-sm">
            <span>Erase {count} decision event{count === 1 ? "" : "s"}? This cannot be undone.</span>
            <button data-testid="button-confirm-reset" onClick={() => { const r = reset(); setConfirm(false); if (r.ok) { setMsg("Ledger reset to seed."); setErr(null); } else setErr(r.error); }} className="rounded bg-oxblood px-3 py-1 font-semibold text-paper">Yes, erase</button>
            <button data-testid="button-cancel-reset" onClick={() => setConfirm(false)} className="rounded border border-rule bg-card px-3 py-1">Cancel</button>
          </div>
        )}
        {msg && <p data-testid="status-reset" className="mt-2 text-sm font-semibold text-verdigris">{msg}</p>}
        {err && <div className="mt-2"><ErrorBox message={err} /></div>}
      </Panel>
    </div>
  );
}
