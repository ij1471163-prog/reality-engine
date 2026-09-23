// ═══════════════════════════════════════════════════════
// اختبارات حارس المعنى في repair_engine.js (HARDCODED_SECRET / PASS / API_KEY / LOOSE_EQUALITY)
// تشغيل:  node --test vercel-api/test/repair_semantic_guard.test.js
//
// الـfixers تستبدل أول (["'])[^"']+(["']) — اقتباس الفتح والإغلاق قد يختلفان — وfixEquality
// تستبدل كل == في السطر، حتى داخل regex/نص/تعليق، وتحوّل == null و == "5".
// candidate كهذا صحيح نحويًا لكنه يغيّر معنى الكود: يُرفض في rejected، الكود لا يتغير،
// و aiRequired تستمر إلى aiNeeded. الحالات السليمة تبقى حرفيًا نفس ناتج الـfixer.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const noop = () => {};
const ctx = { console: { log: noop, warn: noop, error: noop, info: noop } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'repair_engine.js'), 'utf8'), ctx, { filename: 'repair_engine.js' });

const TITLES = {
  LOOSE_EQUALITY: 'مقارنة == بدل ===',
  HARDCODED_SECRET: '🔴 Hardcoded secret مكشوف',
  HARDCODED_PASS: '🔴 كلمة مرور مكتوبة في الكود (password)',
};
function run(code, stratTitle, file, extra) {
  const issues = [{ line: 1, title: stratTitle, ev: code.split('\n')[0].trim(), ...(extra || {}) }];
  const snapshot = JSON.stringify(issues);
  const out = ctx.repairCode(code, issues, file || 'a.js');
  assert.strictEqual(JSON.stringify(issues), snapshot, 'issues must not be modified');
  return out;
}

// ═══ 1. يُرفض ═════════════════════════════════════════
const REJECT = {
  'LOOSE_EQUALITY: == inside a regex literal': ['LOOSE_EQUALITY', 'if (!t.startsWith("//") && /String.*===|==.*String/.test(line)) x();\n', /^EQ_LITERAL_CHANGED/],
  'LOOSE_EQUALITY: == inside a string':        ['LOOSE_EQUALITY', 'if (a == b) log("use == here");\n', /^EQ_LITERAL_CHANGED/],
  'LOOSE_EQUALITY: == "5" becomes === 5':      ['LOOSE_EQUALITY', 'if (x == "5") y();\n', /^EQ_LITERAL_CHANGED/],
  'LOOSE_EQUALITY: == null':                   ['LOOSE_EQUALITY', 'if (issue == null) return "unknown";\n', /^EQ_NULL_SEMANTICS/],
  'LOOSE_EQUALITY: != undefined':              ['LOOSE_EQUALITY', 'if (v != undefined) use(v);\n', /^EQ_NULL_SEMANTICS/],
  'HARDCODED_SECRET: secret inside another string': ['HARDCODED_SECRET', "const code = 'const JWT_SECRET = \"s3cr3t\";\\nconst x = 1;';\n", /^SECRET_LITERAL_BROKEN/],
  'HARDCODED_SECRET: label key (name)':        ['HARDCODED_SECRET', "  { name: 'Secrets', fixer: null },\n", /^SECRET_NOT_CREDENTIAL/],
};
for (const [name, [strat, code, reason]] of Object.entries(REJECT)) {
  test(`${name} → rejected, code unchanged`, () => {
    const out = run(code, TITLES[strat]);
    assert.strictEqual(out.repaired, code);
    assert.strictEqual(out.repairs.length, 0);
    const rej = out.rejected.filter(r => r.strategy === strat);
    assert.strictEqual(rej.length, 1);
    assert.match(rej[0].reason, reason);
  });
}

test('rejected semantic candidate with aiRequired continues to aiNeeded', () => {
  const out = run('if (issue == null) return "unknown";\n', TITLES.LOOSE_EQUALITY, 'a.js', { aiRequired: true });
  assert.strictEqual(out.aiNeeded.length, 1);
  assert.strictEqual(out.aiNeeded[0].strategy, 'LOOSE_EQUALITY');
});

// ═══ 2. السليم يبقى كما هو (نفس ناتج الـfixer) ═════════════
const KEEP = {
  'LOOSE_EQUALITY: x == 2':          ['LOOSE_EQUALITY', 'if (x == 2) { console.log(x); }\n', 'if (x === 2) { console.log(x); }\n', 'a.js'],
  'LOOSE_EQUALITY: == "admin"':      ['LOOSE_EQUALITY', 'if (a == "admin") grant();\n', 'if (a === "admin") grant();\n', 'a.js'],
  'LOOSE_EQUALITY: regex + division': ['LOOSE_EQUALITY', 'if (a / b == c) d(/x/.test(s));\n', 'if (a / b === c) d(/x/.test(s));\n', 'a.js'],
  'HARDCODED_SECRET: const API_SECRET': ['HARDCODED_SECRET', 'const API_SECRET = "sk_live_abc123xyz789def456ghi";\n', 'const API_SECRET = process.env.API_SECRET;\n', 'a.js'],
  'HARDCODED_SECRET: const A (value is the secret)': ['HARDCODED_SECRET', 'const A = "secret_value_here";\n', 'const A = process.env.A;\n', 'a.js'],
  'HARDCODED_SECRET: python': ['HARDCODED_SECRET', 'password = "hunter2secret"\n', "password = os.environ.get('PASSWORD', '')\n", 'a.py'],
  'HARDCODED_SECRET: function argument': ['HARDCODED_SECRET', 'const t = jwt.sign({ id }, "hardcoded", { expiresIn: "1h" });\n', 'const t = jwt.sign({ id }, process.env.T, { expiresIn: "1h" });\n', 'a.js'],
  'HARDCODED_PASS: object password': ['HARDCODED_PASS', '  password: "hunter2",\n', '  password: process.env.PASSWORD,\n', 'a.js'],
};
for (const [name, [strat, code, expected, file]] of Object.entries(KEEP)) {
  test(`${name} → unchanged fixer output`, () => {
    const out = run(code, TITLES[strat], file);
    assert.strictEqual(out.repaired, expected);
    assert.strictEqual(out.rejected.filter(r => r.strategy === strat).length, 0);
  });
}

test('mixed line: == 2 fixed only when nothing inside a literal changes', () => {
  const code = 'if (a == 2 && s == "x==y") go();\n';
  const out = run(code, TITLES.LOOSE_EQUALITY);
  assert.strictEqual(out.repaired, code, 'the fixer also rewrites == inside "x==y" → rejected as a whole');
  assert.match(out.rejected.find(r => r.strategy === 'LOOSE_EQUALITY').reason, /^EQ_LITERAL_CHANGED/);
});

// ═══ 3. الـcall داخل string/تعليق (EVAL / CMD / SQL) ═════════
const LIT = {
  'EVAL_USAGE: eval inside a string':   ['EVAL_USAGE', "  ['a.py', 'x = eval(data)\\n', 't'],", "  ['a.py', 'x = JSON.parse(data)\\n', 't'],", 'js'],
  'EVAL_USAGE: eval inside a comment':  ['EVAL_USAGE', '// do not eval(data) here', '// do not JSON.parse(data) here', 'js'],
  'CMD_INJECTION: exec inside a string': ['CMD_INJECTION', "const none = 'exec(\"ls \" + d);\\n';", "// SECURITY: validate input before exec\nconst safeArgs = \"ls \" + d.replace(/[^a-zA-Z0-9 ]/g, '');\nconst none = 'exec(safeArgs);\\n';", 'js'],
  'CMD_INJECTION_PY: os.system inside a string': ['CMD_INJECTION_PY', "s = \"os.system('ls ' + d)\"", "s = \"subprocess.run(shlex.split('ls ' + d))\"", 'py'],
  'SQL_INJECTION: SQL inside a code-as-text string': ['SQL_INJECTION', "  f({ ev: 'cursor.execute(\"DELETE FROM t WHERE id = \" + uid)' });", "  f({ ev: 'cursor.execute(\"DELETE FROM t WHERE id = ?\")' });", 'js'],
  'SQL_INJECTION: legacy candidate (string + appended comment)': ['SQL_INJECTION', "  f({ ev: 'cursor.execute(\"DELETE FROM t WHERE id = \" + uid)' });", "  f({ ev: 'cursor.execute(\"DELETE FROM t WHERE id = ?\")' }); // use: db.query(sql, [param])", 'js'],
};
for (const [name, [strat, before, after, ext]] of Object.entries(LIT)) {
  test(`${name} → TARGET_IN_LITERAL`, () => {
    assert.match(ctx.literalTargetProblem(before, after, 1, strat, ext), /^TARGET_IN_LITERAL/);
  });
}
const LIT_OK = {
  'EVAL_USAGE: eval in code': ['EVAL_USAGE', 'const x = eval(data);', 'const x = JSON.parse(data);', 'js'],
  'CMD_INJECTION: exec in code': ['CMD_INJECTION', '  exec("ls " + req.query.dir);', "  // SECURITY: validate input before exec\n  const safeArgs = \"ls \" + req.query.dir.replace(/[^a-zA-Z0-9 ]/g, '');\n  exec(safeArgs);", 'js'],
  'SQL_INJECTION: real query string, concat → param': ['SQL_INJECTION', '  return db.query("SELECT * FROM users WHERE id = " + id);', '  return db.query("SELECT * FROM users WHERE id = ?", [id]);', 'js'],
  'SQL_INJECTION: real quoted concat': ['SQL_INJECTION', "    var query = \"SELECT * FROM p WHERE u='\" + u + \"'\";", '    var query = "SELECT * FROM p WHERE u=?";', 'js'],
  'SQL_INJECTION: real query + legacy comment': ['SQL_INJECTION', '  db.query("SELECT * FROM t WHERE id = " + id);', '  db.query("SELECT * FROM t WHERE id = ?", [id]); // use: db.query(sql, [param])', 'js'],
};
for (const [name, [strat, before, after, ext]] of Object.entries(LIT_OK)) {
  test(`${name} → accepted`, () => {
    assert.strictEqual(ctx.literalTargetProblem(before, after, 1, strat, ext), null);
  });
}

test('SQL fix in real code still applies on the server path (legacy fixer, parameterized)', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { RealityOrchestrator: O } = require('../public/server_engine_registration.js');
  const code = 'function getUser(req, db) {\n  const id = req.query.id;\n  return db.query("SELECT * FROM users WHERE id = " + id);\n}\nmodule.exports = getUser;\n';
  const r = await O.runPipelineAsync(code, 's1.js', { useFallbackChain: true });
  assert.strictEqual(r.decision.decision, 'SAFE_AUTO_FIX', r.decision.reason);
  assert.match(r.decision.patch, /WHERE id = \?", \[id\]\)/);
});

test('server path: SQL written inside a code-as-text string is never auto-applied (fallback_fixes.test.js L313)', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { RealityOrchestrator: O } = require('../public/server_engine_registration.js');
  const code = fs.readFileSync(path.join(__dirname, 'fallback_fixes.test.js'), 'utf8');
  const r = await O.runPipelineAsync(code, 'fallback_fixes.test.js', { useFallbackChain: true });
  const at = code.split('\n').findIndex(l => l.includes('cursor.execute("DELETE FROM t WHERE id = " + uid)'));
  assert.ok(at >= 0, 'precondition: fixture line exists');
  if (r.decision.patch) assert.strictEqual(r.decision.patch.split('\n')[at], code.split('\n')[at]);
});

// ═══ 4. السر طرفُ مقارنة، و API_KEY idempotency ═════════════
test('HARDCODED_SECRET: literal used as a comparison operand → rejected', () => {
  for (const [b, a] of [
    ["if (varTypes.get(name)==='HARDCODED_SECRET' && ok) {", 'if (varTypes.get(name)===process.env.TYPE && ok) {'],
    ["if ('admin_secret' != role) deny();", 'if (process.env.X != role) deny();'],
  ]) assert.match(ctx.semanticCandidateProblem(b, a, 1, 'HARDCODED_SECRET', 'js'), /comparison operand/);
});

test('API_KEY: a line already reading process.env is not rewritten (no self-assignment)', () => {
  const code = "process.env.ANTHROPIC_API_KEY = 'test_dummy_key_12345';\n";
  assert.strictEqual(ctx.fixApiKeyAdvanced(code, { line: 1 }, code.split('\n'), 'js', 'a.js'), null);
  const normal = "const apiKey = 'AIzaSyA1234567890abcdef';\n";
  assert.strictEqual(ctx.fixApiKeyAdvanced(normal, { line: 1 }, normal.split('\n'), 'js', 'a.js').patch, 'const apiKey = process.env.API_KEY;');
});

test('HARDCODED_PASS: a line already reading process.env / os.environ / getenv is not rewritten', () => {
  for (const [code, file] of [
    ['process.env.ANTHROPIC_API_KEY = "environment-key-123456";\n', 'a.js'],
    ["os.environ['DB_PASSWORD'] = 'hunter2secret'\n", 'a.py'],
    ["$pass = getenv('DB_PASS') ?: 'hunter2secret';\n", 'a.php'],
  ]) assert.strictEqual(ctx.fixHardcodedPassword(code, { line: 1 }, code.split('\n'), null, file), null, code);
  const normal = 'const password = "hunter2secret";\n';
  assert.strictEqual(ctx.fixHardcodedPassword(normal, { line: 1 }, normal.split('\n'), null, 'a.js').patch, 'const password = process.env.PASSWORD;');
});

test('claude_engine.test.js L183 case: no fixer turns process.env.X = "..." into a self-assignment', () => {
  const code = 'process.env.ANTHROPIC_API_KEY = "environment-key-123456";\n';
  const issues = [
    { line: 1, title: '🔐 Hardcoded API Key: API_***6"', ev: code.trim() },
    { line: 1, title: '🔴 كلمة مرور/مفتاح مُضمَّن في الكود', ev: code.trim() },
    { line: 1, title: '🔴 Hardcoded secret مكشوف', ev: code.trim() },
  ];
  const out = ctx.repairCode(code, issues, 'a.js');
  assert.strictEqual(out.repaired, code);
  assert.ok(!/ANTHROPIC_API_KEY\s*=\s*process\.env\.ANTHROPIC_API_KEY/.test(out.repaired));
});

test('server path: claude_engine.test.js never gets a process.env self-assignment', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { RealityOrchestrator: O } = require('../public/server_engine_registration.js');
  const code = fs.readFileSync(path.join(PUBLIC_DIR, 'claude_engine.test.js'), 'utf8');
  const r = await O.runPipelineAsync(code, 'claude_engine.test.js', { useFallbackChain: true });
  if (r.decision.patch) assert.ok(!/process\.env\.(\w+)\s*=\s*process\.env\.\1\b/.test(r.decision.patch), 'self-assignment reached the patch');
});
