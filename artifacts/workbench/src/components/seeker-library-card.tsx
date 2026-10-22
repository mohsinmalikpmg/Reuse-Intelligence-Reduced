import { Link } from "wouter";
import { ArrowRight, Check, GitCompare } from "lucide-react";
import { StatusPill, Tag, btn } from "@/components/bits";
import { useTry } from "@/components/family-card";
import { cn } from "@/lib/utils";
import { EVIDENCE_LABEL, orUnknown, readinessOf, roleLabel, type Entry } from "./seeker-library-model";

export function SeekerCard({ e, selected, canSelect, onToggle, matchedCapability, matchLabel }: { e: Entry; selected: boolean; canSelect: boolean; onToggle: () => void; matchedCapability?: string; matchLabel?: string | null }) {
  const { s } = e;
  const { go, busy } = useTry();
  const live = readinessOf(s) === "live";
  const sources = Array.from(new Map(e.caps.map((c) => [c.sourceSolutionId, c.sourceSolutionName])).entries()).filter(([, n]) => !!n);
  const cbId = `cmp-${e.key}`;
  return (
    <li className={cn("card-soft flex flex-col p-5 transition-colors", selected && "ring-2 ring-primary")} data-testid={`card-solution-${s.id}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[12.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{s.businessFunction}</span>
        <label htmlFor={cbId} className={cn("inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-[13px] font-medium focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 focus-within:ring-offset-background",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-input text-primary hover:bg-secondary",
          !selected && !canSelect && "cursor-not-allowed opacity-50")}>
          <input id={cbId} type="checkbox" className="sr-only" checked={selected} disabled={!selected && !canSelect} onChange={onToggle} data-testid={`check-compare-${s.id}`} />
          {selected && <Check className="h-3.5 w-3.5" aria-hidden />} {selected ? "Comparing" : "Compare"}
          <span className="sr-only"> {s.name}</span>
        </label>
      </div>
      <h3 className="mt-1 text-[18px] font-semibold leading-snug text-primary">{s.name}</h3>
      <p className="mt-1.5 line-clamp-2 text-[14.5px]">{s.outcome}</p>
      {matchLabel && <p className="mt-2 text-[13px] font-medium text-primary">{matchedCapability}: {matchLabel}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Tag tone={e.role === "preferred" ? "green" : e.role === "consolidating" ? "sienna" : "slate"}>{roleLabel(e)}</Tag>
        <StatusPill status={s.status} />
        <span className="text-[12.5px] text-muted-foreground">v{s.currentVersion}</span>
        <Tag tone={live ? "sky" : "muted"}>{live ? "Runs on your input" : "Preview only"}</Tag>
      </div>

      <details className="mt-3 rounded-lg border border-border bg-background/40 text-[13.5px]">
        <summary className="cursor-pointer select-none rounded-lg px-3 py-2 font-medium text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Details</summary>
        <div className="grid gap-3 px-3 pb-3 pt-1">
          <p className="text-[13px] text-muted-foreground">{EVIDENCE_LABEL[s.evidenceLevel]} · {s.origin ? "Registered prototype" : "Library record"}</p>
          <dl className="grid gap-2">
            <Row k="Business problem">{e.problem}</Row>
            <Row k="Source apps">{sources.length ? sources.map(([id, n], i) => <span key={id}>{i > 0 && ", "}<Link href={`/solutions/${id}`} className="text-primary underline-offset-2 hover:underline">{n}</Link></span>) : <Unknown />}</Row>
            <Row k="Limits">{s.knownGaps.length ? s.knownGaps.join("; ") : <Unknown />}</Row>
            <Row k="Owner">{orUnknown(s.ownerName) === "Unknown" ? <Unknown /> : `${s.ownerName}${s.ownerTeam ? `, ${s.ownerTeam}` : ""}`}</Row>
          </dl>

          <div>
            <div className="eyebrow mb-1">Reusable elements</div>
            {e.caps.length === 0 ? <Unknown /> : (
              <ul className="space-y-1.5">
                {e.caps.map((c) => (
                  <li key={c.id}>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground"> · {EVIDENCE_LABEL[c.evidenceLevel]}{c.evidence ? `: ${c.evidence}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {e.configs.length > 0 && (
            <div>
              <div className="eyebrow mb-1">Approved configurations</div>
              <ul className="space-y-2">
                {e.configs.map((cfg) => (
                  <li key={cfg.version} className="rounded-lg border border-border p-2">
                    <div className="font-medium">{cfg.title} <span className="text-muted-foreground">v{cfg.version}, compared with v{cfg.baseVersion}</span></div>
                    {cfg.summary && <p className="text-muted-foreground">{cfg.summary}</p>}
                    {live
                      ? <button className={cn(btn.quiet, "mt-1 text-primary")} disabled={busy} onClick={() => go({ baseSolutionId: s.id, approvedVersion: cfg.version })} data-testid={`button-try-config-${s.id}-${cfg.version}`}><GitCompare className="h-4 w-4" /> Try both with my input</button>
                      : <span className="text-[12.5px] text-muted-foreground">Preview only, cannot run</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {e.reusable.length > 0 && (
            <div>
              <div className="eyebrow mb-1">Capabilities you could add</div>
              <ul className="space-y-1.5">
                {e.reusable.map((r) => (
                  <li key={r.capability.id} className="flex flex-wrap items-center gap-x-2">
                    <span className="font-medium">{r.capability.name}</span>
                    <span className="text-muted-foreground">from <Link href={`/solutions/${r.sourceSolutionId}`} className="text-primary underline-offset-2 hover:underline">{r.sourceSolutionName}</Link></span>
                    {r.includedInPreferred ? <Tag tone="green">Already included</Tag>
                      : r.tryIn ? <button className={cn(btn.quiet, "text-primary")} disabled={busy} onClick={() => go({ baseSolutionId: r.tryIn!.solutionId, moduleIds: [r.capability.id] }, "compare")} data-testid={`button-try-capability-${r.capability.id}`}>Try in {r.tryIn.solutionName} <ArrowRight className="h-4 w-4" /></button>
                      : <span className="text-[12.5px] text-muted-foreground">Not addable yet</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>

      <Link href={`/solutions/${s.id}`} className={`${btn.secondary} mt-4 self-start`} data-testid={`link-open-${s.id}`}>See an example <ArrowRight className="h-4 w-4" /></Link>
    </li>
  );
}

function Unknown() { return <span className="italic text-muted-foreground">Unknown</span>; }

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[110px_1fr]">
      <dt className="text-muted-foreground">{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}
