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
