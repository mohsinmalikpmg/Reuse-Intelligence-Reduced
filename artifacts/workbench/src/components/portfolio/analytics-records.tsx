import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import type { PortfolioAnalytics, CombinationRecord } from "@workspace/api-client-react";
import { Tag } from "@/components/bits";
import { cn } from "@/lib/utils";
import { isNewRegistration, sharingOf, type Sharing } from "@/lib/analytics-aggregate";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) + " UTC" : "No date recorded");
const dayOf = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toISOString().slice(0, 10) : null);

function Filter<T extends string>({ value, options, onChange, testid }: { value: T; options: { v: NoInfer<T>; label: string; n: number }[]; onChange: (v: NoInfer<T>) => void; testid: string }) {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5" role="radiogroup" data-testid={testid}>
      {options.map((o) => (
        <button type="button" key={o.v} role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)} data-testid={`${testid}-${o.v}`}
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
const None = ({ children }: { children: ReactNode }) => <p className="rounded-xl border border-dashed border-input px-5 py-6 text-[14px] text-muted-foreground">{children}</p>;

const SRC: Record<string, string> = { catalog: "Demo catalog", prototype: "Registered prototype", consolidation_source: "Registered source" };

export type AppsFilter = "all" | "registered" | "consolidation_source" | "prototype" | "catalog" | "new" | `day:${string}` | "undated";

export function AppsRecords({ a, generatedAt, filter, onFilter }: { a: PortfolioAnalytics["apps"]; generatedAt: string; filter: AppsFilter; onFilter: (f: AppsFilter) => void }) {
  const f = filter;
  const undated = a.records.filter((r) => r.source !== "catalog" && !dayOf(r.registeredAt));
  const rows = a.records.filter((r) => {
    if (f === "all") return true;
    if (f.startsWith("day:")) return r.source !== "catalog" && dayOf(r.registeredAt) === f.slice(4);
    if (f === "undated") return r.source !== "catalog" && !dayOf(r.registeredAt);
    if (f === "new") return r.source !== "catalog" && isNewRegistration(r.registeredAt, generatedAt, a.newWindowDays);
    if (f === "registered") return r.source !== "catalog";
    return r.source === f;
  });
  const opts: { v: AppsFilter; label: string; n: number }[] = [
    { v: "all", label: "All", n: a.total }, { v: "registered", label: "Registered", n: a.registered }, { v: "consolidation_source", label: "Consolidation sources", n: a.consolidationSources }, { v: "prototype", label: "Prototypes", n: a.prototypes },
    { v: "new", label: `New, last ${a.newWindowDays} days`, n: a.newRegistered }, { v: "catalog", label: "Demo catalog (not registered)", n: a.catalog },
  ];
  if (undated.length) opts.push({ v: "undated", label: "Registered, no date", n: undated.length });
  if (f.startsWith("day:")) opts.push({ v: f, label: `Registered ${fmtDate(f.slice(4) + "T12:00:00Z")}`, n: rows.length });
  return (
    <>
      <Filter testid="filter-apps" value={f} onChange={onFilter} options={opts} />
      {rows.length === 0 ? <None>No apps in this view.</None> : (
        <Rows testid="records-apps">{rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[14px]" data-testid={`app-${r.id}`}>
            {r.source === "consolidation_source" ? <span className="font-semibold text-primary">{r.name}</span> : <Link href={`/solutions/${r.id}`} className="font-semibold text-primary underline-offset-2 hover:underline">{r.name}</Link>}
            <Tag tone={r.source === "catalog" ? "muted" : "sky"}>{SRC[r.source]}</Tag>
            {r.demo ? <Tag tone="sienna">demo data</Tag> : <Tag tone="green">real</Tag>}
            <span className="text-[12.5px] text-muted-foreground">{[r.status, r.kind?.replace(/_/g, " "), r.ownerName ? r.ownerName : "Owner not assessed", r.platform, r.registeredBy ? `registered by ${r.registeredBy}` : null].filter(Boolean).join(" · ")}</span>
            <span className="ml-auto font-mono text-[12px] text-muted-foreground">{r.source !== "catalog" ? fmtDate(r.registeredAt) : "Not registered"}</span>
            {r.provenance && <p className="w-full text-[12px] text-muted-foreground">{r.provenance}</p>}
          </li>
        ))}</Rows>
      )}
    </>
  );
}

export type CapsFilter = "all" | Sharing;
const SHARE_LABEL: Record<Sharing, string> = { shared: "Shared by 2+ apps", single: "One declaring source", unassessed: "Not assessed" };

export function CapabilityRecords({ c, apps, filter, onFilter }: { c: PortfolioAnalytics["capabilities"]; apps: PortfolioAnalytics["apps"]["records"]; filter: CapsFilter; onFilter: (f: CapsFilter) => void }) {
  const f = filter;
  // Only catalog/prototype apps have a solution page; registered recipe sources (or unknown ids) fall back to the explorer.
  const hasPage = useMemo(() => new Set(apps.filter((r) => r.source !== "consolidation_source").map((r) => r.id)), [apps]);
  const all = useMemo(() => { const s = new Set<string>(); return [...c.records].filter((r) => (s.has(r.id) ? false : (s.add(r.id), true))).sort((x, y) => y.usedBy - x.usedBy || x.name.localeCompare(y.name)); }, [c.records]);
  const n = (k: Sharing) => all.filter((r) => sharingOf(r.usedBy) === k).length;
  const rows = all.filter((r) => f === "all" || sharingOf(r.usedBy) === f);
  return (
    <>
      <Filter testid="filter-caps" value={f} onChange={onFilter} options={[{ v: "all", label: "All", n: all.length }, { v: "shared", label: SHARE_LABEL.shared, n: n("shared") }, { v: "single", label: SHARE_LABEL.single, n: n("single") }, { v: "unassessed", label: SHARE_LABEL.unassessed, n: n("unassessed") }]} />
      {rows.length === 0 ? <None>No capabilities in this view.</None> : (
        <Rows testid="records-capabilities">{rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[14px]" data-testid={`cap-${r.id}`}>
            <span className="font-semibold text-primary">{r.name}</span>
            {r.demo ? <Tag tone="sienna">demo data</Tag> : <Tag tone="green">real</Tag>}
            <span className="text-[12.5px] text-muted-foreground">declared by <Link href={hasPage.has(r.sourceSolutionId) ? `/solutions/${r.sourceSolutionId}` : "/portfolio/capabilities"} className="underline-offset-2 hover:underline" data-testid={`link-cap-source-${r.id}`}>{r.sourceSolutionName}</Link></span>
            <span className="ml-auto font-mono text-[12px] text-muted-foreground">{r.usedBy === 0 ? "not assessed" : `${r.usedBy} declaring app${r.usedBy === 1 ? "" : "s"}`}</span>
          </li>
        ))}</Rows>
      )}
      <Link href="/portfolio/capabilities" className="mt-3 inline-block text-[13.5px] font-semibold text-primary underline-offset-2 hover:underline" data-testid="link-capability-explorer">Open the Capability Explorer</Link>
    </>
  );
}

export const STAGE: Record<CombinationRecord["stage"], { label: string; short: string; tone: "muted" | "sienna" | "green" | "sky" }> = {
  saved: { label: "Your saved draft, not proposed", short: "Your private drafts", tone: "muted" },
  proposed: { label: "Proposed, awaiting IT", short: "Proposed", tone: "muted" },
  approved: { label: "Approved by IT, not published", short: "Approved", tone: "sky" },
  published: { label: "Approved and published", short: "Published", tone: "green" },
  withdrawn: { label: "Approval withdrawn", short: "Withdrawn", tone: "sienna" },
};

export type CombosFilter = "all" | "approved_any" | CombinationRecord["stage"];

export function CombinationRecords({ c, filter, onFilter }: { c: PortfolioAnalytics["combinations"]; filter: CombosFilter; onFilter: (f: CombosFilter) => void }) {
  const f = filter;
  const rows = c.records.filter((r) => f === "all" || (f === "approved_any" ? r.stage === "approved" || r.stage === "published" : r.stage === f));
  if (c.records.length === 0) return <None>No combination has been saved or proposed yet.</None>;
  const n = (s: CombosFilter) => c.records.filter((r) => r.stage === s).length;
  return (
    <>
      <Filter testid="filter-combos" value={f} onChange={onFilter} options={[
        { v: "all", label: "All", n: c.records.length },
        { v: "approved_any", label: "Approved incl. published", n: n("approved") + n("published") },
        ...(["saved", "proposed", "approved", "published", "withdrawn"] as const).map((s) => ({ v: s, label: STAGE[s].short, n: n(s) })),
      ]} />
      {rows.length === 0 ? <None>No combinations at this stage.</None> : (
        <Rows testid="records-combinations">{rows.map((r) => (
          <li key={r.caseId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[14px]" data-testid={`combo-${r.caseId}`}>
            {r.stage === "saved" ? <span className="font-semibold text-primary">{r.title}</span> : <Link href={`/cases/${r.caseId}/decision`} className="font-semibold text-primary underline-offset-2 hover:underline">{r.title}</Link>}
            <Tag tone={STAGE[r.stage].tone}>{STAGE[r.stage].label}</Tag>
            {r.stage === "saved" && <Tag tone="slate">private to you</Tag>}
            {r.demo ? <Tag tone="sienna">demo data</Tag> : <Tag tone="green">real</Tag>}
            <span className="text-[12.5px] text-muted-foreground">into {r.baseSolutionName}</span>
            <span className="ml-auto font-mono text-[12px] text-muted-foreground">{r.stage === "saved" ? "no proposal recorded" : `proposed ${fmtDate(r.proposedAt)}`}</span>
          </li>
        ))}</Rows>
      )}
    </>
  );
}

export function AdoptionRecords({ a }: { a: PortfolioAnalytics["adoption"] }) {
  return (
    <>
      <p className="mb-3 text-[13.5px] text-muted-foreground">{a.note}</p>
      {a.consolidatedApps.length === 0 ? <None>No consolidated app has been published yet.</None> : (
        <Rows testid="records-adoption">{a.consolidatedApps.map((r) => (
          <li key={r.caseId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[14px]" data-testid={`adopt-${r.caseId}`}>
            <Link href={`/solutions/${r.solutionId}`} className="font-semibold text-primary underline-offset-2 hover:underline">{r.name}</Link>
            {r.version && <span className="font-mono text-[12px] text-muted-foreground">v{r.version}</span>}
            {r.demo ? <Tag tone="sienna">demo data</Tag> : <Tag tone="green">real</Tag>}
            <span className="ml-auto text-[12.5px] text-muted-foreground">adoption not tracked</span>
          </li>
        ))}</Rows>
      )}
    </>
  );
}
