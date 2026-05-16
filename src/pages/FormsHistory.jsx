import { useEffect, useMemo, useState } from 'react';
import { fetchAllSnapshots } from '../api';
import './FormsHistory.css';

const STORAGE_KEY = 'toto-forms-history-v1';
const PRED_OPTIONS = ['1', 'X', '2'];

// ── Persistence ──────────────────────────────────────────────────────
function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEntries(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    console.error('Failed to save forms history', e);
  }
}

function uid() {
  return `fh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Auto-derive 1/X/2 from a finished game's score. Returns null for unfinished
// or unknown.
function actualFromScore(g) {
  if (!g) return null;
  const sh = g.score_home, sa = g.score_away;
  // Treat as finished only when status is 'finished' OR scores look meaningful
  // with a clearly non-default status. Use kickoff text fallback for Hebrew
  // "הסתיים" (finished) sometimes returned by the form source.
  const looksFinished =
    g.status === 'finished' ||
    (typeof g.kickoff === 'string' && g.kickoff.includes('הסתיים'));
  if (!looksFinished) return null;
  if (typeof sh !== 'number' || typeof sa !== 'number') return null;
  if (sh > sa) return '1';
  if (sh < sa) return '2';
  return 'X';
}

function effectiveActual(g) {
  if (g.actualOverride) return g.actualOverride;
  return actualFromScore(g);
}

function isHit(g) {
  const actual = effectiveActual(g);
  if (!actual || !g.predictions || g.predictions.length === 0) return null;
  return g.predictions.includes(actual);
}

function entryStats(entry) {
  if (!entry.games?.length) return { total: 0, scored: 0, hits: 0, missing: 0 };
  let hits = 0, scored = 0, missing = 0;
  for (const g of entry.games) {
    const h = isHit(g);
    if (h === null) missing += 1;
    else { scored += 1; if (h) hits += 1; }
  }
  return { total: entry.games.length, scored, hits, missing };
}

// ── Form catalogue: dedupe by kind+form_number, keep latest snapshot ─
function buildFormCatalogue(snapshots) {
  const map = new Map();
  for (const snap of snapshots || []) {
    const snapDate = snap?.date || null;
    const tf = snap?.toto_forms || {};
    for (const [kind, form] of Object.entries(tf)) {
      const fn = form?.form_number;
      if (fn == null) continue;
      const games = Array.isArray(form.games) ? form.games : [];
      if (games.length === 0) continue;
      const key = `${kind}-${fn}`;
      const existing = map.get(key);
      if (!existing || (snapDate && existing.snapshotDate &&
                       snapDate > existing.snapshotDate) ||
          (snapDate && !existing.snapshotDate)) {
        map.set(key, {
          key, kind, formNumber: fn,
          snapshotDate: snapDate,
          games,
        });
      }
    }
  }
  // Newest first.
  return [...map.values()].sort((a, b) => {
    if (a.snapshotDate && b.snapshotDate && a.snapshotDate !== b.snapshotDate) {
      return a.snapshotDate < b.snapshotDate ? 1 : -1;
    }
    return b.formNumber - a.formNumber;
  });
}

function kindLabel(kind) {
  return kind === 'toto16' ? 'Winner 16' :
         kind === 'world'  ? 'World' :
         kind;
}

// ── Component ────────────────────────────────────────────────────────
export default function FormsHistory() {
  const [entries, setEntries] = useState(loadEntries);
  const [editingId, setEditingId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Snapshots are needed both for the picker AND to refresh actual scores
  // on existing entries when the form is opened later. Loaded once.
  const [snapshots, setSnapshots] = useState(null);
  const [loadError, setLoadError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchAllSnapshots()
      .then(s => { if (!cancelled) setSnapshots(s); })
      .catch(e => { if (!cancelled) setLoadError(e.message || 'Failed to load forms'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { saveEntries(entries); }, [entries]);

  const catalogue = useMemo(() => buildFormCatalogue(snapshots), [snapshots]);

  const editing = useMemo(
    () => entries.find(e => e.id === editingId) || null,
    [entries, editingId]
  );

  function addEntryFromForm(formMeta) {
    // Drop user picks etc. — pull the FULL game payload so we can show
    // kickoff/league/scores. User-editable bits start empty.
    const games = formMeta.games.map(g => ({
      home: g.home, away: g.away, league: g.league,
      kickoff: g.kickoff, status: g.status,
      score_home: g.score_home, score_away: g.score_away,
      predictions: [], actualOverride: null,
    }));
    const entry = {
      id: uid(),
      kind: formMeta.kind,
      formNumber: formMeta.formNumber,
      snapshotDate: formMeta.snapshotDate,
      games,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEntries([entry, ...entries]);
    setEditingId(entry.id);
    setPickerOpen(false);
  }

  function updateEntry(id, patch) {
    setEntries(entries.map(e => e.id === id
      ? { ...e, ...patch, updatedAt: new Date().toISOString() }
      : e));
  }

  function deleteEntry(id) {
    if (!confirm('Delete this form history entry?')) return;
    setEntries(entries.filter(e => e.id !== id));
    if (editingId === id) setEditingId(null);
  }

  // When opening an entry for editing, refresh game scores/status from the
  // latest snapshot (so newly-finished games auto-fill). Preserves the user's
  // predictions and actualOverride.
  function openEntry(id) {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;
    const fresh = catalogue.find(f =>
      f.kind === entry.kind && f.formNumber === entry.formNumber);
    if (fresh) {
      const byPair = new Map();
      for (const fg of fresh.games) {
        byPair.set(`${fg.home}|${fg.away}`, fg);
      }
      const refreshed = entry.games.map(g => {
        const fg = byPair.get(`${g.home}|${g.away}`);
        if (!fg) return g;
        return {
          ...g,
          league: fg.league, kickoff: fg.kickoff, status: fg.status,
          score_home: fg.score_home, score_away: fg.score_away,
        };
      });
      // Only update if any score/status actually changed — avoids touching
      // updatedAt on every open.
      const changed = refreshed.some((g, i) => {
        const o = entry.games[i];
        return g.status !== o.status || g.score_home !== o.score_home ||
               g.score_away !== o.score_away || g.kickoff !== o.kickoff;
      });
      if (changed) {
        updateEntry(id, { games: refreshed, snapshotDate: fresh.snapshotDate });
      }
    }
    setEditingId(id);
  }

  if (editing) {
    return (
      <FormHistoryEditor
        entry={editing}
        onChange={patch => updateEntry(editing.id, patch)}
        onBack={() => setEditingId(null)}
        onDelete={() => deleteEntry(editing.id)}
      />
    );
  }

  return (
    <div className="fh-container">
      <h1>Forms History</h1>
      <p className="fh-sub">
        Pick a Toto form by its ID, record what you guessed, and the actual results.
        Saved in your browser (localStorage) — useful for tracking your real-life betting.
      </p>
      <div className="fh-toolbar">
        <button className="fh-btn" onClick={() => setPickerOpen(true)}
                disabled={!snapshots}>
          + Add form from history
        </button>
        {!snapshots && !loadError && <span className="fh-msg">Loading forms…</span>}
        {loadError && <span className="fh-err">{loadError}</span>}
      </div>

      {entries.length === 0 ? (
        <div className="fh-empty">
          No entries yet. Click <strong>+ Add form from history</strong> to pick a form by ID.
        </div>
      ) : (
        <div className="fh-list">
          {entries.map(e => {
            const s = entryStats(e);
            return (
              <div key={e.id} className="fh-card" onClick={() => openEntry(e.id)}>
                <div className="fh-card-title">
                  {kindLabel(e.kind)} <span style={{color:'#666'}}>#{e.formNumber}</span>
                </div>
                <div className="fh-card-meta">{s.total} games</div>
                <div className="fh-card-score">
                  {s.scored > 0
                    ? <>Score: <strong>{s.hits}</strong> / {s.scored}
                        {s.missing > 0 && <span style={{color: '#888'}}> ({s.missing} pending)</span>}</>
                    : <span style={{color: '#888'}}>No actuals yet</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pickerOpen && (
        <FormPicker
          catalogue={catalogue}
          onPick={addEntryFromForm}
          onClose={() => setPickerOpen(false)}
          existing={entries.map(e => `${e.kind}-${e.formNumber}`)}
        />
      )}
    </div>
  );
}

// ── Picker ───────────────────────────────────────────────────────────
function FormPicker({ catalogue, onPick, onClose, existing }) {
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const existingSet = useMemo(() => new Set(existing), [existing]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalogue.filter(f => {
      if (kindFilter !== 'all' && f.kind !== kindFilter) return false;
      if (!q) return true;
      return String(f.formNumber).includes(q) ||
             f.kind.toLowerCase().includes(q);
    });
  }, [catalogue, search, kindFilter]);

  return (
    <div className="fh-picker-overlay" onClick={onClose}>
      <div className="fh-picker" onClick={e => e.stopPropagation()}>
        <div className="fh-picker-header">
          <h2>Pick a form</h2>
          <button className="fh-picker-close" onClick={onClose}>×</button>
        </div>
        <div className="fh-picker-search">
          <input
            type="text"
            placeholder="Search by form number…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <select value={kindFilter} onChange={e => setKindFilter(e.target.value)}>
            <option value="all">All types</option>
            <option value="toto16">Winner 16</option>
            <option value="world">World</option>
          </select>
        </div>
        <div className="fh-picker-list">
          {filtered.length === 0 && (
            <div className="fh-msg">No matching forms.</div>
          )}
          {filtered.map(f => (
            <div key={f.key} className="fh-picker-item"
                 onClick={() => onPick(f)}>
              <div>
                <div className="fh-picker-item-main">
                  #{f.formNumber}
                  {existingSet.has(f.key) && (
                    <span style={{marginLeft: 8, fontSize: '0.75em', color: '#888'}}>
                      (already added)
                    </span>
                  )}
                </div>
                <div className="fh-picker-item-meta">
                  {f.games.length} games · seen {f.snapshotDate || '—'}
                </div>
              </div>
              <span className={`fh-picker-item-pill fh-pill-${f.kind}`}>
                {kindLabel(f.kind)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────
function FormHistoryEditor({ entry, onChange, onBack, onDelete }) {
  function togglePrediction(idx, pick) {
    const next = entry.games.slice();
    const g = { ...next[idx] };
    const set = new Set(g.predictions || []);
    if (set.has(pick)) set.delete(pick); else set.add(pick);
    g.predictions = PRED_OPTIONS.filter(p => set.has(p));
    next[idx] = g;
    onChange({ games: next });
  }

  function setActualOverride(idx, value) {
    const next = entry.games.slice();
    const cur = next[idx].actualOverride;
    next[idx] = { ...next[idx], actualOverride: cur === value ? null : value };
    onChange({ games: next });
  }

  const stats = entryStats(entry);

  return (
    <div className="fh-container">
      <div className="fh-toolbar">
        <button className="fh-btn fh-btn-secondary" onClick={onBack}>← Back</button>
        <button className="fh-btn fh-btn-danger" onClick={onDelete}
                style={{ marginLeft: 'auto' }}>Delete entry</button>
      </div>

      <div className="fh-editor-header">
        <div>
          <div className="fh-editor-title">
            {kindLabel(entry.kind)} <span style={{color:'#666'}}>#{entry.formNumber}</span>
          </div>
          <div className="fh-editor-meta">
            {entry.games.length} games · last snapshot {entry.snapshotDate || '—'}
          </div>
        </div>
      </div>

      <div className="fh-selected-wrap">
        <table className="fh-selected">
          <thead>
            <tr>
              <th>#</th>
              <th>Match</th>
              <th>Kickoff / Score</th>
              <th>Your guess</th>
              <th>Actual</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entry.games.map((g, idx) => {
              const auto = actualFromScore(g);
              const effective = effectiveActual(g);
              const hit = isHit(g);
              const rowClass =
                hit === true ? 'fh-row-hit' :
                hit === false ? 'fh-row-miss' : '';
              return (
                <tr key={`${idx}-${g.home}-${g.away}`} className={rowClass}>
                  <td>{idx + 1}</td>
                  <td>
                    <div>
                      <strong>{g.home}</strong>
                      <span style={{color:'#888'}}> vs </span>
                      <strong>{g.away}</strong>
                    </div>
                    {g.league && (
                      <div style={{fontSize:'0.78em', color:'#888'}}>{g.league}</div>
                    )}
                  </td>
                  <td>
                    <div className="fh-kickoff">{g.kickoff || '—'}</div>
                    {(typeof g.score_home === 'number' && typeof g.score_away === 'number' &&
                      (g.score_home > 0 || g.score_away > 0 || g.status === 'finished')) && (
                      <div className="fh-score">{g.score_home}–{g.score_away}</div>
                    )}
                  </td>
                  <td className="fh-pred-cell">
                    {PRED_OPTIONS.map(p => {
                      const on = (g.predictions || []).includes(p);
                      return (
                        <label key={p} className={on ? 'on' : ''}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => togglePrediction(idx, p)}
                          />{p}
                        </label>
                      );
                    })}
                  </td>
                  <td className="fh-actual-cell">
                    {PRED_OPTIONS.map(p => {
                      const on = effective === p;
                      const isAuto = !g.actualOverride && auto === p;
                      return (
                        <label key={p} className={on ? 'on' : ''}>
                          <input
                            type="radio"
                            name={`actual-${entry.id}-${idx}`}
                            checked={on}
                            onChange={() => setActualOverride(idx, p)}
                          />{p}{isAuto && <span style={{marginLeft:2}} title="auto from score">·</span>}
                        </label>
                      );
                    })}
                    {auto && !g.actualOverride && (
                      <div className="fh-actual-auto">auto</div>
                    )}
                  </td>
                  <td>
                    {hit === true && <span className="fh-hit-badge hit">✓</span>}
                    {hit === false && <span className="fh-hit-badge miss">✗</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="fh-summary">
        <div className="fh-summary-item">
          Total: <strong>{stats.total}</strong>
        </div>
        <div className="fh-summary-item">
          Scored: <strong>{stats.hits}</strong> / {stats.scored}
        </div>
        {stats.missing > 0 && (
          <div className="fh-summary-item" style={{color:'#888'}}>
            Pending: {stats.missing}
          </div>
        )}
        {stats.scored > 0 && (
          <div className="fh-summary-item">
            Accuracy: <strong>{((stats.hits / stats.scored) * 100).toFixed(1)}%</strong>
          </div>
        )}
      </div>
    </div>
  );
}
