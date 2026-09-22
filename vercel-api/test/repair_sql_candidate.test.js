// ═══════════════════════════════════════════════════════
// اختبارات رفض candidate SQL غير السليم في repair_engine.js
// تشغيل:  node --test vercel-api/test/repair_sql_candidate.test.js
//
// candidate لـSQL_INJECTION يبقي الثغرة أو ينتج استعلامًا غير صالح يجب
// ألا يُعتمد أبدًا — حتى لو جاء مع إصلاحات أخرى صحيحة في نفس الملف.
// لتشغيل حالة GameServer على الملف الحقيقي بدون إضافته للمستودع:
//   CLAUDE_REPAIR_FIXTURE=/path/to/GameServer.js node --test ...
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// نفس المحركات التي تحمّلها الواجهة (index.html) — analyzeCode و SQLInjectionFixer حقيقيان
function loadUiContext() {
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => null, addEventListener: noop, createElement: () => ({}), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: noop }, navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة فقط */ }
  }
  return ctx;
}

const ctx = loadUiContext();
const check = (before, after, file) =>
  ctx.sqlCandidateProblem(before, after, file, String(file).split('.').pop().toLowerCase());
const sqlCount = (code, file) => ctx.analyzeCode(code, file)
  .filter(i => /sql injection|sql_injection|cwe-89/i.test([i.type, i.title, i.cAct].join(' '))).length;

// ═══ 1. sqlCandidateProblem — الرفض ═════════════════════
const GS_BEFORE = [
  'function loginPlayer(username, password) {',
  '    var query = "SELECT * FROM players WHERE username=\'" + username + "\' AND password=\'" + password + "\'";',
  '    db.execute(query);',
  '}',
].join('\n');

test('SQL candidate: GameServer bad fix (placeholder inside quotes + unbound + TODO comment) → rejected', () => {
  const after = GS_BEFORE.replace(/var query = .*;/,
    'var query = "SELECT * FROM players WHERE username=? AND password=\'?" + "\'"; // use: db.query(sql, [param])');
  assert.match(check(GS_BEFORE, after, 'g.js'), /^SQL_PLACEHOLDER_QUOTED/);
});

test('SQL candidate: placeholders with no bound values → rejected', () => {
  const before = 'db.query("SELECT * FROM users WHERE id = " + id);';
  assert.match(check(before, 'db.query("SELECT * FROM users WHERE id = ?"); // use: db.query(sql, [param])', 'a.js'),
    /^SQL_PLACEHOLDERS_UNBOUND/);
  const assignBefore = 'const sql = "SELECT * FROM t WHERE a = " + a;\nconn.query(sql, function (e, r) {});';
  assert.match(check(assignBefore, 'const sql = "SELECT * FROM t WHERE a = ?";\nconn.query(sql, function (e, r) {});', 'a.js'),
    /^SQL_PLACEHOLDERS_UNBOUND — line 1 has 1 placeholder\(s\) but 0 bound value\(s\)/);
});

test('SQL candidate: placeholder count different from bound values → rejected', () => {
  const before = 'db.query("SELECT * FROM t WHERE a = " + a + " AND b = " + b);';
  assert.match(check(before, 'db.query("SELECT * FROM t WHERE a = ? AND b = ?", [a]);', 'a.js'),
    /2 placeholder\(s\) but 1 bound value\(s\)/);
  assert.match(check(before, 'db.query("SELECT * FROM t WHERE a = ? AND b = ?", [/* add params */]);', 'a.js'),
    /2 placeholder\(s\) but 0 bound value\(s\)/);
});

test('SQL candidate: still concatenating / interpolating a variable → rejected', () => {
  const before = 'db.query("SELECT * FROM t WHERE a = " + a + " AND b = " + b);';
  assert.match(check(before, 'db.query("SELECT * FROM t WHERE a = ? AND b = " + b, [a]);', 'a.js'), /^SQL_STILL_CONCATENATED/);
  assert.match(check(before, 'db.query(`SELECT * FROM t WHERE a = ? AND b = ${b}`, [a]);', 'a.js'), /^SQL_STILL_CONCATENATED/);
  const py = 'cur.execute("SELECT * FROM t WHERE id = " + uid)';
  assert.match(check(py, 'cur.execute(f"SELECT * FROM t WHERE id = {uid}")', 'a.py'), /^SQL_STILL_CONCATENATED/);
  const php = '$r = $pdo->query("SELECT * FROM t WHERE id = " . $id);';
  assert.match(check(php, '$r = $pdo->query("SELECT * FROM t WHERE id = $id");', 'a.php'), /^SQL_STILL_CONCATENATED/);
});

test('SQL candidate: unbalanced SQL quotes → rejected (invalid query)', () => {
  const before = 'db.query("SELECT * FROM t WHERE a = \'" + a + "\'", [x]);';
  assert.match(check(before, 'db.query("SELECT * FROM t WHERE a = \' AND b = 1", []);', 'a.js'), /^SQL_UNBALANCED_QUOTES/);
});

test('SQL candidate: a change that does not touch any SQL statement → rejected', () => {
  const before = 'const x = 1;\ndb.query("SELECT * FROM t WHERE id = " + id);';
  assert.match(check(before, 'const x = 2;\ndb.query("SELECT * FROM t WHERE id = " + id);', 'a.js'), /^SQL_NOT_ADDRESSED/);
});

test('SQL candidate: structurally valid but the analyzer still reports SQL injection → rejected', () => {
  const stub = loadUiContext();
  stub.analyzeCode = () => [{ title: 'SQL Injection (CWE-89)' }];
  const before = 'db.query("SELECT * FROM t WHERE id = " + id);';
  const r = stub.sqlCandidateProblem(before, 'db.query("SELECT * FROM t WHERE id = ?", [id]);', 'a.js', 'js');
  assert.match(r, /^SQL_INJECTION_STILL_REPORTED/);
});

// ═══ 2. sqlCandidateProblem — القبول (إصلاحات صحيحة لا تُكسر) ═
test('SQL candidate: correctly parameterized candidates are accepted', () => {
  const ok = [
    ['a.js', 'db.query("SELECT * FROM users WHERE id = " + id);', 'db.query("SELECT * FROM users WHERE id = ?", [id]);'],
    ['a.js', 'const sql = "SELECT * FROM t WHERE a = \'" + a + "\'";\nconn.query(sql, function (e, r) {});',
             'const sql = "SELECT * FROM t WHERE a = ?";\nconn.query(sql, [a], function (e, r) {});'],
    ['a.ts', 'const r = await pool.query(`SELECT * FROM u WHERE e = ${email} AND o = ${org}`);',
             'const r = await pool.query("SELECT * FROM u WHERE e = $1 AND o = $2", [email, org]);'],
    ['a.py', 'cur.execute("SELECT * FROM t WHERE id = " + uid)', 'cur.execute("SELECT * FROM t WHERE id = ?", (uid,))'],
  ];
  for (const [file, before, after] of ok) {
    assert.equal(check(before, after, file), null, `${file}: ${after}`);
    assert.ok(sqlCount(after, file) < sqlCount(before, file), `analyzer no longer reports: ${after}`);
  }
});

test('SQL candidate: literal + literal with bound values passes the structure checks, but the analyzer still flags it → rejected (conservative)', () => {
  const before = 'db.query("SELECT * FROM t WHERE a = " + a + " AND b = " + b);';
  const after  = 'db.query("SELECT * FROM t WHERE a = ?" + " AND b = ?", [a, b]);';
  const noAnalyzer = loadUiContext();
  noAnalyzer.analyzeCode = c => (c === before ? [{ title: 'SQL Injection (CWE-89)' }] : []);
  assert.equal(noAnalyzer.sqlCandidateProblem(before, after, 'a.js', 'js'), null, 'structure: literal + literal is not a variable');
  assert.match(check(before, after, 'a.js'), /^SQL_INJECTION_STILL_REPORTED/);
});

// ═══ 3. repairCode — الـcandidate المرفوض لا يُطبَّق، والباقي يُطبَّق ═
const MIXED = [
  'const API_SECRET = "sk_live_abc123xyz789def456ghi";',
  '',
  GS_BEFORE,
  '',
  'function check(username) {',
  '    if (username == "admin") { return true; }',
  '    return false;',
  '}',
  '',
].join('\n');

test('repairCode: GameServer-style SQL candidate is rejected; the other fixes are still applied', () => {
  const r = ctx.repairCode(MIXED, ctx.analyzeCode(MIXED, 'g.js'), 'g.js');
  const out = r.repaired.split('\n');
  const sqlLine = out.find(l => l.includes('SELECT'));
  assert.ok(sqlLine.includes('"SELECT * FROM players WHERE username=\'" + username + "\' AND password=\'" + password + "\'"'),
    'SQL string left exactly as the original: ' + sqlLine);
  assert.ok(!/'\?|\/\/ use: db\.query/.test(r.repaired), 'no broken placeholder or TODO comment');
  assert.ok(!r.repairs.some(x => x.strategy === 'SQL_INJECTION'), 'no SQL repair is reported as done');
  assert.ok(r.rejected.some(x => x.strategy === 'SQL_INJECTION' && /^SQL_PLACEHOLDER_QUOTED/.test(x.reason)));
  assert.ok(r.repairs.some(x => x.strategy === 'LOOSE_EQUALITY'), 'unrelated fixes still applied');
  assert.ok(r.repaired.includes('if (username === "admin")'));
  assert.equal(sqlCount(r.repaired, 'g.js'), sqlCount(MIXED, 'g.js'), 'SQL injection is still reported — not hidden');
});

test('repairCode: when the first SQL candidate is bad, a valid legacy candidate is still used', () => {
  const code = 'function f(db, id) {\n  db.query("SELECT * FROM users WHERE id = " + id);\n}\n';
  const r = ctx.repairCode(code, ctx.analyzeCode(code, 'a.js'), 'a.js');
  assert.equal(r.repaired.split('\n')[1], '  db.query("SELECT * FROM users WHERE id = ?", [id]);');
  assert.equal(sqlCount(r.repaired, 'a.js'), 0);
  assert.ok(r.repairs.some(x => x.strategy === 'SQL_INJECTION'));
  assert.match(r.rejected[0].reason, /^SQL_PLACEHOLDERS_UNBOUND/);
});

test('repairCode + FixVerifier: the approved file never contains the broken SQL', () => {
  const r = ctx.repairCode(MIXED, ctx.analyzeCode(MIXED, 'g.js'), 'g.js');
  const v = ctx.FixVerifier.verifyFix(MIXED, r.repaired, 'g.js', ctx.analyzeCode, {});
  assert.equal(v.accepted, true, v.reason);
  assert.ok(!/'\?|\/\/ use: db\.query/.test(r.repaired));
});

// ═══ 4. GameServer.js الحقيقي (اختياري، خارج المستودع) ════
if (process.env.CLAUDE_REPAIR_FIXTURE) {
  const GS = fs.readFileSync(process.env.CLAUDE_REPAIR_FIXTURE, 'utf8');
  test('GameServer.js fixture: SQL candidate rejected, line 12 keeps the original SQL string, file still approved', () => {
    const r = ctx.repairCode(GS, ctx.analyzeCode(GS, 'GameServer.js'), 'GameServer.js');
    const orig = GS.split('\n')[11], out = r.repaired.split('\n')[11];
    const sqlPart = s => s.slice(s.indexOf('"SELECT'));
    assert.equal(sqlPart(out), sqlPart(orig));
    assert.ok(!/'\?|\/\/ use: db\.query/.test(r.repaired));
    assert.ok(r.rejected.some(x => x.strategy === 'SQL_INJECTION'));
    const v = ctx.FixVerifier.verifyFix(GS, r.repaired, 'GameServer.js', ctx.analyzeCode, {});
    assert.equal(v.accepted, true, v.reason);
  });
}
