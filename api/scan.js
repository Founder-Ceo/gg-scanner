// api/scan.js — gg-scanner
// KV via raw Upstash REST (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
// Falls back gracefully if KV unavailable — signals always returned to UI

export const config = { maxDuration: 120 };

const { callWithWebSearch, extractText } = require('./integrity');

// ── KV via shared helpers (accepts KV_REST_API_* or UPSTASH_REDIS_REST_*) ─────
// Storage schema is shared with api/signals.js: scan:<id>:summary + scan:<id>:signals
const { kvConfigured, kvGet, kvSet, kvList, safeParse } = require('./kv');

function kvMode() {
  return kvConfigured() ? 'vercel_kv' : 'browser';
}

// ── DATE WINDOW ───────────────────────────────────────────────────────────────

function dateCtx() {
  const now    = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 14);
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
  'Interreg':                   ['site:interregeurope.eu tourism', 'Interreg Europe tourism project'],
  'ETC':                        ['site:etc-corporate.org', 'European Travel Commission tourism'],
  'OECD Tourism':               ['site:oecd.org tourism', 'OECD tourism statistics report'],
  'VisitBritain':               ['site:visitbritain.org', 'VisitBritain tourism report'],
  'Tourism Ireland':            ['site:tourismireland.com', 'Tourism Ireland strategy'],
  'ENIT Italy':                 ['site:enit.it', 'ENIT Italian tourism'],
  'Turespaña':                  ['site:tourspain.es', 'Turespaña Spain tourism'],
  'Turismo de Portugal':        ['site:turismodeportugal.pt', 'Portugal tourism statistics'],
  'Visit Greece':               ['site:visitgreece.gr', 'Greece tourism GNTO'],
  'Croatia Tourism':            ['site:croatia.hr tourism', 'Croatian National Tourist Board'],
  'NBTC Netherlands':           ['site:nbtc.nl', 'NBTC Netherlands tourism'],
  'Visit Norway':               ['site:visitnorway.com', 'Visit Norway tourism'],
  'Visit Sweden':               ['site:visitsweden.com', 'Visit Sweden tourism'],
  'Visit Denmark':              ['site:visitdenmark.com', 'VisitDenmark tourism'],
  'Visit Finland':              ['site:visitfinland.com', 'Visit Finland tourism'],
  'Germany Tourism':            ['site:germany.travel', 'DZT Germany National Tourist Board'],
  'Austria Tourism':            ['site:austria.info', 'Austrian National Tourist Office ANTO'],
  'Switzerland Tourism':        ['site:myswitzerland.com', 'Switzerland Tourism'],
  'Atout France':               ['site:atout-france.fr', 'Atout France tourism'],
  'Slovenia Tourism':           ['site:slovenia.info', 'Slovenian Tourist Board'],
  'Skift':                      ['site:skift.com'],
  'Phocuswire':                 ['site:phocuswire.com'],
  'Phocuswright':               ['site:phocuswright.com'],
  'Scoop.it':                   ['site:scoop.it tourism', 'site:scoop.it travel Europe'],
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
  'McKinsey Travel':            ['site:mckinsey.com travel tourism', 'McKinsey travel tourism report'],
  'PwC Hospitality':            ['site:pwc.com hospitality', 'PwC hospitality travel report'],
  'BCG Travel':                 ['site:bcg.com travel tourism', 'Boston Consulting Group travel tourism'],
  'Deloitte Travel':            ['site:deloitte.com travel', 'Deloitte travel hospitality report'],
  'Oliver Wyman Travel':        ['site:oliverwyman.com travel', 'Oliver Wyman travel aviation hospitality'],
  'EY Hospitality':             ['site:ey.com hospitality travel', 'EY Ernst Young hospitality travel report'],
  'Euromonitor':                ['site:euromonitor.com travel tourism', 'Euromonitor travel tourism report'],
  'Oxford Economics':           ['site:oxfordeconomics.com travel', 'Oxford Economics tourism report'],
  'Our World In Data':          ['site:ourworldindata.org tourism'],
  'ECTN':                       ['site:ectn.eu', 'European Centre for Ecological Tourism ECTN'],
  'ETOA':                       ['site:etoa.org', 'European Tourism Association ETOA'],
  'LEADER Programme':           ['site:enrd.ec.europa.eu leader tourism', 'LEADER rural tourism EU programme'],
  'Ruraltour EU':               ['site:ruraltourism.eu', 'rural tourism Europe slow travel'],
  'Academic Tourism Research':  ['site:ejts.ue-varna.bg', 'open access tourism research journal Europe university']
};

// ── SOURCE → ALLOWED HOSTS (allowlist enforcement) ─────────────────────────────
// Sidebar sources are wired to their publishers. A signal whose URL host is on
// this list (for the sources you selected) is kept. Anything else counts as an
// "extended" source and must pass the accessibility check (no paywall/gate).

const SOURCE_DOMAINS = {
  'EU Commission':              ['ec.europa.eu'],
  'EU Parliament':              ['europarl.europa.eu'],
  'UN Tourism':                 ['unwto.org', 'web.unwto.org'],
  'Interreg':                   ['interregeurope.eu', 'interreg.eu'],
  'ETC':                        ['etc-corporate.org', 'visiteurope.com'],
  'OECD Tourism':               ['oecd.org'],
  'VisitBritain':               ['visitbritain.org', 'visitbritain.com'],
  'Tourism Ireland':            ['tourismireland.com', 'ireland.com'],
  'ENIT Italy':                 ['enit.it'],
  'Turespaña':                  ['tourspain.es', 'spain.info'],
  'Turismo de Portugal':        ['turismodeportugal.pt', 'visitportugal.com'],
  'Visit Greece':               ['visitgreece.gr', 'gnto.gr'],
  'Croatia Tourism':            ['croatia.hr', 'htz.hr'],
  'NBTC Netherlands':           ['nbtc.nl', 'holland.com'],
  'Visit Norway':               ['visitnorway.com', 'visitnorway.no'],
  'Visit Sweden':               ['visitsweden.com'],
  'Visit Denmark':              ['visitdenmark.com', 'visitdenmark.dk'],
  'Visit Finland':              ['visitfinland.com', 'visitfinland.fi'],
  'Germany Tourism':            ['germany.travel'],
  'Austria Tourism':            ['austria.info'],
  'Switzerland Tourism':        ['myswitzerland.com'],
  'Atout France':               ['atout-france.fr', 'rendezvousenfrance.com'],
  'Slovenia Tourism':           ['slovenia.info', 'slovenia.si'],
  'Skift':                      ['skift.com'],
  'Phocuswire':                 ['phocuswire.com'],
  'Phocuswright':               ['phocuswright.com'],
  'Scoop.it':                   ['scoop.it'],
  'Travel Weekly':              ['travelweekly.com', 'travelweekly.co.uk'],
  'TTG Media':                  ['ttgmedia.com'],
  'Travel Trade Gazette':       ['ttglive.com'],
  'The Guardian Travel':        ['theguardian.com'],
  'The Times Travel':           ['thetimes.co.uk', 'thetimes.com'],
  'The Telegraph Travel':       ['telegraph.co.uk'],
  'The Independent Travel':    ['independent.co.uk'],
  'Financial Times Travel':     ['ft.com'],
  'Le Monde Voyages':           ['lemonde.fr'],
  'Der Spiegel Reise':          ['spiegel.de'],
  'Die Zeit Reisen':            ['zeit.de'],
  'NRC Handelsblad':            ['nrc.nl'],
  'El País Viajes':             ['elpais.com'],
  'Corriere della Sera Viaggi': ['corriere.it'],
  'La Repubblica Viaggi':       ['repubblica.it'],
  'Condé Nast Traveller':       ['cntraveller.com'],
  'NatGeo Traveller':           ['nationalgeographic.com'],
  'Geo Magazin (DE)':           ['geo.de'],
  'BBC Travel':                 ['bbc.com', 'bbc.co.uk'],
  'WTTC':                       ['wttc.org'],
  'McKinsey Travel':            ['mckinsey.com'],
  'PwC Hospitality':            ['pwc.com'],
  'BCG Travel':                 ['bcg.com'],
  'Deloitte Travel':            ['deloitte.com'],
  'Oliver Wyman Travel':        ['oliverwyman.com'],
  'EY Hospitality':             ['ey.com'],
  'Euromonitor':                ['euromonitor.com'],
  'Oxford Economics':           ['oxfordeconomics.com'],
  'Our World In Data':          ['ourworldindata.org'],
  'ECTN':                       ['ectn.eu'],
  'ETOA':                       ['etoa.org'],
  'LEADER Programme':           ['enrd.ec.europa.eu'],
  'Ruraltour EU':               ['ruraltourism.eu'],
  'Academic Tourism Research':  ['ejts.ue-varna.bg', 'core.ac.uk', 'oapen.org', 'doaj.org']
};

// Domains that are never surfaced, regardless of selection or accessibility.
const BLOCKED_DOMAINS = ['travelandtourworld.com', 't-online.de'];

// ── ACCESSIBILITY CHECK (gate/paywall detection) ──────────────────────────────

const GATED_PATTERNS = /(paywall|subscribe to (continue|read|view)|subscription (required|to read)|sign in to (continue |read|view)|register to read|premium (content|article)|create a (free )?account to (continue|read|view)|purchase to read|unlock this (article|story)|metered article|subscriber-only|abo|anmeldung erforderlich|registrierung erforderlich|contenu premium)/i;

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return null; }
}

function hostMatches(host, domains) {
  if (!host) return false;
  for (const d of domains) {
    if (host === d || host.endsWith('.' + d)) return true;
  }
  return false;
}

// Fetches the URL to determine whether the full article is freely accessible.
// Returns { reachable, gated, reason }. Non-2xx responses, paywall markers in
// the HTML, or fetch failures all count as gated — conservative by design,
// because an inaccessible source is exactly how drift and hallucination start.
async function checkAccess(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8'
      }
    });
    clearTimeout(timer);
    if ([401, 402, 403].includes(resp.status)) return { reachable: true, gated: true, reason: 'HTTP ' + resp.status + ' (auth required)' };
    if (!resp.ok) return { reachable: false, gated: true, reason: 'HTTP ' + resp.status };
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('pdf')) return { reachable: true, gated: false, reason: 'open PDF' };
    if (!ct.includes('html')) return { reachable: true, gated: false, reason: ct || 'non-HTML' };
    const body = (await resp.text()).slice(0, 40000);
    const m = body.match(GATED_PATTERNS);
    if (m) return { reachable: true, gated: true, reason: 'gate marker: "' + m[0] + '"' };
    return { reachable: true, gated: false, reason: 'open HTML' };
  } catch (e) {
    return { reachable: false, gated: true, reason: (e && e.name === 'AbortError') ? 'timeout' : (e && e.message) || 'fetch failed' };
  }
}

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

  // Broad fallback queries are only added when NO explicit sources were
  // selected. With an explicit source selection they were pulling in off-list
  // publications (e.g. German consumer news portals) that were never asked for.
  if (sources.length === 0) {
    q.add(`European tourism news ${my}`);
    q.add(`sustainable travel policy Europe ${yr}`);
  }
  return [...q].slice(0, 8);
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
      if (!kvConfigured()) return res.status(200).json({ scans: [], storageMode: 'browser' });
      const keys = await kvList('scan:');
      const summaryKeys = keys.filter((k) => k.endsWith(':summary'));
      const scans = [];
      for (const k of summaryKeys.slice(0, 50)) {
        try {
          const summary = safeParse(await kvGet(k));
          if (summary && summary.key) scans.push(summary);
        } catch { /* skip unreadable entry */ }
      }
      scans.sort((a, b) => (b.date || 0) - (a.date || 0));
      return res.status(200).json({ scans, storageMode: 'vercel_kv' });
    } catch (err) {
      console.error('GET /scan error:', err.message);
      return res.status(200).json({ scans: [], error: err.message, storageMode: kvMode() });
    }
  }

  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'MISTRAL_API_KEY not configured' });

  const { sources = [], themes = [] } = req.body || {};
  const dc = dateCtx();

  let publishedTopics = '';
  try {
    if (kvConfigured()) {
      const raw = await kvGet('config:published-topics');
      const parsed = safeParse(raw);
      if (typeof parsed === 'string' && parsed.trim()) publishedTopics = parsed;
      else if (parsed && typeof parsed.publishedTopics === 'string') publishedTopics = parsed.publishedTopics;
    }
  } catch { /* non-fatal */ }

  const queries = buildQueries(sources, themes, dc);

  const selectedHosts = new Set();
  sources.forEach(src => (SOURCE_DOMAINS[src] || []).forEach(d => selectedHosts.add(d)));
  const blockedHosts = new Set(BLOCKED_DOMAINS);

  const systemPrompt = `You are an expert intelligence analyst for Guest Guide Interactive, a European tourism technology startup based in Arezzo, Tuscany. Identify high-signal news, reports, policy developments, and research relevant to European tourism technology, DMO strategy, sustainable travel, and AI-assisted destination management.

RECENCY — NON-NEGOTIABLE:
Today: ${dc.today}. Window opens: ${dc.cutoffDate}.
Only surface signals published ON OR AFTER ${dc.cutoffDate}. Discard anything older or undatable.

SOURCE DISCIPLINE — NON-NEGOTIABLE:
PRIORITISE the listed sources in the user message. Signals published by those sources are always preferred.
You may also include reputable additional publications relevant to the tourism industry — including open-access academic and tertiary-institution tourism research (university tourism research centres, open-access journals, institutional repositories) — BUT ONLY if their articles are freely accessible in full, with no paywall, subscription, registration wall, or login gate.
A headline behind a gate is worthless to us: if you cannot verify the full article is openly readable, discard the signal. Mark any signal you are not certain about as gated: true — conservative marking is safe, padding is not.
Never cite or surface: travelandtourworld.com, t-online.de — regardless of what the search returns.

GUEST GUIDE CONTEXT:
Pre-revenue startup. AI-driven intelligence layer over verified, locally curated geospatial POI database. Core value: dispersion of tourist flows toward authentic slow-tourism experiences. Product: dashboard for DMOs. Pan-European focus across Italy, DACH, Netherlands, France, Spain, Portugal, UK/Ireland, Greece and the Adriatic — treat all markets as equally relevant. Do not rank Italy above other markets, and do not use Guest Guide's operational or fundraising stage as a lens for signal relevance or positioning notes.

AUDIENCES: (1) DMO directors — policy, strategy, dispersion, digital tools. (2) Tourism operators — market shifts, platform economics. (3) Investors — market size, policy tailwinds.

PUBLISHED TOPICS TO EXCLUDE:
${publishedTopics || '(none)'}

OUTPUT — CRITICAL:
Your ENTIRE response must be a raw JSON array. Start with [ and end with ]. No prose, no markdown, no triple backticks before or after. Begin immediately with [.

Return AT MOST 5 signal objects. Five is a MAXIMUM, not a quota. If fewer than 5 signals meet every rule (recency, source discipline, open access), return fewer — never pad, never substitute off-list or gated publications:
[
  {
    "id": "sig_[8 alphanumeric]",
    "title": "Source headline or close paraphrase",
    "source": "Publication name",
    "date": "DD Mon YYYY — must be within last 14 days. Omit signal if undatable.",
    "url": "Verified URL of the specific article or document. Omit field if unverifiable.",
    "type": "policy|research|market|ai|dmo|operator",
    "typeLabel": "Policy|Research|Market|AI & Tech|DMO Strategy|Operator",
    "badge": "badge-policy|badge-research|badge-market|badge-ai|badge-dmo|badge-market",
    "relevance": 85,
    "gated": "true if the full article requires subscription, registration or login; false if freely accessible in full. Mark true when unsure.",
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
WINDOW: On or after ${dc.cutoffDate} (14 days)
PRIORITISE: ${dc.recentMonths[0]} and ${dc.recentMonths[1]}
SOURCES (signals from these publishers are preferred; do not substitute others unless freely accessible in full): ${sources.length > 0 ? sources.join(', ') : 'All reputable tourism sources'}
THEMES: ${themes.length > 0 ? themes.join(', ') : 'All'}

SEARCH QUERIES:
${queries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Verify each result: date within 14 days, URL real AND the full article openly accessible (no paywall or login). Discard if any check fails. Use at most 5 web searches. Return at most 5 signals — fewer is better than off-list or gated padding. Start your response with [ and nothing else.`;

  try {
    // Mistral Conversations API — web_search built-in runs server-side.
    // Domain discipline is enforced in the system prompt AND server-side below
    // (the Conversations API has no blocked_domains parameter).
    const data = await callWithWebSearch(apiKey, {
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
      maxTokens: 6000,
    });

    const rawText = extractText(data);
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

    // ── Server-side 14-day filter ─────────────────────────────────────────────
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

    // ── Server-side domain discipline + gate check ─────────────────────────────
    // Hard enforcement, not prompt enforcement:
    //   1. Blocked domains are dropped outright.
    //   2. Signals from your selected sources' hosts are kept, but flagged
    //      `gated: true` if the live page is behind a paywall/login.
    //   3. Any other host ("extended" source) is live-checked and DROPPED if
    //      gated or unreachable — no more headline-only signals you cannot read.
    const preFilterNote = [];
    signals = signals.filter(s => {
      const host = hostOf(s.url);
      if (host && hostMatches(host, [...blockedHosts])) { preFilterNote.push(`blocked: ${host}`); return false; }
      return true;
    });

    signals = await Promise.all(signals.map(async s => {
      const host = hostOf(s.url);
      if (!host) { s.sourceType = 'selected'; s.gated = true; s.gateReason = 'no usable URL'; return s; }
      s.sourceType = hostMatches(host, [...selectedHosts]) ? 'selected' : 'extended';
      const access = await checkAccess(s.url);
      s.gated = access.gated;
      s.gateReason = access.reason;
      s.accessChecked = true;
      return s;
    }));

    const dropped = [];
    signals = signals.filter(s => {
      if (s.sourceType === 'selected') return true;           // selected publishers: keep, flag if gated
      if (s.gated) { dropped.push(`${hostOf(s.url)} (${s.gateReason})`); return false; }
      return true;                                            // extended sources: open access only
    });

    if (signals.length === 0) {
      return res.status(200).json({
        signals: [],
        key: null,
        error: `No signals survived the source-discipline and open-access filters (since ${dc.cutoffDate}). ${dropped.length ? 'Dropped gated/off-list sources: ' + dropped.slice(0, 5).join('; ') : ''} Try broadening sources or themes.`,
      });
    }

    signals = signals.map((s, i) => ({ ...s, id: s.id || `sig_${Date.now()}_${i}`, status: 'new' }));

    // ── KV STORAGE — non-fatal ────────────────────────────────────────────────
    const now       = new Date();
    const scanKey   = `scan:${now.toISOString().slice(0, 10)}_${Date.now()}`;
    const dateLabel = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    let storageError = null;

    // Same schema api/signals.js reads: <scanKey>:summary + <scanKey>:signals
    if (kvConfigured()) {
      try {
        const summary = {
          key: scanKey,
          date: now.getTime(),
          dateLabel,
          signalCount: signals.length,
          sources: (req.body?.sources || []).slice(0, 10),
          themes: (req.body?.themes || []).slice(0, 8),
        };
        await kvSet(scanKey + ':summary', JSON.stringify(summary));
        await kvSet(scanKey + ':signals', JSON.stringify(signals));
      } catch (kvErr) {
        console.error('KV storage error (non-fatal):', kvErr.message);
        storageError = kvErr.message;
      }
    } else {
      storageError = 'KV not configured';
    }

    // Always return a usable key — in browser-only mode (no KV) the scan is
    // archived locally under a synthetic key, otherwise the UI's currentScanKey
    // stays null and every status update fails with "No active scan".
    const responseKey = storageError ? `scan:local-${now.getTime()}` : scanKey;

    return res.status(200).json({
      signals,
      key:          responseKey,
      dateLabel,
      storageMode:  storageError ? 'browser' : 'vercel_kv',
      storageError: storageError || undefined,
      contentWindow: { from: dc.cutoffDate, to: dc.today, days: 14 },
      filterNotes: {
        blockedDropped: preFilterNote,
        gatedDropped: dropped,
        kept: signals.map(s => ({ host: hostOf(s.url), sourceType: s.sourceType, gated: !!s.gated }))
      }
    });

  } catch (err) {
    console.error('Scan error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
