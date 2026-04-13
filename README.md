# DLP Chrome Extension PoC (MV3 + Cloudflare Worker)

## Folder Structure

- `extension/` - Manifest V3 Chrome extension
- `worker/` - Cloudflare Worker triage backend
- `README.md` - setup and architecture notes

## Setup

### 1) Deploy Worker

1. Install Wrangler: `npm i -D wrangler` (inside `worker/`).
2. Authenticate: `npx wrangler login`.
3. Set Worker vars in `worker/wrangler.toml` for each target:
   - `ALLOWED_EXTENSION_IDS` — Chrome extension IDs allowed to call the Worker (comma-separated).
   - `INTERNAL_HOST_SUFFIXES` — comma-separated host suffixes for **approved** paste destinations (e.g. `crm.corp.com,corp.com,internal.local`). Host matches if it equals the suffix or ends with `.<suffix>`. **Leave empty for strict mode:** any detected PAN/SSN on a normal site (e.g. Wikipedia) is **HIGH**.
4. Deploy by target:
   - Dev: `npx wrangler deploy --env dev`
   - Stage: `npx wrangler deploy --env stage`
   - Prod: `npx wrangler deploy --env prod`
5. Copy each deployed Worker URL.

### 2) Configure Extension

1. Set per-target Worker URLs/hosts in:
   - `extension/config/env.dev.js`
   - `extension/config/env.stage.js`
   - `extension/config/env.prod.js`
2. Select active extension target:
   - `npm run env:dev`
   - `npm run env:stage`
   - `npm run env:prod`
3. This updates `extension/config/current.js` used by the background service worker.
4. Build minified extension package:
   - `npm run build:extension:dev`
   - `npm run build:extension:stage`
   - `npm run build:extension:prod`
5. Load `extension/dist` in Chrome for release testing.

### 3) Load Extension in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `extension/`.

## Architecture

The content script runs on every page, listens for `paste` with a passive non-blocking handler, reads clipboard text from the event, and captures `window.location.href`. It immediately shows a Shadow DOM tooltip (`Payload Evaluated`) near the cursor to avoid host CSS collisions. For MV3-safe networking, the content script sends a fire-and-forget runtime message to `background.js`, and the background service worker performs the outbound `POST` to the Worker using strict endpoint validation and lightweight client-side throttling. The Worker validates schema, enforces optional extension-origin allowlisting, applies request rate limits, and applies **enterprise-style DLP**: it detects likely payment card numbers (16 digits) and formatted US SSNs (`###-##-####`). Paste is **HIGH** when sensitive content is detected and the page host is **not** under `INTERNAL_HOST_SUFFIXES`, or when the host is a known high-risk exfil domain (`pastebin.com`, `reddit.com`). Approved internal apps only receive **SAFE** for those patterns.

## Environment Targets (dev/stage/prod)

- Extension target switching is build-time via `npm run env:*`.
- Worker target switching is deploy-time via `wrangler --env <target>`.
- This avoids editing source between deployments and reduces misconfiguration risk.

## Production Hardening Notes

- Background network calls are isolated to MV3 service worker (`background.js`).
- Worker endpoint must be HTTPS and must match the configured trusted host.
- Manifest includes explicit CSP, disables incognito mode, and blocks external page messaging.
- Release bundle is minified with `esbuild` and emitted to `extension/dist`.

## How this worker achieves <50ms latency globally

This Worker stays under 50ms by running entirely at Cloudflare edge locations, so requests terminate close to users. It uses lightweight TypeScript compiled for V8 isolates, minimizing startup overhead and keeping cold starts short. The request path does only in-memory work: JSON parse, bounded string checks, a few precompiled regexes, and hostname allowlist matching. There are no external API calls, database queries, or remote lookups in the hot path. Extension and internal-suffix allowlists are cached at isolate scope. Responses are compact JSON with minimal branching, enabling predictable execution time and low p50/p95 latency worldwide under normal network conditions.
