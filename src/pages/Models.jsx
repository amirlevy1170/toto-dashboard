import { useMemo, useState } from 'react';
import { useAllSelections } from '../hooks/useAllSelections';
import { LEAGUES } from '../utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import './Home.css';

const COLORS = ['#4361ee', '#3a86a8', '#7209b7', '#f72585', '#4cc9f0', '#80ed99',
                '#f4a261', '#e76f51', '#2a9d8f', '#264653', '#e9c46a', '#606c38',
                '#bc6c25', '#dda15e', '#283618', '#6d6875'];

const ALL_SOURCES = ['daily', 'forms', 'walkforward'];
const SOURCE_LABEL = {
  daily: 'Daily',
  forms: 'Forms',
  walkforward: 'Walk-forward',
};

function tally(selections, key) {
  const counts = {};
  for (const s of selections) {
    const v = s[key];
    if (!v) continue;
    counts[v] = (counts[v] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export default function Models() {
  const { loading, error, runCounts, selections } = useAllSelections();
  // Source filter — default all on. Persisted only in component state.
  const [enabled, setEnabled] = useState(new Set(ALL_SOURCES));

  const toggle = (src) => {
    const next = new Set(enabled);
    if (next.has(src)) next.delete(src); else next.add(src);
    if (next.size === 0) return; // never allow empty filter
    setEnabled(next);
  };

  const filtered = useMemo(() => {
    return ALL_SOURCES
      .filter(s => enabled.has(s))
      .flatMap(s => selections[s] || []);
  }, [enabled, selections]);

  const modelStats = useMemo(() => tally(filtered, 'model'), [filtered]);
  const ensembleStats = useMemo(() => tally(filtered, 'ensemble'), [filtered]);
  const totalSelections = filtered.length;

  const leagueBreakdown = useMemo(() => {
    const result = {};
    for (const league of LEAGUES) {
      const counts = {};
      for (const sel of filtered) {
        if (sel.type !== 'league') continue;
        if (sel.league !== league.id) continue;
        counts[sel.model] = (counts[sel.model] || 0) + 1;
      }
      if (Object.keys(counts).length > 0) {
        result[league.id] = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => ({ name, count }));
      }
    }
    return result;
  }, [filtered]);

  // Used to scale per-league bars consistently. Take the largest count seen
  // in any single league × model so all rows render on the same scale.
  const leagueBarMax = useMemo(() => {
    let m = 1;
    for (const rows of Object.values(leagueBreakdown)) {
      for (const r of rows) if (r.count > m) m = r.count;
    }
    return m;
  }, [leagueBreakdown]);

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  const totalRuns = ALL_SOURCES
    .filter(s => enabled.has(s))
    .reduce((sum, s) => sum + runCounts[s], 0);

  return (
    <div className="page">
      <h1>Model Comparison</h1>
      <p className="generated">
        {totalSelections} selections across {totalRuns} runs
        {' '}({ALL_SOURCES.map(s => `${runCounts[s]} ${SOURCE_LABEL[s]}`).join(', ')})
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {ALL_SOURCES.map(src => {
          const on = enabled.has(src);
          return (
            <button
              key={src}
              onClick={() => toggle(src)}
              style={{
                padding: '6px 14px',
                borderRadius: 16,
                border: `1.5px solid ${on ? '#4361ee' : '#ccc'}`,
                background: on ? '#4361ee' : '#fff',
                color: on ? '#fff' : '#444',
                fontSize: 13,
                fontWeight: on ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {SOURCE_LABEL[src]} ({runCounts[src]})
            </button>
          );
        })}
      </div>

      <div className="charts-grid">
        <div className="chart-section">
          <h2>Model Win Frequency</h2>
          <ResponsiveContainer width="100%" height={Math.max(300, modelStats.length * 32)}>
            <BarChart data={modelStats} layout="vertical" margin={{ left: 120 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" fontSize={12} width={110} />
              <Tooltip formatter={v => [v, 'Wins']} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {modelStats.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-section">
          <h2>Ensemble Win Frequency</h2>
          <ResponsiveContainer width="100%" height={Math.max(200, ensembleStats.length * 36)}>
            <BarChart data={ensembleStats} layout="vertical" margin={{ left: 140 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" fontSize={12} width={130} />
              <Tooltip formatter={v => [v, 'Wins']} />
              <Bar dataKey="count" fill="#4361ee" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <h2>Per-League Model Breakdown</h2>
      <div className="breakdown-grid">
        {LEAGUES.map(league => {
          const data = leagueBreakdown[league.id];
          if (!data) return null;
          return (
            <div key={league.id} className="breakdown-card">
              <h3>{league.flag} {league.name}</h3>
              {data.map((m, i) => (
                <div key={m.name} className="win-row">
                  <span className="win-model">{m.name}</span>
                  <div className="win-bar-wrap">
                    <div className="win-bar"
                         style={{ width: `${(m.count / leagueBarMax) * 100}%`,
                                  background: COLORS[i % COLORS.length] }} />
                  </div>
                  <span className="win-count">{m.count}×</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
