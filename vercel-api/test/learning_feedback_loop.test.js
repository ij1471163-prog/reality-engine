// ═══════════════════════════════════════════════════════
// [P3] إغلاق حلقة التغذية الراجعة: الحكم يصل إلى المخزن
// ═══════════════════════════════════════════════════════
//
// الانقطاع الذي يعالجه: خط الأنابيب كان يحسب حكمًا لكل نمط أسهم في
// إصلاح متعلَّم — PASS/FAIL/INCONCLUSIVE/SKIPPED، مع تنصيفٍ فعلي
// لعزل المسؤول — ثم يكتبه في report.learnedOutcomes ويُفقده بنهاية
// التشغيل. ولا شيء في الإنتاج كان ينادي verify(id, false)، فيترتّب:
//   • حقل failures يبقى صفرًا دائمًا في الإنتاج.
//   • فرع الفشل في verify()، والحظر عند failures ≥ 3، وإسقاط
//     الاعتماد، وsuccessRate في calcConfidence: كود صحيح غير قابل
//     للوصول.
//   • المحرك يكرّر تطبيق النمط المرفوض بلا حدّ.
//
// والتمييز الجوهري: لا يُسجَّل الفشل إلا على الرفض **الضارّ**.
// المقيس قبل هذا الإصلاح: قالب صحيح (import hashlib as hl ⇒
// hl.sha256) أنتج إصلاحًا تحقّق منه مفسّر Python فعلاً، ورفضه Ghost
// بسبب no_improvement لأن المحلل لا يرى الاستيراد المُستعار. فتسجيل
// ذلك فشلاً يعاقب خبرة صحيحة. «بلا تحسّن مقيس» ≠ «ضرر».
//
// العيّنات أدناه مُنتقاة بقياس: أسطرٌ لا يمسّها أي مُصلِح آخر، فتصل
// إلى applyLearned فعلاً. (عيّنات innerHTML الأولى كان يُصلحها
// repairCode قبل أن يبلغها التعلّم، فكانت التغطية خاوية.)
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
  ctx.toast = noop; ctx.refreshStats = noop; ctx.__store = store;
  return ctx;
}

function runPipe(ctx, files, dbRaw) {
  if (dbRaw) ctx.__store.set(STORAGE_KEY, dbRaw);
  vm.runInContext('F = ' + JSON.stringify(files) + ';', ctx);
  vm.runInContext('R = {}; Object.keys(F).forEach(k => { R[k] = { code: F[k], issues: analyzeCode(F[k], k) }; });', ctx);
  const report = vm.runInContext('JSON.parse(JSON.stringify(fixAllEnginePipeline()))', ctx);
  const raw = ctx.__store.get(STORAGE_KEY);
  return { report, out: vm.runInContext('JSON.parse(JSON.stringify(F))', ctx), db: raw ? JSON.parse(raw) : { patterns: [] } };
}
const mkDb = patterns => JSON.stringify({ patterns, safe: [], meta: { total: patterns.length } });
const outcomeOf = (report, id) => (report.learnedOutcomes || []).find(o => o.patternId === id) || null;
const pat = (id, before, after, lang, extra) => Object.assign({
  id, type: 'T', language: lang, before, after, fingerprint: 'fp-' + id,
  verified: 3, failures: 0, confidence: 0.7, approved: true,
}, extra || {});

// سطر لا يمسّه أي مُصلِح آخر — مقيس
const JS_FILE = 'function f(s, x) {\n  s = s + x;\n  return s;\n}\n';
const JS_LINE = 's = s + x;';
const PY_FILE = 'def f(s, x):\n    s = s + x\n    return s\n';
const PY_LINE = 's = s + x';

// ضارّ بكسر نحوي (js: Ghost يرى syntax_broken)
const P_SYNTAX  = () => pat('p-syntax', JS_LINE, 's = s + x;;;{', 'js');
// ضارّ بتدهور (يُدخل ثغرة حرجة جديدة ⇒ GHOST_regression)
const P_REGRESS = () => pat('p-regress', JS_LINE, 's = eval(x);', 'js');
// غير ضارّ: تعديل سليم لا يُقِس المحلل له تحسّنًا ⇒ no_improvement
const P_BENIGN  = () => pat('p-benign', JS_LINE, 's = s + (x);', 'js');
// موجب: إصلاح يُقِس المحلل له تحسّنًا فعليًّا
// (عيّنة innerHTML كان يسبقها repairCode فتُفقد الإحالة إلى applyLearned)
const P_PASS    = () => pat('p-pass', 'r = eval(x);', 'r = JSON.parse(x);', 'js');
const PASS_FILE = 'function g(el, x, r) {\n  r = eval(x);\n  return r;\n}\n';

// ═══ 0. شروط العزل — تمنع التغطية الخاوية ══════════════

test('tripwire: المخزن حقيقي وقابل للقراءة والكتابة', () => {
  const ctx = loadCtx();
  ctx.__store.set(STORAGE_KEY, mkDb([P_SYNTAX()]));
  assert.strictEqual(ctx.LearningEngine.getStats().total, 1);
  ctx.__store.delete(STORAGE_KEY);
  assert.strictEqual(ctx.LearningEngine.getStats().total, 0, 'المخزن ليس حقيقيًّا');
});

test('tripwire: verify(id,false) تعمل على مستوى المحرّك', () => {
  const ctx = loadCtx();
  ctx.__store.set(STORAGE_KEY, mkDb([P_SYNTAX()]));
  ctx.LearningEngine.verify('p-syntax', false);
  const p = JSON.parse(ctx.__store.get(STORAGE_KEY)).patterns[0];
  assert.strictEqual(p.failures, 1, 'verify(id,false) لا تُحرّك failures ⇒ ما بعده خاوٍ');
});

test('tripwire: العيّنات تصل إلى applyLearned ولا يسبقها مُصلِح آخر', () => {
  const ctx = loadCtx();
  const { report } = runPipe(ctx, { 'a.js': JS_FILE }, mkDb([P_BENIGN()]));
  assert.ok(outcomeOf(report, 'p-benign'),
    'لا حكم مسجَّل ⇒ السطر أصلحه مسار آخر قبل التعلّم، والتغطية خاوية');
});

// ═══ 1. الرفض الضارّ ⇒ فشل مُسجَّل في المخزن ═══════════

for (const [name, mkPat, reason] of [
  ['كسر نحوي', P_SYNTAX, 'syntax_broken'],
  ['تدهور أمني', P_REGRESS, 'regression'],
]) {
  test(`ضارّ (${name}): يُرفض، ويُسجَّل عليه فشل في المخزن`, () => {
    const ctx = loadCtx();
    const p0 = mkPat();
    const { report, out, db } = runPipe(ctx, { 'r.js': JS_FILE }, mkDb([p0]));

    assert.strictEqual(out['r.js'], JS_FILE, `التعديل الضارّ كُتب فعلاً:\n${out['r.js']}`);
    const o = outcomeOf(report, p0.id);
    assert.ok(o, 'لا حكم مسجَّل ⇒ لم يُطبَّق أصلاً');
    assert.strictEqual(o.outcome, 'FAIL', `الحكم ${o.outcome} لا FAIL`);
    assert.strictEqual(o.harmful, true,
      `الرفض لم يُصنَّف ضارًّا (gateReason=${o.gateReason} ghostReason=${o.ghostReason})`);

    const p = db.patterns.find(x => x.id === p0.id);
    assert.strictEqual(p.failures, 1, 'الفشل لم يصل إلى المخزن ⇒ الحلقة ما زالت مقطوعة');
    assert.ok(p.confidence < 0.7, `confidence لم ينزل (المقيس ${p.confidence})`);
    assert.strictEqual(p.verified, 3, 'verified تحرّك بالفشل — لا يجب');
    assert.strictEqual(p.approved, true, 'فشل واحد أسقط الاعتماد — الإسقاط عند 3 وحده');
  });
}

test('ضارّ: ثلاث مرات ⇒ الحظر يُفعَّل والاعتماد يُسقَط', () => {
  const ctx = loadCtx();
  let raw = mkDb([P_SYNTAX()]);
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const r = runPipe(ctx, { ['r' + i + '.js']: JS_FILE }, raw);
    const p = r.db.patterns.find(x => x.id === 'p-syntax');
    seen.push(`${i + 1}:failures=${p.failures}/approved=${p.approved}`);
    raw = JSON.stringify(r.db);
  }
  const p = JSON.parse(raw).patterns.find(x => x.id === 'p-syntax');
  assert.strictEqual(p.failures, 3, 'العدّاد لم يبلغ 3 — ' + seen.join(' · '));
  assert.strictEqual(p.approved, false,
    'الاعتماد لم يُسقَط عند ثلاثة إخفاقات ⇒ المحرّك يكرّر خطأً معروفًا — ' + seen.join(' · '));
});

test('ضارّ ومحظور: لا يُطبَّق بعد الحظر — المحرّك توقّف عن تكرار الخطأ', () => {
  const ctx = loadCtx();
  const banned = pat('p-syntax', JS_LINE, 's = s + x;;;{', 'js', { failures: 3, approved: false });
  const { report, out } = runPipe(ctx, { 'r.js': JS_FILE }, mkDb([banned]));
  assert.strictEqual(outcomeOf(report, 'p-syntax'), null,
    'النمط المحظور ما زال يُطبَّق ⇒ الحظر بلا أثر');
  assert.strictEqual(out['r.js'], JS_FILE, 'والملف تغيّر');
});

// ═══ 2. الرفض غير الضارّ ⇒ لا فشل ══════════════════════

test('غير ضارّ: «بلا تحسّن مقيس» لا يُسجَّل فشلاً — لا عقوبة على خبرة سليمة', () => {
  const ctx = loadCtx();
  const { report, db } = runPipe(ctx, { 's.js': JS_FILE }, mkDb([P_BENIGN()]));
  const o = outcomeOf(report, 'p-benign');
  assert.ok(o, 'لم يُطبَّق ⇒ التغطية خاوية');
  assert.strictEqual(o.harmful, false,
    `صُنّف ضارًّا: gateReason=${o.gateReason} ghostReason=${o.ghostReason}`);

  const p = db.patterns.find(x => x.id === 'p-benign');
  assert.strictEqual(p.failures, 0,
    `عوقب نمط سليم: failures=${p.failures} · السبب ${o.gateReason}/${o.ghostReason}`);
  assert.strictEqual(p.confidence, 0.7, 'confidence نزل بلا ضرر مقيس');
  assert.strictEqual(p.approved, true, 'الاعتماد أُسقط بلا ضرر مقيس');
});

test('غير ضارّ: التكرار عشر مرات لا يحظر النمط السليم', () => {
  const ctx = loadCtx();
  let raw = mkDb([P_BENIGN()]);
  for (let i = 0; i < 10; i++) {
    raw = JSON.stringify(runPipe(ctx, { ['s' + i + '.js']: JS_FILE }, raw).db);
  }
  const p = JSON.parse(raw).patterns.find(x => x.id === 'p-benign');
  assert.strictEqual(p.failures, 0, `فشل متراكم على نمط سليم: ${p.failures}`);
  assert.strictEqual(p.approved, true, 'نمط سليم حُظِر بعد عشر محاولات بلا تحسّن');
});

// ═══ 3. الحكم الموجب وغير المحسوم لا يتأثّران ══════════

test('PASS لا يُحرّك failures ولا يُنقص الثقة', () => {
  const ctx = loadCtx();
  const { report, out, db } = runPipe(ctx, { 'p.js': PASS_FILE }, mkDb([P_PASS()]));
  const o = outcomeOf(report, 'p-pass');
  assert.ok(o, 'لم يُطبَّق ⇒ التغطية خاوية');
  assert.strictEqual(o.outcome, 'PASS', `الحكم ${o.outcome} · ${o.gateReason}/${o.ghostReason}`);
  assert.strictEqual(o.source, 'applyLearned', 'الإحالة ليست لمسار التعلّم');
  // الإصلاح المتعلَّم وصل إلى الملف فعلاً — لا حكم على فراغ
  assert.ok(/JSON\.parse\(x\)/.test(out['p.js']), 'بديل النمط لم يُكتب في الملف');
  assert.ok(!/eval\(x\)/.test(out['p.js']), 'eval باقٍ ⇒ لم يُصلَح شيء');
  const p = db.patterns.find(x => x.id === 'p-pass');
  assert.strictEqual(p.failures, 0, 'failures تحرّك على حكم موجب');
  assert.ok(p.confidence >= 0.7, 'confidence نزل على حكم موجب');
});

test('مرجع: السطر الموجب لا يمسّه مُصلِح آخر — الإحالة نظيفة', () => {
  const ctx = loadCtx();
  const { out } = runPipe(ctx, { 'p.js': PASS_FILE }, mkDb([]));
  assert.strictEqual(out['p.js'], PASS_FILE,
    'مُصلِحٌ آخر يغيّر العيّنة ⇒ نجاح الاختبار السابق قد لا يكون من applyLearned');
});

// ═══ 4. تصنيف الأسباب يُقرأ من الإنتاج لا من نسخة ══════

test('التصنيف: الأسباب الحميدة والضارّة مُدرَجة، والمجهول لا يُعاقَب', () => {
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'fix_engine_pipeline.js'), 'utf8');
  for (const r of ['no_change', 'no_improvement']) {
    assert.ok(new RegExp(`BENIGN_GHOST_REASONS[\\s\\S]{0,160}${r}`).test(src),
      `السبب الحميد ${r} غير مُدرَج ⇒ قد يعاقب خبرة سليمة`);
  }
  for (const r of ['structural_invalid', 'syntax_broken', 'analysis_failed']) {
    assert.ok(new RegExp(`HARMFUL_GHOST_REASONS[\\s\\S]{0,240}${r}`).test(src),
      `السبب الضارّ ${r} غير مُدرَج ⇒ ضررٌ لا يُسجَّل`);
  }
  assert.ok(/سبب مجهول ⇒ لا عقوبة/.test(src),
    'السبب المجهول يجب أن يُعدّ غير ضارّ — الفشل على سبب لا نعرفه تخمين');
});

// ═══ 4b. أسباب بوابة FixVerifier: ما يُعاقَب عليه وما لا ═

// الصيغة الأولى من التصنيف كانت تعدّ «كل ما تبقّى» رفضَ بوابةٍ ⇒ ضارًّا.
// والبوابة تنشر أسبابًا بيئية صريحة (لا فاحص للغة، لا محلل، لا بوابة) وسببَ
// «بلا تحسّن» — فكان النمط يُعاقَب على غياب أداة تحقق، وعلى نفس الحالة التي
// استُثنيت عمدًا على مسار Ghost. القائمتان أدناه تثبّتان القاعدة: الضرر
// يحتاج إثباتًا صريحًا، والافتراض عدم العقوبة.
const GATE_HARMFUL = [
  'REJECTED_EMPTY_OUTPUT',
  'REJECTED_QUICKCHECK: functions_preserved — دالة اختفت',
  'REJECTED_SYNTAX_BROKEN [py]: unmatched \'(\' at line 3',
  'REJECTED_ISSUES_WORSENED (+2): XSS 0→2 [منها 2 خطيرة أضافها هذا التعديل]',
  'REJECTED_SQL_NOT_PARAMETERIZED — اختفت إشارة SQL',
  'REJECTED_PY_UNREACHABLE_CODE (+1): print(x)',
];
const GATE_BENIGN = [
  'REJECTED_NO_IMPROVEMENT (تغيّر الكود دون إنقاص أي مشكلة)',
  'REJECTED_NO_SYNTAX_CHECKER [unknown]: unknown file type - no syntax checker',
  'REJECTED_SYNTAX_STATE_UNRESOLVED',
  'REJECTED_VERIFIER_UNAVAILABLE — fix_verifier.js غير محمّل',
  'REJECTED_ANALYZER_UNAVAILABLE — Fail-Closed: لا يمكن التحقق بدون محلل',
  'REJECTED_ANALYSIS_INCONCLUSIVE — المحلل لم يُرجع نتيجة مفهومة',
  'REJECTED_ANALYZER_THREW: boom',
  'GATE_REJECTED',
];

test('تصنيف أسباب البوابة: الضارّ يُعاقَب والبيئي و«بلا تحسّن» لا', () => {
  const ctx = loadCtx();
  assert.strictEqual(typeof ctx._isHarmfulRejection, 'function',
    '_isHarmfulRejection غير مرئية ⇒ الاختبار لا يقيس الإنتاج');
  for (const r of GATE_HARMFUL) {
    assert.strictEqual(ctx._isHarmfulRejection(r, null), true, 'ضرر لا يُسجَّل: ' + r);
  }
  for (const r of GATE_BENIGN) {
    assert.strictEqual(ctx._isHarmfulRejection(r, null), false, 'عقوبة بلا دليل ضرر: ' + r);
  }
  // لا سبب إطلاقًا ⇒ لا عقوبة
  assert.strictEqual(ctx._isHarmfulRejection(null, null), false);
  assert.strictEqual(ctx._isHarmfulRejection('', 'syntax_broken'), false);
});

test('tripwire: بادئات أسباب البوابة موجودة في fix_verifier.js فعلاً', () => {
  // لو أُعيد تسمية سبب في البوابة، سقط التصنيف صامتًا وبقي الاختبار أعلاه
  // أخضر على نصوص من عندي. هذا يمنع ذلك.
  const fv = fs.readFileSync(path.join(PUBLIC_DIR, 'fix_verifier.js'), 'utf8');
  const prefixes = GATE_HARMFUL.concat(GATE_BENIGN)
    .filter(r => r !== 'GATE_REJECTED' && r !== 'REJECTED_VERIFIER_UNAVAILABLE — fix_verifier.js غير محمّل')
    .map(r => r.split(/[ :[(]/)[0].replace(/^REJECTED_/, ''));
  for (const p of new Set(prefixes)) {
    assert.ok(fv.includes(p), `السبب ${p} لم يُعد موجودًا في البوابة ⇒ التصنيف تقادم`);
  }
  const pipe = fs.readFileSync(path.join(PUBLIC_DIR, 'fix_engine_pipeline.js'), 'utf8');
  for (const p of ['REJECTED_VERIFIER_UNAVAILABLE', 'GATE_REJECTED']) {
    assert.ok(pipe.includes(p), `${p} لم يُعد يُنشَر من خط الأنابيب`);
  }
});

// ═══ 5. حدود معلنة — تُثبَّت كي لا يُفهَم الأخضر تغطيةً ══

test('موثَّق: كسر نحوي في Python يُرفض لكن لا يُصنَّف ضارًّا', () => {
  // المقيس: تعديل يكسر بنية Python يصل إلى Ghost فيُرجع
  // GHOST_fail/no_improvement لا syntax_broken — فلا يُسجَّل فشلاً.
  // لا ضرر على الملف (التعديل مرفوض فلا يُكتب)، لكن النمط لا يُعاقَب
  // فيبقى يُحاوَل. علّته في تغطية الفحص النحوي لـPython داخل Ghost،
  // لا في منطق التصنيف هنا. حدٌّ مُعلَن ومُسجَّل.
  const ctx = loadCtx();
  const p0 = pat('p-pysyntax', PY_LINE, 's = s + x;;;{', 'py');
  const { report, out, db } = runPipe(ctx, { 'q.py': PY_FILE }, mkDb([p0]));
  assert.strictEqual(out['q.py'], PY_FILE, 'الأهم: التعديل المكسور لم يُكتب');
  const o = outcomeOf(report, 'p-pysyntax');
  assert.ok(o, 'لم يُطبَّق ⇒ التغطية خاوية');
  assert.strictEqual(o.outcome, 'FAIL', 'الحكم ليس FAIL');
  assert.strictEqual(o.harmful, false,
    `تغيّر السلوك: صار يُصنَّف ضارًّا (${o.ghostReason}) ⇒ راجع هذا التوثيق`);
  assert.strictEqual(db.patterns[0].failures, 0, 'تغيّر السلوك: صار يُسجَّل فشلاً');
});
