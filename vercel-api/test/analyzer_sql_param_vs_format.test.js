// ═══════════════════════════════════════════════════════
// تمييز الاستعلام المُعامَل من الدمج النصي — عائلة ‎%s‎ في Python
// تشغيل:  node --test vercel-api/test/analyzer_sql_param_vs_format.test.js
//
// الإيجابية الكاذبة المُقاسة:
//   القاعدة الحالية نصّية بحتة — ‎/execute\s*\(\s*["'].*SELECT.*%s/‎ — فتُبلّغ
//   عن أي ‎execute("… SELECT … %s‎ بلا نظر إلى ما بعد النص. والنتيجة أن
//   الصيغة **القانونية الوحيدة** لـpsycopg2 وPyMySQL:
//       cur.execute("SELECT * FROM t WHERE id=%s", (uid,))
//   تُصنَّف ‎SQL_INJECTION‎ بنفس بلاغ الصيغة الخطِرة:
//       cur.execute("SELECT * FROM t WHERE id=%s" % uid)
//   وهذا يطال **الكود البشري السليم** في أي مشروع يستخدم هذين السائقين، لا
//   ناتج الإصلاح وحده. وقياسه: 11 حالة ⇒ 5 إيجابيات كاذبة.
//
// التمييز المطلوب، وهو قائم على دليل لا على شكل:
//   • دمج فعلي   = عاملُ التنسيق ‎%‎ يلي النصَّ المغلق ⇒ القيمة تُركَّب في SQL.
//   • معامَلة    = القيمة تُمرَّر وسيطًا منفصلًا بعد فاصلة ⇒ لا تُركَّب.
//   والحالة الحاسمة التي تُثبت أن المعيار دليلٌ لا شكل:
//       cur.execute("… id=%s" % uid, ())
//   فيها فاصلة ووسيط، ومع ذلك **الدمج واقع** ⇒ يجب أن تبقى مُبلَّغًا عنها.
//
// حدٌّ سابق لا يغيّره هذا الملف: ‎"…%(k)s" % d‎ (تنسيق بقاموس) لا يُكتشف
// أصلًا لأن ‎%(k)s‎ لا يحوي ‎%s‎ حرفيًا. مُسجَّل كسلبية كاذبة قائمة، وليس
// من نطاق هذا التمييز.
//
// ─── القاعدة بعد التعديل، وموضع هذا الشرح ──────────────
//   extended_patterns.js:101 — قُيِّد الشرط بوجود عامل التنسيق بعد النص:
//     /execute\s*\(\s*(["'])(?:(?!\1)[\s\S])*%s(?:(?!\1)[\s\S])*\1\s*%/
//   والاقتباس يُطابَق بمرجع خلفي ‎\1‎ فلا يُجاوز النصَّ إلى ما بعده.
//
// ⚠️ ولماذا الشرح هنا لا في ملف القاعدة: ‎claude_repair_rca.test.js‎ يستخدم
// ‎extended_patterns.js‎ fixture ويقيس نافذة الإصلاح بأرقام أسطر مثبَّتة
// (88–170). وأي سطر يُضاف أو يُحذف في ذلك الملف يُزيح النافذة — مقيس:
// 88–170 صارت 88–151 بتعليق داخل PY_PATTERNS، و88–156 بتعليق فوقها،
// و88–131 بتعليق بعدها. فالتعديل هناك سطرٌ واحد بلا زيادة ولا نقص، وهذه
// اقتران هشّ قائم في ذلك الاختبار يستحق معالجة مستقلة.
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
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop, createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
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
  return ctx;
}

const pyFile = (imp, body) => `${imp}\n\ndef handler(uid, x, y, d):\n    ${body}\n`;

// بلاغات حقن SQL وحدها — لا يُحتسب غيرها (مثل Dead Code).
// العائلة تُعرَّف بالعنوان وcAct لا بـtype وحده: الأشكال الثلاثة تحمل
// ‎type=py‎ و‎type=CWE_89‎ و‎type=SQL_INJECTION‎ على التوالي، وكلها cAct
// من عائلة CWE-89 / SQL_INJECTION. فالمرشّح على الأوسع، ليكون تأكيد
// «لا بلاغ» أشدّ لا أضعف.
const sqlFindings = (ctx, code, fileName) =>
  ctx.analyzeCode(code, fileName || 't.py').filter(i =>
    /sql\s*injection/i.test(String(i.title || '')) ||
    /SQL_INJECTION|CWE[-_]89/i.test(String(i.cAct || '') + '|' + String(i.type || '')));

// ─── الصيغ السليمة: معامِلات منفصلة ────────────────────
const SAFE = {
  'psycopg2 · tuple':        ['import psycopg2', 'cur.execute("SELECT * FROM t WHERE id=%s", (uid,))'],
  'psycopg2 · list':         ['import psycopg2', 'cur.execute("SELECT * FROM t WHERE id=%s", [uid])'],
  'PyMySQL · خانتان':        ['import pymysql',  'cur.execute("SELECT * FROM t WHERE a=%s AND b=%s", (x, y))'],
  'PyMySQL · مسافات':        ['import pymysql',  'cur.execute( "SELECT * FROM t WHERE id=%s" , ( uid , ) )'],
  'psycopg2 · اقتباس مفرد':  ['import psycopg2', "cur.execute('SELECT * FROM t WHERE id=%s', (uid,))"],
  'psycopg2 · ثلاثي':        ['import psycopg2', 'cur.execute("""SELECT * FROM t WHERE id=%s""", (uid,))'],
  'PyMySQL · مهروب داخلي':   ['import pymysql',  'cur.execute("SELECT * FROM t WHERE n=\\"%s\\"", (n,))'],
  'psycopg2 · فاصلة لاحقة':  ['import psycopg2', 'cur.execute("SELECT * FROM t WHERE id=%s", (uid,),)'],
  'PyMySQL · LIKE نسبة':     ['import pymysql',  'cur.execute("SELECT * FROM t WHERE n LIKE %s", ("a%",))'],
  'psycopg2 · INSERT':       ['import psycopg2', 'cur.execute("INSERT INTO t VALUES (%s)", (uid,))'],
};

// ─── الصيغ الخطِرة: دمج فعلي ───────────────────────────
const DANGEROUS = {
  'دمج · متغيّر':            ['import psycopg2', 'cur.execute("SELECT * FROM t WHERE id=%s" % uid)'],
  'دمج · tuple':             ['import pymysql',  'cur.execute("SELECT * FROM t WHERE a=%s AND b=%s" % (x, y))'],
  'دمج · مسافات':            ['import psycopg2', 'cur.execute( "SELECT * FROM t WHERE id=%s"   %   uid )'],
  'دمج · بلا مسافات':        ['import psycopg2', 'cur.execute("SELECT * FROM t WHERE id=%s"%uid)'],
  'دمج · اقتباس مفرد':       ['import psycopg2', "cur.execute('SELECT * FROM t WHERE id=%s' % uid)"],
  'دمج · ثلاثي مزدوج':       ['import psycopg2', 'cur.execute("""SELECT * FROM t WHERE id=%s""" % uid)'],
  'دمج · ثلاثي مفرد':        ['import pymysql',  "cur.execute('''SELECT * FROM t WHERE id=%s''' % uid)"],
  'دمج · مهروب داخلي':       ['import psycopg2', 'cur.execute("SELECT * FROM t WHERE n=\\"%s\\"" % n)'],
  'دمج · مفرد مهروب':        ['import pymysql',  "cur.execute('SELECT * FROM t WHERE n=\\'%s\\'' % n)"],
  'دمج · INSERT':            ['import psycopg2', 'cur.execute("INSERT INTO t VALUES (%s)" % uid)'],
  'دمج · UPDATE':            ['import pymysql',  'cur.execute("UPDATE t SET a=%s" % uid)'],
  'دمج · DELETE':            ['import psycopg2', 'cur.execute("DELETE FROM t WHERE id=%s" % uid)'],
  'دمج · حروف صغيرة':        ['import pymysql',  'cur.execute("select * from t where id=%s" % uid)'],
  'دمج ثم وسيط (حاسمة)':     ['import psycopg2', 'cur.execute("SELECT * FROM t WHERE id=%s" % uid, ())'],
};

// ─── execute لا علاقة له بـSQL: لا يُصنَّف حقنًا ─────────
// شرط كلمة SQL داخل النص هو ما يمنع ذلك. وبلا هذا الشرط تُبلَّغ كل دالة
// اسمها execute تستخدم تنسيق ‎%‎ — مقيس: ثلاث إيجابيات كاذبة.
const NON_SQL = {
  'runner.execute':  ['import psycopg2', 'runner.execute("step %s" % name)'],
  'task.execute':    ['import psycopg2', 'task.execute("hello %s" % name)'],
  'job.execute':     ['import psycopg2', 'job.execute("/tmp/%s" % name)'],
  'كلمة select جزءًا': ['import psycopg2', 'log.execute("selected %s" % name)'],
};

// ═══ 1. عزل ════════════════════════════════════════════

test('isolation: المحلّل يعمل على ملفات py ويُنتج بلاغًا على الدمج الصريح', () => {
  const ctx = loadCtx();
  const code = pyFile('import psycopg2', 'cur.execute("SELECT * FROM t WHERE id=" + uid)');
  assert.ok(sqlFindings(ctx, code).length >= 1,
    'الدمج بـ+ يُبلَّغ عنه — فالمحلّل يرى هذه العائلة أصلًا');
});

// ═══ 2. الصيغة المُعامَلة ليست حقنًا ═══════════════════

test('المُعامَلة الصحيحة لا تُصنَّف حقنًا — psycopg2 و PyMySQL', () => {
  const ctx = loadCtx();
  const flagged = [];
  for (const [lbl, [imp, body]] of Object.entries(SAFE)) {
    const found = sqlFindings(ctx, pyFile(imp, body));
    if (found.length) flagged.push(`${lbl} ⇒ ${found.map(f => String(f.title || f.cAct)).join(' | ')}`);
  }
  assert.deepStrictEqual(flagged, [],
    'لا بلاغ حقن على أي صيغة تُمرِّر المعامِلات منفصلة');
});

test('ولا يكفي وجود %s وحده لتصنيف الاستعلام حقنًا', () => {
  const ctx = loadCtx();
  // نفس النص تمامًا، والفرق كله في ما بعد النص المغلق
  const safe = pyFile('import psycopg2', 'cur.execute("SELECT * FROM t WHERE id=%s", (uid,))');
  const bad  = pyFile('import psycopg2', 'cur.execute("SELECT * FROM t WHERE id=%s" % uid)');
  assert.strictEqual(sqlFindings(ctx, safe).length, 0, 'المعامَلة: لا بلاغ');
  assert.ok(sqlFindings(ctx, bad).length >= 1, 'والدمج: بلاغ — فالفارق هو الدليل لا شكل النص');
});

// ═══ 3. الخطِر ما زال يُكتشف ═══════════════════════════

test('الدمج بـ% ما زال يُكتشف في كل صوره', () => {
  const ctx = loadCtx();
  const missed = [];
  for (const [lbl, [imp, body]] of Object.entries(DANGEROUS)) {
    if (sqlFindings(ctx, pyFile(imp, body)).length === 0) missed.push(lbl);
  }
  assert.deepStrictEqual(missed, [], 'لا صيغة دمج تمرّ بلا بلاغ');
});

test('الحالة الحاسمة: دمج واقع مع وجود وسيط بعده ⇒ يبقى مُبلَّغًا عنه', () => {
  // فيها فاصلة ووسيط، فلو كان المعيار «وجود فاصلة» لسقط البلاغ خطأً.
  const ctx = loadCtx();
  const code = pyFile('import psycopg2', 'cur.execute("SELECT * FROM t WHERE id=%s" % uid, ())');
  assert.ok(sqlFindings(ctx, code).length >= 1,
    'الدمج قبل الفاصلة يُبلَّغ عنه — المعيار دليل الدمج لا وجود وسيط');
});

test('execute غير المتعلّق بـSQL لا يُصنَّف حقنًا', () => {
  const ctx = loadCtx();
  const flagged = [];
  for (const [lbl, [imp, body]] of Object.entries(NON_SQL)) {
    const found = sqlFindings(ctx, pyFile(imp, body));
    if (found.length) flagged.push(`${lbl} ⇒ ${found.map(f => String(f.title || f.cAct)).join(' | ')}`);
  }
  assert.deepStrictEqual(flagged, [],
    'شرط كلمة SQL داخل النص يمنع تصنيف أي execute بتنسيق ‎%‎ حقنَ SQL');
});

test('النصوص الثلاثية والاقتباسات المهروبة: الدمج يُكتشف والمُعامَل لا', () => {
  // هذان الشكلان كانت القاعدة السابقة تكتشفهما، ثم فقدتهما صيغة وسيطة —
  // فيُحرسان صراحةً في الاتجاهين.
  const ctx = loadCtx();
  const bad = {
    'ثلاثي مزدوج': 'cur.execute("""SELECT * FROM t WHERE id=%s""" % uid)',
    'ثلاثي مفرد':  "cur.execute('''SELECT * FROM t WHERE id=%s''' % uid)",
    'مهروب مزدوج': 'cur.execute("SELECT * FROM t WHERE n=\\"%s\\"" % n)',
    'مهروب مفرد':  "cur.execute('SELECT * FROM t WHERE n=\\'%s\\'' % n)",
  };
  for (const [lbl, body] of Object.entries(bad)) {
    assert.ok(sqlFindings(ctx, pyFile('import psycopg2', body)).length >= 1,
      `[${lbl}] الدمج يُكتشف`);
  }
  const safe = {
    'ثلاثي + معامِلات': 'cur.execute("""SELECT * FROM t WHERE id=%s""", (uid,))',
    'مهروب + معامِلات': 'cur.execute("SELECT * FROM t WHERE n=\\"%s\\"", (n,))',
  };
  for (const [lbl, body] of Object.entries(safe)) {
    assert.strictEqual(sqlFindings(ctx, pyFile('import psycopg2', body)).length, 0,
      `[${lbl}] والمُعامَل لا يُبلَّغ عنه`);
  }
});

test('الدمج بـ+ لم يتأثر — يبقى مُكتشفًا', () => {
  const ctx = loadCtx();
  for (const body of [
    'cur.execute("SELECT * FROM t WHERE id=" + uid)',
    'cur.execute("SELECT * FROM t WHERE a=" + x + " AND b=" + y)',
  ]) {
    assert.ok(sqlFindings(ctx, pyFile('import psycopg2', body)).length >= 1,
      `الدمج بـ+ يُبلَّغ عنه: ${body}`);
  }
});

test('f-string لم يتأثر — يبقى مُكتشفًا', () => {
  const ctx = loadCtx();
  const code = pyFile('import sqlite3', 'cur.execute(f"SELECT * FROM t WHERE id={uid}")');
  assert.ok(sqlFindings(ctx, code).length >= 1, 'f-string داخل execute يبقى بلاغًا');
});

// ═══ 4. حدود مُعلَنة ═══════════════════════════════════

test('documented: ‎%(k)s‎ مع ‎%‎ لا يُكتشف — سلبية كاذبة قائمة لا يغيّرها هذا التمييز', () => {
  const ctx = loadCtx();
  const code = pyFile('import pymysql', 'cur.execute("SELECT * FROM t WHERE id=%(k)s" % d)');
  assert.strictEqual(sqlFindings(ctx, code).length, 0,
    'غير مُكتشف — ‎%(k)s‎ لا يحوي ‎%s‎ حرفيًا. حدّ مُعلَن، وتوسيعه نطاق آخر');
});

test('‎execute("…%s")‎ بلا معامِلات وبلا دمج: ليست حقنًا', () => {
  // لا قيمة تُركَّب في النص ⇒ ليست ثغرة حقن، بل خانة غير مملوءة (خطأ تشغيل).
  // والتأكيد صريح على التصنيف المطلوب، لا على «أيّ تصنيف».
  const ctx = loadCtx();
  const code = pyFile('import psycopg2', 'cur.execute("SELECT * FROM t WHERE id=%s")');
  assert.strictEqual(sqlFindings(ctx, code).length, 0,
    'لا بلاغ حقن: لا عامل تنسيق ولا دمج — القيمة غير مُركَّبة');
});

// ═══ 5. حواجز ضد الانحدار في لغات أخرى ════════════════

test('JS لم يتأثر: الدمج يُكتشف والمُعامَل لا يُبلَّغ عنه حقنًا', () => {
  const ctx = loadCtx();
  const bad  = 'const mysql = require("mysql");\nfunction q(id) {\n  db.query("SELECT * FROM u WHERE id = " + id);\n}\n';
  const safe = 'const mysql = require("mysql");\nfunction q(id) {\n  db.query("SELECT * FROM u WHERE id = ?", [id]);\n}\n';
  assert.ok(sqlFindings(ctx, bad, 'a.js').length >= 1, 'الدمج في JS يُبلَّغ عنه');
  assert.strictEqual(sqlFindings(ctx, safe, 'a.js').length, 0,
    'والمُعامَل بـ? ومصفوفة لا يُبلَّغ عنه');
});
