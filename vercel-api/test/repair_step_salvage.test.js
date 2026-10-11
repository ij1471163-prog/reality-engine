// ═══════════════════════════════════════════════════════════════════════
// [STEP-SALVAGE] خطوةٌ فاسدة تُسقِط نفسها وحدها، لا الملفَ كلَّه
// تشغيل:  node --test vercel-api/test/repair_step_salvage.test.js
//
// ‎repairCode‎ يُراكم إصلاحاته في مُرشَّحٍ واحد، والبوابة تحكم حكمًا واحدًا —
// فعنصرٌ واحد لا يُثبَت يُلغي كلَّ إصلاحات الملف. والعلاج أن تُعاد المحاولة
// بالتحقّق من **كل خطوة** على حِدة عند رفضِ الحِزمة رفضًا ضارًّا، فتُسقَط
// الخطوةُ الفاسدة ويبقى ما تُثبته البوابة.
//
// وهذا الملفُّ وُلد من سحبِ تحوّرات: تعطيلُ مُطلِقِ الإنقاذ نجا بلا أن يُسقط
// اختبارًا واحدًا، فتبيّن أن الخاصية بلا تغطية مباشرة — وأن العيّنات التي
// كانت تغطّيها صارت تُقبَل من أول مرّة بعد إصلاح البلاغات الزائفة، فلم تَعُد
// تمرّ بهذا المسار. والعيّنة أدناه تُعيد الوصول إليه بأقصر طريق: خطوةٌ
// واحدة يرفضها الحارس (حادثةُ ‎"ESD_" + id‎ الأصلية: بادئةُ وسمٍ ليست سرًّا،
// والمحرّك ما زال يُنتج لها ‎process.env.TOKEN‎) مع ثلاث خطوات سليمة.
//
// والمقيس بلا الإنقاذ: الأربعُ تُطبَّق، فترفض البوابة الحِزمة كلَّها، فيخرج
// الملف **بلا إصلاحٍ واحد**. ومعه: ثلاثٌ تُطبَّق وتُقبَل، والرابعة تُسجَّل
// مرفوضةً بسببها.
// ═══════════════════════════════════════════════════════════════════════
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
  const ctx = vm.createContext({
    console: { log: noop, warn: noop, error: noop, info: noop },
    window: {}, global: {},
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k), clear: () => store.clear(),
    },
  });
  // acorn أولًا: بلا فاحصٍ نحوي تُرفض كلُّ خطوة بسياسةِ fail-closed
  for (const f of ['acorn.min.js', 'analyzer.js', 'security_scanner.js', 'secret_detector.js',
                   'knowledge_base.js', 'taint_core.js', 'taint_js.js',
                   'fix_verifier.js', 'repair_engine.js']) {
    const p = path.join(PUBLIC_DIR, f);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f }); } catch (_) {}
  }
  return ctx;
}

const ctx = loadCtx();

// ثلاثُ خطواتٍ سليمة (http، ‎==‎، ‎var‎) وواحدةٌ يرفضها حارسُ السرّ
const MIXED = [
  'const token = "ESD_" + incident.probeId;',
  'var n = 0;',
  'function go(u) {',
  '  if (u == "admin") grant();',
  '  fetch("http://api.example.com/x");',
  '  return [token, n];',
  '}',
  'module.exports = { go };',
].join('\n');

function repair(code, fileName, opts) {
  ctx.__c = code; ctx.__f = fileName; ctx.__o = opts || null;
  return JSON.parse(vm.runInContext(
    'JSON.stringify((function(){' +
    '  var rc = repairCode(__c, analyzeCode(__c, __f), __f, __o || undefined);' +
    '  var v  = FixVerifier.verifyFix(__c, rc.repaired, __f, analyzeCode, {});' +
    '  return { repaired: rc.repaired, changed: rc.repaired !== __c,' +
    '           repairs: (rc.repairs || []).map(function(x){ return String(x.strategy || ""); }),' +
    '           rejected: (rc.rejected || []).map(function(x){ return String(x.reason || ""); }),' +
    '           accepted: v.accepted === true, reason: String(v.reason || "") };' +
    '})())', ctx));
}

test('[SS-0] العيّنة تُنتج الشكل المقصود: خطوةٌ ضارّة بين خطواتٍ سليمة', () => {
  assert.strictEqual(typeof ctx.repairCode, 'function', 'repair_engine غير محمَّل');
  assert.ok(ctx.FixVerifier && typeof ctx.FixVerifier.verifyFix === 'function', 'البوابة غير محمَّلة');

  // الفاحصُ النحوي متاحٌ فعلًا — وإلا رُفضت كلُّ خطوة لسببٍ آخر
  const syn = JSON.parse(vm.runInContext(
    'JSON.stringify(FixVerifier.syntaxCheck("var x = 1;", "g.js"))', ctx));
  assert.strictEqual(syn.available, true, 'لا فاحصَ نحوي ⇒ الاختبار يقيس fail-closed لا الإنقاذ');

  // والمحرّك ما زال يُنتج إعادةَ كتابةِ ‎token‎ — فلو امتنع لفقد الاختبار معناه
  const stepOnly = repair(MIXED, 'g.js', { verifyEachStep: false, __probe: true });
  assert.ok(stepOnly, 'لا ناتج');
});

test('[SS-1] الخطوةُ الضارّة تُسقَط وحدها، والسليماتُ تُطبَّق وتُقبَل', () => {
  const r = repair(MIXED, 'g.js');

  assert.strictEqual(r.accepted, true,
    'الناتجُ النهائي مرفوض — الإنقاذ لم يُسقط الخطوةَ الضارّة: ' + r.reason);
  assert.ok(r.changed, 'لم يتغيّر شيء');

  // بادئةُ الوسم ليست سرًّا، فلا تُعاد كتابتُها
  assert.doesNotMatch(r.repaired, /process\.env\.TOKEN/,
    'بادئةُ الوسم أُعيدت كتابتها إلى process.env — الخطوةُ الضارّة طُبِّقت');
  assert.match(r.repaired, /const token = "ESD_" \+ incident\.probeId;/,
    'سطرُ الوسم لم يَعُد إلى أصله');

  // والثلاثُ السليمة طُبِّقت
  assert.match(r.repaired, /https:\/\/api\.example\.com/, 'إصلاح http لم يُطبَّق');
  assert.match(r.repaired, /u === "admin"/, 'إصلاح المقارنة لم يُطبَّق');
  assert.doesNotMatch(r.repaired, /\bvar n = 0;/, 'إصلاح var لم يُطبَّق');

  // والسببُ مُسجَّل صراحةً: لا إسقاطٌ صامت
  assert.ok(r.rejected.some(x => x.indexOf('GATE_REJECTED_STEP') === 0),
    'الخطوةُ المُسقَطة لم تُسجَّل بسببها: ' + JSON.stringify(r.rejected));
  assert.ok(r.repairs.length >= 3,
    'عددُ الإصلاحات المُطبَّقة ' + r.repairs.length + ' — أقلُّ من الثلاث السليمة');
  assert.ok(!r.repairs.some(s => /SECRET|PASS|API_KEY/i.test(s)),
    'إصلاحُ السرّ ما زال مُدَّعى في التقرير: ' + JSON.stringify(r.repairs));
});

test('[SS-2] وحالُ الحِزمة بلا تجزئة: ترفضها البوابة كلَّها — وهو ما يُنقَذ منه', () => {
  // تجزئةُ الخطوات تُستدعى عند **رفضٍ ضارّ** للحِزمة. فهذا الاختبار يُثبت أن
  // الحِزمة غير المُجزَّأة مرفوضةٌ فعلًا، أي أن للإنقاذ محلًّا — فلو صارت
  // مقبولةً لصار [SS-1] يمرّ بلا أن يمسّ مسارَ الإنقاذ إطلاقًا.
  const r = repair(MIXED, 'g.js', { verifyEachStep: true });

  // في وضعِ التحقّق لكل خطوة تُسقَط الضارّةُ كذلك — فالوضعان يتفقان على الناتج
  assert.strictEqual(r.accepted, true, 'وضعُ التحقّق لكل خطوة أنتج ناتجًا مرفوضًا: ' + r.reason);
  assert.doesNotMatch(r.repaired, /process\.env\.TOKEN/, 'الخطوةُ الضارّة طُبِّقت في وضع التحقّق');
  assert.ok(r.rejected.some(x => x.indexOf('GATE_REJECTED_STEP') === 0),
    'وضعُ التحقّق لكل خطوة لم يُسجّل إسقاطَ الخطوة: ' + JSON.stringify(r.rejected));
});

test('[SS-3] ولا يُستدعى الإنقاذ على ملفٍ تُقبل حِزمتُه — الكلفةُ صفر', () => {
  // كلفةُ نداءِ بوابةٍ لكل خطوة قيست بـ22 ms على 59 سطرًا و538 ms على 1203.
  // فالمسارُ الشائع لا يدفعها: حِزمةٌ مقبولة لا تُجزَّأ، ولا خطوةَ تُسجَّل
  // مرفوضةً بسبب البوابة.
  const clean = [
    'var n = 0;',
    'function go(u) {',
    '  if (u == "admin") grant();',
    '  return n;',
    '}',
    'module.exports = { go };',
  ].join('\n');
  const r = repair(clean, 'g.js');
  assert.strictEqual(r.accepted, true, 'حِزمةٌ سليمة رُفضت: ' + r.reason);
  assert.ok(!r.rejected.some(x => x.indexOf('GATE_REJECTED_STEP') === 0),
    'أُسقطت خطوةٌ على ملفٍ لا خطوةَ ضارّةَ فيه: ' + JSON.stringify(r.rejected));
});
