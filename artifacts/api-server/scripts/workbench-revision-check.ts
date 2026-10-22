import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { z } from "zod";
import { catalogSolutions } from "../src/data/catalog";
import { analyze } from "../src/lib/ai-analysis";
import { compositionInput, type CompositionPlan } from "../src/lib/composition-contract";
import { createComposition, previewRefinement, applyRefinement, undoComposition, editCompositionPlan, readComposition, sourceEvidence } from "../src/lib/compositions";
import { featureRedundancy, featureRedundancyInput, featureRedundancySchema } from "../src/lib/feature-redundancy";
import { registeredConsolidationSources } from "../src/lib/consolidation-recipes";

const user=`revision-test-${randomUUID()}`;
const cases:string[]=[];
const fixture=(data:unknown):typeof analyze=>(async(opts:any)=>({data:opts.schema.parse(data),provenance:{id:randomUUID(),model:"test-fixture",promptVersion:"test",inputFingerprint:"test",createdAt:new Date().toISOString(),cached:false}})) as typeof analyze;
const diagnosticAnalyzer:typeof analyze=async opts=>analyze({...opts,schema:z.preprocess(data=>{
  const result=opts.schema.safeParse(data);
  if(!result.success)console.log("Validation issues:",result.error.issues.map(i=>({path:i.path.join("."),code:i.code,message:i.message})));
  return data;
},opts.schema) as typeof opts.schema});
const sources=[{solutionId:"sol-workorder-insight",version:"3.2"},{solutionId:"sol-site-pattern-finder",version:"1.4"}];
const plan:CompositionPlan={
  title:"Revision test",goal:"Test supported grouping",goalInferred:false,baseSolutionId:sources[0].solutionId,rationale:"Test fixture.",
  decisions:sources.map(s=>({solutionId:s.solutionId,disposition:"included",reason:"Test fixture."})),
  flow:[{sourceSolutionId:sources[0].solutionId,capabilityId:"cap-summarize",reason:"Base."},{sourceSolutionId:sources[1].solutionId,capabilityId:"cap-clustering",reason:"Group."},{sourceSolutionId:sources[1].solutionId,capabilityId:"cap-similarity",reason:"Dependent similarity."}],
  overlapDecisions:[],dependencies:[],integrationGaps:[],clarifications:[],
  capabilityGaps:[],librarySuggestions:[],
};
const input=(s=sources)=>compositionInput.parse({idempotencyKey:randomUUID(),sources:s});
const remember=(c:any)=>{if(c.caseId)cases.push(c.caseId);return c;};
try {
  const c=remember(await createComposition(user,input(),{analyzer:fixture(plan)}));
  assert.equal(c.caseKind,"case");
  await pool.query("UPDATE cases SET status='tested',experiment_id='test-only-measured-marker',updated_at=clock_timestamp() WHERE id=$1",[c.caseId]);
  const before=(await pool.query("SELECT * FROM cases WHERE id=$1",[c.caseId])).rows[0];
  const p=await previewRefinement(user,c.id,1,"Reword goal",{analyzer:fixture({plan:{...plan,goal:"Reworded test goal"},patch:{},reason:"Only wording."})});
  assert.ok(p.changes.every(x=>x.path.startsWith("plan.")));
  await applyRefinement(user,c.id,p.id,1);
  assert.deepEqual((await pool.query("SELECT * FROM cases WHERE id=$1",[c.caseId])).rows[0],before,"Plan-only apply must preserve whole tested case including timestamp and experiment.");
  await undoComposition(user,c.id,2);
  assert.deepEqual((await pool.query("SELECT * FROM cases WHERE id=$1",[c.caseId])).rows[0],before,"Plan-only Undo must preserve test evidence.");
  const reduced={...plan,decisions:[plan.decisions[0],{...plan.decisions[1],disposition:"unnecessary" as const}],flow:[plan.flow[0]]};
  const cascade=await previewRefinement(user,c.id,3,"Remove grouping",{analyzer:fixture({plan:reduced,patch:{moduleStates:{"cap-clustering":false}},reason:"Remove grouping and dependents."})});
  assert.ok(cascade.changes.some(x=>x.path==="moduleStates.cap-clustering"&&x.after===false));
  assert.ok(cascade.changes.some(x=>x.path==="moduleStates.cap-similarity"&&x.after===false),"Preview must expose implicit dependency cascade.");
  await pool.query("UPDATE composition_refinements SET snapshot=$1 WHERE id=$2",[{...cascade,changes:cascade.changes.filter(x=>x.path!=="moduleStates.cap-similarity")},cascade.id]);
  await assert.rejects(applyRefinement(user,c.id,cascade.id,3),/differ from the preview/,"Old/incomplete previews cannot apply hidden cascades.");
  await pool.query("UPDATE composition_refinements SET snapshot=$1 WHERE id=$2",[cascade,cascade.id]);
  await applyRefinement(user,c.id,cascade.id,3);
  const disabled=(await pool.query("SELECT * FROM cases WHERE id=$1",[c.caseId])).rows[0];
  assert.equal(disabled.module_states["cap-clustering"],false);
  assert.equal(disabled.module_states["cap-similarity"],false);
  assert.equal(disabled.status,"draft");assert.equal(disabled.experiment_id,null);
  await pool.query(`UPDATE cases SET config_values=jsonb_set(config_values,'{cap-notify}','"Weekly summary"'),updated_at=clock_timestamp() WHERE id=$1`,[c.caseId]);
  await undoComposition(user,c.id,4);
  const restored=(await pool.query("SELECT * FROM cases WHERE id=$1",[c.caseId])).rows[0];
  assert.equal(restored.module_states["cap-clustering"],true);
  assert.equal(restored.module_states["cap-similarity"],true,"Undo restores implicitly disabled dependent.");
  assert.equal(restored.config_values["cap-notify"],"Weekly summary");
  const withGaps=remember(await createComposition(user,input(),{analyzer:fixture({...plan,integrationGaps:["External production integration remains unimplemented."]})}));
  assert.equal(withGaps.caseKind,"case");assert.ok(withGaps.limitations.some((s:string)=>s.includes("NOT executed")));
  const partlyUnsupported=remember(await createComposition(user,input(),{analyzer:fixture({...plan,flow:[...plan.flow,{sourceSolutionId:sources[1].solutionId,capabilityId:"cap-csv-ingest",reason:"Proposed separate import; incompatible with governed ingestion."}],integrationGaps:["CSV import requires a separate adapter; it must not replace governed ingestion."]})}));
  assert.equal(partlyUnsupported.caseKind,"case");
  assert.ok(partlyUnsupported.supportedExecution.capabilityIds.includes("cap-clustering"));
  assert.ok(partlyUnsupported.supportedExecution.omittedCapabilities.some((c:any)=>c.capabilityId==="cap-csv-ingest"));
  assert.ok(!partlyUnsupported.supportedExecution.capabilityIds.includes("cap-csv-ingest"));
  const previews=catalogSolutions.filter(s=>s.execution==="preview").slice(0,2);
  const proposalSources=previews.map(s=>({solutionId:s.id,version:s.currentVersion}));
  const proposalPlan={...plan,baseSolutionId:previews[0].id,decisions:previews.map(s=>({solutionId:s.id,disposition:"included",reason:"Proposal fixture."})),flow:previews.map(s=>({sourceSolutionId:s.id,capabilityId:s.capabilityIds[0],reason:"Proposal fixture."}))};
  const proposal=remember(await createComposition(user,input(proposalSources),{analyzer:fixture(proposalPlan)}));
  const reordered={...proposalPlan,flow:[...proposalPlan.flow].reverse()};
  const edited=await editCompositionPlan(user,proposal.id,1,reordered);
  assert.equal(edited.revision,2);assert.equal(edited.canUndo,true);assert.equal(edited.caseId,null);
  await assert.rejects(editCompositionPlan(user,proposal.id,1,proposalPlan),/changed/);
  await assert.rejects(editCompositionPlan("other",proposal.id,2,proposalPlan),/not found/);
  await assert.rejects(editCompositionPlan(user,proposal.id,2,{...reordered,flow:[{...reordered.flow[0],capabilityId:"invented"}]}),/outside/);
  await undoComposition(user,proposal.id,2);
  assert.deepEqual((await readComposition(user,proposal.id)).plan,proposalPlan);
  const added={...proposalPlan,flow:[...proposalPlan.flow,{sourceSolutionId:previews[0].id,capabilityId:previews[0].capabilityIds[1],reason:"Manual add from selected source."}]};
  await editCompositionPlan(user,proposal.id,3,added);
  await editCompositionPlan(user,proposal.id,4,proposalPlan);
  await undoComposition(user,proposal.id,5);
  assert.deepEqual((await readComposition(user,proposal.id)).plan,added,"Manual remove Undo restores added source capability.");
  const withoutSecond={...added,flow:added.flow.filter(s=>s.sourceSolutionId!==previews[1].id),decisions:added.decisions.map(d=>d.solutionId===previews[1].id?{...d,disposition:"unnecessary" as const,reason:"Manual exclusion."}:d)};
  await editCompositionPlan(user,proposal.id,6,withoutSecond);
  await undoComposition(user,proposal.id,7);
  const savedProposal=(await pool.query("SELECT snapshot FROM compositions WHERE id=$1",[proposal.id])).rows[0].snapshot;
  await pool.query("UPDATE compositions SET snapshot=jsonb_set(snapshot,'{sourceFingerprint}','\"stale\"') WHERE id=$1",[proposal.id]);
  await assert.rejects(editCompositionPlan(user,proposal.id,8,proposalPlan),/Source evidence changed/);
  await pool.query("UPDATE compositions SET snapshot=$1 WHERE id=$2",[savedProposal,proposal.id]);
  const evidence=await sourceEvidence(sources);
  const fixtureAnalysis={summary:"Fixture catalog analysis only.",groups:[{id:"fixture",title:"Fixture group",classification:"unknown",coverage:evidence.map(s=>({sourceId:s.solutionId,capabilityIds:s.capabilities.map(c=>c.id),coverage:"unknown",evidenceIds:[`catalog:${s.solutionId}`],reason:"Fixture unknown implementation."})),recommendation:"keep separate",reasoning:"Fixture only.",gaps:["Catalog not code verification."]}],limitations:["Test fixture, no equivalence claim."]};
  const result=await featureRedundancy(user,featureRedundancyInput.parse({compositionId:c.id}),{analyzer:fixture(fixtureAnalysis)});
  assert.ok(result.evidence.every(e=>e.kind==="catalog"));
  assert.equal(result.analysis.groups.length,1);
  const schema=featureRedundancySchema(evidence,result.evidence);
  const invalid=structuredClone(fixtureAnalysis);invalid.groups[0].coverage[0].capabilityIds=["invented"];
  assert.equal(schema.safeParse(invalid).success,false);
  const twelveSources=catalogSolutions.slice(0,12).map(s=>({solutionId:s.id,version:s.currentVersion}));
  assert.equal(twelveSources.length,12);
  assert.equal(compositionInput.safeParse({idempotencyKey:randomUUID(),sources:twelveSources}).success,false,"Composition creation remains limited to compare selection.");
  const twelveEvidence=await sourceEvidence(twelveSources);
  const twelveFixture={...fixtureAnalysis,groups:[{...fixtureAnalysis.groups[0],coverage:twelveEvidence.map(s=>({sourceId:s.solutionId,capabilityIds:s.capabilities.map(c=>c.id),coverage:"unknown",evidenceIds:[`catalog:${s.solutionId}`],reason:"All-donor fixture."}))}]};
  const twelve=await featureRedundancy(user,featureRedundancyInput.parse({sources:twelveSources}),{analyzer:fixture(twelveFixture)});
  assert.equal(twelve.analysis.groups[0].coverage.length,12,"Redundancy never truncates donors.");
  assert.equal(featureRedundancyInput.safeParse({sources:[...twelveSources,{solutionId:"over-limit",version:"1"}]}).success,false);
  await assert.rejects(featureRedundancy("other",featureRedundancyInput.parse({caseId:c.caseId}),{analyzer:fixture(fixtureAnalysis)}),/not found/);
  await assert.rejects(featureRedundancy(user,featureRedundancyInput.parse({sources}),{analyzer:(async()=>{throw new Error("test provider failure");}) as typeof analyze}),/provider failure/);
  const invoice=(await registeredConsolidationSources()).filter(s=>["invoice-finder","approval-desk"].includes(s.id));
  const invoiceSources=invoice.map(s=>({solutionId:s.id,version:s.version}));
  const invoiceEvidence=await sourceEvidence(invoiceSources);
  const invoiceFixture={...fixtureAnalysis,groups:[{...fixtureAnalysis.groups[0],coverage:invoiceEvidence.map(s=>({sourceId:s.solutionId,capabilityIds:s.capabilities.map(c=>c.id),coverage:"unknown",evidenceIds:[`catalog:${s.solutionId}`,"invoice-review"],reason:"Fixture cites original review."}))}]};
  const reviewed=await featureRedundancy(user,featureRedundancyInput.parse({sources:invoiceSources}),{analyzer:fixture(invoiceFixture)});
  assert.ok(reviewed.evidence.some(e=>e.kind==="source-review"));
  assert.equal(reviewed.evidence.filter(e=>e.kind==="manifest").length,2);
  const combinedPlan={...plan,baseSolutionId:"invoice-finder",decisions:invoiceSources.map(s=>({solutionId:s.solutionId,disposition:"included",reason:"Fixture."})),flow:[{sourceSolutionId:"invoice-finder",capabilityId:"fuzzy-search",reason:"Search."},{sourceSolutionId:"approval-desk",capabilityId:"bulk-decisions",reason:"Review."}]};
  const combined=remember(await createComposition(user,input(invoiceSources),{analyzer:fixture(combinedPlan)}));
  const combinedBefore=(await pool.query("SELECT * FROM consolidation_cases WHERE id=$1",[combined.caseId])).rows[0];
  const combinedPreview=await previewRefinement(user,combined.id,1,"Change wording only",{analyzer:fixture({plan:{...combinedPlan,goal:"Changed wording."},patch:{},reason:"Wording only."})});
  await applyRefinement(user,combined.id,combinedPreview.id,1);
  await undoComposition(user,combined.id,2);
  assert.deepEqual((await pool.query("SELECT * FROM consolidation_cases WHERE id=$1",[combined.caseId])).rows[0],combinedBefore);
  console.log("PASS tested-state no-op apply/Undo (ordinary + combined), full cascade preview/Undo, unrelated manual settings, supported execution with gaps, revision-safe proposal edits, redundancy grounding/ownership/failure/invoice evidence.");
  if(process.argv.includes("--live")){
    const live=await featureRedundancy(user,featureRedundancyInput.parse({sources}),{analyzer:diagnosticAnalyzer});
    const cached=await featureRedundancy(user,featureRedundancyInput.parse({sources}));
    assert.equal(live.provenance.id,cached.provenance.id);assert.equal(cached.provenance.cached,true);
    console.log("PASS live catalog redundancy and persisted cache:",live.provenance.model,live.analysis.groups.length);
    const liveInvoice=await featureRedundancy(user,featureRedundancyInput.parse({caseId:combined.caseId}),{analyzer:diagnosticAnalyzer});
    assert.ok(liveInvoice.evidence.some(e=>e.kind==="source-review"));
    console.log("PASS live invoice-source redundancy:",liveInvoice.provenance.model,liveInvoice.analysis.groups.length);
  }
}finally{
  await pool.query("DELETE FROM composition_refinements WHERE composition_id IN(SELECT id FROM compositions WHERE user_id=$1)",[user]);
  await pool.query("DELETE FROM compositions WHERE user_id=$1",[user]);
  await pool.query("DELETE FROM cases WHERE id=ANY($1::text[])",[cases]);
  await pool.query("DELETE FROM consolidation_cases WHERE id=ANY($1::text[])",[cases]);
  await pool.end();
}
