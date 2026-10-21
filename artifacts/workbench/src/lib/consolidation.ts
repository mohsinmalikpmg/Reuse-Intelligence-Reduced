import { useQueryClient } from "@tanstack/react-query";
import {
  getGetConsolidationCaseQueryKey, getListConsolidationCasesQueryKey, getListConsolidationSourcesQueryKey,
  useCreateConsolidationCase, useGetConsolidationCase, useListConsolidationCases, useListConsolidationRecipes, useListConsolidationSources,
  useRegisterConsolidationSources, useRunConsolidationCase, useUpdateConsolidationCase,
  type ConsolidationCase, type ConsolidationCaseInput, type ConsolidationRecipe, type ConsolidationRecipeEdgesItem, type ConsolidationSource,
} from "@workspace/api-client-react";
import { errMsg, httpStatus } from "@/lib/case";

/** Thin wrappers over the generated consolidation hooks (contract: api-server consolidation-recipes.ts). */
export type RecipeId = ConsolidationRecipe["id"];
export type Recipe = ConsolidationRecipe;
export type RecipeEdge = ConsolidationRecipeEdgesItem;
export type RegisteredSource = ConsolidationSource;
export type CombinedCase = ConsolidationCase;
export type CombinedCaseInput = ConsolidationCaseInput;

export const ccKeys = {
  sources: getListConsolidationSourcesQueryKey(),
  cases: getListConsolidationCasesQueryKey(),
  case: (id: string) => getGetConsolidationCaseQueryKey(id),
};
const noRetry = (n: number, e: unknown) => ![401, 403, 404].includes(httpStatus(e) ?? 0) && n < 2;

export const useRecipes = () => useListConsolidationRecipes();
export const useRegisteredSources = (enabled = true) => useListConsolidationSources({ query: { queryKey: ccKeys.sources, enabled, retry: noRetry, staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true, refetchInterval: 30000 } });
export const useCombinedCases = (enabled = true) => useListConsolidationCases({ query: { queryKey: ccKeys.cases, enabled, retry: noRetry } });
export const useCombinedCase = (id: string) => useGetConsolidationCase(id, { query: { queryKey: ccKeys.case(id), enabled: !!id, retry: noRetry } });

export function useRegisterSources() {
  const qc = useQueryClient();
  return useRegisterConsolidationSources({ mutation: { onSuccess: (d) => qc.setQueryData(ccKeys.sources, d) } });
}
export function useCreateCombinedCase() {
  const qc = useQueryClient();
  return useCreateConsolidationCase({ mutation: { onSuccess: (c) => { qc.setQueryData(ccKeys.case(c.id), c); void qc.invalidateQueries({ queryKey: ccKeys.cases }); } } });
}
export function useUpdateCombinedCase() {
  const qc = useQueryClient();
  return useUpdateConsolidationCase({ mutation: { onSuccess: (c) => { qc.setQueryData(ccKeys.case(c.id), c); void qc.invalidateQueries({ queryKey: ccKeys.cases }); } } });
}
export const useRunCombinedCase = () => useRunConsolidationCase();

export const statusOf = (e: unknown) => httpStatus(e) ?? 0;
export const msgOf = (e: unknown) => errMsg(e);

/** Wiring is never chosen freely: it is exactly the edges the enabled capabilities need. */
export const edgesFor = (recipe: Recipe, capabilityIds: string[]) =>
  [...new Set(recipe.capabilities.filter((c) => capabilityIds.includes(c.id)).map((c) => c.edgeId))].sort();

export const inputFrom = (c: CombinedCase, patch: Partial<CombinedCaseInput> = {}): CombinedCaseInput => ({
  recipeId: c.recipeId, title: c.title, need: c.need, baseSolutionId: c.baseSolutionId,
  selectedSourceIds: c.selectedSources.map((s) => s.id), capabilityIds: c.capabilityIds, config: c.config, wiring: c.wiring, ...patch,
});

export const SOURCE_COPY: Record<string, { label: string; blurb: string; href?: string }> = {
  "invoice-finder": { label: "Fuzzy invoice search", blurb: "Find suppliers and invoices despite typos, with ranked results and match explanations.", href: "/invoice-finder/" },
  "approval-desk": { label: "Multi-select and bulk decisions", blurb: "Review several invoices together and keep each approval stage and decision record.", href: "/approval-desk/" },
  "spend-tracker": { label: "Project-to-line-item tracing", blurb: "Group materials and labour, then trace project spend back to original invoice lines.", href: "/spend-tracker/" },
  "budget-and-forecast": { label: "Budget and forecast engine", blurb: "Projects Q4 by cost centre with a chosen method and an adjustment you set." },
  "management-reporting": { label: "Management reporting engine", blurb: "Turns mapped accounts into a monthly management report in USD." },
};
export const SOURCE_NAMES: Record<string, string> = {
  "invoice-finder": "Invoice Finder", "approval-desk": "Approval Desk", "spend-tracker": "Spend Tracker",
  "budget-and-forecast": "Budget & Forecast", "management-reporting": "Management Reporting",
};
