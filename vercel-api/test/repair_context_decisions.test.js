// ═══════════════════════════════════════════════════════
// قرارات الإصلاح حسب السياق: سلامة الملف وصحة سلوكه قبل عدد البلاغات المُزالة
// تشغيل:  node --test vercel-api/test/repair_context_decisions.test.js
//
// كل حالة هنا واحدة من ثلاث:
//   يُصلَح     — الدليل كافٍ والتغيير محدود ويُثبت أنه لا يغيّر السلوك (ويُشغَّل الكود قبل/بعد حيث أمكن)
//   يُرفض      — التعديل المتاح يغيّر سلوكًا صحيحًا ⇒ لا تعديل، والسبب والثقة مُسجَّلان
//   بديل أأمن  — الاستبدال «المعتاد» خاطئ، والمُطبَّق بديلٌ يحفظ السلوك (تهريب بدل textContent، randomBytes بدل sha256…)
//
// المسار المُختبَر هو مسار الخادم الفعلي: server_repair_adapter (repairCode + XSSFixer + البوابة)
// ثم RealityOrchestrator لسجل القرار.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const acorn = require('../public/acorn.min.js');
const { createRepairEngine } = require('../public/server_repair_adapter.js');
const { RealityOrchestrator: R } = require('../public/server_engine_registration.js');

const E = createRepairEngine();
const parses = code => { acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); return true; };
const lineOf = (code, n) => code.split('\n')[n - 1];
const issue = (code, line, title, extra) => Object.assign({ line, sev: 'c', type: 'security', title, ev: lineOf(code, line).trim() }, extra || {});
const repair = (code, issues, file) => E.repair(code, issues, file || 'a.js');
const reasonOf = (r, re) => (r.declined || []).find(d => re.test(d.reason));
// يشغّل الكود في vm نظيف ويُرجع ناتج call (أو الخطأ)
function exec(code, call, sandbox) {
  try { return { ok: true, value: vm.runInNewContext(code + '\n;' + call, Object.assign({ module: {}, require: () => ({}) }, sandbox || {})) }; }
  catch (e) { return { ok: false, error: e.constructor.name + ': ' + e.message }; }
}

// ═══ 1. var → let ═══════════════════════════════════════
const VAR_TITLE = '🔵 استخدام var — استخدم let أو const';
const VAR_FIX = {
  'داخل دالة، كل الاستخدامات بعد التعريف في الكتلة نفسها':
    ['function f(u) {\n  var q = "SELECT " + u;\n  return q.length;\n}\nmodule.exports = f;\n', 2, 'f("ab")'],
  'عدّاد حلقة يُستعمل داخل الحلقة فقط':
    ['function f(a) {\n  let s = 0;\n  for (var i = 0; i < a.length; i++) {\n    s += a[i];\n  }\n  return s;\n}\nmodule.exports = f;\n', 3, 'f([1,2,3])'],
  'النص يحوي كلمة var: تُبدَّل الكلمة المفتاحية فقط':
    ['function f() {\n  var s = "var x";\n  return s;\n}\nmodule.exports = f;\n', 2, 'f()'],
};
for (const [name, [code, line, call]] of Object.entries(VAR_FIX)) {
  test(`[VAR+] ${name}: يُحوَّل، والسلوك مطابق عند التشغيل`, () => {
    const r = repair(code, [issue(code, line, VAR_TITLE, { sev: 'l', type: 'js' })]);
    assert.notStrictEqual(r.repaired, code, 'لم يُحوَّل');
    assert.strictEqual(lineOf(r.repaired, line), lineOf(code, line).replace(/\bvar\b/, 'let'));
    const a = exec(code, call), b = exec(r.repaired, call);
    assert.ok(a.ok && b.ok, JSON.stringify({ a, b }));
    assert.deepStrictEqual(b.value, a.value);
  });
}

// [VAR-] لكل حالة: الكود الأصلي يعمل، والتحويل الأعمى (أول var ⇒ let) يكسره أو يغيّر ناتجه — مقيس
const VAR_KEEP = {
  'يُستعمل بعد الكتلة':
    ['function f(x) {\n  if (x) {\n    var y = 1;\n  }\n  return y;\n}\n', 3, 'f(1)', /^VAR_SCOPE_ESCAPE/],
  'عدّاد يُقرأ بعد الحلقة':
    ['function f(a) {\n  for (var i = 0; i < a.length; i++) {\n    if (a[i] < 0) break;\n  }\n  return i;\n}\n', 2, 'f([1,-1,2])', /^VAR_SCOPE_ESCAPE/],
  'closure داخل الحلقة يلتقط العدّاد':
    ['function f() {\n  const fns = [];\n  for (var i = 0; i < 3; i++) {\n    fns.push(function () { return i; });\n  }\n  return fns.map(g => g()).join(",");\n}\n', 3, 'f()', /^VAR_LOOP_CLOSURE/],
  'بلا قيمة داخل حلقة (يحتفظ بقيمة الدورة السابقة)':
    ['function f(a) {\n  const out = [];\n  for (const x of a) {\n    var last;\n    if (x) last = x;\n    out.push(last);\n  }\n  return out.join(",");\n}\n', 4, 'f([1,0,2])', /^VAR_LOOP_NO_INIT/],
  'يُستعمل قبل تعريفه':
    ['function f() {\n  const before = typeof v;\n  var v = 1;\n  return before + v;\n}\n', 3, 'f()', /^VAR_USED_BEFORE_DECL/],
  'مُعاد التعريف':
    ['function f() {\n  var a = 1;\n  var a = 2;\n  return a;\n}\n', 2, 'f()', /^VAR_NAME_REDECLARED/],
};
for (const [name, [code, line, call, reason]] of Object.entries(VAR_KEEP)) {
  test(`[VAR-] ${name}: لا تحويل (التحويل الأعمى يغيّر السلوك فعلًا) والسبب مُسجَّل`, () => {
    const naive = code.split('\n').map((l, i) => (i === line - 1 ? l.replace(/\bvar\b/, 'let') : l)).join('\n');
    const a = exec(code, call);
    assert.ok(a.ok, 'الأصل يعمل');
    let b = { ok: false }; try { parses(naive); b = exec(naive, call); } catch (e) { b = { ok: false, error: 'SyntaxError' }; }
    assert.ok(!b.ok || JSON.stringify(b.value) !== JSON.stringify(a.value), 'هذه الحالة لا تثبت ضرر التحويل الأعمى: ' + JSON.stringify({ a, b }));
    const r = repair(code, [issue(code, line, VAR_TITLE, { sev: 'l', type: 'js' })]);
    assert.strictEqual(r.repaired, code);
    assert.ok(reasonOf(r, reason), JSON.stringify(r.declined));
  });
}
test('[VAR-] أعلى ملف ثنائي الاستعمال (require/module.exports + سكربت متصفح): لا تحويل — this.x يتغير فعلًا', () => {
  const code = 'var g1 = 5;\nfunction f() { return this.g1; }\nif (typeof module !== "undefined") module.exports = f;\n';
  assert.strictEqual(exec(code, 'f()').value, 5);
  assert.strictEqual(exec(code.replace('var g1', 'let g1'), 'f()').value, undefined, 'التحويل يغيّر الناتج كسكربت');
  const r = repair(code, [issue(code, 1, VAR_TITLE, { sev: 'l', type: 'js' })]);
  assert.strictEqual(r.repaired, code);
  assert.ok(reasonOf(r, /^VAR_GLOBAL_BINDING/));
});
test('[VAR+] أعلى ملف CommonJS مُثبت (module.exports غير مشروط): يُحوَّل، والسلوك مطابق داخل غلاف الوحدة', () => {
  const code = "const fs = require('fs');\nvar counter = 0;\nfunction inc() { counter++; return counter; }\nmodule.exports = inc;\n";
  const r = repair(code, [issue(code, 2, VAR_TITLE, { sev: 'l', type: 'js' })]);
  assert.strictEqual(lineOf(r.repaired, 2), 'let counter = 0;');
  const asCjs = c => vm.runInNewContext('(function (module, exports, require) {' + c + '\nreturn module.exports(), module.exports();\n})({ exports: {} }, {}, () => ({}))');
  assert.strictEqual(asCjs(r.repaired), asCjs(code));
});
test('[VAR-] module/require معرّفان محليًا: ليس دليل CommonJS ⇒ لا تحويل', () => {
  const code = 'var module = { exports: {} };\nvar counter = 0;\nmodule.exports = counter;\n';
  const r = repair(code, [issue(code, 2, VAR_TITLE, { sev: 'l', type: 'js' })]);
  assert.strictEqual(r.repaired, code);
  assert.ok(reasonOf(r, /^VAR_GLOBAL_BINDING/));
});
test('[VAR+] أعلى وحدة ES (import/export): نطاق وحدة مُثبت ⇒ يُحوَّل', () => {
  const code = "import fs from 'fs';\nvar counter = 0;\nexport function inc() { counter++; return counter; }\n";
  const r = repair(code, [issue(code, 2, VAR_TITLE, { sev: 'l', type: 'js' })]);
  assert.strictEqual(lineOf(r.repaired, 2), 'let counter = 0;');
});
test('[VAR-] أعلى سكربت متصفح (ربط عام بين السكربتات): لا تحويل', () => {
  const code = 'var counter = 0;\nfunction inc() { counter++; }\n';
  const r = repair(code, [issue(code, 1, VAR_TITLE, { sev: 'l', type: 'js' })]);
  assert.strictEqual(r.repaired, code);
  assert.ok(reasonOf(r, /^VAR_GLOBAL_BINDING/));
});
test('[VAR-] eval في الدالة (قد يقرأ الاسم أو يعيد تعريفه): لا تحويل', () => {
  const code = 'function f(c) {\n  var x = 1;\n  eval(c);\n  return x;\n}\nmodule.exports = f;\n';
  const r = repair(code, [issue(code, 2, VAR_TITLE, { sev: 'l', type: 'js' })]);
  assert.strictEqual(r.repaired, code);
  assert.ok(reasonOf(r, /^VAR_DYNAMIC_SCOPE/));
});

// ═══ 2. XSS ═════════════════════════════════════════════
const XSS_TITLE = '🔴 XSS — user input في output';
const sink = () => { const el = { html: null }; Object.defineProperty(el, 'innerHTML', { set(v) { this.html = String(v); } }); Object.defineProperty(el, 'textContent', { set(v) { this.text = String(v); } }); return el; };
test('[XSS-ESCAPE] وسوم مقصودة + قيمة ديناميكية: يُهرَّب المتغيّر ويبقى الوسم (لا textContent)', () => {
  const code = 'function show(el, name) {\n  el.innerHTML = "<h2>Top: " + name + "</h2>";\n}\nmodule.exports = show;\n';
  const r = repair(code, [issue(code, 2, XSS_TITLE, { type: 'XSS' })]);
  assert.match(r.repaired, /el\.innerHTML = "<h2>Top: " \+ __escapeHTML\(name\) \+ "<\/h2>";/);
  assert.ok(!/textContent/.test(r.repaired));
  assert.ok(parses(r.repaired));
  assert.strictEqual(lineOf(r.repaired, 2).trim(), 'el.innerHTML = "<h2>Top: " + __escapeHTML(name) + "</h2>";', 'رقم السطر لم ينزح (الدالة المساعدة في آخر الملف)');
  // السلوك: اسم عادي يُعرض بالوسم نفسه، ومدخل خبيث يصير نصًّا
  const el1 = sink(), el2 = sink();
  vm.runInNewContext(r.repaired + '\nshow(el1, "Bob"); show(el2, "<img src=x onerror=alert(1)>");', { module: {}, el1, el2 });
  assert.strictEqual(el1.html, '<h2>Top: Bob</h2>');
  assert.strictEqual(el2.html, '<h2>Top: &lt;img src=x onerror=alert(1)&gt;</h2>');
});
test('[XSS-TEXT] القيمة كلها متغيّر واحد بلا وسوم: textContent (مكافئ لعرضها نصًّا)', () => {
  const code = 'function f(el, msg) {\n  el.innerHTML = msg;\n}\n';
  const r = repair(code, [issue(code, 2, XSS_TITLE, { type: 'XSS' })]);
  assert.strictEqual(lineOf(r.repaired, 2), '  el.textContent = msg;');
});
const XSS_KEEP = {
  'قيمة URL في href بلا مخطط آمن (escape لا يمنع javascript:)': 'function f(el, u) {\n  el.innerHTML = \'<a href="\' + u + \'">x</a>\';\n}\n',
  'ناتج دالة قد يكون HTML مقصودًا (marked)':                    'function f(el, md) {\n  el.innerHTML = marked(md);\n}\n',
};
for (const [name, code] of Object.entries(XSS_KEEP)) {
  test(`[XSS-] ${name}: لا تعديل، والسبب مُسجَّل`, () => {
    const r = repair(code, [issue(code, 2, XSS_TITLE, { type: 'XSS' })]);
    assert.strictEqual(r.repaired, code);
    assert.ok(reasonOf(r, /^XSS_CONTEXT_UNSAFE/), JSON.stringify(r.declined));
  });
}
test('[XSS-SMART] SmartRepair لم يعد يحوّل كل innerHTML إلى textContent', () => {
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} }, window: {}, global: {} });
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'smart_repair.js'), 'utf8'), ctx);   // بلا xss_fix.js
  const code = 'function f(el, n) {\n  el.innerHTML = "<b>" + n + "</b>";\n}\n';
  const S = vm.runInContext('SmartRepairEngine', ctx);
  assert.strictEqual(S.repair(code, 'a.js', [{ line: 2, title: XSS_TITLE }]).fixed, code, 'بلا مُصلح سياقي: لا تعديل');
});

// ═══ 3. HTTPS للإنتاج فقط (عبر المسار الكامل) ═════════════
// المحلل لا يبلّغ عن http://localhost أصلًا، فهذا الاختبار يثبت النتيجة النهائية لا الحارس نفسه؛
// حارس مضيف التطوير/الديناميكي مُختبَر مباشرةً (ببلاغ مفروض) في repair_http_literal_guard.test.js.
test('[HTTP] المسار الكامل: localhost يبقى، ومضيف الإنتاج يصير https', async () => {
  const code = 'const DEV = "http://localhost:3000/api";\nconst PROD = "http://api.gamestore.com/v1";\nmodule.exports = { DEV, PROD };\n';
  const out = await R.runPipelineAsync(code, 'a.js', { useFallbackChain: true });
  const patched = (out.decision && out.decision.patch) || code;
  assert.strictEqual(lineOf(patched, 1), 'const DEV = "http://localhost:3000/api";');
  assert.strictEqual(lineOf(patched, 2), 'const PROD = "https://api.gamestore.com/v1";');
});

// ═══ 4. eval حسب الاستخدام ═══════════════════════════════
const EVAL_TITLE = '🔴 eval() خطير جداً';
const EVAL_INLINE = {
  'تعبير حسابي ثابت':         ['function f() {\n  return eval("2 + 2");\n}\n', 2, 'f()', '  return (2 + 2);'],
  'كائن ثابت':                ['function f() {\n  return eval("({ a: 1, b: [2, 3] })");\n}\n', 2, 'JSON.stringify(f())', '  return ({ a: 1, b: [2, 3] });'],
  'اسم محلي (eval المباشر يرى نطاق المنادي)': ['function f() {\n  const k = 5;\n  return eval("k * 2");\n}\n', 3, 'f()', '  return (k * 2);'],
};
for (const [name, [code, line, call, expected]] of Object.entries(EVAL_INLINE)) {
  test(`[EVAL+] ${name}: يُستبدل بالتعبير نفسه، والقيمة مطابقة عند التشغيل`, () => {
    const r = repair(code, [issue(code, line, EVAL_TITLE)]);
    assert.strictEqual(lineOf(r.repaired, line), expected);
    assert.ok(!/\beval\s*\(/.test(r.repaired));
    assert.deepStrictEqual(exec(r.repaired, call).value, exec(code, call).value);
  });
}
const EVAL_KEEP = {
  'مدخلات المستخدم من الصفحة':          ['a.js', 'function run() {\n  const c = document.getElementById("x").value;\n  eval(c);\n}\n', 3, /^EVAL_EXECUTES_INPUT/],
  'مدخلات الطلب':                        ['a.js', 'app.post("/x", (req, res) => {\n  res.send(String(eval(req.body.expr)));\n});\n', 2, /^EVAL_EXECUTES_INPUT/],
  '"(" + text + ")" — JSON غير مُثبت':    ['a.js', 'function parse(text) {\n  return eval("(" + text + ")");\n}\n', 2, /^EVAL_JSON_UNPROVEN/],
  'اسم يوحي بـJSON لا يكفي دليلًا':       ['a.js', 'function f(data) {\n  return eval(data);\n}\n', 2, /^EVAL_DYNAMIC_UNKNOWN/],
  'نص ثابت فيه كتلة {} لا كائن':          ['a.js', 'const x = eval("{}");\n', 1, /^EVAL_STATIC_STATEMENTS/],
  'نص ثابت فيه تعريف':                    ['a.js', 'eval("var z = 1");\n', 1, /^EVAL_STATIC_STATEMENTS/],
  'eval معرّف محليًا':                    ['a.js', 'function f(eval) {\n  return eval("1");\n}\n', 2, /^EVAL_SHADOWED/],
  'Python input()':                        ['a.py', 'x = input()\nprint(eval(x))\n', 2, /^EVAL_EXECUTES_INPUT/],
  'Python معامل مجهول':                    ['a.py', 'def f(s):\n    return eval(s)\n', 2, /^EVAL_DYNAMIC_UNKNOWN/],
};
for (const [name, [file, code, line, reason]] of Object.entries(EVAL_KEEP)) {
  test(`[EVAL-] ${name}: لا تعديل (لا JSON.parse/literal_eval تخميني)، والسبب مُسجَّل`, () => {
    const r = repair(code, [issue(code, line, EVAL_TITLE, { aiRequired: true })], file);
    assert.strictEqual(r.repaired, code);
    assert.ok(!/JSON\.parse|literal_eval|eval removed/.test(r.repaired));
    assert.ok(reasonOf(r, reason), JSON.stringify(r.declined));
  });
}
test('[EVAL+] Python: تعبير حسابي ثابت ⇒ التعبير نفسه، بلا import ast', () => {
  const code = 'print(eval("3 * (4 + 1)"))\n';
  const r = repair(code, [issue(code, 1, EVAL_TITLE)], 'a.py');
  assert.strictEqual(r.repaired, 'print((3 * (4 + 1)))\n');
});
test('[EVAL-SMART] SmartRepair لم يعد يحذف eval أو يستبدله بالتخمين', () => {
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} }, window: {}, global: {} });
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'smart_repair.js'), 'utf8'), ctx);
  const S = vm.runInContext('SmartRepairEngine', ctx);
  for (const [code, file] of [['function f(data) {\n  return eval(data);\n}\n', 'a.js'], ['x = eval(s)\n', 'a.py']]) {
    assert.strictEqual(S.repair(code, file, [{ line: 2, title: 'eval() خطير' }]).fixed, code, file);
  }
});

// ═══ 5. MD5/SHA1 حسب الغرض ═══════════════════════════════
const WC_TITLE = '🔴 MD5 Hash (CWE-327)';
const REQ = "const crypto = require('crypto');\n";
test('[MD5-ALT] رمز عشوائي md5(Math.random…) ⇒ randomBytes بنفس الطول والصيغة', () => {
  const code = REQ + "function token() {\n  return crypto.createHash('md5').update(Math.random().toString() + Date.now()).digest('hex');\n}\nmodule.exports = token;\n";
  const r = repair(code, [issue(code, 3, WC_TITLE, { type: 'CWE_327', cwe: 'CWE-327' })]);
  assert.strictEqual(lineOf(r.repaired, 3), "  return crypto.randomBytes(16).toString('hex');");
  const nodeCrypto = require('crypto');
  const a = vm.runInNewContext(code + '\ntoken()', { require: () => nodeCrypto, module: {} });
  const b = vm.runInNewContext(r.repaired + '\ntoken()', { require: () => nodeCrypto, module: {} });
  assert.match(a, /^[0-9a-f]{32}$/); assert.match(b, /^[0-9a-f]{32}$/);   // الصيغة نفسها
});
test('[MD5-ALT] sha1 → base64: randomBytes(20) بنفس الطول', () => {
  const code = REQ + "const id = crypto.createHash('sha1').update(String(Math.random())).digest('base64');\n";
  const r = repair(code, [issue(code, 2, WC_TITLE, { type: 'CWE_327', cwe: 'CWE-327' })]);
  assert.strictEqual(lineOf(r.repaired, 2), "const id = crypto.randomBytes(20).toString('base64');");
  assert.strictEqual(require('crypto').createHash('sha1').update('x').digest('base64').length,
                     require('crypto').randomBytes(20).toString('base64').length);
});
const MD5_KEEP = {
  'كلمة مرور (يلزم KDF وترحيل)':            [REQ + "function hashPassword(pass) {\n  return crypto.createHash('md5').update(pass).digest('hex');\n}\n", 3, /^WEAK_CRYPTO_CREDENTIAL_CONTEXT[\s\S]*KDF[\s\S]*ترحيل/],
  'ترويسة Content-MD5 (بروتوكول)':          [REQ + "const h = { 'Content-MD5': crypto.createHash('md5').update(body).digest('base64') };\n", 2, /^WEAK_CRYPTO_PROTOCOL_REQUIRED/],
  'HMAC-SHA1 (يتحقق منه طرف آخر)':           [REQ + "const sig = crypto.createHmac('sha1', secret).update(payload).digest('hex');\n", 2, /^WEAK_CRYPTO_HMAC_COMPAT/],
  'مفتاح كاش (المخرج محفوظ/يُقارن)':          [REQ + "const key = crypto.createHash('md5').update(JSON.stringify(q)).digest('hex');\n", 2, /^WEAK_CRYPTO_OUTPUT_CHANGES/],
  'Date.now وحده (مخرج حتمي لا عشوائي)':      [REQ + "const id = crypto.createHash('md5').update(String(Date.now())).digest('hex');\n", 2, /^WEAK_CRYPTO_OUTPUT_CHANGES/],
  'المستقبِل ليس وحدة crypto':               ["const crypto = myLib;\nconst id = crypto.createHash('md5').update(Math.random().toString()).digest('hex');\n", 2, /^WEAK_CRYPTO_RANDOM_UNPROVEN/],
};
for (const [name, [code, line, reason]] of Object.entries(MD5_KEEP)) {
  test(`[MD5-] ${name}: لا SHA256 تلقائي، والسبب مُسجَّل`, () => {
    const r = repair(code, [issue(code, line, WC_TITLE, { type: 'CWE_327', cwe: 'CWE-327' })]);
    assert.strictEqual(r.repaired, code);
    assert.ok(!/sha256/i.test(r.repaired));
    assert.ok(reasonOf(r, reason), JSON.stringify(r.declined));
  });
}
test('[MD5-] Python بصمة ملف: لا تغيير', () => {
  const code = 'import hashlib\ndigest = hashlib.md5(data).hexdigest()\n';
  const r = repair(code, [issue(code, 2, WC_TITLE, { type: 'CWE_327', cwe: 'CWE-327' })], 'a.py');
  assert.strictEqual(r.repaired, code);
  assert.ok(reasonOf(r, /^WEAK_CRYPTO_OUTPUT_CHANGES/));
});

// ═══ 6. سجل القرار على GameServer (المسار الكامل) ═════════
const GAME = fs.readFileSync(path.join(__dirname, 'fixtures', 'GameServer.js'), 'utf8');
let GAME_OUT = null;
async function game() { if (!GAME_OUT) GAME_OUT = await R.runPipelineAsync(GAME, 'GameServer.js', { useFallbackChain: true }); return GAME_OUT; }
const OUTCOMES = new Set(['FIXED_VERIFIED', 'RESOLVED_BY_OTHER_FIX', 'CHANGED_STILL_REPORTED', 'LEFT_UNCHANGED']);

test('[DEC-1] قرار واحد لكل بلاغ، وكل قرار فيه: النتيجة والسبب والثقة ونتيجة التحقق', async () => {
  const out = await game();
  const f = out.phases.fallback;
  assert.strictEqual(f.decisions.length, out.phases.analyze.issues.length);
  for (const d of f.decisions) {
    assert.ok(OUTCOMES.has(d.outcome), d.outcome);
    assert.ok(typeof d.reason === 'string' && d.reason.length > 0, JSON.stringify(d));
    assert.ok(typeof d.verification === 'string' && d.verification.length > 0, JSON.stringify(d));
    assert.ok(d.confidence === null || (d.confidence >= 0 && d.confidence <= 1), JSON.stringify(d));
  }
});
test('[DEC-2] لا يُعلَن «مُصلح» لبلاغ ما زال قائمًا بعد إعادة التحليل', async () => {
  const out = await game();
  const f = out.phases.fallback;
  const ev = i => String(i.ev || '').replace(/\s+/g, '').toLowerCase().slice(0, 80);
  const still = new Set(f.remainingIssues.map(i => i.title + '|' + ev(i)));
  for (const d of f.decisions.filter(x => x.outcome === 'FIXED_VERIFIED' || x.outcome === 'RESOLVED_BY_OTHER_FIX')) {
    const orig = out.phases.analyze.issues.find(i => i.line === d.line && i.title === d.title);
    assert.ok(!still.has(d.title + '|' + ev(orig)), 'مُعلَن مُصلحًا وهو باقٍ: ' + d.title);
  }
});
test('[DEC-3] القرارات المحورية في GameServer وأسبابها', async () => {
  const f = (await game()).phases.fallback;
  const pick = (line, re) => f.decisions.find(d => d.line === line && re.test(d.title));
  const acc = pick(23, /Data Flow: totalScore/);
  assert.strictEqual(acc.outcome, 'FIXED_VERIFIED');
  const ev = pick(38, /eval/);
  assert.strictEqual(ev.outcome, 'LEFT_UNCHANGED');
  assert.match(ev.reason, /^EVAL_EXECUTES_INPUT/);
  assert.strictEqual(ev.confidence, 0.9);
  const md5 = pick(57, /MD5/);
  assert.strictEqual(md5.outcome, 'LEFT_UNCHANGED');
  assert.match(md5.reason, /^WEAK_CRYPTO_CREDENTIAL_CONTEXT/);
  assert.ok(md5.confidence >= 0.9);
  // var في أعلى الملف: الملف CommonJS مُثبت (require غير مشروط)، لكن eval في الملف قد يقرأ الاسم ⇒ يُترك
  const v7 = pick(7, /var/);
  assert.strictEqual(v7.outcome, 'LEFT_UNCHANGED');
  assert.match(v7.reason, /^VAR_DYNAMIC_SCOPE/);
  // وvar داخل دالة فيها eval: eval قد يقرأ الاسم أو يعيد تعريفه ⇒ يُترك
  const v37 = pick(37, /var/);
  assert.strictEqual(v37.outcome, 'LEFT_UNCHANGED');
  assert.match(v37.reason, /^VAR_DYNAMIC_SCOPE/);
});
test('[DEC-4] الناتج: XSS مُهرَّب بالوسم، eval وMD5 كما هما، والملف سليم التركيب', async () => {
  const d = (await game()).decision;
  const p = d.patch;
  assert.ok(parses(p));
  assert.ok(p.includes('"<h2>Top Player: " + __escapeHTML(players[0].name) + "</h2>"'));
  assert.ok(!/\.textContent\s*=/.test(p), 'لا textContent أعمى');
  assert.ok(p.includes('    eval(cheatCode);'));
  assert.ok(p.includes("crypto.createHash('md5').update(pass)"));
  assert.ok(p.includes('        totalScore += p.score;'));
  // الإصلاحات المُعلَنة تشير إلى أسطر تغيّرت فعلًا (لا انزياح أرقام)
  const after = new Set(p.split('\n'));
  const B = GAME.split('\n');
  for (const r of (await game()).phases.fallback.safeRepairs) {
    if (!Number.isFinite(Number(r.line))) continue;
    // الجملة التي يبدأ بها الإصلاح تغيّرت (جملة XSS هنا على سطرين والتغيير في الثاني)
    const stmtChanged = !after.has(B[r.line - 1]) || (/=\s*$/.test(B[r.line - 1]) && !after.has(B[r.line]));
    assert.ok(stmtChanged, 'مُعلَن وجملته لم تتغيّر: ' + r.line + ' ' + (r.strategy || r.fix));
  }
});

// ═══ 7. البوابة: الإثبات البديل لا يفتح بابًا لما لا يُثبت ═══
// FixVerifier يُعيد اشتقاق البديلين من النصّين بنفسه. كل محاولة تشبههما ولا تطابقهما تُرفض كما كانت.
const { FixVerifier: FV } = require('../public/server_engine_registration.js');
const gate = (before, after, file) => FV.verifyFix(before, after, file || 'a.js', E.analyze);
const GATE_ACCEPT = {
  'eval على نص ثابت ⇒ التعبير نفسه': ['function f() {\n  return eval("2 + 2");\n}\nmodule.exports = f;\n',
                                       'function f() {\n  return (2 + 2);\n}\nmodule.exports = f;\n'],
  'md5(Math.random) ⇒ randomBytes(16) hex': [REQ + "function t() {\n  return crypto.createHash('md5').update(Math.random().toString()).digest('hex');\n}\nmodule.exports = t;\n",
                                             REQ + "function t() {\n  return crypto.randomBytes(16).toString('hex');\n}\nmodule.exports = t;\n"],
};
for (const [name, [b, a]] of Object.entries(GATE_ACCEPT)) {
  test(`[GATE+] ${name}: مقبول بإثبات البوابة نفسها`, () => {
    const v = gate(b, a);
    assert.strictEqual(v.accepted, true, JSON.stringify(v.reason));
  });
}
const GATE_REJECT = {
  'eval(x) ⇒ (x): المعامل ليس نصًّا ثابتًا':
    ['function f(x) {\n  return eval(x);\n}\nmodule.exports = f;\n', 'function f(x) {\n  return (x);\n}\nmodule.exports = f;\n', /EVAL_FIX_UNPROVEN/],
  'eval("2 + 2") ⇒ (3 + 3): ليس التعبير نفسه':
    ['function f() {\n  return eval("2 + 2");\n}\nmodule.exports = f;\n', 'function f() {\n  return (3 + 3);\n}\nmodule.exports = f;\n', /EVAL_FIX_UNPROVEN/],
  'eval محذوف بتعليق (محو شكلي)':
    ['function f() {\n  return eval("2 + 2");\n}\nmodule.exports = f;\n', 'function f() {\n  return /* removed */ 0;\n}\nmodule.exports = f;\n', /EVAL_FIX_UNPROVEN/],
  'md5(Math.random) ⇒ randomBytes(8): الطول تغيّر':
    [REQ + "function t() {\n  return crypto.createHash('md5').update(Math.random().toString()).digest('hex');\n}\nmodule.exports = t;\n",
     REQ + "function t() {\n  return crypto.randomBytes(8).toString('hex');\n}\nmodule.exports = t;\n", /CRYPTO_FIX_UNPROVEN/],
  'md5(بيانات) ⇒ randomBytes: المدخل ليس عشوائية (القيمة كانت حتمية)':
    [REQ + "function t(d) {\n  return crypto.createHash('md5').update(d).digest('hex');\n}\nmodule.exports = t;\n",
     REQ + "function t(d) {\n  return crypto.randomBytes(16).toString('hex');\n}\nmodule.exports = t;\n", /CRYPTO_FIX_UNPROVEN/],
  'سياق كلمة مرور: randomBytes لا يكفي (KDF وحده كما كان)':
    [REQ + "function resetPassword() {\n  return crypto.createHash('md5').update(Math.random().toString()).digest('hex');\n}\nmodule.exports = resetPassword;\n",
     REQ + "function resetPassword() {\n  return crypto.randomBytes(16).toString('hex');\n}\nmodule.exports = resetPassword;\n", /CRYPTO_FIX_UNPROVEN/],
};
for (const [name, [b, a, re]] of Object.entries(GATE_REJECT)) {
  test(`[GATE-] ${name}: مرفوض`, () => {
    const v = gate(b, a);
    assert.notStrictEqual(v.accepted, true, 'قُبل ما لا يُثبت');
    assert.match(String(v.reason), re);
  });
}

// ═══ 8. XSS: تحقق سياقي فعلي في DOM حقيقي (jsdom) ═════════
// كان بلاغ السطر 26 يبقى بعد التهريب لأن قاعدة knowledge_base.js سطرية (كل «innerHTML =» تقريبًا)،
// وsecurity_scanner.js يبلّغ عن أي سطر فيه innerHTML. صار الكاشفان يستثنيان الإسناد بإثبات مشترك
// واحد (KnowledgeBase.escapedTextSink — AST: الدالة المعيارية بنصّها، غير مُعاد ربطها، وكل نداء في
// سياق نص HTML)، والبوابة تُعيد اشتقاق الإثبات نفسه ([XSS-KEPT])؛ فالقرار FIXED_VERIFIED حين يُثبَت
// وحده، والأصل غير المُهرَّب وكل صورة لا تُثبَت يبقى بلاغها (fallback_paths_gate_negative.test.js).
// والحماية تُثبت هنا بالتشغيل أيضًا: الحمولات الخبيثة تصير نصًّا، والوسم المقصود يبقى عنصرًا.
test('[XSS-DEC] GameServer: السطر 26 FIXED_VERIFIED والناتج يحوي تعريف الدالة التي يناديها', async () => {
  const o = await game();
  const d = o.phases.fallback.decisions.filter(x => x.line === 26);
  assert.ok(d.some(x => x.outcome === 'FIXED_VERIFIED'), JSON.stringify(d.map(x => x.outcome)));
  assert.match(o.decision.patch, /__escapeHTML\(players\[0\]\.name\)/);
  assert.match(o.decision.patch, /^function __escapeHTML\(v\) \{/m, 'نداء بلا تعريف = ReferenceError');
});
let JSDOM = null;
try { JSDOM = require(require.resolve('jsdom', { paths: [process.env.JSDOM_PATH || __dirname, path.join(__dirname, '..')] })).JSDOM; } catch (_) { /* غير متوفر */ }
const NO_DOM = JSDOM ? false : 'jsdom غير متوفر (JSDOM_PATH=مجلد يحوي node_modules/jsdom)';
const PAYLOADS = ['<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', '<script>alert(1)</script>', "' onmouseover='alert(1)", '&lt;b&gt;', '`${x}`'];

test('[XSS-DOM] GameServer بعد الإصلاح: الاسم يُعرض نصًّا داخل <h2> لكل حمولة، ولا عنصر أو معالج زائد', { skip: NO_DOM }, async () => {
  const p = (await game()).decision.patch;
  for (const name of PAYLOADS.concat(['Bob'])) {
    const dom = new JSDOM('<div id="leaderboard"></div>', { runScripts: 'outside-only' });
    dom.window.eval(p.replace(/^const DB_PASSWORD[^\n]*\n|^const API_SECRET[^\n]*\n/gm, '').replace(/const crypto = require\('crypto'\);/, 'const crypto = {};') +
                    '\nupdateLeaderboard([{ name: ' + JSON.stringify(name) + ', score: 1 }]);');
    const lb = dom.window.document.getElementById('leaderboard');
    assert.strictEqual(lb.children.length, 1, name);
    assert.strictEqual(lb.children[0].tagName, 'H2', 'الوسم المقصود باقٍ عنصرًا: ' + name);
    assert.strictEqual(lb.children[0].children.length, 0, 'لا عنصر محقون: ' + name);
    assert.strictEqual(lb.children[0].textContent, 'Top Player: ' + name, 'النص حرفيًا: ' + name);
    assert.strictEqual(lb.querySelectorAll('*').length, 1);
  }
});

const XSS_CTX = [
  // [الوصف، الكود، دالة التحقق في DOM، أو null = يجب ألا يُعدَّل]
  ['قيمة داخل سمة مقتبسة (title)', 'function f(el, x) {\n  el.innerHTML = \'<div title="\' + x + \'">hi</div>\';\n}\n',
    (el, x) => { const d = el.children[0]; assert.strictEqual(d.tagName, 'DIV'); assert.deepStrictEqual([...d.attributes].map(a => a.name), ['title']); assert.strictEqual(d.getAttribute('title'), x); }],
  ['template literal بوسم', 'function f(el, x) {\n  el.innerHTML = `<b>${x}</b>`;\n}\n',
    (el, x) => { assert.strictEqual(el.children.length, 1); assert.strictEqual(el.children[0].tagName, 'B'); assert.strictEqual(el.children[0].textContent, x); }],
  ['داخل <script>: لا يُهرَّب بتهريب HTML', 'function f(el, x) {\n  el.innerHTML = \'<script>var a = "\' + x + \'";</script>\';\n}\n', null],
  ['داخل <style>', 'function f(el, x) {\n  el.innerHTML = \'<style>.a{color:\' + x + \'}</style>\';\n}\n', null],
  ['معالج حدث onclick', 'function f(el, x) {\n  el.innerHTML = \'<a onclick="go(\' + x + \')">x</a>\';\n}\n', null],
];
for (const [name, code, check] of XSS_CTX) {
  test(`[XSS-CTX] ${name}: ${check ? 'محمي فعليًا في DOM' : 'لا تعديل (السياق لا يحميه التهريب) والسبب مُسجَّل'}`, { skip: check ? NO_DOM : false }, () => {
    const r = repair(code, [issue(code, 2, XSS_TITLE, { type: 'XSS' })]);
    if (!check) {
      assert.strictEqual(r.repaired, code);
      assert.ok(reasonOf(r, /^XSS_CONTEXT_UNSAFE/), JSON.stringify(r.declined));
      return;
    }
    assert.notStrictEqual(r.repaired, code);
    for (const x of PAYLOADS) {
      const dom = new JSDOM('<div id="t"></div>', { runScripts: 'outside-only' });
      dom.window.eval(r.repaired + '\nf(document.getElementById("t"), ' + JSON.stringify(x) + ');');
      const el = dom.window.document.getElementById('t');
      check(el, x);
      assert.ok(![...el.querySelectorAll('*')].some(n => [...n.attributes].some(a => /^on/i.test(a.name))), 'معالج حدث محقون: ' + x);
    }
  });
}

// ═══ 9. [مراجعة مستقلة] محاولات تجاوز البوابة — كانت تمرّ من نسخة سابقة من الإثبات البديل ═══
// كل حالة هنا قبلتها نسخةٌ سابقة من [ALT-PROOF] (والبوابة قبل الإضافة كانت ترفضها). صار الإثبات:
// AST + موضع السطر وجاراه + شروط على الملف كله. فكلها مرفوضة، ومُصلِح repair_engine لا يُنتجها.
const BYPASS = {
  'H1 سطر طُعم في دالة أخرى، وeval الحقيقي مُموَّه':
    ['function run(c) {\n  const x = eval("2 + 2");\n  return x;\n}\nfunction unused() {\n  return 0;\n}\nmodule.exports = run;\n',
     'function run(c) {\n  const x = window["ev" + "al"](c);\n  return x;\n}\nfunction unused() {\n  const x = (2 + 2);\n}\nmodule.exports = run;\n'],
  'H1 طُعم randomBytes في دالة أخرى':
    [REQ + "function t(d) {\n  return crypto.createHash('md5').update(Math.random().toString()).digest('hex');\n}\nfunction u() {\n  return 0;\n}\nmodule.exports = t;\n",
     REQ + "function t(d) {\n  return String(d);\n}\nfunction u() {\n  return crypto.randomBytes(16).toString('hex');\n}\nmodule.exports = t;\n"],
  'H2 require في تعليق والمستقبِل مكتبة أخرى':
    ["// const crypto = require('crypto')\nconst crypto = fakeLib;\nfunction t() {\n  return crypto.createHash('md5').update(Math.random().toString()).digest('hex');\n}\nmodule.exports = t;\n",
     "// const crypto = require('crypto')\nconst crypto = fakeLib;\nfunction t() {\n  return crypto.randomBytes(16).toString('hex');\n}\nmodule.exports = t;\n"],
  'H2 Math.random مُعاد تعريفه (مدخل حتمي)':
    [REQ + "const Math = { random: () => 4 };\nfunction t() {\n  return crypto.createHash('md5').update(Math.random().toString()).digest('hex');\n}\nmodule.exports = t;\n",
     REQ + "const Math = { random: () => 4 };\nfunction t() {\n  return crypto.randomBytes(16).toString('hex');\n}\nmodule.exports = t;\n"],
  'H3 توقيع hashPassword على عدة أسطر':
    [REQ + "function hashPassword(\n  user\n) {\n  return crypto.createHash('md5').update(Math.random().toString()).digest('hex');\n}\nmodule.exports = hashPassword;\n",
     REQ + "function hashPassword(\n  user\n) {\n  return crypto.randomBytes(16).toString('hex');\n}\nmodule.exports = hashPassword;\n"],
  'H3 السطر نفسه مكرر والثاني داخل hashPassword':
    [REQ + "function token() {\n  return crypto.createHash('md5').update(Math.random().toString()).digest('hex');\n}\nfunction hashPassword() {\n  return crypto.createHash('md5').update(Math.random().toString()).digest('hex');\n}\nmodule.exports = { token, hashPassword };\n",
     REQ + "function token() {\n  return crypto.randomBytes(16).toString('hex');\n}\nfunction hashPassword() {\n  return crypto.randomBytes(16).toString('hex');\n}\nmodule.exports = { token, hashPassword };\n"],
  'H4 eval عبر destructuring':
    ['const { eval } = sandbox;\nfunction f() {\n  return eval("2 + 2");\n}\nmodule.exports = f;\n', 'const { eval } = sandbox;\nfunction f() {\n  return (2 + 2);\n}\nmodule.exports = f;\n'],
  'H4 eval مُعاد إسناده':
    ['eval = function (s) { return "hooked:" + s; };\nfunction f() {\n  return eval("2 + 2");\n}\nmodule.exports = f;\n', 'eval = function (s) { return "hooked:" + s; };\nfunction f() {\n  return (2 + 2);\n}\nmodule.exports = f;\n'],
  'H4 eval داخل with':
    ['function f(o) {\n  with (o) {\n    return eval("2 + 2");\n  }\n}\nmodule.exports = f;\n', 'function f(o) {\n  with (o) {\n    return (2 + 2);\n  }\n}\nmodule.exports = f;\n'],
};
for (const [name, [b, a]] of Object.entries(BYPASS)) {
  test(`[BYPASS] ${name}: البوابة ترفض`, () => {
    assert.notStrictEqual(gate(b, a).accepted, true, 'قُبل تجاوز');
  });
}
const BYPASS_REPAIR = [
  ['H2 مستقبِل مزيّف', BYPASS['H2 require في تعليق والمستقبِل مكتبة أخرى'][0], 4, WC_TITLE, /^WEAK_CRYPTO_RANDOM_UNPROVEN/],
  ['H2 Math مُعاد تعريفه', BYPASS['H2 Math.random مُعاد تعريفه (مدخل حتمي)'][0], 4, WC_TITLE, /^WEAK_CRYPTO_RANDOM_UNPROVEN/],
  ['H3 توقيع على عدة أسطر', BYPASS['H3 توقيع hashPassword على عدة أسطر'][0], 5, WC_TITLE, /WEAK_CRYPTO_CREDENTIAL_CONTEXT/],
  ['H4 destructuring', BYPASS['H4 eval عبر destructuring'][0], 3, EVAL_TITLE, /^EVAL_SHADOWED/],
  ['H4 إسناد', BYPASS['H4 eval مُعاد إسناده'][0], 3, EVAL_TITLE, /^EVAL_SHADOWED/],
  ['H4 with', BYPASS['H4 eval داخل with'][0], 3, EVAL_TITLE, /^EVAL_DYNAMIC_SCOPE/],
];
for (const [name, code, line, title, reason] of BYPASS_REPAIR) {
  test(`[BYPASS-REPAIR] ${name}: المُصلِح لا يُنتج التعديل، والسبب مُسجَّل`, () => {
    const r = repair(code, [issue(code, line, title, { type: 'CWE_327', cwe: 'CWE-327' })]);
    assert.strictEqual(r.repaired, code);
    assert.ok((r.declined || []).some(d => reason.test(d.reason)) || (r.rejected || []).some(d => reason.test(d.reason)), JSON.stringify(r.declined));
  });
}
test('[VAR-] var يعيد تعريف معامل الدالة (مرتبط بـarguments): لا تحويل — والتحويل كان سيغيّر الناتج', () => {
  const code = 'function f(a, c) {\n  if (c) {\n    var a = 5;\n    log(a);\n  }\n  return arguments[0];\n}\nfunction log() {}\n';
  const naive = code.replace('var a = 5', 'let a = 5');
  assert.strictEqual(exec(code, 'f(1, true)').value, 5);
  assert.strictEqual(exec(naive, 'f(1, true)').value, 1, 'التحويل الأعمى يغيّر الناتج');
  const r = repair(code, [issue(code, 3, VAR_TITLE, { sev: 'l', type: 'js' })]);
  assert.strictEqual(r.repaired, code);
  assert.ok(reasonOf(r, /^VAR_NAME_REDECLARED/), JSON.stringify(r.declined));
});
