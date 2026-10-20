// ═══════════════════════════════════════════════════════
// جسمُ catch على سطرِه ليس فراغًا — والكاشفُ كان لا يراه
// تشغيل:  node --test vercel-api/test/engine_java_catch_body.test.js
//
// ‎GHOST_DISCARDED_BATCH — no_candidate‎ على ‎EMPTY_CATCH/java‎ لم يكن عطبًا
// في Ghost ولا في البوابة. القاعدةُ السابعةُ في ‎engine_java‎ كانت تحكم على
// **السطرِ التالي وحدَه**:
//     if (/catch\\s*\\(/.test(line)) { const next = lines[i+1]; … }
// فلا تنظر إلى ما بين قوسَي الجسمِ على سطرِ الـcatch نفسِه. و‎fixEmptyCatch‎
// يُنتج الجسمَ هناك بالضبط:
//     } catch (Exception e) { android.util.Log.e("Error", e.getMessage()); }
// فيبقى البلاغُ قائمًا، فتحكم البوابةُ ‎REJECTED_NO_IMPROVEMENT‎ بحقّ،
// ويطرح Ghost الدفعة. إصلاحٌ صحيحٌ يُرَدُّ لأن الكاشفَ لا يراه.
//
// و‎[JAVA-CATCH-BODY]‎ يفحص جسمَ السطرِ أوّلًا: مغلقٌ على سطرِه ⇒ الحكمُ
// على ما بين القوسَين؛ وإلا فمنطقُ السطرِ التالي كما كان حرفًا.
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
const catches = code =>
  (ctx.analyzeCode(code, 'A.java') || []).filter(i => /catch فارغ/.test(String(i.title || '')));

const EMPTY = 'class A {\n  void f() {\n    try {\n      g();\n    } catch (Exception e) {}\n  }\n}\n';

test('[JC-1] جسمٌ معالِجٌ على سطرِ الـcatch ليس فراغًا', () => {
  const WITH_BODY = [
    'class A { void f() { try { g(); } catch (Exception e) { log(e); }\n  }\n}\n',
    'class A { void f() { try { g(); } catch (Exception e) { android.util.Log.e("E", e.getMessage()); }\n  }\n}\n',
    'class A {\n  void f() {\n    try { g(); } catch (Exception e) {\n      log(e);\n    }\n  }\n}\n',
  ];
  for (const code of WITH_BODY) {
    assert.strictEqual(catches(code).length, 0, 'بلاغٌ على جسمٍ معالِج: ' + code.split('\n')[1]);
  }
});

test('[JC-2] والفراغُ ما زال يُبلَّغ عنه بأشكالِه', () => {
  const STILL = [
    ['{}',        'class A { void f() { try { g(); } catch (Exception e) {}\n  }\n}\n'],
    ['{ }',       'class A { void f() { try { g(); } catch (Exception e) { }\n  }\n}\n'],
    ['سطرٌ تالٍ', 'class A {\n  void f() {\n    try { g(); } catch (Exception e) {\n    }\n  }\n}\n'],
    ['// ignore', 'class A {\n  void f() {\n    try { g(); } catch (Exception e) {\n    // ignore\n    }\n  }\n}\n'],
  ];
  for (const [label, code] of STILL) {
    assert.strictEqual(catches(code).length, 1, label + ': ضاع البلاغُ على فراغٍ حقيقيّ');
  }
});

test('[JC-3] والمسارُ الكامل: يُصلَح، ولا تُطرح الدفعة', () => {
  const issues = ctx.analyzeCode(EMPTY, 'A.java') || [];
  assert.ok(issues.some(i => /catch فارغ/.test(String(i.title))), 'tripwire: لا بلاغ');
  const r = ctx.repairCode(EMPTY, issues.map(x => Object.assign({}, x)), 'A.java');
  assert.ok((r.repairs || []).length >= 1, 'لم يُسجَّل إصلاح — ' +
    (((r.rejected || [])[0] || {}).reason || ''));
  assert.deepStrictEqual(
    Array.from((r.rejected || []).map(x => String(x.reason || ''))).filter(x => /GHOST_DISCARDED/.test(x)),
    [], 'ما زالت الدفعةُ تُطرح');
  assert.strictEqual(catches(r.repaired).length, 0, 'بقي البلاغُ بعد الإصلاح');
  assert.notStrictEqual(ctx.FixVerifier.syntaxCheck(r.repaired, 'A.java').ok, false, 'الناتجُ مكسور');
});

test('[JC-4] والخطأُ لم يعد يُبتلَع: الجسمُ يسجّله', () => {
  const r = ctx.repairCode(EMPTY, ctx.analyzeCode(EMPTY, 'A.java'), 'A.java');
  assert.match(r.repaired, /catch \(Exception e\) \{[^}]*e\.getMessage\(\)/,
    'الجسمُ لا يستعمل الاستثناء: ' + r.repaired);
});

test('[JC-5] وفشلُ مُرشَّحٍ واحدٍ لا يُسقط إصلاحاتِ الملفِّ الأخرى', () => {
  // ملفُّ جافا فيه catch فارغٌ ورابطٌ غيرُ مشفَّر: الاثنان يُصلَحان معًا،
  // وإن تعذّر أحدُهما بقي الآخر.
  const MIXED = [
    'class A {',
    '  String u = "http://api.example.com/v1";',
    '  void f() {',
    '    try {',
    '      g();',
    '    } catch (Exception e) {}',
    '  }',
    '}',
    '',
  ].join('\n');
  const issues = ctx.analyzeCode(MIXED, 'B.java') || [];
  const r = ctx.repairCode(MIXED, issues.map(x => Object.assign({}, x)), 'B.java');
  assert.doesNotMatch(r.repaired, /http:\/\//, 'الرابطُ لم يُصلَح');
  assert.strictEqual(catches(r.repaired).length, 0, 'الـcatch لم يُصلَح');
  assert.notStrictEqual(ctx.FixVerifier.syntaxCheck(r.repaired, 'B.java').ok, false, 'الناتجُ مكسور');
});

test('[JC-6] وبقيّةُ قواعدِ engine_java لم تتغيّر', () => {
  const MD5 = 'class A {\n  void f() throws Exception {\n    MessageDigest md = MessageDigest.getInstance("MD5");\n  }\n}\n';
  assert.ok((ctx.analyzeCode(MD5, 'C.java') || []).some(i => /md5|تشفير|327/i.test(String(i.title))),
    'ضاع بلاغُ MD5');
  const NPE = 'class A {\n  int f(String s) {\n    return s.length();\n  }\n}\n';
  assert.ok(Array.isArray(ctx.analyzeCode(NPE, 'D.java')), 'المحرّكُ رمى على جافا عاديّة');
});
