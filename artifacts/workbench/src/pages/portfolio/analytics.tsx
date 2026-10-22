import { useState } from "react";
import { useGetPortfolioAnalytics } from "@workspace/api-client-react";
import { ErrorView, Headline, Page, Skel } from "@/components/bits";
import { AdoptionRecords, AppsRecords, CapabilityRecords, CombinationRecords } from "@/components/portfolio/analytics-records";
import { ReuseSignals } from "@/components/portfolio/reuse-signals";
import { cn } from "@/lib/utils";

type Key = "apps" | "capabilities" | "combinations" | "adoption";

/** Analytics: read-only. Each headline opens the exact records it counts. Decisions live only in Review. */
export default function PortfolioAnalytics() {
  const q = useGetPortfolioAnalytics();
  const [sel, setSel] = useState<Key>("apps");
  if (q.isLoading) return <Page><Skel className="mb-7 h-20 w-2/3" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skel key={i} className="h-36" />)}</div></Page>;
  if (q.isError || !q.data) return <ErrorView onRetry={() => q.refetch()} message="Analytics could not load." />;
  const d = q.data;
  const tiles: { key: Key; label: string; value: string; muted?: boolean; sub: string; definition: string }[] = [
    { key: "apps", label: "Apps registered", value: String(d.apps.registered), muted: d.apps.registered === 0, sub: `${d.apps.consolidationSources} sources · ${d.apps.prototypes} prototypes · ${d.apps.newRegistered} new in ${d.apps.newWindowDays} days. Plus ${d.apps.catalog} demo catalog, not registered`, definition: d.apps.definition },
    { key: "capabilities", label: "Unique capabilities", value: String(d.capabilities.unique), sub: `from ${d.capabilities.sourceApps} source apps · ${d.capabilities.shared} shared`, definition: d.capabilities.definition },
    { key: "combinations", label: "Combinations", value: `${d.combinations.approved} of ${d.combinations.proposed}`, muted: d.combinations.proposed === 0, sub: `approved of proposed · ${d.combinations.published} published · ${d.combinations.saved} saved, not proposed`, definition: d.combinations.definition },
    { key: "adoption", label: "Consolidated app adoption", value: "Not tracked yet", muted: true, sub: `${d.adoption.consolidatedApps.length} consolidated app${d.adoption.consolidatedApps.length === 1 ? "" : "s"} published`, definition: d.adoption.note },
  ];
  const cur = tiles.find((t) => t.key === sel)!;
  return (
    <Page>
      <Headline stage="converge" eyebrow="Analytics" title="What the portfolio holds." accent="Counted, not claimed."
        sub="Each measure opens the records behind it. Demo catalog, registered apps and IT-approved work are kept apart. Nothing here records a decision; that happens in Review." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="tablist" data-testid="section-headlines">
        {tiles.map((t) => (
          <button key={t.key} role="tab" aria-selected={sel === t.key} onClick={() => setSel(t.key)} data-testid={`tile-${t.key}`}
            className={cn("card-soft p-5 text-left transition-[border-color,transform] hover:-translate-y-0.5", sel === t.key ? "border-primary ring-1 ring-primary" : "")}>
            <div className="text-[13px] font-medium text-muted-foreground">{t.label}</div>
            <div className={cn("mt-1 text-[30px] font-bold leading-tight", t.muted ? "text-muted-foreground text-[22px]" : "text-primary")} data-testid={`value-${t.key}`}>{t.value}</div>
            <div className="mt-1 text-[12.5px] text-muted-foreground">{t.sub}</div>
          </button>
        ))}
      </div>

      <section className="mt-6" role="tabpanel" data-testid={`panel-${sel}`}>
        <h2 className="text-[20px] font-semibold">{cur.label}</h2>
        <p className="mb-4 mt-1 max-w-3xl text-[13.5px] leading-relaxed text-muted-foreground">{cur.definition}</p>
        {sel === "apps" && <AppsRecords a={d.apps} />}
        {sel === "capabilities" && <CapabilityRecords c={d.capabilities} />}
        {sel === "combinations" && <CombinationRecords c={d.combinations} />}
        {sel === "adoption" && <AdoptionRecords a={d.adoption} />}
      </section>

      <h2 className="mb-1 mt-12 text-[20px] font-semibold">Reuse signals</h2>
      <p className="mb-3 text-[13.5px] text-muted-foreground">Measured from recorded reuse checks, proposals and votes.</p>
      <ReuseSignals />
    </Page>
  );
}
