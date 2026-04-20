import { useEffect, useState } from 'react';
import { fetchFormsPredictions } from '../api';
import { leagueName, pct } from '../utils';
import './Forms.css';

export default function Forms() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedForm, setExpandedForm] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const d = await fetchFormsPredictions();
      if (!cancelled) {
        setData(d);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="loading">Loading forms data...</div>;

  if (!data) {
    return (
      <div className="page">
        <h1>📋 Forms Walk-Forward</h1>
        <div className="empty-panel">
          <h3>No forms data yet</h3>
          <p>
            The forms daily pipeline hasn't produced results yet. It runs
            automatically at 10 AM Israel time, or trigger it manually from
            the <code>toto-runner</code> repo.
          </p>
        </div>
      </div>
    );
  }

  const { form_summaries = [], league_winners = {}, overall_ranking = [], predictions = [], config = {} } = data;
  const ts = data.timestamp ? new Date(data.timestamp).toLocaleString() : '—';

  return (
    <div className="page">
      <h1>📋 Forms Walk-Forward</h1>
      <p className="generated">
        Updated: {ts} · Elapsed: {data.elapsed_minutes ?? '?'} min · {data.forms_used ?? '?'} forms evaluated
      </p>

      {/* League winners */}
      <h2>🏆 Best Model×Ensemble per League</h2>
      <p className="section-sub">
        The combination that scored the most across all {form_summaries.length} forms,
        per league. This winner is trained on all data and used for upcoming predictions.
      </p>
      <div className="model-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>League</th>
              <th>Model</th>
              <th>Ensemble</th>
              <th>Validation Acc</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(league_winners).map(([league, w]) => (
              <tr key={league}>
                <td><strong>{leagueName(league)}</strong></td>
                <td>{w.model}</td>
                <td className="ensemble-cell">{w.ensemble}</td>
                <td className="num-cell">{w.accuracy}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Overall top 10 */}
      <h2>📊 Overall Ranking (Top 10)</h2>
      <div className="model-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Model</th>
              <th>Ensemble</th>
              <th>Points</th>
              <th>Total</th>
              <th>Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {overall_ranking.map((r, i) => (
              <tr key={i} className={i === 0 ? 'row-baseline' : ''}>
                <td>{i + 1}</td>
                <td>{r.model}</td>
                <td className="ensemble-cell">{r.ensemble}</td>
                <td className="num-cell">{r.points}</td>
                <td className="num-cell">{r.total}</td>
                <td className="num-cell"><strong>{r.accuracy}%</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Form summaries */}
      <h2>📝 Per-Form Results</h2>
      <p className="section-sub">
        Click a form to see game-by-game details including doubles chosen and their thresholds.
      </p>
      <div className="forms-grid">
        {form_summaries.map((fs) => {
          const isExpanded = expandedForm === fs.form_id;
          return (
            <div key={fs.form_id} className="form-card">
              <div
                className="form-card-header"
                onClick={() => setExpandedForm(isExpanded ? null : fs.form_id)}
              >
                <div className="form-card-title">
                  <span className={`form-type-badge ${fs.form_type}`}>
                    {fs.form_type}
                  </span>
                  #{fs.form_id}
                </div>
                <div className="form-card-score">
                  <strong>{fs.points}/{fs.total}</strong>
                  <span className="form-acc">({fs.accuracy}%)</span>
                </div>
                <div className="form-card-meta">
                  {fs.best_model} + {fs.best_ensemble}
                </div>
                <span className="expand-icon">{isExpanded ? '▲' : '▼'}</span>
              </div>

              {isExpanded && (
                <div className="form-card-body">
                  {fs.close_threshold != null && (
                    <p className="doubles-info">
                      Close threshold: <strong>{Number(fs.close_threshold).toFixed(3)}</strong>
                      {fs.doubles_summary && (
                        <> · Doubles: <strong>{fs.doubles_summary.correct}/{fs.doubles_summary.count}</strong> correct
                          {fs.doubles_summary.games?.map((g, j) => (
                            <span key={j} className="double-badge">{g}</span>
                          ))}
                        </>
                      )}
                    </p>
                  )}
                  {fs.games?.length > 0 && (
                    <table className="data-table games-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Match</th>
                          <th>League</th>
                          <th>Pred</th>
                          <th>Double</th>
                          <th>Actual</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {fs.games.map((g, i) => (
                          <tr key={i} className={g.is_double ? 'double-row' : ''}>
                            <td>{g.game_number}</td>
                            <td className="match-cell">{g.home_team} vs {g.away_team}</td>
                            <td>{leagueName(g.league)}</td>
                            <td className="num-cell">{g.prediction}</td>
                            <td className="num-cell">
                              {g.is_double ? (
                                <span className="double-marker">{g.double_prediction}</span>
                              ) : '—'}
                            </td>
                            <td className="num-cell">{g.actual}</td>
                            <td>{g.correct ? '✅' : '❌'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Upcoming predictions */}
      {predictions.length > 0 && (
        <>
          <h2>🔮 Upcoming Predictions</h2>
          <p className="section-sub">
            Next 5 days' games predicted by the winning model per league.
          </p>
          <div className="model-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Match</th>
                  <th>League</th>
                  <th>Prediction</th>
                  <th>Confidence</th>
                  <th>Model</th>
                </tr>
              </thead>
              <tbody>
                {predictions.map((p, i) => (
                  <tr key={i}>
                    <td className="date-cell">{p.date}</td>
                    <td className="match-cell">{p.home_team} vs {p.away_team}</td>
                    <td>{leagueName(p.league)}</td>
                    <td className="num-cell">
                      <strong className={`pred-${p.prediction}`}>{p.prediction}</strong>
                    </td>
                    <td className="num-cell">
                      {p.confidence != null ? `${(p.confidence * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className="ensemble-cell">{p.model || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
