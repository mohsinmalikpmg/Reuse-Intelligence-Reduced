/** Pure aggregation helpers for the IT Owner Analytics dashboard. Counts always reconcile to the records passed in. */

export type AppSource = "catalog" | "prototype" | "consolidation_source";
export type Stage = "saved" | "proposed" | "approved" | "published" | "withdrawn";
export type Sharing = "shared" | "single" | "unassessed";

export interface AppLike { id: string; source: AppSource; registeredAt: string | null; demo: boolean }
export interface CapLike { id: string; usedBy: number; demo: boolean }
export interface ComboLike { caseId: string; stage: Stage; demo: boolean }

export function composition(records: AppLike[]) {
  const out: Record<AppSource, { total: number; demo: number }> = {
    consolidation_source: { total: 0, demo: 0 }, prototype: { total: 0, demo: 0 }, catalog: { total: 0, demo: 0 },
  };
  for (const r of records) { out[r.source].total++; if (r.demo) out[r.source].demo++; }
  return out;
}

/** Registration activity: one column per persisted calendar day (UTC). Catalog and undated entries are excluded and counted separately. No gaps filled, no smoothing. */
export function registrationDays(records: AppLike[]) {
  const map = new Map<string, { day: string; sources: number; prototypes: number }>();
  let undated = 0; let catalog = 0;
  for (const r of records) {
    if (r.source === "catalog") { catalog++; continue; }
    if (!r.registeredAt || Number.isNaN(Date.parse(r.registeredAt))) { undated++; continue; }
    const day = new Date(r.registeredAt).toISOString().slice(0, 10);
    const e = map.get(day) ?? { day, sources: 0, prototypes: 0 };
    if (r.source === "prototype") e.prototypes++; else e.sources++;
    map.set(day, e);
  }
  const days = [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
  return { days, undated, catalog };
}

export function sharingOf(usedBy: number): Sharing { return usedBy > 1 ? "shared" : usedBy === 1 ? "single" : "unassessed"; }

export function capabilitySharing(records: CapLike[]) {
  const seen = new Set<string>();
  const out: Record<Sharing, { total: number; demo: number }> = { shared: { total: 0, demo: 0 }, single: { total: 0, demo: 0 }, unassessed: { total: 0, demo: 0 } };
  for (const r of records) {
    if (seen.has(r.id)) continue; seen.add(r.id);
    const k = sharingOf(r.usedBy); out[k].total++; if (r.demo) out[k].demo++;
  }
  return out;
}

export const STAGES: Stage[] = ["saved", "proposed", "approved", "published", "withdrawn"];

/** Current stage per record; each record is counted exactly once. */
export function stageCounts(records: ComboLike[]) {
  const out = Object.fromEntries(STAGES.map((s) => [s, { total: 0, demo: 0 }])) as Record<Stage, { total: number; demo: number }>;
  const seen = new Set<string>();
  for (const r of records) {
    if (seen.has(r.caseId)) continue; seen.add(r.caseId);
    out[r.stage].total++; if (r.demo) out[r.stage].demo++;
  }
  return out;
}

/** Matches the backend "new" window: dated, not in the future relative to generatedAt, and within the window. */
export function isNewRegistration(registeredAt: string | null, generatedAt: string, windowDays: number) {
  if (!registeredAt) return false;
  const t = Date.parse(registeredAt); const g = Date.parse(generatedAt);
  if (Number.isNaN(t) || Number.isNaN(g)) return false;
  return t <= g && t >= g - windowDays * 86_400_000;
}

/** UTC midnight epoch for a YYYY-MM-DD day key. */
export const dayEpoch = (day: string) => Date.parse(day + "T00:00:00Z");
