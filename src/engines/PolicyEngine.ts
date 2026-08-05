/**
 * PolicyEngine — Google Play Compliance Gatekeeper
 * أول طبقة دفاع: تفحص أي طلب قبل أي عملية
 * لا يمر أي كود أو اقتراح بدون موافقتها
 */

export type PolicyVerdict = 'allowed' | 'blocked' | 'warning';

export interface PolicyResult {
  verdict:     PolicyVerdict;
  violations:  PolicyViolation[];
  riskScore:   number;   // 0-100
  summary:     string;
}

export interface PolicyViolation {
  rule:        string;
  description: string;
  severity:    'critical' | 'high' | 'medium';
  evidence:    string;
}

// ===== Policy Rules =====
interface PolicyRule {
  id:          string;
  description: string;
  severity:    'critical' | 'high' | 'medium';
  test:        (code: string) => string | null;  // returns evidence string or null if clean
}

const POLICY_RULES: PolicyRule[] = [

  // ── CRITICAL: Malware Patterns ──────────────────────────────────
  {
    id: 'POL001', severity: 'critical',
    description: 'كود يحذف ملفات النظام أو يمسح البيانات',
    test: code => {
      const patterns = [
        /(?:shutil\.rmtree|os\.remove|os\.unlink)\s*\(\s*['"]\/(?:etc|sys|bin|boot|usr|root)/i,
        /subprocess.*(?:rm\s+-rf\s+\/|del\s+\/[sqf]+\s+[A-Z]:\\)/i,
        /format\s*(?:c:|\/dev\/)/i,
        /os\.system\s*\(\s*['"](?:rm|del|format)/i,
      ];
      for (const p of patterns) {
        const m = code.match(p);
        if (m) return m[0].substring(0, 80);
      }
      return null;
    },
  },

  {
    id: 'POL002', severity: 'critical',
    description: 'محاولة سرقة بيانات المستخدم أو كلمات المرور',
    test: code => {
      const patterns = [
        /(?:keylog|keystroke|screenshot.*send|capture.*password)/i,
        /(?:getpass|input).*(?:send|upload|post|requests\.)/i,
        /open\s*\(\s*['"](?:\/etc\/(?:passwd|shadow)|.*\.(?:kdbx|keychain))/i,
        /(?:steal|harvest|exfiltrate|leak).*(?:password|credential|token|key)/i,
      ];
      for (const p of patterns) {
        const m = code.match(p);
        if (m) return m[0].substring(0, 80);
      }
      return null;
    },
  },

  {
    id: 'POL003', severity: 'critical',
    description: 'برمجية خبيثة: ransomware أو تشفير ملفات المستخدم',
    test: code => {
      const patterns = [
        /(?:encrypt|AES|Fernet).*(?:walk|glob|rglob).*\.(?:doc|pdf|jpg|png|txt)/i,
        /for.*(?:file|path).*(?:encrypt|cipher|lock)/i,
        /ransom|cryptolocker|wannacry/i,
      ];
      for (const p of patterns) {
        const m = code.match(p);
        if (m) return m[0].substring(0, 80);
      }
      return null;
    },
  },

  {
    id: 'POL004', severity: 'critical',
    description: 'أدوات اختراق أو هجمات: port scanner, brute force, exploit',
    test: code => {
      const patterns = [
        /(?:brute.?force|password.?spray|credential.?stuff)/i,
        /for.*port.*socket\.connect.*except/i,
        /(?:reverse.?shell|bind.?shell|nc\s+-e|netcat.*-e)/i,
        /(?:metasploit|meterpreter|cobalt.?strike|mimikatz)/i,
        /(?:sql.?inject|xss.?payload|buffer.?overflow)/i,
      ];
      for (const p of patterns) {
        const m = code.match(p);
        if (m) return m[0].substring(0, 80);
      }
      return null;
    },
  },

  {
    id: 'POL005', severity: 'critical',
    description: 'إخفاء كود (Obfuscation): base64 + exec أو eval مشفر',
    test: code => {
      const patterns = [
        /exec\s*\(\s*(?:base64|b64|decode|decompress)/i,
        /eval\s*\(\s*(?:base64|b64|__import__|compile)/i,
        /(?:base64\.b64decode|binascii\.unhexlify).*exec/i,
        /(?:zlib\.decompress|gzip\.decompress).*exec/i,
        /chr\(\d+\)\s*\+\s*chr\(\d+\)/,   // chr(x)+chr(y) obfuscation
      ];
      for (const p of patterns) {
        const m = code.match(p);
        if (m) return m[0].substring(0, 80);
      }
      return null;
    },
  },

  {
    id: 'POL006', severity: 'critical',
    description: 'تجاوز صلاحيات النظام أو privilege escalation',
    test: code => {
      const patterns = [
        /(?:setuid|setgid|chmod\s*(?:777|4755)|chown\s+root)/i,
        /(?:sudo|runas|elevate).*(?:silent|quiet|-y|-yes)/i,
        /ctypes.*(?:windll|kernel32|advapi32).*(?:privilege|token|admin)/i,
      ];
      for (const p of patterns) {
        const m = code.match(p);
        if (m) return m[0].substring(0, 80);
      }
      return null;
    },
  },

  // ── HIGH: Suspicious Patterns ────────────────────────────────────
  {
    id: 'POL007', severity: 'high',
    description: 'تحميل وتشغيل ملفات من الإنترنت مباشرةً',
    test: code => {
      const patterns = [
        /(?:urllib|requests|wget).*(?:download|get).*exec/i,
        /(?:download|fetch).*(?:\.exe|\.sh|\.bat|\.ps1).*(?:run|execute|system)/i,
        /requests\.get.*\.content.*open.*\.exe/i,
      ];
      for (const p of patterns) {
        const m = code.match(p);
        if (m) return m[0].substring(0, 80);
      }
      return null;
    },
  },

  {
    id: 'POL008', severity: 'high',
    description: 'إرسال بيانات خارجية بشكل مخفي (data exfiltration)',
    test: code => {
      const patterns = [
        /requests\.(post|put).*(?:password|key|secret|token|credential)/i,
        /socket\.connect.*(?:send|sendall).*(?:os\.environ|getpass|input)/i,
        /(?:smtp|ftp|curl).*(?:secret|password|credential)/i,
      ];
      for (const p of patterns) {
        const m = code.match(p);
        if (m) return m[0].substring(0, 80);
      }
      return null;
    },
  },

  {
    id: 'POL009', severity: 'high',
    description: 'تعديل ملفات النظام أو السجل (Registry)',
    test: code => {
      const patterns = [
        /winreg.*(?:HKEY_LOCAL_MACHINE|HKLM).*(?:SetValue|CreateKey)/i,
        /open\s*\(\s*['"]\/etc\/(?:hosts|crontab|sudoers|rc\.)/i,
        /(?:crontab|at\s+|schtasks).*(?:add|create|modify)/i,
      ];
      for (const p of patterns) {
        const m = code.match(p);
        if (m) return m[0].substring(0, 80);
      }
      return null;
    },
  },

  {
    id: 'POL010', severity: 'high',
    description: 'أوامر نظام خطيرة بدون context واضح',
    test: code => {
      const dangerous = ['dd if=', 'mkfs.', ':(){:|:&};:', '> /dev/sd', 'fork bomb'];
      for (const d of dangerous) {
        if (code.toLowerCase().includes(d.toLowerCase()))
          return `Found: ${d}`;
      }
      return null;
    },
  },

  // ── MEDIUM: Best Practice Violations ────────────────────────────
  {
    id: 'POL011', severity: 'medium',
    description: 'اتصال شبكي بدون timeout أو error handling',
    test: code => {
      if (/requests\.(get|post|put|delete)\s*\(/.test(code) &&
          !/timeout\s*=/.test(code)) {
        return 'requests call without timeout';
      }
      return null;
    },
  },

  {
    id: 'POL012', severity: 'medium',
    description: 'استخدام __import__ أو importlib ديناميكياً — قد يكون خطراً',
    test: code => {
      const m = code.match(/__import__\s*\(|importlib\.import_module\s*\([^'"]/);
      return m ? m[0].substring(0, 60) : null;
    },
  },
];

// ===== Main Policy Check =====
export function checkPolicy(code: string): PolicyResult {
  const violations: PolicyViolation[] = [];

  for (const rule of POLICY_RULES) {
    const evidence = rule.test(code);
    if (evidence) {
      violations.push({
        rule:        rule.id,
        description: rule.description,
        severity:    rule.severity,
        evidence,
      });
    }
  }

  // Calculate risk score
  let riskScore = 0;
  for (const v of violations) {
    if (v.severity === 'critical') riskScore += 40;
    else if (v.severity === 'high') riskScore += 20;
    else riskScore += 8;
  }
  riskScore = Math.min(100, riskScore);

  // Determine verdict
  const hasCritical = violations.some(v => v.severity === 'critical');
  const hasHigh     = violations.some(v => v.severity === 'high');

  let verdict: PolicyVerdict = 'allowed';
  if (hasCritical) verdict = 'blocked';
  else if (hasHigh || violations.length >= 2) verdict = 'warning';

  const summary = verdict === 'blocked'
    ? `مرفوض: ${violations.filter(v => v.severity === 'critical').length} انتهاك حرج`
    : verdict === 'warning'
    ? `تحذير: ${violations.length} مشكلة تحتاج مراجعة`
    : 'نظيف: لا انتهاكات للسياسة';

  return { verdict, violations, riskScore, summary };
}
