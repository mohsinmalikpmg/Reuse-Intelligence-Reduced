import { useState } from "react";
import { ArrowRight, Check, ChevronDown, Info } from "lucide-react";
import {
  getGetCaseConsolidationQueryKey, useGetCaseConsolidation, useGetPortfolio, useRecordCaseDecision, type ConsolidationSolutionFate, type PortfolioMetric, type PortfolioMetrics,
} from "@workspace/api-client-react";
import { DSection, Drawer, ErrorView, Headline, LoadingView, Page, Skel, StatusPill, Tag, btn, useUndoToast } from "@/components/bits";
import { errMsg, useInvalidateCase } from "@/lib/case";
import { useRole } from "@/lib/persona";
import { cn } from "@/lib/utils";

const ORDER: (keyof PortfolioMetrics)[] = ["searchToReuse", "duplicateGroups", "consolidationsCompleted", "abTestsWithPreference", "activeVsRetired", "needsAttention"];
const DISPOSITIONS = ["Retain", "Reuse capability", "Configure", "Rebuild", "Retire"] as const;
type Disp = (typeof DISPOSITIONS)[number];
const DEFAULT: Record<ConsolidationSolutionFate, Disp> = { base: "Retain", folded: "Reuse capability", retired: "Retire" };

export default function Portfolio() {
  const q = useGetPortfolio();
  if (q.isLoading) return <LoadingView />;
  if (q.isError || !q.data) return <ErrorView onRetry={() => q.refetch()} message="The portfolio could not load." />;
  const p = q.data;
  return (
    <Page>
      <Headline eyebrow="IT portfolio" title={p.headline} sub={p.valueStatement} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{ORDER.map((k) => <Metric key={k} m={p.metrics[k]} />)}</div>
      <h2 className="mb-3 mt-12 text-[22px] font-semibold">Consolidation</h2>
      {p.consolidationCases.length === 0 ? <p className="text-muted-foreground">No consolidation cases are open.</p> :
        <div className="space-y-6">{p.consolidationCases.map((c) => <Consolidation key={c.case.id} caseId={c.case.id} />)}</div>}
    </Page>
  );
}

function Metric({ m }: { m: PortfolioMetric }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card-soft p-5" data-testid={`metric-${m.key}`}>
      <div className="flex items-start gap-2"><span className="flex-1 text-[14px] text-muted-foreground">{m.label}</span>{m.demo && <Tag tone="sienna" testid={`tag-demo-${m.key}`}>demo data</Tag>}</div>
      <div className="mt-1 text-[30px] font-bold text-primary" data-testid={`value-${m.key}`}>{m.value}</div>
      {m.numerator !== null && m.denominator !== null && m.denominator > 0 && <div className="text-[13px] text-muted-foreground">{Math.round((m.numerator / m.denominator) * 100)}% ({m.numerator}/{m.denominator})</div>}
      <button data-testid={`button-metric-details-${m.key}`} onClick={() => setOpen((v) => !v)} className={cn(btn.quiet, "-ml-3 mt-1")}><ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} /> How it is measured</button>
      {open && <p className="reveal text-[13.5px] leading-relaxed">{m.definition}</p>}
    </div>
  );
}

function Consolidation({ caseId }: { caseId: string }) {
  const role = useRole();
  const q = useGetCaseConsolidation(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseConsolidationQueryKey(caseId) } });
  const dec = useRecordCaseDecision();
  const invalidate = useInvalidateCase();
  const say = useUndoToast();
  const [sel, setSel] = useState<string | null>(null);
  const [disp, setDisp] = useState<Record<string, Disp>>({});
  const [drawer, setDrawer] = useState(false);
  if (q.isLoading) return <Skel className="h-72" />;
  if (!q.data) return <p className="text-bad">This consolidation case could not load.</p>;
  const v = q.data;
  const canApprove = role === "it" && (v.availableActions.find((a) => a.role === "it")?.actions ?? []).includes("approve_consolidation");
  const chosen = v.current.find((c) => c.solution.id === sel);
  const capCount = new Map<string, number>();
  v.current.forEach((c) => c.solution.capabilityIds.forEach((id) => capCount.set(id, (capCount.get(id) ?? 0) + 1)));
  const approve = () => dec.mutate({ caseId, data: { role: "it", action: "approve_consolidation", reason: Object.entries(disp).map(([id, d]) => `${v.current.find((c) => c.solution.id === id)?.solution.name}: ${d}`).join("; ") || undefined } }, {
    onSuccess: () => { invalidate(caseId); q.refetch(); say("Consolidation direction approved."); }, onError: (e) => say(errMsg(e)),
  });

  return (
    <section className="card-soft p-6" data-testid={`consolidation-${caseId}`}>
      <div className="flex flex-wrap items-start gap-3">
        <h3 className="flex-1 text-[19px] font-semibold">{v.headline}</h3>
        <button data-testid="button-consolidation-details" onClick={() => setDrawer(true)} className={btn.quiet}><Info className="h-4 w-4" /> Details</button>
      </div>
      <div className="mt-5 grid items-center gap-4 lg:grid-cols-[1fr_auto_1fr]" onDoubleClick={() => setDrawer(true)}>
        <div>
          <div className="eyebrow mb-2">Current</div>
          <div className="space-y-2">
            {v.current.map((c) => {
              const d = disp[c.solution.id] ?? DEFAULT[c.fate];
              return (
                <button key={c.solution.id} data-testid={`source-${c.solution.id}`} onClick={() => setSel(sel === c.solution.id ? null : c.solution.id)}
                  className={cn("flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-[border-color,box-shadow]", sel === c.solution.id ? "border-primary shadow-[0_0_0_2px_hsl(var(--primary)/.2)]" : "border-border hover:border-primary/40")}>
                  <div className="min-w-0 flex-1"><div className="font-semibold">{c.solution.name}</div><div className="text-[12.5px] text-muted-foreground">{c.solution.ownerName}</div></div>
                  <StatusPill status={c.solution.status} />
                  <Tag tone={d === "Retire" ? "muted" : d === "Retain" ? "green" : "sky"} testid={`disposition-${c.solution.id}`}>{d}</Tag>
                </button>
              );
            })}
          </div>
        </div>
        <ArrowRight className="mx-auto h-6 w-6 rotate-90 text-sienna lg:rotate-0" />
        <div className="rounded-xl border-2 border-ok/50 bg-okbg/40 p-4" data-testid="future-product">
          <div className="eyebrow mb-1">Proposed</div>
          <div className="text-[18px] font-semibold text-primary">{v.future.name}</div>
          <p className="text-[13.5px]">{v.future.core}</p>
          <ul className="mt-2 space-y-1 text-[13.5px]">{v.future.modules.map((m) => <li key={m.name} className="flex gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />{m.name} <span className="text-muted-foreground">from {m.sourceSolutionName}</span></li>)}</ul>
          {v.future.controls.length > 0 && <p className="mt-2 text-[12.5px] text-muted-foreground">Controls kept: {v.future.controls.join(", ")}</p>}
        </div>
      </div>

      {chosen && (
        <div className="reveal mt-4 rounded-xl bg-secondary/60 p-4" data-testid="panel-source">
          <div className="font-semibold text-primary">{chosen.solution.name}</div>
          <p className="text-[14px]">{chosen.note}</p>
          <div className="mt-2 grid gap-2 text-[13.5px] sm:grid-cols-2">
            <div><span className="text-muted-foreground">Owner: </span>{chosen.solution.ownerName}</div>
            <div><span className="text-muted-foreground">Retirement: </span>{chosen.solution.retirementCandidate ? "Candidate for retirement" : "Not a retirement candidate"}</div>
            <div><span className="text-muted-foreground">Unique capabilities: </span>{chosen.solution.capabilityIds.filter((id) => capCount.get(id) === 1).length}</div>
            <div><span className="text-muted-foreground">Shared capabilities: </span>{chosen.solution.capabilityIds.filter((id) => (capCount.get(id) ?? 0) > 1).length}</div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Disposition">
            {DISPOSITIONS.map((d) => {
              const on = (disp[chosen.solution.id] ?? DEFAULT[chosen.fate]) === d;
              return <button key={d} role="radio" aria-checked={on} disabled={role !== "it" || !!v.decided} data-testid={`set-disposition-${d.replace(/\s/g, "-").toLowerCase()}`} onClick={() => setDisp({ ...disp, [chosen.solution.id]: d })}
                className={cn("min-h-9 rounded-lg border px-3 text-[13.5px] font-medium disabled:opacity-60", on ? "border-primary bg-primary text-white" : "border-input bg-card")}>{d}{d === DEFAULT[chosen.fate] && " (recommended)"}</button>;
            })}
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {v.decided ? <p data-testid="text-decided" className="inline-flex items-center gap-2 rounded-lg bg-okbg px-3 py-2 text-[14px] font-medium text-ok"><Check className="h-4 w-4" />{v.decided}</p>
          : canApprove ? <button data-testid="button-approve-direction" onClick={approve} disabled={dec.isPending} className={btn.primary}>Approve direction</button>
          : <p className="text-[13.5px] text-muted-foreground">{role === "it" ? "Not ready for an IT decision yet." : "Switch to Govern to approve the direction."}</p>}
        <span className="text-[13px] text-muted-foreground">Main risk: {v.risk}</span>
      </div>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title={v.future.name} sub={v.headline} testid="drawer-consolidation">
        <DSection label="Outcomes"><ul className="list-disc pl-5">{v.outcomes.map((o) => <li key={o}>{o}</li>)}</ul></DSection>
        <DSection label="Evidence"><ul className="list-disc space-y-1 pl-5">{v.evidence.map((e) => <li key={e}>{e}</li>)}</ul></DSection>
        <DSection label="Capability provenance"><ul className="space-y-1">{v.future.modules.map((m) => <li key={m.name}>{m.name}, from {m.sourceSolutionName}</li>)}</ul></DSection>
        <DSection label="Ownership">{v.current.map((c) => `${c.solution.name}: ${c.solution.ownerName} (${c.solution.ownerTeam})`).join(" · ")}</DSection>
        <DSection label="Dependencies">{[...new Set(v.current.flatMap((c) => c.solution.dependencies))].join(", ") || "None recorded"}</DSection>
        <DSection label="Risk">{v.risk}</DSection>
        <DSection label="Retirement readiness">{v.current.map((c) => `${c.solution.name}: ${c.fate === "retired" ? "to retire" : c.fate === "folded" ? "capabilities folded in" : "base product"}`).join(" · ")}</DSection>
        <DSection label="Approval">{v.decided ?? "No IT decision recorded yet."}</DSection>
        <DSection label="Costs">Not recorded for this case.</DSection>
      </Drawer>
    </section>
  );
}
