import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Cable, Check, ExternalLink, Info, Minus, Play, RotateCcw, Save, Undo2, X } from "lucide-react";
import { useGetCurrentAuthUser } from "@workspace/api-client-react";
import { ErrorView, LoadingView, Page, StageEyebrow, Tag, btn, useUndoToast } from "@/components/bits";
import { CaseExportHistory } from "@/components/solution-exports";
import { cn } from "@/lib/utils";
import Workbench from "@/pages/workbench";
import {
  SOURCE_COPY, SOURCE_NAMES, ccKeys, edgesFor, inputFrom, msgOf, statusOf, useCombinedCase, useRecipes, useRunCombinedCase, useUpdateCombinedCase,
  type CombinedCase, type CombinedCaseInput, type Recipe, type RecipeEdge,
} from "@/lib/consolidation";

/** cc_ ids are combined proposals; everything else keeps the existing maintenance workbench. */
export function WorkbenchRoute() {
  const { caseId } = useParams<{ caseId: string }>();
  return caseId?.startsWith("cc_") ? <CombinedCasePage id={caseId} /> : <Workbench />;
}

const loginHref = () => `/api/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`;
const name = (id: string) => SOURCE_NAMES[id] ?? id;
const nodeName = (id: string) => (id === "invoice-ledger" ? "Shared invoice ledger" : SOURCE_NAMES[id] ?? id.replace(/-/g, " "));
const validAdj = (n: number) => Number.isInteger(n) && n % 6 === 0 && n >= -600 && n <= 6000;

function CombinedCasePage({ id }: { id: string }) {
  const auth = useGetCurrentAuthUser();
  const q = useCombinedCase(id);
  const recipesQ = useRecipes();
  if (auth.isLoading || q.isLoading || recipesQ.isLoading) return <LoadingView />;
  if (!auth.data?.user || statusOf(q.error) === 401) return (
    <Page><div className="card-soft max-w-xl p-7" data-testid="state-combined-signin"><StageEyebrow stage="connect" /><h1 className="mt-3 text-[26px]">Sign in to open this combination.</h1><p className="mt-2 text-[15px] text-muted-foreground">Combinations are saved to your account.</p><a href={loginHref()} className={cn(btn.primary, "mt-5")}>Sign in</a></div></Page>
  );
  if (statusOf(q.error) === 404) return (
    <Page><div className="card-soft max-w-xl p-7" data-testid="state-case-gone"><StageEyebrow stage="connect" /><h1 className="mt-3 text-[26px]">That combination is not here.</h1><p className="mt-2 text-[15px] text-muted-foreground">It may belong to another account. Start a new one from the library.</p><Link href="/library" className={cn(btn.primary, "mt-5")}>Library</Link></div></Page>
  );
  const recipe = recipesQ.data?.find((r) => r.id === q.data?.recipeId);
  if (q.isError || recipesQ.isError || !q.data || !recipe) return <ErrorView onRetry={() => { void q.refetch(); void recipesQ.refetch(); }} message="This combination could not load." />;
  return <Combined c={q.data} recipe={recipe} />;
}

function Combined({ c, recipe }: { c: CombinedCase; recipe: Recipe }) {
  const qc = useQueryClient();
  const say = useUndoToast();
  const upd = useUpdateCombinedCase();
  const run = useRunCombinedCase();
  const [history, setHistory] = useState<CombinedCaseInput[]>([]);
  const [edge, setEdge] = useState<RecipeEdge | null>(null);
  const [runUrl, setRunUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const finance = recipe.id === "finance";
  const enabled = recipe.capabilities.filter((x) => c.capabilityIds.includes(x.id));
  const excluded = recipe.capabilities.filter((x) => !c.capabilityIds.includes(x.id));
  const edges = recipe.edges.filter((e) => c.wiring.edgeIds.includes(e.id));

  const save = (patch: Partial<CombinedCaseInput>, label: string, undoable = true) => {
    const before = inputFrom(c);
    setErr(null);
    upd.mutate({ id: c.id, data: { ...inputFrom(c, patch), expectedRevision: c.revision } }, {
      onSuccess: () => { setRunUrl(null); if (undoable) setHistory((h) => [...h, before]); say(label); },
      onError: (e) => {
        if (statusOf(e) === 409) { void qc.invalidateQueries({ queryKey: ccKeys.case(c.id) }); setErr("This combination changed elsewhere. The latest version is loaded; try again."); }
        else setErr(msgOf(e));
      },
    });
  };
  const undo = () => { const prev = history[history.length - 1]; if (!prev) return; setHistory((h) => h.slice(0, -1)); save(prev, "Undone", false); };
  const removeCap = (capId: string) => {
    const caps = c.capabilityIds.filter((x) => x !== capId);
    save({ capabilityIds: caps, wiring: { edgeIds: edgesFor(recipe, caps) } }, `${recipe.capabilities.find((x) => x.id === capId)?.name} removed`);
  };
  const addCap = (capId: string) => {
    const caps = [...c.capabilityIds, capId];
    save({ capabilityIds: caps, wiring: { edgeIds: edgesFor(recipe, caps) } }, `${recipe.capabilities.find((x) => x.id === capId)?.name} added back`);
  };
  const tryIt = () => run.mutate({ id: c.id }, {
    onSuccess: (r) => { setRunUrl(r.runUrl); say("Checked and ready. Open the combined app."); },
    onError: (e) => setErr(msgOf(e)),
  });

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-5 md:px-6" data-testid="view-combined">
      <StageEyebrow stage="connect" className="mb-2" />
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        <Link href="/library" className="hover:text-primary hover:underline">Library</Link><span>/</span><span>{recipe.name}</span>
        <Tag tone="sky" testid="text-revision">Saved · rev {c.revision}</Tag>
        <Tag tone="muted" testid="label-demo-data">Demo data</Tag>
      </div>
      <h1 className="mt-0.5 break-words text-[24px] md:text-[30px]" data-testid="text-headline">{c.title}</h1>
      <blockquote className="mt-2 max-w-3xl border-l-4 border-sienna pl-3 text-[15px] text-muted-foreground" data-testid="text-need">{c.need}</blockquote>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <section className="rounded-[20px] bg-[hsl(var(--primary))] p-5 text-primary-foreground md:p-6" data-testid="panel-map" aria-label="Proposed map">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-semibold">Included capabilities</h2>
            <span className="text-[12.5px] opacity-75">Starts from {name(c.baseSolutionId)}. Click a connection for its adapter.</span>
            <button onClick={undo} disabled={!history.length || upd.isPending} className="ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium hover:bg-white/10 disabled:opacity-40" data-testid="button-undo"><Undo2 className="h-4 w-4" /> Undo</button>
          </div>
          <ol className="space-y-3">
            {finance && <Node title="Your forecast settings" sub="Method, period, centres and the adjustment below" />}
            {!finance && <Node title="Shared invoice ledger" sub="One set of synthetic invoices every part reads" />}
            {enabled.map((cap) => {
              const e = recipe.edges.find((x) => x.id === cap.edgeId);
              return (
                <li key={cap.id}>
                  {e && <button onClick={() => setEdge(e)} className="mx-auto my-1 flex items-center gap-2 rounded-full border border-white/25 px-3 py-1 text-[12px] hover:bg-white/10" data-testid={`button-edge-${cap.id}`}><Cable className="h-3.5 w-3.5" /> adapter: {nodeName(e.from)} to {nodeName(e.to)}</button>}
                  <div className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3" data-testid={`node-cap-${cap.id}`}>
                    <Check className="h-4 w-4 shrink-0 text-[#9ED9E3]" />
                    <div className="min-w-0 flex-1"><div className="font-semibold">{cap.name}</div><div className="text-[12.5px] opacity-75">from {name(cap.sourceId)} · {SOURCE_COPY[cap.sourceId]?.label}</div></div>
                    {finance ? <span className="text-[11.5px] opacity-70" title="Forecast to Report needs both engines and their adapter.">required</span>
                      : <button onClick={() => removeCap(cap.id)} disabled={upd.isPending || enabled.length <= 1} title={enabled.length <= 1 ? "Keep at least one capability" : "Remove from the combination"} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] hover:bg-white/10 disabled:opacity-40" data-testid={`button-remove-${cap.id}`}><Minus className="h-3.5 w-3.5" /> Remove</button>}
                  </div>
                </li>
              );
            })}
            <Node title={finance ? "Monthly management report" : "One combined invoice app"} sub={`Opens at ${recipe.runPath}`} />
          </ol>
          {edge && (
            <div className="mt-4 rounded-xl bg-white p-4 text-foreground" role="dialog" aria-label="Adapter detail" data-testid="panel-adapter">
              <div className="flex items-start gap-2"><Cable className="mt-0.5 h-4 w-4 text-primary" /><div className="min-w-0 flex-1"><div className="font-semibold">{nodeName(edge.from)} to {nodeName(edge.to)}</div><p className="mt-1 text-[13.5px]">{edge.contract}</p><p className="mt-1 font-mono text-[11.5px] text-muted-foreground">{edge.id}</p></div>
                <button onClick={() => setEdge(null)} className={btn.quiet} aria-label="Close adapter detail"><X className="h-4 w-4" /></button></div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          {excluded.length > 0 && <section className="card-soft p-5" data-testid="panel-excluded">
            <h2 className="text-[16px] font-semibold">Not selected</h2>
              <ul className="mt-2 space-y-2">{excluded.map((m) => {
                const has = c.selectedSources.some((s) => s.id === m.sourceId);
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 text-[13.5px]" data-testid={`missing-${m.id}`}>
                    <span className="min-w-0 flex-1"><span className="font-medium">{m.name}</span> <span className="text-muted-foreground">· {has ? "switched off" : `${name(m.sourceId)} not selected`}</span></span>
                    {has && <button className={btn.quiet} onClick={() => addCap(m.id)} disabled={upd.isPending} data-testid={`button-add-${m.id}`}>Add back</button>}
                  </li>
                );
              })}</ul>
          </section>}
          <section className="card-soft p-5" data-testid="panel-requirement-gaps">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-semibold">Still needed</h2>
              <Tag tone="muted">Not assessed yet</Tag>
            </div>
            <p className="mt-2 text-[13.5px] text-muted-foreground">Your requirements haven’t been checked against this combination yet.</p>
          </section>
          {finance && <FinanceAdjust c={c} busy={upd.isPending} onSave={(config) => save({ config }, "Adjustment saved")} />}
          <section className="card-soft p-5">
            <h2 className="text-[16px] font-semibold">Try the real combination</h2>
            <p className="mt-1 text-[13.5px] text-muted-foreground">Checks the saved version, then opens the actual app with it.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={tryIt} disabled={run.isPending || upd.isPending} className={cn(btn.accent, "min-h-12 px-6")} data-testid="button-run-combined"><Play className="h-4 w-4" /> {run.isPending ? "Checking…" : "Try it"}</button>
              {runUrl && <a href={runUrl} target="_blank" rel="noopener noreferrer" className={cn(btn.primary, "min-h-12")} data-testid="link-open-combined-app">Open combined app <ExternalLink className="h-4 w-4" /></a>}
            </div>
          </section>
          {err && <p role="alert" className="rounded-lg bg-accent px-3 py-2 text-[13px] text-siennaink" data-testid="text-combined-error">{err}</p>}
        </aside>
      </div>

      <div className="mt-6">
        <CaseExportHistory caseId={c.id} updatedAt={c.updatedAt} pending={upd.isPending} onConflict={() => void qc.invalidateQueries({ queryKey: ccKeys.case(c.id) })} />
      </div>

      <details className="mt-6 text-[13px]" data-testid="details-technical">
        <summary className="cursor-pointer text-muted-foreground"><Info className="mr-1 inline h-3.5 w-3.5" /> Technical details</summary>
        <dl className="mt-3 grid gap-2 font-mono text-[12px] text-muted-foreground">
          <div className="break-all">fingerprint <span className="text-foreground">{c.fingerprint}</span></div>
          {c.selectedSources.map((s) => <div key={s.id} className="break-all">{s.id} <span className="text-foreground">{s.sha256}</span></div>)}
          <div>wiring <span className="text-foreground">{c.wiring.edgeIds.join(", ") || "none"}</span> · edges {edges.length}</div>
        </dl>
      </details>
    </div>
  );
}

function Node({ title, sub }: { title: string; sub: string }) {
  return <li className="rounded-xl border border-dashed border-white/30 px-4 py-3"><div className="font-semibold">{title}</div><div className="text-[12.5px] opacity-75">{sub}</div></li>;
}

function FinanceAdjust({ c, busy, onSave }: { c: CombinedCase; busy: boolean; onSave: (config: Record<string, unknown>) => void }) {
  const saved = Number(c.config.adjustment ?? 0);
  const [draft, setDraft] = useState<string>(String(saved));
  const forRev = useRef(c.revision);
  useEffect(() => { if (forRev.current !== c.revision) { forRev.current = c.revision; setDraft(String(saved)); } }, [c.revision, saved]);
  const n = draft === "" ? Number.NaN : Number(draft);
  const ok = validAdj(n);
  const dirty = n !== saved;
  return (
    <section className="card-soft p-5" data-testid="panel-finance-adjust">
      <h2 className="text-[16px] font-semibold">Q4 adjustment</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">Total in whole USD, a multiple of 6 from -600 to 6000. Spread across chosen centres and the three Q4 months.</p>
      <div className="mt-3 flex items-center gap-2">
        <input type="number" step={6} min={-600} max={6000} value={draft} onChange={(e) => setDraft(e.target.value)} aria-invalid={!ok} aria-label="Q4 adjustment in USD"
          className="h-10 w-full rounded-xl border border-input bg-card px-3 text-center font-mono text-[15px] outline-none focus:border-primary" data-testid="input-adjustment" />
        <button className={btn.primary} disabled={!ok || !dirty || busy} onClick={() => onSave({ ...c.config, adjustment: n })} data-testid="button-save-adjustment"><Save className="h-4 w-4" /> Save</button>
        <button className={btn.quiet} disabled={!dirty || busy} onClick={() => setDraft(String(saved))} data-testid="button-revert-adjustment"><RotateCcw className="h-4 w-4" /> Revert</button>
      </div>
      {!ok && <p className="mt-1 text-[12.5px] text-siennaink" role="alert">Use a whole-dollar multiple of 6 between -600 and 6000.</p>}
      <p className="mt-2 text-[12px] text-muted-foreground">Saved: {saved >= 0 ? "+" : ""}{saved} USD. <Link href="/workbench/wiring" className="text-primary hover:underline">All finance settings <ArrowRight className="inline h-3 w-3" /></Link></p>
    </section>
  );
}

