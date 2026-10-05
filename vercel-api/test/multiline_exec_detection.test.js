'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createRepairEngine } = require(path.join(__dirname, '..', 'public', 'server_repair_adapter.js'));

const eng = createRepairEngine();
const H = "const { exec, spawn, execSync } = require('child_process');\nfunction f(req, res){\n";
const cmd = (code) => eng.analyze(code, 'a.js').filter((i) => /cmd_injection|command injection/i.test(i.title));
const run = (code) => { const issues = eng.analyze(code, 'a.js'); return eng.repair(code, issues, 'a.js'); };

const ML = {
  'callback on later lines': H + "  exec(\n    'ls ' + req.query.dir,\n    (err, out) => { res.send(out); }\n  );\n}\n",
  'concat continues next line': H + "  exec('ls ' +\n       req.query.dir);\n}\n",
  'template literal + options': H + "  exec(`ls ${req.query.dir}`,\n    { cwd: '/tmp' },\n    cb);\n}\n",
  'execSync': H + "  execSync(\n    'ls ' + req.query.dir\n  );\n}\n",
  'spawn': H + "  spawn(\n    'ls ' + req.query.dir,\n    { shell: true }\n  );\n}\n",
};
for (const [name, code] of Object.entries(ML)) {
  test(`multiline exec detected once, aiRequired, reaches aiNeeded — ${name}`, () => {
    const issues = cmd(code);
    assert.strictEqual(issues.length, 1, 'one issue (no taint+scanner duplicate)');
    assert.strictEqual(issues[0].line, 3, 'reported on the line where the call starts');
    assert.strictEqual(issues[0].aiRequired, true);
    const out = run(code);
    assert.strictEqual(out.repaired, code, 'no deterministic rewrite of a multiline call');
    assert.strictEqual(JSON.stringify(out.aiNeeded.map((x) => x.line)), '[3]');
  });
}

test('multiline exec via tainted variable (taint path)', () => {
  const code = H + "  const d = req.query.dir;\n  exec(\n    'ls ' + d,\n    cb\n  );\n}\n";
  const issues = cmd(code);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].line, 4);
  assert.match(issues[0].title, /CMD_INJECTION: d /);
  assert.strictEqual(run(code).aiNeeded.length, 1);
});

test('constant command; "+" only inside the callback → not flagged', () => {
  const code = H + "  exec(\n    'ls /tmp',\n    (err, out) => { console.log('x' + out); }\n  );\n}\n";
  assert.strictEqual(cmd(code).length, 0);
});

test('multiline RegExp.exec() without concatenation → not flagged', () => {
  const code = "function f(s){\n  const m = /a/.exec(\n    s\n  );\n  return m;\n}\n";
  assert.strictEqual(cmd(code).length, 0);
});

test('unclosed call does not crash or flag', () => {
  const code = H + "  exec(\n    'ls ' + req.query.dir,\n";
  assert.doesNotThrow(() => eng.analyze(code, 'a.js'));
  assert.strictEqual(cmd(code).length, 0);
});

test('single-line exec behaviour unchanged', () => {
  const simple = H + "  exec('ls ' + req.query.dir);\n}\n";
  const si = cmd(simple);
  assert.strictEqual(si.length, 1);
  assert.strictEqual(si[0].line, 3);
  const out = run(simple);
  assert.notStrictEqual(out.repaired, simple, 'simple exec still auto-fixed');
  assert.strictEqual(out.aiNeeded.length, 0);

  const cb = H + "  exec('ls ' + req.query.dir, (e,o)=>{});\n}\n";
  assert.strictEqual(cmd(cb).length, 1);
  assert.strictEqual(JSON.stringify(run(cb).aiNeeded.map((x) => x.line)), '[3]');
});

test('single-line safe code stays clean', () => {
  assert.strictEqual(cmd(H + "  exec('ls /tmp');\n}\n").length, 0);
});

test('exec( inside a trailing comment is not treated as a call', () => {
  const c1 = H + "  const ok = 1; // exec( not a call (see below)\n  const x = 'a' + req.query.b;\n  foo(x);\n}\n";
  assert.strictEqual(cmd(c1).length, 0);
});
