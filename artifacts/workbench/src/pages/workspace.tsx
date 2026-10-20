import { useState, type ReactNode } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, Bookmark, BookmarkCheck, Check, ChevronDown, FlaskConical, Lock, Minus, Plus, Settings2 } from "lucide-react";
import {
  getGetCaseConfigurationQueryKey,
  getGetCaseExperimentPlanQueryKey,
  getGetCaseQueryKey,
  getGetCaseRecommendationQueryKey,
  getGetCaseComparisonQueryKey,
  getGetCaseReviewQueryKey,
  getGetExperimentQueryKey,
  getListCasesQueryKey,
  getListExperimentsQueryKey,
  useGetCase,
  useGetCaseComparison,
  useGetCaseConfiguration,
  useGetCaseExperimentPlan,
  useGetCaseRecommendation,
  useGetExperiment,
  useRecordCaseDecision,
  useRunCaseExperiment,
  useUpdateCase,
  useUpdateCaseConfiguration,
  type Case,
  type CapabilityProvenance,
  type ComponentConfig,
  type ImpactDimension,
} from "@workspace/api-client-react";
import { CaseBadge, EvidenceBadge, ErrorState, Meter, Panel, Rise, Skel, SolutionBadge, Tag, btnPrimary, btnSecondary } from "@/components/kit";
import { useRole } from "@/lib/persona";
import { featureState, pct, recommendation, type Tone } from "@/lib/labels";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", label: "Overview", n: "01" },
  { id: "compare", label: "Compare", n: "02" },
  { id: "configure", label: "Configure", n: "03" },
  { id: "test", label: "Test", n: "04" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function Workspace() {
  const { caseId = "" } = useParams<{ caseId: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const raw = new URLSearchParams(search).get("tab");
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : "overview";
  const cq = useGetCase(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseQueryKey(caseId) } });
  const upd = useUpdateCase();

  if (cq.isError) return <ErrorState onRetry={() => cq.refetch()} message="That case could not be found." />;
  const c = cq.data;

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="eyebrow mb-1.5">Solution workspace</div>
          {c ? (
            <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-bold md:text-3xl">{c.title}</h1><CaseBadge status={c.status} /></div>
          ) : <Skel className="h-9 w-80" />}
        </div>
        {c && (
          <div className="flex gap-2">
            <button
              onClick={() => upd.mutate({ caseId, data: { saved: !c.saved } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) }); qc.invalidateQueries({ queryKey: getListCasesQueryKey() }); } })}
              data-testid="button-toggle-saved"
              className={btnSecondary}
            >
              {c.saved ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}{c.saved ? "Saved" : "Save"}
            </button>
            {c.status !== "draft" && c.status !== "simulated" && <Link href={`/cases/${caseId}/review`} className={btnSecondary} data-testid="link-review">Change review <ArrowRight className="h-3.5 w-3.5" /></Link>}
          </div>
        )}
      </div>
      <div className="mb-6 flex overflow-x-auto border-b">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setLocation(`/cases/${caseId}?tab=${t.id}`)} data-testid={`tab-${t.id}`} className={cn("relative flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-colors", tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            <span className="font-mono text-[10px] opacity-60">{t.n}</span>{t.label}
            {tab === t.id && <motion.span layoutId="tab-line" className="absolute inset-x-0 -bottom-px h-[3px] bg-primary" />}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          {tab === "overview" && <Overview caseId={caseId} />}
          {tab === "compare" && <Compare caseId={caseId} />}
          {tab === "configure" && <Configure caseId={caseId} />}
          {tab === "test" && c && <Test c={c} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ---------- Overview ---------- */
function Overview({ caseId }: { caseId: string }) {
  const role = useRole();
  const q = useGetCaseRecommendation(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseRecommendationQueryKey(caseId) } });
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data) return <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]"><Skel className="h-72" /><Skel className="h-72" /></div>;
  const r = q.data;
  const b = r.baseSolution;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-5">
        <Rise>
          <article className="overflow-hidden rounded-lg border-2 border-foreground bg-card shadow-[6px_6px_0_hsl(var(--primary))]">
            <div className="grid gap-4 p-5 md:grid-cols-[1fr_auto]">
              <div>
                <div className="eyebrow mb-2 !text-primary">Recommended base product</div>
                <div className="mb-1 flex flex-wrap items-center gap-2"><h2 className="text-2xl font-bold">{b.name}</h2><SolutionBadge status={b.status} /></div>
                <p className="text-muted-foreground">{r.summary}</p>
              </div>
              <div className="text-right">
                <div className="font-display text-6xl font-extrabold leading-none text-primary">{r.overallFit}</div>
                <div className="eyebrow mt-1">overall fit</div>
              </div>
            </div>
            <div className="border-t bg-accent px-5 py-3 text-sm text-accent-foreground"><span className="eyebrow mr-2 !text-accent-foreground">For you</span>{r.roleSummaries[role]}</div>
          </article>
        </Rise>
        <ProvList title="Capabilities to add" icon={<Plus className="h-3.5 w-3.5" />} items={r.capabilitiesToAdd} tone="signal" />
        <ProvList title="Capabilities to retain" icon={<Check className="h-3.5 w-3.5" />} items={r.capabilitiesToRetain} tone="ok" compact />
        {r.duplicates.length > 0 && <ProvList title="Duplicates not to add" icon={<Minus className="h-3.5 w-3.5" />} items={r.duplicates} tone="muted" compact />}
        {r.incompatible.length > 0 && <ProvList title="Incompatible" icon={<AlertTriangle className="h-3.5 w-3.5" />} items={r.incompatible} tone="bad" compact />}
      </div>
      <div className="space-y-4">
        <Panel title="Confidence">
          <div className="mb-2 font-display text-3xl font-bold">{Math.round(r.confidence * 100)}%</div>
          <Meter value={r.confidence * 100} tone={r.confidence > 0.7 ? "ok" : "warn"} />
          <p className="mt-3 text-xs text-muted-foreground"><span className="font-mono uppercase tracking-wider text-foreground">Adoption effort</span> · {r.adoptionEffort}</p>
        </Panel>
        <Panel title="Why this recommendation">
          <ol className="space-y-2 text-sm">{r.rationale.map((x, i) => <li key={i} className="flex gap-2.5"><span className="font-mono text-xs text-primary">{String(i + 1).padStart(2, "0")}</span>{x}</li>)}</ol>
        </Panel>
        <Panel title="Overlapping solutions">
          <ul className="space-y-1.5 text-sm">{r.overlappingSolutions.map((s) => <li key={s.id} className="flex items-center justify-between gap-2"><Link href={`/library/${s.id}`} className="hover:text-primary">{s.name}</Link><SolutionBadge status={s.status} /></li>)}</ul>
        </Panel>
        {r.retirementCandidates.length > 0 && (
          <Panel title="Retirement candidates" className="border-warn/40">
            <ul className="space-y-1.5 text-sm">{r.retirementCandidates.map((s) => <li key={s.id} className="flex items-center justify-between"><span>{s.name}</span><Tag tone="warn">Retiring</Tag></li>)}</ul>
          </Panel>
        )}
      </div>
    </div>
  );
}

function ProvList({ title, items, tone, icon, compact }: { title: string; items: CapabilityProvenance[]; tone: Tone; icon: ReactNode; compact?: boolean }) {
  if (items.length === 0) return null;
  const dot = { signal: "bg-primary text-primary-foreground", ok: "bg-ok text-white", muted: "bg-muted text-muted-foreground", bad: "bg-bad text-white", warn: "bg-warn text-white", ink: "bg-foreground text-background" }[tone];
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><span className={cn("grid h-5 w-5 place-items-center rounded", dot)}>{icon}</span>{title}<span className="font-mono text-xs text-muted-foreground">{items.length}</span></h3>
      <div className={cn("grid gap-2", compact && "md:grid-cols-2")}>
        {items.map((p, i) => {
          const [l, t] = featureState[p.state];
          return (
            <Rise key={p.capability.id} i={i}>
              <div className="rounded-md border bg-card px-3.5 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold">{p.capability.name}</div>
                  <Tag tone={t}>{l}</Tag>
                </div>
                <div className="mt-0.5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">from {p.sourceSolutionName}</div>
                {!compact && (
                  <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                    <div><span className="text-muted-foreground">Reason · </span>{p.reason}</div>
                    <div><span className="text-muted-foreground">Evidence · </span>{p.evidence}</div>
                  </div>
                )}
              </div>
            </Rise>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- Compare ---------- */
const VERDICT: Record<string, [string, Tone]> = { common: ["Common", "muted"], unique: ["Unique", "signal"], stronger: ["Stronger", "ok"], unsupported: ["Unsupported", "bad"], retire: ["Retire", "warn"] };

function Compare({ caseId }: { caseId: string }) {
  const q = useGetCaseComparison(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseComparisonQueryKey(caseId) } });
  const [open, setOpen] = useState<string | null>(null);
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data) return <Skel className="h-96" />;
  const c = q.data;
  return (
    <div>
      <p className="mb-4 max-w-3xl text-muted-foreground">{c.summary}</p>
      <div className="mb-2 hidden grid-cols-[1fr_auto_120px] gap-3 px-4 md:grid">
        <span />
        <div className="flex gap-1">{c.solutions.map((s) => <span key={s.id} title={s.name} className={cn("w-16 truncate text-center font-mono text-[10px] uppercase", s.id === c.baseSolutionId ? "font-bold text-primary" : "text-muted-foreground")}>{s.name.split(" ")[0]}</span>)}</div>
        <span />
      </div>
      <div className="space-y-1.5">
        {c.rows.map((r, i) => {
          const [vl, vt] = VERDICT[r.verdict];
          const isOpen = open === r.capability.id;
          return (
            <Rise key={r.capability.id} i={i}>
              <div className="rounded-md border bg-card">
                <button onClick={() => setOpen(isOpen ? null : r.capability.id)} data-testid={`row-compare-${r.capability.id}`} className="grid w-full grid-cols-1 items-center gap-3 px-4 py-2.5 text-left md:grid-cols-[1fr_auto_120px]">
                  <div>
                    <div className="text-sm font-semibold">{r.capability.name}</div>
                    <div className="text-xs text-muted-foreground">{r.verdictNote}</div>
                  </div>
                  <div className="flex gap-1">
                    {c.solutions.map((s) => {
                      const p = r.presence.find((x) => x.solutionId === s.id);
                      const str = p?.present ? p.strength : "none";
                      return (
                        <span key={s.id} title={`${s.name}: ${str}`} className="flex w-16 justify-center">
                          <span className={cn("h-3 rounded-sm", str === "strong" ? "w-10 bg-ok" : str === "standard" ? "w-7 bg-foreground/60" : str === "weak" ? "w-4 bg-warn" : "w-4 border border-dashed border-muted-foreground/40")} />
                        </span>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-end gap-2"><Tag tone={vt}>{vl}</Tag><ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isOpen && "rotate-180")} /></div>
                </button>
                {isOpen && <div className="border-t bg-muted/30 px-4 py-2.5 text-sm"><span className="eyebrow mr-2">Evidence</span>{r.evidence}<div className="mt-1 text-xs text-muted-foreground">Owned by {r.capability.ownerName} · test coverage {r.capability.testCoverage} · {r.capability.supportStatus}</div></div>}
              </div>
            </Rise>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-4 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-6 rounded-sm bg-ok" />Strong</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-foreground/60" />Standard</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm bg-warn" />Weak</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm border border-dashed border-muted-foreground/40" />Absent</span>
      </div>
    </div>
  );
}

/* ---------- Configure ---------- */
function Configure({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const key = getGetCaseConfigurationQueryKey(caseId);
  const q = useGetCaseConfiguration(caseId, { query: { enabled: !!caseId, queryKey: key } });
  const upd = useUpdateCaseConfiguration();
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data) return <div className="space-y-4"><Skel className="h-12" /><div className="grid gap-3 md:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skel key={i} className="h-64" />)}</div></div>;
  const cfg = q.data;

  const apply = (data: Parameters<typeof upd.mutate>[0]["data"]) =>
    upd.mutate(
      { caseId, data },
      {
        onSuccess: (next) => {
          qc.setQueryData(key, next);
          [getGetCaseRecommendationQueryKey(caseId), getGetCaseReviewQueryKey(caseId), getGetCaseExperimentPlanQueryKey(caseId), getGetCaseQueryKey(caseId)].forEach((k) => qc.invalidateQueries({ queryKey: k }));
        },
      },
    );

  const p = cfg.impact.projected;
  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-2xl text-sm text-muted-foreground">{cfg.summary}</p>
          <div className="flex gap-2 font-mono text-xs">
            <span className="rounded border bg-card px-2 py-1"><b className="text-primary">{cfg.activeModuleCount}</b> active modules</span>
            <span className="rounded border bg-card px-2 py-1"><b>{cfg.lockedCount}</b> locked</span>
          </div>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {cfg.steps.map((s, i) => (
            <div key={s.name} className="w-[250px] shrink-0">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded bg-foreground font-mono text-[11px] font-semibold text-background">{i + 1}</span>
                <span className="font-display font-semibold">{s.name}</span>
                {i < cfg.steps.length - 1 && <span className="ml-auto h-px flex-1 bg-foreground/25" />}
              </div>
              <div className="space-y-2">{s.components.map((c) => <Component key={c.capability.id} c={c} busy={upd.isPending} onToggle={() => apply({ moduleStates: { [c.capability.id]: !c.active } })} onSelect={(v) => apply({ configValues: { [c.capability.id]: v } })} />)}</div>
            </div>
          ))}
        </div>
      </div>
      <aside className="xl:sticky xl:top-20 xl:self-start">
        <Panel title="Impact" right={upd.isPending && <span className="font-mono text-[10px] text-primary">updating</span>}>
          <div className={cn("space-y-3 transition-opacity", upd.isPending && "opacity-60")}>
            <Dim name="User value" d={cfg.impact.userValue} tone="ok" />
            <Dim name="Effort" d={cfg.impact.effort} tone="warn" />
            <Dim name="Risk" d={cfg.impact.risk} tone="bad" />
            <Dim name="Compatibility" d={cfg.impact.compatibility} tone="ink" />
            <Dim name="Evidence confidence" d={cfg.impact.evidenceConfidence} tone="signal" />
          </div>
          <div className="mt-4 border-t pt-3">
            <div className="eyebrow mb-2">Projected</div>
            <dl className="grid grid-cols-2 gap-y-1.5 font-mono text-xs">
              <dt className="text-muted-foreground">Task time</dt><dd className="text-right">{p.taskMinutes} min</dd>
              <dt className="text-muted-foreground">Success</dt><dd className="text-right">{p.successRate}%</dd>
              <dt className="text-muted-foreground">Error rate</dt><dd className="text-right">{p.errorRate}%</dd>
              <dt className="text-muted-foreground">Effort</dt><dd className="text-right">{p.effortScore}/10</dd>
              <dt className="text-muted-foreground">Adoption</dt><dd className="text-right">{p.adoption}%</dd>
              <dt className="text-muted-foreground">Cost / task</dt><dd className="text-right">${p.costPerTask.toFixed(2)}</dd>
            </dl>
          </div>
          <Link href={`/cases/${caseId}?tab=test`} className={cn(btnPrimary, "mt-4 w-full")} data-testid="link-to-test">Test this configuration <ArrowRight className="h-4 w-4" /></Link>
        </Panel>
      </aside>
    </div>
  );
}

function Dim({ name, d, tone }: { name: string; d: ImpactDimension; tone: Tone }) {
  return (
    <div title={d.note}>
      <div className="mb-1 flex items-baseline justify-between text-xs"><span className="font-medium">{name}</span><span className="font-mono text-muted-foreground">{d.label} · {d.score}</span></div>
      <Meter value={d.score} tone={tone} />
    </div>
  );
}

function Component({ c, onToggle, onSelect, busy }: { c: ComponentConfig; onToggle: () => void; onSelect: (v: string) => void; busy: boolean }) {
  const locked = c.controlType === "locked";
  const blocked = !!c.blockedReason;
  return (
    <div className={cn("rounded-md border bg-card p-3 transition-all", locked && "bg-muted/50", c.controlType === "optional" && c.active && "border-primary/50 shadow-[inset_3px_0_0_hsl(var(--primary))]", blocked && "border-dashed opacity-70")} data-testid={`component-${c.capability.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold leading-tight">{locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}{c.capability.name}</div>
          <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{c.sourceSolutionName}</div>
        </div>
        {c.controlType === "optional" && (
          <button role="switch" aria-checked={c.active} disabled={blocked || busy} onClick={onToggle} data-testid={`toggle-${c.capability.id}`} className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed", c.active ? "bg-primary" : "bg-muted-foreground/30")}>
            <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 32 }} className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-card shadow", c.active ? "right-0.5" : "left-0.5")} />
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Tag tone={locked ? "ink" : "muted"}>{locked ? "Required" : c.controlType === "configurable" ? "Configurable" : "Optional"}</Tag>
        {c.recommended && <Tag tone="signal">Recommended</Tag>}
        {blocked && <Tag tone="bad">Incompatible</Tag>}
        {c.state === "retiring" && <Tag tone="warn">Retiring</Tag>}
      </div>
      {locked && c.capability.lockedReason && <p className="mt-2 text-xs text-muted-foreground">{c.capability.lockedReason}</p>}
      {blocked && <p className="mt-2 text-xs text-bad">{c.blockedReason}</p>}
      {c.controlType === "configurable" && c.options && (
        <div className="mt-2 flex flex-wrap gap-1">
          {c.options.map((o) => (
            <button key={o} disabled={busy} onClick={() => o !== c.value && onSelect(o)} data-testid={`option-${c.capability.id}-${o}`} className={cn("rounded border px-2 py-0.5 text-xs transition-colors", o === c.value ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted")}>{o}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Test ---------- */
function Test({ c }: { c: Case }) {
  const caseId = c.id;
  const qc = useQueryClient();
  const { toast } = useToast();
  const plan = useGetCaseExperimentPlan(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseExperimentPlanQueryKey(caseId) } });
  const run = useRunCaseExperiment();
  const [adv, setAdv] = useState(false);

  const doRun = () =>
    run.mutate(
      { caseId },
      {
        onSuccess: (e) => {
          qc.setQueryData(getGetExperimentQueryKey(e.id), e);
          [getGetCaseQueryKey(caseId), getListExperimentsQueryKey(), getGetCaseReviewQueryKey(caseId), getListCasesQueryKey()].forEach((k) => qc.invalidateQueries({ queryKey: k }));
          toast({ title: "Simulation complete", description: "Projected outcomes are ready." });
        },
      },
    );

  if (plan.isError) return <ErrorState onRetry={() => plan.refetch()} />;
  const p = plan.data;

  return (
    <div className="space-y-6">
      {!p ? <Skel className="h-48" /> : (
        <Panel title="Experiment plan" right={c.experimentId && <button onClick={doRun} disabled={run.isPending} className="font-mono text-[11px] text-primary hover:underline" data-testid="button-rerun">{run.isPending ? "running..." : "Re-run"}</button>}>
          <div className="grid gap-5 md:grid-cols-[1fr_1fr_auto]">
            <div>
              <div className="eyebrow mb-1">Baseline</div><div className="font-semibold">{p.baselineName}</div>
              <div className="eyebrow mb-1 mt-3 !text-primary">Challenger</div><div className="font-semibold">{p.challengerName}</div>
            </div>
            <div>
              <div className="eyebrow mb-1">Measuring</div>
              <div className="flex flex-wrap gap-1">{p.metrics.map((m) => <Tag key={m}>{m}</Tag>)}</div>
              <div className="eyebrow mb-1 mt-3">Synthetic cohort</div>
              <div className="text-sm">{p.cohort.map((x) => x.name).join(", ")}</div>
            </div>
            <div className="flex flex-col items-start gap-2 md:items-end">
              {!c.experimentId && (
                <button onClick={doRun} disabled={run.isPending} className={btnPrimary} data-testid="button-run-simulation">
                  <FlaskConical className={cn("h-4 w-4", run.isPending && "animate-pulse")} /> {run.isPending ? "Simulating cohort..." : "Run simulation"}
                </button>
              )}
              <span className="font-mono text-[11px] text-muted-foreground">n = {p.recommendedSample} · {p.durationWeeks} weeks</span>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{p.summary}</p>
          <button onClick={() => setAdv((v) => !v)} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" data-testid="button-advanced"><Settings2 className="h-3.5 w-3.5" /> Advanced settings <ChevronDown className={cn("h-3 w-3 transition-transform", adv && "rotate-180")} /></button>
          {adv && (
            <div className="mt-3 grid gap-4 border-t pt-3 md:grid-cols-2">
              <div>
                <div className="eyebrow mb-2">Persona profiles</div>
                <table className="w-full font-mono text-[11px]">
                  <thead><tr className="text-left text-muted-foreground"><th className="py-1">Persona</th><th>Exp</th><th>Vol</th><th>Data</th><th>Change</th></tr></thead>
                  <tbody>{p.cohort.map((x) => <tr key={x.id} className="border-t"><td className="py-1 font-sans text-xs">{x.name}</td><td>{x.experience.toFixed(2)}</td><td>{x.volume.toFixed(2)}</td><td>{x.dataQuality.toFixed(2)}</td><td>{x.changeTolerance.toFixed(2)}</td></tr>)}</tbody>
                </table>
              </div>
              <div><div className="eyebrow mb-2">Key risks</div><ul className="space-y-1 text-sm">{p.keyRisks.map((r) => <li key={r} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />{r}</li>)}</ul></div>
            </div>
          )}
        </Panel>
      )}
      {run.isPending && !c.experimentId && <Skel className="h-72" />}
      {c.experimentId && <Result experimentId={c.experimentId} c={c} />}
    </div>
  );
}

function Result({ experimentId, c }: { experimentId: string; c: Case }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const e = useGetExperiment(experimentId, { query: { enabled: !!experimentId, queryKey: getGetExperimentQueryKey(experimentId) } });
  const decide = useRecordCaseDecision();
  if (e.isError) return <ErrorState onRetry={() => e.refetch()} />;
  if (!e.data) return <Skel className="h-80" />;
  const x = e.data;
  const rec = recommendation[x.recommendation];
  const primary = x.metrics.filter((m) => m.primary).slice(0, 4);
  const metrics = primary.length ? primary : x.metrics.slice(0, 4);
  const chart = x.segments.map((s) => ({ name: s.persona.name, Baseline: s.baselineTaskMinutes, Proposed: s.proposedTaskMinutes }));
  const proposed = c.status !== "draft" && c.status !== "simulated";

  const propose = () =>
    decide.mutate(
      { caseId: c.id, data: { role: "seeker", action: "approve_simulation" } },
      {
        onSuccess: () => {
          [getGetCaseQueryKey(c.id), getGetCaseReviewQueryKey(c.id), getListCasesQueryKey()].forEach((k) => qc.invalidateQueries({ queryKey: k }));
          toast({ title: "Controlled pilot proposed", description: "Sent to the solution owner for review." });
        },
      },
    );

  return (
    <div className="space-y-5">
      <div className="hatch flex items-center gap-3 rounded-md border-2 border-dashed border-primary/60 px-4 py-3" data-testid="text-experiment-label">
        <FlaskConical className="h-5 w-5 shrink-0 text-primary" />
        <span className="font-display text-base font-bold">{x.label}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m, i) => (
          <Rise key={m.key} i={i}>
            <div className="rounded-md border bg-card p-3.5">
              <div className="eyebrow">{m.label}</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-display text-3xl font-bold tabular-nums">{m.proposed}</span><span className="text-xs text-muted-foreground">{m.unit}</span>
                <span className={cn("ml-auto font-mono text-sm font-semibold", m.improved ? "text-ok" : "text-bad")}>{pct(m.deltaPct)}</span>
              </div>
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground"><span className="w-12">before</span><div className="flex-1"><Meter value={(m.baseline / Math.max(m.baseline, m.proposed)) * 100} tone="muted" /></div><span className="w-10 text-right font-mono">{m.baseline}</span></div>
                <div className="flex items-center gap-2 text-[10.5px]"><span className="w-12 text-muted-foreground">after</span><div className="flex-1"><Meter value={(m.proposed / Math.max(m.baseline, m.proposed)) * 100} tone={m.improved ? "ok" : "bad"} /></div><span className="w-10 text-right font-mono">{m.proposed}</span></div>
              </div>
            </div>
          </Rise>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Task minutes by synthetic persona">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} barGap={2}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={30} />
                <Tooltip cursor={{ fill: "hsl(var(--muted))" }} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Baseline" fill="hsl(var(--chart-5))" radius={[2, 2, 0, 0]} />
                <Bar dataKey="Proposed" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 divide-y border-t">
            {x.segments.map((s) => (
              <li key={s.persona.id} className="grid grid-cols-[1fr_auto] gap-2 py-2 text-sm">
                <div><span className="font-medium">{s.persona.name}</span><span className="ml-2 font-mono text-xs text-muted-foreground">success {s.baselineSuccessRate}% to {s.proposedSuccessRate}%</span>{s.flag && <div className="mt-0.5 flex items-center gap-1 text-xs text-warn"><AlertTriangle className="h-3 w-3" />{s.flag}</div>}</div>
                <span className={cn("font-mono text-sm font-semibold", s.deltaPct <= 0 ? "text-ok" : "text-bad")}>{pct(s.deltaPct)}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <div className="space-y-4">
          <Panel title="Recommendation">
            <div className="flex items-center justify-between"><Tag tone={rec[1]} className="!text-xs">{rec[0]}</Tag><span className="font-mono text-xs text-muted-foreground">confidence {Math.round(x.confidence * 100)}%</span></div>
            <Meter value={x.confidence * 100} tone={rec[1]} className="mt-2" />
            <p className="mt-3 text-sm">{x.narrative}</p>
          </Panel>
          <Panel title="Risks">
            <ul className="space-y-1.5 text-sm">{x.risks.map((r) => <li key={r} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />{r}</li>)}</ul>
          </Panel>
          <div className="rounded-md border-2 border-foreground bg-card p-4">
            {proposed ? (
              <>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Check className="h-4 w-4 text-ok" />Pilot recommendation created</div>
                <Link href={`/cases/${c.id}/review`} className={cn(btnPrimary, "w-full")} data-testid="link-open-review">Open change review <ArrowRight className="h-4 w-4" /></Link>
              </>
            ) : (
              <>
                <p className="mb-3 text-xs text-muted-foreground">Sends a controlled pilot proposal to the solution owner and IT. Nothing reaches users until both approve.</p>
                <button onClick={propose} disabled={decide.isPending} className={cn(btnPrimary, "w-full")} data-testid="button-create-pilot">{decide.isPending ? "Creating..." : "Create controlled pilot recommendation"}</button>
              </>
            )}
          </div>
          <EvidenceNote />
        </div>
      </div>
    </div>
  );
}

function EvidenceNote() {
  return <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><EvidenceBadge level="limited" /> Simulated evidence only. A live pilot replaces it.</div>;
}
