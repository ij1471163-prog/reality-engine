// ═══════════════════════════════════════════════════════
// حارس مستقبِل exec( — fail-closed
// تشغيل:  node --test vercel-api/test/repair_cmd_receiver_guard.test.js
//
// exec( ليست أمر shell بمجرد الاسم. db.exec / stmt.exec / conn.exec /
// qb.exec / pattern.exec / getRe().exec / re.exec كلها APIs أخرى، وتعقيمها
// بإصلاح الـCMD يخرّب الكود: استعلام SQL يُجرَّد من ترقيمه، و.replace على
// كائن params ينهار وقت التشغيل.
//
// القاعدة: exec( أمر shell فقط إذا أُثبت أنه exec الخاص بـchild_process.
// المستقبِل المجهول يُرفض (fail-closed) — لا يُصلَح ولا يصل SAFE_AUTO_FIX.
// والحراسة في موضعين: fixCommandInjection (المُصلِح) و cmdCandidateProblem
// (الـverifier المستقل، يمنع أي مصدر candidate ثانٍ من تمرير نفس الخطأ).
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
  for (const f of ['deep_flow.js', 'repair_engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

const ctx = loadEngine();
const JS_TITLE = 'Command Injection';

// ── المُصلِح: null = رُفض ────────────────────────────────
function fixOn(code, line) {
  return ctx.fixCommandInjection(
    code,
    { line, title: JS_TITLE, strategy: 'CMD_INJECTION', severity: 'critical' },
    code.split('\n'), null, 'app.js'
  );
}

// ── candidate مُصطنع يحاكي مصدرًا ثانيًا (legacy fixer) ──
// يُبنى بنفس شكل ناتج fixCommandInjection حتى يُفحص الـverifier وحده،
// مستقلًا عمّا إذا كان المُصلِح نفسه قد رفض.
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

function guard2On(code, lineNo) {
  return ctx.cmdCandidateProblem(code, synthCandidate(code, lineNo), lineNo, 'CMD_INJECTION');
}

// ═══ المجموعة 1 — مستقبِل غير شِل: يجب الرفض ══════════
// ملاحظة: الست الأولى يرفضها الأساس أصلًا (دليل RegExp في الملف).
// السبع الباقية (🔴) هي الثقب: الأساس يصلحها ويخرّب الكود.

const NOT_COMMAND = [
  ['regex literal .exec',        `const m = /foo(\\d+)/.exec(str);`,                               1],
  ['new RegExp().exec',          `const m = new RegExp(p).exec(str);`,                             1],
  ['RegExp().exec',              `const m = RegExp(p).exec(str);`,                                 1],
  ['ident assigned /re/',        `const re = /x+/g;\nconst m = re.exec(str);`,                     2],
  ['ident assigned new RegExp',  `const re = new RegExp('x');\nconst m = re.exec(str);`,           2],
  ['this.rx.exec',               `this.rx = new RegExp(p);\nconst m = this.rx.exec(s);`,           2],
  // 🔴 الثقب المُثبت
  ['sqlite db.exec',             `const db = openDb();\ndb.exec(sql);`,                            2],
  ['better-sqlite3 stmt.exec',   `const stmt = db.prepare(q);\nstmt.exec(params);`,                2],
  ['pool conn.exec',             `const conn = pool.get();\nconn.exec(query);`,                    2],
  ['knex qb.exec',               `const qb = knex('t');\nqb.exec(cb);`,                            2],
  ['param pattern.exec',         `function f(pattern, s) {\n  return pattern.exec(s);\n}`,         2],
  ['getRe().exec',               `function getRe(){ return /a/; }\nconst m = getRe().exec(s);`,    2],
  ['imported re.exec',           `import { re } from './patterns.js';\nconst m = re.exec(s);`,     2],
];

for (const [label, code, line] of NOT_COMMAND) {
  test(`receiver guard: ${label} → المُصلِح يرفض`, () => {
    assert.strictEqual(fixOn(code, line), null,
      `${label}: مستقبِل غير شِل لا يجوز إصلاحه — تعقيم أمر shell يخرّب هذا الاستدعاء`);
  });

  test(`receiver guard: ${label} → الـverifier يرفض candidate خارجيًا`, () => {
    const problem = guard2On(code, line);
    assert.ok(problem, `${label}: الـverifier يجب أن يرفض candidate لمستقبِل غير شِل`);
    assert.match(problem, /^CMD_NOT_COMMAND_EXEC/,
      `${label}: سبب الرفض يجب أن يكون هوية المستقبِل لا شكل التعقيم`);
  });
}

// ═══ المجموعة 2 — child_process حقيقي: يبقى قابلًا للإصلاح ══
// الثلاث الأخيرة (⚠️) روابط شرعية يرفضها تطبيق e5cef5e الأصلي —
// مُثبّتة هنا حتى لا يتسرب ذلك الانحدار.

const REAL_COMMAND = [
  ['destructured exec()',        `const { exec } = require('child_process');\nexec(userInput);`,              2],
  ['require().exec inline',      `require('child_process').exec(cmd);`,                                       1],
  ['node: prefix inline',        `require('node:child_process').exec(cmd);`,                                  1],
  ['const cp = require',         `const cp = require('child_process');\ncp.exec(cmd);`,                       2],
  ['const cp = require node:',   `const cp = require('node:child_process');\ncp.exec(cmd);`,                  2],
  ['import * as cp',             `import * as cp from 'child_process';\ncp.exec(cmd);`,                       2],
  ['import cp default',          `import cp from 'child_process';\ncp.exec(cmd);`,                            2],
  ['exec( بإزاحة',               `const { exec } = require('child_process');\n  exec('ls ' + dir);`,          2],
  // ⚠️ حماية من انحدار تطبيق e5cef5e
  ['let cp; cp = require(...)',  `let cp;\ncp = require('child_process');\ncp.exec(cmd);`,                    3],
  ['import cp, { spawn }',       `import cp, { spawn } from 'child_process';\ncp.exec(cmd);`,                 2],
  ['TS import cp = require',     `import cp = require('child_process');\ncp.exec(cmd);`,                      2],
];

for (const [label, code, line] of REAL_COMMAND) {
  test(`receiver guard: ${label} → يبقى قابلًا للإصلاح`, () => {
    assert.notStrictEqual(fixOn(code, line), null,
      `${label}: exec الخاص بـchild_process يجب أن يبقى قابلًا للإصلاح الحتمي`);
  });

  test(`receiver guard: ${label} → الـverifier لا يرفضه بسبب المستقبِل`, () => {
    const problem = guard2On(code, line);
    if (problem) {
      assert.doesNotMatch(problem, /^CMD_NOT_COMMAND_EXEC/,
        `${label}: الـverifier رفضه بسبب هوية المستقبِل وهو child_process شرعي`);
    }
  });
}

// ═══ المجموعة 3 — البوابتان مستقلتان ═══════════════════
test('البوابتان: رفض المستقبِل يسري على المُصلِح والـverifier معًا', () => {
  const code = `const db = openDb();\ndb.exec(sql);`;
  assert.strictEqual(fixOn(code, 2), null, 'البوابة 1 (fixCommandInjection) يجب أن ترفض');
  assert.match(String(guard2On(code, 2)), /^CMD_NOT_COMMAND_EXEC/,
    'البوابة 2 (cmdCandidateProblem) يجب أن ترفض — لا تُسقَط');
});

test('البوابتان: cmdCandidateProblem ما زالت تحرس المسار العادي', () => {
  // سلوك قائم: تعقيم الجزء الخطأ في template يُرفض كما كان قبل هذا التعديل.
  const code = `const cp = require('child_process');\ncp.exec(\`ls \${dir} -la\`);`;
  const r = fixOn(code, 2);
  assert.notStrictEqual(r, null, 'child_process شرعي: المُصلِح ينتج candidate');
  assert.ok(ctx.cmdCandidateProblem(code, r.fixed, 2, 'CMD_INJECTION'),
    'الـverifier ما زال يرفض تعقيم الأمر كاملًا بدل مدخله');
});

// ═══ المجموعة 4 — end-to-end عبر DeepFlow ═════════════
function deepFlowCmdIssue(code) {
  const out = ctx.DeepFlow.analyze(code, 'app.js');
  return (out.issues || []).filter(i => i.type === 'CMD_INJECTION');
}

test('e2e DeepFlow: db.exec(tainted) يُبلَّغ عنه لكن لا يُصلَح تلقائيًا', () => {
  const code = `app.post('/del', (req, res) => {\n  const q = req.body.query;\n  db.exec(q);\n});`;
  const issues = deepFlowCmdIssue(code);
  assert.strictEqual(issues.length, 1, 'DeepFlow يبلّغ عن CMD_INJECTION — الـfinding لا تختفي');
  assert.strictEqual(issues[0].strategy, 'CMD_INJECTION');

  const out = ctx.repairCode(code, [{ ...issues[0], aiRequired: true }], 'app.js');
  assert.strictEqual(out.repaired, code,
    'db.exec لا يُعدَّل — لا SAFE_AUTO_FIX لمستقبِل مجهول');
  assert.strictEqual(out.repairs.length, 0, 'لا إصلاح مُعتمد');
  assert.ok(out.aiNeeded.some(a => a.line === issues[0].line),
    'المشكلة تُمرَّر إلى aiNeeded بدل إسقاطها بصمت');
});

test('e2e DeepFlow: stmt.exec(objectParams) لا يُصلَح — .replace على كائن ينهار', () => {
  const code = `app.post('/u', (req, res) => {\n  const p = req.body.params;\n  stmt.exec(p);\n});`;
  const issues = deepFlowCmdIssue(code);
  assert.strictEqual(issues.length, 1);
  const out = ctx.repairCode(code, [{ ...issues[0], aiRequired: true }], 'app.js');
  assert.strictEqual(out.repaired, code, 'stmt.exec لا يُعدَّل');
  assert.ok(out.aiNeeded.some(a => a.line === issues[0].line), 'تُمرَّر إلى aiNeeded');
});

test('e2e DeepFlow: cp.exec(tainted) من child_process يبقى قابلًا للإصلاح', () => {
  const code = `const cp = require('child_process');\napp.post('/run', (req, res) => {\n  const d = req.body.dir;\n  cp.exec(d);\n});`;
  const issues = deepFlowCmdIssue(code);
  assert.strictEqual(issues.length, 1, 'DeepFlow يبلّغ عنه');
  assert.notStrictEqual(fixOn(code, issues[0].line), null,
    'child_process شرعي: التغطية القائمة محفوظة');
});

// ═══ المجموعة 5 — adversarial: أشكال require / import / إسناد ══
// الدليل على الربط يُقرأ من الكود وحده. نصّ يذكر child_process في تعليق،
// أو إسناد إلى عضو كائن، أو بند import غير حقيقي — لا يُثبت أن المستقبِل
// هو child_process، فيبقى الرفض قائمًا (fail-closed).

const ADVERSARIAL_REJECT = [
  ['تعليق سطري يحمل require',
   `// const cp = require('child_process');\nconst cp = openDb();\ncp.exec(sql);`, 3],
  ['تعليق كتلي يحمل require',
   `/* const cp = require('child_process'); */\nconst cp = openDb();\ncp.exec(sql);`, 3],
  ['تعليق ذيلي على سطر import يذكر الوحدة',
   `import db from './db.js' // from 'child_process'\ndb.exec(sql);`, 2],
  ['إسناد إلى عضو كائن obj.cp = require',
   `obj.cp = require('child_process');\nconst cp = openDb();\ncp.exec(sql);`, 3],
  ['مقارنة cp == require لا إسناد',
   `if (cp == require('child_process')) {}\ncp.exec(sql);`, 2],
  ['تصادم سابقة mycp = require',
   `const mycp = require('child_process');\ncp.exec(sql);`, 2],
  ['تصادم لاحقة cp2 = require',
   `const cp2 = require('child_process');\ncp.exec(sql);`, 2],
  ['import نوعي فقط (type)',
   `import type cp from 'child_process';\ncp.exec(c);`, 2],
  ['استيرادان على سطر واحد، db أولًا',
   `import db from './db.js'; import cp from 'child_process';\ndb.exec(sql);`, 2],
  ['استيرادان على سطرين',
   `import { db } from './db.js';\nimport cp from 'child_process';\ndb.exec(sql);`, 3],
  ['export ... from child_process لا يربط db',
   `export { exec } from 'child_process';\nconst db = openDb();\ndb.exec(sql);`, 3],
  ['عضو متداخل a.b.exec',
   `const b = require('child_process');\na.b.exec(q);`, 2],
  ['كائن حرفي mod.cp.exec',
   `const mod = { cp: require('child_process') };\nmod.cp.exec(q);`, 2],
];

for (const [label, code, line] of ADVERSARIAL_REJECT) {
  test(`adversarial: ${label} → يبقى مرفوضًا`, () => {
    assert.strictEqual(fixOn(code, line), null,
      `${label}: لا يُثبت ربط child_process — الرفض يجب أن يبقى (fail-closed)`);
  });
}

// الأشكال الشرعية التي يجب ألا يكسرها التشديد أعلاه
const ADVERSARIAL_ALLOW = [
  ['require بسطرين',            `const cp =\n  require('child_process');\ncp.exec(c);`, 3],
  ['require باقتباس مزدوج',     `const cp = require("child_process");\ncp.exec(c);`, 2],
  ['require مع تعليق ذيلي',     `const cp = require('child_process'); // يشغّل أوامر\ncp.exec(c);`, 2],
  ['require بتعليق كتلي وسطي',  `const cp = /* mod */ require('child_process');\ncp.exec(c);`, 2],
  ['import cp, { spawn }',      `import cp, { spawn } from 'child_process';\ncp.exec(c);`, 2],
  ['import cp, * as ns',        `import cp, * as ns from 'child_process';\ncp.exec(c);`, 2],
  ['import cp,{spawn} بلا مسافة', `import cp,{spawn} from 'child_process';\ncp.exec(c);`, 2],
];

for (const [label, code, line] of ADVERSARIAL_ALLOW) {
  test(`adversarial: ${label} → يبقى قابلًا للإصلاح`, () => {
    assert.notStrictEqual(fixOn(code, line), null,
      `${label}: ربط child_process شرعي — التشديد لا يجوز أن يكسره`);
  });
}
