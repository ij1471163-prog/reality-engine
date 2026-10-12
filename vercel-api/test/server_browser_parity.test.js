// ═══════════════════════════════════════════════════════
// تكافؤُ المسارين سلوكيًّا — لا بأسماء الملفات
// ═══════════════════════════════════════════════════════
//
// للمحرّك مساران يُحلّلان ويُصلحان نفس الملف:
//   • المتصفح : بيانُ السكربتات في public/index.html
//   • الخادم  : قائمةُ المحرّكات في public/server_repair_adapter.js
//               (ومثلُها في api/analyze.js)
//
// والعيبُ المقيس الذي أنشأ هذا الملف: ‎ast-engine.js‎ كان في بيان الصفحة
// وغائبًا عن بياني الخادم معًا. و‎analyzeCode‎ تتخطّى تحليلَ AST **صامتةً**:
//
//     if (typeof analyzeJSWithAST === 'function') { … }
//
// فلا خطأ ولا تحذير — فقط بلاغاتٌ لا تُرى. والمقيس على دالةٍ من خمسة أسطر:
//
//     المتصفح : 2 بلاغ  ⇒  ‎t = i.v‎ داخل حلقة  ⇒  ‎t += i.v‎   (إصلاحٌ مُطبَّق)
//     الخادم  : 1 بلاغ  ⇒  لا شيء                              (صفر إصلاح)
//
// وعلى GameServer.js الحقيقي: 33/10 في المتصفح مقابل 32/9 في الخادم.
// وما لا يُبلَّغ عنه لا يُصلَح — وهي العلّةُ نفسُها التي عالجها 953817f
// لثمانية عشر كاشفًا، وفات منها هذا.
//
// ولماذا لم يكشفه حارسٌ قائم: ‎[CH-7]‎ في server_chain_salvage_e2e يقارن
// **أسماء** الملفات بنمط ‎analyz|scanner|detector|taint|…‎، و‎ast-engine‎
// لا يطابق أيًّا منها. فحارسُ الأسماء يحرس ما سُمّي، وهذا الملف يحرس
// **السلوك**: ما يراه المتصفح يراه الخادم، أيًّا كان اسمُ من يراه.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function browserCtx() {
  const noop = () => {};
  const store = new Map();
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop,
                createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null),
                    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const f = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(f)) continue;
    try { vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة */ }
  }
  return ctx;
}

const { createRepairEngine } = require(path.join(PUBLIC_DIR, 'server_repair_adapter.js'));

// بصمةُ البلاغ: السطر والعنوان — لا الترتيب ولا الحقول العابرة
const sig = issues => (issues || []).map(i => i.line + '|' + String(i.title || i.type || '')).sort();

// العيّنةُ التي كشفت العيب: إسنادٌ داخل حلقة، والصواب تراكم
const ACC = [
  'function total(items) {',
  '  let t = 0;',
  '  for (const i of items) { t = i.v; }',
  '  return t;',
  '}',
  'module.exports = { total };',
  '',
].join('\n');

test('[PAR-1] tripwire: المسارانِ يعملان ويُنتجان بلاغات', () => {
  const B = browserCtx(), S = createRepairEngine();
  assert.strictEqual(typeof B.analyzeCode, 'function', 'المتصفح بلا analyzeCode');
  assert.strictEqual(typeof S.analyze, 'function', 'الخادم بلا analyze');
  assert.ok(B.analyzeCode(ACC, 'acc.js').length > 0, 'المتصفح لا يُبلّغ عن شيء');
  assert.ok(S.analyze(ACC, 'acc.js').length > 0, 'الخادم لا يُبلّغ عن شيء');
});

test('[PAR-2] بقُّ التراكم يراه المسارانِ معًا', () => {
  const B = browserCtx(), S = createRepairEngine();
  const acc = i => /تراكم|ACCUMULATION/i.test(String(i.title || '') + ' ' + String(i.strategy || ''));

  const b = B.analyzeCode(ACC, 'acc.js').filter(acc);
  assert.ok(b.length >= 1, 'المتصفحُ لا يرى بقَّ التراكم — تغيّرت الفرضية');

  const s = (S.analyze(ACC, 'acc.js') || []).filter(acc);
  assert.ok(s.length >= 1,
    'الخادمُ لا يرى بقَّ التراكم بينما المتصفحُ يراه — وما لا يُبلَّغ عنه لا يُصلَح');
});

test('[PAR-3] وكلاهما يُصلحه إلى ‎+=‎', () => {
  const B = browserCtx(), S = createRepairEngine();
  const bOut = B.repairCode(ACC, B.analyzeCode(ACC, 'acc.js').map(x => Object.assign({}, x)), 'acc.js');
  const sOut = S.repair(ACC, (S.analyze(ACC, 'acc.js') || []).map(x => Object.assign({}, x)), 'acc.js');

  assert.match(bOut.repaired, /t \+= i\.v/, 'المتصفحُ لم يُصلح التراكم');
  assert.match(String(sOut.repaired), /t \+= i\.v/, 'الخادمُ لم يُصلح التراكم');
  assert.strictEqual(String(sOut.repaired), bOut.repaired, 'ناتجُ المسارين اختلف');
});

test('[PAR-4] تكافؤٌ على عيّناتٍ من كل صنف — لا ينقص الخادمُ عن المتصفح', () => {
  const B = browserCtx(), S = createRepairEngine();
  const SAMPLES = {
    'secret.js': 'const API_TOKEN = "sk_live_7f3a9b2c4d6e8f0a";\nmodule.exports = { API_TOKEN };\n',
    'xss.js':    'function r(el, v) {\n  el.innerHTML = v;\n}\nmodule.exports = { r };\n',
    'sql.js':    'function q(db, id) {\n  return db.query("SELECT * FROM t WHERE id=" + id);\n}\nmodule.exports = { q };\n',
    'http.js':   'function p() {\n  return fetch("http://api.x.com/y");\n}\nmodule.exports = { p };\n',
    'vars.js':   'var a = 1;\nvar b = 2;\nif (a == b) { console.log(a); }\nmodule.exports = { a, b };\n',
    'acc.js':    ACC,
    'foreach.js':'function go(xs) {\n  xs.forEach(function (x) {\n    return x * 2;\n  });\n}\nmodule.exports = { go };\n',
    'clean.js':  "'use strict';\nfunction add(a, b) {\n  return Number(a) + Number(b);\n}\nmodule.exports = { add };\n",
  };

  const missing = [];
  for (const [name, code] of Object.entries(SAMPLES)) {
    const b = sig(B.analyzeCode(code, name));
    const s = sig(S.analyze(code, name));
    const gone = b.filter(x => !s.includes(x));
    if (gone.length) missing.push(name + ' → ' + gone.join(' , '));
  }
  assert.deepStrictEqual(missing, [],
    'بلاغاتٌ يراها المتصفحُ ويفوتها الخادم:\n  ' + missing.join('\n  '));
});

test('[PAR-5] وكلُّ وحدةِ تحليلٍ في الصفحة مُعلَنةٌ في بياني الخادم', () => {
  // حارسٌ بنيويٌّ يكمّل السلوكي: وحدةٌ تُعرّف دالةَ تحليلٍ ينادينها
  // ‎analyzeCode‎ بـ‎typeof … === 'function'‎ تُسقَط صامتةً حين تغيب.
  // فالغيابُ يُكشَف هنا بالاسم، وأثرُه يُكشَف أعلاه بالسلوك.
  const page = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const adapter = fs.readFileSync(path.join(PUBLIC_DIR, 'server_repair_adapter.js'), 'utf8');
  const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'analyze.js'), 'utf8');

  const scripts = [...page.matchAll(/<script src="\/([\w.\-]+\.js)"/g)].map(m => m[1]);
  const inAdapter = f => new RegExp('"' + f.replace(/[.\-]/g, '\\$&') + '"').test(adapter);
  const inApi     = f => new RegExp("'" + f.replace(/[.\-]/g, '\\$&') + "'").test(api);

  // الوحداتُ التي تُعرّف دالةً تُستشار بـtypeof داخل analyzeCode
  const analyzer = fs.readFileSync(path.join(PUBLIC_DIR, 'analyzer.js'), 'utf8');
  const consulted = [...analyzer.matchAll(/typeof\s+(\w+)\s*===\s*['"]function['"]/g)].map(m => m[1]);
  assert.ok(consulted.length >= 5, 'لم تُستخرج الدوالُّ المُستشارة: ' + consulted.length);

  const owners = {};
  for (const f of scripts) {
    const p = path.join(PUBLIC_DIR, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    for (const fn of consulted) {
      if (new RegExp('function\\s+' + fn + '\\s*\\(').test(src)) (owners[fn] = owners[fn] || []).push(f);
    }
  }

  const gaps = [];
  for (const [fn, files] of Object.entries(owners)) {
    for (const f of files) {
      if (!inAdapter(f)) gaps.push(f + ' (يُعرّف ' + fn + ') غائبٌ عن محوّل الخادم');
      if (!inApi(f))     gaps.push(f + ' (يُعرّف ' + fn + ') غائبٌ عن api/analyze.js');
    }
  }
  assert.deepStrictEqual(gaps, [], 'وحداتُ تحليلٍ تراها الصفحةُ ولا يراها الخادم:\n  ' + gaps.join('\n  '));
});
