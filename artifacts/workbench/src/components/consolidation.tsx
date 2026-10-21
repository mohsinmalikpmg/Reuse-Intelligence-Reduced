import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, FileText, Info, Undo2 } from "lucide-react";
import {
  getGetCaseConsolidationQueryKey, useGetCaseConsolidation, useRecordCaseDecision, useRecordMigrationNote, useSetCaseDispositions,
  type ConsolidationSolution, type ConsolidationSolutionFate, type DispositionKind, type SolutionVersion,
} from "@workspace/api-client-react";
import { DSection, DispositionBadge, Drawer, Skel, StatusPill, Tag, btn, useUndoToast } from "@/components/bits";
import { errMsg, useInvalidateCase } from "@/lib/case";
import { useRole } from "@/lib/persona";
import { cn } from "@/lib/utils";

/**
 * Convergence circuit between the current products and the successor. Three truthful states:
 * preview (nothing approved: dim, labelled illustrative), draft (owner approved, IT pending: traces live, cube unlit)
 * and converged (IT approval persisted and the successor version is current: traces draw in, the cube energizes once).
 */
function ConvergeCircuit({ sources, successor }: { sources: { id: string; kind: DispositionKind }[]; successor: SolutionVersion | null }) {
  const state: "preview" | "draft" | "converged" = !successor ? "preview" : successor.state === "current" ? "converged" : "draft";
  const n = Math.max(1, sources.length);
  const pitch = 70, W = 184, H = Math.max(150, n * pitch);
  const cx = 78, cy = H / 2;
  const cube = `${import.meta.env.BASE_URL}brand/power-cube-compact.svg`;
  // Retired products feed the successor faintly; retained ones stay their own colour; folded or configured ones carry the current.
  const tone = (k: DispositionKind) => (k === "retire" ? "#9AAFB5" : k === "retain" ? "#6E9EAF" : "#64D8E8");
  const label = state === "preview" ? "Illustrative preview" : state === "draft" ? "Awaiting IT approval" : `Converged · v${successor!.version}`;
  const live = state !== "preview";
  const path = (i: number) => {
    const y = (i + 0.5) * (H / n);
    const dy = cy - y, r = Math.min(10, Math.abs(dy) / 2 || 0);
    if (Math.abs(dy) < 1) return `M0,${y} L${cx - 22},${cy}`;
    const sgn = dy > 0 ? 1 : -1;
    return `M0,${y} L${cx - 46 - r},${y} Q${cx - 46},${y} ${cx - 46},${y + sgn * r} L${cx - 46},${cy - sgn * r} Q${cx - 46},${cy} ${cx - 46 + r},${cy} L${cx - 22},${cy}`;
  };
  return (
    <figure className="mx-auto hidden lg:block" data-testid="converge-circuit" data-state={state} aria-label={`Convergence: ${label}`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" aria-hidden="true">
        {sources.map((s, i) => (
          <path key={s.id} d={path(i)} fill="none" stroke={live ? tone(s.kind) : "#9AAFB5"} strokeWidth={live ? 2.5 : 1.5} strokeDasharray={live ? undefined : "5 5"} strokeLinecap="round"
            pathLength={1} className={state === "converged" ? "converge-in" : undefined} opacity={s.kind === "retire" && live ? 0.6 : 1} />
        ))}
        <path d={`M${cx + 22},${cy} L${W},${cy}`} fill="none" stroke={state === "converged" ? "#FF963D" : live ? "#6E9EAF" : "#9AAFB5"} strokeWidth={state === "converged" ? 3 : live ? 2 : 1.5} strokeDasharray={live ? undefined : "5 5"} strokeLinecap="round" pathLength={1} className={state === "converged" ? "converge-out" : undefined} />
        {state === "converged" && <circle cx={cx} cy={cy} r={30} fill="#FF963D" opacity={0.28} className="cube-spark" />}
        <image href={cube} x={cx - 22} y={cy - 22} width={44} height={44} style={{ filter: live ? "none" : "grayscale(1)", opacity: live ? 1 : 0.5 }} />
      </svg>
      <figcaption className={cn("mt-1 text-center font-mono text-[10.5px] uppercase tracking-[0.12em]", state === "converged" ? "text-siennaink" : "text-muted-foreground")} data-testid="text-converge-state">{label}</figcaption>
    </figure>
  );
}

/** IT's disposition controls, in the order shown; each persists to the case record. */
const DISPOSITIONS: { kind: DispositionKind; label: string }[] = [
  { kind: "retain", label: "Retain" }, { kind: "fold_into", label: "Reuse capability" }, { kind: "configure", label: "Configure" }, { kind: "rebuild", label: "Rebuild" }, { kind: "retire", label: "Retire" },
];
const DEFAULT: Record<ConsolidationSolutionFate, DispositionKind> = { base: "retain", folded: "fold_into", retired: "retire" };
const kindLabel = (k: DispositionKind) => DISPOSITIONS.find((d) => d.kind === k)?.label ?? k;
/** The control to show for a product: its recorded disposition, else the computed default. */
const kindOf = (c: ConsolidationSolution): DispositionKind => c.disposition?.kind ?? DEFAULT[c.fate];

/**
 * Current → proposed consolidation detail for one case: persisted dispositions, the draft or governed successor,
 * IT's approve / withdraw decision, and the evidence drawer. Rendered from the IT queue row that needs it.
 */
export function Consolidation({ caseId, initialSelection = null }: { caseId: string; initialSelection?: string | null }) {
  const role = useRole();
  const q = useGetCaseConsolidation(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseConsolidationQueryKey(caseId) } });
  const dec = useRecordCaseDecision();
  const setDisp = useSetCaseDispositions();
  const migrate = useRecordMigrationNote();
  const invalidate = useInvalidateCase();
  const say = useUndoToast();
  const [sel, setSel] = useState<string | null>(initialSelection);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [drawer, setDrawer] = useState(false);
  if (q.isLoading) return <Skel className="h-72" />;
  if (!q.data) return <p className="text-bad">This consolidation case could not load.</p>;
  const v = q.data;
  const itActions = v.availableActions.find((a) => a.role === "it")?.actions ?? [];
  const canApprove = role === "it" && itActions.includes("approve_consolidation");
  const canWithdraw = role === "it" && itActions.includes("withdraw_consolidation");
  const locked = !!v.decided;
  const chosen = v.current.find((c) => c.solution.id === sel);
  const capCount = new Map<string, number>();
  v.current.forEach((c) => c.solution.capabilityIds.forEach((id) => capCount.set(id, (capCount.get(id) ?? 0) + 1)));
  const done = (msg: string) => { invalidate(caseId); q.refetch(); say(msg); };
  const decide = (action: "approve_consolidation" | "withdraw_consolidation", msg: string) =>
    dec.mutate({ caseId, data: { role: "it", action, reason: v.current.map((c) => `${c.solution.name}: ${kindLabel(kindOf(c))}`).join("; ") } }, { onSuccess: () => done(msg), onError: (e) => say(errMsg(e)) });
  const choose = (solutionId: string, kind: DispositionKind, why?: string) => {
    const before = v.current.find((c) => c.solution.id === solutionId);
    setDisp.mutate({ caseId, data: { choices: [{ solutionId, kind, ...(why?.trim() ? { reason: why.trim() } : {}) }] } }, {
      onSuccess: () => { invalidate(caseId); q.refetch(); say(`${before?.solution.name}: ${kindLabel(kind)}.`, before ? () => choose(solutionId, kindOf(before), before.disposition?.reason ?? undefined) : undefined); },
      onError: (e) => say(errMsg(e)),
    });
  };
  const recordMigration = (solutionId: string) =>
    migrate.mutate({ caseId, data: { solutionId, note: note.trim() } }, { onSuccess: () => { setNote(""); done("Migration recorded."); }, onError: (e) => say(errMsg(e)) });
  const stateLine = v.successor
    ? v.successor.state === "current" ? `Published as ${v.future.name}` : `Draft successor ${v.future.name}, awaiting IT`
    : "Waiting for the owner to approve the pilot; the successor version is drafted then.";

  return (
    <section className="card-soft p-6" data-testid={`consolidation-${caseId}`}>
      <div className="flex flex-wrap items-start gap-3">
        <h3 className="flex-1 text-[19px] font-semibold">{v.headline}</h3>
        <Link href={`/cases/${caseId}/decision`} data-testid="link-decision-view" className={btn.quiet}><FileText className="h-4 w-4" /> Decision view</Link>
        <button data-testid="button-consolidation-details" onClick={() => setDrawer(true)} className={btn.quiet}><Info className="h-4 w-4" /> Details</button>
      </div>
      <div className="mt-5 grid items-center gap-4 lg:grid-cols-[1fr_auto_1fr]" onDoubleClick={() => setDrawer(true)}>
        <div>
          <div className="eyebrow mb-2">Current</div>
          <div className="space-y-2">
            {v.current.map((c) => {
              const k = kindOf(c);
              return (
                <button key={c.solution.id} data-testid={`source-${c.solution.id}`} onClick={() => { setSel(sel === c.solution.id ? null : c.solution.id); setReason(c.disposition?.reason ?? ""); }}
                  className={cn("flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-[border-color,box-shadow]", sel === c.solution.id ? "border-primary shadow-[0_0_0_2px_hsl(var(--primary)/.2)]" : "border-border hover:border-primary/40")}>
                  <div className="min-w-0 flex-1"><div className="font-semibold">{c.solution.name}</div><div className="text-[12.5px] text-muted-foreground">{c.solution.ownerName}</div></div>
                  <StatusPill status={c.solution.status} />
                  {c.disposition ? <DispositionBadge disposition={c.disposition} solutionId={c.solution.id} /> : <Tag tone={k === "retire" ? "muted" : k === "retain" ? "green" : "sky"} testid={`disposition-${c.solution.id}`}>{kindLabel(k)}</Tag>}
                </button>
              );
            })}
          </div>
        </div>
        <ArrowRight className="mx-auto h-6 w-6 rotate-90 text-sienna lg:hidden" />
        <ConvergeCircuit key={v.successor ? `${v.successor.state}-${v.successor.version}` : "preview"} sources={v.current.map((c) => ({ id: c.solution.id, kind: kindOf(c) }))} successor={v.successor} />
        <div className={cn("rounded-xl border-2 p-4", v.successor?.state === "current" ? "border-ok bg-okbg/60" : "border-ok/50 bg-okbg/40")} data-testid="future-product">
          <div className="eyebrow mb-1">{v.successor ? (v.successor.state === "current" ? "Governed version" : "Draft successor") : "Proposed"}</div>
          <div className="text-[18px] font-semibold text-primary">{v.future.name}</div>
          <p className="text-[13.5px]">{v.future.core}</p>
          <ul className="mt-2 space-y-1 text-[13.5px]">{v.future.modules.map((m) => <li key={m.name} className="flex gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />{m.name} <span className="text-muted-foreground">from {m.sourceSolutionName}</span></li>)}</ul>
          {v.future.controls.length > 0 && <p className="mt-2 text-[12.5px] text-muted-foreground">Controls kept: {v.future.controls.join(", ")}</p>}
          <p className="mt-2 text-[12.5px] text-muted-foreground" data-testid="text-successor-state">{stateLine}</p>
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
              const on = kindOf(chosen) === d.kind;
              return <button key={d.kind} role="radio" aria-checked={on} disabled={role !== "it" || locked || setDisp.isPending} data-testid={`set-disposition-${d.kind.replace(/_/g, "-")}`} onClick={() => { if (!on) choose(chosen.solution.id, d.kind, reason); }}
                className={cn("min-h-9 rounded-lg border px-3 text-[13.5px] font-medium disabled:opacity-60", on ? "border-primary bg-primary text-white" : "border-input bg-card")}>{d.label}{d.kind === DEFAULT[chosen.fate] && " (recommended)"}</button>;
            })}
          </div>
          {role === "it" && !locked && kindOf(chosen) === "retain" && chosen.fate !== "base" && (
            <div className="reveal mt-2 flex gap-2">
              <input data-testid="input-disposition-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why keep it separate? (recorded with the disposition)" className="h-10 flex-1 rounded-lg border border-input bg-card px-3 text-[14px] outline-none focus:border-primary" />
              <button data-testid="button-save-reason" disabled={!reason.trim() || setDisp.isPending} onClick={() => choose(chosen.solution.id, "retain", reason)} className={btn.secondary}>Record reason</button>
            </div>
          )}
          {chosen.disposition?.state === "confirmed" && chosen.disposition.kind === "retire" && (
            chosen.disposition.migrationNote
              ? <p className="mt-2 text-[13.5px]" data-testid="text-migration-note"><span className="text-muted-foreground">Migration recorded: </span>{chosen.disposition.migrationNote}</p>
              : role === "it" && (
                <div className="reveal mt-2 flex gap-2">
                  <input data-testid="input-migration-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where did its users go? Retirement stays scheduled until this is recorded." className="h-10 flex-1 rounded-lg border border-input bg-card px-3 text-[14px] outline-none focus:border-primary" />
                  <button data-testid="button-record-migration" disabled={!note.trim() || migrate.isPending} onClick={() => recordMigration(chosen.solution.id)} className={btn.secondary}>Record migration</button>
                </div>
              )
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {v.decided ? (
          <>
            <p data-testid="text-decided" className="inline-flex items-center gap-2 rounded-lg bg-okbg px-3 py-2 text-[14px] font-medium text-ok"><Check className="h-4 w-4" />{v.decided}</p>
            {canWithdraw && <button data-testid="button-withdraw-direction" disabled={dec.isPending} onClick={() => decide("withdraw_consolidation", "Approval withdrawn. The successor is a draft again and every disposition a proposal.")} className={btn.quiet}><Undo2 className="h-4 w-4" /> Withdraw approval</button>}
          </>
        ) : canApprove ? <button data-testid="button-approve-direction" onClick={() => decide("approve_consolidation", `Consolidation direction approved. ${v.future.name} is the governed version.`)} disabled={dec.isPending} className={btn.primary}>Approve direction</button>
          : <p className="text-[13.5px] text-muted-foreground" data-testid="text-not-ready">{role === "it" ? (v.successor ? "Not ready for a consolidation decision yet." : "Approve the improvement in the workbench first.") : "Switch to IT Owner to approve the direction."}</p>}
        <span className="text-[13px] text-muted-foreground">Main risk: {v.risk}</span>
      </div>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title={v.future.name} sub={v.headline} testid="drawer-consolidation">
        <DSection label="Outcomes"><ul className="list-disc pl-5">{v.outcomes.map((o) => <li key={o}>{o}</li>)}</ul></DSection>
        <DSection label="Evidence"><ul className="list-disc space-y-1 pl-5">{v.evidence.map((e) => <li key={e}>{e}</li>)}</ul></DSection>
        <DSection label="Capability provenance">
          {v.successor ? (
            <ul className="space-y-1">{v.successor.foldedCapabilities.map((m) => <li key={m.capabilityId} data-testid={`provenance-${m.capabilityId}`}><span className="font-medium">{m.name}</span> — {m.provenance}</li>)}</ul>
          ) : <ul className="space-y-1">{v.future.modules.map((m) => <li key={m.name}>{m.name}, from {m.sourceSolutionName}</li>)}</ul>}
          {v.successor && <Link href={`/workbench/${v.caseId}?mode=compare`} className="mt-2 inline-flex items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline">See the evidence <ArrowRight className="h-3.5 w-3.5" /></Link>}
          <Link href={`/cases/${v.caseId}/decision`} data-testid="link-consolidation-decision-view" className="ml-4 mt-2 inline-flex items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline">Decision view <ArrowRight className="h-3.5 w-3.5" /></Link>
        </DSection>
        <DSection label="Successor version">{v.successor ? `v${v.successor.version} · ${v.successor.state === "current" ? "current governed version" : "draft, awaiting IT"} · ${v.successor.summary}` : "Not drafted yet; the owner's approval drafts it."}</DSection>
        <DSection label="Dispositions"><ul className="space-y-1">{v.current.map((c) => <li key={c.solution.id}>{c.solution.name}: {c.disposition ? c.disposition.label : `${kindLabel(kindOf(c))} (not recorded yet)`}{c.disposition?.reason ? ` — ${c.disposition.reason}` : ""}{c.disposition?.migrationNote ? ` · migration: ${c.disposition.migrationNote}` : ""}</li>)}</ul></DSection>
        <DSection label="Ownership">{v.current.map((c) => `${c.solution.name}: ${c.solution.ownerName} (${c.solution.ownerTeam})`).join(" · ")}</DSection>
        <DSection label="Dependencies">{[...new Set(v.current.flatMap((c) => c.solution.dependencies))].join(", ") || "None recorded"}</DSection>
        <DSection label="Risk">{v.risk}</DSection>
        <DSection label="Approval">{v.decided ?? "No IT decision recorded yet."}</DSection>
        <DSection label="Costs">Not recorded for this case.</DSection>
      </Drawer>
    </section>
  );
}
