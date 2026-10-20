// ═══════════════════════════════════════════════════════
// رفضٌ أمنيٌّ مُبرَّر لا يتجاوزه محرّكٌ لاحق
// تشغيل:  node --test vercel-api/test/pipeline_refusal_honored.test.js
//
// ‎repairCode‎ يرفض تحويلَ ‎md5‎ إلى ‎sha256‎ بسببٍ مُسمًّى:
//     WEAK_CRYPTO_INPUT_FROM_CALLER (x)
// معناه: المُدخَلُ يأتي من المُنادي، فقد يكون كلمةَ مرور، وتبديلُ التجزئة
// ليس علاجًا لها — علاجُها ‎KDF‎. ثمّ يأتي ‎emergencyFix‎ في المسارِ نفسِه
// بعده فيطبّق التحويلَ ذاتَه، وتقبله البوابةُ لأنّ عددَ البلاغاتِ انخفض:
//     ACCEPTED (أزال 2 مشكلة، بلا تدهور)
// فالنتيجةُ أنّ الرفضَ المُبرَّرَ يُلتَفُّ عليه من بابٍ خلفيّ، ويُكتب في
// ملفِّ المستخدمِ ما رفضه المحرّكُ عن عِلم.
//
// والسببُ الجذريُّ واحدٌ وفي سطر: المسارُ يلتقط ‎result.aiNeeded‎ من
// ‎repairCode‎ ويرمي ‎result.rejected‎. فلا طبقةَ لاحقةَ تعرف أنّ تغييرًا
// في هذا الموضعِ رُفض عن سبب، والبوابةُ تحكم على المُرشَّحِ الجديدِ وحدَه.
//
// و‎[REFUSAL-LEDGER]‎ يحفظ الرفضَ **القاطع** — ما كان عن المشكلةِ نفسِها لا
// عن جودةِ المُرشَّح — فيُجمَّد سطرُه أمام المحرّكاتِ اللاحقة. ويبقى رفضُ
// جودةِ المُرشَّح مفتوحًا: محرّكٌ آخرُ قد يُنتج مُرشَّحًا صحيحًا لنفسِ السطر،
// وهذا ما يثبته ‎[RL-5]‎.
// ═══════════════════════════════════════════════════════
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadCtx() {
  const store = new Map(), noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {}, innerHTML: '' }), addEventListener: noop,
                createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
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
  // دوالُّ الواجهةِ التي يناديها المسارُ عند الانتهاء — لا أثرَ لها على القرار
  for (const n of ['toast', 'refreshStats', 'renderResults', 'updateUI', 'renderFiles',
                   'saveState', 'renderPending', 'showDiff']) {
    if (typeof ctx[n] !== 'function') vm.runInContext(n + ' = function(){};', ctx);
  }
  return ctx;
}

// ملفٌّ فيه تجزئةُ مُدخَلٍ من المُنادي (تُرفَض)، ومشكلتان آمنتان تُصلَحان
const FILE = [
  'const crypto = require("crypto");',
  '',
  'function hash(x) {',
  '  return crypto.createHash("md5").update(x).digest("hex");',
  '}',
  '',
  'function get(url) {',
  '  return fetch("http://api.example.com/" + url);',
  '}',
  '',
  'function audit(password) {',
  '  console.log("pw", password);',
  '}',
  '',
  'module.exports = { hash, get, audit };',
  '',
].join('\n');

function runPipeline(ctx, files) {
  vm.runInContext('F = ' + JSON.stringify(files) + ';', ctx);
  vm.runInContext('R = {}; Object.keys(F).forEach(function(k){ R[k] = { code: F[k], issues: analyzeCode(F[k], k) }; });', ctx);
  const report = JSON.parse(vm.runInContext('JSON.stringify(fixAllEnginePipeline())', ctx));
  const out = JSON.parse(vm.runInContext('JSON.stringify(F)', ctx));
  return { report, out };
}

test('[RL-1] tripwire: repairCode يرفض تحويلَ md5 بسببٍ مُسمًّى', () => {
  const ctx = loadCtx();
  const issues = ctx.analyzeCode(FILE, 'app.js') || [];
  const r = ctx.repairCode(FILE, issues.map(x => Object.assign({}, x)), 'app.js');
  assert.ok((r.rejected || []).some(x => /WEAK_CRYPTO_INPUT_FROM_CALLER/.test(String(x.reason))),
    'لم يعد يُرفَض — تغيّرت الحالةُ الأصليّة: ' + JSON.stringify((r.rejected || []).map(x => x.reason)));
  assert.match(r.repaired, /createHash\("md5"\)/, 'repairCode نفسُه بدّل التجزئة');
});

test('[RL-2] tripwire: emergencyFix وحدَه يطبّق التحويلَ المرفوض', () => {
  const ctx = loadCtx();
  if (typeof ctx.emergencyFix !== 'function') { assert.ok(true, 'emergencyFix غيرُ محمّل'); return; }
  const out = ctx.emergencyFix(FILE, 'app.js');
  const s = typeof out === 'string' ? out : (out && (out.fixed || out.code)) || '';
  assert.match(String(s), /createHash\("sha256"\)/,
    'المحرّكُ اللاحقُ لم يعد يطبّقه — تغيّرت الحالةُ الأصليّة');
});

test('[RL-3] والمسارُ الكامل لا يكتب التحويلَ المرفوض', () => {
  const ctx = loadCtx();
  const { out } = runPipeline(ctx, { 'app.js': FILE });
  assert.match(out['app.js'], /createHash\("md5"\)/,
    'تُجووِز الرفضُ الأمنيُّ من مسارٍ لاحق:\n' + out['app.js']);
  assert.doesNotMatch(out['app.js'], /createHash\("sha256"\)/, out['app.js']);
});

test('[RL-4] والحمايةُ لا تمنع الإصلاحاتِ الآمنةَ في الملفِّ نفسِه', () => {
  const ctx = loadCtx();
  const { out } = runPipeline(ctx, { 'app.js': FILE });
  assert.match(out['app.js'], /https:\/\/api\.example\.com/, 'ضاع إصلاحُ http:\n' + out['app.js']);
  assert.doesNotMatch(out['app.js'], /console\.log\("pw", password\)/, 'ضاع إصلاحُ تسجيلِ السرّ:\n' + out['app.js']);
  assert.notStrictEqual(ctx.FixVerifier.syntaxCheck(out['app.js'], 'app.js').ok, false, 'الناتجُ مكسور');
});

test('[RL-5] ورفضُ جودةِ المُرشَّحِ لا يُجمِّد السطر — محرّكٌ آخرُ قد يُصلحه', () => {
  // ‎SQL_*‎ أسبابُ «هذا المُرشَّحُ رديء»، لا «لا إصلاحَ هنا». فلو جُمِّدت
  // لسقط إصلاحُ SQL الصحيحُ من ‎RepairSQL‎ ومن ‎repairCode‎ نفسِه.
  const SQL = 'function find(db, name) {\n' +
              '  return db.query("SELECT * FROM u WHERE n = \'" + name + "\'");\n' +
              '}\nmodule.exports = { find };\n';
  const ctx = loadCtx();
  const { out } = runPipeline(ctx, { 'q.js': SQL });
  assert.match(out['q.js'], /\?", \[name\]/, 'جُمِّد سطرٌ رفضُه عن جودةِ مُرشَّحٍ لا عن المشكلة:\n' + out['q.js']);
});

test('[RL-6] والرفضُ المُحترَمُ يُذكَر في التقرير بسببِه الأصليّ', () => {
  const ctx = loadCtx();
  const { report } = runPipeline(ctx, { 'app.js': FILE });
  const hit = (report.rejected || []).filter(x => /WEAK_CRYPTO_INPUT_FROM_CALLER|REFUSAL/.test(String(x.reason)));
  assert.ok(hit.length >= 1,
    'الرفضُ المُحترَمُ غيرُ مذكور: ' + JSON.stringify((report.rejected || []).map(x => x.source + ':' + x.reason)));
});

test('[RL-7] ولا تراجع: الملفُّ بلا رفضٍ قاطعٍ يُصلَح كما كان', () => {
  const CLEAN = 'function get(url) {\n  return fetch("http://a.example.com/" + url);\n}\n' +
                'function f(items) {\n  var t = 0;\n  for (const i of items) {\n    t = i.n;\n  }\n  return t;\n}\n' +
                'module.exports = { get, f };\n';
  const ctx = loadCtx();
  const { out } = runPipeline(ctx, { 'c.js': CLEAN });
  assert.match(out['c.js'], /https:\/\//, 'ضاع إصلاحُ http:\n' + out['c.js']);
  assert.match(out['c.js'], /t \+= i\.n/, 'ضاع إصلاحُ التراكم:\n' + out['c.js']);
});
