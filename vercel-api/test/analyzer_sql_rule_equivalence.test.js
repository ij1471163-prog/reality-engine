// ═══════════════════════════════════════════════════════
// تكافؤ التغطية: قاعدة الملف مقابل القاعدة المرجعية
// ═══════════════════════════════════════════════════════
//
// المرجع هو القاعدة ذات المقطعين الكسولين (الصيغة السابقة)، مثبَّتة
// نصًّا هنا. والمعيار: **حكم متطابق على كل حالة**. أي اختلاف يُعرَض
// باسم الحالة وبالحكمين، لا يُخفى ولا يُلخَّص.
//
// ولا يُدّعى تكافؤ رياضي: هذا تكافؤ **مقيس على 62 حالة**. تغيير
// C2 يُقيّد مسارات البحث (الكلمة الأولى و%s الأول فقط) لا مجموعة
// التطابقات نظريًّا — ولم يُثبَت ذلك برهانًا، بل قياسًا على هذه
// المجموعة وحدها. الحالات السبع في القسم «تعدد» مصمَّمة لمسّ هذا
// التقييد تحديدًا.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const EP_PATH    = path.join(PUBLIC_DIR, 'extended_patterns.js');
const RULE_TITLE = 'SQL Injection via %s format';

// القاعدة المرجعية: الصيغة ذات المقطعين الكسولين
const REFERENCE = new RegExp(String.raw`execute\s*\(\s*("""|'''|"|')(?:\\[\s\S]|\1\s*\1|(?!\1)[^\\])*?\b(?:SELECT|INSERT|UPDATE|DELETE)\b(?:\\[\s\S]|\1\s*\1|(?!\1)[^\\])*?%s(?:\\[\s\S]|(?!\1\s*%)(?!\1\s*[,)])[^\\])*?\1\s*%`, 'i');

function shippedRule() {
  const lines = fs.readFileSync(EP_PATH, 'utf8').split('\n');
  const idx   = lines.findIndex(l => l.includes(`title: '🔴 ${RULE_TITLE}'`));
  assert.ok(idx !== -1, 'لم يُعثَر على سطر القاعدة');
  const m = lines[idx].match(/\{ pattern: \/(.+)\/([a-z]*), sev:/);
  assert.ok(m, 'سطر القاعدة ليس على الشكل المتوقَّع');
  return new RegExp(m[1], m[2]);
}
const SHIPPED = shippedRule();

const Q3D = '"""', Q3S = "'''";
// [التصنيف المتوقَّع, القسم, الاسم, السطر]
const CASES = [
  [1, 'ثلاثي', 'ثلاثي مزدوج سطر واحد',        `cur.execute(${Q3D}SELECT * FROM t WHERE id=%s${Q3D} % uid)`],
  [1, 'ثلاثي', 'ثلاثي مفرد سطر واحد',         `cur.execute(${Q3S}SELECT * FROM t WHERE id=%s${Q3S} % uid)`],
  [1, 'ثلاثي', 'ثلاثي + مسافات حول %',        `cur.execute( ${Q3D}SELECT * FROM t WHERE id=%s${Q3D}    %    uid )`],
  [1, 'ثلاثي', 'ثلاثي + اقتباس ملاصق',        `cur.execute(${Q3D}SELECT * FROM t WHERE n="%s"${Q3D}" % n)`],
  [1, 'ثلاثي', 'ثلاثي مفرد + اقتباس ملاصق',   `cur.execute(${Q3S}SELECT * FROM t WHERE n='%s'${Q3S}' % n)`],
  [1, 'ثلاثي', 'ثلاثي + فراغ قبل الإغلاق',    `cur.execute(${Q3D}SELECT * FROM t WHERE n="%s" ${Q3D} % n)`],
  [1, 'ثلاثي', 'اقتباس داخلي وسط الثلاثي',    `cur.execute(${Q3D}SELECT "a" FROM t WHERE id=%s${Q3D} % uid)`],
  [0, 'ثلاثي', 'ثلاثي + معامِلات',            `cur.execute(${Q3D}SELECT * FROM t WHERE id=%s${Q3D}, (uid,))`],
  [0, 'ثلاثي', 'ثلاثي + اقتباس ملاصق + معامِلات', `cur.execute(${Q3D}SELECT * FROM t WHERE n="%s"${Q3D}, (n,))`],

  [1, 'مهروب', 'مهروب مزدوج',                 'cur.execute("SELECT * FROM t WHERE n=\\"%s\\"" % n)'],
  [1, 'مهروب', 'مهروب مفرد',                  "cur.execute('SELECT * FROM t WHERE n=\\'%s\\'' % n)"],
  [1, 'مهروب', 'مهروبان متتاليان',            'cur.execute("SELECT * FROM t WHERE a=\\"%s\\" AND b=\\"1\\"" % v)'],
  [1, 'مهروب', 'شرطة مائلة قبل الإغلاق',      'cur.execute("SELECT * FROM t WHERE p=\\"\\\\%s\\"" % v)'],
  [0, 'مهروب', 'مهروب + معامِلات',            'cur.execute("SELECT * FROM t WHERE n=\\"%s\\"", (n,))'],

  [1, 'ضمّ', 'ضمّ ضمني جزأين',                'cur.execute("SELECT * FROM t " "WHERE id=%s" % uid)'],
  [1, 'ضمّ', 'ضمّ ضمني ثلاثة',                'cur.execute("SELECT a FROM t " "WHERE b=1 " "AND id=%s" % uid)'],
  [1, 'ضمّ', 'ضمّ ضمني أربعة',                'cur.execute("SELECT a " "FROM t " "WHERE b=1 " "AND id=%s" % uid)'],
  [1, 'ضمّ', 'ضمّ ضمني و%s في الأول',         'cur.execute("SELECT * FROM t WHERE id=%s " "ORDER BY a" % uid)'],
  [1, 'ضمّ', 'ضمّ ضمني مفرد',                 "cur.execute('SELECT * FROM t ' 'WHERE id=%s' % uid)"],
  [0, 'ضمّ', 'ضمّ ضمني + معامِلات',           'cur.execute("SELECT a FROM t " "WHERE id=%s", (uid,))'],
  [0, 'ضمّ', 'ضمّ ضمني + LIKE نسبة',          'cur.execute("SELECT * FROM t " "WHERE n LIKE %s", ("a%",))'],
  [0, 'ضمّ', 'ضمّ ضمني بلا كلمة SQL',         'job.execute("step " "number %s" % name)'],

  [1, 'حالة', 'select صغيرة',                 'cur.execute("select * from t where id=%s" % uid)'],
  [1, 'حالة', 'DeLeTe مبعثرة',                'cur.execute("DeLeTe FROM t WHERE id=%s" % uid)'],
  [1, 'حالة', 'INSERT بخانتين',               'cur.execute("INSERT INTO t (a,b) VALUES (%s,%s)" % (x, y))'],
  [1, 'حالة', 'update صغيرة',                 'cur.execute("update t set a=%s" % uid)'],
  [0, 'حالة', 'select صغيرة + معامِلات',      'cur.execute("select * from t where id=%s", (uid,))'],

  [0, 'سليم', 'tuple',                        'cur.execute("SELECT * FROM t WHERE id=%s", (uid,))'],
  [0, 'سليم', 'list',                         'cur.execute("SELECT * FROM t WHERE id=%s", [uid])'],
  [0, 'سليم', 'خانتان ومعامِلان',             'cur.execute("SELECT * FROM t WHERE a=%s AND b=%s", (x, y))'],
  [0, 'سليم', 'فاصلة لاحقة',                  'cur.execute("SELECT * FROM t WHERE id=%s", (uid,),)'],
  [0, 'سليم', 'متغيّر وسيطًا',                'cur.execute("SELECT * FROM t WHERE id=%s", d)'],
  [0, 'سليم', 'LIKE نسبة حرفية',              'cur.execute("SELECT * FROM t WHERE n LIKE %s", ("a%",))'],
  [0, 'سليم', 'نسبتان حرفيتان',               'cur.execute("SELECT * FROM t WHERE n LIKE %s AND m LIKE %s", ("a%","b%"))'],
  [0, 'سليم', 'معامِلات بقاموس',             'cur.execute("SELECT * FROM t WHERE id=%s", {"id": uid})'],

  [0, 'غير SQL', 'runner.execute',            'runner.execute("step %s" % name)'],
  [0, 'غير SQL', 'رسالة',                     'task.execute("hello %s" % name)'],
  [0, 'غير SQL', 'مسار',                      'job.execute("/tmp/%s" % name)'],
  [0, 'غير SQL', 'selected جزئية',            'log.execute("selected %s" % name)'],
  [0, 'غير SQL', 'deleted جزئية',             'log.execute("deleted %s rows" % n)'],
  [0, 'غير SQL', 'ثلاثي غير SQL',             `job.execute(${Q3D}step %s${Q3D} % name)`],
  [0, 'غير SQL', 'نص بلا %s',                 'cur.execute("SELECT * FROM t" % uid)'],

  [0, 'فخاخ', 'معامِلات + تعليق فيه تنسيق',   'cur.execute("SELECT * FROM t WHERE id=%s", (uid,))  # ليس "%s" % x'],
  [0, 'فخاخ', 'معامِلات ثم نداء منسَّق',      'cur.execute("SELECT * FROM t WHERE id=%s", (uid,)); log("%s" % x)'],
  [0, 'فخاخ', 'معامِلات ووسيط ثانٍ منسَّق',   'cur.execute("SELECT * FROM t WHERE id=%s", ("p%s" % x,))'],
  [0, 'فخاخ', 'وسيط ثانٍ منسَّق بنص مفرد',    'cur.execute("SELECT * FROM t WHERE id=%s", [\'%s\' % x])'],

  [1, 'حدود', 'ORDER BY بفاصلة بعد %s',       'cur.execute("SELECT * FROM t WHERE a=%s ORDER BY b, c" % x)'],
  [1, 'حدود', 'تعليق MySQL بعد %s',           'cur.execute("SELECT * FROM t WHERE a=%s # ملاحظة" % x)'],
  [1, 'حدود', 'تنسيق بمتغيّر قاموس',          'cur.execute("SELECT * FROM t WHERE id=%s" % d)'],
  [1, 'حدود', 'بلا مسافات حول %',             'cur.execute("SELECT * FROM t WHERE id=%s"%uid)'],
  [1, 'حدود', 'فراغ بين execute والقوس',      'cur.execute  (  "SELECT * FROM t WHERE id=%s"  %  uid  )'],
  [0, 'حدود', 'نص بين قوسين (حدّ قائم)',      'cur.execute(("SELECT * FROM t WHERE id=%s") % uid)'],
  [0, 'حدود', 'اقتباس مفرد دمج (حدّ قائم)',   "cur.execute('SELECT * FROM t WHERE x=' + a)"],
  [0, 'حدود', 'دمج + ثم تنسيق (تغطّيه قاعدة أخرى)', 'cur.execute("SELECT * FROM t WHERE a=" + x + " AND b=%s" % v)'],

  // ── تعدد الكلمات ومواضع %s: يمسّ حتمية المقطعين في C2 ──
  [1, 'تعدد', 'كلمتان SQL ثم %s',             'cur.execute("SELECT x FROM (SELECT y) WHERE id=%s" % uid)'],
  [1, 'تعدد', 'كلمة SQL بعد %s أيضًا',        'cur.execute("SELECT a=%s AND b IN (SELECT c)" % uid)'],
  [1, 'تعدد', 'خانتان %s وتنسيق',             'cur.execute("SELECT * FROM t WHERE a=%s AND b=%s" % (x, y))'],
  [1, 'تعدد', 'UPDATE ثم SELECT ثم %s',       'cur.execute("UPDATE t SET a=(SELECT b) WHERE c=%s" % uid)'],
  [1, 'تعدد', 'ثلاث كلمات SQL',               'cur.execute("INSERT INTO t SELECT * FROM u WHERE DELETE_AT=%s" % d)'],
  [0, 'تعدد', 'كلمتان SQL + معامِلات',        'cur.execute("SELECT x FROM (SELECT y) WHERE id=%s", (uid,))'],
  [0, 'تعدد', 'خانتان %s + معامِلات',         'cur.execute("SELECT * FROM t WHERE a=%s AND b=%s", (x, y))'],
];

test('تكافؤ: حكم قاعدة الملف يطابق القاعدة المرجعية على كل حالة', () => {
  const diffs = [];
  for (const [, section, name, line] of CASES) {
    const a = REFERENCE.test(line) ? 1 : 0;
    const b = SHIPPED.test(line) ? 1 : 0;
    if (a !== b) diffs.push(`[${section}] ${name}: المرجع=${a} الملف=${b}\n      ${line}`);
  }
  assert.deepStrictEqual(diffs, [],
    `اختلاف تغطية على ${diffs.length} من ${CASES.length} حالة:\n    ` + diffs.join('\n    '));
});

test('تكافؤ: ولا إيجابية كاذبة جديدة على الحالات السليمة', () => {
  const fps = [];
  for (const [want, section, name, line] of CASES) {
    if (want !== 0) continue;
    if (SHIPPED.test(line)) fps.push(`[${section}] ${name}`);
  }
  // الحالات السليمة المعروفة التي لا تُطابقها القاعدة المرجعية أصلًا
  assert.deepStrictEqual(fps, [], 'إيجابيات كاذبة: ' + fps.join(' · '));
});

test('تكافؤ: ولا فقدان لحالة خطِرة تكتشفها القاعدة المرجعية', () => {
  const lost = [];
  for (const [, section, name, line] of CASES) {
    if (REFERENCE.test(line) && !SHIPPED.test(line)) lost.push(`[${section}] ${name}`);
  }
  assert.deepStrictEqual(lost, [], 'حالات فُقدت: ' + lost.join(' · '));
});

test('tripwire: القاعدة المرجعية والملف كلتاهما تعملان (المجموعة ليست خاوية)', () => {
  const refHits = CASES.filter(c => REFERENCE.test(c[3])).length;
  const shpHits = CASES.filter(c => SHIPPED.test(c[3])).length;
  assert.ok(refHits >= 20, `المرجع يُطابق ${refHits} فقط ⇒ المجموعة أو المرجع معطوب`);
  assert.ok(shpHits >= 20, `الملف يُطابق ${shpHits} فقط ⇒ القاعدة معطوبة`);
  assert.strictEqual(refHits, shpHits, `عدد التطابقات مختلف: المرجع ${refHits} والملف ${shpHits}`);
});
