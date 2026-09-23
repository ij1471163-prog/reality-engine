// ═══════════════════════════════════════════════════════
// اختبارات import shlex في إصلاح CMD_INJECTION_PY (repair_engine.js)
// تشغيل:  node --test vercel-api/test/repair_cmd_shlex_import.test.js
//
// الإصلاح يكتب shlex.split(...)؛ إذا كان subprocess مستوردًا أصلًا
// يجب أن يُضاف import shlex أيضًا — وإلا NameError عند التشغيل.
// الحالات التي كانت سليمة تبقى حرفيًا بنفس الناتج.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const noop = () => {};
const ctx = { console: { log: noop, warn: noop, error: noop, info: noop } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'repair_engine.js'), 'utf8'), ctx,
  { filename: 'repair_engine.js' });

function fix(code) {
  const line = code.split('\n').findIndex(l => l.includes('os.system')) + 1;
  const out = ctx.repairCode(code, [{ line, title: 'os.system Command Injection', ev: 'os.system(' }], 'a.py');
  assert.strictEqual(out.repairs.length, 1);
  assert.strictEqual(out.rejected.length, 0);
  return out.repaired;
}

const CALL = '    subprocess.run(shlex.split("ls " + d), check=True, capture_output=True)';

// ═══ الحالة المكسورة سابقًا ═══════════════════════════
test('subprocess imported, shlex missing → import shlex added after import subprocess', () => {
  assert.strictEqual(fix('import os\nimport subprocess\ndef f(d):\n    os.system("ls " + d)'),
    ['import os', 'import subprocess', 'import shlex', 'def f(d):', CALL].join('\n'));
});

test('import subprocess, os → import shlex added on the next line', () => {
  assert.strictEqual(fix('import subprocess, os\ndef f(d):\n    os.system("ls " + d)'),
    ['import subprocess, os', 'import shlex', 'def f(d):', CALL].join('\n'));
});

test('from shlex import split / import shlex as sh do not bind shlex → import shlex added', () => {
  assert.match(fix('import os\nimport subprocess\nfrom shlex import split\ndef f(d):\n    os.system("ls " + d)'),
    /^import subprocess\nimport shlex$/m);
  assert.match(fix('import os\nimport subprocess\nimport shlex as sh\ndef f(d):\n    os.system("ls " + d)'),
    /^import subprocess\nimport shlex$/m);
});

test('from __future__ first → import shlex does not move above it', () => {
  const out = fix('from __future__ import annotations\nimport os\nimport subprocess\ndef f(d):\n    os.system("ls " + d)');
  assert.ok(out.startsWith('from __future__ import annotations\n'));
  assert.match(out, /^import subprocess\nimport shlex$/m);
});

test('import subprocess inside a function → import shlex in the same scope', () => {
  assert.strictEqual(fix('import os\ndef f(d):\n    import subprocess\n    os.system("ls " + d)'),
    ['import os', 'def f(d):', '    import subprocess', '    import shlex', CALL].join('\n'));
});

// ═══ الحالات السليمة — نفس الناتج السابق حرفيًا ══════════
test('no imports → unchanged output (import subprocess + import shlex prepended)', () => {
  assert.strictEqual(fix('import os\ndef f(d):\n    os.system("ls " + d)'),
    ['import subprocess', 'import shlex', 'import os', 'def f(d):', CALL].join('\n'));
});

test('subprocess and shlex already imported → unchanged output (nothing added)', () => {
  assert.strictEqual(fix('import os\nimport subprocess\nimport shlex\ndef f(d):\n    os.system("ls " + d)'),
    ['import os', 'import subprocess', 'import shlex', 'def f(d):', CALL].join('\n'));
  assert.strictEqual(fix('import os, subprocess, shlex\ndef f(d):\n    os.system("ls " + d)'),
    ['import subprocess', 'import shlex', 'import os, subprocess, shlex', 'def f(d):', CALL].join('\n'));
});
