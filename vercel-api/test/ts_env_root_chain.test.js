// ═══════════════════════════════════════════════════════
// بلاغٌ إرشاديٌّ على السطرِ الجديد كان يطرح إصلاحًا أمنيًّا كاملًا
// تشغيل:  node --test vercel-api/test/ts_env_root_chain.test.js
//
// نقلُ سرٍّ مُضمَّنٍ إلى البيئةِ في ‎.ts‎ يُنتج ‎process.env.KEY‎. وقاعدةُ
// ‎typescript_analyzer‎ رقم 10 تُطلق على **أيِّ** سلسلةِ ثلاثةِ أجزاء، فتولد
// على السطرِ الجديدِ 🔵 «استخدم Optional Chaining ‎?.‎» — وجذرُ البيئةِ
// موجودٌ دائمًا في زمنِ التشغيل، فالاقتراحُ ضوضاءٌ لا احتياط.
//
// وثمنُه لم يكن الضوضاء: البوابةُ تحكم ‎REJECTED_ISSUES_WORSENED (+1)‎
// فتطرح إصلاحًا أزال ثلاثةَ بلاغاتٍ أمنيّة —
//   🟠 Secret مُضمَّن · 🔴 كلمة مرور/مفتاح مُضمَّن · 🔴 CWE-798
// مقابلَ بلاغٍ واحدٍ ‎sev:'l'‎ ‎conf:58‎. وسقطت بذلك ‎HARDCODED_SECRET/ts‎
// و‎API_KEY/ts‎ كلتاهما.
//
// و‎[ENV-ROOT]‎ يُعالج **مصدرَ البلاغِ الجديد**، لا البوابة: البوابةُ كانت
// تطبّق قاعدتَها كما كُتبت. وما بقي فيها مذكورٌ في ‎[EV-5]‎.
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
const chainHints = (code, fn) =>
  (ctx.analyzeCode(code, fn) || []).filter(i => /Optional Chaining/.test(String(i.title || '')));

test('[EV-1] قراءةُ البيئةِ ليست مرشَّحًا لـ‎?.‎', () => {
  const ENV = [
    'export const K = process.env.API_KEY;\n',
    'const v: string = process.env.DB_PASSWORD;\n',
    'export const M = import.meta.env.VITE_URL;\n',
    'const p = process.env["API_KEY"];\n',
  ];
  for (const code of ENV) {
    assert.strictEqual(chainHints(code, 'a.ts').length, 0, 'ضوضاء: ' + code.trim());
  }
});

test('[EV-2] والسلاسلُ الأخرى ما زالت تُقترَح', () => {
  // القاعدةُ لم تُلغَ، إنما استُثني جذرُ البيئةِ وحدَه.
  const STILL = [
    'const n = user.profile.name;\n',
    'export function f(o: any) { return o.data.items; }\n',
  ];
  for (const code of STILL) {
    assert.strictEqual(chainHints(code, 'b.ts').length, 1, 'ضاع الاقتراحُ على: ' + code.trim());
  }
});

test('[EV-3] والبوابةُ تقبل نقلَ السرِّ إلى البيئةِ في ‎.ts‎', () => {
  const PAIRS = [
    ['export const DB_PASSWORD = "ZZfakeSecretValue123";\n',
     'export const DB_PASSWORD = process.env.DB_PASSWORD;\n'],
    ['export const API_KEY = "ZZfakeApiKeyValue456";\n',
     'export const API_KEY = process.env.API_KEY;\n'],
  ];
  for (const [before, after] of PAIRS) {
    const v = ctx.FixVerifier.verifyFix(before, after, 'c.ts', ctx.analyzeCode);
    assert.strictEqual(v.accepted, true, 'رُدَّ: ' + v.reason);
    assert.deepStrictEqual(Array.from((v.diff && v.diff.worsened) || []), [],
      'ما زال يُحسَب تدهورًا');
  }
});

test('[EV-4] والمسارُ الكامل: السرُّ يُنقَل فعلًا في ‎.ts‎ والناتجُ سليم', () => {
  const CASES = [
    ['d.ts', 'export const DB_PASSWORD = "ZZfakeSecretValue123";\n'],
    ['e.ts', 'export const API_KEY = "ZZfakeApiKeyValue456";\n'],
  ];
  for (const [fn, code] of CASES) {
    const issues = ctx.analyzeCode(code, fn) || [];
    assert.ok(issues.length > 0, fn + ': لا بلاغ');
    const r = ctx.repairCode(code, issues.map(x => Object.assign({}, x)), fn);
    assert.doesNotMatch(r.repaired, /ZZfake(SecretValue123|ApiKeyValue456)/,
      fn + ': السرُّ باقٍ — ' + (((r.rejected || [])[0] || {}).reason || ''));
    assert.match(r.repaired, /process\.env\./, fn + ': لم يُقرأ من البيئة');
    assert.notStrictEqual(ctx.FixVerifier.syntaxCheck(r.repaired, fn).ok, false, 'الناتجُ مكسور');
    // وإعادةُ التحليلِ لا تُرجع بلاغَ سرٍّ ولا بلاغًا جديدًا
    assert.strictEqual((ctx.analyzeCode(r.repaired, fn) || []).length, 0,
      fn + ': بقي بلاغٌ بعد الإصلاح');
  }
});

test('[EV-5] والبوابةُ ما زالت تَعُدُّ أيَّ بلاغٍ جديدٍ تدهورًا مهما خفَّت درجتُه', {
  todo: 'سببٌ مستقلٌّ لم يُعالَج في هذه الدفعة، وموضعُه ‎fix_verifier.js‎: ' +
        '‎REJECTED_ISSUES_WORSENED‎ يُطلق على ظهورِ أيِّ صنفٍ جديدٍ ولو كان ' +
        '‎sev:"l"‎ إرشاديًّا، في مقابلِ بلاغاتٍ حرجةٍ أُزيلت. والبوابةُ تحسب ' +
        '‎addedHighSeverity‎ في ‎diff‎ ولا يدخل القرار. وقد زال أثرُه على ' +
        'هذه الحالةِ بمعالجةِ مصدرِ البلاغ، لكنّ القاعدةَ نفسَها كما هي — ' +
        'فالحالةُ غيرُ آمنةٍ لمصادرَ أخرى.',
}, () => {
  const before = 'export const K = "ZZfakeSecretValue123";\n';
  // بلاغٌ إرشاديٌّ مُصطنَعٌ على السطرِ الجديد، ومعه إزالةُ ثلاثةِ بلاغاتٍ أمنيّة
  const after = 'export const K = process.env.K;\nconst n = user.profile.name;\n';
  const v = ctx.FixVerifier.verifyFix(before, after, 'f.ts', ctx.analyzeCode);
  assert.strictEqual(v.accepted, true,
    'طُرح إصلاحٌ أزال ثلاثةَ بلاغاتٍ أمنيّةٍ لأجلِ بلاغٍ إرشاديّ: ' + v.reason);
});
