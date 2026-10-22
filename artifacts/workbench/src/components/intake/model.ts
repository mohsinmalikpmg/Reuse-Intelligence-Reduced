export type SourceId = 'problem' | 'prototype' | 'agent';
export type ProfileKey = 'problem' | 'user' | 'scope' | 'outcome';
export type Basis = 'explicit' | 'inferred' | 'unknown';
export type Field = { value: string; reviewed: boolean; changed: boolean; provenance?: string; basis?: Basis };
export type ReqKind = 'functional' | 'constraint';
export type Requirement = { id: string; text: string; sources: SourceId[]; reviewed: boolean; changed: boolean; provenance?: string; group: string; kind: ReqKind; acceptance: string; edited: boolean };
export type Group = { id: string; title: string; boundary: string };
export type Disposition = 'accounted' | 'unresolved' | 'out-of-scope';
export type Coverage = { id: string; sourceId: SourceId; excerpt: string; disposition: Disposition; requirementIds: string[]; capabilityIds: string[]; note: string; reviewed: boolean };
export type Overlap = { id: string; itemIds: string[]; note: string; resolved: boolean };
export type Name = { value: string; origin: 'generated' | 'manual'; provenance: string };
export type CapStatus = 'Described' | 'Inferred' | 'Needs clarification' | 'Confirmed';
export type Capability = { id: string; sourceId?: SourceId; title: string; description: string; workflow: string; input: string; output: string; dependency: string; status: CapStatus; changed: boolean; gap: string; carry: boolean; provenance?: string; group: string; requirementIds: string[]; edited: boolean };
export type Source = { id: SourceId; name: string; text: string; files: string[]; changed: boolean; supplied: boolean };
export type Question = { id: string; text: string; answer: string; acknowledged: boolean; provenance?: string; itemIds: string[] };
export type Model = { profile: Record<ProfileKey, Field>; requirements: Requirement[]; capabilities: Capability[]; sources: Source[]; orderReviewed: boolean; safety: string; agreed: boolean; confirmed: boolean; questions: Question[]; name?: Name; groups: Group[]; /** Local-only: the saved record predates grouping (no `groups` key). Never sent to the API. */ legacyGroups?: boolean; coverage: Coverage[]; overlaps: Overlap[]; removedItemIds: string[] };

export const SOURCE_IDS: SourceId[] = ['problem', 'prototype', 'agent'];
export const PROFILE_KEYS: ProfileKey[] = ['problem', 'user', 'scope', 'outcome'];
export const labels: Record<ProfileKey, string> = { problem: 'Today · the problem', user: 'Who needs this', scope: 'In scope · and out', outcome: 'Better · the outcome' };
export const sourceLabels: Record<SourceId, string> = { problem: 'Business problem', prototype: 'Prototype / solution', agent: 'Configured agent' };

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const bool = (v: unknown) => v === true;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isSource = (v: unknown): v is SourceId => v === 'problem' || v === 'prototype' || v === 'agent';
const prov = (o: Record<string, unknown>) => (typeof o.provenance === 'string' && o.provenance ? { provenance: o.provenance } : {});
const strs = (v: unknown) => arr(v).filter((x): x is string => typeof x === 'string');
const basis = (v: unknown) => (v === 'explicit' || v === 'inferred' || v === 'unknown' ? { basis: v as Basis } : {});
const DISPOSITIONS: Disposition[] = ['accounted', 'unresolved', 'out-of-scope'];
const STATUSES: CapStatus[] = ['Described', 'Inferred', 'Needs clarification', 'Confirmed'];

export function normalizeModel(raw: unknown): Model {
  const m = obj(raw);
  const p = obj(m.profile);
  const profile = Object.fromEntries(PROFILE_KEYS.map(k => { const f = obj(p[k]); return [k, { value: str(f.value), reviewed: bool(f.reviewed), changed: bool(f.changed), ...prov(f), ...basis(f.basis) }]; })) as Record<ProfileKey, Field>;
  const rawSources = arr(m.sources).map(obj);
  const sources = SOURCE_IDS.map(id => {
    const s = rawSources.find(x => x.id === id) ?? {};
    return { id, name: str(s.name), text: str(s.text), files: arr(s.files).filter((f): f is string => typeof f === 'string'), changed: bool(s.changed), supplied: bool(s.supplied) };
  });
  return {
    profile, sources,
    requirements: arr(m.requirements).map(obj).map((r, i) => ({ id: str(r.id) || `req-${i}`, text: str(r.text), sources: arr(r.sources).filter(isSource), reviewed: bool(r.reviewed), changed: bool(r.changed), ...prov(r), group: str(r.group), kind: r.kind === 'constraint' ? 'constraint' as const : 'functional' as const, acceptance: str(r.acceptance), edited: bool(r.edited) })),
    capabilities: arr(m.capabilities).map(obj).map((c, i) => ({ id: str(c.id) || `cap-${i}`, ...(isSource(c.sourceId) ? { sourceId: c.sourceId } : {}), title: str(c.title), description: str(c.description), workflow: str(c.workflow), input: str(c.input), output: str(c.output), dependency: str(c.dependency), status: STATUSES.includes(c.status as CapStatus) ? (c.status as CapStatus) : 'Inferred', changed: bool(c.changed), gap: str(c.gap), carry: bool(c.carry), ...prov(c), group: str(c.group), requirementIds: strs(c.requirementIds), edited: bool(c.edited) })),
    questions: arr(m.questions).map(obj).map((q, i) => ({ id: str(q.id) || `q-${i}`, text: str(q.text), answer: str(q.answer), acknowledged: bool(q.acknowledged), ...prov(q), itemIds: strs(q.itemIds) })),
    orderReviewed: bool(m.orderReviewed), safety: str(m.safety), agreed: bool(m.agreed), confirmed: bool(m.confirmed),
    ...(() => { const n = obj(m.name); return str(n.value).trim() ? { name: { value: str(n.value), origin: n.origin === 'manual' ? 'manual' as const : 'generated' as const, provenance: str(n.provenance) } } : {}; })(),
    groups: arr(m.groups).map(obj).map((g, i) => ({ id: str(g.id) || `grp-${i}`, title: str(g.title), boundary: str(g.boundary) })),
    coverage: arr(m.coverage).map(obj).map((c, i) => ({ id: str(c.id) || `cov-${i}`, sourceId: isSource(c.sourceId) ? c.sourceId : 'problem' as SourceId, excerpt: str(c.excerpt), disposition: DISPOSITIONS.includes(c.disposition as Disposition) ? c.disposition as Disposition : 'unresolved', requirementIds: strs(c.requirementIds), capabilityIds: strs(c.capabilityIds), note: str(c.note), reviewed: bool(c.reviewed) })),
    overlaps: arr(m.overlaps).map(obj).map((o, i) => ({ id: str(o.id) || `ovl-${i}`, itemIds: strs(o.itemIds), note: str(o.note), resolved: bool(o.resolved) })),
    removedItemIds: strs(m.removedItemIds),
    ...(Array.isArray(m.groups) ? {} : { legacyGroups: true }),
  };
}

export const hasInterpretation = (m: Model) => m.requirements.length > 0 || m.capabilities.length > 0 || PROFILE_KEYS.some(k => m.profile[k].value.trim());
export const hasSourceMaterial = (m: Model) => m.sources.some(s => s.text.trim() || s.files.length);

/** Every group needs a title and boundary; every need and capability needs a valid primary group. */
export function groupIssues(m: Model): string[] {
  // Legacy records (saved before grouping existed) stay exempt until a group is added or a re-interpretation returns groups.
  if (m.legacyGroups && m.groups.length === 0) return [];
  const ids = new Set(m.groups.map(g => g.id));
  const out: string[] = [];
  const bad = m.groups.filter(g => !g.title.trim() || !g.boundary.trim()).length;
  if (bad) out.push(`${bad} ${bad === 1 ? 'group needs' : 'groups need'} a title and a boundary.`);
  const r = m.requirements.filter(x => !ids.has(x.group)).length;
  if (r) out.push(`${r} ${r === 1 ? 'need has' : 'needs have'} no valid primary group.`);
  const c = m.capabilities.filter(x => !ids.has(x.group)).length;
  if (c) out.push(`${c} ${c === 1 ? 'capability has' : 'capabilities have'} no valid primary group.`);
  return out;
}

/** API payload: drops local-only flags and preserves the absence of `groups` on legacy records with no grouping. */
export function serializeModel(m: Model): Record<string, unknown> {
  const { legacyGroups, ...rest } = m;
  const withoutEmptyGroup = <T extends { group: string }>(item: T) => {
    const { group, ...fields } = item;
    return group.trim() ? { ...fields, group } : fields;
  };
  const payload = { ...rest, requirements: rest.requirements.map(withoutEmptyGroup), capabilities: rest.capabilities.map(withoutEmptyGroup) };
  if (legacyGroups && payload.groups.length === 0) { const { groups: _omit, ...noGroups } = payload; void _omit; return noGroups; }
  return payload;
}

export function readiness(m: Model) {
  const profileReady = PROFILE_KEYS.every(k => m.profile[k].reviewed && m.profile[k].value.trim());
  const needsReady = m.requirements.length > 0 && m.requirements.every(r => r.reviewed) && m.orderReviewed;
  const capsReady = m.capabilities.every(c => c.status === 'Confirmed' && (!c.gap.trim() || c.carry));
  const questionsReady = m.questions.every(q => q.answer.trim() || q.acknowledged);
  const sourcesReady = m.sources.every(s => !s.changed);
  /** Every supplied-input excerpt has been read and dispositioned; every overlap is resolved. */
  const structureReady = m.coverage.every(c => c.reviewed) && m.overlaps.every(o => o.resolved);
  const groupsReady = groupIssues(m).length === 0;
  return { profileReady, needsReady, capsReady, questionsReady, sourcesReady, structureReady, groupsReady, ready: profileReady && needsReady && capsReady && questionsReady && sourcesReady && structureReady && groupsReady };
}

export const errorStatus = (e: unknown) => (e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number' ? (e as { status: number }).status : 0);
export const errorMessage = (e: unknown) => {
  const d = e && typeof e === 'object' && 'data' in e ? obj((e as { data: unknown }).data) : {};
  if (typeof d.error === 'string') return d.error;
  return e instanceof Error ? e.message : 'Something went wrong.';
};
export const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;

/** Display state for the intake name: never fabricates a label. */
export const displayName = (m: Model, title: string) => (m.name?.value.trim() || title.trim());
export const NAME_PENDING = 'Name suggested after interpretation';
