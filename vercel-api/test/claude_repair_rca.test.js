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
