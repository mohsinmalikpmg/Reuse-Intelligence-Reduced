import { Router, type IRouter } from "express";
import { z } from "zod";
import { featureRedundancy,featureRedundancyInput } from "../lib/feature-redundancy";
import { CompositionError } from "../lib/composition-contract";
import { AnalysisError } from "../lib/ai-analysis";
import { ConsolidationError } from "../lib/consolidation-recipes";
const router:IRouter=Router();
router.post("/feature-redundancy",async(req,res)=>{
  res.setHeader("Cache-Control","private, no-store");
  if(!req.user?.id) {res.status(401).json({error:"Sign in to analyze feature redundancy."});return;}
  try {
    const origin=new URL(req.get("origin")??req.get("referer")??"");
    const protocol=req.get("x-forwarded-proto")?.split(",")[0].trim()??req.protocol;
    if(origin.host!==req.get("host")||origin.protocol!==`${protocol}:`||req.get("sec-fetch-site")==="cross-site") throw new Error();
  } catch {res.status(403).json({error:"Same-origin requests are required."});return;}
  res.json(await featureRedundancy(req.user.id,featureRedundancyInput.parse(req.body)));
});
router.use((error:unknown,_req:import("express").Request,res:import("express").Response,next:import("express").NextFunction)=>{
  if(error instanceof z.ZodError) {res.status(400).json({error:error.message});return;}
  if(error instanceof CompositionError||error instanceof AnalysisError||error instanceof ConsolidationError) {res.status(error.status).json({error:error.message});return;}
  next(error);
});
export default router;
