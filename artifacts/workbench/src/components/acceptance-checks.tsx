import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAcceptanceChecks, getGetAcceptanceChecksQueryKey, useRunAcceptanceCheck,
  type AcceptanceChecks as Plan, type AcceptanceRun,
} from "@workspace/api-client-react";
import { btn, Tag } from "./bits";

function RunEvidence({ run, currentPlan }: { run: AcceptanceRun; currentPlan: string }) {
  return <details className="mt-4 rounded border border-border p-4" data-testid="acceptance-run" open>
    <summary className="cursor-pointer font-semibold">
      {new Date(run.createdAt).toLocaleString()} · {run.inputMode === "fixture" ? "Fixture input" : "Supplied input"} · {run.results.filter(r => r.status === "passed").length} passed / {run.results.filter(r => r.status === "failed").length} failed / {run.results.filter(r => r.status === "not_testable").length} not testable
    </summary>
    <p className="mt-2 text-sm text-muted-foreground">Saved result for the input and configuration below. {run.planFingerprint !== currentPlan && "The assessment has changed since this run."}</p>
    <ol className="mt-3 space-y-3">{run.results.map(result => <li key={result.criterion.id}>
      <Tag tone={result.status === "passed" ? "green" : result.status === "failed" ? "sienna" : "slate"}>{result.status.replace("_", " ")}</Tag>
      <p className="font-semibold">{result.criterion.requirement}</p>
      <p className="text-sm">{result.criterion.assertion}</p>
      <p className="text-sm text-muted-foreground">{result.detail}</p>
    </li>)}</ol>
    {run.errors.length > 0 && <p role="alert" className="mt-3 text-bad">{run.errors.join("; ")}</p>}
    <details className="mt-4"><summary className="cursor-pointer font-semibold">Actual outputs &amp; step trace</summary>
      <p className="mt-2">{run.output.headline}</p>
      {run.output.sections.map(section => <section key={section.key} className="mt-3"><h4 className="font-semibold">{section.title}</h4><ul className="list-disc pl-5 text-sm">{section.items.map(item => <li key={item.id}>{item.text}{item.detail && <p>{item.detail}</p>}<p className="text-muted-foreground">Source references: {item.refs.join(", ") || "none"}</p></li>)}</ul></section>)}
      <ul className="mt-3 text-sm">{run.trace.map(step => <li key={step.stepId}>{step.name}: {step.status} · {step.outputSummary}{step.error && ` · ${step.error}`}</li>)}</ul>
    </details>
    <details className="mt-4"><summary className="cursor-pointer font-semibold">Exact input, configuration &amp; fingerprints</summary>
      <dl className="mt-2 space-y-2 break-all text-xs">
        <dt>Package</dt><dd>{run.packageId} · SHA-256 {run.packageFingerprint}</dd>
        <dt>Engine SHA-256</dt><dd>{run.engineFingerprint}</dd>
        <dt>Configuration SHA-256</dt><dd>{run.configurationFingerprint}</dd>
        <dt>Input SHA-256</dt><dd>{run.inputFingerprint}</dd>
        <dt>Assessment SHA-256</dt><dd>{run.planFingerprint}</dd>
        <dt>Enabled elements</dt><dd>{run.capabilityIds.join(", ")}</dd>
        <dt>Selected borrowed elements</dt><dd>{run.borrowedIds.join(", ") || "None"}</dd>
        <dt>Settings</dt><dd><pre className="whitespace-pre-wrap">{JSON.stringify(run.configValues, null, 2)}</pre></dd>
      </dl>
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{run.inputText}</pre>
    </details>
  </details>;
}

function ReviewForm({ plan, briefId }: { plan: Plan; briefId: string }) {
  const [borrowedIds, setBorrowed] = useState<string[]>([]);
  const [reviewedCriterionIds, setReviewed] = useState<string[]>([]);
  const [inputMode, setMode] = useState<"fixture" | "supplied">("fixture");
  const [inputText, setInput] = useState("");
  const client = useQueryClient();
  const mutation = useRunAcceptanceCheck();
  const toggle = (list: string[], id: string) => list.includes(id) ? list.filter(x => x !== id) : [...list, id];
  return <div className="mt-4 space-y-4">
    <div><h4 className="font-semibold">1. Review the proposed checks</h4>
      <p className="text-sm text-muted-foreground">If a check needs changing, revise the requirement in intake first.</p>
      <div className="mt-3 space-y-3">{plan.criteria.map(c => <label key={c.id} className="flex items-start gap-3 rounded border border-border p-3">
        <input type="checkbox" className="mt-1" checked={reviewedCriterionIds.includes(c.id)} onChange={() => setReviewed(toggle(reviewedCriterionIds, c.id))} />
        <span><span className="block font-semibold">{c.requirement}</span><span className="block text-sm">{c.assertion}</span>{!c.testable && <span className="block text-sm text-muted-foreground">{c.reason.replace("This restriction requires separate control verification; output presence cannot prove a prohibition.", "Verify this restriction separately.")}</span>}<span className="text-xs">{c.testable ? "I have reviewed this check." : "Not testable · reviewed."}</span></span>
      </label>)}</div>
    </div>
    <div><h4 className="font-semibold">2. Select proposed borrowed elements</h4>
      <p className="text-sm text-muted-foreground">Dependencies and conflicts are checked when you run.</p>
      <details className="mt-2 text-sm"><summary>Base elements</summary><p>{plan.baseCapabilityIds.join(", ") || "No suitable base"}</p></details>
      {plan.borrowedOptions.length ? plan.borrowedOptions.map(option => <label key={option.capabilityId} className="mt-3 flex items-start gap-3">
        <input type="checkbox" className="mt-1" checked={borrowedIds.includes(option.capabilityId)} onChange={() => setBorrowed(toggle(borrowedIds, option.capabilityId))} />
        <span><span className="font-semibold">{option.capabilityName}</span> · {option.solutionName}<span className="block text-sm text-muted-foreground">{option.integration.replace("; demo behavior only, not a production integration.", ".")}</span></span>
      </label>) : <p className="mt-2 text-sm">No borrowed elements proposed.</p>}
    </div>
    <div><h4 className="font-semibold">3. Choose input and execute</h4>
      <label className="mt-2 block text-sm">Input source <select className="ml-2 rounded border bg-background p-2" value={inputMode} onChange={e => setMode(e.target.value as "fixture" | "supplied")}><option value="fixture">Sample maintenance notes</option><option value="supplied">My supplied work-order text</option></select></label>
      <p className="mt-2 text-sm text-muted-foreground">{inputMode === "fixture" ? "Synthetic notes with repeated equipment issues and a gas-leak signal." : "Use one record per line: ID | YYYY-MM-DD | Site | Equipment tag (type) | Note."}</p>
      <textarea aria-label={inputMode === "fixture" ? "Fixture input preview" : "Supplied work-order input"} className="mt-2 min-h-40 w-full rounded border border-border bg-background p-3 font-mono text-xs" value={inputMode === "fixture" ? plan.fixtureText : inputText} readOnly={inputMode === "fixture"} maxLength={50000} onChange={e => setInput(e.target.value)} />
      <button className={`${btn.primary} mt-3`} disabled={!plan.baseSolutionId || !plan.criteria.length || reviewedCriterionIds.length !== plan.criteria.length || (inputMode === "supplied" && !inputText.trim()) || mutation.isPending} onClick={() => mutation.mutate({ briefId, data: { planFingerprint: plan.planFingerprint, borrowedIds, reviewedCriterionIds, inputMode, inputText: inputMode === "supplied" ? inputText : "" } }, { onSuccess: run => {
        client.setQueryData<Plan>(getGetAcceptanceChecksQueryKey(briefId), old => old ? { ...old, runs: [run, ...old.runs.filter(r => r.id !== run.id)] } : old);
        client.invalidateQueries({ queryKey: getGetAcceptanceChecksQueryKey(briefId) });
      } })}>{mutation.isPending ? "Executing and saving…" : "Execute acceptance check"}</button>
      {mutation.isError && <p role="alert" className="mt-3 text-bad">{(mutation.error as { data?: { error?: string } }).data?.error ?? mutation.error.message}</p>}
      {mutation.isSuccess && <p role="status" className="mt-3 text-sm">Execution saved. Review the recorded result below.</p>}
    </div>
  </div>;
}

export function AcceptanceChecks({ briefId }: { briefId: string }) {
  const query = useGetAcceptanceChecks(briefId, { query: { queryKey: getGetAcceptanceChecksQueryKey(briefId), staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true } });
  return <section className="card-soft p-5" data-testid="acceptance-checks">
    <h3 className="text-[18px] font-semibold">Acceptance check · combined demo configuration</h3>
    <p className="mt-2 text-sm text-muted-foreground">Runs the built-in engine, not uploaded code. Inputs and results are saved in this shared demo. Do not enter confidential or personal data.</p>
    {query.isLoading ? <p role="status">Loading criteria and saved runs…</p> : query.isError || !query.data ? <p role="alert">Acceptance checks could not load. <button className="underline" onClick={() => query.refetch()}>Retry</button></p> : <>
      <ReviewForm key={query.data.planFingerprint} plan={query.data} briefId={briefId} />
      <h4 className="mt-6 font-semibold">Saved execution history</h4>
      {query.data.runs.length ? query.data.runs.map(run => <RunEvidence key={run.id} run={run} currentPlan={query.data.planFingerprint} />) : <p className="mt-2 text-sm text-muted-foreground">No acceptance checks executed yet.</p>}
    </>}
  </section>;
}
