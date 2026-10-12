// ═══════════════════════════════════════════════════════
// [ENGINE-FAIL] عطبُ محرّكٍ لا يُقرأ «لا مشكلاتَ في الملف»
// ═══════════════════════════════════════════════════════
//
// ‎runEngine(name, fn, stage)‎ يعزل كلَّ كاشفٍ كي لا يُسقط عطبُه الملفَ
// كلَّه — وهذا صحيحٌ ويبقى. لكنّه كان يُرجع ‎[]‎ ويكتفي بـ‎console.warn‎،
// و‎[]‎ لا يُميَّز عن «فحصتُ فلم أجد». فمحرّكٌ ميّتٌ يبدو ملفًا سليمًا.
//
// والعطبُ ليس فرضيًّا: ‎analyzeProject‎ يرمي في **كلِّ** نداء (24 من 24
// مقيسًا) لتصادمِ ‎extractFunctions‎ بين ‎project_intelligence.js‎ و
// ‎test_generator.js‎ — ولم يَظهر ذلك في أيِّ مخرَجٍ ولا اختبارٍ ولا واجهة.
//
// فالسجلُّ يجعل العطبَ مقروءًا (محرّكٌ ومرحلةٌ وسببٌ وملفّ) بلا أن يتغيّر
// السلوك: نفسُ ‎[]‎، ونفسُ استمرارِ بقيةِ المحرّكات، ولا بلاغَ يُضاف إلى
// النتيجة (بلاغٌ يظهر في ‎after‎ وحدَه يرفع العدَّ فترفض البوابةُ إصلاحًا
// صحيحًا — ولذلك القناةُ خارجَ النتيجة).
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
  const warns = [];
  const ctx = {
    console: { log: noop, warn: (...a) => warns.push(a.join(' ')), error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop,
                createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null),
                    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  ctx.__warns = warns;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const f = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(f)) continue;
    try { vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة */ }
  }
  return ctx;
}

// شفرةٌ تحمل مشكلاتٍ من محرّكاتٍ عدّة، فلا يعتمد الاختبارُ على محرّكٍ واحد
const CODE = 'const cp = require("child_process");\n' +
             'function run(req, password) {\n' +
             '  console.log(password);\n' +
             '  var url = "http://api.example.com/x";\n' +
             '  if (req.query.id == 1) { return cp.exec(req.query.cmd); }\n' +
             '  return fetch(url);\n' +
             '}\n' +
             'module.exports = { run };\n';

test('[EF-1] السجلُّ منشورٌ ويبدأ فارغًا على تحليلٍ سليم', () => {
  const ctx = loadCtx();
  assert.strictEqual(typeof ctx.engineFailures, 'function',
    'engineFailures غيرُ منشورة — العطبُ يبقى غيرَ مقروء');
  assert.strictEqual(typeof ctx.clearEngineFailures, 'function');
  const iss = ctx.analyzeCode(CODE, 'a.js') || [];
  assert.ok(iss.length > 0, 'tripwire: لا بلاغاتَ على شفرةٍ معيبة');
  const fails = ctx.engineFailures();
  assert.ok(Array.isArray(fails), 'engineFailures لا تُرجع مصفوفة');
  // المحرّكاتُ المعلومةُ العطبَ وحدها — ولا تنمو القائمةُ بصمت
  const names = [...new Set(fails.map(f => f.engine))].sort();
  assert.deepStrictEqual(names, ['analyzeProject'],
    'محرّكٌ جديدٌ يرمي في التحليل: ' + JSON.stringify(fails.map(f => f.engine + '@' + f.stage + ': ' + f.reason)));
});

test('[EF-2] عطبٌ مُقحَمٌ يُسجَّل باسمِ المحرّكِ ومرحلتِه وسببِه وملفِّه', () => {
  const ctx = loadCtx();
  const BOOM = 'اختبارٌ: محرّكٌ تعطّل';
  // ثلاثةُ محرّكاتٍ في ثلاثِ مراحلٍ مختلفة — ليثبت الوسمُ لا اسمٌ واحد
  const INJECT = [
    ['CVEPatterns',   'cve',      () => { ctx.CVEPatterns.analyze = () => { throw new Error(BOOM + ' cve'); }; }],
    ['ExtendedPatterns', 'extended', () => { ctx.ExtendedPatterns.analyze = () => { throw new Error(BOOM + ' ext'); }; }],
    ['SmartContext',  'context',  () => { ctx.SmartContext.analyze = () => { throw new Error(BOOM + ' ctx'); }; }],
  ];
  for (const [, , inject] of INJECT) inject();

  const iss = ctx.analyzeCode(CODE, 'broken_engines.js') || [];

  // ① بقيةُ التحليل استمرّت — العزلُ لم يُفقَد
  assert.ok(iss.length > 0,
    'تعطُّلُ ثلاثةِ محرّكاتٍ أسقط التحليلَ كلَّه — العزلُ هو الغرضُ الأوّلُ من runEngine');

  // ② وكلُّ عطبٍ مُسجَّلٌ بالاسمِ والمرحلةِ والسببِ والملفّ
  const fails = ctx.engineFailures();
  for (const [name, stage] of INJECT) {
    const rec = fails.find(f => f.engine === name);
    assert.ok(rec, 'عطبُ ' + name + ' لم يُسجَّل — اختفى صامتًا: ' +
      JSON.stringify(fails.map(f => f.engine)));
    assert.strictEqual(rec.stage, stage, 'مرحلةٌ خاطئةٌ لـ' + name + ': ' + rec.stage);
    assert.ok(rec.reason.includes(BOOM), 'السببُ لا يُنقَل: ' + rec.reason);
    assert.strictEqual(rec.file, 'broken_engines.js', 'الملفُّ لا يُسجَّل: ' + rec.file);
  }

  // ③ ويُكتَب تحذيرٌ مُوسَّمٌ يمكن البحثُ عنه
  const tagged = ctx.__warns.filter(w => w.includes('[ENGINE-FAIL]'));
  assert.ok(tagged.length >= INJECT.length,
    'لا تحذيرَ مُوسَّمًا لكلِّ عطب: ' + tagged.length + ' من ' + INJECT.length);
  assert.ok(tagged.some(w => w.includes('CVEPatterns') && w.includes('@cve')),
    'التحذيرُ لا يحمل الاسمَ والمرحلة: ' + tagged.join(' // ').slice(0, 160));
});

test('[EF-3] «تعطّل» لا يُقرأ «لا مشكلات» — الفرقُ مقروءٌ بلا لبس', () => {
  // محرّكٌ يُرجع ‎[]‎ شرعًا، ومحرّكٌ يرمي: النتيجةُ من المحرّكِ نفسِها
  // (‎[]‎) في الحالتين، والفرقُ كلُّه في السجلّ. وهذا هو المطلوب.
  const quiet = loadCtx();
  quiet.CVEPatterns.analyze = () => [];
  const qi = quiet.analyzeCode(CODE, 'quiet.js') || [];
  const qf = quiet.engineFailures().filter(f => f.engine === 'CVEPatterns');

  const dead = loadCtx();
  dead.CVEPatterns.analyze = () => { throw new TypeError('x.split is not a function'); };
  const di = dead.analyzeCode(CODE, 'dead.js') || [];
  const df = dead.engineFailures().filter(f => f.engine === 'CVEPatterns');

  assert.strictEqual(qf.length, 0, 'محرّكٌ صامتٌ شرعًا سُجِّل عطبًا');
  assert.strictEqual(df.length, 1, 'محرّكٌ ميّتٌ لم يُسجَّل');
  assert.strictEqual(df[0].kind, 'TypeError', 'نوعُ الخطأ لا يُسجَّل: ' + df[0].kind);
  assert.ok(df[0].reason.includes('split'), 'السببُ لا يُنقَل: ' + df[0].reason);
  // وعددُ البلاغاتِ متساوٍ: فالسجلُّ هو الفرقُ الوحيد — لا شيءَ في النتيجة
  assert.strictEqual(di.length, qi.length,
    'تعطُّلُ المحرّكِ غيَّر عددَ البلاغات — كان يجب أن يُرجع [] كما يُرجع الصامت');
});

test('[EF-4] ولا يُضاف بلاغٌ عن العطب — البوابةُ لا تُضلَّل', () => {
  // لو صار العطبُ بلاغًا، لظهر في ‎after‎ وحدَه حين يرمي المحرّكُ على
  // الشفرةِ المُصلَحة فقط، فيرتفع العدُّ وتُرفض إصلاحاتٌ صحيحة.
  const ctx = loadCtx();
  ctx.CVEPatterns.analyze = () => { throw new Error('boom'); };
  const iss = ctx.analyzeCode(CODE, 'a.js') || [];
  // ‎.filter‎ من داخلِ الـVM يُنتج مصفوفةً بنموذجٍ أوّليٍّ آخر، فالمقارنةُ
  // بالطولِ لا بـ‎deepStrictEqual‎ (وهي تفشل على مصفوفتين فارغتين من عالمين).
  const bad = Array.from(iss).filter(i => /ENGINE-FAIL|engine failed|تعطّل/i.test(
    String(i.type || '') + String(i.title || '') + String(i.ev || '')));
  assert.strictEqual(bad.length, 0, 'عطبُ المحرّكِ صار بلاغًا في النتيجة: ' +
    bad.map(i => i.title).join(' | '));
  assert.ok(ctx.engineFailures().length > 0, 'tripwire: العطبُ لم يُسجَّل أصلًا');
});

test('[EF-5] السجلُّ يخصُّ آخرَ تحليل، والقارئُ لا يُعدّله', () => {
  const ctx = loadCtx();
  ctx.CVEPatterns.analyze = () => { throw new Error('boom'); };
  ctx.analyzeCode(CODE, 'first.js');
  const first = ctx.engineFailures();
  assert.ok(first.some(f => f.engine === 'CVEPatterns' && f.file === 'first.js'));

  // تحليلٌ ثانٍ لا يُراكم سجلَّ الأوّل
  ctx.analyzeCode(CODE, 'second.js');
  const second = ctx.engineFailures();
  assert.ok(!second.some(f => f.file === 'first.js'), 'السجلُّ تراكم بين تحليلين');
  assert.strictEqual(second.filter(f => f.engine === 'CVEPatterns').length, 1,
    'سجلٌّ مُكرَّرٌ للمحرّكِ نفسِه في تحليلٍ واحد');

  // والمُعاد نسخةٌ: تعديلُها لا يمسّ السجلّ
  second[0].engine = 'MUTATED';
  second.push({ engine: 'INJECTED' });
  const third = ctx.engineFailures();
  assert.ok(!third.some(f => f.engine === 'MUTATED' || f.engine === 'INJECTED'),
    'القارئُ عدّل السجلَّ الداخلي');
});

test('[EF-6] العطبُ المعلومُ ظاهرٌ: ‎analyzeProject‎ في مرحلةِ ‎project‎', () => {
  // شرطيٌّ بالقياسِ لا بالتمنّي: التصادمُ قائمٌ في الشفرةِ ⇒ المحرّكُ يرمي
  // ⇒ يجب أن يُسجَّل. وإن أُصلح التصادمُ يومًا سقط الشرطُ وبقي الاختبارُ
  // صحيحًا — ويبقى ‎[ENG-1]‎ في ‎py_log_detection‎ حارسَ التصادمِ نفسِه.
  const files = ['project_intelligence.js', 'test_generator.js']
    .map(f => fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8'));
  const collides = files.every(s => /^function\s+extractFunctions\s*\(/m.test(s));
  if (!collides) return;   // التصادمُ أُصلح — لا شيءَ يُثبَت هنا

  const ctx = loadCtx();
  ctx.analyzeCode(CODE, 'real.js');
  const rec = ctx.engineFailures().find(f => f.engine === 'analyzeProject');
  assert.ok(rec, 'العطبُ المعلومُ ما زال غيرَ مقروء');
  assert.strictEqual(rec.stage, 'project');
  assert.ok(/is not a function/.test(rec.reason), 'سببٌ غيرُ متوقَّع: ' + rec.reason);
});

test('[EF-7] كلُّ نداءِ ‎runEngine‎ مُوسَّمٌ بمرحلة', () => {
  // وسمُ المرحلةِ بيانٌ لا يُستنتَج: نداءٌ بلا وسمٍ يُسجّل ‎analyze‎ عامًّا
  // فتضيع المرحلة. هذا الحارسُ يمنع نداءً جديدًا بلا وسم.
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'analyzer.js'), 'utf8');
  const calls = [...src.matchAll(/runEngine\('([A-Za-z]+)',/g)].map(m => m[1]);
  assert.ok(calls.length >= 22, 'tripwire: نداءاتُ runEngine لم تُقرأ (' + calls.length + ')');
  const unstaged = [];
  for (const name of calls) {
    // المرحلةُ وسيطٌ ثالثٌ نصّيٌّ بعد المُغلِّفِ السهمي
    const rx = new RegExp("runEngine\\('" + name + "',[\\s\\S]{0,160}?,\\s*'[a-z:]+'\\)");
    if (!rx.test(src)) unstaged.push(name);
  }
  assert.deepStrictEqual(unstaged, [], 'نداءاتُ runEngine بلا وسمِ مرحلة: ' + unstaged.join(', '));
});
