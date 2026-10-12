// ═══════════════════════════════════════════════════════
// [ANALYZE-MEMO] البوابةُ تُحلّل كلَّ نصٍّ مرةً، لا مرةً لكل سائل
// ═══════════════════════════════════════════════════════
//
// العيبُ المقيس، بلاغُ مستخدمٍ عن «تعليق وتأخير» في الموقع:
//
//   ‎matchingIssues(code, rx)‎ داخل ‎verifyFix‎ تنادي المحلّل من جديد لكل
//   صنفِ إثبات في ‎SIGNAL_PROOFS‎ و‎SINK_CLASSES‎، على ‎beforeCode‎ و
//   ‎afterCode‎ معًا. والنصّان لا يتغيّران داخل النداء الواحد، فنفسُ
//   التحليل يُحسَب نحو عشرين مرة ويُنتج نفس الشيء في كل مرة.
//
// قياسُ A/B على ملفٍ حقيقي (GameServer مكرّرًا، 472 سطرًا)، بين
// ‎905b380‎ (قبل سجل الإثبات) و‎571b47c‎ (بعده):
//
//     نداءات analyzeCode     7   ⇒   40        (×5.7)
//     زمنُ repairCode      519   ⇒  2174 ms    (×4.2)
//     حصّةُ المحلّل          81%  ⇒    95%
//
// وبُنصِّفَ التاريخُ فوقع الانتقال عند ‎953817f‎ بالضبط: ‎9a0255c‎ أدخل
// سجلَّ الإثبات وكان يرفض الدفعة كاملة (0 إصلاح، فلا يبلغ الحسابُ عمقَه)،
// ثم ‎953817f‎ أعاد الإصلاحات العشرة فظهرت الكلفةُ كاملة.
//
// والحفظُ لا يغيّر حكمًا: نفسُ الدالة ونفسُ النصّ ⇒ نفسُ الناتج. فهذا
// الاختبار يحرس **عددَ النداءات** لا الزمن — الزمنُ يتقلّب بالعتاد
// والحِمل، والعددُ حتمي.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadCtx() {
  const noop = () => {};
  const store = new Map();
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop,
                createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null),
                    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const f = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(f)) continue;
    try { vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة */ }
  }
  return ctx;
}

// عيّنةٌ تُطلق عدّة أصنافِ إثبات معًا — سرّ، SQL، XSS، http، تعمية
const SAMPLE = [
  'const API_SECRET = "sk_live_abc123xyz789def456ghi";',
  'function q(db, id) {',
  '  return db.query("SELECT * FROM t WHERE id=" + id);',
  '}',
  'function render(el, v) {',
  '  el.innerHTML = v;',
  '}',
  'function ping() {',
  '  return fetch("http://api.example.com/x");',
  '}',
  'module.exports = { q, render, ping };',
  '',
].join('\n');

const FIXED = SAMPLE
  .replace('"sk_live_abc123xyz789def456ghi"', 'process.env.API_SECRET')
  .replace('el.innerHTML = v;', 'el.textContent = v;')
  .replace('http://api.example.com/x', 'https://api.example.com/x');

// محلّلٌ يَعُدّ نداءاته، ويُرجِع ما يُرجعه محلّلُ الإنتاج بالضبط
function countingAnalyzer(ctx) {
  const calls = [];
  const fn = (code, fileName) => { calls.push(String(code).length); return ctx.analyzeCode(code, fileName); };
  fn.calls = calls;
  return fn;
}

test('[AM-1] tripwire: العيّنةُ تُطلق أصنافَ إثباتٍ عدّة', () => {
  const ctx = loadCtx();
  const types = ctx.analyzeCode(SAMPLE, 'x.js').map(i => String(i.type || i.cAct || ''));
  assert.ok(types.length >= 4, 'العيّنةُ لا تُنتج بلاغاتٍ كافية: ' + types.join(','));
  assert.ok(types.some(t => /798|SECRET/i.test(t)), 'لا بلاغَ سرّ: ' + types.join(','));
  assert.ok(types.some(t => /89|SQL/i.test(t)),     'لا بلاغَ SQL: ' + types.join(','));
});

test('[AM-2] verifyFix يُحلّل نصَّين اثنين مهما كثرت أصنافُ الإثبات', () => {
  const ctx = loadCtx();
  const an = countingAnalyzer(ctx);

  const v = ctx.FixVerifier.verifyFix(SAMPLE, FIXED, 'x.js', an);
  assert.ok(v && typeof v.accepted === 'boolean', 'البوابةُ لم تُصدِر حكمًا');

  // النصّانِ اثنان، فالتحليلاتُ المتمايزة اثنتان. وما زاد فهو إعادةُ حسابٍ
  // لنفس المدخل. يُترك هامشٌ صغير لمسارٍ يُركّب نصًّا ثالثًا (إنقاذُ جزء).
  const distinct = new Set(an.calls).size;
  assert.ok(an.calls.length <= distinct + 2,
    'المحلّلُ نودي ' + an.calls.length + ' مرة على ' + distinct +
    ' نصوصٍ متمايزة — الفرقُ إعادةُ حسابٍ لنفس المدخل');

  // والحدُّ المطلق: لا يقترب من عدد أصناف الإثبات
  assert.ok(an.calls.length <= 6,
    'نداءاتُ المحلّل ' + an.calls.length + ' — كانت ~20 قبل الحفظ');
});

test('[AM-3] الحفظُ لا يغيّر الحكم — نفسُ الناتج بمحلّلٍ محفوظٍ أو لا', () => {
  const ctx = loadCtx();
  const plain = (c, f) => ctx.analyzeCode(c, f);

  // محلّلٌ يُرجِع نسخةً جديدةً في كل نداء: لو كان الحكمُ يعتمد على هُويّة
  // الكائن لا على قيمته، لاختلف هنا. وهو لا يختلف.
  const fresh = (c, f) => JSON.parse(JSON.stringify(ctx.analyzeCode(c, f)));

  const a = ctx.FixVerifier.verifyFix(SAMPLE, FIXED, 'x.js', plain);
  const b = ctx.FixVerifier.verifyFix(SAMPLE, FIXED, 'x.js', fresh);
  assert.strictEqual(a.accepted, b.accepted, 'الحكمُ تغيّر بتغيّر شكل المحلّل');
  assert.strictEqual(String(a.reason), String(b.reason), 'السببُ تغيّر');
});

test('[AM-4] ولا يُسرّب بين نداءين: نصٌّ جديد يُحلَّل من جديد', () => {
  // الحفظُ محصورٌ بالنداء الواحد. فلو سُرّب بين نداءين، لقُرئ تحليلُ ملفٍ
  // على ملفٍ آخر — وهو أخطرُ بكثير من البطء الذي عالجه.
  const ctx = loadCtx();
  const an = countingAnalyzer(ctx);

  ctx.FixVerifier.verifyFix(SAMPLE, FIXED, 'x.js', an);
  const afterFirst = an.calls.length;

  const OTHER = 'const z = 1;\nmodule.exports = z;\n';
  ctx.FixVerifier.verifyFix(OTHER, OTHER.replace('1', '2'), 'y.js', an);
  assert.ok(an.calls.length > afterFirst,
    'النداءُ الثاني لم يُحلّل شيئًا — الحفظُ تسرّب بين نداءين');
});

test('[AM-5] الحارسُ قائم: ‎repairCode‎ على ملفٍ حقيقي لا يتجاوز سقفَ التحليل', () => {
  // قياسٌ من طرفٍ إلى طرف، لا على البوابة وحدها: هذا هو المسارُ الذي
  // يسلكه زرُّ «إصلاح الكل بالمحرك».
  const ctx = loadCtx();
  const real = ctx.analyzeCode;
  let n = 0;
  ctx.analyzeCode = function () { n++; return real.apply(this, arguments); };

  const iss = ctx.analyzeCode(SAMPLE, 'x.js');
  n = 0;
  const r = ctx.repairCode(SAMPLE, iss.map(x => Object.assign({}, x)), 'x.js');
  assert.ok(r && typeof r.repaired === 'string', 'لا ناتج من repairCode');
  assert.ok(n <= 12, 'نداءاتُ المحلّل في repairCode = ' + n + ' — السقفُ 12');
});
