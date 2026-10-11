// ═══════════════════════════════════════════════════════
// [PHP-GATE] فاحص PHP البنيوي داخل بوابة التحقق
// ═══════════════════════════════════════════════════════
//
// الانقطاع المقيس: كل إصلاح PHP من أي محرك كان يموت عند البوابة بـ
//   REJECTED_NO_SYNTAX_CHECKER [php]
// لا لعيب في الإصلاح بل لأن البوابة لا تملك فاحصًا للغة. والدليل المباشر:
// إصلاح XSS صحيح تمامًا — echo htmlspecialchars($_GET["name"], ENT_QUOTES,
// "UTF-8") — رفضته البوابة بهذا السبب، ومع تجاوز صريح قبلته وأزال بلاغًا بلا
// تدهور. فPHP كاشفةٌ فقط في المنظومة كلها: repairCode وSmartRepair وEmergency
// تتعطّل عند هذه النقطة لا عند منطقها.
//
// والفاحص ليس جديدًا: هو نفسه المستعمل في مسار الخادم، نُقل إلى
// fix_verifier.js (المشترك بين المسارين) ليراه المتصفح. واختبار «لا انحراف»
// أدناه يثبّت تطابق النسختين نصًّا.
//
// وما يثبّته هذا الملف هو السياسة لا النتيجة فقط:
//   "ok"      ⇒ البوابة تكمل فحوصها (لا قبول تلقائي)
//   "broken"  ⇒ REJECTED_SYNTAX_BROKEN
//   "unknown" ⇒ REJECTED_NO_SYNTAX_CHECKER — نفس مسار اليوم، Fail-Closed
// وأن اللغات الأخرى لم تُمَس.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const FV_PATH    = path.join(PUBLIC_DIR, 'fix_verifier.js');
const SRV_PATH   = path.join(PUBLIC_DIR, 'server_engine_registration.js');

function loadCtx() {
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop, createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, navigator: {}, location: { search: '' },
    toast: noop, refreshStats: noop,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* واجهة */ }
  }
  return ctx;
}
const ctx = loadCtx();
const syn = (code, fn) => JSON.parse(vm.runInContext(
  'JSON.stringify(FixVerifier.syntaxCheck(' + JSON.stringify(code) + ', ' + JSON.stringify(fn) + '))', ctx));
const verify = (before, after, fn, opts) => JSON.parse(vm.runInContext(
  'JSON.stringify(FixVerifier.verifyFix(' + JSON.stringify(before) + ', ' + JSON.stringify(after) + ', ' +
  JSON.stringify(fn) + ', analyzeCode, ' + (opts || '{}') + '))', ctx));

// العيّنة المقيسة التي أظهرت الانقطاع
const PHP_VULN  = '<?php\n$id = $_GET["id"];\n$q = "SELECT * FROM users WHERE id=" . $id;\nmysql_query($q);\necho $_GET["name"];\n';
const PHP_FIXED = PHP_VULN.replace('echo $_GET["name"];',
  'echo htmlspecialchars($_GET["name"], ENT_QUOTES, "UTF-8");');
const PHP_BROKEN = PHP_VULN.replace('mysql_query($q);', 'mysql_query($q;');
const PHP_HEREDOC = '<?php\n$id = $_GET["id"];\n$t = <<<EOT\nhello\nEOT;\necho $id;\n';
const PHP_CLOSETAG = '<?php\n$id = $_GET["id"];\necho $id;\n?>\n<p>x</p>\n';

// ═══ 0. شروط العزل ═════════════════════════════════════

test('tripwire: البوابة محمَّلة وتكشف syntaxCheck', () => {
  assert.ok(ctx.FixVerifier, 'FixVerifier غير محمَّل');
  assert.strictEqual(typeof ctx.FixVerifier.syntaxCheck, 'function', 'syntaxCheck غير مُصدَّرة');
  assert.strictEqual(typeof ctx.FixVerifier.verifyFix, 'function', 'verifyFix غير مُصدَّرة');
  assert.strictEqual(typeof ctx.analyzeCode, 'function', 'المحلل غائب ⇒ لا حكم للبوابة');
});

// ═══ 1. الحالات الثلاث ═════════════════════════════════

test('PHP سليم ⇒ ok ومتاح', () => {
  const r = syn(PHP_VULN, 'page.php');
  assert.strictEqual(r.language, 'php');
  assert.strictEqual(r.ok, true, 'PHP سليم حُكم عليه بالكسر: ' + r.reason);
  assert.strictEqual(r.available, true, 'الفاحص غير متاح رغم وجوده');
  assert.strictEqual(r.reason, null);
});

test('PHP بعد إصلاح XSS ⇒ ok (وهو ما كان يُرفض)', () => {
  const r = syn(PHP_FIXED, 'page.php');
  assert.strictEqual(r.ok, true, 'ناتج الإصلاح حُكم عليه بالكسر: ' + r.reason);
  assert.strictEqual(r.available, true);
});

test('PHP مكسور ⇒ broken ومتاح (حكمٌ لا امتناع)', () => {
  const r = syn(PHP_BROKEN, 'page.php');
  assert.strictEqual(r.ok, false, 'كسرٌ لم يُكشف');
  assert.strictEqual(r.available, true, 'امتنع عن الحكم بدل أن يحكم بالكسر');
  assert.match(String(r.reason), /^broken:/, 'السبب لا يصف الكسر: ' + r.reason);
});

for (const [label, code] of [['heredoc', PHP_HEREDOC], ['وسم إغلاق ?>', PHP_CLOSETAG]]) {
  test(`بنية غير مدعومة (${label}) ⇒ لا حكم ⇒ غير متاح`, () => {
    const r = syn(code, 'page.php');
    assert.strictEqual(r.available, false, 'حَكَم على بنية لا يفهمها بثقة — تخمين');
    assert.strictEqual(r.ok, false, 'قَبِل بلا حكم');
    assert.match(String(r.reason), /not decidable/, 'السبب لا يُعلن الامتناع: ' + r.reason);
  });
}

// ═══ 2. أثر ذلك على البوابة نفسها — Fail-Closed محفوظ ══

test('البوابة: إصلاح PHP صحيح يُقبل الآن ويُحتسب ما أزاله', () => {
  const v = verify(PHP_VULN, PHP_FIXED, 'page.php');
  assert.strictEqual(v.accepted, true, 'رُفض إصلاح صحيح: ' + v.reason);
  assert.strictEqual(v.syntaxStatus, 'verified', 'حالة نحوية غير محقَّقة: ' + v.syntaxStatus);
  assert.ok(v.removedCount >= 1, 'قبول بلا إنقاص بلاغات: ' + v.removedCount);
  assert.doesNotMatch(String(v.reason), /NO_SYNTAX_CHECKER/, 'ما زال يُرفض لغياب الفاحص');
});

test('البوابة: مرشّح PHP مكسور يُرفض بسبب الكسر لا بسبب غياب الفاحص', () => {
  const v = verify(PHP_VULN, PHP_BROKEN, 'page.php');
  assert.strictEqual(v.accepted, false, 'قُبل مرشّح مكسور');
  assert.match(String(v.reason), /REJECTED_SYNTAX_BROKEN \[php\]/, 'سبب الرفض: ' + v.reason);
  assert.strictEqual(v.syntaxStatus, 'broken');
});

test('البوابة: بنية غير مدعومة تبقى مرفوضة — Fail-Closed كما كان', () => {
  // المرشّح يُزيل بلاغًا فعلًا، ومع ذلك يُرفض لأن الحكم النحوي غير محسوم.
  const beforeHd = PHP_HEREDOC + 'echo $_GET["name"];\n';
  const afterHd  = PHP_HEREDOC + 'echo htmlspecialchars($_GET["name"], ENT_QUOTES, "UTF-8");\n';
  const v = verify(beforeHd, afterHd, 'page.php');
  assert.strictEqual(v.accepted, false, 'قُبل تعديل على بنية لا يستطيع فحصها');
  assert.match(String(v.reason), /REJECTED_NO_SYNTAX_CHECKER \[php\]/, 'سبب الرفض: ' + v.reason);
  assert.strictEqual(v.syntaxStatus, 'no_checker');
});

test('البوابة: «ok» ليست قبولًا تلقائيًا — بقية الفحوص تعمل', () => {
  // تعديل لا يُنقص بلاغًا: نحوُه سليم، والبوابة ترفضه لسبب آخر.
  const noop = PHP_VULN.replace('$id = $_GET["id"];', '$id = $_GET["id"]; // note');
  const v = verify(PHP_VULN, noop, 'page.php');
  assert.strictEqual(v.accepted, false, 'قُبل تعديل بلا فائدة لمجرد سلامة نحوه');
  assert.doesNotMatch(String(v.reason), /SYNTAX/, 'رُفض لسبب نحوي لا لعدم الفائدة: ' + v.reason);
});

// فتح النحو لا يفتح باب SQL: حارس المعاملات يعمل على PHP كما على غيرها.
const PHP_SQL   = '<?php\n$id = $_GET["id"];\n$q = "SELECT * FROM users WHERE id=" . $id;\nmysql_query($q);\n';

test('البوابة: مرشّح PHP يُخفي إشارة SQL بلا إثبات معاملات ⇒ مرفوض', () => {
  // يكسر الكلمة ويُبدّل الاستدعاء، فتختفي البلاغات كلها بلا أي معاملات.
  const hide = PHP_SQL
    .replace('$q = "SELECT * FROM users WHERE id=" . $id;', '$q = "S" . "ELECT * FROM users WHERE id=" . $id;')
    .replace('mysql_query($q);', 'run_query($q);');
  const v = verify(PHP_SQL, hide, 'page.php');
  assert.strictEqual(v.accepted, false, 'قُبل تعديل يُخفي الثغرة بلا إصلاحها: ' + v.reason);
  assert.match(String(v.reason), /REJECTED_SQL_NOT_PARAMETERIZED/,
    'رُفض لسبب آخر؛ المطلوب أن يمسكه حارس المعاملات تحديدًا: ' + v.reason);
});

test('موثَّق: إصلاح PHP SQL صحيح (PDO) يبقى مرفوضًا — لا مُثبِت معاملات لـphp', () => {
  // حدٌّ معلن لا عيب: sqlCandidateLooksParameterized فيه فروع js/ts وpy وcs
  // ولا فرع لـphp، فيُرجع false ⇒ أي اختفاء لإشارة SQL في php يُرفض. وهذا
  // Fail-Closed سليم: المنع أأمن من قبول ما لا نستطيع إثباته. ومعناه أن فتح
  // الفاحص النحوي **لم** يفتح إصلاحات SQL لـphp — فتح غيرها فقط (XSS مقيس).
  // إضافة فرع php (prepare/execute/bind_param) خطوة مستقلة تمسّ تحقّق SQL،
  // فلا تُدرَج هنا. وهذا الاختبار يُسقط أي تغيير صامت في ذلك.
  const pdo = '<?php\n$id = $_GET["id"];\n$stmt = $pdo->prepare("SELECT * FROM users WHERE id=?");\n$stmt->execute([$id]);\n';
  const v = verify(PHP_SQL, pdo, 'page.php');
  assert.strictEqual(v.accepted, false,
    'تغيّر السلوك: صار يَقبل إصلاح SQL لـphp — راجع هذا التوثيق وأضف اختبارات إثبات');
  assert.match(String(v.reason), /REJECTED_SQL_NOT_PARAMETERIZED/, 'سبب الرفض: ' + v.reason);
});

// ═══ 3. اللغات الأخرى لم تُمَس ══════════════════════════

test('لا مساس: JavaScript يُفحَص بـacorn كما كان', () => {
  const ok = syn('function f(a){ return a + 1; }\n', 'a.js');
  assert.deepStrictEqual([ok.language, ok.ok, ok.available], ['javascript', true, true]);
  const bad = syn('function f(a){ return a + ; }\n', 'a.js');
  assert.strictEqual(bad.ok, false, 'كسر js لم يُكشف');
  assert.strictEqual(bad.available, true);
});

test('لا مساس: TypeScript تبقى على سلوكها (مُترجم أو لا حكم)', () => {
  const r = syn('const x: number = 1;\n', 'a.ts');
  assert.strictEqual(r.language, 'typescript');
  if (r.available) assert.strictEqual(r.ok, true, 'TS سليم حُكم عليه بالكسر مع توفّر مُترجم');
  else assert.match(String(r.reason), /no TypeScript compiler available/, 'سبب TS تغيّر: ' + r.reason);
});

test('لا مساس: Python وJSON واللغة المجهولة', () => {
  const py = syn('def f(a):\n    return a\n', 'a.py');
  assert.strictEqual(py.language, 'python');
  assert.strictEqual(py.ok, true, 'py سليم حُكم عليه بالكسر: ' + py.reason);
  const js = syn('{"a":1}', 'a.json');
  assert.deepStrictEqual([js.ok, js.available], [true, true]);
  const bad = syn('{"a":}', 'a.json');
  assert.strictEqual(bad.ok, false);
  const un = syn('anything', 'a.xyz');
  assert.strictEqual(un.available, false, 'لغة مجهولة صارت مفحوصة');
  assert.match(String(un.reason), /unknown file type/);
});

test('لا مساس: فحص SQL في البوابة يبقى على js كما كان', () => {
  const before = 'function f(db, x) {\n  db.query("SELECT * FROM t WHERE a=" + x);\n}\n';
  const sneaky = 'function f(db, x) {\n  db.query("S" + "ELECT * FROM t WHERE a=" + x);\n}\n';
  const v = verify(before, sneaky, 'a.js');
  assert.strictEqual(v.accepted, false, 'قُبل تعديل يُخفي إشارة SQL في js: ' + v.reason);
});

// ═══ 4. لا انحراف بين نسختَي الفاحص ═══════════════════

test('لا انحراف: نسخة fix_verifier مطابقة نصًّا لنسخة مسار الخادم', () => {
  const grab = (src, file) => {
    const i = src.indexOf('function structuralSyntax(code, lang) {');
    assert.ok(i >= 0, 'structuralSyntax غير موجودة في ' + file);
    // نهاية الدالة: أول سطر إغلاق بمحاذاة التعريف نفسه
    const indent = src.slice(src.lastIndexOf('\n', i) + 1, i);
    const endMark = '\n' + indent + '}\n';
    const j = src.indexOf(endMark, i);
    assert.ok(j > i, 'تعذّر تحديد نهاية الدالة في ' + file);
    return src.slice(i, j + endMark.length)
      .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
  };
  const a = grab(fs.readFileSync(FV_PATH, 'utf8'), 'fix_verifier.js');
  const b = grab(fs.readFileSync(SRV_PATH, 'utf8'), 'server_engine_registration.js');
  assert.strictEqual(a, b,
    'النسختان تباعدتا — وحّدهما أو أزل إحداهما؛ فاحصان مختلفان على نفس اللغة خطر');
});

test('لا انحراف: التعيين على البوابة مكتوب صريحًا في الإنتاج', () => {
  const src = fs.readFileSync(FV_PATH, 'utf8');
  assert.match(src, /language === "php"/, 'فرع php غائب من syntaxCheck');
  assert.match(src, /not decidable/, 'رسالة الامتناع غائبة');
  // "unknown" يجب أن تبقى available:false — وإلا انكسر Fail-Closed
  const m = src.match(/if \(v === "unknown"\)[\s\S]{0,200}?available: false/);
  assert.ok(m, 'البنية غير المحسومة لم تعد غير متاحة ⇒ Fail-Closed انكسر');
});
