// ═══════════════════════════════════════════════════════
// CMD rejection states → aiNeeded (الجولة 4)
// تشغيل:  node --test vercel-api/test/repair_cmd_rejection_ai.test.js
//
// candidate CMD مرفوض (CMD_SYNTAX_INVALID / CMD_SANITIZE_WRONG_PART / ...) يعني أن الثغرة
// ما زالت قائمة ولا يوجد إصلاح حتمي آمن. يجب أن يصل إلى aiNeeded حتى لو الـissue
// لم تحمل aiRequired (الـorchestrator يقرأ aiNeeded فقط؛ rejected لا يصل لأحد).
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const { createRepairEngine } = require(path.join(PUBLIC_DIR, 'server_repair_adapter.js'));

function loadEngine() {
  const noop = () => {};
  const ctx = { console: { log: noop, warn: noop, error: noop, info: noop } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'repair_engine.js'), 'utf8'), ctx,
    { filename: 'repair_engine.js' });
  return ctx;
}

const ctx = loadEngine();
const TITLE = { js: 'Command Injection', py: 'os.system Command Injection' };

function run(code, file, line, extra) {
  const lang = file.endsWith('.py') ? 'py' : 'js';
  const issues = [{ line, title: TITLE[lang], ev: code.split('\n')[line - 1].trim().slice(0, 20), ...(extra || {}) }];
  return ctx.repairCode(code, issues, file);
}

// [اسم, كود, ملف, سطر, نمط سبب الرفض]
const REJECTIONS = [
  ['CMD_SYNTAX_INVALID (exec callback)',        'exec("ls " + d, (e, o) => {});',      'a.js', 1, /^CMD_SYNTAX_INVALID/],
  ['CMD_ARGS_DROPPED (exec options)',           'exec("ls " + d, { cwd: b });',        'a.js', 1, /^CMD_ARGS_DROPPED/],
  ['CMD_SANITIZE_WRONG_PART (var not last)',    'exec("ls " + d + " -la");',           'a.js', 1, /^CMD_SANITIZE_WRONG_PART/],
  ['CMD_SANITIZE_WRONG_PART (template)',        'exec(`ls ${d}`);',                    'a.js', 1, /^CMD_SANITIZE_WRONG_PART/],
  ['CMD_UNSANITIZED_INPUT (two inputs)',        'exec("cp " + s + " " + t);',          'a.js', 1, /^CMD_UNSANITIZED_INPUT/],
  ['CMD_MULTIPLE_CALLS',                        'exec("ls " + a); exec("rm " + b);',   'a.js', 1, /^CMD_MULTIPLE_CALLS/],
  ['CMD_CONTEXT_LOST (py assignment)',          'import os\nrc = os.system("ls " + d)', 'a.py', 2, /^CMD_CONTEXT_LOST/],
  ['CMD_CONTEXT_LOST (py return)',              'import os\ndef f(d):\n    return os.system("ls " + d)', 'a.py', 3, /^CMD_CONTEXT_LOST/],
  ['CMD_CONTEXT_LOST (py if)',                  'import os\nif os.system("ls " + d) == 0:\n    pass', 'a.py', 2, /^CMD_CONTEXT_LOST/],
];

for (const [name, code, file, line, re] of REJECTIONS) {
  test(`${name}: rejected candidate without aiRequired reaches aiNeeded`, () => {
    const out = run(code, file, line);
    assert.strictEqual(out.repaired, code, 'rejected candidate must not change the code');
    assert.strictEqual(out.repairs.length, 0);
    assert.strictEqual(out.rejected.length, 1, 'rejection stays recorded');
    assert.match(out.rejected[0].reason, re);
    assert.strictEqual(out.aiNeeded.length, 1, 'rejected candidate must not be dropped');
    assert.strictEqual(out.aiNeeded[0].line, line);
    assert.match(out.aiNeeded[0].strategy, /^CMD_INJECTION/);
    assert.ok(out.aiNeeded[0].reason, 'aiNeeded entry keeps its AI reason');
    assert.strictEqual(out.aiNeeded[0].rejectionReason, out.rejected[0].reason, 'AI sees why the candidate was rejected');
    assert.strictEqual(out.summary.needsAI, 1);
  });

  test(`${name}: with aiRequired there is exactly one aiNeeded entry (no duplicate)`, () => {
    const out = run(code, file, line, { aiRequired: true });
    assert.strictEqual(out.repaired, code);
    assert.strictEqual(out.rejected.length, 1);
    assert.strictEqual(out.aiNeeded.length, 1);
    assert.strictEqual(out.aiNeeded[0].rejectionReason, out.rejected[0].reason);
  });
}

test('second exec in the same block rejected (duplicate safeArgs) → that line reaches aiNeeded, first still fixed', () => {
  const code = ['function f(a, b) {', '  exec("ls " + a);', '  exec("rm " + b);', '}'].join('\n');
  const issues = [
    { line: 2, title: TITLE.js, ev: 'exec("ls " + a)' },
    { line: 3, title: TITLE.js, ev: 'exec("rm " + b)' },
  ];
  const out = ctx.repairCode(code, issues, 'a.js');
  assert.strictEqual(out.repairs.length, 1);
  assert.strictEqual(out.rejected.length, 1);
  assert.match(out.rejected[0].reason, /^CMD_SYNTAX_INVALID — safeArgs is already declared/);
  assert.strictEqual(out.aiNeeded.length, 1);
  assert.strictEqual(out.aiNeeded[0].line, 2);
});

test('sound CMD fix without aiRequired: no rejection, no aiNeeded', () => {
  for (const [code, file, line] of [['exec("ls -la /var/" + d);', 'a.js', 1], ['import os\ndef f(d):\n    os.system("ls " + d)', 'a.py', 3]]) {
    const out = run(code, file, line);
    assert.strictEqual(out.rejected.length, 0);
    assert.strictEqual(out.aiNeeded.length, 0);
    assert.strictEqual(out.repairs.length, 1);
    assert.notStrictEqual(out.repaired, code);
  }
});

test('scope guard: TARGET_IN_LITERAL (exec inside a string) is not a vulnerability → not routed to aiNeeded without aiRequired', () => {
  const code = 'const s = \'exec("ls " + d)\';';
  const out = run(code, 'a.js', 1);
  assert.strictEqual(out.repaired, code);
  assert.strictEqual(out.rejected.length, 1);
  assert.match(out.rejected[0].reason, /^TARGET_IN_LITERAL/);
  assert.strictEqual(out.aiNeeded.length, 0);
});

test('scope guard: non-CMD rejections (XSS res.send → res.json) are not routed to aiNeeded without aiRequired', () => {
  const code = 'app.get("/", (req, res) => {\n  res.send("<b>" + req.query.x + "</b>");\n});';
  const out = ctx.repairCode(code, [{ line: 2, title: 'XSS innerHTML', ev: 'res.send(' }], 'a.js');
  assert.strictEqual(out.rejected.length, 1);
  assert.match(out.rejected[0].reason, /^XSS_RESPONSE_CHANGED/);
  assert.strictEqual(out.aiNeeded.length, 0);
});

test('real pipeline (analyze → repair): rejected CMD candidates reach aiNeeded', () => {
  const eng = createRepairEngine();
  const H = 'const { exec } = require("child_process");\nfunction f(req){\n';
  const cases = [
    [H + '  exec("ls " + req.query.d, (e,o)=>{});\n}\n', 'a.js'],
    [H + '  exec("ls " + req.query.d + " -la");\n}\n', 'a.js'],
    ['import os\ndef f(d):\n    rc = os.system("ls " + d)\n', 'a.py'],
  ];
  for (const [code, file] of cases) {
    const issues = eng.analyze(code, file);
    const out = eng.repair(code, issues, file);
    assert.strictEqual(out.repaired, code, file);
    assert.strictEqual(out.aiNeeded.length, 1, file);
  }
});
