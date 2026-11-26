# WorkSphere Content Security Policy (CSP) Guide

## 1. Request-Scoped Nonce Architecture (`src/middleware.ts`)
Every dynamic request passing through `src/middleware.ts` generates a fresh 128-bit cryptographic nonce using `crypto.getRandomValues` encoded as base64:
- A unique nonce is created per request—never reused across users or cached responses.
- The nonce is injected into the `Content-Security-Policy` response header (`'nonce-<value>'`) and forwarded on request headers via `x-nonce`.
- Static assets under `/_next/static`, `/_next/image`, `favicon.ico`, and common image extensions are excluded via `config.matcher` so CDN caching remains clean.

## 2. CSP Directive Breakdown & External Domains
| Directive | Policy / Allowed Origins | Purpose |
| --- | --- | --- |
| `default-src` | `'self'` | Safe baseline fallback when a specific directive is absent. |
| `script-src` | `'self'`, `'nonce-<nonce>'`, `'strict-dynamic'`, `https://*.clerk.accounts.dev`, `https://*.clerk.com`, `https://api.mapbox.com`, `https://events.mapbox.com` | Permits nonce-bearing scripts, Clerk auth SDKs, and Mapbox GL JS. |
| `style-src` | `'self'`, `'nonce-<nonce>'`, `'unsafe-inline'`, `https://api.mapbox.com` | Supports component/Mapbox stylesheets and runtime style injection. |
| `img-src` | `'self'`, `data:`, `blob:`, `https://images.unsplash.com`, `https://res.cloudinary.com`, `https://img.clerk.com`, `https://*.clerk.com`, `https://*.mapbox.com` | Allows venue photos, avatars, data/blob previews, and map tiles. |
| `connect-src` | `'self'`, `https://*.clerk.accounts.dev`, `https://*.clerk.com`, `https://api.mapbox.com`, `https://events.mapbox.com`, `https://*.tiles.mapbox.com`, `https://api.devnet.solana.com`, `https://api.mainnet-beta.solana.com`, `wss://api.devnet.solana.com`, `wss://api.mainnet-beta.solana.com` | Restricts `fetch`, `XHR`, WebSockets, and Solana RPC/escrow calls. |
| `worker-src` | `'self'`, `blob:` | Enables Web Workers used by map rendering and client utilities. |
| `frame-src` | `'self'`, `https://*.clerk.accounts.dev`, `https://*.clerk.com` | Allows Clerk embedded authentication frames. |
| `object-src` & `frame-ancestors` | `'none'` | Blocks legacy plugins (`<object>`/`<embed>`) and clickjacking framing. |

## 3. Guidelines for Allowlisting New Providers
1. **Identify exact sub-origins:** Add only the specific hostnames needed (e.g., `https://*.tiles.mapbox.com`) rather than broad wildcards like `https://*`.
2. **Place in the narrowest directive:** Add API/telemetry endpoints to `connect-src`, image CDNs to `img-src`, and scripts to `script-src`.
3. **Avoid `'unsafe-eval'`:** Do not enable `'unsafe-eval'` unless strictly required by a verified dependency and approved during security review.
4. **Keep `docs/security/csp-policy.md` in sync:** Update the table above whenever a new third-party host is added to `buildContentSecurityPolicy`.

## 4. Debugging CSP Violations in Browser DevTools
1. **Read the exact violation message:** Open Chrome/Edge/Firefox DevTools -> **Console** and inspect `Refused to ... because it violates the following Content Security Policy directive: "<directive> ..."`.
2. **Match failing URL to directive:**
   - Blocked `fetch` / WebSocket / RPC call -> check `connect-src`.
   - Blocked `<img src>` or map tile -> check `img-src` (and ensure chat markdown images only embed trusted hosts).
   - Blocked script or worker -> check `script-src` or `worker-src`.
3. **Verify nonce & response headers:** In DevTools -> **Network**, select the document request and confirm `Content-Security-Policy` and `x-nonce` are present and match.
4. **Re-test across modes:** Verify fixes in both normal and incognito/private windows so browser extensions do not mask or trigger false positives.
