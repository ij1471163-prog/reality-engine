// ═══════════════════════════════════════════════════════
// أرقامُ التقرير: لكلِّ رقمٍ معنًى واحدٌ ولا يُقرأ غيرَه
// تشغيل:  node --test vercel-api/test/pipeline_counts_separated.test.js
//
// كان المستخدمُ يقرأ رقمًا واحدًا: «✅ تم إصلاح N مشكلة»، وفيه خلطان:
//   • ‎totalFixed‎ عددُ **البلاغاتِ التي زالت** لا المشكلاتِ المُصلَحة.
//     إصلاحٌ واحدٌ في الكود قد يُزيل عدّةَ بلاغاتٍ متداخلة — مقيسٌ على
//     ملفٍ واقعيّ: سبعةُ إصلاحاتٍ أزالت أربعةَ عشرَ بلاغًا.
//   • و‎accepted‎ عددُ **الرقعِ المقبولة**، وهي تمريراتُ محرّكاتٍ لا
//     مشكلات. فمن رأى «أُصلحت حالتان» كان يقرأ طولَ ‎accepted‎ بينما
//     زال من الملفِ ستّةَ عشرَ بلاغًا.
//
// و‎[COUNTS]‎ يفصلها. وليس فيها رقمٌ اسمُه «ثبت نجاحُه وظيفيًّا»، لأنّ
// البوابةَ لا تشغّل البرنامج: أقصى ما تُثبته سلامةُ النحوِ وأنّ إشارةً
// أمنيّةً لم تختفِ بلا دليلِ علاج. وادّعاءُ أكثرَ من ذلك رقمٌ كاذب.
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
  const seen = [];
  vm.runInContext('__toasts = [];', ctx);
  for (const n of ['refreshStats', 'renderResults', 'updateUI', 'renderFiles',
                   'saveState', 'renderPending', 'showDiff']) {
    if (typeof ctx[n] !== 'function') vm.runInContext(n + ' = function(){};', ctx);
  }
  vm.runInContext('toast = function(m){ __toasts.push(String(m)); };', ctx);
  ctx.__seen = seen;
  return ctx;
}
function runPipe(ctx, files) {
  vm.runInContext('F = ' + JSON.stringify(files) + ';', ctx);
  vm.runInContext('R = {}; Object.keys(F).forEach(function(k){ R[k] = { code: F[k], issues: analyzeCode(F[k], k) }; });', ctx);
  const report = JSON.parse(vm.runInContext('JSON.stringify(fixAllEnginePipeline())', ctx));
  const toasts = JSON.parse(vm.runInContext('JSON.stringify(__toasts)', ctx));
  const out = JSON.parse(vm.runInContext('JSON.stringify(F)', ctx));
  return { report, toasts, out };
}

// ملفٌّ واقعيٌّ فيه عدّةُ مشكلاتٍ مستقلّة
const MANY = [
  'const crypto = require("crypto");',
  'const cp = require("child_process");',
  'const API_KEY = "ZZfakeApiKeyValue456";',
  '',
  'function run(dir) {',
  '  return cp.exec("ls " + dir);',
  '}',
  '',
  'function find(db, name) {',
  '  return db.query("SELECT * FROM u WHERE n = \'" + name + "\'");',
  '}',
  '',
  'function get(url) {',
  '  return fetch("http://api.example.com/" + url);',
  '}',
  '',
  'module.exports = { run, find, get };',
  '',
].join('\n');

test('[CT-1] التقريرُ يحمل الأرقامَ مفصولةً بأسمائها', () => {
  const ctx = loadCtx();
  const { report } = runPipe(ctx, { 'app.js': MANY });
  assert.ok(report.counts, 'لا حقلَ counts');
  for (const k of ['enginePasses', 'patchesAccepted', 'patchesRejected',
                   'issuesRemoved', 'syntaxVerified', 'refusalsHonored', 'needsHuman']) {
    assert.strictEqual(typeof report.counts[k], 'number', 'الرقمُ مفقود: ' + k);
    assert.ok(report.counts[k] >= 0, k + ' سالب');
  }
});

test('[CT-2] وكلُّ رقمٍ يطابق مصدرَه في التقرير', () => {
  const ctx = loadCtx();
  const { report } = runPipe(ctx, { 'app.js': MANY });
  const c = report.counts;
  assert.strictEqual(c.patchesAccepted, report.accepted.length);
  assert.strictEqual(c.patchesRejected, report.rejected.length);
  assert.strictEqual(c.issuesRemoved, report.totalFixed);
  assert.strictEqual(c.needsHuman, report.aiNeeded.length);
  assert.strictEqual(c.refusalsHonored, (report.refusals || []).length);
  assert.strictEqual(c.syntaxVerified,
    report.accepted.filter(a => a.syntaxStatus === 'verified').length);
  assert.ok(c.enginePasses >= c.patchesAccepted,
    'تمريراتٌ أقلُّ من المقبول: ' + c.enginePasses + ' < ' + c.patchesAccepted);
});

test('[CT-3] والبلاغاتُ الزائلةُ ليست عددَ الرقع — الخلطُ الأصليّ', () => {
  const ctx = loadCtx();
  const { report } = runPipe(ctx, { 'app.js': MANY });
  const c = report.counts;
  assert.ok(c.issuesRemoved > 0, 'tripwire: لم يُصلَح شيء');
  assert.ok(c.issuesRemoved > c.patchesAccepted,
    'العيّنةُ لا تُظهر الفرق: بلاغاتٌ زالت ' + c.issuesRemoved +
    ' مقابل رقعٍ ' + c.patchesAccepted);
});

test('[CT-4] ورسالةُ المستخدمِ تقول ما يعنيه الرقمُ فعلًا', () => {
  const ctx = loadCtx();
  const { toasts, report } = runPipe(ctx, { 'app.js': MANY });
  const m = toasts.filter(t => /زال|إصلاح/.test(t)).pop() || '';
  assert.ok(m, 'لا رسالة: ' + JSON.stringify(toasts));
  assert.doesNotMatch(m, /تم إصلاح \d+ مشكلة/,
    'ما زالت تُسمّي البلاغاتِ الزائلةَ «مشكلاتٍ مُصلَحة»: ' + m);
  assert.match(m, new RegExp('زال ' + report.counts.issuesRemoved + ' بلاغًا'), m);
  assert.match(m, new RegExp(report.counts.patchesAccepted + ' رقعة'), m);
});

test('[CT-5] والرفضُ الأمنيُّ المحفوظُ له رقمُه، ويظهر للمستخدم', () => {
  const MD5 = 'const crypto = require("crypto");\n' +
              'function hash(x) {\n  return crypto.createHash("md5").update(x).digest("hex");\n}\n' +
              'function get(url) {\n  return fetch("http://a.example.com/" + url);\n}\n' +
              'module.exports = { hash, get };\n';
  const ctx = loadCtx();
  const { report, toasts, out } = runPipe(ctx, { 'app.js': MD5 });
  assert.ok(report.counts.refusalsHonored >= 1,
    'الرفضُ الأمنيُّ لا رقمَ له: ' + JSON.stringify(report.refusals));
  assert.match(toasts.join(' '), /رفضٌ أمنيٌّ محفوظ/, toasts.join(' '));
  assert.match(out['app.js'], /createHash\("md5"\)/, 'تُجووِز الرفض');
});

test('[CT-6] ولا رقمَ يدّعي إثباتًا وظيفيًّا لا تملكه البوابة', () => {
  const ctx = loadCtx();
  const { report } = runPipe(ctx, { 'app.js': MANY });
  for (const k of Object.keys(report.counts)) {
    assert.doesNotMatch(k, /functional|behaviou?r|proven|tested/i,
      'رقمٌ يدّعي إثباتًا وظيفيًّا بلا تشغيلِ البرنامج: ' + k);
  }
  // وما يُثبَت فعلًا محدودٌ ومُسمًّى: سلامةُ النحو
  assert.ok(report.counts.syntaxVerified <= report.counts.patchesAccepted,
    'مُثبَتُ النحوِ أكثرُ من المقبول');
});

test('[CT-7] ولم تتغيّر الحقولُ القديمة — لا كسرَ لمن يقرؤها', () => {
  const ctx = loadCtx();
  const { report } = runPipe(ctx, { 'app.js': MANY });
  for (const k of ['totalFixed', 'accepted', 'rejected', 'deferred',
                   'warnings', 'aiNeeded', 'learnedOutcomes']) {
    assert.ok(k in report, 'حقلٌ قديمٌ اختفى: ' + k);
  }
  assert.strictEqual(typeof report.totalFixed, 'number');
  const sum = report.accepted.reduce((s, a) => s + (a.removedIssues || 0), 0);
  assert.strictEqual(report.totalFixed, sum, 'totalFixed لم يعد مجموعَ ما أزالته البوابة');
});
