// ═══════════════════════════════════════════════════════════════════════
// [PERF] كلفة التحليل — تعبيرٌ أسّي، مسارات تربيعية، وميزانية زمنية للخادم
// تشغيل:  node --test vercel-api/test/analyze_perf_redos.test.js
//
// كل تحسينٍ هنا مشروطٌ بأن **لا تتغيّر النتائج**: لكل تغيير اختبار تكافؤ مع
// المنطق الأصلي (منسوخًا هنا مرجعًا)، ثم اختبار أداء بنسبٍ لا بأزمنةٍ مطلقة
// حيث أمكن (الحزمة تعمل ملفاتٍ متوازية فالزمن المطلق متقلّب).
//
// المقيس قبل التغيير (بيئة التطوير):
//   • 28 رقمًا في سطر md5(Math.random() + …) ⇒ 6.7 ثانية عبر /api/analyze
//   • 100KB من ‎var a = 1;‎ ⇒ تحليل 4.8 ثانية، وإصلاح 10KB ⇒ 12.9 ثانية
//   • سطرٌ من 50 ألف مسافة ⇒ 24 ثانية (400 تعبير تربيعي — غير مُعاد كتابته؛
//     تحميه الميزانية الزمنية في api/analyze.js)
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUB = path.join(__dirname, '..', 'public');
const read = f => fs.readFileSync(path.join(PUB, f), 'utf8');
const ms = f => { const t = process.hrtime.bigint(); const r = f(); return [Number(process.hrtime.bigint() - t) / 1e6, r]; };

// ═══ 1a. _WC_RANDOM_ONLY: نفس اللغة بلا تراجعٍ أسّي ═══════════════════
// الأصل منسوخ حرفيًا مرجعًا (لا يُستعمل إلا على مدخلات قصيرة هنا).
const WC_ORIGINAL = /^(?:\s|\+|\(|\)|String|Math\.random\(\)|Date\.now\(\)|new\s+Date\(\)\.getTime\(\)|\.toString\(\s*\d*\s*\)|\d+|'[^'\\\n]*'|"[^"\\\n]*"|`[^`$\\]*`)*$/;
function currentWC() {
  const m = read('repair_engine.js').match(/^const _WC_RANDOM_ONLY = (\/.*\/);$/m);
  assert.ok(m, 'لم يُعثر على _WC_RANDOM_ONLY في repair_engine.js');
  return vm.runInNewContext(m[1]);
}

test('[1a-EQ] _WC_RANDOM_ONLY الجديد يطابق الأصل على كل متتاليات الرموز حتى 3 وعلى 60 ألف عيّنة عشوائية', () => {
  const NEW = currentWC();
  assert.notStrictEqual(NEW.source, WC_ORIGINAL.source, 'التعبير لم يتغيّر — الاختبار لا يقيس شيئًا');
  const T = [' ', '\t', '\n', '+', '(', ')', 'String', 'Math.random()', 'Math.random(', 'Date.now()',
    'new Date().getTime()', 'new  Date().getTime()', 'newDate().getTime()', '.toString()', '.toString(36)',
    '.toString( 36 )', '.toString(  )', '.toString(3 6)', '.toString(x)', '0', '12', "'a'", "''", "'a\\'",
    "'", '"b"', '"', '`c`', '`${x}`', '`', 'x', 'userId', '-', '.', '\\', '$'];
  const bad = [];
  const check = s => { if (NEW.test(s) !== WC_ORIGINAL.test(s)) bad.push(JSON.stringify(s)); };
  (function rec(p, d) { check(p); if (d === 3) return; for (const t of T) rec(p + t, d + 1); })('', 0);
  let seed = 11; const rnd = k => (seed = (seed * 1103515245 + 12345) % 2147483648) % k;
  for (let i = 0; i < 30000; i++) { let s = ''; for (let j = 1 + rnd(10); j > 0; j--) s += T[rnd(T.length)]; check(s); }
  const CH = " \t\n+()0123456789'\"`$\\.Stringtoxyz";
  for (let i = 0; i < 30000; i++) { let s = ''; for (let j = rnd(14); j > 0; j--) s += CH[rnd(CH.length)]; check(s); }
  assert.deepStrictEqual(bad.slice(0, 5), [], 'اختلاف في ' + bad.length + ' حالة');
});

test('[1a-SAFE] نصّ الهجوم لا يتراجع: 100 ألف رقم في أقل من 200ms (الأصل: 26 رقمًا ≈ 1.5 ثانية)', () => {
  const NEW = currentWC();
  const [t] = ms(() => NEW.test('Math.random() + ' + '0'.repeat(100000) + '"'));
  assert.ok(t < 200, t + 'ms');
});

test('[1a-E2E] الملف الصغير نفسه (40 رقمًا، 170 بايت) عبر /api/analyze مع fix ⇒ 200 بسرعة', async () => {
  const H = require('./helpers/api_harness.js');
  const sec = require('../lib/api_security.js');
  const analyze = H.fresh('analyze.js');
  const ip = '203.0.113.90';
  const tok = sec.issueSessionToken(H.FAKE.MASTER_SECRET, ip).token;
  const code = "const crypto = require('crypto');\nconst t = crypto.createHash('md5').update(Math.random() + " + '0'.repeat(40) + "x).digest('hex');\nmodule.exports = t;\n";
  const t0 = Date.now();
  const r = await H.call(analyze, { headers: { authorization: 'Bearer ' + tok, 'x-real-ip': ip }, body: { code, fileName: 'a.js', fix: true } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(Date.now() - t0 < 5000, (Date.now() - t0) + 'ms — قبل التغيير: دقائق');
});

test('[1a-HTML] تعبير innerHTML الأسّي في repair_html.js غير قابل للوصول: الواجهة العامة fix/getLineType فقط، وfix لا تستدعي fixXSS', () => {
  // مقيس: recheck يصنّفه أسّيًا، لكن fix() تفوّض إلى XSSFixer منذ [ONE-GATE] فلا يُنفَّذ.
  // تُرك كما هو (لا تغيير خارج المسار الحي)؛ وهذا الحارس يفشل إن أُعيد ربطه.
  const ctx = vm.createContext({ window: {}, module: { exports: {} } });
  vm.runInContext(read('repair_html.js'), ctx);
  assert.deepStrictEqual(Object.keys(ctx.module.exports).sort(), ['fix', 'getLineType']);
  const src = read('repair_html.js');
  const fixBody = src.slice(src.indexOf('function fix(code, fileName)'), src.indexOf('return { fix, getLineType }'));
  assert.ok(fixBody.length > 0);
  assert.doesNotMatch(fixBody, /fixXSS\s*\(/);
});

// ═══ 1c/1d. المرجع: الملف الحالي نفسه بعد إعادة الكتلة المعدّلة إلى نصّها الأصلي ═══
// فلا نموذج مكتوب باليد: كل ما عدا الكتلة متطابق بالبناء، فأي اختلاف سببه الكتلة وحدها.
function swapBlock(src, newBlockStart, newBlockEnd, originalBlock) {
  const a = src.indexOf(newBlockStart), b = src.indexOf(newBlockEnd, a);
  assert.ok(a > 0 && b > a, 'لم يُعثر على الكتلة المعدّلة: ' + newBlockStart.slice(0, 40));
  return src.slice(0, a) + originalBlock + src.slice(b + newBlockEnd.length);
}
const ANALYZER_NEW = read('analyzer.js');
const ANALYZER_ORIG = swapBlock(ANALYZER_NEW,
  '        // [PERF-1c]', '            if (!dup) { issues.push(pi); _pdAdd(pi); }\n        });',
  '        patternIssues.forEach(pi => {\n' +
  '            const dup = issues.some(x => Math.abs(x.line - pi.line) <= 1 && x.title === pi.title);\n' +
  '            if (!dup) issues.push(pi);\n' +
  '        });');
const DEEP_NEW = read('deep_analyzer.js');
const DEEP_ORIG = swapBlock(DEEP_NEW,
  '        // [PERF-1d]', 'if (this._daFull.indexOf(varName, this._daStarts[idx + 1]) === -1) {',
  "        const restCode = lines.slice(idx + 1).join('\\n');\n        if (!restCode.includes(varName)) {");

function analyzerWith(src, pre, pat) {
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} }, window: {} });
  vm.runInContext(src, ctx);
  ctx.__pre = pre; ctx.__pat = pat;
  vm.runInContext('function scanSecurity() { return __pre.map(x => Object.assign({}, x)); }' +
                  'function detectPatterns() { return __pat.map(x => Object.assign({}, x)); }', ctx);
  ctx.__c = 'q;';
  return JSON.stringify(vm.runInContext('analyzeCode(__c, "a.txt")', ctx).map(i => [i.line, i.title, i.sev]));
}

test('[1c-EQ] المرجع مبنيّ صحيحًا: الكتلة الأصلية تختلف عن الجديدة وكلاهما يُحمَّل', () => {
  assert.notStrictEqual(ANALYZER_ORIG, ANALYZER_NEW);
  assert.match(ANALYZER_ORIG, /Math\.abs\(x\.line - pi\.line\) <= 1 && x\.title === pi\.title\);\n\s*if \(!dup\) issues\.push\(pi\);/);
  assert.doesNotMatch(ANALYZER_ORIG, /_pdIdx/);
  analyzerWith(ANALYZER_ORIG, [], []);
});

test('[1c-EQ] حالات حدّية: أسطر نصية وكسرية وNaN وnull وعناوين غير نصية، ±1 و±1.5', () => {
  const pre = [{ line: 3, title: 'T' }, { line: '7', title: 'T' }, { line: 2.5, title: 'U' }, { line: undefined, title: 'V' },
               { line: null, title: 'W' }, { line: 10, title: 5 }, { line: 20, title: 'X' }];
  const pat = [{ line: 4, title: 'T' }, { line: 6, title: 'T' }, { line: 9, title: 'T' }, { line: 3, title: 'U' }, { line: 4, title: 'U' },
               { line: 1, title: 'V' }, { line: 0, title: 'W' }, { line: 1, title: 'W' }, { line: 10, title: 5 }, { line: 3.5, title: 'T' },
               { line: '21', title: 'X' }, { line: 22, title: 'X' }, { line: 23, title: 'X' }, { line: NaN, title: 'X' }, { line: 24, title: 'X' }];
  assert.strictEqual(analyzerWith(ANALYZER_NEW, pre, pat), analyzerWith(ANALYZER_ORIG, pre, pat));
});

test('[1c-EQ] 300 تشكيلة عشوائية: الجديد = الأصل', () => {
  let seed = 5; const rnd = k => (seed = (seed * 1103515245 + 12345) % 2147483648) % k;
  const lines = [1, 2, 3, 4, 5, 6, '3', '4', 2.5, 3.5, NaN, null, undefined, 0, -1];
  const titles = ['A', 'B', 'C', 7, null];
  for (let r = 0; r < 300; r++) {
    const mk = n => Array.from({ length: n }, () => ({ line: lines[rnd(lines.length)], title: titles[rnd(titles.length)], sev: 'm' }));
    const pre = mk(rnd(6)), pat = mk(rnd(14));
    assert.strictEqual(analyzerWith(ANALYZER_NEW, pre, pat), analyzerWith(ANALYZER_ORIG, pre, pat), 'تشكيلة ' + r);
  }
});

function deadAssign(src, code) {
  const ctx = vm.createContext({ console: { log() {} }, window: {} });
  vm.runInContext(src, ctx);
  ctx.__c = code;
  return JSON.stringify(vm.runInContext('new DataFlowAnalyzer(new DeepTypeInference().infer(__c)).analyze(__c)', ctx).map(i => [i.line, i.title]));
}

test('[1d-EQ] Dead Assignment: الجديد = الأصل (آخر سطر، تكرار، اسم جزئي، أسطر فارغة، 300 عشوائية)', () => {
  assert.notStrictEqual(DEEP_ORIG, DEEP_NEW);
  assert.match(DEEP_ORIG, /lines\.slice\(idx \+ 1\)\.join\('\\n'\);\n\s*if \(!restCode\.includes\(varName\)\) \{/);
  const cases = ['var a = 1;', 'var a = 1;\n', 'const a = 1;\nconsole.log(a);', 'let ab = 1;\nlet a = 2;\nab;',
    'var x = 1;\n\n\nvar y = x;', 'const aa = 1;\nconst a = aa;', 'var q = 1;\n// q\n', 'var z = 1;\nvar z = 2;\n', ''];
  for (const c of cases) assert.strictEqual(deadAssign(DEEP_NEW, c), deadAssign(DEEP_ORIG, c), JSON.stringify(c));
  let seed = 3; const rnd = k => (seed = (seed * 1103515245 + 12345) % 2147483648) % k;
  const parts = ['var a = 1;', 'let b = a;', 'const ab = 2;', 'x(a);', '', 'const c = ab;', 'b;', 'let a2 = 0;', '  var b = 3;', 'total = total + 1;', 'let total = 0;'];
  for (let r = 0; r < 300; r++) {
    const c = Array.from({ length: 1 + rnd(12) }, () => parts[rnd(parts.length)]).join('\n');
    assert.strictEqual(deadAssign(DEEP_NEW, c), deadAssign(DEEP_ORIG, c), JSON.stringify(c));
  }
});

// ═══ 1e. memoization لكل AST — لا تسرّب بين ملفات ولا أثر لترتيب الاستدعاء ═
function repairEngineCtx() {
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} }, window: {}, global: {}, F: {}, R: {} });
  for (const f of ['acorn.min.js', 'analyzer.js', 'repair_engine.js']) vm.runInContext(read(f), ctx);
  return ctx;
}
function repairOnce(ctx, code, name) {
  ctx.__c = code; ctx.__n = name;
  return vm.runInContext('(() => { const r = repairCode(__c, analyzeCode(__c, __n), __n); return JSON.stringify([r.repaired, (r.decisions || []).map(d => [d.line, d.reason || d.decision])]); })()', ctx);
}

test('[1e-MEMO] نتيجة كل ملف لا تتأثر بما أُصلح قبله: سياقٌ جديد لكل ملف = سياقٌ مشترك بأي ترتيب', () => {
  const files = {
    'cjs.js':    'const x = require("x");\nvar a = 1;\nvar b = a;\nmodule.exports = b;\n',
    'script.js': 'var a = 1;\nvar b = a;\nfunction f() { var c = 2; return c; }\n',
    'loop.js':   'module.exports = function () {\n  for (var i = 0; i < 3; i++) { setTimeout(() => i, 0); }\n  var k = 1; return k;\n};\n',
    'nested.js': 'module.exports = 1;\nvar a = function () { var b = 1; return b; };\n',
    'esm.js':    'import x from "x";\nvar a = x;\nexport default a;\n',
  };
  const fresh = {};
  for (const [n, c] of Object.entries(files)) fresh[n] = repairOnce(repairEngineCtx(), c, n);
  const names = Object.keys(files);
  for (const order of [names, names.slice().reverse(), names.concat(names)]) {
    const shared = repairEngineCtx();
    for (const n of order) assert.strictEqual(repairOnce(shared, files[n], n), fresh[n], n + ' اختلف في سياقٍ مشترك');
  }
});

test('[1e-MEMO] var في السطر نفسه في ملفين مختلفين (نفس رقم السطر) لا يختلطان', () => {
  const ctx = repairEngineCtx();
  const a = 'const m = require("m");\nvar alpha = 1;\nmodule.exports = alpha;\n';
  const b = 'const m = require("m");\nvar beta = 1;\nif (m) { beta = 2; }\nmodule.exports = beta;\n';
  const ra = repairOnce(ctx, a, 'a.js'), rb = repairOnce(ctx, b, 'b.js');
  assert.strictEqual(ra, repairOnce(repairEngineCtx(), a, 'a.js'));
  assert.strictEqual(rb, repairOnce(repairEngineCtx(), b, 'b.js'));
  assert.doesNotMatch(JSON.parse(rb)[0], /alpha/);
});

test('[1e-EQ] فهرس var يطابق المشي الأصلي (أول تعريف بترتيب المشي) لكل سطر في ملفات المستودع، والذاكرة لكل AST', () => {
  const ctx = repairEngineCtx();
  // المرجع: كتلة الأصل حرفيًا — مشيٌ كامل لكل استعلام يتوقف عند أول تطابق
  vm.runInContext(`function __refFirstVar(ast, lineNo) {
    let decl = null, chain = null;
    _reWalk(ast, (n, ps) => {
      if (decl) return false;
      if (n.type === 'VariableDeclaration' && n.kind === 'var' && n.loc.start.line === lineNo) { decl = n; chain = ps.slice(); return false; }
    });
    return decl ? { decl, chain } : null;
  }`, ctx);
  // الملفات المضغوطة سطرٌ واحد فيه مئات تعريفات var متداخلة — أقسى حالة لـ«الأول بترتيب المشي»
  const samples = ['repair_engine.js', 'analyzer.js', 'deep_analyzer.js', 'fix_verifier.js', 'knowledge_base.js', 'xss_fix.js', 'acorn.min.js', 'jszip.min.js']
    .map(f => read(f))
    .concat([Array.from({ length: 60 }, (_, i) => 'var v' + i + ' = function () { var w' + i + ' = ' + i + '; return w' + i + '; };').join('\n')])
    .concat(['var a = function () { var b = 1; return b; }, c = 2;\nfor (var i = 0, j = (function(){ var k; return k; })(); i < 1; i++) {}\n']);
  let checked = 0;
  for (let round = 0; round < 2; round++) for (const code of samples) {
    ctx.__c = code;
    const r = vm.runInContext(`(() => {
      const ast = _reParse(__c); if (!ast) return 'noast';
      const n = __c.split('\\n').length; let bad = [], hits = 0;
      for (let L = 1; L <= n; L++) {
        const a = _reFirstVarDeclAt(ast, L), b = __refFirstVar(ast, L);
        if (!a !== !b) { bad.push(L); continue; }
        if (!a) continue;
        hits++;
        if (a.decl !== b.decl || a.chain.length !== b.chain.length || a.chain.some((x, i) => x !== b.chain[i])) bad.push(L);
      }
      const cjs = [_isUnconditionalCommonJS(ast), _isUnconditionalCommonJS(ast), _isUnconditionalCommonJSUncached(ast)];
      return JSON.stringify({ bad: bad.slice(0, 5), hits, cjsStable: cjs[0] === cjs[1] && cjs[1] === cjs[2] });
    })()`, ctx);
    assert.notStrictEqual(r, 'noast');
    const o = JSON.parse(r);
    assert.deepStrictEqual(o.bad, [], 'أسطر مختلفة');
    assert.strictEqual(o.cjsStable, true);
    checked += o.hits;
  }
  assert.ok(checked > 50, 'تعريفات var مفحوصة: ' + checked);
});

// ═══ الأداء: نِسَب لا أزمنة مطلقة ══════════════════════════════════════
function analyzeCtx() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'analyze.js'), 'utf8');
  const list = [...src.match(/const engines = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} }, window: {}, global: {}, F: {}, R: {} });
  for (const f of list) if (fs.existsSync(path.join(PUB, f))) vm.runInContext(read(f), ctx);
  return ctx;
}

test('[PERF] 100KB من أسطر قصيرة: الزمن ينمو شبه خطيًا (قبل: ×12 من 25KB إلى 100KB، والتربيعي ×16)', () => {
  const ctx = analyzeCtx();
  const gen = n => 'var a = 1;\n'.repeat(Math.ceil(n / 11)).slice(0, n);
  ctx.analyzeCode(gen(5000), 'a.js');                                 // إحماء
  const best = n => Math.min(...[0, 1].map(() => ms(() => ctx.analyzeCode(gen(n), 'a.js'))[0]));
  const t25 = best(25 * 1024), t100 = best(100 * 1024);
  assert.ok(t100 / t25 < 8, `t25=${t25.toFixed(0)}ms t100=${t100.toFixed(0)}ms النسبة=${(t100 / t25).toFixed(1)}`);
});

test('[PERF] إصلاح 10KB من ‎var a = 1;‎ في أقل من 4 ثوانٍ (قبل: 12.9 ثانية)', async () => {
  const { RealityOrchestrator } = require('../public/server_engine_registration.js');
  const code = 'var a = 1;\n'.repeat(Math.round(10 * 1024 / 11));
  const t0 = Date.now();
  await RealityOrchestrator.runPipelineAsync(code, 's.js', { useFallbackChain: true });
  assert.ok(Date.now() - t0 < 4000, (Date.now() - t0) + 'ms');
});

// ═══ 1b. ميزانية الخادم: المكلف يُقاطَع، والمضغوط الرخيص يُحلَّل ═════════
function serverCall(code, fileName, fix) {
  const H = require('./helpers/api_harness.js');
  const sec = require('../lib/api_security.js');
  const ip = '198.18.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250);
  const tok = sec.issueSessionToken(H.FAKE.MASTER_SECRET, ip).token;
  return H.call(H.fresh('analyze.js'), { headers: { authorization: 'Bearer ' + tok, 'x-real-ip': ip }, body: { code, fileName, fix: !!fix } });
}

test('[1b] سطرٌ من 50 ألف مسافة (≈24 ثانية قبلًا) ⇒ 422 عند الميزانية (8 ثوانٍ) لا 504 بعد 60', async () => {
  const t0 = Date.now();
  const r = await serverCall('x' + ' '.repeat(50 * 1024) + 'y', 'a.js');
  const took = Date.now() - t0;
  assert.strictEqual(r.statusCode, 422, JSON.stringify(r.body));
  assert.strictEqual(r.body.budgetMs, 8000);
  assert.ok(took >= 7500 && took < 15000, took + 'ms');
});

test('[1b] ملفات مضغوطة حقيقية وسطرٌ واحد طويل تُحلَّل كاملةً (لا رفض بطول السطر)', async () => {
  const jszip = read('jszip.min.js');                                   // 95KB، سطرٌ أطول من 97 ألف حرف
  assert.ok(Math.max(...jszip.split('\n').map(l => l.length)) > 90000);
  const r1 = await serverCall(jszip, 'jszip.min.js');
  assert.strictEqual(r1.statusCode, 200, JSON.stringify(r1.body).slice(0, 200));
  assert.ok(r1.body.issues.length > 0);
  const acorn = read('acorn.min.js').slice(0, 100 * 1024);               // حدُّ الحجم 100KB
  const r2 = await serverCall(acorn, 'acorn.min.js');
  assert.strictEqual(r2.statusCode, 200, JSON.stringify(r2.body).slice(0, 200));
  const json = '{"a":' + JSON.stringify('x'.repeat(200)) + ',"b":[' + Array.from({ length: 3000 }, (_, i) => i).join(',') + ']}';
  const r3 = await serverCall('const cfg = ' + json + ';\nmodule.exports = cfg;\n', 'cfg.js');
  assert.strictEqual(r3.statusCode, 200);
});
