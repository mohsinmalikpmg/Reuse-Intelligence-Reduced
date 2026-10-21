import { Link, useLocation } from "wouter";
import { FlaskConical, GitCompare, Workflow } from "lucide-react";
import { useCreateCase, useGetMySolutions, type ImprovementGroup } from "@workspace/api-client-react";
import { Empty, ErrorView, Headline, Page, Skel, StatusPill, Tag, btn, useUndoToast } from "@/components/bits";
import { errMsg, useCurrentCase, useMe } from "@/lib/case";
import { cn } from "@/lib/utils";

export default function MySolutions() {
  const q = useGetMySolutions();
  const me = useMe();
  const create = useCreateCase();
  const { setCaseId } = useCurrentCase();
  const [, setLocation] = useLocation();
  const say = useUndoToast();
  if (q.isLoading) return <LoadingList />;
  if (q.isError || !q.data) return <ErrorView onRetry={() => q.refetch()} message="Your solutions could not load." />;
  const test = (id: string) => create.mutate({ data: { baseSolutionId: id, createdByRole: "owner" } }, { onSuccess: (c) => { setCaseId(c.id); setLocation(`/workbench/${c.id}?mode=edit`); }, onError: (e) => say(errMsg(e)) });
  return (
    <Page>
      <Headline stage="converge" title="Review the evidence." accent="Keep what works." sub={<>{me ? `${me.name} · ${me.team}. ` : ""}Your products, the improvements people are testing on them, and the evidence behind each one.</>} />
      {q.data.length === 0 ? <Empty title="You do not own any solutions yet" sub="Switch to the Own role to see the demo owner's products." /> : (
        <div className="space-y-5">
          {q.data.map((o) => (
            <article key={o.solution.id} data-testid={`card-owned-${o.solution.id}`} className="card-soft p-6">
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="text-[20px] font-semibold">{o.solution.name}</h2><StatusPill status={o.solution.status} /><span className="text-[13px] text-muted-foreground">v{o.solution.currentVersion}</span></div>
                  <p className="mt-1 text-[14.5px] text-muted-foreground">{o.solution.outcome}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/solutions/${o.solution.id}`} data-testid={`link-open-workflow-${o.solution.id}`} className={btn.secondary}><Workflow className="h-4 w-4" /> Open workflow</Link>
                  <button data-testid={`button-test-change-${o.solution.id}`} disabled={create.isPending} onClick={() => test(o.solution.id)} className={btn.secondary}><FlaskConical className="h-4 w-4" /> Test a change</button>
                </div>
              </div>
              <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13.5px]">
                {[["Experiments in progress", o.experimentsInProgress, "experiments"], ["Open tests", o.openTests, "open-tests"], ["Preference votes", o.evaluations, "evaluations"], ["Runs, last 30 days", o.recentRuns, "recent-runs"]].map(([l, v, k]) => (
                  <div key={k} className="flex items-baseline gap-1.5"><dd data-testid={`text-${k}-${o.solution.id}`} className="text-[18px] font-bold text-primary">{v}</dd><dt className="text-muted-foreground">{l}</dt></div>
                ))}
              </dl>
              {o.evaluationsSetAside > 0 && <p className="mt-1 text-[12.5px] text-muted-foreground" data-testid={`text-set-aside-${o.solution.id}`}>Preference votes count the current configuration of each experiment; {o.evaluationsSetAside} vote{o.evaluationsSetAside === 1 ? "" : "s"} from earlier configurations (set aside).</p>}
              {o.groups.length > 0 && <div className="mt-4 space-y-2 border-t border-border pt-4">{o.groups.map((g) => <GroupRow key={g.key} g={g} />)}</div>}
            </article>
          ))}
        </div>
      )}
    </Page>
  );
}

export function groupSentence(g: ImprovementGroup): string {
  const n = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const parts = [`${n(g.experiments.length, "related experiment")}`, n(g.teams, "team"), n(g.completedTests, "completed test")];
  if (g.preferredModifiedPercent !== null) parts.push(`${g.preferredModifiedPercent}% preferred the modified output`);
  parts.push(g.approaches === 1 ? "1 implementation approach" : `${g.approaches} implementation approaches`);
  return parts.join(" · ");
}

function GroupRow({ g }: { g: ImprovementGroup }) {
  const demo = g.experiments.filter((e) => e.case.demo).length;
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border border-border p-3", g.pendingReview && "border-sienna/50")} data-testid={`group-${g.key}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-primary" data-testid={`text-group-intent-${g.key}`}>{g.intent}</span>
          {g.pendingReview && <Tag tone="sienna">Awaiting your review</Tag>}
          {demo > 0 && <Tag>{demo} demo</Tag>}
        </div>
        <div className="text-[13px] text-muted-foreground" data-testid={`text-group-summary-${g.key}`}>{groupSentence(g)}</div>
      </div>
      <Link href={`/my-solutions/${g.solutionId}/improvements/${g.key}`} data-testid={`link-review-group-${g.key}`} className={cn(g.pendingReview ? btn.primary : btn.secondary, "min-h-10 px-4 text-[14px]")}><GitCompare className="h-4 w-4" /> Review shared improvement</Link>
    </div>
  );
}

function LoadingList() {
  return <Page><Skel className="mb-6 h-10 w-64" /><div className="space-y-4"><Skel className="h-44" /><Skel className="h-44" /></div></Page>;
}
