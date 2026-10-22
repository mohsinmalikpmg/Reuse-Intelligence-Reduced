import { Router, type IRouter, type Response } from "express";
import multer from "multer";
import { pool } from "@workspace/db";
import { getCase } from "../lib/store";
import { caseContext } from "../lib/configuration";
import { versionACapabilities, versionBCapabilities } from "../lib/workbench";
import { readComposition } from "../lib/compositions";
import { ownedConsolidationCase } from "../lib/consolidation-recipes";
import { INPUT_MAX_BYTES, WorkbenchInputError, fixedInputContract, noteInputContract, validateEngineInput, type InputContract } from "../lib/workbench-input";

const router:IRouter=Router();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:INPUT_MAX_BYTES,files:1,fields:0,parts:1,fieldNameSize:40,headerPairs:30}}).single("file");
type Target={targetId:string;caseId:string|null;caseKind:string;runnable:boolean;contracts:InputContract[];limitations:string[]};
async function targetFor(userId:string,targetId:string):Promise<Target>{
  let caseId=targetId;
  const limitations=["Upload bytes are transient and are not saved. A run stores normalized input text under the existing engine conventions.",
    "Compatibility checks structure and available readers, not domain correctness, production integration or measured quality.",
    "Only existing executable A/B ingestion is validated; unsupported recommended flow steps and missing adapters are not validated or executed."];
  if(targetId.startsWith("cmp_")){
    const c=await readComposition(userId,targetId);
    if(!c.caseId){
      const included=new Set(c.plan.decisions.filter((d:any)=>d.disposition==="included").map((d:any)=>d.solutionId));
      const contracts=c.sourceEvidence.filter((s:any)=>included.has(s.solutionId)).map((s:any)=>noteInputContract(`proposal:${s.solutionId}`,{id:s.solutionId,execution:s.execution},s.capabilities.filter((cap:any)=>c.plan.flow.some((f:any)=>f.sourceSolutionId===s.solutionId&&f.capabilityId===cap.id))));
      return {targetId,caseId:null,caseKind:"proposal",runnable:false,contracts,limitations:[...limitations,"Proposal-only inspection: selected catalog capabilities do not create an executable run. Unknown adapters remain unverified."]};
    }
    caseId=c.caseId;
    limitations.push(...(c.limitations??[]));
  }
  if(caseId.startsWith("cc_")){
    const c=await ownedConsolidationCase(userId,caseId);
    return {targetId,caseId,caseKind:"combined",runnable:false,contracts:[fixedInputContract(c.recipeId)],limitations};
  }
  // Explicit ownership check as well as request-local visibility, before buffering multipart bytes.
  const linked=await pool.query("SELECT user_id FROM compositions WHERE case_id=$1",[caseId]);
  if(linked.rows.some(r=>r.user_id!==userId))throw Object.assign(new Error("Case not found."),{status:404});
  const c=await getCase(caseId);
  if(!c)throw Object.assign(new Error("Case not found."),{status:404});
  const ctx=caseContext(c);
  return {targetId,caseId,caseKind:"case",runnable:ctx.base.execution==="live",contracts:[
    noteInputContract("A",ctx.base,versionACapabilities(ctx).active),
    noteInputContract("B",ctx.base,versionBCapabilities(c,ctx).active),
  ],limitations};
}
function fail(res:Response,error:unknown){
  if(error instanceof Error&&"status" in error&&typeof error.status==="number"){res.status(error.status).json({error:error.message});return;}
  throw error;
}
router.post("/workbench-inputs/:targetId/validate",async(req,res,next)=>{
  res.setHeader("Cache-Control","private, no-store");
  if(!req.user?.id){res.status(401).json({error:"Sign in to validate workbench input."});return;}
  try{
    const origin=new URL(req.get("origin")??req.get("referer")??"");
    const protocol=req.get("x-forwarded-proto")?.split(",")[0].trim()??req.protocol;
    if(origin.host!==req.get("host")||origin.protocol!==`${protocol}:`||req.get("sec-fetch-site")==="cross-site")throw new Error();
  }catch{res.status(403).json({error:"Same-origin requests are required."});return;}
  let target:Target;
  try{target=await targetFor(req.user.id,String(req.params.targetId));}catch(error){try{fail(res,error);}catch(unhandled){next(unhandled);}return;}
  upload(req,res,(error:unknown)=>{
    if(error){res.status(error instanceof multer.MulterError&&error.code==="LIMIT_FILE_SIZE"?413:400).json({error:error instanceof multer.MulterError&&error.code==="LIMIT_FILE_SIZE"?"File must be 256 KiB or smaller.":"Send exactly one multipart file named 'file', without additional fields.",contracts:target.contracts});return;}
    const file=req.file;
    if(!file){res.status(400).json({error:"Choose one UTF-8 .txt, .csv or .json input file.",contracts:target.contracts});return;}
    // Filename is display-only, never a filesystem/object path.
    const filename=file.originalname.split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f]/g,"").slice(0,200);
    const extension=filename.split(".").at(-1)?.toLowerCase();
    const result={...target,compatible:false,runnable:false,filename,format:extension??"unknown",normalizedInputText:null,recordCount:0,issues:[] as any[]};
    try{
      if(!["txt","csv","json"].includes(extension??""))throw new WorkbenchInputError("Unsupported file type. Export UTF-8 .txt notes, .csv or .json work-order records.",[{code:"unsupported_type",message:"PDF, spreadsheets, ZIPs, images and binary formats are not supported. Expected CSV/JSON fields: id,date,site,equipment,note."}]);
      let text:string;
      try{text=new TextDecoder("utf-8",{fatal:true}).decode(file.buffer);}catch{throw new WorkbenchInputError("File is not valid UTF-8 text.",[{code:"invalid_encoding",message:"Export UTF-8 text, CSV or JSON; UTF-16/binary files cannot be read by this ingestion."}]);}
      const parsed=validateEngineInput(text,target.contracts,extension as "txt"|"csv"|"json");
      res.json({...result,compatible:true,runnable:target.runnable,format:parsed.format,normalizedInputText:parsed.text,recordCount:parsed.recordCount});
    }catch(error){
      if(error instanceof WorkbenchInputError){res.status(error.status).json({...result,error:error.message,issues:error.issues});return;}
      next(error);
    }finally{file.buffer.fill(0);}
  });
});
export default router;
