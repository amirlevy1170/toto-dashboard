import { useEffect, useMemo, useState } from 'react';
import { fetchAllSnapshots } from '../api';
import { leagueName } from '../utils';
import './CustomForms.css';

const STORAGE_KEY = 'toto-custom-forms-v1';
const PRED_OPTIONS = ['1', 'X', '2'];

// ── Persistence ──────────────────────────────────────────────────────
function loadForms() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveForms(forms) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(forms));
  } catch (e) {
    console.error('Failed to save custom forms', e);
  }
}

function uid() {
  return `cf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function gameKey(g) {
  return `${g.date}|${g.league}|${g.home}|${g.away}`.toLowerCase();
}

// Each form game: { gameId, date, league, home, away, predictions: ['1','X'], actual: '1'|'X'|'2'|null }
function isHit(g) {
  if (!g.actual || !g.predictions || g.predictions.length === 0) return null;
  return g.predictions.includes(g.actual);
}

function formStats(form) {
  if (!form.games || form.games.length === 0) {
    return { total: 0, scored: 0, hits: 0, missing: 0 };
  }
  let hits = 0, scored = 0, missing = 0;
  for (const g of form.games) {
    const h = isHit(g);
    if (h === null) {
      missing += 1;
    } else {
      scored += 1;
      if (h) hits += 1;
    }
  }
  return { total: form.games.length, scored, hits, missing };
}

// ── Component ────────────────────────────────────────────────────────
export default function CustomForms() {
  const [forms, setForms] = useState(loadForms);
  const [editingId, setEditingId] = useState(null);

  // Persist on every change.
  useEffect(() => { saveForms(forms); }, [forms]);

  const editing = useMemo(
    () => forms.find(f => f.id === editingId) || null,
    [forms, editingId]
  );

  function createForm() {
    const today = new Date().toISOString().slice(0, 10);
    const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const f = {
      id: uid(),
      name: `Form ${forms.length + 1}`,
      dateFrom: monthAgo,
      dateTo: today,
      games: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setForms([f, ...forms]);
    setEditingId(f.id);
  }

  function updateForm(id, patch) {
    setForms(forms.map(f => f.id === id
      ? { ...f, ...patch, updatedAt: new Date().toISOString() }
      : f));
  }

  function deleteForm(id) {
    if (!confirm('Delete this form?')) return;
    setForms(forms.filter(f => f.id !== id));
    if (editingId === id) setEditingId(null);
  }

  if (editing) {
    return (
      <CustomFormEditor
        form={editing}
        onChange={patch => updateForm(editing.id, patch)}
        onBack={() => setEditingId(null)}
        onDelete={() => deleteForm(editing.id)}
      />
    );
  }

  return (
    <div className="cf-container">
      <h1>Custom Forms</h1>
      <p className="cf-sub">
        Build your own forms from past games, record predictions and actual results.
        Forms are saved in your browser (localStorage).
      </p>
      <div className="cf-toolbar">
        <button className="cf-btn" onClick={createForm}>+ New form</button>
      </div>

      {forms.length === 0 ? (
        <div className="cf-empty">
          No forms yet. Click <strong>+ New form</strong> to create one.
        </div>
      ) : (
        <div className="cf-list">
          {forms.map(f => {
            const s = formStats(f);
            return (
              <div key={f.id} className="cf-card" onClick={() => setEditingId(f.id)}>
                <div className="cf-card-title">{f.name || '(untitled)'}</div>
                <div className="cf-card-meta">
                  {f.dateFrom} → {f.dateTo}
                </div>
                <div className="cf-card-meta">{s.total} game{s.total !== 1 ? 's' : ''}</div>
                <div className="cf-card-score">
                  {s.scored > 0
                    ? <>Score: <strong>{s.hits}</strong> / {s.scored}
                        {s.missing > 0 && <span style={{color: '#888'}}> ({s.missing} pending)</span>}</>
                    : <span style={{color: '#888'}}>No results entered</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────
function CustomFormEditor({ form, onChange, onBack, onDelete }) {
  const [snapshots, setSnapshots] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchAllSnapshots()
      .then(s => { if (!cancelled) setSnapshots(s); })
      .catch(e => { if (!cancelled) setLoadError(e.message || 'Failed to load games'); });
    return () => { cancelled = true; };
  }, []);

  // Pool every prediction across snapshots, dedup by (date,league,home,away),
  // and filter to the form's date range.
  const availableGames = useMemo(() => {
    if (!snapshots) return [];
    const seen = new Map();
    for (const snap of snapshots) {
      for (const p of snap?.predictions || []) {
        if (!p?.date || !p?.home || !p?.away || !p?.league) continue;
        if (p.date < form.dateFrom || p.date > form.dateTo) continue;
        const k = gameKey(p);
        if (!seen.has(k)) {
          seen.set(k, { date: p.date, league: p.league, home: p.home, away: p.away });
        }
      }
    }
    const arr = [...seen.values()];
    arr.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1
                       : a.league.localeCompare(b.league)
                       || a.home.localeCompare(b.home));
    return arr;
  }, [snapshots, form.dateFrom, form.dateTo]);

  const selectedKeys = useMemo(
    () => new Set(form.games.map(g => gameKey(g))),
    [form.games]
  );

  const filteredAvailable = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return availableGames;
    return availableGames.filter(g =>
      g.home.toLowerCase().includes(q) ||
      g.away.toLowerCase().includes(q) ||
      g.league.toLowerCase().includes(q));
  }, [availableGames, search]);

  function addGame(g) {
    if (selectedKeys.has(gameKey(g))) return;
    onChange({
      games: [...form.games, {
        gameId: gameKey(g),
        date: g.date, league: g.league, home: g.home, away: g.away,
        predictions: [], actual: null,
      }],
    });
  }

  function removeGame(idx) {
    const next = form.games.slice();
    next.splice(idx, 1);
    onChange({ games: next });
  }

  function togglePrediction(idx, pick) {
    const next = form.games.slice();
    const g = { ...next[idx] };
    const set = new Set(g.predictions || []);
    if (set.has(pick)) set.delete(pick); else set.add(pick);
    g.predictions = PRED_OPTIONS.filter(p => set.has(p));  // canonical order
    next[idx] = g;
    onChange({ games: next });
  }

  function setActual(idx, value) {
    const next = form.games.slice();
    next[idx] = { ...next[idx], actual: next[idx].actual === value ? null : value };
    onChange({ games: next });
  }

  const stats = formStats(form);

  return (
    <div className="cf-container cf-editor">
      <div className="cf-toolbar">
        <button className="cf-btn cf-btn-secondary" onClick={onBack}>← Back</button>
        <button className="cf-btn cf-btn-danger" onClick={onDelete}
                style={{ marginLeft: 'auto' }}>Delete form</button>
      </div>

      <div className="cf-editor-header">
        <div className="cf-field">
          <label>Name</label>
          <input
            type="text"
            value={form.name}
            onChange={e => onChange({ name: e.target.value })}
          />
        </div>
        <div className="cf-field">
          <label>From</label>
          <input
            type="date"
            value={form.dateFrom}
            onChange={e => onChange({ dateFrom: e.target.value })}
          />
        </div>
        <div className="cf-field">
          <label>To</label>
          <input
            type="date"
            value={form.dateTo}
            onChange={e => onChange({ dateTo: e.target.value })}
          />
        </div>
      </div>

      <div className="cf-cols">
        <div className="cf-panel">
          <h3>
            Available games
            <span className="cf-panel-count">
              {snapshots ? `${filteredAvailable.length} / ${availableGames.length}` : '…'}
            </span>
          </h3>
          {loadError && <div className="cf-err">{loadError}</div>}
          {!snapshots && !loadError && <div className="cf-msg">Loading games…</div>}
          {snapshots && availableGames.length === 0 && (
            <div className="cf-msg">
              No games found in this date range. Try widening the dates — the snapshot archive
              currently covers roughly the last ~5 weeks.
            </div>
          )}
          {snapshots && availableGames.length > 0 && (
            <>
              <input
                className="cf-search"
                type="text"
                placeholder="Filter by team or league…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <div className="cf-games">
                {filteredAvailable.map(g => {
                  const inForm = selectedKeys.has(gameKey(g));
                  return (
                    <div key={gameKey(g)} className="cf-game">
                      <div>
                        <div className="cf-game-date">{g.date.slice(5)}</div>
                        <div className="cf-game-league">{leagueName(g.league)}</div>
                      </div>
                      <div className="cf-game-teams">
                        {g.home} <span style={{color: '#888'}}>vs</span> {g.away}
                      </div>
                      <button
                        className="cf-game-add"
                        disabled={inForm}
                        onClick={() => addGame(g)}
                      >
                        {inForm ? '✓ added' : '+ add'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="cf-panel">
          <h3>
            Your form
            <span className="cf-panel-count">
              {form.games.length} game{form.games.length !== 1 ? 's' : ''}
            </span>
          </h3>
          {form.games.length === 0 ? (
            <div className="cf-msg">
              No games selected yet. Click <strong>+ add</strong> on a game from the left.
            </div>
          ) : (
            <div className="cf-selected-wrap">
              <table className="cf-selected">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Match</th>
                    <th>Prediction</th>
                    <th>Actual</th>
                    <th></th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {form.games.map((g, idx) => {
                    const hit = isHit(g);
                    const rowClass =
                      hit === true ? 'cf-row-hit' :
                      hit === false ? 'cf-row-miss' : '';
                    return (
                      <tr key={g.gameId} className={rowClass}>
                        <td>{g.date.slice(5)}</td>
                        <td>
                          <div>{g.home} <span style={{color:'#888'}}>vs</span> {g.away}</div>
                          <div style={{fontSize:'0.8em', color:'#888'}}>{leagueName(g.league)}</div>
                        </td>
                        <td className="cf-pred-cell">
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
                        <td className="cf-actual-cell">
                          {PRED_OPTIONS.map(p => {
                            const on = g.actual === p;
                            return (
                              <label key={p} className={on ? 'on' : ''}>
                                <input
                                  type="radio"
                                  name={`actual-${g.gameId}`}
                                  checked={on}
                                  onChange={() => setActual(idx, p)}
                                />{p}
                              </label>
                            );
                          })}
                        </td>
                        <td>
                          {hit === true && <span className="cf-hit-badge hit">✓</span>}
                          {hit === false && <span className="cf-hit-badge miss">✗</span>}
                        </td>
                        <td>
                          <button className="cf-remove-btn" title="Remove"
                                  onClick={() => removeGame(idx)}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {form.games.length > 0 && (
            <div className="cf-summary">
              <div className="cf-summary-item">
                Total: <strong>{stats.total}</strong>
              </div>
              <div className="cf-summary-item">
                Scored: <strong>{stats.hits}</strong> / {stats.scored}
              </div>
              {stats.missing > 0 && (
                <div className="cf-summary-item" style={{color:'#888'}}>
                  Pending: {stats.missing}
                </div>
              )}
              {stats.scored > 0 && (
                <div className="cf-summary-item">
                  Accuracy: <strong>{((stats.hits / stats.scored) * 100).toFixed(1)}%</strong>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
