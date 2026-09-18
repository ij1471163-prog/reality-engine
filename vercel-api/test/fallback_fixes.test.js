// ═══════════════════════════════════════════════════════
// اختبارات fallback_fixes.js v3.0 — الخط الثاني المحافظ والمُتحقَّق
// تشغيل:  node --test vercel-api/test/*.test.js   (من جذر المستودع)
// بلا أي تبعيات خارجية — node:test مدمج. تُحمَّل fallback_fixes.js وحدها
// (ومع analyzer.js في اختبارات التحقق فقط) وتُمرَّر ثغرات مصطنعة.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadContext(files, extra) {
  const ctx = vm.createContext(Object.assign({ console, window: {}, global: {}, F: {}, R: {} }, extra || {}));
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}
const engine = (extra) => loadContext(['fallback_fixes.js'], extra);

// ثغرة مصطنعة (ev فارغ = الاعتماد على رقم السطر، مع فحص النمط على السطر نفسه)
function issueAt(line, title, extra) {
  return Object.assign({ line, sev: 'c', type: 'security', title, ev: '' }, extra || {});
}
const SQL_PY  = '🔴 SQL Injection — String Concatenation في Python';
const SQL_JS  = '🔴 SQL Injection — String Concatenation في JS';
const CMD_PY  = '🔴 Command Injection Python — os.system خطير';
const EVAL_JS = '🔴 eval() خطير — تنفيذ كود مباشر';
const TS_ANY  = '🟡 TypeScript any — استخدم unknown أو type محدد';
const JWT_JS  = '🟠 JWT Secret مكشوف — استخدم process.env';

// النتائج تُنشأ داخل سياق vm (realm مختلف) فتُنسخ إلى مصفوفات/كائنات هذا الـrealm قبل deepStrictEqual
const reasons = r => Array.from(r.aiRequired, x => x.reason);
const skippedOf = r => Array.from(r.skipped, x => x.reason);
const verif = r => Object.assign({}, r.verification);
const noJsInPy = out => assert.ok(!/process\.env|require\(|===|\bconst\s/.test(out), 'تسرّبت صياغة JS إلى Python:\n' + out);
const noPyInJs = out => assert.ok(!/os\.environ|import os|subprocess|shlex/.test(out), 'تسرّبت صياغة Python إلى JS:\n' + out);

// ═══ 1. لغة غير مدعومة أو HTML ⇒ لا لمس ═══════════════════
test('لغة غير مدعومة / HTML / بلا امتداد: الكود يعود كما هو وثغرات fallback تُعلَّم AI_REQUIRED', () => {
  const ctx = engine();
  const code = 'val q = "SELECT * FROM t WHERE id = " + id\nprint(q)\n';
  const issues = [issueAt(1, SQL_PY), issueAt(1, 'http غير آمن', { sev: 'm' })];
  for (const fn of ['A.kt', 'A.java', 'main.go', 'a.rb', 'page.html', 'page.htm', 'noext', 'comp.vue', 'x.swift']) {
    const r = ctx.fallbackFix(code, fn, issues);
    assert.strictEqual(r.fixed, code, fn + ': تغيّر الكود');
    assert.strictEqual(r.repairs.length, 0, fn + ': سُجّلت إصلاحات');
    assert.deepStrictEqual(reasons(r), ['unsupported_language'], fn);
    assert.strictEqual(r.skipped.length, 1, fn + ': الثغرة غير المعنية يجب أن تُتخطَّى لا أن تُعلَّم AI');
  }
});

// ═══ 2. eval / new Function: لا إصلاح تلقائي أبداً ═════════
test('eval/new Function: لا JSON.parse بحسب اسم المتغير ولا حذف — AI_REQUIRED دائماً', () => {
  const ctx = engine();
  const cases = [
    ['a.js', 'const data = eval(input);\nconst result = eval(response);\nconst fn = new Function("return " + json)();\n', EVAL_JS],
    ['a.ts', 'const data: string = eval(payload);\n', EVAL_JS],
    ['a.py', 'x = eval(data)\nresult = eval(response)\n', '🔴 Code Injection via eval (CWE-94)'],
  ];
  for (const [fn, code, title] of cases) {
    const issues = code.split('\n').filter(Boolean).map((_, i) => issueAt(i + 1, title));
    const r = ctx.fallbackFix(code, fn, issues);
    assert.strictEqual(r.fixed, code, fn + ': eval عُدِّل');
    assert.strictEqual(r.repairs.length, 0);
    assert.ok(reasons(r).every(x => x === 'eval_no_semantics_preserving_rewrite'), fn + ': ' + reasons(r));
    assert.ok(!r.fixed.includes('JSON.parse') && !r.fixed.includes('literal_eval') && !r.fixed.includes('removed'));
  }
});

// ═══ 3. SQL — Python ══════════════════════════════════════
test('SQL Python: sqlite3 مباشر ⇒ ? مع tuple، وإزالة تغليف الاقتباس، وحفظ التعليق', () => {
  const ctx = engine();
  const code = 'import sqlite3\nconn = sqlite3.connect("a.db")\ncur = conn.cursor()\ncur.execute("SELECT * FROM users WHERE name = \'" + name + "\' AND age > " + age)  # q\n';
  // بلاغان على السطر نفسه من محللين مختلفين (الثاني بدليل): إصلاح واحد، والمكرر يُتخطَّى لا يُحال إلى AI
  const dup = issueAt(4, '🔴 Code Injection via SQL (CWE-89)', { ev: code.split('\n')[3].trim() });
  const r = ctx.fallbackFix(code, 'a.py', [issueAt(4, SQL_PY), dup]);
  assert.strictEqual(r.fixed.split('\n')[3], 'cur.execute("SELECT * FROM users WHERE name = ? AND age > ?", (name, age))  # q');
  assert.strictEqual(r.fixed.split('\n').length, code.split('\n').length, 'تغيّر عدد الأسطر');
  assert.strictEqual(r.repairs.length, 1);
  assert.strictEqual(r.repairs[0].verified, true);
  assert.deepStrictEqual(reasons(r), []);
  assert.deepStrictEqual(skippedOf(r), ['line_already_fixed_this_run']);
  noJsInPy(r.fixed);
});

test('SQL Python: psycopg — الإسناد ثم التنفيذ ⇒ %s وتمرير params على سطر التنفيذ بلا حذف أسطر', () => {
  const ctx = engine();
  const code = 'import psycopg2\ndef f(cur, uid):\n    query = "SELECT * FROM users WHERE id = " + uid\n    cur.execute(query)\n    return cur.fetchall()\n';
  const r = ctx.fallbackFix(code, 'a.py', [issueAt(3, SQL_PY)]);
  const lines = r.fixed.split('\n');
  assert.strictEqual(lines[2], '    query = "SELECT * FROM users WHERE id = %s"');
  assert.strictEqual(lines[3], '    cur.execute(query, (uid,))');
  assert.strictEqual(lines[4], '    return cur.fetchall()', 'سطر fetchall حُذف أو تغيّر');
  assert.strictEqual(lines.length, code.split('\n').length);
});

test('SQL Python: f-string مع سلسلة .fetchall() ⇒ مُعلَّم؛ وdriver مجهول ⇒ AI_REQUIRED بلا لمس', () => {
  const ctx = engine();
  const fs1 = 'import sqlite3\nrows = cursor.execute(f"SELECT * FROM t WHERE id = {uid} AND k = \'{key}\'").fetchall()\n';
  const r1 = ctx.fallbackFix(fs1, 'a.py', [issueAt(2, SQL_PY)]);
  assert.strictEqual(r1.fixed.split('\n')[1], 'rows = cursor.execute("SELECT * FROM t WHERE id = ? AND k = ?", (uid, key)).fetchall()');
  const unk = 'q = "SELECT * FROM t WHERE id = " + uid\ncursor.execute(q)\n';
  const r2 = ctx.fallbackFix(unk, 'a.py', [issueAt(1, SQL_PY)]);
  assert.strictEqual(r2.fixed, unk);
  assert.deepStrictEqual(reasons(r2), ['db_api_unknown']);
});

test('SQL Python: الحالات غير المؤكدة لا تُلمس (LIKE %، ORDER BY، IN (…)، متغير مُعاد الاستخدام، % formatting)', () => {
  const ctx = engine();
  const cases = [
    ['import sqlite3\ncursor.execute("SELECT * FROM t WHERE n LIKE \'%" + s + "%\'")\n', 2, 'like_wildcard_concat'],
    ['import sqlite3\ncursor.execute("SELECT * FROM t ORDER BY " + col)\n', 2, 'non_value_position'],
    ['import sqlite3\ncursor.execute("SELECT * FROM t WHERE id IN (" + ids + ")")\n', 2, 'non_value_position'],
    ['import sqlite3\nq = "SELECT * FROM t WHERE id = " + uid\nprint(q)\ncursor.execute(q)\n', 2, 'query_variable_reused'],
    ['import sqlite3\ncursor.execute("SELECT * FROM t WHERE id = %s" % uid)\n', 2, 'query_expression_not_pure'],
    ['import sqlite3\ncursor.execute("SELECT * FROM t WHERE id = \'" + uid)\n', 2, 'unbalanced_quoting'],
    ['import sqlite3\ncursor.execute("SELECT * FROM t WHERE id = ? AND x = " + v, (a,))\n', 2, 'existing_placeholders'],
  ];
  for (const [code, line, reason] of cases) {
    const r = ctx.fallbackFix(code, 'a.py', [issueAt(line, SQL_PY)]);
    assert.strictEqual(r.fixed, code, reason + ': تغيّر الكود');
    assert.deepStrictEqual(reasons(r), [reason]);
  }
});

// ═══ 4. SQL — JS / TS ═════════════════════════════════════
test('SQL JS: mysql2 مع callback متعدد الأسطر ⇒ ? + مصفوفة params قبل الـcallback', () => {
  const ctx = engine();
  const code = 'const mysql = require("mysql2");\ndb.query("SELECT * FROM users WHERE id = " + req.params.id, (err, rows) => {\n  res.json(rows);\n});\n';
  const r = ctx.fallbackFix(code, 'a.js', [issueAt(2, SQL_JS)]);
  assert.strictEqual(r.fixed.split('\n')[1], 'db.query("SELECT * FROM users WHERE id = ?", [req.params.id], (err, rows) => {');
  assert.strictEqual(r.fixed.split('\n').length, code.split('\n').length);
  noPyInJs(r.fixed);
});

test('SQL TS: pg مع template literal وawait ⇒ $1/$2 ومصفوفة params', () => {
  const ctx = engine();
  const code = 'import { Pool } from "pg";\nconst r = await pool.query(`SELECT * FROM users WHERE email = ${email} AND org = ${org}`);\n';
  const r = ctx.fallbackFix(code, 'a.ts', [issueAt(2, SQL_JS)]);
  assert.strictEqual(r.fixed.split('\n')[1], 'const r = await pool.query("SELECT * FROM users WHERE email = $1 AND org = $2", [email, org]);');
});

test('SQL JS: الإسناد ثم التنفيذ مع callback؛ وdriver مجهول أو مزدوج ⇒ AI_REQUIRED بلا لمس', () => {
  const ctx = engine();
  const code = 'const mysql = require("mysql");\nconst sql = "SELECT * FROM t WHERE a = \'" + a + "\'";\nconn.query(sql, function (e, r) {\n});\n';
  const r = ctx.fallbackFix(code, 'a.js', [issueAt(2, SQL_JS)]);
  assert.strictEqual(r.fixed.split('\n')[1], 'const sql = "SELECT * FROM t WHERE a = ?";');
  assert.strictEqual(r.fixed.split('\n')[2], 'conn.query(sql, [a], function (e, r) {');
  const unk = 'db.query("SELECT * FROM users WHERE id = " + id);\n';
  const r2 = ctx.fallbackFix(unk, 'a.js', [issueAt(1, SQL_JS)]);
  assert.strictEqual(r2.fixed, unk);
  assert.deepStrictEqual(reasons(r2), ['db_api_unknown']);
  const two = 'const mysql = require("mysql");\nconst { Pool } = require("pg");\ndb.query("SELECT * FROM t WHERE id = " + id);\n';
  const r3 = ctx.fallbackFix(two, 'a.js', [issueAt(3, SQL_JS)]);
  assert.strictEqual(r3.fixed, two);
  assert.deepStrictEqual(reasons(r3), ['db_api_unknown']);
});

// ═══ 5. SQL — PHP ═════════════════════════════════════════
test('SQL PHP: PDO فقط — query مع استيفاء/سلسلة ⇒ prepare/execute؛ mysqli أو سلسلة ->fetch ⇒ AI_REQUIRED', () => {
  const ctx = engine();
  const code = '<?php\n$pdo = new PDO($dsn);\n$res = $pdo->query("SELECT * FROM users WHERE id = $id");\n$pdo->query("DELETE FROM t WHERE id = " . $_GET[\'id\']);\n';
  const r = ctx.fallbackFix(code, 'a.php', [issueAt(3, 'SQL Injection'), issueAt(4, 'SQL Injection')]);
  const lines = r.fixed.split('\n');
  assert.strictEqual(lines[2], "$res = $pdo->prepare('SELECT * FROM users WHERE id = ?');");
  assert.strictEqual(lines[3], '$res->execute([$id]);');
  assert.strictEqual(lines[4], "$pdo->prepare('DELETE FROM t WHERE id = ?')->execute([$_GET['id']]);");
  assert.strictEqual(r.repairs.length, 2);
  assert.ok(!/process\.env|os\.environ|bind_param/.test(r.fixed));
  const my = '<?php\n$c = new mysqli($h);\n$r = $c->query("SELECT * FROM t WHERE id = " . $id);\n';
  const r2 = ctx.fallbackFix(my, 'a.php', [issueAt(3, 'SQL Injection')]);
  assert.strictEqual(r2.fixed, my);
  assert.deepStrictEqual(reasons(r2), ['db_api_unknown']);
  const chain = '<?php\n$pdo = new PDO($dsn);\n$row = $pdo->query("SELECT * FROM t WHERE id = $id")->fetch();\n';
  const r3 = ctx.fallbackFix(chain, 'a.php', [issueAt(3, 'SQL Injection')]);
  assert.strictEqual(r3.fixed, chain);
  assert.deepStrictEqual(reasons(r3), ['call_arguments_unclear']);
});

// ═══ 6. Command Injection — Python ════════════════════════
test('CMD Python: os.system/shell=True ⇒ قائمة argv بلا shell وبلا shlex، مع إدراج import subprocess مرة واحدة', () => {
  const ctx = engine();
  const code = 'import os\nimport subprocess\ndef ping(host):\n    os.system("ping -c 1 " + host)\n    os.system(f"convert {src} -o {dst}")\nout = subprocess.check_output("ls -la " + d, shell=True, text=True)\n';
  const r = ctx.fallbackFix(code, 'a.py', [issueAt(4, CMD_PY), issueAt(5, CMD_PY), issueAt(6, '🔴 Command Injection via shell=True')]);
  const lines = r.fixed.split('\n');
  assert.strictEqual(lines[3], '    subprocess.run(["ping", "-c", "1", host])');
  assert.strictEqual(lines[4], '    subprocess.run(["convert", src, "-o", dst])');
  assert.strictEqual(lines[5], 'out = subprocess.check_output(["ls", "-la", d], text=True)');
  assert.strictEqual((r.fixed.match(/^import subprocess$/mg) || []).length, 1, 'import subprocess مكرر أو مفقود');
  assert.ok(!/shell\s*=\s*True|shlex/.test(r.fixed));
  assert.strictEqual(r.repairs.length, 3);
  const noImp = 'import os\nos.system("rm -rf " + path + "/tmp")\n';
  const r2 = ctx.fallbackFix(noImp, 'a.py', [issueAt(2, CMD_PY)]);
  assert.strictEqual(r2.fixed, 'import os\nimport subprocess\nsubprocess.run(["rm", "-rf", path + "/tmp"])\n');
});

test('CMD Python: القيمة المرجعة، رموز shell، أمر من متغير، os.popen ⇒ لا لمس؛ أمر ثابت ⇒ تخطٍّ؛ JS ⇒ AI_REQUIRED', () => {
  const ctx = engine();
  const cases = [
    ['import os\nrc = os.system("ping " + host)\n', 'return_value_used'],
    ['import os\nif os.system("ping " + host) == 0:\n    pass\n', 'return_value_used'],
    ['import os\nos.system("cat " + f + " | grep x")\n', 'shell_syntax_in_command'],
    ['import os\nos.system("echo \'" + msg + "\'")\n', 'shell_syntax_in_command'],
    ['import os\nos.system(cmd)\n', 'command_from_variable'],
    ['import os\nos.system(cmd + " -v")\n', 'command_from_variable'],
    ['import os\nout = os.popen("ls " + d).read()\n', 'return_value_semantics_change'],
    ['import subprocess\nsubprocess.run(cmd, shell=True)\n', 'command_from_variable'],
    ['import subprocess\nsubprocess.run("ls " + d, shell=True, executable="/bin/bash")\n', 'executable_override'],
  ];
  for (const [code, reason] of cases) {
    const r = ctx.fallbackFix(code, 'a.py', [issueAt(2, CMD_PY)]);
    assert.strictEqual(r.fixed, code, reason + ': تغيّر الكود');
    assert.deepStrictEqual(reasons(r), [reason]);
  }
  const stat = 'import os\nos.system("ls -la")\n';
  const rs = ctx.fallbackFix(stat, 'a.py', [issueAt(2, CMD_PY)]);
  assert.strictEqual(rs.fixed, stat);
  assert.deepStrictEqual(skippedOf(rs), ['static_command']);
  const js = 'const { exec } = require("child_process");\nexec("ls " + dir);\n';
  const rj = ctx.fallbackFix(js, 'a.js', [issueAt(2, '🔴 OS Command Injection (CWE-78)')]);
  assert.strictEqual(rj.fixed, js);
  assert.deepStrictEqual(reasons(rj), ['category_not_supported_for_language']);
});

// ═══ 7. TypeScript any ════════════════════════════════════
test('TS any: يُستنتج النوع من قيمة حرفية في نفس الإعلان فقط؛ وغير ذلك لا يُلمس', () => {
  const ctx = engine();
  const ok = 'const port: any = 3000;\nlet name: any = "x";\nconst ok: any = true;\nconsole.log(port, name, ok);\n';
  const r = ctx.fallbackFix(ok, 'a.ts', [1, 2, 3].map(l => issueAt(l, TS_ANY, { sev: 'm' })));
  assert.strictEqual(r.fixed, 'const port: number = 3000;\nlet name: string = "x";\nconst ok: boolean = true;\nconsole.log(port, name, ok);\n');
  assert.ok(!r.fixed.includes('unknown'), 'لا تحويل أعمى إلى unknown');
  const blocked = 'function f(x: any) { return x; }\nconst o: any = {};\nconst a: any = [];\nlet n: any = null;\nlet m: any = 5;\nm = "s";\nconst s: any = "t";\ns.foo();\nconst d: any = new Date();\nconst two: any = 1, three: any = 2;\n';
  const rb = ctx.fallbackFix(blocked, 'a.ts', [1, 2, 3, 4, 5, 7, 9, 10].map(l => issueAt(l, TS_ANY, { sev: 'm' })));
  assert.strictEqual(rb.fixed, blocked, 'حالة غير واضحة عُدِّلت');
  assert.strictEqual(rb.repairs.length, 0);
  assert.ok(reasons(rb).includes('parameter_type_needs_usage_analysis'));
  assert.ok(reasons(rb).includes('variable_used_as_object_or_reassigned'));
  assert.ok(reasons(rb).includes('multiple_any_annotations'));
  const rj = ctx.fallbackFix('const x: any = 5;\n', 'a.js', [issueAt(1, TS_ANY, { sev: 'm' })]);
  assert.deepStrictEqual(reasons(rj), ['category_not_supported_for_language']);
});

// ═══ 8. JWT ═══════════════════════════════════════════════
test('JWT JS/TS: secret مُضمَّن ⇒ process.env بنمط واضح فقط، بلا إضافة expiry، والخيارات تبقى كما هي', () => {
  const ctx = engine();
  const code = 'const JWT_SECRET = "s3cr3t";\nconst jwtSecret = "abc";\nconst token = jwt.sign({ id }, "hardcoded", { expiresIn: "1h" });\njwt.verify(token, "hardcoded");\nconst t2 = jwt.sign({ id }, secret);\nconst other = "abc";\n';
  const issues = [
    issueAt(1, JWT_JS, { sev: 'h' }), issueAt(2, JWT_JS, { sev: 'h' }),
    issueAt(3, '🔴 Hardcoded JWT Secret (CWE-287)'), issueAt(4, '🔴 Hardcoded JWT Secret (CWE-287)'),
    issueAt(5, '🟠 JWT بدون وقت انتهاء', { sev: 'h' }), issueAt(6, JWT_JS, { sev: 'h' }),
  ];
  const r = ctx.fallbackFix(code, 'a.ts', issues);
  const lines = r.fixed.split('\n');
  assert.strictEqual(lines[0], 'const JWT_SECRET = process.env.JWT_SECRET;');
  assert.strictEqual(lines[1], 'const jwtSecret = process.env.JWT_SECRET;');
  assert.strictEqual(lines[2], 'const token = jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "1h" });');
  assert.strictEqual(lines[3], 'jwt.verify(token, process.env.JWT_SECRET);');
  assert.strictEqual(lines[4], 'const t2 = jwt.sign({ id }, secret);', 'أُضيف expiry أو تغيّرت الدلالة');
  assert.strictEqual(lines[5], 'const other = "abc";', 'اسم متغير غير مؤكد عُدِّل');
  assert.strictEqual(r.repairs.length, 4);
  assert.ok(reasons(r).includes('token_expiry_policy_requires_review'));
  assert.ok(reasons(r).includes('jwt_pattern_not_recognized'));
  noPyInJs(r.fixed);
});

test('JWT Python: SECRET_KEY/jwt.encode ⇒ os.environ مع import os؛ وإعادة التشغيل لا تعيد التغليف', () => {
  const ctx = engine();
  const code = 'import jwt\nSECRET_KEY = "abc123"\ntoken = jwt.encode(payload, "abc123", algorithm="HS256")\n';
  const r = ctx.fallbackFix(code, 'a.py', [issueAt(2, '🟠 JWT Secret مكشوف', { sev: 'h' }), issueAt(3, '🔴 Hardcoded JWT Secret (CWE-287)')]);
  assert.strictEqual(r.fixed, "import jwt\nimport os\nSECRET_KEY = os.environ.get('SECRET_KEY', '')\ntoken = jwt.encode(payload, os.environ.get('JWT_SECRET', ''), algorithm=\"HS256\")\n");
  noJsInPy(r.fixed);
  const again = ctx.fallbackFix(r.fixed, 'a.py', [issueAt(3, '🟠 JWT Secret مكشوف', { sev: 'h' }), issueAt(4, '🔴 Hardcoded JWT Secret (CWE-287)')]);
  assert.strictEqual(again.fixed, r.fixed, 'إعادة تغليف secret سبق إصلاحه');
  assert.strictEqual(again.repairs.length, 0);
  assert.deepStrictEqual(skippedOf(again), ['already_uses_env', 'already_uses_env']);
});

// ═══ 9. Idempotency ═══════════════════════════════════════
test('Idempotency: تشغيل fallbackFix مرتين (بنفس الثغرات أو بثغرات مُعاد توجيهها) لا يواصل التعديل', () => {
  const ctx = engine();
  const code = 'import sqlite3\nimport os\nJWT_SECRET = "abc"\ndef run(uid, host):\n    cursor.execute("SELECT * FROM t WHERE id = " + uid)\n    os.system("ping " + host)\n';
  const issues = [issueAt(3, JWT_JS, { sev: 'h' }), issueAt(5, SQL_PY), issueAt(6, CMD_PY)];
  const first = ctx.fallbackFix(code, 'a.py', issues);
  assert.strictEqual(first.repairs.length, 3);
  assert.notStrictEqual(first.fixed, code);
  // نفس الثغرات القديمة (أرقام أسطر قديمة، بلا دليل): لا تعديل جديد
  const second = ctx.fallbackFix(first.fixed, 'a.py', issues);
  assert.strictEqual(second.fixed, first.fixed);
  assert.strictEqual(second.repairs.length, 0);
  // ثغرات مُعاد توجيهها إلى الأسطر المُصلَحة نفسها (بعد إدراج import subprocess): لا تعديل جديد
  const shifted = [issueAt(3, JWT_JS, { sev: 'h' }), issueAt(6, SQL_PY), issueAt(7, CMD_PY)];
  const third = ctx.fallbackFix(first.fixed, 'a.py', shifted);
  assert.strictEqual(third.fixed, first.fixed);
  assert.strictEqual(third.repairs.length, 0);
  assert.strictEqual((first.fixed.match(/^import subprocess$/mg) || []).length, 1);
});

// ═══ 10. سلامة السطر: الدليل قبل رقم السطر ═══════════════
test('الدليل (ev): انزياح الأسطر يُتابَع بدليل وحيد؛ دليل لا يطابق أو مكرر أو رقم خارج النطاق ⇒ لا إصلاح عشوائي', () => {
  const ctx = engine();
  const ev = 'cursor.execute("SELECT * FROM t WHERE id = " + uid)';
  const moved = 'import sqlite3\n# سطر أُضيف لاحقاً\n' + ev + '\n';
  const r1 = ctx.fallbackFix(moved, 'a.py', [issueAt(2, SQL_PY, { ev })]);
  assert.strictEqual(r1.fixed.split('\n')[2], 'cursor.execute("SELECT * FROM t WHERE id = ?", (uid,))');
  assert.strictEqual(r1.fixed.split('\n')[1], '# سطر أُضيف لاحقاً', 'أُصلح سطر مختلف');
  const mism = 'import sqlite3\n' + ev + '\n';
  const r2 = ctx.fallbackFix(mism, 'a.py', [issueAt(2, SQL_PY, { ev: 'cursor.execute("DELETE FROM t WHERE id = " + uid)' })]);
  assert.strictEqual(r2.fixed, mism);
  assert.deepStrictEqual(reasons(r2), ['evidence_mismatch']);
  const dup = 'import sqlite3\n' + ev + '\nx = 1\n' + ev + '\n';
  const r3 = ctx.fallbackFix(dup, 'a.py', [issueAt(9, SQL_PY, { ev })]);
  assert.strictEqual(r3.fixed, dup);
  assert.deepStrictEqual(reasons(r3), ['evidence_ambiguous']);
  const r4 = ctx.fallbackFix('x = 1\n', 'a.py', [issueAt(9, SQL_PY)]);
  assert.strictEqual(r4.fixed, 'x = 1\n');
  assert.deepStrictEqual(reasons(r4), ['line_out_of_range']);
  // سطر صحيح الرقم لكن النمط ليس عليه (بلا دليل): لا لمس
  const r5 = ctx.fallbackFix('import sqlite3\nx = 1\n' + ev + '\n', 'a.py', [issueAt(2, SQL_PY)]);
  assert.strictEqual(r5.repairs.length, 0);
  assert.strictEqual(r5.fixed, 'import sqlite3\nx = 1\n' + ev + '\n');
});

// ═══ 11. لا تلوث بين اللغات ══════════════════════════════
test('عزل اللغات: صياغة JS لا تدخل Python، وصياغة Python لا تدخل JS، والامتداد هو الحكم لا المحتوى', () => {
  const ctx = engine();
  // ملف .py يحوي نمط JS: لا تحويل
  const pyWithJs = 'import sqlite3\ndb.query("SELECT * FROM t WHERE id = " + id);\n';
  const r1 = ctx.fallbackFix(pyWithJs, 'a.py', [issueAt(2, SQL_JS)]);
  assert.strictEqual(r1.fixed, pyWithJs);
  // ملف .js يحوي os.system: لا تحويل Python
  const jsWithPy = 'os.system("ping " + host);\n';
  const r2 = ctx.fallbackFix(jsWithPy, 'a.js', [issueAt(1, CMD_PY)]);
  assert.strictEqual(r2.fixed, jsWithPy);
  assert.deepStrictEqual(reasons(r2), ['category_not_supported_for_language']);
  // ملف .js يحوي import (محتوى يشبه Python): لا يُعامل كـ Python
  const jsImport = 'import mysql from "mysql2/promise";\nconst [rows] = await db.execute("SELECT * FROM t WHERE id = " + id);\n';
  const r3 = ctx.fallbackFix(jsImport, 'a.js', [issueAt(2, SQL_JS)]);
  assert.strictEqual(r3.fixed.split('\n')[1], 'const [rows] = await db.execute("SELECT * FROM t WHERE id = ?", [id]);');
  noPyInJs(r3.fixed);
});

// ═══ 12. التحقق والرجوع (rollback) ═══════════════════════
test('التحقق: محلل يبلّغ عن ثغرة حرجة جديدة أو ينهار على الكود المُعدَّل ⇒ الإصلاح يُرجَع والكود لا يتغير', () => {
  const code = 'import sqlite3\ncursor.execute("SELECT * FROM t WHERE id = " + uid)\n';
  // (أ) انحدار: المحلل يرى نوعاً حرجاً جديداً بعد التعديل
  const ctxA = engine({ analyzeCode: (c) => c.includes('(uid,)') ? [{ sev: 'c', type: 'bug', cAct: 'NEW_CRITICAL', title: 'x', line: 2 }] : [] });
  const rA = ctxA.fallbackFix(code, 'a.py', [issueAt(2, SQL_PY)]);
  assert.strictEqual(rA.fixed, code);
  assert.strictEqual(rA.repairs.length, 0);
  assert.deepStrictEqual(verif(rA), { checked: 1, rolledBack: 1, analyzer: true });
  assert.deepStrictEqual(reasons(rA), ['verification_failed:regression']);
  // (ب) انهيار المحلل على الكود المُعدَّل فقط
  const ctxB = engine({ analyzeCode: (c) => { if (c.includes('(uid,)')) throw new Error('boom'); return []; } });
  const rB = ctxB.fallbackFix(code, 'a.py', [issueAt(2, SQL_PY)]);
  assert.strictEqual(rB.fixed, code);
  assert.deepStrictEqual(reasons(rB), ['verification_failed:analysis_failed']);
  // (ج) محلل سليم: الثغرة تختفي ⇒ يُقبل الإصلاح وtargetGone صحيح
  const ctxC = engine({ analyzeCode: (c) => c.split('\n').map((l, i) => /["']\s*SELECT.*["']\s*\+/.test(l) ? { sev: 'c', type: 'py', cAct: 'CWE-89', title: SQL_PY, line: i + 1 } : null).filter(Boolean) });
  const rC = ctxC.fallbackFix(code, 'a.py', [issueAt(2, SQL_PY)]);
  assert.strictEqual(rC.fixed.split('\n')[1], 'cursor.execute("SELECT * FROM t WHERE id = ?", (uid,))');
  assert.strictEqual(rC.repairs[0].targetGone, true);
  assert.deepStrictEqual(verif(rC), { checked: 1, rolledBack: 0, analyzer: true });
});

test('التحقق البنيوي: تعديل يُدخل صياغة لغة أخرى أو يغيّر توازن الأقواس يُرفض', () => {
  const ctx = engine();
  const before = ['x = 1', 'cursor.execute(q)'];
  assert.strictEqual(vm.runInContext('fbStructuralProblem', ctx)(before, ['x = 1', 'cursor.execute(q, process.env.X)'], [{ idx: 1, text: 'cursor.execute(q, process.env.X)' }], 'py'), 'foreign_syntax_introduced');
  assert.strictEqual(vm.runInContext('fbStructuralProblem', ctx)(before, ['x = 1', 'cursor.execute(q'], [{ idx: 1, text: 'cursor.execute(q' }], 'py'), 'bracket_balance_changed');
  assert.strictEqual(vm.runInContext('fbStructuralProblem', ctx)(before, ['x = 1', '# removed'], [{ idx: 1, text: '# removed' }], 'py'), 'comment_only_replacement');
  assert.strictEqual(vm.runInContext('fbStructuralProblem', ctx)(before, ['x = 1', 'cursor.execute(q, (a,))'], [{ idx: 1, text: 'cursor.execute(q, (a,))' }], 'py'), null);
});

// ═══ 13. تكامل مع المحلل الحقيقي ═════════════════════════
test('تكامل analyzer.js: إصلاح SQL Python يُقبل والثغرة تختفي؛ وحكم المحلل بالانحدار يُرجِع الإصلاح', () => {
  const ctx = loadContext(['analyzer.js', 'fallback_fixes.js']);
  assert.strictEqual(typeof ctx.analyzeCode, 'function');
  const code = 'import sqlite3\ndef get(cur, uid):\n    cur.execute("SELECT * FROM users WHERE id = " + uid)\n    return cur.fetchall()\n';
  const issues = ctx.analyzeCode(code, 'svc.py');
  assert.ok(issues.some(i => /SQL Injection/.test(i.title)), 'المحلل لم يكشف الثغرة');
  const r = ctx.fallbackFix(code, 'svc.py', issues);
  assert.strictEqual(r.fixed.split('\n')[2], '    cur.execute("SELECT * FROM users WHERE id = ?", (uid,))');
  assert.strictEqual(r.verification.analyzer, true);
  assert.strictEqual(r.repairs.length, 1);
  assert.strictEqual(r.repairs[0].targetGone, true);
  assert.ok(!ctx.analyzeCode(r.fixed, 'svc.py').some(i => /SQL Injection/.test(i.title)), 'الثغرة ما زالت مكشوفة بعد الإصلاح');
  // ضابط: صيغة الإسناد مع psycopg (%s) وcursor.execute — قاعدة "params mismatch" في المحلل
  // تعدّ %s صفراً من ? فتبلّغ ثغرة حرجة جديدة ⇒ الإصلاح يُرجَع (سلوك محافظ متعمَّد)
  const pg = 'import psycopg2\ndef get(cursor, uid):\n    query = "SELECT * FROM users WHERE id = " + uid\n    cursor.execute(query)\n';
  const rp = ctx.fallbackFix(pg, 'svc.py', ctx.analyzeCode(pg, 'svc.py'));
  assert.strictEqual(rp.fixed, pg);
  assert.strictEqual(rp.verification.rolledBack, 1);
  assert.ok(reasons(rp).some(x => x === 'verification_failed:regression'));
});

// ═══ 14. applyFallbackToAll ═══════════════════════════════
test('applyFallbackToAll: اقتراحات فقط ثم تطبيق محكوم عبر FixVerifier', () => {
  const ctx = loadContext(['analyzer.js', 'fix_verifier.js', 'fallback_fixes.js']);
  const F = {
    'a.py':   'import sqlite3\ncursor.execute("SELECT * FROM t WHERE id = " + uid)\n',
    'b.kt':   'val q = "SELECT * FROM t WHERE id = " + id\n',
    'c.html': '<script>eval(x)</script>\n',
    'd.js':   'const data = eval(input);\n',
  };
  const sqlIssue = issueAt(2, SQL_PY), otherIssue = issueAt(1, 'http غير آمن', { sev: 'm' });
  const R = {
    'a.py':   { issues: [sqlIssue, otherIssue], score: 42, extra: 'keep' },
    'b.kt':   { issues: [issueAt(1, SQL_PY)] },
    'c.html': { issues: [issueAt(1, EVAL_JS)] },
    'd.js':   { issues: [issueAt(1, EVAL_JS)] },
  };

  const snapshot = JSON.stringify({ F, R });

  // المرحلة الأولى: اقتراح فقط — ممنوع الكتابة المباشرة.
  const out = ctx.applyFallbackToAll(F, R);

  assert.strictEqual(out.totalFixed, 0);
  assert.strictEqual(out.mode, 'proposal');
  assert.ok(out.proposals && typeof out.proposals === 'object');
  assert.ok(out.proposals['a.py']);
  assert.strictEqual(out.proposals['a.py'].before, F['a.py']);
  assert.strictEqual(
    out.proposals['a.py'].after,
    'import sqlite3\ncursor.execute("SELECT * FROM t WHERE id = ?", (uid,))\n'
  );

  const beforeApply = JSON.parse(snapshot);
  assert.deepStrictEqual(F, beforeApply.F);
  assert.deepStrictEqual(R, beforeApply.R);

  // المرحلة الثانية: التطبيق يمر عبر FixVerifier.
  const applied = ctx.applyFallbackProposals(F, R, out.proposals);

  // Python أصبح لديه checker محافظ، لذلك candidate الصحيح يمر عبر FixVerifier.
  assert.strictEqual(applied.applied.length, 1);
  assert.strictEqual(applied.rejected.length, 0);
  assert.strictEqual(applied.applied[0].file, 'a.py');
  assert.strictEqual(applied.applied[0].removedIssues, 1);
  assert.strictEqual(
    F['a.py'],
    'import sqlite3\ncursor.execute("SELECT * FROM t WHERE id = ?", (uid,))\n'
  );
  // التطبيق الناجح يحدّث issues فقط؛ metadata الأخرى تبقى كما هي.
  assert.strictEqual(R['a.py'].issues.length, 0, 'issues لم تُزل');
  assert.strictEqual(R['a.py'].score, 42, 'score تغيّر');
  assert.strictEqual(R['a.py'].extra, 'keep', 'extra تغيّر');
  // الملفات غير القابلة للإصلاح لم تتغير.
  for (const fn of ['b.kt', 'c.html', 'd.js']) {
    assert.strictEqual(F[fn], beforeApply.F[fn], fn + ': تغيّر');
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(R[fn])),
      beforeApply.R[fn],
      fn + ': تغيّر R'
    );
  }

  assert.ok(out.aiRequired['d.js'] && out.aiRequired['d.js'][0].status === 'AI_REQUIRED');
  assert.ok(out.aiRequired['b.kt'] && out.aiRequired['c.html']);

  // F/R فارغان أو R غائب: لا انهيار.
  assert.deepStrictEqual(ctx.applyFallbackToAll({}, {}).totalFixed, 0);
  assert.deepStrictEqual(
    ctx.applyFallbackToAll({ 'x.py': 'x = 1\n' }, undefined).totalFixed,
    0
  );
});
