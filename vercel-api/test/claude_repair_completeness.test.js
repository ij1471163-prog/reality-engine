// ═══════════════════════════════════════════════════════
// اختبارات claude_repair_engine.js — الملف الكامل لا يُستبدل بجزء منه
// تشغيل:  node --test vercel-api/test/claude_repair_completeness.test.js
//
// الـfixture المضمَّن هنا يكفي للاختبار. لتشغيل نفس الحالات على ملف خارجي
// (مثل GameServer.js) بدون إضافته للمستودع:
//   CLAUDE_REPAIR_FIXTURE=/path/to/GameServer.js node --test ...
// بلا أي تبعيات خارجية — node:test مدمج، و Claude API مُحاكى (بلا شبكة).
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
  'const DB_PASSWORD = "not_a_real_password";',
  '',
  'function loginPlayer(username, password) {',
  '    var query = "SELECT * FROM players WHERE username=\'" + username + "\'";',
  '    db.execute(query);',
  '',
  '    if (username == "admin") {',
  '        grantAdminAccess();',
  '    }',
  '}',
  '',
  'function updateLeaderboard(players) {',
  '    document.getElementById("leaderboard").textContent = players[0].name;',
  '}',
  '',
  'function savePlayerData(data) {',
  '    saveToCloud(function(result) {',
  '        refreshUI(result);',
  '    });',
  '}',
  '',
  'const crypto = require(\'crypto\');',
  'function hashPassword(pass) {',
  '    return crypto.createHash(\'sha256\').update(pass).digest(\'hex\');',
  '}',
  '',
].join('\n');

const fixtures = [['inline fixture', INLINE_FIXTURE]];
if (process.env.CLAUDE_REPAIR_FIXTURE) {
  fixtures.push([process.env.CLAUDE_REPAIR_FIXTURE, fs.readFileSync(process.env.CLAUDE_REPAIR_FIXTURE, 'utf8')]);
}

function mockClaude(text) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ model: 'mock', content: [{ type: 'text', text }] }),
  });
}

function fenced(body) { return '```js\n' + body + '\n```'; }

for (const [label, code] of fixtures) {
  const lines = code.split('\n');
  const target = lines.findIndex(l => /username == "admin"/.test(l));
  assert.ok(target >= 0, `${label}: fixture must contain \`username == "admin"\``);
  const issue = { line: target + 1, type: 'LOOSE_EQUALITY', title: 'استخدم ===', ev: lines[target].trim() };
  const fixedLines = lines.map((l, i) => (i === target ? l.replace('==', '===') : l));
  const fixedFull = fixedLines.join('\n');

  const run = text => ClaudeRepairEngine.repairOne(code, 'GameServer.js', issue, { _fetchFn: mockClaude(text) });

  // يحدد بداية ونهاية دالة بالاسم (للاختبارات التي تحذف دالة كاملة)
  const fnRange = name => {
    const start = lines.findIndex(l => new RegExp('function\\s+' + name + '\\s*\\(').test(l));
    let end = start;
    while (end < lines.length && lines[end] !== '}') end++;
    return [start, end];
  };
  const lastFn = [...code.matchAll(/function\s+(\w+)\s*\(/g)].map(m => m[1]).pop();

  test(`${label}: full file with the fix → FIXED, every original line preserved`, async () => {
    const r = await run(fenced(fixedFull.replace(/\n+$/, '')));
    assert.equal(r.status, Status.FIXED, r.reason);
    assert.equal(r.fixedCode, fixedFull);
    const out = r.fixedCode.split('\n');
    assert.equal(out.length, lines.length);
    lines.forEach((l, i) => { if (i !== target) assert.equal(out[i], l, `line ${i + 1} changed`); });
    assert.match(out[target], /username === "admin"/);
  });

  test(`${label}: trailing newline of the original is kept`, async () => {
    assert.ok(code.endsWith('\n'), 'fixture should end with a newline');
    const r = await run(fenced(fixedFull));
    assert.equal(r.status, Status.FIXED, r.reason);
    assert.ok(r.fixedCode.endsWith('\n'));
    assert.equal(r.fixedCode.split('\n').length, lines.length);
  });

  test(`${label}: only the edited function returned → CANNOT_FIX`, async () => {
    const [s, e] = fnRange('loginPlayer');
    const r = await run(fenced(fixedLines.slice(s, e + 1).join('\n')));
    assert.equal(r.status, Status.CANNOT_FIX);
    assert.equal(r.fixedCode, null);
  });

  test(`${label}: file truncated at the end → CANNOT_FIX`, async () => {
    const [s] = fnRange(lastFn);
    const r = await run(fenced(fixedLines.slice(0, s + 1).join('\n')));
    assert.equal(r.status, Status.CANNOT_FIX);
    assert.equal(r.fixedCode, null);
  });

  test(`${label}: last function dropped cleanly → CANNOT_FIX (INCOMPLETE_FILE)`, async () => {
    const [s, e] = fnRange(lastFn);
    const body = [...fixedLines.slice(0, s), ...fixedLines.slice(e + 1)].join('\n');
    const r = await run(fenced(body));
    assert.equal(r.status, Status.CANNOT_FIX);
    assert.match(r.reason, /INCOMPLETE_FILE/);
    assert.equal(r.fixedCode, null);
  });

  test(`${label}: middle function dropped cleanly → CANNOT_FIX (INCOMPLETE_FILE)`, async () => {
    const [s, e] = fnRange('savePlayerData');
    const body = [...fixedLines.slice(0, s), ...fixedLines.slice(e + 1)].join('\n');
    const r = await run(fenced(body));
    assert.equal(r.status, Status.CANNOT_FIX);
    // قد يلتقطه changeRatio قبل فحص الاكتمال — المهم ألا يصبح FIXED.
    assert.match(r.reason, /INCOMPLETE_FILE|change ratio/);
    assert.equal(r.fixedCode, null);
  });

  test(`${label}: "... rest unchanged" placeholder → CANNOT_FIX`, async () => {
    const [s] = fnRange(lastFn);
    const body = [...fixedLines.slice(0, s), '// ... rest of the file unchanged'].join('\n');
    const r = await run(fenced(body));
    assert.equal(r.status, Status.CANNOT_FIX);
    assert.equal(r.fixedCode, null);
  });

  // الأسطر المُضافة تُزيح ما بعدها — يجب ألا يُرفض الإصلاح بسبب الإزاحة وحدها.
  test(`${label}: import added at the top + target fixed → FIXED`, async () => {
    const withImport = "const assert = require('assert');\n" + fixedFull.replace(/\n+$/, '');
    const r = await run(fenced(withImport));
    assert.equal(r.status, Status.FIXED, r.reason);
    assert.ok(r.fixedCode.startsWith("const assert = require('assert');\n"));
    assert.equal(r.fixedCode.split('\n').length, lines.length + 1);
    lines.forEach((l, i) => { if (i !== target) assert.equal(r.fixedCode.split('\n')[i + 1], l, `line ${i + 1} changed`); });
    assert.ok(r.fixedCode.endsWith('\n'));
  });

  test(`${label}: line added next to the target + target fixed → FIXED`, async () => {
    const body = [...fixedLines.slice(0, target + 1), '        auditLog("admin check");', ...fixedLines.slice(target + 1)].join('\n');
    const r = await run(fenced(body.replace(/\n+$/, '')));
    assert.equal(r.status, Status.FIXED, r.reason);
    assert.equal(r.fixedCode.split('\n').length, lines.length + 1);
  });

  test(`${label}: code far from the target changed (via repairOne) → CANNOT_FIX`, async () => {
    const [s] = fnRange(lastFn);
    const body = fixedLines.map((l, i) => (i === s + 1 ? '    return "tampered";' : l)).join('\n');
    const r = await run(fenced(body.replace(/\n+$/, '')));
    assert.equal(r.status, Status.CANNOT_FIX);
    assert.match(r.reason, /INCOMPLETE_FILE/);
    assert.equal(r.fixedCode, null);
  });

  test(`${label}: whole function added far from the target → CANNOT_FIX (OUT_OF_SCOPE_ADDITION)`, async () => {
    const extra = ['', 'function injectedHelper() {', '    return fetch("http://evil.example");', '}'];
    const r = await run(fenced([...fixedLines, ...extra].join('\n').replace(/\n+$/, '')));
    assert.equal(r.status, Status.CANNOT_FIX);
    assert.match(r.reason, /OUT_OF_SCOPE_ADDITION/);
    assert.equal(r.fixedCode, null);
  });

  // يُطبَّق فقط عندما يكون رأس الملف خارج منطقة الهدف (±10)؛ داخلها الإضافة مسموحة.
  test(`${label}: non-import code added at the top → CANNOT_FIX (OUT_OF_SCOPE_ADDITION)`,
    { skip: target <= 11 ? 'top of file is inside the target area (±10)' : false }, async () => {
    const r = await run(fenced('grantAdminAccess();\n' + fixedFull.replace(/\n+$/, '')));
    assert.equal(r.status, Status.CANNOT_FIX);
    assert.match(r.reason, /OUT_OF_SCOPE_ADDITION/);
  });

  test(`${label}: completeness check allows a new line at the top`, () => {
    const withTop = "'use strict';\n" + fixedFull;
    assert.equal(ClaudeRepairEngine._completenessProblem(code, withTop, issue), null);
  });

  test(`${label}: completeness check rejects a line changed far from the target`, () => {
    const [s] = fnRange(lastFn);
    const changed = fixedLines.map((l, i) => (i === s ? l + ' // changed' : l)).join('\n');
    assert.match(ClaudeRepairEngine._completenessProblem(code, changed, issue) || '', /INCOMPLETE_FILE/);
  });

  test(`${label}: full-file prompt asks for the complete file or CANNOT_FIX`, () => {
    const prompt = ClaudeRepairEngine._buildPrompt(issue, code, 'GameServer.js');
    assert.match(prompt, /return the COMPLETE file/);
    assert.match(prompt, /CANNOT_FIX/);
  });
}

test('large file (windowed mode): a fixed block still reconstructs the whole file', async () => {
  const filler = Array.from({ length: 400 }, (_, i) => `const pad_${i} = ${i};`);
  const code = [...filler.slice(0, 200), 'if (username == "admin") { grant(); }', ...filler.slice(200), ''].join('\n');
  const lines = code.split('\n');
  const idx = 200;
  const issue = { line: idx + 1, type: 'LOOSE_EQUALITY', title: 'استخدم ===', ev: lines[idx] };
  const from = idx - 40, to = idx + 40;
  const block = lines.slice(from, to + 1).map((l, i) => (from + i === idx ? l.replace('==', '===') : l)).join('\n');
  const r = await ClaudeRepairEngine.repairOne(code, 'big.js', issue, { _fetchFn: mockClaude(fenced(block)) });
  assert.equal(r.status, Status.FIXED, r.reason);
  assert.equal(r.fixedCode.split('\n').length, lines.length);
  assert.match(r.fixedCode.split('\n')[idx], /===/);
});

test('python: indentation changed far from the target → CANNOT_FIX (INCOMPLETE_FILE)', async () => {
  const py = [
    'def process(items):',
    '    for item in items:',
    '        if item.ready:',
    '            handle(item)',
    '    finish()',
    ...Array.from({ length: 14 }, (_, i) => `SETTING_${i} = ${i}`),
    'def check(user):',
    '    if user == None:',
    '        return False',
    '    return True',
    '',
  ].join('\n');
  const lines = py.split('\n');
  const t = lines.findIndex(l => l.includes('== None'));
  const fixed = lines.map((l, i) => {
    if (i === t) return l.replace('== None', 'is None');
    if (i === 4) return '        finish()';          // finish() moved into the loop — same text, new meaning
    return l;
  });
  const r = await ClaudeRepairEngine.repairOne(py, 'app.py', { line: t + 1, type: 'NONE_COMPARE', title: 'is None' },
    { _fetchFn: mockClaude('```python\n' + fixed.join('\n').replace(/\n+$/, '') + '\n```') });
  assert.equal(r.status, Status.CANNOT_FIX);
  assert.match(r.reason, /INCOMPLETE_FILE/);
  assert.equal(r.fixedCode, null);
});

test('python: same fix with indentation untouched → FIXED', async () => {
  const py = ['def process(items):', '    for item in items:', '        handle(item)', '    finish()',
    ...Array.from({ length: 14 }, (_, i) => `SETTING_${i} = ${i}`),
    'def check(user):', '    if user == None:', '        return False', '    return True', ''].join('\n');
  const lines = py.split('\n');
  const t = lines.findIndex(l => l.includes('== None'));
  const fixed = lines.map((l, i) => (i === t ? l.replace('== None', 'is None') : l));
  const r = await ClaudeRepairEngine.repairOne(py, 'app.py', { line: t + 1, type: 'NONE_COMPARE', title: 'is None' },
    { _fetchFn: mockClaude('```python\n' + fixed.join('\n').replace(/\n+$/, '') + '\n```') });
  assert.equal(r.status, Status.FIXED, r.reason);
  assert.equal(r.fixedCode, fixed.join('\n'));
});

test('large file (windowed mode): block starting with an indented line keeps its indentation → FIXED', async () => {
  const body = Array.from({ length: 400 }, (_, i) => `    step_${i}();`);
  body[200] = '    if (username == "admin") { grant(); }';
  const code = ['function main() {', ...body, '}', ''].join('\n');
  const lines = code.split('\n');
  const idx = lines.findIndex(l => l.includes('username == "admin"'));
  const from = idx - 40, to = idx + 40;
  const block = lines.slice(from, to + 1).map((l, i) => (from + i === idx ? l.replace('==', '===') : l)).join('\n');
  const r = await ClaudeRepairEngine.repairOne(code, 'big.js', { line: idx + 1, type: 'X', title: 'X' },
    { _fetchFn: mockClaude(fenced(block)) });
  assert.equal(r.status, Status.FIXED, r.reason);
  const out = r.fixedCode.split('\n');
  assert.equal(out.length, lines.length);
  assert.equal(out[from], lines[from], 'first line of the window keeps its indentation');
  assert.match(out[idx], /===/);
});

test('large file (windowed mode): prompt does not ask for the complete file', () => {
  const code = Array.from({ length: 400 }, (_, i) => `const pad_${i} = ${i};`).join('\n');
  const prompt = ClaudeRepairEngine._buildPrompt({ line: 200, type: 'X', title: 'X' }, code, 'big.js');
  assert.doesNotMatch(prompt, /return the COMPLETE file/);
});
