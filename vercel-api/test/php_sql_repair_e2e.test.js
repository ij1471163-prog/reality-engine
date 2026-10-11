// ═══════════════════════════════════════════════════════════════════════
// SQL Injection في PHP — الدورة كاملة من البلاغ إلى الكتابة
// تشغيل:  node --test vercel-api/test/php_sql_repair_e2e.test.js
//
// المسار كان متوقّفًا، والسبب شِقّان مقيسان لا مفترضان:
//
//   [1] البوابة: ‎sqlCandidateLooksParameterized‎ لها فروعُ js/ts وpy وcs
//       **ولا فرع لـphp**، فتسقط إلى ‎return false‎. فكلُّ إصلاح SQL في PHP
//       يُرفض بـREJECTED_SQL_NOT_PARAMETERIZED ولو كان صحيحًا تمامًا.
//       والمقيس: ‎RepairSQL.fix‎ يُرجع ‎count=1‎ ثم تردّه البوابة.
//
//   [2] المُصلِح: ناتج ‎RepairSQL‎ على الشكل الأشيع ‎return $pdo->query(…)‎ كان
//           return $stmt = $pdo->prepare("… ?");
//           $stmt->execute([$name]);
//       فالدالة تعود بـstatement لم يُنفَّذ، وسطر execute لا يُبلَغ. صحيحُ
//       النحو، خاطئُ الدلالة. ولا تكشفه بوابةُ PHP: لا محلّل وصول لها
//       (نظير pyReachabilityVerdict مقصورٌ على بايثون)، فعُولج عند المصدر.
//
// ولذلك لا يكفي فتحُ البوابة لـphp: بلا [2] تصير البوابة تقبل ناتجًا مكسور
// الدلالة. القسم 1 يثبّت المُصلِح، والقسم 2 البوابة، والقسم 3 الدورة كاملة
// عبر fix_engine_pipeline، والقسم 4 حدودَ القدرة كما قاسها الاختبار.
//
// العزل: لا ملف على القرص يُقرأ ولا يُكتب إلا مصادر المحركات؛ العيّنات نصوص
// في الذاكرة، وlocalStorage مخزن حقيقي لكل سياق لا يمسّ أي حالة حقيقية.
// ═══════════════════════════════════════════════════════════════════════
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
    document: {
      getElementById: () => ({ style: {} }), addEventListener: noop,
      createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); },
    },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (_) {}
  }
  ctx.toast = noop; ctx.refreshStats = noop; ctx.__store = store;
  return ctx;
}

const ctx = loadCtx();

const run = (expr, vars) => {
  for (const k of Object.keys(vars || {})) {
    vm.runInContext(k + ' = ' + JSON.stringify(vars[k]) + ';', ctx);
  }
  return JSON.parse(vm.runInContext('JSON.stringify(' + expr + ')', ctx));
};

const repairSql = code => run('(()=>{const r=window.RepairSQL.fix(__C,"db.php");' +
  'return {count:r.count, driver:r.driver, reason:r.reason||null, code:r.code};})()', { __C: code });

const gate = (before, after) => run('(()=>{const v=window.FixVerifier.verifyFix(__B,__A,"db.php",window.analyzeCode);' +
  'return {accepted:v.accepted===true, reason:String(v.reason||"")};})()', { __B: before, __A: after });

const issues = code => run('(window.analyzeCode(__C,"db.php")||[]).map(i=>String(i.type)+"|"+String(i.title||""))',
  { __C: code });

// العيّنة الواقعية: PDO مُنشأ (شرطُ detectDriver — لا تخمين سائق)، واستعلام
// مُسلسَل بمتغيّر واحد في موضع equality، في موضع return.
const VULN = '<?php\n' +
  '$pdo = new PDO("mysql:host=localhost;dbname=app", $u, $p);\n' +
  'function get($pdo, $name) {\n' +
  '  return $pdo->query("SELECT * FROM t WHERE n = \'" . $name . "\'");\n' +
  '}\n';

// ═══ 0. شروط العزل — تمنع التغطية الخاوية ══════════════════════════════

test('[PHP-0] العيّنة يُبلَّغ عنها فعلًا، والسائق مُثبَت لا مُخمَّن', () => {
  const list = issues(VULN);
  assert.ok(list.some(t => /sql/i.test(t)), 'لا بلاغ SQL على العيّنة: ' + JSON.stringify(list));

  const r = repairSql(VULN);
  assert.strictEqual(r.driver, 'PDO', 'السائق لم يُثبَت: ' + r.driver + ' · ' + r.reason);

  // ونفس العيّنة بلا ‎new PDO‎: لا سائق ⇒ لا إصلاح. قاعدةُ المحرك لا ثغرة.
  const noDriver = VULN.replace(/^\$pdo = new PDO[^\n]*\n/m, '');
  const r2 = repairSql(noDriver);
  assert.strictEqual(r2.count, 0, 'أُصلح بلا إثبات سائق');
  assert.strictEqual(r2.reason, 'unknown_or_conflicting_driver', String(r2.reason));
});

// ═══ 1. المُصلِح: الناتج صحيحُ الدلالة لا النحو وحده ═══════════════════

test('[PHP-1] ناتج RepairSQL عبارتان مرتّبتان، والـreturn على النتيجة لا على prepare', () => {
  const r = repairSql(VULN);
  assert.strictEqual(r.count, 1, 'لم يُنتَج إصلاح: ' + r.reason);
  const out = r.code;

  // الثلاثة بالترتيب: تحضير ⇒ تنفيذ ⇒ إعادة
  const L = out.split('\n').map(s => s.trim());
  const iPrep = L.findIndex(s => /^\$stmt = \$pdo->prepare\(/.test(s));
  const iExec = L.findIndex(s => /^\$stmt->execute\(\[\$name\]\);$/.test(s));
  const iRet  = L.findIndex(s => /^return \$stmt;$/.test(s));
  assert.ok(iPrep >= 0, 'لا سطر prepare:\n' + out);
  assert.ok(iExec > iPrep, 'التنفيذ لا يلي التحضير:\n' + out);
  assert.ok(iRet > iExec, 'الإعادة لا تلي التنفيذ:\n' + out);

  // الخلل الذي كان: ‎return‎ ملتصقًا بـprepare ⇒ تنفيذٌ لا يُبلَغ
  assert.doesNotMatch(out, /return\s+\$stmt\s*=/,
    'الـreturn لا يزال على prepare — سطر execute غير قابل للوصول:\n' + out);

  // الإزاحة محفوظة: الأسطر الثلاثة داخل الدالة بنفس إزاحة السطر الأصلي
  for (const rx of [/^ {2}\$stmt = \$pdo->prepare\(/m, /^ {2}\$stmt->execute\(/m, /^ {2}return \$stmt;/m]) {
    assert.match(out, rx, 'الإزاحة لم تُحفَظ:\n' + out);
  }

  // والمعامِل في موضع القيمة، والمتغيّر خرج من النص
  assert.match(out, /prepare\("SELECT \* FROM t WHERE n = \?"\)/, out);
  assert.doesNotMatch(out, /"[^"\n]*"\s*\.\s*\$name/, 'التسلسل باقٍ:\n' + out);
});

test('[PHP-1b] ‎$stmt‎ مستعمَلٌ في الملف ⇒ لا يُدَسّ اسمٌ يطمس قيمة قائمة', () => {
  const taken = VULN.replace('function get($pdo, $name) {',
    '$stmt = "قيمة قائمة";\nfunction get($pdo, $name) {');
  const r = repairSql(taken);
  assert.strictEqual(r.count, 0, 'أُعيد استخدام $stmt فوق قيمة قائمة');
  assert.strictEqual(r.code, taken, 'الكود تغيّر رغم تعارض الاسم');
});

test('[PHP-1c] الإسناد كالـreturn: ‎$res = $pdo->query(…)‎ يبقى مُسنَدًا', () => {
  const src = VULN.replace('  return $pdo->query(', '  $res = $pdo->query(')
                  .replace('");\n}\n', '");\n  return $res;\n}\n');
  const r = repairSql(src);
  assert.strictEqual(r.count, 1, 'لم يُنتَج إصلاح على شكل الإسناد: ' + r.reason);
  assert.match(r.code, /^ {2}\$res = \$stmt;$/m, 'الإسناد ضائع:\n' + r.code);
  assert.doesNotMatch(r.code, /\$res\s*=\s*\$stmt\s*=/, 'إسنادٌ متسلسل على prepare:\n' + r.code);
});

// ═══ 2. البوابة: فرع php يُثبت الربط، ولا يقبل مجرّد ظهور prepare ══════

test('[PHP-2] البوابة تقبل الإصلاح الصحيح — وكانت ترفضه بلا فرع php', () => {
  const r = repairSql(VULN);
  assert.strictEqual(r.count, 1, 'العزل: لا مُرشَّح ⇒ لا حكم');
  const v = gate(VULN, r.code);
  assert.strictEqual(v.accepted, true, 'رُفض إصلاح PHP صحيح: ' + v.reason);
});

test('[PHP-2b] ولا تقبل ما لا يُثبت الربط: prepare بلا تنفيذ، ولا معامِل، ولا محو', () => {
  const head = '<?php\n$pdo = new PDO("mysql:host=localhost;dbname=app", $u, $p);\n';

  // (أ) prepare بمعامِل لكن بلا ربطِ قيم
  const noBind = head + 'function get($pdo, $name) {\n' +
    '  return $pdo->prepare("SELECT * FROM t WHERE n = ?");\n}\n';
  const a = gate(VULN, noBind);
  assert.strictEqual(a.accepted, false, 'قُبل prepare بلا ربط: ' + a.reason);
  assert.match(a.reason, /^REJECTED_SQL_NOT_PARAMETERIZED/, a.reason);

  // (ب) ربطٌ بلا موضع معامِل، والنصُّ مُثبَّت: البلاغ يزول فعلًا (sqlAfter=0)
  //     فالحكم يصل إلى مُثبِت php، والمطلوب أن يرفضه لانعدام المعامِل.
  //     وهذه الحالة كشفها سحبُ التحوّرات: كان فحصُ المعامِل على الملف كله،
  //     و‎<?php‎ يحمل ‎?‎، فكان الفحص خاملًا دائمًا وهذا المُرشَّح يُقبل.
  const noPh = head + 'function get($pdo, $name) {\n' +
    '  $stmt = $pdo->prepare("SELECT * FROM t WHERE n = \'fixed\'");\n' +
    '  $stmt->execute([$name]);\n  return $stmt;\n}\n';
  const b = gate(VULN, noPh);
  assert.strictEqual(b.accepted, false, 'قُبل ربطٌ بلا معامِل: ' + b.reason);
  assert.match(b.reason, /^REJECTED_SQL_NOT_PARAMETERIZED/,
    'رُفض لسبب آخر؛ المطلوب أن يمسكه مُثبِت php تحديدًا: ' + b.reason);

  // (ب-مرجع) وتسلسلٌ باقٍ داخل prepare: البلاغ لم ينقص، ومع ذلك أُعيدت
  //     كتابةُ تعبيرِ السطر — فيمسكه مُثبِت php عبر مُطلِق EXPR-REWRITE.
  //     (كان يمسكه requireImprovement قبل ذلك المُطلِق؛ الرفض الآن أدقّ
  //     لأنه يُسمّي الدعوى غير المُثبتة بدل «لا تحسّن».)
  const stillConcat = head + 'function get($pdo, $name) {\n' +
    '  $stmt = $pdo->prepare("SELECT * FROM t WHERE n = \'" . $name . "\'");\n' +
    '  $stmt->execute([]);\n  return $stmt;\n}\n';
  const b2 = gate(VULN, stillConcat);
  assert.strictEqual(b2.accepted, false, 'قُبل تسلسلٌ باقٍ: ' + b2.reason);
  assert.match(b2.reason, /^REJECTED_SQL_NOT_PARAMETERIZED/, b2.reason);
  assert.match(b2.reason, /أُعيدت كتابة تعبيرِ السطر/, b2.reason);

  // (ج) محوُ الاستعلام: البلاغ يختفي ولا إصلاح
  const erased = head + 'function get($pdo, $name) {\n  return null;\n}\n';
  const c = gate(VULN, erased);
  assert.strictEqual(c.accepted, false, 'قُبل محوُ الاستعلام: ' + c.reason);
});

test('[PHP-2d] والاستعلام في متغيّر ثم prepare($sql) يُقبل — لا حصرَ بوسيط prepare', () => {
  // شكلٌ صحيحٌ شائع. لو حُصر فحصُ المعامِل بوسيط prepare وحده لرُفض.
  const a = '<?php\n$pdo = new PDO("mysql:host=localhost;dbname=app", $u, $p);\n' +
    'function get($pdo, $name) {\n' +
    '  $sql = "SELECT * FROM t WHERE n = ?";\n' +
    '  $stmt = $pdo->prepare($sql);\n' +
    '  $stmt->execute([$name]);\n  return $stmt;\n}\n';
  const v = gate(VULN, a);
  assert.strictEqual(v.accepted, true, 'رُفض شكلُ الاستعلام في متغيّر: ' + v.reason);
});

test('[PHP-2c] وصيغة $wpdb->prepare تُثبَت أيضًا — لا PDO وحده', () => {
  const b = '<?php\nfunction f($id) {\n' +
    '  global $wpdb;\n' +
    '  return $wpdb->query("SELECT * FROM wp_t WHERE id = " . $id);\n}\n';
  const a = '<?php\nfunction f($id) {\n' +
    '  global $wpdb;\n' +
    '  return $wpdb->query($wpdb->prepare("SELECT * FROM wp_t WHERE id = %d", $id));\n}\n';
  assert.ok(issues(b).some(t => /sql/i.test(t)), 'لا بلاغ على عيّنة wpdb: ' + JSON.stringify(issues(b)));
  const v = gate(b, a);
  assert.strictEqual(v.accepted, true, 'رُفض إصلاح $wpdb صحيح: ' + v.reason);
});

// ═══ 3. الدورة كاملة عبر المسار الإنتاجي ═══════════════════════════════

test('[PHP-3] fix_engine_pipeline يكتب الإصلاح في الملف ويُسجّله مقبولًا', () => {
  const c = loadCtx();
  vm.runInContext('F = { "db.php": ' + JSON.stringify(VULN) + ' };', c);
  vm.runInContext('R = {}; Object.keys(F).forEach(k => { R[k] = { code: F[k], issues: analyzeCode(F[k], k) }; });', c);
  const report = JSON.parse(vm.runInContext('JSON.stringify(fixAllEnginePipeline())', c));
  const out = JSON.parse(vm.runInContext('JSON.stringify(F)', c));
  const rState = JSON.parse(vm.runInContext('JSON.stringify(R["db.php"] && R["db.php"].code)', c));

  assert.notStrictEqual(out['db.php'], VULN, 'الملف لم يتغيّر — المسار ما زال متوقفًا');
  assert.match(out['db.php'], /\$stmt = \$pdo->prepare\("SELECT \* FROM t WHERE n = \?"\);/,
    'الإصلاح لم يُكتب:\n' + out['db.php']);
  assert.match(out['db.php'], /\$stmt->execute\(\[\$name\]\);/, out['db.php']);
  assert.match(out['db.php'], /return \$stmt;/, out['db.php']);
  assert.doesNotMatch(out['db.php'], /"[^"\n]*"\s*\.\s*\$name/, 'التسلسل باقٍ في الملف');

  // سُجِّل مقبولًا، ومصدرُه RepairSQL، وR مُزامَن مع F
  const acc = (report.accepted || []).filter(a => a.file === 'db.php' || a.fileName === 'db.php');
  assert.ok(acc.length >= 1, 'لا سجل قبول للملف: ' + JSON.stringify(report.accepted || []));
  assert.ok(acc.some(a => /RepairSQL/.test(String(a.source))),
    'المصدر ليس RepairSQL: ' + JSON.stringify(acc.map(a => a.source)));
  assert.strictEqual(rState, out['db.php'], 'R لا يطابق F بعد الكتابة');

  // والبلاغ زال فعلًا — لا مجرّد قبولٍ مُسجَّل
  const after = JSON.parse(vm.runInContext(
    'JSON.stringify((analyzeCode(F["db.php"],"db.php")||[]).map(i=>String(i.type)+"|"+String(i.title||"")))', c));
  assert.ok(!after.some(t => /sql/i.test(t)), 'بلاغ SQL باقٍ بعد الإصلاح: ' + JSON.stringify(after));
});

// ═══ 4. حدودُ القدرة — مقيسة ومُعلَنة، لا موعودة ═══════════════════════

test('[PHP-4] الأشكال التي كانت بلا تغطية صارت مُغطّاة — PDO وmysqli وإقحام', () => {
  // كانت هذه الثلاثة موثَّقةً كحدودٍ معلنة: لا مُرشَّح لها إطلاقًا. وقد
  // عُولجت في مصدرها، فيُثبَّت الآن أنها تُصلَح — وإلا عاد النقص بصمت.
  //   • بلا لاحقة نصّية : اللاحقة صارت اختيارية في نمط PDO
  //   • mysqli_query    : فرعٌ جديد بـprepare/bind_param/execute/get_result
  //   • الإقحام في النصّ: مواضعُ معامِلات من ‎$v‎ و‎{$v}‎ و‎'$v'‎
  const head = '<?php\n$pdo = new PDO("mysql:host=localhost;dbname=app", $u, $p);\n';
  const mys  = '<?php\n$conn = new mysqli("localhost", $u, $p, "app");\n';
  const cases = {
    'بلا لاحقة نصّية بعد المتغيّر': [
      head + 'function get($pdo, $id) {\n  return $pdo->query("SELECT * FROM t WHERE id = " . $id);\n}\n',
      /\$stmt = \$pdo->prepare\("SELECT \* FROM t WHERE id = \?"\);/],
    'mysqli_query': [
      mys + 'function get($conn, $id) {\n  return mysqli_query($conn, "SELECT * FROM t WHERE id = " . $id);\n}\n',
      /\$stmt->bind_param\("s", \$id\);/],
    'إقحام متغيّر داخل النصّ': [
      head + 'function get($pdo, $id) {\n  return $pdo->query("SELECT * FROM t WHERE id = $id");\n}\n',
      /\$stmt->execute\(\[\$id\]\);/],
  };
  for (const [name, [code, expected]] of Object.entries(cases)) {
    const r = repairSql(code);
    assert.strictEqual(r.count, 1, name + ': لم يُنتَج إصلاح — ' + r.reason);
    assert.match(r.code, expected, name + ':\n' + r.code);
    assert.doesNotMatch(r.code, /"[^"\n]*"\s*\.\s*\$/, name + ': التسلسل باقٍ');
  }
});

test('[PHP-4c] وما لا يُضمَن ترجمتُه يبقى بلا مساس — fail-closed', () => {
  // الحدُّ المُعلَن الآن ليس «الأشكال» بل «ما لا نضمنه»: خاصيةُ كائن أو
  // عنصرُ مصفوفة داخل الإقحام يُنتج استعلامًا مكسورًا لو تُرجم بسذاجة
  // (‎id = ?->p‎)، فيُرَدّ السطر كما هو. وهذا مقيس: أسقطته اختباراتُ
  // السلبيات قبل إضافة النظر الأمامي.
  const head = '<?php\n$pdo = new PDO("mysql:host=localhost;dbname=app", $u, $p);\n';
  const untouched = {
    'خاصية كائن $o->p': head + 'function g($pdo, $o) {\n  return $pdo->query("SELECT * FROM t WHERE id = $o->p");\n}\n',
    'عنصر مصفوفة $a[k]': head + 'function g($pdo, $a) {\n  return $pdo->query("SELECT * FROM t WHERE id = $a[k]");\n}\n',
    'نصٌّ مفرد لا إقحام فيه': head + "function g($pdo, $i) {\n  return $pdo->query('SELECT * FROM t WHERE id = $i');\n}\n",
    'بلا سائق مُثبَت': '<?php\nfunction g($pdo, $i) {\n  return $pdo->query("SELECT * FROM t WHERE id = $i");\n}\n',
    '$stmt مستعمَل في الملف': head + '$stmt = 1;\nfunction g($pdo, $i) {\n  return $pdo->query("SELECT * FROM t WHERE id = $i");\n}\n',
  };
  for (const [name, code] of Object.entries(untouched)) {
    const r = repairSql(code);
    assert.strictEqual(r.count, 0, name + ': أُنتج مُرشَّح غير مضمون:\n' + r.code);
    assert.strictEqual(r.code, code, name + ': الكود تغيّر');
  }
});

test('[PHP-4b] documented: البوابة تُثبت الربط لا سلامة التدفّق في PHP', () => {
  // بلا محلّل وصول لـPHP، ناتجٌ يضع prepare في موضع تعبير تقبله البوابة.
  // ولذلك عُولج ذلك الشكل عند مصدره في repair_sql.js لا هنا. يُثبَّت الحدّ
  // صراحةً كي لا يُفهَم القبول على أنه إثباتُ صحةٍ دلالية.
  const broken = '<?php\n$pdo = new PDO("mysql:host=localhost;dbname=app", $u, $p);\n' +
    'function get($pdo, $name) {\n' +
    '  return $stmt = $pdo->prepare("SELECT * FROM t WHERE n = ?");\n' +
    '  $stmt->execute([$name]);\n}\n';
  const v = gate(VULN, broken);
  assert.strictEqual(v.accepted, true,
    'إن صارت البوابة ترفضه فقد تحسّنت القدرة — فليُحدَّث هذا التوثيق: ' + v.reason);

  // ومع ذلك: المحرك لا يُنتج هذا الشكل بعد [PHP-PREFIX]
  assert.doesNotMatch(repairSql(VULN).code, /return\s+\$stmt\s*=/,
    'المحرك ما زال يُنتج الشكل المكسور');
});

test('[PHP-5] لا ملف إنتاج يتغيّر بهذه الجولة', () => {
  const crypto = require('node:crypto');
  const watch = ['repair_sql.js', 'fix_verifier.js', 'repair_engine.js', 'php_analyzer.js']
    .filter(f => fs.existsSync(path.join(PUBLIC_DIR, f)));
  const h = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(PUBLIC_DIR, f))).digest('hex');
  const before = watch.map(h);
  repairSql(VULN);
  gate(VULN, repairSql(VULN).code);
  assert.deepStrictEqual(watch.map(h), before, 'ملف إنتاج تغيّر');
});
