import { intakeModelSchema, sourceHash, type IntakeModel } from "./intake-model";

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function withLegacyName(model: IntakeModel, title: string): IntakeModel {
  return !model.name && title.trim() ? { ...model, name: { value: title.trim(), origin: "manual", provenance: "Previously saved intake title." } } : model;
}

/** Detect edits on the server too: older clients do not send edited flags. */
export function trackIntakeEdits(model: IntakeModel, old: IntakeModel) {
  const affected = new Set<string>();
  for (const key of Object.keys(model.profile) as (keyof IntakeModel["profile"])[]) {
    if (model.profile[key].value !== old.profile[key].value) {
      model.profile[key].provenance = "User-edited shared profile.";
      affected.add(key);
    } else if (old.profile[key].provenance?.startsWith("User-edited")) model.profile[key].provenance = old.profile[key].provenance;
  }
  const reqContent = (r: IntakeModel["requirements"][number]) => [r.text, r.sources, r.group ?? "", r.kind ?? "functional", r.acceptance ?? ""];
  const capContent = (c: IntakeModel["capabilities"][number]) => [c.title, c.description, c.workflow, c.input, c.output, c.dependency, c.group ?? "", c.requirementIds ?? [], c.gap];
  for (const r of model.requirements) {
    const before = old.requirements.find(x => x.id === r.id);
    if (!before || !equal(reqContent(r), reqContent(before))) { r.edited = true; affected.add(r.id); }
    else if (before.edited) r.edited = true;
  }
  for (const c of model.capabilities) {
    const before = old.capabilities.find(x => x.id === c.id);
    if (!before || !equal(capContent(c), capContent(before))) { c.edited = true; affected.add(c.id); }
    else if (before.edited) c.edited = true;
  }
  const live = new Set([...model.requirements, ...model.capabilities].map(x => x.id));
  model.removedItemIds = [...new Set([...(old.removedItemIds ?? []), ...(model.removedItemIds ?? []), ...[...old.requirements, ...old.capabilities].filter(x => !live.has(x.id)).map(x => x.id)])];
  for (const q of model.questions) {
    const before = old.questions.find(x => x.id === q.id);
    if (before && before.answer !== q.answer) for (const id of new Set([...(q.itemIds ?? []), ...(before.itemIds ?? [])])) affected.add(id);
  }
  const semanticAffected = new Set(affected);
  const changedGroups = new Set((model.groups ?? []).filter(g => {
    const before = old.groups?.find(x => x.id === g.id);
    return !before || before.title !== g.title || before.boundary !== g.boundary;
  }).map(g => g.id));
  for (const item of [...model.requirements, ...model.capabilities]) if (item.group && changedGroups.has(item.group)) affected.add(item.id);
  for (const r of model.requirements) if (affected.has(r.id)) { r.reviewed = false; r.changed = true; }
  for (const c of model.capabilities) if (affected.has(c.id) || c.requirementIds?.some(id => semanticAffected.has(id))) { c.status = "Needs clarification"; c.changed = true; c.carry = false; affected.add(c.id); }
  for (const key of Object.keys(model.profile) as (keyof IntakeModel["profile"])[]) if (affected.has(key)) { model.profile[key].reviewed = false; model.profile[key].changed = true; }
  for (const c of model.coverage ?? []) if ([...c.requirementIds, ...c.capabilityIds].some(id => affected.has(id))) c.reviewed = false;
  for (const o of model.overlaps ?? []) if (o.itemIds.some(id => affected.has(id))) o.resolved = false;
  if (affected.size || changedGroups.size || !equal(old.removedItemIds ?? [], model.removedItemIds ?? [])) model.agreed = false;
}

export function reconcileInterpretation(old: IntakeModel, generated: IntakeModel, regenerateName = false): IntakeModel {
  if (regenerateName && old.interpretedHash !== sourceHash(old)) throw new Error("Interpretation of the latest inputs is required before regenerating only the name.");
  if (regenerateName && old.interpretedHash === sourceHash(old)) {
    if (!generated.name) throw new Error("Interpretation did not return a generated name.");
    return intakeModelSchema.parse({ ...old, name: { ...generated.name, origin: "generated" } });
  }
  const m = structuredClone(generated);
  const changed = new Set(old.sources.filter(s => s.changed).map(s => s.id));
  for (const r of old.requirements) for (const sid of r.sources) if (!old.sources.some(s => s.id === sid)) changed.add(sid);
  for (const c of old.capabilities) if (c.sourceId && !old.sources.some(s => s.id === c.sourceId)) changed.add(c.sourceId);
  const removed = new Set(old.removedItemIds ?? []);
  const remap = new Map<string, string>();
  const preserveRequirement = (r: IntakeModel["requirements"][number]) =>
    r.sources.some(s => changed.has(s)) || (r.changed && !r.reviewed)
      ? { ...r, reviewed: false, changed: true } : { ...r };
  const preserveCapability = (c: IntakeModel["capabilities"][number]) =>
    changed.has(c.sourceId ?? "prototype") || c.requirementIds?.some(id => old.requirements.some(r => r.id === id && r.sources.some(s => changed.has(s)))) || (c.changed && c.status !== "Confirmed")
      ? { ...c, status: "Needs clarification" as const, changed: true, carry: false } : { ...c };
  for (const key of Object.keys(m.profile) as (keyof IntakeModel["profile"])[]) {
    const before = old.profile[key];
    m.profile[key] = before.provenance?.startsWith("User-edited") || (before.reviewed && !changed.size)
      ? { ...before, ...(changed.size ? { reviewed: false, changed: true } : {}) } : { ...m.profile[key], reviewed: false, changed: true };
  }
  m.requirements = m.requirements.filter(r => !removed.has(r.id)).map(r => {
    const before = old.requirements.find(x => x.id === r.id || x.text.trim().toLowerCase() === r.text.trim().toLowerCase());
    if (before) remap.set(r.id, before.id);
    if (before && (before.edited || ((before.reviewed || !before.changed) && !before.sources.some(s => changed.has(s))))) return preserveRequirement(before);
    return { ...r, id: before?.id ?? r.id, edited: false, reviewed: false, changed: true };
  });
  for (const r of old.requirements) if (!removed.has(r.id) && (r.edited || !r.sources.some(s => changed.has(s))) && !m.requirements.some(x => x.id === r.id)) m.requirements.push(preserveRequirement(r));
  m.capabilities = m.capabilities.filter(c => !removed.has(c.id)).map(c => {
    const before = old.capabilities.find(x => x.id === c.id || x.title.trim().toLowerCase() === c.title.trim().toLowerCase());
    if (before) remap.set(c.id, before.id);
    if (before && (before.edited || ((before.status === "Confirmed" || !before.changed) && !changed.has(before.sourceId ?? "prototype")))) return preserveCapability(before);
    return { ...c, id: before?.id ?? c.id, edited: false, status: c.status === "Confirmed" ? "Inferred" as const : c.status, changed: true, carry: false };
  });
  for (const c of old.capabilities) if (!removed.has(c.id) && (c.edited || !changed.has(c.sourceId ?? "prototype")) && !m.capabilities.some(x => x.id === c.id)) m.capabilities.push(preserveCapability(c));
  const reqs = new Set(m.requirements.map(r => r.id)), caps = new Set(m.capabilities.map(c => c.id));
  const map = (ids: string[], allowed: Set<string>) => [...new Set(ids.map(id => remap.get(id) ?? id).filter(id => allowed.has(id)))];
  m.capabilities = m.capabilities.map(c => ({ ...c, requirementIds: map(c.requirementIds ?? [], reqs) }));
  const affectedItems = new Set([
    ...m.requirements.filter(r => r.changed && !r.reviewed),
    ...m.capabilities.filter(c => c.changed && c.status !== "Confirmed"),
  ].map(x => x.id));
  const items = new Set([...reqs, ...caps]);
  m.coverage = (m.coverage ?? []).map(c => {
    const next = { ...c, requirementIds: map(c.requirementIds, reqs), capabilityIds: map(c.capabilityIds, caps), reviewed: false };
    if (next.disposition === "accounted" && !next.requirementIds.length && !next.capabilityIds.length) { next.disposition = "unresolved"; next.note = "Previously mapped items were removed. Review this source material."; }
    const before = old.coverage?.find(x => x.id === c.id || (x.sourceId === c.sourceId && x.excerpt === c.excerpt));
    if (before && !changed.has(c.sourceId) && ![...next.requirementIds, ...next.capabilityIds].some(id => affectedItems.has(id)) && equal({ ...before, id: next.id, reviewed: false }, next)) return { ...next, id: before.id, reviewed: before.reviewed };
    return next;
  });
  for (const before of old.coverage ?? []) if (old.sources.some(s => s.id === before.sourceId) && !changed.has(before.sourceId) && !m.coverage.some(c => c.id === before.id || (c.sourceId === before.sourceId && c.excerpt === before.excerpt))) {
    const c = { ...before, requirementIds: map(before.requirementIds, reqs), capabilityIds: map(before.capabilityIds, caps) };
    if (c.disposition === "accounted" && !c.requirementIds.length && !c.capabilityIds.length) { c.disposition = "unresolved"; c.reviewed = false; }
    if ([...c.requirementIds, ...c.capabilityIds].some(id => affectedItems.has(id))) c.reviewed = false;
    m.coverage.push(c);
  }
  m.overlaps = (m.overlaps ?? []).map(o => ({ ...o, itemIds: map(o.itemIds, items), resolved: false })).filter(o => o.itemIds.length > 1).map(o => {
    const before = old.overlaps?.find(x => x.id === o.id);
    return before && equal(before.itemIds, o.itemIds) && before.note === o.note && !o.itemIds.some(id => affectedItems.has(id)) ? before : o;
  });
  for (const o of old.overlaps ?? []) if (!m.overlaps.some(x => x.id === o.id)) {
    const itemIds = map(o.itemIds, items);
    const affected = itemIds.some(id => affectedItems.has(id));
    if (itemIds.length > 1) m.overlaps.push({ ...o, itemIds, resolved: affected ? false : o.resolved });
  }
  m.questions = m.questions.map(q => {
    const before = old.questions.find(x => x.id === q.id || x.text === q.text);
    return { ...q, id: before?.id ?? q.id, answer: before?.answer ?? "", acknowledged: before?.acknowledged ?? false, itemIds: map(q.itemIds ?? [], new Set([...items, ...Object.keys(m.profile)])) };
  });
  for (const q of old.questions) if ((q.answer.trim() || q.acknowledged) && !m.questions.some(x => x.id === q.id || x.text === q.text)) {
    m.questions.push({ ...q, itemIds: map(q.itemIds ?? [], new Set([...items, ...Object.keys(m.profile)])) });
  }
  // Group metadata has no edited flag in the public contract. Existing boundaries
  // are authoritative; AI may add new groups but cannot overwrite saved ones.
  m.groups = (m.groups ?? []).map(g => old.groups?.find(x => x.id === g.id) ?? g);
  for (const g of old.groups ?? []) if (!m.groups.some(x => x.id === g.id)) m.groups.push(g);
  const order = new Map(old.requirements.map((r, i) => [r.id, i]));
  // Upgrade retained legacy content with the grouping for the same concept.
  // Never replace its reviewed wording merely to acquire new metadata.
  for (const item of [...m.requirements, ...m.capabilities]) if (!item.group) {
    const proposed = "text" in item
      ? generated.requirements.find(r => r.id === item.id || r.text.trim().toLowerCase() === item.text.trim().toLowerCase())
      : generated.capabilities.find(c => c.id === item.id || c.title.trim().toLowerCase() === item.title.trim().toLowerCase());
    if (proposed?.group) item.group = proposed.group;
    else {
      let retained = m.groups.find(g => g.id === "retained-legacy-items");
      if (!retained) {
        retained = { id: "retained-legacy-items", title: "Retained items — classification unresolved", boundary: "Only previously reviewed items omitted from this interpretation; excludes items assigned to the other groups." };
        m.groups.push(retained);
      }
      item.group = retained.id;
    }
  }
  m.requirements.sort((a, b) => (order.get(a.id) ?? 1000) - (order.get(b.id) ?? 1000));
  m.orderReviewed = old.orderReviewed && equal(m.requirements.map(r => r.id), old.requirements.map(r => r.id));
  if (old.name?.origin === "manual" && !regenerateName) m.name = old.name;
  else if (m.name) m.name.origin = "generated";
  m.sources = old.sources.map(s => ({ ...s, changed: false }));
  m.removedItemIds = old.removedItemIds;
  m.interpretedHash = sourceHash(old);
  m.agreed = false; m.confirmed = false;
  return intakeModelSchema.parse(m);
}
