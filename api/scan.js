export const config = { maxDuration: 120 };

const {
  callWithWebSearch,
  extractText,
  filterVerifiedSignals,
  repairSignalsJson,
  truncateTopics,
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

// ── GG context (compact — large prompts trigger org input-token-per-minute limits) ─
const GG_CONTEXT =
  'Guest Guide Interactive: European tourism tech (Arezzo, Tuscany). AI visitor-dispersion layer over verified geospatial POI data for DMOs. Markets: Italy (Arezzo-Siena), DACH, NL, FR. Governance/evidence tool for EU tourism policy — not itineraries or marketing.';

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
      res.status(200).json({
        scans,
        kvConfigured: kvConfigured(),
        storageMode: kvConfigured() ? 'vercel_kv' : 'browser',
      });
    } catch (err) {
      res.status(200).json({
        scans: [],
        kvConfigured: kvConfigured(),
        storageMode: kvConfigured() ? 'vercel_kv' : 'browser',
        error: err.message,
      });
    }
    return;
  }

  // ── PATCH /api/scan — update a signal's status ────────────────────────────
  // Body: { scanKey, signalId, status }
  if (req.method === 'PATCH') {
    try {
      if (!kvConfigured()) {
        res.status(200).json({
          ok: true,
          kvConfigured: false,
          storageMode: 'browser',
          hint: 'Status updated in this browser session only.',
        });
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

    // 14-day recency guardrail — aligned to twice-weekly publishing cadence
    const todayDate = new Date();
    const recencyStart = new Date(todayDate);
    recencyStart.setDate(recencyStart.getDate() - 14);
    const cutoffDate = recencyStart.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const today = todayDate.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const contentWindow = {
      days: 14,
      from: recencyStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      to: todayDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    };

    const topicsBlock = truncateTopics(existingTopics);
    const sourceFilter   = sources.length > 0 ? sources.join(', ') : 'EU policy, national DMOs, Skift, Phocuswire, major EU press';
    const macroThemes    = (body.macroThemes   || []).filter(Boolean);
    const tourismThemes  = (body.tourismThemes  || []).filter(Boolean);
    const macroFilter    = macroThemes.length   > 0 ? macroThemes.join(', ')   : '';
    const tourismFilter  = tourismThemes.length > 0 ? tourismThemes.join(', ') : '';

    const macroFlag    = macroFilter.length > 0;
    const tourismFlag  = tourismFilter.length > 0;

    const scanPrompt = `You are an intelligence analyst for Guest Guide Interactive. Today is ${today}. You have web search — use it actively (up to 5 searches).

Return exactly 5 signals, each published within the last 14 days (on or after ${cutoffDate}). Every signal must have a real URL from web search. No invented statistics or reports.

COMPANY CONTEXT: ${GG_CONTEXT}

DO NOT REPEAT already-published topics: ${topicsBlock}

━━━ PRIMARY TASK: WORLD EVENTS → TOURISM IMPACT ━━━
${macroFlag ? `WORLD EVENT THEMES SELECTED: ${macroFilter}

Search general news and current affairs for stories matching these themes FIRST, then translate their implications for European destination managers. DMO directors need to understand macro events before specialist tourism media covers them. Prioritise finding real news from the past 14 days on these topics:

${macroFilter.includes('Fuel') || macroFilter.includes('Energy') ? '⛽ FUEL & ENERGY: Search for jet fuel price movements, energy cost impacts on transport, airline profitability pressures affecting European route networks.' : ''}
${macroFilter.includes('Aviation') || macroFilter.includes('Route') ? '✈️ AVIATION & ROUTES: Search for airline route announcements, capacity changes, new or cut services to secondary European airports.' : ''}
${macroFilter.includes('Consumer') || macroFilter.includes('Inflation') ? '💶 CONSUMER SPENDING: Search for European consumer confidence data, household spending on travel, cost-of-holiday trends.' : ''}
${macroFilter.includes('Monetary') || macroFilter.includes('Interest') ? '🏦 MONETARY POLICY: Search for ECB decisions, interest rate changes and their household income effect on travel spending.' : ''}
${macroFilter.includes('Heatwave') || macroFilter.includes('Weather') ? '🌡 EXTREME WEATHER: Search for heatwaves, heat alerts, or weather disruptions affecting European tourist destinations.' : ''}
${macroFilter.includes('Wildfire') || macroFilter.includes('Flood') ? '🔥 WILDFIRE & FLOOD: Search for wildfire, flooding or natural disaster impacts on European tourism regions.' : ''}
${macroFilter.includes('Geopolit') || macroFilter.includes('Conflict') ? '🌍 GEOPOLITICS: Search for conflicts, political instability or diplomatic developments reshaping travel flows to Europe.' : ''}
${macroFilter.includes('Visa') || macroFilter.includes('Border') ? '🛂 VISA & BORDER: Search for Schengen zone changes, visa policy updates, border control announcements affecting visitor access.' : ''}
${macroFilter.includes('EU Reg') || macroFilter.includes('Legislat') ? '⚖️ EU REGULATION: Search for new EU directives or legislation affecting short-term rentals, aviation, hospitality or tourism.' : ''}
${macroFilter.includes('Platform') || macroFilter.includes('AI') ? '📱 PLATFORM & AI: Search for OTA policy changes, AI search developments, or technology shifts affecting travel discovery.' : ''}
${macroFilter.includes('Currency') || macroFilter.includes('Exchange') ? '💱 CURRENCY: Search for sterling/euro/dollar movements and their effect on inbound European tourism affordability.' : ''}
${macroFilter.includes('Recession') || macroFilter.includes('Cost of Living') ? '📉 COST OF LIVING: Search for recession signals, consumer debt, or discretionary income shifts affecting holiday demand.' : ''}
${macroFilter.includes('Road') || macroFilter.includes('Rail') ? '🚗 ROAD & RAIL: Search for fuel cost impacts on drive-to tourism, rail capacity changes, or intermodal travel shifts.' : ''}
${macroFilter.includes('Infrastructure') || macroFilter.includes('Investment') ? '🏗 INFRASTRUCTURE: Search for major transport, hospitality or destination infrastructure investments or cancellations.' : ''}
${macroFilter.includes('Retail') || macroFilter.includes('Hospitality') ? '🛍 RETAIL & HOSPITALITY: Search for consumer retail trends, restaurant/hotel closures or openings, visitor economy data.' : ''}

Primary search sources for macro themes: Reuters, AP, BBC News, Financial Times, Politico Europe, Euractiv, ARD, NOS, Le Monde, Frankfurter Allgemeine, ECB, Eurostat, Copernicus Climate Service.` : ''}

${tourismFlag ? `TOURISM INDUSTRY THEMES: ${tourismFilter}
${macroFlag ? 'Use these to supplement macro signals if needed to reach 5 total.' : 'Search tourism-native sources for signals on these themes.'} Sources: Skift, Phocuswire, ETC, national DMO announcements, WTTC, Euromonitor, national tourism ministries.` : ''}

${!macroFlag && !tourismFlag ? `Cast wide across both macro news (transport, energy, consumer economics, climate, geopolitics) and tourism-native sources. Prioritise macro events with clear, unaddressed implications for European destination management.` : ''}

Additional sources to consider: ${sourceFilter}.

━━━ GGI POSITIONING ANGLES ━━━
For each signal's "positioning" field, choose the strongest of:
A) GOVERNANCE GAP — story reveals a decision being made without territorial intelligence. Guest Guide provides that layer.
B) REDISTRIBUTION EVIDENCE — story shows flows concentrating where they should not, or bypassing places that are ready. Guest Guide produces the evidence EU funders require.
C) OPERATOR VISIBILITY — story shows demand that cannot reach the operators who would serve it. Guest Guide is the routing layer.

━━━ OUTPUT FORMAT ━━━
Raw JSON array only. No markdown. No backticks. No prose before or after.
Every string value on one line. No trailing commas.
Reject any signal without a real, working URL from your search.
Fields: id (short slug), type (policy|ai|ota|dmo|market|research), typeLabel, badge (badge-policy|badge-ai|badge-ota|badge-dmo|badge-market|badge-research), title (≤85 chars), source, date, url (real URL from search), relevance (integer 70-99), summary (≤175 chars with specific fact or data point), ideas (2 objects: {text, angle}), positioning (≤130 chars using one GGI angle).

Example:
{"id":"fuel-routes-2026","type":"market","typeLabel":"Transport Economics","badge":"badge-market","title":"Fuel Cost Spike Forces Ryanair to Cut 12 Peripheral European Routes","source":"Reuters","date":"19 May 2026","url":"https://www.reuters.com/business/ryanair-route-cuts","relevance":92,"summary":"Ryanair cuts 12 secondary airport routes citing 18% jet fuel cost increase, disproportionately hitting peripheral destinations.","ideas":[{"text":"When Airlines Cut Routes, Who Protects the Destination?","angle":"Governance gap — peripheral destinations need verified territorial data to survive air connectivity loss"},{"text":"The Hidden Cost of Fuel Prices: Rural Tourism Loses Its Runway","angle":"Redistribution evidence — destinations with ground-truth operator data can pivot to drive-to demand"}],"positioning":"Governance gap: losing air access means destinations need verified operator data to redirect demand to ground-level experiences — exactly what GG provides."}

Search now and return the JSON array:`;

        const data = await callWithWebSearch(apiKey, {
      messages: [{ role: 'user', content: scanPrompt }],
      maxTokens: 4096,
      maxRounds: 3,
      maxUses: 5,
    });

    const jsonText = extractText(data);
    if (!jsonText) throw new Error('No text response from intelligence scan');

    let signals = repairSignalsJson(jsonText);

    // Sequential URL checks — avoids burst traffic; scan already consumed most TPM budget
    const { kept, rejected } = await filterVerifiedSignals(signals, { sequential: true });
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
    const localKey = persisted
      ? scanKey
      : `scan:local-${now.getTime()}`;
    if (persisted) {
      await kvSet(scanKey + ':summary', JSON.stringify(summary));
      await kvSet(scanKey + ':signals', JSON.stringify(signals));
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({
      signals,
      key: persisted ? scanKey : localKey,
      dateLabel,
      persisted,
      kvConfigured: persisted,
      storageMode: persisted ? 'vercel_kv' : 'browser',
      contentWindow,
      integrity: { rejectedCount: rejected.length, rejected },
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
    return;
  }
};
