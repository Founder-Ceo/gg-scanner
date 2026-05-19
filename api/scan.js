export const config = { maxDuration: 120 };

const {
  callWithWebSearch,
  extractText,
  filterVerifiedSignals,
  repairSignalsJson,
} = require('./integrity');

// ── Upstash KV helpers (raw REST — @vercel/kv must never be imported) ─────────
// KV is optional: scan works without it (no history persistence). Only HTTP failures throw.
function kvConfigured() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvSet(key, value) {
  if (!kvConfigured()) return null;
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`KV set failed: ${res.status}`);
  return res.json();
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
  return data.result;          // null if key does not exist
}

async function kvList(prefix) {
  if (!kvConfigured()) return [];
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const res = await fetch(`${url}/keys/${encodeURIComponent(prefix + '*')}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`KV list failed: ${res.status}`);
  const data = await res.json();
  return data.result || [];
}

// ── GG context strings ────────────────────────────────────────────────────────
const GG_CONTEXT = `Guest Guide Interactive is a European tourism technology company founded by Walt Cudlip, based in Arezzo, Tuscany. The platform uses AI-driven visitor dispersion technology — operating as an intelligence layer over a verified, locally curated geospatial dataset — to help DMOs redirect visitor flows from overcrowded areas toward under-visited destinations, authentic operators, and off-season periods. The platform's defensive moat is its verified, structured, geospatially addressed POI database (agriturismi, local guides, artisans, cultural sites).

Target customers: DMOs and regional tourism boards (Segment A), authentic local operators (Segment B), travellers seeking authentic experiences (Segment C). Primary markets: Italy (Arezzo-Siena corridor pilot active), DACH region (priority expansion), Netherlands, France. Pre-revenue, actively fundraising €3.5M Seed/Series A. In dialogue with Visit Tuscany and Fondazione Arezzo Intour.

Policy alignment: EU Transition Pathway for Tourism, Interreg Central Europe Priority 2, NBTC Perspective 2030, ENIT national frameworks. Core claim: produces redistribution evidence that EU funding bodies require — not just redistribution itself. This is a governance tool, not a marketing or itinerary tool.`;

const DEFAULT_EXISTING_TOPICS = `Already published (do not repeat): overtourism intro, slow travel intro, SaaS market sizing for DMOs, social licence/resident voice, founder origin story, data-driven tourism, wellness travel demand, resident backlash (Barcelona/Venice), investor market sizing (Trillion-dollar), DMO digital tools vs campaigns, temporary resident traveller framing, heritage preservation vs prosperity, startup-policy nexus, EU Green Deal dispersion mandates, DMO analytics testing, spatial governance flagship (Counting Visitors to Controlling Flows), Italian mid-cities dispersion (Arezzo Is Not Venice), slow tourism infrastructure (What Slow Tourism Requires), ETC Barometer demand shift (Long-Haul Traveller), ENIT Italian tools gap, OTA vs governance accountability (Booking.com Crowd Avoidance), EU startup single market (EU Inc), operator economics/OTA costs (Hidden Tax on Operators), islands and villages excluded from frameworks, rural tourism digital infrastructure gap.`;

// ── Safe JSON parse helper — handles double-serialised KV values ──────────────
function safeParseKv(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw;   // already parsed by Upstash client
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (_) { return raw; }
  }
  return raw;
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // ── GET /api/scan — return saved scan history ─────────────────────────────
  if (req.method === 'GET') {
    try {
      const keys = await kvList('scan:');
      // Filter to only summary keys (not the full signal payloads)
      const summaryKeys = keys.filter(k => k.endsWith(':summary'));
      const scans = [];
      for (const key of summaryKeys) {
        try {
          const raw = await kvGet(key);
          const summary = safeParseKv(raw);
          if (summary && summary.key) scans.push(summary);
        } catch (_) {}
      }
      // Sort newest first
      scans.sort((a, b) => (b.date || 0) - (a.date || 0));
      res.status(200).json({ scans });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // ── PATCH /api/scan — update a signal's status ────────────────────────────
  // Body: { scanKey, signalId, status }
  if (req.method === 'PATCH') {
    try {
      if (!kvConfigured()) {
        res.status(503).json({ error: 'Scan persistence unavailable (KV not configured on server)' });
        return;
      }
      const { scanKey, signalId, status } = req.body || {};
      if (!scanKey || !signalId || !status) {
        res.status(400).json({ error: 'scanKey, signalId and status are required' }); return;
      }
      const signalsKey = scanKey + ':signals';
      const raw = await kvGet(signalsKey);
      const signals = safeParseKv(raw);
      if (!Array.isArray(signals)) {
        res.status(404).json({ error: 'Scan signals not found' }); return;
      }
      const idx = signals.findIndex(s => s.id === signalId);
      if (idx === -1) {
        res.status(404).json({ error: 'Signal not found' }); return;
      }
      signals[idx].status = status;
      await kvSet(signalsKey, JSON.stringify(signals));
      res.status(200).json({ ok: true, signal: signals[idx] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // ── POST /api/scan — run a new intelligence scan ──────────────────────────
  if (req.method !== 'POST') {
    res.status(405).end('Method not allowed'); return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' }); return;
  }

  try {
    const body = req.body || {};
    const { sources = [], themes = [] } = body;

    // Load published topics from config KV when available — else hardcoded default
    let existingTopics = DEFAULT_EXISTING_TOPICS;
    if (kvConfigured()) {
      try {
        const cfgRaw = await kvGet('config:published-topics');
        const cfgVal = safeParseKv(cfgRaw);
        if (typeof cfgVal === 'string' && cfgVal.trim()) {
          existingTopics = cfgVal;
        } else if (cfgVal && typeof cfgVal.publishedTopics === 'string') {
          existingTopics = cfgVal.publishedTopics;
        }
      } catch (_) {}
    }

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const cutoffDate = threeMonthsAgo.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const scanPrompt = `You are a senior intelligence analyst for Guest Guide Interactive. Today is ${today}.

Your task: conduct LIVE WEB SEARCH across current European tourism intelligence sources and return 5–7 verified signals Guest Guide has NOT yet written about. You MUST use web search — do not rely on training data, do not invent reports, statistics, or URLs.

DATE CONSTRAINT: Only include signals published or released after ${cutoffDate}. Skip anything older.

COMPANY CONTEXT: ${GG_CONTEXT}

TOPICS ALREADY COVERED — DO NOT REPEAT: ${existingTopics}

SOURCE CATEGORIES: EU Commission, EU Parliament, ETC, UN Tourism, Interreg, NBTC Netherlands, ENIT Italy, Germany Tourism, VisitBritain, Visit Norway, Visit Sweden, Skift, Phocuswire, Phocuswright, Travel Weekly, BBC, The Guardian, Le Monde, Frankfurter Allgemeine, Süddeutsche Zeitung, El País, Wall Street Journal, Travel + Leisure, Condé Nast Traveller, NatGeo Traveller, WTTC, McKinsey Travel, PwC Hospitality, Euromonitor, Our World In Data, ECTN, ETOA, LEADER Programme, Ruraltour EU.

Selected sources: ${sources.length > 0 ? sources.join(', ') : 'cast wide across all categories'}
Selected themes: ${themes.length > 0 ? themes.join(', ') : 'all'}

PRIORITY GAPS: Nordic coolcation governance, platform dependency risk, spatial intelligence in DMOs, traveller behavioural research, DACH market tourism policy, consumer magazine 2026 trends.

SEARCH RULES:
1. Search the web for each signal — every signal needs a real URL you found via search.
2. The url field MUST be the exact live page URL of the primary source (not a homepage unless the story is there).
3. Do not include signals you cannot verify with a working URL.
4. Do not fabricate future reports, McKinsey studies, or statistics — only what exists on the live web.
5. Each signal needs a named organisation, specific date, and concrete finding with a data point where possible.

OUTPUT: JSON array of 5–7 signals. RULES: raw JSON array ONLY, no markdown, no backticks, no prose before or after. Every string value on ONE line — no newlines inside strings. No trailing commas. title max 85 chars, summary max 175 chars, positioning max 130 chars, angle max 70 chars. type must be one of: policy, ai, ota, dmo, market, research. badge must be one of: badge-policy, badge-ai, badge-ota, badge-dmo, badge-market, badge-research. relevance must be integer 70-99. Each signal must have a unique id field (short slug). url is REQUIRED on every signal.

EXAMPLE (one correctly formatted object):
{"id":"example-slug","type":"market","typeLabel":"Consumer Trend","badge":"badge-market","title":"Signal title here","source":"Source org","date":"Mar 2026","url":"https://www.example.com/real-article-path/","relevance":85,"summary":"Factual 1-2 sentence summary with specific data point from the source page.","ideas":[{"text":"Article title option 1","angle":"GG angle here"},{"text":"Article title option 2","angle":"GG angle here"}],"positioning":"How GG positions relative to this signal."}

Search the web and produce the full JSON array now:`;

    const data = await callWithWebSearch(apiKey, {
      messages: [{ role: 'user', content: scanPrompt }],
      maxTokens: 6000,
      maxRounds: 6,
    });

    const jsonText = extractText(data);
    if (!jsonText) throw new Error('No text response from intelligence scan');

    let signals = repairSignalsJson(jsonText);

    const { kept, rejected } = await filterVerifiedSignals(signals);
    signals = kept;

    if (signals.length === 0) {
      res.status(422).json({
        error:
          'No verifiable signals returned. Every signal must have a working source URL found via live web search.',
        rejected,
      });
      return;
    }

    // Ensure every signal has an id
    signals = signals.map((s, i) => ({
      id: s.id || `signal-${Date.now()}-${i}`,
      status: 'new',
      ...s,
    }));

    // Save to KV
    const now      = new Date();
    const scanKey  = `scan:${now.toISOString().replace(/[:.]/g, '-')}`;
    const dateLabel = now.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    const summary = {
      key:         scanKey,
      date:        now.getTime(),
      dateLabel,
      signalCount: signals.length,
      sources:     sources.slice(0, 10),
      themes:      themes.slice(0, 8),
    };

    const persisted = kvConfigured();
    if (persisted) {
      await kvSet(scanKey + ':summary', JSON.stringify(summary));
      await kvSet(scanKey + ':signals', JSON.stringify(signals));
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({
      signals,
      key: persisted ? scanKey : null,
      dateLabel,
      persisted,
      integrity: { rejectedCount: rejected.length, rejected },
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
    return;
  }
};
