// ═══════════════════════════════════════════════════════
// تدقيق فحصَي بايثون في البوابة: سلامة فحص الوصول، وقصور الفاحص البنيوي
// تشغيل:  node --test vercel-api/test/verifier_py_checks_audit.test.js
//
// تدقيق واختبارات فقط. لا يرافقه تعديل إنتاجي.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const FV_SRC = fs.readFileSync(path.join(PUBLIC_DIR, 'fix_verifier.js'), 'utf8');

function loadCtx() {
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop, createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, navigator: {}, location: { search: '' },
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

// نعزل دالتي فحص الوصول من المصدر لقياسهما مباشرة، بلا تعديل الملف.
function loadReachability() {
  const grab = re => { const m = FV_SRC.match(re); assert.ok(m, 'غير موجود: ' + re); return m[0]; };
  const sand = {};
  vm.createContext(sand);
  // كتلة واحدة متّصلة: من PY_TERMINATOR إلى آخر pyUnreachableAdded. القطع
  // المنفصلة تنكسر كلّما استدعت دالةٌ أخرى داخل الكتلة.
  vm.runInContext(
    grab(/const PY_TERMINATOR[\s\S]*?function pyUnreachableAdded[\s\S]*?\n    return added;\n  }\n/) +
    '\n;DEAD = pyUnreachableStatements; ADDED = pyUnreachableAdded;', sand);
  return { dead: sand.DEAD, added: sand.ADDED };
}

// ═══ 1. سلامة المقارنة الفارقية ════════════════════════
// المقارنة تبني multiset من نصوص الأسطر الميتة. والنص وحده لا يحدّد الموضع،
// ولا يميّز نصوصًا حرفية مختلفة (لأن المحتوى يُعمَّى إلى مسافات). فثلاث
// حالات ضرر جديد تُبتلع.

const { dead: deadStatements, added: unreachableAdded } = loadReachability();

const SOUNDNESS_HOLES = {
  'نقل الضرر بين دالتين بنفس النص': [
    'def a():\n    return 1\n    cleanup()\n\ndef b():\n    cleanup()\n    return 2\n',
    'def a():\n    cleanup()\n    return 1\n\ndef b():\n    return 2\n    cleanup()\n'],
  // الفيكستشر السابق كان log("abc") ← log("xyz") داخل دالة واحدة، وتتبّع
  // التنفيذ (sys.settrace) أثبت أنه **سليم**: f() تُنفّذ return 1 وحدها قبل
  // وبعد، ولا نداء يحدث في أي من الطرفين. فكان الاختبار يؤكّد ضررًا غير
  // موجود. الآلية التي أراد توثيقها حقيقية — تصادم التعمية يجعل log("abc")
  // وlog("xyz") نصًّا واحدًا `log(   )` — لكن إثباتها يحتاج مثالًا ضارًّا:
  // هنا log("xyz") كانت **تُنفَّذ فعلًا** في b() وصارت لا تُنفَّذ، والفاحص
  // المُعمَّى يسكت لأن النصّ كان في رصيد الميت القادم من a().
  'تصادم نصوص حرفية بعد التعمية': [
    'def a():\n    return 1\n    log("abc")\n\ndef b():\n    log("xyz")\n    return 2\n',
    'def a():\n    return 1\n\ndef b():\n    return 2\n    log("xyz")\n'],
  'نقل الضرر بنفس الإزاحة والنص': [
    'def a():\n    return 1\n    x = 2\n\ndef b():\n    x = 2\n    return 3\n',
    'def a():\n    x = 2\n    return 1\n\ndef b():\n    return 3\n    x = 2\n'],
};

// الثلاث الآن تأكيدات إلزامية لا todo: كلٌّ منها يُسكت عبارةً أثبت تتبّع
// التنفيذ أنها كانت تُنفَّذ، والقواعد (أ) و(ب) و(و) تراها. وهي تفشل على
// السلوك السابق (المفتاح نص السطر المُعمَّى على الملف كله) — وذلك مقصود:
// الاختبار يصف السلوك المعتمَد لا السابق.
for (const [label, [before, after]] of Object.entries(SOUNDNESS_HOLES)) {
  test(`سلامة: ضرر جديد يجب ألا يُبتلع — ${label}`, () => {
    assert.ok(deadStatements(after).length >= 1, 'شرط: الناتج فيه كود ميت');
    assert.ok(unreachableAdded(before, after).length >= 1,
      `${label}: المقارنة لم ترَ ضررًا جديدًا`);
  });
}

// وهذه تمر اليوم ويجب أن تبقى كذلك بعد أي تحسين للمقارنة.
const SOUNDNESS_OK = {
  'إزالة ضرر سابق ⇒ لا رفض': ['def f():\n    return 1\n    x = 2\n', 'def f():\n    return 1\n', 0],
  'ضرر سابق باقٍ كما هو ⇒ لا رفض': ['def f():\n    return 1\n    x = 2\n', 'def f():\n    return 2\n    x = 2\n', 0],
  'إصلاح سليم ⇒ لا رفض': ['def f(u):\n    q = "a" + u\n    return q\n', 'def f(u):\n    q = "a"\n    return q\n', 0],
  'ضرر واحد صار اثنين ⇒ رفض': ['def f():\n    return 1\n    x = 2\n', 'def f():\n    return 1\n    x = 2\n    x = 2\n', 1],
};
for (const [label, [before, after, expectAdded]] of Object.entries(SOUNDNESS_OK)) {
  test(`سلامة: الحالات الصحيحة محفوظة — ${label}`, () => {
    const n = unreachableAdded(before, after).length;
    if (expectAdded === 0) assert.strictEqual(n, 0, `${label}: رفض خاطئ`);
    else assert.ok(n >= 1, `${label}: كان يجب الرفض`);
  });
}

// ═══ 2. قصور pythonStructuralSyntaxCheck ═══════════════
// سببان دقيقان:
//   (أ) "unterminated Python string": scanLine تعمل على سطر واحد وتُرجع
//       triple، ثم يُرفض السطر فورًا. حالة الاقتباس الثلاثي لا تُحمَل إلى
//       السطر التالي، فكل نص متعدد الأسطر يُرفض عند سطر افتتاحه.
//   (ب) "unexpected indentation": سطر الاستمرار (بعد backslash أو داخل
//       أقواس مفتوحة) يُعامَل كعبارة جديدة. والـstack يعرف أننا داخل أقواس،
//       لكنه لا يُستشار عند فحص الإزاحة.

const PY_VALID_REJECTED = {
  'docstring متعدد الأسطر':       ['def f():\n    """\n    doc\n    """\n    return 1\n', /unterminated Python string/],
  'نص متعدد الأسطر بإسناد':       ['def f():\n    s = """\nline\n"""\n    return s\n', /unterminated Python string/],
  'اقتباس ثلاثي فيه اقتباسات':    ['def f():\n    s = """he said "hi"\n    ok"""\n    return s\n', /unterminated Python string/],
  'docstring بعلامة مفردة':       ["def f():\n    '''doc\n    more'''\n    return 1\n", /unterminated Python string/],
  'استمرار بـbackslash':          ['def f(a, b):\n    t = a + \\\n        b\n    return t\n', /unexpected indentation/],
  'استمرار بأقواس':               ['def f():\n    d = {\n        "a": 1,\n    }\n    return d\n', /unexpected indentation/],
  'استمرار بأقواس داخل استدعاء':  ['def f():\n    g(\n        1,\n        2,\n    )\n', /unexpected indentation/],
};

for (const [label, [code]] of Object.entries(PY_VALID_REJECTED)) {
  test(`الفاحص يقبل كوداً صحيحاً — ${label}`, () => {
    const ctx = loadCtx();
    const r = ctx.FixVerifier.syntaxCheck(code, 'a.py');
    assert.ok(r.ok, `${label}: رُفض بـ"${r.reason}"`);
  });
}

// ═══ 2ب. كوربوس الاستمرار ══════════════════════════════
// التوقعات هنا **مأخوذة من CPython 3.13 عبر ast.parse**، لا مُستنتجة.
// القاعدة المُثبتة: داخل الاستمرار — أقواس مفتوحة، أو سطر منتهٍ بـbackslash،
// أو نص ثلاثي مفتوح — الإزاحة بلا معنى نحوي. لكن السطر الذي يلي **انتهاء**
// الاستمرار يُفحَص كالمعتاد. فوحدة الفحص هي السطر المنطقي لا الفيزيائي:
//   • يبدأ السطر المنطقي عند سطر فيزيائي ليس استمراراً.
//   • إزاحته = إزاحة سطره الأول.
//   • نصه = تجميع نصوص أسطره، فترويسة ممتدة مثل  if foo(\n 1\n):  تنتهي
//     بـ colon فتُعدّ ترويسة كتلة، ومفتاح dict مثل  "a":  وسطه فلا يُعدّ.
// ولهذا لا يكفي تخطّي الإزاحة عند depth > 0: لا بد من ضبط وحدة الفحص.

const PY_CONTINUATION_VALID = {
  'إزاحة عشوائية داخل dict':        'def f():\n    d = {\n"a": 1,\n            "b": 2,\n    }\n    return d\n',
  'إزاحة للخلف داخل call':          'def f():\n    g(\n1,\n  2,\n)\n    return 1\n',
  'سطر فارغ داخل القوسين':          'def f():\n    d = [\n\n        1,\n    ]\n    return d\n',
  'تعليق داخل القوسين':             'def f():\n    d = [\n        # c\n        1,\n    ]\n    return d\n',
  'إزاحة عشوائية بعد backslash':    'def f(a, b):\n    t = a + \\\nb\n    return t\n',
  'إزاحة أعمق بعد backslash':       'def f(a, b):\n    t = a + \\\n            b\n    return t\n',
  'مفتاح dict ينتهي بـcolon':       'def f():\n    d = {\n        "a":\n            1,\n    }\n    return d\n',
  'ترويسة كتلة ممتدة ):':           'def f():\n    if foo(\n        1\n    ):\n        return 1\n',
  'lambda داخل أقواس تنتهي بـcolon':'def f(x):\n    g = sorted(x, key=lambda v:\n        v.k)\n    return g\n',
  'أقواس متداخلة':                  'def f():\n    d = {\n        "a": [\n1,\n        ],\n    }\n    return d\n',
  'backslash ثم استمرار أقواس':     'def f(a):\n    t = a + \\\n        g(\n1,\n        )\n    return t\n',
  'نص ثلاثي على سطر واحد':          'def f():\n    s = """x"""\n    return s\n',
};

for (const [label, code] of Object.entries(PY_CONTINUATION_VALID)) {
  test(`استمرار صحيح (CPython: VALID) — ${label}`, () => {
    const ctx = loadCtx();
    const r = ctx.FixVerifier.syntaxCheck(code, 'a.py');
    assert.ok(r.ok, `${label}: رُفض بـ"${r.reason}" مع أن CPython يقبله`);
  });
}

// وهذه الإزاحات خاطئة فعلاً بعد **انتهاء** الاستمرار — يجب أن تبقى مكشوفة،
// وهي جوهر الخطر: تخطّي الإزاحة بلا ضبط الوحدة يُفقد كشفها.
const PY_CONTINUATION_INVALID = {
  'أقواس أُغلقت ثم إزاحة خاطئة':   'def f():\n    d = {\n        "a": 1,\n    }\n        x = 2\n',
  'backslash ثم إزاحة خاطئة بعده': 'def f(a, b):\n    t = a + \\\n        b\n        x = 2\n',
  'ترويسة ممتدة ثم جسم غير مُزاح': 'def f():\n    if foo(\n        1\n    ):\n    return 1\n',
  'نص ثلاثي انتهى ثم إزاحة خاطئة': 'def f():\n    s = """\nx\n"""\n        y = 1\n',
};

for (const [label, code] of Object.entries(PY_CONTINUATION_INVALID)) {
  test(`استمرار بإزاحة خاطئة بعده (CPython: SyntaxError) — ${label}`, () => {
    const ctx = loadCtx();
    const r = ctx.FixVerifier.syntaxCheck(code, 'a.py');
    assert.strictEqual(r.ok, false, `${label}: فُوّت — CPython يرفضه`);
    assert.strictEqual(r.available, true, 'والفاحص متاح');
  });
}

// الفجوات المتبقية في الفاحص مثبَّتة بالكامل، مع حكم CPython، في
// verifier_py_syntax_vs_cpython.test.js — لا تُكرَّر هنا. وهي أربع لا واحدة،
// وجامعها أن حالة الاقتباس **المفرد** لا تُحمَل بين الأسطر: ثلاث f-string
// ممتدة (3.12+)، ونص عادي مستمر بـbackslash داخل النص.

// ═══ 3. التعارض بين الفحصين ════════════════════════════
// الفاحص البنيوي يسبق فحص الوصول في ترتيب verifyFix. فأي ملف يُعطبه لا
// يصل فحص الوصول إطلاقًا، والنتيجة رفض كل شيء: السليم والمدمّر معًا.

// كان هذا الاختبار يوثّق تعارضًا: الفاحص البنيوي يسبق فحص الوصول، فأي ملف
// يُعطبه يُرفض قبل أن يصل فحص الوصول — والنتيجة رفض كل شيء، السليم والمدمّر.
// وبإصلاح الفاحص انحلّ التعارض: الملف نفسه صار يُفحَص فعليًا، فيُرفض
// المدمّر بفحص الوصول ويُقبل السليم. وهذا عقد الجولة: قبول الصحيح ورفض
// المدمّر على الملف الواحد.
test('انحلال التعارض: ملف فيه docstring متعدد الأسطر يصل فحص الوصول', () => {
  const ctx = loadCtx();
  const before = 'def get_user(uid):\n    """\n    Fetch.\n    """\n' +
                 '    q = "SELECT * FROM users WHERE id = " + uid\n    return other_api(q)\n';

  assert.ok(ctx.FixVerifier.syntaxCheck(before, 'a.py').ok,
    'الأصل سليم الصياغة — فلم يعد يُرفض لمجرد احتوائه docstring');

  const destructive = before.replace(
    '    q = "SELECT * FROM users WHERE id = " + uid\n    return other_api(q)',
    '    q = "SELECT * FROM users WHERE id =?"\n    cursor = conn.cursor()\n' +
    '    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    return other_api(q)');
  assert.ok(deadStatements(destructive).length >= 1, 'شرط: الـpatch مدمّر فعلًا');
  const bad = ctx.FixVerifier.verifyFix(before, destructive, 'a.py', ctx.analyzeCode);
  assert.ok(!bad.accepted, 'المدمّر يُرفض');
  assert.match(String(bad.reason), /^REJECTED_PY_UNREACHABLE_CODE/,
    'وبفحص الوصول تحديدًا — فهو يُستشار الآن على هذه الملفات');

  const good = before.replace(
    'q = "SELECT * FROM users WHERE id = " + uid\n    return other_api(q)',
    'q = "SELECT * FROM users WHERE id = ?"\n    cursor.execute(q, (uid,))\n    return cursor.fetchall()');
  const ok = ctx.FixVerifier.verifyFix(before, good, 'a.py', ctx.analyzeCode);
  assert.ok(ok.accepted, `والسليم يُقبل على الملف نفسه — ${ok.reason}`);
});

test('تعارض: نفس الملف بـdocstring سطر واحد يصل فحص الوصول', () => {
  const ctx = loadCtx();
  const before = 'def get_user(uid):\n    """Fetch."""\n' +
                 '    q = "SELECT * FROM users WHERE id = " + uid\n    return other_api(q)\n';
  const destructive = before.replace(
    '    q = "SELECT * FROM users WHERE id = " + uid\n    return other_api(q)',
    '    q = "SELECT * FROM users WHERE id =?"\n    cursor = conn.cursor()\n' +
    '    cursor.execute(q, (uid,))\n    return cursor.fetchall()\n    return other_api(q)');
  const v = ctx.FixVerifier.verifyFix(before, destructive, 'a.py', ctx.analyzeCode);
  assert.ok(!v.accepted);
  assert.match(String(v.reason), /^REJECTED_PY_UNREACHABLE_CODE/,
    'هنا يعمل فحص الوصول — فالفرق هو شكل الـdocstring لا طبيعة الضرر');
});

// ═══ 4. حدود التأثير على اللغات الأخرى ═════════════════
// قيم مقيسة، لا مخمَّنة. أي تغيّر فيها يعني أن الفحص تعدّى بايثون.

const OTHER_LANGUAGES = {
  'JS سليم':          ['a.js', 'function f(){\n  const K = "sk_live_51H8xQ2abcdefghijKLMN";\n  return K;\n}\n',
                               'function f(){\n  const K = process.env.K;\n  return K;\n}\n', true],
  'JS فيه كود ميت':   ['a.js', 'function f(){\n  const K = "sk_live_51H8xQ2abcdefghijKLMN";\n  return K;\n}\n',
                               'function f(){\n  const K = process.env.K;\n  return K;\n  log(K);\n}\n', true],
  'TS':               ['a.ts', 'function f(): string {\n  const K: string = "sk_live_51H8xQ2abcdefghijKLMN";\n  return K;\n}\n',
                               'function f(): string {\n  const K: string = process.env.K;\n  return K;\n}\n', false],
  // [PHP-GATE] كان false لأن البوابة لم تملك فاحص صياغة لـPHP، فتُرفض كل
  // إصلاحاتها بـREJECTED_NO_SYNTAX_CHECKER. وبعد نقل الفاحص البنيوي المحافظ
  // إلى fix_verifier.js صار هذا الإصلاح — وهو صحيح: نصّ سرّي ⇒ getenv —
  // يُقبل بـsyntaxStatus=verified بعد إزالة 3 بلاغات. تغيّر مقصود لا تخفيف:
  // وJava وGo وRuby في هذا الجدول نفسه ما زالت false (لا فاحص لها).
  'PHP':              ['a.php', '<?php\n$k = "sk_live_51H8xQ2abcdefghijKLMN";\necho $k;\n', '<?php\n$k = getenv("K");\necho $k;\n', true],
  'Java':             ['a.java', 'class A { String k = "sk_live_51H8xQ2abcdefghijKLMN"; }\n', 'class A { String k = System.getenv("K"); }\n', false],
  'Go':               ['a.go', 'package m\nvar k = "sk_live_51H8xQ2abcdefghijKLMN"\n', 'package m\nvar k = os.Getenv("K")\n', false],
  'Ruby':             ['a.rb', 'k = "sk_live_51H8xQ2abcdefghijKLMN"\nputs k\n', 'k = ENV["K"]\nputs k\n', false],
};

for (const [label, [file, before, after, expectAccepted]] of Object.entries(OTHER_LANGUAGES)) {
  test(`حدود: لغة غير بايثون لم تتأثر — ${label}`, () => {
    const ctx = loadCtx();
    const v = ctx.FixVerifier.verifyFix(before, after, file, ctx.analyzeCode);
    assert.strictEqual(v.accepted, expectAccepted, `${label}: ${v.reason}`);
    assert.doesNotMatch(String(v.reason), /PY_UNREACHABLE/,
      `${label}: فحص الوصول تعدّى بايثون`);
  });
}

// Array.from ضرورية: المصفوفة عائدة من sandboxآخر، وprototype مختلف يُفشل
// deepStrictEqual حتى لو تطابق المحتوى.
test('حدود: فحص الوصول خامل على JS — لا يُعتمد عليه هناك', () => {
  assert.deepStrictEqual(
    Array.from(deadStatements('function f() {\n  return 1;\n  const x = 2;\n}\n')), [],
    'JS فيه كود ميت: الكاشف لا يراه. السبب بنيوي: `{` يرفع عمق الأقواس فلا ' +
    'يعود إلى صفر، فكل الأسطر تُعدّ استمرارًا. كشف JS أداته acorn — بند منفصل.');
  assert.deepStrictEqual(
    Array.from(deadStatements('function f(x) {\n  if (x) {\n    return 1;\n  }\n  return 2;\n}\n')), [],
    'JS سليم: ولا إيجابية كاذبة كذلك');
});
