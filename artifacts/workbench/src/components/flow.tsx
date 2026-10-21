import { useDroppable } from "@dnd-kit/core";
import { ChevronRight, Lock, Search, SlidersHorizontal, ToggleRight, X } from "lucide-react";
import type { ComponentConfig, Configuration, WorkflowBlock } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export type FlowBlock = {
  id: string; name: string; description: string; kind: "required" | "configurable" | "optional";
  active: boolean; added: boolean; value: string | null; options: string[] | null; source: string; blockedReason: string | null;
};

export function blocksFromConfig(cfg: Configuration, baseId: string): FlowBlock[] {
  const out: FlowBlock[] = [];
  for (const st of cfg.steps)
    for (const c of st.components) {
      if (!c.executable) continue;
      const fromBase = c.capability.sourceSolutionId === baseId;
      if (c.controlType === "optional" && !c.active && !fromBase) continue;
      out.push(fromComp(c, fromBase));
    }
  return out;
}
function fromComp(c: ComponentConfig, fromBase: boolean): FlowBlock {
  return {
    id: c.capability.id, name: c.capability.name, description: c.capability.description,
    kind: c.controlType === "locked" ? "required" : c.controlType, active: c.active, added: !fromBase && c.controlType === "optional",
    value: c.value, options: c.options, source: c.sourceSolutionName, blockedReason: c.blockedReason,
  };
}
export function blocksFromWorkbench(blocks: WorkflowBlock[]): FlowBlock[] {
  return blocks.filter((b) => b.executable).map((b) => ({
    id: b.capability.id, name: b.capability.name, description: b.capability.description, kind: b.kind, active: b.active,
    added: b.origin === "added", value: b.value, options: b.options, source: b.capability.sourceSolutionName, blockedReason: b.blockedReason,
  }));
}
export function controlsFromConfig(cfg: Configuration) {
  return cfg.steps.flatMap((s) => s.components).filter((c) => !c.executable && c.controlType === "locked").map((c) => c.capability);
}

const KIND = { required: { icon: Lock, label: "Required" }, configurable: { icon: SlidersHorizontal, label: "Configurable" }, optional: { icon: ToggleRight, label: "Optional" } };

export function Flow(p: {
  blocks: FlowBlock[]; label?: string; editable?: boolean; busy?: boolean; selectedId?: string | null; highlightIds?: string[];
  onOpen?: (b: FlowBlock) => void; onToggle?: (b: FlowBlock, on: boolean) => void; onRemove?: (b: FlowBlock) => void; onOption?: (b: FlowBlock, v: string) => void;
  dropId?: string; dragging?: boolean; testid?: string; dense?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: p.dropId ?? "none", disabled: !p.dropId });
  return (
    <div ref={setNodeRef} data-testid={p.testid ?? "workflow"}
      className={cn("rounded-2xl transition-[background-color,box-shadow]", p.dragging && "bg-accent/50 shadow-[inset_0_0_0_2px_hsl(var(--sienna)/.5)]", p.dragging && isOver && "bg-accent shadow-[inset_0_0_0_2px_hsl(var(--sienna))]")}>
      <ol className={cn("flex flex-wrap items-stretch gap-y-3", p.dense ? "p-1" : "p-2")}>
        {p.blocks.map((b, i) => {
          const K = KIND[b.kind];
          const off = !b.active;
          const hl = p.highlightIds?.includes(b.id);
          return (
            <li key={b.id} className="flex items-stretch">
              <div
                data-testid={`block-${b.id}`}
                onClick={() => p.onOpen?.(b)}
                onDoubleClick={() => p.onOpen?.(b)}
                className={cn(
                  "group relative flex cursor-pointer flex-col rounded-xl border bg-card text-left transition-[border-color,box-shadow,opacity]",
                  p.dense ? "w-[150px] p-2.5" : "w-[176px] p-3",
                  b.added ? "border-sienna/60 drop-pop" : "border-border",
                  off && "border-dashed bg-muted/60 opacity-70",
                  p.selectedId === b.id && "border-primary shadow-[0_0_0_2px_hsl(var(--primary)/.25)]",
                  hl && "border-sienna shadow-[0_0_0_3px_hsl(var(--sienna)/.35)]",
                  "hover:border-primary/50",
                )}
              >
                {b.added && <span className="absolute -top-2 left-2.5 rounded bg-siennaink px-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-white">Added</span>}
                <span className="flex items-center justify-between text-[11.5px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><K.icon className="h-3.5 w-3.5" />{K.label}</span>
                  <span className="font-mono">{i + 1}</span>
                </span>
                <span className={cn("mt-1.5 text-[14.5px] font-semibold leading-tight text-primary", off && "text-muted-foreground line-through")}>{b.name}</span>
                {b.kind === "configurable" && b.value && <span className="mt-1 truncate text-[12px] text-muted-foreground">{b.value}</span>}
                {p.editable && (
                  <span className="mt-auto flex items-center gap-1.5 pt-2" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    {b.kind === "optional" && !b.added && (
                      <Switch aria-label={`Turn ${b.name} ${b.active ? "off" : "on"}`} data-testid={`switch-${b.id}`} checked={b.active} disabled={p.busy} onCheckedChange={(v) => p.onToggle?.(b, v)} />
                    )}
                    {b.kind === "configurable" && (b.options ?? []).length > 0 && (
                      <select aria-label={`${b.name} setting`} data-testid={`select-${b.id}`} disabled={p.busy} value={b.value ?? ""} onChange={(e) => p.onOption?.(b, e.target.value)}
                        className="h-7 w-full rounded-md border border-input bg-card px-1.5 text-[12.5px]">
                        {(b.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    )}
                    {b.added && (
                      <button data-testid={`button-remove-${b.id}`} disabled={p.busy} onClick={() => p.onRemove?.(b)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-accent-foreground hover:bg-accent">
                        <X className="h-3.5 w-3.5" /> Remove
                      </button>
                    )}
                    <button aria-label={`Inspect ${b.name}`} data-testid={`button-inspect-${b.id}`} onClick={() => p.onOpen?.(b)} className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-primary"><Search className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </div>
              {i < p.blocks.length - 1 && <ChevronRight className="mx-0.5 h-4 w-4 shrink-0 self-center text-muted-foreground/60" />}
            </li>
          );
        })}
        {p.dragging && <li className="ml-2 grid min-h-[80px] w-[150px] place-items-center rounded-xl border-2 border-dashed border-sienna text-[13px] font-semibold text-siennaink">Drop to add</li>}
      </ol>
    </div>
  );
}
