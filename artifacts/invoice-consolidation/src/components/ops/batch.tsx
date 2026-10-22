import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { preview, apply, readLedger, type DecisionEvent, type Role, type BulkAction, type BulkPreview } from "@/domain/engine";
import type { Recipe } from "@/domain/recipe";
import { cad } from "./shared";

/** Staged decision flow: preview against the current ledger, then re-read storage and refuse if it moved. */
export function useBatch({ recipe, ledger, role, reason, commit, onError, onDone }: {
  recipe: Recipe; ledger: readonly DecisionEvent[]; role: Role; reason: string;
  commit: (l: readonly DecisionEvent[], m: string) => void; onError: (m: string) => void; onDone: () => void;
}) {
  const [pv, setPv] = useState<BulkPreview | null>(null);
  const [basis, setBasis] = useState<string>("");
  const [applyErr, setApplyErr] = useState<string | null>(null);
  const sig = (l: readonly DecisionEvent[]) => `${l.length}:${l[l.length - 1]?.id ?? ""}`;

  const open = (ids: string[], action: BulkAction) => {
    setApplyErr(null);
    try { setPv(preview(recipe, ledger, ids, action, role, reason)); setBasis(sig(ledger)); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  const confirm = () => {
    if (!pv) return;
    try {
      const fresh = readLedger(recipe, localStorage);
      if (sig(fresh) !== basis) { setApplyErr("The ledger changed in another tab since this preview was built. Nothing was written."); return; }
      const batchId = `B${Date.now().toString(36).toUpperCase()}`;
      const out = apply(recipe, fresh, pv, batchId, new Date().toISOString());
      commit(out.ledger, `Batch ${batchId}: ${out.applied.length} ${pv.action === "reject" ? "rejections" : "approval steps"} recorded, ${out.skipped.length} skipped. Approval may advance the stage while the invoice remains pending.`);
      setPv(null); onDone();
    } catch (e) { setApplyErr(e instanceof Error ? e.message : String(e)); }
  };

  const dialog = (
    <Dialog open={!!pv} onOpenChange={o => { if (!o) setPv(null); }}>
      <DialogContent className="max-w-2xl rounded-none border-foreground/30 bg-card">
        {pv && <>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl capitalize">{pv.action} preview</DialogTitle>
            <DialogDescription>As <b className="capitalize">{pv.role}</b>{pv.reason ? <> with reason "{pv.reason}"</> : null}. {pv.eligible.length} eligible ({cad(pv.eligibleTotalCents)}) of {pv.lines.length} selected ({cad(pv.selectedTotalCents)}).</DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto border border-border text-sm">
            {pv.lines.map((l, k) => (
              <div key={`${l.invoiceId}-${k}`} className={`grid grid-cols-[3rem_1fr_auto] gap-3 border-b border-border/60 px-3 py-2 last:border-0 ${l.eligible ? "" : "opacity-70"}`}>
                <span className="num text-xs">{l.invoiceId}</span>
                <span><span className={l.eligible ? "text-[hsl(158_40%_28%)] dark:text-[hsl(158_45%_66%)]" : "text-destructive"}>{l.eligible ? "Will apply" : "Skipped"}</span> <span className="text-muted-foreground">- {l.why}</span>
                  {l.eligible && <span className="num block text-[11px] text-muted-foreground">{l.fromStatus}/{l.fromStage ?? "-"} &rarr; {l.toStatus}/{l.toStage ?? "-"}</span>}</span>
                <span className="num text-xs">{cad(l.amountCents)}</span>
              </div>
            ))}
          </div>
          {pv.duplicateIds.length > 0 && <p className="text-xs text-muted-foreground">Repeated selections ignored: {pv.duplicateIds.join(", ")}</p>}
          {pv.blockers.map(b => <p key={b} className="text-sm text-destructive">{b}</p>)}
          {applyErr && <p role="alert" className="border border-destructive/40 p-2 text-sm text-destructive">{applyErr} Close and preview again.</p>}
          <DialogFooter>
            <button onClick={() => setPv(null)} className="border border-border px-4 py-2 text-sm">Cancel</button>
            <button data-testid="button-apply-batch" onClick={confirm} disabled={pv.blockers.length > 0 || !!applyErr || pv.eligible.length === 0} className="bg-accent px-4 py-2 text-sm text-accent-foreground disabled:opacity-40">Apply {pv.eligible.length} decisions</button>
          </DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  );
  return { open, dialog };
}
