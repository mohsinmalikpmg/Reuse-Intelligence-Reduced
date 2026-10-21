import { Eye, ShieldCheck } from "lucide-react";
import type { OutputPreview, Solution } from "@workspace/api-client-react";
import { Tag } from "@/components/bits";

/** Order the business functions appear in everywhere: Operations first because it is the live example, then back office. */
export const FUNCTION_ORDER = ["Operations", "Finance", "Investor relations", "ESG & Regulatory", "Supply chain & Planning", "Commercial & Legal", "Corporate & Executive"];
export const functionRank = (fn: string) => { const i = FUNCTION_ORDER.indexOf(fn); return i === -1 ? FUNCTION_ORDER.length : i; };

/** True when FUSEBOX runs this product on real input; otherwise only a deterministic output preview exists. */
export const isLive = (s: Pick<Solution, "execution">) => s.execution === "live";

export function RiskTag({ tier, testid }: { tier: Solution["riskTier"]; testid?: string }) {
  return <Tag tone={tier === "high" ? "sienna" : tier === "medium" ? "sky" : "muted"} testid={testid}>{tier === "high" ? "High-risk output" : tier === "medium" ? "Medium risk" : "Low risk"}</Tag>;
}

export function ExecutionTag({ s, testid }: { s: Pick<Solution, "execution">; testid?: string }) {
  return isLive(s) ? <Tag tone="green" testid={testid}>Runs on your input</Tag> : <Tag tone="slate" testid={testid}><Eye className="h-3 w-3" /> Output preview</Tag>;
}

/** The record metadata the brief asks for, in one wrapping row. */
export function MetaTags({ s, compact, testid }: { s: Solution; compact?: boolean; testid?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={testid}>
      <Tag tone="slate">{s.businessFunction}</Tag>
      <Tag>{s.outputType}</Tag>
      {!compact && <Tag>{s.workflowType}</Tag>}
      <RiskTag tier={s.riskTier} />
      <ExecutionTag s={s} />
    </div>
  );
}

/** Metadata block for the solution page and drawers. */
export function MetaGrid({ s }: { s: Solution }) {
  const rows: [string, string][] = [
    ["Business function", s.businessFunction],
    ["Problem", s.outcome],
    ["Primary users", s.primaryUsers.join(", ")],
    ["Workflow type", s.workflowType],
    ["Output type", s.outputType],
    ["Data involved", s.dataInvolved.join(", ") || "Not recorded"],
    ["Owner", `${s.ownerName}${s.ownerTeam ? `, ${s.ownerTeam}` : ""}`],
    ["Maturity", `${s.status[0]!.toUpperCase()}${s.status.slice(1)} · v${s.currentVersion} · ${s.evidenceLevel} evidence`],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2.5 text-[14px] sm:grid-cols-2" data-testid="meta-grid">
      {rows.map(([k, v]) => <div key={k}><dt className="eyebrow">{k}</dt><dd className="mt-0.5">{v}</dd></div>)}
      <div><dt className="eyebrow">Risk tier</dt><dd className="mt-0.5"><RiskTag tier={s.riskTier} /></dd></div>
      <div className="sm:col-span-2"><dt className="eyebrow">Controls</dt><dd className="mt-1 flex flex-wrap gap-1.5">{s.controls.map((c) => <Tag key={c} tone="green" testid={`control-${c}`}><ShieldCheck className="h-3 w-3" />{c}</Tag>)}</dd></div>
    </dl>
  );
}

/**
 * Deterministic sample-data preview of what a product produces. Labelled as such everywhere: it is the shape of the
 * output, not a run on anyone's data, and never counts as A/B evidence.
 */
export function OutputPreviewPanel({ preview, s, testid = "output-preview" }: { preview: OutputPreview; s: Pick<Solution, "name" | "riskTier">; testid?: string }) {
  return (
    <div className="card-soft p-5" data-testid={testid}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow">Output preview · sample data</span>
        <Tag tone="slate"><Eye className="h-3 w-3" /> Not a run, not evidence</Tag>
      </div>
      <h3 className="mt-1.5 text-[18px] font-bold leading-snug" data-testid={`${testid}-title`}>{preview.title}</h3>
      <div className="mt-3 rounded-xl border border-border bg-secondary/50 px-4 py-3 text-[13.5px]">
        <div className="eyebrow mb-1">Inputs used in this sample</div>
        <ul className="space-y-0.5 text-muted-foreground">{preview.inputs.map((i) => <li key={i}>{i}</li>)}</ul>
      </div>
      <div className="mt-4 space-y-4">
        {preview.sections.map((sec) => (
          <section key={sec.heading} data-testid={`${testid}-section`}>
            <h4 className="text-[15px] font-semibold text-primary">{sec.heading}</h4>
            <ul className="mt-1.5 space-y-1.5 text-[14.5px] leading-snug">{sec.lines.map((l, i) => <li key={i} className="border-l-2 border-border pl-3">{l}</li>)}</ul>
          </section>
        ))}
      </div>
      <p className="mt-4 flex items-start gap-1.5 text-[13px] text-muted-foreground" data-testid={`${testid}-note`}><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" /> {preview.note}</p>
    </div>
  );
}
