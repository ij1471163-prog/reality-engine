// ═══════════════════════════════════════════════════════
// learning_engine.js — تراكم الدليل على القالب المعمَّم [C1]
// تشغيل:  node --test vercel-api/test/learning_evidence_merge.test.js
//
// الخلل المُستهدَف (مقيس في تشخيص Δ = 0):
//   هوية السجل كانت بصمةَ (النوع|اللغة|السطر الحرفي|النطاق:اسم الدالة)،
//   بينما التطبيق يجري بقالب يجرّد المعرّفات والنصوص. فمفتاح الهوية أضيق
//   من مفتاح المطابقة، ويترتّب عليه:
//     • سطر متطابق حرفيًا في دالتين مختلفتي الاسم ⇒ سجلّان observed=1
//     • ثلاثة ملفات يختلف فيها اسم المتغيّر وحده ⇒ ثلاثة سجلات
//   والاعتماد يشترط verified ≥ 2، أي تكرارًا نصيًّا؛ والفائدة تشترط تنوّعًا
//   نصيًّا. شرطان متعارضان ⇒ لا نمط معمَّم يبلغ الاعتماد أبدًا.
//
// والإصلاح: المفتاح — عند وجود قالب صالح — هو (beforeTemplate, afterTemplate)
// مع النوع واللغة. وبلا قالب تبقى البصمة، فالمطابقة الحرفية بلا تغيير.
//
// ⚠️ هذا إصلاح **صحة عدّ الدليل**، لا تحسينًا مقيسًا للنتائج. القياسات
// المعزولة أعطت Δ = 0 على الملفات المحجوبة قبله وبعده، والسبب موثَّق هناك:
// حيث يستطيع التعلّم أن يطلق يكون محرك آخر قد غطّى السطر (استبدال لا إضافة)،
// وحيث يوجد طلب حقيقي لا يوجد عرض يُتعلَّم منه أصلاً.
//
// ─── ما يثبّته هذا الملف ────────────────────────────────
//   القسم 1  تراكم الدليل: حالات مختلفة نصيًا بنفس القالب ⇒ سجل واحد يُعتمد.
//   القسم 2  حدود الدمج: النوع واللغة واتجاه التحويل — لا يُدمَج غير المتكافئ.
//            ومع كل حدّ اختبار «فاعل» حيث أمكن: نسخة في الذاكرة بشرط أضعف
//            تدمج فعلاً، فالشرط ليس زائدًا.
//   القسم 3  لا تضخيم للدليل: بلاغان على السطر نفسه لا يرفعان verified مرتين.
//   القسم 4  العتبات والمخزن: العتبات كما هي، والمطابقة الحرفية بلا تغيير،
//            والسجلات القديمة لا تُمسّ.
//
// العزل: localStorage مخزن حقيقي في الذاكرة لكل سياق، ولا يُمَسّ أي مخزن
// حقيقي ولا ملف. وverify() يُنادى هنا كما ينادِيه خط الأنابيب بالضبط:
// مرة لكل معرّف يُعيده learn().
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR  = path.join(__dirname, '..', 'public');
const LE_PATH     = path.join(PUBLIC_DIR, 'learning_engine.js');
const LE_HEAD     = fs.readFileSync(LE_PATH, 'utf8');
const STORAGE_KEY = 're_learned_patterns_v2';

// شرط اتجاه التحويل كما هو في الملف المُسلَّم. نسخة بإضعافه — تطابق قالب
// «قبل» وحده — تُثبت أنه هو من يفصل الاتجاهين، بنفس انضباط GATE_LINE.
const DIR_LINE = `          ? (p.generalized.beforeTemplate === gen.beforeTemplate &&
             p.generalized.afterTemplate  === gen.afterTemplate)`;
const LE_WEAK_DIR = LE_HEAD.replace(DIR_LINE,
  '          ? (p.generalized.beforeTemplate === gen.beforeTemplate)');

// وشرط اللغة؛ نسخة بإسقاطه تُثبت أنه هو من يفصل اللغتين.
const LANG_LINE = '        p.language === lang &&';
const LE_NO_LANG = LE_HEAD.replace(LANG_LINE, '        true &&');

function loadCtx(learningEngineSrc) {
  const noop = () => {};
  const store = new Map();
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop, createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
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
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    if (m[1] === 'learning_engine.js' && learningEngineSrc) {
      vm.runInContext(learningEngineSrc, ctx, { filename: m[1] });
      continue;
    }
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة فقط */ }
  }
  ctx.toast = noop;
  ctx.refreshStats = noop;
  ctx.__store = store;
  return ctx;
}

const patternsOf = ctx => {
  const raw = ctx.__store.get(STORAGE_KEY);
  return raw ? (JSON.parse(raw).patterns || []) : [];
};

// يتعلّم زوجًا ثم يتحقّق منه **كما يفعل خط الأنابيب بالضبط**:
// verify(id, true) مرة واحدة لكل معرّف يُعيده learn().
function learnLikePipeline(ctx, before, after, fileName, issuesOverride) {
  const issues = issuesOverride || ctx.analyzeCode(before, fileName);
  const ids = Array.from(ctx.LearningEngine.learn(before, after, issues, fileName) || []);
  ids.forEach(id => ctx.LearningEngine.verify(id, true));
  return ids;
}

// ─── أزواج ثابتة ────────────────────────────────────────
// ثلاثة سطور SQL مختلفة نصيًا (مستقبِل ودالة ومتغيّر) تُنتج القالب نفسه.
const SQL = [
  { f: 'q1.js', b: 'function fetchRow(uid) {\n  conn.exec("SELECT * FROM u WHERE x=" + uid);\n}\n',
                a: 'function fetchRow(uid) {\n  conn.exec("SELECT * FROM u WHERE x=?", [uid]);\n}\n' },
  { f: 'q2.js', b: 'function load(key) {\n  pool.run("SELECT * FROM u WHERE x=" + key);\n}\n',
                a: 'function load(key) {\n  pool.run("SELECT * FROM u WHERE x=?", [key]);\n}\n' },
  { f: 'q3.js', b: 'function get(rid) {\n  client.send("SELECT * FROM u WHERE x=" + rid);\n}\n',
                a: 'function get(rid) {\n  client.send("SELECT * FROM u WHERE x=?", [rid]);\n}\n' },
];

// ═══ 0. شروط العزل ═════════════════════════════════════

test('tripwire: المخزن حقيقي، وأسطر الشرطين موجودة حرفيًا', () => {
  const ctx = loadCtx(LE_HEAD);
  ctx.__store.set(STORAGE_KEY, JSON.stringify({
    patterns: [{ id: 'p-1' }, { id: 'p-2' }], safe: [], meta: { total: 2 },
  }));
  assert.strictEqual(ctx.LearningEngine.getStats().total, 2, 'المخزن يقرأ ما كُتب فيه');

  assert.strictEqual(LE_HEAD.split(DIR_LINE).length - 1, 1,
    'شرط اتجاه التحويل يظهر مرة واحدة — وإلا فنسخة الإضعاف تُضعف غيره');
  assert.notStrictEqual(LE_WEAK_DIR, LE_HEAD, 'ونسخة إضعافه تختلف فعلاً');
  assert.notStrictEqual(LE_NO_LANG, LE_HEAD, 'ونسخة إسقاط شرط اللغة تختلف فعلاً');
});

test('isolation: الأزواج الثلاثة تُنتج القالب المعمَّم نفسه', () => {
  const tpls = new Set();
  for (const c of SQL) {
    const ctx = loadCtx(LE_HEAD);
    learnLikePipeline(ctx, c.b, c.a, c.f);
    const p = patternsOf(ctx)[0];
    assert.ok(p && p.generalized, `[${c.f}] خُزِّن نمط بقالب معمَّم`);
    tpls.add(p.generalized.beforeTemplate + ' ⇒ ' + p.generalized.afterTemplate);
  }
  assert.strictEqual(tpls.size, 1,
    `الثلاثة تتقاسم قالبًا واحدًا — وإلا فاختبار التراكم أدناه فارغ. القوالب: ${[...tpls].join(' // ')}`);
});

// ═══ 1. تراكم الدليل ═══════════════════════════════════

test('ثلاث حالات مختلفة نصيًا بنفس القالب ⇒ سجل واحد يبلغ الاعتماد', () => {
  const ctx = loadCtx(LE_HEAD);
  for (const c of SQL) learnLikePipeline(ctx, c.b, c.a, c.f);

  const ps = patternsOf(ctx);
  assert.strictEqual(ps.length, 1, `سجل واحد لا ثلاثة. المخزَّن: ${ps.length}`);
  assert.strictEqual(ps[0].observed, 3, 'والمشاهدات ثلاث');
  assert.strictEqual(ps[0].verified, 3, 'والتحققات ثلاث — واحد لكل إصلاح');
  assert.strictEqual(ps[0].approved, true, 'فيبلغ الاعتماد بالعتبات القائمة');
});

test('والسطر المتطابق حرفيًا في دالتين مختلفتي الاسم ⇒ سجل واحد كذلك', () => {
  // هذه هي الحالة التي كانت تُنتج سجلّين لأن البصمة تضمّ اسم الدالة.
  const line  = '  db.query("SELECT * FROM u WHERE x=" + id);\n';
  const fixed = '  db.query("SELECT * FROM u WHERE x=?", [id]);\n';
  const ctx = loadCtx(LE_HEAD);
  learnLikePipeline(ctx, 'function alpha(id) {\n' + line + '}\n', 'function alpha(id) {\n' + fixed + '}\n', 'a.js');
  learnLikePipeline(ctx, 'function beta(id) {\n'  + line + '}\n', 'function beta(id) {\n'  + fixed + '}\n', 'b.js');

  const ps = patternsOf(ctx);
  assert.strictEqual(ps.length, 1, 'اسم الدالة لم يعد يشقّ السجل');
  assert.strictEqual(ps[0].verified, 2, 'والدليل تراكم');
  assert.strictEqual(ps[0].approved, true, 'فاعتُمد');
});

// ═══ 2. حدود الدمج: لا يُدمَج غير المتكافئ ═════════════

test('حدّ النوع: نوعان مختلفان بنفس القالب يبقيان سجلّين', () => {
  // سطر السرّ يحمل بلاغَي secret و HARDCODED_SECRET، فيُنتج زوجين بنفس
  // قالب «قبل» ونوعين مختلفين.
  const b = 'function boot() {\n  API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";\n  return API_KEY;\n}\n';
  const a = 'function boot() {\n  API_KEY = process.env.API_KEY;\n  return API_KEY;\n}\n';
  const ctx = loadCtx(LE_HEAD);
  learnLikePipeline(ctx, b, a, 'x.js');

  const ps = patternsOf(ctx);
  assert.ok(ps.length >= 2, `العزل: نوعان على الأقل خُزِّنا (${ps.length})`);
  const types = new Set(ps.map(p => p.type));
  assert.strictEqual(types.size, ps.length, 'لكل نوع سجله');

  const tpls = new Set(ps.filter(p => p.generalized).map(p => p.generalized.beforeTemplate));
  assert.strictEqual(tpls.size, 1, 'وقالب «قبل» واحد للجميع — فالفاصل هو النوع لا القالب');
  assert.ok(ps.every(p => p.observed === 1), 'ولا تراكم بينها');
});

test('حدّ اللغة: js و py بنفس القالب حرفيًا يبقيان سجلّين', () => {
  const line  = 'API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";';
  const fixed = 'API_KEY = process.env.API_KEY;';
  const bJs = 'function boot() {\n  ' + line  + '\n  return API_KEY;\n}\n';
  const aJs = 'function boot() {\n  ' + fixed + '\n  return API_KEY;\n}\n';
  const bPy = 'def boot():\n    ' + line  + '\n    return API_KEY\n';
  const aPy = 'def boot():\n    ' + fixed + '\n    return API_KEY\n';

  const ctx = loadCtx(LE_HEAD);
  learnLikePipeline(ctx, bJs, aJs, 'x.js');
  learnLikePipeline(ctx, bPy, aPy, 'y.py');

  const ps = patternsOf(ctx);
  const langs = new Set(ps.map(p => p.language));
  assert.ok(langs.has('js') && langs.has('py'), `اللغتان مخزَّنتان: [${[...langs]}]`);
  assert.ok(ps.every(p => p.observed === 1), 'ولا تراكم عبر اللغة');

  const tpls = new Set(ps.filter(p => p.generalized).map(p => p.generalized.beforeTemplate));
  assert.strictEqual(tpls.size, 1, 'والقالب واحد — فالفاصل هو اللغة');
});

test('حدّ اللغة هو الفاعل: بإسقاط شرط اللغة تُدمَج اللغتان فعلاً', () => {
  const line  = 'API_KEY = "sk_live_51H8xQ2abcdefghijKLMN";';
  const fixed = 'API_KEY = process.env.API_KEY;';
  const bJs = 'function boot() {\n  ' + line  + '\n  return API_KEY;\n}\n';
  const aJs = 'function boot() {\n  ' + fixed + '\n  return API_KEY;\n}\n';
  const bPy = 'def boot():\n    ' + line  + '\n    return API_KEY\n';
  const aPy = 'def boot():\n    ' + fixed + '\n    return API_KEY\n';

  const head = loadCtx(LE_HEAD);
  learnLikePipeline(head, bJs, aJs, 'x.js');
  learnLikePipeline(head, bPy, aPy, 'y.py');
  const nHead = patternsOf(head).length;

  const weak = loadCtx(LE_NO_LANG);
  learnLikePipeline(weak, bJs, aJs, 'x.js');
  learnLikePipeline(weak, bPy, aPy, 'y.py');
  const nWeak = patternsOf(weak).length;

  assert.ok(nWeak < nHead,
    `بإسقاط شرط اللغة يقلّ عدد السجلات (${nWeak} < ${nHead}) ⇒ الشرط هو الفاصل، لا شيء آخر`);
});

test('حدّ اتجاه التحويل: إصلاحان مختلفان لنفس السطر لا يُدمَجان', () => {
  const b1 = 'function q(id) {\n  db.query("SELECT * FROM u WHERE x=" + id);\n}\n';
  const a1 = 'function q(id) {\n  db.query("SELECT * FROM u WHERE x=?", [id]);\n}\n';
  const b2 = 'function q(k) {\n  db.query("SELECT * FROM u WHERE x=" + k);\n}\n';
  const a2 = 'function q(k) {\n  db.query("SELECT * FROM u WHERE x=?", [String(k)]);\n}\n';

  const ctx = loadCtx(LE_HEAD);
  learnLikePipeline(ctx, b1, a1, 'a.js');
  learnLikePipeline(ctx, b2, a2, 'b.js');

  const ps = patternsOf(ctx);
  assert.strictEqual(ps.length, 2, 'سجلّان: الاتجاهان غير متكافئين');
  assert.ok(ps.every(p => p.observed === 1), 'ولا تراكم بينهما');
  const after = new Set(ps.filter(p => p.generalized).map(p => p.generalized.afterTemplate));
  assert.strictEqual(after.size, 2, 'وقالبا «بعد» مختلفان فعلاً');
  const before = new Set(ps.filter(p => p.generalized).map(p => p.generalized.beforeTemplate));
  assert.strictEqual(before.size, 1, 'وقالب «قبل» واحد — فالفاصل هو الاتجاه');
});

test('حدّ الاتجاه هو الفاعل: بإضعاف الشرط إلى قالب «قبل» وحده يُدمَجان', () => {
  const b1 = 'function q(id) {\n  db.query("SELECT * FROM u WHERE x=" + id);\n}\n';
  const a1 = 'function q(id) {\n  db.query("SELECT * FROM u WHERE x=?", [id]);\n}\n';
  const b2 = 'function q(k) {\n  db.query("SELECT * FROM u WHERE x=" + k);\n}\n';
  const a2 = 'function q(k) {\n  db.query("SELECT * FROM u WHERE x=?", [String(k)]);\n}\n';

  const weak = loadCtx(LE_WEAK_DIR);
  learnLikePipeline(weak, b1, a1, 'a.js');
  learnLikePipeline(weak, b2, a2, 'b.js');

  const ps = patternsOf(weak);
  assert.strictEqual(ps.length, 1, 'النسخة الضعيفة تدمج الاتجاهين');
  assert.strictEqual(ps[0].observed, 2, 'وتُراكم دليلًا على نمط غير متكافئ');
});

// ═══ 3. لا تضخيم للدليل ════════════════════════════════

test('بلاغان على السطر نفسه لا يرفعان verified مرتين لإصلاح واحد', () => {
  const b = 'function q(id) {\n  db.query("SELECT * FROM u WHERE x=" + id);\n}\n';
  const a = 'function q(id) {\n  db.query("SELECT * FROM u WHERE x=?", [id]);\n}\n';
  const ctx = loadCtx(LE_HEAD);

  const issues = ctx.analyzeCode(b, 'z.js');
  assert.ok(issues.length >= 1, 'العزل: المحلّل يُنتج بلاغًا واحدًا على الأقل');

  // نفس قائمة البلاغات مرتين — يحاكي تكرار البلاغ على السطر الواحد
  const ids = learnLikePipeline(ctx, b, a, 'z.js', issues.concat(issues));
  assert.strictEqual(ids.length, new Set(ids).size,
    `learn() يُعيد معرّفات فريدة. أُعيد: ${ids.length}، فريدة: ${new Set(ids).size}`);

  const ps = patternsOf(ctx);
  for (const p of ps) {
    assert.strictEqual(p.verified, 1,
      `إصلاح واحد ⇒ verified = 1 لا أكثر (النمط ${p.type}: ${p.verified})`);
    assert.strictEqual(p.approved, false,
      'ولا يُعتمد بتضخيم — العتبة MIN_VERIFIED=2 لم تُمَسّ');
  }
});

test('ولا تضخيم عبر إصلاحين حقيقيين: verified يساوي عدد الإصلاحات', () => {
  const ctx = loadCtx(LE_HEAD);
  learnLikePipeline(ctx, SQL[0].b, SQL[0].a, SQL[0].f);
  learnLikePipeline(ctx, SQL[1].b, SQL[1].a, SQL[1].f);
  const ps = patternsOf(ctx);
  assert.strictEqual(ps.length, 1, 'سجل واحد');
  assert.strictEqual(ps[0].verified, 2, 'إصلاحان ⇒ verified = 2 بالضبط');
  assert.strictEqual(ps[0].approved, true, 'وهذا دليل حقيقي يبلغ العتبة');
});

// ═══ 4. العتبات والمخزن ════════════════════════════════

test('العتبات كما هي — لم تُغيَّر في هذه المرحلة', () => {
  assert.match(LE_HEAD, /MIN_VERIFIED:\s*2,/,    'MIN_VERIFIED = 2');
  assert.match(LE_HEAD, /MIN_CONFIDENCE:\s*0\.20,/, 'MIN_CONFIDENCE = 0.20');
  assert.match(LE_HEAD, /MAX_CONFIDENCE:\s*0\.97,/, 'MAX_CONFIDENCE = 0.97');
  assert.match(LE_HEAD, /DECAY_ON_FAIL:\s*0\.15,/,  'DECAY_ON_FAIL = 0.15');
});

test('المطابقة الحرفية بلا تغيير: زوج بلا قالب صالح يبقى على البصمة', () => {
  // زوج لا يُنتج قالبًا معمَّمًا صالحًا ⇒ المفتاح يبقى البصمة، ففارق اسم
  // الدالة يشقّ السجل كما كان. هذا سلوك محفوظ لا مُصلَح في هذا النطاق.
  const ctx = loadCtx(LE_HEAD);
  const b1 = 'function alpha() {\n  const K = "sk_live_51H8xQ2abcdefghijKLMN";\n  return K;\n}\n';
  const a1 = 'function alpha() {\n  const K = process.env.K;\n  return K;\n}\n';
  learnLikePipeline(ctx, b1, a1, 'a.js');
  const ps = patternsOf(ctx);
  assert.ok(ps.length >= 1, 'خُزِّن نمط');
  const noGen = ps.filter(p => !p.generalized);
  for (const p of noGen) {
    assert.ok(p.fingerprint, 'النمط بلا قالب يحمل بصمة — فمفتاحه هو البصمة');
  }
});

// ═══ 5. الاختيار بين مطابقين: الحظر يُحترم ولا يُهدَر الدليل ═══
//
// find كان يُرجع أول مطابق في المصفوفة — أي الأقدم. فلو كان توأمًا محظورًا
// (failures ≥ 3) نزل الدليل عليه، وverify تُبقي approved=false متى كان
// failures ≥ 3، فتُهدَر المشاهدة ولا تبلغ القاعدة الاعتماد أبدًا. والمقيس
// قبل الإصلاح: محظور أولًا ⇒ banned: obs=2, ver=2, approved=false والسليم
// باقٍ على ver=1.
//
// ⚠️ لا شيء في كود الإنتاج ينادي verify(id, false) ولا markResult — بحثٌ
// شامل في public/ وapi/ وindex.html. فالسجل المحظور لا ينشأ من المسار
// الحالي، بل من مخزن أقدم أو مزروع أو كود مستقبلي. الإصلاح وقائي، والأثر
// مقيس لا مفترض.

// نمط أوّلي حقيقي يُستخرَج قالبه، ثم يُستنسخ بحالات مختلفة.
function protoPattern() {
  const ctx = loadCtx(LE_HEAD);
  learnLikePipeline(ctx, SQL[0].b, SQL[0].a, SQL[0].f);
  const p = patternsOf(ctx)[0];
  assert.ok(p && p.generalized, 'العزل: النمط الأوّلي له قالب معمَّم');
  return p;
}
const twin = (proto, id, state) =>
  Object.assign({}, proto, { id, fingerprint: 'fp-' + id }, state);
const BANNED  = { failures: 3, verified: 1, approved: false };
const HEALTHY = { failures: 0, verified: 1, approved: false };

// يزرع سجلات ثم يتعلّم زوجًا مطابقًا من نفس العائلة (مختلفًا نصيًا)
function seedThenLearn(pats) {
  const ctx = loadCtx(LE_HEAD);
  ctx.__store.set(STORAGE_KEY, JSON.stringify({
    patterns: JSON.parse(JSON.stringify(pats)), safe: [], meta: { total: pats.length },
  }));
  const ids = learnLikePipeline(ctx, SQL[1].b, SQL[1].a, SQL[1].f);
  const ps = patternsOf(ctx);
  return { ids, ps, byId: id => ps.find(p => p.id === id) };
}

test('محظور أولًا وسليم ثانيًا: الدليل لا ينزل على المحظور', () => {
  const proto = protoPattern();
  const r = seedThenLearn([twin(proto, 'banned', BANNED), twin(proto, 'healthy', HEALTHY)]);

  assert.strictEqual(r.ps.length, 2, 'لا سجل ثالث');
  const banned = r.byId('banned'), healthy = r.byId('healthy');

  assert.strictEqual(banned.observed, 1, 'المحظور لم يتراكم عليه شيء');
  assert.strictEqual(banned.verified, 1, 'ولا تحقّق جديد');
  assert.strictEqual(banned.failures, 3, 'وحظره كما هو — لم يُخفَّض');
  assert.strictEqual(banned.approved, false, 'ولم يُعَد تفعيله');

  assert.strictEqual(healthy.observed, 2, 'والدليل نزل على السليم');
  assert.strictEqual(healthy.verified, 2, 'وتحقّقه تراكم');
  assert.strictEqual(healthy.approved, true, 'فبلغ الاعتماد بالعتبات القائمة');
});

test('سليم أولًا ومحظور ثانيًا: السليم يستمر صحيحًا', () => {
  const proto = protoPattern();
  const r = seedThenLearn([twin(proto, 'healthy', HEALTHY), twin(proto, 'banned', BANNED)]);

  assert.strictEqual(r.ps.length, 2, 'لا سجل ثالث');
  assert.strictEqual(r.byId('healthy').verified, 2, 'السليم تراكم');
  assert.strictEqual(r.byId('healthy').approved, true, 'واعتُمد');
  assert.strictEqual(r.byId('banned').verified, 1, 'والمحظور لم يُمَسّ');
  assert.strictEqual(r.byId('banned').failures, 3, 'وحظره باقٍ');
});

test('معتمد أولًا وناشئ ثانيًا: المعتمد لا يتأثر وآلية الاعتماد كما هي', () => {
  const proto = protoPattern();
  const r = seedThenLearn([
    twin(proto, 'approved', { failures: 0, verified: 3, approved: true }),
    twin(proto, 'fresh', HEALTHY),
  ]);

  assert.strictEqual(r.ps.length, 2, 'لا سجل ثالث');
  const ap = r.byId('approved');
  assert.strictEqual(ap.observed, 2, 'المعتمد هو من تراكم عليه الدليل');
  assert.strictEqual(ap.verified, 4, 'وتحقّقه زاد واحدًا لا أكثر');
  assert.strictEqual(ap.approved, true, 'وبقي معتمدًا');
  assert.strictEqual(ap.failures, 0, 'ولا فشل أُضيف');
  assert.strictEqual(r.byId('fresh').verified, 1, 'والناشئ لم يُمَسّ');
});

test('كل المطابق محظور: لا تعلّم، ولا تجاوز للحظر، ولا سجل جديد', () => {
  const proto = protoPattern();
  const r = seedThenLearn([twin(proto, 'b1', BANNED), twin(proto, 'b2', BANNED)]);

  assert.strictEqual(r.ids.length, 0, 'لا معرّف يُعاد ⇒ لا verify يُنادى');
  assert.strictEqual(r.ps.length, 2, 'ولا سجل جديد يُحيي القاعدة المحظورة');
  for (const id of ['b1', 'b2']) {
    const p = r.byId(id);
    assert.strictEqual(p.observed, 1, `[${id}] لم يتراكم عليه شيء`);
    assert.strictEqual(p.verified, 1, `[${id}] ولا تحقّق جديد`);
    assert.strictEqual(p.failures, 3, `[${id}] وحظره كما هو`);
    assert.strictEqual(p.approved, false, `[${id}] ولم يُعَد تفعيله`);
  }
});

test('الحظر لا يعبر النوع ولا اللغة: محظور بنوع آخر لا يمنع التعلّم', () => {
  // الحظر يخصّ القاعدة بمفتاحها الكامل. سجل محظور بنوع مختلف ليس مطابقًا
  // أصلاً، فلا يمنع تعلّم القاعدة السليمة ولا يُدمَج معها.
  const proto = protoPattern();
  const otherType = twin(proto, 'banned-other', BANNED);
  otherType.type = 'SOME_OTHER_TYPE';
  const otherLang = twin(proto, 'banned-py', BANNED);
  otherLang.language = 'py';

  const r = seedThenLearn([otherType, otherLang]);
  assert.strictEqual(r.ids.length, 1, 'التعلّم حدث — المحظوران غير مطابقين');
  assert.strictEqual(r.ps.length, 3, 'وأُنشئ سجل جديد للقاعدة السليمة');
  assert.strictEqual(r.byId('banned-other').observed, 1, 'المحظور بنوع آخر لم يُمَسّ');
  assert.strictEqual(r.byId('banned-py').observed, 1, 'والمحظور بلغة أخرى لم يُمَسّ');
});

test('السجلات القديمة لا تُمسّ: يُراكم على المطابق ويُترك غيره كما هو', () => {
  // مخزن كُتب بالمفتاح القديم: سجلّان متكافئان بنفس القالب (نسخ تاريخية).
  const ctx = loadCtx(LE_HEAD);
  const seedCtx = loadCtx(LE_HEAD);
  learnLikePipeline(seedCtx, SQL[0].b, SQL[0].a, SQL[0].f);
  const proto = patternsOf(seedCtx)[0];
  assert.ok(proto && proto.generalized, 'العزل: النمط الأوّلي له قالب');

  const old1 = Object.assign({}, proto, { id: 'old-1', observed: 1, verified: 1, approved: false, fingerprint: 'fp-old-1' });
  const old2 = Object.assign({}, proto, { id: 'old-2', observed: 1, verified: 1, approved: false, fingerprint: 'fp-old-2' });
  ctx.__store.set(STORAGE_KEY, JSON.stringify({ patterns: [old1, old2], safe: [], meta: { total: 2 } }));

  learnLikePipeline(ctx, SQL[1].b, SQL[1].a, SQL[1].f);

  const ps = patternsOf(ctx);
  assert.strictEqual(ps.length, 2, 'لم يُنشأ سجل ثالث — تراكم على القائم');
  const ids = ps.map(p => p.id).sort();
  assert.deepStrictEqual(ids, ['old-1', 'old-2'], 'والسجلان القديمان باقيان بمعرّفيهما');

  const acc = ps.filter(p => p.observed > 1);
  assert.strictEqual(acc.length, 1, 'وواحد فقط تراكم عليه الدليل');
  const untouched = ps.find(p => p.observed === 1);
  assert.strictEqual(untouched.verified, 1, 'والآخر لم يُمَسّ — لا دمج رجعي ولا تهجير');
});
