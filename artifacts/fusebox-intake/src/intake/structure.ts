import type { Capability, Group, Model, Requirement } from './model';

/** Shared structured-review operations. Duplicated verbatim in fusebox-intake/src/intake (separate packages). */
export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export const newRequirement = (text: string, group = '', kind: Requirement['kind'] = 'functional'): Requirement =>
  ({ id: uid('need'), text, sources: [], reviewed: false, changed: true, provenance: 'Added by you', group, kind, acceptance: '', edited: true });
export const newCapability = (title: string, group = ''): Capability =>
  ({ id: uid('cap'), title, description: '', workflow: '', input: '', output: '', dependency: '', status: 'Needs clarification', changed: true, gap: '', carry: false, provenance: 'Added by you', group, requirementIds: [], edited: true });

const remapList = (ids: string[], remap: Record<string, string[]>) => [...new Set(ids.flatMap(i => (i in remap ? remap[i] : [i])))];

/** Replace or drop references to removed ids everywhere; append tombstones. Unaffected items keep their ids and edits. */
export function cleanRefs(m: Model, remap: Record<string, string[]>): Model {
  const gone = Object.keys(remap);
  const fix = (ids: string[]) => remapList(ids, remap);
  return {
    ...m,
    capabilities: m.capabilities.map(c => { const r = fix(c.requirementIds); return r.join() === c.requirementIds.join() ? c : { ...c, requirementIds: r, changed: true, carry: false, status: c.status === 'Confirmed' ? 'Needs clarification' as const : c.status }; }),
    coverage: m.coverage.map(c => { const r = fix(c.requirementIds), k = fix(c.capabilityIds); return r.join() === c.requirementIds.join() && k.join() === c.capabilityIds.join() ? c : { ...c, requirementIds: r, capabilityIds: k, reviewed: false, ...(!r.length && !k.length && c.disposition === 'accounted' ? { disposition: 'unresolved' as const, note: 'The linked items were removed. Clarify how this input should be accounted for.' } : {}) }; }),
    overlaps: m.overlaps.map(o => ({ ...o, itemIds: fix(o.itemIds) })).filter(o => o.itemIds.length > 1),
    questions: m.questions.map(q => { const r = fix(q.itemIds); return r.join() === q.itemIds.join() ? q : { ...q, itemIds: r }; }),
    removedItemIds: [...new Set([...m.removedItemIds, ...gone])],
  };
}

export function patchRequirement(m: Model, id: string, patch: Partial<Requirement>): Model {
  const textChanged = patch.text !== undefined && m.requirements.find(r => r.id === id)?.text !== patch.text;
  return { ...m, requirements: m.requirements.map(r => r.id === id ? { ...r, ...patch, edited: true, reviewed: false, changed: true } : r), orderReviewed: textChanged ? false : m.orderReviewed };
}
export function patchCapability(m: Model, id: string, patch: Partial<Capability>): Model {
  return { ...m, capabilities: m.capabilities.map(c => c.id === id ? { ...c, ...patch, edited: true, status: 'Needs clarification', changed: true, carry: false } : c) };
}
export function removeRequirement(m: Model, id: string): Model {
  return cleanRefs({ ...m, requirements: m.requirements.filter(r => r.id !== id), orderReviewed: false }, { [id]: [] });
}
export function removeCapability(m: Model, id: string): Model {
  return cleanRefs({ ...m, capabilities: m.capabilities.filter(c => c.id !== id) }, { [id]: [] });
}
export function splitRequirement(m: Model, id: string, parts: string[]): Model {
  const i = m.requirements.findIndex(r => r.id === id); if (i < 0 || parts.length < 2) return m;
  const src = m.requirements[i];
  const made = parts.map(t => ({ ...src, id: uid('need'), text: t, acceptance: '', reviewed: false, changed: true, edited: true, provenance: `Split from “${src.text.slice(0, 60)}”${src.provenance ? ` · ${src.provenance}` : ''}` }));
  const reqs = [...m.requirements]; reqs.splice(i, 1, ...made);
  return cleanRefs({ ...m, requirements: reqs, orderReviewed: false }, { [id]: made.map(r => r.id) });
}
export function mergeRequirements(m: Model, ids: string[], text: string): Model {
  const items = m.requirements.filter(r => ids.includes(r.id)); if (items.length < 2) return m;
  const first = items[0];
  const merged: Requirement = { ...first, id: uid('need'), text, sources: [...new Set(items.flatMap(r => r.sources))], acceptance: items.map(r => r.acceptance).filter(Boolean).join(' · '), reviewed: false, changed: true, edited: true, provenance: `Merged from ${items.length} needs` };
  const at = m.requirements.findIndex(r => r.id === first.id);
  const reqs = m.requirements.filter(r => !ids.includes(r.id)); reqs.splice(Math.min(at, reqs.length), 0, merged);
  return cleanRefs({ ...m, requirements: reqs, orderReviewed: false }, Object.fromEntries(ids.map(x => [x, [merged.id]])));
}
export function splitCapability(m: Model, id: string, titles: string[]): Model {
  const i = m.capabilities.findIndex(c => c.id === id); if (i < 0 || titles.length < 2) return m;
  const src = m.capabilities[i];
  const made = titles.map(t => ({ ...src, id: uid('cap'), title: t, status: 'Needs clarification' as const, changed: true, carry: false, edited: true, provenance: `Split from “${src.title}”` }));
  const caps = [...m.capabilities]; caps.splice(i, 1, ...made);
  return cleanRefs({ ...m, capabilities: caps }, { [id]: made.map(c => c.id) });
}
export function mergeCapabilities(m: Model, ids: string[], title: string): Model {
  const items = m.capabilities.filter(c => ids.includes(c.id)); if (items.length < 2) return m;
  const first = items[0];
  const join = (k: 'description' | 'workflow' | 'input' | 'output' | 'dependency' | 'gap') => items.map(c => c[k].trim()).filter(Boolean).join(' · ');
  const merged: Capability = { ...first, id: uid('cap'), title, description: join('description'), workflow: join('workflow'), input: join('input'), output: join('output'), dependency: join('dependency'), gap: join('gap'), carry: false, status: 'Needs clarification', changed: true, edited: true, requirementIds: [...new Set(items.flatMap(c => c.requirementIds))], provenance: `Merged from ${items.length} capabilities` };
  const at = m.capabilities.findIndex(c => c.id === first.id);
  const caps = m.capabilities.filter(c => !ids.includes(c.id)); caps.splice(Math.min(at, caps.length), 0, merged);
  return cleanRefs({ ...m, capabilities: caps }, Object.fromEntries(ids.map(x => [x, [merged.id]])));
}
export function toggleMapping(m: Model, capId: string, reqId: string): Model {
  return { ...m, capabilities: m.capabilities.map(c => c.id !== capId ? c : { ...c, edited: true, changed: true, status: c.status === 'Confirmed' ? 'Needs clarification' : c.status, requirementIds: c.requirementIds.includes(reqId) ? c.requirementIds.filter(x => x !== reqId) : [...c.requirementIds, reqId] }) };
}
export function addGroup(m: Model, title: string, boundary: string): Model {
  return { ...m, groups: [...m.groups, { id: uid('grp'), title, boundary }] };
}
export function patchGroup(m: Model, id: string, patch: Partial<Group>): Model {
  return { ...m, groups: m.groups.map(g => g.id === id ? { ...g, ...patch } : g), ...unreviewMembers(m, id, false) };
}
export function removeGroup(m: Model, id: string): Model {
  return { ...m, groups: m.groups.filter(g => g.id !== id), ...unreviewMembers(m, id, true) };
}
/** A group change alters the meaning of every member: members return to unreviewed. */
function unreviewMembers(m: Model, id: string, ungroup: boolean) {
  return {
    requirements: m.requirements.map(r => r.group === id ? { ...r, ...(ungroup ? { group: '' } : {}), edited: true, reviewed: false, changed: true } : r),
    capabilities: m.capabilities.map(c => c.group === id ? { ...c, ...(ungroup ? { group: '' } : {}), edited: true, changed: true, carry: false, status: c.status === 'Confirmed' ? 'Needs clarification' as const : c.status } : c),
  };
}

/** Derived analysis — only over what was supplied. */
export function analyse(m: Model) {
  const mapped = new Set(m.capabilities.flatMap(c => c.requirementIds));
  const unsupported = m.capabilities.length ? m.requirements.filter(r => r.kind === 'functional' && !mapped.has(r.id)) : [];
  const unclear = m.capabilities.filter(c => !c.requirementIds.length);
  return { unsupported, unclear };
}
