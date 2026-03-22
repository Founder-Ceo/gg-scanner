export const config = { maxDuration: 120 };

const GG_CONTEXT = `Guest Guide Interactive is a European tourism technology company founded by Walt Cudlip, based in Arezzo, Tuscany. The platform uses AI-driven visitor dispersion technology — operating as an intelligence layer over a verified, locally curated geospatial dataset — to help DMOs redirect visitor flows from overcrowded areas toward under-visited destinations, authentic operators, and off-season periods. The platform's defensive moat is its verified, structured, geospatially addressed POI database (agriturismi, local guides, artisans, cultural sites).

Target customers: DMOs and regional tourism boards (Segment A), authentic local operators (Segment B), travellers seeking authentic experiences (Segment C). Primary markets: Italy (Arezzo-Siena corridor pilot active), DACH region (priority expansion), Netherlands, France. Pre-revenue, actively fundraising €3.5M Seed/Series A. In dialogue with Visit Tuscany and Fondazione Arezzo Intour.

Policy alignment: EU Transition Pathway for Tourism, Interreg Central Europe Priority 2, NBTC Perspective 2030, ENIT national frameworks. Core claim: produces redistribution evidence that EU funding bodies require — not just redistribution itself. This is a governance tool, not a marketing or itinerary tool.`;

const SOURCE_UNIVERSE = `
POLICY & INSTITUTIONAL: EU Commission Tourism Transition Pathway, European Parliament TRAN Committee, European Travel Commission (ETC), UN Tourism / UNWTO, Interreg Central Europe, ERDF / Cohesion Fund, Eurostat, EU Smart Tourism initiative, OECD Tourism Committee

NATIONAL TOURISM BODIES — ALL EU + UK/CH: Visit Norway, Innovation Norway, Visit Sweden, Visit Denmark, Visit Finland, STF, Visit Iceland, VisitBritain, VisitEngland, Tourism Ireland, Fáilte Ireland, VisitScotland, Switzerland Tourism, Austria Tourism (Österreich Werbung), Deutsche Zentrale für Tourismus (DZT), Atout France, ENIT Italy, Turespaña, Turismo de Portugal, NBTC Netherlands, Flanders Tourism, Malta Tourism, Croatian National Tourist Board, Slovenian Tourist Board, GNTO Greece, Hungary Tourism, Czech Tourism, Polish Tourist Organisation, Romanian Tourism, Estonia/Latvia/Lithuania tourism boards

INDUSTRY PUBLICATIONS: Skift, Phocuswire, Travel Weekly UK, TTG Media, Travel + Leisure, Condé Nast Traveller (UK/FR/DE/IT/ES editions), National Geographic Traveller (UK/FR), Lonely Planet, BBC Travel, Guardian Travel, Telegraph Travel, Der Spiegel Travel, Stern Travel, Geo Magazin Germany, Le Monde Travel, Le Figaro Voyage, Corriere della Sera Viaggi, La Repubblica Viaggi, El País Viajero, El Mundo Viajes

MARKET INTELLIGENCE: Euromonitor International, IBISWorld, Statista Travel, McKinsey Tourism, Deloitte Travel, PwC Hospitality, WTTC, Oxford Economics Tourism, Mastercard Economics Institute, Our World in Data tourism statistics, Ipsos travel surveys

RURAL & VILLAGE: Ruraltour EU, LEADER Programme / Local Action Groups, EAFRD, UN Tourism Best Tourism Villages, Ruritage EU project, ECTN, Council of Europe Cultural Routes, EuroVelo

ADVOCACY & NETWORKS: ETOA, HOTREC, Slow Food Travel, WWF Sustainable Tourism, Fair Trade Tourism

SPATIAL & GEOSPATIAL: Esri/ArcGIS tourism, UN-GGIM, Copernicus EU, HERE Technologies, Foursquare location intelligence, SafeGraph mobility data`;

const EXISTING_TOPICS = `Already published (do not repeat): overtourism intro, slow travel intro, SaaS market sizing for DMOs, social licence/resident voice, founder origin story, data-driven tourism, wellness travel demand, resident backlash (Barcelona/Venice), investor market sizing (Trillion-dollar), DMO digital tools vs campaigns, temporary resident traveller framing, heritage preservation vs prosperity, startup-policy nexus, EU Green Deal dispersion mandates, DMO analytics testing, spatial governance flagship (Counting Visitors to Controlling Flows), Italian mid-cities dispersion (Arezzo Is Not Venice), slow tourism infrastructure (What Slow Tourism Requires), ETC Barometer demand shift (Long-Haul Traveller), ENIT Italian tools gap, OTA vs governance accountability (Booking.com Crowd Avoidance), EU startup single market (EU Inc).

PRIORITY GAPS TO FILL: Nordic/Scandinavian tourism growth + coolcation governance, rural tourism funding gaps + LEADER programme, operator economics (what platform invisibility costs financially), spatial intelligence in destination management, platform dependency risk (OTA lock-in from operator perspective), traveller behavioural research, islands and small community destinations excluded from Smart Tourism frameworks, DACH market tourism policy, consumer magazine trend signals (Condé Nast, NatGeo calling for 2026).`;

async function callAnthropic(apiKey, messages, maxTokens) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages
    })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return data.content?.map(b => b.type === 'text' ? b.text : '').join('') || '';
}

function repairJson(raw) {
  const m = raw.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!m) throw new Error('No JSON array found in response');
  let s = m[0];
  s = s.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, ' ');
  s = s.replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(s);
  } catch (e) {
    const objs = [...s.matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g)];
    const valid = [];
    for (const o of objs) {
      try {
        const parsed = JSON.parse(o[0]);
        if (parsed.title && parsed.summary) valid.push(parsed);
      } catch (_) {}
    }
    if (valid.length === 0) throw new Error('JSON repair failed: ' + e.message);
    return valid;
  }
}

module.exports = async function handler(req, res) {
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

    const scanPrompt = `You are a senior intelligence analyst for Guest Guide Interactive.

COMPANY CONTEXT:
${GG_CONTEXT}

SOURCE UNIVERSE:
${SOURCE_UNIVERSE}

PUBLISHED TOPICS TO AVOID:
${EXISTING_TOPICS}

Selected source focus: ${sources.length > 0 ? sources.join(', ') : 'all sources'}
Selected themes: ${themes.length > 0 ? themes.join(', ') : 'all themes'}

Find 7-9 genuinely current (2025-2026) intelligence signals that Guest Guide has NOT yet written about. Draw from the full source universe. Priority gaps: Nordic coolcation governance, rural tourism funding, operator economics, spatial intelligence, platform dependency, traveller research, islands/villages, DACH market, consumer magazine trends.

For each signal provide: numbered title, source organisation, date (month year), 2-sentence factual summary, and 2 article ideas with Guest Guide angle.

Respond as clear numbered plain text. No JSON yet.`;

    // Phase 1: Research
    const researchText = await callAnthropic(apiKey, [
      { role: 'user', content: scanPrompt }
    ], 2000);

    // Phase 2: Format as JSON
    const formatPrompt = `Convert these intelligence signals to a JSON array. CRITICAL RULES: raw JSON array only, no markdown, no backticks. Every string on ONE line — no newlines inside strings. No trailing commas. String length limits: summary ≤180 chars, positioning ≤140 chars, title ≤90 chars, angle ≤75 chars. type: policy|ai|ota|dmo|market|research. badge: badge-policy|badge-ai|badge-ota|badge-dmo|badge-market|badge-research. relevance: integer 70-99.

SIGNALS:
${researchText}

GUEST GUIDE CONTEXT (for positioning):
${GG_CONTEXT}

Format each as: {"type":"market","typeLabel":"Consumer Trend","badge":"badge-market","title":"Title here","source":"Source","date":"Mar 2026","relevance":85,"summary":"Concise summary here.","ideas":[{"text":"Article title","angle":"GG angle"},{"text":"Article title 2","angle":"GG angle 2"}],"positioning":"GG positioning note."}`;

    const jsonText = await callAnthropic(apiKey, [
      { role: 'user', content: formatPrompt }
    ], 3000);

    const signals = repairJson(jsonText);

    res.setHeader('Access-Control-Allow-Origin', '*'); res.status(200).json({ signals, researchText }); return;

  } catch (err) {
    res.status(500).json({ error: err.message }); return;
  }
}

