'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createRepairEngine } = require(path.join(__dirname, '..', 'public', 'server_repair_adapter.js'));

const eng = createRepairEngine();
const HDR = (n) => `const { ${n} } = require('child_process');\nfunction f(req){\n`;
const JS = {
  exec:     HDR('exec')     + "  exec('ls ' + req.query.dir, (e,o)=>{});\n}\n",
  simple:   HDR('exec')     + "  exec('ls ' + req.query.dir);\n}\n",
  execSync: HDR('execSync') + "  execSync('ls ' + req.query.dir);\n}\n",
  spawn:    HDR('spawn')    + "  spawn('ls ' + req.query.dir, {shell:true});\n}\n",
};
const PY = "import os\ndef f(name):\n    os.system('ls ' + name)\n";
const isCmd = (i) => /cmd_injection|command injection/i.test(i.title);

function run(code, file) {
  const issues = eng.analyze(code, file);
  return { issues, out: eng.repair(code, issues, file) };
}

test('detectStrategy: CMD_INJECTION title maps to CMD strategy', () => {
  const { issues } = run(JS.exec, 'a.js');
  assert.ok(issues.some((i) => /^.{0,3}CMD_INJECTION/.test(i.title)), 'taint issue present');
});

for (const k of ['exec', 'execSync', 'spawn']) {
  test(`${k}: single cmd issue per line, aiRequired, reaches aiNeeded`, () => {
    const { issues, out } = run(JS[k], 'a.js');
    const cmd = issues.filter((i) => isCmd(i) && i.line === 3);
    assert.strictEqual(cmd.length, 1, 'no taint+scanner duplicate');
    assert.strictEqual(cmd[0].aiRequired, true);
    assert.strictEqual(out.repaired, JS[k], 'unsafe rewrite not applied');
    assert.strictEqual(out.aiNeeded.length, 1);
    assert.strictEqual(out.aiNeeded[0].line, 3);
  });
}

test('simple exec still auto-fixed, no aiNeeded', () => {
  const { out } = run(JS.simple, 'a.js');
  assert.notStrictEqual(out.repaired, JS.simple);
  assert.strictEqual(out.aiNeeded.length, 0);
});

test('python os.system unchanged: fixed, aiRequired, no aiNeeded', () => {
  const { issues, out } = run(PY, 'a.py');
  const cmd = issues.filter(isCmd);
  assert.strictEqual(cmd.length, 1);
  assert.strictEqual(cmd[0].aiRequired, true);
  assert.notStrictEqual(out.repaired, PY);
  assert.strictEqual(out.aiNeeded.length, 0);
});
