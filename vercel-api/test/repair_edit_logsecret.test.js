// ═══════════════════════════════════════════════════════
// [EDIT-LAYER/LOG] الخطوةُ الأولى: طبقةُ تحريرٍ بنموذجٍ نحويّ
// ═══════════════════════════════════════════════════════
//
// ‎LOG_SECRET‎ عُدِّل ثلاثَ مراتٍ خلال الشهرين (الوسائط، ثم النصوصُ الحرفية،
// ثم المصارف) وبقي يسقط على أشكالٍ لم تُجرَّب — لأن أداتَه تعبيرٌ نمطيّ
// ‎\(([^)]+)\)‎ يتوقّف عند أوّلِ ‎)‎ أيًّا كان موضعُها. وموازنةُ الأقواسِ ليست
// من اختصاصِ التعبيرِ النمطيّ، فالعيبُ لا يُغلَق بنمطٍ أفضل.
//
// ‎repair_edit.js‎ يُعطي المُصلِحَ مواضعَ محارفَ من مُحلِّلٍ حقيقيّ، ويُجرَّب
// **أمامَ** المسارِ النصّيِّ لا بدلًا منه: أيُّ تعذُّرٍ يُعيد السلوكَ القديم،
// و‎setRepairEditEnabled(false)‎ يُطفئه بالكامل.
//
// والحكمُ هنا بالتنفيذِ لا بالتحليل: تُشغَّل الوحدةُ قبل وبعد، ويُقاس أن
// السرَّ لم يَعُد يُطبَع، وأن قيمةَ الإرجاعِ وبقيةَ المطبوعاتِ كما هي.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const acorn = require(path.join(PUBLIC_DIR, 'acorn.min.js'));

function loadCtx(editLayer) {
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
  assert.strictEqual(typeof ctx.setRepairEditEnabled, 'function',
    'مفتاحُ الطبقةِ غيرُ منشور — لا سبيلَ للرجوعِ إلى المُصلِحِ القديم');
  ctx.setRepairEditEnabled(editLayer);
  return ctx;
}
const repair = (ctx, code, file) => {
  const iss = ctx.analyzeCode(code, file) || [];
  return { iss, out: ctx.repairCode(code, iss.map(x => Object.assign({}, x)), file) };
};
const parses = s => {
  for (const t of ['module', 'script']) {
    try { acorn.parse(s, { ecmaVersion: 'latest', sourceType: t, allowReturnOutsideFunction: true }); return true; }
    catch (e) { /* التالي */ }
  }
  return false;
};

// تشغيلٌ فعليّ: قيمةُ الإرجاع وما طُبع
const SECRET = 'P@ss-1234-SECRET';
function exec(src, call) {
  const logged = [];
  const cap = (...a) => logged.push(a.map(x => {
    try { return typeof x === 'string' ? x : JSON.stringify(x); } catch (e) { return String(x); }
  }).join(' '));
  const sb = { module: { exports: {} },
               console: { log: cap, warn: cap, error: cap, info: cap, debug: cap } };
  sb.exports = sb.module.exports;
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'm.js' });
  return { ret: call(sb.module.exports), logged };
}

// ── الأعطالُ الثلاثةُ الحيّةُ التي كشفها النموذج ──
const LIVE = [
  ['نداءان في سطرٍ واحد',
   'function f(a, password) {\n  console.log(a); console.log(password);\n  return a;\n}\nmodule.exports = { f };\n',
   api => api.f('visible-A', SECRET), 'visible-A'],
  ['قوسٌ داخل نصٍّ حرفيّ',
   'function f(password) {\n  console.log("a) b", password);\n  return "ok";\n}\nmodule.exports = { f };\n',
   api => api.f(SECRET), 'a) b'],
  ['نداءٌ متداخلٌ في الوسائط',
   'function f(password) {\n  const fmt = (x, y) => "F" + x + y;\n  console.log(fmt(1, 2), password);\n  return 7;\n}\nmodule.exports = { f };\n',
   api => api.f(SECRET), 'F12'],
];

for (const [label, code, call, kept] of LIVE) {
  test('[EL-1] عطبٌ حيٌّ يُغلَق، والسرُّ يزول فعلًا — ' + label, () => {
    // يُقاس على اللاقطَين معًا: الشجرةُ (js) والماسحُ البنيويُّ النصّيّ.
    // وكلاهما يجب أن يُغلق هذه الأشكال — فالعيبُ كان في الأداةِ النصّيّةِ
    // القديمة (تعبيرٌ نمطيٌّ يقف عند أوّلِ ‎)‎)، لا في اللغة.
    for (const backend of [true, false]) {
      const ctx = loadCtx(backend);
      const b = repair(ctx, code, 'a.js');
      assert.ok(b.iss.length > 0, 'tripwire: لا بلاغَ على هذه الشفرة');
      assert.ok((b.out.repairs || []).some(r => r.strategy === 'LOG_SECRET'),
        'لم يُطبَّق إصلاح (لاقطُ ' + (backend ? 'الشجرة' : 'النصّ') + ') — رُفض: ' +
        (b.out.rejected || []).map(r => r.reason).join(' | ').slice(0, 160));
      const base0 = exec(code, call), after0 = exec(b.out.repaired, call);
      assert.ok(!after0.logged.some(l => l.includes(SECRET)),
        'السرُّ ما زال يُطبَع (لاقطُ ' + (backend ? 'الشجرة' : 'النصّ') + ')');
      assert.deepStrictEqual(after0.ret, base0.ret, 'قيمةُ الإرجاع تغيّرت');
    }

    const ctx = loadCtx(true);
    const b = repair(ctx, code, 'a.js');
    const base = exec(code, call), after = exec(b.out.repaired, call);
    assert.ok(base.logged.some(l => l.includes(SECRET)), 'tripwire: الأصلُ لا يطبع السرّ');
    assert.ok(!after.logged.some(l => l.includes(SECRET)),
      'السرُّ ما زال يُطبَع بعد «الإصلاح»: ' + JSON.stringify(after.logged));
    assert.deepStrictEqual(after.ret, base.ret, 'قيمةُ الإرجاع تغيّرت');
    assert.ok(after.logged.some(l => l.includes(kept)),
      'ضاع ما ليس سرًّا من المطبوعات: ' + JSON.stringify(after.logged));
    assert.ok(parses(b.out.repaired), 'الناتجُ لا يُحلَّل');
  });
}

// ── الأشكالُ التاريخيةُ التي كلّفت جولاتٍ سابقة ──
const HISTORY = [
  ['الوسيطُ الأخير',   'function f(password) {\n  console.log("User:", password);\n  return 1;\n}\nmodule.exports = { f };\n', api => api.f(SECRET)],
  ['وسيطٌ وحيد',       'function f(password) {\n  console.log(password);\n  return 1;\n}\nmodule.exports = { f };\n', api => api.f(SECRET)],
  ['الوسيطُ الأوّل',    'function f(password) {\n  console.log(password, "tail");\n  return 1;\n}\nmodule.exports = { f };\n', api => api.f(SECRET)],
  ['سلسلةُ أعضاء',     'function f(u) {\n  console.log(u.token);\n  return 1;\n}\nmodule.exports = { f };\n', api => api.f({ token: SECRET })],
  ['ضمٌّ مع نصّ',      'function f(token) {\n  console.log("tok: " + token);\n  return 1;\n}\nmodule.exports = { f };\n', api => api.f(SECRET)],
  ['نصٌّ يحمل الكلمة', 'function f(password) {\n  console.log("password:", password);\n  return 1;\n}\nmodule.exports = { f };\n', api => api.f(SECRET)],
  ['وسيطان حسّاسان',   'function f(password, token) {\n  console.log(password, token);\n  return 1;\n}\nmodule.exports = { f };\n', api => api.f(SECRET, 'T-' + SECRET)],
  ['مَصرِفُ ‎log.‎',    'function f(password) {\n  const log = { info: (...a) => console.log(...a) };\n  log.info(password);\n  return 1;\n}\nmodule.exports = { f };\n', api => api.f(SECRET)],
];

test('[EL-2] ولا يتراجع شكلٌ كان يعمل — اللاقطان كلاهما يُصلح', () => {
  const oldCtx = loadCtx(false), newCtx = loadCtx(true);
  for (const [label, code, call] of HISTORY) {
    const a = repair(oldCtx, code, 'a.js'), b = repair(newCtx, code, 'a.js');
    const aRep = (a.out.repairs || []).some(r => r.strategy === 'LOG_SECRET');
    const bRep = (b.out.repairs || []).some(r => r.strategy === 'LOG_SECRET');
    assert.ok(aRep, 'لاقطُ النصِّ لا يُصلح ' + label);
    assert.ok(bRep, 'لاقطُ الشجرةِ لا يُصلح ' + label);

    const base = exec(code, call), after = exec(b.out.repaired, call);
    assert.ok(!after.logged.some(l => l.includes(SECRET)), label + ': السرُّ ما زال يُطبَع');
    assert.deepStrictEqual(after.ret, base.ret, label + ': قيمةُ الإرجاع تغيّرت');
    assert.ok(parses(b.out.repaired), label + ': الناتجُ لا يُحلَّل');
  }
});

test('[EL-3] وما لا يُمَسّ يبقى كما هو في المسارَين', () => {
  const KEEP = [
    ['عدّادٌ passwordCount', 'function f(passwordCount) {\n  console.log(passwordCount);\n  return passwordCount;\n}\nmodule.exports = { f };\n'],
    ['قيمةُ نداء',          'function f() {\n  const getToken = () => "tok";\n  console.log(getToken());\n  return 1;\n}\nmodule.exports = { f };\n'],
    ['dialog.show',         'function f(password) {\n  const dialog = { show: x => x };\n  return dialog.show(password);\n}\nmodule.exports = { f };\n'],
    ['logger.setLevel',     'function f(token) {\n  const logger = { setLevel: x => x };\n  return logger.setLevel(token);\n}\nmodule.exports = { f };\n'],
    ['نصٌّ حرفيٌّ فقط',      'function f() {\n  console.log("my password is 123");\n  return 1;\n}\nmodule.exports = { f };\n'],
  ];
  for (const on of [false, true]) {
    const ctx = loadCtx(on);
    for (const [label, code] of KEEP) {
      const { out } = repair(ctx, code, 'a.js');
      assert.ok(!/\[REDACTED\]/.test(out.repaired),
        label + ' نُقِّح (الطبقةُ ' + (on ? 'مُشغَّلة' : 'مُطفأة') + '): ' + out.repaired.trim());
    }
  }
});

test('[EL-4] مِلفٌّ فيه بلاغاتٌ عدّة: كلُّها تُعالَج في موضعِها', () => {
  const ctx = loadCtx(true);
  const code = 'function f(password, token, apiKey) {\n' +
               '  console.log("a) one", password);\n' +
               '  console.log(fmtX(1, 2), token);\n' +
               '  console.warn("three", apiKey);\n' +
               '  return 3;\n}\n' +
               'function fmtX(a, b) { return "F" + a + b; }\n' +
               'module.exports = { f };\n';
  const { out } = repair(ctx, code, 'multi.js');
  // ‎Array.from‎: المصفوفةُ من داخلِ الـVM بنموذجٍ أوّليٍّ آخر، و‎deepStrictEqual‎
  // يقارن النموذجَ الأوّليَّ أيضًا فيفشل على محتوًى متطابق.
  const reps = Array.from(out.repairs || []).filter(r => r.strategy === 'LOG_SECRET');
  assert.strictEqual(reps.length, 3, 'عددُ الإصلاحات: ' + JSON.stringify(reps.map(r => r.line)));
  assert.deepStrictEqual(reps.map(r => r.line).sort((a, b) => a - b), [2, 3, 4]);
  assert.strictEqual((out.repaired.match(/\[REDACTED\]/g) || []).length, 3);
  assert.ok(parses(out.repaired), 'الناتجُ لا يُحلَّل');

  const base = exec(code, api => api.f(SECRET, 'T1', 'K1'));
  const after = exec(out.repaired, api => api.f(SECRET, 'T1', 'K1'));
  assert.deepStrictEqual(after.ret, base.ret);
  for (const v of [SECRET, 'T1', 'K1'])
    assert.ok(!after.logged.some(l => l.includes(v)), 'قيمةٌ حسّاسةٌ ما زالت تُطبَع: ' + v);
  for (const v of ['a) one', 'F12', 'three'])
    assert.ok(after.logged.some(l => l.includes(v)), 'ضاع ما ليس سرًّا: ' + v);
});

// كلُّ ترتيباتِ قائمةٍ — تُستعمل حيث يكون العددُ قابلًا للاستنفاد
function* permutations(arr) {
  if (arr.length <= 1) { yield arr; return; }
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) yield [arr[i], ...p];
  }
}

test('[EL-5أ] استقرارُ الترتيب — **كلُّ** الترتيباتِ المُوجَّهة، بلا استثناء', () => {
  // عيبٌ مقيسٌ في حلقةِ التطبيق (سابقٌ لهذه الخطوة): بلاغان على السطرِ نفسِه
  // والفرزُ ‎b.line - a.line‎ غيرُ مستقرٍّ لمتساويَي السطر، فيعتمد الناتجُ على
  // ترتيبِ وصولِ البلاغات. هنا تُستنفَد كلُّ الترتيباتِ الممكنةِ للبلاغاتِ
  // المُوجَّهة — لا عيّنةً منها.
  const ctx = loadCtx(true);
  const code = 'function f(password, token) {\n' +
               '  log.info("a) x", password);\n' +
               '  log.warn(token);\n' +
               '  return 1;\n}\nmodule.exports = { f };\n';
  const iss = ctx.analyzeCode(code, 'ord.js') || [];
  const routed = Array.from(iss).filter(i => ctx.detectStrategy(i, 'js'));
  const inert = Array.from(iss).filter(i => !ctx.detectStrategy(i, 'js'));
  assert.ok(routed.length >= 2, 'tripwire: بلاغاتٌ مُوجَّهةٌ قليلة (' + routed.length + ')');
  assert.ok(routed.length <= 7, 'عددُ المُوجَّهةِ كبُر (' + routed.length + ') فلا تُستنفَد — ' +
    'يلزم تحديثُ التركيبةِ لا تخفيفُ الادّعاء');

  const outs = new Map();
  let n = 0;
  for (const p of permutations(routed.map((_, i) => i))) {
    n++;
    const arr = p.map(i => Object.assign({}, routed[i])).concat(inert.map(x => Object.assign({}, x)));
    const o = ctx.repairCode(code, arr, 'ord.js');
    outs.set(o.repaired, (outs.get(o.repaired) || 0) + 1);
  }
  let fact = 1; for (let i = 2; i <= routed.length; i++) fact *= i;
  assert.strictEqual(n, fact, 'لم تُستنفَد الترتيبات');
  assert.strictEqual(outs.size, 1,
    n + ' ترتيبًا أعطت ' + outs.size + ' نواتجَ — إصلاحٌ صحيحٌ يختفي بحسبِ الترتيب');
  const only = [...outs.keys()][0];
  assert.strictEqual((only.match(/\[REDACTED\]/g) || []).length, 2, 'عددُ التنقيحاتِ غيرُ ثابت');
  assert.ok(parses(only));
});

test('[EL-5ب] وعلى تركيبةٍ كثيرةِ البلاغات: عيّنةٌ واسعةٌ تُعطي ناتجًا واحدًا', () => {
  // ‎console.log‎ يجمع عليه سبعةُ كواشف، فالبلاغاتُ عشرةٌ والترتيباتُ أكثرُ من
  // ثلاثةِ ملايين. فالاستنفادُ متعذِّرٌ هنا لكثرةِ الكواشفِ لا لضعفِ الادّعاء،
  // وتُؤخَذ عيّنةٌ حتميّةٌ واسعةٌ بدلَه — والادّعاءُ يُذكَر بحدِّه.
  const ctx = loadCtx(true);
  const code = 'function f(password, token) {\n' +
               '  console.log("a) x", password);\n' +
               '  console.log(password, token);\n' +
               '  return 1;\n}\nmodule.exports = { f };\n';
  const iss = ctx.analyzeCode(code, 'ord.js') || [];
  assert.ok(iss.length >= 4, 'tripwire: بلاغاتٌ قليلة (' + iss.length + ')');

  const outs = new Map();
  const N = 60;
  for (let k = 0; k < N; k++) {
    const arr = Array.from(iss).map(x => Object.assign({}, x));
    for (let i = arr.length - 1; i > 0; i--) {       // خلطٌ حتميٌّ قابلٌ للإعادة
      const j = (i * 7 + k * 13 + 5) % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    const o = ctx.repairCode(code, arr, 'ord.js');
    outs.set(o.repaired, (outs.get(o.repaired) || 0) + 1);
  }
  assert.strictEqual(outs.size, 1,
    N + ' ترتيبًا أعطت ' + outs.size + ' نواتجَ مختلفة');
  const only = [...outs.keys()][0];
  assert.strictEqual((only.match(/\[REDACTED\]/g) || []).length, 3, 'عددُ التنقيحاتِ غيرُ ثابت');
  assert.ok(parses(only));
});

test('[EL-6] المفتاحُ يختار اللاقطَ، واللاقطان متكافئان حيث يعملان معًا', () => {
  // بعد إعادةِ الكتابةِ لم تَعُد في الملفِّ نسختان من المنطق، فلا «مُصلِحٌ
  // قديمٌ» يُرجَع إليه في زمنِ التشغيل. المفتاحُ يختار **اللاقط**: الشجرةَ
  // حيث تتوفّر، وإلا الماسحَ البنيويَّ النصّيّ. والرجوعُ عن إعادةِ الكتابةِ
  // كلِّها يكون بالمستودعِ لا بمفتاحٍ — وهذا ما تقتضيه نظافةُ التنفيذ.
  const ctx = loadCtx(true);
  assert.strictEqual(ctx.repairEditEnabled(), true);
  assert.strictEqual(ctx.repairEditSupports('js'), true);
  ctx.setRepairEditEnabled(false);
  assert.strictEqual(ctx.repairEditEnabled(), false);
  assert.strictEqual(ctx.repairEditSupports('js'), false, 'المفتاحُ لا يُغيّر اللاقط');
  ctx.setRepairEditEnabled(true);

  // والتكافؤ: كلُّ شكلٍ من أشكالِ السطرِ الواحدِ يُعطي الناتجَ نفسَه بأيِّ لاقط
  const tree = loadCtx(true), text = loadCtx(false);
  const SAME = [
    'function f(password) {\n  console.log("a) b", password);\n  return 1;\n}\nmodule.exports = { f };\n',
    'function f(password, token) {\n  console.log(password, token);\n  return 1;\n}\nmodule.exports = { f };\n',
    'function f(token) {\n  console.log("tok: " + token);\n  return 1;\n}\nmodule.exports = { f };\n',
    'function f(password) {\n  log.info(password);\n  return 1;\n}\nmodule.exports = { f };\n',
    'function f(passwordCount) {\n  console.log(passwordCount);\n  return 1;\n}\nmodule.exports = { f };\n',
  ];
  for (const code of SAME) {
    const a = repair(tree, code, 'a.js').out.repaired;
    const b = repair(text, code, 'a.js').out.repaired;
    assert.strictEqual(b, a, 'اللاقطان يختلفان على شكلٍ يدعمانه معًا:\n' + a + '\n---\n' + b);
  }
});

test('[EL-7] الطبقةُ آلةٌ عامّةٌ محروسة: لا ناتجَ غيرَ مفحوص', () => {
  const ctx = loadCtx(true);
  // لغةٌ لا مُحلِّلَ لها ⇒ لا تدخّل
  assert.strictEqual(ctx.repairEditSupports('py'), false);
  assert.strictEqual(ctx.repairEditSupports('ts'), false, 'ts خطوةٌ لاحقة — لا تُفعَّل ضمنًا');
  assert.strictEqual(ctx.repairEditSupports('js'), true);
  // شفرةٌ لا تُحلَّل ⇒ null لا استثناء
  assert.strictEqual(ctx.repairEditParse('function f( {'), null);
  // تحريراتٌ متداخلةٌ أو خارجةٌ عن الحدِّ ⇒ null
  const src = 'const a = 1;';
  assert.strictEqual(ctx.repairEditApply(src, [[0, 5, 'x'], [3, 8, 'y']]), null, 'تداخلٌ مرَّ');
  assert.strictEqual(ctx.repairEditApply(src, [[0, 999, 'x']]), null, 'خروجٌ عن الحدِّ مرَّ');
  assert.strictEqual(ctx.repairEditApply(src, []), null);
  // تحريرٌ يُنتج شفرةً مكسورة ⇒ null (فحصٌ ذاتيّ)
  assert.strictEqual(ctx.repairEditApply(src, [[8, 9, '(']]), null, 'ناتجٌ مكسورٌ خرج من الطبقة');
  // وتحريرٌ سليمٌ يمرّ
  assert.strictEqual(ctx.repairEditApply(src, [[10, 11, '2']]), 'const a = 2;');
});

test('[EL-8] وسطرُ ‎patch‎ على عقدِه: نصُّ السطرِ المُعدَّل', () => {
  const ctx = loadCtx(true);
  const code = 'function f(password) {\n  console.log("a) b", password);\n  return 1;\n}\nmodule.exports = { f };\n';
  const { out } = repair(ctx, code, 'a.js');
  const r = (out.repairs || []).find(x => x.strategy === 'LOG_SECRET');
  assert.ok(r, 'لا إصلاح');
  assert.strictEqual(r.after, 'console.log("a) b", "[REDACTED]");');
  assert.strictEqual(r.line, 2);
});

test('[EL-9] وإعادةُ الكتابةِ أغلقت الأشكالَ في اللغاتِ الأخرى كذلك', () => {
  // قياسٌ سابقٌ على التنفيذِ النصّيِّ القديم: ثلاثةٌ من خمسةِ أشكالٍ تسقط في
  // py و ts و java **بالتساوي** — فالعيبُ كان في الأداةِ لا في اللغة. وبعد
  // توحيدِ اللاقطِ صارت تُغلَق كلُّها بالقاعدةِ نفسِها.
  const ctx = loadCtx(true);
  const CASES = [
    ['py  قوسٌ داخل نصّ', 'a.py',  'def f(password):\n    print("a) b", password)\n', 'print("a) b", "[REDACTED]")'],
    ['py  نداءٌ متداخل',  'a.py',  'def f(password, fmt):\n    print(fmt(1, 2), password)\n', 'print(fmt(1, 2), "[REDACTED]")'],
    ['py  نداءان في سطر', 'a.py',  'def f(a, password):\n    print(a); print(password)\n', 'print(a); print("[REDACTED]")'],
    ['ts  قوسٌ داخل نصّ', 'a.ts',  'function f(password: string): void {\n  console.log("a) b", password);\n}\n', 'console.log("a) b", "[REDACTED]");'],
    ['java Log.e مفرد',   'A.java', 'class A {\n  void f(String token) {\n    Log.e(token);\n  }\n}\n', 'Log.e("[REDACTED]");'],
  ];
  for (const [label, file, code, want] of CASES) {
    const lines = code.split('\n');
    const ext = file.split('.').pop();
    const ln = lines.findIndex(l => /print|console|Log\./.test(l)) + 1;
    const r = ctx.fixLogSecret(code, { line: ln, ev: lines[ln - 1].trim() }, lines, ext);
    assert.ok(r, label + ': لا إصلاح');
    assert.strictEqual(r.patch, want, label);
  }

  // وما كان يُنقَّح خطأً لم يَعُد: ‎logging.getLogger‎ تهيئةٌ لا تسجيل،
  // وقاعدةُ ‎logging\.\w+‎ القديمةُ كانت تُنقّح وسيطَها. لا يُنقَل العيب.
  const cfg = 'import logging\ndef f(token):\n    logging.getLogger(token)\n';
  assert.strictEqual(
    ctx.fixLogSecret(cfg, { line: 3, ev: 'logging.getLogger(token)' }, cfg.split('\n'), 'py'),
    null, 'سطرُ تهيئةٍ نُقِّح');
  // ودوالُّ التسجيلِ التسعُ تبقى تعمل
  for (const m of ['info', 'debug', 'warning', 'warn', 'error', 'critical', 'fatal', 'exception', 'log']) {
    const c = 'import logging\ndef f(password):\n    logging.' + m + '(password)\n';
    const r = ctx.fixLogSecret(c, { line: 3, ev: 'logging.' + m + '(password)' }, c.split('\n'), 'py');
    assert.ok(r && r.patch === 'logging.' + m + '("[REDACTED]")', 'logging.' + m + ': ' + (r && r.patch));
  }
});

test('[EL-10] ولا منطقَ تعديلِ نصٍّ داخل المُصلِح — التحريرُ في الطبقةِ وحدَها', () => {
  // الشرطُ البنيويُّ لإعادةِ الكتابة: المُصلِحُ يُحدِّد **ماذا** يُنقَّح،
  // والطبقةُ تُحدِّد **كيف** يُحرَّر. فإن عاد ‎.replace(‎ أو ‎lines[i] =‎ إلى
  // كتلةِ LOG_SECRET فقد عادت الازدواجيةُ التي من أجلها أُعيدت الكتابة.
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'repair_engine.js'), 'utf8');
  const start = src.indexOf('const _LOG_SENSITIVE_WORDS');
  const end = src.indexOf('// ─── Empty Catch');
  assert.ok(start > 0 && end > start, 'tripwire: كتلةُ LOG_SECRET لم تُعثَر');
  const block = src.slice(start, end);

  // ‎.replace(‎ المسموحُ وحدَه: تطبيعُ الاسمِ في ‎_logNameWords‎ و‎.replace(/^\s+/‎
  // لقياسِ الإزاحة — لا استبدالَ في شفرةِ المستخدم.
  const codeEdits = block.split('\n').filter(l =>
    !l.trim().startsWith('//') &&
    (/replaceLineInCode\s*\(/.test(l) || /\blines\s*\[[^\]]*\]\s*=/.test(l) || /\.splice\s*\(/.test(l)));
  assert.deepStrictEqual(codeEdits, [],
    'عاد تعديلُ النصِّ داخل المُصلِح: ' + JSON.stringify(codeEdits));

  // والتحريرُ يمرُّ بالطبقة
  assert.ok(/repairEditApply\s*\(/.test(block), 'المُصلِحُ لا يستعمل طبقةَ التحرير');
  // وتنفيذٌ واحدٌ لا تنفيذان
  assert.ok(!/_logSecretByTree|_redactLoggerSink|_logSplitLiterals|_redactLogArgs/.test(
    block.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')),
    'بقيت بقايا التنفيذِ القديمِ جنبًا إلى جنب');
});
