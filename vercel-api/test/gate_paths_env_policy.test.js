// ═══════════════════════════════════════════════════════
// سياسة البوابة، المسارات الجانبية، ونقل الأسرار — اختبارات موجبة وسالبة وسلوك قبل/بعد
// تشغيل:  node --test vercel-api/test/gate_paths_env_policy.test.js
//
// 1. [EVAL-JSON]      eval(x) ⇒ JSON.parse(x) مرفوض (يغيّر الناتج)، وeval على نص ثابت مقبول (الناتج نفسه).
// 2. [HASH-EPHEMERAL] md5 ⇒ sha256 خارج الاعتماد: مقبول لبصمة تبقى مفتاحًا داخليًا لـMap/Set، مرفوض غير ذلك.
// 3. [NO-BLIND]       learned_fixer: المُعمِّمات معطَّلة، المطابقة الحرفية باقية، ولا مستدعٍ إنتاجي.
// 4. [ONE-GATE]       HTMLRepair وfixers_orchestrator وSelfHealing.approve لا يكتبون ما ترفضه البوابة،
//    [HTML-SCRIPT]/[UNBOUND-IDENT] البوابة تفحص سكربتات HTML وتلتقط الكتابة على مُعرِّف غير معرَّف.
// 5. [ENV-REQUIRED]   الأسرار: لا process.env في كود متصفح (غير معرَّف هناك)، والسبب يذكر المتغير المطلوب والتدوير.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const { createRepairEngine } = require('../public/server_repair_adapter.js');
const { RealityOrchestrator: RO, FixVerifier: FV } = require('../public/server_engine_registration.js');
const E = createRepairEngine();
const gate = (b, a, f) => FV.verifyFix(b, a, f || 'a.js', (c, fn) => E.analyze(c, fn));
const REQ = 'const crypto = require("crypto");\n';

// يشغّل وحدة CommonJS ويُرجع ناتج call(exports) نصًّا (أو نوع الخطأ)
function runJS(code, call) {
  try {
    const m = { exports: {} };
    new Function('module', 'require', code)(m, require);
    return JSON.stringify(call(m.exports));
  } catch (e) { return 'ERR:' + e.constructor.name; }
}

// ═══ 1. eval ════════════════════════════════════════════
test('[EVAL-JSON] eval(x) ⇒ JSON.parse(x): الناتج يختلف لمدخلات عادية، والبوابة ترفض', () => {
  const b = 'function g(x) {\n  return eval(x);\n}\nmodule.exports = g;\n';
  const a = b.replace('eval(x)', 'JSON.parse(x)');
  // قبل/بعد: "2 + 2" يُقيَّم 4 ثم يصير خطأ؛ '{"a":1}' يرمي ثم ينجح؛ "[1,2]" متطابق
  assert.strictEqual(runJS(b, g => g('2 + 2')), '4');
  assert.strictEqual(runJS(a, g => g('2 + 2')), 'ERR:SyntaxError');
  assert.strictEqual(runJS(b, g => g('{"a":1}')), 'ERR:SyntaxError');
  assert.strictEqual(runJS(a, g => g('{"a":1}')), '{"a":1}');
  assert.strictEqual(runJS(b, g => g('[1,2]')), runJS(a, g => g('[1,2]')));
  const v = gate(b, a);
  assert.notStrictEqual(v.accepted, true);
  assert.match(String(v.reason), /^REJECTED_EVAL_FIX_UNPROVEN/);
});

test('[EVAL-JSON] eval على نص ثابت ⇒ التعبير نفسه: مقبول والناتج نفسه', () => {
  const b = 'function g() {\n  return eval("6 * 7");\n}\nmodule.exports = g;\n';
  const a = b.replace('eval("6 * 7")', '(6 * 7)');
  assert.strictEqual(runJS(a, g => g()), runJS(b, g => g()));
  assert.strictEqual(gate(b, a).accepted, true);
});

test('[EVAL-JSON] Python: eval ⇒ ast.literal_eval / json.loads مرفوضان (لا إثبات لصيغة المدخل)', () => {
  const b = 'import ast, json\ndef f(s):\n    return eval(s)\n';
  for (const r of ['ast.literal_eval(s)', 'json.loads(s)']) {
    const v = gate(b, b.replace('eval(s)', r), 'a.py');
    assert.notStrictEqual(v.accepted, true, r);
  }
});

// ═══ 2. md5 خارج الاعتماد ════════════════════════════════
const DEDUPE = alg => REQ + 'const seen = new Set();\nfunction once(v) {\n' +
  '  const k = crypto.createHash("' + alg + '").update(String(v)).digest("hex");\n' +
  '  if (seen.has(k)) return false;\n  seen.add(k);\n  return true;\n}\nmodule.exports = once;\n';

test('[HASH-EPHEMERAL] مفتاح داخلي لـSet محلي: مقبول، والسلوك المرئي قبل وبعد واحد', () => {
  const inputs = [1, 2, 1, 'x', 'x', '2', null, 'null'];
  assert.strictEqual(runJS(DEDUPE('sha256'), f => inputs.map(f)), runJS(DEDUPE('md5'), f => inputs.map(f)));
  assert.strictEqual(gate(DEDUPE('md5'), DEDUPE('sha256')).accepted, true);
});

test('[HASH-EPHEMERAL] بصمة تُرجَع (checksum): الناتج يتغيّر طولًا وقيمة، والبوابة ترفض', () => {
  const mk = alg => REQ + 'function sum(b) {\n  return crypto.createHash("' + alg + '").update(b).digest("hex");\n}\nmodule.exports = sum;\n';
  assert.strictEqual(JSON.parse(runJS(mk('md5'), f => f('abc'))).length, 32);
  assert.strictEqual(JSON.parse(runJS(mk('sha256'), f => f('abc'))).length, 64);
  const v = gate(mk('md5'), mk('sha256'));
  assert.notStrictEqual(v.accepted, true);
  assert.match(String(v.reason), /^REJECTED_CRYPTO_FIX_UNPROVEN/);
});

const LEAKS = {
  'المفاتيح تُكشف بـforEach': DEDUPE('md5').replace('module.exports = once;', 'function dump(cb) { seen.forEach(cb); }\nmodule.exports = { once, dump };'),
  'البصمة تُطبع أيضًا': DEDUPE('md5').replace('  if (seen.has(k)) return false;', '  console.log(k);\n  if (seen.has(k)) return false;'),
  'الحاوية let تُعاد': DEDUPE('md5').replace('const seen = new Set();', 'let seen = new Set();'),
  'الحاوية كائن عادي يُصدَّر': REQ + 'const seen = {};\nfunction once(v) {\n  const k = crypto.createHash("md5").update(String(v)).digest("hex");\n  if (seen[k]) return false;\n  seen[k] = 1;\n  return true;\n}\nmodule.exports = { once, seen };\n',
  'crypto ليس require("crypto")': DEDUPE('md5').replace('require("crypto")', 'require("./my-crypto")'),
};
for (const [name, b] of Object.entries(LEAKS)) {
  test(`[HASH-EPHEMERAL] سلبي — ${name}: مرفوض`, () => {
    const a = b.split('"md5"').join('"sha256"');
    assert.notStrictEqual(a, b);
    const v = gate(b, a);
    assert.notStrictEqual(v.accepted, true, v.reason);
  });
}

test('[HASH-EPHEMERAL] Python md5 ⇒ sha256 خارج الاعتماد: لا إثبات ⇒ مرفوض', () => {
  const b = 'import hashlib\ndef etag(b):\n    return hashlib.md5(b).hexdigest()\n';
  const v = gate(b, b.replace('hashlib.md5', 'hashlib.sha256'), 'a.py');
  assert.notStrictEqual(v.accepted, true, v.reason);
});

// ═══ 3. learned_fixer ═══════════════════════════════════
function uiCtx() {
  const noop = () => {};
  const ctx = { console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop, createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, navigator: {}, location: { search: '' } };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const m of fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8').matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (fs.existsSync(p)) try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* واجهة */ }
  }
  return ctx;
}
const UI = uiCtx();
const LP = type => ({ id: 'x-' + type, type, approved: true, confidence: 0.9, verified: 5, failures: 0, before: 'zz();', after: 'yy();' });

test('[NO-BLIND] learned_fixer: المُعمِّمات الخمسة معطَّلة بأسبابها والواجهة كما هي', () => {
  const G = UI.LearnedFixer.GENERALIZERS;
  assert.deepStrictEqual(Object.keys(G), ['accumulation', 'sql', 'secret', 'crypto', 'xss_dom']);
  for (const k of Object.keys(G)) {
    assert.strictEqual(G[k].enabled, false, k);
    assert.ok(typeof G[k].reason === 'string' && G[k].reason.length > 5, k);
  }
});

const LF_CASES = [
  ['accumulation', 'a.js', 'function f(o) {\n  let total = 10;\n  total = o.price;\n  return total;\n}\nmodule.exports = f;\n', f => f({ price: 5 })],
  ['secret', 'a.js', 'const API_KEY = "sk_live_abcdef123456";\nfunction k() {\n  return API_KEY.length;\n}\nmodule.exports = k;\n', f => f()],
  ['crypto', 'a.js', REQ + 'function h(password) {\n  return crypto.createHash("md5").update(password).digest("hex");\n}\nmodule.exports = h;\n', f => f('p')],
  ['xss_dom', 'a.js', 'function show(el, html) {\n  el.innerHTML = html;\n}\nmodule.exports = show;\n', null],
];
for (const [type, file, code] of LF_CASES) {
  test(`[NO-BLIND] learned_fixer ${type}: نمط معتمد من النوع لا يُنتج تحويلًا أعمى`, () => {
    const r = UI.LearnedFixer.apply(code, file, [LP(type)]);
    assert.strictEqual(r.applied, 0);
    assert.strictEqual(r.code, code);
  });
}

test('[NO-BLIND] learned_fixer: قبل التعطيل كان accumulation يغيّر الناتج (10+5=15 لا 5) — سبب التعطيل مقيس', () => {
  const [, , code, call] = LF_CASES[0];
  const blind = code.replace('total = o.price;', 'total += o.price;');
  assert.notStrictEqual(runJS(blind, call), runJS(code, call));
});

test('[NO-BLIND] learned_fixer: المطابقة الحرفية لنمط متعلَّم باقية (مصدر مرشّح فقط)', () => {
  const code = 'function f() {\n  zz();\n}\n';
  const r = UI.LearnedFixer.apply(code, 'a.js', [LP('anything')]);
  assert.strictEqual(r.applied, 1);
  assert.match(r.code, /yy\(\)/);
});

test('[NO-BLIND] learned_fixer بلا مستدعٍ إنتاجي — أي ربط جديد يجب أن يمرّ بالبوابة (tripwire)', () => {
  const hits = [];
  for (const f of fs.readdirSync(PUBLIC_DIR).filter(f => /\.(?:js|html)$/.test(f) && f !== 'learned_fixer.js')) {
    const src = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    if (/\bLearnedFixer\s*\.\s*(?:apply|smartApply)\s*\(/.test(src)) hits.push(f);
  }
  assert.deepStrictEqual(hits, [], 'صار LearnedFixer يُستدعى من: ' + hits.join(', ') + ' — تأكد أن ناتجه يمرّ بـFixVerifier قبل الكتابة ثم حدّث هذا الاختبار');
});

// ═══ 4. المسارات الجانبية ═════════════════════════════════
const PAGE = '<!doctype html>\n<html><body>\n<div id="out"></div>\n<script>\nfunction show(order, name) {\n  var total = 10;\n  total = order.price;\n' +
  '  document.getElementById("out").innerHTML = "<b>" + name + "</b>";\n  var q = "SELECT * FROM t WHERE id=" + order.id;\n  var r = eval(order.expr);\n  return total;\n}\n</script>\n</body></html>\n';

test('[ONE-GATE] HTMLRepair: لا تحويلات عمياء (+=، el. غير معرَّف، حذف eval/SQL بتعليق، process.env في المتصفح)', () => {
  const out = UI.HTMLRepair.fix(PAGE, 'p.html').fixed;
  assert.ok(!/total \+= order\.price/.test(out), '+=');
  assert.ok(!/^\s*el\./m.test(out), 'el غير معرَّف');
  assert.ok(!/\/\/ SECURITY: eval\(\) removed|\/\/ SQL: use parameterized/.test(out), 'حذف بتعليق');
  assert.ok(!/process\.env/.test(out), 'process.env في صفحة');
  assert.ok(/total = order\.price;/.test(out) && /eval\(order\.expr\)/.test(out), 'الكود الأصلي باقٍ');
});

test('[ONE-GATE] مسار الخادم على صفحة HTML: لا SAFE_AUTO_FIX بتحويل أعمى', async () => {
  const o = await RO.runPipelineAsync(PAGE, 'p.html', { useFallbackChain: true });
  const patch = o.decision && o.decision.patch;
  if (patch) {
    assert.ok(!/total \+= order\.price/.test(patch));
    assert.ok(!/^\s*el\./m.test(patch));
  }
});

test('[HTML-SCRIPT] البوابة: سكربت مضمَّن كان سليمًا وانكسر ⇒ رفض', () => {
  const an = c => (/innerHTML/.test(c) ? [{ type: 'XSS', title: 'XSS innerHTML', line: 8, sev: 'h' }] : []);
  const a = PAGE.replace('  return total;', '  return total;;{').replace('.innerHTML', '.textContent');
  const v = FV.verifyFix(PAGE, a, 'p.html', an, { allowUnverifiedLanguages: true });
  assert.notStrictEqual(v.accepted, true);
  assert.match(String(v.reason), /^REJECTED_SYNTAX_BROKEN \[html-script/);
});

test('[UNBOUND-IDENT] البوابة: كتابة على مُعرِّف جديد غير معرَّف (el.textContent) ⇒ رفض — JS وسكربت HTML', () => {
  const an = c => (/innerHTML/.test(c) ? [{ type: 'XSS', title: 'XSS innerHTML', line: 2, sev: 'h' }] : []);
  const js = 'function f(n) {\n  document.body.innerHTML = n;\n}\nmodule.exports = f;\n';
  const v1 = FV.verifyFix(js, js.replace('document.body.innerHTML = n;', 'el.textContent = n;'), 'a.js', an);
  assert.match(String(v1.reason), /^REJECTED_UNBOUND_IDENTIFIER: el/);
  assert.strictEqual(FV.isHarmfulRejection(v1.reason), true);
  const v2 = FV.verifyFix(PAGE, PAGE.replace('document.getElementById("out").innerHTML = "<b>" + name + "</b>";', 'el.textContent = String(name);'),
    'p.html', c => (/innerHTML/.test(c) ? [{ type: 'XSS', title: 'XSS innerHTML', line: 8, sev: 'h' }] : []), { allowUnverifiedLanguages: true });
  assert.match(String(v2.reason), /^REJECTED_UNBOUND_IDENTIFIER: el/);
  // موجب: الكتابة على عنصر معروف تبقى مقبولة
  assert.strictEqual(FV.verifyFix(js, js.replace('document.body.innerHTML = n;', 'document.body.textContent = n;'), 'a.js', an).accepted, true);
});

function orchCtx(withFV) {
  const list = ['acorn.min.js', 'analyzer.js', 'security_scanner.js', 'secret_detector.js', 'knowledge_base.js',
    'taint_core.js', 'taint_js.js'].concat(withFV ? ['fix_verifier.js'] : []).concat(['fixers_orchestrator.js']);
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} }, window: {}, global: {}, F: {}, R: {} });
  for (const f of list) vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
const EVAL_FILE = 'function run(x) {\n  return eval(x);\n}\nmodule.exports = run;\n';
const HOSTILE_FIXER = 'CommandInjectionFixer = { canFix: () => true, fix: c => ({ changed: true, fixed: c.replace("eval(x)", "/* removed */ 0") }) };';

test('[ONE-GATE] fixers_orchestrator: ما تقبله بوابته المحلية وترفضه FixVerifier لا يُكتب', () => {
  const ctx = orchCtx(true);
  vm.runInContext(HOSTILE_FIXER, ctx);
  const F = { 'a.js': EVAL_FILE }, R = { 'a.js': { issues: ctx.analyzeCode(EVAL_FILE, 'a.js') } };
  assert.ok(R['a.js'].issues.length > 0, 'tripwire');
  const local = ctx._verifyFix(EVAL_FILE, EVAL_FILE.replace('eval(x)', '/* removed */ 0'), R['a.js'].issues, 'a.js', {});
  assert.strictEqual(local.accepted, true, 'tripwire: البوابة المحلية وحدها كانت ستقبل المحو الشكلي');
  const out = ctx.applySpecializedFixers(F, R);
  assert.strictEqual(F['a.js'], EVAL_FILE);
  assert.strictEqual(out.totalFixed, 0);
  assert.match(String(out.rejected['a.js'][0].reason), /EVAL_FIX_UNPROVEN/);
});

test('[ONE-GATE] fixers_orchestrator بلا fix_verifier: لا كتابة (Fail-Closed)', () => {
  const ctx = orchCtx(false);
  vm.runInContext(HOSTILE_FIXER, ctx);
  const F = { 'a.js': EVAL_FILE }, R = { 'a.js': { issues: ctx.analyzeCode(EVAL_FILE, 'a.js') } };
  const out = ctx.applySpecializedFixers(F, R);
  assert.strictEqual(F['a.js'], EVAL_FILE);
  assert.match(String(out.rejected['a.js'][0].reason), /VERIFIER_UNAVAILABLE/);
});

function healCtx() {
  const ctx = orchCtx(true);
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'self_healing_engine.js'), 'utf8'), ctx, { filename: 'self_healing_engine.js' });
  vm.runInContext(`SelfHealing = window.SelfHealing;
    SelfHealing.registerPatchProvider((c, p) => p.patchTo ? { patchedCode: p.patchTo, confidence: 'HIGH', reason: 'r', changedCount: 1 } : null);`, ctx);
  return ctx;
}
const PASS_TESTS = '() => ({ syntax:{pass:true}, engines:{}, taint:{pass:true}, regression:{pass:true}, security:{pass:true} })';

test('[ONE-GATE] SelfHealing.approve: اختباراته واعتماد الإنسان لا يكفيان — ما ترفضه البوابة لا يُطبَّق', () => {
  const ctx = healCtx();
  ctx.__code = EVAL_FILE; ctx.__bad = EVAL_FILE.replace('eval(x)', '/* removed */ 0');
  const out = vm.runInContext(`(() => {
    const r = SelfHealing.heal({ type: 'ENGINE_ERROR', engine: 'e', fileName: 'a.js', code: __code, patchTo: __bad, testRunner: ${PASS_TESTS} });
    let called = false;
    const ap = SelfHealing.approve(r.id, __bad, () => { called = true; }, { actor: 'naif' });
    return JSON.stringify({ heal: r.status, ap: ap.status, err: ap.error || '', called });
  })()`, ctx);
  const o = JSON.parse(out);
  assert.strictEqual(o.heal, 'PENDING_REVIEW', 'tripwire: اختباراته الخاصة مرّت');
  assert.strictEqual(o.ap, 'REJECTED');
  assert.strictEqual(o.called, false, 'applyCallback نودي رغم رفض البوابة');
  assert.match(o.err, /البوابة رفضت|EVAL_FIX_UNPROVEN/);
});

test('[ONE-GATE] SelfHealing.approve: إصلاح تقبله البوابة يُطبَّق كما كان', () => {
  const ctx = healCtx();
  ctx.__code = 'function g() {\n  return eval("6 * 7");\n}\nmodule.exports = g;\n';
  ctx.__good = ctx.__code.replace('eval("6 * 7")', '(6 * 7)');
  const o = JSON.parse(vm.runInContext(`(() => {
    const r = SelfHealing.heal({ type: 'ENGINE_ERROR', engine: 'e', fileName: 'a.js', code: __code, patchTo: __good, testRunner: ${PASS_TESTS} });
    let applied = null;
    const ap = SelfHealing.approve(r.id, __good, c => { applied = c; }, { actor: 'naif' });
    return JSON.stringify({ ap: ap.status, err: ap.error || '', applied });
  })()`, ctx));
  assert.strictEqual(o.ap, 'APPROVED', o.err);
  assert.strictEqual(o.applied, ctx.__good);
});

// ═══ 5. الأسرار ═══════════════════════════════════════

const BROWSER = 'const API_KEY = "sk_live_abcdef1234567890abcd";\n' +
  'document.getElementById("go").addEventListener("click", () => fetch("/api?k=" + API_KEY));\n';
test('[ENV-REQUIRED] كود متصفح: لا process.env (غير معرَّف هناك) — لا تعديل والسبب مُسجَّل، والبوابة ترفضه من أي مصدر', () => {
  const out = E.repair(BROWSER, E.analyze(BROWSER, 'app.js'), 'app.js');
  assert.strictEqual(out.repaired, BROWSER);
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} } });
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'repair_engine.js'), 'utf8'), ctx);
  const issues = E.analyze(BROWSER, 'app.js');
  const rc = ctx.repairCode(BROWSER, issues, 'app.js');
  assert.ok((rc.declined || []).some(d => /^SECRET_IN_BROWSER_CODE/.test(d.reason)), JSON.stringify(rc.declined));
  const v = gate(BROWSER, BROWSER.replace('"sk_live_abcdef1234567890abcd"', 'process.env.API_KEY'));
  assert.notStrictEqual(v.accepted, true);
  assert.match(String(v.reason), /كود متصفح/);
  // قبل/بعد في «متصفح» (لا process): الأصل يعمل، والبديل يرمي ReferenceError
  const sandbox = () => ({ document: { getElementById: () => ({ addEventListener: (e, cb) => cb() }) }, fetch: () => {} });
  assert.doesNotThrow(() => vm.runInNewContext(BROWSER, sandbox()));
  assert.throws(() => vm.runInNewContext(BROWSER.replace('"sk_live_abcdef1234567890abcd"', 'process.env.API_KEY'), sandbox()), /process is not defined/);
});

test('[ENV-REQUIRED] JS خادم: process.env مقبول، والسبب يذكر المتغير المطلوب والتدوير، والسلوك مع المتغير نفسه', () => {
  const JS = 'const jwt = require("jsonwebtoken");\nconst API_KEY = "sk_live_abcdef1234567890abcd";\nfunction k() {\n  return API_KEY.length;\n}\nmodule.exports = k;\n';
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} } });
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'repair_engine.js'), 'utf8'), ctx);
  const rc = ctx.repairCode(JS, E.analyze(JS, 's.js'), 's.js');
  assert.match(rc.repaired, /const API_KEY = process\.env\.API_KEY;/);
  const reasons = (rc.repairs || []).map(r => String(r.reason || r.fix || '')).join(' | ');
  assert.match(reasons, /يتطلب ضبط متغير البيئة API_KEY/);
  assert.match(reasons, /تدوير القيمة القديمة/);
  const saved = process.env.API_KEY;
  process.env.API_KEY = 'sk_live_abcdef1234567890abcd';
  try {
    const runK = c => { const m = { exports: {} }; new Function('module', 'require', 'process', c)(m, n => (n === 'jsonwebtoken' ? {} : require(n)), process); return m.exports(); };
    assert.strictEqual(runK(rc.repaired), runK(JS));
  } finally { if (saved === undefined) delete process.env.API_KEY; else process.env.API_KEY = saved; }
});
