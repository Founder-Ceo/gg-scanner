export const config = { maxDuration: 10 };

const { kvConfigured, kvGet, kvSet, safeParse } = require('./kv');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const meta = {
    kvConfigured: kvConfigured(),
    storageMode: kvConfigured() ? 'vercel_kv' : 'browser',
  };

  if (req.method === 'GET') {
    try {
      const key =
        req.query?.key
        || (req.url?.includes('key=') ? decodeURIComponent(req.url.split('key=')[1].split('&')[0]) : null);
      if (!key) {
        res.status(400).json({ error: 'key query param required' });
        return;
      }

      if (!kvConfigured()) {
        res.status(404).json({
          error: 'Scan not in cloud storage — load from browser archive',
          ...meta,
        });
        return;
      }

      const signalsRaw = await kvGet(key + ':signals');
      const summaryRaw = await kvGet(key + ':summary');
      const signals = safeParse(signalsRaw);
      const summary = safeParse(summaryRaw);

      if (!signals) {
        res.status(404).json({ error: 'Scan not found' });
        return;
      }

      res.status(200).json({
        signals: Array.isArray(signals) ? signals : [],
        dateLabel: summary?.dateLabel || '',
        key,
        ...meta,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  if (req.method === 'PATCH') {
    try {
      const { scanKey, signalId, status } = req.body || {};
      if (!scanKey || !signalId || !status) {
        res.status(400).json({ error: 'scanKey, signalId and status are required' });
        return;
      }

      if (!kvConfigured()) {
        res.status(200).json({ ok: true, ...meta, persisted: false });
        return;
      }

      const raw = await kvGet(scanKey + ':signals');
      const signals = safeParse(raw);
      if (!Array.isArray(signals)) {
        res.status(404).json({ error: 'Scan signals not found' });
        return;
      }
      const idx = signals.findIndex((s) => s.id === signalId);
      if (idx === -1) {
        res.status(404).json({ error: 'Signal not found' });
        return;
      }
      signals[idx].status = status;
      await kvSet(scanKey + ':signals', JSON.stringify(signals));
      res.status(200).json({ ok: true, signal: signals[idx], ...meta });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).end('Method not allowed');
};
