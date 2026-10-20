// ═══════════════════════════════════════════════════════
// أمرُ C# مُعامَلٌ باسمِ كائنِه الحقيقيّ — لا كائنٍ مُخترَع
// تشغيل:  node --test vercel-api/test/repair_cs_sql_bind.test.js
//
// ‎SQL_INJECTION_STILL_REPORTED‎ في C# كان من المُصلِحِ لا البوابة. ناتجُه:
//     var q = "SELECT * FROM u WHERE n = '@param" + "'";
//     cmd.Parameters.AddWithValue("@param", name);
// وفيه ثلاثةُ عيوبٍ مجتمعة:
//   1. الموضعُ داخلَ اقتباسِ SQL — ‎'@param'‎ نصٌّ لا معامِل.
//   2. بقيّةُ الضمِّ ‎+ "'"‎ باقية.
//   3. ‎cmd‎ **متغيّرٌ غيرُ موجودٍ في النطاق** — الملفُّ لا يُترجَم.
// فالمحلّلُ يظلّ يرى الحقنَ وتردُّه البوابةُ بحقّ.
//
// و‎[CS-BIND]‎ لا يخترع كائنًا: لا يعمل إلا حيث يكون الكائنُ مُسمًّى في
// السطرِ نفسِه — ‎var cmd = new SqlCommand(…)‎ أو ‎cmd.CommandText = …‎ —
// وما عداه ‎null‎ فيذهب البلاغُ إلى ‎aiNeeded‎.
//
// ومعه ‎[CS-NEWCMD]‎ في البوابة: إثباتُ المُعامَلةِ كان يطلب حرفيًّا
// ‎CommandText=‎ أو ‎query=‎ أو ‎command=‎، ونصُّ الأمرِ في الشكلِ الأشيعِ
// وسيطٌ أوّلُ لمُنشئ. فأُضيفت صيغةُ الإثباتِ هذه، والاشتراطُ الحاملُ —
// ربطٌ فعليٌّ عبر ‎Parameters.Add‎ — كما هو.
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
const Q = '"';
const cycle = (code, fn) => {
  const issues = ctx.analyzeCode(code, fn) || [];
  const r = ctx.repairCode(code, issues.map(x => Object.assign({}, x)), fn);
  return { issues, r, repaired: (r && typeof r.repaired === 'string') ? r.repaired : code };
};

const NEWCMD = 'class A {\n  void f(SqlConnection conn, string name) {\n    var cmd = new SqlCommand(' +
  Q + "SELECT * FROM u WHERE n = '" + Q + ' + name + ' + Q + "'" + Q + ', conn);\n  }\n}\n';
const CMDTEXT = 'class A {\n  void f(SqlCommand cmd, string name) {\n    cmd.CommandText = ' +
  Q + "SELECT * FROM u WHERE n = '" + Q + ' + name + ' + Q + "'" + Q + ';\n  }\n}\n';
const TWO = 'class A {\n  void f(SqlConnection conn, string a, string b) {\n    var cmd = new SqlCommand(' +
  Q + "SELECT * FROM u WHERE a = '" + Q + ' + a + ' + Q + "' AND b = '" + Q + ' + b + ' + Q + "'" + Q + ', conn);\n  }\n}\n';
const NOCMD = 'class A {\n  void f(string name) {\n    var q = ' +
  Q + "SELECT * FROM u WHERE n = '" + Q + ' + name + ' + Q + "'" + Q + ';\n  }\n}\n';

test('[CS-1] نصُّ الأمرِ يُعامَل والقيمةُ تُربَط باسمِ الكائنِ الحقيقيّ', () => {
  for (const [label, code, cmdName] of [['new', NEWCMD, 'cmd'], ['CommandText', CMDTEXT, 'cmd']]) {
    const { repaired } = cycle(code, 'A.cs');
    assert.match(repaired, /@p0/, label + ': لا موضعَ مُعامَل');
    assert.match(repaired, new RegExp(cmdName + '\\.Parameters\\.AddWithValue\\("@p0", name\\);'),
      label + ': القيمةُ لم تُربَط — ' + repaired);
  }
});

test('[CS-2] ولا يُخترَع كائنٌ غيرُ موجودٍ في النطاق', () => {
  // العيبُ الأصليّ: ‎cmd‎ مكتوبةٌ حرفيًّا ولو لم تكن في الدالّة.
  const { repaired, r } = cycle(NOCMD, 'A.cs');
  assert.strictEqual(repaired, NOCMD, 'كُتب تعديلٌ بلا كائنِ أمر');
  assert.strictEqual((r.repairs || []).length, 0);
  // وكلُّ اسمٍ يُشار إليه في الناتجِ معرَّفٌ في الدالّة
  for (const [, code] of [['a', NEWCMD], ['b', CMDTEXT], ['c', TWO]]) {
    const out = cycle(code, 'A.cs').repaired;
    for (const m of out.matchAll(/^\s*([A-Za-z_]\w*)\.Parameters\./gm)) {
      assert.match(out, new RegExp('\\b' + m[1] + '\\b[^\\n]*(?:=\\s*new|\\)\\s*\\{|,\\s*string|SqlCommand\\s+' + m[1] + ')'),
        'كائنٌ غيرُ معرَّف: ' + m[1] + '\n' + out);
    }
  }
});

test('[CS-3] والمواضعُ المتعدّدةُ تُرقَّم وتُربَط بترتيبها', () => {
  const { repaired } = cycle(TWO, 'A.cs');
  assert.match(repaired, /a = @p0 AND b = @p1/, 'ترقيمٌ خاطئ: ' + repaired);
  assert.match(repaired, /AddWithValue\("@p0", a\);/);
  assert.match(repaired, /AddWithValue\("@p1", b\);/);
});

test('[CS-4] ولا يبقى الموضعُ داخلَ اقتباسِ SQL ولا بقيّةُ ضمّ', () => {
  for (const code of [NEWCMD, CMDTEXT, TWO]) {
    const { repaired } = cycle(code, 'A.cs');
    assert.doesNotMatch(repaired, /'@p\d/, 'موضعٌ داخلَ اقتباس: ' + repaired);
    assert.doesNotMatch(repaired, /@p\d[^"]*"\s*\+/, 'بقيّةُ ضمّ: ' + repaired);
  }
});

test('[CS-5] والبوابةُ تقبل، ولا يبقى بلاغُ SQL بعد إعادةِ التحليل', () => {
  for (const [label, code] of [['new', NEWCMD], ['CommandText', CMDTEXT], ['two', TWO]]) {
    const { r, repaired } = cycle(code, 'A.cs');
    assert.ok((r.repairs || []).some(x => x.strategy === 'SQL_INJECTION'),
      label + ': لم يُسجَّل إصلاح — ' + (((r.rejected || [])[0] || {}).reason || ''));
    const after = (ctx.analyzeCode(repaired, 'A.cs') || []).filter(i => /sql/i.test(String(i.title || '')));
    assert.strictEqual(after.length, 0, label + ': بقي بلاغُ SQL');
    assert.notStrictEqual(ctx.FixVerifier.syntaxCheck(repaired, 'A.cs').ok, false,
      label + ': الناتجُ مكسورٌ بنيويًّا');
  }
});

test('[CS-6] والإثباتُ ما زال يشترط ربطًا فعليًّا', () => {
  const FV = ctx.FixVerifier;
  const proven = FV.sqlCandidateLooksParameterized;
  if (typeof proven !== 'function') { assert.ok(true, 'غيرُ مُصدَّرة — يكفي [CS-5]'); return; }
  // نصٌّ مُعامَلٌ بلا ربط: لا إثبات
  assert.strictEqual(
    proven(NEWCMD, 'class A { void f(SqlConnection conn, string name) { var cmd = new SqlCommand("SELECT * FROM u WHERE n = @p0", conn); } }', 'A.cs'),
    false, 'قُبل نصٌّ مُعامَلٌ بلا Parameters.Add');
  // والموضعُ داخلَ اقتباسٍ يليه ضمّ: لا إثبات ولو وُجد الربط
  assert.strictEqual(
    proven(NEWCMD, 'class A { var cmd = new SqlCommand("… \'@p0" + "\'", conn); cmd.Parameters.AddWithValue("@p0", n); }', 'A.cs'),
    false, 'قُبل موضعٌ داخلَ اقتباس');
});

test('[CS-7] ولغاتُ SQL الأخرى لم تتغيّر', () => {
  const JS = 'function f(db, name) {\n  return db.query("SELECT * FROM u WHERE n = \'" + name + "\'");\n}\nmodule.exports = { f };\n';
  assert.match(cycle(JS, 'a.js').repaired, /\?", \[name\]/, 'تراجع إصلاحُ js');
  const PHP = '<?php\nfunction f($db, $name) {\n  $sql = "SELECT * FROM u WHERE n = " . $name;\n  return $db->query($sql);\n}\n';
  assert.notStrictEqual(ctx.FixVerifier.syntaxCheck(cycle(PHP, 'a.php').repaired, 'a.php').ok, false);
});
