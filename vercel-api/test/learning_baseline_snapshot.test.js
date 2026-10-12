// ═══════════════════════════════════════════════════════════════════════
// [BASELINE] لقطةٌ مرجعية لسلوك LearningEngine القائم — المرحلة صفر
// تشغيل:  node --test vercel-api/test/learning_baseline_snapshot.test.js
//
// الغرضُ **ليس** الحكم على السلوك بل تثبيتُه كما هو قبل تقسيم الملف إلى
// ثلاثة. فكلُّ ما يُقاس هنا يُسجَّل في fixtures/learning_baseline.json،
// ويلزم أن يُعيد التقسيمُ إنتاجَه **حرفًا**. ما بدا منه غريبًا يبقى كما هو:
// تصحيحُ السلوك مرحلةٌ لاحقة، وخلطُه بالنقل يُفقد القدرة على تمييز
// «تغيّر لأني نقلت» من «تغيّر لأني أصلحت».
//
// ─── الحتمية شرطُ المقارنة ────────────────────────────────────────────
// ‎learn()‎ يبني المعرّف من ‎Date.now()‎ و‎Math.random()‎، و‎created/lastSeen‎
// من الساعة. فبلا تثبيتهما تختلف اللقطة في كل تشغيل ولا تصلح مرجعًا.
// فالسياق يُحقَن بساعةٍ تتقدّم خطوةً ثابتة ومولّدٍ خطّي ببذرة — فتصير كل
// المعرّفات والأختام قابلةً لإعادة الإنتاج بلا لمس كود الإنتاج.
//
// وتحديثُ اللقطة عمدًا:
//   UPDATE_BASELINE=1 node --test vercel-api/test/learning_baseline_snapshot.test.js
// ولا يُفعل ذلك إلا بقرارٍ مُعلَن — الفرقُ هو الإنذار.
//
// ─── سجلُّ تحديثات اللقطة ─────────────────────────────────────────────
// مراحل التقسيم الثلاث الأولى (التحقّق، المعرفة، تنظيف المحرّك) أعادت
// إنتاج اللقطة **مطابقةً بلا تحديث** — وهو دليلُ أن النقل نقلٌ لا تغيير.
//
// تحديثٌ واحد جرى، في [S4] (ترحيلُ المخزن)، وفرقُه كلُّه عبر 19 سيناريو
// سطرٌ واحد مُضاف:
//     learn-once · meta:  + "schemaVersion": 3
// وهو الوسمُ المقصود من المرحلة؛ ولا تغيّر في نمط، ولا عدّاد، ولا اعتماد،
// ولا ناتج تطبيق، ولا إحصاء. قيس الفرقُ أولًا ثم حُدِّثت اللقطة — لا
// العكس. وبقاءُ هذا السجل هو ما يجعل التحديثَ مراجَعًا لا صامتًا.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR   = path.join(__dirname, '..', 'public');
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'learning_baseline.json');
const STORAGE_KEY  = 're_learned_patterns_v2';

// ─── سياقٌ حتميّ ───────────────────────────────────────────────────────
function loadCtx() {
  const noop = () => {};
  const store = new Map();

  // ساعةٌ تتقدّم خطوةً ثابتة، ومولّدٌ خطّي ببذرة — لا شيء منهما يمسّ الإنتاج
  let clock = 1700000000000;
  const nowFn = () => { clock += 1000; return clock; };
  let seed = 123456789;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  const FakeDate = function (...a) { return a.length ? new Date(...a) : new Date(clock); };
  FakeDate.now = nowFn;
  FakeDate.prototype = Date.prototype;

  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    Date: FakeDate,
    Math: Object.assign(Object.create(Math), { random: rnd }),
    document: {
      getElementById: () => ({ style: {} }), addEventListener: noop,
      createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); },
    },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);

  // نفسُ ترتيب index.html — السلوك المرجعي هو سلوك الصفحة لا وحدةٍ معزولة
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* واجهة */ }
  }
  ctx.__store = store;
  return ctx;
}

const run = (ctx, expr) => vm.runInContext(expr, ctx);
const json = (ctx, expr) => JSON.parse(run(ctx, 'JSON.stringify(' + expr + ')'));
const dbOf = ctx => { const r = ctx.__store.get(STORAGE_KEY); return r ? JSON.parse(r) : null; };

// ─── عيّنات ثابتة ──────────────────────────────────────────────────────
const EVAL_BEFORE = 'function f(x) {\n  var a = eval(x);\n  return a;\n}\n';
const EVAL_AFTER  = 'function f(x) {\n  var a = JSON.parse(x);\n  return a;\n}\n';
const EVAL_ISSUES = [{ line: 2, type: 'EVAL_USAGE', title: 'eval خطير', sev: 'c' }];

const SEC_BEFORE = 'const apiKey = "sk_live_abc123xyz789def456ghi";\nmodule.exports = apiKey;\n';
const SEC_AFTER  = 'const apiKey = process.env.API_KEY;\nmodule.exports = apiKey;\n';
const SEC_ISSUES = [{ line: 1, type: 'HARDCODED_SECRET', title: 'سرّ مُضمَّن', sev: 'c' }];

// ─── السيناريوهات: كلٌّ منها يُنتج قطعةً من اللقطة ─────────────────────
const SCENARIOS = {

  // (1) سطحُ الواجهة — العقد الذي يجب ألّا يتغيّر بالتقسيم
  'api-surface': () => {
    const ctx = loadCtx();
    const names = ['learn', 'learnSafe', 'applyLearned', 'markUsed', 'verify',
                   'getStats', 'getBoosts', 'reset'];
    return {
      exported: json(ctx, 'Object.keys(LearningEngine).sort()'),
      arity: names.reduce((o, n) => (o[n] = run(ctx, 'LearningEngine.' + n + '.length'), o), {}),
      kinds: names.reduce((o, n) => (o[n] = run(ctx, 'typeof LearningEngine.' + n), o), {}),
      global: run(ctx, 'typeof window.LearningEngine'),
    };
  },

  // (2) مخزنٌ فارغ — لا تطبيق ولا كتابة
  'empty-store': () => {
    const ctx = loadCtx();
    const r = json(ctx, 'LearningEngine.applyLearned("var a = eval(x);", "a.js")');
    return { apply: r, stats: json(ctx, 'LearningEngine.getStats()'),
             boosts: json(ctx, '[...LearningEngine.getBoosts()]'),
             wroteStore: dbOf(ctx) !== null };
  },

  // (3) التعلّم من زوجٍ حقيقي — الشكل المخزَّن بالكامل
  'learn-once': () => {
    const ctx = loadCtx();
    ctx.__b = EVAL_BEFORE; ctx.__a = EVAL_AFTER; ctx.__i = EVAL_ISSUES;
    const ids = json(ctx, 'LearningEngine.learn(__b, __a, __i, "a.js")');
    return { ids, db: dbOf(ctx), stats: json(ctx, 'LearningEngine.getStats()') };
  },

  // (4) نفسُ الزوج مرّتين — تراكمُ دليلٍ لا سجلٌّ ثانٍ
  'learn-twice-merges': () => {
    const ctx = loadCtx();
    ctx.__b = EVAL_BEFORE; ctx.__a = EVAL_AFTER; ctx.__i = EVAL_ISSUES;
    const a = json(ctx, 'LearningEngine.learn(__b, __a, __i, "a.js")');
    const b = json(ctx, 'LearningEngine.learn(__b, __a, __i, "a.js")');
    const db = dbOf(ctx);
    return { first: a, second: b, patternCount: db.patterns.length,
             observed: db.patterns.map(p => p.observed) };
  },

  // (5) منحنى الثقة والاعتماد — تحقّقٌ بعد تحقّق
  'verify-success-curve': () => {
    const ctx = loadCtx();
    ctx.__b = EVAL_BEFORE; ctx.__a = EVAL_AFTER; ctx.__i = EVAL_ISSUES;
    const [id] = json(ctx, 'LearningEngine.learn(__b, __a, __i, "a.js")');
    ctx.__id = id;
    const steps = [];
    for (let i = 1; i <= 6; i++) {
      const ret = run(ctx, 'LearningEngine.verify(__id, true)');
      const p = dbOf(ctx).patterns[0];
      steps.push({ n: i, returned: ret === id ? '<id>' : ret,
                   verified: p.verified, failures: p.failures,
                   confidence: p.confidence, approved: p.approved });
    }
    return { steps };
  },

  // (6) الإخفاق — الخفض ثم الحظر عند الثالثة، ولا عودة
  'verify-failure-ban': () => {
    const ctx = loadCtx();
    ctx.__b = EVAL_BEFORE; ctx.__a = EVAL_AFTER; ctx.__i = EVAL_ISSUES;
    const [id] = json(ctx, 'LearningEngine.learn(__b, __a, __i, "a.js")');
    ctx.__id = id;
    run(ctx, 'LearningEngine.verify(__id, true); LearningEngine.verify(__id, true);');
    const steps = [];
    for (let i = 1; i <= 3; i++) {
      run(ctx, 'LearningEngine.verify(__id, false)');
      const p = dbOf(ctx).patterns[0];
      steps.push({ fail: i, verified: p.verified, failures: p.failures,
                   confidence: p.confidence, approved: p.approved });
    }
    // نجاحاتٌ بعد الحظر — هل تُعيد الاعتماد؟
    for (let i = 0; i < 5; i++) run(ctx, 'LearningEngine.verify(__id, true)');
    const after = dbOf(ctx).patterns[0];
    return { steps, afterFiveSuccesses: {
      verified: after.verified, failures: after.failures,
      confidence: after.confidence, approved: after.approved } };
  },

  // (7) المطابقة الحرفية — مسار exact
  'apply-exact': () => {
    const ctx = loadCtx();
    ctx.__b = SEC_BEFORE; ctx.__a = SEC_AFTER; ctx.__i = SEC_ISSUES;
    const [id] = json(ctx, 'LearningEngine.learn(__b, __a, __i, "a.js")');
    ctx.__id = id;
    run(ctx, 'LearningEngine.verify(__id, true); LearningEngine.verify(__id, true);');
    const target = 'const apiKey = "sk_live_abc123xyz789def456ghi";\nconsole.log(apiKey);\n';
    ctx.__t = target;
    const r = json(ctx, 'LearningEngine.applyLearned(__t, "b.js")');
    return { applied: r.applied, fixed: r.fixed,
             uses: r.uses.map(u => ({ via: u.via, lineIndex: u.lineIndex,
                                      before: u.before, after: u.after,
                                      patternId: u.patternId === id ? '<id>' : u.patternId })) };
  },

  // (8) بوابة اللغة — نمطُ ملفٍ js على ملف py والعكس
  'apply-language-gate': () => {
    const ctx = loadCtx();
    ctx.__b = SEC_BEFORE; ctx.__a = SEC_AFTER; ctx.__i = SEC_ISSUES;
    const [id] = json(ctx, 'LearningEngine.learn(__b, __a, __i, "a.js")');
    ctx.__id = id;
    run(ctx, 'LearningEngine.verify(__id, true); LearningEngine.verify(__id, true);');
    ctx.__t = 'const apiKey = "sk_live_abc123xyz789def456ghi";\n';
    return {
      sameLang:  json(ctx, 'LearningEngine.applyLearned(__t, "b.js").applied'),
      otherLang: json(ctx, 'LearningEngine.applyLearned(__t, "b.py").applied'),
      unknownExt: json(ctx, 'LearningEngine.applyLearned(__t, "b.zzz").applied'),
      noExt:      json(ctx, 'LearningEngine.applyLearned(__t, "Makefile").applied'),
    };
  },

  // (9) onlyIds — حصرُ التطبيق
  'apply-only-ids': () => {
    const ctx = loadCtx();
    ctx.__b = SEC_BEFORE; ctx.__a = SEC_AFTER; ctx.__i = SEC_ISSUES;
    const [id] = json(ctx, 'LearningEngine.learn(__b, __a, __i, "a.js")');
    ctx.__id = id;
    run(ctx, 'LearningEngine.verify(__id, true); LearningEngine.verify(__id, true);');
    ctx.__t = 'const apiKey = "sk_live_abc123xyz789def456ghi";\n';
    return {
      matching: json(ctx, 'LearningEngine.applyLearned(__t, "b.js", { onlyIds: [__id] }).applied'),
      other:    json(ctx, 'LearningEngine.applyLearned(__t, "b.js", { onlyIds: ["nope"] }).applied'),
      empty:    json(ctx, 'LearningEngine.applyLearned(__t, "b.js", { onlyIds: [] }).applied'),
    };
  },

  // (10) applyLearned قراءةٌ محضة — لا تلمس المخزن
  // الكتاباتُ تُعَدّ ولا يُقارَن المحتوى: ‎save(db)‎ يُعيد تسلسل نفس الكائن
  // فيُنتج نصًّا مطابقًا، فمقارنةُ المحتوى تمرّ على كتابةٍ وقعت فعلًا.
  'apply-is-pure': () => {
    const ctx = loadCtx();
    ctx.__b = SEC_BEFORE; ctx.__a = SEC_AFTER; ctx.__i = SEC_ISSUES;
    const [id] = json(ctx, 'LearningEngine.learn(__b, __a, __i, "a.js")');
    ctx.__id = id;
    run(ctx, 'LearningEngine.verify(__id, true); LearningEngine.verify(__id, true);');
    const snapBefore = ctx.__store.get(STORAGE_KEY);

    let writes = 0;
    const realSet = ctx.localStorage.setItem;
    ctx.localStorage.setItem = (k, v) => { if (k === STORAGE_KEY) writes++; return realSet(k, v); };
    ctx.__t = 'const apiKey = "sk_live_abc123xyz789def456ghi";\n';
    run(ctx, 'LearningEngine.applyLearned(__t, "b.js")');
    run(ctx, 'LearningEngine.applyLearned(__t, "b.js")');
    run(ctx, 'LearningEngine.applyLearned("var nothing = 1;", "b.js")');
    ctx.localStorage.setItem = realSet;

    return { storeWrites: writes, storeUnchanged: ctx.__store.get(STORAGE_KEY) === snapBefore };
  },

  // (11) markUsed — دفترٌ فقط، لا حكم
  'mark-used': () => {
    const ctx = loadCtx();
    ctx.__b = SEC_BEFORE; ctx.__a = SEC_AFTER; ctx.__i = SEC_ISSUES;
    const [id] = json(ctx, 'LearningEngine.learn(__b, __a, __i, "a.js")');
    ctx.__id = id;
    run(ctx, 'LearningEngine.verify(__id, true); LearningEngine.verify(__id, true);');
    const before = dbOf(ctx).patterns[0];
    const n = run(ctx, 'LearningEngine.markUsed([__id])');
    const after = dbOf(ctx).patterns[0];
    return {
      returned: n,
      countersUntouched: before.verified === after.verified &&
                         before.failures === after.failures &&
                         before.confidence === after.confidence &&
                         before.approved === after.approved,
      lastUsedSet: typeof after.lastUsed === 'number',
      emptyInput: run(ctx, 'LearningEngine.markUsed([])'),
      badInput:   run(ctx, 'LearningEngine.markUsed(null)'),
      unknownId:  run(ctx, 'LearningEngine.markUsed(["nope"])'),
    };
  },

  // (12) حُرّاس ما قبل الكتابة — هدفُ الإسناد وترتيبُ القيم
  'guards-target-and-order': () => {
    const ctx = loadCtx();
    // نمطٌ حرفي على سطرٍ يختلف هدفُ إسناده
    ctx.__b = SEC_BEFORE; ctx.__a = SEC_AFTER; ctx.__i = SEC_ISSUES;
    const [id] = json(ctx, 'LearningEngine.learn(__b, __a, __i, "a.js")');
    ctx.__id = id;
    run(ctx, 'LearningEngine.verify(__id, true); LearningEngine.verify(__id, true);');
    return {
      // نفسُ السطر حرفًا ⇒ يُطبَّق
      identical: json(ctx, 'LearningEngine.applyLearned("const apiKey = \\"sk_live_abc123xyz789def456ghi\\";\\n", "b.js").applied'),
      // سطرٌ مشابهٌ نصيًّا بهدفٍ آخر ⇒ لا مطابقة حرفية
      otherTarget: json(ctx, 'LearningEngine.applyLearned("const otherKey = \\"sk_live_abc123xyz789def456ghi\\";\\n", "b.js").applied'),
      // سطرُ تعليق ⇒ يُتخطّى
      comment: json(ctx, 'LearningEngine.applyLearned("// const apiKey = \\"sk_live_abc123xyz789def456ghi\\";\\n", "b.js").applied'),
      // نمطٌ مزروعٌ يُعيد تسمية هدف الإسناد ⇒ يردّه preservesTarget قبل الكتابة
      renamesTarget: (() => {
        const c2 = loadCtx();
        c2.__store.set(STORAGE_KEY, JSON.stringify({ patterns: [{
          id: 'seed-rename', type: 'HARDCODED_SECRET', language: 'js',
          before: 'const A_KEY = "sk_live_abc123xyz789def456ghi";',
          after:  'const B_KEY = process.env.A_KEY;',
          generalized: null, observed: 9, verified: 9, failures: 0,
          confidence: 0.9, approved: true, created: 1, lastSeen: 1,
        }], safe: [], meta: { total: 1 } }));
        return json(c2, 'LearningEngine.applyLearned("const A_KEY = \\"sk_live_abc123xyz789def456ghi\\";\\n", "b.js").applied');
      })(),
      // ونفسُ النمط بهدفٍ محفوظ ⇒ يمرّ، فالرفضُ عن الهدف لا عن شيءٍ آخر
      keepsTarget: (() => {
        const c3 = loadCtx();
        c3.__store.set(STORAGE_KEY, JSON.stringify({ patterns: [{
          id: 'seed-keep', type: 'HARDCODED_SECRET', language: 'js',
          before: 'const A_KEY = "sk_live_abc123xyz789def456ghi";',
          after:  'const A_KEY = process.env.A_KEY;',
          generalized: null, observed: 9, verified: 9, failures: 0,
          confidence: 0.9, approved: true, created: 1, lastSeen: 1,
        }], safe: [], meta: { total: 1 } }));
        return json(c3, 'LearningEngine.applyLearned("const A_KEY = \\"sk_live_abc123xyz789def456ghi\\";\\n", "b.js").applied');
      })(),
    };
  },

  // (12ب) حارسُ ترتيب القيم — زوجٌ حرفيٌّ يعكس الوسطاء
  // المقيسُ في تعليق [V4″]: المطابقة الحرفية بلا قالب، فالعكسُ يمرّ من كل
  // البوابات (نحوُه سليم والمحلّل يُنتج نفس البلاغات)، ولا يردّه إلا هذا.
  'guard-value-order': () => {
    const seed = (after) => {
      const c = loadCtx();
      c.__store.set(STORAGE_KEY, JSON.stringify({ patterns: [{
        id: 'seed-vo', type: 'SQL_INJECTION', language: 'js',
        before: 'conn.exec("SELECT * FROM t WHERE a=" + userId + " AND b=" + tenantId);',
        after:  after,
        generalized: null, observed: 9, verified: 9, failures: 0,
        confidence: 0.9, approved: true, created: 1, lastSeen: 1,
      }], safe: [], meta: { total: 1 } }));
      c.__t = 'conn.exec("SELECT * FROM t WHERE a=" + userId + " AND b=" + tenantId);\n';
      return json(c, 'LearningEngine.applyLearned(__t, "q.js").applied');
    };
    return {
      // ترتيبٌ محفوظ ⇒ يُطبَّق
      inOrder:  seed('conn.exec("SELECT * FROM t WHERE a=? AND b=?", [userId, tenantId]);'),
      // ترتيبٌ معكوس ⇒ يُردّ قبل الكتابة
      reversed: seed('conn.exec("SELECT * FROM t WHERE a=? AND b=?", [tenantId, userId]);'),
    };
  },

  // (12ج) لغةٌ مجهولة — النمطُ نفسه بلغة 'unknown' على ملفٍ مجهول الامتداد
  // بلا الحارس المبكر يتساوى 'unknown' === 'unknown' فيُطبَّق قالبُ ملفٍ
  // مجهول على آخر بلا أي قرابة لغوية (Bash على YAML — المقيس في التعليق).
  'guard-unknown-language': () => {
    const c = loadCtx();
    c.__store.set(STORAGE_KEY, JSON.stringify({ patterns: [{
      id: 'seed-unk', type: 'HARDCODED_SECRET', language: 'unknown',
      before: 'KEY="sk_live_abc123xyz789def456ghi"',
      after:  'KEY="$API_KEY"',
      generalized: null, observed: 9, verified: 9, failures: 0,
      confidence: 0.9, approved: true, created: 1, lastSeen: 1,
    }], safe: [], meta: { total: 1 } }));
    c.__t = 'KEY="sk_live_abc123xyz789def456ghi"\n';
    return {
      unknownOnUnknown: json(c, 'LearningEngine.applyLearned(__t, "deploy.sh").applied'),
      unknownOnYaml:    json(c, 'LearningEngine.applyLearned(__t, "conf.yml").applied'),
      unknownOnJs:      json(c, 'LearningEngine.applyLearned(__t, "a.js").applied'),
    };
  },

  // (13) getBoosts — العتبة والحدّ الأقصى لكل نوع
  'boosts': () => {
    const ctx = loadCtx();
    ctx.__b = EVAL_BEFORE; ctx.__a = EVAL_AFTER; ctx.__i = EVAL_ISSUES;
    const [id] = json(ctx, 'LearningEngine.learn(__b, __a, __i, "a.js")');
    ctx.__id = id;
    const at = [];
    for (let i = 1; i <= 12; i++) {
      run(ctx, 'LearningEngine.verify(__id, true)');
      const p = dbOf(ctx).patterns[0];
      at.push({ verified: p.verified, confidence: p.confidence,
                boosts: json(ctx, '[...LearningEngine.getBoosts()]') });
    }
    return { progression: at };
  },

  // (14) learnSafe
  'learn-safe': () => {
    const ctx = loadCtx();
    const code = 'console.log("x");\nreturn 1;\nconst a = 1;\n// تعليق\n';
    ctx.__c = code;
    const n1 = run(ctx, 'LearningEngine.learnSafe(__c, "a.js")');
    const n2 = run(ctx, 'LearningEngine.learnSafe(__c, "a.js")');
    const db = dbOf(ctx);
    return { first: n1, secondIdempotent: n2,
             safe: (db && db.safe ? db.safe.map(s => s.pattern) : []) };
  },

  // (15) reset
  'reset': () => {
    const ctx = loadCtx();
    ctx.__b = EVAL_BEFORE; ctx.__a = EVAL_AFTER; ctx.__i = EVAL_ISSUES;
    run(ctx, 'LearningEngine.learn(__b, __a, __i, "a.js")');
    const had = dbOf(ctx) !== null;
    run(ctx, 'LearningEngine.reset()');
    return { hadStore: had, afterReset: dbOf(ctx),
             stats: json(ctx, 'LearningEngine.getStats()') };
  },

  // (16) مخزنٌ تالف أو غائب — fail-safe لا رمي
  'corrupt-store': () => {
    const ctx = loadCtx();
    ctx.__store.set(STORAGE_KEY, '{not json');
    const a = json(ctx, 'LearningEngine.getStats()');
    const b = json(ctx, 'LearningEngine.applyLearned("var a = 1;", "a.js")');
    ctx.__store.set(STORAGE_KEY, JSON.stringify({ patterns: 'ليست مصفوفة' }));
    let threw = null;
    try { json(ctx, 'LearningEngine.getStats()'); } catch (e) { threw = String(e.message).slice(0, 60); }
    return { statsOnGarbage: a, applyOnGarbage: b, onBadShape: threw };
  },

  // (17) نمطٌ محظور لا يُطبَّق ولا يُحيا بتعلّمٍ جديد
  'banned-pattern-inert': () => {
    const ctx = loadCtx();
    ctx.__b = SEC_BEFORE; ctx.__a = SEC_AFTER; ctx.__i = SEC_ISSUES;
    const [id] = json(ctx, 'LearningEngine.learn(__b, __a, __i, "a.js")');
    ctx.__id = id;
    run(ctx, 'LearningEngine.verify(__id, true); LearningEngine.verify(__id, true);');
    run(ctx, 'LearningEngine.verify(__id, false); LearningEngine.verify(__id, false); LearningEngine.verify(__id, false);');
    ctx.__t = 'const apiKey = "sk_live_abc123xyz789def456ghi";\n';
    const appliedWhileBanned = json(ctx, 'LearningEngine.applyLearned(__t, "b.js").applied');
    // تعلّمٌ جديد من نفس الزوج بينما المطابق محظور
    const relearn = json(ctx, 'LearningEngine.learn(__b, __a, __i, "a.js")');
    const db = dbOf(ctx);
    return { appliedWhileBanned, relearnIds: relearn,
             patternCount: db.patterns.length,
             approved: db.patterns.map(p => p.approved),
             failures: db.patterns.map(p => p.failures),
             stats: { banned: json(ctx, 'LearningEngine.getStats().banned'),
                      inert:  json(ctx, 'LearningEngine.getStats().inert') } };
  },
};

// ─── تطبيعُ اللقطة: ما لا يصحّ تثبيتُه يُستبدل برمزٍ ثابت ───────────────
// الحتميةُ تجعل المعرّفات والأختام قابلةً للإنتاج، لكن تثبيتَ رقمٍ زمني
// يربط اللقطة بالبذرة لا بالسلوك. فتُستبدل بأنماطٍ تصف شكلها.
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (k === 'id' || k === 'patternId') { out[k] = typeof v[k] === 'string' ? '<id>' : v[k]; continue; }
      if (k === 'created' || k === 'lastSeen' || k === 'lastUsed' || k === 'at') {
        out[k] = typeof v[k] === 'number' ? '<ts>' : v[k]; continue;
      }
      out[k] = normalize(v[k]);
    }
    return out;
  }
  if (typeof v === 'string' && /^\d{13}-[a-z0-9]{1,5}$/.test(v)) return '<id>';
  return v;
}

function buildSnapshot() {
  const out = {};
  for (const name of Object.keys(SCENARIOS).sort()) out[name] = normalize(SCENARIOS[name]());
  return out;
}

// ═══════════════════════════════════════════════════════════════════════

test('[BL-0] اللقطةُ قابلةٌ لإعادة الإنتاج — تشغيلان متطابقان', () => {
  const a = JSON.stringify(buildSnapshot());
  const b = JSON.stringify(buildSnapshot());
  assert.strictEqual(a, b, 'اللقطة غير حتمية — لا تصلح مرجعًا للنقل');
});

test('[BL-1] السلوك القائم مطابقٌ للقطة المرجعية', () => {
  const snap = buildSnapshot();

  if (process.env.UPDATE_BASELINE === '1' || !fs.existsSync(FIXTURE_PATH)) {
    fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
    fs.writeFileSync(FIXTURE_PATH, JSON.stringify(snap, null, 1) + '\n', 'utf8');
    if (process.env.UPDATE_BASELINE !== '1') {
      assert.fail('أُنشئت اللقطة المرجعية لأول مرة — راجعها ثم أعد التشغيل');
    }
    return;
  }

  const ref = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  const names = Object.keys(snap);
  for (const n of names) {
    assert.deepStrictEqual(snap[n], ref[n],
      'تغيّر سلوكُ «' + n + '» عن اللقطة المرجعية.\n' +
      'إن كان مقصودًا فحدّثها عمدًا: UPDATE_BASELINE=1');
  }
  assert.deepStrictEqual(names.sort(), Object.keys(ref).sort(), 'تغيّرت مجموعة السيناريوهات');
});

// ─── [L-8] سطحُ الواجهة — العقد مع كل مُستدعٍ ──────────────────────────
test('[BL-2] الدوال الثماني وحدها، بتواقيعها، على window وmodule', () => {
  const ctx = loadCtx();
  assert.deepStrictEqual(
    json(ctx, 'Object.keys(LearningEngine).sort()'),
    ['applyLearned', 'getBoosts', 'getStats', 'learn', 'learnSafe', 'markUsed', 'reset', 'verify'],
    'تغيّر سطحُ LearningEngine');
  assert.strictEqual(run(ctx, 'window.LearningEngine === LearningEngine'), true);

  const mod = require(path.join(PUBLIC_DIR, 'learning_engine.js'));
  assert.deepStrictEqual(Object.keys(mod).sort(),
    ['applyLearned', 'getBoosts', 'getStats', 'learn', 'learnSafe', 'markUsed', 'reset', 'verify'],
    'module.exports يختلف عن النطاق العام');
});

test('[BL-3] كلُّ مُستدعٍ في المستودع يجد ما يستدعيه', () => {
  // العقدُ ليس قائمةً مكتوبة هنا بل ما يستدعيه الكود فعلًا — يُستخرَج منه.
  const ctx = loadCtx();
  const files = ['fix_engine_pipeline.js', 'engine_java.js', 'unified_engine.js',
                 'engine_self_diagnosis.js'];
  const called = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
    for (const m of src.matchAll(/LearningEngine\.(\w+)/g)) called.add(m[1]);
  }
  const admin = path.join(PUBLIC_DIR, 'admin.html');
  if (fs.existsSync(admin)) {
    for (const m of fs.readFileSync(admin, 'utf8').matchAll(/LearningEngine\.(\w+)/g)) called.add(m[1]);
  }
  assert.ok(called.size >= 5, 'لم تُستخرَج الاستدعاءات: ' + [...called].join(','));
  const missing = [...called].filter(n => run(ctx, 'typeof LearningEngine.' + n) !== 'function');
  assert.deepStrictEqual(missing, [], 'مُستدعًى بلا دالة: ' + missing.join(', '));
});

test('[BL-4] المِجسّات الأربعة في engine_self_diagnosis ما زالت تمرّ', () => {
  // التقسيمُ يجب ألّا يكسر التشخيص الذاتي — وهو مُستدعٍ مستقلٌّ عن الواجهة
  const ESD = require(path.join(PUBLIC_DIR, 'engine_self_diagnosis.js'));
  const b = ESD.runBattery({ publicDir: PUBLIC_DIR });
  assert.strictEqual(b.available, true, 'البطارية غير متاحة');
  assert.deepStrictEqual(b.loadErrors, [], 'وحدةٌ لم تُحمَّل: ' + JSON.stringify(b.loadErrors));
  const learn = Object.keys(b.results).filter(k => k.indexOf('learning.') === 0);
  assert.ok(learn.length >= 4, 'مِجسّات التعلّم: ' + learn.join(', '));
  const failed = learn.filter(k => b.results[k].ok !== true);
  assert.deepStrictEqual(failed, [], 'مِجسّاتٌ ساقطة: ' + failed.join(', '));
  // والبطاريةُ كلها — التقسيم قد يكسر مِجسًّا خارج التعلّم
  assert.deepStrictEqual(b.failed, [], 'البطارية: ' + JSON.stringify(b.failed));
});

test('[BL-5] كلُّ ملفِّ تعلّمٍ موجود مُعلَنٌ في البيانات الثلاثة، وبالترتيب', () => {
  // البياناتُ ثلاثة ولا رابط بينها إلا هذا الحارس. وكان يُثبّت «لم تُعلَن
  // بعد»؛ صار يُثبّت الثابت الحيّ: ما يوجد على القرص يُعلَن في الثلاثة،
  // وطبقتا المعرفة والتحقّق **قبل** المحرّك — فالحلّ كسولٌ لكن الترتيب
  // الصحيح يمنع الاعتماد عليه أصلًا.
  const html    = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const analyze = fs.readFileSync(path.join(__dirname, '..', 'api', 'analyze.js'), 'utf8');
  const esd     = fs.readFileSync(path.join(PUBLIC_DIR, 'engine_self_diagnosis.js'), 'utf8');
  const manifests = [['index.html', html], ['api/analyze.js', analyze], ['ESD MODULES', esd]];

  const LEARN_FILES = ['learning_validation.js', 'learning_knowledge.js', 'learning_engine.js'];
  const onDisk = LEARN_FILES.filter(f => fs.existsSync(path.join(PUBLIC_DIR, f)));
  assert.ok(onDisk.includes('learning_engine.js'), 'المحرّك نفسه غير موجود');

  for (const [label, src] of manifests) {
    for (const f of LEARN_FILES) {
      const declared = src.includes(f);
      const exists = onDisk.includes(f);
      assert.strictEqual(declared, exists,
        label + ': ' + f + (exists ? ' موجودٌ وغيرُ مُعلَن' : ' مُعلَنٌ وغيرُ موجود'));
    }
    // الترتيب: التحقّق ثم المعرفة ثم المحرّك
    const at = f => src.indexOf(f);
    for (const dep of ['learning_validation.js', 'learning_knowledge.js']) {
      if (!onDisk.includes(dep)) continue;
      assert.ok(at(dep) < at('learning_engine.js'),
        label + ': ' + dep + ' مُعلَنٌ بعد المحرّك');
    }
  }
});
