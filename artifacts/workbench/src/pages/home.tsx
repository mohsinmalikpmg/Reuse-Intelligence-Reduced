import { Link } from "wouter";
import { ArrowRight, FileText, FolderOpen, GitPullRequest, FlaskConical } from "lucide-react";
import { useGetDemoState, useGetOwnerOverview, useGetSeekerOverview } from "@workspace/api-client-react";
import { useRole } from "@/lib/persona";
import { CaseRow, ProblemInput, SolutionCard } from "@/components/blocks";
import { EmptyState, ErrorState, LoadingRows, PageHeader, Panel, Rise, SolutionBadge, Stat, Tag, Skel } from "@/components/kit";
import { date, recommendation } from "@/lib/labels";
import Portfolio from "@/pages/portfolio";

export default function Home() {
  const role = useRole();
  if (role === "owner") return <OwnerHome />;
  if (role === "it") return <Portfolio />;
  return <SeekerHome />;
}

function SeekerHome() {
  const ov = useGetSeekerOverview();
  const demo = useGetDemoState();
  const prompt = ov.data?.demoPrompt ?? demo.data?.demoPrompt;
  return (
    <div>
      <div className="mx-auto max-w-3xl pb-10 pt-4 md:pt-10">
        <div className="eyebrow mb-3 !text-primary">Discover · step 1 of 3</div>
        <h1 className="mb-6 text-4xl font-extrabold leading-[1] md:text-[56px]">
          Tell us the problem.
          <br />
          <span className="text-muted-foreground">We will show what already exists.</span>
        </h1>
        <ProblemInput demoPrompt={prompt} large />
        {demo.data && (
          <div className="mt-3 font-mono text-[11px] text-muted-foreground">
            Interpretation engine: {demo.data.aiAvailable ? "AI with rule-based backup" : "Rule-based (AI offline)"}
          </div>
        )}
      </div>
      {ov.isError && <ErrorState onRetry={() => ov.refetch()} />}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-xl font-bold">Recommended certified solutions</h2>
            <Link href="/library" className="text-sm font-medium text-primary hover:underline" data-testid="link-library">Full library</Link>
          </div>
          {ov.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skel key={i} className="h-44" />)}</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {ov.data?.recommendedSolutions.map((s, i) => <SolutionCard key={s.id} s={s} i={i} />)}
            </div>
          )}
        </div>
        <div className="space-y-4">
          <Panel title="Saved cases" pad={false}>
            <div className="space-y-2 p-3">
              {ov.isLoading && <LoadingRows rows={2} />}
              {ov.data?.savedCases.length === 0 && <EmptyState icon={<FolderOpen className="h-5 w-5" />} title="Nothing saved yet" body="Cases you save for later land here." />}
              {ov.data?.savedCases.map((c, i) => <CaseRow key={c.case.id} c={c} i={i} />)}
            </div>
          </Panel>
          <Panel title="Recent briefs" pad={false}>
            {ov.isLoading && <div className="p-3"><LoadingRows rows={3} /></div>}
            {ov.data?.recentBriefs.length === 0 && <div className="p-4 text-sm text-muted-foreground">No briefs yet.</div>}
            <ul className="divide-y">
              {ov.data?.recentBriefs.slice(0, 6).map((b) => (
                <li key={b.id}>
                  <Link href={`/discover/${b.id}`} data-testid={`link-brief-${b.id}`} className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-muted/60">
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-sm">{b.rawText}</span>
                      <span className="font-mono text-[10.5px] text-muted-foreground">{date(b.createdAt)}{b.confirmed ? " · confirmed" : ""}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function OwnerHome() {
  const ov = useGetOwnerOverview();
  if (ov.isError) return <ErrorState onRetry={() => ov.refetch()} />;
  const d = ov.data;
  return (
    <div>
      <PageHeader eyebrow={d ? `Owner view · ${d.ownerName}` : "Owner view"} title={<>See what changes <span className="text-primary">before your users do.</span></>} sub={d?.headline} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {ov.isLoading ? [0, 1, 2, 3].map((i) => <Skel key={i} className="h-20" />) : d && (
          <>
            <Stat label="My solutions" value={d.mySolutions.length} />
            <Stat label="Proposed changes" value={d.proposedChanges.length} accent={d.proposedChanges.length > 0} />
            <Stat label="Pending experiments" value={d.pendingExperiments.length} />
            <Stat label="Versions to review" value={d.versionsRequiringReview.length} />
          </>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Panel title="My solutions" pad={false}>
            {ov.isLoading && <div className="p-3"><LoadingRows rows={3} /></div>}
            <ul className="divide-y">
              {d?.mySolutions.map((o, i) => (
                <Rise key={o.solution.id} i={i}>
                  <li>
                    <Link href={`/library/${o.solution.id}`} data-testid={`link-my-solution-${o.solution.id}`} className="grid gap-2 px-4 py-3 hover:bg-muted/50 md:grid-cols-[1fr_auto]">
                      <div>
                        <div className="flex items-center gap-2"><SolutionBadge status={o.solution.status} /><span className="font-semibold">{o.solution.name}</span><span className="font-mono text-[11px] text-muted-foreground">v{o.solution.currentVersion}</span></div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{o.solution.outcome}</div>
                        {o.proposedDecision && <div className="mt-1 text-xs font-medium text-primary">{o.proposedDecision}</div>}
                      </div>
                      <div className="flex gap-4 font-mono text-xs">
                        <span><b className="text-base">{o.pendingChanges}</b> changes</span>
                        <span><b className="text-base">{o.openExperiments}</b> tests</span>
                        <span><b className="text-base">{o.sharedCapabilityCount}</b> shared</span>
                      </div>
                    </Link>
                  </li>
                </Rise>
              ))}
            </ul>
          </Panel>
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><GitPullRequest className="h-4 w-4 text-primary" /> Proposed capability changes</h2>
            <div className="space-y-2">
              {d?.proposedChanges.length === 0 && <EmptyState title="No changes proposed" body="When a seeker proposes a pilot on your product, it appears here." />}
              {d?.proposedChanges.map((c, i) => <CaseRow key={c.case.id} c={c} i={i} href={`/cases/${c.case.id}/review`} />)}
            </div>
          </section>
        </div>
        <div className="space-y-6">
          <Panel title="Pending experiment decisions" pad={false}>
            {d?.pendingExperiments.length === 0 && <div className="p-4 text-sm text-muted-foreground">No simulations waiting.</div>}
            <ul className="divide-y">
              {d?.pendingExperiments.map((e) => {
                const r = recommendation[e.recommendation];
                return (
                  <li key={e.id}>
                    <Link href={`/cases/${e.caseId}?tab=test`} data-testid={`link-experiment-${e.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                      <FlaskConical className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{e.challengerName}</span>
                        <span className="block text-xs text-muted-foreground">vs {e.baselineName}</span>
                      </span>
                      <Tag tone={r[1]}>{r[0]}</Tag>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
          <section>
            <h2 className="mb-3 text-lg font-bold">Versions requiring review</h2>
            <div className="space-y-2">
              {d?.versionsRequiringReview.length === 0 && <EmptyState title="All versions reviewed" />}
              {d?.versionsRequiringReview.map((c, i) => <CaseRow key={c.case.id} c={c} i={i} href={`/cases/${c.case.id}/review`} />)}
            </div>
            <Link href="/cases" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">All change requests <ArrowRight className="h-3.5 w-3.5" /></Link>
          </section>
        </div>
      </div>
    </div>
  );
}
