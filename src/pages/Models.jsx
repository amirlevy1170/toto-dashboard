import { useMemo } from 'react';
import { useSnapshots } from '../hooks/useSnapshots';
import { leagueName, pct, LEAGUES } from '../utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import './Home.css';

const COLORS = ['#4361ee', '#3a86a8', '#7209b7', '#f72585', '#4cc9f0', '#80ed99',
                '#f4a261', '#e76f51', '#2a9d8f', '#264653', '#e9c46a', '#606c38',
                '#bc6c25', '#dda15e', '#283618', '#6d6875'];

export default function Models() {
  const { snapshots, loading, error } = useSnapshots();

  const { modelStats, ensembleStats, totalSelections } = useMemo(() => {
    const models = {};
    const ensembles = {};
    let total = 0;

    for (const snap of snapshots) {
      // League winners
      for (const l of snap.per_league || []) {
        models[l.model] = (models[l.model] || 0) + 1;
        if (l.ensemble) ensembles[l.ensemble] = (ensembles[l.ensemble] || 0) + 1;
        total++;
      }
      // Cup & national
      for (const m of [...(snap.cup_models || []), ...(snap.national_models || [])]) {
        models[m.model] = (models[m.model] || 0) + 1;
        total++;
      }
    }

    const modelStats = Object.entries(models)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const ensembleStats = Object.entries(ensembles)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return { modelStats, ensembleStats, totalSelections: total };
  }, [snapshots]);

  // Per-league model breakdown
  const leagueBreakdown = useMemo(() => {
    const result = {};
    for (const league of LEAGUES) {
      const models = {};
      for (const snap of snapshots) {
        const match = (snap.per_league || []).find(l => l.league === league.id);
        if (match) {
          models[match.model] = (models[match.model] || 0) + 1;
        }
      }
      if (Object.keys(models).length > 0) {
        result[league.id] = Object.entries(models)
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => ({ name, count }));
      }
    }
    return result;
  }, [snapshots]);

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div className="page">
      <h1>Model Comparison</h1>
      <p className="generated">{totalSelections} total selections across {snapshots.length} runs</p>

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
                         style={{ width: `${(m.count / snapshots.length) * 100}%`,
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
