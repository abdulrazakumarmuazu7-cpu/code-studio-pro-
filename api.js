// api.js — real backend client. Talks to the same-origin API (server/).
// Offline-first: every method throws a typed error the UI surfaces honestly.
class CodeStudioAPI {
  constructor(base = '') {
    this.base = base;
    this.access = null; this.refresh = null; this.user = null;
    try {
      const saved = JSON.parse(localStorage.getItem('csp-auth') || 'null');
      if (saved) ({ access: this.access, refresh: this.refresh, user: this.user } = saved);
    } catch {}
  }
  persist() { localStorage.setItem('csp-auth', JSON.stringify({ access: this.access, refresh: this.refresh, user: this.user })); }
  clear() { this.access = this.refresh = this.user = null; localStorage.removeItem('csp-auth'); }

  async _req(path, { method = 'GET', body, auth = true, retry = true } = {}) {
    let res;
    try {
      res = await fetch(this.base + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(auth && this.access ? { Authorization: `Bearer ${this.access}` } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      const e = new Error('Cannot reach the sync server. Check your connection or host the API (docs/DEPLOYMENT.md).');
      e.code = 'NETWORK'; throw e;
    }
    if (res.status === 401 && retry && this.refresh) {
      try { await this._refresh(); return this._req(path, { method, body, auth, retry: false }); }
      catch { this.clear(); throw Object.assign(new Error('Session expired — log in again.'), { code: 'SESSION_EXPIRED' }); }
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error?.message || `Request failed (${res.status})`), { code: data.error?.code || 'HTTP_' + res.status, status: res.status });
    return data;
  }
  async _refresh() {
    const r = await fetch(this.base + '/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: this.refresh }) });
    if (!r.ok) throw new Error('refresh failed');
    const d = await r.json(); this.access = d.access; this.refresh = d.refresh; this.persist();
  }

  async register(email, password) { const d = await this._req('/api/auth/register', { method: 'POST', body: { email, password }, auth: false }); return d; }
  async verifyEmail(token) { return this._req('/api/auth/verify-email', { method: 'POST', body: { token }, auth: false }); }
  async login(email, password) {
    const d = await this._req('/api/auth/login', { method: 'POST', body: { email, password }, auth: false });
    this.access = d.access; this.refresh = d.refresh; this.user = d.user; this.persist(); return d.user;
  }
  async logout() { try { await this._req('/api/auth/logout', { method: 'POST', body: { refreshToken: this.refresh }, auth: false }); } finally { this.clear(); } }
  async me() { const d = await this._req('/api/me'); this.user = d.user; this.persist(); return d.user; }

  async listProjects() { return (await this._req('/api/projects')).projects; }
  async saveProject(name, files) { return (await this._req('/api/projects/upsert', { method: 'POST', body: { name, files } })).project; }
  async deleteProject(name) { return this._req('/api/projects/' + encodeURIComponent(name), { method: 'DELETE' }); }
}
window.CodeStudioAPI = CodeStudioAPI;
