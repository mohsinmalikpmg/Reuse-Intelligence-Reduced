import { useCallback, useEffect, useState } from "react";

const EVT = "ops-query-change";

/** URL query state. Patches preserve every other param (recipe, consolidationCaseId, search context). */
export function useQueryParams(): [URLSearchParams, (patch: Record<string, string | null>, push?: boolean) => void] {
  const [search, setSearch] = useState(() => window.location.search);
  useEffect(() => {
    const on = () => setSearch(window.location.search);
    window.addEventListener("popstate", on);
    window.addEventListener(EVT, on);
    return () => { window.removeEventListener("popstate", on); window.removeEventListener(EVT, on); };
  }, []);
  const set = useCallback((patch: Record<string, string | null>, push = false) => {
    const p = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") p.delete(k); else p.set(k, v); }
    const qs = p.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    if (push) window.history.pushState(null, "", url); else window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event(EVT));
  }, []);
  return [new URLSearchParams(search), set];
}

export const FILTER_KEYS = ["q", "mode", "sup", "afe", "par", "st", "from", "to", "min", "max", "stage", "queue"] as const;
