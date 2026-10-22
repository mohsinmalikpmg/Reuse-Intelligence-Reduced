import { Link } from "wouter";
import { ArrowRight, X } from "lucide-react";
import { useTry } from "@/components/family-card";
import { btn } from "@/components/bits";
import { EVIDENCE_LABEL, orUnknown, readinessOf, roleLabel, type Entry } from "./seeker-library-model";

export function SeekerCompare({ picked, onRemove, onClear }: { picked: Entry[]; onRemove: (id: string) => void; onClear: () => void }) {
  const { go, busy } = useTry();
  if (picked.length === 0) return null;
  const caps = new Map<string, string>();
  picked.forEach((e) => e.caps.forEach((c) => caps.set(c.id, c.name)));
  return (
    <section aria-labelledby="compare-heading" className="card-soft mt-8 p-5" data-testid="seeker-compare">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="compare-heading" className="text-[18px] font-semibold">Compare {picked.length} of 3</h2>
        <button className={btn.quiet} onClick={onClear} data-testid="button-compare-clear">Clear</button>
      </div>
      {picked.length < 2 && <p className="mt-1 text-[13.5px] text-muted-foreground">Pick one more to see them side by side.</p>}
      <div className="mt-4 overflow-x-auto rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" tabIndex={0} role="region" aria-labelledby="compare-heading">
        <table className="w-full min-w-[520px] border-collapse text-left text-[14px]">
          <caption className="sr-only">Selected solutions compared by coverage, readiness and recorded evidence</caption>
          <thead>
            <tr>
              <th scope="col" className="w-40 p-2 text-[12.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">Solution</th>
              {picked.map((e) => (
                <th key={e.key} scope="col" className="p-2 align-top">
                  <div className="flex items-start gap-1">
                    <Link href={`/solutions/${e.s.id}`} className="font-semibold text-primary hover:underline">{e.s.name}</Link>
                    <button aria-label={`Remove ${e.s.name} from comparison`} onClick={() => onRemove(e.s.id)} className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
                  </div>
                  <div className="text-[12.5px] font-normal text-muted-foreground">{roleLabel(e)} · v{e.s.currentVersion}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border border-t border-border">
            <tr><th scope="row" className="p-2 font-medium text-muted-foreground">Outcome</th>{picked.map((e) => <td key={e.key} className="p-2 align-top">{e.s.outcome}</td>)}</tr>
            <tr><th scope="row" className="p-2 font-medium text-muted-foreground">Readiness</th>{picked.map((e) => <td key={e.key} className="p-2">{readinessOf(e.s) === "live" ? "Runs on your input" : "Preview only"} · {e.s.status}</td>)}</tr>
            <tr><th scope="row" className="p-2 font-medium text-muted-foreground">Evidence</th>{picked.map((e) => <td key={e.key} className="p-2">{EVIDENCE_LABEL[e.s.evidenceLevel]}</td>)}</tr>
            <tr><th scope="row" className="p-2 font-medium text-muted-foreground">Provenance</th>{picked.map((e) => {
              const src = Array.from(new Map(e.caps.map((c) => [c.sourceSolutionId, c.sourceSolutionName])).entries()).filter(([, n]) => !!n);
              return <td key={e.key} className="p-2 align-top">{e.s.origin ? "Registered prototype" : "Library record"}{src.length > 0 && <> · from {src.map(([id, n], i) => <span key={id}>{i > 0 && ", "}<Link href={`/solutions/${id}`} className="text-primary hover:underline">{n}</Link></span>)}</>}</td>;
            })}</tr>
            <tr><th scope="row" className="p-2 font-medium text-muted-foreground">Owner</th>{picked.map((e) => <td key={e.key} className="p-2">{orUnknown(e.s.ownerName)}</td>)}</tr>
            {[...caps].map(([id, name]) => (
              <tr key={id}>
                <th scope="row" className="p-2 font-normal">{name}</th>
                {picked.map((e) => {
                  const has = e.caps.some((c) => c.id === id);
                  return <td key={e.key} className="p-2">{has ? <span className="font-semibold text-ok">Covered</span> : <span className="text-muted-foreground">Not covered</span>}</td>;
                })}
              </tr>
            ))}
            <tr>
              <th scope="row" className="p-2 font-medium text-muted-foreground">Next step</th>
              {picked.map((e) => (
                <td key={e.key} className="p-2">
                  {readinessOf(e.s) === "live"
                    ? <button className={btn.secondary} disabled={busy} onClick={() => go({ baseSolutionId: e.s.id })} data-testid={`button-compare-try-${e.s.id}`}>Try with my input <ArrowRight className="h-4 w-4" /></button>
                    : <span className="text-[13px] text-muted-foreground">Preview only, cannot run</span>}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
