import { STATUSES } from "../domain/types.ts";
import type { Status } from "../domain/types.ts";
import { EMPTY_CRITERIA } from "../domain/search.ts";
import type { SearchCriteria } from "../domain/search.ts";

/** Keeps the search in the URL so a refresh or shared link restores context. */
export function criteriaFromUrl(search: string): { criteria: SearchCriteria; selected: string | null } {
  const q = new URLSearchParams(search);
  const num = (k: string) => { const v = q.get(k); return v !== null && /^\d+$/.test(v) ? Number(v) : null; };
  return {
    criteria: {
      ...EMPTY_CRITERIA,
      supplierId: q.get("supplier") ?? "", text: q.get("q") ?? "", mode: q.get("mode") === "exact" ? "exact" : "fuzzy",
      dateFrom: q.get("from") ?? "", dateTo: q.get("to") ?? "",
      minCents: num("min"), maxCents: num("max"),
      statuses: (q.get("status") ?? "").split(",").filter((s): s is Status => (STATUSES as string[]).includes(s)),
      afeId: q.get("afe") ?? "", parId: q.get("par") ?? "",
    },
    selected: q.get("inv"),
  };
}

export function criteriaToUrl(c: SearchCriteria, selected: string | null): string {
  const q = new URLSearchParams();
  if (c.text) q.set("q", c.text);
  if (c.mode === "exact") q.set("mode", "exact");
  if (c.supplierId) q.set("supplier", c.supplierId);
  if (c.dateFrom) q.set("from", c.dateFrom);
  if (c.dateTo) q.set("to", c.dateTo);
  if (c.minCents !== null) q.set("min", String(c.minCents));
  if (c.maxCents !== null) q.set("max", String(c.maxCents));
  if (c.statuses.length) q.set("status", c.statuses.join(","));
  if (c.afeId) q.set("afe", c.afeId);
  if (c.parId) q.set("par", c.parId);
  if (selected) q.set("inv", selected);
  const s = q.toString();
  return s ? `?${s}` : window.location.pathname;
}
