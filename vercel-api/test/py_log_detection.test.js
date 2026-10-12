// ═══════════════════════════════════════════════════════
// [PY-LOG] تسريبُ أسرارِ اللوج في بايثون — الاكتشافُ كان المانع
// ═══════════════════════════════════════════════════════
//
// السببُ الجذري، مُثبَتًا بسؤالَين منفصلين لا بسؤالٍ واحد:
//
//   ① هل يُكتشَف؟   ② هل يملك المحرّكُ إصلاحَه؟
//
//     logging.info/debug/warning        ✓ يُكتشَف   ✓ يُصلَح
//     logging.error/critical/exception  ✘ لا        ✓ يُصلَح
//     logging.warn/log                  ✘ لا        ✓ يُصلَح
//
// أي أن ‎fixLogSecret‎ تُنتج ‎logging.error("[REDACTED]")‎ صحيحًا لثمانيةٍ من
// ثمانية، ولم يكن يُستدعى لخمسةٍ منها لأن البلاغ لا يُنشأ أصلًا. والمانعُ
// في ‎extended_patterns.js‎ — محرّكٌ لم يُمَسّ في أيِّ جولةٍ سابقة — حيث
// كانت قائمةُ الدوالّ ‎info|debug|warning‎ وحدها: ثلاثٌ من تسعٍ في واجهة
// ‎logging‎ القياسية.
//
// فهذا مثالٌ على عَرَضٍ في مرحلةٍ (لا إصلاح) وسببٍ في مرحلةٍ أخرى (الاكتشاف).
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

const LEAK_RX = /DATA_EXPOSURE|Sensitive Data in Logs|Sensitive Data via print/;
const leaks = (ctx, code) => (ctx.analyzeCode(code, 'p.py') || [])
  .filter(i => LEAK_RX.test(String(i.type || '') + String(i.title || '')));
const logLine = src => (src.split('\n').find(l => /logging\.|print\(/.test(l)) || '').trim();

// واجهةُ ‎logging‎ القياسية بكاملها
const METHODS = ['info', 'debug', 'warning', 'warn', 'error', 'critical', 'fatal', 'exception', 'log'];
const mod = m => 'import logging\n\ndef handle(password):\n    logging.' + m + '(password)\n';

for (const m of METHODS) {
  test('[PY-LOG-1] يُكتشَف ويُنقَّح — logging.' + m, () => {
    const ctx = loadCtx();
    const code = mod(m);

    // ① البلاغُ يُنشَأ — وهذا ما كان مفقودًا لخمسٍ من التسع
    assert.ok(leaks(ctx, code).length > 0,
      'لا بلاغَ تسريبٍ على logging.' + m + ' — الاكتشافُ هو المانع');

    // ② والمسارُ الكامل يُنقّح فعلًا
    const before = ctx.analyzeCode(code, 'p.py') || [];
    const out = ctx.repairCode(code, before.map(x => Object.assign({}, x)), 'p.py');
    assert.notStrictEqual(out.repaired, code, 'لم يُطبَّق تنقيحٌ على logging.' + m);
    assert.ok((out.repairs || []).some(r => r.strategy === 'LOG_SECRET'),
      'لم يُسجَّل إصلاحُ LOG_SECRET على logging.' + m);

    // ③ والنجاحُ يُقاس بالقيمة لا باختفاء البلاغ: السرُّ غاب، والدالّةُ بقيت
    const line = logLine(out.repaired);
    assert.ok(line.includes('[REDACTED]'), 'لا عَلَمَ تنقيحٍ: ' + line);
    assert.ok(!/\bpassword\b/.test(line), 'المُعرِّفُ الحسّاس ما زال يُسجَّل: ' + line);
    assert.ok(line.startsWith('logging.' + m + '('),
      'اسمُ دالّةِ التسجيل تغيّر — التنقيحُ يمسّ ما ليس له: ' + line);
  });
}

test('[PY-LOG-2] السببُ في الاكتشاف لا في الإصلاح — القدرةُ كانت قائمةً للتسع', () => {
  // يُستدعى المُصلِحُ مباشرةً، بمعزلٍ عن الاكتشاف. ينجح هذا الاختبارُ على
  // الشفرة القديمة أيضًا — وهو المقصود: يُثبّت أن العجزَ لم يكن هناك.
  const ctx = loadCtx();
  assert.strictEqual(typeof ctx.fixLogSecret, 'function', 'tripwire: المُصلِحُ غيرُ منشور');
  for (const m of METHODS) {
    const code = mod(m);
    const r = ctx.fixLogSecret(code, { line: 4, ev: 'logging' }, code.split('\n'), 'py');
    assert.ok(r && r.patch, 'fixLogSecret لا تُنتج إصلاحًا لـlogging.' + m);
    assert.ok(r.patch.includes('[REDACTED]') && r.patch.startsWith('logging.' + m + '('),
      'إصلاحٌ معيبٌ لـlogging.' + m + ': ' + r.patch);
  }
});

test('[PY-LOG-3] ولا تُمَسّ أسطرُ التهيئة ولا القيمُ السليمة', () => {
  // توسيعُ قائمةِ الدوالّ لا يُنتج بلاغًا على ما لا يُسجّل شيئًا. والدوالُّ
  // تُعَدّ صريحةً لا بـ‎\w+‎: الأخيرةُ تُطابق ‎getLogger‎ و‎basicConfig‎.
  const ctx = loadCtx();
  const BENIGN = [
    'import logging\nlogger = logging.getLogger("password_service")\n',
    'import logging\nlogging.basicConfig(filename="secret.log")\n',
    'import logging\nlogging.getLogger().addHandler(logging.FileHandler("token.log"))\n',
    'import logging\nlogging.getLogger("secret").setLevel(logging.DEBUG)\n',
    'import logging\n# log the password here later\nlogging.info("ready")\n',
    'import logging\n\ndef handle(name):\n    logging.error(name)\n',
  ];
  for (const code of BENIGN) {
    const out = ctx.repairCode(code, (ctx.analyzeCode(code, 'p.py') || []).map(x => Object.assign({}, x)), 'p.py');
    assert.strictEqual(out.repaired, code,
      'شفرةٌ لا تُسجّل سرًّا عُدِّلت: ' + logLine(out.repaired));
  }
});

test('[ENG-1] لا يُظلِّل ملفٌ دالّةً عامّةً لملفٍ آخر — إلا ما هو معلومٌ وموثَّق', () => {
  // ⚠️ هذا الحارسُ وُضع لعيبٍ مُقاس: ‎project_intelligence.js‎ تُعرّف
  // ‎extractFunctions(lines, ext)‎، و‎test_generator.js‎ تُعرّف
  // ‎extractFunctions(code, ext)‎ وتُحمَّل بعدها (السطر 114 مقابل 107)،
  // فتفوز في النطاق العام. و‎parseFile‎ تُمرّر مصفوفةَ أسطر، فتُنادى نسخةُ
  // النصّ وترمي ‎code.split is not a function‎ — فيموت ‎analyzeProject‎
  // في **كل** نداء، و‎runEngine‎ يبتلع الاستثناء ويُرجع ‎[]‎.
  //
  // ومقيسٌ أن إحياءَه لا يُنتج بلاغًا (ناتجُه كائنٌ بلا ‎issues‎، و‎engineList‎
  // لا تقرأ إلا ‎result.issues‎)، فلم يُصلَح في هذه الجولة. وهذا الحارسُ
  // يُثبّت القائمةَ المعلومة كي لا تنمو بتصادمٍ جديدٍ صامت.
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const order = [...html.matchAll(/<script src="\/([^"]+)"/g)].map(m => m[1])
    .filter(f => fs.existsSync(path.join(PUBLIC_DIR, f)));
  assert.ok(order.length > 50, 'tripwire: بيانُ النصوص لم يُقرأ (' + order.length + ')');

  const defs = new Map();
  for (const file of order) {
    const src = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    for (const m of src.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      if (!defs.has(m[1])) defs.set(m[1], new Set());
      defs.get(m[1]).add(file);
    }
  }
  const collisions = [...defs].filter(([, files]) => files.size > 1).map(([n]) => n).sort();

  // المعلومُ الموثَّق — ولا يُضاف إليه إلا بقرارٍ صريح
  assert.deepStrictEqual(collisions, ['extractFunctions'],
    'تصادمُ أسماءٍ عامّةٍ تغيّر. الفائزُ هو الأخيرُ تحميلًا، فتصادمٌ جديد ' +
    'قد يُسكِت محرّكًا كاملًا صامتًا: ' + collisions.join(', '));
});
