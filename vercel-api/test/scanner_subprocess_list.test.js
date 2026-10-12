// ═══════════════════════════════════════════════════════
// security_scanner — subprocess بقائمة وسائط ليست command injection
// تشغيل:  node --test vercel-api/test/scanner_subprocess_list.test.js
//
// الكاشف يطابق subprocess.(run|Popen|call|check_output)( + وجود "+" أو f-string
// في السطر، بلا أي فحص لـshell=True ولا لشكل الوسيطة:
//
//   subprocess.run(shlex.split("ls " + x), check=True)   → 🔴 حرجة
//
// بلا shell=True وبقائمة وسائط لا يُستدعى شِل أصلًا، فلا تُحقن metacharacters.
// والمفارقة أن توصية الكاشف نفسه هي "استخدم قائمة arguments بدل string" —
// فهو يُبلّغ عن علاجه الموصى به كثغرة حرجة. وهذا FP يُسقِط إصلاحًا حتميًا
// صحيحًا من SAFE_AUTO_FIX إلى AI_SUGGESTION.
//
// المطلوب: يبقى shell=True وتمرير command string مكشوفين، وتُستثنى القائمة.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadScanner() {
  const noop = () => {};
  const ctx = vm.createContext({ console: { log: noop, warn: noop, error: noop, info: noop }, window: {}, global: {} });
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'security_scanner.js'), 'utf8'),
    ctx, { filename: 'security_scanner.js' });
  return ctx;
}
const ctx = loadScanner();

const scanFn = ctx.scanSecurity || ctx.securityScan || ctx.scan ||
  (ctx.window && (ctx.window.scanSecurity || ctx.window.SecurityScanner));
assert.strictEqual(typeof scanFn, 'function', 'fixture: security_scanner يصدّر دالة فحص');

// بلاغات Command Injection وحدها
const cmdFindings = (code, file = 's.py') =>
  Array.from(scanFn(code, file) || []).filter(i => /Command Injection/i.test(String(i.title)));

// ═══ 1. الآمن: قائمة وسائط بلا shell=True ⇒ لا بلاغ ═════

const SAFE = {
  'shlex.split مع concat':        'import subprocess, shlex\ndef f(x):\n    subprocess.run(shlex.split("ls " + x), check=True, capture_output=True)\n',
  'shlex.split مع f-string':      'import subprocess, shlex\ndef f(x):\n    subprocess.run(shlex.split(f"ls {x}"), check=True)\n',
  'قائمة حرفية مع concat':        'import subprocess\ndef f(x):\n    subprocess.run(["ls", "-la", x + "/sub"], check=True)\n',
  'Popen بقائمة':                 'import subprocess\ndef f(x):\n    subprocess.Popen(["git", "log", x + "~1"])\n',
  'check_output بقائمة':          'import subprocess\ndef f(x):\n    subprocess.check_output(["cat", x + ".txt"])\n',
  'shell=False صريح مع قائمة':    'import subprocess, shlex\ndef f(x):\n    subprocess.run(shlex.split("ls " + x), shell=False)\n',
};
for (const [name, code] of Object.entries(SAFE)) {
  test(`لا بلاغ: ${name}`, () => {
    assert.deepStrictEqual(cmdFindings(code).map(i => i.title), [],
      `${name}: قائمة وسائط بلا shell=True لا تستدعي شِلًّا — البلاغ زائف`);
  });
}

// ═══ 2. الخطر الحقيقي: يبقى مكشوفًا ═══════════════════

const DANGEROUS = {
  'shell=True مع concat':             'import subprocess\ndef f(x):\n    subprocess.run("ls " + x, shell=True)\n',
  'shell=True مع f-string':           'import subprocess\ndef f(x):\n    subprocess.run(f"ls {x}", shell=True)\n',
  'shell=True ولو مع قائمة':          'import subprocess, shlex\ndef f(x):\n    subprocess.run(shlex.split("ls " + x), shell=True)\n',
  'command string بلا قائمة':         'import subprocess\ndef f(x):\n    subprocess.run("ls " + x, check=True)\n',
  'Popen بسلسلة نصية':                'import subprocess\ndef f(x):\n    subprocess.Popen("git log " + x)\n',
  'check_output بـf-string نصية':     'import subprocess\ndef f(x):\n    subprocess.check_output(f"cat {x}.txt")\n',
  'os.system (شِل دائمًا)':           'import os\ndef f(x):\n    os.system("ls " + x)\n',
  'os.system مع f-string':            'import os\ndef f(x):\n    os.system(f"ls {x}")\n',
  'exec JS':                          'const { exec } = require("child_process");\nexec("ls " + dir);\n',
  'spawn JS':                         'const { spawn } = require("child_process");\nspawn("sh", ["-c", "ls " + dir]);\n',
  'os.system مع قائمة آمنة بنفس السطر': 'import os, subprocess, shlex\ndef f(x):\n    os.system("ls " + x); subprocess.run(shlex.split("ls " + x))\n',
};
for (const [name, code] of Object.entries(DANGEROUS)) {
  test(`يبقى مكشوفًا: ${name}`, () => {
    const found = cmdFindings(code, /require\(|=>/.test(code) ? 'a.js' : 's.py');
    assert.ok(found.length >= 1, `${name}: خطر حقيقي يجب أن يبقى مبلَّغًا عنه`);
    assert.strictEqual(found[0].sev, 'c', `${name}: الشدّة تبقى حرجة`);
  });
}

// ═══ 3. بلا مدخل مدموج ⇒ لا بلاغ (سلوك قائم) ══════════

test('لا بلاغ: أمر ثابت بلا دمج مدخل', () => {
  assert.deepStrictEqual(cmdFindings('import os\nos.system("ls -la")\n').map(i => i.title), []);
});

test('لا بلاغ: subprocess بقائمة ثابتة', () => {
  assert.deepStrictEqual(cmdFindings('import subprocess\nsubprocess.run(["ls", "-la"])\n').map(i => i.title), []);
});
