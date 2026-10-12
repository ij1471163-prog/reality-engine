// ═══════════════════════════════════════════════════════
// [LCS-MEMO] الفرقُ يُحسب مرةً لكل نصّين، لا مرةً لكل بلاغ
// ═══════════════════════════════════════════════════════
//
// العيبُ المقيس، بلاغُ مستخدمٍ عن «تعليق وتأخير»:
//
//   ‎learn()‎ تمرّ على البلاغات واحدًا واحدًا وتنادي ‎extractPair‎ لكلٍّ
//   منها، و‎extractPair‎ تبدأ بحساب فرقِ LCS كاملًا بين ‎codeBefore‎
//   و‎codeAfter‎. والفرقُ لا يعتمد على البلاغ إطلاقًا — إنما على النصّين،
//   وهما ثابتان طوال النداء. والجدولُ ‎O(n×m)‎، فالكلفةُ تتربّع مع الحجم.
//
// المقيس بمُحلِّل معالجٍ حقيقي على ملفٍ من 472 سطرًا بـ255 بلاغًا:
//
//     fixAllEngine الكلي     20,555 ms
//     منها lcsBlocks         16,656 ms   ← 78% من الزمن كلّه
//     learn() وحدها          15,123 ms
//
// أي 255 حسابًا **متطابقًا** لجدولٍ من 472×472 خانة. وبعد الحفظ:
//
//     learn()         15,123 ms  ⇒   121 ms
//     fixAllEngine    20,555 ms  ⇒ 4,245 ms
//
// والحفظُ لا يغيّر ناتجًا: ‎lcsBlocks‎ خالصة — مصفوفتا نصوصٍ إلى كتل، بلا
// حالةٍ ولا عشوائية — والمُستهلكون يقرأون ولا يكتبون.
//
// وهذا الملف يحرس **العدد** لا الزمن: الزمنُ يتقلّب بالعتاد والحِمل،
// وعددُ الحسابات حتمي.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const K = require(path.join(PUBLIC_DIR, 'learning_knowledge.js'));

const BEFORE = [
  'const API_TOKEN = "sk_live_7f3a9b2c4d6e8f0a";',
  'function render(el, v) {',
  '  el.innerHTML = v;',
  '}',
  'function total(items) {',
  '  let t = 0;',
  '  for (const i of items) { t = i.v; }',
  '  return t;',
  '}',
  'module.exports = { render, total };',
  '',
].join('\n');

const AFTER = BEFORE
  .replace('"sk_live_7f3a9b2c4d6e8f0a"', 'process.env.API_TOKEN')
  .replace('el.innerHTML = v;', 'el.textContent = v;');

test('[LM-1] tripwire: الفرقُ يُنتج كتلًا فعلًا', () => {
  const blocks = K.lcsBlocks(BEFORE.split('\n'), AFTER.split('\n'));
  assert.ok(Array.isArray(blocks), 'لا كتل');
  assert.ok(blocks.length >= 2, 'عددُ الكتل ' + blocks.length + ' — العيّنة تغيّرت');
});

test('[LM-2] نفسُ المدخل يُرجع نفسَ الكتل — بلا إعادة حساب', () => {
  const a = BEFORE.split('\n'), b = AFTER.split('\n');
  const first  = K.lcsBlocks(a, b);
  const second = K.lcsBlocks(a.slice(), b.slice());   // مصفوفتان جديدتان، نفسُ المحتوى
  assert.strictEqual(second, first,
    'مصفوفتان متطابقتا المحتوى أعادتا كائنين مختلفين — الحفظُ يفتُّ على الهُويّة لا المحتوى');
});

test('[LM-3] ونصٌّ مختلف يُحسب من جديد', () => {
  const a = BEFORE.split('\n');
  const one = K.lcsBlocks(a, AFTER.split('\n'));
  const two = K.lcsBlocks(a, AFTER.replace('process.env', 'process.ENV').split('\n'));
  assert.notStrictEqual(two, one, 'نصٌّ مختلف أعاد الكتلَ المحفوظة — خلطٌ بين مدخلين');
  assert.notDeepStrictEqual(two, one, 'الكتلُ متطابقة رغم اختلاف النصّ');
});

test('[LM-4] أولُ بلاغٍ يدفع ثمنَ الفرق، وما بعده لا يدفعه', () => {
  // ‎extractPair‎ تنادي ‎lcsBlocks‎ المحليّة داخل الإغلاق فلا تُرصد من
  // الخارج. والمرصدُ الدقيق: نداءانِ على **نفس** الزوج. بلا حفظٍ يحسب
  // كلاهما الجدول فيتساويان؛ ومع الحفظ يدفع الأولُ وحده.
  //
  // ولا يُقاس عملٌ لكل بلاغ هنا: البلاغان متطابقان في كل شيء عدا الرقم،
  // فما بينهما من فرقٍ هو الجدولُ وحده.
  const lines = [];
  for (let i = 0; i < 400; i++) lines.push('const v' + i + ' = "value_' + i + '";');
  // زوجٌ فريدٌ لكل تشغيل، فلا يأتي من ذاكرةِ اختبارٍ سابق
  const tag = 'u' + Date.now() + Math.random().toString(36).slice(2, 7);
  const big = lines.join('\n') + '\nconst ' + tag + ' = 1;\n';
  const fixed = big.replace('"value_7"', 'process.env.V7');
  const issue = n => ({ line: n, sev: 'c', type: 'secret', title: 't' + n });

  const t = i => {
    const s = process.hrtime.bigint();
    K.extractPair(big, fixed, i);
    return Number(process.hrtime.bigint() - s) / 1e6;
  };

  const cold = t(issue(8));                       // أولُ لقاءٍ بهذا الزوج
  const warm = Math.min(t(issue(8)), t(issue(8)), t(issue(8)));

  assert.ok(cold > 1,
    'tripwire: أولُ حسابٍ كلّف ' + cold.toFixed(2) + 'ms — العيّنة أصغر من أن تقيس');
  assert.ok(warm < cold / 3,
    'النداءُ الثاني على نفس الزوج كلّف ' + warm.toFixed(2) + 'ms مقابل ' +
    cold.toFixed(2) + 'ms للأول — الفرقُ يُعاد حسابه لكل بلاغ');
});

test('[LM-5] والحفظُ محدود — لا ينمو بلا سقف', () => {
  // عشرون نصًّا متمايزًا على سقفٍ من أربعة: الذاكرةُ لا تحتفظ بها كلِّها.
  const base = BEFORE.split('\n');
  const kept = [];
  for (let i = 0; i < 20; i++) {
    kept.push(K.lcsBlocks(base, AFTER.replace('v;', 'v' + i + ';').split('\n')));
  }
  // الأوّلُ خرج من الذاكرة، فإعادةُ طلبه تُنتج كائنًا جديدًا
  const again = K.lcsBlocks(base, AFTER.replace('v;', 'v0;').split('\n'));
  assert.notStrictEqual(again, kept[0], 'الذاكرةُ احتفظت بعشرين مدخلًا — لا سقفَ لها');
});

test('[LM-6] والنتيجةُ صحيحةٌ لا محفوظةً وحسب', () => {
  // الحفظُ بلا صحةٍ لا قيمة له: تُقارَن الكتلُ بما يصفه الفرقُ فعلًا.
  const a = ['x', 'OLD', 'y'];
  const b = ['x', 'NEW', 'y'];
  const blocks = K.lcsBlocks(a, b);
  assert.strictEqual(blocks.length, 1, 'كتلةٌ واحدة متوقَّعة: ' + JSON.stringify(blocks));
  assert.deepStrictEqual(blocks[0].removed, [{ idx: 1, line: 'OLD' }]);
  assert.deepStrictEqual(blocks[0].added,   [{ idx: 1, line: 'NEW' }]);

  // ومتطابقان ⇒ لا كتل
  assert.deepStrictEqual(K.lcsBlocks(['p', 'q'], ['p', 'q']), []);
});
