// ═══════════════════════════════════════════════════════
// جولة تحقق على تصميم مطابقة الكود غير القابل للوصول
// تشغيل:  node --test vercel-api/test/verifier_py_unreachable_design_verify.test.js
// المسح الكامل (155 ملفًا، ~4 دقائق):  PY_REACH_FULL=1 node --test <هذا الملف>
//
// اختبارات وتحليل فقط. لا يرافقها تعديل إنتاجي.
//
// ما تُجيب عنه هذه الجولة:
//   1. الحالة المتبقية: قتل سطر حيّ مع تغيّر نصه وحذف ميت في النطاق نفسه.
//   2. هوية النطاق: تكرار أسماء def/class، التداخل، النقل بين النطاقات.
//   3. ملفات بايثون واقعية كبيرة، لا كوربوس صناعي قصير.
//   4. إيجابيات/سلبيات كاذبة مقيسة بحقيقة أرضية من شجرة CPython.
//
// الحقيقة الأرضية ليست من ماسح الأسطر: سكربت fixtures/py_reach_mutate.py
// يحوّل شجرة ملف حقيقي، ويُخرج الطرفين بـast.unparse (فكلاهما بايثون صحيح
// بالتنسيق نفسه)، ويُعلِن الضرر بهوية العقدة لا بنصّها.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');
const { execFileSync } = require('node:child_process');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const FV_SRC     = fs.readFileSync(path.join(PUBLIC_DIR, 'fix_verifier.js'), 'utf8');
const MUTATOR    = path.join(__dirname, 'fixtures', 'py_reach_mutate.py');
const { statements, current, cand5, cand7, cand8, cand11b } = require('./helpers/py_reach_strategies.js');

function loadCtx() {
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop, createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* واجهة */ }
  }
  return ctx;
}

function productionScanner() {
  const grab = re => { const m = FV_SRC.match(re); assert.ok(m, 'غير موجود: ' + re); return m[0]; };
  const sand = {};
  vm.createContext(sand);
  vm.runInContext(
    grab(/const PY_TERMINATOR[\s\S]*?function pyUnreachableAdded[\s\S]*?\n    return added;\n  }\n/) +
    '\n;DEAD = pyUnreachableStatements;', sand);
  return sand.DEAD;
}

// مرحلة الحكم معزولة من المصدر: تقيس القواعد وحدها، دون requireImprovement
// ولا quickCheck. لازمة للحالات السليمة التي لا تُسقط بلاغًا فترفضها البوابة
// لسبب آخر، فلا يُعرف هل سكت فحص الوصول أم لا.
function productionVerdict() {
  const grab = re => { const m = FV_SRC.match(re); assert.ok(m, 'غير موجود: ' + re); return m[0]; };
  const sand = {};
  vm.createContext(sand);
  vm.runInContext(
    grab(/const PY_TERMINATOR[\s\S]*?function pyUnreachableAdded[\s\S]*?\n    return added;\n  }\n/) +
    '\n;V = pyReachabilityVerdict;', sand);
  return sand.V;
}

const ctx = loadCtx();
const productionDead = productionScanner();
const reachVerdict = productionVerdict();
const reachFlags = (b, a) => { const v = reachVerdict(b, a); return v.added.concat(v.suspect); };

function havePython() {
  try { execFileSync('python3', ['-I', '-c', 'import ast,sys;assert sys.version_info>=(3,9)'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}
function stdlibDir() {
  try {
    const p = execFileSync('python3', ['-I', '-c', 'import sysconfig;print(sysconfig.get_paths()["stdlib"])'],
      { encoding: 'utf8' }).trim();
    return fs.existsSync(p) ? p : null;
  } catch { return null; }
}
const PY = havePython();
const STD = PY ? stdlibDir() : null;
const skipReal = (!PY || !STD) ? 'python3 أو مكتبة بايثون القياسية غير متاحة' : false;
// عيّنة التحويلات لا تحتاج المكتبة القياسية — فقط مفسّرًا يشغّل المولّد.
// الشرط أضيق من skipReal لا أوسع: الاختبار صار يعمل في بيئات أكثر لا أقل.
const skipPy = !PY ? 'python3 غير متاح' : false;

// عيّنة ثابتة داخل المستودع. انظر fixtures/py_reach_corpus/README.md لعقدها
// وللقياس الذي أوجبها. الترتيب أبجدي صريح فلا يعتمد على ترتيب نظام الملفات.
const CORPUS_DIR = path.join(__dirname, 'fixtures', 'py_reach_corpus');
function corpusFiles() {
  return fs.readdirSync(CORPUS_DIR).filter(f => f.endsWith('.py')).sort()
    .map(f => path.join(CORPUS_DIR, f));
}

// ═══ 1. خط أساس على كود حقيقي ══════════════════════════
// ماذا يرى الماسح في بايثون حقيقي لم يلمسه إصلاح؟ لو رأى ميتًا حيث لا ميت،
// لكان كل ما بعده ضجيجًا.

test('خط أساس: الماسح لا يرى كودًا ميتًا في مكتبة بايثون القياسية', { skip: skipReal }, () => {
  const files = fs.readdirSync(STD).filter(f => f.endsWith('.py')).map(f => path.join(STD, f))
    .filter(p => { try { return fs.statSync(p).size < 400000; } catch { return false; } });
  assert.ok(files.length >= 50, `ملفات قليلة: ${files.length}`);

  let lines = 0; const flagged = [];
  for (const p of files) {
    let code; try { code = fs.readFileSync(p, 'utf8'); } catch { continue; }
    lines += code.split('\n').length;
    const dead = statements(code).dead;
    if (dead.length) flagged.push(`${path.basename(p)}: ${dead.length} (${dead[0].scope}: ${dead[0].raw.slice(0, 50)})`);
  }
  assert.ok(lines >= 50000, `أسطر قليلة: ${lines}`);
  assert.deepStrictEqual(Array.from(flagged), [],
    'الماسح رأى كودًا ميتًا في كود حقيقي سليم — إيجابيات كاذبة في الماسح نفسه');
});

// ═══ 2. الحالة المتبقية: غير قابلة للحسم من النص ════════
// الزوجان أدناه متطابقان في كل ما يستطيع فاحصٌ نصّي قياسه: عدد الميت ثابت،
// عدد الأحياء نقص واحدًا، ونصوص الميت تغيّرت. أحدهما سليم والآخر ضارّ.
// فلا قاعدة نصّية تفصلهما، وأي فاحص يرفض أحدهما يرفض الآخر.

const HOLE  = 'q = "SELECT * FROM t WHERE id = " + uid';
const FIXED = 'q = "SELECT * FROM t WHERE id = ?"';

// ضارّ: log(a) كانت تُنفَّذ، فنُقلت تحت return وأُعيدت تسميتها، وd1() حُذف.
const HARMFUL = [
  `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    log(a)\n    return cursor.fetchall()\n    d1()\n`,
  `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    log(b)\n`];
// سليم: log(a) حُذفت (والحذف ليس قتلًا بالوصول)، وd1() أُعيدت صياغتها فقط.
const BENIGN = [
  `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    log(a)\n    return cursor.fetchall()\n    d1()\n`,
  `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    log(b)\n`];

test('الحالة المتبقية: الضارّ والسليم نصّهما واحد — لا قاعدة نصّية تفصلهما', () => {
  // هما حرفيًّا الزوج نفسه؛ الفرق في النيّة وحدها (نقل مع إعادة تسمية، أم حذف
  // وإضافة). ولذلك يُسجَّل الحدّ هنا بوصفه عدم قابلية للحسم، لا ثغرة قابلة للسدّ.
  assert.strictEqual(HARMFUL[0], BENIGN[0]);
  assert.strictEqual(HARMFUL[1], BENIGN[1]);

  const B = statements(HARMFUL[0]), A = statements(HARMFUL[1]);
  assert.strictEqual(A.dead.length, B.dead.length, 'عدد الميت ثابت');
  assert.strictEqual(A.all.filter(x => !x.dead).length, B.all.filter(x => !x.dead).length - 1,
    'عدد الأحياء نقص واحدًا');
  assert.notDeepStrictEqual(A.dead.map(d => d.raw), B.dead.map(d => d.raw), 'نصوص الميت تغيّرت');
});

test('الحالة المتبقية: مرشَّح 5 يقبلها ومرشَّح 7 يرفضها — والثمن مقيس أدناه', () => {
  assert.strictEqual(cand5(...HARMFUL).length, 0, 'مرشَّح 5 يقبل (سلبي كاذب على القراءة الضارّة)');
  assert.ok(cand7(...HARMFUL).length >= 1, 'مرشَّح 7 يرفض (إيجابي كاذب على القراءة السليمة)');
  assert.ok(current(...HARMFUL).length >= 1, 'التنفيذ الحالي يرفض — وهو سبب إيجابياته الكاذبة');
});

// ═══ 3. هوية النطاق ════════════════════════════════════
// تكرار الأسماء والتداخل والنقل بين النطاقات: هل يؤدي أيٌّ منها إلى قبول
// إصلاح ضارّ؟ كل حالة مبنيّة بحيث تتوقّف عبارة كانت تُنفَّذ عن التنفيذ.

const SCOPE_HARM = {
  'اسمان متكرّران: القتل في الثانية وحذف ميت من الأولى': [
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    d1()\n\ndef f():\n    keep()\n    return 1\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n\ndef f():\n    return 1\n    keep()\n`],
  'متداخلتان بنفس الاسم تحت أمّين مختلفين': [
    `def o1(uid):\n    def h():\n        ${HOLE}\n        cursor.execute(q)\n        return q\n        d1()\n    return h()\n\ndef o2():\n    def h():\n        keep()\n        return 1\n    return h()\n`,
    `def o1(uid):\n    def h():\n        ${FIXED}\n        cursor.execute(q, (uid,))\n        return q\n    return h()\n\ndef o2():\n    def h():\n        return 1\n        keep()\n    return h()\n`],
  'تابع صنف ودالة وحدة بالاسم نفسه': [
    `class A:\n    def m(self, uid):\n        ${HOLE}\n        cursor.execute(q)\n        return cursor.fetchall()\n        d1()\n\ndef m():\n    keep()\n    return 1\n`,
    `class A:\n    def m(self, uid):\n        ${FIXED}\n        cursor.execute(q, (uid,))\n        return cursor.fetchall()\n\ndef m():\n    return 1\n    keep()\n`],
  'القتل داخل نطاق أنشأه الإصلاح': [
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    keep()\n    return cursor.fetchall()\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n\ndef brand():\n    return 0\n    keep()\n`],
  'نصّ المقتول موجود ميتًا في نطاق آخر': [
    `def a(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    keep()\n\ndef b():\n    keep()\n    return 1\n`,
    `def a(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    keep()\n\ndef b():\n    return 1\n    keep()\n`],
  'نقل عبر النطاقات مع حذف ميت من نطاق الوصول': [
    `def a(uid):\n    ${HOLE}\n    cursor.execute(q)\n    keep()\n    return cursor.fetchall()\n\ndef b():\n    return 1\n    d1()\n`,
    `def a(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n\ndef b():\n    return 1\n    keep()\n`],
};

for (const [label, [before, after]] of Object.entries(SCOPE_HARM)) {
  test(`هوية النطاق: مرشَّح 5 يرى الضرر — ${label}`, () => {
    assert.ok(statements(after).dead.length >= 1, 'شرط: الناتج فيه كود ميت');
    assert.ok(cand5(before, after).length >= 1, `${label}: مرشَّح 5 قَبِل إصلاحًا ضارًّا`);
  });
}

test('هوية النطاق: المطابقة المحلّية بالنطاق وحدها لا تكفي — مرشَّح 8 يُفلت النقل بين النطاقات', () => {
  const [before, after] = SCOPE_HARM['نقل عبر النطاقات مع حذف ميت من نطاق الوصول'];
  assert.strictEqual(cand8(before, after).length, 0,
    'لو صار مرشَّح 8 يراها فقد زال سبب تفضيل القاعدة على مستوى الملف — حدِّث التقرير');
  assert.ok(cand5(before, after).length >= 1, 'والقاعدة على مستوى الملف تراها');
});

test('هوية النطاق: النطاق يُعرَف بالاسم، فالدوال المتكرّرة الاسم تندمج في العدّ', () => {
  const code = 'def f():\n    return 1\n    p()\n\ndef f():\n    return 2\n    r()\n';
  assert.deepStrictEqual(Array.from(statements(code).dead.map(d => d.scope)), ['f', 'f']);
});

test('هوية النطاق: دمج اسمَي دالتين يُنتج إيجابيًا كاذبًا في مرشَّح 5', () => {
  // ثمن معلن: العدّ لكل نطاق يرى اسمًا واحدًا فيه ميتان. والتحويل نفسه
  // مَرَضي — لا مولّد في المستودع يوحّد أسماء الدوال، وهو يغيّر الدلالة بالظلّ.
  const before = `def a(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    d1()\n\ndef b():\n    return 1\n    d2()\n`;
  const after  = `def a(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    d1()\n\ndef a():\n    return 1\n    d2()\n`;
  assert.ok(cand5(before, after).length >= 1, 'إن زال هذا الإيجابي الكاذب فحدِّث الأرقام في التقرير');
  assert.strictEqual(cand8(before, after).length, 0, 'والمطابقة المحلّية لا تقع فيه');
  assert.strictEqual(cand7(before, after).length, 0, 'ومرشَّح 7 لا يقع فيه');
});

// والثمن الأكبر للعدّ لكل نطاق: نقل كود ميت بين النطاقات — تعديل سليم شائع.
test('هوية النطاق: نقل ميت بين نطاقين يُسقط العدّ لكل نطاق', () => {
  const before = `def a(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    d1()\n\ndef b():\n    return 1\n`;
  const after  = `def a(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n\ndef b():\n    return 1\n    d1()\n`;
  // لا عبارة حيّة توقّفت، والعدد الكلي ثابت ⇒ سليم بالمعيار.
  assert.strictEqual(statements(after).dead.length, statements(before).dead.length);
  assert.ok(cand5(before, after).length >= 1, 'مرشَّح 5 يرفضه — وهذا أكبر صنف إيجابياته الكاذبة');
  assert.strictEqual(cand7(before, after).length, 0, 'ومرشَّح 7 يقبله');
  assert.strictEqual(cand8(before, after).length, 0, 'ومرشَّح 8 يقبله');
});

// ═══ 4. مطابقة النموذج الأولي للإنتاج ══════════════════

test('النموذج الأولي يُحدّد الأسطر الميتة كما يُحدّدها الإنتاج', () => {
  const texts = [];
  for (const [label, [b, a]] of Object.entries(SCOPE_HARM)) texts.push([label + '/before', b], [label + '/after', a]);
  texts.push(['متبقية/before', HARMFUL[0]], ['متبقية/after', HARMFUL[1]]);
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'python_syntax_cases.json'), 'utf8'));
  for (const [label, c] of Object.entries(fx.cases)) texts.push(['fixture/' + label, c.code]);

  const diffs = [];
  for (const [label, code] of texts) {
    const prod  = Array.from(productionDead(code));
    const proto = statements(code).dead.map(d => d.masked);
    if (JSON.stringify(prod) !== JSON.stringify(proto)) diffs.push(label);
  }
  assert.deepStrictEqual(Array.from(diffs), [], 'الماسحان اختلفا، فكل مقارنة فوق لا تقيس البوابة');
});

// ═══ 5. المولّدات الحقيقية ═════════════════════════════
// السؤال العملي: هل يُنتج أيٌّ من مولّدات هذا المستودع الحالةَ المتبقية؟
// المقيس: emergencyFix وsql_injection_fix هما الوحيدان اللذان يُغيّران مدخلات
// بايثون هذه؛ وكلاهما يُلحق return بعد سطر الإصلاح، فيدفن ما تحته — وهو ضرر
// يراه العدّ مرتين. ولا واحد منهما يُعيد كتابة السطر الذي يقتله.

const GEN_INPUTS = {
  'حيّ أسفل السطر المعيب':
    'def get_user(uid):\n    q = "SELECT * FROM users WHERE id = " + uid\n    cursor = conn.cursor()\n    cursor.execute(q)\n    rows = cursor.fetchall()\n    audit("read", uid)\n    notify(rows)\n    return rows\n',
  'ميت سابق + حيّ أسفل':
    'def get_user(uid):\n    q = "SELECT * FROM users WHERE id = " + uid\n    cursor = conn.cursor()\n    cursor.execute(q)\n    rows = cursor.fetchall()\n    audit("read", uid)\n    return rows\n    legacy_cleanup()\n',
  'دالتان بالاسم نفسه':
    'def handler(uid):\n    q = "SELECT * FROM users WHERE id = " + uid\n    cursor = conn.cursor()\n    cursor.execute(q)\n    return cursor.fetchall()\n    old_path()\n\ndef handler():\n    old_path()\n    return 1\n',
  'دالة متداخلة':
    'def outer(uid):\n    def inner():\n        q = "SELECT * FROM users WHERE id = " + uid\n        cursor = conn.cursor()\n        cursor.execute(q)\n        rows = cursor.fetchall()\n        audit(rows)\n        return rows\n        dead_tail()\n    return inner()\n',
  'تابع صنف':
    'class Repo:\n    def find(self, uid):\n        q = "SELECT * FROM users WHERE id = " + uid\n        cursor = conn.cursor()\n        cursor.execute(q)\n        rows = cursor.fetchall()\n        audit(rows)\n        return rows\n',
};

const issuesOf = code => {
  try { const a = ctx.analyzeCode(code, 'app.py'); return Array.isArray(a) ? a : ((a && (a.rawIssues || a.issues)) || []); }
  catch { return []; }
};
const pick = r => (typeof r === 'string' ? r : (r && (r.fixed || r.code || r.repaired || r.output)) || null);
const GENERATORS = {
  emergencyFix: code => pick(ctx.emergencyFix(code, 'app.py')),
  fallbackFix:  code => pick(ctx.fallbackFix(code, 'app.py', issuesOf(code))),
  repairCode:   code => pick(ctx.repairCode(code, issuesOf(code), 'app.py')),
  SQLInjectionFixer: code => { try { const F = ctx.SQLInjectionFixer; return F && F.fix ? pick(F.fix(code, 'app.py', issuesOf(code))) : null; } catch { return null; } },
};

function generatorPairs() {
  const out = [];
  for (const [iname, code] of Object.entries(GEN_INPUTS)) {
    for (const [gname, gen] of Object.entries(GENERATORS)) {
      let after = null;
      try { after = gen(code); } catch { after = null; }
      if (typeof after !== 'string' || !after.trim() || after === code) continue;
      out.push([`${gname} | ${iname}`, code, after]);
    }
  }
  return out;
}

test('المولّدات الحقيقية: ناتج كل مولّد يُغيّر الكود يُرفض عند فحص الوصول', () => {
  const pairs = generatorPairs();
  assert.ok(pairs.length >= 5, `عدد الأزواج ${pairs.length} — المولّدات لم تُستدعَ كما يجب`);
  const accepted = [];
  for (const [label, before, after] of pairs) {
    if (!cand5(before, after).length) accepted.push(label);
    const v = ctx.FixVerifier.verifyFix(before, after, 'app.py', ctx.analyzeCode);
    assert.ok(!v.accepted, `${label}: البوابة قَبِلت ناتجًا يدفن كودًا حيًّا — ${v.reason}`);
    assert.match(String(v.reason), /PY_UNREACHABLE/, `${label}: الرفض جاء من مرحلة أخرى`);
  }
  assert.deepStrictEqual(Array.from(accepted), [], 'مرشَّح 5 قَبِل ناتج مولّد ضارًّا');
});

test('المولّدات الحقيقية: المولّد الذي يحذف أسطر النمط لا يُرفض بلا سبب', () => {
  // هنا يحذف المولّد الأسطر المطابقة ثم يُلحق بديلها، فلا يبقى كود ميت.
  // الحذف نفسه قد يكون تدميريًّا، لكن ذلك شأن مراحل أخرى لا فحص الوصول.
  const code = 'def get_user(uid):\n    q = "SELECT * FROM users WHERE id = " + uid\n    conn.execute(q)\n    return cursor.fetchall()\n    conn.execute("stale")\n';
  const after = pick(ctx.emergencyFix(code, 'app.py'));
  assert.strictEqual(typeof after, 'string');
  assert.notStrictEqual(after, code, 'شرط: المولّد غيّر الكود');
  assert.strictEqual(cand5(code, after).length, 0, 'مرشَّح 5 رفض ناتجًا لا يدفن شيئًا');
  assert.strictEqual(statements(after).dead.length, 0, 'شرط: لا كود ميت في الناتج');
});

// ═══ 6. المسح على ملفات حقيقية بحقيقة أرضية ════════════
// 23 تحويلًا على ملفات المكتبة القياسية، نصفها سليم ونصفها ضارّ، والحكم من
// شجرة CPython. الافتراضي 12 ملفًا (~10 ثوانٍ)؛ وPY_REACH_FULL=1 يمسح الكل.

function mutate(files, inject) {
  const out = execFileSync('python3', ['-I', MUTATOR, '7', inject ? '1' : '0', ...files],
    { encoding: 'utf8', maxBuffer: 1 << 29 });
  return JSON.parse(out);
}

function sweepFiles() {
  const all = fs.readdirSync(STD).filter(f => f.endsWith('.py')).map(f => path.join(STD, f))
    .filter(p => { try { const s = fs.statSync(p); return s.size > 4000 && s.size <= 160000; } catch { return false; } })
    .sort();
  return process.env.PY_REACH_FULL ? all : all.filter(p => fs.statSync(p).size <= 60000).slice(0, 12);
}

test('مسح واقعي: الإيجابيات والسلبيات الكاذبة لكل استراتيجية، بحقيقة أرضية',
  { skip: skipReal, timeout: 600000 }, () => {
  const files = sweepFiles();
  assert.ok(files.length >= 10, `ملفات قليلة: ${files.length}`);

  const strats = { current, cand5, cand7, cand8, cand11b };
  const err = {}; for (const k of Object.keys(strats)) err[k] = { fp: {}, fn: {} };
  let pairs = 0, blind = 0;
  const bump = (bag, mut) => { bag[mut] = (bag[mut] || 0) + 1; };

  for (const inject of [false, true]) {
    for (const r of mutate(files, inject)) {
      pairs++;
      const sb = statements(r.before).dead.length, sa = statements(r.after).dead.length;
      if (r.after_dead > r.before_dead && !(sa > sb)) blind++;
      for (const [name, fn] of Object.entries(strats)) {
        const flagged = fn(r.before, r.after).length > 0;
        if (r.harm && !flagged) bump(err[name].fn, r.mutation);
        if (!r.harm && flagged) bump(err[name].fp, r.mutation);
      }
    }
  }

  assert.ok(pairs >= 200, `أزواج قليلة: ${pairs} — المولّد صامت`);
  // الماسح يرى كل زيادة تراها الشجرة: لو انكسر هذا لصارت كل الأرقام أدناه ضجيجًا.
  assert.strictEqual(blind, 0, `الماسح لم يرَ الزيادة في ${blind} زوجًا`);

  // أصناف الخطأ ثابتة ومعروفة، وتُثبَّت هنا بالصنف لا بالعدد: العدد يتغيّر
  // بإصدار بايثون وبعدد الملفات الممسوحة.
  assert.deepStrictEqual(Object.keys(err.current.fn), [], 'التنفيذ الحالي صار يُفلت ضررًا');
  assert.deepStrictEqual(Object.keys(err.current.fp).sort(),
    ['delete_live_and_rewrite_dead', 'rewrite_dead'],
    'أصناف الإيجابي الكاذب في التنفيذ الحالي تغيّرت');

  assert.deepStrictEqual(Object.keys(err.cand5.fn).sort(),
    ['kill_across_rewrite_drop', 'kill_live_rewrite_drop_dead', 'kill_rewrite_drop_add_live'],
    'مرشَّح 5: أصناف السلبي الكاذب تغيّرت');
  assert.deepStrictEqual(Object.keys(err.cand5.fp).sort(),
    ['collide_scope_names', 'move_dead_across_scopes'],
    'مرشَّح 5: أصناف الإيجابي الكاذب تغيّرت — العدّ لكل نطاق يرفض نقل الميت');

  // مرشَّح 7: ح6 وح7 تُبطلان قاعدته الثالثة. مثبّت كي لا يُعاد اقتراحه.
  assert.deepStrictEqual(Object.keys(err.cand7.fn).sort(),
    ['kill_across_rewrite_drop', 'kill_rewrite_drop_add_live'],
    'مرشَّح 7: أصناف السلبي الكاذب تغيّرت');
  assert.deepStrictEqual(Object.keys(err.cand7.fp).sort(), ['delete_live_and_rewrite_dead'],
    'مرشَّح 7: صنف الإيجابي الكاذب تغيّر');

  assert.deepStrictEqual(Object.keys(err.cand8.fn).sort(),
    ['kill_across_rewrite_drop', 'kill_live_rewrite_drop_dead',
     'kill_rewrite_drop_add_live', 'move_across_and_drop_dead'],
    'مرشَّح 8: أصناف السلبي الكاذب تغيّرت');
  assert.deepStrictEqual(Object.keys(err.cand8.fp), [], 'مرشَّح 8 كان بلا إيجابيات كاذبة');

  // المعتمَد: لا سلبيات كاذبة إطلاقًا — وهذا شرط عدم زيادة مرور الضرر.
  assert.deepStrictEqual(Object.keys(err.cand11b.fn), [],
    'المعتمَد صار يُفلت ضررًا — هذا نقضٌ لشرط الاعتماد');
  assert.deepStrictEqual(Object.keys(err.cand11b.fp).sort(), ['delete_live_and_rewrite_dead'],
    'المعتمَد: صنف الإيجابي الكاذب الوحيد هو غير القابل للحسم');

  // وهيمنته على السلوك السابق: أصناف أخطائه مجموعة فرعية، وعددها أقلّ.
  const cls = n => new Set([...Object.keys(err[n].fp), ...Object.keys(err[n].fn)]);
  for (const c of cls('cand11b')) assert.ok(cls('current').has(c),
    `المعتمَد أحدث صنف خطأ ليس في الحالي: ${c}`);
  const total = n => Object.values(err[n].fp).reduce((a, b) => a + b, 0)
                   + Object.values(err[n].fn).reduce((a, b) => a + b, 0);
  assert.ok(total('cand11b') < total('current'),
    `المعتمَد (${total('cand11b')}) يجب أن يبقى أقلّ خطأً من الحالي (${total('current')})`);
  for (const other of ['cand5', 'cand7', 'cand8']) {
    assert.ok(total('cand11b') <= total(other),
      `المعتمَد (${total('cand11b')}) مقابل ${other} (${total(other)})`);
  }
});

// هذا الاختبار حارس تغطية: «لا تحويل بلا قياس». وكان يمسح مكتبة بايثون
// القياسية للجهاز، فعيّنته تتغيّر بتغيّر المفسّر المثبَّت. المقيس على ثلاثة:
//     3.13 ⇒ 23/23 ينجح · 3.12 ⇒ 22/23 الناقص collide_and_move يفشل · 3.11 ⇒ 23/23
// وهو ما أسقط أول تشغيل لـCI على ubuntu-latest (يوفّر 3.12). والسبب أن
// mut_collide_and_move يشترط دالتين فيهما مُنهٍ في الجسم المباشر وعبارةً بسيطة
// قبل أول مُنهٍ، والاختيار بينهما عشوائي ببذرة ثابتة على قائمة ترتيبها من
// العيّنة — فمكتبة 3.12 لا تعطي في أول 12 ملفًا موضعًا مستوفيًا.
// فصار يمسح عيّنة مثبَّتة في المستودع: 23/23 و368 زوجًا، وناتجًا متطابقًا
// بايتًا على 3.11 و3.12 و3.13. والمسح الواقعي على كود حقيقي يبقى في الاختبار
// السابق بلا مساس — ونقله إلى هذه العيّنة كان سيُفقد صنفًا (انظر README).
test('التحويلات الـ23 كلها فعّلت على العيّنة الثابتة، فلا صنف بلا قياس', { skip: skipPy, timeout: 600000 }, () => {
  const files = corpusFiles();
  // حارس: عيّنة ناقصة أو محذوفة تُفشل بوضوح بدل أن تمرّ على فراغ
  assert.ok(files.length >= 8, `عيّنة ناقصة: ${files.length} ملفًا — العقد ثمانية`);
  for (const f of files) assert.ok(fs.statSync(f).size > 1000, `ملف عيّنة ضامر: ${path.basename(f)}`);

  const seen = new Set();
  let pairs = 0;
  for (const inject of [false, true]) {
    for (const r of mutate(files, inject)) { pairs++; seen.add(r.mutation); }
  }
  assert.ok(pairs >= 200, `أزواج قليلة: ${pairs} — المولّد صامت على العيّنة`);
  const expected = [
    'change_strings', 'collide_and_move', 'collide_scope_names', 'delete_live',
    'delete_live_and_drop_dead', 'delete_live_and_rewrite_dead', 'drop_dead',
    'dup_live_after_return', 'insert_dead', 'kill_across_rewrite_drop',
    'kill_live_rewrite_drop_dead', 'kill_rewrite_drop_add_live',
    'move_across_and_drop_dead', 'move_across_scopes', 'move_after_return',
    'move_dead_across_scopes', 'move_dead_within_scope', 'rename_scopes',
    'reorder_top', 'rewrite_dead', 'swap_dead_between_scopes', 'swap_return', 'wrap_try',
  ];
  const missing = expected.filter(m => !seen.has(m));
  assert.deepStrictEqual(Array.from(missing), [], 'تحويلات لم تُفعَّل ⇒ أصنافها غير مقيسة');
});

// ═══ 8. انحدار ثابت لعائلات ح1 وح6 وح7 ═══════════════
// حالات مكتوبة بيدٍ، بلا توليد ولا عشوائية. كلٌّ منها يُسكت عبارةً كانت
// تُنفَّذ، فالمطلوب رفضها. وبجوارها نظائر سليمة تُقبل، كي لا يكون النجاح
// بـ«ارفض كل شيء».
//
// ح1: يقتل سطرًا حيًّا، ويُعيد كتابة نصّه، ويحذف ميتًا في النطاق نفسه.
// ح6: ح1 + سطر حيّ جديد يُعيد عدد الأحياء إلى ما كان ⇒ يُبطل أي قاعدة
//     تعتمد على نقص عدد الأحياء في النطاق وحده.
// ح7: القتل عبر النطاقات، مع حذف ميت من نطاق الوصول وحشو في نطاق المصدر
//     ⇒ العدد الكلي وعدد الأحياء ثابتان في الملف كلّه.

const REGRESSION_HARM = {
  'ح1 قتل + إعادة كتابة + حذف ميت في النطاق نفسه': [
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    log(a)\n    return cursor.fetchall()\n    d1()\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    log(b)\n`,
    'log(a) كانت تُنفَّذ'],
  'ح6 ح1 + سطر حيّ جديد يُعيد عدد الأحياء': [
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    log(a)\n    return cursor.fetchall()\n    d1()\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    audit("ok")\n    return cursor.fetchall()\n    log(b)\n`,
    'log(a) كانت تُنفَّذ، والعدد مُعاد بـaudit("ok")'],
  'ح7 قتل عبر النطاقات + حذف ميت من نطاق الوصول': [
    `def a(uid):\n    ${HOLE}\n    cursor.execute(q)\n    keep(1)\n    return cursor.fetchall()\n\ndef b():\n    return 1\n    d1()\n`,
    `def a(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    pad()\n    return cursor.fetchall()\n\ndef b():\n    return 1\n    keep(2)\n`,
    'keep(1) كانت تُنفَّذ في a'],
};

for (const [label, [before, after, why]] of Object.entries(REGRESSION_HARM)) {
  test(`انحدار: ضرر يجب أن يُرفض — ${label}`, () => {
    // شرط العزل: الطرفان صحيحان صياغةً، وإلا لحُكم قبل فحص الوصول.
    assert.ok(ctx.FixVerifier.syntaxCheck(before, 'r.py').ok, 'before مرفوض صياغةً');
    assert.ok(ctx.FixVerifier.syntaxCheck(after, 'r.py').ok, 'after مرفوض صياغةً');
    assert.ok(reachFlags(before, after).length >= 1, `${label}: مرحلة الوصول سكتت — ${why}`);
    const v = ctx.FixVerifier.verifyFix(before, after, 'r.py', ctx.analyzeCode);
    assert.ok(!v.accepted, `${label}: البوابة قَبِلت — ${why}`);
    assert.match(String(v.reason), /PY_UNREACHABLE/, `${label}: الرفض من مرحلة أخرى: ${v.reason}`);
  });
}

// والنظائر السليمة: تُقاس عند المرحلة لا عند البوابة، لأن بعضها لا يُسقط
// بلاغًا فترفضه البوابة بـNO_IMPROVEMENT، فلا يُعرف هل سكت فحص الوصول.
const REGRESSION_BENIGN = {
  'إعادة صياغة كود ميت وحده، بلا مساس بالحيّ': [
    `def f():\n    cfg = load()\n    return cfg\n    legacy("old")\n`,
    `def f():\n    cfg = load()\n    return cfg\n    modern("new")\n`],
  'نقل كود ميت من دالة إلى أخرى': [
    `def a():\n    return 1\n    d1()\n\ndef b():\n    return 2\n`,
    `def a():\n    return 1\n\ndef b():\n    return 2\n    d1()\n`],
  'توحيد اسمَي دالتين (تحويل مَرَضي، لا ضرر في الوصول)': [
    `def a():\n    return 1\n    d1()\n\ndef b():\n    return 2\n    d2()\n`,
    `def a():\n    return 1\n    d1()\n\ndef a():\n    return 2\n    d2()\n`],
  'تبديل محتوى نصّ حرفي داخل سطر ميت': [
    `def f():\n    return 1\n    log("x")\n`,
    `def f():\n    return 1\n    log("y")\n`],
  'حذف سطر حيّ تمامًا بلا تغيير في الميت': [
    `def f():\n    dbg()\n    cfg = load()\n    return cfg\n    d1()\n`,
    `def f():\n    cfg = load()\n    return cfg\n    d1()\n`],
  'إزالة كود ميت (تحسين)': [
    `def f():\n    return 1\n    d1()\n`,
    `def f():\n    return 1\n`],
};

for (const [label, [before, after]] of Object.entries(REGRESSION_BENIGN)) {
  test(`انحدار: سليم يجب أن تسكت عنه مرحلة الوصول — ${label}`, () => {
    assert.deepStrictEqual(Array.from(reachFlags(before, after)), [],
      `${label}: رفض إصلاحًا لا يُسكت شيئًا`);
  });
}

// ═══ 9. حتمية التوليد ══════════════════════════════════
// الأرقام في الفرع 6 لا معنى لها إن تغيّر الكوربوس بين تشغيلين. البذرة 7
// ثابتة، والمولّد يستعمل crc32 لا hash() المُبعثرة لكل عملية بايثون.

// على العيّنة الثابتة لا على مكتبة المضيف: الحتمية المقصودة هنا حتمية المولّد
// (نفس البذرة ⇒ نفس الناتج)، وقياسها على عيّنة متغيّرة يخلط الأمرين.
test('حتمية: نفس البذرة تُنتج نفس الأزواج بايتًا ببايت', { skip: skipPy, timeout: 120000 }, () => {
  const files = corpusFiles().slice(0, 4);
  assert.ok(files.length >= 2, 'ملفات قليلة للقياس');
  const run = () => execFileSync('python3', ['-I', MUTATOR, '7', '1', ...files],
    { encoding: 'utf8', maxBuffer: 1 << 29 });
  const a = run(), b = run();
  assert.strictEqual(a, b, 'التوليد غير حتمي — الأرقام غير قابلة لإعادة الإنتاج');
  assert.ok(JSON.parse(a).length >= 10, 'المولّد صامت');
});

test('حتمية: المولّد لا يستعمل hash() المُبعثرة', { skip: !fs.existsSync(MUTATOR) && 'المولّد غائب' }, () => {
  const src = fs.readFileSync(MUTATOR, 'utf8');
  assert.doesNotMatch(src, /random\.Random\([^)]*\bhash\(/,
    'hash() مُبعثرة لكل عملية؛ استعمل crc32');
  assert.match(src, /zlib\.crc32/, 'البذرة الثابتة تعتمد crc32');
});

// ═══ 7. ما لم يُقَس في هذه الجولة ══════════════════════
//   • لغات غير بايثون: لا فحص وصول في البوابة أصلًا (بند مستقل).
//   • فجوات النصوص المستمرة الأربع في pythonStructuralSyntaxCheck: بند مؤجّل.
//   • الأداء: لم يُقَس أثر الماسح على ملفات أكبر من 160 كيلوبايت.
//   • التحويلات مُولَّدة آليًّا وتُشبه ما تفعله المولّدات، لكنها ليست مولّدات
//     حقيقية؛ القياس على المولّدات الحقيقية في الفرع 5 وعدده 5 أزواج فقط،
//     لأن مولّدين فقط من أربعة يُغيّران مدخلات بايثون هذه.
//   • حقيقة "إعادة الكتابة تحفظ الهوية" إعلانٌ منّي لا استنتاج: الشجرة تحمل
//     المعرّف معها. والفرع 2 يُثبت أن النص وحده لا يحمل هذه المعلومة.
