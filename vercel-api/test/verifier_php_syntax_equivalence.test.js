// ═══════════════════════════════════════════════════════
// [PHP-GATE] تكافؤ سلوكي للفاحص البنيوي — لا تطابق نصّي فقط
// ═══════════════════════════════════════════════════════
//
// اختبار «لا انحراف» في verifier_php_syntax_gate.test.js يقارن **نصّ**
// الدالتين. وهذا لا يكفي دليلًا على تكافؤ، لسببين:
//   1) تطابق النص يُثبت أن الجسمين يتصرّفان بالمثل للمدخل الواحد — بشرط أن
//      تكون الدالة مغلقة. فيلزم إثبات الإغلاق، وإثبات التصرّف لا افتراضه.
//   2) ولا يُثبت شيئًا عن تكافؤ **المسارين**: المسارَان يطبّقان سياستين
//      مختلفتين حول نفس الدالة، والقسم 3 أدناه يوثّق الفرق بالقياس.
//
// ولذلك هنا ثلاث طبقات:
//   القسم 1 — فروقي: النسختان على حقيبة مشتركة، حكمًا بحكم.
//   القسم 2 — عقد الفاحص نفسه: سليم/مكسور/غير محسوم.
//   القسم 3 — توثيق **اختلاف** سياسة الخادم عن الواجهة. لا يُدّعى تكافؤ.
//
// ملاحظة على الاستخراج: الدالة غير مُصدَّرة في أي من الملفين، فتُستخرج
// بـacorn (حدود العقدة بدقّة، لا regex ولا عدّ أقواس — فالدالة تحتوي "{" و"}"
// كنصوص حرفية فيكسر العدّ). ومع الاستخراج فحصٌ ذاتي: لو فشل أو تغيّر شكل
// الملف، تسقط الاختبارات بوضوح بدل أن تمرّ على فراغ. والحلّ الأنظف طويل
// الأمد تصدير الدالة من fix_verifier.js واستهلاكها في مسار الخادم — مصدر
// واحد يُلغي صنف الانحراف كلّه، وهو تغيير إنتاجي خارج نطاق هذه الجولة.
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

// حدود الدالة بـacorn من نفس السياق المحمَّل
function extractStructuralSyntax(file) {
  const src = fs.readFileSync(file, 'utf8');
  ctx.__src = src;
  const r = vm.runInContext(`(function(){
    const ast = acorn.parse(__src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
    let f = null;
    (function w(n){ if (!n || typeof n !== 'object' || f) return;
      if (n.type === 'FunctionDeclaration' && n.id && n.id.name === 'structuralSyntax') { f = n; return; }
      for (const k of Object.keys(n)) { const v = n[k];
        if (Array.isArray(v)) v.forEach(w); else if (v && typeof v === 'object' && v.type) w(v); } })(ast);
    return f ? JSON.stringify({ start: f.start, end: f.end }) : null;
  })()`, ctx);
  assert.ok(r, 'لم تُعثر على structuralSyntax في ' + path.basename(file));
  const { start, end } = JSON.parse(r);
  return src.slice(start, end);
}

// كل نسخة في sandbox فارغ: نجاح التشغيل هو إثبات الإغلاق (لا مُعرَّفات حرّة)
function isolate(text, label) {
  const sand = {};
  vm.createContext(sand);
  vm.runInContext(text + '\n;S = structuralSyntax;', sand);
  const call = (code, lang) => vm.runInContext('S(' + JSON.stringify(code) + ', ' + JSON.stringify(lang) + ')', sand);
  assert.strictEqual(call('<?php\n$a = 1;\n', 'php'), 'ok',
    'فحص ذاتي للاستخراج فشل في ' + label + ' — الاستخراج أو الدالة تغيّرا');
  return call;
}

const TEXT_FV  = extractStructuralSyntax(FV_PATH);
const TEXT_SRV = extractStructuralSyntax(SRV_PATH);

// حقيبة مشتركة: php وts، وثلاثة أصناف أحكام
const CORPUS = [
  ['php سليم',           '<?php\n$a = 1;\necho $a;\n', 'php'],
  ['php مكسور قوسًا',    '<?php\nf($x;\n', 'php'],
  ['php heredoc',        '<?php\n$h = <<<EOT\nx\nEOT;\n', 'php'],
  ['php وسم ?>',         '<?php echo 1; ?>\n<p>x</p>\n', 'php'],
  ['php تعليق #',        '<?php\n# c\n$a = 1;\n', 'php'],
  ['php نص مفرد مهروب',  "<?php\n$s = 'it\\'s';\n", 'php'],
  ['php نص غير منتهٍ',   '<?php\n$s = "abc;\necho 1;\n', 'php'],
  ['ts سليم',            'const x: number = 1;\nfunction f(a: string) { return a; }\n', 'typescript'],
  ['ts قالب نصّي',       'const s = `a${x}b`;\nconst t = `c`;\n', 'typescript'],
  ['ts تعبير نمطي',      'const r = /^[a-z]+$/i;\nif (r.test(s)) { f(); }\n', 'typescript'],
  ['ts مكسور',           'function f(a: string { return a; }\n', 'typescript'],
  ['ts نص غير منتهٍ',    'const s = "abc;\n', 'typescript'],
  ['ts قالب متداخل',     'const s = `a${ `b${c}` }d`;\n', 'typescript'],
  ['ts قسمة لا نمط',     'const r = a / b / c;\n', 'typescript'],
];

// ═══ 1. فروقي: النسختان حكمًا بحكم ═════════════════════

test('إغلاق: كل نسخة تعمل في sandbox فارغ (لا مُعرَّفات حرّة)', () => {
  isolate(TEXT_FV, 'fix_verifier.js');
  isolate(TEXT_SRV, 'server_engine_registration.js');
});

test('tripwire: الحقيبة تُغطّي الأحكام الثلاثة فعلًا', () => {
  const call = isolate(TEXT_FV, 'fix_verifier.js');
  const counts = {};
  for (const [, code, lang] of CORPUS) {
    const k = call(code, lang).split(':')[0];
    counts[k] = (counts[k] || 0) + 1;
  }
  for (const k of ['ok', 'broken', 'unknown']) {
    assert.ok((counts[k] || 0) >= 2, `الحكم ${k} يظهر ${counts[k] || 0} مرة — أقل من اثنتين ⇒ التغطية ضعيفة`);
  }
});

test('فروقي: النسختان تُعطيان الحكم نفسه حرفًا بحرف على كل الحقيبة', () => {
  const a = isolate(TEXT_FV, 'fix_verifier.js');
  const b = isolate(TEXT_SRV, 'server_engine_registration.js');
  const diffs = [];
  for (const [label, code, lang] of CORPUS) {
    const va = a(code, lang), vb = b(code, lang);
    if (va !== vb) diffs.push(`${label}: fix_verifier="${va}" ≠ server="${vb}"`);
  }
  assert.deepStrictEqual(diffs, [],
    'انحراف سلوكي بين النسختين — وحّدهما أو أزل إحداهما');
});

test('فروقي: تطابق النص لا يُعتمد وحده — ومع ذلك يُراقَب', () => {
  const norm = t => t.split('\n').map(l => l.trim()).join('\n');
  assert.strictEqual(norm(TEXT_FV), norm(TEXT_SRV),
    'النصّان تباعدا؛ الاختبار الفروقي أعلاه هو الحكم، وهذا تحذير مبكر');
});

// ═══ 2. عقد الفاحص: سليم · مكسور · غير محسوم ═══════════

const PHP_VALID = {
  'أساسي':            '<?php\n$a = 1;\necho $a;\n',
  'صنف ودالة':        '<?php\nclass A { public function f($x) { return $x + 1; } }\n$o = new A();\necho $o->f(2);\n',
  'foreach ومصفوفة':  '<?php\n$xs = [1, 2, 3];\nforeach ($xs as $k => $v) { echo $k . $v; }\n',
  'switch':           '<?php\nswitch ($x) { case 1: echo "a"; break; default: echo "b"; }\n',
  'try/catch/finally':'<?php\ntry { risky(); } catch (Exception $e) { echo $e->getMessage(); } finally { done(); }\n',
  'closure':          '<?php\n$f = function ($x) use ($y) { return $x * $y; };\necho $f(2);\n',
  'دالة سهمية':       '<?php\n$f = fn($x) => $x + 1;\necho $f(1);\n',
  'تعليقات # و//':    '<?php\n# c\n// d\n$a = 1; /* e */\necho $a;\n',
  'قسمة ونسبة':       '<?php\n$r = 10 / 2;\n$p = 10 % 3;\necho $r + $p;\n',
  'نمط داخل preg':    "<?php\nif (preg_match('/^[a-z]+$/', $s)) { echo 1; }\n",
  'مصفوفات متداخلة':  '<?php\n$c = ["a" => ["b" => [1, 2]], "c" => 3];\necho $c["a"]["b"][0];\n',
  'PDO مُحضَّر':       '<?php\n$stmt = $pdo->prepare("SELECT * FROM t WHERE id=?");\n$stmt->execute([$id]);\n',
  'mysqli مُحضَّر':    '<?php\n$s = $conn->prepare("SELECT * FROM t WHERE id=?");\n$s->bind_param("s", $id);\n$s->execute();\n',
};
const PHP_BROKEN = {
  'قوس ناقص':        '<?php\nf($x;\n',
  'قوس زائد':        '<?php\nf($x));\n',
  'نص غير منتهٍ':    '<?php\n$s = "abc;\necho 1;\n',
  'تعليق غير منتهٍ': '<?php\n/* abc\necho 1;\n',
  'معقوف ناقص':      '<?php\nif ($x) { echo 1;\n',
};
const PHP_UNDECIDABLE = {
  'heredoc':   '<?php\n$h = <<<EOT\nx\nEOT;\n',
  'nowdoc':    "<?php\n$h = <<<'EOT'\nx\nEOT;\n",
  'وسم ?>':    '<?php echo 1; ?>\n<p>x</p>\n',
};

test('عقد: PHP سليم ⇒ ok بلا إيجابي كاذب واحد', () => {
  const call = isolate(TEXT_FV, 'fix_verifier.js');
  const bad = [];
  for (const [label, code] of Object.entries(PHP_VALID)) {
    const v = call(code, 'php');
    if (v !== 'ok') bad.push(`${label} ⇒ ${v}`);
  }
  assert.deepStrictEqual(bad, [],
    'PHP سليم حُكم عليه بغير ok — إيجابيات كاذبة تُفقد إصلاحات صحيحة');
});

test('عقد: PHP مكسور ⇒ broken (حكمٌ لا امتناع)', () => {
  const call = isolate(TEXT_FV, 'fix_verifier.js');
  for (const [label, code] of Object.entries(PHP_BROKEN)) {
    const v = call(code, 'php');
    assert.match(v, /^broken:/, `${label}: الحكم ${v} — الكسر لم يُكشف`);
  }
});

test('عقد: بنية لا يفهمها بثقة ⇒ unknown (امتناع لا تخمين)', () => {
  const call = isolate(TEXT_FV, 'fix_verifier.js');
  for (const [label, code] of Object.entries(PHP_UNDECIDABLE)) {
    assert.strictEqual(call(code, 'php'), 'unknown', `${label}: حَكَم على ما لا يفهمه`);
  }
});

// ═══ 3. سياسة الخادم ≠ سياسة الواجهة — توثيق لا ادّعاء ══
//
// نفس الفاحص، وسياستان:
//   • الواجهة (FixVerifier.verifyFix بلا تجاوز): **مطلقة** — تحكم على
//     الـcandidate وحده؛ unknown ⇒ رفض (REJECTED_NO_SYNTAX_CHECKER).
//   • الخادم (RealityOrchestrator.runVerification): fullVerify بـ
//     allowUnverifiedLanguages:true، ثم فحص **نسبي** يرفض فقط إن كان الأصل
//     ok والـcandidate broken؛ وunknown لا يرفض أبدًا.
// فالمسارَان غير متكافئين بالتصميم، والاختبارات أدناه تثبّت الفرق المقيس.
const SRV = require('../public/server_engine_registration.js');

const SEC_BAD  = '<?php\n$k = "sk_live_51H8xQ2abcdefghijKLMN";\necho $k;\n';
const SEC_FIX  = '<?php\n$k = getenv("K");\necho $k;\n';
const SEC_BRK  = '<?php\n$k = getenv("K";\necho $k;\n';
const SEC_UNK  = '<?php\n$k = getenv("K");\necho $k;\n?>\n<p>x</p>\n';
const ORIG_UNK = '<?php\n$k = "sk_live_51H8xQ2abcdefghijKLMN";\necho $k;\n?>\n<p>x</p>\n';

const browserGate = (b, a) => JSON.parse(vm.runInContext(
  'JSON.stringify((function(){var v=FixVerifier.verifyFix(' + JSON.stringify(b) + ', ' + JSON.stringify(a) +
  ', "a.php", analyzeCode, {}); return { ok: v.accepted, reason: String(v.reason || "") };})())', ctx));
const serverGate = (b, a) => {
  const r = SRV.RealityOrchestrator.runVerification(b, a, 'a.php');
  return { ok: r && r.valid === true, reason: String((r && r.reason) || '') };
};

test('متّفقان: إصلاح صحيح (ok ⇒ ok) يُقبل في المسارين', () => {
  assert.strictEqual(browserGate(SEC_BAD, SEC_FIX).ok, true, 'الواجهة رفضت إصلاحًا صحيحًا');
  assert.strictEqual(serverGate(SEC_BAD, SEC_FIX).ok, true, 'الخادم رفض إصلاحًا صحيحًا');
});

test('متّفقان: مرشّح مكسور (ok ⇒ broken) يُرفض في المسارين بسبب الكسر', () => {
  for (const [name, g] of [['الواجهة', browserGate], ['الخادم', serverGate]]) {
    const r = g(SEC_BAD, SEC_BRK);
    assert.strictEqual(r.ok, false, name + ': قُبل مرشّح مكسور');
    assert.match(r.reason, /REJECTED_SYNTAX_BROKEN \[php\]/, name + ': سبب الرفض ' + r.reason);
  }
});

for (const [label, before, after] of [
  ['ok ⇒ unknown',      SEC_BAD,  SEC_UNK],
  ['unknown ⇒ unknown', ORIG_UNK, SEC_UNK],
]) {
  test(`موثَّق: المسارَان غير متكافئين عند ${label} — الخادم يقبل والواجهة ترفض`, () => {
    const b = browserGate(before, after);
    const s = serverGate(before, after);
    assert.strictEqual(b.ok, false, 'الواجهة: المتوقَّع رفض — ' + b.reason);
    assert.match(b.reason, /REJECTED_NO_SYNTAX_CHECKER \[php\]/, 'سبب الواجهة: ' + b.reason);
    assert.strictEqual(s.ok, true, 'الخادم: المتوقَّع قبول — ' + s.reason);
    assert.match(s.reason, /SYNTAX_UNVERIFIED \[php\]/,
      'الخادم يجب أن يُعلن أن النحو غير محقَّق: ' + s.reason);
    assert.notStrictEqual(b.ok, s.ok, 'اختفى الفرق — راجع هذا التوثيق قبل تعديله');
  });
}

test('[PHP-GATE] unknown ⇒ broken: الخادم صار يرفض — سلوك تغيّر مع هذه الخطوة', () => {
  // قبل نقل الفاحص: fullVerify لا يحكم على php (لا فاحص) ثم الفحص النسبي
  // يمتنع لأن الأصل غير محسوم ⇒ **الخادم كان يقبل**. وبعد النقل: verifyFix
  // يحكم على الـcandidate وحده فيرفضه للكسر. الاتجاه أصرم، ولم يكن مغطّى
  // بأي اختبار قائم (اختبار الخادم النسبي يغطّي unknown ⇒ unknown فقط).
  // مثبَّت هنا كي لا يتغيّر مرة أخرى بصمت، ويبقى قرار إبقائه أو إعادة
  // السياسة النسبية قرارًا معلنًا لا أثرًا جانبيًّا.
  const ORIG_BRK = '<?php\n$k = getenv("K";\necho $k;\n';
  const s = serverGate(ORIG_UNK, ORIG_BRK);
  assert.strictEqual(s.ok, false, 'الخادم قَبِل مرشّحًا مكسورًا: ' + s.reason);
  assert.match(s.reason, /REJECTED_SYNTAX_BROKEN \[php\]/, 'سبب الرفض: ' + s.reason);
  const b = browserGate(ORIG_UNK, ORIG_BRK);
  assert.strictEqual(b.ok, false, 'الواجهة قَبِلت مرشّحًا مكسورًا: ' + b.reason);
});

test('الخادم: سياسته النسبية على heredoc محفوظة كما كانت', () => {
  // نفس حالة test/server_syntax_guard.test.js: أصلٌ غير محسوم وcandidate غير
  // محسوم ⇒ يبقى مقبولًا مع إعلان أن النحو غير محقَّق. (أ) لم تمسّها.
  const before = '<?php\n$h = <<<EOT\nhello\nEOT;\n$u = "http://api.example.com";\n';
  const after  = '<?php\n$h = <<<EOT\nhello\nEOT;\n$u = "https://api.example.com";\n';
  const s = serverGate(before, after);
  assert.strictEqual(s.ok, true, 'سياسة الخادم النسبية تغيّرت: ' + s.reason);
  assert.match(s.reason, /SYNTAX_UNVERIFIED \[php\]/, 'الإعلان غائب: ' + s.reason);
});
