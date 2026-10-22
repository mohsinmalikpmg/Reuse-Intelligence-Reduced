import { Link } from "wouter";
import { ArrowRight, X } from "lucide-react";
import type { QueueItem } from "@workspace/api-client-react";
import { Tag, btn } from "@/components/bits";
import { Consolidation } from "@/components/consolidation";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<QueueItem["kind"], string> = {
  consolidation_approval: "Awaiting IT approval",
  unowned_product: "No owner or support",
  migration_pending: "Migration not recorded",
  new_family_request: "New solution family requested",
  registered_prototype: "Prototype registered",
};

/** One exception in the IT review queue; consolidation rows open their decision panel inline. */
export function QueueRow({ item, open, settled, onToggle }: { item: QueueItem; open: boolean; settled: boolean; onToggle: () => void }) {
  const inline = !!item.caseId && item.kind !== "new_family_request";
  const href = item.kind === "new_family_request" && item.caseId ? `/workbench/${item.caseId}?mode=compare` : item.solutionId ? `/solutions/${item.solutionId}` : "/library";
  return (
    <li className={cn("rounded-xl border bg-card transition-[border-color]", open ? "border-primary" : "border-border")} data-testid={`queue-${item.id}`}>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-primary">{item.title}</span>
            <Tag tone={item.kind === "consolidation_approval" && !item.id.startsWith("record-") && !settled ? "sienna" : "muted"}>{item.id.startsWith("record-") ? "Record" : settled ? "Decided" : KIND_LABEL[item.kind]}</Tag>
            {item.demo && <Tag tone="sienna">demo data</Tag>}
          </div>
          <p className="mt-0.5 text-[13.5px]">{item.detail}</p>
          {item.usage && <p className="text-[12.5px] text-muted-foreground">{item.usage}</p>}
        </div>
        {inline ? (
          <button data-testid={`button-queue-action-${item.id}`} onClick={onToggle} className={open ? btn.secondary : btn.primary} aria-expanded={open}>
            {open ? <><X className="h-4 w-4" /> Close</> : item.actionLabel}
          </button>
        ) : (
          <Link href={href} data-testid={`button-queue-action-${item.id}`} className={btn.primary}>{item.actionLabel} <ArrowRight className="h-4 w-4" /></Link>
        )}
      </div>
      {open && item.caseId && (
        <div className="reveal border-t border-border p-4" data-testid={`queue-detail-${item.id}`}>
          <Consolidation caseId={item.caseId} initialSelection={item.kind === "migration_pending" ? item.solutionId : null} />
        </div>
      )}
    </li>
  );
}
