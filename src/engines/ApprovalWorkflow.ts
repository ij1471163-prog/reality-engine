/**
 * ApprovalWorkflow — نظام الموافقة البشرية الإلزامية
 * كل تعديل يمر بـ 8 مراحل قبل التطبيق
 * القرار النهائي دائماً للمستخدم
 */

import { guardSuggestion, GuardReport, logAudit } from './AISecurityGuard';
import { analyzeIntent, IntentResult }             from './IntentAnalyzer';
import { detectStubs, StubFunction }               from '../utils/stubDetector';

export type WorkflowStage =
  | 'idle'
  | 'analyzing'
  | 'generating'
  | 'security_check'
  | 'test_simulation'
  | 'diff_ready'
  | 'explaining'
  | 'awaiting_approval'
  | 'applying'
  | 'done'
  | 'rejected'
  | 'blocked';

export interface DiffResult {
  before:       string;
  after:        string;
  changedLines: number;
  addedLines:   number;
  removedLines: number;
}

export interface Explanation {
  why:           string;
  confidence:    number;
  riskLevel:     'low' | 'medium' | 'high' | 'critical';
  impact:        string;
  needsReview:   boolean;
  intentSummary: string;
}

export interface WorkflowItem {
  id:            string;
  functionName:  string;
  stage:         WorkflowStage;
  stageLabel:    string;
  stageProgress: number;   // 0-100

  // Data populated as workflow progresses
  intentResult?:  IntentResult;
  guardReport?:   GuardReport;
  diff?:          DiffResult;
  explanation?:   Explanation;
  suggestion?:    string;
  error?:         string;

  // Timestamps
  startedAt:   string;
  completedAt?: string;
}

// ===== Stage metadata =====
const STAGE_META: Record<WorkflowStage, { label: string; progress: number; icon: string }> = {
  idle:              { label: 'في الانتظار',       progress: 0,   icon: 'time-outline' },
  analyzing:         { label: '1 — تحليل السياق',   progress: 12,  icon: 'search-outline' },
  generating:        { label: '2 — توليد الاقتراح', progress: 25,  icon: 'code-slash-outline' },
  security_check:    { label: '3 — فحص أمني',       progress: 45,  icon: 'shield-checkmark-outline' },
  test_simulation:   { label: '4 — محاكاة الاختبار', progress: 60, icon: 'flask-outline' },
  diff_ready:        { label: '5 — مقارنة Before/After', progress: 72, icon: 'git-compare-outline' },
  explaining:        { label: '6 — شرح التعديل',    progress: 82,  icon: 'document-text-outline' },
  awaiting_approval: { label: '7 — بانتظار موافقتك', progress: 90, icon: 'checkmark-circle-outline' },
  applying:          { label: '8 — تطبيق التعديل',  progress: 95,  icon: 'sync-outline' },
  done:              { label: 'اكتمل ✓',            progress: 100, icon: 'checkmark-done-outline' },
  rejected:          { label: 'رُفض من المستخدم',   progress: 100, icon: 'close-circle-outline' },
  blocked:           { label: 'محظور: انتهاك أمني', progress: 100, icon: 'ban-outline' },
};

// ===== Diff generator =====
function generateDiff(original: string, modified: string): DiffResult {
  const origLines = original.split('\n');
  const modLines  = modified.split('\n');

  const added   = modLines.filter(l => !origLines.includes(l) && l.trim()).length;
  const removed = origLines.filter(l => !modLines.includes(l) && l.trim()).length;

  return {
    before:       original,
    after:        modified,
    changedLines: Math.max(added, removed),
    addedLines:   added,
    removedLines: removed,
  };
}

// ===== Explanation builder =====
function buildExplanation(
  stub:         StubFunction,
  intentResult: IntentResult,
  guardReport:  GuardReport,
): Explanation {
  const riskLevel: Explanation['riskLevel'] =
    guardReport.verdict === 'blocked' ? 'critical'
    : guardReport.safetyScore < 60   ? 'high'
    : guardReport.safetyScore < 80   ? 'medium'
    : 'low';

  const why = [
    `الدالة "${stub.name}()" اكتُشفت كـ stub (${stub.reason}).`,
    `النية المُحللة: ${intentResult.description} بثقة ${intentResult.confidence}%.`,
    `المحرك حلل ${intentResult.signals.length} إشارة من السياق.`,
  ].join(' ');

  const impact = intentResult.confidence >= 70
    ? `التنفيذ المقترح يتوافق مع نية الدالة بثقة ${intentResult.confidence}%.`
    : `الثقة منخفضة (${intentResult.confidence}%) — يُنصح بمراجعة يدوية دقيقة.`;

  return {
    why,
    confidence:    intentResult.confidence,
    riskLevel,
    impact,
    needsReview:   intentResult.confidence < 70 || guardReport.verdict === 'warning',
    intentSummary: intentResult.description,
  };
}

// ===== Test simulation =====
function simulateTests(suggestion: string): { passed: boolean; notes: string[] } {
  const notes: string[] = [];
  let passed = true;

  // Syntax check (basic)
  if ((suggestion.match(/:/g) ?? []).length < (suggestion.match(/def /g) ?? []).length) {
    notes.push('⚠️ ربما يوجد خطأ في syntax — افحص الـ colons');
    passed = false;
  }

  // Return statement check
  if (!suggestion.includes('return') && !suggestion.includes('raise')) {
    notes.push('⚠️ لا يحتوي على return أو raise — قد يكون ناقصاً');
  } else {
    notes.push('✓ يحتوي على return statement');
  }

  // Error handling check
  if (suggestion.includes('try:')) {
    notes.push('✓ يحتوي على error handling');
  } else {
    notes.push('⚠️ لا يحتوي على try/except');
  }

  // Import dependencies
  const neededImports: string[] = [];
  if (/\bjson\b/.test(suggestion) && !/^import json|^from json/.test(suggestion))   neededImports.push('json');
  if (/\bre\b/.test(suggestion) && !/^import re/.test(suggestion))                  neededImports.push('re');
  if (/\bos\b/.test(suggestion) && !/^import os/.test(suggestion))                  neededImports.push('os');
  if (/\bhashlib\b/.test(suggestion) && !/^import hashlib/.test(suggestion))        neededImports.push('hashlib');

  if (neededImports.length > 0)
    notes.push(`⚠️ قد يحتاج import: ${neededImports.join(', ')}`);

  return { passed, notes };
}

// ===== Main Workflow Processor =====
export async function processWorkflow(
  stub:        StubFunction,
  originalCode: string,
  fullCode:    string,
  onProgress:  (item: WorkflowItem) => void,
): Promise<WorkflowItem> {

  const item: WorkflowItem = {
    id:          `${stub.name}_${Date.now()}`,
    functionName: stub.name,
    stage:       'idle',
    stageLabel:  STAGE_META.idle.label,
    stageProgress: 0,
    startedAt:   new Date().toISOString(),
  };

  const update = (stage: WorkflowStage, extra?: Partial<WorkflowItem>) => {
    item.stage         = stage;
    item.stageLabel    = STAGE_META[stage].label;
    item.stageProgress = STAGE_META[stage].progress;
    if (extra) Object.assign(item, extra);
    onProgress({ ...item });
  };

  // ── Stage 1: Analyzing ───────────────────────────────────────────
  await delay(300);
  update('analyzing');

  const intentResult = analyzeIntent(stub.name, stub.args ?? [], stub.snippet, fullCode);

  // If confidence too low — stop and ask user
  if (intentResult.requiresClarify) {
    update('awaiting_approval', {
      intentResult,
      explanation: {
        why:           intentResult.clarifyQuestion ?? 'النية غير واضحة',
        confidence:    intentResult.confidence,
        riskLevel:     'medium',
        impact:        'لن يتم توليد كود حتى يوضح المستخدم النية',
        needsReview:   true,
        intentSummary: 'غير محدد',
      },
    });
    return item;
  }

  // ── Stage 2: Generating ──────────────────────────────────────────
  await delay(400);
  update('generating', { intentResult });

  const suggestion = intentResult.suggestedImpl ?? '';

  // Build modified code
  const stubBody    = /pass|\.\.\./.test(stub.snippet) ? 'pass' : stub.snippet;
  const modifiedCode = originalCode.replace(
    new RegExp(`(def\\s+${stub.name}\\s*\\([^)]*\\)\\s*(?:->\\s*[^:]+)?:\\s*\\n)(\\s+(?:pass|\\.\\.\\.)[^\\n]*)`),
    `$1    ${suggestion.split('\n').join('\n    ')}`,
  );

  const diff = generateDiff(
    `def ${stub.name}(...):\n    ${stubBody}`,
    `def ${stub.name}(...):\n    ${suggestion}`,
  );

  // ── Stage 3: Security Check ──────────────────────────────────────
  await delay(500);
  update('security_check');

  const guardReport = guardSuggestion(suggestion);
  logAudit({
    verdict:      guardReport.verdict,
    safetyScore:  guardReport.safetyScore,
    functionName: stub.name,
    blockedReason: guardReport.blockedReason,
  });

  if (guardReport.verdict === 'blocked') {
    update('blocked', { guardReport, suggestion, diff,
      error: guardReport.blockedReason ?? 'انتهاك أمني حرج' });
    return item;
  }

  // ── Stage 4: Test Simulation ─────────────────────────────────────
  await delay(400);
  update('test_simulation', { guardReport });

  const testResult = simulateTests(suggestion);

  // ── Stage 5: Diff Ready ──────────────────────────────────────────
  await delay(200);
  update('diff_ready', { diff, suggestion });

  // ── Stage 6: Explaining ──────────────────────────────────────────
  await delay(200);
  update('explaining');

  const explanation = buildExplanation(stub, intentResult, guardReport);

  // ── Stage 7: Awaiting Approval ───────────────────────────────────
  await delay(100);
  update('awaiting_approval', {
    explanation,
    suggestion,
    diff,
    intentResult,
    guardReport,
  });

  return item;
}

// ===== Apply approved change (only after user confirms) =====
export function applyApprovedChange(
  originalCode: string,
  stub:         StubFunction,
  suggestion:   string,
): string {
  const lines = originalCode.split('\n');
  const startIdx = stub.line - 1;

  // Find end of function body
  let endIdx = startIdx + 1;
  const defIndent = (lines[startIdx].match(/^\s*/) ?? [''])[0].length;

  for (let i = startIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') { endIdx = i + 1; continue; }
    const lineIndent = (l.match(/^\s*/) ?? [''])[0].length;
    if (lineIndent <= defIndent && l.trim() !== '') { endIdx = i; break; }
    endIdx = i + 1;
  }

  const bodyIndent  = '    ' + ' '.repeat(defIndent);
  const newBodyLines = suggestion.split('\n').map(l => bodyIndent + l);

  // Keep the def line, replace body
  const defLine     = lines[startIdx];
  const beforeStub  = lines.slice(0, startIdx + 1);
  const afterStub   = lines.slice(endIdx);

  return [...beforeStub, ...newBodyLines, ...afterStub].join('\n');
}

// Helper
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
