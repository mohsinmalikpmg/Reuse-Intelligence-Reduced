import { Link } from "wouter";
import { Tag } from "@/components/bits";
import { COVERAGE, EVIDENCE_LEVEL, type DiscoveryRequirementCoverage } from "@/lib/discovery";
import type { Composition } from "@/lib/composition";

function Row({ r, name }: { r: DiscoveryRequirementCoverage; name: (id: string) => string }) {
  const s = COVERAGE[r.status] ?? { l: r.status, tone: "muted" as const };
  return (
    <li className="border-t border-border py-2.5 first:border-t-0" data-testid={`ledger-${r.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="slate">P{r.priority}</Tag>
        <Tag tone={s.tone} testid={`ledger-status-${r.id}`}>{s.l}</Tag>
        {r.untestedConstraints.length > 0 && <Tag tone="muted">Not checked by demo</Tag>}
        <span className="min-w-0 flex-1 text-[13.5px]">{r.text}</span>
      </div>
      {r.note && <p className="mt-1 text-[12.5px] text-muted-foreground">{r.note}</p>}
      {(r.matches.length > 0 || r.limitations.length > 0 || r.untestedConstraints.length > 0) && <details className="mt-1 text-[12.5px]">
        <summary className="cursor-pointer text-primary">Evidence ({r.matches.length})</summary>
        <ul className="mt-1 space-y-1">{r.matches.map((m, i) => <li key={i} className={m.selected ? "" : "opacity-60"}>
          <Link href={`/solutions/${m.sourceSolutionId}`} className="font-medium text-primary hover:underline">{name(m.sourceSolutionId)}</Link> · {m.capabilityId}{" "}
          <Tag tone={m.coverage === "proposed" ? "sky" : "sienna"}>{m.coverage}</Tag> <Tag tone="muted">{EVIDENCE_LEVEL[m.evidenceLevel] ?? m.evidenceLevel}</Tag>
          {!m.selected && <> <Tag tone="muted">Not in plan</Tag></>} <span className="text-muted-foreground">{m.reason}</span>
        </li>)}</ul>
        {r.limitations.length > 0 && <ul className="mt-1 list-disc pl-5">{r.limitations.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        {r.untestedConstraints.length > 0 && <p className="mt-1">Untested: {r.untestedConstraints.join("; ")}</p>}
      </details>}
    </li>
  );
}

/** Every original requirement and where the plan stands on it. Nothing is hidden for being unmet. */
export function RequirementLedger({ c, rows: override }: { c: Composition; rows?: DiscoveryRequirementCoverage[] }) {
  const snap = c.discoverySnapshot;
  const rows = override ?? c.requirementCoverage ?? [];
  if (!snap && rows.length === 0) return null;
  const merged = [...rows];
  for (const q of snap?.requirements ?? []) if (!rows.some((r) => r.id === q.id)) merged.push({ id: q.id, text: q.text, priority: q.priority, status: "no-match", matches: [], limitations: [], untestedConstraints: [], note: "" });
  merged.sort((a, b) => a.priority - b.priority);
  const nameOf = (id: string) => (c.sourceEvidence.find((s) => s.solutionId === id)?.name as string | undefined) ?? id;
  const open = merged.filter((r) => r.status !== "proposed").length;
  const untested = [...new Set(merged.flatMap((r) => r.untestedConstraints))];
  return (
    <section className="card-soft p-5" data-testid="panel-requirement-ledger" aria-labelledby="ledger-h">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="ledger-h" className="text-[16px] font-semibold">Original requirements</h2>
        <Tag tone={open ? "sienna" : "sky"}>{open ? `${open} not covered by this plan` : "All proposed"}</Tag>
      </div>
      {snap && <div className="mt-1 text-[12.5px] text-muted-foreground" data-testid="text-ledger-source">
        <p>From intake <Link href={`/discover?brief=${encodeURIComponent(snap.briefId)}&results=1`} className="text-primary underline">{snap.briefId}</Link>, revision {snap.sourceRevision}
          {snap.intakeId ? ` · intake ${snap.intakeId}${snap.intakeRevision !== null ? ` r${snap.intakeRevision}` : ""}` : ""} · captured {new Date(snap.capturedAt).toLocaleString()}
          {snap.targetGroup ? ` · for ${snap.targetGroup}` : ""}. Proposed coverage is not demonstrated fulfillment.</p>
        {snap.constraints && <p className="mt-0.5">Constraints: {snap.constraints}</p>}
        {snap.requiredControls && <p className="mt-0.5">Required controls: {snap.requiredControls}</p>}
      </div>}
      <ol className="mt-2">{merged.map((r) => <Row key={r.id} r={r} name={nameOf} />)}</ol>
      {untested.length > 0 && <div className="mt-3 text-[12.5px]" data-testid="list-untested-constraints">
        <h3 className="font-semibold uppercase tracking-[0.06em] text-muted-foreground">Untested constraints</h3>
        <ul className="mt-1 list-disc pl-5">{untested.map((x, i) => <li key={i}>{x}</li>)}</ul>
      </div>}
    </section>
  );
}
