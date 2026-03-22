export const config = { maxDuration: 120 };

const GG_CONTEXT = `Guest Guide Interactive is a European tourism technology company founded by Walt Cudlip, based in Arezzo, Tuscany. The platform uses AI-driven visitor dispersion technology — operating as an intelligence layer over a verified, locally curated geospatial dataset — to help DMOs redirect visitor flows from overcrowded areas toward under-visited destinations, authentic operators, and off-season periods. The platform's defensive moat is its verified, structured, geospatially addressed POI database (agriturismi, local guides, artisans, cultural sites).

Target customers: DMOs and regional tourism boards (Segment A), authentic local operators (Segment B), travellers seeking authentic experiences (Segment C). Primary markets: Italy (Arezzo-Siena corridor pilot active), DACH region (priority expansion), Netherlands, France. Pre-revenue, actively fundraising €3.5M Seed/Series A. In dialogue with Visit Tuscany and Fondazione Arezzo Intour.

Policy alignment: EU Transition Pathway for Tourism, Interreg Central Europe Priority 2, NBTC Perspective 2030, ENIT national frameworks. Core claim: produces redistribution evidence that EU funding bodies require — not just redistribution itself. This is a governance tool, not a marketing or itinerary tool.`;

const EXISTING_TOPICS = `Already published (do not repeat): overtourism intro, slow travel intro, SaaS market sizing for DMOs, social licence/resident voice, founder origin story, data-driven tourism, wellness travel demand, resident backlash (Barcelona/Venice), investor market sizing (Trillion-dollar), DMO digital tools vs campaigns, temporary resident traveller framing, heritage preservation vs prosperity, startup-policy nexus, EU Green Deal dispersion mandates, DMO analytics testing, spatial governance flagship (Counting Visitors to Controlling Flows), Italian mid-cities dispersion (Arezzo Is Not Venice), slow tourism infrastructure (What Slow Tourism Requires), ETC Barometer demand shift (Long-Haul Traveller), ENIT Italian tools gap, OTA vs governance accountability (Booking.com Crowd Avoidance), EU startup single market (EU Inc), operator economics/OTA costs (Hidden Tax on Operators), islands and villages excluded from frameworks, rural tourism digital infrastructure gap.

PRIORITY GAPS TO FILL: Nordic/Scandinavian tourism growth and coolcation governance, platform dependency risk (OTA lock-in from operator perspective), spatial intelligence in destination management, traveller behavioural research (what travellers say vs what platforms deliver), DACH market tourism policy, consumer magazine trend signals for 2026.`;

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

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const cutoffDate = threeMonthsAgo.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

    const scanPrompt = `You are a senior intelligence analyst for Guest Guide Interactive. Return intelligence signals as a JSON array.

DATE CONSTRAINT: Only return signals published or released after ${cutoffDate}. Reject anything older. If a source has no recent signal within this window, skip it entirely.

COMPANY CONTEXT: ${GG_CONTEXT}

TOPICS ALREADY COVERED — DO NOT REPEAT: ${EXISTING_TOPICS}

SOURCE CATEGORIES: EU Commission, ETC, UN Tourism, Interreg, NBTC Netherlands, ENIT Italy, Skift, Phocuswire, BBC Travel, Visit Norway/Sweden/Finland, LEADER Programme, ECTN, ETOA, Ruraltour, Esri/GIS, Conde Nast Traveller, NatGeo Traveller, Geo Magazin Germany, Le Figaro Voyage, Corriere Viaggi Italy, IBISWorld, Euromonitor, WTTC, McKinsey Travel, Our World in Data.

Selected sources: ${sources.length > 0 ? sources.join(', ') : 'all'}
Selected themes: ${themes.length > 0 ? themes.join(', ') : 'all'}

PRIORITY GAPS: Nordic coolcation governance, platform dependency risk, spatial intelligence in DMOs, traveller behavioural research, DACH market tourism policy, consumer magazine 2026 trends.

OUTPUT: JSON array of 6-7 signals. RULES: raw JSON array ONLY, no markdown, no backticks, no prose before or after. Every string value on ONE line — no newlines inside strings. No trailing commas. title max 85 chars, summary max 175 chars, positioning max 130 chars, angle max 70 chars. type must be one of: policy, ai, ota, dmo, market, research. badge must be one of: badge-policy, badge-ai, badge-ota, badge-dmo, badge-market, badge-research. relevance must be integer 70-99.

EXAMPLE (one correctly formatted object):
{"type":"market","typeLabel":"Consumer Trend","badge":"badge-market","title":"Signal title here","source":"Source org","date":"Mar 2026","relevance":85,"summary":"Factual 1-2 sentence summary with specific data point.","ideas":[{"text":"Article title option 1","angle":"GG angle here"},{"text":"Article title option 2","angle":"GG angle here"}],"positioning":"How GG positions relative to this signal."}

Produce the full JSON array now:`;

    const jsonText = await callAnthropic(apiKey, [
      { role: 'user', content: scanPrompt }
    ], 2500);

    const signals = repairJson(jsonText);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ signals });
    return;

  } catch (err) {
    res.status(500).json({ error: err.message });
    return;
  }
};
