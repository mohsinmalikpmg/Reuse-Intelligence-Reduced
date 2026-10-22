import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Reorder, useDragControls, useReducedMotion } from 'framer-motion';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowRight, ChevronDown, GripVertical, Plus, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import { newRequirement, removeRequirement } from './structure';
import { coverageLinked, reviewExceptions, exceptionCount, NAME_PENDING, type Capability, type Coverage, type Model, type ProfileKey, type Requirement } from './model';

/** Simple review: one compact, editable read of the AI analysis, one explicit acceptance, one primary action. Shared verbatim between Workbench and FUSEBOX Intake. */
type Props = {
  model: Model; name: string; locked: boolean; conflict: boolean; serverConfirmed: boolean; finding: boolean; naming: boolean;
  accepted: boolean; onAccepted: (v: boolean) => void;
  onName: (v: string) => void; onRegenerateName: () => void;
  onEditProfile: (k: ProfileKey, v: string) => void; onCommit: (next: Model, message: string) => void;
  onReorder: (r: Requirement[]) => void; onDragEnd: () => void;
  onAnswer: (qid: string, patch: { answer?: string; acknowledged?: boolean }) => void;
  onInterpret: () => void; onFind: () => void; onGoDescribe: () => void;
  detailsOpen: boolean; onDetails: (open: boolean) => void; details: ReactNode;
};

const SUB: { key: ProfileKey; label: string; empty: string }[] = [
  { key: 'user', label: 'Who it is for', empty: 'Who needs this?' },
  { key: 'scope', label: 'In and out of scope', empty: 'What is in, and what is out?' },
  { key: 'outcome', label: 'Better looks like', empty: 'What changes when this works?' },
];

/** Click-to-edit text. Enter saves (Shift+Enter for a new line), Escape cancels, leaving the field saves. */
function Inline({ value, onSave, label, placeholder, testid, className = '', disabled }: { value: string; onSave: (v: string) => void; label: string; placeholder: string; testid: string; className?: string; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select(); } }, [editing]);
  const done = () => { const v = draft.trim(); setEditing(false); if (v && v !== value) onSave(v); else setDraft(value); };
  if (editing) return <textarea ref={ref} className={`fs-inline-input ${className}`} aria-label={label} data-testid={`input-${testid}`} rows={Math.min(6, Math.max(1, Math.ceil(draft.length / 80)))} value={draft}
    onChange={e => setDraft(e.target.value)} onBlur={done} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(); } if (e.key === 'Escape') { setDraft(value); setEditing(false); } }} />;
  return <button type="button" className={`fs-inline ${className} ${value.trim() ? '' : 'empty'}`} data-testid={`edit-${testid}`} aria-label={`Edit ${label}`} disabled={disabled} onClick={() => setEditing(true)}>{value.trim() || placeholder}</button>;
}

function Evidence({ items }: { items: Coverage[] }) {
  if (!items.length) return null;
  return <small className="fs-evidence" data-testid="text-evidence" title={items.map(c => c.excerpt).join('\n')}>From your input: “{items[0].excerpt}”{items.length > 1 ? ` + ${items.length - 1} more` : ''}</small>;
}

function NeedRow({ item, index, count, locked, evidence, onEdit, onMove, onRemove, onDragEnd }: { item: Requirement; evidence: Coverage[]; index: number; count: number; locked: boolean; onEdit: (t: string) => void; onMove: (o: number) => void; onRemove: () => void; onDragEnd: () => void }) {
  const controls = useDragControls();
  const reduced = useReducedMotion();
  return <Reorder.Item value={item} dragListener={false} dragControls={controls} onDragEnd={onDragEnd} layout="position" transition={{ duration: reduced ? 0 : .18 }} className={`fs-need ${item.changed ? 'changed' : ''}`} data-testid={`row-need-${item.id}`}>
    <button type="button" className="fs-grip" aria-label={`Drag need ${index + 1}. The arrow buttons move it with the keyboard.`} disabled={locked} onPointerDown={e => controls.start(e)}><GripVertical /></button>
    <span className="fs-num">{String(index + 1).padStart(2, '0')}</span>
    <div className="fs-need-body"><Inline value={item.text} label={`need ${index + 1}`} placeholder="Describe this need" testid={`need-${item.id}`} disabled={locked} onSave={onEdit} />
      <Evidence items={evidence} />{item.changed && <small className="fs-flag">Updated · read it again</small>}</div>
    <span className="fs-need-tools">
      <button type="button" className="fi-icon" aria-label={`Move need ${index + 1} up`} disabled={locked || index === 0} onClick={() => onMove(-1)}><ArrowUp /></button>
      <button type="button" className="fi-icon" aria-label={`Move need ${index + 1} down`} disabled={locked || index === count - 1} onClick={() => onMove(1)}><ArrowDown /></button>
      <button type="button" className="fi-icon" aria-label={`Remove need ${index + 1}`} data-testid={`button-remove-need-${item.id}`} disabled={locked} onClick={onRemove}><X /></button>
    </span>
  </Reorder.Item>;
}

export default function Simple(p: Props) {
  const { model, locked } = p;
  const [extra, setExtra] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const x = reviewExceptions(model);
  const matched = model.coverage.filter(c => !c.reviewed && coverageLinked(model, c));
  const evidenceFor = (iid: string) => model.coverage.filter(c => c.disposition === 'accounted' && (c.requirementIds.includes(iid) || c.capabilityIds.includes(iid)));
  const leftCoverage = x.openCoverage.filter(c => c.disposition !== 'accounted');
  const brokenCoverage = x.openCoverage.filter(c => c.disposition === 'accounted');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const ackCoverage = () => p.onCommit({ ...model, coverage: model.coverage.map(c => leftCoverage.some(l => l.id === c.id) ? { ...c, reviewed: true, note: (notes[c.id] ?? c.note).trim() } : c) }, `${leftCoverage.length} input ${leftCoverage.length === 1 ? 'excerpt' : 'excerpts'} acknowledged as not covered by the needs. They stay marked unresolved or out of scope.`);
  const open = exceptionCount(x);
  const leftOpen = model.questions.filter(q => q.acknowledged && !q.answer.trim());
  const caps = model.capabilities;
  const setNeeds = (requirements: Requirement[], msg: string) => p.onCommit({ ...model, requirements, orderReviewed: false }, msg);
  const editCap = (c: Capability, patch: Partial<Capability>, msg: string) => p.onCommit({ ...model, capabilities: model.capabilities.map(y => y.id === c.id ? { ...y, ...patch, status: 'Needs clarification', changed: true, edited: true } : y) }, msg);
  const scope = [`the summary`, `${model.requirements.length} ${model.requirements.length === 1 ? 'need' : 'needs'} in this order`, caps.length ? `${caps.length} supplied ${caps.length === 1 ? 'capability' : 'capabilities'}` : '', matched.length ? `${matched.length} ${matched.length === 1 ? 'part' : 'parts'} of my input the analysis matched to them` : '', leftOpen.length ? `${leftOpen.length} open ${leftOpen.length === 1 ? 'question' : 'questions'} I chose to leave open` : ''].filter(Boolean);
  const scopeText = scope.length > 1 ? `${scope.slice(0, -1).join(', ')} and ${scope[scope.length - 1]}` : scope[0];

  return <div className="fs" data-testid="panel-simple-review">
    <section className="fs-sheet">
      <div className="fs-name-row"><span className="fs-kicker">Suggested name</span>
        {p.name ? <Inline value={p.name} label="intake name" placeholder="Name this request" testid="title" className="fs-name" disabled={locked} onSave={p.onName} /> : <span className="fi-name-status" data-testid="status-name-pending">{NAME_PENDING}</span>}
        <button type="button" className="fi-link fs-quiet" data-testid="button-regenerate-name" disabled={locked || p.conflict} onClick={p.onRegenerateName}><Sparkles />{p.naming ? 'Suggesting…' : 'Suggest another'}</button>
        {model.name?.origin === 'manual' && <small className="fs-meta">named by you</small>}
      </div>

      <div className="fs-block"><h2 className="fs-h">The business problem</h2>
        <Inline value={model.profile.problem.value} label="business problem" placeholder="What is going wrong today? Click to describe it." testid="profile-problem" className="fs-lead" disabled={locked} onSave={v => p.onEditProfile('problem', v)} />
        <dl className="fs-facts">{SUB.map(s => <div key={s.key} className={model.profile[s.key].value.trim() ? '' : 'missing'}><dt>{s.label}</dt><dd><Inline value={model.profile[s.key].value} label={s.label} placeholder={s.empty} testid={`profile-${s.key}`} disabled={locked} onSave={v => p.onEditProfile(s.key, v)} /></dd></div>)}</dl>
      </div>

      <div className="fs-block"><div className="fs-h-row"><h2 className="fs-h">What it needs</h2><small className="fs-meta">Most important first. Drag or use the arrows to reorder.</small></div>
        {model.requirements.length ? <Reorder.Group axis="y" as="ol" values={model.requirements} onReorder={p.onReorder} className="fs-needs">{model.requirements.map((r, i) => <NeedRow key={r.id} item={r} index={i} count={model.requirements.length} locked={locked} evidence={evidenceFor(r.id)}
          onEdit={t => setNeeds(model.requirements.map(y => y.id === r.id ? { ...y, text: t, changed: true, edited: true } : y), `Need ${i + 1} reworded.`)}
          onMove={o => { const n = [...model.requirements]; [n[i], n[i + o]] = [n[i + o], n[i]]; setNeeds(n, `Need moved to position ${i + o + 1}.`); }}
          onRemove={() => p.onCommit(removeRequirement(model, r.id), 'Need removed. Undo restores it in place.')} onDragEnd={p.onDragEnd} />)}</Reorder.Group>
          : <p className="fs-empty">No needs yet. Add the first one below.</p>}
        <form className="fs-add" onSubmit={e => { e.preventDefault(); const t = extra.trim(); if (!t) return; if (model.requirements.some(r => r.text.toLowerCase() === t.toLowerCase())) return; setNeeds([...model.requirements, newRequirement(t)], 'Need added.'); setExtra(''); }}>
          <Plus /><input className="fs-add-input" data-testid="input-add-need" aria-label="Add a missing need" placeholder="Add a need we missed" value={extra} disabled={locked} onChange={e => setExtra(e.target.value)} />{extra.trim() && <button className="fi-link" data-testid="button-add-need">Add</button>}
        </form>
      </div>

      {caps.length > 0 && <div className="fs-block"><div className="fs-h-row"><h2 className="fs-h">What you already supplied</h2><small className="fs-meta">Described from your prototype or agent. Not tested.</small></div>
        <ul className="fs-caps">{caps.map(c => <li key={c.id} className={c.changed ? 'changed' : ''} data-testid={`row-cap-${c.id}`}>
          <Inline value={c.title} label="capability name" placeholder="Name this capability" testid={`cap-title-${c.id}`} className="fs-cap-title" disabled={locked} onSave={v => editCap(c, { title: v }, 'Capability renamed.')} />
          <Inline value={c.description} label="capability description" placeholder="What does it do?" testid={`cap-desc-${c.id}`} disabled={locked} onSave={v => editCap(c, { description: v }, 'Capability description corrected.')} />
          <Evidence items={evidenceFor(c.id)} />
          {c.gap.trim() && <div className={`fs-gap ${c.carry ? 'done' : ''}`}><span><b>Known gap</b> {c.gap}</span>
            <label className="fs-tick"><input type="checkbox" data-testid={`check-carry-${c.id}`} checked={c.carry} disabled={locked} onChange={e => p.onCommit({ ...model, capabilities: model.capabilities.map(y => y.id === c.id ? { ...y, carry: e.target.checked } : y) }, e.target.checked ? 'Gap kept on record for the IT Owner.' : 'Gap acknowledgement removed.')} />Keep this gap on record</label></div>}
        </li>)}</ul>
      </div>}
    </section>

    {!p.serverConfirmed && open > 0 && <section className="fs-exceptions" data-testid="panel-exceptions"><h2 className="fs-h"><AlertTriangle />Before we can match <span className="fs-count">{open}</span></h2>
      {x.changedSources && <div className="fs-ex"><p>Your description changed after this analysis. Run it again so the summary matches what you wrote.</p><button type="button" className="fi-btn" data-testid="button-reinterpret" disabled={locked || p.conflict} onClick={p.onInterpret}><RefreshCw />Understand again</button></div>}
      {x.missingProfile.length > 0 && <div className="fs-ex"><p>Fill in {x.missingProfile.map(k => SUB.find(s => s.key === k)?.label.toLowerCase() ?? 'the business problem').join(', ')} above. Click the highlighted line to type.</p></div>}
      {x.noNeeds && <div className="fs-ex"><p>Add at least one need.</p></div>}
      {x.openQuestions.map(q => <div className="fs-ex fs-q" key={q.id} data-testid={`question-${q.id}`}><p><b>{q.text}</b></p>
        <form onSubmit={e => { e.preventDefault(); const a = (answers[q.id] ?? '').trim(); if (a) p.onAnswer(q.id, { answer: a }); }}>
          <input className="fi-input" aria-label={`Answer: ${q.text}`} data-testid={`input-answer-${q.id}`} placeholder="Your answer" value={answers[q.id] ?? ''} disabled={locked} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} />
          <button className="fi-btn" disabled={locked || !(answers[q.id] ?? '').trim()}>Answer</button>
          <button type="button" className="fi-link" data-testid={`button-leave-open-${q.id}`} disabled={locked} onClick={() => p.onAnswer(q.id, { acknowledged: true })}>Leave open</button>
        </form></div>)}
      {leftCoverage.length > 0 && <div className="fs-ex fs-q" data-testid="panel-open-coverage"><p>{leftCoverage.length === 1 ? 'This part of your input is' : 'These parts of your input are'} not covered by the needs above. Add a need for anything that matters, or acknowledge {leftCoverage.length === 1 ? 'it' : 'them'} as left out.</p>
        <ul className="fs-cov">{leftCoverage.map(c => <li key={c.id} data-testid={`coverage-open-${c.id}`}><span className="fi-label warm">{c.disposition === 'out-of-scope' ? 'Out of scope' : 'Not covered'}</span><q>{c.excerpt}</q>
          <input className="fs-add-input" aria-label="Optional note" data-testid={`input-coverage-note-${c.id}`} placeholder={c.note || 'Optional note'} value={notes[c.id] ?? ''} disabled={locked} onChange={e => setNotes(n => ({ ...n, [c.id]: e.target.value }))} /></li>)}</ul>
        <div><button type="button" className="fi-btn" data-testid="button-ack-coverage" disabled={locked} onClick={ackCoverage}>Acknowledge as left out</button></div></div>}
      {(brokenCoverage.length > 0 || x.overlaps > 0 || x.groups.length > 0) && <div className="fs-ex"><p>{[brokenCoverage.length ? `${brokenCoverage.length} matched ${brokenCoverage.length === 1 ? 'excerpt points' : 'excerpts point'} at a removed item` : '', x.overlaps ? `${x.overlaps} overlapping ${x.overlaps === 1 ? 'item' : 'items'} to separate` : '', ...x.groups].filter(Boolean).join(' · ')}.</p>
        <button type="button" className="fi-btn" data-testid="button-open-exceptions" onClick={() => p.onDetails(true)}>Fix in analysis details<ChevronDown /></button></div>}
      {x.openGaps.length > 0 && <div className="fs-ex"><p>{x.openGaps.length} known {x.openGaps.length === 1 ? 'gap' : 'gaps'} in what you supplied. Tick “Keep this gap on record” above, or correct it in analysis details.</p></div>}
    </section>}

    <section className="fs-accept" data-testid="panel-accept">
      {p.serverConfirmed ? <p className="fs-accepted">You accepted this understanding. It is saved and ready to match.</p>
        : <label className="fs-tick fs-accept-tick"><input type="checkbox" data-testid="check-accept" checked={p.accepted} disabled={locked || open > 0} onChange={e => p.onAccepted(e.target.checked)} /><span>I have read {scopeText}. This is a fair description of the request. Share its name, summary and needs with the shared matching workspace; my files, original text and capabilities stay private.{open > 0 && <small> Available once the items above are handled.</small>}</span></label>}
      <div className="fs-accept-actions">
        <button type="button" className="fi-link" data-testid="button-edit-description" disabled={locked} onClick={p.onGoDescribe}>Edit description</button>
        <button type="button" className="fi-btn primary fi-btn-lg" data-testid="button-find-solutions" disabled={locked || p.conflict || (!p.serverConfirmed && (!p.accepted || open > 0))} onClick={p.onFind}><Search />{p.finding ? 'Preparing…' : 'Find matching solutions'}<ArrowRight /></button>
      </div>
    </section>

    <details className="fs-details" open={p.detailsOpen} onToggle={e => p.onDetails((e.currentTarget as HTMLDetailsElement).open)}>
      <summary data-testid="button-toggle-details">Analysis details<small>groups, boundaries, source evidence, input coverage, overlaps</small></summary>
      <div className="fs-details-body">{p.details}</div>
    </details>
  </div>;
}
