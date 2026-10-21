import { useCallback, useEffect, useState } from "react";
import { createSeedState } from "../domain/fixture.ts";
import { parseStored, STORAGE_KEY } from "../domain/storage.ts";
import type { LoadResult } from "../domain/storage.ts";
import type { AppState } from "../domain/types.ts";

function readStorage(): LoadResult {
  try {
    return parseStored(window.localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    return { kind: "error", error: `Browser storage unavailable: ${(e as Error).message}` };
  }
}

function writeStorage(s: AppState): string | null {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    return null;
  } catch (e) {
    return `Could not save to browser storage: ${(e as Error).message}`;
  }
}

export interface Store {
  state: AppState | null;
  loadError: string | null;
  saveError: string | null;
  externalUpdateAt: string | null;
  commit: (next: AppState) => boolean;
  reset: () => void;
}

/** First visit seeds from the fixture. Corruption is shown, never silently reseeded. Other tabs sync via storage events. */
export function useStore(): Store {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [externalUpdateAt, setExternal] = useState<string | null>(null);

  const load = useCallback((fromOtherTab: boolean) => {
    const r = readStorage();
    if (r.kind === "ok") {
      setState(r.state); setLoadError(null);
      if (fromOtherTab) setExternal(new Date().toLocaleTimeString("en-CA"));
    } else if (r.kind === "empty") {
      const seed = createSeedState();
      const err = writeStorage(seed);
      setState(seed); setLoadError(null); setSaveError(err);
    } else {
      setState(null); setLoadError(r.error);
    }
  }, []);

  useEffect(() => {
    load(false);
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY || e.key === null) load(true); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [load]);

  const commit = useCallback((next: AppState) => {
    const err = writeStorage(next);
    setSaveError(err);
    if (err) return false;
    setState(next);
    return true;
  }, []);

  const reset = useCallback(() => {
    const seed = createSeedState();
    const err = writeStorage(seed);
    setSaveError(err);
    if (!err) { setState(seed); setLoadError(null); }
  }, []);

  return { state, loadError, saveError, externalUpdateAt, commit, reset };
}
