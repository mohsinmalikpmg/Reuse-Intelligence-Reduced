import { Link } from "wouter";
import { type SpendState } from "@/domain/model.ts";
import {
  CATEGORIES, CATEGORY_LABEL, groupTrace, linesOfInvoice, scopeLabel, tracedLines,
  type GroupTotals, type GroupTrace, type LineCategory, type Scope, type TracedLine,
} from "@/domain/lines.ts";
import { Panel, StatusTag, cad } from "@/ui.tsx";

const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted";
const thr = th + " text-right";
const td = "px-3 py-1.5 text-[13px] border-t border-rule/70";
const tdr = td + " text-right num";

export function parseScope(s: SpendState, raw: string | undefined): Scope | null {
  if (!raw || raw === "all") return { level: "portfolio" };
  if (s.afes[raw]) return { level: "afe", id: raw };
  if (s.pars[raw]) return { level: "par", id: raw };
  return null;
}
const scopeKey = (sc: Scope) => (sc.level === "portfolio" ? "all" : sc.id);
const isCat = (x: string | undefined): x is LineCategory => x === "materials" || x === "labour";

function LineError({ e }: { e: unknown }) {
  return (
    <div role="alert" data-testid="alert-lines" className="border-l-4 border-oxblood bg-oxblood-soft px-4 py-3 text-[13px]">
      <b>Source lines failed validation.</b> {e instanceof Error ? e.message : String(e)}. Line totals are withheld rather than shown unreconciled.
    </div>
  );
}

/** Scope picker: portfolio, each project (AFE), each PAR suballocation indented under it. */
function ScopeRail({ s, sc, group }: { s: SpendState; sc: Scope; group: LineCategory | null }) {
  const href = (k: string) => `/trace/${k}${group ? `/${group}` : ""}`;
  const cur = scopeKey(sc);
  const item = (k: string, label: string, sub: string, indent = false) => (
    <Link key={k} data-testid={`scope-${k}`} href={href(k)}
      className={`block border-l-[3px] px-3 py-2 ${indent ? "pl-7" : ""} ${cur === k ? "border-ochre bg-sheet" : "border-transparent hover:bg-sheet/70"}`}>
      <span className={`num text-[13px] ${cur === k ? "font-semibold text-ink" : "text-petrol"}`}>{label}</span>
      <span className="block text-[11px] text-muted">{sub}</span>
    </Link>
  );
  return (
    <nav aria-label="Trace scope" className="border border-rule bg-paper rounded-sm py-1 lg:sticky lg:top-20">
      {item("all", "Portfolio", "All projects")}
      {Object.values(s.afes).map((a) => [
        item(a.id, a.id, `Project: ${a.name}`),
        ...a.parIds.map((pid) => item(pid, pid, `PAR: ${s.pars[pid].name}`, true)),
      ])}
    </nav>
  );
}

function GroupCard({ cat, g, active, href }: { cat: LineCategory; g: GroupTotals; active: boolean; href: string }) {
  const cell = (label: string, v: number, cls = "", key = "") => (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.1em] text-muted">{label}</div>
      <div data-testid={`group-${cat}-${key}`} className={`num text-[14px] ${cls}`}>{cad(v)}</div>
    </div>
  );
  return (
    <Link href={href} data-testid={`button-group-${cat}`} aria-pressed={active}
      className={`group block border rounded-sm p-4 transition-transform hover:-translate-y-0.5 ${active ? "border-ink bg-sheet shadow-[4px_4px_0_hsl(38_84%_44%)]" : "border-rule bg-sheet hover:border-petrol"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-xl font-semibold">{CATEGORY_LABEL[cat]}</h3>
        <span className="text-[11px] text-muted">{g.lineCount} lines across {g.invoiceIds.length} invoices</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[11px] uppercase tracking-[0.1em] text-muted">Committed</span>
        <span data-testid={`group-${cat}-committed`} className="num text-2xl font-semibold">{cad(g.committed)}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cell("Pending", g.pending, "text-[hsl(32_80%_32%)]", "pending")}
        {cell("Appr. unpaid", g.approvedUnpaid, "text-petrol", "approved")}
        {cell("Paid", g.paid, "text-paid", "paid")}
        {cell("Rejected (excl.)", g.rejected, "text-slate line-through", "rejected")}
      </div>
      <div className="mt-3 text-[12px] text-petrol font-semibold">{active ? "Showing source lines below" : "Trace to source lines"} <span aria-hidden>&rarr;</span></div>
    </Link>
  );
}

function LinesTable({ rows, testPrefix, showInvoice = true }: { rows: TracedLine[]; testPrefix: string; showInvoice?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px]">
        <thead><tr>
          <th className={th}>Line</th>{showInvoice && <><th className={th}>Supplier</th><th className={th}>Invoice</th></>}
          <th className={th}>PAR</th><th className={th}>Category</th><th className={th}>Description</th><th className={th}>Status</th><th className={thr}>Amount</th>
        </tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.line.id} data-testid={`row-${testPrefix}-${t.line.id}`} className={t.status === "rejected" ? "bg-paper/60" : ""}>
              <td className={td + " num font-semibold"}>{t.line.id}</td>
              {showInvoice && <>
                <td className={td}>{t.supplierName}</td>
                <td className={td}><Link data-testid={`link-line-invoice-${t.line.id}`} href={`/invoices/${t.invoice.id}`} className="text-petrol hover:underline"><span className="num font-semibold">{t.invoice.id}</span> <span className="num text-muted">{t.invoice.number}</span></Link></td>
              </>}
              <td className={td + " num"}>{t.invoice.parId}</td>
              <td className={td}>{CATEGORY_LABEL[t.line.category]}</td>
              <td className={td}>{t.line.description}</td>
              <td className={td}><StatusTag status={t.status} /></td>
              <td className={tdr + (t.status === "rejected" ? " text-slate line-through" : "")}>{cad(t.line.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TracePage({ s, scopeRaw, groupRaw }: { s: SpendState; scopeRaw?: string; groupRaw?: string }) {
  const sc = parseScope(s, scopeRaw);
  if (!sc) return <div data-testid="text-missing" className="p-6 text-sm">Scope {scopeRaw} does not exist. <Link href="/" className="text-petrol underline">Back to trace</Link></div>;
  const group = isCat(groupRaw) ? groupRaw : null;
  let gt: GroupTrace;
  let rows: TracedLine[] = [];
  try {
    gt = groupTrace(s, sc);
    if (group) rows = tracedLines(s, sc, group);
  } catch (e) {
    return <div className="space-y-4"><h1 className="font-display text-3xl font-semibold">Line-item trace</h1><LineError e={e} /></div>;
  }
  const k = scopeKey(sc);
  const recon: [string, keyof typeof gt.invoiceTotals][] = [["Pending", "pending"], ["Approved, unpaid", "approvedUnpaid"], ["Paid", "paid"], ["Committed", "committed"], ["Rejected (excluded)", "rejected"]];
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Project <span aria-hidden>&rarr;</span> line-item group <span aria-hidden>&rarr;</span> source invoice line</div>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Where did the {group ? CATEGORY_LABEL[group].toLowerCase() : "money"} go?</h1>
        <p className="text-sm text-muted max-w-3xl">Materials and labour are grouped across every invoice in <b data-testid="text-scope" className="text-ink">{scopeLabel(s, sc)}</b>. Pick a group to see the exact source lines, then follow any line back to its invoice. Line status comes from the invoice decision, so approving, paying or rejecting moves every line on that invoice together.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <ScopeRail s={s} sc={sc} group={group} />
        <div className="space-y-4 min-w-0">
          <div className="grid gap-3 md:grid-cols-2">
            {CATEGORIES.map((c) => (
              <GroupCard key={c} cat={c} g={gt.groups[c]} active={group === c} href={group === c ? `/trace/${k}` : `/trace/${k}/${c}`} />
            ))}
          </div>

          {group ? (
            <Panel title={`${CATEGORY_LABEL[group]} source lines in ${sc.level === "portfolio" ? "portfolio" : sc.id} (${rows.length})`}
              aside={<Link data-testid="button-close-group" href={`/trace/${k}`} className="text-[12px] text-petrol underline">Close</Link>}>
              {rows.length === 0
                ? <p data-testid="empty-lines" className="p-6 text-sm text-muted">No {group} lines in this scope.</p>
                : <LinesTable rows={rows} testPrefix="trace" />}
              <p className="px-3 py-2 text-[11px] text-muted border-t border-rule">Sum of non-rejected lines: <span data-testid="text-lines-sum" className="num text-ink">{cad(rows.filter((t) => t.status !== "rejected").reduce((a, t) => a + t.line.cents, 0))}</span>. Rejected lines are listed for provenance and excluded from totals.</p>
            </Panel>
          ) : (
            <div data-testid="hint-pick-group" className="border border-dashed border-rule rounded-sm p-6 text-center text-sm text-muted">Select Materials or Labour above to list its source lines across invoices.</div>
          )}

          <Panel title="Groups reconcile to invoices" aside={<span data-testid="status-trace-recon" className={`text-[11px] font-semibold uppercase tracking-wide ${gt.reconciles ? "text-paid" : "text-oxblood"}`}>{gt.reconciles ? "Materials + labour = invoice totals" : "Mismatch"}</span>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead><tr><th className={th}>Bucket</th>{CATEGORIES.map((c) => <th key={c} className={thr}>{CATEGORY_LABEL[c]}</th>)}<th className={thr}>Groups total</th><th className={thr}>Invoice rows</th></tr></thead>
                <tbody>{recon.map(([l, key]) => (
                  <tr key={key}><td className={td}>{l}</td>{CATEGORIES.map((c) => <td key={c} className={tdr}>{cad(gt.groups[c][key])}</td>)}
                    <td className={tdr + " font-semibold"}>{cad(gt.total[key])}</td><td data-testid={`recon-invoices-${key}`} className={tdr}>{cad(gt.invoiceTotals[key])}</td></tr>
                ))}</tbody>
              </table>
            </div>
            {!gt.reconciles && <p className="p-3 text-[12px] text-oxblood">{gt.differences.join("; ")}</p>}
            <p className="px-3 py-2 text-[11px] text-muted border-t border-rule">Committed = approved-unpaid + paid; paying an invoice moves its lines from approved-unpaid to paid without changing committed. Budget bars and overrun analysis live under <Link href="/budget" className="text-petrol underline">Budget</Link>.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Invoice detail panel: the invoice's actual source lines. */
export function InvoiceLines({ s, id }: { s: SpendState; id: string }) {
  let rows: TracedLine[];
  try { rows = linesOfInvoice(s, id); } catch (e) { return <LineError e={e} />; }
  const inv = s.invoices[id];
  return (
    <Panel title={`Source lines (${rows.length})`} aside={<span className="num text-[12px] text-muted">Lines sum {cad(rows.reduce((a, t) => a + t.line.cents, 0))} = invoice {cad(inv.cents)}</span>}>
      <LinesTable rows={rows} testPrefix="invoice-line" showInvoice={false} />
      <p className="px-3 py-2 text-[11px] text-muted border-t border-rule">
        Trace in group: {rows.map((t) => <Link key={t.line.id} data-testid={`link-trace-${t.line.id}`} href={`/trace/${inv.afeId}/${t.line.category}`} className="text-petrol underline mr-3">{inv.afeId} {CATEGORY_LABEL[t.line.category].toLowerCase()}</Link>)}
      </p>
    </Panel>
  );
}
