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
      {item.gap.trim() && <div className="fi-warning"><strong>Open gap</strong><p>{item.gap}</p><label className="fi-check"><input type="checkbox" checked={item.carry} onChange={e => onCarry(e.target.checked)} />Carry this gap forward for the IT Owner; it is not resolved.</label></div>}
      <div className="fi-actions"><button className="fi-link" onClick={() => { setDraft(item); setEditing(true); }}>Correct this understanding</button>{item.status !== 'Confirmed' && <button className="fi-btn" onClick={onConfirm}><Check />Confirm description</button>}</div>
    </>}
  </article>;
}

const EXT = ['txt', 'md', 'csv', 'json', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'zip', 'tsx', 'ts', 'js', 'jsx', 'py', 'html', 'css', 'xml', 'yaml', 'yml', 'sql'];
const SAMPLES: Record<Source['id'], { name: string; text: string }> = {
  problem: { name: 'Sample · supervisor problem statement', text: 'Our team reviews a weekly export of maintenance work orders by hand before the planning meeting. Recurring equipment problems are easy to miss across shifts. We want recurring issues grouped by equipment, links back to the original work orders, and suggested next actions that a supervisor decides on. Nothing should change records in the maintenance system automatically.' },
  prototype: { name: 'Sample · spreadsheet prototype', text: 'README (sample): Upload a weekly CSV export. Rows are grouped by equipment and a keyword-based failure theme. Each group shows a short summary and the list of work-order IDs.\nSchema: order_id, equipment_id, description, completion_date.\nDepends on a manual export; no live connection.' },
  agent: { name: 'Sample · assistant instructions', text: 'SYSTEM PROMPT (sample): Use only the work orders supplied in the conversation. Identify recurring issues, suggest next actions for a supervisor, and do not create or modify any records.\nExample input: Pump P-104 seal leak in two work orders.\nExample output: Repeated seal leaks on P-104 — suggest supervisor review.' },
};

export function SourceCard({ source, recordId, attachments, onSave, onDirty, onUploaded, saving }: { source: Source; recordId: string; attachments: IntakeAttachment[]; onSave: (next: Source) => Promise<boolean>; onDirty: (dirty: boolean) => void; onUploaded: (a: IntakeAttachment) => void; saving: boolean }) {
  const [draft, setDraft] = useState(source.text);
  const [files, setFiles] = useState(source.files);
  const [name, setName] = useState(source.name);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [permission, setPermission] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sig = `${source.text}\u0001${source.files.join('|')}\u0001${source.name}`;
  useEffect(() => { setDraft(source.text); setFiles(source.files); setName(source.name); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = draft !== source.text || files.join('|') !== source.files.join('|') || name !== source.name;
  const dirtyCallback = useRef(onDirty);
  dirtyCallback.current = onDirty;
  useEffect(() => { dirtyCallback.current(changed); }, [changed]);
  const byId = new Map(attachments.map(a => [a.id, a]));
  const accept = async (incoming: File[]) => {
    if (!permission) { setError('Confirm the privacy check below before uploading files.'); return; }
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
  const isProblem = source.id === 'problem';
  const guidance = isProblem ? 'Who is affected? What happens today? What would better look like? What must not change?' : source.id === 'prototype' ? 'What does it do, step by step? Include its data schema, a worked example, and anything it depends on.' : 'Paste its instructions, tools and knowledge sources. Include one example of what you asked and what it returned.';
  const empty = !source.text && !source.files.length && !draft && !files.length;
  return <article className="fi-card fi-source fi-collection-card">
    <div className="fi-source-top"><div><p className="fi-input-kicker">{isProblem ? '01 / THE NEED' : source.id === 'prototype' ? '02 / THE SOLUTION' : '03 / THE AGENT'}</p><h3>{isProblem ? 'Tell us what needs to change.' : source.id === 'prototype' ? 'Show us what you’ve built.' : 'Bring the instructions behind the agent.'}</h3></div><span className={`fi-label ${source.changed ? 'warm' : 'blue'}`}>{source.changed ? 'Changed source' : source.supplied ? 'Saved material' : 'Not supplied'}</span></div>
    <p className="fi-input-guidance">{guidance}</p>
    {empty && <p className="fi-hint" style={{ marginBottom: 8 }}>Nothing here yet. <button className="fi-link" data-testid={`button-sample-${source.id}`} onClick={() => { setDraft(SAMPLES[source.id].text); setName(SAMPLES[source.id].name); }}>Fill with a sample input</button> to try the flow — it is only saved and interpreted if you keep it.</p>}
    <label className="fi-input-label" htmlFor={`name-${source.id}`}>Give this input a name</label>
    <input id={`name-${source.id}`} data-testid={`input-name-${source.id}`} className="fi-input" placeholder={sourceLabels[source.id]} value={name} onChange={e => setName(e.target.value)} />
    <div className="fi-editor-label"><label className="fi-input-label" htmlFor={`source-${source.id}`}>{isProblem ? 'Describe it in your own words' : source.id === 'prototype' ? 'Description, README or schema' : 'Instructions and example input / output'}</label><span>Paste or write</span></div>
    <textarea id={`source-${source.id}`} data-testid={`input-text-${source.id}`} className="fi-input fi-source-text" rows={isProblem ? 6 : 8} value={draft} onChange={e => setDraft(e.target.value)} />
    <div className="fi-source-prompts"><strong>Helpful to include</strong>{(isProblem ? ['People & context', 'Today’s process', 'Desired outcome', 'Constraints'] : source.id === 'prototype' ? ['Workflow', 'Input → output', 'Data model', 'Dependencies'] : ['System prompt', 'Tools & knowledge', 'Example conversation', 'Dependencies']).map(t => <span key={t}>{t}</span>)}</div>
    <label className="fi-check fi-permission"><input type="checkbox" data-testid={`check-privacy-${source.id}`} checked={permission} onChange={e => setPermission(e.target.checked)} />I have removed credentials, personal information and restricted data from this material.</label>
    <div className={`fi-dropzone ${over ? 'over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); void accept(Array.from(e.dataTransfer.files)); }}>
      <UploadCloud /><div><strong>{reading ? 'Uploading and reading…' : 'Drop supporting files here'}</strong><p>or <button className="fi-link" data-testid={`button-files-${source.id}`} disabled={reading || !permission} onClick={() => fileRef.current?.click()}>choose files</button> · up to 10 MB each</p></div>
      <input ref={fileRef} className="fi-file-input" id={`files-${source.id}`} aria-label={`Choose files for ${sourceLabels[source.id]}`} type="file" multiple accept={EXT.map(x => `.${x}`).join(',')} disabled={reading || !permission} onChange={e => { void accept(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
    </div>
    <p className="fi-hint">Files are stored with this intake on your account. Text, code, CSV, JSON, Markdown and readable PDFs are extracted for interpretation; images and ZIPs may be kept as references only. The file list below shows exactly what was read.</p>
    {error && <p className="fi-file-error" role="alert">{error} You can retry using “choose files”.</p>}
    {files.map(id => { const a = byId.get(id); return <div className="fi-attached" key={id}><Paperclip /><span>{a ? `${a.name} · ${formatSize(a.size)} · ${a.status === 'extracted' ? 'text extracted' : a.status === 'reference' ? 'reference only; contents not read' : `could not be read${a.error ? `: ${a.error}` : ''}`}` : 'Attachment unavailable'}</span>{a && <a className="fi-icon" href={`/api/intake/files/${a.id}`} aria-label={`Download ${a.name}`}><Download /></a>}<button className="fi-icon" aria-label="Remove file from this input" onClick={() => setFiles(files.filter(f => f !== id))}><X /></button></div>; })}
    <div className="fi-source-save"><span>{saving ? 'Saving…' : changed ? 'Unsaved changes · keep this input to save it' : source.supplied ? 'Saved with this intake' : 'Nothing saved for this input yet'}</span><button className="fi-btn primary" data-testid={`button-keep-${source.id}`} disabled={!changed || !permission || (!draft.trim() && !files.length) || reading || saving} onClick={() => void onSave({ ...source, name: name.trim() || sourceLabels[source.id], text: draft.trim(), files, supplied: !!(draft.trim() || files.length) })}><Check />Keep this input</button></div>
  </article>;
}
