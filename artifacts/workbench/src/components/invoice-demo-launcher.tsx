import { ExternalLink, Search, ListChecks, Layers } from "lucide-react";
import { btn } from "@/components/bits";

const sources = [
  {
    id: "invoice-finder",
    label: "Source A",
    name: "Invoice Finder",
    capability: "Fuzzy invoice search",
    description: "Find suppliers and invoices despite typos, with ranked results and match explanations.",
    href: "/invoice-finder/",
    icon: Search,
  },
  {
    id: "approval-desk",
    label: "Source B",
    name: "Approval Desk",
    capability: "Multi-select and bulk decisions",
    description: "Review several invoices together, preview eligibility, and preserve each approval stage and decision record.",
    href: "/approval-desk/",
    icon: ListChecks,
  },
  {
    id: "spend-tracker",
    label: "Source C",
    name: "Spend Tracker",
    capability: "Project-to-line-item tracing",
    description: "Group materials and labour across invoices, then trace project spend back to the original invoice lines.",
    href: "/spend-tracker/",
    icon: Layers,
  },
] as const;

/** These links intentionally leave this artifact for separately registered apps.
 * Use native anchors, not the Workbench client router or its BASE_URL.
 */
export function InvoiceDemoLauncher() {
  return (
    <section aria-labelledby="invoice-demo-title" data-testid="section-invoice-demo" className="rounded-2xl border border-border bg-secondary/40 p-5 md:p-6">
      <div className="mb-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">Three independent source apps</p>
        <h2 id="invoice-demo-title" className="font-display text-2xl text-primary">Invoice consolidation demo</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Explore the three standout capabilities to combine later. These synthetic demos save data separately in your browser; a decision in one does not change the others. No fourth consolidated app exists yet.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {sources.map(({ id, label, name, capability, description, href, icon: Icon }) => (
          <article key={id} className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-5" data-testid={`card-demo-${id}`}>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Icon className="h-4 w-4 text-primary" aria-hidden="true" />{label}
            </div>
            <h3 className="mt-3 font-display text-xl text-primary">{name}</h3>
            <p className="mt-2 text-sm font-semibold">{capability}</p>
            <p className="mb-5 mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
            <a href={href} target="_blank" rel="noopener noreferrer" className={`${btn.secondary} mt-auto`} data-testid={`link-open-${id}`} aria-label={`Open ${name} in a new tab`}>
              Open app <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </article>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Opens in a new tab so you can keep Workbench open. Synthetic data only; no real approvals or payments.</p>
    </section>
  );
}
