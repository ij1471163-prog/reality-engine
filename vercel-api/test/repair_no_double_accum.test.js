// ═══════════════════════════════════════════════════════
// إصلاحٌ يُضاعف القيمةَ ليس إصلاحًا — ولا يُعرَض ولا يُقبَل
// تشغيل:  node --test vercel-api/test/repair_no_double_accum.test.js
//
// ‎x = x + 1‎ تراكمٌ مكتوبٌ مطوَّلًا، لا عطبُ ‎=‎ مكانَ ‎+=‎. وكان يُبلَّغ عنه،
// والاقتراحُ المرفقُ ‎x += x + 1‎ — وهو يُضاعف. والمقيسُ بتنفيذِ CPython:
//     def f(xs):  count = 0; for x in xs: count = count + 1; return count
//     f([1,2,3,4,5]) = 5   ⇒   بعد الاقتراح = 31
// والبوابةُ **قبلته**: ‎ACCEPTED (أزال 1 مشكلة، بلا تدهور)‎، لأن عدَّ
// البلاغاتِ نقص ولا مِعيارَ سلوكيًّا لديها.
//
// وأربعةُ مواضعَ تُنتج هذا البلاغَ لا موضعٌ واحد، ولكلٍّ ثمنُه:
//   ‎analyzer.js‎ (قاعدةُ py)       اقتراحٌ صحيحُ النحوِ يُضاعف ⇒ تقبله البوابة
//   ‎analyzer.js‎ (قاعدةُ js)       المثل
//   ‎analyzer.js‎ (الكتلةُ الداخليّة) تغطّي php — عولجت في ‎[SELF-ACCUM]‎
//   ‎accumulation_detector.js‎      ‎conf: 90‎ ⇒ زرُّ «تطبيق آمن»
//   ‎ast-engine.js‎                 ‎conf: 95‎ ومعه ‎fix: 'x += ...'‎ — نصٌّ
//                                   نائبٌ لا رُقعة، ولو كُتب لكسر الملفّ
//
// و‎[NO-DOUBLE]‎ يمنع البلاغَ حيث الطرفُ الأيمنُ يذكر المتغيّرَ نفسَه، في
// المواضعِ الأربعة. و‎[NO-PLACEHOLDER]‎ يُسقط الرُقعةَ النائبةَ من بلاغِ
// الشجرة: الكشفُ يبقى، والإصلاحُ مكانُه مسارُ الإصلاح عبر ‎fixAccumulation‎.
// ولم تُمَسّ البوابة.
// ═══════════════════════════════════════════════════════
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
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
const accFindings = (code, fn) =>
  (ctx.analyzeCode(code, fn) || []).filter(i => /تراكم/.test(String(i.title || '')));

// ‎x = x + 1‎ وأخواتُها: تراكمٌ قائمٌ، لا عطب.
const SELF = [
  ['a.js',  'function f(xs) {\n  let count = 0;\n  for (const x of xs) {\n    count = count + 1;\n  }\n  return count;\n}\nmodule.exports = { f };\n'],
  ['b.js',  'function f(xs) {\n  let total = 0;\n  for (const x of xs) {\n    total = total + x.price;\n  }\n  return total;\n}\nmodule.exports = { f };\n'],
  ['a.py',  'def f(xs):\n    count = 0\n    for x in xs:\n        count = count + 1\n    return count\n'],
  ['a.php', '<?php\nfunction f($xs) {\n  $count = 0;\n  foreach ($xs as $x) {\n    $count = $count + 1;\n  }\n  return $count;\n}\n'],
];
// العطبُ الحقيقيّ: الطرفُ الأيمنُ شيءٌ آخرُ فالقيمةُ السابقةُ تضيع.
const REAL = [
  ['c.js',  'function f(ps) {\n  let total = 0;\n  for (const p of ps) {\n    total = p.score;\n  }\n  return total;\n}\nmodule.exports = { f };\n', /total \+= p\.score/],
  ['c.py',  'def f(rows):\n    total = 0\n    for r in rows:\n        total = r["amount"]\n    return total\n', /total \+= r\["amount"\]/],
  ['c.php', '<?php\nfunction f($rows) {\n  $total = 0;\n  foreach ($rows as $r) {\n    $total = $r["x"];\n  }\n  return $total;\n}\n', /\$total \+= \$r\["x"\]/],
];

test('[ND-1] لا بلاغَ على تراكمٍ قائمٍ في أيٍّ من اللغاتِ الثلاث', () => {
  for (const [fn, code] of SELF) {
    assert.strictEqual(accFindings(code, fn).length, 0,
      fn + ': بلاغٌ خاطئ — ' + JSON.stringify(accFindings(code, fn).map(i => i.title)));
  }
});

test('[ND-2] ولا رُقعةَ معروضةٌ تُضاعف، من أيِّ كاشف', () => {
  // المصدرُ الخامُ أيضًا، لا الناتجُ المدموجُ وحدَه.
  for (const [fn, code] of SELF) {
    const raw = [];
    for (const n of ['detectAccumulation', 'analyzeAST']) {
      if (typeof ctx[n] !== 'function') continue;
      let o = []; try { o = ctx[n](code, fn) || []; } catch (e) { /* لغةٌ غيرُ مدعومة */ }
      for (const i of (Array.isArray(o) ? o : [])) raw.push(i);
    }
    for (const i of raw.concat(accFindings(code, fn))) {
      const patch = String(i.fix || '');
      assert.doesNotMatch(patch, /(\w+)\s*\+=\s*\$?\1\b/,
        fn + ': رُقعةٌ تُضاعف — ' + JSON.stringify(patch));
    }
  }
});

test('[ND-3] ولا رُقعةَ نائبةٌ خلفَ زرِّ التطبيق', () => {
  // الواجهةُ ترسم زرًّا متى كان ‎iss.fix‎ موجودًا و‎conf >= 60‎. فرُقعةٌ فيها
  // ‎...‎ تعني زرًّا يكتب نصًّا مكسورًا.
  for (const [fn, code] of REAL.map(r => [r[0], r[1]]).concat(SELF)) {
    for (const i of (ctx.analyzeCode(code, fn) || [])) {
      if (!i.fix || (i.conf || 0) < 60) continue;
      assert.doesNotMatch(String(i.fix), /\.\.\./,
        fn + ' L' + i.line + ': رُقعةٌ نائبةٌ معروضةٌ للتطبيق — ' + JSON.stringify(i.fix));
    }
  }
});

test('[ND-4] والعطبُ الحقيقيُّ ما زال يُكتشَف ويُصلَح', () => {
  for (const [fn, code, want] of REAL) {
    assert.strictEqual(accFindings(code, fn).length, 1, fn + ': ضاع البلاغُ الحقيقيّ');
    const issues = ctx.analyzeCode(code, fn) || [];
    const r = ctx.repairCode(code, issues.map(x => Object.assign({}, x)), fn);
    assert.match(r.repaired, want, fn + ': لم يُصلَح — ' +
      (((r.rejected || [])[0] || {}).reason || ''));
  }
});

// ═══ المعنى نفسُه: تنفيذٌ حقيقيٌّ قبل وبعد ═══

const runPy = src => {
  try {
    return execFileSync('python3', ['-I', '-c', src + '\nprint(f([1, 2, 3, 4, 5]))'],
      { encoding: 'utf8', timeout: 10000 }).trim();
  } catch (e) { return null; }
};
const runJs = src => {
  try {
    return execFileSync(process.execPath, ['-e',
      'const m = {exports:{}};(function(module,exports){' + src + '})(m, m.exports);' +
      'console.log(m.exports.f([{price:1},{price:2},{price:3}]));'],
      { encoding: 'utf8', timeout: 10000 }).trim();
  } catch (e) { return null; }
};

test('[ND-5] بايثون: الدورةُ لا تغيّر نتيجةَ البرنامج', { skip: runPy('def f(xs):\n    return len(xs)\n') === null ? 'لا python3' : false }, () => {
  const src = 'def f(xs):\n    count = 0\n    for x in xs:\n        count = count + 1\n    return count\n';
  const before = runPy(src);
  assert.strictEqual(before, '5', 'tripwire: المثالُ لا يُنتج 5');
  const issues = ctx.analyzeCode(src, 'n.py') || [];
  const out = ctx.repairCode(src, issues.map(x => Object.assign({}, x)), 'n.py').repaired;
  assert.strictEqual(runPy(out), before, 'تغيّرت نتيجةُ البرنامج:\n' + out);
});

test('[ND-6] وجافاسكربت: الإصلاحُ الحقيقيُّ يُصحّح النتيجةَ ولا يُضاعفها', { skip: runJs('module.exports.f = xs => xs.length;') === null ? 'تعذّر التنفيذ' : false }, () => {
  // قبل: ‎total = p.price‎ يُبقي الأخيرَ (3). وبعد الإصلاحِ الصحيح: 6.
  const src = 'function f(ps) {\n  let total = 0;\n  for (const p of ps) {\n    total = p.price;\n  }\n  return total;\n}\nmodule.exports = { f };\n';
  assert.strictEqual(runJs(src), '3', 'tripwire: المثالُ لا يُنتج 3');
  const issues = ctx.analyzeCode(src, 'n.js') || [];
  const out = ctx.repairCode(src, issues.map(x => Object.assign({}, x)), 'n.js').repaired;
  assert.strictEqual(runJs(out), '6', 'الناتجُ لا يجمع كما يجب:\n' + out);

  // وتراكمٌ قائمٌ لا يُمَسّ، فالنتيجةُ كما هي.
  const ok = 'function f(ps) {\n  let total = 0;\n  for (const p of ps) {\n    total = total + p.price;\n  }\n  return total;\n}\nmodule.exports = { f };\n';
  const okIssues = ctx.analyzeCode(ok, 'o.js') || [];
  const okOut = ctx.repairCode(ok, okIssues.map(x => Object.assign({}, x)), 'o.js').repaired;
  assert.strictEqual(runJs(okOut), runJs(ok), 'تغيّرت نتيجةُ تراكمٍ صحيح:\n' + okOut);
});

test('[ND-7] والبوابةُ ترفض رُقعةَ التضاعفِ لو جاءت من أيِّ مصدر', {
  todo: 'حدٌّ مقيسٌ لم يُعالَج في هذه الدفعة: البوابةُ تقبل ' +
        '‎count = count + 1 ⇒ count += count + 1‎ لأن عدَّ البلاغاتِ ينقص ' +
        'ولا مِعيارَ سلوكيًّا لديها. والمصادرُ الأربعةُ التي كانت تُنتج هذه ' +
        'الرُقعةَ عولجت، فلم يبقَ لها منفذٌ من داخلِ المحرّك — لكنّ البوابةَ ' +
        'نفسَها ما زالت تقبلها لو وردت من خارجِه. سببٌ مستقلٌّ بملفٍّ آخر ' +
        '(fix_verifier.js) ولا يُخلَط بهذه الدفعة.',
}, () => {
  const before = 'def f(xs):\n    count = 0\n    for x in xs:\n        count = count + 1\n    return count\n';
  const after = before.replace('count = count + 1', 'count += count + 1');
  const v = ctx.FixVerifier.verifyFix(before, after, 'g.py', ctx.analyzeCode);
  assert.strictEqual(v.accepted, false, 'قُبلت رُقعةٌ تُضاعف: ' + v.reason);
});
