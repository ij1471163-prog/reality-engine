// ═══════════════════════════════════════════════════════
// Adversarial invariants ADV-1..ADV-5
// تشغيل:  node --test vercel-api/test/adversarial_invariants.test.js
//
// ⚠️ هذه ليست اختبارات fuzz I1–I5 الأصلية — السكربت الأصلي غير موجود في هذا
// الـrepo (بحث في كل الـbranches والتاريخ). هذه اختبارات مكافئة مستقلة، مولّد
// حتمي (seed ثابت) يركّب برامج من كتل ضعيفة مع أسماء محقونة، ويتحقق من:
//   ADV-1  no-drop: كل security finding باقية بعد الإصلاح موجودة في aiNeeded.
//   ADV-2  لا SAFE_AUTO_FIX مزيّف: fileFullyResolved=true ⇒ إعادة تحليل الـpatch
//          بلا أي security finding، والـpatch تحقق منه (valid && improved).
//   ADV-3  فشل إعادة التحليل ⇒ لا SAFE_AUTO_FIX أبدًا.
//   ADV-4  hash كلمة مرور / مدخل من caller ⇒ لا إعادة كتابة sha256 كـ"إصلاح".
//   ADV-5  الـrouting لا يعتمد على اسم المستخدم (نفس الـfinding ⇒ نفس الـstrategy).
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const { RealityOrchestrator: RO } = require(path.join(PUBLIC_DIR, 'server_engine_registration.js'));
const serverEngine = require(path.join(PUBLIC_DIR, 'server_repair_adapter.js')).createRepairEngine();

// ─── مولّد حتمي ─────────────────────────────────────────
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const NAMES = ['total', 'value', 'item', 'sqlCmd', 'evalScore', 'passwordCount', 'logs', 'httpProxy',
  'secretSanta', 'varX', 'catchAll', 'noneVal', 'authToken', 'cryptoKey', 'md5Sum', 'commandLine'];
const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];
const uniq = (rnd, used) => { let n; do { n = pick(rnd, NAMES) + (used.size ? used.size : ''); } while (used.has(n)); used.add(n); return n; };

const JS_BLOCKS = [
  n => `app.get('/a${n}', (req, res) => {\n  const ${n} = req.query.id;\n  db.query("SELECT * FROM t WHERE id=" + ${n});\n  res.json({});\n});`,
  n => `app.get('/b${n}', (req, res) => {\n  const ${n} = req.query.c;\n  exec(${n});\n});`,
  n => `function run${n}(req) {\n  const ${n} = req.body.code;\n  eval(${n});\n}`,
  n => `fetch("http://api.example.com/${n}");`,
  n => `const ${n}Key = "sk_live_abcdefghijklmnop1234";`,
  n => `let ${n} = 0;\nfor (const p of ps) {\n  ${n} = p.score;\n}`,
  n => `function hash${n}(password) {\n  return crypto.createHash('md5').update(password).digest('hex');\n}`,
  n => `function digest${n}(${n}) {\n  return crypto.createHash('sha1').update(${n}).digest('hex');\n}`,
  n => `var ${n} = 1;\nif (${n} == 2) { console.log(${n}); }`,
  n => `function ${n}() {\n}`,
  n => `document.getElementById('x').innerHTML = req.query.${n};`,
];
const PY_BLOCKS = [
  n => `def q_${n}(${n}):\n    cursor.execute("SELECT * FROM t WHERE id=" + ${n})`,
  n => `def c_${n}():\n    ${n} = request.args.get('c')\n    os.system(${n})`,
  n => `${n.toUpperCase()}_KEY = "abcdefghijk12345"`,
  n => `def h_${n}(password):\n    return hashlib.md5(password.encode()).hexdigest()`,
  n => `def e_${n}():\n    ${n} = request.args.get('q')\n    eval(${n})`,
  n => `def n_${n}(${n}):\n    if ${n} == None:\n        pass`,
];
function genProgram(seed) {
  const rnd = mulberry32(seed);
  const py = rnd() < 0.3;
  const used = new Set();
  const blocks = [];
  const k = 2 + Math.floor(rnd() * 4);
  for (let i = 0; i < k; i++) blocks.push(pick(rnd, py ? PY_BLOCKS : JS_BLOCKS)(uniq(rnd, used)));
  const head = py ? 'import os, hashlib\nfrom flask import request\n'
                  : "const express = require('express');\nconst crypto = require('crypto');\nconst { exec } = require('child_process');\nconst app = express();\n";
  return { file: `gen${seed}.${py ? 'py' : 'js'}`, code: head + blocks.join('\n') + '\n' };
}

// ─── تصنيف security بنيوي (نفس حقول الـdetector، بلا title) ───
const SEC_TYPES = new Set(('SECURITY SECRET TAINT CRYPTO THREAT XSS DOM_XSS SQL_INJECTION SQLFLOW NOSQL_INJECTION CMD_INJECTION ' +
  'CODE_INJECTION PATH_TRAVERSAL FILE_INCLUSION OPEN_REDIRECT SSRF SSTI XXE DESERIAL PROTO_POLLUTION MASS_ASSIGN REDOS ' +
  'TIMING_ATTACK HARDCODED_SECRET SECRET_EXPOSURE WEAK_SECRET WEAK_CRYPTO WEAK_RANDOM DATA_EXPOSURE UNSANITIZED_DB ' +
  'INSECURE_HTTP INSECURE_COOKIE CORS MISCONFIG DEBUG_MODE ELECTRON BUFFER MISSING_AUTH AUTH_WEAKNESS JWT_UNVERIFIED JWT_NONE JWT_EXPIRED').split(' '));
const CWE = /^CWE[-_]\d+/i;
const isSec = i => SEC_TYPES.has(String(i.type || '').toUpperCase()) || CWE.test(String(i.type || '')) ||
  CWE.test(String(i.cwe || '')) || CWE.test(String(i.cAct || '').trim());
const covered = (ai, f) => ai.some(e => e.title === f.title && (e.line === f.line || (e.ev && e.ev === f.ev)));

const SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i * 7919);

// ═══ ADV-1 + ADV-2 ════════════════════════════════════════
test('ADV-1/ADV-2: no dropped security finding, no fake SAFE_AUTO_FIX (60 generated programs)', () => {
  let safe = 0, partial = 0, checked = 0;
  for (const seed of SEEDS) {
    const { file, code } = genProgram(seed);
    const out = RO.runPipeline(code, file, { useFallbackChain: true });
    const fb = out.phases.fallback;
    if (!fb) continue;   // "No issues found"
    checked++;
    // ADV-1
    for (const f of fb.remainingIssues.filter(isSec)) {
      assert.ok(covered(fb.aiNeeded, f), `seed ${seed} ${file}: dropped "${f.title}" line ${f.line}`);
    }
    // ADV-2
    const d = out.decision;
    if (d.decision === 'SAFE_AUTO_FIX') {
      safe++;
      assert.ok(d.meta.verifyResult && d.meta.verifyResult.valid === true && d.meta.verifyResult.improved === true,
        `seed ${seed}: SAFE_AUTO_FIX without a valid+improved verification`);
      const after = serverEngine.analyze(d.patch, file).filter(isSec);
      if (d.meta.fileFullyResolved === true) {
        assert.strictEqual(after.length, 0, `seed ${seed}: fully resolved but patch still has ${after.map(i => i.title).join(' | ')}`);
      } else {
        partial++;
        for (const f of after) assert.ok(covered(d.meta.aiNeeded, f), `seed ${seed}: patch keeps "${f.title}" not in aiNeeded`);
      }
    }
  }
  assert.ok(checked >= 50, 'generator produced analyzable programs: ' + checked);
  assert.ok(safe > 0 && partial > 0, `coverage: safe=${safe} partial=${partial}`);
});

// ═══ ADV-3 ═════════════════════════════════════════════════
function freshOrchestrator() {
  const ctx = { console, window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'reality_orchestrator.js'), 'utf8'), ctx);
  return ctx.window.RealityOrchestrator;
}
test('ADV-3: re-analysis failure after a verified patch never yields SAFE_AUTO_FIX (real engines)', () => {
  let exercised = 0;
  for (const seed of SEEDS.slice(0, 25)) {
    const { file, code } = genProgram(seed);
    const O = freshOrchestrator();
    let calls = 0;
    O.registerEngine('an', O.EngineType.ANALYZER, (c, f) => {
      if (calls++ > 0) throw new Error('analyzer crashed on re-analysis');
      return serverEngine.analyze(c, f);
    }, ['*']);
    O.registerEngine('rp', O.EngineType.REPAIR, serverEngine.repair, ['*']);
    O.registerEngine('vf', O.EngineType.VERIFIER, (a, b) => ({ valid: true, improved: a !== b }), ['code-verification']);
    for (const opts of [{ useFallbackChain: true }, {}]) {
      calls = 0;
      const out = O.runPipeline(code, file, opts);
      const ph = out.phases.fallback || out.phases.repair;
      if (ph && ph.reanalysisFailed) {
        exercised++;
        assert.notStrictEqual(out.decision.decision, 'SAFE_AUTO_FIX', `seed ${seed}`);
        assert.strictEqual(out.decision.meta.fileFullyResolved, false, `seed ${seed}`);
      }
    }
  }
  assert.ok(exercised > 0, 'reanalysisFailed path exercised');
});

// ═══ ADV-4 ═════════════════════════════════════════════════
test('ADV-4: password / caller-supplied hashes are never "fixed" by a faster hash', () => {
  const rnd = mulberry32(4242);
  const shapes = [
    (n, a) => [`p${n}.js`, `const crypto = require('crypto');\nfunction ${n}(${a}) {\n  return crypto.createHash('${pick(rnd, ['md5', 'sha1'])}').update(${a}).digest('hex');\n}\n`],
    (n, a) => [`p${n}.js`, `const crypto = require('crypto');\nconst ${n} = crypto.createHash('md5').update(req.body.password).digest('hex');\n`],
    (n, a) => [`p${n}.py`, `import hashlib\ndef ${n}(${a}):\n    return hashlib.${pick(rnd, ['md5', 'sha1'])}(${a}.encode()).hexdigest()\n`],
    (n, a) => [`p${n}.php`, `<?php\n$${n} = md5($_POST['password']);\n`],
  ];
  let n = 0;
  for (let i = 0; i < 24; i++) {
    const [file, code] = pick(rnd, shapes)(pick(rnd, NAMES) + i, pick(rnd, ['password', 'pwd', 'value', 'data', 'input', 'userPass']));
    const out = RO.runPipeline(code, file, { useFallbackChain: true });
    if (!out.phases.fallback) continue;
    n++;
    const d = out.decision;
    assert.ok(!(d.decision === 'SAFE_AUTO_FIX' && /sha256|SHA-256/.test(String(d.patch))), `${file}: faster-hash "fix" issued\n${code}`);
    const weak = out.phases.fallback.remainingIssues.filter(x => /md5|sha1|تشفير|ضعيف|Hash/i.test(x.title));
    assert.ok(weak.length > 0, `${file}: weak hash finding disappeared`);
  }
  assert.ok(n >= 15, 'analyzable shapes: ' + n);
});

// ═══ ADV-5 ═════════════════════════════════════════════════
test('ADV-5: same finding → same strategy, whatever identifier is injected (UI engines)', () => {
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
  const TRIGGERS = ['sqlQuery', 'evalThing', 'passwordHint', 'logsDir', 'httpAgent', 'secretSanta', 'varName', 'catchAll',
    'noneLeft', 'authZ', 'cryptoBox', 'commandBus', 'googleId', 'stripeRef', 'innerHtmlCache', 'emptySlot', 'callbackFn'];
  const templates = [...JS_BLOCKS.map(b => [b, 'js']), ...PY_BLOCKS.map(b => [b, 'py'])];
  let compared = 0;
  for (const [block, lang] of templates) {
    const file = 'r.' + lang;
    const head = lang === 'py' ? 'import os, hashlib\nfrom flask import request\n' : "const crypto = require('crypto');\nconst { exec } = require('child_process');\n";
    const routes = name => {
      const m = new Map();
      for (const i of ctx.analyzeCode(head + block(name) + '\n', file)) {
        const t = [name, name.toUpperCase(), name[0].toUpperCase() + name.slice(1)].reduce((s, v) => s.split(v).join('<N>'), i.title);
        m.set(i.line + '|' + t, ctx.detectStrategy(i, lang));
      }
      return m;
    };
    const base = routes('total');
    for (const trig of TRIGGERS) {
      for (const [k, s] of routes(trig)) {
        if (!base.has(k)) continue;   // finding إضافية بسبب الاسم (كشف، لا routing)
        compared++;
        assert.strictEqual(s, base.get(k), `${lang} "${k}" with ${trig}: ${s} vs neutral ${base.get(k)}`);
      }
    }
  }
  assert.ok(compared > 100, 'compared findings: ' + compared);
});
