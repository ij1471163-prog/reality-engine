// ═══════════════════════════════════════════════════════
// learning_knowledge.js — طبقةُ المعرفة: التخزين واستخراج المعرفة
// ═══════════════════════════════════════════════════════
// الطبقةُ الوسطى من التعلّم. مسؤوليتُها شيئان لا ثالث لهما:
//
//   (1) المخزن — قراءةُ ‎re_learned_patterns_v2‎ وكتابتُه، والسقفُ والإخلاءُ
//       المرتَّب، وإعلانُ الكتابة المفقودة بدل ابتلاعها.
//   (2) استخراجُ المعرفة من الكود — فرقُ LCS، واستنتاجُ اللغة والسياق،
//       والبصمة، وتعميمُ زوج السطرين إلى قالب، ومطابقةُ القالب وتركيبُه.
//
// وما ليس منها: قرارُ القبول والعتبات والحظر (طبقةُ التحقّق
// learning_validation.js)، وتنسيقُ الدورة learn/apply/verify
// (learning_engine.js). فالتبعيةُ باتجاهٍ واحد: محرّك ← معرفة ← تحقّق.
"use strict";

var LearningKnowledge = (() => {

  const STORAGE_KEY = 're_learned_patterns_v2';

  // ─── طبقةُ التحقّق — حلٌّ كسولٌ لا اعتمادٌ وقت التحميل ───────────────
  // لا نظامَ وحدات هنا: الملفات سكربتاتٌ في نطاقٍ عام، فالاعتمادُ يُحلّ عند
  // أول استعمال. وغيابُها خطأٌ صريح لا تدهورٌ صامت.
  let _Vcache = null;
  function _V() {
    if (_Vcache) return _Vcache;
    try { if (typeof LearningValidation !== 'undefined' && LearningValidation) return (_Vcache = LearningValidation); } catch (e) {}
    try {
      if (typeof globalThis !== 'undefined' && globalThis.LearningValidation) return (_Vcache = globalThis.LearningValidation);
      if (typeof window !== 'undefined' && window.LearningValidation) return (_Vcache = window.LearningValidation);
    } catch (e) {}
    try { if (typeof require === 'function') return (_Vcache = require('./learning_validation.js')); } catch (e) {}
    throw new Error('LearningValidation غير محمَّل — راجع ترتيب السكربتات');
  }

  const isSafe            = (l)          => _V().isSafe(l);
  const pickCorresponding = (t, h, b, r) => _V().pickCorresponding(t, h, b, r);
  const deriveApproval    = (p)          => _V().deriveApproval(p);

  // ─── [S4] ترحيلُ المخزن — نفسُ المفتاح، بلا نسخةٍ وبلا فقد ───────────
  //
  // المفتاحُ لا يتغيّر: ‎re_learned_patterns_v2‎ هو موضعُ البيانات قبل
  // التقسيم وبعده. فلا نسخةَ ثانية تُكتب، ولا هجرةَ مفتاحٍ تُفقد سجلًّا إن
  // توقّفت في منتصفها، ولا نسخةٌ قديمة تبقى تتباعد عن الحديثة.
  //
  // وما يُرحَّل ليس شكلَ البيانات بل **ما يُؤتمَن منها**:
  //
  //   • العدّادات (observed/verified/failures) والتواريخ والقالب المعمَّم
  //     ومفاتيحُ الهوية — تبقى كما هي حرفًا بحرف. هي الدليلُ المُكتسَب،
  //     وإسقاطُها إسقاطٌ لتعلّمٍ حقيقي.
  //   • ‎approved‎ و‎confidence‎ — يُعاد اشتقاقهما من العدّادات بقواعد اليوم،
  //     ولا يُورَّثان أبدًا. سجلٌّ كُتب اعتمادُه بعتبةٍ أقدم أو بمنحنى ثقةٍ
  //     آخر لا يُستأنَف اعتمادُه بلا دليل: الدليلُ باقٍ والحكمُ يُستأنف.
  //     والأثرُ المُعلَن: ما لا تُجيزه قواعدُ اليوم يعود «قيد جمع الأدلة»،
  //     فيبقى محفوظًا ويُعتمد متى بلغ العتبة — لا يُحذف.
  //
  // والترحيلُ خامدُ التكرار (idempotent) بحكم بنيته: دالةٌ من العدّادات
  // إلى الحكم، فتطبيقُها مرةً كتطبيقِها ألفًا. ولذلك تُنادى عند كل قراءة
  // في الذاكرة، ولا تُكتب من مسار القراءة — الوسمُ يلحق أول كتابةٍ
  // تجري على المخزن لسببها الخاص. فلا قراءةَ لها أثرٌ جانبي.
  //
  // ولأنها تُنادى عند كل قراءة لا مرةً واحدة بوسمٍ يحرسها، فأثرُها أوسعُ
  // من ترحيلٍ لمرة:
  //   ✔ المكسب: حقلُ ‎approved‎ في المخزن لا يمنح ثقةً أبدًا — لا سجلٌّ
  //     عُدِّل بيدٍ في أدوات المتصفح، ولا سجلٌّ كُتب بعتبةٍ أقدم، ولا سجلٌّ
  //     تلف. العدّاداتُ وحدها دليل. وفي محرّكٍ يطبّق إصلاحاتٍ على كودٍ
  //     حقيقي، هذا حدُّ ثقةٍ لا رفاهية. وأيُّ تغييرٍ في العتبات يسري على
  //     المخزن كلّه بلا ترحيلٍ ثانٍ.
  //   ⚠️ الكلفة المُعلَنة: صنفٌ من الخلل يصير غيرَ مرئي — خللٌ يكتب
  //     ‎approved‎ خطأً يُصحَّح عند القراءة فلا يُشاهد أثرُه. ومن ذلك مِرساةٌ
  //     كانت في ‎[E2E-9b]‎ (حقنُ ‎approved: true‎) فنُقلت إلى حقنِ دليلٍ
  //     كاذب ‎verified: 0 → 9‎، وهي أقربُ إلى شكل الخلل الواقعي. والمقيسُ
  //     أن الخللَ في العدّاد ما زال مرئيًا — وهو ما يهمّ: العدّادُ هو
  //     الدليل، والحكمُ مشتقٌّ منه.
  const SCHEMA_VERSION = 3;

  function migrate(db) {
    if (!db || typeof db !== 'object') return db;
    if (Array.isArray(db.patterns)) {
      for (const p of db.patterns) {
        if (p && typeof p === 'object') deriveApproval(p);
      }
    }
    return db;
  }

  // ─── Storage ────────────────────────────────────────
  function load() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return migrate(data ? JSON.parse(data) : { patterns: [], safe: [], meta: { total: 0 } });
    } catch(e) {
      return { patterns: [], safe: [], meta: { total: 0 } };
    }
  }

  // [P3] سعة المخزن. القياس: نمطٌ متعلَّم واقعي ≈ 1,067 بايت (تشغيل حقيقي
  // على ملف js: أكبر نمط 1,111B وأصغره 977B)، أي أن حصّة localStorage
  // المعتادة (5MB) تتسع لـ4,915 نمطًا تقريبًا ثم ترفض الكتابة. السقف أدناه
  // يترك أكثر من نصف الحصّة هامشًا لقائمة safe ولعبء المتصفح.
  const MAX_PATTERNS = 2000;

  // [P3] عدّاد كتابات فُقدت في هذه الجلسة. لا يُحفَظ — المخزن نفسه هو ما
  // يرفض الكتابة — فيُقرأ من getStats() كإشارة تشغيلية حاضرة فقط.
  let saveFailures = 0;

  // [P3] ترتيب الإخلاء بقيمة السجل = ما يقدّمه ÷ كلفة استعادته:
  //   رتبة 0 — قيد جمع الأدلة (لا معتمد ولا محظور): لا قدرة إصلاح ولا حماية،
  //            وكلفة استعادته مشاهدة واحدة. فهو منطقة الفائض الطبيعية.
  //   رتبة 1 — محظور (failures ≥ 3): شاهدُ قبرٍ نافع — learn() لا تتعلّم قاعدة
  //            كل مطابقيها محظورون، فإسقاطه يسمح بإعادة تعلّمها. لكن حمايته
  //            حمايةُ كفاءة لا سلامة: البوابة وGhost يرفضان التعديل الضارّ
  //            مرة بعد مرة حتى يُحظر النمط من جديد.
  //   رتبة 2 — معتمد: قدرة إصلاح قائمة، وكلفة استعادتها تحقّقان جديدان. آخر
  //            ما يُخلى.
  // وداخل الرتبة: الأقدم لمسًا أولاً (lastUsed ثم lastSeen ثم created).
  function evictionRank(p) {
    if ((p.failures || 0) >= 3) return 1;
    if (!p.approved) return 0;
    return 2;
  }

  // [P3] lastUsed كان يُكتب في markUsed ولا يُقرأ في أي موضع — حقلٌ معزول.
  // هنا يصير معنى: آخر استعمالٍ أقرَّته البوابة هو ما يحمي النمط من الإخلاء.
  function lastTouch(p) {
    return p.lastUsed || p.lastSeen || p.created || 0;
  }

  function pruneToCap(db, cap) {
    const limit = (typeof cap === 'number' && cap > 0) ? cap : MAX_PATTERNS;
    if (!db || !Array.isArray(db.patterns) || db.patterns.length <= limit) return 0;
    const ordered = db.patterns.slice().sort((a, b) =>
      (evictionRank(a) - evictionRank(b)) || (lastTouch(a) - lastTouch(b)));
    const drop = new Set(ordered.slice(0, db.patterns.length - limit));
    db.patterns = db.patterns.filter(p => !drop.has(p));
    db.meta = db.meta || {};
    db.meta.evicted = (db.meta.evicted || 0) + drop.size;
    return drop.size;
  }

  // [P3] كان الفقد صامتًا: catch فارغ يبتلع QuotaExceededError فتُعلن الدالة
  // المنادية النجاح والمخزن لم يتغيّر. المقيس على مخزن يرفض الزيادة:
  //   verify('p', false) أرجعت 'p'  و  failures بقي 0  ⇒  الحظر يُفقد،
  // وحلقة التغذية الراجعة كلها مبنيّة على أن هذا الرقم يصل. فالآن:
  //   (1) ترجع الدالة صوابًا/خطأً، (2) تُقلِّص المخزن مرة وتُعيد المحاولة،
  //   (3) تُسجّل الفقد في عدّاد يظهر في getStats().
  function save(db) {
    try {
      // [S4] وسمُ الشكل يلحق الكتابة لا القراءة: من يكتب فقد ملك المخزن
      // بشكله الحالي، فيُعلنه. والقارئ لا يُغيّر شيئًا.
      if (db && typeof db === 'object') {
        db.meta = db.meta || {};
        db.meta.schemaVersion = SCHEMA_VERSION;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      // محاولة إنعاش واحدة: أخلِ النصف الأقل قيمة ثم أعد الكتابة.
      try {
        const half = Math.max(1, Math.floor((db && Array.isArray(db.patterns)
          ? db.patterns.length : MAX_PATTERNS) / 2));
        if (pruneToCap(db, half) > 0) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
          return true;
        }
      } catch (e2) { /* ما زال يرفض — يُعلَن أدناه */ }
      saveFailures++;
      try {
        console.warn('[LearningEngine] فشل حفظ المخزن — الكتابة فُقدت (' + saveFailures + ')');
      } catch (e3) {}
      return false;
    }
  }

  // ─── LCS Diff (blocks) ─────────────────────────────
  //
  // [LCS-MEMO] الفرقُ دالةٌ في النصّين، و‎learn()‎ تسأل عنه مرةً لكل بلاغ.
  //
  // ‎extractPair‎ تُعيد حسابَ الفرق كاملًا لكل بلاغ، وهو لا يعتمد على البلاغ
  // إطلاقًا — إنما على ‎codeBefore‎ و‎codeAfter‎ وحدهما، وهما ثابتان طوال
  // النداء. والجدولُ ‎O(n×m)‎، فالكلفةُ تتربّع مع الحجم.
  //
  // المقيس على ملفٍ من 472 سطرًا بـ255 بلاغًا، بمُحلِّل معالجٍ حقيقي:
  //
  //     fixAllEngine الكلي        20,555 ms
  //     منها lcsBlocks            16,656 ms   (78% من الزمن كلّه)
  //     learn() وحدها             15,123 ms
  //
  // أي 255 حسابًا متطابقًا لجدولٍ من 472×472 خانة. والنموُّ فوق-خطّي:
  // 59 سطرًا ⇒ 548ms، و472 سطرًا ⇒ 20.5 ثانية.
  //
  // والحفظُ لا يغيّر ناتجًا: الدالةُ خالصة — مصفوفتا نصوصٍ إلى كتلٍ، بلا
  // حالةٍ ولا عشوائية. والمُستهلكون يقرأون ولا يكتبون (‎find‎ و‎some‎
  // وفهرسة)، فلا تلوّثَ بين نداءين. والحدُّ أربعةُ مداخل: الجدولُ كبير،
  // والمطلوبُ نصُّ هذا النداء لا تاريخُه.
  const _LCS_CAP = 4;
  const _lcsMemo = new Map();

  function lcsBlocks(before, after) {
    // المفتاحُ حاصر: ‎JSON.stringify‎ لمصفوفتين يُفكَّك إليهما بلا لبس.
    //
    // وما قبله كان يفصل بـ‎\u0000‎ ويُقدّم عدَدَي **أسطر** لا أحرف، فلا
    // يحسمان موضعَ الفاصل إن ورد ‎\u0000‎ داخل سطرٍ من المحتوى. والمقيس —
    // زوجان مختلفان تمامًا بمفتاحٍ واحد:
    //
    //     before=['a\0b'] after=['c']     ⇒ "1\u00011\u0001a\0b\0c"
    //     before=['a']    after=['b\0c']  ⇒ "1\u00011\u0001a\0b\0c"
    //
    // فيأخذ الثاني فرقَ الأول. وأثرُه ليس بطئًا بل **فرقًا خاطئًا** يُغذّي
    // ‎extractPair‎ ⇒ إمّا لا تعلّمَ، وإمّا زوجٌ خاطئٌ يُكتَب في المخزن.
    // ويُغلق المفتاحُ الجديد كذلك لبسًا ثانيًا كان قائمًا: مصفوفتان بعدَدٍ
    // واحدٍ تضمّان إلى نفس النصّ لا يميّزهما العدُّ ولا الضمّ —
    // ‎['a','b\nc']‎ و‎['a\nb','c']‎ كلتاهما ‎2‎ وكلتاهما ‎'a\nb\nc'‎.
    // (غيرُ نافذٍ من الإنتاج: ‎extractPair‎ تُمرّر ناتجَ ‎split('\n')‎ فلا
    //  عنصرَ فيه ‎\n‎. لكن ‎lcsBlocks‎ مُصدَّرةٌ فيبلغها مُستهلكٌ آخر.)
    //
    // وبُدِئ بمفتاحٍ أرخصَ ظاهرًا — عدّادان وطولُ ‎bj‎ بالأحرف — فأُسقط: هو
    // يُغلق تصادمَ ‎\0‎ ويترك اللبسَ الثاني قائمًا، وقياسُه على أحدَ عشرَ
    // جولةً متناوبة لم يكن أرخص (الوسيط ‎+9%‎ مقابل ‎+3.5%‎ لـ‎JSON‎، ومدى
    // الثلاثة متداخلٌ كلُّه: 137–259 ms، أي أن الفرقَ ضجيجٌ لا مكسب).
    // ومفتاحٌ بأطوال العناصر قِيس ‎+125%‎ فسقط قطعًا.
    const key = JSON.stringify([before, after]);
    const hit = _lcsMemo.get(key);
    if (hit) return hit;
    const val = _lcsBlocksUncached(before, after);
    if (_lcsMemo.size >= _LCS_CAP) _lcsMemo.clear();
    _lcsMemo.set(key, val);
    return val;
  }

  function _lcsBlocksUncached(before, after) {
    const n = before.length, m = after.length;
    const dp = Array.from({length: n+1}, () => new Array(m+1).fill(0));
    for (let i = 1; i <= n; i++)
      for (let j = 1; j <= m; j++)
        dp[i][j] = before[i-1] === after[j-1]
          ? dp[i-1][j-1]+1
          : Math.max(dp[i-1][j], dp[i][j-1]);

    const ops = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && before[i-1] === after[j-1]) {
        ops.unshift({ type:'eq', bi:i-1, ai:j-1 }); i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
        ops.unshift({ type:'add', ai:j-1, line:after[j-1] }); j--;
      } else {
        ops.unshift({ type:'del', bi:i-1, line:before[i-1] }); i--;
      }
    }

    const blocks = [];
    let cur = null;
    for (const op of ops) {
      if (op.type === 'eq') { cur = null; continue; }
      if (!cur) { cur = { removed:[], added:[] }; blocks.push(cur); }
      if (op.type === 'del') cur.removed.push({ idx:op.bi, line:op.line });
      if (op.type === 'add') cur.added.push({ idx:op.ai, line:op.line });
    }
    return blocks;
  }

  // ─── Language Inference ─────────────────────────────
  function inferLanguage(fileName) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    const map = { js:'js', ts:'ts', py:'py', php:'php', java:'java', html:'html', css:'css', rb:'ruby', go:'go', cs:'csharp' };
    return map[ext] || 'unknown';
  }

  // ─── Context Extraction ──────────────────────────────
  function extractContext(code, lineIdx) {
    const lines = code.split('\n');
    const line = lines[lineIdx] || '';

    // ابحث عن اسم الدالة المحيطة
    let functionName = null;
    for (let i = lineIdx; i >= 0; i--) {
      const m = lines[i].match(/(?:function|def|public|private|async)\s+(\w+)\s*\(/);
      if (m) { functionName = m[1]; break; }
    }

    // scope
    const scope = line.includes('class ') ? 'class'
      : functionName ? 'function'
      : 'module';

    return { functionName: functionName || null, scope };
  }

  // ─── Fingerprint ─────────────────────────────────────
  function makeFingerprint(type, language, before, context) {
    // normalize before — حذف مسافات زائدة وتوحيد
    const norm = (before || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const scope = context ? context.scope : 'global';
    const fn    = context ? (context.functionName || 'global') : 'global';
    const str   = `${type}|${language}|${norm}|${scope}:${fn}`;
    // simple hash بدون مكتبات خارجية
    let h = 0;
    for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    return Math.abs(h).toString(36);
  }

  // ─── Generalized Pattern Learning ───────────────────
  // يتعلم فكرة الإصلاح بدل نسخ السطر حرفياً.
  function generalizeLinePair(before, after) {
    if (!before || !after || before === after) return null;

    const identifierRe = /\b[A-Za-z_$][\w$]*\b/g;

    const KEYWORDS = new Set([
      'const','let','var','function','def','return','new','this','self',
      'class','public','private','protected','static','final','import',
      'from','require','if','else','for','while','try','catch',
      'async','await','true','false','null','undefined'
    ]);

    function maskStrings(source) {
      let out = '';
      let quote = null;
      let escaped = false;

      for (const ch of String(source)) {
        if (quote !== null) {
          out += ' ';

          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === quote) quote = null;

          continue;
        }

        if (ch === '"' || ch === "'" || ch === '`') {
          quote = ch;
          out += ' ';
        } else {
          out += ch;
        }
      }

      return out;
    }

    const stringRe = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

    // [FIX] لا يُجرَّد إلا ما لم يُغيّره الإصلاح.
    //
    // كانت كل نصوص ومعرّفات السطر تُبدَّل بخانات، بما فيها الرمزُ الذي
    // يُعرِّف الثغرة. فالقالب يفقد ما يميّز الشكل المعيب ويصير يطابق كوداً
    // سليماً. والمقيس على الأزواج الصحيحة الثلاثة المقصود تعلّمها:
    //   secret: const __ID_1__ = __STR_1__;  →  const __ID_1__ = process.env.__ID_1__;
    //     فيحوّل  const APP_NAME = "Reality Engine"  إلى process.env.APP_NAME
    //   md5:    const __ID_1__ = __ID_2__.__ID_3__(__STR_1__);  →  … ("sha256");
    //     فيحوّل  const p = path.join("config")  إلى  path.join("sha256")
    //   xss:    __ID_1__.__ID_2__ = __ID_3__.__ID_4__;  →  __ID_1__.textContent = …
    //     فيحوّل  cfg.timeout = opts.value  إلى  cfg.textContent = opts.value
    // والثلاثة تجتاز GhostMode و learnedSyntaxOk و FixVerifier معاً.
    //
    // الرمز الذي يغيّره الإصلاح هو إشارة الثغرة ("md5"، innerHTML، النص
    // السرّي)، فيبقى حرفياً في القالب فلا يطابق إلا الشكل المعيب. وما يبقى
    // قابلاً للتجريد هو سياق الإصلاح: ما ورد في الطرفين بلا تغيير.
    const afterStrings = new Set(String(after).match(stringRe) || []);
    const afterIds = new Set(
      maskStrings(after).match(/\b[A-Za-z_$][\w$]*\b/g) || []
    );

    const strings = [];
    const beforeWithStringSlots = before.replace(stringRe, value => {
      if (!afterStrings.has(value)) return value; // غيّره الإصلاح ⇒ إشارة
      const id = `STR_${strings.length + 1}`;
      strings.push({
        id,
        kind: 'string',
        value
      });
      return `__LEARN_${id}__`;
    });

    const afterWithStringSlots = after.replace(stringRe, value => {
      const found = strings.find(x => x.value === value);
      return found ? `__LEARN_${found.id}__` : value;
    });

    const placeholderRe = /__LEARN_STR_\d+__/g;
    const beforeForIds = maskStrings(
      beforeWithStringSlots.replace(placeholderRe, ' ')
    );

    const beforeIds = [];
    let m;

    while ((m = identifierRe.exec(beforeForIds)) !== null) {
      const id = m[0];

      // afterIds: المعرّف الذي لم يَرِد في طرف الإصلاح غيّره الإصلاح، فهو
      // إشارة الثغرة لا سياقها ⇒ يبقى حرفياً.
      if (!KEYWORDS.has(id) && !beforeIds.includes(id) && afterIds.has(id)) {
        beforeIds.push(id);
      }
    }

    // بلا رمز واحد قابل للتجريد لا تعميم — والتعلّم بالمطابقة الحرفية يبقى.
    if (!beforeIds.length) return null;

    const idSlots = beforeIds.map((value, i) => ({
      id: `ID_${i + 1}`,
      kind: 'identifier',
      value
    }));

    const slots = [...strings, ...idSlots];

    let beforeTemplate = beforeWithStringSlots;
    let afterTemplate = afterWithStringSlots;

    const sorted = [...beforeIds].sort((a, b) => b.length - a.length);

    for (const value of sorted) {
      const slot = idSlots.find(x => x.value === value);
      const escaped = value.replace(/[.*+?^$()[\]{}|\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`, 'g');

      beforeTemplate = beforeTemplate.replace(
        re,
        `__LEARN_${slot.id}__`
      );

      afterTemplate = afterTemplate.replace(
        re,
        `__LEARN_${slot.id}__`
      );
    }

    const fixedBefore = beforeTemplate
      .replace(/__LEARN_ID_\d+__/g, '')
      .replace(/\s+/g, '');

    if (fixedBefore.length < 3) return null;

    return {
      beforeTemplate: beforeTemplate.replace(/\s+/g, ' ').trim(),
      afterTemplate: afterTemplate.replace(/\s+/g, ' ').trim(),
      beforeSlots: slots,
      afterSlots: slots,
      sharedTokens: beforeIds.filter(id => after.includes(id))
    };
  }

  // ─── Extract Pair (LCS + Fail Closed) ────────────────
  function extractPair(codeBefore, codeAfter, issue) {
    const linesBefore = codeBefore.split('\n');
    const linesAfter  = codeAfter.split('\n');
    const ln          = (issue.line || 1) - 1;
    const beforeLine  = linesBefore[ln]?.trim() || '';

    if (!beforeLine || isSafe(beforeLine)) return null;

    // LCS blocks
    const blocks = lcsBlocks(
      linesBefore.map(l => l.trim()),
      linesAfter.map(l => l.trim())
    );

    // الـ hunk اللي يحتوي issue line
    const hunk = blocks.find(b => b.removed.some(r => r.idx === ln));
    if (!hunk || !hunk.added.length) return null;

    // تصنيفُ البلاغ موزَّعٌ على حقولٍ عدّة، فيُقرأ من **مجموعها** لا من أوّل
    // حقلٍ غير فارغ. و‎(type || cAct)‎ كان يُسقط سطحًا كاملًا من التعلّم:
    // بلاغُ التراكم ‎type="bug"‎ واسمُه ‎strategy="ACCUMULATION"‎، و‎type‎ غيرُ
    // فارغ فلا يُقرأ ما بعده ⇒ ‎t="bug"‎ ⇒ لا مفتاحَ في TYPE_FIXES يطابقه ⇒
    // ‎knownType=false‎ ⇒ ‎null‎. أي أن زوجَ ‎= → +=‎ الصحيح كان لا يصل التعلّم
    // إطلاقًا، لا لعطبٍ في التعلّم بل لحقلٍ لم يُقرأ. ونفسُ العِلّة تُسكِت أيَّ
    // بلاغٍ يحمل كلمةً عامّة في ‎type‎ وتصنيفَه الحقيقي في غيره.
    //
    // ولا يُوسّع ذلك القبول: المفتاحُ المطابق يُلزِم سطرَ الإصلاح بشكلِ صنفه
    // (TYPE_FIXES أدناه)، والمجهولُ يُرفض كما كان — fail-closed قائم.
    const t = [issue.type, issue.cAct, issue.strategy]
      .map(v => String(v == null ? '' : v)).join(' ').toLowerCase();

    // TYPE_FIXES — ربط نوع الثغرة بـ regex الإصلاح
    const TYPE_FIXES = {
      secret:    /process\.env|os\.environ\.get|getenv/,
      hardcoded: /process\.env|os\.environ\.get|getenv/,
      cwe_798:   /process\.env|os\.environ\.get|getenv/,
      sql:       /\?|prepare|parameterized|db\.query/,
      cwe_89:    /\?|prepare|parameterized/,
      xss:       /textContent|htmlspecialchars|sanitize|DOMPurify/,
      crypto:    /sha256|bcrypt|argon2/,
      cwe_327:   /sha256|bcrypt|argon2/,
      eval:      /JSON\.parse|safeEval/,
      cwe_094:   /JSON\.parse|safeEval/,
      cmd:       /execFile|allowedCmds/,
      accumul:   /\+=/,
      counter:   /\+=/,
    };

    // Fail Closed: لو النوع غير معروف → رفض
    const knownType = Object.keys(TYPE_FIXES).some(k => t.includes(k));
    if (!knownType) return null;

    // فلتر candidates من نفس الـ hunk
    const candidates = hunk.added.filter(a => {
      const l = a.line;
      if (!l || l.length < 5) return false;
      if (/^\/\//.test(l)) return false;
      if (/^[{}();,#]$/.test(l)) return false;
      return true;
    });

    if (!candidates.length) return null;

    // اختر الـ candidate المقابل فعلياً للسطر الأصلي داخل نفس الـhunk
    const removedRank = hunk.removed.findIndex(r => r.idx === ln);

    let afterLine = '';
    for (const [key, regex] of Object.entries(TYPE_FIXES)) {
      if (!t.includes(key)) continue;
      const typed = candidates.filter(c => regex.test(c.line));
      const match = pickCorresponding(typed, hunk, beforeLine, removedRank);
      if (match) { afterLine = match.line; break; }
    }

    // Fail Closed: لو ما في match → رفض
    if (!afterLine || afterLine === beforeLine) return null;

    return {
      type:     issue.type || issue.cAct || 'unknown',
      severity: issue.sev  || 'c',
      before:   beforeLine,
      after:    afterLine,
    };
  }

  // ─── Generalized Pattern Matching ───────────────────
  function matchGeneralPattern(line, pattern) {
    if (!pattern || !pattern.beforeTemplate) return null;

    const template = pattern.beforeTemplate;
    const tokenRe = /__LEARN_(ID_[0-9]+|STR_[0-9]+)__/g;

    // [VBR] خانة تتكرّر في القالب كانت تُنتج مجموعة التقاط مستقلة لكل ظهور،
    // بلا مرجع خلفي. فيترتّب على ذلك أمران مقيسان:
    //   (1) القالب يطابق سطورًا تختلف فيها مواضع الخانة الواحدة، و
    //   (2) حلقة القيم تكتب فوق القيمة فيبقى آخر ظهور وحده فيُركَّب في الكل.
    // المقيس:  a.innerHTML = b.innerHTML + m   ⇒   b.textContent = b.textContent + m
    //          (وجهة الكتابة تبدّلت، والكتابة إلى a اختفت)
    //          db.query("a=" + x + " b=" + y)  ⇒   db.query("a=? b=?", [y, y])
    //          (x فُقد صامتًا)
    // groupOf يربط كل خانة بمجموعتها، فالظهور التالي مرجع خلفي لا مجموعة جديدة،
    // أي أن القالب يشترط تساوي المواضع — وهو المعنى المقصود من تكرار الخانة.
    let regex = "";
    const groupOf = {};
    let groupNo = 0;
    let last = 0;
    let match;

    while ((match = tokenRe.exec(template)) !== null) {
      regex += template.slice(last, match.index)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const slotId = match[1];
      const slot = (pattern.beforeSlots || []).find(x => x.id === slotId);

      if (!slot) return null;

      // ظهور تالٍ لخانة سبقت ⇒ مرجع خلفي، فالموضعان يجب أن يتساويا.
      if (Object.prototype.hasOwnProperty.call(groupOf, slotId)) {
        regex += "\\" + groupOf[slotId];
        last = match.index + match[0].length;
        continue;
      }
      groupNo++;
      groupOf[slotId] = groupNo;

      if (slot.kind === "string") {
        regex += '((?:"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`))';
      } else {
        regex += "([A-Za-z_$][A-Za-z0-9_$]*)";
      }

      last = match.index + match[0].length;
    }

    regex += template.slice(last)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const result = new RegExp("^" + regex + "$").exec(line);
    if (!result) return null;

    // قيمة واحدة لكل خانة، من مجموعتها وحدها — لا كتابة فوق قيمة سابقة.
    const values = {};
    for (const slotId in groupOf) values[slotId] = result[groupOf[slotId]];

    return { values };
  }

  function renderGeneralTemplate(template, values) {
    if (!template || !values) return null;

    return template.replace(
      /__LEARN_(ID_[0-9]+|STR_[0-9]+)__/g,
      function(token) {
        const id = token.slice(8, -2);
        return Object.prototype.hasOwnProperty.call(values, id)
          ? values[id]
          : token;
      }
    );
  }

  // ─── مسحُ المخزن ─────────────────────────────────────
  // reset() في المحرّك كانت تنادي localStorage مباشرةً بمفتاحٍ يملكه هذا
  // الملف. فالمفتاحُ يبقى في موضعٍ واحد، والمسحُ طلبٌ يُوجَّه إلى مالكه.
  function clear() {
    try { localStorage.removeItem(STORAGE_KEY); return true; } catch (e) { return false; }
  }

  return {
    STORAGE_KEY, MAX_PATTERNS, SCHEMA_VERSION,
    migrate,
    // عدّادُ الكتابات المفقودة يُقرأ لحظةَ السؤال لا لحظةَ الربط
    get saveFailures() { return saveFailures; },

    load, save, clear, pruneToCap, evictionRank, lastTouch,

    lcsBlocks, inferLanguage, extractContext, makeFingerprint,
    generalizeLinePair, extractPair,
    matchGeneralPattern, renderGeneralTemplate,
  };
})();

if (typeof window !== 'undefined') window.LearningKnowledge = LearningKnowledge;
if (typeof module !== 'undefined') module.exports = LearningKnowledge;
