import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { pool, db, casesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateSolutionExportBody, SaveSolutionExportLinkBody } from "@workspace/api-zod";
import { toCase } from "../lib/store";
import { buildConfiguration, caseContext } from "../lib/configuration";
import { buildSolutionExport, getExportSourceFingerprint, type SolutionExportResult } from "../lib/solution-export-builder";
import { packageObject, savePackageOriginal } from "../lib/solution-package-storage";
import { validateExportLinks } from "../lib/solution-export-links";

const router: IRouter = Router();
const base = "/solution-exports";
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function present(row: Record<string, any>, userId: string, manager: boolean) {
  return {
    id: row.id, caseId: row.case_id, solutionId: row.solution_id, title: row.title,
    sourceVersion: row.source_version, fingerprint: row.fingerprint, status: row.status,
    sha256: row.sha256, createdAt: row.created_at.toISOString(), createdBy: row.created_by,
    checks: row.checks, gaps: row.gaps, error: row.error, workspaceUrl: row.workspace_url,
    publishedUrl: row.published_url, linkRevision: row.link_revision,
    verificationState: row.workspace_url ? "link_recorded_unverified" : "awaiting_import",
    canEdit: row.created_by === userId || manager,
  };
}
router.use(base, async (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!req.isAuthenticated?.() || !req.user?.id) { res.status(401).json({ error: "Sign in to export solutions and see app links." }); return; }
  if (req.method !== "GET") {
    const origin = req.get("origin");
    let sameOrigin = true;
    try { if (origin) sameOrigin = new URL(origin).host === req.get("host"); } catch { sameOrigin = false; }
    if (!sameOrigin || req.get("sec-fetch-site") === "cross-site") { res.status(403).json({ error: "Cross-origin changes are forbidden." }); return; }
  }
  const { rows } = await pool.query("SELECT can_manage_solution_packages FROM users WHERE id=$1", [req.user.id]);
  res.locals.manager = rows[0]?.can_manage_solution_packages === true;
  next();
});
router.get(base, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM solution_exports WHERE ($1::text IS NULL OR case_id=$1) AND ($2::text IS NULL OR solution_id=$2) ORDER BY created_at DESC",
    [typeof req.query.caseId === "string" ? req.query.caseId : null, typeof req.query.solutionId === "string" ? req.query.solutionId : null],
  );
  res.json(rows.map(row => present(row, req.user!.id, res.locals.manager)));
});
router.post(base, async (req, res) => {
  const parsed = CreateSolutionExportBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A case and its current update timestamp are required." }); return; }
  // Read the whole case once. All build inputs below derive from this immutable snapshot.
  const [row] = await db.select().from(casesTable).where(eq(casesTable.id, parsed.data.caseId));
  if (!row) { res.status(404).json({ error: "Case not found." }); return; }
  const c = toCase(row);
  if (c.updatedAt !== parsed.data.expectedUpdatedAt) { res.status(409).json({ error: "This case changed. Refresh it before exporting." }); return; }
  const context = caseContext(c, c.requirements.map(r => r.text));
  if (context.base.execution !== "live") { res.status(409).json({ error: "Only supported demo-engine compositions can be exported." }); return; }
  const components = buildConfiguration(c, context).steps.flatMap(s => s.components).filter(s => s.active);
  const snapshot = {
    caseId: c.id, title: c.title, baseSolutionId: c.baseSolutionId, parentVersion: c.parentVersion,
    capabilities: components.map(s => s.capability),
    configValues: Object.fromEntries(components.filter(s => s.value).map(s => [s.capability.id, s.value!])),
    unresolvedRequests: c.capabilityRequests, requirements: c.requirements,
  };
  const fingerprint = digest({ snapshot, source: await getExportSourceFingerprint() });
  const id = digest({ fingerprint, creator: req.user!.id });
  const client = await pool.connect();
  let locked = false;
  try {
    // Session lock spans build, but no long-running DB transaction. Cluster-wide resource cap.
    const lock = await client.query("SELECT pg_try_advisory_lock(724193812) AS acquired");
    locked = lock.rows[0].acquired;
    if (!locked) { res.status(429).json({ error: "Another export is building. Retry shortly; existing exports are preserved." }); return; }
    const existing = await client.query("SELECT * FROM solution_exports WHERE id=$1", [id]);
    if (existing.rows[0] && ["ready", "incomplete"].includes(existing.rows[0].status)) {
      res.json(present(existing.rows[0], req.user!.id, res.locals.manager)); return;
    }
    if (!existing.rows.length) {
      const rate = await client.query("SELECT count(*)::int AS n FROM solution_exports WHERE created_by=$1 AND created_at>now()-interval '1 hour'", [req.user!.id]);
      if (rate.rows[0].n >= 10) { res.status(429).json({ error: "Maximum ten new exports per hour. Existing exports remain available." }); return; }
      await client.query("INSERT INTO solution_exports(id,case_id,solution_id,title,source_version,fingerprint,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [id,c.id,c.baseSolutionId,c.title,c.parentVersion,fingerprint,JSON.stringify(snapshot),req.user!.id]);
    } else {
      await client.query("UPDATE solution_exports SET status='building',error='' WHERE id=$1", [id]);
    }
    let output: SolutionExportResult | undefined;
    try {
      output = await buildSolutionExport(snapshot);
      if (output.checks.some(check => !check.passed)) throw Object.assign(new Error("Export validation failed."), output);
      const objectPath = await savePackageOriginal(output.sha256, output.bytes);
      const [stored] = await packageObject(objectPath).download();
      if (createHash("sha256").update(stored).digest("hex") !== output.sha256) throw Object.assign(new Error("Stored ZIP hash verification failed."), output);
      await client.query("UPDATE solution_exports SET status=$2,sha256=$3,object_path=$4,checks=$5,gaps=$6,error='' WHERE id=$1",
        [id,output.gaps.length ? "incomplete" : "ready",output.sha256,objectPath,JSON.stringify(output.checks),JSON.stringify(output.gaps)]);
    } catch (error) {
      req.log.error({ err: error, exportId: id }, "Solution export failed");
      const e = (output ?? error) as { sha256?: string; checks?: unknown[]; gaps?: string[] };
      await client.query("UPDATE solution_exports SET status='failed',sha256=$2,checks=$3,gaps=$4,error=$5 WHERE id=$1",
        [id,e.sha256 ?? null,JSON.stringify([...(e.checks ?? []), ...(output ? [{ name: "private-storage", passed: false, detail: "The built ZIP could not be saved and verified in private storage." }] : [])]),JSON.stringify(e.gaps ?? []),"Build or private storage validation failed. Retry this export; previous versions are unchanged."]);
    }
    const saved = await client.query("SELECT * FROM solution_exports WHERE id=$1", [id]);
    res.json(present(saved.rows[0], req.user!.id, res.locals.manager));
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(724193812)");
    client.release();
  }
});
router.put(`${base}/:id/link`, async (req, res) => {
  const parsed = SaveSolutionExportLinkBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide workspace URL, optional published URL and current link revision." }); return; }
  let links;
  try { links = validateExportLinks(parsed.data.workspaceUrl, parsed.data.publishedUrl); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid URL." }); return; }
  const result = await pool.query("UPDATE solution_exports SET workspace_url=$2,published_url=$3,link_revision=link_revision+1 WHERE id=$1 AND (created_by=$4 OR $5) AND link_revision=$6 AND status IN ('ready','incomplete') RETURNING *",
    [String(req.params.id),links.workspaceUrl,links.publishedUrl,req.user!.id,res.locals.manager,parsed.data.expectedRevision]);
  if (!result.rows.length) {
    const existing = await pool.query("SELECT created_by FROM solution_exports WHERE id=$1", [String(req.params.id)]);
    const status = !existing.rows.length ? 404 : existing.rows[0].created_by !== req.user!.id && !res.locals.manager ? 403 : 409;
    res.status(status).json({ error: status === 403 ? "Only the export creator or IT can edit this link." : status === 404 ? "Export not found." : "The link changed or the build is not downloadable. Refresh before editing." }); return;
  }
  res.json(present(result.rows[0],req.user!.id,res.locals.manager));
});
router.get(`${base}/:id/download`, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM solution_exports WHERE id=$1", [String(req.params.id)]);
  const row = rows[0];
  if (!row?.object_path || !["ready","incomplete"].includes(row.status)) { res.status(404).json({ error: "No validated ZIP available for this export." }); return; }
  try {
    const [bytes] = await packageObject(row.object_path).download();
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new Error("ZIP hash mismatch");
    res.type("application/zip").set("Content-Disposition", `attachment; filename="solution-${row.id.slice(0,12)}.zip"`).set("X-Content-Type-Options","nosniff").send(bytes);
  } catch (error) { req.log.error({err:error},"Export download failed"); res.status(503).json({error:"Stored export is unavailable or failed integrity verification."}); }
});
export default router;
