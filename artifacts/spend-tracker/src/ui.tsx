import type { ReactNode } from "react";
import { Link } from "wouter";
import type { InvoiceStatus, Rollup } from "@/domain/model.ts";

export const cad = (cents: number) =>
  (cents < 0 ? "-" : "") + "CAD " + (Math.abs(cents) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const STATUS_STYLE: Record<InvoiceStatus, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-ochre-soft text-[hsl(32_80%_28%)] border-ochre/40" },
  approved: { label: "Approved, unpaid", cls: "bg-petrol-soft text-petrol border-petrol/30" },
  paid: { label: "Paid", cls: "bg-paid-soft text-paid border-paid/30" },
  rejected: { label: "Rejected", cls: "bg-[hsl(210_10%_92%)] text-slate border-slate/30 line-through decoration-1" },
};

export function StatusTag({ status, testId }: { status: InvoiceStatus; testId?: string }) {
  const s = STATUS_STYLE[status];
  return <span data-testid={testId} className={`inline-block border rounded-sm px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${s.cls}`}>{s.label}</span>;
}

export function Panel({ title, aside, children, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 bg-sheet border border-rule rounded-sm rise ${className}`}>
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-2">
          <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</h2>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

/** Budget bar: paid | approved-unpaid | pending, laid against the budget line. Overrun spills past the line. */
export function BudgetBar({ r, id }: { r: Rollup; id: string }) {
  const total = Math.max(r.budget, r.committed + r.pending, 1);
  const pct = (x: number) => `${(x / total) * 100}%`;
  return (
    <div data-testid={`bar-${id}`} className="relative h-3 bg-paper border border-rule rounded-[2px] overflow-hidden" aria-hidden>
      <div className="absolute inset-y-0 left-0 flex w-full">
        <div className="bg-paid" style={{ width: pct(r.paid) }} />
        <div className="bg-petrol" style={{ width: pct(r.approvedUnpaid) }} />
        <div className="bg-[repeating-linear-gradient(135deg,var(--color-ochre)_0_4px,hsl(42_80%_70%)_4px_8px)]" style={{ width: pct(r.pending) }} />
      </div>
      <div className="absolute inset-y-[-2px] w-[2px] bg-ink" style={{ left: `calc(${pct(r.budget)} - 1px)` }} title="Budget line" />
    </div>
  );
}

export function Legend() {
  const item = (cls: string, label: string) => (
    <span className="inline-flex items-center gap-1.5"><span className={`inline-block w-3 h-2.5 ${cls}`} />{label}</span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      {item("bg-paid", "Paid")}
      {item("bg-petrol", "Approved, unpaid")}
      {item("bg-ochre", "Pending exposure")}
      <span className="inline-flex items-center gap-1.5"><span className="inline-block w-[2px] h-3 bg-ink" />Budget line</span>
      <span>Rejected is excluded from every bar and total.</span>
    </div>
  );
}

/** Dense numeric ledger for one rollup: the canonical separation of spend states. */
export function RollupLedger({ r, id }: { r: Rollup; id: string }) {
  const row = (label: string, v: number, key: string, cls = "", note?: string) => (
    <tr className="border-t border-rule/70">
      <td className="py-1.5 pr-3 text-[13px]">{label}{note && <span className="block text-[11px] text-muted">{note}</span>}</td>
      <td data-testid={`value-${id}-${key}`} className={`py-1.5 text-right num text-[13px] ${cls}`}>{cad(v)}</td>
    </tr>
  );
  return (
    <table className="w-full">
      <tbody>
        {row("Budget", r.budget, "budget", "font-semibold")}
        {row("Paid", r.paid, "paid", "text-paid")}
        {row("Approved, unpaid", r.approvedUnpaid, "approved", "text-petrol")}
        {row("Committed", r.committed, "committed", "font-semibold", "paid + approved-unpaid; paid is not counted twice")}
        {row("Remaining after committed", r.remaining, "remaining", r.remaining < 0 ? "text-oxblood font-semibold" : "font-semibold")}
        {row("Pending exposure", r.pending, "pending", "text-[hsl(32_80%_32%)]")}
        {row("Projected remaining (incl. pending)", r.projectedRemaining, "projected", r.projectedRemaining < 0 ? "text-oxblood font-semibold" : "font-semibold")}
        {row("Rejected (excluded)", r.rejected, "rejected", "text-slate")}
      </tbody>
    </table>
  );
}

export function OverrunFlags({ r, id }: { r: Rollup; id: string }) {
  if (r.committedOverrun === 0 && r.projectedOverrun === 0) {
    return <span data-testid={`flag-${id}`} className="text-[11px] font-semibold uppercase tracking-wide text-paid">Within budget</span>;
  }
  return (
    <span data-testid={`flag-${id}`} className="flex flex-wrap gap-1.5">
      {r.committedOverrun > 0 && <span className="bg-oxblood text-sheet px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide rounded-sm">Committed overrun {cad(r.committedOverrun)}</span>}
      {r.projectedOverrun > 0 && <span className="border border-oxblood text-oxblood bg-oxblood-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide rounded-sm">Projected overrun {cad(r.projectedOverrun)}</span>}
    </span>
  );
}

export function Crumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted mb-3" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>/</span>}
          {it.href ? <Link data-testid={`crumb-${i}`} href={it.href} className="hover:text-petrol underline-offset-2 hover:underline">{it.label}</Link> : <span className="text-ink font-medium">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}
