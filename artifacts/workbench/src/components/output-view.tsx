import { Clock, Layers, ListChecks, AlertTriangle, Repeat, Wrench } from "lucide-react";
import type { DiffEntry, Run, RunOutput } from "@workspace/api-client-react";
import { isEmptyOutput, type Presence } from "@/lib/ab-output";
import { provenance } from "@/components/wb-lanes";
import { cn } from "@/lib/utils";
import { useRole } from "@/lib/persona";

const MARK = {
  added: { label: "New", cls: "border-l-ok bg-okbg/70", tag: "bg-okbg text-ok" },
  removed: { label: "Removed", cls: "border-l-muted-foreground/50 bg-muted/70 text-muted-foreground line-through decoration-muted-foreground/50", tag: "bg-muted text-muted-foreground" },
  changed: { label: "Changed", cls: "border-l-sienna bg-accent/70", tag: "bg-accent text-accent-foreground" },
};

const RANKED = { label: "Ranked", cls: "border-l-primary bg-secondary text-secondary-foreground", tag: "border border-primary/30 bg-card text-foreground" };

/** Lines are addressed by section + item key: item keys such as "none" repeat across sections. */
export const lineKey = (sectionKey: string, itemKey: string) => `${sectionKey}:${itemKey}`;
export const diffKey = (e: Pick<DiffEntry, "sectionKey" | "itemKey">) => lineKey(e.sectionKey, e.itemKey);
export const marksFrom = (entries: DiffEntry[]) => new Map<string, DiffEntry>(entries.map((e) => [diffKey(e), e]));

export function OutputView({ output, marks, selectedKey, onPick, testid, dim, presence, side }: {
  output: RunOutput; marks?: Map<string, DiffEntry>; selectedKey?: string | null; onPick?: (e: DiffEntry) => void; testid?: string; dim?: boolean;
  /** From sectionPresence(A, B): marks sections only this side produced. */
  presence?: Map<string, Presence>; side?: "A" | "B";
}) {
  const only = side === "A" ? "a-only" : "b-only";
  return (
    <div data-testid={testid ?? "output"} className={cn("space-y-4 transition-opacity", dim && "opacity-60")}>
      <p data-testid={`${testid ?? "output"}-headline`} className="text-[15px] font-semibold text-foreground">{output.headline}</p>
      {isEmptyOutput(output.sections) && <p className="rounded-lg bg-muted/60 px-3 py-2 text-[13.5px] text-muted-foreground" data-testid={`${testid ?? "output"}-empty`}>This run produced no output lines. Open a step above to see what it received and returned.</p>}
      {output.sections.map((s) => (
        <section key={s.key}>
          <div className="eyebrow mb-1.5 flex items-center gap-2">{s.title}{side && presence?.get(s.key) === only && <span className="rounded bg-okbg px-1.5 text-[10.5px] font-semibold normal-case tracking-normal text-ok" data-testid={`section-only-${side.toLowerCase()}-${s.key}`}>Only in {side}</span>}</div>
          {s.items.length === 0 ? <p className="text-[13.5px] text-muted-foreground">Nothing produced.</p> : (
            <ul className="space-y-1">
              {s.items.map((it) => {
                const m = marks?.get(lineKey(s.key, it.key));
                const ranking = m?.changeType === "ranking";
                const tone = m ? (ranking ? RANKED : MARK[m.change]) : null;
                const Comp = m && onPick ? "button" : "div";
                return (
                  <li key={it.id}>
                    <Comp
                      {...(m && onPick ? { onClick: () => onPick(m), type: "button" as const, "data-testid": "diff-line" } : {})}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md border-l-[3px] border-l-transparent px-2.5 py-1.5 text-left text-[14px] leading-snug",
                        tone?.cls,
                        m && onPick && "cursor-pointer transition-shadow hover:shadow-[inset_0_0_0_1px_hsl(var(--primary)/.35)]",
                        selectedKey && selectedKey === lineKey(s.key, it.key) && "shadow-[inset_0_0_0_2px_hsl(var(--primary))]",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        {it.text}
                        {it.detail && <span className="block text-[12.5px] text-muted-foreground no-underline">{it.detail}</span>}
                        {m && m.change === "changed" && m.before && m.before !== it.text && <span className="block text-[12px] text-muted-foreground no-underline" data-testid="text-line-before">{side === "A" ? `B: ${m.after ?? ""}` : `A: ${m.before}`}</span>}
                        {m && <span className="block text-[12px] font-medium text-siennaink no-underline" data-testid="text-line-provenance">{ranking ? `Ranked by ${m.stepName}, same finding` : provenance(m)}</span>}
                      </span>
                      {tone && <span className={cn("mt-0.5 shrink-0 rounded px-1.5 text-[11px] font-semibold no-underline", tone.tag)}>{tone.label}</span>}
                    </Comp>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export function RunMeta({ run, testid }: { run: Run; testid?: string }) {
  const role = useRole();
  if (role !== "it") return run.stats.errors > 0 ? <p className="text-sm text-bad">This run encountered errors. Ask the IT Owner to review it.</p> : null;
  const items = [
    { icon: Clock, label: `${run.durationMs} ms`, k: "duration" },
    { icon: Layers, label: `${run.stats.steps} steps`, k: "steps" },
    { icon: ListChecks, label: `${run.stats.issues} issues`, k: "issues" },
    { icon: Repeat, label: `${run.stats.patterns} patterns`, k: "patterns" },
    { icon: Wrench, label: `${run.stats.actions} actions`, k: "actions" },
  ];
  return (
    <div data-testid={testid ?? "run-meta"} className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
      {items.map((i) => <span key={i.k} data-testid={`stat-${i.k}`} className="inline-flex items-center gap-1"><i.icon className="h-3.5 w-3.5" />{i.label}</span>)}
      {run.stats.errors > 0 && <span className="inline-flex items-center gap-1 text-bad"><AlertTriangle className="h-3.5 w-3.5" />{run.stats.errors} errors</span>}
    </div>
  );
}
