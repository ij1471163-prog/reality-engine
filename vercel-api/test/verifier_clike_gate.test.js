// ═══════════════════════════════════════════════════════
// بوابةُ java و csharp: فاحصٌ بنيويٌّ بدل الرفضِ الشامل
// تشغيل:  node --test vercel-api/test/verifier_clike_gate.test.js
//
// المقياسُ الذي أوجب التعديل — مصفوفةُ القدرة (23 استراتيجيّةً × لغاتِها
// المُعلَنة في ‎STRATEGY_LANGS‎، 68 خليّة): ثماني خلايا كانت تسقط بالسببِ
// الواحد ‎GHOST_DISCARDED_BATCH — no_candidate_passed_gate ·
// REJECTED_NO_SYNTAX_CHECKER‎، وكلُّها java أو cs. فالبوابةُ fail-closed
// ولا فاحصَ لهاتين اللغتين لا فيها ولا في مسارِ الخادم، فكلُّ مُرشَّحٍ
// فيهما مردودٌ مهما صحّ.
//
// و‎[CLIKE-GATE]‎ نقلٌ للفحصِ البنيويِّ القائمِ إليهما، كما فُعل بـ‎[PHP-GATE]‎
// ثم ‎[TS-GATE]‎. ولا يُضعِف fail-closed: المكسورُ يُرَدّ بدليل، وغيرُ
// المحسومِ يبقى بلا حكمٍ فيُرَدّ كما كان.
//
// وحدُّ الفاحصِ مُعلَن: توازنُ أقواسٍ ونصوصٍ وتعليقات، لا مُحلِّلُ جافا ولا
// مدقِّقُ أنواع. فخطأٌ لا يُخِلّ بالتوازن يمرّ منه — وهو حدُّ الفاحصِ الذي
// تثق به اللغاتُ الثلاثُ الأخرى اليوم.
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
const check = (code, file) => ctx.FixVerifier.syntaxCheck(code, file);
/** الحكمُ الثلاثيُّ المُعلَن: ok · broken · unknown */
const verdict = (code, file) => {
  const r = check(code, file);
  return r.ok ? 'ok' : (r.available ? 'broken' : 'unknown');
};

// ═══ الفاحصُ نفسُه ═══

test('[CG-1] شفرةٌ سليمةٌ في java و csharp تُحكَم ok', () => {
  const OK = [
    ['a.java', 'class A {\n  int f(int x) { return x / 2; }\n}\n'],
    ['a.java', 'class A {\n  double f(double a, double b) { return a / b / 2.0; }\n}\n'],
    ['a.java', 'import java.util.*;\nclass A {\n  Map<String, List<Integer>> m = new HashMap<>();\n}\n'],
    ['a.java', 'class A {\n  String s = "a) b { c";\n}\n'],
    ['a.java', 'class A {\n  // } ) ]\n  int x = 1;\n}\n'],
    ['a.cs',   'class A {\n  int F(int x) { return x / 2; }\n}\n'],
    ['a.cs',   'class A {\n  Func<int, int> f = x => x * 2;\n}\n'],
    ['a.cs',   'class A {\n  string S(int a) { return $"v={a} ok"; }\n}\n'],
  ];
  for (const [file, code] of OK) {
    assert.strictEqual(verdict(code, file), 'ok', file + ': ' + code.split('\n')[1]);
  }
});

test('[CG-2] والمكسورُ يُحكَم broken — لا ok ولا صمت', () => {
  const BROKEN = [
    ['a.java', 'class A {\n  int f() { return 1;\n}\n'],
    ['a.java', 'class A {\n  int f() { return 1; }}\n}\n'],
    ['a.java', 'class A {\n  String s = "abc;\n}\n'],
    ['a.cs',   'class A {\n  int F() { return 1;\n}\n'],
    ['a.cs',   'class A {\n  string s = \'x;\n}\n'],
  ];
  for (const [file, code] of BROKEN) {
    assert.strictEqual(verdict(code, file), 'broken', file + ': ' + JSON.stringify(code));
  }
});

test('[CG-3] وما لا يحسمه الفاحصُ يبقى بلا حكم، لا «سليمًا»', () => {
  // كتلُ النصِّ وا��نصُّ الحرفيُّ تتجاوز موازنةَ الاقتباس، فالصمتُ أصدقُ
  // من حكمٍ لا يُعتمَد — والنتيجةُ رفضٌ كما كان الحالُ قبل التعديل.
  const UNK = [
    ['a.java', 'class A {\n  String s = """\n    hi\n  """;\n}\n'],
    ['a.cs',   'class A {\n  string p = @"C:\\x\\y";\n}\n'],
    ['a.cs',   'class A {\n  string p = """abc""";\n}\n'],
  ];
  for (const [file, code] of UNK) {
    assert.strictEqual(verdict(code, file), 'unknown', file);
    const r = check(code, file);
    assert.strictEqual(r.available, false);
    assert.strictEqual(r.ok, false, 'غيرُ المحسومِ لا يُقرأ نجاحًا');
  }
});

// ═══ أثرُه على البوابة والمسارِ الكامل ═══

test('[CG-4] البوابةُ تقبل مُرشَّحًا صحيحًا في java/cs وترفض المكسور', () => {
  const FV = ctx.FixVerifier;
  const PAIRS = [
    ['App.java', 'class A {\n  String u = "http://x.example.com/p";\n}\n'],
    ['App.cs',   'class A {\n  string u = "http://x.example.com/p";\n}\n'],
  ];
  for (const [file, before] of PAIRS) {
    const good = before.replace('http://', 'https://');
    const g = FV.verifyFix(before, good, file, ctx.analyzeCode);
    assert.strictEqual(g.accepted, true, file + ' رُدَّ مُرشَّحٌ صحيح: ' + g.reason);
    assert.doesNotMatch(String(g.reason || ''), /REJECTED_NO_SYNTAX_CHECKER/);

    const bad = good.replace(/\n\}\n$/, '\n');     // قوسُ الصنفِ محذوف
    const b = FV.verifyFix(before, bad, file, ctx.analyzeCode);
    assert.strictEqual(b.accepted, false, file + ': قُبل مُرشَّحٌ مكسور');
  }
});

test('[CG-5] والمسارُ الكامل: ‎http://‎ يُصلَح في java و cs', () => {
  // أربعُ خلايا في مصفوفةِ القدرة كانت تسقط، وهذه اثنتان منها من طرفٍ إلى طرف.
  const CASES = [
    ['App.java', 'class A {\n  String u = "http://api.example.com/v1";\n}\n'],
    ['App.cs',   'class A {\n  string u = "http://api.example.com/v1";\n}\n'],
  ];
  for (const [file, code] of CASES) {
    const issues = ctx.analyzeCode(code, file) || [];
    assert.ok(issues.length > 0, file + ': لا بلاغ — العطبُ انتقل إلى الكشف');
    const r = ctx.repairCode(code, issues.map(x => Object.assign({}, x)), file);
    assert.ok(!String(r.repaired).includes('http://'),
      file + ': لم يُصلَح — ' + ((r.rejected || [])[0] || {}).reason);
    assert.strictEqual(verdict(r.repaired, file), 'ok', file + ': الناتجُ غيرُ متوازن');
  }
});

// ═══ ولا تُمَسُّ اللغاتُ الأخرى ═══

test('[CG-6] أحكامُ بقيّةِ اللغاتِ كما كانت', () => {
  const SAME = [
    ['a.js',  'function f() { return 1; }\n',        'ok'],
    ['a.js',  'const r = /a\\/b/; function f() { return 1 / 2; }\n', 'ok'],
    ['a.js',  'function f() { return 1;\n',          'broken'],
    ['a.py',  'def f():\n    return 1\n',            'ok'],
    ['a.php', '<?php\nfunction f() { return 1; }\n', 'ok'],
    ['a.go',  'package main\nfunc main() {}\n',      'unknown'],
    ['a.rb',  'def f\n  1\nend\n',                   'unknown'],
  ];
  for (const [file, code, want] of SAME) {
    assert.strictEqual(verdict(code, file), want, file + ' تغيّر حكمُه');
  }
});

test('[CG-7] ونسختا الفاحصِ ما زالتا متطابقتَين سلوكًا على java/cs', () => {
  // ‎verifier_php_syntax_gate‎ يُثبّت التطابقَ النصّيّ؛ وهذا يُثبّت أن مسارَ
  // الخادمِ صار يفحص اللغتين فعلًا بدل أن يُعيد null لهما.
  const srv = require(path.join(PUBLIC_DIR, 'server_engine_registration.js'));
  const problem = srv.serverSyntaxProblem || (srv.ServerEngines && srv.ServerEngines.serverSyntaxProblem);
  if (typeof problem !== 'function') { assert.ok(true, 'غيرُ مُصدَّرة — يكفي التطابقُ النصّيّ'); return; }
  const before = 'class A {\n  String u = "http://x.example.com/p";\n}\n';
  assert.strictEqual(problem(before, before.replace('http://', 'https://'), 'App.java'), null,
    'مسارُ الخادمِ يردُّ مُرشَّحًا صحيحًا في جافا');
  assert.match(String(problem(before, before.replace(/\n\}\n$/, '\n'), 'App.java') || ''),
    /REJECTED_SYNTAX_BROKEN \[java\]/, 'مسارُ الخادمِ لا يرى الكسرَ في جافا');
});
