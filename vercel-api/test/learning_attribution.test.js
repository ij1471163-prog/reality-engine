// ═══════════════════════════════════════════════════════
// P2 — نسبة نتيجة الإصلاح المتعلَّم إلى أنماطه
// تشغيل:  node --test vercel-api/test/learning_attribution.test.js
//
// العقد الذي يثبّته هذا الملف:
//
//  1) applyLearned يُرجع uses: من أسهم، في أي سطر، عبر أي مسار (حرفي/معمَّم).
//
//  2) applyLearned قراءة محضة: لا يكتب lastUsed ولا يحفظ المخزن. الدفتر
//     صار بعد قرار البوابة حصرًا عبر markUsed — فتعديل مرفوض لا يُسجَّل
//     استعمالاً ناجحًا، وهو ما كان يحدث لأن السطر كان داخل حلقة التطبيق.
//
//  3) أربعة أحكام: PASS / FAIL / INCONCLUSIVE / SKIPPED.
//     مُسهم واحد ورُفض ⇒ FAIL بالضرورة. أكثر من مُسهم ⇒ تنصيف لعزل
//     المسؤول، وما لم يُحسم يبقى INCONCLUSIVE — لا تُخمَّن مسؤولية.
//
//  4) القيد الأساسي للمرحلة: لا verify() ولا مسّ لـ
//     verified / failures / confidence / approved. تسجيلٌ لا حكم على الحالة.
//
//  5) لا تعلّم دائري: مصدر applyLearned مستثنى من التعلّم.
//
// ملاحظة على الـharness: المخزن حقيقي في الذاكرة، والأنماط مزروعة مباشرةً
// في localStorage لا عبر learn() — فالمقصود اختبار آلة النسبة، ومدخلها هو
// المخزن. وكل فيكستشر هنا مقيس: السطر المعيب الذي نستعمله لا يغيّره
// repairCode، وإلا لم يصل applyLearned أصلاً فلا يقيس الاختبار شيئًا.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR  = path.join(__dirname, '..', 'public');
const STORAGE_KEY = 're_learned_patterns_v2';

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
  vm.runInContext('var toast = function(){}; var refreshStats = function(){}; var F = {}, R = {};', ctx);
  ctx.__store = store;
  return ctx;
}

// نمط مزروع معتمد. العدّادات ثابتة معروفة حتى نكشف أي تحريك لها.
const SEED_COUNTERS = { observed: 3, verified: 3, failures: 0, confidence: 0.7, approved: true };
function pat(id, before, after) {
  return Object.assign({
    id, type: 'XSS', severity: 'c', before, after, language: 'js',
    context: { functionName: null, scope: 'module', fileName: 'seed.js' },
    fingerprint: 'fp-' + id, fileName: 'seed.js', generalized: null,
    created: 1, lastSeen: 1,
  }, SEED_COUNTERS);
}
const mkDb = ps => JSON.stringify({ patterns: ps, safe: [], meta: { total: ps.length } });

// ─── أنماط وضحايا مقيسة ────────────────────────────────
// P_GOOD يُصلح XSS حقيقيًا بنفس هدف الإسناد ونفس شكل العبارة، فيمرّ حرس P1.
const P_GOOD = pat('p-good', 'box.innerHTML = box.innerHTML + m;', 'box.textContent = box.textContent + m;');
// P_BAD يُدخل eval فيرفضه مسار التحقق — نستعمله لعزل المسؤول بالتنصيف.
const P_BAD  = pat('p-bad',  'const NAME = "app";',                'const NAME = eval("app");');
// P_SHAPE يغيّر شكل العبارة (إسناد ← استدعاء) فيرفضه حرس V2′ من P1.
const P_SHAPE = pat('p-shape', 'box.innerHTML = box.innerHTML + m;', 'setText(box, m);');

const V_ONE  = 'function d(m) {\n  box.innerHTML = box.innerHTML + m;\n  return box;\n}\nd("x");\n';
const V_TWO  = 'function d(m) {\n  box.innerHTML = box.innerHTML + m;\n  const NAME = "app";\n' +
               '  return [box, NAME];\n}\nd("x");\n';

function runPipe(ctx, files, raw) {
  if (raw) ctx.__store.set(STORAGE_KEY, raw);
  vm.runInContext('F = ' + JSON.stringify(files) + ';', ctx);
  vm.runInContext('R = {}; Object.keys(F).forEach(k => { R[k] = { code: F[k], issues: analyzeCode(F[k], k) }; });', ctx);
  const report = vm.runInContext('fixAllEnginePipeline()', ctx);
  return {
    report,
    out: vm.runInContext('JSON.parse(JSON.stringify(F))', ctx),
    db: JSON.parse(ctx.__store.get(STORAGE_KEY) || '{"patterns":[]}'),
  };
}
// ثوابت خط الأنابيب معلَّنة بـconst على المستوى الأعلى، فلا تصير خاصيّات على
// كائن السياق كما يحدث مع function وvar. تُقرأ بالتقييم في السياق نفسه.
const inCtx = (ctx, expr) => vm.runInContext(expr, ctx);

const outcomesOf = report => {
  const m = {};
  for (const o of (report.learnedOutcomes || [])) m[o.patternId] = o;
  return m;
};
const countersOf = db => db.patterns.map(p => ({
  id: p.id, verified: p.verified, failures: p.failures,
  confidence: p.confidence, approved: p.approved,
}));

// ═══ 0. شروط العزل ═════════════════════════════════════

test('tripwire: الضحيتان لا يغيّرهما repairCode ⇒ applyLearned يصلهما فعلاً', () => {
  const ctx = loadCtx();
  for (const [label, code] of [['V_ONE', V_ONE], ['V_TWO', V_TWO]]) {
    const issues = ctx.analyzeCode(code, 'v.js');
    assert.ok(issues.length >= 1, `${label}: يجب أن تحمل بلاغًا، وإلا لا يعمل خط الأنابيب عليها`);
    const r = ctx.repairCode(code, issues, 'v.js');
    assert.ok(!r || r.repaired === code,
      `${label}: repairCode يغيّرها ⇒ لن يصل applyLearned فلا يقيس الاختبار النسبة`);
  }
});

test('tripwire: applyLearned يُرجع uses، والعقد الجديد قائم', () => {
  const ctx = loadCtx();
  ctx.__store.set(STORAGE_KEY, mkDb([P_GOOD]));
  const lr = ctx.LearningEngine.applyLearned(V_ONE, 'v.js');
  assert.ok(Array.isArray(lr.uses), 'uses يجب أن تكون مصفوفة');
  assert.strictEqual(typeof ctx.LearningEngine.markUsed, 'function', 'markUsed يجب أن تُصدَّر');
  assert.strictEqual(inCtx(ctx, 'BISECT_MAX_ATTEMPTS'), 8, 'حدّ التنصيف المتفق عليه 8');
  assert.deepStrictEqual(
    Object.keys(inCtx(ctx, 'LEARNED_OUTCOME')).sort(),
    ['FAIL', 'INCONCLUSIVE', 'PASS', 'SKIPPED'],
    'الأحكام الأربعة كما هي');
});

// ═══ 1. النسبة: النمط المسؤول يُحدَّد بصورة صحيحة ═══════

test('نمط واحد: النسبة صحيحة والحكم PASS', () => {
  const ctx = loadCtx();
  const { report, out, db } = runPipe(ctx, { 'v.js': V_ONE }, mkDb([P_GOOD]));

  assert.match(out['v.js'], /box\.textContent = box\.textContent \+ m;/, 'الإصلاح المتعلَّم طُبّق فعلاً');
  assert.ok((report.accepted || []).some(a => a.source === 'applyLearned'),
    'والبوابة قبلته بمصدر applyLearned');

  assert.strictEqual((report.learnedOutcomes || []).length, 1, 'حكم واحد لمُسهم واحد');
  const o = report.learnedOutcomes[0];
  assert.strictEqual(o.patternId, 'p-good', 'النمط المسؤول مُحدَّد بمعرّفه');
  assert.strictEqual(o.outcome, 'PASS');
  assert.strictEqual(o.via, 'exact', 'ومسار المطابقة مسجَّل');
  assert.strictEqual(o.file, 'v.js');
  assert.strictEqual(typeof o.lineIndex, 'number', 'وموضع السطر مسجَّل');

  // الدفتر بعد البوابة
  assert.ok(db.patterns[0].lastUsed, 'lastUsed سُجِّل بعد القبول');
});

test('عدة أنماط: المسؤول يُعزل بالتنصيف، والبقية INCONCLUSIVE', () => {
  const ctx = loadCtx();
  const { report, out, db } = runPipe(ctx, { 'w.js': V_TWO }, mkDb([P_GOOD, P_BAD]));

  // التعديل المجمَّع مرفوض ⇒ الملف لم يُمَس من applyLearned
  assert.strictEqual(out['w.js'], V_TWO, 'الكود لم يتغيّر — التعديل المجمَّع مرفوض');
  assert.ok(!(report.accepted || []).some(a => a.source === 'applyLearned'),
    'ولا قبول بمصدر applyLearned');

  const o = outcomesOf(report);
  assert.strictEqual(Object.keys(o).length, 2, 'حكم لكل مُسهم');
  assert.strictEqual(o['p-bad'].outcome, 'FAIL', 'المُفسد عُزل مسؤولًا');
  assert.strictEqual(o['p-good'].outcome, 'INCONCLUSIVE', 'والسليم لم يُحمَّل مسؤولية لم تثبت');
  assert.ok(o['p-bad'].gateReason, 'وسبب الرفض مسجَّل');
  assert.ok(o['p-bad'].bisectAttempts >= 1, 'والتنصيف عمل فعلاً');
  assert.ok(o['p-bad'].bisectAttempts <= inCtx(ctx, 'BISECT_MAX_ATTEMPTS'), 'وبلا تجاوز الحدّ');
  assert.strictEqual(o['p-bad'].bisectExhausted, false, 'وحُسم داخل الحدّ');

  // لا دفتر على تعديل مرفوض
  assert.ok(db.patterns.every(p => !p.lastUsed), 'لا lastUsed لأي نمط — التعديل مرفوض');
});

// ═══ 2. الإصلاح المرفوض لا يُسجَّل استخدامًا ناجحًا ════

test('مرفوض بمُسهم واحد: FAIL بالضرورة، وبلا أي تسجيل استعمال', () => {
  const ctx = loadCtx();
  const { report, out, db } = runPipe(ctx, { 'v.js': V_ONE }, mkDb([P_SHAPE]));

  // حرس V2′ من P1 يمنع تغيّر شكل العبارة ⇒ لا تعديل ⇒ SKIPPED لا FAIL
  assert.strictEqual(out['v.js'], V_ONE, 'الكود لم يتغيّر — حرس P1 منع التطبيق');
  const o = outcomesOf(report);
  assert.ok(!o['p-shape'] || o['p-shape'].outcome === 'SKIPPED',
    'لا تعديل ⇒ لا حكم، أو SKIPPED — ولا PASS بحال');
  assert.ok(db.patterns.every(p => !p.lastUsed), 'ولا lastUsed');
  assert.deepStrictEqual(countersOf(db), [{
    id: 'p-shape', verified: 3, failures: 0, confidence: 0.7, approved: true,
  }], 'والعدّادات كما زُرعت');
});

test('lastUsed لا يتغيّر قبل قرار البوابة: applyLearned قراءة محضة', () => {
  const ctx = loadCtx();
  const raw = mkDb([P_GOOD]);
  ctx.__store.set(STORAGE_KEY, raw);

  const lr = ctx.LearningEngine.applyLearned(V_ONE, 'v.js');
  assert.ok(lr.applied >= 1, 'العزل: التطبيق حدث فعلاً داخل الطبقة');
  assert.ok(lr.uses.length >= 1, 'والنسبة مُسجَّلة في uses');

  // المخزن لم يُمَسّ حرفًا واحدًا
  assert.strictEqual(ctx.__store.get(STORAGE_KEY), raw,
    'applyLearned كتبت في المخزن قبل أي قرار بوابة');
  const db = JSON.parse(ctx.__store.get(STORAGE_KEY));
  assert.ok(db.patterns.every(p => !p.lastUsed), 'ولا lastUsed');

  // ثم markUsed — وهي وحدها من يسجّل، ولا تلمس العدّادات
  const n = ctx.LearningEngine.markUsed(lr.uses.map(u => u.patternId));
  assert.strictEqual(n, 1, 'markUsed سجّلت نمطًا واحدًا');
  const db2 = JSON.parse(ctx.__store.get(STORAGE_KEY));
  assert.ok(db2.patterns[0].lastUsed, 'lastUsed صار مسجَّلًا');
  assert.deepStrictEqual(countersOf(db2), [{
    id: 'p-good', verified: 3, failures: 0, confidence: 0.7, approved: true,
  }], 'والعدّادات لم تتغيّر — markUsed تسجيل لا حكم');
});

// ═══ 3. القيد الأساسي: لا تحريك عدّادات ولا حالة اعتماد ══

test('INCONCLUSIVE لا يغيّر أي عدّاد ولا حالة اعتماد', () => {
  const ctx = loadCtx();
  const { report, db } = runPipe(ctx, { 'w.js': V_TWO }, mkDb([P_GOOD, P_BAD]));
  const o = outcomesOf(report);
  assert.strictEqual(o['p-good'].outcome, 'INCONCLUSIVE', 'العزل: الحكم INCONCLUSIVE فعلاً');

  // القيد يسري على غير المحسوم وحده: المسؤول المعزول بالتنصيف يُسجَّل
  // عليه فشلٌ الآن [P3]، وهو موضوع الاختبار التالي. أما غير المحسوم
  // فالتخمين عليه أسوأ من الصمت، فعدّاداته تبقى كما زُرعت حرفًا بحرف.
  const good = db.patterns.find(p => p.id === 'p-good');
  assert.deepStrictEqual(
    { id: good.id, verified: good.verified, failures: good.failures, confidence: good.confidence, approved: good.approved },
    { id: 'p-good', verified: 3, failures: 0, confidence: 0.7, approved: true },
    'عدّادات النمط غير المحسوم تحرّكت — تخمين لا إسناد');
});

test('[P3] FAIL ضارّ يُسجَّل فشلاً على المسؤول — الحلقة مُغلقة', () => {
  // كان هذا الاختبار يُثبّت الحالة السابقة: «تسجيل لا حكم»، أي أن
  // الحكم يُكتب في التقرير ويُفقد بنهاية التشغيل. وذلك بعينه كان
  // الانقطاع في دورة العمل: لا شيء في الإنتاج ينادي verify(id,false)،
  // فحقل failures يبقى صفرًا دائمًا وفرعُ الحظر كود غير قابل للوصول،
  // والمحرك يكرّر النمط المرفوض بلا حدّ. صار يُسجَّل الآن — على
  // المسؤول المعزول بالتنصيف وحده، وعلى الرفض الضارّ وحده.
  const ctx = loadCtx();
  const { report, db } = runPipe(ctx, { 'w.js': V_TWO }, mkDb([P_GOOD, P_BAD]));
  const o = outcomesOf(report)['p-bad'];
  assert.strictEqual(o.outcome, 'FAIL', 'العزل: الحكم FAIL فعلاً');
  assert.strictEqual(o.harmful, true,
    `العزل: الرفض مُصنَّف ضارًّا فعلاً (gateReason=${o.gateReason} ghostReason=${o.ghostReason})`);

  const bad = db.patterns.find(p => p.id === 'p-bad');
  assert.strictEqual(bad.failures, 1, 'failures لم تتحرّك ⇒ الحلقة ما زالت مقطوعة');
  assert.strictEqual(bad.verified, 3, 'verified لا يجب أن يتحرّك بالفشل');
  assert.ok(bad.confidence < 0.7, `confidence يجب أن ينزل بالفشل (المقيس ${bad.confidence})`);
  assert.strictEqual(bad.approved, true,
    'فشل واحد لا يُسقط الاعتماد — الإسقاط عند failures ≥ 3 وحده');
});

test('PASS كذلك لا يرفع verified — القيد يسري على الحكم الموجب أيضًا', () => {
  const ctx = loadCtx();
  const { report, db } = runPipe(ctx, { 'v.js': V_ONE }, mkDb([P_GOOD]));
  assert.strictEqual(outcomesOf(report)['p-good'].outcome, 'PASS', 'العزل: الحكم PASS فعلاً');
  const p = db.patterns[0];
  assert.strictEqual(p.verified, 3, 'verified لم تتحرّك');
  assert.strictEqual(p.failures, 0, 'failures لم تتحرّك');
  assert.strictEqual(p.confidence, 0.7, 'confidence لم تتحرّك');
  assert.strictEqual(p.approved, true, 'approved لم تتغيّر');
});

// ═══ 4. لا تعلّم دائري ═════════════════════════════════

test('حرس الدائرية: مصدر applyLearned مستثنى من التعلّم', () => {
  const ctx = loadCtx();
  assert.strictEqual(typeof ctx._learnableSource, 'function', 'الحرس موجود');
  assert.strictEqual(ctx._learnableSource('applyLearned'), false, 'applyLearned مستثنى');
  assert.strictEqual(ctx._learnableSource('repairCode+Ghost:pass'), true, 'repairCode غير مستثنى');
  assert.strictEqual(ctx._learnableSource('SmartRepair'), true, 'ولا بقية المحركات');
  assert.ok(Array.isArray(inCtx(ctx, 'LEARN_EXCLUDED_SOURCES')) &&
            inCtx(ctx, 'LEARN_EXCLUDED_SOURCES').includes('applyLearned'),
    'والقائمة معلنة صراحةً');
});

test('لا ينشأ نمط جديد من إصلاح مصدره applyLearned', () => {
  const ctx = loadCtx();
  const { report, db } = runPipe(ctx, { 'v.js': V_ONE }, mkDb([P_GOOD]));
  assert.ok((report.accepted || []).some(a => a.source === 'applyLearned'),
    'العزل: applyLearned قُبل فعلاً — وإلا لا يقيس الاختبار الدائرية');
  assert.strictEqual(db.patterns.length, 1, 'عدد الأنماط كما هو — لا نمط وُلد من الإصلاح المتعلَّم');
  assert.strictEqual(db.patterns[0].id, 'p-good', 'وهو النمط المزروع نفسه');
});

// ═══ 5. التنصيف: الحدّ والسلوك عند عدم الحسم ═══════════

test('التنصيف لا يتجاوز 8 محاولات ولو كثرت الأنماط', () => {
  const ctx = loadCtx();
  const ids = [];
  const ps = [];
  for (let i = 0; i < 12; i++) {
    const id = 'bulk-' + i;
    ids.push(id);
    ps.push(pat(id, `tag${i}.innerHTML = tag${i}.innerHTML + m;`,
                    `tag${i}.textContent = tag${i}.textContent + m;`));
  }
  ps.push(P_BAD); ids.push('p-bad');
  ctx.__store.set(STORAGE_KEY, mkDb(ps));

  let code = 'function d(m) {\n';
  for (let i = 0; i < 12; i++) code += `  tag${i}.innerHTML = tag${i}.innerHTML + m;\n`;
  code += '  const NAME = "app";\n  return m;\n}\nd("x");\n';

  const bis = ctx._bisectLearned(code, 'b.js', ids);
  assert.ok(bis.attempts <= inCtx(ctx, 'BISECT_MAX_ATTEMPTS'),
    `محاولات التنصيف ${bis.attempts} يجب ألا تتجاوز ${inCtx(ctx, 'BISECT_MAX_ATTEMPTS')}`);
  assert.ok(Array.isArray(bis.culprits), 'والنتيجة مصفوفة مسؤولين (قد تكون فارغة)');
});

// ═══ 6. حماية P1 لم تُمَسّ ══════════════════════════════

test('حماية P1 قائمة: حرس V2′ يمنع تغيّر شكل العبارة مع العقد الجديد', () => {
  const ctx = loadCtx();
  ctx.__store.set(STORAGE_KEY, mkDb([P_SHAPE]));
  const lr = ctx.LearningEngine.applyLearned(V_ONE, 'v.js');
  assert.strictEqual(lr.applied, 0, 'حرس V2′ ما زال يمنع التطبيق');
  assert.strictEqual(lr.fixed, V_ONE, 'والكود لم يتغيّر حرفًا واحدًا');
  // ملاحظة: uses مصفوفة من داخل سياق الـvm، فنموذجها الأولي ليس نموذج المستضيف
  // ولا تصحّ معها deepStrictEqual مع [] — يُقاس الطول.
  assert.strictEqual(lr.uses.length, 0, 'ولا نسبة لتعديل لم يحدث');
});

test('حماية P1 قائمة: المرجع الخلفي ما زال يشترط تساوي مواضع الخانة', () => {
  const ctx = loadCtx();
  const gen = {
    beforeTemplate: '__LEARN_ID_1__.innerHTML = __LEARN_ID_1__.__LEARN_ID_2__;',
    afterTemplate:  '__LEARN_ID_1__.textContent = __LEARN_ID_1__.__LEARN_ID_2__;',
    beforeSlots: [
      { id: 'ID_1', kind: 'identifier', value: 'el' },
      { id: 'ID_2', kind: 'identifier', value: 'bio' },
    ],
  };
  const p = Object.assign(pat('p-gen', 'el.innerHTML = el.bio;', 'el.textContent = el.bio;'),
                          { generalized: gen });
  ctx.__store.set(STORAGE_KEY, mkDb([p]));

  const diff = 'function f(a, b) {\n  a.innerHTML = b.bio;\n  return a;\n}\nf({}, {});\n';
  const same = 'function f(a) {\n  a.innerHTML = a.bio;\n  return a;\n}\nf({});\n';

  const rd = ctx.LearningEngine.applyLearned(diff, 'd.js');
  assert.strictEqual(rd.applied, 0, 'موضعان مختلفان ⇒ لا مطابقة');
  assert.strictEqual(rd.fixed, diff, 'والكود كما هو');

  const rs = ctx.LearningEngine.applyLearned(same, 's.js');
  assert.ok(rs.applied >= 1, 'وموضعان متساويان ⇒ يُطبَّق — الحماية ليست حظرًا شاملًا');
  assert.match(rs.fixed, /a\.textContent = a\.bio;/, 'والتركيب صحيح');
  assert.strictEqual(rs.uses[0].via, 'general', 'والمسار مسجَّل معمَّمًا');
});
