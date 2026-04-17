import { useState } from 'react';
import { useSnapshots, useSnapshot } from '../hooks/useSnapshots';
import { leagueName, pct, predColor } from '../utils';
import './Home.css';

export default function History() {
  const { dates, loading, error } = useSnapshots();
  const [selected, setSelected] = useState(null);
  const { data: snap, loading: snapLoading } = useSnapshot(selected);

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
                    onClick={() => setSelected(d)}>
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

              {snap.best_overall?.model && (
                <div className="detail-section">
                  <h3>Best Overall</h3>
                  <p><strong>{snap.best_overall.model}</strong> + {snap.best_overall.ensemble} — {pct(snap.best_overall.accuracy)}</p>
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
                        <td><strong>{l.model}</strong></td>
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
                  <h3>Predictions ({snap.predictions.length} matches)</h3>
                  <div className="model-table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr><th>Date</th><th>Match</th><th>League</th><th>H/D/A</th><th>Overall</th><th>AI</th></tr>
                      </thead>
                      <tbody>
                        {snap.predictions.map((p, i) => (
                          <tr key={i}>
                            <td className="date-cell">{p.date}</td>
                            <td><strong>{p.home}</strong> vs {p.away}</td>
                            <td style={{ background: predColor(p.league_pred), textAlign: 'center', fontWeight: 700 }}>{p.league_pred}</td>
                            <td className="prob-cell">{pct(p.league_prob_h)}/{pct(p.league_prob_d)}/{pct(p.league_prob_a)}</td>
                            <td style={{ background: predColor(p.overall_pred), textAlign: 'center', fontWeight: 700 }}>{p.overall_pred}</td>
                            <td style={{ background: predColor(p.ai_pred), textAlign: 'center', fontWeight: 700 }}>{p.ai_pred}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
