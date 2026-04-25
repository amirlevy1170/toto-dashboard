import { useEffect, useMemo, useState } from 'react';
import {
  fetchIndex, fetchSnapshot, fetchDrawSnapshot, fetchFormsPredictions,
  fetchWalkforwardLatest,
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

// Confidence margin: max of (top1 - top2) probability gap across Daily and Forms.
// Larger Δ ⇒ at least one source picks its outcome with high confidence.
function topMargin(src) {
  if (!src) return null;
  const probs = [src.h ?? 0, src.d ?? 0, src.a ?? 0].sort((a, b) => b - a);
  return probs[0] - probs[1];
}
function diffSpread(...sources) {
  const vals = sources.map(topMargin).filter((v) => v != null);
  if (!vals.length) return null;
  return Math.max(...vals);
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
  const [wf, setWf] = useState(null);
  const [selectedLeague, setSelectedLeague] = useState('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dates = await fetchIndex();
        const latestDate = dates?.[0];
        const [dailySnap, drawSnap, formsSnap, wfSnap] = await Promise.all([
          latestDate ? fetchSnapshot(latestDate) : Promise.resolve(null),
          latestDate ? fetchDrawSnapshot(latestDate) : Promise.resolve(null),
          fetchFormsPredictions(),
          fetchWalkforwardLatest(),
        ]);
        if (cancelled) return;
        setDaily(dailySnap);
        setDraw(drawSnap);
        setForms(formsSnap);
        setWf(wfSnap);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Build a unified per-fixture record: { date, league, home, away, daily, draw, forms, wf }
  const matches = useMemo(() => {
    const map = new Map();

    const upsert = (date, league, home, away) => {
      const key = matchKey(date, league, home, away);
      if (!map.has(key)) {
        map.set(key, { key, date, league, home, away, daily: null, draw: null, forms: null, wf: null });
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
        roc_auc: p.roc_auc,
      };
    }
    for (const p of forms?.predictions || []) {
      const m = upsert(p.date, p.league, p.home_team, p.away_team);
      m.forms = {
        h: p.prob_home, d: p.prob_draw, a: p.prob_away,
        pick: p.prediction ?? pickFromProbs(p.prob_home, p.prob_draw, p.prob_away),
        model: `${p.model}+${p.ensemble}`,
        accuracy: p.walk_forward_accuracy,
      };
    }
    for (const p of wf?.predictions || []) {
      const m = upsert(p.date, p.league, p.home_team, p.away_team);
      m.wf = {
        h: p.prob_home, d: p.prob_draw, a: p.prob_away,
        pick: p.prediction ?? pickFromProbs(p.prob_home, p.prob_draw, p.prob_away),
        model: `${p.model}+${p.ensemble}`,
        accuracy: p.walk_forward_accuracy,
      };
    }

    return [...map.values()].sort((a, b) =>
      (a.date || '').localeCompare(b.date || '') ||
      (a.league || '').localeCompare(b.league || '')
    );
  }, [daily, draw, forms, wf]);

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
    <div className="page predictions-page">
      <h1>🔮 Predictions — Side by Side</h1>
      <p className="generated">
        Daily: {daily?.date || '—'} · Draw: {draw?.generated_at?.slice(0, 10) || '—'} ·
        Forms: {forms?.timestamp?.slice(0, 10) || '—'} ·
        WF: {wf?.timestamp?.slice(0, 10) || '—'}
      </p>

      <div className="legend">
        <span className="legend-item"><b>Daily</b>: per-league 3-class model</span>
        <span className="legend-item"><b>Draw</b>: binary draw-vs-not-draw model</span>
        <span className="legend-item"><b>Forms</b>: walk-forward best model+ensemble per league</span>
        <span className="legend-item"><b>WF</b>: standalone walk-forward daily pipeline</span>
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

      {filtered.map(lg => {
        const rows = byLeague[lg];
        const drawThreshold = rows.find(m => m.draw?.threshold != null)?.draw?.threshold;
        const dailyMeta = (daily?.per_league || []).find(x => x.league === lg);
        const drawMeta = rows.find(m => m.draw?.model)?.draw;
        const formsMeta = rows.find(m => m.forms?.model)?.forms;
        const wfMeta = wf?.league_winners?.[lg];
        return (
        <section key={lg} className="league-block">
          <h2>
            {leagueName(lg)}{' '}
            <span className="muted">({rows.length} matches)</span>
          </h2>
          <div className="model-summary">
            {dailyMeta && (
              <span className="model-chip src-daily-chip">
                <b>Daily:</b> {dailyMeta.model}
                {dailyMeta.ensemble ? <span className="muted"> / {dailyMeta.ensemble}</span> : null}
                {dailyMeta.accuracy != null && (
                  <span className="acc"> · acc {pct(dailyMeta.accuracy)}</span>
                )}
              </span>
            )}
            {drawMeta && (
              <span className="model-chip src-draw-chip">
                <b>Draw:</b> {drawMeta.model}
                {drawThreshold != null && <span className="muted"> · thr {pct(drawThreshold)}</span>}
                {drawMeta.roc_auc != null && (
                  <span className="acc"> · AUC {drawMeta.roc_auc.toFixed(3)}</span>
                )}
              </span>
            )}
            {formsMeta && (
              <span className="model-chip src-forms-chip">
                <b>Forms:</b> {formsMeta.model}
                {formsMeta.accuracy != null && (
                  <span className="acc"> · WF acc {formsMeta.accuracy.toFixed(1)}%</span>
                )}
              </span>
            )}
            {wfMeta && (
              <span className="model-chip src-wf-chip">
                <b>WF:</b> {wfMeta.model}
                {wfMeta.ensemble ? <span className="muted"> / {wfMeta.ensemble}</span> : null}
                {wfMeta.accuracy != null && (
                  <span className="acc"> · acc {wfMeta.accuracy.toFixed(1)}%</span>
                )}
              </span>
            )}
          </div>
          <div className="pred-table-wrap">
            <table className="pred-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Date</th>
                  <th rowSpan={2}>Match</th>
                  <th colSpan={4} className="src-daily">Daily (per-league)</th>
                  <th colSpan={2} className="src-draw">Draw model</th>
                  <th colSpan={4} className="src-forms">Forms (walk-forward)</th>
                  <th colSpan={4} className="src-wf">Walk-Forward (standalone)</th>
                  <th rowSpan={2} title="Confidence margin (top probability − second probability). Larger = more confident pick.">Δ</th>
                  <th rowSpan={2}>Consensus</th>
                </tr>
                <tr>
                  <th className="src-daily">Pick</th><th className="src-daily">H</th><th className="src-daily">D</th><th className="src-daily">A</th>
                  <th className="src-draw">P(D)</th><th className="src-draw">Draw?</th>
                  <th className="src-forms">Pick</th><th className="src-forms">H</th><th className="src-forms">D</th><th className="src-forms">A</th>
                  <th className="src-wf">Pick</th><th className="src-wf">H</th><th className="src-wf">D</th><th className="src-wf">A</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(m => {
                  const diff = diffSpread(m.daily, m.forms, m.wf);
                  const cons = consensusBadge([m.daily?.pick, m.forms?.pick, m.wf?.pick]);
                  const diffCls = diff == null
                    ? ''
                    : diff >= 0.20 ? 'diff-high'
                    : diff >= 0.10 ? 'diff-med'
                    : 'diff-low';
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

                      {/* WF */}
                      <td className="src-wf" style={{ background: predColor(m.wf?.pick) }}>
                        {m.wf ? <strong title={`model: ${m.wf.model || ''}`}>{m.wf.pick} <span className="muted">({predLabel(m.wf.pick)})</span></strong> : '—'}
                      </td>
                      <td className="src-wf prob">{m.wf ? pct(m.wf.h) : '—'}</td>
                      <td className="src-wf prob">{m.wf ? pct(m.wf.d) : '—'}</td>
                      <td className="src-wf prob">{m.wf ? pct(m.wf.a) : '—'}</td>

                      <td className={`diff-cell ${diffCls}`}>
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
        );
      })}
    </div>
  );
}
