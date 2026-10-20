// ═══════════════════════════════════════════════════════════════════════
// إصلاحاتُ واجهة index.html — اختباراتٌ مستهدَفة على الملف الحقيقي
// تشغيل:  node --test vercel-api/test/ui_index_fixes.test.js
//
// الواجهةُ سكربتٌ مضمَّن في HTML، فتُحمَّل كما يُحمّلها المتصفّح: كل
// ‎<script src>‎ بالترتيب ثم المضمَّنة، في سياق vm بـDOM مُصطنَع. وما يُقاس
// هو سلوكُ الدوال الحقيقية لا نسخةٌ منها.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INDEX = path.join(PUBLIC_DIR, 'index.html');

// ─── سياقُ صفحةٍ كاملة ────────────────────────────────────────────────
function loadPage(opts) {
  opts = opts || {};
  const html = fs.readFileSync(INDEX, 'utf8');
  const noop = () => {};
  const store = new Map(opts.storage || []);
  const storageThrows = opts.storageThrows === true;
  const nodes = new Map();
  const toasts = [];

  const mkEl = id => ({
    id, style: {}, textContent: '', innerHTML: '', value: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop, removeChild: noop, remove() { nodes.delete(this.id); },
    addEventListener: noop, setAttribute: noop, focus: noop,
  });
  const getEl = id => { if (!nodes.has(id)) nodes.set(id, mkEl(id)); return nodes.get(id); };

  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout: (f) => { if (opts.runTimers) { try { f(); } catch (e) {} } return 0; },
    clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
    TextEncoder, TextDecoder, URL, URLSearchParams, Blob,
    Promise, JSON, Math, Date, Object, Array, String, Number, RegExp, Set, Map, Error,
    encodeURIComponent, decodeURIComponent, isNaN, parseInt, parseFloat,
    fetch: opts.fetch || (() => Promise.reject(new Error('no network'))),
    navigator: { userAgent: opts.ua || 'Mozilla/5.0 Chrome/120' },
    location: { hostname: 'x.vercel.app', search: opts.search || '', href: 'https://x/', pathname: '/' },
    history: { replaceState: noop },
    localStorage: {
      getItem: k => { if (storageThrows) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
      setItem: (k, v) => { if (storageThrows) throw new Error('blocked'); store.set(k, String(v)); },
      removeItem: k => { if (storageThrows) throw new Error('blocked'); store.delete(k); },
    },
    document: {
      body: { style: {}, appendChild: noop, addEventListener: noop,
              parentNode: { replaceChild: noop } },
      getElementById: getEl, createElement: () => mkEl('_new'),
      querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, title: '',
    },
    window: { addEventListener: noop },
  };
  Object.assign(ctx.window, ctx);
  ctx.window.window = ctx.window;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (_) {}
  }
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    try { vm.runInContext(m[1], ctx, { filename: 'inline' }); } catch (e) { ctx.__inlineError = e; }
  }
  ctx.__nodes = nodes;
  ctx.__store = store;
  ctx.__toasts = toasts;
  // التقط التنبيهات بدل إظهارها
  ctx.toast = (m, k) => toasts.push(String(m) + (k ? '|' + k : ''));
  return ctx;
}

const run = (ctx, expr) => vm.runInContext(expr, ctx);

// ═══ 1. بوابة المتصفح ═════════════════════════════════════════════════
test('[UI-1] لا بوابةَ تحجب المتصفّح ولا فحصَ user-agent في الصفحة', () => {
  const html = fs.readFileSync(INDEX, 'utf8');
  assert.ok(!/مخصص لمستخدمي التطبيق/.test(html), 'رسالة الحجب ما زالت موجودة');
  assert.ok(!/navigator\.userAgent/.test(html), 'فحص user-agent ما زال موجودًا');
  assert.ok(!/play\.google\.com/.test(html), 'رابط المتجر ما زال موجودًا');
  assert.ok(!/replaceChild\(\s*div\s*,\s*document\.body\s*\)/.test(html), 'استبدال body ما زال موجودًا');
});

// ═══ 2. fixAllWithAI لا تكتب — PENDING_REVIEW ════════════════════════
test('[UI-2] اقتراحُ AI يُحفَظ للمراجعة ولا يلمس الملف', async () => {
  const fixed = 'const q = "SELECT * FROM t WHERE id = ?";\ndb.execute(q, [id]);\n';
  const ctx = loadPage({
    fetch: (url) => {
      if (String(url).includes('/api/session')) return Promise.resolve({ ok: true, json: () => ({ token: 'T1' }) });
      if (String(url).includes('/api/chat'))    return Promise.resolve({ ok: true, json: () => ({ result: '```\n' + fixed + '```' }) });
      return Promise.reject(new Error('unexpected ' + url));
    },
  });
  const before = 'const q = "SELECT * FROM t WHERE id = " + id;\ndb.execute(q);\n';
  run(ctx, 'F["a.js"] = ' + JSON.stringify(before) + '; R["a.js"] = { code: F["a.js"], issues: analyzeCode(F["a.js"], "a.js") };');
  assert.ok(run(ctx, 'R["a.js"].issues.length') > 0, 'العيّنة بلا بلاغات — لا تختبر شيئًا');

  await run(ctx, 'fixAllWithAI()');

  assert.strictEqual(run(ctx, 'F["a.js"]'), before, 'الملفُ كُتب قبل الموافقة');
  assert.strictEqual(run(ctx, '_pendingCount()'), 1, 'الاقتراح لم يُحفَظ للمراجعة');
  assert.ok(ctx.__toasts.some(t => /بانتظار مراجعتك/.test(t)), 'لا إشعارَ مراجعة: ' + JSON.stringify(ctx.__toasts));

  // الاعتماد الصريح وحده يكتب
  const res = run(ctx, 'approvePending("a.js")');
  assert.strictEqual(res.applied, true, 'الاعتماد فشل: ' + res.reason);
  assert.strictEqual(run(ctx, 'F["a.js"]').trim(), fixed.trim(), 'الاعتماد لم يكتب المُرشَّح');
  assert.strictEqual(run(ctx, '_pendingCount()'), 0, 'بقي الاقتراح بعد اعتماده');
});

test('[UI-2b] الرفض يُهمل الاقتراح ولا يكتب شيئًا', () => {
  const ctx = loadPage();
  const before = 'var x = 1;\n';
  run(ctx, 'F["b.js"] = ' + JSON.stringify(before) + ';' +
           '_pending["b.js"] = { candidate: "let x = 1;\\n", reason: "ACCEPTED", source: "t", before: F["b.js"] };');
  run(ctx, 'rejectPending("b.js")');
  assert.strictEqual(run(ctx, 'F["b.js"]'), before, 'الرفض كتب على الملف');
  assert.strictEqual(run(ctx, '_pendingCount()'), 0);
});

test('[UI-2c] اقتراحٌ على نصٍّ قديم يُرفَض ولا يُطبَّق — ولو اجتاز البوابة', () => {
  const ctx = loadPage();
  // الأصل تغيّر بعد الاقتراح: إصلاحٌ آخر اعتُمد بينهما
  const v1 = 'const k = "sk_live_abc123xyz789def456ghi";\nvar n = 1;\n';
  const v2 = 'const k = process.env.K;\nvar n = 1;\n';          // اعتُمد بينهما
  const stale = 'const k = "sk_live_abc123xyz789def456ghi";\nlet n = 1;\n'; // بُني على v1
  run(ctx, 'F["s.js"] = ' + JSON.stringify(v2) + ';' +
           'R["s.js"] = { code: F["s.js"], issues: analyzeCode(F["s.js"], "s.js") };' +
           '_pending["s.js"] = { candidate: ' + JSON.stringify(stale) + ',' +
           ' reason: "ACCEPTED", source: "t", before: ' + JSON.stringify(v1) + ' };');

  const res = run(ctx, 'approvePending("s.js")');
  assert.strictEqual(res.applied, false, 'طُبِّق اقتراحٌ مبنيٌّ على نصٍّ قديم');
  assert.strictEqual(res.reason, 'STALE_BASE', 'السبب ليس قِدَم الأصل: ' + res.reason);
  assert.strictEqual(run(ctx, 'F["s.js"]'), v2, 'الملف تغيّر رغم الرفض — ابتُلع إصلاحٌ سابق');
  assert.ok(run(ctx, 'F["s.js"]').includes('process.env.K'), 'ضاع الإصلاح المُعتمَد بينهما');
  assert.strictEqual(run(ctx, '_pendingCount()'), 0, 'بقي الاقتراح القديم');
});

test('[UI-2d] وكلُّ اعتماد يمرّ بالبوابة من جديد — لا كتابةَ ثقةٍ بحكمٍ سابق', () => {
  const ctx = loadPage();
  // مُرشَّحٌ «مقبول» سابقًا لكنه لا يُحسّن شيئًا على الحالة الراهنة
  const cur = 'var a = 1;\n';
  run(ctx, 'F["g.js"] = ' + JSON.stringify(cur) + ';' +
           'R["g.js"] = { code: F["g.js"], issues: [] };' +
           '_pending["g.js"] = { candidate: ' + JSON.stringify(cur) + ',' +
           ' reason: "ACCEPTED", source: "t", before: ' + JSON.stringify(cur) + ' };');
  const res = run(ctx, 'approvePending("g.js")');
  assert.strictEqual(res.applied, false, 'كُتب مُرشَّحٌ لم تُقرّه البوابة الآن');
  assert.match(String(res.reason), /NO_CHANGE/, 'لم تُستشَر البوابة: ' + res.reason);
});

// ═══ 3. applyFix: الموضع واللغة ═══════════════════════════════════════
test('[UI-3] applyFix يستبدل سطرَ البلاغ ولا يُبقيه — js', () => {
  const ctx = loadPage();
  const src = [
    'function run(id) {',
    '  fetch("http://api.example.com/x");',
    '  return id;',
    '}',
  ].join('\n');
  run(ctx, 'F["x.js"] = ' + JSON.stringify(src) + '; R["x.js"] = { code: F["x.js"], issues: analyzeCode(F["x.js"], "x.js") };');
  assert.ok(run(ctx, 'R["x.js"].issues.length') > 0, 'العيّنة بلا بلاغات — لا تختبر شيئًا');
  run(ctx, 'applyFix("x.js", 1, "", ' + JSON.stringify('fetch("https://api.example.com/x");') + ', 0)');
  const out = run(ctx, 'F["x.js"]');
  assert.ok(!out.includes('http://'), 'السطر المعيب بقي في الناتج:\n' + out);
  assert.ok(out.includes('https://api.example.com'), 'الإصلاح لم يُطبَّق:\n' + out);
  assert.strictEqual(out.split('\n').length, src.split('\n').length, 'تغيّر عددُ الأسطر — أُدرج بدل الاستبدال');
  assert.match(out.split('\n')[1], /^ {2}fetch\(/, 'الإزاحة لم تُحفَظ');
});

test('[UI-3b] ولا يلتقط دالةً مجاورة — السطر المستهدَف وحده', () => {
  const ctx = loadPage();
  const src = [
    'def other():',
    '    return 1',
    'API_SECRET = "sk_live_abc123xyz789def456ghi"',
  ].join('\n');
  run(ctx, 'F["y.py"] = ' + JSON.stringify(src) + '; R["y.py"] = { code: F["y.py"], issues: analyzeCode(F["y.py"], "y.py") };');
  assert.ok(run(ctx, 'R["y.py"].issues.length') > 0, 'العيّنة بلا بلاغات — لا تختبر شيئًا');
  run(ctx, 'applyFix("y.py", 2, "", ' + JSON.stringify('API_SECRET = os.environ.get("API_SECRET")') + ', 0)');
  const out = run(ctx, 'F["y.py"]');
  assert.ok(out.includes('def other():') && out.includes('    return 1'),
    'جسمُ الدالة المجاورة تغيّر:\n' + out);
  assert.ok(out.includes('os.environ.get') && !out.includes('sk_live_'), 'الهدف لم يُستبدل:\n' + out);
});

test('[UI-3c] وإكمالُ جسم دالةٍ فارغة يبقى عاملًا — py', () => {
  const ctx = loadPage();
  const src = ['def f(a):', '    pass', ''].join('\n');
  run(ctx, 'F["z.py"] = ' + JSON.stringify(src) + '; R["z.py"] = { code: F["z.py"], issues: [] };');
  run(ctx, 'applyFix("z.py", 0, "", ' + JSON.stringify('return a + 1') + ', 0)');
  const out = run(ctx, 'F["z.py"]');
  assert.ok(out.includes('def f(a):'), 'سطرُ التعريف حُذف:\n' + out);
  assert.ok(/\n {4}return a \+ 1/.test(out), 'الجسم لم يُكمَّل بإزاحةٍ صحيحة:\n' + JSON.stringify(out));
  assert.ok(!out.includes('pass'), 'بقي pass مع الجسم الجديد:\n' + out);
});

test('[UI-3d] أربعُ لغات: الموضعُ صحيح، ولا سطرَ يُحذَف ولا يُضاف', () => {
  // ‎http://‎ بلاغٌ تعرفه كلُّ اللغات، فالمقارنة تقع على **الموضع** لا على
  // قدرة المحلّل. ولكلِّ عيّنةٍ سطرٌ قبل الهدف وسطرٌ بعده، ليظهر أيُّ انزلاق.
  const CASES = [
    ['js',  'app.js',  ['function a() {',   '  const u = "http://x.example.com/p";', '  return u;', '}'],
                        '  const u = "https://x.example.com/p";'],
    // بلا وسم إغلاق ‎?>‎: فاحص PHP لا يحسم ملفًّا فيه وسمُ إغلاق (حدٌّ مُعلَن)
    ['php', 'a.php',    ['<?php',           '$u = "http://x.example.com/p";',        '$n = 1;', '$m = 2;'],
                        '$u = "https://x.example.com/p";'],
    ['py',  'a.py',     ['def a():',        '    u = "http://x.example.com/p"',      '    return u'],
                        '    u = "https://x.example.com/p"'],
  ];
  for (const [lang, fname, srcLines, fix] of CASES) {
    const ctx = loadPage();
    const src = srcLines.join('\n');
    const li = 1;   // الهدف دائمًا السطر الثاني
    run(ctx, 'F[' + JSON.stringify(fname) + '] = ' + JSON.stringify(src) + ';' +
             'R[' + JSON.stringify(fname) + '] = { code: F[' + JSON.stringify(fname) + '],' +
             ' issues: analyzeCode(F[' + JSON.stringify(fname) + '], ' + JSON.stringify(fname) + ') };');
    const nIssues = run(ctx, 'R[' + JSON.stringify(fname) + '].issues.length');
    assert.ok(nIssues > 0, lang + ': العيّنة بلا بلاغات — لا تختبر شيئًا');

    run(ctx, 'applyFix(' + JSON.stringify(fname) + ', ' + li + ', "", ' + JSON.stringify(fix) + ', 0)');
    const out = run(ctx, 'F[' + JSON.stringify(fname) + ']');
    const o = out.split('\n');

    assert.strictEqual(o.length, srcLines.length,
      lang + ': تغيّر عددُ الأسطر ' + srcLines.length + ' ← ' + o.length + '\n' + out);
    assert.strictEqual(o[0], srcLines[0], lang + ': تغيّر السطرُ الذي قبل الهدف\n' + out);
    assert.strictEqual(o[o.length - 1], srcLines[srcLines.length - 1],
      lang + ': تغيّر السطرُ الأخير\n' + out);
    assert.strictEqual(o[li], fix, lang + ': الهدف لم يُستبدل بالنصّ المطلوب\n' + out);
    assert.ok(!out.includes('http://'), lang + ': السطر المعيب باقٍ\n' + out);
  }
});

test('[UI-3f] جافا صار لها فاحصٌ نحويّ، فالمُرشَّحُ الصحيحُ يُقبَل ويُكتَب', () => {
  // كان هذا الاختبارُ يوثّق الحدَّ المعاكس: لا فاحصَ لجافا فتردُّ البوابةُ
  // كلَّ مُرشَّحٍ مهما صحّ، وسأل نصُّه صراحةً «أضيف فاحصٌ نحوي؟». وقد أُضيف
  // في ‎[CLIKE-GATE]‎، فصار يُثبّت السلوكَ الجديد: قبولٌ للصحيح، ورفضٌ
  // للمكسور بدليلٍ بنيويّ، لا رفضٌ شاملٌ لغيابِ أداة.
  const ctx = loadPage();
  const src = ['class A {', '  String u = "http://x.example.com/p";', '  int n = 1;', '}'].join('\n');
  run(ctx, 'F["App.java"] = ' + JSON.stringify(src) + ';' +
           'R["App.java"] = { code: F["App.java"], issues: analyzeCode(F["App.java"], "App.java") };');
  const v = JSON.parse(run(ctx,
    'JSON.stringify((function(){var r = FixVerifier.verifyFix(F["App.java"],' +
    ' F["App.java"].replace("http://","https://"), "App.java", analyzeCode, {});' +
    ' return { accepted: r.accepted, reason: String(r.reason || ""), status: r.syntaxStatus };})())'));
  assert.strictEqual(v.accepted, true, 'مُرشَّحٌ صحيحٌ في جافا ما زال يُرَدّ: ' + v.reason);
  assert.doesNotMatch(v.reason, /REJECTED_NO_SYNTAX_CHECKER/);

  run(ctx, 'applyFix("App.java", 1, "", ' + JSON.stringify('  String u = "https://x.example.com/p";') + ', 0)');
  assert.match(run(ctx, 'F["App.java"]'), /https:\/\/x\.example\.com/, 'أقرّته البوابةُ ولم يُكتَب');

  // ولا يُقبل المكسور: قوسٌ ناقصٌ يُرَدّ بسببٍ بنيويٍّ مُسمًّى، لا بغيابِ فاحص.
  const w = JSON.parse(run(ctx,
    'JSON.stringify((function(){var r = FixVerifier.verifyFix(' +
    JSON.stringify(src) + ', ' + JSON.stringify(src.replace('\n}', '')) +
    ', "App.java", analyzeCode, {});' +
    ' return { accepted: r.accepted, reason: String(r.reason || "") };})())'));
  assert.strictEqual(w.accepted, false, 'قُبل مُرشَّحٌ مكسورٌ في جافا');
});

test('[UI-3e] وسطرٌ خارج المدى لا يُغيّر شيئًا', () => {
  const ctx = loadPage();
  const src = 'var a = 1;\n';
  run(ctx, 'F["o.js"] = ' + JSON.stringify(src) + '; R["o.js"] = { code: F["o.js"], issues: [] };');
  run(ctx, 'applyFix("o.js", 99, "", "X", 0)');
  assert.strictEqual(run(ctx, 'F["o.js"]'), src, 'سطرٌ خارج المدى غيّر الملف');
  run(ctx, 'applyFix("o.js", -1, "", "X", 0)');
  assert.strictEqual(run(ctx, 'F["o.js"]'), src, 'سطرٌ سالب غيّر الملف');
});

// ═══ 4. ZIP ═══════════════════════════════════════════════════════════
test('[UI-4] حدودُ ZIP ومساراتُه مكتوبةٌ في الصفحة', () => {
  const html = fs.readFileSync(INDEX, 'utf8');
  const at = html.indexOf("getElementById('inp-zip').addEventListener");
  assert.ok(at > 0, 'لم يُعثر على مُعالِج رفع ZIP');
  const block = html.slice(at, at + 4500);
  assert.match(block, /MAX_ARCHIVE/,  'لا حدَّ لحجم الأرشيف');
  assert.match(block, /MAX_PER_FILE/, 'لا حدَّ لحجم الملف بعد الفكّ');
  assert.match(block, /MAX_TOTAL/,    'لا حدَّ لمجموع ما يُفكّ');
  assert.match(block, /\\\.\\\./,     'لا حارسَ لمسارٍ صاعد');
  assert.ok(!/const name = path\.split\('\/'\)\.pop\(\)/.test(block),
    'المسار ما زال يُسطَّح إلى اسمِ ملف');
  assert.match(block, /let key = norm/, 'المفتاح ليس المسار الكامل');
});

// ═══ 5. الجلسة ════════════════════════════════════════════════════════
test('[UI-5] ‎?t=‎ ليس اعتمادَ API ولا يُرسَل ترخيصًا', async () => {
  // مقروءٌ من الخادم: ‎/api/webtoken‎ يُصدر HMAC على التاريخ مقطوعًا إلى 16،
  // و‎/api/chat‎ يقبل HMAC على نافذة العشر دقائق كاملةً. فلا يتطابقان.
  const seen = [];
  const ctx = loadPage({
    search: '?t=e25b3d52b7bab348&dev=1',
    fetch: (url, opt) => {
      seen.push({ url: String(url), auth: (opt && opt.headers && opt.headers.Authorization) || null });
      if (String(url).includes('/api/session')) return Promise.resolve({ ok: true, status: 200, json: () => ({ token: 'SRV', expiresIn: 600 }) });
      return Promise.resolve({ ok: true, status: 200, json: () => ({ result: '```\nx\n```' }) });
    },
  });
  const tok = await run(ctx, 'getToken()');
  assert.strictEqual(tok, 'SRV', 'الرمز لم يأتِ من /api/session');
  assert.notStrictEqual(tok, 'e25b3d52b7bab348', 'رمزُ الرابط استُعمل اعتمادًا — سيُرَدّ 401');
  await run(ctx, '(async () => chatAPI(await getToken(), "p"))()');
  const chat = seen.find(x => x.url.includes('/api/chat'));
  assert.ok(chat, 'لم يقع نداءُ chat');
  assert.strictEqual(chat.auth, 'Bearer SRV', 'الترخيص المُرسَل: ' + chat.auth);
});

test('[UI-5b] طلبٌ واحدٌ مشترك — ولا طلبَ لكل نداء', async () => {
  let n = 0;
  const ctx = loadPage({
    fetch: (url) => {
      if (String(url).includes('/api/session')) { n++; return Promise.resolve({ ok: true, status: 200, json: () => ({ token: 'SRV', expiresIn: 600 }) }); }
      return Promise.reject(new Error('x'));
    },
  });
  const [a, b, c] = await run(ctx, 'Promise.all([getToken(), getToken(), getToken()])');
  assert.deepStrictEqual([a, b, c], ['SRV', 'SRV', 'SRV']);
  await run(ctx, 'getToken()');
  assert.strictEqual(n, 1, 'طُلب رمزٌ أكثر من مرّة: ' + n);
});

test('[UI-5c] انتهاءُ الصلاحية: الرمزُ المخزون لا يُستعمل بعد نافذته', async () => {
  let n = 0;
  const ctx = loadPage({
    fetch: (url) => {
      if (String(url).includes('/api/session')) { n++; return Promise.resolve({ ok: true, status: 200, json: () => ({ token: 'T' + n, expiresIn: 600 }) }); }
      return Promise.reject(new Error('x'));
    },
  });
  assert.strictEqual(await run(ctx, 'getToken()'), 'T1');
  run(ctx, '_sessionExpiry = Date.now() - 1');          // النافذة انقضت
  assert.strictEqual(await run(ctx, 'getToken()'), 'T2', 'أُعيد استعمال رمزٍ منتهٍ');
  assert.strictEqual(n, 2);
});

test('[UI-5d] و401 من chat تُبطل المخزون وتُعيد النداء مرّةً واحدة', async () => {
  let sessions = 0, chats = 0;
  const ctx = loadPage({
    fetch: (url, opt) => {
      if (String(url).includes('/api/session')) { sessions++; return Promise.resolve({ ok: true, status: 200, json: () => ({ token: 'T' + sessions, expiresIn: 600 }) }); }
      chats++;
      const auth = (opt && opt.headers && opt.headers.Authorization) || '';
      if (auth === 'Bearer T1') return Promise.resolve({ ok: false, status: 401, json: () => ({ error: 'Invalid token' }) });
      return Promise.resolve({ ok: true, status: 200, json: () => ({ result: 'OK' }) });
    },
  });
  const out = await run(ctx, '(async () => chatAPI(await getToken(), "p"))()');
  assert.strictEqual(out, 'OK', 'لم يُعَد النداء برمزٍ جديد');
  assert.strictEqual(sessions, 2, 'لم يُجدَّد الرمز بعد 401: ' + sessions);
  assert.strictEqual(chats, 2, 'عددُ نداءات chat: ' + chats);
});

test('[UI-5e] و401 ثانية خطأٌ حقيقي يُرفَع ولا يدور', async () => {
  let chats = 0;
  const ctx = loadPage({
    fetch: (url) => {
      if (String(url).includes('/api/session')) return Promise.resolve({ ok: true, status: 200, json: () => ({ token: 'T', expiresIn: 600 }) });
      chats++;
      return Promise.resolve({ ok: false, status: 401, json: () => ({ error: 'Invalid token' }) });
    },
  });
  await assert.rejects(() => run(ctx, '(async () => chatAPI(await getToken(), "p"))()'), /خطأ في AI/);
  assert.strictEqual(chats, 2, 'لم تُحاوَل مرّةً واحدة فقط: ' + chats);
});

test('[UI-5f] وفشلُ الجلسة لا يُجمِّدها — المحاولة التالية تبدأ طلبًا جديدًا', async () => {
  let n = 0;
  const ctx = loadPage({
    fetch: (url) => {
      if (!String(url).includes('/api/session')) return Promise.reject(new Error('x'));
      n++;
      if (n === 1) return Promise.resolve({ ok: false, status: 429, json: () => ({ error: 'Too many requests' }) });
      return Promise.resolve({ ok: true, status: 200, json: () => ({ token: 'LATER', expiresIn: 600 }) });
    },
  });
  await assert.rejects(() => run(ctx, 'getToken()'), /تجاوزت الحد/);
  assert.strictEqual(await run(ctx, 'getToken()'), 'LATER', 'الطلبُ الفاشل جمّد الجلسة');
});

// ═══ 6. عدّ الإصلاحات ════════════════════════════════════════════════
test('[UI-6] الجردُ شاملٌ وحصري، والعدّ بالبلاغات لا بالملفات', () => {
  const html = fs.readFileSync(INDEX, 'utf8');
  const at = html.indexOf('function fixAllEngineUI');
  const fn = html.slice(at, at + 4500);
  assert.match(fn, /other\+\+/, 'قرارٌ غير مصنَّف ما زال يسقط من الجرد');
  assert.match(fn, /issuesBefore/, 'لا يُقاس عددُ البلاغات قبل');
  assert.match(fn, /issuesAfter/,  'لا يُقاس عددُ البلاغات بعد');
  assert.match(fn, /fixedIssues/,  'الرسالة ما زالت تعدّ الملفات وحدها');

  const ai = html.slice(html.indexOf('async function fixAllWithAI'), html.indexOf('async function fixAllWithAI') + 3000);
  assert.match(ai, /noOutput\+\+/, 'ملفٌ بلا ناتج من AI ما زال يسقط من الجرد');
});

test('[UI-6b] الصفرُ في تمريرةٍ ثانية لا يُقرأ فشلًا — العدّ تراكمي', () => {
  // العيبُ المقيس على مستخدمٍ حقيقي: ‎GameServer.js‎ دخل بـ33 بلاغًا وخرج
  // بـ11 بعد 22 إصلاحًا. ثم ضغطةٌ ثانية على الزر نفسه أنتجت
  //     «أُصلحت 0 مشكلة من 11»
  // وهي صحيحةٌ لتمريرتها وكاذبةٌ في أثرها: قرأها المستخدم «المحرّك لا
  // يفعل شيئًا» وقد كان قد فرغ ممّا يستطيع إصلاحه بأمان. فالرسالةُ تحمل
  // الآن إجمالَ الجلسة، وتفسّر الصفرَ بدل عرضه عاريًا.
  const html = fs.readFileSync(INDEX, 'utf8');
  const at = html.indexOf('function fixAllEngineUI');
  const fn = html.slice(at, at + 4500);

  assert.match(fn, /_engineFixedTotal/, 'لا عدّادَ تراكميًا للجلسة');
  assert.match(fn, /_engineFixedTotal\s*=\s*\(window\._engineFixedTotal\s*\|\|\s*0\)\s*\+\s*fixedIssues/,
    'الإجمالي لا يتراكم عبر التمريرات');
  assert.match(fn, /لا شيء آخر يُصلَح آليًا/,
    'الصفرُ ما زال يُعرَض بلا تفسير');

  // والفرعُ الثالث قائم: صفرٌ بلا إصلاحٍ سابق ليس كصفرٍ بعد إصلاح
  assert.match(fn, /لم يُصلَح شيء آليًا/,
    'لا تمييزَ بين صفرٍ من أول تمريرة وصفرٍ بعد إصلاح');

  // ولا يُعلَن نجاحٌ على فراغ: نغمةُ الرسالة تتبع الإجمالي لا التمريرة
  assert.match(fn, /fixedIssues \? 's' : \(total > 0 \? 's' : 'w'\)/,
    'نغمةُ الرسالة لا تميّز الفراغ من الاكتمال');
});

// ═══ 7. نافذة الترحيب ════════════════════════════════════════════════
test('[UI-7] تظهر مرّةً واحدة، ولا ترمي حين يُحجب التخزين', () => {
  const disp = c => run(c, "document.getElementById('welcome-modal').style.display");
  const fresh = loadPage();
  assert.strictEqual(disp(fresh), 'flex', 'لم تظهر لزائرٍ جديد');

  const seen = loadPage({ storage: [['re_welcomed', '1']] });
  assert.notStrictEqual(disp(seen), 'flex', 'ظهرت رغم الإقرار السابق');

  const blocked = loadPage({ storageThrows: true });
  assert.strictEqual(blocked.__inlineError, undefined,
    'التخزين المحجوب أسقط السكربت: ' + (blocked.__inlineError && blocked.__inlineError.message));
  assert.doesNotThrow(() => run(blocked, 'closeWelcome()'), 'closeWelcome ترمي عند حجب التخزين');
  assert.strictEqual(disp(blocked), 'none', 'لم تُغلَق');
});

test('[UI-3g] ومسارُ applyFix لا يكتب رُقعةً تُضاعف القيمة', () => {
  // ‎[NO-DOUBLE-GATE]‎ في البوابة، و‎applyFix‎ لا يكتب إلا ما تُقرّه. فحتى
  // لو وصل الزرَّ اقتراحٌ يقلب ‎x = x + 1‎ إلى ‎x += x + 1‎ — من كاشفٍ جديد
  // أو من خارجِ المحرّك، وبأيِّ درجةِ ثقة — يبقى الملفُّ كما هو.
  const ctx = loadPage();
  const src = ['function f(xs) {', '  let count = 0;',
               '  for (const x of xs) { count = count + 1; }', '  return count;', '}'].join('\n');
  run(ctx, 'F["acc.js"] = ' + JSON.stringify(src) + ';' +
           'R["acc.js"] = { code: F["acc.js"], issues: analyzeCode(F["acc.js"], "acc.js") };');
  const v = JSON.parse(run(ctx,
    'JSON.stringify((function(){var r = FixVerifier.verifyFix(F["acc.js"],' +
    ' F["acc.js"].replace("count = count + 1", "count += count + 1"), "acc.js", analyzeCode, {});' +
    ' return { accepted: r.accepted, reason: String(r.reason || "") };})())'));
  assert.strictEqual(v.accepted, false, 'البوابةُ قبلت رُقعةَ تضاعف');
  assert.match(v.reason, /^REJECTED_ACCUM_DOUBLES/);

  run(ctx, 'applyFix("acc.js", 2, ' + JSON.stringify('  for (const x of xs) { count = count + 1; }') +
           ', ' + JSON.stringify('  for (const x of xs) { count += count + 1; }') + ', 0)');
  assert.strictEqual(run(ctx, 'F["acc.js"]'), src, 'كُتبت رُقعةٌ تُضاعف القيمة');
});
