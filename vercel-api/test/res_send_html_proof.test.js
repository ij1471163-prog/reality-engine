// ═══════════════════════════════════════════════════════════════════════
// [RES-SEND-PROOF] إصلاح res.send تلقائيًا فقط حين يُثبت أن الرد HTML — اختبارات سلوكية
// تشغيل:  node --test vercel-api/test/res_send_html_proof.test.js
//
// المقيس قبل التغيير: res.send("…" + x) يُكتشف ولا يُصلَح أبدًا ويذهب إلى AI،
// حتى مع res.type("html") صريح قبله.
// المطلوب:
//   • يُصلَح (تهريب المقاطع الديناميكية، res.send باقٍ، النوع والحالة كما هما)
//     **فقط** حين يضبط المعالج نفسه نوع HTML صراحةً — بجملة غير مشروطة في جسمه،
//     قبل الإرسال — ولا يُضبط النوع في أي موضع آخر من الملف.
//   • غير ذلك لا تعديل، والسبب مُسجَّل، والبلاغ باقٍ، وقرار خط الإصلاح ليس
//     SAFE_AUTO_FIX — ومنه الرد بلا نوع صريح (افتراض Express ليس إثباتًا).
// السلوك يُقاس بتشغيل المعالج فعلًا (res وهمي) قبل/بعد على حمولات خبيثة وعادية،
// وبـjsdom إن توفّر (JSDOM_PATH): لا عناصر محقونة والنص المعروض = المدخل.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('node:path');

const { createRepairEngine } = require('../public/server_repair_adapter.js');
const { FixVerifier: FV, RealityOrchestrator: RO } = require('../public/server_engine_registration.js');

const E = createRepairEngine();
const analyze = code => E.analyze(code, 's.js');
const gate = (b, a) => FV.verifyFix(b, a, 's.js', (c, f) => E.analyze(c, f));
const xssAt = (code, line) => analyze(code).filter(i => Number(i.line) === line && /xss|cwe-79/i.test([i.type, i.title, i.cAct, i.cwe].join(' ')));

let JSDOM = null;
try { JSDOM = require(require.resolve('jsdom', { paths: [process.env.JSDOM_PATH || __dirname, path.join(__dirname, '..')] })).JSDOM; } catch (_) { /* غير متوفر */ }

const app = (handlerBody, extra) => 'const express = require("express");\nconst app = express();\n' + (extra || '') +
  'app.get("/hi", (req, res) => {\n' + handlerBody + '\n});\nmodule.exports = app;\n';
const sendLine = code => code.split('\n').findIndex(l => /\.send\(/.test(l)) + 1;

// يشغّل المعالج بطلب وهمي: res.send لنصّ بلا نوع ⇒ text/html (عقد Express)، وكل ضبط للنوع يُسجَّل
function invoke(code, query) {
  const routes = {};
  const expressApp = { get: (p, fn) => { routes[p] = fn; }, use() {} };
  const mod = { exports: {} };
  new Function('module', 'require', code)(mod, n => (n === 'express' ? () => expressApp : require(n)));
  const st = { sent: null, type: null, status: 200 };
  const res = {
    send(b) { st.sent = b; if (typeof b === 'string' && !st.type) st.type = 'text/html'; return res; },
    status(c) { st.status = c; return res; },
    type(t) { st.type = t; return res; },
    set(k, v) { if (/^content-type$/i.test(k)) st.type = v; return res; },
    setHeader(k, v) { if (/^content-type$/i.test(k)) st.type = v; return res; },
  };
  routes['/hi']({ query: query || {} }, res);
  return st;
}
const PAYLOADS = ['Bob', 'Ali 42', '<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', '<script>alert(1)</script>', '&lt;b&gt;', 'سارة & <علي>'];

// ═══ موجب: نوع HTML مُثبت ═════════════════════════════════════════════
const POSITIVE = {
  'res.type("html")':                 app('  res.type("html");\n  res.send("<h1>Hello " + req.query.name + "</h1>");'),
  'res.type("text/html")':            app('  res.type("text/html");\n  res.send("<p>" + req.query.name + "</p>");'),
  'res.set Content-Type text/html':   app('  res.set("Content-Type", "text/html; charset=utf-8");\n  res.send("<b>" + req.query.name + "</b>");'),
  'res.setHeader Content-Type html':  app('  res.setHeader("Content-Type", "text/html");\n  res.status(200).send("<i>" + req.query.name + "</i>");'),
};

const FIXED = {};
test.before(async () => {
  for (const [k, code] of Object.entries(POSITIVE)) {
    const adapter = E.repair(code, analyze(code), 's.js').repaired;
    const r = await RO.runPipelineAsync(code, 's.js', { useFallbackChain: true });
    FIXED[k] = { adapter, decision: r.decision && r.decision.decision, pipeline: r.decision && r.decision.patch };
  }
});

test('[RES-PROOF+] نوع HTML صريح: يُصلَح بالتهريب في المحوّل وخط الإصلاح، res.send باقٍ، والبلاغ يختفي، والبوابة تقبل', () => {
  for (const [k, code] of Object.entries(POSITIVE)) {
    const f = FIXED[k];
    assert.strictEqual(f.decision, RO.Decision.SAFE_AUTO_FIX, k + ': ' + f.decision);
    for (const out of [f.adapter, f.pipeline]) {
      assert.notStrictEqual(out, code, k + ': لم يُصلَح');
      assert.match(out, /__escapeHTML\(req\.query\.name\)/, k);
      assert.match(out, /\.send\(/, k + ': res.send اختفى');
      assert.ok(!/res\.json/.test(out), k + ': res.json');
      assert.strictEqual(xssAt(out, sendLine(out)).length, 0, k + ': البلاغ باقٍ على المُثبت');
      assert.strictEqual(gate(code, out).accepted, true, k);
    }
  }
});

test('[RES-PROOF+] السلوك: النوع والحالة كما هما، والمدخل العادي بايتات متطابقة، والحمولة لا تصير وسمًا', () => {
  for (const [k, code] of Object.entries(POSITIVE)) {
    const out = FIXED[k].pipeline;
    for (const v of PAYLOADS) {
      const b = invoke(code, { name: v }), a = invoke(out, { name: v });
      assert.strictEqual(typeof a.sent, 'string', k);
      assert.strictEqual(a.type, b.type, k + ': نوع الرد تغيّر');
      assert.strictEqual(a.status, b.status, k + ': الحالة تغيّرت');
      if (!/[&<>"'`]/.test(v)) assert.strictEqual(a.sent, b.sent, k + ': مدخل عادي تغيّر');
      else {
        assert.ok(!a.sent.includes(v), k + ': الحمولة الخام ما زالت في الرد: ' + v);
        assert.ok(!/<(?:img|svg|script)\b/i.test(a.sent.replace(/<\/?(?:h1|p|b|i)>/g, '')), k + ': وسمٌ محقون');
      }
      if (JSDOM) {
        const doc = new JSDOM(a.sent).window.document;
        assert.strictEqual(doc.body.querySelectorAll('img,svg,script').length, 0, k + ': عنصر محقون: ' + v);
        assert.ok(doc.body.textContent.includes(v), k + ': النص المعروض لا يطابق المدخل: ' + v);
      }
    }
  }
});

test('[RES-PROOF+] الثغرة حقيقية قبل الإصلاح: الحمولة تصير عنصرًا', { skip: JSDOM ? false : 'jsdom غير متوفر' }, () => {
  const doc = new JSDOM(invoke(POSITIVE['res.type("html")'], { name: '<img src=x onerror=alert(1)>' }).sent).window.document;
  assert.strictEqual(doc.querySelectorAll('img').length, 1);
});

// ═══ سلبي: لا تطبيق تلقائي ═════════════════════════════════════════════
const NEGATIVE = {
  'بلا نوع صريح (افتراض Express ليس إثباتًا)': app('  res.send("<h1>Hello " + req.query.name + "</h1>");'),
  'text/plain صريح':                    app('  res.type("text/plain");\n  res.send("Hello " + req.query.name);'),
  'JSON عبر set':                        app('  res.set("Content-Type", "application/json");\n  res.send("{\\"n\\":\\"" + req.query.name + "\\"}");'),
  'html مشروط (if)':                    app('  if (req.query.h) res.type("html");\n  res.send("<b>" + req.query.name + "</b>");'),
  'html بعد الإرسال':                    app('  res.send("<b>" + req.query.name + "</b>");\n  res.type("html");'),
  'html على كائن آخر لا على res':        app('  other.type("html");\n  res.send("<b>" + req.query.name + "</b>");'),
  'middleware يضبط النوع في الملف':      app('  res.type("html");\n  res.send("<b>" + req.query.name + "</b>");', 'app.use((req, res, next) => { res.type("text"); next(); });\n'),
  'ليس رد Express (ws.send)':            'function relay(ws, msg) {\n  ws.type("html");\n  ws.send("<b>" + msg + "</b>");\n}\nmodule.exports = relay;\n',
  'المستقبِل يُعاد إسناده':               app('  res.type("html");\n  res = other;\n  res.send("<b>" + req.query.name + "</b>");'),
  'جمع رقمي محتمل':                       app('  res.type("html");\n  res.send(req.query.a + req.query.b + " items");'),
  'سمة href':                             app('  res.type("html");\n  res.send("<a href=\\"" + req.query.u + "\\">go</a>");'),
  'داخل <script>':                        app('  res.type("html");\n  res.send("<script>var n = \\"" + req.query.name + "\\";</script>");'),
};

test('[RES-PROOF-] الحالات غير المُثبتة: لا تعديل في المحوّل، وقرار خط الإصلاح ليس SAFE_AUTO_FIX لسطر send', async () => {
  for (const [k, code] of Object.entries(NEGATIVE)) {
    const ln = sendLine(code);
    const out = E.repair(code, analyze(code), 's.js').repaired;
    assert.strictEqual(out.split('\n')[ln - 1], code.split('\n')[ln - 1], k + ': سطر send تغيّر:\n' + out);
    const r = await RO.runPipelineAsync(code, 's.js', { useFallbackChain: true });
    const patch = r.decision && r.decision.decision === RO.Decision.SAFE_AUTO_FIX ? r.decision.patch : null;
    if (patch) assert.strictEqual(patch.split('\n')[ln - 1], code.split('\n')[ln - 1], k + ': خط الإصلاح عدّل سطر send');
  }
});

test('[RES-PROOF-] السبب مُسجَّل من المُصلح السياقي، والبلاغ باقٍ حيث يوجد مَصرِف res.send', () => {
  global.acorn = global.acorn || require('../public/acorn.min.js');
  const XSSFixer = require('../public/xss_fix.js');
  assert.strictEqual(typeof XSSFixer.fixResSend, 'function', 'fixResSend غير موجود');
  const want = {
    'بلا نوع صريح (افتراض Express ليس إثباتًا)': /^XSS_RES_SEND_TYPE_UNPROVEN/,
    'text/plain صريح': /^XSS_RES_SEND_EXPLICIT_TYPE/,
    'JSON عبر set': /^XSS_RES_SEND_EXPLICIT_TYPE/,
    'html مشروط (if)': /^XSS_RES_SEND_TYPE_UNPROVEN/,
    'html بعد الإرسال': /^XSS_RES_SEND_TYPE_UNPROVEN/,
    'html على كائن آخر لا على res': /^XSS_RES_SEND_TYPE_UNPROVEN/,
    'middleware يضبط النوع في الملف': /^XSS_RES_SEND_TYPE_SET_ELSEWHERE/,
    'ليس رد Express (ws.send)': /^XSS_RES_SEND_NOT_EXPRESS/,
    'المستقبِل يُعاد إسناده': /^XSS_RES_SEND_NOT_EXPRESS/,
    'جمع رقمي محتمل': /^XSS_RES_SEND_BODY_TYPE_UNKNOWN/,
    'سمة href': /^XSS_CONTEXT_UNSAFE/,
    'داخل <script>': /^XSS_CONTEXT_UNSAFE/,
  };
  for (const [k, code] of Object.entries(NEGATIVE)) {
    const r = XSSFixer.fixResSend(code, sendLine(code));
    assert.strictEqual(r.changed, false, k + ': عُدِّل');
    assert.strictEqual(r.fixed, code, k);
    assert.match(String(r.reason), want[k], k + ': ' + r.reason);
    if (/res\.send/.test(code)) assert.ok(xssAt(code, sendLine(code)).length >= 1, k + ': لا بلاغ أصلًا (الاختبار لا يقيس شيئًا)');
  }
});

// ═══ الكواشف: الإثبات وحده يُسقط البلاغ ═══════════════════════════════
test('[RES-PROOF-DET] سطر مُهرَّب بالدالة المعيارية لا يُبلَّغ عنه؛ ودالة غير معيارية أو قيمة خام بجانبه تبقى مُبلَّغة', () => {
  const fixed = FIXED['res.type("html")'].pipeline;
  const ln = sendLine(fixed);
  assert.strictEqual(xssAt(fixed, ln).length, 0);
  const fake = fixed.replace(/function __escapeHTML\(v\) \{[\s\S]*?\n\}/, 'function __escapeHTML(v) {\n  return String(v);\n}');
  assert.notStrictEqual(fake, fixed, 'tripwire: لم تُستبدل الدالة');
  assert.ok(xssAt(fake, ln).length >= 1, 'دالة لا تهرّب ⇒ يجب أن يبقى البلاغ');
  const raw = fixed.replace('__escapeHTML(req.query.name)', '__escapeHTML(req.query.name) + req.query.name');
  assert.ok(xssAt(raw, ln).length >= 1, 'قيمة خام بجانب المُهرَّبة ⇒ يجب أن يبقى البلاغ');
});

// ═══ ذاكرة الإثبات في knowledge_base.js: نفس الحكم، بلا كلفة تربيعية ═════
// المرجع: الملف الحالي نفسه بعد إعادة كتلة الإثبات إلى نصّها غير المحفوظ (مشيٌ كامل لكل سطر) — منسوخة حرفيًا.
const KB_ORIG_BLOCK = `  function _kbEscapedTextSink(code, lineNo) {
    const ast = _kbParse(code);
    if (!ast) return false;
    // 1. الدالة المساعدة
    const decls = [];
    let rebound = false;
    _kbWalk(ast, n => {
      if (n.type === 'FunctionDeclaration' && n.id && n.id.name === '__escapeHTML') decls.push(n);
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === '__escapeHTML') rebound = true;
      if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier' && n.left.name === '__escapeHTML') rebound = true;
      if (/^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type) &&
          n.params.some(p => p.type === 'Identifier' && p.name === '__escapeHTML')) rebound = true;
    });
    if (rebound || decls.length !== 1 || !ast.body.includes(decls[0])) return false;
    if (code.slice(decls[0].start, decls[0].end).replace(/\\s+/g, '') !== _KB_ESCAPER) return false;
    // 2. المَصرِف في السطر: إسناد innerHTML/outerHTML، أو [RES-SEND] نداء send لرد Express —
    //    المستقبِل R أو R.status(…) وR الوسيط الثاني لدالة المعالج المحيطة ولا يُعاد إسناده.
    const sinks = [];
    const fnStack = [];
    const isFn = n => /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type);
    (function rec(n) {
      if (!n || typeof n.type !== 'string') return;
      if (isFn(n)) fnStack.push(n);
      if (n.type === 'AssignmentExpression' && n.operator === '=' && n.left.type === 'MemberExpression' && !n.left.computed &&
          /^(?:inner|outer)HTML$/.test(n.left.property.name) && n.left.property.loc.start.line === lineNo) sinks.push({ value: n.right });
      if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed &&
          n.callee.property.name === 'send' && n.callee.property.loc.start.line === lineNo) {
        let recv = n.callee.object;
        if (recv.type === 'CallExpression' && recv.callee.type === 'MemberExpression' && !recv.callee.computed &&
            recv.callee.property.name === 'status') recv = recv.callee.object;
        const fn = fnStack[fnStack.length - 1];
        const p1 = fn && fn.params[1];
        let ok = !!(fn && recv.type === 'Identifier' && p1 && p1.type === 'Identifier' && p1.name === recv.name && n.arguments.length === 1);
        if (ok) _kbWalk(fn.body, m => { if (m.type === 'AssignmentExpression' && m.left.type === 'Identifier' && m.left.name === recv.name) ok = false; });
        sinks.push(ok ? { value: n.arguments[0] } : { value: null });
      }
      for (const k of Object.keys(n)) {
        if (k === 'loc') continue;
        const v = n[k];
        if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && rec(c));
        else if (v && typeof v.type === 'string') rec(v);
      }
      if (isFn(n)) fnStack.pop();
    })(ast);
`;
function kbFrom(src) {
  const vm = require('node:vm');
  const ctx = vm.createContext({ module: { exports: {} }, acorn: require('../public/acorn.min.js') });
  vm.runInContext(src, ctx);
  return ctx.module.exports;
}
const KB_SRC = require('node:fs').readFileSync(path.join(__dirname, '..', 'public', 'knowledge_base.js'), 'utf8');
const KB_ORIG_SRC = (() => {
  const a = KB_SRC.indexOf('  // [RES-SEND-PROOF] الإثبات يُستدعى');
  const b = KB_SRC.indexOf('    const sinks = _kbSinksAt(ast, lineNo);\n');
  assert.ok(a > 0 && b > a, 'لم يُعثر على كتلة الذاكرة');
  return KB_SRC.slice(0, a) + KB_ORIG_BLOCK + KB_SRC.slice(b + '    const sinks = _kbSinksAt(ast, lineNo);\n'.length);
})();

test('[RES-PROOF-MEMO] الإثبات المحفوظ = غير المحفوظ لكل سطر، في سياقٍ مشترك وبترتيبين', () => {
  const NEW = kbFrom(KB_SRC), OLD = kbFrom(KB_ORIG_SRC);
  assert.strictEqual(typeof NEW.escapedTextSink, 'function');
  const helper = FIXED['res.type("html")'].pipeline.match(/^\/\/ \[XSSFixer\][\s\S]*?\n\}\n/m);
  assert.ok(helper, 'tripwire: الدالة المساعدة غير موجودة في المُصلَح');
  const files = Object.values(FIXED).flatMap(f => [f.adapter, f.pipeline])
    .concat(Object.values(POSITIVE), Object.values(NEGATIVE))
    .concat([
      'function show(el, v) {\n  el.innerHTML = "<b>" + __escapeHTML(v) + "</b>";\n  el.outerHTML = v;\n}\n' + helper[0],
      app('  res.send("<b>" + __escapeHTML(req.query.n) + "</b>"); res.send("<i>" + req.query.n + "</i>");') + helper[0],
      app('  res.send("<i>" + req.query.n + "</i>"); res.send("<b>" + __escapeHTML(req.query.n) + "</b>");') + helper[0],
      'function f(el, v) { el.innerHTML = v; el.innerHTML = "<b>" + __escapeHTML(v) + "</b>"; }\n' + helper[0],
      app('  res.send("<b>" + __escapeHTML(req.query.n) + "</b>");') + helper[0].replace('return String(v)', 'return v'),
    ]);
  let checked = 0, proven = 0;
  for (const order of [files, files.slice().reverse()]) for (const code of order) {
    const n = code.split('\n').length;
    for (let L = 1; L <= n; L++) {
      const a = NEW.escapedTextSink(code, L), b = OLD.escapedTextSink(code, L);
      assert.strictEqual(a, b, 'سطر ' + L + ':\n' + code.split('\n')[L - 1]);
      checked++; if (a === true) proven++;
    }
  }
  assert.ok(proven >= 8, 'أسطر مُثبتة: ' + proven + ' — الاختبار لا يقيس الحالة الموجبة');
  assert.ok(checked > 200);
});

test('[RES-PROOF-PERF] ملف فيه 300 نداء res.send: الزمن ينمو شبه خطيًا (قبل الذاكرة: ×60 عن 75 نداءً)', () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'analyze.js'), 'utf8');
  const list = [...src.match(/const engines = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} }, window: {}, global: {}, F: {}, R: {} });
  for (const f of list) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8'), ctx);
  const gen = k => 'const express = require("express");\nconst app = express();\n' +
    Array.from({ length: k }, (_, i) => 'app.get("/r' + i + '", (req, res) => {\n  res.send("<b>" + req.query.n + "</b>");\n});').join('\n') + '\n';
  ctx.analyzeCode(gen(10), 'a.js');
  const t = k => { const s = process.hrtime.bigint(); ctx.analyzeCode(gen(k), 'a.js'); return Number(process.hrtime.bigint() - s) / 1e6; };
  const t75 = Math.min(t(75), t(75)), t300 = Math.min(t(300), t(300));
  assert.ok(t300 / t75 < 8, `t75=${t75.toFixed(0)}ms t300=${t300.toFixed(0)}ms`);
});
