import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { z } from "zod";
import { analyze } from "../src/lib/ai-analysis";
import { previewRefinement, applyRefinement, undoComposition, cancelRefinement, readComposition } from "../src/lib/compositions";

const id = process.argv[2];
if (!id?.startsWith("cmp_")) throw new Error("Provide a composition ID.");
const instruction = "Keep the existing steps and change the goal wording to prioritize cross-site recurring issues for supervisors.";
try {
  const { rows } = await pool.query("SELECT user_id,revision FROM compositions WHERE id=$1",[id]);
  assert.equal(rows.length,1,"Existing composition required.");
  const owner = rows[0].user_id;
  const original = await readComposition(owner,id);
  console.log("Existing composition:", {caseKind:original.caseKind,revision:original.revision,flowSteps:original.plan.flow.length});
  const analyzer: typeof analyze = async opts => analyze({...opts,force:true,schema:z.preprocess(data=>{
    const parsed = opts.schema.safeParse(data);
    if (!parsed.success) console.log("Provider validation issues (paths/codes only):", parsed.error.issues.map(i=>({path:i.path.join("."),code:i.code})));
    return data;
  },opts.schema) as typeof opts.schema});
  const preview = await previewRefinement(owner,id,rows[0].revision,instruction,{analyzer});
  console.log("Live preview:", {model:preview.provenance.model,changePaths:preview.changes.map(c=>c.path)});
  assert.ok(preview.changes.some(c=>c.path==="plan.goal"),"Goal change must appear in preview.");
  if (process.argv.includes("--apply")) {
    const applied = await applyRefinement(owner,id,preview.id,original.revision);
    assert.equal(applied.plan.goal,preview.plan.goal);
    const undone = await undoComposition(owner,id,applied.revision);
    assert.deepEqual(undone.plan,original.plan);
    console.log("PASS live proposal preview/apply/Undo; original plan restored. Current revision:",undone.revision);
  } else {
    await cancelRefinement(owner,id,preview.id);
    console.log("PASS live proposal preview/cancel; plan unchanged.");
  }
} finally { await pool.end(); }
