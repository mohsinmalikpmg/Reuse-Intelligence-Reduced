import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, Download, FileText, GitBranch, MessageSquare, RefreshCw, Save, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { compareIntakeRecord, confirmIntakeRecord, deleteIntakeRecord, getGetIntakeRecordQueryKey, getIntakeRecord, getListIntakeRecordsQueryKey, interpretIntakeRecord, saveIntakeRecord, useGetIntakeRecord, type IntakeAttachment, type IntakeModel, type IntakeRecord } from '@workspace/api-client-react';
import { SourceCard, type SourceCardHandle } from './cards';
import { privacyKey } from './Records';
import Simple from './Simple';
import Structured from './Structured';
import { acceptReview, serializeModel, displayName, errorMessage, errorStatus, hasInterpretation, hasSourceMaterial, normalizeModel, PROFILE_KEYS, sourceLabels, SOURCE_IDS, type Model, type ProfileKey, type Requirement, type Source, type SourceId } from './model';

/* Simplified flow: describe -> review -> find matching solutions. */
const HOME = '/discover';
const resultsUrl = (briefId: string) => `/discover?brief=${encodeURIComponent(briefId)}&results=1`;

type Stage = 'describe' | 'review';
type Busy = null | 'save' | 'interpret' | 'name' | 'confirm' | 'delete' | 'compare';
const compareResponse = z.object({ briefId: z.string().trim().min(1) });
const sourceIcon = (id: SourceId) => (id === 'problem' ? <MessageSquare /> : id === 'prototype' ? <FileText /> : <GitBranch />);
const KIND: Record<SourceId, string> = { problem: 'A business problem', prototype: 'A prototype or solution', agent: 'A configured agent' };
/** Fingerprint of everything the single acceptance covers; any change un-ticks it. */
const acceptSig = (m: Model, name: string) => JSON.stringify([name, PROFILE_KEYS.map(k => m.profile[k].value), m.requirements.map(r => [r.id, r.text]), m.capabilities.map(c => [c.id, c.title, c.description, c.gap, c.carry]), m.questions.map(q => [q.id, q.answer, q.acknowledged]), m.coverage.map(c => [c.id, c.disposition, c.reviewed, c.requirementIds, c.capabilityIds])]);

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
    return <div className="fi-wrap"><div className="fi-empty"><h3>{st === 404 ? 'This intake does not exist or is not yours.' : 'We could not load this intake.'}</h3><p className="fi-hint">{errorMessage(error)}</p><div className="fi-actions" style={{ justifyContent: 'center' }}><Link href={HOME} className="fi-btn"><ArrowLeft />All intakes</Link>{st !== 404 && <button className="fi-btn primary" onClick={() => void refetch()}><RefreshCw />Retry</button>}</div></div></div>;
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
  const [structDirty, setStructDirty] = useState(false);
  const [attachments, setAttachments] = useState<IntakeAttachment[]>(initial.attachments);
  const [busy, setBusy] = useState<Busy>(null);
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<{ message: string; retry: () => void } | null>(null);
  const [stage, setStageState] = useState<Stage>(hasInterpretation(saved) ? 'review' : 'describe');
  const dirtyInputs = useRef<Partial<Record<SourceId, boolean>>>({});
  const [sourceDraftDirty, setSourceDraftDirty] = useState(false);
  const startParam = (() => { const v = new URLSearchParams(window.location.search).get('start'); return v === 'prototype' || v === 'agent' ? v : null; })();
  const [inputType, setInputType] = useState<SourceId>(() => startParam ?? saved.sources.find(s => s.supplied)?.id ?? 'problem');
  const [consent, setConsent] = useState(() => { try { return sessionStorage.getItem(privacyKey(initial.id)) === '1'; } catch { return false; } });
  const handles = useRef<Partial<Record<SourceId, SourceCardHandle>>>({});
  const readingIds = useRef<Partial<Record<SourceId, boolean>>>({});
  const [uploading, setUploading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [acceptedSig, setAcceptedSig] = useState<string | null>(null);
  const [notice, setNotice] = useState(hasInterpretation(saved) ? `Saved intake reopened · revision ${initial.revision}.` : '');
  const [historyCount, setHistoryCount] = useState(0);
  const history = useRef<Model[]>([]);
  const dragging = useRef(false);

  const dirty = useMemo(() => JSON.stringify(model) !== JSON.stringify(saved) || title.trim() !== record.title, [model, saved, title, record.title]);
  const interpreted = hasInterpretation(model);
  const serverConfirmed = record.status === 'confirmed' && !dirty && !sourceDraftDirty;
  const shownName = displayName(model, title);
  const sig = acceptSig(model, shownName);
  const accepted = acceptedSig === sig;

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty || sourceDraftDirty || structDirty) { e.preventDefault(); } };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, [dirty, sourceDraftDirty, structDirty]);

  const structGuard = () => { if (structDirty) { setDetailsOpen(true); setNotice('Save or cancel your open correction in Analysis details first.'); return true; } return false; };
  const setStage = (next: Stage) => {
    if (next === stage || structGuard()) return;
    if (next === 'review' && Object.values(dirtyInputs.current).some(Boolean)) { setNotice('Your description has unsaved changes. Choose “Understand this” to save and analyse it.'); return; }
    if (next === 'review' && !interpreted) { setNotice('Nothing to review yet.'); return; }
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
    if (errorStatus(e) === 401) { setFailure({ message: 'Your session has ended. Sign in again. Download your draft first if you have unsaved changes.', retry }); return; }
    setFailure({ message: `${action} failed: ${errorMessage(e)}`, retry });
  };
  const save = async (next: Model = model, message = 'Saved.'): Promise<IntakeRecord | null> => {
    if (structGuard()) return null;
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
  const interpret = async (base: Model = model, baseRev?: number) => {
    if (structGuard()) return;
    if (!hasSourceMaterial(base)) { setNotice('Write something or attach a file first.'); return; }
    let rev = baseRev ?? record.revision;
    if (baseRev === undefined && dirty) { const rec = await save(base, 'Saved before analysis.'); if (!rec) return; rev = rec.revision; }
    setBusy('interpret'); setFailure(null); setNotice('Reading your description with AI. Your existing review stays unchanged if this fails.');
    try {
      const rec = await interpretIntakeRecord(id, { revision: rev });
      applyServer(rec); history.current = []; setHistoryCount(0); setStageState('review'); setDetailsOpen(false);
      setNotice('Analysis ready. Read it, correct anything inline, then accept it. Your earlier corrections are kept where unaffected.');
    } catch (e) { handleError(e, 'Analysis', () => void interpret()); setNotice('Analysis did not complete.'); } finally { setBusy(null); }
  };
  /** Regenerate ONLY the name: the server re-reads saved inputs, then every other part of the local review is written back unchanged. */
  const regenerateName = async () => {
    if (structGuard()) return;
    if (!hasInterpretation(model) || model.sources.some(x => x.changed)) { setNotice('Your description changed since the last analysis. Run “Understand again” first; a name is suggested as part of that.'); return; }
    if (!window.confirm('Suggest a new name with AI?\n\nYour saved description is sent to an AI model. Your current name' + (model.name?.origin === 'manual' ? ' (which you set yourself)' : '') + ' will be replaced. Nothing else changes.\n\nContinue?')) return;
    let rev = record.revision;
    if (dirty) { const rec = await save(model, 'Saved before naming.'); if (!rec) return; rev = rec.revision; }
    setBusy('name'); setFailure(null);
    try {
      const rec = await interpretIntakeRecord(id, { revision: rev, regenerateName: true });
      const m = normalizeModel(rec.model);
      setRecord(rec); setSaved(m); setModel(m); setTitle(rec.title); setAttachments(rec.attachments);
      qc.setQueryData(getGetIntakeRecordQueryKey(id), rec); void qc.invalidateQueries({ queryKey: getListIntakeRecordsQueryKey() });
      setNotice(m.name ? `Name suggested: “${m.name.value}”. Your review is unchanged.` : 'No name could be suggested. Your review is unchanged.');
    } catch (e) { handleError(e, 'Naming', () => void regenerateName()); } finally { setBusy(null); }
  };
  const setManualName = (value: string) => {
    const v = value.trim();
    if (!v) { setNotice('A name cannot be blank.'); return; }
    if (v === model.name?.value && model.name.origin === 'manual') return;
    setTitle(v);
    history.current.push(structuredClone(model)); setHistoryCount(history.current.length);
    setModel(m => ({ ...m, name: { value: v, origin: 'manual', provenance: 'Named by you' } })); setNotice('Name set by you. It is kept through re-analysis. Unsaved.');
  };
  const compare = async (revision: number) => {
    setBusy('compare'); setFailure(null);
    try {
      const body = await compareIntakeRecord(id, { revision }, { credentials: 'same-origin' });
      const parsed = compareResponse.safeParse(body);
      if (!parsed.success) throw new Error('The matching response did not contain a valid brief ID. Please try again.');
      navigate(resultsUrl(parsed.data.briefId));
    } catch (e) { handleError(e, 'Finding matching solutions', () => void compare(record.revision)); }
    finally { setBusy(null); }
  };
  /** Primary action: apply the user's single acceptance, save, ask the server to confirm (it re-checks readiness), then hand off to matching. */
  const findSolutions = async () => {
    if (busy || conflict || structGuard()) return;
    // Sharing consent is part of the single acceptance. A previously confirmed intake has no fresh acceptance, so ask once here.
    if (serverConfirmed) { if (!window.confirm('Find matching solutions?\n\nThis shares the name (“' + (shownName || 'untitled intake') + '”), the accepted summary and needs with the shared matching workspace. Your files, original text and capabilities stay private.\n\nContinue?')) return; await compare(record.revision); return; }
    if (!accepted) { setNotice('Tick the acceptance first.'); return; }
    const next = acceptReview(model);
    if (!next) { setNotice('Some items still need your decision. They are listed above the acceptance.'); return; }
    history.current.push(structuredClone(model)); setHistoryCount(history.current.length);
    setModel(next);
    const rec = await save(next, 'Review accepted.');
    if (!rec) return;
    setBusy('confirm');
    let confirmed: IntakeRecord;
    try { confirmed = await confirmIntakeRecord(id, { revision: rec.revision }); applyServer(confirmed); }
    catch (e) { setBusy(null); handleError(e, 'Accepting the review', () => void findSolutions()); return; }
    await compare(confirmed.revision);
  };
  const remove = async () => {
    if (!window.confirm(`Delete “${shownName || 'this intake'}” and its files? This cannot be undone.`)) return;
    setBusy('delete');
    try { await deleteIntakeRecord(id); qc.removeQueries({ queryKey: getGetIntakeRecordQueryKey(id) }); await qc.invalidateQueries({ queryKey: getListIntakeRecordsQueryKey() }); navigate(HOME); }
    catch (e) { setBusy(null); setFailure({ message: `Delete failed: ${errorMessage(e)}`, retry: () => void remove() }); }
  };

  const commit = (next: Model, message: string) => {
    history.current.push(structuredClone(model)); setHistoryCount(history.current.length);
    setModel({ ...next, confirmed: false, agreed: false }); setNotice(`${message} Unsaved.`);
  };
  const undo = () => { const previous = history.current.pop(); if (previous) { setModel(previous); setHistoryCount(history.current.length); setNotice('Last change undone.'); } };
  const editProfile = (key: ProfileKey, value: string) => {
    const affects = key !== 'user';
    commit({ ...model, profile: { ...model.profile, [key]: { ...model.profile[key], value, reviewed: false, changed: true } }, requirements: affects ? model.requirements.map(r => r.sources.includes('problem') ? { ...r, reviewed: false, changed: true } : r) : model.requirements, orderReviewed: affects ? false : model.orderReviewed }, 'Summary corrected.');
  };
  const reorder = (requirements: Requirement[]) => {
    if (!dragging.current) { history.current.push(structuredClone(model)); setHistoryCount(history.current.length); dragging.current = true; }
    setModel(m => ({ ...m, requirements, orderReviewed: false, confirmed: false, agreed: false })); setNotice('Order changed. Unsaved.');
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
  /** "Understand this": save every changed input, then request the AI analysis in one step. */
  const understand = async () => {
    if (!consent) { setNotice('Tick the check below the description first.'); return; }
    const changed = SOURCE_IDS.map(sid => handles.current[sid]?.next() ?? null).filter((s): s is Source => !!s);
    const next = changed.reduce(applySource, model);
    if (!hasSourceMaterial(next)) { setNotice('Write something or attach a file first.'); return; }
    let rev: number | undefined;
    if (changed.length || dirty) {
      if (changed.length) { history.current.push(structuredClone(model)); setHistoryCount(history.current.length); setModel(next); }
      const rec = await save(next, 'Description saved.'); if (!rec) return; rev = rec.revision;
    }
    await interpret(next, rev);
  };
  const answerQuestion = (qid: string, patch: { answer?: string; acknowledged?: boolean }) => {
    const changedAnswer = patch.answer !== undefined;
    commit({ ...model, questions: model.questions.map(q => q.id === qid ? { ...q, ...patch } : q), orderReviewed: changedAnswer ? false : model.orderReviewed, requirements: changedAnswer ? model.requirements.map(r => ({ ...r, reviewed: false })) : model.requirements }, changedAnswer ? 'Answer recorded. Run “Understand again” if it should change the needs.' : 'Question left open. It will be listed as unresolved.');
  };
  const setConsentStored = (v: boolean) => { setConsent(v); try { sessionStorage.setItem(privacyKey(id), v ? '1' : '0'); } catch { /* storage unavailable */ } };
  const locked = busy !== null;
  const supplied = model.sources.filter(s => s.supplied || s.id === inputType);

  return <div className="fi-wrap fs-wrap">
    <div className="fi-stage"><Link href={HOME} className="fi-crumb">All intakes</Link> / Trace</div>
    <div className="fs-head">
      <h1>{stage === 'describe' ? <>Describe the <em>problem.</em></> : serverConfirmed ? <>Ready to <em>match.</em></> : <>Is this <em>right?</em></>}</h1>
      <ol className="fs-flow" aria-label="Steps">{(['Describe', 'Review', 'Find solutions'] as const).map((t, i) => { const cur = stage === 'describe' ? 0 : 1; return <li key={t} className={i === cur ? 'on' : i < cur ? 'done' : ''}>{i === 0 && interpreted && stage === 'review' ? <button type="button" className="fi-link" data-testid="step-describe" onClick={() => setStage('describe')}>{t}</button> : i === 1 && interpreted && stage === 'describe' ? <button type="button" className="fi-link" data-testid="step-review" onClick={() => setStage('review')}>{t}</button> : <span>{t}</span>}</li>; })}</ol>
    </div>

    {conflict && <div className="fi-warning" role="alert"><strong>This intake was changed somewhere else.</strong><p>A newer saved revision exists, so your changes were not saved. Your draft is still on screen.</p><div className="fi-actions" style={{ justifyContent: 'flex-start' }}><button className="fi-btn" onClick={() => download(`intake-draft-${id}.json`, { title: shownName, model })}><Download />Download my draft</button><button className="fi-btn primary" data-testid="button-reload-latest" onClick={() => void reloadLatest()}><RefreshCw />Load latest saved version</button></div></div>}
    {failure && !conflict && <div className="fi-warning" role="alert"><strong>Something did not complete.</strong><p>{failure.message}</p><div className="fi-actions" style={{ justifyContent: 'flex-start' }}><button className="fi-link" onClick={() => setFailure(null)}>Dismiss</button><button className="fi-btn" disabled={locked} onClick={failure.retry}><RefreshCw />Try again</button></div></div>}

    {stage === 'describe' ? <section className="fs-describe" data-testid="panel-describe">
      <div className="fs-kind" role="radiogroup" aria-label="What are you describing?"><span className="fs-kicker">This is</span>
        {SOURCE_IDS.map(sid => { const s = model.sources.find(x => x.id === sid)!; return <button key={sid} type="button" role="radio" aria-checked={inputType === sid} data-testid={`button-kind-${sid}`} className={inputType === sid ? 'on' : ''} onClick={() => setInputType(sid)}>{sourceIcon(sid)}{KIND[sid]}{(s.supplied || dirtyInputs.current[sid]) && <small>{dirtyInputs.current[sid] ? 'unsaved' : `saved${s.files.length ? ` · ${s.files.length} ${s.files.length === 1 ? 'file' : 'files'}` : ''}`}</small>}</button>; })}
      </div>
      {model.sources.map(source => <div key={source.id} hidden={inputType !== source.id}><SourceCard source={source} recordId={id} attachments={attachments} privacyOk={consent} autoFocus={source.id === inputType && !source.supplied}
        onRegister={h => { if (h) handles.current[source.id] = h; else delete handles.current[source.id]; }}
        onReading={r => { readingIds.current[source.id] = r; setUploading(Object.values(readingIds.current).some(Boolean)); }}
        onUploaded={a => setAttachments(list => [...list.filter(x => x.id !== a.id), a])} onDirty={d => { dirtyInputs.current[source.id] = d; setSourceDraftDirty(Object.values(dirtyInputs.current).some(Boolean)); }} /></div>)}
      {supplied.length > 1 && <p className="fs-meta">Analysed together: {supplied.filter(s => s.supplied).map(s => s.name || sourceLabels[s.id]).join(' · ') || 'nothing saved yet'}.</p>}
      <label className="fs-tick fs-consent"><input type="checkbox" data-testid="check-consent" checked={consent} onChange={e => setConsentStored(e.target.checked)} /><span>No passwords, personal details or restricted data. Send this text and readable file contents to an AI model to draft a summary I will check.</span></label>
      <div className="fs-accept-actions">
        {interpreted && <button type="button" className="fi-link" data-testid="button-back-review" disabled={locked} onClick={() => setStage('review')}>Back to review without changes</button>}
        <button className="fi-btn primary fi-btn-lg" data-testid="button-understand" disabled={locked || conflict || uploading || !consent} onClick={() => void understand()}><Sparkles />{busy === 'interpret' ? 'Understanding…' : busy === 'save' ? 'Saving…' : uploading ? 'Uploading…' : interpreted ? 'Understand again' : 'Understand this'}<ArrowRight /></button>
      </div>
    </section>
      : <Simple model={model} name={shownName} locked={locked} conflict={conflict} serverConfirmed={serverConfirmed} finding={busy === 'confirm' || busy === 'compare'} naming={busy === 'name'}
        accepted={accepted} onAccepted={v => setAcceptedSig(v ? sig : null)} onName={setManualName} onRegenerateName={() => void regenerateName()}
        onEditProfile={editProfile} onCommit={commit} onReorder={reorder} onDragEnd={() => { dragging.current = false; }} onAnswer={answerQuestion}
        onInterpret={() => void interpret()} onFind={() => void findSolutions()} onGoDescribe={() => setStage('describe')}
        detailsOpen={detailsOpen} onDetails={v => { if (!v && structDirty) { setNotice('Save or cancel your open correction in Analysis details first.'); return; } setDetailsOpen(v); }}
        details={<>
          <p className="fi-hint" data-testid="intake-analysis-status">{busy === 'interpret' || busy === 'name' ? 'AI request in progress. The saved analysis is kept until it succeeds.' : model.analysis ? <>AI analysis · {model.analysis.model} · {new Date(model.analysis.createdAt).toLocaleString()} · input {model.analysis.inputFingerprint.slice(0, 12)} · {model.analysis.cached ? 'reused saved result' : 'provider-generated'}. Your corrections remain authoritative.</> : 'This saved review has no AI provenance. Run “Understand again” to obtain one.'}</p>
          {model.questions.some(q => q.answer.trim() || q.acknowledged) && <div className="fs-answered"><h4>Questions</h4><ul>{model.questions.filter(q => q.answer.trim() || q.acknowledged).map(q => <li key={q.id}><b>{q.text}</b> {q.answer.trim() || 'Left open'} {!q.answer.trim() && <button type="button" className="fi-link" disabled={locked} onClick={() => answerQuestion(q.id, { acknowledged: false })}>Reopen</button>}</li>)}</ul></div>}
          <Structured model={model} locked={locked || conflict} onCommit={commit} onNotice={setNotice} onDraftDirty={setStructDirty} />
        </>} />}

    <div className="fi-feedback" role="status" aria-live="polite"><span data-testid="status-notice">{notice}</span><span className={`fi-save-state ${dirty ? 'dirty' : ''}`} data-testid="status-saved">{busy === 'save' ? 'Saving…' : dirty ? 'Unsaved changes' : `Saved · rev ${record.revision} · ${new Date(record.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</span><button className="fi-icon" disabled={!historyCount || locked} onClick={undo} aria-label="Undo last change" data-testid="button-undo"><Undo2 /></button><button className="fi-btn" data-testid="button-save" disabled={!dirty || locked || conflict || structDirty} onClick={() => void save(model, 'Changes saved.')}><Save />Save</button>
      <button className="fi-link fs-quiet" data-testid="button-download-json" onClick={() => download(`fusebox-intake-${id}.json`, record)}><Download />JSON</button>
      <button className="fi-link fs-quiet" data-testid="button-delete" disabled={locked} onClick={() => void remove()}><Trash2 />Delete</button></div>
  </div>;
}
