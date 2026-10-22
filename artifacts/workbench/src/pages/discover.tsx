import { useEffect, useMemo, useState } from "react";
import { useRememberConfirmedBrief } from "@/lib/composition";
import { Link, useLocation, useSearch } from "wouter";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from "@dnd-kit/core";
import { ArrowRight, Check, CornerDownLeft, GripVertical, Pencil, Plus, Sparkles, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetBriefQueryKey, getGetBriefMatchesQueryKey, getGetCodeAssessmentQueryKey, useCreateBrief, useGetBrief, useGetBriefMatches, useGetDemoState, useUpdateBrief,
  type Brief, type BriefFieldValues, type SolutionMatch,
} from "@workspace/api-client-react";
import { Textarea } from "@/components/ui/textarea";
import { Page, Skel, StatusPill, Tag, btn, useUndoToast, Headline } from "@/components/bits";
import { errMsg } from "@/lib/case";
import { CoverageTable, RequirementChips } from "@/components/reuse-check";
import { MetaTags, isLive } from "@/components/enterprise";
import { PrototypeIntake } from "@/components/prototype-intake";
import { cn } from "@/lib/utils";
import { CodeAssessment } from "@/components/code-assessment";

const dropUnderPointer: CollisionDetection = (args) => { const hits = pointerWithin(args); return hits.length ? hits : rectIntersection(args); };
const FIELD_LABEL: Record<keyof BriefFieldValues, string> = {
  user: "Who", job: "Job", currentProcess: "Today's process", painPoint: "Pain", desiredOutcome: "Outcome", constraints: "Constraint",
  data: "Data", requiredControls: "Control", successMeasures: "Success measure",
};
type Card = "today" | "better";

export default function Discover() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const briefId = params.get("brief") ?? "";
  const showResults = params.get("results") === "1";
  const prototypeMode = !briefId && params.get("mode") === "prototype";
  const demo = useGetDemoState();
  const create = useCreateBrief();
  const [text, setText] = useState("");
  const say = useUndoToast();
  // A confirmed intake becomes the context for Build from selected solutions in the library.
  useRememberConfirmedBrief(briefId);

  const submit = () => {
    if (create.isPending) return;
    if (text.trim().length < 10) { say("Add a little more detail, at least a sentence."); return; }
    create.mutate({ data: { text: text.trim() } }, { onSuccess: (b) => setLocation(`/discover?brief=${b.id}`), onError: (e) => say(errMsg(e)) });
  };

  if (briefId && showResults) {
    return <Page className="max-w-[1000px] md:pt-14">
      <Link href="/discover" className="mb-4 inline-flex text-sm font-semibold text-primary underline-offset-2 hover:underline" data-testid="link-back-to-intake">← Back to intake</Link>
      <Headline stage="trace" size="lg" title="Reuse what exists." accent="Build what’s missing." className="mb-0"
        sub="Your validated priorities, assessed against the indexed demo code: a starting solution, reusable elements and the gaps that remain." />
      <Results briefId={briefId} />
    </Page>;
  }

  if (prototypeMode) {
    return (
      <Page className="max-w-[1000px] md:pt-14">
        <Headline stage="trace" size="lg" title="Bring what you" accent="built." className="mb-0"
          sub="Already have a prototype? Describe it and paste one worked example. We check whether the library already does it, run the same example through the existing product, and say where it fits." />
        <p className="mt-3 text-[14px] text-muted-foreground" data-testid="text-prototype-framing">
          Starting from a problem instead? <Link href="/discover" className="font-semibold text-primary underline-offset-2 hover:underline" data-testid="link-back-to-problem">Describe the problem</Link>.
        </p>
        <PrototypeIntake key={params.get("again") ?? ""} />
      </Page>
    );
  }

  return (
    <Page className="max-w-[1000px] md:pt-14">
      <Link href="/discover" className="mb-4 inline-flex text-sm font-semibold text-primary underline-offset-2 hover:underline" data-testid="link-back-to-intake">← Back to intake</Link>
      <Headline stage="trace" size="lg" title="Follow the" accent="current." className="mb-0"
        sub="What are you trying to solve? Describe it the way you would to a colleague. We look for something that already exists before anything new is built." />
      <p className="mt-3 text-[14px] text-muted-foreground" data-testid="text-enterprise-framing">
        The library spans Operations, Finance, Investor relations, ESG &amp; Regulatory, Supply chain &amp; Planning, Commercial &amp; Legal and Corporate &amp; Executive.
        Work Order Intelligence is one example of the model, the one wired to run on real input in this demo. <Link href="/library" className="font-semibold text-primary underline-offset-2 hover:underline" data-testid="link-framing-library">See the whole library</Link>.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="card-soft mt-7 p-2 focus-within:border-primary/50 focus-within:shadow-md">
        <Textarea
          data-testid="input-problem"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="We spend too much time reviewing maintenance work orders to identify recurring equipment problems."
          className="min-h-[96px] resize-none border-0 text-[17px] shadow-none focus-visible:ring-0"
        />
        <div className="flex flex-wrap items-center gap-2 px-2 pb-1">
          {demo.data?.demoPrompt && !text && (
            <button type="button" data-testid="button-demo-prompt" onClick={() => setText(demo.data!.demoPrompt)} className={btn.quiet}>
              <Sparkles className="h-4 w-4 text-siennaink" /> Use the live example: maintenance work orders
            </button>
          )}
          <span className="ml-auto hidden items-center gap-1 text-[12.5px] text-muted-foreground sm:inline-flex"><CornerDownLeft className="h-3.5 w-3.5" /> Enter</span>
          <button type="submit" data-testid="button-submit-problem" disabled={create.isPending} className={btn.primary}>
            {create.isPending ? "Requesting AI analysis..." : create.isError ? "Retry AI analysis" : "Find solutions"} <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      </form>
      <p className="mt-3 text-sm text-muted-foreground" role="status">Your description is sent to the AI provider to extract an evidence-grounded brief. No brief is saved if analysis fails.</p>
      {create.isError && <p className="mt-3 text-sm text-destructive" role="alert">{errMsg(create.error)} Your description is still here. Retry when ready.</p>}
      {!briefId && (
        <p className="mt-4 text-[14px] text-muted-foreground" data-testid="text-prototype-entrance">
          Already built something? <Link href="/discover?mode=prototype" className="font-semibold text-primary underline-offset-2 hover:underline" data-testid="link-have-prototype">I have a prototype</Link>. We check it against the library before anyone builds it again.
        </p>
      )}
      {briefId && <Understanding briefId={briefId} showResults={showResults} onFind={() => setLocation(`/discover?brief=${briefId}&results=1`)} />}
    </Page>
  );
}

function Understanding({ briefId, showResults, onFind }: { briefId: string; showResults: boolean; onFind: () => void }) {
  const q = useGetBrief(briefId, { query: { enabled: !!briefId, queryKey: getGetBriefQueryKey(briefId) } });
  const upd = useUpdateBrief();
  const qc = useQueryClient();
  const say = useUndoToast();
  const [picked, setPicked] = useState<keyof BriefFieldValues | null>(null);
  const [dragging, setDragging] = useState<keyof BriefFieldValues | null>(null);
  const [extra, setExtra] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const b = q.data;

  const chips = useMemo(() => {
    if (!b) return [] as { key: keyof BriefFieldValues; value: string }[];
    return (Object.keys(FIELD_LABEL) as (keyof BriefFieldValues)[]).map((k) => ({ key: k, value: b.fields[k]?.value ?? "" })).filter((c) => c.value.trim());
  }, [b]);

  const patch = (data: Parameters<typeof upd.mutate>[0]["data"], msg: string, undo?: () => void) =>
    upd.mutate({ briefId, data }, {
      onSuccess: (nb: Brief) => { qc.setQueryData(getGetBriefQueryKey(briefId), nb); qc.invalidateQueries({ queryKey: getGetBriefMatchesQueryKey(briefId) }); qc.invalidateQueries({ queryKey: getGetCodeAssessmentQueryKey(briefId) }); say(msg, undo); },
      onError: (e) => say(errMsg(e)),
    });

  const addTo = (card: Card, key: keyof BriefFieldValues) => {
    if (!b) return;
    const v = chips.find((c) => c.key === key)?.value; if (!v) return;
    const before = b[card];
    patch({ [card]: `${before.replace(/\.?\s*$/, ".")} ${v}` }, `Added to ${card === "today" ? "Today" : "Better"}`, () => patch({ [card]: before }, "Undone"));
    setPicked(null);
  };
  const removeChip = (key: keyof BriefFieldValues) => {
    if (!b) return;
    const before = b.fields[key].value;
    patch({ fields: { [key]: "" } }, `Removed "${FIELD_LABEL[key]}"`, () => patch({ fields: { [key]: before } }, "Undone"));
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const key = String(e.active.id).replace("chip:", "") as keyof BriefFieldValues;
    const over = e.over ? String(e.over.id) : "";
    if (over === "card:today" || over === "card:better") addTo(over.slice(5) as Card, key);
  };

  if (q.isLoading) return <div className="mt-8 grid gap-4 md:grid-cols-2"><Skel className="h-36" /><Skel className="h-36" /></div>;
  if (!b) return <p className="mt-8 text-muted-foreground">We could not read that description. Try again.</p>;

  return (
    <div className="reveal mt-10">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[20px] font-semibold">Here is what we understood</h2>
        <Tag testid="tag-brief-source">{b.source === "ai" ? "Saved AI reading" : b.source === "cached" ? "Saved prior reading" : "Legacy rule-based reading"}</Tag>
      </div>
      <p className="mb-4 text-sm text-muted-foreground" data-testid="brief-analysis-status">Saved {new Date(b.createdAt).toLocaleString()}. Loading this brief does not make a new provider request; your corrections are preserved.</p>
      <DndContext sensors={sensors} collisionDetection={dropUnderPointer} onDragStart={(e) => setDragging(String(e.active.id).replace("chip:", "") as keyof BriefFieldValues)} onDragCancel={() => setDragging(null)} onDragEnd={onDragEnd}>
        <div className="grid gap-4 md:grid-cols-2">
          <EditCard id="today" label="Today" hint="What is happening now" value={b.today} picked={picked} dragging={!!dragging} busy={upd.isPending}
            onSave={(v) => v !== b.today && patch({ today: v }, "Today updated", () => patch({ today: b.today }, "Undone"))} onAddPicked={() => picked && addTo("today", picked)} />
          <EditCard id="better" label="Better" hint="The outcome you want" value={b.better} picked={picked} dragging={!!dragging} busy={upd.isPending}
            onSave={(v) => v !== b.better && patch({ better: v }, "Better updated", () => patch({ better: b.better }, "Undone"))} onAddPicked={() => picked && addTo("better", picked)} />
        </div>
        <div className="mt-4">
          <div className="mb-2 text-[13.5px] text-muted-foreground">Supporting details. Drag one onto a card, or select it and press "Add here". Remove anything that is wrong.</div>
          <div className="flex flex-wrap gap-2" data-testid="list-chips">
            {chips.map((c) => <Chip key={c.key} k={c.key} value={c.value} picked={picked === c.key} onPick={() => setPicked(picked === c.key ? null : c.key)} onRemove={() => removeChip(c.key)} />)}
            <form onSubmit={(e) => { e.preventDefault(); if (extra.trim()) { patch({ clarification: extra.trim() }, "Detail added"); setExtra(""); } }} className="flex items-center gap-1 rounded-full border border-dashed border-input bg-card pl-3 pr-1">
              <input data-testid="input-add-detail" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Add something we missed" className="h-8 w-48 bg-transparent text-[13.5px] outline-none" />
              <button data-testid="button-add-detail" aria-label="Add detail" className="grid h-7 w-7 place-items-center rounded-full text-primary hover:bg-secondary"><Plus className="h-4 w-4" /></button>
            </form>
          </div>
          {b.clarification && <p className="mt-2 text-[13.5px] text-muted-foreground">Also noted: {b.clarification}</p>}
        </div>
        <RequirementChips items={b.requirements} busy={upd.isPending} onChange={(next, msg) => patch({ requirements: next }, msg, () => patch({ requirements: b.requirements }, "Undone"))} />
        <DragOverlay dropAnimation={null}>{dragging && <span className="lift inline-flex rounded-full bg-primary px-3 py-1.5 text-[13.5px] font-medium text-primary-foreground">{chips.find((c) => c.key === dragging)?.value}</span>}</DragOverlay>
      </DndContext>
      {!showResults && (
        <div className="mt-8 flex items-center gap-4">
          <button data-testid="button-find-existing" onClick={onFind} className={btn.primary}>Find existing solutions <ArrowRight className="h-5 w-5" /></button>
          <span className="text-[14px] text-muted-foreground">{b.valueStatement}</span>
        </div>
      )}
      {showResults && <Results briefId={briefId} />}
    </div>
  );
}

function EditCard(p: { id: Card; label: string; hint: string; value: string; picked: string | null; dragging: boolean; busy: boolean; onSave: (v: string) => void; onAddPicked: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `card:${p.id}` });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.value);
  useEffect(() => { if (!editing) setDraft(p.value); }, [p.value, editing]);
  return (
    <div ref={setNodeRef} data-testid={`card-${p.id}`}
      className={cn("card-soft flex min-h-[150px] flex-col p-5 transition-[border-color,box-shadow,background-color]", p.dragging && "border-dashed border-sienna/60", isOver && "border-solid border-sienna bg-accent/40 shadow-[0_0_0_3px_hsl(var(--sienna)/.2)]")}>
      <div className="flex items-center gap-2">
        <span className={cn("h-2.5 w-2.5 rounded-full", p.id === "today" ? "bg-sky" : "bg-ok")} />
        <span className="text-[15px] font-semibold text-primary">{p.label}</span>
        <span className="text-[13px] text-muted-foreground">{p.hint}</span>
        {!editing && <button data-testid={`button-edit-${p.id}`} onClick={() => setEditing(true)} className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-primary" aria-label={`Edit ${p.label}`}><Pencil className="h-4 w-4" /></button>}
      </div>
      {editing ? (
        <div className="mt-2">
          <Textarea autoFocus data-testid={`input-${p.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[80px] text-[15.5px]" />
          <div className="mt-2 flex justify-end gap-1">
            <button className={btn.quiet} onClick={() => { setDraft(p.value); setEditing(false); }}>Cancel</button>
            <button data-testid={`button-save-${p.id}`} className={btn.secondary} disabled={p.busy} onClick={() => { p.onSave(draft.trim()); setEditing(false); }}><Check className="h-4 w-4" /> Save</button>
          </div>
        </div>
      ) : (
        <p data-testid={`text-${p.id}`} onClick={() => setEditing(true)} className="mt-2 cursor-text text-[16.5px] leading-relaxed">{p.value}</p>
      )}
      {p.picked && !editing && <button data-testid={`button-add-here-${p.id}`} onClick={p.onAddPicked} className="mt-auto self-start pt-3 text-[13.5px] font-semibold text-siennaink hover:underline">+ Add here</button>}
    </div>
  );
}

function Chip({ k, value, picked, onPick, onRemove }: { k: keyof BriefFieldValues; value: string; picked: boolean; onPick: () => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `chip:${k}` });
  return (
    <span ref={setNodeRef} data-testid={`chip-${k}`} className={cn("inline-flex max-w-full items-center gap-1 rounded-full border bg-card py-1 pl-1 pr-1 text-[13.5px] transition-colors", picked ? "border-sienna bg-accent" : "border-input hover:border-primary/40", isDragging && "opacity-30")}>
      <span {...listeners} {...attributes} aria-label={`Drag ${FIELD_LABEL[k]}`} className="cursor-grab touch-none rounded-full p-0.5 text-muted-foreground active:cursor-grabbing"><GripVertical className="h-3.5 w-3.5" /></span>
      <button onClick={onPick} className="min-w-0 truncate text-left"><span className="font-semibold text-primary">{FIELD_LABEL[k]}:</span> {value.length > 60 ? value.slice(0, 58) + "..." : value}</button>
      <button aria-label={`Remove ${FIELD_LABEL[k]}`} data-testid={`button-remove-chip-${k}`} onClick={onRemove} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-bad"><X className="h-3.5 w-3.5" /></button>
    </span>
  );
}

function Results({ briefId }: { briefId: string }) {
  return (
    <>
      <CodeAssessment briefId={briefId} />
      <details className="card-soft mt-8 p-5" data-testid="catalog-descriptions">
        <summary className="cursor-pointer text-[17px] font-semibold text-primary">Catalog descriptions</summary>
        <p className="mt-3 text-[14px] text-muted-foreground">Secondary comparison based on catalog descriptions, not implemented code. These suggestions do not override the code-grounded starting solution or establish verified coverage.</p>
        <CatalogResults briefId={briefId} />
      </details>
    </>
  );
}

function CatalogResults({ briefId }: { briefId: string }) {
  const m = useGetBriefMatches(briefId, { query: { enabled: !!briefId, queryKey: getGetBriefMatchesQueryKey(briefId) } });
  const [more, setMore] = useState(false);
  if (m.isLoading) return <div className="mt-10 space-y-3"><Skel className="h-44" /><div className="grid gap-3 md:grid-cols-2"><Skel className="h-32" /><Skel className="h-32" /></div></div>;
  if (m.isError || !m.data) return <p className="mt-10 text-bad">Matches could not load. <button className="underline" onClick={() => m.refetch()}>Retry</button></p>;
  const [best, ...rest] = m.data.matches;
  if (!best) return <p className="mt-10 text-muted-foreground">Nothing in the library matches yet. Try wording it differently, or browse the <Link href="/library" className="text-primary underline">library</Link>.</p>;
  return (
    <section className="reveal mt-12" data-testid="section-results">
      <div className="eyebrow mb-2 !text-siennaink">Catalog suggestion</div>
      <MatchCard m={best} big />
      <CoverageTable rows={m.data.coverage} briefId={briefId} baseSolutionId={best.solution.id} baseSolutionName={best.solution.name} baseLive={isLive(best.solution)} />
      {rest.length > 0 && <>
        <h3 className="mb-3 mt-8 text-[17px] font-semibold">Other possibilities</h3>
        <div className="grid gap-3 md:grid-cols-2">{rest.slice(0, 2).map((x) => <MatchCard key={x.solution.id} m={x} />)}</div>
        {rest.length > 2 && (more
          ? <div className="mt-3 grid gap-3 md:grid-cols-2">{rest.slice(2).map((x) => <MatchCard key={x.solution.id} m={x} />)}</div>
          : <button data-testid="button-show-more" onClick={() => setMore(true)} className={cn(btn.quiet, "mt-3")}>Show {rest.length - 2} more</button>)}
      </>}
    </section>
  );
}

function MatchCard({ m, big }: { m: SolutionMatch; big?: boolean }) {
  return (
    <article data-testid={big ? "card-best-match" : `card-match-${m.solution.id}`} className={cn("card-soft flex flex-col p-5", big && "border-l-4 border-l-sienna p-7")}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={cn("font-semibold", big ? "text-[24px]" : "text-[18px]")}>{m.solution.name}</h3>
        <StatusPill status={m.solution.status} />
      </div>
      <p className="mt-1.5 text-[15px] text-foreground">{m.solution.outcome}</p>
      <div className="mt-2"><MetaTags s={m.solution} compact testid={`meta-match-${m.solution.id}`} /></div>
      {m.whyMatched.length > 0 && (
        <div className="mt-3 text-[14px] text-muted-foreground"><span className="font-semibold text-siennaink">Why it matches: </span>{(big ? m.whyMatched.slice(0, 2) : m.whyMatched.slice(0, 1)).join(" ")}</div>
      )}
      <div className="mt-5">
        <Link href={`/solutions/${m.solution.id}`} data-testid={`button-explore-${m.solution.id}`} className={big ? btn.primary : btn.secondary}>{isLive(m.solution) ? "Explore solution" : "See output preview"} <ArrowRight className="h-4 w-4" /></Link>
      </div>
    </article>
  );
}
