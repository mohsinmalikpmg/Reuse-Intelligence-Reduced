import { useEffect, useMemo, useRef, useState } from 'react';
import { Reorder, useDragControls, useReducedMotion } from 'framer-motion';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CheckCheck, Clock, Download, Eye, GripVertical, List, Pencil, Plus, Sparkles } from 'lucide-react';
import type { IntakeAttachment } from '@workspace/api-client-react';
import { formatSize, labels, PROFILE_KEYS, readiness, sourceLabels, type Capability, type Model, type ProfileKey, type Question, type Requirement, type SourceId } from './model';

export type GuideStep = 'profile' | 'needs' | 'capabilities' | 'questions' | 'order' | 'agree';
export const GUIDE_STEPS: { key: GuideStep; label: string }[] = [
  { key: 'profile', label: 'The problem' }, { key: 'needs', label: 'Needs' }, { key: 'capabilities', label: 'What you built' },
  { key: 'questions', label: 'Open questions' }, { key: 'order', label: 'Priorities' }, { key: 'agree', label: 'Agree' },
];

const qDone = (q: Question) => !!(q.answer.trim() || q.acknowledged);
const capDone = (c: Capability) => c.status === 'Confirmed' && (!c.gap.trim() || c.carry);

export function stepDone(m: Model, s: GuideStep): boolean {
  const r = readiness(m);
  if (s === 'profile') return r.profileReady;
  if (s === 'needs') return m.requirements.length > 0 && m.requirements.every(x => x.reviewed);
  if (s === 'capabilities') return r.capsReady;
  if (s === 'questions') return r.questionsReady;
  if (s === 'order') return r.needsReady;
  return false;
}
export const firstPendingStep = (m: Model): GuideStep => GUIDE_STEPS.find(s => s.key !== 'agree' && !stepDone(m, s.key))?.key ?? 'agree';
export function approvalProgress(m: Model) {
  const done = PROFILE_KEYS.filter(k => m.profile[k].reviewed && m.profile[k].value.trim()).length + m.requirements.filter(r => r.reviewed).length + m.capabilities.filter(capDone).length + m.questions.filter(qDone).length + (m.orderReviewed ? 1 : 0);
  const total = 4 + m.requirements.length + m.capabilities.length + m.questions.length + 1;
  return { done, total };
}

type Item = { key: string; done: boolean };

export type GuidedProps = {
  model: Model; attachments: IntakeAttachment[]; step: GuideStep; onStep: (s: GuideStep) => void;
  locked: boolean; busy: string | null; conflict: boolean; serverConfirmed: boolean; interpretAck: boolean; onInterpretAck: (v: boolean) => void;
  onCommit: (next: Model, message: string) => void; onEditProfile: (k: ProfileKey, v: string) => void; onAnswer: (qid: string, patch: { answer?: string; acknowledged?: boolean }) => void;
  onReorder: (r: Requirement[]) => void; onDragEnd: () => void; onInterpret: () => void; onConfirm: () => void; onCompare: () => void; onDownload: () => void;
  onAgreed: (v: boolean) => void; onGoInputs: () => void; onNotice: (m: string) => void; onDraftDirty: (d: boolean) => void; compareHidden: boolean;
};

export default function GuidedReview(p: GuidedProps) {
  const { model, step, locked } = p;
  const [cursor, setCursor] = useState<string | null>(null);
  const [deferred, setDeferred] = useState<Set<string>>(() => new Set());
  const [overview, setOverview] = useState(false);
  const [draftDirty, setDraftDirtyState] = useState(false);
  const dirtyRef = useRef(p.onDraftDirty); dirtyRef.current = p.onDraftDirty;
  const setDraftDirty = (d: boolean) => { setDraftDirtyState(d); dirtyRef.current(d); };
  useEffect(() => () => dirtyRef.current(false), []);

  const guard = (fn: () => void) => { if (draftDirty && !window.confirm('You have an unsaved edit on this item. Discard it?')) return; if (draftDirty) setDraftDirty(false); fn(); };
  const go = (s: GuideStep) => guard(() => { setCursor(null); setOverview(false); p.onStep(s); });

  const items: Item[] = useMemo(() => step === 'profile' ? PROFILE_KEYS.map(k => ({ key: `p:${k}`, done: model.profile[k].reviewed && !!model.profile[k].value.trim() }))
    : step === 'needs' ? model.requirements.map(r => ({ key: `r:${r.id}`, done: r.reviewed }))
    : step === 'capabilities' ? model.capabilities.map(c => ({ key: `c:${c.id}`, done: capDone(c) }))
    : step === 'questions' ? model.questions.map(q => ({ key: `q:${q.id}`, done: qDone(q) })) : [], [model, step]);
  const pending = items.filter(i => !i.done);
  const current = (cursor && items.find(i => i.key === cursor)) || pending.find(i => !deferred.has(i.key)) || null;
  const setAside = pending.filter(i => deferred.has(i.key));
  const nextAfter = (key: string) => {
    const order = [...items.slice(items.findIndex(i => i.key === key) + 1), ...items];
    return order.find(i => !i.done && i.key !== key && !deferred.has(i.key))?.key ?? null;
  };
  const advance = (key: string) => { setDraftDirty(false); setCursor(nextAfter(key)); setDeferred(d => { const n = new Set(d); n.delete(key); return n; }); };
  const later = (key: string) => guard(() => { setDeferred(d => new Set(d).add(key)); const order = [...items.slice(items.findIndex(i => i.key === key) + 1), ...items]; setCursor(order.find(i => !i.done && i.key !== key && !deferred.has(i.key))?.key ?? null); p.onNotice('Set aside for later. It is not approved and still needs your review before you can agree.'); });
  const revisitAside = () => { setDeferred(d => { const n = new Set(d); setAside.forEach(i => n.delete(i.key)); return n; }); setCursor(setAside[0]?.key ?? null); };
  const position = current ? items.findIndex(i => i.key === current.key) + 1 : 0;
  const stepIndex = GUIDE_STEPS.findIndex(s => s.key === step);
  const nextStep = GUIDE_STEPS[stepIndex + 1]?.key;
  const prevStep = GUIDE_STEPS[stepIndex - 1]?.key;

  const commit = p.onCommit;
  const body = (() => {
    if (step === 'order') return <OrderStep {...p} onGo={go} />;
    if (step === 'agree') return <AgreeStep {...p} onGo={go} />;
    if (!items.length) return <div className="fg-done" data-testid="guide-empty"><h3>{step === 'needs' ? 'No needs yet.' : step === 'capabilities' ? 'Nothing built was described.' : 'No open questions.'}</h3><p>{step === 'needs' ? 'Add the first thing that must be true. At least one reviewed need is required.' : step === 'capabilities' ? 'That is fine if you brought only a need.' : 'The interpretation did not raise anything to clarify.'}</p>{step === 'needs' ? <AddNeed {...p} onAdded={k => setCursor(k)} /> : <button className="fi-btn primary" data-testid="button-guide-continue" onClick={() => nextStep && go(nextStep)}>Continue<ArrowRight /></button>}</div>;
    if (!current) {
      if (setAside.length) return <div className="fg-done warm" data-testid="guide-set-aside"><Clock /><h3>{setAside.length} {setAside.length === 1 ? 'item is' : 'items are'} waiting for you.</h3><p>Set-aside items are not approved. They block the final agreement until you review them.</p><div className="fi-actions"><button className="fi-btn" onClick={() => nextStep && go(nextStep)}>Continue for now</button><button className="fi-btn primary" data-testid="button-review-set-aside" onClick={revisitAside}>Review them now<ArrowRight /></button></div></div>;
      return <div className="fg-done" data-testid="guide-step-done"><CheckCheck /><h3>{step === 'questions' ? 'Every question is answered or knowingly left open.' : 'All confirmed.'}</h3><p>You can still reopen any item from the overview.</p>
        {step === 'needs' && <AddNeed {...p} onAdded={k => setCursor(k)} />}
        {step === 'questions' && <Reinterpret {...p} />}
        <div className="fi-actions"><button className="fi-btn primary" data-testid="button-guide-continue" onClick={() => nextStep && go(nextStep)}>Continue<ArrowRight /></button></div></div>;
    }
    const [kind, id] = [current.key.slice(0, 1), current.key.slice(2)];
    const shared = { locked, onLater: () => later(current.key), onDirty: setDraftDirty, attachments: p.attachments, model };
    if (kind === 'p') { const k = id as ProfileKey; return <FieldItem key={current.key} {...shared} title={labels[k]} value={model.profile[k].value} reviewed={current.done} changed={model.profile[k].changed} note={model.profile[k].provenance} sources={['problem']}
      onSave={v => { p.onEditProfile(k, v); setDraftDirty(false); }} onAccurate={() => { commit({ ...model, profile: { ...model.profile, [k]: { ...model.profile[k], reviewed: true, changed: false } } }, `${labels[k]} confirmed as accurate.`); advance(current.key); }} />; }
    if (kind === 'r') { const r = model.requirements.find(x => x.id === id)!; return <FieldItem key={current.key} {...shared} title="A need" value={r.text} reviewed={r.reviewed} changed={r.changed} note={r.provenance} sources={r.sources} userAdded={!r.sources.length}
      onSave={text => { commit({ ...model, requirements: model.requirements.map(x => x.id === r.id ? { ...x, text, reviewed: false, changed: true } : x), orderReviewed: false }, 'Need corrected. Read it back, then confirm.'); setDraftDirty(false); }}
      onRemove={() => { commit({ ...model, requirements: model.requirements.filter(x => x.id !== r.id), orderReviewed: false }, 'Need removed. Undo restores it with its priority and review state.'); advance(current.key); }}
      onAccurate={() => { commit({ ...model, requirements: model.requirements.map(x => x.id === r.id ? { ...x, reviewed: true, changed: false } : x) }, 'Need confirmed as accurately worded.'); advance(current.key); }} />; }
    if (kind === 'c') { const c = model.capabilities.find(x => x.id === id)!; return <CapItem key={current.key} {...shared} item={c}
      onSave={next => { commit({ ...model, capabilities: model.capabilities.map(x => x.id === c.id ? { ...next, status: 'Needs clarification', changed: true, carry: false } : x) }, 'Capability corrected. Read it back before confirming.'); setDraftDirty(false); }}
      onCarry={carry => commit({ ...model, capabilities: model.capabilities.map(x => x.id === c.id ? { ...x, carry } : x) }, carry ? 'Gap acknowledged and carried forward. It is not resolved.' : 'Gap acknowledgement removed.')}
      onAccurate={() => { commit({ ...model, capabilities: model.capabilities.map(x => x.id === c.id ? { ...x, status: 'Confirmed', changed: false } : x) }, 'Description confirmed.'); if (!c.gap.trim() || c.carry) advance(current.key); }} />; }
    const q = model.questions.find(x => x.id === id)!;
    return <QuestionItem key={current.key} {...shared} q={q} index={position} count={items.length} onAnswer={a => { p.onAnswer(q.id, { answer: a }); setDraftDirty(false); if (a) advance(current.key); }} onAck={v => { p.onAnswer(q.id, { acknowledged: v }); if (v) advance(current.key); }} />;
  })();

  const { done, total } = approvalProgress(model);
  return <section className="fg" data-testid="guided-review">
    <nav className="fg-rail" aria-label="Review steps">{GUIDE_STEPS.map((s, i) => { const ok = s.key === 'agree' ? p.serverConfirmed : stepDone(model, s.key); return <button key={s.key} data-testid={`guide-step-${s.key}`} aria-current={step === s.key ? 'step' : undefined} className={`${step === s.key ? 'on' : ''} ${ok ? 'ok' : ''}`} onClick={() => go(s.key)}><i>{ok ? <Check /> : i + 1}</i><span>{s.label}</span></button>; })}</nav>
    <div className="fg-meter" aria-label={`${done} of ${total} approvals`}><span style={{ transform: `scaleX(${total ? done / total : 0})` }} /></div>
    <div className="fg-head"><p className="fg-kicker">{step === 'agree' ? 'Final read' : step === 'order' ? 'Rank together' : items.length ? `${position || items.length - pending.length} of ${items.length}${setAside.length ? ` · ${setAside.length} set aside` : ''}` : 'Nothing here'}</p>
      {items.length > 0 && <button className="fi-link" data-testid="button-overview" aria-expanded={overview} onClick={() => setOverview(o => !o)}><List style={{ width: 13, height: 13, display: 'inline', verticalAlign: -2, marginRight: 4 }} />{overview ? 'Hide overview' : 'See all'}</button>}</div>
    {overview && items.length > 0 && <ol className="fg-overview" data-testid="guide-overview">{items.map(i => <li key={i.key}><button className={`${current?.key === i.key ? 'on' : ''}`} onClick={() => guard(() => { setCursor(i.key); setOverview(false); })}><i className={i.done ? 'ok' : deferred.has(i.key) ? 'later' : ''} /><span>{overviewLabel(model, i.key)}</span><small>{i.done ? 'Confirmed' : deferred.has(i.key) ? 'Later' : 'To review'}</small></button></li>)}</ol>}
    <div className="fg-stage" key={`${step}-${current?.key ?? 'x'}`}>{body}</div>
    <div className="fg-nav">{prevStep ? <button className="fi-link" onClick={() => go(prevStep)}><ArrowLeft style={{ width: 12, height: 12, display: 'inline', verticalAlign: -1 }} /> Back</button> : <button className="fi-link" onClick={() => guard(p.onGoInputs)}>Change my inputs</button>}{draftDirty && <span className="fg-unsaved">Unsaved edit on this item</span>}</div>
  </section>;
}

function overviewLabel(m: Model, key: string) {
  const id = key.slice(2);
  if (key.startsWith('p:')) return `${labels[id as ProfileKey]}: ${m.profile[id as ProfileKey].value || 'not stated'}`;
  if (key.startsWith('r:')) return m.requirements.find(r => r.id === id)?.text ?? '';
  if (key.startsWith('c:')) return m.capabilities.find(c => c.id === id)?.title ?? '';
  return m.questions.find(q => q.id === id)?.text ?? '';
}

function SourcePeek({ ids, model, attachments, note }: { ids: SourceId[]; model: Model; attachments: IntakeAttachment[]; note?: string }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<Record<string, boolean>>({});
  const sources = model.sources.filter(s => ids.includes(s.id) && (s.text.trim() || s.files.length));
  if (!sources.length && !note) return <p className="fi-hint">No supplied source is linked to this item — you added or changed it yourself.</p>;
  return <div className="fg-peek">
    <button className="fi-link" data-testid="button-see-source" aria-expanded={open} onClick={() => setOpen(o => !o)}><Eye style={{ width: 13, height: 13, display: 'inline', verticalAlign: -2, marginRight: 4 }} />{open ? 'Hide original source' : 'See original source'}</button>
    {open && <div className="fg-peek-body" data-testid="source-peek">
      <p className="fi-hint">Your full supplied material for comparison. The interpretation is not tied to an exact line in it.{note ? ` Interpretation note: ${note}` : ''}</p>
      {sources.map(s => { const long = s.text.length > 700; const show = full[s.id] || !long; return <div key={s.id} className="fg-peek-src"><strong>{s.name || sourceLabels[s.id]}</strong>
        {s.text.trim() ? <><pre className={show ? '' : 'clip'}>{show ? s.text : s.text.slice(0, 700)}</pre>{long && <button className="fi-link" onClick={() => setFull(f => ({ ...f, [s.id]: !f[s.id] }))}>{show ? 'Show less' : `Show all ${s.text.length.toLocaleString()} characters`}</button>}</> : <p className="fi-hint">No text supplied for this input.</p>}
        {s.files.length > 0 && <ul>{s.files.map(fid => { const a = attachments.find(x => x.id === fid); return <li key={fid}>{a ? `${a.name} · ${formatSize(a.size)} · ${a.status === 'extracted' ? 'text was read' : a.status === 'reference' ? 'kept as reference; not read' : 'could not be read'}` : 'Attachment unavailable'}</li>; })}</ul>}</div>; })}
    </div>}
  </div>;
}

type Shared = { locked: boolean; onLater: () => void; onDirty: (d: boolean) => void; attachments: IntakeAttachment[]; model: Model };

function FieldItem({ title, value, reviewed, changed, note, sources, userAdded, onSave, onAccurate, onRemove, locked, onLater, onDirty, attachments, model }: Shared & { title: string; value: string; reviewed: boolean; changed: boolean; note?: string; sources: SourceId[]; userAdded?: boolean; onSave: (v: string) => void; onAccurate: () => void; onRemove?: () => void }) {
  const [editing, setEditing] = useState(!value.trim());
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  const dirty = editing && draft.trim() !== value;
  useEffect(() => { onDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  return <article className={`fg-card ${changed ? 'changed' : ''}`} data-testid="guide-item">
    <p className="fg-label">{title}{userAdded ? ' · added by you' : ''}</p>
    {editing ? <form onSubmit={e => { e.preventDefault(); if (draft.trim()) { onSave(draft.trim()); setEditing(false); } }}>
      <textarea className="fi-input fg-edit" data-testid="input-guide-edit" aria-label={title} autoFocus rows={4} readOnly={locked} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && value.trim()) { setDraft(value); setEditing(false); } }} />
      <div className="fi-actions">{onRemove && <button type="button" className="fi-link fg-danger" data-testid="button-guide-remove" disabled={locked} onClick={onRemove}>Remove this need</button>}{value.trim() && <button type="button" className="fi-btn" onClick={() => { setDraft(value); setEditing(false); }}>Cancel</button>}<button className="fi-btn primary" data-testid="button-guide-save-edit" disabled={locked || !draft.trim() || draft.trim() === value}><Check />Save correction</button></div>
    </form> : <>
      <p className="fg-value">{value}</p>
      {changed && <p className="fi-readback">Updated wording — read it back before confirming.</p>}
      {reviewed && <span className="fi-label"><Check />Confirmed as accurate</span>}
      <SourcePeek ids={sources} model={model} attachments={attachments} note={note} />
      <div className="fg-choices"><button className="fi-btn" data-testid="button-guide-later" disabled={locked} onClick={onLater}><Clock />Come back later</button><button className="fi-btn" data-testid="button-guide-edit" disabled={locked} onClick={() => setEditing(true)}><Pencil />Edit</button>{!reviewed && <button className="fi-btn primary" data-testid="button-guide-accurate" disabled={locked || !value.trim()} onClick={onAccurate}><Check />That’s accurate</button>}</div>
    </>}
  </article>;
}

const CAP_EXTRA = ['workflow', 'input', 'output', 'dependency'] as const;
const capLabel: Record<(typeof CAP_EXTRA)[number], string> = { workflow: 'How it works', input: 'Takes in', output: 'Gives back', dependency: 'Depends on' };

function CapItem({ item, onSave, onAccurate, onCarry, locked, onLater, onDirty, attachments, model }: Shared & { item: Capability; onSave: (c: Capability) => void; onAccurate: () => void; onCarry: (v: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item);
  const [more, setMore] = useState(false);
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(item);
  useEffect(() => { onDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  const known = CAP_EXTRA.filter(k => item[k].trim());
  const confirmed = item.status === 'Confirmed';
  return <article className={`fg-card ${item.changed ? 'changed' : ''}`} data-testid="guide-item">
    <p className="fg-label">Described in {item.sourceId ? model.sources.find(s => s.id === item.sourceId)?.name || sourceLabels[item.sourceId] : 'your inputs'}</p>
    {editing ? <form onSubmit={e => { e.preventDefault(); onSave({ ...draft, title: draft.title.trim(), description: draft.description.trim() }); setEditing(false); }}>
      <label className="fi-input-label">Name<input className="fi-input" readOnly={locked} required value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label className="fi-input-label">What it does<textarea className="fi-input" rows={3} readOnly={locked} required value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      {(more ? CAP_EXTRA : CAP_EXTRA.filter(k => draft[k].trim())).map(k => <label className="fi-input-label" key={k}>{capLabel[k]}<textarea className="fi-input" rows={2} readOnly={locked} value={draft[k]} onChange={e => setDraft({ ...draft, [k]: e.target.value })} /></label>)}
      {!more && CAP_EXTRA.some(k => !draft[k].trim()) && <button type="button" className="fi-link" onClick={() => setMore(true)}><Plus style={{ width: 12, height: 12, display: 'inline', verticalAlign: -2 }} /> Add how it works, inputs, outputs or dependencies</button>}
      <label className="fi-input-label">Open gap (leave blank if none)<textarea className="fi-input" rows={2} readOnly={locked} value={draft.gap} onChange={e => setDraft({ ...draft, gap: e.target.value })} /></label>
      <div className="fi-actions"><button type="button" className="fi-btn" onClick={() => { setDraft(item); setEditing(false); }}>Cancel</button><button className="fi-btn primary" data-testid="button-guide-save-edit" disabled={locked || !draft.title.trim() || !draft.description.trim() || !dirty}><Check />Save correction</button></div>
    </form> : <>
      <h3 className="fg-title">{item.title}</h3>
      <p className="fg-value">{item.description}</p>
      {known.length > 0 && <dl className="fg-dl">{known.map(k => <div key={k}><dt>{capLabel[k]}</dt><dd>{item[k]}</dd></div>)}</dl>}
      {item.changed && <p className="fi-readback">Revised description — read it back before confirming.</p>}
      {confirmed && <span className="fi-label"><Check />Description confirmed</span>}
      {item.gap.trim() && <div className="fg-gap"><strong>Open gap</strong><p>{item.gap}</p><label className="fi-check"><input type="checkbox" data-testid="check-carry-gap" disabled={locked} checked={item.carry} onChange={e => onCarry(e.target.checked)} />Carry this forward as unresolved.</label></div>}
      <SourcePeek ids={item.sourceId ? [item.sourceId] : []} model={model} attachments={attachments} note={item.provenance} />
      <div className="fg-choices"><button className="fi-btn" data-testid="button-guide-later" disabled={locked} onClick={onLater}><Clock />Come back later</button><button className="fi-btn" data-testid="button-guide-edit" disabled={locked} onClick={() => { setDraft(item); setMore(false); setEditing(true); }}><Pencil />Edit</button>{!confirmed && <button className="fi-btn primary" data-testid="button-guide-accurate" disabled={locked} onClick={onAccurate}><Check />That’s accurate</button>}</div>
    </>}
  </article>;
}

function QuestionItem({ q, index, count, onAnswer, onAck, locked, onLater, onDirty }: Shared & { q: Question; index: number; count: number; onAnswer: (a: string) => void; onAck: (v: boolean) => void }) {
  const [draft, setDraft] = useState(q.answer);
  useEffect(() => { setDraft(q.answer); }, [q.answer]);
  const dirty = draft.trim() !== q.answer;
  useEffect(() => { onDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  return <article className="fg-card fg-q" data-testid="guide-item">
    <p className="fg-label">Question {index} of {count}</p>
    <h3 className="fg-title">{q.text}</h3>
    <textarea className="fi-input" data-testid={`input-answer-${q.id}`} aria-label={`Answer: ${q.text}`} rows={3} readOnly={locked} placeholder="Your answer, in your own words" value={draft} onChange={e => setDraft(e.target.value)} />
    {q.acknowledged && !q.answer.trim() && <span className="fi-label warm">Left open · acknowledged as unresolved</span>}
    {q.answer.trim() && <span className="fi-label"><Check />Answered</span>}
    <div className="fg-choices"><button className="fi-btn" data-testid="button-guide-later" disabled={locked} onClick={onLater}><Clock />Come back later</button>
      {!q.acknowledged ? <button className="fi-btn" data-testid="button-question-ack" disabled={locked || dirty} onClick={() => onAck(true)}>Leave it open</button> : <button className="fi-btn" disabled={locked} onClick={() => onAck(false)}>Undo leave open</button>}
      <button className="fi-btn primary" data-testid="button-question-answer" disabled={locked || !dirty} onClick={() => onAnswer(draft.trim())}><Check />{q.answer.trim() ? 'Update answer' : 'Save answer'}</button></div>
  </article>;
}

function Reinterpret({ model, locked, conflict, busy, interpretAck, onInterpretAck, onInterpret }: GuidedProps) {
  if (!model.questions.some(q => q.answer.trim())) return null;
  return <div className="fg-reint"><p>Want your answers reflected in the needs and profile? Re-interpreting refreshes affected items; they come back unconfirmed for you to read.</p>
    <label className="fi-check"><input type="checkbox" data-testid="check-interpret-privacy-review" checked={interpretAck} disabled={locked} onChange={e => onInterpretAck(e.target.checked)} />My saved inputs and answers are safe to send for AI interpretation.</label>
    <button className="fi-btn" data-testid="button-reinterpret-answers" disabled={locked || conflict || !interpretAck} onClick={onInterpret}><Sparkles />{busy === 'interpret' ? 'Interpreting…' : 'Re-interpret with my answers'}</button></div>;
}

function AddNeed({ model, locked, onCommit, onNotice, onAdded }: GuidedProps & { onAdded: (key: string) => void }) {
  const [open, setOpen] = useState(!model.requirements.length);
  const [text, setText] = useState('');
  if (!open) return <button className="fi-link" data-testid="button-open-add-need" onClick={() => setOpen(true)}>Something missing? Add a need</button>;
  return <form className="fi-add fg-add" onSubmit={e => { e.preventDefault(); const t = text.trim(); if (!t) return; if (model.requirements.some(r => r.text.toLowerCase() === t.toLowerCase())) { onNotice('That need already exists. Edit it instead.'); return; } const id = `need-${crypto.randomUUID()}`; onCommit({ ...model, requirements: [...model.requirements, { id, text: t, sources: [], reviewed: false, changed: true }], orderReviewed: false }, 'Need added. Read it back, then confirm.'); setText(''); onAdded(`r:${id}`); }}>
    <input className="fi-input" data-testid="input-add-need" aria-label="Add a missing need" placeholder="Something we missed?" readOnly={locked} value={text} onChange={e => setText(e.target.value)} /><button className="fi-btn" disabled={locked || !text.trim()}><Plus />Add</button></form>;
}

function OrderRow({ item, index, count, onMove, locked }: { item: Requirement; index: number; count: number; onMove: (o: number) => void; locked: boolean }) {
  const controls = useDragControls();
  const reduced = useReducedMotion();
  return <Reorder.Item value={item} dragListener={false} dragControls={controls} className="fg-row" layout="position" transition={{ duration: reduced ? 0 : .18 }} data-testid={`order-row-${index}`}>
    <button className="fi-icon fg-grip" aria-label={`Drag priority ${index + 1}: ${item.text}. Use the move buttons as a keyboard alternative.`} disabled={locked} onPointerDown={e => { if (!locked) controls.start(e); }}><GripVertical /></button>
    <span className="fg-num">{String(index + 1).padStart(2, '0')}</span><p>{item.text}</p>
    <span className="fg-move"><button className="fi-icon" disabled={locked || index === 0} onClick={() => onMove(-1)} aria-label={`Move priority ${index + 1} up`}><ArrowUp /></button><button className="fi-icon" disabled={locked || index === count - 1} onClick={() => onMove(1)} aria-label={`Move priority ${index + 1} down`}><ArrowDown /></button></span>
  </Reorder.Item>;
}

function OrderStep(p: GuidedProps & { onGo: (s: GuideStep) => void }) {
  const { model, locked } = p;
  const unreviewed = model.requirements.filter(r => !r.reviewed).length;
  if (!model.requirements.length || unreviewed) return <div className="fg-done warm"><h3>{model.requirements.length ? `${unreviewed} ${unreviewed === 1 ? 'need still needs' : 'needs still need'} your read first.` : 'Add a need first.'}</h3><p>Rank once every need is worded the way you mean it.</p><div className="fi-actions"><button className="fi-btn primary" onClick={() => p.onGo('needs')}>Go to needs<ArrowRight /></button></div></div>;
  const move = (i: number, o: number) => { const next = [...model.requirements]; [next[i], next[i + o]] = [next[i + o], next[i]]; p.onCommit({ ...model, requirements: next, orderReviewed: false }, `Moved to priority ${i + o + 1}.`); };
  return <div>
    <h3 className="fg-title">What matters most, first?</h3><p className="fi-hint" style={{ marginBottom: 14 }}>Drag by the handle, or use the arrows. The top item leads the comparison.</p>
    <Reorder.Group axis="y" values={model.requirements} onReorder={r => { if (!locked) p.onReorder(r); }} className="fg-rows" onPointerUp={p.onDragEnd} onPointerCancel={p.onDragEnd}>
      {model.requirements.map((r, i) => <OrderRow key={r.id} item={r} index={i} count={model.requirements.length} locked={locked} onMove={o => move(i, o)} />)}</Reorder.Group>
    <div className="fg-choices">{model.orderReviewed ? <><span className="fi-label"><CheckCheck />Order agreed</span><button className="fi-btn primary" data-testid="button-guide-continue" onClick={() => p.onGo('agree')}>Continue<ArrowRight /></button></> : <button className="fi-btn primary" data-testid="button-agree-order" disabled={locked} onClick={() => p.onCommit({ ...model, orderReviewed: true }, 'This priority order is agreed.')}><Check />Agree this order</button>}</div>
  </div>;
}

function AgreeStep(p: GuidedProps & { onGo: (s: GuideStep) => void }) {
  const { model, locked, serverConfirmed } = p;
  const r = readiness(model);
  const gaps = model.capabilities.filter(c => c.gap.trim());
  const blockers: [string, GuideStep][] = ([[!r.profileReady, 'Confirm the problem and context', 'profile'], [!stepDone(model, 'needs'), 'Read every need', 'needs'], [!r.capsReady, 'Confirm what you built and its gaps', 'capabilities'], [!r.questionsReady, 'Answer or leave open each question', 'questions'], [stepDone(model, 'needs') && !model.orderReviewed, 'Agree the priority order', 'order']] as [boolean, string, GuideStep][]).filter(b => b[0]).map(b => [b[1], b[2]]);
  return <div data-testid="guide-agree">
    {serverConfirmed ? <div className="fi-success"><CheckCheck /><h2>Understanding agreed.</h2><p>Saved and ready to compare.</p><div className="fi-actions" style={{ justifyContent: 'flex-start' }}><button className="fi-btn" data-testid="button-download-json" onClick={p.onDownload}><Download />Download confirmed JSON</button></div></div>
      : <h3 className="fg-title">One last read, together.</h3>}
    <div className="fg-recap">
      <p><span>Problem</span>{model.profile.problem.value || '—'}</p>
      <p><span>Top needs</span>{model.requirements.slice(0, 3).map((x, i) => `${i + 1}. ${x.text}`).join('  ') || '—'}{model.requirements.length > 3 ? ` +${model.requirements.length - 3} more` : ''}</p>
      <p><span>Open gaps</span>{gaps.length ? `${gaps.filter(g => g.carry).length} of ${gaps.length} carried forward, unresolved` : 'None recorded'}</p>
    </div>
    <details className="fg-all"><summary>See everything</summary>
      <dl className="fg-dl">{PROFILE_KEYS.map(k => <div key={k}><dt>{labels[k]}</dt><dd>{model.profile[k].value || '—'}</dd></div>)}</dl>
      <ol>{model.requirements.map(x => <li key={x.id}>{x.text}</li>)}</ol>
      {model.capabilities.map(c => <p key={c.id} className="fi-hint"><b>{c.title}</b> · {c.status === 'Confirmed' ? 'Description confirmed' : c.status}{c.gap.trim() ? ` · gap: ${c.gap}` : ''}</p>)}
      {model.questions.map(q => <p key={q.id} className="fi-hint"><b>{q.text}</b> {q.answer.trim() || (q.acknowledged ? 'Left open' : 'Not answered')}</p>)}
    </details>
    {!serverConfirmed && (blockers.length ? <div className="fi-warning" data-testid="agree-blockers"><strong>Not ready yet.</strong>{blockers.slice(0, 3).map(([t, s]) => <p key={s}><button className="fi-link" onClick={() => p.onGo(s)}>{t}</button></p>)}</div>
      : <><label className="fi-check"><input type="checkbox" data-testid="check-agree" checked={model.agreed} disabled={locked} onChange={e => p.onAgreed(e.target.checked)} />This accurately describes our need and what we supplied. I acknowledge the open gaps.</label>
        <div className="fg-choices"><button className="fi-btn sienna" data-testid="button-confirm" disabled={!model.agreed || locked || p.conflict} onClick={p.onConfirm}><CheckCheck />{p.busy === 'confirm' ? 'Confirming…' : 'Confirm shared understanding'}</button></div></>)}
    {serverConfirmed && !p.compareHidden && <div className="fi-card fi-compare"><h3>Compare with the library</h3><p className="fi-hint">Only your confirmed profile and ordered needs are copied to the SHARED DEMO workspace. Source files, source text and capability claims stay private.</p><div className="fi-actions"><button className="fi-btn primary" data-testid="button-compare-library" disabled={locked || p.conflict} onClick={p.onCompare}><ArrowRight />{p.busy === 'compare' ? 'Opening comparison…' : 'Compare with library'}</button></div></div>}
    {serverConfirmed && <p className="fi-hint">To change anything, go back to a step. Any edit reopens agreement.</p>}
  </div>;
}
