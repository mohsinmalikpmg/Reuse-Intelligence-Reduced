import { useEffect, useRef, useState } from 'react';
import { Reorder, useDragControls, useReducedMotion } from 'framer-motion';
import { ArrowDown, ArrowUp, Check, Download, GripVertical, Paperclip, Pencil, UploadCloud, X } from 'lucide-react';
import { uploadIntakeFile, type IntakeAttachment } from '@workspace/api-client-react';
import { errorMessage, formatSize, sourceLabels, type Capability, type Field, type Requirement, type Source } from './model';

export function EditCard({ label, field, onSave, onConfirm }: { label: string; field: Field; onSave: (value: string) => void; onConfirm: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.value);
  useEffect(() => { if (!editing) setDraft(field.value); }, [field.value, editing]);
  return <article className={`fi-card ${field.changed ? 'changed' : ''}`}>
    <div className="fi-edit-head"><span className={`fi-dot ${field.reviewed ? 'green' : ''}`} />{label}<button className="fi-icon" aria-label={`Edit ${label}`} onClick={() => setEditing(true)}><Pencil /></button></div>
    {editing ? <form onSubmit={e => { e.preventDefault(); onSave(draft.trim()); setEditing(false); }}>
      <textarea className="fi-input" aria-label={label} autoFocus rows={4} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setEditing(false); }} />
      <div className="fi-actions"><button type="button" className="fi-link" onClick={() => { setDraft(field.value); setEditing(false); }}>Cancel</button><button className="fi-btn" disabled={!draft.trim()}><Check />Save correction</button></div>
    </form> : <><p className="fi-card-value">{field.value || <span className="fi-hint">Not stated in your inputs. Add it yourself.</span>}</p>{field.provenance && <p className="fi-hint">{field.provenance}</p>}{field.changed && <p className="fi-readback">Updated understanding — please read this back before confirming.</p>}
      <div className="fi-review-line">{field.reviewed ? <span className="fi-label"><Check />Confirmed</span> : <><span>{field.changed ? 'Re-review needed' : 'Your review needed'}</span><button className="fi-link" disabled={!field.value.trim()} onClick={onConfirm}>That’s accurate</button></>}</div></>}
  </article>;
}

export function RequirementRow({ item, index, count, onMove, onEdit, onRemove, onConfirm }: { item: Requirement; index: number; count: number; onMove: (offset: number) => void; onEdit: (text: string) => void; onRemove: () => void; onConfirm: () => void }) {
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
      <div className="fi-req-meta"><span>{item.sources.length ? `${item.sources.length} ${item.sources.length === 1 ? 'source' : 'sources'} · ${item.sources.join(' + ')}` : 'Added by you'}{item.provenance ? ` · ${item.provenance}` : ''}</span>{item.reviewed ? <span className="fi-label"><Check />Reviewed</span> : !editing && <button className="fi-link" onClick={onConfirm}>Accurate</button>}</div>
    </div>
    <div className="fi-req-tools"><button className="fi-icon" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move priority ${index + 1} up`}><ArrowUp /></button><button className="fi-icon" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move priority ${index + 1} down`}><ArrowDown /></button></div>
    <div className="fi-req-tools"><button className="fi-icon" aria-label={`Edit priority ${index + 1}`} onClick={() => setEditing(true)}><Pencil /></button><button className="fi-icon" aria-label={`Remove priority ${index + 1}`} onClick={onRemove}><X /></button></div>
  </Reorder.Item>;
}

export function CapabilityCard({ item, sourceName, onSave, onConfirm, onCarry }: { item: Capability; sourceName: string; onSave: (capability: Capability) => void; onConfirm: () => void; onCarry: (carry: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item);
  return <article className={`fi-card fi-cap ${item.changed ? 'changed' : ''}`}>
    <div className="fi-cap-top"><h3>{item.title}</h3><span className={`fi-label ${item.status === 'Confirmed' ? '' : item.status === 'Needs clarification' ? 'warm' : 'blue'}`}>{item.status === 'Confirmed' && <Check />}{item.status}</span></div>
    <p className="fi-card-value">{item.description}</p>
    <p className="fi-hint">From {sourceName} · {item.changed ? 'source or interpretation changed' : item.provenance || 'AI interpretation · check against your material'}</p>
    {editing ? <form onSubmit={e => { e.preventDefault(); onSave(draft); setEditing(false); }}>
      {(['title', 'description', 'workflow', 'input', 'output', 'dependency', 'gap'] as const).map(key => <label className="fi-input-label" key={key}>{key === 'gap' ? 'Open gap (leave blank if resolved)' : key.charAt(0).toUpperCase() + key.slice(1)}<textarea className="fi-input" rows={2} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} required={key !== 'gap'} /></label>)}
      <div className="fi-actions"><button type="button" className="fi-link" onClick={() => setEditing(false)}>Cancel</button><button className="fi-btn">Save correction</button></div>
    </form> : <>
      <details open={item.changed}><summary>Review workflow, inputs, outputs & dependencies</summary><dl><dt>Workflow</dt><dd>{item.workflow}</dd><dt>Input</dt><dd>{item.input}</dd><dt>Output</dt><dd>{item.output}</dd><dt>Dependencies</dt><dd>{item.dependency}</dd></dl></details>
      {item.changed && <p className="fi-readback">This is the revised interpretation. Check each detail before approving again.</p>}
      {item.gap.trim() && <div className="fi-warning"><strong>Open gap</strong><p>{item.gap}</p><label className="fi-check"><input type="checkbox" checked={item.carry} onChange={e => onCarry(e.target.checked)} />Carry this open gap forward for the IT Owner.</label></div>}
      <div className="fi-actions"><button className="fi-link" onClick={() => { setDraft(item); setEditing(true); }}>Correct this understanding</button>{item.status !== 'Confirmed' && <button className="fi-btn" onClick={onConfirm}><Check />Confirm description</button>}</div>
    </>}
  </article>;
}

export const EXT = ['txt', 'md', 'csv', 'json', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'zip', 'tsx', 'ts', 'js', 'jsx', 'py', 'html', 'css', 'xml', 'yaml', 'yml', 'sql'];
export const SAMPLES: Record<Source['id'], { name: string; text: string }> = {
  problem: { name: 'Sample · supervisor problem statement', text: 'Our team reviews a weekly export of maintenance work orders by hand before the planning meeting. Recurring equipment problems are easy to miss across shifts. We want recurring issues grouped by equipment, links back to the original work orders, and suggested next actions that a supervisor decides on. Nothing should change records in the maintenance system automatically.' },
  prototype: { name: 'Sample · spreadsheet prototype', text: 'README (sample): Upload a weekly CSV export. Rows are grouped by equipment and a keyword-based failure theme. Each group shows a short summary and the list of work-order IDs.\nSchema: order_id, equipment_id, description, completion_date.\nDepends on a manual export; no live connection.' },
  agent: { name: 'Sample · assistant instructions', text: 'SYSTEM PROMPT (sample): Use only the work orders supplied in the conversation. Identify recurring issues, suggest next actions for a supervisor, and do not create or modify any records.\nExample input: Pump P-104 seal leak in two work orders.\nExample output: Repeated seal leaks on P-104 — suggest supervisor review.' },
};

/** First few words of free text, used as a default name. */
export function deriveName(text: string, fallback: string, words = 6) {
  const all = text.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (!all.length) return fallback;
  let out = all.slice(0, words).join(' ').replace(/[.,;:!?\-–—]+$/, '');
  if (out.length > 60) out = out.slice(0, 58).trim();
  return all.length > words || out.length < all.join(' ').length ? `${out}…` : out;
}

const PROMPT: Record<Source['id'], { q: string; ph: string }> = {
  problem: { q: 'What are you trying to change?', ph: 'Who is affected, what happens today, and what would better look like?' },
  prototype: { q: 'What have you built?', ph: 'What it does step by step, what goes in and comes out, what it depends on. Paste a README or schema if you have one.' },
  agent: { q: 'How is your agent set up?', ph: 'Paste its instructions, tools and knowledge sources, plus one example of a question and its answer.' },
};

export type SourceCardHandle = { next: () => Source | null };

export function SourceCard({ source, recordId, attachments, privacyOk, onRegister, onDirty, onReading, onUploaded, autoFocus }: { source: Source; recordId: string; attachments: IntakeAttachment[]; privacyOk: boolean; onRegister: (h: SourceCardHandle | null) => void; onDirty: (dirty: boolean) => void; onReading: (reading: boolean) => void; onUploaded: (a: IntakeAttachment) => void; autoFocus?: boolean }) {
  const [draft, setDraft] = useState(source.text);
  const [files, setFiles] = useState(source.files);
  const [name, setName] = useState(source.name);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [showFiles, setShowFiles] = useState(source.files.length > 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const sig = `${source.text}\u0001${source.files.join('|')}\u0001${source.name}`;
  useEffect(() => { setDraft(source.text); setFiles(source.files); setName(source.name); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = draft !== source.text || files.join('|') !== source.files.join('|') || name !== source.name;
  const cbs = useRef({ onDirty, onReading, onRegister });
  cbs.current = { onDirty, onReading, onRegister };
  useEffect(() => { cbs.current.onDirty(changed); }, [changed]);
  useEffect(() => { cbs.current.onReading(reading); }, [reading]);
  const byId = new Map(attachments.map(a => [a.id, a]));
  const autoName = !name.trim() || name === sourceLabels[source.id] || name === deriveName(source.text, sourceLabels[source.id]);
  const effectiveName = autoName ? deriveName(draft, sourceLabels[source.id]) : name.trim();
  const latest = useRef<Source | null>(null);
  latest.current = changed ? { ...source, name: effectiveName, text: draft.trim(), files, supplied: !!(draft.trim() || files.length) } : null;
  useEffect(() => { cbs.current.onRegister({ next: () => latest.current }); return () => cbs.current.onRegister(null); }, []);
  const accept = async (incoming: File[]) => {
    if (!privacyOk) { setError('Tick the privacy check below before uploading files.'); return; }
    if (!incoming.length) return;
    setError(''); setReading(true);
    const errors: string[] = [];
    for (const file of incoming) {
      if (file.size > 10 * 1024 * 1024) { errors.push(`${file.name}: larger than the 10 MB limit.`); continue; }
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!EXT.includes(ext)) { errors.push(`${file.name}: unsupported format. Paste the relevant text instead.`); continue; }
      try {
        const att = await uploadIntakeFile(recordId, { file, sourceId: source.id });
        onUploaded(att);
        setFiles(f => (f.includes(att.id) ? f : [...f, att.id]));
        if (att.status === 'failed') errors.push(`${file.name}: stored, but its contents could not be read${att.error ? ` (${att.error})` : ''}. Describe it in text.`);
      } catch (e) { errors.push(`${file.name}: upload failed — ${errorMessage(e)}`); }
    }
    setError(errors.join(' '));
    setReading(false);
  };
  const p = PROMPT[source.id];
  const empty = !draft && !files.length;
  return <article className="fi-src" data-testid={`card-source-${source.id}`}>
    <div className="fi-src-head">
      <label className="fi-src-q" htmlFor={`source-${source.id}`}>{p.q}</label>
      {source.changed ? <span className="fi-label warm">Changed since interpretation</span> : changed ? <span className="fi-src-state dirty">Not saved yet</span> : source.supplied ? <span className="fi-src-state">Saved</span> : null}
    </div>
    <textarea id={`source-${source.id}`} data-testid={`input-text-${source.id}`} className="fi-src-text" rows={source.id === 'problem' ? 7 : 8} placeholder={p.ph} autoFocus={autoFocus} value={draft} onChange={e => setDraft(e.target.value)} />
    <div className="fi-src-tools">
      {!showFiles && <button type="button" className="fi-ghost" data-testid={`button-attach-${source.id}`} onClick={() => setShowFiles(true)}><Paperclip />Attach files</button>}
      {empty && <button type="button" className="fi-ghost" data-testid={`button-sample-${source.id}`} onClick={() => { setDraft(SAMPLES[source.id].text); setName(SAMPLES[source.id].name); }}>Try an example</button>}
      <details className="fi-src-details"><summary data-testid={`button-details-${source.id}`}>Name: {effectiveName}</summary>
        <label className="fi-input-label" htmlFor={`name-${source.id}`}>Rename this input</label>
        <input id={`name-${source.id}`} data-testid={`input-name-${source.id}`} className="fi-input" placeholder={deriveName(draft, sourceLabels[source.id])} value={autoName ? '' : name} onChange={e => setName(e.target.value)} />
      </details>
    </div>
    {showFiles && <div className="fi-src-files">
      <div className={`fi-dropzone ${over ? 'over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); void accept(Array.from(e.dataTransfer.files)); }}>
        <UploadCloud /><div><strong>{reading ? 'Uploading and reading…' : 'Drop files here'}</strong><p>or <button type="button" className="fi-link" data-testid={`button-files-${source.id}`} disabled={reading || !privacyOk} onClick={() => fileRef.current?.click()}>choose files</button> · 10 MB each</p></div>
        <input ref={fileRef} className="fi-file-input" id={`files-${source.id}`} aria-label={`Choose files for ${sourceLabels[source.id]}`} type="file" multiple accept={EXT.map(x => `.${x}`).join(',')} disabled={reading || !privacyOk} onChange={e => { void accept(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      </div>
      <p className="fi-hint">{privacyOk ? 'Text, code, CSV, JSON, Markdown and readable PDFs are read. Images and ZIPs are kept as references only.' : 'Tick the privacy check below to enable uploads.'}</p>
      {error && <p className="fi-file-error" role="alert">{error} You can retry using “choose files”.</p>}
      {files.map(id => { const a = byId.get(id); return <div className="fi-attached" key={id}><Paperclip /><span>{a ? `${a.name} · ${formatSize(a.size)} · ${a.status === 'extracted' ? 'text read' : a.status === 'reference' ? 'reference only; not read' : `could not be read${a.error ? `: ${a.error}` : ''}`}` : 'Attachment unavailable'}</span>{a && <a className="fi-icon" href={`/api/intake/files/${a.id}`} aria-label={`Download ${a.name}`}><Download /></a>}<button type="button" className="fi-icon" aria-label="Remove file from this input" onClick={() => setFiles(files.filter(f => f !== id))}><X /></button></div>; })}
    </div>}
  </article>;
}
