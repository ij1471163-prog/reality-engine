// ═══════════════════════════════════════════════════════
// [CMD-WHOLE] الحالةُ الأصليةُ ٤: رفضٌ صحيحٌ كان بلا سبب
// ═══════════════════════════════════════════════════════
//
// ‎cp.exec(req.query.cmd)‎ — لا نصَّ حرفيًّا في الوسيط، فاسمُ الأمرِ نفسُه من
// المُدخَل. والمحرّكُ يُولّد تخفيفًا (تعقيمَ أحرف) ثم ترفضه البوابةُ بـ
// ‎REJECTED_NO_IMPROVEMENT‎ ثم ‎GHOST_DISCARDED_BATCH — no_candidate‎.
//
// والرفضُ **صحيح**، مُثبَتًا بالتنفيذِ الفعليِّ في مجلّدٍ مؤقّتٍ على ثلاثةِ
// احتمالات، بأربعةِ مدخلاتٍ سليمةٍ وثماني حمولاتٍ غيرِ ضارّةٍ تُنشئ ملفًا
// إن نُفِّذت:
//
//                            سلوكٌ سليم   حقنُ شِلٍّ مُنِع   ‎cat /etc/passwd‎
//   ① تعقيمُ أحرفٍ + شِل          4/4          8/8          ⚠️ قرأ الملف
//   ② ‎execFile‎ على المُدخَلِ كلِّه 4/4          7/8          ⚠️ قرأ الملف
//   ③ قائمةُ أوامرٍ + ‎execFile‎    4/4          8/8          ⚠️ قرأ الملف
//
// فالثلاثةُ تقرأ ‎/etc/passwd‎: ‎cat /etc/passwd‎ أمرٌ مشروعٌ بوسيطٍ مشروع،
// والثغرةُ ليست في الشِلِّ بل في أن الأمرَ بيدِ المُهاجِم. و② **أسوأُ** من
// التعقيم: يُمرّر ‎-fprintf PWN‎ وسيطًا حقيقيًّا لـ‎find‎ فيُنشئ الملف.
//
// ⇒ فصلُ الأمرِ عن الوسائطِ لا يُعالج هذا الشكل، فيبقى مرفوضًا. والذي تغيّر
// هو **بيانُ السبب** وحدَه: ‎aiNeeded‎ يحمل الآن السببَ والعلاجَ المطلوب،
// ولا قرارَ واحدًا تغيّر — لا قبولٌ صار رفضًا ولا العكس.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadCtx() {
  const noop = () => {};
  const store = new Map();
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop,
                createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null),
                    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const f = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(f)) continue;
    try { vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة */ }
  }
  return ctx;
}
const repair = (ctx, code, file) => {
  const iss = ctx.analyzeCode(code, file) || [];
  return { iss, out: ctx.repairCode(code, iss.map(x => Object.assign({}, x)), file) };
};
const WHOLE = /CMD_WHOLE_COMMAND_FROM_INPUT/;

test('[CW-1] الحالةُ الأصلية: تبقى مرفوضةً ويُبيَّن السببُ والعلاج', () => {
  const ctx = loadCtx();
  const code = 'const cp = require("child_process");\nfunction run(req) {\n' +
               '  return cp.exec(req.query.cmd);\n}\nmodule.exports = { run };\n';
  const { out } = repair(ctx, code, 'execBare.js');

  // ① القرارُ كما هو: لا إصلاحَ مُطبَّق، والشفرةُ لم تتغيّر
  assert.ok(!(out.repairs || []).some(r => /CMD_INJECTION/.test(r.strategy)),
    'طُبِّق تخفيفٌ على شكلٍ لا يُعالَج');
  assert.strictEqual(out.repaired, code, 'الشفرةُ تغيّرت مع أن القرارَ رفض');

  // ② والسببُ صار مقروءًا بالعلاجِ المطلوب
  const ai = (out.aiNeeded || []).filter(a => WHOLE.test(String(a.reason || '')));
  assert.strictEqual(ai.length, 1, 'لا بيانَ سببٍ في aiNeeded: ' + JSON.stringify(out.aiNeeded));
  assert.strictEqual(ai[0].line, 3);
  assert.match(String(ai[0].strategy), /^CMD_INJECTION/);
  assert.match(String(ai[0].reason), /execFile|spawn/, 'العلاجُ غيرُ مذكور');
  assert.match(String(ai[0].reason), /cat \/etc\/passwd/, 'الدليلُ غيرُ مذكور');
});

test('[CW-2] والتخفيفُ المشروعُ لم يُمَسّ — اسمُ الأمرِ ثابتٌ في نصٍّ حرفيّ', () => {
  // هذه هي الحالاتُ التي يُصلحها المحرّكُ اليوم. أيُّ تغييرٍ فيها تراجُع.
  const ctx = loadCtx();
  const KEEP = [
    ['js: exec("ls " + d)', 'ok.js',
     'const cp = require("child_process");\nfunction run(d) {\n  return cp.exec("ls " + d);\n}\nmodule.exports = { run };\n',
     /const safeArgs = "ls " \+ d\.replace/],
    ['py: os.system("ls " + d)', 'ok.py',
     'import os\ndef run(d):\n    os.system("ls " + d)\n', /shlex/],
    ['py: os.system(cmd)', 'okv.py',
     'import os\ndef run(cmd):\n    os.system(cmd)\n', /shlex/],
  ];
  for (const [label, file, code, rx] of KEEP) {
    const { out } = repair(ctx, code, file);
    assert.ok((out.repairs || []).some(r => /CMD_INJECTION/.test(r.strategy)),
      'تراجُع: لم يُطبَّق التخفيفُ على ' + label + ' — ' +
      (out.rejected || []).map(r => r.reason).join(' | ').slice(0, 120));
    assert.match(out.repaired, rx, label + ': شكلُ التخفيفِ تغيّر');
    // وصنفٌ أُصلح لا يظهر في aiNeeded (عقدُ security_no_drop)
    assert.ok(!(out.aiNeeded || []).some(a => WHOLE.test(String(a.reason || ''))),
      label + ': بيانُ «الأمرُ كلُّه من المُدخَل» ظهر على شكلٍ أُصلح');
  }
});

test('[CW-3] والبيانُ لا يُضاف إلا حين لا يوجد إصلاحٌ على السطرِ نفسِه', () => {
  // الحدُّ الذي يحفظ عقدَ ‎security_no_drop‎: «صنفٌ أُصلح لا يبقى في aiNeeded».
  const ctx = loadCtx();
  const code = 'const cp = require("child_process");\nfunction a(d) {\n  return cp.exec("ls " + d);\n}\n' +
               'function b(req) {\n  return cp.exec(req.query.cmd);\n}\nmodule.exports = { a, b };\n';
  const { out } = repair(ctx, code, 'mix.js');
  const ai = (out.aiNeeded || []).filter(a => WHOLE.test(String(a.reason || '')));
  const fixedLines = (out.repairs || []).filter(r => /CMD_INJECTION/.test(r.strategy)).map(r => r.line);
  for (const a of ai)
    assert.ok(!fixedLines.includes(a.line),
      'بيانٌ على سطرٍ أُصلح: س' + a.line + ' ضمن ' + JSON.stringify(fixedLines));
});

test('[CW-4] ولا يُكرَّر البيانُ على السطرِ نفسِه', () => {
  const ctx = loadCtx();
  const code = 'const cp = require("child_process");\nfunction run(req) {\n' +
               '  return cp.exec(req.query.cmd);\n}\nmodule.exports = { run };\n';
  const { out } = repair(ctx, code, 'execBare.js');
  const seen = new Set();
  for (const a of (out.aiNeeded || []).filter(x => WHOLE.test(String(x.reason || '')))) {
    const k = a.line + '|' + a.strategy;
    assert.ok(!seen.has(k), 'بيانٌ مُكرَّرٌ على ' + k);
    seen.add(k);
  }
});
