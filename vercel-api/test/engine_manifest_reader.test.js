// ═══════════════════════════════════════════════════════
// قارئُ بيان المحرّكات لا يقتطع صامتًا
// ═══════════════════════════════════════════════════════
//
// العيبُ المقيس: خمسةُ ملفاتِ اختبارٍ كانت تقرأ قائمةَ محرّكات الخادم بـ
//
//     /const engines\s*=\s*\[([\s\S]*?)\]/
//
// وغيرُ النَّهِم يقف عند **أول** ‎]‎، ولو كان داخل تعليق. فتعليقٌ واحد فيه
// قوسٌ يقتطع القائمة — والاختبارُ لا يشتكي: يُحمّل سياقًا أصغر من سياق
// الإنتاج، ويحرس ما لم يُشغَّل، ويمرّ.
//
// وقد وقع فعلًا في هذه الجولة: تعليقٌ أُضيف إلى بيان ‎api/analyze.js‎ أسقط
// أربعةَ عشرَ اختبارًا في ghost_syntax_gate — لا لعطبٍ في البيان، بل لأن
// ‎ghost_mode.js‎ سقط من **القائمة المقروءة**. ولو كان التعليقُ في موضعٍ
// أبكر قليلًا لمرّت الاختباراتُ على قائمةٍ منقوصة بلا أيّ إشارة.
//
// فالخطرُ ليس أن يسقط اختبار، بل أن **ينجح** على سياقٍ ناقص.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const { readEngineManifest, arrayBody, stripComments } =
  require('./helpers/engine_manifest.js');

const API = path.join(__dirname, '..', 'api', 'analyze.js');
const ESD = path.join(__dirname, '..', 'public', 'engine_self_diagnosis.js');
const ADP = path.join(__dirname, '..', 'public', 'server_repair_adapter.js');

function tmp(content) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'man-')), 'x.js');
  fs.writeFileSync(f, content);
  return f;
}

test('[EM-1] النمطُ القديم يقتطع عند قوسٍ في تعليق — وهذا ما يُستبدل', () => {
  const src = "const engines = [\n  'a.js',\n  // انظر [شيئًا]\n  'b.js',\n  'c.js',\n];\n";
  const old = src.match(/const engines\s*=\s*\[([\s\S]*?)\]/);
  const got = old[1].replace(/\/\/[^\n]*/g, '').split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  assert.deepStrictEqual(got, ['a.js'],
    'النمطُ القديم لم يعد يقتطع — راجع ما إذا كان هذا الملف ما زال لازمًا');
});

test('[EM-2] والقارئُ الجديد يقرأ الثلاثة', () => {
  const f = tmp("const engines = [\n  'a.js',\n  // انظر [شيئًا]\n  'b.js',\n  'c.js',\n];\n");
  assert.deepStrictEqual(readEngineManifest(f), ['a.js', 'b.js', 'c.js']);
});

test('[EM-3] ويصمد لأشكالٍ أخرى من الأقواس', () => {
  const cases = [
    ["قوسٌ في تعليقٍ كتلي", "const engines = [\n  'a.js',\n  /* [x] */\n  'b.js',\n];\n", ['a.js', 'b.js']],
    ["قوسانِ متتاليان",     "const engines = [\n  'a.js',\n  // [a][b]\n  'b.js',\n];\n", ['a.js', 'b.js']],
    ["قوسٌ قبل أول عنصر",   "const engines = [\n  // [أول]\n  'a.js',\n  'b.js',\n];\n", ['a.js', 'b.js']],
    ["بلا فاصلةٍ أخيرة",    "const engines = [\n  'a.js',\n  'b.js'\n];\n", ['a.js', 'b.js']],
    ["عدّةٌ في سطر",         "const engines = [\n  'a.js', 'b.js', 'c.js',\n];\n", ['a.js', 'b.js', 'c.js']],
    ["اسمٌ بشرطة",          "const engines = [\n  'ast-engine.js',\n  'a.min.js',\n];\n", ['ast-engine.js', 'a.min.js']],
  ];
  for (const [name, src, want] of cases) {
    assert.deepStrictEqual(readEngineManifest(tmp(src)), want, name);
  }
});

test('[EM-4] والاقتطاعُ يصير خطأً معلنًا لا نجاحًا صامتًا', () => {
  // مصفوفةٌ غيرُ مُغلَقة: القارئُ يرمي بدل أن يُرجع قائمةً منقوصة
  assert.throws(() => readEngineManifest(tmp("const engines = [\n  'a.js',\n  'b.js',\n")),
    /غيرُ مُغلَقة|اقتُطعت/, 'مصفوفةٌ غيرُ مُغلَقة مرّت بصمت');
  assert.throws(() => readEngineManifest(tmp("const other = 1;\n")),
    /لا يحوي/, 'غيابُ المصفوفة مرّ بصمت');
  assert.throws(() => readEngineManifest(tmp("const engines = [];\n")),
    /فارغة/, 'قائمةٌ فارغة مرّت بصمت');
});

test('[EM-5] ويقرأ البيانات الثلاثة الحقيقية كاملةً ومتّسقة', () => {
  const api = readEngineManifest(API, 'engines');
  const esd = readEngineManifest(ESD, 'MODULES');
  const adp = readEngineManifest(ADP, 'engines');

  for (const [name, list] of [['api/analyze.js', api], ['engine_self_diagnosis.js', esd],
                              ['server_repair_adapter.js', adp]]) {
    assert.ok(list.length >= 30, name + ': قُرئ ' + list.length + ' محركًا فقط');
    assert.ok(list.includes('acorn.min.js'), name + ': acorn مفقود من المقروء');
    assert.ok(list.includes('fix_verifier.js'), name + ': البوابة مفقودة من المقروء');
    assert.strictEqual(list[0], 'acorn.min.js', name + ': acorn ليس أولًا');
    assert.deepStrictEqual(list.filter((f, i) => list.indexOf(f) !== i), [],
      name + ': تكرارٌ في القائمة');
  }

  // وبيانُ البطارية يطابق بيان الخادم — نفسُ ما يحرسه [E2E-11]، بقارئٍ محصَّن
  assert.deepStrictEqual(esd, api,
    'بيانُ بطارية التشخيص تباعد عن بيان api/analyze.js');
});

test('[EM-6] tripwire: الأدواتُ المساعدة تعمل على حدّةٍ أيضًا', () => {
  assert.strictEqual(stripComments('a /* [x] */ b').includes('['), false);
  assert.strictEqual(stripComments('a // [x]\nb').includes('['), false);
  assert.strictEqual(stripComments('const u = "http://x";').includes('http://x'), true,
    'جرّدَ ما ليس تعليقًا — ‎//‎ داخل عنوان');
  assert.strictEqual(arrayBody('x = [1, [2], 3]', 4), '1, [2], 3');
  assert.strictEqual(arrayBody('x = [1, 2', 4), null);
});
