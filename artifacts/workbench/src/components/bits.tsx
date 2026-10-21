import type { ReactNode } from "react";
import { AlertTriangle, BadgeCheck, CircleDashed, FlaskConical, Archive, RotateCw } from "lucide-react";
import type { SolutionStatus } from "@workspace/api-client-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export const btn = {
  primary:
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-[16px] font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-[hsl(191_30%_23%)] active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
  accent:
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-siennaink px-6 text-[16px] font-semibold text-white shadow-sm transition-colors hover:bg-[hsl(20_58%_32%)] active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
  secondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-input bg-card px-4 text-[15px] font-medium text-primary transition-colors hover:border-primary/50 hover:bg-secondary active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
  quiet:
    "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
};

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1200px] px-5 pb-20 pt-8 md:px-8", className)}>{children}</div>;
}

export function Headline({ eyebrow, title, sub, testid, right }: { eyebrow?: string; title: ReactNode; sub?: ReactNode; testid?: string; right?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 data-testid={testid ?? "text-headline"} className="text-[30px] font-bold leading-tight md:text-[38px]">{title}</h1>
        {sub && <p data-testid="text-summary" className="mt-2 text-[16px] leading-relaxed text-muted-foreground">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

const statusTone: Record<SolutionStatus, { cls: string; icon: typeof BadgeCheck; label: string }> = {
  certified: { cls: "bg-okbg text-ok", icon: BadgeCheck, label: "Certified" },
  pilot: { cls: "bg-[hsl(196_30%_93%)] text-skyink", icon: CircleDashed, label: "Pilot" },
  experimental: { cls: "bg-accent text-accent-foreground", icon: FlaskConical, label: "Experimental" },
  deprecated: { cls: "bg-muted text-muted-foreground", icon: Archive, label: "Deprecated" },
};
export function StatusPill({ status, className }: { status: SolutionStatus; className?: string }) {
  const t = statusTone[status];
  const Icon = t.icon;
  return (
    <span data-testid="status-solution" className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold", t.cls, className)}>
      <Icon className="h-3.5 w-3.5" /> {t.label}
    </span>
  );
}

export function Tag({ children, tone = "muted", testid }: { children: ReactNode; tone?: "muted" | "sienna" | "green" | "sky" | "slate"; testid?: string }) {
  const cls = { muted: "bg-muted text-muted-foreground", sienna: "bg-accent text-accent-foreground", green: "bg-okbg text-ok", sky: "bg-[hsl(196_30%_93%)] text-skyink", slate: "bg-secondary text-primary" }[tone];
  return <span data-testid={testid} className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-semibold", cls)}>{children}</span>;
}

export function Skel({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-muted", className)} />;
}

export function LoadingView() {
  return (
    <Page>
      <Skel className="mb-3 h-4 w-32" />
      <Skel className="mb-8 h-10 w-2/3" />
      <div className="grid gap-4 md:grid-cols-3"><Skel className="h-48" /><Skel className="h-48" /><Skel className="h-48" /></div>
    </Page>
  );
}

export function ErrorView({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  return (
    <Page>
      <div className="card-soft flex max-w-xl flex-col items-start gap-4 p-7">
        <div className="flex items-center gap-2.5 text-bad">
          <AlertTriangle className="h-5 w-5" />
          <span className="text-lg font-semibold">{message ?? "This could not load."}</span>
        </div>
        {onRetry && (
          <button onClick={onRetry} data-testid="button-retry" className={btn.secondary}>
            <RotateCw className="h-4 w-4" /> Try again
          </button>
        )}
      </div>
    </Page>
  );
}

export function Empty({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div data-testid="state-empty" className="rounded-2xl border border-dashed border-input bg-card/60 px-6 py-12 text-center">
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-secondary"><CircleDashed className="h-5 w-5 text-primary" /></div>
      <div className="text-[17px] font-semibold text-primary">{title}</div>
      {sub && <p className="mx-auto mt-1 max-w-md text-[14.5px] text-muted-foreground">{sub}</p>}
      {children && <div className="mt-5 flex justify-center gap-2">{children}</div>}
    </div>
  );
}

export function Drawer({ open, onClose, title, sub, children, testid }: { open: boolean; onClose: () => void; title: string; sub?: string; children: ReactNode; testid?: string }) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent data-testid={testid ?? "drawer"} className="w-full overflow-y-auto bg-background sm:max-w-[500px]">
        <SheetHeader className="mb-5 text-left">
          <div className="eyebrow">Details</div>
          <SheetTitle className="text-2xl font-bold text-primary">{title}</SheetTitle>
          {sub && <SheetDescription className="text-[15px]">{sub}</SheetDescription>}
        </SheetHeader>
        <div className="space-y-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function DSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <div className="eyebrow mb-2">{label}</div>
      <div className="text-[14.5px] leading-relaxed">{children}</div>
    </section>
  );
}

export function useUndoToast() {
  const { toast } = useToast();
  return (title: string, onUndo?: () => void) =>
    toast({
      title,
      duration: 5000,
      action: onUndo ? (
        <ToastAction altText="Undo" data-testid="button-toast-undo" onClick={onUndo}>
          Undo
        </ToastAction>
      ) : undefined,
    });
}
