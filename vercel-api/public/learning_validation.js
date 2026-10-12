// ═══════════════════════════════════════════════════════
// learning_validation.js — التحقّق من المعرفة لا من الكود
//
// الدور: يحكم على **الأنماط**: هل يصلح زوجٌ للتخزين؟ هل يُقابل سطرُ الإصلاح
//        سطرَه الأصلي أم يُشبهه نصًّا فقط؟ هل يجوز تطبيق نمطٍ على ملف؟ وكم
//        تساوي الثقة بعد دليلٍ جديد؟
//
// وحدُّه الحاسم: **لا يتحقّق من الكود**. التحقّق من أن تعديلًا على ملفٍ سليمٌ
// ولا يدّعي إصلاحًا بلا دليل هو عقد FixVerifier وحده، وGhostMode مرحلةٌ
// سابقة له. ولا يستدعي هذا الملف أيًّا منهما ولا يُعيد منطقهما: نسختان من
// حكمٍ واحد تتباعدان، وقد كلّف ذلك المشروع جولاتٍ من قبل.
//
// ولا يعرف المخزن: لا localStorage ولا load/save. يأخذ ما يحكم عليه وسيطًا
// ويُرجع حكمًا. فهو محضٌ وحتميّ، ويُختبَر بلا بيئة.
//
// استُخرج من learning_engine.js نقلًا حرفيًّا (المرحلة 1 من إعادة التصميم).
// التعليقات المنقولة تصف قياساتٍ أُجريت وقت كتابتها — أُبقيت كما هي لأنها
// الدليل على سبب كل حارس.
// ═══════════════════════════════════════════════════════

var LearningValidation = (() => {

  const THRESHOLDS = {
    MIN_VERIFIED:   2,     // أدنى تحققات قبل الموافقة
    MIN_CONFIDENCE: 0.20,  // أدنى confidence
    MAX_CONFIDENCE: 0.97,  // حد أقصى
    DECAY_ON_FAIL:  0.15,  // خفض confidence عند الفشل
  };

  // Evidence curve — verified فقط ترفع confidence
  function calcConfidence(verified, failures) {
    if (verified < THRESHOLDS.MIN_VERIFIED) return 0;
    const total = verified + failures;
    const successRate = verified / total;

    let base;
    if (verified >= 50) base = 0.95;
    else if (verified >= 20) base = 0.90;
    else if (verified >= 10) base = 0.80;
    else if (verified >= 5)  base = 0.70;
    else                      base = 0.60;

    return Math.min(THRESHOLDS.MAX_CONFIDENCE, base * successRate);
  }

  // ─── Safe Whitelist ─────────────────────────────────
  const SAFE_SIGNATURES = [
    /process\.env\.\w+/,
    /os\.environ(?:\.get)?\s*\(/,
    /getenv\s*\(/,
    /\.textContent\s*=/,
    /htmlspecialchars/,
    /execFile\s*\(/,
    /sha256|bcrypt|argon2/i,
    /\?\s*\]/,
    /expiresIn/,
    /\.catch\s*\(/,
    /req\.user/,
    /res\.status\(401\)/,
  ];

  function isSafe(line) {
    return SAFE_SIGNATURES.some(p => p.test(line));
  }

  // ─── Anchor Tokens ───────────────────────────────────
  // معرّفات السطر فقط — بدون القيم النصية ولا الكلمات المفتاحية
  function anchorTokens(line) {
    const KEYWORDS = new Set([
      'const','let','var','function','def','return','new','this','self','class',
      'public','private','protected','static','final','import','from','require',
      'if','else','for','while','try','catch','async','await',
    ]);
    const noStrings = (line || '').replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, ' ');
    const words = noStrings.match(/[A-Za-z_$][\w$]*/g) || [];
    return [...new Set(words.filter(w => !KEYWORDS.has(w)))];
  }

  // ─── Assignment Target ───────────────────────────────
  // هدف الإسناد في السطر: x أو obj.prop، ويشمل الإسناد المركّب (+=).
  // null يعني أن السطر ليس إسناداً (استدعاء أو تعبير).
  function assignTarget(line) {
    const m = (line || '').trim().match(
      /^(?:const|let|var)?\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?:\+|-|\*|\/|\|\||\?\?)?=(?!=)/);
    return m ? m[1] : null;
  }

  // هل يقابل سطر الإصلاح السطرَ الأصلي فعلاً؟
  // بلا هذا الفحص يُربط أول سطر يطابق نوع الثغرة بأي سطر أصلي، فيُخزَّن
  // زوج مثل: console.log(API_KEY);  →  const API_KEY = process.env.API_KEY;
  // وتطبيقه لاحقاً يحذف الاستدعاء ويضع مكانه تصريحاً.
  function corresponds(beforeLine, afterLine) {
    const bt = assignTarget(beforeLine);
    const at = assignTarget(afterLine);
    if (bt && at && bt === at) return true;   // إسناد لنفس الهدف ⇒ تقابل مؤكد
    // [FIX] كان الفحص اتجاهياً: ‎if (!bt && at)‎ يمنع "استدعاء ⇄ تصريح" ولا
    // يمنع العكس. فزوج مثل:
    //     const API_KEY = "sk_live_…";  →  sendKey(process.env.API_KEY);
    // يسقط إلى تقاطع المعرّفات ويمرّ لمجرد تقاسم API_KEY، فيُخزَّن ويُعتمد،
    // وتطبيقه يحذف التصريح ويضع مكانه استدعاءً فتصير بقية استعمالات الاسم
    // غير معرّفة. وهو ضرر من صنف ما أصلحه D2، في الاتجاه المعاكس، ومقيس
    // أنه يجتاز GhostMode و learnedSyntaxOk و FixVerifier كلها.
    // التناظر هو العقد المقصود: تغيّر شكل العبارة ⇒ ليسا متقابلين، أياً كان
    // الأصل. وما يبقى لتقاطع المعرّفات هو الحالتان المتماثلتان شكلاً:
    // إسنادان لهدفين مختلفين، أو سطران غير إسناديين.
    if (!bt !== !at) return false;            // أحدهما إسناد والآخر لا
    const anchors = anchorTokens(beforeLine);
    if (!anchors.length) return false;
    const tokens = new Set(anchorTokens(afterLine));
    return anchors.some(a => tokens.has(a));
  }

  // ─── Corresponding Candidate ─────────────────────────
  // يربط after بالسطر الأصلي نفسه — وليس بأول سطر يطابق نوع الثغرة
  function pickCorresponding(typed, hunk, beforeLine, removedRank) {
    if (!typed.length) return null;
    // بوابة أخيرة على كل المسارات: لا نقبل مرشحاً بلا دليل تقابل،
    // ولو كان المرشح الوحيد.
    const confirm = c => (c && corresponds(beforeLine, c.line)) ? c : null;
    if (typed.length === 1) return confirm(typed[0]);

    // 1) تطابق المعرّفات — الإشارة الأقوى، وتتطلب فائزاً واضحاً
    const anchors = anchorTokens(beforeLine);
    if (anchors.length) {
      const scored = typed
        .map(c => {
          const tokens = new Set(anchorTokens(c.line));
          return { c, score: anchors.filter(a => tokens.has(a)).length };
        })
        .sort((a, b) => b.score - a.score);

      if (scored[0].score > 0 && scored[0].score > (scored[1] ? scored[1].score : 0)) {
        return confirm(scored[0].c);
      }
    }

    // 2) تقابل موضعي — فقط إذا كان الـhunk استبدالاً 1:1 بلا إدراج
    if (removedRank >= 0 && hunk.removed.length === hunk.added.length) {
      const byPos = hunk.added[removedRank];
      if (byPos && typed.indexOf(byPos) !== -1) return confirm(byPos);
    }

    // 3) غير محسوم → Fail Closed: لا نتعلم زوجاً غير مؤكد
    return null;
  }


  function isGeneralPatternUsable(pattern, language) {
    if (!pattern || !language || language === 'unknown') return false;
    if (!pattern.beforeTemplate || !pattern.afterTemplate) return false;
    if (!Array.isArray(pattern.beforeSlots)) return false;

    const count =
      (pattern.beforeTemplate.match(/__LEARN_ID_\d+__/g) || []).length;

    if (count > 8) return false;

    // [V4] ترتيب الخانات لا يُبدَّل بين الطرفين.
    // قالب يعيد ترتيب الخانات يُركِّب المعامِلات في مواضع غير مواضعها، فيغيّر
    // دلالة السطر مع ثبات هدف الإسناد — فلا يراه حرس الهدف ولا المرجع الخلفي.
    // والمقيس أن الأزواج الصحيحة الخمسة (secret / md5 / xss / sql parameterized /
    // ذاتي المرجع) تحفظ الترتيب كلها، فالشرط بلا تكلفة ويمنع التبديل.
    const seqOf = src => {
      const out = [];
      for (const tok of (src.match(/__LEARN_(?:ID|STR)_\d+__/g) || [])) {
        if (out.indexOf(tok) === -1) out.push(tok);
      }
      return out;
    };
    const beforeSeq = seqOf(pattern.beforeTemplate);
    const afterSeq  = seqOf(pattern.afterTemplate).filter(x => beforeSeq.indexOf(x) !== -1);
    let seqAt = 0;
    for (const tok of beforeSeq) if (afterSeq[seqAt] === tok) seqAt++;
    if (seqAt !== afterSeq.length) return false;

    const fixed = pattern.beforeTemplate
      .replace(/__LEARN_ID_\d+__/g, '')
      .replace(/\s+/g, '');

    return fixed.length >= 3;
  }

  // ─── Validate Fix Before Learning ────────────────────
  // لا نخزّن after لا نستطيع إثبات سلامته. لا parser جديد:
  // isBalanced موجودة في analyzer.js:83 ويستخدمها المحلل لنفس الغرض
  // (analyzer.js:129)، وacorn محمّل أصلاً في الصفحة.
  function parsesAsJS(src) {
    for (const sourceType of ['module', 'script']) {
      try { acorn.parse(src, { ecmaVersion: 'latest', sourceType }); return true; }
      catch(e) {}
    }
    return false;
  }

  // التحقق على مستوى الزوج نفسه — لا على مستوى الملف، حتى لا يُرفض
  // نمط صحيح بسبب سطر مكسور آخر يحقنه محرك الإصلاح في مكان بعيد.
  function isPairUsable(pair, fileName) {
    // Fail Closed: بلا أداة تحقق متاحة لا نتعلم شيئاً
    if (typeof isBalanced !== 'function') return false;

    // 1) توازن الأقواس — لكل اللغات (JS/TS/Python/PHP).
    //    لا نحاسب سطراً كان أصلاً غير متوازن (سطر جزئي مثل "items.forEach(i => {")
    if (isBalanced(pair.before) && !isBalanced(pair.after)) return false;

    // 2) JS النقي فقط: تحقق نحوي بـacorn. لا يدعم TS/JSX فتُستثنى،
    //    ونحكم فقط إذا كان before سطراً مكتملاً يُحلَّل وحده — وإلا لا حكم.
    if (/\.(js|mjs|cjs)$/i.test(fileName || '')) {
      if (typeof acorn === 'undefined' || typeof acorn.parse !== 'function') return false;
      if (parsesAsJS(pair.before) && !parsesAsJS(pair.after)) return false;
    }

    return true;
  }

  // ─── Assignment Target Preservation ─────────────────
  // [V2′] الإصلاح المتعلَّم لا يجوز أن يغيّر وجهة الكتابة.
  // مسار المطابقة الحرفية (t === p.before) لا يعبر matchGeneralPattern أصلًا،
  // فالمرجع الخلفي لا يراه. والمقيس أن زوجًا مثل:
  //     const A_KEY = "sk_live_…";  →  const B_KEY = process.env.A_KEY;
  // تقبله corresponds (إسنادان يتقاسمان معرّفًا، وهي سَعَة موثَّقة) فيُخزَّن
  // ويُعتمد، وتطبيقه يعيد تسمية التصريح فتصير كل استعمالات A_KEY غير معرَّفة.
  // تُقارَن بادئة المسار كاملةً لا جذره وحده: el.innerHTML → el.textContent
  // مقبول (المقطع الأخير هو ما يُصلحه الإصلاح)، و a.b.c → a.z.c مرفوض.
  // وهدفٌ من مقطع واحد يُطابَق تامًّا، لأن الاسم المجرَّد هوية لا خاصية.
  // نقاط عمى مسجَّلة (assignTarget تُرجع null): الفهرسة a[i]= والتفكيك
  // و{**=, &&=, %=, &=, |=, ^=, >>=} — لا حماية ولا رفض، وتوسيعها يمسّ
  // assignTarget المشتركة مع corresponds فيؤجَّل إلى جولة مستقلة.
  function preservesTarget(beforeLine, afterLine) {
    const b = assignTarget(beforeLine);
    const a = assignTarget(afterLine);
    if ((b === null) !== (a === null)) return false;  // تغيّر شكل العبارة
    if (b === null) return true;                      // ليس إسنادًا ⇒ لا حكم
    const bs = b.split('.'), as = a.split('.');
    if (bs.length !== as.length) return false;
    if (bs.length === 1) return bs[0] === as[0];
    return bs.slice(0, -1).join('.') === as.slice(0, -1).join('.');
  }

  // ─── Value Order Preservation ───────────────────────
  // [V4″] ترتيب القيم لا يُبدَّل — على مستوى السطر هذه المرة لا القالب.
  //
  // V4 يحرس القالب وقت التخزين، وV4′ يعيد حرسه وقت التطبيق. لكن المطابقة
  // الحرفية (t === p.before) لا قالب لها أصلاً، فزوجٌ حرفي يعكس وسطاء
  // الاستعلام يُطبَّق كما هو. والمقيس:
  //   before: conn.exec("… a=" + userId + " AND b=" + tenantId);
  //   after : conn.exec("… a=? AND b=?", [tenantId, userId]);
  // صحيح نحويًا، وتقبله البوابات الثلاث (المحلّل يُنتج نفس قائمة البلاغات
  // للمقلوب والسليم)، ودلالته مقلوبة: قيمة العمود a تذهب إلى b والعكس.
  //
  // والفحص على المعرّفات **خارج النصوص** حصرًا: محتوى النص يعيد ترتيب نفسه
  // بطبيعة هذا الإصلاح (‎"… a=" + x + " AND b="‎ ⇒ ‎"… a=? AND b=?"‎)، فقياسه
  // يرفض الإصلاح السليم رفضًا كاذبًا — مقيس قبل الاستقرار على هذه الصيغة.
  // والكلمات المفتاحية تُستثنى كما تفعل generalizeLinePair.
  //
  // يسري على المسارين معًا لأنه عند نقطة الخانق الوحيدة قبل الكتابة.
  // تُبنى مرة واحدة لا في كل نداء: الدالة على المسار الساخن (نداء لكل سطر
  // يُستبدَل)، وبناء الـSet والregex داخلها قاس +184% على حالة "كل سطر
  // يُطبَّق" — مقيس. الثابتان هنا يُلغيان ذلك.
  const VO_KEYWORDS = new Set([
    'const','let','var','function','def','return','new','this','self',
    'class','public','private','protected','static','final','import',
    'from','require','if','else','for','while','try','catch',
    'async','await','true','false','null','undefined'
  ]);
  const VO_STRING_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
  const VO_IDENT_RE  = /\b[A-Za-z_$][\w$]*\b/g;

  function preservesValueOrder(beforeLine, afterLine) {
    const seq = src => {
      const bare = String(src).replace(VO_STRING_RE, ' ');
      const out = [];
      let m;
      VO_IDENT_RE.lastIndex = 0;   // regex مشترك ‎/g‎ ⇒ تصفير lastIndex إلزامي
      while ((m = VO_IDENT_RE.exec(bare)) !== null) {
        if (!VO_KEYWORDS.has(m[0]) && out.indexOf(m[0]) === -1) out.push(m[0]);
      }
      return out;
    };
    const b = seq(beforeLine);
    const a = seq(afterLine).filter(x => b.indexOf(x) !== -1);
    let at = 0;
    for (const tok of b) if (a[at] === tok) at++;
    return at === a.length;
  }

  // ─── [V-NEW] حكمُ الدليل — مُوحَّدًا ─────────────────────────────────
  //
  // جسمُ ‎verify‎ كان في learning_engine، وفيه فحصُ الحظر **مكرَّر**: مرّةً
  // داخل فرع الإخفاق ومرّةً في سلسلة إعادة الاعتماد بعده. والثاني يحكم
  // دائمًا فالأول لا أثر له — أثبته كنسُ تحوّرات المرحلة صفر: تحويرُ أحدهما
  // وحده لا يُغيّر سلوكًا. وُحِّد هنا في موضعٍ واحد، والسلوك هو هو:
  //   • نجاح ⇒ ‎verified++‎
  //   • إخفاق ⇒ ‎failures++‎
  //   • الثقة من ‎calcConfidence‎ وحدها — لا خفضٌ يدوي
  //   • الاعتماد: ‎failures < BAN_AT‎ **و** الأدلة كافية **و** الثقة كافية
  //   • وإلا فلا اعتماد. والحظر عند ‎BAN_AT‎ لا يُنقَض بنجاحاتٍ بعده.
  //
  // يُعدّل الكائن في موضعه ويُرجعه — الكتابة إلى المخزن شأنُ طبقة المعرفة.
  const BAN_AT = 3;

  // [S4] القرارُ دالةٌ من العدّادات وحدها — لا يُورَّث ولا يُحتفظ به.
  //
  // فُصلت عن recordOutcome لأن للترحيل حاجةً إليها بعينها: سجلٌّ قديم قد
  // يحمل ‎approved: true‎ كُتب بعتباتٍ أقدم، أو بثقةٍ حُسبت بمنحنى آخر.
  // وقراءةُ ذلك الحقل كما هو تمنح قديمًا ثقةً لم يستحقّها بقواعد اليوم.
  // فصار الحقلُ مشتقًّا لا مخزَّنًا: يُعاد اشتقاقه من ‎verified/failures‎
  // في كل قراءة، فتسري أيُّ عتبةٍ تتغيّر على المخزن كلّه بلا ترحيلٍ ثانٍ.
  // والعدّاداتُ لا تُمَسّ — هي الدليل، وهذا حكمٌ عليه.
  function deriveApproval(p) {
    if (!p || typeof p !== 'object') return null;
    p.confidence = calcConfidence(p.verified || 0, p.failures || 0);
    p.approved = (p.failures || 0) < BAN_AT &&
                 (p.verified || 0) >= THRESHOLDS.MIN_VERIFIED &&
                 p.confidence >= THRESHOLDS.MIN_CONFIDENCE;
    return p;
  }

  function recordOutcome(p, success) {
    if (!p || typeof p !== 'object') return null;

    if (success) p.verified = (p.verified || 0) + 1;
    else         p.failures = (p.failures || 0) + 1;

    return deriveApproval(p);
  }

  // هل النمط محظورٌ بدليل ضرر؟ — معيارٌ واحد يستعمله التعلّم والتطبيق معًا
  function isBanned(p) { return ((p && p.failures) || 0) >= BAN_AT; }

  // ─── [V-NEW] صلاحيةُ نمطٍ للتطبيق على ملف ───────────────────────────
  //
  // كان الشرط مكتوبًا داخل ‎applyLearned‎. استُخرج ليكون معيارًا واحدًا
  // يُقرأ ويُختبَر: الاعتماد، وكفايةُ الأدلة والثقة، ومطابقةُ اللغة، وحصرُ
  // المعرّفات إن طُلب. ولا يُضاف إليه شرط: السلوك هو السلوك.
  function isEligible(p, fileLang, onlyIds) {
    if (!p || !p.approved) return false;
    if (!(p.confidence >= THRESHOLDS.MIN_CONFIDENCE)) return false;
    if (!(p.verified >= THRESHOLDS.MIN_VERIFIED)) return false;
    if (p.language !== fileLang) return false;
    if (onlyIds && !onlyIds.has(p.id)) return false;
    return true;
  }

  return {
    THRESHOLDS, BAN_AT,
    calcConfidence, deriveApproval, recordOutcome, isBanned, isEligible,
    isSafe, isGeneralPatternUsable, parsesAsJS, isPairUsable,
    anchorTokens, assignTarget, corresponds, pickCorresponding,
    preservesTarget, preservesValueOrder,
  };
})();

if (typeof window !== 'undefined') window.LearningValidation = LearningValidation;
if (typeof module !== 'undefined') module.exports = LearningValidation;
