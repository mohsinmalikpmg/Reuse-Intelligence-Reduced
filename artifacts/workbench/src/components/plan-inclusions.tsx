import { ArrowDown, Check, CircleDashed } from "lucide-react";
import { Tag, btn } from "@/components/bits";
import type { PlanInclusion } from "@/lib/plan-inclusions";

export const inclusionNodeId = (item: PlanInclusion) => `plan-step-${item.sourceId}-${item.capabilityId}`;
const label = (item: PlanInclusion) => item.status === "active" ? "In workflow" : item.status === "off" ? "Switched off" : "Proposed · does not run";

export function PlanInclusions({ items, locate }: { items: PlanInclusion[]; locate: (item: PlanInclusion) => void }) {
  if (!items.length) return null;
  return <div className="mt-4 border-t border-border pt-3" data-testid="panel-plan-inclusions">
    <h3 className="text-[13px] font-semibold">Already included in your plan · {items.length}</h3>
    <p className="mt-1 text-[12.5px] text-muted-foreground">Accepted features stay here. Inclusion in the plan does not mean a feature can run.</p>
    <ul className="mt-3 space-y-3">
      {items.map((item) => <li key={item.key} data-testid={`plan-inclusion-${item.key}`} className="rounded-lg border border-border p-3">
        <div className="text-[13.5px] font-semibold">{item.name}</div>
        <div className="mt-0.5 text-[12.5px] text-muted-foreground">from {item.sourceName}{item.accepted ? " · accepted suggestion" : ""}</div>
        <div className="mt-2"><Tag tone={item.status === "active" ? "sky" : "sienna"}>{label(item)}</Tag></div>
        {item.status !== "active" && <p className="mt-2 text-[12.5px] text-muted-foreground">{item.reason}</p>}
        <button type="button" onClick={() => locate(item)} className={`${btn.quiet} mt-1 min-h-8 px-0 text-[12.5px]`} data-testid={`locate-plan-${item.key}`}><ArrowDown className="h-3.5 w-3.5" /> Show in workflow</button>
      </li>)}
    </ul>
  </div>;
}

/** Visible next to the engine, never connected to it as if these steps execute. */
export function UnmappedPlanSteps({ items }: { items: PlanInclusion[] }) {
  const missing = items.filter((x) => !x.represented);
  if (!missing.length) return null;
  return <div className="mt-5 rounded-xl border border-dashed border-current/40 p-4" data-testid="workflow-proposed-additions">
    <h3 className="text-[14px] font-semibold">Plan additions · not running</h3>
    <p className="mt-1 text-[12.5px] opacity-90">Saved in the plan, but not part of the current run. Each addition explains what is missing.</p>
    <ul className="mt-3 space-y-3">
      {missing.map((item) => <li key={item.key} id={inclusionNodeId(item)} tabIndex={-1} className="scroll-mt-28 rounded-lg border border-current/25 p-3 focus:outline focus:outline-2" data-testid={`proposed-plan-step-${item.key}`}>
        <div className="flex items-center gap-2"><CircleDashed className="h-4 w-4 shrink-0" /><span className="font-semibold">{item.name}</span></div>
        <p className="mt-1 text-[12.5px]">from {item.sourceName}{item.accepted ? " · accepted suggestion" : ""}</p>
        <p className="mt-1 text-[12.5px] font-semibold">{label(item)}</p>
        <p className="mt-1 text-[12.5px] opacity-90">{item.reason}</p>
      </li>)}
    </ul>
  </div>;
}

export function PlanStepAttribution({ items }: { items: PlanInclusion[] }) {
  if (!items.length) return null;
  return <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]" data-testid="workflow-plan-attribution">
    <Check className="h-3.5 w-3.5" /> In saved plan · {items.map((x) => `${x.sourceName}${x.accepted ? " (accepted suggestion)" : ""}`).join(", ")}
  </p>;
}
