// ═══════════════════════════════════════════════════════
// اختبارات رفض candidate XSS لـres.send في repair_engine.js
// تشغيل:  node --test vercel-api/test/repair_xss_candidate.test.js
//
// فرع res.send(... + ...) في fixXSS يحوّل res.send إلى res.json — هذا يغيّر
// نوع الاستجابة وشكلها (والـAnalyzer نفسه يقول إنه ليس الإصلاح الصحيح).
// candidate كهذا يُرفض بـXSS_RESPONSE_CHANGED: repairedCode لا يتغير، المشكلة
// لا تُحذف، و aiRequired تستمر إلى aiNeeded.
// فرع innerHTML / outerHTML: بلا مُصلح XSS سياقي محمَّل (هذا السياق لا يحمّل xss_fix.js)
// يُقبل textContent فقط حين تكون القيمة متغيرًا واحدًا بلا وسوم؛ والوسوم أو outerHTML تُترك مع السبب.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const noop = () => {};
const ctx = { console: { log: noop, warn: noop, error: noop, info: noop } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'repair_engine.js'), 'utf8'), ctx,
  { filename: 'repair_engine.js' });

// نفس شكل issue الذي يُخرجه analyzer.js لـres.send
const SEND_TITLE = '🔴 XSS في res.send — user input مباشر';
const sendIssue = (code, line) => ({
  type: 'js', sev: 'c', line, ev: code.split('\n')[line - 1].trim(),
  title: SEND_TITLE, aiRequired: true, cAct: 'CWE-79 XSS',
});

function run(code, issues, file) {
  const snapshot = JSON.stringify(issues);
  const out = ctx.repairCode(code, issues, file || 'a.js');
  assert.strictEqual(JSON.stringify(issues), snapshot, 'issues must not be modified');
  return out;
}

const wrap = body => `app.get("/", (req, res) => {\n${body}\n});`;

const BAD = {
  'member access (String(req))':  '  res.send("Hello " + req.query.name);',
  'bracket access (String(req))': '  res.send("Hi " + req.query["name"]);',
  'plain variable':               '  res.send("Hello " + name);',
  'HTML wrapper':                 '  res.send("<h1>" + name + "</h1>");',
  'two variables':                '  res.send("A=" + a + " B=" + b);',
  'variable first (String(data))':'  res.send(name + " logged in");',
  'constants only (String(data))':'  res.send("Hello " + "world");',
  'function call (broken syntax)':'  res.send("Hi " + escapeHtml(req.query.name));',
  'internal value':               '  res.send("Count: " + count);',
};

// ═══ res.send(... + ...) → res.json يُرفض ═══════════════
for (const [name, body] of Object.entries(BAD)) {
  test(`res.send ${name} → rejected with XSS_RESPONSE_CHANGED, code unchanged, stays aiRequired`, () => {
    const code = wrap(body);
    const out = run(code, [sendIssue(code, 2)]);
    assert.strictEqual(out.repaired, code, 'rejected candidate must not change repairedCode');
    assert.strictEqual(out.repairs.length, 0);
    assert.strictEqual(out.rejected.length, 1);
    assert.strictEqual(out.rejected[0].line, 2);
    assert.strictEqual(out.rejected[0].strategy, 'XSS_INNER_HTML');
    assert.match(out.rejected[0].reason, /^XSS_RESPONSE_CHANGED/);
    assert.strictEqual(out.aiNeeded.length, 1, 'aiRequired issue must continue to aiNeeded');
    assert.strictEqual(out.aiNeeded[0].line, 2);
    assert.strictEqual(out.aiNeeded[0].strategy, 'XSS_INNER_HTML');
    assert.ok(!/res\.json/.test(out.repaired));
  });
}

test('real analyzer + server adapter: res.send XSS stays reported and goes to aiNeeded', () => {
  const { createRepairEngine } = require(path.join(PUBLIC_DIR, 'server_repair_adapter.js'));
  const engine = createRepairEngine();
  const code = wrap('  res.send("Hello " + req.query.name);');
  // لا يُثبَّت نصُّ عنوانٍ بعينه: أكثر من كاشف يُبلّغ عن نفس الثغرة على نفس
  // السطر (analyzer يقول «XSS في res.send»، وknowledge_base يقول «XSS —
  // user input في output» بثقةٍ أعلى)، وdedupeIssues يُبقي الأعلى ثقةً.
  // فالمطلوب أن تبقى الثغرة **مُبلَّغًا عنها وموجَّهةً إلى AI** لا أن يفوز
  // كاشفٌ بعينه. وaiRequired صار يُدمَج فلا يسقط مع الخاسر ([MERGE-KEEP]).
  const xssOn = (list, line) => list.filter(i => i.line === line && /xss/i.test(String(i.type) + ' ' + String(i.title)));
  const issues = engine.analyze(code, 'a.js');
  const xss = xssOn(issues, 2);
  assert.ok(xss.length >= 1, 'لا بلاغ XSS على سطر res.send: ' + JSON.stringify(issues.map(i => i.title)));
  assert.ok(xss.some(i => i.aiRequired === true),
    'بلاغ XSS بلا aiRequired ⇒ لا مسار له إلى AI: ' + JSON.stringify(xss.map(i => i.title)));

  const out = engine.repair(code, issues, 'a.js');
  assert.strictEqual(out.repaired, code);
  // server_repair_adapter يُرجع repaired/repairs/aiNeeded فقط (لا rejected)
  assert.ok(out.aiNeeded.some(a => a.strategy === 'XSS_INNER_HTML' && a.line === 2));
  assert.ok(xssOn(engine.analyze(out.repaired, 'a.js'), 2).length >= 1,
    'the XSS issue must still be reported on the returned code');
});

// ═══ innerHTML / outerHTML — byte-identical ═════════════
const XSS_TITLE = '🔴 XSS — innerHTML';
// كان يشمل: "<b>" + name + "</b>" → textContent (يعرض <b> نصًّا) و outerHTML → textContent
// (يعدّل المحتوى بدل استبدال العنصر). تغيّر عمدًا: كلاهما يغيّر سلوكًا صحيحًا — انظر NOT_EQUIVALENT.
const SOUND = [
  ['el.innerHTML = userInput;', 'el.textContent = userInput;'],
  ['  box.innerHTML=html', '  box.textContent =html'],
];
const NOT_EQUIVALENT = [
  ['div.innerHTML = "<b>" + name + "</b>";', /^XSS_NO_CONTEXT_FIXER/],
  ['el.outerHTML = html;', /^XSS_OUTERHTML_NO_EQUIVALENT/],
];
for (const [before, reason] of NOT_EQUIVALENT) {
  test(`no context fixer: ${before.trim()} is left unchanged (textContent would change rendering) and the reason is recorded`, () => {
    const code = `function f(html, name, userInput) {\n${before}\n}`;
    const out = run(code, [{ line: 2, title: XSS_TITLE, ev: before.trim() }]);
    assert.strictEqual(out.repaired, code);
    assert.strictEqual(out.repairs.length, 0);
    assert.ok(out.declined.some(d => reason.test(d.reason)), JSON.stringify(out.declined));
  });
}
for (const [before, after] of SOUND) {
  test(`sound: ${before.trim()} → ${after.trim()} (unchanged output)`, () => {
    const code = `function f(html, name, userInput) {\n${before}\n}`;
    const issue = { line: 2, title: XSS_TITLE, ev: before.trim() };
    const out = run(code, [issue]);
    assert.strictEqual(out.rejected.length, 0);
    assert.strictEqual(out.repairs.length, 1);
    assert.strictEqual(out.repaired, `function f(html, name, userInput) {\n${after}\n}`);
    assert.strictEqual(out.repaired,
      ctx.fixXSS(code, issue, code.split('\n'), 'js').fixed, 'must equal the original fixer output');
  });
}

// ═══ res.send بدون + لا يتأثر ═══════════════════════════
for (const body of ['  res.send(html);', '  res.send("OK");', '  res.send(`Hello ${name}`);']) {
  test(`res.send without + is untouched: ${body.trim()}`, () => {
    const code = wrap(body);
    const out = run(code, [{ line: 2, title: SEND_TITLE, ev: body.trim() }]);
    assert.strictEqual(out.repaired, code);
    assert.strictEqual(out.repairs.length, 0);
    assert.strictEqual(out.rejected.length, 0);
  });
}

// ═══ ملف مختلط: innerHTML يُصلح، res.send يُرفض ═════════
test('mixed file: innerHTML fix applied, res.send candidate rejected', () => {
  const code = [
    'function show(el, v) {',
    '  el.innerHTML = v;',
    '}',
    'app.get("/", (req, res) => {',
    '  res.send("Hello " + req.query.name);',
    '});',
  ].join('\n');
  const out = run(code, [
    { line: 2, title: XSS_TITLE, ev: 'el.innerHTML = v;' },
    sendIssue(code, 5),
  ]);
  assert.strictEqual(out.repaired, code.replace('el.innerHTML = v;', 'el.textContent = v;'));
  // مصفوفات الـvm من realm آخر → مقارنة JSON
  assert.strictEqual(JSON.stringify(out.repairs.map(r => r.line)), '[2]');
  assert.strictEqual(JSON.stringify(out.rejected.map(r => [r.line, r.reason.split(' ')[0]])), '[[5,"XSS_RESPONSE_CHANGED"]]');
  assert.strictEqual(JSON.stringify(out.aiNeeded.map(a => a.line)), '[5]');
});
