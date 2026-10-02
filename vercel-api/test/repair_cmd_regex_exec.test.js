// اختبارات fixCommandInjection: RegExp.exec ليس أمر shell
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const noop = () => {};
const ctx = { console: { log: noop, warn: noop, error: noop, info: noop } };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'repair_engine.js'), 'utf8'), ctx, { filename: 'repair_engine.js' });
const TITLE = '🔴 Command Injection محتمل';
const run = (code, line, file = 'a.js') =>
  ctx.repairCode(code, [{ line, sev: 'c', type: 'security', title: TITLE, ev: code.split('\n')[line - 1].trim() }], file);

const FIX = {
  'destructured exec': ['const { exec } = require("child_process");\nfunction f(dir) {\n  exec("ls " + dir);\n}\n', 3],
  'cp.exec': ['const cp = require("child_process");\nfunction f(d) {\n  cp.exec("ls " + d);\n}\n', 3],
  'child_process.exec': ['const child_process = require("child_process");\nfunction f(d) {\n  child_process.exec("ls " + d);\n}\n', 3],
  'ESM import { exec }': ['import { exec } from "node:child_process";\nexport function f(d) {\n  exec("ls " + d);\n}\n', 3],
};
for (const [name, [code, line]] of Object.entries(FIX)) {
  test(`command exec still fixed: ${name}`, () => {
    const out = run(code, line);
    assert.notStrictEqual(out.repaired, code);
    assert.match(out.repaired, /exec\(safeArgs\)/);
  });
}

test('os.system still fixed (Python)', () => {
  const out = run('import os\ndef f(d):\n    os.system("ls " + d)\n', 3, 'a.py');
  assert.match(out.repaired, /subprocess\.run\(shlex\.split\(/);
});

const KEEP = {
  'new RegExp(...).exec (learning_engine:590 shape)': ['function m(line, regex) {\n  const result = new RegExp("^" + regex + "$").exec(line);\n  return result;\n}\n', 2],
  'regex literal /x/.exec': ['function m(s, p) {\n  const r = /^a+$/.exec(s + p);\n  return r;\n}\n', 2],
  're = new RegExp; re.exec': ['const re = new RegExp("^" + x);\nfunction m(s) {\n  return re.exec(s + "!");\n}\n', 3],
  'unknown param pattern.exec': ['function m(pattern, s) {\n  return pattern.exec("x" + s);\n}\n', 2],
  'nested parens RegExp': ['function m(a, s) {\n  return new RegExp(a.join(")")).exec("x" + s);\n}\n', 2],
  'db.exec (SQL, not shell)': ['const db = require("better-sqlite3")("a.db");\nfunction f(id) {\n  db.exec("DELETE FROM t WHERE id=" + id);\n}\n', 3],
  'this.re.exec': ['function m(s) {\n  return this.re.exec("x" + s);\n}\n', 2],
};
for (const [name, [code, line]] of Object.entries(KEEP)) {
  test(`not a command → unchanged: ${name}`, () => {
    const out = run(code, line);
    assert.strictEqual(out.repaired, code);
    assert.strictEqual(out.repairs.filter(r => r.strategy === 'CMD_INJECTION').length, 0);
  });
}

test('real file learning_engine.js: RegExp.exec line is not changed', () => {
  const code = fs.readFileSync(path.join(PUBLIC_DIR, 'learning_engine.js'), 'utf8');
  const lines = code.split('\n');
  const line = lines.findIndex(l => l.includes('new RegExp("^" + regex + "$").exec(line)')) + 1;
  assert.ok(line > 0, 'fixture: the line exists');
  const out = run(code, line, 'learning_engine.js');
  assert.strictEqual(out.repaired.split('\n')[line - 1], lines[line - 1]);
  assert.doesNotMatch(out.repaired, /exec\(safeArgs\)/);
});
