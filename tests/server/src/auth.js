// auth.js — real password hashing (scrypt) + JWT (HS256) using node:crypto only
import crypto from 'node:crypto';

const b64u = (s) => Buffer.from(s).toString('base64url');

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [, saltHex, hashHex] = stored.split(':');
    const candidate = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
    return crypto.timingSafeEqual(candidate, Buffer.from(hashHex, 'hex'));
  } catch { return false; }
}

export function signJwt(payload, secret, ttlSec) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }));
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export const newRefreshToken = () => crypto.randomBytes(48).toString('base64url');
export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
export const newId = () => crypto.randomBytes(12).toString('hex');
export const newCode = () => crypto.randomBytes(32).toString('base64url');
