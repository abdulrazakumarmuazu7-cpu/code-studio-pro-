// store.js — persistent file-backed store (atomic writes) with the exact
// interface a Postgres adapter must implement (see migrations/001_init.sql).
import fs from 'node:fs';
import path from 'node:path';

const now = () => new Date().toISOString();

export class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.users = this.load('users');       // Map id -> user
    this.projects = this.load('projects'); // Map id -> project
    this.sessions = this.load('sessions'); // Map tokenHash -> {userId, expiry}
    this.byEmail = new Map();              // email -> userId
    for (const u of this.users.values()) this.byEmail.set(u.email, u.id);
  }
  file(name) { return path.join(this.dir, `${name}.json`); }
  load(name) {
    try { return new Map(Object.entries(JSON.parse(fs.readFileSync(this.file(name), 'utf8')))); }
    catch { return new Map(); }
  }
  persist(name, map) {
    const tmp = this.file(name + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(map)));
    fs.renameSync(tmp, this.file(name)); // atomic
  }
  audit(action, userId, meta = {}) {
    fs.appendFileSync(path.join(this.dir, 'audit.log'),
      JSON.stringify({ ts: now(), action, userId, meta }) + '\n');
  }
  // mail outbox: real transport is SMTP (env SMTP_URL); in dev/test the server
  // writes the message here so flows are fully exercisable without an SMTP server.
  sendMail(to, subject, text) {
    fs.appendFileSync(path.join(this.dir, 'mail-outbox.log'), JSON.stringify({ to, subject, text, ts: now() }) + '\n');
  }

  // ---- users ----
  createUser({ email, passwordHash, role = 'user' }) {
    email = email.toLowerCase().trim();
    if (this.byEmail.has(email)) return null;
    const user = { id: require_crypto(), email, passwordHash, role,
      emailVerified: false, verifyToken: null, verifyExpiry: null,
      resetToken: null, resetExpiry: null, createdAt: now() };
    this.users.set(user.id, user); this.byEmail.set(email, user.id); this.persist('users', this.users);
    return user;
  }
  getUser(id) { return this.users.get(id) || null; }
  getUserByEmail(email) { const id = this.byEmail.get(String(email).toLowerCase().trim()); return id ? this.users.get(id) : null; }
  updateUser(id, patch) { const u = this.users.get(id); if (!u) return null; Object.assign(u, patch); this.persist('users', this.users); return u; }
  deleteUser(id) { const u = this.users.get(id); if (!u) return false; this.users.delete(id); this.byEmail.delete(u.email);
    for (const [pid, p] of this.projects) if (p.userId === id) this.projects.delete(pid);
    for (const [h, s] of this.sessions) if (s.userId === id) this.sessions.delete(h);
    this.persist('users', this.users); this.persist('projects', this.projects); this.persist('sessions', this.sessions); return true; }
  listUsers() { return [...this.users.values()].map(({ passwordHash, verifyToken, resetToken, ...u }) => u); }

  // ---- sessions (refresh tokens, hashed at rest) ----
  createSession(userId, tokenHash, ttlMs) {
    this.sessions.set(tokenHash, { userId, expiry: Date.now() + ttlMs }); this.persist('sessions', this.sessions);
  }
  getSession(tokenHash) { const s = this.sessions.get(tokenHash); if (!s) return null; if (s.expiry < Date.now()) { this.sessions.delete(tokenHash); this.persist('sessions', this.sessions); return null; } return s; }
  deleteSession(tokenHash) { this.sessions.delete(tokenHash); this.persist('sessions', this.sessions); }

  // ---- projects (server-side cloud sync: per-user, unique name) ----
  upsertProject(userId, name, files) {
    for (const [id, p] of this.projects) {
      if (p.userId === userId && p.name === name) {
        p.files = files; p.updatedAt = now(); this.persist('projects', this.projects); return p;
      }
    }
    const p = { id: require_crypto(), userId, name, files, createdAt: now(), updatedAt: now() };
    this.projects.set(p.id, p); this.persist('projects', this.projects); return p;
  }
  listProjects(userId) { return [...this.projects.values()].filter(p => p.userId === userId).map(({ files, ...p }) => ({ ...p, fileCount: Object.keys(files).length })); }
  getProject(userId, name) { for (const p of this.projects.values()) if (p.userId === userId && p.name === name) return p; return null; }
  deleteProject(userId, name) { for (const [id, p] of this.projects) if (p.userId === userId && p.name === name) { this.projects.delete(id); this.persist('projects', this.projects); return true; } return false; }
}

// small indirection so auth.js owns id generation (kept here to avoid a circular import)
import { randomBytes } from 'node:crypto';
function require_crypto() { return randomBytes(12).toString('hex'); }
