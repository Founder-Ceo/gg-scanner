/**
 * Editorial integrity helpers — live web search + URL verification.
 * Used by scan.js (signal discovery) and write.js (brief/article gate).
 */

// Sonnet 4 (20250514) deprecated 14 Apr 2026, retires 15 Jun 2026 → use Sonnet 4.6
// Haiku 3.5 retired 19 Feb 2026 → use Haiku 4.5
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const VERIFY_MODEL = process.env.ANTHROPIC_VERIFY_MODEL || 'claude-haiku-4-5-20251001';

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

const MONTH_INDEX = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

/** Editorial clock — Europe/London, YYYY-MM-DD. */
function editorialTodayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

function parseISODate(iso) {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo || dt.getUTCDate() !== d) {
    return null;
  }
  return dt;
}

/**
 * Parse scanner / pipeline date strings (British-first).
 * Returns { precision: 'day'|'month', start: Date, end: Date } or null.
 */
function parseSignalDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;

  // ISO from pipeline scheduled fields occasionally copied
  const iso = parseISODate(s);
  if (iso) {
    return { precision: 'day', start: iso, end: iso, raw: s };
  }

  // DD/MM/YYYY or DD-MM-YYYY (British)
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const y = Number(m[3]);
    const start = new Date(Date.UTC(y, mo, d));
    if (start.getUTCFullYear() === y && start.getUTCMonth() === mo && start.getUTCDate() === d) {
      return { precision: 'day', start, end: start, raw: s };
    }
  }

  // "11 May 2026"
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = MONTH_INDEX[m[2].toLowerCase()];
    const y = Number(m[3]);
    if (mo !== undefined) {
      const start = new Date(Date.UTC(y, mo, d));
      if (start.getUTCFullYear() === y && start.getUTCMonth() === mo && start.getUTCDate() === d) {
        return { precision: 'day', start, end: start, raw: s };
      }
    }
  }

  // "May 2026" / "Mar 2026"
  m = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const mo = MONTH_INDEX[m[1].toLowerCase()];
    const y = Number(m[2]);
    if (mo !== undefined) {
      const start = new Date(Date.UTC(y, mo, 1));
      const end = new Date(Date.UTC(y, mo + 1, 0));
      return { precision: 'month', start, end, raw: s };
    }
  }

  return null;
}

function yearMonthKey(d) {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/**
 * Deterministic date gate — blocks only signals clearly dated AFTER publication.
 * Purpose: catch fabricated future-dated reports, not policy effective dates or in-story deadlines.
 * Month-only signals (e.g. "May 2026") compare calendar month to publish month, so
 * publishing on 20 May 2026 with signal date "May 2026" is allowed.
 */
function validateSignalDate(signalDate, options = {}) {
  const parsed = parseSignalDate(signalDate);
  if (!parsed) {
    return { ok: true, skipped: true, reason: 'Signal date not parsed; calendar check skipped.' };
  }

  const refISO = (options.publishDate && parseISODate(options.publishDate))
    ? options.publishDate.trim()
    : editorialTodayISO();
  const ref = parseISODate(refISO);
  if (!ref) {
    return { ok: true, skipped: true, reason: 'Reference date unavailable; calendar check skipped.' };
  }

  if (parsed.precision === 'month') {
    const signalYM = yearMonthKey(parsed.start);
    const refYM = yearMonthKey(ref);
    if (signalYM > refYM) {
      return {
        ok: false,
        skipped: false,
        reason:
          `Signal month (${parsed.raw}) is after the publication month (${refISO.slice(0, 7)}). ` +
          'Month-only dates are compared by calendar month, not day.',
        referenceDate: refISO,
        signalDate: parsed.raw,
      };
    }
    return {
      ok: true,
      skipped: false,
      reason:
        `Signal month (${parsed.raw}) matches or precedes publication month — valid for commentary.`,
      referenceDate: refISO,
      signalDate: parsed.raw,
    };
  }

  const slackMs = 24 * 60 * 60 * 1000;
  if (parsed.end.getTime() > ref.getTime() + slackMs) {
    return {
      ok: false,
      skipped: false,
      reason:
        `Signal date (${parsed.raw}) is after the editorial reference date (${refISO}). ` +
        'This compares source publication timing only — not policy effective dates or deadlines in the article text.',
      referenceDate: refISO,
      signalDate: parsed.raw,
    };
  }

  return {
    ok: true,
    skipped: false,
    reason: `Signal date (${parsed.raw}) is on or before editorial reference (${refISO}).`,
    referenceDate: refISO,
    signalDate: parsed.raw,
  };
}

/**
 * Lightweight claim check after HTTP reachability (no web search — saves TPM).
 */
async function verifySourceLight(apiKey, fields) {
  const { signalTitle, signalSource, signalUrl, signalDate, concept, dateCheck } = fields;

  const dateRule = dateCheck?.ok && !dateCheck?.skipped
    ? `DATE (code-verified): ${dateCheck.reason} Do NOT reject for future publication — only reject URL/title mismatch or fabricated sources.`
    : dateCheck?.ok === false
      ? `DATE (failed code check): ${dateCheck.reason}`
      : `DATE: ${signalDate || 'not provided'} — if unparseable, do not reject on calendar grounds alone.`;

  const prompt = `Editorial integrity check. The URL already returned HTTP 2xx.
Editorial reference date (Europe/London): ${fields.referenceDate || editorialTodayISO()}
${fields.publishDate ? `Planned publication: ${fields.publishDate}` : ''}

Signal: ${signalTitle || concept || '?'}
Source: ${signalSource || '?'}
Signal date (publication): ${signalDate || '?'}
URL: ${signalUrl}

${dateRule}

Approve (verified:true) when the URL path and headline claim are plausibly aligned.
Reject only for: invalid/unrelated URL (e.g. generic homepage), or clearly fabricated source (invented report, fake statistics).
Do NOT reject because:
- the story mentions policy effective dates or consultation deadlines on or near the publication date (commentary is allowed);
- the signal month matches the publication month (e.g. signal "May 2026", publish 20 May 2026);
- the news is recent/current-month journalism.
This gate targets AI-hallucinated sources, not commentary timing.

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
  const publishDate = (fields.publishDate || fields.scheduledDate || '').trim();
  const referenceDate = editorialTodayISO();

  const dateCheck = validateSignalDate(fields.signalDate, { publishDate: publishDate || undefined });
  if (!dateCheck.ok) {
    return {
      verified: false,
      reason: dateCheck.reason,
      date_check: dateCheck,
    };
  }

  if (!url) {
    return {
      verified: false,
      reason:
        'Source URL is required. Run Intelligence Scan with live web search and use a signal that includes a verified URL.',
      date_check: dateCheck,
    };
  }

  const reachable = await checkUrlReachable(url);
  if (!reachable.ok) {
    return {
      verified: false,
      reason: `Source URL is not reachable (${reachable.reason}). Editorial integrity requires a working link.`,
      date_check: dateCheck,
    };
  }

  const result = await verifySourceLight(apiKey, {
    ...fields,
    signalUrl: url,
    publishDate: publishDate || undefined,
    referenceDate,
    dateCheck,
  });

  return { ...result, date_check: dateCheck };
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
  parseSignalDate,
  validateSignalDate,
  editorialTodayISO,
};
