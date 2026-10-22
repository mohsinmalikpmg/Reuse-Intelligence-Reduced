import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import compositionsRouter from "../src/routes/compositions";
import inputRouter from "../src/routes/workbench-inputs";
import workbenchRouter from "../src/routes/workbench";
import combinedRouter from "../src/routes/consolidation-cases";
import { createComposition } from "../src/lib/compositions";
import { compositionInput } from "../src/lib/composition-contract";
import { analyze } from "../src/lib/ai-analysis";
import { getCapability, catalogSolutions } from "../src/data/catalog";
import { registeredConsolidationSources, consolidationRecipes } from "../src/lib/consolidation-recipes";
import { INPUT_MAX_BYTES, normalizeInput } from "../src/lib/workbench-input";
import { sampleInputs } from "../src/engine/workorders";

const user=`input-test-${randomUUID()}`,other=`input-other-${randomUUID()}`,caseIds:string[]=[];
const app=express();app.use(express.json({limit:"600kb"}));
app.use((req,_res,next)=>{if(req.get("x-test-user"))req.user={id:req.get("x-test-user")!} as Express.User;next();});
app.use(compositionsRouter);app.use(inputRouter);app.use(workbenchRouter);app.use(combinedRouter);
app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error.status??500).json({error:error.message}));
const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const fixture=(plan:any):typeof analyze=>(async(opts:any)=>({data:opts.schema.parse(plan),provenance:{id:randomUUID(),model:"test-fixture",promptVersion:"test",inputFingerprint:"test",createdAt:new Date().toISOString(),cached:false}})) as typeof analyze;
async function make(sources:{solutionId:string;version:string}[],caps:string[]){
  const plan={title:"Input test",goal:"Inspect supplied input",goalInferred:false,baseSolutionId:sources[0].solutionId,rationale:"Test",decisions:sources.map(s=>({solutionId:s.solutionId,disposition:"included",reason:"Selected source."})),
    flow:sources.map((s,i)=>({sourceSolutionId:s.solutionId,capabilityId:caps[i],reason:"Selected capability."})),overlapDecisions:[],dependencies:[],integrationGaps:[],clarifications:[]};
  const c=await createComposition(user,compositionInput.parse({idempotencyKey:randomUUID(),sources}),{analyzer:fixture(plan)});
  if(c.caseId)caseIds.push(c.caseId);return c;
}
async function upload(target:string,filename:string,data:string|Uint8Array,identity:string|null=user,origin=url){
  const form=new FormData();form.set("file",new Blob([typeof data==="string"?data:Uint8Array.from(data).buffer]),filename);
  return fetch(`${url}/workbench-inputs/${target}/validate`,{method:"POST",headers:{...(identity?{"x-test-user":identity}:{}),origin},body:form});
}
async function post(path:string,body:unknown,identity=user){return fetch(url+path,{method:"POST",headers:{"x-test-user":identity,origin:url,"Content-Type":"application/json"},body:JSON.stringify(body)});}
try{
  for(const sample of sampleInputs)assert.equal(normalizeInput(sample.text).text,sample.text,"Existing sample inputs remain unchanged.");
  const c=await make([{solutionId:"sol-workorder-insight",version:"3.2"},{solutionId:"sol-site-pattern-finder",version:"1.4"}],["cap-summarize","cap-clustering"]);
  const rows=[{id:"UPLOAD-UNIQUE-9001",date:"2026-05-01",site:"CUSTOM-SITE",equipment:"P-901 (pump)",note:"Unique submitted pump bearing vibration, investigate before restart."},
    {id:"UPLOAD-UNIQUE-9002",date:"2026-05-02",site:"CUSTOM-SITE",equipment:"P-901 (pump)",note:"Unique submitted pump vibration recurred; inspect bearing."}];
  const csv='id,date,site,equipment,note\n'+rows.map(r=>[r.id,r.date,r.site,r.equipment,`"${r.note}"`].join(",")).join("\n");
  const uploaded=await upload(c.id,"custom.csv",csv);
  assert.equal(uploaded.status,200,await uploaded.clone().text());
  const validated=await uploaded.json() as any;
  assert.equal(validated.compatible,true);assert.equal(validated.runnable,true);assert.equal(validated.recordCount,2);
  assert.deepEqual(validated.contracts.map((x:any)=>x.version),["A","B"]);
  assert.ok(validated.contracts[0].ingestionCapabilityIds.includes("cap-wo-ingest"));
  assert.ok(!validated.contracts[1].ingestionCapabilityIds.includes("cap-csv-ingest"),"CSV normalization must not pretend the incompatible CSV module was enabled.");
  const comparison=await post(`/cases/${c.caseId}/compare`,{inputText:validated.normalizedInputText});
  assert.equal(comparison.status,200,await comparison.clone().text());
  const runs=(await pool.query("SELECT * FROM runs WHERE case_id=$1 ORDER BY version",[c.caseId])).rows;
  assert.equal(runs.length,2);assert.equal(runs[0].input_hash,runs[1].input_hash);
  for(const run of runs){assert.equal(run.sample_input_id,null);assert.equal(run.input_text,validated.normalizedInputText);assert.match(JSON.stringify(run.output),/UPLOAD-UNIQUE-9001/);assert.match(JSON.stringify(run.output),/UPLOAD-UNIQUE-9002/);}
  const json=await upload(c.caseId,"custom.json",JSON.stringify(rows));assert.equal(json.status,200);
  assert.equal((await json.json() as any).normalizedInputText,validated.normalizedInputText);
  const directJson=await post("/runs",{caseId:c.caseId,version:"A",inputText:JSON.stringify(rows)});
  assert.equal(directJson.status,201);assert.equal((await directJson.json() as any).inputText,validated.normalizedInputText);
  const pattern=await make([{solutionId:"sol-site-pattern-finder",version:"1.4"},{solutionId:"sol-action-tracker",version:"0.9"}],["cap-clustering","cap-action-tracking"]);
  const patternInput=await upload(pattern.id,"custom.csv",csv);
  assert.equal(patternInput.status,200);assert.equal((await patternInput.json() as any).contracts[0].sourceSolutionId,"sol-site-pattern-finder");
  assert.equal((await upload(c.caseId,"notes.txt","Pump P-901 vibrating; inspect the bearing.")).status,200);
  assert.equal((await upload(c.caseId,"foreign.csv","vendor,amount\nSupplier,50")).status,422);
  const badRow=await upload(c.id,"bad.csv","id,date,site,equipment,note\nX,2026-02-30,Plant,Pump,Leak");
  assert.equal(badRow.status,422);const bad=await badRow.json() as any;assert.equal(bad.issues[0].row,2);assert.equal(bad.issues[0].field,"date");assert.ok(bad.contracts[0].expectedFields.includes("note"));
  for(const [filename,data] of [["bad.json",'[{"note":'],["object.json",'{"invoices":[]}'],["bad.csv",'id,date,site,equipment,note\nX,2026-01-01,Plant,Pump,"leak'],["blank.txt"," \n"],["book.xlsx","not really a spreadsheet"],["image.txt","\u0000PNG"],["empty.json","[]"],["columns.csv","id,date,site,equipment,note\nX,2026-01-01,Plant"]]){
    assert.equal((await upload(c.id,filename,data)).status,422,filename);
  }
  assert.equal((await upload(c.id,"invalid.txt",new Uint8Array([0xff,0xfe,0x00]))).status,422);
  assert.equal((await upload(c.id,"large.txt","x".repeat(INPUT_MAX_BYTES+1))).status,413);
  assert.equal((await upload(c.id,"notes.txt","Note",null)).status,401);
  assert.equal((await upload(c.id,"notes.txt","Note",other)).status,404);
  assert.equal((await upload(c.caseId,"notes.txt","Note",other)).status,404);
  assert.equal((await upload(c.id,"notes.txt","Note",user,"https://elsewhere.invalid")).status,403);
  assert.equal((await post("/runs",{caseId:c.caseId,version:"B",inputText:"Note"},other)).status,404);
  const before=(await pool.query("SELECT count(*)::int n FROM runs WHERE case_id=$1",[c.caseId])).rows[0].n;
  assert.equal((await post(`/cases/${c.caseId}/compare`,{inputText:"",sampleInputId:"wo-related"})).status,422,"Empty explicit input must not silently run a sample.");
  assert.equal((await post("/runs",{caseId:c.caseId,version:"A",inputText:'[{"note":'})).status,422);
  assert.equal((await post("/runs",{caseId:c.caseId,version:"B",inputText:"x".repeat(INPUT_MAX_BYTES+1)})).status,413);
  // Test actual A/B capability validation rather than relying on a client-upload flag.
  const cap=getCapability("cap-clustering")!,category=cap.category;
  try{
    cap.category="Data ingestion";
    const response=await post(`/cases/${c.caseId}/compare`,{inputText:validated.normalizedInputText});
    assert.equal(response.status,422);
    const rejected=await response.json() as any;
    assert.equal(rejected.contracts[0].compatible,true);assert.equal(rejected.contracts[1].compatible,false);
    assert.equal((await post("/runs",{caseId:c.caseId,version:"B",inputText:validated.normalizedInputText})).status,422);
  }finally{cap.category=category;}
  assert.equal((await pool.query("SELECT count(*)::int n FROM runs WHERE case_id=$1",[c.caseId])).rows[0].n,before,"Invalid B must not persist even an A run.");
  const previews=catalogSolutions.filter(s=>s.execution==="preview").slice(0,2);
  const proposal=await make(previews.map(s=>({solutionId:s.id,version:s.currentVersion})),previews.map(s=>s.capabilityIds[0]));
  const inspected=await upload(proposal.id,"custom.json",JSON.stringify(rows));
  assert.equal(inspected.status,422);const inspectedBody=await inspected.json() as any;
  assert.equal(inspectedBody.runnable,false);assert.equal(inspectedBody.caseId,null);assert.ok(inspectedBody.contracts.every((x:any)=>!x.compatible));
  const registry=await registeredConsolidationSources();
  for(const recipe of consolidationRecipes){
    const sourceIds=recipe.sourceIds.slice(0,2),sources=sourceIds.map(id=>registry.find(s=>s.id===id)!);
    const combined=await make(sources.map(s=>({solutionId:s.solutionId,version:s.version})),sourceIds.map(id=>recipe.capabilities.find(cap=>cap.sourceId===id)!.id));
    assert.equal(combined.caseKind,"combined");
    const incompatible=await upload(combined.id,"custom.json",JSON.stringify(rows));
    assert.equal(incompatible.status,422);assert.equal((await incompatible.json() as any).runnable,false);
    const actualFinanceFile=await upload(combined.id,"ledger.csv","vendor,amount\nSupplier,50");
    const fixedReason=await actualFinanceFile.json() as any;
    assert.equal(actualFinanceFile.status,422);assert.equal(fixedReason.issues[0].code,"incompatible_ingestion");assert.match(fixedReason.issues[0].message,/cannot ingest/);
    const rejected=await post(`/consolidation/cases/${combined.caseId}/run`,{inputText:validated.normalizedInputText});
    assert.equal(rejected.status,422);assert.match((await rejected.json() as any).error,/cannot ingest/);
    assert.equal((await post(`/consolidation/cases/${combined.caseId}/run`,{},other)).status,404);
  }
  assert.throws(()=>normalizeInput(JSON.stringify([{...rows[0],extra:"Must not silently discard."}]),"json"),/Unsupported field/);
  console.log("PASS actual-route CSV/JSON/text upload; supplied-data A/B execution (not samples); both-target server guards; malformed/empty/binary/size/row errors; ownership/origin; unverified proposals and fixed invoice/finance rejection.");
}finally{
  await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  await pool.query("DELETE FROM evaluations WHERE case_id=ANY($1::text[])",[caseIds]);
  await pool.query("DELETE FROM runs WHERE case_id=ANY($1::text[])",[caseIds]);
  await pool.query("DELETE FROM compositions WHERE user_id=$1",[user]);
  await pool.query("DELETE FROM cases WHERE id=ANY($1::text[])",[caseIds]);
  await pool.query("DELETE FROM consolidation_cases WHERE id=ANY($1::text[])",[caseIds]);
  await pool.end();
}
