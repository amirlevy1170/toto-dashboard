import { useMemo, useState } from 'react';
import { useSnapshots, useDrawSnapshot } from '../hooks/useSnapshots';
import StatCard from '../components/StatCard';
import {
  leagueName, predColor, pct, matchKey, buildDrawLookup, isDisagreement,
} from '../utils';
import './Home.css';

export default function Home() {
  const { snapshots, loading, error } = useSnapshots();
  const [selectedLeague, setSelectedLeague] = useState('all');

  const latest = snapshots?.[0];
  const { data: drawData } = useDrawSnapshot(latest?.date);
  const drawLookup = useMemo(() => buildDrawLookup(drawData), [drawData]);
  const drawModels = drawData?.models || [];

  // Group predictions by league
  const predsByLeague = useMemo(() => {
    if (!latest?.predictions?.length) return {};
    const groups = {};
    for (const p of latest.predictions) {
      const key = p.league || 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return groups;
  }, [latest]);

  const leagueKeys = useMemo(() => Object.keys(predsByLeague).sort(), [predsByLeague]);

  const filteredLeagues = selectedLeague === 'all'
    ? leagueKeys
    : leagueKeys.filter(k => k === selectedLeague);

  if (loading) return <div className="loading">Loading latest data...</div>;
  if (error) return <div className="error">Error: {error}</div>;
  if (!snapshots.length) return <div className="empty">No data available yet.</div>;

  const leagues = latest.per_league || [];
  const cups = latest.cup_models || [];
  const nationals = latest.national_models || [];
  const preds = latest.predictions || [];
  const ai = latest.ai_metrics || {};
  const forms = latest.toto_forms || {};

  return (
    <div className="page">
      <h1>Latest Run — {latest.date}</h1>
      <p className="generated">Generated: {latest.generated_at}</p>

      <div className="stats-row">
        <StatCard label="Leagues" value={leagues.length} sub="active leagues" color="#3a86a8" />
        <StatCard label="Predictions" value={preds.length} sub="upcoming matches" color="#7209b7" />
        <StatCard label="AI Accuracy" value={pct(ai.accuracy || 0)} sub="Gemini evaluation" color="#f72585" />
      </div>

      {latest.fallbacks && Object.keys(latest.fallbacks).length > 0 && (
        <div className="fallback-banner">
          <strong>⚠ Degenerate model fallbacks:</strong>
          <ul>
            {Object.entries(latest.fallbacks).map(([scope, info]) => (
              <li key={scope}>
                <strong>{leagueName(scope)}:</strong>{' '}
                {info.original} → {info.replaced_by}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2>Per-League Winners</h2>
      <div className="league-grid">
        {leagues.map(l => (
          <div key={l.league} className="league-card">
            <div className="league-name">{leagueName(l.league)}</div>
            <div className="league-model">{l.model}</div>
            <div className="league-ensemble">{l.ensemble}</div>
            <div className="league-acc">{pct(l.accuracy)}</div>
            {latest.fallbacks?.[l.league] && (
              <div className="fallback-tag">⚠ → {latest.fallbacks[l.league].replaced_by}</div>
            )}
          </div>
        ))}
      </div>

      {drawModels.length > 0 && (
        <>
          <h2>Draw-Model Winners</h2>
          <p className="section-sub">
            Binary Draw-vs-Not-Draw model per league. AUC = how well it ranks draws
            above non-draws (0.5 = random, 1.0 = perfect). Threshold = P(X) cutoff
            for flagging a match as a probable draw.
          </p>
          <div className="model-table-wrap">
            <table className="data-table draw-model-table">
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>Model</th>
                  <th>Ensemble</th>
                  <th>AUC</th>
                  <th>Threshold</th>
                  <th>Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {[...drawModels]
                  .sort((a, b) => (a.scope === 'ALL' ? -1 : b.scope === 'ALL' ? 1 : b.auc - a.auc))
                  .map((m) => (
                    <tr key={m.scope} className={m.scope === 'ALL' ? 'draw-row-overall' : ''}>
                      <td><strong>{m.scope === 'ALL' ? 'ALL (overall)' : leagueName(m.scope)}</strong></td>
                      <td>{m.model}</td>
                      <td className="ensemble-cell">{m.ensemble}</td>
                      <td className="num-cell">{m.auc.toFixed(3)}</td>
                      <td className="num-cell">{m.threshold.toFixed(2)}</td>
                      <td className="num-cell">{pct(m.accuracy)}</td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {cups.length > 0 && (
        <>
          <h2>Cup & National Models</h2>
          <div className="model-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Scope</th><th>Model</th><th>Accuracy</th></tr>
              </thead>
              <tbody>
                {[...cups, ...nationals].map((m, i) => (
                  <tr key={i}>
                    <td>{m.league}</td>
                    <td><strong>{m.model}</strong></td>
                    <td>{pct(m.accuracy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="section-header">
        <h2>Upcoming Predictions</h2>
        <select className="league-select" value={selectedLeague}
                onChange={e => setSelectedLeague(e.target.value)}>
          <option value="all">All Leagues</option>
          {leagueKeys.map(k => (
            <option key={k} value={k}>{leagueName(k)}</option>
          ))}
        </select>
      </div>
      {filteredLeagues.map(league => (
        <div key={league} className="league-pred-section">
          <h3 className="league-pred-header">{leagueName(league)}</h3>
          <div className="model-table-wrap">
            <table className="data-table predictions-table">
              <thead>
                <tr>
                  <th>Date</th><th>Match</th>
                  <th>League</th><th>H / D / A</th>
                  <th>AI</th><th>H / D / A</th>
                  <th title="Binary Draw model's P(X); colored yellow when it flags a probable draw. Star marks disagreement with the 3-class league pick.">Draw</th>
                </tr>
              </thead>
              <tbody>
                {predsByLeague[league].map((p, i) => {
                  const draw = drawLookup[matchKey(p.date, p.league, p.home, p.away)];
                  const disagreement = isDisagreement(p.league_pred, draw);
                  return (
                  <tr key={i} className={disagreement ? 'row-disagreement' : ''}>
                    <td className="date-cell">{p.date}</td>
                    <td><strong>{p.home}</strong> vs {p.away}</td>
                    <td style={{ background: predColor(p.league_pred), fontWeight: 700, textAlign: 'center' }}>
                      {p.league_pred}
                    </td>
                    <td className="prob-cell">
                      {pct(p.league_prob_h)} / {pct(p.league_prob_d)} / {pct(p.league_prob_a)}
                    </td>
                    <td style={{ background: predColor(p.ai_pred), fontWeight: 700, textAlign: 'center' }}>
                      {p.ai_pred}
                    </td>
                    <td className="prob-cell">
                      {pct(p.ai_prob_h)} / {pct(p.ai_prob_d)} / {pct(p.ai_prob_a)}
                    </td>
                    <td
                      className="draw-cell"
                      style={{ background: draw?.predicted_draw ? predColor('X') : '#f8f9fa', textAlign: 'center' }}
                      title={draw ? `model=${draw.model_name} threshold=${draw.threshold}` : 'no draw prediction'}
                    >
                      {draw ? (
                        <>
                          <strong>{pct(draw.prob_draw)}</strong>
                          {draw.predicted_draw ? ' 🎯' : ''}
                          {disagreement ? ' ★' : ''}
                        </>
                      ) : '—'}
                    </td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {Object.keys(forms).length > 0 && (
        <>
          <h2>🎯 Toto Forms</h2>
          {Object.entries(forms).map(([formKey, formData]) => (
            <div key={formKey} className="form-section">
              <h3 className="form-header">
                {formKey === 'toto16' ? '🏆 Toto 16' : '🌍 Toto World'}
                {formData.form_number && <span className="form-number"> (Form #{formData.form_number})</span>}
              </h3>
              {formData.games?.length > 0 ? (
                <div className="model-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr><th>#</th><th>Home</th><th>Away</th><th>League</th><th>Kickoff</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {formData.games.map((g, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td><strong>{g.home}</strong></td>
                          <td><strong>{g.away}</strong></td>
                          <td>{g.league}</td>
                          <td className="date-cell">{g.kickoff}</td>
                          <td>{g.status === 'not_started' ? '⏳' : g.status === 'finished' ? '✅' : '🔴'}{' '}
                            {g.score_home != null && g.score_away != null && g.status !== 'not_started'
                              ? `${g.score_home}-${g.score_away}` : g.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty">No games in this form</p>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
