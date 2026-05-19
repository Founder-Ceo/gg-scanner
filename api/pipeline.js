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

async function loadArticles() {
  const raw = await kvGet('pipeline:articles');
  const parsed = safeParse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function saveArticles(articles) {
  await kvSet('pipeline:articles', JSON.stringify(articles));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (req.method === 'GET') {
    try {
      const articles = await loadArticles();
      res.status(200).json({ articles });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const id = 'art-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const article = {
        id,
        createdAt:     Date.now(),
        stage:         body.stage         || 'shortlisted',
        signalTitle:   body.signalTitle   || '',
        ideaText:      body.ideaText      || '',
        signalSource:  body.signalSource  || '',
        signalDate:    body.signalDate    || '',
        signalUrl:     body.signalUrl     || '',
        angle:         body.angle         || '',
        headline:      body.headline      || '',
        brief:         body.brief         || '',
        wordCount:     body.wordCount     || '',
        scheduledDate: body.scheduledDate || '',
        scheduledTime: body.scheduledTime || '08:00',
        blogUrl:       body.blogUrl       || '',
        publishedDate: body.publishedDate || '',
        linkedinDate:  body.linkedinDate  || '',
        notes:         body.notes         || '',
      };
      const articles = await loadArticles();
      articles.unshift(article);
      await saveArticles(articles);
      res.status(201).json({ article });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  if (req.method === 'PATCH') {
    try {
      const body = req.body || {};
      const { id, ...updates } = body;
      if (!id) { res.status(400).json({ error: 'id is required' }); return; }
      const articles = await loadArticles();
      const idx = articles.findIndex(a => a.id === id);
      if (idx === -1) { res.status(404).json({ error: 'Article not found' }); return; }
      const FIELDS = ['stage','signalTitle','ideaText','signalSource','signalDate',
        'signalUrl','angle','headline','brief','wordCount','scheduledDate',
        'scheduledTime','blogUrl','publishedDate','linkedinDate','notes'];
      FIELDS.forEach(f => { if (updates[f] !== undefined) articles[idx][f] = updates[f]; });
      articles[idx].updatedAt = Date.now();
      await saveArticles(articles);
      res.status(200).json({ article: articles[idx] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = req.body || {};
      if (!id) { res.status(400).json({ error: 'id is required' }); return; }
      const articles = await loadArticles();
      const filtered = articles.filter(a => a.id !== id);
      if (filtered.length === articles.length) {
        res.status(404).json({ error: 'Article not found' }); return;
      }
      await saveArticles(filtered);
      res.status(200).json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).end('Method not allowed');
};
