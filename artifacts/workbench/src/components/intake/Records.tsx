import { useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FileText, GitBranch, RefreshCw, Trash2 } from 'lucide-react';
import { createIntakeRecord, deleteIntakeRecord, getListIntakeRecordsQueryKey, saveIntakeRecord, useListIntakeRecords, type IntakeRecord } from '@workspace/api-client-react';
import { errorMessage, normalizeModel, sourceLabels, type SourceId } from './model';
import { deriveName, SAMPLES } from './cards';

const statusLabel = { draft: ['Draft', 'blue'], review: ['In review', 'warm'], confirmed: ['Confirmed', ''] } as const;
export const privacyKey = (id: string) => `fi-privacy-${id}`;

export default function Records() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { data, isLoading, error, refetch } = useListIntakeRecords({ query: { queryKey: getListIntakeRecordsQueryKey() } });
  const [need, setNeed] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  // Record created but text not yet saved: retry reuses it instead of creating a duplicate.
  const pending = useRef<IntakeRecord | null>(null);

  const start = async () => {
    const text = need.trim();
    if (!text || !privacy) return;
    setBusy('need'); setProblem('');
    const title = deriveName(text, 'Untitled intake');
    try {
      if (!pending.current) pending.current = await createIntakeRecord({ title });
      const rec = pending.current;
      const model = normalizeModel(rec.model);
      const next = { ...model, sources: model.sources.map(s => s.id === 'problem' ? { ...s, name: deriveName(text, sourceLabels.problem), text, supplied: true } : s) };
      await saveIntakeRecord(rec.id, { title, model: next as unknown as Record<string, unknown>, revision: rec.revision });
      pending.current = null;
      try { sessionStorage.setItem(privacyKey(rec.id), '1'); } catch { /* storage unavailable */ }
      await qc.invalidateQueries({ queryKey: getListIntakeRecordsQueryKey() });
      navigate(`/discover/records/${rec.id}`);
    } catch (e) {
      setProblem(pending.current ? `Your intake was created, but the text did not save: ${errorMessage(e)}. Your words are still here.` : `Could not start the intake: ${errorMessage(e)}`);
      setBusy(null);
    }
  };
  const startFrom = async (sid: SourceId) => {
    setBusy(sid); setProblem('');
    try {
      const rec = await createIntakeRecord({ title: sid === 'prototype' ? 'Prototype intake' : 'Agent intake' });
      await qc.invalidateQueries({ queryKey: getListIntakeRecordsQueryKey() });
      navigate(`/discover/records/${rec.id}?start=${sid}`);
    } catch (e) { setProblem(`Could not start the intake: ${errorMessage(e)}`); setBusy(null); }
  };
  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete “${name}” and its files? This cannot be undone.`)) return;
    setBusy(id); setProblem('');
    try { await deleteIntakeRecord(id); await qc.invalidateQueries({ queryKey: getListIntakeRecordsQueryKey() }); }
    catch (e) { setProblem(`Delete failed: ${errorMessage(e)}`); } finally { setBusy(null); }
  };
  const records = [...(data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const working = busy === 'need' || busy === 'prototype' || busy === 'agent';
  return <div className="fi-wrap">
    <div className="fi-stage">01 / Trace · New intake</div>
    <form className="fi-ask" onSubmit={e => { e.preventDefault(); void start(); }}>
      <label htmlFor="new-need" className="fi-ask-q">What are you trying to change?</label>
      <textarea id="new-need" data-testid="input-new-need" className="fi-src-text" rows={5} autoFocus placeholder="Say it the way you would to a colleague. Who it affects, what happens today, what better looks like." value={need} disabled={busy === 'need'} onChange={e => setNeed(e.target.value)} />
      {!need && <button type="button" className="fi-ghost" data-testid="button-sample-need" onClick={() => setNeed(SAMPLES.problem.text)}>Try an example</button>}
      <label className="fi-check fi-permission"><input type="checkbox" data-testid="check-new-privacy" checked={privacy} onChange={e => setPrivacy(e.target.checked)} />No passwords, personal details or restricted data in here.</label>
      <div className="fi-ask-foot">
        <button className="fi-btn primary fi-btn-lg" data-testid="button-create" disabled={!need.trim() || !privacy || working}>{busy === 'need' ? 'Saving…' : pending.current ? 'Retry saving' : 'Continue'}<ArrowRight /></button>
        <span className="fi-ask-or">Already built something?</span>
        <button type="button" className="fi-ghost" data-testid="button-start-prototype" disabled={working} onClick={() => void startFrom('prototype')}><FileText />{busy === 'prototype' ? 'Opening…' : 'Start from a prototype'}</button>
        <button type="button" className="fi-ghost" data-testid="button-start-agent" disabled={working} onClick={() => void startFrom('agent')}><GitBranch />{busy === 'agent' ? 'Opening…' : 'Start from an agent'}</button>
      </div>
    </form>
    {problem && <p className="fi-file-error" role="alert" data-testid="status-create-error">{problem}</p>}
    <div className="fi-section-head" style={{ marginTop: 40 }}><h2>Your intakes</h2>{data && <span className="fi-label blue">{data.length}</span>}</div>
    <p className="fi-sub">Only visible to you.</p>
    {isLoading ? <div className="fi-records">{[0, 1, 2].map(i => <div key={i} className="fi-skel" style={{ height: 74 }} />)}</div>
      : error ? <div className="fi-empty"><h3>Your intakes could not be loaded.</h3><p className="fi-hint">{errorMessage(error)}</p><button className="fi-btn" style={{ marginTop: 14 }} onClick={() => void refetch()}><RefreshCw />Retry</button></div>
      : !records.length ? <div className="fi-empty"><h3>Nothing here yet</h3><p className="fi-hint">Your first answer above becomes your first intake.</p></div>
      : <ul className="fi-records">{records.map(r => { const [lab, tone] = statusLabel[r.status]; return <li key={r.id} className="fi-record" data-testid={`card-record-${r.id}`}>
        <Link href={`/discover/records/${r.id}`} className="fi-record-link"><span><strong>{r.title}</strong><small>Updated {new Date(r.updatedAt).toLocaleString()} · {r.attachments.length} {r.attachments.length === 1 ? 'file' : 'files'}</small></span><span className={`fi-label ${tone}`}>{lab}</span><ArrowRight /></Link>
        <button className="fi-icon" aria-label={`Delete ${r.title}`} data-testid={`button-delete-${r.id}`} disabled={busy === r.id} onClick={() => void remove(r.id, r.title)}><Trash2 /></button>
      </li>; })}</ul>}
  </div>;
}
