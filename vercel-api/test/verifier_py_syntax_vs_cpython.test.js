// ═══════════════════════════════════════════════════════
// pythonStructuralSyntaxCheck مقابل CPython — حالات مثبَّتة قابلة لإعادة التشغيل
// تشغيل:  node --test vercel-api/test/verifier_py_syntax_vs_cpython.test.js
//
// التوقعات **مستمدة من حكم CPython الفعلي**، لا مكتوبة يدوياً:
//   fixtures/gen_python_syntax_cases.py يشغّل ast.parse على كل حالة ويسجّل
//   النتيجة في fixtures/python_syntax_cases.json. هذا الملف يقرأ ذلك الحكم.
//   وإن كان python3 متاحاً وقت التشغيل، يُعاد استمداد الحكم ويُقارَن بالـ
//   fixture، فلا يتقادم بصمت. وإن لم يتوفر، يُتخطّى ذلك التأكيد وحده.
//
// الفجوات المعروفة مُعلَنة في KNOWN_FALSE_POSITIVES أدناه ومسجَّلة todo
// بأسمائها. أي حالة تخرج عن ذلك تُفشل الاختبار — فلا تُخفى فجوة جديدة.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');
const { execFileSync } = require('node:child_process');

const PUBLIC_DIR   = path.join(__dirname, '..', 'public');
const FIXTURE_DIR  = path.join(__dirname, 'fixtures');
const FIXTURE_PATH = path.join(FIXTURE_DIR, 'python_syntax_cases.json');
const GEN_PATH     = path.join(FIXTURE_DIR, 'gen_python_syntax_cases.py');

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
const CASES = fixture.cases;

// لا فجوةَ مُعلَنة: الفاحص يطابق CPython على الكوربوس كلّه.
//
// وكانت أربعٌ مُعلَنة — حالةُ الاقتباس **المفرد** لا تُحمَل بين الأسطر: ثلاثُ
// f-string ممتدّة (PEP 701، بايثون 3.12+) ونصٌّ عادي مستمرٌّ بـ‎\‎ داخله
// (صحيحٌ في كل الإصدارات وأكثرُ شيوعًا). والعائق المُعلَن كان أن حملَ
// الاقتباس المفرد **بلا تفريق** يُفقِد كشفَ ‎err unterminated string‎ و
// ‎err plain string spans‎، وهما خطآن حقيقيان.
//
// وقد حُلّ بالتفريق لا بالحمل المُطلَق ([PY-QUOTE-CARRY] في fix_verifier.js):
// يُحمَل الاقتباسُ حين تُجيز بايثون استمرارَه وحدها — ‎\‎ في آخر السطر (من
// حالة ‎escaped‎ في الماسح، فـ‎"abc\\"‎ مُغلَق لا مستمر)، أو حقلُ استبدالِ
// f-string مفتوح (بعمقٍ محفوظ). وما خرج عن ذلك بقي خطأً: الخطآن أعلاه
// مكشوفان، وهما في الكوربوس يمرّان.
//
// وهذه المجموعة تبقى **فارغة** لا تُحذَف: اختبارُ الحصر أدناه يُفشِل أيَّ
// إيجابيةٍ كاذبة جديدة بدل أن تمرّ صامتةً.
const KNOWN_FALSE_POSITIVES = new Set([]);

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
const ctx = loadCtx();
const check = code => ctx.FixVerifier.syntaxCheck(code, 'a.py');

// ═══ 0. الـfixture نفسه ════════════════════════════════

test('fixture: مولَّد من CPython ويحمل إصداره وحالات ذات دلالة', () => {
  assert.match(String(fixture._python), /^3\./, 'يحمل إصدار CPython الذي وَلَّده');
  const all = Object.values(CASES);
  assert.ok(all.length >= 50, `عدد الحالات ${all.length} — يجب أن يبقى ذا دلالة`);
  assert.ok(all.filter(c => c.valid).length >= 40, 'وفيه كود صحيح بوفرة');
  assert.ok(all.filter(c => !c.valid).length >= 10, 'وأخطاء صياغة حقيقية بوفرة');
  for (const [label, c] of Object.entries(CASES)) {
    assert.strictEqual(typeof c.code, 'string', `${label}: كود مفقود`);
    assert.strictEqual(typeof c.valid, 'boolean', `${label}: حكم مفقود`);
  }
});

// يمنع تقادم الـfixture: إن توفّر python3 يُعاد استمداد الحكم ويُقارَن.
test('fixture: ما زال مطابقاً لحكم CPython الحالي', () => {
  let regenerated;
  try {
    regenerated = execFileSync('python3', ['-I', GEN_PATH], { encoding: 'utf8', timeout: 30000 });
  } catch (e) {
    // python3 غير متاح هنا ⇒ يُتخطّى هذا التأكيد وحده، ويبقى الباقي عاملاً
    return;
  }
  const freshOut = JSON.parse(regenerated);
  const fresh = freshOut.cases;
  // الإصداران في نصّ الحكم: بعضُ الحالات تحتاج 3.12+ (PEP 701)، فلو كان
  // مُفسِّرُ هذه البيئة أقدمَ من مُولِّد الـfixture فالخللُ اختلافُ إصدارٍ لا
  // تقادمُ fixture — ولا يُترك ذلك ليُستنتَج.
  const vs = 'مُولِّد الـfixture: CPython ' + fixture._python +
             ' · هذه البيئة: CPython ' + freshOut._python;
  const drift = [];
  for (const [label, c] of Object.entries(CASES)) {
    if (!(label in fresh)) { drift.push(`${label}: اختفى من المولّد`); continue; }
    if (fresh[label].valid !== c.valid) {
      drift.push(`${label}: CPython يقول ${fresh[label].valid} والـfixture ${c.valid}`);
    }
  }
  for (const label of Object.keys(fresh)) {
    if (!(label in CASES)) drift.push(`${label}: جديد في المولّد وغير مثبَّت`);
  }
  assert.deepStrictEqual(drift, [],
    vs + ' — إن تساوى الإصداران فالـfixture تقادم، فأعد توليده:' +
    ' python3 -I vercel-api/test/fixtures/gen_python_syntax_cases.py >' +
    ' vercel-api/test/fixtures/python_syntax_cases.json');
});

// ═══ 1. كل حالة على حدة، بحكم CPython ══════════════════

for (const [label, c] of Object.entries(CASES)) {
  const known = KNOWN_FALSE_POSITIVES.has(label);
  const opts = known
    ? { todo: 'فجوة مقيسة: حالة الاقتباس المفرد لا تُحمَل بين الأسطر. غير معالَجة في هذه الجولة بقرار صريح' }
    : {};

  test(`CPython ${c.valid ? 'VALID' : 'SyntaxError'} — ${label}`, opts, () => {
    const r = check(c.code);
    assert.strictEqual(r.available, true, 'الفاحص متاح لبايثون');
    if (c.valid) {
      assert.ok(r.ok, `CPython يقبله والفاحص يرفضه بـ"${r.reason}"`);
    } else {
      assert.strictEqual(r.ok, false,
        `CPython يرفضه (${c.msg} @ ${c.line}) والفاحص يقبله — سلبية كاذبة`);
    }
  });
}

// ═══ 2. حصر الفجوات: لا فجوة خارج المُعلَن ═════════════

test('حصر: الإيجابيات الكاذبة هي المُعلَنة فقط', () => {
  const actual = Object.entries(CASES)
    .filter(([, c]) => c.valid && !check(c.code).ok)
    .map(([label]) => label)
    .sort();
  assert.deepStrictEqual(actual, Array.from(KNOWN_FALSE_POSITIVES).sort(),
    'ظهرت أو اختفت إيجابية كاذبة — حدّث KNOWN_FALSE_POSITIVES بعد التحقق، ' +
    'ولا تُسكِت الفرق');
});

test('حصر: صفر سلبيات كاذبة — كل خطأ صياغة حقيقي مكشوف', () => {
  const missed = Object.entries(CASES)
    .filter(([, c]) => !c.valid && check(c.code).ok)
    .map(([label]) => label);
  assert.deepStrictEqual(missed, [],
    'خطأ صياغة حقيقي فُوّت — إصلاح الفاحص أضعف الكشف');
});

test('حصر: الفجوات كلها في اتجاه رفض كود صحيح، لا قبول كود مكسور', () => {
  for (const label of KNOWN_FALSE_POSITIVES) {
    assert.ok(label in CASES, `${label}: معلَن ولا وجود له في الـfixture`);
    assert.strictEqual(CASES[label].valid, true,
      `${label}: معلَن كإيجابية كاذبة لكن CPython يرفضه`);
  }
});
