// Reuse the original pure implementations, not their browser stores or UI.
import { createSeedState } from "../../../invoice-finder/src/domain/fixture.ts";
import { EMPTY_CRITERIA, rankedSearch, compileCriteria, type SearchCriteria } from "../../../invoice-finder/src/domain/search.ts";
import type { Invoice } from "../../../invoice-finder/src/domain/types.ts";
import { SEED } from "../../../approval-desk/src/domain/seed.ts";
import { replay, type DecisionEvent, type Role } from "../../../approval-desk/src/domain/ledger.ts";
import { previewBulk, applyBulk, type BulkAction, type BulkPreview } from "../../../approval-desk/src/domain/bulk.ts";
import { buildState } from "../../../spend-tracker/src/domain/model.ts";
import { groupTrace, tracedLines, type Scope, type LineCategory } from "../../../spend-tracker/src/domain/lines.ts";
import { storageKey, validateRecipe, type Recipe, type CapabilityId } from "./recipe";

export { EMPTY_CRITERIA };
export type { SearchCriteria, DecisionEvent, Role, BulkAction, BulkPreview, Scope, LineCategory };
export const suppliers = createSeedState().suppliers;
export const afes = createSeedState().afes;
export const pars = createSeedState().pars;
export function requireCapability(recipe: Recipe, capability: CapabilityId) {
  validateRecipe(recipe);
  if (!recipe.capabilities.includes(capability)) throw new Error(`${capability} was removed from this recipe.`);
}
export function states(ledger: readonly DecisionEvent[]) {
  const result = replay(SEED, ledger);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
/** Identity is the immutable scenario ID, never invoiceNumber (I1/I2 are duplicates).
 * CAD cents remain safe integers; stage is separate from status.
 */
export function invoiceRows(ledger: readonly DecisionEvent[]): Invoice[] {
  return [...states(ledger).values()].map(s => {
    const i = s.invoice;
    if (!Number.isSafeInteger(i.amountCents)) throw new Error(`Unsafe cents for ${i.id}`);
    return { id: i.id, supplierId: i.supplierId, invoiceNumber: i.invoiceNumber, date: i.date,
      cents: i.amountCents, afeId: i.afeId, parId: i.parId, status: s.status };
  });
}
export function search(recipe: Recipe, ledger: readonly DecisionEvent[], criteria: SearchCriteria) {
  requireCapability(recipe, "fuzzy-search");
  const errors = compileCriteria(criteria).errors;
  if (errors.length) throw new Error(errors.join(" "));
  return rankedSearch(invoiceRows(ledger), suppliers, criteria);
}
export function preview(recipe: Recipe, ledger: readonly DecisionEvent[], ids: string[], action: BulkAction, role: Role, reason: string) {
  requireCapability(recipe, "bulk-decisions");
  return previewBulk(states(ledger), ids, action, role, reason);
}
export function apply(recipe: Recipe, ledger: readonly DecisionEvent[], batch: BulkPreview, id: string, at: string) {
  requireCapability(recipe, "bulk-decisions");
  const result = applyBulk(SEED, ledger, batch, { batchId: id, at, newId: i => `${id}-${i}` });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
export function spendState(ledger: readonly DecisionEvent[]) {
  return buildState(suppliers, afes, pars, invoiceRows(ledger).map(({ invoiceNumber, ...i }) => ({ ...i, number: invoiceNumber })));
}
export function trace(recipe: Recipe, ledger: readonly DecisionEvent[], scope: Scope, category?: LineCategory) {
  requireCapability(recipe, "spend-tracing");
  const s = spendState(ledger);
  return { summary: groupTrace(s, scope), lines: tracedLines(s, scope, category) };
}
export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export function readLedger(recipe: Recipe, storage: StoragePort): readonly DecisionEvent[] {
  const raw = storage.getItem(storageKey(recipe));
  if (!raw) return [];
  let ledger: unknown;
  try { ledger = JSON.parse(raw); } catch { throw new Error("Saved snapshot is corrupt. Reset this snapshot to continue."); }
  if (!Array.isArray(ledger)) throw new Error("Saved ledger is invalid. Reset this snapshot to continue.");
  states(ledger);
  return ledger;
}
export function saveLedger(recipe: Recipe, ledger: readonly DecisionEvent[], storage: StoragePort) {
  states(ledger);
  storage.setItem(storageKey(recipe), JSON.stringify(ledger));
}
