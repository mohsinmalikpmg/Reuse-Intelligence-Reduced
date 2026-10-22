import { createHash, randomUUID } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "@workspace/db";
import { z } from "zod";
import { financeRepositoryRoot, financeConfigSchema, validateFinanceConfig, financeCatalog } from "./finance-wiring";
import { savePackageOriginal, packageObject } from "./solution-package-storage";
import { isRedistributionExcludedPath } from "./solution-package-archive";
import { getBrief } from "./store";
import { assessCombination } from "./combination-assessment";
import type { CombinationRequirement, CombinationRequirementAssessment } from "@workspace/api-zod";

export class ConsolidationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const sources = [
  { id: "invoice-finder", name: "Invoice Finder", recipeId: "invoice", kind: "reviewed-source" },
  { id: "approval-desk", name: "Approval Desk", recipeId: "invoice", kind: "reviewed-source" },
  { id: "spend-tracker", name: "Spend Tracker", recipeId: "invoice", kind: "reviewed-source" },
  { id: "budget-and-forecast", name: "Budget & Forecast", recipeId: "finance", kind: "delivered-original", filename: "Budget-and-Forecast-Agent-main_1792619794109.zip", expectedHash: "1f5c4f3e57430bdc6ea2de2856f7d127b5ef545ad44b29d2938ed71fc961b4b7" },
  { id: "management-reporting", name: "Management Reporting", recipeId: "finance", kind: "delivered-original", filename: "Management-Reporting-Agent-main_1792619794108.zip", expectedHash: "369013b1523f1e1e6786ad8095e98402988565cfbc46ff1d885dfffef2422310" },
] as const;
export const consolidationRecipes = [
  { id: "invoice", name: "Invoice Operations", sourceIds: ["invoice-finder", "approval-desk", "spend-tracker"], baseSolutionIds: ["invoice-finder", "approval-desk", "spend-tracker"], runPath: "/invoice-consolidation/", capabilities: [
    { id: "fuzzy-search", name: "Fuzzy search", sourceId: "invoice-finder", edgeId: "invoice-to-search" },
    { id: "bulk-decisions", name: "Bulk decisions", sourceId: "approval-desk", edgeId: "invoice-to-decisions" },
    { id: "spend-tracing", name: "Spend tracing", sourceId: "spend-tracker", edgeId: "invoice-to-spend" },
  ], edges: [
    { id: "invoice-to-search", from: "invoice-ledger", to: "fuzzy-search", contract: "Shared validated invoice records; integer cents and stable IDs." },
    { id: "invoice-to-decisions", from: "invoice-ledger", to: "bulk-decisions", contract: "Shared invoice IDs and append-only decisions; simulated workflow only." },
    { id: "invoice-to-spend", from: "invoice-ledger", to: "spend-tracing", contract: "Shared invoice ledger; integer-cent totals trace to original invoice IDs." },
  ], defaultConfig: { schemaVersion: 1 } },
  { id: "finance", name: "Forecast to Report", sourceIds: ["budget-and-forecast", "management-reporting"], baseSolutionIds: ["budget-and-forecast"], runPath: "/finance-demo/", capabilities: [
    { id: "forecast-projection", name: "Forecast projection", sourceId: "budget-and-forecast", edgeId: "forecast-to-report" },
    { id: "management-reporting", name: "Management reporting", sourceId: "management-reporting", edgeId: "forecast-to-report" },
  ], edges: [
    { id: "forecast-to-report", from: "budget-and-forecast", to: "management-reporting", contract: "Validated account mapping; USD dollars to integer cents; exact cost centres; forecasts never become actuals." },
  ], defaultConfig: null },
];
export type SelectedSource = { id: string; solutionId: string; version: string; sha256: string };
export type ConsolidationCase = {
  briefId?: string; requirements?: CombinationRequirement[]; assessment?: CombinationRequirementAssessment[];
  id: string; recipeId: "invoice" | "finance"; title: string; need: string; baseSolutionId: string;
  selectedSources: SelectedSource[]; capabilityIds: string[]; config: Record<string, unknown>;
  wiring: { edgeIds: string[] }; revision: number; createdAt: string; updatedAt: string;
  fingerprint: string; runUrl: string;
};
export const consolidationCaseInput = z.object({
  briefId: z.string().min(1).max(200).optional(),
  recipeId: z.enum(["invoice", "finance"]), title: z.string().trim().min(1).max(200),
  need: z.string().trim().min(1).max(4000), baseSolutionId: z.string().max(100),
  selectedSourceIds: z.array(z.string().max(100)).min(2).max(5),
  capabilityIds: z.array(z.string().max(100)).min(1).max(5),
  wiring: z.object({ edgeIds: z.array(z.string().max(100)).max(5) }).strict(),
  config: z.record(z.string(), z.unknown()),
}).strict();
export const consolidationCaseUpdate = consolidationCaseInput.extend({ expectedRevision: z.number().int().min(1) }).strict();
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
export function consolidationFingerprint(c: Pick<ConsolidationCase, "recipeId" | "baseSolutionId" | "selectedSources" | "capabilityIds" | "config" | "wiring">) {
  return hash(canonical({ schemaVersion: 1, recipeId: c.recipeId, baseSolutionId: c.baseSolutionId,
    selectedSources: [...c.selectedSources].sort((a,b) => a.id.localeCompare(b.id)),
    capabilityIds: [...c.capabilityIds].sort(), config: c.config, wiring: { edgeIds: [...c.wiring.edgeIds].sort() } }));
}
export async function recipeCatalog() {
  const finance = await financeCatalog();
  return consolidationRecipes.map(r => ({ ...r, defaultConfig: r.id === "finance" ? finance.defaultConfig : r.defaultConfig }));
}
export async function registeredConsolidationSources() {
  const { rows } = await pool.query("SELECT metadata FROM consolidation_sources ORDER BY id");
  return rows.map(row => row.metadata);
}
export async function validateConsolidationCase(c: ConsolidationCase): Promise<void> {
  const recipe = consolidationRecipes.find(r => r.id === c.recipeId);
  if (!recipe || !recipe.baseSolutionIds.includes(c.baseSolutionId)) throw new ConsolidationError(422, "Unsupported recipe or base source.");
  const ids = c.selectedSources.map(s => s.id);
  if (ids.length < 2) throw new ConsolidationError(422, "Consolidation requires at least two sources.");
  if (new Set(ids).size !== ids.length || !ids.includes(c.baseSolutionId) || ids.some(id => !recipe.sourceIds.includes(id))) throw new ConsolidationError(422, "Select unique sources from this trusted recipe, including the base.");
  if (!c.capabilityIds.length || new Set(c.capabilityIds).size !== c.capabilityIds.length || c.capabilityIds.some(id => !recipe.capabilities.some(cap => cap.id === id && ids.includes(cap.sourceId)))) throw new ConsolidationError(422, "Every capability must have its selected registered source.");
  const requiredEdges = [...new Set(recipe.capabilities.filter(cap => c.capabilityIds.includes(cap.id)).map(cap => cap.edgeId))].sort();
  if (canonical([...c.wiring.edgeIds].sort()) !== canonical(requiredEdges)) throw new ConsolidationError(422, "Wiring must connect exactly the enabled capabilities using the supported edges.");
  const registered = await registeredConsolidationSources();
  for (const source of c.selectedSources) {
    if (!registered.some(r => r.id === source.id && r.version === source.version && r.sha256 === source.sha256 && r.solutionId === source.solutionId)) throw new ConsolidationError(409, "A selected source version is not registered or its hash changed.");
    const definition = sources.find(s => s.id === source.id)!;
    const current = await currentSourceArchive(definition);
    if (hash(current.bytes) !== source.sha256) throw new ConsolidationError(409, `Current ${source.id} source differs from the pinned registered version. Restore reviewed source before running or exporting.`);
  }
  if (c.recipeId === "finance") {
    if (c.capabilityIds.length !== 2 || ids.length !== 2) throw new ConsolidationError(422, "Forecast to Report requires both reviewed engines and their connecting adapter.");
    const parsed = financeConfigSchema.safeParse(c.config);
    if (!parsed.success) throw new ConsolidationError(422, "Finance configuration contains unsupported fields or values.");
    const result = await validateFinanceConfig(parsed.data);
    if (!result.valid) throw new ConsolidationError(422, result.errors.join("; "));
  } else if (!z.object({ schemaVersion: z.literal(1) }).strict().safeParse(c.config).success) {
    throw new ConsolidationError(422, "Invoice config must be {schemaVersion:1}; capability and wiring choices are explicit.");
  }
  if (c.fingerprint && c.fingerprint !== consolidationFingerprint(c)) throw new ConsolidationError(409, "The persisted recipe fingerprint does not match its contents.");
}
function present(row: Record<string, any>): ConsolidationCase {
  const c = { ...row.snapshot, id: row.id, revision: row.revision, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  return { ...c, assessment: assessCombination(c.requirements ?? [], c) };
}
export async function ownedConsolidationCase(userId: string, id: string): Promise<ConsolidationCase> {
  const { rows } = await pool.query("SELECT * FROM consolidation_cases WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!rows[0]) throw new ConsolidationError(404, "Consolidation case not found.");
  return present(rows[0]);
}
export async function listConsolidationCases(userId: string) {
  const { rows } = await pool.query("SELECT * FROM consolidation_cases WHERE user_id=$1 ORDER BY updated_at DESC", [userId]);
  return rows.map(present);
}

/** Intake has one repeatable destination per account and recipe; reopening preserves edits. */
export async function openIntakeCombination(userId: string, briefId: string, recipeId: "invoice" | "finance") {
  const lock = await pool.connect();
  const key = `intake-combination:${JSON.stringify([userId, briefId, recipeId])}`;
  try {
    await lock.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [key]);
    const existing = (await listConsolidationCases(userId)).find(c => c.briefId === briefId && c.recipeId === recipeId);
    if (existing) return existing;
    const brief = await getBrief(briefId);
    if (!brief) throw new ConsolidationError(404, "Intake brief not found.");
    if (!brief.confirmed) throw new ConsolidationError(422, "Confirm your intake before opening Workbench.");
    const recipe = (await recipeCatalog()).find(r => r.id === recipeId)!;
    if (!recipe.defaultConfig) throw new ConsolidationError(409, "The combination's starting configuration is unavailable.");
    return await saveConsolidationCase(userId, {
      briefId, recipeId, title: recipe.name, need: (brief.better || brief.rawText).slice(0, 4000),
      baseSolutionId: recipe.baseSolutionIds[0], selectedSourceIds: [...recipe.sourceIds],
      capabilityIds: recipe.capabilities.map(c => c.id), config: recipe.defaultConfig,
      wiring: { edgeIds: [...new Set(recipe.capabilities.map(c => c.edgeId))] },
    });
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [key]);
    lock.release();
  }
}
export async function saveConsolidationCase(userId: string, input: z.infer<typeof consolidationCaseInput>, existingId?: string, expectedRevision?: number) {
  const old = existingId ? await ownedConsolidationCase(userId, existingId) : undefined;
  if (old && (old.recipeId !== input.recipeId || old.revision !== expectedRevision)) throw new ConsolidationError(409, "Recipe is immutable or revision is stale. Reload before updating.");
  const briefId = input.briefId ?? old?.briefId;
  let requirements = old?.requirements ?? [];
  if (briefId && (briefId !== old?.briefId || !old?.requirements)) {
    const brief = await getBrief(briefId);
    if (!brief) throw new ConsolidationError(404, "Intake brief not found.");
    if (!brief.confirmed) throw new ConsolidationError(422, "Confirm the intake requirements before linking them.");
    requirements = brief.requirements.map((r, index) => ({ id: r.id, text: r.text, priority: index + 1 }));
  }
  const registered = await registeredConsolidationSources();
  const selectedSources = input.selectedSourceIds.map(id => {
    const source = registered.find(s => s.id === id);
    if (!source) throw new ConsolidationError(422, `Source ${id} must be registered by IT before use.`);
    return { id, solutionId: source.solutionId, version: source.version, sha256: source.sha256 };
  });
  const id = existingId ?? `cc_${randomUUID()}`;
  const { selectedSourceIds: _, ...fields } = input;
  const snapshot: ConsolidationCase = { ...fields, briefId, requirements, id, selectedSources, revision: (old?.revision ?? 0) + 1,
    createdAt: old?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), fingerprint: "",
    runUrl: `${consolidationRecipes.find(r => r.id === input.recipeId)!.runPath}?consolidationCaseId=${encodeURIComponent(id)}` };
  await validateConsolidationCase(snapshot);
  snapshot.fingerprint = consolidationFingerprint(snapshot);
  const result = old
    ? await pool.query("UPDATE consolidation_cases SET snapshot=$1,revision=revision+1,updated_at=clock_timestamp() WHERE id=$2 AND user_id=$3 AND revision=$4 RETURNING *", [snapshot, id, userId, expectedRevision])
    : await pool.query("INSERT INTO consolidation_cases(id,user_id,snapshot) VALUES($1,$2,$3) RETURNING *", [id, userId, snapshot]);
  if (!result.rows[0]) throw new ConsolidationError(409, "Case changed concurrently. Reload before updating.");
  return present(result.rows[0]);
}

// Small deterministic stored ZIP writer: only repository-owned allowlisted files enter it.
function zip(files: { name: string; bytes: Buffer }[]) {
  let offset = 0; const local: Buffer[] = [], central: Buffer[] = [];
  for (const file of files) {
    const name = Buffer.from(file.name); let crc = 0xffffffff;
    for (const byte of file.bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20,4); h.writeUInt32LE(crc,14); h.writeUInt32LE(file.bytes.length,18); h.writeUInt32LE(file.bytes.length,22); h.writeUInt16LE(name.length,26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20,4); c.writeUInt16LE(20,6); c.writeUInt32LE(crc,16); c.writeUInt32LE(file.bytes.length,20); c.writeUInt32LE(file.bytes.length,24); c.writeUInt16LE(name.length,28); c.writeUInt32LE(offset,42);
    local.push(h,name,file.bytes); central.push(c,name); offset += h.length + name.length + file.bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length,8); end.writeUInt16LE(files.length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
async function currentSourceArchive(source: typeof sources[number]) {
  const root = financeRepositoryRoot();
    let bytes: Buffer, evidence: {path: string; sha256: string; size: number}[] = [];
    if ("filename" in source) {
      bytes = await readFile(join(root,"attached_assets",source.filename));
      if (hash(bytes) !== source.expectedHash) throw new ConsolidationError(409, "Delivered finance original hash does not match reviewed provenance.");
    } else {
      const folder = join(root,"artifacts",source.id);
      const names: string[] = JSON.parse(await readFile(join(folder,"package-files.json"),"utf8"));
      const files = [];
      for (const name of [...names].sort()) {
        if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").some(p => p === ".." || p === ".") || isRedistributionExcludedPath(name)) throw new ConsolidationError(422, "Unsafe reviewed source allowlist.");
        const stat = await lstat(join(folder,name));
        if (!stat.isFile() || stat.isSymbolicLink()) throw new ConsolidationError(422, "Reviewed source is not a regular file.");
        const content = await readFile(join(folder,name));
        files.push({name,bytes:content}); evidence.push({path:name,sha256:hash(content),size:content.length});
      }
      bytes = zip(files);
    }
    return { bytes, evidence };
}
export async function currentConsolidationSourceHash(id: string): Promise<string> {
  const definition = sources.find(s => s.id === id);
  if (!definition) throw new ConsolidationError(422, "Source is outside the trusted registry.");
  return hash((await currentSourceArchive(definition)).bytes);
}
export async function registerConsolidationSources(userId: string) {
  // Authorization belongs here as well as in the HTTP route: scripts cannot silently grant rights.
  const permission = await pool.query("SELECT can_manage_solution_packages FROM users WHERE id=$1", [userId]);
  if (permission.rows[0]?.can_manage_solution_packages !== true) throw new ConsolidationError(403, "Existing IT package-management permission is required to register sources.");
  return registerBundledSources(userId);
}

/** Operator-only development seed; never exposed by an HTTP route or persona switch. */
export async function seedDemoConsolidationSources() {
  if (process.env.NODE_ENV !== "development") throw new ConsolidationError(403, "Demo source setup is development-only.");
  return registerBundledSources("demo-setup:persona-it");
}

async function registerBundledSources(userId: string) {
  for (const source of sources) {
    const { bytes, evidence } = await currentSourceArchive(source);
    const sha256 = hash(bytes), version = `sha256:${sha256}`, objectPath = await savePackageOriginal(sha256,bytes);
    const metadata = { id: source.id, solutionId: source.id, name: source.name, recipeId: source.recipeId, kind: source.kind,
      version, sha256, filename: "filename" in source ? source.filename : `${source.id}-${sha256.slice(0,16)}.zip`,
      size: bytes.length, files: evidence, registeredBy: userId, registeredAt: new Date().toISOString(),
      downloadUrl: `/api/consolidation/sources/${source.id}/download`,
      provenance: source.kind === "delivered-original" ? "Exact delivered archive, hash verified against finance provenance.json. May contain sensitive files; not a scrubbed redistribution package." : "Deterministic source ZIP from the original application's explicit package-files.json allowlist. Original application files unchanged.",
      limitations: ["Synthetic demonstration only; source registration is not a security audit or production-readiness approval."] };
    const { rows } = await pool.query("INSERT INTO consolidation_sources(id,version,sha256,metadata,object_path,registered_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id WHERE consolidation_sources.sha256=EXCLUDED.sha256 RETURNING id", [source.id,version,sha256,metadata,objectPath,userId]);
    if (!rows.length) throw new ConsolidationError(409, `Source ${source.id} changed; existing registered versions are immutable.`);
  }
  return registeredConsolidationSources();
}
export async function consolidationSourceDownload(id: string) {
  const { rows } = await pool.query("SELECT metadata,object_path FROM consolidation_sources WHERE id=$1", [id]);
  if (!rows[0]) throw new ConsolidationError(404, "Registered source not found.");
  const [bytes] = await packageObject(rows[0].object_path).download();
  if (hash(bytes) !== rows[0].metadata.sha256) throw new ConsolidationError(409, "Source integrity check failed.");
  return { bytes, filename: rows[0].metadata.filename as string };
}
