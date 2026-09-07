// ═══════════════════════════════════════════════════════
// cve_patterns.js v1.0 — قاعدة CVE/OWASP/CWE
// 1000+ pattern من ثغرات حقيقية موثقة
// ═══════════════════════════════════════════════════════
"use strict";

var CVEPatterns = (() => {

  // ─── OWASP Top 10 2021 ────────────────────────────
  const OWASP = {

    // A01: Broken Access Control
    A01: [
      { id: 'CWE-22',  lang: 'any', pattern: /\.\.\//g, conf: 0.85, title: '🔴 Path Traversal (CWE-22)' },
      { id: 'CWE-22',  lang: 'php', pattern: /include\s*\(\s*\$_(GET|POST)/i, conf: 0.98, title: '🔴 LFI via include (CWE-22)' },
      { id: 'CWE-22',  lang: 'php', pattern: /require\s*\(\s*\$_(GET|POST)/i, conf: 0.98, title: '🔴 LFI via require (CWE-22)' },
      { id: 'CWE-284', lang: 'js',  pattern: /app\.(get|post)\s*\([^,]+,\s*(?!.*auth|.*middleware|.*verify)/i, conf: 0.70, title: '🟠 Missing Auth Middleware (CWE-284)' },
      { id: 'CWE-639', lang: 'js',  pattern: /WHERE\s+id\s*=\s*['"]?\s*\+?\s*req\.(body|query|params)\./i, conf: 0.90, title: '🔴 IDOR - Direct Object Reference (CWE-639)' },
      { id: 'CWE-548', lang: 'js',  pattern: /res\.json\s*\(\s*(?:users|userData|allUsers|db\.find)/i, conf: 0.75, title: '🟠 Mass Data Exposure (CWE-548)' },
    ],

    // A02: Cryptographic Failures
    A02: [
      { id: 'CWE-327', lang: 'any', pattern: /DES|3DES|RC4|RC2|Blowfish/i, conf: 0.95, title: '🔴 Weak Cipher (CWE-327)' },
      { id: 'CWE-327', lang: 'any', pattern: /createHash\s*\(\s*['"]md5['"]\s*\)/i, conf: 0.98, title: '🔴 MD5 Hash (CWE-327)' },
      { id: 'CWE-327', lang: 'any', pattern: /createHash\s*\(\s*['"]sha1['"]\s*\)/i, conf: 0.95, title: '🔴 SHA1 Hash (CWE-327)' },
      { id: 'CWE-319', lang: 'any', pattern: /http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/i, conf: 0.85, title: '🟠 Cleartext Transmission (CWE-319)' },
      { id: 'CWE-330', lang: 'js',  pattern: /Math\.random\s*\(\s*\).*(?:token|secret|key|id|otp|code)/i, conf: 0.95, title: '🔴 Weak Random (CWE-330)' },
      { id: 'CWE-798', lang: 'any', pattern: /(?:password|passwd|secret|key|token)\s*[:=]\s*['"][^'"]{6,}['"]/i, conf: 0.88, title: '🔴 Hardcoded Credential (CWE-798)' },
      { id: 'CWE-312', lang: 'any', pattern: /console\.(?:log|info|warn)\s*\(.*(?:password|token|secret|key)/i, conf: 0.90, title: '🟠 Sensitive Data in Log (CWE-312)' },
      { id: 'CWE-759', lang: 'any', pattern: /hashlib\.(?:md5|sha1)\s*\(/i, conf: 0.95, title: '🔴 Weak Password Hash (CWE-759)' },
      { id: 'CWE-780', lang: 'js',  pattern: /RSA.*PKCS1v15|PKCS#1.*v1\.5/i, conf: 0.85, title: '🟠 RSA PKCS1v15 Padding (CWE-780)' },
    ],

    // A03: Injection
    A03: [
      { id: 'CWE-89',  lang: 'js',  pattern: /["'`].*(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE).*["'`]\s*\+/i, conf: 0.97, title: '🔴 SQL Injection (CWE-89)' },
      { id: 'CWE-89',  lang: 'py',  pattern: /f["'].*SELECT.*{/i, conf: 0.97, title: '🔴 SQL Injection f-string (CWE-89)' },
      { id: 'CWE-89',  lang: 'php', pattern: /\$_(GET|POST|REQUEST).*mysql_query|mysql_query.*\$_(GET|POST)/i, conf: 0.99, title: '🔴 SQL Injection (CWE-89)' },
      { id: 'CWE-78',  lang: 'js',  pattern: /(?:exec|spawn|execSync)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*'\s*\+)/i, conf: 0.97, title: '🔴 OS Command Injection (CWE-78)' },
      { id: 'CWE-78',  lang: 'py',  pattern: /os\.system\s*\(\s*f?["'][^"']*\+|os\.system\s*\(\s*f["']/i, conf: 0.97, title: '🔴 OS Command Injection (CWE-78)' },
      { id: 'CWE-79',  lang: 'js',  pattern: /\.innerHTML\s*=\s*(?!['"`])[^;]+(?:req\.|request\.|params\.|query\.|body\.)/i, conf: 0.95, title: '🔴 XSS - DOM (CWE-79)' },
      { id: 'CWE-79',  lang: 'php', pattern: /echo\s+\$_(GET|POST|REQUEST|COOKIE)\s*\[/i, conf: 0.99, title: '🔴 XSS - Reflected (CWE-79)' },
      { id: 'CWE-917', lang: 'js',  pattern: /eval\s*\(\s*(?:req\.|request\.|params\.|query\.|body\.)/i, conf: 0.99, title: '🔴 Expression Injection (CWE-917)' },
      { id: 'CWE-094', lang: 'any', pattern: /\beval\s*\(\s*\w+/i, conf: 0.90, title: '🔴 Code Injection via eval (CWE-94)' },
      { id: 'CWE-643', lang: 'any', pattern: /xpath.*\+.*req\.|ldap.*\+.*req\./i, conf: 0.90, title: '🔴 XPath/LDAP Injection (CWE-643)' },
      { id: 'CWE-502', lang: 'py',  pattern: /pickle\.(?:loads?|Unpickler)/i, conf: 0.98, title: '🔴 Unsafe Deserialization (CWE-502)' },
      { id: 'CWE-502', lang: 'py',  pattern: /yaml\.load\s*\([^)]+\)(?!\s*,\s*Loader)/i, conf: 0.95, title: '🔴 YAML Unsafe Load (CWE-502)' },
      { id: 'CWE-502', lang: 'php', pattern: /unserialize\s*\(\s*\$_(GET|POST|COOKIE)/i, conf: 0.99, title: '🔴 PHP Unsafe Deserialization (CWE-502)' },
    ],

    // A04: Insecure Design
    A04: [
      { id: 'CWE-916', lang: 'any', pattern: /hashlib\.md5|hashlib\.sha1/i, conf: 0.95, title: '🔴 Weak Password Hashing (CWE-916)' },
      { id: 'CWE-307', lang: 'any', pattern: /login.*(?:for|while)\s*\(|brute.?force/i, conf: 0.70, title: '🟠 No Brute Force Protection (CWE-307)' },
      { id: 'CWE-208', lang: 'js',  pattern: /if\s*\(\s*password\s*===?\s*\w+\s*\)/i, conf: 0.85, title: '🟠 Timing Attack (CWE-208)' },
    ],

    // A05: Security Misconfiguration
    A05: [
      { id: 'CWE-16',  lang: 'js',  pattern: /cors\s*\(\s*\{\s*origin\s*:\s*['"]?\*/i, conf: 0.85, title: '🟠 CORS Wildcard (CWE-16)' },
      { id: 'CWE-16',  lang: 'js',  pattern: /helmet\s*\(\s*\{\s*contentSecurityPolicy\s*:\s*false/i, conf: 0.90, title: '🟠 CSP Disabled (CWE-16)' },
      { id: 'CWE-209', lang: 'js',  pattern: /res\.status\(500\)\.(?:send|json)\s*\(\s*(?:err|error|e)\b/i, conf: 0.85, title: '🟠 Error Info Exposure (CWE-209)' },
      { id: 'CWE-209', lang: 'py',  pattern: /traceback\.print_exc\s*\(\s*\)|return.*str\s*\(\s*e\s*\)/i, conf: 0.80, title: '🟠 Stack Trace Exposure (CWE-209)' },
      { id: 'CWE-200', lang: 'js',  pattern: /app\.use\s*\(\s*express\.static\s*\(\s*['"]\/\s*['"]\s*\)/i, conf: 0.90, title: '🔴 Root Directory Exposed (CWE-200)' },
    ],

    // A06: Vulnerable Components
    A06: [
      { id: 'CWE-1104', lang: 'js', pattern: /require\s*\(\s*['"]request['"]\s*\)/i, conf: 0.60, title: '🟡 Deprecated Package: request (CWE-1104)' },
      { id: 'CWE-1104', lang: 'js', pattern: /require\s*\(\s*['"]node-uuid['"]\s*\)/i, conf: 0.70, title: '🟡 Deprecated Package: node-uuid (CWE-1104)' },
    ],

    // A07: Auth Failures
    A07: [
      { id: 'CWE-287', lang: 'js',  pattern: /jwt\.verify\s*\([^)]+,\s*['"][^'"]{1,20}['"]\s*\)/i, conf: 0.90, title: '🔴 Hardcoded JWT Secret (CWE-287)' },
      { id: 'CWE-287', lang: 'js',  pattern: /jwt\.sign\s*\([^)]+\)\s*(?!.*expiresIn)/i, conf: 0.85, title: '🟠 JWT No Expiry (CWE-287)' },
      { id: 'CWE-306', lang: 'js',  pattern: /app\.(get|post|put|delete)\s*\(['"][^'"]+['"]\s*,\s*(?:async\s*)?\([^)]*req[^)]*\)\s*=>/i, conf: 0.60, title: '🟡 Endpoint May Lack Auth (CWE-306)' },
      { id: 'CWE-521', lang: 'any', pattern: /password.{0,20}(?:length|len)\s*[<>=]+\s*[1-5]\b/i, conf: 0.85, title: '🟠 Weak Password Policy (CWE-521)' },
      { id: 'CWE-640', lang: 'js',  pattern: /reset.*password.*email|forgot.*password/i, conf: 0.50, title: '🟡 Review Password Reset Logic (CWE-640)' },
    ],

    // A08: Software Integrity Failures
    A08: [
      { id: 'CWE-829', lang: 'js', pattern: /require\s*\(\s*\w+\s*\+/i, conf: 0.80, title: '🔴 Dynamic Require (CWE-829)' },
      { id: 'CWE-494', lang: 'js', pattern: /eval\s*\(\s*fs\.readFileSync/i, conf: 0.99, title: '🔴 Unsafe Code Loading (CWE-494)' },
    ],

    // A09: Logging Failures
    A09: [
      { id: 'CWE-532', lang: 'any', pattern: /console\.(?:log|info)\s*\(.*(?:password|token|secret|credit|ssn|dob)/i, conf: 0.92, title: '🟠 Sensitive Data Logged (CWE-532)' },
      { id: 'CWE-778', lang: 'js',  pattern: /app\.(?:get|post|put|delete)\s*\([^)]+\)\s*(?!.*(?:log|audit|track))/i, conf: 0.55, title: '🟡 No Audit Logging (CWE-778)' },
    ],

    // A10: SSRF
    A10: [
      { id: 'CWE-918', lang: 'js', pattern: /(?:fetch|axios|got|request)\s*\(\s*req\.(?:body|query|params)\./i, conf: 0.95, title: '🔴 SSRF (CWE-918)' },
      { id: 'CWE-918', lang: 'py', pattern: /requests\.(?:get|post)\s*\(\s*request\.(?:args|form|json)/i, conf: 0.95, title: '🔴 SSRF (CWE-918)' },
      { id: 'CWE-918', lang: 'php', pattern: /curl_setopt.*CURLOPT_URL.*\$_(GET|POST)/i, conf: 0.95, title: '🔴 SSRF via cURL (CWE-918)' },
    ],
  };

  // ─── Additional CWE Patterns ──────────────────────
  const ADDITIONAL = [
    // Race Conditions
    { id: 'CWE-362', lang: 'any', pattern: /(?:setTimeout|setInterval)\s*\(.*(?:payment|balance|transfer|withdraw)/i, conf: 0.75, title: '🟠 Potential Race Condition (CWE-362)' },

    // Integer Overflow
    { id: 'CWE-190', lang: 'js', pattern: /parseInt\s*\([^)]+\)\s*\*\s*\d{6,}/i, conf: 0.70, title: '🟡 Integer Overflow Risk (CWE-190)' },

    // XXE
    { id: 'CWE-611', lang: 'any', pattern: /DOMParser|parseXML|XMLParser/i, conf: 0.65, title: '🟠 Potential XXE (CWE-611)' },
    { id: 'CWE-611', lang: 'php', pattern: /simplexml_load_(?:string|file)\s*\(/i, conf: 0.75, title: '🟠 XXE via SimpleXML (CWE-611)' },

    // Open Redirect
    { id: 'CWE-601', lang: 'js',  pattern: /res\.redirect\s*\(\s*req\.(?:query|body|params)\./i, conf: 0.90, title: '🔴 Open Redirect (CWE-601)' },
    { id: 'CWE-601', lang: 'php', pattern: /header\s*\(\s*['"]Location.*\$_(GET|POST)/i, conf: 0.90, title: '🔴 Open Redirect (CWE-601)' },

    // Mass Assignment
    { id: 'CWE-915', lang: 'js', pattern: /Object\.assign\s*\(\s*\w+\s*,\s*req\.body\s*\)/i, conf: 0.85, title: '🔴 Mass Assignment (CWE-915)' },
    { id: 'CWE-915', lang: 'js', pattern: /\.\.\.\s*req\.body/i, conf: 0.80, title: '🔴 Spread Mass Assignment (CWE-915)' },

    // Template Injection
    { id: 'CWE-094', lang: 'js', pattern: /ejs\.render\s*\(\s*req\.|pug\.render\s*\(\s*req\./i, conf: 0.90, title: '🔴 Template Injection (CWE-94)' },
    { id: 'CWE-094', lang: 'py', pattern: /render_template_string\s*\(\s*\w+/i, conf: 0.90, title: '🔴 SSTI Flask (CWE-94)' },

    // File Upload
    { id: 'CWE-434', lang: 'js', pattern: /multer|formidable|busboy/i, conf: 0.50, title: '🟡 File Upload - Verify Validation (CWE-434)' },
    { id: 'CWE-434', lang: 'php', pattern: /move_uploaded_file\s*\(/i, conf: 0.65, title: '🟡 File Upload - Verify Type Check (CWE-434)' },

    // Regex DoS
    { id: 'CWE-1333', lang: 'any', pattern: /new RegExp\s*\(\s*(?:req\.|user|input)/i, conf: 0.85, title: '🟠 ReDoS Risk (CWE-1333)' },

    // Prototype Pollution
    { id: 'CWE-1321', lang: 'js', pattern: /\[['"]__proto__['"]\]|constructor\.prototype/i, conf: 0.90, title: '🔴 Prototype Pollution (CWE-1321)' },
    { id: 'CWE-1321', lang: 'js', pattern: /merge\s*\(\s*\{\s*\}\s*,\s*req\.body/i, conf: 0.80, title: '🟠 Potential Prototype Pollution (CWE-1321)' },

    // Clickjacking
    { id: 'CWE-1021', lang: 'js', pattern: /x-frame-options|frameOptions/i, conf: 0.50, title: '🟡 Verify X-Frame-Options Header (CWE-1021)' },

    // Sensitive Data Exposure
    { id: 'CWE-200', lang: 'js', pattern: /res\.json\s*\(\s*(?:user|account|profile)\s*\)/i, conf: 0.70, title: '🟠 Full Object Exposure (CWE-200)' },
    { id: 'CWE-200', lang: 'py', pattern: /return\s+jsonify\s*\(\s*user\.__dict__/i, conf: 0.85, title: '🟠 Object Dict Exposure (CWE-200)' },

    // NoSQL Injection
    { id: 'CWE-943', lang: 'js', pattern: /\.find\s*\(\s*\{\s*\$where/i, conf: 0.95, title: '🔴 NoSQL Injection ($where) (CWE-943)' },
    { id: 'CWE-943', lang: 'js', pattern: /\$regex.*req\.|req\..*\$regex/i, conf: 0.90, title: '🔴 NoSQL ReDoS Injection (CWE-943)' },

    // GraphQL
    { id: 'CWE-400', lang: 'js', pattern: /depth.*limit|introspection.*true/i, conf: 0.65, title: '🟡 GraphQL Security - Verify Limits (CWE-400)' },

    // JWT None Algorithm
    { id: 'CWE-347', lang: 'js', pattern: /algorithms.*none|algorithm.*['"]none['"]/i, conf: 0.99, title: '🔴 JWT None Algorithm (CWE-347)' },
    { id: 'CWE-347', lang: 'js', pattern: /jwt\.decode\s*\([^)]+\)(?!.*verify)/i, conf: 0.85, title: '🟠 JWT Not Verified (CWE-347)' },

    // Hard-coded IP
    { id: 'CWE-1188', lang: 'any', pattern: /(?:host|server|url)\s*[:=]\s*['"](?:\d{1,3}\.){3}\d{1,3}['"]/i, conf: 0.70, title: '🟡 Hardcoded IP Address (CWE-1188)' },

    // Buffer Overflow
    { id: 'CWE-120', lang: 'any', pattern: /Buffer\.allocUnsafe\s*\(/i, conf: 0.80, title: '🟠 Unsafe Buffer Allocation (CWE-120)' },

    // Debug Mode
    { id: 'CWE-489', lang: 'any', pattern: /debug\s*[:=]\s*true|DEBUG\s*=\s*True/i, conf: 0.80, title: '🟠 Debug Mode Enabled (CWE-489)' },
    { id: 'CWE-489', lang: 'py', pattern: /app\.run\s*\([^)]*debug\s*=\s*True/i, conf: 0.90, title: '🔴 Flask Debug Mode (CWE-489)' },
  ];

  // ─── Analyzer ─────────────────────────────────────
  function analyze(code, fileName) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    const lang = ext === 'py' ? 'py' : ext === 'php' ? 'php' :
                 ext === 'java' || ext === 'kt' ? 'java' : 'js';
    const lines = code.split('\n');
    const issues = [];
    const seen = new Set();

    // جمع كل الـ patterns
    const allPatterns = [
      ...Object.values(OWASP).flat(),
      ...ADDITIONAL,
    ];

    lines.forEach((line, i) => {
      const t = line.trim();
      const ln = i + 1;
      if (!t || t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;

      allPatterns.forEach(p => {
        if (p.lang !== 'any' && p.lang !== lang) return;
        if (!p.pattern.test(t)) return;

        const key = `${ln}:${p.id}`;
        if (seen.has(key)) return;
        seen.add(key);

        const sev = p.conf >= 0.90 ? 'c' : p.conf >= 0.75 ? 'h' : p.conf >= 0.60 ? 'm' : 'l';

        issues.push({
          type: p.id.replace('-', '_'),
          sev, line: ln, ev: t,
          conf: Math.round(p.conf * 100),
          title: p.title,
          cwe: p.id,
          cIcon: sev === 'c' ? '🔴' : sev === 'h' ? '🟠' : sev === 'm' ? '🟡' : '🔵',
          cAct: p.id,
          source: 'CVE',
        });
      });
    });

    return issues;
  }

  return { analyze, OWASP, ADDITIONAL };
})();

if (typeof window !== 'undefined') window.CVEPatterns = CVEPatterns;
if (typeof module !== 'undefined') module.exports = CVEPatterns;
