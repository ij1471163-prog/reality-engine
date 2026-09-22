// ═══════════════════════════════════════════════════════
// اختبارات claude_repair_engine.js — Phase 1: stop_reason + كل كتل النص
// تشغيل:  node --test vercel-api/test/claude_repair_rca.test.js
//
// عند بلوغ max_tokens يعيد Claude API نصًا مقطوعًا مع HTTP 200 و
// stop_reason="max_tokens" — بلا أي خطأ. يجب ألا يُعامل هذا الرد ككود.
// لتشغيل نفس الحالات على ملف خارجي بدون إضافته للمستودع:
//   CLAUDE_REPAIR_FIXTURE=/path/to/GameServer.js node --test ...
// Claude API مُحاكى بالكامل (بلا شبكة).
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test_dummy_key_12345';
const ClaudeRepairEngine = require('../public/claude_repair_engine.js');
const { Status } = ClaudeRepairEngine;

const INLINE_FIXTURE = [
  '// Game Server — test fixture',
  'function loginPlayer(username, password) {',
  '    if (username == "admin") {',
  '        grantAdminAccess();',
  '    }',
  '}',
  '',
  ...Array.from({ length: 14 }, (_, i) => `function helper${i}(x) { return x + ${i}; }`),
  '',
].join('\n');

const fixtures = [['inline fixture', INLINE_FIXTURE]];
if (process.env.CLAUDE_REPAIR_FIXTURE) {
  fixtures.push([process.env.CLAUDE_REPAIR_FIXTURE, fs.readFileSync(process.env.CLAUDE_REPAIR_FIXTURE, 'utf8')]);
}

// محاكاة Messages API: content = كتل، stop_reason اختياري (غيابه = mocks قديمة)
function mockApi(content, stopReason, outputTokens) {
  const body = { model: 'mock', content };
  if (stopReason !== undefined) body.stop_reason = stopReason;
  if (outputTokens !== undefined) body.usage = { output_tokens: outputTokens };
  return async () => ({ ok: true, status: 200, json: async () => body });
}
const textBlock = text => ({ type: 'text', text });
const fenced = body => '```js\n' + body + '\n```';

for (const [label, code] of fixtures) {
  const lines  = code.split('\n');
  const target = lines.findIndex(l => /username == "admin"/.test(l));
  const issue  = { line: target + 1, type: 'LOOSE_EQUALITY', title: 'استخدم ===', ev: lines[target].trim() };
  const fixedFull = lines.map((l, i) => (i === target ? l.replace('==', '===') : l)).join('\n');
  const truncated = fixedFull.split('\n').slice(0, Math.ceil(lines.length * 0.6)).join('\n');
  const run = fetchFn => ClaudeRepairEngine.repairOne(code, 'GameServer.js', issue, { _fetchFn: fetchFn });

  test(`${label}: stop_reason=max_tokens → CANNOT_FIX (TRUNCATED_BY_MAX_TOKENS), even if the text looks complete`, async () => {
    const r = await run(mockApi([textBlock(fenced(fixedFull))], 'max_tokens', 3000));
    assert.equal(r.status, Status.CANNOT_FIX);
    assert.match(r.reason, /TRUNCATED_BY_MAX_TOKENS/);
    assert.match(r.reason, /3000 output tokens/);
    assert.equal(r.fixedCode, null);
  });

  test(`${label}: stop_reason=max_tokens with a cut, unfenced reply → TRUNCATED (not an indirect reason)`, async () => {
    const r = await run(mockApi([textBlock(truncated)], 'max_tokens'));
    assert.equal(r.status, Status.CANNOT_FIX);
    assert.match(r.reason, /TRUNCATED_BY_MAX_TOKENS/);
    assert.doesNotMatch(r.reason, /INCOMPLETE_FILE|change ratio/);
  });

  test(`${label}: stop_reason=end_turn with the full fixed file → FIXED`, async () => {
    const r = await run(mockApi([textBlock(fenced(fixedFull))], 'end_turn', 120));
    assert.equal(r.status, Status.FIXED, r.reason);
    assert.equal(r.fixedCode, fixedFull);
  });

  test(`${label}: missing stop_reason with the full fixed file → FIXED (current behavior kept)`, async () => {
    const r = await run(mockApi([textBlock(fenced(fixedFull))]));
    assert.equal(r.status, Status.FIXED, r.reason);
    assert.equal(r.fixedCode, fixedFull);
  });

  test(`${label}: missing stop_reason with a truncated reply → still CANNOT_FIX (safety net: completeness)`, async () => {
    const r = await run(mockApi([textBlock(truncated)]));
    assert.equal(r.status, Status.CANNOT_FIX);
    assert.match(r.reason, /INCOMPLETE_FILE|change ratio/);
    assert.equal(r.fixedCode, null);
  });

  test(`${label}: text split across several text blocks is joined → FIXED`, async () => {
    const full = fenced(fixedFull);
    const cut  = Math.floor(full.length / 2);
    const r = await run(mockApi([textBlock(full.slice(0, cut)), textBlock(full.slice(cut))], 'end_turn'));
    assert.equal(r.status, Status.FIXED, r.reason);
    assert.equal(r.fixedCode, fixedFull);
  });

  test(`${label}: a non-text first block (e.g. thinking) no longer hides the text → FIXED`, async () => {
    const r = await run(mockApi([{ type: 'thinking', thinking: 'reasoning…' }, textBlock(fenced(fixedFull))], 'end_turn'));
    assert.equal(r.status, Status.FIXED, r.reason);
    assert.equal(r.fixedCode, fixedFull);
  });
}

test('stop_reason=refusal with no text → CANNOT_FIX (REFUSED), not an API error', async () => {
  const r = await ClaudeRepairEngine.repairOne(INLINE_FIXTURE, 'a.js', { line: 3, type: 'X', title: 'X' },
    { _fetchFn: mockApi([], 'refusal') });
  assert.equal(r.status, Status.CANNOT_FIX);
  assert.match(r.reason, /REFUSED/);
});

test('unexpected stop_reason → CANNOT_FIX (UNEXPECTED_STOP_REASON)', async () => {
  const r = await ClaudeRepairEngine.repairOne(INLINE_FIXTURE, 'a.js', { line: 3, type: 'X', title: 'X' },
    { _fetchFn: mockApi([textBlock('```js\nx\n```')], 'pause_turn') });
  assert.equal(r.status, Status.CANNOT_FIX);
  assert.match(r.reason, /UNEXPECTED_STOP_REASON — pause_turn/);
});

test('end_turn with empty content → PENDING_REVIEW (current error path kept)', async () => {
  const r = await ClaudeRepairEngine.repairOne(INLINE_FIXTURE, 'a.js', { line: 3, type: 'X', title: 'X' },
    { _fetchFn: mockApi([], 'end_turn') });
  assert.equal(r.status, Status.PENDING_REVIEW);
  assert.match(r.reason, /Empty content/);
});

// ═══════════════════════════════════════════════════════
// Phase 2 — line-based code extraction (_extractCode)
// الـfence سطر كامل فقط؛ ``` داخل string لا ينهي الكتلة؛ كتلة واحدة فقط؛
// fence مفتوح = رد مقطوع؛ بلا fence = الرد كله كود؛ بلا trim() في _callAPI.
// ═══════════════════════════════════════════════════════

const endTurn = text => mockApi([textBlock(text)], 'end_turn');
const withTarget = code => {
  const lines = code.split('\n');
  const t = lines.findIndex(l => /== "admin"/.test(l));
  return { lines, t, issue: { line: t + 1, type: 'LOOSE_EQUALITY', title: 'استخدم ===' },
           fixed: lines.map((l, i) => (i === t ? l.replace('==', '===') : l)).join('\n') };
};

// fixture فيه ``` داخل string في منتصف السطر (مثل index.html وهذا المحرك نفسه)
const FENCE_IN_STRING = [
  'function loginPlayer(username) {',
  '    if (username == "admin") { grant(); }',
  '}',
  '',
  'function renderMarkdown(code) {',
  "    return '```\\n' + code + '\\n```';",
  '}',
  ...Array.from({ length: 12 }, (_, i) => `function helper${i}(x) { return x + ${i}; }`),
  '',
].join('\n');

test('phase 2: ``` inside a string mid-line does not end the block → FIXED, full file', async () => {
  const { lines, issue, fixed } = withTarget(FENCE_IN_STRING);
  const r = await ClaudeRepairEngine.repairOne(FENCE_IN_STRING, 'md.js', issue, { _fetchFn: endTurn('```javascript\n' + fixed + '\n```') });
  assert.equal(r.status, Status.FIXED, r.reason);
  assert.equal(r.fixedCode, fixed);
  assert.equal(r.fixedCode.split('\n').length, lines.length);
});

test('phase 2: language tag with symbols (```c++) → tag never leaks into the code', async () => {
  const cpp = ['#include <stdio.h>', '', 'int check(int u) {', '    if (u = 1) return 1;', '    return 0;', '}',
    ...Array.from({ length: 12 }, (_, i) => `int f${i}(int x) { return x + ${i}; }`), ''].join('\n');
  const fixed = cpp.split('\n').map((l, i) => (i === 3 ? l.replace('u = 1', 'u == 1') : l)).join('\n');
  const ex = ClaudeRepairEngine._extractCode('```c++\n' + fixed + '\n```');
  assert.ok(ex.ok);
  assert.equal(ex.code.split('\n')[0], '#include <stdio.h>');
  const r = await ClaudeRepairEngine.repairOne(cpp, 'check.cpp', { line: 4, type: 'X', title: 'X' }, { _fetchFn: endTurn('```c++\n' + fixed + '\n```') });
  assert.equal(r.status, Status.FIXED, r.reason);
  assert.equal(r.fixedCode, fixed);
});

test('phase 2: two code blocks → CANNOT_FIX (MULTIPLE_CODE_BLOCKS)', async () => {
  const { issue, fixed } = withTarget(INLINE_FIXTURE);
  const text = "Add this import:\n```js\nconst a = require('a');\n```\nThen:\n```js\n" + fixed + '\n```';
  const r = await ClaudeRepairEngine.repairOne(INLINE_FIXTURE, 'a.js', issue, { _fetchFn: endTurn(text) });
  assert.equal(r.status, Status.CANNOT_FIX);
  assert.match(r.reason, /MULTIPLE_CODE_BLOCKS/);
});

test('phase 2: opening fence without a closing fence → CANNOT_FIX (UNTERMINATED_CODE_BLOCK)', async () => {
  const { issue, fixed } = withTarget(INLINE_FIXTURE);
  const r = await ClaudeRepairEngine.repairOne(INLINE_FIXTURE, 'a.js', issue, { _fetchFn: endTurn('```js\n' + fixed) });
  assert.equal(r.status, Status.CANNOT_FIX);
  assert.match(r.reason, /UNTERMINATED_CODE_BLOCK/);
});

test('phase 2: no fence → the whole response is the code → FIXED (behavior kept)', async () => {
  const { issue, fixed } = withTarget(INLINE_FIXTURE);
  assert.deepEqual(ClaudeRepairEngine._extractCode(fixed), { ok: true, code: fixed });
  const r = await ClaudeRepairEngine.repairOne(INLINE_FIXTURE, 'a.js', issue, { _fetchFn: endTurn(fixed) });
  assert.equal(r.status, Status.FIXED, r.reason);
  assert.equal(r.fixedCode, fixed);
});

test('phase 2: prose around a single fenced block is ignored → FIXED', async () => {
  const { issue, fixed } = withTarget(INLINE_FIXTURE);
  const r = await ClaudeRepairEngine.repairOne(INLINE_FIXTURE, 'a.js', issue,
    { _fetchFn: endTurn('Here is the fix:\n```javascript\n' + fixed + '\n```\nDone.') });
  assert.equal(r.status, Status.FIXED, r.reason);
  assert.equal(r.fixedCode, fixed);
});

test('phase 2: ~~~ fences are accepted → FIXED', async () => {
  const { issue, fixed } = withTarget(INLINE_FIXTURE);
  const r = await ClaudeRepairEngine.repairOne(INLINE_FIXTURE, 'a.js', issue, { _fetchFn: endTurn('~~~js\n' + fixed + '\n~~~') });
  assert.equal(r.status, Status.FIXED, r.reason);
  assert.equal(r.fixedCode, fixed);
});

test('phase 2: a ```` fence may contain a line that is exactly ``` → FIXED', async () => {
  const code = [...INLINE_FIXTURE.split('\n').slice(0, -1), 'const md = `', '```', 'text', '```', '`;', ''].join('\n');
  const { issue, fixed } = withTarget(code);
  const r = await ClaudeRepairEngine.repairOne(code, 'a.js', issue, { _fetchFn: endTurn('````js\n' + fixed + '\n````') });
  assert.equal(r.status, Status.FIXED, r.reason);
  assert.equal(r.fixedCode, fixed);
});

test('phase 2: a bare ``` line inside a ``` block fails closed (never a silent partial file)', async () => {
  const code = [...INLINE_FIXTURE.split('\n').slice(0, -1), 'const md = `', '```', '`;', ''].join('\n');
  const { issue, fixed } = withTarget(code);
  const r = await ClaudeRepairEngine.repairOne(code, 'a.js', issue, { _fetchFn: endTurn('```js\n' + fixed + '\n```') });
  assert.equal(r.status, Status.CANNOT_FIX);
  assert.match(r.reason, /UNTERMINATED_CODE_BLOCK|MULTIPLE_CODE_BLOCKS|INCOMPLETE_FILE/);
  assert.equal(r.fixedCode, null);
});

test('phase 2: CRLF fences are recognized → FIXED', async () => {
  const { issue, fixed } = withTarget(INLINE_FIXTURE);
  const r = await ClaudeRepairEngine.repairOne(INLINE_FIXTURE, 'a.js', issue, { _fetchFn: endTurn('```js\r\n' + fixed + '\n```\r\n') });
  assert.equal(r.status, Status.FIXED, r.reason);
  assert.equal(r.fixedCode, fixed);
});

test('phase 2: CANNOT_FIX surrounded by whitespace is still recognized', async () => {
  const { issue } = withTarget(INLINE_FIXTURE);
  const r = await ClaudeRepairEngine.repairOne(INLINE_FIXTURE, 'a.js', issue, { _fetchFn: endTurn('\n  CANNOT_FIX \n') });
  assert.equal(r.status, Status.CANNOT_FIX);
  assert.match(r.reason, /cannot safely fix/);
});

test('phase 2: windowed, no fence, indented first line keeps its indentation → FIXED (trim side effect removed)', async () => {
  const big = ['function main() {', ...Array.from({ length: 400 }, (_, i) => (i === 200 ? '    if (u == "admin") grant();' : `    step_${i}();`)), '}', ''].join('\n');
  const L = big.split('\n'); const t = L.findIndex(l => l.includes('u == "admin"'));
  const block = L.slice(t - 40, t + 41).map((l, i) => (t - 40 + i === t ? l.replace('==', '===') : l)).join('\n');
  const r = await ClaudeRepairEngine.repairOne(big, 'big.js', { line: t + 1, type: 'X', title: 'X' }, { _fetchFn: endTurn(block) });
  assert.equal(r.status, Status.FIXED, r.reason);
  assert.equal(r.fixedCode.split('\n')[t - 40], L[t - 40]);
  assert.match(r.fixedCode.split('\n')[t], /===/);
});
