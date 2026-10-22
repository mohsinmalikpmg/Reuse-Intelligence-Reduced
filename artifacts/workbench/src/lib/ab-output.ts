/** Pure helpers for the A/B workbench: which output sections exist on only one side, and whether a step can be added back. */
export type SectionLike = { key: string; items: unknown[] };
export type Presence = "both" | "a-only" | "b-only";

/** A section counts as present on a side when it exists there with at least one item. */
export function sectionPresence(a: SectionLike[], b: SectionLike[]): Map<string, Presence> {
  const has = (xs: SectionLike[]) => new Set(xs.filter((s) => s.items.length > 0).map((s) => s.key));
  const ha = has(a); const hb = has(b);
  const out = new Map<string, Presence>();
  for (const k of new Set([...ha, ...hb])) out.set(k, ha.has(k) && hb.has(k) ? "both" : ha.has(k) ? "a-only" : "b-only");
  return out;
}

export const isEmptyOutput = (sections: SectionLike[]) => sections.every((s) => s.items.length === 0);

export type AddBack = { kind: "ok" } | { kind: "blocked"; reason: string } | { kind: "busy" };
/** Never a dead disabled button: either it can be switched on, or the server's reason is shown. */
export function addBackState(b: { blockedReason?: string | null; state?: string }, busy: boolean): AddBack {
  if (b.blockedReason) return { kind: "blocked", reason: b.blockedReason };
  if (b.state === "incompatible") return { kind: "blocked", reason: "Not compatible with this product's current setup." };
  return busy ? { kind: "busy" } : { kind: "ok" };
}
