// ═══════════════════════════════════════════════════════
// اختبارات repair_advanced.js v2.0 — طبقة الإصلاح المتقدم المحافظة
// تشغيل:  node --test vercel-api/test/*.test.js   (من جذر المستودع)
// بلا أي تبعيات خارجية — node:test مدمج. تُحمَّل repair_advanced.js وحدها
// (مع acorn.min.js للفحص النحوي، ومع analyzer.js في اختبارات التحقق فقط).
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
const engine    = (extra) => loadContext(['repair_advanced.js'], extra).AdvancedRepair;
const engineJS  = (extra) => loadContext(['acorn.min.js', 'repair_advanced.js'], extra).AdvancedRepair;

// النتائج تُنشأ داخل سياق vm (realm مختلف) فتُنسخ إلى هذا الـrealm قبل deepStrictEqual
const reasons = r => Array.from(r.aiRequired, x => x.reason);
const repairs = r => Array.from(r.repairs);
const verif   = r => Object.assign({}, r.verification);
const noPyInJs  = out => assert.ok(!/os\.environ|import os|subprocess|shlex|escapeshellarg|htmlspecialchars/.test(out), 'تسرّبت صياغة لغة أخرى إلى JS:\n' + out);
const noJsInPy  = out => assert.ok(!/process\.env|require\(|execFile|===|escapeshellarg|htmlspecialchars/.test(out), 'تسرّبت صياغة لغة أخرى إلى Python:\n' + out);
const noJsInPhp = out => assert.ok(!/process\.env|os\.environ|subprocess|execFile|console\./.test(out), 'تسرّبت صياغة لغة أخرى إلى PHP:\n' + out);
const idempotent = (AR, code, fn) => {
  const r1 = AR.fix(code, fn);
  const r2 = AR.fix(r1.fixed, fn);
  assert.strictEqual(r2.changed, false, fn + ': التشغيل الثاني عدّل الكود مرة أخرى:\n' + r2.fixed);
  assert.strictEqual(r2.repairs.length, 0);
  assert.strictEqual(r2.fixed, r1.fixed);
  return r1;
};

// ═══ 1. اللغة والواجهة ════════════════════════════════════
test('detectLang: mapping صريح، وunknown للامتدادات الأخرى — ولا إصلاح عليها', () => {
  const AR = engine();
  const expect = { 'a.js': 'js', 'a.ts': 'ts', 'a.jsx': 'jsx', 'a.tsx': 'tsx', 'a.py': 'py', 'a.php': 'php', 'A.java': 'java', 'A.cs': 'cs', 'a.rb': 'rb', 'a.go': 'go', 'a.JS': 'js',
                   'a.kt': 'unknown', 'a.html': 'unknown', 'a.mjs': 'unknown', 'a.vue': 'unknown', 'noext': 'unknown', '': 'unknown' };
  for (const [fn, lang] of Object.entries(expect)) assert.strictEqual(AR.detectLang(fn), lang, fn);
  assert.strictEqual(AR.detectLang(undefined), 'unknown');
  const code = 'const { exec } = require("child_process");\nexec("ls " + d);\nfetch(u).then(f);\nos.system("ls " + d)\necho $_GET["x"];\n';
  for (const fn of ['a.kt', 'a.html', 'a.mjs', 'noext', 'Dockerfile', 'a.swift']) {
    const r = AR.fix(code, fn);
    assert.strictEqual(r.fixed, code, fn + ': تغيّر الكود');
    assert.strictEqual(r.changed, false);
    assert.strictEqual(r.repairs.length, 0);
    assert.strictEqual(r.lang, 'unknown');
  }
});

test('الواجهة: fix تعيد { fixed, repairs, changed } كما كانت، وdetectLang/window/module محفوظة', () => {
  const ctx = loadContext(['repair_advanced.js']);
  const AR = ctx.AdvancedRepair;
  assert.strictEqual(typeof AR.fix, 'function');
  assert.strictEqual(typeof AR.detectLang, 'function');
  assert.strictEqual(ctx.window.AdvancedRepair, AR, 'window.AdvancedRepair لم يُضبط');
  const r = AR.fix('const x = 1;\n', 'a.js');
  assert.strictEqual(typeof r.fixed, 'string');
  assert.ok(Array.isArray(r.repairs));
  assert.strictEqual(typeof r.changed, 'boolean');
  assert.ok(Array.isArray(r.aiRequired));
  // module.exports في بيئة CommonJS
  const mod = { exports: {} };
  const c2 = vm.createContext({ console, module: mod });
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'repair_advanced.js'), 'utf8'), c2);
  assert.strictEqual(typeof mod.exports.fix, 'function');
});

// ═══ 2. Promise .catch ═══════════════════════════════════
test('Promise: تُضاف .catch() فقط لجملة سلسلة مستقلة — سطر واحد، متعددة الأسطر، نهاية بكتلة، TS', () => {
  const AR = engineJS();
  assert.strictEqual(AR.fix('fetch(url).then(r => r.json()).then(d => render(d));\n', 'a.js').fixed,
    "fetch(url).then(r => r.json()).then(d => render(d)).catch(err => console.error('Error:', err));\n");
  assert.strictEqual(AR.fix('function load() {\n  fetch(url)\n    .then(r => r.json())\n    .then(d => render(d));\n}\n', 'a.js').fixed,
    "function load() {\n  fetch(url)\n    .then(r => r.json())\n    .then(d => render(d))\n    .catch(err => console.error('Error:', err));\n}\n");
  assert.strictEqual(AR.fix('fetch(url).then(res => {\n  render(res);\n});\n', 'a.js').fixed,
    "fetch(url).then(res => {\n  render(res);\n}).catch(err => console.error('Error:', err));\n");
  const ts = AR.fix('const x: number = 1;\nfetch(url).then(r => r.json());\n', 'a.ts');
  assert.strictEqual(ts.fixed, "const x: number = 1;\nfetch(url).then(r => r.json()).catch(err => console.error('Error:', err));\n");
  assert.strictEqual(ts.verification.syntax, false, 'acorn لا يُطبَّق على TS');
  const multi = AR.fix('a().then(x);\nb()\n  .then(y)\n  .finally(z);\ndb.query(sql, (err, rows) => {\n  save(rows).then(done);\n});\n', 'a.js');
  assert.strictEqual(multi.fixed, "a().then(x).catch(err => console.error('Error:', err));\nb()\n  .then(y)\n  .finally(z);\ndb.query(sql, (err, rows) => {\n  save(rows).then(done).catch(err => console.error('Error:', err));\n});\n");
  assert.strictEqual(multi.repairs.length, 2);
  idempotent(AR, 'fetch(url)\n  .then(r => r.json())\n  .then(d => render(d));\n', 'a.js');
});

test('Promise: لا لمس عند إسناد/return/await/catch موجود/سلسلة متداخلة/وسيط/جسم سهم/jQuery', () => {
  const AR = engineJS();
  const code = 'const p = fetch(u).then(f);\nreturn fetch(u).then(f);\nawait fetch(u).then(f);\nfetch(u).then(f).catch(e => {});\nitems.map(x => fetch(x).then(f));\nres.json(fetch(u).then(f));\nconst g = () => fetch(u).then(f);\nconst q =\n  fetch(u).then(f);\nexport default fetch(u).then(f);\n';
  const r = AR.fix(code, 'a.js');
  assert.strictEqual(r.fixed, code, 'أُضيف catch حيث لا يجوز:\n' + r.fixed);
  assert.strictEqual(r.repairs.length, 0);
  const jq = 'jQuery.ajax(u).then(f);\n';
  const rj = AR.fix(jq, 'a.js');
  assert.strictEqual(rj.fixed, jq);
  assert.deepStrictEqual(reasons(rj), ['jquery_deferred_ambiguous']);
  // .then داخل سلسلة نصية أو تعليق ليس سلسلة promise
  const str = 'const s = "a.then(b)";\n// p.then(f)\n';
  assert.strictEqual(AR.fix(str, 'a.js').fixed, str);
});

test('Promise: فشل الفحص النحوي (acorn) بعد التعديل ⇒ rollback وسبب مسجَّل', () => {
  const ctx = loadContext(['acorn.min.js', 'repair_advanced.js']);
  const realParse = vm.runInContext('acorn.parse', ctx);
  vm.runInContext('acorn.parse = function (src, opts) { if (src.includes(".catch(")) throw new SyntaxError("forced"); return realParse(src, opts); }', vm.createContext(Object.assign(ctx, { realParse })));
  const code = 'fetch(url).then(f);\n';
  const r = ctx.AdvancedRepair.fix(code, 'a.js');
  assert.strictEqual(r.fixed, code);
  assert.strictEqual(r.changed, false);
  assert.deepStrictEqual(verif(r), { checked: 1, rolledBack: 1, analyzer: false, syntax: true });
  assert.deepStrictEqual(reasons(r), ['verification_failed:syntax_broken']);
});

// ═══ 3. Command Injection ════════════════════════════════
test('CMD JS: exec/execSync من child_process فقط ⇒ execFile مع argv، والاستيراد يُحدَّث؛ regex.exec لا يُلمس', () => {
  const AR = engineJS();
  const r1 = AR.fix('const { exec } = require("child_process");\nconst re = /a/;\nre.exec(input);\nexec("ls -la " + dir, (err, out) => { console.log(out); });\nexec("git log " + ref, cb);\n', 'a.js');
  assert.strictEqual(r1.fixed, 'const { exec, execFile } = require("child_process");\nconst re = /a/;\nre.exec(input);\nexecFile("ls", ["-la", dir], (err, out) => { console.log(out); });\nexecFile("git", ["log", ref], cb);\n');
  assert.strictEqual(r1.repairs.length, 2);
  assert.deepStrictEqual(reasons(r1), []);
  const r2 = AR.fix('const cp = require("child_process");\nconst out = cp.execSync(`ping -c 1 ${host}`).toString();\n', 'a.js');
  assert.strictEqual(r2.fixed, 'const cp = require("child_process");\nconst out = cp.execFileSync("ping", ["-c", "1", host]).toString();\n');
  const r3 = AR.fix('import { exec, spawn } from "node:child_process";\nexec("git log " + ref);\n', 'a.ts');
  assert.strictEqual(r3.fixed, 'import { exec, spawn, execFile } from "node:child_process";\nexecFile("git", ["log", ref]);\n');
  noPyInJs(r1.fixed + r2.fixed + r3.fixed);
  idempotent(AR, 'const { exec } = require("child_process");\nexec("ls -la " + dir, cb);\n', 'a.js');
});

test('CMD JS: أمر من متغير، رموز shell، خيار shell، exec مُغلَّف بـpromisify، أمر ثابت، بلا child_process ⇒ لا لمس', () => {
  const AR = engineJS();
  const code = 'const { exec } = require("child_process");\nexec(cmd);\nexec("cat " + f + " | grep x");\nexec("ls " + d, { shell: "/bin/sh" }, cb);\nexec("ls", cb);\nexec("rm -rf " + p + " && echo done");\n';
  const r = AR.fix(code, 'a.js');
  assert.strictEqual(r.fixed, code);
  assert.deepStrictEqual(reasons(r).sort(), ['command_from_variable', 'shell_option_present', 'shell_syntax_in_command', 'shell_syntax_in_command']);
  const prom = 'const util = require("util");\nconst exec = util.promisify(require("child_process").exec);\nawait exec("ls " + d);\n';
  assert.strictEqual(AR.fix(prom, 'a.js').fixed, prom, 'exec المُغلَّف بـpromisify عُدِّل');
  const none = 'exec("ls " + d);\n';
  assert.strictEqual(AR.fix(none, 'a.js').fixed, none);
});

test('CMD Python: os.system/shell=True ⇒ argv بلا shell وبلا shlex، وimport subprocess مرة واحدة؛ الحالات غير المؤكدة لا تُلمس', () => {
  const AR = engine();
  const r = AR.fix('import os\ndef f(host):\n    os.system("ping -c 1 " + host)\n    os.system(f"convert {src} -o {dst}")\n    rc = os.system("ls " + d)\n    if os.system("test -f " + p) == 0:\n        pass\n    subprocess.run("ls -la " + d, shell=True, check=True)\n    os.system("ls -la")\n', 'a.py');
  assert.strictEqual(r.fixed, 'import os\nimport subprocess\ndef f(host):\n    subprocess.run(["ping", "-c", "1", host])\n    subprocess.run(["convert", src, "-o", dst])\n    rc = os.system("ls " + d)\n    if os.system("test -f " + p) == 0:\n        pass\n    subprocess.run(["ls", "-la", d], check=True)\n    os.system("ls -la")\n');
  assert.strictEqual(r.repairs.length, 3);
  assert.deepStrictEqual(reasons(r).sort(), ['return_value_used', 'return_value_used']);
  assert.ok(!/shell\s*=\s*True|shlex/.test(r.fixed));
  noJsInPy(r.fixed);
  const blocked = 'import os\nos.system("cat " + f + " | grep x")\nos.system(cmd)\nos.system(cmd + " -v")\nout = os.popen("ls " + d).read()\nsubprocess.run("ls " + d, shell=True, executable="/bin/bash")\nsubprocess.run(cmd, shell=True)\n';
  const rb = AR.fix(blocked, 'a.py');
  assert.strictEqual(rb.fixed, blocked, 'حالة غير مؤكدة عُدِّلت:\n' + rb.fixed);
  assert.deepStrictEqual(reasons(rb).sort(), ['command_from_variable', 'command_from_variable', 'command_from_variable', 'executable_override', 'return_value_semantics_change', 'shell_syntax_in_command']);
  idempotent(AR, 'import os\nos.system("ping -c 1 " + host)\n', 'a.py');
});

test('CMD PHP: escapeshellarg فقط لمتغير في موضع وسيط داخل أمر ثابت؛ متغير كامل أو pipe ⇒ AI_REQUIRED', () => {
  const AR = engine();
  const r = AR.fix('<?php\nexec("ls -la " . $dir, $out, $ret);\nsystem("ping -c 1 $host");\nexec($cmd);\nshell_exec("cat " . $f . " | grep x");\nexec("ls " . escapeshellarg($d));\npassthru("convert " . $in . " --out=" . $out);\n', 'a.php');
  const lines = r.fixed.split('\n');
  assert.strictEqual(lines[1], "exec('ls -la ' . escapeshellarg($dir), $out, $ret);");
  assert.strictEqual(lines[2], "system('ping -c 1 ' . escapeshellarg($host));");
  assert.strictEqual(lines[3], 'exec($cmd);');
  assert.strictEqual(lines[4], 'shell_exec("cat " . $f . " | grep x");');
  assert.strictEqual(lines[5], 'exec("ls " . escapeshellarg($d));');
  assert.strictEqual(lines[6], "passthru('convert ' . escapeshellarg($in) . ' --out=' . escapeshellarg($out));");
  assert.deepStrictEqual(reasons(r).sort(), ['command_from_variable', 'shell_syntax_in_command']);
  assert.ok(!r.fixed.includes('escapeshellcmd'));
  noJsInPhp(r.fixed);
  idempotent(AR, '<?php\nexec("ls -la " . $dir);\n', 'a.php');
});

test('CMD Java/C#/Ruby/Go: تقرير AI_REQUIRED فقط — لا تعديل', () => {
  const AR = engine();
  const cases = [['A.java', 'Runtime.getRuntime().exec("ls " + dir);\n'], ['A.cs', 'Process.Start("cmd.exe", "/c " + input);\n'], ['a.rb', 'system("ls " + dir)\n'], ['a.go', 'exec.Command("sh", "-c", cmd)\n']];
  for (const [fn, code] of cases) {
    const r = AR.fix(code, fn);
    assert.strictEqual(r.fixed, code, fn);
    assert.strictEqual(r.changed, false);
    assert.deepStrictEqual(reasons(r), ['command_injection_manual_review'], fn);
  }
});

// ═══ 4. JWT ══════════════════════════════════════════════
test('JWT: نقل secret مُضمَّن فقط — لا expiresIn، الخيارات تبقى، env موجود لا يُلمس، idempotent', () => {
  const AR = engineJS();
  const code = 'const JWT_SECRET = "s3cr3t";\nconst jwtSecret = "abc";\nconst token = jwt.sign({ id }, "hardcoded", { expiresIn: "1h" });\nconst t1 = jwt.sign({ id }, "hardcoded");\njwt.verify(token, "hardcoded");\nconst t2 = jwt.sign({ id }, secret);\nconst t3 = jwt.sign({ id }, process.env.JWT_SECRET);\nconst other = "abc";\n';
  const r = idempotent(AR, code, 'a.js');
  assert.strictEqual(r.fixed, 'const JWT_SECRET = process.env.JWT_SECRET;\nconst jwtSecret = process.env.JWT_SECRET;\nconst token = jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "1h" });\nconst t1 = jwt.sign({ id }, process.env.JWT_SECRET);\njwt.verify(token, process.env.JWT_SECRET);\nconst t2 = jwt.sign({ id }, secret);\nconst t3 = jwt.sign({ id }, process.env.JWT_SECRET);\nconst other = "abc";\n');
  assert.strictEqual((r.fixed.match(/expiresIn/g) || []).length, 1, 'أُضيف expiresIn من المحرك');
  assert.strictEqual(r.repairs.length, 5);
  noPyInJs(r.fixed);
});

// ═══ 5. Audit logging ════════════════════════════════════
test('Audit: مسار واضح البنية وحساس/مغيّر للحالة فقط ⇒ سطر تسجيل بميتاداتا آمنة؛ غير ذلك لا يُلمس', () => {
  const AR = engineJS();
  const code = 'app.post("/users", async (req, res) => {\n  const u = await create(req.body);\n  res.json(u);\n});\napp.get("/health", (req, res) => {\n  res.send("ok");\n});\nrouter.delete("/items/:id", auth, function (req, res) {\n  remove(req.params.id);\n});\napp.get("/admin/users", (req, res) => {\n  logger.info("x");\n});\napp.put("/x", handler);\napp.post("/reset-password", (req, res) => {\n  reset(req.body);\n});\napp.post("/typed", (req: Request, res: Response) => {\n  res.json({});\n});\napp.post("/expr", (req, res) => res.json(ok));\napp.post("/multi",\n  (req, res) => {\n  res.json({});\n});\n';
  const r = idempotent(AR, code, 'a.ts');
  const L = r.fixed.split('\n');
  assert.strictEqual(L[1], "  console.log('[AUDIT]', req.method, \"/users\", (req.user && req.user.id) || 'anonymous');");
  assert.strictEqual(L[5], 'app.get("/health", (req, res) => {');
  assert.strictEqual(L[6], '  res.send("ok");', 'GET غير حساس عُدِّل');
  assert.strictEqual(L[9], "  console.log('[AUDIT]', req.method, \"/items/:id\", (req.user && req.user.id) || 'anonymous');");
  assert.strictEqual(L[13], '  logger.info("x");', 'تسجيل موجود ومع ذلك أُضيف آخر');
  assert.strictEqual(L[15], 'app.put("/x", handler);');
  assert.strictEqual(L[17], "  console.log('[AUDIT]', req.method, (req.route && req.route.path) || '-', (req.user && req.user.id) || 'anonymous');", 'مسار حساس كُتب حرفياً في التسجيل');
  assert.strictEqual(L[21], "  console.log('[AUDIT]', req.method, \"/typed\", (req.user && req.user.id) || 'anonymous');");
  assert.strictEqual(L[24], 'app.post("/expr", (req, res) => res.json(ok));', 'جسم تعبيري عُدِّل');
  assert.strictEqual(L[25], 'app.post("/multi",');
  assert.strictEqual(L[26], '  (req, res) => {', 'توقيع متعدد الأسطر عُدِّل');
  assert.strictEqual(r.repairs.filter(x => x === 'Audit logging added').length, 4);
  assert.ok(!/req\.body|password|token/.test(L[1] + L[9] + L[17] + L[21]));
});

// ═══ 6. Python exceptions ════════════════════════════════
test('Python: جسم except فارغ (pass) ⇒ logging.exception بلا تغيير control flow، وimport آمن غير مكرر، وbare except يُبلَّغ', () => {
  const AR = engine();
  const code = 'def f():\n    try:\n        x()\n    except:\n        pass\n    try:\n        y()\n    except Exception as e:\n        pass\n    try:\n        z()\n    except ValueError:\n        logging.error("bad")\n    try:\n        w()\n    except KeyError: pass\n    try:\n        v()\n    except:\n        cleanup()\n        raise\n';
  const r = idempotent(AR, code, 'a.py');
  assert.strictEqual(r.fixed, 'import logging\ndef f():\n    try:\n        x()\n    except:\n        logging.exception("Unhandled exception")\n    try:\n        y()\n    except Exception as e:\n        logging.exception("Unhandled exception")\n    try:\n        z()\n    except ValueError:\n        logging.error("bad")\n    try:\n        w()\n    except KeyError: logging.exception("Unhandled exception")\n    try:\n        v()\n    except:\n        cleanup()\n        raise\n');
  assert.strictEqual((r.fixed.match(/^import logging$/mg) || []).length, 1);
  assert.strictEqual(r.fixed.split('\n').length, code.split('\n').length + 1, 'تغيّر عدد الأسطر بغير الاستيراد');
  assert.ok(!/except Exception as e:\n\s*pass/.test(r.fixed));
  assert.deepStrictEqual(reasons(r).sort(), ['bare_except_semantics', 'bare_except_semantics']);
  assert.ok(r.fixed.includes('    except:\n        cleanup()\n        raise\n'), 'except غير الفارغ تغيّر');
  noJsInPy(r.fixed);
  const nested = 'import logging\nlogger = logging.getLogger(__name__)\ndef f():\n    try:\n        try:\n            a()\n        except IOError:\n            pass\n    except Exception:\n        pass\n';
  const rn = AR.fix(nested, 'a.py');
  assert.strictEqual(rn.fixed, 'import logging\nlogger = logging.getLogger(__name__)\ndef f():\n    try:\n        try:\n            a()\n        except IOError:\n            logger.exception("Unhandled exception")\n    except Exception:\n        logger.exception("Unhandled exception")\n');
  assert.strictEqual((rn.fixed.match(/^import logging$/mg) || []).length, 1, 'import logging تكرر');
});

// ═══ 7. PHP XSS ══════════════════════════════════════════
test('PHP XSS: htmlspecialchars لـecho مباشر في سياق HTML فقط؛ attribute/JS/JSON/تعبير مركب ⇒ AI_REQUIRED', () => {
  const AR = engine();
  const code = '<?php\necho $_GET["name"];\nprint $_POST[\'x\'];\n<td><?php echo $_POST[\'x\']; ?></td>\n<a href="<?php echo $_GET[\'u\']; ?>">x</a>\n<script>var n = "<?php echo $_GET[\'n\']; ?>";</script>\n<?php echo htmlspecialchars($_GET["ok"], ENT_QUOTES, "UTF-8");\necho "Hi " . $_GET["name"];\necho intval($_GET["id"]);\n';
  const r = idempotent(AR, code, 'a.php');
  const L = r.fixed.split('\n');
  assert.strictEqual(L[1], "echo htmlspecialchars($_GET[\"name\"], ENT_QUOTES, 'UTF-8');");
  assert.strictEqual(L[2], "print htmlspecialchars($_POST['x'], ENT_QUOTES, 'UTF-8');");
  assert.strictEqual(L[3], "<td><?php echo htmlspecialchars($_POST['x'], ENT_QUOTES, 'UTF-8'); ?></td>");
  assert.strictEqual(L[4], '<a href="<?php echo $_GET[\'u\']; ?>">x</a>', 'سياق attribute عُدِّل');
  assert.strictEqual(L[5], '<script>var n = "<?php echo $_GET[\'n\']; ?>";</script>', 'سياق JavaScript عُدِّل');
  assert.strictEqual(L[6], '<?php echo htmlspecialchars($_GET["ok"], ENT_QUOTES, "UTF-8");', 'مخرج مُهرَّب أصلاً عُدِّل');
  assert.strictEqual(L[7], 'echo "Hi " . $_GET["name"];');
  assert.strictEqual(L[8], 'echo intval($_GET["id"]);');
  assert.deepStrictEqual(reasons(r).sort(), ['echo_expression_not_simple', 'html_attribute_context', 'javascript_context']);
  const json = '<?php\nheader("Content-Type: application/json");\necho $_GET["q"];\n';
  const rj = AR.fix(json, 'a.php');
  assert.strictEqual(rj.fixed, json);
  assert.deepStrictEqual(reasons(rj), ['non_html_content_type']);
});

// ═══ 8. MD5 / weak hash ══════════════════════════════════
test('Weak hash: لا استبدال عام أبداً — تقرير AI_REQUIRED مع تمييز سياق كلمة المرور', () => {
  const AR = engine();
  const cases = [
    ['a.php', '$h = md5($password);\n$c = md5($file);\n', ['weak_hash_password_context_use_password_hash', 'weak_hash_usage_unclear']],
    ['a.py',  'import hashlib\nh = hashlib.md5(pw.encode()).hexdigest()\n', ['weak_hash_usage_unclear']],
    ['a.js',  'const h = crypto.createHash("md5").update(password).digest("hex");\n', ['weak_hash_password_context_use_password_hash']],
    ['A.java', 'MessageDigest md = MessageDigest.getInstance("MD5");\n', ['weak_hash_usage_unclear']],
  ];
  for (const [fn, code, expected] of cases) {
    const r = engine().fix(code, fn);
    assert.strictEqual(r.fixed, code, fn + ': md5 عُدِّل');
    assert.deepStrictEqual(reasons(r).sort(), expected.slice().sort(), fn);
    assert.ok(!/sha256/.test(r.fixed));
  }
  assert.strictEqual(AR.fix('$h = hash("sha256", $x);\n', 'a.php').aiRequired.length, 0);
});

// ═══ 9. Secrets ══════════════════════════════════════════
test('Secrets: اسم واضح + قيمة مضمّنة + لا env أصلاً ⇒ env بصياغة اللغة (convention UPPER_SNAKE)، وإلا لا لمس', () => {
  const AR = engine();
  const py = 'import os\nAPI_KEY = "sk_live_abcdef123456"\ndb_password = "hunter2secret"\nTOKEN = "changeme"\nname = "not a secret value"\nSMTP_PASS = os.environ.get("SMTP_PASS", "")\nSHORT_KEY = "abc"\n';
  const r = idempotent(AR, py, 'a.py');
  assert.strictEqual(r.fixed, 'import os\nAPI_KEY = os.environ.get(\'API_KEY\', \'\')\ndb_password = os.environ.get(\'DB_PASSWORD\', \'\')\nTOKEN = "changeme"\nname = "not a secret value"\nSMTP_PASS = os.environ.get("SMTP_PASS", "")\nSHORT_KEY = "abc"\n');
  assert.strictEqual((r.fixed.match(/^import os$/mg) || []).length, 1);
  noJsInPy(r.fixed);
  // env يُقرأ أصلاً لنفس الاسم ⇒ لا تحويل
  const dup = 'import os\nAPI_KEY = "sk_live_abcdef123456"\nkey = os.environ.get("API_KEY")\n';
  const rd = AR.fix(dup, 'a.py');
  assert.strictEqual(rd.fixed, dup);
  assert.deepStrictEqual(reasons(rd), ['env_already_read_for_name']);
  const php = '<?php\n$apiKey = "sk_live_abcdef123456";\ndefine("DB_PASSWORD", "hunter2secret");\n$token = getenv("TOKEN");\n$name = "someone";\nclass A {\n    private $secretKey = "abcdefgh";\n}\n';
  const rp = idempotent(AR, php, 'a.php');
  assert.strictEqual(rp.fixed, '<?php\n$apiKey = getenv(\'API_KEY\');\ndefine("DB_PASSWORD", getenv(\'DB_PASSWORD\'));\n$token = getenv("TOKEN");\n$name = "someone";\nclass A {\n    private $secretKey = "abcdefgh";\n}\n');
  assert.deepStrictEqual(reasons(rp), ['class_property_needs_constructor_init']);
  noJsInPhp(rp.fixed);
  // Java/JS لا تُلمس هنا (خارج نطاق هذه الطبقة)
  const java = 'String apiKey = "sk_live_abcdef123456";\n';
  assert.strictEqual(AR.fix(java, 'A.java').fixed, java);
});

// ═══ 10. التحقق والرجوع ══════════════════════════════════
test('التحقق بالمحلل: انحدار أو انهيار على الكود المُعدَّل ⇒ rollback للإصلاح وحده مع السبب؛ محلل سليم ⇒ يُقبل', () => {
  const code = 'fetch(url).then(f);\nconst JWT_SECRET = "s3cr3t";\n';
  const regress = c => c.includes('.catch(') ? [{ sev: 'c', type: 'bug', cAct: 'NEW_CRITICAL', title: 'x', line: 1 }] : [];
  const rA = engineJS({ analyzeCode: regress }).fix(code, 'a.js');
  assert.strictEqual(rA.fixed, 'fetch(url).then(f);\nconst JWT_SECRET = process.env.JWT_SECRET;\n', 'الإصلاح السليم رُفض مع الفاشل');
  assert.deepStrictEqual(verif(rA), { checked: 2, rolledBack: 1, analyzer: true, syntax: true });
  assert.deepStrictEqual(reasons(rA), ['verification_failed:regression']);
  const boom = c => { if (c.includes('.catch(')) throw new Error('boom'); return []; };
  const rB = engineJS({ analyzeCode: boom }).fix(code, 'a.js');
  assert.ok(!rB.fixed.includes('.catch('));
  assert.deepStrictEqual(reasons(rB), ['verification_failed:analysis_failed']);
  const rC = engineJS({ analyzeCode: () => [] }).fix(code, 'a.js');
  assert.strictEqual(rC.fixed, "fetch(url).then(f).catch(err => console.error('Error:', err));\nconst JWT_SECRET = process.env.JWT_SECRET;\n");
  assert.deepStrictEqual(verif(rC), { checked: 2, rolledBack: 0, analyzer: true, syntax: true });
  // options.analyze يُقدَّم على العام
  const rD = engineJS().fix(code, 'a.js', { analyze: regress });
  assert.deepStrictEqual(reasons(rD), ['verification_failed:regression']);
});

test('تكامل analyzer.js الحقيقي: إصلاحات JS وPython تُقبل بلا انحدار، والملف لا يزيد حرجاً/عالياً', () => {
  const ctx = loadContext(['acorn.min.js', 'analyzer.js', 'repair_advanced.js']);
  const AR = ctx.AdvancedRepair;
  const sev = arr => arr.filter(i => i.sev === 'c' || i.sev === 'h').length;
  const js = 'const { exec } = require("child_process");\nconst JWT_SECRET = "s3cr3t123";\napp.post("/users", (req, res) => {\n  save(req.body).then(done);\n});\nexec("ls -la " + dir);\n';
  const rj = AR.fix(js, 'app.js');
  assert.strictEqual(rj.verification.analyzer, true);
  assert.ok(rj.fixed.includes('execFile("ls", ["-la", dir])') && rj.fixed.includes('process.env.JWT_SECRET') && rj.fixed.includes('.catch(') && rj.fixed.includes('[AUDIT]'), rj.fixed);
  assert.ok(sev(ctx.analyzeCode(rj.fixed, 'app.js')) <= sev(ctx.analyzeCode(js, 'app.js')));
  assert.strictEqual(rj.verification.rolledBack, 0, JSON.stringify(Array.from(rj.aiRequired)));
  const py = 'import os\ndef run(host):\n    os.system("ping -c 1 " + host)\n    try:\n        go()\n    except Exception:\n        pass\n';
  const rp = AR.fix(py, 'svc.py');
  assert.ok(rp.fixed.includes('subprocess.run(["ping", "-c", "1", host])') && rp.fixed.includes('logging.exception('), rp.fixed);
  assert.ok(sev(ctx.analyzeCode(rp.fixed, 'svc.py')) <= sev(ctx.analyzeCode(py, 'svc.py')));
  assert.strictEqual(rp.verification.rolledBack, 0, JSON.stringify(Array.from(rp.aiRequired)));
});

// ═══ 11. عزل اللغات وidempotency شامل ════════════════════
test('عزل اللغات: الامتداد هو الحكم — لا صياغة JS في Python/PHP ولا العكس', () => {
  const AR = engineJS();
  const pyWithJs = 'const { exec } = require("child_process");\nexec("ls " + d);\nfetch(u).then(f);\n';
  assert.strictEqual(AR.fix(pyWithJs, 'a.py').fixed, pyWithJs);
  const jsWithPy = 'import os\nos.system("ls " + d)\ntry:\n    x()\nexcept:\n    pass\n';
  assert.strictEqual(AR.fix(jsWithPy, 'a.js').fixed, jsWithPy);
  // ملاحظة: system() دالة PHP حقيقية و"." هو عامل الدمج في PHP، فـ os.system("…" . $d) استدعاء system() فعلي — لذا الحالة هنا بصياغة Python صرفة
  const phpWithPy = '<?php\nsubprocess.run("ls " + $d, shell=True)\nos.popen(cmd).read()\n';
  assert.strictEqual(AR.fix(phpWithPy, 'a.php').fixed, phpWithPy);
  const phpStatic = '<?php\nRunner::exec("ls " . $d);\n$r->exec("ls " . $d);\n';
  assert.strictEqual(AR.fix(phpStatic, 'a.php').fixed, phpStatic, 'استدعاء static/method عُدِّل كأنه exec() العام');
  const javaWithPhp = 'echo $_GET["x"];\n';
  assert.strictEqual(AR.fix(javaWithPhp, 'A.java').fixed, javaWithPhp);
});

test('Idempotency شامل: تشغيل fix مرتين على ملفات JS/TS/Python/PHP متعددة الفئات لا يُنتج إصلاحات إضافية', () => {
  const AR = engineJS();
  idempotent(AR, 'const { exec } = require("child_process");\nconst JWT_SECRET = "s3cr3t";\napp.post("/users", (req, res) => {\n  save(req.body).then(done);\n});\nexec("ls " + d);\nfetch(u)\n  .then(a)\n  .then(b);\n', 'a.js');
  idempotent(AR, 'import { exec } from "child_process";\nconst token = jwt.sign({ id }, "abc", { expiresIn: "1h" });\nexec("git log " + ref);\n', 'a.tsx');
  idempotent(AR, 'API_KEY = "sk_live_abcdef123456"\ndef f():\n    os.system("ping " + host)\n    try:\n        a()\n    except Exception:\n        pass\n', 'a.py');
  idempotent(AR, '<?php\n$apiKey = "sk_live_abcdef123456";\nexec("ls " . $d);\necho $_GET["x"];\n', 'a.php');
});
