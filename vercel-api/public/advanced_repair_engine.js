// ═══════════════════════════════════════════════════════
// advanced_repair_engine.js — Smart Repair Engine
// ═══════════════════════════════════════════════════════

// العقد (انظر الاختبار advanced_repair_engine.test.js):
//   • repairs المُقترَحة ≠ المُتحقَّق منها ≠ المُطبَّقة. هذه الدالة لا تطبّق شيئًا
//     أبدًا (applied = 0)؛ تُرجع مُرشَّحًا في repaired يطبّقه المستدعي.
//   • autoFix/autoFixed تعني «اجتاز البوابة FixVerifier.verifyFix»، لا «ذكرها repairCode».
//   • أي رقم بعد-الإصلاح (remaining/riskAfter) يأتي من reAnalysis فقط، وإلا null + UNAVAILABLE.
//   • fileName اختياري (المعامل الثالث أو analysis.fileName)، والافتراضي 'code.js' كما كان.
//   • تغيير سلوكي: استثناء repairCode لم يعد يصل المستدعي؛ يُرجَع engineStatus='ENGINE_ERROR' + error،
//     والكود الأصلي، وكل البلاغات في unresolved. على المستدعي فحص engineStatus لا الاعتماد على try/catch.
//   • unresolved لا تُسقط تكرارًا ولا تحكم به: possiblyCoveredBy دليلٌ للمراجِع (نفس السطر ونفس ev) فقط.
function executeSmartRepairs(code, analysis, fileName) {
  if (!analysis || !Array.isArray(analysis.rawIssues)) {
    return {
      repaired:      code,
      recommendations: [],
      autoFixed:     0,
      needsAI:       0,
      estimatedTime: 'N/A',
      engineStatus:  'INVALID_INPUT',
    };
  }

  // اسم الملف الأصلي إن توفّر من المستدعي — لا نفترض code.js إلا عند غيابه
  const fileNameSource =
    (typeof fileName === 'string' && fileName.trim())                           ? 'caller'
    : (typeof analysis.fileName === 'string' && analysis.fileName.trim())       ? 'analysis'
    : 'default';
  const resolvedFileName = fileNameSource === 'caller'   ? fileName
                         : fileNameSource === 'analysis' ? analysis.fileName
                         : 'code.js';

  // استخدم repair_engine إذا موجود
  let repairResult = { repairs: [], aiNeeded: [], repaired: code };
  let engineStatus = 'RETURNED';   // محايدة عمدًا: «أعاد نتيجة» لا «نجح»
  let engineError  = null;

  if (typeof repairCode === 'function') {
    try {
      const out = repairCode(code, analysis.rawIssues, resolvedFileName);
      if (out && typeof out === 'object') {
        repairResult = out;
      } else {
        engineStatus = 'ENGINE_ERROR';
        engineError  = 'repairCode returned an empty or non-object result';
      }
    } catch (e) {
      // لا نُخفي الخطأ ولا نُعلن إصلاحًا: الكود يبقى الأصلي والبلاغات تبقى غير معالجة
      engineStatus = 'ENGINE_ERROR';
      engineError  = String((e && e.message) || e);
    }
  } else {
    // fallback بسيط
    engineStatus = 'ENGINE_UNAVAILABLE';
    repairResult.repaired = code;
    repairResult.repairs = [];
    repairResult.aiNeeded = analysis.rawIssues.filter(i =>
      ['c', 'CRITICAL'].includes(i.sev || i.severity)
    ).map(i => ({ line: i.line, title: i.title, reason: 'Requires manual review' }));
  }

  // تحقّق من شكل النتيجة قبل أي map/forEach — النقص يُسجَّل في malformed ولا يُفسَّر نجاحًا
  const malformed = [];
  const objs = (arr, name) => {
    if (!Array.isArray(arr)) { malformed.push(name); return []; }
    const ok = arr.filter(x => x && typeof x === 'object');
    if (ok.length !== arr.length) malformed.push(name + '[]');
    return ok;
  };
  const repairs  = objs(repairResult.repairs,  'repairs');
  const aiNeeded = objs(repairResult.aiNeeded, 'aiNeeded');
  const rejected = repairResult.rejected === undefined ? [] : objs(repairResult.rejected, 'rejected');
  const repairedCode = typeof repairResult.repaired === 'string'
    ? repairResult.repaired
    : (malformed.push('repaired'), code);
  if (engineStatus === 'RETURNED' && malformed.length) engineStatus = 'MALFORMED_RESULT';

  // البوابة: حكمٌ واحد على المُرشَّح كاملًا (لا حكم لكل إصلاح — repairCode لا يكشفه).
  // قراءةٌ فقط: لا تطبيق ولا تجاوز. تعذّر البوابة ⇒ UNAVAILABLE لا قبول.
  const changed = repairedCode !== code;
  // الكود تغيّر ولا إصلاح مُدرَج في repairs (مثل إضافات AuthRepair في repairCode): لا يُسكَت عنه —
  // يمرّ بالبوابة كذلك ويُرفع هذا العَلَم كي لا يُحمَل تغييرٌ غير مُعلَن على أنه «لا شيء».
  const unlistedChange = changed && !repairs.length;
  let verification;
  if (!changed) {
    verification = { status: 'NOT_APPLICABLE',
      reason: !repairs.length ? 'NO_REPAIRS' : 'REPAIRED_EQUALS_ORIGINAL' };
  } else if (typeof FixVerifier === 'undefined' || !FixVerifier ||
             typeof FixVerifier.verifyFix !== 'function' || typeof analyzeCode !== 'function') {
    verification = { status: 'UNAVAILABLE', reason: 'FixVerifier/analyzeCode not loaded' };
  } else {
    try {
      const v = FixVerifier.verifyFix(code, repairedCode, resolvedFileName, analyzeCode);
      if (v && v.accepted === true) {
        // القبول لا يعني أن الصياغة فُحصت (HTML مثلًا يُقبل بلا فاحص): syntaxVerified يُظهر ذلك
        verification = { status: 'ACCEPTED', reason: v.reason, syntaxStatus: v.syntaxStatus,
                         syntaxVerified: v.syntaxStatus === 'verified' };
      } else {
        const why = (v && v.reason) || 'GATE_REJECTED_NO_REASON';
        // «لا فاحص تركيبي لهذه اللغة» عجزٌ عن التحقق لا حكمٌ بعيبٍ في الإصلاح
        verification = /^REJECTED_NO_SYNTAX_CHECKER/.test(String(why))
          ? { status: 'UNVERIFIABLE', reason: why }
          : { status: 'REJECTED', reason: why };
      }
    } catch (e) {
      verification = { status: 'ERROR', reason: String((e && e.message) || e) };
    }
  }
  const verified = verification.status === 'ACCEPTED';
  const repairStatus = verified ? 'VERIFIED'
    : verification.status === 'REJECTED'       ? 'GATE_REJECTED'
    : verification.status === 'UNVERIFIABLE'   ? 'UNVERIFIABLE'
    : verification.status === 'NOT_APPLICABLE' ? 'NO_EFFECT'
    : 'UNVERIFIED';

  // حول للتنسيق المطلوب
  const recommendations = repairs.map(r => ({
    line:       r.line,
    title:      r.title,
    before:     r.before,
    after:      r.after,
    // لا ثقة افتراضية: 0 تبقى 0، وغير المحدَّدة null (لا 0.80 مُختلَقة)
    confidence: (r.confidence == null || (typeof r.confidence === 'number' && !isFinite(r.confidence)))
      ? null : r.confidence,
    autoFix:    verified,              // اجتاز البوابة فعلًا، لا «ذكره repairCode»
    status:     repairStatus,
    strategy:   r.strategy,
    reason:     r.reason,
    gateReason: verified ? undefined : verification.reason,
    syntaxVerified: verified ? verification.syntaxVerified : undefined,
  }));

  // أضف AI recommendations
  aiNeeded.forEach(r => {
    recommendations.push({
      line:       r.line,
      title:      r.title,
      before:     r.ev || '',
      after:      '// 🤖 يحتاج AI review',
      confidence: 0,
      autoFix:    false,
      status:     'NEEDS_AI',
      reason:     r.reason,
    });
  });

  // البلاغات التي لم يُنتج لها المحرك لا إصلاحًا ولا طلب AI: تبقى في النتيجة بسببها.
  // المطابقة بـ(line,title) معًا فقط. لا مطابقة بالعنوان وحده: عنوانٌ مماثل على سطرٍ مختلف قد يكون
  // عيبًا آخر، وربطه بإصلاحٍ ليس له يُخفي بلاغًا لم يُعالَج. الثمن المعلَن: repairCode قد يُزيح
  // رقم السطر بعد إصلاحٍ سابق (repair_engine.js)، فيبقى بلاغٌ مُصلَح مُزاحُ السطر في unresolved —
  // وهو خطأ محافظ (لا يضيع ولا يُربط بلا دليل)، والإصلاح نفسه يبقى ظاهرًا في recommendations.
  const pool = repairs.concat(aiNeeded).map(r => ({ line: r.line, title: r.title, used: false }));
  const slots = analysis.rawIssues.map(i => ({ i, ok: !!i && typeof i === 'object', hit: false }));
  slots.forEach(s => {
    if (!s.ok) return;
    const p = pool.find(x => !x.used && x.line === s.i.line && x.title === s.i.title);
    if (p) { p.used = true; s.hit = true; }
  });
  // عناصر rawIssues غير الصالحة (null/نص/رقم) ليست بلاغات يُبنى لها سجل، لكنها لا تُسقَط بصمت
  if (slots.some(s => !s.ok)) malformed.push('rawIssues[]');
  // مرشَّحو «التكرار»: إصلاحٌ/طلب AI على السطر نفسه بالدليل (ev) نفسه. للتنبيه فقط — لا يُزيل بلاغًا.
  const covers = repairs.map(r => ({ line: r.line, ev: r.before, title: r.title, strategy: r.strategy, kind: 'repair' }))
    .concat(aiNeeded.map(r => ({ line: r.line, ev: r.ev, title: r.title, strategy: r.strategy, kind: 'aiNeeded' })));
  const rejectedAt = new Map();
  rejected.forEach(r => {
    if (!rejectedAt.has(r.line)) rejectedAt.set(r.line, []);
    rejectedAt.get(r.line).push({ reason: String(r.reason || 'REJECTED'), strategy: r.strategy });
  });
  const defaultWhy =
    engineStatus === 'ENGINE_ERROR'       ? 'ENGINE_ERROR — ' + engineError
    : engineStatus === 'ENGINE_UNAVAILABLE' ? 'REPAIR_ENGINE_UNAVAILABLE — لا repairCode في هذه البيئة'
    : 'NOT_REPORTED_BY_ENGINE — لم يُصدر repairCode إصلاحًا ولا طلب مراجعة لهذا البلاغ';
  const unresolved = [];
  slots.forEach(s => {
    if (!s.ok || s.hit) return;
    const i = s.i;
    // سجلّ الرفض يحمل السطر والاستراتيجية بلا عنوان البلاغ، فالإسناد هنا بالسطر وحده
    // (SAME_LINE_ONLY): قد يخصّ بلاغًا شقيقًا على السطر نفسه — يُصرَّح به ولا يُدَّعى جزمًا.
    const why = rejectedAt.get(i.line);
    const rec = {
      line:   i.line,
      title:  i.title,
      sev:    i.sev || i.severity,
      source: why ? 'REJECTED_SAME_LINE'
            : (engineStatus === 'RETURNED' || engineStatus === 'MALFORMED_RESULT') ? 'NOT_REPORTED'
            : engineStatus,
      // الربط بالسطر وحده ⇒ السبب مُعلَّم «غير مؤكَّد» نصًّا أيضًا، مع استراتيجية الرفض ليحكم المراجِع
      reason: why
        ? 'UNCONFIRMED (matched by line only; rejected strategy: ' +
          why.map(w => w.strategy || 'unknown').join(',') + ') — ' + why.map(w => w.reason).join(' · ')
        : defaultWhy,
    };
    if (why) rec.attribution = 'SAME_LINE_ONLY';
    const ev = i.ev == null ? '' : String(i.ev);
    const cov = ev.trim() === '' ? null
      : covers.find(c => c.line === i.line && c.ev != null && String(c.ev) === ev);
    if (cov) {
      // قد يكون العيبَ نفسَه ببلاغٍ شقيق، وقد يكون عيبًا آخر على السطر نفسه — لذا «ربما» وتبقى في unresolved
      rec.relation = 'SAME_LINE_SAME_EVIDENCE';
      rec.possiblyCoveredBy = { line: cov.line, title: cov.title, strategy: cov.strategy, kind: cov.kind };
    }
    unresolved.push(rec);
  });

  // تقدير الوقت — تقديرٌ للجهد لا ادّعاء نتيجة، فيُحسب على المقترَح كما كان على repairs.length
  const proposed  = repairs.length;
  const applied   = 0;                     // هذه الدالة لا تطبّق: التطبيق بيد المستدعي
  const autoFixed = verified ? proposed : 0;
  const needsAI   = aiNeeded.length;
  const minutes   = proposed * 0.1 + needsAI * 5;
  const estimatedTime = minutes < 1 ? 'أقل من دقيقة'
    : minutes < 60 ? Math.round(minutes) + ' دقيقة'
    : Math.round(minutes / 60) + ' ساعة';

  // Re-analysis summary — الأرقام بعد الإصلاح تُقبل من reAnalysis فقط وبشرط أن تكون أرقامًا
  // منتهية. لا معادلة تقديرية ولا «بقي = الكل − المُصلَح»: غيابها ⇒ null + UNAVAILABLE.
  const reAnalysis = repairResult.reAnalysis || null;
  const measured = k => !!reAnalysis && typeof reAnalysis === 'object' &&
                        typeof reAnalysis[k] === 'number' && isFinite(reAnalysis[k]);

  return {
    repaired:        repairedCode,
    recommendations,
    autoFixed,
    needsAI,
    estimatedTime,
    reAnalysis,
    engineStatus,
    error:           engineError ? { message: engineError } : null,
    malformed,
    verification,
    unlistedChange,
    fileName:        resolvedFileName,
    fileNameSource,
    rejected,
    unresolved,
    summary: {
      totalIssues:   analysis.total,
      proposed,      // ذكرها المحرك (repairs.length) — ليست دليل نجاح
      verified:      autoFixed,   // اجتازت FixVerifier.verifyFix على المُرشَّح كاملًا
      applied,       // دائمًا 0 هنا
      autoFixed,
      needsAI,
      unresolved:    unresolved.length,
      unresolvedLinked: unresolved.filter(u => u.possiblyCoveredBy).length,   // منها مرشَّحة كتكرار (لم تُحذف)
      remaining:    measured('issuesAfter') ? reAnalysis.issuesAfter : null,
      remainingStatus: measured('issuesAfter') ? 'MEASURED' : 'UNAVAILABLE',
      riskBefore:    analysis.riskScore,
      riskAfter:     measured('riskAfter') ? reAnalysis.riskAfter : null,
      riskAfterStatus: measured('riskAfter') ? 'MEASURED' : 'UNAVAILABLE',
    },
  };
}
