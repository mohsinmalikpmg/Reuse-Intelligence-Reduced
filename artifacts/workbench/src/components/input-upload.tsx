import { useEffect, useRef, useState } from "react";
import { validateWorkbenchInput, type WorkbenchInputValidation } from "@workspace/api-client-react";
import { httpStatus } from "@/lib/case";
import { Check, Download, FileUp, X } from "lucide-react";
import { btn } from "@/components/bits";
import { cn } from "@/lib/utils";

const MAX = 256 * 1024;
const EXT = [".txt", ".csv", ".json"];

/** Generated call; 4xx bodies still carry the validation result (issues, contracts), surfaced through the thrown error's data. */
async function validateInput(targetId: string, file: File): Promise<{ ok: boolean; status: number; v: WorkbenchInputValidation | null; error?: string }> {
  try {
    return { ok: true, status: 200, v: await validateWorkbenchInput(targetId, { file }) };
  } catch (e) {
    const status = httpStatus(e);
    if (status === null) throw e;
    const d = (e as { data?: unknown }).data as (WorkbenchInputValidation & { error?: string }) | null | undefined;
    return { ok: false, status, v: d && typeof d === "object" && "compatible" in d ? d : null, error: d?.error };
  }
}

const EXAMPLE = "id,date,site,equipment,note\nWO-1041,2026-03-02,North yard,Pump P-12,Seal leaking again after last week's repair\nWO-1042,2026-03-03,Plant 2,Conveyor C-4,Belt slipping under load; tension checked\n";
function downloadExample() {
  const url = URL.createObjectURL(new Blob([EXAMPLE], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = "work-orders-example.csv"; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type State = { phase: "idle" } | { phase: "checking"; name: string } | { phase: "loaded"; name: string; count: number } | { phase: "rejected"; name: string; reasons: string[]; fields: string[] } | { phase: "checked"; name: string; ok: boolean; reasons: string[] };

/**
 * Load your own work-order file. On success the parsed text replaces the current input (onAccept);
 * on rejection the previous input stays exactly as it was. Without onAccept it only checks fit (proposals).
 */
export function InputUpload({ targetId, onAccept, fixedNote, currentText }: { targetId: string; onAccept?: (text: string, filename: string) => void; fixedNote?: string; currentText?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const accepted = useRef<string | null>(null);
  const [st, setSt] = useState<State>({ phase: "idle" });
  // A different workbench: forget any status and drop pending reads.
  useEffect(() => { seq.current++; accepted.current = null; setSt({ phase: "idle" }); }, [targetId]);
  // The user picked a sample or typed: a pending file must not overwrite that, and "loaded" is no longer true.
  useEffect(() => {
    if (currentText === undefined || currentText === accepted.current) return;
    seq.current++; accepted.current = null;
    setSt((x) => (x.phase === "loaded" || x.phase === "checking" ? { phase: "idle" } : x));
  }, [currentText]);
  if (fixedNote) return <p className="mt-2 text-[12.5px] text-muted-foreground" data-testid="text-input-fixed">{fixedNote}</p>;

  const pick = async (file: File) => {
    const my = ++seq.current;
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!EXT.includes(ext)) { setSt({ phase: "rejected", name: file.name, reasons: [`${ext || "This file type"} is not supported. Use .txt, .csv or .json.`], fields: [] }); return; }
    if (file.size > MAX) { setSt({ phase: "rejected", name: file.name, reasons: [`File is ${Math.ceil(file.size / 1024)} KB; the limit is 256 KB.`], fields: [] }); return; }
    if (file.size === 0) { setSt({ phase: "rejected", name: file.name, reasons: ["The file is empty."], fields: [] }); return; }
    setSt({ phase: "checking", name: file.name });
    try {
      const r = await validateInput(targetId, file);
      if (my !== seq.current) return; // a newer file was picked meanwhile
      const v = r.v;
      // normalizedInputText may be null on compatible-but-not-runnable results.
      const reasons = v ? [...v.issues.map((i) => `${i.row ? `Row ${i.row}: ` : ""}${i.field ? `${i.field}: ` : ""}${i.message}`), ...v.contracts.filter((c) => !c.compatible && c.reason).map((c) => c.reason)] : [];
      const fields = v ? [...new Set(v.contracts.flatMap((c) => c.expectedFields))] : [];
      if (!onAccept) { setSt({ phase: "checked", name: file.name, ok: !!v?.compatible, reasons: reasons.length ? reasons : v?.limitations ?? [r.error ?? "Could not check this file."] }); return; }
      if (r.ok && v?.compatible && v.runnable && v.normalizedInputText) {
        accepted.current = v.normalizedInputText;
        onAccept(v.normalizedInputText, file.name);
        setSt({ phase: "loaded", name: file.name, count: v.recordCount });
      } else {
        const why = r.status === 401 ? "Sign in to load your own file." : r.status === 413 ? "File is over 256 KB." : r.status === 404 ? "This workbench is not yours or no longer exists." : null;
        setSt({ phase: "rejected", name: file.name, reasons: why ? [why] : reasons.length ? reasons : [r.error ?? v?.limitations?.[0] ?? "This file does not fit this workflow."], fields });
      }
    } catch {
      if (my === seq.current) setSt({ phase: "rejected", name: file.name, reasons: ["Could not reach the server. Your current input is unchanged; try again."], fields: [] });
    }
  };

  return (
    <div className="mt-2" data-testid="panel-input-upload">
      <input ref={ref} type="file" accept=".txt,.csv,.json,text/plain,text/csv,application/json" className="sr-only" data-testid="input-upload-file"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cn(btn.secondary, "min-h-9 px-3 text-[13px]")} disabled={st.phase === "checking"} onClick={() => ref.current?.click()} data-testid="button-upload-input">
          <FileUp className="h-4 w-4" /> {st.phase === "checking" ? `Checking ${st.name}…` : onAccept ? "Use my own file" : "Check a file against this plan"}
        </button>
        <details className="text-[12px] text-muted-foreground"><summary className="cursor-pointer">Format</summary>
          <p className="mt-1 max-w-sm">.txt (one note per line, or id|date|site|equipment|note), .csv with header id,date,site,equipment,note, or .json array of those fields. Up to 256 KB.</p>
          <button type="button" onClick={downloadExample} className="mt-1 inline-flex items-center gap-1 text-primary hover:underline" data-testid="button-download-example"><Download className="h-3.5 w-3.5" /> Example CSV</button>
        </details>
      </div>
      {st.phase === "loaded" && <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-primary" data-testid="text-upload-loaded"><Check className="h-3.5 w-3.5" /> {st.name} · {st.count} record{st.count === 1 ? "" : "s"} loaded as input</p>}
      {st.phase === "checked" && <div className="mt-1.5 text-[12.5px]" data-testid="text-upload-checked"><span className={st.ok ? "text-primary" : "text-siennaink"}>{st.name} · {st.ok ? "fits the selected capabilities, not runnable yet" : "does not fit"}</span>{st.reasons.length > 0 && <ul className="mt-0.5 list-disc pl-5 text-muted-foreground">{st.reasons.slice(0, 5).map((x, i) => <li key={i}>{x}</li>)}</ul>}</div>}
      {st.phase === "rejected" && <div role="alert" className="mt-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] text-siennaink" data-testid="text-upload-error">
        <div className="flex items-center gap-1.5 font-medium"><X className="h-3.5 w-3.5" /> {st.name} not loaded. Your current input is unchanged.</div>
        <ul className="mt-0.5 list-disc pl-5">{st.reasons.slice(0, 5).map((x, i) => <li key={i}>{x}</li>)}</ul>
        {st.fields.length > 0 && <p className="mt-0.5">Expected fields: {st.fields.join(", ")}</p>}
      </div>}
    </div>
  );
}
