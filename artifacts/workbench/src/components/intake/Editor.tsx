import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, Check, ChevronRight, Download, FileText, GitBranch, MessageSquare, Pencil, Plus, RefreshCw, Save, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { compareIntakeRecord, confirmIntakeRecord, deleteIntakeRecord, getGetIntakeRecordQueryKey, getIntakeRecord, getListIntakeRecordsQueryKey, interpretIntakeRecord, saveIntakeRecord, useGetIntakeRecord, type IntakeAttachment, type IntakeRecord } from '@workspace/api-client-react';
import { SourceCard, type SourceCardHandle } from './cards';
import { privacyKey } from './Records';
import GuidedReview, { approvalProgress, firstPendingStep, type GuideStep } from './GuidedReview';
import { errorMessage, errorStatus, hasInterpretation, hasSourceMaterial, normalizeModel, PROFILE_KEYS, readiness, sourceLabels, SOURCE_IDS, type Model, type ProfileKey, type Requirement, type Source, type SourceId } from './model';

type Stage = 'inputs' | 'review' | 'confirm';
type Busy = null | 'save' | 'interpret' | 'confirm' | 'delete' | 'compare';
const compareResponse = z.object({ briefId: z.string().trim().min(1) });
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
    return <div className="fi-wrap"><div className="fi-empty"><h3>{st === 404 ? 'This intake does not exist or is not yours.' : 'We could not load this intake.'}</h3><p className="fi-hint">{errorMessage(error)}</p><div className="fi-actions" style={{ justifyContent: 'center' }}><Link href="/discover" className="fi-btn"><ArrowLeft />All intakes</Link>{st !== 404 && <button className="fi-btn primary" onClick={() => void refetch()}><RefreshCw />Retry</button>}</div></div></div>;
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
  const [attachments, setAttachments] = useState<IntakeAttachment[]>(initial.attachments);
  const [busy, setBusy] = useState<Busy>(null);
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<{ message: string; retry: () => void } | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [interpretAck, setInterpretAck] = useState(false);
  const [stage, setStageState] = useState<Stage>(hasInterpretation(saved) ? 'review' : 'inputs');
  const dirtyInputs = useRef<Partial<Record<SourceId, boolean>>>({});
  const [sourceDraftDirty, setSourceDraftDirty] = useState(false);
  const startParam = (() => { const v = new URLSearchParams(window.location.search).get('start'); return v === 'prototype' || v === 'agent' ? v : null; })();
  const [inputType, setInputType] = useState<SourceId>(() => startParam ?? saved.sources.find(s => s.supplied)?.id ?? 'problem');
  const [opened, setOpened] = useState<SourceId[]>(() => SOURCE_IDS.filter(sid => sid === (startParam ?? (saved.sources.some(s => s.supplied) ? null : 'problem')) || saved.sources.find(s => s.id === sid)?.supplied));
  const [phase, setPhase] = useState<'collect' | 'consent'>('collect');
  const [privacyOk, setPrivacyOk] = useState(() => { try { return sessionStorage.getItem(privacyKey(initial.id)) === '1'; } catch { return false; } });
  const handles = useRef<Partial<Record<SourceId, SourceCardHandle>>>({});
  const readingIds = useRef<Partial<Record<SourceId, boolean>>>({});
  const [uploading, setUploading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [guideStep, setGuideStepState] = useState<GuideStep>(() => firstPendingStep(saved));
  const [reviewDraftDirty, setReviewDraftDirty] = useState(false);
  const setGuideStep = (s: GuideStep) => setGuideStepState(s);
  const [notice, setNotice] = useState(hasInterpretation(saved) ? `Saved intake reopened · revision ${initial.revision}.` : '');
  const [historyCount, setHistoryCount] = useState(0);
  const history = useRef<Model[]>([]);
  const dragging = useRef(false);

  const dirty = useMemo(() => JSON.stringify(model) !== JSON.stringify(saved) || title.trim() !== record.title, [model, saved, title, record.title]);
  const interpreted = hasInterpretation(model);
  const { sourcesReady } = readiness(model);
  const serverConfirmed = record.status === 'confirmed' && !dirty && !sourceDraftDirty;
  const gaps = model.capabilities.filter(c => c.gap.trim());

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty || reviewDraftDirty || sourceDraftDirty) { e.preventDefault(); } };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, [dirty, reviewDraftDirty, sourceDraftDirty]);

  const setStage = (next: Stage) => {
    if (stage === 'inputs' && next !== 'inputs' && Object.values(dirtyInputs.current).some(Boolean)) { setNotice('Keep your changed inputs before leaving this step. Unsaved drafts are preserved when switching input types.'); return; }
    if (next !== 'inputs' && !interpreted) { setNotice('Nothing to review yet. Save at least one input and ask for an interpretation first.'); return; }
    if (reviewDraftDirty) { setNotice('Save or cancel your inline correction before changing steps.'); return; }
    if (next === 'confirm') { setGuideStep('agree'); setStageState('review'); return; }
    if (next === 'review' && stage === 'review') { setGuideStep(firstPendingStep(model)); return; }
    if (next === 'inputs') setPhase('collect');
    setStageState(next);
  };
  const applyServer = (rec: IntakeRecord, sent?: Model) => {
    const m = normalizeModel(rec.model);
    setRecord(rec); setSaved(m); setTitle(t => (t.trim() === rec.title || !sent ? rec.title : t)); setAttachments(rec.attachments);
    setModel(cur => (!sent || JSON.stringify(cur) === JSON.stringify(sent) ? m : cur));
    qc.setQueryData(getGetIntakeRecordQueryKey(id), rec);
    void qc.invalidateQueries({ queryKey: getListIntakeRecordsQueryKey() });
  };
  const handleError = (e: unknown, action: string, retry: () => void) => {
    if (errorStatus(e) === 409) { setConflict(true); setNotice('A newer version of this intake exists. Your draft is preserved here.'); return; }
    if (errorStatus(e) === 401) { setFailure({ message: 'Your session has ended. Sign in again — download your draft first if you have unsaved changes.', retry }); return; }
    setFailure({ message: `${action} failed: ${errorMessage(e)}`, retry });
  };
  const save = async (next: Model = model, message = 'Saved.'): Promise<IntakeRecord | null> => {
    setBusy('save'); setFailure(null);
    try {
      const rec = await saveIntakeRecord(id, { title: title.trim() || record.title, model: next as unknown as Record<string, unknown>, revision: record.revision });
      applyServer(rec, next); setNotice(`${message} Revision ${rec.revision}.`); return rec;
    } catch (e) { handleError(e, 'Saving', () => void save(next, message)); return null; } finally { setBusy(null); }
  };
  const reloadLatest = async () => {
    try { const rec = await getIntakeRecord(id); const m = normalizeModel(rec.model); setRecord(rec); setSaved(m); setModel(m); setTitle(rec.title); setAttachments(rec.attachments); history.current = []; setHistoryCount(0); setConflict(false); qc.setQueryData(getGetIntakeRecordQueryKey(id), rec); setNotice(`Latest saved version loaded · revision ${rec.revision}.`); }
    catch (e) { setFailure({ message: `Could not load the latest version: ${errorMessage(e)}`, retry: () => void reloadLatest() }); }
  };
  const interpret = async () => {
    if (Object.values(dirtyInputs.current).some(Boolean)) { setNotice('Keep or discard your changed inputs before asking for an interpretation.'); return; }
    if (!hasSourceMaterial(model)) { setNotice('Add at least one input before asking for an interpretation.'); return; }
    let rev = record.revision;
    if (dirty) { const rec = await save(model, 'Saved before interpretation.'); if (!rec) return; rev = rec.revision; }
    setBusy('interpret'); setFailure(null); setNotice('Interpreting your saved inputs. This can take a little while.');
    try {
      const rec = await interpretIntakeRecord(id, { revision: rev });
      applyServer(rec); history.current = []; setHistoryCount(0); setStageState('review'); setGuideStep(firstPendingStep(normalizeModel(rec.model)));
      setNotice('Interpretation ready. Read each item against your inputs; your previously confirmed corrections are kept where unaffected.');
    } catch (e) { handleError(e, 'Interpretation', () => void interpret()); setNotice('Interpretation did not complete.'); } finally { setBusy(null); }
  };
  const confirm = async () => {
    let rev = record.revision;
    if (dirty) { const rec = await save(model, 'Saved before confirmation.'); if (!rec) return; rev = rec.revision; }
    setBusy('confirm'); setFailure(null);
    try { const rec = await confirmIntakeRecord(id, { revision: rev }); applyServer(rec); setNotice('Shared understanding confirmed and saved.'); }
    catch (e) { handleError(e, 'Confirmation', () => void confirm()); } finally { setBusy(null); }
  };
  const compare = async () => {
    if (!serverConfirmed || busy || conflict || Object.values(dirtyInputs.current).some(Boolean)) return;
    if (!window.confirm('Compare with library?\n\nThis copies your confirmed business profile and requirements, in their agreed order, into the existing SHARED DEMO library-matching workspace. People using that workspace can see this copied information.\n\nPrivate source files, source text and capability claims are NOT shared. This handoff does not reinterpret your intake or use AI.\n\nContinue?')) return;
    setBusy('compare'); setFailure(null);
    try {
      const body = await compareIntakeRecord(id, { revision: record.revision }, { credentials: 'same-origin' });
      const parsed = compareResponse.safeParse(body);
      if (!parsed.success) throw new Error('The comparison response did not contain a valid brief ID. Please try again.');
      navigate(`/discover?brief=${encodeURIComponent(parsed.data.briefId)}&results=1`);
    } catch (e) { handleError(e, 'Library comparison', () => void compare()); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete “${record.title}” and its files? This cannot be undone.`)) return;
    setBusy('delete');
    try { await deleteIntakeRecord(id); qc.removeQueries({ queryKey: getGetIntakeRecordQueryKey(id) }); await qc.invalidateQueries({ queryKey: getListIntakeRecordsQueryKey() }); navigate('/discover'); }
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
  const applySource = (base: Model, source: Source): Model => {
    const before = base.sources.find(s => s.id === source.id);
    const newFiles = source.files.some(f => !before?.files.includes(f));
    const materially = !before || before.text !== source.text || newFiles || before.files.length !== source.files.length;
    const afterReview = interpreted && materially;
    return { ...base, confirmed: false, agreed: false, sources: base.sources.map(s => s.id === source.id ? { ...source, changed: afterReview || s.changed } : s),
      ...(afterReview ? {
        profile: source.id === 'problem' ? Object.fromEntries(PROFILE_KEYS.map(k => [k, { ...base.profile[k], reviewed: false, changed: true }])) as Model['profile'] : base.profile,
        requirements: base.requirements.map(r => r.sources.includes(source.id) ? { ...r, reviewed: false, changed: true } : r),
        capabilities: base.capabilities.map(c => c.sourceId === source.id ? { ...c, status: 'Needs clarification' as const, changed: true, carry: false } : c),
        orderReviewed: base.requirements.some(r => r.sources.includes(source.id)) ? false : base.orderReviewed,
      } : {}) };
  };
  /** Single primary action on the collect step: save every changed input, then move to the interpretation consent. */
  const continueToInterpret = async () => {
    const changedSources = SOURCE_IDS.map(sid => handles.current[sid]?.next() ?? null).filter((x): x is Source => !!x);
    if (changedSources.length) {
      if (!privacyOk) { setNotice('Tick the privacy check first.'); return; }
      const next = changedSources.reduce(applySource, model);
      if (!hasSourceMaterial(next)) { setNotice('Write something or attach a file first.'); return; }
      history.current.push(structuredClone(model)); setHistoryCount(history.current.length);
      setModel(next);
      const rec = await save(next, interpreted ? 'Inputs saved. Affected items are marked for re-review.' : 'Inputs saved.');
      if (!rec) return;
    } else if (!hasSourceMaterial(model)) { setNotice('Write something or attach a file first.'); return; }
    else if (dirty) { const rec = await save(model, 'Saved.'); if (!rec) return; }
    setPhase('consent');
  };
  const openSource = (sid: SourceId) => { setOpened(o => (o.includes(sid) ? o : [...o, sid])); setInputType(sid); setAddOpen(false); };
  const answerQuestion = (qid: string, patch: { answer?: string; acknowledged?: boolean }) => {
    const changedAnswer = patch.answer !== undefined;
    commit({ ...model, questions: model.questions.map(q => q.id === qid ? { ...q, ...patch } : q), orderReviewed: changedAnswer ? false : model.orderReviewed, requirements: changedAnswer ? model.requirements.map(r => ({ ...r, reviewed: false })) : model.requirements }, changedAnswer ? 'Answer recorded. Needs require re-review; re-interpret to apply your answers.' : 'Question acknowledgement updated.');
  };
  const locked = busy !== null;
  const progress = approvalProgress(model);
  const curStage: Stage = stage === 'review' && guideStep === 'agree' ? 'confirm' : stage;

  return <div className="fi-wrap">
    <div className="fi-stage"><Link href="/discover" className="fi-crumb">All intakes</Link> / Trace · Shared understanding</div>
    <div className="fi-intro"><div><h1>{stage === 'inputs' ? phase === 'consent' ? <>Saved. <em>Now interpret?</em></> : <>Your <em>inputs.</em></> : serverConfirmed ? <>Shared understanding <em>saved.</em></> : <>Get the understanding <em>right.</em></>}</h1>{stage !== 'inputs' && <p>Review the problem, priorities and supplied capabilities.</p>}</div>
      {editingTitle ? <form className="fi-title-form" onSubmit={e => { e.preventDefault(); if (title.trim()) setEditingTitle(false); }}><input className="fi-input" data-testid="input-title" aria-label="Intake title" maxLength={200} autoFocus value={title} onChange={e => setTitle(e.target.value)} /><button className="fi-btn" disabled={!title.trim()}><Check /></button></form>
        : <button className="fi-label fi-title-chip" data-testid="button-edit-title" onClick={() => setEditingTitle(true)}><GitBranch />{title || 'Untitled intake'}<Pencil /></button>}
    </div>
    <nav className="fi-steps" aria-label="Intake stages">{([['inputs', '01', 'Bring your inputs'], ['review', '02', 'Review & refine'], ['confirm', '03', 'Agree on the profile']] as const).map(([key, n, text]) => <button key={key} data-testid={`step-${key}`} aria-current={curStage === key ? 'step' : undefined} disabled={key !== 'inputs' && !interpreted} className={curStage === key ? 'active' : ''} onClick={() => setStage(key)}><b>{n}</b>{text}{(key === 'inputs' && interpreted && sourcesReady || key === 'confirm' && serverConfirmed) && <Check />}</button>)}</nav>

    {conflict && <div className="fi-warning" role="alert"><strong>This intake was changed somewhere else.</strong><p>A newer saved revision exists, so your changes were not saved. Your draft is still on screen. Download it if you want to keep a copy, then load the latest version.</p><div className="fi-actions" style={{ justifyContent: 'flex-start' }}><button className="fi-btn" onClick={() => download(`intake-draft-${id}.json`, { title, model })}><Download />Download my draft</button><button className="fi-btn primary" data-testid="button-reload-latest" onClick={() => void reloadLatest()}><RefreshCw />Load latest saved version</button></div></div>}
    {failure && !conflict && <div className="fi-warning" role="alert"><strong>Something did not complete.</strong><p>{failure.message}</p><div className="fi-actions" style={{ justifyContent: 'flex-start' }}><button className="fi-link" onClick={() => setFailure(null)}>Dismiss</button><button className="fi-btn" onClick={failure.retry}><RefreshCw />Try again</button></div></div>}

    <div className={`fi-layout ${stage === 'inputs' ? 'solo' : ''}`}><div className="fi-main">
      {stage === 'inputs' ? phase === 'collect' ? <section className="fi-collect">
        {opened.length > 1 && <ul className="fi-packet" aria-label="Your inputs">{opened.map(sid => { const s = model.sources.find(x => x.id === sid)!; return <li key={sid}><button type="button" data-testid={`button-packet-${sid}`} aria-current={inputType === sid ? 'true' : undefined} className={inputType === sid ? 'on' : ''} onClick={() => setInputType(sid)}>{sourceIcon(sid)}<span>{s.supplied ? s.name || sourceLabels[sid] : sourceLabels[sid]}</span><small>{dirtyInputs.current[sid] ? 'Not saved' : s.changed ? 'Changed' : s.supplied ? `Saved${s.files.length ? ` · ${s.files.length} ${s.files.length === 1 ? 'file' : 'files'}` : ''}` : 'Empty'}</small></button></li>; })}</ul>}
        {model.sources.filter(s => opened.includes(s.id)).map(source => <div key={source.id} hidden={inputType !== source.id}><SourceCard source={source} recordId={id} attachments={attachments} privacyOk={privacyOk} autoFocus={source.id === inputType && !source.supplied}
          onRegister={h => { if (h) handles.current[source.id] = h; else delete handles.current[source.id]; }}
          onReading={r => { readingIds.current[source.id] = r; setUploading(Object.values(readingIds.current).some(Boolean)); }}
          onUploaded={a => setAttachments(list => [...list.filter(x => x.id !== a.id), a])} onDirty={d => { dirtyInputs.current[source.id] = d; setSourceDraftDirty(Object.values(dirtyInputs.current).some(Boolean)); }} /></div>)}
        {opened.length < SOURCE_IDS.length && <div className="fi-addsrc">{addOpen ? <>{SOURCE_IDS.filter(sid => !opened.includes(sid)).map(sid => <button type="button" key={sid} className="fi-ghost" data-testid={`button-add-${sid}`} onClick={() => openSource(sid)}>{sourceIcon(sid)}{sid === 'problem' ? 'The need behind it' : sid === 'prototype' ? 'A prototype you built' : 'A configured agent'}</button>)}<button type="button" className="fi-link" onClick={() => setAddOpen(false)}>Cancel</button></>
          : <button type="button" className="fi-ghost" data-testid="button-add-input" onClick={() => setAddOpen(true)}><Plus />Add another input</button>}</div>}
        {!sourcesReady && <div className="fi-warning"><strong>Source changes need review.</strong><p>Re-interpret to refresh affected items, or review the highlighted items yourself.</p><button className="fi-btn" onClick={() => commit({ ...model, sources: model.sources.map(s => ({ ...s, changed: false })) }, 'Source changes acknowledged. Review the highlighted items.')}>I’ll review the highlighted items</button></div>}
        <label className="fi-check fi-permission"><input type="checkbox" data-testid="check-privacy" checked={privacyOk} onChange={e => { setPrivacyOk(e.target.checked); try { sessionStorage.setItem(privacyKey(id), e.target.checked ? '1' : '0'); } catch { /* storage unavailable */ } }} />No passwords, personal details or restricted data in my text or files.</label>
        <div className="fi-collect-foot">
          {interpreted && <button type="button" className="fi-link" onClick={() => setStage('review')}>Back to review</button>}
          <button className="fi-btn primary fi-btn-lg" data-testid="button-continue" disabled={locked || conflict || uploading || (sourceDraftDirty && !privacyOk)} onClick={() => void continueToInterpret()}>{busy === 'save' ? 'Saving…' : uploading ? 'Uploading…' : 'Continue'}<ArrowRight /></button>
        </div>
      </section> : <section className="fi-consent" data-testid="panel-consent">
        <h2>Ready for an AI read?</h2>
        <ul className="fi-consent-list">{model.sources.filter(s => s.supplied).map(s => <li key={s.id}>{sourceIcon(s.id)}<span>{s.name || sourceLabels[s.id]}</span><small>{s.files.length ? `${s.files.length} ${s.files.length === 1 ? 'file' : 'files'}` : 'text'}</small></li>)}</ul>
        <label className="fi-check fi-permission"><input type="checkbox" data-testid="check-interpret-privacy" checked={interpretAck} onChange={e => setInterpretAck(e.target.checked)} />Send these saved inputs and readable file contents to an AI model to draft an interpretation. I will check every item.</label>
        <div className="fi-collect-foot">
          <button type="button" className="fi-link" data-testid="button-back-inputs" disabled={locked} onClick={() => setPhase('collect')}><ArrowLeft style={{ display: 'inline', width: 12, height: 12 }} /> Edit inputs</button>
          {interpreted && <button type="button" className="fi-btn" onClick={() => setStage('review')}>Skip, keep current review</button>}
          <button className="fi-btn primary fi-btn-lg" data-testid="button-interpret" disabled={locked || !interpretAck || !hasSourceMaterial(model) || conflict} onClick={() => void interpret()}><Sparkles />{busy === 'interpret' ? 'Interpreting…' : interpreted ? 'Re-interpret' : 'Interpret'}</button>
        </div>
      </section> : <GuidedReview model={model} attachments={attachments} step={guideStep} onStep={setGuideStep} locked={locked} busy={busy} conflict={conflict} serverConfirmed={serverConfirmed} interpretAck={interpretAck} onInterpretAck={setInterpretAck}
        onCommit={commit} onEditProfile={editProfile} onAnswer={answerQuestion} onReorder={reorder} onDragEnd={() => { dragging.current = false; }} onInterpret={() => void interpret()} onConfirm={() => void confirm()} onCompare={() => void compare()} onDownload={() => download(`fusebox-intake-${id}.json`, record)}
        onAgreed={v => setModel(m => ({ ...m, agreed: v }))} onGoInputs={() => setStage('inputs')} onNotice={setNotice} onDraftDirty={setReviewDraftDirty} compareHidden={editingTitle} />}
    </div>

    <aside className="fi-aside">
      {stage !== 'inputs' && <section className="fi-aside-card"><h3>Your inputs. One understanding.</h3><p>Needs stay separate from implementation choices. Their provenance stays attached.</p>{model.sources.filter(s => s.supplied).map(s => <div className="fi-source-mini" key={s.id}><span>{sourceIcon(s.id)}{s.name || sourceLabels[s.id]}</span>{s.changed ? <span style={{ color: '#a45632' }}>Changed</span> : <Check />}</div>)}<button className="fi-link" onClick={() => setStage('inputs')}>Inspect or change inputs</button><div className="fi-mini-flow"><span>Needs</span><Plus /><span>Capabilities</span><ChevronRight /><span>Profile</span></div></section>}
      <p className="fi-demo">SAVED TO YOUR ACCOUNT<br /><button className="fi-link" style={{ fontSize: '10px', marginTop: 8 }} data-testid="button-delete" disabled={locked} onClick={() => void remove()}><Trash2 style={{ display: 'inline', width: 11, height: 11, marginRight: 3 }} />Delete this intake</button></p>
    </aside></div>
    <footer className="fi-bottom"><div><strong data-testid="status-progress">{serverConfirmed ? 'Shared understanding confirmed' : interpreted ? `${progress.done} of ${progress.total} approvals given` : 'Not yet interpreted'}</strong><small>{model.orderReviewed ? 'Priority order agreed' : 'Priority order needs agreement'} · {gaps.filter(c => c.carry).length} of {gaps.length} open gaps acknowledged</small></div><div className="fi-bottom-actions"></div></footer>
    <div className="fi-feedback" role="status" aria-live="polite"><span data-testid="status-notice">{notice}</span><span className={`fi-save-state ${dirty ? 'dirty' : ''}`} data-testid="status-saved">{busy === 'save' ? 'Saving…' : dirty ? 'Unsaved changes' : `Saved · rev ${record.revision} · ${new Date(record.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</span><button className="fi-icon" disabled={!historyCount || locked} onClick={undo} aria-label="Undo last change" data-testid="button-undo"><Undo2 /></button><button className="fi-btn" data-testid="button-save" disabled={!dirty || locked || conflict || !title.trim()} onClick={() => void save(model, 'Changes saved.')}><Save />Save</button></div>
  </div>;
}
