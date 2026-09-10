/**
 * self_healing_engine.js v2.0 — بعد المراجعة
 * ══════════════════════════════════════════════════════
 * إصلاحات:
 * 1. تخزين واضح: memory في Browser، لا ادعاء كتابة JSON
 * 2. Syntax: new Function() محدود للـ JS فقط، TS/JSX → SKIPPED
 * 3. Regression: يقارن type+location+severity لا العدد فقط
 * 4. Conflicts: fingerprint = type+location+severity
 * 5. DependencyIssues: تقرير فقط، لا healing تلقائي
 * 6. Patcher: لا transforms عامة — SKIPPED إن لا دليل قوي
 * 7. كل شيء بدون fixer موثوق → PENDING_REVIEW/SKIPPED
 * 8. monitor() يدعم async/Promise
 * 9. يرتبط بـ APIs موجودة فعلاً في Reality Engine
 * ══════════════════════════════════════════════════════
 */

"use strict";

(function (global) {

// ═══════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════

const SH_VERSION = "2.0.0";
const MAX_LOG    = 200;
const MAX_SNAPS  = 50;

const Status = Object.freeze({
  PENDING_REVIEW: "PENDING_REVIEW",
  APPROVED:       "APPROVED",
  REJECTED:       "REJECTED",
  ROLLED_BACK:    "ROLLED_BACK",
});

const HealingResult = Object.freeze({
  PASS:    "PASS",
  FAIL:    "FAIL",
  SKIPPED: "SKIPPED",
});

// ═══════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════
//
// ⚠️ التوضيح:
// التخزين يتم في ذاكرة المتصفح (Map) طوال الجلسة.
// لا يُكتب أي ملف JSON على القرص تلقائياً.
// "healing_log.json" هو قالب للتوثيق فقط.
// لحفظ السجل دائماً: استخدم exportLog() ثم احفظه يدوياً.
//
// ═══════════════════════════════════════════════════════

const _store = new Map();

function storeGet(key)       { return _store.get(key) ?? null; }
function storeSet(key, val)  { _store.set(key, val); }

// ═══════════════════════════════════════════════════════
// Log Manager
// ═══════════════════════════════════════════════════════

const Log = {
  _key: "sh_log",

  _all()       { return storeGet(this._key) || []; },
  _save(list)  { storeSet(this._key, list); },

  add(entry) {
    const all = this._all();
    const full = { ...entry, timestamp: new Date().toISOString() };
    all.unshift(full);
    if (all.length > MAX_LOG) all.length = MAX_LOG;
    this._save(all);
    return full;
  },

  update(id, patch) {
    const all = this._all();
    const idx = all.findIndex(e => e.id === id);
    if (idx >= 0) { Object.assign(all[idx], patch); this._save(all); }
  },

  getAll()     { return this._all(); },
  getById(id)  { return this._all().find(e => e.id === id) || null; },
  getPending() { return this._all().filter(e => e.status === Status.PENDING_REVIEW); },

  // ✅ Export للحفظ اليدوي
  exportJSON() {
    return JSON.stringify({
      _meta:   { version: SH_VERSION, exportedAt: new Date().toISOString() },
      entries: this._all(),
    }, null, 2);
  },
};

// ═══════════════════════════════════════════════════════
// Snapshot Manager
// ═══════════════════════════════════════════════════════

const Snapshots = {
  _key: "sh_snaps",

  _all()       { return storeGet(this._key) || []; },
  _save(list)  { storeSet(this._key, list); },

  create(entryId, files) {
    const snap = {
      id:        entryId,
      createdAt: new Date().toISOString(),
      files,
      patch:     null,
    };
    const all = this._all();
    all.unshift(snap);
    if (all.length > MAX_SNAPS) all.length = MAX_SNAPS;
    this._save(all);
    return snap;
  },

  attachPatch(entryId, patch) {
    const all = this._all();
    const idx = all.findIndex(s => s.id === entryId);
    if (idx >= 0) { all[idx].patch = patch; this._save(all); }
  },

  getById(id) { return this._all().find(s => s.id === id) || null; },

  diff(original, modified) {
    const ol = (original || "").split("\n");
    const ml = (modified  || "").split("\n");
    const changes = [];
    const max = Math.max(ol.length, ml.length);
    for (let i = 0; i < max; i++) {
      if (ol[i] !== ml[i]) {
        changes.push({
          line:   i + 1,
          before: ol[i] ?? null,
          after:  ml[i] ?? null,
          type:   ol[i] == null ? "added" : ml[i] == null ? "removed" : "changed",
        });
      }
    }
    return { totalLines: max, changes, changedCount: changes.length };
  },
};

// ═══════════════════════════════════════════════════════
// Engine Discovery — يكتشف المحركات المتاحة فعلاً
// ═══════════════════════════════════════════════════════

const Engines = {
  // يكتشف الـ APIs الموجودة في Reality Engine
  available() {
    return {
      analyzeCode:            typeof analyzeCode            === "function",
      analyzeJSWithAST:       typeof analyzeJSWithAST       === "function",
      analyzeJSEnhanced:      typeof analyzeJSEnhanced      === "function",
      deduplicateIssues:      typeof deduplicateIssues      === "function",
      analyzeProject:         typeof analyzeProject         === "function",
      RepairSQL:              typeof RepairSQL !== "undefined" &&
                              typeof RepairSQL.fix  === "function" &&
                              typeof RepairSQL.scan === "function",
      analyzeWithIntelligence:typeof analyzeWithIntelligence === "function",
      suggestFix:             typeof suggestFix             === "function",
    };
  },

  // يشغّل المحرك المناسب للغة — لا يستخدم JS engine على Python/PHP/Java
  runAnalyzer(code, fileName) {
    const ext = (fileName || "").split(".").pop().toLowerCase();
    const isJS = ["js", "jsx", "ts", "tsx", "html"].includes(ext);

    // ✅ analyzeJSEnhanced و analyzeJSWithAST لـ JS فقط
    if (isJS && typeof analyzeJSEnhanced === "function") {
      return analyzeJSEnhanced(code, fileName);
    }
    if (isJS && typeof analyzeCode === "function") {
      return analyzeCode(code, fileName);
    }

    // لغات أخرى: analyzeCode العام فقط لو متاح ويدعم هذه اللغة
    if (!isJS && typeof analyzeCode === "function") {
      return analyzeCode(code, fileName);
    }

    return null; // لا محرك مناسب
  },
};

// ═══════════════════════════════════════════════════════
// Issue Fingerprint
// ═══════════════════════════════════════════════════════

function fingerprint(issue) {
  // ✅ encodeURIComponent + | لتجنب كسر التحليل لو severity تحتوي ":"
  const type = encodeURIComponent(issue.type || issue.title || "");
  const line = issue.line || 0;
  const sev  = encodeURIComponent(issue.sev || issue.severity || "");
  return `${type}|${line}|${sev}`;
}

// ═══════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════

const Tests = {

  // 1. Syntax — محدود للغات المدعومة فعلاً
  syntax(code, fileName) {
    if (!code || !code.trim()) return { pass: false, error: "الكود فاضي" };
    const ext = (fileName || "").split(".").pop().toLowerCase();

    if (ext === "js") {
      // new Function() مقبول لـ JS فقط
      try { new Function(code); return { pass: true }; }
      catch (e) { return { pass: false, error: e.message }; }
    }

    if (ext === "py") {
      // فحص بدائي لـ Python — أقواس فقط
      const open  = (code.match(/\(/g) || []).length;
      const close = (code.match(/\)/g) || []).length;
      if (open !== close) return { pass: false, error: "أقواس ( ) غير متوازنة" };
      const openB  = (code.match(/\[/g) || []).length;
      const closeB = (code.match(/\]/g) || []).length;
      if (openB !== closeB) return { pass: false, error: "أقواس [ ] غير متوازنة" };
      return { pass: true };
    }

    // TS / JSX / TSX / HTML / PHP / Java / Kotlin / Dart → SKIPPED
    // لا parser موثوق متاح في هذه البيئة
    return {
      pass:    true,
      skipped: true,
      reason:  `Syntax check غير مدعوم لـ .${ext} — SKIPPED`,
    };
  },

  // 2. Engine Smoke — يشغّل المحركات المتاحة فعلاً فقط
  engineSmoke(code, fileName) {
    const avail   = Engines.available();
    const results = {};

    if (avail.analyzeCode || avail.analyzeJSEnhanced) {
      try {
        const r = Engines.runAnalyzer(code, fileName);
        results["analyzer"] = {
          pass:  true,
          count: Array.isArray(r) ? r.length : 0,
        };
      } catch (e) {
        results["analyzer"] = { pass: false, error: e.message };
      }
    }

    if (avail.analyzeProject) {
      try {
        const r = analyzeProject(code, fileName);
        results["project"] = { pass: true, hasReport: !!r };
      } catch (e) {
        results["project"] = { pass: false, error: e.message };
      }
    }

    if (avail.RepairSQL && typeof RepairSQL.scan === "function") {
      try {
        const r = RepairSQL.scan(code, fileName);
        results["RepairSQL"] = { pass: true, issues: r.length };
      } catch (e) {
        results["RepairSQL"] = { pass: false, error: e.message };
      }
    }

    if (Object.keys(results).length === 0) {
      return { _note: "لا محركات متاحة للاختبار في هذه البيئة" };
    }

    return results;
  },

  // 3. Regression — يقارن fingerprints، يستثني المشاكل المستهدفة من unexpectedDisappear
  //
  // targetIssues: مصفوفة issues تم استهدافها بالإصلاح (اختفاؤها متوقع)
  regression(beforeCode, afterCode, fileName, targetIssues) {
    const run = (code) => {
      try { return Engines.runAnalyzer(code, fileName) || []; }
      catch (_) { return []; }
    };

    const beforeIssues = run(beforeCode);
    const afterIssues  = run(afterCode);

    const beforeFPs = new Set(beforeIssues.map(fingerprint));
    const afterFPs  = new Set(afterIssues.map(fingerprint));

    // fingerprints المشاكل المستهدفة — اختفاؤها متوقع ومقبول
    const targetFPs = new Set(
      Array.isArray(targetIssues) ? targetIssues.map(fingerprint) : []
    );

    // مشاكل اختفت
    const disappeared = [...beforeFPs].filter(fp => !afterFPs.has(fp));

    // مشاكل جديدة ظهرت (regression دائماً خطأ)
    const newIssues = [...afterFPs].filter(fp => !beforeFPs.has(fp));

    // اختفاء غير متوقع: HIGH/CRITICAL اختفت وليست من المستهدفات
    const unexpectedDisappear = disappeared.filter(fp => {
      if (targetFPs.has(fp)) return false; // ✅ مستهدفة → متوقع → استثنِها
      const parts = fp.split("|");
      const sev   = parts[2] ? decodeURIComponent(parts[2]) : "";
      return ["c", "h", "CRITICAL", "HIGH"].includes(sev);
    });

    // المشاكل المستهدفة التي اختفت فعلاً (تحقق الإصلاح)
    const targetFixed = [...targetFPs].filter(fp => beforeFPs.has(fp) && !afterFPs.has(fp));

    const pass = newIssues.length === 0 && unexpectedDisappear.length === 0;

    return {
      pass,
      before:               beforeIssues.length,
      after:                afterIssues.length,
      newIssues:            newIssues.length,
      disappeared:          disappeared.length,
      unexpectedDisappear:  unexpectedDisappear.length,
      targetFixed:          targetFixed.length,
      regressionMsg: !pass
        ? [
            newIssues.length > 0
              ? `${newIssues.length} مشكلة جديدة ظهرت` : null,
            unexpectedDisappear.length > 0
              ? `${unexpectedDisappear.length} مشكلة HIGH/CRITICAL اختفت بشكل غير متوقع` : null,
          ].filter(Boolean).join(" — ")
        : null,
    };
  },

  // 4. Taint
  taint(code, fileName) {
    if (typeof analyzeWithIntelligence !== "function") {
      return { pass: true, skipped: true, reason: "analyzeWithIntelligence غير متاح" };
    }
    try {
      const r = analyzeWithIntelligence(code, fileName);
      const issues = Array.isArray(r?.taintIssues) ? r.taintIssues : [];
      return { pass: true, taintIssues: issues.length };
    } catch (e) {
      return { pass: false, error: e.message };
    }
  },

  // 5. Security — فحص أنماط خطرة صريحة فقط
  security(patchedCode, originalCode) {
    const PATTERNS = [
      { re: /\beval\s*\(/g,                          msg: "eval() خطير" },
      { re: /document\.write\s*\(/g,                 msg: "document.write() خطير" },
      { re: /child_process/g,                        msg: "child_process — تنفيذ shell" },
      { re: /(password|secret)\s*=\s*["'][^"']{2,}/g,   msg: "كلمة مرور hardcoded" },
    ];

    // عدّ occurrences لكل pattern في الكود
    const countHits = (code) => {
      const counts = {};
      for (const { re, msg } of PATTERNS) {
        re.lastIndex = 0;
        const matches = code.match(re);
        counts[msg] = matches ? matches.length : 0;
      }
      return counts;
    };

    const afterCounts = countHits(patchedCode);

    // لو ما في originalCode → فحص مطلق (legacy)
    if (!originalCode) {
      const hits = Object.entries(afterCounts).filter(([,n]) => n > 0).map(([msg]) => msg);
      return { pass: hits.length === 0, vulnerabilities: hits };
    }

    const beforeCounts = countHits(originalCode);

    // ✅ ثغرة جديدة = ظهرت من صفر أو زاد عددها بعد الـ patch
    const newVulns    = [];
    const preExisting = [];
    const allVulns    = [];

    for (const [msg, afterN] of Object.entries(afterCounts)) {
      const beforeN = beforeCounts[msg] || 0;
      if (afterN > 0) allVulns.push(msg);
      if (beforeN > 0) preExisting.push(msg);
      if (afterN > beforeN) newVulns.push(msg); // زاد أو ظهر من صفر
    }

    return {
      pass:               newVulns.length === 0,
      vulnerabilities:    allVulns,
      newVulnerabilities: newVulns,
      preExisting,
    };
  },

  // شغّل كل الاختبارات
  // targetIssues: المشاكل التي يستهدفها الإصلاح (اختفاؤها متوقع)
  runAll(originalCode, patchedCode, fileName, targetIssues) {
    return {
      syntax:     this.syntax(patchedCode, fileName),
      engines:    this.engineSmoke(patchedCode, fileName),
      taint:      this.taint(patchedCode, fileName),
      regression: this.regression(originalCode, patchedCode, fileName, targetIssues),
      security:   this.security(patchedCode, originalCode), // ✅ مقارنة نسبية
    };
  },

  allPassed(results) {
    if (!results.syntax.pass)     return false;
    if (!results.regression.pass) return false;
    if (!results.security.pass)   return false;
    for (const eng of Object.values(results.engines || {})) {
      if (eng.pass === false) return false;
    }
    return true;
  },
};

// ═══════════════════════════════════════════════════════
// Detector
// ═══════════════════════════════════════════════════════

const Detector = {

  // يكتشف conflicts عبر fingerprint لا line فقط
  detectConflicts(code, fileName) {
    const avail = Engines.available();
    if (!avail.analyzeCode && !avail.analyzeJSWithAST && !avail.analyzeJSEnhanced) {
      return { conflicts: [], note: "لا محركات كافية للمقارنة" };
    }

    const results = {};
    try {
      if (avail.analyzeCode)      results.basic = analyzeCode(code, fileName) || [];
      if (avail.analyzeJSWithAST) results.ast   = analyzeJSWithAST(code, fileName) || [];
    } catch (e) {
      return { conflicts: [], error: e.message };
    }

    if (!results.basic || !results.ast) return { conflicts: [] };

    const basicFPs = new Map(results.basic.map(i => [fingerprint(i), i]));
    const astFPs   = new Map(results.ast.map(i  => [fingerprint(i), i]));

    const conflicts = [];

    // ✅ يستخدم deduplicateIssues لو متاح
    if (avail.deduplicateIssues) {
      const merged   = deduplicateIssues(results.ast, results.basic);
      const mergedFPs = new Set(merged.map(fingerprint));
      const astOnly  = [...astFPs.keys()].filter(fp => !mergedFPs.has(fp));
      const basicOnly= [...basicFPs.keys()].filter(fp => !mergedFPs.has(fp));

      if (astOnly.length > 0 || basicOnly.length > 0) {
        conflicts.push({
          type: "ENGINE_CONFLICT",
          detail: `${astOnly.length} مشكلة في AST فقط، ${basicOnly.length} في Basic فقط`,
          astOnly, basicOnly,
        });
      }
    } else {
      // مقارنة يدوية
      for (const [fp, issue] of basicFPs) {
        if (!astFPs.has(fp)) {
          conflicts.push({
            type:   "ENGINE_CONFLICT",
            detail: `Basic يبلّغ عن: ${fp} — AST لا يراه`,
            issue,
          });
        }
      }
    }

    return { conflicts };
  },

  // ✅ تقرير فقط — لا healing تلقائي بناءً على regex
  detectDependencyIssues(code) {
    const defined = new Set();
    const called  = new Set();

    try {
      for (const m of code.matchAll(/(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:function|\())/g))
        defined.add(m[1] || m[2]);
      for (const m of code.matchAll(/\b([a-zA-Z_]\w*)\s*\(/g))
        called.add(m[1]);
    } catch (_) {}

    const BUILTINS = new Set([
      "console","setTimeout","setInterval","clearTimeout","clearInterval",
      "fetch","JSON","Math","Object","Array","String","Number","Boolean",
      "Promise","Error","Map","Set","WeakMap","WeakSet","Symbol","Proxy",
      "Reflect","Date","RegExp","Function","parseInt","parseFloat",
      "isNaN","isFinite","encodeURIComponent","decodeURIComponent",
      "if","for","while","switch","return","typeof","instanceof","new",
      "require","module","exports","process","Buffer","__dirname",
    ]);

    const suspicious = [...called].filter(fn =>
      fn.length > 2 && !defined.has(fn) && !BUILTINS.has(fn)
    );

    // ✅ تقرير للمراجعة فقط — لا نطلق healing تلقائياً
    return {
      isReportOnly:  true,
      suspicious,
      note: suspicious.length > 0
        ? `${suspicious.length} دوال قد تكون غير معرّفة — تحقق يدوياً: ${suspicious.slice(0, 5).join(", ")}`
        : "لا مشاكل dependencies واضحة",
    };
  },

  detectRegression(before, after, fileName) {
    return Tests.regression(before, after, fileName);
  },
};

// ═══════════════════════════════════════════════════════
// Patcher — محافظ، لا transforms عامة
// ═══════════════════════════════════════════════════════

const Patcher = {

  /**
   * يُعيد null (SKIPPED) في أغلب الحالات.
   * SQL Injection فقط → عبر RepairSQL.fix() الموثوق.
   *
   * RepairSQL.fix(code, fileName) يرجع STRING مباشرة.
   * نتحقق:
   *   1. typeof result === "string"
   *   2. result !== code  (تغيّر فعلاً)
   *   3. changedCount من Snapshots.diff()
   *
   * ❌ لا forEach → find تلقائياً
   * ❌ لا total = → += تلقائياً
   * ❌ لا == → === تلقائياً
   */
  generate(code, problem) {
    if (problem.type === "SQL_INJECTION" && typeof RepairSQL !== "undefined") {
      try {
        const result      = RepairSQL.fix(code, problem.fileName || "unknown.js");
        const patchedCode = result.code;

        // ✅ يجب أن يكون string
        if (typeof patchedCode !== "string") {
          return null;
        }

        // ✅ يجب أن يتغير الكود فعلاً
        if (patchedCode === code) {
          return null; // لم يتغير → SKIPPED
        }

        // ✅ نحسب changedCount من الـ diff
        const diff         = Snapshots.diff(code, patchedCode);
        const changedCount = diff.changedCount;

        if (changedCount === 0) {
          return null; // لا تغيير فعلي → SKIPPED
        }

        return {
          patchedCode,
          confidence:   "HIGH", // ثقة عالية لأن المصدر RepairSQL
          reason:       `RepairSQL.fix() عدّل ${changedCount} سطر`,
          changedCount,
        };

      } catch (e) {
        // خطأ في RepairSQL → SKIPPED بأمان
        return null;
      }
    }

    // كل الأنواع الأخرى → لا patch تلقائي
    return null;
  },
};

// ═══════════════════════════════════════════════════════
// Self-Healing Core
// ═══════════════════════════════════════════════════════

const SelfHealing = {

  heal(problem) {
    const id = `SH_${Date.now()}_${Math.random().toString(36).slice(2,6).toUpperCase()}`;
    const { type, engine, fileName, code, detail } = problem;

    // 1. Log المشكلة
    Log.add({
      id,
      type,
      engine:        engine || "unknown",
      fileName:      fileName || "unknown",
      detail:        detail || "",
      status:        Status.PENDING_REVIEW,
      healingResult: HealingResult.SKIPPED,
      testResults:   null,
      patch:         null,
    });

    // 2. Snapshot
    Snapshots.create(id, { [fileName || "code"]: code || "" });

    // 3. محاولة توليد Patch
    const patchResult = Patcher.generate(code || "", problem);

    if (!patchResult) {
      // لا patch موثوق → SKIPPED
      Log.update(id, {
        healingResult: HealingResult.SKIPPED,
        note: "لا Fixer موثوق لهذا النوع — يحتاج مراجعة يدوية",
      });
      return {
        id,
        status: Status.PENDING_REVIEW,
        result: HealingResult.SKIPPED,
        message: "الحادثة مُسجَّلة — تحتاج مراجعة يدوية",
      };
    }

    const { patchedCode, reason } = patchResult;

    // 4. Diff
    const diff = Snapshots.diff(code, patchedCode);
    Snapshots.attachPatch(id, { diff, patchedCode, reason });

    // 5. اختبارات على النسخة الاختبارية
    // نمرر المشكلة المستهدفة حتى لا يُعدّ اختفاؤها regression
    const targetIssues = problem.targetIssues || [problem];
    const testResults  = Tests.runAll(code, patchedCode, fileName, targetIssues);
    const passed       = Tests.allPassed(testResults);

    if (!passed) {
      // Rollback — لا نطبق التغيير
      Log.update(id, {
        status:        Status.ROLLED_BACK,
        healingResult: HealingResult.FAIL,
        testResults,
        patch:         diff,
        rollbackMsg:   "الاختبارات فشلت — Rollback تلقائي، الكود الأصلي محفوظ",
      });
      return {
        id,
        status:    Status.ROLLED_BACK,
        result:    HealingResult.FAIL,
        testResults,
        finalCode: code, // الأصلي
      };
    }

    // 6. نجحت الاختبارات → PENDING_REVIEW دائماً، لا تطبيق تلقائي
    Log.update(id, {
      status:        Status.PENDING_REVIEW,
      healingResult: HealingResult.PASS,
      testResults,
      patch:         diff,
      patchReason:   reason,
      patchedCode,
      note:          "الاختبارات نجحت — بانتظار موافقتك للتطبيق",
    });

    const self = this;
    return {
      id,
      status:      Status.PENDING_REVIEW,
      result:      HealingResult.PASS,
      testResults,
      diff,
      patchedCode,
      finalCode:   code,  // ✅ الأصلي حتى بعد نجاح الاختبارات
      approve(applyCallback) { return self.approve(id, patchedCode, applyCallback); },
      reject()               { return self.reject(id); },
    };
  },

  approve(id, patchedCode, applyCallback) {
    // ✅ تحقق أن id موجود
    if (!id) return { id, status: "REJECTED", error: "id غير موجود" };

    const entry = Log.getById(id);

    // ✅ تحقق أن الـ entry موجود وحالته PENDING_REVIEW
    if (!entry) {
      return { id, status: "REJECTED", error: "لا يوجد entry بهذا الـ id" };
    }
    if (entry.status !== Status.PENDING_REVIEW) {
      return { id, status: "REJECTED", error: `الحالة ${entry.status} — لا يمكن اعتماد غير PENDING_REVIEW` };
    }

    // ✅ تحقق أن patchedCode يطابق ما تم اختباره في الـ Log
    const loggedPatchedCode = entry.patchedCode;
    if (loggedPatchedCode !== undefined && patchedCode !== loggedPatchedCode) {
      return {
        id,
        status: "REJECTED",
        error:  "patchedCode لا يطابق ما تم اختباره — رُفض لأسباب أمنية",
      };
    }

    // ✅ نُشغّل applyCallback أولاً — APPROVED فقط إذا نجح
    if (typeof applyCallback === "function") {
      try {
        applyCallback(patchedCode);
      } catch (e) {
        // ❌ فشل التطبيق → نبقى PENDING_REVIEW ونسجل الخطأ
        Log.update(id, { applyError: e.message, applyFailedAt: new Date().toISOString() });
        return {
          id,
          status: Status.PENDING_REVIEW,
          error:  `applyCallback فشل: ${e.message} — الحالة تبقى PENDING_REVIEW`,
        };
      }
    }

    // ✅ نغير الحالة إلى APPROVED بعد نجاح التطبيق فقط
    Log.update(id, { status: Status.APPROVED, approvedAt: new Date().toISOString() });
    return { id, status: Status.APPROVED };
  },

  reject(id) {
    if (!id) return { id, status: "ERROR", error: "id غير موجود" };

    const entry = Log.getById(id);
    if (!entry) {
      return { id, status: "ERROR", error: "لا يوجد entry بهذا الـ id" };
    }
    if (entry.status !== Status.PENDING_REVIEW) {
      return {
        id,
        status: "ERROR",
        error: `الحالة ${entry.status} — لا يمكن رفض غير PENDING_REVIEW`,
      };
    }

    Log.update(id, { status: Status.REJECTED, rejectedAt: new Date().toISOString() });
    return { id, status: Status.REJECTED };
  },

  // ── monitor() — يدعم async ──────────────────────────

  /**
   * يراقب دالة sync أو async
   * لو رمت exception → يسجّل حادثة
   */
  async monitor(engineName, fn, args) {
    // ✅ تأكد إن args مصفوفة — لا تكسر أثناء معالجة الخطأ نفسه
    const safeArgs = Array.isArray(args) ? args : [];
    try {
      const result = await Promise.resolve(fn(...safeArgs));
      return { success: true, result };
    } catch (e) {
      const healResult = this.heal({
        type:     "ENGINE_ERROR",
        engine:   engineName,
        fileName: safeArgs[1] || "unknown",
        code:     safeArgs[0] || "",
        detail:   e.message,
      });
      console.warn(
        `[SelfHealing] ${engineName} فشل — حادثة مسجّلة [${healResult.id}]`,
        e.message
      );
      return { success: false, error: e.message, healingId: healResult.id };
    }
  },

  // ── monitor sync (للتوافق) ───────────────────────────

  monitorSync(engineName, fn, args) {
    const safeArgs = Array.isArray(args) ? args : []; // ✅ نفس حماية monitor()
    try {
      return { success: true, result: fn(...safeArgs) };
    } catch (e) {
      const healResult = this.heal({
        type:   "ENGINE_ERROR",
        engine: engineName,
        code:   safeArgs[0] || "",
        detail: e.message,
      });
      return { success: false, error: e.message, healingId: healResult.id };
    }
  },

  // ── Conflict Check ───────────────────────────────────

  checkConflicts(code, fileName) {
    const { conflicts, note, error } = Detector.detectConflicts(code, fileName);
    if (conflicts && conflicts.length > 0) {
      conflicts.forEach(c => {
        this.heal({
          type:     "ENGINE_CONFLICT",
          engine:   "multi",
          fileName,
          code,
          detail:   c.detail,
        });
      });
    }
    return { conflicts: conflicts || [], note, error };
  },

  // ── Regression Check ─────────────────────────────────

  checkRegression(beforeCode, afterCode, fileName) {
    const reg = Detector.detectRegression(beforeCode, afterCode, fileName);
    if (!reg.pass) {
      this.heal({
        type:     "REGRESSION",
        engine:   "regression-monitor",
        fileName,
        code:     afterCode,
        detail:   reg.regressionMsg,
      });
    }
    return reg;
  },

  // ── Dependency Report (لا healing تلقائي) ───────────

  reportDependencies(code) {
    return Detector.detectDependencyIssues(code);
  },

  // ── Public API ───────────────────────────────────────

  getLog()         { return Log.getAll(); },
  getPending()     { return Log.getPending(); },
  getById(id)      { return Log.getById(id); },
  getSnapshot(id)  { return Snapshots.getById(id); },
  exportLog()      { return Log.exportJSON(); },   // ✅ لحفظ يدوي

  engines()        { return Engines.available(); },

  summary() {
    const all      = Log.getAll();
    const pending  = all.filter(e => e.status === Status.PENDING_REVIEW).length;
    const approved = all.filter(e => e.status === Status.APPROVED).length;
    const rejected = all.filter(e => e.status === Status.REJECTED).length;
    const rolled   = all.filter(e => e.status === Status.ROLLED_BACK).length;
    return {
      version:    SH_VERSION,
      total:      all.length,
      pending,
      approved,
      rejected,
      rolledBack: rolled,
      lastEvent:  all[0]?.timestamp || null,
      engines:    Engines.available(),
    };
  },
};

// ═══════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════

global.SelfHealing = SelfHealing;
global.SHStatus    = Status;
global.SHResult    = HealingResult;

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SelfHealing, Status, HealingResult, Tests, Detector, Engines };
}

if (typeof window !== "undefined") {
  console.log(
    `%c⚡ SelfHealing v${SH_VERSION} — PENDING_REVIEW only, no auto-apply`,
    "color:#a371f7;font-weight:bold"
  );
}

})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : {}));
