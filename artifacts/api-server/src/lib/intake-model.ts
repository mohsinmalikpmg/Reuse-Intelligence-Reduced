import { z } from "zod";
import { createHash } from "node:crypto";

export const sourceId = z.enum(["problem", "prototype", "agent"]);
const text = z.string().max(80000);
const field = z.object({ value: text, reviewed: z.boolean(), changed: z.boolean() });
export const intakeModelSchema = z.object({
  profile: z.object({ problem: field, user: field, scope: field, outcome: field }),
  requirements: z.array(z.object({
    id: z.string().min(1).max(100), text: z.string().min(1).max(4000),
    sources: z.array(sourceId).max(3), reviewed: z.boolean(), changed: z.boolean(),
  })).max(60),
  capabilities: z.array(z.object({
    id: z.string().min(1).max(100), sourceId: sourceId.optional(),
    title: z.string().min(1).max(500), description: text, workflow: text, input: text, output: text, dependency: text,
    status: z.enum(["Described", "Inferred", "Needs clarification", "Confirmed"]),
    changed: z.boolean(), gap: text, carry: z.boolean(),
  })).max(40),
  sources: z.array(z.object({
    id: sourceId, name: z.string().max(200), text, files: z.array(z.string().max(100)).max(20),
    changed: z.boolean(), supplied: z.boolean().optional(),
  })).max(3),
  questions: z.array(z.object({ id: z.string().max(100), text: z.string().max(4000), answer: z.string().max(10000), acknowledged: z.boolean() })).max(20).default([]),
  orderReviewed: z.boolean(), safety: text.default(""), agreed: z.boolean(), confirmed: z.boolean(),
  interpretedHash: z.string().optional(),
}).superRefine((m, ctx) => {
  for (const [label, items] of [["sources", m.sources], ["requirements", m.requirements], ["capabilities", m.capabilities], ["questions", m.questions]] as const) {
    if (new Set(items.map(x => x.id)).size !== items.length) ctx.addIssue({ code: "custom", message: `Duplicate ${label} identifiers.` });
  }
});
export type IntakeModel = z.infer<typeof intakeModelSchema>;
export const blankModel = (): IntakeModel => ({
  profile: Object.fromEntries(["problem", "user", "scope", "outcome"].map(k => [k, { value: "", reviewed: false, changed: false }])) as IntakeModel["profile"],
  sources: [], requirements: [], capabilities: [], questions: [], orderReviewed: false, safety: "", agreed: false, confirmed: false,
});
export function sourceHash(m: IntakeModel) {
  return createHash("sha256").update(JSON.stringify(m.sources.map(s => ({ id: s.id, name: s.name, text: s.text, files: [...s.files].sort() })).sort((a,b) => a.id.localeCompare(b.id)))).digest("hex");
}
export function confirmationIssues(m: IntakeModel) {
  const issues: string[] = [];
  if (!m.interpretedHash || m.interpretedHash !== sourceHash(m)) issues.push("Interpret the latest saved inputs first.");
  if (!Object.values(m.profile).every(f => f.value.trim() && f.reviewed)) issues.push("Review all four shared-profile fields.");
  if (!m.requirements.length || m.requirements.some(r => !r.reviewed)) issues.push("Confirm each requirement.");
  if (!m.orderReviewed) issues.push("Agree on the priority order.");
  if (m.capabilities.some(c => c.status !== "Confirmed" || (c.gap.trim() && !c.carry))) issues.push("Review capabilities and acknowledge open gaps.");
  if (m.questions.some(q => !q.answer.trim() && !q.acknowledged)) issues.push("Answer or acknowledge each open question.");
  if (m.sources.some(s => s.changed)) issues.push("Review changed sources.");
  if (!m.agreed) issues.push("Agree that the profile accurately represents your intake.");
  return issues;
}
