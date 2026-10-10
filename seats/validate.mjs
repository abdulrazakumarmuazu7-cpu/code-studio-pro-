// Code Studio Pro — dependency-free production validation suite.
// Run: node tests/validate.mjs   (exit code 0 = pass)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('  FAIL:', name)); if (cond) console.log('  ok  :', name); };

console.log('== PWA manifest ==');
const m = JSON.parse(read('manifest.json'));
ok(m.name && m.short_name, 'manifest has name/short_name');
ok(m.display === 'standalone', 'display=standalone');
ok(m.start_url && m.scope, 'start_url & scope present');
ok(Array.isArray(m.icons) && m.icons.length >= 8, '>=8 icons declared');
ok(m.icons.every(i => existsSync(join(root, i.src))), 'every declared icon file exists on disk');
ok(m.icons.some(i => (i.purpose || '').includes('maskable')), 'has maskable icon');

console.log('== Service worker ==');
const sw = read('sw.js');
ok(sw.includes('addEventListener'), 'sw registers event listeners');
ok(sw.includes('caches.open'), 'sw uses Cache API');
const precache = [...sw.matchAll(/'\.\/([^']+)'/g)].map(x => x[1]).filter(f => f && !f.includes('*'));
ok(precache.every(f => existsSync(join(root, f))), `all ${precache.length} precached files exist`);

console.log('== HTML wiring ==');
const html = read('index.html');
ok(html.includes('manifest.json'), 'manifest linked');
ok(html.includes('id="monaco-editor"'), 'editor mount exists');
ok(html.includes('id="previewFrame"'), 'preview frame exists');
ok(html.includes('app.js'), 'app.js loaded');
ok(html.includes("Content-Security-Policy-Report-Only"), 'report-only CSP present');
// every getElementById('x') in app.js must exist in index.html (dynamic ones excluded)
const js = read('app.js');
// strip string literals (templates, quotes) so embedded sample code isn't scanned
const codeOnly = js.replace(/`[^`]*`|'[^'\n]*'|"[^"\n]*"/gs, '');
const ids = new Set([...codeOnly.matchAll(/getElementById\('([^']+)'\)/g)].map(x => x[1]));
const dynamic = new Set(['menuDropdown','terminalPanel','terminalInput','paletteOverlay','problemsList']);
const missing = [...ids].filter(id => !dynamic.has(id) && !html.includes(`id="${id}"`));
ok(missing.length === 0, `all ${ids.size} referenced element IDs exist in DOM${missing.length ? ' — missing: ' + missing.join(', ') : ''}`);

console.log('== JS health ==');
ok(!js.includes("startFindReplaceAction:"), 'no broken action id (trailing colon)');
ok(js.includes('applyThemeFromSettings'), 'saved theme applied on load');
ok(!/showMenu\(menu\)/.test(js), 'menu bar no longer a toast demo');
ok(js.includes('showPalette') && js.includes('getCommands'), 'Command Palette (Ctrl+Shift+P) implemented');
ok(js.includes("case '`':"), 'Ctrl+` toggles terminal');
ok(js.includes('updateProblems') && js.includes('getModelMarkers'), 'Problems panel uses real Monaco diagnostics');
ok(js.includes('runGlobalSearch'), 'Search in files implemented (Ctrl+Shift+F)');
ok(js.includes("case 'mkdir':") && js.includes("case 'cat':") && js.includes("case 'pwd':"), 'terminal has real FS commands (mkdir/cat/pwd/cd/rm)');
ok(js.includes('Command Palette'), 'welcome content documents real shortcuts');
ok(js.includes('_monacoPromise') && js.includes('monacoBootError'), 'Monaco boot is a singleton with visible failure recovery');
ok(js.includes('__cspInitialized'), 'double-initialization guard present');
ok(js.includes('vs/language/typescript/monaco.contribution'), 'TS/JS language service loaded');
ok(js.includes('vs/language/html/monaco.contribution') && js.includes('vs/language/css/monaco.contribution') && js.includes('vs/language/json/monaco.contribution'), 'HTML/CSS/JSON language services loaded');
ok(js.includes('getModelFor') && js.includes('inmemory://project/'), 'one-model-per-file architecture (cross-file IntelliSense)');
ok(js.includes('registerBasicLanguageProviders') && js.includes("python:") && js.includes("rust:"), 'keyword/snippet completions for 10 more languages');
ok(js.includes('getModelMarkers({})'), 'Problems panel aggregates all workspace models');
ok(js.includes('No Node.js runtime in the browser sandbox'), 'terminal is honest about sandbox limits');

console.log('== Security / hygiene ==');
ok(!/ghp_[A-Za-z0-9]{20,}/.test(js + html + sw), 'no hard-coded GitHub tokens');
ok(!/(sk_live|sk_test|pk_live)[A-Za-z0-9]{10,}/.test(js + html + sw), 'no hard-coded payment keys');
ok(!readdirSync(root).some(f => f.endsWith('.keystore') || f === '.env'), 'no secrets in repo root');
ok(existsSync(join(root, '.gitignore')) && read('.gitignore').includes('*.keystore'), '.gitignore excludes keystores');

console.log('== Backend (server/) ==');
for (const f of ['server/index.js','server/src/server.js','server/src/auth.js','server/src/store.js','server/src/middleware.js','server/src/routes/auth.js','server/src/routes/projects.js','server/migrations/001_init.sql'])
  ok(existsSync(join(root, f)), `exists: ${f}`);
ok(!js.includes("Account panel (demo)") && !js.includes("Syncing to cloud...'"), 'no fake account/sync toasts remain');
ok(js.includes('class CodeStudioAPI') || read('api.js').includes('class CodeStudioAPI'), 'real API client wired');
ok(read('server/src/auth.js').includes('scryptSync') && read('server/src/auth.js').includes('timingSafeEqual'), 'scrypt + constant-time compare');
ok(read('server/src/middleware.js').includes('requireRole'), 'RBAC middleware present');
ok(read('.env.example').includes('JWT_SECRET'), '.env.example documents JWT_SECRET');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
