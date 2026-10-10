// ═══════════════════════════════════════════════════════
// [P4] تكامل الدورة: اكتشاف ← تشخيص ← اختيار ← تنفيذ ←
//      تحقق ← قبول/رفض ← تسجيل ← استفادة في التعلّم
// ═══════════════════════════════════════════════════════
//
// اختبارات كل محرك منفردًا لا تُثبت التكامل: ثلاثة انقطاعات مقيسة أدناه
// كانت كلها بين المحركات، وكل محرك منها سليم وحده.
//
//   [P4-1] الحلقة الرئيسة كانت تدور على R لا على F. فملفٌ في F وغائب عن R
//          لا يراه repairCode ولا applyLearned ولا مزامنة R — بصمت. المقيس:
//          ملفان متطابقان حرفيًا وأحدهما وحده في R ⇒ الأول أصلحه
//          repairCode+Ghost:pass والثاني Emergency وحده، وخَرجاهما مختلفان،
//          وwarnings فارغة.
//   [P4-2] ‏`if (typeof repairCode !== 'function') return;`‎ كان يُسقط جسم
//          الملف كله، ومعه مسار التعلّم ومزامنة R وهما لا يعتمدان عليه.
//          المقيس: بلا repairCode صارت الأحكام المتعلَّمة 0 ولم يُكتب
//          الإصلاح المتعلَّم، ومعه 1 وكُتب.
//   [P4-3] المحرك المعزول يُرجع مجموع إصلاحاته على كل الملفات، وكان يُسجَّل
//          كما هو في سجل **كل** ملف. المقيس: Emergency ادّعى 2 على ملفَّي py
//          فسُجِّل 2 لكل ملف — أي 4 ادّعاءً لمحرك ادّعى 2.
//
// وما يلي يثبّت الدورة نفسها لا الانقطاعات وحدها: أن البلاغ يصل إلى مُصلِح،
// وأن كل كتابة تمرّ ببوابة التحقق، وأن غير الآمن يُرفض والصحيح لا يُرفض بلا
// سبب، وأن النتيجة تُسجَّل، وأن الضرر وحده يُعاقَب، وأن الخبرة المتعلَّمة
// ذاتيًا تُستعمل فعلاً في تشغيل لاحق.
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
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة */ }
  }
  ctx.toast = noop; ctx.refreshStats = noop; ctx.__store = store;
  return ctx;
}

// تشغيل كامل للمسار الحقيقي. R يُبنى كما تبنيه الواجهة، إلا إذا مُرِّر rOnly
// (لمحاكاة ملف لم يُنتج تحليلُه مدخلًا في R).
function runPipe(ctx, files, opts) {
  const o = opts || {};
  vm.runInContext('F = ' + JSON.stringify(files) + ';', ctx);
  if (Array.isArray(o.rKeys)) {
    vm.runInContext('R = {}; ' + JSON.stringify(o.rKeys) +
      '.forEach(k => { R[k] = { code: F[k], issues: analyzeCode(F[k], k) }; });', ctx);
  } else {
    vm.runInContext('R = {}; Object.keys(F).forEach(k => { R[k] = { code: F[k], issues: analyzeCode(F[k], k) }; });', ctx);
  }
  // التحليل يجري في عالَم الاختبار لا داخل vm: مصفوفةٌ مُنشأة في عالَم vm
  // لها Array.prototype آخر، فـdeepStrictEqual يرفضها وإن كانت مكافئة —
  // أخفقت خمسة اختبارات بهذا السبب وحده قبل التصحيح، والإنتاج سليم.
  const report = JSON.parse(vm.runInContext('JSON.stringify(fixAllEnginePipeline())', ctx));
  return {
    report,
    out: JSON.parse(vm.runInContext('JSON.stringify(F)', ctx)),
    rState: JSON.parse(vm.runInContext('JSON.stringify(Object.keys(R).reduce((a,k)=>{a[k]={code:R[k]&&R[k].code,n:(R[k]&&R[k].issues||[]).length};return a;},{}))', ctx)),
    db: JSON.parse(ctx.__store.get(STORAGE_KEY) || '{"patterns":[]}'),
  };
}
const findings = (ctx, code, fn) =>
  vm.runInContext('analyzeCode(' + JSON.stringify(code) + ', ' + JSON.stringify(fn) + ').length', ctx);
const mkDb = ps => JSON.stringify({ patterns: ps, safe: [], meta: { total: ps.length } });
const pat = (id, before, after, lang) => ({
  id, type: 'T', language: lang, before, after, fingerprint: 'fp-' + id,
  observed: 3, verified: 3, failures: 0, confidence: 0.7, approved: true,
});
const srcOf = (report, file) => (report.accepted || []).filter(a => a.file === file).map(a => a.source);

// عيّنات مقيسة
const VULN_JS  = 'function f(db, el, x) {\n  db.query("SELECT * FROM t WHERE a=" + x);\n  el.innerHTML = x;\n  return el;\n}\n';
const VULN_PY  = 'import hashlib\ndef g(x):\n    return hashlib.md5(x).hexdigest()\n';
const LEARN_JS = 'function h(el, x, r) {\n  r = eval(x);\n  return r;\n}\n';   // سطر لا يمسّه مُصلِح آخر
const P_LEARN  = () => pat('p-learn', 'r = eval(x);', 'r = JSON.parse(x);', 'js');
const P_HARM   = () => pat('p-harm',  'r = eval(x);', 'r = JSON.parse(x);;;{', 'js');
const P_BENIGN = () => pat('p-benign', 'r = eval(x);', 'r = eval(x) /* ok */;', 'js');

// ═══ 0. شروط العزل ═════════════════════════════════════

test('tripwire: المسار الحقيقي محمَّل بكامله', () => {
  const ctx = loadCtx();
  for (const g of ['analyzeCode', 'fixAllEnginePipeline', 'repairCode']) {
    assert.strictEqual(typeof ctx[g], 'function', g + ' غير محمَّلة ⇒ لا تكامل يُقاس');
  }
  assert.ok(ctx.FixVerifier && typeof ctx.FixVerifier.verifyFix === 'function', 'بوابة التحقق غائبة');
  assert.ok(ctx.LearningEngine && typeof ctx.LearningEngine.applyLearned === 'function', 'محرك التعلّم غائب');
  assert.ok(typeof ctx.GhostMode !== 'undefined', 'GhostMode غائب');
});

test('tripwire: العيّنات يرصدها المحلل فعلاً', () => {
  const ctx = loadCtx();
  assert.ok(findings(ctx, VULN_JS, 'a.js') >= 2, 'عيّنة js بلا بلاغات');
  assert.ok(findings(ctx, VULN_PY, 'a.py') >= 1, 'عيّنة py بلا بلاغات');
  assert.ok(findings(ctx, LEARN_JS, 'a.js') >= 1, 'عيّنة التعلّم بلا بلاغات');
});

// ═══ 1. البلاغ يصل إلى مُصلِح، ولا ملف يُهمَل ══════════

test('اكتشاف ← إصلاح: كل ملف فيه بلاغ يصل إلى محرك ويُسجَّل له قرار', () => {
  const ctx = loadCtx();
  const files = { 'a.js': VULN_JS, 'b.py': VULN_PY };
  const { report, out } = runPipe(ctx, files);
  for (const fn of Object.keys(files)) {
    const touched = (report.accepted || []).some(a => a.file === fn) ||
                    (report.rejected || []).some(r => r.file === fn);
    assert.ok(touched, `${fn} لم يصل إلى أي محرك ولا سُجِّل له قرار`);
  }
  assert.ok(findings(ctx, out['a.js'], 'a.js') < findings(ctx, VULN_JS, 'a.js'),
    'بلاغات js لم تنقص بعد المسار الكامل');
  assert.ok(!/\.innerHTML\s*=/.test(out['a.js']), 'XSS باقٍ في الخَرج');
});

test('[P4-1] ملفٌ في F وغائب عن R يُعالَج كما لو كان فيها — لا تخطٍّ صامت', () => {
  // قبل الإصلاح: a.js أصلحه repairCode+Ghost وb.js أصلحه Emergency وحده،
  // والمدخل واحد حرفيًا، وwarnings فارغة.
  const ctx = loadCtx();
  const { report, out } = runPipe(ctx, { 'a.js': VULN_JS, 'b.js': VULN_JS }, { rKeys: ['a.js'] });
  assert.deepStrictEqual(srcOf(report, 'b.js'), srcOf(report, 'a.js'),
    'مسار المعالجة اختلف بين ملفين متطابقين: ' +
    JSON.stringify({ a: srcOf(report, 'a.js'), b: srcOf(report, 'b.js') }));
  assert.strictEqual(out['b.js'], out['a.js'], 'الخَرج اختلف لمدخل متطابق');
  assert.ok(srcOf(report, 'b.js').some(s => /repairCode/.test(s)),
    'الملف الغائب عن R لم يصل إلى repairCode');
});

test('[P4-1] مزامنة R تجري للملف الغائب عنها أيضًا', () => {
  const ctx = loadCtx();
  const { out, rState } = runPipe(ctx, { 'a.js': VULN_JS, 'b.js': VULN_JS }, { rKeys: ['a.js'] });
  assert.ok(rState['b.js'], 'لا مدخل R للملف بعد التشغيل');
  assert.strictEqual(rState['b.js'].code, out['b.js'], 'R لا يطابق F — الحالة متباعدة');
});

// ═══ 2. كل كتابة تمرّ ببوابة التحقق ════════════════════

test('لا كتابة بلا بوابة: رفض البوابة لكل مرشّح ⇒ لا ملف يتغيّر', () => {
  const ctx = loadCtx();
  // البوابة تُستبدل بسلوك رافض لكل شيء. الحارس: لا بد أن يظهر سببنا في
  // التقرير، وإلا لم تُستشَر البوابة أصلًا والاختبار خاوٍ.
  ctx.__calls = 0;
  vm.runInContext(`
    FixVerifier.verifyFix = function () {
      __calls++;
      return { accepted: false, reason: 'REJECTED_TEST_SENTINEL',
               syntaxStatus: 'unknown', language: 'js', afterIssues: null };
    };`, ctx);
  const files = { 'a.js': VULN_JS, 'b.py': VULN_PY };
  const { report, out } = runPipe(ctx, files);
  const calls = vm.runInContext('__calls', ctx);
  assert.ok(calls >= 2, `البوابة لم تُستشَر إلا ${calls} مرة ⇒ تغطية خاوية`);
  assert.ok((report.rejected || []).some(r => r.reason === 'REJECTED_TEST_SENTINEL'),
    'سبب البوابة المستبدلة لا يظهر في التقرير');
  assert.strictEqual(report.totalFixed, 0, 'totalFixed تحرّك بلا قبول واحد');
  assert.deepStrictEqual(report.accepted, [], 'قبولٌ بلا بوابة');
  for (const fn of Object.keys(files)) {
    assert.strictEqual(out[fn], files[fn], `${fn} تغيّر رغم رفض البوابة لكل مرشّح`);
  }
});

test('Fail-Closed: بلا بوابة تحقق لا يُكتب شيء ويُعلَن السبب', () => {
  const ctx = loadCtx();
  vm.runInContext('FixVerifier = undefined; globalThis.FixVerifier = undefined; _PFV = null;', ctx);
  const files = { 'a.js': VULN_JS };
  const { report, out } = runPipe(ctx, files);
  assert.strictEqual(out['a.js'], VULN_JS, 'كُتب تعديل بلا بوابة تحقق');
  assert.deepStrictEqual(report.accepted, [], 'قبولٌ بلا بوابة');
  assert.ok((report.rejected || []).some(r => /REJECTED_VERIFIER_UNAVAILABLE/.test(r.reason || '')),
    'غياب البوابة لم يُعلَن: ' + JSON.stringify((report.rejected || []).map(r => r.reason)));
});

// ═══ 3. غير الآمن يُرفض ════════════════════════════════

test('إصلاح متعلَّم يكسر النحو: يُرفض، ولا يُكتب، ويُسجَّل فشلاً', () => {
  const ctx = loadCtx();
  const r = runPipe(ctx, { 'h.js': LEARN_JS }, {});
  assert.ok(r, 'تشغيل أولي');
  const ctx2 = loadCtx();
  ctx2.__store.set(STORAGE_KEY, mkDb([P_HARM()]));
  const { report, out, db } = runPipe(ctx2, { 'h.js': LEARN_JS });
  const o = (report.learnedOutcomes || []).find(x => x.patternId === 'p-harm');
  assert.ok(o, 'النمط لم يُطبَّق ⇒ تغطية خاوية');
  assert.strictEqual(o.outcome, 'FAIL', 'الحكم ' + o.outcome);
  assert.strictEqual(o.harmful, true, 'كسر النحو لم يُصنَّف ضارًّا: ' + o.ghostReason);
  assert.ok(!/;;;\{/.test(out['h.js']), 'الكود المكسور كُتب في الملف');
  assert.strictEqual(db.patterns[0].failures, 1, 'الضرر لم يُسجَّل في المخزن');
});

// ═══ 4. الصحيح لا يُرفض بلا سبب ════════════════════════

test('إصلاح صحيح يُقبل: لا رفض بيئي ولا تعارض بين المحركات', () => {
  const ctx = loadCtx();
  const { report } = runPipe(ctx, { 'a.js': VULN_JS, 'b.py': VULN_PY });
  assert.ok((report.accepted || []).length >= 1, 'لم يُقبل أي إصلاح على عيّنة واضحة');
  const env = (report.rejected || []).filter(r => /VERIFIER_UNAVAILABLE|ANALYZER_UNAVAILABLE|NO_SYNTAX_CHECKER|SYNTAX_STATE_UNRESOLVED|ENGINE_THREW/.test(r.reason || ''));
  assert.deepStrictEqual(env, [], 'رفضٌ سببه البيئة لا الإصلاح: ' + JSON.stringify(env));
  for (const a of report.accepted) {
    assert.ok(a.removedIssues >= 1, `قبول بلا إنقاص بلاغات (${a.source})`);
  }
});

test('إصلاح متعلَّم صحيح يصل إلى الملف فعلاً — المسار غير مقطوع', () => {
  const ctx = loadCtx();
  ctx.__store.set(STORAGE_KEY, mkDb([P_LEARN()]));
  const { report, out } = runPipe(ctx, { 'h.js': LEARN_JS });
  assert.ok(srcOf(report, 'h.js').includes('applyLearned'), 'لم يُقبل إصلاح التعلّم');
  assert.ok(/JSON\.parse\(x\)/.test(out['h.js']), 'بديل النمط لم يُكتب');
  assert.ok(!/eval\(x\)/.test(out['h.js']), 'eval باقٍ');
});

// ═══ 5. النتيجة تُسجَّل في مكانها ══════════════════════

test('التسجيل: totalFixed = مجموع ما أزالته البوابة، وR يطابق F', () => {
  const ctx = loadCtx();
  const { report, out, rState } = runPipe(ctx, { 'a.js': VULN_JS, 'b.py': VULN_PY });
  const sum = (report.accepted || []).reduce((s, a) => s + (a.removedIssues || 0), 0);
  assert.strictEqual(report.totalFixed, sum, 'totalFixed لا يساوي ما أزالته البوابة');
  for (const fn of Object.keys(out)) {
    assert.ok(rState[fn], `لا مدخل R لـ${fn}`);
    assert.strictEqual(rState[fn].code, out[fn], `R لا يطابق F في ${fn}`);
  }
  for (const a of report.accepted) {
    assert.ok(a.syntaxStatus, 'سجل القبول بلا حالة نحوية من البوابة');
    assert.ok(a.source, 'سجل القبول بلا مصدر');
  }
  for (const key of ['accepted', 'rejected', 'deferred', 'warnings', 'aiNeeded', 'learnedOutcomes']) {
    assert.ok(Array.isArray(report[key]), `حقل التقرير ${key} مفقود`);
  }
});

test('[P4-3] ادّعاء المحرك لا يُضاعَف: مجموعٌ على ملفين لا يُنسب لكل ملف', () => {
  const ctx = loadCtx();
  const { report } = runPipe(ctx, {
    'a.py': 'import hashlib\ndef f(x):\n    return hashlib.md5(x).hexdigest()\n',
    'b.py': 'import hashlib\ndef g(y):\n    return hashlib.md5(y).hexdigest()\n',
  });
  const iso = (report.accepted || []).filter(a => /Emergency|SmartRepair|Fallback/.test(a.source));
  assert.ok(iso.length >= 2, 'محرك معزول لم يصلح ملفين ⇒ تغطية خاوية: ' +
    JSON.stringify((report.accepted || []).map(a => a.file + '/' + a.source)));
  for (const a of iso) {
    assert.strictEqual(a.claimedCount, null,
      `ادّعاء لكل ملف (${a.claimedCount}) من محرك يُرجع مجموعًا على عدة ملفات`);
    assert.ok(a.removedIssues >= 1, 'رقم البوابة الموثوق مفقود');
  }
});

test('[P4-3] وعند تغيّر ملف واحد يُنسب الادّعاء كما هو', () => {
  const ctx = loadCtx();
  const { report } = runPipe(ctx, { 'a.py': 'import hashlib\ndef f(x):\n    return hashlib.md5(x).hexdigest()\n' });
  const iso = (report.accepted || []).filter(a => /Emergency|SmartRepair|Fallback/.test(a.source));
  assert.ok(iso.length === 1, 'المطلوب ملف واحد متغيّر: ' + JSON.stringify(iso.map(a => a.file)));
  assert.ok(typeof iso[0].claimedCount === 'number' && iso[0].claimedCount >= 1,
    'الادّعاء لم يُنسب في حالة الملف الواحد: ' + iso[0].claimedCount);
});

// ═══ 6. الضرر وحده يُعاقَب ═════════════════════════════

test('السياسة: «بلا تحسّن مقيس» يُرفض ولا يُسجَّل فشلاً', () => {
  const ctx = loadCtx();
  ctx.__store.set(STORAGE_KEY, mkDb([P_BENIGN()]));
  const { report, db } = runPipe(ctx, { 'h.js': LEARN_JS });
  const o = (report.learnedOutcomes || []).find(x => x.patternId === 'p-benign');
  assert.ok(o, 'النمط لم يُطبَّق ⇒ تغطية خاوية');
  assert.notStrictEqual(o.outcome, 'PASS', 'المتوقَّع رفض لا قبول');
  assert.strictEqual(o.harmful, false, 'صُنِّف ضارًّا: ' + o.gateReason + '/' + o.ghostReason);
  assert.strictEqual(db.patterns[0].failures, 0, 'عوقب نمط لم يَضرّ');
  assert.strictEqual(db.patterns[0].approved, true, 'أُسقط اعتماد نمط لم يَضرّ');
});

test('السياسة: رفضٌ بسبب لا نعرفه لا يُعاقَب عليه', () => {
  const ctx = loadCtx();
  ctx.__store.set(STORAGE_KEY, mkDb([P_LEARN()]));
  vm.runInContext(`
    FixVerifier.verifyFix = function () {
      return { accepted: false, reason: 'REJECTED_SOMETHING_WE_DO_NOT_KNOW',
               syntaxStatus: 'unknown', language: 'js', afterIssues: null };
    };`, ctx);
  const { report, db } = runPipe(ctx, { 'h.js': LEARN_JS });
  const o = (report.learnedOutcomes || []).find(x => x.patternId === 'p-learn');
  assert.ok(o, 'النمط لم يُطبَّق ⇒ تغطية خاوية');
  assert.strictEqual(o.harmful, false, 'سبب مجهول صُنِّف ضارًّا — عقوبة على تخمين');
  assert.strictEqual(db.patterns[0].failures, 0, 'سُجِّل فشل على سبب مجهول');
});

test('الحلقة مُغلقة: ثلاثة أضرار ⇒ حظر، والتشغيل التالي لا يطبّق النمط', () => {
  const ctx = loadCtx();
  ctx.__store.set(STORAGE_KEY, mkDb([P_HARM()]));
  for (let i = 0; i < 3; i++) runPipe(ctx, { ['x' + i + '.js']: LEARN_JS });
  const mid = JSON.parse(ctx.__store.get(STORAGE_KEY)).patterns[0];
  assert.strictEqual(mid.failures, 3, 'العدّاد لم يبلغ ثلاثًا: ' + mid.failures);
  assert.strictEqual(mid.approved, false, 'الاعتماد لم يُسقَط عند الحظر');
  const { report } = runPipe(ctx, { 'x9.js': LEARN_JS });
  assert.deepStrictEqual((report.learnedOutcomes || []).filter(o => o.patternId === 'p-harm'), [],
    'النمط المحظور ما زال يُطبَّق — الحلقة لا تؤثر في القرار اللاحق');
});

// ═══ 7. الدورة كاملة: تعلّم ذاتي ثم استفادة ════════════

test('الدورة كاملة: تشغيلان يُنتجان خبرة معتمدة، وتشغيلٌ ثالث يستعملها', () => {
  // لا زرع إطلاقًا: المخزن يبدأ فارغًا والخبرة تُبنى من إصلاحات حقيقية
  // قبلتها البوابة. العيّنات من عائلة واحدة بمعرّفات مختلفة في كل تشغيل،
  // فالاعتماد يشترط التعميم: البصمة الحرفية وحدها لا تتراكم.
  const ctx = loadCtx();
  const T1 = 'function a(el, t) {\n  el.innerHTML = t;\n  return el;\n}\n';
  const T2 = 'function b(nd, u) {\n  nd.innerHTML = u;\n  return nd;\n}\n';
  const T3 = 'function c(bx, v) {\n  bx.innerHTML = v;\n  return bx;\n}\n';

  const r1 = runPipe(ctx, { 't1.js': T1 });
  assert.ok(srcOf(r1.report, 't1.js').some(s => /repairCode/.test(s)), 'التدريب 1 لم يُصلح شيئًا');
  assert.strictEqual(r1.db.patterns.length, 1, 'التدريب 1 لم يُنتج سجلًّا واحدًا: ' + r1.db.patterns.length);
  const p1 = r1.db.patterns[0];
  assert.ok(p1.generalized && p1.generalized.beforeTemplate.includes('__LEARN_ID_'),
    'السجل بلا قالب معمَّم ⇒ لن يتراكم عليه دليل من معرّفات أخرى');
  assert.strictEqual(p1.verified, 1, 'التحقق لم يُسجَّل بعد قبول البوابة: ' + p1.verified);
  assert.strictEqual(p1.approved, false, 'اعتماد بدليل واحد — العتبة لم تُحترم');

  const r2 = runPipe(ctx, { 't2.js': T2 });
  assert.strictEqual(r2.db.patterns.length, 1, 'التدريب 2 أنشأ سجلًّا ثانيًا بدل التراكم');
  const p2 = r2.db.patterns[0];
  assert.strictEqual(p2.observed, 2, 'الدليل لم يتراكم: observed=' + p2.observed);
  assert.strictEqual(p2.verified, 2, 'التحقق لم يتراكم: verified=' + p2.verified);
  assert.ok(p2.confidence >= 0.6, 'الثقة لم تبلغ العتبة: ' + p2.confidence);
  assert.strictEqual(p2.approved, true, 'الخبرة لم تُعتمد بعد دليلين');

  // الاستفادة: الخبرة المتعلَّمة ذاتيًا تُصلح شكلاً لم يُرَ قبلاً
  const direct = vm.runInContext('(function(){ const r = LearningEngine.applyLearned(' +
    JSON.stringify(T3) + ', "t3.js"); return JSON.stringify({ applied: r.applied, via: (r.uses[0]||{}).via, fixed: r.fixed }); })()', ctx);
  const d = JSON.parse(direct);
  assert.strictEqual(d.applied, 1, 'الخبرة المعتمدة لا تُطابق شكلاً جديدًا من عائلتها');
  assert.strictEqual(d.via, 'general', 'المطابقة ليست بالقالب المعمَّم بل ' + d.via);
  assert.ok(/bx\.textContent = v;/.test(d.fixed), 'الناتج غير متوقَّع');

  // وعبر المسار الكامل: بلا repairCode يبقى التعلّم هو المُصلِح — وهذا ما
  // كان [P4-2] يمنعه (الأحكام 0 ولا كتابة).
  vm.runInContext('repairCode = undefined;', ctx);
  const r3 = runPipe(ctx, { 't3.js': T3 });
  assert.deepStrictEqual(srcOf(r3.report, 't3.js'), ['applyLearned'],
    'المُصلِح ليس التعلّم: ' + JSON.stringify(srcOf(r3.report, 't3.js')));
  const o3 = (r3.report.learnedOutcomes || [])[0];
  assert.ok(o3 && o3.outcome === 'PASS', 'لا حكم موجب مسجَّل على الاستعمال');
  assert.ok(/bx\.textContent = v;/.test(r3.out['t3.js']), 'الإصلاح لم يصل إلى الملف');
  const p3 = r3.db.patterns[0];
  assert.ok(p3.lastUsed, 'الدفتر لم يُسجَّل بعد قبول البوابة');
  assert.strictEqual(p3.failures, 0, 'فشل سُجِّل على استعمال ناجح');
});

test('[P4-2] بلا repairCode يبقى مسار التعلّم ومزامنة R قائمين', () => {
  const ctx = loadCtx();
  ctx.__store.set(STORAGE_KEY, mkDb([P_LEARN()]));
  vm.runInContext('repairCode = undefined;', ctx);
  const { report, out, rState } = runPipe(ctx, { 'h.js': LEARN_JS });
  assert.strictEqual((report.learnedOutcomes || []).length, 1,
    'مسار التعلّم سقط مع غياب محرك آخر');
  assert.ok(/JSON\.parse\(x\)/.test(out['h.js']), 'الإصلاح المتعلَّم لم يُكتب');
  assert.ok(rState['h.js'] && rState['h.js'].code === out['h.js'], 'مزامنة R سقطت أيضًا');
});

// ═══ 8. حدّ معلن في وصول التعلّم إلى الكشف ═════════════

test('موثَّق: دفعات التعلّم تصل إلى كشف java ولا تصل إلى مسار js', () => {
  // التيار المقصود: نمط عالي الدليل (confidence ≥ 0.8) يرفع ثقة البلاغ من
  // نوعه. وهو موصول في engine_java (ومن خلاله UnifiedEngine) فقط. المقيس:
  //   java SQL_INJECTION: conf 90 ⇒ 98 و learned=true
  //   js   XSS:            conf 92 ⇒ 92 بلا أي علامة، مع وجود boosts
  // أي أن الحلقة «تعلّم ← كشف» تعمل في لغة واحدة. التثبيت هنا تصريح بالحدّ،
  // لا دعوى تكامل: توسيعه يغيّر ثقة الكشف في كل اللغات بلا حاجة مثبتة.
  const hot = (id, type) => ({ id, type, language: 'js', before: 'x', after: 'y',
    fingerprint: 'f' + id, observed: 12, verified: 12, failures: 0, confidence: 0.9, approved: true });
  const JAVA = 'public class A {\n  void f(java.sql.Statement s, String x) throws Exception {\n    s.executeQuery("SELECT * FROM t WHERE a=" + x);\n  }\n}\n';
  const JS   = 'function f(el, x) {\n  el.innerHTML = x;\n  return el;\n}\n';
  const read = (ctx, code, fn) => JSON.parse(vm.runInContext(
    'JSON.stringify(analyzeCode(' + JSON.stringify(code) + ', ' + JSON.stringify(fn) +
    ').map(i => ({ t: i.type || i.cAct, conf: i.conf, learned: !!i.learned, boosted: !!i.boosted })))', ctx));

  const base = loadCtx();
  const jBase = read(base, JAVA, 'A.java').find(i => /SQL/i.test(i.t || ''));
  const sBase = read(base, JS, 'a.js').find(i => /XSS/i.test(i.t || ''));
  assert.ok(jBase && sBase, 'العيّنتان لا تُنتجان البلاغ المطلوب ⇒ تغطية خاوية');

  const seeded = loadCtx();
  seeded.__store.set(STORAGE_KEY, mkDb([hot('h1', 'SQL_INJECTION'), hot('h2', 'XSS')]));
  const boosts = vm.runInContext('LearningEngine.getBoosts().size', seeded);
  assert.ok(boosts >= 2, 'الدفعات لم تُحسب ⇒ تغطية خاوية');

  const jSeed = read(seeded, JAVA, 'A.java').find(i => /SQL/i.test(i.t || ''));
  assert.ok(jSeed.conf > jBase.conf, `java: الثقة لم تُرفَع (${jBase.conf} ⇒ ${jSeed.conf})`);
  assert.strictEqual(jSeed.learned, true, 'java: البلاغ غير مُعلَّم بأنه متعلَّم');

  const sSeed = read(seeded, JS, 'a.js').find(i => /XSS/i.test(i.t || ''));
  assert.strictEqual(sSeed.conf, sBase.conf,
    `تغيّر السلوك: مسار js صار يستعمل الدفعات (${sBase.conf} ⇒ ${sSeed.conf}) — راجع هذا التوثيق`);
  assert.strictEqual(sSeed.boosted, false, 'تغيّر السلوك: js صار يُعلّم البلاغ');
});
