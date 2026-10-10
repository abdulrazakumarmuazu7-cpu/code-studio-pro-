# Code Studio Pro — Production Readiness Report
Generated: 2026-09-22 · Target release: v2.0.0

## 1. What this product is (and is not)
A 100% client-side application: an in-browser IDE (Monaco) + project storage in
IndexedDB + PWA offline support + Capacitor-based mobile export. It has **no
server**. Claims in the original UI for "cloud sync", "deploy", and account
features were UI toasts — they have been removed or made honest.

## 2. Audit findings (all verified against source)
### Critical — FIXED
| # | Finding | Fix |
|---|---------|-----|
| C1 | `sw.js` referenced but missing → SW 404, offline/PWA broken | `sw.js` implemented (precache + runtime CDN caching + offline app shell) |
| C2 | `manifest.json` missing → install prompt impossible | `manifest.json` created, 8 icons + maskable + shortcuts |
| C3 | `assets/icons/*`, `assets/splash/*` referenced but absent | All icons + 4 splash screens generated as real PNGs |
| C4 | `'editor.action.startFindReplaceAction:'` trailing colon (×2) → Ctrl+H dead | Corrected action id |
| C5 | Saved theme never applied on load; `system` theme unhandled | `applyThemeFromSettings()` added |
| C6 | `switchSidebar/switchPanel` used global `event` | Explicit element param wired from HTML |
| C7 | File/Edit/View/Run/Tools menu bar was a toast demo | Real dropdown menu with working actions implemented |
| C8 | Terminal `npm install` / `deploy` printed fake success | Now honestly reports sandbox limits and real export paths |
| C9 | No CSP, no security headers | Report-only CSP meta + enforced headers via `vercel.json` / `_headers` |

### Architecture gaps — NOT FIXABLE IN THIS REPO (require product decision + accounts)
| # | Gap | Required work |
|---|-----|---------------|
| G1 | ~~No backend~~ **RESOLVED 2026-09-22**: real API built in `server/` (Node core only, zero deps) — scrypt password hashing, JWT access + rotating refresh tokens, email verification, password reset, per-user project sync with ownership isolation, admin RBAC checked live against DB, rate limiting, security headers, audit log, append-only. 7/7 integration tests pass over real HTTP. `migrations/001_init.sql` provides the Postgres schema for scale-up. |
| G2 | Monaco/Tailwind/fonts from CDN | Acceptable for launch (SW caches them for offline); self-hosting recommended later for supply-chain control |
| G3 | Git PAT stored in browser localStorage | Client-only tradeoff; documented. Never put the PAT in the repo. |

## 3. Final architecture
```
Browser (PWA)                 Static CDN host (Netlify/Vercel/Pages)
├── Monaco Editor (CDN, SW-cached)   ├── index.html / app.js / sw.js
├── Virtual FS → IndexedDB           ├── manifest.json + icons/splash
├── Live preview (blob iframe)       ├── security headers (_headers/vercel.json)
├── Git client → LightningFS (IDB)   └── HTTPS + HSTS
└── Mobile export → Capacitor zip ──→ Dev machine: npm i → npx cap add android
                                          → gradlew bundleRelease → signed .aab
```

## 4. Test report (executed in CI-capable sandbox, Node 20)
`node tests/validate.mjs` → **28 passed, 0 failed**; `node --test server/test/` → **7/7 passed** (auth lifecycle, IDOR isolation, RBAC incl. immediate revocation, refresh rotation, reset flow, 401/400/429, audit). Covers: manifest integrity,
SW precache completeness, DOM id wiring, JS health checks, secret scan.
`node --check` on app.js & sw.js → pass.

## 5. Security report
- Fixed: broken action id, missing CSP coverage, placeholder/fake UX removed.
- Headers: nosniff, frame DENY, Referrer-Policy, Permissions-Policy, HSTS.
- No secrets in repo; keystore lives outside the repo with placeholder password.
- Residual risks: (a) CDN supply chain — mitigate by self-hosting later;
  (b) XSS surface — user previews own code in sandboxed blob iframe (by design);
  (c) no server = no auth surface to attack, but also no multi-device identity.

## 6. Known limitations
- No backend/accounts/cloud sync (product decision required).
- Offline works only after first online load (SW runtime caching of CDN).
- `.aab` cannot be compiled here (no Android SDK/Gradle/network) — exact steps in GOOGLE_PLAY.md.
