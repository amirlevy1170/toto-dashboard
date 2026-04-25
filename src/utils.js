export const LEAGUES = [
  { id: 'England1', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', name: 'Premier League' },
  { id: 'Spain1', flag: '🇪🇸', name: 'La Liga' },
  { id: 'Italy1', flag: '🇮🇹', name: 'Serie A' },
  { id: 'Germany1', flag: '🇩🇪', name: 'Bundesliga' },
  { id: 'France1', flag: '🇫🇷', name: 'Ligue 1' },
  { id: 'Israel1', flag: '🇮🇱', name: "Ligat Ha'al" },
  { id: 'Israel2', flag: '🇮🇱', name: 'Liga Leumit' },
];

export const LEAGUE_MAP = Object.fromEntries(LEAGUES.map(l => [l.id, l]));

export function leagueName(id) {
  return LEAGUE_MAP[id] ? `${LEAGUE_MAP[id].flag} ${LEAGUE_MAP[id].name}` : id;
}

export function predColor(pred) {
  return { '1': '#d4edda', 'X': '#fff3cd', '2': '#d1ecf1' }[pred] || '#f8f9fa';
}

export function predLabel(pred) {
  return { '1': 'Home', 'X': 'Draw', '2': 'Away' }[pred] || pred;
}

export function pct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

// Composite key to match a fixture across the 3-class JSON
// (`date, league, home, away`) and the draw JSON
// (`date, league, home_team_name, away_team_name`).
export function matchKey(date, league, home, away) {
  return `${date}|${league}|${home}|${away}`.toLowerCase();
}

// Build a lookup: matchKey -> per-league draw prediction.
export function buildDrawLookup(drawData) {
  if (!drawData?.predictions?.length) return {};
  const perLeague = {};
  for (const p of drawData.predictions) {
    if (p.model_type !== 'per_league') continue;
    const key = matchKey(p.date, p.league, p.home_team_name, p.away_team_name);
    perLeague[key] = p;
  }
  return perLeague;
}

// Build a lookup: fixture_id -> per-league draw prediction.
// Use when joining files that both carry fixture_id (more robust than name match).
export function buildDrawByFixtureId(drawData) {
  if (!drawData?.predictions?.length) return {};
  const map = {};
  for (const p of drawData.predictions) {
    if (p.model_type !== 'per_league') continue;
    map[p.fixture_id] = p;
  }
  return map;
}

// A match is a "disagreement" when the 3-class picks a team (1 or 2) but
// the draw model flags X above the league's tuned threshold.
export function isDisagreement(threeClassPred, drawPrediction) {
  if (!drawPrediction) return false;
  return (threeClassPred === '1' || threeClassPred === '2') &&
         drawPrediction.predicted_draw === 1;
}
