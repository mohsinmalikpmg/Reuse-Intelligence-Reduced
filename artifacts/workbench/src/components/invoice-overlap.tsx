import { useMemo, useState } from "react";
import { ChevronDown, Download, FileCode2, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetInvoiceAnalysisQueryKey, useGetInvoiceAnalysis, useAnalyzeInvoiceFeatures } from "@workspace/api-client-react";
import { ErrorView, Skel, Tag } from "@/components/bits";
import { cn } from "@/lib/utils";
import { msgOf, useRegisteredSources, type CombinedCase, type RegisteredSource } from "@/lib/consolidation";
import { deriveInvoiceOverlap, invoiceApps, reviewedInvoiceHashes } from "@/lib/invoice-overlap";

const CLASS_TONE = {
  overlap: "sienna", "partial overlap": "sky", unique: "green", unknown: "muted",
} as const;
const short = (h: string) => (h ? `${h.slice(0, 12)}…` : "none");
type Row = ReturnType<typeof deriveInvoiceOverlap>["rows"][number];
type SrcQ = ReturnType<typeof useRegisteredSources>;

/** Compact source comparison; details never change the saved recipe. */
export function InvoiceOverlap({ c }: { c: CombinedCase }) {
  const { rows, counts } = useMemo(() => deriveInvoiceOverlap(c), [c]);
  const srcQ = useRegisteredSources();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const selected = new Set(c.selectedSources.map(s => s.id));
  const regById = useMemo(() => {
    const m: Record<string, RegisteredSource> = {};
    (srcQ.data ?? []).forEach(s => { m[s.id] = s; });
    return m;
  }, [srcQ.data]);

  return (
    <section className="card-soft min-w-0 overflow-hidden" aria-labelledby="overlap-title" data-testid="panel-invoice-overlap">
      <header className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 id="overlap-title" className="text-[16px] font-semibold">Feature redundancy</h2>
          <Tag tone="muted">Source review · not live AI</Tag>
          <span className="text-[12px] text-muted-foreground" data-testid="text-overlap-revision">Saved · rev {c.revision}</span>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {counts.groups} features · {counts.overlapGroups} overlap · {counts.uniqueGroups} unique · {counts.unknownGroups} unknown
        </p>
      </header>
      <InvoiceAI key={`${c.id}:${c.revision}:${c.fingerprint}`} c={c} rows={rows} />

      <div className="h-[400px] max-h-[60dvh] overflow-y-auto overscroll-contain" role="region" aria-label="Feature redundancy list" tabIndex={0} data-testid="overlap-scroll-window">
        {rows.map(r => {
          const isOpen = !!open[r.id];
          return (
            <div key={r.id} className="border-b border-border last:border-b-0" data-testid={`row-overlap-${r.id}`}>
              <button
                type="button"
                className="flex min-h-9 w-full items-center gap-2 px-4 py-1.5 text-left text-[12px] transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                aria-expanded={isOpen}
                aria-controls={`overlap-detail-${r.id}`}
                aria-label={`${isOpen ? "Hide" : "Show"} details for ${r.name}`}
                onClick={() => setOpen(o => ({ ...o, [r.id]: !o[r.id] }))}
                data-testid={`button-expand-${r.id}`}
              >
                <span className="min-w-0 flex-1 font-medium">{r.name}</span>
                <span className="shrink-0"><Tag tone={CLASS_TONE[r.classification]}>{r.classification}</Tag></span>
                <ChevronDown aria-hidden className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
              </button>
              {isOpen && (
                <div id={`overlap-detail-${r.id}`} className="min-w-0 space-y-4 border-t border-border bg-muted/25 p-4 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone={r.enabled ? "sky" : "muted"}>Proposed: {r.action}</Tag>
                    {!r.enabled && r.capabilityId && <Tag tone="muted">not enabled</Tag>}
                    <span className="text-[12px] text-muted-foreground">Not verified · Effort not measured</span>
                  </div>
                  <p className="font-medium">{r.implementation}</p>
                  <div>
                    <h3 className="mb-2 text-[12px] font-semibold">Current app coverage</h3>
                    <dl className="grid gap-3 sm:grid-cols-3">
                      {invoiceApps.map(a => (
                        <div key={a.id} className="min-w-0">
                          <dt className="font-medium">{a.name} <span className="text-[11px] font-normal text-muted-foreground">· {selected.has(a.id) ? "selected" : "not selected"}</span></dt>
                          <dd className="mt-1 text-muted-foreground">{r.cells[a.id]?.summary ?? "Not evidenced"}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><h3 className="font-semibold">Differences</h3><p className="mt-1 text-muted-foreground">{r.differences}</p></div>
                    <div><h3 className="font-semibold">Rationale</h3><p className="mt-1 text-muted-foreground">{r.rationale}</p></div>
                  </div>
                  <Provenance row={r} regById={regById} q={srcQ} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <footer className="border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">
        <p>Functional overlap is not equivalence. No apps retired; effort not measured.</p>
        <details className="mt-1">
          <summary className="cursor-pointer hover:text-foreground">Scope and saved configuration</summary>
          <div className="mt-2 space-y-1">
            <p>{counts.proposedGroups} proposed retain/replace/combine actions · {counts.verifiedReplacements} verified replacements · {counts.retiredApps} apps retired.</p>
            <p>Counts cover these reviewed feature groups, not every manifest entry or eliminated implementation. Shared fixture setup and low-level money helpers are excluded. “Not evidenced” means no mapped evidence in this review, not absence.</p>
            <p>Fuzzy search, staged bulk decisions and line-item tracing are preserved only when enabled. All decisions reflect this saved configuration; nothing is retired automatically.</p>
            <p className="break-all font-mono text-[11px]" data-testid="text-overlap-fingerprint">Fingerprint: {c.fingerprint}</p>
          </div>
        </details>
      </footer>
    </section>
  );
}

/** GET is persisted-only; this explicit mutation is the only model-generation path. */
function InvoiceAI({ c, rows }: { c: CombinedCase; rows: Row[] }) {
  const qc = useQueryClient();
  const queryKey = [...getGetInvoiceAnalysisQueryKey(c.id), c.revision, c.fingerprint];
  const saved = useGetInvoiceAnalysis(c.id, { query: { queryKey, retry: false, staleTime: 0 } });
  const generate = useAnalyzeInvoiceFeatures({ mutation: {
    onSuccess: result => { qc.setQueryData(queryKey, result); },
  } });
  const response = saved.data?.revision === c.revision ? saved.data : undefined;
  const result = response?.analysis;
  const provenance = response?.provenance;
  return <div className="space-y-3 border-b border-border bg-muted/20 px-4 py-3" data-testid="invoice-ai-analysis">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-[13px] font-semibold">AI explanation · separate from source review</h3>
      <button type="button" disabled={generate.isPending || saved.isLoading}
        onClick={() => generate.mutate({ id: c.id })}
        className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-[12px] font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-60"
        data-testid="button-analyze-invoice">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        {generate.isPending ? "Analyzing…" : "Analyze with AI"}
      </button>
    </div>
    <p className="text-[12px] text-muted-foreground">Explicit analysis of this saved revision and original capability manifests. Proposals only; no configuration, permissions or original apps are changed.</p>
    {saved.isLoading && <p className="text-[12px]" role="status">Reading saved analysis…</p>}
    {saved.isError && <ErrorView message={`Saved AI analysis could not load. ${msgOf(saved.error)}`} onRetry={() => void saved.refetch()} />}
    {generate.isError && <p role="alert" className="text-[12px] text-siennaink">{msgOf(generate.error)} Nothing was applied.</p>}
    {!saved.isLoading && !saved.isError && !result && <p className="text-[12px] text-muted-foreground">No saved AI analysis matches this revision and evidence. Use Analyze with AI to request one.</p>}
    {result && provenance && <div className="space-y-3 text-[12px]">
      <p>{result.summary}</p>
      <p className="text-muted-foreground" data-testid="invoice-ai-provenance">
        {new Date(provenance.createdAt).toLocaleString()} · {provenance.model} · {provenance.cached ? "Saved / cached result" : "Newly generated result"} · {provenance.promptVersion} · rev {response.revision}
      </p>
      <details>
        <summary className="cursor-pointer font-medium">AI reasoning and cited evidence ({result.proposals.length} features)</summary>
        <div className="mt-3 space-y-4">
          {result.proposals.map(proposal => <div key={proposal.rowId} className="space-y-1 border-l-2 border-border pl-3">
            <h4 className="font-semibold">{rows.find(row => row.id === proposal.rowId)?.name ?? proposal.rowId} · proposed {proposal.action}</h4>
            <p>{proposal.reasoning}</p>
            <ul className="list-disc pl-4 text-muted-foreground">{proposal.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>
            <p className="break-all font-mono text-[10px] text-muted-foreground">Row: {proposal.rowId} · {proposal.citations.map(ref => `${ref.sourceId} sha256:${ref.sha256}`).join(" · ")}</p>
          </div>)}
          <h4 className="font-semibold">Limits and unresolved work</h4>
          <ul className="list-disc pl-4 text-muted-foreground">{result.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>
          <h4 className="font-semibold">Evidence content versions</h4>
          {response.evidence.map(source => <p key={source.sourceId} className="break-all font-mono text-[10px] text-muted-foreground">{source.sourceId} · {source.path} · sha256:{source.sha256}</p>)}
          <p className="break-all font-mono text-[10px] text-muted-foreground">Evidence set: {response.evidenceHash}<br />Analysis input: {provenance.inputFingerprint}</p>
        </div>
      </details>
    </div>}
  </div>;
}

function Provenance({ row, regById, q }: { row: Row; regById: Record<string, RegisteredSource>; q: SrcQ }) {
  return (
    <div className="min-w-0 text-[12px]">
      <h3 className="font-semibold">Source evidence</h3>
      {q.isLoading ? <div className="mt-2 space-y-2" aria-busy="true" aria-label="Loading registered evidence"><Skel className="h-4 w-3/4" /><Skel className="h-4 w-2/3" /></div>
        : q.isError ? <div className="mt-2"><ErrorView onRetry={() => void q.refetch()} message={`Registered evidence could not load. ${msgOf(q.error)}`} /></div>
        : <ul className="mt-2 space-y-3">
          {invoiceApps.map(a => {
            const cell = row.cells[a.id];
            if (!cell) return <li key={a.id} className="text-muted-foreground">{a.name}: Not evidenced</li>;
            const reg = regById[a.id];
            return (
              <li key={a.id} className="min-w-0" data-testid={`provenance-${row.id}-${a.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.name}</span>
                  {reg ? <a href={reg.downloadUrl} download className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline" data-testid={`link-archive-${row.id}-${a.id}`}><Download className="h-3.5 w-3.5" />Source archive <span className="font-mono text-[11px]">{short(reg.sha256)}</span></a>
                    : <span className="text-siennaink">Source not registered</span>}
                </div>
                <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">Reviewed archive SHA-256: {reviewedInvoiceHashes[a.id]}</p>
                {reg && reg.sha256 !== reviewedInvoiceHashes[a.id] && <p role="alert" className="text-siennaink">Registered source differs from this review. Evidence mapping is unverified for that version.</p>}
                <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                  {cell.paths.map(p => {
                    const f = reg?.files.find(x => x.path === p);
                    return <li key={p} className="break-all"><FileCode2 className="mr-1 inline h-3 w-3 text-muted-foreground" aria-hidden /><span>{p}</span> <span className={f ? "text-muted-foreground" : "text-siennaink"}>{f ? `sha256 ${f.sha256}` : "hash not in registered archive"}</span></li>;
                  })}
                </ul>
              </li>
            );
          })}
        </ul>}
    </div>
  );
}
