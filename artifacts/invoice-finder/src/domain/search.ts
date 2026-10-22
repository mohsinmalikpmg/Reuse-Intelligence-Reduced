import type { Invoice, Status, Supplier } from "./types.ts";
import { buildTextMatcher } from "./fuzzy.ts";
import type { SearchMode, TextMatch } from "./fuzzy.ts";

/** A predicate decides whether one flat invoice record passes. Filters compose by AND. */
export type Predicate = (inv: Invoice, ctx: SearchContext) => boolean;
export interface SearchContext { supplierName: (id: string) => string; textMatch: (inv: Invoice) => TextMatch | null }

export interface SearchCriteria {
  supplierId: string; // "" = any
  text: string; // fuzzy or exact: invoice number, supplier name, invoice id
  mode: SearchMode;
  dateFrom: string; // inclusive YYYY-MM-DD, "" = open
  dateTo: string;
  minCents: number | null;
  maxCents: number | null;
  statuses: Status[]; // empty = any
  afeId: string;
  parId: string;
}

export const EMPTY_CRITERIA: SearchCriteria = {
  supplierId: "", text: "", mode: "fuzzy", dateFrom: "", dateTo: "", minCents: null, maxCents: null, statuses: [], afeId: "", parId: "",
};

export function normalizeInvoiceNumber(n: string): string {
  return n.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export const bySupplier = (id: string): Predicate => (i) => i.supplierId === id;
export const byText: Predicate = (i, ctx) => ctx.textMatch(i) !== null;
export const dateOnOrAfter = (d: string): Predicate => (i) => i.date >= d;
export const dateOnOrBefore = (d: string): Predicate => (i) => i.date <= d;
export const minAmount = (c: number): Predicate => (i) => i.cents >= c;
export const maxAmount = (c: number): Predicate => (i) => i.cents <= c;
export const inStatuses = (s: Status[]): Predicate => (i) => s.includes(i.status);
export const byAfe = (id: string): Predicate => (i) => i.afeId === id;
export const byPar = (id: string): Predicate => (i) => i.parId === id;

export interface CompiledSearch { predicates: { label: string; test: Predicate }[]; errors: string[] }

/** Turns criteria into a labelled list of predicates, reporting contradictory inputs. */
export function compileCriteria(c: SearchCriteria): CompiledSearch {
  const p: { label: string; test: Predicate }[] = [];
  const errors: string[] = [];
  if (c.supplierId) p.push({ label: `supplier = ${c.supplierId}`, test: bySupplier(c.supplierId) });
  if (c.text.trim()) p.push({ label: `${c.mode === "exact" ? "exact" : "fuzzy"} ~ "${c.text.trim()}"`, test: byText });
  if (c.dateFrom) p.push({ label: `date >= ${c.dateFrom}`, test: dateOnOrAfter(c.dateFrom) });
  if (c.dateTo) p.push({ label: `date <= ${c.dateTo}`, test: dateOnOrBefore(c.dateTo) });
  if (c.minCents !== null) p.push({ label: `amount >= ${c.minCents}c`, test: minAmount(c.minCents) });
  if (c.maxCents !== null) p.push({ label: `amount <= ${c.maxCents}c`, test: maxAmount(c.maxCents) });
  if (c.statuses.length) p.push({ label: `status in ${c.statuses.join("|")}`, test: inStatuses(c.statuses) });
  if (c.afeId) p.push({ label: `AFE = ${c.afeId}`, test: byAfe(c.afeId) });
  if (c.parId) p.push({ label: `PAR = ${c.parId}`, test: byPar(c.parId) });
  if (c.dateFrom && c.dateTo && c.dateFrom > c.dateTo) errors.push("Date from is after date to.");
  if (c.minCents !== null && c.maxCents !== null && c.minCents > c.maxCents) errors.push("Min amount exceeds max amount.");
  return { predicates: p, errors };
}

function context(invoices: Invoice[], suppliers: Supplier[], c: SearchCriteria): SearchContext {
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  return { supplierName: (id) => names.get(id) ?? "", textMatch: buildTextMatcher(invoices, suppliers, c.text, c.mode ?? "fuzzy") };
}

export interface RankedResult { invoice: Invoice; match: TextMatch | null }

/** AND-composed filtering, then ranking: exact tier first, higher score first, ledger order as tiebreak. */
export function rankedSearch(invoices: Invoice[], suppliers: Supplier[], c: SearchCriteria): RankedResult[] {
  const ctx = context(invoices, suppliers, c);
  const { predicates } = compileCriteria(c);
  const hasText = c.text.trim() !== "";
  return invoices
    .filter((inv) => predicates.every((p) => p.test(inv, ctx)))
    .map((invoice, idx) => ({ invoice, match: hasText ? ctx.textMatch(invoice) : null, idx }))
    .sort((a, b) => {
      if (!a.match || !b.match) return a.idx - b.idx;
      const t = (a.match.tier === "exact" ? 0 : 1) - (b.match.tier === "exact" ? 0 : 1);
      return t || b.match.score - a.match.score || a.idx - b.idx;
    })
    .map(({ invoice, match }) => ({ invoice, match }));
}

export function searchInvoices(invoices: Invoice[], suppliers: Supplier[], c: SearchCriteria): Invoice[] {
  return rankedSearch(invoices, suppliers, c).map((r) => r.invoice);
}

/** For each active predicate, how many invoices would be excluded by it alone (explains empty results). */
export function predicateExclusions(invoices: Invoice[], suppliers: Supplier[], c: SearchCriteria): { label: string; excluded: number }[] {
  const ctx = context(invoices, suppliers, c);
  return compileCriteria(c).predicates.map((p) => ({ label: p.label, excluded: invoices.filter((i) => !p.test(i, ctx)).length }));
}
