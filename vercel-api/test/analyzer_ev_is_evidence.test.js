// ═══════════════════════════════════════════════════════
// دليلُ البلاغِ نصُّ سطرِه — لا وصفٌ عامّ
// تشغيل:  node --test vercel-api/test/analyzer_ev_is_evidence.test.js
//
// ‎NAMEERROR/py‎ كان يُكتشَف ويُوجَّه، ولا يصل المُصلِحَ، ولا يظهر في أيِّ
// قناة: لا ‎repairs‎ ولا ‎rejected‎ ولا ‎dropped‎ ولا ‎aiNeeded‎. والسببُ ليس
// في المُصلِح — ‎fixNameError‎ قائمٌ ويُنتج الإصلاحَ الصحيحَ متى نودي —
// بل في حقلٍ واحدٍ عند الكاشف:
//     ev: 'cursor.execute(query, ...)'
// وهو **وصفٌ** لا نصُّ السطر. وحارسُ ‎stale-line‎ في ‎repairCode‎ يشترط
// ‎currentLine.includes(ev)‎ ليتأكّد أنّ البلاغَ ما زال على موضعِه، فلا
// يتحقّق الشرطُ أبدًا على سطرٍ كـ‎return cur.execute(query)‎، فيُحكَم على
// البلاغِ بأنّه قديمٌ ويُترَك بصمت.
//
// والعلاجُ عند المصدر: الدليلُ صار نصَّ السطر. والحارسُ لم يُمَسّ —
// ‎[NE-4]‎ يُثبت أنّ البلاغَ القديمَ حقًّا ما زال يُترَك.
// ═══════════════════════════════════════════════════════
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const os = require('node:os'), { execFileSync } = require('node:child_process');
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

const NE = 'def f(cur):\n    # query = "SELECT 1"\n    return cur.execute(query)\n';
const RUNNABLE = [
  'import sqlite3',
  '',
  'def f(cur):',
  '    # query = "SELECT 1"',
  '    return cur.execute(query).fetchone()[0]',
  '',
  'con = sqlite3.connect(":memory:")',
  'print(f(con.cursor()))',
  '',
].join('\n');

const pyBin = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'pipe' }); return 'python3'; } catch (e) { return null; }
})();
function pyRun(src) {
  if (!pyBin) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
  const f = path.join(dir, 'm.py');
  fs.writeFileSync(f, src);
  let out;
  try { out = { ok: true, text: execFileSync(pyBin, ['-I', f], { stdio: 'pipe' }).toString().trim() }; }
  catch (e) { out = { ok: false, text: String((e && e.stderr) || '').trim().split('\n').pop() }; }
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

test('[NE-1] دليلُ البلاغِ موجودٌ في سطرِه', () => {
  const hits = (ctx.analyzeCode(NE, 'm.py') || []).filter(i => /NameError/.test(String(i.title)));
  assert.strictEqual(hits.length, 1, 'tripwire: لا بلاغ');
  const line = NE.split('\n')[hits[0].line - 1];
  assert.ok(String(hits[0].ev || '').trim(), 'بلا دليل');
  assert.ok(line.includes(String(hits[0].ev).trim()),
    'الدليلُ ليس من السطر: ev=' + JSON.stringify(hits[0].ev) + ' السطر=' + JSON.stringify(line));
});

test('[NE-2] والبلاغُ يصل المُصلِحَ ويُصلَح — لا يُترَك بصمت', () => {
  const issues = ctx.analyzeCode(NE, 'm.py') || [];
  const r = ctx.repairCode(NE, issues.map(x => Object.assign({}, x)), 'm.py');
  assert.ok((r.repairs || []).some(p => String(p.strategy) === 'NAMEERROR'),
    'لم يُسجَّل إصلاح — rejected=' + JSON.stringify((r.rejected || []).map(x => x.reason)) +
    ' dropped=' + JSON.stringify((r.dropped || []).map(x => x.kind)) +
    ' aiNeeded=' + JSON.stringify((r.aiNeeded || []).map(x => x.strategy)));
  assert.match(r.repaired, /^\s+query = "SELECT 1"$/m, 'لم يُرفَع التعليق:\n' + r.repaired);
  assert.strictEqual((ctx.analyzeCode(r.repaired, 'm.py') || [])
    .filter(i => /NameError/.test(String(i.title))).length, 0, 'بقي البلاغ');
});

test('[NE-3] والسلوك: كان ينكسر بـNameError وصار يعمل', () => {
  if (!pyBin) { assert.ok(true, 'لا python3 في البيئة'); return; }
  const before = pyRun(RUNNABLE);
  assert.strictEqual(before.ok, false, 'tripwire: العيّنةُ لا تنكسر');
  assert.match(before.text, /NameError/, 'tripwire: الكسرُ ليس NameError — ' + before.text);
  const r = ctx.repairCode(RUNNABLE, (ctx.analyzeCode(RUNNABLE, 'm.py') || []).map(x => Object.assign({}, x)), 'm.py');
  assert.notStrictEqual(r.repaired, RUNNABLE, 'لم يُصلَح شيء');
  const after = pyRun(r.repaired);
  assert.strictEqual(after.ok, true, 'ما زال ينكسر: ' + after.text + '\n' + r.repaired);
  assert.strictEqual(after.text, '1', 'نتيجةٌ غيرُ متوقَّعة: ' + after.text);
});

test('[NE-4] ولم يُضعَّف حارسُ stale: بلاغٌ قديمٌ حقًّا ما زال يُترَك', () => {
  // دليلٌ لا وجودَ له في السطر ⇒ البلاغُ من تحليلٍ سابقٍ لنصٍّ آخر.
  const stale = [{ line: 3, title: '🔴 NameError: query غير معرّف — أزل # من query',
                   ev: 'cur.execute(TOTALLY_OTHER_TEXT)', sev: 'c', conf: 95 }];
  const r = ctx.repairCode(NE, stale, 'm.py');
  assert.strictEqual(r.repaired, NE, 'طُبِّق بلاغٌ دليلُه لا يطابق السطر:\n' + r.repaired);
  assert.strictEqual((r.repairs || []).length, 0, 'سُجِّل إصلاحٌ لبلاغٍ قديم');
});

test('[NE-5] ولا كاشفَ آخرَ يكتب وصفًا مكانَ الدليل', () => {
  // حارسٌ دائم: الدليلُ إمّا نصٌّ من السطرِ وإمّا لا شيء.
  const CORPUS = [
    ['a.py', 'def f(cur):\n    # query = "SELECT 1"\n    return cur.execute(query)\n'],
    ['b.py', 'import hashlib\n\ndef f(pw):\n    return hashlib.md5(pw).hexdigest()\n'],
    ['c.py', 'def f(cur, name):\n    cur.execute("SELECT * FROM u WHERE n = \'" + name + "\'")\n'],
    ['d.py', 'import os\n\ndef f(d):\n    os.system("ls " + d)\n'],
    ['e.js', 'function f(db, name) {\n  return db.query("SELECT * FROM u WHERE n = \'" + name + "\'");\n}\nmodule.exports = { f };\n'],
    ['f.js', 'const crypto = require("crypto");\nfunction f(x) {\n  return crypto.createHash("md5").update(x).digest("hex");\n}\nmodule.exports = { f };\n'],
    ['g.js', 'function f(s) {\n  return eval(s);\n}\nmodule.exports = { f };\n'],
    ['h.js', 'function login(u) {\n  if (u.pass === "ZZfakePassword789") { return true; }\n  return false;\n}\nmodule.exports = { login };\n'],
    ['i.java', 'class A {\n  void f() throws Exception {\n    MessageDigest md = MessageDigest.getInstance("MD5");\n  }\n}\n'],
    ['j.php', '<?php\nfunction f($db, $name) {\n  return $db->query("SELECT * FROM u WHERE n = \'" . $name . "\'");\n}\n'],
    ['k.cs', 'class A {\n  void f() {\n    var md = MD5.Create();\n  }\n}\n'],
    ['l.ts', 'export function f(db: any, name: string) {\n  return db.query("SELECT * FROM u WHERE n = \'" + name + "\'");\n}\n'],
  ];
  const bad = [];
  for (const [fn, code] of CORPUS) {
    const lines = code.split('\n');
    for (const i of (ctx.analyzeCode(code, fn) || [])) {
      const ev = String(i.ev || '').trim();
      if (!ev) continue;
      if (String(lines[i.line - 1] || '').includes(ev)) continue;
      bad.push(fn + ':' + i.line + ' ' + String(i.title) + ' ← ev=' + JSON.stringify(ev));
    }
  }
  assert.deepStrictEqual(bad, [], 'دليلٌ ليس من سطرِه — الحارسُ يُترَك بصمتٍ عند هذه البلاغات');
});
