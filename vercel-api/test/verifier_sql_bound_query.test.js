// ═══════════════════════════════════════════════════════
// fix_verifier.js — إثبات parameterization مربوط بالاستعلام ومعاملاته
// تشغيل:  node --test vercel-api/test/verifier_sql_bound_query.test.js
//
// D1-GATE-SHAPE. حارس SQL في البوابة يشترط إثبات parameterization قبل قبول
// اختفاء إشارة SQL من المحلل. إثباته للـJS ثلاثة بدائل نصّية:
//     /\?\s*["'`]\s*,\s*\[[\s\S]*\]/   ← يشترط أن يلي اقتباسَ نهاية الاستعلام
//                                        ", [" مباشرة، أي الاستعلام داخل الاستدعاء
//     /\$\d+/                          ← أي $1 في أي مكان من الملف
//     /\bparams?\s*[,)]/               ← أي معرّف اسمه param/params
//
// والمقيس أن هذا فحص شكل لا إثبات ربط، فهو خاطئ في الاتجاهين:
//
//   أ) يرفض الشكل الصحيح الوحيد الذي يُنتجه SmartRepair — الاستعلام في
//      متغيّر ثم db.query(q, [params]). ومُثبَت أن الرفض سببه الشكل لا نقص
//      الربط: نفس الربط حرفيًا، بنقل نص الاستعلام داخل الاستدعاء، يُقبل.
//      وكل المراحل السابقة خضراء: syntax ok، deep.valid، removed=1,
//      worsened=0. النتيجة العملية أن ثغرة SQL concat كلاسيكية في JS لا
//      يصلحها أي محرك: repairCode لا شيء، RepairSQL لا شيء، SmartRepair
//      يُنتج الإصلاح الصحيح والبوابة ترفضه.
//
//   ب) يمرّر حالات بلا أي ربط فعلي، لأنه بحث نصّي على الملف كله:
//      استعلام مجمَّع غير مُصلَح يمرّ لمجرد وجود استدعاء مُعَامَل غير ذي صلة
//      في مكان آخر؛ و"$1" من regex replace؛ ومعرّف اسمه params.
//      (ب) ليست من نطاق هذه الجولة — مسجّلة todo في القسم 4 بدليلها.
//
// العقد الذي يثبّته هذا الملف: يُضاف بديل رابع **مربوط ومعدود**، ولا يُمَسّ
// أي بديل قائم. الإثبات الجديد يشترط:
//   • استدعاء .query/.execute وسيطه الأول معرّف والثاني مصفوفة حرفية،
//   • المعرّف يُحَلّ إلى نص حرفي واحد بلا غموض (إسناد واحد، بلا تجميع ولا
//     template ولا استدعاء)،
//   • النص فيه كلمة SQL، وعدد ? فيه يساوي عدد عناصر المصفوفة.
// أي غموض أو تعذّر إثبات ⇒ لا إثبات ⇒ الرفض كما هو (fail-closed).
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadUiContext() {
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
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة فقط */ }
  }
  ctx.toast = noop;
  ctx.refreshStats = noop;
  return ctx;
}

const ctx = loadUiContext();
const FILE = 'app.js';
const gate = after => ctx.FixVerifier.verifyFix(BEFORE, after, FILE, ctx.analyzeCode);

// الأصل: تجميع نصّي لمعاملين، يُبلّغ عنه المحلل كـCWE-89
const BEFORE =
  'function getUser(uid, fl) {\n' +
  "  const q = 'SELECT * FROM users WHERE id = ' + uid + ' AND a = ' + fl;\n" +
  '  return db.query(q);\n}\n';

const sqlFindings = code => ctx.analyzeCode(code, FILE)
  .filter(i => /sql injection|sql_injection|cwe-89/i.test([i.type, i.title, i.cAct, i.ev].join(' '))).length;

// ═══ 0. شروط العزل ═════════════════════════════════════
// بلا هذه الشروط قد يُرفض fixture عند مرحلة أخرى فيصير الأخضر زائفًا.

test('isolation: الأصل يحمل بلاغ SQL، وكل fixture يصل حارس SQL وحده', () => {
  assert.ok(sqlFindings(BEFORE) >= 1, 'الأصل يجب أن يحمل بلاغ SQL');
  for (const [label, after] of Object.entries({ ...MUST_ACCEPT, ...MUST_REJECT })) {
    assert.strictEqual(sqlFindings(after), 0, `${label}: إشارة SQL يجب أن تختفي ليعمل الحارس`);
    assert.ok(ctx.FixVerifier.syntaxCheck(after, FILE).ok, `${label}: يجب أن يكون سليم الصياغة`);
    const deep = ctx.FixVerifier.verify(BEFORE, after, FILE, ctx.analyzeCode);
    assert.ok(deep.valid, `${label}: المرحلة العميقة يجب أن تكون خضراء`);
    assert.ok(deep.improved, `${label}: يجب أن يُنقص مشكلة`);
    assert.strictEqual(deep.diff.worsened.length, 0, `${label}: بلا تدهور`);
  }
});

// ═══ 1. ما يجب أن يُقبل ════════════════════════════════

const MUST_ACCEPT = {
  // الشكل الذي يُنتجه SmartRepair فعلاً — هذا هو الاختبار الأحمر
  'متغيّر + ربط مطابق (ناتج SmartRepair)':
    'function getUser(uid, fl) {\n  const q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  return db.query(q, [uid, fl]);\n}\n',
  'نفسه مع let':
    'function getUser(uid, fl) {\n  let q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  return db.query(q, [uid, fl]);\n}\n',
  'الاستدعاء على this.db':
    'function getUser(uid, fl) {\n  const q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  return this.db.query(q, [uid, fl]);\n}\n',
  'await + execute':
    'async function getUser(uid, fl) {\n  const q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  return await conn.execute(q, [uid, fl]);\n}\n',
  'callback بعد المعاملات':
    'function getUser(uid, fl) {\n  const q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  return db.query(q, [uid, fl], function (e, r) { return r; });\n}\n',
  // السلوك القائم — يجب ألا يتغيّر
  'inline قائم: query("…?", [args])':
    'function getUser(uid, fl) {\n  return db.query("SELECT * FROM users WHERE id = ? AND a = ?", [uid, fl]);\n}\n',
};

for (const [label, after] of Object.entries(MUST_ACCEPT)) {
  test(`ACCEPT: ${label}`, () => {
    const v = gate(after);
    assert.ok(v.accepted, `${label}: كان يجب القبول — ${v.reason}`);
  });
}

// ═══ 2. ما يجب أن يُرفض — جدار الانحدار ═════════════════
// هذه كلها مرفوضة اليوم، ويجب أن تبقى مرفوضة بعد التوسيع.

const MUST_REJECT = {
  'عدم تطابق العدد: 2 placeholders مقابل معامل واحد':
    'function getUser(uid, fl) {\n  const q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  return db.query(q, [uid]);\n}\n',
  'عدم تطابق العدد: placeholder واحد مقابل معاملين':
    'function getUser(uid, fl) {\n  const q = "SELECT * FROM users WHERE id = ?";\n  return db.query(q, [uid, fl]);\n}\n',
  'متغيّر بلا معاملات إطلاقًا':
    'function getUser(uid, fl) {\n  const q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  return db.query(q);\n}\n',
  'معاملات مربوطة باستعلام لا يُحَلّ (buildOther)':
    'function getUser(uid, fl) {\n  const q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  const other = buildOther();\n  return db.query(other, [uid, fl]);\n}\n',
  'تعبير مركّب: base + نص':
    'function getUser(uid, fl) {\n  const q = base + " WHERE id = ? AND a = ?";\n  return db.query(q, [uid, fl]);\n}\n',
  'template literal مع interpolation':
    'function getUser(uid, fl) {\n  const q = `SELECT * FROM users WHERE id = ${uid} AND a = ?`;\n  return db.query(q, [fl]);\n}\n',
  'إعادة إسناد المتغيّر ⇒ غموض':
    'function getUser(uid, fl) {\n  let q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  q = q + " LIMIT 1";\n  return db.query(q, [uid, fl]);\n}\n',
  'نص بلا placeholders مع معاملات':
    'function getUser(uid, fl) {\n  const q = "SELECT * FROM users";\n  return db.query(q, [uid, fl]);\n}\n',
  'نص بلا كلمة SQL':
    'function getUser(uid, fl) {\n  const q = "give me ? and ?";\n  return db.query(q, [uid, fl]);\n}\n',
  'spread ⇒ العدد غير معروف':
    'function getUser(uid, fl) {\n  const q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  return db.query(q, [...args]);\n}\n',
  'مصفوفة فارغة':
    'function getUser(uid, fl) {\n  const q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  return db.query(q, []);\n}\n',
  'المعاملات ليست مصفوفة حرفية':
    'function getUser(uid, fl) {\n  const q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  return db.query(q, argsFor(uid, fl));\n}\n',
  'إسناد ثانٍ للمتغيّر في دالة أخرى ⇒ غموض':
    'function getUser(uid, fl) {\n  const q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  return db.query(q, [uid, fl]);\n}\n' +
    'function setQuery() {\n  q = "SELECT 1";\n  return q;\n}\n',
  'obj.q ليس تعريف متغيّر':
    'function getUser(uid, fl) {\n  obj.q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  return db.query(q, [uid, fl]);\n}\n',
  'مصفوفة متداخلة ⇒ العدد غير معروف':
    'function getUser(uid, fl) {\n  const q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  return db.query(q, [[uid, fl]]);\n}\n',
  'استدعاء بلا نقطة (destructured query)':
    'function getUser(uid, fl) {\n  const q = "SELECT * FROM users WHERE id = ? AND a = ?";\n  return query(q, [uid, fl]);\n}\n',
};

for (const [label, after] of Object.entries(MUST_REJECT)) {
  test(`REJECT: ${label}`, () => {
    const v = gate(after);
    assert.ok(!v.accepted, `${label}: كان يجب الرفض — قُبل بـ${v.reason}`);
    assert.match(String(v.reason), /^REJECTED_SQL_NOT_PARAMETERIZED/,
      `${label}: يجب أن يكون الرفض من حارس SQL تحديدًا، لا من مرحلة أخرى`);
  });
}

// ═══ 3. الربط مربوط بالاستعلام نفسه، لا بأي نص في الملف ══
// متغيّران في نفس الملف: الإثبات يجب أن يتبع المتغيّر المُستدعى فعلاً.

// ملاحظة على الـfixtures: اسم الدالة يبقى getUser (تغييره يُرفض عند
// quickCheck كدالة محذوفة، قبل حارس SQL)، وكل متغيّر يُستخدم (المتغيّر غير
// المستخدم يضيف بلاغ dead assignment ⇒ ISSUES_WORSENED). كلاهما يرفض
// لسبب آخر فيُخفي ما نقيسه.

test('tied: المعاملات تُحسَب على الاستعلام المُستدعى، لا على استعلام آخر في الملف', () => {
  const ok =
    'function getUser(uid, fl) {\n  const qOne = "SELECT * FROM t WHERE x = ?";\n' +
    '  const qTwo = "SELECT * FROM u WHERE y = ? AND z = ?";\n  log(qOne);\n' +
    '  return db.query(qTwo, [uid, fl]);\n}\n';
  const a = gate(ok);
  assert.ok(a.accepted, `الاستعلام المُستدعى عدده مطابق ⇒ قبول — ${a.reason}`);

  const bad =
    'function getUser(uid, fl) {\n  const qOne = "SELECT * FROM t WHERE x = ?";\n' +
    '  const qTwo = "SELECT * FROM u WHERE y = ? AND z = ?";\n  log(qTwo);\n' +
    '  return db.query(qOne, [uid, fl]);\n}\n';
  const v = gate(bad);
  assert.ok(!v.accepted,
    'الاستعلام المُستدعى عدده غير مطابق ⇒ رفض، ولا يجوز أن ينقذه الاستعلام الآخر');
  assert.match(String(v.reason), /^REJECTED_SQL_NOT_PARAMETERIZED/,
    'والرفض يجب أن يكون من حارس SQL تحديدًا');
});

// ═══ 4. سَعَة البدائل النصّية القائمة — مقيسة وموثّقة ════
// البدائل الثلاثة بحث نصّي على الملف كله، فتنطبق على كود لا يحمل أي ربط
// فعلي. هذا ليس bypass مُثبَتًا للبوابة: البوابة تشترط أولاً اختفاء إشارة
// SQL من المحلل (sqlSignalGone)، ولم نُثبت سيناريو يجتمع فيه الاختفاء مع
// إثبات زائف. فالمسجَّل هنا سَعَة كامنة، لا ثغرة مُثبَتة — وتضييق البدائل
// يغيّر سلوكًا قائمًا، وهو خارج نطاق D1-GATE-SHAPE.
// الإثبات الجديد (القسم 1-3) لا يورث هذه السَعَة: مربوط ومعدود.

test('documented: البدائل النصّية الثلاثة تنطبق على كود بلا ربط فعلي', () => {
  const A1 = /\?\s*["'`]\s*,\s*\[[\s\S]*\]/, A2 = /\$\d+/, A3 = /\bparams?\s*[,)]/;
  const loose = s => A1.test(s) || A2.test(s) || A3.test(s);

  // استعلام مجمَّع غير مُصلَح + استدعاء مُعَامَل غير ذي صلة في مكان آخر
  assert.ok(loose('function a(uid){ return db.query("SELECT * FROM t WHERE id = " + uid); }\n' +
                  'function b(x){ return db.query("SELECT * FROM u WHERE k = ?", [x]); }\n'));
  // مجرد "$1" من regex replace
  assert.ok(loose('db.query("SELECT * FROM t WHERE id = " + uid);\nconst s = n.replace(/(\\w+)/, "$1!");\n'));
  // مجرد معرّف اسمه params
  assert.ok(loose('db.query("SELECT * FROM t WHERE id = " + uid);\nfunction render(params) { return params; }\n'));
  // وعدم تطابق العدد في الشكل inline يمرّ كذلك
  assert.ok(loose('db.query("SELECT * FROM t WHERE a = ? AND b = ?", [x]);\n'));
});
