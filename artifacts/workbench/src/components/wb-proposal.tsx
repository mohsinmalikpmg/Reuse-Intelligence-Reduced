/**
 * Proposed workflow map: the case's current Version B configuration read as base -> borrowed -> to build.
 * Order and placement come from the saved configuration (step order) and each request's afterStepId; nothing is invented.
 * Uses the schematic's own .schem/.blk/.wire primitives so it reads as the same workbench.
 */
import { useState } from "react";
import { HelpCircle, X } from "lucide-react";
import { Wire, type LaneEntry } from "@/components/wb-schematic";
import { cn } from "@/lib/utils";

type Kind = "existing" | "borrowed" | "build";
type Node = { id: string; kind: Kind; name: string; stage: string; origin: string; why: string; need?: string };

export function proposalNodes(lane: LaneEntry[], baseName: string): Node[] {
  const out: Node[] = [];
  for (const x of lane) {
    if (x.kind === "request") {
      out.push({ id: `req:${x.req.id}`, kind: "build", name: x.req.need, stage: "To build", origin: "Still needed in this workflow", why: x.req.missing, need: x.req.need });
      continue;
    }
    const r = x.row;
    if (!r.b.active) continue; // switched off steps do not run, so they are not part of the proposed flow
    const borrowed = r.deviation === "added";
    out.push({ id: r.id, kind: borrowed ? "borrowed" : "existing", name: r.name, stage: r.stage, origin: borrowed ? r.source : baseName, why: r.description });
  }
  return out;
}

const tagText = (n: Node) => (n.kind === "existing" ? "Existing" : n.kind === "borrowed" ? `From ${n.origin}` : "To build");

function Block({ n, open, onPick }: { n: Node; open: boolean; onPick: () => void }) {
  const build = n.kind === "build";
  return (
    <button type="button" onClick={onPick} aria-pressed={open} data-testid={`proposal-node-${n.id}`} data-kind={n.kind}
      className={cn("relative flex min-h-[76px] w-full flex-col px-3 py-2 text-left md:w-[156px]",
        build ? "rounded-xl border border-dashed border-[#CE7642]/80 bg-[#3B2B26]/40 text-[#FFD9B8]" : cn("blk", n.kind === "borrowed" && "inserted"),
        open && (build ? "ring-1 ring-[#FFD09F]" : "open"))}>
      {!build && <><span aria-hidden className="port l max-md:hidden" /><span aria-hidden className="port r max-md:hidden" /></>}
      <span className={cn("inline-flex max-w-full items-center gap-1 self-start truncate rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[.1em]",
        n.kind === "existing" ? "bg-cyan/15 text-[#9ED9E3]" : n.kind === "borrowed" ? "bg-[#FF9B4C]/20 text-[#FFD09F]" : "text-[#E6A274]")}>
        {build && <HelpCircle className="h-2.5 w-2.5" />}<span className="truncate">{tagText(n)}</span>
      </span>
      <span className={cn("mt-1 line-clamp-2 text-[13px] font-semibold leading-tight", build ? "italic" : "text-[#E2F5F7]")}>{n.name}</span>
      <span className="mt-auto pt-1 font-mono text-[9.5px] uppercase tracking-[.1em] text-[#8EAEB7]">{build ? "does not run" : n.stage}</span>
    </button>
  );
}

function Link({ dashed }: { dashed: boolean }) {
  return (
    <>
      <span className="max-md:hidden">{dashed ? <span aria-hidden className="block h-0 w-[26px] flex-none self-center border-t-2 border-dashed border-[#CE7642]" /> : <Wire hot={false} />}</span>
      <span aria-hidden className={cn("mx-auto block h-4 w-0 md:hidden", dashed ? "border-l-2 border-dashed border-[#CE7642]" : "border-l-2 border-[#2C7182]")} />
    </>
  );
}

export function ProposalMap({ nodes, baseName }: { nodes: Node[]; baseName: string }) {
  const [sel, setSel] = useState<string | null>(null);
  const picked = nodes.find((n) => n.id === sel) ?? null;
  const counts = { existing: nodes.filter((n) => n.kind === "existing").length, borrowed: nodes.filter((n) => n.kind === "borrowed").length, build: nodes.filter((n) => n.kind === "build").length };
  return (
    <section className="schem relative" data-testid="proposal-map" aria-label="Proposed workflow">
      <div className="relative z-10 flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-4">
        <span className="text-[13.5px] font-semibold text-[#EAF9FB]">Proposed workflow</span>
        <span className="font-mono text-[10px] uppercase tracking-[.1em] text-[#7AA9B9]" data-testid="text-proposal-counts">{counts.existing} existing · {counts.borrowed} borrowed · {counts.build} to build</span>
      </div>
      <div className="relative z-10 flex flex-wrap gap-x-4 gap-y-1 px-5 pt-2 text-[11px] text-[#9FC2CB]">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-cyan/70" />Existing in {baseName}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#FF9B4C]" />From another solution</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm border border-dashed border-[#CE7642]" />To build</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-[2px] w-4 bg-[#2C7182]" />passes its output on</span>
      </div>
      <div className="relative z-10 px-5 pb-4 pt-4">
        {nodes.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#2A4E59] p-6 text-center text-[13.5px] text-[#9FC2CB]" data-testid="proposal-empty">No steps are active in this workflow yet.</p>
        ) : (
          <ol className="schem-row flex flex-col p-3.5 md:flex-row md:flex-wrap md:items-center md:gap-y-3" data-testid="proposal-chain">
            {nodes.map((n, i) => (
              <li key={n.id} className="flex flex-col md:flex-row md:items-center">
                {i > 0 && <Link dashed={n.kind === "build" || nodes[i - 1].kind === "build"} />}
                <Block n={n} open={sel === n.id} onPick={() => setSel(sel === n.id ? null : n.id)} />
              </li>
            ))}
          </ol>
        )}
      </div>
      {picked && (
        <div className="relative z-10 border-t border-white/10 bg-[#0D2C38] px-5 py-4" data-testid="proposal-detail" aria-live="polite">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] uppercase tracking-[.1em] text-[#E6A274]">{tagText(picked)}</div>
              <h3 className="mt-0.5 break-words text-[16px] font-semibold text-[#EAF9FB]">{picked.name}</h3>
              <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-[13px] text-[#C9E4EA] sm:grid-cols-[auto_1fr]">
                <dt className="text-[#7AA9B9]">{picked.kind === "build" ? "Needed" : "What it does"}</dt><dd className="break-words">{picked.kind === "build" ? picked.need : picked.why}</dd>
                {picked.kind === "build" && <><dt className="text-[#7AA9B9]">Missing today</dt><dd className="break-words">{picked.why}</dd></>}
                <dt className="text-[#7AA9B9]">Origin</dt><dd className="break-words">{picked.origin}</dd>
              </dl>
            </div>
            <button type="button" onClick={() => setSel(null)} aria-label="Close detail" data-testid="button-close-proposal-detail" className="rounded p-1 text-[#9FC2CB] hover:bg-white/10"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </section>
  );
}
