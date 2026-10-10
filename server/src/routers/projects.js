// routes/projects.js — server-side cloud sync (per-user, ownership enforced)
import { validate, requireAuth, requireRole } from '../middleware.js';
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

export function registerProjectRoutes(r, ctx) {
  r.get('/api/me', requireAuth, (req, res) => {
    const u = ctx.store.getUser(req.user.sub);
    json(res, 200, { user: { id: u.id, email: u.email, role: u.role, emailVerified: u.emailVerified } });
  });

  r.get('/api/projects', requireAuth, (req, res) =>
    json(res, 200, { projects: ctx.store.listProjects(req.user.sub) }));

  r.get(/^\/api\/projects\/([^/]+)$/, requireAuth, (req, res, _body, m) => {
    const p = ctx.store.getProject(req.user.sub, decodeURIComponent(m[1]));
    if (!p) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Project not found.' } });
    json(res, 200, { project: p });
  });

  r.post('/api/projects/upsert', requireAuth, (req, res, body) => {
    const { errors, value } = validate(body, {
      name: { required: true, type: 'string', min: 1, max: 120 },
      files: { required: true, type: 'object' }
    });
    if (errors.length) return json(res, 400, { error: { code: 'VALIDATION', message: errors.join('; ') } });
    const size = JSON.stringify(value.files).length;
    if (size > 2 * 1024 * 1024) return json(res, 413, { error: { code: 'TOO_LARGE', message: 'Project exceeds 2MB limit.' } });
    const p = ctx.store.upsertProject(req.user.sub, value.name, value.files);
    ctx.store.audit('project.upsert', req.user.sub, { name: value.name, size });
    json(res, 200, { project: p });
  });

  r.delete(/^\/api\/projects\/([^/]+)$/, requireAuth, (req, res, _body, m) => {
    const ok = ctx.store.deleteProject(req.user.sub, decodeURIComponent(m[1]));
    if (!ok) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Project not found.' } });
    ctx.store.audit('project.delete', req.user.sub, { name: decodeURIComponent(m[1]) });
    json(res, 200, { ok: true });
  });
}

// routes/admin.js — RBAC-protected admin operations
export function registerAdminRoutes(r, ctx) {
  const admin = requireRole('admin', ctx.store);
  r.get('/api/admin/users', admin, (req, res) => json(res, 200, { users: ctx.store.listUsers() }));
  r.patch(/^\/api\/admin\/users\/([^/]+)\/role$/, admin, (req, res, body, m) => {
    const role = body?.role === 'admin' ? 'admin' : 'user';
    const u = ctx.store.updateUser(m[1], { role });
    if (!u) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'User not found.' } });
    ctx.store.audit('admin.set_role', req.user.sub, { target: m[1], role });
    json(res, 200, { ok: true });
  });
  r.delete(/^\/api\/admin\/users\/([^/]+)$/, admin, (req, res, _body, m) => {
    if (m[1] === req.user.sub) return json(res, 400, { error: { code: 'SELF_DELETE', message: 'You cannot delete your own account here.' } });
    if (!ctx.store.deleteUser(m[1])) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'User not found.' } });
    ctx.store.audit('admin.delete_user', req.user.sub, { target: m[1] });
    json(res, 200, { ok: true });
  });
  r.get('/api/admin/audit', admin, (req, res) => {
    const fs = require('node:fs');
    let lines = [];
    try { lines = fs.readFileSync(require('node:path').join(ctx.store.dir, 'audit.log'), 'utf8').trim().split('\n').filter(Boolean).slice(-200).map(JSON.parse); } catch {}
    json(res, 200, { entries: lines });
  });
}
