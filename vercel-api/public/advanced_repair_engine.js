// ═══════════════════════════════════════════════════════
// advanced_repair_engine.js — Smart Repair Engine
// ═══════════════════════════════════════════════════════

function executeSmartRepairs(code, analysis) {
  if (!analysis || !Array.isArray(analysis.rawIssues)) {
    return {
      repaired:      code,
      recommendations: [],
      autoFixed:     0,
      needsAI:       0,
      estimatedTime: 'N/A',
    };
  }

  // استخدم repair_engine إذا موجود
  let repairResult = { repairs: [], aiNeeded: [], repaired: code };

  if (typeof repairCode === 'function') {
    const fileName = 'code.js';
    repairResult = repairCode(code, analysis.rawIssues, fileName) || repairResult;
  } else {
    // fallback بسيط
    repairResult.repaired = code;
    repairResult.repairs = [];
    repairResult.aiNeeded = analysis.rawIssues.filter(i =>
      ['c', 'CRITICAL'].includes(i.sev || i.severity)
    ).map(i => ({ line: i.line, title: i.title, reason: 'Requires manual review' }));
  }

  // حول للتنسيق المطلوب
  const recommendations = repairResult.repairs.map(r => ({
    line:       r.line,
    title:      r.title,
    before:     r.before,
    after:      r.after,
    confidence: r.confidence || 0.80,
    autoFix:    true,
    strategy:   r.strategy,
  }));

  // أضف AI recommendations
  repairResult.aiNeeded.forEach(r => {
    recommendations.push({
      line:       r.line,
      title:      r.title,
      before:     r.ev || '',
      after:      '// 🤖 يحتاج AI review',
      confidence: 0,
      autoFix:    false,
      reason:     r.reason,
    });
  });

  // تقدير الوقت
  const autoFixed = repairResult.repairs.length;
  const needsAI   = repairResult.aiNeeded.length;
  const minutes   = autoFixed * 0.1 + needsAI * 5;
  const estimatedTime = minutes < 1 ? 'أقل من دقيقة'
    : minutes < 60 ? Math.round(minutes) + ' دقيقة'
    : Math.round(minutes / 60) + ' ساعة';

  // Re-analysis summary
  const reAnalysis = repairResult.reAnalysis || null;

  return {
    repaired:        repairResult.repaired,
    recommendations,
    autoFixed,
    needsAI,
    estimatedTime,
    reAnalysis,
    summary: {
      totalIssues:   analysis.total,
      autoFixed,
      needsAI,
      remaining:     reAnalysis ? reAnalysis.issuesAfter : (analysis.total - autoFixed),
      riskBefore:    analysis.riskScore,
      riskAfter:     reAnalysis
        ? Math.max(0, analysis.riskScore - autoFixed * 10)
        : analysis.riskScore,
    },
  };
}
