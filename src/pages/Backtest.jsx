import { useEffect, useMemo, useState } from 'react';
import { fetchBacktestRounds, fetchBacktestWinners } from '../api';
import { leagueName, pct } from '../utils';
import './Backtest.css';

const ROUND_SIZE = 16;
const K_VALUES = [0, 1, 2, 3, 4, 5, 6];

// Minimal CSV parser -- handles plain comma-separated values, header row.
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

function coerceNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export default function Backtest() {
  const [rounds, setRounds] = useState(null);
  const [winners, setWinners] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [csv, w] = await Promise.all([
        fetchBacktestRounds(),
        fetchBacktestWinners(),
      ]);
      if (cancelled) return;
      if (csv) {
        const rows = parseCSV(csv).map(r => {
          const out = {
            round_idx: coerceNumber(r.round_idx),
            first_date: r.first_date,
            last_date: r.last_date,
            n_disagreement: coerceNumber(r.n_disagreement),
            baseline_correct: coerceNumber(r.baseline_correct),
          };
          for (const k of K_VALUES) {
            out[`best_at_K${k}`] = coerceNumber(r[`best_at_K${k}`]);
            out[`forms_at_K${k}`] = coerceNumber(r[`forms_at_K${k}`]);
          }
          return out;
        }).filter(r => r.baseline_correct != null);
        setRounds(rows);
      }
      if (w) setWinners(w);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Aggregate per-K stats across all rounds
  const perK = useMemo(() => {
    if (!rounds?.length) return [];
    const n = rounds.length;
    const blTotal = rounds.reduce((acc, r) => acc + r.baseline_correct, 0);
    const blAvg = blTotal / n;
    return K_VALUES.map(k => {
      const bests = rounds.map(r => r[`best_at_K${k}`] ?? r.baseline_correct);
      const forms = rounds.map(r => r[`forms_at_K${k}`] ?? 1);
      const avgBest = bests.reduce((a, b) => a + b, 0) / n;
      const avgForms = forms.reduce((a, b) => a + b, 0) / n;
      const n14 = bests.filter(b => b >= 14).length;
      const n12 = bests.filter(b => b >= 12).length;
      const extra = avgBest - blAvg;
      const costPerExtra = extra > 0 ? (avgForms - 1) / extra : null;
      return { k, avgForms, avgBest, n14, n12, extra, costPerExtra };
    });
  }, [rounds]);

  if (loading) return <div className="loading">Loading backtest data...</div>;

  if (!rounds?.length) {
    return (
      <div className="page">
        <h1>Backtest — Walk-Forward Strategy</h1>
        <div className="empty-panel">
          <h3>No backtest data yet</h3>
          <p>
            The walk-forward backtest hasn't produced a result file yet. Run the
            <code>Backtest Walk-Forward (manual)</code> workflow in the
            TotoGenerator repo, then make sure the output is synced to this
            dashboard's <code>public/data/backtest/</code> as
            <code>latest_rounds.csv</code> and <code>latest_winners.json</code>.
          </p>
          <p className="hint">
            See <code>DRAW_DASHBOARD_HANDOFF.md</code> at the repo root for
            sync details.
          </p>
        </div>
      </div>
    );
  }

  const totalGames = rounds.length * ROUND_SIZE;
  const baselineTotal = rounds.reduce((s, r) => s + r.baseline_correct, 0);
  const baselinePct = baselineTotal / totalGames;
  const n14Baseline = rounds.filter(r => r.baseline_correct >= 14).length;
  const n12Baseline = rounds.filter(r => r.baseline_correct >= 12).length;

  return (
    <div className="page">
      <h1>Backtest — Walk-Forward Strategy</h1>
      <p className="generated">
        Strategy: fill the 3-class pick per match, then DOUBLE (fill a second form) for the top-K
        matches where the draw model flags X above its league threshold.
        Score = best-form correct across all 2<sup>K</sup> variants.
      </p>

      <div className="stats-row">
        <div className="stat-box">
          <div className="stat-label">Rounds backtested</div>
          <div className="stat-value">{rounds.length}</div>
          <div className="stat-sub">{totalGames} games total</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Baseline (1 form)</div>
          <div className="stat-value">{pct(baselinePct)}</div>
          <div className="stat-sub">
            {(baselineTotal / rounds.length).toFixed(2)} / 16 avg
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Baseline 14+ hits</div>
          <div className="stat-value">{n14Baseline} / {rounds.length}</div>
          <div className="stat-sub">
            {pct(n14Baseline / rounds.length)} of rounds
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Baseline 12+ hits</div>
          <div className="stat-value">{n12Baseline} / {rounds.length}</div>
          <div className="stat-sub">
            {pct(n12Baseline / rounds.length)} of rounds
          </div>
        </div>
      </div>

      <h2>Strategy by depth K</h2>
      <p className="section-sub">
        K is how many disagreement matches you "double". K=0 is the baseline
        (one form). Each step doubles the max possible form count, costing more
        to play but catching more draws the 3-class model missed.
      </p>
      <div className="model-table-wrap">
        <table className="data-table backtest-table">
          <thead>
            <tr>
              <th>K</th>
              <th>Avg forms / round</th>
              <th>Avg correct / 16</th>
              <th>Gain vs baseline</th>
              <th>Rounds 12+ (hit %)</th>
              <th>Rounds 14+ (hit %)</th>
              <th>Cost per extra correct</th>
            </tr>
          </thead>
          <tbody>
            {perK.map(r => (
              <tr key={r.k} className={r.k === 0 ? 'row-baseline' : ''}>
                <td><strong>{r.k}</strong>{r.k === 0 ? ' (baseline)' : ''}</td>
                <td className="num-cell">{r.avgForms.toFixed(2)}</td>
                <td className="num-cell"><strong>{r.avgBest.toFixed(2)}</strong></td>
                <td className="num-cell" style={{ color: r.extra > 0 ? '#2b9348' : '#555' }}>
                  {r.extra >= 0 ? '+' : ''}{r.extra.toFixed(3)}
                </td>
                <td className="num-cell">
                  {r.n12}/{rounds.length} ({pct(r.n12 / rounds.length)})
                </td>
                <td className="num-cell">
                  {r.n14}/{rounds.length} ({pct(r.n14 / rounds.length)})
                </td>
                <td className="num-cell">
                  {r.costPerExtra == null ? '—' : r.costPerExtra.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {winners && Object.keys(winners).length > 0 && (
        <>
          <h2>Per-league winners used</h2>
          <p className="section-sub">
            The (model, ensemble) combo that was picked for each league, either
            from production winners or from the backtest's Phase 1 grid.
          </p>
          <div className="model-table-wrap">
            <table className="data-table backtest-table">
              <thead>
                <tr>
                  <th>League</th>
                  <th>3-class model</th>
                  <th>3-class ensemble</th>
                  <th>val_acc</th>
                  <th>Draw model</th>
                  <th>Draw ensemble</th>
                  <th>val_AUC</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(winners).map(([league, w]) => (
                  <tr key={league}>
                    <td><strong>{leagueName(league)}</strong></td>
                    <td>{w.three_class?.[0] || '—'}</td>
                    <td className="ensemble-cell">{w.three_class?.[1] || '—'}</td>
                    <td className="num-cell">
                      {w.three_class_val_acc != null ? w.three_class_val_acc.toFixed(3) : '—'}
                    </td>
                    <td>{w.draw?.[0] || '—'}</td>
                    <td className="ensemble-cell">{w.draw?.[1] || '—'}</td>
                    <td className="num-cell">
                      {w.draw_val_auc != null ? w.draw_val_auc.toFixed(3) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Per-round detail</h2>
      <p className="section-sub">
        Each row is one 16-game simulated Toto round. Best-at-K columns show the
        max correct achievable with that many doubles.
      </p>
      <div className="model-table-wrap">
        <table className="data-table backtest-table rounds-detail">
          <thead>
            <tr>
              <th>#</th>
              <th>First date</th>
              <th>Last date</th>
              <th>Disagree</th>
              <th>Baseline</th>
              {K_VALUES.slice(1).map(k => (
                <th key={k} title={`Best correct when doubling top ${k} disagreements`}>
                  K={k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rounds.map(r => (
              <tr key={r.round_idx}>
                <td>{r.round_idx}</td>
                <td className="date-cell">{r.first_date}</td>
                <td className="date-cell">{r.last_date}</td>
                <td className="num-cell">{r.n_disagreement}</td>
                <td className="num-cell"><strong>{r.baseline_correct}</strong></td>
                {K_VALUES.slice(1).map(k => {
                  const v = r[`best_at_K${k}`] ?? r.baseline_correct;
                  const gain = v - r.baseline_correct;
                  return (
                    <td key={k} className="num-cell"
                        style={{ color: gain > 0 ? '#2b9348' : '#555' }}>
                      {v}{gain > 0 ? ` (+${gain})` : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
