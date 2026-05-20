export const config = { maxDuration: 30 };

const { kvConfigured, kvGet, kvSet, safeParse } = require('./kv');

const PIPELINE_KEY = 'pipeline:articles';

async function loadArticles() {
  const raw = await kvGet(PIPELINE_KEY);
  const parsed = safeParse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function saveArticles(articles) {
  if (!kvConfigured()) {
    const err = new Error('Pipeline persistence unavailable — KV_REST_API_URL and KV_REST_API_TOKEN must be set on Vercel');
    err.code = 'KV_NOT_CONFIGURED';
    throw err;
  }
  await kvSet(PIPELINE_KEY, JSON.stringify(articles));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const meta = { kvConfigured: kvConfigured(), persisted: kvConfigured() };

  if (req.method === 'GET') {
    try {
      const articles = await loadArticles();
      res.status(200).json({ articles, ...meta });
    } catch (err) {
      res.status(500).json({ error: err.message, ...meta, persisted: false });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const id = 'art-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const article = {
        id,
        createdAt: Date.now(),
        stage: body.stage || 'shortlisted',
        signalTitle: body.signalTitle || '',
        ideaText: body.ideaText || '',
        signalSource: body.signalSource || '',
        signalDate: body.signalDate || '',
        signalUrl: body.signalUrl || '',
        angle: body.angle || '',
        headline: body.headline || '',
        brief: body.brief || '',
        draft: body.draft || '',
        wordCount: body.wordCount || '',
        scheduledDate: body.scheduledDate || '',
        scheduledTime: body.scheduledTime || '08:00',
        blogUrl: body.blogUrl || '',
        publishedDate: body.publishedDate || '',
        linkedinDate: body.linkedinDate || '',
        notes: body.notes || '',
      };
      const articles = await loadArticles();
      articles.unshift(article);
      await saveArticles(articles);
      res.status(201).json({ article, ...meta });
    } catch (err) {
      const status = err.code === 'KV_NOT_CONFIGURED' ? 503 : 500;
      res.status(status).json({ error: err.message, ...meta, persisted: false });
    }
    return;
  }

  if (req.method === 'PATCH') {
    try {
      const body = req.body || {};
      const { id, ...updates } = body;
      if (!id) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      const articles = await loadArticles();
      const idx = articles.findIndex((a) => a.id === id);
      if (idx === -1) {
        res.status(404).json({ error: 'Article not found' });
        return;
      }
      const FIELDS = [
        'stage', 'signalTitle', 'ideaText', 'signalSource', 'signalDate',
        'signalUrl', 'angle', 'headline', 'brief', 'draft', 'wordCount',
        'scheduledDate', 'scheduledTime', 'blogUrl', 'publishedDate',
        'linkedinDate', 'notes',
      ];
      FIELDS.forEach((f) => {
        if (updates[f] !== undefined) articles[idx][f] = updates[f];
      });
      articles[idx].updatedAt = Date.now();
      await saveArticles(articles);
      res.status(200).json({ article: articles[idx], ...meta });
    } catch (err) {
      const status = err.code === 'KV_NOT_CONFIGURED' ? 503 : 500;
      res.status(status).json({ error: err.message, ...meta, persisted: false });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = req.body || {};
      if (!id) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      const articles = await loadArticles();
      const filtered = articles.filter((a) => a.id !== id);
      if (filtered.length === articles.length) {
        res.status(404).json({ error: 'Article not found' });
        return;
      }
      await saveArticles(filtered);
      res.status(200).json({ deleted: true, ...meta });
    } catch (err) {
      const status = err.code === 'KV_NOT_CONFIGURED' ? 503 : 500;
      res.status(status).json({ error: err.message, ...meta, persisted: false });
    }
    return;
  }

  res.status(405).end('Method not allowed');
};
