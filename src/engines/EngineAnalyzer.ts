/**
 * EngineAnalyzer — يحلل الملف بعمق قبل أي تعديل
 * يشرح للمستخدم بالضبط وش المحرك قادر يسوي ووش صعب عليه
 */

export type FixabilityLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface FunctionAnalysis {
  name:          string;
  line:          number;
  risk:          'confirmed' | 'suspicious';
  reason:        string;
  fixability:    FixabilityLevel;   // مستوى ثقة المحرك في الإصلاح
  fixReason:     string;            // لماذا سهل أو صعب
  intent:        string;            // النية المكتشفة بالعربي
  signals:       string[];          // إشارات السياق
  canAutoFix:    boolean;           // هل المحرك واثق كفاية؟
  warningNote?:  string;            // تحذير خاص إن وجد
}

export interface EngineReport {
  fileName:        string;
  totalLines:      number;
  totalFunctions:  number;
  stubFunctions:   FunctionAnalysis[];
  highFixable:     number;   // يقدر يصلحها بثقة عالية
  mediumFixable:   number;   // يقدر لكن يحتاج مراجعة
  lowFixable:      number;   // صعب — يحتاج تدخل بشري
  engineMessage:   string;   // رسالة المحرك للمستخدم
  recommendation:  string;   // توصية المحرك
  language:        string;
}

// ===== Analyze fixability based on name + context =====
function analyzeFixability(
  name: string,
  args: string[],
  doc: string,
  fullCode: string,
): { level: FixabilityLevel; reason: string; intent: string; signals: string[] } {

  const n       = name.toLowerCase();
  const signals: string[] = [];
  const imports = (fullCode.match(/^(?:import|from)\s+.+/gm) ?? []);
  const classes  = (fullCode.match(/^class\s+(\w+)/gm) ?? []);

  // ── نمط واضح جداً → ثقة عالية ────────────────────────────
  const clearPatterns: Record<string, string> = {
    '^(is_|has_|can_|should_|validate_|check_|verify_)': 'دالة تحقق — النمط واضح',
    '(calculate|compute|sum|total|avg|mean)':            'دالة حسابية — النمط واضح',
    '(read_|load_|save_|write_)':                        'دالة ملفات — النمط واضح',
    '(get_|fetch_|find_|search_)':                       'دالة جلب بيانات — النمط واضح',
    '(log_|logger|debug|info|error)':                    'دالة تسجيل — النمط واضح',
    '(hash_|encrypt_|decrypt_)':                         'دالة تشفير — النمط واضح',
    '(format_|parse_|convert_|clean_)':                  'دالة تحويل — النمط واضح',
    '(send_|email_|notify_)':                            'دالة إرسال — النمط واضح',
  };

  for (const [pattern, reason] of Object.entries(clearPatterns)) {
    if (new RegExp(pattern).test(n)) {
      signals.push(`اسم الدالة: "${name}" يطابق نمط ${reason.split('—')[0].trim()}`);
      if (args.length > 0) signals.push(`معاملات واضحة: ${args.join(', ')}`);
      if (doc)             signals.push('يحتوي على توثيق يوضح الغرض');
      return { level: 'high', reason, intent: reason.split('—')[0].trim(), signals };
    }
  }

  // ── سياق إضافي يساعد → ثقة متوسطة ──────────────────────
  const contextHelpers = [
    imports.some(i => /sqlite3|psycopg2|mysql|sqlalchemy/.test(i)) && 'database',
    imports.some(i => /requests|urllib|httpx/.test(i))              && 'network',
    imports.some(i => /json|yaml|xml/.test(i))                      && 'parsing',
    classes.length > 0                                               && 'class_context',
    args.length >= 2                                                 && 'multiple_args',
    doc.length > 20                                                  && 'has_doc',
  ].filter(Boolean);

  if (contextHelpers.length >= 2) {
    contextHelpers.forEach(c => signals.push(`سياق: ${c}`));
    return {
      level:  'medium',
      reason: 'الاسم غير محدد لكن السياق يساعد — راجع الاقتراح',
      intent: 'نية غير محددة — مبنية على السياق',
      signals,
    };
  }

  // ── اسم عام جداً → ثقة منخفضة ───────────────────────────
  const vague = ['process', 'handle', 'run', 'execute', 'do', 'action', 'work', 'main'];
  if (vague.some(v => n.includes(v)) || name.length < 4) {
    signals.push(`الاسم "${name}" عام جداً — المحرك يحتاج سياق أكثر`);
    return {
      level:  'low',
      reason: 'الاسم غير وصفي — الاقتراح سيكون عاماً ويحتاج تعديل يدوي',
      intent: 'غير محددة',
      signals,
    };
  }

  // ── افتراضي → متوسط ───────────────────────────────────────
  signals.push(`تحليل اسم الدالة: "${name}"`);
  return {
    level:  'medium',
    reason: 'يمكن توليد اقتراح — راجعه قبل الموافقة',
    intent: 'تحتاج مراجعة',
    signals,
  };
}

// ===== Arabic intent label =====
function getIntentLabel(name: string): string {
  const n = name.toLowerCase();
  if (/^(is_|has_|can_|check_|verify_|validate_)/.test(n)) return 'تحقق من صحة';
  if (/(calculate|compute|sum|total|avg)/.test(n))          return 'حساب';
  if (/(read|load)/.test(n))                                return 'قراءة ملف';
  if (/(write|save|export)/.test(n))                        return 'كتابة ملف';
  if (/(send|email|notify)/.test(n))                        return 'إرسال';
  if (/(fetch|get|find|search)/.test(n))                    return 'جلب بيانات';
  if (/(hash|encrypt|decrypt)/.test(n))                     return 'تشفير';
  if (/(log|debug|info|error)/.test(n))                     return 'تسجيل';
  if (/(parse|format|convert|clean)/.test(n))               return 'تحويل بيانات';
  if (/(insert|update|delete|select|db_|sql)/.test(n))      return 'قاعدة بيانات';
  if (/(create|make|build|generate)/.test(n))               return 'إنشاء';
  if (/(delete|remove)/.test(n))                            return 'حذف';
  return 'غير محدد';
}

// ===== Main analysis function =====
export function analyzeFile(
  code:     string,
  fileName: string,
): EngineReport {

  const lines     = code.split('\n');
  const allFuncs  = (code.match(/^\s*(?:async\s+)?def\s+\w+/gm) ?? []).length;
  const language  = /^\s*(?:import|from|def |class )/.test(code) ? 'Python' : 'Unknown';

  // Extract stubs manually (simple regex-based for report stage)
  const stubPattern = /^(\s*)def\s+(\w+)\s*\(([^)]*)\)\s*(?:->[^:]+)?:\s*\n(?:\s+"""[^"]*"""\s*\n)?\s+(?:pass|\.\.\.)/gm;
  const niPattern   = /^(\s*)def\s+(\w+)\s*\(([^)]*)\)\s*(?:->[^:]+)?:\s*\n\s+raise\s+NotImplementedError/gm;

  const foundStubs = new Map<string, { line: number; risk: 'confirmed' | 'suspicious'; reason: string; args: string[] }>();

  let match: RegExpExecArray | null;

  // pass / ...
  const sp = new RegExp(stubPattern.source, 'gm');
  while ((match = sp.exec(code)) !== null) {
    const beforeMatch = code.substring(0, match.index);
    const lineNo = beforeMatch.split('\n').length;
    const funcName = match[2];
    const rawArgs  = match[3].split(',').map(a => a.trim().split(':')[0].trim().split('=')[0].trim()).filter(a => a && !['self','cls','*args','**kwargs'].includes(a));
    if (!foundStubs.has(funcName)) {
      foundStubs.set(funcName, { line: lineNo, risk: 'confirmed', reason: 'pass / ...', args: rawArgs });
    }
  }

  // NotImplementedError
  const ni = new RegExp(niPattern.source, 'gm');
  while ((match = ni.exec(code)) !== null) {
    const beforeMatch = code.substring(0, match.index);
    const lineNo = beforeMatch.split('\n').length;
    const funcName = match[2];
    const rawArgs  = match[3].split(',').map(a => a.trim().split(':')[0].trim().split('=')[0].trim()).filter(a => a && !['self','cls'].includes(a));
    if (!foundStubs.has(funcName)) {
      foundStubs.set(funcName, { line: lineNo, risk: 'confirmed', reason: 'NotImplementedError', args: rawArgs });
    }
  }

  // Build FunctionAnalysis array
  const analyses: FunctionAnalysis[] = [];

  for (const [name, stub] of foundStubs) {
    const { level, reason: fixReason, intent, signals } = analyzeFixability(
      name, stub.args, '', code
    );

    const intentLabel = intent !== 'غير محددة' ? intent : getIntentLabel(name);

    analyses.push({
      name,
      line:      stub.line,
      risk:      stub.risk,
      reason:    stub.reason,
      fixability: level,
      fixReason,
      intent:    intentLabel,
      signals,
      canAutoFix: level === 'high',
      warningNote: level === 'low'
        ? 'الاسم غير وصفي — الاقتراح سيكون عاماً. ينصح بتوضيح الغرض أولاً.'
        : level === 'medium'
        ? 'راجع الاقتراح بعناية قبل الموافقة'
        : undefined,
    });
  }

  // Sort: high fixability first
  analyses.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2, unknown: 3 };
    return order[a.fixability] - order[b.fixability];
  });

  const highCount   = analyses.filter(a => a.fixability === 'high').length;
  const mediumCount = analyses.filter(a => a.fixability === 'medium').length;
  const lowCount    = analyses.filter(a => a.fixability === 'low').length;

  // Engine message
  let engineMessage: string;
  let recommendation: string;

  if (analyses.length === 0) {
    engineMessage   = 'ما وجد المحرك أي دوال ناقصة في هذا الملف.';
    recommendation  = 'الملف يبدو مكتملاً — يمكنك إجراء فحص أمني عليه.';
  } else if (highCount === analyses.length) {
    engineMessage   = `وجد المحرك ${analyses.length} دالة ناقصة — جميعها واضحة النية ويثق في إصلاحها.`;
    recommendation  = 'يمكنك المتابعة — راجع كل اقتراح قبل الموافقة عليه.';
  } else if (lowCount === analyses.length) {
    engineMessage   = `وجد المحرك ${analyses.length} دالة ناقصة — لكن أسماءها غير وصفية وسيكون الاقتراح عاماً.`;
    recommendation  = 'ينصح بإعادة تسمية الدوال أو إضافة توثيق قبل المتابعة.';
  } else {
    engineMessage   = `وجد المحرك ${analyses.length} دالة ناقصة:\n${highCount} واضحة ✓  •  ${mediumCount} تحتاج مراجعة ⚠️  •  ${lowCount} صعبة ✗`;
    recommendation  = 'راجع كل اقتراح بعناية — خاصة الدوال ذات الثقة المنخفضة.';
  }

  return {
    fileName,
    totalLines:     lines.length,
    totalFunctions: allFuncs,
    stubFunctions:  analyses,
    highFixable:    highCount,
    mediumFixable:  mediumCount,
    lowFixable:     lowCount,
    engineMessage,
    recommendation,
    language,
  };
}
