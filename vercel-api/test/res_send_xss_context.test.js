// ═══════════════════════════════════════════════════════
// [RES-SEND] بوابة التحقق ومَصرِف Express res.send — اختبارات سلبية وكشف
// تشغيل:  node --test vercel-api/test/res_send_xss_context.test.js
//
// res.send/res.status(…).send صار مَصرِف XSS في البوابة، ولا يُقبل لسطره إلا إثباتٌ في موضعه
// (mustProve): محوه الشكلي أو استبداله بـres.json (يغيّر نوع الرد) أو «علاجٌ» نصّي طُعم — كلها مرفوضة.
// والمحلل صار يرى res.status(n).send("…" + x) (كان غير مرئي).
// (الإصلاح التلقائي بالتهريب لم يُعتمد في هذا الإصدار: نوع الرد لا يُثبت من ملف واحد حين يضبطه middleware.)
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');

const { createRepairEngine } = require('../public/server_repair_adapter.js');
const { FixVerifier: FV } = require('../public/server_engine_registration.js');

const E = createRepairEngine();
const analyze = code => E.analyze(code, 's.js');
const gate = (b, a) => FV.verifyFix(b, a, 's.js', (c, f) => E.analyze(c, f));
const xssAt = (code, line) => analyze(code).filter(i => Number(i.line) === line &&
  /xss|cwe-79/i.test([i.type, i.title, i.cAct, i.cwe].join(' ')));

const handler = body => 'const express = require("express");\nconst app = express();\n' +
  'app.get("/hi", (req, res) => {\n' + body + '\n});\nmodule.exports = app;\n';

test('[RES-SEND-DET] res.status(200).send("…" + x) يُبلَّغ عنه (كان غير مرئي)', () => {
  assert.ok(xssAt(handler('  res.status(200).send("<p>" + req.query.name + "</p>");'), 4).length >= 1);
  assert.ok(xssAt(handler('  res.send("<p>" + req.query.name + "</p>");'), 4).length >= 1);
});

test('[RES-SEND-DET] المحرك لا يُنتج res.json بديلًا: السطر يبقى والبلاغ باقٍ', () => {
  const code = handler('  res.send("<h1>Hello " + req.query.name + "</h1>");');
  const out = E.repair(code, analyze(code), 's.js');
  assert.ok(!/res\.json/.test(out.repaired));
  assert.ok(xssAt(out.repaired, 4).length >= 1);
});

// ═══ 4. البوابة ═════════════════════════════════════════
test('[RES-SEND-GATE] محوُ المَصرِف الشكلي (join) يُخفيه عن الكواشف ومع ذلك يُرفض', () => {
  const b = handler('  res.send("<h1>Hello " + req.query.name + "</h1>");');
  const a = handler('  res.send(["<h1>Hello ", req.query.name, "</h1>"].join(""));');
  const v = gate(b, a);
  assert.notStrictEqual(v.accepted, true, v.reason);
});

test('[RES-SEND-GATE] محوٌ شكلي مع «علاج» نصّي طُعم (escapeHtml لا يهرّب شيئًا): الإثبات في الموضع إلزامي ⇒ رفض', () => {
  // بلا [mustProve] يكفي سطرٌ جديد يطابق نمط العلاج (escapeHtml() — ولو لا يهرّب شيئًا) لعدّه «علاجًا»،
  // والكواشف لا ترى المَصرِف بعد الـjoin، فكان المحو الشكلي يُقبل.
  const b = handler('  res.send("<h1>Hello " + req.query.name + "</h1>");');
  const a = handler('  res.send(["<h1>Hello ", escapeHtml(req.query.name), "</h1>"].join(""));') + '\nfunction escapeHtml(v) { return v; }\n';
  assert.strictEqual(xssAt(a, 4).length, 0, 'tripwire: الكواشف ما زالت ترى المَصرِف ⇒ الاختبار لا يقيس الإثبات');
  const v = gate(b, a);
  assert.notStrictEqual(v.accepted, true, v.reason);
  assert.match(String(v.reason), /^REJECTED_XSS_FIX_UNPROVEN/);
});

test('[RES-SEND-GATE] res.json بديلًا (يغيّر نوع الرد) يُرفض', () => {
  const b = handler('  res.send("<h1>Hello " + req.query.name + "</h1>");');
  const a = handler("  res.json({ message: String(req.query.name).replace(/[<>]/g, '') });");
  const v = gate(b, a);
  assert.notStrictEqual(v.accepted, true, v.reason);
  assert.match(String(v.reason), /XSS_FIX_UNPROVEN/);
});

test('[RES-SEND-GATE] تهريب بدالة غير معيارية + حذف البلاغ بطريقة أخرى لا يُقبل', () => {
  const b = handler('  res.send("<h1>Hello " + req.query.name + "</h1>");');
  const a = handler('  res.send("<h1>Hello " + esc(req.query.name) + "</h1>");') + '\nfunction esc(v) { return v; }\n';
  const v = gate(b, a);
  assert.notStrictEqual(v.accepted, true, v.reason);
});
