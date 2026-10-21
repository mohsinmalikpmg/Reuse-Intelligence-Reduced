import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { pipeline } from "node:stream/promises";
import { pool } from "@workspace/db";
import { CreateSolutionPackageUploadUrlBody, ReviewSolutionPackageBody } from "@workspace/api-zod";
import { solutions, solutionCapabilities } from "../data/catalog";
import { digest, inspectSolutionArchive } from "../lib/solution-package-archive";
import { packageObject, packageUploadUrl, readStagedPackage, savePackageOriginal } from "../lib/solution-package-storage";

const router: IRouter = Router();
const base = "/library/solution-packages";
const available = () => solutions.filter(s=>s.execution==="live").map(s=>({
  id:s.id,name:s.name,capabilities:solutionCapabilities(s).map(c=>({id:c.id,name:c.name})),
}));
function present(r: Record<string, any>) {
  return {id:r.id,solutionId:r.solution_id,solutionName:r.solution_name,version:r.version,filename:r.filename,
    status:r.status,sha256:r.sha256,createdAt:r.created_at.toISOString(),claims:r.claims,files:r.files,
    dependencies:r.dependencies,mappings:r.mappings,warnings:r.warnings,reviewNote:r.review_note,sandboxTested:false};
}
const rates = new Map<string,{start:number;count:number}>();
router.use(base, async (req,res,next)=>{
  res.setHeader("Cache-Control","private, no-store");
  if(!req.isAuthenticated?.() || !req.user?.id) {res.status(401).json({error:"Sign in to access solution packages."});return;}
  try {
    const {rows} = await pool.query("SELECT can_manage_solution_packages FROM users WHERE id=$1",[req.user.id]);
    res.locals.canManage=rows[0]?.can_manage_solution_packages===true;
    if(req.method!=="GET") {
      if(!res.locals.canManage) {res.status(403).json({error:"An administrator must grant your account IT package-management access."});return;}
      const origin=req.get("origin");
      if(req.get("sec-fetch-site")==="cross-site" || (origin && new URL(origin).host!==req.get("host"))) {
        res.status(403).json({error:"Cross-origin package changes are forbidden."});return;
      }
      const now=Date.now();
      for(const [id,r] of rates) if(now-r.start>60_000) rates.delete(id);
      const rate=rates.get(req.user.id) ?? {start:now,count:0};
      if(++rate.count>20) {res.status(429).json({error:"Package change limit reached. Try again in one minute."});return;}
      rates.set(req.user.id,rate);
    }
    next();
  } catch(e) {req.log.error({err:e},"Package authorization failed");res.status(503).json({error:"Package authorization is unavailable."});}
});
router.get(base,async (_req,res)=>{
  const {rows}=await pool.query("SELECT * FROM solution_packages ORDER BY created_at DESC LIMIT 200");
  res.json({canManage:res.locals.canManage,packages:rows.map(present),solutions:available()});
});
router.post(`${base}/upload-url`,async(req,res)=>{
  const parsed=CreateSolutionPackageUploadUrlBody.safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"Invalid package metadata."});return;}
  const input=parsed.data;
  const solution=available().find(s=>s.id===input.solutionId);
  if(!solution || !/^[^/\\:\x00-\x1f]{1,196}\.zip$/i.test(input.filename) || !input.version.trim()){
    res.status(400).json({error:"Choose a LIVE solution, a version and a plain .zip filename."});return;
  }
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[req.user!.id]);
    const {rows}=await client.query("SELECT count(*)::int AS n FROM solution_packages WHERE created_by=$1 AND created_at>now()-interval '1 hour'",[req.user!.id]);
    if(rows[0].n>=10){await client.query("ROLLBACK");res.status(429).json({error:"Maximum ten package uploads per hour."});return;}
    const id=randomUUID(),path=`solution-packages/staging/${id}`;
    const uploadURL=await packageUploadUrl(path);
    await client.query("INSERT INTO solution_packages(id,solution_id,solution_name,version,filename,staging_path,created_by,claims) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [id,solution.id,solution.name,input.version,input.filename,path,req.user!.id,JSON.stringify(input.claims)]);
    await client.query("COMMIT");res.json({id,uploadURL});
  } catch(e) {await client.query("ROLLBACK");req.log.error({err:e},"Package upload initialization failed");res.status(503).json({error:"Unable to initialize private upload. Check storage configuration and try again."});}
  finally{client.release();}
});
router.post(`${base}/:id/inspect`,async(req,res)=>{
  const client=await pool.connect();
  let row:Record<string,any>|undefined;
  try {
    await client.query("BEGIN");
    // Transaction-scoped cluster-wide lock: bounded memory even across multiple server processes.
    const {rows:locks}=await client.query("SELECT pg_try_advisory_xact_lock(724193811) AS acquired");
    if(!locks[0].acquired){await client.query("ROLLBACK");res.status(429).json({error:"Another package is being inspected. Try again shortly."});return;}
    const {rows}=await client.query("SELECT * FROM solution_packages WHERE id=$1 FOR UPDATE",[String(req.params.id)]);
    row=rows[0];
    if(!row){await client.query("ROLLBACK");res.status(404).json({error:"Package not found."});return;}
    if(row.status!=="awaiting_upload"){await client.query("ROLLBACK");res.status(409).json({error:"Package has already been inspected or rejected. Start a new upload."});return;}
    const solution=available().find(s=>s.id===row!.solution_id);
    if(!solution)throw new Error("Package target is not a LIVE solution.");
    const data=await readStagedPackage(row.staging_path);
    const result=await inspectSolutionArchive(data);
    const sha256=digest(data);
    const objectPath=await savePackageOriginal(sha256,data);
    const mappings=solution.capabilities.flatMap(cap=>{
      const tokens=cap.name.toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>3);
      return result.files.filter(f=>tokens.some(t=>f.path.toLowerCase().includes(t))).slice(0,5).map(f=>({
        capabilityId:cap.id,capabilityName:cap.name,file:f.path,decision:"proposed",note:"Filename similarity only; IT must review the source.",
      }));
    });
    const {rows:updated}=await client.query("UPDATE solution_packages SET status='inspected',sha256=$2,object_path=$3,files=$4,dependencies=$5,mappings=$6,warnings=$7 WHERE id=$1 RETURNING *",
      [row.id,sha256,objectPath,JSON.stringify(result.files),JSON.stringify(result.dependencies),JSON.stringify(mappings),JSON.stringify(result.warnings)]);
    await client.query("COMMIT");res.json(present(updated[0]));
  } catch(e) {
    await client.query("ROLLBACK");
    const message=e instanceof Error?e.message:"ZIP inspection failed.";
    if(row) await pool.query("UPDATE solution_packages SET status='failed',warnings=$2 WHERE id=$1 AND status='awaiting_upload'",[row.id,JSON.stringify([message])]);
    req.log.warn({err:e},"Package inspection failed");
    res.status(422).json({error:`Inspection failed: ${message}`});
  } finally {client.release();}
});
router.patch(`${base}/:id/review`,async(req,res)=>{
  const parsed=ReviewSolutionPackageBody.safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"Invalid review. Provide approved/rejected mappings and notes."});return;}
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const {rows}=await client.query("SELECT * FROM solution_packages WHERE id=$1 FOR UPDATE",[String(req.params.id)]);
    const row=rows[0];
    if(!row){await client.query("ROLLBACK");res.status(404).json({error:"Package not found."});return;}
    if(!["inspected","reviewed"].includes(row.status)){await client.query("ROLLBACK");res.status(409).json({error:"Inspect this package before reviewing mappings."});return;}
    const solution=available().find(s=>s.id===row.solution_id);
    const seen=new Set<string>();
    const mappings=parsed.data.mappings.map(m=>{
      const cap=solution?.capabilities.find(c=>c.id===m.capabilityId);
      const key=JSON.stringify([m.capabilityId,m.file]);
      if(!cap || !row.files.some((f:{path:string})=>f.path===m.file) || seen.has(key)) throw new Error("Each mapping must reference a unique, exact inspected file and a capability of this LIVE solution.");
      seen.add(key);return {...m,capabilityName:cap.name};
    });
    const {rows:updated}=await client.query("UPDATE solution_packages SET mappings=$2,review_note=$3,reviewed_by=$4,status='reviewed' WHERE id=$1 RETURNING *",
      [row.id,JSON.stringify(mappings),parsed.data.note,req.user!.id]);
    await client.query("COMMIT");res.json(present(updated[0]));
  }catch(e){await client.query("ROLLBACK");res.status(400).json({error:e instanceof Error?e.message:"Review failed."});}
  finally{client.release();}
});
router.get(`${base}/:id/download`,async(req,res)=>{
  const {rows}=await pool.query("SELECT * FROM solution_packages WHERE id=$1",[String(req.params.id)]);
  const row=rows[0];
  if(!row?.object_path){res.status(404).json({error:"An inspected original is not available."});return;}
  try {
    res.type("application/zip");
    res.setHeader("Content-Disposition",`attachment; filename="solution-${row.id}.zip"`);
    res.setHeader("X-Content-Type-Options","nosniff");
    await pipeline(packageObject(row.object_path).createReadStream(),res);
  }catch(e){req.log.error({err:e},"Package download failed");if(!res.headersSent)res.status(503).json({error:"Stored original is unavailable."});else res.destroy();}
});
export default router;
