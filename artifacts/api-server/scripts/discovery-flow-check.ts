import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { briefsTable, db, pool } from "@workspace/db";
import { createDiscoveryComposition, materializeDiscoveryComposition, readComposition, previewRefinement, applyRefinement, undoComposition } from "../src/lib/compositions";
import { analyze } from "../src/lib/ai-analysis";
import type { CompositionPlan } from "../src/lib/composition-contract";

const user = `discovery-check-${randomUUID()}`;
const briefId = `discovery-check-${randomUUID()}`;
const empty = { value: "", confidence: 1 };
const requirements = [
  {id:"summary",text:"Summarize maintenance work orders for supervisor approval",source:"added"},
  {id:"groups",text:"Group recurring maintenance issues across sites",source:"added"},
  {id:"unmet",text:"Connect to the production maintenance dispatcher",source:"added"},
];
const base = "sol-workorder-insight", donor = "sol-site-pattern-finder";
const plan: CompositionPlan = {
  title:"Maintenance discovery check",goal:"Summarize and group maintenance issues",goalInferred:false,
  baseSolutionId:base,rationale:"Domain-specific work-order support",
  decisions:[base,donor].map(solutionId=>({solutionId,disposition:"included",reason:"Maintenance capability"})),
  flow:[{sourceSolutionId:base,capabilityId:"cap-summarize",reason:"Summarize"},{sourceSolutionId:donor,capabilityId:"cap-clustering",reason:"Group"}],
  overlapDecisions:[],dependencies:[],integrationGaps:[],clarifications:[],capabilityGaps:[],librarySuggestions:[],
};
let calls=0;
const analyzer:typeof analyze=(async(opts:any)=>{
  calls++;
  const value=opts.purpose==="discovery-composition"?{
    baseSolutionId:base,reason:"Work-order evidence, not generic approvals",sourceIds:[base,donor],
    relationships:[
      {requirementId:"summary",sourceSolutionId:base,capabilityId:"cap-summarize",coverage:"proposed",reason:"Summary"},
      {requirementId:"groups",sourceSolutionId:donor,capabilityId:"cap-clustering",coverage:"partial",reason:"Limited grouping"},
    ],
  }:plan;
  return {data:opts.schema.parse(value),provenance:{id:randomUUID(),model:"test-fixture",promptVersion:"test",inputFingerprint:"test",createdAt:new Date().toISOString(),cached:false}};
}) as typeof analyze;
try {
  await db.insert(briefsTable).values({
    id:briefId,rawText:"Maintenance approval and cross-site issue grouping",source:"ai",valueStatement:"Review maintenance",
    today:"Manual maintenance reviews",better:plan.goal,confirmed:true,requirements,
    fields:{user:{...empty,value:"Maintenance supervisors"},job:empty,currentProcess:empty,painPoint:empty,desiredOutcome:empty,
      constraints:{...empty,value:"No automatic production writes"},data:empty,requiredControls:{...empty,value:"Human approval"},successMeasures:empty},
  });
  const request={briefId,idempotencyKey:randomUUID()};
  await assert.rejects(createDiscoveryComposition(user,{briefId:"brief_intake_not-owned",idempotencyKey:randomUUID()},{analyzer}),/owned intake/i);
  const noBase:typeof analyze=(async(opts:any)=>({
    data:opts.schema.parse({baseSolutionId:null,sourceIds:[],relationships:[],reason:"No supported catalog fit"}),
    provenance:{id:randomUUID(),model:"test-fixture",promptVersion:"test",inputFingerprint:"test",createdAt:new Date().toISOString(),cached:false},
  })) as typeof analyze;
  await assert.rejects(createDiscoveryComposition(user,{...request,idempotencyKey:randomUUID()},{analyzer:noBase}),/No suitable/i);
  const review=await createDiscoveryComposition(user,request,{analyzer});
  assert.equal(review.discoveryState,"review");
  assert.equal(review.caseId,null,"Review must not create an experiment");
  const snapshot=JSON.stringify(review.discoverySnapshot);
  assert.equal(review.discoverySnapshot.requirements.length,3);
  const callsAfterCreation=calls;
  assert.equal((await createDiscoveryComposition(user,request,{analyzer})).id,review.id);
  assert.equal(calls,callsAfterCreation,"Retry and ordinary reads never rerun AI");
  await assert.rejects(readComposition("another-user",review.id),/not found/i);
  await assert.rejects(materializeDiscoveryComposition("another-user",review.id,{expectedRevision:1,idempotencyKey:randomUUID(),excludedCapabilities:[]}),/not found/i);
  await assert.rejects(materializeDiscoveryComposition(user,review.id,{expectedRevision:999,idempotencyKey:randomUUID(),excludedCapabilities:[]}),/changed/i);
  const materialize={expectedRevision:review.revision,idempotencyKey:randomUUID(),excludedCapabilities:[{sourceSolutionId:donor,capabilityId:"cap-clustering"}]};
  await pool.query("UPDATE compositions SET snapshot=jsonb_set(snapshot,'{sourceFingerprint}','\"changed-source\"') WHERE id=$1",[review.id]);
  await assert.rejects(materializeDiscoveryComposition(user,review.id,materialize),/evidence changed/i);
  await pool.query("UPDATE compositions SET snapshot=jsonb_set(snapshot,'{sourceFingerprint}',$2::jsonb) WHERE id=$1",[review.id,JSON.stringify(review.sourceFingerprint)]);
  const saved=await materializeDiscoveryComposition(user,review.id,materialize);
  assert.equal(saved.id,review.id);
  assert.equal(saved.discoveryState,"materialized");
  assert.ok(saved.caseId,"Supported maintenance base remains executable");
  assert.equal(saved.requirementCoverage.find((r:any)=>r.id==="groups").status,"user-excluded");
  assert.equal(saved.requirementCoverage.find((r:any)=>r.id==="unmet").status,"no-match");
  assert.equal((await materializeDiscoveryComposition(user,review.id,materialize)).caseId,saved.caseId);
  assert.equal(JSON.stringify((await readComposition(user,review.id)).discoverySnapshot),snapshot);
  await db.update(briefsTable).set({requirements:[{id:"replacement",text:"New intake wording",source:"added"}]}).where(eq(briefsTable.id,briefId));
  const reloaded=await readComposition(user,review.id);
  assert.equal(JSON.stringify(reloaded.discoverySnapshot),snapshot,"New source revision must never replace saved ledger");
  const refinementAnalyzer:typeof analyze=(async(opts:any)=>({
    data:opts.schema.parse({plan:{...reloaded.plan,goal:"Edited goal"},patch:{},reason:"Change only goal"}),
    provenance:{id:randomUUID(),model:"test-fixture",promptVersion:"test",inputFingerprint:"test",createdAt:new Date().toISOString(),cached:false},
  })) as typeof analyze;
  const preview=await previewRefinement(user,review.id,reloaded.revision,"Change goal",{analyzer:refinementAnalyzer});
  const edited=await applyRefinement(user,review.id,preview.id,reloaded.revision);
  assert.equal(JSON.stringify(edited.discoverySnapshot),snapshot);
  const undone=await undoComposition(user,review.id,edited.revision);
  assert.equal(JSON.stringify(undone.discoverySnapshot),snapshot);
  assert.equal(undone.requirementCoverage.length,3);
  assert.equal(calls,callsAfterCreation,"Materialization and edits do not rerun discovery");
  console.log("Discovery flow: ownership, revision safety, idempotency, exclusion, unmet requirements, source changes, edit/undo and reload passed.");
} finally {
  const rows=await pool.query("DELETE FROM compositions WHERE user_id=$1 RETURNING case_id",[user]);
  for(const row of rows.rows) if(row.case_id) await pool.query("DELETE FROM cases WHERE id=$1",[row.case_id]);
  await db.delete(briefsTable).where(eq(briefsTable.id,briefId));
  await pool.end();
}
