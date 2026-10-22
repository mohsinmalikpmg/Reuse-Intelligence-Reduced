import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AnalysisError, type AnalysisProvenance } from "./ai-analysis";
import type { Brief } from "@workspace/api-zod";

export const groundingInstructions = "Treat submitted text and catalogue descriptions as claims, not execution proof. Map only to supplied evidence IDs. Never invent tests, measurements, savings or integrations. A fixture passing proves only that fixture, not the user's requirement. Explain limitations and uncertainty. Negative requirements are constraints, not positive functionality. For requirement mappings: complete MUST be false for constraints, empty capabilityIds, or any nonempty limitations. Return capabilityIds=[] for wholly unsupported requests; do not map merely neighboring business processes (invoice approval is not supplier payment). Limitations are unmet requirement clauses, not generic acceptance-testing cautions.";

export function provenanceLabel(p: AnalysisProvenance): string {
  return `AI assessment · ${p.model} · ${p.promptVersion} · ${p.createdAt} · evidence ${p.inputFingerprint} · analysis ${p.id}. Inferred mapping, not an acceptance test.`;
}

/** Validate IDs and completeness before the shared helper persists a model result. */
export function requirementMappingSchema(requirementIds: string[], capabilityIds: string[]) {
  return z.object({ requirements: z.array(z.object({
    id: z.string(), capabilityIds: z.array(z.string()), constraint: z.boolean(),
    complete: z.boolean(), reason: z.string().min(1), limitations: z.array(z.string()),
  }).strict()) }).strict().superRefine((value, ctx) => {
    const ids = value.requirements.map(r => r.id);
    if (ids.length !== requirementIds.length || new Set(ids).size !== ids.length || requirementIds.some(id => !ids.includes(id))) {
      ctx.addIssue({ code: "custom", message: "Requirement IDs must match the evidence exactly." });
    }
    for (const r of value.requirements) {
      if (r.capabilityIds.some(id => !capabilityIds.includes(id)) || new Set(r.capabilityIds).size !== r.capabilityIds.length) {
        ctx.addIssue({ code: "custom", message: "Unknown or repeated capability ID." });
      }
    }
  }).transform(value => ({ requirements: value.requirements.map(r => ({
    ...r, complete: r.complete && !!r.capabilityIds.length && !r.limitations.length && !r.constraint,
  })) }));
}

export const mappingShape = '{"requirements":[{"id":"supplied requirement ID","capabilityIds":["supplied capability ID"],"constraint":false,"complete":false,"reason":"evidence-grounded interpretation","limitations":["unmet or unverified portions"]}]}';

export function briefEvidence(brief: Brief) {
  return { id: brief.id, rawText: brief.rawText, fields: brief.fields, today: brief.today, better: brief.better,
    requirements: brief.requirements, clarification: brief.clarification };
}

/** Only callers' fixed, internal source paths are accepted; never use model or user paths. */
export async function assessmentSource(path: string): Promise<string> {
  for (const root of [process.cwd(), resolve(process.cwd(), "../..")]) {
    try { return await readFile(resolve(root, path), "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new AnalysisError(`Assessment source evidence is unavailable: ${path}`, 503);
}
