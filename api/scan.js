// api/scan.js — gg-scanner
// KV via raw Upstash REST (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
// Falls back gracefully if KV unavailable — signals always returned to UI

export const config = { maxDuration: 120 };

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// ── UPSTASH REST HELPERS ──────────────────────────────────────────────────────
// Uses UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
// (set these two variables in Vercel project settings)

function kv() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('UPSTASH_REDIS_REST_URL / TOKEN not set');

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function call(path, method = 'GET', body = undefined) {
    const resp = await fetch(`${url}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    if (!resp.ok) throw new Error(`Upstash ${method} ${path} → ${resp.status}`);
    return resp.json();
  }

  return {
    async set(key, value) {
      const v = typeof value === 'string' ? value : JSON.stringify(value);
      return call(`/set/${encodeURIComponent(key)}`, 'POST', v);
    },
    async get(key) {
      const d = await call(`/get/${encodeURIComponent(key)}`);
      return d.result;
    },
    async hset(key, fields) {
      return call(`/hset/${encodeURIComponent(key)}`, 'POST', Object.entries(fields).flat());
    },
    async hgetall(key) {
      const d = await call(`/hgetall/${encodeURIComponent(key)}`);
      const r = d.result;
      if (!Array.isArray(r)) return null;
      const obj = {};
      for (let i = 0; i < r.length; i += 2) obj[r[i]] = r[i + 1];
      return obj;
    },
    async lpush(key, value) {
      return call(`/lpush/${encodeURIComponent(key)}`, 'POST', [value]);
    },
    async lrange(key, start, stop) {
      const d = await call(`/lrange/${encodeURIComponent(key)}/${start}/${stop}`);
      return d.result || [];
    },
    async ltrim(key, start, stop) {
      return call(`/ltrim/${encodeURIComponent(key)}/${start}/${stop}`, 'POST');
    }
  };
}

// ── DATE WINDOW ───────────────────────────────────────────────────────────────

function dateCtx() {
  const now    = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 90);
  const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const months = [];
  for (let i = 0; i < 3; i++) {
    const m = new Date(now);
    m.setMonth(m.getMonth() - i);
    months.push(m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }));
  }
  return {
    today:        fmt(now),
    todayISO:     now.toISOString().slice(0, 10),
    cutoffDate:   fmt(cutoff),
    cutoffISO:    cutoff.toISOString().slice(0, 10),
    currentYear:  now.getFullYear(),
    currentMonth: now.toLocaleDateString('en-GB', { month: 'long' }),
    recentMonths: months
  };
}

// ── SOURCE → QUERY MAP ────────────────────────────────────────────────────────

const SOURCE_QUERIES = {
  'EU Commission':              ['site:ec.europa.eu tourism', 'European Commission tourism policy'],
  'EU Parliament':              ['site:europarl.europa.eu tourism', 'European Parliament tourism regulation'],
  'UN Tourism':                 ['site:unwto.org', 'UNWTO tourism report'],
  'Interreg':                   ['Interreg Europe tourism project'],
  'ETC':                        ['European Travel Commission tourism'],
  'OECD Tourism':               ['OECD tourism statistics report'],
  'VisitBritain':               ['site:visitbritain.org', 'VisitBritain tourism report'],
  'Tourism Ireland':            ['site:tourismireland.com', 'Tourism Ireland strategy'],
  'ENIT Italy':                 ['site:enit.it', 'ENIT Italian tourism'],
  'Turespaña':                  ['site:tourspain.es', 'Turespaña Spain tourism'],
  'Turismo de Portugal':        ['site:turismodeportugal.pt', 'Portugal tourism statistics'],
  'Visit Greece':               ['site:visitgreece.gr', 'Greece tourism GNTO'],
  'Croatia Tourism':            ['Croatian National Tourist Board', 'Croatia HTZ tourism'],
  'NBTC Netherlands':           ['site:nbtc.nl', 'NBTC Netherlands tourism'],
  'Visit Norway':               ['site:visitnorway.com', 'Visit Norway tourism'],
  'Visit Sweden':               ['site:visitsweden.com', 'Visit Sweden tourism'],
  'Visit Denmark':              ['site:visitdenmark.com', 'VisitDenmark tourism'],
  'Visit Finland':              ['site:visitfinland.com', 'Visit Finland tourism'],
  'Germany Tourism':            ['site:germany.travel', 'DZT Germany National Tourist Board'],
  'Austria Tourism':            ['Austrian National Tourist Office ANTO'],
  'Switzerland Tourism':        ['site:myswitzerland.com', 'Switzerland Tourism'],
  'Atout France':               ['site:atout-france.fr', 'Atout France tourism'],
  'Slovenia Tourism':           ['Slovenian Tourist Board', 'Slovenia tourism'],
  'Skift':                      ['site:skift.com'],
  'Phocuswire':                 ['site:phocuswire.com'],
  'Phocuswright':               ['site:phocuswright.com'],
  'Travel Weekly':              ['site:travelweekly.com', 'site:travelweekly.co.uk'],
  'TTG Media':                  ['site:ttgmedia.com'],
  'Travel Trade Gazette':       ['site:ttglive.com'],
  'The Guardian Travel':        ['site:theguardian.com/travel'],
  'The Times Travel':           ['site:thetimes.co.uk travel'],
  'The Telegraph Travel':       ['site:telegraph.co.uk/travel'],
  'The Independent Travel':     ['site:independent.co.uk/travel'],
  'Financial Times Travel':     ['site:ft.com travel'],
  'Le Monde Voyages':           ['site:lemonde.fr voyages'],
  'Der Spiegel Reise':          ['site:spiegel.de reise'],
  'Die Zeit Reisen':            ['site:zeit.de reisen'],
  'NRC Handelsblad':            ['site:nrc.nl toerisme'],
  'El País Viajes':             ['site:elpais.com viajes'],
  'Corriere della Sera Viaggi': ['site:corriere.it viaggi'],
  'La Repubblica Viaggi':       ['site:repubblica.it viaggi'],
  'Condé Nast Traveller':       ['site:cntraveller.com'],
  'NatGeo Traveller':           ['site:nationalgeographic.com/travel'],
  'Geo Magazin (DE)':           ['site:geo.de reise'],
  'BBC Travel':                 ['site:bbc.com/travel'],
  'WTTC':                       ['site:wttc.org', 'WTTC world travel tourism council report'],
  'McKinsey Travel':            ['McKinsey travel tourism report'],
  'PwC Hospitality':            ['PwC hospitality travel report'],
  'BCG Travel':                 ['Boston Consulting Group travel tourism'],
  'Deloitte Travel':            ['Deloitte travel hospitality report'],
  'Oliver Wyman Travel':        ['Oliver Wyman travel aviation hospitality'],
  'EY Hospitality':             ['EY Ernst Young hospitality travel report'],
  'Euromonitor':                ['Euromonitor travel tourism report'],
  'Oxford Economics':           ['Oxford Economics tourism report'],
  'Our World In Data':          ['site:ourworldindata.org tourism'],
  'ECTN':                       ['European Centre for Ecological Tourism ECTN'],
  'ETOA':                       ['European Tourism Association ETOA'],
  'LEADER Programme':           ['LEADER rural tourism EU programme'],
  'Ruraltour EU':               ['rural tourism Europe slow travel']
};

const THEME_TERMS = {
  'Dispersion Policy':      ['tourism dispersion policy overtourism Europe', 'visitor flow management DMO'],
  'AI in Travel Planning':  ['AI travel planning technology tourism'],
  'Sustainable Tourism':    ['sustainable tourism policy Europe'],
  'Nordic & Coolcation':    ['coolcation tourism trend Nordic'],
  'Rural & Village Tourism': ['rural tourism Europe village slow travel'],
  'Spatial Intelligence':   ['geospatial tourism data destination intelligence'],
  'Investment & Funding':   ['tourism startup investment funding Europe'],
  'DMO Strategy':           ['destination management organisation strategy digital'],
  'Community Impact':       ['community based tourism impact Europe'],
  'Operator Economics':     ['tourism operator revenue platform commission'],
  'Platform Dependency':    ['OTA dependency tourism booking platform'],
  'Traveller Research':     ['traveller behaviour research consumer trends'],
  'DACH Market':            ['German tourism market DACH Austria Switzerland']
};

function buildQueries(sources, themes, dc) {
  const q   = new Set();
  const my  = `${dc.currentMonth} ${dc.currentYear}`;
  const yr  = String(dc.currentYear);

  sources.forEach(src => {
    const sq = SOURCE_QUERIES[src];
    if (sq) sq.forEach((s, i) => q.add(i === 0 ? `${s} ${my}` : `${s} ${yr}`));
  });

  const active = themes.length > 0 ? themes : Object.keys(THEME_TERMS);
  active.forEach(t => {
    const key = t.replace(/^[\p{Emoji}\s]+/u, '').trim();
    const terms = THEME_TERMS[key] || THEME_TERMS[t];
    if (terms) q.add(`${terms[0]} ${my}`);
  });

  q.add(`European tourism news ${my}`);
  q.add(`sustainable travel policy Europe ${yr}`);
  return [...q].slice(0, 5);
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: scan history ──
  if (req.method === 'GET') {
    try {
      const db   = kv();
      const keys = await db.lrange('scan:index', 0, 49);
      if (!keys || keys.length === 0) return res.status(200).json({ scans: [] });
      const scans = (await Promise.all(keys.map(async key => {
        try {
          const meta = await db.hgetall(key + ':meta');
          return { key, date: meta?.date || null, dateLabel: meta?.dateLabel || null, signalCount: parseInt(meta?.signalCount || '0') };
        } catch { return null; }
      }))).filter(Boolean);
      return res.status(200).json({ scans });
    } catch (err) {
      console.error('GET /scan error:', err.message);
      return res.status(200).json({ scans: [], error: err.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { sources = [], themes = [] } = req.body || {};
  const dc = dateCtx();

  let publishedTopics = '';
  try {
    const raw = await kv().get('config:published-topics');
    if (raw) publishedTopics = typeof raw === 'string' ? raw : JSON.stringify(raw);
  } catch { /* non-fatal */ }

  const queries = buildQueries(sources, themes, dc);

  const systemPrompt = `You are an expert intelligence analyst for Guest Guide Interactive, a European tourism technology startup based in Arezzo, Tuscany. Identify high-signal news, reports, policy developments, and research relevant to European tourism technology, DMO strategy, sustainable travel, and AI-assisted destination management.

RECENCY — NON-NEGOTIABLE:
Today: ${dc.today}. Window opens: ${dc.cutoffDate}.
Only surface signals published ON OR AFTER ${dc.cutoffDate}. Discard anything older or undatable.

GUEST GUIDE CONTEXT:
Pre-revenue startup. AI-driven intelligence layer over verified, locally curated geospatial POI database. Core value: dispersion of tourist flows toward authentic slow-tourism experiences. Product: dashboard for DMOs. Primary: Italy. Secondary: DACH, Netherlands, France, Spain, Portugal, UK/Ireland, Greece, Adriatic.

AUDIENCES: (1) DMO directors — policy, strategy, dispersion, digital tools. (2) Tourism operators — market shifts, platform economics. (3) Investors — market size, policy tailwinds.

PUBLISHED TOPICS TO EXCLUDE:
${publishedTopics || '(none)'}

OUTPUT — CRITICAL:
Your ENTIRE response must be a raw JSON array. Start with [ and end with ]. No prose, no markdown, no triple backticks before or after. Begin immediately with [.

Return exactly 5 signal objects:
[
  {
    "id": "sig_[8 alphanumeric]",
    "title": "Source headline or close paraphrase",
    "source": "Publication name",
    "date": "DD Mon YYYY — must be within last 90 days. Omit signal if undatable.",
    "url": "Verified URL only. Omit field if unverifiable.",
    "type": "policy|research|market|ai|dmo|operator",
    "typeLabel": "Policy|Research|Market|AI & Tech|DMO Strategy|Operator",
    "badge": "badge-policy|badge-research|badge-market|badge-ai|badge-dmo|badge-market",
    "relevance": 85,
    "summary": "2 sentences. Factual. Attribute claims to source.",
    "ideas": [
      { "text": "Article idea — specific, 8-15 words", "angle": "Guest Guide angle — 1 sentence" },
      { "text": "Second article idea — different angle on same signal, 8-15 words", "angle": "Guest Guide angle — 1 sentence" }
    ],
    "positioning": "2 sentences on strategic relevance to Guest Guide Interactive."
  }
]`;

  const userMsg = `Scan for Guest Guide Interactive.

TODAY: ${dc.today}
WINDOW: On or after ${dc.cutoffDate} (90 days)
PRIORITISE: ${dc.recentMonths[0]} and ${dc.recentMonths[1]}
SOURCES: ${sources.length > 0 ? sources.join(', ') : 'All'}
THEMES: ${themes.length > 0 ? themes.join(', ') : 'All'}

SEARCH QUERIES:
${queries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Verify each result: date within 90 days, URL real. Discard if either fails.
Return exactly 5 signals. Start your response with [ and nothing else.`;

  try {
    const aiResp = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 6000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }]
      })
    });

    if (!aiResp.ok) throw new Error(`Anthropic ${aiResp.status}: ${await aiResp.text()}`);

    const data    = await aiResp.json();
    const rawText = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    if (!rawText) throw new Error('No text content returned from AI');

    // Robust extraction — find outermost [ ... ]
    let signals;
    try {
      const first = rawText.indexOf('[');
      const last  = rawText.lastIndexOf(']');
      if (first === -1 || last <= first) throw new Error('No JSON array found in response');
      signals = JSON.parse(rawText.slice(first, last + 1));
      if (!Array.isArray(signals)) throw new Error('Parsed value is not an array');
    } catch (e) {
      console.error('Parse error:', e.message, '| Preview:', rawText.slice(0, 200));
      throw new Error('Failed to parse signals: ' + e.message);
    }

    // Server-side 90-day filter
    const cutoff = new Date(dc.cutoffISO).getTime();
    signals = signals.filter(s => {
      if (!s.date) return false;
      const p = new Date(s.date);
      if (isNaN(p.getTime())) {
        const y = s.date.match(/\b(202\d)\b/);
        return y && parseInt(y[1]) >= dc.currentYear - 1;
      }
      return p.getTime() >= cutoff;
    });

    if (signals.length === 0) {
      return res.status(200).json({ signals: [], key: null, error: `No signals within 90-day window (since ${dc.cutoffDate}). Try broadening sources or themes.` });
    }

    signals = signals.map((s, i) => ({ ...s, id: s.id || `sig_${Date.now()}_${i}`, status: 'new' }));

    // ── KV STORAGE — non-fatal ────────────────────────────────────────────────
    const now       = new Date();
    const scanKey   = `scan:${now.toISOString().slice(0, 10)}_${Date.now()}`;
    const dateLabel = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    let storageError = null;

    try {
      const db = kv();
      await db.set(scanKey, { signals, dateLabel, date: now.toISOString() });
      await db.hset(scanKey + ':meta', { date: now.toISOString(), dateLabel, signalCount: String(signals.length) });
      await db.lpush('scan:index', scanKey);
      await db.ltrim('scan:index', 0, 99);
    } catch (kvErr) {
      console.error('KV storage error (non-fatal):', kvErr.message);
      storageError = kvErr.message;
    }

    return res.status(200).json({
      signals,
      key:          storageError ? null : scanKey,
      dateLabel,
      storageError: storageError || undefined,
      contentWindow: { from: dc.cutoffDate, to: dc.today, days: 90 }
    });

  } catch (err) {
    console.error('Scan error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
