/**
 * AISecurityGuard — يفحص كل اقتراح يولده الذكاء الاصطناعي
 * قبل أن يُعرض على المستخدم
 * طبقة الحماية الثانية بعد PolicyEngine
 */

import { checkPolicy, PolicyResult } from './PolicyEngine';

export type GuardVerdict = 'safe' | 'warning' | 'blocked';

export interface GuardReport {
  verdict:         GuardVerdict;
  safetyScore:     number;       // 0-100، 100 = آمن تماماً
  policyResult:    PolicyResult;
  aiChecks:        AICheck[];
  canProceed:      boolean;
  blockedReason?:  string;
  warningMessages: string[];
  recommendation:  string;
}

export interface AICheck {
  id:       string;
  name:     string;
  passed:   boolean;
  details:  string;
  severity: 'critical' | 'high' | 'medium' | 'info';
}

// ===== AI-specific checks (beyond policy) =====
function runAIChecks(suggestion: string): AICheck[] {
  const checks: AICheck[] = [];

  // 1. هل الكود واضح ومقروء؟ (obfuscation indicator)
  const avgLineLength = suggestion.split('\n')
    .filter(l => l.trim())
    .reduce((sum, l) => sum + l.length, 0) / (suggestion.split('\n').filter(l => l.trim()).length || 1);

  checks.push({
    id: 'AI001', name: 'Code Readability',
    passed: avgLineLength < 200,
    details: avgLineLength < 200
      ? `متوسط طول السطر ${Math.round(avgLineLength)} حرف — مقروء`
      : `متوسط طول السطر ${Math.round(avgLineLength)} حرف — مشبوه`,
    severity: 'high',
  });

  // 2. نسبة التعليقات — كود بلا تعليقات ديناميكي قد يكون خطراً
  const commentLines = (suggestion.match(/^\s*#.*/gm) ?? []).length;
  const totalLines   = suggestion.split('\n').filter(l => l.trim()).length;
  const commentRatio = totalLines > 5 ? commentLines / totalLines : 1;

  checks.push({
    id: 'AI002', name: 'Comment Coverage',
    passed: commentRatio >= 0 || totalLines <= 10,
    details: `${commentLines} تعليق من ${totalLines} سطر (${Math.round(commentRatio * 100)}%)`,
    severity: 'info',
  });

  // 3. متغيرات ذات أسماء مشبوهة
  const suspiciousVars = suggestion.match(
    /\b(?:payload|shellcode|exploit|inject|bypass|hook|patch|backdoor|trojan|rat|c2|c&c)\b/gi
  );
  checks.push({
    id: 'AI003', name: 'Variable Names Safety',
    passed: !suspiciousVars || suspiciousVars.length === 0,
    details: suspiciousVars?.length
      ? `وُجدت أسماء مشبوهة: ${[...new Set(suspiciousVars)].join(', ')}`
      : 'أسماء المتغيرات آمنة',
    severity: 'critical',
  });

  // 4. تشغيل أوامر shell
  const shellCalls = (suggestion.match(/(?:os\.system|subprocess|Popen|shell=True)/g) ?? []).length;
  checks.push({
    id: 'AI004', name: 'Shell Execution Control',
    passed: shellCalls === 0,
    details: shellCalls > 0
      ? `${shellCalls} استدعاء shell — يحتاج مراجعة يدوية`
      : 'لا استدعاءات shell',
    severity: 'high',
  });

  // 5. الكود يحتوي على error handling؟
  const hasTryCatch = /try\s*:/.test(suggestion);
  const hasExcept   = /except\s/.test(suggestion);
  checks.push({
    id: 'AI005', name: 'Error Handling Present',
    passed: hasTryCatch && hasExcept,
    details: hasTryCatch && hasExcept
      ? 'يحتوي على try/except — جيد'
      : 'لا يحتوي على error handling — قد يسبب crashes',
    severity: 'medium',
  });

  // 6. هل يستخدم environment variables بشكل صحيح؟
  const hasHardcodedCreds = /(?:password|secret|api_key)\s*=\s*['"][^'"]{4,}['"]/i.test(suggestion);
  checks.push({
    id: 'AI006', name: 'No Hardcoded Credentials',
    passed: !hasHardcodedCreds,
    details: hasHardcodedCreds
      ? 'يحتوي على credentials مكتوبة مباشرةً — خطر أمني'
      : 'لا credentials مكشوفة',
    severity: 'critical',
  });

  // 7. نسبة استخدام network calls
  const networkCalls = (suggestion.match(/(?:requests\.|urllib\.|socket\.|http\.)/g) ?? []).length;
  checks.push({
    id: 'AI007', name: 'Network Usage',
    passed: networkCalls <= 3,
    details: networkCalls > 0
      ? `${networkCalls} استدعاء شبكي — تأكد من ضرورتها`
      : 'لا اتصالات شبكية',
    severity: networkCalls > 3 ? 'high' : 'medium',
  });

  // 8. استخدام eval/exec
  const evalUsage = (suggestion.match(/\b(?:eval|exec|compile)\s*\(/g) ?? []).length;
  checks.push({
    id: 'AI008', name: 'No Dynamic Execution',
    passed: evalUsage === 0,
    details: evalUsage > 0
      ? `${evalUsage} استخدام لـ eval/exec/compile — خطر كبير`
      : 'لا eval/exec',
    severity: 'critical',
  });

  return checks;
}

// ===== Calculate safety score =====
function calcSafetyScore(checks: AICheck[], policyRisk: number): number {
  const failedChecks = checks.filter(c => !c.passed);
  let deductions = 0;

  for (const c of failedChecks) {
    if (c.severity === 'critical') deductions += 30;
    else if (c.severity === 'high') deductions += 15;
    else if (c.severity === 'medium') deductions += 7;
    else deductions += 2;
  }

  const policyDeduction = policyRisk * 0.5;
  return Math.max(0, Math.min(100, 100 - deductions - policyDeduction));
}

// ===== Main guard function =====
export function guardSuggestion(suggestion: string): GuardReport {
  // Step 1: Policy check
  const policyResult = checkPolicy(suggestion);

  // Step 2: AI-specific checks
  const aiChecks = runAIChecks(suggestion);

  // Step 3: Calculate score
  const safetyScore = calcSafetyScore(aiChecks, policyResult.riskScore);

  // Step 4: Determine verdict
  const failedCritical = aiChecks.filter(c => !c.passed && c.severity === 'critical');
  const failedHigh     = aiChecks.filter(c => !c.passed && c.severity === 'high');

  let verdict: GuardVerdict;
  let blockedReason: string | undefined;

  if (policyResult.verdict === 'blocked' || failedCritical.length > 0) {
    verdict = 'blocked';
    blockedReason = policyResult.verdict === 'blocked'
      ? policyResult.violations.find(v => v.severity === 'critical')?.description
      : failedCritical[0]?.details;
  } else if (policyResult.verdict === 'warning' || failedHigh.length > 0 || safetyScore < 70) {
    verdict = 'warning';
  } else {
    verdict = 'safe';
  }

  // Step 5: Collect warnings
  const warningMessages: string[] = [
    ...aiChecks.filter(c => !c.passed && c.severity !== 'critical').map(c => c.details),
    ...policyResult.violations.filter(v => v.severity !== 'critical').map(v => v.description),
  ];

  // Step 6: Recommendation
  const recommendation = verdict === 'blocked'
    ? 'هذا الاقتراح مرفوض تلقائياً ولن يُعرض على المستخدم. سيتم تسجيل المحاولة.'
    : verdict === 'warning'
    ? 'هذا الاقتراح يحتاج مراجعة دقيقة قبل التطبيق. تأكد من فهم كل سطر.'
    : 'الاقتراح اجتاز جميع الفحوصات. تبقى مراجعة المستخدم إلزامية.';

  return {
    verdict,
    safetyScore,
    policyResult,
    aiChecks,
    canProceed:      verdict !== 'blocked',
    blockedReason,
    warningMessages,
    recommendation,
  };
}

// ===== Audit logger =====
export interface AuditEntry {
  timestamp:    string;
  verdict:      GuardVerdict;
  safetyScore:  number;
  functionName: string;
  blockedReason?: string;
}

const auditLog: AuditEntry[] = [];

export function logAudit(entry: Omit<AuditEntry, 'timestamp'>) {
  auditLog.push({ ...entry, timestamp: new Date().toISOString() });
  // Keep last 100 entries
  if (auditLog.length > 100) auditLog.shift();
}

export function getAuditLog(): AuditEntry[] {
  return [...auditLog].reverse();
}
