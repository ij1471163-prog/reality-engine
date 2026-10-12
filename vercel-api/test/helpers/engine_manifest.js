// ═══════════════════════════════════════════════════════
// قراءةُ بيان المحرّكات — بلا اقتطاعٍ صامت
// ═══════════════════════════════════════════════════════
//
// ملفُ اختباراتٍ مساعد، لا كودَ إنتاج.
//
// خمسةُ ملفاتِ اختبارٍ كانت تقرأ قائمةَ محرّكات الخادم بنمطٍ من هذا الشكل:
//
//     src.match(/const engines\s*=\s*\[([\s\S]*?)\]/)
//
// و‎[\s\S]*?‎ غيرُ نَهِم، فيتوقّف عند **أول** ‎]‎ يراه — ولو كان داخل تعليق.
// فتعليقٌ واحد مثل ‎// انظر [شيئًا]‎ داخل المصفوفة يقتطع القائمة.
//
// والمقيس على مصفوفةٍ من ثلاثة عناصر وتعليقٍ فيه قوسٌ بعد الأول:
//     الحقيقة  : a.js, b.js, c.js
//     المقروء  : a.js
//
// وخطرُه أنه **صامت**: الاختبار يُحمّل سياقًا أصغر من سياق الإنتاج ثم يمرّ،
// فيحرس ما لم يُشغَّل. وقد وقع فعلًا: تعليقٌ أُضيف إلى البيان أسقط أربعة عشر
// اختبارًا في ghost_syntax_gate لأن ‎ghost_mode.js‎ سقط من القائمة المقروءة —
// والبيانُ سليم.
//
// فالقراءةُ هنا: تُجرَّد التعليقاتُ أولًا ثم يُقرأ، ويُتحقَّق من أن ما قُرئ
// يساوي كلَّ نصٍّ منتهٍ بـ‎.js‎ داخل الكتلة. فالاقتطاع يصير خطأً معلنًا.
'use strict';

const fs     = require('node:fs');
const assert = require('node:assert');

// تجريدُ التعليقات مع الحفاظ على أطوال الأسطر غير مطلوب هنا — المطلوب
// ألّا يبقى قوسٌ داخل تعليقٍ يخدع الباحث عن نهاية المصفوفة.
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// نهايةُ المصفوفة بعدّ الأقواس، لا بأول ‎]‎
function arrayBody(src, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return src.slice(startIdx + 1, i); }
  }
  return null;
}

/**
 * يقرأ قائمةَ المحرّكات من ملفٍ يُعرّف `const engines = [ … ]`.
 * @param {string} file  مسارُ الملف
 * @param {string} name  اسمُ المتغيّر (engines افتراضًا، أو MODULES)
 * @returns {string[]}   أسماءُ الملفات بترتيبها
 */
function readEngineManifest(file, name) {
  const varName = name || 'engines';
  const raw = fs.readFileSync(file, 'utf8');
  const clean = stripComments(raw);

  // يُقبل غلافٌ واحد بين ‎=‎ والمصفوفة: ‎Object.freeze([…])‎ وما يشبهه،
  // فبيانُ بطارية التشخيص مُجمَّد وبيانا الخادم ليسا كذلك.
  const re = new RegExp('\\b' + varName + '\\s*=\\s*(?:[\\w.]+\\s*\\(\\s*)?\\[');
  const m = re.exec(clean);
  assert.ok(m, file + ': لا يحوي `' + varName + ' = [ … ]`');

  const body = arrayBody(clean, m.index + m[0].length - 1);
  assert.ok(body !== null, file + ': مصفوفةُ ' + varName + ' غيرُ مُغلَقة');

  const list = body.split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(s => /\.js$/.test(s));

  // حارسُ الاقتطاع: ما قُرئ يساوي كلَّ نصٍّ ‎.js‎ داخل الكتلة نفسها
  const expected = (body.match(/['"][\w.\-]+\.js['"]/g) || []).length;
  assert.strictEqual(list.length, expected,
    file + ': قُرئ ' + list.length + ' من ' + expected + ' — الكتلةُ اقتُطعت');
  assert.ok(list.length > 0, file + ': القائمةُ فارغة');

  return list;
}

module.exports = { readEngineManifest, stripComments, arrayBody };
