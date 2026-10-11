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

test('[SP-4b] السجل يحمل الصنفين الصريحين وأصناف المصارف، وSQL أولًا', () => {
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'fix_verifier.js'), 'utf8');
  assert.match(src, /\[SIGNAL-PROOF\]/, 'السجل غير موثّق في الإنتاج');
  const reg = /const SIGNAL_PROOFS = \[([\s\S]*?)\n    \];/.exec(src);
  assert.ok(reg, 'سجل SIGNAL_PROOFS غير موجود — تغيّر شكله');

  // الصنفان الصريحان: لكلٍّ إثباتُه الخاص (لا مُولِّد المصارف)، وSQL أولًا.
  const ids = [...reg[1].matchAll(/id:\s*"([^"]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(ids, ['sql', 'secret'], 'أصناف السجل الصريحة: ' + JSON.stringify(ids));

  // وأصناف المصارف تدخل السجل نشرًا من SINK_CLASSES — بيانات لا حُرّاس.
  assert.match(reg[1], /\.\.\.Object\.keys\(SINK_CLASSES\)\.map\(/,
    'أصناف المصارف لا تدخل السجل نشرًا ⇒ عاد كل صنف حارسًا مستقلًا');
  const sinkBlock = /const SINK_CLASSES = \{([\s\S]*?)\n  \};/.exec(src);
  assert.ok(sinkBlock, 'SINK_CLASSES غير موجود — تغيّر شكله');
  const sinkIds = [...sinkBlock[1].matchAll(/^    (\w+):\s*\{/gm)].map(m => m[1]);
  assert.deepStrictEqual(sinkIds, ['xss', 'cmd', 'crypto', 'evalx'],
    'أصناف المصارف: ' + JSON.stringify(sinkIds));
  for (const id of sinkIds) {
    for (const key of ['issue', 'sink', 'remedy', 'reason']) {
      assert.match(sinkBlock[1], new RegExp(`${id}:\\s*\\{[\\s\\S]*?\\n      ${key}:`),
        `الصنف ${id} بلا ${key} ⇒ إثباتُه ناقص`);
    }
  }

  // القاعدة واحدة للجميع: نقص العدد لا اختفاء الإشارة.
  // والحكم ثلاثي: الرفض على UNPROVEN وحدها — صنفٌ بلا مَصرِف (NA) لا دعوى له.
  assert.match(src, /before > after && proofOf\(cls\) === PROOF\.UNPROVEN/,
    'شرط الحارس تغيّر — يجب أن يكون نقص العدد مع إثبات UNPROVEN');
  assert.match(src, /const PROOF = \{\s*NA:[^}]*PROVEN:[^}]*UNPROVEN:/,
    'ثلاثيّة الإثبات غير معلنة في الإنتاج');
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

test('[MV-7] رفضُ Ghost يُنقّي repairs وsummary ويُسجّل السبب — لا تضارب', () => {
  // كان ‎repair_engine.js‎ يُرجع الكود الأصلي عند رفض بوابة Ghost **دون
  // تنقيح repairs ولا summary.fixed**، فيُبلّغ التقرير عن إصلاحاتٍ لم تُطبَّق
  // وrejected خالٍ. والمقيس على هذا الملف نفسه قبل [GHOST-PRUNE]:
  //     unchanged=true · repairs=1 (LOOSE_EQUALITY) · fixed=1 · score=33
  //     · rejected=0
  // والمطلوب بعده: ما لم يُطبَّق يُنقل إلى rejected بسببه، وsummary يصدُق.
  const f = 'jszip.min.js';
  if (!fs.existsSync(path.join(PUBLIC_DIR, f))) return;
  const code = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
  vm.runInContext('__C = ' + JSON.stringify(code) + '; __N = "public/' + f + '";', ctx);
  const r = JSON.parse(vm.runInContext('JSON.stringify((()=>{' +
    'const is=analyzeCode(__C,__N)||[];const rep=repairCode(__C,is,__N);' +
    'return {unchanged: rep.repaired === __C, repairs:(rep.repairs||[]).map(x=>x.strategy),' +
    ' fixed: rep.summary && rep.summary.fixed, score: rep.summary && rep.summary.score,' +
    ' rejected:(rep.rejected||[]).map(x=>String(x.reason||""))};})())', ctx));

  assert.strictEqual(r.unchanged, true, 'الناتج تغيّر — الاستثناء لا يعمل');

  // tripwire: لولا أن المحرك أنتج مُرشَّحًا هنا لما قاس الاختبار التنقيح
  assert.ok(r.rejected.length >= 1,
    'لا مُرشَّح رُفض ⇒ لم يُنتَج إصلاح أصلًا، والأخضر خاوٍ');
  assert.ok(r.rejected.some(x => /^GHOST_DISCARDED_BATCH/.test(x)),
    'سببُ الإسقاط غير مُسجَّل في rejected: ' + JSON.stringify(r.rejected));
  assert.ok(r.rejected.some(x => /MINIFIED_VENDOR/.test(x)),
    'سببُ الرفض الحقيقي ضائع من السجل: ' + JSON.stringify(r.rejected));

  // والتقرير يصدُق: لا إصلاح مُعلَن ولا نسبة نجاح على ملفٍ لم يتغيّر
  assert.deepStrictEqual(r.repairs, [], 'repairs تُعلن إصلاحًا لم يُطبَّق');
  assert.strictEqual(r.fixed, 0, 'summary.fixed يدّعي إصلاحًا: ' + r.fixed);
  assert.strictEqual(r.score, 0, 'summary.score يدّعي نجاحًا: ' + r.score);
});

test('[MV-7b] والقبول لا يُنقّي شيئًا — التنقيح مقصورٌ على الرفض', () => {
  // الحارس المقابل: إصلاحٌ صحيح يجتاز Ghost يجب أن تبقى repairs كما هي.
  // بلا هذا يكون [MV-7] قابلًا للإرضاء بتفريغ repairs دائمًا.
  const before = 'function f(a, b) {\n  if (a == b) {\n    return 1;\n  }\n  return 0;\n}\n';
  vm.runInContext('__C = ' + JSON.stringify(before) + '; __N = "ok.js";', ctx);
  const r = JSON.parse(vm.runInContext('JSON.stringify((()=>{' +
    'const is=analyzeCode(__C,__N)||[];const rep=repairCode(__C,is,__N);' +
    'return {unchanged: rep.repaired === __C, repairs:(rep.repairs||[]).map(x=>x.strategy),' +
    ' fixed: rep.summary && rep.summary.fixed,' +
    ' discarded:(rep.rejected||[]).filter(x=>/GHOST_DISCARDED_BATCH/.test(String(x.reason||""))).length};})())', ctx));

  assert.strictEqual(r.unchanged, false, 'tripwire: لم يُطبَّق أي إصلاح ⇒ لا يقيس القبول');
  assert.ok(r.repairs.length >= 1, 'إصلاحٌ طُبِّق ولم يُعلَن في repairs');
  assert.strictEqual(r.fixed, r.repairs.length, 'summary.fixed لا يطابق repairs');
  assert.strictEqual(r.discarded, 0, 'التنقيح عمل على قبولٍ — وهو مقصورٌ على الرفض');
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

// ═══════════════════════════════════════════════════════════════════════
// 7. [SINK-PROOF] أصناف المصارف الأربعة — XSS، CMD، CRYPTO، EVAL
//
// الحالات الخمس التي كانت تُقبل قبل هذا المُولِّد، مقيسةً لا مفترضة:
//     el.innerHTML = u.bio   ⇒ حذف السطر              → قُبل
//     el.innerHTML = u.bio   ⇒ el["inner"+"HTML"]      → قُبل
//     exec("ls " + c)        ⇒ حذف الاستدعاء          → قُبل
//     createHash("md5")      ⇒ حذف الاستدعاء          → قُبل
//     eval(s)                ⇒ window["ev"+"al"](s)    → قُبل
//
// ولكل صنف هنا ثلاثيّة: إصلاحٌ صحيح يُقبل، ومحوٌ شكلي يُرفض، وtripwire يُثبت
// أن بلاغ الصنف نقص فعلًا — وإلا فالأخضر لا يقيس الحارس إطلاقًا.
// ═══════════════════════════════════════════════════════════════════════

const CLASS_RX = {
  xss:    /\bxss\b|cwe-79(?!\d)|innerhtml|document\.write/i,
  cmd:    /command injection|\bcmd[_ ]?injection\b|cwe-78(?!\d)|shell_exec|os\.popen|shell\s*=\s*true|runtime\.exec|os command/i,
  crypto: /\bmd5\b|\bsha1\b|sha-1|cwe-327(?!\d)|تشفير ضعيف|weak.?(?:crypto|hash)/i,
  evalx:  /\beval\b|code injection|cwe-94(?!\d)/i,
};
const countClass = (code, f, id) =>
  findings(code, f).filter(i => CLASS_RX[id].test(i.type + ' ' + i.title)).length;

// الرفض المطلوب قد يأتي من هذا الحارس أو من حارسٍ أسبق في البوابة
// (ISSUES_WORSENED على حذف جسم الدالة مثلًا). المطلوب أن **لا يُقبل**؛
// وحين يكون السبب من هذا الحارس يُثبَّت نصُّه أيضًا.
function rejects(before, after, f, id, opts) {
  assert.ok(countClass(before, f, id) > countClass(after, f, id),
    `tripwire ${id}: بلاغ الصنف لم ينقص ⇒ الحارس لا يُستدعى والأخضر خاوٍ`);
  const v = gate(before, after, f, opts);
  assert.strictEqual(v.accepted, false, `قُبل محوٌ شكلي (${id}): ${v.reason}`);
  return v.reason;
}

function acceptsFix(before, after, f, id, opts) {
  assert.ok(countClass(before, f, id) > countClass(after, f, id),
    `tripwire ${id}: بلاغ الصنف لم ينقص ⇒ الاختبار لا يمسّ الحارس`);
  const v = gate(before, after, f, opts);
  assert.strictEqual(v.accepted, true, `رُفض إصلاح صحيح (${id}): ${v.reason}`);
}

// ─── XSS ───────────────────────────────────────────────────────────────

test('[SINK-XSS] innerHTML ⇒ textContent يُقبل، والمحو الشكلي يُرفض', () => {
  const b = 'function r(el, u) {\n  el.innerHTML = u.bio;\n}\n';
  acceptsFix(b, 'function r(el, u) {\n  el.textContent = u.bio;\n}\n', 'v.js', 'xss');

  // إسنادٌ غير مباشر: المَصرِف اختفى من نظر الكاشف ولا علاج أُدخل
  const reason = rejects(b, 'function r(el, u) {\n  el["inner" + "HTML"] = u.bio;\n}\n', 'v.js', 'xss');
  assert.match(reason, /^REJECTED_XSS_FIX_UNPROVEN/, reason);
});

test('[SINK-XSS-b] PHP: htmlspecialchars يُقبل، وحذف الإخراج لا يُقبل', () => {
  const b = '<?php\nfunction r() {\n  echo $_GET["n"];\n}\n';
  acceptsFix(b, '<?php\nfunction r() {\n  echo htmlspecialchars($_GET["n"], ENT_QUOTES, "UTF-8");\n}\n',
    'v.php', 'xss');
  rejects(b, '<?php\nfunction r() {\n}\n', 'v.php', 'xss');
});

// ─── CMD_INJECTION ─────────────────────────────────────────────────────

test('[SINK-CMD] exec ⇒ execFile يُقبل، وحذف الاستدعاء لا يُقبل', () => {
  const b = 'const { exec, execFile } = require("child_process");\n' +
            'function run(req) {\n  exec("ls " + req.query.dir);\n}\n';
  acceptsFix(b, 'const { exec, execFile } = require("child_process");\n' +
                'function run(req) {\n  execFile("ls", [req.query.dir]);\n}\n', 'c.js', 'cmd');
  rejects(b, 'const { exec, execFile } = require("child_process");\nfunction run(req) {\n}\n',
    'c.js', 'cmd');
});

test('[SINK-CMD-b] Python: shell=True ⇒ قائمة وسائط يُقبل', () => {
  const b = 'import subprocess\ndef run(x):\n    subprocess.run("ls " + x, shell=True)\n';
  acceptsFix(b, 'import shlex, subprocess\ndef run(x):\n    subprocess.run(shlex.split("ls " + x), check=True)\n',
    'c.py', 'cmd');
});

// ─── WEAK_CRYPTO ───────────────────────────────────────────────────────

test('[SINK-CRYPTO] md5 ⇒ sha256 يُقبل، وحذف التهشير لا يُقبل', () => {
  const b = 'const crypto = require("crypto");\n' +
            'function d(s) {\n  return crypto.createHash("md5").update(s).digest("hex");\n}\n';
  acceptsFix(b, 'const crypto = require("crypto");\n' +
                'function d(s) {\n  return crypto.createHash("sha256").update(s).digest("hex");\n}\n',
    'h.js', 'crypto');
  rejects(b, 'const crypto = require("crypto");\nfunction d(s) {\n  return s;\n}\n', 'h.js', 'crypto');
});

// ─── EVAL_USAGE ────────────────────────────────────────────────────────

test('[SINK-EVAL] eval ⇒ JSON.parse يُقبل، والتقطيع والحذف يُرفضان', () => {
  const b = 'function g(x) {\n  return eval(x);\n}\n';
  acceptsFix(b, 'function g(x) {\n  return JSON.parse(x);\n}\n', 'e.js', 'evalx');

  const r1 = rejects(b, 'function g(x) {\n  return window["ev" + "al"](x);\n}\n', 'e.js', 'evalx');
  assert.match(r1, /^REJECTED_EVAL_FIX_UNPROVEN/, r1);
  const r2 = rejects(b, 'function g(x) {\n  return null;\n}\n', 'e.js', 'evalx');
  assert.match(r2, /^REJECTED_EVAL_FIX_UNPROVEN/, r2);
});

// ─── الحكم الثلاثي: صنفٌ بلا مَصرِف لا دعوى له ──────────────────────────

test('[SINK-NA] صنفٌ نقص بلاغه وليس له مَصرِف في الكود لا يُسقط إصلاحًا سليمًا', () => {
  // knowledge_base.js يُدرج ‎/eval\s*\(\s*\w+/‎ ضمن أنماط XSS الخطِرة، فسطرُ
  // eval ينتج بلاغين: evalx وxss. والإصلاح الصحيح يُسقط البلاغين — ولا مَصرِف
  // XSS في الكود إطلاقًا. فثنائيّة «أُثبت/لم يُثبت» كانت ترفض إصلاحًا سليمًا.
  //
  // وسياق هذا الاختبار وحده يضمّ knowledge_base.js، لأن قائمة loadCtx أعلاه
  // لا تضمّه فلا يظهر فيها بلاغ XSS أصلًا — وبلا ضمّه يكون الأخضر خاويًا.
  // ولا تُغيَّر القائمة المشتركة كي لا يتبدّل سطحُ المحلل لبقية الملف.
  const kbCtx = (() => {
    const LIST = ['acorn.min.js', 'analyzer.js', 'security_scanner.js', 'knowledge_base.js',
      'secret_detector.js', 'taint_core.js', 'taint_js.js', 'fix_verifier.js'];
    const store = new Map();
    const c = vm.createContext({
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
      try { vm.runInContext(fs.readFileSync(p, 'utf8'), c, { filename: f }); } catch (_) {}
    }
    return c;
  })();
  const kbFindings = code => {
    vm.runInContext('__C = ' + JSON.stringify(code) + ';', kbCtx);
    return JSON.parse(vm.runInContext(
      'JSON.stringify((analyzeCode(__C,"p.js")||[]).map(i=>String(i.type)+" "+String(i.title||"")))', kbCtx));
  };
  const kbXss = code => kbFindings(code).filter(t => CLASS_RX.xss.test(t)).length;

  const b = 'function g(el, x, r) {\n  r = eval(x);\n  return r;\n}\n';
  const a = 'function g(el, x, r) {\n  r = JSON.parse(x);\n  return r;\n}\n';
  assert.ok(kbXss(b) > kbXss(a),
    `tripwire: بلاغ XSS لم ينقص ⇒ هذا الاختبار لا يقيس حالة NA (${kbXss(b)}→${kbXss(a)})`);
  assert.strictEqual(/innerHTML|outerHTML|document\.write|insertAdjacentHTML/.test(b), false,
    'tripwire: وجودُ مَصرِف XSS في العيّنة يُبطل معنى NA');

  vm.runInContext('__B = ' + JSON.stringify(b) + '; __A = ' + JSON.stringify(a) + ';', kbCtx);
  const v = JSON.parse(vm.runInContext(
    'JSON.stringify((()=>{const r=FixVerifier.verifyFix(__B,__A,"p.js",analyzeCode);' +
    'return {accepted:r.accepted===true, reason:String(r.reason||"")};})())', kbCtx));
  assert.strictEqual(v.accepted, true, `إصلاح eval سليم رُفض بدعوى XSS: ${v.reason}`);

  // ونفس السياق يرفض المحو الشكلي لـeval — فالحماية من الصنف المالك للمَصرِف
  vm.runInContext('__A2 = ' + JSON.stringify('function g(el, x, r) {\n  r = null;\n  return r;\n}\n') + ';', kbCtx);
  const v2 = JSON.parse(vm.runInContext(
    'JSON.stringify((()=>{const r=FixVerifier.verifyFix(__B,__A2,"p.js",analyzeCode);' +
    'return {accepted:r.accepted===true, reason:String(r.reason||"")};})())', kbCtx));
  assert.strictEqual(v2.accepted, false, `حذفُ eval شكليًّا قُبل: ${v2.reason}`);
  assert.match(v2.reason, /^REJECTED_EVAL_FIX_UNPROVEN/, v2.reason);
});

test('[SINK-NA-b] حارس SQL لا يُطالب بمعاملات حين لا استعلام في الكود', () => {
  // security_scanner يُبلّغ «SQL Injection محتمل» على تسلسل نصٍّ في استدعاء،
  // ‎exec("ls " + req.query.dir)‎، بلا أي استعلام. وإصلاح الأوامر الصحيح
  // يُسقط ذلك البلاغ، فكان يُطالَب بإثبات parameterization لا محلّ له.
  const b = 'const { exec, execFile } = require("child_process");\n' +
            'function run(req) {\n  exec("ls " + req.query.dir);\n}\n';
  const a = 'const { exec, execFile } = require("child_process");\n' +
            'function run(req) {\n  execFile("ls", [req.query.dir]);\n}\n';
  assert.strictEqual(/\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(b), false,
    'tripwire: وجودُ استعلام في العيّنة يُبطل معنى NA');
  assert.ok(findings(b, 'c.js').some(i => /sql/i.test(i.type + ' ' + i.title)),
    'tripwire: لا بلاغ SQL زائف في العيّنة ⇒ الاختبار لا يقيس الحالة');
  const v = gate(b, a, 'c.js');
  assert.strictEqual(v.accepted, true, `إصلاح أوامر سليم رُفض بدعوى SQL: ${v.reason}`);
});

test('[SINK-NA-c] مَصرِفٌ باقٍ كما هو وبلاغُ الصنف ينقص ⇒ يُرفض. NA لا يُعمَّم', () => {
  // الفرق الحاسم بين NA والمحو الشكلي: هنا للصنف مَصرِفٌ **موجود** يبقى حرفًا،
  // والبلاغ ينقص لأن المصدرَ المتعقَّب صار نصًّا ثابتًا. فالثغرة باقية —
  // ‎exec("ls " + d)‎ ما زال يُركّب أمرًا بالتسلسل — والذي زال هو قابليةُ
  // الكشف وحدها، مع فقدان الوظيفة (المعامِل لم يعد يعمل). ولو عُمّم NA على
  // «لا مَصرِف اختفى» لمرّ هذا. وهو التحوّر S2 في سحب التحوّرات.
  const b = 'const { exec } = require("child_process");\n' +
            'function run(req) {\n  const d = req.query.dir;\n  exec("ls " + d);\n}\n';
  const a = 'const { exec } = require("child_process");\n' +
            'function run(req) {\n  const d = "static";\n  exec("ls " + d);\n}\n';

  assert.ok(a.includes('exec("ls " + d);'),
    'tripwire: سطر المَصرِف لم يبقَ حرفًا ⇒ الحالة ليست المقصودة');
  assert.ok(countClass(b, 'c.js', 'cmd') > countClass(a, 'c.js', 'cmd'),
    `tripwire: بلاغ الأوامر لم ينقص ⇒ الحارس خامل والأخضر خاوٍ ` +
    `(${countClass(b, 'c.js', 'cmd')}→${countClass(a, 'c.js', 'cmd')})`);

  const v = gate(b, a, 'c.js');
  assert.strictEqual(v.accepted, false, `محوُ المصدر مع بقاء المَصرِف قُبل: ${v.reason}`);
  assert.match(v.reason, /^REJECTED_CMD_FIX_UNPROVEN/, v.reason);
});

test('[SINK-CWE] حدُّ الرقم في أكواد CWE يمنع خطف صنفٍ لبلاغ صنفٍ آخر', () => {
  // ‎cwe-79‎ بلا ‎(?!\\d)‎ يطابق داخل ‎CWE-798‎ (سرٌّ مُضمَّن). فملفٌ فيه مَصرِف
  // XSS حقيقي **وسرٌّ**، يُصلَح السرُّ وحده: ينقص عدُّ صنف XSS زورًا، ومَصرِفُ
  // XSS باقٍ كما هو ⇒ UNPROVEN ⇒ يُرفض إصلاح سرٍّ صحيح. وهو التحوّر S8.
  const b = 'const el = document.getElementById("b");\n' +
            'const API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";\n' +
            'function r(u) {\n  el.innerHTML = u.bio;\n  send(API_KEY);\n}\n';
  const a = 'const el = document.getElementById("b");\n' +
            'const API_KEY = process.env.API_KEY;\n' +
            'function r(u) {\n  el.innerHTML = u.bio;\n  send(API_KEY);\n}\n';

  // العزل: مَصرِف XSS موجود وباقٍ، وبلاغ CWE-798 موجود ويزول
  assert.ok(a.includes('el.innerHTML = u.bio;'), 'tripwire: مَصرِف XSS لم يبقَ');
  assert.ok(countSecret(b, 's.js') > countSecret(a, 's.js'),
    'tripwire: بلاغ السرّ لم ينقص ⇒ الاختبار لا يقيس الخطف');

  // وبالحدّ: عدُّ صنف XSS ثابت، فالحارس خامل. وبلا الحدّ ينقص 2→1 فيُرفض —
  // وذلك ما يُثبته التحوّر S8 في السحب، لا نسخةُ regex داخل الاختبار.
  assert.strictEqual(countClass(b, 's.js', 'xss'), countClass(a, 's.js', 'xss'),
    'عدُّ صنف XSS تحرّك ⇒ خطفٌ قائم');

  const v = gate(b, a, 's.js');
  assert.strictEqual(v.accepted, true, `إصلاح سرٍّ صحيح رُفض بدعوى XSS: ${v.reason}`);
});
