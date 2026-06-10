export const config = { maxDuration: 180 };

const { enforceEditorialIntegrity } = require('./integrity');

const GG_CONTEXT = `Guest Guide Interactive is a European tourism technology company founded by Walt Cudlip, based in Arezzo, Tuscany. The platform uses AI-driven visitor dispersion technology — operating as an intelligence layer over a verified, locally curated destination dataset — to help DMOs redirect visitor flows from overcrowded areas toward under-visited destinations, authentic operators, and off-season periods. Target customers: DMOs and regional tourism boards (Segment A), authentic local operators including agriturismi, guides and artisans (Segment B), travellers seeking authentic experiences (Segment C). Primary markets: Italy (Arezzo-Siena corridor pilot active), DACH region (priority expansion), Netherlands, France. Pre-revenue, actively fundraising €3.5M Seed/Series A. In dialogue with Visit Tuscany and Fondazione Arezzo Intour. Policy alignment: EU Transition Pathway for Tourism, Interreg Central Europe Priority 2, NBTC Perspective 2030, ENIT national frameworks. Core claim: produces redistribution evidence that EU funding bodies require — not just redistribution itself. Governance tool, not a marketing or itinerary tool. Never describe the internal ranking or curation mechanism.`;

const EXISTING_TOPICS = `Already published (do not repeat): overtourism intro, slow travel intro, SaaS market sizing for DMOs, social licence/resident voice, founder origin story, data-driven tourism, wellness travel demand, resident backlash (Barcelona/Venice), investor market sizing, DMO digital tools vs campaigns, temporary resident traveller framing, heritage preservation vs prosperity, startup-policy nexus, EU Green Deal dispersion mandates, DMO analytics testing, spatial governance flagship, Italian mid-cities dispersion (Arezzo Is Not Venice), slow tourism infrastructure, ETC Barometer demand shift, ENIT Italian tools gap, OTA vs governance accountability, EU startup single market.`;

const ARTICLE_SPEC = `PERMANENT ARTICLE SPECIFICATION:
- Platform: LinkedIn article (published on blog, referenced via LinkedIn excerpt)
- Reading level: Year 11 / Grade 11 — clear, direct prose. Short sentences. No jargon without explanation. Accessible to non-native English speakers.
- Length: MANDATORY 1,000–1,200 words for the article BODY only (the section before the --- divider). Outputs under 900 words are unacceptable. Write four to five substantive sections with ## subheadings.
- Voice: First-person-adjacent — authoritative but not academic. Speaks to professionals.
- Language: British English throughout
- Structure: Title (# heading), punchy intro (2 short paragraphs), 4–5 ## subheaded sections, strong conclusion — then image blocks and closing sections below
- Images: Insert exactly 2–3 image placeholder blocks at salient points in the body using EXACTLY this format:
  :::IMAGE [N] — [one-line description]
  Note: [2-sentence editorial note on why this image]
  Prompt: [Full photorealistic generation prompt — 16:9, no invented text/signage, no hallucinated places]
  :::
- After the complete body, add this exact divider on its own line: ---
- Then section header: LINKEDIN PRÉCIS
- Précis: 120–150 words. High-conversion LinkedIn hook. Personal voice. No hashtags inside the précis. Ends with CTA to read full article.
- Then section header: SUGGESTED HASHTAGS
- List 5–8 relevant hashtags (one per line, each starting with #) for LinkedIn distribution`;

const { callAnthropic: callAnthropicApi, extractText } = require('./integrity');

async function callAnthropic(apiKey, messages, maxTokens) {
  const data = await callAnthropicApi(apiKey, { max_tokens: maxTokens, messages });
  return extractText(data);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end('Method not allowed'); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' }); return;
  }

  try {
    const body = req.body || {};
    const { action } = body;

    // ── ACTION: brief ──────────────────────────────────────────────────────
    if (action === 'brief') {
      // Support both old field names (concept/context) and new (signalTitle/ideaText/notes)
      const concept = body.concept
        || [body.signalTitle, body.ideaText].filter(Boolean).join(' — ')
        || '(no concept provided)';
      const signalUrl = (body.signalUrl || '').trim();
      const signalTitle = body.signalTitle || body.ideaText || concept;
      const signalSource = body.signalSource || '';
      const signalDate = body.signalDate || '';
      const publishDate = (body.publishDate || body.scheduledDate || '').trim();

      const verification = await enforceEditorialIntegrity(apiKey, {
        concept,
        signalTitle,
        signalSource,
        signalUrl,
        signalDate,
        publishDate,
      });
      if (!verification.verified) {
        res.status(422).json({
          error: String(`Editorial integrity check: ${verification.reason}`),
          integrity_failed: true,
          reason: String(verification.reason || 'Integrity check failed'),
        });
        return;
      }

      const context = body.context
        || [
            signalSource ? `Source: ${signalSource}` : '',
            signalDate   ? `Date: ${signalDate}`     : '',
            signalUrl    ? `URL: ${signalUrl}`        : '',
            body.notes   ? `Notes: ${body.notes}`    : '',
            `Integrity: verified via live web search — ${verification.reason}`,
          ].filter(Boolean).join('\n');
      const angle = body.angle || 'thought-leadership';
      const tone  = body.tone  || 'Authoritative';

      const ANGLE_DESCRIPTIONS = {
        'thought-leadership': 'Guest Guide as a sector authority on European dispersion technology and policy-aligned tourism management',
        'commentary':         'Guest Guide responding to an industry development, contributing to a policy or market conversation',
        'case-study':         'Guest Guide presenting evidence from real-world application or pilot work',
        'investor':           'Framing the tourism tech opportunity for investors, with Guest Guide positioned within the market',
        'dmo':                'Speaking directly to destination managers and tourism boards about operational challenges and solutions',
        'manifesto':          'A bold, declarative position on the future of European tourism — Guest Guide as a visionary voice',
      };

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
Tone: ${tone}
${context ? 'Additional context:\n' + context : ''}

Produce a structured article brief with EXACTLY these sections:
1. WORKING HEADLINES — exactly 3 strong options (label A, B, C)
2. HOOK — 2-sentence opening that stops a LinkedIn reader mid-scroll
3. CORE ARGUMENT — central thesis in 3-4 sentences
4. KEY POINTS — 4-5 bullet points of main arguments
5. GUEST GUIDE POSITIONING — how and where Guest Guide enters the article naturally (in dialogue with DMOs, no signed partners yet)
6. DATA & SOURCES — anchor only to the verified source URL and facts confirmed in the integrity check; do not invent reports or statistics
7. RECOMMENDED STRUCTURE — brief outline (Intro → 3-4 sections → Conclusion → CTA)
8. CONTENT NOTES — tone guidance, what to avoid, what to amplify

Be specific and intelligent. Write as someone who deeply understands European tourism policy and B2B SaaS.`;

      const briefText = await callAnthropic(apiKey, [{ role: 'user', content: prompt }], 2800);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(200).json({ brief: briefText });
      return;
    }

    // ── ACTION: article ────────────────────────────────────────────────────
    if (action === 'article') {
      const { headline, brief, signalTitle, signalSource, signalUrl, signalDate, angle, tone } = body;
      const url = (signalUrl || '').trim();

      const publishDate = (body.publishDate || body.scheduledDate || '').trim();

      const verification = await enforceEditorialIntegrity(apiKey, {
        concept: signalTitle || headline || '',
        signalTitle: signalTitle || '',
        signalSource: signalSource || '',
        signalUrl: url,
        signalDate: signalDate || '',
        publishDate,
      });
      if (!verification.verified) {
        res.status(422).json({
          error: `Editorial integrity check failed: ${verification.reason}`,
          integrity_failed: true,
          verification,
        });
        return;
      }

      const ANGLE_DESCRIPTIONS = {
        'thought-leadership': 'Guest Guide as a sector authority on European dispersion technology and policy-aligned tourism management',
        'commentary':         'Guest Guide responding to an industry development, contributing to a policy or market conversation',
        'case-study':         'Guest Guide presenting evidence from real-world application or pilot work',
        'investor':           'Framing the tourism tech opportunity for investors, with Guest Guide positioned within the market',
        'dmo':                'Speaking directly to destination managers and tourism boards about operational challenges and solutions',
        'manifesto':          'A bold, declarative position on the future of European tourism — Guest Guide as a visionary voice',
      };

      const prompt = `You are a specialist content writer for Guest Guide Interactive.

COMPANY CONTEXT:
${GG_CONTEXT}

ARTICLE SPECIFICATION — follow every instruction precisely:
${ARTICLE_SPEC}

EXISTING TOPICS TO AVOID:
${EXISTING_TOPICS}

ARTICLE BRIEF:
${brief || '(No brief provided — write a strong article based on the headline and signal below)'}

CHOSEN HEADLINE: ${headline || '(Choose the strongest headline from the brief)'}
ORIGINAL SIGNAL: ${signalTitle || ''}
${signalSource ? 'SOURCE: ' + signalSource : ''}
${url ? 'VERIFIED URL: ' + url : ''}
${signalDate ? 'DATE: ' + signalDate : ''}
INTEGRITY NOTE: ${verification.reason}
GUEST GUIDE ANGLE: ${ANGLE_DESCRIPTIONS[angle] || angle || 'thought-leadership'}
TONE: ${tone || 'Authoritative'}

Write the COMPLETE article in one response. Do not stop early. Follow the specification exactly:
- Cite only facts supported by the verified source URL; do not invent studies, statistics, or future-dated reports
- MANDATORY: 1,000–1,200 words in the body (before ---), with 4–5 ## subheadings — not a short post
- Year-11 reading level, British English
- Exactly 2–3 :::IMAGE blocks embedded in the body at salient points
- Divider --- then LINKEDIN PRÉCIS (120–150 words, CTA at end)
- Then SUGGESTED HASHTAGS (5–8 lines, each starting with #)

Start directly with the article title as # heading.`;

      const articleText = await callAnthropic(apiKey, [{ role: 'user', content: prompt }], 8192);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(200).json({ article: articleText });
      return;
    }

    res.status(400).json({ error: 'Unknown action. Use action:"brief" or action:"article"' });

  } catch (err) {
    const msg = err instanceof Error
      ? err.message
      : (typeof err === 'string' ? err : JSON.stringify(err));
    res.status(500).json({ error: msg || 'Internal server error' });
    return;
  }
};
