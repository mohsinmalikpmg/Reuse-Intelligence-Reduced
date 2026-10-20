import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CornerDownLeft, Sparkles, Users, Clock } from "lucide-react";
import { getListBriefsQueryKey, useCreateBrief, type CaseSummary, type Solution } from "@workspace/api-client-react";
import { CaseBadge, EvidenceBadge, Rise, SolutionBadge, Tag, btnPrimary } from "@/components/kit";
import { fmt, kind, recommendation } from "@/lib/labels";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function ProblemInput({ demoPrompt, large }: { demoPrompt?: string; large?: boolean }) {
  const [text, setText] = useState("");
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateBrief();
  const ok = text.trim().length >= 10;

  const submit = () => {
    if (!ok) return;
    create.mutate(
      { data: { text: text.trim() } },
      {
        onSuccess: (b) => {
          qc.invalidateQueries({ queryKey: getListBriefsQueryKey() });
          setLocation(`/discover/${b.id}`);
        },
        onError: () => toast({ title: "Could not interpret that", description: "Try again in a moment.", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="overflow-hidden rounded-lg border-2 border-foreground/85 bg-card shadow-[6px_6px_0_hsl(var(--primary))] focus-within:shadow-[6px_6px_0_hsl(var(--foreground))] transition-shadow">
      <div className="flex items-center justify-between border-b bg-muted/60 px-4 py-2">
        <span className="eyebrow">Describe the problem in plain language</span>
        {demoPrompt && (
          <button type="button" onClick={() => setText(demoPrompt)} data-testid="button-use-demo" className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wider text-primary hover:underline">
            <Sparkles className="h-3.5 w-3.5" /> Use demo example
          </button>
        )}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        data-testid="input-problem"
        placeholder="e.g. Our claims analysts spend 40 minutes per case pulling policy data from three systems before they can decide..."
        className={cn("block w-full resize-none bg-transparent px-4 py-3.5 leading-relaxed outline-none placeholder:text-muted-foreground/70", large ? "min-h-[150px] text-lg" : "min-h-[110px] text-base")}
      />
      <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5">
        <span className="hidden items-center gap-1.5 font-mono text-[11px] text-muted-foreground sm:flex">
          <CornerDownLeft className="h-3 w-3" /> Ctrl + Enter · we check every existing product before anything is built
        </span>
        <button onClick={submit} disabled={!ok || create.isPending} data-testid="button-submit-problem" className={btnPrimary}>
          {create.isPending ? "Reading your problem..." : "Find what already exists"}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function SolutionCard({ s, i = 0 }: { s: Solution; i?: number }) {
  const certified = s.status === "certified";
  return (
    <Rise i={i}>
      <Link
        href={`/library/${s.id}`}
        data-testid={`card-solution-${s.id}`}
        className={cn(
          "group relative flex h-full flex-col rounded-md border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-foreground/40",
          certified && "border-l-[3px] border-l-ok",
          s.status === "experimental" && "border-dashed",
        )}
      >
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <SolutionBadge status={s.status} />
          <Tag>{kind[s.kind]}</Tag>
        </div>
        <div className="font-display text-[17px] font-semibold leading-tight group-hover:text-primary">{s.name}</div>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{s.outcome}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
          {s.workflowSteps.map((w, k) => (
            <span key={w} className="flex items-center gap-1">
              {k > 0 && <span className="opacity-40">/</span>}
              {w}
            </span>
          ))}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-xs text-muted-foreground" style={{ marginTop: 14 }}>
          <span className="font-medium text-foreground">{s.ownerName}</span>
          <span className="flex items-center gap-1"><Users className="h-3 w-3" />{fmt(s.activeUsers)}</span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{s.timeToAdopt}</span>
          <EvidenceBadge level={s.evidenceLevel} />
        </div>
      </Link>
    </Rise>
  );
}

export function CaseRow({ c, i = 0, href }: { c: CaseSummary; i?: number; href?: string }) {
  const rec = c.experimentRecommendation ? recommendation[c.experimentRecommendation] : null;
  return (
    <Rise i={i}>
      <Link
        href={href ?? `/cases/${c.case.id}`}
        data-testid={`row-case-${c.case.id}`}
        className="group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-card px-4 py-3 transition-colors hover:border-foreground/40"
      >
        <div className="min-w-0 flex-1 basis-[16rem]">
          <div className="flex flex-wrap items-center gap-2">
            <CaseBadge status={c.case.status} />
            <span className="font-semibold group-hover:text-primary">{c.case.title}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {c.businessProblemTitle} · base <span className="text-foreground">{c.baseSolution.name}</span>
            {c.addedCapabilities.length > 0 && <> · +{c.addedCapabilities.length} capabilities</>}
          </div>
        </div>
        {rec && (
          <div className="flex shrink-0 items-center gap-2">
            <Tag tone={rec[1]}>{rec[0]}</Tag>
          </div>
        )}
        <div className="flex min-w-0 flex-1 basis-[12rem] items-center gap-2 text-xs text-muted-foreground md:max-w-[260px]">
          <span className="line-clamp-2">{c.nextStep}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
      </Link>
    </Rise>
  );
}
