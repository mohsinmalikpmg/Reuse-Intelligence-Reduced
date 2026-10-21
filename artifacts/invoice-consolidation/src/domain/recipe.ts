export const SOURCE_IDS = ["invoice-finder", "approval-desk", "spend-tracker"] as const;
export const CAPABILITY_IDS = ["fuzzy-search", "bulk-decisions", "spend-tracing"] as const;
export type SourceId = typeof SOURCE_IDS[number];
export type CapabilityId = typeof CAPABILITY_IDS[number];
export const CAPABILITY_EDGES: Record<CapabilityId, string> = { "fuzzy-search": "invoice-to-search", "bulk-decisions": "invoice-to-decisions", "spend-tracing": "invoice-to-spend" };
export interface Recipe {
  schemaVersion: 1;
  snapshotId: string;
  sources: SourceId[];
  capabilities: CapabilityId[];
  baseSourceId: SourceId;
  wiring: { edgeIds: string[] };
}
export const DEFAULT_RECIPE: Recipe = {
  schemaVersion: 1, snapshotId: "synthetic-invoice-demo-v1",
  sources: [...SOURCE_IDS], capabilities: [...CAPABILITY_IDS], baseSourceId: "invoice-finder",
  wiring: { edgeIds: Object.values(CAPABILITY_EDGES) },
};
export function validateRecipe(input: unknown): Recipe {
  const r = input as Recipe;
  if (!r || r.schemaVersion !== 1 || typeof r.snapshotId !== "string" || !r.snapshotId.trim())
    throw new Error("Invalid recipe schema or snapshot ID.");
  if (!Array.isArray(r.sources) || r.sources.length < 2 || r.sources.length > 3 ||
    new Set(r.sources).size !== r.sources.length || r.sources.some(x => !SOURCE_IDS.includes(x)) ||
    !r.sources.includes(r.baseSourceId)) throw new Error("Recipe must select two or three distinct sources and a selected base.");
  if (!Array.isArray(r.capabilities) || new Set(r.capabilities).size !== r.capabilities.length ||
    r.capabilities.some(x => !CAPABILITY_IDS.includes(x))) throw new Error("Unknown or duplicate capability.");
  for (const cap of r.capabilities) {
    if (!r.sources.includes(SOURCE_IDS[CAPABILITY_IDS.indexOf(cap)]))
      throw new Error(`Capability ${cap} requires its source.`);
  }
  const required = r.capabilities.map(c => CAPABILITY_EDGES[c]).sort();
  if (!Array.isArray(r.wiring?.edgeIds) || JSON.stringify([...r.wiring.edgeIds].sort()) !== JSON.stringify(required))
    throw new Error("Wiring must connect exactly the enabled capabilities.");
  return { schemaVersion: 1, snapshotId: r.snapshotId, sources: [...r.sources], capabilities: [...r.capabilities], baseSourceId: r.baseSourceId, wiring: { edgeIds: [...r.wiring.edgeIds] } };
}
export function recipeFromCase(value: unknown): Recipe {
  const c = value as { fingerprint: string; selectedSources: { id: SourceId }[]; capabilityIds: CapabilityId[]; baseSolutionId: SourceId; config: { schemaVersion: number }; wiring?: unknown };
  if (c?.config?.schemaVersion !== 1) throw new Error("Unsupported saved case configuration.");
  return validateRecipe({ schemaVersion: 1, snapshotId: c.fingerprint, sources: c.selectedSources?.map(s => s.id), capabilities: c.capabilityIds, baseSourceId: c.baseSolutionId, wiring: c.wiring });
}
export async function loadRecipe(search: string, base: string): Promise<Recipe> {
  const q = new URLSearchParams(search);
  const id = q.get("consolidationCaseId");
  if (id) {
    const response = await fetch(`/api/consolidation/cases/${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load saved case (${response.status}). Sign in to Workbench and retry.`);
    return recipeFromCase(await response.json());
  }
  if (q.has("recipe")) throw new Error("URL recipe overrides are not supported. Open a saved Workbench case or the embedded export.");
  const response = await fetch(`${base}recipe.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load embedded recipe (${response.status}).`);
  return validateRecipe(await response.json());
}
export function storageKey(recipe: Recipe): string {
  // Include normalized recipe as well as fingerprint so different saved choices cannot share a ledger.
  return `invoice-consolidation:v1:${encodeURIComponent(JSON.stringify({ ...recipe, sources: [...recipe.sources].sort(), capabilities: [...recipe.capabilities].sort() }))}`;
}
