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
// ── السببُ الثاني، وقد عولج ─────────────────────────────────────────
// كان ‎analyzer.js:537‎ يقول:
//     const dup = issues.some(x => Math.abs(x.line - pi.line) <= 1 && x.title === pi.title);
// فبلاغان من ‎detectPatterns‎ بالعنوانِ نفسِه على سطرَين متجاورَين يُعَدّان
// تكرارًا، ويُسقَط الثاني قبل أن يراه مسارُ الإصلاح. وصار ‎[ADJ-MERGE]‎
// مساواةً تامّةً كالدمجَين فوقَه (‎detectSecrets‎ و‎scanSecurity‎).
// والضررُ لم يكن خفاءَ بلاغٍ فحسب: إعادةُ تحليلِ المُرشَّحِ تُظهر ما كان
// محجوبًا فلا ينقص العددُ الكلّيّ، فتحكم البوابةُ ‎REJECTED_NO_IMPROVEMENT‎
// ويطرح Ghost الدفعةَ كلَّها — أربعُ catch متجاورة: أربعةٌ تُكتشَف وصفرٌ
// يُصلَح. و‎[PC-4]‎/‎[PC-5]‎ الضابط: بسطرٍ فارغٍ بينها كانت تُصلَح كلُّها،
// فالمسافةُ هي المتغيّرُ الوحيد.
//
// ولم يُمَسّ في هذا العلاج إسقاطُ التكرارِ الحقيقيّ: السطرُ نفسُه والعنوانُ
// نفسُه ما زال واحدًا — ‎[PC-11]‎ — ثم يمرّ الكلُّ على ‎dedupeIssues‎ بمفتاحِ
// ‎line + vulnClass‎. ولم تُعدَّل البوابةُ ولا المُصلِحاتُ ولا أيُّ محرّك.
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

// ═══ الدمجُ يُمرِّر المستقلَّ المتجاور، ويُسقط التكرارَ الحقيقيّ ═══

test('[PC-6] ما يراه الكاشفُ من المتجاورةِ يصل إلى مسارِ الإصلاح كاملًا', () => {
  for (const [code, n, rx] of [[CATCH2, 2, /catch/], [CATCH3, 3, /catch/],
                               [CATCH4, 4, /catch/], [NEQ3, 3, /!= بدل/]]) {
    const detected = (ctx.detectPatterns(code, 'pc6.js') || []).filter(i => rx.test(i.title));
    assert.strictEqual(detected.length, n, 'الكاشفُ نفسُه أنقص — العطبُ انتقل');
    const merged = (ctx.analyzeCode(code, 'pc6.js') || []).filter(i => rx.test(i.title));
    assert.strictEqual(merged.length, detected.length,
      'الدمجُ أسقط بلاغًا مستقلًّا لمجرّدِ المجاورة — عاد ‎analyzer.js:537‎');
    assert.deepStrictEqual(merged.map(i => i.line).sort((a, b) => a - b),
                           detected.map(i => i.line).sort((a, b) => a - b));
  }
});

test('[PC-7] المُصلِحُ قادرٌ على كلِّ سطرٍ متجاور — القدرةُ ليست ناقصة', () => {
  const lines = CATCH4.split('\n');
  for (const line of [2, 3, 4, 5]) {
    const out = ctx.fixEmptyCatch(CATCH4, { line, ev: lines[line - 1].trim() }, lines, 'js', 'pc7.js');
    assert.ok(out && out.fixed && out.fixed !== CATCH4, 'المُصلِحُ عجز عن السطر ' + line);
  }
});

// ═══ الإصلاحُ الكاملُ للحالاتِ التي كان الدمجُ يُسقط بلاغاتِها ═══

test('[PC-8] سطران متجاوران بالمشكلةِ نفسِها: يُصلَحان معًا', () => {
  const r = cycle(CATCH2, 'pc8.js');
  assert.strictEqual(occurrences(r.repaired, 'catch (e) {}'), 0);
  // كانت الدفعةُ تُطرح كلُّها، فيخرج صفرُ إصلاحاتٍ مع بلاغَين مكتشَفَين.
  assert.strictEqual(r.rejected.length, 0);
  assert.strictEqual(r.repairs.length, 2);
});

test('[PC-9] ثلاثةٌ وأربعةٌ متجاورة: تُصلَح كلُّها', () => {
  assert.strictEqual(occurrences(cycle(CATCH3, 'pc9a.js').repaired, 'catch (e) {}'), 0);
  assert.strictEqual(occurrences(cycle(CATCH4, 'pc9b.js').repaired, 'catch (e) {}'), 0);
  assert.strictEqual(occurrences(cycle(NEQ3, 'pc9c.js').repaired, ' != '), 0);
});

test('[PC-10] لا يُعلَن نجاحٌ كاملٌ وجزءٌ من المشكلةِ باقٍ في الناتج', () => {
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

// ═══ الحالتان جنبًا إلى جنب: ما يُسقَط وما يُمرَّر ═══

/** يُشغِّل analyzeCode على كاشفِ أنماطٍ محقونٍ، ثم يُعيد الأصليَّ مهما جرى. */
function withPatterns(stub, fn) {
  const real = ctx.detectPatterns;
  ctx.detectPatterns = stub;
  try { return fn(); } finally { ctx.detectPatterns = real; }
}
const SRC = 'module.exports.f = function f(a, b) {\n  a();\n  b();\n  return f;\n};\n';
const TITLE = 'بلاغُ اختبارٍ موضعيّ';
const mk = line => ({ type: 'bug', sev: 'm', title: TITLE, line, ev: 'x',
                      conf: 60, cIcon: '🟡', cAct: 'اختبار', cEv: [] });

test('[PC-11] تكرارٌ حقيقيّ — السطرُ نفسُه والعنوانُ نفسُه: واحدٌ فقط يبقى', () => {
  // يحرسه الدمجُ أوّلًا (‎x.line === pi.line && x.title === pi.title‎)، ثم
  // ‎dedupeIssues‎ ثانيةً بمفتاحِ ‎line + vulnClass‎. والمقيسُ هو السلوك.
  const out = withPatterns(() => [mk(2), mk(2), mk(2)],
                           () => ctx.analyzeCode(SRC, 'pc11.js') || []);
  assert.strictEqual(out.filter(i => i.title === TITLE).length, 1);
});

test('[PC-12] بلاغان مستقلّان على سطرَين متجاورَين: كلاهما يمرّ', () => {
  const out = withPatterns(() => [mk(2), mk(3)],
                           () => ctx.analyzeCode(SRC, 'pc12.js') || []);
  // ‎Array.from‎ لا زينة: المصفوفةُ العائدةُ من الـVM من عالَمٍ آخر، و‎deepStrictEqual‎
  // يفشل عليها وإن تطابق المحتوى.
  const got = Array.from(out.filter(i => i.title === TITLE).map(i => i.line)).sort((a, b) => a - b);
  assert.deepStrictEqual(got, [2, 3],
    'المجاورةُ وحدَها أسقطت بلاغًا مستقلًّا — عاد ‎analyzer.js:537‎');
});

test('[PC-13] لا بلاغَين متطابقَين (سطر+عنوان) في ناتجِ ملفاتٍ حقيقيّة', () => {
  const names = fs.readdirSync(PUBLIC_DIR)
    .filter(n => n.endsWith('.js') && !n.includes('.min.'))
    .sort().slice(0, 12);
  assert.ok(names.length >= 6, 'المُدوَّنةُ أصغرُ من أن تُثبِت شيئًا');
  for (const n of names) {
    const out = ctx.analyzeCode(fs.readFileSync(path.join(PUBLIC_DIR, n), 'utf8'), n) || [];
    const seen = new Set();
    for (const i of out) {
      const key = (i.line || 0) + '\u0000' + String(i.title || '');
      assert.ok(!seen.has(key), 'تكرارٌ تامٌّ في ' + n + ' عند السطر ' + i.line);
      seen.add(key);
    }
  }
});
