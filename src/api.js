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
