import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CircleDashed, Library, PlugZap, RotateCcw } from "lucide-react";
import { getGetSolutionQueryKey, useGetSolution } from "@workspace/api-client-react";
import { Tag, btn, useUndoToast } from "@/components/bits";
import { cn } from "@/lib/utils";
import {
  compKeys, compMsg, compStatus, evidenceOf, gapsOf, loginHref, useAcceptSuggestion, useUndoComposition,
  type Composition, type LibrarySuggestion,
} from "@/lib/composition";

const H = ({ children }: { children: string }) => <h3 className="text-[12.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{children}</h3>;

/**
 * Three honest buckets: what the selected sources already supply, what another Library solution could supply
 * (only on explicit "Use this capability"), and what nothing evidenced covers yet.
 */
export function CompositionGaps({ c, names }: { c: Composition; names: (id: string) => string }) {
  const { capabilityGaps, suggestions, accepted } = gapsOf(c);
  const ev = evidenceOf(c);
  const capName = (sid: string, cap: string) => (ev.find((s) => s.solutionId === sid)?.capabilities.find((x) => x.id === cap)?.name as string | undefined) ?? cap;
  const acceptedIds = new Set(accepted.map((a) => a.suggestionId));
  const runsNow = (capId: string) => !!c.supportedExecution?.capabilityIds.includes(capId);
  // Accepted suggestions are removed from librarySuggestions server-side; gap contributions come from acceptedSuggestions itself.
  const liveGapIds = new Set(accepted.filter((a) => (a.capabilityIds ?? []).some(runsNow)).flatMap((a) => a.gapIds ?? []));
  const adapterGapIds = new Set(accepted.flatMap((a) => a.gapIds ?? []).filter((g) => !liveGapIds.has(g)));
  const open = suggestions.filter((s) => !acceptedIds.has(s.id));
  const openGapIds = new Set(open.flatMap((s) => s.gapIds));
  const supplied = capabilityGaps.filter((g) => liveGapIds.has(g.id));
  const missing = capabilityGaps.filter((g) => !liveGapIds.has(g.id) && !openGapIds.has(g.id));
  const gapName = (id: string) => capabilityGaps.find((g) => g.id === id)?.need ?? id;
  if (!c.plan.flow.length && !suggestions.length && !capabilityGaps.length && !c.plan.integrationGaps.length) return null;

  const donorSteps = c.plan.flow.map((f) => ({ f, acc: accepted.find((a) => a.sourceSolutionId === f.sourceSolutionId && (!a.capabilityIds || a.capabilityIds.includes(f.capabilityId))) })).filter((x) => x.acc);
  if (!open.length && !missing.length && !supplied.length && !donorSteps.length && !c.plan.integrationGaps.length) return null;

  // One compact list of what is still open, each line with its one action. Detail sits behind the line itself.
  return (
    <div className="mt-3 grid gap-2" data-testid="panel-composition-gaps">
      <H>{`Gaps · ${missing.length + open.length + c.plan.integrationGaps.length} open`}</H>
      <ul className="space-y-1.5 text-[13.5px]">
        {open.map((s) => <SuggestionCard key={s.id} c={c} s={s} gapName={gapName} />)}
        {missing.map((g) => <li key={g.id} className="flex gap-2" data-testid={`gap-${g.id}`} title={g.reason}><CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-sienna" /><span><span className="font-medium">{g.need}</span> <span className="text-muted-foreground">· {adapterGapIds.has(g.id) ? "added donor not running yet" : "nothing in the Library covers this yet"}</span></span></li>)}
        {c.plan.integrationGaps.map((g, i) => <li key={`ig-${i}`} className="flex gap-2"><PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-sienna" /><span className="text-muted-foreground">{g}</span></li>)}
        {supplied.map((g) => <li key={g.id} className="flex gap-2" data-testid={`gap-supplied-${g.id}`}><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span><span className="font-medium">{g.need}</span> <span className="text-muted-foreground">· supplied by an added donor, check the result</span></span></li>)}
        {donorSteps.map(({ f, acc }) => { const live = runsNow(f.capabilityId); return (
          <li key={`d-${f.sourceSolutionId}:${f.capabilityId}`} className="flex flex-wrap items-center gap-1.5" data-testid={`tag-accepted-${f.capabilityId}`} title={acc?.suggestionReason}>
            <span className="font-medium">{capName(f.sourceSolutionId, f.capabilityId)}</span><span className="text-muted-foreground">from {names(f.sourceSolutionId)}</span>
            <Tag tone={live ? "sky" : "sienna"}>{live ? "Added · runs" : acc?.executable ? "Added · switched off" : "Added · proposed"}</Tag>
          </li>); })}
      </ul>
    </div>
  );
}

function SuggestionCard({ c, s, gapName }: { c: Composition; s: LibrarySuggestion; gapName: (id: string) => string }) {
  const qc = useQueryClient();
  const say = useUndoToast();
  const acceptM = useAcceptSuggestion();
  const undoM = useUndoComposition();
  const [err, setErr] = useState<{ status: number; msg: string } | null>(null);
  const sol = useGetSolution(s.sourceSolutionId, { query: { queryKey: getGetSolutionQueryKey(s.sourceSolutionId), staleTime: 60_000 } });
  const solName = sol.data?.solution.name;
  const capNames = s.capabilityIds.map((id) => sol.data?.capabilities.find((x) => x.id === id)?.name ?? (sol.isLoading ? null : id));
  const refresh = () => { void qc.invalidateQueries({ queryKey: compKeys.one(c.id) }); if (c.caseId) void qc.invalidateQueries({ queryKey: compKeys.forCase(c.caseId) }); };
  const accept = () => {
    setErr(null);
    acceptM.mutate({ id: c.id, suggestionId: s.id, expectedRevision: c.revision }, {
      onSuccess: (n) => {
        const ex = n.acceptedSuggestions?.find((a) => a.suggestionId === s.id)?.executable;
        say(`${solName ?? "Donor"} added to this plan${ex ? "" : " as proposed, not executed"} · rev ${n.revision}`, n.canUndo ? () => undoM.mutate({ id: c.id, expectedRevision: n.revision }, { onSuccess: () => say("Donor removed"), onError: (e) => { if (compStatus(e) === 409) refresh(); say(compMsg(e)); } }) : undefined);
      },
      onError: (e) => { const st = compStatus(e); if (st === 409) refresh(); setErr({ status: st, msg: compMsg(e) }); },
    });
  };
  return (
    <li className="rounded-lg bg-secondary/60 px-3 py-2" data-testid={`suggestion-${s.id}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Library className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1"><span className="font-medium">{s.gapIds.map(gapName).join("; ") || "Missing capability"}</span> <span className="text-muted-foreground">· {sol.isLoading ? "…" : <>{capNames.filter(Boolean).join(", ")} in <Link href={`/solutions/${s.sourceSolutionId}`} className="text-primary hover:underline">{solName ?? s.sourceSolutionId}</Link> v{s.version}</>}{s.compatibility === "supported" ? "" : " · needs an adapter"}</span></span>
        <button className={cn(btn.secondary, "min-h-8 px-3 text-[12.5px]")} disabled={acceptM.isPending || undoM.isPending} onClick={accept} data-testid={`button-use-suggestion-${s.id}`}>
          {acceptM.isPending ? "Adding…" : err ? <><RotateCcw className="h-3.5 w-3.5" /> Try again</> : "Use this capability"}
        </button>
      </div>
      <details className="mt-1 text-[12.5px] text-muted-foreground"><summary className="cursor-pointer">Why</summary><p className="mt-1">{s.reason} {s.compatibilityReason}</p></details>
      {err && <p role="alert" className="mt-1 text-[12.5px] text-siennaink" data-testid={`text-suggestion-error-${s.id}`}>{err.status === 409 ? "The plan changed. Latest loaded; try again." : err.msg}{err.status === 401 && <a href={loginHref()} className="ml-2 font-semibold underline">Sign in</a>}</p>}
    </li>
  );
}
