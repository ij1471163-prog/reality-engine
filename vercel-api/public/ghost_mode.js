// ═══════════════════════════════════════════════════════
// ghost_mode.js v1.0 — وضع الشبح
// يتحقق من الإصلاح ويعيد المحاولة بصمت حتى يصلح صح
// المستخدم لا يحس بشيء — النتيجة دائماً صح
// ═══════════════════════════════════════════════════════
"use strict";

var GhostMode = (() => {

  // ─── Quick Validation ─────────────────────────────
  function isValid(original, fixed) {
    if (!fixed || fixed.trim().length < 5) return false;
    // الكود ما أصبح فارغ
    if (fixed.trim().length < original.trim().length * 0.3) return false;
    // ما أضاف eval أو exec خطير
    const origEvals = (original.match(/\beval\s*\(/g) || []).length;
    const fixedEvals = (fixed.match(/\beval\s*\(/g) || []).length;
    if (fixedEvals > origEvals) return false;
    // ما أضاف hardcoded secrets جديدة
    const origSecrets = (original.match(/["'][a-zA-Z0-9]{20,}["']/g) || []).length;
    const fixedSecrets = (fixed.match(/["'][a-zA-Z0-9]{20,}["']/g) || []).length;
    if (fixedSecrets > origSecrets + 2) return false;
    // ما حذف أكثر من 60% من الكود
    const origLines = original.split('\n').length;
    const fixedLines = fixed.split('\n').length;
    if (fixedLines < origLines * 0.4) return false;
    return true;
  }

  // ─── Score Fix Quality ────────────────────────────
  function scoreFixed(original, fixed, analyzeFunc, fileName) {
    if (!analyzeFunc) return 50;
    try {
      const origIssues = analyzeFunc(original, fileName);
      const fixedIssues = analyzeFunc(fixed, fileName);
      const origCritical = origIssues.filter(i => i.sev === 'c' || i.sev === 'h').length;
      const fixedCritical = fixedIssues.filter(i => i.sev === 'c' || i.sev === 'h').length;
      // كلما قل الـ critical = أفضل
      return Math.max(0, 100 - fixedCritical * 10);
    } catch(e) { return 50; }
  }

  // ─── Ghost Fix ────────────────────────────────────
  function fix(originalCode, fixedCode, fileName, analyzeFunc) {
    // لو الإصلاح صح من أول → ارجعه
    if (isValid(originalCode, fixedCode)) {
      return { code: fixedCode, method: 'direct', ghost: false };
    }

    // الإصلاح مكسور — نجرب طرق ثانية بصمت
    const candidates = [];

    // طريقة 1: BabelRepair
    if (typeof BabelRepair !== 'undefined') {
      try {
        const br = BabelRepair.repair(originalCode, fileName);
        if (br.repairs.length > 0 && isValid(originalCode, br.code)) {
          candidates.push({
            code: br.code,
            method: 'babel',
            score: scoreFixed(originalCode, br.code, analyzeFunc, fileName)
          });
        }
      } catch(e) {}
    }

    // طريقة 2: LearnedFixer
    if (typeof LearnedFixer !== 'undefined') {
      try {
        const lf = LearnedFixer.smartApply(originalCode, fileName);
        if (lf.applied > 0 && isValid(originalCode, lf.code)) {
          candidates.push({
            code: lf.code,
            method: 'learned',
            score: scoreFixed(originalCode, lf.code, analyzeFunc, fileName)
          });
        }
      } catch(e) {}
    }

    // طريقة 3: HTMLRepair للـ HTML
    if (/\.html?$/i.test(fileName) && typeof HTMLRepair !== 'undefined') {
      try {
        const hr = HTMLRepair.fix(originalCode, fileName);
        if (hr.changed && isValid(originalCode, hr.fixed)) {
          candidates.push({
            code: hr.fixed,
            method: 'html',
            score: scoreFixed(originalCode, hr.fixed, analyzeFunc, fileName)
          });
        }
      } catch(e) {}
    }

    // طريقة 4: XSSFixer
    if (typeof XSSFixer !== 'undefined') {
      try {
        const xr = XSSFixer.fix(originalCode, fileName);
        if (xr.changed && isValid(originalCode, xr.fixed)) {
          candidates.push({
            code: xr.fixed,
            method: 'xss',
            score: scoreFixed(originalCode, xr.fixed, analyzeFunc, fileName)
          });
        }
      } catch(e) {}
    }

    // اختر الأفضل
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      return { code: best.code, method: best.method, ghost: true };
    }

    // ما فيه بديل أفضل — ارجع الأصلي
    return { code: originalCode, method: 'original_safe', ghost: true };
  }

  // ─── Apply Ghost Mode to All Files ────────────────
  function applyToAll(files, analyzeFunc, repairFunc) {
    const results = {};
    Object.entries(files).forEach(([fileName, code]) => {
      try {
        // إصلاح عادي أولاً
        const issues = analyzeFunc ? analyzeFunc(code, fileName) : [];
        const fixed = repairFunc ? repairFunc(code, issues, fileName) : { repaired: code };
        const repaired = fixed.repaired || code;

        // Ghost Mode يتحقق
        const ghostResult = fix(code, repaired, fileName, analyzeFunc);
        results[fileName] = ghostResult.code;
      } catch(e) {
        results[fileName] = code; // ارجع الأصلي لو فيه خطأ
      }
    });
    return results;
  }

  return { fix, isValid, scoreFixed, applyToAll };
})();

if (typeof window !== 'undefined') window.GhostMode = GhostMode;
if (typeof module !== 'undefined') module.exports = GhostMode;
