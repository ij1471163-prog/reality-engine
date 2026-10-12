// ═══════════════════════════════════════════════════════════════════════
// سلامة قائمة السكربتات في index.html
// تشغيل:  node --test vercel-api/test/script_manifest_integrity.test.js
//
// كانت الصفحة تُرجع ملفَّين غير موجودين، فيفشل تحميلهما بصمت (404) ويُحمَّل
// بقية المحركات. والمقيس على كلٍّ منهما سببٌ مختلف، وقرارٌ مختلف:
//
//   engine_ast.js — كان موجودًا (e591821) ثم حُذف عمدًا (79c8e2d) بعد أن
//     حلّ محلّه ast-engine.js. والملفّان يُعرّفان **نفس** الدوال الأربع
//     بإعلانات top-level: loadAcorn، walkAST، analyzeJSWithAST،
//     analyzeJSEnhanced. وast-engine.js يُحمَّل في السطر 62 وengine_ast.js
//     كان في 114 — أي أن إعادته تُعيد تعريف الدوال بالنسخة **الأقدم** فوق
//     الأحدث. فالإعادة ليست إصلاحًا بل انحدار؛ والصحيح حذفُ المرجع.
//
//   sleep_manager.js — لا وجود له في تاريخ المستودع إطلاقًا، ولا رمزٌ واحد
//     في الشجرة كلها يشير إليه. فإنشاؤه ملفٌ تخميني لوظيفةٍ غير معروفة؛
//     والصحيح حذفُ المرجع.
//
// وهذا الملف يحرس الحالتين معًا: لا مرجعَ لملفٍ غير موجود، ولا عودةَ لمحرّك
// AST مزدوج يطمس الأحدث.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT       = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

// النسختان كلتاهما تُقرآن في المستودع: اختبارات تقرأ الجذر (مثل
// repair_auth_route_guard) وأخرى تقرأ public. فتُحرَسان كلتاهما.
const MANIFESTS = [
  { label: 'index.html (الجذر)', file: path.join(ROOT, 'index.html') },
  { label: 'public/index.html',  file: path.join(PUBLIC_DIR, 'index.html') },
];

const srcsOf = html =>
  [...html.matchAll(/<script src="\/([^"]+)"/g)].map(m => m[1]);

test('[MAN-1] كل سكربت مرجوع في index.html موجود فعلًا على القرص', () => {
  for (const { label, file } of MANIFESTS) {
    assert.ok(fs.existsSync(file), label + ': غير موجود');
    const srcs = srcsOf(fs.readFileSync(file, 'utf8'));

    // tripwire: قائمةٌ خاوية تجعل الأخضر بلا معنى
    assert.ok(srcs.length >= 20, label + ': قائمة السكربتات قصيرة بشكل مريب — ' + srcs.length);

    const missing = srcs.filter(s => !fs.existsSync(path.join(PUBLIC_DIR, s)));
    assert.deepStrictEqual(missing, [],
      label + ': مراجعُ لملفات غير موجودة ⇒ 404 صامت عند التحميل');
  }
});

test('[MAN-2] محرّك AST واحد لا اثنان — لا إعادة تعريف تطمس الأحدث', () => {
  const NAMES = ['loadAcorn', 'walkAST', 'analyzeJSWithAST', 'analyzeJSEnhanced'];

  // tripwire: المحرّك الحالي يُعرّف الدوال الأربع بإعلانات top-level
  const cur = fs.readFileSync(path.join(PUBLIC_DIR, 'ast-engine.js'), 'utf8');
  for (const n of NAMES) {
    assert.match(cur, new RegExp('^function ' + n + '\\s*\\(', 'm'),
      'ast-engine.js لا يُعرّف ' + n + ' ⇒ هذا الاختبار لا يقيس التعارض');
  }

  for (const { label, file } of MANIFESTS) {
    const srcs = srcsOf(fs.readFileSync(file, 'utf8'));

    // الملف المحذوف لا يعود إلى القائمة
    assert.ok(!srcs.includes('engine_ast.js'),
      label + ': engine_ast.js عاد إلى القائمة — يُعيد تعريف ' + NAMES.join('، ') +
      ' بالنسخة الأقدم فوق ast-engine.js');

    // ولا أيُّ ملفٍ آخر محمَّل يُعرّف نفس الدوال
    const definers = srcs.filter(s => {
      const p = path.join(PUBLIC_DIR, s);
      if (!fs.existsSync(p) || /\.min\.js$/.test(s)) return false;
      const body = fs.readFileSync(p, 'utf8');
      return NAMES.some(n => new RegExp('^function ' + n + '\\s*\\(', 'm').test(body));
    });
    assert.deepStrictEqual(definers, ['ast-engine.js'],
      label + ': أكثر من ملف يُعرّف دوال محرّك AST — ' + JSON.stringify(definers));
  }
});

test('[MAN-3] sleep_manager.js: لا مرجعَ له ولا رمزٌ يطلبه', () => {
  for (const { label, file } of MANIFESTS) {
    assert.ok(!srcsOf(fs.readFileSync(file, 'utf8')).includes('sleep_manager.js'),
      label + ': عاد مرجعُ sleep_manager.js — وهو ملف لم يوجد يومًا في المستودع');
  }

  // ولا رمزٌ في أي ملف محمَّل يستدعي ما كان سيُعرّفه. لو ظهر طالبٌ له فالقرار
  // يُراجَع: حينها يكون الملف قدرةً ناقصة لا مرجعًا ميتًا.
  const srcs = srcsOf(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8'));
  const askers = srcs.filter(s => {
    const p = path.join(PUBLIC_DIR, s);
    if (!fs.existsSync(p) || /\.min\.js$/.test(s)) return false;
    return /\bSleepManager\b|\bsleepManager\b/.test(fs.readFileSync(p, 'utf8'));
  });
  assert.deepStrictEqual(askers, [],
    'ملفٌ يطلب SleepManager: ' + JSON.stringify(askers) + ' ⇒ راجع قرار الحذف');
});

test('[MAN-4] الحذف لم يمسّ أي سكربت آخر — القائمتان كما كانتا ناقصَتَي الوسمين', () => {
  // الحارس ضد حذفٍ أوسع: ما حُذف وسمان فقط، ولا شيء غيرهما.
  // العدد مُثبَّت كي يسقط أي حذف أو إضافة صامتة لاحقة.
  // [S1] 60→61 و62→63: أُضيف learning_validation.js إلى البيانين عمدًا ضمن
  // تقسيم التعلّم. الزيادة واحدةٌ لكل بيان — وأيُّ زيادةٍ غيرها تُسقِط هذا.
  // [S2] 61→62 و63→64: وأُضيف learning_knowledge.js كذلك، للسبب نفسه.
  const counts = MANIFESTS.map(({ file }) => srcsOf(fs.readFileSync(file, 'utf8')).length);
  assert.deepStrictEqual(counts, [62, 64],
    'عدد السكربتات تغيّر: ' + JSON.stringify(counts) +
    ' — إن كان التغيير مقصودًا فليُحدَّث هذا الرقم صراحةً');
});
