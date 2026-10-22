import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import type { PortfolioAnalytics, CombinationRecord } from "@workspace/api-client-react";
import { Tag } from "@/components/bits";
import { cn } from "@/lib/utils";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "No date recorded");

function Filter<T extends string>({ value, options, onChange, testid }: { value: T; options: { v: NoInfer<T>; label: string; n: number }[]; onChange: (v: NoInfer<T>) => void; testid: string }) {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5" role="radiogroup" data-testid={testid}>
      {options.map((o) => (
        <button key={o.v} role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)} data-testid={`${testid}-${o.v}`}
          className={cn("min-h-8 rounded-lg border px-3 text-[13px] font-medium transition-colors", value === o.v ? "border-primary bg-primary text-primary-foreground" : "border-border text-primary hover:bg-secondary")}>
          {o.label} <span className="font-mono opacity-70">{o.n}</span>
        </button>
      ))}
    </div>
  );
}

function Rows({ children, testid }: { children: ReactNode; testid: string }) {
  return <ul className="divide-y divide-border rounded-xl border border-border bg-card" data-testid={testid}>{children}</ul>;
}

const SRC: Record<string, string> = { catalog: "Demo catalog", prototype: "Registered prototype", consolidation_source: "Registered source" };

export function AppsRecords({ a }: { a: PortfolioAnalytics["apps"] }) {
  const [f, setF] = useState<"all" | "registered" | "consolidation_source" | "prototype" | "catalog" | "new">("all");
  const cutoff = Date.now() - a.newWindowDays * 86_400_000;
  const rows = a.records.filter((r) => f === "all" || (f === "new" ? r.source !== "catalog" && r.registeredAt && new Date(r.registeredAt).getTime() >= cutoff : f === "registered" ? r.source !== "catalog" : r.source === f));
  return (
    <>
      <Filter testid="filter-apps" value={f} onChange={setF} options={[
        { v: "all", label: "All", n: a.total }, { v: "registered", label: "Registered", n: a.registered }, { v: "consolidation_source", label: "Consolidation sources", n: a.consolidationSources }, { v: "prototype", label: "Prototypes", n: a.prototypes },
        { v: "new", label: `New, last ${a.newWindowDays} days`, n: a.newRegistered }, { v: "catalog", label: "Demo catalog (not registered)", n: a.catalog },
      ]} />
      {rows.length === 0 ? <p className="rounded-xl border border-dashed border-input px-5 py-6 text-[14px] text-muted-foreground">No apps in this view.</p> : (
        <Rows testid="records-apps">{rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[14px]" data-testid={`app-${r.id}`}>
            {r.source === "consolidation_source" ? <span className="font-semibold text-primary">{r.name}</span> : <Link href={`/solutions/${r.id}`} className="font-semibold text-primary underline-offset-2 hover:underline">{r.name}</Link>}
            <Tag tone={r.source === "catalog" ? "muted" : "sky"}>{SRC[r.source]}</Tag>
            {r.demo && <Tag tone="sienna">demo data</Tag>}
            <span className="text-[12.5px] text-muted-foreground">{[r.status, r.kind?.replace(/_/g, " "), r.ownerName ? r.ownerName : "Owner not assessed", r.platform, r.registeredBy ? `registered by ${r.registeredBy}` : null].filter(Boolean).join(" · ")}</span>
            <span className="ml-auto font-mono text-[12px] text-muted-foreground">{r.source !== "catalog" ? fmtDate(r.registeredAt) : "Not registered"}</span>
            {r.provenance && <p className="w-full text-[12px] text-muted-foreground">{r.provenance}</p>}
          </li>
        ))}</Rows>
      )}
    </>
  );
}

export function CapabilityRecords({ c }: { c: PortfolioAnalytics["capabilities"] }) {
  const [f, setF] = useState<"all" | "shared">("all");
  const rows = useMemo(() => [...c.records].sort((x, y) => y.usedBy - x.usedBy || x.name.localeCompare(y.name)).filter((r) => f === "all" || r.usedBy > 1), [c.records, f]);
  return (
    <>
      <Filter testid="filter-caps" value={f} onChange={setF} options={[{ v: "all", label: "All", n: c.unique }, { v: "shared", label: "Shared by 2+ apps", n: c.shared }]} />
      <Rows testid="records-capabilities">{rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[14px]" data-testid={`cap-${r.id}`}>
          <span className="font-semibold text-primary">{r.name}</span>
          {r.demo && <Tag tone="sienna">demo data</Tag>}
          <span className="text-[12.5px] text-muted-foreground">from <Link href={`/solutions/${r.sourceSolutionId}`} className="underline-offset-2 hover:underline">{r.sourceSolutionName}</Link></span>
          <span className="ml-auto font-mono text-[12px] text-muted-foreground">{r.usedBy} app{r.usedBy === 1 ? "" : "s"}</span>
        </li>
      ))}</Rows>
      <Link href="/portfolio/capabilities" className="mt-3 inline-block text-[13.5px] font-semibold text-primary underline-offset-2 hover:underline">Open the Capability Explorer</Link>
    </>
  );
}

const STAGE: Record<CombinationRecord["stage"], { label: string; tone: "muted" | "sienna" | "green" | "sky" }> = {
  saved: { label: "Saved, not proposed", tone: "muted" },
  proposed: { label: "Proposed, not approved", tone: "muted" },
  approved: { label: "Approved by IT, not published", tone: "sky" },
  published: { label: "Approved and published", tone: "green" },
  withdrawn: { label: "Approval withdrawn", tone: "sienna" },
};

export function CombinationRecords({ c }: { c: PortfolioAnalytics["combinations"] }) {
  const [f, setF] = useState<"all" | "saved" | "proposed" | "approved">("all");
  const rows = c.records.filter((r) => f === "all" || (f === "approved" ? r.stage === "approved" || r.stage === "published" : r.stage === f));
  if (c.records.length === 0) return <p className="rounded-xl border border-dashed border-input px-5 py-6 text-[14px] text-muted-foreground">No combination has been saved or proposed yet.</p>;
  return (
    <>
      <Filter testid="filter-combos" value={f} onChange={setF} options={[
        { v: "all", label: "All", n: c.records.length }, { v: "saved", label: "Saved only", n: c.saved }, { v: "proposed", label: "Awaiting approval", n: c.records.filter((r) => r.stage === "proposed").length }, { v: "approved", label: "Approved", n: c.approved },
      ]} />
      <Rows testid="records-combinations">{rows.map((r) => (
        <li key={r.caseId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[14px]" data-testid={`combo-${r.caseId}`}>
          {r.stage === "saved" ? <span className="font-semibold text-primary">{r.title}</span> : <Link href={`/cases/${r.caseId}/decision`} className="font-semibold text-primary underline-offset-2 hover:underline">{r.title}</Link>}
          <Tag tone={STAGE[r.stage].tone}>{STAGE[r.stage].label}</Tag>
          {r.demo && <Tag tone="sienna">demo data</Tag>}
          <span className="text-[12.5px] text-muted-foreground">into {r.baseSolutionName}</span>
          <span className="ml-auto font-mono text-[12px] text-muted-foreground">{r.stage === "saved" ? "no proposal recorded" : `proposed ${fmtDate(r.proposedAt)}`}</span>
        </li>
      ))}</Rows>
    </>
  );
}

export function AdoptionRecords({ a }: { a: PortfolioAnalytics["adoption"] }) {
  return (
    <>
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        {["Active users", "Teams", "Usage over time"].map((l) => (
          <div key={l} className="rounded-xl border border-dashed border-input px-4 py-3" data-testid={`adoption-${l.toLowerCase().replace(/\s+/g, "-")}`}>
            <div className="text-[12.5px] text-muted-foreground">{l}</div>
            <div className="text-[16px] font-semibold text-muted-foreground">Not tracked yet</div>
          </div>
        ))}
      </div>
      <p className="mb-3 text-[13.5px] text-muted-foreground">{a.note}</p>
      {a.consolidatedApps.length === 0 ? <p className="rounded-xl border border-dashed border-input px-5 py-6 text-[14px] text-muted-foreground">No consolidated app has been published yet.</p> : (
        <Rows testid="records-adoption">{a.consolidatedApps.map((r) => (
          <li key={r.caseId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[14px]">
            <Link href={`/solutions/${r.solutionId}`} className="font-semibold text-primary underline-offset-2 hover:underline">{r.name}</Link>
            {r.version && <span className="font-mono text-[12px] text-muted-foreground">v{r.version}</span>}
            {r.demo && <Tag tone="sienna">demo data</Tag>}
            <span className="ml-auto text-[12.5px] text-muted-foreground">adoption not tracked</span>
          </li>
        ))}</Rows>
      )}
    </>
  );
}
