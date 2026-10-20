import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, RotateCw } from "lucide-react";
import type { CaseStatus, EvidenceLevel, SolutionStatus } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { caseStatus, evidence, solutionStatus, type Tone } from "@/lib/labels";

const tones: Record<Tone, string> = {
  ok: "bg-ok/10 text-ok border-ok/30",
  signal: "bg-primary/10 text-primary border-primary/35",
  warn: "bg-warn/10 text-warn border-warn/35",
  bad: "bg-bad/10 text-bad border-bad/30",
  ink: "bg-ink/[0.06] text-foreground border-foreground/20",
  muted: "bg-muted text-muted-foreground border-border",
};

export function Tag({ tone = "muted", children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] border px-1.5 py-[1px] font-mono text-[10.5px] font-medium uppercase tracking-wider", tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function SolutionBadge({ status }: { status: SolutionStatus }) {
  const [l, t] = solutionStatus[status];
  return <Tag tone={t}>{status === "certified" ? "\u2713 " : ""}{l}</Tag>;
}
export function CaseBadge({ status }: { status: CaseStatus }) {
  const [l, t] = caseStatus[status];
  return <Tag tone={t}>{l}</Tag>;
}
export function EvidenceBadge({ level }: { level: EvidenceLevel }) {
  const [l, t] = evidence[level];
  return <Tag tone={t}>{l}</Tag>;
}

export function Rise({ i = 0, children, className }: { i?: number; children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(i, 12) * 0.035, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function PageHeader({ eyebrow, title, sub, right }: { eyebrow?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="text-3xl font-bold leading-[1.05] md:text-[40px]">{title}</h1>
        {sub && <p className="mt-2 text-[15px] text-muted-foreground">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Panel({ title, right, children, className, pad = true }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cn("rounded-md border bg-card", className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <h3 className="eyebrow !text-foreground">{title}</h3>
          {right}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Meter({ value, tone = "signal", className }: { value: number; tone?: Tone; className?: string }) {
  const bg = { ok: "bg-ok", signal: "bg-primary", warn: "bg-warn", bad: "bg-bad", ink: "bg-foreground", muted: "bg-muted-foreground" }[tone];
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <motion.div className={cn("h-full origin-left rounded-full", bg)} style={{ width: "100%" }} initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0, Math.min(100, value)) / 100 }} transition={{ duration: 0.5, ease: "easeOut" }} />
    </div>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className={cn("rounded-md border bg-card px-3.5 py-3", accent && "border-primary/40 bg-accent")}>
      <div className="eyebrow">{label}</div>
      <div className={cn("mt-1 font-display text-[28px] font-bold leading-none tabular-nums", accent && "text-primary")}>{value}</div>
      {hint && <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Skel({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function LoadingRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skel key={i} className="h-16" />
      ))}
    </div>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-bad/30 bg-bad/5 p-5">
      <div className="flex items-center gap-2 text-bad">
        <AlertTriangle className="h-4 w-4" />
        <span className="text-sm font-semibold">{message ?? "This view could not load."}</span>
      </div>
      {onRetry && (
        <button onClick={onRetry} data-testid="button-retry" className="inline-flex items-center gap-1.5 rounded border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted">
          <RotateCw className="h-3.5 w-3.5" /> Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="hatch flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-10 text-center">
      {icon && <div className="mb-1 text-primary">{icon}</div>}
      <div className="font-display text-lg font-semibold">{title}</div>
      {body && <p className="max-w-sm text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_1px_0_hsl(var(--ink)/.25),inset_0_1px_0_hsl(0_0%_100%/.2)] transition-transform hover:brightness-105 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none";
export const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted active:translate-y-px disabled:opacity-50 disabled:pointer-events-none";
export const btnGhost =
  "inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
