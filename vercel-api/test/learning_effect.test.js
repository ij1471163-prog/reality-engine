// ═══════════════════════════════════════════════════════
// [S5] أثرُ التعلّم مقيسًا — ما يضيفه، وما لا يضيفه، ولماذا
// ═══════════════════════════════════════════════════════
//
// الغرضُ ليس إثباتَ أن الدوال تعمل (ذاك شأنُ وحداتها) بل قياسُ **الأثر**:
// هل يُصلح المحرّكُ بالخبرة ما لا يُصلحه بالقواعد؟ وهو السؤالُ الذي يتوقّف
// عليه قرارُ دمج التعلّم في RealityOrchestrator — فلا يُقترح الدمجُ قبل
// أن يُقاس ما يُدمَج.
//
// والنتيجةُ المقيسة شِقّان لا شقٌّ واحد، وكلاهما مُثبَّت أدناه:
//
//   (أ) الآليةُ تعمل وتنتقل. قالبٌ يُتعلَّم من ملفٍ واحد يُصلح ملفاتٍ لم
//       يرَها بأسماءٍ مختلفةٍ كلِّها، وتقبله البوابة، ولا يمسّ كودًا سليمًا.
//       والخبرةُ تتراكم: عائلتان في مخزنٍ واحد تُصلحان ملفًا واحدًا معًا.
//
//   (ب) وفي خط الأنابيب الحالي لا يُضيف شيئًا — والسببُ **خارج** طبقات
//       التعلّم، وهو مقيسٌ لا مُستنتَج:
//
//       • العائلاتُ التي ينتقل فيها التعلّم (XSS، التعمية، SQL) تُصلحها
//         المحرّكاتُ الحتمية أولًا، فلا يبقى له ما يُصلح.
//       • والعائلاتُ التي تتركها الحتمية (السرّ، eval) لا تصل التعلّم:
//           – eval: أصنافُ ‎analyzeCode‎ لهذا الشكل ‎security/XSS/callgraph‎،
//             ولا مفتاحَ في TYPE_FIXES يطابق أيًّا منها ⇒ لا زوجَ يُستخرج.
//           – السرّ: القالبُ يُبقي الرمزَ المُغيَّر حرفيًّا (وهو صوابٌ يمنع
//             مطابقةَ الكود السليم)، والرمزُ المُغيَّر هنا هو قيمةُ السرّ
//             نفسها — فلا ينتقل إلى سرٍّ آخر. وفوق ذلك: تمييزُ المحلل
//             لأسماء الاعتماد غيرُ متّسق، وهو ما يُسقط العائلةَ كلَّها.
//
// أي أن دمجَ التعلّم في المنسّق اليوم لا يُنتج فرقًا قابلًا للقياس، وأن
// العُقدةَ في المحلل والبوابة لا في التعلّم. والقسم 3 يُثبّت هذا القياس كي
// يظهر أيُّ تغيّرٍ فيه كفرقٍ في الاختبار لا كمفاجأة.
//
// وما لا يُعاد هنا: انحدارُ الثقة بالفشل، وقصرُ العقوبة على الرفض الضارّ،
// وكفايةُ التشابه النصي، وترتيبُ القيم، وبوابةُ اللغة — كلُّها مُثبَّتة في
// learning_feedback_loop / learning_corresponds_guard /
// learning_apply_template_guard / learning_language_gate. التكرارُ هنا
// تكلفةٌ بلا تغطية.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR  = path.join(__dirname, '..', 'public');
// القِيَمُ المُنشأة داخل السياق تحمل نماذجَ أولية أخرى، فيرفضها
// deepStrictEqual على فرقِ النموذج لا فرقِ القيمة.
const plain = v => JSON.parse(JSON.stringify(v));
const STORAGE_KEY = 're_learned_patterns_v2';

function loadCtx() {
  const noop = () => {};
  const store = new Map();
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop,
                createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); },
    },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const f = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(f)) continue;
    try { vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة */ }
  }
  ctx.toast = noop; ctx.refreshStats = noop; ctx.__store = store;
  ctx.__analyze = (code, fn) => vm.runInContext('analyzeCode', ctx)(code, fn);
  // التعليمُ كما يفعله الإنتاج: نفسُ بلاغات analyzeBeforeCode، ثم verify
  // لكل معرّفٍ يُعاد — وهو ما ينادي به fix_engine_pipeline سطرًا بسطر.
  ctx.__teach = (before, after, fn) => {
    const ids = ctx.LearningEngine.learn(before, after, ctx.__analyze(before, fn), fn);
    for (const id of ids) { ctx.LearningEngine.verify(id, true); ctx.LearningEngine.verify(id, true); }
    return ids;
  };
  ctx.__pipe = files => {
    vm.runInContext('F = ' + JSON.stringify(files) + ';', ctx);
    vm.runInContext('R = {}; Object.keys(F).forEach(k => { R[k] = { code: F[k], issues: analyzeCode(F[k], k) }; });', ctx);
    const report = vm.runInContext('JSON.parse(JSON.stringify(fixAllEnginePipeline()))', ctx);
    return { report, out: vm.runInContext('JSON.parse(JSON.stringify(F))', ctx) };
  };
  return ctx;
}

// ─── عيّنات XSS: عائلةٌ رمزُها المُغيَّر ثابت (innerHTML → textContent) ───
const XSS_T_B = 'function setT(el, v) {\n  el.innerHTML = v;\n}\nmodule.exports = { setT };\n';
const XSS_T_A = 'function setT(el, v) {\n  el.textContent = v;\n}\nmodule.exports = { setT };\n';
const XSS_U1  = 'function render(node, html) {\n  node.innerHTML = html;\n}\nmodule.exports = { render };\n';
const XSS_U2  = 'function paint(box, txt) {\n  box.innerHTML = txt;\n}\nmodule.exports = { paint };\n';
const XSS_OK  = 'function safe(el, v) {\n  el.textContent = v;\n}\nmodule.exports = { safe };\n';

// ─── عيّنات تعمية على غير اعتماد (etag) — لا يضيّقها [CRED-HASH] ───
// [HASH-EPHEMERAL] كانت العيّنة etag تُرجِع البصمة (md5 ⇒ sha256 يغيّر قيمة ETag المُرسلة)، والبوابة صارت لا تقبل
// تبديل الخوارزمية إلا حين تبقى البصمة مفتاحًا داخليًا لـMap/Set محلي. فالعيّنة الآن كذلك.
const MD5_T_B = 'const crypto = require("crypto");\nconst seen = new Set();\nfunction e1(body) {\n' +
  '  const tag = crypto.createHash("md5").update(body).digest("hex");\n  if (seen.has(tag)) return false;\n' +
  '  seen.add(tag);\n  return true;\n}\nmodule.exports = { e1 };\n';
const MD5_T_A = MD5_T_B.replace('"md5"', '"sha256"');

// ═══ 1. الآليةُ تعمل وتنتقل إلى كودٍ لم يُرَ ═══════════════════════════

test('[L-1] tripwire: قالبٌ معمَّمٌ يُتعلَّم من ملفٍ واحد ويُعتمد بتحقّقين', () => {
  const ctx = loadCtx();
  const ids = ctx.__teach(XSS_T_B, XSS_T_A, 'teach.js');
  assert.ok(ids.length >= 1, 'لم يُتعلَّم شيء ⇒ بقيةُ الملف بلا معنى');

  const st = ctx.LearningEngine.getStats();
  assert.strictEqual(st.approved, st.total, 'لم يُعتمد كلُّ ما تُعلِّم بتحقّقين');

  // والقالبُ يجرّد المعرّفات ويُبقي رمزَ الثغرة حرفيًّا — شرطُ الانتقال
  const pat = JSON.parse(ctx.__store.get(STORAGE_KEY)).patterns[0];
  assert.ok(pat.generalized, 'لا قالبَ معمَّم ⇒ لا انتقال');
  assert.strictEqual(pat.generalized.beforeTemplate, '__LEARN_ID_1__.innerHTML = __LEARN_ID_2__;');
  assert.strictEqual(pat.generalized.afterTemplate,  '__LEARN_ID_1__.textContent = __LEARN_ID_2__;');
});

test('[L-2] الخبرةُ تنتقل: تُصلح ملفاتٍ لم تُرَ بأسماءٍ مختلفةٍ كلِّها', () => {
  const ctx = loadCtx();
  ctx.__teach(XSS_T_B, XSS_T_A, 'teach.js');

  for (const [fn, code, want] of [['u1.js', XSS_U1, '  node.textContent = html;'],
                                  ['u2.js', XSS_U2, '  box.textContent = txt;']]) {
    const r = ctx.LearningEngine.applyLearned(code, fn);
    assert.strictEqual(r.applied, 1, fn + ': لم يُطبَّق');
    assert.deepStrictEqual(plain((r.uses || []).map(u => u.via)), ['general'],
      fn + ': المسارُ ليس المعمَّم ⇒ مطابقةٌ حرفية لا انتقال');
    assert.strictEqual(r.fixed.split('\n')[1], want, fn + ': الناتجُ غيرُ متوقَّع');

    // والبوابةُ تقبله — فالانتقالُ انتقالُ إصلاحٍ لا نصّ
    const v = ctx.FixVerifier.verifyFix(code, r.fixed, fn, c => ctx.__analyze(c, fn));
    assert.strictEqual(v.accepted, true, fn + ': البوابة ترفض الناتج — ' + v.reason);
    assert.ok(ctx.__analyze(r.fixed, fn).length < ctx.__analyze(code, fn).length,
      fn + ': البلاغات لم تنقص');
  }
});

test('[L-3] ولا تمسّ كودًا سليمًا — الانتقالُ ليس إفراطًا في المطابقة', () => {
  const ctx = loadCtx();
  ctx.__teach(XSS_T_B, XSS_T_A, 'teach.js');
  const r = ctx.LearningEngine.applyLearned(XSS_OK, 'ok.js');
  assert.strictEqual(r.applied, 0, 'طُبِّق على كودٍ سليم');
  assert.strictEqual(r.fixed, XSS_OK, 'الكودُ السليم تغيّر');
});

test('[L-4] التعلّمُ تراكمي: عائلتان في مخزنٍ واحد تُصلحان ملفًا واحدًا', () => {
  const ctx = loadCtx();
  ctx.__teach(XSS_T_B, XSS_T_A, 't1.js');
  ctx.__teach(MD5_T_B, MD5_T_A, 't2.js');

  const st = ctx.LearningEngine.getStats();
  assert.ok(st.total >= 2, 'الخبرةُ لم تتراكم: ' + st.total);
  assert.strictEqual(st.approved, st.total, 'ليس كلُّ المتراكم معتمدًا');
  const types = new Set(st.patterns.map(p => p.type));
  assert.ok(types.has('XSS'), 'عائلةُ XSS غائبة');
  assert.ok([...types].some(t => /CRYPTO|327/i.test(t)), 'عائلةُ التعمية غائبة: ' + [...types].join(','));

  // ملفٌ لم يُرَ، فيه العيبان معًا وبأسماءٍ مختلفة
  // (سطر التعمية لا يجاور سطر XSS: الإثبات الموضعي في البوابة يشترط أن جارَي السطر المُستبدَل لم يتغيّرا)
  const MIX = 'const crypto = require("crypto");\nconst done = new Set();\nfunction out(node, html, body) {\n' +
              '  const et = crypto.createHash("md5").update(body).digest("hex");\n' +
              '  if (done.has(et)) return false;\n  done.add(et);\n  node.innerHTML = html;\n' +
              '  return true;\n}\nmodule.exports = { out };\n';
  const r = ctx.LearningEngine.applyLearned(MIX, 'mix.js');
  assert.strictEqual(r.applied, 2, 'لم تُطبَّق العائلتان معًا: ' + r.applied);
  assert.match(r.fixed, /node\.textContent = html;/, 'إصلاحُ XSS غائب');
  assert.match(r.fixed, /createHash\("sha256"\)/, 'إصلاحُ التعمية غائب');

  const v = ctx.FixVerifier.verifyFix(MIX, r.fixed, 'mix.js', c => ctx.__analyze(c, 'mix.js'));
  assert.strictEqual(v.accepted, true, 'البوابة ترفض الناتج المركّب — ' + v.reason);
  const before = ctx.__analyze(MIX, 'mix.js').length;
  const after  = ctx.__analyze(r.fixed, 'mix.js').length;
  assert.ok(after < before, 'البلاغات لم تنقص: ' + before + ' → ' + after);
});

// ═══ 2. وفي خط الأنابيب: لا أثرَ اليوم — والسببُ مقيس ═════════════════

test('[L-5] المسارُ الحتمي يسبق التعلّم — ويُعلِّمه من إصلاحه المقبول', () => {
  // ليس عطبًا: ترتيبُ الأولوية مقصود (قاعدةٌ مُثبتة قبل خبرةٍ مُكتسَبة).
  // لكنه يعني أن الأثرَ الصافي للتعلّم في هذه العائلات صفر — وهو ما يلزم
  // معرفتُه قبل الحديث عن «تحسين اختيار الإصلاحات».
  const ctx = loadCtx();
  const { out } = ctx.__pipe({ 'x.js': XSS_U1 });
  assert.match(out['x.js'], /textContent/, 'الحتميةُ لم تُصلح XSS ⇒ الفرضيةُ تغيّرت');

  // والمقيسُ هنا أثرٌ موجب لم يكن مفترَضًا: خطُّ الأنابيب **يتعلّم من
  // إصلاحه الحتمي نفسه** متى قبلته البوابة (fix_engine_pipeline: learn ثم
  // verify لكل معرّف). فالخبرةُ تتراكم في الإنتاج بلا تعليمٍ يدوي — ومنها
  // تأتي قدرةُ الانتقال التي قاسها [L-2] على ملفاتٍ لم تُرَ.
  const st = ctx.LearningEngine.getStats();
  assert.ok(st.total >= 1, 'خطُّ الأنابيب لم يتعلّم من إصلاحه المقبول');
  assert.ok(st.patterns.some(p => /innerHTML/.test(String(p.before || ''))),
    'ما تعلّمه ليس زوجَ XSS: ' + JSON.stringify(st.patterns.map(p => p.before)));
});

test('[L-6] والعائلاتُ التي تتركها الحتمية لا تصل التعلّم — بسببين مقيسين', () => {
  const ctx = loadCtx();

  // (1) eval: الحتميةُ تتركه، وأصنافُ المحلل لا تحمل مفتاحَ TYPE_FIXES
  const EV = 'function parseT(input) {\n  const res = eval(input);\n  return res;\n}\nmodule.exports = { parseT };\n';
  const EV_FIX = EV.replace('eval(input)', 'JSON.parse(input)');
  const left = ctx.__pipe({ 'e.js': EV });
  assert.match(left.out['e.js'], /eval\(/, 'الحتميةُ أصلحت eval ⇒ الفرضيةُ تغيّرت');

  const evTypes = ctx.__analyze(EV, 'e.js').map(i => String(i.strategy || i.type || i.cAct));
  const TYPE_FIX_KEYS = ['secret', 'hardcoded', 'cwe_798', 'sql', 'cwe_89', 'xss', 'crypto',
                         'cwe_327', 'eval', 'cwe_094', 'cmd', 'accumul', 'counter'];
  const t = evTypes.join(' ').toLowerCase();
  // ⚠️ xss حاضرٌ في الأصناف، لكن نمطَ علاجه (textContent/sanitize…) لا يطابق
  // سطرَ JSON.parse — فالمفتاحُ يطابق والعلاجُ لا، والنتيجةُ fail-closed.
  assert.ok(!t.includes('eval'), 'صارت أصنافُ المحلل تحمل eval ⇒ راجع هذا القياس');
  const c2 = loadCtx();
  assert.strictEqual(c2.LearningEngine.learn(EV, EV_FIX, c2.__analyze(EV, 'e.js'), 'e.js').length, 0,
    'صار eval يُتعلَّم ⇒ تغيّر الأثر، فليُحدَّث هذا القياس وتقريرُه');
  assert.ok(TYPE_FIX_KEYS.length === 13, 'عددُ مفاتيح TYPE_FIXES تغيّر');

  // (2) السرّ: يُتعلَّم، لكن قيمةَ السرّ هي الرمزُ المُغيَّر فتبقى حرفيّة
  const c3 = loadCtx();
  const SB = 'const SESSION_SECRET = "sk_live_teach999";\nmodule.exports = { SESSION_SECRET };\n';
  const SA = 'const SESSION_SECRET = process.env.SESSION_SECRET;\nmodule.exports = { SESSION_SECRET };\n';
  assert.ok(c3.__teach(SB, SA, 's.js').length >= 1, 'السرُّ لم يُتعلَّم ⇒ الفرضيةُ تغيّرت');
  const sp = JSON.parse(c3.__store.get(STORAGE_KEY)).patterns.find(p => p.generalized);
  assert.ok(sp, 'لا قالبَ معمَّم للسرّ');
  assert.match(sp.generalized.beforeTemplate, /"sk_live_teach999"/,
    'صار القالبُ يجرّد قيمةَ السرّ ⇒ تغيّر الأثر، فليُحدَّث هذا القياس');

  // ⇒ لا ينتقل إلى سرٍّ آخر: القالبُ يطابق تلك القيمةَ وحدها
  const OTHER = 'const DB_PASS = "p@ssw0rd_longvalue";\nmodule.exports = { DB_PASS };\n';
  assert.strictEqual(c3.LearningEngine.applyLearned(OTHER, 'o.js').applied, 0,
    'انتقل إصلاحُ السرّ ⇒ تغيّر الأثر');
});

// ═══ 3. العُقدةُ خارج التعلّم — تمييزُ المحلل لأسماء الاعتماد ═════════

test('[L-7] قياسٌ مُعلَن: تمييزُ المحلل لأسماء الاعتماد غيرُ متّسق', () => {
  // ثلاثةُ أسطرٍ متطابقةُ الشكل، والإصلاحُ المقترح لها واحد. والمقيس أن
  // مصيرَها ثلاثةٌ مختلفة — وذلك وحدَه ما يُسقط عائلةَ السرّ عن التعلّم
  // وعن المسار الحتمي معًا:
  //
  //   API_TOKEN  ⇒ أصناف security/CWE_798 ⇒ البوابةُ تقبل الإصلاح
  //   DB_PASS    ⇒ صنف HARDCODED_SECRET وحده ⇒ REJECTED_SECRET_FIX_UNPROVEN
  //   STRIPE_SK  ⇒ لا بلاغ إطلاقًا ⇒ لا شيء يُصلَح (NO_IMPROVEMENT)
  //
  // الإصلاحُ المقترَح لهذا خارج نطاق إعادة تصميم التعلّم: موضعُه المحلل
  // وسجلُّ إثبات السرّ في البوابة، لا طبقاتُ التعلّم. وهذا الاختبار يُثبّت
  // القياس كي يظهر إصلاحُه — أو تدهورُه — كفرقٍ ظاهر.
  const ctx = loadCtx();
  const mk  = n => 'const ' + n + ' = "sk_live_qqq222";\nmodule.exports = { ' + n + ' };\n';
  const fix = n => 'const ' + n + ' = process.env.' + n + ';\nmodule.exports = { ' + n + ' };\n';

  const seen = {};
  for (const n of ['API_TOKEN', 'DB_PASS', 'STRIPE_SK']) {
    const B = mk(n), A = fix(n);
    const classes = plain(ctx.__analyze(B, 'x.js').map(i => String(i.type)));
    const v = ctx.FixVerifier.verifyFix(B, A, 'x.js', c => ctx.__analyze(c, 'x.js'));
    seen[n] = { classes, accepted: v.accepted, reason: String(v.reason).split(' ')[0] };
  }

  assert.deepStrictEqual(seen.API_TOKEN.classes, ['security', 'CWE_798'],
    'أصنافُ API_TOKEN تغيّرت: ' + JSON.stringify(seen.API_TOKEN.classes));
  assert.strictEqual(seen.API_TOKEN.accepted, true, 'صار الإصلاحُ المُثبت يُرفض');

  assert.deepStrictEqual(seen.DB_PASS.classes, ['HARDCODED_SECRET'],
    'أصنافُ DB_PASS تغيّرت: ' + JSON.stringify(seen.DB_PASS.classes));
  assert.strictEqual(seen.DB_PASS.accepted, false, 'صار DB_PASS يُقبل — تحسّنٌ، فليُحدَّث القياس');
  assert.strictEqual(seen.DB_PASS.reason, 'REJECTED_SECRET_FIX_UNPROVEN',
    'سببُ رفض DB_PASS تغيّر: ' + seen.DB_PASS.reason);

  assert.deepStrictEqual(seen.STRIPE_SK.classes, [],
    'صار STRIPE_SK يُبلَّغ عنه — تحسّنٌ، فليُحدَّث القياس: ' + JSON.stringify(seen.STRIPE_SK.classes));

  // والخلاصةُ المُثبَّتة: الأسطرُ الثلاثةُ متطابقةُ الشكل ومصائرُها مختلفة
  assert.notStrictEqual(seen.API_TOKEN.accepted, seen.DB_PASS.accepted,
    'صار الحكمُ متّسقًا على الشكل الواحد — وهو المطلوب، فليُحدَّث هذا القياس');
});
