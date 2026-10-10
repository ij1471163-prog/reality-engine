// ═══════════════════════════════════════════════════════
// الجولة الثانية: مطابقة الكود غير القابل للوصول بين before/after
// تشغيل:  node --test vercel-api/test/verifier_py_unreachable_match.test.js
//
// هذه المرحلة اختبارات وتحليل فقط. لا يرافقها تعديل إنتاجي.
// الحالات الحمراء هنا todo بنصّ يشرح الخلل، لا شروط مُخفَّفة.
//
// معيار الحكم — معلَن قبل القياس، لا بعده:
//   يُدخل الإصلاح ضررًا في الوصول إذا توقّفت عبارة كانت تُنفَّذ عن التنفيذ.
//     (أ) ارتفاع عدد العبارات غير القابلة للوصول في نطاق ما — وكيل متحفّظ.
//     (ب) عبارة كانت قابلة للوصول قبل، وصارت غير قابلة للوصول بعد — التعريف
//         المباشر.
//   وتعديل محتوى كود ميت أصلًا ليس ضررًا: ذلك الكود لا يُنفَّذ قبل ولا بعد،
//   فرفضه يعني رفض إصلاح صحيح بسبب اختلاف شكلي.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');
const { execFileSync } = require('node:child_process');

const PUBLIC_DIR   = path.join(__dirname, '..', 'public');
const FV_SRC       = fs.readFileSync(path.join(PUBLIC_DIR, 'fix_verifier.js'), 'utf8');
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'python_syntax_cases.json');

// ═══ 0. التحميل ════════════════════════════════════════

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

// الدالة الإنتاجية معزولة من المصدر، لقياسها بلا بقية البوابة.
function loadProductionScanner() {
  const grab = re => { const m = FV_SRC.match(re); assert.ok(m, 'غير موجود: ' + re); return m[0]; };
  const sand = {};
  vm.createContext(sand);
  vm.runInContext(
    grab(/const PY_TERMINATOR[\s\S]*?function pyUnreachableAdded[\s\S]*?\n    return added;\n  }\n/) +
    '\n;DEAD = pyUnreachableStatements;', sand);
  return sand.DEAD;
}

const ctx = loadCtx();
const productionDead = loadProductionScanner();

// ═══ 1. ماسح النموذج الأولي ════════════════════════════
// نسخة من ماسح الإنتاج تُرجع لكل عبارة منطقية موضعها (النطاق والإزاحة) وحالة
// وصولها، لا نصّها وحده. الفرع 2 يُثبت أنها توافق الإنتاج في تحديد الميت،
// فأي فرق في الأحكام أدناه يأتي من استراتيجية المطابقة لا من الماسح.

const PY_TERM = /^(?:return|raise|break|continue)\b|^(?:sys\.exit|os\._exit)\s*\(/;
const PY_BR   = /^(?:elif|else|except|finally|case)\b/;
const PY_HEAD = /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/;

function statements(code) {
  const lines = String(code).replace(/\r\n?/g, '\n').split('\n');
  const termAt = new Map(); const out = []; const scopes = new Set(['<module>']);
  let triple = null, depth = 0, cont = false; const stack = [];

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

    const wasCont = cont;
    for (const c of clean) {
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
    }
    cont = depth > 0 || /\\$/.test(raw.replace(/\s+$/, ''));

    const stmt = clean.trim();
    if (!stmt || startedInTriple || wasCont) continue;

    const indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
    for (const level of Array.from(termAt.keys())) if (level > indent) termAt.delete(level);

    const scope = stack.map(x => x.name).join('>') || '<module>';
    const dead  = !!(termAt.get(indent) && !PY_BR.test(stmt));
    out.push({ masked: stmt, raw: raw.trim(), indent, scope, dead });

    const h = PY_HEAD.exec(stmt);
    if (h) { stack.push({ name: h[1], indent }); scopes.add(stack.map(x => x.name).join('>')); }
    if (PY_TERM.test(stmt)) termAt.set(indent, true);
    if (PY_BR.test(stmt)) termAt.delete(indent);
  }
  return { all: out, dead: out.filter(x => x.dead), scopes };
}

// ═══ 2. الاستراتيجيات الخمس ════════════════════════════

// multiset على مفتاح: ما لا يجد رصيدًا في before يُحسب ضررًا مُضافًا.
const byKey = key => (b, a) => {
  const budget = new Map();
  for (const d of statements(b).dead) { const k = key(d); budget.set(k, (budget.get(k) || 0) + 1); }
  const out = [];
  for (const d of statements(a).dead) {
    const k = key(d), n = budget.get(k) || 0;
    if (n > 0) budget.set(k, n - 1); else out.push(d.raw);
  }
  return out;
};

// (4) عدّ لكل مسار نطاق، مع احتياطي عام للنطاقات الغائبة عن before — وهي
//     النطاقات التي أُعيدت تسميتها أو أُنشئت، فلا رصيد لها باسمها.
function cand4(b, a) {
  const B = statements(b), A = statements(a);
  const budget = new Map(); let total = 0;
  for (const d of B.dead) { budget.set(d.scope, (budget.get(d.scope) || 0) + 1); total++; }
  const out = [];
  for (const d of A.dead) {
    const n = budget.get(d.scope) || 0;
    if (n > 0) { budget.set(d.scope, n - 1); total--; continue; }
    if (!B.scopes.has(d.scope) && total > 0) { total--; continue; }
    out.push(d.raw);
  }
  return out;
}

// (5) مرشَّح 4 + القاعدة المباشرة: عبارة كانت تُنفَّذ وصارت لا تُنفَّذ.
//     المطابقة بالنص الخام على الملف كله، لا بالنطاق، لتبقى صامدة أمام
//     إعادة تسمية الدالة الحاوية.
function cand5(b, a) {
  const B = statements(b), A = statements(a);
  const out = cand4(b, a).slice();
  const liveBefore = new Set(B.all.filter(x => !x.dead).map(x => x.raw));
  const deadBefore = new Set(B.dead.map(x => x.raw));
  for (const d of A.dead) {
    if (liveBefore.has(d.raw) && !deadBefore.has(d.raw) && !out.includes(d.raw)) out.push(d.raw);
  }
  return out;
}

const STRATS = {
  cand11b:     require('./helpers/py_reach_strategies.js').cand11b,
  S1_current:  byKey(d => d.masked),                                      // التنفيذ الحالي
  S2_proposed: byKey(d => d.scope + '\u0000' + d.indent + '\u0000' + d.raw), // المفتاح المقترح
  S3_scope:    byKey(d => d.scope),
  S4_fallback: cand4,
  S5_killed:   cand5,
};

// ═══ 3. الكوربوس ═══════════════════════════════════════
// حامل التحسين: ثغرة SQL يُسقطها الإصلاح. بدونه يُرفض كل زوج بـ
// NO_IMPROVEMENT قبل أن يصل فحص الوصول، فلا يقيس الاختبار ما يدّعي قياسه.

const HOLE  = 'q = "SELECT * FROM t WHERE id = " + uid';
const FIXED = 'q = "SELECT * FROM t WHERE id = ?"';

// [verdict, why, before, after]
const CASES = {
  // ── عائلة 1: نقل الكود غير القابل للوصول من دالة إلى أخرى ──
  'A نقل الميت بين دالتين': ['REJECT', 'ب: cleanup() كانت تُنفَّذ في b',
    `def a(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    cleanup()\n\ndef b():\n    cleanup()\n    return 2\n`,
    `def a(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    cleanup()\n    return cursor.fetchall()\n\ndef b():\n    return 2\n    cleanup()\n`],
  'R نقل الميت من دالة إلى مستوى الوحدة': ['ACCEPT', 'بالمعيار الصريح: الميت كان ميتًا، ولا عبارة حيّة توقّفت، والعدد الكلي ثابت',
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    log("dead")\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n\nraise SystemExit\nlog("dead")\n`],
  'S نقل الميت من دالة متداخلة إلى الأم': ['ACCEPT', 'بالمعيار الصريح: لا عبارة حيّة توقّفت، والعدد الكلي ثابت',
    `def outer(uid):\n    def helper():\n        ${HOLE}\n        cursor.execute(q)\n        return q\n        trace()\n    return helper()\n`,
    `def outer(uid):\n    def helper():\n        ${FIXED}\n        cursor.execute(q, (uid,))\n        return q\n    return helper()\n    trace()\n`],

  // ── عائلة 2: تغيير محتوى النصوص الحرفية مع تشابه شكل السطر ──
  'B تصادم نصوص بين دالتين': ['REJECT', 'ب: log("xyz") كانت تُنفَّذ في b',
    `def a(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    log("abc")\n\ndef b():\n    log("xyz")\n    return 2\n`,
    `def a(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n\ndef b():\n    return 2\n    log("xyz")\n`],
  'M تبديل نص حرفي داخل ميت سابق': ['ACCEPT', 'الميت بقي ميتًا، ولا عبارة حيّة توقّفت',
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    log("x")\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    log("y")\n`],
  'Z تبديل الميت على مستوى الوحدة': ['ACCEPT', 'نفس عائلة M، على <module>',
    `${HOLE}\ncursor.execute(q)\nraise SystemExit\np()\n`,
    `${FIXED}\ncursor.execute(q, (uid,))\nraise SystemExit\nr()\n`],

  // ── عائلة 3: نقل الضرر مع بقاء العدد نفسه ──
  'C نقل بنفس الإزاحة والنص': ['REJECT', 'ب: x = 2 كانت تُنفَّذ في b',
    `def a(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    x = 2\n\ndef b():\n    x = 2\n    return 3\n`,
    `def a(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    x = 2\n    return cursor.fetchall()\n\ndef b():\n    return 3\n    x = 2\n`],
  'N تبادل ميت بين دالتين فيهما ميت': ['ACCEPT', 'العدد ثابت لكل نطاق، ولا عبارة حيّة قُتلت',
    `def a(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    p()\n\ndef b():\n    return 1\n    r()\n`,
    `def a(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    r()\n\ndef b():\n    return 1\n    p()\n`],
  'N2 قتل سطر حيّ مع حذف ميت سابق': ['REJECT', 'ب: log("important") كانت تُنفَّذ، والعدد لم يتغيّر',
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    log("important")\n    return cursor.fetchall()\n    dead1()\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    log("important")\n`],
  'N3 قتل سطر حيّ داخل دالة أُعيدت تسميتها': ['REJECT', 'ب: نفس N2 مع تغيّر اسم الدالة',
    `def oldName(uid):\n    ${HOLE}\n    cursor.execute(q)\n    log("important")\n    return cursor.fetchall()\n    dead1()\n`,
    `def newName(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    log("important")\n`],

  // ── عائلة 4: تغيير بنية الكتل ومستويات التداخل ──
  'D لفّ في try مع ميت سابق باقٍ': ['ACCEPT', 'تغيّر الإزاحة والكتلة لا يُنشئ ضررًا',
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    log("dead")\n`,
    `def f(uid):\n    try:\n        ${FIXED}\n        cursor.execute(q, (uid,))\n        return cursor.fetchall()\n        log("dead")\n    except Exception:\n        return None\n`],
  'T ميت جديد داخل تابع صنف': ['REJECT', 'أ: عدّ A>m ارتفع 0→1',
    `class A:\n    def m(self, uid):\n        ${HOLE}\n        cursor.execute(q)\n        return cursor.fetchall()\n`,
    `class A:\n    def m(self, uid):\n        ${FIXED}\n        cursor.execute(q, (uid,))\n        return cursor.fetchall()\n        oops()\n`],
  'U ميت سابق في تابع صنف يبقى كما هو': ['ACCEPT', 'لا تغيّر في الوصول',
    `class A:\n    def m(self, uid):\n        ${HOLE}\n        cursor.execute(q)\n        return cursor.fetchall()\n        log("dead")\n`,
    `class A:\n    def m(self, uid):\n        ${FIXED}\n        cursor.execute(q, (uid,))\n        return cursor.fetchall()\n        log("dead")\n`],

  // ── عائلة 5: دوال متداخلة تحمل الاسم نفسه ──
  'E دوال متداخلة بنفس الاسم': ['REJECT', 'ب: trace() كانت تُنفَّذ في outer2>helper',
    `def outer1(uid):\n    def helper():\n        ${HOLE}\n        cursor.execute(q)\n        return q\n        trace()\n    return helper()\n\ndef outer2():\n    def helper():\n        trace()\n        return 1\n    return helper()\n`,
    `def outer1(uid):\n    def helper():\n        ${FIXED}\n        cursor.execute(q, (uid,))\n        trace()\n        return q\n    return helper()\n\ndef outer2():\n    def helper():\n        return 1\n        trace()\n    return helper()\n`],

  // ── عائلة 6: إعادة ترتيب الأسطر وإعادة التسمية — يجب ألا تُرفض ──
  'F1 إعادة تسمية متغيّر في سطر ميت سابق': ['ACCEPT', 'اختلاف شكلي داخل كود ميت',
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    log(old_name)\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    log(new_name)\n`],
  'F2 إعادة ترتيب أسطر حيّة': ['ACCEPT', 'الترتيب بين الأحياء لا يقتل أحدًا',
    `def f(uid):\n    a = 1\n    b = 2\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    log("dead")\n`,
    `def f(uid):\n    b = 2\n    a = 1\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    log("dead")\n`],
  'K إعادة تسمية الدالة مع ميت سابق': ['ACCEPT', 'اسم النطاق تغيّر، والضرر لم يتغيّر',
    `def oldName(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    log("dead")\n`,
    `def newName(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    log("dead")\n`],
  'L نقل دالة كاملة مع ميت سابق': ['ACCEPT', 'ترتيب الدوال لا يُنشئ ضررًا',
    `def a(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    log("dead")\n\ndef b():\n    return 1\n`,
    `def b():\n    return 1\n\ndef a(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    log("dead")\n`],
  'V إعادة تسمية الصنف مع ميت سابق': ['ACCEPT', 'نفس K على مستوى الصنف',
    `class Old:\n    def m(self, uid):\n        ${HOLE}\n        cursor.execute(q)\n        return cursor.fetchall()\n        log("dead")\n`,
    `class New:\n    def m(self, uid):\n        ${FIXED}\n        cursor.execute(q, (uid,))\n        return cursor.fetchall()\n        log("dead")\n`],
  'W تسمية دالتين وميتان يبقيان': ['ACCEPT', 'نطاقان جديدان، والعدد الكلي ثابت',
    `def a1(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    p()\n\ndef b1():\n    return 1\n    r()\n`,
    `def a2(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    p()\n\ndef b2():\n    return 1\n    r()\n`],
  'X إعادة تسمية + تبديل الميت بنفس العدد': ['ACCEPT', 'عائلة M مع تغيّر اسم النطاق',
    `def oldName(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    log("dead")\n`,
    `def newName(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    oops()\n`],
  'N6 حذف سطر حيّ تمامًا (لا ميت)': ['ACCEPT', 'الحذف ليس قتلًا بالوصول',
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    log("debug")\n    return cursor.fetchall()\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n`],

  // ── مراجع ──
  'G إصلاح سليم بلا ميت': ['ACCEPT', 'المرجع الأخضر',
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n`],
  'H يزرع ميتًا جديدًا (قَولَبة)': ['REJECT', 'ب: return other(q) كانت تُنفَّذ',
    `def f(uid):\n    ${HOLE}\n    return other(q)\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    return other(q)\n`],
  'I إزالة ميت سابق': ['ACCEPT', 'تحسين',
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    log("dead")\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n`],
  'J ميت سابق تضاعف': ['REJECT', 'أ: عدّ f ارتفع 1→2',
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    log("dead")\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    log("dead")\n    log("dead")\n`],
  'O دالة جديدة فيها ميت + ميت سابق باقٍ': ['REJECT', 'أ: العدد الكلي ارتفع',
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    log("dead")\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    log("dead")\n\ndef brandNew():\n    return 1\n    oops()\n`],
  'P دالة جديدة فيها ميت بلا ميت سابق': ['REJECT', 'أ: العدد الكلي 0→1',
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n\ndef brandNew():\n    return 1\n    oops()\n`],
  'Q إعادة تسمية + ميت إضافي': ['REJECT', 'أ: عدّ النطاق المُعاد تسميته 1→2',
    `def oldName(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n    log("dead")\n`,
    `def newName(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    log("dead")\n    oops()\n`],
};

// الحالات التي يخطئ فيها التنفيذ الحالي اليوم — مقيسة لا مفترضة.
// بعد اعتماد قواعد الوصول الأربع بقيت ثلاث حالات حمراء، وهي ثمن القاعدة
// (هـ): الشكل الذي ترفضه فيها لا يُفرَّق نصًّا عن شكل ضارّ. لا تُحذف ولا
// يُعاد تصنيفها: هي حدٌّ معلن مقيس، لا هدف مؤجَّل.
const CURRENTLY_WRONG = new Set(['Z', 'F1', 'X']);
const tag = label => label.split(' ')[0];

// ═══ 4. أمانة القياس: شروط العزل ═══════════════════════
// لو رُفض أحد الأطراف صياغةً، أو لو لم يُسقط الإصلاح بلاغًا، لحُكم على الزوج
// قبل فحص الوصول، وصار الاختبار يقيس مرحلة أخرى.

test('عزل: طرفا كل زوج صحيحان صياغةً عند الفاحص نفسه', () => {
  for (const [label, [, , before, after]] of Object.entries(CASES)) {
    assert.ok(ctx.FixVerifier.syntaxCheck(before, 'r.py').ok, `${label}: before مرفوض صياغةً`);
    assert.ok(ctx.FixVerifier.syntaxCheck(after, 'r.py').ok, `${label}: after مرفوض صياغةً`);
  }
});

test('عزل: كل رفض في الكوربوس يأتي من فحص الوصول، لا من مرحلة أخرى', () => {
  const other = [];
  for (const [label, [, , before, after]] of Object.entries(CASES)) {
    const v = ctx.FixVerifier.verifyFix(before, after, 'r.py', ctx.analyzeCode);
    if (!v.accepted && !/PY_UNREACHABLE/.test(String(v.reason))) other.push(`${label}: ${v.reason}`);
  }
  assert.deepStrictEqual(Array.from(other), [], 'رفض من مرحلة غير فحص الوصول يُفقد الكوربوس معناه');
});

test('عزل: حامل التحسين يعمل — المرجع الأخضر يُقبل فعلًا', () => {
  const [, , before, after] = CASES['G إصلاح سليم بلا ميت'];
  const v = ctx.FixVerifier.verifyFix(before, after, 'r.py', ctx.analyzeCode);
  assert.ok(v.accepted, 'لو رُفض المرجع الأخضر لكان الحامل لا الفحص هو سبب كل رفض: ' + v.reason);
});

// ═══ 5. سلوك البوابة الحقيقي على الكوربوس ══════════════
// عبر verifyFix الفعلي، لا عبر نموذج أولي.

for (const [label, [verdict, why, before, after]] of Object.entries(CASES)) {
  const broken = CURRENTLY_WRONG.has(tag(label));
  const opts = broken
    ? { todo: `خلل مُثبت في pyUnreachableAdded (المفتاح نص السطر على الملف كله). الحكم الصحيح ${verdict} — ${why}. بانتظار الموافقة على التعديل الإنتاجي` }
    : {};
  test(`البوابة: ${label} ⇒ ${verdict}`, opts, () => {
    const v = ctx.FixVerifier.verifyFix(before, after, 'r.py', ctx.analyzeCode);
    const got = v.accepted ? 'ACCEPT' : 'REJECT';
    assert.strictEqual(got, verdict, `${label} (${why}) — السبب: ${v.reason}`);
  });
}

// ═══ 6. مطابقة النموذج الأولي للإنتاج ══════════════════
// بدون هذا الفرع، مقارنة الاستراتيجيات أدناه تقيس ماسحًا آخر لا ماسح البوابة.

test('النموذج الأولي يُحدّد الأسطر الميتة كما يُحدّدها الإنتاج', () => {
  const texts = [];
  for (const [label, [, , b, a]] of Object.entries(CASES)) texts.push([label + '/before', b], [label + '/after', a]);
  const fx = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  for (const [label, c] of Object.entries(fx.cases)) texts.push(['fixture/' + label, c.code]);

  const diffs = [];
  for (const [label, code] of texts) {
    const prod  = Array.from(productionDead(code));
    const proto = statements(code).dead.map(d => d.masked);
    if (JSON.stringify(prod) !== JSON.stringify(proto)) diffs.push(label);
  }
  assert.deepStrictEqual(Array.from(diffs), [], 'الماسحان اختلفا، فالمقارنة أدناه لا تقيس البوابة');
  assert.ok(texts.length >= 90, `عدد النصوص المقيسة ${texts.length}`);
});

test('سلامة أساسية: التطابق التام (قبل == بعد) لا يُنتج ضررًا في أي استراتيجية', () => {
  const fx = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  for (const [name, strat] of Object.entries(STRATS)) {
    for (const [label, c] of Object.entries(fx.cases)) {
      assert.strictEqual(strat(c.code, c.code).length, 0, `${name} رفض ملفًا لم يتغيّر: ${label}`);
    }
  }
});

// ═══ 7. سجل قرار: أي استراتيجية مطابقة؟ ════════════════
// المفتاح (ترويسة الدالة + الإزاحة + النص الخام) **مُستبعَد بالقياس**: هو
// أسوأ الخمس على كود حقيقي. مثبّت هنا كي لا يُعاد اقتراحه بلا دليل.

const EXPECTED_WRONG = {
  S1_current:  ['A', 'B', 'Z', 'C', 'E', 'F1', 'X'],
  S2_proposed: ['R', 'S', 'M', 'Z', 'N', 'D', 'F1', 'K', 'V', 'W', 'X'],
  S3_scope:    ['R', 'S', 'N2', 'K', 'V', 'W', 'X'],
  S4_fallback: ['R', 'S', 'N2', 'N3'],
  S5_killed:   ['R', 'S'],
  cand11b:     ['Z', 'F1', 'X'],
};

function wrongSet(strat) {
  const out = [];
  for (const [label, [verdict, , b, a]] of Object.entries(CASES)) {
    const got = strat(b, a).length ? 'REJECT' : 'ACCEPT';
    if (got !== verdict) out.push(tag(label));
  }
  return out;
}

for (const [name, expected] of Object.entries(EXPECTED_WRONG)) {
  test(`سجل قرار: ${name} يخطئ في ${expected.length} من ${Object.keys(CASES).length}`, () => {
    const got = wrongSet(STRATS[name]);
    assert.deepStrictEqual(Array.from(got).sort(), Array.from(expected).sort(),
      `${name}: مجموعة الأخطاء تغيّرت عمّا قِيس`);
  });
}

test('سجل قرار: البوابة تحكم كما تحكم الاستراتيجية المعتمدة', () => {
  // S1 سلوك سابق محفوظ للمقارنة التاريخية. والبوابة الآن تطابق المعتمَد.
  const adopted = require('./helpers/py_reach_strategies.js').cand11b;
  for (const [label, [, , b, a]] of Object.entries(CASES)) {
    const live  = ctx.FixVerifier.verifyFix(b, a, 'r.py', ctx.analyzeCode).accepted ? 'ACCEPT' : 'REJECT';
    const proto = adopted(b, a).length ? 'REJECT' : 'ACCEPT';
    assert.strictEqual(proto, live, `${label}: النموذج الأولي خالف البوابة`);
  }
});

test('سجل قرار: المفتاح المقترح أسوأ من الحالي، لا أفضل', () => {
  assert.ok(wrongSet(STRATS.S2_proposed).length >= wrongSet(STRATS.S1_current).length,
    'لو صار المقترح أفضل على هذا الكوربوس فأعِد النظر في الاستبعاد');
});

// ═══ 8. مسح إيجابيات كاذبة على كود بايثون حقيقي ════════
// 43 حالة من كوربوس CPython، يُحقَن فيها سطر ميت، ثم تُطبَّق تحويلات لا تقتل
// أي سطر حيّ: إعادة تسمية، تغيير محتوى النصوص، عكس ترتيب الكتل، تبديل نص
// الميت، إزالة الميت. كل زوج يُقاس فقط إن حكم CPython بصحة الطرفين.

function cpythonJudge(texts) {
  const src = 'import ast,json,sys\nd=json.load(sys.stdin)\nout={}\nfor k,v in d.items():\n'
            + '    try:\n        ast.parse(v); out[k]=True\n    except SyntaxError:\n        out[k]=False\n'
            + 'print(json.dumps(out))\n';
  return JSON.parse(execFileSync('python3', ['-I', '-c', src], { input: JSON.stringify(texts), encoding: 'utf8' }));
}
function havePython() {
  try { execFileSync('python3', ['-I', '-c', 'pass'], { stdio: 'ignore' }); return true; } catch { return false; }
}

const SAFE_TRANSFORMS = {
  T1_rename_defs:  c => c.replace(/\b(def|class)\s+([A-Za-z_]\w*)/g, (m, k, n) => `${k} ${n}_v2`),
  T3_string_body:  c => c.replace(/(['"])((?:(?!\1)[^\\\n])*)\1/g, (m, q, body) => q + 'X'.repeat(body.length) + q),
  T4_reverse:      c => {
    const blocks = []; let cur = [];
    for (const l of c.split('\n')) {
      if (/^\S/.test(l) && cur.length && /^(def|class|@)/.test(l)) { blocks.push(cur); cur = [l]; }
      else cur.push(l);
    }
    if (cur.length) blocks.push(cur);
    return blocks.reverse().map(b => b.join('\n')).join('\n');
  },
  T8_dead_text:    c => c.replace(/leftover\("tail"\)/, 'leftover("other")'),
  T9_drop_dead:    c => c.replace(/\n\s*leftover\("tail"\)/, ''),
};

function injectedCorpus() {
  const fx = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  const out = [];
  for (const [label, c] of Object.entries(fx.cases)) {
    if (!c.valid) continue;
    const lines = c.code.split('\n');
    const i = lines.findIndex(l => /^\s+return\b/.test(l));
    if (i < 0) continue;
    const indent = lines[i].match(/^\s*/)[0];
    const inj = lines.slice();
    inj.splice(i + 1, 0, `${indent}leftover("tail")`);
    out.push([label, inj.join('\n')]);
  }
  return out;
}

test('مسح: إيجابيات كاذبة على تحويلات لا تقتل سطرًا حيًّا', { skip: havePython() ? false : 'python3 غير متاح' }, () => {
  const corpus = injectedCorpus();
  assert.ok(corpus.length >= 40, `الكوربوس المُحقون صغير: ${corpus.length}`);

  const pairs = [], texts = {};
  for (const [label, code] of corpus) {
    for (const [tn, t] of Object.entries(SAFE_TRANSFORMS)) {
      let after; try { after = t(code); } catch { continue; }
      if (after == null || after === code) continue;
      const id = `${tn}/${label}`;
      pairs.push([id, code, after]); texts[id + '|b'] = code; texts[id + '|a'] = after;
    }
  }
  const judged = cpythonJudge(texts);
  const measured = pairs.filter(([id]) => judged[id + '|b'] && judged[id + '|a']);
  assert.ok(measured.length >= 150, `أزواج صالحة قليلة: ${measured.length}`);

  const fp = {};
  for (const name of Object.keys(STRATS)) {
    fp[name] = measured.filter(([, b, a]) => STRATS[name](b, a).length).map(([id]) => id);
  }
  // الحقيقة المقيسة، لا الطموح: الحالي والمقترح يرفضان كثيرًا من الصحيح.
  assert.ok(fp.S1_current.length  >= 40,  `الحالي: ${fp.S1_current.length} إيجابي كاذب`);
  assert.ok(fp.S2_proposed.length >= 120, `المقترح: ${fp.S2_proposed.length} إيجابي كاذب`);
  assert.ok(fp.S2_proposed.length > fp.S1_current.length, 'المقترح يجب أن يبقى أسوأ من الحالي');
  assert.deepStrictEqual(Array.from(fp.S4_fallback), [], 'مرشَّح 4 أنتج إيجابيًا كاذبًا');
  assert.deepStrictEqual(Array.from(fp.S5_killed),   [], 'مرشَّح 5 أنتج إيجابيًا كاذبًا');
});

// ═══ 9. مسح سلبيات كاذبة ═══════════════════════════════
// تحويلات تُسكت سطرًا كان يُنفَّذ، أو تُلحق سطرًا جديدًا بعد return.

const HARMFUL_TRANSFORMS = {
  H2_dup_after_return: code => {
    const ls = code.split('\n');
    const r = ls.findIndex(l => /^\s+return\b/.test(l)); if (r < 1) return null;
    const ind = ls[r].match(/^\s*/)[0];
    const v = findSimpleLive(ls, r, ind); if (v < 0) return null;
    const out = ls.slice(); out.splice(r + 1, 0, ls[v]); return out.join('\n');
  },
  H3_swap_with_return: code => {
    const ls = code.split('\n');
    const r = ls.findIndex(l => /^\s+return\b/.test(l)); if (r < 1) return null;
    const ind = ls[r].match(/^\s*/)[0];
    const v = findSimpleLive(ls, r, ind); if (v < 0) return null;
    const out = ls.slice(); const t = out[v]; out[v] = out[r]; out[r] = t; return out.join('\n');
  },
  H4_template_after_return: code => {
    const ls = code.split('\n');
    const r = ls.findIndex(l => /^\s+return\b/.test(l)); if (r < 0) return null;
    const ind = ls[r].match(/^\s*/)[0];
    const out = ls.slice(); out.splice(r + 1, 0, `${ind}cursor.execute(q, (uid,))`); return out.join('\n');
  },
};

function findSimpleLive(ls, r, ind) {
  for (let i = r - 1; i >= 0; i--) {
    const l = ls[i];
    if (!l.startsWith(ind) || l.length <= ind.length) continue;
    const body = l.slice(ind.length);
    if (/^\s/.test(body) || /\\$/.test(l) || /['"]{3}/.test(l)) continue;
    if (/^[a-z_][\w.]*\s*[=(]/.test(body)) return i;
  }
  return -1;
}

test('مسح: سلبيات كاذبة على تحويلات تُسكت سطرًا كان يُنفَّذ', { skip: havePython() ? false : 'python3 غير متاح' }, () => {
  const fx = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  const pairs = [], texts = {};
  for (const [label, c] of Object.entries(fx.cases)) {
    if (!c.valid) continue;
    for (const [hn, h] of Object.entries(HARMFUL_TRANSFORMS)) {
      let after; try { after = h(c.code); } catch { continue; }
      if (after == null || after === c.code) continue;
      const id = `${hn}/${label}`;
      pairs.push([id, c.code, after]); texts[id + '|b'] = c.code; texts[id + '|a'] = after;
    }
  }
  const judged = cpythonJudge(texts);
  const measured = pairs.filter(([id]) => judged[id + '|b'] && judged[id + '|a']);
  assert.ok(measured.length >= 40, `أزواج ضارّة قليلة: ${measured.length}`);

  for (const name of Object.keys(STRATS)) {
    const missed = measured.filter(([, b, a]) => !STRATS[name](b, a).length).map(([id]) => id);
    assert.deepStrictEqual(Array.from(missed), [], `${name} لم يرَ ضررًا في: ${missed.slice(0, 3)}`);
  }
});

// ═══ 10. حدود مرشَّح 5 — موثّقة لا مُدّعى غيابها ═══════
// هذه ليست أهدافًا مؤجّلة بل ثمن مُعلَن. وأول حالة منها يراها التنفيذ الحالي
// ولا يراها مرشَّح 5: الكسب ليس احتواءً تامًّا، بل 43 إيجابيًا كاذبًا مقابل
// حالة واحدة مُركَّبة.

const CAND5_LIMITS = {
  'قتل سطر حيّ مع تغيّر نصه وحذف ميت سابق في النطاق نفسه': [
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    log(a)\n    return cursor.fetchall()\n    d()\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    log(b)\n`,
    'العدد ثابت (1→1) والنص تغيّر، فلا القاعدة (أ) ولا (ب) تراه. التمييز بين حذف سطر وقتله يحتاج محاذاة أسطر (diff) لا مقارنة multiset'],
  'كود بعد while True بلا break': [
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    while True:\n        pass\n    unreachable()\n`,
    'حدّ موروث من الماسح نفسه: لا يحلّل القيم. موثّق في fix_verifier.js'],
  'عبارتان على سطر واحد بفاصلة منقوطة': [
    `def f(uid):\n    ${HOLE}\n    cursor.execute(q)\n    return cursor.fetchall()\n`,
    `def f(uid):\n    ${FIXED}\n    cursor.execute(q, (uid,))\n    return cursor.fetchall(); dead()\n`,
    'حدّ موروث من الماسح: وحدة الفحص سطر منطقي لا عبارة. موثّق في fix_verifier.js'],
};

for (const [label, [before, after, why]] of Object.entries(CAND5_LIMITS)) {
  test(`حدّ معلن لمرشَّح 5: ${label}`, () => {
    assert.strictEqual(cand5(before, after).length, 0, `${label}: صار مرشَّح 5 يرى هذه الحالة — حدِّث الحدود`);
    // ويُسجَّل أيضًا ما يراه التنفيذ الحالي، كي يظهر الثمن صريحًا.
  });
}

test('حدّ معلن: الحالة الوحيدة التي يراها الحالي ولا يراها مرشَّح 5', () => {
  const [before, after] = CAND5_LIMITS['قتل سطر حيّ مع تغيّر نصه وحذف ميت سابق في النطاق نفسه'];
  assert.ok(STRATS.S1_current(before, after).length >= 1, 'كان الحالي يرى هذه الحالة');
  assert.strictEqual(cand5(before, after).length, 0, 'ومرشَّح 5 لا يراها — هذا هو ثمن إزالة الإيجابيات الكاذبة');
});

test('حدّ معلن: النطاق يُعرَف باسم def/class، فالدوال المتكرّرة الاسم تندمج', () => {
  const code = 'def f():\n    return 1\n    p()\n\ndef f():\n    return 2\n    r()\n';
  const scopes = statements(code).dead.map(d => d.scope);
  assert.deepStrictEqual(Array.from(scopes), ['f', 'f'], 'الدالتان المتكرّرتان الاسم نطاق واحد في العدّ');
});

// ═══ 11. ما لم يُختبر في هذه الجولة ════════════════════
//   • JS/TS: لا فحص وصول أصلًا في البوابة. acorn مُحمَّل وهو الأداة الصحيحة.
//     بند مستقل مسجّل، خارج نطاق هذه الجولة.
//   • الفجوات الأربع في النصوص المستمرة داخل pythonStructuralSyntaxCheck:
//     بند مستقل، مؤجّل بقرار صريح.
//   • اختلاف السياسة بين FixVerifier و fixers_orchestrator._verifyFix: مسجّل.
//   • المولّدات (emergency_fixes.js، fallback_fixes.js، sql_injection_fix.js):
//     لم تُلمَس. هذه الجولة تخصّ البوابة وحدها.
//   • الأداء: لم يُقَس أثر الماسح على ملفات كبيرة.
//   • التغطية هنا 29 زوجًا مكتوبًا + 173 زوجًا مُولَّدًا آمنًا + 49 زوجًا ضارًّا.
//     كلها بايثون صناعي قصير؛ لم يُجرَّب على مستودع بايثون حقيقي كبير.
