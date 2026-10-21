// ═══════════════════════════════════════════════════════
// المسارات الاحتياطية لا تتجاوز بوابة التحقق — اختبارات سلبية
// تشغيل:  node --test vercel-api/test/fallback_paths_gate_negative.test.js
//
// 1. emergency_fixes / fallback_fixes / learned_fixer: لا تُنتج أيًّا من التحويلات العمياء
//    المحظورة ([NO-BLIND] في emergency_fixes.js) على بطارية حالات مقيسة.
// 2. المسار القديم fixAllEnginePipeline: محرك احتياطي «عدائي» (يُستبدل بدالة تُرجع تعديلًا
//    ضارًّا) لا يكتب شيئًا ما لم تقبله البوابة — ولا عبر تجزئة الإنقاذ.
// 3. [UNBOUND-HELPER]: تجزئة الإنقاذ لا تُخرج نداء __escapeHTML بلا تعريفه.
// 4. [XSS-ESCAPED]/[XSS-KEPT]: استثناء المحلل للإسناد المُهرَّب مُثبَت لا نصّي، والبلاغ
//    الحقيقي يبقى في كل حالة لا يُثبتها (دالة غير معيارية، غائبة، مُعاد ربطها، سياق سمة/سكربت،
//    قيمة خام إضافية)، والبوابة لا تقبل إلا ما يُثبته.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadCtx() {
  const noop = () => {};
  const store = new Map();
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop, createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); },
    },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة لا يعمل خارج المتصفح */ }
  }
  ctx.toast = noop; ctx.refreshStats = noop;
  return ctx;
}
const pick = r => (typeof r === 'string' ? r : r && (r.fixed || r.code));

const REQ = "const crypto = require('crypto');\n";
// [الاسم، الملف، الكود، نمط التحويل المحظور]
const BATTERY = [
  ['js eval(data) ⇒ JSON.parse/حذف', 'a.js', 'function f(data) {\n  return eval(data);\n}\nmodule.exports = f;\n', /JSON\.parse|\/\/\s*eval|removed/],
  ['js res.send ⇒ res.json', 'a.js', 'function h(req, res) {\n  res.send("Hello " + req.query.name);\n}\nmodule.exports = h;\n', /res\.json/],
  ['js md5 (etag) ⇒ sha256', 'a.js', REQ + "function etag(b) {\n  return crypto.createHash('md5').update(b).digest('hex');\n}\nmodule.exports = etag;\n", /sha256/],
  ['js md5 (كلمة مرور) ⇒ sha256', 'a.js', REQ + "function hashPassword(p) {\n  return crypto.createHash('md5').update(p).digest('hex');\n}\nmodule.exports = hashPassword;\n", /sha256/],
  ['js innerHTML ⇒ textContent', 'a.js', 'function show(el, name) {\n  el.innerHTML = "<h2>Top: " + name + "</h2>";\n}\nmodule.exports = show;\n', /textContent/],
  ["js 'http:// ⇒ \"https://", 'a.js', "const u = 'http://api.example.com/x';\nmodule.exports = u;\n", /"https:/],
  ['js var ⇒ let (يُستعمل خارج الكتلة)', 'a.js', 'function f(x) {\n  if (x) {\n    var y = 1;\n  }\n  return y;\n}\nmodule.exports = f;\n', /let y/],
  ['js == null ⇒ === null', 'a.js', 'function f(x) {\n  if (x == null) return "none";\n  return "some";\n}\nmodule.exports = f;\n', /===\s*null/],
  ['ts : any ⇒ : unknown', 'a.ts', 'function f(x: any) {\n  return x.length;\n}\nexport default f;\n', /unknown/],
  ['py eval ⇒ literal_eval', 'a.py', 'def f(s):\n    return eval(s)\n', /literal_eval/],
  ['py == None ⇒ is None', 'a.py', 'def f(x):\n    if x == None:\n        return 1\n    return 2\n', /is None/],
  ['py md5 ⇒ sha256', 'a.py', 'import hashlib\ndef g(x):\n    return hashlib.md5(x).hexdigest()\n', /sha256/],
  ['php md5 ⇒ hash(sha256)', 'a.php', '<?php\nfunction h($p) {\n  return md5($p);\n}\n', /sha256/],
  ['C# MD5.Create ⇒ SHA256', 'a.cs', 'using System.Security.Cryptography;\nclass A {\n  byte[] H(byte[] d) {\n    return MD5.Create().ComputeHash(d);\n  }\n}\n', /SHA256/],
  ['Java MD5 ⇒ SHA-256', 'A.java', 'import java.security.MessageDigest;\nclass A {\n  byte[] h(byte[] d) throws Exception {\n    return MessageDigest.getInstance("MD5").digest(d);\n  }\n}\n', /SHA-256/],
];

// ═══ 1. المحركات الاحتياطية نفسها: لا تحويل أعمى ═══════════════
const UI = loadCtx();
for (const [name, file, code, bad] of BATTERY) {
  test(`[NO-BLIND] ${name}: emergency/fallback/learned لا تُنتج التحويل`, () => {
    const outs = {
      emergencyFix: pick(UI.emergencyFix(code, file)),
      fallbackFix:  pick(UI.fallbackFix(code, file, UI.analyzeCode(code, file))),
      learnedFixer: pick(UI.LearnedFixer.smartApply(code, file)),
    };
    for (const [eng, out] of Object.entries(outs)) {
      assert.ok(!bad.test(out || '') || bad.test(code), `${eng} أنتج التحويل المحظور:\n${out}`);
    }
    // applyEmergencyToAll/applyFallbackToAll (ما يستدعيه المسار القديم فعلًا)
    for (const apply of ['applyEmergencyToAll', 'applyFallbackToAll']) {
      const F = { [file]: code }, R = { [file]: { code, issues: UI.analyzeCode(code, file) } };
      UI[apply](F, R);
      assert.ok(!bad.test(F[file]), `${apply} أنتج التحويل المحظور:\n${F[file]}`);
    }
  });
}

test('[NO-BLIND] المسار القديم كاملًا: لا يُقبل أي تعديل من Emergency/Fallback على البطارية', () => {
  for (const [name, file, code] of BATTERY) {
    const ctx = loadCtx();
    ctx.F = { [file]: code };
    ctx.R = { [file]: { code, issues: ctx.analyzeCode(code, file) } };
    const report = ctx.fixAllEnginePipeline();
    const fromFallbacks = (report.accepted || []).filter(a => /^(Emergency|Fallback)$/.test(a.source));
    // مصفوفات من سياق vm آخر: المقارنة بالطول لا بـdeepStrictEqual (نموذج أولي مختلف)
    assert.strictEqual(fromFallbacks.length, 0, name + ': ' + JSON.stringify(fromFallbacks));
  }
});

// ═══ 2. محرك احتياطي عدائي لا يكتب إلا ما تقبله البوابة ══════════
// يُستبدل المحرك بدالة تُرجع تعديلًا ضارًّا محدَّدًا؛ الدعوى: F لا يتغيّر، والرفض مُسجَّل باسمه.
const HELPER = [
  'function __escapeHTML(v) {',
  '  return String(v).replace(/[&<>"\'`]/g, function (c) {',
  '    switch (c) {',
  '      case "&": return "&amp;";',
  '      case "<": return "&lt;";',
  '      case ">": return "&gt;";',
  '      case \'"\': return "&quot;";',
  '      case "\'": return "&#39;";',
  '      default:  return "&#96;";',
  '    }',
  '  });',
  '}',
].join('\n');
const SHOW = 'function show(el, name) {\n  el.innerHTML = "<h2>Top: " + name + "</h2>";\n}\nmodule.exports = show;\n';
const SHOW_ESC_CALL = SHOW.replace('" + name + "', '" + __escapeHTML(name) + "');
const SHOW_ESCAPED = SHOW_ESC_CALL + '\n' + HELPER + '\n';
const EVALF = 'function f(data) {\n  return eval(data);\n}\nmodule.exports = f;\n';
const PWD = REQ + "function hashPassword(p) {\n  return crypto.createHash('md5').update(p).digest('hex');\n}\nmodule.exports = hashPassword;\n";

const HOSTILE = [
  ['نداء __escapeHTML بلا تعريفه', 'a.js', SHOW, () => SHOW_ESC_CALL, /UNBOUND_HELPER|XSS_FIX_UNPROVEN|NO_IMPROVEMENT/],
  ['محو eval شكلي بتعليق', 'a.js', EVALF, c => c.replace('eval(data)', '/* removed */ 0'), /EVAL_FIX_UNPROVEN|NO_IMPROVEMENT/],
  ['md5 ⇒ sha256 على كلمة مرور', 'a.js', PWD, c => c.replace("'md5'", "'sha256'"), /CRYPTO_FIX_UNPROVEN/],
  ['innerHTML ⇒ textContent يُغيّر العرض (الوسم يصير نصًّا)', 'a.js', SHOW, c => c.replace('.innerHTML', '.textContent'), null],
];
for (const [name, file, code, make, reasonRx] of HOSTILE) {
  for (const engine of ['applyEmergencyToAll', 'applyFallbackToAll']) {
    test(`[HOSTILE] ${engine} ⇐ ${name}: لا كتابة بلا قبول البوابة`, () => {
      const ctx = loadCtx();
      const candidate = make(code);
      const verdict = ctx.FixVerifier.verifyFix(code, candidate, file, ctx.analyzeCode, {});
      ctx[engine] = (F) => { Object.keys(F).forEach(k => { F[k] = make(F[k]); }); return { totalFixed: 1 }; };
      ctx.F = { [file]: code };
      ctx.R = { [file]: { code, issues: ctx.analyzeCode(code, file) } };
      const report = ctx.fixAllEnginePipeline();
      const src = engine === 'applyEmergencyToAll' ? 'Emergency' : 'Fallback';
      const acc = (report.accepted || []).filter(a => a.source === src);
      if (verdict.accepted !== true) {
        assert.strictEqual(acc.length, 0, 'قُبل ما رفضته البوابة: ' + JSON.stringify(acc));
        assert.notStrictEqual(ctx.F[file], candidate, 'كُتب المرشّح المرفوض');
        assert.ok((report.rejected || []).some(r => r.source === src), 'الرفض غير مُسجَّل');
        if (reasonRx) assert.match(String(verdict.reason), reasonRx);
      } else {
        // البوابة لا ترى الضرر (textContent): الحماية هنا من المصدر — والمحركات الحقيقية لا تُنتجه (القسم 1)
        assert.strictEqual(reasonRx, null, 'حالة يُتوقع رفضها قُبلت: ' + verdict.reason);
      }
      // في كل الأحوال: لا نداء __escapeHTML بلا تعريف في الناتج
      const out = ctx.F[file];
      assert.ok(!/__escapeHTML\(/.test(out) || /function __escapeHTML\(/.test(out), 'نداء بلا تعريف:\n' + out);
    });
  }
}

// ═══ 3. [UNBOUND-HELPER] البوابة وتجزئة الإنقاذ ═══════════════════
const { createRepairEngine } = require('../public/server_repair_adapter.js');
const { FixVerifier: FV } = require('../public/server_engine_registration.js');
const E = createRepairEngine();
const gate = (b, a, f) => FV.verifyFix(b, a, f || 'a.js', (c, fn) => E.analyze(c, fn));

test('[UNBOUND-HELPER] نداء جديد لـ__escapeHTML بلا تعريف ⇒ رفض ضارّ', () => {
  const v = gate(SHOW, SHOW_ESC_CALL);
  assert.notStrictEqual(v.accepted, true);
  assert.match(String(v.reason), /^REJECTED_UNBOUND_HELPER/);
  assert.strictEqual(FV.isHarmfulRejection(v.reason), true, 'يجب أن يُعامَل ضارًّا فتُسقط الخطوة وحدها');
});

test('[UNBOUND-HELPER] نداء قائم أصلًا في before لا يُعدّ جديدًا (لا رفض بسببه)', () => {
  const b = 'function f(el, x) {\n  el.textContent = __fmt(x);\n}\nmodule.exports = f;\n';
  const a = 'function f(el, x) {\n  el.textContent = __fmt(x) + "";\n}\nmodule.exports = f;\n';
  const v = FV.verifyFix(b, a, 'a.js', () => [], { requireImprovement: false });
  assert.doesNotMatch(String(v.reason), /UNBOUND_HELPER/);
});

test('[UNBOUND-HELPER] تجزئة الإنقاذ: hunk النداء لا يُقبل مع إصلاحٍ سليم آخر بعد سقوط hunk التعريف', () => {
  // الشكل المقيس على GameServer: إصلاح SQL سليم يُحسّن العدّ، فيُقبل hunk النداء معه لولا الحارس.
  const base = 'function login(db, u) {\n  db.execute("SELECT * FROM t WHERE u=\'" + u + "\'");\n}\n' + SHOW.replace('module.exports = show;\n', '') +
               'module.exports = { login, show };\n';
  const cand = HELPER + '\nconst z = eval("1");\n' +
    base.replace('"SELECT * FROM t WHERE u=\'" + u + "\'"', '"SELECT * FROM t WHERE u=?", [u]')
        .replace('" + name + "', '" + __escapeHTML(name) + "');
  const r = FV.salvageVerifiedSubset(base, cand, (b, c) => { const v = gate(b, c); return v.accepted === true ? v : null; });
  assert.ok(r, 'إصلاح SQL السليم يجب أن يُنقَذ');
  assert.match(r.code, /u=\?", \[u\]/);
  assert.ok(!/__escapeHTML\(/.test(r.code), 'أُنقذ نداء بلا تعريف:\n' + r.code);
});

test('[UNBOUND-HELPER] تجزئة الإنقاذ لا تُبقي النداء وتُسقط التعريف', () => {
  // hunk التعريف يحمل معه eval جديدًا ⇒ يُرفض؛ hunk النداء وحده ⇒ UNBOUND_HELPER ⇒ يُرفض أيضًا.
  const cand = SHOW_ESC_CALL + '\n' + HELPER + '\nconst z = eval("1");\n';
  const whole = gate(SHOW, cand);
  assert.notStrictEqual(whole.accepted, true, 'الكتلة كاملة يجب أن تُرفض');
  const r = FV.salvageVerifiedSubset(SHOW, cand, (b, c) => { const v = gate(b, c); return v.accepted === true ? v : null; });
  if (r) assert.ok(!/__escapeHTML\(/.test(r.code) || /function __escapeHTML\(/.test(r.code), 'أُنقذ نداء بلا تعريف:\n' + r.code);
});

// ═══ 4. [XSS-ESCAPED] المحلل: إثبات لا نصّ، و[XSS-KEPT] البوابة ════════
const xssAt = (code, line) => E.analyze(code, 'a.js').filter(i =>
  Number(i.line) === line && /xss|innerhtml/i.test([i.type, i.title, i.cAct, i.cwe].join(' ')));

test('[XSS-ESCAPED] الأصل غير المُهرَّب: يُبلَّغ عنه', () => {
  assert.ok(xssAt(SHOW, 2).length >= 1);
  const GAME = fs.readFileSync(path.join(__dirname, 'fixtures', 'GameServer.js'), 'utf8');
  assert.ok(xssAt(GAME, 26).length >= 1, 'GameServer الأصلي: البلاغ باقٍ على السطر 26');
});

test('[XSS-ESCAPED] الإسناد المُهرَّب بالدالة المعيارية في سياق نص: لا بلاغ من أي كاشف', () => {
  assert.strictEqual(xssAt(SHOW_ESCAPED, 2).length, 0, JSON.stringify(xssAt(SHOW_ESCAPED, 2).map(i => i.title)));
});

const NEG = {
  'الدالة غير المعيارية (تُرجع القيمة كما هي)':
    SHOW_ESC_CALL + '\nfunction __escapeHTML(v) {\n  return String(v);\n}\n',
  'الدالة مُعاد ربطها بعد تعريفها': SHOW_ESCAPED + '__escapeHTML = function (v) { return v; };\n',
  'ظلّ محلي للدالة داخل الدالة': SHOW_ESCAPED.replace('function show(el, name) {\n', 'function show(el, name) {\n  const __escapeHTML = v => v;\n'),
  'سياق سمة href (التهريب لا يمنع javascript:)':
    'function show(el, u) {\n  el.innerHTML = \'<a href="\' + __escapeHTML(u) + \'">x</a>\';\n}\nmodule.exports = show;\n\n' + HELPER + '\n',
  'داخل <script>': 'function show(el, u) {\n  el.innerHTML = "<script>var a = \\"" + __escapeHTML(u) + "\\";</script>";\n}\nmodule.exports = show;\n\n' + HELPER + '\n',
  'قيمة خام إضافية بجانب المُهرَّبة': SHOW_ESCAPED.replace('__escapeHTML(name) + "', '__escapeHTML(name) + name + "'),
  'تعريفان للدالة': SHOW_ESCAPED + '\n' + HELPER + '\n',
};
for (const [name, code] of Object.entries(NEG)) {
  test(`[XSS-ESCAPED] سلبي — ${name}: البلاغ باقٍ`, () => {
    // سطر الإسناد قد ينزاح بسطر الظلّ المضاف
    const line = code.split('\n').findIndex(l => /\.innerHTML\s*=/.test(l)) + 1;
    assert.ok(xssAt(code, line).length >= 1, 'اختفى البلاغ دون إثبات:\n' + code);
  });
}

test('[XSS-KEPT] البوابة تقبل الإسناد المُهرَّب المُثبَت (المَصرِف باقٍ بنصّه والقيمة في سطر تالٍ)', () => {
  const b = 'function show(el, name) {\n  el.innerHTML =\n    "<h2>Top: " + name + "</h2>";\n}\nmodule.exports = show;\n';
  const a = b.replace('" + name + "', '" + __escapeHTML(name) + "') + '\n' + HELPER + '\n';
  const v = gate(b, a);
  assert.strictEqual(v.accepted, true, String(v.reason));
});

for (const [name, code] of Object.entries(NEG)) {
  if (!/innerHTML = "<h2>Top: "/.test(code)) continue;
  test(`[XSS-KEPT] سلبي — ${name}: البوابة لا تقبل`, () => {
    const v = gate(SHOW, code);
    assert.notStrictEqual(v.accepted, true, 'قُبل: ' + v.reason);
  });
}

test('[XSS-KEPT] بلا KnowledgeBase لا إثبات: الإثبات لا يُفترض', () => {
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'fix_verifier.js'), 'utf8');
  const ctx = { console: { log() {}, warn() {}, error() {} } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'acorn.min.js'), 'utf8'), ctx);
  vm.runInContext(src, ctx);
  const b = 'function show(el, name) {\n  el.innerHTML =\n    "<h2>Top: " + name + "</h2>";\n}\nmodule.exports = show;\n';
  const a = b.replace('" + name + "', '" + __escapeHTML(name) + "') + '\n' + HELPER + '\n';
  // محلّل يُخفي البلاغ عن السطر بعد التعديل (يحاكي اختفاءه) — والبوابة بلا KB لا تملك إثباتًا
  const an = c => (/__escapeHTML\(name\)/.test(c) ? [] : [{ type: 'XSS', title: 'XSS innerHTML', line: 2, sev: 'h' }]);
  const v = ctx.FixVerifier.verifyFix(b, a, 'a.js', an);
  assert.notStrictEqual(v.accepted, true, String(v.reason));
  assert.match(String(v.reason), /XSS_FIX_UNPROVEN/);
});
