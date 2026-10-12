// ═══════════════════════════════════════════════════════
// learning_engine.js v2.1 — Evidence-based Learning
// يتعلم فقط من إصلاحات تحقق منها Ghost Mode
// ═══════════════════════════════════════════════════════
// الطبقةُ الخارجية من التعلّم: تنسيقُ الدورة وحدها —
//   learn      : من الكود قبل/بعد إلى دليلٍ متراكم على قاعدة
//   applyLearned: من المخزن إلى تعديلٍ مقترح، بالمسارين الحرفي والمعمَّم
//   verify/markUsed: التغذيةُ الراجعة من البوابة إلى المخزن
//   getStats/getBoosts/reset/learnSafe
//
// وما ليس منها — ولم يبقَ فيها:
//   • القرارُ (العتبات، الثقة، الحظر، الأهلية، حرّاسُ التقابل) ⇒
//     learning_validation.js
//   • المخزنُ واستخراجُ المعرفة (localStorage، السقف، LCS، البصمة،
//     التعميم، المطابقة، التركيب) ⇒ learning_knowledge.js
//
// والواجهةُ العامّة لم تتغيّر بحرفٍ عبر التقسيم: ثماني دوال، نفسُ التواقيع،
// ونفسُ مفتاح التخزين — يحرسها اختبارُ اللقطة المرجعية
// (test/learning_baseline_snapshot.test.js).
"use strict";

var LearningEngine = (() => {


  // ─── [S1] طبقةُ التحقّق — حلٌّ كسولٌ لا اعتمادٌ وقت التحميل ──────────
  //
  // لا نظامَ وحدات هنا: الملفات سكربتاتٌ في نطاقٍ عام. فالاعتمادُ يُحلّ عند
  // أول استعمال لا عند التحميل، فلا يكسر اختلافُ الترتيب شيئًا. وغيابُها
  // خطأٌ صريح لا تدهورٌ صامت: تعلّمٌ بلا تحقّقٍ أسوأ من تعلّمٍ متوقف.
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

  // سطحُ اعتماد المحرّك على الطبقتين، مُعلَنًا في موضعٍ واحد. وما سقط منه
  // بعد نقل الكتل حُذف: اسمٌ محليٌّ لا مُستدعٍ له يُشهِر اعتمادًا غير قائم.
  const isSafe                = (l)       => _V().isSafe(l);
  const isGeneralPatternUsable= (p, lang) => _V().isGeneralPatternUsable(p, lang);
  const isPairUsable          = (p, fn)   => _V().isPairUsable(p, fn);
  const preservesTarget       = (b, a)    => _V().preservesTarget(b, a);
  const preservesValueOrder   = (b, a)    => _V().preservesValueOrder(b, a);

  // ─── [S2] طبقةُ المعرفة — المخزنُ واستخراجُ المعرفة ─────────────────
  //
  // نفسُ نمطِ الحلّ الكسول: المعرفةُ تُحلّ عند أول استعمال، وغيابُها خطأٌ
  // صريح. فالمحرّك لا يلمس localStorage ولا يعرف شكلَ القوالب؛ يطلبهما.
  let _Kcache = null;
  function _K() {
    if (_Kcache) return _Kcache;
    try { if (typeof LearningKnowledge !== 'undefined' && LearningKnowledge) return (_Kcache = LearningKnowledge); } catch (e) {}
    try {
      if (typeof globalThis !== 'undefined' && globalThis.LearningKnowledge) return (_Kcache = globalThis.LearningKnowledge);
      if (typeof window !== 'undefined' && window.LearningKnowledge) return (_Kcache = window.LearningKnowledge);
    } catch (e) {}
    try { if (typeof require === 'function') return (_Kcache = require('./learning_knowledge.js')); } catch (e) {}
    throw new Error('LearningKnowledge غير محمَّل — راجع ترتيب السكربتات');
  }

  const load                  = ()        => _K().load();
  const save                  = (db)      => _K().save(db);
  const pruneToCap            = (db, c)   => _K().pruneToCap(db, c);
  const inferLanguage         = (f)       => _K().inferLanguage(f);
  const extractContext        = (c, i)    => _K().extractContext(c, i);
  const makeFingerprint       = (t, l, b, c) => _K().makeFingerprint(t, l, b, c);
  const generalizeLinePair    = (b, a)    => _K().generalizeLinePair(b, a);
  const extractPair           = (b, a, i) => _K().extractPair(b, a, i);
  const matchGeneralPattern   = (l, p)    => _K().matchGeneralPattern(l, p);
  const renderGeneralTemplate = (t, v)    => _K().renderGeneralTemplate(t, v);


  // ─── Learn ──────────────────────────────────────────
  function learn(codeBefore, codeAfter, issues, fileName) {
    if (!codeBefore || !codeAfter || codeBefore === codeAfter) return 0;

    const db = load();
    const learnedIds = []; // IDs للـ patterns الجديدة أو الموجودة

    issues.forEach(issue => {
      const pair = extractPair(codeBefore, codeAfter, issue);
      if (!pair) return;
      // after مشوّه ⇒ لا يُخزَّن (لا نصلحه ولا نغيّره)
      if (!isPairUsable(pair, fileName)) return;

      // استخرج language + context + fingerprint أولاً
      const lang = inferLanguage(fileName);
      const ctx  = extractContext(codeBefore, (issue.line||1)-1);
      const fp   = makeFingerprint(pair.type, lang, pair.before, ctx);

      // [C1] الدليل يتراكم على القالب المعمَّم، لا على السطر الحرفي.
      //
      // كانت هوية السجل بصمةَ (النوع|اللغة|السطر الحرفي|النطاق:اسم الدالة)،
      // بينما التطبيق يجري بقالب يجرّد المعرّفات والنصوص. فمفتاح الهوية أضيق
      // من مفتاح المطابقة، والمقيس أن سطرًا متطابقًا حرفيًا في دالتين مختلفتي
      // الاسم يُنتج سجلّين ‎observed=1, verified=1‎ ولا يُعتمد أيٌّ منهما،
      // وثلاثة ملفات يختلف فيها اسم المتغيّر وحده تُنتج ثلاثة سجلات كذلك.
      // أي أن الاعتماد يشترط تكرارًا نصيًّا والفائدة تشترط تنوّعًا نصيًّا —
      // شرطان متعارضان، فلا نمط معمَّم يبلغ الاعتماد أبدًا.
      //
      // فصار المفتاح، عند وجود قالب صالح، هو القالب نفسه: ‎(beforeTemplate,
      // afterTemplate)‎ مع النوع واللغة. وبلا قالب صالح تبقى البصمة كما هي،
      // فالمطابقة الحرفية لا يتغيّر سلوكها.
      //
      // ثلاث حدود مقيسة تمنع دمج أدلة غير متكافئة:
      //   • النوع   — ‎secret‎ و‎HARDCODED_SECRET‎ بنفس القالب يبقيان سجلّين.
      //   • اللغة   — js وpy بنفس القالب حرفيًا يبقيان سجلّين.
      //   • الاتجاه — قالب «بعد» داخل المفتاح، فإصلاحان مختلفان لنفس السطر
      //     لا يُدمجان. ونسخة تطابق قالب «قبل» وحده تدمجهما فعلاً — فالشرط
      //     فعّال لا زائد.
      //
      // ولا تهجير للمخزن: السجلات القديمة تبقى كما هي، ويُراكم الدليل على
      // أول سجل يطابق القالب. فنسخ قديمة متكافئة لا تُدمَج رجعيًّا — تُسجَّل
      // كأثر مُعلَن، لا كخطر على البيانات.
      const gen   = generalizeLinePair(pair.before, pair.after);
      const genOk = !!(gen && isGeneralPatternUsable(gen, lang));
      const sameRule = p =>
        p.type === pair.type &&
        p.language === lang &&
        ((genOk && p.generalized)
          ? (p.generalized.beforeTemplate === gen.beforeTemplate &&
             p.generalized.afterTemplate  === gen.afterTemplate)
          : p.fingerprint === fp);

      // [C1] الاختيار من بين المطابقين: السجل غير المحظور. كان find يُرجع
      // أول مطابق في المصفوفة — أي الأقدم — فلو كان توأمًا محظورًا
      // (failures ≥ 3) نزل الدليل عليه و verify تُبقيه مرفوضًا، فتُهدَر
      // المشاهدة ولا تبلغ القاعدة الاعتماد أبدًا. والمقيس: محظور أولًا
      // ⇒ ‎banned: obs2/ver2/approved=false‎ والسليم باقٍ على ver1.
      // وهذا أثرٌ أدخله مفتاح القالب نفسه: قبله كان المثيل المختلف نصيًا
      // يُنشئ سجله الخاص فيبلغ الاعتماد مستقلًا عن التوأم المحظور.
      const matches  = db.patterns.filter(sameRule);
      const existing = matches.find(p => (p.failures || 0) < 3);

      // كل المطابق محظور ⇒ لا تعلّم إطلاقًا. لا تراكم على المحظور (فيُهدَر
      // الدليل) ولا سجل جديد (فيُحيي قاعدة محظورة بعد مشاهدتين). الحظر يبقى
      // كما هو، والمشاهدة تُسقَط — ولا يُخفَّض عتبة failures ولا يُحذف سجل.
      if (!existing && matches.length) return;

      if (existing) {
        existing.observed = (existing.observed || 0) + 1;
        existing.lastSeen = Date.now();
        learnedIds.push(existing.id);
      } else {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
        db.patterns.push({
          id,
          type:        pair.type,
          severity:    pair.severity,
          before:      pair.before,
          after:       pair.after,
          language:    lang,
          context:     { functionName: ctx.functionName, scope: ctx.scope, fileName: fileName || '' },
          fingerprint: fp,
          fileName:    fileName || '',
          // [C1] نفس الكائن الذي صار مفتاح الهوية أعلاه — لا إعادة حساب،
          // فلا يمكن أن يتباعد المخزَّن عن المفتاح الذي قِيس به.
          generalized: genOk ? gen : null,
          observed:    1,
          verified:    0,
          failures:    0,
          confidence:  0,
          approved:    false,
          created:     Date.now(),
          lastSeen:    Date.now(),
        });
        learnedIds.push(id); // أضف ID الجديد
      }
    });

    db.meta.total++;
    // [P3] السقف يُطبَّق عند الإضافة لا عند الامتلاء: الإخلاء المرتَّب أفضل من
    // رفض الحصّة، لأن الرفض يُفقد التعديل كلّه (ومنه حظرٌ مستحق) لا أقلَّ عنصرٍ
    // قيمة. والأنماط المُضافة الآن محميّة: lastTouch = created = الآن.
    pruneToCap(db, _K().MAX_PATTERNS);
    save(db);

    // [C1] معرّفات فريدة. خط الأنابيب ينادي verify(id, true) لكل معرّف يُعاد،
    // وبلاغان على السطر نفسه يُنتجان الزوج نفسه فيُدفَع معرّفه مرتين — والمقيس
    // أن إصلاحًا واحدًا كان يرفع verified بمقدار 2، فيبلغ النمط عتبة الاعتماد
    // (MIN_VERIFIED=2) بتضخيم لا بدليل. العتبة لم تُمَسّ؛ المُصلَح هو العدّ.
    return Array.from(new Set(learnedIds));
  }

  // ─── Verify (Ghost Mode calls this with patternId) ──
  function verify(patternId, success) {
    const db = load();
    const p = db.patterns.find(p => p.id === patternId);
    if (!p) return;

    // [S1] حكمُ الدليل في طبقة التحقّق — والفحصُ المكرَّر وُحِّد هناك.
    // كان الحظر يُفحَص مرّتين (داخل فرع الإخفاق، ثم في سلسلة إعادة
    // الاعتماد)، والثانية تحكم دائمًا فالأولى بلا أثر — أثبته كنسُ
    // تحوّرات المرحلة صفر. السلوك هو هو، والموضع واحد.
    _V().recordOutcome(p, !!success);

    // [P3] المعرّف يُرجَع إذا وصل الحكم إلى المخزن فقط. كان يُرجَع دائمًا،
    // فمنادٍ يرى نجاحًا والحظر لم يُكتب.
    return save(db) ? p.id : null;
  }

  // [P3] markResult حُذفت: دالة فارغة (تطبع تحذير إهمال ولا تفعل شيئًا) ولا
  // منادي لها في المستودع كلّه — لا في public/ ولا في api/ ولا في الصفحتين
  // ولا في الاختبارات. سطحٌ مُصدَّر بلا أثر، وإبقاؤه يوهم بوجود مسار تسجيل
  // ثانٍ. البديل القائم: verify(patternId, success).


  // ─── Apply Learned ──────────────────────────────────
  function applyLearned(code, fileName, opts) {
    const db = load();
    if (!db.patterns.length) return { fixed: code, applied: 0, uses: [] };

    const fileLang = inferLanguage(fileName);

    // [P3] 'unknown' ليست لغة بل اسمٌ لغياب المعرفة: inferLanguage تُرجعها لكل
    // امتداد خارج خريطتها (sh, cpp, rs, yml, sql, tf, …). وشرط التساوي أدناه
    // كان يُمرّر 'unknown' === 'unknown'، أي أن قالبًا من ملفٍ مجهول الامتداد
    // يُجرَّب على ملفٍ آخر مجهول الامتداد بلا أي قرابة لغوية — Bash على YAML.
    // المقيس: لا توجد اليوم أنماط بهذه اللغة (learn() لا يتعلّم من هذه
    // الامتدادات أصلاً: 0 أنماط من sh/cpp/rs/yml/sql)، وكل محاولة مزروعة
    // رفضتها البوابة ولم تُكتب. فهذا سدٌّ احتياطي لمنفذ غير مستغَلّ لا إصلاح
    // لضرر مقيس، وكلفته صفر تغطية: ما لا يُتعلَّم لا يُفقد تطبيقه.
    if (fileLang === 'unknown') return { fixed: code, applied: 0, uses: [] };

    // [P2] onlyIds: حصر التطبيق بأنماط بعينها. يُستعمل في التنصيف لعزل النمط
    // المسؤول عن تعديل رفضته البوابة. بلا الخيار لا يتغيّر أي سلوك.
    const onlyIds = (opts && Array.isArray(opts.onlyIds)) ? new Set(opts.onlyIds) : null;

    // [S1] الشرطُ معيارٌ واحد في طبقة التحقّق — نفسُ البنود بنفس الترتيب
    const goodPatterns = db.patterns.filter(p => _V().isEligible(p, fileLang, onlyIds));

    if (!goodPatterns.length) {
      return { fixed: code, applied: 0, uses: [] };
    }

    // [V4′] سياسة صلاحية القالب المعمَّم تُطبَّق على **الطرفين** لا على طرف.
    //
    // كان isGeneralPatternUsable يُنادى من موضع واحد: داخل learn() وقت
    // التخزين. وapplyLearned يثق بـp.generalized ثقةً مطلقة. فقالبٌ دخل
    // المخزن بطريق لا يمرّ بـlearn() — مخزن أقدم من V4، أو زرع، أو مسار
    // كود آخر — يُطبَّق كما هو. والمقيس على عائلة SQL concat:
    //     قالب "بعد" يعكس وسطاء الاستعلام  ⇒  applied=1، وGhost pass،
    //     والفحص النحوي يقبل، وFixVerifier يقبل («أزال مشكلتين بلا تدهور»)،
    //     ثم يُكتب فعلاً وحكم P2 عليه PASS. والربط مقلوب: قيمة العمود a
    //     تذهب إلى b والعكس. صحيح نحويًا، مُعامَل بالمعامِلات، ودلالته عكسية.
    // ولا تنقذنا البوابة: المحلّل يُنتج نفس قائمة البلاغات بالضبط للنسخة
    // المقلوبة والنسخة السليمة — لا كاشف يمثّل تقابل المعامِل بالعمود.
    //
    // والدالة محضة وحتمية، وlearn() لا يضع generalized إلا بعد اجتيازها
    // ⇒ إعادة الفحص no-op لكل ما خزّنه هذا المحرك، ولا تعضّ إلا على قالب
    // ما كان ليخزّنه. والحساب مرة واحدة لكل نمط لا لكل سطر: القياس المتشابك
    // أعطى النداء لكل سطر +74.8% على applyLearned، وهذه الصيغة +15.3%
    // بمدى متقاطع مع الأصل.
    //
    // ⚠️ النطاق: المسار المعمَّم وحده. المطابقة الحرفية (via='exact') تبقى
    // خارج الحماية — زوجٌ حرفي يعكس الوسطاء يُطبَّق كما كان، وهو حدّ مُعلَن
    // ومُختبَر صراحةً، وتغطيته تحتاج فحص ترتيب على مستوى قيم الخانات.
    const genUsable = new Set(goodPatterns.filter(
      p => p.generalized && isGeneralPatternUsable(p.generalized, fileLang)));

    const lines = code.split('\n');
    const uses = [];
    let applied = 0;

    for (let i = 0; i < lines.length; i++) {
      const originalLine = lines[i];
      const t = originalLine.trim();

      if (!t || t.startsWith('//') || t.startsWith('#')) continue;
      if (isSafe(t)) continue;

      let selected = null;
      let replacement = null;
      let via = null;          // [P2] أي مسار أنتج الاستبدال: حرفي أم معمَّم

      // 1. Exact match first.
      for (const p of goodPatterns) {
        if (t === p.before) {
          selected = p;
          replacement = p.after;
          via = 'exact';
          break;
        }
      }

      // 2. If exact match failed, try generalized learning.
      if (!selected) {
        for (const p of goodPatterns) {
          if (!p.generalized) continue;
          if (!genUsable.has(p)) continue;   // [V4′] عضوية بالهوية لا بالمعرّف

          const match = matchGeneralPattern(t, p.generalized);
          if (!match) continue;

          const rendered = renderGeneralTemplate(
            p.generalized.afterTemplate,
            match.values
          );

          if (!rendered || rendered === t) continue;

          selected = p;
          replacement = rendered;
          via = 'general';
          break;
        }
      }

      if (!selected || !replacement || replacement === t) continue;

      // الخانق الوحيد قبل الكتابة — يسري على المسارين: الحرفي والمعمَّم.
      if (!preservesTarget(t, replacement)) continue;
      if (!preservesValueOrder(t, replacement)) continue;   // [V4″]

      const leading = originalLine.match(/^\s*/)?.[0] || '';
      lines[i] = leading + replacement;
      // [P2] نسبة صريحة: أي نمط أسهم، في أي سطر، عبر أي مسار. ولا يُسجَّل
      // استعمال هنا — الدفتر (lastUsed) صار بعد قرار البوابة عبر markUsed.
      uses.push({ patternId: selected.id, lineIndex: i, via, before: t, after: replacement });
      applied++;
    }

    // [P2] applyLearned صارت قراءة محضة: لا lastUsed ولا save(). كانت تكتب
    // الدفتر داخل الحلقة قبل أن تحكم البوابة، فيُسجَّل استعمالٌ لتعديل قد
    // يُرفض؛ وكانت تكتب المخزن في كل نداء حتى عند applied === 0.
    return {
      fixed: lines.join('\n'),
      applied,
      uses
    };
  }

  // ─── Usage Bookkeeping (post-gate) ──────────────────
  // [P2] يُستدعى من خط الأنابيب **بعد** قبول البوابة حصرًا. يسجّل lastUsed
  // ولا يلمس verified ولا failures ولا confidence ولا approved: نسبة الأدلة
  // في هذه المرحلة تسجيلٌ لا حكم على حالة النمط.
  function markUsed(patternIds) {
    if (!Array.isArray(patternIds) || !patternIds.length) return 0;
    const db = load();
    if (!db || !Array.isArray(db.patterns)) return 0;
    const wanted = new Set(patternIds);
    const now = Date.now();
    let marked = 0;
    for (const p of db.patterns) {
      if (!wanted.has(p.id)) continue;
      p.lastUsed = now;
      marked++;
    }
    // [P3] الدفتر إمّا وصل أو لا. وlastUsed صار يحمي النمط من الإخلاء، فكتابةٌ
    // مفقودة تعني نمطًا مستعملاً يُعَدّ مهملاً — لذا لا يُعلَن تسجيلٌ لم يُحفَظ.
    if (marked && !save(db)) return 0;
    return marked;
  }

  function learnSafe(code, fileName) {
    const db = load();
    db.safe = db.safe || [];
    let learned = 0;

    code.split('\n').forEach(line => {
      const t = line.trim();
      if (!t || t.startsWith('//')) return;
      if (!isSafe(t)) return;
      if (db.safe.find(s => s.pattern === t.substring(0, 80))) return;

      db.safe.push({ pattern: t.substring(0, 80), created: Date.now() });
      learned++;
    });

    if (learned > 0) save(db);
    return learned;
  }

  // ─── Stats ──────────────────────────────────────────
  function getStats() {
    const db = load();
    // [P3] قدرة المخزن على التطبيق تُعرَض لا تُخمَّن:
    //   banned  — failures ≥ 3: مُسقَط الاعتماد بدليل ضرر، ولا يُطبَّق أبدًا.
    //   langless — بلا لغة: بعد إحكام بوابة اللغة لا يُطابق أي ملف، فهو ثِقَل
    //              ميت كان يُعرَض 'unknown' فيبدو كلغةٍ قائمة.
    //   capacity/evicted — السقف وما أُخلي، وsaveFailures كتابات فُقدت.
    const banned  = db.patterns.filter(p => (p.failures || 0) >= 3).length;
    const langless = db.patterns.filter(p => !p.language).length;
    return {
      total:    db.patterns.length,
      approved: db.patterns.filter(p => p.approved).length,
      pending:  db.patterns.filter(p => !p.approved).length,
      safe:     (db.safe || []).length,
      banned:   banned,
      langless: langless,
      inert:    db.patterns.filter(p => (p.failures || 0) >= 3 || !p.language).length,
      capacity: _K().MAX_PATTERNS,
      evicted:  (db.meta && db.meta.evicted) || 0,
      saveFailures: _K().saveFailures,
      patterns: db.patterns.map(p => ({
        id:          p.id,
        type:        p.type,
        before:      p.before?.slice(0, 60),
        after:       p.after?.slice(0, 60),
        language:    p.language || 'unknown',
        context:     p.context || null,
        fingerprint: p.fingerprint || null,
        observed:    p.observed,
        verified:    p.verified,
        failures:    p.failures,
        confidence:  p.confidence?.toFixed(2),
        approved:    p.approved,
      }))
    };
  }

  function getBoosts() {
    const db = load();
    const boosts = new Map();
    db.patterns
      .filter(p => p.approved && p.confidence >= 0.8)
      .forEach(p => {
        const cur = boosts.get(p.type) || 0;
        boosts.set(p.type, Math.max(cur, p.confidence));
      });
    return boosts;
  }

  function reset() {
    _K().clear();
  }

  return { learn, learnSafe, applyLearned, markUsed, verify, getStats, getBoosts, reset };
})();

if (typeof window !== 'undefined') window.LearningEngine = LearningEngine;
if (typeof module !== 'undefined') module.exports = LearningEngine;

