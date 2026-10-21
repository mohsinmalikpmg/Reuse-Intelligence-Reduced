import { useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { ArrowRight, ChevronRight, Eye, EyeOff, FlaskConical, GitCompare, History, Info, Lock, PencilRuler, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import {
  getGetSolutionQueryKey, getGetSolutionWorkbenchQueryKey, useCreateCase, useGetSolution, useGetSolutionWorkbench, useListSolutions, type Capability,
} from "@workspace/api-client-react";
import { DSection, DispositionBadge, Drawer, ErrorView, LoadingView, Page, Skel, StatusPill, Tag, btn, useUndoToast, StageEyebrow } from "@/components/bits";
import { caseStatusLabel } from "@/components/wb-pilot";
import { OutputView, RunMeta } from "@/components/output-view";
import { blocksFromWorkbench, type FlowBlock } from "@/components/flow";
import { errMsg, useCurrentCase } from "@/lib/case";
import { MetaGrid, MetaTags, OutputPreviewPanel, isLive } from "@/components/enterprise";
import { PrototypePanel, ComparedPrototypes } from "@/components/prototype-panel";
import { cn } from "@/lib/utils";

export default function SolutionPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { setCaseId } = useCurrentCase();
  const say = useUndoToast();
  const d = useGetSolution(id, { query: { enabled: !!id, queryKey: getGetSolutionQueryKey(id) } });
  // Products without an execution engine have no runs to show; their workbench endpoint would only report that.
  const live = d.data ? isLive(d.data.solution) : false;
  const wb = useGetSolutionWorkbench(id, { query: { enabled: !!id && live, queryKey: getGetSolutionWorkbenchQueryKey(id), retry: false } });
  const all = useListSolutions();
  const create = useCreateCase();
  const [step, setStep] = useState<FlowBlock | null>(null);
  const [stepDrawer, setStepDrawer] = useState(false);
  const [sample, setSample] = useState(false);
  const [drawer, setDrawer] = useState<"versions" | "details" | null>(null);
  const [cap, setCap] = useState<Capability | null>(null);
  const blocks = useMemo(() => (wb.data ? blocksFromWorkbench(wb.data.blocks) : []), [wb.data]);

  if (d.isLoading) return <LoadingView />;
  if (d.isError || !d.data) return <ErrorView onRetry={() => d.refetch()} message="This solution could not load." />;
  const { solution: s, capabilities, experimentsInProgress, prototype, comparedPrototypes } = d.data;

  const start = (mode?: "edit" | "compare") =>
    create.mutate({ data: { baseSolutionId: s.id, createdByRole: "seeker" } }, {
      onSuccess: (c) => { setCaseId(c.id); setLocation(`/workbench/${c.id}${mode ? `?mode=${mode}` : ""}`); },
      onError: (e) => say(errMsg(e)),
    });
  const usedIn = (c: Capability) => (all.data ?? []).filter((x) => x.capabilityIds.includes(c.id));
  const draft = s.versions.find((v) => v.state === "draft");
  const published = s.versions.find((v) => v.state === "current");
  const newIn = (c: Capability) => s.versions.find((v) => v.state === "current" && v.foldedCapabilities.some((f) => f.capabilityId === c.id))?.version;
  const trace = step ? wb.data?.exampleRun.trace.find((t) => t.stepId === step.id) : undefined;

  return (
    <Page>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={s.status} />
            <Tag tone={s.kind === "capability_module" ? "sky" : "slate"}>{s.kind === "capability_module" ? "Reusable capability" : s.kind === "prototype" ? "Prototype" : "Full workflow"}</Tag>
            <DispositionBadge disposition={s.disposition} solutionId={s.id} />
            <span className="text-[13.5px] text-muted-foreground" data-testid="text-version">v{s.currentVersion} · Owner {s.ownerName}{s.ownerTeam ? `, ${s.ownerTeam}` : ""}</span>
          </div>
          <StageEyebrow stage="trace" className="mt-3" />
          <h1 data-testid="text-headline" className="mt-2 text-[32px] md:text-[40px]">{s.name}</h1>
          <p data-testid="text-outcome" className="mt-2 text-[17px] leading-relaxed">{s.outcome}</p>
          <div className="mt-3"><MetaTags s={s} testid="meta-tags" /></div>
          {draft && (
            <p data-testid="text-draft-successor" className="mt-2 text-[14px] text-muted-foreground">
              Draft successor v{draft.version} approved by the owner, awaiting IT: {draft.foldedCapabilities.map((c) => c.name).join(", ") || draft.changedSettings.join(", ") || "configuration change"}.
            </p>
          )}
          {published && (
            <p data-testid="text-published-successor" className="mt-2 text-[14px] text-muted-foreground">
              v{published.version} is the governed version since {new Date(published.releasedAt).toLocaleDateString()}{published.foldedCapabilities.length ? `: ${published.foldedCapabilities.map((c) => `${c.name} from ${c.sourceSolutionName}`).join(", ")} now part of this product` : ""}.
            </p>
          )}
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          {live ? (
            <button data-testid="button-try" onClick={() => start()} disabled={create.isPending} className={btn.primary}>Try this solution <ArrowRight className="h-5 w-5" /></button>
          ) : (
            <a href={prototype ? "#prototype" : "#output-preview"} data-testid="button-see-preview" className={btn.primary}><Eye className="h-5 w-5" /> {prototype ? "See where it fits" : "See output preview"}</a>
          )}
          <div className="flex flex-wrap gap-1">
            {live && <button data-testid="button-starting-point" onClick={() => start("edit")} disabled={create.isPending} className={btn.quiet}><PencilRuler className="h-4 w-4" /> Use as starting point</button>}
            {live && <button data-testid="button-compare" onClick={() => start("compare")} disabled={create.isPending} className={btn.quiet}><GitCompare className="h-4 w-4" /> Compare</button>}
            <button data-testid="button-view-details" onClick={() => setDrawer("details")} className={btn.quiet}><Info className="h-4 w-4" /> View details</button>
          </div>
          {!live && !prototype && <span className="max-w-[260px] text-right text-[12.5px] text-muted-foreground" data-testid="text-preview-only">Catalogued with a sample-data preview. Not yet wired to run on your input, so no experiment can be opened on it.</span>}
          {prototype && <span className="max-w-[260px] text-right text-[12.5px] text-muted-foreground" data-testid="text-prototype-only">Runs on {prototype.platformName}, outside FUSEBOX. Its examples are what its builder submitted, not runs; no experiment can be opened on it.</span>}
        </div>
      </div>

      {prototype && <PrototypePanel prototype={prototype} />}

      {!prototype && <section className="mt-10">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-[18px] font-semibold">How it works</h2>
          <span className="text-[13.5px] text-muted-foreground">Click a step to preview it. Double-click, or Details, for the technical view.</span>
        </div>
        {!live ? (
          <ol className="card-soft flex flex-wrap items-stretch gap-y-3 p-4" data-testid="workflow-strip">
            {capabilities.map((c, i) => (
              <li key={c.id} className="flex items-stretch">
                <button data-testid={`step-${c.id}`} onClick={() => setCap(c)} className="w-[180px] rounded-xl border border-border bg-card px-3.5 py-3 text-left transition-[border-color,box-shadow] hover:border-primary/50">
                  <span className="font-mono text-[11.5px] text-muted-foreground">{i + 1} · {c.workflowStep}</span>
                  <span className="mt-0.5 block text-[15px] font-semibold leading-tight text-primary">{c.name}</span>
                  <span className="mt-1 block text-[12px] capitalize text-muted-foreground">{c.controlType}</span>
                </button>
                {i < capabilities.length - 1 && <ChevronRight className="mx-1 h-4 w-4 self-center text-muted-foreground/60" />}
              </li>
            ))}
          </ol>
        ) : wb.isLoading ? <Skel className="h-28" /> : blocks.length ? (
          <ol className="card-soft flex flex-wrap items-stretch gap-y-3 p-4" data-testid="workflow-strip">
            {blocks.map((b, i) => (
              <li key={b.id} className="flex items-stretch">
                <button data-testid={`step-${b.id}`} onClick={() => setStep(step?.id === b.id ? null : b)} onDoubleClick={() => { setStep(b); setStepDrawer(true); }}
                  className={cn("w-[180px] rounded-xl border px-3.5 py-3 text-left transition-[border-color,box-shadow]", step?.id === b.id ? "border-primary bg-secondary shadow-[0_0_0_2px_hsl(var(--primary)/.2)]" : "border-border bg-card hover:border-primary/50", !b.active && "border-dashed opacity-60")}>
                  <span className="font-mono text-[11.5px] text-muted-foreground">{i + 1}</span>
                  <span className="mt-0.5 block text-[15px] font-semibold leading-tight text-primary">{b.name}</span>
                  <span className="mt-1 block text-[12px] capitalize text-muted-foreground">{b.kind}{!b.active ? " · off" : ""}</span>
                </button>
                {i < blocks.length - 1 && <ChevronRight className="mx-1 h-4 w-4 self-center text-muted-foreground/60" />}
              </li>
            ))}
          </ol>
        ) : (
          <ol className="card-soft flex flex-wrap items-center gap-2 p-4 text-[15px]">{s.workflowSteps.map((w, i) => <li key={w} className="flex items-center gap-2"><span className="rounded-lg bg-secondary px-3 py-2 font-medium text-primary">{w}</span>{i < s.workflowSteps.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}</li>)}</ol>
        )}
        {step && (
          <div className="reveal mt-3 flex flex-wrap items-start gap-4 rounded-xl bg-secondary/70 p-4" data-testid="panel-step-preview">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-primary">{step.name}</div>
              <p className="text-[14.5px]">{step.description}</p>
              {trace && <p className="mt-1 text-[13.5px] text-muted-foreground">In the saved example: {trace.outputSummary}</p>}
            </div>
            <button data-testid="button-step-details" onClick={() => setStepDrawer(true)} className={btn.secondary}>Details</button>
          </div>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-[13.5px] text-muted-foreground"><ShieldCheck className="h-4 w-4 text-ok" /> Controls in place: {s.controls.join(", ")}</p>
      </section>}

      <section className="mt-8" data-testid="panel-record">
        <h2 className="mb-3 text-[18px] font-semibold">The record</h2>
        <div className="card-soft p-5"><MetaGrid s={s} /></div>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div id="output-preview">
          <div className="flex items-center gap-3">
            {live && <button data-testid="button-sample-output" disabled={!wb.data} onClick={() => setSample((v) => !v)} className={btn.secondary}>{sample ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {sample ? "Hide sample output" : "Show sample output"}</button>}
            <button data-testid="button-versions" onClick={() => setDrawer("versions")} className={btn.quiet}><History className="h-4 w-4" /> Version history</button>
          </div>
          {live && sample && wb.data && (
            <div className="card-soft reveal mt-3 p-5" data-testid="panel-sample-output">
              <div className="mb-3 flex flex-wrap items-center gap-2"><span className="eyebrow">Saved example run</span><RunMeta run={wb.data.exampleRun} /></div>
              <OutputView output={wb.data.exampleRun.output} testid="output-sample" />
            </div>
          )}
          {!live && s.outputPreview && <div className="mt-3"><OutputPreviewPanel preview={s.outputPreview} s={s} /></div>}
          {!live && !s.outputPreview && !prototype && <p className="mt-3 text-[14px] text-muted-foreground" data-testid="text-no-preview">No output preview has been recorded for this product yet.</p>}
          {prototype && <p className="mt-3 text-[14px] text-muted-foreground" data-testid="text-no-preview">No FUSEBOX output exists for a prototype: the submitted examples above are what its builder provided.</p>}
        </div>
        <div>
          <h2 className="mb-2 text-[16px] font-semibold">{prototype ? "Declared components" : "Reusable capabilities"}</h2>
          <ul className="space-y-1.5">
            {capabilities.slice(0, 6).map((c) => {
              const n = usedIn(c).length;
              return (
                <li key={c.id}>
                  <button data-testid={`cap-${c.id}`} onClick={() => setCap(c)} className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-[14.5px] hover:border-primary/40">
                    {c.controlType === "locked" && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                    {newIn(c) && <Tag tone="green" testid={`tag-new-in-${c.id}`}>New in v{newIn(c)}</Tag>}
                    <span className="text-[12.5px] text-muted-foreground">{n > 1 ? `also in ${n - 1}` : "only here"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {comparedPrototypes.length > 0 && <ComparedPrototypes items={comparedPrototypes} solutionName={s.name} />}

      {/* Experiments branch from this product and are listed here only; they never appear in the library or search. */}
      <section className="mt-8" data-testid="panel-experiments">
        <h2 className="mb-2 flex items-center gap-2 text-[16px] font-semibold"><FlaskConical className="h-4 w-4 text-primary" /> Experiments in progress ({experimentsInProgress.length})</h2>
        {experimentsInProgress.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">No one is testing a change to this product right now.</p>
        ) : (
          <ul className="space-y-1.5">
            {experimentsInProgress.map((e) => {
              const st = caseStatusLabel(e.case);
              return (
                <li key={e.case.id} data-testid={`experiment-${e.case.id}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-[14.5px]">
                  <span className="font-medium">{e.case.lineage.intent}</span>
                  <span className="text-[13px] text-muted-foreground">{e.case.lineage.summary} · {e.case.ownerName}{e.case.ownerTeam ? `, ${e.case.ownerTeam}` : ""}</span>
                  <Tag tone={st.tone}>{st.l}</Tag>
                  {e.case.demo && <Tag>Demo</Tag>}
                  <span className="flex-1" />
                  <Link href={`/workbench/${e.case.id}?mode=compare`} data-testid={`link-experiment-${e.case.id}`} className="text-[13.5px] font-semibold text-primary underline-offset-2 hover:underline">Open</Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Drawer open={stepDrawer && !!step} onClose={() => setStepDrawer(false)} title={step?.name ?? ""} sub={step?.description} testid="drawer-step">
        <DSection label="Behaviour">{step?.kind === "required" ? "Required. Cannot be switched off." : step?.kind === "configurable" ? `Configurable. Current setting: ${step.value ?? "default"}. Options: ${(step.options ?? []).join(", ")}` : "Optional. Can be turned on or off in a proposed version."}</DSection>
        <DSection label="Source">{step?.source}</DSection>
        {trace && <>
          <DSection label="Input received">{trace.inputSummary}</DSection>
          <DSection label="Transformation">{trace.transformation}</DSection>
          <DSection label="Output produced">{trace.outputSummary} · {trace.itemCount} items · {trace.durationMs} ms</DSection>
        </>}
      </Drawer>
      <Drawer open={drawer === "versions"} onClose={() => setDrawer(null)} title="Version history" sub="Governed versions and the evidence behind each change." testid="drawer-versions">
        {s.versions.map((v) => (
          <DSection key={v.version} label={`v${v.version} · ${v.state === "draft" ? "draft successor, awaiting IT" : new Date(v.releasedAt).toLocaleDateString()}`}>
            <div data-testid={`version-${v.version}`}>
              <div className="flex flex-wrap items-center gap-2">
                {v.state === "current" && <Tag tone="green">Current governed version</Tag>}
                {v.state === "draft" && <Tag tone="sienna">Draft</Tag>}
              </div>
              <p className={v.state === "released" ? "" : "mt-1"}>{v.summary}</p>
              {v.foldedCapabilities.length > 0 && (
                <ul className="mt-2 space-y-1 text-[13.5px]">
                  {v.foldedCapabilities.map((f) => <li key={f.capabilityId} data-testid={`provenance-${f.capabilityId}`}><span className="font-medium">{f.name}</span> — {f.provenance}</li>)}
                </ul>
              )}
              {v.caseId && (
                <div className="mt-2 flex flex-wrap gap-4">
                  <Link href={`/workbench/${v.caseId}?mode=compare`} data-testid={`link-evidence-${v.version}`} className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-primary underline-offset-2 hover:underline">See the evidence <ArrowRight className="h-3.5 w-3.5" /></Link>
                  {v.state !== "released" && <Link href={`/portfolio?case=${v.caseId}`} data-testid={`link-record-${v.version}`} className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-primary underline-offset-2 hover:underline">Consolidation record <ArrowRight className="h-3.5 w-3.5" /></Link>}
                </div>
              )}
            </div>
          </DSection>
        ))}
      </Drawer>
      <Drawer open={drawer === "details"} onClose={() => setDrawer(null)} title={s.name} sub={s.description} testid="drawer-details">
        <DSection label="Business units">{s.businessUnits.join(", ")}</DSection>
        <DSection label="Active users">{s.activeUsers}</DSection>
        <DSection label="Architecture and controls">{s.architectureStatus} · {s.controlStatus}</DSection>
        <DSection label="Support">{s.supportModel}</DSection>
        {s.dependencies.length > 0 && <DSection label="Dependencies">{s.dependencies.join(", ")}</DSection>}
        {s.knownGaps.length > 0 && <DSection label="Known gaps"><ul className="list-disc pl-5">{s.knownGaps.map((g) => <li key={g}>{g}</li>)}</ul></DSection>}
        <DSection label="Last reviewed">{new Date(s.lastReviewedAt).toLocaleDateString()}</DSection>
      </Drawer>
      <Drawer open={!!cap} onClose={() => setCap(null)} title={cap?.name ?? ""} sub={cap?.description} testid="drawer-capability">
        {cap && <>
          <DSection label="Comes from">{cap.sourceSolutionName} · owner {cap.ownerName} · v{cap.version}</DSection>
          <DSection label="Where it is also used">
            <ul className="space-y-1">{usedIn(cap).map((u) => <li key={u.id}><button className="text-primary underline-offset-2 hover:underline" onClick={() => { setCap(null); setLocation(`/solutions/${u.id}`); }}>{u.name}</button></li>)}</ul>
          </DSection>
          <DSection label="Evidence">{cap.evidence}</DSection>
          {cap.lockedReason && <DSection label="Why it is locked">{cap.lockedReason}</DSection>}
        </>}
      </Drawer>
    </Page>
  );
}
