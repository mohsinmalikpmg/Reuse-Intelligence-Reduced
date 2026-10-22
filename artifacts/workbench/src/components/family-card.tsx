import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, ChevronDown, Eye, GitCompare } from "lucide-react";
import {
  getGetConfigurationPreviewQueryKey, useCreateCase, useGetConfigurationPreview,
  type ApprovedConfiguration, type FamilyCapability, type Solution, type SolutionFamily,
} from "@workspace/api-client-react";
import { DispositionBadge, ErrorView, Skel, StatusPill, Tag, btn, useUndoToast } from "@/components/bits";
import { OutputView, marksFrom } from "@/components/output-view";
import { MetaTags, OutputPreviewPanel, isLive } from "@/components/enterprise";
import { errMsg, useCurrentCase, useInvalidateAll } from "@/lib/case";
import { cn } from "@/lib/utils";

const COVERS_LIMIT = 6;
const CAPS_LIMIT = 4;

/** Creates a workbench case and lands on it with the input panel open, so the first thing to do is paste real input. */
export function useTry() {
  const [, setLocation] = useLocation();
  const { setCaseId } = useCurrentCase();
  const invalidate = useInvalidateAll();
  const say = useUndoToast();
  const create = useCreateCase();
  const go = (data: { baseSolutionId: string; approvedVersion?: string; moduleIds?: string[] }, mode: "input" | "compare" = "input") =>
    create.mutate({ data: { ...data, createdByRole: "seeker" } }, {
      onSuccess: (c) => { invalidate(); setCaseId(c.id); setLocation(`/workbench/${c.id}?mode=${mode}`); },
      onError: (e) => say(errMsg(e)),
    });
  return { go, busy: create.isPending };
}

export function FamilyCard({ family }: { family: SolutionFamily }) {
  const { businessProblem: bp, preferred: p } = family;
  const { go, busy } = useTry();
  const [allCovers, setAllCovers] = useState(false);
  const [allCaps, setAllCaps] = useState(false);
  const [preview, setPreview] = useState(false);
  const live = isLive(p);
  const covers = allCovers ? family.covers : family.covers.slice(0, COVERS_LIMIT);
  const caps = allCaps ? family.reusableCapabilities : family.reusableCapabilities.slice(0, CAPS_LIMIT);

  return (
    <article data-testid={`family-${bp.id}`} className="card-soft p-5 md:p-6">
      <header>
        <div className="eyebrow">{bp.businessFunction} · Business problem</div>
        <h2 className="mt-1 text-[22px] font-bold leading-tight" data-testid={`text-family-title-${bp.id}`}>{bp.title}</h2>
        <p className="mt-1 text-[14.5px] text-muted-foreground">{bp.description} <span className="text-foreground/80">Primary user: {bp.primaryUser}.</span></p>
      </header>

      {/* Preferred solution: the one answer to the problem, one dominant action */}
      <section className="mt-5 rounded-xl border border-ok/30 bg-okbg/30 p-4 md:p-5" data-testid={`preferred-${bp.id}`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone="green" testid={`tag-preferred-${p.id}`}>{p.disposition?.preferred ? "Preferred" : "Use this"}</Tag>
              <StatusPill status={p.status} />
              <span className="text-[13px] text-muted-foreground">v{p.currentVersion}</span>
            </div>
            <Link href={`/solutions/${p.id}`} data-testid={`link-preferred-${p.id}`} className="mt-2 block text-[20px] font-semibold leading-snug text-foreground hover:text-primary hover:underline">{p.name}</Link>
            <p className="mt-1 text-[15.5px] leading-snug" data-testid={`text-outcome-${p.id}`}>{p.outcome}</p>
            <p className="mt-2 text-[13.5px] text-muted-foreground" data-testid={`text-support-${p.id}`}>{family.support} · Owner {p.ownerName}{p.ownerTeam ? `, ${p.ownerTeam}` : ""}</p>
            <div className="mt-2.5"><MetaTags s={p} compact testid={`meta-${p.id}`} /></div>
            {family.covers.length > 0 && (
              <div className="mt-3">
                <div className="eyebrow mb-1.5">Covers</div>
                <div className="flex flex-wrap gap-1.5" data-testid={`covers-${p.id}`}>
                  {covers.map((c) => <Tag key={c.capabilityId} tone="slate">{c.name}</Tag>)}
                  {family.covers.length > COVERS_LIMIT && (
                    <button onClick={() => setAllCovers((v) => !v)} className="rounded-md px-2 py-0.5 text-[12.5px] font-semibold text-primary hover:bg-secondary" data-testid={`button-covers-more-${p.id}`}>
                      {allCovers ? "Show fewer" : `+${family.covers.length - COVERS_LIMIT} more`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            {live ? (
              <button data-testid={`button-try-${p.id}`} disabled={busy} onClick={() => go({ baseSolutionId: p.id })} className={btn.primary}>Try with my input <ArrowRight className="h-5 w-5" /></button>
            ) : (
              <button data-testid={`button-preview-${p.id}`} aria-expanded={preview} disabled={!p.outputPreview} onClick={() => setPreview((v) => !v)} className={btn.primary}><Eye className="h-5 w-5" /> {preview ? "Hide output preview" : "See output preview"}</button>
            )}
            <Link href={`/solutions/${p.id}`} className={cn(btn.quiet, "justify-center")} data-testid={`link-open-${p.id}`}>Open the solution</Link>
            {!live && <span className="max-w-[220px] text-right text-[12.5px] text-muted-foreground" data-testid={`text-preview-hint-${p.id}`}>Sample-data preview. Not yet wired to run on your input.</span>}
          </div>
        </div>
        {preview && p.outputPreview && <div className="reveal mt-4"><OutputPreviewPanel preview={p.outputPreview} s={p} testid={`output-preview-${p.id}`} /></div>}
      </section>

      {family.approvedConfigurations.length > 0 && (
        <section className="mt-5" data-testid={`configurations-${bp.id}`}>
          <div className="eyebrow">Approved configurations</div>
          <p className="mt-0.5 text-[13.5px] text-muted-foreground">What IT approved on top of the standard setup. Each preview runs the same sample through both.</p>
          <div className="mt-2 space-y-2">
            {family.approvedConfigurations.map((c) => <ConfigurationRow key={c.version} cfg={c} solution={p} />)}
          </div>
        </section>
      )}

      {family.reusableCapabilities.length > 0 && (
        <section className="mt-5" data-testid={`capabilities-${bp.id}`}>
          <div className="eyebrow">Reusable capabilities</div>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
            {caps.map((c) => <CapabilityRow key={c.capability.id} item={c} />)}
          </ul>
          {family.reusableCapabilities.length > CAPS_LIMIT && (
            <button onClick={() => setAllCaps((v) => !v)} className={cn(btn.quiet, "mt-1")} data-testid={`button-caps-more-${bp.id}`}>
              <ChevronDown className={cn("h-4 w-4 transition-transform", allCaps && "rotate-180")} /> {allCaps ? "Show fewer" : `Show all ${family.reusableCapabilities.length}`}
            </button>
          )}
        </section>
      )}

      {(family.consolidating.length > 0 || family.alternatives.length > 0) && (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {family.consolidating.length > 0 && (
            <section data-testid={`consolidating-${bp.id}`}>
              <div className="eyebrow">Being consolidated</div>
              <ul className="mt-2 space-y-1.5">{family.consolidating.map((s) => <ProductRow key={s.id} s={s} />)}</ul>
            </section>
          )}
          {family.alternatives.length > 0 && (
            <section data-testid={`alternatives-${bp.id}`}>
              <div className="eyebrow">Also addresses this problem</div>
              <ul className="mt-2 space-y-1.5">{family.alternatives.map((s) => <ProductRow key={s.id} s={s} />)}</ul>
            </section>
          )}
        </div>
      )}
    </article>
  );
}

function ProductRow({ s }: { s: Solution }) {
  return (
    <li>
      <Link href={`/solutions/${s.id}`} data-testid={`row-product-${s.id}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[14px] hover:border-primary/40">
        <span className="font-semibold">{s.name}</span>
        <StatusPill status={s.status} />
        <DispositionBadge disposition={s.disposition} solutionId={s.id} />
        <span className="ml-auto text-[13px] text-muted-foreground">{s.ownerName} · v{s.currentVersion}</span>
      </Link>
    </li>
  );
}

export function CapabilityRow({ item, compact }: { item: FamilyCapability; compact?: boolean }) {
  const { go, busy } = useTry();
  const c = item.capability;
  const elsewhere = item.usedIn.filter((u) => u.solutionId !== item.sourceSolutionId);
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4" data-testid={`row-capability-${c.id}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/solutions/${item.sourceSolutionId}`} className="text-[15px] font-semibold text-foreground hover:text-primary hover:underline">{c.name}</Link>
          {item.includedInPreferred && <Tag tone="green" testid={`tag-included-${c.id}`}>Already in the preferred solution</Tag>}
        </div>
        {!compact && <p className="text-[13.5px] text-muted-foreground">{c.description}</p>}
        <p className="mt-0.5 text-[12.5px] text-muted-foreground" data-testid={`text-capability-source-${c.id}`}>
          From {item.sourceSolutionName}{compact && item.familyTitle ? ` · ${item.familyTitle}` : ""}
          {elsewhere.length > 0 && <> · also used in {elsewhere.map((u) => `${u.solutionName} v${u.version}`).join(", ")}</>}
        </p>
      </div>
      {item.tryIn && (
        <button data-testid={`button-try-capability-${c.id}`} disabled={busy} onClick={() => go({ baseSolutionId: item.tryIn!.solutionId, moduleIds: [c.id] }, "compare")} className={btn.secondary}>
          Try in {item.tryIn.solutionName} <ArrowRight className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

function ConfigurationRow({ cfg, solution }: { cfg: ApprovedConfiguration; solution: Solution }) {
  const [open, setOpen] = useState(false);
  const { go, busy } = useTry();
  return (
    <div className="rounded-xl border border-border bg-card" data-testid={`configuration-${solution.id}-${cfg.version}`}>
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15.5px] font-semibold">{cfg.title}</span>
            <Tag tone="slate">v{cfg.version}</Tag>
            <span className="text-[12.5px] text-muted-foreground">compared with standard v{cfg.baseVersion}</span>
          </div>
          <ul className="mt-1 text-[13.5px] text-muted-foreground">{cfg.changes.map((ch, i) => <li key={i}>{ch}</li>)}</ul>
        </div>
        <button data-testid={`button-preview-${solution.id}-${cfg.version}`} aria-expanded={open} onClick={() => setOpen((v) => !v)} className={btn.secondary}>
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} /> {open ? "Hide output preview" : "Show output preview"}
        </button>
      </div>
      {open && <PreviewPane cfg={cfg} solution={solution} onTry={() => go({ baseSolutionId: solution.id, approvedVersion: cfg.version })} busy={busy} />}
    </div>
  );
}

function PreviewPane({ cfg, solution, onTry, busy }: { cfg: ApprovedConfiguration; solution: Solution; onTry: () => void; busy: boolean }) {
  const q = useGetConfigurationPreview(solution.id, cfg.version, { query: { queryKey: getGetConfigurationPreviewQueryKey(solution.id, cfg.version), staleTime: 5 * 60_000 } });
  if (q.isLoading) return <div className="grid gap-3 border-t border-border p-4 md:grid-cols-2"><Skel className="h-48" /><Skel className="h-48" /></div>;
  if (q.isError || !q.data) return <div className="border-t border-border p-4"><ErrorView onRetry={() => q.refetch()} message="The preview could not be produced." /></div>;
  const p = q.data;
  const marks = marksFrom(p.diff.entries);
  const changed = p.diff.added + p.diff.removed + p.diff.changed;
  return (
    <div className="reveal border-t border-border p-4" data-testid={`preview-${solution.id}-${cfg.version}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-muted-foreground">
        <span>Sample input: <span className="font-medium text-foreground" data-testid="text-preview-input">{p.sampleInput.name}</span></span>
        <span>·</span>
        <span data-testid="text-preview-diff-count">{changed === 0 ? "Same output on this input" : `${changed} line${changed === 1 ? "" : "s"} differ, ${p.diff.unchanged} the same`}</span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="card-soft p-4" data-testid="preview-panel-a">
          <div className="mb-3 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground">A</span><span className="text-[14px] font-semibold">Standard · v{cfg.baseVersion}</span></div>
          <OutputView output={p.standard.output} marks={marks} testid="preview-output-a" />
        </div>
        <div className="card-soft border-t-4 border-t-sienna p-4" data-testid="preview-panel-b">
          <div className="mb-3 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-md bg-siennaink text-[13px] font-bold text-white">B</span><span className="text-[14px] font-semibold">{cfg.title} · v{cfg.version}</span></div>
          <OutputView output={p.variant.output} marks={marks} testid="preview-output-b" />
        </div>
      </div>
      {p.explanation.length > 0 && <ul className="mt-3 space-y-0.5 text-[13.5px] text-muted-foreground" data-testid="text-preview-explanation">{p.explanation.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button data-testid={`button-try-both-${solution.id}-${cfg.version}`} disabled={busy} onClick={onTry} className={btn.primary}><GitCompare className="h-5 w-5" /> Try both with my input</button>
        <span className="text-[13px] text-muted-foreground">Opens a workbench case with A = standard v{cfg.baseVersion} and B = v{cfg.version}.</span>
      </div>
    </div>
  );
}
