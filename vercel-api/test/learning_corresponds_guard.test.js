// ═══════════════════════════════════════════════════════
// learning_engine.js — بوابة corresponds() على تخزين أنماط التعلّم
// تشغيل:  node --test vercel-api/test/learning_corresponds_guard.test.js
//
// D2-CORRESPONDS. pickCorresponding تربط سطر الإصلاح بالسطر الأصلي داخل نفس
// الـhunk. قبل 0576d85 كانت تُرجع المرشّح الوحيد بلا أي فحص تقابل، فيُخزَّن
// زوج مثل:
//     before: console.log("sk_live_…");
//     after : const API_KEY = process.env.API_KEY;
// وتطبيقه لاحقًا يحذف الاستدعاء ويضع مكانه تصريحًا. الإصلاح كان بوابة
// corresponds() على كل مسارات الاختيار، بما فيها حالة المرشّح الوحيد.
//
// هذا الملف يثبّت أربعة أشياء، كلها مقيسة:
//
//  1) الحارس حامل للحمل: الزوج غير المتقابل يُرفض عند HEAD، ويُخزَّن إذا
//     عُطِّل سطر confirm وحده (نسخة في الذاكرة — لا يُمَسّ أي ملف إنتاج).
//
//  2) البوابات الموروثة لا تنقذنا، وحرس V2′ ينقذنا. لو خُزِّن النمط المسموم
//     واعتُمد، فإن تطبيقه يجتاز GhostMode.verdict و learnedSyntaxOk و
//     FixVerifier.verifyFix كلها — وهذا مقيس ومحفوظ هنا كما كان. والذي
//     يمنع التطبيق هو preservesTarget في applyLearned، فصار الدفاع طبقتين:
//       corresponds() يمنع **التخزين**،
//       وV2′ يمنع **التطبيق** ولو كان النمط مزروعًا في المخزن أصلاً.
//     [P1] قبل V2′ كان هذا القسم يؤكّد أن النمط المسموم يُطبَّق فعلاً — أي
//     يؤكّد غياب حماية. صار يؤكّد وجودها، مع إبقاء تتبّع البوابات الموروثة
//     دليلاً على أن الأخضر ليس مصدره مرحلة أخرى.
//
//  3) الحارس ليس مفرط التقييد: الأزواج الصحيحة المعروفة ما زالت تُتعلَّم.
//
//  4) [V4] حفظ ترتيب الخانات في التعميم: القالب الذي يبدّل مواضع المعامِلات
//     لا يُخزَّن معمَّمًا، والقالب الذي يحفظ ترتيبها يُخزَّن. والقسم 6 يثبت
//     أن V4 وحده هو الفاعل — بتعطيله يُخزَّن القالب المبدِّل فعلاً.
//
// وتُسجَّل في القسمين 4 و5 نتائج التدقيق التي لم تُصلَح بعد (todo)، مع
// تمييز صريح بين خلل مُثبَت الوصول واحتمال على مستوى الدالة فقط.
//
// ملاحظة على الـharness: localStorage هنا مخزن حقيقي في الذاكرة. الـstub
// الشائع ‎{ getItem: () => null }‎ يجعل getStats().total صفرًا دائمًا لأن
// load() يقرأ من localStorage في كل نداء — فأي قياس تخزين عبره بلا معنى.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const LE_PATH    = path.join(PUBLIC_DIR, 'learning_engine.js');
const LE_HEAD    = fs.readFileSync(LE_PATH, 'utf8');
const STORAGE_KEY = 're_learned_patterns_v2';

// سطر البوابة كما هو في الملف المُسلَّم. إن تغيّر نصه فهذا الاختبار يفشل
// صراحةً بدل أن يمرّ بصمت وهو يقيس نسخة لم تُعطَّل فعلاً.
const GATE_LINE = 'const confirm = c => (c && corresponds(beforeLine, c.line)) ? c : null;';
const LE_NO_GATE = LE_HEAD.replace(GATE_LINE, 'const confirm = c => (c || null);');

// [P1] حرس V2′ في applyLearned — نقطة الخانق الوحيدة قبل الكتابة. نسخة
// بتعطيله وحده تُثبت أنه هو الفاعل لا مرحلة أخرى، بنفس انضباط GATE_LINE.
const V2_LINE   = '      if (!preservesTarget(t, replacement)) continue;';
const LE_NO_V2  = LE_HEAD.replace(V2_LINE, '      if (false) continue;');

// [P1/V4] شرط حفظ ترتيب الخانات في isGeneralPatternUsable — يرفض **التعميم**
// لا الزوج. نسخة بتعطيله وحده تُثبت أنه هو من يرفض القالب المبدِّل، بنفس
// انضباط GATE_LINE و V2_LINE. القسم 6 أدناه هو انحدار هذه الحماية.
const V4_LINE   = '    if (seqAt !== afterSeq.length) return false;';
const LE_NO_V4  = LE_HEAD.replace(V4_LINE, '    if (false) return false;');

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

// يتعلّم زوجًا ويُرجع ما خُزِّن فعلاً
function learnPair(before, after, file, src) {
  const ctx = loadCtx(src);
  const issues = ctx.analyzeCode(before, file);
  const ids = ctx.LearningEngine.learn(before, after, issues, file);
  return { ctx, ids, stats: ctx.LearningEngine.getStats(), issues };
}

// أنواع البلاغات التي يمكن أن تصل التعلّم: extractPair يرفض fail-closed أي
// نوع لا يحوي مفتاحًا من TYPE_FIXES، ويقرأ (issue.type || issue.cAct) فقط.
const LEARNABLE_TYPE = /secret|hardcoded|cwe_798|sql|cwe_89|xss|crypto|cwe_327|eval|cmd|accumul|counter/;
const learnableTypes = issues =>
  issues.map(i => String(i.type || i.cAct || '')).filter(t => LEARNABLE_TYPE.test(t.toLowerCase()));

// ─── أزواج ثابتة ────────────────────────────────────────
const FILE = 'auth.js';

// الزوج غير المتقابل: السطر المبلَّغ عنه استدعاء، والمرشّح الوحيد تصريح.
const NC_BEFORE = 'function auth() {\n  console.log("sk_live_51H8xQ2abcdefghijKLMN");\n  return 1;\n}\n';
const NC_AFTER  = 'function auth() {\n  const API_KEY = process.env.API_KEY;\n  return 1;\n}\n';

// الزوج المتقابل: إسناد لنفس الهدف.
const C_BEFORE = 'function auth() {\n  const API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";\n  return API_KEY;\n}\n';
const C_AFTER  = 'function auth() {\n  const API_KEY = process.env.API_KEY;\n  return API_KEY;\n}\n';

// ═══ 0. شروط العزل ═════════════════════════════════════

test('tripwire: سطر البوابة موجود حرفيًا في الملف المُسلَّم', () => {
  assert.ok(LE_HEAD.includes(GATE_LINE),
    'سطر confirm تغيّر — نسخة "الحارس معطَّل" في هذا الملف لم تعطّل شيئًا، فكل قياس بعدها باطل');
  assert.notStrictEqual(LE_NO_GATE, LE_HEAD, 'نسخة التعطيل يجب أن تختلف فعلاً عن HEAD');
});

test('tripwire: سطر حرس V2′ موجود حرفيًا في الملف المُسلَّم', () => {
  assert.ok(LE_HEAD.includes(V2_LINE),
    'سطر preservesTarget تغيّر — نسخة "V2′ معطَّل" لم تعطّل شيئًا، فكل قياس بعدها باطل');
  assert.notStrictEqual(LE_NO_V2, LE_HEAD, 'نسخة التعطيل يجب أن تختلف فعلاً عن HEAD');
  assert.ok(/function preservesTarget\(beforeLine, afterLine\)/.test(LE_HEAD),
    'دالة الحرس يجب أن تكون موجودة بالاسم المتوقَّع');
});

test('tripwire: المخزن في الـharness حقيقي، لا stub يُرجع null', () => {
  const ctx = loadCtx(LE_HEAD);
  ctx.localStorage.setItem('k', 'v');
  assert.strictEqual(ctx.localStorage.getItem('k'), 'v',
    'بلا مخزن حقيقي يبقى getStats().total صفرًا دائمًا فلا يقيس التخزين');
});

test('isolation: الزوجان يصلان pickCorresponding فعلاً (نوع البلاغ قابل للتعلّم)', () => {
  for (const [label, before] of [['غير متقابل', NC_BEFORE], ['متقابل', C_BEFORE]]) {
    const ctx = loadCtx(LE_HEAD);
    const types = learnableTypes(ctx.analyzeCode(before, FILE));
    assert.ok(types.length >= 1,
      `${label}: لا نوع قابل للتعلّم ⇒ extractPair يرفض قبل الحارس، فالاختبار لا يقيس الحارس`);
  }
});

// ═══ 1. الحارس حامل للحمل ══════════════════════════════

test('الزوج المتقابل يُخزَّن عند HEAD (الحارس ليس مفرط التقييد)', () => {
  const { stats } = learnPair(C_BEFORE, C_AFTER, FILE, LE_HEAD);
  assert.ok(stats.total >= 1, 'إسناد لنفس الهدف تقابل مؤكد — يجب أن يُخزَّن');
  assert.ok(stats.patterns.every(p => /process\.env/.test(p.after)),
    'المخزَّن يجب أن يكون سطر الإصلاح الفعلي');
});

test('الزوج غير المتقابل يُرفض عند HEAD', () => {
  const { stats } = learnPair(NC_BEFORE, NC_AFTER, FILE, LE_HEAD);
  assert.strictEqual(stats.total, 0,
    'استدعاء ⇄ تصريح ليسا متقابلين — تخزينه يعني أن تطبيقه لاحقًا يحذف استدعاءً');
});

test('نفس الزوج يُخزَّن إذا عُطِّل سطر confirm وحده ⇒ الحارس هو الفاعل', () => {
  const { stats } = learnPair(NC_BEFORE, NC_AFTER, FILE, LE_NO_GATE);
  assert.ok(stats.total >= 1,
    'بتعطيل الحارس يجب أن يُخزَّن — وإلا فالرفض في الاختبار السابق مصدره مرحلة أخرى لا corresponds()');
  assert.ok(stats.patterns.some(p => /^console\.log\(/.test(p.before) && /^const API_KEY = process\.env/.test(p.after)),
    'المخزَّن هو الزوج المسموم نفسه الموصوف في رسالة 0576d85');
});

// ═══ 2. لا بوابة لاحقة تنقذنا ══════════════════════════
// لو خُزِّن النمط المسموم واعتُمد، يجتاز كل البوابات اللاحقة. هذا ما يجعل
// corresponds() خط الدفاع الوحيد، لا طبقة احتياطية.

function seedApprovedPoison(src, before, after) {
  const seed = loadCtx(src);
  const ids = seed.LearningEngine.learn(before, after, seed.analyzeCode(before, FILE), FILE);
  ids.forEach(id => { seed.LearningEngine.verify(id, true); seed.LearningEngine.verify(id, true); });
  return { raw: seed.__store.get(STORAGE_KEY), stats: seed.LearningEngine.getStats() };
}

test('النمط المسموم يبلغ approved بتحققين فقط (MIN_VERIFIED=2)', () => {
  const { stats } = seedApprovedPoison(LE_NO_GATE, NC_BEFORE, NC_AFTER);
  assert.ok(stats.approved >= 1, 'تحققان يكفيان للاعتماد — فعتبة الاعتماد ليست حاجزًا');
});

// ضحية مشتركة بين الاختبارين التاليين: ناتجها يُحلَّل نحويًا، فأي رفض ليس
// بسبب صياغة مكسورة.
const NC_VICTIM = 'function send(key) {\n  console.log("sk_live_51H8xQ2abcdefghijKLMN");\n' +
                  '  return post(key);\n}\nsend("x");\n';

test('V2′ يمنع تطبيق النمط المسموم ولو كان مزروعًا في المخزن ومعتمدًا', () => {
  const { raw, stats } = seedApprovedPoison(LE_NO_GATE, NC_BEFORE, NC_AFTER);
  // عزل: النمط مزروع ومعتمد فعلاً — وإلا فالأخضر بلا معنى
  assert.ok(stats.total >= 1,    'العزل: النمط المسموم مخزَّن في المخزن المزروع');
  assert.ok(stats.approved >= 1, 'العزل: ومعتمد — فالمنع ليس سببه عتبة الاعتماد');

  const run = loadCtx(LE_HEAD);
  run.__store.set(STORAGE_KEY, raw);
  const lr = run.LearningEngine.applyLearned(NC_VICTIM, 'victim.js');

  assert.strictEqual(lr.applied, 0, 'V2′ يمنع التطبيق: استدعاء ⇄ تصريح تغيّرُ شكلٍ');
  assert.strictEqual(lr.fixed, NC_VICTIM, 'والكود الناتج لم يتغيّر حرفًا واحدًا');
  assert.match(lr.fixed, /console\.log\(/, 'والاستدعاء الوظيفي باقٍ — لا ضرر');

  // ولا يصل مسار القبول أصلاً: خط الأنابيب يشترط applied>0 و fixed!==before
  // قبل أن يعرض المرشّح على البوابة (fix_engine_pipeline.js:340).
  assert.ok(!(lr.applied > 0 && lr.fixed !== NC_VICTIM),
    'شرط دخول البوابة غير مستوفى — فالنمط المسموم لا يُعرض كإصلاح صالح');
});

test('ومصدر المنع هو V2′ وحده: بتعطيله يُطبَّق النمط ويجتاز Ghost و learnedSyntaxOk و FixVerifier', () => {
  const { raw } = seedApprovedPoison(LE_NO_GATE, NC_BEFORE, NC_AFTER);
  const run = loadCtx(LE_NO_V2);
  run.__store.set(STORAGE_KEY, raw);
  const lr = run.LearningEngine.applyLearned(NC_VICTIM, 'victim.js');

  assert.ok(lr.applied >= 1 && lr.fixed !== NC_VICTIM,
    'بتعطيل V2′ يُطبَّق — فالرفض في الاختبار السابق مصدره V2′ لا مرحلة أخرى');
  assert.doesNotMatch(lr.fixed, /console\.log/, 'الاستدعاء الوظيفي حُذف — هذا هو الضرر');

  // التتبّع الأصلي محفوظ كما هو: البوابات الموروثة لا ترفض هذا الضرر.
  const lv = run.GhostMode.verdict(NC_VICTIM, lr.fixed, 'victim.js', run.analyzeCode);
  assert.notStrictEqual(lv.verdict, run.GhostMode.VERDICT.FAIL, 'Ghost لا يرفضه');
  assert.notStrictEqual(lv.verdict, run.GhostMode.VERDICT.REGRESSION, 'Ghost لا يعتبره ارتدادًا');
  assert.strictEqual(run.learnedSyntaxOk('victim.js', NC_VICTIM, lr.fixed), true,
    'الفحص النحوي لا يرفضه');
  const v = run.FixVerifier.verifyFix(NC_VICTIM, lr.fixed, 'victim.js', run.analyzeCode);
  assert.ok(v.accepted, `والبوابة لا ترفضه — ${v.reason}`);
});

test('وعند HEAD لا يوجد ما يُطبَّق أصلاً: النمط لم يُخزَّن', () => {
  const { raw, stats } = seedApprovedPoison(LE_HEAD, NC_BEFORE, NC_AFTER);
  assert.strictEqual(stats.total, 0, 'لا نمط مخزَّن');
  const run = loadCtx(LE_HEAD);
  if (raw) run.__store.set(STORAGE_KEY, raw);
  const victim = 'function send(key) {\n  console.log("sk_live_51H8xQ2abcdefghijKLMN");\n  return post(key);\n}\nsend("x");\n';
  const lr = run.LearningEngine.applyLearned(victim, 'victim.js');
  assert.strictEqual(lr.applied, 0, 'ولا شيء يُطبَّق');
  assert.strictEqual(lr.fixed, victim, 'والكود يبقى كما هو');
});

// ═══ 3. الأزواج الصحيحة ما زالت تُتعلَّم ═══════════════

const GOOD_PAIRS = {
  'secret (js)': ['a.js', C_BEFORE, C_AFTER, /process\.env/],
  'secret (py)': ['a.py',
    'def auth():\n    API_KEY = "sk_live_51H8xQ2abcdefghijKLMN"\n    return API_KEY\n',
    'def auth():\n    API_KEY = os.environ.get("API_KEY")\n    return API_KEY\n', /os\.environ\.get/],
  'md5 → sha256': ['a.js',
    'const crypto = require("crypto");\nfunction hashPw(pw) {\n  const h = crypto.createHash("md5");\n  return h.update(pw).digest("hex");\n}\nhashPw("x");\n',
    'const crypto = require("crypto");\nfunction hashPw(pw) {\n  const h = crypto.createHash("sha256");\n  return h.update(pw).digest("hex");\n}\nhashPw("x");\n', /sha256/],
  'innerHTML → textContent': ['a.js',
    'function show(user) {\n  el.innerHTML = user.bio;\n}\nshow({});\n',
    'function show(user) {\n  el.textContent = user.bio;\n}\nshow({});\n', /textContent/],
};

for (const [label, [file, before, after, expect]] of Object.entries(GOOD_PAIRS)) {
  test(`الزوج الصحيح ما زال يُتعلَّم: ${label}`, () => {
    const { stats } = learnPair(before, after, file, LE_HEAD);
    assert.ok(stats.total >= 1, `${label}: يجب أن يُخزَّن`);
    assert.ok(stats.patterns.some(p => expect.test(p.after)), `${label}: المخزَّن هو الإصلاح الصحيح`);
  });
}

// ═══ 4. خلل مُثبَت الوصول — لم يُصلَح بعد ═══════════════
// قاعدة corresponds() اتجاهية: ‎if (!bt && at) return false;‎ تمنع
// "استدعاء ⇄ تصريح"، ولا تمنع العكس "تصريح ⇄ استدعاء". والعكس يسقط إلى
// تقاطع المعرّفات فيمرّ لمجرد تقاسم اسم واحد. وهو قابل للوصول بالمحلل
// الحقيقي: البلاغ من نوع secret/HARDCODED_SECRET، والمرشّح يحوي process.env
// فيطابق TYPE_FIXES.

const REV_BEFORE = 'function auth() {\n  const API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";\n  return fetch(URL, { key: API_KEY });\n}\n';
const REV_AFTER  = 'function auth() {\n  sendKey(process.env.API_KEY);\n  return fetch(URL, { key: API_KEY });\n}\n';

// (أ) اتجاهية corresponds() — صار في النطاق، فالتأكيد مُفعَّل لا todo.
test('الاتجاه المعاكس (تصريح ⇄ استدعاء) لا يُخزَّن', () => {
  const { stats } = learnPair(REV_BEFORE, REV_AFTER, FILE, LE_HEAD);
  assert.strictEqual(stats.total, 0,
    'حذف تصريح واستبداله باستدعاء ضرر من نفس صنف ما أصلحه D2، في الاتجاه المعاكس');
});

test('الاتجاه المعاكس يصل الحارس فعلاً — فالرفض منه لا من extractPair', () => {
  const ctx = loadCtx(LE_HEAD);
  assert.ok(learnableTypes(ctx.analyzeCode(REV_BEFORE, FILE)).length >= 1,
    'نوع البلاغ قابل للتعلّم');
  // والمرشّح يطابق regex إصلاح secret في TYPE_FIXES، فيصل pickCorresponding
  assert.match(REV_AFTER, /process\.env/, 'المرشّح يطابق regex النوع');
});

test('وبتعطيل الحارس يُخزَّن الاتجاه المعاكس ⇒ الحارس هو من يرفضه', () => {
  const { stats } = learnPair(REV_BEFORE, REV_AFTER, FILE, LE_NO_GATE);
  assert.ok(stats.total >= 1,
    'بلا الحارس يُخزَّن — فالرفض في الاختبار السابق مصدره corresponds() وحدها');
});

// (ب) القالب المعمَّم — أُصلح في جولة الجزء (ب)، فالتأكيد صار مُفعَّلاً.
// البذرة زوج صحيح لا مسموم: إسناد ↔ إسناد نفس الهدف، تقابله مؤكد. فلو كان
// الأخضر هنا ناتجاً عن تعذّر التخزين لكان نجاحاً شكلياً — ولذلك يؤكّد
// الاختبار أولاً أن البذرة مخزَّنة ومعتمدة فعلاً.
// التغطية الكاملة للجزء (ب) في learning_generalize_scope.test.js.
test('القالب المعمَّم لا يعيد كتابة ثوابت غير مرتبطة', () => {
    const { raw, stats } = seedApprovedPoison(LE_HEAD, C_BEFORE, C_AFTER);
    assert.ok(stats.approved >= 1, 'البذرة زوج صحيح معتمد — لا نمط مسموم');
    const run = loadCtx(LE_HEAD);
    run.__store.set(STORAGE_KEY, raw);
    // ضحية فيها سرّ حقيقي (فيُسقِط التعديل بلاغًا ويجتاز requireImprovement)
    // زائد ثابتان لا علاقة لهما بالأسرار إطلاقًا
    const victim =
      'function setupApp() {\n' +
      '  const SECRET_TOKEN = "sk_live_9ZQ8xW2abcdefghijKLMN";\n' +
      '  const APP_NAME = "Reality Engine";\n' +
      '  const VERSION = "2.1.0";\n' +
      '  return render(SECRET_TOKEN, APP_NAME, VERSION);\n}\n';
    const lr = run.LearningEngine.applyLearned(victim, 'app.js');
    const v = run.FixVerifier.verifyFix(victim, lr.fixed, 'app.js', run.analyzeCode);
    assert.ok(!(lr.applied > 1 && v.accepted),
      `أُعيدت كتابة ${lr.applied} تصريحات والبوابة ${v.accepted ? 'قبلت' : 'رفضت'} — ` +
      'الثوابت غير ذات الصلة صارت تقرأ من process.env فتصير undefined');
  });

test('سطح التعلّم: زوج التراكم (= → +=) لا يصل التعلّم إطلاقًا',
  { todo: 'خلل مُثبَت: extractPair يقرأ (type || cAct) فقط، وبلاغ التراكم type="bug" وتسميته ACCUMULATION في strategy. مؤجَّل' },
  () => {
    const code = 'let totalScore = 0;\nfunction sumScores(ps) {\n  for (const p of ps) {\n    totalScore = p.score;\n  }\n  return totalScore;\n}\nsumScores([]);\n';
    const fixed = code.replace('totalScore = p.score;', 'totalScore += p.score;');
    const { stats, issues } = learnPair(code, fixed, 'a.js', LE_HEAD);
    assert.ok(issues.some(i => /ACCUMULATION/.test(String(i.type || ''))),
      'مفتاح accumul في TYPE_FIXES يتطلب أن يكون ACCUMULATION في type لا في strategy');
    assert.ok(stats.total >= 1, 'الزوج الصحيح للتراكم يجب أن يُتعلَّم');
  });

// ═══ 4ب. تناظر القاعدة: أي تغيّر لشكل العبارة يُرفض ══════
// corresponds() كانت تمنع "استدعاء ⇄ تصريح" فقط. والمطلوب أن يُرفض تغيّر
// الشكل في الاتجاهين: إسناد ⇄ غير إسناد، أيهما كان الأصل.

// أزواج تغيّر شكل العبارة ⇒ يجب ألا تُخزَّن، كلها على المسار الحقيقي.
const SHAPE_CHANGE = {
  'تصريح متغيّر ← استدعاء دالة': [FILE, REV_BEFORE, REV_AFTER],
  'استدعاء دالة ← تصريح متغيّر': [FILE, NC_BEFORE, NC_AFTER],
  'تصريح سرّ ← استدعاء يقرأ من process.env': [FILE,
    'function auth() {\n  const TOKEN = "sk_live_7YQ3xZ9abcdefghijKLMN";\n  return use(TOKEN);\n}\n',
    'function auth() {\n  loadToken(process.env.TOKEN);\n  return use(TOKEN);\n}\n'],
  'إسناد خاصية ← استدعاء': [FILE,
    'function show(user) {\n  el.innerHTML = user.bio;\n}\nshow({});\n',
    'function show(user) {\n  el.setText(sanitize(user.bio));\n}\nshow({});\n'],
};

for (const [label, [file, before, after]] of Object.entries(SHAPE_CHANGE)) {
  test(`تغيّر الشكل لا يُخزَّن: ${label}`, () => {
    // أولاً: الزوج يصل الحارس فعلاً (وإلا لا يقيس الاختبار الحارس)
    const ctx = loadCtx(LE_HEAD);
    assert.ok(learnableTypes(ctx.analyzeCode(before, file)).length >= 1,
      `${label}: لا نوع قابل للتعلّم ⇒ extractPair يرفض قبل الحارس`);
    const { stats } = learnPair(before, after, file, LE_HEAD);
    assert.strictEqual(stats.total, 0, `${label}: تغيّر شكل العبارة ⇒ لا تقابل`);
  });
}

// تصريح سرّ ← قراءة من process.env في **نفس** شكل الإسناد: يجب أن يُتعلَّم.
// هذا هو الإصلاح الحقيقي الذي يُنتجه المحرك، والتشديد لا يجوز أن يكسره.
test('تصريح سرّ ← قراءة process.env بنفس الشكل: يُتعلَّم', () => {
  const { stats } = learnPair(
    'function auth() {\n  const TOKEN = "sk_live_7YQ3xZ9abcdefghijKLMN";\n  return use(TOKEN);\n}\n',
    'function auth() {\n  const TOKEN = process.env.TOKEN;\n  return use(TOKEN);\n}\n',
    FILE, LE_HEAD);
  assert.ok(stats.total >= 1, 'إسناد لنفس الهدف ⇒ تقابل مؤكد');
  assert.ok(stats.patterns.some(p => /process\.env\.TOKEN/.test(p.after)));
});

// معيار الإغلاق: النمط المسموم لا يصل الاعتماد النهائي، ولا لسبب لاحق.
test('إغلاق: النمط المسموم لا يُخزَّن ولا يُعتمد ولا يُطبَّق — في الاتجاهين', () => {
  for (const [label, before, after] of [
    ['استدعاء ← تصريح', NC_BEFORE, NC_AFTER],
    ['تصريح ← استدعاء', REV_BEFORE, REV_AFTER],
  ]) {
    const { raw, stats } = seedApprovedPoison(LE_HEAD, before, after);
    assert.strictEqual(stats.total, 0, `${label}: لا يُخزَّن`);
    assert.strictEqual(stats.approved, 0, `${label}: فلا يُعتمد`);

    const run = loadCtx(LE_HEAD);
    if (raw) run.__store.set(STORAGE_KEY, raw);
    const victim = 'function send(key) {\n  console.log("sk_live_51H8xQ2abcdefghijKLMN");\n' +
                   '  const API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";\n  return post(key, API_KEY);\n}\nsend("x");\n';
    const lr = run.LearningEngine.applyLearned(victim, 'victim.js');
    assert.strictEqual(lr.applied, 0, `${label}: ولا يُطبَّق`);
    assert.strictEqual(lr.fixed, victim, `${label}: والكود يبقى كما هو`);
  }
});

// الاتجاه المعاكس: نفس الطبقتين. corresponds يمنع التخزين، وV2′ يمنع التطبيق
// لو كان النمط مزروعًا — والبوابات الموروثة لا تمنع شيئًا، وهو ما يُثبته
// الاختبار الثاني بتعطيل V2′ وحده.
const REV_VICTIM = 'function boot() {\n  const API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";\n' +
                   '  return connect(API_KEY);\n}\nboot();\n';

test('إغلاق: V2′ يمنع تطبيق الاتجاه المعاكس ولو كان مزروعًا ومعتمدًا', () => {
  const { raw, stats } = seedApprovedPoison(LE_NO_GATE, REV_BEFORE, REV_AFTER);
  assert.ok(stats.approved >= 1, 'العزل: بتعطيل الحارس يُخزَّن ويُعتمد فعلاً');

  const run = loadCtx(LE_HEAD);
  run.__store.set(STORAGE_KEY, raw);
  const lr = run.LearningEngine.applyLearned(REV_VICTIM, 'app.js');

  assert.strictEqual(lr.applied, 0, 'V2′ يمنع التطبيق: تصريح ⇄ استدعاء تغيّرُ شكلٍ');
  assert.strictEqual(lr.fixed, REV_VICTIM, 'والكود الناتج لم يتغيّر حرفًا واحدًا');
  assert.match(lr.fixed, /const API_KEY = /, 'والتصريح باقٍ — فلا مرجع يصير غير معرَّف');
  assert.ok(!(lr.applied > 0 && lr.fixed !== REV_VICTIM),
    'شرط دخول البوابة غير مستوفى — فلا يُعرض كإصلاح صالح');
});

test('إغلاق: ومصدر المنع V2′ — بتعطيله يُطبَّق الاتجاه المعاكس ويجتاز Ghost و FixVerifier', () => {
  const { raw } = seedApprovedPoison(LE_NO_GATE, REV_BEFORE, REV_AFTER);
  const run = loadCtx(LE_NO_V2);
  run.__store.set(STORAGE_KEY, raw);
  const lr = run.LearningEngine.applyLearned(REV_VICTIM, 'app.js');

  assert.ok(lr.applied >= 1 && lr.fixed !== REV_VICTIM,
    'بتعطيل V2′ يُطبَّق — فهو الفاعل في الاختبار السابق');
  const lv = run.GhostMode.verdict(REV_VICTIM, lr.fixed, 'app.js', run.analyzeCode);
  assert.notStrictEqual(lv.verdict, run.GhostMode.VERDICT.FAIL, 'Ghost لا يرفضه');
  assert.notStrictEqual(lv.verdict, run.GhostMode.VERDICT.REGRESSION, 'ولا يعتبره ارتدادًا');
  assert.strictEqual(run.learnedSyntaxOk('app.js', REV_VICTIM, lr.fixed), true,
    'الفحص النحوي لا يرفضه');
  const v = run.FixVerifier.verifyFix(REV_VICTIM, lr.fixed, 'app.js', run.analyzeCode);
  assert.ok(v.accepted, `والبوابة لا ترفضه — ${v.reason}`);
});

// الطرف الإيجابي: V2′ ليس حظرًا شاملاً. إصلاح سليم بنفس شكل العبارة ونفس
// هدف الإسناد ما زال يُطبَّق ويُقبل. بلا هذا الاختبار يمكن أن يُرضى شرط
// «صفر ضرر» برفض كل شيء.
test('إيجابي: V2′ لا يمنع إصلاحًا سليمًا — نفس الهدف ونفس الشكل', () => {
  const { raw, stats } = seedApprovedPoison(LE_HEAD, C_BEFORE, C_AFTER);
  assert.ok(stats.approved >= 1, 'العزل: البذرة زوج صحيح مخزَّن ومعتمد بلا تعطيل أي حارس');

  const run = loadCtx(LE_HEAD);
  run.__store.set(STORAGE_KEY, raw);
  const victim = 'function z() {\n  const API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";\n' +
                 '  return API_KEY;\n}\nz();\n';
  const lr = run.LearningEngine.applyLearned(victim, 'z.js');

  assert.ok(lr.applied >= 1, 'الإصلاح السليم ما زال يُطبَّق');
  assert.match(lr.fixed, /const API_KEY = process\.env\.API_KEY;/, 'والناتج هو الإصلاح الصحيح');
  const sec = c => run.analyzeCode(c, 'z.js')
    .filter(i => /secret|hardcoded/i.test(String(i.type || ''))).length;
  assert.ok(sec(lr.fixed) < sec(victim), 'وبلاغ السرّ انخفض فعلاً');
  const v = run.FixVerifier.verifyFix(victim, lr.fixed, 'z.js', run.analyzeCode);
  assert.ok(v.accepted, `والبوابة تقبله — ${v.reason}`);
});

// ═══ 5. احتمالات على مستوى الدالة فقط — غير مُثبتة الوصول ══
// تقاطع المعرّفات يقبل تقاسم اسم واحد، وهذا ضعيف نظريًا. لكن الوصول إليه
// يتطلب أيضًا أن يطابق المرشّح regex نوع الثغرة في TYPE_FIXES، ولم نُثبت
// شكلاً واقعيًا يجتمع فيه الأمران غير الاتجاه المعاكس في القسم 4.
// فيُسجَّل هنا كسلوك مقيس للدالة، لا كخلل.

test('documented: corresponds تقبل تقاسم معرّف واحد بين سطرين مختلفي الوظيفة', () => {
  const src = LE_HEAD;
  const grab = re => { const m = src.match(re); assert.ok(m, 'الدالة غير موجودة: ' + re); return m[0]; };
  const sand = {};
  vm.createContext(sand);
  vm.runInContext(
    grab(/function anchorTokens[\s\S]*?\n  }\n/) +
    grab(/function assignTarget[\s\S]*?\n  }\n/) +
    grab(/function corresponds[\s\S]*?\n  }\n/) +
    '\n;C = corresponds;', sand);
  const C = sand.C;

  // السلوك المقصود
  assert.strictEqual(C('const API_KEY = "x";', 'const API_KEY = process.env.API_KEY;'), true, 'نفس الهدف');
  assert.strictEqual(C('foo(1);', 'const bar = baz();'), false, 'بلا تقاسم');

  // تناظر القاعدة بعد إصلاح الجزء (أ): تغيّر شكل العبارة يُرفض في الاتجاهين.
  // التأكيد الثالث كان يوثّق السلوك المعيب (true) وصار false بفعل الإصلاح.
  assert.strictEqual(C('console.log(API_KEY);', 'const API_KEY = process.env.API_KEY;'), false, 'استدعاء ⇄ تصريح');
  assert.strictEqual(C('const API_KEY = "x";', 'sendKey(API_KEY);'), false, 'تصريح ⇄ استدعاء');

  // السَعَة التي لم يعالجها هذا الإصلاح، وتبقى مقيسة كما هي: الحالتان
  // المتماثلتان شكلاً ما زالتا تمرّان بتقاسم اسم واحد.
  assert.strictEqual(C('a = user.id;', 'b = user.id;'), true, 'إسنادان لهدفين مختلفين يتقاسمان user/id');
  assert.strictEqual(C('deleteUser(id);', 'logAccess(id);'), true, 'استدعاءان مختلفان يتقاسمان id');

  // ومنع نظري لتعلّم صحيح: بلا معرّف مشترك
  assert.strictEqual(C('eval("1+1");', 'JSON.parse("1+1");'), false,
    'إصلاح eval صحيح يُرفض — نظري فقط لأن لا كاشف يُنتج type يحوي eval');
});

// إصلاح eval لا يُتعلَّم عند HEAD، لكن ليس لأن corresponds ترفضه كما ظننت
// أولاً: بلاغ eval نفسه type="security" (ليس من TYPE_FIXES)، ومفتاح eval
// في TYPE_FIXES لا يفعّله أي كاشف. والسطر يحمل أيضًا بلاغ type="XSS"
// قابلاً للتعلّم، لكن regex الـXSS هو /textContent|htmlspecialchars|
// sanitize|DOMPurify/ فلا يطابق مرشّح JSON.parse. فالمانع هو مطابقة النوع،
// لا بوابة التقابل.
test('documented: زوج eval→JSON.parse لا يُتعلَّم، والمانع نوع البلاغ لا corresponds', () => {
  const ctx = loadCtx(LE_HEAD);
  const before = 'function run(payload) {\n  eval(payload);\n}\nrun("1");\n';
  const after  = 'function run(payload) {\n  JSON.parse(payload);\n}\nrun("1");\n';
  const issues = ctx.analyzeCode(before, 'a.js');

  assert.ok(!issues.some(i => /eval/i.test(String(i.type || ''))),
    'مفتاح eval في TYPE_FIXES ميت: لا كاشف يُنتج نوعًا يحويه');
  assert.ok(issues.some(i => /xss/i.test(String(i.type || ''))),
    'السطر يحمل بلاغ XSS قابلاً للتعلّم — فالوصول ليس مسدودًا بالنوع وحده');

  const ids = ctx.LearningEngine.learn(before, after, issues, 'a.js');
  assert.deepStrictEqual(Array.from(ids), [], 'ولا شيء يُخزَّن');
  assert.strictEqual(ctx.LearningEngine.getStats().total, 0,
    'المانع أن JSON.parse لا يطابق regex إصلاح XSS، لا أن الزوج غير متقابل');
});

// ═══ 6. V4: ترتيب الخانات لا يُبدَّل في التعميم ══════════
//
// قالب يعيد ترتيب الخانات يُركِّب المعامِلات في مواضع غير مواضعها مع ثبات
// هدف الإسناد ومع تساوي مجموعات الخانات — فلا يراه حرس الهدف (V2′) ولا
// المرجع الخلفي (VBR). والزوج المقيس من عائلة SQL concat → parameterized:
//
//   before:  db.query("… a=" + x + " AND b=" + y);
//   after :  db.query("… a=? AND b=?", [y, x]);        ← الوسطاء معكوسان
//
// تطبيق قالب كهذا على سطر آخر من العائلة يبني استعلامًا يربط كل قيمة
// بالعمود الخطأ: صحيح نحويًا، يجتاز الفحوص اللاحقة، ودلالته مقلوبة.
//
// ثلاثة قياسات تحدّد V4 تحديدًا لا تقريبًا:
//   (أ) مبدِّل الترتيب عند HEAD      ⇒ لا قالب معمَّم
//   (ب) نفس الزوج وV4 مُعطَّل وحده   ⇒ القالب يُخزَّن، وترتيبه معكوس فعلاً
//   (ج) حافظ الترتيب عند HEAD       ⇒ القالب يُخزَّن (لا إفراط في التقييد)
// (ب) تمنع أن يكون (أ) أخضرَ لسبب آخر، و(ج) تمنع أن يكون V4 مانعًا شاملاً.
//
// ملاحظة: V4 يرفض **التعميم** لا الزوج. فالنمط الحرفي يُخزَّن في الحالات
// الثلاث، والفرق كله في p.generalized — ولذلك يُقاس هذا الحقل لا getStats.

// ترتيب أول ظهور لكل خانة في القالب. مكتوب هنا مستقلًا عن seqOf الإنتاجية
// حتى يصف الاختبار الخاصية بنفسه لا أن يعيد استدعاء ما يختبره.
const seqOfTemplate = src => {
  const out = [];
  for (const tok of (String(src).match(/__LEARN_(?:ID|STR)_\d+__/g) || [])) {
    if (out.indexOf(tok) === -1) out.push(tok);
  }
  return out;
};

// هل sub متتالية جزئية من seq بحفظ الترتيب؟ هذا هو معنى "الترتيب محفوظ".
const isSubsequence = (sub, seq) => {
  let at = 0;
  for (const tok of seq) if (sub[at] === tok) at++;
  return at === sub.length;
};

// يتعلّم الزوج ويُرجع ما خُزِّن فعلاً: عدد الأنماط، والقوالب المعمَّمة منها.
function generalizedOf(before, after, file, src) {
  const { ctx, ids } = learnPair(before, after, file, src);
  const raw = ctx.__store.get(STORAGE_KEY);
  const ps  = raw ? (JSON.parse(raw).patterns || []) : [];
  return {
    ids:     Array.from(ids || []).length,
    stored:  ps.length,
    general: ps.filter(p => p.generalized).map(p => p.generalized),
  };
}

const SQL_FILE   = 'db.js';
const SQL_BEFORE = 'function q(x, y) {\n  db.query("SELECT * FROM t WHERE a=" + x + " AND b=" + y);\n}\n';
// نفس الإصلاح مرتين: مرة بعكس ترتيب الوسطاء ومرة بحفظه.
const SQL_SWAP   = 'function q(x, y) {\n  db.query("SELECT * FROM t WHERE a=? AND b=?", [y, x]);\n}\n';
const SQL_KEEP   = 'function q(x, y) {\n  db.query("SELECT * FROM t WHERE a=? AND b=?", [x, y]);\n}\n';

test('tripwire: سطر V4 موجود حرفيًا في الملف المُسلَّم ومرة واحدة', () => {
  const hits = LE_HEAD.split(V4_LINE).length - 1;
  assert.strictEqual(hits, 1,
    'سطر V4 يجب أن يظهر مرة واحدة بالضبط — وإلا فنسخة التعطيل تُعطّل غيره أو لا تُعطّل شيئًا');
  assert.notStrictEqual(LE_NO_V4, LE_HEAD,
    'ونسخة التعطيل تختلف فعلاً عن الملف المُسلَّم');
});

test('isolation: زوج SQL المقيس يصل التعلّم فعلاً (النوع قابل للتعلّم)', () => {
  const ctx = loadCtx(LE_HEAD);
  const issues = ctx.analyzeCode(SQL_BEFORE, SQL_FILE);
  assert.ok(learnableTypes(issues).some(t => /sql|cwe_89/i.test(t)),
    'بلاغ SQL قابل للتعلّم موجود — فأي صفر لاحق ليس سببه النوع');
});

test('V4 يرفض القالب الذي يبدّل ترتيب الخانات (عند HEAD)', () => {
  const r = generalizedOf(SQL_BEFORE, SQL_SWAP, SQL_FILE, LE_HEAD);
  assert.strictEqual(r.stored, 1, 'النمط الحرفي يُخزَّن — V4 يرفض التعميم لا الزوج');
  assert.strictEqual(r.general.length, 0,
    'ولا قالب معمَّم: القالب المبدِّل مرفوض');
});

test('والمصدر V4 وحده: بتعطيله يُخزَّن القالب المبدِّل، وترتيبه معكوس فعلاً', () => {
  const r = generalizedOf(SQL_BEFORE, SQL_SWAP, SQL_FILE, LE_NO_V4);
  assert.strictEqual(r.general.length, 1,
    'بتعطيل V4 وحده يُخزَّن القالب ⇒ الصفر عند HEAD مصدره V4 لا شيء آخر');

  const g = r.general[0];
  const b = seqOfTemplate(g.beforeTemplate);
  const a = seqOfTemplate(g.afterTemplate).filter(t => b.indexOf(t) !== -1);

  assert.ok(b.length >= 2, 'القالب يحمل خانتين على الأقل — وإلا فلا ترتيب يُبدَّل');
  assert.strictEqual(isSubsequence(a, b), false,
    `ترتيب الخانات مبدَّل فعلاً: before=[${b}] after=[${a}]`);
  assert.deepStrictEqual(a.slice(-2), [b[b.length - 1], b[b.length - 2]],
    'والخانتان الأخيرتان متبادلتان بالضبط — وهما وسيطا الاستعلام');
});

test('إيجابي: V4 لا يمنع القالب الذي يحفظ ترتيب الخانات (عند HEAD)', () => {
  const r = generalizedOf(SQL_BEFORE, SQL_KEEP, SQL_FILE, LE_HEAD);
  assert.strictEqual(r.general.length, 1,
    'القالب الحافظ للترتيب يُخزَّن عند HEAD — فV4 ليس مانعًا شاملاً');

  const g = r.general[0];
  const b = seqOfTemplate(g.beforeTemplate);
  const a = seqOfTemplate(g.afterTemplate).filter(t => b.indexOf(t) !== -1);
  assert.strictEqual(isSubsequence(a, b), true,
    `الترتيب محفوظ: before=[${b}] after=[${a}]`);
});
