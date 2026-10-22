import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Download, FileCode2, History, Lock, Play, RefreshCw, RotateCcw, Save, ShieldCheck, Undo2, X } from "lucide-react";
import {
  getBeginBrowserLoginUrl, getExportFinanceWiringVersionUrl, getGetFinanceWiringVersionsQueryKey,
  useGetCurrentAuthUser, useGetFinanceWiringCatalog, useGetFinanceWiringVersions, useRestoreFinanceWiringVersion, useRunFinanceWiring, useSaveFinanceWiringVersion, useValidateFinanceWiring,
  type FinanceWiringCatalog, type FinanceWiringConfig, type FinanceWiringResult, type FinanceWiringState, type FinanceWiringValidation, type FinanceWiringVersion,
} from "@workspace/api-client-react";
import { ErrorView, Skel, StageEyebrow, Tag, btn, useUndoToast } from "@/components/bits";
import { errMsg, httpStatus } from "@/lib/case";
import { cn } from "@/lib/utils";

const ACCOUNT_CHOICES = ["Contractors", "Software & Licences", "Professional Fees"] as const;
const FIXED_SOURCES: Record<string, number> = { Revenue: 0, COGS: 1 };

/** Stable key: sorted object keys, so a server echo with different key order still compares equal. */
function keyOf(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(keyOf).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${keyOf((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
const short = (s?: string | null, n = 12) => (s ? s.slice(0, n) : "none");
const neg = (s: string) => s.trim().startsWith("-") || s.trim().startsWith("(");
const when = (iso: string) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

type Stamped<T> = { key: string; data: T };

export default function FinanceWiringPage() {
  useEffect(() => { const prev = document.title; document.title = "Finance wiring · Workbench · FUSEBOX"; return () => { document.title = prev; }; }, []);
  const qc = useQueryClient();
  const say = useUndoToast();
  const catalogQ = useGetFinanceWiringCatalog();
  const versionsQ = useGetFinanceWiringVersions({ query: { queryKey: getGetFinanceWiringVersionsQueryKey(), retry: false } });
  const authQ = useGetCurrentAuthUser();
  const validate = useValidateFinanceWiring();
  const run = useRunFinanceWiring();
  const save = useSaveFinanceWiringVersion();
  const restore = useRestoreFinanceWiringVersion();

  const versionsStatus = versionsQ.isError ? httpStatus(versionsQ.error) : null;
  const signedOut = versionsStatus === 401 || (authQ.isSuccess && !authQ.data?.user);
  const state: FinanceWiringState | undefined = versionsQ.data;
  const sorted = useMemo(() => [...(state?.versions ?? [])].sort((a, b) => b.number - a.number), [state]);
  const active = useMemo(() => state?.versions.find((v) => v.id === state.activeVersionId) ?? null, [state]);
  const savedConfig: FinanceWiringConfig | undefined = active?.config ?? catalogQ.data?.defaultConfig;

  const [draft, setDraft] = useState<FinanceWiringConfig | null>(null);
  const initialized = useRef(false);
  const versionsSettled = !versionsQ.isLoading;
  // Init once: active saved config, else catalog default. Later refetches never overwrite edits.
  useEffect(() => {
    if (initialized.current || !catalogQ.data || !versionsSettled) return;
    initialized.current = true;
    setDraft(structuredClone(active?.config ?? catalogQ.data.defaultConfig));
  }, [catalogQ.data, versionsSettled, active]);

  const [validation, setValidation] = useState<Stamped<FinanceWiringValidation> | null>(null);
  const [result, setResult] = useState<Stamped<FinanceWiringResult> | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [lastPrevActive, setLastPrevActive] = useState<string | null>(null);

  const draftKey = draft ? keyOf(draft) : "";
  const dirty = !!draft && !!savedConfig && draftKey !== keyOf(savedConfig);
  const validationCurrent = validation?.key === draftKey;
  const resultCurrent = result?.key === draftKey;
  // What to show as the report: a run for this exact config, else the active saved version's stored result if unchanged.
  const shownResult: { r: FinanceWiringResult; label: "current" | "saved" | "previous" } | null = resultCurrent && result ? { r: result.data, label: "current" }
    : !dirty && active ? { r: active.result, label: "saved" } : result ? { r: result.data, label: "previous" }
    : active ? { r: active.result, label: "previous" } : null;

  const edit = (patch: Partial<FinanceWiringConfig>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const doValidate = () => { if (!draft) return; const k = draftKey; validate.mutate({ data: { config: draft } }, { onSuccess: (v) => setValidation({ key: k, data: v }), onError: (e) => say(errMsg(e)) }); };
  const doRun = () => {
    if (!draft) return; const k = draftKey;
    run.mutate({ data: { config: draft } }, {
      onSuccess: (r) => { setResult({ key: k, data: r }); setValidation({ key: k, data: { valid: true, errors: [], config: r.config, fingerprint: r.fingerprint } }); },
      onError: (e) => { const d = (e as { data?: { errors?: string[] } }).data; if (d?.errors) setValidation({ key: k, data: { valid: false, errors: d.errors } }); say(errMsg(e)); },
    });
  };
  const handleStateErr = (e: unknown) => {
    const st = httpStatus(e);
    if (st === 409) setConflict("Someone (or another tab) changed your saved wiring since this page loaded. Your edits are kept here; reload the saved versions, then decide.");
    else if (st === 401) say("Sign in to save and restore wiring versions. Preview still works.");
    else say(errMsg(e));
  };
  const setState = (s: FinanceWiringState) => qc.setQueryData(getGetFinanceWiringVersionsQueryKey(), s);
  const doSave = () => {
    if (!draft || !state) return;
    save.mutate({ data: { config: draft, expectedRevision: state.revision } }, {
      onSuccess: (s) => {
        setState(s); setConflict(null);
        const v = s.versions.find((x) => x.id === s.activeVersionId);
        if (v) { setDraft(structuredClone(v.config)); setResult({ key: keyOf(v.config), data: v.result }); }
        say(v ? `Saved as version ${v.number}. The server re-ran it and stored the result.` : "Saved.");
      },
      onError: handleStateErr,
    });
  };
  const doRestore = (v: FinanceWiringVersion, undoable = true) => {
    if (!state) return;
    const prev = state.activeVersionId;
    restore.mutate({ data: { versionId: v.id, expectedRevision: state.revision } }, {
      onSuccess: (s) => {
        setState(s); setConflict(null); setLastPrevActive(prev);
        setDraft(structuredClone(v.config));
        const prevV = prev ? s.versions.find((x) => x.id === prev) : undefined;
        say(`Version ${v.number} is active again.`, undoable && prevV ? () => doRestoreLatest(prevV.id) : undefined);
      },
      onError: handleStateErr,
    });
  };
  // Undo reads fresh state from the cache, since the closure above is one revision behind.
  const doRestoreLatest = (id: string) => {
    const s = qc.getQueryData<FinanceWiringState>(getGetFinanceWiringVersionsQueryKey());
    const v = s?.versions.find((x) => x.id === id);
    if (!s || !v) return;
    restore.mutate({ data: { versionId: id, expectedRevision: s.revision } }, {
      onSuccess: (n) => { setState(n); setDraft(structuredClone(v.config)); setLastPrevActive(null); say(`Undone. Version ${v.number} is active.`); },
      onError: handleStateErr,
    });
  };
  const discard = () => { if (savedConfig) { setDraft(structuredClone(savedConfig)); say(active ? `Edits discarded. Back to saved version ${active.number}.` : "Edits discarded. Back to the catalog default."); } };
  const reloadSaved = () => { setConflict(null); versionsQ.refetch(); };

  if (catalogQ.isLoading || (!draft && !catalogQ.isError)) return <WiringSkeleton />;
  if (catalogQ.isError || !catalogQ.data || !draft) return <ErrorView onRetry={() => catalogQ.refetch()} message="The finance wiring catalog could not load." />;
  const cat = catalogQ.data;
  const busy = validate.isPending || run.isPending || save.isPending || restore.isPending;
  const canPersist = !!state && !signedOut;
  const prevActiveVersion = lastPrevActive ? state?.versions.find((v) => v.id === lastPrevActive) : undefined;

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-28 pt-5 md:px-6" data-testid="page-finance-wiring">
      <StageEyebrow stage="connect" note="Inspect the real integration. Change it without touching source." className="mb-2" />
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        <Link href="/library" className="inline-flex items-center gap-1 hover:text-primary" data-testid="link-back-workbench"><ArrowLeft className="h-3.5 w-3.5" /> Workbench</Link><span>/</span><span>Finance wiring</span>
        <StatusTag dirty={dirty} active={active} />
      </div>
      <div className="mt-1 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] md:text-[32px]" data-testid="text-headline">Forecast to report, <span className="display-accent">wired live.</span></h1>
          <p className="mt-1.5 max-w-3xl text-[14.5px] text-muted-foreground">Validate checks your connections. Run and Save execute the original finance modules; Export re-runs the saved configuration. Report values are never calculated in this browser.</p>
        </div>
        <ReceiptChip active={active} signedOut={signedOut} loading={versionsQ.isLoading} />
      </div>

      {signedOut && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-accent-border bg-accent px-4 py-3 text-[14px] text-accent-foreground" data-testid="banner-signin">
          <Lock className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">Saved versions belong to a signed-in account. Your demo persona is a role preview, not an identity, so you can validate and run here but saving, restoring and exporting need you to sign in.</span>
          <a href={getBeginBrowserLoginUrl({ returnTo: `${import.meta.env.BASE_URL.replace(/\/$/, "")}/workbench/wiring` })} className={cn(btn.secondary, "min-h-9")} data-testid="link-signin">Sign in</a>
        </div>
      )}
      {versionsQ.isError && !signedOut && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/30 bg-card px-4 py-3 text-[14px]" data-testid="banner-versions-error">
          <AlertTriangle className="h-4 w-4 text-destructive" /><span className="flex-1">Saved versions could not load. Your edits are safe; saving is paused until they do.</span>
          <button className={cn(btn.secondary, "min-h-9")} onClick={() => versionsQ.refetch()} data-testid="button-retry-versions"><RefreshCw className="h-4 w-4" /> Retry</button>
        </div>
      )}
      {conflict && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/40 bg-card px-4 py-3 text-[14px]" data-testid="banner-conflict">
          <AlertTriangle className="h-4 w-4 text-destructive" /><span className="flex-1">{conflict}</span>
          <button className={cn(btn.secondary, "min-h-9")} onClick={reloadSaved} data-testid="button-reload-conflict"><RefreshCw className="h-4 w-4" /> Reload saved versions</button>
          <button className={cn(btn.quiet, "min-h-9")} onClick={() => setConflict(null)} aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}

      <Schematic cat={cat} draft={draft} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6 min-w-0">
          <fieldset disabled={busy} className="min-w-0 disabled:opacity-70">
            <Controls cat={cat} draft={draft} edit={edit} savedConfig={savedConfig} />
          </fieldset>
          <ReportPanel shown={shownResult} running={run.isPending} />
        </div>
        <aside className="space-y-6">
          <ActionPanel
            dirty={dirty} busy={busy} validation={validation?.data ?? null} validationCurrent={validationCurrent} resultCurrent={resultCurrent}
            onValidate={doValidate} onRun={doRun} onSave={doSave} onDiscard={discard} canPersist={canPersist} signedOut={signedOut}
            validating={validate.isPending} running={run.isPending} saving={save.isPending} hasActive={!!active}
          />
          <Versions versions={sorted} activeId={state?.activeVersionId ?? null} loading={versionsQ.isLoading} signedOut={signedOut} canPersist={canPersist}
            busy={busy} dirty={dirty} onRestore={(v) => doRestore(v)} prevActive={prevActiveVersion} onUndo={() => prevActiveVersion && doRestoreLatest(prevActiveVersion.id)} />
          <Contract cat={cat} />
        </aside>
      </div>
    </div>
  );
}

function StatusTag({ dirty, active }: { dirty: boolean; active: FinanceWiringVersion | null }) {
  if (dirty) return <Tag tone="sienna" testid="status-wiring">Unsaved edits</Tag>;
  return <Tag tone={active ? "green" : "muted"} testid="status-wiring">{active ? `Saved version ${active.number}` : "Catalog default"}</Tag>;
}

function ReceiptChip({ active, signedOut, loading }: { active: FinanceWiringVersion | null; signedOut: boolean; loading: boolean }) {
  if (loading) return <Skel className="h-14 w-60 rounded-xl" />;
  return (
    <div className="rounded-xl border border-[#173D4A] bg-[#081F29] px-4 py-2.5 font-mono text-[11.5px] text-[#9ED9E3]" data-testid="text-active-receipt">
      <div className="uppercase tracking-[0.14em] text-[#9ED9E3]/60">Active receipt</div>
      <div className="mt-0.5 text-[13px] text-[#E8F7F8]">{signedOut ? "sign in to keep receipts" : active ? `v${active.number} · ${short(active.fingerprint)}` : "nothing saved yet"}</div>
    </div>
  );
}

/* ---------- Schematic: explicit field connections from the catalog ---------- */
function Schematic({ cat, draft }: { cat: FinanceWiringCatalog; draft: FinanceWiringConfig }) {
  const nodes = [
    { k: "Sources", lines: cat.sources.map((s) => `${s.path.startsWith("Budget-") ? "forecast" : "reporting"}/${s.path.split("/").pop()}`) },
    { k: "Selection", lines: [`method ${draft.method}`, `period ${draft.period}`, `centres ${draft.centres.length}`] },
    { k: "Adjustment", lines: [`${draft.account}`, Number.isFinite(draft.adjustment) ? `${draft.adjustment >= 0 ? "+" : ""}${draft.adjustment} USD` : "Enter a valid amount"], hot: true },
    { k: "Account map", lines: [`10 sources`, `${new Set(Object.values(draft.accountMapping)).size} targets`] },
    { k: "Report", lines: ["12 lines · USD", "monthly detail"] },
  ];
  return (
    <section className="schem relative mt-6 p-4 md:p-5" data-testid="schematic-wiring">
      <div className="relative z-[1]">
        <div className="mb-3 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-[#9ED9E3]/70"><span>Draft connections</span><span>reads your current draft</span></div>
        <div className="flex items-stretch overflow-x-auto pb-1">
          {nodes.map((n, i) => (
            <div key={n.k} className="flex items-stretch">
              <div className={cn("blk min-w-[150px] px-3.5 py-2.5", n.hot && "inserted")}>
                <span className="port l" /><span className="port r" />
                <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#9ED9E3]/70">{String(i + 1).padStart(2, "0")} · {n.k}</div>
                {n.lines.map((l) => <div key={l} className="truncate text-[13px]">{l}</div>)}
              </div>
              {i < nodes.length - 1 && <span className="wire" />}
            </div>
          ))}
        </div>
        <details className="group mt-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-medium text-[#9ED9E3] hover:text-white" data-testid="toggle-connections">
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> {cat.connections.length} field connections and their contracts
          </summary>
          <ul className="mt-2 grid gap-1.5 md:grid-cols-2">
            {cat.connections.map((c, i) => (
              <li key={i} className="schem-row px-3 py-2 text-[12.5px]" data-testid={`row-connection-${i}`}>
                <div className="font-mono text-[#E8F7F8]">{c.from} <span className="text-[#FF9B4C]">-&gt;</span> {c.to}</div>
                <div className="mt-0.5 text-[#9ED9E3]/80">{c.contract}</div>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}

/* ---------- Controls ---------- */
function Field({ label, hint, changed, children }: { label: string; hint?: string; changed?: boolean; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2"><span className="eyebrow">{label}</span>{changed && <span className="h-1.5 w-1.5 rounded-full bg-sienna" title="Changed from saved" />}</div>
      {children}
      {hint && <p className="mt-1 text-[12.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
const seg = (on: boolean) => cn("min-h-9 rounded-lg px-3 text-[13.5px] font-semibold transition-colors", on ? "bg-primary text-primary-foreground shadow-sm" : "text-primary/80 hover:bg-secondary");

export function Controls({ cat, draft, edit, savedConfig }: { cat: FinanceWiringCatalog; draft: FinanceWiringConfig; edit: (p: Partial<FinanceWiringConfig>) => void; savedConfig?: FinanceWiringConfig }) {
  const validAmount = Number.isInteger(draft.adjustment) && draft.adjustment % 6 === 0 && draft.adjustment >= -600 && draft.adjustment <= 6000;
  const ch = (k: keyof FinanceWiringConfig) => !!savedConfig && keyOf(savedConfig[k]) !== keyOf(draft[k]);
  const sources = Object.keys(draft.accountMapping);
  const targets = cat.accounts;
  const mapChanged = ch("accountMapping");
  return (
    <section className="card-soft p-5 md:p-6" data-testid="panel-controls">
      <h2 className="text-[18px] font-semibold">Configuration</h2>
      <p className="mt-0.5 text-[13.5px] text-muted-foreground">Schema version {draft.schemaVersion}. Edits mark validation and results as belonging to an earlier config.</p>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Field label="Forecast method" changed={ch("method")}>
          <div className="inline-flex flex-wrap rounded-xl bg-secondary p-0.5" role="radiogroup">
            {cat.methods.map((m) => <button key={m.id} role="radio" aria-checked={draft.method === m.id} data-testid={`button-method-${m.id}`} onClick={() => edit({ method: m.id as FinanceWiringConfig["method"] })} className={seg(draft.method === m.id)}>{m.label}</button>)}
          </div>
        </Field>
        <Field label="Reporting period" changed={ch("period")}>
          <select data-testid="select-period" value={draft.period} onChange={(e) => edit({ period: e.target.value as FinanceWiringConfig["period"] })} className="h-10 w-full rounded-xl border border-input bg-card px-3 text-[14.5px]">
            {cat.periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Adjusted account" changed={ch("account")}>
          <select data-testid="select-account" value={draft.account} onChange={(e) => edit({ account: e.target.value as FinanceWiringConfig["account"] })} className="h-10 w-full rounded-xl border border-input bg-card px-3 text-[14.5px]">
            {ACCOUNT_CHOICES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Total Q4 adjustment (USD)" changed={ch("adjustment")} hint="Whole dollars, multiples of 6, from -600 to 6000. The source engine spreads this total across selected centres × 3 Q4 months, even for a one-month report.">
          <div className="flex items-center gap-2">
            <button className={cn(btn.secondary, "min-h-10 w-10 px-0")} data-testid="button-adjust-down" onClick={() => edit({ adjustment: draft.adjustment - 6 })} aria-label="Decrease by 6">-</button>
            <input data-testid="input-adjustment" type="number" step={6} min={-600} max={6000} aria-label="Total Q4 adjustment (USD)"
              aria-invalid={!validAmount} value={Number.isFinite(draft.adjustment) ? draft.adjustment : ""}
              onChange={(e) => edit({ adjustment: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
              className="h-10 w-full rounded-xl border border-input bg-card px-3 text-center font-mono text-[15px] outline-none focus:border-primary" />
            <button className={cn(btn.secondary, "min-h-10 w-10 px-0")} data-testid="button-adjust-up" onClick={() => edit({ adjustment: draft.adjustment + 6 })} aria-label="Increase by 6">+</button>
          </div>
          {!validAmount && <p className="mt-1 text-sm text-destructive" role="alert">Enter a whole-dollar multiple of 6 between -600 and 6000. This input cannot execute.</p>}
        </Field>
        <Field label="Cost centres" changed={ch("centres")} hint="Names must match the source exactly. At least one; the server rejects an empty selection.">
          <div className="flex flex-wrap gap-2">
            {cat.centres.map((c) => {
              const on = (draft.centres as string[]).includes(c.name);
              return (
                <button key={c.id} aria-pressed={on} data-testid={`toggle-centre-${c.id}`}
                  onClick={() => edit({ centres: (on ? draft.centres.filter((x) => x !== c.name) : [...draft.centres, c.name]) as FinanceWiringConfig["centres"] })}
                  className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-medium", on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-foreground hover:border-primary/50")}>
                  {on && <Check className="h-3.5 w-3.5" />}{c.name}<span className="font-mono text-[11px] opacity-70">#{c.id}</span>
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Protected">
          <ul className="space-y-1 text-[13px] text-muted-foreground">
            <li className="flex gap-2"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Currency is USD end to end.</li>
            <li className="flex gap-2"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Dollars to cents conversion happens once, server side.</li>
            <li className="flex gap-2"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Cost-centre IDs map to themselves; renames are not supported.</li>
          </ul>
        </Field>
      </div>

      <details className="group mt-6 rounded-2xl border border-border bg-background/60" open={false}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[14px] font-semibold text-primary" data-testid="toggle-mapping">
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> Advanced: account mapping
          <span className="font-normal text-muted-foreground">· {sources.length} sources to {new Set(Object.values(draft.accountMapping)).size} report lines</span>
          {mapChanged && <Tag tone="sienna">changed</Tag>}
        </summary>
        <div className="border-t border-border px-4 pb-4 pt-3">
          <p className="mb-3 text-[13px] text-muted-foreground">Revenue and COGS are fixed to targets 0 and 1. Expense sources can point at any target 2 to 9, including combining several into one line.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {sources.map((s) => {
              const fixed = s in FIXED_SOURCES;
              const val = (draft.accountMapping as unknown as Record<string, number>)[s];
              return (
                <label key={s} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{s}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">-&gt;</span>
                  {fixed ? <span className="inline-flex items-center gap-1 font-mono text-[12.5px] text-muted-foreground" data-testid={`text-map-${s}`}><Lock className="h-3 w-3" /> {val} · {targets.find((t) => t.id === val)?.name}</span> : (
                    <select data-testid={`select-map-${s.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`} value={val}
                      onChange={(e) => edit({ accountMapping: { ...draft.accountMapping, [s]: Number(e.target.value) } })}
                      className="h-9 max-w-[190px] rounded-lg border border-input bg-card px-2 text-[13px]">
                      {targets.filter((t) => t.id >= 2).map((t) => <option key={t.id} value={t.id}>{t.id} · {t.name}</option>)}
                    </select>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      </details>
    </section>
  );
}

/* ---------- Actions ---------- */
function ActionPanel(p: {
  dirty: boolean; busy: boolean; validation: FinanceWiringValidation | null; validationCurrent: boolean; resultCurrent: boolean;
  onValidate: () => void; onRun: () => void; onSave: () => void; onDiscard: () => void; canPersist: boolean; signedOut: boolean;
  validating: boolean; running: boolean; saving: boolean; hasActive: boolean;
}) {
  const v = p.validation;
  return (
    <section className="card-soft border-t-4 border-t-sienna p-5" data-testid="panel-actions">
      <h2 className="text-[17px] font-semibold">Fuse this config</h2>
      <div className="mt-3" data-testid="status-validation">
        {!v ? <p className="text-[13.5px] text-muted-foreground">Not validated yet.</p>
          : !p.validationCurrent ? <p className="text-[13.5px] text-muted-foreground">Last check was for a previous config ({v.valid ? "valid" : "invalid"}). Validate again.</p>
          : v.valid ? <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-ok"><ShieldCheck className="h-4 w-4" /> Valid · fingerprint <span className="font-mono">{short(v.fingerprint)}</span></p>
          : (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-destructive"><AlertTriangle className="h-4 w-4" /> Blocked: the engine will not accept this</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px]" data-testid="list-validation-errors">{v.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className={cn(btn.secondary, "min-h-11")} onClick={p.onValidate} disabled={p.busy} data-testid="button-validate"><ShieldCheck className="h-4 w-4" /> {p.validating ? "Checking..." : "Validate"}</button>
        <button className={cn(btn.accent, "min-h-11 px-3 text-[15px]")} onClick={p.onRun} disabled={p.busy} data-testid="button-run-wiring"><Play className="h-4 w-4" /> {p.running ? "Running..." : p.resultCurrent ? "Run again" : "Run"}</button>
      </div>
      <button className={cn(btn.primary, "mt-2 w-full min-h-11 text-[15px]")} onClick={p.onSave} disabled={p.busy || !p.canPersist || (!p.dirty && p.hasActive)} data-testid="button-save-wiring">
        <Save className="h-4 w-4" /> {p.saving ? "Saving and running..." : "Save as new version"}
      </button>
      <p className="mt-1.5 text-[12px] text-muted-foreground">{p.signedOut ? "Sign in to save. Preview runs are not stored." : !p.dirty && p.hasActive ? "Nothing to save: this is the active version." : "Saving re-validates and re-runs on the server, then stores an immutable result."}</p>
      <button className={cn(btn.quiet, "mt-2 w-full justify-center")} onClick={p.onDiscard} disabled={!p.dirty || p.busy} data-testid="button-discard"><RotateCcw className="h-4 w-4" /> Discard unsaved edits</button>
    </section>
  );
}

/* ---------- Report ---------- */
function ReportPanel({ shown, running }: { shown: { r: FinanceWiringResult; label: "current" | "saved" | "previous" } | null; running: boolean }) {
  if (running && !shown) return <Skel className="h-96 rounded-[20px]" />;
  if (!shown) return (
    <section className="card-soft grid place-items-center p-10 text-center" data-testid="state-no-result">
      <Play className="h-8 w-8 text-sienna" />
      <h2 className="mt-3 text-[18px] font-semibold">No report for this config yet</h2>
      <p className="mt-1 max-w-sm text-[14px] text-muted-foreground">Run it to read the 12 report lines straight from the source files.</p>
    </section>
  );
  const { r, label } = shown;
  return (
    <section className={cn("card-soft overflow-hidden", label === "previous" && "opacity-75")} data-testid="panel-report">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3.5">
        <h2 className="text-[17px] font-semibold">Account report</h2>
        <Tag tone={label === "previous" ? "sienna" : label === "saved" ? "green" : "sky"} testid="status-result-label">{label === "current" ? "Current config" : label === "saved" ? "Saved version result" : "Previous config, not current"}</Tag>
        {running && <span className="text-[12.5px] text-muted-foreground">Running...</span>}
        <span className="ml-auto font-mono text-[11.5px] text-muted-foreground" data-testid="text-result-fingerprint">{r.currency} · {r.period} · adj {r.adjustment} · {short(r.fingerprint)}</span>
      </div>
      {label === "previous" && <div className="bg-accent px-5 py-2 text-[13px] text-accent-foreground">These numbers came from a configuration you have since changed. Run again to see the current one.</div>}
      <LinesTable lines={r.lines} testid="table-report" />
      <details className="group border-t border-border">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-[14px] font-semibold text-primary" data-testid="toggle-months">
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> Monthly detail · {r.months.length} months
        </summary>
        <div className="space-y-4 px-5 pb-5">
          {r.months.map((m) => <div key={m.period}><div className="eyebrow mb-1">{m.period}</div><LinesTable lines={m.lines} compact testid={`table-month-${m.period}`} /></div>)}
        </div>
      </details>
      <details className="group border-t border-border">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-[14px] font-semibold text-primary" data-testid="toggle-result-sources">
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> Source hashes used by this run
        </summary>
        <SourceList sources={r.sourceHashes} />
      </details>
      {r.note && <p className="border-t border-border px-5 py-3 text-[13px] text-muted-foreground" data-testid="text-result-note">{r.note}</p>}
    </section>
  );
}

export function LinesTable({ lines, compact, testid }: { lines: FinanceWiringResult["lines"]; compact?: boolean; testid: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-[13.5px]", compact && "text-[12.5px]")} data-testid={testid}>
        <thead><tr className="text-left text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
          <th className="px-5 py-2 font-semibold">Line</th><th className="px-3 py-2 text-right font-semibold">Baseline</th><th className="px-3 py-2 text-right font-semibold">Current</th><th className="px-5 py-2 text-right font-semibold">Difference</th>
        </tr></thead>
        <tbody>
          {lines.map((l) => {
            const zero = /^[-$\s(]*0(\.0+)?\)?$/.test(l.difference.replace(/[$,]/g, ""));
            return (
              <tr key={l.id} className="border-t border-border/70" data-testid={`row-line-${l.id}`}>
                <td className="px-5 py-1.5"><span className="mr-2 font-mono text-[11px] text-muted-foreground">{l.id}</span>{l.name}</td>
                <td className="px-3 py-1.5 text-right font-mono">{l.baseline}</td>
                <td className="px-3 py-1.5 text-right font-mono font-semibold text-primary">{l.current}</td>
                <td className={cn("px-5 py-1.5 text-right font-mono", zero ? "text-muted-foreground" : neg(l.difference) ? "text-destructive" : "text-siennaink")}>{l.difference}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SourceList({ sources }: { sources: { path: string; sha256: string }[] }) {
  return (
    <ul className="space-y-1 px-5 pb-4">
      {sources.map((s) => (
        <li key={s.path} className="flex items-center gap-2 text-[12.5px]" data-testid={`text-source-${s.path}`}>
          <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono">{s.path}</span>
          <span className="font-mono text-muted-foreground" title={s.sha256}>{short(s.sha256, 16)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Versions ---------- */
function Versions(p: { versions: FinanceWiringVersion[]; activeId: string | null; loading: boolean; signedOut: boolean; canPersist: boolean; busy: boolean; dirty: boolean; onRestore: (v: FinanceWiringVersion) => void; prevActive?: FinanceWiringVersion; onUndo: () => void }) {
  return (
    <section className="card-soft p-5" data-testid="panel-versions">
      <div className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /><h2 className="text-[17px] font-semibold">Saved versions</h2></div>
      {p.prevActive && (
        <button className={cn(btn.quiet, "mt-2 px-2")} onClick={p.onUndo} disabled={p.busy} data-testid="button-undo-restore"><Undo2 className="h-4 w-4" /> Undo restore (back to v{p.prevActive.number})</button>
      )}
      {p.loading ? <div className="mt-3 space-y-2"><Skel className="h-16" /><Skel className="h-16" /></div>
        : p.signedOut ? <p className="mt-2 text-[13.5px] text-muted-foreground">Sign in to see the versions saved under your account.</p>
        : p.versions.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-input p-4 text-[13.5px] text-muted-foreground" data-testid="state-no-versions">No saved versions yet. Save one and it gets an immutable receipt and a runnable ZIP.</div>
        ) : (
          <ol className="mt-3 space-y-2">
            {p.versions.map((v) => {
              const on = v.id === p.activeId;
              return (
                <li key={v.id} className={cn("rounded-xl border p-3", on ? "border-primary/50 bg-secondary" : "border-border")} data-testid={`row-version-${v.id}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] font-semibold text-primary">v{v.number}</span>
                    {on && <Tag tone="green">Active</Tag>}
                    <span className="ml-auto text-[11.5px] text-muted-foreground">{when(v.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-[12.5px] text-muted-foreground">{v.config.method} · {v.config.period} · {v.config.account} {v.config.adjustment >= 0 ? "+" : ""}{v.config.adjustment} · <span className="font-mono">{short(v.fingerprint)}</span></div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {!on && <button className={cn(btn.secondary, "min-h-8 px-2.5 text-[13px]")} disabled={p.busy || !p.canPersist} onClick={() => p.onRestore(v)} data-testid={`button-restore-${v.id}`} title={p.dirty ? "Restoring replaces your unsaved edits" : undefined}><RotateCcw className="h-3.5 w-3.5" /> Restore</button>}
                    <a href={getExportFinanceWiringVersionUrl(v.id)} download={`finance-wiring-v${v.number}.zip`} className={cn(btn.quiet, "min-h-8 px-2.5 text-[13px] text-primary")} data-testid={`link-export-${v.id}`}>
                      <Download className="h-3.5 w-3.5" /> Download saved v{v.number} ZIP
                    </a>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      <p className="mt-3 text-[12px] text-muted-foreground">Each ZIP is a runnable package of that saved version only: its config, source files and stored result. Unsaved edits are never exported.</p>
    </section>
  );
}

function Contract({ cat }: { cat: FinanceWiringCatalog }) {
  return (
    <section className="card-soft p-5" data-testid="panel-contract">
      <h2 className="text-[17px] font-semibold">Integration contract</h2>
      <ul className="mt-2 space-y-1.5 text-[13px]">
        <li><span className="font-semibold">Units:</span> whole USD in config; cents inside the engine; dollar strings out.</li>
        <li><span className="font-semibold">Sign:</span> positive adjustment raises the account's expense; differences are current minus baseline.</li>
        <li><span className="font-semibold">Period:</span> Q4 or one month of October to December.</li>
      </ul>
      <details className="group mt-3">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13.5px] font-semibold text-primary" data-testid="toggle-sources"><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> {cat.sources.length} source files and hashes</summary>
        <div className="-mx-5 mt-2"><SourceList sources={cat.sources} /></div>
      </details>
      {cat.limitations.length > 0 && (
        <div className="mt-3 rounded-xl bg-muted p-3" data-testid="list-limitations">
          <div className="eyebrow mb-1">Not supported</div>
          <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-muted-foreground">{cat.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

function WiringSkeleton() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 pt-5 md:px-6" data-testid="state-loading">
      <Skel className="h-5 w-64" /><Skel className="mt-3 h-10 w-[420px] max-w-full" /><Skel className="mt-6 h-40 rounded-[20px]" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]"><Skel className="h-96 rounded-[20px]" /><Skel className="h-96 rounded-[20px]" /></div>
    </div>
  );
}
