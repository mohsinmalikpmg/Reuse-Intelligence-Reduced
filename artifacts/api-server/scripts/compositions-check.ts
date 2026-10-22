import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { catalogSolutions } from "../src/data/catalog";
import { analyze, AnalysisError, analysisConfigured } from "../src/lib/ai-analysis";
import { compositionInput, validatePlan, reverseChanges, changesBetween, type CompositionPlan } from "../src/lib/composition-contract";
import { createComposition, readComposition, listCompositions, previewRefinement, applyRefinement, cancelRefinement, undoComposition, sourceEvidence } from "../src/lib/compositions";
import { getCase, listCaseRows, updateCaseRow } from "../src/lib/store";
import { registeredConsolidationSources, ownedConsolidationCase } from "../src/lib/consolidation-recipes";
import { caseAccessScope } from "../src/lib/case-access";

const user = `composition-test-${randomUUID()}`;
const ids: string[] = [], cases: string[] = [];
const input = compositionInput.parse({ idempotencyKey: randomUUID(), sources: [
  { solutionId: "sol-workorder-insight", version: "3.2" }, { solutionId: "sol-site-pattern-finder", version: "1.4" },
], desiredOutcome: "Find recurring equipment issues across sites with supervisor approval." });
const plan: CompositionPlan = {
  title: "Cross-site review", goal: input.desiredOutcome, goalInferred: false, baseSolutionId: input.sources[0].solutionId,
  rationale: "Keep the governed base; add compatible clustering only.",
  decisions: input.sources.map(s => ({ solutionId: s.solutionId, disposition: "included", reason: "Contributes complementary supported capability." })),
  flow: [{ sourceSolutionId: input.sources[0].solutionId, capabilityId: "cap-summarize", reason: "Summarize in the approved base." },
    { sourceSolutionId: input.sources[1].solutionId, capabilityId: "cap-clustering", reason: "Cross-site grouping." }],
  overlapDecisions: ["Keep base summarizer; omit overlapping CSV ingestion."], dependencies: ["Existing approval controls"], integrationGaps: [], clarifications: [],
  capabilityGaps:[],librarySuggestions:[],
};
let calls = 0;
const fixture = (data: unknown): typeof analyze => (async (opts: any) => {
  calls++;
  return { data: opts.schema.parse(data), provenance: { id: `fixture-${calls}`, model: "deterministic-test-fixture", promptVersion: "test-only", inputFingerprint: "test-only", createdAt: new Date().toISOString(), cached: false } };
}) as typeof analyze;
const remember = (c: any) => { ids.push(c.id); if (c.caseId) cases.push(c.caseId); return c; };
try {
  await pool.query(await readFile("lib/db/src/compositions-migration.sql","utf8").catch(() => readFile("../../lib/db/src/compositions-migration.sql","utf8")));
  const evidence = await sourceEvidence(input.sources);
  validatePlan(plan,evidence);
  assert.deepEqual(changesBetween({flow:[{capabilityId:"a",reason:"same"}]},{flow:[{reason:"same",capabilityId:"a"}]},"test"),[],"Postgres JSONB key order is not a flow change.");
  assert.throws(() => validatePlan({ ...plan, flow: [{ ...plan.flow[0], capabilityId: "invented" }] },evidence), /outside/);
  assert.throws(() => validatePlan({ ...plan, decisions: [plan.decisions[0],plan.decisions[0]] },evidence), /every selected/);
  assert.deepEqual(reverseChanges({ setting: "new", manual: "keep" },[{path:"setting",before:"old",after:"new",reason:"test"}]), {setting:"old",manual:"keep"});
  assert.throws(() => reverseChanges({setting:"manually changed"},[{path:"setting",before:"old",after:"new",reason:"test"}]), /conflict/);
  const [a,b] = await Promise.all([createComposition(user,input,{analyzer:fixture(plan)}),createComposition(user,input,{analyzer:fixture(plan)})]);
  remember(a);
  assert.equal(a.id,b.id); assert.equal(calls,1); assert.equal(a.caseKind,"case"); assert.equal(a.executable,true);
  assert.equal(a.baseline.solutionId,input.sources[0].solutionId);
  assert.equal(a.canUndo,false);
  assert.deepEqual(a.sources,input.sources);
  assert.equal((await listCompositions(user,a.caseId)).length,1);
  assert.equal((await listCompositions("other-user",a.caseId)).length,0);
  await assert.rejects(readComposition("other-user",a.id),/not found/);
  await assert.rejects(createComposition(user,{...input,desiredOutcome:"Different"},{analyzer:fixture(plan)}),/different inputs/);
  assert.equal((await getCase(a.caseId))!.moduleStates["cap-clustering"],true);
  // The same request scope used by public HTTP routes also protects their
  // shared store reads (library/home/portfolio/reuse/group listings).
  await caseAccessScope.run({hidden:new Set([a.caseId])},async()=>{
    assert.equal(await getCase(a.caseId),null);
    assert.ok(!(await listCaseRows()).some(c=>c.id===a.caseId));
    await assert.rejects(updateCaseRow(a.caseId,{title:"unauthorized"}),/not found/);
    assert.ok((await listCaseRows()).some(c=>c.demo),"Legacy public cases remain visible.");
  });
  await caseAccessScope.run({hidden:new Set()},async()=>{
    assert.ok((await listCaseRows()).some(c=>c.id===a.caseId));
  });
  const refined = { plan: {...plan,goal:"Immediate review"}, patch:{configValues:{"cap-notify":"Immediate"}},reason:"Requested immediate notifications." };
  const p = await previewRefinement(user,a.id,1,"Notify immediately",{analyzer:fixture(refined)});
  assert.equal(p.changes[0].path,"configValues.cap-notify");
  // A manual edit after Preview invalidates the whole apply, even unrelated edits.
  await pool.query("UPDATE cases SET title=title || ' manually renamed',updated_at=clock_timestamp() WHERE id=$1",[a.caseId]);
  await assert.rejects(applyRefinement(user,a.id,p.id,1),/Manual edits/);
  const p2 = await previewRefinement(user,a.id,1,"Notify immediately",{analyzer:fixture(refined)});
  const applied = await applyRefinement(user,a.id,p2.id,1);
  assert.equal(applied.revision,2);
  assert.equal(applied.canUndo,true);
  assert.equal((await readComposition(user,a.id)).canUndo,true);
  assert.equal((await getCase(a.caseId))!.configValues["cap-notify"],"Immediate");
  await assert.rejects(applyRefinement(user,a.id,p2.id,2),/consumed/);
  await pool.query(`UPDATE cases SET config_values=jsonb_set(config_values,'{cap-review-queue}','"Flag after 5 occurrences"'),updated_at=clock_timestamp() WHERE id=$1`,[a.caseId]);
  const undone = await undoComposition(user,a.id,2);
  assert.equal(undone.revision,3);
  assert.equal(undone.canUndo,false);
  assert.equal((await readComposition(user,a.id)).canUndo,false);
  const restored = (await getCase(a.caseId))!;
  assert.equal(restored.configValues["cap-notify"],"Daily digest");
  assert.equal(restored.configValues["cap-review-queue"],"Flag after 5 occurrences");
  assert.match(restored.title,/manually renamed/);
  const p3 = await previewRefinement(user,a.id,3,"Notify immediately",{analyzer:fixture(refined)});
  await cancelRefinement(user,a.id,p3.id);
  await assert.rejects(applyRefinement(user,a.id,p3.id,3),/consumed/);
  await assert.rejects(previewRefinement(user,a.id,1,"stale",{analyzer:fixture(refined)}),/changed/);
  await assert.rejects(previewRefinement(user,a.id,3,"Disable approval",{analyzer:fixture({...refined,patch:{moduleStates:{"cap-approval":false}}})}),/locked/);
  const p4 = await previewRefinement(user,a.id,3,"Notify immediately",{analyzer:fixture(refined)});
  await applyRefinement(user,a.id,p4.id,3);
  await pool.query(`UPDATE cases SET config_values=jsonb_set(config_values,'{cap-notify}','"Weekly summary"'),updated_at=clock_timestamp() WHERE id=$1`,[a.caseId]);
  await assert.rejects(undoComposition(user,a.id,4),/conflict/);
  assert.equal((await readComposition(user,a.id)).revision,4);
  const previewSource = catalogSolutions.find(s => s.execution === "preview")!;
  const mixedInput = compositionInput.parse({...input,idempotencyKey:randomUUID(),sources:[input.sources[0],{solutionId:previewSource.id,version:previewSource.currentVersion}]});
  const mixedPlan = {...plan,decisions:[plan.decisions[0],{solutionId:previewSource.id,disposition:"unnecessary",reason:"Preview source is not needed."}],flow:[plan.flow[0]]};
  const mixed = remember(await createComposition(user,mixedInput,{analyzer:fixture(mixedPlan)}));
  assert.equal(mixed.caseKind,"proposal"); assert.equal(mixed.caseId,null); assert.equal(mixed.executable,false);
  const otherPreview = catalogSolutions.find(s => s.execution === "preview" && s.id !== previewSource.id)!;
  const previewInput = compositionInput.parse({...input,idempotencyKey:randomUUID(),sources:[previewSource,otherPreview].map(s=>({solutionId:s.id,version:s.currentVersion}))});
  const previewPlan = {...plan,baseSolutionId:previewSource.id,decisions:[previewSource,otherPreview].map(s=>({solutionId:s.id,disposition:"included",reason:"Proposed only; no engine."})),flow:[previewSource,otherPreview].map(s=>({sourceSolutionId:s.id,capabilityId:s.capabilityIds[0],reason:"Source-grounded proposal."}))};
  const previewOnly = remember(await createComposition(user,previewInput,{analyzer:fixture(previewPlan)}));
  assert.equal(previewOnly.executable,false); assert.equal(previewOnly.caseId,null);
  const proposedPreview = await previewRefinement(user,previewOnly.id,1,"Change the proposed goal",{analyzer:fixture({plan:{...previewPlan,goal:"A revised proposed outcome"},patch:{},reason:"Desired outcome changed."})});
  assert.ok(proposedPreview.changes.some(c=>c.path==="plan.goal"));
  await applyRefinement(user,previewOnly.id,proposedPreview.id,1);
  assert.equal((await readComposition(user,previewOnly.id)).plan.goal,"A revised proposed outcome");
  await undoComposition(user,previewOnly.id,2);
  assert.equal((await readComposition(user,previewOnly.id)).plan.goal,previewPlan.goal);
  const threeInput = compositionInput.parse({...input,idempotencyKey:randomUUID(),sources:[...input.sources,{solutionId:"sol-action-tracker",version:catalogSolutions.find(s=>s.id==="sol-action-tracker")!.currentVersion}]});
  const three = remember(await createComposition(user,threeInput,{analyzer:fixture({...plan,decisions:[...plan.decisions,{solutionId:"sol-action-tracker",disposition:"unnecessary",reason:"Outcome does not need post-approval tracking."}]})}));
  assert.equal(three.sources.length,3); assert.equal(three.plan.decisions.length,3);
  const failKey = randomUUID();
  await assert.rejects(createComposition(user,{...input,idempotencyKey:failKey},{analyzer:(async()=>{throw new AnalysisError("provider failure");}) as typeof analyze}),/provider failure/);
  assert.equal((await pool.query("SELECT id FROM compositions WHERE user_id=$1 AND idempotency_key=$2",[user,failKey])).rows.length,0);
  const retry = remember(await createComposition(user,{...input,idempotencyKey:failKey},{analyzer:fixture(plan)}));
  assert.equal(retry.executable,true);
  const registered = await registeredConsolidationSources();
  const invoiceSources = ["invoice-finder","approval-desk","spend-tracker"].map(id=>registered.find(s=>s.id===id));
  assert.ok(invoiceSources.every(Boolean),"Combined tests require the existing registered invoice demo sources.");
  const combinedInput = compositionInput.parse({...input,idempotencyKey:randomUUID(),sources:invoiceSources.map(s=>({solutionId:s.id,version:s.version}))});
  const combinedPlan = {...plan,baseSolutionId:"invoice-finder",decisions:combinedInput.sources.map(s=>({solutionId:s.solutionId,disposition:"included",reason:"Complementary reviewed source."})),
    flow:[{sourceSolutionId:"invoice-finder",capabilityId:"fuzzy-search",reason:"Find invoices."},{sourceSolutionId:"approval-desk",capabilityId:"bulk-decisions",reason:"Permission-preserving decision review."},{sourceSolutionId:"spend-tracker",capabilityId:"spend-tracing",reason:"Trace totals."}]};
  const combined = remember(await createComposition(user,combinedInput,{analyzer:fixture(combinedPlan)}));
  assert.equal(combined.caseKind,"combined"); assert.equal(combined.baseline.registeredSource.id,"invoice-finder");
  assert.equal((await ownedConsolidationCase(user,combined.caseId)).selectedSources.length,3);
  const twoSourcePlan = { ...combinedPlan, decisions: combinedPlan.decisions.slice(0, 2), flow: combinedPlan.flow.slice(0, 2) };
  const twoSourceCombined = remember(await createComposition(user, {
    ...combinedInput, idempotencyKey: randomUUID(), sources: combinedInput.sources.slice(0, 2),
  }, { analyzer: fixture(twoSourcePlan) }));
  assert.equal(twoSourceCombined.caseKind, "combined");
  assert.equal((await ownedConsolidationCase(user, twoSourceCombined.caseId)).selectedSources.length, 2);
  assert.deepEqual((await ownedConsolidationCase(user, twoSourceCombined.caseId)).capabilityIds, ["fuzzy-search", "bulk-decisions"]);
  const cp = await previewRefinement(user,combined.id,1,"Remove spend tracing",{analyzer:fixture({plan:{...combinedPlan,decisions:combinedPlan.decisions.map(d=>d.solutionId==="spend-tracker"?{...d,disposition:"unnecessary",reason:"No longer needed."}:d),flow:combinedPlan.flow.slice(0,2)},patch:{capabilityIds:["fuzzy-search","bulk-decisions"]},reason:"Requested removal."})});
  await applyRefinement(user,combined.id,cp.id,1);
  assert.deepEqual((await ownedConsolidationCase(user,combined.caseId)).capabilityIds,["fuzzy-search","bulk-decisions"]);
  await undoComposition(user,combined.id,2);
  assert.equal((await ownedConsolidationCase(user,combined.caseId)).capabilityIds.length,3);
  const corrupted = await pool.query("SELECT snapshot FROM compositions WHERE id=$1",[combined.id]);
  const saved = corrupted.rows[0].snapshot;
  await pool.query("UPDATE compositions SET snapshot=jsonb_set(snapshot,'{sourceFingerprint}','\"stale-source\"') WHERE id=$1",[combined.id]);
  await assert.rejects(previewRefinement(user,combined.id,3,"Keep sources",{analyzer:fixture({plan:combinedPlan,patch:{},reason:"No change."})}),/Source evidence changed/);
  await pool.query("UPDATE compositions SET snapshot=$1 WHERE id=$2",[saved,combined.id]);
  console.log("PASS: grounded references, concurrent idempotency, live case, 2/3 sources, mixed preview, ownership, current-case preview, manual conflict, settings apply/cancel/Undo, provider failure/retry.");
  console.log("PASS: preview-only proposal; conflicting Undo rollback; real 3-source combined case, original A provenance, apply/Undo, source-evidence drift rejection.");
  if (process.argv.includes("--live")) {
    assert.ok(analysisConfigured(),"Live smoke requires configured provider.");
    const live = remember(await createComposition(user,{...input,idempotencyKey:randomUUID()}));
    assert.ok(live.provenance.model !== "deterministic-test-fixture");
    console.log(`PASS live provider: ${live.provenance.model}, ${live.caseKind}, ${live.plan.decisions.length} grounded sources.`);
    const livePreview = await previewRefinement(user,retry.id,1,"Change only notification setting to Immediate. Keep all source decisions and existing flow unchanged; do not request any integrations.");
    assert.ok(livePreview.changes.some(c => c.path === "configValues.cap-notify" && c.after === "Immediate"));
    await cancelRefinement(user,retry.id,livePreview.id);
    console.log(`PASS live provider refinement: ${livePreview.provenance.model}, grounded current-case setting preview; cancelled without applying.`);
  }
} finally {
  await pool.query("DELETE FROM composition_refinements WHERE composition_id IN (SELECT id FROM compositions WHERE user_id=$1)",[user]);
  await pool.query("DELETE FROM compositions WHERE user_id=$1",[user]);
  if (cases.length) { await pool.query("DELETE FROM cases WHERE id=ANY($1::text[])",[cases]); await pool.query("DELETE FROM consolidation_cases WHERE id=ANY($1::text[])",[cases]); }
  await pool.end();
}
