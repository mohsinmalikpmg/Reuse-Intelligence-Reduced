import type { ReactNode } from "react";
import type { InvoiceState, Stage } from "./domain/ledger.ts";
import { requiredStages } from "./domain/ledger.ts";
import type { Status } from "./domain/seed.ts";

const STATUS_STYLE: Record<Status, string> = {
  pending: "bg-slate-soft text-slate",
  approved: "bg-verdigris-soft text-verdigris",
  paid: "bg-ink text-paper",
  rejected: "bg-oxblood-soft text-oxblood",
};

export function StatusPill({ status, testId }: { status: Status; testId?: string }) {
  return (
    <span data-testid={testId} className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${STATUS_STYLE[status]}`}>
      {status === "approved" ? "approved, unpaid" : status}
    </span>
  );
}

/** Visual approval path: each required stage as a seal, filled when cleared. */
export function StageTrack({ state }: { state: InvoiceState }) {
  const stages = requiredStages(state.invoice.amountCents);
  const cleared = (s: Stage) => {
    if (state.status === "approved" || state.status === "paid") return state.events.length === 0 || state.events.some((e) => e.action === "approve" && e.fromStage === s);
    return state.events.some((e) => e.action === "approve" && e.fromStage === s);
  };
  return (
    <div className="flex items-center gap-1" aria-label="approval path">
      {stages.map((s, i) => {
        const done = cleared(s);
        const here = state.status === "pending" && state.stage === s;
        return (
          <span key={s} className="flex items-center gap-1">
            {i > 0 && <span className="h-px w-3 bg-rule" />}
            <span
              title={`${s} stage`}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                done ? "border-verdigris bg-verdigris text-paper" : here ? (s === "controller" ? "border-ochre bg-ochre-soft text-ink" : "border-slate bg-slate-soft text-slate") : "border-rule text-muted"
              }`}
            >
              {s === "reviewer" ? "Rev" : "Ctrl"}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function Panel({ title, children, aside, testId }: { title: string; children: ReactNode; aside?: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="rise rounded-md border border-rule bg-card shadow-[0_1px_0_hsl(36_18%_80%)]">
      <header className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5">
        <h2 className="display text-lg">{title}</h2>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function ErrorBox({ message, onRetry, testId = "status-error" }: { message: string; onRetry?: () => void; testId?: string }) {
  return (
    <div role="alert" data-testid={testId} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-oxblood bg-oxblood-soft px-4 py-3 text-sm text-oxblood">
      <span><strong className="mr-1">Error.</strong>{message}</span>
      {onRetry && <button data-testid="button-retry" onClick={onRetry} className="rounded border border-oxblood px-2 py-0.5 text-xs font-semibold hover:bg-oxblood hover:text-paper">Retry</button>}
    </div>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div data-testid="state-empty" className="rounded-md border border-dashed border-rule px-6 py-10 text-center">
      <div className="stamp mx-auto mb-3 inline-block px-3 py-1 text-xs font-bold uppercase text-verdigris">Clear</div>
      <p className="display text-lg">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  );
}

export const inputCls = "rounded border border-rule bg-card px-2.5 py-1.5 text-sm placeholder:text-muted/70 focus:border-ink focus:outline-none";
