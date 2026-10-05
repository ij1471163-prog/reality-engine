'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createRepairEngine } = require(path.join(__dirname, '..', 'public', 'server_repair_adapter.js'));

const eng = createRepairEngine();
const H = (n) => `const { ${n} } = require('child_process');\nfunction f(req){\n`;
const cmdIssues = (code, file) =>
  eng.analyze(code, file).filter((i) => /cmd_injection|command injection/i.test(i.title));
const taintOn = (code, v) =>
  eng.analyze(code, 'a.js').filter((i) => i.type === 'taint' && i.title.includes(`CMD_INJECTION: ${v} `));

const ALLOW = "/[^a-zA-Z0-9 ]/g, ''";

test('exec("ls "+req.query.dir): fixer output leaves no CMD issue (safeArgs not tainted)', () => {
  const code = H('exec') + "  exec('ls ' + req.query.dir);\n}\n";
  const issues = eng.analyze(code, 'a.js');
  const out = eng.repair(code, issues, 'a.js');
  assert.notStrictEqual(out.repaired, code, 'fixer applied');
  assert.match(out.repaired, /safeArgs/);
  assert.strictEqual(taintOn(out.repaired, 'safeArgs').length, 0);
  assert.strictEqual(cmdIssues(out.repaired, 'a.js').length, 0);
});

test('allowlist replace assigned then exec(safeArgs): no CMD_INJECTION', () => {
  const code = H('exec') + `  const safeArgs = 'ls ' + req.query.dir.replace(${ALLOW});\n  exec(safeArgs);\n}\n`;
  assert.strictEqual(cmdIssues(code, 'a.js').length, 0);
});

for (const [name, rep] of [
  ['non-regex replace', "replace('a','b')"],
  ['blacklist regex', "replace(/;/g, '')"],
  ['allowlist with non-empty replacement', "replace(/[^a-zA-Z0-9 ]/g, '_')"],
  ['allowlist without g flag', "replace(/[^a-zA-Z0-9 ]/, '')"],
]) {
  test(`${name} is NOT treated as a sanitizer`, () => {
    const code = H('exec') + `  const x = 'ls ' + req.query.dir.${rep};\n  exec(x);\n}\n`;
    assert.strictEqual(taintOn(code, 'x').length, 1);
  });
}

test('a + b.replace(allowlist): a still taints the result', () => {
  const code = H('exec') +
    `  const a = req.query.a; const b = req.query.b;\n  const x = 'ls ' + a + b.replace(${ALLOW});\n  exec(x);\n}\n`;
  assert.strictEqual(taintOn(code, 'x').length, 1);
});

test('only b sanitized: result clean', () => {
  const code = H('exec') +
    `  const b = req.query.b;\n  const x = 'ls ' + b.replace(${ALLOW});\n  exec(x);\n}\n`;
  assert.strictEqual(taintOn(code, 'x').length, 0);
});

test('execSync / spawn behave as before (taint on dir)', () => {
  for (const [n, call] of [['execSync', "execSync('ls ' + req.query.dir);"], ['spawn', "spawn('ls ' + req.query.dir, {shell:true});"]]) {
    const code = H(n) + `  ${call}\n}\n`;
    assert.strictEqual(taintOn(code, 'dir').length, 1, n);
    const out = eng.repair(code, eng.analyze(code, 'a.js'), 'a.js');
    assert.strictEqual(out.repaired, code, `${n} untouched`);
  }
});

test('python os.system unchanged', () => {
  const py = "import os\ndef f(name):\n    os.system('ls ' + name)\n";
  const issues = eng.analyze(py, 'a.py');
  assert.strictEqual(issues.filter((i) => /os\.system/.test(i.title)).length, 1);
  const out = eng.repair(py, issues, 'a.py');
  assert.notStrictEqual(out.repaired, py);
  assert.match(out.repaired, /shlex|subprocess/);
});
