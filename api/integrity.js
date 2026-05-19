/**
 * Editorial integrity helpers — live web search + URL verification.
 * Used by scan.js (signal discovery) and write.js (brief/article gate).
 */

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const VERIFY_MODEL = process.env.ANTHROPIC_VERIFY_MODEL || 'claude-3-5-haiku-20241022';

function webSearchTool(maxUses = 5) {
  return {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: maxUses,
    user_location: {
      type: 'approximate',
      country: 'GB',
      timezone: 'Europe/London',
    },
  };
}

const WEB_SEARCH_TOOL = webSearchTool(5);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(response, attempt) {
  const header = response.headers.get('retry-after');
  if (header) {
    const sec = parseInt(header, 10);
    if (!Number.isNaN(sec)) return Math.min(sec * 1000, 120000);
  }
  // Exponential backoff: 15s, 30s, 60s
  return Math.min(15000 * 2 ** attempt, 60000);
}

function friendlyAnthropicError(status, errBody) {
  if (status === 429) {
    return (
      'Anthropic rate limit reached (organisation input-token cap per minute). ' +
      'Wait 60 seconds and run the scan again. This is separate from account credit balance.'
    );
  }
  return `Anthropic API error ${status}: ${errBody}`;
}

async function callAnthropic(apiKey, body, attempt = 0) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: DEFAULT_MODEL, ...body }),
  });

  if (response.status === 429 && attempt < 3) {
    await sleep(parseRetryAfterMs(response, attempt));
    return callAnthropic(apiKey, body, attempt + 1);
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(friendlyAnthropicError(response.status, err));
  }
  return response.json();
}

/** Lightweight call (no web search) — separate model/rate-limit bucket for write verification. */
async function callAnthropicLite(apiKey, body, attempt = 0) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: VERIFY_MODEL, ...body }),
  });

  if (response.status === 429 && attempt < 2) {
    await sleep(parseRetryAfterMs(response, attempt));
    return callAnthropicLite(apiKey, body, attempt + 1);
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(friendlyAnthropicError(response.status, err));
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
async function callWithWebSearch(apiKey, {
  messages,
  maxTokens = 4096,
  maxRounds = 3,
  maxUses = 5,
}) {
  const tool = webSearchTool(maxUses);
  const baseBody = {
    max_tokens: maxTokens,
    tools: [tool],
    messages,
  };

  let data = await callAnthropic(apiKey, baseBody);
  let rounds = 0;

  while (data.stop_reason === 'pause_turn' && rounds < maxRounds) {
    rounds += 1;
    await sleep(500);
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
 * Lightweight claim check after HTTP reachability (no web search — saves TPM).
 */
async function verifySourceLight(apiKey, fields) {
  const { signalTitle, signalSource, signalUrl, signalDate, concept } = fields;

  const prompt = `Editorial integrity check. The URL already returned HTTP 2xx.

Signal: ${signalTitle || concept || '?'}
Source: ${signalSource || '?'}
Date: ${signalDate || '?'}
URL: ${signalUrl}

Approve (verified:true) only if the URL path and title are plausibly aligned and the claim does not look fabricated (e.g. non-existent future McKinsey report, invented statistics). Reject generic homepages unrelated to the claim.

Return ONLY one line JSON: {"verified":true|false,"reason":"..."}`;

  const data = await callAnthropicLite(apiKey, {
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
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

  return verifySourceLight(apiKey, { ...fields, signalUrl: url });
}

/** Truncate long topic lists to stay under org input-token-per-minute limits. */
function truncateTopics(text, maxChars = 1200) {
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '… [truncated for rate limits]';
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
async function filterVerifiedSignals(signals, options = {}) {
  const kept = [];
  const rejected = [];

  async function processOne(s) {
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
  }

  if (options.sequential) {
    for (const s of signals) await processOne(s);
  } else {
    await Promise.all(signals.map(processOne));
  }

  return { kept, rejected };
}

module.exports = {
  WEB_SEARCH_TOOL,
  webSearchTool,
  callAnthropic,
  callAnthropicLite,
  callWithWebSearch,
  extractText,
  checkUrlReachable,
  verifySourceLight,
  enforceEditorialIntegrity,
  filterVerifiedSignals,
  isValidHttpUrl,
  repairSignalsJson,
  truncateTopics,
};
