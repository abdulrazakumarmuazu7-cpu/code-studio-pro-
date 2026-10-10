// routes/auth.js — real registration, email verification, login, refresh, reset
import { hashPassword, verifyPassword, signJwt, verifyJwt, newRefreshToken, hashToken, newCode } from '../auth.js';
import { validate, rateLimit } from '../middleware.js';

const ACCESS_TTL = 15 * 60;              // 15 min
const REFRESH_TTL = 30 * 24 * 3600 * 1000; // 30 days
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const publicUser = (u) => ({ id: u.id, email: u.email, role: u.role, emailVerified: u.emailVerified, createdAt: u.createdAt });

function issueTokens(ctx, user) {
  const access = signJwt({ sub: user.id, role: user.role }, ctx.jwtSecret, ACCESS_TTL);
  const refresh = newRefreshToken();
  ctx.store.createSession(user.id, hashToken(refresh), REFRESH_TTL);
  return { access, refresh };
}

export function registerAuthRoutes(r, ctx) {
  const limit = rateLimit({ windowMs: 60_000, max: 10, key: 'auth' });

  r.post('/api/auth/register', limit, (req, res, body) => {
    const { errors, value } = validate(body, {
      email: { required: true, type: 'email', max: 254 },
      password: { required: true, type: 'string', min: 8, max: 128 }
    });
    if (errors.length) return json(res, 400, { error: { code: 'VALIDATION', message: errors.join('; ') } });
    const existing = ctx.store.getUserByEmail(value.email);
    if (existing && existing.emailVerified) return json(res, 409, { error: { code: 'EMAIL_TAKEN', message: 'Email already registered.' } });
    if (existing) ctx.store.deleteUser(existing.id); // allow re-register to replace an unverified account

    const role = value.email.toLowerCase() === (process.env.ADMIN_EMAIL || '').toLowerCase() ? 'admin' : 'user';
    const user = ctx.store.createUser({ email: value.email, passwordHash: hashPassword(value.password), role });
    const token = newCode();
    ctx.store.updateUser(user.id, { verifyToken: token, verifyExpiry: Date.now() + 24 * 3600 * 1000 });
    ctx.store.sendMail(user.email, 'Verify your Code Studio account',
      `Verify: ${ctx.publicUrl}/verify-email?token=${token}`);
    ctx.store.audit('user.register', user.id, { email: user.email });
    json(res, 201, { user: publicUser(user), message: 'Registered. Check your email (or the server mail outbox) for the verification link.' });
  });

  r.post('/api/auth/verify-email', limit, (req, res, body) => {
    const token = String(body?.token || '');
    for (const u of ctx.store.users.values()) {
      if (u.verifyToken && u.verifyToken === token && u.verifyExpiry > Date.now()) {
        ctx.store.updateUser(u.id, { emailVerified: true, verifyToken: null, verifyExpiry: null });
        ctx.store.audit('user.verify', u.id);
        return json(res, 200, { ok: true });
      }
    }
    json(res, 400, { error: { code: 'INVALID_TOKEN', message: 'Verification link is invalid or expired.' } });
  });

  r.post('/api/auth/login', limit, (req, res, body) => {
    const { errors, value } = validate(body, {
      email: { required: true, type: 'email' }, password: { required: true, type: 'string', min: 1, max: 128 }
    });
    if (errors.length) return json(res, 400, { error: { code: 'VALIDATION', message: errors.join('; ') } });
    const user = ctx.store.getUserByEmail(value.email);
    if (!user || !verifyPassword(value.password, user.passwordHash)) {
      ctx.store.audit('auth.login_failed', null, { email: value.email });
      return json(res, 401, { error: { code: 'BAD_CREDENTIALS', message: 'Invalid email or password.' } });
    }
    if (!user.emailVerified) return json(res, 403, { error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email before logging in.' } });
    const tokens = issueTokens(ctx, user);
    ctx.store.audit('auth.login', user.id);
    json(res, 200, { user: publicUser(user), ...tokens });
  });

  r.post('/api/auth/refresh', limit, (req, res, body) => {
    const token = String(body?.refreshToken || '');
    const sess = ctx.store.getSession(hashToken(token));
    if (!sess) return json(res, 401, { error: { code: 'INVALID_REFRESH', message: 'Session expired, login again.' } });
    const user = ctx.store.getUser(sess.userId);
    if (!user) return json(res, 401, { error: { code: 'INVALID_REFRESH', message: 'User no longer exists.' } });
    ctx.store.deleteSession(hashToken(token)); // rotation: old refresh token is burned
    json(res, 200, issueTokens(ctx, user));
  });

  r.post('/api/auth/logout', (req, res, body) => {
    if (body?.refreshToken) ctx.store.deleteSession(hashToken(String(body.refreshToken)));
    json(res, 200, { ok: true });
  });

  r.post('/api/auth/forgot-password', limit, (req, res, body) => {
    json(res, 200, { ok: true }); // always 200 — do not leak which emails exist
    const user = ctx.store.getUserByEmail(String(body?.email || ''));
    if (!user) return;
    const token = newCode();
    ctx.store.updateUser(user.id, { resetToken: token, resetExpiry: Date.now() + 3600 * 1000 });
    ctx.store.sendMail(user.email, 'Reset your Code Studio password',
      `Reset: ${ctx.publicUrl}/reset-password?token=${token}`);
  });

  r.post('/api/auth/reset-password', limit, (req, res, body) => {
    const { errors, value } = validate(body, { password: { required: true, type: 'string', min: 8, max: 128 } });
    if (errors.length) return json(res, 400, { error: { code: 'VALIDATION', message: errors.join('; ') } });
    for (const u of ctx.store.users.values()) {
      if (u.resetToken && u.resetToken === String(body?.token || '') && u.resetExpiry > Date.now()) {
        ctx.store.updateUser(u.id, { passwordHash: hashPassword(value.password), resetToken: null, resetExpiry: null });
        for (const [h, s] of ctx.store.sessions) if (s.userId === u.id) ctx.store.deleteSession(h); // force re-login everywhere
        ctx.store.audit('user.reset_password', u.id);
        return json(res, 200, { ok: true });
      }
    }
    json(res, 400, { error: { code: 'INVALID_TOKEN', message: 'Reset link is invalid or expired.' } });
  });
}
