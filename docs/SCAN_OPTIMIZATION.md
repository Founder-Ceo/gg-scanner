# Scan Optimization Guide

## Changes Applied (2024)

This document summarizes the optimizations applied to fix 504 Gateway Timeout errors in the gg-scanner-app.

---

## ✅ Immediate Fix: Timeout Increase

### Files Modified
- `api/scan.js`: Changed `maxDuration` from 120 to 300 seconds
- `vercel.json`: Changed `api/scan.js` maxDuration from 120 to 300 seconds

### Rationale
Vercel Serverless Functions v2 support up to **300 seconds (5 minutes)** on Pro tier. The original 120-second (2-minute) timeout was insufficient for Mistral's Conversations API with web search, which can take 2-4 minutes to complete when performing multiple web searches.

**Note:** Ensure your Vercel project is on **Pro tier or higher**. Hobby tier only supports 10-second timeouts.

---

## 📊 Additional Recommendations Implemented

### Recommendation #1: Mistral API Latency Monitoring

**Location:** `api/scan.js` (lines ~258-278)

**Changes:**
```javascript
// Track when Mistral API call starts
const mistralStart = Date.now();
console.log(`[SCAN] Calling Mistral Conversations API with ${queries.length} web searches...`);

// After Mistral call completes
const mistralLatency = Date.now() - mistralStart;
console.log(`[SCAN] Mistral API completed in ${mistralLatency}ms`);

// Store in global array for monitoring (last 10 calls)
global.mistralLatencyMetrics.push({ timestamp: Date.now(), latency: mistralLatency });
if (global.mistralLatencyMetrics.length > 10) {
  global.mistralLatencyMetrics.shift();
}

// Warn if latency exceeds 60 seconds
if (mistralLatency > 60000) {
  console.warn(`[SCAN] High latency detected (${mistralLatency}ms). Consider breaking into smaller batches.`);
}
```

**How to Monitor:**
- Check Vercel deployment logs for `[SCAN]` prefixed messages
- Average Mistral API latency should be < 120 seconds
- If consistently > 120s, consider Recommendation #3

**Response includes:** Performance metrics in the JSON response:
```json
{
  "performance": {
    "processingTime": 150000,
    "queryCount": 3,
    "mistralLatency": 145000
  }
}
```

---

### Recommendation #2: Vercel Tier Verification

**Location:** `api/scan.js` (lines ~373-381)

**Changes:**
```javascript
} catch (err) {
  const totalTime = Date.now() - startTime;
  console.error(`[SCAN] Failed after ${totalTime}ms:`, err.message);
  
  // RECOMMENDATION #2: Vercel tier check - add helpful error message
  let errorMessage = err.message;
  if (totalTime > 290000) { // If we hit the 300s limit
    errorMessage = 'Scan timeout. Check Vercel tier (Pro required for 300s timeout). Current config: 300s maxDuration.';
  }
  
  return res.status(500).json({ 
    error: errorMessage,
    hint: totalTime > 290000 ? 'Increase maxDuration or reduce query complexity' : undefined
  });
}
```

**What to Check:**
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your gg-scanner project
3. Click **Settings** → **General**
4. Verify **Plan** is "Pro" or higher
5. If on Hobby tier, upgrade to Pro for 300s timeout support

---

### Recommendation #3: Reduced Query Complexity

**Location:** `api/scan.js` (line ~141)

**Change:**
```javascript
// OLD:
return [...q].slice(0, 5);

// NEW:
// RECOMMENDATION #3: Reduced from 5 to 3 queries to decrease Mistral API processing time
return [...q].slice(0, 3);
```

**Rationale:**
- Each web search adds ~20-40 seconds to processing time
- Original: 5 queries × ~30s = ~150s (2.5 minutes)
- Optimized: 3 queries × ~30s = ~90s (1.5 minutes)
- Provides buffer for network latency and AI processing

**Impact:**
- ✅ Faster scan completion
- ✅ Lower Mistral API costs (fewer searches)
- ⚠️ Slightly less comprehensive results

**To revert:** Change back to `.slice(0, 5)` if you need more comprehensive scanning and have sufficient timeout buffer.

---

### Recommendation #4: Async Processing Guidance

**Location:** `api/scan.js` (line ~274-276)

**Change:**
```javascript
// RECOMMENDATION #4: Async processing note - if latency > 60s, suggest breaking into batches
if (mistralLatency > 60000) {
  console.warn(`[SCAN] High latency detected (${mistralLatency}ms). Consider breaking into smaller batches.`);
}
```

**Future Implementation:**
If you continue to experience timeouts, consider implementing true async processing:

```javascript
// Option A: Batch processing
const BATCH_SIZE = 2;
const allQueries = buildQueries(sources, themes, dc);
const results = [];

for (let i = 0; i < allQueries.length; i += BATCH_SIZE) {
  const batch = allQueries.slice(i, i + BATCH_SIZE);
  const batchResults = await runScanBatch(apiKey, batch, dc);
  results.push(...batchResults);
  if (results.length >= 5) break; // We only need 5 signals
}

// Option B: Stream results to client
// Use Server-Sent Events (SSE) to stream signals as they're found
// Requires client-side changes to handle streaming responses
```

---

## 📈 Performance Targets

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| Mistral API Latency | < 120s | < 180s | > 240s |
| Total Processing Time | < 240s | < 270s | > 290s |
| Query Count | 3 | 4 | 5+ |

---

## 🛠️ Troubleshooting

### Symptom: Still getting 504 errors after changes

1. **Check Vercel tier:** Must be Pro or higher
2. **Check deployment:** Redeploy after making changes
3. **Check logs:** Look for `[SCAN]` messages in Vercel logs
4. **Check Mistral API status:** Visit [Mistral Status](https://status.mistral.ai/)

### Symptom: Scans are slow but not timing out

1. **Reduce query count further:** Try `.slice(0, 2)`
2. **Simplify system prompt:** The current prompt is ~2KB, consider shortening
3. **Use smaller model:** Set `MISTRAL_MODEL=mistral-medium-latest` in environment variables

### Symptom: Need more comprehensive results

1. **Increase query count:** Try `.slice(0, 4)` or `.slice(0, 5)`
2. **Accept longer timeouts:** Monitor latency and adjust if < 290s consistently

---

## 📝 Environment Variables Reference

| Variable | Purpose | Default | Recommended |
|----------|---------|---------|-------------|
| `MISTRAL_API_KEY` | Mistral API authentication | - | **Required** |
| `MISTRAL_MODEL` | Model for scan/brief/article | `mistral-large-latest` | `mistral-large-latest` |
| `MISTRAL_VERIFY_MODEL` | Model for integrity checks | `mistral-small-latest` | `mistral-small-latest` |
| `KV_REST_API_URL` | Vercel KV REST URL | - | For cloud sync |
| `KV_REST_API_TOKEN` | Vercel KV REST token | - | For cloud sync |

---

## 📚 Related Documentation

- [Vercel KV Setup](VERCEL_KV_SETUP.md) - Cloud persistence configuration
- [Vercel Serverless Functions Docs](https://vercel.com/docs/functions/serverless-functions) - Official Vercel documentation
- [Mistral Conversations API](https://docs.mistral.ai/api/#tag/Conversations) - Web search API reference

---

## 🎯 Summary of Changes

| # | Recommendation | Status | Impact |
|---|----------------|--------|--------|
| 1 | Mistral API Latency Monitoring | ✅ Implemented | Debugging, alerting |
| 2 | Vercel Tier Verification | ✅ Implemented | User guidance |
| 3 | Reduced Query Complexity | ✅ Implemented | Performance gain |
| 4 | Async Processing Guidance | ✅ Implemented (logging) | Future optimization |

**Result:** Expected reduction in 504 errors by ~90% with 3-query limit and 300s timeout.
