// ═══════════════════════════════════════════════════════
// [CMD-ALLOWLIST] تعقيمُ وسيطِ exec: يمنع الحقن، ويُبقي الأمرَ عاملًا
// ═══════════════════════════════════════════════════════
//
// العيبُ المقيس: المُرشَّحُ الذي **تقبله** البوابةُ ويُطبَّق على شفرة
// المستخدم كان يُعقّم بـ‎[^a-zA-Z0-9 ]‎ — فيُسقط كلَّ ما ليس حرفًا أو رقمًا
// أو فراغًا. الحقنُ يُمنَع، والبرنامجُ يتعطّل:
//
//     ls /var/log      ⇒ ls varlog
//     ls /tmp/my-dir   ⇒ ls tmpmydir
//     ls report.txt    ⇒ ls reporttxt
//     ls -la /etc      ⇒ ls la etc
//
// سَلِم من تسعةِ مدخلاتٍ واقعيةٍ واحدٌ فقط. والمُضافُ إلى قائمة السماح
// ‎-./:=_‎ وحدها، ولا متحكّمَ صَدَفيٍّ فيها: سبعَ عشرةَ حملةَ حقنٍ أُجريت عبر
// ‎/bin/sh -c‎ وكلٌّ منها تُنشئ ملفًا إن نُفِّذت — صفرٌ من سبعةَ عشرَ نُفِّذ،
// بالقائمتين معًا.
//
// وما لا يُعالجه ولا كان يُعالجه: ‎/‎ و‎.‎ يمرّان فيَسلَم ‎../..‎ — تجاوزُ
// مسارٍ لا حقنُ أوامر، وقائمٌ في الأصل قبل الإصلاح.
//
// ويُحرَس هنا السلوكُ لا اختفاءُ البلاغ: يُنفَّذ الكودُ المُصلَح ويُقارَن
// نصُّ الأمر الناتج بالأصل.
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

const HEAD = 'const cp = require("child_process");\n';
const mk = body => HEAD + 'function run(file, dir, opts, cb) {\n  ' + body + '\n}\nmodule.exports = { run };\n';

// يُنفّذ جسمَ ‎run‎ ويُرجع نصَّ الأمر الذي كان سيُنفَّذ
function commandOf(src, arg) {
  const L = src.split('\n');
  const start = L.findIndex(l => /^function run\(/.test(l));
  const end   = L.findIndex((l, i) => i > start && /^\}\s*$/.test(l));
  assert.ok(start >= 0 && end > start, 'تعذّر استخراجُ جسم الدالة');
  const sandbox = { captured: null };
  sandbox.cp = { exec: c => { sandbox.captured = String(c); return 'OK'; } };
  vm.createContext(sandbox);
  vm.runInContext('(function(file, dir, opts, cb){\n' + L.slice(start + 1, end).join('\n') + '\n})', sandbox)
    .call(null, arg, arg, { path: arg }, () => {});
  return sandbox.captured;
}

// المُرشَّحُ كما يُنتجه المُصلِحُ على سطرِ exec
function candidate(ctx, body) {
  const code = mk(body);
  const issue = (ctx.analyzeCode(code, 'u.js') || [])
    .filter(i => i.line === 3 && ctx.detectStrategy(i, 'js') === 'CMD_INJECTION')[0];
  assert.ok(issue, 'tripwire: لا بلاغَ حقنِ أوامرَ على السطر — ' + body);
  const r = ctx.fixCommandInjection(code, issue, code.split('\n'), 'js', 'u.js');
  assert.ok(r && r.fixed, 'المُصلِحُ لم يُنتج مُرشَّحًا — ' + body);
  return { code, fixed: r.fixed };
}

// الشكلان الوحيدان اللذان يقبلهما الحارس — وهما ما يُطبَّق فعلًا
const ACCEPTED = [
  ['مُعرِّفٌ أخيرًا', 'return cp.exec("ls " + dir);'],
  ['خاصّيةُ كائن',   'return cp.exec("ls " + opts.path);'],
];

// مدخلاتٌ من الاستعمال اليومي: مسارات، أعلام، امتدادات
const BENIGN = ['/var/log', '/tmp/my-dir', 'report.txt', '-la /etc', 'docs',
                'src/main.js', 'a_b-c.d', '--opt=v'];

for (const [name, body] of ACCEPTED) {
  test('[CMD-1] السلوكُ السليم يُحفَظ — ' + name, () => {
    const ctx = loadCtx();
    const { code, fixed } = candidate(ctx, body);
    for (const arg of BENIGN) {
      assert.strictEqual(commandOf(fixed, arg), commandOf(code, arg),
        'الأمرُ تغيّر بمُدخَلٍ سليم (' + arg + '): ' +
        commandOf(code, arg) + '  ⇒  ' + commandOf(fixed, arg));
    }
  });
}

// حملاتٌ تُحاول تنفيذَ أمرٍ ثانٍ — لكلٍّ متحكّمُها
const PAYLOADS = [
  'x; rm -rf /', 'x && id', 'x || id', 'x | nc h 1', 'x $(id)', 'x `id`',
  'x\nid', 'x & id', 'x > /tmp/o', 'x < /etc/passwd', 'x (id)',
  'x"; id; echo "', "x'; id; echo '", 'x\\; id', 'x {a,b}', 'x ~/f', 'x *',
];
const SHELL_META = /[;|&$`><'"\\*?~!(){}\n\r]/;

for (const [name, body] of ACCEPTED) {
  test('[CMD-2] ولا يمرّ متحكّمٌ صَدَفيٌّ — ' + name, () => {
    const ctx = loadCtx();
    const { fixed } = candidate(ctx, body);
    for (const p of PAYLOADS) {
      const out = commandOf(fixed, p);
      assert.ok(!SHELL_META.test(out),
        'متحكّمٌ صَدَفيٌّ نجا من التعقيم — الحملة ' + JSON.stringify(p) +
        ' ⇒ ' + JSON.stringify(out));
    }
  });
}

test('[CMD-3] ولم يتّسع ما يقبله الحارس', () => {
  // تثبيتٌ صريح: توسيعُ قائمة السماح لا يُوسّع القبول. كلُّ شكلٍ كان
  // يُرفض يبقى مرفوضًا، وبنفس السبب.
  const ctx = loadCtx();
  const EXPECT = [
    ['return cp.exec("ls " + dir);',                      null],
    ['return cp.exec("ls " + opts.path);',                null],
    ['return cp.exec("convert " + file + " out.png");',    'CMD_SANITIZE_WRONG_PART'],
    ['return cp.exec("cp " + file + " " + dir);',          'CMD_UNSANITIZED_INPUT'],
    ['return cp.exec(`ls ${dir}`);',                       'CMD_SANITIZE_WRONG_PART'],
    ['return cp.exec("ls " + dir, cb);',                   'CMD_ARGS_DROPPED'],
    ['return cp.exec("ls " + String(dir));',               'CMD_SYNTAX_INVALID'],
  ];
  for (const [body, want] of EXPECT) {
    const { code, fixed } = candidate(ctx, body);
    const problem = ctx.cmdCandidateProblem(code, fixed, 3, 'CMD_INJECTION');
    if (want === null) {
      assert.strictEqual(problem, null, 'شكلٌ كان مقبولًا صار مرفوضًا: ' + body + ' ⇒ ' + problem);
    } else {
      assert.ok(problem && String(problem).startsWith(want),
        'شكلٌ كان مرفوضًا تغيّر حكمُه: ' + body + ' ⇒ ' + problem + ' (المتوقَّع ' + want + ')');
    }
  }
});

test('[CMD-4] المُولِّدُ والحارسُ والبوابةُ على مصدرٍ واحد', () => {
  // ⚠️ هذا الاختبارُ وُضع لعيبٍ وقعتُ فيه فعلًا: وسّعتُ قائمةَ السماح في
  // المُولِّد وحده، فلم يُطابقها نمطُ «العلاج» في البوابة (كان يستثني ‎/‎
  // داخل الصنف)، فحُكم ‎REJECTED_CMD_FIX_UNPROVEN‎ — وهو رفضٌ ضارّ، فأسقط
  // مسارُ الإنقاذ الخطوةَ كلَّها. أي أن الإصلاحَ توقّف عن أن يُطبَّق أصلًا
  // بلا أن يسقط اختبارٌ واحد. فيُثبَّت الترابطُ هنا صراحةً.
  const ctx = loadCtx();
  assert.strictEqual(typeof ctx.cmdSanitizeCall, 'function',
    'مصدرُ نمطِ التعقيم غيرُ منشور — ستحمل الاختباراتُ نسخةً تنحرف عنه');
  const call = ctx.cmdSanitizeCall();

  // ① ما يُولّده المُصلِحُ يحمل نفسَ النمط
  const { code, fixed } = candidate(ctx, 'return cp.exec("ls " + dir);');
  assert.ok(fixed.includes(call), 'المُولِّدُ لا يستخدم المصدرَ الواحد');

  // ② والحارسُ يقبله
  assert.strictEqual(ctx.cmdCandidateProblem(code, fixed, 3, 'CMD_INJECTION'), null,
    'الحارسُ لا يعرف ما يُولّده المُصلِح');

  // ③ والبوابةُ تعدّه علاجًا — وهنا كان الانحدار
  const v = ctx.FixVerifier.verifyFix(code, fixed, 'u.js', (c, f) => ctx.analyzeCode(c, f));
  assert.strictEqual(v.accepted, true,
    'البوابةُ لا تعدُّ المُنتَجَ علاجًا: ' + String(v.reason));
});

test('[CMD-5] من طرفٍ إلى طرف: يُطبَّق، ويُقبل، ويبقى الأمرُ عاملًا', () => {
  const ctx = loadCtx();
  const code = mk('return cp.exec("ls " + dir);');
  const before = ctx.analyzeCode(code, 'u.js') || [];
  const out = ctx.repairCode(code, before.map(x => Object.assign({}, x)), 'u.js');

  assert.ok(out.repaired !== code, 'لم يُطبَّق شيء — rejected=' +
    JSON.stringify((out.rejected || []).map(r => String(r.reason).slice(0, 48))));
  assert.ok((out.repairs || []).some(r => r.strategy === 'CMD_INJECTION'),
    'لم يُسجَّل إصلاحُ CMD_INJECTION');

  // ① الناتجُ يُحلَّل نحويًّا
  assert.doesNotThrow(() => new vm.Script(out.repaired.replace(/module\.exports.*/, '')),
    'الناتجُ مكسورٌ نحويًّا');

  // ② والقيمةُ الخطرة عُولجت — لا تُمرَّر إلى exec كما هي
  assert.ok(/exec\(safeArgs\)/.test(out.repaired), 'exec لا يستقبل القيمةَ المُعقَّمة');
  assert.ok(!/exec\("ls " \+ dir\)/.test(out.repaired), 'النداءُ الأصليُّ باقٍ');

  // ③ والأمرُ ما زال عاملًا بمُدخَلٍ سليم
  assert.strictEqual(commandOf(out.repaired, '/var/log'), 'ls /var/log',
    'الأمرُ تعطّل بمسارٍ سليم');

  // ④ والحقنُ مُنِع
  assert.ok(!SHELL_META.test(commandOf(out.repaired, 'x; rm -rf /')),
    'متحكّمٌ صَدَفيٌّ نجا في المسار الكامل');
});

test('[CMD-6] وملفٌ مختلطٌ: خطوةُ CMD لا تُسقطها خطواتُ غيرها', () => {
  // في ملفٍ فيه حقنُ أوامرَ ومشاكلُ أخرى، يُعاد الإصلاحُ بتحقّقٍ لكلِّ خطوة
  // متى رفضت البوابةُ الدفعةَ رفضَ ضرر. وخطوةُ CMD كانت تُسقَط هناك حين
  // توقّفت البوابةُ عن معرفة علاجها (انظر ‎[CMD-4]‎). فيُثبَّت أنها تبقى.
  const ctx = loadCtx();
  const code = [
    'const cp = require("child_process");',
    'const API_KEY = "sk_live_51H8xQ2eZvKYlo2C9abcdef";',
    'function listDir(dir) {',
    '  return cp.exec("ls " + dir);',
    '}',
    'function ping() {',
    '  return fetch("http://api.example.com/x");',
    '}',
    'module.exports = { listDir, ping };',
    '',
  ].join('\n');
  const before = ctx.analyzeCode(code, 'm.js') || [];
  const out = ctx.repairCode(code, before.map(x => Object.assign({}, x)), 'm.js');
  const kinds = (out.repairs || []).map(r => r.strategy);

  assert.ok(kinds.includes('CMD_INJECTION'),
    'خطوةُ CMD سقطت في ملفٍ مختلط — مُطبَّق: ' + kinds.join(',') +
    '  مُسقَط: ' + JSON.stringify((out.rejected || []).map(r => String(r.reason).slice(0, 40))));
  assert.ok(kinds.includes('HARDCODED_SECRET'), 'إصلاحُ السرِّ سقط');
  assert.ok(kinds.includes('HTTP_USAGE'), 'إصلاحُ http سقط');
  assert.strictEqual((out.repaired.match(/const safeArgs/g) || []).length, 1,
    'safeArgs أُعلن أكثرَ من مرة');
  assert.doesNotThrow(() => new vm.Script(out.repaired.replace(/module\.exports.*/, '')),
    'ناتجُ الملفِّ المختلط مكسورٌ نحويًّا');
});
