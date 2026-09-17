// ═══════════════════════════════════════════════════════
// ghost_mode.js v2.3 — مولّد ومختبِر candidates (ليس حَكَمًا نهائيًا)
//
// الدور في المعمارية:
//
//   RealityOrchestrator          ← المدير الوحيد
//          ↓
//   GhostMode (هذا الملف)        ← يولّد/يختبر candidates بشكل محافظ
//          ↓
//   candidate patch
//          ↓
//   FixVerifier                  ← بوابة التحقق النهائية الوحيدة
//          ↓
//   ACCEPT / REJECT
//          ↓
//   RealityOrchestrator يقرر Apply / Fallback / Claude / Learning
//
// ═══ تغييرات v2.2 (معمارية فقط — لا منطق فحص جديد) ═══
//   [1] FixVerifier صار المرجع النهائي لقبول أي candidate. الفحوص المحلية
//       (structuralCheck / syntaxOk / hasRegression / calcScore / targetGone)
//       بقيت كما هي لكنها صارت **cheap prechecks** توفّر وقتًا وتمنع مرشّحًا
//       فاسدًا من استهلاك دورة تحقق — لا حكمًا أمنيًا نهائيًا.
//   [2] PARTIAL لم يعد يخرج ككود مقبول. كان:
//           if (v.verdict === VERDICT.PARTIAL) return { code: fixedCode, … }
//       أي أن إصلاحًا ناقصًا كان يُسلَّم كما لو كان مكتملًا. الآن PARTIAL
//       مرشّح فقط، ولا يخرج إلا إذا قبلته البوابة.
//   [3] أُزيل الربط المباشر بـLearningEngine من قرار GhostMode:
//       لا LearningEngine.verify() ولا اعتماد على applyLearned كقرار.
//       LearnedFixer/LearningEngine يبقى **مصدر candidate** فقط، وقرار
//       تسجيل نجاح pattern صار خارج هذا الملف تحت الـOrchestrator/Pipeline.
//   [4] HTMLRepair بقي كمولّد candidate، وناتجه يمر بنفس البوابة.
//   [5] selfFix() ناتجه candidate فقط — لا يكتب ولا يطبّق شيئًا.
//   [6] applyToAll() صار wrapper رفيع لا يتجاوز البوابة.
//   [7] Fail-Closed: بلا FixVerifier لا يُقبل ولا يُطبَّق أي candidate،
//       والنتيجة 'verification_unavailable' — غياب المدقّق ليس نجاحًا.
//
// ═══ تغييرات v2.3 (نقطتان فقط — لا تغيير في verdict() أو الـfixers) ═══
//   [A] FixVerifier يُحَلّ وقت الاستخدام (_getFixVerifier) بدل التقاطه مرة
//       واحدة عند التحميل. ترتيب تحميل يضع ghost_mode.js قبل
//       fix_verifier.js كان يعطّل fix() بصمت.
//   [B] أُزيل استدعاء LearningEngine.applyLearned — كان يجعل GhostMode
//       مصدرًا ثانيًا للمرشّح المتعلَّم بموازاة مسار fix_engine_pipeline.
//       GhostMode الآن يختبر ما يُمرَّر إليه فقط.
//
// ⚠️ GhostMode ليس نسخة ثانية من FixVerifier: لا يملك قرار قبول خاصًا به.
//
// الواجهة العامة (بلا تغيير):
//   GhostMode.fix / verdict / structuralCheck / selfFix / applyToAll / VERDICT
//   window.GhostMode / module.exports كما كانا.
// ═══════════════════════════════════════════════════════
"use strict";

var GhostMode = (() => {

  const VERSION = '2.3';

  const VERDICT = {
    PASS:       'pass',
    PARTIAL:    'partial',
    REGRESSION: 'regression',
    FAIL:       'fail',
  };

  // ─── 0. ربط بوابة التحقق الوحيدة (fix_verifier.js) ──
  // لا يُعدَّل fix_verifier.js — يُستهلك فقط عبر واجهته العامة.
  // [v2.3] Lazy Resolver — يبحث عن FixVerifier **وقت الاستخدام** لا وقت التحميل.
  //
  // كان: var _FV = (typeof FixVerifier !== 'undefined') ? FixVerifier : null;
  // يُنفَّذ مرة واحدة عند تحميل الملف. فإذا حُمِّل ghost_mode.js قبل
  // fix_verifier.js يبقى _FV = null إلى الأبد، وتُرجع fix() دائمًا
  // 'verification_unavailable' — تعطّل صامت لا يظهر كخطأ.
  //
  // الآن البحث يتكرر عند كل استدعاء. الفشل لا يُخزَّن إطلاقًا، فوصول
  // FixVerifier متأخرًا يُلتقط في أول استدعاء بعده.
  var _FV = null;

  function _getFixVerifier() {
    // مخزَّن ومصدَّق: لا نعيد البحث بلا داعٍ
    if (_FV && typeof _FV.verifyFix === 'function') return _FV;
    _FV = null;                       // لا نخزّن فشلاً

    // 1) متغير عام في نفس النطاق (ترتيب سكربتات المتصفح)
    if (typeof FixVerifier !== 'undefined' && FixVerifier
        && typeof FixVerifier.verifyFix === 'function') {
      _FV = FixVerifier;
      return _FV;
    }
    // 2) globalThis (window.FixVerifier أو بيئة أخرى)
    if (typeof globalThis !== 'undefined' && globalThis.FixVerifier
        && typeof globalThis.FixVerifier.verifyFix === 'function') {
      _FV = globalThis.FixVerifier;
      return _FV;
    }
    // 3) CommonJS
    if (typeof require === 'function') {
      try {
        const m = require('./fix_verifier.js');
        if (m && typeof m.verifyFix === 'function') { _FV = m; return _FV; }
      } catch (e) { /* غير متاح الآن — Fail-Closed لدى المستدعي */ }
    }
    return null;                      // قد يتوفر في استدعاء لاحق
  }

  function _gateAvailable() {
    return !!_getFixVerifier();
  }

  /**
   * القرار النهائي لأي candidate. لا يوجد مسار قبول آخر في هذا الملف.
   * @returns {{accepted:boolean, reason:string, afterIssues:Array|null}}
   */
  function _gateVerify(original, candidate, fileName, analyzeFunc) {
    if (!_gateAvailable()) {
      return { accepted: false, reason: 'verification_unavailable', afterIssues: null };
    }
    const fv = _getFixVerifier();
    if (!fv) {
      return { accepted: false, reason: 'verification_unavailable', afterIssues: null };
    }
    try {
      const v = fv.verifyFix(original, candidate, fileName, analyzeFunc || null, {});
      if (!v || v.accepted !== true) {
        return { accepted: false, reason: (v && v.reason) || 'gate_rejected', afterIssues: null };
      }
      return { accepted: true, reason: v.reason || 'accepted', afterIssues: v.afterIssues || null };
    } catch (e) {
      return { accepted: false, reason: 'verifier_threw: ' + (e && e.message), afterIssues: null };
    }
  }

  // ─── 1. Structural Check ────────────────────────────
  // ⚠️ [v2.2] precheck رخيص — ليس الحكم النهائي.
  // تحقق بنيوي (الفحص النحوي منفصل في syntaxOk أدناه)
  function structuralCheck(original, fixed) {
    if (!fixed || !fixed.trim()) return false;
    if (fixed.trim().length < original.trim().length * 0.25) return false;
    const origLines  = original.split('\n').length;
    const fixedLines = fixed.split('\n').length;
    if (fixedLines < origLines * 0.2) return false;

    // رفض comment-only fixes
    const origSet2  = new Set(original.split('\n').map(l => l.trim()));
    const newLines2 = fixed.split('\n').map(l => l.trim()).filter(l => l && !origSet2.has(l));
    if (newLines2.length > 0 && newLines2.every(l => l.startsWith('//') || l.startsWith('#') || l.startsWith('/*'))) return false;

    return true;
  }

  // ─── 1b. Syntax Check ───────────────────────────────
  // ⚠️ [v2.2] precheck رخيص — FixVerifier يملك فحصه التركيبي الخاص وهو الحكم.
  // إصلاح لا يُحلَّل ليس إصلاحاً مهما تحسّنت أرقام التحليل. نفس قواعد
  // learnedSyntaxOk المعتمدة في fix_engine_pipeline: JS النقي فقط
  // (acorn لا يدعم TS/JSX)، ولا حكم إذا كان الأصل نفسه لا يُحلَّل أو
  // كان acorn غير متاح — فلا يُرفض إصلاح صحيح لسبب خارج عنه.
  function parsesAsJS(src) {
    for (const sourceType of ['module', 'script']) {
      try { acorn.parse(src, { ecmaVersion: 'latest', sourceType }); return true; }
      catch(e) {}
    }
    return false;
  }

  function syntaxOk(original, fixed, fileName) {
    if (!/\.(js|mjs|cjs)$/i.test(fileName || '')) return true;
    if (typeof acorn === 'undefined' || typeof acorn.parse !== 'function') return true;
    if (!parsesAsJS(original)) return true;
    return parsesAsJS(fixed);
  }

  // ─── 2. Re-Analyze ──────────────────────────────────
  function reAnalyze(code, fileName, analyzeFunc) {
    if (!analyzeFunc) return { ok: true, critical: 0, high: 0, total: 0, issues: [] };
    try {
      const issues = analyzeFunc(code, fileName) || [];
      return {
        ok:       true,
        critical: issues.filter(i => i.sev === 'c').length,
        high:     issues.filter(i => i.sev === 'h').length,
        total:    issues.length,
        issues,
      };
    } catch(e) {
      return { ok: false, critical: 0, high: 0, total: 0, issues: [], error: e.message };
    }
  }

  // ─── 3. Regression Check ────────────────────────────
  // ⚠️ [v2.2] precheck فقط. FixVerifier يقارن بهوية مشاكل مستقرة وبالعدّ
  // لكل هوية، وهو أدق: المقارنة هنا بالنوع تُخفي "أُصلحت واحدة وكُسرت أخرى"
  // من النوع نفسه لأن العدد يبقى ثابتًا.
  function hasRegression(origAnalysis, fixedAnalysis) {
    const origCritical  = origAnalysis.critical + origAnalysis.high;
    const fixedCritical = fixedAnalysis.critical + fixedAnalysis.high;
    if (fixedCritical > origCritical) return true;
    const origTypes = new Set(origAnalysis.issues.map(i => i.cAct || i.type || ''));
    // نوع جديد يُعتبر انحداراً فقط إذا كان حرجاً أو عالياً — وهو ما يقوله
    // سبب الحكم نفسه (new_critical_issues). ملاحظة إرشادية جديدة (sev='l'/'m')
    // يضيفها الإصلاح لا يجوز أن تُلغي إصلاحاً أزال ثغرات حرجة.
    return fixedAnalysis.issues.some(i =>
      (i.sev === 'c' || i.sev === 'h') && !origTypes.has(i.cAct || i.type || ''));
  }

  // ─── 4. Target Verification ─────────────────────────
  // ⚠️ [v2.2] precheck/تقرير فقط.
  function targetGone(origAnalysis, fixedAnalysis, targetTypes) {
    if (!targetTypes || !targetTypes.length) return true;
    const origTypes  = new Set(origAnalysis.issues.map(i => i.cAct || i.type || ''));
    const fixedTypes = new Set(fixedAnalysis.issues.map(i => i.cAct || i.type || ''));
    // تحقق فقط من الأنواع اللي كانت موجودة أصلاً
    return targetTypes
      .filter(t => origTypes.has(t))
      .every(t => !fixedTypes.has(t));
  }

  // ─── 5. Smart Score ─────────────────────────────────
  // ⚠️ [v2.2] إشارة ترتيب للمرشّحات فقط — لا تمنح قبولًا.
  // يعطي وزن أعلى للثغرة المستهدفة
  function calcScore(origAnalysis, fixedAnalysis, targetTypes) {
    let score = 0;

    const gone = targetTypes && targetTypes.length
      ? targetGone(origAnalysis, fixedAnalysis, targetTypes)
      : fixedAnalysis.total < origAnalysis.total;

    // Target Fix: +55 لو اختفت الثغرة المستهدفة
    if (gone) score += 55;

    // Critical reduction: +20
    const critDiff = origAnalysis.critical - fixedAnalysis.critical;
    if (critDiff > 0) score += Math.min(20, critDiff * 10);

    // High reduction: +15
    const highDiff = origAnalysis.high - fixedAnalysis.high;
    if (highDiff > 0) score += Math.min(15, highDiff * 8);

    // No new issues: +10
    if (!hasRegression(origAnalysis, fixedAnalysis)) score += 10;

    // Total issues down: +5
    if (fixedAnalysis.total < origAnalysis.total) score += 5;

    return Math.min(100, score);
  }

  // ─── 6. Full Verdict ────────────────────────────────
  // ⚠️ [v2.2] verdict() تقييم محلي (precheck) — لا يمنح قبولًا نهائيًا.
  // يبقى بنفس التوقيع والشكل للتوافق مع المستهلكين الحاليين
  // (fix_engine_pipeline يستدعيه مباشرة ويقرأ .verdict).
  function verdict(original, fixed, fileName, analyzeFunc, targetIssueTypes) {
    // نفس الكود = لا تحسن
    if (original.trim() === fixed.trim()) {
      return { verdict: VERDICT.FAIL, score: 0, reason: 'no_change' };
    }

    // Structural Check
    if (!structuralCheck(original, fixed)) {
      return { verdict: VERDICT.FAIL, score: 0, reason: 'structural_invalid' };
    }

    // Syntax Check — كود لا يُحلَّل لا يُسلَّم ولا يُتعلَّم منه
    if (!syntaxOk(original, fixed, fileName)) {
      return { verdict: VERDICT.FAIL, score: 0, reason: 'syntax_broken' };
    }

    // Re-analyze
    const origAnalysis  = reAnalyze(original, fileName, analyzeFunc);
    const fixedAnalysis = reAnalyze(fixed, fileName, analyzeFunc);

    // Analysis failed?
    if (!origAnalysis.ok || !fixedAnalysis.ok) {
      return { verdict: VERDICT.FAIL, score: 0, reason: 'analysis_failed' };
    }

    // Regression?
    if (hasRegression(origAnalysis, fixedAnalysis)) {
      return {
        verdict: VERDICT.REGRESSION,
        score:   0,
        reason:  'new_critical_issues',
      };
    }

    const s     = calcScore(origAnalysis, fixedAnalysis, targetIssueTypes);
    const gone  = targetGone(origAnalysis, fixedAnalysis, targetIssueTypes);
    const noFix = fixedAnalysis.critical === origAnalysis.critical &&
                  fixedAnalysis.high     === origAnalysis.high;

    if (s >= 75 && gone) {
      return { verdict: VERDICT.PASS,    score: s, reason: 'all_fixed' };
    } else if (s >= 15 && !noFix) {
      return { verdict: VERDICT.PARTIAL, score: s, reason: 'partial_fix', targetGone: gone };
    } else {
      return { verdict: VERDICT.FAIL,    score: s, reason: 'no_improvement' };
    }
  }

  // ─── Main Fix ───────────────────────────────────────
  // [v2.2] القاعدة: لا يخرج كود إلا إذا قبلته FixVerifier.
  // verdict المحلي يحدد أي المرشّحات تستحق عرضها على البوابة، لا أكثر.
  function fix(originalCode, fixedCode, fileName, analyzeFunc, meta) {
    meta = meta || {};
    const targetTypes = meta.targetTypes || [];

    // Fail-Closed: بلا بوابة لا قبول ولا تطبيق.
    if (!_gateAvailable()) {
      return {
        code: originalCode, verdict: VERDICT.FAIL, score: 0, ghost: true,
        reason: 'verification_unavailable', gateVerified: false,
      };
    }

    const v = verdict(originalCode, fixedCode, fileName, analyzeFunc, targetTypes);

    // ⚠️ [v2.2] لم يعد هنا أي LearningEngine.verify(). تسجيل نجاح/فشل
    // pattern قرار يخص الـOrchestrator/Pipeline، لا GhostMode.
    // meta.patternId يبقى مقبولًا في المدخلات للتوافق ويُعاد كما هو.

    // المرشّح الأساسي: يُعرض على البوابة إذا لم يسقط في precheck.
    // ملاحظة: PARTIAL لم يعد يخرج مباشرة — صار مرشّحًا كغيره.
    const candidates = [];
    if (v.verdict === VERDICT.PASS || v.verdict === VERDICT.PARTIAL) {
      candidates.push({ code: fixedCode, method: 'primary', score: v.score, localVerdict: v.verdict });
    }

    // HTMLRepair — مولّد candidate فقط، ناتجه يمر بالبوابة كغيره.
    if (/\.html?$/i.test(fileName) && typeof HTMLRepair !== 'undefined') {
      try {
        const hr = HTMLRepair.fix(originalCode, fileName);
        if (hr && hr.changed) {
          const cv = verdict(originalCode, hr.fixed, fileName, analyzeFunc, targetTypes);
          if (cv.verdict === VERDICT.PASS || cv.verdict === VERDICT.PARTIAL) {
            candidates.push({ code: hr.fixed, method: 'html', score: cv.score, localVerdict: cv.verdict });
          }
        }
      } catch(e) {}
    }

    // [v2.3] أُزيل استدعاء LearningEngine.applyLearned من هنا نهائيًا.
    //
    // السبب: GhostMode كان يسحب candidate من محرك التعلّم بنفسه، فيصير
    // مصدرًا ثانيًا لنفس المرشّح — fix_engine_pipeline.js يملك مساره
    // الخاص لـapplyLearned (Ghost verdict ← فحص نحوي ← البوابة). وجود
    // المسارين يعني أن نفس المرشّح يُولَّد ويُقيَّم مرتين بطريقتين مختلفتين،
    // وأن GhostMode يتصرف كمنسّق لا كمختبِر.
    //
    // لا تُفقد أي قدرة: مسار الـpipeline يبقى كما هو ويمر بالبوابة نفسها.
    // من أراد مرشّحًا متعلَّمًا يمرره إلى fix() كـfixedCode، أو يستدعي
    // LearnedFixer/LearningEngine من الطبقة الأعلى (RealityOrchestrator).

    // الترتيب بالـscore إشارة تفضيل فقط — البوابة هي من تقبل.
    candidates.sort((a, b) => b.score - a.score);

    const rejected = [];
    for (const c of candidates) {
      // كل candidate يُقاس ضد الكود **الأصلي** — لا تراكم بين المرشّحات.
      const g = _gateVerify(originalCode, c.code, fileName, analyzeFunc);
      if (g.accepted) {
        return {
          code: c.code,
          verdict: VERDICT.PASS,          // مقبول من البوابة
          score: c.score,
          ghost: c.method !== 'primary',
          method: c.method,
          gateVerified: true,
          gateReason: g.reason,
          localVerdict: c.localVerdict,   // تقييم GhostMode المحلي قبل البوابة
          afterIssues: g.afterIssues,
          patternId: meta.patternId,      // يُعاد كما هو — القرار للطبقة الأعلى
        };
      }
      rejected.push({ method: c.method, reason: g.reason });
    }

    // لا candidate اجتاز البوابة → الكود الأصلي كما هو.
    return {
      code: originalCode,
      verdict: VERDICT.FAIL,
      score: 0,
      ghost: true,
      reason: candidates.length ? 'no_candidate_passed_gate' : 'no_candidate',
      gateVerified: false,
      rejectedCandidates: rejected,
      localVerdict: v.verdict,
      patternId: meta.patternId,
    };
  }

  // ─── Self Fix ───────────────────────────────────────
  // [v2.2] ناتجه candidate فقط — لا يكتب ولا يطبّق. على المستدعي تمريره
  // عبر fix() أو FixVerifier قبل اعتماده.
  function selfFix(code) {
    let f = code;
    f = f.replace(/process\.env\.process\.env\.(\w+)/g, 'process.env.$1');
    f = f.replace(/os\.environ\.get\(os\.environ\.get\(/g, 'os.environ.get(');
    f = f.replace(/(import os\n){2,}/g, 'import os\n');
    f = f.replace(/(import subprocess\n){2,}/g, 'import subprocess\n');
    return f;
  }

  // ─── Batch ──────────────────────────────────────────
  // [v2.2] wrapper رفيع: يمرّ كل ملف عبر fix() — أي عبر البوابة.
  // لا يطبّق شيئًا بنفسه ولا يتجاوز التحقق. عند غياب البوابة يُعاد الكود
  // الأصلي لكل ملف (Fail-Closed) مع تفاصيل في .details.
  function applyToAll(files, analyzeFunc, repairFunc) {
    const results = {};
    // خاصية غير قابلة للعدّ حتى لا تظهر كـ"ملف" لدى مستهلك يمرّ على المفاتيح
    Object.defineProperty(results, 'details', { value: {}, enumerable: false, writable: true });
    Object.defineProperty(results, 'gateAvailable', { value: _gateAvailable(), enumerable: false, writable: true });

    Object.entries(files).forEach(([fn, code]) => {
      try {
        const issues   = analyzeFunc ? analyzeFunc(code, fn) : [];
        const repaired = repairFunc  ? (repairFunc(code, issues, fn).repaired || code) : code;
        const types    = issues.map(i => i.cAct || i.type).filter(Boolean);
        const result   = fix(code, repaired, fn, analyzeFunc, { targetTypes: types });
        results[fn]    = result.code;              // الأصلي إن لم تقبل البوابة
        results.details[fn] = {
          verdict: result.verdict,
          gateVerified: !!result.gateVerified,
          reason: result.reason || result.gateReason || null,
        };
      } catch(e) {
        results[fn] = code;
        results.details[fn] = { verdict: VERDICT.FAIL, gateVerified: false, reason: 'exception: ' + (e && e.message) };
      }
    });
    return results;
  }

  return { fix, verdict, structuralCheck, selfFix, applyToAll, VERDICT, VERSION };
})();

if (typeof window !== 'undefined') window.GhostMode = GhostMode;
if (typeof module !== 'undefined') module.exports = GhostMode;
