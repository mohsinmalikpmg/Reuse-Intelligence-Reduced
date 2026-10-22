import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { getSolution, catalogSolutions } from "../src/data/catalog";
import { analyze, AnalysisError, analysisFingerprint } from "../src/lib/ai-analysis";
import { compositionInput, type CompositionPlan } from "../src/lib/composition-contract";
import { createComposition, acceptCompositionSuggestion, undoComposition, readComposition } from "../src/lib/compositions";
import { registeredConsolidationSources, ownedConsolidationCase } from "../src/lib/consolidation-recipes";

const user=`gaps-test-${randomUUID()}`,caseIds:string[]=[];
const fixture=(data:unknown):typeof analyze=>(async(opts:any)=>({data:opts.schema.parse(data),provenance:{id:randomUUID(),model:"test-fixture",promptVersion:"test",inputFingerprint:"test",createdAt:new Date().toISOString(),cached:false}})) as typeof analyze;
const selected=[{solutionId:"sol-workorder-insight",version:"3.2"},{solutionId:"sol-site-pattern-finder",version:"1.4"}];
const request=(sources=selected)=>compositionInput.parse({idempotencyKey:randomUUID(),sources,desiredOutcome:"Recurring issues and follow-up actions."});
const base:CompositionPlan={title:"Grounding fixture",goal:"Find recurring issues and follow-up actions",goalInferred:false,baseSolutionId:selected[0].solutionId,rationale:"Selected sources first.",
  decisions:selected.map(s=>({solutionId:s.solutionId,disposition:"included",reason:"Selected contribution."})),
  flow:[{sourceSolutionId:selected[0].solutionId,capabilityId:"cap-summarize",reason:"Summarize."},{sourceSolutionId:selected[1].solutionId,capabilityId:"cap-clustering",reason:"Group."}],
  overlapDecisions:[],dependencies:[],integrationGaps:[],clarifications:[],capabilityGaps:[{id:"actions",need:"Track follow-up actions",reason:"Selected products do not include this capability."}],
  librarySuggestions:[{id:"action-donor",sourceSolutionId:"sol-action-tracker",version:getSolution("sol-action-tracker")!.currentVersion,capabilityIds:["cap-action-tracking"],gapIds:["actions"],reason:"Library action tracking may address follow-up."}]};
const remember=(c:any)=>{if(c.caseId)caseIds.push(c.caseId);return c;};
try{
  let calls=0;
  const repair:typeof analyze=(async(opts:any)=>{
    calls++;
    const invalid={...base,flow:[...base.flow,{sourceSolutionId:selected[1].solutionId,capabilityId:"invented-automation",reason:"Automatic creation of jobs."}]};
    const repaired={...base,capabilityGaps:[...base.capabilityGaps!,{id:"unsupported-step-3",need:"Automatic creation of jobs",reason:"No supplied capability implements this; an adapter is missing."}],integrationGaps:["Automatic job creation is unsupported."]};
    if(calls===2)assert.ok(opts.input.requiredGapIds.includes("unsupported-step-3"));
    return fixture(calls===1?invalid:repaired)(opts);
  }) as typeof analyze;
  const repaired=remember(await createComposition(user,request(),{analyzer:repair}));
  assert.equal(calls,2);assert.ok(repaired.plan.capabilityGaps.some((g:any)=>g.id==="unsupported-step-3"));
  assert.ok(!repaired.plan.flow.some((f:any)=>f.capabilityId==="invented-automation"));
  assert.equal(repaired.sources.length,2,"Suggested donors are never silently selected.");
  let boundedCalls=0;
  const failRequest=request();
  await assert.rejects(createComposition(user,failRequest,{analyzer:(async(opts:any)=>{boundedCalls++;return fixture({...base,flow:[{sourceSolutionId:"invented",capabilityId:"invented",reason:"Invalid."}]})(opts);}) as typeof analyze}),/bounded repair/);
  assert.equal(boundedCalls,3);
  assert.equal((await pool.query("SELECT id FROM compositions WHERE user_id=$1 AND idempotency_key=$2",[user,failRequest.idempotencyKey])).rows.length,0);
  const c=remember(await createComposition(user,request(),{analyzer:fixture(base)}));
  assert.equal(c.plan.librarySuggestions[0].compatibility,"supported");
  const originalSources=analysisFingerprint(c.sourceEvidence),baseline=analysisFingerprint(c.baseline);
  await pool.query(`UPDATE cases SET config_values=jsonb_set(config_values,'{cap-notify}','"Weekly summary"'),title=title||' manual',updated_at=clock_timestamp() WHERE id=$1`,[c.caseId]);
  const key=randomUUID();
  const accepted=await acceptCompositionSuggestion(user,c.id,"action-donor",1,key);
  assert.equal(accepted.id,c.id);assert.equal(accepted.caseId,c.caseId);assert.equal(accepted.sources.length,3);
  assert.equal(accepted.acceptedSuggestions[0].executable,true);assert.equal(analysisFingerprint(accepted.baseline),baseline);
  assert.deepEqual(accepted.acceptedSuggestions[0].capabilityIds,["cap-action-tracking"]);
  assert.deepEqual(accepted.acceptedSuggestions[0].gapIds,["actions"]);
  assert.equal(accepted.acceptedSuggestions[0].suggestionReason,base.librarySuggestions![0].reason);
  const reloaded=await readComposition(user,c.id);
  assert.deepEqual(reloaded.acceptedSuggestions,accepted.acceptedSuggestions);
  assert.deepEqual(reloaded.plan.capabilityGaps,base.capabilityGaps,"Acceptance does not pretend a need is resolved.");
  assert.equal((await pool.query("SELECT module_states FROM cases WHERE id=$1",[c.caseId])).rows[0].module_states["cap-action-tracking"],true);
  assert.equal((await acceptCompositionSuggestion(user,c.id,"action-donor",1,key)).revision,2);
  await assert.rejects(acceptCompositionSuggestion(user,c.id,"different",1,key),/different inputs/);
  await assert.rejects(acceptCompositionSuggestion("other",c.id,"action-donor",2,randomUUID()),/not found/);
  const undone=await undoComposition(user,c.id,2);
  assert.equal(undone.sources.length,2);assert.equal(analysisFingerprint(undone.sourceEvidence),originalSources);
  assert.deepEqual(undone.acceptedSuggestions,[]);
  const undoReloaded=await readComposition(user,c.id);
  assert.deepEqual(undoReloaded.acceptedSuggestions,[]);
  assert.deepEqual(undoReloaded.plan.capabilityGaps,base.capabilityGaps);
  assert.deepEqual(undoReloaded.plan.librarySuggestions[0].gapIds,["actions"]);
  assert.deepEqual(undoReloaded.plan.librarySuggestions[0].capabilityIds,["cap-action-tracking"]);
  const restored=(await pool.query("SELECT * FROM cases WHERE id=$1",[c.caseId])).rows[0];
  assert.equal(restored.module_states["cap-action-tracking"],false);assert.equal(restored.config_values["cap-notify"],"Weekly summary");assert.match(restored.title,/manual/);
  assert.equal((await acceptCompositionSuggestion(user,c.id,"action-donor",1,key)).sources.length,2,"Old-key retry after Undo must not silently reapply.");
  await assert.rejects(acceptCompositionSuggestion(user,c.id,"action-donor",1,randomUUID()),/changed/);
  const action=getSolution("sol-action-tracker")!,oldVersion=action.currentVersion;
  try {action.currentVersion="test-only-drift";await assert.rejects(acceptCompositionSuggestion(user,c.id,"action-donor",3,randomUUID()),/version changed/);}
  finally{action.currentVersion=oldVersion;}
  const acceptedAgain=await acceptCompositionSuggestion(user,c.id,"action-donor",3,randomUUID());
  await pool.query(`UPDATE cases SET module_states=jsonb_set(module_states,'{cap-action-tracking}','false'),updated_at=clock_timestamp() WHERE id=$1`,[c.caseId]);
  const manuallyDisabled=await readComposition(user,c.id);
  assert.deepEqual(manuallyDisabled.acceptedSuggestions[0].gapIds,["actions"]);
  assert.deepEqual(manuallyDisabled.acceptedSuggestions[0].capabilityIds,["cap-action-tracking"]);
  assert.ok(!manuallyDisabled.supportedExecution.capabilityIds.includes("cap-action-tracking"),"Current settings, not historical acceptance, determine active coverage.");
  await assert.rejects(undoComposition(user,c.id,acceptedAgain.revision),/conflict/);
  const previews=catalogSolutions.filter(s=>s.execution==="preview").slice(0,2);
  const multiPlan={...base,librarySuggestions:[...base.librarySuggestions!,{id:"additional-preview",sourceSolutionId:previews[0].id,version:previews[0].currentVersion,capabilityIds:[previews[0].capabilityIds[0]],gapIds:["actions"],reason:"A separate proposed catalog contribution."}]};
  const multi=remember(await createComposition(user,request(),{analyzer:fixture(multiPlan)}));
  await acceptCompositionSuggestion(user,multi.id,"action-donor",1,randomUUID());
  const engineBefore=(await pool.query("SELECT * FROM cases WHERE id=$1",[multi.caseId])).rows[0];
  const fourth=await acceptCompositionSuggestion(user,multi.id,"additional-preview",2,randomUUID());
  assert.equal(fourth.sources.length,4);assert.equal(fourth.caseId,multi.caseId);assert.equal(fourth.acceptedSuggestions.at(-1).executable,false);
  assert.deepEqual((await pool.query("SELECT * FROM cases WHERE id=$1",[multi.caseId])).rows[0],engineBefore,"Unsupported fourth donor must not mutate the real engine.");
  await undoComposition(user,multi.id,3);
  assert.equal((await readComposition(user,multi.id)).sources.length,3);
  const previewSources=previews.map(s=>({solutionId:s.id,version:s.currentVersion}));
  const proposalPlan={...base,baseSolutionId:previews[0].id,decisions:previewSources.map(s=>({solutionId:s.solutionId,disposition:"included",reason:"Proposed only."})),flow:previews.map(s=>({sourceSolutionId:s.id,capabilityId:s.capabilityIds[0],reason:"Catalog-only contribution."})),
    librarySuggestions:[{id:"summary-donor",sourceSolutionId:"sol-workorder-insight",version:"3.2",capabilityIds:["cap-summarize"],gapIds:["actions"],reason:"Proposed additional summary source; integration not proven."}]};
  const proposal=remember(await createComposition(user,request(previewSources),{analyzer:fixture(proposalPlan)}));
  const proposed=await acceptCompositionSuggestion(user,proposal.id,"summary-donor",1,randomUUID());
  assert.equal(proposed.caseId,null);assert.equal(proposed.executable,false);assert.equal(proposed.acceptedSuggestions[0].executable,false);
  assert.ok(proposed.plan.integrationGaps.some((s:string)=>s.includes("not executed")));
  await undoComposition(user,proposal.id,2);assert.equal((await readComposition(user,proposal.id)).sources.length,2);
  const registry=await registeredConsolidationSources();
  const invoice=registry.filter(s=>["invoice-finder","approval-desk"].includes(s.id));
  const spend=registry.find(s=>s.id==="spend-tracker")!;
  const invoiceSources=invoice.map(s=>({solutionId:s.solutionId,version:s.version}));
  const invoicePlan={...base,baseSolutionId:"invoice-finder",decisions:invoiceSources.map(s=>({solutionId:s.solutionId,disposition:"included",reason:"Reviewed source."})),
    flow:[{sourceSolutionId:"invoice-finder",capabilityId:"fuzzy-search",reason:"Search."},{sourceSolutionId:"approval-desk",capabilityId:"bulk-decisions",reason:"Review."}],
    librarySuggestions:[{id:"spend-donor",sourceSolutionId:spend.solutionId,version:spend.version,capabilityIds:["spend-tracing"],gapIds:["actions"],reason:"Add supported spend tracing."}]};
  const combined=remember(await createComposition(user,request(invoiceSources),{analyzer:fixture(invoicePlan)}));
  await acceptCompositionSuggestion(user,combined.id,"spend-donor",1,randomUUID());
  assert.equal((await ownedConsolidationCase(user,combined.caseId)).selectedSources.length,3);
  await undoComposition(user,combined.id,2);
  const cc=await ownedConsolidationCase(user,combined.caseId);
  assert.equal(cc.selectedSources.length,2);assert.ok(!cc.capabilityIds.includes("spend-tracing"));
  console.log("PASS bounded active repair/unknown gaps, strict Library references, explicit same-case donor accept/retry/conflict/Undo, manual preservation, version drift, non-runnable proposals and combined source/wiring Undo.");
  if(process.argv.includes("--live")){
    const screenshotSources=[{solutionId:"sol-site-pattern-finder",version:"1.4"},{solutionId:"sol-action-tracker",version:"0.9"}];
    const live=remember(await createComposition(user,{...request(screenshotSources),desiredOutcome:"Help project managers identify recurring actions that indicate opportunities for automation or process improvement.",targetGroup:"Project managers"}));
    assert.equal(live.sources.length,2);
    assert.ok(live.plan.flow.every((f:any)=>screenshotSources.some(s=>s.solutionId===f.sourceSolutionId)));
    assert.ok(live.plan.capabilityGaps.length||live.plan.integrationGaps.length,"Unknown automation must remain a visible gap.");
    console.log("PASS live screenshot pair:",{model:live.provenance.model,caseKind:live.caseKind,gaps:live.plan.capabilityGaps.length,suggestions:live.plan.librarySuggestions.length});
  }
}finally{
  await pool.query("DELETE FROM composition_refinements WHERE composition_id IN(SELECT id FROM compositions WHERE user_id=$1)",[user]);
  await pool.query("DELETE FROM compositions WHERE user_id=$1",[user]);
  await pool.query("DELETE FROM cases WHERE id=ANY($1::text[])",[caseIds]);
  await pool.query("DELETE FROM consolidation_cases WHERE id=ANY($1::text[])",[caseIds]);
  await pool.end();
}
