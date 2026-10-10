// middleware.js — auth guard, RBAC, rate limiting, validation, security headers
import { verifyJwt } from './auth.js';

export function securityHeaders(req, res, allowedOrigin) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const origin = req.headers.origin;
  if (allowedOrigin && origin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
}

// --- in-memory token-bucket rate limiter (per IP+route) ---
const buckets = new Map();
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 60_000).unref();
export function rateLimit({ windowMs = 60_000, max = 30, key = 'global' } = {}) {
  return (req, res) => {
    const k = `${key}:${req.socket.remoteAddress}`;
    const t = Date.now();
    let b = buckets.get(k);
    if (!b || b.reset < t) { b = { count: 0, reset: t + windowMs }; buckets.set(k, b); }
    if (++b.count > max) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } })); return false; }
    return true;
  };
}

export function resetRateLimits() { buckets.clear(); } // test hook — production never calls this

// --- auth ---
export function attachUser(req, res, ctx) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  req.user = token ? verifyJwt(token, ctx.jwtSecret) : null;
}
export function requireAuth(req, res) {
  if (!req.user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Login required.' } })); return false; }
  return true;
}
export function requireRole(role, store) {
  return (req, res) => {
    if (!requireAuth(req, res)) return false;
    const live = store ? store.getUser(req.user.sub) : null; // DB check: role changes/revocations apply immediately
    if (!live || live.role !== role) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Admin role required.' } })); return false; }
    return true;
  };
}

// --- validation ---
export function validate(body, rules) {
  const errors = [];
  const out = {};
  for (const [field, rule] of Object.entries(rules)) {
    const v = body?.[field];
    if (v === undefined || v === null || v === '') { if (rule.required) errors.push(`${field} is required`); continue; }
    if (rule.type === 'string' && typeof v !== 'string') errors.push(`${field} must be a string`);
    else if (rule.type === 'object' && (typeof v !== 'object' || Array.isArray(v))) errors.push(`${field} must be an object`);
    else if (rule.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) errors.push(`${field} must be a valid email`);
    else {
      if (rule.min && String(v).length < rule.min) errors.push(`${field} must be at least ${rule.min} characters`);
      if (rule.max && String(v).length > rule.max) errors.push(`${field} must be at most ${rule.max} characters`);
      out[field] = v;
    }
  }
  return { errors, value: out };
}
