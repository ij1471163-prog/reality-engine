// ═══════════════════════════════════════════════════════
// بلاغٌ لا يُوجَّه إلى مُصلِحِ مشكلةٍ أخرى لأنّ عنوانَه يحمل كلمتَها
// تشغيل:  node --test vercel-api/test/detect_strategy_misroute.test.js
//
// ‎detectStrategy‎ يستنتج الوجهةَ من كلماتِ العنوانِ متى لم يُعلنها الكاشف.
// و‎repair_strategy_routing‎ أغلق الانحرافَ حيث يحمل العنوانُ اسمًا من كودِ
// المستخدم (‎authZ‎، ‎/eval‎). لكنّ العناوينَ **الثابتة** انحرفت كذلك، وبقي
// الانحرافُ مستورًا لأنّ المُصلِحَ يمتنع فيختفي البلاغُ بلا أثر:
//   CWE-778  «No Audit Logging»            ← log      ⇒ LOG_SECRET
//        وهما ضدّان: البلاغُ «لا يُسجَّل شيء» والمُصلِحُ يحذف المُسجَّل.
//   CWE-759 / CWE-916  «Weak Password Hash…» ← password ⇒ HARDCODED_PASS
//        والمُصلِحُ يستبدل نصًّا حرفيًّا بـ‎process.env‎ — لا علاجَ لخوارزميّة.
//   CWE-640  «Review Password Reset Logic» ← password ⇒ HARDCODED_PASS
//   CWE-943 ×2 و‎NoSQL‎ ×4                  ← sql      ⇒ SQL_INJECTION
//   «CORS Credentials + Wildcard»          ← credential ⇒ HARDCODED_SECRET
//   «Timing Attack via == comparison»      ← ==       ⇒ LOOSE_EQUALITY
//        و‎===‎ ليست علاجًا لتسريبِ التوقيت، علاجُه ‎timingSafeEqual‎.
//   «Cookie بدون Secure/HttpOnly»          ← http     ⇒ HTTP_USAGE
//
// ولم يُكتَب من ذلك تعديلٌ ضارٌّ قطّ — مقيسٌ في ‎[CR-5]‎ — لكنّ الوجهةَ
// خاطئةٌ وهشّة: يكفي أن يتّسع نمطُ مُصلِحٍ ليكتبَ رقعةً على بلاغٍ ليس له.
// و‎[CVE-ROUTE]‎ و‎[EXT-ROUTE]‎ يُعلنان ‎strategy: null‎ في هذه العشرة.
// ═══════════════════════════════════════════════════════
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadUiContext() {
  const store = new Map(), noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => null, addEventListener: noop, createElement: () => ({}),
                querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null),
                    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة */ }
  }
  return ctx;
}
const ctx = loadUiContext();
const langOf = fn => (fn.endsWith('.py') ? 'py' : fn.endsWith('.ts') ? 'ts' : 'js');
const findingsFor = (code, fn, rx) =>
  (ctx.analyzeCode(code, fn) || []).filter(i => rx.test(String(i.title || '')));

// عيّناتٌ واقعيّةٌ تُطلق كلَّ نمطٍ من العشرة
const SAMPLES = {
  'CWE-778': ['r.js', "const express = require('express');\nconst app = express();\napp.post('/users', (req, res) => {\n  res.send('ok');\n});\n", /No Audit Logging/],
  'CWE-759': ['h.py', 'import hashlib\n\ndef f(pw):\n    return hashlib.md5(pw).hexdigest()\n', /Weak Password Hash \(CWE-759\)/],
  'CWE-916': ['h.py', 'import hashlib\n\ndef f(pw):\n    return hashlib.md5(pw).hexdigest()\n', /Weak Password Hashing \(CWE-916\)/],
  'CWE-640': ['p.js', 'function f(user) {\n  return sendResetPasswordEmail(user, "noreply@example.com");\n}\nmodule.exports = { f };\n', /Review Password Reset Logic/],
  'CWE-943a': ['n.js', 'function f(db, q) {\n  return db.users.find({ $where: "this.n == \'" + q + "\'" });\n}\nmodule.exports = { f };\n', /NoSQL Injection/],
  'CWE-943b': ['g.js', 'function f(db, req) {\n  return db.users.find({ n: { $regex: req.query.n } });\n}\nmodule.exports = { f };\n', /NoSQL ReDoS/],
  'NoSQL$ne': ['q.js', 'function f(db) {\n  return db.users.find({ pw: { $ne: null } });\n}\nmodule.exports = { f };\n', /NoSQL Bypass/],
  'NoSQLbody': ['w.js', 'function f(db, req) {\n  return db.users.find(req.body);\n}\nmodule.exports = { f };\n', /NoSQL Injection — Direct/],
  // النمطُ يطلب ‎*‎ عاريةً بعد ‎origin:‎ — لا ‎"*"‎ — فلا يُطلقه إلا سطرٌ
  // بهذا الشكلِ الحرفيّ. وهذا أضيقُ عيّنةٍ تُطلقه فعلًا.
  'CORS': ['c.js', 'const CORS_DOC = "origin: *, credentials: true";\nfunction f() {\n  return CORS_DOC;\n}\nmodule.exports = { f };\n', /CORS Credentials \+ Wildcard/],
  // العنصرُ الرابعُ — حين يوجد — هو نمطُ **بقاءِ المشكلة** بعد الدورة،
  // أوسعُ من نمطِ تمييزِ البلاغ: تحذيرُ التوقيتِ ينتقل بعد ‎===‎ إلى
  // عنوانٍ شقيقٍ يسمّي العلاجَ الصحيح، وذلك بقاءٌ لا اختفاء.
  'Timing': ['t.js', 'function check(token, expected) {\n  if (token == expected) { return true; }\n  return false;\n}\nmodule.exports = { check };\n', /Timing Attack via ==/, /Timing Attack/],
};

test('[CR-1] العناوينُ العشرةُ لا تُوجَّه إلى مُصلِحٍ ليس لها', () => {
  for (const [key, [fn, code, rx]] of Object.entries(SAMPLES)) {
    const hits = findingsFor(code, fn, rx);
    assert.ok(hits.length >= 1, key + ': tripwire — العيّنةُ لا تُطلق النمط');
    for (const i of hits) {
      assert.strictEqual(i.strategy, null, key + ': الكاشفُ لم يُعلن strategy');
      assert.strictEqual(ctx.detectStrategy(i, langOf(fn)), null,
        key + ': ما زال يُوجَّه إلى ' + ctx.detectStrategy(i, langOf(fn)));
    }
  }
});

test('[CR-2] والتوجيهُ الصحيحُ لم يُمَسّ', () => {
  const KEEP = [
    ['SQL/js',  'a.js', 'function f(db, name) {\n  return db.query("SELECT * FROM u WHERE n = \'" + name + "\'");\n}\nmodule.exports = { f };\n', /SQL Injection/, 'SQL_INJECTION'],
    ['CMD/js',  'b.js', 'const cp = require("child_process");\nfunction f(d) {\n  return cp.exec("ls " + d);\n}\nmodule.exports = { f };\n', /Command Injection/, 'CMD_INJECTION'],
    ['LOG/js',  'c.js', 'function f(password) {\n  console.log("pw", password);\n}\nmodule.exports = { f };\n', /Sensitive Data|تسجيل/, 'LOG_SECRET'],
    ['CRYPTO',  'd.js', 'const crypto = require("crypto");\nfunction f(x) {\n  return crypto.createHash("md5").update(x).digest("hex");\n}\nmodule.exports = { f };\n', /MD5|ضعيف/, 'WEAK_CRYPTO'],
    ['AUTH/js', 'e.js', "const express = require('express');\nconst app = express();\napp.post('/users', (req, res) => {\n  res.send('ok');\n});\n", /Missing Auth|Lack Auth/, 'MISSING_AUTH'],
  ];
  for (const [label, fn, code, rx, want] of KEEP) {
    const hits = findingsFor(code, fn, rx);
    assert.ok(hits.length >= 1, label + ': tripwire — لا بلاغ');
    assert.ok(hits.some(i => ctx.detectStrategy(i, langOf(fn)) === want),
      label + ': ضاع التوجيهُ إلى ' + want + ' — ' +
      hits.map(i => i.title + '→' + ctx.detectStrategy(i, langOf(fn))).join(' | '));
  }
});

test('[CR-3] واستنتاجُ العنوانِ باقٍ لمن لم يُعلن: null ليست undefined', () => {
  // ‎[EXT-ROUTE]‎ مرّر الحقلَ ولم يفرضه. فنمطٌ بلا إعلانٍ يبقى على
  // الاستنتاجِ حرفًا — وإلا لسقطت عشراتُ البلاغاتِ الصحيحة.
  const XSS = 'function f(el, req) {\n  el.innerHTML = req.query.q;\n}\nmodule.exports = { f };\n';
  const hits = findingsFor(XSS, 'x.js', /XSS/);
  assert.ok(hits.length >= 1, 'tripwire: لا بلاغَ XSS');
  assert.ok(hits.some(i => i.strategy === undefined),
    'كلُّ البلاغاتِ صارت مُعلَنة — فُرض الحقلُ على من لا يُعلن');
  assert.ok(hits.some(i => ctx.detectStrategy(i, 'js') === 'XSS_INNER_HTML'),
    'ضاع الاستنتاجُ الصحيح');
});

test('[CR-4] وإصلاحاتُ السطرِ نفسِه لم تسقط مع الوجهةِ الخاطئة', () => {
  // سطرُ ‎token == expected‎ فيه بلاغُ تساوٍ فضفاضٍ حقيقيٌّ من كاشفِه،
  // فالإصلاحُ يمضي وإن لم يَعُد بلاغُ التوقيتِ يُوجَّه إليه.
  const [fn, code] = [SAMPLES.Timing[0], SAMPLES.Timing[1]];
  const r = ctx.repairCode(code, (ctx.analyzeCode(code, fn) || []).map(x => Object.assign({}, x)), fn);
  assert.match(r.repaired, /token === expected/, 'ضاع إصلاحُ ===');
  assert.ok((r.repairs || []).some(p => p.strategy === 'LOOSE_EQUALITY'), 'لم يُسجَّل الإصلاح');
  // وبلاغُ التعميةِ الضعيفةِ على سطرِ hashlib باقٍ بقناتِه الصحيحة
  const [pf, pc] = [SAMPLES['CWE-759'][0], SAMPLES['CWE-759'][1]];
  const crypto = findingsFor(pc, pf, /تشفير ضعيف|MD5|SHA/);
  assert.ok(crypto.some(i => ctx.detectStrategy(i, 'py') === 'WEAK_CRYPTO'),
    'ضاع تحذيرُ التعميةِ الضعيفة بعد إسكاتِ CWE-759/916');
});

test('[CR-5] ولا تعديلَ ضارًّا على أيٍّ من العشرة، ولا نجاحَ كاذب', () => {
  for (const [key, [fn, code, rx, concernRx]] of Object.entries(SAMPLES)) {
    const r = ctx.repairCode(code, (ctx.analyzeCode(code, fn) || []).map(x => Object.assign({}, x)), fn);
    // المشكلةُ الأصليّةُ ما زالت مُبلَّغًا عنها بعد الدورة — لم تُسكَت
    assert.ok(findingsFor(r.repaired, fn, concernRx || rx).length >= 1,
      key + ': اختفى البلاغُ بلا علاج — نجاحٌ كاذب\n' + r.repaired);
    assert.notStrictEqual(ctx.FixVerifier.syntaxCheck(r.repaired, fn).ok, false,
      key + ': الناتجُ مكسورٌ بنيويًّا');
  }
});

test('[CR-6] ولا بلاغَ من العشرةِ يظهر في rejected باسمِ استراتيجيّةٍ ليست له', () => {
  const WRONG = { 'CWE-778': 'LOG_SECRET', 'CWE-759': 'HARDCODED_PASS', 'CWE-916': 'HARDCODED_PASS',
                  'CWE-640': 'HARDCODED_PASS', 'CWE-943a': 'SQL_INJECTION', 'CWE-943b': 'SQL_INJECTION',
                  'NoSQL$ne': 'SQL_INJECTION', 'NoSQLbody': 'SQL_INJECTION',
                  'CORS': 'HARDCODED_SECRET', 'Timing': 'LOOSE_EQUALITY' };
  for (const [key, [fn, code, rx]] of Object.entries(SAMPLES)) {
    const issues = ctx.analyzeCode(code, fn) || [];
    const line = (findingsFor(code, fn, rx)[0] || {}).line;
    const r = ctx.repairCode(code, issues.map(x => Object.assign({}, x)), fn);
    const others = issues.filter(i => i.line === line && !rx.test(String(i.title)));
    // استثناءٌ واحد: سطرُ Timing يحمل بلاغَ تساوٍ حقيقيًّا، فـLOOSE_EQUALITY عليه مشروعة
    if (others.some(i => ctx.detectStrategy(i, langOf(fn)) === WRONG[key])) continue;
    for (const x of (r.rejected || []).concat(r.dropped || [])) {
      if (x.line !== line) continue;
      assert.notStrictEqual(String(x.strategy), WRONG[key],
        key + ': ما زال يُنسَب إلى ' + WRONG[key] + ' — ' + String(x.reason || '').slice(0, 70));
    }
  }
});
