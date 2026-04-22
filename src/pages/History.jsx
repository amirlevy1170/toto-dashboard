import { useMemo, useState } from 'react';
import { useSnapshots, useSnapshot, useDrawSnapshot } from '../hooks/useSnapshots';
import {
  leagueName, pct, predColor, matchKey, buildDrawLookup, isDisagreement,
} from '../utils';
import './Home.css';

export default function History() {
  const { dates, loading, error } = useSnapshots();
  const [selected, setSelected] = useState(null);
  const { data: snap, loading: snapLoading } = useSnapshot(selected);
  const { data: drawData } = useDrawSnapshot(selected);
  const drawLookup = useMemo(() => buildDrawLookup(drawData), [drawData]);
  const [selectedLeague, setSelectedLeague] = useState('all');

  // Group predictions by league
  const predsByLeague = useMemo(() => {
    if (!snap?.predictions?.length) return {};
    const groups = {};
    for (const p of snap.predictions) {
      const key = p.league || 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return groups;
  }, [snap]);

  const leagueKeys = useMemo(() => Object.keys(predsByLeague).sort(), [predsByLeague]);

  const filteredLeagues = selectedLeague === 'all'
    ? leagueKeys
    : leagueKeys.filter(k => k === selectedLeague);

  // Reset league filter when switching dates
  const handleDateSelect = (d) => {
    setSelected(d);
    setSelectedLeague('all');
  };

  if (loading) return <div className="loading">Loading history...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div className="page">
      <h1>Run History</h1>
      <p className="generated">{dates.length} runs available</p>

      <div className="history-layout">
        <div className="date-list">
          {dates.map(d => (
            <button key={d} className={`date-btn ${d === selected ? 'active' : ''}`}
                    onClick={() => handleDateSelect(d)}>
              📅 {d}
            </button>
          ))}
        </div>

        <div className="history-detail">
          {!selected && <p className="empty">Select a date to view details</p>}
          {snapLoading && <div className="loading">Loading...</div>}
          {snap && (
            <>
              <h2>Run: {snap.date}</h2>
              <p className="generated">Generated: {snap.generated_at}</p>

              {snap.fallbacks && Object.keys(snap.fallbacks).length > 0 && (
                <div className="fallback-banner">
                  <strong>⚠ Degenerate model fallbacks:</strong>
                  <ul>
                    {Object.entries(snap.fallbacks).map(([scope, info]) => (
                      <li key={scope}>
                        <strong>{leagueName(scope)}:</strong>{' '}
                        {info.original} → {info.replaced_by}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="detail-section">
                <h3>Per-League Winners</h3>
                <table className="data-table">
                  <thead>
                    <tr><th>League</th><th>Model</th><th>Ensemble</th><th>Accuracy</th></tr>
                  </thead>
                  <tbody>
                    {(snap.per_league || []).map((l, i) => (
                      <tr key={i}>
                        <td>{leagueName(l.league)}</td>
                        <td>
                          <strong>{l.model}</strong>
                          {snap.fallbacks?.[l.league] && (
                            <span className="fallback-tag" style={{marginLeft: 6}}>⚠ → {snap.fallbacks[l.league].replaced_by}</span>
                          )}
                        </td>
                        <td>{l.ensemble}</td>
                        <td style={{ fontWeight: 700, color: l.accuracy >= 0.6 ? '#27ae60' : l.accuracy >= 0.5 ? '#f39c12' : '#e74c3c' }}>
                          {pct(l.accuracy)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {(snap.cup_models?.length > 0 || snap.national_models?.length > 0) && (
                <div className="detail-section">
                  <h3>Cup & National</h3>
                  <table className="data-table">
                    <thead><tr><th>Scope</th><th>Model</th><th>Accuracy</th></tr></thead>
                    <tbody>
                      {[...(snap.cup_models || []), ...(snap.national_models || [])].map((m, i) => (
                        <tr key={i}>
                          <td>{m.league}</td>
                          <td><strong>{m.model}</strong></td>
                          <td>{pct(m.accuracy)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {snap.predictions?.length > 0 && (
                <div className="detail-section">
                  <div className="section-header">
                    <h3>Predictions ({snap.predictions.length} matches)</h3>
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
                      <h4 className="league-pred-header">{leagueName(league)}</h4>
                      <div className="model-table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Date</th><th>Match</th>
                              <th>League</th><th>H/D/A</th>
                              <th>AI</th>
                              <th title="Binary draw model's P(X); colored yellow when flagged as probable draw. Star marks disagreement with the 3-class league pick.">Draw</th>
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
                                <td style={{ background: predColor(p.league_pred), textAlign: 'center', fontWeight: 700 }}>{p.league_pred}</td>
                                <td className="prob-cell">{pct(p.league_prob_h)}/{pct(p.league_prob_d)}/{pct(p.league_prob_a)}</td>
                                <td style={{ background: predColor(p.ai_pred), textAlign: 'center', fontWeight: 700 }}>{p.ai_pred}</td>
                                <td
                                  className="draw-cell"
                                  style={{ background: draw?.predicted_draw ? predColor('X') : '#f8f9fa', textAlign: 'center' }}
                                  title={draw ? `model=${draw.model_name} threshold=${draw.threshold}` : 'no draw prediction for this date'}
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
                </div>
              )}

              {snap.test_review && Object.keys(snap.test_review).length > 0 && (
                <div className="detail-section">
                  <h3>🔍 Test Review — Last 10 Games</h3>
                  {Object.entries(snap.test_review).sort().map(([scope, info]) => {
                    const games = info.games || [];
                    const correct = games.filter(g => g.correct).length;
                    return (
                      <div key={scope} style={{ marginBottom: 20 }}>
                        <h4>{leagueName(scope)} — {info.model} + {info.ensemble} ({correct}/{games.length})</h4>
                        <table className="data-table">
                          <thead>
                            <tr><th></th><th>Date</th><th>Home</th><th>Away</th><th>Pred</th><th>Actual</th><th>H%</th><th>D%</th><th>A%</th></tr>
                          </thead>
                          <tbody>
                            {games.map((g, j) => (
                              <tr key={j} style={{ background: g.correct ? '#d4edda' : '#f8d7da' }}>
                                <td style={{ textAlign: 'center', fontWeight: 700 }}>{g.correct ? '✓' : '✗'}</td>
                                <td className="date-cell">{g.date}</td>
                                <td><strong>{g.home}</strong></td>
                                <td><strong>{g.away}</strong></td>
                                <td style={{ background: predColor(g.pred), textAlign: 'center', fontWeight: 700 }}>{g.pred}</td>
                                <td style={{ background: predColor(g.actual), textAlign: 'center', fontWeight: 700 }}>{g.actual}</td>
                                <td className="prob-cell">{pct(g.prob_h)}</td>
                                <td className="prob-cell">{pct(g.prob_d)}</td>
                                <td className="prob-cell">{pct(g.prob_a)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
