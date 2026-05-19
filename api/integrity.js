/**
 * Editorial integrity helpers — live web search + URL verification.
 * Used by scan.js (signal discovery) and write.js (brief/article gate).
 */

const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 10,
  user_location: {
    type: 'approximate',
    country: 'GB',
    timezone: 'Europe/London',
  },
};

async function callAnthropic(apiKey, body) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }
  return response.json();
}

function extractText(data) {
  if (!data?.content) return '';
  return data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Call Claude with Anthropic server-executed web search.
 * Handles pause_turn by continuing the assistant turn (no client tool_result).
 */
async function callWithWebSearch(apiKey, { messages, maxTokens = 4000, maxRounds = 6 }) {
  const baseBody = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    tools: [WEB_SEARCH_TOOL],
    messages,
  };

  let data = await callAnthropic(apiKey, baseBody);
  let rounds = 0;

  while (data.stop_reason === 'pause_turn' && rounds < maxRounds) {
    rounds += 1;
    data = await callAnthropic(apiKey, {
      ...baseBody,
      messages: [...messages, { role: 'assistant', content: data.content }],
    });
  }

  return data;
}

function isValidHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function checkUrlReachable(url, timeoutMs = 8000) {
  if (!isValidHttpUrl(url)) {
    return { ok: false, reason: 'Invalid URL format' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { 'User-Agent': 'GuestGuide-Scanner/2.0 (editorial integrity check)' };

  try {
    let res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers,
    });

    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
        headers,
      });
    }

    if (res.status >= 200 && res.status < 400) {
      return { ok: true, status: res.status };
    }
    return { ok: false, reason: `HTTP ${res.status}` };
  } catch (e) {
    const reason = e.name === 'AbortError' ? 'Request timed out' : e.message;
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonObject(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON object in verification response');
  let s = m[0];
  s = s.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(s);
}

/**
 * Web-search semantic verification: URL exists, claim is supported, date plausible.
 */
async function verifySourceWithWebSearch(apiKey, fields) {
  const { signalTitle, signalSource, signalUrl, signalDate, concept } = fields;

  const prompt = `You are an editorial integrity verifier for Guest Guide Interactive journalism.

Use web search to verify this signal BEFORE any article brief is written. Do not approve unless you have checked the live web.

SIGNAL TO VERIFY:
- Title/claim: ${signalTitle || concept || '(not provided)'}
- Organisation: ${signalSource || '(not provided)'}
- Date claimed: ${signalDate || '(not provided)'}
- URL: ${signalUrl}

VERIFICATION RULES (all must pass for verified:true):
1. The URL must resolve to a real, publicly accessible page (not 404, not a generic homepage unrelated to the claim).
2. The page must support the specific claim in the title — not a different topic, not a fabricated future report.
3. The publication or page date must be consistent with the claimed date (reject future-dated or non-existent reports).
4. Reject if the statistic or report appears invented, or if you cannot find corroboration on the cited page.
5. Reject placeholder, example.com, or aggregator pages that do not contain the primary source.

Return ONLY raw JSON on one line, no markdown:
{"verified":true,"reason":"Brief justification citing what you found on the live page"}
or
{"verified":false,"reason":"Specific failure — e.g. URL 404, report not found, date mismatch, claim unsupported"}`;

  const data = await callWithWebSearch(apiKey, {
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1024,
    maxRounds: 4,
  });

  const text = extractText(data);
  if (!text) throw new Error('No verification response from model');

  const result = parseJsonObject(text);
  if (typeof result.verified !== 'boolean') {
    throw new Error('Verification response malformed');
  }
  return result;
}

/**
 * Full editorial gate: reachable URL + web-search claim verification.
 */
async function enforceEditorialIntegrity(apiKey, fields) {
  const url = (fields.signalUrl || '').trim();

  if (!url) {
    return {
      verified: false,
      reason:
        'Source URL is required. Run Intelligence Scan with live web search and use a signal that includes a verified URL.',
    };
  }

  const reachable = await checkUrlReachable(url);
  if (!reachable.ok) {
    return {
      verified: false,
      reason: `Source URL is not reachable (${reachable.reason}). Editorial integrity requires a working link.`,
    };
  }

  return verifySourceWithWebSearch(apiKey, { ...fields, signalUrl: url });
}

function repairSignalsJson(raw) {
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
        if (parsed.title && parsed.summary && parsed.url) valid.push(parsed);
      } catch (_) {}
    }
    if (valid.length === 0) throw new Error('JSON repair failed: ' + e.message);
    return valid;
  }
}

/** Drop signals without a valid, reachable URL. */
async function filterVerifiedSignals(signals) {
  const kept = [];
  const rejected = [];

  await Promise.all(
    signals.map(async (s) => {
      if (!s.url || !isValidHttpUrl(s.url)) {
        rejected.push({ id: s.id, title: s.title, rejectReason: 'missing_or_invalid_url' });
        return;
      }
      const check = await checkUrlReachable(s.url);
      if (!check.ok) {
        rejected.push({
          id: s.id,
          title: s.title,
          url: s.url,
          rejectReason: 'url_not_reachable',
          detail: check.reason,
        });
        return;
      }
      kept.push(s);
    }),
  );

  return { kept, rejected };
}

module.exports = {
  WEB_SEARCH_TOOL,
  callWithWebSearch,
  extractText,
  checkUrlReachable,
  verifySourceWithWebSearch,
  enforceEditorialIntegrity,
  filterVerifiedSignals,
  isValidHttpUrl,
  repairSignalsJson,
};
