// ═══════════════════════════════════════════════════════════════════════
// عقد advanced_repair_engine.js (executeSmartRepairs)
// تشغيل:  node --test vercel-api/test/advanced_repair_engine.test.js
//
// الملف سكربت متصفح بلا exports، فيُحمَّل في سياق vm معزول مع globals مُمرَّرة
// (repairCode / FixVerifier / analyzeCode) — مثلما تُحمَّل بقية الوحدات. وتعمل
// الاختبارات الأخيرة على المحرك الحقيقي كاملًا (قائمة MODULES نفسها).
// النتائج تُطبَّع بـJSON لأن مصفوفات سياق vm عالمٌ آخر (deepStrictEqual يفشل بينها).
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SRC = fs.readFileSync(path.join(PUBLIC_DIR, 'advanced_repair_engine.js'), 'utf8');

function load(globals) {
  const ctx = vm.createContext(Object.assign({ console: { log() {}, warn() {}, error() {} } }, globals || {}));
  vm.runInContext(SRC, ctx, { filename: 'advanced_repair_engine.js' });
  return ctx;
}
function run(globals, code, analysis, fileName) {
  const ctx = load(globals);
  ctx.__args = [code, analysis, fileName];
  const argc = fileName === undefined ? 2 : 3;
  const out = vm.runInContext(
    'JSON.stringify(executeSmartRepairs.apply(null, __args.slice(0, ' + argc + ')))', ctx);
  return JSON.parse(out);
}

const CODE = 'var a = 1;\nif (a == 2) {}\n';
const FIXED = 'let a = 1;\nif (a === 2) {}\n';
const ISSUES = [
  { line: 1, title: 'var', sev: 'l' },
  { line: 2, title: 'eq',  sev: 'm' },
];
const analysis = (extra) => Object.assign({ total: 2, riskScore: 80, rawIssues: ISSUES }, extra);
const accepting = calls => ({
  verifyFix(b, a, f, an) { if (calls) calls.push({ b, a, f, hasAnalyze: typeof an === 'function' });
                           return { accepted: true, reason: 'ACCEPTED', syntaxStatus: 'verified' }; },
});
const repairsOf = (...conf) => conf.map((c, i) => {
  const r = { line: i + 1, title: ISSUES[i] ? ISSUES[i].title : 't' + i, before: 'b', after: 'a', strategy: 'S' };
  if (c !== undefined) r.confidence = c;
  return r;
});
const engine = (res) => ({ repairCode: () => res, analyzeCode: () => [] });

// ─── 1. الثقة ──────────────────────────────────────────────────────────
test('[ARE-1] confidence: 0 تبقى 0، والغائبة null (لا 0.80 مختلَقة)، والمحدَّدة كما هي', () => {
  const g = Object.assign(engine({ repaired: FIXED, repairs: repairsOf(0, undefined), aiNeeded: [] }),
                          { FixVerifier: accepting() });
  const r = run(g, CODE, analysis());
  const [a, b] = r.recommendations;
  assert.strictEqual(a.confidence, 0, 'القيمة 0 حُوِّلت إلى افتراضي');
  assert.strictEqual(b.confidence, null, 'لا ثقة افتراضية لإصلاحٍ لم يحدد المحرك ثقته');
  const r2 = run(Object.assign(engine({ repaired: FIXED, repairs: repairsOf(0.9), aiNeeded: [] }),
                               { FixVerifier: accepting() }), CODE, analysis());
  assert.strictEqual(r2.recommendations[0].confidence, 0.9);
});

// ─── 2. autoFix من التحقق لا من repairs.length ──────────────────────────
test('[ARE-2] البوابة تقبل ⇒ VERIFIED/autoFix=true، وتُنادى بالأصل والمرشَّح واسم الملف', () => {
  const calls = [];
  const g = Object.assign(engine({ repaired: FIXED, repairs: repairsOf(0.9, 0.9), aiNeeded: [] }),
                          { FixVerifier: accepting(calls) });
  const r = run(g, CODE, analysis(), 'srv/app.js');
  assert.strictEqual(calls.length, 1, 'حكم واحد على المرشَّح كاملًا');
  assert.deepStrictEqual([calls[0].b, calls[0].a, calls[0].f, calls[0].hasAnalyze], [CODE, FIXED, 'srv/app.js', true]);
  assert.ok(r.recommendations.every(x => x.autoFix === true && x.status === 'VERIFIED'));
  assert.strictEqual(r.verification.status, 'ACCEPTED');
  assert.deepStrictEqual([r.summary.proposed, r.summary.verified, r.summary.applied, r.autoFixed], [2, 2, 0, 2]);
});

test('[ARE-2b] البوابة ترفض ⇒ GATE_REJECTED/autoFix=false بسببها، والمرشَّح لا يُدَّعى مُصلَحًا', () => {
  const g = Object.assign(engine({ repaired: FIXED, repairs: repairsOf(0.9, 0.9), aiNeeded: [] }),
    { FixVerifier: { verifyFix: () => ({ accepted: false, reason: 'REJECTED_NO_IMPROVEMENT x' }) } });
  const r = run(g, CODE, analysis());
  assert.ok(r.recommendations.every(x => x.autoFix === false && x.status === 'GATE_REJECTED'));
  assert.strictEqual(r.recommendations[0].gateReason, 'REJECTED_NO_IMPROVEMENT x');
  assert.deepStrictEqual([r.summary.proposed, r.summary.verified, r.autoFixed], [2, 0, 0]);
  assert.strictEqual(r.verification.status, 'REJECTED');
});

test('[ARE-2c] البوابة غائبة أو ترمي ⇒ UNVERIFIED (لا قبول بالتخمين، ولا إخفاء للخطأ)', () => {
  const base = engine({ repaired: FIXED, repairs: repairsOf(0.9), aiNeeded: [] });
  const none = run(base, CODE, analysis());
  assert.strictEqual(none.recommendations[0].status, 'UNVERIFIED');
  assert.strictEqual(none.recommendations[0].autoFix, false);
  assert.strictEqual(none.verification.status, 'UNAVAILABLE');

  const thr = run(Object.assign({}, base, { FixVerifier: { verifyFix() { throw new Error('gate boom'); } } }),
                  CODE, analysis());
  assert.strictEqual(thr.recommendations[0].status, 'UNVERIFIED');
  assert.strictEqual(thr.verification.status, 'ERROR');
  assert.match(thr.verification.reason, /gate boom/);
  assert.strictEqual(thr.autoFixed, 0);
});

test('[ARE-2d] repairs مذكورة لكن الكود لم يتغيّر ⇒ NO_EFFECT، والبوابة لا تُنادى', () => {
  const calls = [];
  const g = Object.assign(engine({ repaired: CODE, repairs: repairsOf(0.9), aiNeeded: [] }),
                          { FixVerifier: accepting(calls) });
  const r = run(g, CODE, analysis());
  assert.strictEqual(r.recommendations[0].status, 'NO_EFFECT');
  assert.strictEqual(r.recommendations[0].autoFix, false);
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual([r.summary.proposed, r.summary.verified], [1, 0]);
});

// ─── 3. المخاطر ────────────────────────────────────────────────────────
test('[ARE-3] بلا reAnalysis: remaining/riskAfter = null + UNAVAILABLE (لا riskScore − autoFixed×10)', () => {
  const g = Object.assign(engine({ repaired: FIXED, repairs: repairsOf(0.9, 0.9), aiNeeded: [] }),
                          { FixVerifier: accepting() });
  const r = run(g, CODE, analysis());           // riskScore 80، مُصلَح 2 ⇒ المعادلة القديمة تعطي 60
  assert.strictEqual(r.reAnalysis, null);
  assert.strictEqual(r.summary.riskAfter, null);
  assert.strictEqual(r.summary.riskAfterStatus, 'UNAVAILABLE');
  assert.strictEqual(r.summary.remaining, null);
  assert.strictEqual(r.summary.remainingStatus, 'UNAVAILABLE');
  assert.strictEqual(r.summary.riskBefore, 80);
});

test('[ARE-3b] reAnalysis موجود: المقاس فقط يُعرض، وغير الرقمي/الناقص UNAVAILABLE', () => {
  const mk = re => Object.assign(
    engine({ repaired: FIXED, repairs: repairsOf(0.9), aiNeeded: [], reAnalysis: re }),
    { FixVerifier: accepting() });
  const ok = run(mk({ issuesAfter: 1, riskAfter: 15 }), CODE, analysis());
  assert.deepStrictEqual([ok.summary.remaining, ok.summary.remainingStatus], [1, 'MEASURED']);
  assert.deepStrictEqual([ok.summary.riskAfter, ok.summary.riskAfterStatus], [15, 'MEASURED']);

  const zero = run(mk({ issuesAfter: 0, riskAfter: 0 }), CODE, analysis());
  assert.deepStrictEqual([zero.summary.remaining, zero.summary.riskAfter], [0, 0], '0 رقم مقاس لا غياب');

  // reAnalysis بلا riskAfter: لا اشتقاق من المعادلة القديمة (كان سيعطي 70)
  const partial = run(mk({ issuesAfter: 1 }), CODE, analysis());
  assert.strictEqual(partial.summary.remainingStatus, 'MEASURED');
  assert.strictEqual(partial.summary.riskAfter, null);
  assert.strictEqual(partial.summary.riskAfterStatus, 'UNAVAILABLE');

  const junk = run(mk({ issuesAfter: 'x', riskAfter: NaN }), CODE, analysis());
  assert.deepStrictEqual([junk.summary.remainingStatus, junk.summary.riskAfterStatus], ['UNAVAILABLE', 'UNAVAILABLE']);
});

// ─── 4. سلامة النتائج والاستثناءات ─────────────────────────────────────
test('[ARE-4] نتيجة ناقصة ({}): بلا استثناء، malformed يذكر الناقص، ولا إصلاح مُدَّعى', () => {
  const r = run(engine({}), CODE, analysis());
  assert.strictEqual(r.engineStatus, 'MALFORMED_RESULT');
  assert.ok(r.malformed.includes('repairs') && r.malformed.includes('aiNeeded'));
  assert.strictEqual(r.repaired, CODE);
  assert.strictEqual(r.autoFixed, 0);
  assert.strictEqual(r.unresolved.length, 2, 'كل البلاغات تبقى غير معالجة');
});

test('[ARE-4b] repairs/aiNeeded ليستا مصفوفتين، وعناصر null داخلها', () => {
  const a = run(engine({ repaired: CODE, repairs: 'x', aiNeeded: { length: 1 } }), CODE, analysis());
  assert.strictEqual(a.engineStatus, 'MALFORMED_RESULT');
  assert.deepStrictEqual(a.recommendations, []);
  const b = run(Object.assign(engine({ repaired: FIXED, repairs: [null, ...repairsOf(0.9)], aiNeeded: [null] }),
                              { FixVerifier: accepting() }), CODE, analysis());
  assert.ok(b.malformed.includes('repairs[]') && b.malformed.includes('aiNeeded[]'));
  assert.strictEqual(b.recommendations.length, 1);
  const c = run(engine({ repaired: 42, repairs: [], aiNeeded: [] }), CODE, analysis());
  assert.strictEqual(c.repaired, CODE, 'repaired غير نصّي ⇒ الأصلي، مع تسجيل malformed');
  assert.ok(c.malformed.includes('repaired'));
});

test('[ARE-4c] repairCode يرمي أو يُرجع فارغًا ⇒ ENGINE_ERROR ظاهر، والكود الأصلي، والبلاغات باقية بالسبب', () => {
  const thr = run({ repairCode() { throw new Error('boom 123'); } }, CODE, analysis());
  assert.strictEqual(thr.engineStatus, 'ENGINE_ERROR');
  assert.strictEqual(thr.error.message, 'boom 123');
  assert.strictEqual(thr.repaired, CODE);
  assert.strictEqual(thr.autoFixed, 0);
  assert.strictEqual(thr.unresolved.length, 2);
  assert.match(thr.unresolved[0].reason, /ENGINE_ERROR.*boom 123/);

  const nul = run({ repairCode: () => null }, CODE, analysis());
  assert.strictEqual(nul.engineStatus, 'ENGINE_ERROR');
  assert.ok(nul.error && nul.error.message);
});

test('[ARE-4d] غياب repairCode: fallback الحرج للمراجعة، والباقي unresolved بسبب «المحرك غير متاح»', () => {
  const issues = [{ line: 1, title: 'crit', sev: 'c' }, { line: 2, title: 'low', sev: 'l' }];
  const r = run({}, CODE, analysis({ rawIssues: issues, total: 2 }));
  assert.strictEqual(r.engineStatus, 'ENGINE_UNAVAILABLE');
  assert.strictEqual(r.needsAI, 1);
  assert.strictEqual(r.unresolved.length, 1);
  assert.strictEqual(r.unresolved[0].title, 'low');
  assert.match(r.unresolved[0].reason, /REPAIR_ENGINE_UNAVAILABLE/);
});

test('[ARE-4e] analysis غير صالح ⇒ المفاتيح القديمة كما هي + engineStatus=INVALID_INPUT', () => {
  for (const bad of [null, undefined, {}, { rawIssues: 'x' }]) {
    const r = run(engine({}), CODE, bad);
    assert.strictEqual(r.engineStatus, 'INVALID_INPUT');
    assert.deepStrictEqual([r.repaired, r.recommendations, r.autoFixed, r.needsAI, r.estimatedTime],
                           [CODE, [], 0, 0, 'N/A']);
  }
});

// ─── 5. اسم الملف ──────────────────────────────────────────────────────
test('[ARE-5] اسم الملف: المعامل الثالث ثم analysis.fileName ثم code.js — ويصل repairCode والبوابة', () => {
  const seen = [];
  const g = () => Object.assign({
    repairCode: (c, i, f) => { seen.push(f); return { repaired: FIXED, repairs: repairsOf(0.9), aiNeeded: [] }; },
    analyzeCode: () => [],
  }, { FixVerifier: { verifyFix: (b, a, f) => { seen.push('gate:' + f); return { accepted: true, reason: 'ok' }; } } });

  const c = run(g(), CODE, analysis(), 'api/user.py');
  assert.deepStrictEqual([c.fileName, c.fileNameSource], ['api/user.py', 'caller']);
  const a = run(g(), CODE, analysis({ fileName: 'from_analysis.ts' }));
  assert.deepStrictEqual([a.fileName, a.fileNameSource], ['from_analysis.ts', 'analysis']);
  const d = run(g(), CODE, analysis());                // استدعاء بمعاملين كما كان
  assert.deepStrictEqual([d.fileName, d.fileNameSource], ['code.js', 'default']);
  const blank = run(g(), CODE, analysis(), '   ');
  assert.strictEqual(blank.fileNameSource, 'default');
  assert.deepStrictEqual(seen.slice(0, 2), ['api/user.py', 'gate:api/user.py']);
});

// ─── 6. العدادات والبلاغات غير المعالجة ─────────────────────────────────
test('[ARE-6] rejected تُحفَظ بسببها، وغير المُبلَّغ يظهر، والمُعالَج بمطابقة تامة لا يظهر (المُزاح السطر يبقى ظاهرًا)', () => {
  const issues = [
    { line: 1, title: 'fixed-shifted', sev: 'l' },   // أصلحه المحرك لكن بسطر مُزاح (9): لا ربط بالعنوان وحده
    { line: 2, title: 'ghost-dropped', sev: 'm' },
    { line: 3, title: 'silent',        sev: 'm' },
    { line: 4, title: 'needs-ai',      sev: 'c' },
  ];
  const g = Object.assign(engine({
    repaired: FIXED,
    repairs:  [{ line: 9, title: 'fixed-shifted', before: 'b', after: 'a', strategy: 'S', confidence: 0.9 }],
    aiNeeded: [{ line: 4, title: 'needs-ai', reason: 'manual', ev: 'e' }],
    rejected: [{ line: 2, strategy: 'LOOSE_EQUALITY', source: 'GhostMode', reason: 'GHOST_DISCARDED_BATCH — why' },
               { line: null, strategy: 'MISSING_AUTH', source: 'AuthRepair', reason: 'AUTH_NOT_ADDITIVE' }],
  }), { FixVerifier: accepting() });
  const r = run(g, CODE, analysis({ rawIssues: issues, total: 4 }));

  // المُزاح السطر (fixed-shifted) يبقى ظاهرًا: لا ربط بالعنوان وحده؛ والإصلاح نفسه ظاهر في recommendations
  assert.deepStrictEqual(r.unresolved.map(u => u.title), ['fixed-shifted', 'ghost-dropped', 'silent']);
  assert.strictEqual(r.unresolved[0].source, 'NOT_REPORTED');
  assert.strictEqual(r.unresolved[1].source, 'REJECTED_SAME_LINE');
  assert.strictEqual(r.unresolved[1].attribution, 'SAME_LINE_ONLY');
  assert.match(r.unresolved[1].reason, /GHOST_DISCARDED_BATCH — why/);
  assert.strictEqual(r.unresolved[2].source, 'NOT_REPORTED');
  assert.match(r.unresolved[2].reason, /NOT_REPORTED_BY_ENGINE/);
  assert.strictEqual(r.rejected.length, 2, 'rejected كاملة تُمرَّر بما فيها ما لا سطر له');
  assert.deepStrictEqual([r.summary.proposed, r.summary.verified, r.summary.applied, r.summary.needsAI, r.summary.unresolved],
                         [1, 1, 0, 1, 3]);
});

test('[ARE-6b] estimatedTime يبقى محسوبًا على المقترَح كما كان (لا يتغيّر بنتيجة التحقق)', () => {
  const rep = Array.from({ length: 20 }, (_, i) => ({ line: i + 1, title: 't' + i, confidence: 0.9 }));
  const noGate = run(engine({ repaired: FIXED, repairs: rep, aiNeeded: [] }), CODE, analysis({ rawIssues: [], total: 20 }));
  assert.strictEqual(noGate.estimatedTime, '2 دقيقة');   // 20 × 0.1
  assert.strictEqual(noGate.autoFixed, 0);
});

// ─── 6c. إصلاحات المراجعة النهائية ──────────────────────────────────────
// نتيجة خام بلا تطبيع JSON: التطبيع يحوّل undefined/NaN/Infinity إلى null أو يحذفها فيُخفي تسرّبها.
function runRaw(globals, code, a, fileName) {
  const ctx = load(globals);
  ctx.__args = [code, a, fileName];
  return vm.runInContext('executeSmartRepairs.apply(null, __args.slice(0, ' + (fileName === undefined ? 2 : 3) + '))', ctx);
}

test('[ARE-8] مطابقة على مرحلتين: الإصلاح على السطر 5 لا يُنسَب خطأً إلى السطر 1', () => {
  const issues = [{ line: 1, title: 'var', sev: 'l' }, { line: 5, title: 'var', sev: 'l' }];
  const g = Object.assign(engine({ repaired: FIXED, repairs: [{ line: 5, title: 'var', confidence: 0.9 }], aiNeeded: [] }),
                          { FixVerifier: accepting() });
  const r = run(g, CODE, analysis({ rawIssues: issues, total: 2 }));
  assert.deepStrictEqual(r.unresolved.map(u => u.line), [1],
    'المطابقة بالعنوان وحده التهمت السطر 1 وأبقت السطر المُصلَح في unresolved');
  // عنوانٌ مماثل على سطرٍ مختلف لا يُربط بالإصلاح: البلاغ يبقى unresolved (لا يُخفى بلا دليل)،
  // والإصلاح نفسه يبقى ظاهرًا في recommendations.
  const other = run(g, CODE, analysis({ rawIssues: [{ line: 3, title: 'var', sev: 'l' }], total: 1 }));
  assert.deepStrictEqual(other.unresolved.map(u => u.line), [3]);
  assert.strictEqual(other.recommendations.length, 1);
  assert.strictEqual(other.recommendations[0].line, 5);
});

test('[ARE-8c] عنوان مماثل على سطر مختلف لا يلتهم إصلاحًا يخصّ بلاغًا آخر (لا مطابقة بالعنوان وحده)', () => {
  // إصلاحان بالعنوان نفسه على السطرين 5 و9، وبلاغان بالعنوان نفسه على 5 و7:
  // السطر 5 يطابق تامًّا، والسطر 7 لا مطابق له ⇒ يبقى unresolved ولا يأخذ إصلاح السطر 9.
  const issues = [{ line: 5, title: 'var', sev: 'l' }, { line: 7, title: 'var', sev: 'l' }];
  const g = Object.assign(engine({ repaired: FIXED, aiNeeded: [],
    repairs: [{ line: 9, title: 'var', confidence: 0.9 }, { line: 5, title: 'var', confidence: 0.9 }] }),
    { FixVerifier: accepting() });
  const r = run(g, CODE, analysis({ rawIssues: issues, total: 2 }));
  assert.deepStrictEqual(r.unresolved.map(u => u.line), [7]);
});

test('[ARE-8b] سبب الرفض يُسند بالسطر وحده ويُصرَّح بذلك (لا جزم بأنه يخصّ هذا البلاغ)', () => {
  const issues = [{ line: 2, title: 'A', sev: 'm' }, { line: 2, title: 'B', sev: 'm' }];
  const g = Object.assign(engine({ repaired: CODE, repairs: [], aiNeeded: [],
    rejected: [{ line: 2, strategy: 'LOOSE_EQUALITY', source: 'GhostMode', reason: 'GHOST_DISCARDED_BATCH — z' }] }),
    { FixVerifier: accepting() });
  const r = run(g, CODE, analysis({ rawIssues: issues, total: 2 }));
  assert.ok(r.unresolved.every(u => u.source === 'REJECTED_SAME_LINE' && u.attribution === 'SAME_LINE_ONLY'));
  assert.strictEqual(r.unresolved.length, 2, 'لا بلاغ يسقط');
  // النص نفسه لا يعرض السبب كأنه مؤكَّد: يبدأ بـUNCONFIRMED ويذكر استراتيجية الرفض، والسبب الأصلي محفوظ
  for (const u of r.unresolved) {
    assert.match(u.reason, /^UNCONFIRMED \(matched by line only; rejected strategy: LOOSE_EQUALITY\) — /);
    assert.match(u.reason, /GHOST_DISCARDED_BATCH — z/);
  }
  assert.strictEqual(r.rejected[0].reason, 'GHOST_DISCARDED_BATCH — z', 'قائمة rejected الخام لا تُعدَّل');
});

test('[ARE-9] تغيّر الكود بلا repairs ⇒ unlistedChange=true ويمرّ بالبوابة (لا سكوت)', () => {
  const calls = [];
  const mk = (repaired, gate) => Object.assign(engine({ repaired, repairs: [], aiNeeded: [] }), { FixVerifier: gate });
  const r = run(mk(CODE + '// injected\n', accepting(calls)), CODE, analysis());
  assert.strictEqual(r.unlistedChange, true);
  assert.strictEqual(calls.length, 1, 'المرشَّح المتغيّر يُحكَم عليه ولو بلا إصلاحات مُدرجة');
  assert.strictEqual(r.verification.status, 'ACCEPTED');
  assert.strictEqual(r.autoFixed, 0, 'لا إصلاح مُدرَج ⇒ لا عدّ');

  const rej = run(mk(CODE + '// injected\n', { verifyFix: () => ({ accepted: false, reason: 'REJECTED_X' }) }), CODE, analysis());
  assert.deepStrictEqual([rej.unlistedChange, rej.verification.status], [true, 'REJECTED']);

  const none = run(mk(CODE, accepting(calls)), CODE, analysis());
  assert.deepStrictEqual([none.unlistedChange, none.verification.status, none.verification.reason],
                         [false, 'NOT_APPLICABLE', 'NO_REPAIRS']);
  assert.strictEqual(calls.length, 1, 'لا تغيير ⇒ لا نداء للبوابة');
});

test('[ARE-10] لغة بلا فاحص تركيبي ⇒ UNVERIFIABLE (عجزٌ عن التحقق) لا GATE_REJECTED، وautoFix=false', () => {
  const g = Object.assign(engine({ repaired: FIXED, repairs: repairsOf(0.9, 0.9), aiNeeded: [] }),
    { FixVerifier: { verifyFix: () => ({ accepted: false,
        reason: 'REJECTED_NO_SYNTAX_CHECKER [typescript]: no TypeScript checker' }) } });
  const r = run(g, CODE, analysis(), 'svc/app.ts');
  assert.strictEqual(r.verification.status, 'UNVERIFIABLE');
  assert.ok(r.recommendations.every(x => x.status === 'UNVERIFIABLE' && x.autoFix === false));
  assert.deepStrictEqual([r.summary.proposed, r.summary.verified, r.autoFixed], [2, 0, 0]);
});

test('[ARE-10b] VERIFIED مع صياغة غير مفحوصة (HTML) يُظهر syntaxVerified=false، والمفحوصة true', () => {
  const gate = status => ({ verifyFix: () => ({ accepted: true, reason: 'ACCEPTED', syntaxStatus: status }) });
  const base = () => engine({ repaired: FIXED, repairs: repairsOf(0.9), aiNeeded: [] });
  const unv = run(Object.assign(base(), { FixVerifier: gate('unverified_language') }), CODE, analysis());
  assert.strictEqual(unv.recommendations[0].status, 'VERIFIED');
  assert.strictEqual(unv.recommendations[0].syntaxVerified, false);
  assert.strictEqual(unv.verification.syntaxVerified, false);
  const ok = run(Object.assign(base(), { FixVerifier: gate('verified') }), CODE, analysis());
  assert.strictEqual(ok.recommendations[0].syntaxVerified, true);
});

test('[ARE-11] التكرار: البلاغ الشقيق يبقى في unresolved مع possiblyCoveredBy بدليل، لا يُحذف ولا يُحكم به', () => {
  const issues = [
    { line: 2, title: 'استخدم ===',          sev: 'm', ev: 'if (a == 2) {}' },   // أصلحه المحرك
    { line: 2, title: 'مقارنة غير دقيقة',    sev: 'm', ev: 'if (a == 2) {}' },   // شقيق: نفس السطر ونفس الدليل
    { line: 2, title: 'عيب آخر على السطر',   sev: 'm', ev: 'a == 2' },            // دليل مختلف ⇒ لا ربط
    { line: 3, title: 'بلا دليل',            sev: 'l' },                          // بلا ev ⇒ لا ربط
    { line: 9, title: 'مختلف السطر',         sev: 'l', ev: 'if (a == 2) {}' },   // سطر مختلف ⇒ لا ربط
  ];
  const g = Object.assign(engine({ repaired: FIXED, aiNeeded: [],
    repairs: [{ line: 2, title: 'استخدم ===', before: 'if (a == 2) {}', after: 'x', strategy: 'LOOSE_EQUALITY', confidence: 0.9 }] }),
    { FixVerifier: accepting() });
  const r = run(g, CODE, analysis({ rawIssues: issues, total: 5 }));
  assert.strictEqual(r.unresolved.length, 4, 'لا إزالة تلقائية: كل البلاغات غير المُطابَقة تبقى');
  const byTitle = Object.fromEntries(r.unresolved.map(u => [u.title, u]));
  assert.strictEqual(byTitle['مقارنة غير دقيقة'].relation, 'SAME_LINE_SAME_EVIDENCE');
  assert.deepStrictEqual(byTitle['مقارنة غير دقيقة'].possiblyCoveredBy,
    { line: 2, title: 'استخدم ===', strategy: 'LOOSE_EQUALITY', kind: 'repair' });
  for (const t of ['عيب آخر على السطر', 'بلا دليل', 'مختلف السطر']) {
    assert.strictEqual(byTitle[t].possiblyCoveredBy, undefined, t + ' رُبط بلا دليل');
  }
  assert.strictEqual(r.summary.unresolvedLinked, 1);
  assert.strictEqual(r.summary.unresolved, 4);
});

test('[ARE-12] rejected غير مصفوفة أو فيها null ⇒ malformed + MALFORMED_RESULT، ويُرجَع مصفوفة', () => {
  const a = run(engine({ repaired: CODE, repairs: [], aiNeeded: [], rejected: 'x' }), CODE, analysis());
  assert.ok(a.malformed.includes('rejected'));
  assert.strictEqual(a.engineStatus, 'MALFORMED_RESULT');
  assert.deepStrictEqual(a.rejected, []);
  const b = run(engine({ repaired: CODE, repairs: [], aiNeeded: [], rejected: [null, { line: 1, reason: 'r' }] }), CODE, analysis());
  assert.ok(b.malformed.includes('rejected[]'));
  assert.strictEqual(b.rejected.length, 1);
});

test('[ARE-13] FixVerifier موجود وanalyzeCode غائب ⇒ UNAVAILABLE والبوابة لا تُنادى', () => {
  const calls = [];
  const g = { repairCode: () => ({ repaired: FIXED, repairs: repairsOf(0.9), aiNeeded: [] }), FixVerifier: accepting(calls) };
  const r = run(g, CODE, analysis());
  assert.strictEqual(r.verification.status, 'UNAVAILABLE');
  assert.strictEqual(r.recommendations[0].status, 'UNVERIFIED');
  assert.strictEqual(calls.length, 0);
});

test('[ARE-16] repaired تغيّر بلا إصلاحات مسجَّلة وFixVerifier غائب ⇒ unlistedChange + UNAVAILABLE، بلا عدّ ولا قبول', () => {
  const g = engine({ repaired: CODE + '// injected\n', repairs: [], aiNeeded: [] });   // لا FixVerifier
  const r = run(g, CODE, analysis());
  assert.strictEqual(r.unlistedChange, true);
  assert.strictEqual(r.verification.status, 'UNAVAILABLE');
  assert.deepStrictEqual([r.autoFixed, r.summary.proposed, r.summary.verified, r.summary.applied], [0, 0, 0, 0]);
  assert.strictEqual(r.repaired, CODE + '// injected\n', 'المرشَّح يُرجَع كما هو (توافق)، لكن غير مُتحقَّق منه ومُعلَّم');
  assert.strictEqual(r.engineStatus, 'RETURNED');
  // وFixVerifier بلا verifyFix (غير دالة) كالغائب
  const bad = run(Object.assign({}, g, { FixVerifier: {} }), CODE, analysis());
  assert.strictEqual(bad.verification.status, 'UNAVAILABLE');
});

test('[ARE-17] rawIssues بعناصر غير صالحة: لا سقوط صامت، العناصر تُسجَّل في malformed والصالحة تُعالَج', () => {
  const valid = { line: 1, title: 'var', sev: 'l' };
  const g = Object.assign(engine({ repaired: FIXED, aiNeeded: [],
    repairs: [{ line: 1, title: 'var', before: 'b', after: 'a', confidence: 0.9 }] }), { FixVerifier: accepting() });
  const r = run(g, CODE, analysis({ rawIssues: [5, 'x', true, valid, { line: 4, title: 'left-over', sev: 'm' }], total: 2 }));
  assert.ok(r.malformed.includes('rawIssues[]'), 'العناصر غير الصالحة سقطت بلا أثر');
  assert.deepStrictEqual(r.unresolved.map(u => u.title), ['left-over']);
  assert.strictEqual(r.recommendations.length, 1);
  assert.strictEqual(r.recommendations[0].autoFix, true);
  // بلاغ بلا حقول ({}) يبقى unresolved بسببه لا يختفي
  const empty = run(g, CODE, analysis({ rawIssues: [{}], total: 1 }));
  assert.strictEqual(empty.unresolved.length, 1);
  assert.strictEqual(empty.malformed.includes('rawIssues[]'), false, '{} كائن: ليس عنصرًا غير صالح');
  // قائمة نظيفة ⇒ لا وسم
  assert.strictEqual(run(g, CODE, analysis()).malformed.includes('rawIssues[]'), false);
});

test('[ARE-18] rejected بقيم غير صالحة: لا استثناء، الكائنات تُمرَّر، والأسباب غير النصية لا تُسقط البلاغ', () => {
  const issues = [{ line: 2, title: 'A', sev: 'm' }];
  const g = Object.assign(engine({ repaired: CODE, repairs: [], aiNeeded: [], rejected: [
    { line: 2, strategy: 'S1', reason: 42 },            // سبب رقمي
    { line: 2, strategy: undefined },                    // بلا سبب ولا استراتيجية
    { reason: 'no-line' },                               // بلا سطر ⇒ لا يُربط ببلاغ
    { line: '2', reason: 'string-line' },                // سطر نصّي ≠ رقمي ⇒ لا يُربط (لا تخمين)
    'junk', null, 7,                                     // ليست كائنات ⇒ malformed
  ] }), { FixVerifier: accepting() });
  const r = run(g, CODE, analysis({ rawIssues: issues, total: 1 }));
  assert.ok(r.malformed.includes('rejected[]'));
  assert.strictEqual(r.rejected.length, 4, 'الكائنات الأربعة تُمرَّر كما هي');
  assert.strictEqual(r.unresolved.length, 1, 'البلاغ لا يسقط');
  assert.strictEqual(r.unresolved[0].attribution, 'SAME_LINE_ONLY');
  assert.match(r.unresolved[0].reason, /rejected strategy: S1,unknown\) — 42 · REJECTED$/);
  assert.doesNotMatch(r.unresolved[0].reason, /no-line|string-line/, 'لا يُربط ما سطره غائب أو من نوع آخر');
});

test('[ARE-14] بلا تطبيع JSON: لا undefined/NaN تتسرّب في الأرقام الحرجة', () => {
  const g = Object.assign(engine({ repaired: FIXED, aiNeeded: [], reAnalysis: { issuesAfter: NaN, riskAfter: Infinity },
    repairs: [{ line: 1, title: 'var', confidence: NaN }, { line: 2, title: 'eq', confidence: undefined }, { line: 3, title: 'z', confidence: 0 }] }),
    { FixVerifier: accepting() });
  const r = runRaw(g, CODE, analysis());
  assert.strictEqual(r.summary.riskAfter, null);
  assert.strictEqual(r.summary.remaining, null);
  assert.strictEqual(r.recommendations[0].confidence, null, 'NaN تُعقَّم إلى null');
  assert.strictEqual(r.recommendations[1].confidence, null, 'undefined ⇒ null لا undefined');
  assert.strictEqual(r.recommendations[2].confidence, 0);
  for (const k of ['proposed', 'verified', 'applied', 'autoFixed', 'needsAI', 'unresolved', 'unresolvedLinked']) {
    assert.ok(Number.isInteger(r.summary[k]), k + ' ليس عددًا صحيحًا: ' + r.summary[k]);
  }
});

test('[ARE-15] verifyFix يُرجع null أو accepted غير true صريحة ⇒ لا قبول', () => {
  const base = () => engine({ repaired: FIXED, repairs: repairsOf(0.9), aiNeeded: [] });
  for (const out of [null, undefined, {}, { accepted: 'yes' }, { accepted: 1 }]) {
    const r = run(Object.assign(base(), { FixVerifier: { verifyFix: () => out } }), CODE, analysis());
    assert.strictEqual(r.recommendations[0].autoFix, false, JSON.stringify(out));
    assert.strictEqual(r.autoFixed, 0);
  }
});

// ─── 7. المحرك الحقيقي من البداية للنهاية ───────────────────────────────
function realContext(skip) {
  const ESD = require(path.join(PUBLIC_DIR, 'engine_self_diagnosis.js'));
  const store = new Map();
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {}, info() {} },
    window: {}, global: {}, F: {}, R: {},
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)),
                    removeItem: k => store.delete(k), clear: () => store.clear() },
  });
  for (const m of ESD.MODULES) {
    if (skip && skip.includes(m)) continue;
    vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, m), 'utf8'), ctx, { filename: m });
  }
  vm.runInContext(SRC, ctx, { filename: 'advanced_repair_engine.js' });
  return ctx;
}
function realRun(ctx, code, fileName) {
  ctx.__code = code; ctx.__fn = fileName;
  return JSON.parse(vm.runInContext(
    '(function(){ var an = performDeepAnalysis(__code, { fileName: __fn });' +
    ' return JSON.stringify(executeSmartRepairs(__code, an, __fn)); })()', ctx));
}

test('[ARE-7] المحرك الحقيقي: إصلاحات تجتاز البوابة فعلًا، applied=0، ولا riskAfter مختلَق', () => {
  const r = realRun(realContext(), 'var a = 1;\nif (a == 2) { console.log(a); }\n', 'x.js');
  assert.strictEqual(r.engineStatus, 'RETURNED');
  assert.strictEqual(r.verification.status, 'ACCEPTED', JSON.stringify(r.verification));
  assert.ok(r.summary.proposed >= 1 && r.summary.verified === r.summary.proposed);
  assert.ok(r.recommendations.filter(x => x.status === 'VERIFIED').every(x => x.autoFix === true));
  assert.strictEqual(r.summary.applied, 0);
  assert.notStrictEqual(r.repaired, 'var a = 1;\nif (a == 2) { console.log(a); }\n');
  assert.strictEqual(r.summary.riskAfter, null);
  assert.strictEqual(r.summary.riskAfterStatus, 'UNAVAILABLE');
  assert.ok(r.recommendations.every(x => x.confidence === null || typeof x.confidence === 'number'));
});

test('[ARE-7b] المحرك الحقيقي: حزمة مُصغَّرة يرفضها Ghost ⇒ لا إصلاح، والرفض محفوظ بسببه', () => {
  const vendor = fs.readFileSync(path.join(PUBLIC_DIR, 'jszip.min.js'), 'utf8');
  const r = realRun(realContext(), vendor, 'jszip.min.js');
  assert.strictEqual(r.autoFixed, 0);
  assert.strictEqual(r.summary.verified, 0);
  assert.strictEqual(r.repaired, vendor, 'الكود لم يتغيّر');
  assert.ok(r.rejected.some(x => /GHOST_DISCARDED_BATCH/.test(x.reason)), 'سبب الرفض يبقى في النتيجة');
  assert.ok(r.unresolved.some(u => u.source === 'REJECTED_SAME_LINE' && /GHOST_DISCARDED_BATCH/.test(u.reason)));
  assert.strictEqual(r.unresolved.length, r.summary.totalIssues, 'لا بلاغ يسقط بصمت');
});

test('[ARE-7c] المحرك الحقيقي مع Ghost: ملف .ts تُرفض دفعته في repairCode نفسه ⇒ لا repairs، والرفض بسببه في rejected/unresolved', () => {
  const src = 'var a = 1;\nif (a == 2) { console.log(a); }\n';
  const ts = realRun(realContext(), src, 'x.ts');
  assert.strictEqual(ts.summary.proposed, 0, 'Ghost يستعمل البوابة نفسها فيُسقط الدفعة قبل أن تصل هذه الطبقة');
  assert.strictEqual(ts.autoFixed, 0);
  assert.ok(ts.rejected.length >= 1);
  assert.ok(ts.rejected.every(x => /REJECTED_NO_SYNTAX_CHECKER \[typescript\]/.test(x.reason)), JSON.stringify(ts.rejected));
  assert.ok(ts.unresolved.length >= 1 && ts.unresolved.every(u => u.title !== undefined));
  assert.ok(ts.unresolved.some(u => u.source === 'REJECTED_SAME_LINE' && /^UNCONFIRMED/.test(u.reason)));
});

test('[ARE-7d] المحرك الحقيقي بلا Ghost: نفس الكود في .ts ⇒ UNVERIFIABLE (لا فاحص تركيبي)، وفي .js ⇒ VERIFIED', () => {
  const src = 'var a = 1;\nif (a == 2) { console.log(a); }\n';
  const ctx = realContext(['ghost_mode.js']);
  const js = realRun(ctx, src, 'x.js');
  const ts = realRun(ctx, src, 'x.ts');
  assert.strictEqual(js.verification.status, 'ACCEPTED');
  assert.ok(js.recommendations.some(x => x.status === 'VERIFIED'));

  assert.ok(ts.summary.proposed >= 1, 'repairCode يقترح إصلاحات لملف ts حين لا Ghost');
  assert.strictEqual(ts.verification.status, 'UNVERIFIABLE', JSON.stringify(ts.verification));
  assert.match(ts.verification.reason, /^REJECTED_NO_SYNTAX_CHECKER/);
  const repairRecs = ts.recommendations.filter(x => x.strategy);
  assert.ok(repairRecs.length >= 1);
  assert.ok(repairRecs.every(x => x.status === 'UNVERIFIABLE' && x.autoFix === false),
    'عجزٌ عن التحقق لا حكمٌ بعيب: ليست GATE_REJECTED');
  assert.ok(!ts.recommendations.some(x => x.status === 'GATE_REJECTED'));
  assert.deepStrictEqual([ts.summary.verified, ts.autoFixed], [0, 0]);
});

test('[ARE-7e] المحرك الحقيقي: null في rawIssues يرمي داخل repairCode ⇒ ENGINE_ERROR كما هو (سلوك الاستثناء لم يتغيّر)، والبلاغات باقية', () => {
  const ctx = realContext();
  ctx.__code = 'var a = 1;\n';
  const r = JSON.parse(vm.runInContext(
    '(function(){ var good = { line: 1, title: "var", ev: "var a = 1;", sev: "l" };' +
    ' return JSON.stringify(executeSmartRepairs(__code, { total: 2, riskScore: 1, rawIssues: [null, good] }, "x.js")); })()', ctx));
  assert.strictEqual(r.engineStatus, 'ENGINE_ERROR');
  assert.ok(r.error && r.error.message);
  assert.ok(r.malformed.includes('rawIssues[]'));
  assert.strictEqual(r.repaired, 'var a = 1;\n');
  assert.deepStrictEqual(r.unresolved.map(u => u.title), ['var']);
  assert.match(r.unresolved[0].reason, /^ENGINE_ERROR — /);
  assert.strictEqual(r.autoFixed, 0);
});
