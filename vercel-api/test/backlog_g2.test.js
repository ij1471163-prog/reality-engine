// ═══════════════════════════════════════════════════════
// Backlog G2 — aiNeeded في كل المسارات + بقية P1 routing
// تشغيل:  node --test vercel-api/test/backlog_g2.test.js
//
//   1. غلاف المتصفح (index.html repair-engine) لم يعد يرمي aiNeeded.
//   2. fix_engine_pipeline.js يبني aiNeeded نهائيًا (بعد كل المحركات).
//   3. strategy: null صريح = لا استنتاج من الـtitle؛ strategy معروف غير مدعوم
//      للغة = null (لا title fallback)؛ لا routing يعتمد على اسم المستخدم.
//   4. Python: os.environ.get بلا import os كان إصلاحًا مزيّفًا (NameError).
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadUiContext() {
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop, createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
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
  ctx.GhostMode = undefined;
  return { ctx, html };
}

const { ctx, html } = loadUiContext();
const route = (i, lang) => ctx.detectStrategy(i, lang);
const CALLBACK = "a(function(){\n b(function(){\n  c(function(){\n   d(function(){\n    e(function(){\n     f();\n    });\n   });\n  });\n });\n});\n";

// ═══ 1. غلاف المتصفح الحقيقي ═══════════════════════════════
test('browser wrapper (real index.html inline script) passes repairCode aiNeeded through', () => {
  // تحميل السكربت المضمَّن نفسه — لا نسخة منه. fetch/setTimeout بلا أثر.
  ctx.fetch = () => new Promise(() => {});
  const realSetTimeout = ctx.setTimeout;
  ctx.setTimeout = () => 0;
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  try { vm.runInContext(inline, ctx, { filename: 'index.inline.js' }); } catch (e) { /* أجزاء DOM فقط */ }
  ctx.setTimeout = realSetTimeout;
  assert.strictEqual(ctx._registerEngines(), true);
  const RO = ctx.RealityOrchestrator;
  const wrapper = RO.getEngine('repair-engine').fn;
  const issues = ctx.analyzeCode(CALLBACK, 'cb.js');
  assert.ok(issues.some(i => route(i, 'js') === 'CALLBACK_HELL'), 'precondition');
  const r = wrapper(CALLBACK, issues, 'cb.js');
  assert.ok(r.aiNeeded.some(a => a.strategy === 'CALLBACK_HELL'), 'non-security aiNeeded kept by the wrapper');
  const out = RO.runPipeline(CALLBACK, 'cb.js', { useFallbackChain: true });
  assert.ok(out.phases.fallback.aiNeeded.some(a => a.strategy === 'CALLBACK_HELL'), 'reaches final aiNeeded');
  assert.notStrictEqual(out.decision.decision, 'SAFE_AUTO_FIX');
});

// ═══ 2. fix_engine_pipeline.js — aiNeeded نهائي ═══════════
// سياق مستقل: السكربت المضمَّن في index.html (اختبار 1) يعرّف F/R بـlet فيحجب ctx.F
const { ctx: pctx } = loadUiContext();
function runDirectPipeline(files, { analyzerThrowsOnFinalFor } = {}) {
  const ctx = pctx;
  ctx.toast = () => {};
  ctx.refreshStats = () => {};
  ctx.F = Object.assign({}, files);
  ctx.R = {};
  for (const f in files) ctx.R[f] = { code: files[f], issues: ctx.analyzeCode(files[f], f) };
  const realAnalyze = ctx.analyzeCode;
  let final = false;
  if (analyzerThrowsOnFinalFor) {
    // يرمي فقط في مرحلة aiNeeded النهائية (بعد انتهاء كل المحركات)
    ctx._markFinal = () => { final = true; };
    ctx.analyzeCode = (c, f) => {
      if (final && f === analyzerThrowsOnFinalFor) throw new Error('analyzer crashed');
      return realAnalyze(c, f);
    };
  }
  const realCollect = ctx._collectFinalAiNeeded;
  ctx._collectFinalAiNeeded = (...a) => { final = true; return realCollect(...a); };
  try { return ctx.fixAllEnginePipeline(); }
  finally { ctx.analyzeCode = realAnalyze; ctx._collectFinalAiNeeded = realCollect; }
}

test('direct pipeline: final aiNeeded has unresolved non-security + security leftovers, not fixed ones', () => {
  const rep = runDirectPipeline({
    'mix.js': 'const API_KEY = "sk_live_abcdefghijklmnop1234";\napp.get(\'/u\', (req,res)=>{\n  eval(req.body.code);\n  fetch("http://api.example.com/data");\n});\n',
    'cb.js': CALLBACK,
    'e.c': 'int main(){ char b[10]; gets(b); return 0; }\n',
  });
  const by = f => rep.aiNeeded.filter(e => e.file === f);
  assert.ok(by('cb.js').some(e => e.strategy === 'CALLBACK_HELL'));
  assert.ok(by('e.c').some(e => /gets\(\)/.test(e.title) && e.securityNoDrop), 'C security finding kept (P2 no-drop)');
  assert.ok(by('mix.js').some(e => e.strategy === 'MISSING_AUTH'));
  // ما أُصلح فعلًا (eval/http/API_KEY) لا يظهر
  const finalMix = pctx.analyzeCode(pctx.F['mix.js'], 'mix.js');
  for (const e of by('mix.js')) assert.ok(finalMix.some(i => i.title === e.title), 'only findings still present: ' + e.title);
});

test('direct pipeline: final re-analysis failure keeps last known issues, warns, never claims clean', () => {
  const rep = runDirectPipeline({ 'e.c': 'int main(){ char b[10]; gets(b); return 0; }\n' }, { analyzerThrowsOnFinalFor: 'e.c' });
  assert.ok(rep.warnings.some(w => /FINAL_REANALYSIS_FAILED/.test(w.reason)));
  const e = rep.aiNeeded.find(x => x.file === 'e.c' && /gets\(\)/.test(x.title));
  assert.ok(e && e.staleIssues === true);
});

// ═══ 3. P1 routing backlog ═════════════════════════════════
const NAMES = ['sqlCmd', 'evalScore', 'passwordCount', 'logs', 'httpProxy', 'secretSanta', 'varX', 'catchAll', 'noneVal', 'authToken'];
const NEUTRAL = 'total';

function routesFor(file, mk, lang, ext) {
  const out = {};
  for (const n of [NEUTRAL, ...NAMES]) {
    const issues = ctx.analyzeCode(mk(n), file);
    out[n] = issues.map(i => [i.line, i.title.split(n).join('<N>').split(n.toUpperCase()).join('<N>').split('$' + n).join('$<N>'), route(i, lang)]);
  }
  return out;
}
const CASES = {
  'dead.js':      [n => `function f() {\n  let ${n} = compute();\n  return 1;\n}\nf();\n`, 'js'],
  'callgraph.js': [n => `function ${n}() {\n  return 1;\n}\n`, 'js'],
  'div.js':       [n => `let ${n} = items.length;\nconst avg = sum / ${n};\n`, 'js'],
  'typeerr.js':   [n => `let ${n} = 0;\n${n}.toUpperCase();\n`, 'js'],
  'stub.java':    [n => `class A {\n  public void ${n}() {\n  }\n  public String g${n}() {\n    return null;\n  }\n}\n`, 'java'],
  'cmd.php':      [n => `<?php\n$${n} = $_GET['c'];\nexec($${n});\n`, 'php'],
  'sec.py':       [n => `${n.toUpperCase()}_KEY = "abcdefghijk12345"\nprint(1)\n`, 'py'],
};
for (const [file, [mk, lang]] of Object.entries(CASES)) {
  test(`${file}: routing never depends on the user's identifier`, () => {
    const r = routesFor(file, mk, lang);
    // نفس الـfinding (سطر + قالب العنوان) يجب أن يُوجَّه بنفس الطريقة مهما كان الاسم.
    // findings إضافية يكتشفها detector آخر بسبب الاسم (عنوان ثابت بلا <N>) ليست routing.
    const neutral = new Map(r[NEUTRAL].map(([l, t, s]) => [`${l}|${t}`, s]));
    for (const n of NAMES) {
      for (const [l, t, s] of r[n]) {
        const k = `${l}|${t}`;
        if (neutral.has(k)) assert.strictEqual(s, neutral.get(k), `${file}: "${t}" with ${n}`);
        else assert.ok(!t.includes('<N>'), `${file}: unexpected name-bearing finding "${t}" for ${n}`);
      }
    }
  });
}

test('explicit strategy: null → no title routing; undefined → title fallback as before', () => {
  const t = '🔵 Dead Assignment: sqlInjection معرّف لكن لا يُستخدم';
  assert.strictEqual(route({ title: t, strategy: null }, 'js'), null);
  assert.strictEqual(route({ title: t }, 'js'), 'SQL_INJECTION', 'issues without the field keep old routing');
});

test('known strategy unsupported for language → null; unknown key → title fallback', () => {
  assert.strictEqual(route({ title: '🔴 CMD_INJECTION: $sqlCmd → exec', strategy: 'CMD_INJECTION' }, 'php'), null);
  assert.strictEqual(route({ title: 'خطأ تراكم Java: passwordCount = بدل +=', strategy: 'ACCUMULATION' }, 'java'), null);
  assert.strictEqual(route({ title: 'خطأ تراكم: total = بدل +=', strategy: 'NOT_A_STRATEGY' }, 'js'), 'ACCUMULATION');
});

test('Type Error no longer routes to LOOSE_EQUALITY (static title word "string")', () => {
  const issues = ctx.analyzeCode('let total = 0;\ntotal.toUpperCase();\n', 'a.js').filter(i => /Type Error/.test(i.title));
  assert.ok(issues.length, 'precondition');
  for (const i of issues) assert.strictEqual(route(i, 'js'), null);
});

test('secret_detector: masked secret value never steers routing', () => {
  const code = 'const DB = "Password=sqlx_eval_http_1234567";\nconst k = "sk_live_sqlEVALhttp1234567890";\n';
  for (const i of ctx.analyzeCode(code, 'a.js').filter(x => x.type === 'secret')) {
    assert.ok(!['SQL_INJECTION', 'EVAL_USAGE', 'HTTP_USAGE', 'LOOSE_EQUALITY'].includes(route(i, 'js')), i.title);
  }
});

// ═══ 4. Python import os ═══════════════════════════════════
const pyFix = code => ctx.repairCode(code, ctx.analyzeCode(code, 's.py'), 's.py').repaired;
test('python secret fix adds import os (was NameError) for SECRET and PASSWORD names', () => {
  for (const n of ['SECRET_KEY', 'DB_PASSWORD', 'API_TOKEN']) {
    const out = pyFix(`${n} = "abcdefghijk12345"\nprint(1)\n`);
    assert.strictEqual(out, `import os\n${n} = os.environ.get('${n}', '')\nprint(1)\n`, n);
  }
});

test('python import os: respects shebang/docstring/__future__, no duplicates, alias, unclear → no fix', () => {
  assert.strictEqual(
    pyFix('#!/usr/bin/env python\n"""Doc.\n\nmore"""\nfrom __future__ import annotations\nSECRET_KEY = "abcdefghijk12345"\n'),
    '#!/usr/bin/env python\n"""Doc.\n\nmore"""\nfrom __future__ import annotations\nimport os\nSECRET_KEY = os.environ.get(\'SECRET_KEY\', \'\')\n');
  assert.strictEqual(pyFix('import os\nAPI_TOKEN = "abcdefghijk12345"\n'), 'import os\nAPI_TOKEN = os.environ.get(\'API_TOKEN\', \'\')\n');
  assert.strictEqual(pyFix('import sys, os.path\nAPI_TOKEN = "abcdefghijk12345"\n'), 'import sys, os.path\nAPI_TOKEN = os.environ.get(\'API_TOKEN\', \'\')\n');
  assert.strictEqual(pyFix('import os as o\nAPI_TOKEN = "abcdefghijk12345"\n'), 'import os\nimport os as o\nAPI_TOKEN = os.environ.get(\'API_TOKEN\', \'\')\n');
  const unclear = '"""unterminated\nSECRET_KEY = "abcdefghijk12345"\n';
  assert.strictEqual(pyFix(unclear), unclear, 'no guess → no fix');
});

test('python password fix: secret no longer left behind by the line-shift bug', () => {
  const out = pyFix('PASSWORDCOUNT_KEY = "abcdefghijk12345"\nprint(1)\n');
  assert.ok(!out.includes('abcdefghijk12345'), out);
  assert.strictEqual(out.split('\n').filter(l => l.startsWith('PASSWORDCOUNT_KEY')).length, 1, 'no duplicated line');
});
