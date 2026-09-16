// ═══════════════════════════════════════════════════════
// اختبارات c_cpp_analyzer.js — الكشف والدليل، وسلامة أي إصلاح يبقى
// تشغيل:  node --test vercel-api/test/*.test.js   (من جذر المستودع)
// بلا تبعيات خارجية. يُحمَّل c_cpp_analyzer.js وحده.
//
// القاعدة المُختبَرة: كل إصلاح يبقى يجب أن يكون تحويلاً يُترجم ولا يغيّر
// الدلالة؛ وكل حالة غير مؤكدة يجب أن تخرج fix:null و aiRequired:true.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'c_cpp_analyzer.js'), 'utf8');

function engine() {
  const ctx = vm.createContext({ console: { warn() {}, log() {}, error() {} } });
  vm.runInContext(SRC, ctx, { filename: 'c_cpp_analyzer.js' });
  return ctx;
}
const A = (code, fn) => engine().analyzeCCpp(code, fn);

// النتائج تُنشأ داخل سياق vm (realm مختلف) — تُنسخ قبل أي مقارنة عميقة
const list   = r => Array.from(r.issues || []);
const find   = (r, re) => list(r).filter(i => re.test(String(i.title)));
const one    = (r, re) => { const f = find(r, re); assert.strictEqual(f.length, 1, 'عدد البلاغات لـ' + re + ' = ' + f.length + ' :: ' + list(r).map(i => i.title).join(' | ')); return f[0]; };
const none   = (r, re) => assert.strictEqual(find(r, re).length, 0, 'بلاغ غير متوقع لـ' + re + ' :: ' + list(r).map(i => i.line + ':' + i.title).join(' | '));

// فحص بنيوي للإصلاح المولَّد: أقواس متوازنة، اقتباسات زوجية، وليس نسخة من السطر
function assertFixShape(issue, label) {
  const fx = issue.fix;
  assert.strictEqual(typeof fx, 'string', label + ': لا يوجد إصلاح');
  assert.ok(fx.trim(), label + ': إصلاح فارغ');
  assert.ok(!/^\s*(?:\/\/|\/\*|#)/.test(fx), label + ': الإصلاح تعليق: ' + fx);
  assert.notStrictEqual(fx.trim(), String(issue.ev).trim(), label + ': الإصلاح نسخة من السطر المصاب');
  for (const [o, c] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    const no = (fx.split(o).length - 1), nc = (fx.split(c).length - 1);
    assert.strictEqual(no, nc, label + ': أقواس ' + o + c + ' غير متوازنة في: ' + fx);
  }
  assert.strictEqual((fx.split('"').length - 1) % 2, 0, label + ': اقتباسات مزدوجة فردية: ' + fx);
  assert.strictEqual(issue.aiRequired, false, label + ': وُسم AI_REQUIRED رغم وجود إصلاح');
}
// عدد وسائط أول استدعاء لدالة داخل نص (على العمق صفر)
function argCount(text, fn) {
  const idx = text.indexOf(fn + '(');
  assert.ok(idx >= 0, 'لم يُعثر على ' + fn + ' في: ' + text);
  let depth = 0, n = 1;
  for (let i = idx + fn.length + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === ')') { if (depth === 0) return n; depth--; }
    else if (c === ',' && depth === 0) n++;
  }
  return -1;
}
function assertAiRequired(issue, label) {
  assert.strictEqual(issue.fix, null, label + ': ما زال يُصدر إصلاحاً: ' + JSON.stringify(issue.fix));
  assert.strictEqual(issue.aiRequired, true, label + ': لم يُوسم AI_REQUIRED');
  assert.ok(typeof issue.fixHint === 'string' && issue.fixHint.length > 15, label + ': بلا سبب مكتوب');
}

// ═══ 1. المدخلات والعقد ═════════════════════════════════
test('العقد والمدخلات: شكل الإرجاع ثابت، والمدخلات الفاسدة لا تُسقط المحلل', () => {
  const cases = [
    ['اسم مفقود',     () => A('int x;\n')],
    ['اسم undefined', () => A('int x;\n', undefined)],
    ['اسم null',      () => A('int x;\n', null)],
    ['اسم رقم',       () => A('int x;\n', 123)],
    ['كود null',      () => A(null, 'a.c')],
    ['كود undefined', () => A(undefined, 'a.c')],
    ['كود كائن',      () => A({}, 'a.c')],
    ['كود فارغ',      () => A('', 'a.c')],
    ['فراغات',        () => A('  \n\n', 'a.c')],
  ];
  for (const [label, fn] of cases) {
    let r;
    assert.doesNotThrow(() => { r = fn(); }, label + ': انهار');
    assert.ok(r && Array.isArray(r.issues), label + ': issues ليست مصفوفة');
    assert.strictEqual(r.issues.length, 0, label + ': أنتج ثغرات من مدخل فاسد');
    assert.ok(r.language === 'C' || r.language === 'C++', label + ': language مفقود');
    assert.strictEqual(typeof r.summary.issues, 'number', label + ': summary مفقود');
  }
  // الحقول المطلوبة على كل ثغرة
  const r = A('char b[8];\ngets(b);\nsystem(cmd);\n', 'a.c');
  assert.ok(list(r).length >= 2);
  for (const i of list(r))
    for (const k of ['type', 'sev', 'line', 'ev', 'title', 'fix', 'aiRequired', 'conf', 'cIcon', 'cAct', 'cEv'])
      assert.ok(Object.prototype.hasOwnProperty.call(i, k), 'حقل ناقص: ' + k + ' في ' + i.title);
});

// ═══ 2. strcpy ═══════════════════════════════════════════
test('strcpy: إصلاح فقط عند إثبات مصفوفة الوجهة، مع إنهاء صريح؛ والمؤشر ⇒ AI_REQUIRED', () => {
  const ok = A('void f(const char *src) {\n    char dst[64];\n    strcpy(dst, src);\n}\n', 'a.c');
  const i1 = one(ok, /strcpy\(\)/);
  assertFixShape(i1, 'strcpy/مصفوفة');
  assert.ok(i1.fix.includes('sizeof(dst) - 1'), 'الحجم لم يُشتق من المصفوفة: ' + i1.fix);
  assert.ok(/dst\[sizeof\(dst\) - 1\] = '\\0';/.test(i1.fix), 'الإنهاء الصريح مفقود: ' + i1.fix);
  assert.strictEqual(argCount(i1.fix, 'strncpy'), 3, 'عدد وسائط strncpy خاطئ: ' + i1.fix);

  // مؤشر: sizeof عليه يعطي حجم المؤشر — ممنوع الإصلاح
  const ptr = A('void f(char *dst, const char *src) {\n    strcpy(dst, src);\n}\n', 'a.c');
  assertAiRequired(one(ptr, /strcpy\(\)/), 'strcpy/مؤشر');

  // وسيط مركّب فيه فاصلة: الإصلاح القديم كان يحقن الحجم داخل الدالة الأخرى
  const nested = A('char dst[32];\nstrcpy(dst, get_name(a, b));\n', 'a.c');
  const n1 = one(nested, /strcpy\(\)/);
  assertFixShape(n1, 'strcpy/وسيط مركّب');
  assert.ok(n1.fix.includes('get_name(a, b)'), 'تشوّه الوسيط المركّب: ' + n1.fix);
  assert.strictEqual(argCount(n1.fix, 'strncpy'), 3, 'الحجم دخل داخل الدالة المتداخلة: ' + n1.fix);
  assert.strictEqual(argCount(n1.fix, 'get_name'), 2, 'تغيّر عدد وسائط get_name: ' + n1.fix);
});

// ═══ 3. strcat ═══════════════════════════════════════════
test('strcat: نفس الشرط — مصفوفة مُثبتة ⇒ strncat بثلاثة وسائط، ومؤشر ⇒ AI_REQUIRED', () => {
  const ok = A('char dst[64];\nstrcat(dst, tail);\n', 'a.c');
  const i1 = one(ok, /strcat\(\)/);
  assertFixShape(i1, 'strcat/مصفوفة');
  assert.strictEqual(argCount(i1.fix, 'strncat'), 3, 'عدد وسائط strncat خاطئ: ' + i1.fix);
  assert.ok(i1.fix.includes('sizeof(dst) - strlen(dst) - 1'), i1.fix);
  assertAiRequired(one(A('void f(char *d, char *s) { strcat(d, s); }\n', 'a.c'), /strcat\(\)/), 'strcat/مؤشر');
});

// ═══ 4. sprintf ═════════════════════════════════════════
test('sprintf: لا يُستبدل الاسم وحده أبداً — snprintf بوسيط حجم أو AI_REQUIRED', () => {
  const ok = A('char buf[128];\nsprintf(buf, "%s=%d", name, val);\n', 'a.c');
  const i1 = one(ok, /sprintf\(\)/);
  assertFixShape(i1, 'sprintf/مصفوفة');
  assert.ok(i1.fix.includes('snprintf(buf, sizeof(buf),'), 'وسيط الحجم مفقود: ' + i1.fix);
  assert.strictEqual(argCount(i1.fix, 'snprintf'), 5, 'عدد وسائط snprintf خاطئ: ' + i1.fix);
  // الحالة التي كانت تنتج كوداً لا يُترجم
  const bad = A('void f(char *buf) {\n    sprintf(buf, "%s", name);\n}\n', 'a.c');
  const i2 = one(bad, /sprintf\(\)/);
  assertAiRequired(i2, 'sprintf/مؤشر');
  assert.ok(/يُترجم/.test(i2.fixHint), 'السبب لا يذكر مشكلة الترجمة: ' + i2.fixHint);
});

// ═══ 5. gets ════════════════════════════════════════════
test('gets: fgets فقط عند إثبات المصفوفة، مع تنبيه فرق سطر جديد', () => {
  const ok = A('char buf[64];\ngets(buf);\n', 'a.c');
  const i1 = one(ok, /gets\(\)/);
  assertFixShape(i1, 'gets/مصفوفة');
  assert.strictEqual(argCount(i1.fix, 'fgets'), 3, 'عدد وسائط fgets خاطئ: ' + i1.fix);
  assert.ok(/سطر|newline|\\n/i.test(String(i1.fixHint)), 'لا تنبيه لتغيّر الدلالة: ' + i1.fixHint);
  assertAiRequired(one(A('void f(char *p) { gets(p); }\n', 'a.c'), /gets\(\)/), 'gets/مؤشر');
});

// ═══ 6. scanf %s ════════════════════════════════════════
test('scanf %s: العرض من حجم المخزن الحقيقي، ومحوِّلان أو حجم مجهول ⇒ AI_REQUIRED', () => {
  const ok = A('char name[16];\nscanf("%s", name);\n', 'a.c');
  const i1 = one(ok, /scanf %s/);
  assertFixShape(i1, 'scanf/مخزن معروف');
  assert.ok(i1.fix.includes('"%15s"'), 'العرض لا يطابق حجم المخزن ناقص واحد: ' + i1.fix);
  // محوِّلان: لا يمكن ربط كل %s بمخزنه
  const two = A('char a[10], b[10];\nscanf("%s %s", a, b);\n', 'a.c');
  assertAiRequired(one(two, /scanf %s/), 'scanf/محوِّلان');
  // حجم مجهول
  assertAiRequired(one(A('void f(char *p) { scanf("%s", p); }\n', 'a.c'), /scanf %s/), 'scanf/حجم مجهول');
  // عرض محدد أصلاً ⇒ لا بلاغ
  none(A('char n[16];\nscanf("%15s", n);\n', 'a.c'), /scanf %s/);
});

// ═══ 7. printf format string ══════════════════════════════
test('printf(var): التحويل فقط عند إثبات أن المتغير نص، والعدد ⇒ AI_REQUIRED', () => {
  const ok = A('char msg[64];\nprintf(msg);\n', 'a.c');
  const i1 = one(ok, /Format String/);
  assertFixShape(i1, 'printf/مصفوفة');
  assert.ok(i1.fix.includes('printf("%s", msg)'), i1.fix);
  const ptrOk = A('void f(const char *msg) {\n    printf(msg);\n}\n', 'a.c');
  assertFixShape(one(ptrOk, /Format String/), 'printf/مؤشر نصي');
  // متغير عددي: الإصلاح القديم كان يحوّل تحذير ترجمة إلى انهيار وقت تشغيل
  const num = A('int count = 5;\nprintf(count);\n', 'a.c');
  assertAiRequired(one(num, /Format String/), 'printf/عدد');
  // نص حرفي ⇒ لا بلاغ
  none(A('printf("hello\\n");\n', 'a.c'), /Format String/);
});

// ═══ 8. malloc ══════════════════════════════════════════
test('malloc: الفحص بأي صيغة يمنع البلاغ، وبلا فحص يُبلَّغ بلا إصلاح مخترع', () => {
  for (const guard of ['if (!p) return -1;', 'if (p == NULL) return -1;', 'if (NULL == p) return -1;', 'assert(p);', 'free(p);']) {
    none(A('char *p = malloc(10);\n' + guard + '\n', 'a.c'), /malloc\(\)/);
  }
  // فحص بعيد عن نافذة الأسطر الأربعة القديمة
  none(A('char *p = malloc(10);\nint a;\nint b;\nint c;\nint d;\nint e;\nif (p == NULL) return -1;\n', 'a.c'), /malloc\(\)/);
  const bad = A('char *p = malloc(100);\nuse(p);\n', 'a.c');
  const i1 = one(bad, /malloc\(\)/);
  assertAiRequired(i1, 'malloc/بلا فحص');
  // الإصلاح القديم كان تعليقاً يحذف استدعاء malloc لو طُبّق
  assert.ok(!/free\(ptr\)/.test(String(i1.fix)), 'ما زال يُصدر تعليقاً كإصلاح');
});

// ═══ 9. double free ════════════════════════════════════
test('double free: تحريران متتاليان بلا تفرّع يُبلَّغان، والفرعان المتنافيان لا', () => {
  const real = A('char *p = malloc(10);\nfree(p);\nfree(p);\n', 'a.c');
  const i1 = one(real, /Double Free/);
  assertAiRequired(i1, 'double free');
  assert.ok(/التحرير الأول/.test(String(i1.fixHint)), 'السبب لا يشير إلى موضع الإصلاح الصحيح: ' + i1.fixHint);
  assert.ok(String(i1.fixHint).includes('2'), 'لم يُذكر سطر التحرير الأول: ' + i1.fixHint);
  // فرعان متنافيان: ليس double free
  none(A('if (a) { free(p); }\nelse { free(p); }\n', 'a.c'), /Double Free/);
  // إعادة ضبط المؤشر بين التحريرين
  none(A('free(p);\np = NULL;\nfree(p);\n', 'a.c'), /Double Free/);
  // مؤشران مختلفان
  none(A('free(p);\nfree(q);\n', 'a.c'), /Double Free/);
});

// ═══ 10. سلاسل وتعليقات ═════════════════════════════════
test('السلاسل والتعليقات ليست كوداً: لا بلاغ من نص أو تعليق سطري أو تعليق بلوك ممتد', () => {
  none(A('const char *msg = "never use strcpy() here";\n', 'a.c'), /strcpy/);
  none(A('int x = 1; // TODO: replace strcpy with strncpy\n', 'a.c'), /strcpy/);
  none(A('/* strcpy(a,b) is banned */\n', 'a.c'), /strcpy/);
  none(A('/*\n * gets(buf) must never be used\n * system("x") either\n */\nint ok = 1;\n', 'a.c'), /gets|system/);
  none(A('const char *help = "run system(cmd) at your own risk";\n', 'a.c'), /system/);
  // ضابط: نفس الاستدعاءات ككود حقيقي تُكتشف
  const ctrl = A('char b[8];\ngets(b);\nsystem(cmd);\n', 'a.c');
  assert.ok(find(ctrl, /gets/).length === 1 && find(ctrl, /system/).length === 1, 'الضابط فشل: ' + list(ctrl).map(i => i.title).join(' | '));
});

test('سطر يبدأ بنجمة هو كود لا تعليق', () => {
  // كان يُتخطّى لأن السطر يبدأ بـ * فيُظن تكملة تعليق
  assert.strictEqual(find(A('char b[8];\n*out = gets(b);\n', 'a.c'), /gets/).length, 1, 'سطر إسناد عبر مؤشر أُهمل');
});

// ═══ 11. تصريحات لا استدعاءات ═════════════════════════════
test('تصريح الدالة ليس استدعاءً لها', () => {
  none(A('void system(char *cmd);\n', 'a.c'), /system/);
  none(A('extern int gets(char *s);\n', 'a.c'), /gets/);
  // ضابط
  assert.strictEqual(find(A('int rc = system(cmd);\n', 'a.c'), /system/).length, 1, 'الضابط: استدعاء system لم يُكتشف');
});

// ═══ 12. جمل متعددة الأسطر ═══════════════════════════════
test('جملة ممتدة على أسطر: تُكتشف الثغرة ولا يُصدَر إصلاح صفري', () => {
  for (const [code, re] of [
    ['char d[8];\nstrcpy(dest,\n       source);\n', /strcpy/],
    ['char d[8];\nstrcat(d,\n  s);\n',              /strcat/],
    ['char b[8];\ngets(\n  b);\n',                  /gets/],
    ['char b[8];\nsprintf(b,\n  "%d", n);\n',       /sprintf/],
  ]) {
    const r = A(code, 'a.c');
    const i = one(r, re);
    assert.strictEqual(i.fix, null, re + ': أُصدر إصلاح لجملة ممتدة: ' + i.fix);
    assert.strictEqual(i.aiRequired, true, re + ': لم يُوسم AI_REQUIRED');
    assert.notStrictEqual(String(i.fix), String(i.ev), re + ': الإصلاح نسخة من السطر');
  }
});

// ═══ 13. C++ ════════════════════════════════════════════
test('C++: new ⇒ AI_REQUIRED دائماً لأن الاستبدال النصي لا يُترجم', () => {
  for (const code of ['Foo* f = new Foo(1, 2);\n', 'int* a = new int[10];\n', 'Bar *b = new Bar();\n']) {
    const i = one(A(code, 'a.cpp'), /smart pointers/);
    assertAiRequired(i, 'new :: ' + code.trim());
    assert.ok(!/make_unique<\w+>\(\)\(/.test(String(i.fix)), 'ما زال يُنتج make_unique<T>()(args)');
  }
  none(A('auto p = std::make_unique<Foo>(1, 2);\n', 'a.cpp'), /smart pointers/);
  none(A('Foo* f = new Foo(1, 2);\n', 'a.c'), /smart pointers/);   // قواعد C++ لا تُطبَّق على C
});

test('C++: الإصلاحات التي كانت تعليقاً صارت AI_REQUIRED', () => {
  assertAiRequired(one(A('auto p = reinterpret_cast<int*>(q);\n', 'a.cpp'), /reinterpret_cast/), 'reinterpret_cast');
  assertAiRequired(one(A('class A {\n  ~A() {\n    throw std::runtime_error("x");\n  }\n};\n', 'a.cpp'), /Destructor/), 'destructor throw');
  assertAiRequired(one(A('int x;\nstd::cin >> x;\n', 'a.cpp'), /sync_with_stdio/), 'cin sync');
  assertAiRequired(one(A('int rc = system(cmd);\n', 'a.c'), /system\(\)/), 'system');
  assertAiRequired(one(A('int key = rand();\n', 'a.c'), /rand\(\)/), 'rand');
});

test('header: تحذير using namespace std يعمل في .h و .hpp معاً', () => {
  // كان الفحص داخل شرط C++ بينما .h تجعله C، فكان الفرع ميتاً
  assert.strictEqual(find(A('using namespace std;\n', 'a.h'),   /using namespace std/).length, 1, '.h لم يُفحص');
  assert.strictEqual(find(A('using namespace std;\n', 'a.hpp'), /using namespace std/).length, 1, '.hpp لم يُفحص');
  none(A('using namespace std;\n', 'a.cpp'), /using namespace std/);   // خارج الـheaders لا تحذير
});

// ═══ 14. size_t ════════════════════════════════════════
test('int = sizeof: يُصلَح إلى size_t إلا إذا كان المتغير يُقارن بسالب', () => {
  const ok = A('int len = sizeof(buffer);\nuse(len);\n', 'a.c');
  const i1 = one(ok, /size_t/);
  assertFixShape(i1, 'sizeof/آمن');
  assert.ok(i1.fix.startsWith('size_t len'), i1.fix);
  const signed = A('int len = sizeof(buffer);\nfor (int i = len; i >= 0; i--) { use(i); }\nif (len < 0) return;\n', 'a.c');
  assertAiRequired(one(signed, /size_t/), 'sizeof/مقارنة بسالب');
});

// ═══ 15. لا إصلاح خطر يمرّ ═══════════════════════════════
test('ضمان عام: كل إصلاح يبقى ليس تعليقاً ولا نسخة من السطر، وأقواسه متوازنة', () => {
  const files = {
    'a.c': 'char buf[64];\nchar *dyn = malloc(32);\nint n = sizeof(buf);\n' +
           'gets(buf);\nstrcpy(buf, src);\nstrcat(buf, tail);\nsprintf(buf, "%d", n);\n' +
           'scanf("%s", buf);\nprintf(buf);\nsystem(cmd);\nfree(dyn);\nfree(dyn);\n',
    'a.cpp': 'Foo* f = new Foo(1);\nauto q = reinterpret_cast<int*>(p);\nint x;\nstd::cin >> x;\n',
    'a.hpp': 'using namespace std;\nclass A { ~A() { throw 1; } };\n',
  };
  let checked = 0;
  for (const [fn, code] of Object.entries(files)) {
    const r = A(code, fn);
    assert.ok(list(r).length > 0, fn + ': لا ثغرات');
    for (const i of list(r)) {
      const label = fn + ' @' + i.line + ' ' + String(i.title).slice(0, 26);
      if (i.fix === null) { assert.strictEqual(i.aiRequired, true, label + ': fix=null بلا AI_REQUIRED'); continue; }
      assertFixShape(i, label);
      checked++;
    }
  }
  assert.ok(checked > 0, 'لم يُفحص أي إصلاح حقيقي');
});

// ═══ 16. idempotency ════════════════════════════════════
test('idempotency: تحليل الكود بعد تطبيق إصلاحه لا يُعيد البلاغ نفسه', () => {
  const pairs = [
    ['char dst[64];\nstrcpy(dst, src);\n', /strcpy\(\)/],
    ['char buf[128];\nsprintf(buf, "%s", name);\n', /sprintf\(\)/],
    ['char b[64];\ngets(b);\n', /gets\(\)/],
    ['char n[16];\nscanf("%s", n);\n', /scanf %s/],
    ['char msg[64];\nprintf(msg);\n', /Format String/],
    ['int len = sizeof(buf);\n', /size_t/],
  ];
  for (const [code, re] of pairs) {
    const first = one(A(code, 'a.c'), re);
    const lines = code.split('\n');
    lines[first.line - 1] = first.fix;
    const applied = lines.join('\n');
    none(A(applied, 'a.c'), re);
  }
});

// ═══ 17. الكشف لم يضعف ════════════════════════════════
test('ضابط الانحدار: كل كاشف ما زال يكتشف حالته الأساسية', () => {
  const expect = [
    ['a.c',   'char b[8];\ngets(b);\n',                         /gets\(\)/],
    ['a.c',   'char b[8];\nstrcpy(b, s);\n',                     /strcpy\(\)/],
    ['a.c',   'char b[8];\nstrcat(b, s);\n',                     /strcat\(\)/],
    ['a.c',   'char b[8];\nsprintf(b, "%d", n);\n',              /sprintf\(\)/],
    ['a.c',   'char b[8];\nscanf("%s", b);\n',                   /scanf %s/],
    ['a.c',   'char m[8];\nprintf(m);\n',                        /Format String/],
    ['a.c',   'char *p = malloc(8);\nuse(p);\n',                 /malloc\(\)/],
    ['a.c',   'free(p);\nfree(p);\n',                            /Double Free/],
    ['a.c',   'int n = sizeof(x);\n',                            /size_t/],
    ['a.c',   'system(cmd);\n',                                  /system\(\)/],
    ['a.c',   'int token = rand();\n',                           /rand\(\)/],
    ['a.cpp', 'Foo *f = new Foo();\n',                           /smart pointers/],
    ['a.cpp', 'auto q = reinterpret_cast<int*>(p);\n',           /reinterpret_cast/],
    ['a.cpp', 'int x;\nstd::cin >> x;\n',                        /sync_with_stdio/],
    ['a.cpp', 'class A {\n  ~A() { throw 1; }\n};\n',            /Destructor/],
    ['a.h',   'using namespace std;\n',                          /using namespace std/],
  ];
  for (const [fn, code, re] of expect) {
    const r = A(code, fn);
    assert.strictEqual(find(r, re).length, 1, fn + ' ' + re + ': الكشف ضاع :: ' + list(r).map(i => i.title).join(' | '));
  }
});
