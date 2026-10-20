import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { useListCases, type CaseStatus } from "@workspace/api-client-react";
import { useRole } from "@/lib/persona";
import { CaseRow } from "@/components/blocks";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/kit";
import { caseStatus } from "@/lib/labels";
import { cn } from "@/lib/utils";

const COPY = {
  seeker: { title: "Saved cases", sub: "Every reuse case you started or saved, with its next step." },
  owner: { title: "Change requests", sub: "Proposed changes to products you own, waiting on your call." },
  it: { title: "Consolidation cases", sub: "Every case moving duplicated solutions toward one product." },
} as const;

export default function Cases() {
  const role = useRole();
  const [status, setStatus] = useState<CaseStatus | undefined>(role === "owner" ? "pilot_proposed" : undefined);
  const q = useListCases(status ? { status } : undefined);
  const filters: (CaseStatus | undefined)[] = role === "owner" ? ["pilot_proposed", "simulated", undefined] : [undefined, "draft", "simulated", "pilot_proposed", "approved", "changes_requested", "deferred", "rejected"];
  const rows = role === "seeker" ? q.data : q.data;

  return (
    <div>
      <PageHeader eyebrow="Cases" title={COPY[role].title} sub={COPY[role].sub} />
      <div className="mb-4 flex flex-wrap gap-1">
        {filters.map((s) => (
          <button key={s ?? "all"} onClick={() => setStatus(s)} data-testid={`button-filter-${s ?? "all"}`} className={cn("rounded border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider", status === s ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted")}>
            {s ? caseStatus[s][0] : "All"}
          </button>
        ))}
      </div>
      {q.isError && <ErrorState onRetry={() => q.refetch()} />}
      {q.isLoading && <LoadingRows rows={5} />}
      {rows?.length === 0 && <EmptyState icon={<FolderOpen className="h-5 w-5" />} title="No cases in this state" body="Try another status, or start from Discover." />}
      <div className="space-y-2">
        {rows?.map((c, i) => (
          <CaseRow key={c.case.id} c={c} i={i} href={role !== "seeker" && c.case.status === "pilot_proposed" ? `/cases/${c.case.id}/review` : undefined} />
        ))}
      </div>
    </div>
  );
}
