import { useMemo } from 'react';
import { useSnapshots } from '../hooks/useSnapshots';
import { leagueName, pct, LEAGUES } from '../utils';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import './Home.css';

export default function Leagues() {
  const { snapshots, loading, error } = useSnapshots();

  const leagueData = useMemo(() => {
    if (!snapshots.length) return {};

    const result = {};
    for (const league of LEAGUES) {
      const history = [];
      const modelWins = {};

      for (const snap of [...snapshots].reverse()) {
        const match = (snap.per_league || []).find(l => l.league === league.id);
        if (match) {
          history.push({
            date: snap.date,
            accuracy: Math.round(match.accuracy * 100),
            model: match.model,
            ensemble: match.ensemble,
          });
          const key = match.model;
          modelWins[key] = (modelWins[key] || 0) + 1;
        }
      }

      result[league.id] = { history, modelWins };
    }
    return result;
  }, [snapshots]);

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div className="page">
      <h1>Per-League Analysis</h1>
      <p className="generated">Accuracy trends and model frequency across {snapshots.length} runs</p>

      {LEAGUES.map(league => {
        const data = leagueData[league.id];
        if (!data || !data.history.length) return null;

        const sortedWins = Object.entries(data.modelWins).sort((a, b) => b[1] - a[1]);

        return (
          <div key={league.id} className="league-section">
            <h2>{league.flag} {league.name}</h2>

            <div className="league-detail-grid">
              <div className="chart-box">
                <h3>Accuracy Trend</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={data.history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" fontSize={11} />
                    <YAxis domain={[30, 80]} fontSize={11} tickFormatter={v => `${v}%`} />
                    <Tooltip formatter={v => [`${v}%`, 'Accuracy']}
                             labelFormatter={l => `Date: ${l}`} />
                    <Line type="monotone" dataKey="accuracy" stroke="#4361ee"
                          strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="wins-box">
                <h3>Model Win Frequency</h3>
                <div className="wins-list">
                  {sortedWins.map(([model, count]) => (
                    <div key={model} className="win-row">
                      <span className="win-model">{model}</span>
                      <div className="win-bar-wrap">
                        <div className="win-bar"
                             style={{ width: `${(count / data.history.length) * 100}%` }} />
                      </div>
                      <span className="win-count">{count}×</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="detail-section">
              <h3>Run History</h3>
              <table className="data-table">
                <thead>
                  <tr><th>Date</th><th>Model</th><th>Ensemble</th><th>Accuracy</th></tr>
                </thead>
                <tbody>
                  {[...data.history].reverse().map((h, i) => (
                    <tr key={i}>
                      <td className="date-cell">{h.date}</td>
                      <td><strong>{h.model}</strong></td>
                      <td>{h.ensemble}</td>
                      <td style={{ fontWeight: 700, color: h.accuracy >= 60 ? '#27ae60' : h.accuracy >= 50 ? '#f39c12' : '#e74c3c' }}>
                        {h.accuracy}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
