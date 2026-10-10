// ═══════════════════════════════════════════════════════
// smart_repair.js — فرع Python في fixSQL: fail-closed بدل patch خطير
// تشغيل:  node --test vercel-api/test/repair_py_sql_fail_closed.test.js
//
// D1 (b111e3a) قسّى فرع JS/TS من fixSQL: يبني الاستعلام كاملاً من التعبير،
// ويربط المعاملات في موضع الاستدعاء الفعلي، ويرفض fail-closed بلا موضع ربط.
// فرع Python في نفس الدالة لم يُمَسّ، وبقي يبني patch بالقَولَبة لا بالإثبات:
//
//   (أ) بتر الاستعلام — queryM يلتقط أول نص حرفي فقط، فيُفقد كل ما بعد أول +
//       ("… AND active = " مثلاً)، ثم يُضاف placeholder واحد بلا نظر لعدد
//       المعاملات ⇒ "id =?" مقابل (uid, flag,): placeholder واحد ومعاملان.
//
//   (ب) زرع return لم يكن في المصدر — يُحشَر cursor/execute/return
//       cursor.fetchall() بلا إثبات أن الدالة كانت تُرجع صفوف الاستعلام أصلاً،
//       ولا أن conn موجود. فـreturn other_api(q) يصير كودًا ميتًا وقيمة
//       الدالة تتغير بالكامل.
//
//   (ج) حلقة حذف الاستدعاء القديم معلّقة على شكل خاطئ — تطابق
//       conn.execute أو "return cursor"، والشكل الشائع cursor.execute(q)
//       لا يطابق أيًّا منهما، فتتوقف الحلقة فورًا ويبقى الاستدعاء الأصلي
//       مكرَّرًا ميتًا بعد الـreturn المزروع.
//
// المقيس قبل الإصلاح: الحالات الثلاث تُنتج patch، والبوابة تقبل اثنتين منها
// (ACCEPTED: أزال 1 مشكلة، بلا تدهور). الثالثة تُرفض بالصدفة لأن كاشفًا آخر
// يلتقط عدم تطابق المعاملات.
//
// العقد الذي يثبّته هذا الملف: إصلاح لا نستطيع إثباته لا يُنتَج إطلاقًا.
// البلاغ يبقى قائمًا فيذهب لمسار AI، وهذا أفضل من SAFE_AUTO_FIX خاطئ.
//
// وبعد الإصلاح ظهر أن emergency_fixes.js يحمل نفس عطل القَولَبة لبايثون،
// وهو ملف آخر خارج نطاق هذه الجولة — مسجَّل todo في القسم 3ج بدليله.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// نفس المحركات التي تحمّلها الواجهة — analyzeCode وSmartRepairEngine حقيقيان
function loadUiContext() {
  const noop = () => {};
  const store = new Map();
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop, createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); } },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة فقط */ }
  }
  ctx.toast = noop;
  ctx.refreshStats = noop;
  return ctx;
}

const ctx = loadUiContext();
const repair = (code, file) =>
  ctx.SmartRepairEngine.repair(code, file, ctx.analyzeCode(code, file));

// ─── أدوات فحص العقد ─────────────────────────────────────

// عدد ? داخل النصوص الحرفية في السطر
const placeholdersIn = line => (line.match(/\?/g) || []).length;

// عدد المعاملات المربوطة في execute(var, (a, b,)) أو execute(var, [a, b])
function boundCountIn(line) {
  const m = line.match(/\.execute\s*\([^,]+,\s*[([]([^)\]]*)[)\]]/);
  if (!m) return null;
  return m[1].split(',').map(s => s.trim()).filter(Boolean).length;
}

// أسطر صارت غير قابلة للوصول: سطر يلي return على نفس الإزاحة داخل نفس الكتلة
function unreachableLines(code) {
  const out = [];
  const lines = code.split('\n');
  let returnedAt = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const ind = line.search(/\S/);
    if (returnedAt !== null) {
      if (ind < returnedAt) returnedAt = null;       // خرجنا من الكتلة
      else { out.push(line.trim()); continue; }
    }
    if (/^\s*return\b/.test(line)) returnedAt = ind;
  }
  return out;
}

// كلمات SQL الموجودة في النصوص الحرفية — لإثبات أن الاستعلام لم يُبتر
const sqlClauses = code =>
  (code.match(/\b(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|AND|OR|ORDER BY|LIMIT)\b/gi) || [])
    .map(s => s.toUpperCase());

// ─── الحالات الثلاث المقيسة ──────────────────────────────

const CASES = {
  // (أ) معاملان ⇒ بتر " AND active = " وplaceholder واحد مقابل اثنين
  'A: 2 params, cursor موجود': ['app.py',
    'def get_user(uid):\n' +
    '    q = "SELECT * FROM users WHERE id = " + uid + " AND active = " + flag\n' +
    '    cursor = conn.cursor()\n' +
    '    cursor.execute(q)\n' +
    '    rows = cursor.fetchall()\n' +
    '    log(rows)\n' +
    '    return rows\n'],

  // (ب) لا cursor تحت ⇒ return مزروع يغيّر قيمة الدالة ويقتل return الأصلي
  'B: param واحد، بلا cursor تحت': ['app.py',
    'def get_user(uid):\n' +
    '    q = "SELECT * FROM users WHERE id = " + uid\n' +
    '    return other_api(q)\n'],

  // (ج) cursor موجود ⇒ الكتلة الأصلية تبقى مكرَّرة ميتة بعد الـreturn المزروع
  'C: param واحد، cursor موجود': ['db.py',
    'def one(uid):\n' +
    '    sql = "SELECT name FROM users WHERE id = " + uid\n' +
    '    cursor = conn.cursor()\n' +
    '    cursor.execute(sql)\n' +
    '    return cursor.fetchall()\n'],
};

// ═══ 1. لا كود ميت، ولا return مزروع ═══════════════════
for (const [label, [file, code]] of Object.entries(CASES)) {
  test(`py fixSQL: لا ينتج كودًا غير قابل للوصول — ${label}`, () => {
    const { fixed } = repair(code, file);
    assert.deepStrictEqual(unreachableLines(fixed), [],
      `${label}: الإصلاح جعل أسطرًا غير قابلة للوصول — الأصل لم يكن فيه شيء منها`);
  });

  test(`py fixSQL: لا يزرع return لم يكن في المصدر — ${label}`, () => {
    const { fixed } = repair(code, file);
    const before = (code.match(/^\s*return\b/gm) || []).length;
    const after  = (fixed.match(/^\s*return\b/gm) || []).length;
    assert.ok(after <= before,
      `${label}: عدد return ارتفع من ${before} إلى ${after} — زرع return يغيّر قيمة الدالة`);
  });

  test(`py fixSQL: لا يبتر نص الاستعلام — ${label}`, () => {
    const { fixed } = repair(code, file);
    if (fixed === code) return; // fail-closed مقبول
    for (const clause of new Set(sqlClauses(code)))
      assert.ok(sqlClauses(fixed).includes(clause),
        `${label}: اختفت "${clause}" من الاستعلام بعد الإصلاح`);
  });

  test(`py fixSQL: عدد placeholders = عدد المعاملات المربوطة — ${label}`, () => {
    const { fixed } = repair(code, file);
    if (fixed === code) return; // fail-closed مقبول
    for (const line of fixed.split('\n')) {
      const bound = boundCountIn(line);
      if (bound === null) continue;
      const varM = line.match(/\.execute\s*\(\s*([A-Za-z_]\w*)/);
      if (!varM) continue;
      const declRe = new RegExp(`^\\s*${varM[1]}\\s*=\\s*(["'].*)$`, 'm');
      const declM = fixed.match(declRe);
      if (!declM) continue;
      assert.strictEqual(placeholdersIn(declM[1]), bound,
        `${label}: ${placeholdersIn(declM[1])} placeholder مقابل ${bound} معاملًا مربوطًا`);
    }
  });
}

// ═══ 2. البوابة لا تقبل patch خطيرًا ══════════════════════
// الفحص النهائي: مهما كان قرار الـfixer، المُعتمَد لا يحمل كودًا ميتًا
// ولا return مزروعًا. (قبل الإصلاح: البوابة تقبل B و C.)
for (const [label, [file, code]] of Object.entries(CASES)) {
  test(`gate: لا يُعتمد patch فيه كود ميت — ${label}`, () => {
    const { fixed } = repair(code, file);
    if (fixed === code) return;
    const v = ctx.FixVerifier.verifyFix(code, fixed, file, ctx.analyzeCode);
    if (!v.accepted) return; // رُفض ⇒ لا خطر
    assert.deepStrictEqual(unreachableLines(fixed), [],
      `${label}: البوابة قبلت patch فيه كود غير قابل للوصول`);
  });
}

// ═══ 3. المسار المُبوَّب كاملاً ═══════════════════════════
// SmartRepair ليس المحرك الوحيد الذي يلمس بايثون. المقيس بعد هذا الإصلاح:
//   A, C → SmartRepair يُنتج الإصلاح الصحيح والبوابة تعتمده.
//   B    → SmartRepair يرفض fail-closed (لا موضع execute)، لكن
//          emergency_fixes.js يُنتج نفس patch القَولَبة القديم
//          (Emergency :: ACCEPTED) فيبقى الكود الميت في الناتج النهائي.
// عطل emergency_fixes.js ملفٌ آخر وخارج نطاق هذه الجولة، فهو مسجَّل todo
// أدناه بدليله بدل إضعاف التأكيد أو حجب الحقيقة.

function runPipeline(file, code) {
  const p = loadUiContext();
  p.F = { [file]: code };
  p.R = { [file]: { code, issues: p.analyzeCode(code, file) } };
  const report = p.fixAllEnginePipeline();
  return { out: p.F[file], report };
}

const assertCommittedSafe = (label, code, out) => {
  assert.deepStrictEqual(unreachableLines(out), [],
    `${label}: الـpipeline اعتمدت كودًا غير قابل للوصول`);
  const before = (code.match(/^\s*return\b/gm) || []).length;
  assert.ok((out.match(/^\s*return\b/gm) || []).length <= before,
    `${label}: الـpipeline اعتمدت return مزروعًا`);
};

// 3أ) ما يملكه هذا الإصلاح: أي شيء يعتمده SmartRepair يجب أن يكون سليمًا.
for (const [label, [file, code]] of Object.entries(CASES)) {
  test(`pipeline: ما تعتمده SmartRepair سليم — ${label}`, () => {
    const { out, report } = runPipeline(file, code);
    const sources = (report.accepted || []).map(a => String(a.source));
    if (!sources.some(s => /Smart/i.test(s))) return; // لم يعتمد شيئًا ⇒ fail-closed
    assert.ok(sources.every(s => /Smart/i.test(s)),
      `${label}: محرك آخر شارك في الناتج — لا يمكن عزل مسؤولية SmartRepair هنا`);
    assertCommittedSafe(label, code, out);
  });
}

// 3ب) الحالتان اللتان لا يلمسهما محرك آخر: الناتج النهائي سليم كاملاً.
for (const label of ['A: 2 params, cursor موجود', 'C: param واحد، cursor موجود']) {
  const [file, code] = CASES[label];
  test(`pipeline: الكود المعتمد نهائيًا سليم — ${label}`, () => {
    assertCommittedSafe(label, code, runPipeline(file, code).out);
  });
}

// 3ج) كان هذا todo يسجّل عطل emergency_fixes.js: SmartRepair يرفض fail-closed،
// ثم يأتي Emergency ويُعتمد ويُدخل return مزروعًا. أُغلق بفحص الوصول في
// البوابة (REJECTED_PY_UNREACHABLE_CODE)، فصار التأكيد مُفعَّلاً.
// والمولِّد نفسه ما زال يُنتج الـpatch المدمّر — إصلاحه نطاق جولة لاحقة —
// لكن البوابة تحجبه فلا يُعتمد شيء، والبلاغ يبقى قائمًا لمسار AI.
test('pipeline: patch القَولَبة من محرك آخر يُحجَب عند البوابة — B', () => {
  const [file, code] = CASES['B: param واحد، بلا cursor تحت'];
  const { out, report } = runPipeline(file, code);
  assert.ok(!(report.accepted || []).some(a => /Emergency/i.test(String(a.source))),
    'Emergency لا يجوز أن يُعتمد');
  assert.ok((report.rejected || []).some(a => /Emergency/i.test(String(a.source)) &&
    /UNREACHABLE/.test(String(a.reason))),
    'ويُرفض بفحص الوصول تحديدًا، لا بسبب عارض');
  assert.strictEqual(out, code, 'والكود يبقى كما هو');
  assertCommittedSafe('B', code, out);
});

// وهذا يبقى تأكيدًا حقيقيًا يمر: SmartRepair نفسها fail-closed في B.
test('pipeline: SmartRepair لا تُنتج شيئًا في B (fail-closed)', () => {
  const [file, code] = CASES['B: param واحد، بلا cursor تحت'];
  assert.strictEqual(repair(code, file).fixed, code);
  const { report } = runPipeline(file, code);
  assert.ok(!(report.accepted || []).some(a => /Smart/i.test(String(a.source))),
    'SmartRepair لا يجوز أن تُعتمد في حالة لا تستطيع إثباتها');
});

// ═══ 4. التشديد لا يلمس الفروع الأخرى ═══════════════════
// JS/TS هو الفرع الذي قسّاه D1 — سلوكه يبقى كما هو حرفيًا.

test('JS: إصلاح D1 الصحيح يبقى كما هو (الاستعلام كامل + معاملات مربوطة)', () => {
  const code = "function getUser(uid, fl) {\n" +
               "  const q = 'SELECT * FROM users WHERE id = ' + uid + ' AND a = ' + fl;\n" +
               "  return db.query(q);\n}\n";
  const { fixed } = repair(code, 'app.js');
  assert.match(fixed, /const q = "SELECT \* FROM users WHERE id = \? AND a = \?";/);
  assert.match(fixed, /db\.query\(q, \[uid, fl\]\)/);
});

test('JS: بلا موضع ربط يبقى fail-closed', () => {
  const code = "function f(u) {\n  const q = 'SELECT * FROM t WHERE id = ' + u;\n}\n";
  assert.strictEqual(repair(code, 'a.js').fixed, code);
});

test('PHP: سلوك الفرع الثالث لم يتغيّر', () => {
  const code = '<?php\n$q = "SELECT * FROM t WHERE id = " . $uid;\n';
  const { fixed } = repair(code, 'a.php');
  assert.match(fixed, /\$stmt = \$conn->prepare\(/);
  assert.match(fixed, /bind_param/);
});

// ═══ 5. بايثون: ما يجب ألا يُلمس أصلاً ═══════════════════

const PY_UNTOUCHED = {
  'استعلام مُعَامَل أصلاً': 'def f(uid):\n    cursor.execute("SELECT * FROM t WHERE id = ?", (uid,))\n',
  'f-string (خارج نطاق التجميع بـ+)': 'def f(uid):\n    q = f"SELECT * FROM t WHERE id = {uid}"\n    cursor.execute(q)\n',
  'نص بلا معاملات': 'def f():\n    q = "SELECT * FROM t"\n    cursor.execute(q)\n',
  'تعليق فيه SQL': 'def f(uid):\n    # q = "SELECT * FROM t WHERE id = " + uid\n    return 1\n',
  'الربط قائم أصلاً على المتغيّر':
    'def f(uid):\n    q = "SELECT * FROM t WHERE id = " + uid\n    cursor.execute(q, (uid,))\n    return 1\n',
  'معامل خاصية u.id (لا نضمن ترجمته)':
    'def f(u):\n    q = "SELECT * FROM t WHERE id = " + u.id\n    cursor.execute(q)\n    return 1\n',
  'معامل استدعاء esc(u)':
    'def f(u):\n    q = "SELECT * FROM t WHERE id = " + esc(u)\n    cursor.execute(q)\n    return 1\n',
  'بلا كلمة SQL':
    'def f(uid):\n    q = "hello " + uid\n    cursor.execute(q)\n    return 1\n',
  // الاستدعاء خارج الكتلة: كان findQueryCallSite يفحص التطابق قبل الإزاحة،
  // فيفوز سطر أقل إزاحة. في JS يحجبه سطر `}`، وبايثون بلا أقواس.
  'execute خارج الكتلة (dedent)':
    'def f(uid):\n    q = "SELECT * FROM t WHERE id = " + uid\ncursor.execute(q)\n',
  // executemany يتوقع تتابع تتابعات ⇒ ربط (p,) عليه خطأ دلالي.
  'executemany':
    'def f(uid):\n    q = "INSERT INTO t VALUES " + uid\n    cursor.executemany(q)\n    return 1\n',
};
for (const [label, code] of Object.entries(PY_UNTOUCHED)) {
  test(`py fixSQL: لا يلمس — ${label}`, () => {
    assert.strictEqual(repair(code, 'x.py').fixed, code);
  });
}

// ═══ 6. بايثون: ما يجب أن يُصلَح، ويُصلَح صحيحًا ═════════
// الاستعلام كامل، وعدد ? = عدد المعاملات بترتيبها، والربط في موضع execute
// القائم فعلاً — بلا حشر سطر وبلا حذف سطر.

const PY_FIXED = {
  'معاملان': ['def f(uid, fl):\n    q = "SELECT * FROM t WHERE id = " + uid + " AND a = " + fl\n    cursor.execute(q)\n    return cursor.fetchall()\n',
    '    q = "SELECT * FROM t WHERE id = ? AND a = ?"', '    cursor.execute(q, (uid, fl,))'],
  'ثلاثة معاملات': ['def f(a, b, c):\n    q = "SELECT * FROM t WHERE a = " + a + " AND b = " + b + " AND c = " + c\n    cursor.execute(q)\n    return cursor.fetchall()\n',
    '    q = "SELECT * FROM t WHERE a = ? AND b = ? AND c = ?"', '    cursor.execute(q, (a, b, c,))'],
  'نص لاحق بعد آخر معامل لا يُبتر': ['def f(uid):\n    q = "SELECT * FROM t WHERE id = " + uid + " ORDER BY name"\n    cursor.execute(q)\n    return cursor.fetchall()\n',
    '    q = "SELECT * FROM t WHERE id = ? ORDER BY name"', '    cursor.execute(q, (uid,))'],
  'اقتباس مهروب داخل النص لا يُضاعف': ['def f(uid):\n    q = "SELECT * FROM t WHERE n = \'x\' AND id = " + uid\n    cursor.execute(q)\n    return 1\n',
    '    q = "SELECT * FROM t WHERE n = \'x\' AND id = ?"', '    cursor.execute(q, (uid,))'],
  'execute في كتلة أعمق': ['def f(uid):\n    q = "SELECT * FROM t WHERE id = " + uid\n    if uid:\n        cursor.execute(q)\n    return 1\n',
    '    q = "SELECT * FROM t WHERE id = ?"', '        cursor.execute(q, (uid,))'],
  'conn.execute': ['def f(uid):\n    q = "SELECT * FROM t WHERE id = " + uid\n    conn.execute(q)\n    return 1\n',
    '    q = "SELECT * FROM t WHERE id = ?"', '    conn.execute(q, (uid,))'],
};
for (const [label, [code, expectQuery, expectCall]] of Object.entries(PY_FIXED)) {
  test(`py fixSQL: يُصلَح صحيحًا — ${label}`, () => {
    const { fixed } = repair(code, 'x.py');
    const lines = fixed.split('\n');
    assert.ok(lines.includes(expectQuery), `الاستعلام المتوقع غير موجود:\n${fixed}`);
    assert.ok(lines.includes(expectCall), `الربط المتوقع غير موجود:\n${fixed}`);
    assert.deepStrictEqual(unreachableLines(fixed), [], 'لا كود ميت');
    assert.strictEqual(lines.length, code.split('\n').length, 'عدد الأسطر لا يتغيّر — لا حشر ولا حذف');
  });
}

test('py fixSQL: استعلامان في نفس الدالة يُربط كلٌّ بمعامله', () => {
  const code = 'def f(a, b):\n    q1 = "SELECT * FROM t WHERE a = " + a\n    cursor.execute(q1)\n' +
               '    q2 = "SELECT * FROM u WHERE b = " + b\n    cursor.execute(q2)\n    return 1\n';
  const { fixed } = repair(code, 'x.py');
  assert.match(fixed, /cursor\.execute\(q1, \(a,\)\)/);
  assert.match(fixed, /cursor\.execute\(q2, \(b,\)\)/);
  assert.deepStrictEqual(unreachableLines(fixed), []);
});
