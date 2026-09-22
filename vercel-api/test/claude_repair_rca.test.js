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

// ═══════════════════════════════════════════════════════
// Phase 3 — reply-size budget and full-file vs windowed selection
// full-file فقط إذا: ≤ FULL_FILE_THRESHOLD سطر  و  _estimateTokens ≤ FULL_FILE_TOKEN_BUDGET
// وإلا windowed. MAX_TOKENS = 6000، timeout = 60s.
// ═══════════════════════════════════════════════════════

const path = require('node:path');
const REPO_FILE = rel => fs.readFileSync(path.join(__dirname, '..', 'public', rel), 'utf8');

test('phase 3: MAX_TOKENS is 6000 and is what the API request sends', async () => {
  assert.equal(ClaudeRepairEngine.MAX_TOKENS, 6000);
  let sent = null;
  const fetchFn = async (url, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ model: 'm', stop_reason: 'end_turn', content: [textBlock('CANNOT_FIX')] }) }; };
  await ClaudeRepairEngine.repairOne(INLINE_FIXTURE, 'a.js', { line: 3, type: 'X', title: 'X' }, { _fetchFn: fetchFn });
  assert.equal(sent.max_tokens, 6000);
});

test('phase 3: timeout is 60s — still waiting at 59.999s, aborted at 60s', async (t) => {
  assert.equal(ClaudeRepairEngine.DEFAULT_TIMEOUT, 60000);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let aborted = false;
  const fetchFn = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  const pending = ClaudeRepairEngine.repairOne(INLINE_FIXTURE, 'a.js', { line: 3, type: 'X', title: 'X' }, { _fetchFn: fetchFn });
  t.mock.timers.tick(25000);
  assert.equal(aborted, false, 'must not abort at the old 25s limit');
  t.mock.timers.tick(34999);
  assert.equal(aborted, false);
  t.mock.timers.tick(1);
  const r = await pending;
  assert.equal(aborted, true);
  assert.equal(r.status, Status.PENDING_REVIEW);
  assert.match(r.reason, /Timeout after 60000ms/);
});

test('phase 3: _estimateTokens is conservative (ASCII ÷ 3.2, non-ASCII 1 per char)', () => {
  assert.equal(ClaudeRepairEngine._estimateTokens(''), 0);
  assert.equal(ClaudeRepairEngine._estimateTokens('x'.repeat(32)), 10);
  assert.equal(ClaudeRepairEngine._estimateTokens('x'.repeat(33)), 11);         // rounds up
  assert.equal(ClaudeRepairEngine._estimateTokens('مرحبا'), 5);                 // Arabic is denser
  assert.equal(ClaudeRepairEngine._estimateTokens('// تعليق\nx'), Math.ceil(4 / 3.2 + 5));
});

test('phase 3: a small file that fits the budget → full-file mode', () => {
  assert.ok(ClaudeRepairEngine._estimateTokens(INLINE_FIXTURE) <= ClaudeRepairEngine.FULL_FILE_TOKEN_BUDGET);
  const ctx = ClaudeRepairEngine._extractContext(INLINE_FIXTURE, 3);
  assert.equal(ctx.fullFile, true);
  assert.match(ClaudeRepairEngine._buildPrompt({ line: 3, type: 'X', title: 'X' }, INLINE_FIXTURE, 'a.js'), /Full file \(\d+ lines\)/);
});

for (const [label, code] of fixtures.slice(1)) {
  test(`phase 3: ${label} fits the budget → still full-file mode`, () => {
    assert.ok(ClaudeRepairEngine._estimateTokens(code) <= ClaudeRepairEngine.FULL_FILE_TOKEN_BUDGET);
    assert.equal(ClaudeRepairEngine._extractContext(code, 15).fullFile, true);
  });
}

test('phase 3: a ≤300-line repo file whose reply would exceed the budget → windowed mode', () => {
  const code = REPO_FILE('extended_patterns.js');
  const lines = code.split('\n').length;
  assert.ok(lines <= ClaudeRepairEngine.FULL_FILE_THRESHOLD, `fixture must be ≤300 lines (is ${lines})`);
  assert.ok(ClaudeRepairEngine._estimateTokens(code) > ClaudeRepairEngine.FULL_FILE_TOKEN_BUDGET);
  const ctx = ClaudeRepairEngine._extractContext(code, 120);
  assert.equal(ctx.fullFile, false);
  assert.equal(ctx.fromLine, 80);
  assert.equal(ctx.toLine, 160);
  assert.match(ClaudeRepairEngine._buildPrompt({ line: 120, type: 'X', title: 'X' }, code, 'extended_patterns.js'), /Target context \(lines 80–160 of \d+\)/);
});

test('phase 3: that windowed repo file is repaired and reconstructed in full → FIXED', async () => {
  const code = REPO_FILE('extended_patterns.js');
  const L = code.split('\n'); const t = 119;                               // line 120
  const ctx = ClaudeRepairEngine._extractContext(code, t + 1);
  const block = L.slice(ctx.targetRange.from, ctx.targetRange.to + 1).map((l, i) => (ctx.targetRange.from + i === t ? l + ' // reviewed' : l)).join('\n');
  const r = await ClaudeRepairEngine.repairOne(code, 'extended_patterns.js', { line: t + 1, type: 'X', title: 'X' }, { _fetchFn: endTurn('```js\n' + block + '\n```') });
  assert.equal(r.status, Status.FIXED, r.reason);
  const out = r.fixedCode.split('\n');
  assert.equal(out.length, L.length);
  assert.equal(out[t], L[t] + ' // reviewed');
  L.forEach((l, i) => { if (i !== t) assert.equal(out[i], l, `line ${i + 1} changed`); });
});

test('phase 3: budget boundary — estimate == budget → full-file, budget + 1 → windowed', () => {
  const budget = ClaudeRepairEngine.FULL_FILE_TOKEN_BUDGET;
  const base = Array.from({ length: 100 }, (_, i) => `const value_${String(i).padStart(3, '0')} = ${i};`);
  let code = base.join('\n');
  while (ClaudeRepairEngine._estimateTokens(code) < budget) code += 'x';
  assert.equal(ClaudeRepairEngine._estimateTokens(code), budget);
  assert.equal(ClaudeRepairEngine._extractContext(code, 50).fullFile, true);
  let over = code;
  while (ClaudeRepairEngine._estimateTokens(over) <= budget) over += 'x';
  assert.equal(ClaudeRepairEngine._estimateTokens(over), budget + 1);
  assert.equal(ClaudeRepairEngine._extractContext(over, 50).fullFile, false);
});

test('phase 3: Arabic-heavy file — line count alone would say full-file, the estimate says windowed', () => {
  const code = Array.from({ length: 80 }, (_, i) => `// تعليق توضيحي طويل عن الدالة رقم ${i} ووظيفتها\nfunction f${i}() { return ${i}; }`).join('\n');
  const L = code.split('\n');
  assert.ok(L.length <= 300);
  const asciiOnlyEstimate = Math.ceil(code.length / 3.2);
  assert.ok(asciiOnlyEstimate <= ClaudeRepairEngine.FULL_FILE_TOKEN_BUDGET, 'a naive chars/3.2 estimate would wrongly allow full-file');
  assert.ok(ClaudeRepairEngine._estimateTokens(code) > ClaudeRepairEngine.FULL_FILE_TOKEN_BUDGET);
  assert.equal(ClaudeRepairEngine._extractContext(code, 100).fullFile, false);
});

test('phase 3: more than 300 lines stays windowed even when tiny (line rule kept)', () => {
  const code = Array.from({ length: 301 }, (_, i) => `a${i}`).join('\n');
  assert.ok(ClaudeRepairEngine._estimateTokens(code) <= ClaudeRepairEngine.FULL_FILE_TOKEN_BUDGET);
  assert.equal(ClaudeRepairEngine._extractContext(code, 150).fullFile, false);
});

test('phase 3: Phase 1 truncation reason now reports the new cap (max_tokens=6000)', async () => {
  const r = await ClaudeRepairEngine.repairOne(INLINE_FIXTURE, 'a.js', { line: 3, type: 'X', title: 'X' },
    { _fetchFn: mockApi([textBlock('```js\nx\n```')], 'max_tokens', 6000) });
  assert.equal(r.status, Status.CANNOT_FIX);
  assert.match(r.reason, /TRUNCATED_BY_MAX_TOKENS — response cut at max_tokens=6000 \(6000 output tokens\)/);
});
