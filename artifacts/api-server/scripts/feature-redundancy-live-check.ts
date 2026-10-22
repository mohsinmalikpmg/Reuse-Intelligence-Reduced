import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { z } from "zod";
import { analyze, analysisFingerprint } from "../src/lib/ai-analysis";
import { featureRedundancy, featureRedundancyInput } from "../src/lib/feature-redundancy";
import { catalogSolutions } from "../src/data/catalog";

const compositionId=process.argv[2];
if(!compositionId?.startsWith("cmp_")) throw new Error("Provide an existing composition ID.");
try {
  const {rows}=await pool.query("SELECT user_id,revision,snapshot FROM compositions WHERE id=$1",[compositionId]);
  assert.equal(rows.length,1);
  const original=analysisFingerprint(rows[0].snapshot);
  console.log("Scoped redundancy target:",{revision:rows[0].revision,caseKind:rows[0].snapshot.caseKind,selectedSources:rows[0].snapshot.sources.length});
  const diagnostic:typeof analyze=async opts=>analyze({...opts,force:true,schema:z.preprocess(data=>{
    const checked=opts.schema.safeParse(data);
    if(!checked.success) console.log("Validation diagnostics:",checked.error.issues.map(i=>({path:i.path.join("."),code:i.code,message:i.message})));
    return data;
  },opts.schema) as typeof opts.schema});
  const target=featureRedundancyInput.parse({compositionId});
  const live=await featureRedundancy(rows[0].user_id,target,{analyzer:diagnostic});
  const cached=await featureRedundancy(rows[0].user_id,target);
  assert.equal(cached.provenance.id,live.provenance.id);
  assert.equal(cached.provenance.cached,true);
  const saved=(await pool.query("SELECT revision,snapshot FROM compositions WHERE id=$1",[compositionId])).rows[0];
  assert.equal(saved.revision,rows[0].revision);
  assert.equal(analysisFingerprint(saved.snapshot),original);
  console.log("PASS actual compositionId live redundancy and persisted cache; composition unchanged:",{model:live.provenance.model,groups:live.analysis.groups.length,cached:cached.provenance.cached});
  if(process.argv.includes("--donors")){
    const sources=catalogSolutions.slice(0,12).map(s=>({solutionId:s.id,version:s.currentVersion}));
    const donors=await featureRedundancy(rows[0].user_id,featureRedundancyInput.parse({sources}),{analyzer:diagnostic});
    assert.equal(donors.sources.length,12);
    assert.ok(donors.analysis.groups.every(g=>g.coverage.length===12));
    console.log("PASS live 12-source redundancy: every group accounts for every donor.",{groups:donors.analysis.groups.length});
  }
}finally{await pool.end();}
