// Cloud sync for forms-history using a GitHub Gist.
// The user supplies a Personal Access Token with `gist` scope once
// (stored in localStorage). On first save we create a fresh gist; later
// saves PATCH the same gist. On load, we fetch the file back.

const TOKEN_KEY = 'toto-forms-history-token';
const GIST_KEY  = 'toto-forms-history-gist';
const FILE_NAME = 'toto-forms-history.json';

const API = 'https://api.github.com';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(v) {
  if (v) localStorage.setItem(TOKEN_KEY, v);
  else localStorage.removeItem(TOKEN_KEY);
}
export function getGistId() {
  return localStorage.getItem(GIST_KEY) || '';
}
export function setGistId(v) {
  if (v) localStorage.setItem(GIST_KEY, v);
  else localStorage.removeItem(GIST_KEY);
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// Pull entries from cloud. Returns the parsed array (possibly empty) on
// success, or throws on auth / network errors.
export async function cloudPull() {
  const token = getToken();
  const gid = getGistId();
  if (!token) throw new Error('No token configured.');
  if (!gid) return null;  // No gist yet — caller decides whether to seed.
  const res = await fetch(`${API}/gists/${gid}`, { headers: authHeaders(token) });
  if (res.status === 404) {
    // Stale or inaccessible gist id — clear it so the next save creates a new one.
    setGistId('');
    throw new Error(
      `Gist ${gid} not found — it was cleared. Press Save to create a new one.`
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Pull failed (${res.status}): ${body.slice(0, 120)}`);
  }
  const data = await res.json();
  const file = data?.files?.[FILE_NAME];
  if (!file) return [];
  // GitHub may truncate large files; use raw_url in that case.
  let raw = file.content;
  if (file.truncated && file.raw_url) {
    const rr = await fetch(file.raw_url);
    if (rr.ok) raw = await rr.text();
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed?.entries || []);
  } catch {
    return [];
  }
}

// Push entries to cloud. Creates a new gist if none yet, else PATCHes.
// If the stored gist id is stale (404), drops it and creates a fresh gist
// automatically. Returns the gist id on success.
export async function cloudPush(entries) {
  const token = getToken();
  if (!token) throw new Error('No token configured.');
  const content = JSON.stringify(entries, null, 2);
  const body = {
    description: 'Toto Forms History — auto-managed by toto-dashboard',
    files: { [FILE_NAME]: { content } },
  };

  async function doRequest(method, url, includePublic) {
    const payload = includePublic ? { ...body, public: false } : body;
    return fetch(url, {
      method,
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  let gid = getGistId();
  let res;
  if (gid) {
    res = await doRequest('PATCH', `${API}/gists/${gid}`, false);
    if (res.status === 404) {
      // Stored gist id is unreachable for this token — fall back to creating
      // a fresh private gist and persist the new id.
      setGistId('');
      gid = '';
      res = await doRequest('POST', `${API}/gists`, true);
    }
  } else {
    res = await doRequest('POST', `${API}/gists`, true);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Push failed (${res.status}): ${txt.slice(0, 160)}`);
  }
  const data = await res.json();
  if (!gid && data.id) {
    setGistId(data.id);
    gid = data.id;
  }
  return gid;
}

export function isConfigured() {
  return !!getToken();
}
