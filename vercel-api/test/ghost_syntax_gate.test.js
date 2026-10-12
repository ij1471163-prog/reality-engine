// ═══════════════════════════════════════════════════════
// D4 — البوابة النحوية في GhostMode.verdict
// تشغيل:  node --test vercel-api/test/ghost_syntax_gate.test.js
//
// إصلاح لا يُحلَّل ليس إصلاحاً مهما تحسّنت أرقام التحليل. GhostMode هو حَكَم
// الإصلاح، وبلا فحص نحوي يمرّ كود مكسور بأعلى درجة:
//
//   before: const API_KEY = 'sk_live_abcdef1234567890';
//   after : const API_KEY = process.env.API_KEY;
//           }                      ← قوس زائد، الملف لا يُحلَّل
//   verdict: pass all_fixed        ← ويُسلَّم، ويُتعلَّم منه
//
// البوابة موجودة في ghost_mode.js (syntaxOk) لكنها تُعطَّل نفسها إذا كان
// acorn غير متاح. قائمة محركات /api/analyze تُحمِّل ghost_mode.js ولا تُحمِّل
// acorn.min.js، فالبوابة كانت خاملة على السيرفر وفعّالة في المتصفح فقط
// (index.html يُحمّل acorn أولًا). الاختبارات أدناه تقرأ قائمة المحركات من
// api/analyze.js نفسه، فلا تُقاس على نسخة قد تتباعد عن المسار الحقيقي.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR  = path.join(__dirname, '..', 'public');
const ANALYZE_API = path.join(__dirname, '..', 'api', 'analyze.js');

// ── قائمة المحركات كما هي في api/analyze.js (لا نسخة) ──
function serverEngineList() {
  const src = fs.readFileSync(ANALYZE_API, 'utf8');
  const m = src.match(/const\s+engines\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, 'api/analyze.js يجب أن يحوي `const engines = [...]`');
  return m[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')     // تعليقات كتلية داخل المصفوفة
    .replace(/\/\/[^\n]*/g, '')           // تعليقات سطرية
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

// ── سياق VM بنفس شكل سياق السيرفر ──
function loadContext(files) {
  const noop = () => {};
  const ctx = vm.createContext({
    console: { log: noop, warn: noop, error: noop, info: noop },
    window: {}, global: {}, F: {}, R: {},
  });
  for (const f of files) {
    const p = path.join(PUBLIC_DIR, f);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f }); } catch (e) {}
  }
  return ctx;
}

const ghostOf = ctx => ctx.GhostMode || (ctx.window && ctx.window.GhostMode);
const analyzerOf = ctx => ctx.analyzeCode || ctx.analyze || (ctx.window && ctx.window.analyzeCode);

// ── عينات: الأصل سليم وفيه ثغرة، والإصلاح يزيلها ──
const ORIGINAL    = `const API_KEY = 'sk_live_abcdef1234567890';\nsend(API_KEY);\n`;
const FIX_BROKEN  = `const API_KEY = process.env.API_KEY;\nsend(API_KEY);\n}\n`;   // قوس زائد
const FIX_CLEAN   = `const API_KEY = process.env.API_KEY;\nsend(API_KEY);\nlog(1);\n`;
const ORIG_BROKEN = `const API_KEY = 'sk_live_abcdef1234567890';\nsend(API_KEY);\n}\n`;

const SERVER_ENGINES = serverEngineList();
const ctxServer  = loadContext(SERVER_ENGINES);
const ctxBrowser = loadContext(['acorn.min.js', ...SERVER_ENGINES]);
const ctxNoAcorn = loadContext(SERVER_ENGINES.filter(f => f !== 'acorn.min.js'));

function verdictIn(ctx, original, fixed, fileName) {
  const G = ghostOf(ctx);
  assert.ok(G, 'GhostMode يجب أن يكون محمّلًا في السياق');
  return G.verdict(original, fixed, fileName, analyzerOf(ctx), ['HARDCODED_SECRET']);
}

// ═══ أ. مسار /api/analyze يفعّل البوابة ═══════════════════
// (هذه هي الاختبارات الحمراء قبل الإصلاح)

test('D4/server: acorn.min.js مُدرج في قائمة محركات /api/analyze', () => {
  assert.ok(SERVER_ENGINES.includes('acorn.min.js'),
    'بلا acorn في القائمة تُعطِّل syntaxOk نفسها، فتصير البوابة خاملة على السيرفر.\n' +
    '      القائمة الحالية: ' + SERVER_ENGINES.join(', '));
});

test('D4/server: acorn معرّف داخل سياق VM السيرفر', () => {
  assert.strictEqual(vm.runInContext('typeof acorn', ctxServer), 'object',
    'syntaxOk تفحص `typeof acorn === "undefined"` وترجع true (لا حكم) إن لم يكن معرّفًا');
});

test('D4/server: إصلاح لا يُحلَّل يُرفض بـsyntax_broken في سياق السيرفر', () => {
  const v = verdictIn(ctxServer, ORIGINAL, FIX_BROKEN, 'app.js');
  assert.strictEqual(v.verdict, ghostOf(ctxServer).VERDICT.FAIL,
    'كود لا يُحلَّل لا يجوز أن يُسلَّم: ' + JSON.stringify(v));
  assert.strictEqual(v.reason, 'syntax_broken', JSON.stringify(v));
});

test('D4/server: الأصل نفسه لم يُمسّ — نفس القائمة تُحمّل بلا أخطاء', () => {
  assert.ok(SERVER_ENGINES.includes('ghost_mode.js'), 'ghost_mode.js يبقى في القائمة');
  assert.ok(ghostOf(ctxServer), 'GhostMode يُحمّل في سياق السيرفر');
  assert.strictEqual(typeof analyzerOf(ctxServer), 'function', 'المحلل يُحمّل في سياق السيرفر');
});

// ═══ ب. JS / MJS / CJS: إصلاح لا يُحلَّل ⇒ FAIL ══════════

for (const ext of ['js', 'mjs', 'cjs']) {
  test(`D4: .${ext} — إصلاح لا يُحلَّل ⇒ FAIL / syntax_broken`, () => {
    const v = verdictIn(ctxBrowser, ORIGINAL, FIX_BROKEN, `app.${ext}`);
    assert.strictEqual(v.verdict, ghostOf(ctxBrowser).VERDICT.FAIL, JSON.stringify(v));
    assert.strictEqual(v.reason, 'syntax_broken', JSON.stringify(v));
  });
}

test('D4: .js — إصلاح يُحلَّل لا يُرفض نحويًا', () => {
  const v = verdictIn(ctxBrowser, ORIGINAL, FIX_CLEAN, 'app.js');
  assert.notStrictEqual(v.reason, 'syntax_broken',
    'إصلاح سليم نحويًا لا يجوز أن تمسّه هذه البوابة: ' + JSON.stringify(v));
});

// ═══ ج. TS / JSX مستثناة بالتصميم (acorn لا يدعمها) ═════

for (const ext of ['ts', 'tsx', 'jsx']) {
  test(`D4: .${ext} مستثناة — لا حكم نحوي`, () => {
    const v = verdictIn(ctxBrowser, ORIGINAL, FIX_BROKEN, `app.${ext}`);
    assert.notStrictEqual(v.reason, 'syntax_broken',
      `.${ext} خارج نطاق acorn — الحكم عليها يرفض إصلاحات صحيحة: ` + JSON.stringify(v));
  });
}

// ═══ د. غياب acorn ⇒ لا حكم نحوي ════════════════════════

test('D4: بلا acorn لا تُصدر البوابة حكمًا نحويًا', () => {
  assert.strictEqual(vm.runInContext('typeof acorn', ctxNoAcorn), 'undefined',
    'هذا السياق مبني بلا acorn عمدًا');
  const v = verdictIn(ctxNoAcorn, ORIGINAL, FIX_BROKEN, 'app.js');
  assert.notStrictEqual(v.reason, 'syntax_broken',
    'بلا فاحص لا يجوز ادّعاء حكم نحوي: ' + JSON.stringify(v));
});

// ═══ هـ. الأصل المكسور لا يُحكم عليه ════════════════════

test('D4: أصل لا يُحلَّل ⇒ لا حكم نحوي على الإصلاح', () => {
  const v = verdictIn(ctxBrowser, ORIG_BROKEN, FIX_BROKEN, 'app.js');
  assert.notStrictEqual(v.reason, 'syntax_broken',
    'أصل لا يُحلَّل (مثل JSX داخل .js) يجعل الحكم غير ذي معنى: ' + JSON.stringify(v));
});

test('D4: أصل لا يُحلَّل وإصلاح سليم ⇒ لا رفض نحوي', () => {
  const v = verdictIn(ctxBrowser, ORIG_BROKEN, FIX_CLEAN, 'app.js');
  assert.notStrictEqual(v.reason, 'syntax_broken', JSON.stringify(v));
});

// ═══ و. تكافؤ سياق السيرفر وسياق المتصفح ════════════════

test('D4: سياق السيرفر وسياق المتصفح يعطيان نفس الحكم', () => {
  for (const [label, orig, fixed, file] of [
    ['إصلاح مكسور .js',  ORIGINAL,    FIX_BROKEN, 'app.js'],
    ['إصلاح سليم .js',   ORIGINAL,    FIX_CLEAN,  'app.js'],
    ['مستثنى .ts',       ORIGINAL,    FIX_BROKEN, 'app.ts'],
    ['أصل مكسور',        ORIG_BROKEN, FIX_BROKEN, 'app.js'],
  ]) {
    const s = verdictIn(ctxServer,  orig, fixed, file);
    const b = verdictIn(ctxBrowser, orig, fixed, file);
    assert.strictEqual(s.verdict, b.verdict, `${label}: الحكم يختلف بين السياقين`);
    assert.strictEqual(s.reason, b.reason,
      `${label}: السبب يختلف — server=${s.reason} browser=${b.reason}`);
  }
});

test('D4: index.html يُحمّل acorn.min.js (مرجع سياق المتصفح)', () => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const iAcorn = html.indexOf('acorn.min.js');
  const iGhost = html.indexOf('ghost_mode.js');
  assert.ok(iAcorn >= 0, 'index.html يُحمّل acorn.min.js');
  assert.ok(iGhost >= 0, 'index.html يُحمّل ghost_mode.js');
  assert.ok(iAcorn < iGhost, 'acorn يُحمّل قبل ghost_mode حتى يكون معرّفًا عند الحكم');
});

// ═══ ز. إصلاح مرفوض نحويًا لا يدخل التعلّم/preApproved ═══
// fix_engine_pipeline.js يبني preApproved من verdict:
//   preApproved = lv.verdict !== FAIL && lv.verdict !== REGRESSION
// وفي مسار GhostMode.fix يرفض الـcandidate عند verdict==='fail'.

test('D4/التعلّم: إصلاح لا يُحلَّل ⇒ verdict=FAIL فيسقط preApproved', () => {
  const G = ghostOf(ctxServer);
  const lv = verdictIn(ctxServer, ORIGINAL, FIX_BROKEN, 'app.js');
  const preApproved = lv.verdict !== G.VERDICT.FAIL && lv.verdict !== G.VERDICT.REGRESSION;
  assert.strictEqual(preApproved, false,
    'كود لا يُحلَّل لا يجوز أن يُتعلَّم منه: ' + JSON.stringify(lv));
});

test('D4/التعلّم: GhostMode.fix لا ينشر كودًا لا يُحلَّل', () => {
  const G = ghostOf(ctxServer);
  const r = G.fix(ORIGINAL, FIX_BROKEN, 'app.js', analyzerOf(ctxServer),
                  { targetTypes: ['HARDCODED_SECRET'] });
  assert.strictEqual(r.code, ORIGINAL, 'يجب إرجاع الأصل لا الكود المكسور');
  assert.strictEqual(r.verdict, G.VERDICT.FAIL, JSON.stringify(r));
  assert.strictEqual(r.localVerdict, G.VERDICT.FAIL,
    'الحكم المحلي يجب أن يكون FAIL حتى يسجّله الـpipeline كـGHOST_FAIL: ' + JSON.stringify(r));
});
