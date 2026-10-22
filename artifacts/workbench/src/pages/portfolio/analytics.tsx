import { useMemo, useRef, useState, type ReactNode } from "react";
import { getGetPortfolioAnalyticsQueryKey, useGetPortfolioAnalytics } from "@workspace/api-client-react";
import { Activity, Info, X } from "lucide-react";
import { ErrorView, Headline, Page, Skel } from "@/components/bits";
import { AdoptionRecords, AppsRecords, CapabilityRecords, CombinationRecords, STAGE, type AppsFilter, type CapsFilter, type CombosFilter } from "@/components/portfolio/analytics-records";
import { DrillChart, TimeColumns } from "@/components/portfolio/analytics-chart";
import { ReuseSignals } from "@/components/portfolio/reuse-signals";
import { capabilitySharing, composition, registrationDays, stageCounts, STAGES } from "@/lib/analytics-aggregate";

type Drill =
  | { key: "apps"; f: AppsFilter }
  | { key: "capabilities"; f: CapsFilter }
  | { key: "combinations"; f: CombosFilter }
  | { key: "adoption" };

const TITLES: Record<Drill["key"], string> = { apps: "App records", capabilities: "Capability records", combinations: "Consolidation records", adoption: "Published consolidated apps" };

function Panel({ title, hint, children, testid, action }: { title: string; hint: string; children: ReactNode; testid: string; action?: ReactNode }) {
  return (
    <section className="card-soft flex flex-col p-5" data-testid={testid}>
      <div className="mb-3 flex items-start gap-2">
        <h2 className="text-[15.5px] font-semibold">{title}</h2>
        <span className="ml-auto">{action}</span>
      </div>
      <p className="-mt-2 mb-3 text-[12.5px] text-muted-foreground">{hint}</p>
      {children}
    </section>
  );
}

function Definition({ text, testid }: { text: string; testid: string }) {
  return (
    <details className="mt-3 text-[12.5px] text-muted-foreground" data-testid={testid}>
      <summary className="inline-flex cursor-pointer items-center gap-1 font-medium text-primary"><Info className="h-3.5 w-3.5" aria-hidden />How this is counted</summary>
      <p className="mt-1.5 leading-relaxed">{text}</p>
    </details>
  );
}

/** Analytics: read-only dashboard. Charts and their button equivalents open the exact records behind each count. Decisions live only in Review. */
export default function PortfolioAnalytics() {
  const q = useGetPortfolioAnalytics({ query: { queryKey: getGetPortfolioAnalyticsQueryKey(), staleTime: 60_000, refetchInterval: 5 * 60_000 } });
  const [drill, setDrill] = useState<Drill | null>(null);
  const drillRef = useRef<HTMLElement>(null);
  const d = q.data;

  const agg = useMemo(() => d && ({
    comp: composition(d.apps.records),
    reg: registrationDays(d.apps.records),
    share: capabilitySharing(d.capabilities.records),
    stages: stageCounts(d.combinations.records),
  }), [d]);

  if (q.isLoading) return <Page><Skel className="mb-7 h-20 w-2/3" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skel key={i} className="h-28" />)}</div><div className="mt-6 grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skel key={i} className="h-72" />)}</div></Page>;
  if (q.isError || !d || !agg) return <ErrorView onRetry={() => q.refetch()} message="Analytics could not load." />;

  const open = (next: Drill) => { setDrill(next); requestAnimationFrame(() => { const el = drillRef.current; if (!el) return; el.focus({ preventScroll: true }); el.scrollIntoView({ behavior: "smooth", block: "start" }); }); };
  const { comp, reg, share, stages } = agg;
  const portfolioCombos = STAGES.filter((s) => s !== "saved").reduce((n, s) => n + stages[s].total, 0);

  const cards: { label: string; value: string; sub: string; muted?: boolean; go: Drill; testid: string }[] = [
    { label: "Registered apps", value: String(d.apps.registered), sub: `${d.apps.consolidationSources} sources · ${d.apps.prototypes} prototypes`, muted: d.apps.registered === 0, go: { key: "apps", f: "registered" }, testid: "apps" },
    { label: "Shared capabilities", value: `${share.shared.total}`, sub: `of ${share.shared.total + share.single.total + share.unassessed.total} distinct capabilities`, go: { key: "capabilities", f: "shared" }, testid: "capabilities" },
    { label: "Approved consolidations", value: String(stages.approved.total + stages.published.total), sub: `${stages.published.total} published · ${portfolioCombos} in portfolio`, muted: portfolioCombos === 0, go: { key: "combinations", f: "approved_any" }, testid: "combinations" },
    { label: "Adoption", value: "Not tracked yet", sub: "No usage telemetry recorded", muted: true, go: { key: "adoption" }, testid: "adoption" },
  ];

  return (
    <Page>
      <Headline stage="converge" eyebrow="Analytics" title="What the portfolio holds." accent="Counted, not claimed."
        sub="Select any bar or count to see the records behind it. Decisions happen in Review." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="section-headlines">
        {cards.map((c) => (
          <button type="button" key={c.testid} onClick={() => open(c.go)} data-testid={`tile-${c.testid}`}
            className="card-soft p-5 text-left transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="text-[12.5px] font-medium uppercase tracking-wide text-muted-foreground">{c.label}</div>
            <div className={c.muted ? "mt-1 text-[22px] font-bold leading-tight text-muted-foreground" : "mt-1 font-mono text-[34px] font-bold leading-tight tabular-nums text-primary"} data-testid={`value-${c.testid}`}>{c.value}</div>
            <div className="mt-1 text-[12.5px] text-muted-foreground">{c.sub}</div>
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel testid="chart-composition" title="App composition" hint={`${d.apps.registered} registered · ${d.apps.catalog} demo catalog, not registered`}>
          <DrillChart testid="chart-apps" caption="App composition, open records" active={drill?.key === "apps" ? drill.f : null}
            onPick={(k) => open({ key: "apps", f: k as AppsFilter })}
            data={[
              { key: "consolidation_source", label: "Sources", real: comp.consolidation_source.total - comp.consolidation_source.demo, demo: comp.consolidation_source.demo, note: "registered" },
              { key: "prototype", label: "Prototypes", real: comp.prototype.total - comp.prototype.demo, demo: comp.prototype.demo, note: "registered" },
              { key: "catalog", label: "Catalog", real: comp.catalog.total - comp.catalog.demo, demo: comp.catalog.demo, note: "demo, not registered" },
            ]} />
          <Definition testid="def-apps" text={d.apps.definition} />
        </Panel>

        <Panel testid="chart-registrations" title="Registration activity" hint="One column per recorded registration date. No gaps filled, no trend line.">
          {reg.days.length === 0 ? (
            <p className="rounded-xl border border-dashed border-input px-4 py-8 text-center text-[13.5px] text-muted-foreground" data-testid="registrations-empty">No dated registrations recorded yet.</p>
          ) : (
            <TimeColumns testid="chart-days" days={reg.days} active={drill?.key === "apps" && drill.f.startsWith("day:") ? drill.f.slice(4) : null}
              onPick={(k) => open({ key: "apps", f: `day:${k}` })} />
          )}
          <p className="mt-3 text-[12px] text-muted-foreground" data-testid="registrations-excluded">
            Excluded: {reg.catalog} demo catalog entr{reg.catalog === 1 ? "y" : "ies"} (never registered)
            {reg.undated > 0 && <> · <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => open({ key: "apps", f: "undated" })} data-testid="button-undated">{reg.undated} registered without a date</button></>}.
          </p>
        </Panel>

        <Panel testid="chart-sharing" title="Capability sharing" hint="Distinct capabilities by how many apps (registered or demo catalog) declare them. Declarations are not adoption.">
          <DrillChart testid="chart-caps" caption="Capability sharing, open records" layout="vertical" active={drill?.key === "capabilities" ? drill.f : null}
            onPick={(k) => open({ key: "capabilities", f: k as CapsFilter })}
            data={[
              { key: "shared", label: "Shared (2+ apps)", real: share.shared.total - share.shared.demo, demo: share.shared.demo },
              { key: "single", label: "Single source", real: share.single.total - share.single.demo, demo: share.single.demo },
              { key: "unassessed", label: "Not assessed", real: share.unassessed.total - share.unassessed.demo, demo: share.unassessed.demo, note: "no declaring app" },
            ]} />
          <Definition testid="def-caps" text={d.capabilities.definition} />
        </Panel>

        <Panel testid="chart-stages" title="Consolidations by current stage" hint="Each record counted once at its current stage. Not a funnel.">
          <DrillChart testid="chart-combos" caption="Consolidations by current stage, open records" layout="vertical" active={drill?.key === "combinations" ? drill.f : null}
            onPick={(k) => open({ key: "combinations", f: k as CombosFilter })}
            data={STAGES.map((s) => ({ key: s, label: STAGE[s].short, real: stages[s].total - stages[s].demo, demo: stages[s].demo, note: s === "saved" ? "visible only to you" : undefined }))} />
          <p className="mt-3 text-[12px] text-muted-foreground">Private drafts are yours only; the other {portfolioCombos} are portfolio records.</p>
          <Definition testid="def-combos" text={d.combinations.definition} />
        </Panel>
      </div>

      <section className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl border-2 border-dashed border-input bg-secondary/40 p-5" data-testid="panel-adoption-status">
        <Activity className="h-7 w-7 text-muted-foreground" aria-hidden />
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
          <div className="text-[19px] font-bold">Adoption: Not tracked yet</div>
          <p className="text-[13px] text-muted-foreground">FUSEBOX records no usage of consolidated apps, so there are no user, team or trend figures to show.</p>
        </div>
        <button type="button" onClick={() => open({ key: "adoption" })} className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-semibold text-primary hover:bg-secondary" data-testid="button-adoption-records">
          {d.adoption.consolidatedApps.length} published app{d.adoption.consolidatedApps.length === 1 ? "" : "s"}
        </button>
      </section>

      {drill && (
        <section ref={drillRef} tabIndex={-1} className="mt-8 scroll-mt-24 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-live="polite" data-testid={`panel-${drill.key}`}>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[20px] font-semibold">{TITLES[drill.key]}</h2>
            <button type="button" onClick={() => setDrill(null)} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] text-muted-foreground hover:bg-secondary" data-testid="button-close-records">
              <X className="h-4 w-4" aria-hidden />Close records
            </button>
          </div>
          {drill.key === "apps" && <AppsRecords a={d.apps} generatedAt={d.generatedAt} filter={drill.f} onFilter={(f) => setDrill({ key: "apps", f })} />}
          {drill.key === "capabilities" && <CapabilityRecords c={d.capabilities} apps={d.apps.records} filter={drill.f} onFilter={(f) => setDrill({ key: "capabilities", f })} />}
          {drill.key === "combinations" && <CombinationRecords c={d.combinations} filter={drill.f} onFilter={(f) => setDrill({ key: "combinations", f })} />}
          {drill.key === "adoption" && <AdoptionRecords a={d.adoption} />}
        </section>
      )}

      <details className="mt-12 rounded-2xl border border-border bg-card p-5" data-testid="section-reuse-signals">
        <summary className="cursor-pointer text-[16px] font-semibold">Reuse signals <span className="ml-1 text-[13px] font-normal text-muted-foreground">from recorded reuse checks, proposals and votes</span></summary>
        <div className="mt-4"><ReuseSignals /></div>
      </details>
    </Page>
  );
}
