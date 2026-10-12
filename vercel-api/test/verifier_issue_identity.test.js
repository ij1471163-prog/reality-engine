// ═══════════════════════════════════════════════════════
// FixVerifier.issueKey — هوية المشكلة
// تشغيل:  node --test vercel-api/test/verifier_issue_identity.test.js
//
// issueKey كان يبني الهوية من `type|file`، و type خشن جدًا ("bug" يغطي
// كل شيء من == إلى أخطاء التراكم). فمشكلة جديدة تختفي مقابل مشكلة أخرى
// مختلفة تمامًا أُصلحت تحت نفس المفتاح:
//
//   before: var a..d        → 2 × (type=bug, cAct="var له مشاكل في الـ scope")
//   after : if (d == null)  → 1 × (type=bug, cAct="مشكلة محتملة")
//                             1 × (type=bug, cAct="== لا يتحقق من النوع")
//   bug|b.js: 2 → 2  ⇒ worsened = 0  ⇒ "أزال 4 مشكلة، بلا تدهور" ⇒ ACCEPTED
//
// أي أن مشكلتين متوسطتين جديدتين مرّتا لأن عددًا مساويًا من مشاكل منخفضة
// مختلفة أُزيل تحت نفس المفتاح. والشدّة لا تدخل القرار إطلاقًا حين يكون
// worsened فارغًا (isHighSeverity لا يُستشار إلا داخل عنصر worsened).
//
// الهوية يجب أن تُميّز بحقل بنيوي (cwe/cAct/strategy) لا بصياغة العنوان:
// title يحمل أسماء المستخدم ("Dead Assignment: b")، فلو اعتُمد خامًا صارت
// إعادة تسمية متغيّر مشكلةً جديدة.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('node:path');

const FV = require(path.join(__dirname, '..', 'public', 'fix_verifier.js'));

const K = (issue, file = 'b.js') => FV.issueKey(issue, file);

// ═══ 1. مشاكل مختلفة تحت نفس type ⇒ هويات مختلفة ═══════

test('issueKey: نفس type مع cAct مختلف ⇒ هوية مختلفة', () => {
  const varScope = { type: 'bug', sev: 'l', cAct: 'var له مشاكل في الـ scope', title: 'var قديم — استخدم let أو const' };
  const looseEq  = { type: 'bug', sev: 'm', cAct: '== لا يتحقق من النوع',      title: 'مقارنة غير دقيقة: == بدل ===' };
  assert.notStrictEqual(K(varScope), K(looseEq),
    'مشكلتان مختلفتان تمامًا تتقاسمان type=bug — لو تساوت هويتهما اختفت الجديدة مقابل القديمة');
});

test('issueKey: نفس type مع cAct مختلف (ثالثة) ⇒ هوية مختلفة', () => {
  const a = { type: 'bug', sev: 'l', cAct: 'var له مشاكل في الـ scope' };
  const b = { type: 'bug', sev: 'm', cAct: 'مشكلة محتملة' };
  assert.notStrictEqual(K(a), K(b));
});

test('issueKey: نفس type مع cwe مختلف ⇒ هوية مختلفة', () => {
  const sql = { type: 'security', cwe: 'CWE-89',  cAct: 'SQL_INJECTION' };
  const cmd = { type: 'security', cwe: 'CWE-78',  cAct: 'CMD_INJECTION' };
  assert.notStrictEqual(K(sql), K(cmd), 'CWE-89 و CWE-78 ليستا نفس المشكلة');
});

test('issueKey: نفس type مع strategy مختلف ⇒ هوية مختلفة', () => {
  const acc = { type: 'bug', strategy: 'ACCUMULATION' };
  const xss = { type: 'bug', strategy: 'XSS_INNER_HTML' };
  assert.notStrictEqual(K(acc), K(xss));
});

// ═══ 2. المطابقة الآمنة محفوظة ═════════════════════════

test('issueKey: نفس المشكلة في نفس الملف ⇒ نفس الهوية', () => {
  const i1 = { type: 'js', sev: 'l', cAct: 'VAR_USAGE', line: 1, title: '🔵 استخدام var — استخدم let أو const' };
  const i2 = { type: 'js', sev: 'l', cAct: 'VAR_USAGE', line: 7, title: '🔵 استخدام var — استخدم let أو const' };
  assert.strictEqual(K(i1), K(i2), 'نفس المشكلة في سطرين مختلفين تبقى نفس الهوية (العدّ هو ما يهم)');
});

test('issueKey: اسم المتغيّر في العنوان لا يغيّر الهوية', () => {
  const b = { type: 'dataflow', sev: 'l', cAct: 'Dead Code', strategy: null, title: '🔵 Dead Assignment: b معرّف لكن لا يُستخدم' };
  const c = { type: 'dataflow', sev: 'l', cAct: 'Dead Code', strategy: null, title: '🔵 Dead Assignment: c معرّف لكن لا يُستخدم' };
  assert.strictEqual(K(b), K(c),
    'العنوان يحمل اسم المتغيّر — لو دخل خامًا في الهوية صارت إعادة التسمية مشكلة جديدة');
});

test('issueKey: اختلاف الصياغة/الترقيم في عنوان بلا حقل بنيوي لا يغيّر الهوية', () => {
  const a = { title: 'تعقيد دالة مرتفع: 12' };
  const b = { title: 'تعقيد دالة مرتفع: 34' };
  assert.strictEqual(K(a), K(b), 'الأرقام في العنوان لا تصنع هوية جديدة');
});

test('issueKey: الملف جزء من الهوية', () => {
  const i = { type: 'js', cAct: 'VAR_USAGE' };
  assert.notStrictEqual(K(i, 'a.js'), K(i, 'b.js'));
});

test('issueKey: ruleId يبقى أقوى مُميِّز حين يوجد', () => {
  const i1 = { ruleId: 'no-eval', type: 'bug', cAct: 'X' };
  const i2 = { ruleId: 'no-eval', type: 'security', cAct: 'Y' };
  assert.strictEqual(K(i1), K(i2), 'ruleId صريح ⇒ نفس القاعدة مهما اختلف التصنيف حولها');
});

test('issueKey: المدخلات غير المتوقعة لا تنهار', () => {
  assert.strictEqual(K(null), 'unknown');
  assert.strictEqual(typeof K({}), 'string');
  assert.strictEqual(typeof K('some raw issue text'), 'string');
  assert.strictEqual(K('نص 12'), K('نص 34'), 'الفرع النصّي يُعيَّر الأرقام كما كان');
});

// ═══ 3. الأثر على البوابة — الحالة المُثبتة ════════════

const fs = require('node:fs'), vm = require('node:vm');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
function loadUiContext() {
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => null, addEventListener: noop, createElement: () => ({}), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: noop }, navigator: {}, location: { search: '' },
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
const ctx = loadUiContext();

const BEFORE = 'var a = 1;\nvar b = 2;\nvar c = 3;\nvar d = 4;\n';
const ADDS_M = 'let a = 1;\nlet b = 2;\nlet c = 3;\nif (d == null) { d = 4; }\n';
// مرشّح نظيف فعلًا (مقيس): يزيل 3 مشاكل ولا يضيف أيًّا.
// عيّنتان سابقتان لم تكونا نظيفتين والرفض كان صحيحًا فيهما:
//   console.log(...)            → console.log نفسه مشكلة مبلَّغ عنها
//   var a..d → let a..d         → كشف dead-assignment يرتفع 3 → 4 فعلًا
//                                 (مرفوض قبل هذا التعديل أيضًا بنفس العدّ)
const CLEAN_BEFORE = 'var GameUtils = (() => {\n  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }\n  return { clamp };\n})();\nconsole.log(GameUtils.clamp(5, 0, 3));\n';
const CLEAN_AFTER  = CLEAN_BEFORE.replace('var GameUtils', 'let GameUtils');

test('gate: candidate يضيف مشكلتين متوسطتين جديدتين ⇒ ISSUES_WORSENED لا ACCEPTED', () => {
  const before = ctx.analyzeCode(BEFORE, 'b.js');
  const after  = ctx.analyzeCode(ADDS_M, 'b.js');
  const newActs = after.filter(i => !before.some(j => j.cAct === i.cAct)).map(i => i.cAct);
  assert.ok(newActs.length >= 1, 'fixture: الـcandidate يضيف تصنيفات لم تكن موجودة — ' + JSON.stringify(newActs));

  const d = FV.diffCounts(before, after, 'b.js');
  assert.ok(d.worsened.length > 0,
    'مشاكل جديدة يجب أن تُحسب تدهورًا ولو أُزيل عدد مساوٍ من مشاكل مختلفة تحت نفس type.\n' +
    '      worsened=' + JSON.stringify(d.worsened) + ' removedCount=' + d.removedCount);

  const g = FV.verifyFix(BEFORE, ADDS_M, 'b.js', ctx.analyzeCode, {});
  assert.strictEqual(g.accepted, false, 'البوابة لا يجوز أن تقبله: ' + g.reason);
  assert.match(String(g.reason), /ISSUES_WORSENED/);
});

test('gate: candidate نظيف يزيل مشاكل بلا إضافة ⇒ يبقى مقبولًا', () => {
  const g = FV.verifyFix(CLEAN_BEFORE, CLEAN_AFTER, 'a.js', ctx.analyzeCode, {});
  assert.strictEqual(g.accepted, true, 'التغطية القائمة لا يجوز أن تُفقد: ' + g.reason);
  assert.ok(g.diff.removedCount > 0, 'يجب أن يُحسب إزالة فعلية');
  assert.strictEqual(g.diff.worsened.length, 0, 'ولا تدهور: ' + JSON.stringify(g.diff.worsened));
});
