// ═══════════════════════════════════════════════════════
// repair_sql.js — معامِلة استعلامات Python (دمج · f-string · %)
// تشغيل:  node --test vercel-api/test/repair_sql_python_parameterize.test.js
//
// الفجوة المُقاسة (تشخيص مرحلة «توسيع قدرة الإصلاح»):
//   RepairSQL.scan يكشف الثغرة، وRepairSQL.fix يُرجع count=0، فلا يصل أي
//   مرشّح إلى البوابة. أي أن الاختناق بين **الكشف والتحويل** داخل RepairSQL،
//   لا في المحلّل ولا في البوابة ولا في التعلّم. وملف الإصلاح يحوي مسار
//   بناء الاستعلام المُعامَل أصلًا، ولا يُستدعى.
//
//   الصورة قبل التعديل، مع سائق مُثبَت بالاستيراد:
//     sqlite3  + دمج      scan=1  fix=1   ← يعمل
//     sqlite3  + f-string  scan=1  fix=0   ← كُشف ولم يُحوَّل
//     psycopg2 + دمج      scan=1  fix=0   ← محجوب بشرط family === 'sqlite'
//     pymysql  + دمج      scan=1  fix=0   ← نفس الشرط
//     أي سائق  + %        scan=0  fix=0   ← لا كشف
//     بلا استيراد         fix=0, reason='unknown_or_conflicting_driver'
//
// ⚠️ تمييز لازم: الرفض بلا سائق مُثبَت **رفض سلامة صحيح** لا فجوة قدرة —
// نمط الـplaceholder يختلف بين السائقين ('?' مقابل '%s')، وخطؤه يكسر
// الاستعلام بصمت وتقبله البوابة نحويًا. فيبقى مرفوضًا، ويُحرسه شاهد أدناه.
//
// ─── أقسام الملف ───────────────────────────────────────
//   القسم 1  عزل: المجموعتان منفصلتان، والسائق مُثبَت، والمحلّل يرى العيب.
//   القسم 2  كاشف: الحالات الست المحجوبة تُصلَح ويُغلق بلاغها عبر البوابة.
//   القسم 3  تحقق دلالي تنفيذي: python3 يُشغّل الأصل والمُصلَح ويُقارَن
//            الاستعلام المقصود، فيُثبت أن القيمة صارت معامِلًا لا نصًّا،
//            وأن موضعها لم يتبدّل.
//   القسم 4  شواهد: السليم لا يُمَسّ · بلا سائق يبقى مرفوضًا · ما يعمل
//            اليوم لا ينكسر · والحالات الملتبسة تُرفض بأمان.
//
// مجموعة التدريب معرَّفة هنا **للفصل فقط**: لا يستعملها أي اختبار في هذا
// الملف. وجودها يُثبّت أن المحجوبة لم تُشتقّ منها (لا ملف ولا جدول ولا
// متغيّر مشترك)، ويمنع خلط المجموعتين مستقبلًا.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');
const { execFileSync } = require('node:child_process');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ─── المجموعتان: منفصلتان بالبناء ──────────────────────
const TRAIN = {
  'tr1.py': 'import psycopg2\n\ndef fetch_account(acct):\n    cur.execute("SELECT * FROM accounts WHERE ref=" + acct)\n',
  'tr2.py': 'import pymysql\n\ndef fetch_invoice(inv):\n    cur.execute("SELECT * FROM invoices WHERE no=" + inv)\n',
  'tr3.py': 'import sqlite3\n\ndef fetch_note(nid):\n    cur.execute(f"SELECT * FROM notes WHERE nid={nid}")\n',
  'tr4.py': 'import psycopg2\n\ndef fetch_badge(bid):\n    cur.execute(f"SELECT * FROM badges WHERE bid={bid}")\n',
  'tr5.py': 'import pymysql\n\ndef fetch_plan(pid):\n    cur.execute("SELECT * FROM plans WHERE pid=%s" % pid)\n',
  'tr6.py': 'import sqlite3\n\ndef fetch_zone(zid):\n    cur.execute("SELECT * FROM zones WHERE zid=%s" % zid)\n',
};

// الست المستهدفة: شكلان لكل صيغة، وسائقان لكل شكل
const HELD = {
  'ho1.py': 'import psycopg2\n\ndef get_user(uid):\n    cur.execute("SELECT * FROM users WHERE id=" + uid)\n',
  'ho2.py': 'import pymysql\n\ndef get_order(oid):\n    cur.execute("SELECT * FROM orders WHERE ref=" + oid)\n',
  'ho3.py': 'import sqlite3\n\ndef get_item(sku):\n    cur.execute(f"SELECT * FROM items WHERE sku={sku}")\n',
  'ho4.py': 'import psycopg2\n\ndef get_log(day):\n    cur.execute(f"SELECT * FROM logs WHERE day={day}")\n',
  'ho5.py': 'import pymysql\n\ndef get_tag(tag):\n    cur.execute("SELECT * FROM tags WHERE name=%s" % tag)\n',
  'ho6.py': 'import sqlite3\n\ndef get_row(rid):\n    cur.execute("SELECT * FROM rows WHERE rid=%s" % rid)\n',
};

const CONTROLS = {
  'neg_ok.py':    'import sqlite3\n\ndef safe_get(uid):\n    cur.execute("SELECT * FROM users WHERE id=?", (uid,))\n',
  'neg_nodrv.py': 'def no_driver(uid):\n    cur.execute("SELECT * FROM users WHERE id=" + uid)\n',
  'neg_works.py': 'import sqlite3\n\ndef already_ok(uid):\n    cur.execute("SELECT * FROM members WHERE id=" + uid)\n',
};

// الحالات الملتبسة: يجب أن تبقى بلا إصلاح — لا تخمين لترتيب أو لتعبير
const AMBIGUOUS = {
  'am_tuple.py': 'import pymysql\n\ndef two(a, b):\n    cur.execute("SELECT * FROM t WHERE x=%s AND y=%s" % (a, b))\n',
  'am_expr.py':  'import sqlite3\n\ndef expr(uid):\n    cur.execute(f"SELECT * FROM t WHERE x={uid.strip()}")\n',
  'am_named.py': 'import pymysql\n\ndef named(d):\n    cur.execute("SELECT * FROM t WHERE x=%(k)s" % d)\n',
  'am_col.py':   'import sqlite3\n\ndef col(name):\n    cur.execute("SELECT * FROM t ORDER BY " + name)\n',
};

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
  ctx.__store = store;
  return ctx;
}

// يشغّل خط الأنابيب كاملًا — فالإصلاح يُقاس كما يُقاس في الإنتاج: عبر البوابة
function runPipeline(files) {
  const ctx = loadCtx();
  vm.runInContext('F = ' + JSON.stringify(files) + ';', ctx);
  vm.runInContext('R = {}; Object.keys(F).forEach(k => { R[k] = { code: F[k], issues: analyzeCode(F[k], k) }; });', ctx);
  const report = vm.runInContext('fixAllEnginePipeline()', ctx);
  return { ctx, report, out: vm.runInContext('JSON.parse(JSON.stringify(F))', ctx) };
}

const issueCount = (ctx, code, fn) => ctx.analyzeCode(code, fn).length;

// ─── مقياس دلالي تنفيذي ────────────────────────────────
// يُنفَّذ الكود بـpython3 مع cursor بديل يسجّل (sql, params). سطور الاستيراد
// تُسقَط: السائق دليلٌ للمُصلِح لا شرطٌ للتنفيذ، والوحدات غير مثبّتة هنا.
let PY_OK = true;
function pyRecord(code, fnName, argValue) {
  const body = code.split('\n').filter(l => !/^\s*(?:import|from)\s+\w/.test(l)).join('\n');
  const script =
    'import json\n' +
    '_rec = []\n' +
    'class _C:\n' +
    '    def execute(self, sql, params=None):\n' +
    '        _rec.append((sql, params))\n' +
    'cur = _C()\n' +
    body + '\n' +
    fnName + '(' + JSON.stringify(argValue) + ')\n' +
    'print(json.dumps([[s, (list(p) if p is not None else None)] for s, p in _rec]))\n';
  const out = execFileSync('python3', ['-I', '-c', script], { encoding: 'utf8', timeout: 20000 });
  return JSON.parse(out.trim().split('\n').pop());
}
try { pyRecord('def _p(x):\n    cur.execute("SELECT 1 WHERE a=" + x)\n', '_p', 'z'); }
catch (e) { PY_OK = false; }

const fnNameOf = code => (code.match(/def\s+([A-Za-z_]\w*)\s*\(/) || [])[1];

// ═══ 1. العزل ══════════════════════════════════════════

test('isolation: المجموعتان منفصلتان تمامًا — لا ملف ولا جدول ولا متغيّر مشترك', () => {
  const names = new Set([...Object.keys(TRAIN), ...Object.keys(HELD)]);
  assert.strictEqual(names.size, Object.keys(TRAIN).length + Object.keys(HELD).length,
    'أسماء الملفات لا تتقاطع');

  const tables = c => new Set((c.match(/FROM\s+(\w+)|UPDATE\s+(\w+)/gi) || []).map(s => s.toLowerCase()));
  const tTrain = new Set(), tHeld = new Set();
  for (const c of Object.values(TRAIN)) for (const t of tables(c)) tTrain.add(t);
  for (const c of Object.values(HELD))  for (const t of tables(c)) tHeld.add(t);
  for (const t of tHeld) assert.ok(!tTrain.has(t), `الجدول ${t} لا يظهر في التدريب`);

  const fns = c => (c.match(/def\s+(\w+)/g) || []);
  const fTrain = new Set(), fHeld = new Set();
  for (const c of Object.values(TRAIN)) for (const f of fns(c)) fTrain.add(f);
  for (const c of Object.values(HELD))  for (const f of fns(c)) fHeld.add(f);
  for (const f of fHeld) assert.ok(!fTrain.has(f), `الدالة ${f} لا تظهر في التدريب`);
});

test('isolation: السائق مُثبَت في كل حالة محجوبة، والمحلّل يرى العيب', () => {
  const ctx = loadCtx();
  for (const [f, code] of Object.entries(HELD)) {
    const r = ctx.RepairSQL.fix(code, f);
    assert.ok(r.driver, `[${f}] السائق مُثبَت: ${r.driver}`);
    assert.notStrictEqual(r.reason, 'unknown_or_conflicting_driver', `[${f}] لا التباس في السائق`);
    assert.ok(issueCount(ctx, code, f) >= 1, `[${f}] المحلّل يبلّغ عن العيب — الطلب موجود`);
  }
});

// ═══ 2. كاشف: الحالات المحجوبة تُصلَح عبر البوابة ══════

test('كاشف: الحالات الست المحجوبة تُصلَح ويُغلق بلاغها', () => {
  const { ctx, report, out } = runPipeline(JSON.parse(JSON.stringify(HELD)));
  const failures = [];
  let closed = 0, accepted = 0;

  for (const [f, code] of Object.entries(HELD)) {
    const before = issueCount(ctx, code, f);
    const after  = issueCount(ctx, out[f], f);
    const srcs   = (report.accepted || []).filter(x => x.file === f).map(x => x.source);
    if (out[f] === code) failures.push(`${f}: لم يتغيّر`);
    else if (after >= before) failures.push(`${f}: البلاغ لم يُغلق (${before}⇒${after})`);
    else { closed += (before - after); accepted++; }
    if (out[f] !== code && !srcs.length) failures.push(`${f}: تغيّر بلا قبول من البوابة`);
  }

  assert.deepStrictEqual(failures, [], 'كل حالة محجوبة تُصلَح ويُغلق بلاغها');
  assert.ok(accepted >= 4, `إصلاحات مقبولة ${accepted} ≥ 4`);
  assert.ok(closed >= 5, `بلاغات مُغلقة ${closed} ≥ 5`);
});

test('كاشف: كل إصلاح يمرّ بالبوابة، ولا رفض، والناتج تحويل RepairSQL', () => {
  // ملاحظة على النسبة: الإصلاح يأتي من تحويل RepairSQL، لكن النسبة قد تكون
  // ‎repairCode+Ghost:pass‎ لأن repairCode يستدعي RepairSQL داخليًا ويلتزم
  // أبكر في حلقة الملفات، قبل مرحلة RepairSQL المستقلة. فالثابت المعنيّ هو
  // أن **كل** ملف مُصلَح قد عبر البوابة، لا اسم المرحلة التي التزمت به.
  const { report, out } = runPipeline(JSON.parse(JSON.stringify(HELD)));
  const bySrc = {};
  for (const a of (report.accepted || [])) bySrc[a.source] = (bySrc[a.source] || 0) + 1;

  const files = Object.keys(HELD);
  const acceptedFiles = new Set((report.accepted || []).map(a => a.file));
  const missing = files.filter(f => !acceptedFiles.has(f));
  assert.deepStrictEqual(missing, [],
    `كل ملف محجوب عبر البوابة بقبول صريح. التوزيع: ${JSON.stringify(bySrc)}`);

  // report يأتي من داخل سياق الـvm، فمصفوفاته بنموذج أولي آخر ولا تصحّ معها
  // deepStrictEqual مع ‎[]‎ ولو كانت فارغة — تُنسخ إلى مصفوفة المستضيف أولًا.
  const rejected = Array.from(report.rejected || [])
    .filter(r => r.source === 'RepairSQL')
    .map(r => r.file + ':' + r.reason);
  assert.deepStrictEqual(rejected, [],
    'ولا رفض من البوابة لأي مرشّح من RepairSQL');

  for (const f of Object.keys(HELD)) {
    assert.match(out[f], /execute\(\s*"[^"]*"\s*,\s*\([A-Za-z_]\w*,\)\)/,
      `[${f}] الشكل الناتج: execute("…", (var,)) — ${out[f].split('\n').filter(l => l.includes('execute'))[0]}`);
  }
});

// ═══ 3. تحقق دلالي تنفيذي بـpython3 ════════════════════

test('دلالي: القيمة تُمرَّر معامِلًا، ولا تُدمج في النص، والاستعلام المقصود لا يتغيّر',
  { skip: PY_OK ? false : 'python3 غير متاح' }, () => {
  const { out } = runPipeline(JSON.parse(JSON.stringify(HELD)));
  const VAL = 'V-42';

  for (const [f, code] of Object.entries(HELD)) {
    const fn = fnNameOf(code);
    assert.ok(fn, `[${f}] اسم الدالة مُستخرَج`);

    const orig = pyRecord(code,   fn, VAL);
    const fix  = pyRecord(out[f], fn, VAL);
    assert.strictEqual(orig.length, 1, `[${f}] الأصل ينفّذ استعلامًا واحدًا`);
    assert.strictEqual(fix.length,  1, `[${f}] والمُصلَح كذلك`);

    const [oSql, oParams] = orig[0];
    const [nSql, nParams] = fix[0];

    // (أ) الأصل: القيمة مدمجة في النص ولا معامِلات
    assert.ok(oSql.includes(VAL), `[${f}] العزل: الأصل يدمج القيمة في النص`);
    assert.strictEqual(oParams, null, `[${f}] والأصل بلا معامِلات`);

    // (ب) المُصلَح: القيمة معامِل منفصل ولا أثر لها في النص
    assert.deepStrictEqual(nParams, [VAL], `[${f}] القيمة تُمرَّر معامِلًا: ${JSON.stringify(nParams)}`);
    assert.ok(!nSql.includes(VAL), `[${f}] ولا تظهر في نص SQL: ${nSql}`);

    // (ج) placeholder واحد فقط، ومن نمط السائق
    const marks = (nSql.match(/\?|%s/g) || []);
    assert.strictEqual(marks.length, 1, `[${f}] placeholder واحد بالضبط: ${nSql}`);

    // (د) المعنى محفوظ: إعادة القيمة مكان الـplaceholder تُعيد استعلام الأصل
    //     ⇒ الموضع لم يتبدّل ولا العمود تغيّر.
    const restored = nSql.replace(/\?|%s/, VAL);
    assert.strictEqual(restored, oSql,
      `[${f}] الاستعلام المقصود كما هو.\n  الأصل : ${oSql}\n  المُعاد: ${restored}`);
  }
});

// ═══ 4. شواهد السلامة ══════════════════════════════════

test('شاهد: الاستعلام المُعامَل سليمًا أصلًا لا يُمَسّ', () => {
  const { ctx, out } = runPipeline({ 'neg_ok.py': CONTROLS['neg_ok.py'] });
  assert.strictEqual(out['neg_ok.py'], CONTROLS['neg_ok.py'], 'لم يتغيّر حرفًا واحدًا');
  assert.strictEqual(issueCount(ctx, out['neg_ok.py'], 'neg_ok.py'), 0, 'ولا بلاغ عليه');
});

test('شاهد سلامة: بلا سائق مُثبَت يبقى مرفوضًا — لا تخمين لنمط placeholder', () => {
  const ctx = loadCtx();
  const code = CONTROLS['neg_nodrv.py'];
  const r = ctx.RepairSQL.fix(code, 'neg_nodrv.py');
  assert.strictEqual(r.count, 0, 'RepairSQL لا يقترح شيئًا');
  assert.strictEqual(r.reason, 'unknown_or_conflicting_driver', 'والسبب مُعلَن');
  assert.strictEqual(r.aiRequired, true, 'ويُعلَن أنه يحتاج تدخّلًا');

  const { out } = runPipeline({ 'neg_nodrv.py': code });
  assert.ok(!/execute\(\s*"[^"]*"\s*,\s*\(/.test(out['neg_nodrv.py']),
    'ولا معامِلة في الناتج — الرفض قائم');
});

test('شاهد: ما يُصلَح اليوم لا ينكسر (sqlite3 + دمج)', () => {
  const { ctx, out } = runPipeline({ 'neg_works.py': CONTROLS['neg_works.py'] });
  const before = issueCount(ctx, CONTROLS['neg_works.py'], 'neg_works.py');
  const after  = issueCount(ctx, out['neg_works.py'], 'neg_works.py');
  assert.ok(after < before, `ما زال يُصلَح: ${before} ⇒ ${after}`);
});

test('شاهد: الحالات الملتبسة تُرفض بأمان ولا تُخمَّن', () => {
  const ctx = loadCtx();
  for (const [f, code] of Object.entries(AMBIGUOUS)) {
    const r = ctx.RepairSQL.fix(code, f);
    assert.strictEqual(r.count, 0, `[${f}] لا إصلاح — الترتيب أو التعبير غير قابل للإثبات`);
    assert.strictEqual(r.code, code, `[${f}] والكود لم يُمَسّ`);
  }
});

test('شاهد: اللغات والعتبات الأخرى لم تُمَسّ', () => {
  const ctx = loadCtx();
  // JS: المسار القائم كما هو
  const js = 'const mysql = require("mysql");\nfunction q(id) {\n  db.query("SELECT * FROM u WHERE id = \'" + id + "\'");\n}\n';
  const rJs = ctx.RepairSQL.fix(js, 'a.js');
  assert.ok(rJs.count >= 1, `مسار JS القائم ما زال يعمل (count=${rJs.count})`);

  // لغة بلا مسار آمن
  const rb = ctx.RepairSQL.fix('puts "SELECT * FROM u WHERE id=" + id\n', 'a.rb');
  assert.strictEqual(rb.count, 0, 'لغة بلا مسار إصلاح آمن ⇒ لا تعديل');
});
