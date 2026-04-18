# Draw Model + Backtest — Dashboard Handoff

Context for anyone (or a future Claude session) picking this up.

## What this dashboard now shows

On top of the original 3-class prediction view, the dashboard now consumes two extra data products from the TotoGenerator repo:

1. **Draw model predictions** (`YYYY-MM-DD_draw.json`) — a binary *Draw vs Not-Draw* model that runs alongside the 3-class pipeline. Gives a better-calibrated `P(draw)` per fixture.
2. **Walk-forward backtest** (`public/data/backtest/latest_rounds.csv` + `latest_winners.json`) — historical Toto-16 strategy simulation showing how a hybrid *3-class + doubling on draw-disagreement* strategy would have performed.

## Where the files live (dashboard side)

```
public/data/
  index.json                       # dates list (existing)
  YYYY-MM-DD.json                  # daily 3-class snapshot (existing)
  YYYY-MM-DD_draw.json             # daily draw snapshot (NEW)
  backtest/
    latest_rounds.csv              # per-round Toto-16 performance (NEW)
    latest_winners.json            # per-league model config used (NEW)
```

Both draw daily files and backtest files are pushed in by TotoGenerator's GitHub Actions:
- `.github/workflows/draw.yml` syncs `*_draw.json` after each daily draw run
- `.github/workflows/backtest.yml` (manual trigger) writes backtest CSVs

**Note:** backtest CSVs aren't auto-synced yet — they land in the TotoGenerator repo at `output/backtest/`. To get them on the dashboard, either copy manually or extend `backtest.yml` to push them to this repo. See "Follow-ups" below.

## Schemas

### `YYYY-MM-DD_draw.json`
```json
{
  "generated_at": "2026-04-18T07:33:30",
  "training_rows": 20780,
  "models": [
    { "scope": "France1", "model": "tabnet", "ensemble": "E4_...",
      "auc": 0.796, "threshold": 0.32, "accuracy": 0.86 }
  ],
  "predictions": [
    { "fixture_id": 1378188, "date": "2026-04-18", "league": "Italy1",
      "home_team_name": "Napoli", "away_team_name": "Lazio",
      "model_type": "per_league" | "best_overall",
      "prob_draw": 0.29, "threshold": 0.24, "predicted_draw": 1, "roc_auc": 0.654 }
  ]
}
```

Match draw predictions to 3-class predictions by `(date, league, home, away)` — the main JSON has no `fixture_id`.

### `backtest/latest_rounds.csv`
Columns: `round_idx, first_date, last_date, n_disagreement, baseline_correct, best_at_K0..K6, forms_at_K0..K6`. One row per Toto-16 round. See TotoGenerator `pipeline_draw/backtest_walkforward.py` for the generator.

## Code map (dashboard)

| File | Purpose |
|---|---|
| `src/api.js` | `fetchDrawSnapshot(date)`, `fetchBacktestRounds()`, `fetchBacktestWinners()` |
| `src/hooks/useSnapshots.js` | `useDrawSnapshot(date)` alongside existing |
| `src/utils.js` | `matchKey(date, league, home, away)`, `buildDrawLookup(drawData)` |
| `src/pages/Home.jsx` | Integrates draw P(X) column + disagreement highlighting + draw-model panel |
| `src/pages/Backtest.jsx` | New tab — strategy stats table |
| `src/App.jsx`, `src/components/Navbar.jsx` | Add `/backtest` route |

## Follow-ups (not done yet)

1. **Sync backtest CSVs to this repo**. Either:
   - Manually copy `TotoGenerator/output/backtest/walkforward_*` to `toto-dashboard/public/data/backtest/latest_*` after each run, OR
   - Extend `TotoGenerator/.github/workflows/backtest.yml` to push to this repo like `draw.yml` does.
2. **Backtest trend chart**. Right now only the latest run is shown. Writing timestamped files + an index would enable a "performance over time" chart.
3. **Per-league draw model calibration view**. The draw model records `roc_auc` per fixture — could show a calibration plot or per-league AUC trend.

## Disagreement definition (used in Home view)

A fixture is a "disagreement" when:
- 3-class model picks `1` or `2` (a team), AND
- Draw model's `P(X) >= threshold` (i.e., `predicted_draw == 1` in the JSON)

These are flagged visually — they're the fixtures where the *doubled-form* Toto strategy adds value. See TotoGenerator `pipeline_draw/backtest_strategy.py` for the full strategy definition.
