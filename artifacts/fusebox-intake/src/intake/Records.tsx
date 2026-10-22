import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { createIntakeRecord, deleteIntakeRecord, getListIntakeRecordsQueryKey, useListIntakeRecords } from '@workspace/api-client-react';
import { displayName, errorMessage, NAME_PENDING, normalizeModel } from './model';

const statusLabel = { draft: ['Draft', 'blue'], review: ['In review', 'warm'], confirmed: ['Confirmed', ''] } as const;

export default function Records() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { data, isLoading, error, refetch } = useListIntakeRecords({ query: { queryKey: getListIntakeRecordsQueryKey() } });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const create = async () => {
    setBusy('create'); setProblem('');
    try { const rec = await createIntakeRecord({}); await qc.invalidateQueries({ queryKey: getListIntakeRecordsQueryKey() }); navigate(`/records/${rec.id}`); }
    catch (e) { setProblem(`Could not create the intake: ${errorMessage(e)}`); setBusy(null); }
  };
  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete “${name}” and its files? This cannot be undone.`)) return;
    setBusy(id); setProblem('');
    try { await deleteIntakeRecord(id); await qc.invalidateQueries({ queryKey: getListIntakeRecordsQueryKey() }); }
    catch (e) { setProblem(`Delete failed: ${errorMessage(e)}`); } finally { setBusy(null); }
  };
  const records = [...(data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return <div className="fi-wrap">
    <div className="fi-stage">01 / Trace · Your intakes</div>
    <div className="fi-intro"><div><h1>Start with the need.<br /><em>Agree on it together.</em></h1><p>Each intake gathers a business need, a prototype or an agent, interprets them, and ends in a profile you have read and confirmed.</p></div></div>
    <form className="fi-card fi-new" onSubmit={e => { e.preventDefault(); void create(); }}>
      <h3 style={{ marginBottom: 6 }}>Start a new intake</h3><p className="fi-hint" style={{ marginBottom: 12 }}>No name needed. One is suggested after interpretation, and you can change it any time.</p><div className="fi-actions" style={{ justifyContent: "flex-start" }}><button className="fi-btn primary" data-testid="button-create" disabled={busy === 'create'}><Plus />{busy === 'create' ? 'Creating…' : 'Start intake'}</button></div>
    </form>
    {problem && <p className="fi-file-error" role="alert">{problem}</p>}
    <div className="fi-section-head" style={{ marginTop: 30 }}><h2>Saved intakes</h2>{data && <span className="fi-label blue">{data.length}</span>}</div>
    <p className="fi-sub">Only intakes created under your sign-in appear here.</p>
    {isLoading ? <div className="fi-records">{[0, 1, 2].map(i => <div key={i} className="fi-skel" style={{ height: 74 }} />)}</div>
      : error ? <div className="fi-empty"><h3>Your intakes could not be loaded.</h3><p className="fi-hint">{errorMessage(error)}</p><button className="fi-btn" style={{ marginTop: 14 }} onClick={() => void refetch()}><RefreshCw />Retry</button></div>
      : !records.length ? <div className="fi-empty"><h3>No intakes yet</h3><p className="fi-hint">Name one above to begin. Nothing is filled in for you.</p></div>
      : <ul className="fi-records">{records.map(r => { const [lab, tone] = statusLabel[r.status]; return <li key={r.id} className="fi-record" data-testid={`card-record-${r.id}`}>
        <Link href={`/records/${r.id}`} className="fi-record-link"><span><strong>{displayName(normalizeModel(r.model), r.title) || <span className="fi-name-status">{NAME_PENDING}</span>}</strong><small>Updated {new Date(r.updatedAt).toLocaleString()} · rev {r.revision} · {r.attachments.length} {r.attachments.length === 1 ? 'file' : 'files'}</small></span><span className={`fi-label ${tone}`}>{lab}</span><ArrowRight /></Link>
        <button className="fi-icon" aria-label={`Delete ${r.title}`} data-testid={`button-delete-${r.id}`} disabled={busy === r.id} onClick={() => void remove(r.id, displayName(normalizeModel(r.model), r.title) || 'this intake')}><Trash2 /></button>
      </li>; })}</ul>}
  </div>;
}
