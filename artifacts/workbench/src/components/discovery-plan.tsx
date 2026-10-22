import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight } from "lucide-react";
import { Skel, btn } from "@/components/bits";
import { RequirementLedger } from "@/components/requirement-ledger";
import { compMsg, compStatus, evidenceOf, loginHref, type Composition } from "@/lib/composition";
import {
  capKey, compositionHref, loadDiscoveryDraft, materializeKeyFor, saveDiscoveryDraft, useDiscoveryComposition, useMaterialize,
  previewCoverage,
} from "@/lib/discovery";

/** One direct intake-to-workbench action; selection and refinement belong in Workbench. */
export function DiscoveryPlan({ briefId, confirmed }: { briefId: string; confirmed: boolean }) {
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState(() => loadDiscoveryDraft(briefId));
  useEffect(() => saveDiscoveryDraft(briefId, draft), [briefId, draft]);
  const create = useDiscoveryComposition();
  const mat = useMaterialize();
  const [plan, setPlan] = useState<Composition | null>(null);
  const createRef = useRef(create.mutate);
  createRef.current = create.mutate;
  const keyRef = useRef(draft.createKey);
  const run = () => createRef.current({ briefId, idempotencyKey: keyRef.current }, { onSuccess: (c) => { setPlan(c); setDraft((d) => ({ ...d, compositionId: c.id })); } });
  const refreshReview = () => {
    const key = crypto.randomUUID();
    keyRef.current = key;
    setDraft((d) => ({ ...d, createKey: key, compositionId: undefined }));
    setPlan(null);
    mat.reset();
    run();
  };
  useEffect(() => { if (confirmed) run(); }, [briefId, confirmed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!confirmed) return <p className="mt-10 text-[14px] text-muted-foreground">Confirm the intake to get a grounded plan.</p>;
  if (create.isPending && !plan) return <section className="mt-10" role="status"><p className="mb-3 text-[14px] text-muted-foreground">Finding a proposed workflow for your intake…</p><Skel className="h-44" /></section>;
  if (create.isError && !plan) return <section className="card-soft mt-10 p-5" role="alert"><h2 className="font-semibold">Proposed workflow unavailable</h2><p className="mt-2 text-[14px]">{compMsg(create.error)}</p>
    {compStatus(create.error) === 401 ? <a href={loginHref()} className={`${btn.secondary} mt-3`}>Sign in</a> : <button className={`${btn.secondary} mt-3`} onClick={run}>Retry</button>}</section>;
  if (!plan) return null;

  const p = plan.plan;
  const excluded = new Set(draft.excluded.map(capKey));
  const materialize = () => {
    if (plan.discoveryState === "materialized") { navigate(compositionHref(plan)); return; }
    const sig = `${plan.revision}|${[...excluded].sort().join(",")}`;
    const d = materializeKeyFor(draft, sig);
    setDraft(d);
    mat.mutate({ id: plan.id, expectedRevision: plan.revision, idempotencyKey: d.materializeKey, excludedCapabilities: d.excluded }, {
      onSuccess: (c) => navigate(compositionHref(c)),
      onError: (e) => { if (compStatus(e) === 409) run(); },
    });
  };
  const base = evidenceOf(plan).find((s) => s.solutionId === (plan.discoverySnapshot?.startingPoint.solutionId ?? p.baseSolutionId));
  return (
    <section className="card-soft mt-10 border-l-4 border-l-primary p-6" data-testid="discovery-plan">
        <div className="eyebrow mb-2">Proposed workflow</div>
        <h2 className="text-[24px] font-semibold" data-testid="text-discovery-base">{base ? `Start from ${base.name}` : "No catalog solution fits as a base"}</h2>
        <p className="mt-2 text-[14px] text-muted-foreground">{plan.discoverySnapshot?.startingPoint.reason || p.rationale}</p>
        <p className="mt-3 text-[14px]">Your intake requirements, constraints and remaining gaps go with you. Adjust the workflow in Workbench.</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button className={btn.primary} onClick={materialize} disabled={mat.isPending} data-testid="button-open-proposed-workflow">{mat.isPending ? "Opening…" : plan.discoveryState === "materialized" ? "Reopen proposed workflow" : "Open proposed workflow"} <ArrowRight className="h-4 w-4" /></button>
          {mat.isError && <span role="alert" className="text-[13px] text-bad" data-testid="error-create-experiment">{compMsg(mat.error)} {compStatus(mat.error) === 401 ? <a href={loginHref()} className="underline">Sign in</a> : compStatus(mat.error) === 409 ? <button className="underline" onClick={refreshReview}>Start a new review from current sources</button> : <button className="underline" onClick={materialize}>Retry</button>} Your selections are kept.</span>}
        </div>
        <details className="mt-4 text-[13px]">
          <summary className="cursor-pointer font-medium text-primary">Intake context and source details</summary>
          <p className="mt-2">{p.rationale}</p>
          <ul className="mt-2 list-disc pl-5">{evidenceOf(plan).map(s => <li key={s.solutionId}>{s.name} · v{s.version}</li>)}</ul>
          {(p.dependencies.length > 0 || p.integrationGaps.length > 0) && <ul className="mt-2 list-disc pl-5">{[...p.dependencies, ...p.integrationGaps].map((text, i) => <li key={i}>{text}</li>)}</ul>}
          {draft.excluded.length > 0 && <p className="mt-2">Your previously excluded contributions remain excluded.</p>}
          <div className="mt-3"><RequirementLedger c={plan} rows={previewCoverage(plan.requirementCoverage ?? [], draft.excluded, plan)} /></div>
        </details>
    </section>
  );
}
