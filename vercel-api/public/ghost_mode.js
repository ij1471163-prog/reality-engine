// ═══════════════════════════════════════════════════════
// ghost_mode.js v2.1 — حَكَم الإصلاح
// لا يُسلّم إلا PASS — كل شيء ثاني يُرفض أو يُعاد
// ═══════════════════════════════════════════════════════
"use strict";

var GhostMode = (() => {

  const VERDICT = {
    PASS:       'pass',
    PARTIAL:    'partial',
    REGRESSION: 'regression',
    FAIL:       'fail',
  };

  // ─── 1. Structural Check ────────────────────────────
  // تحقق بنيوي (ليس syntax parsing حقيقي — مرحلة قادمة)
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
  function hasRegression(origAnalysis, fixedAnalysis) {
    const origCritical  = origAnalysis.critical + origAnalysis.high;
    const fixedCritical = fixedAnalysis.critical + fixedAnalysis.high;
    if (fixedCritical > origCritical) return true;
    const origTypes = new Set(origAnalysis.issues.map(i => i.cAct || i.type || ''));
    return fixedAnalysis.issues.some(i => !origTypes.has(i.cAct || i.type || ''));
  }

  // ─── 4. Target Verification ─────────────────────────
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
  function verdict(original, fixed, fileName, analyzeFunc, targetIssueTypes) {
    // نفس الكود = لا تحسن
    if (original.trim() === fixed.trim()) {
      return { verdict: VERDICT.FAIL, score: 0, reason: 'no_change' };
    }

    // Structural Check
    if (!structuralCheck(original, fixed)) {
      return { verdict: VERDICT.FAIL, score: 0, reason: 'structural_invalid' };
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
  // القاعدة: فقط PASS يخرج — أي شيء ثاني يُرفض
  function fix(originalCode, fixedCode, fileName, analyzeFunc, meta) {
    meta = meta || {};
    const targetTypes = meta.targetTypes || [];

    const v = verdict(originalCode, fixedCode, fileName, analyzeFunc, targetTypes);

    // ربط LearningEngine — فقط PASS = نجاح
    if (typeof LearningEngine !== 'undefined' && meta.patternId) {
      LearningEngine.verify(meta.patternId, v.verdict === VERDICT.PASS);
    }

    // PASS يُقبل مباشرة
    if (v.verdict === VERDICT.PASS) {
      return { code: fixedCode, verdict: v.verdict, score: v.score, ghost: false };
    }

    // PARTIAL → كود أفضل من الأصلي → نقبله
    if (v.verdict === VERDICT.PARTIAL) {
      return { code: fixedCode, verdict: v.verdict, score: v.score, ghost: false };
    }

    // PARTIAL / REGRESSION / FAIL → جرب candidates
    const candidates = [];

    // HTMLRepair
    if (/\.html?$/i.test(fileName) && typeof HTMLRepair !== 'undefined') {
      try {
        const hr = HTMLRepair.fix(originalCode, fileName);
        if (hr.changed) {
          const cv = verdict(originalCode, hr.fixed, fileName, analyzeFunc, targetTypes);
          candidates.push({ code: hr.fixed, method: 'html', score: cv.score, verdict: cv.verdict });
        }
      } catch(e) {}
    }

    // LearningEngine.applyLearned
    if (typeof LearningEngine !== 'undefined') {
      try {
        const lr = LearningEngine.applyLearned(originalCode, fileName);
        if (lr.applied > 0) {
          const cv = verdict(originalCode, lr.fixed, fileName, analyzeFunc, targetTypes);
          candidates.push({ code: lr.fixed, method: 'learned', score: cv.score, verdict: cv.verdict });
        }
      } catch(e) {}
    }

    // فقط PASS من candidates يُقبل
    const passCandidates = candidates
      .filter(c => c.verdict === VERDICT.PASS)
      .sort((a, b) => b.score - a.score);

    if (passCandidates.length > 0) {
      const best = passCandidates[0];
      if (typeof LearningEngine !== 'undefined' && meta.patternId) {
        LearningEngine.verify(meta.patternId, true);
      }
      return { code: best.code, verdict: VERDICT.PASS, score: best.score, ghost: true, method: best.method };
    }

    // لا PASS متاح → ارجع الأصلي
    if (typeof LearningEngine !== 'undefined' && meta.patternId) {
      LearningEngine.verify(meta.patternId, false);
    }
    return { code: originalCode, verdict: VERDICT.FAIL, score: 0, ghost: true, reason: 'no_pass_found' };
  }

  // ─── Self Fix ───────────────────────────────────────
  function selfFix(code) {
    let f = code;
    f = f.replace(/process\.env\.process\.env\.(\w+)/g, 'process.env.$1');
    f = f.replace(/os\.environ\.get\(os\.environ\.get\(/g, 'os.environ.get(');
    f = f.replace(/(import os\n){2,}/g, 'import os\n');
    f = f.replace(/(import subprocess\n){2,}/g, 'import subprocess\n');
    return f;
  }

  // ─── Batch ──────────────────────────────────────────
  function applyToAll(files, analyzeFunc, repairFunc) {
    const results = {};
    Object.entries(files).forEach(([fn, code]) => {
      try {
        const issues   = analyzeFunc ? analyzeFunc(code, fn) : [];
        const repaired = repairFunc  ? (repairFunc(code, issues, fn).repaired || code) : code;
        const types    = issues.map(i => i.cAct || i.type).filter(Boolean);
        const result   = fix(code, repaired, fn, analyzeFunc, { targetTypes: types });
        results[fn]    = result.code;
      } catch(e) { results[fn] = code; }
    });
    return results;
  }

  return { fix, verdict, structuralCheck, selfFix, applyToAll, VERDICT };
})();

if (typeof window !== 'undefined') window.GhostMode = GhostMode;
if (typeof module !== 'undefined') module.exports = GhostMode;
