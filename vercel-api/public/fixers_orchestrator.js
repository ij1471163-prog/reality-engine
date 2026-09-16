// ═══════════════════════════════════════════════════════
// fixers_orchestrator.js v2.2
// طبقة تجميع فقط: Fixer → تعديل → Verification → اعتماد أو rollback
//
// المشكلة في v1.0 التي يعالجها هذا الملف:
//   كانت كل الـfixers تتراكم فوق بعضها بلا أي تحقق بينها، و analyzeCode
//   يُستدعى مرة واحدة في النهاية دون أن تُستخدم نتيجته في أي قرار - أي أنه
//   لم يكن هناك تحقق ولا rollback إطلاقًا.
//
// التغييرات التراكمية:
//   [v2.0] كل fixer يُتحقق منه وحده فورًا، ويعمل على آخر كود موثوق. الفشل
//          يعني رجوعًا ضمنيًا كاملًا، فلا يبني fixer على ناتج مشكوك فيه.
//   [v2.1] الفحص التركيبي صار حسب لغة الملف. كان new Function() يُطبَّق على
//          أي ملف فيرفض أي Python/PHP/Java دائمًا كـSyntaxError، فيتحول
//          "التحقق" إلى رفض شامل لكل اللغات غير JS.
//   [v2.1] deferredToClaude → deferred. الاسم القديم كان يَعِد بشيء لا يفعله
//          هذا الملف: هو يُرجع قائمة فقط، والطبقة الأعلى هي من تستهلكها.
//   [v2.2] هوية المشكلة صارت مستقرة (ruleId/type + file) والمقارنة بالعدّ لا
//          بالمجموعات. في v2.1 كان مقتطف الكود جزءًا من الهوية، فالإصلاح نفسه
//          يغيّر النص ويبدو كأنه "أزال قديمة وأضاف جديدة" فيُرفض إصلاح صحيح.
//          والعدّ يسد ثغرة مقابلة: "أصلح واحدة وكسر أخرى من نفس النوع".
//   [v2.2] syntaxStatus يبدأ "unknown" ولا يصير "verified" إلا بفحص فعلي ناجح.
//   [v2.2] severity تُحسب على المشاكل المضافة فقط (addedHighSeverity)، لا على
//          كل المشاكل الخطيرة الموجودة بعد التعديل.
//
// التوافق:
//   لا يكسر الواجهة السابقة: applySpecializedFixers(F, R) تعمل كما هي،
//   وأُضيف وسيط ثالث اختياري opts. أي استدعاء قديم يبقى صالحًا.
//
//   ⚠️ لكن شكل القيمة المُعادة تغيّر - تحتاج انتباه الطبقة الأعلى:
//      - deferredToClaude → deferred  (إعادة تسمية)
//      - أُضيف: totalRejected, rejected
//      - الحقول القديمة totalFixed و results لم تتغيّر.
//
// ⚠️ عقد مع الطبقة الأعلى (RealityOrchestrator):
//   الحقل `deferred` ليس نتيجة نهائية. هو طلب مراجعة صريح. إن لم تستهلكه
//   الطبقة الأعلى وترسله إلى المسار الأعلى (Claude → Verification → Human
//   approval)، فإن هذه المشاكل تُهمل بصمت. هذا الملف لا يستطيع ضمان ذلك
//   بنفسه، ولا يدّعي أنه يفعله.
//
// حدود مُعلنة:
//   التحقق هنا يثبت أن "الوضع العام لم يسُؤ وتحسّن بمقدار ما"، ولا يثبت أن
//   الـfixer أصلح المشكلة المقصودة تحديدًا. اختيار ما يُصلَح مسؤولية الـfixer
//   نفسه. لإثبات أدق يلزم أن يُرجع الـfixer المشكلة المستهدفة صراحةً، وهذا
//   يتطلب تعديل الـfixers لا هذا الملف.
// ═══════════════════════════════════════════════════════
"use strict";

// ───────────────────────────────────────────────
// [1] اللغة والفحص التركيبي
// ───────────────────────────────────────────────

/** يستنتج اللغة من الامتداد. يُرجع "unknown" إن لم يُعرف. */
function _detectLanguage(filename) {
  const m = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!m) return "unknown";
  switch (m[1]) {
    case "js": case "mjs": case "cjs": case "jsx": return "javascript";
    case "ts": case "tsx":                          return "typescript";
    case "json":                                    return "json";
    case "py":                                      return "python";
    case "php":                                     return "php";
    case "java":                                    return "java";
    case "c": case "h":                             return "c";
    case "cpp": case "cc": case "hpp":              return "cpp";
    case "rb":                                      return "ruby";
    case "go":                                      return "go";
    default:                                        return "unknown";
  }
}

/**
 * فحص تركيبي حقيقي، حسب اللغة.
 *
 * @returns {{ok: boolean, available: boolean, language: string, reason: string|null}}
 *   available=false ⇒ لا يوجد فاحص لهذه اللغة في هذه البيئة.
 *                     لا يُعتبر ذلك نجاحًا أبدًا - القرار يعود لـ_verifyFix.
 *
 * ملاحظة صريحة: لا يوجد هنا فاحص لـ Python/PHP/Java/C/C++/Ruby/Go.
 * لا نحاول فحصها بأداة JavaScript لأن ذلك ينتج نتيجة خاطئة، لا نتيجة ناقصة.
 */
function _syntaxCheck(code, filename) {
  const language = _detectLanguage(filename);

  if (language === "json") {
    try {
      JSON.parse(code);
      return { ok: true, available: true, language, reason: null };
    } catch (e) {
      return { ok: false, available: true, language, reason: "JSON parse error: " + e.message };
    }
  }

  // TypeScript: نحاول فقط إن وُجد مترجم TS حقيقي. لا نفحصه كـJS لأن صيغته
  // (types, generics, decorators) ستُرفض خطأً من أي JS parser.
  if (language === "typescript") {
    try {
      if (typeof ts !== "undefined" && ts && typeof ts.transpileModule === "function") {
        const out = ts.transpileModule(code, {
          reportDiagnostics: true,
          compilerOptions: { noEmit: true }
        });
        const errs = (out.diagnostics || []).filter(d => d.category === 1 /* Error */);
        if (errs.length) {
          const msg = typeof ts.flattenDiagnosticMessageText === "function"
            ? ts.flattenDiagnosticMessageText(errs[0].messageText, " ")
            : String(errs[0].messageText);
          return { ok: false, available: true, language, reason: "TS error: " + msg };
        }
        return { ok: true, available: true, language, reason: null };
      }
    } catch (e) {
      return { ok: false, available: true, language, reason: "TS check failed: " + e.message };
    }
    return { ok: false, available: false, language, reason: "no TypeScript compiler available" };
  }

  if (language === "javascript") {
    // 1) parser حقيقي إن وُجد
    try {
      if (typeof acorn !== "undefined" && acorn && typeof acorn.parse === "function") {
        acorn.parse(code, { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: true });
        return { ok: true, available: true, language, reason: null };
      }
    } catch (e) {
      // قد يكون الملف script لا module - نعيد المحاولة قبل الحكم بالفشل
      try {
        acorn.parse(code, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true });
        return { ok: true, available: true, language, reason: null };
      } catch (e2) {
        return { ok: false, available: true, language, reason: "acorn parse error: " + e2.message };
      }
    }

    try {
      if (typeof esprima !== "undefined" && esprima && typeof esprima.parseModule === "function") {
        esprima.parseModule(code, { tolerant: false });
        return { ok: true, available: true, language, reason: null };
      }
    } catch (e) {
      return { ok: false, available: true, language, reason: "esprima parse error: " + e.message };
    }

    // 2) fallback: تجميع بدون تنفيذ إطلاقًا
    try {
      if (typeof Function === "function") {
        // eslint-disable-next-line no-new-func
        new Function(code);
        return { ok: true, available: true, language, reason: null };
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        // new Function لا يفهم import/export (صيغة module صحيحة تمامًا).
        // لا نحكم بالفشل في هذه الحالة - نعتبر الفاحص غير متاح لهذا الملف.
        if (/\b(import|export)\b/.test(code) && /(import|export|Unexpected token)/i.test(e.message)) {
          return {
            ok: false, available: false, language,
            reason: "ES module syntax - new Function() cannot verify it (needs acorn/esprima)"
          };
        }
        return { ok: false, available: true, language, reason: "SyntaxError: " + e.message };
      }
      // خطأ غير تركيبي (ReferenceError مثلًا) لا يعني كسرًا في التركيب
      return { ok: true, available: true, language, reason: null };
    }
    return { ok: false, available: false, language, reason: "no JS syntax checker available" };
  }

  // لغة معروفة لكن بلا فاحص، أو امتداد غير معروف
  return {
    ok: false,
    available: false,
    language,
    reason: language === "unknown"
      ? "unknown file type - no syntax checker"
      : "no syntax checker available for language: " + language
  };
}

// ───────────────────────────────────────────────
// [2] بصمة المشكلة (مستقلة عن رقم السطر)
// ───────────────────────────────────────────────

function _normalizeIssues(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.issues)) return raw.issues;
  return null; // ⚠️ null ≠ [] : null تعني "تعذّر التحليل"، وليست "صفر مشاكل"
}

/** يطبّع نصًا: يحذف كل المسافات ويوحّد حالة الأحرف. */
function _normalizeSnippet(s) {
  return String(s == null ? "" : s).replace(/\s+/g, "").toLowerCase().slice(0, 100);
}

/**
 * هوية مشكلة **مستقرة**: لا تعتمد على رقم السطر ولا على نص الكود.
 *
 * لماذا لا نستخدم مقتطف الكود (كما في v2.1):
 *   الإصلاح نفسه يغيّر النص. "query = userInput" تصبح
 *   "query = validate(userInput)"، فتبدو المشكلة القديمة وكأنها اختفت
 *   وظهرت أخرى جديدة، ويُرفض إصلاح صحيح.
 *
 * لماذا لا نكتفي بمقارنة المجموعات (Set) على هذه الهوية:
 *   لأن ذلك يفقد العدد. ملف فيه مشكلتان SQL_INJECTION وأُصلحت واحدة يعطي
 *   نفس المجموعة قبل وبعد ⇒ "لا تحسّن" ⇒ رفض خاطئ. والأخطر: fixer يُصلح
 *   واحدة ويكسر أخرى من نفس النوع لن يُكتشف إطلاقًا.
 *
 * الحل: هوية مستقرة + مقارنة بالعدّ (انظر _issueCounts / _diffCounts).
 */
function _issueKey(issue) {
  if (issue == null) return "unknown";
  if (typeof issue === "string") {
    return "raw|" + _normalizeSnippet(issue).replace(/\d+/g, "#");
  }

  // معرّف ثابت صرّح به المحلل إن وُجد، وإلا النوع. لا نستخدم نص الكود أبدًا.
  const stable = issue.ruleId || issue.rule || issue.id || issue.type
    || issue.name || issue.title || issue.category || "issue";
  const file = issue.file || issue.filename || "";
  return String(stable) + "|" + file;
}

/** @returns {Map<string, number>} عدد المشاكل لكل هوية مستقرة. */
function _issueCounts(issues) {
  const m = new Map();
  (issues || []).forEach(i => {
    const k = _issueKey(i);
    m.set(k, (m.get(k) || 0) + 1);
  });
  return m;
}

/**
 * يقارن العدّ قبل/بعد.
 * @returns {{worsened: Array, improved: Array, removedCount: number,
 *            addedCount: number, addedHighSeverity: number}}
 *   worsened: هويات ازداد عددها (أو ظهرت) ⇒ تدهور حقيقي. كل عنصر يحمل
 *             severity المشاكل المضافة فعليًا تحت تلك الهوية.
 *   improved: هويات نقص عددها ⇒ تحسّن حقيقي.
 *   addedHighSeverity: عدد المشاكل الخطيرة **التي أضافها التعديل فقط** -
 *             وليس كل المشاكل الخطيرة في الملف.
 */
function _diffCounts(beforeIssues, afterIssues) {
  const before = _issueCounts(beforeIssues);
  const after = _issueCounts(afterIssues);
  const keys = new Set([...before.keys(), ...after.keys()]);

  // نجمّع مشاكل "بعد" حسب الهوية لنستخرج severity الخاصة بالزيادة فقط
  const afterByKey = new Map();
  (afterIssues || []).forEach(i => {
    const k = _issueKey(i);
    if (!afterByKey.has(k)) afterByKey.set(k, []);
    afterByKey.get(k).push(i);
  });

  const worsened = [], improved = [];
  let removedCount = 0, addedCount = 0, addedHighSeverity = 0;

  keys.forEach(k => {
    const b = before.get(k) || 0;
    const a = after.get(k) || 0;
    if (a > b) {
      const delta = a - b;
      // المشاكل الزائدة تحت هذه الهوية: نأخذ آخر delta منها كعيّنة تمثيلية
      // (الهوية واحدة، فأي delta منها يمثل الزيادة).
      const sample = (afterByKey.get(k) || []).slice(0, delta);
      const high = sample.filter(_isHighSeverity).length;
      worsened.push({ key: k, before: b, after: a, added: delta, addedHighSeverity: high });
      addedCount += delta;
      addedHighSeverity += high;
    } else if (a < b) {
      const delta = b - a;
      improved.push({ key: k, before: b, after: a, removed: delta });
      removedCount += delta;
    }
  });

  return { worsened, improved, removedCount, addedCount, addedHighSeverity };
}

function _isHighSeverity(issue) {
  const sev = issue && (issue.severity || issue.level || issue.priority);
  if (!sev) return false;
  return /^(critical|high|error|severe)$/i.test(String(sev));
}

// ───────────────────────────────────────────────
// بوابة التحقق
// ───────────────────────────────────────────────

/**
 * يقرر قبول أو رفض تعديل fixer واحد.
 *
 * شروط القبول (كلها مطلوبة):
 *   1. الكود غير فارغ ولم يفقد نصفه.
 *   2. سليم تركيبيًا - أو مسموح صراحة بالمتابعة بلا فاحص.
 *   3. لم تظهر أي مشكلة جديدة.
 *   4. اختفت مشكلة واحدة على الأقل.
 */
function _verifyFix(beforeCode, afterCode, beforeIssues, filename, opts) {
  opts = opts || {};
  const allowUnverifiedLanguages = opts.allowUnverifiedLanguages === true;

  if (typeof afterCode !== "string" || afterCode.trim().length === 0) {
    return { accepted: false, reason: "REJECTED_EMPTY_OUTPUT", afterIssues: null };
  }
  if (beforeCode.length > 200 && afterCode.length < beforeCode.length * 0.5) {
    return {
      accepted: false,
      reason: "REJECTED_SUSPICIOUS_SHRINK (فقد أكثر من نصف الكود - غالبًا حذف غير مقصود)",
      afterIssues: null
    };
  }

  // (2) فحص تركيبي حسب اللغة
  const syn = _syntaxCheck(afterCode, filename);
  // يبدأ "unknown" عمدًا: لا نعتبر الكود سليمًا قبل اكتمال الفحص فعليًا.
  // verified فقط بعد فحص حقيقي نجح.
  let syntaxStatus = "unknown";

  if (syn.available && !syn.ok) {
    return {
      accepted: false,
      reason: "REJECTED_SYNTAX_BROKEN [" + syn.language + "]: " + syn.reason,
      afterIssues: null, syntaxStatus: "broken", language: syn.language
    };
  }
  if (syn.available && syn.ok) {
    syntaxStatus = "verified";
  } else {
    // لا يوجد فاحص لهذه اللغة
    if (!allowUnverifiedLanguages) {
      return {
        accepted: false,
        reason: "REJECTED_NO_SYNTAX_CHECKER [" + syn.language + "]: " + syn.reason
          + " - لا نعتمد تعديلًا لا نستطيع التحقق من سلامته. فعّل opts.allowUnverifiedLanguages لتجاوز ذلك صراحةً.",
        afterIssues: null, syntaxStatus: "no_checker", language: syn.language
      };
    }
    syntaxStatus = "unverified_language"; // مسموح، لكن موسوم بصراحة
  }

  // حارس دفاعي: يجب ألا نصل إلى ما بعد هذه النقطة بحالة غير محسومة.
  if (syntaxStatus === "unknown") {
    return {
      accepted: false,
      reason: "REJECTED_SYNTAX_STATE_UNRESOLVED (حالة فحص غير محسومة - رفض احترازي)",
      afterIssues: null, syntaxStatus: "unknown", language: syn.language
    };
  }

  // (3) إعادة التحليل
  if (typeof analyzeCode !== "function") {
    return { accepted: false, reason: "REJECTED_ANALYZER_UNAVAILABLE", afterIssues: null };
  }
  let afterIssues;
  try {
    afterIssues = _normalizeIssues(analyzeCode(afterCode, filename));
  } catch (e) {
    return { accepted: false, reason: "REJECTED_ANALYZER_THREW: " + e.message, afterIssues: null };
  }
  if (afterIssues === null) {
    return { accepted: false, reason: "REJECTED_ANALYSIS_INCONCLUSIVE", afterIssues: null };
  }

  // (4) مقارنة بالعدّ على هوية مستقرة - لا تتأثر بتغيّر نص الكود ولا بالأسطر،
  //     وتكتشف "أصلح واحدة وكسر أخرى من نفس النوع" لأن العدد لا ينقص.
  const diff = _diffCounts(beforeIssues, afterIssues);

  if (diff.worsened.length > 0) {
    return {
      accepted: false,
      reason: "REJECTED_ISSUES_WORSENED (+" + diff.addedCount + "): "
        + diff.worsened.slice(0, 3).map(w => w.key + " " + w.before + "→" + w.after).join(" | ")
        + (diff.addedHighSeverity
            ? " [منها " + diff.addedHighSeverity + " خطيرة أضافها هذا التعديل]" : ""),
      afterIssues, syntaxStatus, language: syn.language
    };
  }

  if (diff.removedCount === 0) {
    return {
      accepted: false,
      reason: "REJECTED_NO_IMPROVEMENT (تغيّر الكود دون إنقاص أي مشكلة)",
      afterIssues, syntaxStatus, language: syn.language
    };
  }

  return {
    accepted: true,
    reason: "ACCEPTED (أزال " + diff.removedCount + " مشكلة: "
      + diff.improved.slice(0, 3).map(w => w.key + " " + w.before + "→" + w.after).join(" | ")
      + ", بلا تدهور)"
      + (syntaxStatus === "verified" ? "" : " ⚠️ SYNTAX_UNVERIFIED [" + syn.language + "]"),
    afterIssues,
    removedCount: diff.removedCount,
    syntaxStatus,
    syntaxVerified: syntaxStatus === "verified",
    language: syn.language
  };
}

// ───────────────────────────────────────────────
// الواجهة الرئيسية
// ───────────────────────────────────────────────

/**
 * @param {Object} F  filename -> code
 * @param {Object} R  filename -> { code, issues }
 * @param {Object} [opts]
 *   opts.allowUnverifiedLanguages  افتراضي false. عند true، يُسمح باعتماد تعديل
 *        في لغة بلا فاحص تركيبي، ويوسم بـsyntaxVerified:false في النتيجة.
 *   opts.stopFileOnReject          افتراضي false.
 *
 * @returns {{totalFixed, totalRejected, results, rejected, deferred}}
 *   deferred: طلبات مراجعة لم تُطبَّق. على الطبقة الأعلى استهلاكها - انظر
 *             عقد الاستهلاك أعلى الملف.
 */
function applySpecializedFixers(F, R, opts) {
  opts = opts || {};

  const allFixers = [
    { name: 'Command Injection', fixer: typeof CommandInjectionFixer !== 'undefined' ? CommandInjectionFixer : null },
    { name: 'SQL Injection',     fixer: typeof SQLInjectionFixer     !== 'undefined' ? SQLInjectionFixer     : null },
    { name: 'JWT',               fixer: typeof JWTFixer              !== 'undefined' ? JWTFixer              : null },
    { name: 'XSS',               fixer: typeof XSSFixer              !== 'undefined' ? XSSFixer              : null },
    { name: 'Secrets',           fixer: typeof SecretsFixer          !== 'undefined' ? SecretsFixer          : null },
  ].filter(f => f.fixer && typeof f.fixer.canFix === 'function' && typeof f.fixer.fix === 'function');

  const results = {};
  const rejected = {};
  const deferred = {};
  let totalFixed = 0;
  let totalRejected = 0;

  Object.keys(F).forEach(fn => {
    let currentIssues = _normalizeIssues(R[fn] && R[fn].issues) || [];
    if (currentIssues.length === 0) return; // ملف سليم: لا يُلمس إطلاقًا

    const originalCode = F[fn];
    let acceptedCode = originalCode;   // آخر كود موثوق = نقطة الرجوع
    const fileRepairs = [];
    const fileRejects = [];
    const fileDeferred = [];

    for (const { name, fixer } of allFixers) {
      let applicable;
      try {
        applicable = fixer.canFix(currentIssues);
      } catch (e) {
        fileRejects.push({ fixer: name, reason: "canFix threw: " + e.message });
        continue;
      }
      if (!applicable) continue;

      let out;
      try {
        out = fixer.fix(acceptedCode, fn); // دائمًا على آخر كود موثوق
      } catch (e) {
        fileRejects.push({ fixer: name, reason: "fix threw: " + e.message });
        if (opts.stopFileOnReject) break;
        continue;
      }

      if (!out || !out.changed) continue;
      const candidate = out.fixed;
      if (candidate === acceptedCode) continue;

      // fixer صرّح بعدم ثقته → لا يُطبَّق، ويُرفع للمراجعة الأعلى
      if (out.confident === false || out.needsReview === true) {
        fileDeferred.push({
          fixer: name,
          file: fn,
          reason: out.reason || "الـfixer صرّح بأنه غير واثق - تُرك للمراجعة بدل تطبيق تعديل مخترع",
          issues: currentIssues.filter(i => { try { return fixer.canFix([i]); } catch (e) { return false; } })
        });
        continue;
      }

      const verdict = _verifyFix(acceptedCode, candidate, currentIssues, fn, opts);

      if (verdict.accepted) {
        acceptedCode = candidate;
        currentIssues = verdict.afterIssues;
        fileRepairs.push({
          fixer: name,
          file: fn,
          removedIssues: verdict.removedCount,
          syntaxStatus: verdict.syntaxStatus,
          syntaxVerified: verdict.syntaxVerified,
          language: verdict.language,
          verification: verdict.reason
        });
      } else {
        // rollback ضمني: acceptedCode لم يتغيّر
        fileRejects.push({ fixer: name, reason: verdict.reason });
        totalRejected++;
        if (opts.stopFileOnReject) break;
      }
    }

    if (fileRepairs.length > 0 && acceptedCode !== originalCode) {
      F[fn] = acceptedCode;
      R[fn] = { code: acceptedCode, issues: currentIssues };
      totalFixed += fileRepairs.length;
      results[fn] = fileRepairs;
    }
    // لا تعديل مقبول ⇒ F[fn] و R[fn] كما هما تمامًا، بلا أثر جانبي

    if (fileRejects.length)  rejected[fn] = fileRejects;
    if (fileDeferred.length) deferred[fn] = fileDeferred;
  });

  return { totalFixed, totalRejected, results, rejected, deferred };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    applySpecializedFixers,
    _verifyFix, _syntaxCheck, _normalizeIssues, _issueKey, _detectLanguage,
    _issueCounts, _diffCounts
  };
}
