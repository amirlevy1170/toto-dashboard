import { useSnapshots } from '../hooks/useSnapshots';
import StatCard from '../components/StatCard';
import { leagueName, predColor, pct } from '../utils';
import './Home.css';

export default function Home() {
  const { snapshots, loading, error } = useSnapshots();

  if (loading) return <div className="loading">Loading latest data...</div>;
  if (error) return <div className="error">Error: {error}</div>;
  if (!snapshots.length) return <div className="empty">No data available yet.</div>;

  const latest = snapshots[0];
  const best = latest.best_overall || {};
  const leagues = latest.per_league || [];
  const cups = latest.cup_models || [];
  const nationals = latest.national_models || [];
  const preds = latest.predictions || [];
  const ai = latest.ai_metrics || {};

  return (
    <div className="page">
      <h1>Latest Run — {latest.date}</h1>
      <p className="generated">Generated: {latest.generated_at}</p>

      <div className="stats-row">
        <StatCard label="Best Overall" value={best.model || 'N/A'}
                  sub={`${best.ensemble} — ${pct(best.accuracy || 0)}`} color="#4361ee" />
        <StatCard label="Leagues" value={leagues.length} sub="active leagues" color="#3a86a8" />
        <StatCard label="Predictions" value={preds.length} sub="upcoming matches" color="#7209b7" />
        <StatCard label="AI Accuracy" value={pct(ai.accuracy || 0)} sub="Gemini evaluation" color="#f72585" />
      </div>

      <h2>Per-League Winners</h2>
      <div className="league-grid">
        {leagues.map(l => (
          <div key={l.league} className="league-card">
            <div className="league-name">{leagueName(l.league)}</div>
            <div className="league-model">{l.model}</div>
            <div className="league-ensemble">{l.ensemble}</div>
            <div className="league-acc">{pct(l.accuracy)}</div>
          </div>
        ))}
      </div>

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

      <h2>Upcoming Predictions</h2>
      <div className="model-table-wrap">
        <table className="data-table predictions-table">
          <thead>
            <tr>
              <th>Date</th><th>Match</th>
              <th>League Pred</th><th>H / D / A</th>
              <th>Overall Pred</th><th>H / D / A</th>
              <th>AI Pred</th><th>H / D / A</th>
            </tr>
          </thead>
          <tbody>
            {preds.map((p, i) => (
              <tr key={i}>
                <td className="date-cell">{p.date}</td>
                <td><strong>{p.home}</strong> vs {p.away}</td>
                <td style={{ background: predColor(p.league_pred), fontWeight: 700, textAlign: 'center' }}>
                  {p.league_pred}
                </td>
                <td className="prob-cell">
                  {pct(p.league_prob_h)} / {pct(p.league_prob_d)} / {pct(p.league_prob_a)}
                </td>
                <td style={{ background: predColor(p.overall_pred), fontWeight: 700, textAlign: 'center' }}>
                  {p.overall_pred}
                </td>
                <td className="prob-cell">
                  {pct(p.overall_prob_h)} / {pct(p.overall_prob_d)} / {pct(p.overall_prob_a)}
                </td>
                <td style={{ background: predColor(p.ai_pred), fontWeight: 700, textAlign: 'center' }}>
                  {p.ai_pred}
                </td>
                <td className="prob-cell">
                  {pct(p.ai_prob_h)} / {pct(p.ai_prob_d)} / {pct(p.ai_prob_a)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
