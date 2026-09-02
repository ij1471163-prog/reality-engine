// ═══════════════════════════════════════════════════════
// advanced_analyzer.js — محلل متقدم يدمج كل المحللات
// ═══════════════════════════════════════════════════════

function performDeepAnalysis(code, metadata) {
  const fileName = (metadata && metadata.fileName) || 'code.js';
  const framework = (metadata && metadata.framework) || 'unknown';
  const issues = [];

  // ─── تشغيل كل المحللات ───────────────────────────────
  const runners = [
    { name: 'analyzer',     fn: typeof analyzeCode === 'function'       ? () => analyzeCode(code, fileName) : null },
    { name: 'crypto',       fn: typeof scanCrypto === 'function'        ? () => scanCrypto(code, fileName) : null },
    { name: 'security',     fn: typeof scanSecurity === 'function'      ? () => scanSecurity(code, fileName) : null },
    { name: 'patterns',     fn: typeof detectPatterns === 'function'    ? () => detectPatterns(code, fileName) : null },
    { name: 'accumulation', fn: typeof detectAccumulation === 'function'? () => detectAccumulation(code, fileName) : null },
  ];

  runners.forEach(r => {
    if (!r.fn) return;
    try {
      const result = r.fn();
      if (Array.isArray(result)) {
        result.forEach(issue => {
          const dup = issues.some(x => x.line === issue.line && x.title === issue.title);
          if (!dup) issues.push({ ...issue, source: r.name });
        });
      }
    } catch (e) {}
  });

  // ─── تصنيف الأخطاء ───────────────────────────────────
  const critical = issues.filter(i => i.sev === 'c' || i.severity === 'CRITICAL').length;
  const high     = issues.filter(i => i.sev === 'h' || i.severity === 'HIGH').length;
  const medium   = issues.filter(i => i.sev === 'm' || i.severity === 'MEDIUM').length;
  const low      = issues.filter(i => i.sev === 'l' || i.severity === 'LOW').length;

  // ─── تحويل لتنسيق موحد ───────────────────────────────
  const vulnerabilities = issues.map(i => ({
    line:        i.line,
    type:        i.title,
    severity:    mapSeverity(i.sev || i.severity),
    description: i.title,
    impact:      i.cAct || getImpact(i.sev || i.severity),
    fix:         i.fix,
    source:      i.source || 'analyzer',
    confidence:  i.conf || 75,
  }));

  // ─── Risk Score ───────────────────────────────────────
  const riskScore = Math.min(100,
    critical * 25 + high * 15 + medium * 8 + low * 3
  );

  const riskLevel = riskScore >= 75 ? 'CRITICAL'
    : riskScore >= 50 ? 'HIGH'
    : riskScore >= 25 ? 'MEDIUM' : 'LOW';

  return {
    total:           issues.length,
    critical,
    high,
    medium,
    low,
    riskScore,
    riskLevel,
    vulnerabilities,
    framework,
    linesScanned:    code.split('\n').length,
    scanTime:        new Date().toISOString(),
    rawIssues:       issues,
  };
}

function mapSeverity(sev) {
  if (!sev) return '🟡 MEDIUM';
  const s = sev.toString().toUpperCase();
  if (s === 'C' || s === 'CRITICAL') return '🔴 CRITICAL';
  if (s === 'H' || s === 'HIGH')     return '🟠 HIGH';
  if (s === 'M' || s === 'MEDIUM')   return '🟡 MEDIUM';
  return '🔵 LOW';
}

function getImpact(sev) {
  if (!sev) return 'تأثير محتمل';
  const s = sev.toString().toUpperCase();
  if (s === 'C' || s === 'CRITICAL') return 'تأثير حرج — يجب إصلاحه فوراً';
  if (s === 'H' || s === 'HIGH')     return 'تأثير عالي — أولوية عالية';
  if (s === 'M' || s === 'MEDIUM')   return 'تأثير متوسط — يحتاج مراجعة';
  return 'تأثير منخفض';
}
