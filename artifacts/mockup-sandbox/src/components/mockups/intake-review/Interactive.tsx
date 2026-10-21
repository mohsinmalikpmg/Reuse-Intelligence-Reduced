import { useEffect, useRef, useState } from 'react';
import { Reorder, useDragControls, useReducedMotion } from 'framer-motion';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CheckCheck, ChevronRight, FileText, GitBranch, GripVertical, MessageSquare, Paperclip, Pencil, Plus, RotateCcw, ShieldCheck, Undo2, UploadCloud, X } from 'lucide-react';
import './Interactive.css';

type SourceId = 'problem' | 'prototype' | 'agent';
type ProfileKey = 'problem' | 'user' | 'scope' | 'outcome';
type Field = { value: string; reviewed: boolean; changed: boolean };
type Requirement = { id: string; text: string; sources: SourceId[]; reviewed: boolean; changed: boolean };
type Capability = { id: SourceId; title: string; description: string; workflow: string; input: string; output: string; dependency: string; status: 'Described' | 'Inferred' | 'Needs clarification' | 'Confirmed'; changed: boolean; gap: string; carry: boolean };
type Source = { id: SourceId; name: string; text: string; files: string[]; changed: boolean; supplied?: boolean };
type Model = { profile: Record<ProfileKey, Field>; requirements: Requirement[]; capabilities: Capability[]; sources: Source[]; orderReviewed: boolean; safety: string; agreed: boolean; confirmed: boolean };
const labels: Record<ProfileKey, string> = { problem: 'Today · the problem', user: 'Who needs this', scope: 'In scope · and out', outcome: 'Better · the outcome' };
const sourceLabels: Record<SourceId, string> = { problem: 'Business problem', prototype: 'Power Platform prototype', agent: 'Configured agent' };
const sourceShort: Record<SourceId, string> = { problem: 'Problem statement', prototype: 'Pump Watch · Power Apps', agent: 'Maintenance copilot' };
const makeDemo = (): Model => ({
  profile: {
    problem: { value: 'Maintenance supervisors manually read work orders to spot recurring equipment problems. Patterns are easy to miss across shifts.', reviewed: false, changed: false },
    user: { value: 'Maintenance supervisors and reliability engineers at Christina Lake.', reviewed: true, changed: false },
    scope: { value: 'Weekly review of maintenance work orders. Decision support only — no automatic changes to SAP or work instructions.', reviewed: false, changed: false },
    outcome: { value: 'See recurring equipment issues, trace them to work orders, and agree clear next actions before the weekly planning meeting.', reviewed: false, changed: false },
  },
  requirements: [
    { id: 'recurring', text: 'Identify recurring issues by equipment and failure theme.', sources: ['problem', 'prototype', 'agent'], reviewed: false, changed: false },
    { id: 'trace', text: 'Link every finding back to its original work orders.', sources: ['problem', 'prototype'], reviewed: false, changed: false },
    { id: 'safety', text: 'Flag potential safety risks for a supervisor to review.', sources: ['problem', 'agent'], reviewed: false, changed: false },
    { id: 'actions', text: 'Suggest next actions; a supervisor decides what happens.', sources: ['problem', 'agent'], reviewed: false, changed: false },
  ],
  capabilities: [
    { id: 'prototype', title: 'Group work orders into recurring issues', description: 'Pump Watch describes grouping work orders by equipment and displaying issue summaries with source links.', workflow: 'Supervisor uploads weekly export → groups by equipment → reviews recurring themes.', input: 'CSV: order_id, equipment_id, description, completion_date.', output: 'Issue summary, equipment identifier and work-order links.', dependency: 'Manual SAP export; Power Apps and Dataverse access.', status: 'Described', changed: false, gap: 'Live SAP connector and access ownership are not established.', carry: false },
    { id: 'agent', title: 'Draft actions and flag safety concerns', description: 'The configured prompt asks for grounded recommendations and safety flags. It does not establish that these execute reliably.', workflow: 'Receive work-order text → identify themes → draft actions → supervisor review.', input: 'Work-order descriptions and equipment IDs pasted into Copilot Studio.', output: 'Recurring themes, suggested actions and possible safety risks.', dependency: 'Copilot Studio environment; approved maintenance reference content not specified.', status: 'Inferred', changed: false, gap: 'Approved maintenance reference content and its owner are not specified.', carry: false },
  ],
  sources: [
    { id: 'problem', name: 'Supervisor’s problem statement', text: 'We manually review work orders at Christina Lake before weekly planning. We need recurring equipment issues, original work-order links, suggested next actions, and safety risks flagged for supervisors. No automatic SAP updates.', files: [], changed: false },
    { id: 'prototype', name: 'Pump Watch · Power Apps', text: 'DEMO README: Upload a weekly SAP CSV export. Group by equipment and failure theme. Display issue summaries and source work-order IDs.\nSchema: order_id, equipment_id, description, completion_date.\nExample output: P-104 — repeated seal leaks; WO-2187, WO-2213.\nScreenshot description: equipment list with issue cards. No actual screenshot provided.', files: ['README.md · demo description', 'schema.csv · demo description'], changed: false },
    { id: 'agent', name: 'Maintenance copilot · Copilot Studio', text: 'DEMO SYSTEM PROMPT: Use only supplied work orders. Identify recurring issues, suggest next actions and flag potential safety concerns. Do not create work orders or issue instructions.\nExample input: P-104 seal leak reported in WO-2187 and WO-2213.\nExample output: Repeated seal leaks on P-104. Suggest a supervisor review. Potential safety concern: loss of containment.', files: [], changed: false },
  ], orderReviewed: false, safety: '', agreed: false, confirmed: false,
});

// The local EditCard keeps Discover's explicit edit / draft / cancel / save pattern.
function EditCard({ label, field, onSave, onConfirm }: { label: string; field: Field; onSave: (value: string) => void; onConfirm: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.value);
  useEffect(() => { if (!editing) setDraft(field.value); }, [field.value, editing]);
  return <article className={`fi-card ${field.changed ? 'changed' : ''}`}>
    <div className="fi-edit-head"><span className={`fi-dot ${field.reviewed ? 'green' : ''}`} />{label}<button className="fi-icon" aria-label={`Edit ${label}`} onClick={() => setEditing(true)}><Pencil /></button></div>
    {editing ? <form onSubmit={e => { e.preventDefault(); onSave(draft.trim()); setEditing(false); }}>
      <textarea className="fi-input" aria-label={label} autoFocus rows={4} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setEditing(false); }} />
      <div className="fi-actions"><button type="button" className="fi-link" onClick={() => { setDraft(field.value); setEditing(false); }}>Cancel</button><button className="fi-btn" disabled={!draft.trim()}><Check />Save correction</button></div>
    </form> : <><p className="fi-card-value">{field.value}</p>{field.changed && <p className="fi-readback">Updated understanding — please read this back before confirming.</p>}
      <div className="fi-review-line">{field.reviewed ? <span className="fi-label"><Check />Confirmed</span> : <><span>{field.changed ? 'Re-review needed' : 'Your review needed'}</span><button className="fi-link" onClick={onConfirm}>That’s accurate</button></>}</div></>}
  </article>;
}

function RequirementRow({ item, index, count, onMove, onEdit, onRemove, onConfirm }: { item: Requirement; index: number; count: number; onMove: (offset: number) => void; onEdit: (text: string) => void; onRemove: () => void; onConfirm: () => void }) {
  const controls = useDragControls();
  const reduced = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  useEffect(() => { if (!editing) setDraft(item.text); }, [item.text, editing]);
  return <Reorder.Item value={item} dragListener={false} dragControls={controls} className={`fi-req ${item.changed ? 'changed' : ''}`} layout="position" transition={{ duration: reduced ? 0 : .18 }} style={item.changed ? { borderLeft: '3px solid #b77851' } : undefined}>
    <button className="fi-icon fi-handle" aria-label={`Drag priority ${index + 1}: ${item.text}. Use the adjacent move buttons as a keyboard alternative.`} onPointerDown={e => controls.start(e)}><GripVertical /></button>
    <span className="fi-number" aria-label={`Priority ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>
    <div className="fi-req-body">{editing ? <form onSubmit={e => { e.preventDefault(); onEdit(draft.trim()); setEditing(false); }}><textarea aria-label="Requirement wording" className="fi-input" value={draft} autoFocus rows={2} onChange={e => setDraft(e.target.value)} /><div className="fi-actions"><button type="button" className="fi-link" onClick={() => setEditing(false)}>Cancel</button><button className="fi-btn" disabled={!draft.trim()}>Save correction</button></div></form> : <p className="fi-req-title">{item.text}</p>}
      {item.changed && <p className="fi-readback">Changed understanding — re-read and confirm.</p>}
      <div className="fi-req-meta"><span>{item.sources.length} {item.sources.length === 1 ? 'source' : 'sources'} · {item.sources.map(s => s === 'problem' ? 'problem' : s === 'prototype' ? 'prototype' : 'agent').join(' + ')}</span>{item.reviewed ? <span className="fi-label"><Check />Reviewed</span> : !editing && <button className="fi-link" onClick={onConfirm}>Accurate</button>}</div>
    </div>
    <div className="fi-req-tools"><button className="fi-icon" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move priority ${index + 1} up`}><ArrowUp /></button><button className="fi-icon" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move priority ${index + 1} down`}><ArrowDown /></button></div>
    <div className="fi-req-tools"><button className="fi-icon" aria-label={`Edit priority ${index + 1}`} onClick={() => setEditing(true)}><Pencil /></button><button className="fi-icon" aria-label={`Remove priority ${index + 1}`} onClick={onRemove}><X /></button></div>
  </Reorder.Item>;
}

function CapabilityCard({ item, onSave, onConfirm, onCarry }: { item: Capability; onSave: (capability: Capability) => void; onConfirm: () => void; onCarry: (carry: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item);
  return <article className={`fi-card fi-cap ${item.changed ? 'changed' : ''}`}>
    <div className="fi-cap-top"><h3>{item.title}</h3><span className={`fi-label ${item.status === 'Confirmed' ? '' : item.status === 'Needs clarification' ? 'warm' : 'blue'}`}>{item.status === 'Confirmed' && <Check />}{item.status}</span></div>
    <p className="fi-card-value">{item.description}</p>
    <p className="fi-hint">From {sourceShort[item.id]} · {item.changed ? 'source or interpretation changed' : 'illustrative demo interpretation'}</p>
    {editing ? <form onSubmit={e => { e.preventDefault(); onSave(draft); setEditing(false); }}>
      {(['title', 'description', 'workflow', 'input', 'output', 'dependency', 'gap'] as const).map(key => <label className="fi-input-label" key={key}>{key === 'gap' ? 'Open gap (leave blank if resolved)' : key.charAt(0).toUpperCase() + key.slice(1)}<textarea className="fi-input" rows={2} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} required={key !== 'gap'} /></label>)}
      <div className="fi-actions"><button type="button" className="fi-link" onClick={() => setEditing(false)}>Cancel</button><button className="fi-btn">Save correction</button></div>
    </form> : <>
      <details open={item.changed}><summary>Review workflow, inputs, outputs & dependencies</summary><dl><dt>Workflow</dt><dd>{item.workflow}</dd><dt>Input</dt><dd>{item.input}</dd><dt>Output</dt><dd>{item.output}</dd><dt>Dependencies</dt><dd>{item.dependency}</dd></dl></details>
      {item.changed && <p className="fi-readback">This is the revised interpretation. Check each detail before approving again.</p>}
      {item.gap && <div className="fi-warning"><strong>Open gap</strong><p>{item.gap}</p><label className="fi-check"><input type="checkbox" checked={item.carry} onChange={e => onCarry(e.target.checked)} />Carry this gap forward for the IT Owner; it is not resolved.</label></div>}
      <div className="fi-actions"><button className="fi-link" onClick={() => { setDraft(item); setEditing(true); }}>Correct this understanding</button>{item.status !== 'Confirmed' && <button className="fi-btn" onClick={onConfirm}><Check />Confirm description</button>}</div>
    </>}
  </article>;
}

function SourceCard({ source, onSave, onDirty }: { source: Source; onSave: (next: Source) => void; onDirty: (dirty: boolean) => void }) {
  const [draft, setDraft] = useState(source.text);
  const [files, setFiles] = useState(source.files);
  const [name, setName] = useState(source.name);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [permission, setPermission] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(source.text); setFiles(source.files); setName(source.name); setPermission(false); }, [source]);
  const changed = draft !== source.text || files.join('|') !== source.files.join('|') || name !== source.name;
  const dirtyCallback = useRef(onDirty);
  dirtyCallback.current = onDirty;
  useEffect(() => { dirtyCallback.current(changed); }, [changed]);
  const accept = async (incoming: File[]) => {
    setError('');
    setReading(true);
    const errors: string[] = [];
    const entries: string[] = [];
    const excerpts: string[] = [];
    for (const file of incoming) {
      if (file.size > 2 * 1024 * 1024) { errors.push(`${file.name}: larger than the 2 MB local-preview limit.`); continue; }
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!['txt', 'md', 'csv', 'json', 'pdf', 'png', 'jpg', 'jpeg', 'zip', 'tsx', 'ts', 'js', 'py'].includes(ext)) { errors.push(`${file.name}: unsupported format. Paste the relevant text instead.`); continue; }
      if (['txt', 'md', 'csv', 'json', 'tsx', 'ts', 'js', 'py'].includes(ext)) {
        try {
          const text = await file.text();
          if (text.includes('\0')) { errors.push(`${file.name}: could not read as plain text.`); continue; }
          excerpts.push(`\n\n--- Supplied file: ${file.name} ---\n${text}`);
          entries.push(`${file.name} · text read locally`);
        } catch { errors.push(`${file.name}: could not read. Please try again or paste its contents.`); }
      } else entries.push(`${file.name} · reference only; contents not read`);
    }
    setDraft(d => d + excerpts.join(''));
    setFiles(f => [...new Set([...f, ...entries])]);
    setError(errors.join(' '));
    setPermission(false);
    setReading(false);
  };
  const isProblem = source.id === 'problem';
  const guidance = isProblem ? 'Who is affected? What happens today? What would better look like? What must not change?' : source.id === 'prototype' ? 'What does it do, step by step? Include its data schema, a worked example, and anything it depends on.' : 'Paste its instructions, tools and knowledge sources. Include one example of what you asked and what it returned.';
  return <article className="fi-card fi-source fi-collection-card">
    <div className="fi-source-top"><div><p className="fi-input-kicker">{isProblem ? '01 / THE NEED' : source.id === 'prototype' ? '02 / THE SOLUTION' : '03 / THE AGENT'}</p><h3>{isProblem ? 'Tell us what needs to change.' : source.id === 'prototype' ? 'Show us what you’ve built.' : 'Bring the instructions behind the agent.'}</h3></div><span className="fi-label blue">{source.changed ? 'Changed source' : source.supplied ? 'Supplied material' : 'Sample material'}</span></div>
    <p className="fi-input-guidance">{guidance}</p>
    <label className="fi-input-label" htmlFor={`name-${source.id}`}>Give this input a name</label>
    <input id={`name-${source.id}`} className="fi-input" value={name} onChange={e => setName(e.target.value)} />
    <div className="fi-editor-label"><label className="fi-input-label" htmlFor={`source-${source.id}`}>{isProblem ? 'Describe it in your own words' : source.id === 'prototype' ? 'Description, README or schema' : 'Instructions and example input / output'}</label><span>Paste or write</span></div>
    <textarea id={`source-${source.id}`} className="fi-input fi-source-text" rows={isProblem ? 6 : 8} value={draft} onChange={e => { setDraft(e.target.value); setPermission(false); }} />
    <div className="fi-source-prompts"><strong>Helpful to include</strong>{(isProblem ? ['People & context', 'Today’s process', 'Desired outcome', 'Constraints'] : source.id === 'prototype' ? ['Workflow', 'Input → output', 'Data model', 'Dependencies'] : ['System prompt', 'Tools & knowledge', 'Example conversation', 'Dependencies']).map(t => <span key={t}>{t}</span>)}</div>
    <div className={`fi-dropzone ${over ? 'over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); void accept(Array.from(e.dataTransfer.files)); }}>
      <UploadCloud /><div><strong>{reading ? 'Reading local text…' : 'Drop supporting files here'}</strong><p>or <button className="fi-link" disabled={reading} onClick={() => fileRef.current?.click()}>choose files</button> · up to 2 MB each</p></div>
      <input ref={fileRef} className="fi-file-input" id={`files-${source.id}`} aria-label={`Choose files for ${sourceLabels[source.id]}`} type="file" multiple accept=".txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.zip,.tsx,.ts,.js,.py" disabled={reading} onChange={e => { void accept(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
    </div>
    <p className="fi-hint">Text and code files are read into the box above, in this browser only. PDFs, images and ZIPs are listed as references only; describe their contents in text. Nothing is uploaded or interpreted.</p>
    {error && <p className="fi-file-error" role="alert">{error} You can retry using “choose files”.</p>}
    {files.map((f, i) => <div className="fi-attached" key={`${f}-${i}`}><Paperclip /><span>{f}</span><button className="fi-icon" aria-label={`Remove ${f}`} onClick={() => setFiles(files.filter((_, index) => index !== i))}><X /></button></div>)}
    {changed && <label className="fi-check fi-permission"><input type="checkbox" checked={permission} onChange={e => setPermission(e.target.checked)} />I have removed credentials, personal information and restricted data from this material.</label>}
    <div className="fi-source-save"><span>{changed ? 'Unsaved changes · this preview does not extract meaning' : source.supplied ? 'Kept in this session only · not saved after refresh' : 'Illustrative example loaded · replace any text to try it'}</span><button className="fi-btn primary" disabled={!changed || !permission || !draft.trim() || !name.trim() || reading} onClick={() => onSave({ ...source, name: name.trim(), text: draft.trim(), files, changed: true, supplied: true })}><Check />Keep this input</button></div>
  </article>;
}

export default function Interactive() {
  const [model, setModel] = useState<Model>(makeDemo);
  const [stage, setStageState] = useState<'inputs' | 'review' | 'confirm'>('inputs');
  const dirtyInputs = useRef<Partial<Record<SourceId, boolean>>>({});
  const setStage = (next: 'inputs' | 'review' | 'confirm') => {
    if (stage === 'inputs' && next !== 'inputs' && Object.values(dirtyInputs.current).some(Boolean)) {
      setNotice('Keep your changed inputs before leaving this step. Unsaved drafts are preserved when switching input types.');
      return;
    }
    setStageState(next);
  };
  const [inputType, setInputType] = useState<SourceId>('problem');
  const [tab, setTab] = useState<'priorities' | 'profile' | 'capabilities'>('priorities');
  const [notice, setNotice] = useState('Sample intake loaded. Bring any combination of a need, prototype or agent; no files leave this browser.');
  const [extra, setExtra] = useState('');
  const [answer, setAnswer] = useState('');
  const [customAnswer, setCustomAnswer] = useState('');
  const [historyCount, setHistoryCount] = useState(0);
  const history = useRef<Model[]>([]);
  const dragging = useRef(false);
  const commit = (next: Model, message: string) => {
    history.current.push(structuredClone(model)); setHistoryCount(history.current.length);
    setModel({ ...next, confirmed: false, agreed: false }); setNotice(message);
  };
  const undo = () => { const previous = history.current.pop(); if (previous) { setModel(previous); setHistoryCount(history.current.length); setNotice('Last change undone. The previous review state has been restored.'); } };
  const editProfile = (key: ProfileKey, value: string) => {
    const affectsRequirements = key === 'problem' || key === 'outcome' || key === 'scope';
    commit({ ...model, profile: { ...model.profile, [key]: { value, reviewed: false, changed: true } }, requirements: affectsRequirements ? model.requirements.map(r => r.sources.includes('problem') ? { ...r, reviewed: false, changed: true } : r) : model.requirements, orderReviewed: affectsRequirements ? false : model.orderReviewed }, 'Correction saved. Read the updated interpretation before confirming; related needs need re-review.');
  };
  const setRequirements = (requirements: Requirement[], message: string) => commit({ ...model, requirements, orderReviewed: false }, message);
  const reorder = (requirements: Requirement[]) => {
    if (!dragging.current) { history.current.push(structuredClone(model)); setHistoryCount(history.current.length); dragging.current = true; }
    setModel(m => ({ ...m, requirements, orderReviewed: false, confirmed: false, agreed: false })); setNotice('Priority order changed. Numbers now reflect the new order.');
  };
  const updateSource = (source: Source) => {
    const affectedProfile = source.id === 'problem';
    commit({ ...model, sources: model.sources.map(s => s.id === source.id ? source : s),
      profile: affectedProfile ? Object.fromEntries(Object.entries(model.profile).map(([k, f]) => [k, { ...f, reviewed: false, changed: true }])) as Model['profile'] : model.profile,
      requirements: model.requirements.map(r => r.sources.includes(source.id) ? { ...r, reviewed: false, changed: true } : r),
      capabilities: model.capabilities.map(c => c.id === source.id ? { ...c, status: 'Needs clarification', changed: true, carry: false } : c),
      orderReviewed: model.requirements.some(r => r.sources.includes(source.id)) ? false : model.orderReviewed,
    }, `${sourceLabels[source.id]} changed. Affected interpretations are retained, highlighted and unconfirmed — no extraction was performed.`);
  };
  const applyAnswer = () => {
    const text = answer === 'other' ? customAnswer.trim() : answer;
    if (!text) return;
    const wording = answer === 'flag' ? 'Flag potential safety risks for supervisor review; never issue safety instructions.' : answer === 'exclude' ? 'Exclude safety-risk assessment; surface recurring issues for supervisor review only.' : text;
    const existing = model.requirements.some(r => r.id === 'safety');
    const requirements = existing ? model.requirements.map(r => r.id === 'safety' ? { ...r, text: wording, reviewed: false, changed: true } : r) : [...model.requirements, { id: 'safety', text: wording, sources: ['problem', 'agent'] as SourceId[], reviewed: false, changed: true }];
    commit({ ...model, requirements, safety: wording, orderReviewed: false, capabilities: model.capabilities.map(c => c.id === 'agent' ? { ...c, output: answer === 'exclude' ? 'Recurring themes and suggested actions; safety-risk assessment is excluded.' : `Recurring themes and suggested actions. Safety boundary: ${wording}`, changed: true, status: 'Needs clarification' } : c) }, 'Your answer updated the safety requirement and agent output. Read both revised interpretations before confirming.');
    setTab('priorities');
  };
  const profileReady = Object.values(model.profile).every(f => f.reviewed && f.value.trim());
  const needsReady = model.requirements.length > 0 && model.requirements.every(r => r.reviewed) && model.orderReviewed;
  const capsReady = model.capabilities.every(c => c.status === 'Confirmed' && (!c.gap || c.carry));
  const sourcesReady = model.sources.every(s => !s.changed);
  const ready = profileReady && needsReady && capsReady && sourcesReady;
  const gaps = model.capabilities.filter(c => c.gap);
  const reviewedCount = Object.values(model.profile).filter(f => f.reviewed).length + model.requirements.filter(r => r.reviewed).length + model.capabilities.filter(c => c.status === 'Confirmed').length;
  const total = 4 + model.requirements.length + model.capabilities.length;
  const nextReview = () => { if (!profileReady) setTab('profile'); else if (!needsReady) setTab('priorities'); else if (!capsReady) setTab('capabilities'); else { setStage('inputs'); return; } setStage('review'); };

  return <main className="fi">
    <header className="fi-header"><div className="fi-brand"><img src="/__mockup/brand/fusebox-logo-light.svg" alt="FUSEBOX" style={{height:28,width:'auto'}} /><span className="fi-brand-sub"><img src="/__mockup/brand/cenovus-energy-logo.png" alt="Cenovus Energy" style={{height:30,width:'auto',background:'white',padding:6,borderRadius:4}} /></span></div><div className="fi-header-right"><span className="fi-person"><span className="fi-avatar">SK</span>Solution seeker</span><span className="fi-person"><span className="fi-avatar owner">IT</span>IT Owner</span><span className="fi-label blue">Local demo</span></div></header>
    <div className="fi-wrap">
      <div className="fi-stage">01 / Trace · Shared understanding</div>
      <div className="fi-intro"><div><h1>{stage === 'inputs' ? <>Bring the problem.<br /><em>And what you’ve tried.</em></> : model.confirmed ? <>A shared starting point.<br /><em>Not a verdict.</em></> : <>Get the understanding <em>right.</em></>}</h1><p>{stage === 'inputs' ? 'A business need, a working sketch, a configured agent — bring any combination. We keep what you need distinct from what you built.' : 'Before we compare products, let’s agree on the problem, the priorities and what your prototype actually describes.'}</p></div><span className="fi-label"><GitBranch />Maintenance · Christina Lake</span></div>
      <nav className="fi-steps" aria-label="Intake stages">{([['inputs', '01', 'Bring your inputs'], ['review', '02', 'Review & refine'], ['confirm', '03', 'Agree on the profile']] as const).map(([key, n, text]) => <button key={key} aria-current={stage === key ? 'step' : undefined} className={stage === key ? 'active' : ''} onClick={() => setStage(key)}><b>{n}</b>{text}{(key === 'inputs' && sourcesReady || key === 'confirm' && model.confirmed) && <Check />}</button>)}</nav>

      <div className="fi-layout"><div className="fi-main">
        {stage === 'inputs' ? <section>
          <div className="fi-section-head"><h2>What are you bringing?</h2><span className="fi-label blue">Mix and match</span></div><p className="fi-sub">Start anywhere. You don’t need a prototype, or all the answers, to describe a need.</p>
          <div className="fi-input-types" role="tablist" aria-label="Input type">
            {(['problem', 'prototype', 'agent'] as const).map(id => { const Icon = id === 'problem' ? MessageSquare : id === 'prototype' ? FileText : GitBranch; return <button key={id} id={`input-tab-${id}`} role="tab" aria-selected={inputType === id} aria-controls="input-panel" tabIndex={inputType === id ? 0 : -1} className={inputType === id ? 'active' : ''} onClick={() => setInputType(id)} onKeyDown={e => { const types: SourceId[] = ['problem', 'prototype', 'agent']; if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const next = types[(types.indexOf(id) + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; setInputType(next); document.getElementById(`input-tab-${next}`)?.focus(); } }}><Icon /><strong>{id === 'problem' ? 'A business need' : id === 'prototype' ? 'A prototype / solution' : 'A configured agent'}</strong><small>{id === 'problem' ? 'The problem & context' : id === 'prototype' ? 'What you’ve already built' : 'Instructions & examples'}</small></button>; })}
          </div>
          <div id="input-panel" role="tabpanel" aria-labelledby={`input-tab-${inputType}`}>
          {model.sources.map(source => <div key={source.id} hidden={inputType !== source.id}><SourceCard source={source} onSave={updateSource} onDirty={dirty => { dirtyInputs.current[source.id] = dirty; }} /></div>)}
          </div>
          {!sourcesReady && <div className="fi-warning"><strong>Source changes are waiting for your interpretation.</strong><p>We have kept your previous edits, not replaced them with guesses. Review highlighted needs and descriptions against your supplied text. Confirming the source check below does not approve those interpretations.</p><button className="fi-btn" onClick={() => commit({ ...model, sources: model.sources.map(s => ({ ...s, changed: false })) }, 'Source changes acknowledged. Affected items still need explicit review and confirmation.')}>I understand — I’ll refine the highlighted items</button></div>}
          <div className="fi-actions"><button className="fi-btn primary" onClick={() => { setStage('review'); setTab('profile'); }}>Review the understanding<ArrowRight /></button></div>
        </section> : stage === 'review' ? <>
          <nav className="fi-tabs" aria-label="Review sections">{([['priorities', 'Needs & priorities', model.requirements.length], ['profile', 'Shared profile', 4], ['capabilities', 'What you’ve built', model.capabilities.length]] as const).map(([key, title, n]) => <button key={key} className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{title}<span>{n}</span></button>)}</nav>
          {tab === 'priorities' ? <section><div className="fi-section-head"><h2>What matters most?</h2><span className="fi-label blue">One shared list</span></div><p className="fi-sub">Combined across your inputs. Drag to rank; use the arrows if you prefer. Correct anything that isn’t quite right.</p>
            {model.requirements.length ? <Reorder.Group axis="y" values={model.requirements} onReorder={reorder} className="fi-priorities" onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}>{model.requirements.map((r, i) => <RequirementRow key={r.id} item={r} index={i} count={model.requirements.length}
              onMove={offset => { const next = [...model.requirements]; [next[i], next[i + offset]] = [next[i + offset], next[i]]; setRequirements(next, `Moved requirement to priority ${i + offset + 1}.`); }}
              onEdit={text => setRequirements(model.requirements.map(x => x.id === r.id ? { ...x, text, reviewed: false, changed: true } : x), 'Requirement corrected. Please read the updated wording and confirm.')}
              onRemove={() => setRequirements(model.requirements.filter(x => x.id !== r.id), 'Requirement removed. Undo restores it with its previous priority and review state.')}
              onConfirm={() => commit({ ...model, requirements: model.requirements.map(x => x.id === r.id ? { ...x, reviewed: true, changed: false } : x) }, `Priority ${i + 1} wording confirmed.`)} />)}</Reorder.Group> : <div className="fi-empty"><h3>No requirements yet</h3><p>Add the first need below. At least one reviewed need is required.</p></div>}
            <form className="fi-add" onSubmit={e => { e.preventDefault(); const text = extra.trim(); if (!text) return; if (model.requirements.some(r => r.text.toLowerCase() === text.toLowerCase())) { setNotice('That need already exists. Edit the existing item instead.'); return; } setRequirements([...model.requirements, { id: `need-${Date.now()}`, text, sources: ['problem'], reviewed: false, changed: true }], 'Need added from your refinement. Review the wording before approving.'); setExtra(''); }}><input className="fi-input" aria-label="Add a missing requirement" placeholder="Something we missed?" value={extra} onChange={e => setExtra(e.target.value)} /><button className="fi-btn" disabled={!extra.trim()}><Plus />Add need</button></form>
            <div className="fi-order-note"><GitBranch /><p>“Recurring issues” appeared in all three inputs. It is one need here, with all three sources retained — not three votes for the same feature.</p></div>
            <div className="fi-actions"><span className="fi-hint">Confirm each wording, then approve the order.</span><button className="fi-btn" disabled={!model.requirements.length || !model.requirements.every(r => r.reviewed) || model.orderReviewed} onClick={() => commit({ ...model, orderReviewed: true }, 'The current requirement order is agreed.')}>{model.orderReviewed ? <CheckCheck /> : <Check />}{model.orderReviewed ? 'Order agreed' : 'Agree this priority order'}</button></div>
          </section> : tab === 'profile' ? <section><div className="fi-section-head"><h2>Here is what we understood</h2></div><p className="fi-sub">Your edits win. Save a correction, read it back, then confirm the interpretation.</p><div className="fi-profile-grid">{(Object.keys(labels) as ProfileKey[]).map(k => <EditCard key={k} label={labels[k]} field={model.profile[k]} onSave={v => editProfile(k, v)} onConfirm={() => commit({ ...model, profile: { ...model.profile, [k]: { ...model.profile[k], reviewed: true, changed: false } } }, `${labels[k]} confirmed as accurate.`)} />)}</div></section> :
          <section><h2>What your prototype and agent describe</h2><p className="fi-sub">Review the two tracks independently. Confirmation means an accurate description, not verified execution.</p>{model.capabilities.map(c => <CapabilityCard key={c.id} item={c}
            onSave={next => commit({ ...model, capabilities: model.capabilities.map(x => x.id === c.id ? { ...next, status: 'Needs clarification', changed: true, carry: false } : x) }, 'Capability corrected. The revised workflow, input, output and dependencies are ready for re-review.')}
            onConfirm={() => commit({ ...model, capabilities: model.capabilities.map(x => x.id === c.id ? { ...x, status: 'Confirmed', changed: false } : x) }, 'Capability description confirmed. Nothing was executed or verified.')}
            onCarry={carry => commit({ ...model, capabilities: model.capabilities.map(x => x.id === c.id ? { ...x, carry } : x) }, carry ? 'Open gap acknowledged for later review with the IT Owner.' : 'Gap acknowledgement removed. It must be acknowledged or resolved before final confirmation.')} />)}</section>}
        </> : <section>
          {model.confirmed ? <div className="fi-success"><CheckCheck /><h2>Understanding agreed.</h2><p>This local profile is ready for a later comparison conversation. No products have been matched, and no capability has been proven to work.</p><button className="fi-btn" style={{ marginTop: 15 }} onClick={() => { setStage('review'); setTab('profile'); }}>Return to review</button></div> : <><h2>One last read, together.</h2><p className="fi-sub">Confirm the shared profile and the gaps you are intentionally carrying forward.</p></>}
          <article className="fi-card fi-summary"><h3>The agreed profile</h3><dl>{(Object.keys(labels) as ProfileKey[]).map(k => <div key={k} style={{ display: 'contents' }}><dt>{k === 'problem' ? 'Problem' : k === 'user' ? 'People' : k === 'scope' ? 'Scope' : 'Outcome'}</dt><dd>{model.profile[k].value}{!model.profile[k].reviewed && <p className="fi-readback">Not yet confirmed</p>}</dd></div>)}</dl></article>
          <article className="fi-card fi-summary"><h3>Needs, in priority order</h3><ol>{model.requirements.map(r => <li key={r.id}>{r.text}{!r.reviewed && <small> · Review needed</small>}</li>)}</ol>{!model.requirements.length && <p>No needs recorded.</p>}{!model.orderReviewed && <p className="fi-readback">Priority order is not yet agreed.</p>}</article>
          <article className="fi-card fi-summary"><h3>Capability descriptions</h3>{model.capabilities.map(c => <div className="fi-gap" key={c.id}><strong>{c.title} · {c.status}</strong><p>{c.description}</p><p><strong>Workflow:</strong> {c.workflow}</p><p><strong>Input:</strong> {c.input}</p><p><strong>Output:</strong> {c.output}</p><p><strong>Dependencies:</strong> {c.dependency}</p><p className="fi-hint">Source: {sourceShort[c.id]}. Not execution evidence.</p></div>)}</article>
          <article className="fi-card fi-summary"><h3>Open gaps for the IT Owner</h3>{gaps.length ? gaps.map(c => <div className="fi-gap" key={c.id}><strong>{sourceShort[c.id]}</strong><p>{c.gap}</p><span className={`fi-label ${c.carry ? '' : 'warm'}`}>{c.carry ? 'Acknowledged · carried forward' : 'Acknowledgement needed'}</span></div>) : <p>No open gaps recorded.</p>}</article>
          {!ready && <div className="fi-warning"><strong>Not ready to agree yet.</strong><p>{[!profileReady && 'Review the essential profile fields.', !needsReady && 'Review each need and agree the priority order.', !capsReady && 'Confirm capability descriptions and acknowledge open gaps.', !sourcesReady && 'Acknowledge changed sources and refine their interpretations.'].filter(Boolean).join(' ')}</p><button className="fi-link" onClick={nextReview}>Go to the next review item</button></div>}
          {!model.confirmed && <><label className="fi-check"><input type="checkbox" checked={model.agreed} disabled={!ready} onChange={e => setModel({ ...model, agreed: e.target.checked })} />This accurately describes our need and the supplied prototype / agent. I acknowledge the listed open gaps. This is not proof that a solution works.</label><div className="fi-actions"><button className="fi-btn sienna" disabled={!ready || !model.agreed} onClick={() => { history.current.push(structuredClone(model)); setHistoryCount(history.current.length); setModel({ ...model, confirmed: true }); setNotice('Shared understanding confirmed locally. No matching or verification has taken place.'); }}><CheckCheck />Confirm shared understanding</button></div></>}
        </section>}
      </div>

      <aside className="fi-aside">
        {stage === 'inputs' ? <>
          <section className="fi-input-aside"><p className="fi-aside-title">YOUR INTAKE PACKET</p><h3>A little context goes a long way.</h3><p>You can add to this packet as the conversation develops.</p><ol>{model.sources.map(s => <li key={s.id}><button onClick={() => setInputType(s.id)}><span className="fi-packet-icon">{s.id === 'problem' ? <MessageSquare /> : s.id === 'prototype' ? <FileText /> : <GitBranch />}</span><span><strong>{s.name}</strong><small>{s.changed ? 'Your changes · needs re-review' : 'Illustrative sample'} · {s.files.length} {s.files.length === 1 ? 'file' : 'files'}</small></span><ChevronRight /></button></li>)}</ol></section>
          <section className="fi-aside-card fi-expectations"><h3>What happens next?</h3><p><b>1</b> Read needs and capabilities separately.</p><p><b>2</b> Bring them into one shared profile.</p><p><b>3</b> Correct the details and rank priorities together.</p><span className="fi-label warm">Demo review · not automatic extraction</span></section>
          <section className="fi-privacy"><ShieldCheck /><div><h3>Only share what’s safe.</h3><p>Use sanitized examples. Remove secrets, credentials and restricted data. This preview reads text locally; attachments are not uploaded or saved after a refresh.</p></div></section>
        </> : <section className="fi-question"><p className="fi-aside-title">One thing to clarify</p><h3>What should happen when a safety concern appears?</h3><p>A flag and an instruction are different needs. Let’s make the boundary explicit.</p>
          <label><input type="radio" name="safety" checked={answer === 'flag'} onChange={() => setAnswer('flag')} />Flag it for a supervisor. Don’t issue instructions.</label>
          <label><input type="radio" name="safety" checked={answer === 'exclude'} onChange={() => setAnswer('exclude')} />Keep safety-risk assessment out of scope.</label>
          <label><input type="radio" name="safety" checked={answer === 'other'} onChange={() => setAnswer('other')} />Let me describe the boundary.</label>
          {answer === 'other' && <textarea aria-label="Describe the safety boundary" className="fi-input" style={{ marginTop: 10 }} rows={3} value={customAnswer} onChange={e => setCustomAnswer(e.target.value)} />}
          <button className="fi-btn" disabled={!answer || answer === 'other' && !customAnswer.trim()} onClick={() => { applyAnswer(); setStage('review'); }}>Apply & review changes<ArrowRight /></button>
          {model.safety && <p className="fi-hint" style={{ marginTop: 12 }}>Current answer: {model.safety}</p>}
        </section>}
        {stage !== 'inputs' && <section className="fi-aside-card"><h3>Three inputs. One understanding.</h3><p>Needs stay separate from implementation choices. Their provenance stays attached.</p>{model.sources.map(s => <div className="fi-source-mini" key={s.id}><span>{s.id === 'problem' ? <MessageSquare /> : s.id === 'prototype' ? <FileText /> : <GitBranch />}{s.id === 'problem' ? 'Problem statement' : s.id === 'prototype' ? 'Power Apps prototype' : 'Copilot Studio agent'}</span>{s.changed ? <span style={{ color: '#a45632' }}>Changed</span> : <Check />}</div>)}<button className="fi-link" onClick={() => setStage('inputs')}>Inspect or change inputs</button><div className="fi-mini-flow"><span>Needs</span><Plus /><span>Capabilities</span><ChevronRight /><span>Profile</span></div></section>}
        <p className="fi-demo">ILLUSTRATIVE DEMO<br />No AI interpretation, upload, persistence or execution. Text files can be read locally; their meaning is never automatically extracted. Review confirms meaning — not performance.</p>
      </aside></div>
      <footer className="fi-bottom"><div><strong>{model.confirmed ? 'Shared understanding confirmed' : `${reviewedCount} of ${total} interpretations reviewed`}</strong><small>{model.orderReviewed ? 'Priority order agreed' : 'Priority order needs agreement'} · {gaps.filter(c => c.carry).length} open gaps acknowledged</small></div><div className="fi-bottom-actions">{stage === 'confirm' ? <button className="fi-btn" onClick={() => setStage('review')}><ArrowLeft />Back to review</button> : <><button className="fi-btn" onClick={() => { if (stage === 'inputs') setStage('review'); else { setStage('review'); setTab(tab === 'priorities' ? 'profile' : tab === 'profile' ? 'capabilities' : 'priorities'); } }}>{stage === 'inputs' ? 'Return to review' : tab === 'priorities' ? 'Review the profile' : tab === 'profile' ? 'Review capabilities' : 'Review needs'}<ArrowRight /></button><button className="fi-btn primary" onClick={() => setStage('confirm')}>Review final agreement<ArrowRight /></button></>}</div></footer>
      <div className="fi-feedback" role="status" aria-live="polite"><span>{notice}</span><button className="fi-icon" disabled={!historyCount} onClick={undo} aria-label="Undo last change"><Undo2 /></button><button className="fi-link" onClick={() => { if (window.confirm('Reset all local edits and return to the maintenance demo?')) { history.current.push(structuredClone(model)); setHistoryCount(history.current.length); setModel(makeDemo()); setStage('review'); setTab('priorities'); setAnswer(''); setCustomAnswer(''); setNotice('Maintenance demo reset. Undo can restore your previous profile.'); } }}><RotateCcw style={{ display: 'inline', width: 12, height: 12, marginRight: 4 }} />Reset demo</button></div>
    </div>
  </main>;
}
