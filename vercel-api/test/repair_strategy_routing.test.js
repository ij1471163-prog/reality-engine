// ═══════════════════════════════════════════════════════
// P1 — فصل Strategy عن Title (repair_engine.js detectStrategy)
// تشغيل:  node --test vercel-api/test/repair_strategy_routing.test.js
//
// الـtitle يحمل بيانات من كود المستخدم (اسم متغير/دالة، route path)، فكانت
// الكلمات المفتاحية فيه تحرف الـstrategy:
//   خطأ تراكم: evalScore      → EVAL_USAGE     بدل ACCUMULATION
//   خطأ تراكم: passwordCount  → HARDCODED_PASS بدل ACCUMULATION
//   CMD_INJECTION: sqlCmd ... → SQL_INJECTION  بدل CMD_INJECTION
// الآن: issue.strategy صريح من الـdetector يُستخدم أولًا (إذا كان معروفًا ومدعومًا
// للغة)، والـtitle fallback فقط. MISSING_AUTH يأتي من strategy صريح فقط.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// نفس المحركات التي تحمّلها الواجهة (index.html)
function loadUiContext() {
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => null, addEventListener: noop, createElement: () => ({}), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: noop }, navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة فقط */ }
  }
  ctx.GhostMode = undefined;
  return ctx;
}

const ctx = loadUiContext();
const server = require(path.join(PUBLIC_DIR, 'server_repair_adapter.js')).createRepairEngine();
const route = (i, lang) => ctx.detectStrategy(i, lang);
const uiAnalyze = (code, file) => ctx.analyzeCode(code, file);

// ═══ 1. MISSING_AUTH: route path لا يحرف الـstrategy ═══════
const ROUTES = ['/eval', '/password', '/logs', '/sql-report', '/http-proxy', '/secret-santa', '/health'];
const routeCode = r => `const express=require('express');const app=express();\napp.post('${r}', (req,res)=>{\n  res.send('ok');\n});\n`;

for (const r of ROUTES) {
  test(`route ${r}: auth finding stays MISSING_AUTH and reaches aiNeeded`, () => {
    const code = routeCode(r);
    const issues = uiAnalyze(code, 'r.js');
    const auth = issues.filter(i => i.line === 2 && /Missing Auth|Lack Auth/.test(i.title));
    assert.ok(auth.length >= 1, 'precondition: Auth detector reports the route');
    for (const i of auth) {
      assert.strictEqual(i.strategy, 'MISSING_AUTH');
      assert.strictEqual(route(i, 'js'), 'MISSING_AUTH');
    }
    const out = ctx.repairCode(code, issues, 'r.js');
    assert.ok(out.aiNeeded.some(a => a.line === 2 && a.strategy === 'MISSING_AUTH'));
    assert.ok(!out.repairs.some(x => x.line === 2), 'no auto-fix on the route line');
    assert.ok(!out.aiNeeded.some(a => a.line === 2 && a.strategy !== 'MISSING_AUTH'),
      'route path must not produce EVAL/PASS/LOG/SQL/HTTP/SECRET routing');
  });
}

test('POST /eval explicitly: MISSING_AUTH, never EVAL_USAGE', () => {
  const issues = uiAnalyze(routeCode('/eval'), 'r.js').filter(i => i.line === 2);
  assert.ok(issues.length);
  assert.ok(!issues.some(i => route(i, 'js') === 'EVAL_USAGE'));
});

test('semantic_layer auth finding with injected function name routes by explicit strategy', () => {
  for (const name of ['getSqlReport', 'evalUsers', 'getPasswords', 'fetchLogs', 'httpProxyUsers', 'getSecretSanta']) {
    const i = { type: 'MISSING_AUTH', sev: 'm', line: 3, title: `🟡 ${name}() — تحقق من Auth Middleware`, strategy: 'MISSING_AUTH' };
    assert.strictEqual(route(i, 'js'), 'MISSING_AUTH', name);
    assert.strictEqual(route(i, 'ts'), 'MISSING_AUTH', name);
  }
});

// ═══ 2. auth* identifiers لا تصبح MISSING_AUTH عبر الـtitle ═══
for (const name of ['authZ', 'authHeader', 'authService', 'authToken']) {
  test(`identifier ${name}: title containing "auth" does not route to MISSING_AUTH`, () => {
    for (const title of [
      `🔵 Call Graph: ${name}() معرّفة لكن لا تُستدعى`,
      `🔵 Dead Assignment: ${name} معرّف لكن لا يُستخدم`,
      `🔵 متغير غير مستخدم: ${name}`,
    ]) {
      assert.strictEqual(route({ title, line: 1 }, 'js'), null, title);
      assert.strictEqual(route({ title, line: 1 }, 'ts'), null, title);
    }
    const code = `function ${name}() {\n}\n`;
    const out = ctx.repairCode(code, uiAnalyze(code, 'a.js'), 'a.js');
    assert.ok(!out.aiNeeded.some(a => a.strategy === 'MISSING_AUTH'), 'no MISSING_AUTH from an identifier');
  });
}

test('static title fallback alone never returns MISSING_AUTH', () => {
  assert.strictEqual(route({ title: '🟠 Missing Auth Middleware (CWE-284)' }, 'js'), null);
  assert.strictEqual(route({ title: '🟠 Missing Auth Middleware (CWE-284)', strategy: 'MISSING_AUTH' }, 'js'), 'MISSING_AUTH');
});

// ═══ 3. ACCUMULATION: اسم المتغير لا يحرف الـstrategy ═══════
const accCode = n => `let ${n} = 0;\nfor (const p of ps) {\n  ${n} = p.score;\n}\nconsole.log(${n});\n`;

for (const n of ['evalScore', 'passwordCount']) {
  test(`accumulation ${n}: stays ACCUMULATION and is repaired`, () => {
    const code = accCode(n);
    const acc = uiAnalyze(code, 'a.js').filter(i => i.line === 3 && /تراكم/.test(i.title));
    assert.ok(acc.length, 'precondition: accumulation reported');
    for (const i of acc) {
      assert.strictEqual(i.strategy, 'ACCUMULATION');
      assert.strictEqual(route(i, 'js'), 'ACCUMULATION');
      assert.ok(i.title.includes(n), 'title unchanged (still names the variable)');
    }
    const out = ctx.repairCode(code, uiAnalyze(code, 'a.js'), 'a.js');
    assert.strictEqual(out.repaired.split('\n')[2], `  ${n} += p.score;`);
    assert.ok(out.repairs.every(x => x.strategy === 'ACCUMULATION'));
  });
}

// ═══ 4. CMD_INJECTION: taint exec ═══════════════════════
const cmdCode = v => `const { exec } = require('child_process');\napp.get('/x',(req,res)=>{ const ${v} = req.query.c; exec(${v}); });\n`;

for (const v of ['sqlCmd', 'cmd', 'command']) {
  test(`taint exec(${v}): CMD_INJECTION in UI and server paths (not SQL_INJECTION, not null)`, () => {
    const code = cmdCode(v);
    for (const [name, issues] of [['ui', uiAnalyze(code, 'c.js')], ['server', server.analyze(code, 'c.js')]]) {
      const taint = issues.find(i => i.line === 2 && /^🔴 CMD_INJECTION:/.test(i.title));
      assert.ok(taint, `${name}: precondition: taint CMD reported`);
      assert.strictEqual(taint.strategy, 'CMD_INJECTION', name);
      assert.strictEqual(route(taint, 'js'), 'CMD_INJECTION', name);
    }
    const out = server.repair(code, server.analyze(code, 'c.js'), 'c.js');
    assert.ok(out.repairs.some(x => x.line === 2 && x.strategy === 'CMD_INJECTION'));
    assert.ok(!out.repairs.some(x => x.strategy === 'SQL_INJECTION'));
  });
}

test('taint CMD in Python maps to CMD_INJECTION_PY via language variant', () => {
  const code = `import os\nfrom flask import request\nsqlCmd = request.args.get('c')\nos.system(sqlCmd)\n`;
  // مخرج taint_py نفسه (dedupe في analyzeCode يدمجه مع "Command Injection Python" لنفس السطر)
  const taint = ctx.analyzeTaintPY(code, 'c.py').find(i => i.line === 4 && /^🔴 CMD_INJECTION:/.test(i.title));
  assert.ok(taint, 'precondition: python taint CMD reported');
  assert.strictEqual(taint.strategy, 'CMD_INJECTION');
  assert.strictEqual(route(taint, 'py'), 'CMD_INJECTION_PY');
  assert.strictEqual(route(taint, 'js'), 'CMD_INJECTION');
  // المسار الكامل: نتيجة السطر 4 تبقى CMD_INJECTION_PY
  const finalRoutes = uiAnalyze(code, 'c.py').filter(i => i.line === 4).map(i => route(i, 'py'));
  assert.ok(finalRoutes.includes('CMD_INJECTION_PY'));
  assert.ok(!finalRoutes.includes('SQL_INJECTION'));
});

// ═══ 5. strategy غير معروف / لغة غير مدعومة → title fallback ═══
test('unknown explicit strategy falls back to title routing', () => {
  assert.strictEqual(route({ title: 'خطأ تراكم: total = بدل +=', strategy: 'NOT_A_STRATEGY' }, 'js'), 'ACCUMULATION');
  assert.strictEqual(route({ title: 'zzz', strategy: 'NOT_A_STRATEGY' }, 'js'), null);
  assert.strictEqual(route({ title: 'خطأ تراكم: total = بدل +=', strategy: 'toString' }, 'js'), 'ACCUMULATION');
  assert.strictEqual(route({ title: 'خطأ تراكم: total = بدل +=', strategy: 42 }, 'js'), 'ACCUMULATION');
});

test('explicit strategy unsupported for the language → null, no title fallback', () => {
  // [backlog] كان: XSS_INNER_HTML غير مدعوم في py → title (فيه sql) → SQL_INJECTION.
  // مفتاح معروف لكن غير مدعوم = لا إصلاح حتمي؛ الـtitle قد يحمل اسمًا يوجّه لإصلاح آخر.
  assert.strictEqual(route({ title: '🔴 XSS: sqlVar وصل لـ output', strategy: 'XSS_INNER_HTML' }, 'py'), null);
  assert.strictEqual(route({ title: '🔴 CMD_INJECTION: $sqlCmd → exec', strategy: 'CMD_INJECTION' }, 'php'), null);
  assert.strictEqual(route({ title: '🔴 XSS: sqlVar وصل لـ output', strategy: 'XSS_INNER_HTML' }, 'js'), 'XSS_INNER_HTML');
  // MISSING_AUTH غير مدعوم خارج js/ts ولا fallback له
  assert.strictEqual(route({ title: '🟡 Route حساس بدون Auth Middleware', strategy: 'MISSING_AUTH' }, 'php'), null);
  // ACCUMULATION غير مدعوم في java → title كما كان
  assert.strictEqual(route({ title: 'خطأ تراكم Java: total = بدل +=', strategy: 'ACCUMULATION' }, 'java'), null);
});

test('unknown language still returns null even with explicit strategy', () => {
  assert.strictEqual(route({ title: 'x', strategy: 'ACCUMULATION' }, 'unknown'), null);
  assert.strictEqual(route({ title: 'x', strategy: 'ACCUMULATION' }, null), null);
});

// ═══ 6. الحقل لا يضيع عبر finalizeIssues / dedupe / adapter ═══
test('strategy survives finalizeIssues + dedupeIssues (analyzeCode) and the server adapter', () => {
  const code = cmdCode('cmd');
  const ui = uiAnalyze(code, 'c.js').find(i => /^🔴 CMD_INJECTION:/.test(i.title));
  assert.ok(ui && ui.strategy === 'CMD_INJECTION' && ui.conf && ui.cEv, 'finalized and still carries strategy');
  const srv = server.analyze(code, 'c.js').find(i => /^🔴 CMD_INJECTION:/.test(i.title));
  assert.strictEqual(srv.strategy, 'CMD_INJECTION');
  // title / line / sev / cwe لم تتغير بسبب P1
  assert.strictEqual(srv.title, '🔴 CMD_INJECTION: cmd من req input → exec');
  assert.strictEqual(srv.line, 2);
  assert.strictEqual(srv.sev, 'c');
  const auth = uiAnalyze(routeCode('/eval'), 'r.js').find(i => i.cwe === 'CWE-284');
  assert.strictEqual(auth.title, '🟠 Missing Auth Middleware (CWE-284)');
  assert.strictEqual(auth.strategy, 'MISSING_AUTH');
});

test('aiNeeded entries carry the explicit strategy (browser repair path)', () => {
  const code = routeCode('/sql-report');
  const out = ctx.repairCode(code, uiAnalyze(code, 'r.js'), 'r.js');
  const ai = out.aiNeeded.filter(a => a.line === 2);
  assert.ok(ai.length);
  assert.ok(ai.every(a => a.strategy === 'MISSING_AUTH'));
});

// ═══ 7. اختبار خارجي ═══════════════════════════════════
// fuzz I1–I4 + I5 غير موجود في الـrepo — يُشغَّل من السكربت الأصلي عند توفيره.
test.todo('external: fuzz I1–I4 + I5 (original script not in repo yet)');
