// ═══════════════════════════════════════════════════════
// D1/CallGraph — module IIFE ليست دالة مستقلة
// تشغيل:  node --test vercel-api/test/callgraph_module_iife.test.js
//
// CallGraphAnalyzer._extractFunction يطابق سهم الدالة بـ\(([^)]*)\)\s*=>،
// و[^)]* يبلع "(" الداخلية. فـ"const X = (() => {" (نمط module IIFE) يُسجَّل
// دالةً اسمها X، ثم _detectUnusedFunctions يبحث عن \bX\s*\( فلا يجده —
// الاستدعاءات كلها X.method( — فيبلّغ "X() معرّفة لكن لا تُستدعى".
//
// الأثر ليس بلاغًا زائفًا فقط: فرع السهم يطابق (?:const|let) ولا يطابق var.
// فتحويل var → let (إصلاح صحيح وشائع) يُنشئ مشكلة callgraph جديدة، فيرى
// FixVerifier ISSUES_WORSENED ويرفض GhostMode كل إصلاحات الملف — إصلاحات
// سليمة تُلغى بسبب خطأ في الـCallGraph، لا بسبب خطأ فيها.
//
// الثابت المحمي هنا: إعادة كتابة var → let لا يجوز أن تضيف أي مشكلة.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadDeep() {
  const noop = () => {};
  const ctx = vm.createContext({
    console: { log: noop, warn: noop, error: noop, info: noop },
    window: {}, global: {},
  });
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'deep_analyzer.js'), 'utf8'),
    ctx, { filename: 'deep_analyzer.js' });
  return ctx;
}

const ctx = loadDeep();

// ── عيّنة module IIFE واقعية، الكلمة المفتاحية متغيّرة ──
const moduleIIFE = kw => `${kw} GameServer = (() => {
  const rooms = {};
  function addRoom(id) { rooms[id] = []; }
  return { addRoom };
})();
GameServer.addRoom('a');
`;

// deepAnalyze يُرجع مصفوفة من realm الـVM — تُنقل إلى realm المضيف قبل
// أي deepStrictEqual، وإلا فشلت المقارنة على اختلاف الـprototype وحده.
const allIssues = code => Array.from(ctx.deepAnalyze(code, 'srv.js') || []);
const cgIssues  = code => allIssues(code).filter(i => i.type === 'callgraph');
const idOf      = i => `${i.type}|${i.cAct}|${i.ev}`;
const identities = code => allIssues(code).map(idOf).sort();

// class في سياق VM ليست خاصية على الـglobal — يُبنى الكائن داخل السياق
// ويُعاد بيانًا عاديًا عبر حدود الـrealm.
const _registered = vm.runInContext(
  '(code) => { const cg = new CallGraphAnalyzer(); cg.analyze(code);' +
  '  const o = {}; cg.functions.forEach((v, k) => { o[k] = v.params; }); return JSON.stringify(o); }',
  ctx);
function registered(code) {
  const map = JSON.parse(_registered(code));
  return { has: n => Object.prototype.hasOwnProperty.call(map, n),
           get: n => ({ params: map[n] }),
           keys: () => Object.keys(map) };
}

// ═══ أ. التسجيل: module IIFE ليست دالة ═══════════════════

for (const kw of ['const', 'let', 'var']) {
  test(`callgraph: \`${kw} X = (() => {…})()\` لا يُسجَّل كدالة مستقلة`, () => {
    const fns = registered(moduleIIFE(kw));
    assert.strictEqual(fns.has('GameServer'), false,
      'module IIFE ليست دالة مستقلة — تسجيلها يولّد بلاغات زائفة. ' +
      'المُسجَّل: ' + JSON.stringify(fns.keys()));
  });
}

test('callgraph: الدالة الداخلية الحقيقية تبقى مُسجَّلة', () => {
  const fns = registered(moduleIIFE('const'));
  assert.ok(fns.has('addRoom'), 'addRoom دالة حقيقية ويجب أن تبقى مُسجَّلة');
});

// ═══ ب. لا false positive "معرّفة لكن لا تُستدعى" ═══════

for (const kw of ['const', 'let', 'var']) {
  test(`callgraph: \`${kw}\` module IIFE لا يُبلَّغ عنها كـ"لا تُستدعى"`, () => {
    const bad = cgIssues(moduleIIFE(kw)).filter(i => i.ev === 'GameServer');
    assert.deepStrictEqual(bad.map(i => i.title), [],
      'GameServer تُستدعى كـGameServer.addRoom() — البلاغ زائف');
  });
}

// أشكال IIFE أخرى يبلعها [^)]*
const IIFE_SHAPES = [
  ['IIFE على سطر واحد',        `const Mod = (() => { return { a: 1 }; })();\nMod.a;\n`],
  ['IIFE async',               `const Mod = (async () => { return {}; })();\nMod.then(r => r);\n`],
  ['IIFE بمعامل داخلي',        `const Mod = ((dep) => ({ dep }))(window);\nMod.dep;\n`],
  ['IIFE بنمط function',       `const Mod = (function () { return {}; })();\nMod.x;\n`],
];

for (const [label, code] of IIFE_SHAPES) {
  test(`callgraph: ${label} لا يُسجَّل ولا يُبلَّغ عنه`, () => {
    assert.strictEqual(registered(code).has('Mod'), false,
      label + ': سُجِّل كدالة. المُسجَّل: ' + JSON.stringify(registered(code).keys()));
    assert.deepStrictEqual(cgIssues(code).filter(i => i.ev === 'Mod').map(i => i.title), [], label);
  });
}

// ═══ ج. var → let لا يضيف أي مشكلة ══════════════════════
// هذا هو الثابت الذي يحمي الإصلاحات من الإلغاء.

test('invariant: var → let لا يضيف مشكلة callgraph (module IIFE)', () => {
  const asVar = cgIssues(moduleIIFE('var')).map(idOf).sort();
  const asLet = cgIssues(moduleIIFE('let')).map(idOf).sort();
  assert.deepStrictEqual(asLet, asVar,
    'إعادة كتابة var → let أضافت مشكلة callgraph، فيراها FixVerifier ' +
    'ISSUES_WORSENED ويُلغي كل إصلاحات الملف.\n' +
    '      var: ' + JSON.stringify(asVar) + '\n      let: ' + JSON.stringify(asLet));
});

test('invariant: var → let لا يضيف أي مشكلة على كل مستويات deepAnalyze', () => {
  const asVar = identities(moduleIIFE('var'));
  const asLet = identities(moduleIIFE('let'));
  const added = asLet.filter(x => !asVar.includes(x));
  assert.deepStrictEqual(added, [], 'مشاكل ظهرت بعد var → let: ' + JSON.stringify(added));
});

test('invariant: var → const كذلك لا يضيف مشكلة', () => {
  const added = identities(moduleIIFE('const')).filter(x => !identities(moduleIIFE('var')).includes(x));
  assert.deepStrictEqual(added, [], JSON.stringify(added));
});

test('invariant: ملف فيه عدة module IIFE — var → let يبقى محايدًا', () => {
  const mk = kw => `${kw} A = (() => ({ f: 1 }))();\n${kw} B = (() => ({ g: 2 }))();\nA.f; B.g;\n`;
  assert.deepStrictEqual(identities(mk('let')), identities(mk('var')),
    'ملف بعدة module IIFE: var → let غيّر المشاكل');
});

// ═══ د. لا نخسر الكشف القائم ════════════════════════════
// التضييق يجب أن يمسّ الأقواس المتداخلة فقط.

test('regression: سهم عادي بمعاملات ما زال يُسجَّل', () => {
  const fns = registered(`const tally = (a, b) => a + b;\n`);
  assert.ok(fns.has('tally'), 'سهم عادي يجب أن يبقى مُسجَّلًا');
  assert.deepStrictEqual(fns.get('tally').params, ['a', 'b']);
});

test('regression: سهم بلا معاملات ما زال يُسجَّل', () => {
  assert.ok(registered(`const tally = () => 1;\n`).has('tally'));
});

test('regression: سهم async ما زال يُسجَّل', () => {
  const fns = registered(`const tally = async (x) => x;\n`);
  assert.ok(fns.has('tally'));
  assert.deepStrictEqual(fns.get('tally').params, ['x']);
});

test('regression: function declaration ما زالت تُسجَّل', () => {
  assert.ok(registered(`function tally(a) { return a; }\n`).has('tally'));
});

test('regression: const f = function () ما زالت تُسجَّل', () => {
  assert.ok(registered(`const tally = function (a) { return a; };\n`).has('tally'));
});

test('regression: سهم غير مستدعى ما زال يُبلَّغ عنه', () => {
  const bad = cgIssues(`const tally = (a, b) => a + b;\n`).filter(i => i.ev === 'tally');
  assert.ok(bad.length >= 1, 'كشف الدالة غير المستدعاة لا يجوز أن يُفقد');
});

test('regression: قائمة معاملات طويلة ما زالت تُبلَّغ', () => {
  const long = cgIssues(`const tally = (a, b, c, d, e) => a;\n`)
    .filter(i => i.ev === 'tally' && /parameters/.test(i.title));
  assert.ok(long.length >= 1, 'كشف قائمة المعاملات الطويلة لا يجوز أن يُفقد');
});
