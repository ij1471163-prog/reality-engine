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
  // Phase 5: النافذة = تعليق القسم + المصفوفة PY_PATTERNS كاملة (88–170) بدل ±40 (80–160) التي كانت تقطعها
  assert.equal(ctx.fromLine, 88);
  assert.equal(ctx.toLine, 170);
  assert.match(ClaudeRepairEngine._buildPrompt({ line: 120, type: 'X', title: 'X' }, code, 'extended_patterns.js'), /Target context \(lines 88–170 of \d+\)/);
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

// ═══════════════════════════════════════════════════════
// Phase 4 — prompt منفصل لكل mode + معلومات المشكلة كما يرسلها الـorchestrator
// ═══════════════════════════════════════════════════════
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// نفس شكل aiNeeded في repair_engine.js (line/title/strategy/reason/ev — بلا type)
const AI_NEEDED_ISSUE = {
  line: 3, title: '🟠 Callback Hell — تداخل 4 مستويات',
  strategy: 'CALLBACK_HELL', reason: 'يحتاج مراجعة يدوية — إعادة هيكلة', ev: 'if (username == "admin") {',
};

// ملف كبير فيه imports في الأعلى → windowed + reference imports
const WINDOWED_FIXTURE = [
  "const fs = require('fs');",
  "const path = require('path');",
  '',
  ...Array.from({ length: 400 }, (_, i) => `const pad_${i} = ${i};`),
  '',
].join('\n');
const WINDOWED_ISSUE = Object.assign({}, AI_NEEDED_ISSUE, { line: 200, ev: 'const pad_196 = 196;' });

for (const [label, code] of fixtures) {
  const total = code.split('\n').length;
  const prompt = ClaudeRepairEngine._buildPrompt(AI_NEEDED_ISSUE, code, 'GameServer.js');

  test(`phase 4: ${label}: full-file mode uses the dedicated full-file prompt`, () => {
    const ctx = ClaudeRepairEngine._extractContext(code, AI_NEEDED_ISSUE.line);
    assert.equal(ctx.fullFile, true);
    assert.equal(prompt, ClaudeRepairEngine._buildFullFilePrompt(AI_NEEDED_ISSUE, ctx, 'GameServer.js'));
    assert.ok(prompt.includes('```\n' + code + '\n```'), 'the whole file is sent verbatim');
  });

  test(`phase 4: ${label}: full-file prompt demands the ENTIRE file in exactly one fenced block`, () => {
    assert.match(prompt, new RegExp(`this is the ENTIRE file, lines 1–${total}`));
    assert.match(prompt, new RegExp(`return the COMPLETE file — all lines from line 1 to line ${total}`));
    assert.match(prompt, /REPLACES the whole file/);
    assert.match(prompt, /entire file in exactly ONE fenced code block/);
    assert.match(prompt, /no second code block/);
    assert.match(prompt, /cannot return the complete file, reply with exactly: CANNOT_FIX/);
  });

  test(`phase 4: ${label}: full-file prompt forbids placeholders and omitted sections`, () => {
    assert.match(prompt, /Never omit, shorten, or summarize any part/);
    assert.match(prompt, /no "\.\.\."/);
    assert.match(prompt, /no "rest unchanged"/);
    assert.match(prompt, /no other placeholder or omitted section/);
  });

  test(`phase 4: ${label}: full-file prompt keeps imports at the top and unrelated lines exact`, () => {
    assert.match(prompt, /Keep all imports at the top of the file/);
    assert.match(prompt, /add it at the top with the existing imports, never elsewhere/);
    assert.match(prompt, /Keep every unrelated line exactly as it is — same text, same indentation, same order/);
    assert.match(prompt, /Fix ONLY the reported issue at the target line/);
    assert.doesNotMatch(prompt, /EXCERPT|Reference imports|DO NOT include these in your response/);
  });
}

const wctx = ClaudeRepairEngine._extractContext(WINDOWED_FIXTURE, WINDOWED_ISSUE.line);
const wprompt = ClaudeRepairEngine._buildPrompt(WINDOWED_ISSUE, WINDOWED_FIXTURE, 'big.js');

test('phase 4: windowed mode uses the dedicated windowed prompt (window unchanged: ±40)', () => {
  assert.equal(wctx.fullFile, false);
  assert.equal(wctx.fromLine, 160);
  assert.equal(wctx.toLine, 240);
  assert.equal(wprompt, ClaudeRepairEngine._buildWindowedPrompt(WINDOWED_ISSUE, wctx, 'big.js'));
  assert.ok(wprompt.includes('```\n' + wctx.snippet + '\n```'));
});

test('phase 4: windowed prompt states the excerpt line range and asks only for that excerpt', () => {
  const total = WINDOWED_FIXTURE.split('\n').length;
  assert.match(wprompt, new RegExp(`This is an EXCERPT of a larger file, NOT the entire file\\. It covers lines 160–240 of ${total}\\.`));
  assert.match(wprompt, /The target line 200 is line 41 of this excerpt\./);
  assert.match(wprompt, new RegExp(`Target context \\(lines 160–240 of ${total}\\) — return ONLY this excerpt fixed:`));
  assert.match(wprompt, /Return ONLY the excerpt above \(lines 160–240\) with the fix applied\. Your response replaces exactly these lines\./);
  assert.match(wprompt, /do NOT treat the excerpt as the whole file/);
  assert.match(wprompt, /Do NOT return any code outside the excerpt/);
  assert.match(wprompt, /excerpt in exactly ONE fenced code block/);
});

test('phase 4: windowed prompt never asks for (or pretends to be) the complete file', () => {
  assert.doesNotMatch(wprompt, /return the COMPLETE file/);
  assert.doesNotMatch(wprompt, /ENTIRE file/);
  assert.doesNotMatch(wprompt, /^Full file/m);
});

test('phase 4: windowed prompt forbids adding imports (old "MAY add a new import" rule removed)', () => {
  assert.match(wprompt, /Do NOT add import, require, include, or using lines/);
  assert.match(wprompt, /If the fix needs a new import, reply with exactly: CANNOT_FIX/);
  assert.doesNotMatch(wprompt, /MAY add a new import/);
  // imports الملف تُعرض للقراءة فقط
  assert.match(wprompt, /Reference imports from the top of the file \(read-only — DO NOT include these in your response\):\n```\nconst fs = require\('fs'\);\nconst path = require\('path'\);\n/);
});

test('phase 4: windowed prompt forbids placeholders and keeps unrelated excerpt lines exact', () => {
  assert.match(wprompt, /Never omit or shorten any part of the excerpt: no "\.\.\.", no "rest unchanged", and no other placeholder/);
  assert.match(wprompt, /Keep every unrelated line of the excerpt exactly as it is/);
  assert.match(wprompt, /keep its first and last lines, and do not close or complete code that continues outside it/);
});

test('phase 4: neither prompt keeps the old import rule or the "block" wording of full-file mode', () => {
  const full = ClaudeRepairEngine._buildPrompt(AI_NEEDED_ISSUE, INLINE_FIXTURE, 'a.js');
  assert.doesNotMatch(full, /MAY add a new import line at the TOP of your response/);
  assert.doesNotMatch(full, /return ONLY this block fixed/);
  assert.doesNotMatch(full, /Do NOT include the reference imports/);
});

test('phase 4: orchestrator aiNeeded (strategy + reason, no type) reaches both prompts — no "UNKNOWN"', () => {
  for (const p of [ClaudeRepairEngine._buildPrompt(AI_NEEDED_ISSUE, INLINE_FIXTURE, 'a.js'), wprompt]) {
    assert.match(p, /^Issue type: CALLBACK_HELL$/m);
    assert.match(p, new RegExp(`^Issue: ${esc(AI_NEEDED_ISSUE.title)}$`, 'm'));
    assert.match(p, new RegExp(`^Why this needs a manual fix: ${esc(AI_NEEDED_ISSUE.reason)}$`, 'm'));
    assert.match(p, /^Evidence: /m);
    assert.doesNotMatch(p, /UNKNOWN/);
  }
  assert.match(wprompt, /^Target line: 200 \(counted from line 1 of the file\)$/m);
});

test('phase 4: issue type precedence — analyzer type, then strategy, then cAct, else UNKNOWN', () => {
  const typeOf = issue => ClaudeRepairEngine._buildPrompt(issue, INLINE_FIXTURE, 'a.js').match(/^Issue type: (.*)$/m)[1];
  assert.equal(typeOf({ line: 3, type: 'LOOSE_EQUALITY', strategy: 'CALLBACK_HELL' }), 'LOOSE_EQUALITY');
  assert.equal(typeOf({ line: 3, strategy: 'SQL_INJECTION', cAct: 'X' }), 'SQL_INJECTION');
  assert.equal(typeOf({ line: 3, cAct: 'NULL_CHECK' }), 'NULL_CHECK');
  assert.equal(typeOf({ line: 3 }), 'UNKNOWN');
  // بلا title → العنوان هو النوع؛ بلا reason/ev/sev → لا أسطر فارغة المعنى
  const p = ClaudeRepairEngine._buildPrompt({ line: 3, strategy: 'EVAL_USAGE' }, INLINE_FIXTURE, 'a.js');
  assert.match(p, /^Issue: EVAL_USAGE$/m);
  assert.doesNotMatch(p, /Why this needs a manual fix|Evidence:|Severity:/);
  assert.match(ClaudeRepairEngine._buildPrompt({ line: 3, sev: 'HIGH' }, INLINE_FIXTURE, 'a.js'), /^Severity: HIGH$/m);
});

test('phase 4: repairAll sends each aiNeeded item\'s own prompt to the API (strategy/reason/line per item)', async () => {
  const sent = [];
  const fetchFn = async (url, init) => {
    sent.push(JSON.parse(init.body).messages[0].content);
    return { ok: true, json: async () => ({ model: 'm', stop_reason: 'end_turn', content: [textBlock('CANNOT_FIX')] }) };
  };
  const items = [
    AI_NEEDED_ISSUE,
    { line: 2, title: 'SQL', strategy: 'SQL_INJECTION', reason: 'يحتاج تعديل query + execute() معاً', ev: 'x' },
  ];
  await ClaudeRepairEngine.repairAll(INLINE_FIXTURE, 'a.js', items, { _fetchFn: fetchFn });
  assert.equal(sent.length, 2);
  items.forEach(it => {
    const p = sent.find(s => s.includes(`Issue type: ${it.strategy}`));
    assert.ok(p, `prompt for ${it.strategy} was sent`);
    assert.equal(p, ClaudeRepairEngine._buildPrompt(it, INLINE_FIXTURE, 'a.js'));
    assert.match(p, new RegExp(`Why this needs a manual fix: ${esc(it.reason)}`));
    assert.match(p, new RegExp(`Target line: ${it.line} `));
  });
});

// ═══════════════════════════════════════════════════════
// Phase 5 — حدود النافذة + قفل الأطراف + إعادة تركيب مُتحقَّق منها
// ═══════════════════════════════════════════════════════
const E5 = ClaudeRepairEngine;
const fillerLines = (p, n) => Array.from({ length: n }, (_, i) => `const ${p}_${i} = ${i};`);
const bodyLines   = (n, ind) => Array.from({ length: n }, (_, i) => `${ind}const v_${i} = compute(${i});`);
const mark = (lines, idx) => lines.map((l, i) => (i === idx ? l + ' // fixed' : l));
// رد صحيح لنافذة: نفس الأسطر مع تعديل سطر الهدف فقط
const windowReply = (code, line, edit = mark) => {
  const ctx = E5._extractContext(code, line);
  const L = code.split('\n').slice(ctx.targetRange.from, ctx.targetRange.to + 1);
  return { ctx, lines: edit(L, line - 1 - ctx.targetRange.from) };
};
const fence = lines => '```js\n' + lines.join('\n') + '\n```';
const run5 = (code, line, text) => E5.repairOne(code, 'f.js', { line, type: 'X', title: 'X' }, { _fetchFn: endTurn(text) });

// 200 سطر → function big (201–302، جسمها 100 سطر) → 200 سطر
const FN_FILE = [...fillerLines('a', 200), 'function big() {', ...bodyLines(100, '  '), '}', ...fillerLines('b', 200), ''].join('\n');

test('phase 5: target near the END of a function whose start is before the old ±40 window → window starts at the function', () => {
  const ctx = E5._extractContext(FN_FILE, 290);                 // ±40 كان 250–330 (يبدأ داخل الدالة)
  assert.equal(ctx.fullFile, false);
  assert.equal(ctx.boundary, 'enclosing');
  assert.equal(ctx.fromLine, 201);
  assert.equal(ctx.toLine, 330);
  assert.equal(ctx.snippet.split('\n')[0], 'function big() {');
  assert.ok(ctx.snippet.split('\n').includes('}'), 'the closing brace of the function is inside the window');
});

test('phase 5: target near the START of a function whose end is after the old ±40 window → window ends at the function', () => {
  const ctx = E5._extractContext(FN_FILE, 210);                 // ±40 كان 170–250 (ينتهي داخل الدالة)
  assert.equal(ctx.boundary, 'enclosing');
  assert.equal(ctx.fromLine, 170);
  assert.equal(ctx.toLine, 302);
  assert.equal(ctx.snippet.split('\n').pop(), '}');
});

// class كبير (> MAX_WINDOW_LINES) من methods فيها بلوكات متداخلة
const method = k => [
  `  method${k}(input) {`,
  '    const out = [];',
  '    for (let i = 0; i < input.length; i++) {',
  `      if (input[i] > ${k}) {`,
  '        out.push(input[i] * 2);',
  '      }',
  '    }',
  ...Array.from({ length: 14 }, (_, j) => `    const m${k}_${j} = ${j};`),
  '    return out;',
  '  }',
];
const CLASS_FILE = [...fillerLines('h', 20), 'class Service {', ...Array.from({ length: 14 }, (_, k) => method(k)).flat(), '}', ...fillerLines('t', 20), ''].join('\n');
const CL = CLASS_FILE.split('\n');
const M6_PUSH = CL.findIndex((l, i) => i > CL.indexOf('  method6(input) {') && l.includes('out.push')) + 1;

test('phase 5: nested blocks — class too large, window = whole methods (never cut inside one)', () => {
  const blocks = E5._enclosingBlocks(CL, M6_PUSH - 1);
  assert.deepEqual(blocks.map(b => CL[b.from].trim()),
    ['out.push(input[i] * 2);', `if (input[i] > 6) {`, 'for (let i = 0; i < input.length; i++) {', 'method6(input) {', 'class Service {']);
  const ctx = E5._extractContext(CLASS_FILE, M6_PUSH);
  assert.equal(ctx.boundary, 'enclosing');
  const W = ctx.snippet.split('\n');
  assert.match(W[0], /^ {2}method\d+\(input\) \{$/, 'window starts at a method');
  assert.equal(W[W.length - 1], '  }', 'window ends at the end of a method');
  assert.ok(ctx.fromLine > CL.indexOf('class Service {') + 1 && ctx.toLine < CL.lastIndexOf('}') + 1, 'class opener/closer stay outside');
  assert.ok(W.includes('  method6(input) {'));
  assert.ok(ctx.toLine - ctx.fromLine + 1 <= E5.MAX_WINDOW_LINES);
});

test('phase 5: nested blocks (Python, indentation only) — window = whole methods of the class', () => {
  const pyMethod = k => [`    def m${k}(self, xs):`, '        out = []', '        for x in xs:', `            if x > ${k}:`, '                out.append(x)',
    ...Array.from({ length: 14 }, (_, j) => `        v${j} = ${j}`), '        return out', ''];
  const code = ['import os', '', 'class Big:', ...Array.from({ length: 16 }, (_, k) => pyMethod(k)).flat(), 'x = 1', ''].join('\n');
  const L = code.split('\n');
  const t = L.findIndex((l, i) => i > L.indexOf('    def m8(self, xs):') && l.includes('out.append')) + 1;
  const ctx = E5._extractContext(code, t);
  const W = ctx.snippet.split('\n');
  assert.equal(ctx.boundary, 'enclosing');
  assert.match(W[0], /^ {4}def m\d+\(self, xs\):$/);
  assert.equal(W[W.length - 1], '        return out');
  assert.ok(W.includes('    def m8(self, xs):'));
  assert.ok(!W.includes('class Big:'));
});

test('phase 5: enclosing function within MAX_WINDOW_LINES and token budget is sent whole', () => {
  const ctx = E5._extractContext(FN_FILE, 250);
  const fn = FN_FILE.split('\n').slice(200, 302).join('\n');
  assert.ok(ctx.snippet.includes(fn));
  assert.ok(E5._estimateTokens(ctx.snippet) <= E5.FULL_FILE_TOKEN_BUDGET);
});

test('phase 5: function over the token budget (≤160 lines) → deeper statement-level window, never cut mid-statement', () => {
  const long = Array.from({ length: 120 }, (_, i) => `  const w_${i} = compute("${'x'.repeat(90)}", ${i});`);
  const code = [...fillerLines('a', 200), 'function wide() {', ...long, '}', ...fillerLines('b', 100), ''].join('\n');
  const ctx = E5._extractContext(code, 261);
  assert.equal(ctx.boundary, 'enclosing');
  assert.ok(E5._estimateTokens(ctx.snippet) <= E5.FULL_FILE_TOKEN_BUDGET);
  assert.ok(ctx.fromLine > 201 && ctx.toLine < 322, 'window is inside the function body');
  ctx.snippet.split('\n').forEach(l => assert.match(l, /^ {2}const w_\d+ = compute\(.*\);$/));
});

// دالة 300 سطر؛ الهدف على سطر التعريف → لا بلوك يتسع → ±40 القديم (excerpt)
const HUGE_FILE = [...fillerLines('a', 10), '', ...fillerLines('c', 39), 'function huge(a) {', ...bodyLines(300, '  '), '}', ...fillerLines('b', 60), ''].join('\n');
const HUGE_SIG = 51;

test('phase 5: enclosing function too large → conservative ±40 excerpt (unchanged fallback)', () => {
  const ctx = E5._extractContext(HUGE_FILE, HUGE_SIG);
  assert.equal(ctx.boundary, 'excerpt');
  assert.equal(ctx.fromLine, HUGE_SIG - 40);
  assert.equal(ctx.toLine, HUGE_SIG + 40);
});

test('phase 5: valid repairs still succeed — function window, nested class window, and ±40 excerpt', async () => {
  for (const [code, line] of [[FN_FILE, 290], [FN_FILE, 210], [CLASS_FILE, M6_PUSH], [HUGE_FILE, HUGE_SIG]]) {
    const { lines } = windowReply(code, line);
    const r = await run5(code, line, fence(lines));
    assert.equal(r.status, Status.FIXED, `line ${line}: ${r.reason}`);
    const O = code.split('\n'), N = r.fixedCode.split('\n');
    assert.equal(N.length, O.length);
    O.forEach((l, i) => assert.equal(N[i], i === line - 1 ? l + ' // fixed' : l, `line ${i + 1}`));
  }
});

test('phase 5: everything outside the window is preserved byte-for-byte (CRLF, tabs, trailing spaces)', async () => {
  const code = FN_FILE.split('\n').map((l, i) => (i % 3 === 0 ? l + '  \t' : l) + (i % 2 ? '\r' : '')).join('\n');
  const { ctx, lines } = windowReply(code, 290);
  const r = await run5(code, 290, fence(lines));
  assert.equal(r.status, Status.FIXED, r.reason);
  const O = code.split('\n'), N = r.fixedCode.split('\n');
  assert.equal(N.slice(0, ctx.targetRange.from).join('\n'), O.slice(0, ctx.targetRange.from).join('\n'));
  assert.equal(N.slice(ctx.targetRange.to + 1).join('\n'), O.slice(ctx.targetRange.to + 1).join('\n'));
});

test('phase 5: blank lines at the window edges are kept (were dropped by candidate trimming)', async () => {
  const ctx = E5._extractContext(HUGE_FILE, HUGE_SIG);
  assert.equal(ctx.snippet.split('\n')[0], '', 'fixture: excerpt starts with a blank line');
  const { lines } = windowReply(HUGE_FILE, HUGE_SIG);
  const r = await run5(HUGE_FILE, HUGE_SIG, fence(lines.slice(1)));   // الرد بلا السطر الفارغ الأول
  assert.equal(r.status, Status.FIXED, r.reason);
  assert.equal(r.fixedCode.split('\n').length, HUGE_FILE.split('\n').length);
  assert.equal(r.fixedCode.split('\n')[ctx.targetRange.from], '');
});

test('phase 5: truncated window replies → WINDOW_BOUNDARY_CHANGED (end cut or start cut)', async () => {
  const { lines } = windowReply(FN_FILE, 290);
  const endCut = await run5(FN_FILE, 290, fence(lines.slice(0, -5)));
  assert.equal(endCut.status, Status.CANNOT_FIX);
  assert.match(endCut.reason, /^WINDOW_BOUNDARY_CHANGED — the excerpt must end with its original last line \(line 330\)/);
  const startCut = await run5(FN_FILE, 290, fence(lines.slice(3)));
  assert.equal(startCut.status, Status.CANNOT_FIX);
  assert.match(startCut.reason, /^WINDOW_BOUNDARY_CHANGED — the excerpt must start with its original first line \(line 201\)/);
});

test('phase 5: a reply missing lines in the middle, far from the target, is still INCOMPLETE_FILE', async () => {
  const { lines } = windowReply(FN_FILE, 290);
  const r = await run5(FN_FILE, 290, fence([...lines.slice(0, 5), ...lines.slice(8)]));
  assert.equal(r.status, Status.CANNOT_FIX);
  assert.match(r.reason, /INCOMPLETE_FILE/);
});

test('phase 5: replies that add code outside the requested boundaries → WINDOW_BOUNDARY_CHANGED', async () => {
  const { lines } = windowReply(FN_FILE, 290);
  const before = await run5(FN_FILE, 290, fence(['const a_199 = 199;', ...lines]));        // سطر من خارج النافذة
  assert.match(before.reason, /^WINDOW_BOUNDARY_CHANGED — the excerpt must start/);
  const after = await run5(FN_FILE, 290, fence([...lines, 'const b_30 = 30;']));
  assert.match(after.reason, /^WINDOW_BOUNDARY_CHANGED — the excerpt must end/);
  const imp = await run5(FN_FILE, 290, fence(["const fs = require('fs');", ...lines]));
  assert.match(imp.reason, /^WINDOW_BOUNDARY_CHANGED — the excerpt must start/);
  // excerpt يقطع الدالة: "إكمالها" بـ } مرفوض
  const ex = windowReply(HUGE_FILE, HUGE_SIG);
  const closed = await run5(HUGE_FILE, HUGE_SIG, fence([...ex.lines, '}']));
  assert.equal(closed.status, Status.CANNOT_FIX);
  assert.match(closed.reason, /^WINDOW_BOUNDARY_CHANGED — the excerpt must end/);
});

test('phase 5: boundary lock exempts an edge only when it is the target line itself', () => {
  const ctx = { fullFile: false, snippet: 'a();\nb();\nc();', fromLine: 10 };
  assert.equal(E5._windowBoundaryProblem(ctx, 'a2();\nb();\nc();', { line: 10 }), null);
  assert.equal(E5._windowBoundaryProblem(ctx, 'a();\nb();\nc2();', { line: 12 }), null);
  assert.match(E5._windowBoundaryProblem(ctx, 'a2();\nb();\nc();', { line: 11 }), /WINDOW_BOUNDARY_CHANGED/);
  assert.match(E5._windowBoundaryProblem(ctx, '   ', { line: 11 }), /empty excerpt/);
  assert.equal(E5._windowBoundaryProblem({ fullFile: true, snippet: 'a' }, 'zzz', { line: 1 }), null);
});

test('phase 5: malformed reconstruction is rejected (null), never spliced', () => {
  const code = 'a();\nb();\nc();\nd();';
  const ok = { fullFile: false, snippet: 'b();\nc();', fromLine: 2, targetRange: { from: 1, to: 2 } };
  assert.equal(E5._reconstructCode(code, { line: 2 }, 'b2();\nc();', ok), 'a();\nb2();\nc();\nd();');
  assert.equal(E5._reconstructCode(code, {}, 'x();', Object.assign({}, ok, { snippet: 'stale();\nc();' })), null);
  assert.equal(E5._reconstructCode(code, {}, 'x();', Object.assign({}, ok, { targetRange: undefined })), null);
  assert.equal(E5._reconstructCode(code, {}, 'x();', Object.assign({}, ok, { targetRange: { from: 2, to: 1 } })), null);
  assert.equal(E5._reconstructCode(code, {}, 'x();', Object.assign({}, ok, { targetRange: { from: 3, to: 9 } })), null);
  assert.equal(E5._reconstructCode(code, {}, '  \n ', ok), null);
});

test('phase 5: issue line beyond the end of the file → MALFORMED_RECONSTRUCTION (was spliced after EOF)', async () => {
  const r = await run5(FN_FILE, 10000, fence(['const z = 1;']));
  assert.equal(r.status, Status.CANNOT_FIX);
  assert.match(r.reason, /^MALFORMED_RECONSTRUCTION/);
  assert.equal(r.fixedCode, null);
});

test('phase 5: full-file mode is untouched by window logic (small file, GameServer-size)', () => {
  const ctx = E5._extractContext(INLINE_FIXTURE, 3);
  assert.equal(ctx.fullFile, true);
  assert.equal(ctx.boundary, undefined);
  assert.equal(E5._windowBoundaryProblem(ctx, 'anything();', { line: 3 }), null);
});

test('phase 5: a comment directly above a unit stays with it (window edge before the comment, not between)', () => {
  const code = [...fillerLines('a', 200), '// big: computes everything', '// (second comment line)', 'function big() {', ...bodyLines(100, '  '), '}', ...fillerLines('b', 200), ''].join('\n');
  const ctx = E5._extractContext(code, 292);
  assert.equal(ctx.boundary, 'enclosing');
  assert.equal(ctx.snippet.split('\n')[0], '// big: computes everything');
});
