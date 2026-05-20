# Vercel KV setup for gg-scanner

The scanner works with **only** `ANTHROPIC_API_KEY` — pipeline, scans, and config are stored in **this browser** via `localStorage`.

For **cloud persistence** (same data on every device and after clearing browser data), add Upstash Redis through Vercel.

## Steps

1. Open your **gg-scanner** project in the [Vercel Dashboard](https://vercel.com/dashboard).
2. Go to **Storage** → **Create Database** → **KV** (Upstash Redis).
3. Name it (e.g. `gg-scanner-kv`) and link it to the **gg-scanner** project.
4. Vercel will auto-add these environment variables to the project:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
5. **Redeploy** the project (Deployments → … → Redeploy) so the new env vars are active.

## Verify

After redeploy, the red **Browser-only storage** notice in the header should disappear. New scans should appear in the sidebar after refresh, and pipeline articles should survive on another browser once KV is working.

## Required vs optional env vars

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes | Intelligence scan, briefs, articles |
| `KV_REST_API_URL` | No (cloud sync) | Persist scans, pipeline, config |
| `KV_REST_API_TOKEN` | No (cloud sync) | Same |

Optional model overrides: `ANTHROPIC_MODEL`, `ANTHROPIC_VERIFY_MODEL`.
