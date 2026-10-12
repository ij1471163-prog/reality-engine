// ═══════════════════════════════════════════════════════
// [S2] طبقةُ المعرفة — عقدُها مقيسًا لا مستنتَجًا
// ═══════════════════════════════════════════════════════
//
// هذه الدوال كانت محجوزةً داخل إغلاق learning_engine.js، فلم يكن يصل
// إليها اختبارٌ إلا عبر learn()/applyLearned() — ومن ذلك الطريق تمرّ
// أخطاؤها صامتةً. والمقيس بكنس تحوّرات على الطبقة بعد الفصل: **13 تحوّرًا
// نجا** من مجموعة اختبارات التعلّم كلها (211 اختبارًا)، أي أن هذه العقود
// لم تكن محروسة:
//
//   ترتيبُ الإخلاء (المحظور ≠ المعتمد)، وlastUsed كمعيار حماية،
//   وfail-closed على النوع المجهول وعلى السطر الآمن،
//   وشرطا التعميم (خانةٌ واحدة على الأقل، وهيكلٌ ثابتٌ ≥ 3)،
//   والمرجعُ الخلفي للخانة المتكرّرة، وإرساءُ القالب بالطرفين،
//   ورفضُ قالبٍ يسمّي خانةً غير مُعلَنة، وإبقاءُ الرمز عند غياب قيمته،
//   وتطبيعُ البصمة، وفصلُ كتل LCS عبر السطر المتساوي.
//
// فالفصلُ لم يُنشئ هذه الثغرات — الكود منقولٌ حرفيًا والقطةُ المرجعية
// مطابقة — لكنه جعلها قابلةً للقياس، وهذا الملف يُغلقها. وكلُّ تأكيدٍ
// أدناه قيس على السلوك القائم أولاً ثم ثُبِّت، لا العكس.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const V = require(path.join(PUBLIC_DIR, 'learning_validation.js'));
const K = require(path.join(PUBLIC_DIR, 'learning_knowledge.js'));

// ═══ 1. المخزن: ترتيبُ الإخلاء ومعيارُ الحماية ════════════════════════

test('[KN-1] رتبُ الإخلاء ثلاثٌ متمايزة، والحظرُ يسبق الاعتماد', () => {
  // رتبة 0 — قيد جمع الأدلة: لا قدرةَ إصلاحٍ ولا حماية ⇒ أول ما يُخلى.
  // رتبة 1 — محظور: شاهدُ قبرٍ يمنع إعادة تعلّم قاعدةٍ مرفوضة.
  // رتبة 2 — معتمد: قدرةُ إصلاحٍ قائمة ⇒ آخر ما يُخلى.
  assert.strictEqual(K.evictionRank({}), 0, 'قيد جمع الأدلة ليس رتبة 0');
  assert.strictEqual(K.evictionRank({ failures: 3 }), 1, 'المحظور ليس رتبة 1');
  assert.strictEqual(K.evictionRank({ approved: true }), 2, 'المعتمد ليس رتبة 2');

  // والحظرُ يَغلِب الاعتماد: سجلٌّ مُسقَطُ الاعتماد بدليل ضرر لا يُحمى
  // حمايةَ المعتمد، وإلا تساوت قدرةُ الإصلاح مع شاهدِ منعها.
  assert.strictEqual(K.evictionRank({ failures: 3, approved: true }), 1,
    'المحظورُ المعتمدُ سابقًا يُعامل معاملةَ المعتمد ⇒ الرتبتان انطبقتا');

  // والرتبُ مرتَّبة فعلًا لا مجرّد مختلفة
  assert.ok(K.evictionRank({}) < K.evictionRank({ failures: 3 }));
  assert.ok(K.evictionRank({ failures: 3 }) < K.evictionRank({ approved: true }));
});

test('[KN-2] lastUsed هو معيارُ الحماية، ويسبق lastSeen وcreated', () => {
  // markUsed تكتب lastUsed بعد إقرار البوابة. فلو قُرئ lastSeen (مجرّد
  // مشاهدة) أو created وحدهما، حَمَى الإخلاءَ ما لم يُستعمل قطّ وأخلى ما
  // تُقرّه البوابة كل يوم.
  assert.strictEqual(K.lastTouch({ lastUsed: 5, lastSeen: 1, created: 0 }), 5,
    'lastUsed لم يُقدَّم ⇒ الاستعمالُ المُقرّ لا يحمي');
  assert.strictEqual(K.lastTouch({ lastSeen: 3, created: 1 }), 3);
  assert.strictEqual(K.lastTouch({ created: 7 }), 7);
  assert.strictEqual(K.lastTouch({}), 0, 'سجلٌّ بلا لمسٍ يجب أن يكون الأقدم');
});

// ═══ 2. استخراجُ الزوج: fail-closed على بوابتين ═══════════════════════

const SECRET_BEFORE = 'const KEY = "sk_live_123";\nuse(KEY);\n';
const SECRET_AFTER  = 'const KEY = process.env.KEY;\nuse(KEY);\n';

test('[KN-3] tripwire: الزوجُ الصحيح يُستخرج فعلًا', () => {
  // بلا هذا، كلُّ رفضٍ أدناه يخضر على فراغ.
  const pair = K.extractPair(SECRET_BEFORE, SECRET_AFTER, { line: 1, type: 'secret', sev: 'c' });
  assert.ok(pair, 'الزوجُ المرجعي لم يُستخرج ⇒ بقيةُ القسم بلا معنى');
  assert.strictEqual(pair.before, 'const KEY = "sk_live_123";');
  assert.strictEqual(pair.after,  'const KEY = process.env.KEY;');
});

test('[KN-4] النوعُ المجهول يُرفض — ولا يُستنتَج شكلُ إصلاحه', () => {
  // TYPE_FIXES تُلزم سطرَ الإصلاح بشكلِ صنفه. وصنفٌ لا مفتاحَ له لا شكلَ
  // ملزمًا له، فقبولُه قبولُ أيِّ سطرٍ أُضيف في نفس الكتلة قاعدةً للتعلّم.
  for (const t of ['zzz_unknown', 'smell', 'perf', 'style', '', null]) {
    assert.strictEqual(
      K.extractPair(SECRET_BEFORE, SECRET_AFTER, { line: 1, type: t, sev: 'c' }),
      null, 'نوعٌ لا يطابق أيَّ مفتاح في TYPE_FIXES أنتج زوجًا: ' + t);
  }

  // ⚠️ حدٌّ معلن: سطرُ ‎if (!knownType) return null;‎ نفسه مسارٌ سريع لا
  // بوابةٌ وحيدة — حلقةُ TYPE_FIXES تشترط ‎t.includes(key)‎ فتفشل مغلقةً
  // على الشرط نفسه. المقيس بمقارنة الطبقة بنسخةٍ أُسقط منها السطر: 840
  // حالة (5 أزواج × 28 تصنيفًا × سطرين × 3 حقول) و**صفرُ اختلاف**. فتحوّرٌ
  // يُسقط ذلك السطر مكافئ، ونجاتُه ليست ثغرةَ تغطية. وهذا الاختبار يحرس
  // الرفضَ لا السطر: لو سقط الشرطان كلاهما سقط هو.
});

test('[KN-5] السطرُ الآمنُ أصلًا لا يصير قاعدةَ "قبل"', () => {
  assert.ok(V.isSafe('const KEY = process.env.KEY;'), 'tripwire: isSafe لا ترى هذا آمنًا');

  // الحالةُ الحاسمة: آمنٌ ⇒ آمن. إعادةُ تسميةِ متغيّرِ بيئةٍ ليست إصلاحًا،
  // والمرشَّحُ هنا يطابق نمطَ الصنف (process.env) فتعبره حلقةُ TYPE_FIXES
  // وتعبره بوابةُ التقابل — فبوابةُ isSafe وحدَها ما يمنعه. والمقيس على
  // نسخةٍ أُسقطت منها: يُستخرج الزوج
  //     const KEY = process.env.KEY;  →  const KEY = process.env.SECRET_KEY;
  // أي قاعدةٌ تُعلَّم فتُعيد تسميةَ أي مفتاح بيئةٍ إلى SECRET_KEY، بلا ثغرةٍ
  // تُصلَح وبلا علاقةٍ بالبلاغ.
  const SAFE_B = 'const KEY = process.env.KEY;\nuse(KEY);\n';
  const SAFE_A = 'const KEY = process.env.SECRET_KEY;\nuse(KEY);\n';
  assert.strictEqual(
    K.extractPair(SAFE_B, SAFE_A, { line: 1, type: 'secret', sev: 'c' }),
    null, 'سطرٌ آمنٌ قُبل كـ"قبل" ⇒ قاعدةٌ بلا ثغرة');

  // والاتجاهُ المعكوس (آمن ⇒ معيب) يُرفض كذلك: قاعدةٌ مقلوبة تطبيقُها
  // يُدخل الثغرة. وهنا يكفيه نمطُ الصنف أيضًا — فالتأكيدُ على السلوك.
  assert.strictEqual(
    K.extractPair(SECRET_AFTER, SECRET_BEFORE, { line: 1, type: 'secret', sev: 'c' }),
    null, 'سطرٌ آمنٌ قُبل كـ"قبل" ⇒ قاعدةٌ مقلوبة');
});

test('[KN-6] حدٌّ معلن: حارسُ afterLine === beforeLine غيرُ قابلٍ للوصول', () => {
  // قياسٌ شامل لا استنتاج: على العائلات التي لا تمنعها isSafe أصلًا
  // (sql/eval/accumul)، وعلى كل تسلسلٍ طولُه ≤ 3 من مجموعةٍ تحتوي السطرَ
  // المعيب ومالئاتٍ، مرّ 4,428 مسارًا بلغ الاختيار ولم يُنتج أيٌّ منها
  // مرشَّحًا يساوي سطرَ "قبل". والسبب بنيوي: lcsBlocks تُزاوج السطرين
  // المتساويين كـeq، فلا يقع سطرٌ مُضافٌ مساوٍ لسطرٍ محذوفٍ في كتلةٍ واحدة.
  // فالحارسُ دفاعٌ ميت — يُترك لأن إزالته لا تُكسب شيئًا، ويُعلن هنا كي لا
  // يُحسب تحوّرٌ ناجٍ عليه ثغرةَ تغطية. وهذا الاختبار يحرس السببَ نفسه:
  const blocks = K.lcsBlocks(['a', 'S;', 'b'], ['a', 'S;', 'c']);
  for (const b of blocks) {
    for (const r of b.removed) {
      assert.ok(!b.added.some(a => a.line === r.line),
        'سطرٌ مُضافٌ ساوى محذوفًا في كتلةٍ واحدة ⇒ الحارسُ صار قابلًا للوصول');
    }
  }
});

// ═══ 3. التعميم: شرطا وجودِ قالبٍ ذي معنى ═════════════════════════════

test('[KN-7] tripwire: الزوجُ المعمَّم يُنتج قالبًا بخانة', () => {
  const g = K.generalizeLinePair('const A = "s";', 'const A = process.env.A;');
  assert.ok(g, 'التعميمُ المرجعي فشل ⇒ بقيةُ القسم بلا معنى');
  assert.strictEqual(g.beforeTemplate, 'const __LEARN_ID_1__ = "s";');
  assert.strictEqual(g.afterTemplate,  'const __LEARN_ID_1__ = process.env.__LEARN_ID_1__;');
  assert.deepStrictEqual(g.beforeSlots, [{ id: 'ID_1', kind: 'identifier', value: 'A' }]);
});

test('[KN-8] بلا خانةٍ واحدةٍ قابلةٍ للتجريد لا تعميم', () => {
  // المعرّفُ الذي لم يَرِد في طرف الإصلاح غيّره الإصلاح، فهو إشارةُ الثغرة
  // لا سياقها ويبقى حرفيًا. فزوجٌ لا يتقاسم الطرفان فيه معرّفًا واحدًا
  // ليس له سياقٌ يُجرَّد: قالبُه حرفيٌّ كاملٌ لا قالب، والتعلّمُ بالمطابقة
  // الحرفية يكفيه. وقبولُه يُنتج "قالبًا" يطابق سطرَه وحده بزعم التعميم.
  assert.strictEqual(K.generalizeLinePair('x+1', 'y+2'), null,
    'زوجٌ بلا معرّفٍ مشترك أنتج قالبًا');
});

test('[KN-9] هيكلٌ ثابتٌ أقصرُ من 3 محارف لا يُعمَّم', () => {
  // ما يبقى بعد حذف الخانات هو كلُّ ما يميّز الشكلَ المعيب. فهيكلٌ مثل
  // "=b" يطابق كلَّ إسنادٍ لـb في اللغة كلِّها — قالبٌ بلا تمييز.
  assert.strictEqual(K.generalizeLinePair('a=b', 'a=c'), null,
    'هيكلٌ من محرفين أنتج قالبًا');
  // وبمحرفٍ واحدٍ إضافي يصير له معنى — فالحدُّ حدُّ طولٍ لا رفضٌ شامل
  assert.ok(K.generalizeLinePair('a=b;', 'a=c;'), 'tripwire: الحدُّ يرفض كلَّ شيء');
});

// ═══ 4. المطابقة والتركيب ═════════════════════════════════════════════

test('[KN-10] الخانةُ المتكرّرة مرجعٌ خلفي — تساويها شرطٌ لا زينة', () => {
  // [VBR]: بلا مرجعٍ خلفي تُنتَج مجموعةُ التقاطٍ لكل ظهور، فيطابق القالب
  // سطورًا تختلف فيها مواضع الخانة الواحدة، وتكتب حلقةُ القيم فوق القيمة
  // فيبقى آخر ظهورٍ وحده ويُركَّب في الكل. المقيس:
  //   a.innerHTML = b.innerHTML + m  ⇒  b.textContent = b.textContent + m
  const pat = {
    beforeTemplate: '__LEARN_ID_1__.x = __LEARN_ID_1__.y;',
    beforeSlots: [{ id: 'ID_1', kind: 'identifier', value: 'a' }],
  };
  assert.deepStrictEqual(K.matchGeneralPattern('a.x = a.y;', pat), { values: { ID_1: 'a' } },
    'الموضعان متساويان ولم يُطابق');
  assert.strictEqual(K.matchGeneralPattern('a.x = b.y;', pat), null,
    'الموضعان مختلفان وطابَق ⇒ الخانةُ الواحدة صارت خانتين');
});

test('[KN-11] القالبُ مُرسًى بالطرفين — لا يطابق سطرًا يحتويه', () => {
  // قالبٌ غيرُ مُرسًى يطابق جزءًا من سطر، فيُستبدل الجزءُ ويُحتفظ بما حوله
  // بلا فهمٍ له — أو يُستبدل السطرُ كلُّه بقالبٍ لا يصفه.
  const pat = { beforeTemplate: 'f(__LEARN_STR_1__);',
                beforeSlots: [{ id: 'STR_1', kind: 'string', value: '"q"' }] };
  assert.deepStrictEqual(K.matchGeneralPattern('f("q");', pat), { values: { STR_1: '"q"' } });
  assert.strictEqual(K.matchGeneralPattern('z = f("q"); more();', pat), null,
    'طابَق سطرًا يحتوي القالب ⇒ الإرساءُ سقط');
});

test('[KN-12] قالبٌ يسمّي خانةً غير مُعلَنة يُرفض', () => {
  // beforeSlots هو إعلانُ الخانات؛ ورمزٌ لا إعلانَ له لا نوعَ له فلا
  // تعبيرَ التقاطٍ له. والقبولُ هنا يعني تركيبًا بقيمةٍ غير موجودة.
  assert.strictEqual(
    K.matchGeneralPattern('f("q");', { beforeTemplate: 'f(__LEARN_STR_9__);', beforeSlots: [] }),
    null, 'قالبٌ بخانةٍ غير مُعلَنة طابَق');
});

test('[KN-13] التركيبُ يُبقي الرمزَ عند غياب قيمته، ولا يُفرّغه', () => {
  // التفريغُ يُنتج سطرًا يُحلَّل نحويًا وينقص حجّةً — ضررٌ صامت يجتاز
  // فحصَ النحو. وإبقاءُ الرمز يُنتج معرّفًا غريبًا تُسقطه البوابة.
  assert.strictEqual(
    K.renderGeneralTemplate('a(__LEARN_ID_1__,__LEARN_ID_2__)', { ID_1: 'v' }),
    'a(v,__LEARN_ID_2__)', 'الخانةُ الناقصة لم تبقَ رمزًا');
  assert.strictEqual(K.renderGeneralTemplate('a(__LEARN_ID_1__)', { ID_1: 'v' }), 'a(v)');
});

// ═══ 5. البصمة وفرقُ LCS ══════════════════════════════════════════════

test('[KN-14] البصمةُ تُطبِّع المسافاتَ والحالة، ولا تُطبِّع النطاق', () => {
  // التطبيعُ هو ما يجعل بصمةَ سطرٍ واحدٍ واحدةً مهما تنسّق. وبلا تطبيع
  // يُخزَّن نفسُ النمط مرارًا بعددِ تنسيقاته، فلا يبلغ أيٌّ منها عتبةَ
  // الأدلة ويبقى التعلّمُ أبديَّ الانتظار.
  const a = K.makeFingerprint('s', 'js', 'const A = "x";', null);
  const b = K.makeFingerprint('s', 'js', '  CONST  A   =   "x";  ', null);
  assert.strictEqual(a, b, 'تنسيقان لنفس السطر أنتجا بصمتين');

  // والنطاقُ جزءٌ من الهوية: نفسُ السطر في دالتين مختلفتين نمطان.
  const inF = K.makeFingerprint('s', 'js', 'const A = "x";', { scope: 'function', functionName: 'f' });
  const inG = K.makeFingerprint('s', 'js', 'const A = "x";', { scope: 'function', functionName: 'g' });
  assert.notStrictEqual(inF, inG, 'النطاقُ لا يدخل البصمة');
});

test('[KN-15] كتلُ LCS تنفصل عند السطر المتساوي', () => {
  // الكتلةُ هي وَحدةُ "تغييرٍ واحد": extractPair تطلب الكتلةَ التي تحتوي
  // سطرَ البلاغ وتختار من مُضافاتها. فلو اندمجت الكتلُ عبر السطور
  // المتساوية صارت كلُّ مُضافات الملف مرشَّحاتٍ لكل بلاغ، فيُزوَّج سطرٌ
  // بإصلاح تغييرٍ آخر بعيدٍ عنه.
  const blocks = K.lcsBlocks(['a', 'X', 'c', 'Y', 'e'], ['a', 'x2', 'c', 'y2', 'e']);
  assert.strictEqual(blocks.length, 2, 'عددُ الكتل ' + blocks.length + ' — الاندماجُ وقع');
  assert.deepStrictEqual(blocks[0], { removed: [{ idx: 1, line: 'X' }], added: [{ idx: 1, line: 'x2' }] });
  assert.deepStrictEqual(blocks[1], { removed: [{ idx: 3, line: 'Y' }], added: [{ idx: 3, line: 'y2' }] });
});

test('[KN-16] المحذوفُ والمُضافُ كلاهما يُسجَّل في الكتلة', () => {
  const blocks = K.lcsBlocks(['keep', 'gone'], ['keep', 'fresh']);
  assert.strictEqual(blocks.length, 1);
  assert.deepStrictEqual(blocks[0].removed, [{ idx: 1, line: 'gone' }]);
  assert.deepStrictEqual(blocks[0].added,   [{ idx: 1, line: 'fresh' }]);
});

// ═══ 6. حدودُ الطبقة — التبعيةُ باتجاهٍ واحد ══════════════════════════

test('[KN-17] المحرّكُ لا يلمس المخزنَ مباشرةً بعد الفصل', () => {
  // العقدُ البنيوي للتقسيم: مفتاحُ التخزين ومالكُه واحد. فلو عاد المحرّك
  // ينادي localStorage بنفسه صار للمخزن مالكان، وضاع معنى الطبقات.
  const fs = require('node:fs');
  // التعليقاتُ تُسقَط: الشرحُ يذكر localStorage ليقول إنه ليس هنا، وحارسٌ
  // يسقط على نصّ شرحه حارسٌ يقيس الحبرَ لا الكود.
  const code = f => fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  const eng = code('learning_engine.js');
  assert.doesNotMatch(eng, /localStorage/, 'learning_engine.js يعود يلمس localStorage');
  assert.doesNotMatch(eng, /re_learned_patterns_v2/, 'مفتاحُ التخزين عاد إلى المحرّك');

  // وطبقةُ المعرفة لا تعرف العتبات: القبولُ والحظرُ شأنُ طبقة التحقّق.
  assert.doesNotMatch(code('learning_knowledge.js'), /MIN_CONFIDENCE|MIN_VERIFIED|BAN_AT/,
    'طبقةُ المعرفة تحمل عتبةَ قبول ⇒ القرارُ تشظّى على طبقتين');
});

test('[KN-18] سطحُ اعتماد المحرّك مُعلَنٌ بلا اسمٍ ميت', () => {
  // كتلةُ الأسماء المحليّة هي ما يُقرأ ليُعرف ما يأخذه المحرّك من الطبقتين.
  // فاسمٌ فيها بلا مُستدعٍ يُشهِر اعتمادًا غير قائم — وثمانيةٌ منها بقيت
  // بعد نقل الكتل (THRESHOLDS، calcConfidence، anchorTokens، assignTarget،
  // corresponds، pickCorresponding، lastTouch، lcsBlocks) وحُذفت. وهذا
  // الحارس يمنع تراكمها من جديد مع كل نقلٍ لاحق.
  const fs  = require('node:fs');
  const raw = fs.readFileSync(path.join(PUBLIC_DIR, 'learning_engine.js'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const lines = src.split('\n');

  const dead = [];
  lines.forEach((l, i) => {
    const m = /^  const (\w+)\s*=.*=>\s*_[VK]\(\)/.exec(l) ||
              /^  const (\w+)\s*=\s*new Proxy\(/.exec(l);
    if (!m) return;
    const name = m[1];
    const re = new RegExp('\\b' + name + '\\b');
    if (!lines.some((other, j) => j !== i && re.test(other))) dead.push(name);
  });
  assert.deepStrictEqual(dead, [],
    'أسماءٌ محليّة بلا مُستدعٍ في learning_engine.js: ' + dead.join(', '));

  // tripwire: الاستخراجُ يرى الكتلة فعلًا — وإلا خضر الحارسُ على فراغ
  const declared = lines.filter(l => /^  const \w+\s*=.*=>\s*_[VK]\(\)/.test(l)).length;
  assert.ok(declared >= 5, 'عددُ الأسماء المحليّة المقروءة ' + declared);
});
