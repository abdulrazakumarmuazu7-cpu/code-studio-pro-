# Security Notes
- Secrets policy: `.env` and `*.keystore` are gitignored and were verified
  absent from the repo (CI job fails the build if they appear).
- Git token: entered in-app, stored only in your browser's localStorage,
  sent only to the git host you configure. Use a fine-grained PAT with
  repo scope, never your password. The default CORS proxy is a public demo —
  do not push private repos through it; self-host isomorphic-git's cors proxy
  for sensitive work.
- Preview iframe: runs your own code in a sandboxed blob origin. It is
  same-origin-sandboxed; treat previewed code as trusted only if you wrote it.
- Headers shipped: nosniff, frame-deny, referrer-policy, permissions-policy,
  HSTS (CDN-level), report-only CSP in-app.
