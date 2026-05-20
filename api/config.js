export const config = { maxDuration: 10 };

// ── Upstash KV helpers (raw REST — @vercel/kv must never be imported) ─────────
function kvConfigured() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvGet(key) {
  if (!kvConfigured()) return null;
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`KV get failed: ${res.status}`);
  const data = await res.json();
  return data.result;   // null if key does not exist
}

async function kvSet(key, value) {
  if (!kvConfigured()) return null;
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),  // Upstash stores this as-is
  });
  if (!res.ok) throw new Error(`KV set failed: ${res.status}`);
  return res.json();
}

// ── Safe parse — handles double-serialised or character-indexed legacy values ─
// The bug: previous config.js did JSON.stringify(obj) before passing to kvSet,
// which also JSON-stringifies. Result: a doubly-encoded string, which Upstash
// further corrupts into a character-indexed object on retrieval.
// Fix: always parse once, and detect the corrupted character-index form.
function safeParseConfig(raw) {
  if (raw === null || raw === undefined) return {};

  // Already a proper object (ideal case going forward)
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    // Detect the corrupted character-index form: keys are "0","1","2",...
    const keys = Object.keys(raw);
    if (keys.length > 0 && keys[0] === '0' && keys[1] === '1') {
      // Reconstruct the string from character indices
      const maxIdx = Math.max(...keys.map(Number));
      let str = '';
      for (let i = 0; i <= maxIdx; i++) str += raw[String(i)] || '';
      try { return JSON.parse(str); } catch (_) { return {}; }
    }
    return raw;
  }

  // String — parse once
  if (typeof raw === 'string') {
    try {
      const once = JSON.parse(raw);
      if (typeof once === 'string') {
        // Double-encoded — parse again
        try { return JSON.parse(once); } catch (_) { return {}; }
      }
      return once;
    } catch (_) { return {}; }
  }

  return {};
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // ── GET /api/config ────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const raw = await kvGet('config:settings');
      const cfg = safeParseConfig(raw);
      // Always return a plain object — never a string
      res.status(200).json({
        ...cfg,
        kvConfigured: kvConfigured(),
        storageMode: kvConfigured() ? 'vercel_kv' : 'browser',
      });
    } catch (err) {
      res.status(200).json({
        publishedTopics: '',
        analyticsData: [],
        kvConfigured: false,
        storageMode: 'browser',
      });
    }
    return;
  }

  // ── POST /api/config — save settings ──────────────────────────────────────
  if (req.method === 'POST') {
    if (!kvConfigured()) {
      res.status(200).json({
        saved: false,
        kvConfigured: false,
        storageMode: 'browser',
        hint: 'Settings saved in this browser only — add Vercel KV for cloud sync.',
      });
      return;
    }
    try {
      const incoming = req.body || {};

      // Load current config
      const raw     = await kvGet('config:settings');
      const current = safeParseConfig(raw);

      // Merge — only update fields that were actually sent
      const updated = { ...current };
      if (typeof incoming.publishedTopics === 'string') {
        updated.publishedTopics = incoming.publishedTopics;
        // Also write to the dedicated key that scan.js reads
        await kvSet('config:published-topics', incoming.publishedTopics);
      }
      if (Array.isArray(incoming.analyticsData)) {
        updated.analyticsData = incoming.analyticsData;
      }
      // Accept any other arbitrary config fields
      for (const [k, v] of Object.entries(incoming)) {
        if (k !== 'publishedTopics' && k !== 'analyticsData') {
          updated[k] = v;
        }
      }

      // Store as a plain object — Upstash will JSON-serialise it once
      await kvSet('config:settings', updated);
      res.status(200).json({ saved: true, keys: Object.keys(updated) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).end('Method not allowed');
};
