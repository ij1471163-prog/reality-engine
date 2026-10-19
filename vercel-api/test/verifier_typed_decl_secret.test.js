// ═══════════════════════════════════════════════════════
// إثباتُ نقلِ السرِّ إلى البيئة في اللغاتِ ذاتِ الأنواع
// تشغيل:  node --test vercel-api/test/verifier_typed_decl_secret.test.js
//
// ‎secretFixProven‎ تطلب شيئَين: سطرَ إسنادِ سرٍّ اختفى، وسطرًا جديدًا يُسنِد
// إلى **المفتاحِ نفسِه** من مصدرِ بيئة. وكلاهما يُلتقَط بنمطٍ كان يسمح
// بالمُعدِّلات ولا يسمح باسمِ النوع، ولا يعرف ‎export‎:
//
//     static final String DB_PASSWORD = "…"     ⇒ لا يُلتقَط  (النوع String)
//     const string DB_PASSWORD = "…"            ⇒ لا يُلتقَط  (النوع string)
//     export const DB_PASSWORD = "…"            ⇒ لا يُلتقَط  (export)
//
// فتخرج ‎gone‎ فارغةً ويُرَدُّ كلُّ نقلٍ صحيحٍ بـ‎REJECTED_SECRET_FIX_UNPROVEN‎.
// والمقيسُ في مصفوفةِ القدرة: ‎HARDCODED_SECRET‎ و‎API_KEY‎ في java و cs —
// أربعُ خلايا — تُصلَح في js و py و php وتُرَدُّ فيهما.
//
// و‎[TYPED-DECL]‎ يسمح بنوعٍ **اختياريّ** قبل المفتاح. والمفتاحُ بعده مطلوبٌ
// قبل ‎[:=]‎، فحيث لا نوعَ (js, py, php) يتراجع النمطُ ويلتقط المفتاحَ كما
// كان — وهو ما تحرسه ‎[TD-4]‎.
//
// والاتجاهُ الخطرُ في توسيعِ إثباتٍ أمنيٍّ هو القبول، لا الرفض. فـ‎[TD-2]‎
// و‎[TD-3]‎ تُمسكان به: اختفاءُ السطرِ ليس إصلاحًا، وإحلالُ سرٍّ محلَّ سرٍّ
// ليس إصلاحًا، ومفتاحٌ آخرُ يقرأ البيئة ليس إصلاحًا لهذا المفتاح.
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
const gate = (before, after, file) => ctx.FixVerifier.verifyFix(before, after, file, ctx.analyzeCode);

const JAVA = 'class A {\n  static final String DB_PASSWORD = "ZZfakeSecretValue123";\n}\n';
const CS   = 'class A {\n  const string DB_PASSWORD = "ZZfakeSecretValue123";\n}\n';

test('[TD-1] النقلُ الصحيحُ إلى البيئة يُقبَل في java و csharp', () => {
  const OK = [
    ['A.java', JAVA, JAVA.replace('"ZZfakeSecretValue123"', 'System.getenv("DB_PASSWORD")')],
    ['A.cs',   CS,   CS.replace('"ZZfakeSecretValue123"', 'Environment.GetEnvironmentVariable("DB_PASSWORD")')],
  ];
  for (const [file, before, after] of OK) {
    const v = gate(before, after, file);
    assert.strictEqual(v.accepted, true, file + ': ' + v.reason);
    assert.doesNotMatch(String(v.reason || ''), /SECRET_FIX_UNPROVEN/);
  }
});

test('[TD-2] واختفاءُ السطرِ وحدَه ليس إصلاحًا', () => {
  const NOT = [
    ['A.java', JAVA, 'class A {\n}\n',                                        'حذفُ السطر'],
    ['A.cs',   CS,   'class A {\n}\n',                                        'حذفُ السطر'],
    ['A.java', JAVA, JAVA.replace('static final String DB_PASSWORD = "ZZfakeSecretValue123";', '// moved'), 'تعليق'],
  ];
  for (const [file, before, after, why] of NOT) {
    assert.strictEqual(gate(before, after, file).accepted, false, file + ' / ' + why + ': قُبل');
  }
});

test('[TD-3] ولا إحلالُ قيمةٍ أخرى، ولا مفتاحٌ آخرُ يقرأ البيئة', () => {
  const NOT = [
    [JAVA, JAVA.replace('ZZfakeSecretValue123', 'ZZotherSecretValue999'), 'سرٌّ بسرٍّ آخر'],
    [JAVA, JAVA.replace('"ZZfakeSecretValue123"', '""'),                  'نصٌّ فارغ'],
    [JAVA, 'class A {\n  static final String OTHER = System.getenv("X");\n}\n', 'مفتاحٌ آخر'],
  ];
  for (const [before, after, why] of NOT) {
    assert.strictEqual(gate(before, after, 'A.java').accepted, false, why + ': قُبل');
  }
});

test('[TD-4] ولغاتُ بلا أنواعٍ لم تتغيّر: المفتاحُ يُلتقَط كما كان', () => {
  const SAME = [
    ['a.js',  'const DB_PASSWORD = "ZZfakeSecretValue123";\nmodule.exports = { DB_PASSWORD };\n',
              'const DB_PASSWORD = process.env.DB_PASSWORD;\nmodule.exports = { DB_PASSWORD };\n'],
    ['a.py',  'DB_PASSWORD = "ZZfakeSecretValue123"\n',
              "import os\nDB_PASSWORD = os.environ.get('DB_PASSWORD', '')\n"],
    ['a.php', '<?php\n$DB_PASSWORD = "ZZfakeSecretValue123";\n',
              "<?php\n$DB_PASSWORD = getenv('DB_PASSWORD');\n"],
  ];
  for (const [file, before, after] of SAME) {
    const v = gate(before, after, file);
    assert.strictEqual(v.accepted, true, file + ' تراجع: ' + v.reason);
  }
  // وما كان يُرفَض فيها ما زال مرفوضًا
  assert.strictEqual(gate('const DB_PASSWORD = "ZZfakeSecretValue123";\nmodule.exports = { DB_PASSWORD };\n',
                          'module.exports = {};\n', 'a.js').accepted, false,
    'js: حذفُ السطرِ صار يُقبَل');
});

test('[TD-5] والمسارُ الكامل: السرُّ ينتقل إلى البيئةِ فعلًا في java و cs', () => {
  const CASES = [
    ['A.java', JAVA, /System\.getenv/],
    ['A.cs',   CS,   /Environment\.GetEnvironmentVariable/],
    ['B.java', 'class A {\n  static final String API_KEY = "ZZfakeApiKeyValue456";\n}\n', /System\.getenv/],
    ['B.cs',   'class A {\n  const string API_KEY = "ZZfakeApiKeyValue456";\n}\n', /Environment\.GetEnvironmentVariable/],
  ];
  for (const [file, code, want] of CASES) {
    const issues = ctx.analyzeCode(code, file) || [];
    assert.ok(issues.length > 0, file + ': لا بلاغ');
    const r = ctx.repairCode(code, issues.map(x => Object.assign({}, x)), file);
    assert.ok(!/ZZfake(SecretValue123|ApiKeyValue456)/.test(r.repaired),
      file + ': السرُّ باقٍ — ' + (((r.rejected || [])[0] || {}).reason || ''));
    assert.match(r.repaired, want, file + ': لم يُقرأ من البيئة');
  }
});
