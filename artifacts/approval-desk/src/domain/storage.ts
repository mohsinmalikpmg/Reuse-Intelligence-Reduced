// Versioned persistence of the decision ledger. Pure functions over a
// Storage-like interface so it can be tested without a browser.
import type { DecisionEvent, InvoiceState, Result } from "./ledger.ts";
import { replay } from "./ledger.ts";
import type { Seed } from "./seed.ts";
import { validateSeed } from "./seed.ts";

export const STORAGE_KEY = "approval-desk:ledger:v1";
export const FORMAT_VERSION = 1;

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Loaded {
  events: readonly DecisionEvent[];
  states: Map<string, InvoiceState>;
  fresh: boolean;
}

export function serialize(events: readonly DecisionEvent[]): string {
  return JSON.stringify({ version: FORMAT_VERSION, events });
}

/** Load and replay. Missing key = empty ledger. Corrupt data is an error, never silently reseeded. */
export function loadLedger(kv: KV, seed: Seed): Result<Loaded> {
  const seedErrors = validateSeed(seed);
  if (seedErrors.length) return { ok: false, error: `Seed fixture invalid: ${seedErrors.join("; ")}` };
  let raw: string | null;
  try {
    raw = kv.getItem(STORAGE_KEY);
  } catch (e) {
    return { ok: false, error: `Browser storage is unavailable: ${(e as Error).message}` };
  }
  if (raw === null) {
    const r = replay(seed, []);
    return r.ok ? { ok: true, value: { events: [], states: r.value, fresh: true } } : r;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Stored ledger is not valid JSON." };
  }
  const p = parsed as { version?: unknown; events?: unknown };
  if (!p || typeof p !== "object" || p.version !== FORMAT_VERSION) return { ok: false, error: `Stored ledger has unsupported version ${String(p?.version)}.` };
  if (!Array.isArray(p.events)) return { ok: false, error: "Stored ledger has no events array." };
  const r = replay(seed, p.events);
  if (!r.ok) return r;
  return { ok: true, value: { events: Object.freeze(p.events as DecisionEvent[]), states: r.value, fresh: false } };
}

export function saveLedger(kv: KV, events: readonly DecisionEvent[]): Result<true> {
  try {
    kv.setItem(STORAGE_KEY, serialize(events));
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: `Could not write to browser storage: ${(e as Error).message}` };
  }
}

export function resetLedger(kv: KV): Result<true> {
  try {
    kv.removeItem(STORAGE_KEY);
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: `Could not clear browser storage: ${(e as Error).message}` };
  }
}
