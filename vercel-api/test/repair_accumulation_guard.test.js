// ═══════════════════════════════════════════════════════
// اختبارات fixAccumulation (repair_engine.js)
// تشغيل:  node --test vercel-api/test/repair_accumulation_guard.test.js
//
// كان الإصلاح يستبدل أول "كلمة =" في السطر بـ "+=" بغض النظر عن المتغير المبلَّغ عنه:
//   { inLoop = false; loopDepth = 0; }  (البلاغ عن loopDepth) → inLoop += false
//   for (let i = 0; ...)                                      → for (let i += 0; ...)
// ويحوّل إعادة التهيئة (depth = 0) وقفزة المؤشر (i = stop) إلى تراكم.
// الآن: يُعدَّل إسناد المتغير المذكور في العنوان فقط، مرة واحدة في السطر، وليس
// تعريفًا ولا مقارنة ولا خاصية ولا رأس for، وليس قيمة ثابتة، وليس مؤشرًا/فهرسًا.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const acorn = require('../public/acorn.min.js');

function loadUiContext() {
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => null, addEventListener: noop, createElement: () => ({}), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: noop }, navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة فقط */ }
  }
  // GhostMode يرفض الملف كله عند أي تدهور — نختبر الـfixer نفسه بمعزل عنه.
  ctx.GhostMode = undefined;
  return ctx;
}

const ctx = loadUiContext();
const title = v => `خطأ تراكم مؤكد: ${v} = بدل += (AST ✓)`;
const fixLine = (code, line, v, file = 'a.js') =>
  ctx.repairCode(code, [{ line, sev: 'c', type: 'bug', title: title(v) }], file).repaired.split('\n')[line - 1];
const lineOf = (code, n) => code.split('\n')[n - 1];
const parses = code => { acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); return true; };

// ═══ 1. الحالات الصحيحة ما زالت تُصلح ═══════════════════
const FIX = {
  'JS for..of':        ['let total = 0;\nfor (const p of ps) {\n  total = p.score;\n}\n', 3, 'total', 'a.js', '  total += p.score;'],
  'JS forEach inline': ['let sum = 0;\nitems.forEach(it => { sum = it.price; });\n', 2, 'sum', 'a.js', 'items.forEach(it => { sum += it.price; });'],
  'Python':            ['total = 0\nfor r in rows:\n    total = r["amount"]\n', 3, 'total', 'a.py', '    total += r["amount"]'],
  'PHP':               ['<?php\n$total = 0;\nforeach ($rows as $r) {\n  $total = $r["x"];\n}\n', 4, '$total', 'a.php', '  $total += $r["x"];'],
  'RHS is a plain variable that is not an index': ['let total = 0;\nfor (const p of ps) {\n  const amount = p.a;\n  total = amount;\n}\n', 4, 'total', 'a.js', '  total += amount;'],
  'inside a comparison guard that does not track the target':
                       ['let total = 0;\nfor (const p of ps) {\n  if (p.score > 0) total = p.score;\n}\n', 3, 'total', 'a.js', '  if (p.score > 0) total += p.score;'],
  'target is not the first assignment on the line':
                       ['let total = 0;\nfor (const p of ps) {\n  if (p) { seen = true; total = p.score; }\n}\n', 3, 'total', 'a.js', '  if (p) { seen = true; total += p.score; }'],
};
for (const [name, [code, line, v, file, expected]] of Object.entries(FIX)) {
  test(`fixes accumulation: ${name}`, () => {
    assert.strictEqual(fixLine(code, line, v, file), expected);
  });
}

test('analyzer → repairCode: the GameServer-like accumulation is still fixed', () => {
  const code = 'let totalScore = 0;\nfunction sumScores(ps) {\n  for (const p of ps) {\n    totalScore = p.score;\n  }\n  return totalScore;\n}\nsumScores([]);\n';
  const acc = ctx.analyzeCode(code, 'a.js').filter(i => ctx.detectStrategy(i, 'js') === 'ACCUMULATION');
  assert.ok(acc.length >= 1, 'fixture: analyzer reports the accumulation');
  const out = ctx.repairCode(code, acc, 'a.js').repaired;
  assert.strictEqual(lineOf(out, 4), '    totalScore += p.score;');
  assert.ok(parses(out));
});

// ═══ 2. ما لا يجب أن يتغير ═════════════════════════════
const KEEP = {
  'for (let i = 0 ...) header':           ['let i = 0;\nfor (let i = 0; i < n; i++) {\n}\n', 2, 'i'],
  'for (i = 0 ...) header':               ['let i = 0;\nwhile (a) {\n  for (i = 0; i < n; i++) {}\n}\n', 3, 'i'],
  'other variable first (inLoop = false)': ['let loopDepth = 0, inLoop = false;\nwhile (x) {\n  if (loopDepth <= 0) { inLoop = false; loopDepth = 0; }\n}\n', 3, 'loopDepth'],
  'reset to a literal (depth = 0)':       ['let depth = 0;\nfor (const c of cs) {\n  depth = 0;\n}\n', 3, 'depth'],
  'reset to false':                       ['let inLoop = 0;\nwhile (x) {\n  inLoop = false;\n}\n', 3, 'inLoop'],
  'cursor jump (i = stop)':               ['let i = 0;\nwhile (i < s.length) {\n  const stop = find(s, i);\n  if (s[i] === "x") i++;\n  i = stop;\n}\n', 5, 'i'],
  'cursor jump (i = j + 2)':              ['let i = 0;\nwhile (i < s.length) {\n  if (s[i] !== "/") continue;\n  const j = s.indexOf("*/", i);\n  i = j + 2;\n}\n', 5, 'i'],
  'declaration (let total = ...)':        ['let total = 0;\nfor (const p of ps) {\n  let total = p.score;\n}\n', 3, 'total'],
  'comparison (total == ...)':            ['let total = 0;\nfor (const p of ps) {\n  if (total == p.score) f();\n}\n', 3, 'total'],
  'property (obj.total = ...)':           ['let total = 0;\nfor (const p of ps) {\n  obj.total = p.score;\n}\n', 3, 'total'],
  'target twice on the line':             ['let t = 0;\nfor (const p of ps) {\n  t = p.a; t = p.b;\n}\n', 3, 't'],
  'variable not on the line':             ['let total = 0;\nfor (const p of ps) {\n  other = p.score;\n}\n', 3, 'total'],
  'RHS already uses the variable (hash)':  ['let h = 0;\nfor (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;\n', 2, 'h'],
  'RHS already uses the variable (max)':   ['let d = 0;\nwhile (x) {\n  d = Math.max(0, d - 1);\n}\n', 3, 'd'],
  'max tracking: best = cur':              ['let best = 0, bestLine = 0;\nlines.forEach((l, i) => {\n  const cur = l.length;\n  if (cur > best) {\n    best = cur;\n    bestLine = i + 1;\n  }\n});\n', 5, 'best'],
  'max tracking: bestLine = i + 1':        ['let best = 0, bestLine = 0;\nlines.forEach((l, i) => {\n  const cur = l.length;\n  if (cur > best) {\n    best = cur;\n    bestLine = i + 1;\n  }\n});\n', 6, 'bestLine'],
  'reset through a literal ternary':       ['let braceDepth = 0;\nfor (const l of ls) {\n  braceDepth = ext === "py" ? 1 : 0;\n}\n', 3, 'braceDepth'],
  'position of a loop index (start = i + 1)': ['let start = 0;\nfor (let i = 0; i < n; i++) {\n  if (!stack.length) start = i + 1;\n}\n', 3, 'start'],
  'Python keyword argument f(total=...)': ['total = 0\nfor r in rows:\n    send(total=r["x"])\n', 3, 'total', 'a.py'],
};
for (const [name, [code, line, v, file]] of Object.entries(KEEP)) {
  test(`does not change: ${name}`, () => {
    const out = fixLine(code, line, v, file);
    assert.strictEqual(out, lineOf(code, line));
    assert.doesNotMatch(out, /\+=/);
  });
}

test('does not change: issue title without a variable name', () => {
  const code = 'let t = 0;\nfor (;;) { t = a.b; }\n';
  const r = ctx.repairCode(code, [{ line: 2, sev: 'c', type: 'bug', title: 'استخدم += هنا' }], 'a.js');
  assert.strictEqual(r.repaired, code);
});

// ═══ 3. الملفات الحقيقية: لا تراكم مزيّف ولا syntax مكسور ═══
const REAL = ['command_injection_fix.js', 'repair_auth.js', 'deep_flow.js', 'accumulation_detector.js',
  'engine_java.js', 'learning_engine.js', 'ml_pattern_finder.js', 'server_engine_registration.js',
  'analyzer.js', 'code_intelligence.js'];
for (const file of REAL) {
  test(`real file ${file}: accumulation issues produce no "+=" edit and the output parses`, () => {
    const code = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    const acc = ctx.analyzeCode(code, file).filter(i => ctx.detectStrategy(i, 'js') === 'ACCUMULATION');
    assert.ok(acc.length >= 1, 'fixture: analyzer reports accumulation on this file');
    const r = ctx.repairCode(code, acc, file);
    assert.strictEqual(r.repairs.filter(x => x.strategy === 'ACCUMULATION').length, 0);
    assert.strictEqual(r.repaired, code);
    assert.ok(parses(r.repaired));
  });
}
