/**
 * Shared Upstash KV REST helpers — optional when env vars absent.
 * Accepts Vercel KV names (KV_REST_API_*) or Upstash integration (UPSTASH_REDIS_REST_*).
 */

function kvRestConfig() {
  const url =
    process.env.KV_REST_API_URL
    || process.env.UPSTASH_REDIS_REST_URL
    || '';
  const token =
    process.env.KV_REST_API_TOKEN
    || process.env.UPSTASH_REDIS_REST_TOKEN
    || '';
  return { url: url.trim(), token: token.trim() };
}

function kvConfigured() {
  const { url, token } = kvRestConfig();
  return !!(url && token);
}

async function kvGet(key) {
  if (!kvConfigured()) return null;
  const { url, token } = kvRestConfig();
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`KV get failed: ${res.status}`);
  const data = await res.json();
  return data.result ?? null;
}

async function kvSet(key, value) {
  // Accepts either a plain value (object/array) or an already-JSON-stringified
  // string. Stringifies exactly once — passing a pre-stringified string through
  // here used to double-encode it, which corrupted every read (see api/config.js
  // for the same bug, fixed there previously but not here).
  if (!kvConfigured()) return false;
  const { url, token } = kvRestConfig();
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`KV set failed: ${res.status}`);
  return true;
}

async function kvList(prefix) {
  if (!kvConfigured()) return [];
  const { url, token } = kvRestConfig();
  const res = await fetch(`${url}/keys/${encodeURIComponent(prefix + '*')}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`KV list failed: ${res.status}`);
  const data = await res.json();
  return data.result || [];
}

function safeParse(raw) {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    // Legacy corruption guard: a previously double-encoded string can come
    // back from Upstash as a character-indexed object ({"0":"[","1":"{",...}).
    // Reconstruct and parse it if we see that shape.
    const keys = Object.keys(raw);
    if (keys.length > 0 && keys[0] === '0' && keys[1] === '1') {
      const maxIdx = Math.max(...keys.map(Number));
      let str = '';
      for (let i = 0; i <= maxIdx; i++) str += raw[String(i)] || '';
      try { return JSON.parse(str); } catch (_) { return null; }
    }
    return raw;
  }

  if (typeof raw === 'object') return raw; // arrays

  try {
    const once = JSON.parse(raw);
    if (typeof once === 'string') {
      // Legacy double-encoded string — unwrap the second layer too.
      try { return JSON.parse(once); } catch (_) { return null; }
    }
    return once;
  } catch (_) {
    return null;
  }
}

module.exports = { kvConfigured, kvGet, kvSet, kvList, safeParse };
