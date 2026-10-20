// ═══════════════════════════════════════════════════════
// امتناعُ المُصلِحِ يُعلَن، لا يُبتلَع
// تشغيل:  node --test vercel-api/test/repair_refusal_visible.test.js
//
// ‎[SILENT-DROP]‎ سجّل الفجوةَ في حقلٍ جانبيٍّ للتشخيص عمدًا ولم يمسَّ
// المخرَجات، فبقي البابُ إلى ‎aiNeeded‎ معلَّقًا على شرطٍ واحد:
//     if (issue.aiRequired === true) aiNeeded.push(…)
// و‎aiRequired‎ علامةٌ يضعها بعضُ الكاشفاتِ ولا يضعها أكثرُها. فصار ظهورُ
// الامتناعِ للمستخدمِ تابعًا لعلامةٍ في الكاشفِ لا لما جرى فعلًا:
//     SQL_INJECTION/php  🔴  ⇒  {total:1, fixed:0, needsAI:0}
//     SQL_INJECTION/cs   🔴  ⇒  {total:1, fixed:0, needsAI:0}
//     XSS_INNER_HTML     🔴  ⇒  لا سطرَ في أيِّ قناةٍ يراها المستخدم
// ثغرةٌ حرجةٌ اكتُشفت، ووُجِّهت إلى استراتيجيّتها، وامتنع عنها المُصلِحُ
// امتناعًا **صحيحًا** لنقصِ السياق — ثم اختفت. والمستخدمُ يقرأ «مشكلةٌ
// واحدة، لا إصلاح، ولا شيءَ يحتاج مراجعة».
//
// و‎[REFUSAL-VISIBLE]‎ يُعلن كلَّ ما نُودي له مُصلِحٌ فلم يُنتج تعديلًا.
// القراراتُ كما هي حرفًا: ‎repairs‎ و‎rejected‎ لا يتغيّران، و‎score‎ يبقى
// ‎repairs/total‎. و‎needsAI‎ يرتفع لأنّ الرقمَ الصادقَ أعلى، لا لأنّ
// المحرّكَ أصلح أكثر — وذلك ما يُثبته ‎[RV-6]‎.
//
// فرعُ ‎FIXER_THREW‎ يمرّ بالحلقةِ نفسِها، ولا اختبارَ له هنا: ‎STRATEGIES‎
// غيرُ مُصدَّرةٍ إلى سياقِ الاختبار فلا سبيلَ إلى إجبارِ مُصلِحٍ على الرمي.
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
  return { issues, r: ctx.repairCode(code, issues.map(x => Object.assign({}, x)), fn) };
};
const announced = (r, strategy) =>
  (r.aiNeeded || []).filter(a => String(a.strategy) === strategy);

const PHP_SQL = '<?php\nfunction f($db, $name) {\n  return $db->query("SELECT * FROM u WHERE n = \'" . $name . "\'");\n}\n';
const CS_SQL  = 'class A {\n  void f(string name) {\n    var q = "SELECT * FROM u WHERE n = \'" + name + "\'";\n  }\n}\n';
const JS_EVAL = 'function f(s) {\n  return eval(s);\n}\nmodule.exports = { f };\n';
const JS_SQL  = 'function f(db, name) {\n  return db.query("SELECT * FROM u WHERE n = \'" + name + "\'");\n}\nmodule.exports = { f };\n';

test('[RV-1] ثغرةٌ حرجةٌ امتنع عنها المُصلِحُ تُعلَن، ولا تختفي', () => {
  for (const [label, fn, code] of [['php', 'a.php', PHP_SQL], ['cs', 'a.cs', CS_SQL]]) {
    const { issues, r } = cycle(code, fn);
    assert.ok(issues.some(i => /SQL/i.test(String(i.title))), label + ': tripwire — لا بلاغَ أصلًا');
    assert.strictEqual((r.repairs || []).length, 0, label + ': tripwire — صار يُصلَح، فالحالةُ تغيّرت');
    const ai = announced(r, 'SQL_INJECTION');
    assert.strictEqual(ai.length, 1, label + ': لم يُعلَن الامتناع — ' + JSON.stringify(r.aiNeeded));
    assert.ok(r.summary.needsAI >= 1, label + ': العدُّ يقول لا شيءَ يحتاج مراجعة');
    assert.ok(String(ai[0].reason).length >= 20, label + ': إعلانٌ بلا سبب');
    assert.match(String(ai[0].reason), /fixSQLInjection/, label + ': الإعلانُ لا يسمّي المُصلِحَ المسؤول');
  }
});

test('[RV-2] والكاشفاتُ التي لا تضع aiRequired لم تعد تُسقط بلاغَها', () => {
  // ‎XSS_INNER_HTML‎ و‎LOG_SECRET‎ كاشفاهما لا يضعان العلامة، فكانا يختفيان.
  const { r } = cycle(JS_EVAL, 'b.js');
  assert.strictEqual(announced(r, 'XSS_INNER_HTML').length, 1,
    'ضاع بلاغُ XSS: ' + JSON.stringify(r.aiNeeded));
  const LOG = 'function f(password) {\n  console.log("pw", password);\n}\nmodule.exports = { f };\n';
  const r2 = cycle(LOG, 'c.js').r;
  // قناةُ المُصلِحِ وحدَها تُعلَن دائمًا. و‎[EXIT-VISIBLE]‎ أضاف أنواعًا
  // تصف بلاغاتٍ لم يكن لها مُصلِحٌ أصلًا، وإعلانُها انتقائيٌّ بالشدّة —
  // العقدُ كاملًا في ‎[EX-3]‎ و‎[EX-4]‎.
  for (const d of (r2.dropped || []).filter(x => /^FIXER_(NO_CHANGE|THREW)$/.test(String(x.kind)))) {
    assert.ok(announced(r2, String(d.strategy)).length >= 1,
      'بقي مُسقَطًا بلا إعلان: ' + d.strategy);
  }
});

test('[RV-3] وكلُّ مُسقَطٍ له إعلان — لا استثناءَ يعتمد على علامةِ الكاشف', () => {
  for (const [fn, code] of [['d.php', PHP_SQL], ['d.cs', CS_SQL], ['d.js', JS_EVAL], ['d.ts',
       'export function f(s: string): any {\n  return eval(s);\n}\n']]) {
    const { r } = cycle(code, fn);
    for (const d of r.dropped || []) {
      const hit = (r.aiNeeded || []).some(a =>
        a.line === d.line && String(a.strategy) === String(d.strategy));
      const fixed = (r.repairs || []).some(p =>
        p.line === d.line && String(p.strategy) === String(d.strategy));
      // امتناعُ المُصلِحِ يُعلَن دائمًا — ولا يتوقّف على ‎aiRequired‎، وهو
      // بيتُ القصيد هنا. وما ليس من قناةِ المُصلِحِ يحكمه عقدُ ‎[EX-3]‎.
      if (!/^FIXER_(NO_CHANGE|THREW)$/.test(String(d.kind))) continue;
      assert.ok(hit || fixed, fn + ': مُسقَطٌ بلا إعلانٍ ولا إصلاح — ' + d.strategy + '@' + d.line);
    }
  }
});

test('[RV-4] ولا تكرار: إعلانٌ واحدٌ لكلِّ (سطر، استراتيجيّة)', () => {
  // ‎SQL_INJECTION/py‎ كاشفُه يضع ‎aiRequired‎، فكان يُعلَن مرّةً من الحلقة.
  // والحلقةُ الجديدةُ يجب ألّا تُضيف ثانية.
  const PY = 'def f(cur, name):\n    cur.execute("SELECT * FROM u WHERE n = \'" + name + "\'")\n';
  for (const [fn, code] of [['e.py', PY], ['e.php', PHP_SQL], ['e.js', JS_EVAL]]) {
    const { r } = cycle(code, fn);
    const seen = new Set();
    for (const a of r.aiNeeded || []) {
      const k = a.line + '|' + a.strategy;
      assert.ok(!seen.has(k), fn + ': إعلانٌ مكرّر — ' + k);
      seen.add(k);
    }
    assert.strictEqual(r.summary.needsAI, (r.aiNeeded || []).length, fn + ': العدُّ لا يطابق');
  }
});

test('[RV-5] وعقدُ security_no_drop محفوظ: ما أُصلح لا يظهر إعلانًا', () => {
  const { r } = cycle(JS_SQL, 'f.js');
  assert.ok((r.repairs || []).some(p => p.strategy === 'SQL_INJECTION'),
    'tripwire: إصلاحُ js تراجع — ' + (((r.rejected || [])[0] || {}).reason || ''));
  for (const p of r.repairs || []) {
    assert.strictEqual(
      (r.aiNeeded || []).filter(a => a.line === p.line && String(a.strategy) === String(p.strategy)).length,
      0, 'صنفٌ أُصلح ظهر في aiNeeded: ' + p.strategy + '@' + p.line);
  }
});

test('[RV-6] والإعلانُ ليس إصلاحًا: لا الكودُ تغيّر ولا score ارتفع', () => {
  for (const [fn, code] of [['g.php', PHP_SQL], ['g.cs', CS_SQL], ['g.js', JS_EVAL]]) {
    const { r } = cycle(code, fn);
    assert.strictEqual(r.repaired, code, fn + ': كُتب تعديلٌ على امتناع');
    assert.strictEqual(r.summary.fixed, 0, fn + ': احتُسب إصلاح');
    assert.strictEqual(r.summary.score, 0, fn + ': ارتفع score بلا إصلاح');
    assert.strictEqual(r.summary.score,
      Math.round(((r.repairs || []).length / Math.max(r.summary.total, 1)) * 100),
      fn + ': صيغةُ score تغيّرت');
  }
});

test('[RV-7] ولم يُضعَّف قرارٌ: الرفضُ رفضٌ والقبولُ قبول', () => {
  // ملفٌّ فيه ما يُصلَح وما يُمتنَع عنه معًا: الإصلاحُ يمضي، والامتناعُ يُعلَن،
  // ولا ينقلب أحدُهما إلى الآخر.
  const MIX = 'function f(db, name, s) {\n' +
              '  db.query("SELECT * FROM u WHERE n = \'" + name + "\'");\n' +
              '  return eval(s);\n}\nmodule.exports = { f };\n';
  const { r } = cycle(MIX, 'h.js');
  assert.ok((r.repairs || []).some(p => p.strategy === 'SQL_INJECTION'), 'ضاع إصلاحُ SQL');
  assert.strictEqual(announced(r, 'EVAL_USAGE').length, 1, 'لم يُعلَن امتناعُ eval');
  assert.match(r.repaired, /\?", \[name\]/, 'الإصلاحُ لم يُكتَب');
  assert.match(r.repaired, /\beval\s*\(s\)/, 'مُسَّ eval بلا إثبات');
  assert.notStrictEqual(ctx.FixVerifier.syntaxCheck(r.repaired, 'h.js').ok, false, 'الناتجُ مكسور');
});
