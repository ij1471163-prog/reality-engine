// ═══════════════════════════════════════════════════════════════════════
// [SIGNAL-PROOF] + [MINIFIED-VENDOR] — حارسا سلامة الإصلاح في البوابة
// تشغيل:  node --test vercel-api/test/verifier_signal_proof_guard.test.js
//
// الحادثة التي بدأت هذا: على مسار الإصلاح الحقيقي قبلت البوابة
//     const token = "ESD_" + incident.probeId;
//   ⇒ const token = process.env.TOKEN + incident.probeId;
// بـ accepted=true · syntaxStatus=verified · «ACCEPTED (أزال 2 مشكلة، بلا
// تدهور)». والقيمة ليست سرًّا بل بادئة وسمٍ داخلية، وprocess.env.TOKEN غير
// معرَّف. أي أن البوابة قبلت تغيير معنى لأن الكاشف كفّ عن الإبلاغ.
//
// والسبب المتبّع في البوابة كان شِقّين:
//   1. حارس SQL وحده كان من صنف «إشارة + إثبات»؛ وبقية الأصناف كان اختفاء
//      البلاغ وحده دليل قبولها.
//   2. وحتى شرط «اختفت الإشارة» ثقبٌ: المحوُ الجزئي. كاشفان يُبلّغان عن نفس
//      السرّ، فيُسكِت التغييرُ أحدهما ويبقى الآخر — الإشارة باقية والعدد ناقص،
//      فيمرّ requireImprovement.
//
// والحارس عامٌّ لا استثناء: سجل SIGNAL_PROOFS، لكل صنف عدّادٌ وإثبات،
// والقاعدة واحدة — **نقص العدد بلا إثبات = رفض**. وSQL أول مُدخَل فيه بسلوكه
// الأصلي حرفًا، والسرّ الثاني. وإضافة صنف تعني سطرًا في السجل لا حارسًا جديدًا.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// سياق المحركات — fix_verifier قبل ghost_mode كترتيب الإنتاج
function loadCtx() {
  const LIST = ['acorn.min.js', 'engine_java.js', 'c_cpp_analyzer.js', 'analyzer.js',
    'security_scanner.js', 'secret_detector.js', 'taint_core.js', 'taint_js.js', 'taint_py.js',
    'taint_php.js', 'context_analyzer.js', 'code_intelligence.js', 'repair_engine.js',
    'fallback_fixes.js', 'emergency_fixes.js', 'smart_repair.js', 'repair_sql.js',
    'repair_html.js', 'repair_advanced.js', 'fix_verifier.js', 'ghost_mode.js'];
  const store = new Map();
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {}, info() {} },
    window: {}, global: {}, F: {}, R: {},
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k), clear: () => store.clear(),
    },
  });
  for (const f of LIST) {
    const p = path.join(PUBLIC_DIR, f);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f }); } catch (_) {}
  }
  vm.runInContext('if (window.RepairSQL) RepairSQL = window.RepairSQL;', ctx);
  return ctx;
}

const ctx = loadCtx();

function gate(before, after, fileName, opts) {
  vm.runInContext('__B = ' + JSON.stringify(before) + '; __A = ' + JSON.stringify(after) +
                  '; __N = ' + JSON.stringify(fileName) +
                  '; __O = ' + JSON.stringify(opts || null) + ';', ctx);
  return JSON.parse(vm.runInContext(
    'JSON.stringify((()=>{const v=FixVerifier.verifyFix(__B,__A,__N,analyzeCode,__O||undefined);' +
    'return {accepted:v.accepted===true, reason:String(v.reason||""), syntaxStatus:v.syntaxStatus};})())',
    ctx));
}

function findings(code, fileName) {
  vm.runInContext('__C = ' + JSON.stringify(code) + '; __F = ' + JSON.stringify(fileName) + ';', ctx);
  return JSON.parse(vm.runInContext(
    'JSON.stringify((analyzeCode(__C,__F)||[]).map(i=>({sev:i.sev,type:String(i.type),title:String(i.title||"")})))',
    ctx));
}

const SECRET_RX = /hardcoded|cwe-798|cwe-259|secret|مُضمَّن في الكود|مُضمَّنة في الكود|مكشوفة في الكود/i;
const countSecret = (code, f) =>
  findings(code, f).filter(i => SECRET_RX.test(i.type + ' ' + i.title)).length;

// ═══════════════════════════════════════════════════════════════════════
// 1. الحادثة الأصلية
// ═══════════════════════════════════════════════════════════════════════

test('[SP-1] الحادثة: بادئة وسمٍ تُعامَل كسرّ ⇒ ترفضها البوابة', () => {
  const before = 'const token = "ESD_" + incident.probeId;\nmodule.exports = token;\n';
  const after  = 'const token = process.env.TOKEN + incident.probeId;\nmodule.exports = token;\n';

  // العزل: الكاشف يُبلّغ فعلًا، والبلاغ ينقص بالتغيير — فالرفض ليس لعدم تحسّن
  assert.ok(countSecret(before, 'a.js') >= 1, 'الكاشف لا يُبلّغ — العيّنة لا تمثّل الحادثة');
  assert.ok(countSecret(after, 'a.js') < countSecret(before, 'a.js'),
    'البلاغ لم ينقص — الحادثة لا تُعاد');

  const v = gate(before, after, 'a.js');
  assert.strictEqual(v.accepted, false, 'قُبل: ' + v.reason);
  assert.match(v.reason, /REJECTED_SECRET_FIX_UNPROVEN/, v.reason);
  assert.strictEqual(v.syntaxStatus, 'verified', 'الرفض ليس عن صياغة مكسورة');
});

test('[SP-1b] السبب هو عدم اكتمال القيمة لا مصدرَ البيئة', () => {
  // نفس المصدر البيئي، لكن القيمة كاملة ⇒ يُقبل. فالرفض عن الدعوى لا عن الشكل.
  const whole = ['const token = "sk_live_51H8xQ2abcdefghijKLMN";\nuse(token);\n',
                 'const token = process.env.TOKEN;\nuse(token);\n'];
  assert.strictEqual(gate(whole[0], whole[1], 'a.js').accepted, true,
    'قيمة كاملة + مصدر بيئة يجب أن تُقبل');
});

// ═══════════════════════════════════════════════════════════════════════
// 2. حالات مماثلة — البلاغ يختفي بتغيير ما يكتشفه الكاشف
// ═══════════════════════════════════════════════════════════════════════

const ERASURE = [
  ['إعادة تسمية المتغيّر فقط', 'a.js',
    'const apiKey = "sk_live_51H8xQ2abcdefghijKLMN";\nuse(apiKey);\n',
    'const apiK3y = "sk_live_51H8xQ2abcdefghijKLMN";\nuse(apiK3y);\n'],
  ['تقطيع النصّ إلى جزأين', 'a.js',
    'const password = "hunter2hunter2";\nlogin(password);\n',
    'const password = "hunter2" + "hunter2";\nlogin(password);\n'],
  ['حذف سطر السرّ', 'a.js',
    'const secret = "s3cr3t_v4lue_x";\nuse(secret);\n',
    'use(secret);\n'],
  ['إبدال التصريح باستدعاء', 'a.js',
    'function auth() {\n  const API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";\n  return fetch(U, { key: API_KEY });\n}\n',
    'function auth() {\n  sendKey(process.env.API_KEY);\n  return fetch(U, { key: API_KEY });\n}\n'],
  ['نقل السرّ إلى تعليق', 'a.js',
    'const token = "ghp_abcdefghijklmnopqrstuvwxyz0123";\nuse(token);\n',
    '// const token = "ghp_abcdefghijklmnopqrstuvwxyz0123";\nuse(token);\n'],
];

for (const [label, file, before, after] of ERASURE) {
  test(`[SP-2] محوُ إشارة: ${label} ⇒ رفض`, () => {
    const b = countSecret(before, file), a = countSecret(after, file);
    assert.ok(b >= 1, label + ': الكاشف لا يُبلّغ على المدخل');
    assert.ok(a < b, label + ': البلاغ لم ينقص — الحالة لا تمثّل محوًا (' + b + '→' + a + ')');

    const v = gate(before, after, file);
    assert.strictEqual(v.accepted, false, label + ' قُبل: ' + v.reason);
    assert.match(v.reason, /REJECTED_SECRET_FIX_UNPROVEN|REJECTED_NO_IMPROVEMENT/, v.reason);
  });
}

test('[SP-2b] المحوُ الجزئي: إسكات كاشفٍ واحد لا يشتري القبول', () => {
  // كاشفان يُبلّغان عن نفس السطر؛ التغيير يُسكِت أحدهما فقط
  const before = 'const apiKey = "sk_live_51H8xQ2abcdefghijKLMN";\nuse(apiKey);\n';
  const after  = 'const apiK3y = "sk_live_51H8xQ2abcdefghijKLMN";\nuse(apiK3y);\n';
  const fb = findings(before, 'a.js').filter(i => SECRET_RX.test(i.type + ' ' + i.title));
  const fa = findings(after, 'a.js').filter(i => SECRET_RX.test(i.type + ' ' + i.title));
  assert.ok(fb.length >= 2, 'العزل يحتاج كاشفين على الأقل: ' + JSON.stringify(fb.map(i => i.title)));
  assert.ok(fa.length >= 1, 'الإشارة يجب أن تبقى — وإلا فهذا محوٌ كامل لا جزئي');
  assert.ok(fa.length < fb.length, 'العدد يجب أن ينقص');

  // شرط «اختفت الإشارة» يسكت هنا؛ شرط «نقص العدد» هو الذي يرفض
  const v = gate(before, after, 'a.js');
  assert.strictEqual(v.accepted, false, 'قُبل: ' + v.reason);
  assert.match(v.reason, /REJECTED_SECRET_FIX_UNPROVEN/);
  assert.ok(/sk_live_51H8xQ2abcdefghijKLMN/.test(after), 'والسرّ ما زال مُضمَّنًا حرفيًا');
});

test('[SP-2c] إقحام PHP ‎{$x}‎ ليس قيمةً ثابتة ⇒ رفض', () => {
  // ثغرة كشفها مسح التحوّرات: فحص الإقحام كان يبحث عن ‎${…}‎ وحدها، وPHP
  // تُقحِم بـ‎{$x}‎ و‎$x‎ داخل النصّ المزدوج. فكانت قيمةٌ مُركَّبة تُعَدّ سرًّا
  // كاملًا وتُقبل. والقوالب الخلفية وf-strings لا يُبلّغ عنها أي كاشف (مقيس)،
  // فـPHP هي الحالة الواصلة فعلًا.
  const before = '<?php\n$api_key = "sk_live_{$x}abcdefghij";\necho $api_key;\n';
  const after  = '<?php\n$api_key = getenv("API_KEY");\necho $api_key;\n';
  assert.ok(countSecret(before, 'a.php') > countSecret(after, 'a.php'), 'البلاغ لم ينقص');
  const v = gate(before, after, 'a.php');
  assert.strictEqual(v.accepted, false, 'قُبل: ' + v.reason);
  assert.match(v.reason, /REJECTED_SECRET_FIX_UNPROVEN/);

  // وبلا إقحام يُقبل — فالرفض عن الإقحام لا عن اللغة
  const plain = '<?php\n$api_key = "sk_live_51H8xQ2abcdefghijKLMN";\necho $api_key;\n';
  assert.strictEqual(gate(plain, after, 'a.php').accepted, true, 'سرّ PHP سليم رُفض');
});

test('[SP-2d] القاعدة مقصورة على php: ‎$‎ داخل سرّ JS نصٌّ حرفي لا إقحام', () => {
  const before = 'const password = "p$ssw0rd$123x";\nlogin(password);\n';
  const after  = 'const password = process.env.PASSWORD;\nlogin(password);\n';
  assert.ok(countSecret(before, 'a.js') > countSecret(after, 'a.js'), 'العزل: البلاغ ينقص');
  assert.strictEqual(gate(before, after, 'a.js').accepted, true,
    'سرّ JS فيه ‎$‎ رُفض — تعميم قاعدة PHP يرفض سرًّا سليمًا');
});

test('[SP-2e] تثبيت الإسناد: ‎password=\'‎ داخل نصّ SQL ليس إسناد سرّ', () => {
  // ثغرة كشفها مسح التحوّرات: تعبيرٌ غير مثبَّت على رأس العبارة يطابق
  // ‎password='‎ داخل الاستعلام، فيُعَدّ سطرُ SQL إسنادَ سرٍّ، ويُرفض معه كل
  // إصلاحٍ في الملف. (أسقط ذلك اختبارين قائمين في repair_sql_candidate.)
  const before = [
    'const API_SECRET = "sk_live_abc123xyz789def456ghi";',
    'function login(u, p) {',
    '  var q = "SELECT * FROM players WHERE username=\'" + u + "\' AND password=\'" + p + "\'";',
    '  return db.execute(q);',
    '}',
  ].join('\n') + '\n';
  const after = before
    .replace('const API_SECRET = "sk_live_abc123xyz789def456ghi";', 'const API_SECRET = process.env.API_SECRET;')
    .replace('var q =', 'let q =');

  // سطر SQL باقٍ كما هو — فأي رفض لا يكون عن SQL
  assert.ok(after.includes('username=\'" + u + "\' AND password=\'" + p + "\''), 'العزل: سطر SQL لم يتغيّر');
  const v = gate(before, after, 'g.js');
  assert.ok(!/REJECTED_SECRET_FIX_UNPROVEN/.test(v.reason),
    'سطر SQL عُدَّ إسناد سرٍّ: ' + v.reason);
  assert.strictEqual(v.accepted, true, 'رُفض: ' + v.reason);
});

// ═══════════════════════════════════════════════════════════════════════
// 3. الإصلاحات الصحيحة ما زالت تُقبل
// ═══════════════════════════════════════════════════════════════════════

const GOOD = [
  ['JS: اسم سرّي ⇒ process.env', 'a.js',
    'const API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";\nuse(API_KEY);\n',
    'const API_KEY = process.env.API_KEY;\nuse(API_KEY);\n'],
  ['JS: اسم محايد وقيمة سرّية ⇒ process.env', 'a.js',
    'function f(){\n  const K = "sk_live_51H8xQ2abcdefghijKLMN";\n  return K;\n}\n',
    'function f(){\n  const K = process.env.K;\n  return K;\n}\n'],
  ['PHP: ⇒ getenv', 'a.php',
    '<?php\n$api_key = "sk_live_51H8xQ2abcdefghijKLMN";\necho $api_key;\n',
    '<?php\n$api_key = getenv("API_KEY");\necho $api_key;\n'],
  ['Python: ⇒ os.environ.get', 'a.py',
    'API_KEY = "sk_live_51H8xQ2abcdefghijKLMN"\nprint(API_KEY)\n',
    'import os\nAPI_KEY = os.environ.get("API_KEY")\nprint(API_KEY)\n'],
  ['خاصية في كائن ⇒ process.env', 'a.js',
    'const cfg = {\n  password: "hunter2hunter2",\n};\nuse(cfg);\n',
    'const cfg = {\n  password: process.env.PASSWORD,\n};\nuse(cfg);\n'],
];

for (const [label, file, before, after] of GOOD) {
  test(`[SP-3] إصلاح صحيح ما زال يُقبل: ${label}`, () => {
    const v = gate(before, after, file);
    assert.strictEqual(v.accepted, true, label + ' رُفض: ' + v.reason);
  });
}

test('[SP-3b] الحارس خامل حين لا ينقص بلاغ سرّ', () => {
  // var → let: لا صنف سرّ في الصورة إطلاقًا
  const v = gate('var x = 1;\nuse(x);\n', 'let x = 1;\nuse(x);\n', 'a.js');
  assert.strictEqual(v.accepted, true, v.reason);

  // وسرٌّ باقٍ كما هو مع إصلاح آخر: العدد لم ينقص ⇒ الحارس لا يتدخّل
  const before = 'const API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";\nif (a == b) use(API_KEY);\n';
  const after  = 'const API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";\nif (a === b) use(API_KEY);\n';
  assert.strictEqual(countSecret(after, 'a.js'), countSecret(before, 'a.js'),
    'العزل: عدد بلاغات السرّ يجب أن يبقى ثابتًا');
  const v2 = gate(before, after, 'a.js');
  assert.strictEqual(v2.accepted, true, v2.reason);
});

// ═══════════════════════════════════════════════════════════════════════
// 4. حارس SQL القائم لم يتغيّر سلوكه
// ═══════════════════════════════════════════════════════════════════════

test('[SP-4] SQL: معاملات صحيحة تُقبل، وغير المعاملاتي يُرفض بنفس السبب', () => {
  const b = 'def g(uid):\n    cursor.execute("SELECT * FROM t WHERE id=" + uid)\n';
  const good = 'def g(uid):\n    cursor.execute("SELECT * FROM t WHERE id=%s", (uid,))\n';
  const bad  = 'def g(uid):\n    cursor.execute("SELECT * FROM t WHERE id=%s" % uid)\n';

  assert.strictEqual(gate(b, good, 'a.py').accepted, true);
  const v = gate(b, bad, 'a.py');
  assert.strictEqual(v.accepted, false);
  assert.match(v.reason, /^REJECTED_SQL_NOT_PARAMETERIZED/, v.reason);
});

test('[SP-4b] السجل يحمل الصنفين، وSQL أولًا', () => {
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'fix_verifier.js'), 'utf8');
  assert.match(src, /\[SIGNAL-PROOF\]/, 'السجل غير موثّق في الإنتاج');
  const reg = /const SIGNAL_PROOFS = \[([\s\S]*?)\n    \];/.exec(src);
  assert.ok(reg, 'سجل SIGNAL_PROOFS غير موجود — تغيّر شكله');
  const ids = [...reg[1].matchAll(/id:\s*"([^"]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(ids, ['sql', 'secret'], 'أصناف السجل: ' + JSON.stringify(ids));
  // القاعدة واحدة للجميع: نقص العدد لا اختفاء الإشارة
  assert.match(src, /before > after && !cls\.prove\(\)/,
    'شرط الحارس تغيّر — يجب أن يكون نقص العدد');
});

// ═══════════════════════════════════════════════════════════════════════
// 5. [MINIFIED-VENDOR] حِزَم الطرف الثالث المُصغَّرة
// ═══════════════════════════════════════════════════════════════════════

test('[MV-1] حِزَم المستودع المُصغَّرة الحقيقية تُستثنى من الإصلاح', () => {
  const bundles = ['jspdf.min.js', 'jszip.min.js', 'acorn.min.js']
    .filter(f => fs.existsSync(path.join(PUBLIC_DIR, f)));
  assert.ok(bundles.length >= 2, 'حِزَم مُصغَّرة حقيقية غير موجودة للاختبار');

  for (const f of bundles) {
    const code = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
    // مُرشَّح واقعي: != ⇒ !== كما يُنتجه المحرك فعلًا على هذه الحِزَم
    const after = code.replace('!=', '!==');
    assert.notStrictEqual(after, code, f + ': لم يُنتَج مُرشَّح');
    const v = gate(code, after, 'public/' + f);
    assert.strictEqual(v.accepted, false, f + ' قُبل: ' + v.reason);
    assert.match(v.reason, /^REJECTED_MINIFIED_VENDOR/, v.reason);
  }
});

test('[MV-2] ملفات المشروع الحقيقية لا تُستثنى — الفصل مقيس لا مُفترَض', () => {
  const own = ['analyzer.js', 'repair_engine.js', 'fix_verifier.js', 'project_intelligence.js',
               'learning_engine.js', 'ghost_mode.js']
    .filter(f => fs.existsSync(path.join(PUBLIC_DIR, f)));
  for (const f of own) {
    const code = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
    const v = gate(code, code + '\n// x\n', 'public/' + f);
    assert.ok(!/^REJECTED_MINIFIED_VENDOR/.test(v.reason),
      f + ' عُدَّ حِزمة مُصغَّرة: ' + v.reason);
  }
});

test('[MV-3] الاستثناء بثلاثة أدلة مستقلة: الاسم، والمسار، والشكل', () => {
  const tiny = 'var a = 1;\nvar b = 2;\n';
  // (أ) الاسم
  assert.match(gate(tiny, 'var a = 1;\nvar c = 2;\n', 'x.min.js').reason,
    /^REJECTED_MINIFIED_VENDOR/);
  // (ب) المسار
  for (const p of ['node_modules/pkg/i.js', 'vendor/lib.js', 'third_party/x.js', 'dist/bundle.js'])
    assert.match(gate(tiny, 'var a = 1;\nvar c = 2;\n', p).reason,
      /^REJECTED_MINIFIED_VENDOR/, p);
  // (ج) الشكل — سطر واحد طويل، بلا دليل من الاسم
  const long = 'var x=' + JSON.stringify('y'.repeat(30000)) + ';var z=1;';
  assert.match(gate(long, long.replace('var z=1', 'var z=2'), 'plain.js').reason,
    /^REJECTED_MINIFIED_VENDOR/, 'الشكل لم يُكتشف');
});

test('[MV-3b] دليلا الشكل مستقلّان: أطولُ سطرٍ وحده يكفي ومتوسطٌ وحده يكفي', () => {
  // ثغرة كشفها مسح التحوّرات: حالة (ج) أعلاه متوسطها ضخم أيضًا، فحذفُ فرع
  // «أطول سطر» كان ينجو — يمسكها فرع المتوسط. فلكل دليلٍ حالةٌ لا يمسكها غيره.
  const pad = 'var n = 1;'.padEnd(30, ' ');

  // (أ) أطولُ سطرٍ وحده: 1200 سطرًا قصيرًا + سطر واحد 9000 حرف
  //     الحجم > 20000، والمتوسط ≈ 37 (أقل من 200)، وأطول سطر 9000
  const byMax = Array.from({ length: 1200 }, () => pad).join('\n') +
                '\nvar big = ' + JSON.stringify('z'.repeat(9000)) + ';\n';
  const linesA = byMax.split('\n');
  assert.ok(byMax.length > 20000, 'العزل: الحجم ' + byMax.length);
  assert.ok(Math.round(byMax.length / linesA.length) < 200,
    'العزل: المتوسط يجب أن يكون تحت العتبة — ' + Math.round(byMax.length / linesA.length));
  assert.ok(Math.max(...linesA.map(l => l.length)) >= 2000, 'العزل: أطول سطر فوق العتبة');
  assert.match(gate(byMax, byMax.replace('var n = 1;', 'var n = 2;'), 'a.js').reason,
    /^REJECTED_MINIFIED_VENDOR/, 'دليل «أطول سطر» لا يعمل وحده');

  // (ب) المتوسط وحده: أسطر طولها 400 حرف — أقل من عتبة أطول سطر (2000)
  const row = 'var q = ' + JSON.stringify('w'.repeat(380)) + ';';
  const byAvg = Array.from({ length: 80 }, () => row).join('\n') + '\n';
  const linesB = byAvg.split('\n');
  assert.ok(byAvg.length > 20000, 'العزل: الحجم ' + byAvg.length);
  assert.ok(Math.max(...linesB.map(l => l.length)) < 2000, 'العزل: أطول سطر تحت العتبة');
  assert.ok(Math.round(byAvg.length / linesB.length) >= 200, 'العزل: المتوسط فوق العتبة');
  assert.match(gate(byAvg, byAvg.replace('var q =', 'let q ='), 'b.js').reason,
    /^REJECTED_MINIFIED_VENDOR/, 'دليل «المتوسط» لا يعمل وحده');
});

test('[MV-4] تجاوز صريح متاح ولا يُفتح افتراضيًا', () => {
  const code = 'var a = 1;\nvar b = 2;\n';
  const def = gate(code, 'var a = 1;\nvar c = 2;\n', 'x.min.js');
  assert.match(def.reason, /^REJECTED_MINIFIED_VENDOR/, 'الافتراض يجب أن يكون الاستثناء');
  assert.match(def.reason, /allowMinifiedVendor/, 'الرسالة لا تذكر التجاوز');

  const over = gate(code, 'var a = 1;\nvar c = 2;\n', 'x.min.js', { allowMinifiedVendor: true });
  assert.ok(!/^REJECTED_MINIFIED_VENDOR/.test(over.reason),
    'التجاوز الصريح لم يعمل: ' + over.reason);
});

test('[MV-6] الاستثناء يمنع التعديل ولا يُعطّل التحليل', () => {
  // الاستثناء عن **الإصلاح** لا عن الفحص: الحِزمة تبقى مُحلَّلة وبلاغاتها
  // تُعرَض، وما يُمنع هو تعديلها تلقائيًا.
  const bundles = ['jspdf.min.js', 'jszip.min.js', 'acorn.min.js']
    .filter(f => fs.existsSync(path.join(PUBLIC_DIR, f)));
  assert.ok(bundles.length >= 2, 'حِزَم مُصغَّرة حقيقية غير موجودة');

  for (const f of bundles) {
    const code = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
    const issues = findings(code, 'public/' + f);

    // ① التحليل يعمل: بلاغات حقيقية بشدّات متفاوتة
    assert.ok(issues.length >= 2, f + ': التحليل عُطِّل — بلاغات=' + issues.length);
    assert.ok(issues.some(i => i.sev === 'c' || i.sev === 'h'),
      f + ': لا بلاغ ذا شدّة — الشدّات: ' + JSON.stringify(issues.map(i => i.sev)));

    // ② والتلويث/البنية ما زالا يعملان على نفس المدخل
    vm.runInContext('__C = ' + JSON.stringify(code) + '; __N = ' + JSON.stringify('public/' + f) + ';', ctx);
    const probe = JSON.parse(vm.runInContext('JSON.stringify((()=>{' +
      'const n=(analyzeCode(__C,__N)||[]).length;' +
      'let g=null; try{ g = GhostMode.structuralCheck ? "ok" : "missing"; }catch(e){ g="err:"+e.message; }' +
      'return {n, g};})())', ctx));
    assert.strictEqual(probe.n, issues.length, f + ': التحليل غير مستقر');
    assert.strictEqual(probe.g, 'ok', f + ': GhostMode تعطّل — ' + probe.g);

    // ③ والإصلاح ممنوع: الناتج يعود كما هو بايتًا من repairCode نفسه
    const out = JSON.parse(vm.runInContext('JSON.stringify((()=>{' +
      'const is=analyzeCode(__C,__N)||[];const r=repairCode(__C,is,__N);' +
      'return {unchanged: r.repaired === __C, claimed: (r.repairs||[]).map(x=>x.strategy)};})())', ctx));
    assert.strictEqual(out.unchanged, true,
      f + ': الحِزمة تغيّرت رغم الاستثناء — استراتيجيات مُعلَنة: ' + JSON.stringify(out.claimed));
  }
});

test('[MV-7] تضارب مُعلَن: repairs تُعلِن استراتيجية والناتج لم يتغيّر', () => {
  // ملاحظة مقيسة لا إصلاح: ‎repair_engine.js:1783‎ يُرجع الكود الأصلي عند رفض
  // بوابة Ghost، **دون تنقيح قائمة repairs** ولا summary.fixed. فأي رفضٍ من
  // Ghost — لا رفضُ هذه الجولة وحده — يُنتج هذا التضارب. وهو في repair_engine
  // لا في البوابة، وخارج نطاق هذه الدفعة؛ يُثبَّت هنا كي لا يُقرأ «repairs»
  // على أنه ما طُبِّق فعلًا.
  const f = 'jszip.min.js';
  if (!fs.existsSync(path.join(PUBLIC_DIR, f))) return;
  const code = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
  vm.runInContext('__C = ' + JSON.stringify(code) + '; __N = "public/' + f + '";', ctx);
  const r = JSON.parse(vm.runInContext('JSON.stringify((()=>{' +
    'const is=analyzeCode(__C,__N)||[];const rep=repairCode(__C,is,__N);' +
    'return {unchanged: rep.repaired === __C, repairs:(rep.repairs||[]).map(x=>x.strategy),' +
    ' fixed: rep.summary && rep.summary.fixed};})())', ctx));

  assert.strictEqual(r.unchanged, true, 'الناتج تغيّر — الاستثناء لا يعمل');
  assert.ok(r.repairs.length >= 1,
    'لم تُعلَن استراتيجية — تغيّر سلوك repair_engine، فليُحدَّث هذا التوثيق');
  assert.strictEqual(r.fixed, r.repairs.length,
    'summary.fixed لا يطابق repairs — تغيّر الشكل');
  // الخلاصة المُثبَّتة: المصدر الموثوق للتطبيق هو `repaired`، لا `repairs`
});

test('[MV-5] العتبات بينها وبين ملفات المشروع هامشٌ واسع — مقيس', () => {
  const metrics = f => {
    const s = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
    const L = s.split('\n');
    return { max: Math.max(...L.map(x => x.length)), avg: Math.round(s.length / L.length) };
  };
  const vendor = ['jspdf.min.js', 'jszip.min.js'].filter(f => fs.existsSync(path.join(PUBLIC_DIR, f)));
  const own = ['analyzer.js', 'repair_engine.js', 'project_intelligence.js'];

  for (const f of vendor) assert.ok(metrics(f).max >= 2000, f + ': أطول سطر ' + metrics(f).max);
  for (const f of own) {
    const m = metrics(f);
    assert.ok(m.max < 2000, f + ': أطول سطر ' + m.max + ' — يلامس العتبة');
    assert.ok(m.avg < 200, f + ': متوسط ' + m.avg + ' — يلامس العتبة');
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 6. لا شيء يُكتب على القرص في هذه الجولة
// ═══════════════════════════════════════════════════════════════════════

test('[SP-5] الاختبار لا يعدّل أي ملف إنتاج', () => {
  const crypto = require('node:crypto');
  const watch = ['fix_verifier.js', 'repair_engine.js', 'analyzer.js', 'jspdf.min.js', 'jszip.min.js']
    .filter(f => fs.existsSync(path.join(PUBLIC_DIR, f)));
  const h = f => crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(PUBLIC_DIR, f))).digest('hex');
  const before = watch.map(h);

  // دورة إصلاح كاملة على مصدر المحرك نفسه، عبر البوابة
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'analyzer.js'), 'utf8');
  vm.runInContext('__C = ' + JSON.stringify(src) + '; __N = "public/analyzer.js";', ctx);
  vm.runInContext('(()=>{const is=analyzeCode(__C,__N)||[];const r=repairCode(__C,is,__N);' +
                  'if (r && typeof r.repaired === "string") FixVerifier.verifyFix(__C,r.repaired,__N,analyzeCode);})()', ctx);

  assert.deepStrictEqual(watch.map(h), before, 'ملف إنتاج تغيّر');
});
