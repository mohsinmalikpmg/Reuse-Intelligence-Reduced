import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Columns2, Users } from "lucide-react";
import type { SimilarExperiment, SimilarExperiments } from "@workspace/api-client-react";
import { Tag, btn } from "@/components/bits";
import { useCurrentCase } from "@/lib/case";
import { cn } from "@/lib/utils";

export function similarHeadline(s: SimilarExperiments): string {
  const n = (count: number, noun: string) => `${count === 1 ? "One" : count === 2 ? "Two" : count} other ${noun}${count === 1 ? "" : "s"}`;
  return s.teams > 1 ? `${n(s.teams, "team")} are testing a similar change` : s.count === 1 ? "One other team is testing a similar change" : `${n(s.count, "experiment")} test a similar change`;
}

function votesLine(e: SimilarExperiment): string {
  if (!e.votes || e.votes.tests === 0) return e.inputsTested > 0 ? `Run on ${e.inputsTested} input${e.inputsTested === 1 ? "" : "s"}, no votes yet` : "Not run yet";
  return `${e.votes.tests} vote${e.votes.tests === 1 ? "" : "s"} on the current configuration · ${e.votes.bPreferred} preferred the modified output${e.votes.demoVotes ? ` (${e.votes.demoVotes} demo)` : ""}`;
}

/**
 * Shown when someone saves or proposes an experiment that others are already pursuing on the same parent.
 * Nothing is rejected here: join, compare, or carry on separately.
 */
export function SimilarPrompt({ similar, mine, onContinue, continueLabel = "Continue separately" }: { similar: SimilarExperiments; mine: { changes: string[]; votes: string }; onContinue: () => void; continueLabel?: string }) {
  const [compare, setCompare] = useState(false);
  const [, setLocation] = useLocation();
  const { setCaseId } = useCurrentCase();
  const join = (e: SimilarExperiment) => { setCaseId(e.case.id); setLocation(`/workbench/${e.case.id}?mode=compare`); };
  return (
    <div className="space-y-3" data-testid="panel-similar">
      <div className="flex items-start gap-2">
        <Users className="mt-0.5 h-5 w-5 shrink-0 text-skyink" />
        <div>
          <div className="text-[16px] font-semibold text-primary" data-testid="text-similar-headline">{similarHeadline(similar)}</div>
          <p className="text-[13.5px] text-muted-foreground">Same parent product, same intent. You can join one of them, compare the approaches, or keep going on your own. Nothing is lost either way.</p>
        </div>
      </div>
      <ul className="space-y-1.5">
        {similar.experiments.map((e) => (
          <li key={e.case.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-[14px]" data-testid={`similar-${e.case.id}`}>
            <span className="font-medium">{e.case.ownerName}</span>
            <span className="text-muted-foreground">{e.case.ownerTeam}</span>
            {e.case.demo && <Tag>Demo</Tag>}
            {e.sameApproach && <Tag tone="sky">Same approach as yours</Tag>}
            <span className="flex-1" />
            <button data-testid={`button-join-${e.case.id}`} onClick={() => join(e)} className={cn(btn.quiet, "text-primary")}>Join existing experiment <ArrowRight className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
      {compare && (
        <div className="reveal grid gap-2 sm:grid-cols-2" data-testid="panel-compare-approaches">
          <ApproachCard title="Your experiment" changes={mine.changes} votes={mine.votes} highlight />
          {similar.experiments.map((e) => <ApproachCard key={e.case.id} title={`${e.case.ownerName}${e.case.demo ? " (demo)" : ""}`} changes={e.changes} votes={votesLine(e)} />)}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!compare && <button data-testid="button-compare-approaches" onClick={() => setCompare(true)} className={btn.secondary}><Columns2 className="h-4 w-4" /> Compare approaches</button>}
        <button data-testid="button-continue-separately" onClick={onContinue} className={compare ? btn.primary : btn.secondary}>{continueLabel}</button>
      </div>
    </div>
  );
}

function ApproachCard({ title, changes, votes, highlight }: { title: string; changes: string[]; votes: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-xl border p-3 text-[13.5px]", highlight ? "border-sienna/60 bg-accent/30" : "border-border bg-card")}>
      <div className="font-semibold text-primary">{title}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">{changes.length ? changes.map((c) => <li key={c}>{c}</li>) : <li>Identical to the parent version</li>}</ul>
      <div className="mt-2 text-[12.5px] text-muted-foreground">{votes}</div>
    </div>
  );
}
