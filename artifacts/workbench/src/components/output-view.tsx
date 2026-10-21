import { Clock, Layers, ListChecks, AlertTriangle, Repeat, Wrench } from "lucide-react";
import type { DiffEntry, Run, RunOutput } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const MARK = {
  added: { label: "New", cls: "border-l-ok bg-okbg/70", tag: "bg-okbg text-ok" },
  removed: { label: "Removed", cls: "border-l-muted-foreground/50 bg-muted/70 text-muted-foreground line-through decoration-muted-foreground/50", tag: "bg-muted text-muted-foreground" },
  changed: { label: "Changed", cls: "border-l-sienna bg-accent/70", tag: "bg-accent text-accent-foreground" },
};

export function OutputView({ output, marks, selectedKey, onPick, testid, dim }: {
  output: RunOutput; marks?: Map<string, DiffEntry>; selectedKey?: string | null; onPick?: (e: DiffEntry) => void; testid?: string; dim?: boolean;
}) {
  return (
    <div data-testid={testid ?? "output"} className={cn("space-y-4 transition-opacity", dim && "opacity-60")}>
      <p data-testid={`${testid ?? "output"}-headline`} className="text-[15px] font-semibold text-foreground">{output.headline}</p>
      {output.sections.map((s) => (
        <section key={s.key}>
          <div className="eyebrow mb-1.5">{s.title}</div>
          {s.items.length === 0 ? <p className="text-[13.5px] text-muted-foreground">Nothing produced.</p> : (
            <ul className="space-y-1">
              {s.items.map((it) => {
                const m = marks?.get(it.key);
                const tone = m ? MARK[m.change] : null;
                const Comp = m && onPick ? "button" : "div";
                return (
                  <li key={it.id}>
                    <Comp
                      {...(m && onPick ? { onClick: () => onPick(m), type: "button" as const, "data-testid": "diff-line" } : {})}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md border-l-[3px] border-l-transparent px-2.5 py-1.5 text-left text-[14px] leading-snug",
                        tone?.cls,
                        m && onPick && "cursor-pointer transition-shadow hover:shadow-[inset_0_0_0_1px_hsl(var(--primary)/.35)]",
                        selectedKey && selectedKey === it.key && "shadow-[inset_0_0_0_2px_hsl(var(--primary))]",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        {it.text}
                        {it.detail && <span className="block text-[12.5px] text-muted-foreground no-underline">{it.detail}</span>}
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
