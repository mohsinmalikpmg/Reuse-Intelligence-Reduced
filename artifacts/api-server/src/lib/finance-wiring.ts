import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  GetFinanceWiringCatalogResponse, RunFinanceWiringResponse, ValidateFinanceWiringResponse,
  RunFinanceWiringBody,
  type FinanceWiringConfig, type FinanceWiringState, type FinanceWiringVersion,
} from "@workspace/api-zod";

export class FinanceWiringError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Resolve from both the source module and bundled dist, without depending on cwd.
export function financeRepositoryRoot() {
  for (const start of [dirname(fileURLToPath(import.meta.url)), process.cwd()]) {
    let dir = resolve(start);
    while (true) {
      if (existsSync(join(dir, "pnpm-workspace.yaml")) && existsSync(join(dir, "artifacts/finance-consolidation-demo"))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new FinanceWiringError(503, "The reviewed finance worker is unavailable.");
}

let running = 0;
const MAX_INPUT = 16 * 1024;

// Only these two reviewed programs can execute. No user code, paths, arguments,
// inherited credentials, HTTP requests to the demo, or unbounded output.
async function execute(script: "wiring-worker.py" | "export-wiring.py", payload: unknown): Promise<Buffer> {
  const input = JSON.stringify(payload);
  if (Buffer.byteLength(input) > MAX_INPUT) throw new FinanceWiringError(400, "Finance configuration is too large.");
  if (running >= 4) throw new FinanceWiringError(429, "Finance workers are busy. Try again shortly.");
  const root = financeRepositoryRoot();
  const path = join(root, "artifacts/finance-consolidation-demo", script);
  if (!existsSync(path)) throw new FinanceWiringError(503, "The reviewed finance worker is unavailable.");
  const exporting = script === "export-wiring.py";
  const maxOutput = exporting ? 5 * 1024 * 1024 : 1024 * 1024;
  running++;
  try {
    return await new Promise<Buffer>((resolveOutput, reject) => {
      const child = spawn("python3", ["-B", path], {
        cwd: root, env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const chunks: Buffer[] = [];
      let bytes = 0;
      let errorBytes = 0;
      let failure: FinanceWiringError | undefined;
      const fail = (status: number, message: string) => {
        failure ??= new FinanceWiringError(status, message);
        child.kill("SIGKILL");
      };
      const timer = setTimeout(() => fail(504, "The finance worker timed out. Try again."), exporting ? 20_000 : 15_000);
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxOutput) { fail(502, "The finance worker exceeded its output limit."); return; }
        chunks.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        errorBytes += chunk.length;
        if (errorBytes > 64 * 1024) fail(502, "The finance worker exceeded its diagnostic limit.");
      });
      child.stdin.on("error", () => { /* Process exit is handled below; never expose stderr. */ });
      child.on("error", () => { failure ??= new FinanceWiringError(503, "The reviewed finance worker could not start."); });
      child.on("close", code => {
        clearTimeout(timer);
        if (failure) { reject(failure); return; }
        if (code !== 0) {
          reject(new FinanceWiringError(code === 2 ? 422 : 502, code === 2 ? "The finance configuration was rejected. Validate it before retrying." : "The finance worker could not complete this request."));
          return;
        }
        resolveOutput(Buffer.concat(chunks));
      });
      child.stdin.end(input);
    });
  } finally { running--; }
}

async function worker(action: "catalog" | "validate" | "run", config?: unknown): Promise<unknown> {
  const output = await execute("wiring-worker.py", { action, ...(config === undefined ? {} : { config }) });
  try { return JSON.parse(output.toString("utf8")); }
  catch { throw new FinanceWiringError(502, "The finance worker returned an invalid response."); }
}

// Generated schema owns the contract. Add the uniqueness invariant (which Orval
// does not generate) and reject unknown keys rather than silently dropping them.
export const financeConfigSchema = RunFinanceWiringBody.shape.config.extend({
  accountMapping: RunFinanceWiringBody.shape.config.shape.accountMapping.strict(),
}).strict().refine(config => new Set(config.centres).size === config.centres.length, "Centres must be unique.");

export async function financeCatalog() {
  return GetFinanceWiringCatalogResponse.parse(await worker("catalog"));
}
export async function validateFinanceConfig(config: unknown) {
  return ValidateFinanceWiringResponse.parse(await worker("validate", config));
}
export async function runFinanceConfig(config: FinanceWiringConfig) {
  return RunFinanceWiringResponse.parse(await worker("run", config));
}

type Queryable = Pick<typeof pool, "query">;

export async function financeState(userId: string, client: Queryable = pool): Promise<FinanceWiringState> {
  // A single statement gives a coherent state + version list under READ COMMITTED.
  const { rows } = await client.query(`SELECT s.revision, s.active_version_id,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', v.id, 'number', v.number, 'createdAt', v.created_at,
      'config', v.config, 'fingerprint', v.fingerprint, 'result', v.result)
      ORDER BY v.number DESC) FROM finance_wiring_versions v WHERE v.user_id=s.user_id), '[]'::jsonb) AS versions
    FROM finance_wiring_states s WHERE s.user_id=$1`, [userId]);
  return rows[0] ? {
    revision: rows[0].revision, activeVersionId: rows[0].active_version_id,
    versions: (rows[0].versions as FinanceWiringVersion[]).map(version => ({ ...version, createdAt: new Date(version.createdAt) })),
  } :
    { revision: 0, activeVersionId: null, versions: [] };
}

export async function ownedFinanceVersion(userId: string, id: string): Promise<FinanceWiringVersion> {
  const { rows } = await pool.query("SELECT id,number,created_at,config,fingerprint,result FROM finance_wiring_versions WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!rows[0]) throw new FinanceWiringError(404, "Saved finance version not found.");
  return { id: rows[0].id, number: rows[0].number, createdAt: new Date(rows[0].created_at), config: rows[0].config, fingerprint: rows[0].fingerprint, result: rows[0].result };
}

function revisionConflict(): never {
  throw new FinanceWiringError(409, "Finance wiring changed in another session. Reload before saving or restoring; your changes were not applied.");
}

export async function saveFinanceVersion(userId: string, config: FinanceWiringConfig, expectedRevision: number) {
  if ((await financeState(userId)).revision !== expectedRevision) revisionConflict();
  // Execute the reviewed server worker; never accept a client-provided result.
  const result = await runFinanceConfig(config);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO finance_wiring_states(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING", [userId]);
    const { rows } = await client.query("SELECT revision FROM finance_wiring_states WHERE user_id=$1 FOR UPDATE", [userId]);
    if (rows[0].revision !== expectedRevision) revisionConflict();
    const id = randomUUID();
    await client.query(`INSERT INTO finance_wiring_versions(id,user_id,number,config,fingerprint,result)
      SELECT $1,$2,COALESCE(MAX(number),0)+1,$3,$4,$5 FROM finance_wiring_versions WHERE user_id=$2`,
    [id, userId, JSON.stringify(result.config), result.fingerprint, JSON.stringify(result)]);
    await client.query("UPDATE finance_wiring_states SET revision=revision+1,active_version_id=$1 WHERE user_id=$2 AND revision=$3", [id, userId, expectedRevision]);
    const state = await financeState(userId, client);
    await client.query("COMMIT");
    return state;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function restoreFinanceVersion(userId: string, versionId: string, expectedRevision: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT revision FROM finance_wiring_states WHERE user_id=$1 FOR UPDATE", [userId]);
    const { rows: owned } = await client.query("SELECT id FROM finance_wiring_versions WHERE id=$1 AND user_id=$2", [versionId, userId]);
    if (!owned.length) throw new FinanceWiringError(404, "Saved finance version not found.");
    if (!rows.length || rows[0].revision !== expectedRevision) revisionConflict();
    await client.query("UPDATE finance_wiring_states SET revision=revision+1,active_version_id=$1 WHERE user_id=$2 AND revision=$3", [versionId, userId, expectedRevision]);
    const state = await financeState(userId, client);
    await client.query("COMMIT");
    return state;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function exportFinanceVersion(userId: string, id: string) {
  const version = await ownedFinanceVersion(userId, id);
  const archive = await execute("export-wiring.py", {
    config: version.config, version: { id: version.id, number: version.number, fingerprint: version.fingerprint },
  });
  if (archive.length < 4 || !archive.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw new FinanceWiringError(502, "The finance export did not produce a valid ZIP.");
  }
  return { archive, number: version.number };
}
