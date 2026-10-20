// ═══════════════════════════════════════════════════════════════════════
// مصنّف سياق HTML في xss_fix.js (JS + PHP)
// تشغيل:  node --test vercel-api/test/xss_fix_context.test.js
//
// القاعدة: لا يكفي changed:true ولا نجاح parsing. كل اختبار هجومي يُنفِّذ الناتج:
//   • JS: داخل jsdom (إن وُجد)، PHP: بـphp الحقيقي ثم jsdom.
//   • بعد fix() إمّا أن لا يبقى هجوم فعّال في الـDOM، أو تبقى الحالة في unresolved.
// وتوجد اختبارات ثابتة (لا تحتاج jsdom/php) تُثبت أن السياق غير المدعوم لا يُعدَّل أصلًا.
// jsdom غير مدرج في dependencies: تُتخطّى الاختبارات السلوكية بوضوح إن لم يتوفر
// (JSDOM_PATH=مجلد يحوي node_modules/jsdom)، وكذلك php.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('node:path');
const { spawnSync } = require('node:child_process');

const XSSFixer = require(path.join(__dirname, '..', 'public', 'xss_fix.js'));

let JSDOM = null;
try {
  const p = require.resolve('jsdom', { paths: [process.env.JSDOM_PATH || __dirname, path.join(__dirname, '..')] });
  JSDOM = require(p).JSDOM;
} catch (_) { /* skip behavioral */ }
const HAS_PHP = (() => { try { return spawnSync('php', ['-v']).status === 0; } catch (_) { return false; } })();
const SKIP_JS  = JSDOM ? false : 'jsdom غير متوفر (JSDOM_PATH)';
const SKIP_PHP = (JSDOM && HAS_PHP) ? false : (JSDOM ? 'php غير متوفر' : 'jsdom غير متوفر (JSDOM_PATH)');

// ── oracle: هل بقي هجوم فعّال؟ ───────────────────────────────────────────
function dangerous(doc) {
  const hits = [];
  for (const el of doc.querySelectorAll('*')) {
    if (el.tagName === 'SCRIPT' && /alert\(1\)/.test(el.textContent)) hits.push('script-text');
    for (const a of el.attributes) {
      const n = a.name.toLowerCase(), v = a.value;
      if (n.startsWith('on') && /alert\(1\)/.test(v)) hits.push('handler:' + n);
      if (['href', 'src', 'action', 'formaction', 'data'].includes(n) && /^\s*javascript:/i.test(v)) hits.push('js-url:' + n);
      if (n === 'srcdoc' && /alert\(1\)|onerror/i.test(v)) hits.push('srcdoc');
    }
  }
  return hits;
}
const newDoc = html => { const d = new JSDOM('<!doctype html><body></body>'); if (html != null) d.window.document.body.innerHTML = html; return d; };
const IMG = '<img src=x onerror=alert(1)>';
const kinds = out => (out.unresolved || []).map(u => u.kind);

function runJS(fixed, payload, tag) {
  const d = newDoc();
  const doc = d.window.document;
  const el = doc.createElement(tag || 'div');
  doc.body.appendChild(el);
  try {
    new Function('document', 'window', fixed + '\n;return render;')(doc, d.window)(el, payload);
  } catch (e) { return { error: String(e && e.message || e) }; }
  return { hits: dangerous(doc), el, doc };
}
function attackJS(code, payload) {
  const out = XSSFixer.fix(code, 'a.js');
  const r = runJS(out.fixed, payload);
  assert.ok(!r.error, 'الكود المُصلَح تعطّل: ' + r.error);
  if (r.hits.length) {
    assert.ok(out.unresolved.length > 0,
      'الهجوم ما زال يعمل (' + r.hits + ') وchanged=' + out.changed + ' وunresolved فارغ');
  }
  return { out, r };
}

// ═══ JS-C1..C6: سياقات يفشل فيها الـHTML-escape ⇒ تُترك وتُسجَّل ═══════════
const JS_CASES = [
  ['JS-C1 href مقتبس',          `function render(el,u){ el.innerHTML = '<a href="' + u + '">x</a>'; }`, 'javascript:alert(1)', 'attr-url'],
  ['JS-C2 attribute بلا اقتباس', `function render(el,u){ el.innerHTML = '<input value=' + u + '>'; }`, 'x onfocus=alert(1) autofocus', 'attr-unquoted'],
  ['JS-C3 معالج onclick',        `function render(el,u){ el.innerHTML = '<button onclick="go(\\'' + u + '\\')">b</button>'; }`, "');alert(1);('", 'attr-handler'],
  ['JS-C4 اسم وسم ديناميكي',     `function render(el,u){ el.innerHTML = '<' + u + '>x</' + u + '>'; }`, 'img src=x onerror=alert(1)', 'tag-name'],
  ['JS-C5 اسم attribute',        `function render(el,u){ el.innerHTML = '<div ' + u + '="v">x</div>'; }`, 'onmouseover="alert(1)" x', 'attr-name'],
  ['JS-C6 srcdoc',               `function render(el,u){ el.innerHTML = '<iframe srcdoc="' + u + '"></iframe>'; }`, IMG, 'attr-srcdoc'],
];
for (const [name, code, payload, ctx] of JS_CASES) {
  test(`[${name}] الكود لا يُعدَّل ويُسجَّل HTML_SINK_COMPLEX (${ctx})`, () => {
    const out = XSSFixer.fix(code, 'a.js');
    assert.strictEqual(out.changed, false, 'سياق غير مدعوم لا يجوز تعديله');
    assert.strictEqual(out.fixed, code);
    assert.ok(out.unresolved.some(u => u.kind === 'HTML_SINK_COMPLEX' && u.reason.includes(ctx)),
      'لم يُسجَّل السياق ' + ctx + ': ' + JSON.stringify(out.unresolved));
  });
  test(`[${name}] سلوكي: لا هجوم فعّال دون تسجيل`, { skip: SKIP_JS }, () => attackJS(code, payload));
}

// ═══ سياقات JS أخرى (CSS / script / حالات ملتبسة) ═══════════════════════
const JS_MORE = [
  ['style attribute',       `function render(el,u){ el.innerHTML = '<div style="color:' + u + '">x</div>'; }`, 'attr-css'],
  ['داخل <script>',         `function render(el,u){ el.innerHTML = '<script>var a=' + u + ';</script>'; }`, 'script'],
  ['داخل <style>',          `function render(el,u){ el.innerHTML = '<style>a{color:' + u + '}</style>'; }`, 'style'],
  ['href من أول القيمة',     `function render(el,u){ el.innerHTML = '<a href=\\'' + u + '\\'>x</a>'; }`, 'attr-url'],
  ['src على script',         `function render(el,u){ el.innerHTML = '<script src="/a/' + u + '"></script>'; }`, 'attr-url'],
  ['href بادئته "/" فقط',    `function render(el,u){ el.innerHTML = '<a href="/' + u + '">x</a>'; }`, 'attr-url'],
  ['href بادئته https://',   `function render(el,u){ el.innerHTML = '<a href="https://' + u + '">x</a>'; }`, 'attr-url'],
  ['href مبني من مقطعين',    `function render(el,a,b){ el.innerHTML = '<a href="' + a + b + '">x</a>'; }`, 'attr-url'],
  ['اسم attribute مجزّأ',    `function render(el,u){ el.innerHTML = '<a hr' + 'ef="' + u + '">x</a>'; }`, 'attr-url'],
  ['حرف كبير HREF/A',        `function render(el,u){ el.innerHTML = '<A HREF="' + u + '">x</A>'; }`, 'attr-url'],
  ['فراغ قبل =',             `function render(el,u){ el.innerHTML = '<a href = "' + u + '">x</a>'; }`, 'attr-url'],
  ['template literal href',  'function render(el,u){ el.innerHTML = `<a href="${u}">x</a>`; }', 'attr-url'],
  ['بعد وسم أُغلق ثم وسم مفتوح', `function render(el,u){ el.innerHTML = '<b>x</b><a href="' + u + '">x</a>'; }`, 'attr-url'],
  ['document.write بوسائط متعددة', `function f(u){ document.write('<a href="', u, '">x</a>'); }`, 'attr-url'],
  ['insertAdjacentHTML',     `function f(el,u){ el.insertAdjacentHTML('beforeend', '<a onclick="' + u + '">x</a>'); }`, 'attr-handler'],
  ['innerHTML +=',           `function f(el,u){ el.innerHTML += '<a href="' + u + '">x</a>'; }`, 'attr-url'],
  ['jQuery .html()',         `function f($el,u){ $el.html('<a href="' + u + '">x</a>'); }`, 'attr-url'],
  ['HTML جاهز ثم وسم مفتوح', `function f(el,u,h){ const html = '<div>' + h + '</div>'; el.innerHTML = '<p>' + html + '<a title="' + u + '">x</a>'; }`, null],
];
for (const [name, code, ctx] of JS_MORE) {
  if (ctx === null) continue;
  test(`[JS-ctx] ${name} ⇒ لا تعديل + unresolved(${ctx})`, () => {
    const out = XSSFixer.fix(code, 'a.js');
    assert.strictEqual(out.fixed, code, 'عُدِّل كود في سياق غير مدعوم: ' + out.fixed);
    assert.ok(out.unresolved.some(u => u.reason.includes(ctx)), JSON.stringify(out.unresolved));
  });
}

// ═══ ضوابط إيجابية: السياقات المدعومة ما زالت تُصلَح (والوظيفة تبقى) ═════════
test('[JS-OK1] نص HTML عادي: يُعقَّم والوسوم الثابتة تبقى', { skip: SKIP_JS }, () => {
  const out = XSSFixer.fix(`function render(el,u){ el.innerHTML = '<b>' + u + '</b>'; }`, 'a.js');
  assert.strictEqual(out.changed, true);
  const r = runJS(out.fixed, IMG);
  assert.ok(!r.error, r.error);
  assert.deepStrictEqual(r.hits, []);
  assert.ok(r.el.querySelector('b'), 'الوسم الثابت <b> يجب أن يبقى');
  assert.strictEqual(r.el.querySelector('b').textContent, IMG, 'الحمولة تُعرض نصًّا');
});
test('[JS-OK2] attribute مقتبس عام (title): يُعقَّم', { skip: SKIP_JS }, () => {
  const code = `function render(el,u){ el.innerHTML = '<span title="' + u + '">x</span>'; }`;
  const out = XSSFixer.fix(code, 'a.js');
  assert.strictEqual(out.changed, true);
  const r = runJS(out.fixed, '" onmouseover="alert(1)" x="');
  assert.ok(!r.error, r.error);
  assert.deepStrictEqual(r.hits, []);
  assert.strictEqual(r.el.querySelector('span').getAttribute('title'), '" onmouseover="alert(1)" x="');
});
test('[JS-OK3] attribute بنفس الاقتباس المفرد', { skip: SKIP_JS }, () => {
  const out = XSSFixer.fix(`function render(el,u){ el.innerHTML = "<span title='" + u + "'>x</span>"; }`, 'a.js');
  assert.strictEqual(out.changed, true);
  const r = runJS(out.fixed, "' onmouseover='alert(1)' x='");
  assert.deepStrictEqual(r.hits, []);
});
test('[JS-OK4] href ببادئة مسار ثابت آمنة /user/ : يُعقَّم ولا يتغيّر المضيف', { skip: SKIP_JS }, () => {
  const out = XSSFixer.fix(`function render(el,u){ el.innerHTML = '<a href="/user/' + u + '">x</a>'; }`, 'a.js');
  assert.strictEqual(out.changed, true);
  const r = runJS(out.fixed, '" onclick="alert(1)');
  assert.deepStrictEqual(r.hits, []);
  assert.ok(/^\/user\//.test(r.el.querySelector('a').getAttribute('href')));
});
test('[JS-OK5] href بعد # أو ? مدعوم', () => {
  for (const p of ['#', '?q=']) {
    const out = XSSFixer.fix(`function f(el,u){ el.innerHTML = '<a href="${p}' + u + '">x</a>'; }`, 'a.js');
    assert.strictEqual(out.changed, true, p);
  }
});
test('[JS-OK6] textarea/title (RCDATA) نصّ عادي', () => {
  const out = XSSFixer.fix(`function f(el,u){ el.innerHTML = '<textarea>' + u + '</textarea>'; }`, 'a.js');
  assert.strictEqual(out.changed, true);
});
test('[JS-OK7] بعد إغلاق <script> يعود السياق نصًّا', () => {
  const out = XSSFixer.fix(`function f(el,u){ el.innerHTML = '<script>1<\\/script><i>' + u + '</i>'; }`, 'a.js');
  // '<\\/script>' في JS = "<\/script>" ⇒ نصّ فيه </script> فعلي
  assert.strictEqual(out.changed, true, JSON.stringify(out.unresolved));
});
test('[JS-OK8] بدون markup: يبقى innerHTML→textContent كما كان', () => {
  const out = XSSFixer.fix(`function f(el,u){ el.innerHTML = u; }`, 'a.js');
  assert.ok(/textContent/.test(out.fixed));
});

// ═══ PHP ═════════════════════════════════════════════════════════════════
const PRELUDE = `<?php $u=getenv('P'); $b=getenv('P'); $v=getenv('P'); $tag=getenv('P'); $n=getenv('P'); $a=1; ?>`;
function runPHP(src, payload) {
  const r = spawnSync('php', ['-d', 'display_errors=0'], { input: src, env: Object.assign({}, process.env, { P: payload }), encoding: 'utf8' });
  return { html: r.stdout, err: r.status !== 0 ? r.stderr : '' };
}
const PHP_CASES = [
  ['PHP-C1 href مقتبس',       `<a href="<?= $u ?>">x</a>`,                'javascript:alert(1)', 'attr-url'],
  ['PHP-C2 src مقتبس',        `<iframe src="<?= $u ?>"></iframe>`,        'javascript:alert(1)', 'attr-url'],
  ['PHP-C3 srcdoc',           `<iframe srcdoc="<?= $u ?>"></iframe>`,     IMG,                   'attr-srcdoc'],
  ['PHP-C4 سياق بعد مقطع آمن (intval) ثم onclick', `<?php echo '<a href="#" onclick="go(' . intval($a) . ', ' . $b . ')">x</a>'; ?>`, '1);alert(1);(', 'attr-handler'],
  ['PHP-C5 داخل <script> ببادئة ثابتة', `<script>\n<?php echo "var x = " . $v . ";"; ?>\n</script>`, '1;alert(1)//', 'script'],
  ['PHP-C6 اسم وسم ديناميكي', `<?php echo '<' . $tag . '>x</' . $tag . '>'; ?>`, 'img src=x onerror=alert(1)', 'tag-name'],
  ['PHP-C7 اسم attribute ديناميكي', `<?php echo '<div ' . $n . '="v">x</div>'; ?>`, 'onmouseover="alert(1)" x', 'attr-name'],
];
for (const [name, body, payload, ctx] of PHP_CASES) {
  test(`[${name}] لا تعديل ويُسجَّل PHP_UNSAFE_CONTEXT (${ctx})`, () => {
    const out = XSSFixer.fix(PRELUDE + body, 'a.php');
    assert.strictEqual(out.changed, false);
    assert.strictEqual(out.fixed, PRELUDE + body);
    assert.ok(out.unresolved.some(u => u.kind === 'PHP_UNSAFE_CONTEXT' && u.reason.includes(ctx)),
      'لم يُسجَّل ' + ctx + ': ' + JSON.stringify(out.unresolved));
  });
  test(`[${name}] سلوكي (php حقيقي): لا هجوم فعّال دون تسجيل`, { skip: SKIP_PHP }, () => {
    const out = XSSFixer.fix(PRELUDE + body, 'a.php');
    const r = runPHP(out.fixed, payload);
    assert.ok(!r.err, 'الـPHP المُصلَح لا يعمل: ' + r.err);
    const hits = dangerous(newDoc(r.html).window.document);
    if (hits.length) assert.ok(out.unresolved.length > 0, 'الهجوم يعمل (' + hits + ') وunresolved فارغ');
  });
}

// السياق من كامل النص المتراكم — لا من المقطع السابق فقط
const PHP_ACCUM = [
  ['عبر عبارات echo منفصلة',          `<?php echo '<a href="'; echo $u; echo '">x</a>'; ?>`, 'attr-url'],
  ['عبر <?= وجزر متعددة',              `<a href="<?php if (1) { ?><?= $u ?><?php } ?>">x</a>`, 'attr-url'],
  ['بعد عدة مقاطع آمنة/ثابتة',         `<?php echo '<a title="t" href="' . intval($a) . $u . '">x</a>'; ?>`, null],
  ['HTML خارجي ثم echo بلا ثوابت',      `<a href="<?php echo $u; ?>">x</a>`, 'attr-url'],
  ['وسم مفتوح عبر جزيرتين',            `<div onclick="<?php echo 'f(' . $a . ',' ?>'<?php echo $u; ?>')">x</div>`, 'attr-handler'],
  ['print بدل echo',                   `<a href="<?php print $u; ?>">x</a>`, 'attr-url'],
  ['حرف كبير في اسم الـattribute',      `<a HREF="<?= $u ?>">x</a>`, 'attr-url'],
  ['attribute بسطر جديد قبل =',         `<a href\n=\n"<?= $u ?>">x</a>`, 'attr-url'],
  ['داخل <style> خارجي',               `<style>a{color:<?= $u ?>}</style>`, 'style'],
  ['اقتباس مفرد',                       `<a href='<?= $u ?>'>x</a>`, 'attr-url'],
  ['بلا اقتباس',                        `<input value=<?= $u ?>>`, 'attr-unquoted'],
  ['داخل style=""',                     `<p style="color:<?= $u ?>">x</p>`, 'attr-css'],
  ['ثوابت مجزّأة تكوّن onclick',         `<?php echo '<a on' . 'click="' . $u . '">x</a>'; ?>`, 'attr-handler'],
];
for (const [name, body, ctx] of PHP_ACCUM) {
  if (ctx === null) continue;
  test(`[PHP-ctx] ${name} ⇒ لا تعديل + ${ctx}`, () => {
    const out = XSSFixer.fix(PRELUDE + body, 'a.php');
    assert.strictEqual(out.fixed, PRELUDE + body, 'عُدِّل في سياق غير مدعوم');
    assert.ok(out.unresolved.some(u => u.kind === 'PHP_UNSAFE_CONTEXT' && u.reason.includes(ctx)), JSON.stringify(out.unresolved));
  });
}

test('[PHP-OK1] نص HTML عادي: يُعقَّم', { skip: SKIP_PHP }, () => {
  const out = XSSFixer.fix(PRELUDE + `<p><?= $u ?></p>`, 'a.php');
  assert.strictEqual(out.changed, true);
  const r = runPHP(out.fixed, IMG);
  assert.deepStrictEqual(dangerous(newDoc(r.html).window.document), []);
  assert.ok(r.html.includes('&lt;img'), 'الحمولة تُعرض نصًّا');
});
test('[PHP-OK2] attribute مقتبس عام: يُعقَّم بـENT_QUOTES', { skip: SKIP_PHP }, () => {
  const out = XSSFixer.fix(PRELUDE + `<span title="<?= $u ?>">x</span>`, 'a.php');
  assert.strictEqual(out.changed, true);
  const r = runPHP(out.fixed, '" onmouseover="alert(1)');
  assert.deepStrictEqual(dangerous(newDoc(r.html).window.document), []);
});
test('[PHP-OK3] href ببادئة /user/ : يُعقَّم', { skip: SKIP_PHP }, () => {
  const out = XSSFixer.fix(PRELUDE + `<a href="/user/<?= $u ?>">x</a>`, 'a.php');
  assert.strictEqual(out.changed, true);
  const r = runPHP(out.fixed, '" onclick="alert(1)');
  assert.deepStrictEqual(dangerous(newDoc(r.html).window.document), []);
});
test('[PHP-OK4] echo متعدد المقاطع في سياق نص يبقى مدعومًا', () => {
  const out = XSSFixer.fix(PRELUDE + `<?php echo '<li>' . $u . '</li>'; ?>`, 'a.php');
  assert.strictEqual(out.changed, true);
  assert.ok(/htmlspecialchars\(\(string\)\$u, ENT_QUOTES, 'UTF-8'\)/.test(out.fixed));
});
test('[PHP-OK5] وسم أُغلق ثم نص: السياق يعود نصًّا', () => {
  const out = XSSFixer.fix(PRELUDE + `<a href="/x">l</a><?= $u ?>`, 'a.php');
  assert.strictEqual(out.changed, true);
});
test('[PHP-OK6] تعليق HTML مغلق قبل الموقع', () => {
  const out = XSSFixer.fix(PRELUDE + `<!-- <a href=" --><p><?= $u ?></p>`, 'a.php');
  assert.strictEqual(out.changed, true);
});
test('[PHP-OK7] داخل تعليق HTML مفتوح ⇒ لا تعديل', () => {
  const out = XSSFixer.fix(PRELUDE + `<!-- <?= $u ?> -->`, 'a.php');
  assert.strictEqual(out.changed, false);
  assert.ok(out.unresolved.some(u => u.reason.includes('comment')));
});

// ═══ الواجهة العامة لم تتغيّر ═══════════════════════════════════════════
test('[API] fix() يُرجع الحقول المتفق عليها مع المنسّق', () => {
  const out = XSSFixer.fix(`function f(el,u){ el.innerHTML = '<a href="' + u + '">x</a>'; }`, 'a.js');
  for (const k of ['fixed', 'changed', 'edits', 'unresolved']) assert.ok(k in out, k);
  assert.strictEqual(typeof XSSFixer.canFix, 'function');
  assert.strictEqual(typeof XSSFixer.canFix([]), 'boolean');
});
