// ═══════════════════════════════════════════════════════
// applyLearned — القوالب الخطيرة عند التطبيق (لا عند التخزين)
// تشغيل:  node --test vercel-api/test/learning_apply_template_guard.test.js
//
// الفجوة المستهدفة (مقيسة، لا مفترضة):
//   V4 يرفض تعميم قالب يبدّل ترتيب الخانات. لكن حامله
//   isGeneralPatternUsable له **موضع نداء واحد** في learning_engine.js:
//   داخل learn() وقت التخزين. و applyLearned لا ينادي الفحص إطلاقًا، بل
//   يثق بـ p.generalized ثقةً مطلقة. فقالبٌ دخل المخزن بطريق آخر — مخزن
//   أقدم من V4، أو زرع، أو مسار كود لا يمرّ بـlearn() — يُطبَّق كما هو.
//
//   والمقيس على عائلة SQL concat → parameterized:
//     before:  db.query("… a=" + x + " AND b=" + y);
//     after :  db.query("… a=? AND b=?", [y, x]);      ← الوسطاء معكوسان
//   تطبيقه على سطر آخر من العائلة يربط كل قيمة بالعمود الخطأ. والنتيجة
//   صحيحة نحويًا، مُعامَلة بالمعامِلات كما يجب، ودلالتها مقلوبة.
//
// ولماذا لا تنقذنا البوابة: المحلّل يرى بلاغين قبل الإصلاح وصفرًا بعده —
// للنسخة المقلوبة والنسخة السليمة على السواء، بقائمتَي بلاغات متطابقتين.
// لا كاشف يمثّل تقابل المعامِل بالعمود، فالبوابة تحتسب "أزال مشكلتين بلا
// تدهور" في الحالتين. القسم 3 يثبّت ذلك صراحةً.
//
// ─── أقسام هذا الملف، وهي ثلاثة لا تُخلَط ───────────────
//   القسم 1 (كاشف — أحمر): يؤكّد السلوك **المطلوب** الذي لا يتحقق اليوم.
//            فشله الآن هو الغرض، ويجب أن يخضرّ بالحماية وحدها.
//   القسم 2 (إيجابي — أخضر الآن وبعد الحماية): إصلاح متعلَّم سليم يحفظ
//            ترتيب الخانات يُطبَّق ويُكتب كما كان. يحرس ألّا تكون الحماية
//            مانعًا شاملاً.
//   القسم 3 (توثيقي — أخضر الآن وبعد الحماية): حدود مُعلَنة. لا يصف
//            سلوكًا مطلوبًا ولا يتغيّر بالحماية.
//
// ملاحظات على العزل:
//   • localStorage هنا مخزن حقيقي في الذاكرة لكل سياق، ولا يُمَسّ أي مخزن
//     حقيقي ولا أي ملف. الـstub ‎{ getItem: () => null }‎ يجعل أي قياس
//     تخزين بلا معنى لأن load() يقرأ في كل نداء.
//   • القالب الخطِر **يُنتجه المحرك نفسه** على نسخة في الذاكرة مُعطَّل فيها
//     سطر V4 وحده — لا كائن مكتوب بيدي. فهو قالب يستطيع هذا المحرك إنتاجه،
//     لا تخيّل لشكلٍ قد لا يوجد.
//   • مقياس الضرر تنفيذي: يُنفَّذ السطران ويُسجَّل أي قيمة ارتبطت بأي عمود.
//     اجتياز البوابات لا يُحتسب دليلاً على سلامة المعنى.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR  = path.join(__dirname, '..', 'public');
const LE_PATH     = path.join(PUBLIC_DIR, 'learning_engine.js');
const LE_HEAD     = fs.readFileSync(LE_PATH, 'utf8');
const STORAGE_KEY = 're_learned_patterns_v2';

// سطر V4 كما هو في الملف المُسلَّم. إن تغيّر نصه فالقسم كله يفشل صراحةً بدل
// أن يقيس نسخة لم تُعطَّل فعلاً — نفس انضباط GATE_LINE في ملف حرس corresponds.
const V4_LINE  = '    if (seqAt !== afterSeq.length) return false;';
const LE_NO_V4 = LE_HEAD.replace(V4_LINE, '    if (false) return false;');

function loadCtx(learningEngineSrc) {
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
    if (m[1] === 'learning_engine.js' && learningEngineSrc) {
      vm.runInContext(learningEngineSrc, ctx, { filename: m[1] });
      continue;
    }
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة فقط */ }
  }
  ctx.toast = noop;
  ctx.refreshStats = noop;
  ctx.__store = store;
  return ctx;
}

// ─── الزوج المصدر، ونسختا الإصلاح ──────────────────────
const SRC_FILE = 'db.js';
const SRC_BEFORE = 'function q(x, y) {\n  db.query("SELECT * FROM t WHERE a=" + x + " AND b=" + y);\n}\n';
// الإصلاح نفسه مرتين: بعكس ترتيب الوسطاء، وبحفظه.
const FIX_SWAP   = 'function q(x, y) {\n  db.query("SELECT * FROM t WHERE a=? AND b=?", [y, x]);\n}\n';
const FIX_KEEP   = 'function q(x, y) {\n  db.query("SELECT * FROM t WHERE a=? AND b=?", [x, y]);\n}\n';

// ─── الضحية: نفس العائلة، كائن ومتغيّرات مختلفة ────────
const VICTIM = 'function load(userId, tenantId) {\n  conn.exec("SELECT * FROM t WHERE a=" + userId + " AND b=" + tenantId);\n}\n';
const SWAPPED_LINE = 'conn.exec("SELECT * FROM t WHERE a=? AND b=?", [tenantId, userId]);';
const KEPT_LINE    = 'conn.exec("SELECT * FROM t WHERE a=? AND b=?", [userId, tenantId]);';

// يُنتج نمطًا بالمحرك نفسه من الزوج، ثم يرفع عدّاداته إلى حالة "معتمد"
// تتجاوز عتبات العميل (MIN_VERIFIED=2، MIN_CONFIDENCE=0.20). بيانات اختبار
// معزولة بالكامل — لا تُقرأ ولا تُكتب أي حالة حقيقية.
function mintPattern(fixCode, engineSrc) {
  const ctx = loadCtx(engineSrc);
  ctx.LearningEngine.learn(SRC_BEFORE, fixCode, ctx.analyzeCode(SRC_BEFORE, SRC_FILE), SRC_FILE);
  const raw = ctx.__store.get(STORAGE_KEY);
  const p = raw ? (JSON.parse(raw).patterns || [])[0] : null;
  assert.ok(p, 'العزل: الزوج المصدر يجب أن يُخزَّن نمطًا — وإلا فكل ما بعده فارغ');
  return Object.assign(p, { observed: 3, verified: 3, failures: 0, confidence: 0.7, approved: true });
}
//   القالب المبدِّل: يحتاج V4 مُعطَّلًا **وقت الإنتاج** — فهذا تحديدًا معنى
//   "قالب لم يعبر فحص learn() الحالي": مخزن أقدم، أو زرع، أو مسار آخر.
const mintPoison = () => mintPattern(FIX_SWAP, LE_NO_V4);
//   القالب الحافظ للترتيب: ينتجه الملف المُسلَّم نفسه، فV4 يقبله.
const mintClean  = () => mintPattern(FIX_KEEP, LE_HEAD);

const seedDb = p => JSON.stringify({ patterns: [p], safe: [], meta: { total: 1 } });

// مقياس الضرر: يُنفَّذ الكود ويُسجَّل ما ارتبط بالعمود a وما ارتبط بـb.
// مستقل تمامًا عن المحلّل والبوابة — ولذلك لا يُخدَع بما يخدعهما.
function columnBinding(code) {
  const captured = [];
  const sandbox = {
    conn: { exec: (sql, params) => captured.push({ sql, params }) },
    db:   { query: (sql, params) => captured.push({ sql, params }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(code + '\nload("U-1","T-9");\n', sandbox);
  const c = captured[0];
  assert.ok(c, 'مقياس الضرر: لم يُعترَض أي استعلام');
  if (c.params === undefined) {                 // استعلام مدمَج في النص
    const m = /a=([^ ]+) AND b=(.+?);?$/.exec(c.sql);
    return { mode: 'concat', a: m && m[1], b: m && m[2] };
  }
  return { mode: 'parameterized', a: c.params[0], b: c.params[1] };
}

// يشغّل خط الأنابيب كاملًا على ملف واحد ومخزن مزروع.
function runPipe(ctx, files, raw) {
  if (raw) ctx.__store.set(STORAGE_KEY, raw);
  vm.runInContext('F = ' + JSON.stringify(files) + ';', ctx);
  vm.runInContext('R = {}; Object.keys(F).forEach(k => { R[k] = { code: F[k], issues: analyzeCode(F[k], k) }; });', ctx);
  const report = vm.runInContext('fixAllEnginePipeline()', ctx);
  return { report, out: vm.runInContext('JSON.parse(JSON.stringify(F))', ctx) };
}

const applyWith = (engineSrc, pattern, code, fileName) => {
  const ctx = loadCtx(engineSrc);
  ctx.__store.set(STORAGE_KEY, seedDb(pattern));
  return { ctx, lr: ctx.LearningEngine.applyLearned(code, fileName || SRC_FILE) };
};

// ═══ 0. شروط العزل ═════════════════════════════════════

test('tripwire: المخزن حقيقي، وسطر V4 موجود مرة واحدة فقط', () => {
  const ctx = loadCtx(LE_HEAD);
  // getStats().total = db.patterns.length، لا meta.total — فيُقاس بعدد الأنماط.
  ctx.__store.set(STORAGE_KEY, JSON.stringify({
    patterns: [{ id: 'probe-1' }, { id: 'probe-2' }], safe: [], meta: { total: 2 },
  }));
  assert.strictEqual(ctx.LearningEngine.getStats().total, 2,
    'المخزن يقرأ ما كُتب فيه — ليس stub يُرجع null');
  ctx.__store.delete(STORAGE_KEY);
  assert.strictEqual(ctx.LearningEngine.getStats().total, 0,
    'وبإزالة المفتاح يعود صفرًا — أي أن القراءة من المخزن فعلاً في كل نداء');

  assert.strictEqual(LE_HEAD.split(V4_LINE).length - 1, 1,
    'سطر V4 يجب أن يظهر مرة واحدة بالضبط — وإلا فنسخة التعطيل تُعطّل غيره أو لا تُعطّل شيئًا');
  assert.notStrictEqual(LE_NO_V4, LE_HEAD, 'ونسخة التعطيل تختلف فعلاً عن الملف المُسلَّم');
});

test('isolation: النمط المزروع مؤهَّل، وقالبه مطابق لقالب النمط السليم', () => {
  const poison = mintPoison();
  const clean  = mintClean();

  // (أ) مؤهَّل: يعبر مرشّح goodPatterns بعتباته ولغته
  assert.strictEqual(poison.approved, true, 'معتمد');
  assert.ok(poison.confidence >= 0.20, 'confidence يتجاوز عتبة العميل');
  assert.ok(poison.verified >= 2, 'verified يتجاوز عتبة العميل');
  assert.strictEqual(poison.language, 'js', 'ولغته تطابق لغة ملف الضحية');

  // (ب) له قالب معمَّم فعلاً — وإلا فاختبارات القسم 1 فارغة
  assert.ok(poison.generalized && poison.generalized.afterTemplate,
    'القالب المعمَّم موجود في النمط المزروع');

  // (ج) والأهم: قالب "قبل" المبدِّل مطابق حرفيًا لقالب "قبل" السليم. فما
  // يطابق أحدهما يطابق الآخر ⇒ أي امتناع عن تطبيق المبدِّل لا يمكن نسبته
  // إلى فشل مطابقة، لأن السليم يُطبَّق على الضحية نفسها (القسم 2).
  assert.strictEqual(poison.generalized.beforeTemplate, clean.generalized.beforeTemplate,
    'القالبان يتقاسمان نفس قالب "قبل" بالضبط');
  assert.notStrictEqual(poison.generalized.afterTemplate, clean.generalized.afterTemplate,
    'والفرق كله في قالب "بعد" — أي في ترتيب الخانات');
});

// ═══ 1. كاشف (أحمر): السلوك المطلوب غير متحقق اليوم ════
//
// الثلاثة تؤكّد المنع، ولا شيء فيها يُضعَّف ليخضرّ. يخضرّون بالحماية وحدها.

test('كاشف: قالب مبدِّل مزروع ومعتمد لا يُطبَّق على الضحية', () => {
  const poison = mintPoison();
  const { lr } = applyWith(LE_HEAD, poison, VICTIM);

  assert.strictEqual(lr.applied, 0,
    `القالب المبدِّل يجب ألّا يُطبَّق. الناتج فعلاً: ${lr.fixed.split('\n')[1].trim()}`);
  assert.strictEqual(lr.fixed, VICTIM, 'والكود لم يتغيّر حرفًا واحدًا');
  assert.strictEqual(Array.from(lr.uses || []).length, 0, 'ولا نسبة لتعديل لم يحدث');
});

test('كاشف: ربط الأعمدة بالقيم لا ينقلب (مقياس تنفيذي لا نحوي)', () => {
  const poison = mintPoison();
  const { lr } = applyWith(LE_HEAD, poison, VICTIM);

  const before = columnBinding(VICTIM);
  assert.deepStrictEqual([before.a, before.b], ['U-1', 'T-9'],
    'العزل: قبل الإصلاح، a=userId و b=tenantId');

  const after = columnBinding(lr.fixed);
  assert.deepStrictEqual([after.a, after.b], ['U-1', 'T-9'],
    `ربط الأعمدة انقلب: a=${after.a} و b=${after.b} بدل a=U-1 و b=T-9`);
});

test('كاشف: لا يُكتب عبر بوابة خط الأنابيب ولا يُسجَّل PASS', () => {
  const poison = mintPoison();
  const ctx = loadCtx(LE_HEAD);
  const { report, out } = runPipe(ctx, { 'db.js': VICTIM }, seedDb(poison));

  assert.ok(!out['db.js'].includes('[tenantId, userId]'),
    `السطر المقلوب كُتب فعلاً في الملف: ${out['db.js'].split('\n')[1].trim()}`);

  const acc = (report.accepted || []).filter(a => a.source === 'applyLearned');
  assert.strictEqual(acc.length, 0, 'ولا قبول من مصدر applyLearned');

  const passes = (report.learnedOutcomes || []).filter(o => o.outcome === 'PASS');
  assert.strictEqual(passes.length, 0,
    'ولا حكم PASS — تسجيل النجاح لتعديل ضار أسوأ من التعديل نفسه');
});

// ═══ 2. إيجابي: الإصلاح السليم يبقى مقبولًا ════════════
//
// أخضر اليوم، ويجب أن يبقى أخضر بعد الحماية. وهو ما يمنع أن تكون الحماية
// مانعًا شاملاً لكل تعميم.

test('إيجابي: قالب يحفظ ترتيب الخانات يُطبَّق، وبربط صحيح', () => {
  const clean = mintClean();
  const { lr } = applyWith(LE_HEAD, clean, VICTIM);

  assert.strictEqual(lr.applied, 1, 'الإصلاح السليم يُطبَّق');
  assert.ok(lr.fixed.includes(KEPT_LINE), `الناتج: ${lr.fixed.split('\n')[1].trim()}`);
  assert.strictEqual(Array.from(lr.uses || [])[0].via, 'general',
    'وعبر المسار المعمَّم — وهو المسار الذي تمسّه الحماية');

  const after = columnBinding(lr.fixed);
  assert.deepStrictEqual([after.a, after.b], ['U-1', 'T-9'],
    'والربط كما كان: a=userId و b=tenantId');
});

test('إيجابي: والإصلاح السليم يجتاز البوابة ويُكتب في الملف', () => {
  const clean = mintClean();
  const ctx = loadCtx(LE_HEAD);
  const { report, out } = runPipe(ctx, { 'db.js': VICTIM }, seedDb(clean));

  assert.ok(out['db.js'].includes(KEPT_LINE),
    `السطر السليم يجب أن يُكتب. الناتج: ${out['db.js'].split('\n')[1].trim()}`);
  assert.ok((report.accepted || []).some(a => a.source === 'applyLearned'),
    'والبوابة قبلته بمصدر applyLearned');
  assert.ok((report.learnedOutcomes || []).some(o => o.outcome === 'PASS'),
    'وحكم P2 عليه PASS');
});

// ═══ 3. توثيقي: حدود مُعلَنة لا سلوك مطلوب ═════════════
//
// هذان لا يتغيّران بالحماية. يُسجَّلان حتى لا يُفهَم الأخضر على أنه تغطية.

test('documented: البوابات الثلاث تقبل الناتج المقلوب — فالبوابة ليست الحماية', () => {
  const ctx = loadCtx(LE_HEAD);
  // يُبنى الناتج المقلوب مباشرةً، بلا مرور بـapplyLearned، حتى يبقى هذا
  // التوثيق صحيحًا بعد الحماية أيضًا.
  const inverted = VICTIM.replace(
    'conn.exec("SELECT * FROM t WHERE a=" + userId + " AND b=" + tenantId);', SWAPPED_LINE);
  const correct  = VICTIM.replace(
    'conn.exec("SELECT * FROM t WHERE a=" + userId + " AND b=" + tenantId);', KEPT_LINE);

  // الضرر قائم في المقلوب
  const b = columnBinding(inverted);
  assert.deepStrictEqual([b.a, b.b], ['T-9', 'U-1'], 'المقلوب يربط كل قيمة بالعمود الخطأ');

  // ومع ذلك تقبله البوابات الثلاث
  const gv = ctx.GhostMode.verdict(VICTIM, inverted, 'db.js', ctx.analyzeCode);
  assert.notStrictEqual(gv.verdict, ctx.GhostMode.VERDICT.FAIL, 'Ghost لا يرفضه');
  assert.notStrictEqual(gv.verdict, ctx.GhostMode.VERDICT.REGRESSION, 'ولا يراه تدهورًا');
  assert.strictEqual(ctx.learnedSyntaxOk('db.js', VICTIM, inverted), true, 'والفحص النحوي يقبله');
  const fv = ctx.FixVerifier.verifyFix(VICTIM, inverted, 'db.js', ctx.analyzeCode, {});
  assert.strictEqual(fv.accepted, true, `وFixVerifier يقبله — ${fv.reason}`);

  // والسبب: المحلّل لا يفرّق بين المقلوب والسليم إطلاقًا
  const iBefore = ctx.analyzeCode(VICTIM, 'db.js');
  const iInv    = ctx.analyzeCode(inverted, 'db.js');
  const iOk     = ctx.analyzeCode(correct, 'db.js');
  assert.ok(iBefore.length >= 1, 'المحلّل يرى بلاغًا واحدًا على الأقل قبل الإصلاح');
  assert.deepStrictEqual(iInv.map(i => i.type), iOk.map(i => i.type),
    'قائمتا البلاغات متطابقتان: لا كاشف يمثّل تقابل المعامِل بالعمود');
});

// ═══ 4. المسار الحرفي (exact) — حرس ترتيب القيم ════════
//
// [V4″] المطابقة الحرفية لا قالب لها، فحماية القالب المعمَّم لا تمسّها.
// الحرس هنا على ترتيب المعرّفات خارج النصوص، عند نقطة الخانق نفسها.

// زوج حرفي يُبنى مرة واحدة: before هو سطر الضحية نصًّا، وafter يعكس الوسطاء.
const exactPair = (afterLine, id) => ({
  id, type: 'CWE_89', language: 'js',
  before: 'conn.exec("SELECT * FROM t WHERE a=" + userId + " AND b=" + tenantId);',
  after:  afterLine,
  generalized: null,
  observed: 3, verified: 3, failures: 0, confidence: 0.7, approved: true,
  created: 1, lastSeen: 1, context: {},
});

test('كاشف: زوج حرفي يعكس ترتيب الوسطاء لا يُطبَّق', () => {
  const { lr } = applyWith(LE_HEAD, exactPair(SWAPPED_LINE, 'exact-poison'), VICTIM);

  assert.strictEqual(lr.applied, 0,
    `الزوج الحرفي المقلوب يجب ألّا يُطبَّق. الناتج فعلاً: ${lr.fixed.split('\n')[1].trim()}`);
  assert.strictEqual(lr.fixed, VICTIM, 'والكود لم يتغيّر حرفًا واحدًا');

  // ولو طُبِّق لانقلب الربط — يُبنى الناتج مباشرةً لإثبات أن الخطر حقيقي
  const wouldBe = columnBinding(VICTIM.replace(
    'conn.exec("SELECT * FROM t WHERE a=" + userId + " AND b=" + tenantId);', SWAPPED_LINE));
  assert.deepStrictEqual([wouldBe.a, wouldBe.b], ['T-9', 'U-1'],
    'العزل: الناتج المقلوب يربط كل قيمة بالعمود الخطأ فعلاً');
});

test('إيجابي: زوج حرفي يحفظ ترتيب الوسطاء يُطبَّق عبر exact', () => {
  const { lr } = applyWith(LE_HEAD, exactPair(KEPT_LINE, 'exact-clean'), VICTIM);

  assert.strictEqual(lr.applied, 1, 'الزوج الحرفي السليم يُطبَّق');
  assert.strictEqual(Array.from(lr.uses || [])[0].via, 'exact', 'وعبر المطابقة الحرفية');
  const after = columnBinding(lr.fixed);
  assert.deepStrictEqual([after.a, after.b], ['U-1', 'T-9'],
    'والربط كما كان — فالحرس ليس مانعًا شاملاً للمسار الحرفي');
});

test('documented: ثغرتان باقيتان في نفس عائلة الضرر — مقيستان لا مفترضتان', () => {
  // [V4″] يقيس ترتيب المعرّفات **خارج النصوص**. واستثناء النصوص ضرورة لا
  // خيار: تغيير النص هو جوهر معظم الإصلاحات السليمة (md5→sha256، والدمج
  // ⇒ المعامِلات)، فقياس ترتيبه يرفض السليم رفضًا كاذبًا. والنتيجة ثغرتان:
  //
  //  (أ) انعكاس الأعمدة **داخل** النص مع ثبات ترتيب المعرّفات ⇒ نفس
  //      انقلاب الربط، بطريق آخر. إغلاقه يحتاج فحصًا مخصّصًا لشكل SQL
  //      المُعامَل (تقابل كل ? بترتيب الوسطاء) — قرار نطاق لا إصلاح محدود.
  //  (ب) انعكاس معامِل (> ⇒ <) مع حفظ الترتيب حرفيًا ⇒ عائلة أخرى، ولا
  //      يراها V4 ولا V4′ ولا V4″ ولا البوابة.
  //
  // هذا الاختبار يثبّت الحدّين كما هما. إن أُغلق أحدهما فسيفشل صراحةً —
  // وهو المقصود: لا يُغلق حدٌّ بصمت ولا يُنسى.
  const victimSql = VICTIM;
  const lineSql   = 'conn.exec("SELECT * FROM t WHERE a=" + userId + " AND b=" + tenantId);';
  const strInvert = 'conn.exec("SELECT * FROM t WHERE b=? AND a=?", [userId, tenantId]);';

  const r1 = applyWith(LE_HEAD, exactPair(strInvert, 'doc-str-invert'), victimSql);
  assert.strictEqual(r1.lr.applied, 1,
    '(أ) انعكاس الأعمدة داخل النص ما زال يُطبَّق — حدّ مُعلَن');
  assert.ok(r1.lr.fixed.includes('b=? AND a=?'), 'والناتج يحمل الأعمدة مقلوبة');

  const victimOp = 'function chk(age, limit) {\n  if (age > limit) { return allow(); }\n  return deny();\n}\n';
  const opPair = Object.assign(exactPair('if (age < limit) { return allow(); }', 'doc-op-invert'),
                               { before: 'if (age > limit) { return allow(); }' });
  const r2 = applyWith(LE_HEAD, opPair, victimOp, 'chk.js');
  assert.strictEqual(r2.lr.applied, 1,
    '(ب) انعكاس المعامِل ما زال يُطبَّق — عائلة أخرى خارج النطاق');
  assert.ok(r2.lr.fixed.includes('age < limit'), 'والناتج يحمل المعامِل معكوسًا');
});

test('إيجابي: الأزواج الحرفية المعروفة الصحيحة ما زالت تُطبَّق', () => {
  // أربعة أزواج من ذخيرة المحرك: لا يعيد أيٌّ منها ترتيب المعرّفات.
  const cases = [
    { file: 'a.js',  code: 'function f() {\n  const API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";\n  return API_KEY;\n}\n',
      before: 'const API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";',
      after:  'const API_KEY = process.env.API_KEY;' },
    { file: 'h.js',  code: 'function h(d) {\n  return crypto.createHash("md5").update(d).digest("hex");\n}\n',
      before: 'return crypto.createHash("md5").update(d).digest("hex");',
      after:  'return crypto.createHash("sha256").update(d).digest("hex");' },
    { file: 'v.js',  code: 'function r(box, m) {\n  box.innerHTML = box.innerHTML + m;\n}\n',
      before: 'box.innerHTML = box.innerHTML + m;',
      after:  'box.textContent = box.textContent + m;' },
    { file: 'q.js',  code: 'function s(id) {\n  db.query("SELECT * FROM u WHERE id=" + id);\n}\n',
      before: 'db.query("SELECT * FROM u WHERE id=" + id);',
      after:  'db.query("SELECT * FROM u WHERE id=?", [id]);' },
  ];
  for (const c of cases) {
    const p = Object.assign(exactPair(c.after, 'ok-' + c.file), { before: c.before });
    const { lr } = applyWith(LE_HEAD, p, c.code, c.file);
    assert.strictEqual(lr.applied, 1, `[${c.file}] ${c.before} ⇒ ${c.after} يجب أن يُطبَّق`);
    assert.ok(lr.fixed.includes(c.after), `[${c.file}] والناتج يحمل الإصلاح`);
  }
});
