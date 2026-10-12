// ═══════════════════════════════════════════════════════
// _isCommandExecCall — دليل ربط غامض يُرفض (fail-closed)
// تشغيل:  node --test vercel-api/test/repair_cmd_binding_ambiguity.test.js
//
// الحارس يثبت أن المستقبِل مربوط بـchild_process نصيًا. وثلاثة أشكال تُنتج
// دليلًا نصيًا ليس ربطًا، فيمرّ إصلاح أمر shell على استدعاء ليس شِلًّا:
//
//   R1  الدليل داخل نص حرفي:  const tpl = "const cp = require('child_process')";
//   R2  معامل يُظلّل الربط:     function boot(){ const cp = require(...) }
//                              function del(cp, id) { cp.exec(...) }
//   R3  إسناد بعد الربط:       let cp = require(...); cp = openDb();
//
// الثلاثة مقيسة تصل SAFE_AUTO_FIX على مستقبِل قاعدة بيانات:
//   cp.exec('DELETE FROM t WHERE id = ' + id)
//   → const safeArgs = 'DELETE FROM t WHERE id = ' + id.replace(/[^a-zA-Z0-9 ]/g,'')
//   فيُعقَّم استعلام SQL بمعقِّم شِل، ويختفي بلاغ CWE-78 فتُقرَّر المشكلة محلولة
//   بينما الدمج النصّي للمدخل في الاستعلام باقٍ. فشل مفتوح يحجب ثغرة.
//
// حلّ الغموض يحتاج تحليل نطاق/تدفّق. لكن كشفه والرفض عنده لا يحتاجه، وهو
// عقد الدالة المعلن: المستقبِل غير المُثبت يُرفض. فالمطلوب رفض الغامض مع
// الحفاظ على كل ربط child_process شرعي.
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
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'repair_engine.js'), 'utf8'),
    ctx, { filename: 'repair_engine.js' });
  return ctx;
}
const ctx = loadEngine();

const JS_TITLE = 'Command Injection';
// null = رُفض، كائن = طُبّق
const fixOn = (code, line) => ctx.fixCommandInjection(
  code,
  { line, title: JS_TITLE, strategy: 'CMD_INJECTION', severity: 'critical' },
  code.split('\n'), null, 'app.js'
);

const Q = "'DELETE FROM t WHERE id = ' + id";

// ═══ 1. الدليل الغامض يُرفض ════════════════════════════

const AMBIGUOUS = [
  ['R1 الدليل داخل نص حرفي',
   `const tpl = "const cp = require('child_process')";\nconst cp = openDb();\nfunction del(id) {\n  cp.exec(${Q});\n}\n`, 4],
  ['R1 الدليل داخل نص بعلامة مفردة',
   `const tpl = 'const cp = require("child_process")';\nconst cp = openDb();\nfunction del(id) {\n  cp.exec(${Q});\n}\n`, 4],
  ['R1 الدليل داخل template literal',
   `const tpl = \`const cp = require('child_process')\`;\nconst cp = openDb();\nfunction del(id) {\n  cp.exec(${Q});\n}\n`, 4],
  ['R2 معامل يُظلّل الربط',
   `function boot() { const cp = require('child_process'); cp.exec('ls'); }\nfunction del(cp, id) {\n  cp.exec(${Q});\n}\n`, 3],
  ['R2 معامل في دالة سهمية',
   `const boot = () => { const cp = require('child_process'); cp.exec('ls'); };\nconst del = (cp, id) => {\n  cp.exec(${Q});\n};\n`, 3],
  ['R3 إسناد بعد الربط',
   `let cp = require('child_process');\ncp = openDb();\nfunction del(id) {\n  cp.exec(${Q});\n}\n`, 4],
  ['R3 إسناد من دالة أخرى',
   `let cp = require('child_process');\ncp = makeClient();\nfunction del(id) {\n  cp.exec(${Q});\n}\n`, 4],
];

for (const [label, code, line] of AMBIGUOUS) {
  test(`ambiguous binding rejected: ${label}`, () => {
    assert.strictEqual(fixOn(code, line), null,
      `${label}: الدليل النصّي ليس ربطًا — تعقيم أمر shell على هذا الاستدعاء يخرّبه ويحجب الثغرة`);
  });
}

// ═══ 2. كل ربط child_process شرعي يبقى مُصلَحًا ════════
// التشديد لا يجوز أن يخسر أي تغطية قائمة.

const LEGITIMATE = [
  ['exec مباشر (destructured)',
   `const { exec } = require('child_process');\nfunction del(id) {\n  exec(${Q});\n}\n`, 3],
  ['const cp = require',
   `const cp = require('child_process');\nfunction del(id) {\n  cp.exec(${Q});\n}\n`, 3],
  ['require().exec مباشر',
   `function del(id) {\n  require('child_process').exec(${Q});\n}\n`, 2],
  ['node: prefix',
   `const cp = require('node:child_process');\nfunction del(id) {\n  cp.exec(${Q});\n}\n`, 3],
  ['let cp; ثم إسناد مجرّد من require',
   `let cp;\ncp = require('child_process');\nfunction del(id) {\n  cp.exec(${Q});\n}\n`, 4],
  ['إسنادان كلاهما child_process',
   `let cp = require('child_process');\nif (!cp) cp = require('node:child_process');\nfunction del(id) {\n  cp.exec(${Q});\n}\n`, 4],
  ['import cp from',
   `import cp from 'child_process';\nfunction del(id) {\n  cp.exec(${Q});\n}\n`, 3],
  ['import * as cp',
   `import * as cp from 'child_process';\nfunction del(id) {\n  cp.exec(${Q});\n}\n`, 3],
  ['import cp, { spawn }',
   `import cp, { spawn } from 'child_process';\nfunction del(id) {\n  cp.exec(${Q});\n}\n`, 3],
  ['TS import cp = require',
   `import cp = require('child_process');\nfunction del(id) {\n  cp.exec(${Q});\n}\n`, 3],
  ['نصّ حرفي غير ذي صلة في الملف',
   `const msg = "use child_process carefully";\nconst cp = require('child_process');\nfunction del(id) {\n  cp.exec(${Q});\n}\n`, 4],
  ['معامل باسم مختلف لا يُظلّل',
   `const cp = require('child_process');\nfunction del(other, id) {\n  cp.exec(${Q});\n}\n`, 3],
];

for (const [label, code, line] of LEGITIMATE) {
  test(`legitimate binding still fixed: ${label}`, () => {
    assert.notStrictEqual(fixOn(code, line), null,
      `${label}: ربط child_process شرعي — التشديد لا يجوز أن يكسره`);
  });
}

// ═══ 3. السلوك القائم محفوظ ════════════════════════════

test('existing: مستقبِل مجهول يبقى مرفوضًا', () => {
  assert.strictEqual(fixOn(`const cp = openDb();\nfunction del(id) {\n  cp.exec(${Q});\n}\n`, 3), null);
});

test('existing: RegExp.exec يبقى مرفوضًا', () => {
  assert.strictEqual(fixOn(`const re = /a(\\d)/;\nfunction m(s) {\n  return re.exec(s + '!');\n}\n`, 3), null);
});

test('existing: db.exec يبقى مرفوضًا', () => {
  assert.strictEqual(fixOn(`const db = openDb();\nfunction del(id) {\n  db.exec(${Q});\n}\n`, 3), null);
});

// ═══ 4. الحارس الثاني يرفض نفس الغموض ═════════════════
// candidate من مصدر ثانٍ لنفس السطر يجب أن يُرفض كذلك.

function synthCandidate(code, lineNo) {
  const lines = code.split('\n');
  const line = lines[lineNo - 1];
  const indent = ' '.repeat(line.search(/\S/));
  const arg = line.match(/exec\s*\(([^)]+)\)/)?.[1] || 'command';
  const safeLine = line.replace(/exec\s*\([^)]+\)/, 'exec(safeArgs)');
  lines.splice(lineNo - 1, 1,
    `${indent}// SECURITY: validate input before exec`,
    `${indent}const safeArgs = ${arg}.replace(/[^a-zA-Z0-9 ]/g, '');`,
    safeLine);
  return lines.join('\n');
}

for (const [label, code, line] of AMBIGUOUS) {
  test(`verifier rejects the same ambiguity: ${label}`, () => {
    const problem = ctx.cmdCandidateProblem(code, synthCandidate(code, line), line, 'CMD_INJECTION');
    assert.ok(problem, `${label}: الـverifier يجب أن يرفض candidate لربط غامض`);
    assert.match(String(problem), /^CMD_NOT_COMMAND_EXEC/, label);
  });
}
