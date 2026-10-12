// ═══════════════════════════════════════════════════════
// [S6] LearnedFixer يفوّض — والواجهةُ كما كانت
// ═══════════════════════════════════════════════════════
//
// الخيار (أ): يفوّض إلى الطبقتين الجديدتين ويحفظ واجهتَه للتوافق. والمفوَّض
// شيئان كانا نسختين ثانيتين من منطقٍ يملكه غيرُه:
//
//   • قراءةُ المخزن ⇒ LearningKnowledge.load()  (مفتاحٌ واحد، شكلٌ واحد،
//     ترحيلٌ واحد). وكان هذا الملف يقرأ ‎re_learned_patterns_v2‎ بنفسه.
//   • عتبتا الاختيار ⇒ LearningValidation.THRESHOLDS  (بدل ‎0.20‎ و‎2‎
//     مكتوبتين رقمًا). القيمتان متطابقتان اليوم، فلا تغيّرَ في السلوك.
//
// وما يُحرَس أدناه ثلاثة: الواجهةُ لم تتغيّر، والسلوكُ لم يتغيّر، ومكسبٌ
// جديدٌ جاء مع التفويض — سجلٌّ مزوَّرُ الاعتماد لم يكن هذا الملف يمنعه،
// وصار يمنعه لأن القراءة تمرّ بالاشتقاق.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR  = path.join(__dirname, '..', 'public');
const STORAGE_KEY = 're_learned_patterns_v2';
const plain = v => JSON.parse(JSON.stringify(v));

function loadCtx(seed) {
  const noop = () => {};
  const store = new Map();
  if (seed !== undefined) store.set(STORAGE_KEY, typeof seed === 'string' ? seed : JSON.stringify(seed));
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop,
                createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
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
    const f = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(f)) continue;
    try { vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة */ }
  }
  ctx.__store = store;
  return ctx;
}

const XSS_IN  = 'function f(el, v) {\n  el.innerHTML = v;\n}\nmodule.exports = { f };\n';
const XSS_OUT = 'function f(el, v) {\n  el.textContent = v;\n}\nmodule.exports = { f };\n';
const pat = over => Object.assign({
  id: 'p1', type: 'XSS', language: 'js',
  before: 'el.innerHTML = v;', after: 'el.textContent = v;',
  observed: 5, verified: 5, failures: 0, confidence: 0.7, approved: true,
}, over || {});

// ═══ 1. الواجهةُ كما كانت ═════════════════════════════════════════════

test('[LF-1] الواجهةُ العامّة أربعةٌ بأسمائها وأنواعها', () => {
  const LF = loadCtx().LearnedFixer;
  assert.deepStrictEqual(plain(Object.keys(LF).sort()),
    ['GENERALIZERS', 'VERSION', 'apply', 'smartApply']);
  assert.strictEqual(typeof LF.apply, 'function');
  assert.strictEqual(typeof LF.smartApply, 'function');
  assert.strictEqual(LF.apply.length, 3, 'توقيعُ apply تغيّر');
  assert.strictEqual(LF.smartApply.length, 2, 'توقيعُ smartApply تغيّر');
  assert.strictEqual(LF.VERSION, '2.1');

  // والمُعمِّماتُ الخمسةُ بأسمائها — آليةٌ لم تُفوَّض ولا يجوز أن تضيع
  assert.deepStrictEqual(plain(Object.keys(LF.GENERALIZERS)),
    ['accumulation', 'sql', 'secret', 'crypto', 'xss_dom']);
  assert.strictEqual(LF.GENERALIZERS.sql.enabled, false, 'مُعمِّمُ SQL عاد مُشغَّلًا');
});

// ═══ 2. السلوكُ كما كان ═══════════════════════════════════════════════

test('[LF-2] apply: المطابقةُ الحرفية تعمل، والعتبتان من طبقة التحقّق', () => {
  const ctx = loadCtx();
  const LF = ctx.LearnedFixer, TH = ctx.LearningValidation.THRESHOLDS;
  assert.strictEqual(TH.MIN_CONFIDENCE, 0.2, 'MIN_CONFIDENCE تغيّر — راجع السلوك');
  assert.strictEqual(TH.MIN_VERIFIED, 2, 'MIN_VERIFIED تغيّر — راجع السلوك');

  const ok = LF.apply(XSS_IN, 'a.js', [pat()]);
  assert.strictEqual(ok.applied, 1, 'النمطُ المعتمد لم يُطبَّق');
  assert.strictEqual(ok.code, XSS_OUT);

  // وعند العتبة بالضبط يُقبل، وتحتها يُرفض — فالعتبةُ عتبةٌ فعلًا
  assert.strictEqual(LF.apply(XSS_IN, 'a.js',
    [pat({ verified: TH.MIN_VERIFIED, confidence: TH.MIN_CONFIDENCE })]).applied, 1,
    'عند العتبة بالضبط رُفض');
  assert.strictEqual(LF.apply(XSS_IN, 'a.js',
    [pat({ verified: TH.MIN_VERIFIED - 1 })]).applied, 0, 'دليلٌ تحت العتبة طُبِّق');
  assert.strictEqual(LF.apply(XSS_IN, 'a.js',
    [pat({ confidence: TH.MIN_CONFIDENCE - 0.01 })]).applied, 0, 'ثقةٌ تحت العتبة طُبِّقت');
  assert.strictEqual(LF.apply(XSS_IN, 'a.js', [pat({ approved: false })]).applied, 0,
    'نمطٌ غيرُ معتمد طُبِّق');
});

test('[LF-3] apply: حدودُه المُعلَنة لم تتغيّر', () => {
  const LF = loadCtx().LearnedFixer;
  assert.deepStrictEqual(plain(LF.apply(XSS_IN, 'a.js', [])), { code: XSS_IN, applied: 0 });
  assert.deepStrictEqual(plain(LF.apply(XSS_IN, 'a.js', null)), { code: XSS_IN, applied: 0 });
  assert.strictEqual(LF.apply(null, 'a.js', [pat()]).applied, 0, 'كودٌ غيرُ نصّي');
  // سطرُ تعليقٍ لا يُمَسّ
  const commented = 'function f(el, v) {\n  // el.innerHTML = v;\n}\n';
  assert.strictEqual(LF.apply(commented, 'a.js', [pat()]).applied, 0, 'سطرُ تعليقٍ طُبِّق عليه');
});

test('[LF-4] smartApply يقرأ المخزنَ من مالكه ويُنتج نفسَ ناتج apply', () => {
  const ctx = loadCtx({ patterns: [pat()], safe: [], meta: { total: 1 } });
  const LF = ctx.LearnedFixer;
  const viaStore  = LF.smartApply(XSS_IN, 'a.js');
  const viaDirect = LF.apply(XSS_IN, 'a.js', ctx.LearningKnowledge.load().patterns);
  assert.strictEqual(viaStore.applied, 1, 'smartApply لم يقرأ المخزن');
  assert.strictEqual(viaStore.code, XSS_OUT);
  assert.deepStrictEqual(plain(viaStore), plain(viaDirect), 'المسارانِ اختلفا');
});

test('[LF-5] ولا يرمي على مخزنٍ غائبٍ أو تالفٍ أو بشكلٍ غير متوقّع', () => {
  for (const seed of [undefined, '{not json', JSON.stringify({ patterns: 'ليست مصفوفة' }),
                      JSON.stringify({}), JSON.stringify({ patterns: [] })]) {
    const LF = loadCtx(seed).LearnedFixer;
    const r = LF.smartApply(XSS_IN, 'a.js');
    assert.deepStrictEqual(plain(r), { code: XSS_IN, applied: 0 },
      'مخزنٌ بشكل ' + String(seed).slice(0, 24) + ' أنتج ناتجًا غيرَ محايد');
  }
});

// ═══ 3. مكسبُ التفويض ═════════════════════════════════════════════════

test('[LF-6] المحظورُ لا يصير مرشَّحًا بعد التفويض — وهو ما لم يكن يُفحَص', () => {
  // فلترُ ‎apply‎ يفحص الاعتمادَ والثقةَ والأدلة، ولا يفحص **الحظر**. فسجلٌّ
  // أدلّتُه كافية وإخفاقاتُه ‎≥ BAN_AT‎ وحقلُ ‎approved‎ فيه ‎true‎ — سجلٌّ
  // كُتب بعتبةٍ أقدم، أو عُدِّل بيدٍ في أدوات المتصفح — كان يُنتج مرشَّحًا
  // من هذا الملف. والآن تمرّ قراءةُ ‎smartApply‎ باشتقاق الحكم من العدّادات،
  // فالحظرُ يسري عليه كما يسري على بقية المحرّك.
  const V = loadCtx().LearningValidation;
  const banned = pat({ id: 'p-banned', verified: 5, failures: V.BAN_AT, approved: true, confidence: 0.7 });
  assert.ok(V.isBanned(banned), 'tripwire: العيّنةُ ليست محظورة');

  const ctx = loadCtx({ patterns: [banned], safe: [], meta: { total: 1 } });
  assert.strictEqual(ctx.LearnedFixer.smartApply(XSS_IN, 'a.js').applied, 0,
    'نمطٌ محظورٌ أنتج مرشَّحًا من مسار المخزن');

  // والسجلُّ نفسُه لم يُحذف — الدليلُ باقٍ والحكمُ وحدَه مُستأنَف
  const p = ctx.LearningKnowledge.load().patterns[0];
  assert.strictEqual(p.id, 'p-banned', 'السجلُّ حُذف');
  assert.strictEqual(p.verified, 5, 'عدّادُ النجاح تغيّر');
  assert.strictEqual(p.failures, V.BAN_AT, 'عدّادُ الإخفاق تغيّر');
  assert.strictEqual(p.approved, false, 'الحظرُ لم يُسقط الاعتماد');

  // ⚠️ وحدٌّ معلن: ‎apply‎ المباشرة تثق بما يُسلَّم لها — واجهةُ مكتبةٍ تأخذ
  // الأنماطَ وسيطًا، فلا مخزنَ لها تشتقّ منه، ولا تفحص الحظر. فالمكسبُ على
  // مسار ‎smartApply‎ وحدَه، وهو مسارُ الإنتاج. (ومَن يُمرّر أنماطًا بيده
  // عليه ما على المخزن: أن تكون مشتقّةً بقواعد اليوم.)
  assert.strictEqual(ctx.LearnedFixer.apply(XSS_IN, 'a.js', [banned]).applied, 1,
    'tripwire: صار apply يفحص الحظر — تحسّنٌ، فليُحدَّث هذا التوثيق');

  // وسجلٌّ عدّاداتُه نفسُها تُسقطه يُرفض من المسارين — فالفلترُ قائمٌ أيضًا
  const noEvidence = pat({ id: 'p-noev', verified: 0, failures: 9, approved: true, confidence: 0.97 });
  assert.strictEqual(ctx.LearnedFixer.apply(XSS_IN, 'a.js', [noEvidence]).applied, 0,
    'سجلٌّ بلا أدلةٍ طُبِّق من apply');
});

test('[LF-7] بلا طبقتَي التعلّم: صفرُ مرشَّحين لا عتباتٌ محليّة', () => {
  // فشلٌ مغلق: اختيارُ مرشَّحٍ بعتباتٍ مجهولة أسوأ من ألا يُقترح مرشَّح.
  // يُحمَّل الملفُّ وحدَه في سياقٍ بلا الطبقتين — وهو ما يحدث لو سقط
  // سكربتٌ من البيان.
  const noop = () => {};
  const ctx = { console: { log: noop, warn: noop, error: noop, info: noop } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'learned_fixer.js'), 'utf8'), ctx,
    { filename: 'learned_fixer.js' });

  const LF = ctx.LearnedFixer;
  assert.ok(LF, 'الملفُّ لا يُحمَّل منفردًا');
  assert.strictEqual(LF.apply(XSS_IN, 'a.js', [pat()]).applied, 0,
    'طُبِّق بلا عتباتٍ معروفة');
  assert.deepStrictEqual(plain(LF.smartApply(XSS_IN, 'a.js')), { code: XSS_IN, applied: 0 });
  // والواجهةُ ما زالت قائمة — فالفشلُ مغلقٌ لا منهار
  assert.deepStrictEqual(plain(Object.keys(LF).sort()),
    ['GENERALIZERS', 'VERSION', 'apply', 'smartApply']);
});

// ═══ 4. لا نسخةَ ثانية باقية ══════════════════════════════════════════

test('[LF-8] لا مفتاحَ تخزينٍ ولا عتبةَ رقمية باقيةً في الملف', () => {
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'learned_fixer.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.doesNotMatch(src, /re_learned_patterns_v2/, 'مفتاحُ التخزين ما زال في الملف');
  assert.doesNotMatch(src, /localStorage/, 'الملفُّ ما زال يلمس localStorage');
  assert.doesNotMatch(src, /confidence\s*>=\s*0?\.\d/, 'عتبةُ ثقةٍ رقمية باقية');
  assert.doesNotMatch(src, /verified\s*>=\s*\d/, 'عتبةُ أدلةٍ رقمية باقية');
  assert.match(src, /THRESHOLDS/, 'العتباتُ لا تُقرأ من طبقة التحقّق');
});
