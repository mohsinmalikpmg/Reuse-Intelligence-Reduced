import { useEffect, useMemo, useRef, useState } from 'react';
import { Reorder } from 'framer-motion';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, CheckCheck, ChevronRight, Download, FileText, GitBranch, MessageSquare, Pencil, Plus, RefreshCw, Save, ShieldCheck, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { confirmIntakeRecord, deleteIntakeRecord, getGetIntakeRecordQueryKey, getIntakeRecord, getListIntakeRecordsQueryKey, interpretIntakeRecord, saveIntakeRecord, useGetIntakeRecord, type IntakeAttachment, type IntakeModel, type IntakeRecord } from '@workspace/api-client-react';
import { CapabilityCard, EditCard, RequirementRow, SourceCard } from './cards';
import Structured from './Structured';
import { newRequirement, removeRequirement } from './structure';
import { serializeModel, displayName, NAME_PENDING, errorMessage, errorStatus, hasInterpretation, hasSourceMaterial, labels, normalizeModel, PROFILE_KEYS, readiness, sourceLabels, SOURCE_IDS, type Model, type ProfileKey, type Requirement, type Source, type SourceId } from './model';

type Stage = 'inputs' | 'review' | 'confirm';
type Busy = null | 'save' | 'interpret' | 'name' | 'confirm' | 'delete';
const sourceIcon = (id: SourceId) => (id === 'problem' ? <MessageSquare /> : id === 'prototype' ? <FileText /> : <GitBranch />);

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Editor({ id }: { id: string }) {
  const { data, isLoading, error, refetch } = useGetIntakeRecord(id, { query: { queryKey: getGetIntakeRecordQueryKey(id), retry: false, refetchOnWindowFocus: false } });
  if (isLoading) return <div className="fi-wrap"><div className="fi-skel" style={{ height: 40, width: 260 }} /><div className="fi-skel" style={{ height: 90, marginTop: 20 }} /><div className="fi-skel" style={{ height: 380, marginTop: 20 }} /></div>;
  if (error || !data) {
    const st = errorStatus(error);
    return <div className="fi-wrap"><div className="fi-empty"><h3>{st === 404 ? 'This intake does not exist or is not yours.' : 'We could not load this intake.'}</h3><p className="fi-hint">{errorMessage(error)}</p><div className="fi-actions" style={{ justifyContent: 'center' }}><Link href="/" className="fi-btn"><ArrowLeft />All intakes</Link>{st !== 404 && <button className="fi-btn primary" onClick={() => void refetch()}><RefreshCw />Retry</button>}</div></div></div>;
  }
  return <Workspace key={id} initial={data} />;
}

function Workspace({ initial }: { initial: IntakeRecord }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const id = initial.id;
  const [record, setRecord] = useState(initial);
  const [saved, setSaved] = useState(() => normalizeModel(initial.model));
  const [model, setModel] = useState(saved);
  const [title, setTitle] = useState(initial.title);
  const [showFull, setShowFull] = useState(true);
  const [structDirty, setStructDirty] = useState(false);
  const [attachments, setAttachments] = useState<IntakeAttachment[]>(initial.attachments);
  const [busy, setBusy] = useState<Busy>(null);
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<{ message: string; retry: () => void } | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [interpretAck, setInterpretAck] = useState(false);
  const [stage, setStageState] = useState<Stage>(hasInterpretation(saved) ? 'review' : 'inputs');
  const dirtyInputs = useRef<Partial<Record<SourceId, boolean>>>({});
  const [inputType, setInputType] = useState<SourceId>('problem');
  const [tab, setTab] = useState<'priorities' | 'profile' | 'capabilities'>('priorities');
  const [notice, setNotice] = useState(hasInterpretation(saved) ? `Saved intake reopened · revision ${initial.revision}.` : 'New intake. Bring any combination of a need, prototype or agent, then ask for an interpretation.');
  const [extra, setExtra] = useState('');
  const [historyCount, setHistoryCount] = useState(0);
  const history = useRef<Model[]>([]);
  const dragging = useRef(false);

  const dirty = useMemo(() => JSON.stringify(model) !== JSON.stringify(saved) || title.trim() !== record.title, [model, saved, title, record.title]);
  const interpreted = hasInterpretation(model);
  const { profileReady, needsReady, capsReady, questionsReady, sourcesReady, structureReady, groupsReady, ready } = readiness(model);
  const serverConfirmed = record.status === 'confirmed' && !dirty;
  const gaps = model.capabilities.filter(c => c.gap.trim());
  const sourceName = (sid?: SourceId) => (sid ? model.sources.find(s => s.id === sid)?.name || sourceLabels[sid] : 'combined inputs');

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty || structDirty) { e.preventDefault(); } };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, [dirty, structDirty]);

  const setStage = (next: Stage) => {
    if (structDirty && next !== stage) { setNotice('Save or cancel your open correction in the full structured output first.'); return; }
    if (stage === 'inputs' && next !== 'inputs' && Object.values(dirtyInputs.current).some(Boolean)) { setNotice('Keep your changed inputs before leaving this step. Unsaved drafts are preserved when switching input types.'); return; }
    if (next !== 'inputs' && !interpreted) { setNotice('Nothing to review yet. Save at least one input and ask for an interpretation first.'); return; }
    setStageState(next);
  };
  const applyServer = (rec: IntakeRecord, sent?: Model) => {
    const m = normalizeModel(rec.model);
    setRecord(rec); setSaved(m); setTitle(t => (t.trim() === rec.title || !sent ? rec.title : t)); setAttachments(rec.attachments);
    // A manual name always survives server round-trips (interpretation, reconciliation).
    setModel(cur => { const keep = cur.name?.origin === 'manual' && (m.name?.value !== cur.name.value || m.name?.origin !== 'manual') ? { ...m, name: cur.name } : m; return !sent || JSON.stringify(cur) === JSON.stringify(sent) ? keep : cur; });
    qc.setQueryData(getGetIntakeRecordQueryKey(id), rec);
    void qc.invalidateQueries({ queryKey: getListIntakeRecordsQueryKey() });
  };
  const handleError = (e: unknown, action: string, retry: () => void) => {
    if (errorStatus(e) === 409) { setConflict(true); setNotice('A newer version of this intake exists. Your draft is preserved here.'); return; }
    if (errorStatus(e) === 401) { setFailure({ message: 'Your session has ended. Sign in again — download your draft first if you have unsaved changes.', retry }); return; }
    setFailure({ message: `${action} failed: ${errorMessage(e)}`, retry });
  };
  const save = async (next: Model = model, message = 'Saved.'): Promise<IntakeRecord | null> => {
    if (structDirty) { setNotice('Save or cancel your open correction in the full structured output first.'); return null; }
    setBusy('save'); setFailure(null);
    try {
      const rec = await saveIntakeRecord(id, { title: displayName(next, title), model: serializeModel(next) as unknown as IntakeModel, revision: record.revision });
      applyServer(rec, next); setNotice(`${message} Revision ${rec.revision}.`); return rec;
    } catch (e) { handleError(e, 'Saving', () => void save(next, message)); return null; } finally { setBusy(null); }
  };
  const reloadLatest = async () => {
    try { const rec = await getIntakeRecord(id); const m = normalizeModel(rec.model); setRecord(rec); setSaved(m); setModel(m); setTitle(rec.title); setAttachments(rec.attachments); history.current = []; setHistoryCount(0); setConflict(false); qc.setQueryData(getGetIntakeRecordQueryKey(id), rec); setNotice(`Latest saved version loaded · revision ${rec.revision}.`); }
    catch (e) { setFailure({ message: `Could not load the latest version: ${errorMessage(e)}`, retry: () => void reloadLatest() }); }
  };
  const interpret = async () => {
    if (structDirty) { setNotice('Save or cancel your open correction in the full structured output first.'); return; }
    if (Object.values(dirtyInputs.current).some(Boolean)) { setNotice('Keep or discard your changed inputs before asking for an interpretation.'); return; }
    if (!hasSourceMaterial(model)) { setNotice('Add at least one input before asking for an interpretation.'); return; }
    let rev = record.revision;
    if (dirty || structDirty) { const rec = await save(model, 'Saved before interpretation.'); if (!rec) return; rev = rec.revision; }
    setBusy('interpret'); setFailure(null); setNotice('Interpreting your saved inputs. This can take a little while.');
    try {
      const rec = await interpretIntakeRecord(id, { revision: rev });
      applyServer(rec); history.current = []; setHistoryCount(0); setStageState('review'); setTab('profile');
      setNotice('Interpretation ready. Read each item against your inputs; your previously confirmed corrections are kept where unaffected.');
    } catch (e) { handleError(e, 'Interpretation', () => void interpret()); setNotice('Interpretation did not complete.'); } finally { setBusy(null); }
  };
  /** Regenerate ONLY the name: the server re-reads saved inputs, then every other part of the local review is written back unchanged. */
  const regenerateName = async () => {
    if (structDirty) { setNotice('Save or cancel your open correction in the full structured output first.'); return; }
    if (!hasInterpretation(model) || !model.sources.every(x => !x.changed) || Object.values(dirtyInputs.current).some(Boolean)) { setNotice('Your inputs changed since the last interpretation. Interpret the latest inputs first; a name is suggested as part of that.'); return; }
    if (!window.confirm('Suggest a new name with AI?\n\nYour saved inputs are sent to an AI model to suggest a name. Your current name' + (model.name?.origin === 'manual' ? ' (which you set yourself)' : '') + ' will be replaced.\n\nOnly the name changes. Your needs, capabilities, mappings, coverage and review progress are kept.\n\nContinue?')) return;
    let rev = record.revision;
    if (dirty || structDirty) { const rec = await save(model, 'Saved before naming.'); if (!rec) return; rev = rec.revision; }
    setBusy('name'); setFailure(null);
    try {
      const rec = await interpretIntakeRecord(id, { revision: rev, regenerateName: true });
      const m = normalizeModel(rec.model);
      setRecord(rec); setSaved(m); setModel(m); setTitle(rec.title); setAttachments(rec.attachments);
      qc.setQueryData(getGetIntakeRecordQueryKey(id), rec); void qc.invalidateQueries({ queryKey: getListIntakeRecordsQueryKey() });
      setNotice(m.name ? `Name suggested: “${m.name.value}”. Your review is unchanged.` : 'No name could be suggested from these inputs. Your review is unchanged.');
    } catch (e) { handleError(e, 'Naming', () => void regenerateName()); } finally { setBusy(null); }
  };
  const setManualName = (value: string) => {
    const v = value.trim(); setTitle(v);
    if (!v) { setNotice('A name cannot be blank. Keep the current one or suggest a new one.'); return; }
    if (v === model.name?.value && model.name.origin === 'manual') return;
    history.current.push(structuredClone(model)); setHistoryCount(history.current.length);
    setModel(m => ({ ...m, name: { value: v, origin: 'manual', provenance: 'Named by you' } })); setNotice('Name set by you. It will be kept through re-interpretation. Unsaved.');
  };
  const confirm = async () => {
    if (structDirty) { setNotice('Save or cancel your open correction in the full structured output first.'); return; }
    let rev = record.revision;
    if (dirty || structDirty) { const rec = await save(model, 'Saved before confirmation.'); if (!rec) return; rev = rec.revision; }
    setBusy('confirm'); setFailure(null);
    try { const rec = await confirmIntakeRecord(id, { revision: rev }); applyServer(rec); setNotice('Shared understanding confirmed and saved.'); }
    catch (e) { handleError(e, 'Confirmation', () => void confirm()); } finally { setBusy(null); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete “${shownName || 'this intake'}” and its files? This cannot be undone.`)) return;
    setBusy('delete');
    try { await deleteIntakeRecord(id); qc.removeQueries({ queryKey: getGetIntakeRecordQueryKey(id) }); await qc.invalidateQueries({ queryKey: getListIntakeRecordsQueryKey() }); navigate('/'); }
    catch (e) { setBusy(null); setFailure({ message: `Delete failed: ${errorMessage(e)}`, retry: () => void remove() }); }
  };

  const commit = (next: Model, message: string) => {
    history.current.push(structuredClone(model)); setHistoryCount(history.current.length);
    setModel({ ...next, confirmed: false, agreed: false }); setNotice(`${message} Unsaved.`);
  };
  const undo = () => { const previous = history.current.pop(); if (previous) { setModel(previous); setHistoryCount(history.current.length); setNotice('Last change undone. The previous review state has been restored.'); } };
  const editProfile = (key: ProfileKey, value: string) => {
    const affects = key !== 'user';
    commit({ ...model, profile: { ...model.profile, [key]: { ...model.profile[key], value, reviewed: false, changed: true } }, requirements: affects ? model.requirements.map(r => r.sources.includes('problem') ? { ...r, reviewed: false, changed: true } : r) : model.requirements, orderReviewed: affects ? false : model.orderReviewed }, 'Correction made. Read the updated interpretation before confirming; related needs need re-review.');
  };
  const setRequirements = (requirements: Requirement[], message: string) => commit({ ...model, requirements, orderReviewed: false }, message);
  const reorder = (requirements: Requirement[]) => {
    if (!dragging.current) { history.current.push(structuredClone(model)); setHistoryCount(history.current.length); dragging.current = true; }
    setModel(m => ({ ...m, requirements, orderReviewed: false, confirmed: false, agreed: false })); setNotice('Priority order changed. Numbers now reflect the new order. Unsaved.');
  };
  const updateSource = async (source: Source): Promise<boolean> => {
    const before = model.sources.find(s => s.id === source.id);
    const newFiles = source.files.some(f => !before?.files.includes(f));
    const materially = !before || before.text !== source.text || newFiles || before.files.length !== source.files.length;
    const afterReview = interpreted && materially;
    const next: Model = { ...model, confirmed: false, agreed: false, sources: model.sources.map(s => s.id === source.id ? { ...source, changed: afterReview || s.changed } : s),
      ...(afterReview ? {
        profile: source.id === 'problem' ? Object.fromEntries(PROFILE_KEYS.map(k => [k, { ...model.profile[k], reviewed: false, changed: true }])) as Model['profile'] : model.profile,
        requirements: model.requirements.map(r => r.sources.includes(source.id) ? { ...r, reviewed: false, changed: true } : r),
        capabilities: model.capabilities.map(c => c.sourceId === source.id ? { ...c, status: 'Needs clarification' as const, changed: true, carry: false } : c),
        orderReviewed: model.requirements.some(r => r.sources.includes(source.id)) ? false : model.orderReviewed,
      } : {}) };
    history.current.push(structuredClone(model)); setHistoryCount(history.current.length);
    setModel(next);
    const rec = await save(next, afterReview ? `${sourceLabels[source.id]} saved. Affected interpretations are highlighted and unconfirmed — re-interpret to refresh them.` : `${sourceLabels[source.id]} saved.`);
    return !!rec;
  };
  const answerQuestion = (qid: string, patch: { answer?: string; acknowledged?: boolean }) => {
    const changedAnswer = patch.answer !== undefined;
    commit({ ...model, questions: model.questions.map(q => q.id === qid ? { ...q, ...patch } : q), orderReviewed: changedAnswer ? false : model.orderReviewed, requirements: changedAnswer ? model.requirements.map(r => ({ ...r, reviewed: false })) : model.requirements }, changedAnswer ? 'Answer recorded. Needs require re-review; re-interpret to apply your answers.' : 'Question acknowledgement updated.');
  };
  const nextReview = () => { if (!profileReady) setTab('profile'); else if (!needsReady) setTab('priorities'); else if (!capsReady) setTab('capabilities'); else { setStage('inputs'); return; } setStage('review'); };
  const reviewedCount = PROFILE_KEYS.filter(k => model.profile[k].reviewed).length + model.requirements.filter(r => r.reviewed).length + model.capabilities.filter(c => c.status === 'Confirmed').length;
  const total = 4 + model.requirements.length + model.capabilities.length;
  const multiSource = [...model.requirements].sort((a, b) => b.sources.length - a.sources.length)[0];
  const locked = busy !== null;
  const shownName = displayName(model, title);

  return <div className="fi-wrap">
    <div className="fi-stage"><Link href="/" className="fi-crumb">All intakes</Link> / Trace · Shared understanding</div>
    <div className="fi-intro"><div><h1>{stage === 'inputs' ? <>Bring the problem.<br /><em>And what you’ve tried.</em></> : serverConfirmed ? <>Shared understanding <em>saved.</em></> : <>Get the understanding <em>right.</em></>}</h1><p>{stage === 'inputs' ? 'Add a business need, prototype or agent.' : 'Review the problem, priorities and supplied capabilities.'}</p></div>
      {editingTitle ? <form className="fi-title-form" onSubmit={e => { e.preventDefault(); if (title.trim()) { setManualName(title); setEditingTitle(false); } }}><input className="fi-input" data-testid="input-title" aria-label="Intake name" maxLength={200} autoFocus value={title} disabled={locked} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setTitle(shownName); setEditingTitle(false); } }} /><button className="fi-btn" disabled={!title.trim() || locked}><Check /></button></form>
        : <span className="fi-actions" style={{ gap: 6 }}><button className="fi-label fi-title-chip" data-testid="button-edit-title" disabled={locked} onClick={() => { setTitle(shownName); setEditingTitle(true); }}><GitBranch />{shownName ? <span data-testid="text-intake-name">{shownName}</span> : <span className="fi-name-status" data-testid="status-name-pending">{NAME_PENDING}</span>}{model.name?.origin === 'manual' && <small>· named by you</small>}<Pencil /></button>
          {interpreted && <button className="fi-link" data-testid="button-regenerate-name" disabled={locked || conflict} onClick={() => void regenerateName()}><Sparkles style={{ display: 'inline', width: 12, height: 12 }} /> {busy === 'name' ? 'Suggesting…' : 'Suggest a new name'}</button>}</span>}
    </div>
    <nav className="fi-steps" aria-label="Intake stages">{([['inputs', '01', 'Bring your inputs'], ['review', '02', 'Review & refine'], ['confirm', '03', 'Agree on the profile']] as const).map(([key, n, text]) => <button key={key} data-testid={`step-${key}`} aria-current={stage === key ? 'step' : undefined} disabled={key !== 'inputs' && !interpreted} className={stage === key ? 'active' : ''} onClick={() => setStage(key)}><b>{n}</b>{text}{(key === 'inputs' && interpreted && sourcesReady || key === 'confirm' && serverConfirmed) && <Check />}</button>)}</nav>

    {conflict && <div className="fi-warning" role="alert"><strong>This intake was changed somewhere else.</strong><p>A newer saved revision exists, so your changes were not saved. Your draft is still on screen. Download it if you want to keep a copy, then load the latest version.</p><div className="fi-actions" style={{ justifyContent: 'flex-start' }}><button className="fi-btn" onClick={() => download(`intake-draft-${id}.json`, { title: shownName, model })}><Download />Download my draft</button><button className="fi-btn primary" data-testid="button-reload-latest" onClick={() => void reloadLatest()}><RefreshCw />Load latest saved version</button></div></div>}
    {failure && !conflict && <div className="fi-warning" role="alert"><strong>Something did not complete.</strong><p>{failure.message}</p><div className="fi-actions" style={{ justifyContent: 'flex-start' }}><button className="fi-link" onClick={() => setFailure(null)}>Dismiss</button><button className="fi-btn" onClick={failure.retry}><RefreshCw />Try again</button></div></div>}

    <div className="fi-layout"><div className="fi-main">
      {stage === 'inputs' ? <section>
        <div className="fi-section-head"><h2>What are you bringing?</h2><span className="fi-label blue">Mix and match</span></div><p className="fi-sub">Start anywhere. You don’t need a prototype, or all the answers, to describe a need.</p>
        <div className="fi-input-types" role="tablist" aria-label="Input type">
          {SOURCE_IDS.map(sid => <button key={sid} id={`input-tab-${sid}`} role="tab" aria-selected={inputType === sid} aria-controls="input-panel" tabIndex={inputType === sid ? 0 : -1} className={inputType === sid ? 'active' : ''} onClick={() => setInputType(sid)} onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const next = SOURCE_IDS[(SOURCE_IDS.indexOf(sid) + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; setInputType(next); document.getElementById(`input-tab-${next}`)?.focus(); } }}>{sourceIcon(sid)}<strong>{sid === 'problem' ? 'A business need' : sid === 'prototype' ? 'A prototype / solution' : 'A configured agent'}</strong><small>{sid === 'problem' ? 'The problem & context' : sid === 'prototype' ? 'What you’ve already built' : 'Instructions & examples'}</small></button>)}
        </div>
        <div id="input-panel" role="tabpanel" aria-labelledby={`input-tab-${inputType}`}>
          {model.sources.map(source => <div key={source.id} hidden={inputType !== source.id}><SourceCard source={source} recordId={id} attachments={attachments} saving={busy === 'save'} onSave={updateSource} onUploaded={a => setAttachments(list => [...list.filter(x => x.id !== a.id), a])} onDirty={d => { dirtyInputs.current[source.id] = d; }} /></div>)}
        </div>
        {!sourcesReady && <div className="fi-warning"><strong>Source changes need review.</strong><p>Re-interpret to refresh affected items, or review the highlighted items against your updated inputs.</p><button className="fi-btn" onClick={() => commit({ ...model, sources: model.sources.map(s => ({ ...s, changed: false })) }, 'Source changes acknowledged. Review the highlighted items.')}>I’ll review the highlighted items</button></div>}
        <label className="fi-check fi-permission"><input type="checkbox" data-testid="check-interpret-privacy" checked={interpretAck} onChange={e => setInterpretAck(e.target.checked)} />I understand my saved inputs and readable file contents are sent for AI interpretation, and I have removed credentials, personal and restricted data.</label>
        <div className="fi-actions">{interpreted && <button className="fi-btn" onClick={() => { setStage('review'); setTab('profile'); }}>Review the understanding<ArrowRight /></button>}<button className="fi-btn primary" data-testid="button-interpret" disabled={locked || !interpretAck || !hasSourceMaterial(model) || conflict} onClick={() => void interpret()}><Sparkles />{busy === 'interpret' ? 'Interpreting…' : interpreted ? 'Re-interpret saved inputs' : 'Interpret my inputs'}</button></div>
      </section> : stage === 'review' ? <>
        <div className="sx-toggle"><p className="fi-hint">{showFull ? 'The full structured output comes first. Then confirm each part in the tabs below.' : 'The full structured output is hidden.'}</p><button className="fi-btn" data-testid="button-toggle-structured" aria-expanded={showFull} onClick={() => { if (showFull && structDirty) { setNotice('Save or cancel your open correction in the full structured output first.'); return; } setShowFull(v => !v); }}>{showFull ? 'Hide full output' : 'Show full structured output'}</button></div>
        {showFull && <Structured model={model} locked={locked || conflict} onCommit={commit} onNotice={setNotice} onDraftDirty={setStructDirty} />}
        <nav className="fi-tabs" aria-label="Review sections">{([['priorities', 'Needs & priorities', model.requirements.length], ['profile', 'Shared profile', 4], ['capabilities', 'What you’ve built', model.capabilities.length]] as const).map(([key, t, n]) => <button key={key} className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{t}<span>{n}</span></button>)}</nav>
        {tab === 'priorities' ? <section><div className="fi-section-head"><h2>What matters most?</h2><span className="fi-label blue">One shared list</span></div><p className="fi-sub">Combined across your inputs. Drag to rank; use the arrows if you prefer. Correct anything that isn’t quite right.</p>
          {model.requirements.length ? <Reorder.Group axis="y" values={model.requirements} onReorder={reorder} className="fi-priorities" onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}>{model.requirements.map((r, i) => <RequirementRow key={r.id} item={r} index={i} count={model.requirements.length}
            onMove={offset => { const next = [...model.requirements]; [next[i], next[i + offset]] = [next[i + offset], next[i]]; setRequirements(next, `Moved requirement to priority ${i + offset + 1}.`); }}
            onEdit={text => setRequirements(model.requirements.map(x => x.id === r.id ? { ...x, text, reviewed: false, changed: true, edited: true } : x), 'Requirement corrected. Please read the updated wording and confirm.')}
            onRemove={() => commit({ ...removeRequirement(model, r.id) }, 'Requirement removed. Undo restores it with its previous priority and review state.')}
            onConfirm={() => commit({ ...model, requirements: model.requirements.map(x => x.id === r.id ? { ...x, reviewed: true, changed: false } : x) }, `Priority ${i + 1} wording confirmed.`)} />)}</Reorder.Group> : <div className="fi-empty"><h3>No requirements yet</h3><p>Add the first need below. At least one reviewed need is required.</p></div>}
          <form className="fi-add" onSubmit={e => { e.preventDefault(); const text = extra.trim(); if (!text) return; if (model.requirements.some(r => r.text.toLowerCase() === text.toLowerCase())) { setNotice('That need already exists. Edit the existing item instead.'); return; } setRequirements([...model.requirements, newRequirement(text)], 'Need added from your refinement. Review the wording before approving.'); setExtra(''); }}><input className="fi-input" data-testid="input-add-need" aria-label="Add a missing requirement" placeholder="Something we missed?" value={extra} onChange={e => setExtra(e.target.value)} /><button className="fi-btn" disabled={!extra.trim()}><Plus />Add need</button></form>
          {multiSource && multiSource.sources.length > 1 && <div className="fi-order-note"><GitBranch /><p>“{multiSource.text}” appeared in {multiSource.sources.length} inputs. It is one need here, with all its sources retained — not {multiSource.sources.length} votes for the same feature.</p></div>}
          <div className="fi-actions"><span className="fi-hint">Confirm each wording, then approve the order.</span><button className="fi-btn" disabled={!model.requirements.length || !model.requirements.every(r => r.reviewed) || model.orderReviewed} onClick={() => commit({ ...model, orderReviewed: true }, 'The current requirement order is agreed.')}>{model.orderReviewed ? <CheckCheck /> : <Check />}{model.orderReviewed ? 'Order agreed' : 'Agree this priority order'}</button></div>
        </section> : tab === 'profile' ? <section><div className="fi-section-head"><h2>Here is what we understood</h2></div><p className="fi-sub">Your edits win. Save a correction, read it back, then confirm the interpretation.</p><div className="fi-profile-grid">{PROFILE_KEYS.map(k => <EditCard key={k} label={labels[k]} field={model.profile[k]} onSave={v => editProfile(k, v)} onConfirm={() => commit({ ...model, profile: { ...model.profile, [k]: { ...model.profile[k], reviewed: true, changed: false } } }, `${labels[k]} confirmed as accurate.`)} />)}</div></section> :
          <section><h2>What your prototype and agent describe</h2>{model.capabilities.length ? model.capabilities.map(c => <CapabilityCard key={c.id} item={c} sourceName={sourceName(c.sourceId)}
            onSave={next => commit({ ...model, capabilities: model.capabilities.map(x => x.id === c.id ? { ...next, status: 'Needs clarification', changed: true, carry: false, edited: true } : x) }, 'Capability corrected. The revised workflow, input, output and dependencies are ready for re-review.')}
            onConfirm={() => commit({ ...model, capabilities: model.capabilities.map(x => x.id === c.id ? { ...x, status: 'Confirmed', changed: false } : x) }, 'Capability description confirmed.')}
            onCarry={carry => commit({ ...model, capabilities: model.capabilities.map(x => x.id === c.id ? { ...x, carry } : x) }, carry ? 'Open gap acknowledged for later review with the IT Owner.' : 'Gap acknowledgement removed. It must be acknowledged or resolved before final confirmation.')} />) : <div className="fi-empty" style={{ marginTop: 12 }}><h3>No built capabilities described</h3><p>That is fine if you are bringing only a need. Add a prototype or agent input to describe one.</p></div>}</section>}
      </> : <section>
        {serverConfirmed ? <div className="fi-success"><CheckCheck /><h2>Understanding agreed.</h2><p>This profile is saved and ready for a later comparison conversation. No products have been matched, and no capability has been proven to work.</p><div className="fi-actions" style={{ justifyContent: 'flex-start' }}><button className="fi-btn" onClick={() => { setStage('review'); setTab('profile'); }}>Return to review</button><button className="fi-btn primary" data-testid="button-download-json" onClick={() => download(`fusebox-intake-${id}.json`, record)}><Download />Download confirmed JSON</button></div></div> : <><h2>One last read, together.</h2><p className="fi-sub">Confirm the shared profile and the gaps you are intentionally carrying forward.</p></>}
        <article className="fi-card fi-summary"><h3>The agreed profile</h3><dl>{PROFILE_KEYS.map(k => <div key={k} style={{ display: 'contents' }}><dt>{k === 'problem' ? 'Problem' : k === 'user' ? 'People' : k === 'scope' ? 'Scope' : 'Outcome'}</dt><dd>{model.profile[k].value || '—'}{!model.profile[k].reviewed && <p className="fi-readback">Not yet confirmed</p>}</dd></div>)}</dl></article>
        <article className="fi-card fi-summary"><h3>Needs, in priority order</h3><ol>{model.requirements.map(r => <li key={r.id}>{r.text}{!r.reviewed && <small> · Review needed</small>}</li>)}</ol>{!model.requirements.length && <p>No needs recorded.</p>}{!model.orderReviewed && <p className="fi-readback">Priority order is not yet agreed.</p>}</article>
        <article className="fi-card fi-summary"><h3>Capability descriptions</h3>{model.capabilities.length ? model.capabilities.map(c => <div className="fi-gap" key={c.id}><strong>{c.title} · {c.status}</strong><p>{c.description}</p><p><strong>Workflow:</strong> {c.workflow}</p><p><strong>Input:</strong> {c.input}</p><p><strong>Output:</strong> {c.output}</p><p><strong>Dependencies:</strong> {c.dependency}</p><p className="fi-hint">Source: {sourceName(c.sourceId)}</p></div>) : <p>No capabilities described.</p>}</article>
        {model.questions.length > 0 && <article className="fi-card fi-summary"><h3>Clarifying questions</h3>{model.questions.map(q => <div className="fi-gap" key={q.id}><strong>{q.text}</strong><p>{q.answer.trim() || (q.acknowledged ? 'Left open · acknowledged' : 'Not yet answered')}</p></div>)}</article>}
        <article className="fi-card fi-summary"><h3>Open gaps for the IT Owner</h3>{gaps.length ? gaps.map(c => <div className="fi-gap" key={c.id}><strong>{c.title}</strong><p>{c.gap}</p><span className={`fi-label ${c.carry ? '' : 'warm'}`}>{c.carry ? 'Acknowledged · carried forward' : 'Acknowledgement needed'}</span></div>) : <p>No open gaps recorded.</p>}</article>
        {!ready && <div className="fi-warning"><strong>Not ready to agree yet.</strong><p>{[!profileReady && 'Review the essential profile fields.', !needsReady && 'Review each need and agree the priority order.', !capsReady && 'Confirm capability descriptions and acknowledge open gaps.', !questionsReady && 'Answer or acknowledge each clarifying question.', !sourcesReady && 'Acknowledge changed sources or re-interpret them.', !structureReady && 'Acknowledge input coverage and resolve overlaps in the full structured output.', !groupsReady && 'Give every group a title and boundary, and every need and capability a valid primary group.'].filter(Boolean).join(' ')}</p><button className="fi-link" onClick={nextReview}>Go to the next review item</button></div>}
        {!serverConfirmed && <><label className="fi-check"><input type="checkbox" data-testid="check-agree" checked={model.agreed} disabled={!ready} onChange={e => setModel({ ...model, agreed: e.target.checked })} />This accurately describes our need and the supplied prototype / agent. I acknowledge the listed open gaps.</label><div className="fi-actions"><button className="fi-btn sienna" data-testid="button-confirm" disabled={!ready || !model.agreed || locked || conflict} onClick={() => void confirm()}><CheckCheck />{busy === 'confirm' ? 'Confirming…' : 'Confirm shared understanding'}</button></div></>}
      </section>}
    </div>

    <aside className="fi-aside">
      {stage === 'inputs' ? <>
        <section className="fi-input-aside"><p className="fi-aside-title">YOUR INTAKE PACKET</p><h3>A little context goes a long way.</h3><p>You can add to this packet as the conversation develops.</p><ol>{model.sources.map(s => <li key={s.id}><button onClick={() => setInputType(s.id)}><span className="fi-packet-icon">{sourceIcon(s.id)}</span><span><strong>{s.name || sourceLabels[s.id]}</strong><small>{s.changed ? 'Your changes · needs re-review' : s.supplied ? 'Saved' : 'Not supplied'} · {s.files.length} {s.files.length === 1 ? 'file' : 'files'}</small></span><ChevronRight /></button></li>)}</ol></section>
        <section className="fi-aside-card fi-expectations"><h3>What happens next?</h3><p><b>1</b> Read needs and capabilities separately.</p><p><b>2</b> Bring them into one shared profile.</p><p><b>3</b> Correct the details and rank priorities together.</p><span className="fi-label warm">AI draft · you review every item</span></section>
        <section className="fi-privacy"><ShieldCheck /><div><h3>Only share what’s safe.</h3><p>Use sanitized examples. Remove secrets, credentials and restricted data. Inputs and files are saved to this intake under your own sign-in; there is no shared team access.</p></div></section>
      </> : <section className="fi-question"><p className="fi-aside-title">{model.questions.length === 1 ? 'One thing to clarify' : `${model.questions.length} things to clarify`}</p>
        {model.questions.length ? model.questions.map(q => <div key={q.id} className="fi-q-item"><h3>{q.text}</h3>
          <textarea aria-label={`Answer: ${q.text}`} data-testid={`input-answer-${q.id}`} className="fi-input" rows={3} defaultValue={q.answer} key={q.answer} onBlur={e => { if (e.target.value.trim() !== q.answer) answerQuestion(q.id, { answer: e.target.value.trim() }); }} />
          <label><input type="checkbox" checked={q.acknowledged} onChange={e => answerQuestion(q.id, { acknowledged: e.target.checked })} />Leave open for now; I acknowledge it is unresolved.</label></div>)
          : <p>No clarifying questions were raised by the interpretation.</p>}
        {model.questions.length > 0 && <button className="fi-btn" data-testid="button-reinterpret-answers" disabled={locked || conflict || !interpretAck} onClick={() => void interpret()}>{busy === 'interpret' ? 'Interpreting…' : 'Re-interpret with answers'}<ArrowRight /></button>}
        {model.questions.length > 0 && !interpretAck && <p className="fi-hint" style={{ marginTop: 10 }}>Confirm the privacy check on the inputs step to re-interpret.</p>}
      </section>}
      {stage !== 'inputs' && <section className="fi-aside-card"><h3>Your inputs. One understanding.</h3><p>Needs stay separate from implementation choices. Their provenance stays attached.</p>{model.sources.filter(s => s.supplied).map(s => <div className="fi-source-mini" key={s.id}><span>{sourceIcon(s.id)}{s.name || sourceLabels[s.id]}</span>{s.changed ? <span style={{ color: '#a45632' }}>Changed</span> : <Check />}</div>)}<button className="fi-link" onClick={() => setStage('inputs')}>Inspect or change inputs</button><div className="fi-mini-flow"><span>Needs</span><Plus /><span>Capabilities</span><ChevronRight /><span>Profile</span></div></section>}
      <p className="fi-demo">SAVED TO YOUR ACCOUNT<br /><button className="fi-link" style={{ fontSize: '10px', marginTop: 8 }} data-testid="button-delete" disabled={locked} onClick={() => void remove()}><Trash2 style={{ display: 'inline', width: 11, height: 11, marginRight: 3 }} />Delete this intake</button></p>
    </aside></div>
    <footer className="fi-bottom"><div><strong>{serverConfirmed ? 'Shared understanding confirmed' : interpreted ? `${reviewedCount} of ${total} interpretations reviewed` : 'Not yet interpreted'}</strong><small>{model.orderReviewed ? 'Priority order agreed' : 'Priority order needs agreement'} · {gaps.filter(c => c.carry).length} open gaps acknowledged</small></div><div className="fi-bottom-actions">{stage === 'confirm' ? <button className="fi-btn" onClick={() => setStage('review')}><ArrowLeft />Back to review</button> : <><button className="fi-btn" disabled={!interpreted} onClick={() => { if (stage === 'inputs') setStage('review'); else setTab(tab === 'priorities' ? 'profile' : tab === 'profile' ? 'capabilities' : 'priorities'); }}>{stage === 'inputs' ? 'Return to review' : tab === 'priorities' ? 'Review the profile' : tab === 'profile' ? 'Review capabilities' : 'Review needs'}<ArrowRight /></button><button className="fi-btn primary" disabled={!interpreted} onClick={() => setStage('confirm')}>Review final agreement<ArrowRight /></button></>}</div></footer>
    <div className="fi-feedback" role="status" aria-live="polite"><span data-testid="status-notice">{notice}</span><span className={`fi-save-state ${dirty ? 'dirty' : ''}`} data-testid="status-saved">{busy === 'save' ? 'Saving…' : dirty ? 'Unsaved changes' : `Saved · rev ${record.revision} · ${new Date(record.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</span><button className="fi-icon" disabled={!historyCount || locked} onClick={undo} aria-label="Undo last change" data-testid="button-undo"><Undo2 /></button><button className="fi-btn" data-testid="button-save" disabled={!dirty || locked || conflict || structDirty || false} onClick={() => void save(model, 'Changes saved.')}><Save />Save</button></div>
  </div>;
}
