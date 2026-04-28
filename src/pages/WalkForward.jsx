import { useEffect, useMemo, useState } from 'react';
import { fetchWalkforwardLatest, fetchWalkforwardIndex, fetchWalkforwardSnapshot } from '../api';
import { LEAGUES, leagueName, pct, predColor, predLabel } from '../utils';
import './Predictions.css';

// Walk-forward pipeline page. Shows the per-league winner (best
// model+ensemble selected via walk-forward CV), upcoming predictions,
// and the top-N grid candidates per league. Data source:
// `output/walkforward_parallel/<date>.json` (mirrored to `public/data/walkforward_parallel/`).
export default function WalkForward() {
  const [loading, setLoading] = useState(true);
  const [snap, setSnap] = useState(null);
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedLeague, setSelectedLeague] = useState('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [latest, idx] = await Promise.all([
          fetchWalkforwardLatest(),
          fetchWalkforwardIndex(),
        ]);
        if (cancelled) return;
        const sorted = [...idx].sort().reverse();
        setDates(sorted);
        setSnap(latest);
        setSelectedDate(latest?.timestamp?.slice(0, 10) || sorted[0] || '');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Allow switching to any date in the index.
  useEffect(() => {
    if (!selectedDate) return;
    const currentDate = snap?.timestamp?.slice(0, 10);
    if (currentDate === selectedDate) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchWalkforwardSnapshot(selectedDate);
        if (!cancelled) setSnap(s);
      } catch {
        // leave previous snap in place
      }
    })();
    return () => { cancelled = true; };
  }, [selectedDate]);  // eslint-disable-line react-hooks/exhaustive-deps

  const winners = snap?.league_winners || {};
  const grid = snap?.league_grid || {};
  const predictions = snap?.predictions || [];

  const byLeague = useMemo(() => {
    const out = {};
    for (const p of predictions) {
      const lg = p.league || 'Other';
      if (!out[lg]) out[lg] = [];
      out[lg].push(p);
    }
    for (const lg of Object.keys(out)) {
      out[lg].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    }
    return out;
  }, [predictions]);

  const leagueKeys = useMemo(() => {
    const order = LEAGUES.map(l => l.id);
    const all = new Set([...Object.keys(winners), ...Object.keys(byLeague)]);
    return [...all].sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [winners, byLeague]);

  if (loading) return <div className="loading">Loading walk-forward…</div>;

  if (!snap) {
    return (
      <div className="page">
        <h1>📈 Walk-Forward</h1>
        <div className="empty-panel">
          <h3>No walk-forward snapshot available</h3>
          <p>The <code>pipeline_walkforward</code> hasn't produced any output yet.</p>
        </div>
      </div>
    );
  }

  const filtered = selectedLeague === 'all' ? leagueKeys : [selectedLeague];

  return (
    <div className="page predictions-page">
      <h1>📈 Walk-Forward — Daily Pipeline</h1>
      <p className="generated">
        Snapshot: {snap.timestamp?.slice(0, 16).replace('T', ' ') || '—'}
        {' · '}Elapsed: {snap.elapsed_minutes ?? '?'} min
        {snap.config && (
          <>
            {' · '}train {snap.config.train_years}y / test {snap.config.test_years}y
            {' · '}step {snap.config.step_years}y
          </>
        )}
      </p>

      <div className="filter-row">
        <label>Snapshot:&nbsp;</label>
        <select
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          disabled={dates.length <= 1}
          title={dates.length <= 1 ? 'Only one snapshot available so far' : 'Pick a historical run'}
        >
          {dates.length === 0 && <option value="">—</option>}
          {dates.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="muted" style={{ marginLeft: 8, fontSize: '0.85em' }}>
          ({dates.length} {dates.length === 1 ? 'run' : 'runs'} available)
        </span>
        <span style={{ marginLeft: 16 }} />
        <label>League:&nbsp;</label>
        <select value={selectedLeague} onChange={e => setSelectedLeague(e.target.value)}>
          <option value="all">All leagues</option>
          {leagueKeys.map(lg => (
            <option key={lg} value={lg}>
              {leagueName(lg)}{byLeague[lg] ? ` (${byLeague[lg].length})` : ''}
            </option>
          ))}
        </select>
      </div>

      <h2>🏆 League Winners (walk-forward CV)</h2>
      <p className="section-sub">
        For each league, the model + ensemble combination with the highest
        walk-forward accuracy. This is the model used for the upcoming
        predictions below.
      </p>
      <div className="model-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>League</th>
              <th>Model</th>
              <th>Ensemble</th>
              <th className="num-cell">Accuracy</th>
              <th className="num-cell">Test matches</th>
              <th className="num-cell">Buckets</th>
            </tr>
          </thead>
          <tbody>
            {leagueKeys.map(lg => {
              const w = winners[lg];
              if (!w) return null;
              return (
                <tr key={lg}>
                  <td><strong>{leagueName(lg)}</strong></td>
                  <td>{w.model}</td>
                  <td>{w.ensemble}</td>
                  <td className="num-cell">{w.accuracy?.toFixed(1)}%</td>
                  <td className="num-cell">{w.n_test ?? '—'}</td>
                  <td className="num-cell">{w.buckets ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 24 }}>🔮 Upcoming Predictions</h2>
      {filtered.map(lg => {
        const rows = byLeague[lg] || [];
        if (!rows.length) return null;
        const w = winners[lg];
        return (
          <section key={lg} className="league-block">
            <h3>
              {leagueName(lg)}{' '}
              <span className="muted">({rows.length} matches)</span>
            </h3>
            {w && (
              <div className="model-summary">
                <span className="model-chip src-forms-chip">
                  <b>Walk-forward:</b> {w.model} / {w.ensemble}
                  {w.accuracy != null && (
                    <span className="acc"> · acc {w.accuracy.toFixed(1)}%</span>
                  )}
                  {w.n_test != null && (
                    <span className="muted"> · {w.n_test} test matches</span>
                  )}
                </span>
              </div>
            )}
            <div className="pred-table-wrap">
              <table className="pred-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Match</th>
                    <th>Pick</th>
                    <th>H</th>
                    <th>D</th>
                    <th>A</th>
                    <th title="Confidence margin (top probability − second probability)">Δ</th>
                    <th>Model</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(p => {
                    const probs = [p.prob_home ?? 0, p.prob_draw ?? 0, p.prob_away ?? 0]
                      .sort((a, b) => b - a);
                    const margin = probs[0] - probs[1];
                    const diffCls = margin >= 0.20 ? 'diff-high'
                      : margin >= 0.10 ? 'diff-med' : 'diff-low';
                    return (
                      <tr key={p.fixture_id}>
                        <td className="nowrap">{p.date}</td>
                        <td className="match-cell">
                          <span className="home">{p.home_team}</span>
                          <span className="vs">vs</span>
                          <span className="away">{p.away_team}</span>
                        </td>
                        <td style={{ background: predColor(p.prediction) }}>
                          <strong>{p.prediction} <span className="muted">({predLabel(p.prediction)})</span></strong>
                        </td>
                        <td className="prob">{pct(p.prob_home)}</td>
                        <td className="prob">{pct(p.prob_draw)}</td>
                        <td className="prob">{pct(p.prob_away)}</td>
                        <td className={`diff-cell ${diffCls}`}>{pct(margin)}</td>
                        <td className="muted" style={{ fontSize: '0.85em' }}>
                          {p.model}/{p.ensemble}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <details style={{ marginTop: 24 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          🔬 Per-league grid (top 10 candidates each)
        </summary>
        <p className="section-sub" style={{ marginTop: 8 }}>
          The full search space evaluated per league. Winner of each league is
          the row picked above.
        </p>
        {leagueKeys.map(lg => {
          const candidates = (grid[lg] || []).slice()
            .sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0))
            .slice(0, 10);
          if (!candidates.length) return null;
          return (
            <div key={lg} className="model-table-wrap" style={{ marginTop: 12 }}>
              <h4 style={{ margin: '8px 0 4px' }}>{leagueName(lg)}</h4>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Model</th>
                    <th>Ensemble</th>
                    <th className="num-cell">Accuracy</th>
                    <th className="num-cell">Test matches</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c, i) => (
                    <tr key={`${c.model}-${c.ensemble}-${i}`}>
                      <td>{i + 1}</td>
                      <td>{c.model}</td>
                      <td>{c.ensemble}</td>
                      <td className="num-cell">{c.accuracy?.toFixed(1)}%</td>
                      <td className="num-cell">{c.n_test ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </details>
    </div>
  );
}
