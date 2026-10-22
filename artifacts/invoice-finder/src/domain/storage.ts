import { validateState } from "./validate.ts";
import type { AppState } from "./types.ts";

export const STORAGE_KEY = "invoice-finder:v1:state";

export type LoadResult =
  | { kind: "empty" }
  | { kind: "ok"; state: AppState }
  | { kind: "error"; error: string };

/** Pure parse of a stored string. Corruption is reported, never silently reseeded. */
export function parseStored(raw: string | null): LoadResult {
  if (raw === null) return { kind: "empty" };
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return { kind: "error", error: "Stored data is not valid JSON." }; }
  if (!data || typeof data !== "object") return { kind: "error", error: "Stored data is not an object." };
  const s = data as AppState;
  if (s.schemaVersion !== 1) return { kind: "error", error: `Unsupported schema version: ${String(s.schemaVersion)}.` };
  for (const k of ["suppliers", "afes", "pars", "invoices", "decisions"] as const) {
    if (!Array.isArray(s[k])) return { kind: "error", error: `Stored data missing array "${k}".` };
  }
  const errs = validateState(s);
  if (errs.length) return { kind: "error", error: `Stored data failed validation: ${errs.join("; ")}` };
  return { kind: "ok", state: s };
}
