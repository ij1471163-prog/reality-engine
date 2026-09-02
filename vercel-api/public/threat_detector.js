// ═══════════════════════════════════════════════════════
// threat_detector.js — OWASP Threat Classification
// يصنف التهديدات بمعايير احترافية
// ═══════════════════════════════════════════════════════

const OWASP_MAP = {
  SQL_INJECTION: {
    owasp:       'OWASP A03:2021 - Injection',
    cwe:         'CWE-89',
    cvss:        9.8,
    risk:        'CRITICAL',
    impact:      'يسمح للمهاجم بقراءة أو تعديل أو حذف قاعدة البيانات بالكامل',
    remediation: 'استخدم Prepared Statements وParamterized Queries',
    reference:   'https://owasp.org/Top10/A03_2021-Injection/',
  },
  XSS: {
    owasp:       'OWASP A03:2021 - Injection (XSS)',
    cwe:         'CWE-79',
    cvss:        7.2,
    risk:        'HIGH',
    impact:      'يسمح بتنفيذ سكريبت في متصفح الضحية وسرقة الـ cookies',
    remediation: 'استخدم textContent وsanitize كل input',
    reference:   'https://owasp.org/www-community/attacks/xss/',
  },
  HARDCODED_SECRET: {
    owasp:       'OWASP A02:2021 - Cryptographic Failures',
    cwe:         'CWE-798',
    cvss:        9.1,
    risk:        'CRITICAL',
    impact:      'يكشف credentials للمهاجمين عبر الـ source code',
    remediation: 'استخدم Environment Variables وSecret Managers',
    reference:   'https://owasp.org/Top10/A02_2021-Cryptographic_Failures/',
  },
  EVAL_USAGE: {
    owasp:       'OWASP A03:2021 - Injection (Code Injection)',
    cwe:         'CWE-94',
    cvss:        9.8,
    risk:        'CRITICAL',
    impact:      'يسمح بتنفيذ كود عشوائي على السيرفر',
    remediation: 'احذف eval() واستخدم JSON.parse أو بدائل آمنة',
    reference:   'https://owasp.org/www-community/attacks/Code_Injection',
  },
  WEAK_CRYPTO: {
    owasp:       'OWASP A02:2021 - Cryptographic Failures',
    cwe:         'CWE-327',
    cvss:        7.5,
    risk:        'HIGH',
    impact:      'يمكن للمهاجم كسر التشفير واستعادة البيانات',
    remediation: 'استخدم AES-256-GCM أو ChaCha20-Poly1305',
    reference:   'https://owasp.org/Top10/A02_2021-Cryptographic_Failures/',
  },
  INSECURE_RANDOM: {
    owasp:       'OWASP A02:2021 - Cryptographic Failures',
    cwe:         'CWE-338',
    cvss:        7.3,
    risk:        'HIGH',
    impact:      'يمكن للمهاجم التنبؤ بالـ tokens وانتحال الهوية',
    remediation: 'استخدم crypto.randomBytes() أو SecureRandom()',
    reference:   'https://cwe.mitre.org/data/definitions/338.html',
  },
  SSL_DISABLED: {
    owasp:       'OWASP A02:2021 - Cryptographic Failures',
    cwe:         'CWE-295',
    cvss:        8.1,
    risk:        'CRITICAL',
    impact:      'يفتح الباب لـ Man-in-the-Middle attacks',
    remediation: 'لا تعطل SSL verification أبداً في production',
    reference:   'https://cwe.mitre.org/data/definitions/295.html',
  },
  CMD_INJECTION: {
    owasp:       'OWASP A03:2021 - Injection',
    cwe:         'CWE-78',
    cvss:        9.8,
    risk:        'CRITICAL',
    impact:      'يسمح بتنفيذ أوامر shell على السيرفر',
    remediation: 'استخدم قائمة arguments بدل string concatenation',
    reference:   'https://owasp.org/www-community/attacks/Command_Injection',
  },
  LOG_SENSITIVE: {
    owasp:       'OWASP A09:2021 - Security Logging and Monitoring Failures',
    cwe:         'CWE-532',
    cvss:        5.3,
    risk:        'MEDIUM',
    impact:      'تسرب بيانات حساسة في ملفات الـ logs',
    remediation: 'لا تسجّل passwords أو tokens في الـ logs',
    reference:   'https://owasp.org/Top10/A09_2021-Security_Logging_and_Monitoring_Failures/',
  },
  HTTP_USAGE: {
    owasp:       'OWASP A02:2021 - Cryptographic Failures',
    cwe:         'CWE-319',
    cvss:        6.5,
    risk:        'MEDIUM',
    impact:      'إرسال البيانات بدون تشفير يعرضها للاعتراض',
    remediation: 'استخدم HTTPS دائماً',
    reference:   'https://cwe.mitre.org/data/definitions/319.html',
  },
  EMPTY_CATCH: {
    owasp:       'OWASP A09:2021 - Security Logging and Monitoring Failures',
    cwe:         'CWE-390',
    cvss:        4.3,
    risk:        'MEDIUM',
    impact:      'إخفاء الأخطاء يمنع اكتشاف الهجمات',
    remediation: 'أضف logging مناسب في كل catch block',
    reference:   'https://cwe.mitre.org/data/definitions/390.html',
  },
  PATH_TRAVERSAL: {
    owasp:       'OWASP A01:2021 - Broken Access Control',
    cwe:         'CWE-22',
    cvss:        8.8,
    risk:        'HIGH',
    impact:      'يسمح بالوصول لملفات خارج المسار المسموح',
    remediation: 'sanitize كل file paths وتحقق من الحدود',
    reference:   'https://owasp.org/www-community/attacks/Path_Traversal',
  },
};

// ─── Main Function ────────────────────────────────────

function detectThreats(code, fileName, existingIssues) {
  const issues = existingIssues || [];
  const lines  = code.split('\n');
  const threats = [];

  // ─── كشف إضافي غير موجود في المحللات الأخرى ──────────

  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('#')) return;
    const ln = i + 1;

    // Path Traversal
    if (/readFile|writeFile|readdir|open\(/i.test(t) && /\+\s*\w+|req\.|input/i.test(t)) {
      threats.push({
        line: ln, ev: t,
        threatType: 'PATH_TRAVERSAL',
        title: '🔴 Path Traversal محتمل',
        sev: 'h',
      });
    }

    // Mass Assignment
    if (/Object\.assign\(|\.\.\.req\.body|\.\.\.req\.query/i.test(t)) {
      threats.push({
        line: ln, ev: t,
        threatType: 'MASS_ASSIGNMENT',
        title: '🟠 Mass Assignment محتمل',
        sev: 'h',
        owasp: 'OWASP A08:2021 - Software and Data Integrity Failures',
        cwe: 'CWE-915', cvss: 8.1, risk: 'HIGH',
        impact: 'يسمح للمهاجم بتعديل حقول غير مسموح بها',
        remediation: 'استخدم allowlist للحقول المسموح بها',
      });
    }

    // SSRF
    if (/fetch\(|axios\.|request\(|http\.get/i.test(t) && /req\.|user|input|param/i.test(t)) {
      threats.push({
        line: ln, ev: t,
        threatType: 'SSRF',
        title: '🟠 SSRF محتمل',
        sev: 'h',
        owasp: 'OWASP A10:2021 - Server-Side Request Forgery',
        cwe: 'CWE-918', cvss: 8.6, risk: 'HIGH',
        impact: 'يسمح للمهاجم بإرسال طلبات من السيرفر لشبكات داخلية',
        remediation: 'تحقق وsanitize كل URLs خارجية',
      });
    }

    // Regex DoS (ReDoS)
    if (/new RegExp\(.*\+|new RegExp\(.*req\./i.test(t)) {
      threats.push({
        line: ln, ev: t,
        threatType: 'REDOS',
        title: '🟡 ReDoS محتمل',
        sev: 'm',
        owasp: 'OWASP A06:2021 - Vulnerable and Outdated Components',
        cwe: 'CWE-1333', cvss: 5.9, risk: 'MEDIUM',
        impact: 'يمكن تعطيل السيرفر بـ malicious regex input',
        remediation: 'لا تبني Regex من input المستخدم',
      });
    }
  });

  // ─── دمج مع الأخطاء الموجودة وإضافة OWASP info ───────

  const enriched = [...issues].map(issue => {
    const owaspKey = mapIssueToOWASP(issue);
    const owaspInfo = OWASP_MAP[owaspKey];
    if (!owaspInfo) return { ...issue, threatClassified: false };
    return {
      ...issue,
      threatClassified: true,
      owasp:       owaspInfo.owasp,
      cwe:         owaspInfo.cwe,
      cvss:        owaspInfo.cvss,
      risk:        owaspInfo.risk,
      impact:      owaspInfo.impact,
      remediation: owaspInfo.remediation,
      reference:   owaspInfo.reference,
    };
  });

  // ─── أضف التهديدات الجديدة ───────────────────────────

  threats.forEach(t => {
    const owaspInfo = OWASP_MAP[t.threatType] || {};
    enriched.push({
      type: 'threat', ...t,
      threatClassified: true,
      owasp:       t.owasp || owaspInfo.owasp,
      cwe:         t.cwe || owaspInfo.cwe,
      cvss:        t.cvss || owaspInfo.cvss,
      risk:        t.risk || owaspInfo.risk,
      impact:      t.impact || owaspInfo.impact,
      remediation: t.remediation || owaspInfo.remediation,
      conf:        75, cIcon: '🟠', cAct: t.title,
      cEv:         [t.impact || owaspInfo.impact || ''],
    });
  });

  // ─── إحصائيات ─────────────────────────────────────────

  const classified = enriched.filter(i => i.threatClassified);
  const avgCvss = classified.length
    ? (classified.reduce((s, i) => s + (i.cvss || 0), 0) / classified.length).toFixed(1)
    : 0;

  return {
    threats:        enriched,
    newThreats:     threats.length,
    classified:     classified.length,
    avgCvss:        parseFloat(avgCvss),
    topThreat:      classified.sort((a,b) => (b.cvss||0)-(a.cvss||0))[0] || null,
  };
}

function mapIssueToOWASP(issue) {
  const t = (issue.title || '').toLowerCase();
  if (t.includes('sql'))                                    return 'SQL_INJECTION';
  if (t.includes('innerhtml') || t.includes('xss'))        return 'XSS';
  if (t.includes('مرور') || t.includes('مفتاح') || t.includes('مُضمَّن')) return 'HARDCODED_SECRET';
  if (t.includes('eval'))                                   return 'EVAL_USAGE';
  if (t.includes('md5') || t.includes('sha1') || t.includes('des')) return 'WEAK_CRYPTO';
  if (t.includes('random') && t.includes('token'))         return 'INSECURE_RANDOM';
  if (t.includes('ssl') || t.includes('rejectunauthorized')) return 'SSL_DISABLED';
  if (t.includes('command') || t.includes('exec'))         return 'CMD_INJECTION';
  if (t.includes('تسجيل') || t.includes('log'))           return 'LOG_SENSITIVE';
  if (t.includes('http'))                                   return 'HTTP_USAGE';
  if (t.includes('catch'))                                  return 'EMPTY_CATCH';
  return null;
}
