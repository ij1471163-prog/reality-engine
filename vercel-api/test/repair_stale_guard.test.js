// ═══════════════════════════════════════════════════════
// اختبارات حارس "السطر القديم" في repairCode (repair_engine.js)
// تشغيل:  node --test vercel-api/test/repair_stale_guard.test.js
//
// الحارس يُسقط مشكلة إذا لم يطابق دليلها (ev) السطر. هذا صحيح للمشاكل القديمة،
// لكنه كان يُسقط أيضًا:
//   1. AST evidence (ast-engine.js): "total = MemberExpression" ليس نص السطر.
//   2. دليل تغيّر لأن إصلاحًا سابقًا في نفس التشغيل عدّل نفس السطر.
// ويجب ألا يُعاد إصلاح نفس المشكلة مرتين، وألا يُربط دليل بسطر آخر.
// لتشغيل حالة GameServer على الملف الحقيقي بدون إضافته للمستودع:
//   CLAUDE_REPAIR_FIXTURE=/path/to/GameServer.js node --test ...
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// نفس المحركات التي تحمّلها الواجهة (index.html)
function loadUiContext({ ghost = false } = {}) {
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
  // GhostMode في آخر repairCode قد يلغي تعديلًا منفردًا — نعزل الحارس عنه هنا.
  if (!ghost) ctx.GhostMode = undefined;
  return ctx;
}

const ctx = loadUiContext();
const repair = (code, issues, file = 'a.js') => ctx.repairCode(code, issues || ctx.analyzeCode(code, file), file);
const countOf = (r, strategy, line) => r.repairs.filter(x => x.strategy === strategy && (line == null || x.line === line)).length;

// ═══ 1. AST evidence ═════════════════════════════════════
const LOOP = 'let total = 0;\nfor (const p of ps) {\n  total = p.score;\n}\nconsole.log(total);\n';

test('AST evidence: accumulation "total = MemberExpression" is repaired (was dropped as stale)', () => {
  const acc = ctx.analyzeCode(LOOP, 'a.js').find(i => ctx.detectStrategy(i, 'js') === 'ACCUMULATION');
  assert.ok(acc && acc.astVerified === true, 'fixture: analyzer reports an AST-verified accumulation');
  assert.equal(acc.ev, 'total = MemberExpression');
  const r = repair(LOOP, [acc]);
  assert.equal(r.repaired.split('\n')[2], '  total += p.score;');
  assert.equal(countOf(r, 'ACCUMULATION'), 1);
});

test('AST evidence that does not match the original line is still dropped (stale)', () => {
  const stale = { line: 3, sev: 'c', type: 'bug', title: 'خطأ تراكم مؤكد: other = بدل += (AST ✓)', ev: 'other = MemberExpression', astVerified: true };
  const r = repair(LOOP, [stale]);
  assert.equal(r.repaired, LOOP);
  const already = LOOP.replace('total = p.score', 'total += p.score');
  const r2 = repair(already, [{ ...stale, ev: 'total = MemberExpression', title: 'خطأ تراكم مؤكد: total = بدل += (AST ✓)' }]);
  assert.equal(r2.repaired, already, '"total +=" is not "total =" — no double +=');
});

test('AST evidence of an unknown form is not guessed (dropped)', () => {
  const odd = { line: 3, sev: 'c', type: 'bug', title: 'خطأ تراكم مؤكد: total = بدل += (AST ✓)', ev: 'AssignmentExpression@3', astVerified: true };
  assert.equal(repair(LOOP, [odd]).repaired, LOOP);
});

test('non-AST evidence that is not literally in the line is still treated as stale', () => {
  const noFlag = { line: 3, sev: 'c', type: 'bug', title: 'خطأ تراكم مؤكد: total = بدل += (AST ✓)', ev: 'total = MemberExpression' };
  assert.equal(repair(LOOP, [noFlag]).repaired, LOOP, 'only astVerified issues get the AST treatment');
});

// ═══ 2. دليل تغيّر بسبب إصلاح سابق على نفس السطر ═════════
const SAME = 'function h(a, b) {\n  var ok = a == b;\n  return ok;\n}\nh(1, 2);\n';

test('same line: "==" fixed first no longer drops the "var" fix (both applied, once each)', () => {
  const iss = ctx.analyzeCode(SAME, 'a.js');
  const eq = iss.filter(i => ctx.detectStrategy(i, 'js') === 'LOOSE_EQUALITY');
  const vr = iss.filter(i => ctx.detectStrategy(i, 'js') === 'VAR_USAGE');
  for (const order of [[...eq, ...vr], [...vr, ...eq]]) {
    const r = repair(SAME, order);
    assert.equal(r.repaired.split('\n')[1], '  let ok = a === b;');
    assert.equal(countOf(r, 'VAR_USAGE'), 1, 'var fixed once');
    assert.equal(countOf(r, 'LOOSE_EQUALITY'), 1, '== fixed once');
  }
});

// ═══ 3. لا إعادة معالجة ولا ربط بمشكلة أخرى ═══════════════
test('duplicate issues of the same problem on one line are applied once', () => {
  const r = repair(SAME);
  assert.equal(countOf(r, 'VAR_USAGE', 2), 1);
  const secret = 'const API_SECRET = "sk_live_abc123xyz789def456ghi";\nmodule.exports = API_SECRET;\n';
  const one = ctx.analyzeCode(secret, 'a.js').filter(i => i.line === 1);
  const groups = one.map(i => ctx.detectStrategy(i, 'js'));
  assert.ok(groups.includes('HARDCODED_SECRET') && groups.includes('HARDCODED_PASS'), 'fixture: two strategies for one secret');
  const rs = repair(secret, one);
  const single = repair(secret, one.filter(i => ctx.detectStrategy(i, 'js') === 'HARDCODED_SECRET'));
  assert.equal(rs.repaired, single.repaired, 'the second secret strategy does not re-process the same line');
  assert.equal(rs.repairs.filter(x => x.line === 1).length, 1);
});

test('evidence is not bound to another identical line', () => {
  const code = 'function a(x) {\n  if (x == 1) { return 1; }\n  return 0;\n}\nfunction b(x) {\n  if (x == 1) { return 1; }\n  return 0;\n}\na(1); b(1);\n';
  const onlyLine6 = ctx.analyzeCode(code, 'a.js').filter(i => i.line === 6 && ctx.detectStrategy(i, 'js') === 'LOOSE_EQUALITY');
  const r = repair(code, onlyLine6);
  assert.equal(r.repaired.split('\n')[1], '  if (x == 1) { return 1; }', 'line 2 untouched');
  assert.equal(r.repaired.split('\n')[5], '  if (x === 1) { return 1; }');
});

// ═══ 4. السلوك العادي للحارس لم يتغير ═════════════════════
test('normal literal evidence still repairs; stale literal evidence is still dropped', () => {
  const code = 'function g(a) {\n  if (a == "x") { return 1; }\n  return 0;\n}\ng(1);\n';
  assert.equal(repair(code).repaired.split('\n')[1], '  if (a === "x") { return 1; }');
  const fixed = code.replace('==', '===');
  const stale = { line: 2, sev: 'l', title: 'استخدم ===', ev: 'if (a == "x") { return 1; }' };
  const r = repair(fixed, [stale]);
  assert.equal(r.repaired, fixed);
  assert.equal(r.repairs.length, 0);
});

// ═══ 5. Step 1 (SQL) لم يتأثر ═════════════════════════════
test('Step 1 unchanged: a broken SQL candidate is still rejected and the SQL line is kept', () => {
  const code = [
    'function loginPlayer(username, password) {',
    '    var query = "SELECT * FROM players WHERE username=\'" + username + "\' AND password=\'" + password + "\'";',
    '    db.execute(query);',
    '}',
    'loginPlayer("a", "b");',
    '',
  ].join('\n');
  const r = repair(code);
  assert.ok(r.repaired.split('\n')[1].includes('"SELECT * FROM players WHERE username=\'" + username'));
  assert.ok(!/'\?|\/\/ use: db\.query/.test(r.repaired));
  assert.ok(r.rejected.some(x => x.strategy === 'SQL_INJECTION'));
});

// ═══ 6. GameServer.js الحقيقي (اختياري، خارج المستودع) ════
if (process.env.CLAUDE_REPAIR_FIXTURE) {
  const GS = fs.readFileSync(process.env.CLAUDE_REPAIR_FIXTURE, 'utf8');
  test('GameServer.js fixture (with GhostMode, as ⚡): line 23 becomes "+=", every fix applied once, file approved', () => {
    const g = loadUiContext({ ghost: true });
    const r = g.repairCode(GS, g.analyzeCode(GS, 'GameServer.js'), 'GameServer.js');
    assert.equal(r.repaired.split('\n')[22].trim(), 'totalScore += p.score;');
    const keys = r.repairs.map(x => x.line + ':' + x.strategy);
    assert.equal(new Set(keys).size, keys.length, 'no fix recorded twice: ' + keys.join(', '));
    const v = g.FixVerifier.verifyFix(GS, r.repaired, 'GameServer.js', g.analyzeCode, {});
    assert.equal(v.accepted, true, v.reason);
  });
}
