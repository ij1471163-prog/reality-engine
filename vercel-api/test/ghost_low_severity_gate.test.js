// ═══════════════════════════════════════════════════════
// اختبارات GhostMode.fix(): إصلاح مشاكل l/m فقط يصل إلى البوابة (FixVerifier)
// تشغيل:  node --test vercel-api/test/ghost_low_severity_gate.test.js
//
// verdict() المحلي لا يعطي إصلاح مشاكل l/m فقط أكثر من score 70 (< 75) ولا يغيّر c/h،
// فكان يرجع no_improvement ولا يُعرض المرشّح على البوابة أصلًا (var → let مثلًا).
// الآن: no_improvement مع نقص العدد الكلي يُعرض على البوابة، وFixVerifier يحسم.
// verdict/score/reason لم تتغير؛ totalDown معلومة إضافية فقط.
// ═══════════════════════════════════════════════════════
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadUiContext({ skip = [] } = {}) {
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
    if (!fs.existsSync(p) || skip.includes(m[1])) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة فقط */ }
  }
  return ctx;
}
const ctx = loadUiContext();
const G = ctx.GhostMode;
const fix = (o, n) => G.fix(o, n, 'a.js', ctx.analyzeCode);
const verdict = (o, n) => G.verdict(o, n, 'a.js', ctx.analyzeCode, []);

const GU = 'var GameUtils = (() => {\n  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }\n  return { clamp };\n})();\nconsole.log(GameUtils.clamp(5, 0, 3));\n';
const LET = GU.replace('var GameUtils', 'let GameUtils');

test('var → let only (l/m issues): verdict unchanged, candidate reaches the gate and is applied', () => {
  const v = verdict(GU, LET);
  assert.deepStrictEqual([v.verdict, v.score, v.reason], ['fail', 70, 'no_improvement']);
  assert.strictEqual(v.totalDown, true);
  const r = fix(GU, LET);
  assert.strictEqual(r.code, LET);
  assert.strictEqual(r.gateVerified, true);
  assert.match(String(r.gateReason), /^ACCEPTED/);
});

test('FixVerifier is final: a forced gate rejection keeps the original code', () => {
  const FV = ctx.FixVerifier, orig = FV.verifyFix;
  FV.verifyFix = () => ({ accepted: false, reason: 'FORCED_GATE_REJECT' });
  try {
    const r = fix(GU, LET);
    assert.strictEqual(r.code, GU);
    assert.strictEqual(r.reason, 'no_candidate_passed_gate');
    assert.strictEqual(r.rejectedCandidates[0].reason, 'FORCED_GATE_REJECT');
  } finally { FV.verifyFix = orig; }
});

test('adds a critical issue (eval) → regression, never reaches the gate', () => {
  const bad = LET.replace('console.log(GameUtils.clamp(5, 0, 3));', 'console.log(eval(GameUtils.clamp(5, 0, 3)));');
  assert.strictEqual(verdict(GU, bad).verdict, 'regression');
  const r = fix(GU, bad);
  assert.strictEqual(r.code, GU);
  assert.strictEqual(r.reason, 'no_candidate');
});

test('adds a new LOW issue while the total goes down → rejected by FixVerifier', () => {
  const bad = LET + 'function unusedHelperZ(q) { return q; }\n';
  const v = verdict(GU, bad);
  assert.strictEqual(v.totalDown, true);
  const r = fix(GU, bad);
  assert.strictEqual(r.code, GU);
  assert.strictEqual(r.reason, 'no_candidate_passed_gate');
  assert.match(r.rejectedCandidates[0].reason, /^REJECTED_ISSUES_WORSENED/);
});

test('issue count unchanged → still no_candidate', () => {
  const same = GU.replace('clamp(5, 0, 3)', 'clamp(6, 0, 3)');
  const v = verdict(GU, same);
  assert.strictEqual(v.reason, 'no_improvement');
  assert.strictEqual(v.totalDown, false);
  const r = fix(GU, same);
  assert.strictEqual(r.code, GU);
  assert.strictEqual(r.reason, 'no_candidate');
});

for (const [name, broken] of [['missing brace', LET.replace('return { clamp };', 'return { clamp ;')],
                              ['unbalanced paren', LET.replace('Math.min(hi, v));', 'Math.min(hi, v);')]]) {
  test(`syntax broken (${name}) → syntax_broken, original kept`, () => {
    assert.strictEqual(verdict(GU, broken).reason, 'syntax_broken');
    const r = fix(GU, broken);
    assert.strictEqual(r.code, GU);
    assert.strictEqual(r.reason, 'no_candidate');
  });
}

test('no gate available (fix_verifier.js not loaded) → fail-closed, original code', () => {
  const noGate = loadUiContext({ skip: ['fix_verifier.js'] });
  assert.strictEqual(typeof noGate.FixVerifier, 'undefined');
  const r = noGate.GhostMode.fix(GU, LET, 'a.js', noGate.analyzeCode);
  assert.strictEqual(r.code, GU);
  assert.strictEqual(r.reason, 'verification_unavailable');
  assert.strictEqual(r.gateVerified, false);
});

test('repairCode on the 7 module files: var → let is now applied through the gate', () => {
  for (const f of ['command_injection_fix.js', 'context_analyzer.js', 'deep_flow.js', 'knowledge_base.js',
                   'repair_auth.js', 'smart_context.js', 'type_inference.js']) {
    const code = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
    const out = ctx.repairCode(code, ctx.analyzeCode(code, f), f).repaired;
    const a = code.split('\n'), b = out.split('\n');
    assert.strictEqual(a.length, b.length, f);
    const changed = a.map((l, i) => (l !== b[i] ? [l, b[i]] : null)).filter(Boolean);
    assert.ok(changed.length >= 1, `${f}: something applied`);
    for (const [x, y] of changed) assert.strictEqual(x.replace(/\bvar\b/, 'let'), y, `${f}: only var → let`);
  }
});
