export const LEAGUES = [
  { id: 'England1', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', name: 'Premier League' },
  { id: 'Spain1', flag: '🇪🇸', name: 'La Liga' },
  { id: 'Italy1', flag: '🇮🇹', name: 'Serie A' },
  { id: 'Germany1', flag: '🇩🇪', name: 'Bundesliga' },
  { id: 'France1', flag: '🇫🇷', name: 'Ligue 1' },
  { id: 'Israel1', flag: '🇮🇱', name: "Ligat Ha'al" },
  { id: 'Israel2', flag: '🇮🇱', name: 'Liga Leumit' },
];

export const CUPS = [
  { id: 'Champions',  flag: '🏆', name: 'Champions League' },
  { id: 'Europa',     flag: '🥈', name: 'Europa League' },
  { id: 'Conference', flag: '🥉', name: 'Conference League' },
];

export const NATIONALS = [
  { id: 'WorldCup',        flag: '🌍', name: 'World Cup' },
  { id: 'WC_Qual_Europe',  flag: '🌍', name: 'WC Qualifiers (Europe)' },
  { id: 'Euro',            flag: '🇪🇺', name: 'Euro' },
  { id: 'Euro_Qual',       flag: '🇪🇺', name: 'Euro Qualifiers' },
];

export const LEAGUE_MAP = Object.fromEntries(
  [...LEAGUES, ...CUPS, ...NATIONALS].map(l => [l.id, l])
);

const _CUPS_SET = new Set(CUPS.map(c => c.id));
const _NATIONALS_SET = new Set(NATIONALS.map(n => n.id));

export function classifyScope(scope) {
  if (_CUPS_SET.has(scope)) return 'cup';
  if (_NATIONALS_SET.has(scope)) return 'national';
  return 'league';
}

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

// Pool many draw snapshots into one (league|home|away) -> prediction lookup.
// Each snapshot is generated BEFORE kickoff (pipeline_draw only emits upcoming
// fixtures), so any candidate is leakage-free. When the same fixture appears in
// multiple snapshots (a Friday game shows up in Mon/Tue/Wed/Thu/Fri runs),
// prefer the latest pre-kickoff snapshot — that's what the user would actually
// have known when filling the form. Returns predictions enriched with the
// snapshot date they came from (`_snapshotDate`) for display + audit.
export function buildDrawByTeams(snapshots) {
  const map = {};
  for (const s of snapshots || []) {
    const snapDate = s?.generated_at ? s.generated_at.split('T')[0] : null;
    for (const p of s?.predictions || []) {
      if (p.model_type !== 'per_league') continue;
      const key = `${p.league}|${p.home_team_name}|${p.away_team_name}`.toLowerCase();
      const existing = map[key];
      // Newest pre-kickoff snapshot wins (lexicographic ISO date compare is OK).
      // If existing has no _snapshotDate (legacy entry), any dated entry overrides.
      const isNewer = !existing
        || (snapDate && (!existing._snapshotDate || snapDate > existing._snapshotDate));
      if (isNewer) {
        map[key] = { ...p, _snapshotDate: snapDate };
      }
    }
  }
  return map;
}

// Parse the walk-forward backtest CSV into prediction records shaped like
// daily-snapshot entries, so the same downstream code works.
// Schema: fixture_id,date,league,home,away,actual,prob_home,prob_draw_3c,prob_away,prob_draw_bin,draw_threshold
function parseDrawHistoryCsv(text) {
  if (!text) return [];
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  const idx = name => header.indexOf(name);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const probDraw = parseFloat(cols[idx('prob_draw_bin')]);
    const threshold = parseFloat(cols[idx('draw_threshold')]);
    if (Number.isNaN(probDraw) || Number.isNaN(threshold)) continue;
    out.push({
      fixture_id: cols[idx('fixture_id')],
      date: cols[idx('date')],
      league: cols[idx('league')],
      home_team_name: cols[idx('home')],
      away_team_name: cols[idx('away')],
      model_type: 'per_league',
      model_name: 'walkforward-backtest',
      prob_draw: probDraw,
      prob_not_draw: 1 - probDraw,
      threshold,
      predicted_draw: probDraw >= threshold ? 1 : 0,
    });
  }
  return out;
}

// Merge daily snapshots with the backtest CSV. Daily snapshots win on overlap
// (more current model + closer to kickoff); backtest fills the historical gap.
// Backtest entries are tagged with _snapshotDate='backtest' so the UI can show
// they came from the walk-forward CSV.
export function buildDrawByTeamsMerged(snapshots, csvText) {
  const map = buildDrawByTeams(snapshots);
  for (const p of parseDrawHistoryCsv(csvText)) {
    const key = `${p.league}|${p.home_team_name}|${p.away_team_name}`.toLowerCase();
    if (!(key in map)) {
      map[key] = { ...p, _snapshotDate: 'backtest' };
    }
  }
  return map;
}

export function teamMatchKey(league, home, away) {
  return `${league}|${home}|${away}`.toLowerCase();
}

// A match is a "disagreement" when the 3-class picks a team (1 or 2) but
// the draw model flags X above the league's tuned threshold.
export function isDisagreement(threeClassPred, drawPrediction) {
  if (!drawPrediction) return false;
  return (threeClassPred === '1' || threeClassPred === '2') &&
         drawPrediction.predicted_draw === 1;
}
