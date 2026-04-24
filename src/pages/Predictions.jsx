import { useEffect, useMemo, useState } from 'react';
import {
  fetchIndex, fetchSnapshot, fetchDrawSnapshot, fetchFormsPredictions,
} from '../api';
import { LEAGUES, leagueName, pct, predColor, predLabel, matchKey } from '../utils';
import './Predictions.css';

// ── helpers ─────────────────────────────────────────────────────────────

function pickFromProbs(h, d, a) {
  const max = Math.max(h, d, a);
  if (max === h) return '1';
  if (max === d) return 'X';
  return '2';
}

// Max absolute spread between Daily and Forms across H/D/A probabilities.
function diffSpread(daily, forms) {
  if (!daily || !forms) return null;
  const dh = Math.abs((daily.h ?? 0) - (forms.h ?? 0));
  const dd = Math.abs((daily.d ?? 0) - (forms.d ?? 0));
  const da = Math.abs((daily.a ?? 0) - (forms.a ?? 0));
  return Math.max(dh, dd, da);
}

function consensusBadge(picks) {
  const uniq = [...new Set(picks.filter(Boolean))];
  if (uniq.length === 0) return { label: '—', cls: 'cons-na' };
  if (uniq.length === 1) return { label: '✓ All agree', cls: 'cons-agree' };
  if (uniq.length === picks.filter(Boolean).length) return { label: '⚠ All differ', cls: 'cons-split' };
  return { label: '~ Mixed', cls: 'cons-mixed' };
}

// ── component ───────────────────────────────────────────────────────────

export default function Predictions() {
  const [loading, setLoading] = useState(true);
  const [daily, setDaily] = useState(null);
  const [draw, setDraw] = useState(null);
  const [forms, setForms] = useState(null);
  const [selectedLeague, setSelectedLeague] = useState('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dates = await fetchIndex();
        const latestDate = dates?.[0];
        const [dailySnap, drawSnap, formsSnap] = await Promise.all([
          latestDate ? fetchSnapshot(latestDate) : Promise.resolve(null),
          latestDate ? fetchDrawSnapshot(latestDate) : Promise.resolve(null),
          fetchFormsPredictions(),
        ]);
        if (cancelled) return;
        setDaily(dailySnap);
        setDraw(drawSnap);
        setForms(formsSnap);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Build a unified per-fixture record: { date, league, home, away, daily, draw, forms }
  const matches = useMemo(() => {
    const map = new Map();

    const upsert = (date, league, home, away) => {
      const key = matchKey(date, league, home, away);
      if (!map.has(key)) {
        map.set(key, { key, date, league, home, away, daily: null, draw: null, forms: null });
      }
      return map.get(key);
    };

    for (const p of daily?.predictions || []) {
      const m = upsert(p.date, p.league, p.home, p.away);
      m.daily = {
        h: p.league_prob_h, d: p.league_prob_d, a: p.league_prob_a,
        pick: p.league_pred ?? pickFromProbs(p.league_prob_h, p.league_prob_d, p.league_prob_a),
        model: p.league_model,
      };
    }
    for (const p of (draw?.predictions || []).filter(x => x.model_type === 'per_league')) {
      const m = upsert(p.date, p.league, p.home_team_name, p.away_team_name);
      m.draw = {
        prob_d: p.prob_draw,
        prob_nd: p.prob_not_draw,
        threshold: p.threshold,
        predicts_draw: p.predicted_draw === 1,
        model: p.model_name,
      };
    }
    for (const p of forms?.predictions || []) {
      const m = upsert(p.date, p.league, p.home_team, p.away_team);
      m.forms = {
        h: p.prob_home, d: p.prob_draw, a: p.prob_away,
        pick: p.prediction ?? pickFromProbs(p.prob_home, p.prob_draw, p.prob_away),
        model: `${p.model}+${p.ensemble}`,
      };
    }

    return [...map.values()].sort((a, b) =>
      (a.date || '').localeCompare(b.date || '') ||
      (a.league || '').localeCompare(b.league || '')
    );
  }, [daily, draw, forms]);

  const byLeague = useMemo(() => {
    const out = {};
    for (const m of matches) {
      const lg = m.league || 'Other';
      if (!out[lg]) out[lg] = [];
      out[lg].push(m);
    }
    return out;
  }, [matches]);

  const leagueKeys = useMemo(() => {
    const order = LEAGUES.map(l => l.id);
    return Object.keys(byLeague).sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [byLeague]);

  if (loading) return <div className="loading">Loading predictions…</div>;

  if (!matches.length) {
    return (
      <div className="page">
        <h1>🔮 Predictions</h1>
        <div className="empty-panel">
          <h3>No predictions available</h3>
          <p>The pipelines haven't produced any predictions yet.</p>
        </div>
      </div>
    );
  }

  const filtered = selectedLeague === 'all' ? leagueKeys : [selectedLeague];

  return (
    <div className="page">
      <h1>🔮 Predictions — Side by Side</h1>
      <p className="generated">
        Daily: {daily?.date || '—'} · Draw: {draw?.generated_at?.slice(0, 10) || '—'} ·
        Forms: {forms?.timestamp?.slice(0, 10) || '—'}
      </p>

      <div className="legend">
        <span className="legend-item"><b>Daily</b>: per-league 3-class model</span>
        <span className="legend-item"><b>Draw</b>: binary draw-vs-not-draw model</span>
        <span className="legend-item"><b>Forms</b>: walk-forward best model+ensemble per league</span>
      </div>

      <div className="filter-row">
        <label>League:&nbsp;</label>
        <select value={selectedLeague} onChange={e => setSelectedLeague(e.target.value)}>
          <option value="all">All leagues</option>
          {leagueKeys.map(lg => (
            <option key={lg} value={lg}>{leagueName(lg)} ({byLeague[lg].length})</option>
          ))}
        </select>
      </div>

      {filtered.map(lg => (
        <section key={lg} className="league-block">
          <h2>{leagueName(lg)} <span className="muted">({byLeague[lg].length} matches)</span></h2>
          <div className="pred-table-wrap">
            <table className="pred-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Date</th>
                  <th rowSpan={2}>Match</th>
                  <th colSpan={4} className="src-daily">Daily (per-league)</th>
                  <th colSpan={2} className="src-draw">Draw model</th>
                  <th colSpan={4} className="src-forms">Forms (walk-forward)</th>
                  <th rowSpan={2} title="max |ΔP| between Daily and Forms across H/D/A">Δ</th>
                  <th rowSpan={2}>Consensus</th>
                </tr>
                <tr>
                  <th className="src-daily">Pick</th><th className="src-daily">H</th><th className="src-daily">D</th><th className="src-daily">A</th>
                  <th className="src-draw">P(D)</th><th className="src-draw">Draw?</th>
                  <th className="src-forms">Pick</th><th className="src-forms">H</th><th className="src-forms">D</th><th className="src-forms">A</th>
                </tr>
              </thead>
              <tbody>
                {byLeague[lg].map(m => {
                  const diff = diffSpread(m.daily, m.forms);
                  const cons = consensusBadge([m.daily?.pick, m.forms?.pick]);
                  return (
                    <tr key={m.key}>
                      <td className="nowrap">{m.date}</td>
                      <td className="match-cell">
                        <span className="home">{m.home}</span>
                        <span className="vs">vs</span>
                        <span className="away">{m.away}</span>
                      </td>

                      {/* Daily */}
                      <td className="src-daily" style={{ background: predColor(m.daily?.pick) }}>
                        {m.daily ? <strong title={`model: ${m.daily.model || ''}`}>{m.daily.pick} <span className="muted">({predLabel(m.daily.pick)})</span></strong> : '—'}
                      </td>
                      <td className="src-daily prob">{m.daily ? pct(m.daily.h) : '—'}</td>
                      <td className="src-daily prob">{m.daily ? pct(m.daily.d) : '—'}</td>
                      <td className="src-daily prob">{m.daily ? pct(m.daily.a) : '—'}</td>

                      {/* Draw */}
                      <td className="src-draw prob">{m.draw ? pct(m.draw.prob_d) : '—'}</td>
                      <td className="src-draw">
                        {m.draw
                          ? (m.draw.predicts_draw
                              ? <span className="draw-yes" title={`threshold ${(m.draw.threshold * 100).toFixed(0)}%`}>YES (X)</span>
                              : <span className="draw-no">no</span>)
                          : '—'}
                      </td>

                      {/* Forms */}
                      <td className="src-forms" style={{ background: predColor(m.forms?.pick) }}>
                        {m.forms ? <strong title={`model: ${m.forms.model || ''}`}>{m.forms.pick} <span className="muted">({predLabel(m.forms.pick)})</span></strong> : '—'}
                      </td>
                      <td className="src-forms prob">{m.forms ? pct(m.forms.h) : '—'}</td>
                      <td className="src-forms prob">{m.forms ? pct(m.forms.d) : '—'}</td>
                      <td className="src-forms prob">{m.forms ? pct(m.forms.a) : '—'}</td>

                      <td className={`diff-cell ${diff != null && diff > 0.20 ? 'diff-high' : diff != null && diff > 0.10 ? 'diff-med' : ''}`}>
                        {diff == null ? '—' : pct(diff)}
                      </td>
                      <td><span className={`cons-badge ${cons.cls}`}>{cons.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
