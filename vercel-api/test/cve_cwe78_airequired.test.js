'use strict';
// المسار المتصفح: cve_patterns.js (CWE-78, conf 97) يغلب نسخة taint (conf 88) في dedupeIssues،
// فكان aiRequired يضيع وتبقى الحالة بلا aiNeeded. الاختبارات تحمّل public/*.js بترتيب index.html.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');

function loadBrowser() {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script src="\/([^"]+\.js)"/g)].map((m) => m[1])
    .filter((f) => !/jszip|jspdf|acorn/.test(f));
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout,
    document: { getElementById: () => null, addEventListener: noop, querySelector: () => null,
      querySelectorAll: () => [], createElement: () => ({ style: {}, appendChild: noop, setAttribute: noop }) },
    localStorage: { getItem: () => null, setItem: noop }, navigator: {},
  };
  ctx.window = ctx; ctx.self = ctx; ctx.global = ctx;
  vm.createContext(ctx);
  for (const f of srcs) {
    const p = path.join(PUBLIC, f);
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

const ctx = loadBrowser();
const H = "const { exec, spawn, execSync } = require('child_process');\nfunction f(req, res){\n";
const cmdIssues = (issues) => issues.filter((i) => /cmd_injection|command injection|cwe-?78/i.test((i.title || '') + (i.type || '') + (i.cwe || '')));
function run(code, file) {
  const issues = ctx.analyzeCode(code, file) || [];
  ctx.F = { [file]: code }; ctx.R = { [file]: { issues } };
  return { issues, out: ctx.repairCode(code, issues, file) };
}
const lines = (arr) => JSON.stringify(arr.map((x) => x.line));

test('browser harness loads the CVE engine', () => {
  assert.strictEqual(typeof ctx.CVEPatterns, 'object');
  assert.strictEqual(typeof ctx.analyzeCode, 'function');
});

for (const [name, call] of [
  ['template literal', "exec(`ls ${req.query.dir}`);"],
  ['exec with callback', "exec('ls ' + req.query.dir, (e, o) => {});"],
  ['spawn', "spawn('ls ' + req.query.dir, { shell: true });"],
  ['execSync', "execSync('ls ' + req.query.dir);"],
]) {
  test(`CWE-78 wins dedupe but keeps aiRequired → aiNeeded — ${name}`, () => {
    const code = H + `  ${call}\n}\n`;
    const { issues, out } = run(code, 'a.js');
    const cmd = cmdIssues(issues);
    assert.strictEqual(cmd.length, 1, 'one issue for the line (no duplicate)');
    assert.strictEqual(cmd[0].cwe, 'CWE-78', 'the CVE issue is the dedupe winner');
    assert.strictEqual(cmd[0].aiRequired, true);
    assert.strictEqual(out.repaired, code, 'no unsafe rewrite');
    assert.strictEqual(lines(out.aiNeeded), '[3]');
  });
}

test('simple exec stays auto-fixed with no aiNeeded (browser)', () => {
  const code = H + "  exec('ls ' + req.query.dir);\n}\n";
  const { out } = run(code, 'a.js');
  assert.notStrictEqual(out.repaired, code);
  assert.strictEqual(out.aiNeeded.length, 0);
});

test('multiline exec (taint winner) still reaches aiNeeded in the browser path', () => {
  const code = H + "  exec(\n    'ls ' + req.query.dir,\n    cb\n  );\n}\n";
  const { issues, out } = run(code, 'a.js');
  assert.strictEqual(cmdIssues(issues).length, 1);
  assert.strictEqual(lines(out.aiNeeded), '[3]');
});

test('safe constant exec is not flagged by the CWE-78 pattern', () => {
  const { issues } = run(H + "  exec('ls /tmp');\n}\n", 'a.js');
  assert.strictEqual(cmdIssues(issues).length, 0);
});

test('python f-string os.system: CWE-78 issue carries aiRequired', () => {
  const { issues } = run("import os\ndef f(name):\n    os.system(f'ls {name}')\n", 'a.py');
  const cmd = cmdIssues(issues);
  assert.strictEqual(cmd.length, 1);
  assert.strictEqual(cmd[0].aiRequired, true);
});
