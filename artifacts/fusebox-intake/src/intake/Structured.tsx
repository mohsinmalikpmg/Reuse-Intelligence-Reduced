import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, GitMerge, Layers, Link2, Pencil, Plus, Scissors, Trash2, X } from 'lucide-react';
import { groupIssues, labels, PROFILE_KEYS, sourceLabels, type Basis, type Capability, type Disposition, type Model, type Requirement } from './model';
import { addGroup, analyse, mergeCapabilities, mergeRequirements, newCapability, newRequirement, patchCapability, patchGroup, patchRequirement, removeCapability, removeGroup, removeRequirement, splitCapability, splitRequirement, toggleMapping } from './structure';

/** Full structured output: shown before and alongside the guided confirmation. Shared verbatim between Workbench and FUSEBOX Intake. */
type Props = { model: Model; locked: boolean; onCommit: (next: Model, message: string) => void; onNotice: (m: string) => void; onDraftDirty: (d: boolean) => void };
type Mark = (key: string, on: boolean) => void;
/** Registers an open draft with the panel so the editor can block save/interpret/navigation until it is saved or cancelled. */
function useDraft(mark: Mark, key: string, on: boolean) { useEffect(() => { mark(key, on); return () => mark(key, false); }, [mark, key, on]); }

const basisLabel: Record<Basis, string> = { explicit: 'Stated in your input', inferred: 'Inferred', unknown: 'Unknown' };
const short = (id: string) => id.replace(/^(need|cap|req)-/, '').slice(0, 6).toUpperCase();

export default function Structured({ model, locked, onCommit, onNotice, onDraftDirty }: Props) {
  const dirtyRef = useRef(onDraftDirty); dirtyRef.current = onDraftDirty;
  const open = useRef(new Set<string>());
  const mark = useCallback<Mark>((key, on) => { const had = open.current.size > 0; if (on) open.current.add(key); else open.current.delete(key); const has = open.current.size > 0; if (had !== has) dirtyRef.current(has); }, []);
  useEffect(() => () => dirtyRef.current(false), []);
  const { unsupported, unclear } = analyse(model);
  const [pickR, setPickR] = useState<string[]>([]);
  const [pickC, setPickC] = useState<string[]>([]);
  const [mergeText, setMergeText] = useState('');
  const [mergeCap, setMergeCap] = useState('');
  const [newGroup, setNewGroup] = useState({ title: '', boundary: '' });
  const [newNeed, setNewNeed] = useState('');
  const [newCap, setNewCap] = useState('');
  const groupIds = ['', ...model.groups.map(g => g.id)];
  const groupTitle = (id: string) => model.groups.find(g => g.id === id)?.title || 'Ungrouped';
  const reqLabel = (id: string) => { const i = model.requirements.findIndex(r => r.id === id); return i < 0 ? null : `N${i + 1}`; };
  const capLabel = (id: string) => { const i = model.capabilities.findIndex(c => c.id === id); return i < 0 ? null : `C${i + 1}`; };
  const itemLabel = (id: string) => { const r = model.requirements.find(x => x.id === id); if (r) return `${reqLabel(id)} ${r.text}`; const c = model.capabilities.find(x => x.id === id); return c ? `${capLabel(id)} ${c.title}` : 'Removed item'; };
  const capsFor = (rid: string) => model.capabilities.filter(c => c.requirementIds.includes(rid));
  const unresolvedCov = model.coverage.filter(c => !c.reviewed).length;
  const openOverlaps = model.overlaps.filter(o => !o.resolved).length;
  const gIssues = groupIssues(model);
  useDraft(mark, 'merge-needs', pickR.length > 1 && !!mergeText.trim());
  useDraft(mark, 'merge-caps', pickC.length > 1 && !!mergeCap.trim());
  useDraft(mark, 'new-group', !!(newGroup.title.trim() || newGroup.boundary.trim()));
  useDraft(mark, 'new-need', !!newNeed.trim());
  useDraft(mark, 'new-cap', !!newCap.trim());
  const tog = (list: string[], id: string) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  return <section className="sx" data-testid="structured-output" aria-label="Full structured understanding">
    <header className="sx-head">
      <div><p className="sx-kicker">Full structured output</p><h2>Everything we read, in one place.</h2><p className="fi-hint">Coverage is limited to the inputs you supplied. Nothing here has been compared to the library yet.</p></div>
      <dl className="sx-stats">
        <div><dt>Needs</dt><dd data-testid="stat-needs">{model.requirements.length}</dd></div>
        <div><dt>Capabilities</dt><dd data-testid="stat-caps">{model.capabilities.length}</dd></div>
        <div className={unsupported.length ? 'warn' : ''}><dt>Unsupported</dt><dd>{unsupported.length}</dd></div>
        <div className={unresolvedCov + openOverlaps ? 'warn' : ''}><dt>To resolve</dt><dd data-testid="stat-unresolved">{unresolvedCov + openOverlaps}</dd></div>
      </dl>
    </header>

    <div className="sx-block"><h3 className="sx-h">1 · The understood problem</h3>
      <div className="sx-profile">{PROFILE_KEYS.map(k => { const f = model.profile[k]; const b: Basis = f.basis ?? (f.value.trim() ? 'inferred' : 'unknown'); return <div key={k} className="sx-field" data-testid={`structured-profile-${k}`}><p className="sx-lab">{labels[k]}<span className={`sx-basis ${b}`}>{basisLabel[b]}</span></p><p>{f.value.trim() || <em className="fi-hint">Not stated in your inputs.</em>}</p>{f.provenance && <p className="sx-prov">{f.provenance}</p>}</div>; })}</div>
    </div>

    <div className="sx-block"><h3 className="sx-h">2 · Groups and boundaries</h3>
      <p className="fi-hint">Each need sits in exactly one primary group. A boundary says what the group covers, so groups do not overlap.</p>
      {gIssues.length > 0 && <div className="fi-warning" data-testid="group-issues"><strong>Groups need attention before you can confirm.</strong><p>{gIssues.join(' ')}</p></div>}
      <ul className="sx-groups">{model.groups.map(g => <GroupRow key={g.id} mark={mark} g={g} locked={locked} count={model.requirements.filter(r => r.group === g.id).length + model.capabilities.filter(c => c.group === g.id).length}
        onSave={p => onCommit(patchGroup(model, g.id, p), 'Group updated. Its members need re-review.')} onRemove={() => { if (window.confirm(`Remove group “${g.title}”? Its items become ungrouped; they are not deleted.`)) onCommit(removeGroup(model, g.id), 'Group removed. Its items are now ungrouped.'); }} />)}</ul>
      <form className="sx-inline" onSubmit={e => { e.preventDefault(); if (!newGroup.title.trim()) return; onCommit(addGroup(model, newGroup.title.trim(), newGroup.boundary.trim()), 'Group added.'); setNewGroup({ title: '', boundary: '' }); }}>
        <input className="fi-input" data-testid="input-new-group" aria-label="New group title" placeholder="New group title" readOnly={locked} value={newGroup.title} onChange={e => setNewGroup({ ...newGroup, title: e.target.value })} />
        <input className="fi-input" aria-label="New group boundary" placeholder="Boundary: what it covers, what it does not" readOnly={locked} value={newGroup.boundary} onChange={e => setNewGroup({ ...newGroup, boundary: e.target.value })} />
        <button className="fi-btn" data-testid="button-add-group" disabled={locked || !newGroup.title.trim()}><Plus />Add group</button></form>
    </div>

    <div className="sx-block"><h3 className="sx-h">3 · Needs, by group <small>functional first, then constraints</small></h3>
      {groupIds.map(gid => { const list = model.requirements.filter(r => r.group === gid); if (!list.length) return null; const g = model.groups.find(x => x.id === gid);
        return <div key={gid || 'none'} className="sx-group"><p className="sx-gtitle">{groupTitle(gid)}{g?.boundary && <span> — {g.boundary}</span>}</p>
          {(['functional', 'constraint'] as const).map(kind => { const items = list.filter(r => r.kind === kind); return items.length ? <div key={kind}><p className="sx-kind">{kind === 'functional' ? 'Functional' : 'Constraints'}</p><ul className="sx-list">{items.map(r =>
            <ReqRow key={r.id} mark={mark} r={r} n={reqLabel(r.id)!} model={model} locked={locked} picked={pickR.includes(r.id)} onPick={() => setPickR(p => tog(p, r.id))} caps={capsFor(r.id).map(c => capLabel(c.id)!)}
              onSave={p => onCommit(patchRequirement(model, r.id, p), 'Need corrected. Read it back before confirming.')}
              onSplit={parts => { onCommit(splitRequirement(model, r.id, parts), `Need split into ${parts.length}. Mappings moved to each part; review them.`); setPickR([]); }}
              onRemove={() => { if (window.confirm('Remove this need? Its mappings are cleared. Undo restores it.')) { onCommit(removeRequirement(model, r.id), 'Need removed. References cleaned up.'); setPickR(p => p.filter(x => x !== r.id)); } }} />)}</ul></div> : null; })}</div>; })}
      {!model.requirements.length && <div className="fi-empty"><h3>No needs yet.</h3><p className="fi-hint">Add the first thing that must be true.</p></div>}
      {pickR.length > 1 && <form className="sx-merge" onSubmit={e => { e.preventDefault(); if (!mergeText.trim()) return; onCommit(mergeRequirements(model, pickR, mergeText.trim()), `${pickR.length} needs merged into one.`); setPickR([]); setMergeText(''); }}>
        <GitMerge /><span>Merge {pickR.map(reqLabel).join(', ')} into one atomic need:</span><input className="fi-input" data-testid="input-merge-needs" aria-label="Merged need statement" autoFocus value={mergeText} readOnly={locked} onChange={e => setMergeText(e.target.value)} placeholder="One statement that replaces them" />
        <button className="fi-btn primary" data-testid="button-merge-needs" disabled={locked || !mergeText.trim()}>Merge</button><button type="button" className="fi-link" onClick={() => setPickR([])}>Cancel</button></form>}
      <form className="sx-inline" onSubmit={e => { e.preventDefault(); const t = newNeed.trim(); if (!t) return; if (model.requirements.some(r => r.text.toLowerCase() === t.toLowerCase())) { onNotice('That need already exists. Edit it instead.'); return; } onCommit({ ...model, requirements: [...model.requirements, newRequirement(t)], orderReviewed: false }, 'Need added.'); setNewNeed(''); }}>
        <input className="fi-input" data-testid="input-structured-add-need" aria-label="Add a need" placeholder="Add a need — one atomic statement" readOnly={locked} value={newNeed} onChange={e => setNewNeed(e.target.value)} /><button className="fi-btn" data-testid="button-structured-add-need" disabled={locked || !newNeed.trim()}><Plus />Add need</button></form>
    </div>

    <div className="sx-block"><h3 className="sx-h">4 · Supplied capabilities, by group</h3>
      {model.capabilities.length ? groupIds.map(gid => { const list = model.capabilities.filter(c => c.group === gid); return list.length ? <div key={gid || 'none'} className="sx-group"><p className="sx-gtitle">{groupTitle(gid)}</p><ul className="sx-list">{list.map(c =>
        <CapRow key={c.id} mark={mark} c={c} n={capLabel(c.id)!} model={model} locked={locked} picked={pickC.includes(c.id)} onPick={() => setPickC(p => tog(p, c.id))} reqLabel={reqLabel}
          onSave={p => onCommit(patchCapability(model, c.id, p), 'Capability corrected. Read it back before confirming.')}
          onSplit={t => { onCommit(splitCapability(model, c.id, t), `Capability split into ${t.length}.`); setPickC([]); }}
          onRemove={() => { if (window.confirm('Remove this capability? Its mappings are cleared. Undo restores it.')) { onCommit(removeCapability(model, c.id), 'Capability removed. References cleaned up.'); setPickC(p => p.filter(x => x !== c.id)); } }} />)}</ul></div> : null; })
        : <p className="fi-hint">No prototype or agent capabilities were supplied. That is fine if you brought only a need.</p>}
      {pickC.length > 1 && <form className="sx-merge" onSubmit={e => { e.preventDefault(); if (!mergeCap.trim()) return; onCommit(mergeCapabilities(model, pickC, mergeCap.trim()), `${pickC.length} capabilities merged.`); setPickC([]); setMergeCap(''); }}>
        <GitMerge /><span>Merge {pickC.map(capLabel).join(', ')} into:</span><input className="fi-input" data-testid="input-merge-caps" aria-label="Merged capability name" autoFocus value={mergeCap} readOnly={locked} onChange={e => setMergeCap(e.target.value)} placeholder="Capability name" />
        <button className="fi-btn primary" data-testid="button-merge-caps" disabled={locked || !mergeCap.trim()}>Merge</button><button type="button" className="fi-link" onClick={() => setPickC([])}>Cancel</button></form>}
      <form className="sx-inline" onSubmit={e => { e.preventDefault(); const t = newCap.trim(); if (!t) return; onCommit({ ...model, capabilities: [...model.capabilities, newCapability(t)] }, 'Capability added. Describe it and map it to needs.'); setNewCap(''); }}>
        <input className="fi-input" data-testid="input-add-cap" aria-label="Add a capability" placeholder="Add a capability your solution provides" readOnly={locked} value={newCap} onChange={e => setNewCap(e.target.value)} /><button className="fi-btn" data-testid="button-add-cap" disabled={locked || !newCap.trim()}><Plus />Add capability</button></form>
    </div>

    {model.capabilities.length > 0 && model.requirements.length > 0 && <div className="sx-block"><h3 className="sx-h">5 · Capability → need mapping</h3>
      <p className="fi-hint">Tick where a supplied capability serves a need. Use Tab and Space to change a cell.</p>
      <div className="sx-matrix-wrap"><table className="sx-matrix" data-testid="mapping-matrix"><thead><tr><th scope="col">Need</th>{model.capabilities.map(c => <th key={c.id} scope="col" title={c.title}>{capLabel(c.id)}</th>)}</tr></thead>
        <tbody>{model.requirements.map(r => <tr key={r.id}><th scope="row"><b>{reqLabel(r.id)}</b> {r.text}</th>{model.capabilities.map(c => <td key={c.id}><input type="checkbox" data-testid={`map-${c.id}-${r.id}`} aria-label={`${c.title} serves ${r.text}`} disabled={locked} checked={c.requirementIds.includes(r.id)} onChange={() => onCommit(toggleMapping(model, c.id, r.id), 'Mapping updated.')} /></td>)}</tr>)}</tbody></table></div>
    </div>}

    <div className="sx-findings">
      <div className="sx-find"><h4><AlertTriangle />Unsupported needs</h4>{!model.capabilities.length ? <p className="fi-hint">No supplied solution to check against.</p> : unsupported.length ? <ul>{unsupported.map(r => <li key={r.id}><b>{reqLabel(r.id)}</b> {r.text}</li>)}</ul> : <p className="fi-hint">Every functional need maps to a supplied capability.</p>}</div>
      <div className="sx-find"><h4><Link2 />Unclear purpose</h4>{unclear.length ? <ul>{unclear.map(c => <li key={c.id}><b>{capLabel(c.id)}</b> {c.title} — serves no stated need</li>)}</ul> : <p className="fi-hint">Every capability serves a stated need.</p>}</div>
      <div className="sx-find" data-testid="overlaps"><h4><Layers />Overlaps</h4>{model.overlaps.length ? <ul>{model.overlaps.map(o => <li key={o.id} className={o.resolved ? 'done' : ''}><p>{o.itemIds.map(itemLabel).join('  ⟷  ')}</p>{o.note && <p className="sx-prov">{o.note}</p>}
        <label className="fi-check"><input type="checkbox" data-testid={`check-overlap-${o.id}`} disabled={locked} checked={o.resolved} onChange={e => onCommit({ ...model, overlaps: model.overlaps.map(x => x.id === o.id ? { ...x, resolved: e.target.checked } : x) }, e.target.checked ? 'Overlap marked resolved.' : 'Overlap reopened.')} />Resolved — keep both, or merge them above</label></li>)}</ul> : <p className="fi-hint">No overlaps detected.</p>}</div>
    </div>

    <div className="sx-block"><h3 className="sx-h">6 · Coverage of your inputs <small>{model.coverage.length - unresolvedCov} of {model.coverage.length} acknowledged</small></h3>
      <p className="fi-hint">Each excerpt from what you supplied, and where it went. Acknowledge each one; unresolved excerpts stay visible as gaps.</p>
      {model.coverage.length ? <ul className="sx-cov">{model.coverage.map(c => <CoverageRow key={c.id} mark={mark} c={c} locked={locked} sourceName={model.sources.find(s => s.id === c.sourceId)?.name || sourceLabels[c.sourceId]} refs={[...c.requirementIds.map(reqLabel), ...c.capabilityIds.map(capLabel)].filter((x): x is string => !!x)}
        onChange={p => onCommit({ ...model, coverage: model.coverage.map(x => x.id === c.id ? { ...x, ...p } : x) }, p.reviewed ? 'Coverage acknowledged.' : 'Coverage updated.')} />)}</ul> : <p className="fi-hint">No coverage trace was returned for this interpretation. Re-interpret to produce one.</p>}
    </div>
  </section>;
}

function GroupRow({ mark, g, count, locked, onSave, onRemove }: { mark: Mark; g: { id: string; title: string; boundary: string }; count: number; locked: boolean; onSave: (p: { title: string; boundary: string }) => void; onRemove: () => void }) {
  const [edit, setEdit] = useState(false); const [d, setD] = useState(g);
  useDraft(mark, `group-${g.id}`, edit);
  if (edit) return <li><form className="sx-inline" onSubmit={e => { e.preventDefault(); if (!d.title.trim()) return; onSave({ title: d.title.trim(), boundary: d.boundary.trim() }); setEdit(false); }}><input className="fi-input" aria-label="Group title" value={d.title} onChange={e => setD({ ...d, title: e.target.value })} /><input className="fi-input" aria-label="Group boundary" value={d.boundary} onChange={e => setD({ ...d, boundary: e.target.value })} /><button className="fi-btn primary" disabled={locked || !d.title.trim()}><Check />Save</button><button type="button" className="fi-link" onClick={() => setEdit(false)}>Cancel</button></form></li>;
  return <li data-testid={`group-${g.id}`}><b>{g.title}</b><span>{g.boundary || 'No boundary stated'}</span><small>{count} items</small><button className="fi-icon" aria-label={`Edit group ${g.title}`} disabled={locked} onClick={() => { setD(g); setEdit(true); }}><Pencil /></button><button className="fi-icon" aria-label={`Remove group ${g.title}`} disabled={locked} onClick={onRemove}><Trash2 /></button></li>;
}

function SplitForm({ mark, locked, seed, onSplit, onCancel, label }: { mark: Mark; locked: boolean; seed: string; onSplit: (p: string[]) => void; onCancel: () => void; label: string }) {
  const [t, setT] = useState(`${seed}\n`);
  const [key] = useState(() => `split-${crypto.randomUUID()}`);
  useDraft(mark, key, true);
  const parts = t.split('\n').map(x => x.trim()).filter(Boolean);
  return <form className="sx-edit" onSubmit={e => { e.preventDefault(); if (parts.length > 1) onSplit(parts); }}><label className="fi-input-label">{label} — one per line<textarea className="fi-input" data-testid="input-split" rows={4} autoFocus value={t} readOnly={locked} onChange={e => setT(e.target.value)} /></label>
    <div className="fi-actions"><button type="button" className="fi-btn" onClick={onCancel}>Cancel</button><button className="fi-btn primary" data-testid="button-split-save" disabled={locked || parts.length < 2}><Scissors />Split into {parts.length}</button></div></form>;
}

function ReqRow({ mark, r, n, model, caps, locked, picked, onPick, onSave, onSplit, onRemove }: { mark: Mark; r: Requirement; n: string; model: Model; caps: string[]; locked: boolean; picked: boolean; onPick: () => void; onSave: (p: Partial<Requirement>) => void; onSplit: (p: string[]) => void; onRemove: () => void }) {
  const [mode, setMode] = useState<null | 'edit' | 'split'>(null);
  const [d, setD] = useState(r);
  useDraft(mark, `need-${r.id}`, mode === 'edit');
  return <li className={`sx-item ${r.changed ? 'changed' : ''} ${picked ? 'picked' : ''}`} data-testid={`structured-need-${r.id}`}>
    <div className="sx-row"><input type="checkbox" aria-label={`Select ${n} to merge`} data-testid={`check-pick-need-${r.id}`} checked={picked} disabled={locked} onChange={onPick} /><b className="sx-n">{n}</b>
      <div className="sx-body"><p className="sx-stmt">{r.text}</p>
        <p className="sx-meta"><span>{r.acceptance ? <>Accept when: {r.acceptance}</> : <em>No acceptance check yet</em>}</span></p>
        <p className="sx-meta"><span className="sx-prov">{r.provenance || (r.sources.length ? r.sources.map(s => sourceLabels[s]).join(' + ') : 'Added by you')}</span>{caps.length ? <span className="sx-chip">Served by {caps.join(', ')}</span> : null}{r.edited && <span className="sx-chip warm">Edited by you</span>}{r.reviewed && <span className="sx-chip ok"><Check />Confirmed</span>}</p></div>
      <span className="sx-acts"><button className="fi-icon" aria-label={`Edit ${n}`} data-testid={`button-edit-need-${r.id}`} disabled={locked} onClick={() => { setD(r); setMode('edit'); }}><Pencil /></button><button className="fi-icon" aria-label={`Split ${n}`} data-testid={`button-split-need-${r.id}`} disabled={locked} onClick={() => setMode('split')}><Scissors /></button><button className="fi-icon" aria-label={`Remove ${n}`} data-testid={`button-remove-need-${r.id}`} disabled={locked} onClick={onRemove}><Trash2 /></button></span></div>
    {mode === 'split' && <SplitForm mark={mark} locked={locked} seed={r.text} label="Atomic needs" onCancel={() => setMode(null)} onSplit={p => { onSplit(p); setMode(null); }} />}
    {mode === 'edit' && <form className="sx-edit" onSubmit={e => { e.preventDefault(); if (!d.text.trim()) return; onSave({ text: d.text.trim(), group: d.group, kind: d.kind, acceptance: d.acceptance.trim(), provenance: d.provenance?.trim() }); setMode(null); }}>
      <label className="fi-input-label">Atomic statement<textarea className="fi-input" data-testid="input-need-text" rows={2} readOnly={locked} value={d.text} onChange={e => setD({ ...d, text: e.target.value })} /></label>
      <div className="sx-grid2"><label className="fi-input-label">Primary group<select className="fi-input" data-testid="select-need-group" disabled={locked} value={d.group} onChange={e => setD({ ...d, group: e.target.value })}><option value="">Ungrouped</option>{model.groups.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label>
        <label className="fi-input-label">Kind<select className="fi-input" data-testid="select-need-kind" disabled={locked} value={d.kind} onChange={e => setD({ ...d, kind: e.target.value as Requirement['kind'] })}><option value="functional">Functional</option><option value="constraint">Constraint</option></select></label></div>
      <label className="fi-input-label">Acceptance — how we will know it is met<input className="fi-input" data-testid="input-need-acceptance" readOnly={locked} value={d.acceptance} onChange={e => setD({ ...d, acceptance: e.target.value })} /></label>
      <label className="fi-input-label">Provenance — where this came from<input className="fi-input" data-testid="input-need-provenance" readOnly={locked} value={d.provenance ?? ''} onChange={e => setD({ ...d, provenance: e.target.value })} /></label>
      <div className="fi-actions"><button type="button" className="fi-btn" onClick={() => setMode(null)}><X />Cancel</button><button className="fi-btn primary" data-testid="button-need-save" disabled={locked || !d.text.trim()}><Check />Save correction</button></div></form>}
  </li>;
}

function CapRow({ mark, c, n, model, locked, picked, onPick, reqLabel, onSave, onSplit, onRemove }: { mark: Mark; c: Capability; n: string; model: Model; locked: boolean; picked: boolean; onPick: () => void; reqLabel: (id: string) => string | null; onSave: (p: Partial<Capability>) => void; onSplit: (t: string[]) => void; onRemove: () => void }) {
  const [mode, setMode] = useState<null | 'edit' | 'split'>(null);
  const [d, setD] = useState(c);
  useDraft(mark, `cap-${c.id}`, mode === 'edit');
  const refs = c.requirementIds.map(reqLabel).filter(Boolean);
  return <li className={`sx-item ${c.changed ? 'changed' : ''} ${picked ? 'picked' : ''}`} data-testid={`structured-cap-${c.id}`}>
    <div className="sx-row"><input type="checkbox" aria-label={`Select ${n} to merge`} data-testid={`check-pick-cap-${c.id}`} checked={picked} disabled={locked} onChange={onPick} /><b className="sx-n">{n}</b>
      <div className="sx-body"><p className="sx-stmt">{c.title}</p>{c.description && <p className="fi-hint">{c.description}</p>}
        <p className="sx-meta"><span className="sx-prov">{c.provenance || (c.sourceId ? sourceLabels[c.sourceId] : 'Added by you')}</span>{refs.length ? <span className="sx-chip">Serves {refs.join(', ')}</span> : <span className="sx-chip warm">Purpose unclear</span>}{c.gap.trim() && <span className="sx-chip warm">Gap: {c.gap}</span>}{c.edited && <span className="sx-chip warm">Edited by you</span>}{c.status === 'Confirmed' && <span className="sx-chip ok"><Check />Confirmed</span>}</p></div>
      <span className="sx-acts"><button className="fi-icon" aria-label={`Edit ${n}`} data-testid={`button-edit-cap-${c.id}`} disabled={locked} onClick={() => { setD(c); setMode('edit'); }}><Pencil /></button><button className="fi-icon" aria-label={`Split ${n}`} data-testid={`button-split-cap-${c.id}`} disabled={locked} onClick={() => setMode('split')}><Scissors /></button><button className="fi-icon" aria-label={`Remove ${n}`} data-testid={`button-remove-cap-${c.id}`} disabled={locked} onClick={onRemove}><Trash2 /></button></span></div>
    {mode === 'split' && <SplitForm mark={mark} locked={locked} seed={c.title} label="Capability names" onCancel={() => setMode(null)} onSplit={t => { onSplit(t); setMode(null); }} />}
    {mode === 'edit' && <form className="sx-edit" onSubmit={e => { e.preventDefault(); if (!d.title.trim()) return; onSave({ title: d.title.trim(), description: d.description.trim(), group: d.group, provenance: d.provenance?.trim(), requirementIds: d.requirementIds }); setMode(null); }}>
      <label className="fi-input-label">Name<input className="fi-input" data-testid="input-cap-title" readOnly={locked} value={d.title} onChange={e => setD({ ...d, title: e.target.value })} /></label>
      <label className="fi-input-label">What it does<textarea className="fi-input" rows={2} readOnly={locked} value={d.description} onChange={e => setD({ ...d, description: e.target.value })} /></label>
      <div className="sx-grid2"><label className="fi-input-label">Primary group<select className="fi-input" data-testid="select-cap-group" disabled={locked} value={d.group} onChange={e => setD({ ...d, group: e.target.value })}><option value="">Ungrouped</option>{model.groups.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label>
        <label className="fi-input-label">Provenance<input className="fi-input" readOnly={locked} value={d.provenance ?? ''} onChange={e => setD({ ...d, provenance: e.target.value })} /></label></div>
      <fieldset className="sx-maps"><legend className="fi-input-label">Serves these needs</legend>{model.requirements.map(r => <label key={r.id} className="fi-check"><input type="checkbox" disabled={locked} checked={d.requirementIds.includes(r.id)} onChange={() => setD({ ...d, requirementIds: d.requirementIds.includes(r.id) ? d.requirementIds.filter(x => x !== r.id) : [...d.requirementIds, r.id] })} /><b>{reqLabel(r.id)}</b> {r.text}</label>)}</fieldset>
      <div className="fi-actions"><button type="button" className="fi-btn" onClick={() => setMode(null)}><X />Cancel</button><button className="fi-btn primary" data-testid="button-cap-save" disabled={locked || !d.title.trim()}><Check />Save correction</button></div></form>}
  </li>;
}

function CoverageRow({ mark, c, sourceName, refs, locked, onChange }: { mark: Mark; c: Model['coverage'][number]; sourceName: string; refs: string[]; locked: boolean; onChange: (p: Partial<Model['coverage'][number]>) => void }) {
  const [note, setNote] = useState(c.note);
  useEffect(() => { setNote(c.note); }, [c.note]);
  useDraft(mark, `cov-${c.id}`, note !== c.note);
  return <li className={`sx-covrow ${c.disposition} ${c.reviewed ? 'done' : ''}`} data-testid={`coverage-${c.id}`}>
    <blockquote>“{c.excerpt}”<cite>{sourceName}</cite></blockquote>
    <div className="sx-covctl">
      <select className="fi-input" aria-label="Disposition" data-testid={`select-coverage-${c.id}`} disabled={locked} value={c.disposition} onChange={e => onChange({ disposition: e.target.value as Disposition, reviewed: false })}><option value="accounted" disabled={!refs.length}>Accounted for{refs.length ? '' : ' (link an item first)'}</option><option value="unresolved">Unresolved gap</option><option value="out-of-scope">Out of scope</option></select>
      <span className="fi-hint">{refs.length ? `→ ${refs.join(', ')}` : 'Not linked to any item'}</span>
      <input className="fi-input" aria-label="Coverage note" placeholder="Note (optional)" readOnly={locked} value={note} onChange={e => setNote(e.target.value)} onBlur={() => { if (note !== c.note) onChange({ note }); }} />
      <label className="fi-check"><input type="checkbox" data-testid={`check-coverage-${c.id}`} disabled={locked} checked={c.reviewed} onChange={e => onChange({ reviewed: e.target.checked })} />{c.disposition === 'unresolved' ? 'Acknowledged as unresolved' : 'Acknowledged'}</label>
    </div>
  </li>;
}
