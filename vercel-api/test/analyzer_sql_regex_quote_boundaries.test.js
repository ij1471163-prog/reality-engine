// ═══════════════════════════════════════════════════════
// حدود الاقتباس والضمّ الضمني في قاعدة SQL_INJECTION via %s
// ═══════════════════════════════════════════════════════
//
// لماذا هذا الملف منفصل عن analyzer_sql_param_vs_format.test.js؟
// لأن ذاك يختبر التمييز بين «معامِلات منفصلة» و«دمج بـ%»، وهذا
// يختبر شيئين مختلفين: حدود مُحدِّد النص (الاقتباس الملاصق،
// الضمّ الضمني، الهروب) وزمن التطابق.
//
// ─── ترتيب الأقسام مقصود ──────────────────────────────
// 1) الأداء أولًا. القاعدة السابقة كانت تمرّ على كل اختبارات
//    الوظيفة وتنفجر أُسّيًّا على سلسلة شرطات مائلة: سطر Python
//    بطول 63 حرفًا استهلك 3,659 ms داخل analyzeCode. السبب أن
//    الفرعين ‎\\[\s\S]‎ و‎(?!\1)[\s\S]‎ كليهما يصلح لاستهلاك شرطة
//    مائلة واحدة، فعدد مسارات التحليل أُسّي عند الفشل. الحل:
//    ‎[^\\]‎ في الفرع أحادي الحرف، فتبقى الشرطة من اختصاص
//    ‎\\[\s\S]‎ وحده ⇒ لا غموض ⇒ زمن خطيّ، بلا أي تغيير في
//    سلوك الاكتشاف.
// 2) ثم الحالات الخطِرة، ثم حرّاس الإيجابيات الكاذبة.
//
// ─── التعبير يُستخرَج من الملف، لا يُنسَخ ─────────────────
// ruleFromSource() يقرأ extended_patterns.js ويستخرج التعبير من
// سطر القاعدة نفسه، ثم يتحقّق أن النصّ المستخرج مطابق حرفيًّا لما
// في السطر. فلا يمكن أن يختبر هذا الملف تعبيرًا غير الذي يُشحَن.
//
// ─── خارج النطاق، موثّق في القسم 5 ──────────────────────
// SQL الممتد عبر عدة أسطر: المسح في extended_patterns.js سطريّ
// (lines.forEach ⇒ line.trim() ⇒ pattern.test)، فعبارة يتوزّع
// نصُّها أو عامل ‎%‎ على سطرين لا تُكتشَف. معالجته تمسّ حلقة
// المسح المشتركة بين أربع لغات وكل القواعد ⇒ مرحلة مستقلة.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');
const { execFileSync } = require('node:child_process');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const EP_PATH    = path.join(PUBLIC_DIR, 'extended_patterns.js');

// ═══ القسم 0: استخراج التعبير المشحون ═══════════════════

const RULE_TITLE = 'SQL Injection via %s format';

function ruleFromSource() {
  const lines = fs.readFileSync(EP_PATH, 'utf8').split('\n');
  const idx   = lines.findIndex(l => l.includes(`title: '🔴 ${RULE_TITLE}'`));
  assert.ok(idx !== -1, `لم يُعثَر على سطر القاعدة «${RULE_TITLE}» في extended_patterns.js`);
  const m = lines[idx].match(/\{ pattern: \/(.+)\/([a-z]*), sev:/);
  assert.ok(m, `سطر القاعدة ${idx + 1} ليس على الشكل { pattern: /…/flags, sev: … }`);
  return { source: m[1], flags: m[2], line: idx + 1, raw: lines[idx] };
}

// ═══ القسم 1: الأداء ════════════════════════════════════

const BUDGET_MS        = 50;    // الحدّ المقبول لكل مدخل إجهاد
const CHILD_TIMEOUT_MS = 3000;  // ما بعده يُحتسَب تجاوزًا صريحًا

// نقيس في عملية مستقلة: التعبير المنفجر لا يُقطَع من داخل node،
// فالمهلة هي الوسيلة الوحيدة لعدم تعليق المجموعة.
const CHILD = 'const re=new RegExp(process.env.RX_SRC,process.env.RX_FLAGS);'
            + 'const s=process.env.RX_INPUT;'
            + 'const t=process.hrtime.bigint();re.test(s);'
            + 'process.stdout.write(String(Number(process.hrtime.bigint()-t)/1e6));';

function matchMs(rule, input) {
  try {
    const out = execFileSync(process.execPath, ['-e', CHILD], {
      env: { ...process.env, RX_SRC: rule.source, RX_FLAGS: rule.flags, RX_INPUT: input },
      timeout: CHILD_TIMEOUT_MS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const ms = Number(out);
    return Number.isFinite(ms) ? ms : Infinity;
  } catch (e) {
    return Infinity;  // مهلة أو موت العملية ⇒ تجاوز
  }
}

// السلالم: أطوال متزايدة تدريجيًّا، لا قياس واحد
const LADDER = [8, 16, 24, 32, 48, 64, 96, 128];

const bslashAfter  = n => 'cur.execute("SELECT %s ' + '\\'.repeat(n);
const bslashBefore = n => 'cur.execute("' + '\\'.repeat(n) + ' SELECT id=%s';
const escQuotes    = n => 'cur.execute("SELECT x WHERE a=%s ' + '\\"'.repeat(n) + '", (uid,))';

const LINEAR = {
  'جسم طويل بلا تطابق':   'cur.execute("SELECT ' + 'a'.repeat(4000) + ' WHERE id=%s", (uid,))',
  'ضمّ ضمني متكرر':       'cur.execute("SELECT ' + '" "'.repeat(1000) + 'id=%s", (uid,))',
  'سلسلة اقتباسات':       'cur.execute("SELECT %s' + '"'.repeat(2000) + ')',
  'execute متداخل':       'cur.execute('.repeat(500) + '"SELECT id=%s"',
  'فواصل كثيرة':          'cur.execute("SELECT %s ' + 'b, '.repeat(1000) + '", (uid,))',
};

test('الأداء: التعبير المقيس مُستخرَج حرفيًّا من سطر القاعدة المشحون', () => {
  const rule = ruleFromSource();
  assert.ok(rule.raw.includes(`/${rule.source}/${rule.flags}`),
    'نصّ التعبير المستخرج لا يطابق ما في الملف حرفيًّا');
  assert.doesNotThrow(() => new RegExp(rule.source, rule.flags), 'التعبير المستخرج لا يُصرَّف');
});

for (const [label, mk] of [
  ['سلسلة شرطات مائلة بعد %s', bslashAfter],
  ['سلسلة شرطات مائلة قبل كلمة SQL', bslashBefore],
  ['اقتباسات مهروبة متكرّرة', escQuotes],
]) {
  test(`الأداء: ${label} — كل طول دون ${BUDGET_MS} ms`, () => {
    const rule = ruleFromSource();
    const over = [];
    for (const n of LADDER) {
      const input = mk(n);
      const ms    = matchMs(rule, input);
      if (!(ms <= BUDGET_MS)) over.push(`n=${n} (طول ${input.length}) ⇒ ${ms === Infinity ? `>${CHILD_TIMEOUT_MS}` : ms.toFixed(1)} ms`);
    }
    assert.deepStrictEqual(over, [],
      `تجاوز الميزانية على سطر القاعدة ${rule.line}:\n  ` + over.join('\n  '));
  });
}

test(`الأداء: مدخلات طويلة خطيّة الشكل — كل مدخل دون ${BUDGET_MS} ms`, () => {
  const rule = ruleFromSource();
  const over = [];
  for (const [label, input] of Object.entries(LINEAR)) {
    const ms = matchMs(rule, input);
    if (!(ms <= BUDGET_MS)) over.push(`${label} (طول ${input.length}) ⇒ ${ms === Infinity ? `>${CHILD_TIMEOUT_MS}` : ms.toFixed(1)} ms`);
  }
  assert.deepStrictEqual(over, [], 'تجاوز الميزانية:\n  ' + over.join('\n  '));
});

// سلامة الأداة: لو كان المقياس شكليًّا لمرّ التعبير الغامض أيضًا.
// هذا التعبير هو القاعدة قبل إصلاح الغموض، مثبَّتة نصًّا هنا عن قصد.
test('سلامة الأداة: التعبير الغامض يتجاوز الميزانية ⇒ المقياس ليس شكليًّا', () => {
  const ambiguous = {
    source: String.raw`execute\s*\(\s*("""|'''|"|')(?:\\[\s\S]|(?!\1)[\s\S])*?\b(?:SELECT|INSERT|UPDATE|DELETE)\b(?:\\[\s\S]|(?!\1)[\s\S])*?%s(?:\\[\s\S]|(?!\1)[\s\S])*?\1\s*%`,
    flags: 'i',
  };
  const ms = matchMs(ambiguous, bslashBefore(64));
  assert.ok(!(ms <= BUDGET_MS),
    `التعبير الغامض قُيس بـ${ms} ms — المقياس لا يكشف الانفجار، فلا قيمة لاجتياز القاعدة الجديدة`);
});

// ═══ القسم 2: بيئة الفحص الوظيفي ════════════════════════

function loadCtx() {
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop, createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة فقط */ }
  }
  return ctx;
}

const ctx = loadCtx();

// المرشِّح على أوسع صورة لعائلة الحقن — فتأكيد «لا بلاغ» أشدّ لا أضعف
const sqlCount = (code, fileName) =>
  ctx.analyzeCode(code, fileName || 't.py').filter(i =>
    /sql\s*injection/i.test(String(i.title || '')) ||
    /SQL_INJECTION|CWE[-_]89/i.test(String(i.cAct || '') + '|' + String(i.type || ''))).length;

const py = body => `import psycopg2\n\ndef handler(uid, x, y, v, d, n, name):\n    ${body}\n`;

const T3D = '"""';
const T3S = "'''";

test('isolation: البيئة تعمل ⇒ دمج صريح يُبلَّغ عنه ومُعامَل لا', () => {
  assert.ok(sqlCount(py('cur.execute("SELECT * FROM t WHERE id=%s" % uid)')) >= 1,
    'الدمج الصريح لا يُبلَّغ عنه ⇒ البيئة لا تُحمَّل');
  assert.strictEqual(sqlCount(py('cur.execute("SELECT * FROM t WHERE id=%s", (uid,))')), 0,
    'المُعامَل يُبلَّغ عنه ⇒ البيئة ليست على القاعدة المتوقَّعة');
});

// ═══ القسم 3: الحالات الخطِرة ═══════════════════════════
// (أ) اقتباس ملاصق لمُحدِّد ثلاثي · (ج) ضمّ نصوص ضمنيًّا

const DANGEROUS = {
  'ثلاثي مزدوج + اقتباس ملاصق للمُحدِّد':
    `cur.execute(${T3D}SELECT * FROM t WHERE n="%s"${T3D}" % n)`,
  'ثلاثي مفرد + اقتباس مفرد ملاصق':
    `cur.execute(${T3S}SELECT * FROM t WHERE n='%s'${T3S}' % n)`,
  'ضمّ ضمني من جزأين و%s في الثاني':
    'cur.execute("SELECT * FROM t " "WHERE id=%s" % uid)',
  'ضمّ ضمني من ثلاثة أجزاء':
    'cur.execute("SELECT a FROM t " "WHERE b=1 " "AND id=%s" % uid)',
  'ضمّ ضمني من أربعة أجزاء':
    'cur.execute("SELECT a " "FROM t " "WHERE b=1 " "AND id=%s" % uid)',
  'ضمّ ضمني و%s في الجزء الأول':
    'cur.execute("SELECT * FROM t WHERE id=%s " "ORDER BY a" % uid)',
  'ضمّ ضمني بنصوص مفردة':
    "cur.execute('SELECT * FROM t ' 'WHERE id=%s' % uid)",
};

for (const [label, body] of Object.entries(DANGEROUS)) {
  test(`خطِر: ${label} ⇒ يُكتشف`, () => {
    assert.ok(sqlCount(py(body)) >= 1, `لم يُبلَّغ عن: ${body}`);
  });
}

// ═══ القسم 4: حرّاس الإيجابيات الكاذبة ═════════════════
// نفس الأشكال أعلاه لكن بمعامِلات منفصلة ⇒ ليست حقنًا

const SAFE = {
  'ثلاثي + اقتباس ملاصق + معامِلات':
    `cur.execute(${T3D}SELECT * FROM t WHERE n="%s"${T3D}, (n,))`,
  'ثلاثي مفرد + اقتباس ملاصق + معامِلات':
    `cur.execute(${T3S}SELECT * FROM t WHERE n='%s'${T3S}, (n,))`,
  'ضمّ ضمني + معامِلات':
    'cur.execute("SELECT a FROM t " "WHERE id=%s", (uid,))',
  'ضمّ ضمني + معامِلات على سطر تالٍ':
    'cur.execute("SELECT a FROM t " "WHERE id=%s",\n        (uid,))',
  'ضمّ ضمني + نسبة حرفية في LIKE':
    'cur.execute("SELECT * FROM t " "WHERE n LIKE %s", ("a%",))',
  'ضمّ ضمني بلا كلمة SQL':
    'job.execute("step " "number %s" % name)',
  'معامِلات + تعليق لاحق يحوي تنسيقًا':
    'cur.execute("SELECT * FROM t WHERE id=%s", (uid,))  # ليس "%s" % x',
  'معامِلات ثم نداء منسَّق على السطر نفسه':
    'cur.execute("SELECT * FROM t WHERE id=%s", (uid,)); log("%s" % x)',
  'معامِلات ووسيط ثانٍ منسَّق':
    'cur.execute("SELECT * FROM t WHERE id=%s", ("p%s" % x,))',
  'معامِلات بقاموس':
    'cur.execute("SELECT * FROM t WHERE id=%s", {"id": uid})',
};

for (const [label, body] of Object.entries(SAFE)) {
  test(`سليم: ${label} ⇒ ليست حقنًا`, () => {
    assert.strictEqual(sqlCount(py(body)), 0, `بلاغ زائف على: ${body}`);
  });
}

// ═══ القسم 5: عدم الانحدار ═════════════════════════════
// كل ما كانت القاعدة السابقة تكتشفه يجب أن يبقى مُكتشَفًا

const KEEP_DETECTED = {
  'اقتباس مفرد داخل مزدوج':      `cur.execute("SELECT * FROM t WHERE n='%s'" % n)`,
  'اقتباس مزدوج داخل مفرد':      `cur.execute('SELECT * FROM t WHERE n="%s"' % n)`,
  'ثلاثي + فراغ قبل الإغلاق':    `cur.execute(${T3D}SELECT * FROM t WHERE n="%s" ${T3D} % n)`,
  'اقتباس داخلي في منتصف ثلاثي': `cur.execute(${T3D}SELECT "a" FROM t WHERE id=%s${T3D} % uid)`,
  'مهروب مزدوج':                 'cur.execute("SELECT * FROM t WHERE n=\\"%s\\"" % n)',
  'مهروب مفرد':                  "cur.execute('SELECT * FROM t WHERE n=\\'%s\\'' % n)",
  'مهروبان متتاليان':            'cur.execute("SELECT * FROM t WHERE a=\\"%s\\" AND b=\\"1\\"" % v)',
  'شرطة مائلة قبل الإغلاق':      'cur.execute("SELECT * FROM t WHERE p=\\"\\\\%s\\"" % v)',
  'ثلاثي مزدوج بسيط':            `cur.execute(${T3D}SELECT * FROM t WHERE id=%s${T3D} % uid)`,
  'ثلاثي مفرد بسيط':             `cur.execute(${T3S}SELECT * FROM t WHERE id=%s${T3S} % uid)`,
  'حالة أحرف صغيرة':            'cur.execute("select * from t where id=%s" % uid)',
  'حالة أحرف مختلطة':           'cur.execute("DeLeTe FROM t WHERE id=%s" % uid)',
  'INSERT بخانتين وفواصل':       'cur.execute("INSERT INTO t (a,b) VALUES (%s,%s)" % (x, y))',
  'ORDER BY بفاصلة بعد %s':      'cur.execute("SELECT * FROM t WHERE a=%s ORDER BY b, c" % x)',
  'تعليق MySQL بعد %s':          'cur.execute("SELECT * FROM t WHERE a=%s # ملاحظة" % x)',
  'تنسيق بمتغيّر قاموس':         'cur.execute("SELECT * FROM t WHERE id=%s" % d)',
  'بلا مسافات حول %':            'cur.execute("SELECT * FROM t WHERE id=%s"%uid)',
  'فراغ بين execute والقوس':     'cur.execute  (  "SELECT * FROM t WHERE id=%s"  %  uid  )',
  'دمج بـ+ ثم تنسيق':            'cur.execute("SELECT * FROM t WHERE a=" + x + " AND b=%s" % v)',
};

for (const [label, body] of Object.entries(KEEP_DETECTED)) {
  test(`عدم انحدار: ${label} ⇒ يبقى مُكتشفًا`, () => {
    assert.ok(sqlCount(py(body)) >= 1, `انحدار — لم يُبلَّغ عن: ${body}`);
  });
}

const KEEP_CLEAN = {
  'معامِلات tuple':        'cur.execute("SELECT * FROM t WHERE id=%s", (uid,))',
  'معامِلات list':         'cur.execute("SELECT * FROM t WHERE id=%s", [uid])',
  'خانتان ومعامِلان':      'cur.execute("SELECT * FROM t WHERE a=%s AND b=%s", (x, y))',
  'فاصلة لاحقة':           'cur.execute("SELECT * FROM t WHERE id=%s", (uid,),)',
  'متغيّر وسيطًا':         'cur.execute("SELECT * FROM t WHERE id=%s", d)',
  'LIKE بنسبة حرفية':      'cur.execute("SELECT * FROM t WHERE n LIKE %s", ("a%",))',
  'نسبتان حرفيتان':        'cur.execute("SELECT * FROM t WHERE n LIKE %s AND m LIKE %s", ("a%","b%"))',
  'execute غير SQL':       'runner.execute("step %s" % name)',
  'selected كلمة جزئية':   'log.execute("selected %s" % name)',
  'deleted كلمة جزئية':    'log.execute("deleted %s rows" % n)',
  'ثلاثي غير SQL':         `job.execute(${T3D}step %s${T3D} % name)`,
  'نص بلا %s':             'cur.execute("SELECT * FROM t" % uid)',
};

for (const [label, body] of Object.entries(KEEP_CLEAN)) {
  test(`عدم انحدار: ${label} ⇒ تبقى بلا بلاغ`, () => {
    assert.strictEqual(sqlCount(py(body)), 0, `إيجابية كاذبة على: ${body}`);
  });
}

// ═══ القسم 6: موثَّق — خارج النطاق ═════════════════════
// السبب في كل الحالات واحد: المسح سطريّ. ليست مقايضة قبلناها،
// بل حدّ معماريّ مُسجَّل لمرحلة مستقلة. وتُثبَّت هنا بصياغة
// «القيمة الحالية» حتى يكشف أي تغيير فيها نفسه.

const DOCUMENTED_MISS = {
  'نص ثلاثي ممتد على عدة أسطر':
    `cur.execute(${T3D}\n        SELECT *\n        FROM t\n        WHERE id=%s\n    ${T3D} % uid)`,
  'عامل % على السطر التالي':
    'cur.execute("SELECT * FROM t WHERE id=%s"\n        % uid)',
  'النص كلّه على السطر التالي':
    'cur.execute(\n        "SELECT * FROM t WHERE id=%s" % uid)',
};

for (const [label, body] of Object.entries(DOCUMENTED_MISS)) {
  test(`موثَّق: ${label} ⇒ سلبية كاذبة قائمة (المسح سطريّ)`, () => {
    assert.strictEqual(sqlCount(py(body)), 0,
      `تغيّر السلوك: صارت تُكتشَف ⇒ راجع هذا التوثيق وانقلها إلى القسم 3`);
  });
}

test('موثَّق: نص بين قوسين execute(("…%s") % uid) ⇒ سلبية كاذبة قائمة في HEAD أيضًا', () => {
  // المُحدِّد لا يلي execute( مباشرةً، والقاعدة تشترط ذلك
  assert.strictEqual(sqlCount(py('cur.execute(("SELECT * FROM t WHERE id=%s") % uid)')), 0,
    'تغيّر السلوك ⇒ راجع هذا التوثيق');
});
