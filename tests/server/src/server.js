// server.js — zero-dependency production HTTP API (Node >= 18)
import http from 'node:http';
import { Store } from './store.js';
import { securityHeaders, attachUser } from './middleware.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerProjectRoutes, registerAdminRoutes } from './routes/projects.js';

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) { this.routes.push({ method, pattern, handlers }); }
  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  patch(p, ...h) { this.add('PATCH', p, ...h); }
  delete(p, ...h) { this.add('DELETE', p, ...h); }
  match(method, url) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      if (typeof r.pattern === 'string' && r.pattern === url) return { route: r, m: null };
      if (r.pattern instanceof RegExp) { const m = url.match(r.pattern); if (m) return { route: r, m }; }
    }
    return null;
  }
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('PAYLOAD_TOO_LARGE')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new Error('BAD_JSON')); } });
    req.on('error', reject);
  });
}

export function createServer({ dataDir, jwtSecret, port = 8080, allowedOrigin = '', publicUrl = 'http://localhost:8080' } = {}) {
  if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET (>=32 chars) is required — refusing to boot without it.');
  const store = new Store(dataDir);
  const ctx = { store, jwtSecret, publicUrl };
  const r = new Router();
  registerAuthRoutes(r, ctx);
  registerProjectRoutes(r, ctx);
  registerAdminRoutes(r, ctx);

  const server = http.createServer(async (req, res) => {
    securityHeaders(req, res, allowedOrigin);
    const u = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (u.pathname === '/api/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, ts: Date.now() })); }

    const hit = r.match(req.method, u.pathname);
    if (!hit) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found.' } })); }
    attachUser(req, res, ctx);
    try {
      const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
      for (const h of hit.route.handlers) {
        const out = h.length >= 4 ? h(req, res, body, hit.m, ctx) : h(req, res, body);
        if (out === false) return;                 // a middleware already responded
        if (res.writableEnded) return;
      }
    } catch (e) {
      if (!res.writableEnded) { res.writeHead(e.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: e.message, message: 'Malformed request.' } })); }
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, store, url: `http://localhost:${server.address().port}`, close: () => server.close() }));
  });
}
