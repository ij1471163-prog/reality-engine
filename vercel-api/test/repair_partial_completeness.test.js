// ═══════════════════════════════════════════════════════
// اختبارات «الإصلاحِ الكاملِ مقابلَ الجزئيّ»
// تشغيل:  node --test vercel-api/test/repair_partial_completeness.test.js
//
// سؤالُ هذه المجموعة واحد: إذا تكرّرت المشكلةُ نفسُها عدّةَ مرّاتٍ في ملفٍ
// واحد، هل يُصلحها المحرّكُ كلَّها، وهل يصدُق في وصفِ ما فعل؟
//
// ── ما تُثبِّته الاختباراتُ المارّة ─────────────────────────────────────
// انحدارٌ مقيسٌ في التاريخ: من ‎3d4e55a‎ (2026-09-09، «Update ghost_mode.js»)
// إلى ‎05257b9‎ (2026-10-08) كان GhostMode يحسب ‎score‎ من بلاغاتِ c/h وحدَها،
// فدُفعةٌ مؤلَّفةٌ من إصلاحاتِ l/m فقط (‎var‎ و‎==‎ و‎!=‎) لا تبلغ 75 فتُحكَم
// ‎no_improvement‎ **وتُطرح الدفعةُ كلُّها**. وقياسُ التاريخِ يُظهر الأثرَ
// نقيًّا: ‎var×3‎ و‎eq×3‎ كانت 3/3 حتى ‎b6f1b54‎، وصارت 0/3 عند ‎3d4e55a‎،
// وعادت 3/3 يومَ حُذف ‎ghost_mode.js‎ في ‎0e450b1‎، وسقطت ثانيةً يومَ أُعيد
// في ‎71a4e81‎، حتى أصلحها ‎05257b9‎. فهذه الاختباراتُ تحرس ذلك العَود.
//
// ── ما هو ‎todo‎ ولماذا ───────────────────────────────────────────────
// يبقى سببٌ ثانٍ غيرُ معالَج، ومُثبَتٌ بالتنفيذ، موضعُه ‎analyzer.js:537‎:
//     const dup = issues.some(x => Math.abs(x.line - pi.line) <= 1 && x.title === pi.title);
// فبلاغان من ‎detectPatterns‎ بالعنوانِ نفسِه على سطرَين متجاورَين يُعَدّان
// تكرارًا، ويُسقَط الثاني قبل أن يراه مسارُ الإصلاح. ودمجُ ‎scanSecurity‎
// فوقَه مباشرةً يستعمل المساواةَ التامّة (‎x.line === si.line‎)، فالتساهلُ
// خاصٌّ بهذا الموضع. والضابطُ في ‎[PC-4]‎ و‎[PC-5]‎: المسافةُ سطرٌ واحدٌ هي
// المتغيّرُ الوحيد — إن تباعدت الأسطر أُصلحت الحالةُ كاملةً.
// لا تُعدَّل البوابةُ ولا المُصلِحاتُ لأجل هذه الاختبارات: الدواءُ في موضعِ
// الدمج، وحتى ينزل يبقى الشرطُ مكتوبًا هنا ‎todo‎ لا أخضرَ كاذبًا.
// ═══════════════════════════════════════════════════════
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadUiContext() {
  const store = new Map(), noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => null, addEventListener: noop, createElement: () => ({}),
                querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null),
                    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
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
  return ctx;
}
const ctx = loadUiContext();

/** يُجري الدورةَ كاملةً ويُرجع ما يلزم للحكم على الاكتمال. */
function cycle(code, fileName) {
  const issues = ctx.analyzeCode(code, fileName) || [];
  const r = ctx.repairCode(code, issues.map(x => Object.assign({}, x)), fileName);
  const repaired = (r && typeof r.repaired === 'string') ? r.repaired : code;
  return {
    repaired,
    summary: (r && r.summary) || { total: 0, fixed: 0, score: 0 },
    repairs: (r && r.repairs) || [],
    rejected: (r && r.rejected) || [],
    detected: (ctx.detectPatterns ? (ctx.detectPatterns(code, fileName) || []) : []),
  };
}
const occurrences = (s, needle) => s.split(needle).length - 1;

// ───────────────────────────────────────────────────────
// الحالات: نصٌّ، وما يجب ألّا يبقى منه شيءٌ في الناتج، وكم كان فيه.
// ───────────────────────────────────────────────────────
const VAR3 = 'module.exports.f = function f() {\n  var a = 1;\n  var b = 2;\n  var c = 3;\n  return a + b + c;\n};\n';
const EQ3  = 'module.exports.f = function f(a, b, c) {\n  if (a == 1) return 1;\n  if (b == 2) return 2;\n  if (c == 3) return 3;\n  return 0;\n};\n';
const HTTP3 = 'module.exports.u = ["http://a.example.com/", "http://b.example.com/", "http://c.example.com/"];\n';

const CATCH_SPACED = 'module.exports.f = function f(a, b, c) {\n  try { a(); } catch (e) {}\n\n  try { b(); } catch (e) {}\n\n  try { c(); } catch (e) {}\n  return f;\n};\n';
const NEQ_SPACED   = 'module.exports.f = function f(a, b, c) {\n  if (a != 1) return 1;\n\n  if (b != 2) return 2;\n\n  if (c != 3) return 3;\n  return 0;\n};\n';

const CATCH2 = 'module.exports.f = function f(a, b) {\n  try { a(); } catch (e) {}\n  try { b(); } catch (e) {}\n  return f;\n};\n';
const CATCH3 = 'module.exports.f = function f(a, b, c) {\n  try { a(); } catch (e) {}\n  try { b(); } catch (e) {}\n  try { c(); } catch (e) {}\n  return f;\n};\n';
const CATCH4 = 'module.exports.f = function f(a, b, c, d) {\n  try { a(); } catch (e) {}\n  try { b(); } catch (e) {}\n  try { c(); } catch (e) {}\n  try { d(); } catch (e) {}\n  return f;\n};\n';
const NEQ3   = 'module.exports.f = function f(a, b, c) {\n  if (a != 1) return 1;\n  if (b != 2) return 2;\n  if (c != 3) return 3;\n  return 0;\n};\n';

// ═══ ما كان يُصلَح كاملًا، ويجب أن يبقى كذلك (حراسةُ انحدارِ Ghost) ═══

test('[PC-1] ثلاثةُ var متجاورة: تُصلَح كلُّها — دفعةُ l/m لا تُطرح', () => {
  const r = cycle(VAR3, 'pc1.js');
  assert.strictEqual(occurrences(r.repaired, 'var '), 0,
    'بقي var في الناتج — دفعةٌ من إصلاحاتِ l/m طُرحت كما في نافذة 09-09 → 10-08');
  assert.strictEqual(r.repairs.length, 3);
});

test('[PC-2] ثلاثةُ == متجاورة: تُصلَح كلُّها', () => {
  const r = cycle(EQ3, 'pc2.js');
  assert.strictEqual(occurrences(r.repaired, ' == '), 0);
  assert.strictEqual(r.repairs.length, 3);
});

test('[PC-3] ثلاثةُ http:// : تُصلَح كلُّها', () => {
  const r = cycle(HTTP3, 'pc3.js');
  assert.strictEqual(occurrences(r.repaired, 'http://'), 0);
});

// ═══ الضابط: المسافةُ بين الأسطرِ هي المتغيّرُ الوحيد ═══

test('[PC-4] ثلاثةُ catch فارغة متباعدة: تُصلَح كلُّها', () => {
  const r = cycle(CATCH_SPACED, 'pc4.js');
  assert.strictEqual(occurrences(CATCH_SPACED, 'catch (e) {}'), 3);
  assert.strictEqual(r.detected.filter(i => /catch/.test(i.title)).length, 3);
  assert.strictEqual(occurrences(r.repaired, 'catch (e) {}'), 0,
    'الضابطُ سقط: المشكلةُ ليست في المسافةِ وحدَها');
});

test('[PC-5] ثلاثةُ != متباعدة: تُصلَح كلُّها', () => {
  const r = cycle(NEQ_SPACED, 'pc5.js');
  assert.strictEqual(r.detected.filter(i => /!= بدل/.test(i.title)).length, 3);
  assert.strictEqual(occurrences(r.repaired, ' != '), 0);
});

// ═══ ما يُثبِت أن الدمجَ — لا الكاشفَ ولا المُصلِح — هو المُسقِط ═══

test('[PC-6] الكاشفُ يرى المتجاورةَ كلَّها، والدمجُ يُسقط ما جاوَرَ غيرَه', () => {
  for (const [code, n, rx] of [[CATCH2, 2, /catch/], [CATCH3, 3, /catch/],
                               [CATCH4, 4, /catch/], [NEQ3, 3, /!= بدل/]]) {
    const detected = (ctx.detectPatterns(code, 'pc6.js') || []).filter(i => rx.test(i.title));
    assert.strictEqual(detected.length, n, 'الكاشفُ نفسُه أنقص — العطبُ انتقل');
    const merged = (ctx.analyzeCode(code, 'pc6.js') || []).filter(i => rx.test(i.title));
    assert.ok(merged.length < detected.length,
      'لم يعد الدمجُ يُسقط شيئًا — حُلَّت المشكلةُ فليُرفع الـtodo عن [PC-7]…[PC-10]');
  }
});

test('[PC-7] المُصلِحُ قادرٌ على كلِّ سطرٍ متجاور — القدرةُ ليست ناقصة', () => {
  const lines = CATCH4.split('\n');
  for (const line of [2, 3, 4, 5]) {
    const out = ctx.fixEmptyCatch(CATCH4, { line, ev: lines[line - 1].trim() }, lines, 'js', 'pc7.js');
    assert.ok(out && out.fixed && out.fixed !== CATCH4, 'المُصلِحُ عجز عن السطر ' + line);
  }
});

// ═══ الشرطُ غيرُ المُحقَّقِ بعد — سببُه ‎analyzer.js:537‎ ═══

const WHY = 'فجوةٌ مقيسة: ‎analyzer.js:537‎ يُسقط بلاغَ detectPatterns المجاورَ ' +
            'لبلاغٍ بالعنوانِ نفسِه (‎Math.abs(x.line - pi.line) <= 1‎). غيرُ معالَجةٍ ' +
            'في هذه الجولة: المطلوبُ تقريرُ سببٍ لا تعديلُ كود.';

test('[PC-8] سطران متجاوران بالمشكلةِ نفسِها: يُصلَحان معًا', { todo: WHY }, () => {
  assert.strictEqual(occurrences(cycle(CATCH2, 'pc8.js').repaired, 'catch (e) {}'), 0);
});

test('[PC-9] ثلاثةٌ وأربعةٌ متجاورة: تُصلَح كلُّها', { todo: WHY }, () => {
  assert.strictEqual(occurrences(cycle(CATCH3, 'pc9a.js').repaired, 'catch (e) {}'), 0);
  assert.strictEqual(occurrences(cycle(CATCH4, 'pc9b.js').repaired, 'catch (e) {}'), 0);
  assert.strictEqual(occurrences(cycle(NEQ3, 'pc9c.js').repaired, ' != '), 0);
});

test('[PC-10] لا يُعلَن نجاحٌ كاملٌ وجزءٌ من المشكلةِ باقٍ في الناتج', { todo: WHY }, () => {
  // ‎summary.total‎ يُحتسب من القائمةِ **بعد** الدمج، فما أسقطه الدمجُ لا
  // يدخل المقام. والنتيجةُ المقيسة: ‎total=2 fixed=2 score=100%‎ وفي الناتجِ
  // ‎catch (e) {}‎ واحدةٌ باقيةٌ على القرص.
  for (const [code, needle] of [['try { a(); } catch (e) {}\ntry { b(); } catch (e) {}\ntry { c(); } catch (e) {}\n', 'catch (e) {}'],
                                ['if (a != 1) { run(1); }\nif (b != 2) { run(2); }\nif (c != 3) { run(3); }\n', ' != ']]) {
    const r = cycle(code, 'pc10.js');
    if (r.summary.score === 100) {
      assert.strictEqual(occurrences(r.repaired, needle), 0,
        'أُعلن 100٪ وبقي ' + occurrences(r.repaired, needle) + ' من المشكلة');
    }
  }
});
