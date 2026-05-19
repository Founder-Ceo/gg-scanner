export const config = { maxDuration: 10 };

async function kvGet(key) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.result ?? null;
}

async function kvSet(key, value) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(value),
  });
  return res.ok;
}

function safeParse(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // GET /api/signals?key=scan:... — return signals for a saved scan
  if (req.method === 'GET') {
    try {
      const key = req.query?.key || (req.url?.split('key=')[1] ? decodeURIComponent(req.url.split('key=')[1]) : null);
      if (!key) { res.status(400).json({ error: 'key query param required' }); return; }

      const signalsRaw  = await kvGet(key + ':signals');
      const summaryRaw  = await kvGet(key + ':summary');
      const signals  = safeParse(signalsRaw);
      const summary  = safeParse(summaryRaw);

      if (!signals) { res.status(404).json({ error: 'Scan not found' }); return; }

      res.status(200).json({
        signals:   Array.isArray(signals) ? signals : [],
        dateLabel: summary?.dateLabel || '',
        key,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // PATCH /api/signals — update a signal's status
  // Body: { scanKey, signalId, status }
  if (req.method === 'PATCH') {
    try {
      const { scanKey, signalId, status } = req.body || {};
      if (!scanKey || !signalId || !status) {
        res.status(400).json({ error: 'scanKey, signalId and status are required' }); return;
      }
      const raw     = await kvGet(scanKey + ':signals');
      const signals = safeParse(raw);
      if (!Array.isArray(signals)) {
        res.status(404).json({ error: 'Scan signals not found' }); return;
      }
      const idx = signals.findIndex(s => s.id === signalId);
      if (idx === -1) {
        res.status(404).json({ error: 'Signal not found' }); return;
      }
      signals[idx].status = status;
      await kvSet(scanKey + ':signals', JSON.stringify(signals));
      res.status(200).json({ ok: true, signal: signals[idx] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).end('Method not allowed');
};
