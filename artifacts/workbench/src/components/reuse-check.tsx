import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Check, ChevronDown, ChevronRight, Pencil, Plus, Search, X } from "lucide-react";
import {
  useCreateCase, useReuseCheck, useUpdateReuseEvent,
  type BriefRequirement, type ReuseCheckResult, type ReuseOption, type RequirementCoverage,
} from "@workspace/api-client-react";
import { btn, useUndoToast } from "@/components/bits";
import { errMsg, useInvalidateAll } from "@/lib/case";
import { cn } from "@/lib/utils";

// ---------- Requirement chips (editable, add, remove; every change can be undone) ----------

export function RequirementChips({ items, busy, onChange }: { items: BriefRequirement[]; busy: boolean; onChange: (next: BriefRequirement[], msg: string) => void }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const add = () => {
    const text = draft.trim();
    if (text.length < 3) return;
    onChange([...items, { id: `req_new_${Date.now()}`, text, source: "added" }], `Added "${text}"`);
    setDraft("");
  };
  const saveEdit = (id: string) => {
    const text = editText.trim();
    setEditing(null);
    if (!text) return;
    onChange(items.map((r) => (r.id === id ? { ...r, text } : r)), "Requirement updated");
  };
  return (
    <div className="mt-5" data-testid="section-requirements">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[15px] font-semibold text-primary">It must</span>
        <span className="text-[13.5px] text-muted-foreground">What any solution has to do. Add, edit or remove anything.</span>
      </div>
      <ul className="flex flex-wrap gap-2" data-testid="list-requirements">
        {items.map((r) => (
          <li key={r.id} data-testid={`chip-requirement-${r.id}`} className={cn("inline-flex max-w-full items-center gap-1 rounded-full border bg-card py-1 pl-3 pr-1 text-[13.5px]", r.source === "added" ? "border-sienna/60" : "border-input")}>
            {editing === r.id ? (
              <form onSubmit={(e) => { e.preventDefault(); saveEdit(r.id); }} className="flex items-center gap-1">
                <input autoFocus data-testid={`input-requirement-${r.id}`} value={editText} onChange={(e) => setEditText(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(null)} className="h-7 w-72 bg-transparent outline-none" />
                <button aria-label="Save" data-testid={`button-save-requirement-${r.id}`} className="grid h-7 w-7 place-items-center rounded-full text-primary hover:bg-secondary"><Check className="h-4 w-4" /></button>
              </form>
            ) : (
              <>
                <button onClick={() => { setEditing(r.id); setEditText(r.text); }} className="min-w-0 truncate text-left" title="Edit">{r.text}</button>
                <button aria-label={`Edit requirement`} onClick={() => { setEditing(r.id); setEditText(r.text); }} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-primary"><Pencil className="h-3.5 w-3.5" /></button>
                <button aria-label={`Remove requirement`} data-testid={`button-remove-requirement-${r.id}`} disabled={busy} onClick={() => onChange(items.filter((x) => x.id !== r.id), `Removed "${r.text}"`)} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-bad"><X className="h-3.5 w-3.5" /></button>
              </>
            )}
          </li>
        ))}
        <li>
          <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex items-center gap-1 rounded-full border border-dashed border-input bg-card pl-3 pr-1">
            <input data-testid="input-add-requirement" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a requirement" className="h-8 w-56 bg-transparent text-[13.5px] outline-none" />
            <button data-testid="button-add-requirement" aria-label="Add requirement" disabled={busy} className="grid h-7 w-7 place-items-center rounded-full text-primary hover:bg-secondary"><Plus className="h-4 w-4" /></button>
          </form>
        </li>
      </ul>
    </div>
  );
}

// ---------- Coverage table ----------

const STATUS_LABEL: Record<RequirementCoverage["status"], string> = { covered: "Covered", covered_reusable: "Covered by a reusable capability", uncovered: "Not currently covered" };

export function CoverageTable({ rows, briefId, baseSolutionId, baseSolutionName }: { rows: RequirementCoverage[]; briefId: string; baseSolutionId: string; baseSolutionName: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  if (rows.length === 0) return null;
  const uncovered = rows.filter((r) => r.status === "uncovered").length;
  return (
    <section className="mt-6" data-testid="section-coverage">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[17px] font-semibold">What {baseSolutionName} covers</h3>
        <span className="text-[13.5px] text-muted-foreground">
          {uncovered === 0 ? "Every requirement is covered." : `${uncovered} not covered. Select a row to see what already exists for it.`}
        </span>
      </div>
      <div className="card-soft overflow-hidden">
        <table className="w-full text-[14.5px]">
          <tbody>
            {rows.map((r) => {
              const clickable = r.status === "uncovered";
              const isOpen = open === r.requirementId;
              return (
                <RowGroup key={r.requirementId}>
                  <tr
                    data-testid={`row-coverage-${r.requirementId}`}
                    aria-expanded={clickable ? isOpen : undefined}
                    onClick={clickable ? () => setOpen(isOpen ? null : r.requirementId) : undefined}
                    className={cn("border-b border-border last:border-0", clickable && "cursor-pointer hover:bg-secondary/60", isOpen && "bg-secondary/60")}
                  >
                    <td className="w-7 py-3 pl-4 text-muted-foreground">{clickable ? (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <Check className="h-4 w-4 text-ok" />}</td>
                    <td className="py-3 pr-3 font-medium text-foreground">{r.text}</td>
                    <td className="py-3 pr-3 text-right">
                      <span data-testid={`status-coverage-${r.requirementId}`} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[12.5px] font-semibold", r.status === "uncovered" ? "bg-accent text-accent-foreground" : "bg-okbg text-ok")}>
                        {r.status === "covered" ? `Covered by ${r.coveredBy}` : r.status === "covered_reusable" ? `Covered by ${r.coveredBy} (reusable)` : STATUS_LABEL.uncovered}
                      </span>
                    </td>
                    <td className="w-16 py-3 pr-4 text-right">
                      {r.status !== "uncovered" && (
                        <button data-testid={`button-why-${r.requirementId}`} onClick={(e) => { e.stopPropagation(); setWhy(why === r.requirementId ? null : r.requirementId); }} className="text-[13px] font-semibold text-siennaink hover:underline">Why?</button>
                      )}
                    </td>
                  </tr>
                  {why === r.requirementId && r.status !== "uncovered" && (
                    <tr className="border-b border-border last:border-0"><td /><td colSpan={3} className="pb-3 pr-4 text-[13.5px] text-muted-foreground" data-testid={`text-why-${r.requirementId}`}>
                      "{r.capabilityName}" in {r.coveredBy} scores {r.score} for this requirement (60 or more counts as covered).
                    </td></tr>
                  )}
                  {isOpen && (
                    <tr className="border-b border-border last:border-0"><td colSpan={4} className="bg-secondary/40 px-4 pb-4 pt-1">
                      <ReuseCheckPanel need={r.text} requirementId={r.requirementId} briefId={briefId} baseSolutionId={baseSolutionId} baseSolutionName={baseSolutionName} onClose={() => setOpen(null)} />
                    </td></tr>
                  )}
                </RowGroup>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RowGroup({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// ---------- Reuse check: one need, up to three options, one dominant action ----------

const PATH_LABEL: Record<ReuseOption["path"], string> = { try_existing: "Try existing", improve_existing: "Start from and improve", new_experiment: "New experiment allowed", hard_exclusion: "Cannot be used here" };
const DIM_LABEL: { key: keyof NonNullable<ReuseOption["dimensions"]>; label: string; weight: number }[] = [
  { key: "problemFit", label: "Problem fit", weight: 30 },
  { key: "inputOutput", label: "Input / output", weight: 20 },
  { key: "workflowPosition", label: "Workflow position", weight: 15 },
  { key: "userContext", label: "User context", weight: 10 },
  { key: "dataControl", label: "Data and control", weight: 15 },
  { key: "maturityEvidence", label: "Maturity and evidence", weight: 10 },
];

export function ReuseCheckPanel({ need, requirementId, briefId, baseSolutionId, baseSolutionName, onClose }: { need: string; requirementId?: string; briefId?: string; baseSolutionId: string; baseSolutionName: string; onClose: () => void }) {
  const check = useReuseCheck();
  const [result, setResult] = useState<ReuseCheckResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const update = useUpdateReuseEvent();
  const say = useUndoToast();
  const run = () => check.mutate({ data: { need, trigger: "discover_requirement", baseSolutionId, briefId, requirementId } }, { onSuccess: setResult, onError: (e) => say(errMsg(e)) });
  if (!result) {
    return (
      <div className="flex flex-wrap items-center gap-3 pt-2" data-testid="panel-reuse-check">
        <span className="text-[14px] text-muted-foreground">Before building anything new, check what already exists for this.</span>
        <button data-testid="button-run-reuse-check" onClick={run} disabled={check.isPending} className={btn.secondary}><Search className="h-4 w-4" /> {check.isPending ? "Checking..." : "Check what exists"}</button>
      </div>
    );
  }
  // Only credible options are shown (score 60 or more); weaker ones stay in the record, not on the page.
  // A strong match ruled out by a hard exclusion is still shown, with the reason, so nobody rebuilds it blindly.
  const shown = result.options.filter((o) => o.kind !== "create" && o.score !== null && o.score >= 60);
  const excludedOnly = shown.length > 0 && shown.every((o) => o.path === "hard_exclusion");
  const createOpt = result.options.find((o) => o.kind === "create");
  const markTaken = (pathTaken: "use" | "improve" | "create" | "dismissed" | "explored") => update.mutate({ eventId: result.eventId, data: { pathTaken } });
  return (
    <div className="pt-2" data-testid="panel-reuse-check">
      {dismissed ? (
        <p className="text-[14px] text-muted-foreground">Noted. Nothing was started for this requirement.</p>
      ) : (
        <>
          {shown.length > 0 ? (
            <div className={cn("grid gap-3", shown.length > 1 && "md:grid-cols-2")}>
              {shown.map((o, i) => <OptionCard key={o.kind + o.title} o={o} primary={i === 0} briefId={briefId} baseSolutionName={baseSolutionName} eventId={result.eventId} onTaken={markTaken} />)}
            </div>
          ) : (
            <div className="card-soft p-4" data-testid="card-reuse-none">
              <div className="text-[15px] font-semibold">Nothing existing scores 60 or more</div>
              <p className="mt-1 text-[14px] text-muted-foreground">{createOpt?.reasons[0] ?? "No existing step, product or experiment is about this need."} A new experiment is allowed.</p>
              <div className="mt-3"><CreateAction briefId={briefId} baseSolutionId={baseSolutionId} onTaken={markTaken} /></div>
            </div>
          )}
          {excludedOnly && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[14px] text-muted-foreground" data-testid="text-reuse-excluded-only">
              <span>The match above cannot be used here, so a new experiment is allowed.</span>
              <CreateAction briefId={briefId} baseSolutionId={baseSolutionId} onTaken={markTaken} />
            </div>
          )}
          <div className="mt-2 flex items-center gap-3 text-[13px] text-muted-foreground">
            {shown.length > 0 && createOpt && <span>{createOpt.subtitle}</span>}
            <button data-testid="button-dismiss-reuse" onClick={() => { markTaken("dismissed"); setDismissed(true); say("Dismissed", () => { setDismissed(false); }); }} className="ml-auto font-semibold text-primary hover:underline">Not now</button>
            <button onClick={onClose} className="font-semibold text-primary hover:underline">Close</button>
          </div>
        </>
      )}
    </div>
  );
}

function OptionCard({ o, primary, briefId, baseSolutionName, eventId, onTaken }: { o: ReuseOption; primary: boolean; briefId?: string; baseSolutionName: string; eventId: string; onTaken: (p: "use" | "improve" | "create" | "dismissed" | "explored") => void }) {
  const [why, setWhy] = useState(false);
  const excluded = o.path === "hard_exclusion";
  return (
    <article data-testid={`card-reuse-option-${o.kind}`} className={cn("card-soft flex flex-col p-4", primary && !excluded && "border-l-4 border-l-sienna")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h4 className="text-[17px] font-semibold">{o.title}</h4>
        <span data-testid="text-reuse-path" className={cn("rounded-md px-2 py-0.5 text-[12.5px] font-semibold", excluded ? "bg-muted text-muted-foreground" : o.path === "try_existing" ? "bg-okbg text-ok" : "bg-accent text-accent-foreground")}>{PATH_LABEL[o.path]}</span>
      </div>
      <div className="mt-0.5 text-[13.5px] text-muted-foreground">{o.subtitle}</div>
      {excluded ? (
        <ul className="mt-2 list-disc pl-5 text-[14px] text-foreground">{o.exclusions.map((x) => <li key={x}>{x}</li>)}</ul>
      ) : (
        <p className="mt-2 text-[14px] text-foreground">{o.reasons.slice(0, 2).join(" ")}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <OptionAction o={o} primary={primary} briefId={briefId} baseSolutionName={baseSolutionName} eventId={eventId} onTaken={onTaken} />
        {o.dimensions && <button data-testid="button-reuse-why" onClick={() => setWhy(!why)} className="text-[13px] font-semibold text-siennaink hover:underline">{why ? "Hide" : "Why?"}</button>}
      </div>
      {why && o.dimensions && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-3" data-testid="list-reuse-dimensions">
          {o.score !== null && <div className="col-span-full pb-1 text-[13.5px]" data-testid="text-reuse-score"><span className="font-semibold">Reuse fit {Math.round(o.score)} of 100.</span> <span className="text-muted-foreground">80 or more: try it as is. 60 to 79: start from it and improve. Below 60: a new experiment is allowed.</span></div>}
          {DIM_LABEL.map((d) => (
            <div key={d.key} className="flex items-baseline justify-between gap-2 border-b border-border py-1">
              <dt className="text-muted-foreground">{d.label} <span className="text-[11.5px]">({d.weight})</span></dt>
              <dd className="font-semibold tabular-nums">{Math.round(o.dimensions![d.key])}</dd>
            </div>
          ))}
          {o.reasons.length > 2 && <div className="col-span-full pt-1 text-muted-foreground">{o.reasons.slice(2).join(" ")}</div>}
        </dl>
      )}
    </article>
  );
}

function OptionAction({ o, primary, briefId, baseSolutionName, eventId, onTaken }: { o: ReuseOption; primary: boolean; briefId?: string; baseSolutionName: string; eventId: string; onTaken: (p: "use" | "improve" | "create" | "dismissed" | "explored") => void }) {
  const [, setLocation] = useLocation();
  const create = useCreateCase();
  const invalidate = useInvalidateAll();
  const say = useUndoToast();
  const cls = primary ? btn.primary : btn.secondary;
  if (o.kind === "capability" && o.addableTo && o.capability) {
    return (
      <button
        data-testid="button-try-capability"
        disabled={create.isPending}
        className={cls}
        onClick={() =>
          create.mutate(
            { data: { baseSolutionId: o.addableTo!, briefId, moduleIds: [o.capability!.id], reuseEventId: eventId, createdByRole: "seeker" } },
            { onSuccess: (c) => { invalidate(); setLocation(`/workbench/${c.id}?mode=compare`); }, onError: (e) => say(errMsg(e)) },
          )
        }
      >
        {create.isPending ? "Setting up..." : `Try it in ${baseSolutionName}`} <ArrowRight className="h-4 w-4" />
      </button>
    );
  }
  if (o.kind === "experiment" && o.caseId) {
    // Opening a page is exploration, not a path taken; "use" is recorded by the server only when a case is actually created from the check.
    return <Link href={`/workbench/${o.caseId}`} data-testid="button-open-experiment" className={cls} onClick={() => onTaken("explored")}>Open the experiment <ArrowRight className="h-4 w-4" /></Link>;
  }
  if (o.solutionId) {
    const label = o.path === "hard_exclusion" ? "See why" : o.path === "improve_existing" ? "Start from it" : "Explore it";
    return <Link href={`/solutions/${o.solutionId}`} data-testid="button-open-solution" className={o.path === "hard_exclusion" ? btn.quiet : cls} onClick={() => onTaken("explored")}>{label} <ArrowRight className="h-4 w-4" /></Link>;
  }
  return null;
}

function CreateAction({ briefId, baseSolutionId, onTaken }: { briefId?: string; baseSolutionId: string; onTaken: (p: "create") => void }) {
  const [, setLocation] = useLocation();
  const create = useCreateCase();
  const invalidate = useInvalidateAll();
  const say = useUndoToast();
  return (
    <button
      data-testid="button-start-experiment"
      disabled={create.isPending}
      className={btn.secondary}
      onClick={() => { onTaken("create"); create.mutate({ data: { baseSolutionId, briefId, createdByRole: "seeker" } }, { onSuccess: (c) => { invalidate(); setLocation(`/workbench/${c.id}`); }, onError: (e) => say(errMsg(e)) }); }}
    >
      {create.isPending ? "Setting up..." : "Start a new experiment"} <ArrowRight className="h-4 w-4" />
    </button>
  );
}
