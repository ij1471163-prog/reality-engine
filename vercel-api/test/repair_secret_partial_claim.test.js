// ═══════════════════════════════════════════════════════
// إصلاحُ سرٍّ من سرَّين لا يُعلَن اكتمالًا
// تشغيل:  node --test vercel-api/test/repair_secret_partial_claim.test.js
//
// الحالةُ الدافعة، مقيسةٌ بالتنفيذ قبل العلاج:
//     const A = "sk_test_1…", B = "sk_test_2…";
//   بلاغٌ واحد (الكاشفُ يُبلّغ مرّةً لكلِّ سطرٍ وصنف) ⇒ المُصلِحُ ينقل الأوّلَ
//   إلى ‎process.env.A‎ ⇒ قائمةُ الأمانِ في ‎knowledge_base.js‎ تُبيّض السطرَ
//   كلَّه لورودِ ‎process.env‎ فيه ⇒ إعادةُ التحليل: صفرُ بلاغ ⇒ البوابة
//   ‎before:1 after:0‎ ⇒ ‎summary: total=1 fixed=1 score=100٪‎
//   — و‎sk_test_2…‎ ما زال في الملفّ.
//
// والعلاجُ ‎[SELF-EVIDENT]‎: قائمةُ الأمانِ لا تُبيّض نمطًا يصف **القيمة**
// (مفاتيحُ المزوّدين السّتّة) بل أنماطَ **الإسناد** وحدَها. فلم يعد السطرُ
// يختفي، ولم يعد النجاحُ يُعلَن كاملًا.
//
// وما لم يُعالَج، مذكورٌ لا مسكوتٌ عنه: البلاغُ يبقى واحدًا لكلِّ (سطر، صنف)
// — ‎dedupeIssues‎ في ‎analyzer.js‎ يجمع بمفتاحِ ‎line + vulnClass‎ — فالسرّان
// على سطرٍ واحدٍ لا يصيران بلاغَين، ولذلك لا يُطبَّق الإصلاحُ الجزئيُّ أصلًا
// (تحكم البوابةُ ‎REJECTED_NO_IMPROVEMENT‎). وتمييزُهما يحتاج موضعًا داخلَ
// السطرِ في بنيةِ البلاغ، وهو تغييرٌ أوسعُ لم يُطلَب. و‎[SC-3]‎ يُثبّت الحالَ
// كما هو كي لا يتبدّل صامتًا.
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

const SECRET_RX = /secret|api key|hardcoded|credential|password|token|مُضمَّن/i;
const secretFindings = (code, fn) =>
  (ctx.analyzeCode(code, fn) || []).filter(i => SECRET_RX.test(String(i.title || '')));
// قيمٌ حرفيّةٌ مختلقةٌ بالكامل، بأشكالِ المزوّدين كي تُطابق الأنماط.
const K1 = 'sk_test_ZZFAKE1111111111111111';
const K2 = 'sk_test_ZZFAKE2222222222222222';
const TWO = 'const A = "' + K1 + '", B = "' + K2 + '";\nmodule.exports = { A, B };\n';

function cycle(code, fn) {
  const issues = ctx.analyzeCode(code, fn) || [];
  const r = ctx.repairCode(code, issues.map(x => Object.assign({}, x)), fn);
  return { r, repaired: (r && typeof r.repaired === 'string') ? r.repaired : code,
           summary: (r && r.summary) || { total: 0, fixed: 0, score: 0 } };
}

// ═══ الثابتُ الأساسيّ: لا اكتمالَ معلَنٌ وسرٌّ حرفيٌّ باقٍ ═══

test('[SC-1] سرٌّ حرفيٌّ باقٍ في الناتج ⇒ لا تُعلَن نتيجةُ ١٠٠٪', () => {
  const { summary, repaired } = cycle(TWO, 'sc1.js');
  const left = repaired.match(/sk_test_ZZFAKE\w+/g) || [];
  if (left.length > 0) {
    assert.notStrictEqual(summary.score, 100,
      'أُعلن ١٠٠٪ وفي الملفّ ' + left.length + ' سرًّا: ' + left.join(', '));
  }
});

test('[SC-2] سرٌّ حرفيٌّ باقٍ في الناتج ⇒ المحرّكُ ما زال يراه', () => {
  const { repaired } = cycle(TWO, 'sc2.js');
  const left = repaired.match(/sk_test_ZZFAKE\w+/g) || [];
  if (left.length > 0) {
    assert.ok(secretFindings(repaired, 'sc2.js').length > 0,
      'السرُّ ' + left[0] + ' في الملفّ ولا بلاغَ عليه — اختفى من التحليل');
  }
});

test('[SC-3] الحالُ المقيسُ للسرَّين على سطرٍ واحد', () => {
  // بلاغٌ واحدٌ لا بلاغان (‎dedupeIssues‎ بمفتاحِ line+vulnClass)، ولأن
  // العددَ لا ينقص لا تُقبل النصفُ إصلاحًا — وهو الصوابُ ما دام البلاغُ باقيًا.
  const before = secretFindings(TWO, 'sc3.js');
  assert.strictEqual(before.length, 1);
  const { r, repaired } = cycle(TWO, 'sc3.js');
  assert.strictEqual((r.repairs || []).length, 0, 'طُبِّق إصلاحٌ نصفيٌّ — راجع [SC-1]');
  assert.strictEqual(repaired, TWO, 'تغيّر الملفُّ دون إصلاحٍ مسجَّل');
  assert.ok((r.rejected || []).length > 0, 'لا قبولَ ولا رفض — القرارُ ضاع صامتًا');
});

// ═══ قائمةُ الأمان: ما تُبيّضه وما لا تُبيّضه ═══

test('[SC-4] ‎process.env‎ على السطر لا يُخفي مفتاحًا حرفيًّا بجانبه', () => {
  const CASES = [
    ['AWS',    'const a = { r: process.env.REGION, id: "AKIAZZFAKE1234567890" };\n'],
    // ‎sk_test_‎ لا ‎sk_live_‎: حمايةُ الدفعِ في GitHub تحجب شكلَ المفتاحِ
    // الحيِّ ولو كانت القيمةُ مختلقةً بالكامل. والنمطان مدخلان منفصلان في
    // ‎selfEvident‎، فالمقصودُ من الاختبارِ قائمٌ.
    ['Stripe', 'const c = { u: process.env.URL, k: "sk_test_ZZFAKEaaaaaaaaaaaaaaaaaaaaaa" };\n'],
    ['GitHub', 'const g = { u: process.env.USER, t: "ghp_ZZFAKEabcdefghijklmnopqrstuvwxyz0123" };\n'],
    // ذيلُ مفتاحِ Google ثلاثةٌ وثلاثون محرفًا بالضبط، وإلا لم يُطابق النمطَ
    // فمرّ الاختبارُ على عيّنةٍ لا تصف شيئًا.
    ['Google', 'const m = { u: process.env.URL, k: "AIzaSyZZFAKE0123456789abcdefghijklmnopq" };\n'],
  ];
  for (const [label, code] of CASES) {
    assert.ok(secretFindings(code, 'sc4.js').length > 0,
      'مفتاحُ ' + label + ' محجوبٌ لورودِ process.env على السطر');
  }
});

test('[SC-5] وقائمةُ الأمانِ ما زالت تعمل حيث يجب', () => {
  const SAFE = [
    ['قراءةٌ من البيئة', 'const a = process.env.TOKEN;\nconst b = process.env.API_KEY;\n'],
    ['jwt بمفتاحِ بيئة', 'const t = jwt.sign(p, process.env.SECRET, { expiresIn: "1h" });\n'],
    ['إسنادٌ نُقل للبيئة', 'const API_KEY = process.env.API_KEY;\n'],
  ];
  for (const [label, code] of SAFE) {
    assert.strictEqual(secretFindings(code, 'sc5.js').length, 0,
      'إيجابٌ كاذبٌ في: ' + label);
  }
});

// ═══ البوابة: القبولُ ليس إعلانَ اكتمال ═══

test('[SC-6] مُرشَّحٌ يُصلح واحدةً من ثلاثٍ يُظهر البقيّةَ لا يُخفيها', () => {
  const before = 'const A = "' + K1 + '";\n\nconst B = "' + K2 + '";\n\n' +
                 'const C = "sk_test_ZZFAKE3333333333333333";\nmodule.exports = { A, B, C };\n';
  const after = before.replace('"' + K1 + '"', 'process.env.A');
  const v = ctx.FixVerifier.verifyFix(before, after, 'sc6.js', ctx.analyzeCode);
  assert.strictEqual(v.accepted, true, 'رُفض تقدّمٌ حقيقيّ — خسارةُ إصلاح');
  // القبولُ مشروطٌ بأن تحمل النتيجةُ البقيّةَ صراحةً، وإلا قُرئ اكتمالًا.
  const imp = ((v.diff && v.diff.improved) || []).find(d => /SECRET/i.test(String(d.key || '')));
  assert.ok(imp, 'لا سجلَّ لصنفِ السرِّ في diff');
  assert.strictEqual(imp.before, 3);
  assert.strictEqual(imp.after, 2, 'البوابةُ تقول إن السرَّ زال وهو باقٍ مرّتين');
  assert.ok((v.afterIssues || []).length >= 2, 'البقيّةُ غائبةٌ عن afterIssues');
  assert.doesNotMatch(String(v.reason || ''), /\b(complete|اكتمل|كامل)\b/i);
});

// ═══ الثابتُ على مدى الأصناف: ما أُصلح لا يبقى منه أثر ═══

test('[SC-7] أيُّ صنفٍ سُجِّل له إصلاحٌ لا يبقى منه بلاغٌ في الناتج', () => {
  const KLASS = t => {
    const s = String(t || '').toLowerCase();
    if (SECRET_RX.test(s)) return 'SECRET';
    if (/md5|sha1|weak (hash|crypto)|cwe.?327|تشفير ضعيف/.test(s)) return 'CRYPTO';
    if (/xss|innerhtml/.test(s)) return 'XSS';
    if (/catch/.test(s)) return 'CATCH';
    if (/http:|insecure|cleartext|بدون https/.test(s)) return 'HTTP';
    return null;
  };
  const CODES = [
    'const crypto = require("crypto");\nfunction h(x){return crypto.createHash("md5").update(x).digest("hex");}\n\nfunction g(x){return crypto.createHash("md5").update(x).digest("hex");}\nmodule.exports = { h, g };\n',
    'module.exports.f = function f(a, b, c) {\n  try { a(); } catch (e) {}\n  try { b(); } catch (e) {}\n  try { c(); } catch (e) {}\n  return f;\n};\n',
    'module.exports.u = ["http://a.example.com/", "http://b.example.com/"];\n',
    'const K = "sk_test_ZZFAKEbbbbbbbbbbbbbbbbbbbbbb";\nmodule.exports = { K };\n',
  ];
  for (let i = 0; i < CODES.length; i++) {
    const fn = 'sc7_' + i + '.js';
    const { r, repaired } = cycle(CODES[i], fn);
    const fixed = new Set((r.repairs || []).map(x => KLASS(x.issue || x.title || x.reason)).filter(Boolean));
    if (!fixed.size) continue;
    for (const k of fixed) {
      const left = (ctx.analyzeCode(repaired, fn) || []).filter(i2 => KLASS(i2.title) === k);
      assert.strictEqual(left.length, 0,
        'أُصلح ' + k + ' في ' + fn + ' وبقي منه ' + left.length + ' بلاغًا');
    }
  }
});
