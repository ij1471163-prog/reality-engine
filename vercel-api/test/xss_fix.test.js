// ═══════════════════════════════════════════════════════════════════════
// اختبارات xss_fix.js v2.0
// تشغيل:  node --test vercel-api/test/xss_fix.test.js
//
// يثبّت:
//   [CONTRACT]  واجهة canFix/fix كما يستهلكها fixers_orchestrator وself_healing_engine.
//   [V1-*]      كل عيب كان في v1.0 (regex سطرًا بسطر) — كل واحد له اختبار يفشل على v1.0.
//   [ORIGIN-*]  تتبّع أصل المتغيّر: لا تعقيم لـHTML مبني (cards) ولا لنص مُعقَّم (safe).
//               وهذا العيب ظهر عند تشغيل المسودة الأولى من v2 على admin.html/index.html.
//   [PHP-*]     ماسح PHP: سياقات، heredoc، $_COOKIE، بلا semicolon.
//   [SAFETY]    الناتج يُحلَّل دائمًا + idempotent + لا استثناء — على كل ملفات المستودع.
//   [PIPE-*]    عبر المنسّق الحقيقي (applySpecializedFixers + analyzeCode): ما يُقبل وما يُرفض.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT       = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const XSSFixer   = require(path.join(PUBLIC_DIR, 'xss_fix.js'));
const acorn      = require(path.join(PUBLIC_DIR, 'acorn.min.js'));

const parses = code => {
  const o = { ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowHashBang: true, allowAwaitOutsideFunction: true };
  try { acorn.parse(code, Object.assign({ sourceType: 'module' }, o)); return true; }
  catch (_) {
    try { acorn.parse(code, Object.assign({ sourceType: 'script' }, o)); return true; }
    catch (_2) { return false; }
  }
};

// يزيل إعلان المساعد المحقون ليسهل مقارنة جسم الكود
const stripHelper = code => code
  .replace(/\/\/ \[XSSFixer\][^\n]*\n/, '')
  .replace(/function __escapeHTML\(v\) \{[\s\S]*?\n\}\n\n?/, '');

const fixJs = (src, name) => XSSFixer.fix(src, name || 'a.js');
const kinds = r => r.unresolved.map(u => u.kind);

// ═══ [CONTRACT] ═════════════════════════════════════════
test('[CONTRACT] canFix: يتعرّف على بلاغات XSS بكل صيغ الحقول، ويرفض غيرها', () => {
  assert.strictEqual(XSSFixer.canFix([{ title: '🔴 XSS — innerHTML' }]), true);
  assert.strictEqual(XSSFixer.canFix([{ title: '🔴 XSS في res.send — user input مباشر' }]), true);
  assert.strictEqual(XSSFixer.canFix([{ type: 'XSS' }]), true);
  assert.strictEqual(XSSFixer.canFix([{ ruleId: 'js/innerHTML-assignment' }]), true);
  assert.strictEqual(XSSFixer.canFix([{ cAct: 'CWE-79 XSS' }]), true);
  assert.strictEqual(XSSFixer.canFix(['XSS found']), true);
  assert.strictEqual(XSSFixer.canFix([{ title: 'SQL Injection' }, { title: 'XSS' }]), true);
  assert.strictEqual(XSSFixer.canFix([{ title: 'SQL Injection' }]), false);
  assert.strictEqual(XSSFixer.canFix([]), false);
  assert.strictEqual(XSSFixer.canFix(null), false);
  assert.strictEqual(XSSFixer.canFix(undefined), false);
  assert.strictEqual(XSSFixer.canFix([null, undefined, 5]), false);
});

test('[CONTRACT] fix يُرجع { fixed:string, changed:boolean } كما يقرأه المنسّق وself_healing_engine', () => {
  const r = fixJs('function f(el, x) {\n  el.innerHTML = x;\n}');
  assert.strictEqual(typeof r.fixed, 'string');
  assert.strictEqual(r.changed, true);
  assert.ok(Array.isArray(r.edits) && Array.isArray(r.unresolved));
  // الحقول التي يتجاوب معها المنسّق بالتأجيل لا تُرفع تلقائيًا
  assert.notStrictEqual(r.confident, false);
  assert.notStrictEqual(r.needsReview, true);
});

test('[CONTRACT] fix لا يرمي أبدًا — مدخلات تالفة تُعاد كما هي', () => {
  for (const bad of [null, undefined, 42, {}, '', '   ', '\u0000\u0001', 'function (', '<?php echo', '<script>', 'x'.repeat(100000)]) {
    for (const name of ['a.js', 'a.html', 'a.php', 'a.ts', undefined, '']) {
      let r;
      assert.doesNotThrow(() => { r = XSSFixer.fix(bad, name); }, 'threw on ' + String(bad).slice(0, 20));
      assert.strictEqual(r.changed, false);
      assert.strictEqual(r.fixed, bad);
    }
  }
});

test('[CONTRACT] بلا acorn: لا يصلح JS بالـregex — يعيد الكود ويسجّل NO_PARSER', () => {
  // نحمّله في سياق vm لا يوجد فيه acorn ولا require
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'xss_fix.js'), 'utf8'), ctx, { filename: 'xss_fix.js' });
  const r = ctx.XSSFixer.fix('el.innerHTML = x;', 'a.js');
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.fixed, 'el.innerHTML = x;');
  assert.ok(r.unresolved.some(u => u.kind === 'NO_PARSER'));
});

test('[CONTRACT] يعمل كما يُحمَّل في المتصفح/المحرك: سكربت عادي + acorn عام في نفس السياق', () => {
  const ctx = vm.createContext({ console });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'acorn.min.js'), 'utf8'), ctx, { filename: 'acorn.min.js' });
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'xss_fix.js'), 'utf8'), ctx, { filename: 'xss_fix.js' });
  assert.strictEqual(typeof ctx.XSSFixer, 'object');
  const r = ctx.XSSFixer.fix('function f(el, x) {\n  el.innerHTML = x;\n}', 'a.js');
  assert.strictEqual(r.changed, true);
  assert.match(r.fixed, /el\.textContent = x;/);
});

test('[CONTRACT] لا يُسرّب أسماء عامة جديدة إلى نطاق الصفحة (إلا XSSFixer)', () => {
  const ctx = vm.createContext({});
  const before = new Set(Object.getOwnPropertyNames(ctx));
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'xss_fix.js'), 'utf8'), ctx, { filename: 'xss_fix.js' });
  const added = Object.getOwnPropertyNames(ctx).filter(k => !before.has(k));
  assert.deepStrictEqual(added, ['XSSFixer']);
});

// ═══ تحويلات JS الأساسية ═════════════════════════════════
const SIMPLE = [
  ['bare identifier',      'el.innerHTML = x;',                       'el.textContent = x;'],
  ['bare member',          'el.innerHTML = data.title;',              'el.textContent = data.title;'],
  ['computed prop',        'el["innerHTML"] = x;',                    'el["textContent"] = x;'],
  ['text-only concat',     'el.innerHTML = "Result: " + x;',          'el.textContent = "Result: " + x;'],
  ['text-only template',   'el.innerHTML = `Hello ${user.name}`;',    'el.textContent = `Hello ${user.name}`;'],
  ['+= bare',              'el.innerHTML += x;',                      "el.insertAdjacentText('beforeend', x);"],
  ['+= text concat',       'el.innerHTML += "Line: " + x;',           "el.insertAdjacentText('beforeend', \"Line: \" + x);"],
  ['insertAdjacentHTML bare', 'el.insertAdjacentHTML("beforeend", x);', 'el.insertAdjacentText("beforeend", x);'],
];
for (const [name, before, after] of SIMPLE) {
  test(`[JS] ${name}: ${before} → ${after}`, () => {
    // x و data و user معامِلات دالة ⇒ أصلها غير معروف ⇒ تُعامل كنص
    const src = `function f(el, x, data, user) {\n  ${before}\n}`;
    const r = fixJs(src);
    assert.strictEqual(r.changed, true, JSON.stringify(r.unresolved));
    assert.strictEqual(r.fixed, `function f(el, x, data, user) {\n  ${after}\n}`);
    assert.ok(parses(r.fixed));
  });
}

test('[JS] markup ثابت + ديناميكي: يبقى innerHTML ويُعقَّم الديناميكي فقط (لا textContent)', () => {
  const r = fixJs('function f(el, name) {\n  el.innerHTML = "<b>" + name + "</b>";\n}');
  assert.strictEqual(r.changed, true);
  assert.ok(parses(r.fixed));
  assert.match(r.fixed, /el\.innerHTML = "<b>" \+ __escapeHTML\(name\) \+ "<\/b>";/);
  assert.doesNotMatch(r.fixed, /textContent/);
  // المساعد معرَّف مرة واحدة
  assert.strictEqual((r.fixed.match(/function __escapeHTML/g) || []).length, 1);
});

test('[JS] قالب HTML بعدة قيم: كل ${…} ديناميكي يُعقَّم، والثابت لا', () => {
  const r = fixJs('function f(el, u) {\n  el.innerHTML = `<p class="n">${u.name}</p><i>${u.bio}</i>`;\n}');
  assert.strictEqual(r.changed, true);
  assert.match(r.fixed, /<p class="n">\$\{__escapeHTML\(u\.name\)\}<\/p><i>\$\{__escapeHTML\(u\.bio\)\}<\/i>/);
});

test('[JS] += مع markup: insertAdjacentHTML على نفس العنصر (لا document.body)', () => {
  const r = fixJs('function f(list, n) {\n  list.innerHTML += "<li>" + n + "</li>";\n}');
  assert.strictEqual(r.changed, true);
  assert.match(r.fixed, /list\.insertAdjacentHTML\('beforeend', "<li>" \+ __escapeHTML\(n\) \+ "<\/li>"\);/);
  assert.doesNotMatch(r.fixed, /document\.body/);
});

test('[JS] += على تعبير مركّب (a.b.c) وعلى استدعاء: الهدف يُحفَظ كما هو', () => {
  const r = fixJs('function f(a, id, n) {\n  a.b.c.innerHTML += n;\n  document.getElementById(id).innerHTML += n;\n}');
  assert.strictEqual(r.changed, true);
  assert.match(r.fixed, /a\.b\.c\.insertAdjacentText\('beforeend', n\);/);
  assert.match(r.fixed, /document\.getElementById\(id\)\.insertAdjacentText\('beforeend', n\);/);
});

test('[JS] += مع RHS بين قوسين: الأقواس تبقى متوازنة', () => {
  const r = fixJs('function f(el, n) {\n  el.innerHTML += ("a" + n);\n}');
  assert.strictEqual(r.changed, true);
  assert.ok(parses(r.fixed));
  assert.match(r.fixed, /el\.insertAdjacentText\('beforeend', \("a" \+ n\)\);/);
});

test('[JS] outerHTML: تعقيم لا textContent (textContent يغيّر المعنى: استبدال عنصر ↔ تعديل نصّه)', () => {
  const r = fixJs('function f(el, n) {\n  el.outerHTML = "<div>" + n + "</div>";\n}');
  assert.strictEqual(r.changed, true);
  assert.match(r.fixed, /el\.outerHTML = "<div>" \+ __escapeHTML\(n\) \+ "<\/div>";/);
});

test('[JS] document.write متعدد الأسطر: يبقى صالحًا ولا يُعلَّق', () => {
  const r = fixJs('function f(n) {\n  document.write(\n    "<p>" + n + "</p>"\n  );\n}');
  assert.strictEqual(r.changed, true);
  assert.ok(parses(r.fixed));
  assert.match(r.fixed, /document\.write\(\n\s+"<p>" \+ __escapeHTML\(n\) \+ "<\/p>"\n\s+\);/);
  assert.doesNotMatch(r.fixed, /SECURITY/);
});

test('[JS] insertAdjacentHTML مع markup: يُعقَّم الديناميكي', () => {
  const r = fixJs('function f(el, n) {\n  el.insertAdjacentHTML("beforeend", "<li>" + n + "</li>");\n}');
  assert.match(r.fixed, /insertAdjacentHTML\("beforeend", "<li>" \+ __escapeHTML\(n\) \+ "<\/li>"\)/);
});

test('[JS] jQuery .html("<b>"+x+"</b>") يُعقَّم، و.html(x) المجرّدة لا تُلمس (قد لا تكون DOM)', () => {
  const r1 = fixJs('function f(x) {\n  $("#a").html("<b>" + x + "</b>");\n}');
  assert.match(r1.fixed, /\.html\("<b>" \+ __escapeHTML\(x\) \+ "<\/b>"\)/);
  const r2 = fixJs('function f(x) {\n  res.html(x);\n  md.html(x);\n}');
  assert.strictEqual(r2.changed, false);
});

test('[JS] ما لا يحتاج إصلاحًا لا يُلمس: تفريغ، نصّ ثابت، DOMPurify، دوال تعقيم، textContent', () => {
  for (const line of [
    'el.innerHTML = "";',
    'el.innerHTML = "<hr>";',
    'el.innerHTML = DOMPurify.sanitize(x);',
    'el.innerHTML = escapeHtml(x);',
    'el.innerHTML = "<b>" + escHtml(x) + "</b>";',
    'el.innerHTML = "<b>" + __escapeHTML(x) + "</b>";',
    'el.textContent = x;',
    'el.innerHTML = "<b>" + items.length + "</b>";',
    'el.innerHTML = "<i>" + Number(x) + "</i>";',
  ]) {
    const src = `function f(el, x, items) {\n  ${line}\n}`;
    const r = fixJs(src);
    assert.strictEqual(r.changed, false, line);
    assert.strictEqual(r.fixed, src);
  }
});

test('[JS] helper يوضع بعد "use strict" وبعد shebang، لا قبلهما', () => {
  const r1 = fixJs('"use strict";\nfunction f(el, n) {\n  el.innerHTML = "<b>" + n + "</b>";\n}');
  assert.ok(r1.fixed.startsWith('"use strict";'), 'directive prologue يجب أن يبقى أولًا');
  assert.ok(parses(r1.fixed));
  const r2 = fixJs('#!/usr/bin/env node\nfunction f(el, n) {\n  el.innerHTML = "<b>" + n + "</b>";\n}');
  assert.ok(r2.fixed.startsWith('#!/usr/bin/env node\n'));
  assert.ok(parses(r2.fixed));
});

test('[JS] لا يُعاد تعريف helper إن كان معرَّفًا أصلًا', () => {
  const src = 'function __escapeHTML(v){return String(v);}\nfunction f(el, n) {\n  el.innerHTML = "<b>" + n + "</b>";\n}';
  const r = fixJs(src);
  assert.strictEqual((r.fixed.match(/function __escapeHTML/g) || []).length, 1);
  assert.match(r.fixed, /__escapeHTML\(n\)/);
});

test('[JS] helper المحقون يعقّم الخمسة + backtick ويحافظ على String(null)', () => {
  const r = fixJs('function f(el, n) {\n  el.innerHTML = "<b>" + n + "</b>";\n}');
  const ctx = vm.createContext({});
  vm.runInContext(r.fixed.slice(0, r.fixed.indexOf('function f(')), ctx);
  const esc = ctx.__escapeHTML;
  assert.strictEqual(esc('<script>alert("x")&\'`'), '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;&#96;');
  assert.strictEqual(esc(null), 'null');
  assert.strictEqual(esc(undefined), 'undefined');
  assert.strictEqual(esc(5), '5');
});

// ═══ [V1-*] عيوب v1.0 — كل واحد يفشل على النسخة القديمة ═══
test('[V1-1] لا .replace(/[<>]/g, "") ولا const _p/_el مكررة في أي ناتج', () => {
  const src = [
    'function f(el, a, b, c) {',
    '  el.innerHTML = a;',
    '  el.innerHTML += b;',
    '  el.innerHTML = "<b>" + c + "</b>";',
    '}',
  ].join('\n');
  const r = fixJs(src);
  assert.doesNotMatch(r.fixed, /replace\(\/\[<>\]\/g/);
  assert.doesNotMatch(r.fixed, /const _p\b|const _el\b/);
});

test('[V1-2] تطبيقه مرتين لا ينتج SyntaxError (redeclare) ولا يغيّر شيئًا (idempotent)', () => {
  const src = 'function f(el, a, b) {\n  el.innerHTML += a;\n  el.innerHTML += b;\n  el.innerHTML = "<i>" + a + "</i>";\n}';
  const r1 = fixJs(src);
  assert.ok(parses(r1.fixed));
  const r2 = fixJs(r1.fixed);
  assert.strictEqual(r2.changed, false);
  assert.strictEqual(r2.fixed, r1.fixed);
});

test('[V1-3] eval لا يُحذف: السطر كما هو + تسجيل EVAL في unresolved (v1 كان يعلّق السطر فيتبقى x غير معرّف)', () => {
  const src = 'function f(s) {\n  const x = eval(s);\n  return x;\n}';
  const r = fixJs(src);
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.fixed, src);
  assert.deepStrictEqual(kinds(r), ['EVAL']);
  assert.strictEqual(r.unresolved[0].line, 2);
});

test('[V1-4] eval(ثابت) لا يُبلَّغ عنه، وnew Function / setTimeout(نص ديناميكي) يُسجَّلان', () => {
  assert.deepStrictEqual(kinds(fixJs('eval("1+1");')), []);
  assert.deepStrictEqual(kinds(fixJs('function f(x) { return new Function("return " + x); }')), ['NEW_FUNCTION']);
  assert.deepStrictEqual(kinds(fixJs('function f(x) { setTimeout("run(" + x + ")", 10); }')), ['STRING_TIMER']);
  assert.deepStrictEqual(kinds(fixJs('setTimeout(function () {}, 10);')), []);
});

test('[V1-5] innerHTML += في HTML: لا span على document.body ولا String(value) غير معرّف (v1 فعلت الاثنين)', () => {
  const html = '<html><body>\n<script>\nfunction f(el, n) {\n  el.innerHTML += n;\n}\n</script>\n</body></html>';
  const r = XSSFixer.fix(html, 'page.html');
  assert.strictEqual(r.changed, true);
  assert.match(r.fixed, /el\.insertAdjacentText\('beforeend', n\);/);
  assert.doesNotMatch(r.fixed, /document\.body|String\(value\)|textContent\s*=/);
});

test('[V1-11] لا يُدخل أي معرّف غير معرّف في الكود (v1: String(value) في += بلا نمط "نص"+متغيّر)', () => {
  const r = fixJs('function f(el, n) {\n  el.innerHTML += n;\n}');
  assert.doesNotMatch(r.fixed, /\bvalue\b/);
  assert.match(r.fixed, /insertAdjacentText\('beforeend', n\)/);
});

test('[V1-6] markup المقصود لا يُسطَّح إلى نص (v1: innerHTML="<b>"+x+"</b>" → textContent)', () => {
  const r = fixJs('function f(el, x) {\n  el.innerHTML = "<b>" + x + "</b>";\n}');
  assert.doesNotMatch(r.fixed, /textContent/);
  assert.match(r.fixed, /"<b>"/);
});

test('[V1-7] جمع رقمي قبل أول نص: a+b+"<i>" لا يُغلَّف (سيحوّل 3 إلى "12")', () => {
  const src = 'function f(el, a, b) {\n  el.innerHTML = a + b + "<i>";\n}';
  const r = fixJs(src);
  assert.strictEqual(r.changed, false);
  assert.deepStrictEqual(kinds(r), ['HTML_SINK_COMPLEX']);
});

test('[V1-8] innerHTML += المستخدمة كقيمة تعبير لا تُحوَّل (insertAdjacent* يُرجع undefined)', () => {
  const src = 'function f(el, n) {\n  var y = (el.innerHTML += n);\n  return y;\n}';
  const r = fixJs(src);
  assert.strictEqual(r.changed, false);
  assert.deepStrictEqual(kinds(r), ['HTML_SINK_COMPLEX']);
});

test('[V1-9] لا يحذف أسرار الفوتر ولا SQL (اختصاص SecretsFixer / SQLInjectionFixer)', () => {
  const html = '<html><body>\n<p>JWT_SECRET=abc123 | DB_PASS=hunter2</p>\n<script>\nvar query = "SELECT * FROM t WHERE id=" + id;\n</script>\n</body></html>';
  const r = XSSFixer.fix(html, 'page.html');
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.fixed, html);
});

test('[V1-10] تعبير معقّد (استدعاء/شرط) لا يُعقَّم تخمينًا: يُسجَّل HTML_SINK_COMPLEX والكود كما هو', () => {
  for (const rhs of ['render(d)', 'a ? b : c()', 'await load()', '"<ul>" + a.map(i => i.x).join("") + "</ul>"']) {
    const src = `async function f(el, a, b, c, d) {\n  el.innerHTML = ${rhs};\n}`;
    const r = fixJs(src);
    assert.strictEqual(r.changed, false, rhs);
    assert.strictEqual(r.fixed, src);
    assert.ok(r.unresolved.length >= 1, rhs);
  }
});

// ═══ [ORIGIN-*] أصل المتغيّر ═════════════════════════════
test('[ORIGIN-1] متغيّر يبني HTML (map().join()) لا يُعقَّم ولا يُحوَّل لـtextContent — يُسجَّل HTML_SINK_TRUSTED_VAR', () => {
  const src = [
    'function f(el, list) {',
    "  const cards = list.map(p => `<div>${p.name}</div>`).join('');",
    '  el.innerHTML = `<section>${cards}</section>`;',
    '}',
  ].join('\n');
  const r = fixJs(src);
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.fixed, src);
  assert.deepStrictEqual(kinds(r), ['HTML_SINK_TRUSTED_VAR']);
  assert.match(r.unresolved[0].reason, /cards/);
});

test('[ORIGIN-2] متغيّر مُعقَّم مسبقًا (replace على & < >) لا يُعقَّم مرتين', () => {
  const src = [
    'function f(el, c) {',
    "  const safe = c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');",
    '  el.innerHTML = `<pre>${safe}</pre>`;',
    '}',
  ].join('\n');
  const r = fixJs(src);
  assert.strictEqual(r.changed, false, 'double-escape');
  assert.strictEqual(r.fixed, src);
});

test('[ORIGIN-3] متغيّر رقمي (length / ++ / حساب) لا يُغلَّف', () => {
  const src = [
    'function f(el, list) {',
    '  const n = list.length;',
    '  let passed = 0;',
    '  list.forEach(x => { if (x) passed++; });',
    '  const pct = passed / n * 100;',
    '  el.innerHTML = `<b>${n}</b><i>${passed}</i><u>${pct}</u>`;',
    '}',
  ].join('\n');
  assert.strictEqual(fixJs(src).changed, false);
});

test('[ORIGIN-4] شرط بنصّين ثابتين بلا markup (لون/نص) لا يُغلَّف', () => {
  const src = "function f(el, ok) {\n  el.innerHTML = `<b style=\"color:${ok ? '#0f0' : '#f00'}\">x</b>`;\n}";
  assert.strictEqual(fixJs(src).changed, false);
});

test('[ORIGIN-5] تراكم HTML: let out=""; out += "<li>"+x+"</li>" ثم innerHTML = out ⇒ trusted (لا textContent)', () => {
  const src = [
    'function f(el, items) {',
    "  let out = '';",
    '  for (const i of items) out += "<li>" + i + "</li>";',
    '  el.innerHTML = out;',
    '}',
  ].join('\n');
  const r = fixJs(src);
  assert.strictEqual(r.changed, false);
  assert.ok(kinds(r).includes('HTML_SINK_TRUSTED_VAR'));
});

test('[ORIGIN-6] معامِل دالة / عضو كائن / عام مجهول ⇒ يُعامل كنص ويُعقَّم (الافتراض الآمن)', () => {
  for (const [expr, wrapped] of [['x', 'x'], ['obj.name', 'obj.name'], ['window.q', 'window.q'], ['undeclaredGlobal', 'undeclaredGlobal']]) {
    const r = fixJs(`function f(el, x, obj) {\n  el.innerHTML = "<b>" + ${expr} + "</b>";\n}`);
    assert.strictEqual(r.changed, true, expr);
    assert.deepStrictEqual(r.edits[0].wrapped, [wrapped]);
  }
});

test('[ORIGIN-7] تتبّع الأصل مقاوم للحلقات: a=b; b=a لا يعلّق ولا يرمي', () => {
  const src = 'function f(el, z) {\n  let a = z, b = a;\n  a = b;\n  b = a;\n  el.innerHTML = "<i>" + a + "</i>";\n}';
  let r;
  assert.doesNotThrow(() => { r = fixJs(src); });
  assert.ok(parses(r.fixed));
});

test('[ORIGIN-8] أصل المتغيّر يُحدَّد بالنطاق الأقرب (متغيّر داخلي يظلّل خارجيًا)', () => {
  const src = [
    "const html = '<b>x</b>';",
    'function f(el, html) {',   // المعامل html يظلّل العام: أصله مجهول ⇒ يُعقَّم
    '  el.innerHTML = "<i>" + html + "</i>";',
    '}',
  ].join('\n');
  const r = fixJs(src);
  assert.strictEqual(r.changed, true);
  assert.deepStrictEqual(r.edits[0].wrapped, ['html']);
});

// ═══ HTML ═══════════════════════════════════════════════
test('[HTML] يصلح <script> inline فقط، ويتجاوز external وJSON وtemplate، ويحفظ أرقام الأسطر', () => {
  const html = [
    '<html><body>',
    '<script src="/x.js"></script>',
    '<script type="application/json">{"a":"el.innerHTML = x"}</script>',
    '<script type="text/template">el.innerHTML = x</script>',
    '<div onclick="el.innerHTML = x"></div>',
    '<script>',
    'function f(el, x) {',
    '  el.innerHTML = x;',
    '}',
    '</script>',
    '</body></html>',
  ].join('\n');
  const r = XSSFixer.fix(html, 'p.html');
  assert.strictEqual(r.changed, true);
  assert.match(r.fixed, /el\.textContent = x;/);
  assert.match(r.fixed, /"a":"el\.innerHTML = x"/);          // JSON لم يُمَسّ
  assert.match(r.fixed, /text\/template">el\.innerHTML = x</); // template لم يُمَس
  assert.match(r.fixed, /onclick="el\.innerHTML = x"/);        // handler inline لم يُمَسّ (خارج النطاق)
  assert.strictEqual(r.edits[0].line, 8, 'رقم السطر في الملف لا في الـscript');
});

test('[HTML] script فيه كود لا يُحلَّل ({{ }} قوالب): يُترك ويُسجَّل PARSE_FAILED ولا يمسّ بقية السكربتات', () => {
  const html = '<script>var a = {{ tpl }};</script>\n<script>\nfunction f(el, x) {\n  el.innerHTML = x;\n}\n</script>';
  const r = XSSFixer.fix(html, 'p.html');
  assert.strictEqual(r.changed, true);
  assert.match(r.fixed, /var a = \{\{ tpl \}\};/);
  assert.ok(kinds(r).includes('PARSE_FAILED'));
});

test('[HTML] كل script يُعدّل يحمل مساعده (نطاقات منفصلة لـmodules)', () => {
  const html = [
    '<script type="module">function a(el, n) { el.innerHTML = "<b>" + n + "</b>"; }</script>',
    '<script type="module">function b(el, n) { el.innerHTML = "<i>" + n + "</i>"; }</script>',
  ].join('\n');
  const r = XSSFixer.fix(html, 'p.html');
  assert.strictEqual((r.fixed.match(/function __escapeHTML/g) || []).length, 2);
});

// ═══ PHP ════════════════════════════════════════════════
const phpFix = src => XSSFixer.fix(src, 'a.php');
const H = (v) => `htmlspecialchars((string)${v}, ENT_QUOTES, 'UTF-8')`;

test('[PHP-1] echo متغيّر / عنصر مصفوفة / خاصية كائن', () => {
  assert.strictEqual(phpFix('<?php\necho $name;\n?>').fixed, `<?php\necho ${H('$name')};\n?>`);
  assert.strictEqual(phpFix('<?php echo $_GET["q"]; ?>').fixed, `<?php echo ${H('$_GET["q"]')}; ?>`);
  assert.strictEqual(phpFix('<?php echo $row[\'name\']; ?>').fixed, `<?php echo ${H("$row['name']")}; ?>`);
  assert.strictEqual(phpFix('<?php echo $user->name; ?>').fixed, `<?php echo ${H('$user->name')}; ?>`);
});

test('[PHP-2] $_COOKIE يُعقَّم صحيحًا (v1 أنتج htmlspecialchars($_COOKIE, …)["u"]: مصفوفة ⇒ TypeError + فهرسة لناتج دالة)', () => {
  const r = phpFix('<?php echo $_COOKIE["u"]; ?>');
  assert.strictEqual(r.fixed, `<?php echo ${H('$_COOKIE["u"]')}; ?>`);
  assert.doesNotMatch(r.fixed, /htmlspecialchars\(\$_COOKIE,/);
});

test('[PHP-3] <?= $_GET["x"] ?> و<?php echo $_GET["x"] ?> بلا semicolon صالحان (v1 فهرس ناتج الدالة)', () => {
  const r = phpFix('<p><?= $_GET["x"] ?></p>');
  assert.strictEqual(r.fixed, `<p><?= ${H('$_GET["x"]')} ?></p>`);
  assert.doesNotMatch(r.fixed, /htmlspecialchars\(\$_GET,/);
  const r2 = phpFix('<p><?php echo $_GET["x"] ?></p>');
  assert.strictEqual(r2.fixed, `<p><?php echo ${H('$_GET["x"]')} ?></p>`);
});

test('[PHP-4] تسلسل نصّ ثابت . متغيّر . نصّ، وecho بفواصل', () => {
  assert.strictEqual(phpFix('<?php echo "Hi " . $n . "!"; ?>').fixed, `<?php echo "Hi " . ${H('$n')} . "!"; ?>`);
  assert.strictEqual(phpFix('<?php echo "a", $x, "b"; ?>').fixed, `<?php echo "a", ${H('$x')}, "b"; ?>`);
});

test('[PHP-5] ما كان مُعقَّمًا أو رقميًا لا يُلمس (idempotent)', () => {
  for (const s of [
    '<?php echo htmlspecialchars($x, ENT_QUOTES); ?>',
    '<?php echo intval($x); ?>',
    '<?php echo (int)$x; ?>',
    '<?php echo esc_html($x); ?>',
    '<?php echo count($items); ?>',
    '<?php echo "plain"; ?>',
    '<?php echo 42; ?>',
    '<?php echo $a . PHP_EOL; ?>'.replace('$a', 'intval($a)'),
  ]) {
    const r = phpFix(s);
    assert.strictEqual(r.changed, false, s);
  }
  const once = phpFix('<?php echo $x; ?>');
  assert.strictEqual(phpFix(once.fixed).changed, false);
});

test('[PHP-6] مقطع غير مدعوم ⇒ العبارة كلها تُترك (interpolation، استدعاء مجهول، حساب، شرط)', () => {
  for (const s of [
    '<?php echo "Hello $name"; ?>',
    '<?php echo "Hello {$user->name}"; ?>',
    '<?php echo render($x); ?>',
    '<?php echo $a + $b; ?>',
    '<?php echo $a ? $b : $c; ?>',
    '<?php echo $a . foo($b); ?>',
  ]) {
    const r = phpFix(s);
    assert.strictEqual(r.changed, false, s);
    assert.ok(r.unresolved.length >= 1, s);
  }
});

test('[PHP-7] سياقات لا يحميها htmlspecialchars: داخل <script>، on*=، style=، attribute بلا اقتباس', () => {
  for (const s of [
    '<script>var x = "<?= $v ?>";</script>',
    '<style>.a { color: <?= $c ?>; }</style>',
    '<a onclick="go(\'<?= $id ?>\')">x</a>',
    '<div style="width:<?= $w ?>px"></div>',
    '<input value=<?= $v ?>>',
  ]) {
    const r = phpFix(s);
    assert.strictEqual(r.changed, false, s);
    assert.ok(kinds(r).includes('PHP_UNSAFE_CONTEXT'), s);
  }
  // attribute مقتبس عادي: مسموح
  assert.strictEqual(phpFix('<input value="<?= $v ?>">').fixed, `<input value="<?= ${H('$v')} ?>">`);
});

test('[PHP-8] echo داخل string أو تعليق أو نص HTML ليس عبارة: لا يُلمس', () => {
  for (const s of [
    '<?php $s = "echo $x;"; ?>',
    "<?php $s = 'echo $x;'; ?>",
    '<?php // echo $x;\n?>',
    '<?php # echo $x;\n?>',
    '<?php /* echo $x; */ ?>',
    '<p>echo $x;</p>',
    '<?php $o->echo($x); ?>',
  ]) {
    assert.strictEqual(phpFix(s).changed, false, s);
  }
});

test('[PHP-9] heredoc: يتوقف الفحص ويُسجَّل (لا نخمّن حدوده) — وما قبله يُصلَح', () => {
  const src = '<?php\necho $a;\n$t = <<<EOT\necho $b;\nEOT;\n?>';
  const r = phpFix(src);
  assert.strictEqual(r.changed, true);
  assert.match(r.fixed, /echo htmlspecialchars\(\(string\)\$a/);
  assert.match(r.fixed, /\necho \$b;\nEOT;/);
  assert.ok(kinds(r).includes('PHP_HEREDOC'));
});

test('[PHP-10] متغيّر اسمه يوحي بـHTML جاهز لا يُعقَّم (يُسجَّل PHP_POSSIBLY_HTML_VAR)', () => {
  for (const v of ['$html', '$content_html', '$rendered', '$tpl']) {
    const r = phpFix(`<?php echo ${v}; ?>`);
    assert.strictEqual(r.changed, false, v);
    assert.deepStrictEqual(kinds(r), ['PHP_POSSIBLY_HTML_VAR']);
  }
});

test('[PHP-11] print وecho داخل if/else بلا أقواس معقوفة، وأرقام الأسطر صحيحة', () => {
  const src = '<?php\nif ($a) echo $x;\nelse echo $y;\n?>';
  const r = phpFix(src);
  assert.strictEqual(r.changed, true);
  assert.match(r.fixed, /if \(\$a\) echo htmlspecialchars\(\(string\)\$x/);
  assert.match(r.fixed, /else echo htmlspecialchars\(\(string\)\$y/);
  assert.deepStrictEqual(r.edits.map(e => e.line), [2, 3]);
});

// ═══ لا تعديل للغات غير مدعومة ═══════════════════════════
test('[LANG] ts/tsx/jsx: لا تعديل (acorn لا يفهمها) ويُسجَّل السبب', () => {
  for (const f of ['a.ts', 'a.tsx', 'a.jsx']) {
    const src = 'function f(el: any, x: any) {\n  el.innerHTML = x;\n}';
    const r = XSSFixer.fix(src, f);
    assert.strictEqual(r.changed, false);
    assert.strictEqual(r.fixed, src);
    assert.deepStrictEqual(kinds(r), ['PARSE_FAILED']);
  }
});

test('[LANG] python وغيره من اللغات المعروفة: لا يُلمس حتى لو بدا المحتوى JS صالحًا', () => {
  const src = 'el.innerHTML = x;\n';   // سطر صالح في JS وفي Python معًا
  for (const f of ['a.py', 'A.java', 'a.go', 'a.rb', 'a.cs', 'a.kt', 'a.dart', 'a.sql', 'a.json', 'a.md']) {
    const r = XSSFixer.fix(src, f);
    assert.strictEqual(r.changed, false, f);
    assert.strictEqual(r.fixed, src, f);
    assert.deepStrictEqual(r.unresolved, [], f);
  }
});

test('[LANG] امتداد مجهول أو بلا اسم: يُستدلّ على النوع من المحتوى (PHP / HTML / وإلا JS)', () => {
  assert.strictEqual(XSSFixer.fix('<?php echo $x; ?>', 'noext').changed, true);
  assert.strictEqual(XSSFixer.fix('<html><script>el.innerHTML = x;</script></html>', 'page').changed, true);
  assert.strictEqual(XSSFixer.fix('function f(el, x) { el.innerHTML = x; }', undefined).changed, true);
  assert.strictEqual(XSSFixer.fix('function f(el, x) { el.innerHTML = x; }', 'unknown.js').changed, true);
});

// ═══ [SAFETY] على كل ملفات المستودع ══════════════════════
test('[SAFETY] على ملفات المستودع الحقيقية (public/api/test): لا استثناء، الناتج يُحلَّل، idempotent', () => {
  const dirs = ['public', 'api', 'test'].map(d => path.join(ROOT, d));
  let files = 0;
  const problems = [];
  for (const d of dirs) {
    for (const f of fs.readdirSync(d)) {
      if (!/\.(js|html)$/.test(f) || /\.min\.js$/.test(f)) continue;
      const src = fs.readFileSync(path.join(d, f), 'utf8');
      files++;
      let r;
      try { r = XSSFixer.fix(src, f); } catch (e) { problems.push('threw: ' + f); continue; }
      if (typeof r.fixed !== 'string') problems.push('non-string: ' + f);
      if (r.changed) {
        if (/\.js$/.test(f) && parses(src) && !parses(r.fixed)) problems.push('broke syntax: ' + f);
        const r2 = XSSFixer.fix(r.fixed, f);
        if (r2.changed) problems.push('not idempotent: ' + f);
      } else if (r.fixed !== src) {
        problems.push('changed=false but text differs: ' + f);
      }
    }
  }
  assert.ok(files >= 100, 'tripwire: عدد الملفات المفحوصة قليل بشكل مريب — ' + files);
  assert.deepStrictEqual(problems, []);
});

test('[SAFETY] ملفات المستودع الحقيقية: بوابة المنسّق نفسها (acorn) تقبل كل ناتج', () => {
  // نفس تحليل التركيب الذي يستعمله _syntaxCheck في fixers_orchestrator
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'admin.html'), 'utf8');
  const r = XSSFixer.fix(src, 'admin.html');
  const scripts = [...r.fixed.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length >= 1);
  scripts.forEach(s => assert.ok(parses(s), 'script غير صالح بعد الإصلاح'));
});

test('[SAFETY] تقريب fuzz: تركيبات عشوائية من القطع الصالحة لا تكسر الناتج أبدًا', () => {
  const lhs = ['el.innerHTML', 'a.b.innerHTML', 'document.getElementById("x").innerHTML', 'el["innerHTML"]', 'el.outerHTML'];
  const ops = ['=', '+='];
  const rhs = [
    'x', 'o.p', '"t" + x', '"<b>" + x + "</b>"', '`<i>${x}</i>`', '`a${o.p}b${x}`',
    '(x || "")', 'x + y + "<i>"', 'render(x)', '"<p>" + (x ? y : z) + "</p>"', 'a.map(i => i).join("")',
    'String(x)', 'x.trim()', '"<a>" + x.trim() + "</a>"', '""', '"<hr>"', 'DOMPurify.sanitize(x)',
  ];
  let n = 0;
  for (const l of lhs) for (const o of ops) for (const v of rhs) {
    for (const wrap of [s => s + ';', s => '(' + s + ');', s => 'if (c) ' + s + ';', s => 'for (;;) { ' + s + '; }', s => 'var q = ' + s + ';']) {
      const stmt = wrap(`${l} ${o} ${v}`);
      const src = `function f(el, a, o, x, y, z, c) {\n  ${stmt}\n}`;
      if (!parses(src)) continue;
      n++;
      const r = fixJs(src);
      assert.ok(parses(r.fixed), 'broke: ' + stmt + '\n→\n' + r.fixed);
      const r2 = fixJs(r.fixed);
      assert.strictEqual(r2.changed, false, 'not idempotent: ' + stmt);
    }
  }
  assert.ok(n > 400, 'tripwire: fuzz قليل — ' + n);
});

// ═══ [PIPE-*] عبر المنسّق الحقيقي ═══════════════════════
// نفس ترتيب تحميل server_repair_adapter + xss_fix + fixers_orchestrator.
// الغاية: ما يقبله المنسّق (بوابة: تركيب + إعادة تحليل + نقص بلاغات) وما يرفضه.
function buildPipelineContext() {
  const engines = [
    'acorn.min.js', 'engine_java.js', 'c_cpp_analyzer.js', 'analyzer.js', 'security_scanner.js',
    'secret_detector.js', 'taint_core.js', 'taint_js.js', 'taint_py.js', 'taint_php.js',
    'context_analyzer.js', 'deep_analyzer.js', 'typo_detector.js', 'accumulation_detector.js',
    'pattern_detector.js', 'csharp_analyzer.js', 'dart_analyzer.js', 'smart_context.js',
    'deep_flow.js', 'knowledge_base.js', 'cve_patterns.js', 'extended_patterns.js',
    'crypto_scanner.js', 'typescript_analyzer.js', 'kotlin_analyzer.js', 'php_analyzer.js',
    'advanced_analyzer.js', 'threat_detector.js', 'dependency_analyzer.js',
    // fix_verifier.js: المنسّق صار يشترط البوابة الرئيسية أيضًا ([ONE-GATE])، وبدونها لا يكتب (Fail-Closed)
    // — وهي محمَّلة في الإنتاج (index.html وapi/analyze.js) قبله.
    'fix_verifier.js', 'xss_fix.js', 'fixers_orchestrator.js',
  ];
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} }, window: {}, global: {}, F: {}, R: {} });
  for (const f of engines) {
    const p = path.join(PUBLIC_DIR, f);
    if (!fs.existsSync(p)) continue;
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

function runPipeline(ctx, name, code) {
  const issues = ctx.analyzeCode(code, name) || [];
  const F = { [name]: code };
  const R = { [name]: { issues } };
  const out = ctx.applySpecializedFixers(F, R);
  return { out, F, issuesBefore: issues };
}

test('[PIPE-1] تحويل textContent يُقبل في المنسّق (البوابة ترى نقصًا في البلاغات) وبتركيب سليم', () => {
  const ctx = buildPipelineContext();
  assert.strictEqual(typeof ctx.XSSFixer, 'object');
  const code = 'function show(el, x) {\n  el.innerHTML = x;\n}\n';
  const { out, F } = runPipeline(ctx, 'a.js', code);
  assert.strictEqual(out.totalFixed, 1, JSON.stringify(out));
  assert.ok(out.results['a.js'].some(r => r.fixer === 'XSS'));
  assert.strictEqual(F['a.js'], 'function show(el, x) {\n  el.textContent = x;\n}\n');
  assert.ok(parses(F['a.js']));
});

// [ONE-GATE] كان: يُقبل بالبوابة المحلية وحدها (عدّ البلاغات). المنسّق صار يشترط FixVerifier أيضًا، وهي لا تعدّ
// insertAdjacentText علاجًا مُثبتًا لـinnerHTML += (يحوّل msg من HTML إلى نص — قد يغيّر العرض إن حمل وسومًا)،
// فالمرشّح يُرفض بسببه والكود يبقى كما هو. لم تُوسَّع قائمة علاجات البوابة لتمريره.
test('[PIPE-2] innerHTML += msg ⇒ insertAdjacentText: البوابة الرئيسية لا تُثبته، فيُرفض والكود كما هو', () => {
  const ctx = buildPipelineContext();
  const code = 'function add(log, msg) {\n  log.innerHTML += msg;\n}\n';
  const { out, F } = runPipeline(ctx, 'a.js', code);
  assert.strictEqual(out.totalFixed, 0, JSON.stringify(out));
  assert.strictEqual(F['a.js'], code);
  assert.match(String(out.rejected['a.js'][0].reason), /^REJECTED_XSS_FIX_UNPROVEN/);
});

test('[PIPE-3] الإصلاح الصحيح مع الإبقاء على innerHTML + تعقيم: لا يُسلَّم أبدًا مكسورًا — يُقبل أو يُرفض والكود كما هو', () => {
  // ⚠️ المحلّلات الحالية (knowledge_base / taint_js / security_scanner) ما زالت تُبلّغ عن
  // innerHTML حتى لو عُقِّم المحتوى (مقيس: DOMPurify.sanitize وescapeHtml يُبلَّغ عنهما أيضًا)،
  // فالبوابة قد ترفض هذا الإصلاح بـREJECTED_NO_IMPROVEMENT. هذا الاختبار لا يثبّت أيّهما،
  // بل يثبّت الثابتة الجوهرية: لا كود مكسور، ولا زيادة في البلاغات.
  const ctx = buildPipelineContext();
  const code = 'function show(el, name) {\n  el.innerHTML = "<b>" + name + "</b>";\n}\n';
  const { out, F, issuesBefore } = runPipeline(ctx, 'a.js', code);
  assert.ok(parses(F['a.js']));
  const after = ctx.analyzeCode(F['a.js'], 'a.js') || [];
  assert.ok(after.length <= issuesBefore.length, 'زادت البلاغات بعد الإصلاح');
  if (out.totalFixed === 0) {
    assert.strictEqual(F['a.js'], code, 'رُفض ⇒ يجب أن يبقى الكود الأصلي بالحرف');
    assert.ok(out.rejected['a.js'] && out.rejected['a.js'].some(r => r.fixer === 'XSS'));
  } else {
    assert.match(F['a.js'], /__escapeHTML\(name\)/);
  }
});

test('[PIPE-4] HTML_SINK_TRUSTED_VAR: لا يُرسَل للمنسّق تعديل (changed=false) فلا يتأثر الملف', () => {
  const ctx = buildPipelineContext();
  const code = [
    'function show(el, list) {',
    "  const cards = list.map(p => '<div>' + p.name + '</div>').join('');",
    '  el.innerHTML = cards;',
    '}',
    '',
  ].join('\n');
  const { F } = runPipeline(ctx, 'a.js', code);
  assert.strictEqual(F['a.js'], code);
});

test('[PIPE-5] صفحات الواجهة الحقيقية (admin.html / index.html) عبر المنسّق: لا تدهور ولا كسر', () => {
  const ctx = buildPipelineContext();
  for (const name of ['admin.html', 'index.html']) {
    const code = fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
    const before = ctx.analyzeCode(code, name) || [];
    const { F } = runPipeline(ctx, name, code);
    const after = ctx.analyzeCode(F[name], name) || [];
    assert.ok(after.length <= before.length, name + ': زادت البلاغات');
    [...F[name].matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach(m =>
      assert.ok(parses(m[1]), name + ': script غير صالح'));
  }
});
