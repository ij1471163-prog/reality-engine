// ═══════════════════════════════════════════════════════
// جسمٌ فارغٌ يُملأ بتعليقٍ ليس إصلاحًا — ولا يُحتسَب إصلاحًا
// تشغيل:  node --test vercel-api/test/repair_stub_not_fix.test.js
//
// ‎EMPTY_FUNCTION‎ كان ‎autoFix: true‎، وناتجُ مُصلِحِه تعليق:
//     function handleError() {}
//   ⇒ function handleError() {
//         // TODO: implement
//      }
// والكاشفُ نفسُه يَعُدّ جسمًا تعليقُه وحدَه فارغًا — الشرطُ صريحٌ في
// ‎pattern_detector‎: ‎nextLines[0].startsWith('//') && nextLines[1] === '}'‎.
// فالبلاغُ لا يزول، والمقيسُ قبل التعديل: «دالة ناقصة» 1 قبل و1 بعد.
//
// وللتناقضِ ثمنان مقيسان:
//   • وحدَها: ‎REJECTED_NO_IMPROVEMENT‎ ثم ‎GHOST_DISCARDED_BATCH‎ ⇒ صفرُ إصلاح.
//   • مع غيرها: تركب دفعةً أنقصت العددَ بإصلاحاتٍ أخرى فتُحتسَب إصلاحًا
//     (‎fixed=3‎ بدل 2) والبلاغُ باقٍ ⇒ نجاحٌ مُعلَنٌ بلا إصلاح.
//
// و‎[STUB-NOT-FIX]‎ يُعلنها ‎autoFix: false‎ كـ‎CALLBACK_HELL‎ و‎MISSING_AUTH‎.
// ولم يُلمَس الكاشفُ ولا المُصلِحُ ولا البوابة: البوابةُ كانت مُحقّةً في
// رفضِها، والكاشفُ مُحقٌّ في أن التعليقَ ليس جسمًا.
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

function cycle(code, fn) {
  const issues = ctx.analyzeCode(code, fn) || [];
  const r = ctx.repairCode(code, issues.map(x => Object.assign({}, x)), fn);
  const repaired = (r && typeof r.repaired === 'string') ? r.repaired : code;
  return { issues, r, repaired, after: ctx.analyzeCode(repaired, fn) || [] };
}
const stubs = list => list.filter(i => /دالة ناقصة/.test(String(i.title || ''))).length;

// كودٌ واقعيّ: وحدةٌ فيها عيبان يُصلَحان فعلًا ومُعالِجٌ لم يُكتَب بعد.
const REAL = [
  '"use strict";',
  '',
  'function handleError() {}',
  '',
  'function loadConfig(raw) {',
  '  var cfg = JSON.parse(raw);',
  '  return fetch("http://config.example.com/v1", { body: cfg });',
  '}',
  '',
  'module.exports = { handleError, loadConfig };',
  '',
].join('\n');

test('[SN-1] ما لم يَزُل بلاغُه لا يُحتسَب إصلاحًا', () => {
  const { issues, r, after } = cycle(REAL, 'real.js');
  assert.strictEqual(stubs(issues), 1, 'tripwire: لا بلاغَ على الدالّةِ الفارغة');
  assert.strictEqual(stubs(after), 1, 'tripwire: البلاغُ زال — راجع المثال');
  // العدُّ هو محلُّ الحكم: بلاغٌ باقٍ لا يجوز أن يظهر في repairs.
  assert.strictEqual(r.summary.fixed, (r.repairs || []).length);
  assert.ok(!(r.repairs || []).some(x => /Added stub|Empty function/i.test(
    String(x.patch || '') + String(x.reason || ''))), 'حُشِي جسمٌ فارغٌ وعُدَّ إصلاحًا');
});

test('[SN-2] ويُعلَن أنه يحتاج AI بدل أن يُطمَس', () => {
  const { r } = cycle(REAL, 'real.js');
  assert.ok((r.aiNeeded || []).length >= 1, 'لا إعلانَ aiNeeded');
  assert.strictEqual(r.summary.needsAI, (r.aiNeeded || []).length);
});

test('[SN-3] وبقيّةُ عيوبِ الملفِ تُصلَح كاملةً — لا تُطرح معه', () => {
  const { repaired } = cycle(REAL, 'real.js');
  assert.doesNotMatch(repaired, /\bvar\s/, 'var لم يُصلَح');
  assert.doesNotMatch(repaired, /http:\/\//, 'http لم يُصلَح');
  // والدالّةُ الفارغةُ تُترك كما هي، لا تُحشى ولا تُحذف.
  assert.match(repaired, /function handleError\(\) \{\}/, 'مُسَّت الدالّةُ الفارغة');
});

test('[SN-4] ووحدَها: لا طرحَ لدفعةٍ ولا تغييرَ للكود', () => {
  const ONLY = 'function handleError() {}\nmodule.exports = { handleError };\n';
  const { r, repaired } = cycle(ONLY, 'only.js');
  assert.strictEqual(repaired, ONLY, 'تغيّر الكودُ بلا إصلاحٍ مُثبَت');
  assert.strictEqual((r.repairs || []).length, 0);
  assert.strictEqual((r.rejected || []).length, 0, 'ما زالت الدفعةُ تُطرح: ' +
    JSON.stringify((r.rejected || []).map(x => x.reason)));
  assert.ok((r.aiNeeded || []).length >= 1);
});

test('[SN-5] والكودُ الناتجُ سليمٌ نحويًّا', () => {
  const { repaired } = cycle(REAL, 'real.js');
  const v = ctx.FixVerifier.syntaxCheck(repaired, 'real.js');
  assert.strictEqual(v.ok, true, 'الناتجُ مكسور: ' + v.reason);
});

test('[SN-6] والاستراتيجياتُ الدلاليّةُ الثلاثُ مُعلَنةٌ معًا', () => {
  // ‎CALLBACK_HELL‎ و‎MISSING_AUTH‎ كانتا ‎autoFix: false‎ أصلًا، وانضمّت
  // إليهما ‎EMPTY_FUNCTION‎. ويُثبَّت هنا كي لا تعود إحداها ضمنًا.
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'repair_engine.js'), 'utf8');
  for (const key of ['CALLBACK_HELL', 'MISSING_AUTH', 'EMPTY_FUNCTION']) {
    const m = new RegExp('^\\s*' + key + ':\\s*\\{[^}]*\\}', 'm').exec(src);
    assert.ok(m, key + ' غيرُ موجودٍ في STRATEGIES');
    assert.match(m[0], /autoFix:\s*false/, key + ' صار autoFix: true بلا دليلٍ على أن ناتجَه إصلاح');
  }
});
