// ═══════════════════════════════════════════════════════
// لا بلاغَ يخرج من حلقةِ الإصلاحِ بلا أثر
// تشغيل:  node --test vercel-api/test/repair_no_silent_exit.test.js
//
// ‎[REFUSAL-VISIBLE]‎ أغلق بابًا واحدًا: المُصلِحُ يُنادى فيمتنع. وبقيت
// خمسةُ ‎return‎ قبلَ النداءِ تُخرج البلاغَ بلا أثرٍ في أيِّ قناة — لا
// ‎repairs‎ ولا ‎rejected‎ ولا ‎dropped‎ ولا ‎aiNeeded‎ — فيُعَدُّ في ‎total‎
// ثمّ يختفي:
//   • لا استراتيجيّةَ للبلاغِ في هذه اللغة          (‎!strat‎)
//   • سطرُه أُصلح في هذه الدورةِ من المجموعةِ نفسِها
//   • دليلُ AST لا يُطابق شكلَ السطر
//   • دليلُه ليس في سطرِه ولا تعديلَ سابق           (‎stale‎)
//   • أزاح إصلاحٌ سابقٌ الأسطرَ فلم يُعثَر على الدليل
// وخلف الرابعِ ضاع ‎NAMEERROR/py‎ كاملًا حتى ‎[EV-IS-EVIDENCE]‎.
//
// و‎[EXIT-VISIBLE]‎ يسجّل الخمسةَ بأنواعِها في ‎dropped‎. والتسجيلُ كاملٌ،
// والإعلانُ انتقائيّ: ‎aiNeeded‎ قناةُ «هنا عملٌ ينتظر»، فيدخلها امتناعُ
// المُصلِحِ وضياعُ الموضعِ و‎NO_STRATEGY‎ الحرجُ والعالي. ولا يدخلها سطرٌ
// أُصلح، ولا تلميحٌ متوسِّطٌ أو إرشاديٌّ لا إصلاحَ حتميًّا له — مقيسٌ أنّ
// إدخالَها يرفع القناةَ من 33 إلى 117 بندًا على عيّناتِ المصفوفة، فيضيع
// الحرجُ بين التلميحات. وهي مسجّلةٌ في ‎dropped‎ على كلِّ حال.
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

// كوربوسٌ يغطّي اللغاتِ الستَّ وأصنافَ البلاغاتِ الشائعة
const CORPUS = [
  ['a.js', 'function f(db, name) {\n  return db.query("SELECT * FROM u WHERE n = \'" + name + "\'");\n}\nmodule.exports = { f };\n'],
  ['b.js', 'function f(s) {\n  return eval(s);\n}\nmodule.exports = { f };\n'],
  ['c.js', 'function f(db, req) {\n  return db.users.find({ $where: "this.n == \'" + req.query.q + "\'" });\n}\nmodule.exports = { f };\n'],
  ['d.js', 'const crypto = require("crypto");\nfunction f(x) {\n  return crypto.createHash("md5").update(x).digest("hex");\n}\nmodule.exports = { f };\n'],
  ['e.js', 'function login(u) {\n  if (u.pass === "ZZfakePassword789") { return true; }\n  return false;\n}\nmodule.exports = { login };\n'],
  ['f.ts', 'export function f(db: any, name: string) {\n  return db.query("SELECT * FROM u WHERE n = \'" + name + "\'");\n}\n'],
  ['g.py', 'def f(cur, name):\n    cur.execute("SELECT * FROM u WHERE n = \'" + name + "\'")\n'],
  ['h.py', 'import os\n\ndef f(d):\n    os.system("ls " + d)\n'],
  ['i.py', 'def f(cur):\n    # query = "SELECT 1"\n    return cur.execute(query)\n'],
  ['j.php', '<?php\nfunction f($db, $name) {\n  return $db->query("SELECT * FROM u WHERE n = \'" . $name . "\'");\n}\n'],
  ['k.java', 'class A {\n  void f() {\n    try {\n      g();\n    } catch (Exception e) {}\n  }\n}\n'],
  ['l.cs', 'class A {\n  void f() {\n    var md = MD5.Create();\n  }\n}\n'],
];
const run = (code, fn) => {
  const issues = ctx.analyzeCode(code, fn) || [];
  return { issues, r: ctx.repairCode(code, issues.map(x => Object.assign({}, x)), fn) };
};
const KNOWN = new Set(['FIXER_NO_CHANGE', 'FIXER_THREW', 'NO_STRATEGY',
                       'LINE_ALREADY_REPAIRED', 'STALE_EVIDENCE', 'LINE_NOT_FOUND']);

test('[EX-1] كلُّ بلاغٍ له أثرٌ في قناةٍ واحدةٍ على الأقلّ', () => {
  const lost = [];
  for (const [fn, code] of CORPUS) {
    const { issues, r } = run(code, fn);
    for (const i of issues) {
      const seen =
        (r.repairs  || []).some(x => x.line === i.line) ||
        (r.rejected || []).some(x => x.line === i.line) ||
        (r.aiNeeded || []).some(x => x.line === i.line && x.title === i.title) ||
        (r.dropped  || []).some(x => x.line === i.line && x.title === i.title);
      if (!seen) lost.push(fn + ':' + i.line + ' ' + String(i.title));
    }
  }
  assert.deepStrictEqual(lost, [], 'بلاغاتٌ خرجت بلا أثر');
});

test('[EX-2] ولكلِّ أثرٍ نوعٌ مُسمًّى وسببٌ مقروء', () => {
  for (const [fn, code] of CORPUS) {
    const { r } = run(code, fn);
    for (const d of r.dropped || []) {
      assert.ok(KNOWN.has(String(d.kind)), fn + ': نوعٌ مجهول — ' + d.kind);
      assert.ok(String(d.reason || '').length >= 20, fn + ': سببٌ أجوف — ' + d.kind);
      assert.ok('title' in d && 'line' in d, fn + ': سجلٌّ بلا موضع');
    }
  }
});

test('[EX-3] والبلاغُ الحرجُ بلا بابِ إصلاحٍ يُعلَن', () => {
  const { r } = run(CORPUS[2][1], CORPUS[2][0]);      // NoSQL $where — 🔴 بلا استراتيجيّة
  const d = (r.dropped || []).find(x => /NoSQL/.test(String(x.title)));
  assert.ok(d, 'لم يُسجَّل');
  assert.strictEqual(d.kind, 'NO_STRATEGY');
  assert.strictEqual(d.sev, 'c', 'الشدّةُ غيرُ محمولة — فالقرارُ لا يستطيع التمييز');
  assert.ok((r.aiNeeded || []).some(a => /NoSQL/.test(String(a.title))),
    'ثغرةٌ حرجةٌ بلا بابِ إصلاحٍ لم تُعلَن: ' + JSON.stringify((r.aiNeeded || []).map(a => a.title)));
});

test('[EX-4] والتلميحُ الإرشاديُّ يُسجَّل ولا يُعلَن — القناةُ تبقى ذاتَ معنى', () => {
  const { r } = run(CORPUS[2][1], CORPUS[2][0]);
  const hint = (r.dropped || []).find(x => /Call Graph/.test(String(x.title)));
  assert.ok(hint, 'التلميحُ غيرُ مسجَّلٍ أصلًا — عاد الصمت');
  assert.strictEqual(hint.kind, 'NO_STRATEGY');
  assert.ok(!(r.aiNeeded || []).some(a => /Call Graph/.test(String(a.title))),
    'أُعلن تلميحٌ إرشاديٌّ لا إصلاحَ له');
  // وعلى الكوربوسِ كلِّه: المُعلَنُ أقلُّ من المُسجَّل
  let ann = 0, rec = 0;
  for (const [fn, code] of CORPUS) {
    const { r: rr } = run(code, fn);
    ann += (rr.aiNeeded || []).length; rec += (rr.dropped || []).length;
  }
  assert.ok(ann < rec, 'الإعلانُ ليس انتقائيًّا: أُعلن ' + ann + ' من ' + rec);
});

test('[EX-5] وسطرٌ أُصلح يُسجَّل ولا يُعلَن — عقدُ security_no_drop', () => {
  for (const [fn, code] of CORPUS) {
    const { r } = run(code, fn);
    for (const d of (r.dropped || []).filter(x => x.kind === 'LINE_ALREADY_REPAIRED')) {
      assert.ok(!(r.aiNeeded || []).some(a => a.line === d.line && String(a.strategy) === String(d.strategy)),
        fn + ': أُعلن سطرٌ أُصلح — ' + d.title);
    }
    for (const p of r.repairs || []) {
      assert.ok(!(r.aiNeeded || []).some(a => a.line === p.line && String(a.strategy) === String(p.strategy)),
        fn + ': صنفٌ أُصلح ظهر في aiNeeded — ' + p.strategy + '@' + p.line);
    }
  }
});

test('[EX-6] ولم يتغيّر قرار: الإصلاحاتُ والعدُّ كما هي', () => {
  // التسجيلُ لا يُصلح ولا يرفض. ‎score‎ يبقى ‎repairs/total‎، والكودُ كما يُنتجه المُصلِحون.
  const EXPECT = [
    ['a.js', /\?", \[name\]/, 1],                       // SQL/js ما زال يُصلَح
    ['h.py', /subprocess|shlex|execFile|\[/, 1],        // CMD/py ما زال يُصلَح
    ['i.py', /^\s+query = "SELECT 1"$/m, 1],            // NameError ما زال يُصلَح
    ['k.java', /e\.getMessage\(\)/, 1],                 // catch فارغ ما زال يُصلَح
  ];
  for (const [fn, rx, min] of EXPECT) {
    const code = CORPUS.find(c => c[0] === fn)[1];
    const { r } = run(code, fn);
    assert.ok((r.repairs || []).length >= min, fn + ': تراجع الإصلاح — ' +
      JSON.stringify((r.rejected || []).map(x => x.reason)));
    assert.match(r.repaired, rx, fn + ': الناتجُ تغيّر\n' + r.repaired);
    assert.strictEqual(r.summary.score,
      Math.round(((r.repairs || []).length / Math.max(r.summary.total, 1)) * 100),
      fn + ': صيغةُ score تغيّرت');
    assert.strictEqual(r.summary.needsAI, (r.aiNeeded || []).length, fn + ': العدُّ لا يطابق');
  }
});
