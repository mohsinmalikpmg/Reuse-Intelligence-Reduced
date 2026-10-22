import { featureEnabled, type Recipe } from "@/domain/recipe";
import { suppliers } from "@/domain/engine";

export const cad = (c: number) => (c / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
export const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name ?? id;
export const stamp = (iso: string) => iso.replace("T", " ").slice(0, 19);

export type FeatureKey = "fuzzy-matching" | "structured-filters" | "duplicate-warnings" | "invoice-details" | "bulk-actions" | "review-queue" | "budget-positions" | "spend-tracing" | "decision-history";
export type Feat = (id: FeatureKey) => boolean;
export function makeFeat(recipe: Recipe): Feat {
  return (id) => {
    if (id === "invoice-details") return true;
    if (id === "spend-tracing" && !featureEnabled(recipe, "budget-positions")) return false;
    return featureEnabled(recipe, id);
  };
}

export type View = "invoices" | "queue" | "budgets" | "activity";
export type Experience = "invoice-led" | "review-led" | "budget-led";
export function experienceOf(recipe: Recipe): Experience {
  const e = (recipe as unknown as { experience?: string }).experience;
  return e === "review-led" || e === "budget-led" ? e : "invoice-led";
}
export const VIEW_FEATURE: Record<View, FeatureKey> = { invoices: "invoice-details", queue: "review-queue", budgets: "budget-positions", activity: "decision-history" };
export const VIEW_LABEL: Record<View, string> = { invoices: "Invoices", queue: "Review queue", budgets: "Budgets", activity: "Activity" };

const STATUS_TONE: Record<string, string> = {
  pending: "bg-[hsl(40_70%_88%)] text-[hsl(32_60%_28%)] dark:bg-[hsl(38_35%_18%)] dark:text-[hsl(40_75%_72%)]",
  approved: "bg-[hsl(158_30%_86%)] text-[hsl(158_40%_22%)] dark:bg-[hsl(158_25%_16%)] dark:text-[hsl(158_45%_66%)]",
  rejected: "bg-[hsl(2_60%_90%)] text-[hsl(2_60%_34%)] dark:bg-[hsl(2_35%_18%)] dark:text-[hsl(2_70%_72%)]",
  paid: "bg-[hsl(222_40%_88%)] text-[hsl(222_52%_24%)] dark:bg-[hsl(222_30%_20%)] dark:text-[hsl(220_60%_78%)]",
};
export function Pill({ status }: { status: string }) {
  return <span className={`inline-block rounded-sm px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider ${STATUS_TONE[status] ?? "bg-muted"}`}>{status}</span>;
}

export function PageHead({ kicker, title, note, children }: { kicker: string; title: React.ReactNode; note?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rise mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-foreground/80 pb-4">
      <div>
        <p className="num text-[11px] uppercase tracking-widest text-accent">{kicker}</p>
        <h1 className="font-display mt-1 text-3xl md:text-4xl">{title}</h1>
        {note && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{note}</p>}
      </div>
      {children}
    </div>
  );
}

export function Unavailable({ what, onHome }: { what: string; onHome: () => void }) {
  return (
    <div data-testid="state-feature-unavailable" className="rise mx-auto mt-10 max-w-lg border border-dashed border-foreground/40 bg-card p-8">
      <p className="num text-[11px] uppercase tracking-widest text-muted-foreground">Not in this recipe</p>
      <h2 className="font-display mt-2 text-2xl">{what} is not part of this configuration.</h2>
      <p className="mt-2 text-sm text-muted-foreground">The link points at a feature this saved recipe leaves out, so nothing from it is shown.</p>
      <button onClick={onHome} className="mt-5 bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90">Go to invoices</button>
    </div>
  );
}

export const segBtn = (on: boolean) => `border px-2.5 py-1 text-xs capitalize transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-foreground/40"}`;
