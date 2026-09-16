// ═══════════════════════════════════════════════════════
// اختبارات analyzer.js — الكشف والدليل والثقة (لا إصلاح)
// تشغيل:  node --test vercel-api/test/*.test.js   (من جذر المستودع)
// بلا تبعيات خارجية. يُحمَّل analyzer.js وحده حتى تكون النتائج نتيجة
// هذا الملف لا نتيجة محرك آخر؛ والمحركات الخارجية تُحقن كـstubs عند الحاجة.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'analyzer.js'), 'utf8');

function engine(extra) {
  const ctx = vm.createContext(Object.assign({ console: { warn() {}, log() {}, error() {} }, window: {}, global: {} }, extra || {}));
  vm.runInContext(SRC, ctx, { filename: 'analyzer.js' });
  return ctx;
}
// النتائج تُنشأ داخل سياق vm (realm مختلف) — تُنسخ قبل أي مقارنة عميقة
const list   = r => Array.from(r || []);
const titles = r => list(r).map(i => String(i.title));
const at     = (r, line) => list(r).filter(i => i.line === line);
const has    = (r, re) => list(r).some(i => re.test(String(i.title)));

// ═══ 1. مدخلات غير صالحة لا تُسقط التحليل ═════════════════
test('مدخلات غير صالحة: اسم ملف مفقود/خاطئ أو كود غير نصي ⇒ مصفوفة فارغة بلا انهيار', () => {
  const A = engine().analyzeCode;
  const cases = [
    ['اسم مفقود',        () => A('var x = 1;\n')],
    ['اسم undefined',    () => A('var x = 1;\n', undefined)],
    ['اسم null',         () => A('var x = 1;\n', null)],
    ['اسم رقم',          () => A('var x = 1;\n', 123)],
    ['كود null',         () => A(null, 'a.js')],
    ['كود undefined',    () => A(undefined, 'a.js')],
    ['كود كائن',         () => A({}, 'a.js')],
    ['كود فارغ',         () => A('', 'a.js')],
    ['فراغات فقط',       () => A('   \n\n\t\n', 'a.js')],
    ['امتداد مجهول',     () => A('var x = 1;\n', 'a.kt')],
    ['بلا امتداد',       () => A('var x = 1;\n', 'Dockerfile')],
  ];
  for (const [label, fn] of cases) {
    let out;
    assert.doesNotThrow(() => { out = fn(); }, label + ': انهار');
    assert.ok(Array.isArray(out), label + ': لم تُعد مصفوفة');
    assert.strictEqual(out.length, 0, label + ': أعاد ثغرات من مدخل غير صالح');
  }
});

// ═══ 2. اللغة من الامتداد لا من المحتوى ═══════════════════
test('توجيه اللغة: الامتداد وحده يقرر — محتوى JS في ملف py لا يُحلَّل كـJS والعكس', () => {
  const A = engine().analyzeCode;
  // محتوى JS صريح داخل ملف .py: قواعد Python وحدها تعمل، ولا قاعدة JS تُطبَّق.
  // (الدمج في SQL ثغرة في Python أيضاً، فالمتوقع بلاغ Python بعنوانه هو.)
  const jsInPy = 'var q = "SELECT * FROM t WHERE id = " + id;\nif (a == b) { run(); }\n';
  const pyOut  = titles(A(jsInPy, 'a.py'));
  assert.ok(!pyOut.some(t => /في JS|استخدام var|استخدم ===|TypeScript/.test(t)),
    'قواعد JS طُبِّقت على ملف Python: ' + pyOut.join(' | '));
  assert.ok(pyOut.every(t => !/JS/.test(t)), 'عنوان بصياغة JS في ملف Python: ' + pyOut.join(' | '));
  // محتوى Python صريح داخل ملف .js
  const pyInJs = 'os.system("ls " + d)\nAPI_KEY = "sk_live_abcdef123456"\n';
  assert.ok(!has(A(pyInJs, 'a.js'), /Command Injection Python|مكشوف في الكود/), 'قواعد Python طُبِّقت على ملف JS');
  // نفس الكود في امتداده الصحيح يُكتشف — ضابط يثبت أن الصمت أعلاه سببه التوجيه
  assert.ok(has(A(pyInJs, 'a.py'), /Command Injection Python/), 'الضابط: Python لم يُكتشف في ملفه');
  assert.ok(has(A(jsInPy, 'a.js'), /SQL Injection/), 'الضابط: JS لم يُكتشف في ملفه');
  // لغات بلا محلل محمّل: لا شيء
  for (const fn of ['A.kt', 'a.dart', 'a.go', 'a.rb', 'x.swift'])
    assert.deepStrictEqual(titles(A(jsInPy, fn)), [], fn + ': أُنتجت ثغرات بلا محلل');
});

// ═══ 3. de-dup: نفس الثغرة تُدمج، والثغرات المختلفة تبقى ══
test('de-dup: ثغرات مختلفة على السطر نفسه كلها تبقى، والبلاغ المكرر لنفس الثغرة يُدمج بأعلى ثقة', () => {
  const A = engine().analyzeCode;
  const out = A('var q = eval("SELECT * FROM users WHERE id = " + id);\n', 'a.js');
  assert.ok(has(out, /استخدام var/),     'ضاع بلاغ var');
  assert.ok(has(out, /SQL Injection/),   'ضاع بلاغ SQL injection');
  assert.ok(has(out, /eval\(\) خطير/),   'ضاع بلاغ eval');
  assert.strictEqual(at(out, 1).length, 3, 'عدد الثغرات على السطر 1: ' + titles(out).join(' | '));
  // محرك خارجي يبلّغ عن نفس الثغرة بعنوان آخر وثقة أعلى ⇒ بلاغ واحد بأعلى ثقة
  const dup = engine({ detectPatterns: () => ([
    { line: 1, sev: 'c', type: 'sec', title: 'SQL Injection detected (CWE-89)', cAct: 'CWE-89', conf: 99 },
  ]) }).analyzeCode('const s = "SELECT * FROM t WHERE id = " + id;\n', 'a.js');
  const sqlOnes = list(dup).filter(i => /SQL/i.test(String(i.title)));
  assert.strictEqual(sqlOnes.length, 1, 'لم يُدمج بلاغان لنفس الثغرة: ' + titles(dup).join(' | '));
  assert.strictEqual(sqlOnes[0].conf, 99, 'الدمج لم يُبقِ الأعلى ثقة');
});

test('de-dup: محرك واحد يعيد كشفين مختلفين على السطر نفسه ⇒ كلاهما يبقى', () => {
  const out = engine({ deepAnalyze: () => ([
    { line: 2, sev: 'c', type: 'js', title: 'كشف ألف', conf: 99 },
    { line: 2, sev: 'c', type: 'js', title: 'كشف باء مختلف تماماً', conf: 99 },
  ]) }).analyzeCode('const a = 1;\nconst b = 2;\n', 'a.js');
  assert.strictEqual(list(out).filter(i => /^كشف /.test(String(i.title))).length, 2,
    'المطابقة بالنوع أسقطت كشفاً صحيحاً: ' + titles(out).join(' | '));
});

// ═══ 4. الثقة: كل ثغرة مُنهاة، والتعليق ليس إصلاحاً ═══════
test('finalize: كل ثغرة مُعادة تحمل conf و cIcon و cAct و cEv — مهما تأخّر المحرك الذي أضافها', () => {
  const ctx = engine({ detectPatterns: () => ([{ line: 1, sev: 'h', type: 'x', title: 'محرك متأخر بلا ثقة' }]) });
  const samples = [
    ['a.js',  'var x = 1;\nconst q = "SELECT * FROM t WHERE a = " + a;\neval(userInput);\n'],
    ['a.py',  'import os\nAPI_KEY = "sk_live_abcdef123456"\nos.system("ls " + d)\n'],
    ['a.ts',  'const v: any = getThing();\n'],
  ];
  for (const [fn, code] of samples) {
    const out = ctx.analyzeCode(code, fn);
    assert.ok(out.length > 0, fn + ': لا ثغرات لفحصها');
    for (const i of list(out)) {
      const label = fn + ' @' + i.line + ' ' + String(i.title).slice(0, 30);
      assert.strictEqual(typeof i.conf, 'number', label + ': conf مفقود');
      assert.ok(i.conf > 0 && i.conf <= 100, label + ': conf خارج المدى: ' + i.conf);
      assert.ok(i.cIcon, label + ': cIcon مفقود');
      assert.ok(i.cAct,  label + ': cAct مفقود');
      assert.ok(Array.isArray(i.cEv) && i.cEv.length > 0, label + ': cEv مفقود');
    }
  }
});

test('الثقة: التعليق لا يأخذ نقاط إصلاح، وisBalanced لا يعدّ الأقواس داخل السلاسل', () => {
  const ctx = engine();
  const comment = ctx.calcConf({ type: 'js', title: 'x', fix: '// SECURITY: eval() removed — validate input', ev: '' }, 'eval(x)');
  const real    = ctx.calcConf({ type: 'js', title: 'x', fix: 'const y = safeParse(input);',                 ev: '' }, 'eval(x)');
  assert.ok(!comment.ev.some(e => /أقواس متوازنة|إصلاح مباشر/.test(e)), 'تعليق أخذ نقاط إصلاح: ' + JSON.stringify(comment.ev));
  assert.ok(real.ev.some(e => /أقواس متوازنة/.test(e)), 'إصلاح حقيقي متوازن لم يأخذ النقاط');
  assert.ok(real.score > comment.score, 'التعليق لا يجوز أن يساوي إصلاحاً حقيقياً');
  assert.strictEqual(ctx.isBalanced('const s = "(";'), true,  'قوس داخل سلسلة عُدّ');
  assert.strictEqual(ctx.isBalanced('x = ")"'),        true,  'قوس داخل سلسلة عُدّ');
  assert.strictEqual(ctx.isBalanced('foo(bar'),        false, 'قوس ناقص حقيقي لم يُكتشف');
});

// ═══ 5. لا إصلاحات خطرة من المحلل ════════════════════════
test('المحلل لا يُصدر إصلاحاً خطراً: eval/XSS/SQL/os.system/MD5/any/db.query ⇒ fix=null و AI_REQUIRED', () => {
  const A = engine().analyzeCode;
  const risky = [
    ['a.js', 'const data = eval(responseText);\n',                        /eval\(\) خطير/],
    ['a.js', 'const d2 = eval(userInput);\n',                             /eval\(\) خطير/],
    ['a.js', 'res.send("Hello " + req.query.name);\n',                    /XSS في res\.send/],
    ['a.js', 'db.query("SELECT * FROM t WHERE id = " + id, cb);\n',       /SQL Injection/],
    ['a.js', 'db.query("SELECT * FROM t WHERE id = ?", function (e) {});\n', /بدون params array/],
    ['a.py', 'q = "SELECT * FROM t WHERE id = " + uid\n',                 /SQL Injection/],
    ['a.py', 'os.system("ping " + host)\n',                               /Command Injection Python/],
    ['a.py', 'import hashlib\nh = hashlib.md5(blob).hexdigest()\n',       /MD5\/SHA1/],
    ['a.ts', 'function f(x: any): any { return x.y; }\n',                 /TypeScript any/],
  ];
  for (const [fn, code, re] of risky) {
    const found = list(A(code, fn)).filter(i => re.test(String(i.title)));
    assert.strictEqual(found.length, 1, fn + ' ' + re + ': عدد البلاغات ' + found.length);
    const i = found[0];
    assert.strictEqual(i.fix, null, fn + ' ' + re + ': ما زال يُصدر إصلاحاً: ' + JSON.stringify(i.fix));
    assert.strictEqual(i.aiRequired, true, fn + ' ' + re + ': لم يُعلَّم AI_REQUIRED');
    assert.ok(typeof i.fixHint === 'string' && i.fixHint.length > 10, fn + ' ' + re + ': بلا سبب مكتوب');
  }
});

test('أي إصلاح يبقى يجب أن يكون تحويلاً حقيقياً: ليس تعليقاً ولا نسخة من السطر المصاب', () => {
  const A = engine().analyzeCode;
  const files = {
    'a.js': 'const JWT_KEY = "abcdef123";\nvar x = 1;\nif (a == b) { go(); }\n',
    'a.py': 'import os\nAPI_KEY = "sk_live_abcdef123456"\nif a == None:\n    pass\ntotal = 0\nfor r in rows:\n    total = r["amount"]\n',
  };
  for (const [fn, code] of Object.entries(files)) {
    for (const i of list(A(code, fn))) {
      if (i.fix === null || i.fix === undefined) continue;
      const label = fn + ' @' + i.line + ' ' + String(i.title).slice(0, 26);
      assert.strictEqual(typeof i.fix, 'string', label + ': نوع fix غير نصي');
      assert.ok(!/^\s*(\/\/|#|\/\*)/.test(i.fix), label + ': الإصلاح تعليق: ' + i.fix);
      assert.notStrictEqual(i.fix.trim(), String(i.ev || '').trim(), label + ': الإصلاح نسخة من السطر المصاب');
    }
  }
});

test('JWT: اسم متغير البيئة يُشتق من المتغير الحقيقي لا يُثبَّت على JWT_SECRET', () => {
  const A = engine().analyzeCode;
  const key = list(A('const JWT_KEY = "abcdef123";\n', 'a.js')).find(i => /JWT Secret/.test(String(i.title)));
  assert.strictEqual(key.fix, 'const JWT_KEY = process.env.JWT_KEY;');
  const camel = list(A('const jwtSecret = "abcdef123";\n', 'a.js')).find(i => /JWT Secret/.test(String(i.title)));
  assert.strictEqual(camel.fix, 'const jwtSecret = process.env.JWT_SECRET;');
});

// ═══ 6. سلاسل وتعليقات ليست كوداً ════════════════════════
test('سلاسل/تعليقات: نمط مشبوه داخل template literal أو تعليق لا يُبلَّغ عنه', () => {
  const A = engine().analyzeCode;
  const code = [
    '// if (a == b) ملاحظة قديمة',                         // 1
    'const doc = `',                                        // 2
    'var leaked = 1;',                                      // 3  داخل template
    'const q = "SELECT * FROM t WHERE id = " + id;',        // 4  داخل template
    '`;',                                                   // 5
    'runThing(); // if (x == y)',                           // 6  تعليق في نهاية السطر
    '/*',                                                   // 7
    'var alsoLeaked = 2;',                                  // 8  داخل block comment
    '*/',                                                   // 9
    'var real = 3;',                                        // 10 كود حقيقي — ضابط
  ].join('\n') + '\n';
  const out = A(code, 'a.js');
  for (const bad of [3, 4, 6, 8])
    assert.strictEqual(at(out, bad).length, 0, 'بلاغ من سطر غير برمجي ' + bad + ': ' + titles(at(out, bad)).join(' | '));
  assert.ok(at(out, 10).some(i => /استخدام var/.test(String(i.title))), 'الضابط: السطر البرمجي الحقيقي لم يُكتشف');
});

// ═══ 7. HTML: أرقام أسطر حقيقية ══════════════════════════
test('HTML: الثغرة داخل <script> تُبلَّغ برقم سطرها في الملف الأصلي', () => {
  const A = engine().analyzeCode;
  const html = ['<html>', '<head>', '<title>x</title>', '</head>', '<body>', '<div>hi</div>',
                '<script>', 'var total = 0;', 'if (a == b) { doThing(); }', '</script>', '</body>', '</html>'].join('\n') + '\n';
  const out = A(html, 'p.html');
  assert.ok(at(out, 9).some(i => /===/.test(String(i.title))), 'السطر 9 لم يُبلَّغ: ' + list(out).map(i => i.line + ':' + i.title).join(' | '));
  assert.strictEqual(list(out).filter(i => i.line < 7).length, 0, 'بلاغ في منطقة HTML خارج <script>');
  // نص HTML يشبه كوداً خارج <script> لا يُحلَّل
  const decoy = '<p>if (a == b) var x = 1;</p>\n<script>\nconst ok = 1;\n</script>\n';
  assert.deepStrictEqual(titles(A(decoy, 'p.html')), [], 'نص HTML عادي عُومل ككود');
});

// ═══ 8. Callback Hell: التداخل الحقيقي فقط ═══════════════
test('Callback Hell: دوال متتالية غير متداخلة لا تُبلَّغ، والتداخل الحقيقي يُبلَّغ', () => {
  const A = engine().analyzeCode;
  const flat = 'const a = () => {\n  x();\n};\nconst b = () => {\n  y();\n};\nconst c = () => {\n  z();\n};\n';
  assert.ok(!has(A(flat, 'a.js'), /Callback Hell/), 'إيجابية كاذبة على دوال متتالية');
  const flat2 = 'arr.map(function (x) {\n  return x;\n});\narr.filter(function (y) {\n  return y;\n});\narr.some(function (z) {\n  return z;\n});\n';
  assert.ok(!has(A(flat2, 'a.js'), /Callback Hell/), 'إيجابية كاذبة على callbacks متتالية');
  const nested = 'read(a, function (e1, d1) {\n  read(b, function (e2, d2) {\n    read(c, function (e3, d3) {\n      done(d3);\n    });\n  });\n});\n';
  const hell = list(A(nested, 'a.js')).find(i => /Callback Hell/.test(String(i.title)));
  assert.ok(hell, 'تداخل حقيقي بثلاثة مستويات لم يُكتشف');
  assert.strictEqual(hell.line, 1, 'سطر البداية خاطئ');
});

// ═══ 9. التراكم: داخل الحلقة فقط ═════════════════════════
test('التراكم: يُبلَّغ داخل الحلقة فقط، مرة واحدة لكل سطر، ويغطي متغيرات لا يغطيها محلل اللغة', () => {
  const A = engine().analyzeCode;
  const py = 'total = 0\nfor x in items:\n    total = x["price"]\nprint("done")\ntotal = compute()\n';
  const outPy = A(py, 'a.py');
  assert.strictEqual(at(outPy, 3).filter(i => /تراكم/.test(String(i.title))).length, 1,
    'السطر 3 (داخل الحلقة): عدد بلاغات التراكم ' + at(outPy, 3).length);
  assert.strictEqual(at(outPy, 5).filter(i => /تراكم/.test(String(i.title))).length, 0,
    'السطر 5 خارج الحلقة ومع ذلك بُلِّغ عنه');
  // متغير خارج قائمة محلل Python — يثبت أن الكاشف المكرر ما زال يضيف تغطية
  const py2 = 'balance = 0\nfor r in rows:\n    balance = r["amount"]\n';
  assert.ok(has(A(py2, 'a.py'), /تراكم/), 'balance داخل حلقة لم يُكتشف');
  const js = 'let inventory = 0;\nitems.forEach(function (x) {\n  inventory = x.qty;\n});\ninventory = reset();\n';
  const outJs = A(js, 'a.js');
  assert.ok(at(outJs, 3).some(i => /تراكم/.test(String(i.title))), 'inventory داخل forEach لم يُكتشف');
  assert.strictEqual(at(outJs, 5).filter(i => /تراكم/.test(String(i.title))).length, 0, 'سطر خارج الحلقة بُلِّغ عنه');
});

// ═══ 10. عزل أعطال المحركات الخارجية ═════════════════════
test('عزل المحركات: محرك ينهار أو يعيد شكلاً غير متوقع لا يُسقط تحليل الملف', () => {
  const boom = () => { throw new Error('engine exploded'); };
  const A = engine({
    scanCrypto: boom, detectSecrets: boom, scanSecurity: boom, detectPatterns: boom,
    deepAnalyze: boom, analyzeTaintJS: boom, analyzeJSWithAST: boom,
    SmartContext: { analyze: boom }, SemanticLayer: { analyze: boom },
    ExtendedPatterns: { analyze: boom }, CVEPatterns: { analyze: boom }, KnowledgeBase: { analyze: boom },
  }).analyzeCode;
  let out;
  assert.doesNotThrow(() => { out = A('var x = 1;\neval(userInput);\n', 'a.js'); }, 'محرك منهار أسقط التحليل');
  assert.ok(has(out, /استخدام var/) && has(out, /eval\(\) خطير/), 'ضاعت كشوف المحلل نفسه بسبب محرك خارجي');
  // شكل غير متوقع: مصفوفة بدل { issues } والعكس
  const shapes = engine({
    analyzeTypeScript: () => ([{ line: 1, sev: 'm', type: 'ts', title: 'من مصفوفة', conf: 70 }]),
    detectPatterns:    () => ({ issues: [{ line: 1, sev: 'm', type: 'x', title: 'من كائن', conf: 70 }] }),
  }).analyzeCode;
  let out2;
  assert.doesNotThrow(() => { out2 = shapes('const v: any = 1;\n', 'a.ts'); }, 'شكل إرجاع مختلف أسقط التحليل');
  assert.ok(has(out2, /من مصفوفة/) && has(out2, /من كائن/), 'الشكلان لم يُقبلا: ' + titles(out2).join(' | '));
});

// ═══ 11. التوجيه إلى المحللات المتخصصة ═══════════════════
test('التوجيه: كل امتداد يستدعي محلله هو فقط، وJava تعود مصفوفة مُنهاة', () => {
  const calls = [];
  const mk = name => (code, fn) => { calls.push(name); return [{ line: 1, sev: 'h', type: name, title: 'من ' + name }]; };
  const base = () => ({
    analyzeTypeScript: mk('ts'), analyzeKotlin: mk('kt'), analyzePHP: mk('php'),
    analyzeCCpp: mk('c'), analyzeDart: mk('dart'), analyzeCSharp: mk('cs'),
  });
  const expect = { 'a.ts': 'ts', 'A.kt': 'kt', 'a.php': 'php', 'a.c': 'c', 'a.cpp': 'c', 'a.hpp': 'c', 'a.dart': 'dart', 'A.cs': 'cs' };
  for (const [fn, want] of Object.entries(expect)) {
    calls.length = 0;
    const out = engine(base()).analyzeCode('x = 1\n', fn);
    assert.deepStrictEqual(calls, [want], fn + ': المحللات المستدعاة ' + JSON.stringify(calls));
    assert.ok(has(out, new RegExp('من ' + want)), fn + ': نتيجة المحلل لم تصل');
  }
  // Java: المسار المبكر يجب أن يعيد مصفوفة حتى لو أعاد المحرك كائناً
  const javaObj = engine({ analyzeJava: () => ({ issues: [{ line: 2, sev: 'c', type: 'java', title: 'ثغرة جافا' }] }) })
    .analyzeCode('public class A {}\n', 'A.java');
  assert.ok(Array.isArray(javaObj), 'مسار Java لم يُعد مصفوفة');
  assert.ok(has(javaObj, /ثغرة جافا/), 'ثغرة Java ضاعت');
  assert.ok(Array.isArray(list(javaObj)[0].cEv), 'ثغرة Java بلا cEv — لم تمر على finalize');
  // محرك Java منهار: لا يُسقط التحليل
  assert.doesNotThrow(() => engine({ analyzeJava: () => { throw new Error('boom'); } }).analyzeCode('class A {}\n', 'A.java'));
});

// ═══ 12. إيجابيات كاذبة أُصلحت في Python ═════════════════
test('Python: query كوسيط دالة ليس NameError، والمقارنة بـNone تُصلَح في كل المواضع', () => {
  const A = engine().analyzeCode;
  const param = 'import sqlite3\ndef run(cursor, query):\n    cursor.execute(query, (1,))\n';
  assert.ok(!has(A(param, 'a.py'), /NameError/), 'وسيط دالة اعتُبر متغيراً غير معرّف');
  const forLoop = 'for query in queries:\n    cursor.execute(query, (1,))\n';
  assert.ok(!has(A(forLoop, 'a.py'), /NameError/), 'متغير حلقة اعتُبر غير معرّف');
  // ضابط: غير معرّف فعلاً ⇒ يُبلَّغ
  const real = '# query = "SELECT 1"\ncursor.execute(query, (1,))\n';
  assert.ok(has(A(real, 'a.py'), /NameError/), 'الضابط: NameError الحقيقي لم يُكتشف');
  const none = list(A('if a == None and b == None:\n    pass\n', 'a.py')).find(i => /is None/.test(String(i.title)));
  assert.strictEqual(none.fix, 'if a is None and b is None:', 'لم تُستبدل كل المواضع');
});

// ═══ 13. اقتراحات الـstub ════════════════════════════════
test('stubs: الاقتراح يبقى اقتراحاً مُعلَّماً، و"discount" لا تُقرأ كـ"count"', () => {
  const A = engine().analyzeCode;
  const code = 'data = [{"id": 1, "username": "a", "price": 10, "status": "active"}]\n\n' +
               'def calculate_discount(item, rate):\n    pass\n\n' +
               'def get_total(data):\n    pass\n';
  const out = list(A(code, 'a.py')).filter(i => i.type === 'stub' && i.fix);
  assert.ok(out.length >= 2, 'اقتراحات الـstub لم تُنتج: ' + out.length);
  for (const i of out) {
    assert.strictEqual(i.suggestion, true, 'اقتراح بلا علامة suggestion');
    assert.strictEqual(i.aiRequired, true, 'اقتراح بلا AI_REQUIRED');
    assert.ok(i.conf <= 80, 'ثقة اقتراح مرتفعة: ' + i.conf);
  }
  const discount = out.find(i => i.line === 4);
  assert.ok(/1 - rate|price/.test(String(discount.fix)), 'discount أُعطي منطق count: ' + discount.fix);
  assert.ok(!/len\(/.test(String(discount.fix)), 'discount أُعطي len(): ' + discount.fix);
});

// ═══ 14. أسطر متعددة وحالات طرفية ════════════════════════
test('حالات متعددة الأسطر: دوال/سلاسل/تعليقات ممتدة لا تكسر الترقيم ولا تُنتج بلاغات وهمية', () => {
  const A = engine().analyzeCode;
  const code = [
    'function outer(a,',          // 1
    '                b) {',       // 2
    '  const tpl = `line one',    // 3
    '  if (a == b) fake();',      // 4  داخل السلسلة
    '  `;',                       // 5
    '  /* تعليق',                 // 6
    '     if (c == d) fake2();',  // 7  داخل التعليق
    '  */',                       // 8
    '  if (a == b) { real(); }',  // 9  حقيقي
    '}',                          // 10
  ].join('\n') + '\n';
  const out = A(code, 'a.js');
  const eq = list(out).filter(i => /===/.test(String(i.title)));
  assert.strictEqual(eq.length, 1, 'عدد بلاغات == : ' + eq.map(i => i.line).join(','));
  assert.strictEqual(eq[0].line, 9, 'رقم السطر خاطئ: ' + eq[0].line);
  assert.strictEqual(eq[0].fix, 'if (a === b) { real(); }');
  // ملف بسطر واحد بلا سطر جديد، وملف ضخم — بلا انهيار
  assert.doesNotThrow(() => A('var x = 1;', 'a.js'));
  assert.doesNotThrow(() => A(Array.from({ length: 3000 }, (_, i) => 'const v' + i + ' = ' + i + ';').join('\n'), 'big.js'));
  // سلسلة غير مغلقة لا تُدخل المحلل في حلقة
  assert.doesNotThrow(() => A('const s = "unterminated\nvar y = 2;\n', 'a.js'));
});
