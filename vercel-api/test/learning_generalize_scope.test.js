// ═══════════════════════════════════════════════════════
// learning_engine.js — نطاق القالب المعمَّم لا يتعدى الشكل المعيب
// تشغيل:  node --test vercel-api/test/learning_generalize_scope.test.js
//
// D2-CORRESPONDS الجزء (ب). generalizeLinePair تتعلّم "فكرة الإصلاح" بدل نسخ
// السطر حرفياً، فتُبدل كل معرّف ونص حرفي بخانة. والمشكلة أنها تُبدل أيضاً
// الرمزَ الذي **يُعرِّف** الثغرة، فيصير القالب يطابق كوداً سليماً تماماً.
// والمقيس على الأزواج الصحيحة الثلاثة المقصود تعلّمها:
//
//   secret:        const __ID_1__ = __STR_1__;
//                → const __ID_1__ = process.env.__ID_1__;
//     فيحوّل  const APP_NAME = "Reality Engine"  إلى process.env.APP_NAME
//
//   md5→sha256:    const __ID_1__ = __ID_2__.__ID_3__(__STR_1__);
//                → const __ID_1__ = __ID_2__.__ID_3__("sha256");
//     فيحوّل  const p = path.join("config")  إلى  path.join("sha256")
//
//   innerHTML→textContent:  __ID_1__.__ID_2__ = __ID_3__.__ID_4__;
//                         → __ID_1__.textContent = __ID_3__.__ID_4__;
//     فيحوّل  cfg.timeout = opts.value  إلى  cfg.textContent = opts.value
//
// وهذا ليس خلل corresponds() ولا يُغلقه إصلاح الجزء (أ): البذرة هنا زوج
// صحيح ومشروع التخزين، إسناد لنفس الهدف، تقابله مؤكد.
//
// العقد الذي يثبّته هذا الملف: لا يُجرَّد إلا ما لم يُغيّره الإصلاح. الرمز
// الذي يغيّره الإصلاح هو إشارة الثغرة، فيبقى حرفياً في القالب. وما لا يمكن
// إثبات سلامة تعميمه لا يُعمَّم (fail-closed) — ويبقى التعلّم بالمطابقة
// الحرفية عاملاً كما هو.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STORAGE_KEY = 're_learned_patterns_v2';
const SECRET = 'sk_live_51H8xQ2abcdefghijKLMN';

// localStorage مخزن حقيقي: الـstub { getItem: () => null } يجعل getStats()
// صفراً دائماً لأن load() يقرأ من localStorage في كل نداء.
function loadCtx() {
  const noop = () => {};
  const store = new Map();
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop, createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); },
    },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة فقط */ }
  }
  ctx.toast = noop;
  ctx.refreshStats = noop;
  ctx.__store = store;
  return ctx;
}

// يتعلّم زوجاً مشروعاً ويعتمده، ويُرجع المخزن الخام + القوالب المعمَّمة
function seedApproved(before, after, file) {
  const ctx = loadCtx();
  const issues = ctx.analyzeCode(before, file);
  const ids = ctx.LearningEngine.learn(before, after, issues, file);
  ids.forEach(id => { ctx.LearningEngine.verify(id, true); ctx.LearningEngine.verify(id, true); });
  const raw = ctx.__store.get(STORAGE_KEY);
  const stored = JSON.parse(raw || '{"patterns":[]}').patterns;
  return { raw, stats: ctx.LearningEngine.getStats(), generalized: stored.map(p => p.generalized).filter(Boolean) };
}

function applyTo(raw, victim, file) {
  const ctx = loadCtx();
  if (raw) ctx.__store.set(STORAGE_KEY, raw);
  const lr = ctx.LearningEngine.applyLearned(victim, file);
  const gate = lr.fixed === victim
    ? { accepted: false, reason: 'NO_CHANGE' }
    : ctx.FixVerifier.verifyFix(victim, lr.fixed, file, ctx.analyzeCode);
  const ghost = lr.fixed === victim
    ? null
    : ctx.GhostMode.verdict(victim, lr.fixed, file, ctx.analyzeCode);
  const syntaxOk = lr.fixed === victim ? null : ctx.learnedSyntaxOk(file, victim, lr.fixed);
  return { ctx, lr, gate, ghost, syntaxOk };
}

// ─── الأزواج الصحيحة المشروعة ───────────────────────────
const PAIRS = {
  secret: ['a.js',
    `function f() {\n  const API_KEY = "${SECRET}";\n  return API_KEY;\n}\n`,
    'function f() {\n  const API_KEY = process.env.API_KEY;\n  return API_KEY;\n}\n'],
  md5: ['a.js',
    'const c = require("crypto");\nfunction h(p) {\n  const d = c.createHash("md5");\n  return d.update(p).digest("hex");\n}\nh("x");\n',
    'const c = require("crypto");\nfunction h(p) {\n  const d = c.createHash("sha256");\n  return d.update(p).digest("hex");\n}\nh("x");\n'],
  xss: ['a.js',
    'function s(u) {\n  el.innerHTML = u.bio;\n}\ns({});\n',
    'function s(u) {\n  el.textContent = u.bio;\n}\ns({});\n'],
};

// ═══ 0. شروط العزل: البذرة مشروعة فعلاً ════════════════
// بلا هذا، أي أخضر لاحق قد يكون سببه أن النمط لم يُخزَّن أصلاً.

for (const [key, [file, before, after]] of Object.entries(PAIRS)) {
  test(`isolation: النمط "${key}" صحيح ومخزَّن ومعتمد بصورة مشروعة`, () => {
    const { stats, generalized } = seedApproved(before, after, file);
    assert.ok(stats.total >= 1, `${key}: يجب أن يُخزَّن`);
    assert.ok(stats.approved >= 1, `${key}: ويُعتمد بتحققين`);
    assert.ok(generalized.length >= 1, `${key}: وله قالب معمَّم — وإلا لا يقيس هذا الملف شيئاً`);
  });
}

// ═══ 1. الضرر: ثوابت غير مرتبطة في ملف بلا أي بلاغ ══════
// الضحية هنا نظيفة تماماً، فلا بلاغ يُزال ولا مبرر لأي تعديل.

const CLEAN_VICTIMS = {
  secret: ['app.js',
    'function setupApp() {\n  const APP_NAME = "Reality Engine";\n  const VERSION = "2.1.0";\n  return render(APP_NAME, VERSION);\n}\nsetupApp();\n'],
  md5: ['app.js',
    'function setupApp() {\n  const p = path.join("config");\n  return p;\n}\nsetupApp();\n'],
  xss: ['app.js',
    'function setupApp() {\n  cfg.timeout = opts.value;\n  return cfg;\n}\nsetupApp();\n'],
};

for (const [key, [vfile, victim]] of Object.entries(CLEAN_VICTIMS)) {
  test(`لا تعميم على ملف نظيف: ${key}`, () => {
    const { raw } = seedApproved(...[PAIRS[key][1], PAIRS[key][2], PAIRS[key][0]]);
    const { lr } = applyTo(raw, victim, vfile);
    assert.strictEqual(lr.applied, 0,
      `${key}: طُبّق على ${lr.applied} سطراً في ملف لا يحمل الثغرة إطلاقاً`);
    assert.strictEqual(lr.fixed, victim, `${key}: والكود يجب أن يبقى حرفياً كما هو`);
  });
}

// ═══ 2. الضرر الذي يجتاز البوابات ══════════════════════
// الضحية تحمل سرّاً حقيقياً **و** ثوابت عادية. إزالة بلاغ السرّ وحدها لا
// تكفي دليلاً على صحة الإصلاح: الثوابت العادية يجب أن تبقى كما هي.

const MIXED_VICTIM_FILE = 'app.js';
const MIXED_VICTIM =
  'function setupApp() {\n' +
  `  const SECRET_TOKEN = "${SECRET}";\n` +
  '  const APP_NAME = "Reality Engine";\n' +
  '  const VERSION = "2.1.0";\n' +
  '  return render(SECRET_TOKEN, APP_NAME, VERSION);\n}\nsetupApp();\n';

test('ملف مختلط: الثوابت العادية لا تتحول إلى قراءات من process.env', () => {
  const { raw } = seedApproved(PAIRS.secret[1], PAIRS.secret[2], PAIRS.secret[0]);
  const { lr } = applyTo(raw, MIXED_VICTIM, MIXED_VICTIM_FILE);
  assert.match(lr.fixed, /const APP_NAME = "Reality Engine";/,
    'APP_NAME ثابت عادي — لا علاقة له بالأسرار');
  assert.match(lr.fixed, /const VERSION = "2\.1\.0";/,
    'VERSION ثابت عادي — لا علاقة له بالأسرار');
  assert.doesNotMatch(lr.fixed, /process\.env\.APP_NAME/, 'APP_NAME لا يقرأ من البيئة');
  assert.doesNotMatch(lr.fixed, /process\.env\.VERSION/, 'VERSION لا يقرأ من البيئة');
});

test('ملف مختلط: لا مراجع تصير غير معرّفة بسبب التعميم', () => {
  const { raw } = seedApproved(PAIRS.secret[1], PAIRS.secret[2], PAIRS.secret[0]);
  const { lr } = applyTo(raw, MIXED_VICTIM, MIXED_VICTIM_FILE);
  // كل اسم يُستعمل في render يجب أن يبقى معرّفاً بقيمة من الملف نفسه،
  // لا بقراءة من البيئة لم يطلبها أحد.
  for (const name of ['APP_NAME', 'VERSION']) {
    const decl = new RegExp(`const ${name} = "[^"]*";`);
    assert.match(lr.fixed, decl, `${name} يجب أن يبقى مُصرَّحاً بقيمته الأصلية`);
  }
});

test('ملف مختلط: البوابات لا تقبل تعديلاً يمسّ ثوابت غير مرتبطة', () => {
  const { raw } = seedApproved(PAIRS.secret[1], PAIRS.secret[2], PAIRS.secret[0]);
  const { lr, gate, ghost, syntaxOk } = applyTo(raw, MIXED_VICTIM, MIXED_VICTIM_FILE);
  if (lr.fixed === MIXED_VICTIM) return; // لم يُطبَّق شيء ⇒ لا ضرر

  const collateral = /process\.env\.(?:APP_NAME|VERSION)/.test(lr.fixed);
  if (!collateral) return; // طُبّق على سطر السرّ وحده ⇒ سلوك مقبول

  // وهنا بيت القصيد: التعديل مدمّر، فلا يجوز أن تقبله البوابة. ونسجّل حالة
  // كل مرحلة صراحةً حتى لا يُنسب الأخضر إلى رفض من مرحلة أخرى.
  assert.ok(!gate.accepted,
    `البوابة قبلت تعديلاً مدمّراً (${gate.reason}) — ` +
    `Ghost=${ghost && ghost.verdict}/${ghost && ghost.reason}، learnedSyntaxOk=${syntaxOk}. ` +
    'إزالة بلاغ السرّ لا تبرّر تحويل APP_NAME وVERSION إلى process.env');
});

// ═══ 3. الإصلاح الصحيح ما زال يعمل ═════════════════════
// حالة يُزال فيها بلاغ حقيقي مع بقاء بقية السلوك: السطر المطابق حرفياً
// يُصلَح، وما حوله لا يُمَس.

test('يزيل بلاغاً حقيقياً: سطر السرّ المطابق يُصلَح وما حوله يبقى', () => {
  const { raw } = seedApproved(PAIRS.secret[1], PAIRS.secret[2], PAIRS.secret[0]);
  const victim =
    'function boot() {\n' +
    `  const API_KEY = "${SECRET}";\n` +
    '  const APP_NAME = "Reality Engine";\n' +
    '  return connect(API_KEY, APP_NAME);\n}\nboot();\n';
  const { ctx, lr, gate } = applyTo(raw, victim, 'app.js');

  assert.ok(lr.applied >= 1, 'السطر المطابق حرفياً يجب أن يُصلَح');
  assert.match(lr.fixed, /const API_KEY = process\.env\.API_KEY;/, 'السرّ يقرأ من البيئة');
  assert.match(lr.fixed, /const APP_NAME = "Reality Engine";/, 'والثابت العادي كما هو');

  const sec = c => ctx.analyzeCode(c, 'app.js')
    .filter(i => /secret|hardcoded/i.test(String(i.type || ''))).length;
  assert.ok(sec(lr.fixed) < sec(victim), 'وبلاغ السرّ انخفض فعلاً');
  assert.ok(gate.accepted, `والبوابة تقبل الإصلاح السليم — ${gate.reason}`);
});

// ═══ 4. التعميم غير القابل للإثبات لا يحدث ══════════════
// الرمز الذي يغيّره الإصلاح هو إشارة الثغرة. تجريده يجعل القالب يطابق
// الشكل السليم، فيُمنع.

test('القالب يحفظ الرمز الذي يغيّره الإصلاح حرفياً', () => {
  const { generalized: gSecret } = seedApproved(PAIRS.secret[1], PAIRS.secret[2], PAIRS.secret[0]);
  const { generalized: gMd5 }    = seedApproved(PAIRS.md5[1], PAIRS.md5[2], PAIRS.md5[0]);
  const { generalized: gXss }    = seedApproved(PAIRS.xss[1], PAIRS.xss[2], PAIRS.xss[0]);

  // md5: النص "md5" هو الإشارة — لا يصير خانة
  if (gMd5.length) {
    assert.doesNotMatch(gMd5[0].beforeTemplate, /__LEARN_STR_\d+__/,
      'نص "md5" هو إشارة الثغرة، فتجريده يجعل القالب يطابق أي استدعاء بنص');
    assert.match(gMd5[0].beforeTemplate, /md5/, 'ويبقى حرفياً في القالب');
  }
  // xss: المعرّف innerHTML هو الإشارة — لا يصير خانة
  if (gXss.length) {
    assert.match(gXss[0].beforeTemplate, /innerHTML/,
      'innerHTML هو إشارة الثغرة، فتجريده يجعل القالب يطابق أي إسناد خاصية');
  }
  // secret: النص السرّي هو الإشارة — لا يصير خانة مفتوحة
  if (gSecret.length) {
    assert.doesNotMatch(gSecret[0].beforeTemplate, /=\s*__LEARN_STR_\d+__/,
      'تجريد النص السرّي يجعل القالب يطابق أي ثابت نصّي');
  }
});

// ═══ 5. الأنماط الصحيحة ما زالت تُتعلَّم ════════════════
// التشديد على التعميم لا يجوز أن يمنع التخزين نفسه.

for (const [key, [file, before, after]] of Object.entries(PAIRS)) {
  test(`التعلّم نفسه لم يتأثر: ${key} ما زال يُخزَّن ويُعتمد`, () => {
    const { stats } = seedApproved(before, after, file);
    assert.ok(stats.total >= 1, `${key}: مخزَّن`);
    assert.ok(stats.approved >= 1, `${key}: ومعتمد`);
  });
}

// ═══ 6. القالب المعمَّم ما زال نافعاً حيث يجوز ══════════
// md5 وinnerHTML: الإشارة تبقى حرفية، فالقالب يطابق الشكل المعيب في ملف
// آخر بأسماء مختلفة — وهذا هو نفع التعميم الذي لا نريد خسارته.

test('نافع: قالب md5 يطابق الشكل المعيب بأسماء مختلفة ولا يطابق السليم', () => {
  const { raw } = seedApproved(PAIRS.md5[1], PAIRS.md5[2], PAIRS.md5[0]);
  const bad  = 'function g(x) {\n  const dig = lib.createHash("md5");\n  return dig.update(x).digest("hex");\n}\ng("a");\n';
  const good = 'function g(x) {\n  const p = path.join("config");\n  return p;\n}\ng("a");\n';
  const rb = applyTo(raw, bad, 'b.js');
  const rg = applyTo(raw, good, 'g.js');
  assert.ok(rb.lr.applied >= 1, 'الشكل المعيب بأسماء مختلفة يُصلَح — نفع التعميم محفوظ');
  assert.match(rb.lr.fixed, /sha256/, 'ويُستبدل بـsha256');
  assert.strictEqual(rg.lr.applied, 0, 'والشكل السليم لا يُمَس');
  assert.doesNotMatch(rg.lr.fixed, /sha256/, 'ولا يُحقَن فيه sha256');
});

test('نافع: نمط السرّ ما زال يُعمَّم على اسم متغيّر مختلف', () => {
  const { raw } = seedApproved(PAIRS.secret[1], PAIRS.secret[2], PAIRS.secret[0]);
  const victim = `function g() {\n  const TOKEN = "${SECRET}";\n  return TOKEN;\n}\ng();\n`;
  const { lr } = applyTo(raw, victim, 'g.js');
  assert.ok(lr.applied >= 1, 'اسم المتغيّر سياق قابل للتجريد — التعميم عليه محفوظ');
  assert.match(lr.fixed, /const TOKEN = process\.env\.TOKEN;/);
});

// تكلفة مقصودة ومسجَّلة: النص السرّي هو الإشارة الوحيدة التي تميّز السطر
// المعيب عن ثابت نصّي سليم، فتجريده هو بالضبط ما كان يدمّر APP_NAME. فنمط
// سرّ واحد لم يعد يُعمَّم على قيمة سرّ أخرى. وهذا لا يُفقد كشفاً: المحلل
// يبلّغ عن كل سرّ على حدة ومحرك الإصلاح يعالجه، والتعلّم طبقة إضافية.
// وأنماط md5/sha1/innerHTML تحتفظ بتعميمها الكامل لأن إشارتها رمز ثابت.
test('تكلفة مسجَّلة: نمط سرّ لا يُعمَّم على قيمة سرّ أخرى', () => {
  const { raw } = seedApproved(PAIRS.secret[1], PAIRS.secret[2], PAIRS.secret[0]);
  const other = 'function g() {\n  const K = "sk_live_9ZQ8xW2zzzzzzzzzzKLMN";\n  return K;\n}\ng();\n';
  const { lr } = applyTo(raw, other, 'g.js');
  assert.strictEqual(lr.applied, 0,
    'قيمة سرّ أخرى لا تُطابَق — الثمن المقصود لمنع مطابقة أي ثابت نصّي');
});

test('نافع: قالب innerHTML يطابق الشكل المعيب ولا يطابق أي إسناد خاصية', () => {
  const { raw } = seedApproved(PAIRS.xss[1], PAIRS.xss[2], PAIRS.xss[0]);
  const bad  = 'function v(p) {\n  node.innerHTML = p.text;\n}\nv({});\n';
  const good = 'function v(p) {\n  cfg.timeout = p.value;\n}\nv({});\n';
  const rb = applyTo(raw, bad, 'b.js');
  const rg = applyTo(raw, good, 'g.js');
  assert.ok(rb.lr.applied >= 1, 'الشكل المعيب بأسماء مختلفة يُصلَح');
  assert.match(rb.lr.fixed, /node\.textContent = p\.text;/, 'ويُستبدل بـtextContent');
  assert.strictEqual(rg.lr.applied, 0, 'وإسناد الخاصية السليم لا يُمَس');
  assert.doesNotMatch(rg.lr.fixed, /textContent/, 'ولا يُحقَن فيه textContent');
});
