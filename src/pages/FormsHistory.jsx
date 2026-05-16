import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, Cell,
} from 'recharts';
import { fetchAllSnapshots } from '../api';
import {
  cloudPull, cloudPush, getToken, setToken, getGistId, setGistId, isConfigured,
} from '../cloudSync';
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

// Auto-derive 1/X/2 from a finished game's score.
function actualFromScore(g) {
  if (!g) return null;
  const sh = g.score_home, sa = g.score_away;
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
      if (!existing ||
          (snapDate && existing.snapshotDate && snapDate > existing.snapshotDate) ||
          (snapDate && !existing.snapshotDate)) {
        map.set(key, { key, kind, formNumber: fn, snapshotDate: snapDate, games });
      }
    }
  }
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

// Deep-ish equality on JSON-serializable values. Good enough for entry diffs.
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Component ────────────────────────────────────────────────────────
export default function FormsHistory() {
  const [entries, setEntries] = useState(loadEntries);
  const [editingId, setEditingId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showStats, setShowStats] = useState(true);

  // Cloud sync state.
  const [syncStatus, setSyncStatus] = useState('idle');  // idle|busy|ok|err
  const [syncMsg, setSyncMsg] = useState('');
  const [lastSyncedSnapshot, setLastSyncedSnapshot] = useState(null);

  // Snapshots needed for picker + score refresh.
  const [snapshots, setSnapshots] = useState(null);
  const [loadError, setLoadError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchAllSnapshots()
      .then(s => { if (!cancelled) setSnapshots(s); })
      .catch(e => { if (!cancelled) setLoadError(e.message || 'Failed to load forms'); });
    return () => { cancelled = true; };
  }, []);

  // Auto-persist locally on every change.
  useEffect(() => { saveEntries(entries); }, [entries]);

  // On mount: try cloud pull if configured. Merge strategy is "cloud wins
  // unless local has newer updatedAt".
  useEffect(() => {
    if (!isConfigured() || !getGistId()) return;
    let cancelled = false;
    // Run the pull asynchronously so we don't trigger a cascading render
    // inside the mount effect itself.
    Promise.resolve().then(() => {
      if (cancelled) return;
      setSyncStatus('busy'); setSyncMsg('Pulling cloud copy…');
    });
    cloudPull()
      .then(cloud => {
        if (cancelled || !cloud) return;
        const byId = new Map(entries.map(e => [e.id, e]));
        for (const c of cloud) {
          const local = byId.get(c.id);
          if (!local) byId.set(c.id, c);
          else {
            const localTs = local.updatedAt || '';
            const cloudTs = c.updatedAt || '';
            if (cloudTs > localTs) byId.set(c.id, c);
          }
        }
        const merged = [...byId.values()].sort((a, b) =>
          (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        setEntries(merged);
        setLastSyncedSnapshot(JSON.stringify(merged));
        setSyncStatus('ok'); setSyncMsg('Pulled from cloud');
      })
      .catch(err => {
        if (cancelled) return;
        setSyncStatus('err'); setSyncMsg(err.message || 'Pull failed');
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const catalogue = useMemo(() => buildFormCatalogue(snapshots), [snapshots]);
  const editing = useMemo(
    () => entries.find(e => e.id === editingId) || null,
    [entries, editingId]
  );

  const hasUnsyncedChanges = useMemo(() => {
    if (!lastSyncedSnapshot) return entries.length > 0 && isConfigured();
    return JSON.stringify(entries) !== lastSyncedSnapshot;
  }, [entries, lastSyncedSnapshot]);

  const pushToCloud = useCallback(async () => {
    if (!isConfigured()) {
      setSyncStatus('err');
      setSyncMsg('Add a GitHub token in Settings to enable cloud sync.');
      return false;
    }
    setSyncStatus('busy'); setSyncMsg('Saving to cloud…');
    try {
      await cloudPush(entries);
      setLastSyncedSnapshot(JSON.stringify(entries));
      setSyncStatus('ok');
      setSyncMsg(`Saved ${new Date().toLocaleTimeString()}`);
      return true;
    } catch (err) {
      setSyncStatus('err');
      setSyncMsg(err.message || 'Push failed');
      return false;
    }
  }, [entries]);

  function addEntryFromForm(formMeta) {
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

  function openEntry(id) {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;
    const fresh = catalogue.find(f =>
      f.kind === entry.kind && f.formNumber === entry.formNumber);
    if (fresh) {
      const byPair = new Map(fresh.games.map(fg => [`${fg.home}|${fg.away}`, fg]));
      const refreshed = entry.games.map(g => {
        const fg = byPair.get(`${g.home}|${g.away}`);
        if (!fg) return g;
        return {
          ...g,
          league: fg.league, kickoff: fg.kickoff, status: fg.status,
          score_home: fg.score_home, score_away: fg.score_away,
        };
      });
      if (!deepEqual(refreshed, entry.games)) {
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
        onSave={pushToCloud}
        syncStatus={syncStatus}
        syncMsg={syncMsg}
        hasUnsynced={hasUnsyncedChanges}
        cloudConfigured={isConfigured()}
      />
    );
  }

  return (
    <div className="fh-container">
      <h1>Forms History</h1>
      <p className="fh-sub">
        Pick a Toto form by its ID, record what you guessed, and the actual results.
        Saves to your browser plus an optional private GitHub Gist for cross-device sync.
      </p>

      <div className="fh-toolbar">
        <button className="fh-btn" onClick={() => setPickerOpen(true)}
                disabled={!snapshots}>
          + Add form
        </button>
        <button className="fh-btn fh-btn-save" onClick={pushToCloud}
                disabled={!hasUnsyncedChanges || syncStatus === 'busy'}
                title={isConfigured()
                  ? 'Save to GitHub Gist (cross-device)'
                  : 'Configure GitHub token first'}>
          💾 Save
        </button>
        <button className="fh-btn fh-btn-secondary fh-btn-icon"
                onClick={() => setSettingsOpen(true)}
                title="Cloud sync settings">⚙</button>
        <SyncStatus status={syncStatus} msg={syncMsg}
                    hasUnsynced={hasUnsyncedChanges}
                    configured={isConfigured()} />
        {!snapshots && !loadError && <span className="fh-msg">Loading forms…</span>}
        {loadError && <span className="fh-err">{loadError}</span>}
      </div>

      {entries.length > 0 && (
        <StatsPanel entries={entries} expanded={showStats}
                    onToggle={() => setShowStats(s => !s)} />
      )}

      {entries.length === 0 ? (
        <div className="fh-empty">
          No entries yet. Click <strong>+ Add form</strong> to pick a form by ID.
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
      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)}
                       onSync={pushToCloud} />
      )}
    </div>
  );
}

// ── Sync status text ─────────────────────────────────────────────────
function SyncStatus({ status, msg, hasUnsynced, configured }) {
  if (!configured) {
    return (
      <span className="fh-sync-status">
        <span className="fh-sync-dot idle" /> Local only
      </span>
    );
  }
  let label = msg || 'Idle';
  if (status === 'idle' && hasUnsynced) label = 'Unsaved changes';
  else if (status === 'idle') label = 'Synced';
  return (
    <span className="fh-sync-status">
      <span className={`fh-sync-dot ${status}`} /> {label}
    </span>
  );
}

// ── Stats panel ──────────────────────────────────────────────────────
function StatsPanel({ entries, expanded, onToggle }) {
  const stats = useMemo(() => computeStats(entries), [entries]);

  return (
    <div className="fh-stats">
      <div className="fh-stats-header">
        <h2>📊 Your performance</h2>
        <button className="fh-stats-toggle" onClick={onToggle}>
          {expanded ? 'Hide' : 'Show'}
        </button>
      </div>
      {expanded && (
        <>
          <div className="fh-kpi-grid">
            <KPI label="Forms played" value={stats.formsPlayed}
                 sub={`${stats.formsScored} with results`} color="blue" />
            <KPI label="Total picks" value={stats.totalPicks}
                 sub={`${stats.scored} scored`} color="gold" />
            <KPI label="Correct" value={stats.hits}
                 sub={`out of ${stats.scored}`} color="green" />
            <KPI label="Accuracy"
                 value={stats.scored ? `${(100 * stats.hits / stats.scored).toFixed(1)}%` : '—'}
                 sub={stats.bestStreak ? `best streak ${stats.bestStreak}` : ''}
                 color="red" />
          </div>
          <div className="fh-charts-grid">
            <ChartCard title="Accuracy by form type">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.byKind}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="label" />
                  <YAxis domain={[0, 100]} unit="%" />
                  <Tooltip formatter={(v, n) => n === 'acc' ? `${v.toFixed(1)}%` : v}
                           labelFormatter={l => l} />
                  <Bar dataKey="acc" name="Accuracy" radius={[6, 6, 0, 0]}>
                    {stats.byKind.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Accuracy by league (top 10 by volume)">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.byLeague} layout="vertical"
                          margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis type="number" domain={[0, 100]} unit="%" />
                  <YAxis type="category" dataKey="league" width={80}
                         tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
                  <Bar dataKey="acc" name="Accuracy" radius={[0, 6, 6, 0]} fill="#0d6efd" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Accuracy over forms (chronological)">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={stats.byForm}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} unit="%" />
                  <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
                  <Legend />
                  <Line type="monotone" dataKey="acc" name="Form accuracy"
                        stroke="#137333" strokeWidth={2}
                        dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="rolling" name="Rolling avg"
                        stroke="#b58105" strokeWidth={2} strokeDasharray="4 4"
                        dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Hits vs misses by form type">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.byKindHits}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="hits" name="Hits" stackId="a"
                       fill="#137333" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="misses" name="Misses" stackId="a"
                       fill="#d33b3b" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}

function KPI({ label, value, sub, color }) {
  return (
    <div className={`fh-kpi ${color || ''}`}>
      <div className="fh-kpi-label">{label}</div>
      <div className="fh-kpi-value">{value}</div>
      {sub && <div className="fh-kpi-sub">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="fh-chart">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function computeStats(entries) {
  const out = {
    formsPlayed: entries.length,
    formsScored: 0,
    totalPicks: 0,
    scored: 0,
    hits: 0,
    bestStreak: 0,
    byKind: [],
    byKindHits: [],
    byLeague: [],
    byForm: [],
  };
  const kindAgg = { toto16: { hits: 0, scored: 0 }, world: { hits: 0, scored: 0 } };
  const leagueAgg = new Map();
  const formsRows = [];
  let curStreak = 0, bestStreak = 0;

  // Sort chronologically by snapshotDate for the timeline.
  const sorted = [...entries].sort((a, b) =>
    (a.snapshotDate || '').localeCompare(b.snapshotDate || '') ||
    (a.createdAt || '').localeCompare(b.createdAt || ''));

  for (const e of sorted) {
    let eHits = 0, eScored = 0;
    for (const g of e.games || []) {
      if (!g.predictions || g.predictions.length === 0) continue;
      out.totalPicks += 1;
      const h = isHit(g);
      if (h === null) continue;
      out.scored += 1;
      eScored += 1;
      const k = kindAgg[e.kind];
      if (k) k.scored += 1;
      const lg = g.league || 'Unknown';
      if (!leagueAgg.has(lg)) leagueAgg.set(lg, { hits: 0, scored: 0 });
      const la = leagueAgg.get(lg);
      la.scored += 1;
      if (h) {
        out.hits += 1; eHits += 1;
        if (k) k.hits += 1;
        la.hits += 1;
        curStreak += 1;
        bestStreak = Math.max(bestStreak, curStreak);
      } else {
        curStreak = 0;
      }
    }
    if (eScored > 0) {
      out.formsScored += 1;
      formsRows.push({
        label: `${kindLabel(e.kind)[0]}${String(e.formNumber).slice(-3)}`,
        acc: 100 * eHits / eScored,
        date: e.snapshotDate || '',
      });
    }
  }
  out.bestStreak = bestStreak;

  // byKind / byKindHits
  for (const [kind, agg] of Object.entries(kindAgg)) {
    if (agg.scored === 0) continue;
    out.byKind.push({
      label: kindLabel(kind),
      acc: 100 * agg.hits / agg.scored,
      color: kind === 'toto16' ? '#0d6efd' : '#198754',
    });
    out.byKindHits.push({
      label: kindLabel(kind),
      hits: agg.hits,
      misses: agg.scored - agg.hits,
    });
  }

  // byLeague (top 10 by volume)
  out.byLeague = [...leagueAgg.entries()]
    .map(([league, agg]) => ({
      league: league.length > 16 ? league.slice(0, 15) + '…' : league,
      fullLeague: league,
      acc: 100 * agg.hits / agg.scored,
      scored: agg.scored,
    }))
    .sort((a, b) => b.scored - a.scored)
    .slice(0, 10);

  // byForm with 3-form rolling average.
  out.byForm = formsRows.map((r, i) => {
    const window = formsRows.slice(Math.max(0, i - 2), i + 1);
    const rolling = window.reduce((s, x) => s + x.acc, 0) / window.length;
    return { ...r, rolling };
  });

  return out;
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
    <div className="fh-modal-overlay" onClick={onClose}>
      <div className="fh-modal" onClick={e => e.stopPropagation()}>
        <div className="fh-modal-header">
          <h2>Pick a form</h2>
          <button className="fh-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="fh-modal-body">
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
          {filtered.length === 0 && <div className="fh-msg">No matching forms.</div>}
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

// ── Settings ─────────────────────────────────────────────────────────
function SettingsModal({ onClose, onSync }) {
  const [token, setTokenLocal] = useState(getToken());
  const [gistId, setGistIdLocal] = useState(getGistId());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  function save() {
    setToken(token.trim());
    setGistId(gistId.trim());
    setMsg('Settings saved.');
  }
  async function saveAndSync() {
    save();
    setBusy(true);
    setMsg('Syncing…');
    const ok = await onSync();
    setBusy(false);
    setMsg(ok ? 'Synced ✓' : 'Sync failed — check token & try again.');
    // Pick up newly-created gist id after first push.
    setGistIdLocal(getGistId());
  }
  function clearAll() {
    if (!confirm('Clear cloud sync settings? Local data will remain.')) return;
    setToken(''); setGistId('');
    setTokenLocal(''); setGistIdLocal('');
    setMsg('Cleared.');
  }

  return (
    <div className="fh-modal-overlay" onClick={onClose}>
      <div className="fh-modal" onClick={e => e.stopPropagation()}>
        <div className="fh-modal-header">
          <h2>Cloud sync settings</h2>
          <button className="fh-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="fh-modal-body">
          <div className="fh-settings-row">
            <label>GitHub Personal Access Token</label>
            <input
              type="password"
              placeholder="ghp_…"
              value={token}
              onChange={e => setTokenLocal(e.target.value)}
              autoComplete="off"
            />
            <div className="fh-settings-help">
              Needs <code>gist</code> scope only.{' '}
              <a href="https://github.com/settings/tokens/new?scopes=gist&description=Toto%20Forms%20History"
                 target="_blank" rel="noreferrer">Create one here</a>.
              The token is stored in your browser's localStorage.
            </div>
          </div>
          <div className="fh-settings-row">
            <label>Gist ID (optional)</label>
            <input
              type="text"
              placeholder="auto-created on first save"
              value={gistId}
              onChange={e => setGistIdLocal(e.target.value)}
              autoComplete="off"
            />
            <div className="fh-settings-help">
              Leave empty to auto-create a new private gist.
              To use the <em>same data</em> on another device, copy this ID after
              the first save and paste it here on the other device.
            </div>
          </div>
          {msg && <div className="fh-msg">{msg}</div>}
        </div>
        <div className="fh-modal-footer">
          <button className="fh-btn fh-btn-danger" onClick={clearAll}>Clear</button>
          <button className="fh-btn fh-btn-secondary" onClick={save}>Save</button>
          <button className="fh-btn fh-btn-save" onClick={saveAndSync}
                  disabled={busy || !token.trim()}>
            {busy ? 'Syncing…' : '💾 Save & sync now'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────
function FormHistoryEditor({
  entry, onChange, onBack, onDelete, onSave,
  syncStatus, syncMsg, hasUnsynced, cloudConfigured,
}) {
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
        <button className="fh-btn fh-btn-save" onClick={onSave}
                disabled={!hasUnsynced || syncStatus === 'busy'}
                title={cloudConfigured
                  ? 'Save to GitHub Gist (cross-device)'
                  : 'Configure GitHub token first (gear icon on list view)'}>
          💾 Save
        </button>
        <SyncStatus status={syncStatus} msg={syncMsg}
                    hasUnsynced={hasUnsynced} configured={cloudConfigured} />
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
        <span className={`fh-editor-status ${hasUnsynced ? 'dirty' : 'clean'}`}>
          {hasUnsynced ? '● Unsaved changes' : '✓ All changes saved'}
        </span>
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
                          <input type="checkbox" checked={on}
                                 onChange={() => togglePrediction(idx, p)} />{p}
                        </label>
                      );
                    })}
                  </td>
                  <td className="fh-actual-cell">
                    {PRED_OPTIONS.map(p => {
                      const on = effective === p;
                      return (
                        <label key={p} className={on ? 'on' : ''}>
                          <input type="radio"
                                 name={`actual-${entry.id}-${idx}`}
                                 checked={on}
                                 onChange={() => setActualOverride(idx, p)} />{p}
                        </label>
                      );
                    })}
                    {auto && !g.actualOverride && (
                      <div className="fh-actual-auto">auto from score</div>
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
        <div className="fh-summary-item">Total: <strong>{stats.total}</strong></div>
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
