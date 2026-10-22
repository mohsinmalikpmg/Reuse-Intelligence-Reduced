import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowRight, Check, Download, ExternalLink, Layers, Lock, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { useGetCurrentAuthUser } from "@workspace/api-client-react";
import { Skel, Tag, btn, useUndoToast } from "@/components/bits";
import { cn } from "@/lib/utils";
import { usePackagesQuery } from "@/components/solution-packages";
import { useRole } from "@/lib/persona";
import {
  SOURCE_COPY, SOURCE_NAMES, edgesFor, msgOf, useCombinedCases, useCreateCombinedCase, useRecipes, useRegisterSources, useRegisteredSources,
  type CombinedCase, type Recipe, type RecipeId,
} from "@/lib/consolidation";

const loginHref = () => `/api/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`;
const NEED_HINT: Record<RecipeId, string> = {
  invoice: "e.g. Find the right invoices even with typos, approve several at once, and see which project the spend belongs to.",
  finance: "e.g. Take the Q4 forecast and turn it into the monthly management report, with my adjustment applied.",
};

type Draft = { sources: string[]; base: string; caps: string[]; need: string; title: string };

/** Persona controls visibility; the server-provided entitlement controls actions. */
export function ConsolidationSourceSetup() {
  const role = useRole();
  return role === "it" ? <SourceSetup /> : null;
}

function SourceSetup() {
  const permissions = usePackagesQuery();
  const recipes = useRecipes();
  const sources = useRegisteredSources(permissions.isSuccess);
  const register = useRegisterSources();
  const [error, setError] = useState<string | null>(null);
  const missing = [...new Set((recipes.data ?? []).flatMap(r => r.sourceIds))]
    .filter(id => !sources.data?.some(source => source.id === id));
  const ready = recipes.isSuccess && sources.isSuccess;
  return (
    <section className="mb-5 rounded-xl border border-border bg-card p-5" data-testid="it-source-setup">
      <h2 className="font-display text-xl text-primary">Source library setup</h2>
      <p className="mt-1 text-sm text-muted-foreground">Register the supplied demo packages once so solution seekers can use them in Workbench.</p>
      {permissions.isLoading ? <Skel className="mt-3 h-9" /> : permissions.isError ? (
        <p role="alert" className="mt-3 text-sm">Sign in with an authorized IT account to manage sources. <button className={btn.quiet} onClick={() => void permissions.refetch()}>Retry</button> <a className={btn.quiet} href={loginHref()}>Sign in</a></p>
      ) : !permissions.data?.canManage ? (
        <p className="mt-3 text-sm" data-testid="source-setup-no-permission">Your signed-in account does not have source-management permission. An authorized IT administrator must complete setup; changing personas does not grant access.</p>
      ) : !ready ? (
        <p className="mt-3 text-sm">{recipes.isError || sources.isError ? "Source setup could not load." : "Checking source setup…"} <button className={btn.quiet} onClick={() => { void recipes.refetch(); void sources.refetch(); }}>Refresh</button></p>
      ) : missing.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="flex-1 text-sm">Ready to register: {missing.map(id => SOURCE_NAMES[id] ?? id).join(", ")}</span>
          <button className={btn.secondary} disabled={register.isPending} data-testid="button-register-sources" onClick={() => {
            setError(null);
            register.mutate(undefined, { onError: e => setError(msgOf(e)) });
          }}><ShieldCheck className="h-4 w-4" />{register.isPending ? "Registering…" : "Register demo sources"}</button>
        </div>
      ) : <p className="mt-3 text-sm text-primary" role="status">All demo sources are available in Workbench.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-siennaink">{error}</p>}
    </section>
  );
}

/** Choose existing sources, say what you need, and open a persisted combined proposal. Originals open as separate apps. */
export function InvoiceDemoLauncher() {
  const search = new URLSearchParams(useSearch());
  const recipesQ = useRecipes();
  const auth = useGetCurrentAuthUser();
  const signedIn = !!auth.data?.user;
  const sourcesQ = useRegisteredSources(signedIn);
  const casesQ = useCombinedCases(signedIn);
  const requestedRecipe = search.get("combine") ?? search.get("recipe");
  const [recipeId, setRecipeId] = useState<RecipeId>(requestedRecipe === "finance" ? "finance" : "invoice");
  useEffect(() => {
    if (requestedRecipe === "finance" || requestedRecipe === "invoice") {
      setRecipeId(requestedRecipe);
      requestAnimationFrame(() => document.getElementById("combine")?.scrollIntoView());
    }
  }, [requestedRecipe]);
  const [drafts, setDrafts] = useState<Partial<Record<RecipeId, Draft>>>({});
  const recipe = recipesQ.data?.find((r) => r.id === recipeId);
  const presetNeed = search.get("need") ?? "";

  useEffect(() => {
    if (!recipe || drafts[recipe.id]) return;
    setDrafts((d) => ({ ...d, [recipe.id]: {
      sources: [...recipe.sourceIds], base: recipe.baseSolutionIds[0], caps: recipe.capabilities.map((c) => c.id),
      need: (search.get("combine") ?? search.get("recipe")) === recipe.id ? presetNeed : "", title: "",
    } }));
  }, [recipe, drafts, presetNeed, search]);

  return (
    <section id="combine" aria-labelledby="combine-title" data-testid="section-invoice-demo" className="rounded-2xl border border-border bg-secondary/40 p-5 md:p-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">Combine what already exists</p>
          <h2 id="combine-title" className="font-display text-2xl text-primary">Pick sources, say what you need, try the combination</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">Originals keep running on their own. A combination is saved as its own proposal you can reopen, run and export.</p>
        </div>
        <div role="tablist" aria-label="Combination" className="inline-flex rounded-xl border border-border bg-card p-1">
          {(recipesQ.data ?? []).map((r) => (
            <button key={r.id} role="tab" aria-selected={r.id === recipeId} onClick={() => setRecipeId(r.id)} data-testid={`tab-recipe-${r.id}`}
              className={cn("min-h-9 rounded-lg px-4 text-[13.5px] font-semibold transition-colors", r.id === recipeId ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary")}>
              {r.name}
            </button>
          ))}
        </div>
      </div>

      {recipesQ.isLoading ? <div className="mt-5 grid gap-3 md:grid-cols-3"><Skel className="h-44" /><Skel className="h-44" /><Skel className="h-44" /></div>
        : recipesQ.isError ? <div role="alert" className="mt-5 flex items-center gap-3 rounded-xl bg-accent px-4 py-3 text-sm text-siennaink">Combinations could not load. <button className={btn.quiet} onClick={() => void recipesQ.refetch()}><RefreshCw className="h-4 w-4" /> Retry</button></div>
        : recipe && drafts[recipe.id] ? (
          <Composer key={recipe.id} recipe={recipe} draft={drafts[recipe.id]!} setDraft={(p) => setDrafts((d) => ({ ...d, [recipe.id]: { ...d[recipe.id]!, ...p } }))}
            signedIn={signedIn} authLoading={auth.isLoading} sourcesQ={sourcesQ} />
        ) : null}

      {signedIn && <CombinedList q={casesQ} />}
    </section>
  );
}

function Composer({ recipe, draft, setDraft, signedIn, authLoading, sourcesQ }: {
  recipe: Recipe; draft: Draft; setDraft: (p: Partial<Draft>) => void; signedIn: boolean; authLoading: boolean; sourcesQ: ReturnType<typeof useRegisteredSources>;
}) {
  const [, navigate] = useLocation();
  const briefId = new URLSearchParams(useSearch()).get("briefId") || undefined;
  const say = useUndoToast();
  const create = useCreateCombinedCase();
  const [err, setErr] = useState<string | null>(null);
  const registered = sourcesQ.data ?? [];
  const isReg = (id: string) => registered.some((r) => r.id === id);
  const minSources = recipe.id === "invoice" ? 2 : recipe.sourceIds.length;
  const fixedAll = recipe.id === "finance";

  const toggleSource = (id: string) => {
    if (fixedAll) return;
    const on = draft.sources.includes(id);
    const sources = on ? draft.sources.filter((s) => s !== id) : [...draft.sources, id];
    // Capability choices are remembered: re-selecting a source brings its capabilities back.
    const base = sources.includes(draft.base) ? draft.base : (recipe.baseSolutionIds.find((b) => sources.includes(b)) ?? draft.base);
    setDraft({ sources, base });
  };
  const toggleCap = (id: string) => { if (fixedAll) return; setDraft({ caps: draft.caps.includes(id) ? draft.caps.filter((c) => c !== id) : [...draft.caps, id] }); };
  const activeCaps = recipe.capabilities.filter((c) => draft.caps.includes(c.id) && draft.sources.includes(c.sourceId)).map((c) => c.id);
  const unregistered = draft.sources.filter((s) => !isReg(s));

  const problems: string[] = [];
  if (draft.sources.length < minSources) problems.push(recipe.id === "invoice" ? "Choose at least two sources." : "Both finance sources are required.");
  if (!draft.sources.includes(draft.base)) problems.push("The starting app must be one of the chosen sources.");
  if (!activeCaps.length) problems.push("Keep at least one capability switched on.");
  if (!draft.need.trim()) problems.push("Describe what you need in a sentence.");
  if (signedIn && !sourcesQ.isSuccess) problems.push(sourcesQ.isError ? "The source library could not load. Retry below." : "Checking available sources…");
  if (signedIn && sourcesQ.isSuccess && unregistered.length) problems.push("Some selected sources are awaiting IT setup.");

  const submit = () => {
    setErr(null);
    if (problems.length) return;
    const names = draft.sources.map((s) => SOURCE_NAMES[s] ?? s);
    create.mutate({ data: {
      briefId,
      recipeId: recipe.id, title: draft.title.trim() || `${recipe.name}: ${names.join(" + ")}`, need: draft.need.trim(), baseSolutionId: draft.base,
      selectedSourceIds: draft.sources, capabilityIds: activeCaps, config: recipe.defaultConfig ?? (recipe.id === "invoice" ? { schemaVersion: 1 } : {}), wiring: { edgeIds: edgesFor(recipe, activeCaps) },
    } }, {
      onSuccess: (c) => { say("Proposal saved. Here is the map."); navigate(`/workbench/${c.id}`); },
      onError: (e) => setErr(msgOf(e)),
    });
  };

  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-[1.35fr_1fr]">
      <div>
        <div className="mb-2 flex items-center justify-between text-[13px]">
          <span className="font-semibold">1 · Choose original sources <span className="font-normal text-muted-foreground">({fixedAll ? "both required" : `${draft.sources.length} of ${recipe.sourceIds.length}, at least 2`})</span></span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {recipe.sourceIds.map((id) => {
            const on = draft.sources.includes(id);
            const copy = SOURCE_COPY[id];
            const reg = registered.find((r) => r.id === id);
            return (
              <article key={id} data-testid={`card-demo-${id}`} className={cn("flex min-w-0 flex-col rounded-xl border bg-card p-4 transition-shadow", on ? "border-primary shadow-[inset_0_0_0_1px_hsl(var(--primary))]" : "border-border opacity-80")}>
                <button type="button" onClick={() => toggleSource(id)} disabled={fixedAll} aria-pressed={on} data-testid={`toggle-source-${id}`} className="flex items-start gap-3 text-left disabled:cursor-default">
                  <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>{on && <Check className="h-3.5 w-3.5" />}</span>
                  <span className="min-w-0">
                    <span className="block font-display text-lg leading-tight text-primary">{SOURCE_NAMES[id] ?? id}</span>
                    <span className="mt-1 block text-[13px] font-semibold">{copy?.label}</span>
                  </span>
                </button>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{copy?.blurb}</p>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                  {signedIn && sourcesQ.isSuccess && (reg ? <Tag tone="green" testid={`status-reg-${id}`}>Registered</Tag> : <Tag tone="sienna" testid={`status-reg-${id}`}>Not registered</Tag>)}
                  {copy?.href && <a href={copy.href} target="_blank" rel="noopener noreferrer" className={cn(btn.quiet, "ml-auto")} data-testid={`link-open-${id}`} aria-label={`Open original ${SOURCE_NAMES[id]} in a new tab`}>Open original <ExternalLink className="h-3.5 w-3.5" /></a>}
                  {reg && <a href={reg.downloadUrl} className={cn(btn.quiet, !copy?.href && "ml-auto")} data-testid={`link-download-original-${id}`} title={reg.provenance} aria-label={`Download original ${SOURCE_NAMES[id]} source ZIP`}>Source ZIP <Download className="h-3.5 w-3.5" /></a>}
                </div>
              </article>
            );
          })}
        </div>

        {signedIn && sourcesQ.isSuccess && unregistered.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-input bg-card px-4 py-3 text-[13px]" data-testid="panel-unregistered">
            <Lock className="h-4 w-4 text-siennaink" />
            <span className="min-w-0 flex-1">Awaiting IT setup: {unregistered.map((s) => SOURCE_NAMES[s] ?? s).join(", ")}. Your selections stay here while you check availability.</span>
            <button className={btn.quiet} onClick={() => void sourcesQ.refetch()} disabled={sourcesQ.isFetching}><RefreshCw className="h-4 w-4" /> Check availability</button>
          </div>
        )}
        {signedIn && sourcesQ.isError && <div role="alert" className="mt-3 text-sm">The source library could not load. <button className={btn.quiet} onClick={() => void sourcesQ.refetch()}>Retry</button></div>}

        <div className="mt-5 text-[13px] font-semibold">2 · What should it do?</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {recipe.capabilities.map((c) => {
            const avail = draft.sources.includes(c.sourceId);
            const on = avail && draft.caps.includes(c.id);
            return (
              <button key={c.id} type="button" onClick={() => toggleCap(c.id)} disabled={!avail || fixedAll} aria-pressed={on} data-testid={`toggle-cap-${c.id}`}
                title={!avail ? `Add ${SOURCE_NAMES[c.sourceId]} to use this` : undefined}
                className={cn("inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-colors", on ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground", !avail && "line-through opacity-60")}>
                {on ? <Check className="h-3.5 w-3.5" /> : <Plug className="h-3.5 w-3.5" />}{c.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col rounded-xl border border-border bg-card p-4">
        <label className="text-[13px] font-semibold" htmlFor={`need-${recipe.id}`}>3 · Your need, in plain words</label>
        <textarea id={`need-${recipe.id}`} value={draft.need} onChange={(e) => setDraft({ need: e.target.value })} rows={4} maxLength={4000} placeholder={NEED_HINT[recipe.id]}
          className="mt-2 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-[14px] outline-none focus:border-primary" data-testid="input-need" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-[13px] font-medium">Start from
            <select value={draft.base} onChange={(e) => setDraft({ base: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-2 text-[14px]" data-testid="select-base">
              {recipe.baseSolutionIds.map((b) => <option key={b} value={b} disabled={!draft.sources.includes(b)}>{SOURCE_NAMES[b] ?? b}</option>)}
            </select>
          </label>
          <label className="text-[13px] font-medium">Name <span className="font-normal text-muted-foreground">(optional)</span>
            <input value={draft.title} onChange={(e) => setDraft({ title: e.target.value })} maxLength={200} placeholder={recipe.name} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-[14px]" data-testid="input-title" />
          </label>
        </div>
        {problems.length > 0 && <ul className="mt-3 space-y-1 text-[12.5px] text-muted-foreground" data-testid="list-problems">{problems.map((p) => <li key={p}>· {p}</li>)}</ul>}
        {err && <p role="alert" className="mt-3 rounded-lg bg-accent px-3 py-2 text-[13px] text-siennaink" data-testid="text-create-error">{err}</p>}
        <div className="mt-auto pt-4">
          {authLoading ? <Skel className="h-11 w-full" /> : !signedIn ? (
            <a href={loginHref()} className={cn(btn.secondary, "w-full")} data-testid="link-signin-combine">Sign in to propose a combination</a>
          ) : (
            <button onClick={submit} disabled={create.isPending || problems.length > 0} className={cn(btn.accent, "min-h-12 w-full")} data-testid="button-propose-combination">
              <Layers className="h-4 w-4" /> {create.isPending ? "Preparing the map…" : "Combine in Workbench"} <ArrowRight className="h-4 w-4" />
            </button>
          )}
          <div className="mt-2"><Tag tone="muted">Demo data</Tag></div>
        </div>
      </div>
    </div>
  );
}

function CombinedList({ q }: { q: ReturnType<typeof useCombinedCases> }) {
  const list = useMemo<CombinedCase[]>(() => q.data ?? [], [q.data]);
  if (q.isLoading) return <div className="mt-6"><Skel className="h-16" /></div>;
  if (q.isError) return <div role="alert" className="mt-6 flex items-center gap-3 text-sm text-siennaink">Your combinations could not load. <button className={btn.quiet} onClick={() => void q.refetch()}><RefreshCw className="h-4 w-4" /> Retry</button></div>;
  if (!list.length) return null;
  return (
    <div className="mt-6 border-t border-border pt-5" data-testid="list-combined-cases">
      <h3 className="text-[15px] font-semibold">Your combinations</h3>
      <p className="mb-3 text-[12.5px] text-muted-foreground">Originals stay above, unchanged. Each combination opens its own app; exports and their history live on its map page.</p>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {list.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`row-combined-${c.id}`}>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{c.title}</div>
              <div className="text-[12.5px] text-muted-foreground">{c.selectedSources.map((s) => SOURCE_NAMES[s.id] ?? s.id).join(" + ")} · rev {c.revision} · {new Date(c.updatedAt).toLocaleString()}</div>
            </div>
            <Tag tone="sky">Combined</Tag>
            <a href={c.runUrl} target="_blank" rel="noopener noreferrer" className={btn.quiet} data-testid={`link-run-combined-${c.id}`}>Open combined app <ExternalLink className="h-3.5 w-3.5" /></a>
            <Link href={`/workbench/${c.id}`} className={btn.secondary} data-testid={`link-open-combined-${c.id}`}>Map, run and export</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
