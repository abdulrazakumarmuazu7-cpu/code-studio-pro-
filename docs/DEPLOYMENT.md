# Deployment Runbook — Website

The site is fully static: any static host works. The repo is already host-ready
(security headers + SW scope + manifest included).

## Option A — Netlify (recommended, free tier OK)
1. Push this folder to GitHub.
2. netlify.com → "Add new site" → Import repo. Build command: *(none)*.
   Publish directory: `/` (root).
3. Domain: Site settings → Domain management → add `app.yourdomain.com`,
   then at your DNS provider: `CNAME app → your-site.netlify.app`.
4. HTTPS: Netlify provisions Let's Encrypt automatically.

## Option B — Vercel
1. Import repo at vercel.com (framework: Other, no build step).
2. `vercel.json` already ships security headers + SPA rewrite.
3. Add domain → Vercel shows the exact DNS records to create (A/CNAME).

## Option C — GitHub Pages
1. Repo → Settings → Pages → Deploy from branch → root.
2. DNS: `CNAME app → your-username.github.io` (or A records to GitHub IPs:
   185.199.108.133 / 109 / 110 / 111).
3. Note: Pages adds no custom headers → keep the report-only CSP meta.

## DNS reference (full production record set)
```
A/AAAA     @      → your host's apex records (host-provided)
CNAME      app    → <host-subdomain>          (website)
TXT        @      → "v=spf1 -all"             (if no email is sent)
CAA        @      → 0 issue "letsencrypt.org" (restricts who can issue certs)
```

## Post-deploy verification checklist
- [ ] https://yourdomain.com loads with padlock, HSTS header present
- [ ] DevTools → Application → Manifest: no errors, icons shown
- [ ] DevTools → Application → Service Workers: activated; "Offline" tick → app still loads
- [ ] Install prompt appears (Chrome, engaged-visit criteria met)
- [ ] Run/preview, file CRUD, git panel, theme toggle all work
- [ ] Lighthouse PWA + Performance ≥ 90 on mobile

## Rollback
Static hosting rollback = redeploy previous commit (Netlify: "Publish deploy";
Vercel: "Promote" previous deployment; Pages: revert commit). RTO < 5 min.

## Backend API deployment (server/ — real, zero-dependency Node)
```bash
cp .env.example .env   # fill in JWT_SECRET (openssl rand -base64 48) and ADMIN_EMAIL
npm run api            # listens on $PORT (default 8080)
```
- **Same origin (recommended):** put a reverse proxy in front — e.g. Caddy: `app.yourdomain.com { reverse_proxy /api/* localhost:8080; root * /var/www/codestudio }`. One TLS cert covers site + API; cookies/headers stay same-origin.
- **Separate host:** set `ALLOWED_ORIGIN=https://app.yourdomain.com` on the API and point the frontend client at it (one-line change in `api.js` constructor).
- Data lives in `DATA_DIR` (JSON files, atomic writes). For multi-node scale, implement `Store` against Postgres using `migrations/001_init.sql` — the interface is documented in `server/src/store.js`.
- Backups: tar `DATA_DIR` on a schedule + copy offsite; verify restores quarterly.
