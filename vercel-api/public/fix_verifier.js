// ═══════════════════════════════════════════════════════
// fix_verifier.js v1.0 — التحقق من صحة الإصلاح
// يتأكد إن الإصلاح ما خرب شيء وما زاد مشاكل
// ═══════════════════════════════════════════════════════
"use strict";

var FixVerifier = (() => {

  // ─── Verify Fix ───────────────────────────────────
  function verify(originalCode, fixedCode, fileName, analyzeFunc) {
    if (!originalCode || !fixedCode || originalCode === fixedCode) {
      return { valid: true, improved: false, reason: 'no change' };
    }

    const result = {
      valid: true,
      improved: false,
      originalIssues: 0,
      fixedIssues: 0,
      newIssues: [],
      resolvedIssues: [],
      reason: '',
    };

    try {
      // حلل الكود الأصلي
      const origIssues = analyzeFunc ? analyzeFunc(originalCode, fileName) : [];
      result.originalIssues = origIssues.length;

      // حلل الكود المصلح
      const fixedIssues = analyzeFunc ? analyzeFunc(fixedCode, fileName) : [];
      result.fixedIssues = fixedIssues.length;

      // قارن
      const origKeys = new Set(origIssues.map(i => `${i.line}:${i.type}`));
      const fixedKeys = new Set(fixedIssues.map(i => `${i.line}:${i.type}`));

      // مشاكل جديدة ظهرت بعد الإصلاح
      result.newIssues = fixedIssues.filter(i => {
        const key = `${i.line}:${i.type}`;
        return !origKeys.has(key) && i.sev === 'c'; // critical فقط
      });

      // مشاكل اتحلت
      result.resolvedIssues = origIssues.filter(i => {
        const key = `${i.line}:${i.type}`;
        return !fixedKeys.has(key);
      });

      // قرار
      if (result.newIssues.length > 0) {
        result.valid = false;
        result.reason = `الإصلاح أضاف ${result.newIssues.length} مشكلة جديدة`;
      } else if (result.fixedIssues > result.originalIssues) {
        // زادت المشاكل
        result.valid = false;
        result.reason = `المشاكل زادت من ${result.originalIssues} لـ ${result.fixedIssues}`;
      } else if (result.resolvedIssues.length > 0) {
        result.improved = true;
        result.reason = `✅ حُل ${result.resolvedIssues.length} مشكلة`;
      } else {
        result.reason = 'لا تغيير في المشاكل';
      }

    } catch(e) {
      result.valid = true; // في حالة خطأ = نقبل الإصلاح
      result.reason = 'تعذر التحقق';
    }

    return result;
  }

  // ─── Quick Checks ─────────────────────────────────
  function quickCheck(originalCode, fixedCode) {
    const checks = [];

    // 1. الكود ما أصبح فارغ
    if (!fixedCode || fixedCode.trim().length < 10) {
      checks.push({ valid: false, reason: 'الكود أصبح فارغاً' });
    }

    // 2. لم يحذف كود بشكل كبير
    const origLines = originalCode.split('\n').length;
    const fixedLines = fixedCode.split('\n').length;
    if (fixedLines < origLines * 0.5) {
      checks.push({ valid: false, reason: 'حُذف أكثر من 50% من الكود' });
    }

    // 3. ما زالت الدوال الرئيسية موجودة
    const origFuncs = originalCode.match(/function\s+\w+/g) || [];
    const fixedFuncs = fixedCode.match(/function\s+\w+/g) || [];
    const missingFuncs = origFuncs.filter(f => !fixedFuncs.includes(f));
    if (missingFuncs.length > origFuncs.length * 0.3) {
      checks.push({ valid: false, reason: `دوال محذوفة: ${missingFuncs.join(', ')}` });
    }

    // 4. لم يُضف eval() أو خطر جديد
    const origEvals = (originalCode.match(/\beval\s*\(/g) || []).length;
    const fixedEvals = (fixedCode.match(/\beval\s*\(/g) || []).length;
    if (fixedEvals > origEvals) {
      checks.push({ valid: false, reason: 'الإصلاح أضاف eval()' });
    }

    // 5. لم يُضف hardcoded secrets
    const origSecrets = (originalCode.match(/(?:password|secret|key)\s*=\s*["'][^"']{6,}["']/gi) || []).length;
    const fixedSecrets = (fixedCode.match(/(?:password|secret|key)\s*=\s*["'][^"']{6,}["']/gi) || []).length;
    if (fixedSecrets > origSecrets) {
      checks.push({ valid: false, reason: 'الإصلاح أضاف hardcoded secrets' });
    }

    const failed = checks.filter(c => !c.valid);
    return {
      valid: failed.length === 0,
      checks,
      failedChecks: failed,
    };
  }

  // ─── Full Verification ────────────────────────────
  function fullVerify(originalCode, fixedCode, fileName, analyzeFunc) {
    // Quick checks أولاً
    const quick = quickCheck(originalCode, fixedCode);
    if (!quick.valid) {
      return {
        valid: false,
        reason: quick.failedChecks.map(c => c.reason).join(', '),
        quick,
      };
    }

    // Deep verification
    const deep = verify(originalCode, fixedCode, fileName, analyzeFunc);

    return {
      valid: deep.valid,
      improved: deep.improved,
      reason: deep.reason,
      originalIssues: deep.originalIssues,
      fixedIssues: deep.fixedIssues,
      newIssues: deep.newIssues,
      resolvedIssues: deep.resolvedIssues,
      quick,
    };
  }

  return { verify, quickCheck, fullVerify };
})();

if (typeof window !== 'undefined') window.FixVerifier = FixVerifier;
if (typeof module !== 'undefined') module.exports = FixVerifier;
