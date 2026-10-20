import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, Check, ChevronDown, Clock, Columns3, ExternalLink, HelpCircle, Pencil, Users, X } from "lucide-react";
import {
  getGetBriefMatchesQueryKey,
  getGetBriefQueryKey,
  getListCasesQueryKey,
  getGetSeekerOverviewQueryKey,
  useCreateCase,
  useGetBrief,
  useGetBriefMatches,
  useUpdateBrief,
  useUpdateCase,
  type BriefFieldValues,
  type BriefFields,
  type SolutionMatch,
  type MatchResult,
} from "@workspace/api-client-react";
import { EvidenceBadge, ErrorState, Meter, Panel, Rise, Skel, SolutionBadge, Tag, btnGhost, btnPrimary, btnSecondary } from "@/components/kit";
import { usePersona, useRole } from "@/lib/persona";
import { fmt, kind } from "@/lib/labels";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const FIELDS: [keyof BriefFields, string][] = [
  ["user", "Who"],
  ["job", "Job to be done"],
  ["painPoint", "Pain point"],
  ["currentProcess", "Today"],
  ["desiredOutcome", "Desired outcome"],
  ["successMeasures", "Success looks like"],
  ["data", "Data involved"],
  ["constraints", "Constraints"],
  ["requiredControls", "Required controls"],
];

const SOURCE = { ai: "Interpreted by AI", cached: "Cached interpretation", fallback: "Rule-based interpretation" } as const;
const FIT_TONE = { strong: "ok", good: "ink", partial: "warn", weak: "bad" } as const;

export default function BriefPage() {
  const { briefId = "" } = useParams<{ briefId: string }>();
  const qc = useQueryClient();
  const { toast } = useToast();
  const brief = useGetBrief(briefId, { query: { enabled: !!briefId, queryKey: getGetBriefQueryKey(briefId) } });
  const matches = useGetBriefMatches(briefId, { query: { enabled: !!briefId, queryKey: getGetBriefMatchesQueryKey(briefId) } });
  const update = useUpdateBrief();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BriefFieldValues>({});
  const [clar, setClar] = useState("");

  const save = (data: Parameters<typeof update.mutate>[0]["data"], msg: string) =>
    update.mutate(
      { briefId, data },
      {
        onSuccess: (b) => {
          qc.setQueryData(getGetBriefQueryKey(briefId), b);
          qc.invalidateQueries({ queryKey: getGetBriefMatchesQueryKey(briefId) });
          toast({ title: msg });
        },
      },
    );

  if (brief.isError) return <ErrorState onRetry={() => brief.refetch()} message="We could not find that brief." />;
  const b = brief.data;

  return (
    <div className="grid gap-6 xl:grid-cols-[400px_1fr]">
      <aside className="xl:sticky xl:top-20 xl:self-start">
        {!b ? (
          <Skel className="h-[520px]" />
        ) : (
          <Rise>
            <section className="overflow-hidden rounded-md border-2 border-foreground/80 bg-card">
              <header className="flex items-center justify-between bg-foreground px-4 py-2.5 text-background">
                <span className="font-display text-sm font-bold">What I heard</span>
                <span className="font-mono text-[10px] uppercase tracking-wider opacity-70" data-testid="text-brief-source">{SOURCE[b.source]}</span>
              </header>
              <div className="border-b px-4 py-3 text-sm italic text-muted-foreground">"{b.rawText}"</div>
              <dl className="divide-y">
                {FIELDS.map(([k, label]) => {
                  const f = b.fields[k];
                  const low = f.confidence < 0.6;
                  return (
                    <div key={k} className="grid grid-cols-[110px_1fr] gap-2 px-4 py-2">
                      <dt className="pt-0.5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">{label}</dt>
                      <dd>
                        {editing ? (
                          <input
                            data-testid={`input-field-${k}`}
                            defaultValue={f.value}
                            onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                            className="w-full rounded border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
                          />
                        ) : (
                          <div className="flex items-start gap-2">
                            <span className={cn("flex-1 text-sm", low && "text-warn")}>{f.value || "Not stated"}</span>
                            <span title={`Confidence ${Math.round(f.confidence * 100)}%`} className="mt-1.5 flex gap-[2px]">
                              {[0.25, 0.5, 0.75, 1].map((t) => (
                                <span key={t} className={cn("h-2 w-1 rounded-[1px]", f.confidence >= t - 0.12 ? (low ? "bg-warn" : "bg-ok") : "bg-muted")} />
                              ))}
                            </span>
                          </div>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              {b.clarifyingQuestion && !b.clarification && (
                <div className="border-t bg-accent px-4 py-3">
                  <div className="mb-2 flex items-start gap-2 text-sm font-medium text-accent-foreground"><HelpCircle className="mt-0.5 h-4 w-4 shrink-0" />{b.clarifyingQuestion}</div>
                  <div className="flex gap-2">
                    <input value={clar} onChange={(e) => setClar(e.target.value)} data-testid="input-clarification" placeholder="Your answer" className="flex-1 rounded border bg-card px-2 py-1.5 text-sm outline-none focus:border-primary" />
                    <button disabled={!clar.trim()} onClick={() => save({ clarification: clar.trim() }, "Clarification added")} data-testid="button-add-clarification" className={btnSecondary}>Add</button>
                  </div>
                </div>
              )}
              {b.clarification && <div className="border-t px-4 py-2 text-xs"><span className="eyebrow mr-2">Clarified</span>{b.clarification}</div>}
              <footer className="flex items-center gap-2 border-t bg-muted/50 px-4 py-2.5">
                {editing ? (
                  <>
                    <button onClick={() => { save({ fields: draft }, "Fields updated"); setEditing(false); setDraft({}); }} data-testid="button-save-fields" className={btnSecondary}><Check className="h-3.5 w-3.5" /> Save fields</button>
                    <button onClick={() => { setEditing(false); setDraft({}); }} className={btnGhost}><X className="h-3.5 w-3.5" /> Cancel</button>
                  </>
                ) : (
                  <>
                    {b.confirmed ? (
                      <Tag tone="ok" icon={<Check className="h-3 w-3" />}>Confirmed</Tag>
                    ) : (
                      <button onClick={() => save({ confirmed: true }, "Interpretation confirmed")} data-testid="button-confirm-brief" className={btnSecondary}><Check className="h-3.5 w-3.5" /> Confirm</button>
                    )}
                    <button onClick={() => setEditing(true)} data-testid="button-edit-fields" className={btnGhost}><Pencil className="h-3.5 w-3.5" /> Edit fields</button>
                  </>
                )}
              </footer>
            </section>
            <div className="mt-3 rounded-md border-l-[3px] border-primary bg-accent px-4 py-3 text-sm font-medium text-accent-foreground" data-testid="text-value-statement">{b.valueStatement}</div>
          </Rise>
        )}
      </aside>
      <Results briefId={briefId} matches={matches} />
    </div>
  );
}

function Results({ briefId, matches }: { briefId: string; matches: UseQueryResult<MatchResult> }) {
  const [refine, setRefine] = useState(false);
  const [certifiedOnly, setCertifiedOnly] = useState(false);
  const [minFit, setMinFit] = useState(0);
  const [compare, setCompare] = useState(false);

  if (matches.isError) return <ErrorState onRetry={() => matches.refetch()} />;
  if (!matches.data)
    return (
      <div className="space-y-3">
        <Skel className="h-10 w-2/3" />
        <Skel className="h-64" />
        <Skel className="h-28" />
        <Skel className="h-28" />
      </div>
    );
  const m = matches.data;
  const top = m.matches.find((x) => x.recommended) ?? m.matches[0];
  const rest = m.matches.filter((x) => x !== top && (!certifiedOnly || x.solution.status === "certified") && x.fitScore >= minFit);

  return (
    <div>
      <div className="eyebrow mb-2">Ranked against {m.matches.length} existing products</div>
      <h2 className="mb-5 text-2xl font-bold leading-tight md:text-3xl" data-testid="text-match-headline">{m.headline}</h2>
      {top && <Recommended match={top} briefId={briefId} existingCaseId={m.existingCaseId} onCompare={() => setCompare(true)} />}

      {m.missingRequirements.length > 0 && (
        <div className="mt-4 rounded-md border border-warn/40 bg-warn/5 px-4 py-3 text-sm">
          <span className="eyebrow mr-2 !text-warn">Not covered by anything today</span>
          {m.missingRequirements.join(" · ")}
        </div>
      )}

      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold">Alternatives</h3>
        <div className="flex gap-1">
          <button onClick={() => setCompare((v) => !v)} data-testid="button-compare-alternatives" className={btnGhost}><Columns3 className="h-3.5 w-3.5" /> {compare ? "Hide comparison" : "Compare alternatives"}</button>
          <button onClick={() => setRefine((v) => !v)} data-testid="button-refine" className={btnGhost}>Refine results <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", refine && "rotate-180")} /></button>
        </div>
      </div>
      <AnimatePresence>
        {refine && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mb-3 flex flex-wrap items-center gap-4 rounded-md border bg-muted/40 px-4 py-3 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={certifiedOnly} onChange={(e) => setCertifiedOnly(e.target.checked)} data-testid="checkbox-certified-only" className="accent-[hsl(var(--primary))]" /> Certified only</label>
              <span className="flex items-center gap-2">Minimum fit
                {[0, 50, 70].map((v) => (
                  <button key={v} onClick={() => setMinFit(v)} data-testid={`button-minfit-${v}`} className={cn("rounded border px-2 py-0.5 font-mono text-xs", minFit === v ? "border-foreground bg-foreground text-background" : "bg-card")}>{v === 0 ? "Any" : `${v}+`}</button>
                ))}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {compare && (
        <Panel title="Fit breakdown" className="mb-3" pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2">Solution</th>
                  {["semantic", "workflow", "persona", "readiness", "evidence", "integration"].map((k) => <th key={k} className="px-2 py-2">{k}</th>)}
                  <th className="px-4 py-2 text-right">Fit</th>
                </tr>
              </thead>
              <tbody>
                {m.matches.map((x) => (
                  <tr key={x.solution.id} className={cn("border-b last:border-0", x.recommended && "bg-accent/60")}>
                    <td className="px-4 py-2 font-medium">{x.solution.name}</td>
                    {(["semantic", "workflow", "persona", "readiness", "evidence", "integration"] as const).map((k) => (
                      <td key={k} className="px-2 py-2"><div className="w-14"><Meter value={x.scoring[k]} tone={x.recommended ? "signal" : "ink"} /></div></td>
                    ))}
                    <td className="px-4 py-2 text-right font-mono font-semibold">{x.fitScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="space-y-2">
        {rest.length === 0 && <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No alternatives match these filters.</div>}
        {rest.map((x, i) => <Alternative key={x.solution.id} m={x} i={i} />)}
      </div>

      {m.capabilityMatches.length > 0 && (
        <>
          <h3 className="mb-3 mt-8 text-lg font-bold">Reusable capabilities that also fit</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {m.capabilityMatches.map((c, i) => (
              <Rise key={c.capability.id} i={i}>
                <div className="rounded-md border bg-card px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{c.capability.name}</span><span className="font-mono text-xs">{c.fitScore}</span></div>
                  <div className="text-xs text-muted-foreground">from {c.capability.sourceSolutionName} · {c.whyMatched[0]}</div>
                </div>
              </Rise>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Recommended({ match, briefId, existingCaseId, onCompare }: { match: SolutionMatch; briefId: string; existingCaseId: string | null; onCompare: () => void }) {
  const s = match.solution;
  const role = useRole();
  const { persona } = usePersona();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateCase();
  const updateCase = useUpdateCase();

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetBriefMatchesQueryKey(briefId) });
    qc.invalidateQueries({ queryKey: getGetSeekerOverviewQueryKey() });
  };
  const useBase = () =>
    create.mutate(
      { data: { baseSolutionId: s.id, briefId, createdByRole: persona?.role ?? role } },
      { onSuccess: (c) => { refresh(); setLocation(`/cases/${c.id}`); } },
    );
  const saveLater = () => {
    const mark = (caseId: string) =>
      updateCase.mutate({ caseId, data: { saved: true } }, { onSuccess: () => { refresh(); toast({ title: "Saved for later", description: "Find it under Saved cases." }); } });
    if (existingCaseId) mark(existingCaseId);
    else create.mutate({ data: { baseSolutionId: s.id, briefId, createdByRole: role } }, { onSuccess: (c) => mark(c.id) });
  };

  return (
    <Rise>
      <article className="relative overflow-hidden rounded-lg border-2 border-foreground bg-card shadow-[6px_6px_0_hsl(var(--primary))]" data-testid={`card-recommended-${s.id}`}>
        <div className="flex items-center justify-between bg-primary px-5 py-1.5 text-primary-foreground">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]">Recommended base solution</span>
          <span className="font-mono text-[11px]">Rank #{match.rank}</span>
        </div>
        <div className="grid gap-5 p-5 md:grid-cols-[1fr_150px]">
          <div>
            <div className="mb-2 flex flex-wrap gap-1.5"><SolutionBadge status={s.status} /><Tag>{kind[s.kind]}</Tag><EvidenceBadge level={s.evidenceLevel} /></div>
            <h3 className="text-2xl font-bold">{s.name}</h3>
            <p className="mt-1 text-muted-foreground">{s.outcome}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span><span className="text-muted-foreground">Owner </span>{s.ownerName}</span>
              <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5 text-muted-foreground" />{fmt(s.activeUsers)} users</span>
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-muted-foreground" />{s.timeToAdopt} to adopt</span>
            </div>
          </div>
          <div className="flex flex-row items-center gap-3 md:flex-col md:items-end md:justify-center">
            <div className="font-display text-6xl font-extrabold leading-none text-primary tabular-nums" data-testid="text-fit-score">{match.fitScore}</div>
            <Tag tone={FIT_TONE[match.fitLabel]}>{match.fitLabel} fit</Tag>
          </div>
        </div>
        <div className="grid gap-4 border-t px-5 py-4 md:grid-cols-2">
          <div>
            <div className="eyebrow mb-2 !text-ok">Why this matched</div>
            <ul className="space-y-1.5 text-sm">{match.whyMatched.map((w) => <li key={w} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />{w}</li>)}</ul>
          </div>
          <div>
            <div className="eyebrow mb-2 !text-warn">Gaps to close</div>
            <ul className="space-y-1.5 text-sm">{match.gaps.length === 0 ? <li className="text-muted-foreground">None identified</li> : match.gaps.map((g) => <li key={g} className="flex gap-2"><span className="mt-2 h-1 w-2 shrink-0 bg-warn" />{g}</li>)}</ul>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-5 py-3">
          {existingCaseId ? (
            <button onClick={() => setLocation(`/cases/${existingCaseId}`)} data-testid="button-open-existing-case" className={btnPrimary}>Open existing case</button>
          ) : (
            <button onClick={useBase} disabled={create.isPending} data-testid="button-use-as-base" className={btnPrimary}>{create.isPending ? "Starting case..." : "Use as base solution"}</button>
          )}
          <button onClick={onCompare} data-testid="button-compare" className={btnSecondary}><Columns3 className="h-3.5 w-3.5" /> Compare alternatives</button>
          <Link href={`/library/${s.id}`} data-testid="link-view-solution" className={btnSecondary}><ExternalLink className="h-3.5 w-3.5" /> View solution</Link>
          <button onClick={saveLater} disabled={updateCase.isPending || create.isPending} data-testid="button-save-later" className={btnGhost}><Bookmark className="h-3.5 w-3.5" /> Save for later</button>
        </div>
      </article>
    </Rise>
  );
}

function Alternative({ m, i }: { m: SolutionMatch; i: number }) {
  const [open, setOpen] = useState(false);
  const s = m.solution;
  return (
    <Rise i={i}>
      <div className={cn("rounded-md border bg-card", s.status === "certified" ? "border-l-[3px] border-l-ok" : s.status === "experimental" && "border-dashed")}>
        <button onClick={() => setOpen((v) => !v)} data-testid={`button-alt-${s.id}`} className="grid w-full grid-cols-[48px_1fr_auto] items-center gap-3 px-4 py-3 text-left">
          <span className="font-display text-2xl font-bold tabular-nums">{m.fitScore}</span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{s.name}</span><SolutionBadge status={s.status} /><Tag tone={FIT_TONE[m.fitLabel]}>{m.fitLabel}</Tag></span>
            <span className="block truncate text-xs text-muted-foreground">{s.ownerName} · {fmt(s.activeUsers)} users · {s.timeToAdopt}</span>
          </span>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="grid gap-4 border-t px-4 py-3 text-sm md:grid-cols-[1fr_1fr_auto]">
                <div><div className="eyebrow mb-1">Why this matched</div>{m.whyMatched.map((w) => <div key={w}>{w}</div>)}</div>
                <div><div className="eyebrow mb-1">Gaps</div>{m.gaps.map((g) => <div key={g} className="text-muted-foreground">{g}</div>)}</div>
                <Link href={`/library/${s.id}`} className="self-start text-sm font-medium text-primary hover:underline">View solution</Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Rise>
  );
}
