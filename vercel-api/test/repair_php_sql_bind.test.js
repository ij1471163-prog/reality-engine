// ═══════════════════════════════════════════════════════
// جملةُ PHP المُحضَّرةُ على كائنِ الاتصالِ الحقيقيّ — لا كائنٍ مُخترَع
// تشغيل:  node --test vercel-api/test/repair_php_sql_bind.test.js
//
// الفرعُ السابقُ كان يكتب رقعةً **مقبولةً** تكسر البرنامجَ ولا تُصلح
// الثغرة. على
//     $sql = "SELECT * FROM u WHERE n = " . $name;
//     return $db->query($sql);
// كان يُنتج
//     $stmt = $conn->prepare("SELECT * FROM u WHERE n = ?");
//     $stmt->bind_param("s", $name);
//     $stmt->execute();
//     return $db->query($sql);
// وفيه ثلاثةُ أعطابٍ مجتمعة:
//   1. ‎$conn‎ كائنٌ **مُخترَعٌ** لا وجودَ له في الدالّة ⇒ خطأٌ قاتلٌ عند
//      التشغيل، والنحوُ سليمٌ فلا يلتقطه فاحصُ البناء.
//   2. ‎$sql‎ حُذف تعريفُه وبقي استعمالُه في السطرِ التالي.
//   3. الجملةُ المُحضَّرةُ تُنفَّذ ثم يُطرَح ناتجُها، والمُعادُ هو المسارُ
//      غيرُ الآمنِ نفسُه — فالثغرةُ باقيةٌ بحالها.
// ومرّت البوابةُ لأنّ الضمَّ اختفى من السطرِ فاختفى البلاغُ: اختفاءُ
// البلاغِ لا يساوي زوالَ المشكلة.
//
// والنسخةُ نفسُها كانت في أربعةِ مواضعَ على مسارِ الصفحة —
// ‎smart_repair‎، ‎emergency_fixes‎، ‎sql_injection_fix‎، و‎taint_php‎ حيث
// كان نصًّا شكلُه كودٌ يُعرَض بزرِّ «تطبيق آمن» عند ‎conf:90‎. و‎[PHP-BIND]‎
// يجعل البابَ واحدًا: ‎_phpBindStatement‎ في ‎repair_engine‎.
//
// ولا يخترع شيئًا: كائنُ الاتصالِ يُؤخَذ من سطرِ التنفيذ، والمحرّكُ يُستدَلُّ
// عليه من الملفِّ (PDO أو mysqli)، والسطرانِ يُعادُ كتابتُهما معًا. وما
// لم يُعرَف ⇒ امتناعٌ مُعلَنٌ في ‎aiNeeded‎، لا رقعةٌ تكسر البرنامج.
// ═══════════════════════════════════════════════════════
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const os = require('node:os'), { execFileSync } = require('node:child_process');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadUiContext() {
  const store = new Map(), noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => null, addEventListener: noop, createElement: () => ({}),
                querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null),
                    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة */ }
  }
  return ctx;
}
const ctx = loadUiContext();
const cycle = (code, fn) => {
  const issues = ctx.analyzeCode(code, fn) || [];
  const r = ctx.repairCode(code, issues.map(x => Object.assign({}, x)), fn);
  return { r, repaired: (r && typeof r.repaired === 'string') ? r.repaired : code };
};

const PDO_HEAD    = '<?php\n$pdo = new PDO("mysql:host=h", "u", "p");\n';
const MYSQLI_HEAD = '<?php\n$db = new mysqli("h", "u", "p", "d");\n';

const PDO_ASSIGN = PDO_HEAD + 'function f($pdo, $name) {\n  $sql = "SELECT * FROM u WHERE n = " . $name;\n  return $pdo->query($sql);\n}\n';
const PDO_DIRECT = PDO_HEAD + 'function f($pdo, $name) {\n  return $pdo->query("SELECT * FROM u WHERE n = \'" . $name . "\'");\n}\n';
const MYSQLI_ASSIGN = MYSQLI_HEAD + 'function f($db, $name) {\n  $sql = "SELECT * FROM u WHERE n = " . $name;\n  return $db->query($sql);\n}\n';

// امتناعاتٌ مقصودة
const NO_DRIVER = '<?php\nfunction f($db, $name) {\n  return $db->query("SELECT * FROM u WHERE n = \'" . $name . "\'");\n}\n';
const NO_EXEC   = PDO_HEAD + '$q = "SELECT * FROM t WHERE id = " . $uid;\n';
const MYSQLI_EXPR = MYSQLI_HEAD + 'function f($db, $u) {\n  $sql = "SELECT * FROM t WHERE id = " . $u->id;\n  return $db->query($sql);\n}\n';

const phpBin = (() => {
  try { execFileSync('php', ['--version'], { stdio: 'pipe' }); return 'php'; } catch (e) { return null; }
})();
function phpRun(src, name) {
  if (!phpBin) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phpbind-'));
  const f = path.join(dir, name + '.php');
  fs.writeFileSync(f, src);
  const out = { lint: false, text: '' };
  try { execFileSync(phpBin, ['-l', f], { stdio: 'pipe' }); out.lint = true; }
  catch (e) { out.text = String((e && e.stdout) || e); return out; }
  try { out.text = execFileSync(phpBin, [f], { stdio: 'pipe' }).toString().trim(); }
  catch (e) { out.text = 'RUNTIME ERROR: ' + String((e && e.stdout) || '') + String((e && e.stderr) || ''); }
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

test('[PB-1] لا كائنَ اتصالٍ مُخترَع: كلُّ مُستقبِلٍ معرَّفٌ في الملفّ', () => {
  for (const [label, code] of [['pdo/إسناد', PDO_ASSIGN], ['pdo/مباشر', PDO_DIRECT], ['mysqli', MYSQLI_ASSIGN]]) {
    const { repaired } = cycle(code, 'a.php');
    assert.doesNotMatch(repaired, /\$conn\b/, label + ': كُتبت $conn المُخترَعة\n' + repaired);
    for (const m of repaired.matchAll(/(\$[A-Za-z_]\w*)\s*->\s*prepare\s*\(/g)) {
      const name = m[1].slice(1);
      assert.match(repaired, new RegExp('\\$' + name + '\\s*=\\s*new\\b|function\\s+\\w+\\s*\\([^)]*\\$' + name + '\\b'),
        label + ': مُستقبِلٌ غيرُ معرَّف: ' + m[1] + '\n' + repaired);
    }
  }
});

test('[PB-2] ولا متغيّرَ يُقرأ بعد حذفِ تعريفِه', () => {
  const { repaired } = cycle(PDO_ASSIGN, 'a.php');
  // ‎$sql‎ إمّا بقي معرَّفًا ومستعمَلًا، وإمّا زال الاثنان معًا
  const defined = /\$sql\s*=/.test(repaired);
  const used = /[^$\w]\$sql\b(?!\s*=)/.test(repaired);
  assert.ok(defined || !used, 'يُقرأ $sql بلا تعريف:\n' + repaired);
});

test('[PB-3] والمُنفَّذُ هو الجملةُ المُحضَّرة، لا النصُّ المضموم', () => {
  for (const [label, code] of [['pdo/إسناد', PDO_ASSIGN], ['pdo/مباشر', PDO_DIRECT], ['mysqli', MYSQLI_ASSIGN]]) {
    const { repaired } = cycle(code, 'a.php');
    assert.doesNotMatch(repaired, /->\s*query\s*\(/, label + ': بقي المسارُ غيرُ الآمن\n' + repaired);
    assert.match(repaired, /->\s*prepare\s*\(/, label + ': لا جملةَ مُحضَّرة');
    assert.doesNotMatch(repaired, /"[^"\n]*"\s*\.\s*\$/, label + ': بقي الضمُّ في نصِّ SQL');
  }
});

test('[PB-4] وما لا يُضمَن يُرفَض صراحةً ويُعلَن — لا رقعةَ تخمين', () => {
  const CASES = [
    ['محرّكٌ مجهول', NO_DRIVER],
    ['بلا موضعِ تنفيذ', NO_EXEC],
    ['mysqli بمعامِلٍ ليس متغيّرًا', MYSQLI_EXPR],   // bind_param يأخذ المراجع
  ];
  for (const [label, code] of CASES) {
    const { r, repaired } = cycle(code, 'a.php');
    assert.strictEqual(repaired, code, label + ': كُتب تعديلٌ بلا ضمان\n' + repaired);
    assert.strictEqual((r.repairs || []).length, 0, label + ': سُجِّل إصلاح');
    assert.ok((r.aiNeeded || []).some(a => String(a.strategy) === 'SQL_INJECTION'),
      label + ': امتناعٌ صامتٌ بلا إعلان — ' + JSON.stringify(r.aiNeeded));
  }
});

test('[PB-5] والسلوكُ مُثبَتٌ على PHP حقيقيّ: الحميدُ محفوظ والحقنُ مُغلَق', () => {
  if (!phpBin) { assert.ok(true, 'لا php في البيئة'); return; }
  const SRC = [
    '<?php',
    '$pdo = new PDO("sqlite::memory:");',
    '$pdo->exec("CREATE TABLE u (n TEXT)");',
    '$pdo->exec("INSERT INTO u (n) VALUES (\'ali\'), (\'sara\')");',
    'function f($pdo, $name) {',
    '  $sql = "SELECT * FROM u WHERE n = \'" . $name . "\'";',
    '  return $pdo->query($sql);',
    '}',
    '$benign = f($pdo, "ali");',
    'echo "benign=" . count($benign->fetchAll(PDO::FETCH_ASSOC)) . "\\n";',
    '$evil = f($pdo, "x\' OR \'1\'=\'1");',
    'echo "evil=" . count($evil->fetchAll(PDO::FETCH_ASSOC)) . "\\n";',
    '',
  ].join('\n');
  const before = phpRun(SRC, 'before');
  if (!before || !before.lint || !/benign=1/.test(before.text)) {
    assert.ok(true, 'tripwire البيئة: العيّنةُ لا تعمل — ' + (before && before.text));
    return;
  }
  assert.match(before.text, /evil=2/, 'tripwire: الحقنُ لا يعمل في العيّنة');
  const { repaired } = cycle(SRC, 'db.php');
  assert.notStrictEqual(repaired, SRC, 'لم يُصلَح شيء');
  const after = phpRun(repaired, 'after');
  assert.ok(after.lint, 'الناتجُ لا يجتاز php -l:\n' + after.text + '\n' + repaired);
  assert.match(after.text, /benign=1/, 'تغيّر السلوكُ الحميد: ' + after.text + '\n' + repaired);
  assert.match(after.text, /evil=0/, 'الحقنُ ما زال يعمل: ' + after.text + '\n' + repaired);
});

test('[PB-6] وصيغةُ mysqli تُربَط بـbind_param وتُعيد get_result', () => {
  const { repaired } = cycle(MYSQLI_ASSIGN, 'a.php');
  assert.match(repaired, /\$stmt->bind_param\("s", \$name\);/, repaired);
  assert.match(repaired, /\$stmt->execute\(\);/, repaired);
  assert.match(repaired, /return \$stmt->get_result\(\);/, repaired);
  if (phpBin) assert.ok(phpRun(repaired, 'mysqli').lint, 'الناتجُ لا يجتاز php -l:\n' + repaired);
});

test('[PB-7] ولا نسخةَ باقيةً تكتب $conn على مسارٍ مُطبَّق', () => {
  // النسخةُ نفسُها كانت في أربعةِ ملفّات. والحارسُ يمنع عودتَها في أيِّها.
  const APPLIED = ['repair_engine.js', 'smart_repair.js', 'emergency_fixes.js',
                   'sql_injection_fix.js', 'taint_php.js'];
  for (const f of APPLIED) {
    const p = path.join(PUBLIC_DIR, f);
    if (!fs.existsSync(p)) continue;
    const code = fs.readFileSync(p, 'utf8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(code, /\$conn\s*->\s*prepare/, f + ': عادت رقعةُ $conn المُخترَعة');
  }
  // ومن المحرّكِ الآخرِ على مسارِ الصفحة، قياسًا لا قراءةَ مصدر
  if (ctx.SmartRepairEngine && typeof ctx.SmartRepairEngine.repair === 'function') {
    const out = ctx.SmartRepairEngine.repair(PDO_ASSIGN, 'a.php', ctx.analyzeCode(PDO_ASSIGN, 'a.php'));
    const s = (out && (out.fixed || out.code)) || '';
    assert.doesNotMatch(String(s), /\$conn\b/, 'SmartRepairEngine ما زال يكتب $conn:\n' + s);
  }
});

test('[PB-8] ولغاتُ SQL الأخرى لم تتراجع', () => {
  const JS = 'function f(db, name) {\n  return db.query("SELECT * FROM u WHERE n = \'" + name + "\'");\n}\nmodule.exports = { f };\n';
  assert.match(cycle(JS, 'a.js').repaired, /\?", \[name\]/, 'تراجع إصلاحُ js');
  const Q = '"';
  const CS = 'class A {\n  void f(SqlConnection conn, string name) {\n    var cmd = new SqlCommand(' +
    Q + "SELECT * FROM u WHERE n = '" + Q + ' + name + ' + Q + "'" + Q + ', conn);\n  }\n}\n';
  assert.match(cycle(CS, 'a.cs').repaired, /@p0/, 'تراجع إصلاحُ cs');
  const PY = 'def f(cur, name):\n    cur.execute("SELECT * FROM u WHERE n = \'" + name + "\'")\n';
  assert.strictEqual(cycle(PY, 'a.py').repaired, PY, 'مُسَّت بايثون');
});
