export const config = { maxDuration: 300 };

const { enforceEditorialIntegrity } = require('./integrity');

const GG_CONTEXT = `Guest Guide Interactive is a European tourism technology company founded by Walt Cudlip, operating across Europe with no single country market prioritised over another in content or framing (Walt is based in Arezzo, Tuscany). The platform uses AI-driven visitor dispersion technology — operating as an intelligence layer over a verified, locally curated destination dataset — to help DMOs redirect visitor flows from overcrowded areas toward under-visited destinations, authentic operators, and off-season periods. Target customers: DMOs and regional tourism boards (Segment A), authentic local operators including agriturismi, guides and artisans (Segment B), travellers seeking authentic experiences (Segment C). Policy alignment: EU Transition Pathway for Tourism, Interreg Central Europe Priority 2, NBTC Perspective 2030, ENIT and other national tourism frameworks across Europe. Core claim: produces redistribution evidence that EU funding bodies require — not just redistribution itself. Governance tool, not a marketing or itinerary tool. Never describe the internal ranking or curation mechanism. DEFAULT STANCE: write as general, pan-European industry thought leadership on tourism, technology and policy — not as a company update. Do not treat Italy, or any other single market, as the lens for the article. Do not frame the piece around Guest Guide's operational stage, fundraising status, or market entry timing.`;

const COMMERCIAL_STATUS = `Guest Guide is pre-revenue and actively fundraising, and is in dialogue with prospective DMO partners across Europe. Only mention this when it directly serves the brief. Do not name a specific DMO unless Walt has explicitly approved that name for this article.`;

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

const { callMistral, callMistralLite, extractText } = require('./integrity');

async function callMistralText(apiKey, messages, maxTokens) {
  const data = await callMistral(apiKey, { max_tokens: maxTokens, messages });
  return extractText(data);
}

const ANTI_HALLUCINATION = `CRITICAL SOURCE-GROUNDING RULES:
- Every factual attribution to the source document (sections, annexes, action areas, statistics, dates, deadlines, targets, quotas, funding amounts, requirements) must appear in the verified source.
- If you are not certain a claim is in the source, cut it. Analysis and opinion are fine; invented facts are not.
- Policy frameworks named in COMPANY CONTEXT (Interreg, NBTC, ENIT, etc.) are Guest Guide policy alignments — never present them as requirements or content of the source document.
- Do not describe the source as a mandate, obligation or funding condition unless it explicitly says so.`;

function parseGroundingJson(raw) {
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON object in grounding response');
  return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1'));
}

/**
 * Post-generation grounding gate: verifies the finished article's claims
 * against the actual source text, when provided. enforceEditorialIntegrity
 * validates the SOURCE (URL reachable, plausibly aligned); this validates the
 * generated ARTICLE against it. Failure mode this prevents: invented
 * section references, annexes, statistics and quantified mandates.
 */
async function groundArticleInSource(apiKey, { article, sourceText, sourceLabel }) {
  const source = String(sourceText || '').slice(0, 60000);
  const prompt = `You are a strict fact-checking gate.

SOURCE LABEL: ${sourceLabel || 'verified source'}

SOURCE TEXT:
"""
${source}
"""

ARTICLE TO CHECK:
"""
${article}
"""

Check every factual claim in the article against the source text: citations of sections, annexes or action areas, statistics, dates, deadlines, quotas, targets, funding amounts, and any statement about what the source requires or mandates. The article may add analysis and opinion, but every factual attribution to the source must be supported by the source text. Invented section numbers, annexes, figures or mandates are failures.

Return ONLY one line of JSON: {"grounded":true|false,"issues":[{"quote":"exact phrase from the article","problem":"why the source text does not support it"}]}`;

  const data = await callMistralLite(apiKey, { max_tokens: 512, messages: [{ role: 'user', content: prompt }] });
  const text = extractText(data);
  if (!text) throw new Error('No grounding response from model');
  const result = parseGroundingJson(text);
  if (typeof result.grounded !== 'boolean') throw new Error('Grounding response malformed');
  return { grounded: result.grounded, issues: Array.isArray(result.issues) ? result.issues : [] };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end('Method not allowed'); return; }

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'MISTRAL_API_KEY not configured on server' }); return;
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
${(angle === 'investor' || angle === 'case-study') ? '\nCOMMERCIAL STATUS (relevant to this angle only):\n' + COMMERCIAL_STATUS : ''}

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

      const briefText = await callMistralText(apiKey, [{ role: 'user', content: prompt }], 2800);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(200).json({ brief: briefText });
      return;
    }

    // ── ACTION: article ────────────────────────────────────────────────────
    if (action === 'article') {
      const { headline, brief, signalTitle, signalSource, signalUrl, signalDate, angle, tone, sourceText: rawSourceText } = body;
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
${(angle === 'investor' || angle === 'case-study') ? '\nCOMMERCIAL STATUS (relevant to this angle only):\n' + COMMERCIAL_STATUS : ''}

ARTICLE SPECIFICATION — follow every instruction precisely:
${ARTICLE_SPEC}

${ANTI_HALLUCINATION}

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
- Never invent section numbers, annexes, action areas, statistics, targets, quotas, deadlines or funding conditions that are not present in the verified source
- Never present policy frameworks named in COMPANY CONTEXT (Interreg, NBTC, ENIT) as requirements of the source document — they are Guest Guide policy alignments, not source content
- MANDATORY: 1,000–1,200 words in the body (before ---), with 4–5 ## subheadings — not a short post
- Year-11 reading level, British English
- Exactly 2–3 :::IMAGE blocks embedded in the body at salient points
- Divider --- then LINKEDIN PRÉCIS (120–150 words, CTA at end)
- Then SUGGESTED HASHTAGS (5–8 lines, each starting with #)

Start directly with the article title as # heading.`;

      const articleText = await callMistralText(apiKey, [{ role: 'user', content: prompt }], 8192);

      // Post-generation grounding gate: verify the article against the source
      // text when provided. enforceEditorialIntegrity validates the source;
      // this validates the generated claims against it.
      const sourceText = String(rawSourceText || '').trim();
      let grounding = null;
      if (sourceText) {
        grounding = await groundArticleInSource(apiKey, {
          article: articleText,
          sourceText,
          sourceLabel: signalSource || url || '',
        });
        if (!grounding.grounded) {
          res.status(422).json({
            error: 'Source grounding check failed: the article contains claims not supported by the source text.',
            grounding_failed: true,
            issues: grounding.issues,
          });
          return;
        }
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(200).json({ article: articleText, grounding });
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
