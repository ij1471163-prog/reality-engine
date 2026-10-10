// ═══════════════════════════════════════════════════════
// مسار إصلاح Python SQL — تعديل مدمّر يُقبل بعد رفض المسار الأساسي
// تشغيل:  node --test vercel-api/test/emergency_py_sql_gate.test.js
//
// تدقيق فقط: هذا الملف يعيد إنتاج الخلل عبر المسار الحقيقي ويوثّق سببه.
// لا يرافقه أي تعديل إنتاجي.
//
// المسار المقيس على  q = "SELECT … " + uid  ثم  return other_api(q):
//
//   1) الكشف: بلاغ واحد c/py — "SQL Injection — String Concatenation".
//   2) المولِّدات: repairCode و RepairSQL و SmartRepair و Fallback كلها
//      **لا تغيّر شيئاً**. رفض SmartRepair هو fail-closed المقصود (c0fb3d3):
//      لا موضع execute في الكتلة ⇒ لا patch.
//   3) لكن المولِّدات ليست مرتبة تنازلياً على قرار واحد: كل واحد مستقل
//      ويرى الكود الأصلي كما هو. فرفض المسار الأساسي يترك الملف بحاله،
//      فيأتي مولِّد لاحق ويُنتج patch خاصاً به.
//   4) emergency_fixes.js:31-62 يحمل نفس منطق القَولَبة الذي أُزيل من
//      smart_repair.js في c0fb3d3: يبتر الاستعلام عند أول نص حرفي، ويضيف
//      placeholder واحداً بلا نظر لعدد المعاملات، ويزرع
//      cursor = conn.cursor() و cursor.execute(...) و return
//      cursor.fetchall() بلا إثبات، وحلقة حذفه معلّقة على conn.execute أو
//      "return cursor" فلا تطابق الشكل الشائع. والنتيجة:
//          return cursor.fetchall()     ← مزروع
//          return other_api(q)          ← صار كوداً ميتاً، وناتج الدالة تغيّر
//   5) والبوابة تقبل: ACCEPTED (أزال 1 مشكلة، بلا تدهور).
//
// سبب القبول — مقيس، لا مُستنتج:
//   • المحلل يُرجع **صفر** بلاغات على الناتج، فـworsened=[] و addedCount=0
//     و removedCount=1. الكود الميت وتغيّر ناتج الدالة ليسا شيئاً يبلّغ عنه
//     المحلل في بايثون، فلا يراهما معيار القبول إطلاقاً.
//   • وفحوص quickCheck البنيوية (functions_preserved و no_new_eval)
//     موسومة "خاص بـJS/TS" وتُتخطّى على بايثون، فلا حماية بنيوية هناك.
//   • و syntaxCheck يمرّ: الكود الميت سليم الصياغة.
//   • وإثبات SQL يمرّ: execute(q, (uid,)) يطابق بديل بايثون.
//
// وليس السبب ترتيب المسارات: القسم 2 يسلّم ناتج كل مولِّد إلى البوابة
// **مباشرة** بلا أي ترتيب، فتقبله. الترتيب يحدّد أيّ مولِّد سيّئ يفوز، لا
// ما إذا كان patch مدمّر قادراً على المرور.
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
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة فقط */ }
  }
  ctx.toast = noop;
  ctx.refreshStats = noop;
  return ctx;
}

// ─── كاشف الكود غير القابل للوصول في بايثون ─────────────
// عبارة تلي مُنهياً للمسار على نفس إزاحة الكتلة. المتطلبات التي أثبتها
// الكوربوس العدائي (الأقسام 6 و7)، وبلا أيٍّ منها يعطي الكاشف نتائج خاطئة:
//   • حَمل حالة الاقتباس الثلاثي **بين** الأسطر — وإلا صار docstring متعدد
//     الأسطر كوداً، وهو سبب إيجابيات كاذبة في الفاحص القائم.
//   • تجاهل أسطر الاستمرار (عمق أقواس > 0، أو سطر منتهٍ بـ backslash).
//   • إسقاط التعليقات، فهي ليست عبارات.
//   • التمييز بين فرع جديد (else/elif/except/finally/case) يفتح مساراً
//     جديداً، وبين عبارة تالية في نفس الكتلة.
//   • المُنهيات: return و raise و break و continue و sys.exit/os._exit.
//   • تنظيف المستويات الأعمق عند الرجوع لمستوى أقل.
// مقيس: صفر إيجابية كاذبة وصفر فائتة على 42 حالة.
const PY_TERMINATOR = /^(?:return|raise|break|continue)\b|^(?:sys\.exit|os\._exit)\s*\(/;
const PY_NEW_BRANCH  = /^(?:elif|else|except|finally|case)\b/;

function unreachableLines(code) {
  const lines = String(code).replace(/\r\n?/g, '\n').split('\n');
  const terminatedAt = new Map();
  const out = [];
  let triple = null, depth = 0, continuing = false;

  for (const raw of lines) {
    if (!raw.trim()) continue;

    const startedInTriple = !!triple;
    let clean = '', quote = null, escaped = false;
    for (let k = 0; k < raw.length; k++) {
      const c = raw[k], n1 = raw[k + 1], n2 = raw[k + 2];
      if (triple) {
        if (c === triple && n1 === triple && n2 === triple) { clean += '   '; k += 2; triple = null; }
        else clean += ' ';
        continue;
      }
      if (quote) {
        clean += ' ';
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === quote) quote = null;
        continue;
      }
      if ((c === "'" || c === '"') && n1 === c && n2 === c) { triple = c; clean += '   '; k += 2; continue; }
      if (c === "'" || c === '"') { quote = c; clean += ' '; continue; }
      if (c === '#') break;
      clean += c;
    }

    const wasContinuing = continuing;
    for (const c of clean) {
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
    }
    continuing = depth > 0 || /\\$/.test(raw.trimEnd());

    const stmt = clean.trim();
    if (!stmt || startedInTriple || wasContinuing) continue;

    const indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
    for (const level of [...terminatedAt.keys()]) if (level > indent) terminatedAt.delete(level);

    if (terminatedAt.get(indent) && !PY_NEW_BRANCH.test(stmt)) out.push(stmt);
    if (PY_TERMINATOR.test(stmt)) terminatedAt.set(indent, true);
    if (PY_NEW_BRANCH.test(stmt)) terminatedAt.delete(indent);
  }
  return out;
}

const countReturns = code => (String(code).match(/^\s*return\b/gm) || []).length;

// ─── الحالات ────────────────────────────────────────────
const FILE = 'app.py';

// B: لا موضع execute في الكتلة ⇒ المسار الأساسي يرفض fail-closed، فلا شيء
//    يقف بين المولِّد اللاحق والبوابة.
const CASE_B = 'def get_user(uid):\n    q = "SELECT * FROM users WHERE id = " + uid\n    return other_api(q)\n';

// C: موضع execute موجود ⇒ SmartRepair يُنتج الإصلاح الصحيح.
const CASE_C = 'def one(uid):\n    sql = "SELECT name FROM users WHERE id = " + uid\n' +
               '    cursor = conn.cursor()\n    cursor.execute(sql)\n    return cursor.fetchall()\n';

// A: معاملان ⇒ ناتج المولِّد اللاحق يبتر الاستعلام فيلتقطه كاشف آخر.
const CASE_A = 'def get_user(uid, fl):\n    q = "SELECT * FROM users WHERE id = " + uid + " AND a = " + fl\n' +
               '    cursor = conn.cursor()\n    cursor.execute(q)\n    rows = cursor.fetchall()\n    return rows\n';

function emergencyOn(code, file) {
  const ctx = loadCtx();
  const F = { [file]: code };
  const R = { [file]: { code, issues: ctx.analyzeCode(code, file) } };
  ctx.applyEmergencyToAll(F, R);
  return { ctx, out: F[file] };
}

function pipelineOn(code, file) {
  const ctx = loadCtx();
  ctx.F = { [file]: code };
  ctx.R = { [file]: { code, issues: ctx.analyzeCode(code, file) } };
  const report = ctx.fixAllEnginePipeline();
  return { ctx, out: ctx.F[file], report };
}

// ═══ 0. المسار الأساسي يرفض fail-closed (ضوابط) ═════════
// بلا هذا لا يكون الاختبار عن "القبول بعد الرفض".

test('المسار الأساسي يرفض الحالة B: أربعة مولِّدات لا تغيّر شيئاً', () => {
  const ctx = loadCtx();
  const issues = ctx.analyzeCode(CASE_B, FILE);
  // ملاحظة: ‎(i.type || i.title)‎ فخّ — type='py' يقصر الدائرة فلا يُفحَص
  // العنوان. وهو نفس الفخّ الموثَّق في extractPair. نفحص الحقول مجتمعة.
  assert.ok(issues.some(i => /sql/i.test([i.type, i.title, i.cAct].join(' '))),
    'شرط: المحلل يبلّغ عن ثغرة SQL في الأصل');

  assert.strictEqual(ctx.repairCode(CASE_B, issues, FILE).repaired, CASE_B, 'repairCode لا يغيّر');
  assert.strictEqual(ctx.RepairSQL.fix(CASE_B, FILE).code, CASE_B, 'RepairSQL لا يغيّر');
  assert.strictEqual(ctx.SmartRepairEngine.repair(CASE_B, FILE, issues).fixed, CASE_B,
    'SmartRepair يرفض fail-closed — لا موضع execute في الكتلة (c0fb3d3)');

  const F = { [FILE]: CASE_B }, R = { [FILE]: { code: CASE_B, issues } };
  ctx.applyFallbackToAll(F, R);
  assert.strictEqual(F[FILE], CASE_B, 'Fallback لا يغيّر');
});

test('ومع ذلك يُنتج مولِّد لاحق patch فيه كود ميت — المولِّدات مستقلة', () => {
  const { out } = emergencyOn(CASE_B, FILE);
  assert.notStrictEqual(out, CASE_B, 'Emergency يُنتج patch رغم رفض المسار الأساسي');
  assert.ok(unreachableLines(out).length >= 1,
    'والناتج فيه كود غير قابل للوصول — رفض المسار الأساسي لا يقيّد المولِّدات اللاحقة');
  assert.ok(countReturns(out) > countReturns(CASE_B), 'وreturn مزروع لم يكن في المصدر');
});

// ═══ 1. البوابة تقبل patch فيه كود ميت ═════════════════
// هذا هو الخلل: البوابة هي المُحكِّم المشترك الوحيد، ولا ترى هذا الضرر.

for (const [label, src] of [['B', CASE_B], ['C', CASE_C]]) {
  test(`البوابة لا يجوز أن تقبل patch فيه كود ميت — الحالة ${label}`, () => {
    const { ctx, out } = emergencyOn(src, FILE);
    if (out === src) return;
    const unreachable = unreachableLines(out);
    if (!unreachable.length) return;
    const v = ctx.FixVerifier.verifyFix(src, out, FILE, ctx.analyzeCode);
    assert.ok(!v.accepted,
      `الحالة ${label}: البوابة قبلت (${v.reason}) patch فيه ${unreachable.length} سطراً ` +
      `غير قابل للوصول: ${JSON.stringify(unreachable)}`);
  });
}

// ═══ 2. الـpipeline كاملة لا تعتمد كوداً ميتاً ══════════

test('الـpipeline لا تعتمد كوداً ميتاً — الحالة B', () => {
  const { out, report } = pipelineOn(CASE_B, FILE);
  const sources = (report.accepted || []).map(a => String(a.source));
  assert.deepStrictEqual(unreachableLines(out), [],
    `اعتُمد كود غير قابل للوصول من: ${JSON.stringify(sources)}`);
  assert.ok(countReturns(out) <= countReturns(CASE_B), 'ولا return مزروع');
});

// الحالتان A و C تنجوان اليوم، لكن لأسباب عارضة لا لحماية البوابة. ويُسجَّل
// السبب صراحةً حتى لا يُقرأ الأخضر كضمان.
test('A و C تنجوان اليوم بأسباب عارضة — مسجَّلة لا مضمونة', () => {
  const c = pipelineOn(CASE_C, FILE);
  assert.deepStrictEqual(unreachableLines(c.out), [], 'C: الناتج النهائي نظيف');
  assert.ok((c.report.accepted || []).some(a => /Smart/i.test(String(a.source))),
    'C: والسبب أن SmartRepair يسبق فيُنتج الإصلاح الصحيح ويُعتمد، فلا يجد ' +
    'المولِّد اللاحق ما يغيّره. حماية ترتيب لا حماية بوابة.');

  const a = pipelineOn(CASE_A, FILE);
  assert.deepStrictEqual(unreachableLines(a.out), [], 'A: الناتج النهائي نظيف');
  const { ctx, out } = emergencyOn(CASE_A, FILE);
  const v = ctx.FixVerifier.verifyFix(CASE_A, out, FILE, ctx.analyzeCode);
  assert.ok(!v.accepted && /WORSENED/.test(String(v.reason)),
    'A: والسبب أن بتر الاستعلام يُنتج عدم تطابق معاملات يلتقطه كاشف آخر — ' +
    `التقاط عارض لا فحص للضرر نفسه (${v.reason})`);
});

// ═══ 3. سبب القبول — موثَّق بالقياس ════════════════════

test('سبب القبول: المحلل لا يبلّغ عن كود ميت في بايثون', () => {
  const { ctx, out } = emergencyOn(CASE_B, FILE);
  assert.ok(unreachableLines(out).length >= 1, 'شرط: الناتج فيه كود ميت');
  assert.strictEqual(ctx.analyzeCode(out, FILE).length, 0,
    'صفر بلاغات على ناتج مكسور الدلالة — فمعيار "أزال مشكلة بلا تدهور" يتحقق شكلاً');
  const deep = ctx.FixVerifier.verify(CASE_B, out, FILE, ctx.analyzeCode);
  assert.deepStrictEqual(Array.from(deep.diff.worsened), [], 'worsened فارغة');
  assert.ok(deep.diff.removedCount > 0, 'و removedCount موجب');
});

test('سبب القبول: فحوص quickCheck البنيوية تُتخطّى على بايثون', () => {
  const { ctx, out } = emergencyOn(CASE_B, FILE);
  const q = ctx.FixVerifier.quickCheck(CASE_B, out, FILE);
  const skipped = (q.skipped || []).map(s => s.id);
  assert.ok(skipped.includes('functions_preserved'),
    'functions_preserved موسوم "خاص بـJS/TS" ويُتخطّى — فلا حماية بنيوية لبايثون');
  assert.strictEqual(q.valid, true, 'و quickCheck يمرّ');
  assert.strictEqual(ctx.FixVerifier.syntaxCheck(out, FILE).ok, true,
    'و syntaxCheck يمرّ: الكود الميت سليم الصياغة');
});

// قبل إصلاح البوابة كان هذا التأكيد يوثّق القبول: التسليم المباشر بلا أي
// ترتيب كان يُقبل، فالترتيب لم يكن السبب. وبعد الإصلاح يُرفض عند نفس نقطة
// التسليم المباشر — وهو ما يثبت أن المعالجة في موضع السبب لا في الترتيب.
test('الرفض يحدث عند التسليم المباشر — المعالجة في موضع السبب لا الترتيب', () => {
  const { ctx, out } = emergencyOn(CASE_B, FILE);
  assert.ok(unreachableLines(out).length >= 1, 'شرط: المولِّد ما زال يُنتج كوداً ميتاً');
  const v = ctx.FixVerifier.verifyFix(CASE_B, out, FILE, ctx.analyzeCode);
  assert.ok(!v.accepted, `كان يجب الرفض — ${v.reason}`);
  assert.match(String(v.reason), /^REJECTED_PY_UNREACHABLE_CODE/,
    'والرفض من فحص الوصول تحديداً، لا من مرحلة أخرى');
});

// ═══ 4. المولِّد مكرَّر في ملف ثالث ════════════════════
// sql_injection_fix.js يحمل نفس المنطق، وهو في قائمة سكربتات index.html
// وليس في api/analyze.js. فإصلاح emergency_fixes.js وحده لا يُغلق الصنف.

// المولِّد المكرَّر ما زال يُنتج الـpatch المدمّر — إصلاحه نطاق الجولة
// الثانية. والمقيس هنا أن البوابة تحجبه الآن، وهو ما يجعل الإصلاح في
// البوابة كافياً لإغلاق الصنف لا مولِّداً واحداً.
test('المولِّد المكرَّر في sql_injection_fix.js ما زال يُنتج، والبوابة تحجبه', () => {
  const ctx = loadCtx();
  assert.notStrictEqual(typeof ctx.SQLInjectionFixer, 'undefined',
    'SQLInjectionFixer محمَّل في سياق index.html');
  const r = ctx.SQLInjectionFixer.fix(CASE_B, FILE);
  assert.notStrictEqual(r.fixed, CASE_B, 'يُنتج patch للحالة نفسها — عطل الجولة الثانية');
  assert.ok(unreachableLines(r.fixed).length >= 1, 'بنفس الكود الميت');
  const v = ctx.FixVerifier.verifyFix(CASE_B, r.fixed, FILE, ctx.analyzeCode);
  assert.ok(!v.accepted, `والبوابة تحجبه الآن — ${v.reason}`);
  assert.match(String(v.reason), /^REJECTED_PY_UNREACHABLE_CODE/,
    'بفحص الوصول، فالإصلاح في المُحكِّم المشترك يغلق الصنف لا مولِّداً واحداً');
});

// ═══ 5. ضابط ضد الإفراط ════════════════════════════════
// أي إصلاح مقترح للبوابة يجب أن يبقي الإصلاح السليم مقبولاً.

test('ضابط: إصلاح بايثون سليم يبقى مقبولاً', () => {
  const ctx = loadCtx();
  const good = 'def one(uid):\n    sql = "SELECT name FROM users WHERE id = ?"\n' +
               '    cursor = conn.cursor()\n    cursor.execute(sql, (uid,))\n    return cursor.fetchall()\n';
  assert.deepStrictEqual(unreachableLines(good), [], 'بلا كود ميت');
  const v = ctx.FixVerifier.verifyFix(CASE_C, good, FILE, ctx.analyzeCode);
  assert.ok(v.accepted, `يجب أن يبقى مقبولاً — ${v.reason}`);
});

test('ضابط: return متعددة في فروع مختلفة ليست كوداً ميتاً', () => {
  const branching = 'def pick(x):\n    if x:\n        return 1\n    return 2\n';
  assert.deepStrictEqual(unreachableLines(branching), [],
    'return داخل if ثم return بعده على إزاحة أقل — مسار سليم لا كود ميت');
});

// ═══ 6. كوربوس عدائي: ما يجب أن تقبله البوابة ══════════
// أي فحص يُضاف لاحقاً يجب أن يبقي الإصلاح السليم مقبولاً على كل هذه الأشكال.
// المقيس اليوم: أربع منها تُرفض بسبب pythonStructuralSyntaxCheck القائم —
// فهو يعيد ضبط حالة الاقتباس الثلاثي عند كل سطر، ولا يعرف أسطر الاستمرار.

const VALID_PY = {
  'return داخل if ثم return بعده':
    'def f(x):\n    if x:\n        return 1\n    return 2\n',
  'return داخل for ثم كود بعد الحلقة':
    'def f(xs):\n    for x in xs:\n        if x:\n            return x\n    return None\n',
  'try/except/finally':
    'def f():\n    try:\n        return g()\n    except ValueError:\n        return 0\n    finally:\n        cleanup()\n',
  'docstring متعدد الأسطر فيه كلمة return':
    'def f():\n    """\n    return the thing\n    """\n    return 1\n',
  'نص متعدد الأسطر ثم كود':
    'def f():\n    s = """\nreturn fake\n"""\n    return s\n',
  'استمرار بـbackslash':
    'def f(a, b):\n    t = a + \\\n        b\n    return t\n',
  'استمرار بأقواس':
    'def f():\n    d = {\n        "a": 1,\n    }\n    return d\n',
  'دالة داخلية ثم كود':
    'def outer():\n    def inner():\n        return 1\n    return inner()\n',
  'while True مع return داخل if':
    'def f():\n    while True:\n        if done():\n            return 1\n    return 0\n',
  'تعليق بعد return':
    'def f():\n    return 1\n    # تعليق فقط\n',
  'elif بعد return':
    'def f(x):\n    if x == 1:\n        return 1\n    elif x == 2:\n        return 2\n    return 0\n',
  'raise داخل except ثم كود بعد try':
    'def f():\n    try:\n        g()\n    except E:\n        raise\n    return 1\n',
  'break داخل حلقة ثم كود بعدها':
    'def f(xs):\n    for x in xs:\n        if x:\n            break\n    return 1\n',
  'if سطر واحد: return ثم كود بعده':
    'def f(x):\n    if x: return 1\n    return 2\n',
  'with block':
    'def f():\n    with open("f") as h:\n        return h.read()\n',
  'tab indentation':
    'def f(x):\n\tif x:\n\t\treturn 1\n\treturn 2\n',
  'triple فيه اقتباسات داخلية':
    'def f():\n    s = """he said "hi" and\n    returned"""\n    return s\n',
  'نص فيه # ليس تعليقاً':
    'def f():\n    s = "a # b"\n    return s\n',
};

// لكل شكل: نبني منه ملفاً فيه ثغرة SQL، ثم إصلاحاً سليماً، ونطالب بالقبول.
// يُحقَن موضع execute كذلك، وإلا رفض إثبات SQL في البوابة الإصلاحَ لسبب
// آخر تماماً (REJECTED_SQL_NOT_PARAMETERIZED) فلا يقيس الاختبار ما نريد.
function withSqlHole(body) {
  return body.replace(/^(\s*)return /m,
    '$1q = "SELECT * FROM t WHERE id = " + uid\n$1cursor.execute(q)\n$1return ');
}
function withSqlFixed(body) {
  return body.replace(/^(\s*)return /m,
    '$1q = "SELECT * FROM t WHERE id = ?"\n$1cursor.execute(q, (uid,))\n$1return ');
}

// كانت هذه الحالات تفشل بسبب pythonStructuralSyntaxCheck: يعيد ضبط حالة
// الاقتباس الثلاثي عند كل سطر، ولا يعرف أسطر الاستمرار. أُصلح بضبط وحدة
// الفحص على السطر المنطقي، فصار التأكيد مُفعَّلاً على **كل** الأشكال.
// والفجوات المتبقية في الفاحص مثبَّتة بحكم CPython في
// verifier_py_syntax_vs_cpython.test.js.
test('كوربوس صحيح: البوابة تقبل الإصلاح السليم على كل الأشكال', () => {
  const ctx = loadCtx();
  const failures = [];
  let measured = 0;
  for (const [label, body] of Object.entries(VALID_PY)) {
    const before = withSqlHole(body);
    const after = withSqlFixed(body);
    if (before === body) continue; // لم يُبنَ ثقب ⇒ لا قياس
    measured++;
    const v = ctx.FixVerifier.verifyFix(before, after, 'c.py', ctx.analyzeCode);
    if (!v.accepted) failures.push(`${label} → ${v.reason}`);
  }
  assert.ok(measured >= 16, `عدد الأشكال المقيسة ${measured} — يجب أن يبقى ذا دلالة`);
  assert.deepStrictEqual(failures, [],
    'إصلاح سليم مرفوض على أشكال بايثون صحيحة');
});

// وهذا تأكيد مُفعَّل على ما يملكه فحص الوصول فعلاً: الأشكال التي لا يرفضها
// الفاحص القائم يجب أن تبقى مقبولة. يفصل مسؤولية الجولة عن البند الجانبي.
test('كوربوس صحيح: الأشكال التي يقبلها الفاحص القائم تبقى مقبولة', () => {
  const ctx = loadCtx();
  const failures = [];
  let measured = 0;
  for (const [label, body] of Object.entries(VALID_PY)) {
    const before = withSqlHole(body);
    const after = withSqlFixed(body);
    if (before === body) continue;
    // نستبعد ما يرفضه الفاحص البنيوي القائم أصلاً — بند منفصل
    if (!ctx.FixVerifier.syntaxCheck(after, 'c.py').ok) continue;
    measured++;
    const v = ctx.FixVerifier.verifyFix(before, after, 'c.py', ctx.analyzeCode);
    if (!v.accepted) failures.push(`${label} → ${v.reason}`);
  }
  assert.ok(measured >= 12, `عدد الأشكال المقيسة ${measured} — يجب أن يبقى ذا دلالة`);
  assert.deepStrictEqual(failures, [],
    'فحص الوصول لا يجوز أن يرفض أي إصلاح سليم');
});

test('كوربوس صحيح: الأشكال نفسها لا تحمل كوداً ميتاً', () => {
  const flagged = Object.entries(VALID_PY)
    .filter(([, body]) => unreachableLines(body).length)
    .map(([label]) => label);
  assert.deepStrictEqual(flagged, [],
    'الكاشف المستخدم في هذا الملف يعطي إيجابيات كاذبة على هذه الأشكال — ' +
    'فأي فحص إنتاجي يجب أن يحمل حالة الاقتباس الثلاثي بين الأسطر، ويتجاهل ' +
    'أسطر الاستمرار، ويفرّق بين فرع جديد (else/except/elif/finally) وبين ' +
    'عبارة تالية في نفس الكتلة');
});

// ═══ 7. كوربوس عدائي: كود ميت حقيقي يجب كشفه ═══════════

const DEAD_PY = {
  'return ثم return نفس الإزاحة': 'def f():\n    return 1\n    return 2\n',
  'return ثم إسناد':              'def f():\n    return 1\n    x = 2\n',
  'raise ثم كود':                 'def f():\n    raise ValueError()\n    cleanup()\n',
  'return ثم كود بعد سطر فارغ':   'def f():\n    return 1\n\n    x = 2\n',
  'return ثم كود بعد تعليق':      'def f():\n    return 1\n    # تعليق\n    x = 2\n',
  'continue ثم كود داخل الحلقة':  'def f(xs):\n    for x in xs:\n        continue\n        y = 1\n',
  'return داخل with ثم كود':      'def f():\n    with open("f") as h:\n        return h.read()\n        h.close()\n',
  'raise داخل except ثم كود':     'def f():\n    try:\n        g()\n    except E:\n        raise\n        log()\n',
  'ناتج Emergency الحقيقي':
    'def get_user(uid):\n    q = "SELECT * FROM users WHERE id =?"\n    cursor = conn.cursor()\n' +
    '    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    return other_api(q)\n',
};

test('كوربوس ميت: كل شكل يحمل كوداً غير قابل للوصول', () => {
  const missed = Object.entries(DEAD_PY)
    .filter(([, code]) => unreachableLines(code).length === 0)
    .map(([label]) => label);
  assert.deepStrictEqual(missed, [],
    'أشكال كود ميت لا يكشفها الكاشف المستخدم هنا — تحدّد الحد الأدنى لأي فحص إنتاجي');
});

// ═══ 8. الشرط الفارقي ══════════════════════════════════
// كود ميت موجود في الأصل لا يجوز أن يُحاسَب عليه الـpatch. القرار يكون على
// ما **يضيفه** التعديل، كما تفعل diffCounts مع البلاغات.

test('الشرط الفارقي: كود ميت سابق لا يُحاسَب عليه الـpatch', () => {
  const before = 'def f(uid):\n    q = "SELECT * FROM t WHERE id = " + uid\n    cursor.execute(q)\n' +
                 '    return cursor.fetchall()\n    log("dead already")\n';
  const after  = 'def f(uid):\n    q = "SELECT * FROM t WHERE id = ?"\n    cursor.execute(q, (uid,))\n' +
                 '    return cursor.fetchall()\n    log("dead already")\n';
  const b = unreachableLines(before), a = unreachableLines(after);
  assert.ok(b.length >= 1, 'الأصل فيه كود ميت');
  assert.deepStrictEqual(a.filter(x => !b.includes(x)), [],
    'والتعديل لا يضيف شيئاً ⇒ القرار الفارقي قبول');
});

test('الشرط الفارقي: التعديل الذي يضيف كوداً ميتاً يُرفض', () => {
  const before = 'def f(uid):\n    q = "SELECT * FROM t WHERE id = " + uid\n    return other(q)\n';
  const after  = 'def f(uid):\n    q = "SELECT * FROM t WHERE id = ?"\n    cursor.execute(q, (uid,))\n' +
                 '    return cursor.fetchall()\n    return other(q)\n';
  const b = unreachableLines(before), a = unreachableLines(after);
  assert.deepStrictEqual(b, [], 'الأصل بلا كود ميت');
  assert.ok(a.filter(x => !b.includes(x)).length >= 1, 'والتعديل يضيفه ⇒ القرار الفارقي رفض');
});

// ═══ 9. عقد فحص الوصول على مستوى البوابة ══════════════
// التأكيدات أعلاه تقيس الكاشف. هذه تقيس **البوابة** نفسها، وهي عقد الجولة.

const PY_BEFORE_CLEAN = 'def f(uid):\n    q = "SELECT * FROM t WHERE id = " + uid\n' +
                        '    cursor.execute(q)\n    return cursor.fetchall()\n';

// الأصل سليم (بلا كود ميت)، والتعديل يُدخل كوداً ميتاً ⇒ البوابة ترفض.
const GATE_MUST_REJECT = {
  'يزرع return قبل كود قائم':
    'def f(uid):\n    q = "SELECT * FROM t WHERE id = ?"\n    cursor.execute(q, (uid,))\n' +
    '    return cursor.fetchall()\n    log(q)\n',
  'يزرع raise قبل كود قائم':
    'def f(uid):\n    q = "SELECT * FROM t WHERE id = ?"\n    raise NotImplementedError()\n' +
    '    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n',
  'يترك الاستدعاء الأصلي مكرَّراً بعد return مزروع':
    'def f(uid):\n    q = "SELECT * FROM t WHERE id = ?"\n    cursor.execute(q, (uid,))\n' +
    '    return cursor.fetchall()\n    cursor.execute(q)\n    return cursor.fetchall()\n',
};

for (const [label, after] of Object.entries(GATE_MUST_REJECT)) {
  test(`gate: ترفض تعديلاً يُدخل كوداً غير قابل للوصول — ${label}`, () => {
    const ctx = loadCtx();
    assert.deepStrictEqual(unreachableLines(PY_BEFORE_CLEAN), [], 'شرط: الأصل بلا كود ميت');
    assert.ok(unreachableLines(after).length >= 1, 'شرط: التعديل يُدخل كوداً ميتاً');
    assert.ok(ctx.FixVerifier.syntaxCheck(after, 'g.py').ok,
      'شرط: سليم الصياغة — وإلا كان الرفض من الفاحص البنيوي لا من فحص الوصول');
    const v = ctx.FixVerifier.verifyFix(PY_BEFORE_CLEAN, after, 'g.py', ctx.analyzeCode);
    assert.ok(!v.accepted, `${label}: قُبل بـ${v.reason}`);
  });
}

test('gate: تقبل الإصلاح السليم (لا إفراط في الرفض)', () => {
  const ctx = loadCtx();
  const after = 'def f(uid):\n    q = "SELECT * FROM t WHERE id = ?"\n' +
                '    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n';
  const v = ctx.FixVerifier.verifyFix(PY_BEFORE_CLEAN, after, 'g.py', ctx.analyzeCode);
  assert.ok(v.accepted, `الإصلاح السليم يجب أن يبقى مقبولاً — ${v.reason}`);
});

test('gate: كود ميت موجود مسبقاً لا يُحاسَب عليه التعديل', () => {
  const ctx = loadCtx();
  const before = 'def f(uid):\n    q = "SELECT * FROM t WHERE id = " + uid\n' +
                 '    cursor.execute(q)\n    return cursor.fetchall()\n    log("dead already")\n';
  const after  = 'def f(uid):\n    q = "SELECT * FROM t WHERE id = ?"\n' +
                 '    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    log("dead already")\n';
  assert.ok(unreachableLines(before).length >= 1, 'شرط: الأصل فيه كود ميت');
  const v = ctx.FixVerifier.verifyFix(before, after, 'g.py', ctx.analyzeCode);
  assert.ok(v.accepted, `الضرر السابق ليس ضرراً جديداً — ${v.reason}`);
});

test('gate: تعديل يُزيل كوداً ميتاً سابقاً يبقى مقبولاً', () => {
  const ctx = loadCtx();
  const before = 'def f(uid):\n    q = "SELECT * FROM t WHERE id = " + uid\n' +
                 '    cursor.execute(q)\n    return cursor.fetchall()\n    log("dead")\n';
  const after  = 'def f(uid):\n    q = "SELECT * FROM t WHERE id = ?"\n' +
                 '    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n';
  const v = ctx.FixVerifier.verifyFix(before, after, 'g.py', ctx.analyzeCode);
  assert.ok(v.accepted, `إزالة كود ميت تحسين لا ضرر — ${v.reason}`);
});

// ═══ 10. اللغات الأخرى لا تتأثر ════════════════════════
// الفحص بايثوني بطبيعته: في JS يرفع `{` عمق الأقواس فلا يعود إلى صفر،
// فكل الأسطر تُعدّ أسطر استمرار ⇒ الكاشف خامل لا خاطئ. ولذلك يُقصَر على
// ‎.py‎ صريحاً، وتبقى نتائج بقية اللغات كما قِيست قبل التعديل.

test('اللغات الأخرى: الكاشف خامل على JS (لا إيجابية كاذبة ولا كشف)', () => {
  const jsOk   = 'function f(x) {\n  if (x) {\n    return 1;\n  }\n  return 2;\n}\n';
  const jsDead = 'function f() {\n  return 1;\n  const x = 2;\n}\n';
  assert.deepStrictEqual(unreachableLines(jsOk), [], 'JS سليم: لا إيجابية كاذبة');
  assert.deepStrictEqual(unreachableLines(jsDead), [],
    'JS فيه كود ميت: خامل كذلك — فالفحص لا يُغني عن أداة JS، وهي بند منفصل');
});

// القيم المقيسة قبل التعديل الإنتاجي — يجب أن تبقى كما هي حرفياً.
const OTHER_LANG_BASELINE = {
  'JS إصلاح سرّ سليم': ['a.js',
    'function auth() {\n  const API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";\n  return API_KEY;\n}\n',
    'function auth() {\n  const API_KEY = process.env.API_KEY;\n  return API_KEY;\n}\n', true],
  'JS إصلاح يُدخل كوداً ميتاً': ['a.js',
    'function auth() {\n  const API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";\n  return API_KEY;\n}\n',
    'function auth() {\n  const API_KEY = process.env.API_KEY;\n  return API_KEY;\n  log(API_KEY);\n}\n', true],
  'PHP بلا فاحص صياغة': ['a.php',
    '<?php\n$api_key = "sk_live_51H8xQ2abcdefghijKLMN";\necho $api_key;\n',
    '<?php\n$api_key = getenv("API_KEY");\necho $api_key;\n', false],
};

for (const [label, [file, before, after, expectAccepted]] of Object.entries(OTHER_LANG_BASELINE)) {
  test(`اللغات الأخرى: السلوك كما قِيس قبل التعديل — ${label}`, () => {
    const ctx = loadCtx();
    const v = ctx.FixVerifier.verifyFix(before, after, file, ctx.analyzeCode);
    assert.strictEqual(v.accepted, expectAccepted,
      `${label}: تغيّر سلوك لغة غير بايثون — ${v.reason}`);
  });
}

// ═══ 11. حالات لا يحسمها الفحص — موثَّقة لا مُدّعاة ════

test('حدود موثَّقة: كود ميت على نفس السطر بعد فاصلة منقوطة لا يُكشف', () => {
  const code = 'def f():\n    return 1; x = 2\n';
  assert.deepStrictEqual(unreachableLines(code), [],
    'عبارتان على سطر واحد خارج نطاق الفحص السطري — فائتة معروفة لا إيجابية كاذبة');
});

test('حدود موثَّقة: كود بعد شرط دائم الصدق لا يُكشف', () => {
  const code = 'def f():\n    if True:\n        return 1\n    x = 2\n';
  assert.deepStrictEqual(unreachableLines(code), [],
    'يحتاج تحليل قيم لا تحليل بنية — خارج النطاق صراحةً');
});

test('حدود موثَّقة: الفحص لا يرى تغيّر قيمة الإرجاع بلا كود ميت', () => {
  const before = 'def f(uid):\n    q = "SELECT * FROM t WHERE id = " + uid\n    return other(q)\n';
  const after  = 'def f(uid):\n    q = "SELECT * FROM t WHERE id = ?"\n    return cursor.fetchall()\n';
  assert.deepStrictEqual(unreachableLines(after), [],
    'استبدال سطر الإرجاع لا يُنتج كوداً ميتاً، فلا يلتقطه هذا الفحص — ' +
    'حدّ معروف: الفحص عن الوصول لا عن مكافئة الدلالة');
});
