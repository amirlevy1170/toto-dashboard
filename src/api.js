// Data can come from:
// 1. Local /data/ folder (copied to public/ during build or synced via GH Action)
// 2. GitHub raw API (works for public repos)
// 3. GitHub API with token (for private repos)
const USE_LOCAL = true; // toggle to false if fetching from GitHub directly
const REPO_OWNER = 'orgreens21';
const REPO_NAME = 'TotoGenerator';
const BRANCH = 'master';
const GITHUB_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/output/history`;
const LOCAL_BASE = `${import.meta.env.BASE_URL}data`;

function baseUrl() {
  return USE_LOCAL ? LOCAL_BASE : GITHUB_BASE;
}

export async function fetchIndex() {
  const res = await fetch(`${baseUrl()}/index.json`);
  if (!res.ok) throw new Error('Failed to fetch index');
  const data = await res.json();
  return data.dates || [];
}

export async function fetchSnapshot(date) {
  const res = await fetch(`${baseUrl()}/${date}.json`);
  if (!res.ok) throw new Error(`Failed to fetch snapshot for ${date}`);
  return res.json();
}

export async function fetchAllSnapshots() {
  const dates = await fetchIndex();
  const snapshots = await Promise.all(
    dates.map(async (date) => {
      try {
        return await fetchSnapshot(date);
      } catch {
        return null;
      }
    })
  );
  return snapshots.filter(Boolean);
}

// ── Draw model (binary Draw vs Not-Draw) ─────────────────────────────
// Loaded from `<date>_draw.json`. Missing file is normal on older dates
// — returns null instead of throwing.
export async function fetchDrawSnapshot(date) {
  try {
    const res = await fetch(`${baseUrl()}/${date}_draw.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Walk-forward backtest ────────────────────────────────────────────
// Latest run is expected at `backtest/latest_rounds.csv` + `latest_winners.json`.
// Returns null if the files aren't there yet (graceful empty state).
export async function fetchBacktestRounds() {
  try {
    const res = await fetch(`${baseUrl()}/backtest/latest_rounds.csv`);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function fetchBacktestWinners() {
  try {
    const res = await fetch(`${baseUrl()}/backtest/latest_winners.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Forms walk-forward pipeline ──────────────────────────────────────
// Daily forms pipeline output with per-form results, league winners,
// and upcoming predictions.
export async function fetchFormsPredictions() {
  try {
    const res = await fetch(`${baseUrl()}/forms_predictions.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
