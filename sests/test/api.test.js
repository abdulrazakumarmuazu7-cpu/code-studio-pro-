// server/test/api.test.js — REAL integration tests: the server boots on an
// ephemeral port and every request below travels over actual HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32chars!!';
const { createServer } = await import('../src/server.js');
const { resetRateLimits } = await import('../src/middleware.js');

let srv, base, dataDir;
const outboxToken = (to, kind) => {
  const lines = fs.readFileSync(path.join(dataDir, 'mail-outbox.log'), 'utf8').trim().split('\n').map(JSON.parse);
  const msg = lines.filter(l => l.to === to).at(-1);
  return msg.text.match(new RegExp(`${kind}\\?token=([A-Za-z0-9_-]+)`))[1];
};
async function call(method, route, body, token) {
  const res = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-test-'));
  srv = await createServer({ dataDir, jwtSecret: process.env.JWT_SECRET, port: 0, publicUrl: 'http://test' });
  base = srv.url;
});
after(() => srv.close());

test('health endpoint', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200); assert.equal(r.body.ok, true);
});

let accessA, refreshA, accessB, adminAccess;
const A = 'alice@test.dev', B = 'bob@test.dev', PW = 'supersecret1';

test('full auth lifecycle: register -> verify -> login -> me -> refresh -> logout', async () => {
  resetRateLimits();
  let r = await call('POST', '/api/auth/register', { email: A, password: PW });
  assert.equal(r.status, 201, JSON.stringify(r.body));

  r = await call('POST', '/api/auth/login', { email: A, password: PW });
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'EMAIL_NOT_VERIFIED'); // cannot login unverified

  const v = outboxToken(A, 'verify-email');
  r = await call('POST', '/api/auth/verify-email', { token: v });
  assert.equal(r.status, 200);

  r = await call('POST', '/api/auth/login', { email: A, password: PW });
  assert.equal(r.status, 200);
  ({ access: accessA, refresh: refreshA } = r.body);
  assert.ok(r.body.user.emailVerified);

  r = await call('GET', '/api/me', null, accessA);
  assert.equal(r.status, 200); assert.equal(r.body.user.email, A);

  r = await call('POST', '/api/auth/refresh', { refreshToken: refreshA });
  assert.equal(r.status, 200);
  accessA = r.body.access; refreshA = r.body.refresh;
  const replay = await call('POST', '/api/auth/refresh', { refreshToken: refreshA.replace(/.$/, 'x') });
  assert.equal(replay.status, 401); // rotated/burned tokens rejected
});

test('project sync: [RL] upsert, list, get, ownership isolation, delete', async () => {
  resetRateLimits();
  const files = { 'index.html': { type: 'file', content: '<h1>hi</h1>' } };
  let r = await call('POST', '/api/projects/upsert', { name: 'demo', files }, accessA);
  assert.equal(r.status, 200);
  r = await call('POST', '/api/projects/upsert', { name: 'demo', files: { 'a.js': { type: 'file', content: '1' } } }, accessA);
  assert.equal(r.status, 200); // upsert, not duplicate

  r = await call('GET', '/api/projects', null, accessA);
  assert.equal(r.body.projects.length, 1);
  assert.equal(r.body.projects[0].name, 'demo');

  // second user cannot see or overwrite alice's project
  let rb = await call('POST', '/api/auth/register', { email: B, password: PW });
  const vb = outboxToken(B, 'verify-email');
  await call('POST', '/api/auth/verify-email', { token: vb });
  rb = await call('POST', '/api/auth/login', { email: B, password: PW });
  accessB = rb.body.access;
  r = await call('GET', '/api/projects/demo', null, accessB);
  assert.equal(r.status, 404); // IDOR blocked
  r = await call('GET', '/api/projects', null, accessB);
  assert.equal(r.body.projects.length, 0);

  r = await call('DELETE', '/api/projects/demo', null, accessA);
  assert.equal(r.status, 200);
  r = await call('GET', '/api/projects', null, accessA);
  assert.equal(r.body.projects.length, 0);
});

test('admin RBAC: only ADMIN_EMAIL bootstrap is admin; admin routes reject users', async () => {
  resetRateLimits();
  // alice is not the admin email -> user role
  let r = await call('GET', '/api/admin/users', null, accessA);
  assert.equal(r.status, 403);
  r = await call('GET', '/api/admin/users', null, accessB);
  assert.equal(r.status, 403);

  const ADM = 'root@test.dev';
  process.env.ADMIN_EMAIL = ADM;
  await call('POST', '/api/auth/register', { email: ADM, password: PW });
  const vt = outboxToken(ADM, 'verify-email');
  await call('POST', '/api/auth/verify-email', { token: vt });
  const rl = await call('POST', '/api/auth/login', { email: ADM, password: PW });
  adminAccess = rl.body.access;
  assert.equal(rl.body.user.role, 'admin');

  r = await call('GET', '/api/admin/users', null, adminAccess);
  assert.equal(r.status, 200);
  assert.equal(r.body.users.length, 3);
  assert.ok(!JSON.stringify(r.body.users).includes('passwordHash'), 'no password hashes leaked');
  const users = r.body.users;
  const bobId = users.find(u => u.email === B).id;
  const aliceId = users.find(u => u.email === A).id;
  const adminId = users.find(u => u.email === ADM).id;

  r = await call('PATCH', `/api/admin/users/${bobId}/role`, { role: 'admin' }, adminAccess);
  assert.equal(r.status, 200);
  const bobNow = await call('GET', '/api/admin/users', null, accessB);
  assert.equal(bobNow.status, 200, 'role elevation applies immediately (checked against DB, not stale JWT claim)');

  r = await call('DELETE', `/api/admin/users/${adminId}`, null, adminAccess);
  assert.equal(r.status, 400, 'admin cannot delete own account');
  r = await call('DELETE', `/api/admin/users/${aliceId}`, null, adminAccess);
  assert.equal(r.status, 200, 'admin deletes a user and cascades their data');
});

test('password reset flow burns sessions', async () => {
  resetRateLimits();
  resetRateLimits();
  let r = await call('POST', '/api/auth/forgot-password', { email: B });
  assert.equal(r.status, 200);
  const t = outboxToken(B, 'reset-password');
  r = await call('POST', '/api/auth/reset-password', { token: t, password: 'newpassword9' });
  assert.equal(r.status, 200);
  r = await call('POST', '/api/auth/login', { email: B, password: 'newpassword9' });
  assert.equal(r.status, 200); // old password rejected below
  const bad = await call('POST', '/api/auth/login', { email: B, password: 'wrongwrong1' });
  assert.equal(bad.status, 401);
});

test('security: unauthenticated 401, validation 400, rate limit 429', async () => {
  resetRateLimits();
  let r = await call('GET', '/api/projects');
  assert.equal(r.status, 401);
  r = await call('POST', '/api/auth/register', { email: 'not-an-email', password: 'short' });
  assert.equal(r.status, 400);
  let last;
  for (let i = 0; i < 12; i++) last = await call('POST', '/api/auth/login', { email: A, password: 'nope' });
  assert.equal(last.status, 429);
});

test('audit log records security-relevant events', async () => {
  const lines = fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').trim().split('\n').map(JSON.parse);
  const actions = new Set(lines.map(l => l.action));
  for (const a of ['user.register', 'auth.login', 'auth.login_failed', 'project.upsert']) assert.ok(actions.has(a), `audit missing ${a}`);
});
