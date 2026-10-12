// ═══════════════════════════════════════════════════════
// [SILENT-DROP] «نُودي المُصلِحُ ولم يُنتج شيئًا» يجب أن يُقرأ
// ═══════════════════════════════════════════════════════
//
// المخرجُ عند ‎!result || result.fixed === repairedCode‎ في ‎repairCode‎ كان
// يُرجع بلا أثر: لا ‎rejected‎ ولا ‎aiNeeded‎ إلا إذا كان
// ‎issue.aiRequired === true‎ — وأكثرُ الكاشفاتِ لا تضعه. فبلاغٌ مكتشَفٌ
// ومُوجَّهٌ إلى استراتيجيةٍ صحيحةٍ يختفي تمامًا حين يكون نمطُ المُصلِحِ
// أضيقَ من نمطِ الكاشف.
//
// وهذا بعينه ما خبّأ ‎[LOG-SINK]‎ (‎log.info(password)‎: سبعةُ أشكالٍ من
// سبعة، ولا اختبارٌ واحدٌ يسقط). فالقناةُ ‎out.dropped‎ تشخيصيةٌ محضة:
// لا تدخل ‎summary‎ ولا تغيّر قرارَ قبولٍ أو رفض.
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
  return ctx;
}
const repair = (ctx, code, file) => {
  const iss = ctx.analyzeCode(code, file) || [];
  return { iss, out: ctx.repairCode(code, iss.map(x => Object.assign({}, x)), file) };
};

test('[SD-1] فجوةُ قدرةٍ مُقاسةٌ تظهر في ‎dropped‎ بالاسمِ والسطرِ والسبب', () => {
  // ‎fixEmptyFunction‎ يشترط ‎{}‎ في سطرٍ واحد (‎if (!line.includes("{}")) return null‎)،
  // والكاشفُ يُبلّغ عن الشكلَين. فهذه فجوةُ قدرةٍ قائمةٌ لم تُوسَّع في هذه
  // الجولة عن قصد: حشوُ جسمٍ فارغٍ بـ‎return null‎ يغيّر قيمةَ الإرجاع من
  // ‎undefined‎ إلى ‎null‎ — تغييرُ سلوكٍ لا إصلاحُ عيب. لكنها تُقرأ الآن.
  const ctx = loadCtx();
  const { out } = repair(ctx, 'function todo() {\n}\nfunction alsoTodo(a, b) {\n}\n', 'emptyFn.js');
  assert.ok(Array.isArray(out.dropped), 'حقلُ dropped غائب');
  const ef = out.dropped.filter(d => d.strategy === 'EMPTY_FUNCTION');
  assert.strictEqual(ef.length, 2, 'عددُ الفجواتِ المُقاسة: ' + JSON.stringify(out.dropped));
  for (const d of ef) {
    assert.strictEqual(d.kind, 'FIXER_NO_CHANGE', d.kind);
    assert.strictEqual(d.fixer, 'fixEmptyFunction', d.fixer);
    assert.ok(d.line > 0 && d.ev.includes('function'), JSON.stringify(d));
    assert.ok(String(d.reason).length > 10, 'سببٌ بلا نصّ');
  }
});

test('[SD-2] بلاغُ كاشفٍ غيرِ محصورٍ بحدِّ كلمةٍ يُقرأ ولا يُصلَح', () => {
  // ‎scanSecurity‎ نمطُه ‎/Log\./i‎ فيُطابق ‎dialog.‎ — بلاغٌ قائمٌ لا يصحّ
  // إصلاحُه تلقائيًّا. والمطلوبُ أن يُقرأ أنه لم يُصلَح، لا أن يُصلَح.
  const ctx = loadCtx();
  const { iss, out } = repair(ctx, 'function f(password) {\n  dialog.show(password);\n}\n', 'dialog.js');
  assert.ok(iss.length > 0, 'tripwire: لا بلاغَ على dialog.show');
  assert.ok(!/\[REDACTED\]/.test(out.repaired), 'نداءٌ وظيفيٌّ نُقِّح');
  assert.ok(out.dropped.some(d => d.strategy === 'LOG_SECRET' && d.fixer === 'fixLogSecret'),
    'الإسقاطُ لم يُسجَّل: ' + JSON.stringify(out.dropped));
});

test('[SD-3] ولا يُسجَّل إسقاطٌ حين يُصلِح المُصلِحُ فعلًا', () => {
  const ctx = loadCtx();
  const OK = [
    ['okLog.js',   'function f(password) {\n  console.log(password);\n}\n'],
    ['sinkJs.js',  'function f(password) {\n  log.info(password);\n}\n'],
    ['okHttp.js',  'function f() {\n  return fetch("http://a.example.com/x");\n}\n'],
    ['okPy.py',    'import logging\ndef f(secret):\n    logging.info(secret)\n'],
  ];
  for (const [file, code] of OK) {
    const { out } = repair(ctx, code, file);
    assert.ok((out.repairs || []).length > 0, 'tripwire: لم يُصلَح ' + file);
    assert.strictEqual(out.dropped.length, 0,
      'إسقاطٌ مُسجَّلٌ على ملفٍ أُصلح (' + file + '): ' + JSON.stringify(out.dropped));
  }
});

test('[SD-4] والقناةُ تشخيصيةٌ محضة — ‎summary‎ و‎score‎ لا يتغيّران', () => {
  // هذا هو الحدُّ: لو دخل الإسقاطُ العدَّ لتغيّرت تقاريرٌ وقراراتٌ قائمة.
  const ctx = loadCtx();
  const { iss, out } = repair(ctx, 'function todo() {\n}\nfunction alsoTodo(a, b) {\n}\n', 'emptyFn.js');
  assert.ok(out.dropped.length > 0, 'tripwire: لا إسقاطَ لنقيسه');
  assert.strictEqual(out.summary.total, iss.length);
  assert.strictEqual(out.summary.fixed, (out.repairs || []).length);
  assert.strictEqual(out.summary.needsAI, (out.aiNeeded || []).length);
  assert.strictEqual(out.summary.score,
    Math.round(((out.repairs || []).length / Math.max(iss.length, 1)) * 100));
  // ولا يُحتسب الإسقاطُ رفضًا
  assert.strictEqual((out.rejected || []).length, 0, 'الإسقاطُ دخل rejected');
});

// ‎STRATEGIES‎ يحمل مراجعَ الدوالِّ وقتَ التعريف، فإعادةُ تعريفِ الاسمِ
// العامِّ لا تصل إليه. فالحقنُ في نصِّ الوحدةِ نفسِها — وهي الطريقةُ
// المستعملةُ في ‎engine_self_diagnosis_e2e‎ لنفسِ السبب.
function loadCtxWithThrowingFixer(fnName) {
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
    const rel = m[1], file = path.join(PUBLIC_DIR, rel);
    if (!fs.existsSync(file)) continue;
    let src = fs.readFileSync(file, 'utf8');
    if (rel === 'repair_engine.js') {
      const anchor = 'function ' + fnName + '(code, issue, lines, ext) {';
      assert.ok(src.includes(anchor), 'مرساةُ الحقن مفقودة: ' + anchor);
      src = src.replace(anchor, anchor + "\n  throw new Error('اختبارٌ: المُصلِحُ تعطّل');");
    }
    try { vm.runInContext(src, ctx, { filename: rel }); } catch (e) { /* ملف واجهة */ }
  }
  return ctx;
}

test('[SD-5] ورميُ المُصلِحِ يُسجَّل ولا يُسقط بقيةَ الإصلاحات', () => {
  const code = 'function f(password) {\n  console.log(password);\n  var n = 1;\n  return n;\n}\n';

  // ① الحالُ السليم: المُصلِحان يعملان ولا إسقاط
  const ok = repair(loadCtx(), code, 'a.js');
  assert.ok(ok.out.repairs.some(r => r.strategy === 'LOG_SECRET'), 'tripwire: LOG_SECRET لا يعمل');
  assert.ok(ok.out.repairs.some(r => r.strategy === 'VAR_USAGE'), 'tripwire: VAR_USAGE لا يعمل');
  assert.strictEqual(ok.out.dropped.length, 0);

  // ② ومع مُصلِحٍ يرمي: الرميُ مقروءٌ، وبقيةُ الإصلاحاتِ تمضي
  const boom = loadCtxWithThrowingFixer('fixLogSecret');
  const { out } = repair(boom, code, 'a.js');
  const threw = (out.dropped || []).filter(d => d.kind === 'FIXER_THREW');
  assert.ok(threw.length > 0, 'رميُ المُصلِحِ اختفى صامتًا: ' + JSON.stringify(out.dropped));
  assert.strictEqual(threw[0].strategy, 'LOG_SECRET', threw[0].strategy);
  assert.strictEqual(threw[0].fixer, 'fixLogSecret', threw[0].fixer);
  assert.ok(/تعطّل/.test(threw[0].reason), 'السببُ لا يُنقَل: ' + threw[0].reason);
  assert.ok((out.repairs || []).some(r => r.strategy === 'VAR_USAGE'),
    'تعطُّلُ مُصلِحٍ أسقط غيرَه — العزلُ هو الغرضُ الأوّل');
  assert.ok(!/\[REDACTED\]/.test(out.repaired), 'نُقِّح السطرُ مع أن مُصلِحَه رمى');
});
