import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Boxes, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { getGetPrototypeQueryKey, useGetPrototype, useRemovePrototype, useRestorePrototype, type RegisteredPrototype } from "@workspace/api-client-react";
import { Skel, Tag, btn, useUndoToast } from "@/components/bits";
import { AnalysisView, VERDICT } from "@/components/prototype-intake";
import { errMsg, useInvalidateAll } from "@/lib/case";
import { cn } from "@/lib/utils";

const PLATFORM_LABEL: Record<RegisteredPrototype["platformKind"], string> = { platform: "low-code platform", saas: "SaaS tool", agent_framework: "agent framework", notebook: "notebook", other: "tool" };

/** The prototype's own page section: what it declares, what its builder submitted, where the library says it fits. Removable, with undo. */
export function PrototypePanel({ prototype: p }: { prototype: RegisteredPrototype }) {
  const detail = useGetPrototype(p.id, { query: { queryKey: getGetPrototypeQueryKey(p.id) } });
  const remove = useRemovePrototype();
  const restore = useRestorePrototype();
  const invalidate = useInvalidateAll();
  const say = useUndoToast();
  const [, setLocation] = useLocation();
  const [examplesOpen, setExamplesOpen] = useState(false);

  const onRemove = () =>
    remove.mutate({ prototypeId: p.id }, {
      onSuccess: () => {
        invalidate();
        setLocation("/library");
        // mutateAsync: this panel has unmounted by the time Undo is pressed, and mutate() drops callbacks after unmount.
        say(`Removed ${p.name} from the library`, () => { void restore.mutateAsync({ prototypeId: p.id }).then(() => { invalidate(); setLocation(`/solutions/${p.id}`); say(`${p.name} is back`); }).catch((e: unknown) => say(errMsg(e))); });
      },
      onError: (e) => say(errMsg(e)),
    });

  return (
    <section className="mt-10" id="prototype" data-testid="panel-prototype">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[18px] font-semibold">About this prototype</h2>
        <span className="text-[13.5px] text-muted-foreground">Registered {new Date(p.createdAt).toLocaleDateString()} by {p.createdBy}.</span>
        <button data-testid="button-remove-prototype" disabled={remove.isPending} onClick={onRemove} className={cn(btn.quiet, "ml-auto")}><Trash2 className="h-4 w-4" /> Remove from library</button>
      </div>
      <div className="card-soft mt-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone="sienna" testid="tag-prototype-origin"><Boxes className="h-3 w-3" /> Prototype · runs on {p.platformName} · not run by FUSEBOX</Tag>
          <span className="text-[13.5px] text-muted-foreground">A {PLATFORM_LABEL[p.platformKind]}{p.link ? <> · <a href={p.link} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">open it</a></> : ""} · used by {p.users}</span>
        </div>
        <p className="mt-2 text-[15px]" data-testid="text-prototype-description">{p.description}</p>
        <div className="mt-4 flex flex-wrap gap-1.5" data-testid="list-declared-components">
          {p.components.map((c) => <Tag key={c.id} tone={VERDICT[c.verdict].tone} testid={`declared-${c.id}`}>{c.name} · {VERDICT[c.verdict].label}</Tag>)}
        </div>
        {p.comparedSolutionId && (
          <p className="mt-3 text-[14px]" data-testid="text-compared-with">
            Compared with <Link href={`/solutions/${p.comparedSolutionId}`} className="font-semibold text-primary underline-offset-2 hover:underline">{p.comparedSolutionName}</Link>.
          </p>
        )}
      </div>

      <div className="mt-4">
        <button data-testid="button-toggle-examples" onClick={() => setExamplesOpen((v) => !v)} className={btn.secondary} aria-expanded={examplesOpen}>
          {examplesOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Submitted examples ({p.examples.length})
        </button>
        {examplesOpen && (
          <div className="reveal mt-3 space-y-3" data-testid="panel-examples">
            {p.examples.map((ex, i) => (
              <div key={ex.id} className="card-soft p-4">
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[12px] text-muted-foreground">Example {i + 1}</span><Tag tone="slate">Submitted example · not run by FUSEBOX</Tag></div>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <div><div className="eyebrow mb-1">Input</div><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/60 p-3 font-mono text-[12.5px]">{ex.input}</pre></div>
                  <div><div className="eyebrow mb-1">Output the prototype produced</div><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/60 p-3 font-mono text-[12.5px]">{ex.output}</pre></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {detail.isLoading ? <Skel className="mt-4 h-40" /> : detail.data ? <AnalysisView analysis={detail.data.analysis} name={p.name} /> : null}
    </section>
  );
}

/** On a live product's page: the prototypes the library compared against it, for its owner to see. */
export function ComparedPrototypes({ items, solutionName }: { items: RegisteredPrototype[]; solutionName: string }) {
  return (
    <section className="mt-8" data-testid="panel-compared-prototypes">
      <h2 className="mb-1 flex items-center gap-2 text-[16px] font-semibold"><Boxes className="h-4 w-4 text-primary" /> Prototypes compared against {solutionName} ({items.length})</h2>
      <p className="mb-2 text-[13.5px] text-muted-foreground">Built outside FUSEBOX and registered through the prototype entrance. None of them runs here; their examples are their builders' claims.</p>
      <ul className="space-y-1.5">
        {items.map((p) => (
          <li key={p.id} data-testid={`compared-prototype-${p.id}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-[14.5px]">
            <span className="font-medium">{p.name}</span>
            <span className="text-[13px] text-muted-foreground">runs on {p.platformName} · {p.ownerName && p.ownerName !== "Unassigned" ? p.ownerName : "no owner"} · {p.components.map((c) => `${c.name} ${VERDICT[c.verdict].label.toLowerCase()}`).join(", ")}</span>
            <span className="flex-1" />
            <Link href={`/solutions/${p.id}`} data-testid={`link-compared-prototype-${p.id}`} className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-primary underline-offset-2 hover:underline">Open <ArrowRight className="h-3.5 w-3.5" /></Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
