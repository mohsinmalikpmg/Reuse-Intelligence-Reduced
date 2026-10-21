import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  FinanceWiringError, financeRepositoryRoot, financeCatalog, financeConfigSchema,
  validateFinanceConfig, runFinanceConfig, financeState, saveFinanceVersion,
  restoreFinanceVersion, ownedFinanceVersion, exportFinanceVersion,
} from "./finance-wiring";
import financeRouter from "../routes/finance-wiring";

const owners = [`finance-wiring-test-${randomUUID()}`, `finance-wiring-test-${randomUUID()}`];
after(async () => {
  await pool.query("DELETE FROM finance_wiring_states WHERE user_id=ANY($1::text[])", [owners]);
  await pool.end();
});

const hasStatus = (status: number) => (error: unknown) => error instanceof FinanceWiringError && error.status === status;

test("source module resolves the reviewed worker and enforces exact config invariants", async () => {
  assert.ok(financeRepositoryRoot().startsWith("/"));
  const catalog = await financeCatalog();
  assert.equal(catalog.accounts.length, 10);
  assert.equal(catalog.centres.length, 2);
  assert.ok(catalog.sources.every(source => /^[0-9a-f]{64}$/.test(source.sha256)));
  const config = catalog.defaultConfig;
  assert.equal(financeConfigSchema.safeParse(config).success, true);
  assert.equal(financeConfigSchema.safeParse({ ...config, arbitraryCode: "print(1)" }).success, false);
  assert.equal(financeConfigSchema.safeParse({ ...config, centres: [config.centres[0], config.centres[0]] }).success, false);
  assert.equal(financeConfigSchema.safeParse({ ...config, adjustment: 7 }).success, false);
  assert.equal(financeConfigSchema.safeParse({ ...config, accountMapping: { ...config.accountMapping, Revenue: 2 } }).success, false);
  assert.equal(financeConfigSchema.safeParse({ ...config, accountMapping: { ...config.accountMapping, extra: 2 } }).success, false);
  const validation = await validateFinanceConfig(config);
  assert.equal(validation.valid, true);
  assert.match(validation.fingerprint!, /^[0-9a-f]{64}$/);
  const invalid = await validateFinanceConfig({ ...config, adjustment: 7 });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.length);
  const result = await runFinanceConfig(config);
  assert.equal(result.fingerprint, validation.fingerprint);
  assert.deepEqual(result.config, validation.config);
  assert.ok(result.lines.length >= 12);
  assert.equal(result.months.length, 3);
});

test("worker input and concurrent process count are bounded", async () => {
  await assert.rejects(validateFinanceConfig({ tooLarge: "x".repeat(17 * 1024) }), hasStatus(400));
  const concurrent = await Promise.allSettled(Array.from({ length: 5 }, () => financeCatalog()));
  const failures = concurrent.filter(result => result.status === "rejected");
  assert.equal(failures.length, 1);
  assert.ok(failures[0].status === "rejected" && hasStatus(429)(failures[0].reason));
});

test("real DB snapshots, optimistic writes, restore, exports and owner isolation", async () => {
  const [owner, stranger] = owners;
  const config = (await financeCatalog()).defaultConfig;
  assert.deepEqual(await financeState(owner), { revision: 0, activeVersionId: null, versions: [] });
  const first = await saveFinanceVersion(owner, config, 0);
  assert.equal(first.revision, 1);
  assert.equal(first.versions.length, 1);
  assert.equal(first.versions[0].number, 1);
  assert.equal(first.activeVersionId, first.versions[0].id);
  const saved = first.versions[0];
  assert.deepEqual(saved.config, saved.result.config);
  assert.equal(saved.fingerprint, saved.result.fingerprint);
  await assert.rejects(saveFinanceVersion(owner, config, 0), hasStatus(409));
  assert.deepEqual((await financeState(stranger)).versions, []);
  await assert.rejects(ownedFinanceVersion(stranger, saved.id), hasStatus(404));
  await assert.rejects(exportFinanceVersion(stranger, saved.id), hasStatus(404));
  await assert.rejects(restoreFinanceVersion(stranger, saved.id, 0), hasStatus(404));
  const raced = await Promise.allSettled([
    saveFinanceVersion(owner, { ...config, adjustment: 6 }, 1),
    saveFinanceVersion(owner, { ...config, adjustment: 12 }, 1),
  ]);
  assert.equal(raced.filter(result => result.status === "fulfilled").length, 1);
  const rejected = raced.find(result => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && hasStatus(409)(rejected.reason));
  const second = await financeState(owner);
  assert.equal(second.revision, 2);
  assert.equal(second.versions.length, 2);
  assert.deepEqual(second.versions[1], saved);
  await assert.rejects(restoreFinanceVersion(owner, saved.id, 1), hasStatus(409));
  const restored = await restoreFinanceVersion(owner, saved.id, 2);
  assert.equal(restored.revision, 3);
  assert.equal(restored.activeVersionId, saved.id);
  assert.deepEqual(restored.versions, second.versions);
  const archive = await exportFinanceVersion(owner, saved.id);
  assert.equal(archive.number, 1);
  assert.equal(archive.archive.subarray(0, 2).toString(), "PK");
  assert.ok(archive.archive.length <= 5 * 1024 * 1024);
  assert.deepEqual(await ownedFinanceVersion(owner, saved.id), saved);
  const afterRestore = await saveFinanceVersion(owner, config, 3);
  assert.equal(afterRestore.revision, 4);
  assert.equal(afterRestore.versions[0].number, 3);
});

test("router requires actual identity and rejects cross-origin mutations", async () => {
  // Invoke only the isolated router middleware; no app/workflow or HTTP listener.
  async function request(path: string, method: string, origin?: string, user?: { id: string }) {
    let status = 200;
    let response: unknown;
    const headers = { host: "workbench.test", ...(origin ? { origin } : {}) };
    const req = {
      url: path, method, headers, user, protocol: "https", baseUrl: "", originalUrl: path,
      get(name: string) { return headers[name.toLowerCase() as keyof typeof headers]; },
    };
    const res = {
      setHeader() {}, status(code: number) { status = code; return this; },
      json(body: unknown) { response = body; },
    };
    (financeRouter as unknown as { handle(req: unknown, res: unknown, next: (error?: unknown) => void): void }).handle(req, res, error => { if (error) throw error; });
    await new Promise(resolve => setImmediate(resolve));
    return { status, response };
  }
  for (const [path, method] of [
    ["/finance-wiring/versions", "GET"],
    ["/finance-wiring/versions", "POST"],
    ["/finance-wiring/restore", "POST"],
    ["/finance-wiring/versions/any/export", "GET"],
  ]) {
    const response = await request(path, method);
    assert.equal(response.status, 401);
    assert.match(JSON.stringify(response.response), /Sign in/);
  }
  assert.equal((await request("/finance-wiring/run", "POST", "https://evil.test")).status, 403);
  assert.equal((await request("/finance-wiring/run", "POST")).status, 403);
  assert.equal((await request("/finance-wiring/run", "POST", "http://workbench.test")).status, 403);
  assert.equal((await request("/finance-wiring/run", "POST", "https://workbench.test")).status, 400);
  assert.equal((await request("/finance-wiring/versions", "POST", "https://workbench.test", { id: owners[0] })).status, 400);
  assert.equal((await request("/finance-wiring/versions", "POST", "https://evil.test", { id: owners[0] })).status, 403);
});
