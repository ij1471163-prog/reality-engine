// ═══════════════════════════════════════════════════════
// اختبارات رفض candidate CMD غير السليم في repair_engine.js
// تشغيل:  node --test vercel-api/test/repair_cmd_candidate.test.js
//
// candidate لـCMD_INJECTION / CMD_INJECTION_PY يكسر السطر أو يعقّم الجزء الخطأ
// لا يُعتمد: repairedCode يبقى كما هو، المشكلة لا تُحذف، و aiRequired تستمر إلى aiNeeded.
// الحالات السليمة تبقى حرفيًا نفس ناتج الـfixer.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

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
const JS_TITLE = 'Command Injection';
const PY_TITLE = 'os.system Command Injection';

function run(code, file, line, ev, extra) {
  const title = file.endsWith('.py') ? PY_TITLE : JS_TITLE;
  const issues = [{ line, title, ev, ...(extra || {}) }];
  const snapshot = JSON.stringify(issues);
  const out = ctx.repairCode(code, issues, file);
  assert.strictEqual(JSON.stringify(issues), snapshot, 'issues must not be modified');
  return out;
}

// الناتج المرجعي = الـfixer الأصلي مباشرة (لم يتغير)
function fixerOutput(code, file, line) {
  const fn = file.endsWith('.py') ? ctx.fixCommandInjectionPy : ctx.fixCommandInjection;
  return fn(code, { line }, code.split('\n'), null, file).fixed;
}

function assertRejected(code, file, line, ev, reasonRe) {
  const out = run(code, file, line, ev);
  assert.strictEqual(out.repaired, code, 'rejected candidate must not change repairedCode');
  assert.strictEqual(out.repairs.length, 0);
  assert.strictEqual(out.rejected.length, 1);
  assert.match(out.rejected[0].reason, reasonRe);
  assert.strictEqual(out.rejected[0].line, line);

  const ai = run(code, file, line, ev, { aiRequired: true });
  assert.strictEqual(ai.repaired, code);
  assert.strictEqual(ai.aiNeeded.length, 1, 'aiRequired issue must continue to aiNeeded');
  assert.strictEqual(ai.aiNeeded[0].line, line);
  assert.match(ai.aiNeeded[0].strategy, /^CMD_INJECTION/);
}

function assertAccepted(code, file, line, ev) {
  const out = run(code, file, line, ev);
  assert.strictEqual(out.rejected.length, 0);
  assert.strictEqual(out.repairs.length, 1);
  assert.strictEqual(out.repaired, fixerOutput(code, file, line), 'sound fix must equal the original fixer output');
  assert.notStrictEqual(out.repaired, code);
}

// ═══ JS — رفض ═════════════════════════════════════════
test('JS: exec with callback → rejected (candidate does not parse)', () => {
  const code = 'const { exec } = require("child_process");\nexec("ls " + dir, (err, out) => { console.log(out); });';
  assertRejected(code, 'a.js', 2, 'exec("ls " + dir', /^CMD_SYNTAX_INVALID/);
});

test('JS: exec with options → rejected (options dropped)', () => {
  const code = 'exec("ls " + dir, { cwd: base });';
  assertRejected(code, 'a.js', 1, 'exec("ls " + dir', /^CMD_ARGS_DROPPED/);
});

test('JS: variable not at the end → rejected (sanitizer on the literal)', () => {
  const code = 'exec("ls " + dir + " -la");';
  assertRejected(code, 'a.js', 1, 'exec("ls " + dir', /^CMD_SANITIZE_WRONG_PART/);
});

test('JS: two variables → rejected (one input left unsanitized)', () => {
  const code = 'exec("cp " + src + " " + dst);';
  assertRejected(code, 'a.js', 1, 'exec("cp " + src', /^CMD_UNSANITIZED_INPUT/);
});

test('JS: template literal → rejected (whole command stripped)', () => {
  const code = 'exec(`ls -la ${dir}`);';
  assertRejected(code, 'a.js', 1, 'exec(`ls -la ${dir}`)', /^CMD_SANITIZE_WRONG_PART/);
});

test('JS: exec twice on one line → rejected (second call unprotected)', () => {
  const code = 'exec("ls " + a); exec("rm " + b);';
  assertRejected(code, 'a.js', 1, 'exec("ls " + a)', /^CMD_MULTIPLE_CALLS/);
});

test('JS: exec twice in the same block → second candidate rejected (duplicate const safeArgs)', () => {
  const code = [
    'function f(a, b) {',
    '  exec("ls " + a);',
    '  exec("rm " + b);',
    '}',
  ].join('\n');
  const issues = [
    { line: 2, title: JS_TITLE, ev: 'exec("ls " + a)' },
    { line: 3, title: JS_TITLE, ev: 'exec("rm " + b)' },
  ];
  const out = ctx.repairCode(code, issues, 'a.js');
  assert.strictEqual(out.repairs.length, 1);
  assert.strictEqual(out.rejected.length, 1);
  assert.strictEqual(out.rejected[0].line, 2);
  assert.match(out.rejected[0].reason, /^CMD_SYNTAX_INVALID — safeArgs is already declared/);
  assert.strictEqual(out.repaired, fixerOutput(code, 'a.js', 3), 'only the accepted fix is applied');
});

test('JS: exec in two different functions → both accepted', () => {
  const code = [
    'function f(a) {',
    '  exec("ls " + a);',
    '}',
    'function g(b) {',
    '  exec("rm " + b);',
    '}',
  ].join('\n');
  const issues = [
    { line: 2, title: JS_TITLE, ev: 'exec("ls " + a)' },
    { line: 5, title: JS_TITLE, ev: 'exec("rm " + b)' },
  ];
  const out = ctx.repairCode(code, issues, 'a.js');
  assert.strictEqual(out.rejected.length, 0);
  assert.strictEqual(out.repairs.length, 2);
});

// ═══ JS — سليم (نفس الناتج حرفيًا) ════════════════════
test('JS: "ls -la /var/" + dir → accepted, identical to fixer output', () => {
  const code = 'const { exec } = require("child_process");\nexec("ls -la /var/" + dir);';
  assertAccepted(code, 'a.js', 2, 'exec("ls -la /var/" + dir)');
  assert.strictEqual(run(code, 'a.js', 2, 'exec("ls -la /var/" + dir)').repaired, [
    'const { exec } = require("child_process");',
    '// SECURITY: validate input before exec',
    'const safeArgs = "ls -la /var/" + dir.replace(/[^a-zA-Z0-9 ]/g, \'\');',
    'exec(safeArgs);',
  ].join('\n'));
});

// ═══ Python — رفض ═════════════════════════════════════
test('PY: assignment → rejected (result variable dropped)', () => {
  const code = 'import os\nrc = os.system("ls " + d)';
  assertRejected(code, 'a.py', 2, 'os.system(', /^CMD_CONTEXT_LOST/);
});

test('PY: return → rejected (return dropped)', () => {
  const code = 'import os\ndef f(d):\n    return os.system("ls " + d)';
  assertRejected(code, 'a.py', 3, 'os.system(', /^CMD_CONTEXT_LOST/);
});

test('PY: if → rejected (condition and colon dropped)', () => {
  const code = 'import os\nif os.system("ls " + d) == 0:\n    print("ok")';
  assertRejected(code, 'a.py', 2, 'os.system(', /^CMD_CONTEXT_LOST/);
});

// ═══ Python — سليم (نفس الناتج حرفيًا) ════════════════
test('PY: os.system(...) as a standalone statement → accepted, identical to fixer output', () => {
  const code = 'import os\ndef f(d):\n    os.system("ls " + d)';
  assertAccepted(code, 'a.py', 3, 'os.system(');
  assert.strictEqual(run(code, 'a.py', 3, 'os.system(').repaired, [
    'import subprocess',
    'import shlex',
    'import os',
    'def f(d):',
    '    subprocess.run(shlex.split("ls " + d), check=True, capture_output=True)',
  ].join('\n'));
});
