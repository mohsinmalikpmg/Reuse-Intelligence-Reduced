import type { Invoice, Supplier } from "./types.ts";

/**
 * Source A standout: typo-tolerant, explainable invoice search.
 *
 * Policy (conservative on purpose):
 * - Case and punctuation are ignored ("bp-100" == "BP 100" == "bp100").
 * - Multi-word queries are AND-ed: every query word must match some field.
 * - A word first tries exact, then prefix/partial matches. Only when that word has
 *   NO exact or prefix hit anywhere in the ledger does it fall back to typo tolerance
 *   (spell-correction style), so exact matches always rank above approximate ones.
 * - Words shorter than 4 characters never match approximately.
 * - Edit budget: 1 edit for 4-6 characters, 2 for 7+ (supplier words);
 *   invoice numbers allow at most 1 edit.
 * This is a search aid. Strict duplicate detection lives in duplicates.ts and never uses it.
 */

export type MatchKind = "exact" | "partial" | "approximate";
export type MatchField = "invoice number" | "supplier" | "invoice id";
export type SearchMode = "fuzzy" | "exact";

export interface MatchReason {
  query: string; // the query word (normalized)
  field: MatchField;
  matched: string; // the field value it matched
  kind: MatchKind;
  edits: number;
}

export interface TextMatch { score: number; tier: "exact" | "approximate"; reasons: MatchReason[] }

export const MIN_FUZZY_LEN = 4;
const NOISE_WORDS = new Set(["synthetic"]);

export const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function queryWords(q: string): string[] {
  return q.toLowerCase().split(/[\s,;/]+/).map(norm).filter((w) => w.length > 0);
}

export function supplierWords(name: string): string[] {
  return queryWords(name).filter((w) => !NOISE_WORDS.has(w));
}

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent transpositions). */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
    }
  }
  return d[a.length][b.length];
}

export function editBudget(word: string, field: MatchField): number {
  if (word.length < MIN_FUZZY_LEN) return 0;
  if (field === "invoice number") return 1;
  return word.length >= 7 ? 2 : 1;
}

interface Doc { inv: Invoice; supplierName: string; supWords: string[]; number: string; id: string }

const SCORE: Record<MatchKind, number> = { exact: 100, partial: 70, approximate: 40 };

function strictHit(w: string, d: Doc): MatchReason | null {
  if (d.number === w) return { query: w, field: "invoice number", matched: d.inv.invoiceNumber, kind: "exact", edits: 0 };
  if (d.id === w) return { query: w, field: "invoice id", matched: d.inv.id, kind: "exact", edits: 0 };
  const sw = d.supWords.find((s) => s === w);
  if (sw) return { query: w, field: "supplier", matched: d.supplierName, kind: "exact", edits: 0 };
  if (w.length >= 2) {
    if (d.supWords.some((s) => s.startsWith(w))) return { query: w, field: "supplier", matched: d.supplierName, kind: "partial", edits: 0 };
    if (w.length >= 3 && d.number.includes(w)) return { query: w, field: "invoice number", matched: d.inv.invoiceNumber, kind: "partial", edits: 0 };
  }
  return null;
}

function fuzzyHit(w: string, d: Doc): MatchReason | null {
  let best: MatchReason | null = null;
  const nb = editBudget(w, "invoice number");
  if (nb > 0) {
    const e = editDistance(w, d.number, nb);
    if (e <= nb) best = { query: w, field: "invoice number", matched: d.inv.invoiceNumber, kind: "approximate", edits: e };
  }
  const sb = editBudget(w, "supplier");
  if (sb > 0) {
    for (const s of d.supWords) {
      // compare whole word, and also the same-length prefix so partially typed long words still work
      const e = Math.min(editDistance(w, s, sb), s.length > w.length + 1 ? editDistance(w, s.slice(0, w.length), sb) : sb + 1);
      if (e <= sb && (!best || e < best.edits)) best = { query: w, field: "supplier", matched: d.supplierName, kind: "approximate", edits: e };
    }
  }
  return best;
}

/** Builds a matcher over the whole ledger (needed to decide whether a word may fall back to fuzzy). */
export function buildTextMatcher(invoices: Invoice[], suppliers: Supplier[], query: string, mode: SearchMode): (inv: Invoice) => TextMatch | null {
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  const docs = new Map<string, Doc>(invoices.map((inv) => {
    const supplierName = names.get(inv.supplierId) ?? "";
    return [inv.id, { inv, supplierName, supWords: supplierWords(supplierName), number: norm(inv.invoiceNumber), id: norm(inv.id) }];
  }));
  const whole = norm(query);
  const words = queryWords(query);
  if (!whole) return () => ({ score: 0, tier: "exact", reasons: [] });

  // Whole query as one invoice number: "bp 100" -> BP-100.
  const wholeNumberHit = (d: Doc): boolean => words.length > 1 && d.number === whole;
  const fuzzyAllowed = new Set(
    mode === "fuzzy" ? words.filter((w) => ![...docs.values()].some((d) => strictHit(w, d))) : [],
  );

  return (inv) => {
    const d = docs.get(inv.id);
    if (!d) return null;
    if (wholeNumberHit(d)) {
      return { score: SCORE.exact * words.length, tier: "exact", reasons: [{ query: whole, field: "invoice number", matched: inv.invoiceNumber, kind: "exact", edits: 0 }] };
    }
    const reasons: MatchReason[] = [];
    for (const w of words) {
      const r = strictHit(w, d) ?? (fuzzyAllowed.has(w) ? fuzzyHit(w, d) : null);
      if (!r) return null;
      reasons.push(r);
    }
    const score = reasons.reduce((n, r) => n + SCORE[r.kind] - r.edits * 10, 0);
    return { score, tier: reasons.some((r) => r.kind === "approximate") ? "approximate" : "exact", reasons };
  };
}

export function explainReason(r: MatchReason): string {
  if (r.kind === "exact") return `"${r.query}" exactly matches ${r.field} ${r.matched}`;
  if (r.kind === "partial") return `"${r.query}" is part of ${r.field} ${r.matched}`;
  return `"${r.query}" is ${r.edits} ${r.edits === 1 ? "edit" : "edits"} from ${r.field} ${r.matched}`;
}
