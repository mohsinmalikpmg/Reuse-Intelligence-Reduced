import { useState } from "react";
import { ChevronDown, FileCode2, RotateCcw, Sparkles } from "lucide-react";
import { Skel, Tag } from "@/components/bits";
import { cn } from "@/lib/utils";
import {
  compMsg, compStatus, loginHref, useFeatureRedundancy, useSavedRedundancy,
  type FeatureEvidence, type FeatureRedundancyGroup, type RedundancyClass, type RedundancyTarget,
} from "@/lib/composition";

const CLASS_TONE: Record<RedundancyClass, "sienna" | "sky" | "green" | "muted"> = { overlap: "sienna", partial: "sky", unique: "green", unknown: "muted" };
const CLASS_LABEL: Record<RedundancyClass, string> = { overlap: "overlap", partial: "partial overlap", unique: "unique", unknown: "unknown" };
const COVER_LABEL = { full: "Covers", partial: "Partly covers", none: "Not evidenced", unknown: "Unknown" } as const;
const KIND_LABEL: Record<FeatureEvidence["kind"], string> = {
  catalog: "Catalog description · not code-verified",
  "source-review": "Reviewed source archive",
  manifest: "Original capability manifest",
};

/**
 * Feature redundancy across 2-3 sources, in the same shape as the invoice review:
 * one row per feature, classification first, expandable coverage, proposal, AI reasoning and evidence.
 * The invoice combined case keeps its richer specialised review; this serves every other comparison.
 */
export function FeatureRedundancy({ target, scope = "", names, inPlan, title = "Feature redundancy", testid = "panel-feature-redundancy" }: {
  target: RedundancyTarget; scope?: string; names: (id: string) => string; inPlan?: Set<string>; title?: string; testid?: string;
}) {
  const saved = useSavedRedundancy(target, scope);
  const gen = useFeatureRedundancy(target, scope);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const r = saved.data ?? null;
  const groups = r?.analysis.groups ?? [];
  const count = (k: RedundancyClass) => groups.filter((g) => g.classification === k).length;
  const sourceIds = r?.sources.map((s) => s.solutionId) ?? [];
  const evById = new Map((r?.evidence ?? []).map((e) => [e.id, e]));
  const catalogOnly = !!r && r.evidence.length > 0 && r.evidence.every((e) => e.kind === "catalog");

  return (
    <section className="card-soft min-w-0 overflow-hidden" aria-labelledby={`${testid}-title`} data-testid={testid}>
      <header className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 id={`${testid}-title`} className="text-[16px] font-semibold">{title}</h2>
          <Tag tone="muted">AI grouping</Tag>
          {r && <span className="text-[12px] text-muted-foreground">{r.sources.map((s) => `${names(s.solutionId)} v${s.version}`).join(" · ")}</span>}
        </div>
        {r ? <p className="mt-1 text-[12px] text-muted-foreground" data-testid="text-redundancy-counts">{groups.length} features · {count("overlap") + count("partial")} overlap · {count("unique")} unique · {count("unknown")} unknown</p>
          : <p className="mt-1 text-[12px] text-muted-foreground">Which features these sources share, where they differ and what only one of them does.</p>}
      </header>

      <div className="space-y-2 border-b border-border bg-muted/20 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={gen.isPending} onClick={() => gen.mutate(false)} data-testid="button-analyze-redundancy"
            className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-[12px] font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-60">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> {gen.isPending ? "Analyzing…" : r ? "Reload saved analysis" : "Analyze with AI"}
          </button>
          {r && <button type="button" disabled={gen.isPending} onClick={() => gen.mutate(true)} className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60" data-testid="button-regenerate-redundancy"><RotateCcw className="h-3.5 w-3.5" /> Generate fresh</button>}
        </div>
                {gen.isError && <p role="alert" className="text-[12px] text-siennaink" data-testid="text-redundancy-error">{compMsg(gen.error)}{compStatus(gen.error) === 401 && <a href={loginHref()} className="ml-2 font-semibold underline">Sign in</a>}</p>}
        {gen.isPending && !r && <div className="space-y-2" aria-busy="true"><Skel className="h-4 w-3/4" /><Skel className="h-4 w-1/2" /></div>}
        {r && <p className="text-[12.5px]" data-testid="text-redundancy-summary">{r.analysis.summary}</p>}
        {catalogOnly && <p className="text-[12px] text-siennaink" data-testid="text-catalog-only">Based on catalog descriptions only. No source code was reviewed for these sources.</p>}
      </div>

      {r && (
        <div className="max-h-[60dvh] overflow-y-auto overscroll-contain" role="region" aria-label="Feature redundancy list" tabIndex={0}>
          {groups.length === 0 && <p className="px-4 py-6 text-[13px] text-muted-foreground">No feature groups were returned for these sources.</p>}
          {groups.map((g) => <GroupRow key={g.id} g={g} isOpen={!!open[g.id]} onToggle={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))} sourceIds={sourceIds} names={names} evById={evById} inPlan={inPlan} />)}
        </div>
      )}

      <footer className="border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">
        <p>Functional overlap is not equivalence. Nothing is retired; effort not measured.</p>
        {r && <details className="mt-1">
          <summary className="cursor-pointer hover:text-foreground">Limits, evidence and provenance</summary>
          <div className="mt-2 space-y-1">
            <ul className="list-disc pl-4">{r.analysis.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
            {r.evidence.map((e) => <p key={e.id} className="break-all font-mono text-[10.5px]">{e.sourceId} · {e.label} · {e.kind} · sha256:{e.sha256}</p>)}
            <p className="break-all font-mono text-[10.5px]" data-testid="text-redundancy-provenance">
              Evidence set {r.evidenceHash}{r.provenance.model ? ` · ${String(r.provenance.model)}` : ""}{r.provenance.promptVersion ? ` · ${String(r.provenance.promptVersion)}` : ""}{r.provenance.createdAt ? ` · ${new Date(String(r.provenance.createdAt)).toLocaleString()}` : ""}{r.provenance.cached !== undefined ? ` · ${r.provenance.cached ? "saved result" : "newly generated"}` : ""}
            </p>
          </div>
        </details>}
      </footer>
    </section>
  );
}

function GroupRow({ g, isOpen, onToggle, sourceIds, names, evById, inPlan }: {
  g: FeatureRedundancyGroup; isOpen: boolean; onToggle: () => void; sourceIds: string[]; names: (id: string) => string; evById: Map<string, FeatureEvidence>; inPlan?: Set<string>;
}) {
  const caps = [...new Set(g.coverage.flatMap((c) => c.capabilityIds))];
  const planned = inPlan ? caps.filter((id) => inPlan.has(id)) : [];
  return (
    <div className="border-b border-border last:border-b-0" data-testid={`row-redundancy-${g.id}`}>
      <button type="button" onClick={onToggle} aria-expanded={isOpen} aria-controls={`red-detail-${g.id}`} aria-label={`${isOpen ? "Hide" : "Show"} details for ${g.title}`} data-testid={`button-expand-redundancy-${g.id}`}
        className="flex min-h-9 w-full items-center gap-2 px-4 py-1.5 text-left text-[12px] transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        <span className="min-w-0 flex-1 font-medium">{g.title}</span>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">{g.coverage.filter((c) => c.coverage === "full" || c.coverage === "partial").map((c) => names(c.sourceId)).join(", ") || "no source evidenced"}</span>
        <span className="shrink-0"><Tag tone={CLASS_TONE[g.classification]}>{CLASS_LABEL[g.classification]}</Tag></span>
        <ChevronDown aria-hidden className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen && (
        <div id={`red-detail-${g.id}`} className="min-w-0 space-y-4 border-t border-border bg-muted/25 p-4 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone="sky">Proposed: {g.recommendation}</Tag>
            {inPlan && <Tag tone={planned.length ? "green" : "muted"}>{planned.length ? "In the proposed flow" : "Not in the proposed flow"}</Tag>}
            <span className="text-[12px] text-muted-foreground">Not verified · Effort not measured</span>
          </div>
          <div>
            <h3 className="mb-2 text-[12px] font-semibold">Current implementation by source</h3>
            <dl className={cn("grid gap-3", sourceIds.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
              {sourceIds.map((sid) => {
                const cov = g.coverage.find((c) => c.sourceId === sid);
                return (
                  <div key={sid} className="min-w-0" data-testid={`coverage-${g.id}-${sid}`}>
                    <dt className="font-medium">{names(sid)} <span className="text-[11px] font-normal text-muted-foreground">· {cov ? COVER_LABEL[cov.coverage] : "Not evidenced"}</span></dt>
                    <dd className="mt-1 text-muted-foreground">{cov?.reason ?? "No mapped evidence in this analysis, not proof of absence."}</dd>
                    {cov && cov.capabilityIds.length > 0 && <dd className="mt-1 font-mono text-[11px] text-primary">{cov.capabilityIds.join(", ")}</dd>}
                  </div>
                );
              })}
            </dl>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><h3 className="font-semibold">Proposed implementation</h3><p className="mt-1 text-muted-foreground">{inPlan ? (planned.length ? `The saved plan uses ${planned.join(", ")}.` : "The saved plan does not include a step for this feature.") : `Recommendation: ${g.recommendation}.`}</p></div>
            <div><h3 className="font-semibold">AI reasoning</h3><p className="mt-1 text-muted-foreground">{g.reasoning}</p></div>
          </div>
          {g.gaps.length > 0 && <div><h3 className="font-semibold">Gaps and limitations</h3><ul className="mt-1 list-disc pl-4 text-muted-foreground">{g.gaps.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          <div className="text-[12px]">
            <h3 className="font-semibold">Evidence cited</h3>
            <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
              {g.coverage.flatMap((c) => c.evidenceIds).map((id, i) => {
                const e = evById.get(id);
                return <li key={`${id}-${i}`} className="break-all"><FileCode2 className="mr-1 inline h-3 w-3 text-muted-foreground" aria-hidden />{e ? <>{e.label} <span className={e.kind === "catalog" ? "text-siennaink" : "text-muted-foreground"}>· {KIND_LABEL[e.kind]}</span> <span className="text-muted-foreground">sha256 {e.sha256.slice(0, 12)}…</span></> : <span className="text-siennaink">{id} · evidence not found</span>}</li>;
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
