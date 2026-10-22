import { Fragment, useState } from "react";
import { Link } from "wouter";
import { ChevronDown } from "lucide-react";
import type { CapabilityExplorerEntry } from "@workspace/api-client-react";
import { Tag, btn } from "@/components/bits";
import { cn } from "@/lib/utils";

const NA = <span className="text-muted-foreground">Not assessed</span>;
const REUSE: Record<CapabilityExplorerEntry["reuse"], { label: string; tone: "green" | "muted" | "slate" }> = {
  shared: { label: "Shared", tone: "green" },
  single_app: { label: "Single app", tone: "slate" },
  not_assessed: { label: "Reuse not assessed", tone: "muted" },
};

export function CapabilityCard({ c }: { c: CapabilityExplorerEntry }) {
  const [open, setOpen] = useState(false);
  const i = c.implementation;
  const tech: [string, string | null][] = [
    ["Platform / tool", i.platform], ["Architecture", i.architecture], ["Architecture approval (governance)", i.governanceStatus], ["Execution", i.execution === "live" ? "Runs in FUSEBOX" : i.execution === "preview" ? "Preview only, not run" : null],
    ["Control type", i.controlType], ["Version", i.version], ["Test coverage", i.testCoverage], ["Support", i.supportStatus], ["Evidence", i.evidenceLevel],
  ];
  return (
    <li className="rounded-xl border border-border bg-card p-4" data-testid={`capability-${c.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-primary">{c.name}</span>
        <Tag tone={REUSE[c.reuse].tone}>{REUSE[c.reuse].label}</Tag>
        {c.demo ? <Tag tone="sienna">demo data</Tag> : <Tag tone="sky">registered</Tag>}
        <span className="ml-auto font-mono text-[11.5px] uppercase tracking-wider text-muted-foreground">{c.category ?? "Feature not assessed"}{c.workflowStep ? ` · ${c.workflowStep}` : ""}</span>
      </div>
      <p className="mt-1 text-[13.5px] leading-relaxed">{c.purpose || NA}</p>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Provenance</dt><dd>{c.provenance}</dd>
        <dt className="text-muted-foreground">Owner</dt><dd>{c.ownerName ?? NA}</dd>
        <dt className="text-muted-foreground">Source apps</dt>
        <dd className="flex flex-wrap gap-x-2">{c.sourceApps.length ? c.sourceApps.map((s) => (
          s.link ? <Link key={s.id} href={s.link} className="text-primary underline-offset-2 hover:underline">{s.name}{s.origin ? " (origin)" : ""}</Link> : <span key={s.id}>{s.name} ({s.status ?? "registered"})</span>
        )) : NA}</dd>
      </dl>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid={`button-tech-${c.id}`} className={cn(btn.quiet, "-ml-3 mt-1")}>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} /> Technical details
      </button>
      {open && (
        <dl className="reveal mt-1 grid gap-x-6 gap-y-1 rounded-lg bg-secondary/60 p-3 text-[13px] sm:grid-cols-[auto_1fr]" data-testid={`tech-${c.id}`}>
          {tech.map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{v ?? NA}</dd></Fragment>)}
          <dt className="text-muted-foreground">Depends on</dt><dd>{i.dependsOn.length ? i.dependsOn.join(", ") : "None declared"}</dd>
        </dl>
      )}
    </li>
  );
}
