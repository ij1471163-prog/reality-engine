// ═══════════════════════════════════════════════════════
// فجوتا كشفٍ سببُهما شكلٌ واحدٌ مُفترَض، لا غيابُ قاعدة
// تشغيل:  node --test vercel-api/test/analyzer_detect_shape_gaps.test.js
//
// ‎[FOREACH-LOOP]‎ — كاشفُ التراكم لا يعمل إلا داخلَ حلقة، و‎loopLines‎ كانت
// تطابق ‎for(‎ و‎while(‎ و‎.forEach(‎ فقط. و‎foreach (…)‎ — حلقةُ PHP وC#
// الأشيع — ليست أيًّا منها: ‎for‎ يليه ‎each‎ لا قوس. فسقط ‎ACCUMULATION/php‎
// كلُّه، وبقيّةُ شروطِه مُستوفاة: النمطُ يطابق ‎$total = $it[…]‎، والمتغيّرُ
// مُهيَّأٌ بصفرٍ قبلَها، والسطرُ ليس ضوضاء — والحلقةُ وحدَها كانت صفرًا.
//
// ‎[EXEC-RECEIVER]‎ — بلاغُ ‎NameError‎ كان معلّقًا على نصٍّ حرفيّ:
// ‎code.includes('cursor.execute(query')‎. واسمُ المؤشِّرِ اصطلاحٌ لا قاعدة،
// فـ‎cur‎ و‎db‎ و‎conn‎ تمرّ بلا بلاغ. والحارسُ الحقيقيُّ هو ‎queryBound‎:
// لا بلاغَ إن كان ‎query‎ مُعرَّفًا في الملفّ — وهو لم يُمَسّ.
//
// وكلاهما تعميمُ شكلٍ لقاعدةٍ قائمة، لا قاعدةٌ جديدة.
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
const find = (code, fn, rx) => (ctx.analyzeCode(code, fn) || []).filter(i => rx.test(String(i.title || '')));

// ═══ [FOREACH-LOOP] ═══

const PHP_ACC = '<?php\nfunction f($items) {\n  $total = 0;\n  foreach ($items as $it) {\n    $total = $it["price"];\n  }\n  return $total;\n}\n';

test('[DG-1] تراكمٌ داخل foreach في PHP يُكتشَف', () => {
  const hits = find(PHP_ACC, 'a.php', /تراكم/);
  assert.strictEqual(hits.length, 1, 'لا بلاغَ تراكم');
  assert.strictEqual(hits[0].line, 5, 'السطرُ خطأ: ' + hits[0].line);
  assert.strictEqual(hits[0].strategy, 'ACCUMULATION');
});

test('[DG-2] و‎loopLines‎ ترى جسمَ foreach حلقةً، في php و cs', () => {
  const cs = 'class A {\n  int Sum(int[] xs) {\n    int t = 0;\n    foreach (var x in xs) {\n      t = x;\n    }\n    return t;\n  }\n}\n';
  for (const [code, ext, body] of [[PHP_ACC, 'php', 4], [cs, 'cs', 4]]) {
    const flags = ctx.loopLines(code, ext);
    assert.strictEqual(flags[body], 1, ext + ': سطرُ الجسمِ ليس داخلَ حلقة');
    assert.strictEqual(flags[0], 0, ext + ': سطرٌ خارجَ الحلقةِ عُدَّ داخلَها');
  }
});

test('[DG-3] ولا يتغيّر ما كان يعمل: for و while و .forEach', () => {
  const JS = 'function f(items) {\n  let total = 0;\n  for (const it of items) {\n    total = it.price;\n  }\n  return total;\n}\nmodule.exports = { f };\n';
  assert.strictEqual(find(JS, 'a.js', /تراكم/).length, 1, 'تراجع كشفُ JS');
  const PY = 'def f(items):\n    total = 0\n    for it in items:\n        total = it["price"]\n    return total\n';
  assert.strictEqual(find(PY, 'a.py', /تراكم/).length, 1, 'تراجع كشفُ Python');
  // وسطرٌ خارجَ أيِّ حلقةٍ لا يُبلَّغ عنه
  const OUT = '<?php\nfunction f($it) {\n  $total = 0;\n  $total = $it["price"];\n  return $total;\n}\n';
  assert.strictEqual(find(OUT, 'b.php', /تراكم/).length, 0, 'بلاغٌ خارجَ حلقة');
});

// ═══ [EXEC-RECEIVER] ═══

test('[DG-4] ‎NameError‎ لا يتعلّق باسمِ المؤشِّر', () => {
  for (const recv of ['cursor', 'cur', 'db', 'conn']) {
    const code = 'def f(' + recv + '):\n    # query = "SELECT 1"\n    return ' + recv + '.execute(query)\n';
    const hits = find(code, 'a.py', /NameError/);
    assert.strictEqual(hits.length, 1, recv + ': لا بلاغ');
    assert.strictEqual(hits[0].line, 3, recv + ': سطرٌ خطأ');
  }
});

test('[DG-5] والحارسُ باقٍ: ‎query‎ مُعرَّفٌ ⇒ لا بلاغ', () => {
  const BOUND = [
    'query = "SELECT 1"\ndef f(cur):\n    return cur.execute(query)\n',
    'def f(cur, query):\n    return cur.execute(query)\n',
    'def f(cur, rows):\n    for query in rows:\n        cur.execute(query)\n',
  ];
  for (const code of BOUND) {
    assert.strictEqual(find(code, 'a.py', /NameError/).length, 0,
      'إيجابٌ كاذب: ' + code.split('\n')[0]);
  }
});

// ═══ كودٌ واقعيّ: الإصلاحُ كاملٌ، والكودُ لم ينكسر ═══

test('[DG-6] وحدةُ PHP واقعيّة: التراكمُ يُصلَح ولا تختفي بقيّةُ البلاغات', () => {
  const REAL = [
    '<?php',
    'function summarize($orders) {',
    '  $total = 0;',
    '  $count = 0;',
    '  foreach ($orders as $o) {',
    '    $total = $o["amount"];',
    '    $count = $count + 1;',
    '  }',
    '  $endpoint = "http://reports.example.com/v1";',
    '  return [$total, $count, $endpoint];',
    '}',
    '',
  ].join('\n');
  const issues = ctx.analyzeCode(REAL, 'orders.php') || [];
  assert.ok(issues.some(i => /تراكم/.test(String(i.title))), 'لا بلاغَ تراكم');
  const r = ctx.repairCode(REAL, issues.map(x => Object.assign({}, x)), 'orders.php');

  // الإصلاحُ وقع فعلًا في النصّ، لا في التقرير وحدَه
  assert.match(r.repaired, /\$total \+= \$o\["amount"\]/, 'التراكمُ لم يُصلَح: ' +
    (((r.rejected || [])[0] || {}).reason || ''));
  // وبقيّةُ المشكلاتِ لم تختفِ من التقرير بلا إصلاح: إمّا أُصلحت وإمّا ما زالت مُبلَّغة
  const after = ctx.analyzeCode(r.repaired, 'orders.php') || [];
  const httpFixed = !/http:\/\//.test(r.repaired);
  const httpStillReported = after.some(i => /http/i.test(String(i.title)));
  assert.ok(httpFixed || httpStillReported, 'بلاغُ http اختفى بلا إصلاح');
  // والكودُ سليمٌ نحويًّا بعد التعديل
  const v = ctx.FixVerifier.syntaxCheck(r.repaired, 'orders.php');
  assert.notStrictEqual(v.ok, false, 'الناتجُ مكسور: ' + v.reason);
});

const SELF_ACC = [
  ['a.js',  'function f(xs) {\n  let count = 0;\n  for (const x of xs) {\n    count = count + 1;\n  }\n  return count;\n}\nmodule.exports = { f };\n'],
  ['a.py',  'def f(xs):\n    count = 0\n    for x in xs:\n        count = count + 1\n    return count\n'],
  ['a.php', '<?php\nfunction f($xs) {\n  $count = 0;\n  foreach ($xs as $x) {\n    $count = $count + 1;\n  }\n  return $count;\n}\n'],
];

test('[DG-8] ‎$x = $x + 1‎ في PHP تراكمٌ قائمٌ لا عطب', () => {
  // ‎[SELF-ACCUM]‎ في الكاشفِ الداخليِّ بـ‎analyzer.js‎ — وهو الكاشفُ الوحيدُ
  // الذي يرى PHP. ولولاه لكان فتحُ ‎foreach‎ قد أدخل بلاغًا خاطئًا جديدًا،
  // واقتراحُ إصلاحِه ‎$count += $count + 1‎ وهو يُضاعف.
  assert.strictEqual(find(SELF_ACC[2][1], SELF_ACC[2][0], /تراكم/).length, 0,
    'بلاغٌ خاطئ على تراكمٍ صحيحٍ في PHP');
  // والعطبُ الحقيقيُّ ما زال يُبلَّغ عنه في اللغاتِ الثلاث
  const REAL = [
    ['b.js',  'function f(xs) {\n  let total = 0;\n  for (const x of xs) {\n    total = x.price;\n  }\n  return total;\n}\nmodule.exports = { f };\n'],
    ['b.py',  'def f(xs):\n    total = 0\n    for x in xs:\n        total = x["price"]\n    return total\n'],
    ['b.php', '<?php\nfunction f($xs) {\n  $total = 0;\n  foreach ($xs as $x) {\n    $total = $x["price"];\n  }\n  return $total;\n}\n'],
  ];
  for (const [fn, code] of REAL) {
    assert.strictEqual(find(code, fn, /تراكم/).length, 1, fn + ': ضاع العطبُ الحقيقيّ');
  }
});

test('[DG-8ب] ولا بلاغَ خاطئًا في js و py — الكواشفُ الأربعةُ أُغلقت', () => {
  // كان هذا ‎todo‎: كاشفا ‎detectAccumulation‎ (AST) و‎analyzePython‎ يُبلّغان
  // عن ‎x = x + 1‎، واقتراحُ py هو ‎count += count + 1‎ وهو يُضاعف. وقد
  // أُغلقت المصادرُ الأربعةُ كلُّها في ‎[NO-DOUBLE]‎، فيُثبَّت الحالُ هنا.
  for (const [fn, code] of [SELF_ACC[0], SELF_ACC[1]]) {
    assert.strictEqual(find(code, fn, /تراكم/).length, 0, fn + ': بلاغٌ خاطئ على تراكمٍ صحيح');
  }
  // ولا من الكاشفِ الخامِ نفسِه، لا من الناتجِ المدموجِ وحدَه
  for (const [fn, code] of [SELF_ACC[0], SELF_ACC[1]]) {
    for (const n of ['detectAccumulation', 'analyzePython', 'analyzeAST']) {
      if (typeof ctx[n] !== 'function') continue;
      let out = [];
      try { out = ctx[n](code, fn) || []; } catch (e) { continue; }
      const hits = (Array.isArray(out) ? out : []).filter(i => /تراكم/.test(String(i.title || '')));
      assert.strictEqual(hits.length, 0, fn + ' ← ' + n + ': بلاغٌ خام');
    }
  }
});

test('[DG-8ج] والسلوكُ محفوظ: الدورةُ لا تغيّر نتيجةَ تراكمٍ صحيح', () => {
  const { execFileSync } = require('node:child_process');
  const runPy = src => {
    try {
      return execFileSync('python3', ['-I', '-c', src + '\nprint(f([1, 2, 3, 4, 5]))'],
        { encoding: 'utf8', timeout: 10000 }).trim();
    } catch (e) { return null; }
  };
  const py = SELF_ACC[1][1];
  const before = runPy(py);
  if (before === null) return;                       // لا python3 في البيئة
  assert.strictEqual(before, '5', 'tripwire: المثالُ لا يُنتج 5');
  const r = ctx.repairCode(py, ctx.analyzeCode(py, SELF_ACC[1][0]), SELF_ACC[1][0]);
  assert.strictEqual(runPy(r.repaired), before, 'تغيّرت نتيجةُ البرنامج:\n' + r.repaired);
  assert.strictEqual(r.repaired, py, 'مُسَّ كودٌ صحيح');
});

test('[DG-9] وإصلاحُ PHP يُبقي سِمةَ المتغيّر', () => {
  // ‎[PHP-SIGIL]‎: الصنفُ ‎[^\\w$.]‎ كان يمنع أن يسبق الاسمَ ‎$‎، وهو في PHP
  // سِمةُ المتغيّر. فكان المُصلِحُ يُرجع null لكلِّ تراكمٍ في PHP.
  const code = '<?php\nfunction f($xs) {\n  $total = 0;\n  foreach ($xs as $x) {\n    $total = $x["price"];\n  }\n  return $total;\n}\n';
  const issues = ctx.analyzeCode(code, 'sig.php') || [];
  const r = ctx.repairCode(code, issues.map(x => Object.assign({}, x)), 'sig.php');
  assert.match(r.repaired, /\$total \+= \$x\["price"\]/, 'لم يُصلَح أو ضاعت السِّمة');
  assert.doesNotMatch(r.repaired, /(^|[^$\w])total \+=/m, 'كُتب الاسمُ بلا $ — متغيّرٌ آخرُ في PHP');
  assert.notStrictEqual(ctx.FixVerifier.syntaxCheck(r.repaired, 'sig.php').ok, false, 'الناتجُ مكسور');
});

test('[DG-7] ووحدةُ Python واقعيّة: البلاغُ يصل والكودُ لا يُكسَر', () => {
  const REAL = [
    'import sqlite3',
    '',
    'def fetch_rows(conn, name):',
    '    cur = conn.cursor()',
    '    # query = "SELECT * FROM users"',
    '    return cur.execute(query)',
    '',
  ].join('\n');
  const issues = ctx.analyzeCode(REAL, 'rows.py') || [];
  assert.ok(issues.some(i => /NameError/.test(String(i.title))), 'لا بلاغَ NameError');
  const r = ctx.repairCode(REAL, issues.map(x => Object.assign({}, x)), 'rows.py');
  const v = ctx.FixVerifier.syntaxCheck(r.repaired, 'rows.py');
  assert.notStrictEqual(v.ok, false, 'الناتجُ مكسور: ' + v.reason);
  // وإن لم يُصلَح، يبقى مُبلَّغًا عنه — لا يختفي صامتًا
  const after = ctx.analyzeCode(r.repaired, 'rows.py') || [];
  const fixed = /^\s*query\s*=/m.test(r.repaired);
  assert.ok(fixed || after.some(i => /NameError/.test(String(i.title))),
    'البلاغُ اختفى بلا إصلاح');
});
