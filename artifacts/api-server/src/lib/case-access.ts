import { AsyncLocalStorage } from "node:async_hooks";

/** Request-local visibility: legacy cases stay public; composition cases are private.
 * Background jobs/scripts have no request scope and retain their existing behavior.
 */
export const caseAccessScope = new AsyncLocalStorage<{ hidden: Set<string> }>();
export function caseVisible(caseId: string | null | undefined): boolean {
  return !caseId || !caseAccessScope.getStore()?.hidden.has(caseId);
}
export function visibleCaseRows<T extends { caseId: string | null }>(rows: T[]): T[] {
  return rows.filter(row => caseVisible(row.caseId));
}
