import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  applyAction, decode, encode, seedState, DomainError, STORAGE_KEY,
  type Action, type Role, type SpendState,
} from "@/domain/model.ts";

type Status =
  | { kind: "ready"; state: SpendState }
  | { kind: "corrupt"; message: string }
  | { kind: "unavailable"; message: string };

interface Ctx {
  status: Status;
  role: Role;
  setRole: (r: Role) => void;
  lastError: string | null;
  clearError: () => void;
  externalNotice: string | null;
  act: (invoiceId: string, action: Action) => boolean;
  reset: () => void;
}

const StoreCtx = createContext<Ctx | null>(null);

function readStorage(): Status {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    return { kind: "unavailable", message: `Browser storage cannot be read: ${e instanceof Error ? e.message : String(e)}` };
  }
  const d = decode(raw);
  if (d.kind === "ok") return { kind: "ready", state: d.state };
  if (d.kind === "corrupt") return { kind: "corrupt", message: d.message };
  // First run only: seed from the local fixture and persist it.
  const seeded = seedState();
  try {
    window.localStorage.setItem(STORAGE_KEY, encode(seeded));
  } catch (e) {
    return { kind: "unavailable", message: `Browser storage cannot be written: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { kind: "ready", state: seeded };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(() => readStorage());
  const [role, setRoleState] = useState<Role>(() => {
    try { return sessionStorage.getItem("spend-tracker:role") === "viewer" ? "viewer" : "reviewer"; } catch { return "reviewer"; }
  });
  const [lastError, setLastError] = useState<string | null>(null);
  const [externalNotice, setExternalNotice] = useState<string | null>(null);

  const setRole = (r: Role) => {
    setRoleState(r);
    try { sessionStorage.setItem("spend-tracker:role", r); } catch { /* role is cosmetic */ }
  };

  // Multi-tab freshness: another tab's write fires a storage event here.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY && e.key !== null) return;
      const next = readStorage();
      setStatus(next);
      setExternalNotice(`Updated from another tab at ${new Date().toLocaleTimeString()}`);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const act = useCallback((invoiceId: string, action: Action): boolean => {
    if (status.kind !== "ready") { setLastError("Data is not loaded; resolve the storage problem first."); return false; }
    // Guard against stale writes: re-read storage and compare revisions.
    const fresh = readStorage();
    if (fresh.kind !== "ready") { setStatus(fresh); setLastError("Storage changed or failed before the action was saved."); return false; }
    if (fresh.state.revision !== status.state.revision) {
      setStatus(fresh);
      setLastError("Another tab changed this data. The view was refreshed; review and retry.");
      return false;
    }
    try {
      const next = applyAction(fresh.state, invoiceId, action, role, new Date().toISOString());
      window.localStorage.setItem(STORAGE_KEY, encode(next));
      setStatus({ kind: "ready", state: next });
      setLastError(null);
      return true;
    } catch (e) {
      setLastError(e instanceof DomainError ? `${e.code}: ${e.message}` : `Save failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }, [status, role]);

  const reset = useCallback(() => {
    try {
      const s = seedState();
      window.localStorage.setItem(STORAGE_KEY, encode(s));
      setStatus({ kind: "ready", state: s });
      setLastError(null);
      setExternalNotice(null);
    } catch (e) {
      setLastError(`Reset failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  return (
    <StoreCtx.Provider value={{ status, role, setRole, lastError, clearError: () => setLastError(null), externalNotice, act, reset }}>
      {children}
    </StoreCtx.Provider>
  );
}

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("useStore outside StoreProvider");
  return c;
}
