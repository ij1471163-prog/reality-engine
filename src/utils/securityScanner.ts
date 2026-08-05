export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SecurityIssue {
  id:          string;
  severity:    Severity;
  title:       string;
  description: string;
  line:        number;
  snippet:     string;
  fix:         string;
  category:    string;
}

export interface ScanResult {
  issues:       SecurityIssue[];
  score:        number;   // 0-100, 100 = clean
  scannedLines: number;
  language:     string;
}

// ===== Rule definitions =====
interface Rule {
  id:          string;
  severity:    Severity;
  title:       string;
  description: string;
  pattern:     RegExp;
  fix:         string;
  category:    string;
}

const RULES: Rule[] = [
  // ── CRITICAL ──────────────────────────────────────────────
  {
    id: 'SEC001', severity: 'critical',
    title: 'Hardcoded Password',
    description: 'كلمة مرور مكتوبة مباشرة في الكود - خطر أمني كبير',
    pattern: /(?:password|passwd|pwd)\s*=\s*['"][^'"]{3,}['"]/gi,
    fix: 'استخدم environment variables أو secrets manager بدلاً من الهاردكود',
    category: 'Secrets',
  },
  {
    id: 'SEC002', severity: 'critical',
    title: 'Hardcoded API Key',
    description: 'API key أو token مكشوف في الكود',
    pattern: /(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key)\s*=\s*['"][A-Za-z0-9_\-\.]{10,}['"]/gi,
    fix: 'انقل الـ key لـ .env أو Secret Manager',
    category: 'Secrets',
  },
  {
    id: 'SEC003', severity: 'critical',
    title: 'AWS Credentials',
    description: 'AWS access key مكشوف',
    pattern: /AKIA[0-9A-Z]{16}/g,
    fix: 'أزل الـ key فوراً وأعد توليده في AWS Console',
    category: 'Secrets',
  },
  {
    id: 'SEC004', severity: 'critical',
    title: 'Private Key / Certificate',
    description: 'private key مكتوب مباشرة في الكود',
    pattern: /-----BEGIN\s(?:RSA\s)?PRIVATE KEY-----/g,
    fix: 'احذف الـ key من الكود وخزّنه في ملف منفصل مشفر',
    category: 'Secrets',
  },
  {
    id: 'SEC005', severity: 'critical',
    title: 'SQL Injection Risk',
    description: 'بناء SQL query بـ string concatenation - خطر SQL injection',
    pattern: /(?:execute|query)\s*\(\s*f?["'].*(?:\+|%s|{.*}).*["']/gi,
    fix: 'استخدم parameterized queries أو ORM بدلاً من string format',
    category: 'Injection',
  },

  // ── HIGH ──────────────────────────────────────────────────
  {
    id: 'SEC006', severity: 'high',
    title: 'Use of eval()',
    description: 'eval() يشغّل كود تعسفي - خطر Remote Code Execution',
    pattern: /\beval\s*\(/g,
    fix: 'استبدل eval() بـ json.loads() أو ast.literal_eval() حسب الحاجة',
    category: 'Code Execution',
  },
  {
    id: 'SEC007', severity: 'high',
    title: 'Use of exec()',
    description: 'exec() يشغّل كود ديناميكي - خطر أمني',
    pattern: /\bexec\s*\(/g,
    fix: 'تجنب exec() واستبدله بمنطق صريح',
    category: 'Code Execution',
  },
  {
    id: 'SEC008', severity: 'high',
    title: 'Insecure Deserialization',
    description: 'pickle.loads() على بيانات غير موثوقة - خطر RCE',
    pattern: /pickle\.(?:loads?|Unpickler)/g,
    fix: 'استخدم json.loads() للبيانات من مصادر خارجية، وpickle فقط للبيانات الداخلية الموثوقة',
    category: 'Deserialization',
  },
  {
    id: 'SEC009', severity: 'high',
    title: 'Shell Injection Risk',
    description: 'os.system أو subprocess مع input ديناميكي - خطر shell injection',
    pattern: /(?:os\.system|subprocess\.(?:call|run|Popen))\s*\(\s*(?:f?['"]|.*\+)/g,
    fix: 'مرّر قائمة بدلاً من string، وفعّل shell=False',
    category: 'Injection',
  },
  {
    id: 'SEC010', severity: 'high',
    title: 'Weak Hashing Algorithm',
    description: 'MD5 أو SHA1 ضعيفة لتشفير كلمات المرور',
    pattern: /hashlib\.(?:md5|sha1)\s*\(/g,
    fix: 'استخدم bcrypt أو hashlib.sha256() أو argon2 للـ passwords',
    category: 'Cryptography',
  },
  {
    id: 'SEC011', severity: 'high',
    title: 'Hardcoded Database URL',
    description: 'بيانات اتصال قاعدة البيانات مكشوفة',
    pattern: /(?:mongodb|postgresql|mysql|redis):\/\/[^"'\s]{5,}/gi,
    fix: 'انقل connection string لـ environment variables',
    category: 'Secrets',
  },

  // ── MEDIUM ────────────────────────────────────────────────
  {
    id: 'SEC012', severity: 'medium',
    title: 'SSL Verification Disabled',
    description: 'verify=False يعطّل التحقق من SSL - خطر MITM',
    pattern: /verify\s*=\s*False/g,
    fix: 'أزل verify=False أو مرّر CA certificate صحيح',
    category: 'Network',
  },
  {
    id: 'SEC013', severity: 'medium',
    title: 'HTTP بدون HTTPS',
    description: 'طلبات HTTP غير مشفرة',
    pattern: /http:\/\/(?!localhost|127\.|0\.0\.0\.0)/g,
    fix: 'استخدم https:// دائماً للاتصالات الخارجية',
    category: 'Network',
  },
  {
    id: 'SEC014', severity: 'medium',
    title: 'Debug Mode Active',
    description: 'debug=True أو DEBUG=True في الكود الإنتاجي',
    pattern: /debug\s*=\s*True/gi,
    fix: 'أوقف debug mode في production وقيّد error details',
    category: 'Configuration',
  },
  {
    id: 'SEC015', severity: 'medium',
    title: 'Open File Without Exception Handling',
    description: 'فتح ملف بدون try/except - قد يسبب crash أو data leak',
    pattern: /open\s*\([^)]+\)(?!\s*(?:as|#))/g,
    fix: 'استخدم with open() داخل try/except',
    category: 'Error Handling',
  },
  {
    id: 'SEC016', severity: 'medium',
    title: 'Hardcoded IP Address',
    description: 'عنوان IP مكتوب مباشرة في الكود',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    fix: 'انقل الـ IP لـ config file أو environment variable',
    category: 'Configuration',
  },

  // ── LOW ───────────────────────────────────────────────────
  {
    id: 'SEC017', severity: 'low',
    title: 'Print Sensitive Data',
    description: 'print() قد يكشف بيانات حساسة في الـ logs',
    pattern: /print\s*\(.*(?:password|token|key|secret|auth)/gi,
    fix: 'استخدم logging module مع مستوى مناسب وتجنب طباعة بيانات حساسة',
    category: 'Information Disclosure',
  },
  {
    id: 'SEC018', severity: 'low',
    title: 'TODO Security Comment',
    description: 'TODO أو FIXME مرتبط بأمان',
    pattern: /(?:TODO|FIXME|HACK|XXX).*(?:security|auth|password|secure|fix)/gi,
    fix: 'تأكد من معالجة هذه الملاحظات قبل النشر',
    category: 'Code Quality',
  },
];

// ===== Detect language =====
function detectLanguage(code: string): string {
  if (/^\s*(?:import|from|def |class |if __name__)/m.test(code)) return 'Python';
  if (/(?:const|let|var|function|=>|require\(|import.*from)/m.test(code))   return 'JavaScript/TypeScript';
  if (/(?:public\s+class|void\s+main|System\.out)/m.test(code))             return 'Java';
  if (/(?:#include|int main\(\)|std::)/m.test(code))                        return 'C/C++';
  return 'Unknown';
}

// ===== Calculate score =====
function calcScore(issues: SecurityIssue[]): number {
  const deductions: Record<Severity, number> = {
    critical: 25, high: 15, medium: 8, low: 3, info: 1,
  };
  const total = issues.reduce((sum, i) => sum + (deductions[i.severity] ?? 0), 0);
  return Math.max(0, 100 - total);
}

// ===== Main scan function =====
export function scanCode(code: string): ScanResult {
  const lines   = code.split('\n');
  const issues: SecurityIssue[] = [];
  const seen    = new Set<string>();          // avoid duplicate matches per line+rule

  for (const rule of RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(code)) !== null) {
      // Find line number
      const beforeMatch = code.substring(0, match.index);
      const lineNo      = beforeMatch.split('\n').length;
      const key         = `${rule.id}:${lineNo}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const snippetLine = lines[lineNo - 1] ?? '';

      issues.push({
        id:          rule.id,
        severity:    rule.severity,
        title:       rule.title,
        description: rule.description,
        line:        lineNo,
        snippet:     snippetLine.trim().substring(0, 120),
        fix:         rule.fix,
        category:    rule.category,
      });
    }
  }

  // Sort: critical → high → medium → low → info
  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    issues,
    score:        calcScore(issues),
    scannedLines: lines.length,
    language:     detectLanguage(code),
  };
}
