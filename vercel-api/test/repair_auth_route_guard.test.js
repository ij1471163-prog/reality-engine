// ═══════════════════════════════════════════════════════
// اختبارات حارس حقن AuthRepair للـroutes داخل repairCode في repair_engine.js
// تشغيل:  node --test vercel-api/test/repair_auth_route_guard.test.js
//
// فرع الـroute في AuthRepair يحقن حرفيًا
//   '  if (!req.user) return res.status(401).json({ error: "Unauthorized" });'
// في كل app.(get|post|put|delete|patch) له block بدون أي فحص حساسية.
// هذا السطر المُضاف يُحذف ويُسجَّل في rejected بـAUTH_ROUTE_INJECTED؛
// الإصلاحات المصاحبة (HTTP / innerHTML) تبقى، و MISSING_AUTH لا يُحذف
// (الـAnalyzer يظل يراه، و aiNeeded مطابق لسلوك الـbaseline).
// فرع الـfunction ("if (!req || !req.user) ... 'Unauthorized'") يبقى كما هو.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ROUTE_LINE = '  if (!req.user) return res.status(401).json({ error: "Unauthorized" });';

// (أ) repair_engine.js [+ repair_auth.js] داخل vm
function loadEngine(withAuth) {
  const noop = () => {};
  const ctx = { console: { log: noop, warn: noop, error: noop, info: noop } };
  ctx.window = ctx;
  vm.createContext(ctx);
  const files = withAuth ? ['repair_engine.js', 'repair_auth.js'] : ['repair_engine.js'];
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

// (ب) سياق الواجهة الكامل — كل سكربتات index.html (Analyzer + GhostMode حقيقيان)
function loadUiContext() {
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => null, addEventListener: noop, createElement: () => ({}), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: noop }, navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة فقط */ }
  }
  return ctx;
}

const ctx  = loadEngine(true);
const base = loadEngine(false);   // نفس المحرك بدون AuthRepair = سلوك الـbaseline لكل ما عدا الحقن

// نفس عنوان الـAnalyzer الحقيقي لـMISSING_AUTH
const authIssue = (code, line) => ({
  type: 'CWE_284', sev: 'm', line, ev: code.split('\n')[line - 1].trim(),
  title: '🟠 Missing Auth Middleware (CWE-284)', cAct: 'CWE-284',
});
const httpIssue = (code, line) => ({
  type: 'security', sev: 'm', line, ev: code.split('\n')[line - 1].trim(),
  title: '🟡 HTTP غير مشفر — استخدم HTTPS',
});
const xssIssue = (code, line) => ({
  type: 'CWE_79', sev: 'c', line, ev: code.split('\n')[line - 1].trim(),
  title: '🔴 XSS - DOM (CWE-79)', cAct: 'CWE-79',
});

function run(c, code, issues, file) {
  const snapshot = JSON.stringify(issues);
  const out = c.repairCode(code, issues, file || 'a.js');
  assert.strictEqual(JSON.stringify(issues), snapshot, 'issues must not be modified');
  return out;
}

const authRejections = out => out.rejected.filter(r => /^AUTH_ROUTE_INJECTED/.test(r.reason));

function assertRouteRejected(out, count) {
  const rej = authRejections(out);
  assert.strictEqual(rej.length, count, 'each injected route line must be recorded in rejected');
  for (const r of rej) {
    assert.strictEqual(r.strategy, 'MISSING_AUTH');
    assert.strictEqual(r.source, 'AuthRepair');
    assert.strictEqual(typeof r.line, 'number');
  }
  assert.ok(!out.repaired.split('\n').includes(ROUTE_LINE), 'route 401 line must not reach the output');
}

// ═══ 1. route injection يُرفض ═══════════════════════════
const ROUTES = {
  '/health':              'app.get("/health", (req, res) => {\n  res.json({ ok: true });\n});',
  '/public/news':         'app.get("/public/news", (req, res) => {\n  res.json(news);\n});',
  '/login':               'app.post("/login", (req, res) => {\n  login(req.body.user, req.body.pass);\n  res.json({ ok: true });\n});',
  '/robots.txt':          'app.get("/robots.txt", (req, res) => {\n  res.type("text/plain").send("User-agent: *");\n});',
  'route with requireAuth': 'app.get("/me", requireAuth, (req, res) => {\n  res.json(req.session.profile);\n});',
  'route (request, response)': 'app.get("/status", (request, response) => {\n  response.json({ up: true });\n});',
  'route with req.user in body': 'app.get("/profile", (req, res) => {\n  if (!req.user) return res.redirect("/login");\n  res.json(req.user);\n});',
};

for (const [name, code] of Object.entries(ROUTES)) {
  test(`route ${name}: AuthRepair route injection rejected, code unchanged, MISSING_AUTH not dropped`, () => {
    const issues = [authIssue(code, 1)];
    const ar = ctx.AuthRepair.fix(code, 'a.js');
    assert.ok(ar.fixed.split('\n').includes(ROUTE_LINE), 'precondition: AuthRepair injects the route line');

    const out = run(ctx, code, issues);
    assert.strictEqual(out.repaired, code);
    assert.strictEqual(out.repairs.length, 0);
    assertRouteRejected(out, 1);
    assert.strictEqual(authRejections(out)[0].line, 1);

    // MISSING_AUTH: aiNeeded مطابق للـbaseline (بدون AuthRepair)، والـissue لم تتغير
    const b = run(base, code, issues);
    assert.strictEqual(JSON.stringify(out.aiNeeded), JSON.stringify(b.aiNeeded));
    assert.strictEqual(b.repaired, code);
  });
}

// ═══ 2. الإصلاح المصاحب يبقى، الـ401 يُرفض ═══════════════
test('/health + HTTP fix: https fix kept, route 401 rejected', () => {
  const code = 'app.get("/health", (req, res) => {\n  fetch("http://api.example.com/status");\n  res.json({ ok: true });\n});';
  const issues = [authIssue(code, 1), httpIssue(code, 2)];
  const out = run(ctx, code, issues);
  const b = run(base, code, issues);
  assert.strictEqual(out.repaired, b.repaired);
  assert.match(out.repaired, /https:\/\/api\.example\.com\/status/);
  assert.strictEqual(JSON.stringify(out.repairs.map(r => r.strategy)), JSON.stringify(['HTTP_USAGE']));
  assertRouteRejected(out, 1);
  assert.strictEqual(JSON.stringify(out.aiNeeded), JSON.stringify(b.aiNeeded));
});

test('/health + innerHTML fix: textContent fix kept, route 401 rejected', () => {
  const code = 'app.get("/health", (req, res) => {\n  document.getElementById("x").innerHTML = req.query.name;\n  res.json({ ok: true });\n});';
  const issues = [authIssue(code, 1), xssIssue(code, 2)];
  const out = run(ctx, code, issues);
  const b = run(base, code, issues);
  assert.strictEqual(out.repaired, b.repaired);
  assert.match(out.repaired, /\.textContent = req\.query\.name/);
  assert.strictEqual(JSON.stringify(out.repairs.map(r => r.strategy)), JSON.stringify(['XSS_INNER_HTML']));
  assertRouteRejected(out, 1);
  assert.strictEqual(JSON.stringify(out.aiNeeded), JSON.stringify(b.aiNeeded));
});

// ═══ 3. فرع الـfunction يبقى حرفيًا ═══════════════════════
const DELETE_USER = 'function deleteUser(req, res) {\n  db.query("DELETE FROM users WHERE id = ?", [req.params.id]);\n  res.json({ ok: true });\n}';

test('function branch: deleteUser(req, res) + db.query → 401 kept, byte-identical to AuthRepair', () => {
  const ar = ctx.AuthRepair.fix(DELETE_USER, 'a.js');
  assert.ok(ar.changed);
  assert.match(ar.fixed, /if \(!req \|\| !req\.user\) return res\.status\(401\)\.json\(\{ error: 'Unauthorized' \}\);/);
  const out = run(ctx, DELETE_USER, []);
  assert.strictEqual(out.repaired, ar.fixed);
  assert.strictEqual(authRejections(out).length, 0);
  assert.strictEqual(out.rejected.length, 0);
});

test('route + deleteUser in same file: route injection rejected, function injection kept', () => {
  const code = 'app.get("/health", (req, res) => {\n  res.json({ ok: true });\n});\n\n' + DELETE_USER;
  const ar = ctx.AuthRepair.fix(code, 'a.js');
  const expected = ar.fixed.split('\n').filter(l => l !== ROUTE_LINE).join('\n');
  assert.notStrictEqual(expected, code);
  const out = run(ctx, code, [authIssue(code, 1)]);
  assert.strictEqual(out.repaired, expected);
  assert.match(out.repaired, /if \(!req \|\| !req\.user\)/);
  assertRouteRejected(out, 1);
  assert.strictEqual(authRejections(out)[0].line, 1);
});

// ═══ 4. حالات سليمة تبقى بدون تغيير ═══════════════════════
const UNCHANGED = {
  'function with verifyToken': 'function deleteUser(req, res) {\n  verifyToken(req);\n  db.query("DELETE FROM users WHERE id = ?", [req.params.id]);\n}',
  'getNews(req, res)':         'function getNews(req, res) {\n  res.json(news);\n}',
  'single-line handler':       'app.get("/ping", (req, res) => { res.send("pong"); });',
  'router.get':                'router.get("/items", (req, res) => {\n  res.json(items);\n});',
};

for (const [name, code] of Object.entries(UNCHANGED)) {
  test(`unchanged: ${name}`, () => {
    assert.strictEqual(ctx.AuthRepair.fix(code, 'a.js').fixed, code, 'precondition: AuthRepair does not change it');
    const out = run(ctx, code, []);
    assert.strictEqual(out.repaired, code);
    assert.strictEqual(out.rejected.length, 0);
    assert.strictEqual(out.repairs.length, 0);
  });
}

// ═══ 5. AuthRepair عدّل سطرًا بدل الإضافة → لا يُطبَّق ناتجه ═══
test('AuthRepair output that modifies an existing line → not applied, rejection recorded', () => {
  const c = loadEngine(false);
  vm.runInContext(`var AuthRepair = { fix(code) {
    return { fixed: code.replace('res.json(1)', 'res.json(2)'), repairs: [{ fix: 'x' }], changed: true };
  } };`, c);
  const code = 'function a(req, res) {\n  res.json(1);\n}';
  const out = run(c, code, []);
  assert.strictEqual(out.repaired, code);
  assert.strictEqual(out.rejected.length, 1);
  assert.strictEqual(out.rejected[0].strategy, 'MISSING_AUTH');
  assert.strictEqual(out.rejected[0].source, 'AuthRepair');
  assert.match(out.rejected[0].reason, /^AUTH_NOT_ADDITIVE/);
});

// ═══ 6. سياق الواجهة الحقيقي (Analyzer + GhostMode) ═══════
test('UI context: /health + HTTP → https, no 401, MISSING_AUTH still reported by analyzer', () => {
  const ui = loadUiContext();
  assert.strictEqual(typeof ui.analyzeCode, 'function');
  assert.strictEqual(typeof ui.GhostMode, 'object');
  assert.strictEqual(typeof ui.AuthRepair, 'object');
  const code = 'app.get("/health", (req, res) => {\n  fetch("http://api.example.com/status");\n  res.json({ ok: true });\n});';
  const issues = ui.analyzeCode(code, 'a.js');
  assert.ok(issues.some(i => /Missing Auth|Lack Auth/i.test(i.title)), 'precondition: analyzer reports missing auth');
  const out = run(ui, code, issues);
  assert.match(out.repaired, /https:\/\/api\.example\.com\/status/);
  assert.ok(!/status\(401\)/.test(out.repaired), 'no 401 in final output');
  assertRouteRejected(out, 1);
  const after = ui.analyzeCode(out.repaired, 'a.js');
  assert.ok(after.some(i => /Missing Auth|Lack Auth/i.test(i.title)), 'MISSING_AUTH still visible after repair');

  // aiNeeded مطابق للـbaseline بدون AuthRepair
  const saved = ui.AuthRepair;
  ui.AuthRepair = undefined;
  try {
    const b = run(ui, code, issues);
    assert.strictEqual(JSON.stringify(out.aiNeeded), JSON.stringify(b.aiNeeded));
    assert.strictEqual(out.repaired, b.repaired);
  } finally { ui.AuthRepair = saved; }
});
