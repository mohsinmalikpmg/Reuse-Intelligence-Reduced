import { Router, type IRouter } from "express";
import { randomUUID, createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { z } from "zod";
import { blankModel, intakeModelSchema, confirmationIssues } from "../lib/intake-model";
import { interpretIntake } from "../lib/intake-interpret";
import { privateObjectFile } from "../lib/intake-files";
import { matchBrief } from "../lib/matching";
import type { Brief } from "@workspace/api-zod";

const router: IRouter = Router();
const revisionSchema = z.object({ revision: z.number().int().positive() });
const inputSchema = z.object({ title: z.string().trim().min(1).max(200) });
const updateSchema = inputSchema.extend({ model: intakeModelSchema, revision: z.number().int().positive() });
router.use("/intake/records", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Sign in to access your intakes." }); return; }
  if (req.method !== "GET") {
    try {
      const origin = req.headers.origin ?? req.get("referer");
      if (!origin || new URL(origin).host !== req.get("host")) throw new Error("origin");
    } catch {
      res.status(403).json({ error: "Cross-origin requests are not allowed." }); return;
    }
  }
  res.setHeader("Cache-Control", "no-store");
  next();
});
async function record(id: string, userId: string) {
  const { rows } = await pool.query("SELECT * FROM intake_records WHERE id=$1 AND user_id=$2", [id, userId]);
  return rows[0];
}
async function present(row: Record<string, any>) {
  const { rows: files } = await pool.query("SELECT id,name,source_id,size,status,text_content,error FROM intake_attachments WHERE record_id=$1 AND user_id=$2", [row.id, row.user_id]);
  return { id: row.id, title: row.title, model: row.model, revision: row.revision, status: row.status, updatedAt: row.updated_at.toISOString(),
    attachments: files.map(a => ({ id: a.id, name: a.name, sourceId: a.source_id, size: a.size, status: a.status, text: a.text_content, error: a.error })) };
}
router.get("/intake/records", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM intake_records WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100", [req.user!.id]);
  res.json(await Promise.all(rows.map(present)));
});
router.post("/intake/records", async (req, res) => {
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Give the intake a title (1–200 characters)." }); return; }
  const { rows } = await pool.query("INSERT INTO intake_records(id,user_id,title,model) VALUES($1,$2,$3,$4) RETURNING *", [randomUUID(), req.user!.id, parsed.data.title, JSON.stringify(blankModel())]);
  res.status(201).json(await present(rows[0]));
});
router.get("/intake/records/:id", async (req, res) => {
  const row = await record(String(req.params.id), req.user!.id);
  if (!row) { res.status(404).json({ error: "Intake not found." }); return; }
  res.json(await present(row));
});
router.put("/intake/records/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid intake data. Check fields and unique item identifiers." }); return; }
  const old = await record(String(req.params.id), req.user!.id);
  if (!old) { res.status(404).json({ error: "Intake not found." }); return; }
  const { model, revision, title } = parsed.data;
  // Clients cannot forge an interpretation fingerprint or final confirmation.
  model.interpretedHash = old.model.interpretedHash;
  model.confirmed = false;
  const { rows: owned } = await pool.query("SELECT id,source_id FROM intake_attachments WHERE record_id=$1 AND user_id=$2", [old.id, req.user!.id]);
  if (model.sources.some(s => s.files.some(id => !owned.some(a => a.id === id && a.source_id === s.id)))) {
    res.status(400).json({ error: "An attachment is missing or belongs to a different input." }); return;
  }
  for (const s of model.sources) {
    const before = old.model.sources.find((o: { id: string }) => o.id === s.id);
    if (!before || before.text !== s.text || before.name !== s.name || JSON.stringify([...before.files].sort()) !== JSON.stringify([...s.files].sort())) {
      s.changed = true;
      model.agreed = false;
      model.orderReviewed = false;
      if (s.id === "problem") for (const f of Object.values(model.profile)) { f.reviewed = false; f.changed = true; }
      for (const r of model.requirements) if (r.sources.includes(s.id)) { r.reviewed = false; r.changed = true; }
      for (const c of model.capabilities) if ((c.sourceId ?? c.id) === s.id) { c.status = "Needs clarification"; c.changed = true; c.carry = false; }
    }
  }
  const { rows } = await pool.query("UPDATE intake_records SET title=$1,model=$2,revision=revision+1,status=$3,updated_at=now() WHERE id=$4 AND user_id=$5 AND revision=$6 RETURNING *",
    [title, JSON.stringify(model), model.interpretedHash ? "review" : "draft", old.id, req.user!.id, revision]);
  if (!rows.length) { res.status(409).json({ error: "This intake changed in another session. Reload before saving; your draft has not been applied." }); return; }
  res.json(await present(rows[0]));
});
const interpreting = new Set<string>();
router.post("/intake/records/:id/compare", async (req, res) => {
  const parsed = revisionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A valid revision is required." }); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM intake_records WHERE id=$1 AND user_id=$2 FOR UPDATE", [String(req.params.id), req.user!.id]);
    const row = rows[0];
    if (!row) { await client.query("ROLLBACK"); res.status(404).json({ error: "Intake not found." }); return; }
    if (row.revision !== parsed.data.revision) { await client.query("ROLLBACK"); res.status(409).json({ error: "This intake has changed. Reload before comparing." }); return; }
    const model = intakeModelSchema.parse(row.model);
    if (row.status !== "confirmed" || !model.confirmed || confirmationIssues(model).length) {
      await client.query("ROLLBACK"); res.status(400).json({ error: "Confirm the current intake before comparing it with the library." }); return;
    }
    // One immutable handoff per confirmed revision. Do not reinterpret reviewed content,
    // send private attachments, or treat prototype claims as proven capabilities.
    const id = `brief_intake_${createHash("sha256").update(`${row.id}:${row.revision}`).digest("hex").slice(0, 32)}`;
    const field = (value: string) => ({ value, confidence: value ? 1 : 0 });
    const fields: Brief["fields"] = {
      user: field(model.profile.user.value), job: field(model.profile.outcome.value),
      currentProcess: field(model.profile.problem.value), painPoint: field(model.profile.problem.value),
      desiredOutcome: field(model.profile.outcome.value), constraints: field(model.profile.scope.value),
      data: field(""), requiredControls: field(""), successMeasures: field(""),
    };
    const brief: Brief = {
      id, rawText: Object.values(model.profile).map(f => f.value).join("\n\n"),
      fields, today: model.profile.problem.value, better: model.profile.outcome.value,
      requirements: model.requirements.map(r => ({ id: r.id, text: r.text, source: "added" })),
      clarifyingQuestion: null, clarification: null, source: "ai", valueStatement: "",
      confirmed: true, createdAt: new Date().toISOString(),
    };
    brief.valueStatement = matchBrief(brief).valueStatement;
    await client.query(`INSERT INTO briefs(id,raw_text,fields,today,better,requirements,source,value_statement,confirmed)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,true) ON CONFLICT(id) DO NOTHING`,
    [id, brief.rawText, JSON.stringify(fields), brief.today, brief.better, JSON.stringify(brief.requirements), brief.source, brief.valueStatement]);
    await client.query("COMMIT");
    res.json({ briefId: id });
  } catch (err) {
    await client.query("ROLLBACK");
    req.log.error({ errorType: err instanceof Error ? err.name : "Unknown" }, "Intake comparison handoff failed");
    res.status(500).json({ error: "Could not prepare the library comparison. Your confirmed intake is unchanged." });
  } finally { client.release(); }
});
router.post("/intake/records/:id/interpret", async (req, res) => {
  const parsed = revisionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A valid revision is required." }); return; }
  const old = await record(String(req.params.id), req.user!.id);
  if (!old) { res.status(404).json({ error: "Intake not found." }); return; }
  if (old.revision !== parsed.data.revision) { res.status(409).json({ error: "Reload the latest intake before interpreting." }); return; }
  if (interpreting.has(req.user!.id)) { res.status(429).json({ error: "Your previous interpretation is still running." }); return; }
  interpreting.add(req.user!.id);
  try {
    const { rows: attachments } = await pool.query("SELECT * FROM intake_attachments WHERE record_id=$1 AND user_id=$2", [old.id, req.user!.id]);
    const model = await interpretIntake(intakeModelSchema.parse(old.model), attachments);
    const { rows } = await pool.query("UPDATE intake_records SET model=$1,revision=revision+1,status='review',updated_at=now() WHERE id=$2 AND user_id=$3 AND revision=$4 RETURNING *", [JSON.stringify(model), old.id, req.user!.id, old.revision]);
    if (!rows.length) { res.status(409).json({ error: "Inputs changed while interpreting. Your newer edits were preserved. Run interpretation again." }); return; }
    res.json(await present(rows[0]));
  } catch (err) {
    req.log.warn({ errorType: err instanceof Error ? err.name : "Unknown" }, "Intake interpretation failed");
    res.status(422).json({ error: "We could not interpret these inputs. Check that you supplied readable content and try again. Your saved inputs are unchanged." });
  } finally { interpreting.delete(req.user!.id); }
});
router.post("/intake/records/:id/confirm", async (req, res) => {
  const parsed = revisionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A valid revision is required." }); return; }
  const old = await record(String(req.params.id), req.user!.id);
  if (!old) { res.status(404).json({ error: "Intake not found." }); return; }
  const model = intakeModelSchema.parse(old.model);
  const issues = confirmationIssues(model);
  if (issues.length) { res.status(400).json({ error: issues.join(" ") }); return; }
  const { rows } = await pool.query("UPDATE intake_records SET model=$1,status='confirmed',revision=revision+1,updated_at=now() WHERE id=$2 AND user_id=$3 AND revision=$4 RETURNING *", [JSON.stringify({ ...model, confirmed: true }), old.id, req.user!.id, parsed.data.revision]);
  if (!rows.length) { res.status(409).json({ error: "Intake changed. Reload before confirming." }); return; }
  res.json(await present(rows[0]));
});
router.delete("/intake/records/:id", async (req, res) => {
  const { rows: files } = await pool.query("SELECT object_path FROM intake_attachments WHERE record_id=$1 AND user_id=$2", [String(req.params.id), req.user!.id]);
  await Promise.all(files.map(f => privateObjectFile(f.object_path).delete({ ignoreNotFound: true })));
  const { rowCount } = await pool.query("DELETE FROM intake_records WHERE id=$1 AND user_id=$2", [String(req.params.id), req.user!.id]);
  if (!rowCount) { res.status(404).json({ error: "Intake not found." }); return; }
  res.status(204).end();
});
router.use((err: unknown, req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
  req.log.error({ errorType: err instanceof Error ? err.name : "Unknown" }, "Intake request failed");
  res.status(500).json({ error: "The intake could not be saved or loaded. Please try again." });
});
export default router;
