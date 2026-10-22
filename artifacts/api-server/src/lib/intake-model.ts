import { z } from "zod";
import { createHash } from "node:crypto";

export const sourceId = z.enum(["problem", "prototype", "agent"]);
const text = z.string().max(80000);
const id = z.string().min(1).max(100);
const field = z.object({ value: text, reviewed: z.boolean(), changed: z.boolean(), basis: z.enum(["explicit", "inferred", "unknown"]).optional(), provenance: text.optional() });
export const intakeModelSchema = z.object({
  name: z.object({ value: z.string().trim().min(1).max(200), origin: z.enum(["generated", "manual"]), provenance: text }).optional(),
  groups: z.array(z.object({ id, title: z.string().min(1).max(500), boundary: text })).max(100).optional(),
  coverage: z.array(z.object({ id, sourceId, excerpt: text, disposition: z.enum(["accounted", "unresolved", "out-of-scope"]), requirementIds: z.array(id), capabilityIds: z.array(id), note: text, reviewed: z.boolean() })).max(200).optional(),
  overlaps: z.array(z.object({ id, itemIds: z.array(id).min(2), note: text, resolved: z.boolean() })).max(100).optional(),
  removedItemIds: z.array(id).max(500).optional(),
  profile: z.object({ problem: field, user: field, scope: field, outcome: field }),
  requirements: z.array(z.object({
    id: z.string().min(1).max(100), text: z.string().min(1).max(4000),
    sources: z.array(sourceId).max(3), reviewed: z.boolean(), changed: z.boolean(),
    group: id.optional(), kind: z.enum(["functional", "constraint"]).optional(), acceptance: text.optional(), provenance: text.optional(), edited: z.boolean().optional(),
  })).max(60),
  capabilities: z.array(z.object({
    id: z.string().min(1).max(100), sourceId: sourceId.optional(),
    title: z.string().min(1).max(500), description: text, workflow: text, input: text, output: text, dependency: text,
    status: z.enum(["Described", "Inferred", "Needs clarification", "Confirmed"]),
    changed: z.boolean(), gap: text, carry: z.boolean(),
    group: id.optional(), requirementIds: z.array(id).optional(), provenance: text.optional(), edited: z.boolean().optional(),
  })).max(40),
  sources: z.array(z.object({
    id: sourceId, name: z.string().max(200), text, files: z.array(z.string().max(100)).max(20),
    changed: z.boolean(), supplied: z.boolean().optional(),
  })).max(3),
  questions: z.array(z.object({ id: z.string().min(1).max(100), text: z.string().max(4000), answer: z.string().max(10000), acknowledged: z.boolean(), itemIds: z.array(id).optional() })).max(20).default([]),
  orderReviewed: z.boolean(), safety: text.default(""), agreed: z.boolean(), confirmed: z.boolean(),
  interpretedHash: z.string().optional(),
}).superRefine((m, ctx) => {
  for (const [label, items] of [["sources", m.sources], ["requirements", m.requirements], ["capabilities", m.capabilities], ["questions", m.questions], ["groups", m.groups ?? []], ["coverage", m.coverage ?? []], ["overlaps", m.overlaps ?? []]] as const) {
    if (new Set(items.map(x => x.id)).size !== items.length) ctx.addIssue({ code: "custom", message: `Duplicate ${label} identifiers.` });
  }
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const reqs = new Set(m.requirements.map(r => r.id)), caps = new Set(m.capabilities.map(c => c.id));
  const items = new Set([...reqs, ...caps]), groups = new Set(m.groups?.map(g => g.id));
  if (items.size !== reqs.size + caps.size) fail("Requirement and capability identifiers must be distinct.");
  for (const r of [...m.requirements, ...m.capabilities]) if (r.group && !groups.has(r.group)) fail(`Unknown group ${r.group}.`);
  const refs = (ids: string[], allowed: Set<string>) => {
    if (new Set(ids).size !== ids.length) fail("Duplicate reference identifiers.");
    for (const ref of ids) if (!allowed.has(ref)) fail(`Unknown item reference ${ref}.`);
  };
  for (const c of m.capabilities) refs(c.requirementIds ?? [], reqs);
  for (const c of m.coverage ?? []) {
    refs(c.requirementIds, reqs); refs(c.capabilityIds, caps);
    if (!m.sources.some(s => s.id === c.sourceId)) fail(`Unknown coverage source ${c.sourceId}.`);
    if (c.disposition === "accounted" && !c.requirementIds.length && !c.capabilityIds.length) fail("Accounted coverage must reference an item.");
  }
  for (const o of m.overlaps ?? []) refs(o.itemIds, items);
  for (const q of m.questions) refs(q.itemIds ?? [], new Set([...items, ...Object.keys(m.profile)]));
  if (new Set(m.removedItemIds).size !== (m.removedItemIds ?? []).length) fail("Duplicate removed identifiers.");
  if (m.removedItemIds?.some(id => items.has(id))) fail("Removed items cannot remain active.");
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
  if (m.groups !== undefined) {
    const groups = new Map(m.groups.map(g => [g.id, g]));
    if ([...m.requirements, ...m.capabilities].some(item => !item.group?.trim() || !groups.get(item.group)?.title.trim() || !groups.get(item.group)?.boundary.trim())) {
      issues.push("Assign each requirement and capability exactly one primary group with a nonempty title and boundary.");
    }
    if (m.groups.some(g => !g.title.trim() || !g.boundary.trim())) issues.push("Complete every group title and boundary.");
  }
  if (!m.interpretedHash || m.interpretedHash !== sourceHash(m)) issues.push("Interpret the latest saved inputs first.");
  if (!Object.values(m.profile).every(f => f.value.trim() && f.reviewed)) issues.push("Review all four shared-profile fields.");
  if (!m.requirements.length || m.requirements.some(r => !r.reviewed)) issues.push("Confirm each requirement.");
  if (!m.orderReviewed) issues.push("Agree on the priority order.");
  if (m.capabilities.some(c => c.status !== "Confirmed" || (c.gap.trim() && !c.carry))) issues.push("Review capabilities and acknowledge open gaps.");
  if (m.questions.some(q => !q.answer.trim() && !q.acknowledged)) issues.push("Answer or acknowledge each open question.");
  if (m.sources.some(s => s.changed)) issues.push("Review changed sources.");
  if (!m.agreed) issues.push("Agree that the profile accurately represents your intake.");
  if (m.coverage?.some(c => !c.reviewed)) issues.push("Review source coverage and acknowledge unresolved or out-of-scope material.");
  if (m.overlaps?.some(o => !o.resolved)) issues.push("Resolve each overlapping item boundary.");
  return issues;
}
