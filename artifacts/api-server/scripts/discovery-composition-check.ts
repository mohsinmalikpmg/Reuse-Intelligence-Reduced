import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { analyze } from "../src/lib/ai-analysis";
import { createDiscoveryComposition, materializeDiscoveryComposition, readComposition, editCompositionPlan, undoComposition } from "../src/lib/compositions";

const user=`discovery-test-${randomUUID()}`,briefId=`brief_${randomUUID()}`;
const base="sol-workorder-insight",donor="sol-site-pattern-finder";
let calls=0;
const analyzer=(async(options:any)=>{
  calls++;
  assert.equal(options.private,true,"Private source interpretation outputs must never enter shared AI cache.");
  const data=options.purpose==="discovery-composition"?{
    baseSolutionId:base,reason:"Maintenance work orders, not invoice approval.",sourceIds:[base,donor],
    relationships:[{requirementId:"review",sourceSolutionId:base,capabilityId:"cap-summarize",coverage:"partial",reason:"Summaries support human review, not dispatch"},
      {requirementId:"patterns",sourceSolutionId:donor,capabilityId:"cap-clustering",coverage:"partial",reason:"Demo grouping only"}],
  }:{
    title:"Maintenance approval review",goal:"Review maintenance work and recurring issues",goalInferred:false,baseSolutionId:base,rationale:"Maintenance evidence",
    decisions:[base,donor].map(solutionId=>({solutionId,disposition:"included",reason:"Documented contribution"})),
    flow:[{sourceSolutionId:base,capabilityId:"cap-summarize",reason:"Review summaries"},{sourceSolutionId:donor,capabilityId:"cap-clustering",reason:"Recurring patterns"}],
    overlapDecisions:[],dependencies:[],integrationGaps:["No production dispatch integration"],clarifications:[],capabilityGaps:[],librarySuggestions:[],
  };
  return {data:options.schema.parse(data),provenance:{id:randomUUID(),model:"test-fixture",promptVersion:"test",inputFingerprint:"test",createdAt:new Date().toISOString(),cached:false}};
}) as typeof analyze;
try {
  const fields=Object.fromEntries(["user","job","currentProcess","painPoint","desiredOutcome","constraints","data","requiredControls","successMeasures"].map(key=>[key,{value:key==="user"?"Maintenance supervisors":key==="constraints"?"Human approval only":"Maintenance work orders",confidence:1}]));
  await pool.query("INSERT INTO briefs(id,raw_text,fields,source,value_statement,today,better,requirements,confirmed) VALUES($1,$2,$3,'test','test','manual review','Review maintenance', $4,true)",
    [briefId,"Maintenance approval fixture",fields,JSON.stringify([{id:"review",text:"Approve maintenance work orders",source:"added"},{id:"patterns",text:"Find recurring faults",source:"added"},{id:"dispatch",text:"Integrate production dispatch",source:"added"}])]);
  const input={briefId,idempotencyKey:randomUUID()};
  const draft=await createDiscoveryComposition(user,input,{analyzer});
  assert.equal(draft.discoveryState,"review");assert.equal(draft.caseId,null);assert.equal(calls,2);
  assert.equal(draft.discoverySnapshot.startingPoint.solutionId,base);
  assert.equal(draft.requirementCoverage.length,3);assert.equal(draft.requirementCoverage[2].status,"no-match");
  assert.equal((await createDiscoveryComposition(user,input,{analyzer})).id,draft.id);assert.equal(calls,2);
  assert.deepEqual((await readComposition(user,draft.id)).discoverySnapshot,draft.discoverySnapshot);
  await assert.rejects(readComposition("other",draft.id),/not found/);
  const edited=await editCompositionPlan(user,draft.id,draft.revision,{...draft.plan,flow:draft.plan.flow.slice(0,1),decisions:draft.plan.decisions.map((d:any)=>d.solutionId===donor?{...d,disposition:"unnecessary"}:d)});
  assert.equal(edited.requirementCoverage[1].status,"user-excluded");
  const restored=await undoComposition(user,draft.id,edited.revision);
  assert.deepEqual(restored.discoverySnapshot,draft.discoverySnapshot);
  assert.equal(restored.requirementCoverage[1].status,"partial");
  await assert.rejects(materializeDiscoveryComposition(user,draft.id,{expectedRevision:1,idempotencyKey:randomUUID(),excludedCapabilities:[]}),/changed/);
  const selection={expectedRevision:restored.revision,idempotencyKey:randomUUID(),excludedCapabilities:[{sourceSolutionId:donor,capabilityId:"cap-clustering"}]};
  const built=await materializeDiscoveryComposition(user,draft.id,selection);
  assert.equal(built.id,draft.id);assert.equal(built.discoveryState,"materialized");
  assert.equal(built.requirementCoverage[1].status,"user-excluded");
  assert.deepEqual(built.discoverySnapshot,draft.discoverySnapshot);
  const retry=await materializeDiscoveryComposition(user,draft.id,selection);
  assert.equal(retry.caseId,built.caseId);assert.equal(retry.revision,built.revision);assert.equal(calls,2);
  await assert.rejects(materializeDiscoveryComposition(user,draft.id,{...selection,excludedCapabilities:[]}),/different selections/);
  console.log("Discovery creation, authorization, bulk selection, idempotency, immutable ledger, edit, undo and reload checks passed.");
} finally {
  const linked=await pool.query("SELECT case_id FROM compositions WHERE user_id=$1",[user]);
  await pool.query("DELETE FROM compositions WHERE user_id=$1",[user]);
  for(const row of linked.rows)if(row.case_id)await pool.query("DELETE FROM cases WHERE id=$1",[row.case_id]);
  await pool.query("DELETE FROM consolidation_cases WHERE user_id=$1",[user]);
  await pool.query("DELETE FROM briefs WHERE id=$1",[briefId]);
  await pool.end();
}
