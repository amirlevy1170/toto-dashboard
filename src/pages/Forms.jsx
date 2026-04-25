import { useEffect, useMemo, useState } from 'react';
import { fetchFormsPredictions, fetchFormsIndex, fetchFormsSnapshot, fetchDrawSnapshot } from '../api';
import { leagueName, pct, predColor, buildDrawByFixtureId } from '../utils';
import './Forms.css';

const DRAW_DOUBLES = 4;

export default function Forms() {
  const [dates, setDates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [data, setData] = useState(null);
  const [drawData, setDrawData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedForm, setExpandedForm] = useState(null);

  // Load index + latest on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [latest, idx] = await Promise.all([
        fetchFormsPredictions(),
        fetchFormsIndex(),
      ]);
      if (cancelled) return;
      // If index has dates, use them; always include "latest"
      setDates(idx.length > 0 ? idx : []);
      setData(latest);
      setSelected('latest');
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Load a specific date's snapshot when selected
  const handleDateSelect = async (val) => {
    setSelected(val);
    setExpandedForm(null);
    if (val === 'latest') {
      setLoading(true);
      const d = await fetchFormsPredictions();
      setData(d);
      setLoading(false);
    } else {
      setLoading(true);
      try {
        const d = await fetchFormsSnapshot(val);
        setData(d);
      } catch {
        setData(null);
      }
      setLoading(false);
    }
  };

  // Load matching draw snapshot whenever the selected forms run changes.
  // Run date for "latest" comes from the timestamp; for a specific date pick, that date.
  useEffect(() => {
    if (!data) { setDrawData(null); return; }
    const runDate = (selected && selected !== 'latest')
      ? selected
      : (data.timestamp ? data.timestamp.split('T')[0] : null);
    if (!runDate) { setDrawData(null); return; }
    let cancelled = false;
    fetchDrawSnapshot(runDate).then(d => { if (!cancelled) setDrawData(d); });
    return () => { cancelled = true; };
  }, [data, selected]);

  // fixture_id -> per-league draw prediction (robust join — both files carry fixture_id).
  const drawByFixture = useMemo(() => buildDrawByFixtureId(drawData), [drawData]);

  // Pick the doubles: top-N fixtures by P(draw) among games where the regular
  // model picks a TEAM (1 or 2). Doubling an already-X pick adds nothing — the
  // form would still have only one outcome covered, so X-picks aren't candidates.
  const top4DrawIds = useMemo(() => {
    const preds = data?.predictions || [];
    const ranked = preds
      .filter(p => p.prediction === '1' || p.prediction === '2')
      .map(p => ({ id: p.fixture_id, prob: drawByFixture[p.fixture_id]?.prob_draw }))
      .filter(x => x.prob != null)
      .sort((a, b) => b.prob - a.prob);
    return new Set(ranked.slice(0, DRAW_DOUBLES).map(x => x.id));
  }, [data, drawByFixture]);

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

  const { form_summaries = [], league_winners = {}, predictions = [], config = {} } = data;
  const ts = data.timestamp ? new Date(data.timestamp).toLocaleString() : '—';

  // Group predictions by league, compute confidence diff, sort by diff desc
  const predsByLeague = {};
  for (const p of predictions) {
    const probs = [p.prob_home, p.prob_draw, p.prob_away].sort((a, b) => b - a);
    p._diff = probs[0] - probs[1];
    if (!predsByLeague[p.league]) predsByLeague[p.league] = [];
    predsByLeague[p.league].push(p);
  }
  for (const lg of Object.keys(predsByLeague)) {
    predsByLeague[lg].sort((a, b) => b._diff - a._diff);
  }
  const predLeagues = Object.keys(predsByLeague).sort();

  return (
    <div className="page">
      <h1>📋 Forms Walk-Forward</h1>

      {/* Date picker */}
      {dates.length > 0 && (
        <div className="date-picker-row">
          <label>Run date: </label>
          <select value={selected || 'latest'} onChange={e => handleDateSelect(e.target.value)}>
            <option value="latest">Latest</option>
            {dates.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      )}

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
                  {fs.games ? [...new Set(fs.games.map(g => g.league))].length : '?'} leagues
                </div>
                <span className="expand-icon">{isExpanded ? '▲' : '▼'}</span>
              </div>

              {isExpanded && (
                <div className="form-card-body">
                  {fs.form_date && (
                    <p className="doubles-info">
                      Form date: <strong>{fs.form_date}</strong>
                    </p>
                  )}
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
                  {fs.per_league_best && Object.keys(fs.per_league_best).length > 0 && (
                    <div className="per-league-best">
                      <h4 style={{margin: '12px 0 6px'}}>Best model × ensemble per league (this form)</h4>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>League</th>
                            <th>Model</th>
                            <th>Ensemble</th>
                            <th>Score</th>
                            <th>Acc</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(fs.per_league_best).map(([lg, info]) => (
                            <tr key={lg}>
                              <td><strong>{leagueName(lg)}</strong></td>
                              <td>{info.model}</td>
                              <td><code>{info.ensemble}</code></td>
                              <td className="num-cell">{info.points}/{info.total}</td>
                              <td className="num-cell">{info.accuracy}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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

      {/* Upcoming predictions — grouped by league like Home page */}
      {predictions.length > 0 && (
        <>
          <h2>🔮 Upcoming Predictions</h2>
          <p className="section-sub">
            Next 5 days' games predicted by the winning model per league.
            {drawData
              ? <> The <strong>Draw Double</strong> column marks the top {DRAW_DOUBLES} fixtures by the draw model's P(X) — those become the form's doubles, producing 2<sup>{DRAW_DOUBLES}</sup> = {1 << DRAW_DOUBLES} forms.</>
              : <> <em>Draw model snapshot for this run not found — Draw Double column will be empty.</em></>}
          </p>
          {predLeagues.map(league => (
            <div key={league} className="league-pred-section">
              <h3 className="league-pred-header">
                {leagueName(league)}
                {league_winners[league] && (
                  <span className="league-winner-tag">
                    {league_winners[league].model} + {league_winners[league].ensemble}
                    ({league_winners[league].accuracy}%)
                  </span>
                )}
              </h3>
              <div className="model-table-wrap">
                <table className="data-table predictions-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Match</th>
                      <th>Pred</th>
                      <th>H / D / A</th>
                      <th title="Difference between highest and second-highest probability">Diff</th>
                      <th title={`Top ${DRAW_DOUBLES} fixtures globally by draw model's P(X) get X added as a 2nd pick`}>🎯 Draw Double</th>
                    </tr>
                  </thead>
                  <tbody>
                    {predsByLeague[league].map((p, i) => {
                      const dp = drawByFixture[p.fixture_id];
                      const isDoubled = top4DrawIds.has(p.fixture_id);
                      const doubledPick = isDoubled ? `${p.prediction}X` : null;
                      return (
                        <tr key={i} className={isDoubled ? 'double-row' : ''}>
                          <td className="date-cell">{p.date}</td>
                          <td><strong>{p.home_team}</strong> vs {p.away_team}</td>
                          <td style={{ background: predColor(p.prediction), fontWeight: 700, textAlign: 'center' }}>
                            {p.prediction}
                          </td>
                          <td className="prob-cell">
                            {pct(p.prob_home)} / {pct(p.prob_draw)} / {pct(p.prob_away)}
                          </td>
                          <td className="num-cell" style={{ fontWeight: 600 }}>
                            {(p._diff * 100).toFixed(0)}%
                          </td>
                          <td
                            className="num-cell draw-double-cell"
                            title={dp ? `P(draw)=${(dp.prob_draw*100).toFixed(1)}% · threshold=${dp.threshold} · ${dp.model_name}` : 'no draw prediction for this fixture'}
                          >
                            {doubledPick ? (
                              <>
                                <span className="double-marker">{doubledPick}</span>
                                {dp && <div className="draw-prob-sub">{pct(dp.prob_draw)}</div>}
                              </>
                            ) : (
                              dp ? <span className="draw-dim">{pct(dp.prob_draw)}</span> : '—'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
