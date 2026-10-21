import type { ExpectedFinding } from "./workorders";
import type { OutputItem, RunOutput } from "./types";

export interface DiffEntry {
  change: "added" | "removed" | "changed";
  sectionKey: string;
  sectionTitle: string;
  stepId: string;
  before: string | null;
  after: string | null;
  itemKey: string;
  kind: string;
}

export interface OutputDiff {
  entries: DiffEntry[];
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  /** Step ids responsible for at least one change, most changes first */
  stepsResponsible: string[];
}

function index(output: RunOutput): Map<string, { item: OutputItem; sectionKey: string; sectionTitle: string }> {
  const m = new Map<string, { item: OutputItem; sectionKey: string; sectionTitle: string }>();
  for (const s of output.sections) for (const it of s.items) m.set(`${s.key}::${it.key}`, { item: it, sectionKey: s.key, sectionTitle: s.title });
  return m;
}

/** Compare two outputs line by line using the stable item keys. */
export function diffOutputs(a: RunOutput, b: RunOutput): OutputDiff {
  const ia = index(a);
  const ib = index(b);
  const entries: DiffEntry[] = [];
  let unchanged = 0;
  for (const [key, bv] of ib) {
    const av = ia.get(key);
    if (!av) entries.push({ change: "added", sectionKey: bv.sectionKey, sectionTitle: bv.sectionTitle, stepId: bv.item.stepId, before: null, after: bv.item.text, itemKey: bv.item.key, kind: bv.item.kind });
    else if (av.item.text !== bv.item.text) entries.push({ change: "changed", sectionKey: bv.sectionKey, sectionTitle: bv.sectionTitle, stepId: bv.item.stepId, before: av.item.text, after: bv.item.text, itemKey: bv.item.key, kind: bv.item.kind });
    else unchanged += 1;
  }
  for (const [key, av] of ia) {
    if (!ib.has(key)) entries.push({ change: "removed", sectionKey: av.sectionKey, sectionTitle: av.sectionTitle, stepId: av.item.stepId, before: av.item.text, after: null, itemKey: av.item.key, kind: av.item.kind });
  }
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.stepId, (counts.get(e.stepId) ?? 0) + 1);
  const stepsResponsible = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
  return {
    entries,
    added: entries.filter((e) => e.change === "added").length,
    removed: entries.filter((e) => e.change === "removed").length,
    changed: entries.filter((e) => e.change === "changed").length,
    unchanged,
    stepsResponsible,
  };
}

export interface ObjectiveScore {
  expected: number;
  identified: number;
  missed: number;
  falsePositives: number;
  precision: number | null;
  recall: number | null;
  identifiedLabels: string[];
  missedLabels: string[];
  falsePositiveLabels: string[];
}

/**
 * Score a run against labelled expected recurring findings. A finding counts as identified when the output
 * contains a recurring concern, pattern or action for the same equipment tag and issue.
 */
export function scoreAgainstExpected(output: RunOutput, expected: ExpectedFinding[]): ObjectiveScore {
  const produced = new Set<string>();
  for (const s of output.sections) for (const it of s.items) {
    if (it.kind === "recurring") {
      const [, tag, issue] = it.key.split("|");
      if (tag && issue) produced.add(`${tag}|${issue}`);
    } else if (it.kind === "action") {
      produced.add(it.key);
    } else if (it.kind === "pattern") {
      const issue = it.key.split("|")[1];
      const tags = it.text.match(/\(([^)]+)\)/)?.[1]?.split(",").map((t) => t.trim()) ?? [];
      for (const tag of tags) if (issue) produced.add(`${tag}|${issue}`);
    }
  }
  const expectedKeys = new Set(expected.map((e) => `${e.tag}|${e.issue}`));
  const identified = [...expectedKeys].filter((k) => produced.has(k));
  const missed = [...expectedKeys].filter((k) => !produced.has(k));
  const falsePositives = [...produced].filter((k) => !expectedKeys.has(k));
  const label = (k: string) => k.replace("|", " ");
  return {
    expected: expectedKeys.size,
    identified: identified.length,
    missed: missed.length,
    falsePositives: falsePositives.length,
    precision: produced.size ? round(identified.length / produced.size) : null,
    recall: expectedKeys.size ? round(identified.length / expectedKeys.size) : null,
    identifiedLabels: identified.map(label),
    missedLabels: missed.map(label),
    falsePositiveLabels: falsePositives.map(label),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
