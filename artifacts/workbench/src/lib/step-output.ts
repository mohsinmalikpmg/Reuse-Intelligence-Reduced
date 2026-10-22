/**
 * Per-step output snapshots (step-output contract). Pure helpers; fields are optional because old traces lack them.
 * A snapshot is what the step wrote at the moment it finished. Never substitute the final run output for it.
 */
export type Ranking = { position: number; basis?: string };
export type SnapItem = { id: string; key: string; kind: string; text: string; detail: string | null; stepId: string; refs: string[]; originStepId?: string; ranking?: Ranking | null };
export type SnapSection = { key: string; title: string; stepId: string; items: SnapItem[] };
export type SnapTrace = { stepId: string; status: string; outputSections?: SnapSection[]; outputSnapshotStatus?: "available" | "unavailable" };
export type StepEntry = { change: "added" | "removed" | "changed"; sectionKey: string; itemKey: string; before: string | null; after: string | null; changeType?: "ranking" | "content"; reason?: string };

export type Snapshot = { kind: "not-run"; why: "off" | "skipped" | "no-run" } | { kind: "unavailable" } | { kind: "ok"; sections: SnapSection[] };

export function stepSnapshot(t: SnapTrace | null | undefined, active: boolean): Snapshot {
  if (!active) return { kind: "not-run", why: "off" };
  if (!t) return { kind: "not-run", why: "no-run" };
  if (t.status === "skipped") return { kind: "not-run", why: "skipped" };
  if (t.outputSnapshotStatus !== "available" || !Array.isArray(t.outputSections)) return { kind: "unavailable" };
  return { kind: "ok", sections: t.outputSections };
}

export const entryKey = (sectionKey: string, itemKey: string) => `${sectionKey}::${itemKey}`;
export type Mark = "new" | "removed" | "changed" | "ranking";
export type LocalEntry = { change: "added" | "removed" | "changed"; changeType: "ranking" | "content"; sectionKey: string; itemKey: string; before: string | null; after: string | null };
export const markOf = (e: { change: string; changeType?: string }): Mark => (e.changeType === "ranking" ? "ranking" : e.change === "added" ? "new" : e.change === "removed" ? "removed" : "changed");

const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
/** Ranking-only when kind/detail/refs match and the text differs only by the rank prefix that the ranking metadata declares. */
function rankingOnly(a: SnapItem, b: SnapItem): boolean {
  if (a.kind !== b.kind || a.detail !== b.detail || !same(a.refs, b.refs)) return false;
  if (!a.ranking && !b.ranking) return false;
  const strip = (i: SnapItem) => (i.ranking && i.text.startsWith(`#${i.ranking.position} `) ? i.text.slice(`#${i.ranking.position} `.length) : i.text);
  return strip(a) === strip(b);
}
const flat = (ss: SnapSection[]) => { const m = new Map<string, { s: SnapSection; i: SnapItem }>(); for (const s of ss) for (const i of s.items) m.set(entryKey(s.key, i.key), { s, i }); return m; };

/** Compare this step's own snapshots on A and B. Null when either side has no comparable snapshot. */
export function localDiff(a: Snapshot, b: Snapshot): LocalEntry[] | null {
  if (a.kind !== "ok" || b.kind !== "ok") return null;
  const A = flat(a.sections); const B = flat(b.sections); const out: LocalEntry[] = [];
  for (const [k, x] of A) {
    const y = B.get(k);
    if (!y) { out.push({ change: "removed", changeType: "content", sectionKey: x.s.key, itemKey: x.i.key, before: x.i.text, after: null }); continue; }
    const rankEq = (x.i.ranking?.position ?? null) === (y.i.ranking?.position ?? null);
    if (x.i.text === y.i.text && x.i.detail === y.i.detail && x.i.kind === y.i.kind && same(x.i.refs, y.i.refs) && rankEq) continue;
    out.push({ change: "changed", changeType: rankingOnly(x.i, y.i) ? "ranking" : "content", sectionKey: x.s.key, itemKey: x.i.key, before: x.i.text, after: y.i.text });
  }
  for (const [k, y] of B) if (!A.has(k)) out.push({ change: "added", changeType: "content", sectionKey: y.s.key, itemKey: y.i.key, before: null, after: y.i.text });
  return out;
}

/** Marks for one side's snapshot: A marks what B lost or changed; B marks what is new or changed. */
export function sideMarks<E extends { change: string; sectionKey: string; itemKey: string }>(entries: E[], side: "A" | "B"): Map<string, E> {
  const m = new Map<string, E>();
  for (const e of entries) {
    if (side === "A" ? e.change === "added" : e.change === "removed") continue;
    m.set(entryKey(e.sectionKey, e.itemKey), e);
  }
  return m;
}

const isRanked = (s: Snapshot) => s.kind === "ok" && s.sections.some((x) => x.items.some((i) => !!i.ranking));
const rankPhrase = (aRanked: boolean, bRanked: boolean) => (bRanked && !aRanked ? "B adds ranking" : aRanked && !bRanked ? "B removes ranking" : "ranking order differs");

/** Plain summary from a set of entries with change + changeType. */
export function summarize(entries: { change: string; changeType?: string }[], aRanked: boolean, bRanked: boolean): string {
  if (entries.length === 0) return "Same output in A and B";
  const content = entries.filter((e) => e.changeType !== "ranking");
  if (content.length === 0) return `Same findings; ${rankPhrase(aRanked, bRanked)}`;
  const n = (c: string) => content.filter((e) => e.change === c).length;
  const parts = [n("added") && `${n("added")} new`, n("removed") && `${n("removed")} gone`, n("changed") && `${n("changed")} changed`].filter(Boolean) as string[];
  if (entries.length > content.length) parts.push(rankPhrase(aRanked, bRanked));
  return parts.join(" · ");
}

/**
 * This step's line: its own snapshots when both sides ran; when it ran on one side only, the grounded final-output
 * entries attributed to it explain the impact (so ranked lines are not called new findings).
 */
export function stepDiffSummary(a: Snapshot, b: Snapshot, finalEntries: { change: string; changeType?: string }[] = [], aRanked = isRanked(a), bRanked = isRanked(b)): string | null {
  const d = localDiff(a, b);
  if (d) return summarize(d, isRanked(a), isRanked(b));
  const one = a.kind === "not-run" && b.kind === "ok" ? "Runs only in B" : b.kind === "not-run" && a.kind === "ok" ? "Runs only in A" : null;
  if (!finalEntries.length) return one;
  const impact = summarize(finalEntries, aRanked, bRanked);
  return one ? `${one} · ${impact}` : impact;
}

/** Whether any line in a run's final sections carries ranking metadata. */
export const outputRanked = (sections: { items: { ranking?: unknown }[] }[]) => sections.some((s) => s.items.some((i) => !!i.ranking));
