// ═══════════════════════════════════════════════════════
// [LOG-SINK] بلاغٌ موجودٌ، وتوجيهٌ صحيح، ومُصلِحٌ يُرجع null صامتًا
// ═══════════════════════════════════════════════════════
//
// هذه ليست فجوةَ اكتشاف. المسارُ كاملٌ حتى آخرِه ثم يسقط:
//
//   ① ‎scanSecurity‎ (security_scanner.js:168) يُبلّغ: ‎/console\.log|print|Log\./i‎
//      مع كلمةٍ حسّاسةٍ في السطر ⇒ ‎log.info(password)‎ يحمل بلاغًا.
//   ② ‎detectStrategy‎ يُوجّهه إلى ‎LOG_SECRET‎ — صحيحًا.
//   ③ ‎fixLogSecret‎ **تُنادى** فعلًا (مقيسٌ بمِجَسٍّ داخل حلقةِ الإصلاح).
//   ④ ونمطُها كان ‎console.*‎ و‎logging.*‎ وحدَهما ⇒ ‎fixed === line‎ ⇒ ‎null‎.
//   ⑤ فيُسقط البلاغُ **صامتًا**: مخرجُ ‎!result‎ في ‎repair_engine.js‎ لا يُسجّل
//      في ‎rejected‎ ولا في ‎aiNeeded‎ إلا إذا كان ‎issue.aiRequired === true‎،
//      و‎scanSecurity‎ لا يضعه.
//
// فالعطبُ أن مفرداتِ المُصلِحِ أضيقُ من مفرداتِ الكاشف، والفرقُ يُبتلع بلا أثر:
// لا بلاغَ منخفضٌ ولا رفضٌ مُسجَّل — المشكلةُ باقيةٌ والمحرّكُ ساكت.
// مقيسٌ قبل الإصلاح: سبعةُ أشكالٍ من سبعة (js, ts, py).
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

const LEAK_RX = /DATA_EXPOSURE|CWE_312|CWE_532|تسجيل بيانات حساسة|Sensitive Data|Logged/;
const leaks = (ctx, code, file) => (ctx.analyzeCode(code, file) || [])
  .filter(i => LEAK_RX.test(String(i.type || '') + String(i.title || '')));
const sinkLine = src => (src.split('\n')
  .find(l => /console\.|logging\.|print\(|[A-Za-z_$][\w$]*\s*\.\s*(?:log|info|debug|warn|warning|error)\s*\(/.test(l)) || '').trim();

// الأشكالُ السبعةُ المقيسة: مُستقبِلٌ آخرُ كلمةٍ في اسمه ‎log‎
const SINKS = [
  ['a.js', 'log.info',    'function f(password) {\n  log.info(password);\n}\n',            'log.info('],
  ['a.js', 'Log.debug',   'function f(token) {\n  Log.debug(token);\n}\n',                  'Log.debug('],
  ['a.js', 'appLog.warn', 'function f(secret) {\n  appLog.warn(secret);\n}\n',              'appLog.warn('],
  ['a.js', 'log.info ×2', 'function f(password) {\n  log.info("user", password);\n}\n',     'log.info('],
  ['a.ts', 'log.error',   'function f(token: string) {\n  log.error(token);\n}\n',          'log.error('],
  ['a.py', 'log.warning', 'def f(secret):\n    log.warning(secret)\n',                      'log.warning('],
  ['a.py', 'log.info ×2', 'def f(password):\n    log.info("u", password)\n',                'log.info('],
];

for (const [file, label, code, head] of SINKS) {
  test('[LS-1] يُكتشَف ويُوجَّه ويُنقَّح — ' + label + ' (' + file + ')', () => {
    const ctx = loadCtx();

    // ① البلاغُ قائمٌ قبل الإصلاح — فالعطبُ ليس في الاكتشاف
    const before = leaks(ctx, code, file);
    assert.ok(before.length > 0, 'tripwire: لا بلاغَ تسريبٍ على ' + label +
      ' — هذا الاختبارُ عن بلاغٍ موجودٍ لا يُصلَح');

    // ② والتوجيهُ صحيحٌ إلى LOG_SECRET — فالعطبُ ليس في الربط
    const ext = file.split('.').pop();
    assert.ok(before.some(i => ctx.detectStrategy(i, ext) === 'LOG_SECRET'),
      'البلاغُ لا يُوجَّه إلى LOG_SECRET: ' + before.map(i => i.title).join(' | '));

    // ③ والمسارُ الكامل يُنقّح فعلًا
    const all = ctx.analyzeCode(code, file) || [];
    const out = ctx.repairCode(code, all.map(x => Object.assign({}, x)), file);
    assert.ok((out.repairs || []).some(r => r.strategy === 'LOG_SECRET'),
      'لم يُسجَّل إصلاحُ LOG_SECRET على ' + label);

    // ④ والنجاحُ بالقيمةِ لا باختفاء البلاغ: السرُّ غاب، والنداءُ بقي كما هو
    const line = sinkLine(out.repaired);
    assert.ok(line.includes('[REDACTED]'), 'لا عَلَمَ تنقيحٍ: ' + line);
    assert.ok(!/\b(password|token|secret)\b/.test(line.replace(/"\[REDACTED\]"/g, '')),
      'المُعرِّفُ الحسّاس ما زال يُسجَّل: ' + line);
    assert.ok(line.startsWith(head), 'المُستقبِلُ أو الدالّةُ تغيّرا — ' +
      'التنقيحُ يمسّ ما ليس له: ' + line);

    // ⑤ ولا يبقى بلاغُ تسريبٍ على ذلك السطر
    const after = leaks(ctx, out.repaired, file);
    assert.ok(after.length < before.length,
      'بلاغُ التسريب باقٍ بعد التنقيح: ' + after.map(i => i.title).join(' | '));
  });
}

test('[LS-2] حدُّ الكلمةِ يحمي النداءَ الوظيفي — dialog وcatalog وblog لا تُمَسّ', () => {
  // كاشفُ ‎scanSecurity‎ نمطُه ‎/Log\./i‎ غيرُ محصورٍ بحدِّ كلمة، فيُطابق
  // ‎dialog.‎ و‎catalog.‎ و‎blog.‎ ويُبلّغ عنها. ومع ذلك لا تُنقَّح: تنقيحُ
  // ‎dialog.show(password)‎ إفسادٌ للسلوك لا إصلاحٌ له. وهذا ما كان يفعله
  // المحرّكُ قبل التعديل (لا إصلاح) — فلا تراجُعَ هنا ولا توسيع.
  const ctx = loadCtx();
  const BENIGN = [
    'function f(password) {\n  dialog.show(password);\n}\n',
    'function f(token) {\n  catalog.find(token);\n}\n',
    'function f(secret) {\n  blog.publish(secret);\n}\n',
    'function f(password) {\n  prologue.run(password);\n}\n',
  ];
  for (const code of BENIGN) {
    const all = ctx.analyzeCode(code, 'a.js') || [];
    const out = ctx.repairCode(code, all.map(x => Object.assign({}, x)), 'a.js');
    assert.ok(!/\[REDACTED\]/.test(out.repaired),
      'نداءٌ وظيفيٌّ نُقِّح: ' + sinkLine(out.repaired));
  }
});

test('[LS-3] والدوالُّ من قائمةٍ صريحة — التهيئةُ لا تُمَسّ', () => {
  // نفسُ سببِ ‎[PY-LOG-METHODS]‎: ‎\w+‎ يطابق ‎getLogger‎ و‎basicConfig‎
  // و‎addHandler‎ و‎setLevel‎، وتنقيحُ وسائطها يُفسد التهيئة.
  const ctx = loadCtx();
  const CONFIG = [
    ['a.js', 'const log = logger.child({ password: "x" });\n'],
    ['a.js', 'function f(token) {\n  logger.setLevel(token);\n}\n'],
    ['a.py', 'import logging\nlog = logging.getLogger("secret_service")\n'],
    ['a.py', 'import logging\nlogging.basicConfig(filename="token.log")\n'],
  ];
  for (const [file, code] of CONFIG) {
    const all = ctx.analyzeCode(code, file) || [];
    const out = ctx.repairCode(code, all.map(x => Object.assign({}, x)), file);
    assert.ok(!/\[REDACTED\]/.test(out.repaired),
      'سطرُ تهيئةٍ نُقِّح: ' + out.repaired.trim());
  }
});

test('[LS-4] القدرةُ كانت قائمةً للمُستقبِلِ نفسِه — ‎_redactLogArgs‎ لم يتغيّر', () => {
  // نداءٌ مباشرٌ للمُصلِح: يُثبّت أن ما أُضيف هو **موضعُ المَصرِف** لا منطقُ
  // التنقيح. وقائمةُ الكلماتِ الحسّاسةِ وحدُّ آخرِ كلمةٍ كما هما:
  // ‎passwordCount‎ عدّادٌ لا سرٌّ — ولا يُمَسّ (هذا ما يحميه
  // ‎repair_strategy_routing‎ أصلًا).
  const ctx = loadCtx();
  assert.strictEqual(typeof ctx.fixLogSecret, 'function', 'tripwire: المُصلِحُ غيرُ منشور');
  const code = 'function f(passwordCount) {\n  log.info(passwordCount);\n}\n';
  const r = ctx.fixLogSecret(code, { line: 2, ev: 'log.info(passwordCount);' },
                             code.split('\n'), 'js');
  assert.strictEqual(r, null, 'عدّادٌ نُقِّح: ' + (r && r.patch));

  const code2 = 'function f(userPassword) {\n  log.info(userPassword);\n}\n';
  const r2 = ctx.fixLogSecret(code2, { line: 2, ev: 'log.info(userPassword);' },
                              code2.split('\n'), 'js');
  assert.ok(r2 && r2.patch === 'log.info("[REDACTED]");', 'إصلاحٌ معيب: ' + (r2 && r2.patch));
});

test('[LS-5] نداءٌ غيرُ مؤهَّلٍ يسبقه لا يحجب المَصرِف', () => {
  // المسحُ يتجاوز ‎cfg.get()‎ ثم يُنقّح ‎log.info‎ — لو توقّف عند أوّلِ
  // نداءٍ لَما أُصلح السطر.
  const ctx = loadCtx();
  const code = 'function f(password, cfg) {\n  if (cfg.ready(1)) log.info(password);\n}\n';
  const r = ctx.fixLogSecret(code, { line: 2, ev: 'log.info(password);' },
                             code.split('\n'), 'js');
  assert.ok(r && /cfg\.ready\(1\)/.test(r.patch) && /log\.info\("\[REDACTED\]"\)/.test(r.patch),
    'لم يُنقّح المَصرِفَ الصحيح: ' + (r && r.patch));
});

test('[LS-6] ومسارُ ‎console‎/‎logging‎ لم يتغيّر بتةً', () => {
  // الإضافةُ لا تُستشار إلا إذا لم يُنتج المسارُ القديمُ تغييرًا، فمخرَجُه
  // يبقى حرفيًّا كما كان.
  const ctx = loadCtx();
  // ملاحظةٌ مقيسة: ‎console.error‎ و‎console.debug‎ **لا كاشفَ لهما**
  // (‎extended_patterns:64‎ = ‎log|info|warn‎، و‎cve_patterns‎ = ‎log|info|warn‎
  // و‎log|info‎). فصفرُ بلاغٍ ⇒ صفرُ إصلاح، وهي فجوةُ اكتشافٍ لا فجوةُ إصلاح،
  // ولا يُعالجها هذا التعديل عن قصد. و‎console.warn‎ أدناه لأنه مكتشَف.
  const KEPT = [
    ['a.js', 'function f(password) {\n  console.log(password);\n}\n', 'console.log("[REDACTED]");'],
    ['a.js', 'function f(token) {\n  console.warn("user:", token);\n}\n', 'console.warn("user:", "[REDACTED]");'],
    ['a.py', 'def f(secret):\n    print(secret)\n', 'print("[REDACTED]")'],
    ['a.py', 'import logging\ndef f(password):\n    logging.info(password)\n', 'logging.info("[REDACTED]")'],
  ];
  for (const [file, code, want] of KEPT) {
    const all = ctx.analyzeCode(code, file) || [];
    const out = ctx.repairCode(code, all.map(x => Object.assign({}, x)), file);
    assert.strictEqual(sinkLine(out.repaired), want, 'تراجعٌ في مسارٍ قائم (' + file + ')');
  }
});

test('[LS-7] والتنقيحُ لا يتكرّر — تشغيلٌ ثانٍ لا يُغيّر شيئًا', () => {
  const ctx = loadCtx();
  const code = 'function f(password) {\n  log.info("u", password);\n}\n';
  const a1 = ctx.analyzeCode(code, 'a.js') || [];
  const o1 = ctx.repairCode(code, a1.map(x => Object.assign({}, x)), 'a.js');
  const a2 = ctx.analyzeCode(o1.repaired, 'a.js') || [];
  const o2 = ctx.repairCode(o1.repaired, a2.map(x => Object.assign({}, x)), 'a.js');
  assert.strictEqual(o2.repaired, o1.repaired, 'تشغيلٌ ثانٍ غيّر الشفرة');
  assert.strictEqual(sinkLine(o1.repaired), 'log.info("u", "[REDACTED]");');
});
