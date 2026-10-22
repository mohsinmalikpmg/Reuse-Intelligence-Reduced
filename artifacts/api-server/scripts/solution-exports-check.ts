/**
 * Integration harness: an isolated ephemeral HTTP listener injects synthetic test
 * identity. No application authentication bypass is installed.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import express from "express";
import { pool } from "@workspace/db";
import router from "../src/routes/solution-exports";
import { createCase, getCase } from "../src/lib/store";
import { validateExportLinks } from "../src/lib/solution-export-links";
import { packageObject } from "../src/lib/solution-package-storage";

const user = `export-test-${randomUUID()}`;
const other = `export-other-${randomUUID()}`;
const caseId = `export-case-${randomUUID()}`;
const compositionId = `export-composition-${randomUUID()}`;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const identity = req.get("x-test-user");
  req.isAuthenticated = (() => !!identity) as typeof req.isAuthenticated;
  if (identity) req.user = { id: identity } as Express.User;
  req.log = { error() {}, warn() {} } as typeof req.log;
  next();
});
app.use(router);
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: error.message }));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address() as { port: number };
const url = `http://127.0.0.1:${address.port}`;
async function request(path: string, method = "GET", body?: unknown, identity: string | null = user) {
  return fetch(url + path, { method, headers: { ...(identity ? { "x-test-user": identity } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
try {
  await pool.query("INSERT INTO users(id) VALUES($1),($2)", [user,other]);
  await createCase({ id: caseId, baseSolutionId: "sol-workorder-insight", moduleIds: ["cap-clustering","cap-similarity","cap-safety-signals","cap-action-tracking"] });
  const c = (await getCase(caseId))!;
  assert.equal((await request("/solution-exports", "GET", undefined, null)).status, 401);
  assert.equal((await request("/solution-exports", "POST", { caseId, expectedUpdatedAt: "stale" })).status, 409);
  const body = { caseId, expectedUpdatedAt: c.updatedAt };
  const firstResponse = await request("/solution-exports","POST",body);
  assert.equal(firstResponse.status,200);
  const first = await firstResponse.json() as any;
  assert.ok(["ready","incomplete"].includes(first.status), JSON.stringify(first));
  assert.ok(first.checks.length && first.checks.every((x: any) => x.passed));
  const second = await (await request("/solution-exports","POST",body)).json() as any;
  assert.equal(first.id,second.id,"repeat export reuses record");
  const downloaded = await request(`/solution-exports/${first.id}/download`);
  assert.equal(downloaded.status,200);
  assert.equal(createHash("sha256").update(Buffer.from(await downloaded.arrayBuffer())).digest("hex"),first.sha256);
  assert.equal((await request(`/solution-exports/${first.id}/download`,"GET",undefined,null)).status,401);
  // Legacy ordinary-case export visibility is intentionally unchanged.
  assert.equal((await request(`/solution-exports/${first.id}/download`,"GET",undefined,other)).status,200);
  const legacyList = await (await request(`/solution-exports?caseId=${caseId}`,"GET",undefined,other)).json() as any[];
  assert.ok(legacyList.some(e=>e.id===first.id));
  // Link this real case/export to a private composition, then exercise the
  // actual router in isolation (without the global compositions middleware).
  await pool.query("INSERT INTO compositions(id,user_id,idempotency_key,request_fingerprint,case_id,snapshot) VALUES($1,$2,$1,'test-only',$3,$4)",
    [compositionId,user,caseId,{caseKind:"case",testFixture:true}]);
  for (const manager of [false,true]) {
    await pool.query("UPDATE users SET can_manage_solution_packages=$2 WHERE id=$1",[other,manager]);
    for (const path of ["/solution-exports",`/solution-exports?caseId=${caseId}`,`/solution-exports?solutionId=${c.baseSolutionId}`]) {
      const response = await request(path,"GET",undefined,other);
      assert.equal(response.status,200);
      const listed = await response.json() as any[];
      assert.ok(!listed.some(e=>e.id===first.id),"Private composition export must not leak through collection/filter listing.");
    }
    assert.equal((await request(`/solution-exports/${first.id}/download`,"GET",undefined,other)).status,404);
    assert.equal((await request("/solution-exports","POST",body,other)).status,404);
    assert.equal((await request(`/solution-exports/${first.id}/link`,"PUT",{workspaceUrl:"https://replit.com/@fixture/private",publishedUrl:"",expectedRevision:0},other)).status,404);
  }
  const ownerList = await (await request(`/solution-exports?caseId=${caseId}`)).json() as any[];
  assert.ok(ownerList.some(e=>e.id===first.id));
  assert.ok(ownerList.every(e=>!("object_path" in e) && !("objectPath" in e)),"Private object paths must never be serialized.");
  assert.equal((await request(`/solution-exports/${first.id}/download`)).status,200);
  assert.equal((await request("/solution-exports","POST",body)).status,200);
  const stored = await pool.query("SELECT object_path FROM solution_exports WHERE id=$1",[first.id]);
  const object = packageObject(stored.rows[0].object_path);
  const rawDownload = await fetch(`https://storage.googleapis.com/${encodeURIComponent(object.bucket.name)}/${object.name.split("/").map(encodeURIComponent).join("/")}`);
  assert.ok([403,404].includes(rawDownload.status),"The private export object must not be publicly downloadable outside the authorized route.");
  await rawDownload.body?.cancel();
  console.log("PASS unauthenticated direct object-storage download denied (no bucket/path disclosed).");
  await pool.query("DELETE FROM compositions WHERE id=$1",[compositionId]);
  await pool.query("UPDATE users SET can_manage_solution_packages=false WHERE id=$1",[other]);
  console.log("PASS two-account real-route export privacy: ordinary private composition listings/download/create/link denied to other account (including manager), owner permitted, legacy access preserved.");
  const link = { workspaceUrl: "https://replit.com/@fixture/test-app", publishedUrl: "https://fixture-test.replit.app", expectedRevision: 0 };
  assert.equal((await request(`/solution-exports/${first.id}/link`,"PUT",link,other)).status,403);
  const saved = await (await request(`/solution-exports/${first.id}/link`,"PUT",link)).json() as any;
  assert.equal(saved.verificationState,"link_recorded_unverified");
  assert.equal(saved.linkRevision,1);
  assert.equal((await request(`/solution-exports/${first.id}/link`,"PUT",link)).status,409);
  const history = await (await request(`/solution-exports?solutionId=${c.baseSolutionId}`)).json() as any[];
  assert.equal(history.find(x => x.id === first.id)?.workspaceUrl,link.workspaceUrl);
  const removed = await (await request(`/solution-exports/${first.id}/link`,"PUT",{ workspaceUrl:"",publishedUrl:"",expectedRevision:1 })).json() as any;
  assert.equal(removed.verificationState,"awaiting_import");
  const restored = await request(`/solution-exports/${first.id}/link`,"PUT",{...link,expectedRevision:2});
  assert.equal(restored.status,200);
  await pool.query("UPDATE cases SET title=title || ' edited',updated_at=now() WHERE id=$1",[caseId]);
  assert.equal((await request("/solution-exports","POST",body)).status,409);
  const newer = (await getCase(caseId))!;
  const changed = await (await request("/solution-exports","POST",{caseId,expectedUpdatedAt:newer.updatedAt})).json() as any;
  assert.notEqual(changed.id,first.id);
  assert.equal((await request(`/solution-exports/${first.id}/download`)).status,200);
  // Exercise a storage outage without replacing the previous valid output.
  await pool.query("UPDATE cases SET title=title || ' failure',updated_at=now() WHERE id=$1",[caseId]);
  const failedCase = (await getCase(caseId))!;
  const privateRoot = process.env.PRIVATE_OBJECT_DIR;
  let failed: any;
  try {
    delete process.env.PRIVATE_OBJECT_DIR;
    failed = await (await request("/solution-exports","POST",{caseId,expectedUpdatedAt:failedCase.updatedAt})).json();
    assert.equal(failed.status,"failed");
    assert.match(failed.sha256, /^[a-f0-9]{64}$/);
    assert.ok(failed.checks.some((check: any) => check.name === "private-storage" && !check.passed));
    assert.equal((await request(`/solution-exports/${failed.id}/download`)).status,404);
  } finally {
    if (privateRoot !== undefined) process.env.PRIVATE_OBJECT_DIR = privateRoot;
  }
  const recovered = await (await request("/solution-exports","POST",{caseId,expectedUpdatedAt:failedCase.updatedAt})).json() as any;
  assert.equal(recovered.id,failed.id);
  assert.ok(["ready","incomplete"].includes(recovered.status));
  assert.equal((await request(`/solution-exports/${first.id}/download`)).status,200);
  for (const invalid of [
    "http://replit.com/@owner/app","https://replit.com.evil.test/@owner/app",
    "https://user:pass@replit.com/@owner/app","https://replit.com/import",
    "https://replit.com/@owner/app?token=secret","https://replit.com/@owner/app#x",
    "https://localhost/@owner/app",
  ]) assert.throws(() => validateExportLinks(invalid,""));
  assert.throws(() => validateExportLinks(link.workspaceUrl,"https://preview.replit.dev"));
  assert.throws(() => validateExportLinks("","https://test.replit.app"));
  console.log("PASS export lifecycle: real build/storage/download hash; idempotency; stale case; versions; failure recovery; auth; link revision/edit/remove/persistence; URL safety.");
} finally {
  await pool.query("DELETE FROM compositions WHERE id=$1",[compositionId]);
  await pool.query("DELETE FROM solution_exports WHERE created_by=$1",[user]);
  await pool.query("DELETE FROM cases WHERE id=$1",[caseId]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::text[])",[[user,other]]);
  await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.end();
}
