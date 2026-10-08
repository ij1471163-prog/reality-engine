// ═══════════════════════════════════════════════════════
// P2 — Security Finding No-Drop Guarantee (reality_orchestrator.js)
// تشغيل:  node --test vercel-api/test/security_no_drop.test.js
//
// أي Security Finding ما زالت موجودة في الحالة النهائية (بعد repair → verify →
// re-analysis) يجب أن تكون في aiNeeded، مهما كانت severity أو strategy، وسواء
// أبلغ عنها محرك الإصلاح أم لا (بدون strategy، strategy غير مدعومة، إصلاح مرفوض
// أو فاشل). Non-security m/l لا تُجبر إلى AI بسبب هذا الضمان.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const RO_SRC = fs.readFileSync(path.join(PUBLIC_DIR, 'reality_orchestrator.js'), 'utf8');

// نسخة orchestrator معزولة لكل اختبار (الـmodule الأصلي singleton)
function freshOrchestrator() {
  const ctx = { console, window: {} };
  vm.createContext(ctx);
  vm.runInContext(RO_SRC, ctx, { filename: 'reality_orchestrator.js' });
  return ctx.window.RealityOrchestrator;
}

// findings بنفس شكل المحللات الحقيقية
const F = {
  httpM:   { type: 'INSECURE_HTTP', sev: 'm', line: 2, title: '🟡 HTTP بدون HTTPS', ev: 'fetch("http://x")', cAct: 'INSECURE_HTTP' },
  auditL:  { type: 'CWE_778', sev: 'l', line: 4, title: '🟡 No Audit Logging (CWE-778)', ev: 'app.post("/x", h)', cwe: 'CWE-778', cAct: 'CWE-778' },
  cookieL: { type: 'INSECURE_COOKIE', sev: 'l', line: 5, title: '🔵 Cookie بدون Secure', ev: 'res.cookie("a", b)', cAct: 'INSECURE_COOKIE' },
  evalC:   { type: 'security', sev: 'c', line: 1, title: '🔴 eval() خطير جداً', ev: 'eval(x)', cAct: 'ثغرة حرجة' },
  secretH: { type: 'js', sev: 'h', line: 6, title: '🟠 JWT Secret مكشوف — استخدم process.env', ev: 'const s = "abc"', cAct: 'CWE-798 JWT' },
  authM:   { type: 'CWE_306', sev: 'm', line: 7, title: '🟡 Endpoint May Lack Auth (CWE-306)', ev: 'app.get("/a", (req,res)=>{', cwe: 'CWE-306', strategy: 'MISSING_AUTH' },
  bugM:    { type: 'bug', sev: 'm', line: 3, title: 'استخدم ===', ev: 'a == b', cAct: 'مشكلة محتملة' },
  bugL:    { type: 'dataflow', sev: 'l', line: 8, title: '🔵 Dead Assignment: x معرّف لكن لا يُستخدم', ev: 'let x = 1', cAct: 'Dead Code' },
};
const CODE = 'eval(x)\nfetch("http://x")\na == b\napp.post("/x", h)\nres.cookie("a", b)\nconst s = "abc"\napp.get("/a", (req,res)=>{\nlet x = 1';

// يبني orchestrator بمحلل/مصلح/متحقق مزيفين.
//   initial:  ما يبلّغه المحلل أولًا
//   after:    ما يبلّغه بعد الـpatch (أو 'throw' لفشل re-analysis)
//   repair:   (code, issues) => نتيجة المصلح
function pipeline({ initial, after, repair, verify }) {
  const RO = freshOrchestrator();
  let calls = 0;
  RO.registerEngine('an', RO.EngineType.ANALYZER, () => {
    if (calls++ === 0) return initial;
    if (after === 'throw') throw new Error('analyzer crashed');
    return after;
  }, ['*']);
  RO.registerEngine('rp', RO.EngineType.REPAIR, (code, issues) => repair(code, issues), ['*']);
  RO.registerEngine('vf', RO.EngineType.VERIFIER, verify || (() => ({ valid: true, improved: true })), ['code-verification']);
  return { RO, run: opts => RO.runPipeline(CODE, 'a.js', Object.assign({ useFallbackChain: true }, opts)) };
}
// مصلح يغيّر الكود (patch مقبول) دون أن يبلّغ AI عن أي شيء
const patchesSomethingElse = code => ({ repaired: code + '\n// fixed', repairs: [{ line: 99, strategy: 'VAR_USAGE' }], aiNeeded: [] });
// مصلح يرفض: لا تغيير ولا aiNeeded (strategy رفضت الـdeterministic repair)
const refuses = code => ({ repaired: code, repairs: [], aiNeeded: [], rejected: [{ reason: 'REFUSED' }] });

const aiOf = out => (out.decision.meta && out.decision.meta.aiNeeded) || out.phases.fallback.aiNeeded;
const has = (ai, f) => ai.some(e => e.title === f.title && e.line === f.line);

// ═══ 1. Security m ═══════════════════════════════════════
test('security m + no strategy (engine never reports it) → aiNeeded', () => {
  const out = pipeline({ initial: [F.httpM, F.bugM], after: [F.httpM], repair: patchesSomethingElse }).run();
  const ai = aiOf(out);
  assert.ok(has(ai, F.httpM));
  const e = ai.find(x => x.title === F.httpM.title);
  assert.strictEqual(e.securityNoDrop, true);
  assert.match(e.reason, /SECURITY_UNRESOLVED/);
  assert.strictEqual(e.strategy, null);
  assert.strictEqual(e.sev, 'm');
  assert.strictEqual(out.decision.meta.fileFullyResolved, false);
});

test('security m + refusing strategy (no patch) → aiNeeded', () => {
  const out = pipeline({ initial: [F.httpM], after: [F.httpM], repair: refuses }).run();
  assert.ok(has(aiOf(out), F.httpM));
});

test('security m + misrouted / unsupported explicit strategy → aiNeeded', () => {
  for (const strategy of ['NOT_A_STRATEGY', 'XSS_INNER_HTML', 'ACCUMULATION']) {
    const f = Object.assign({}, F.httpM, { strategy });
    const out = pipeline({ initial: [f], after: [f], repair: patchesSomethingElse }).run();
    const e = aiOf(out).find(x => x.title === f.title);
    assert.ok(e, strategy);
    assert.strictEqual(e.strategy, strategy, 'explicit strategy carried for the AI step');
  }
});

// ═══ 2. Security l — نفس الحالات ════════════════════════
for (const f of [F.auditL, F.cookieL]) {
  test(`security l (${f.type}) + no strategy / refusing / unsupported → aiNeeded`, () => {
    assert.ok(has(aiOf(pipeline({ initial: [f], after: [f], repair: patchesSomethingElse }).run()), f));
    assert.ok(has(aiOf(pipeline({ initial: [f], after: [f], repair: refuses }).run()), f));
    const g = Object.assign({}, f, { strategy: 'XSS_INNER_HTML' });
    assert.ok(has(aiOf(pipeline({ initial: [g], after: [g], repair: patchesSomethingElse }).run()), g));
  });
}

// ═══ 3. الـfixer يحاول ويفشل ═════════════════════════════
test('detected, fixer patch verifies but re-analysis still reports it → stays in aiNeeded', () => {
  const out = pipeline({
    initial: [F.evalC, F.httpM], after: [F.evalC, F.httpM],
    repair: code => ({ repaired: code.replace('eval(x)', 'eval(x) '), repairs: [{ line: 1, strategy: 'EVAL_USAGE' }], aiNeeded: [] }),
  }).run();
  assert.ok(has(aiOf(out), F.evalC));
  assert.ok(has(aiOf(out), F.httpM));
});

test('fixer patch rejected by verifier → finding does not disappear', () => {
  const out = pipeline({
    initial: [F.secretH], after: [F.secretH], repair: patchesSomethingElse,
    verify: () => ({ valid: false, improved: false, reason: 'broken' }),
  }).run();
  assert.ok(has(aiOf(out), F.secretH));
});

test('fixer throws → finding does not disappear', () => {
  const out = pipeline({ initial: [F.authM], after: [F.authM], repair: () => { throw new Error('fixer crashed'); } }).run();
  assert.ok(has(aiOf(out), F.authM));
});

// ═══ 4. لا إضافات زائدة ══════════════════════════════════
test('security finding proven fixed by re-analysis is not added', () => {
  const out = pipeline({ initial: [F.httpM, F.evalC], after: [F.evalC], repair: patchesSomethingElse }).run();
  const ai = aiOf(out);
  assert.ok(!has(ai, F.httpM));
  assert.ok(has(ai, F.evalC));
});

test('finding already reported by the repair engine is not duplicated', () => {
  const out = pipeline({
    initial: [F.authM], after: [F.authM],
    repair: code => ({ repaired: code + '\n//', repairs: [{ line: 99 }],
      aiNeeded: [{ line: F.authM.line, title: F.authM.title, strategy: 'MISSING_AUTH', reason: 'x', ev: F.authM.ev }] }),
  }).run();
  const ai = aiOf(out).filter(e => e.title === F.authM.title);
  assert.strictEqual(ai.length, 1);
  assert.ok(!ai[0].securityNoDrop, 'the engine entry is kept as is');
});

test('two identical security findings → two aiNeeded entries', () => {
  const a = Object.assign({}, F.httpM), b = Object.assign({}, F.httpM, { line: 9 });
  const out = pipeline({ initial: [a, b], after: [a, b], repair: patchesSomethingElse }).run();
  assert.strictEqual(aiOf(out).filter(e => e.title === F.httpM.title).length, 2);
});

// ═══ 5. Non-security m/l لا تُجبر إلى AI ══════════════════
test('only non-security m/l leftovers → SAFE_AUTO_FIX, fully resolved, empty aiNeeded', () => {
  const out = pipeline({ initial: [F.httpM, F.bugM, F.bugL], after: [F.bugM, F.bugL], repair: patchesSomethingElse }).run();
  assert.strictEqual(out.decision.decision, 'SAFE_AUTO_FIX');
  assert.deepStrictEqual([...aiOf(out)], []);
  assert.strictEqual(out.decision.meta.fileFullyResolved, true);
});

test('title alone never makes a finding security (identifier injection)', () => {
  const t = { type: 'dataflow', sev: 'l', line: 2, title: '🔵 Dead Assignment: sqlInjectionSecret معرّف لكن لا يُستخدم', ev: 'let s', cAct: 'Dead Code' };
  const u = { type: 'bug', sev: 'm', line: 3, title: 'XSS eval password CWE-79 secret', ev: 'a', cAct: 'مشكلة محتملة' };
  const out = pipeline({ initial: [t, u], after: [t, u], repair: patchesSomethingElse }).run();
  assert.deepStrictEqual([...aiOf(out)], []);
  assert.strictEqual(out.decision.decision, 'SAFE_AUTO_FIX');
});

// ═══ 6. h/c لا تتراجع، و SAFE_AUTO_FIX يبقى "patch آمن" ═══
test('security c/h leftovers stay in aiNeeded; verified patch still SAFE_AUTO_FIX (partial)', () => {
  const out = pipeline({ initial: [F.evalC, F.secretH, F.bugM], after: [F.evalC, F.secretH, F.bugM], repair: patchesSomethingElse }).run();
  assert.strictEqual(out.decision.decision, 'SAFE_AUTO_FIX');
  assert.strictEqual(out.decision.meta.partial, true);
  assert.strictEqual(out.decision.meta.fileFullyResolved, false);
  assert.ok(has(aiOf(out), F.evalC) && has(aiOf(out), F.secretH));
  assert.ok(!has(aiOf(out), F.bugM));
});

test('no verified patch + only security leftovers → AI_SUGGESTION carrying them', () => {
  const out = pipeline({ initial: [F.httpM, F.auditL], after: [F.httpM, F.auditL], repair: refuses }).run();
  assert.strictEqual(out.decision.decision, 'AI_SUGGESTION');
  assert.ok(has(aiOf(out), F.httpM) && has(aiOf(out), F.auditL));
});

// ═══ 7. reanalysisFailed — محافظ ══════════════════════════
test('reanalysisFailed: last known security findings are kept (stale), file not fully resolved', () => {
  const out = pipeline({ initial: [F.httpM, F.evalC, F.bugM], after: 'throw', repair: patchesSomethingElse }).run();
  const fb = out.phases.fallback;
  assert.strictEqual(fb.reanalysisFailed, true);
  assert.strictEqual(fb.remainingIssuesStale, true);
  assert.ok(has(aiOf(out), F.httpM) && has(aiOf(out), F.evalC));
  assert.ok(!has(aiOf(out), F.bugM));
  assert.strictEqual(out.decision.meta.fileFullyResolved, false);
});

test('runRepair path (no fallback chain) applies the same guarantee', () => {
  const p = pipeline({ initial: [F.httpM, F.bugL], after: [F.httpM, F.bugL], repair: patchesSomethingElse });
  const out = p.run({ useFallbackChain: false });
  const ai = out.phases.repair.aiNeeded;
  assert.ok(has(ai, F.httpM));
  assert.ok(!has(ai, F.bugL));
});

// ═══ 8. تكامل: محركات السيرفر الحقيقية ═══════════════════
const { RealityOrchestrator: SERVER_RO } = require(path.join(PUBLIC_DIR, 'server_engine_registration.js'));
const REAL = {
  'mix.js': 'const API_KEY = "sk_live_abcdefghijklmnop1234";\nconst password = "hunter2hunter2";\napp.get(\'/u\', (req,res)=>{\n  const id = req.query.id;\n  db.query("SELECT * FROM users WHERE id=" + id);\n  res.send(req.query.name);\n  eval(req.body.code);\n  fetch("http://api.example.com/data");\n  console.log("token", password);\n});\n',
  'c.php':  '<?php\n$id = $_GET[\'id\'];\nmysqli_query($conn, "SELECT * FROM t WHERE id=" . $id);\necho $_GET[\'name\'];\n$p = md5($id);\n',
  'e.c':    'int main(){ char b[10]; gets(b); strcpy(b, x); printf(x); return 0; }\n',
  'sqli.py': 'def get_user(user_id):\n    query = "SELECT * FROM users WHERE id=" + user_id\n    cursor.execute(query)\n    return cursor.fetchall()\n',
};
const CWE = /^CWE[-_]\d+/i;
const looksSecurity = i => /^(security|secret|taint|XSS|SQL_INJECTION|CMD_INJECTION|INSECURE_HTTP|WEAK_CRYPTO)$/i.test(String(i.type)) ||
  CWE.test(String(i.type)) || CWE.test(String(i.cwe || '')) || CWE.test(String(i.cAct || '').trim());

for (const [file, code] of Object.entries(REAL)) {
  test(`server pipeline ${file}: every security finding left after repair is in aiNeeded`, () => {
    const out = SERVER_RO.runPipeline(code, file, { useFallbackChain: true });
    const fb = out.phases.fallback;
    const left = fb.remainingIssues.filter(looksSecurity);
    assert.ok(left.length > 0, 'precondition: fixture keeps unresolved security findings');
    for (const s of left) assert.ok(has(fb.aiNeeded, s), `${file}: dropped "${s.title}" line ${s.line}`);
    if (out.decision.meta && 'fileFullyResolved' in out.decision.meta) {
      assert.strictEqual(out.decision.meta.fileFullyResolved, false);
    }
  });
}

test('server pipeline: fully repaired security finding leaves aiNeeded empty', () => {
  const code = 'const { exec } = require(\'child_process\');\napp.get(\'/x\',(req,res)=>{ const cmd = req.query.c; exec(cmd); });\n';
  const out = SERVER_RO.runPipeline(code, 'cmd.js', { useFallbackChain: true });
  assert.strictEqual(out.decision.decision, 'SAFE_AUTO_FIX');
  assert.deepStrictEqual([...out.phases.fallback.aiNeeded], []);
  assert.strictEqual(out.decision.meta.fileFullyResolved, true);
});

// ═══ 9. Browser path: الغلاف يرمي aiNeeded الخاص بـrepairCode ═══
// index.html يسجّل repair-engine بـ aiNeeded: [] — الضمان المركزي يعيد
// الـsecurity findings المتبقية (مثل MISSING_AUTH من P1).
test('browser-style wrapper (aiNeeded: []) still keeps MISSING_AUTH (P1 explicit) in final aiNeeded', () => {
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
  ctx.GhostMode = undefined;
  const RO = freshOrchestrator();
  RO.registerEngine('ui-analyzer', RO.EngineType.ANALYZER, (c, f) => ctx.analyzeCode(c, f), ['*']);
  RO.registerEngine('repair-engine', RO.EngineType.REPAIR, (c, i, f) => {
    const r = ctx.repairCode(c, i, f);
    return { repaired: r && r.repaired, repairs: (r && r.repairs) || [], aiNeeded: [] };
  }, ['*']);
  RO.registerEngine('vf', RO.EngineType.VERIFIER, () => ({ valid: true, improved: true }), ['code-verification']);
  const code = "const express=require('express');const app=express();\napp.post('/eval', (req,res)=>{\n  res.send('ok');\n});\n";
  const out = RO.runPipeline(code, 'r.js', { useFallbackChain: true });
  const ai = out.phases.fallback.aiNeeded.filter(e => e.line === 2);
  assert.ok(ai.some(e => e.strategy === 'MISSING_AUTH'), 'route auth finding kept with its explicit strategy');
  assert.ok(!ai.some(e => e.strategy === 'EVAL_USAGE'));
});

// ═══ 10. reanalysisFailed يمنع SAFE_AUTO_FIX ═════════════
// لا إثبات أن الـverified patch أصلح الحالة النهائية → NEEDS_VERIFY
// (القرار الموجود لـ"patch موجود، التحقق غير مكتمل")، مع بقاء الـpatch و aiNeeded.
test('verified patch + reanalysisFailed → not SAFE_AUTO_FIX (NEEDS_VERIFY, patch kept)', () => {
  const out = pipeline({ initial: [F.bugM], after: 'throw', repair: patchesSomethingElse }).run();
  const d = out.decision;
  assert.notStrictEqual(d.decision, 'SAFE_AUTO_FIX');
  assert.strictEqual(d.decision, 'NEEDS_VERIFY');
  assert.strictEqual(typeof d.patch, 'string', 'verified patch is carried, not lost');
  assert.strictEqual(d.meta.reanalysisFailed, true);
  assert.strictEqual(d.meta.remainingIssuesStale, true);
  assert.strictEqual(d.meta.fileFullyResolved, false);
  assert.strictEqual(d.meta.safeAutoFixWithheld, true);
  assert.strictEqual(out.phases.fallback.reanalysisFailed, true);
});

test('verified patch + successful re-analysis + no security leftovers → still SAFE_AUTO_FIX', () => {
  const out = pipeline({ initial: [F.httpM, F.bugM], after: [], repair: patchesSomethingElse }).run();
  assert.strictEqual(out.decision.decision, 'SAFE_AUTO_FIX');
  assert.strictEqual(out.decision.meta.fileFullyResolved, true);
  assert.strictEqual(out.phases.fallback.reanalysisFailed, false);
  assert.ok(!('safeAutoFixWithheld' in out.decision.meta));
});

test('security leftovers + successful re-analysis → stay in aiNeeded', () => {
  const out = pipeline({ initial: [F.httpM, F.auditL, F.bugM], after: [F.httpM, F.auditL], repair: patchesSomethingElse }).run();
  assert.strictEqual(out.phases.fallback.reanalysisFailed, false);
  assert.ok(has(aiOf(out), F.httpM) && has(aiOf(out), F.auditL));
  assert.strictEqual(out.decision.meta.fileFullyResolved, false);
});

test('security leftovers + reanalysisFailed → stay in aiNeeded and no SAFE_AUTO_FIX', () => {
  const out = pipeline({ initial: [F.httpM, F.evalC, F.auditL], after: 'throw', repair: patchesSomethingElse }).run();
  assert.strictEqual(out.decision.decision, 'NEEDS_VERIFY');
  const ai = out.decision.meta.aiNeeded;
  assert.ok(has(ai, F.httpM) && has(ai, F.evalC) && has(ai, F.auditL));
  assert.strictEqual(out.decision.meta.fileFullyResolved, false);
});

test('reanalysisFailed gate also covers the runRepair path and the Claude path', () => {
  const p = pipeline({ initial: [F.bugM], after: 'throw', repair: patchesSomethingElse });
  const out = p.run({ useFallbackChain: false });
  assert.strictEqual(out.phases.repair.reanalysisFailed, true);
  assert.strictEqual(out.decision.decision, 'NEEDS_VERIFY');
  // decide() مباشرة: verified deterministic patch + Claude engine patch، re-analysis فاشلة
  const RO = p.RO;
  const fb = { phase: 'FALLBACK', reanalysisFailed: true, verifiedCode: 'x2', safeRepairs: [{ line: 1 }],
    aiNeeded: [{ line: 1, title: 't' }], verifyResult: { valid: true, improved: true }, remainingIssues: [] };
  const d = RO.decide(fb, { valid: true, improved: true },
    { decision: 'AI_SUGGESTION', patch: 'x3', source: 'claude-repair-engine' });
  assert.notStrictEqual(d.decision, 'SAFE_AUTO_FIX');
  assert.strictEqual(d.meta.fileFullyResolved, false);
  const ok = RO.decide(Object.assign({}, fb, { reanalysisFailed: false }), null, null);
  assert.strictEqual(ok.decision, 'SAFE_AUTO_FIX', 'same input without reanalysisFailed is unchanged');
});
