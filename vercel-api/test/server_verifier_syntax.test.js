// ═══════════════════════════════════════════════════════
// اختبارات VERIFIER السيرفر في server_engine_registration.js
// تشغيل:  node --test vercel-api/test/server_verifier_syntax.test.js
//
// VERIFIER السيرفر كان FixVerifier.verify: مقارنة Analyzer فقط، بلا syntax
// ولا quickCheck ولا SQL guard — فكان كود مكسور يصل SAFE_AUTO_FIX ويرجع
// للعميل كـfixed. الآن FixVerifier.fullVerify (نفس عقد {valid, improved}
// الذي يقرأه runVerification) مع allowUnverifiedLanguages: true، حتى لا
// تتوقف إصلاحات سليمة في لغات بلا syntax checker في السيرفر (TS/ESM/PHP).
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

delete process.env.ANTHROPIC_API_KEY;
const {
  RealityOrchestrator: O,
  FixVerifier: FV,
} = require('../public/server_engine_registration.js');

const ROOT = path.join(__dirname, '..');
const pipeline = (code, file, opts) => O.runPipelineAsync(code, file, Object.assign({ useFallbackChain: true }, opts || {}));
const syntaxOk = (code, file) => FV.syntaxCheck(code, file).ok;

async function withClaude(text, fn) {
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test_dummy_key_12345';
  try {
    return await fn({ _fetchFn: async () => ({ ok: true, status: 200,
      json: async () => ({ model: 'm', content: [{ type: 'text', text }] }) }) });
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev;
  }
}

// ═══ 1. عقد النتيجة ═════════════════════════════════════
test('server verifier returns the {valid, improved} contract read by runVerification', () => {
  const v = O.listEngines(O.EngineType.VERIFIER);
  assert.strictEqual(v.length, 1);
  const r = v[0].fn('var x = 1;\nfetch("http://api.example.com/a");\n',
                    'let x = 1;\nfetch("https://api.example.com/a");\n', 'a.js');
  assert.strictEqual(typeof r.valid, 'boolean');
  assert.strictEqual(typeof r.improved, 'boolean');
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.improved, true);
});

// ═══ 2. runVerification يرفض المكسور ════════════════════
const BROKEN = {
  'JS missing paren':  ['a.js', 'var x = 1;\nfetch("http://api.example.com/a");\n', 'let x = 1;\nfetch("https://api.example.com/a";\n', /^REJECTED_SYNTAX_BROKEN \[javascript\]/],
  'JS unclosed brace': ['a.js', 'function f(a) {\n  var y = a;\n  return y;\n}\n', 'function f(a) {\n  let y = a;\n  return y;\n\n', /^REJECTED_SYNTAX_BROKEN \[javascript\]/],
  'Python missing paren': ['a.py', 'import os\nos.system("ls " + x)\nurl = "http://api.example.com"\n', 'import os\nos.system("ls " + x\nurl = "https://api.example.com"\n', /^REJECTED_SYNTAX_BROKEN \[python\]/],
  'JS mass deletion':  ['a.js', 'var a=1;\nfunction f(){return 1}\nfunction g(){return 2}\nfunction h(){return 3}\nfetch("http://x.example.com");\nconsole.log(a);\n', 'fetch("https://x.example.com");\n', /حُذف أكثر من 50%/],
};
for (const [name, [file, before, after, reason]] of Object.entries(BROKEN)) {
  test(`runVerification rejects: ${name}`, () => {
    const r = O.runVerification(before, after, file);
    assert.strictEqual(r.valid, false);
    assert.match(r.reason, reason);
  });
}

// ═══ 3. runVerification يقبل السليم (بما فيه لغات بلا checker) ═
const VALID = {
  'JS':     ['a.js',  'var x = 1;\nfetch("http://api.example.com/a");\n', 'let x = 1;\nfetch("https://api.example.com/a");\n'],
  'Python': ['a.py',  'import os\nurl = "http://api.example.com"\n', 'import os\nurl = "https://api.example.com"\n'],
  'TS (no checker on server)':  ['a.ts',  'var a: number = 1;\nfetch("http://api.example.com/a");\n', 'let a: number = 1;\nfetch("https://api.example.com/a");\n'],
  'ESM (no checker on server)': ['a.mjs', 'import x from "y";\nvar a = 1;\nfetch("http://api.example.com/a");\n', 'import x from "y";\nlet a = 1;\nfetch("https://api.example.com/a");\n'],
  'PHP (no checker on server)': ['a.php', '<?php\n$u = "http://api.example.com";\n', '<?php\n$u = "https://api.example.com";\n'],
  'SQL parameterized JS': ['a.js', 'function g(req, db) {\n  return db.query("SELECT * FROM users WHERE id = " + req.query.id);\n}\n', 'function g(req, db) {\n  return db.query("SELECT * FROM users WHERE id = ?", [req.query.id]);\n}\n'],
  'SQL parameterized PY': ['a.py', 'def g(c, i):\n    q = "SELECT * FROM t WHERE id=" + i\n    c.execute(q)\n', 'def g(c, i):\n    q = "SELECT * FROM t WHERE id=?"\n    c.execute(q, (i,))\n'],
};
for (const [name, [file, before, after]] of Object.entries(VALID)) {
  test(`runVerification accepts valid fix: ${name}`, () => {
    const r = O.runVerification(before, after, file);
    assert.strictEqual(r.valid, true, r.reason);
    assert.strictEqual(r.improved, true, r.reason);
  });
}

test('runVerification: SQL candidate that is not parameterized is not accepted', () => {
  const r = O.runVerification(
    'function g(req, db) {\n  return db.query("SELECT * FROM users WHERE id = " + req.query.id);\n}\n',
    'function g(req, db) {\n  const id = String(req.query.id);\n  return db.query("SELECT * FROM users WHERE id = " + id.replace(/x/g, ""));\n}\n',
    'a.js');
  assert.ok(!(r.valid === true && r.improved === true), r.reason);
});

// ═══ 4. المسار الكامل: patch حتمي مكسور لا يصل SAFE_AUTO_FIX ═
const DET_BROKEN = {
  'secret inside string (HARDCODED_PASS)': "const secret = 'const API_SECRET = \"sk_live_abc123xyz789def456ghi\";\\nmodule.exports = API_SECRET;\\n';\nmodule.exports = secret;\n",
  'secret inside string (JWT)':            "const code = 'const JWT_SECRET = \"s3cr3t\";\\nconst x = 1;';\nmodule.exports = code;\n",
  'secret inside array element':           "const lines = [\n  'const API_SECRET = \"sk_live_abc123xyz789def456ghi\";',\n];\nmodule.exports = lines;\n",
};
for (const [name, code] of Object.entries(DET_BROKEN)) {
  test(`pipeline: broken deterministic patch never reaches SAFE_AUTO_FIX — ${name}`, async () => {
    assert.ok(syntaxOk(code, 'fx.js'), 'precondition: original parses');
    const r = await pipeline(code, 'fx.js');
    assert.notStrictEqual(r.decision.decision, 'SAFE_AUTO_FIX');
    assert.ok(!r.decision.patch || syntaxOk(r.decision.patch, 'fx.js'));
    for (const s of r.phases.fallback.stages) {
      if (s.verifyResult && s.verifyResult.valid === false) assert.match(s.verifyResult.reason, /REJECTED_SYNTAX_BROKEN/);
    }
  });
}

// ملفات حقيقية أنتج لها السيرفر patch مكسورًا بـSAFE_AUTO_FIX قبل A5
const REAL = [
  'public/babel_analyzer.js', 'public/command_injection_fix.js',
  'test/analyzer.test.js', 'test/fallback_fixes.test.js', 'test/repair_advanced.test.js',
  'test/repair_pipeline.test.js', 'test/repair_sql_candidate.test.js', 'test/repair_stale_guard.test.js',
];
for (const rel of REAL) {
  test(`pipeline: real file ${rel} — any SAFE_AUTO_FIX patch must parse`, async () => {
    const file = path.basename(rel);
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(syntaxOk(code, file), 'precondition: original parses');
    const r = await pipeline(code, file);
    if (r.decision.decision === 'SAFE_AUTO_FIX') assert.ok(syntaxOk(r.decision.patch, file), 'broken patch reached SAFE_AUTO_FIX');
  });
}

// ═══ 5. المسار الكامل: إصلاحات سليمة تبقى SAFE_AUTO_FIX ═══
const DET_VALID = {
  'a.js':   'var x = 1;\nfetch("http://api.example.com/a");\n',
  's.py':   'import os\nimport subprocess\nurl = "http://api.example.com"\ndef f(x):\n    os.system("ls " + x)\n    if x == None:\n        pass\n',
  's.ts':   'var a: number = 1;\nfetch("http://api.example.com/a");\nif (a == 2) {}\n',
  's.mjs':  'import x from "y";\nvar a = 1;\nfetch("http://api.example.com/a");\n',
  'esm.js': 'import x from "y";\nvar a = 1;\nfetch("http://api.example.com/a");\nexport default a;\n',
  's.php':  '<?php\n$u = "http://api.example.com";\n$q = "SELECT * FROM t WHERE a=" . $_GET["a"];\nmysql_query($q);\n',
  'sql.js': 'function getUser(req, db) {\n  const id = req.query.id;\n  return db.query("SELECT * FROM users WHERE id = " + id);\n}\n',
  'cmd.js': 'const { exec } = require("child_process");\nfunction run(req) {\n  exec("ls " + req.query.dir);\n}\n',
  'route.js': 'app.get("/health", (req, res) => {\n  fetch("http://api.example.com/status");\n  res.json({ ok: true });\n});\n',
};
for (const [file, code] of Object.entries(DET_VALID)) {
  test(`pipeline: valid deterministic fix stays SAFE_AUTO_FIX — ${file}`, async () => {
    const r = await pipeline(code, file);
    assert.strictEqual(r.decision.decision, 'SAFE_AUTO_FIX', r.decision.reason);
    assert.notStrictEqual(r.decision.patch, code);
  });
}

// ═══ 6. Claude Repair Engine ════════════════════════════
const PY_ORIG = 'import sqlite3\n\ndef get_user(user_id):\n    query = "SELECT * FROM users WHERE id=" + user_id\n    cursor.execute(query)\n    return cursor.fetchall()';

test('Claude: valid candidate stays SAFE_AUTO_FIX', async () => {
  const fixed = 'import sqlite3\n\ndef get_user(user_id):\n    query = "SELECT * FROM users WHERE id=?"\n    cursor.execute(query, (user_id,))\n    return cursor.fetchall()';
  const r = await withClaude(fixed, opts => pipeline(PY_ORIG, 'test.py', opts));
  assert.strictEqual(r.decision.decision, 'SAFE_AUTO_FIX');
  assert.strictEqual(r.decision.patch, fixed);
  assert.strictEqual(r.phases.aiVerify.valid, true);
  assert.strictEqual(r.phases.aiVerify.improved, true);
});

test('Claude: syntactically broken candidate is rejected', async () => {
  const broken = 'import sqlite3\n\ndef get_user(user_id):\n    query = "SELECT * FROM users WHERE id=?"\n    cursor.execute(query, (user_id,)\n    return cursor.fetchall()';
  const r = await withClaude(broken, opts => pipeline(PY_ORIG, 'test.py', opts));
  assert.notStrictEqual(r.decision.decision, 'SAFE_AUTO_FIX');
  assert.notStrictEqual(r.decision.patch, broken);
  assert.strictEqual(r.phases.aiVerify.valid, false);
  assert.match(r.phases.aiVerify.reason, /^REJECTED_SYNTAX_BROKEN \[python\]/);
});

test('Claude: non-parameterized SQL candidate is not auto-applied', async () => {
  const bad = 'import sqlite3\n\ndef get_user(user_id):\n    query = "SELECT * FROM users WHERE id=" + str(int(user_id))\n    cursor.execute(query)\n    return cursor.fetchall()';
  const r = await withClaude(bad, opts => pipeline(PY_ORIG, 'test.py', opts));
  assert.notStrictEqual(r.decision.decision, 'SAFE_AUTO_FIX');
});
