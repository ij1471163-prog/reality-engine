// ═══════════════════════════════════════════════════════
// بوابة اللغة في applyLearned
// ═══════════════════════════════════════════════════════
//
// كان الشرط في learning_engine.js:
//     (!p.language || p.language === fileLang)
// فالشقّ الأول يُمرِّر أي نمط **بلا حقل لغة** — أو بحقل فارغ — إلى أي
// ملف بأي لغة، على **المسارين** الحرفي والمعمَّم. والمسار الحرفي أخطر:
// applyLearned يجرّبه أولاً وهو خارج حماية القوالب [V4′] بنصّ تعليقها،
// فبوابة اللغة خطّ دفاعه الوحيد.
//
// المقيس من طرف إلى طرف قبل الإصلاح (المسار الحرفي، نمط بلا لغة):
//     h = hashlib.md5(p)  ⇒  h = crypto.createHash("sha256").update(p)
//     بلاغات 3 ⇒ 0 · Ghost pass score 98 all_fixed · حكم PASS · كُتب
//     ثم: compile=OK · run=NameError: name 'crypto' is not defined
// وعلى المسار المعمَّم: قالب أصله py كتب os.environ.get(...) في .js.
// أي أن كل إشارة يملكها المحرّك قالت «إصلاح مثالي»، والملف مكسور.
//
// الشرط الآن: p.language === fileLang حصرًا.
//
// ⚠️ أثر معلن: سجلٌّ قديم بلا حقل لغة (أو بحقل فارغ) يصبح **خامدًا**
// على كل اللغات. وهو المقصود: تعطيل سجلات لا يمكن التحقّق من لغتها
// أقلّ ضررًا من تطبيقها على لغة خاطئة. ولا يتأثّر شيء ممّا يخزّنه
// learn() اليوم: inferLanguage تُرجع دائماً نصًّا غير فارغ — لغةً
// معروفة أو 'unknown'.
//
// [P3] ثم أُحكمت الثغرة الباقية في الشرط نفسه: 'unknown' ليست لغة بل
// اسمٌ لغياب المعرفة، وكان 'unknown' === 'unknown' يُمرّر قالبًا من
// ملفٍ مجهول الامتداد إلى ملفٍ آخر مجهول الامتداد — Bash على YAML.
// فصار applyLearned يخرج مبكرًا متى كان fileLang === 'unknown'.
// والمقيس قبل الإحكام: learn() لا يُنتج أنماطًا بهذه اللغة إطلاقًا
// (0 أنماط من sh/cpp/rs/yml/sql)، وكل محاولة مزروعة رفضتها البوابة
// ولم تُكتب ⇒ سدٌّ احتياطي لمنفذٍ غير مستغَلّ، بلا كلفة تغطية.
// القسم 2 (حقل اللغة unknown) والقسم 5 يثبّتان هذا السلوك الجديد.
//
// ⚠️ حدّ معلن: هذه بوابة **اختيار** لا فحص دلالي. لا تمنع إصلاحًا
// خاطئًا بلغته الصحيحة؛ ذلك شأن GhostMode وFixVerifier. القسم 5
// يثبّت هذا الحدّ كي لا يُفهَم الأخضر على أنه تغطية لصحّة الإصلاح.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR  = path.join(__dirname, '..', 'public');
const STORAGE_KEY = 're_learned_patterns_v2';

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
  ctx.toast = noop; ctx.refreshStats = noop; ctx.__store = store;
  return ctx;
}

const seed  = (ctx, db) => ctx.__store.set(STORAGE_KEY, JSON.stringify(db));
const viaOf = lr => (Array.from(lr.uses || [])[0] || {}).via || '—';

function runPipe(ctx, files) {
  vm.runInContext('F = ' + JSON.stringify(files) + ';', ctx);
  vm.runInContext('R = {}; Object.keys(F).forEach(k => { R[k] = { code: F[k], issues: analyzeCode(F[k], k) }; });', ctx);
  const report = vm.runInContext('JSON.parse(JSON.stringify(fixAllEnginePipeline()))', ctx);
  return { report, out: vm.runInContext('JSON.parse(JSON.stringify(F))', ctx) };
}

// يرفع النمط إلى معتمَد ويضبط حقل لغته. undefined ⇒ يُحذف الحقل.
const withLang = (p, lang) => {
  const q = JSON.parse(JSON.stringify(p));
  q.verified = 2; q.failures = 0; q.confidence = 0.5; q.approved = true;
  if (lang === undefined) delete q.language; else q.language = lang;
  return { patterns: [q], safe: [], meta: { total: 1 } };
};

// ─── نمط المسار المعمَّم: مُولَّد بـlearn() نفسه ────────────
// قالب مكتوب يدويًّا لا يُطابق شيئًا: البنية الحقيقية تحمل
// beforeSlots/afterSlots/sharedTokens، وبدونها تمرّ اختبارات المسار
// المعمَّم كلها **لأن لا شيء يُطبَّق أصلاً** — أي تغطية خاوية. فنُولّده.
function mintRealPattern() {
  const ctx = loadCtx();
  ctx.__store.delete(STORAGE_KEY);
  ctx.__b = 'SECRET_KEY = "abc123"\n';
  ctx.__a = "SECRET_KEY = os.environ.get('SECRET_KEY', '')\n";
  ctx.__f = 'cfg.py';
  ctx.__i = JSON.parse(vm.runInContext('JSON.stringify(analyzeCode(__b, __f))', ctx));
  vm.runInContext('LearningEngine.learn(__b, __a, __i, __f)', ctx);
  const raw = ctx.__store.get(STORAGE_KEY);
  assert.ok(raw, 'learn() لم يخزّن شيئاً ⇒ لا يمكن بناء نمط معمَّم حقيقي');
  const p = JSON.parse(raw).patterns[0];
  assert.ok(p && p.generalized && p.generalized.beforeSlots,
    'النمط المُولَّد بلا beforeSlots ⇒ بنية غير متوقَّعة، والاختبار يفقد معناه');
  assert.strictEqual(p.language, 'py', 'لغة النمط المُولَّد ليست py');
  return p;
}
const GEN_PAT = mintRealPattern();

// هدفا المسار المعمَّم: سطر يطابق القالب شكلاً في py وفي js
const GEN_PY  = 'API_KEY = "abc123"\n';
const GEN_JS  = 'API_KEY = "abc123"\nmodule.exports = API_KEY;\n';
const GEN_OUT = "API_KEY = os.environ.get('API_KEY', '')";

// ─── نمط المسار الحرفي: يحاكي سجلاً قديماً ─────────────────
// السجل القديم بالتعريف ليس من إنتاج learn() الحالي، فيُختلَق عن قصد.
// والسطر نفسه حرفيًّا في Python وJavaScript، والإصلاح صالح في
// JavaScript وحدها: str في Python لا تملك concat.
const EX_BEFORE = 's = s + x';
const EX_AFTER  = 's = s.concat(x)';
const EX_PAT = {
  id: 'legacy-exact', type: 'STRING_CONCAT', before: EX_BEFORE, after: EX_AFTER,
  fingerprint: 'fp-legacy-exact', verified: 2, failures: 0, confidence: 0.5,
  approved: true, language: 'py',
};
const EX_PY  = `def build(s, x):\n    ${EX_BEFORE}\n    return s\n`;
const EX_JS  = `function build(s, x) {\n  ${EX_BEFORE}\n  return s;\n}\n`;
const EX_XYZ = `x\n${EX_BEFORE}\n`;

// ═══ 0. شروط العزل — تمنع الاختبار الخاوي ══════════════

test('tripwire: المخزن حقيقي — يقرأ ما كُتب فيه ويفرغ بالحذف', () => {
  const ctx = loadCtx();
  seed(ctx, withLang(EX_PAT, 'py'));
  assert.strictEqual(ctx.LearningEngine.getStats().total, 1, 'المخزن لا يقرأ ما كُتب فيه');
  ctx.__store.delete(STORAGE_KEY);
  assert.strictEqual(ctx.LearningEngine.getStats().total, 0, 'الحذف لا يؤثّر ⇒ المخزن ليس حقيقياً');
});

test('tripwire: المسار الحرفي يُنفَّذ فعلاً بلغة مطابقة', () => {
  const ctx = loadCtx();
  seed(ctx, withLang(EX_PAT, 'py'));
  const lr = ctx.LearningEngine.applyLearned(EX_PY, 'm.py');
  assert.strictEqual(lr.applied, 1, 'المسار الحرفي لا يعمل ⇒ تغطيته أدناه خاوية');
  assert.strictEqual(viaOf(lr), 'exact', 'المسار ليس حرفياً بل ' + viaOf(lr));
});

test('tripwire: المسار المعمَّم يُنفَّذ فعلاً بلغة مطابقة', () => {
  const ctx = loadCtx();
  seed(ctx, withLang(GEN_PAT, 'py'));
  const lr = ctx.LearningEngine.applyLearned(GEN_PY, 'm.py');
  assert.strictEqual(lr.applied, 1, 'المسار المعمَّم لا يعمل ⇒ تغطيته أدناه خاوية');
  assert.strictEqual(viaOf(lr), 'general', 'المسار ليس معمَّماً بل ' + viaOf(lr));
  assert.ok(lr.fixed.includes(GEN_OUT), 'الناتج غير متوقَّع: ' + JSON.stringify(lr.fixed));
});

// ═══ 1. الحالات الخمس × المسار الحرفي ══════════════════
// السلوك المطلوب: يُطبَّق إذا وفقط إذا p.language === لغة الملف

// [P3] xyz=0 في صفّ unknown: الامتداد المجهول لم يعد هدفًا لأي نمط.
const CASES = [
  { name: 'غائب',    lang: undefined, py: 0, js: 0, xyz: 0 },
  { name: 'فارغ',    lang: '',        py: 0, js: 0, xyz: 0 },
  { name: 'مطابق',   lang: 'py',      py: 1, js: 0, xyz: 0 },
  { name: 'مختلف',   lang: 'js',      py: 0, js: 1, xyz: 0 },
  { name: 'unknown', lang: 'unknown', py: 0, js: 0, xyz: 0 },
];

for (const c of CASES) {
  test(`exact · حقل اللغة ${c.name} ⇒ py=${c.py} js=${c.js} xyz=${c.xyz}`, () => {
    for (const [fn, code, want] of [['m.py', EX_PY, c.py], ['m.js', EX_JS, c.js], ['m.xyz', EX_XYZ, c.xyz]]) {
      const ctx = loadCtx();
      seed(ctx, withLang(EX_PAT, c.lang));
      const lr = ctx.LearningEngine.applyLearned(code, fn);
      assert.strictEqual(lr.applied, want,
        `اللغة ${c.name} على ${fn}: متوقَّع ${want} والمقيس ${lr.applied}` +
        (lr.applied ? ` · via=${viaOf(lr)} · ${JSON.stringify(lr.fixed.split('\n')[1])}` : ''));
    }
  });
}

// ═══ 2. الحالات الخمس × المسار المعمَّم ════════════════
// النمط أصله py. الهدفان: ملف py (مطابق) وملف js (مختلف).

for (const c of CASES) {
  test(`general · حقل اللغة ${c.name} ⇒ py=${c.py} js=${c.js}`, () => {
    for (const [fn, code, want] of [['m.py', GEN_PY, c.py], ['app.js', GEN_JS, c.js]]) {
      const ctx = loadCtx();
      seed(ctx, withLang(GEN_PAT, c.lang));
      const lr = ctx.LearningEngine.applyLearned(code, fn);
      assert.strictEqual(lr.applied, want,
        `اللغة ${c.name} على ${fn}: متوقَّع ${want} والمقيس ${lr.applied}` +
        (lr.applied ? ` · via=${viaOf(lr)} · ${JSON.stringify(lr.fixed.split('\n')[0])}` : ''));
    }
  });
}

test('general · Python داخل JavaScript: قالب أصله py لا يُطبَّق على .js حين لا لغة له', () => {
  const ctx = loadCtx();
  seed(ctx, withLang(GEN_PAT, undefined));
  const lr = ctx.LearningEngine.applyLearned(GEN_JS, 'app.js');
  assert.strictEqual(lr.applied, 0,
    `os.environ.get دخل ملف JavaScript: ${JSON.stringify(lr.fixed.split('\n')[0])}`);
});

// ═══ 3. JavaScript داخل Python — إعادة إنتاج الحالتين ══

const HARM = [
  { name: 'md5 ⇒ crypto.createHash',
    before: 'h = hashlib.md5(p)',
    after:  'h = crypto.createHash("sha256").update(p)',
    code:   'import hashlib\ndef f(p):\n    h = hashlib.md5(p)\n    return h\n' },
  { name: 'random ⇒ crypto.randomBytes',
    before: 'token = random.random()',
    after:  'token = crypto.randomBytes(32).toString("hex")',
    code:   'import random\ndef t():\n    token = random.random()\n    return token\n' },
];

for (const h of HARM) {
  const base = {
    id: 'legacy-harm', type: 'LEGACY', before: h.before, after: h.after,
    fingerprint: 'fp-legacy-harm', verified: 2, failures: 0, confidence: 0.5,
    approved: true, language: 'py',
  };

  test(`خطِر · ${h.name}: نمط بلا لغة لا يُطبَّق على ملف py`, () => {
    const ctx = loadCtx();
    seed(ctx, withLang(base, undefined));
    const lr = ctx.LearningEngine.applyLearned(h.code, 'm.py');
    assert.strictEqual(lr.applied, 0, `كود JavaScript دخل ملف Python: ${JSON.stringify(lr.fixed)}`);
  });

  test(`خطِر · ${h.name}: ولا يُكتب كود JavaScript في الملف عبر خط الأنابيب`, () => {
    const ctx = loadCtx();
    seed(ctx, withLang(base, undefined));
    const { report, out } = runPipe(ctx, { 'm.py': h.code });
    // التأكيد على الإسناد لا على «الملف لم يتغيّر»: مسارات أخرى
    // (Emergency مثلاً) تُصلح md5 إلى hashlib.sha256 وهو إصلاح Python
    // صحيح. المطلوب ألّا يأتي التعديل من applyLearned، وألّا يدخل
    // الملفَ كودٌ من لغة أخرى.
    assert.ok(!/\bcrypto\./.test(out['m.py']),
      `كود JavaScript كُتب في ملف Python:\n${out['m.py']}`);
    assert.ok(!out['m.py'].includes(h.after),
      `نصّ الإصلاح عبر-اللغات كُتب كما هو:\n${out['m.py']}`);
    assert.strictEqual((report.accepted || []).filter(a => a.source === 'applyLearned').length, 0,
      'قبول من applyLearned على نمط بلغة غير مطابقة');
    assert.strictEqual((report.learnedOutcomes || []).filter(o => o.outcome === 'PASS').length, 0,
      'حكم PASS على تعديل عبر-اللغات');
  });

  test(`ضبط موجب · ${h.name}: النمط بلغة py يبقى يُطبَّق`, () => {
    const ctx = loadCtx();
    seed(ctx, withLang(base, 'py'));
    assert.strictEqual(ctx.LearningEngine.applyLearned(h.code, 'm.py').applied, 1,
      'الحماية أوسع من اللازم: منعت نمطاً بلغة مطابقة');
  });
}

// ═══ 4. أثر الإصلاح على السجلات القديمة ════════════════

test('السجلات القديمة: نمط بلا حقل لغة يصبح خامداً على كل اللغات', () => {
  for (const [fn, code] of [['m.py', EX_PY], ['m.js', EX_JS], ['m.xyz', EX_XYZ]]) {
    const ctx = loadCtx();
    seed(ctx, withLang(EX_PAT, undefined));
    assert.strictEqual(ctx.LearningEngine.applyLearned(code, fn).applied, 0,
      `نمط بلا حقل لغة طُبِّق على ${fn}`);
  }
});

// [P3] كان هذا الاختبار يثبّت السلوك القديم: 'unknown' === 'unknown' يُطبَّق
// (applied=1). والسلوك قُصد تغييره لا كسره — 'unknown' دلالتها «لا أعرف
// اللغة»، وتساوي مجهولين ليس قرابة لغوية: قالبٌ من a.sh كان يُجرَّب على
// b.yml. فالتثبيت الآن على المنع، ومعه الدليل أن المنع لا يكلّف تغطية.
test('[P3] language="unknown" لم يعد يُطبَّق على الامتدادات المجهولة', () => {
  for (const fn of ['m.xyz', 'a.sh', 'b.yml', 'c.cpp', 'd.tf']) {
    const ctx = loadCtx();
    seed(ctx, withLang(EX_PAT, 'unknown'));
    assert.strictEqual(ctx.LearningEngine.applyLearned(EX_XYZ, fn).applied, 0,
      `قالب مجهول اللغة طُبِّق على ${fn} — المنفذ العابر للغات ما زال مفتوحًا`);
  }
});

test('[P3] المنع بلا كلفة: learn() لا يُنتج نمطًا بلغة unknown من هذه الامتدادات', () => {
  // الحجّة أن إغلاق 'unknown' لا يُفقد خبرةً قائمة: المصدر نفسه لا يُنتجها.
  const samples = [
    ['a.sh',  'eval "$x"\n'],
    ['a.cpp', 'int main(){ system(x); return 0; }\n'],
    ['a.yml', 'cmd: md5sum $FILE\n'],
    ['a.sql', 'SELECT * FROM t WHERE id = $id;\n'],
  ];
  for (const [fn, code] of samples) {
    const ctx = loadCtx();
    ctx.__store.delete(STORAGE_KEY);
    ctx.__code = code; ctx.__f = fn;
    const n = vm.runInContext(
      'LearningEngine.learn(__code, __code.replace("x", "y"), analyzeCode(__code, __f), __f).length', ctx);
    const got = JSON.parse(ctx.__store.get(STORAGE_KEY) || '{"patterns":[]}').patterns
      .filter(p => p.language === 'unknown').length;
    assert.strictEqual(got, 0,
      `${fn}: خُزِّن ${got} نمطًا بلغة unknown (learn أرجعت ${n}) ⇒ للمنع كلفة تغطية`);
  }
});

test('غير متأثّر: كل ما يخزّنه learn() اليوم يحمل لغة غير فارغة', () => {
  const samples = [
    ['cfg.py', 'SECRET_KEY = "abc123"\n', "SECRET_KEY = os.environ.get('SECRET_KEY', '')\n"],
    ['cfg.zz', 'SECRET_KEY = "abc123"\n', "SECRET_KEY = os.environ.get('SECRET_KEY', '')\n"],
  ];
  let measured = 0;
  for (const [fn, b, a] of samples) {
    const ctx = loadCtx();
    ctx.__store.delete(STORAGE_KEY);
    ctx.__b = b; ctx.__a = a; ctx.__f = fn;
    ctx.__i = JSON.parse(vm.runInContext('JSON.stringify(analyzeCode(__b, __f))', ctx));
    vm.runInContext('LearningEngine.learn(__b, __a, __i, __f)', ctx);
    const raw = ctx.__store.get(STORAGE_KEY);
    if (!raw) continue;                     // لم يُتعلَّم من هذه العيّنة
    for (const p of JSON.parse(raw).patterns) {
      measured++;
      assert.ok(typeof p.language === 'string' && p.language.length > 0,
        `learn() خزّن لغة ${JSON.stringify(p.language)} من ${fn} ⇒ الإصلاح سيُخمد ما يخزّنه المحرك نفسه`);
    }
  }
  assert.ok(measured > 0, 'لم يُقَس أي نمط ⇒ التأكيد خاوٍ');
});

// ═══ 5. حدّ معلن ═══════════════════════════════════════

test('موثَّق: البوابة اختيار لا فحص دلالي — نمط بلغته الصحيحة يُطبَّق ولو كان إصلاحه خاطئاً', () => {
  const ctx = loadCtx();
  seed(ctx, {
    patterns: [{
      id: 'doc-limit', type: 'T', before: 'a = 1', after: 'a = undefined_name_zzz',
      fingerprint: 'fp-doc-limit', verified: 2, failures: 0, confidence: 0.5,
      approved: true, language: 'py',
    }],
    safe: [], meta: { total: 1 },
  });
  assert.strictEqual(
    ctx.LearningEngine.applyLearned('def f():\n    a = 1\n    return a\n', 'm.py').applied, 1,
    'البوابة منعت نمطاً بلغة مطابقة — ليس دورها؛ صحّة الإصلاح شأن Ghost وFixVerifier');
});
