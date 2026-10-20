// ═══════════════════════════════════════════════════════
// استعلامٌ مُعامَلٌ يحمل قيمتَه — لا علامةٌ نائبةٌ بلا قيمة
// تشغيل:  node --test vercel-api/test/repair_sql_bind_value.test.js
//
// ‎SQL_PLACEHOLDERS_UNBOUND‎: كان ‎fixSQLInjection‎ في js/ts يستبدل الضمَّ
// بعلامةٍ نائبةٍ **ويحذف الوسيطَ نهائيًّا**:
//     db.query("… n = '" + name + "'")   ⇒   db.query("… n = ?")
// فالقيمةُ تضيع والاستعلامُ لا يعود يُطابق شيئًا. والبوابةُ كانت تردُّه
// بحقّ — فالعطبُ في المُصلِحِ لا فيها. ومقيسٌ أن المسارَ القديمَ لم يُنتج
// ولا إصلاحًا مقبولًا واحدًا على 78 ملفًا فيها بلاغُ SQL.
//
// و‎[SQL-BIND]‎ يبني الاستدعاءَ كاملًا: النصُّ بعلاماتٍ نائبة، والتعبيراتُ
// في مصفوفةِ القيمِ بترتيبها. وما لا يُحسَم يُرجِع ‎null‎ فيذهب إلى
// ‎aiNeeded‎ بدل رُقعةٍ تُفقد القيمة. ولم تُمَسّ البوابة.
// ═══════════════════════════════════════════════════════
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadUiContext() {
  const store = new Map(), noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => null, addEventListener: noop, createElement: () => ({}),
                querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null),
                    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة */ }
  }
  return ctx;
}
const ctx = loadUiContext();
const cycle = (code, fn) => {
  const issues = ctx.analyzeCode(code, fn) || [];
  const r = ctx.repairCode(code, issues.map(x => Object.assign({}, x)), fn);
  return { r, repaired: (r && typeof r.repaired === 'string') ? r.repaired : code };
};

const ONE  = 'function f(db, name) {\n  return db.query("SELECT * FROM u WHERE n = \'" + name + "\'");\n}\nmodule.exports = { f };\n';
const TWO  = 'function f(db, a, b) {\n  return db.query("SELECT * FROM u WHERE a = \'" + a + "\' AND b = \'" + b + "\'");\n}\nmodule.exports = { f };\n';
const BARE = 'function f(db, id) {\n  db.query("SELECT * FROM users WHERE id = " + id);\n}\nmodule.exports = { f };\n';
const TS   = 'export function f(db: any, name: string) {\n  return db.query("SELECT * FROM u WHERE n = \'" + name + "\'");\n}\n';

test('[SB-1] القيمةُ تُربَط، ولا تبقى علامةٌ نائبةٌ وحدَها', () => {
  const CASES = [
    ['a.js', ONE,  '  return db.query("SELECT * FROM u WHERE n = ?", [name]);'],
    ['b.js', TWO,  '  return db.query("SELECT * FROM u WHERE a = ? AND b = ?", [a, b]);'],
    ['c.js', BARE, '  db.query("SELECT * FROM users WHERE id = ?", [id]);'],
    ['d.ts', TS,   '  return db.query("SELECT * FROM u WHERE n = ?", [name]);'],
  ];
  for (const [fn, code, want] of CASES) {
    const { repaired } = cycle(code, fn);
    assert.strictEqual(repaired.split('\n')[1], want, fn);
  }
});

test('[SB-2] والاقتباسُ حول الموضعِ يُزال: ‎n = ?‎ لا ‎n = \'?\'‎', () => {
  for (const [fn, code] of [['a.js', ONE], ['b.js', TWO], ['d.ts', TS]]) {
    const { repaired } = cycle(code, fn);
    assert.doesNotMatch(repaired, /'\?'|= '\?/, fn + ': موضعٌ داخلَ اقتباس');
  }
});

test('[SB-3] والبوابةُ تقبل، ولا يبقى بلاغُ SQL', () => {
  for (const [fn, code] of [['a.js', ONE], ['b.js', TWO], ['c.js', BARE], ['d.ts', TS]]) {
    const { r, repaired } = cycle(code, fn);
    assert.ok((r.repairs || []).some(x => x.strategy === 'SQL_INJECTION'),
      fn + ': لم يُسجَّل إصلاح — ' + (((r.rejected || [])[0] || {}).reason || ''));
    const after = (ctx.analyzeCode(repaired, fn) || []).filter(i => /sql/i.test(String(i.title || '')));
    assert.strictEqual(after.length, 0, fn + ': بقي بلاغُ SQL');
    assert.notStrictEqual(ctx.FixVerifier.syntaxCheck(repaired, fn).ok, false, fn + ': الناتجُ مكسور');
  }
});

test('[SB-4] وما لا يُحسَم يُرجِع null — لا رُقعةً تُفقد القيمة', () => {
  const UNSURE = [
    ['e.js', 'function f(db, n) {\n  return db.query(`SELECT * FROM u WHERE n = ${n}`);\n}\nmodule.exports = { f };\n', /`SELECT/],
    ['f.js', 'function f(db, a) {\n  const sql = "SELECT * FROM t WHERE a = " + a;\n  return db.query(sql);\n}\nmodule.exports = { f };\n', /"SELECT \* FROM t WHERE a = " \+ a/],
    ['g.js', 'function f(db, n) {\n  return db.query("SELECT * FROM u WHERE n = ?", [n]);\n}\nmodule.exports = { f };\n', /\[n\]/],
  ];
  for (const [fn, code, keep] of UNSURE) {
    const { repaired } = cycle(code, fn);
    assert.match(repaired, keep, fn + ': مُسَّ شكلٌ غيرُ محسوم');
    assert.doesNotMatch(repaired, /use: db\.query/, fn + ': عاد التعليقُ النائب');
  }
});

test('[SB-5] ونداءٌ ليس استعلامًا لا يُمَسّ', () => {
  const code = 'function f(t, n) {\n  return t.send("SELECT * FROM u WHERE n = \'" + n + "\'");\n}\nmodule.exports = { f };\n';
  const { repaired } = cycle(code, 'h.js');
  assert.match(repaired, /t\.send\("SELECT \* FROM u WHERE n = '" \+ n \+ "'"\)/, 'مُسَّ نداءٌ غيرُ استعلام');
});

// ═══ المعنى: القيمةُ تصل إلى المُشغِّل، ولا تضيع ═══

test('[SB-6] تنفيذٌ حقيقيّ: المُشغِّلُ يتلقّى النصَّ والقيمةَ معًا', () => {
  const { execFileSync } = require('node:child_process');
  const { repaired } = cycle(ONE, 'r.js');
  // مُشغِّلٌ وهميٌّ يسجّل ما وصله، ويبني الاستعلامَ الفعليَّ بالقيم.
  const harness =
    'const m = {exports:{}};(function(module, exports){' + repaired + '})(m, m.exports);' +
    'let seen = null;' +
    'const db = { query(sql, params) { seen = { sql, params: params || [] }; return seen; } };' +
    'm.exports.f(db, "ali");' +
    'const bound = seen.sql.replace(/\\?/g, () => JSON.stringify(seen.params.shift()));' +
    'console.log(JSON.stringify({ sql: seen.sql, n: bound }));';
  let out;
  try { out = JSON.parse(execFileSync(process.execPath, ['-e', harness], { encoding: 'utf8', timeout: 10000 })); }
  catch (e) { assert.fail('الناتجُ لا يعمل: ' + e.message + '\n' + repaired); }
  assert.match(out.sql, /\?/, 'لا علامةَ نائبة');
  // والقيمةُ وصلت: الاستعلامُ المبنيُّ يحمل "ali"
  assert.match(out.n, /"ali"/, 'القيمةُ لم تصل إلى المُشغِّل — ' + JSON.stringify(out));
});

test('[SB-7] وبقيّةُ إصلاحاتِ الملفِ لا تسقط مع مُرشَّحِ SQL غيرِ المحسوم', () => {
  // شكلُ «إسنادٌ ثم نداء» يُرجِع null الآن. والمطلوبُ ألّا يُسقط ذلك
  // إصلاحاتٍ أخرى صالحةً في الملفِّ نفسِه.
  const code = [
    'function f(db, a, flag) {',
    '  var n = 1;',
    '  if (flag == 1) { n = 2; }',
    '  const sql = "SELECT * FROM t WHERE a = " + a;',
    '  return db.query(sql) && n;',
    '}',
    'module.exports = { f };',
    '',
  ].join('\n');
  const { repaired } = cycle(code, 'i.js');
  assert.doesNotMatch(repaired, /\bvar\s/, 'var لم يُصلَح');
  assert.match(repaired, /flag === 1/, '== لم يُصلَح');
  assert.notStrictEqual(ctx.FixVerifier.syntaxCheck(repaired, 'i.js').ok, false, 'الناتجُ مكسور');
});
