// ═══════════════════════════════════════════════════════
// [S4] ترحيلُ re_learned_patterns_v2 — دليلٌ يبقى، وحكمٌ يُستأنف
// ═══════════════════════════════════════════════════════
//
// العقدُ المطلوب من الترحيل، بندًا بندًا:
//
//   (1) نفسُ المفتاح، بلا نسخة. ‎re_learned_patterns_v2‎ قبل التقسيم
//       وبعده. فلا مفتاحَ ثانٍ يتباعد، ولا هجرةٌ تُفقد سجلًّا إن توقّفت.
//   (2) لا فقدَ لبيانات التعلّم. العدّادات والتواريخ والقوالب ومفاتيح
//       الهوية تبقى حرفًا بحرف — هي الدليلُ المُكتسَب.
//   (3) ‎approved‎ يُعاد اشتقاقه بقواعد اليوم ولا يُورَّث. سجلٌّ يحمل
//       اعتمادًا كُتب بعتبةٍ أقدم لا يُستأنَف اعتمادُه بلا دليل.
//   (4) خامدُ التكرار: تطبيقُه مرةً كتطبيقِه ألفًا.
//   (5) ‎schemaVersion: 3‎ يلحق الكتابة لا القراءة — فلا قراءةَ لها أثر.
//
// والبندُ (3) ذو حدَّين مقيسين في القسم 2: يُسقِط اعتمادًا لا تُجيزه
// القواعد، ويمنح اعتمادًا تُجيزه عدّاداتٌ كانت مكتوبةً بحكمٍ أقدم. فهو
// استئنافُ حكمٍ لا عقوبةٌ ولا مكافأة.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR  = path.join(__dirname, '..', 'public');
const STORAGE_KEY = 're_learned_patterns_v2';

// الطبقتان تُحمَّلان في سياقٍ بمخزنٍ وهمي — المخزنُ هو موضوعُ الاختبار
function loadCtx(seed) {
  const store = new Map();
  if (seed !== undefined) store.set(STORAGE_KEY, typeof seed === 'string' ? seed : JSON.stringify(seed));
  const noop = () => {};
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
  // البيانُ نفسه الذي يخدمه Vercel — فالترتيبُ هو ترتيبُ الإنتاج
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const f = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(f)) continue;
    try { vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة */ }
  }
  ctx.__store = store;
  ctx.__raw   = () => store.get(STORAGE_KEY);
  ctx.__db    = () => { const r = store.get(STORAGE_KEY); return r ? JSON.parse(r) : null; };
  return ctx;
}

// سجلٌّ على شكل ما يكتبه learn() اليوم، مع ما يُراد تجاوزه من حقول
// القِيَمُ المُنشأة داخل السياق تحمل نماذجَ أولية أخرى، فيرفضها
// deepStrictEqual على فرقِ النموذج لا فرقِ القيمة. التطبيعُ عبر JSON
// يجعل المقارنة مقارنةَ بيانات — وهو المقصود.
const plain = v => JSON.parse(JSON.stringify(v));

const rec = over => Object.assign({
  id: 'p-old-1', type: 'secret', severity: 'c',
  before: 'const KEY = "sk_live_1";', after: 'const KEY = process.env.KEY;',
  language: 'js',
  context: { functionName: 'boot', scope: 'function', fileName: 'a.js' },
  fingerprint: 'fp-old', fileName: 'a.js',
  generalized: { beforeTemplate: 'const __LEARN_ID_1__ = "sk_live_1";',
                 afterTemplate:  'const __LEARN_ID_1__ = process.env.__LEARN_ID_1__;',
                 beforeSlots: [{ id: 'ID_1', kind: 'identifier', value: 'KEY' }],
                 afterSlots:  [{ id: 'ID_1', kind: 'identifier', value: 'KEY' }],
                 sharedTokens: ['KEY'] },
  observed: 7, verified: 4, failures: 0, confidence: 0.70, approved: true,
  created: 1600000000000, lastSeen: 1600000111111, lastUsed: 1600000222222,
}, over || {});

// ═══ 1. لا فقدَ، ولا نسخةَ ثانية ══════════════════════════════════════

test('[MG-1] نفسُ المفتاح وحده — لا مفتاحَ ثانٍ يُكتب ولا سجلَّ يُحذف', () => {
  const seed = { patterns: [rec(), rec({ id: 'p-old-2', fingerprint: 'fp-2' })],
                 safe: ['process.env.X'], meta: { total: 9, evicted: 2 } };
  const ctx = loadCtx(seed);

  const db = ctx.LearningKnowledge.load();
  assert.strictEqual(db.patterns.length, 2, 'عددُ الأنماط تغيّر بالقراءة');
  assert.deepStrictEqual(plain(db.safe), ['process.env.X'], 'قائمةُ safe تغيّرت');
  assert.strictEqual(db.meta.total, 9, 'meta.total تغيّر');
  assert.strictEqual(db.meta.evicted, 2, 'meta.evicted تغيّر');

  // والمخزنُ لم يُكتب من القراءة — ولا مفتاحَ آخر ظهر
  assert.deepStrictEqual([...ctx.__store.keys()].filter(k => /learn|pattern/i.test(k)), [STORAGE_KEY],
    'مفتاحٌ ثانٍ للتعلّم ظهر في المخزن');
});

test('[MG-2] العدّاداتُ والتواريخُ والقوالبُ تبقى حرفًا بحرف', () => {
  const before = rec();
  const ctx = loadCtx({ patterns: [JSON.parse(JSON.stringify(before))], safe: [], meta: { total: 1 } });
  const after = ctx.LearningKnowledge.load().patterns[0];

  // كلُّ حقلٍ عدا الحقلين المشتقّين — مقارنةٌ شاملة لا انتقائية، فلا يمرّ
  // حقلٌ أُسقط بصمتٍ لأن الاختبار لم يذكره بالاسم.
  const DERIVED = new Set(['approved', 'confidence']);
  for (const k of Object.keys(before)) {
    if (DERIVED.has(k)) continue;
    assert.deepStrictEqual(plain(after[k]), before[k], 'الحقل ' + k + ' تغيّر بالترحيل');
  }
  // ولا حقلَ جديدٌ دُسّ في السجل
  assert.deepStrictEqual(Object.keys(after).sort(), Object.keys(before).sort(),
    'مجموعةُ حقول السجل تغيّرت');
});

// ═══ 2. الحكمُ يُستأنف في الاتجاهين ═══════════════════════════════════

test('[MG-3] اعتمادٌ لا تُجيزه قواعدُ اليوم يُسقَط، والدليلُ يبقى', () => {
  const V = loadCtx().LearningValidation;
  // سجلٌّ يزعم الاعتماد بدليلٍ أقلَّ من العتبة — كأنّه كُتب بعتبةٍ أقدم
  const weak = rec({ id: 'p-weak', verified: 1, failures: 0, approved: true, confidence: 0.99 });
  assert.ok(weak.verified < V.THRESHOLDS.MIN_VERIFIED, 'tripwire: العيّنة تجتاز العتبة أصلًا');

  const p = loadCtx({ patterns: [weak], safe: [], meta: { total: 1 } }).LearningKnowledge.load().patterns[0];
  assert.strictEqual(p.approved, false, 'اعتمادٌ بلا دليلٍ كافٍ وُرِّث');
  assert.strictEqual(p.verified, 1, 'الدليلُ أُسقط مع الحكم ⇒ فقدُ تعلّم');
  assert.strictEqual(p.observed, 7, 'المشاهداتُ أُسقطت');
  assert.strictEqual(p.confidence, V.calcConfidence(1, 0), 'الثقةُ لم تُعَد اشتقاقًا');
});

test('[MG-4] والمحظورُ لا يُستأنَف اعتمادُه ولو كُتب معتمدًا', () => {
  const V = loadCtx().LearningValidation;
  const banned = rec({ id: 'p-banned', verified: 9, failures: V.BAN_AT, approved: true, confidence: 0.95 });
  const p = loadCtx({ patterns: [banned], safe: [], meta: { total: 1 } }).LearningKnowledge.load().patterns[0];

  assert.strictEqual(p.approved, false, 'محظورٌ وُرِّث اعتمادُه');
  assert.strictEqual(p.failures, V.BAN_AT, 'عدّادُ الإخفاق تغيّر');
  assert.strictEqual(p.verified, 9, 'النجاحاتُ أُسقطت');
  assert.ok(V.isBanned(p), 'الحظرُ نفسُه ضاع');
});

test('[MG-5] ودليلٌ كافٍ كُتب غيرَ معتمد يُعتمد — استئنافٌ لا عقوبة', () => {
  const V = loadCtx().LearningValidation;
  // عدّاداتٌ تُجيز الاعتماد بقواعد اليوم، وحقلُ approved مكتوبٌ false
  const strong = rec({ id: 'p-strong', verified: 5, failures: 0, approved: false, confidence: 0 });
  const p = loadCtx({ patterns: [strong], safe: [], meta: { total: 1 } }).LearningKnowledge.load().patterns[0];

  assert.strictEqual(p.confidence, V.calcConfidence(5, 0));
  assert.ok(p.confidence >= V.THRESHOLDS.MIN_CONFIDENCE, 'tripwire: العيّنة لا تبلغ الثقة');
  assert.strictEqual(p.approved, true, 'دليلٌ كافٍ بقي غيرَ معتمد ⇒ الحكمُ وُرِّث لا اشتُقّ');
});

// ═══ 3. خمودُ التكرار، والقراءةُ بلا أثر ══════════════════════════════

test('[MG-6] الترحيلُ خامدُ التكرار — مرةً كألف', () => {
  const seed = { patterns: [rec({ id: 'a', verified: 1, approved: true }),
                            rec({ id: 'b', verified: 5, approved: false }),
                            rec({ id: 'c', verified: 9, failures: 4, approved: true })],
                 safe: [], meta: { total: 3 } };
  const K = loadCtx(seed).LearningKnowledge;

  const once  = JSON.stringify(K.load());
  const twice = JSON.stringify(K.migrate(JSON.parse(once)));
  const many  = JSON.stringify([0,0,0,0,0].reduce(acc => K.migrate(acc), JSON.parse(once)));
  assert.strictEqual(twice, once, 'التطبيقُ الثاني غيّر النتيجة');
  assert.strictEqual(many,  once, 'التطبيقُ المتكرّر غيّر النتيجة');
});

test('[MG-7] القراءةُ لا تكتب في المخزن', () => {
  const seed = { patterns: [rec({ verified: 1, approved: true })], safe: [], meta: { total: 1 } };
  const ctx = loadCtx(seed);
  const raw = ctx.__raw();

  let writes = 0;
  const real = ctx.localStorage.setItem;
  ctx.localStorage.setItem = (k, v) => { if (k === STORAGE_KEY) writes++; return real(k, v); };

  ctx.LearningKnowledge.load();
  ctx.LearningEngine.getStats();
  ctx.LearningEngine.getBoosts();
  ctx.LearningEngine.applyLearned('const Z = "q";\n', 'z.js');

  assert.strictEqual(writes, 0, 'مسارُ القراءة كتب في المخزن ' + writes + ' مرة');
  assert.strictEqual(ctx.__raw(), raw, 'بايتاتُ المخزن تغيّرت بلا كتابة');
});

test('[MG-8] ووسمُ الشكل يلحق أولَ كتابة', () => {
  const ctx = loadCtx({ patterns: [rec()], safe: [], meta: { total: 1 } });
  const K = ctx.LearningKnowledge;
  assert.strictEqual(ctx.__db().meta.schemaVersion, undefined, 'tripwire: الوسمُ موجود قبل الكتابة');

  assert.strictEqual(K.save(K.load()), true);
  assert.strictEqual(ctx.__db().meta.schemaVersion, K.SCHEMA_VERSION, 'الوسمُ لم يُكتب');
  assert.strictEqual(K.SCHEMA_VERSION, 3, 'رقمُ الشكل تغيّر بلا إعلان');

  // والوسمُ لا يُفقد ما كان في meta
  assert.strictEqual(ctx.__db().meta.total, 1, 'meta.total فُقد مع الوسم');
  assert.strictEqual(ctx.__db().patterns.length, 1, 'سجلٌّ فُقد مع الوسم');
});

// ═══ 4. مخزنٌ تالفٌ أو ناقصُ الشكل ════════════════════════════════════

test('[MG-9] الترحيلُ لا يسقط على مخزنٍ تالفٍ أو بشكلٍ غير متوقّع', () => {
  const K0 = loadCtx('{not json').LearningKnowledge;
  assert.deepStrictEqual(plain(K0.load()), { patterns: [], safe: [], meta: { total: 0 } },
    'مخزنٌ تالفٌ لم يعد إلى المخزن الفارغ');

  // أشكالٌ ناقصة: الترحيلُ يمرّ ولا يرمي، ولا يخترع بيانات
  const K = loadCtx().LearningKnowledge;
  assert.deepStrictEqual(K.migrate(null), null);
  assert.deepStrictEqual(K.migrate(undefined), undefined);
  assert.deepStrictEqual(K.migrate({}), {});
  assert.deepStrictEqual(K.migrate({ patterns: 'ليست مصفوفة' }), { patterns: 'ليست مصفوفة' });
  assert.deepStrictEqual(K.migrate({ patterns: [null, 5, 'x'] }), { patterns: [null, 5, 'x'] });

  // وسجلٌّ بلا عدّادات: الحكمُ يُشتقّ من الصفر لا يُخترع
  const bare = K.migrate({ patterns: [{ id: 'bare' }] }).patterns[0];
  assert.strictEqual(bare.approved, false);
  assert.strictEqual(bare.confidence, loadCtx().LearningValidation.calcConfidence(0, 0));
  assert.strictEqual(bare.verified, undefined, 'عدّادٌ غيرُ موجودٍ اختُرع');
});

test('[MG-11] حقلُ approved في المخزن لا يمنح ثقةً — العدّاداتُ وحدها دليل', () => {
  // المكسبُ المقصود من الاشتقاق عند كل قراءة لا عند ترحيلٍ واحد: سجلٌّ
  // عُدِّل بيدٍ في أدوات المتصفح — أو تلف، أو كُتب بعتبةٍ أقدم — لا يصير
  // مؤهَّلًا للتطبيق. وفي محرّكٍ يكتب إصلاحاتٍ في كودٍ حقيقي، هذا حدُّ ثقة.
  const forged = rec({ id: 'p-forged', observed: 1, verified: 0, failures: 9,
                       approved: true, confidence: 0.97 });
  const ctx = loadCtx({ patterns: [forged], safe: [], meta: { total: 1 } });
  const p = ctx.LearningKnowledge.load().patterns[0];

  assert.strictEqual(p.approved, false, 'اعتمادٌ مزوَّر نجح');
  assert.strictEqual(p.confidence, 0, 'ثقةٌ مزوَّرة بقيت');
  assert.strictEqual(ctx.LearningValidation.isEligible(p, 'js', null), false,
    'سجلٌّ مزوَّرُ الاعتماد صار مؤهَّلًا للتطبيق');

  // وعلى مستوى المحرّك: لا يُطبَّق، ولا يُعَدّ معتمدًا في الإحصاء
  const out = ctx.LearningEngine.applyLearned('const KEY = "sk_live_1";\n', 'a.js');
  assert.strictEqual(out.applied, 0, 'نمطٌ مزوَّر طُبِّق فعلًا');
  assert.strictEqual(ctx.LearningEngine.getStats().approved, 0, 'المزوَّر يُعَدّ معتمدًا');
});

test('[MG-10] سجلٌّ بلا لغةٍ يبقى محفوظًا وخامدًا — لا يُحذف ولا يُخمَّن', () => {
  // ⚠️ الأثرُ المُعلَن لبوابة اللغة: سجلٌّ لا تُعرف لغتُه لا يُطبَّق على أي
  // ملف. والترحيلُ لا يخترع له لغة — التخمينُ هنا تطبيقٌ على لغةٍ خاطئة.
  const ctx = loadCtx({ patterns: [rec({ id: 'p-nolang', language: '', verified: 5 })],
                        safe: [], meta: { total: 1 } });
  const p = ctx.LearningKnowledge.load().patterns[0];
  assert.strictEqual(p.language, '', 'لغةٌ اختُرعت للسجل');
  assert.strictEqual(ctx.LearningEngine.getStats().langless, 1, 'السجلُّ بلا لغةٍ لا يُعرَض');
  assert.strictEqual(ctx.LearningValidation.isEligible(p, 'js', null), false, 'سجلٌّ بلا لغةٍ صار مؤهَّلًا');
});
