// Browser binding for the pure ledger: localStorage persistence, multi-tab freshness.
import { useCallback, useEffect, useState } from "react";
import { SEED } from "./domain/seed.ts";
import { appendDecision } from "./domain/ledger.ts";
import type { Action, DecisionEvent, InvoiceState, Role } from "./domain/ledger.ts";
import { applyBulk } from "./domain/bulk.ts";
import type { BulkOutcome, BulkPreview } from "./domain/bulk.ts";
import { loadLedger, resetLedger, saveLedger, STORAGE_KEY } from "./domain/storage.ts";

export type LedgerView =
  | { kind: "ok"; events: readonly DecisionEvent[]; states: Map<string, InvoiceState>; fresh: boolean }
  | { kind: "error"; error: string };

const ROLE_KEY = "approval-desk:simulated-role";

function storage(): Storage {
  return window.localStorage;
}

function read(): LedgerView {
  try {
    const r = loadLedger(storage(), SEED);
    return r.ok ? { kind: "ok", ...r.value } : { kind: "error", error: r.error };
  } catch (e) {
    return { kind: "error", error: `Browser storage is unavailable: ${(e as Error).message}` };
  }
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `ev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useLedger() {
  const [view, setView] = useState<LedgerView>(read);
  const [syncedAt, setSyncedAt] = useState(() => new Date());
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setView(read());
    setSyncedAt(new Date());
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) {
        refresh();
        setNotice("Ledger updated in another tab; view refreshed.");
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  /** Re-reads storage first so a stale tab never overwrites newer events. */
  const decide = useCallback((invoiceId: string, action: Action, role: Role, reason: string): { ok: true } | { ok: false; error: string } => {
    const current = read();
    setView(current);
    if (current.kind === "error") return { ok: false, error: current.error };
    const r = appendDecision(SEED, current.events, newId(), { invoiceId, action, role, reason, at: new Date().toISOString() });
    if (!r.ok) return r;
    const w = saveLedger(storage(), r.value);
    if (!w.ok) return w;
    setView(read());
    setSyncedAt(new Date());
    return { ok: true };
  }, []);

  /** Bulk: re-read storage, re-validate preview, apply all eligible in ONE write. */
  const bulk = useCallback((preview: BulkPreview): { ok: true; value: BulkOutcome } | { ok: false; error: string } => {
    const current = read();
    setView(current);
    setSyncedAt(new Date());
    if (current.kind === "error") return { ok: false, error: current.error };
    const r = applyBulk(SEED, current.events, preview, { batchId: `batch-${newId()}`, at: new Date().toISOString(), newId: () => newId() });
    if (!r.ok) return r;
    const w = saveLedger(storage(), r.value.ledger);
    if (!w.ok) return { ok: false, error: `${w.error} Nothing was applied.` };
    setView(read());
    return r;
  }, []);

  const reset = useCallback((): { ok: true } | { ok: false; error: string } => {
    let r;
    try { r = resetLedger(storage()); } catch (e) { r = { ok: false as const, error: (e as Error).message }; }
    if (!r.ok) return r;
    refresh();
    return { ok: true };
  }, [refresh]);

  return { view, syncedAt, notice, clearNotice: () => setNotice(null), refresh, decide, bulk, reset };
}

export function useRole(): [Role, (r: Role) => void] {
  const [role, setRoleState] = useState<Role>(() => {
    try {
      const r = window.localStorage.getItem(ROLE_KEY);
      return r === "reviewer" || r === "controller" || r === "viewer" ? r : "reviewer";
    } catch { return "reviewer"; }
  });
  const setRole = (r: Role) => {
    setRoleState(r);
    try { window.localStorage.setItem(ROLE_KEY, r); } catch { /* role choice is cosmetic; ledger errors surface separately */ }
  };
  return [role, setRole];
}
