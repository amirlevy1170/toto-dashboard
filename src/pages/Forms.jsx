import { useEffect, useMemo, useState } from 'react';
import { fetchFormsPredictions, fetchFormsIndex, fetchFormsSnapshot, fetchDrawSnapshot, fetchAllDrawSnapshots } from '../api';
import { leagueName, pct, predColor, buildDrawByFixtureId, buildDrawByTeams, teamMatchKey } from '../utils';
import './Forms.css';

const DRAW_DOUBLES = 4;

// Compute draw-doubles strategy score for a form's games.
// The draw-doubles strategy REPLACES the form's threshold doubles: each game is
// either a single pick (the league model's prediction) OR a double "{pred}X" if
// it's in the top-N team picks by P(draw). We score it from scratch — we do NOT
// reuse `g.correct` because that reflects threshold-double saves which a pure
// draw-doubles strategy wouldn't get.
//
// Returns { games: [{...g, _drawPred, _isDrawDouble, _coveredWithDouble}], stats }.
// `stats.baselinePts` = the form's existing score (with threshold doubles applied
// by the pipeline) — this is the "current strategy" we're comparing against.
function computeDrawDoubles(games, drawByTeams) {
  if (!games?.length) return { games: [], stats: null };
  const enriched = games.map(g => {
    const dp = drawByTeams[teamMatchKey(g.league, g.home_team, g.away_team)] || null;
    return { ...g, _drawPred: dp };
  });
  const eligibleIdx = enriched
    .map((g, idx) => ({ idx, prob: g._drawPred?.prob_draw }))
    .filter(x => x.prob != null && (enriched[x.idx].prediction === '1' || enriched[x.idx].prediction === '2'))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, DRAW_DOUBLES)
    .map(x => x.idx);
  const top = new Set(eligibleIdx);
  let baselinePts = 0;
  let drawPts = 0;
  let hasActuals = false;
  const out = enriched.map((g, i) => {
    const isDouble = top.has(i);
    const hasActual = g.actual != null && g.actual !== '';
    // Draw-doubles strategy: covered iff actual matches single pick, or — when
    // doubled — also matches X. Computed from pred + actual directly, not from
    // g.correct (which already includes threshold-double saves).
    const coveredByDouble = hasActual
      ? (g.actual === g.prediction || (isDouble && g.actual === 'X'))
      : false;
    if (hasActual) {
      hasActuals = true;
      if (g.correct === true) baselinePts += 1;
      if (coveredByDouble) drawPts += 1;
    }
    return { ...g, _isDrawDouble: isDouble, _coveredWithDouble: coveredByDouble };
  });
  const stats = hasActuals
    ? { baselinePts, drawPts, gain: drawPts - baselinePts, doublesCount: eligibleIdx.length, total: out.length }
    : { baselinePts: 0, drawPts: 0, gain: 0, doublesCount: eligibleIdx.length, total: out.length };
  return { games: out, stats };
}

export default function Forms() {
  const [dates, setDates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [data, setData] = useState(null);
  const [drawData, setDrawData] = useState(null);
  const [drawByTeams, setDrawByTeams] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedForm, setExpandedForm] = useState(null);

  // Pool ALL available draw snapshots once for joining historical form games
  // (form games lack fixture_id and date — only team-pair join works).
  useEffect(() => {
    let cancelled = false;
    fetchAllDrawSnapshots().then(snaps => {
      if (!cancelled) setDrawByTeams(buildDrawByTeams(snaps));
    });
    return () => { cancelled = true; };
  }, []);

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

  // Per-form draw-double stats, computed once for header display + body reuse.
  // Map: form_id -> { drawPts, baselinePts, gain, doublesCount, total, joined, accuracy }
  const drawStatsByForm = useMemo(() => {
    const out = {};
    for (const fs of data?.form_summaries || []) {
      const { games, stats } = computeDrawDoubles(fs.games || [], drawByTeams);
      const joined = games.filter(g => g._drawPred).length;
      const accuracy = stats.total ? (stats.drawPts / stats.total) * 100 : 0;
      out[fs.form_id] = { ...stats, joined, accuracy };
    }
    return out;
  }, [data, drawByTeams]);

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
                {(() => {
                  const ds = drawStatsByForm[fs.form_id];
                  if (!ds || !ds.joined) {
                    return (
                      <div className="form-card-score draw-card-score" title="No draw predictions matched this form's games (they predate the draw-snapshot window)">
                        <span className="form-acc">🎯 —</span>
                      </div>
                    );
                  }
                  if (ds.joined < ds.total) {
                    return (
                      <div
                        className="form-card-score draw-card-score"
                        title={`Only ${ds.joined}/${ds.total} games matched a draw prediction — strategy score is not comparable when coverage is partial (un-joined games would lose their threshold-double saves and unfairly penalize the draw strategy)`}
                      >
                        <span className="form-acc">🎯 partial ({ds.joined}/{ds.total})</span>
                      </div>
                    );
                  }
                  const gainColor = ds.gain > 0 ? '#16a34a' : ds.gain < 0 ? '#dc2626' : '#6b7280';
                  const gainSign = ds.gain >= 0 ? '+' : '';
                  return (
                    <div
                      className="form-card-score draw-card-score"
                      title={`Draw-doubles strategy (replaces threshold doubles): ${ds.drawPts}/${ds.total} (${ds.accuracy.toFixed(1)}%) · gain ${gainSign}${ds.gain} vs current form's ${ds.baselinePts}/${ds.total}`}
                    >
                      <span style={{ marginRight: 4 }}>🎯</span>
                      <strong>{ds.drawPts}/{ds.total}</strong>
                      <span className="form-acc">({ds.accuracy.toFixed(1)}%)</span>
                      <span style={{ marginLeft: 6, fontWeight: 700, color: gainColor }}>
                        {gainSign}{ds.gain}
                      </span>
                    </div>
                  );
                })()}
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
                  {fs.games?.length > 0 && (() => {
                    const { games: enrichedGames, stats: drawStats } = computeDrawDoubles(fs.games, drawByTeams);
                    const drawJoined = enrichedGames.filter(g => g._drawPred).length;
                    return (
                      <>
                        {drawJoined === enrichedGames.length && drawStats && (
                          <p className="doubles-info">
                            <strong title="Draw-doubles strategy: replaces the form's threshold doubles with X added on the top-N team picks by P(draw)">
                              🎯 Draw-doubles strategy ({drawStats.doublesCount} doubles, replaces threshold doubles):
                            </strong>{' '}
                            <strong>{drawStats.drawPts}/{drawStats.total}</strong>
                            <span style={{ color: '#666' }}> (current form {drawStats.baselinePts}/{drawStats.total},{' '}
                              <span style={{ color: drawStats.gain > 0 ? '#16a34a' : drawStats.gain < 0 ? '#dc2626' : '#666', fontWeight: 700 }}>
                                {drawStats.gain >= 0 ? '+' : ''}{drawStats.gain}
                              </span>)
                            </span>
                            <span
                              style={{ color: '#888', marginLeft: 8, fontSize: '0.85em' }}
                              title="Each draw prediction comes from the latest snapshot that ran BEFORE its kickoff (pipeline_draw only emits upcoming fixtures, so leakage is impossible). Hover any cell for the exact run date."
                            >
                              · pre-game ✓
                            </span>
                          </p>
                        )}
                        {drawJoined > 0 && drawJoined < enrichedGames.length && (
                          <p className="doubles-info" style={{ color: '#b45309' }}>
                            🎯 Partial draw coverage ({drawJoined}/{enrichedGames.length}) — strategy score not shown.
                            Un-joined games would default to single picks (losing their threshold-double saves) and
                            unfairly penalize the draw strategy. Doubled games are still highlighted in the table below.
                          </p>
                        )}
                        {drawJoined === 0 && (
                          <p className="doubles-info" style={{ color: '#888' }}>
                            🎯 No draw predictions matched for this form's games — they predate the available draw-snapshot window.
                          </p>
                        )}
                        <table className="data-table games-table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Match</th>
                              <th>League</th>
                              <th>Pred</th>
                              <th>Double</th>
                              <th title={`Top ${DRAW_DOUBLES} fixtures by draw model's P(X) among team picks`}>🎯 Draw Double</th>
                              <th>Actual</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {enrichedGames.map((g, i) => {
                              const dp = g._drawPred;
                              const drawPick = g._isDrawDouble ? `${g.prediction}X` : null;
                              const drawCorrect = g._isDrawDouble && g.actual != null && g.actual !== ''
                                ? g._coveredWithDouble : null;
                              return (
                                <tr key={i} className={g.is_double || g._isDrawDouble ? 'double-row' : ''}>
                                  <td>{g.game_number}</td>
                                  <td className="match-cell">{g.home_team} vs {g.away_team}</td>
                                  <td>{leagueName(g.league)}</td>
                                  <td className="num-cell">{g.prediction}</td>
                                  <td className="num-cell">
                                    {g.is_double ? (
                                      <span className="double-marker">{g.double_prediction}</span>
                                    ) : '—'}
                                  </td>
                                  <td
                                    className="num-cell draw-double-cell"
                                    title={dp ? `P(draw)=${(dp.prob_draw*100).toFixed(1)}% · ${dp.model_name} · predicted on ${dp._snapshotDate || '?'} (kickoff ${dp.date}) — pre-game, no leakage` : 'no draw prediction matched'}
                                  >
                                    {drawPick ? (
                                      <>
                                        <span className="double-marker">{drawPick}</span>
                                        {drawCorrect != null && (
                                          <span style={{ marginLeft: 4 }}>{drawCorrect ? '✅' : '❌'}</span>
                                        )}
                                      </>
                                    ) : (
                                      dp ? <span className="draw-dim">{pct(dp.prob_draw)}</span> : '—'
                                    )}
                                  </td>
                                  <td className="num-cell">{g.actual}</td>
                                  <td>{g.correct ? '✅' : '❌'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </>
                    );
                  })()}
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
