export type SourceId = 'problem' | 'prototype' | 'agent';
export type ProfileKey = 'problem' | 'user' | 'scope' | 'outcome';
export type Field = { value: string; reviewed: boolean; changed: boolean; provenance?: string };
export type Requirement = { id: string; text: string; sources: SourceId[]; reviewed: boolean; changed: boolean; provenance?: string };
export type CapStatus = 'Described' | 'Inferred' | 'Needs clarification' | 'Confirmed';
export type Capability = { id: string; sourceId?: SourceId; title: string; description: string; workflow: string; input: string; output: string; dependency: string; status: CapStatus; changed: boolean; gap: string; carry: boolean; provenance?: string };
export type Source = { id: SourceId; name: string; text: string; files: string[]; changed: boolean; supplied: boolean };
export type Question = { id: string; text: string; answer: string; acknowledged: boolean; provenance?: string };
export type Model = { profile: Record<ProfileKey, Field>; requirements: Requirement[]; capabilities: Capability[]; sources: Source[]; orderReviewed: boolean; safety: string; agreed: boolean; confirmed: boolean; questions: Question[] };

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
const STATUSES: CapStatus[] = ['Described', 'Inferred', 'Needs clarification', 'Confirmed'];

export function normalizeModel(raw: unknown): Model {
  const m = obj(raw);
  const p = obj(m.profile);
  const profile = Object.fromEntries(PROFILE_KEYS.map(k => { const f = obj(p[k]); return [k, { value: str(f.value), reviewed: bool(f.reviewed), changed: bool(f.changed), ...prov(f) }]; })) as Record<ProfileKey, Field>;
  const rawSources = arr(m.sources).map(obj);
  const sources = SOURCE_IDS.map(id => {
    const s = rawSources.find(x => x.id === id) ?? {};
    return { id, name: str(s.name), text: str(s.text), files: arr(s.files).filter((f): f is string => typeof f === 'string'), changed: bool(s.changed), supplied: bool(s.supplied) };
  });
  return {
    profile, sources,
    requirements: arr(m.requirements).map(obj).map((r, i) => ({ id: str(r.id) || `req-${i}`, text: str(r.text), sources: arr(r.sources).filter(isSource), reviewed: bool(r.reviewed), changed: bool(r.changed), ...prov(r) })),
    capabilities: arr(m.capabilities).map(obj).map((c, i) => ({ id: str(c.id) || `cap-${i}`, ...(isSource(c.sourceId) ? { sourceId: c.sourceId } : {}), title: str(c.title), description: str(c.description), workflow: str(c.workflow), input: str(c.input), output: str(c.output), dependency: str(c.dependency), status: STATUSES.includes(c.status as CapStatus) ? (c.status as CapStatus) : 'Inferred', changed: bool(c.changed), gap: str(c.gap), carry: bool(c.carry), ...prov(c) })),
    questions: arr(m.questions).map(obj).map((q, i) => ({ id: str(q.id) || `q-${i}`, text: str(q.text), answer: str(q.answer), acknowledged: bool(q.acknowledged), ...prov(q) })),
    orderReviewed: bool(m.orderReviewed), safety: str(m.safety), agreed: bool(m.agreed), confirmed: bool(m.confirmed),
  };
}

export const hasInterpretation = (m: Model) => m.requirements.length > 0 || m.capabilities.length > 0 || PROFILE_KEYS.some(k => m.profile[k].value.trim());
export const hasSourceMaterial = (m: Model) => m.sources.some(s => s.text.trim() || s.files.length);

export function readiness(m: Model) {
  const profileReady = PROFILE_KEYS.every(k => m.profile[k].reviewed && m.profile[k].value.trim());
  const needsReady = m.requirements.length > 0 && m.requirements.every(r => r.reviewed) && m.orderReviewed;
  const capsReady = m.capabilities.every(c => c.status === 'Confirmed' && (!c.gap.trim() || c.carry));
  const questionsReady = m.questions.every(q => q.answer.trim() || q.acknowledged);
  const sourcesReady = m.sources.every(s => !s.changed);
  return { profileReady, needsReady, capsReady, questionsReady, sourcesReady, ready: profileReady && needsReady && capsReady && questionsReady && sourcesReady };
}

export const errorStatus = (e: unknown) => (e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number' ? (e as { status: number }).status : 0);
export const errorMessage = (e: unknown) => {
  const d = e && typeof e === 'object' && 'data' in e ? obj((e as { data: unknown }).data) : {};
  if (typeof d.error === 'string') return d.error;
  return e instanceof Error ? e.message : 'Something went wrong.';
};
export const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;
