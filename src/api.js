const REPO_OWNER = 'orgreens21';
const REPO_NAME = 'TotoGenerator';
const BRANCH = 'master';
const BASE_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/output/history`;

export async function fetchIndex() {
  const res = await fetch(`${BASE_URL}/index.json`);
  if (!res.ok) throw new Error('Failed to fetch index');
  const data = await res.json();
  return data.dates || [];
}

export async function fetchSnapshot(date) {
  const res = await fetch(`${BASE_URL}/${date}.json`);
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
