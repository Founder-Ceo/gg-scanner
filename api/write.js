export const config = { runtime: 'edge' };

const GG_CONTEXT = `Guest Guide Interactive is a European tourism technology company founded by Walt Cudlip, based in Arezzo, Tuscany. The platform uses AI-driven visitor dispersion technology — operating as an intelligence layer over a verified, locally curated geospatial dataset — to help DMOs redirect visitor flows from overcrowded areas toward under-visited destinations, authentic operators, and off-season periods. Target customers: DMOs and regional tourism boards (Segment A), authentic local operators including agriturismi, guides and artisans (Segment B), travellers seeking authentic experiences (Segment C). Primary markets: Italy (Arezzo-Siena corridor pilot active), DACH region (priority expansion), Netherlands, France. Pre-revenue, actively fundraising €3.5M Seed/Series A. In dialogue with Visit Tuscany and Fondazione Arezzo Intour. Policy alignment: EU Transition Pathway for Tourism, Interreg Central Europe Priority 2, NBTC Perspective 2030, ENIT national frameworks. Core claim: produces redistribution evidence that EU funding bodies require — not just redistribution itself. Governance tool, not a marketing or itinerary tool. Never describe the internal ranking or curation mechanism.`;

const EXISTING_TOPICS = `Already published (do not repeat): overtourism intro, slow travel intro, SaaS market sizing for DMOs, social licence/resident voice, founder origin story, data-driven tourism, wellness travel demand, resident backlash (Barcelona/Venice), investor market sizing, DMO digital tools vs campaigns, temporary resident traveller framing, heritage preservation vs prosperity, startup-policy nexus, EU Green Deal dispersion mandates, DMO analytics testing, spatial governance flagship, Italian mid-cities dispersion (Arezzo Is Not Venice), slow tourism infrastructure, ETC Barometer demand shift, ENIT Italian tools gap, OTA vs governance accountability, EU startup single market.`;

const ARTICLE_SPEC = `PERMANENT ARTICLE SPECIFICATION:
- Platform: LinkedIn article (published on blog, referenced via LinkedIn excerpt)
- Reading level: Year 11 / Grade 11 — clear, direct prose. Short sentences. No jargon without explanation. Accessible to non-native English speakers.
- Length: 1,000–1,200 words body text only
- Voice: First-person-adjacent — authoritative but not academic. Speaks to professionals.
- Language: British English throughout
- Structure: Engaging LinkedIn-style subheadings, punchy intro, clear argument, strong close
- Images: At 2–3 points insert image placeholder blocks in EXACTLY this format:
  :::IMAGE [N] — [one-line description]
  Note: [2-sentence editorial note on why this image]
  Prompt: [Full photorealistic generation prompt — 16:9, no invented text/signage, no hallucinated places]
  :::
- After article body add this exact divider on its own line: ---
- Then section: LINKEDIN PRÉCIS
- Précis: 120–150 words. High-conversion LinkedIn hook. Personal voice. No hashtags. Ends with CTA to read full article.`;

const ANGLE_DESCRIPTIONS = {
  'thought-leadership': 'Guest Guide as a sector authority on European dispersion technology and policy-aligned tourism management',
  'commentary': 'Guest Guide responding to an industry development, contributing to a policy or market conversation',
  'case-study': 'Guest Guide presenting evidence from real-world application or pilot work',
  'investor': 'Framing the tourism tech opportunity for investors, with Guest Guide positioned within the market',
  'dmo': 'Speaking directly to destination managers and tourism boards about operational challenges and solutions',
  'manifesto': 'A bold, declarative position on the future of European tourism — Guest Guide as a visionary voice'
};

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

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured on server' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    const { action, concept, angle, tone, context, brief, headline } = body;

    if (action === 'brief') {
      const prompt = `You are a specialist content strategist for Guest Guide Interactive.

COMPANY CONTEXT:
${GG_CONTEXT}

ARTICLE SPECIFICATION:
${ARTICLE_SPEC}

EXISTING TOPICS TO AVOID:
${EXISTING_TOPICS}

BRIEF REQUEST:
Concept / Signal: ${concept}
Guest Guide Angle: ${ANGLE_DESCRIPTIONS[angle] || angle}
Tone: ${tone || 'Authoritative'}
${context ? 'Additional context: ' + context : ''}

Produce a structured article brief with EXACTLY these sections:
1. WORKING HEADLINES — exactly 3 strong options (label A, B, C)
2. HOOK — 2-sentence opening that stops a LinkedIn reader mid-scroll
3. CORE ARGUMENT — central thesis in 3-4 sentences
4. KEY POINTS — 4-5 bullet points of main arguments
5. GUEST GUIDE POSITIONING — how and where Guest Guide enters the article naturally (in dialogue with DMOs, no signed partners yet)
6. DATA & SOURCES — specific organisations, reports, or data points to anchor the piece
7. RECOMMENDED STRUCTURE — brief outline (Intro → 3-4 sections → Conclusion → CTA)
8. CONTENT NOTES — tone guidance, what to avoid, what to amplify

Be specific and intelligent. Write as someone who deeply understands European tourism policy and B2B SaaS.`;

      const briefText = await callAnthropic(apiKey, [{ role: 'user', content: prompt }], 1500);

      return new Response(JSON.stringify({ brief: briefText }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });

    } else if (action === 'article') {
      const prompt = `You are a specialist content writer for Guest Guide Interactive.

COMPANY CONTEXT:
${GG_CONTEXT}

ARTICLE SPECIFICATION — follow every instruction precisely:
${ARTICLE_SPEC}

EXISTING TOPICS TO AVOID:
${EXISTING_TOPICS}

ARTICLE BRIEF:
${brief}

CHOSEN HEADLINE: ${headline}
GUEST GUIDE ANGLE: ${ANGLE_DESCRIPTIONS[angle] || angle}
TONE: ${tone || 'Authoritative'}

Write the complete article. Follow the specification exactly:
- 1,000–1,200 words body text
- Year-11 reading level, British English
- LinkedIn-optimised subheadings
- 2–3 image placeholders in the :::IMAGE format specified
- Divider --- then LINKEDIN PRÉCIS (120–150 words, no hashtags, CTA at end)

Start directly with the article title.`;

      const articleText = await callAnthropic(apiKey, [{ role: 'user', content: prompt }], 2000);

      return new Response(JSON.stringify({ article: articleText }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });

    } else {
      return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
