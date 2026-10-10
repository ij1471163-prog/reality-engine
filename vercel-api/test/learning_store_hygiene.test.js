// ═══════════════════════════════════════════════════════
// [P3] نظافة المخزن: سقفٌ مرتَّب، وكتابةٌ لا تُفقد بصمت
// ═══════════════════════════════════════════════════════
//
// عيبان مقيسان، وكلاهما يضرب حلقة التغذية الراجعة التي أُغلقت في [P2]:
//
// (1) الفقد الصامت. save() كانت `try { setItem } catch(e) {}`. فعلى مخزن
//     يرفض الزيادة قِيس:  verify('p', false) ⇒ أرجعت 'p' (نجاحًا)
//     وfailures في المخزن بقي 0 ⇒ الحظر المستحق فُقد، والمنادي لا يعلم.
//     وكل ما بنته [P2] — تسجيل الفشل، الحظر عند 3، إسقاط الاعتماد —
//     يمرّ من هذه النقطة.
//
// (2) نموٌّ بلا سقف وحقلٌ معزول. القياس: نمطٌ متعلَّم واقعي ≈ 1,067 بايت
//     (أكبر 1,111B / أصغر 977B في تشغيل حقيقي)، أي أن حصّة 5MB تتسع
//     لـ4,915 نمطًا ثم ترفض الكتابة — فيتحوّل النمو إلى عيب (1).
//     وlastUsed كان يُكتب في markUsed ولا يُقرأ في موضع واحد: حقلٌ معزول.
//     فصار هو معيار الحماية من الإخلاء، أي أن الاستعمال المُقرّ من البوابة
//     هو ما يُبقي النمط.
//
// وحُذفت markResult: دالة فارغة مُصدَّرة بلا منادٍ في المستودع كلّه.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR  = path.join(__dirname, '..', 'public');
const STORAGE_KEY = 're_learned_patterns_v2';
const SRC = fs.readFileSync(path.join(PUBLIC_DIR, 'learning_engine.js'), 'utf8');

// السقف يُقرأ من الإنتاج لا يُفترض — فلا يخضر الاختبار على رقم آخر
const CAP = Number((SRC.match(/const MAX_PATTERNS\s*=\s*(\d+)/) || [])[1]);

// المحرّك يُحمَّل بسياقه الكامل لا وحده: isPairUsable تفشل مغلقةً بلا
// isBalanced وبلا acorn، فلو حُمّل learning_engine.js منفردًا لم يتعلّم شيئًا
// ولصار كل اختبارٍ يعتمد على learn() أخضرَ على فراغ. (قِيس: 0 أنماط في
// السياق المنفرد مقابل 1 في السياق الكامل، لنفس العيّنة.)
function loadEngine(opts) {
  const o = opts || {};
  const store = new Map();
  let rejected = 0;
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop, createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        const s = String(v);
        // محاكاة الحصّة على مفتاح التعلّم وحده: ترفض كل كتابة تتجاوز الحدّ،
        // كما يفعل المتصفح عند QuotaExceededError. وقصرُها على هذا المفتاح
        // يمنع إفشال محرّكات أخرى تكتب مفاتيحها وقت التحميل.
        if (k === STORAGE_KEY && typeof o.capBytes === 'number' &&
            Buffer.byteLength(s, 'utf8') > o.capBytes) {
          rejected++;
          const e = new Error('QuotaExceededError');
          e.name = 'QuotaExceededError';
          throw e;
        }
        store.set(k, s);
      },
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
  ctx.__store = store;
  ctx.__rejected = () => rejected;
  return ctx;
}

// عيّنة تعلّم مقيسة: md5 ⇒ sha256 بنوع CWE_327. تُرجع معرّفات ما تعلَّمه،
// وتُفشِل الاختبار إن لم يتعلّم شيئًا — فلا يمرّ اختبار سقفٍ على فراغ.
const L_BEFORE = 'function f(t){\n  var q = md5(t);\n  return q;\n}\n';
const L_AFTER  = 'function f(t){\n  var q = sha256(t);\n  return q;\n}\n';
function triggerLearn(ctx, expectStored) {
  ctx.__B = L_BEFORE; ctx.__A = L_AFTER;
  ctx.__I = [{ type: 'CWE_327', sev: 'h', line: 2 }]; ctx.__F = 'h.js';
  const ids = vm.runInContext('LearningEngine.learn(__B, __A, __I, __F)', ctx);
  assert.ok(ids.length >= 1, 'learn() لم تتعلّم شيئًا ⇒ اختبار السقف خاوٍ');
  if (expectStored !== false) {
    const have = readDb(ctx).patterns.some(x => ids.includes(x.id));
    assert.ok(have || expectStored === 'evicted', 'النمط المتعلَّم غير موجود ولا مُخلى');
  }
  return ids;
}

const readDb = ctx => JSON.parse(ctx.__store.get(STORAGE_KEY) || '{"patterns":[]}');
const seedRaw = (ctx, db) => ctx.__store.set(STORAGE_KEY, JSON.stringify(db));

// نمطٌ مُصغَّر — السقف يُختبر بالعدد لا بالحجم
function p(id, kind, touch) {
  const base = {
    id, type: 'T', language: 'js', before: 'a' + id, after: 'b' + id,
    fingerprint: 'fp-' + id, observed: 1, verified: 3, failures: 0,
    confidence: 0.7, approved: true, created: 1000, lastSeen: touch,
  };
  if (kind === 'pending') { base.approved = false; base.verified = 1; base.confidence = 0; }
  if (kind === 'banned')  { base.failures = 3; base.approved = false; }
  if (kind === 'used')    { base.lastUsed = touch; }
  return base;
}
const mk = (patterns, extra) => Object.assign({ patterns, safe: [], meta: { total: patterns.length } }, extra || {});

// ═══ 0. شروط العزل ═════════════════════════════════════

test('tripwire: المحرّك يُحمَّل ومخزنه حقيقي', () => {
  const ctx = loadEngine();
  seedRaw(ctx, mk([p('x', 'ok', 5)]));
  assert.strictEqual(ctx.LearningEngine.getStats().total, 1);
  ctx.__store.delete(STORAGE_KEY);
  assert.strictEqual(ctx.LearningEngine.getStats().total, 0, 'المخزن ليس حقيقيًّا');
});

test('tripwire: السقف مُعلَن في الإنتاج ورقمه معقول', () => {
  assert.ok(Number.isInteger(CAP) && CAP > 0, 'MAX_PATTERNS غير موجود في learning_engine.js');
  // القياس: ‎~1,067B/نمط‎ ⇒ حصّة 5MB تتسع لـ‎~4,915‎. السقف يجب أن يبقى
  // تحتها بهامش، وأن يكون أوسع من أي تشغيل واقعي واحد.
  assert.ok(CAP >= 200 && CAP <= 4000, `السقف ${CAP} خارج النطاق المدروس`);
  assert.strictEqual(ctxCap(), CAP, 'getStats لا يعرض السقف نفسه');
});
function ctxCap() { return loadEngine().LearningEngine.getStats().capacity; }

// ═══ 1. السقف يُطبَّق عند الإضافة ═══════════════════════

test('تحت السقف: لا إخلاء إطلاقًا', () => {
  const ctx = loadEngine();
  const ps = [];
  for (let i = 0; i < 25; i++) ps.push(p('k' + i, 'ok', 2000 + i));
  seedRaw(ctx, mk(ps));
  triggerLearn(ctx);
  const db = readDb(ctx);
  assert.ok(db.patterns.length >= 25, `أُخلي نمط تحت السقف: ${db.patterns.length}`);
  assert.strictEqual((db.meta && db.meta.evicted) || 0, 0, 'عدّاد الإخلاء تحرّك تحت السقف');
});

test('فوق السقف: الحجم يعود إلى السقف بالضبط عند أول تعلّم', () => {
  const ctx = loadEngine();
  const ps = [];
  for (let i = 0; i < CAP + 7; i++) ps.push(p('k' + i, 'pending', 2000 + i));
  seedRaw(ctx, mk(ps));
  triggerLearn(ctx, 'evicted');
  const db = readDb(ctx);
  assert.strictEqual(db.patterns.length, CAP, `الحجم ${db.patterns.length} والسقف ${CAP}`);
  assert.ok(db.meta.evicted >= 7, `عدّاد الإخلاء ${db.meta.evicted}`);
});

// ═══ 2. ترتيب الإخلاء بالقيمة ثم بالاستعمال ════════════

test('الرتب: قيد جمع الأدلة يُخلى أولاً، ثم المحظور، والمعتمد يبقى', () => {
  const ctx = loadEngine();
  // فائض 3 ⇒ يُخلى ثلاثة: المرشَّحون بالرتبة هم pending (3) ثم banned (3)
  const ps = [];
  for (let i = 0; i < CAP - 6; i++) ps.push(p('ok' + i, 'ok', 9000 + i));
  for (let i = 0; i < 3; i++) ps.push(p('pend' + i, 'pending', 1000 + i));
  for (let i = 0; i < 3; i++) ps.push(p('ban' + i, 'banned', 1100 + i));
  for (let i = 0; i < 3; i++) ps.push(p('live' + i, 'used', 9500 + i));
  seedRaw(ctx, mk(ps));
  triggerLearn(ctx, 'evicted');
  const ids = new Set(readDb(ctx).patterns.map(x => x.id));
  for (let i = 0; i < 3; i++) {
    assert.ok(!ids.has('pend' + i), `pend${i} باقٍ — الرتبة الأقل قيمة لم تُخلَ أولاً`);
    assert.ok(ids.has('ban' + i),  `ban${i} أُخلي قبل استنفاد الرتبة 0 — شاهد القبر يُفقد مبكرًا`);
    assert.ok(ids.has('live' + i), `live${i} أُخلي — قدرة إصلاح قائمة فُقدت`);
  }
});

// ملاحظة على حساب الفائض في اختباري LRU أدناه: النمط الذي يُنشئه learn()
// نفسه رتبته 0 (قيد جمع الأدلة)، فهو أوّل من يُخلى متى خلت الرتبة 0. ولإظهار
// الترتيب داخل رتبة المعتمدين نحتاج فائضًا يتجاوز الرتبة 0 كلها: مخزنٌ من
// CAP+1 معتمدًا، ثم تعلُّمٌ واحد ⇒ فائض 2 ⇒ يُخلى الجديد (رتبة 0) ومعه أقدم
// معتمدٍ لمسًا. وهذا هو الأثر الذي يمنع «تجميد التعلّم» من أن يمرّ صامتًا:
// مخزنٌ ممتلئ بالمعتمدين يُسقط ما يُتعلَّم حتى تُعتمد خبرته — حدٌّ معلن أدناه.

test('LRU: lastUsed يحمي النمط، والأقدم لمسًا هو من يُخلى', () => {
  const ctx = loadEngine();
  const ps = [];
  for (let i = 0; i < CAP - 1; i++) ps.push(p('ok' + i, 'used', 9000 + i));
  // متكافئان في الرتبة (معتمدان) ويختلفان في آخر لمسة فقط
  ps.push(Object.assign(p('stale', 'ok', 100), { lastUsed: 100 }));
  ps.push(Object.assign(p('fresh', 'ok', 100), { lastUsed: 8999999 }));
  seedRaw(ctx, mk(ps));
  triggerLearn(ctx, 'evicted');
  const db = readDb(ctx);
  const ids = new Set(db.patterns.map(x => x.id));
  assert.strictEqual(db.patterns.length, CAP, `الحجم ${db.patterns.length} والسقف ${CAP}`);
  assert.ok(ids.has('fresh'), 'النمط المستعمل حديثًا أُخلي ⇒ lastUsed لا يُقرأ');
  assert.ok(!ids.has('stale'), 'النمط المهمل باقٍ ⇒ الترتيب ليس LRU');
});

test('markUsed ⇒ الحماية: نمطٌ سجّلته البوابة ينجو من إخلاءٍ كان يأخذه', () => {
  const ctx = loadEngine();
  const ps = [];
  for (let i = 0; i < CAP - 1; i++) ps.push(p('ok' + i, 'used', 9000 + i));
  ps.push(p('a', 'ok', 100));   // كلاهما بلا lastUsed وبنفس القِدم
  ps.push(p('b', 'ok', 100));
  seedRaw(ctx, mk(ps));
  // البوابة قبلت استعمال b ⇒ markUsed تكتب lastUsed=الآن
  assert.strictEqual(ctx.LearningEngine.markUsed(['b']), 1, 'markUsed لم تسجّل');
  triggerLearn(ctx, 'evicted');
  const ids = new Set(readDb(ctx).patterns.map(x => x.id));
  assert.ok(ids.has('b'), 'المسجَّل استعماله أُخلي ⇒ الدفتر بلا أثر');
  assert.ok(!ids.has('a'), 'غير المستعمل باقٍ ⇒ الترتيب لم يستعمل الدفتر');
});

test('حدّ معلن: مخزنٌ ممتلئ بالمعتمدين يُسقط النمط المُتعلَّم حالاً', () => {
  // أثرٌ مباشر لترتيب القيمة: ما لم يبلغ الاعتماد لا يزيح قدرةً قائمة. فمخزنٌ
  // كله معتمد ⇒ التعلّم الجديد يُسجَّل ثم يُخلى في النداء نفسه. والمقابل
  // (إزاحة معتمدٍ لإدخال خبرة غير مُثبتة) أسوأ، فهذا حدٌّ مقصود لا عيب.
  const ctx = loadEngine();
  const ps = [];
  for (let i = 0; i < CAP; i++) ps.push(p('ok' + i, 'used', 9000 + i));
  seedRaw(ctx, mk(ps));
  const ids = triggerLearn(ctx, 'evicted');
  const db = readDb(ctx);
  assert.strictEqual(db.patterns.length, CAP, 'السقف تُجوِّز');
  assert.ok(ids.length >= 1, 'لم يُتعلَّم شيء ⇒ التغطية خاوية');
  assert.ok(!db.patterns.some(x => ids.includes(x.id)),
    'تغيّر السلوك: الجديد بقي ومعتمدٌ أُزيح — راجع ترتيب القيمة');
});

// ═══ 3. لا فقد صامت ════════════════════════════════════

test('مخزن يرفض الكتابة: verify تُرجع null لا معرّفًا', () => {
  const seed = JSON.stringify(mk([p('p1', 'ok', 5)]));
  const ctx = loadEngine({ capBytes: Buffer.byteLength(seed, 'utf8') });
  ctx.__store.set(STORAGE_KEY, seed);     // البذرة تتجاوز الغلاف
  const ret = ctx.LearningEngine.verify('p1', false);
  assert.strictEqual(ret, null, `verify أعلنت النجاح (${JSON.stringify(ret)}) والكتابة مرفوضة`);
  assert.ok(ctx.__rejected() >= 1, 'لم تُرفَض أي كتابة ⇒ التغطية خاوية');
  assert.strictEqual(readDb(ctx).patterns[0].failures, 0, 'المخزن تغيّر رغم الرفض');
});

test('مخزن يرفض الكتابة: markUsed تُرجع 0 لا عددًا موهومًا', () => {
  const seed = JSON.stringify(mk([p('p1', 'ok', 5)]));
  const ctx = loadEngine({ capBytes: Buffer.byteLength(seed, 'utf8') });
  ctx.__store.set(STORAGE_KEY, seed);
  assert.strictEqual(ctx.LearningEngine.markUsed(['p1']), 0,
    'markUsed أعلنت تسجيلاً لم يُحفَظ ⇒ نمطٌ مستعمل يُعَدّ مهملاً عند الإخلاء');
});

test('getStats تعرض عدّاد الكتابات المفقودة في الجلسة', () => {
  const seed = JSON.stringify(mk([p('p1', 'ok', 5)]));
  const ctx = loadEngine({ capBytes: Buffer.byteLength(seed, 'utf8') });
  ctx.__store.set(STORAGE_KEY, seed);
  assert.strictEqual(ctx.LearningEngine.getStats().saveFailures, 0, 'العدّاد ليس صفرًا ابتداءً');
  ctx.LearningEngine.verify('p1', false);
  assert.ok(ctx.LearningEngine.getStats().saveFailures >= 1,
    'الفقد لا يظهر في أي مكان ⇒ عاد صامتًا');
});

test('إنعاش: الحصّة الممتلئة ⇒ إخلاء النصف الأقل قيمة ثم الكتابة تصل', () => {
  // مخزنٌ من 40 نمطًا، والحدّ يسمح بأقل من نصف حجمه ⇒ المحاولة الأولى تُرفَض،
  // والنصف الأدنى قيمةً يُخلى، والثانية تنجح. الدليل: الحظر وصل فعلاً.
  const ps = [];
  for (let i = 0; i < 39; i++) ps.push(p('pend' + i, 'pending', 1000 + i));
  ps.push(p('target', 'ok', 9999));
  const full = JSON.stringify(mk(ps));
  const cap = Math.floor(Buffer.byteLength(full, 'utf8') * 0.55);
  const ctx = loadEngine({ capBytes: cap });
  ctx.__store.set(STORAGE_KEY, full);
  const ret = ctx.LearningEngine.verify('target', false);
  assert.strictEqual(ret, 'target', 'الإنعاش لم ينجح — الحكم فُقد');
  const db = readDb(ctx);
  assert.ok(db.patterns.length < 40, `لم يُخلَ شيء: ${db.patterns.length}`);
  const t = db.patterns.find(x => x.id === 'target');
  assert.ok(t, 'الهدف نفسه أُخلي');
  assert.strictEqual(t.failures, 1, 'الفشل لم يُكتب رغم نجاح الإنعاش');
  assert.strictEqual(ctx.LearningEngine.getStats().saveFailures, 0,
    'عُدّ فقدٌ ولم يحدث — الإنعاش نجح');
});

test('حدّ معلن: رفضٌ لا ينفع معه الإخلاء ⇒ فقدٌ معلَن لا صامت', () => {
  // حدّ أصغر من أي مخزن ⇒ لا إخلاء يُنجيه. المطلوب: إعلان لا ادّعاء.
  const seed = JSON.stringify(mk([p('p1', 'ok', 5), p('p2', 'pending', 6)]));
  const ctx = loadEngine({ capBytes: 10 });
  ctx.__store.set(STORAGE_KEY, seed);
  assert.strictEqual(ctx.LearningEngine.verify('p1', false), null);
  assert.ok(ctx.__rejected() >= 2, 'لم تُجرَّب إعادة الكتابة بعد الإخلاء');
  assert.ok(ctx.LearningEngine.getStats().saveFailures >= 1, 'الفقد لم يُعلَن');
});

// ═══ 4. السطح المُصدَّر وقراءة القدرة ══════════════════

test('markResult حُذفت: لا تُصدَّر ولا ينادیها أي كود إنتاج', () => {
  const ctx = loadEngine();
  assert.strictEqual(typeof ctx.LearningEngine.markResult, 'undefined',
    'الدالة الفارغة ما زالت مُصدَّرة');
  const files = fs.readdirSync(PUBLIC_DIR).filter(f => f.endsWith('.js'));
  const offenders = files.filter(f =>
    /\bmarkResult\s*\(/.test(fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8')));
  assert.deepStrictEqual(offenders, [], 'منادٍ باقٍ لـmarkResult: ' + offenders.join(','));
});

test('السطح الباقي كامل: ما ينادیه خط الأنابيب والصفحات مُصدَّر', () => {
  const ctx = loadEngine();
  for (const fn of ['learn', 'learnSafe', 'applyLearned', 'markUsed', 'verify', 'getStats', 'getBoosts', 'reset']) {
    assert.strictEqual(typeof ctx.LearningEngine[fn], 'function', `${fn} غير مُصدَّرة`);
  }
});

test('getStats: الحقول القديمة باقية والقدرة تُقرأ لا تُخمَّن', () => {
  const ctx = loadEngine();
  seedRaw(ctx, mk([
    p('a', 'ok', 5),
    p('b', 'banned', 5),
    p('c', 'pending', 5),
    Object.assign(p('d', 'ok', 5), { language: undefined }),
  ]));
  const s = ctx.LearningEngine.getStats();
  // عقد قائم يعتمده index.html — لا يُكسر
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.approved, 2, 'approved تغيّر معناه');
  assert.strictEqual(s.pending, 2, 'pending تغيّر معناه');
  assert.ok(Array.isArray(s.patterns) && s.patterns.length === 4, 'patterns عقدٌ مكسور');
  // إضافات [P3]: ما لا يمكن أن يُطبَّق يُعرَض صريحًا
  assert.strictEqual(s.banned, 1, 'المحظور لا يُعرَض');
  assert.strictEqual(s.langless, 1, 'بلا لغة لا يُعرَض — وهو خامد بعد بوابة اللغة');
  assert.strictEqual(s.inert, 2, 'inert لا يجمع المحظور وعديم اللغة');
  assert.strictEqual(s.capacity, CAP);
  assert.strictEqual(s.evicted, 0);
  assert.strictEqual(s.saveFailures, 0);
});
