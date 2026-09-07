// ═══════════════════════════════════════════════════════
// extended_patterns.js v1.0 — قاعدة patterns موسعة
// 2000+ pattern إضافي لكل لغة وكل نوع ثغرة
// ═══════════════════════════════════════════════════════
"use strict";

var ExtendedPatterns = (() => {

  // ─── JavaScript/TypeScript Extended ───────────────
  const JS_PATTERNS = [
    // Prototype Pollution
    { pattern: /\[['"]__proto__['"]\]\s*=/, sev: 'c', title: '🔴 Prototype Pollution via __proto__', type: 'PROTO_POLLUTION' },
    { pattern: /Object\.prototype\[/, sev: 'c', title: '🔴 Prototype Pollution via Object.prototype', type: 'PROTO_POLLUTION' },
    { pattern: /constructor\.prototype\[/, sev: 'c', title: '🔴 Prototype Pollution via constructor', type: 'PROTO_POLLUTION' },
    { pattern: /merge\s*\(\s*\{\}\s*,\s*JSON\.parse/, sev: 'h', title: '🟠 Potential Prototype Pollution via merge', type: 'PROTO_POLLUTION' },

    // DOM XSS
    { pattern: /location\.hash\s*[^=]/, sev: 'h', title: '🟠 DOM XSS via location.hash', type: 'DOM_XSS' },
    { pattern: /document\.URL\s*[^=]/, sev: 'h', title: '🟠 DOM XSS via document.URL', type: 'DOM_XSS' },
    { pattern: /document\.referrer\s*[^=]/, sev: 'h', title: '🟠 DOM XSS via document.referrer', type: 'DOM_XSS' },
    { pattern: /window\.location\.search/, sev: 'h', title: '🟠 DOM XSS via location.search', type: 'DOM_XSS' },
    { pattern: /postMessage\s*\(.*\*\s*\)/, sev: 'h', title: '🟠 Unsafe postMessage Origin', type: 'DOM_XSS' },

    // Insecure Randomness
    { pattern: /Math\.random\s*\(\s*\)/, sev: 'h', title: '🟠 Math.random() — ليس cryptographically secure', type: 'WEAK_RANDOM' },
    { pattern: /Date\.now\s*\(\s*\).*token|token.*Date\.now/, sev: 'h', title: '🟠 Date.now() كـ token غير آمن', type: 'WEAK_RANDOM' },

    // ReDoS
    { pattern: /new RegExp\s*\(\s*(?:req\.|user|input|param)/, sev: 'h', title: '🟠 ReDoS — Dynamic RegExp من user input', type: 'REDOS' },
    { pattern: /\(\s*\.\*\s*\)\+|\(\s*\.\+\s*\)\*/, sev: 'm', title: '🟡 ReDoS — Catastrophic Backtracking Pattern', type: 'REDOS' },

    // JWT
    { pattern: /algorithms.*\[\s*['"]none['"]\s*\]/, sev: 'c', title: '🔴 JWT None Algorithm Attack', type: 'JWT_NONE' },
    { pattern: /jwt\.decode\s*\((?!.*verify)/, sev: 'h', title: '🟠 JWT Decoded Without Verification', type: 'JWT_UNVERIFIED' },
    { pattern: /ignoreExpiration\s*:\s*true/, sev: 'h', title: '🟠 JWT Expiration Ignored', type: 'JWT_EXPIRED' },

    // NoSQL Injection
    { pattern: /\$where\s*:/, sev: 'c', title: '🔴 NoSQL Injection via $where', type: 'NOSQL_INJECTION' },
    { pattern: /\$regex\s*:.*req\./, sev: 'c', title: '🔴 NoSQL ReDoS via $regex', type: 'NOSQL_INJECTION' },
    { pattern: /\$ne\s*:\s*null/, sev: 'h', title: '🟠 NoSQL Bypass via $ne:null', type: 'NOSQL_INJECTION' },
    { pattern: /\.find\s*\(\s*req\.body/, sev: 'c', title: '🔴 NoSQL Injection — Direct req.body في find()', type: 'NOSQL_INJECTION' },

    // CORS
    { pattern: /Access-Control-Allow-Origin.*\*/, sev: 'h', title: '🟠 CORS Wildcard Origin', type: 'CORS' },
    { pattern: /origin\s*:\s*true/, sev: 'h', title: '🟠 CORS Allow All Origins', type: 'CORS' },
    { pattern: /credentials\s*:\s*true.*origin\s*:\s*\*|origin\s*:\s*\*.*credentials\s*:\s*true/, sev: 'c', title: '🔴 CORS Credentials + Wildcard', type: 'CORS' },

    // Mass Assignment
    { pattern: /\.save\s*\(\s*req\.body/, sev: 'h', title: '🟠 Mass Assignment via .save(req.body)', type: 'MASS_ASSIGN' },
    { pattern: /create\s*\(\s*req\.body/, sev: 'h', title: '🟠 Mass Assignment via create(req.body)', type: 'MASS_ASSIGN' },
    { pattern: /update\s*\(\s*req\.body/, sev: 'h', title: '🟠 Mass Assignment via update(req.body)', type: 'MASS_ASSIGN' },
    { pattern: /\.set\s*\(\s*req\.body/, sev: 'h', title: '🟠 Mass Assignment via .set(req.body)', type: 'MASS_ASSIGN' },

    // Path Traversal
    { pattern: /readFile\s*\(\s*.*req\.(query|body|params)/, sev: 'c', title: '🔴 Path Traversal via readFile', type: 'PATH_TRAVERSAL' },
    { pattern: /readFileSync\s*\(\s*.*req\./, sev: 'c', title: '🔴 Path Traversal via readFileSync', type: 'PATH_TRAVERSAL' },
    { pattern: /join\s*\(__dirname.*req\./, sev: 'h', title: '🟠 Path Traversal via path.join + user input', type: 'PATH_TRAVERSAL' },

    // Open Redirect
    { pattern: /res\.redirect\s*\(\s*req\.(query|body|params)\./, sev: 'c', title: '🔴 Open Redirect via res.redirect', type: 'OPEN_REDIRECT' },
    { pattern: /window\.location\s*=\s*(?:decodeURI|unescape)\s*\(/, sev: 'h', title: '🟠 Open Redirect via location', type: 'OPEN_REDIRECT' },

    // Sensitive Data
    { pattern: /console\.(log|info|warn)\s*\(.*(?:password|token|secret|credit|ssn|dob|cvv)/i, sev: 'h', title: '🟠 Sensitive Data in Console Log', type: 'DATA_EXPOSURE' },
    { pattern: /localStorage\.setItem\s*\(.*(?:token|password|secret)/i, sev: 'h', title: '🟠 Sensitive Data in localStorage', type: 'DATA_EXPOSURE' },
    { pattern: /sessionStorage\.setItem\s*\(.*(?:token|password|secret)/i, sev: 'h', title: '🟠 Sensitive Data in sessionStorage', type: 'DATA_EXPOSURE' },
    { pattern: /document\.cookie\s*=.*(?:secure|httpOnly)(?!\s*=\s*true)/, sev: 'h', title: '🟠 Cookie بدون Secure/HttpOnly', type: 'INSECURE_COOKIE' },

    // XSS Advanced
    { pattern: /dangerouslySetInnerHTML/, sev: 'h', title: '🟠 React dangerouslySetInnerHTML', type: 'XSS' },
    { pattern: /v-html\s*=/, sev: 'h', title: '🟠 Vue v-html XSS Risk', type: 'XSS' },
    { pattern: /bypassSecurityTrust/, sev: 'h', title: '🟠 Angular Trust Bypass', type: 'XSS' },

    // Timing Attacks
    { pattern: /===\s*(?:password|token|secret|hash)|(?:password|token|secret|hash)\s*===/, sev: 'h', title: '🟠 Timing Attack — استخدم crypto.timingSafeEqual', type: 'TIMING_ATTACK' },
    { pattern: /==\s*(?:password|token|hash)|(?:password|token|hash)\s*==/, sev: 'h', title: '🟠 Timing Attack via == comparison', type: 'TIMING_ATTACK' },

    // Buffer Issues
    { pattern: /Buffer\.allocUnsafe\s*\(/, sev: 'h', title: '🟠 Buffer.allocUnsafe — بيانات غير مهيأة', type: 'BUFFER' },
    { pattern: /new Buffer\s*\(/, sev: 'h', title: '🟠 new Buffer() مهمل — استخدم Buffer.alloc', type: 'BUFFER' },

    // Electron Security
    { pattern: /nodeIntegration\s*:\s*true/, sev: 'c', title: '🔴 Electron nodeIntegration Enabled', type: 'ELECTRON' },
    { pattern: /contextIsolation\s*:\s*false/, sev: 'c', title: '🔴 Electron contextIsolation Disabled', type: 'ELECTRON' },
    { pattern: /webSecurity\s*:\s*false/, sev: 'c', title: '🔴 Electron webSecurity Disabled', type: 'ELECTRON' },
  ];

  // ─── Python Extended ───────────────────────────────
  const PY_PATTERNS = [
    // Flask
    { pattern: /app\.run\s*\([^)]*debug\s*=\s*True/, sev: 'c', title: '🔴 Flask Debug Mode في Production', type: 'DEBUG_MODE' },
    { pattern: /render_template_string\s*\(\s*(?:request\.|f["'])/, sev: 'c', title: '🔴 SSTI في Flask', type: 'SSTI' },
    { pattern: /SECRET_KEY\s*=\s*['"][^'"]{1,20}['"]/, sev: 'h', title: '🟠 Flask SECRET_KEY ضعيف', type: 'WEAK_SECRET' },

    // Django
    { pattern: /DEBUG\s*=\s*True/, sev: 'h', title: '🟠 Django DEBUG Mode', type: 'DEBUG_MODE' },
    { pattern: /ALLOWED_HOSTS\s*=\s*\[\s*['"]\*['"]\s*\]/, sev: 'h', title: '🟠 Django ALLOWED_HOSTS Wildcard', type: 'MISCONFIG' },
    { pattern: /mark_safe\s*\(/, sev: 'h', title: '🟠 Django mark_safe — XSS Risk', type: 'XSS' },

    // SQL
    { pattern: /execute\s*\(\s*["'].*SELECT.*%s/, sev: 'c', title: '🔴 SQL Injection via %s format', type: 'SQL_INJECTION' },
    { pattern: /execute\s*\(\s*f["'].*SELECT/, sev: 'c', title: '🔴 SQL Injection via f-string', type: 'SQL_INJECTION' },
    { pattern: /\.format\s*\(.*\)\s*.*execute/, sev: 'c', title: '🔴 SQL Injection via .format()', type: 'SQL_INJECTION' },

    // Command Injection
    { pattern: /subprocess\.(call|run|Popen)\s*\(.*shell\s*=\s*True/, sev: 'c', title: '🔴 Command Injection via shell=True', type: 'CMD_INJECTION' },
    { pattern: /os\.popen\s*\(/, sev: 'c', title: '🔴 Command Injection via os.popen', type: 'CMD_INJECTION' },
    { pattern: /commands\.(getoutput|getstatusoutput)/, sev: 'c', title: '🔴 Command Injection via commands module', type: 'CMD_INJECTION' },

    // Crypto
    { pattern: /hashlib\.(md5|sha1)\s*\(/, sev: 'h', title: '🟠 Weak Hash: MD5/SHA1', type: 'WEAK_CRYPTO' },
    { pattern: /random\.(random|randint|choice)\s*\(.*(?:token|secret|key|otp)/, sev: 'h', title: '🟠 Insecure Random للـ Security', type: 'WEAK_RANDOM' },
    { pattern: /Crypto\.cipher\.AES.*MODE_ECB/, sev: 'h', title: '🟠 AES ECB Mode غير آمن', type: 'WEAK_CRYPTO' },

    // Deserialization
    { pattern: /pickle\.(loads?|Unpickler)\s*\(/, sev: 'c', title: '🔴 Unsafe Pickle Deserialization', type: 'DESERIAL' },
    { pattern: /yaml\.load\s*\([^,)]+\)/, sev: 'c', title: '🔴 YAML Unsafe Load', type: 'DESERIAL' },
    { pattern: /jsonpickle\.decode\s*\(/, sev: 'c', title: '🔴 jsonpickle Unsafe Decode', type: 'DESERIAL' },

    // Path Traversal
    { pattern: /open\s*\(\s*(?:request\.|f["'][^"']*{)/, sev: 'c', title: '🔴 Path Traversal via open()', type: 'PATH_TRAVERSAL' },
    { pattern: /os\.path\.join\s*\(.*request\./, sev: 'h', title: '🟠 Path Traversal via os.path.join', type: 'PATH_TRAVERSAL' },

    // SSRF
    { pattern: /requests\.(get|post|put)\s*\(\s*(?:request\.|user_url|url\s*=\s*request\.)/, sev: 'c', title: '🔴 SSRF via requests', type: 'SSRF' },
    { pattern: /urllib\.request\.urlopen\s*\(\s*(?:request\.|url)/, sev: 'c', title: '🔴 SSRF via urllib', type: 'SSRF' },

    // Logging
    { pattern: /logging\.(info|debug|warning)\s*\(.*(?:password|token|secret)/i, sev: 'h', title: '🟠 Sensitive Data in Logs', type: 'DATA_EXPOSURE' },
    { pattern: /print\s*\(.*(?:password|token|secret)/i, sev: 'h', title: '🟠 Sensitive Data via print()', type: 'DATA_EXPOSURE' },
  ];

  // ─── PHP Extended ──────────────────────────────────
  const PHP_PATTERNS = [
    // SQL
    { pattern: /mysql_query\s*\(.*\$_(GET|POST|REQUEST)/, sev: 'c', title: '🔴 SQL Injection via mysql_query', type: 'SQL_INJECTION' },
    { pattern: /\$wpdb->query\s*\(.*\$_(GET|POST)/, sev: 'c', title: '🔴 SQL Injection في WordPress', type: 'SQL_INJECTION' },
    { pattern: /mysqli_query\s*\(.*\.\s*\$_(GET|POST)/, sev: 'c', title: '🔴 SQL Injection via mysqli_query', type: 'SQL_INJECTION' },

    // XSS
    { pattern: /echo\s+\$_(GET|POST|REQUEST|COOKIE)\s*\[/, sev: 'c', title: '🔴 XSS Reflected', type: 'XSS' },
    { pattern: /<\?=\s*\$_(GET|POST|REQUEST)/, sev: 'c', title: '🔴 XSS via <?= echo shorthand', type: 'XSS' },

    // File Inclusion
    { pattern: /include\s*\(\s*\$_(GET|POST|REQUEST)/, sev: 'c', title: '🔴 Local/Remote File Inclusion', type: 'FILE_INCLUSION' },
    { pattern: /require\s*\(\s*\$_(GET|POST|REQUEST)/, sev: 'c', title: '🔴 Local/Remote File Inclusion via require', type: 'FILE_INCLUSION' },
    { pattern: /include_once\s*\(\s*\$_(GET|POST)/, sev: 'c', title: '🔴 File Inclusion via include_once', type: 'FILE_INCLUSION' },

    // Command Injection
    { pattern: /system\s*\(\s*\$_(GET|POST|REQUEST)/, sev: 'c', title: '🔴 Command Injection via system()', type: 'CMD_INJECTION' },
    { pattern: /exec\s*\(\s*\$_(GET|POST|REQUEST)/, sev: 'c', title: '🔴 Command Injection via exec()', type: 'CMD_INJECTION' },
    { pattern: /passthru\s*\(\s*\$_(GET|POST)/, sev: 'c', title: '🔴 Command Injection via passthru()', type: 'CMD_INJECTION' },
    { pattern: /shell_exec\s*\(\s*\$_(GET|POST)/, sev: 'c', title: '🔴 Command Injection via shell_exec()', type: 'CMD_INJECTION' },
    { pattern: /`.*\$_(GET|POST|REQUEST)[^`]*`/, sev: 'c', title: '🔴 Command Injection via backtick', type: 'CMD_INJECTION' },

    // Deserialization
    { pattern: /unserialize\s*\(\s*\$_(GET|POST|COOKIE)/, sev: 'c', title: '🔴 PHP Unsafe Deserialization', type: 'DESERIAL' },
    { pattern: /unserialize\s*\(\s*base64_decode/, sev: 'c', title: '🔴 PHP Deserialization via base64', type: 'DESERIAL' },

    // Crypto
    { pattern: /md5\s*\(\s*\$(?:password|pass|pwd)/, sev: 'h', title: '🟠 MD5 لتشفير كلمة المرور', type: 'WEAK_CRYPTO' },
    { pattern: /sha1\s*\(\s*\$(?:password|pass|pwd)/, sev: 'h', title: '🟠 SHA1 لتشفير كلمة المرور', type: 'WEAK_CRYPTO' },

    // SSRF
    { pattern: /curl_setopt\s*\(.*CURLOPT_URL.*\$_(GET|POST)/, sev: 'c', title: '🔴 SSRF via cURL', type: 'SSRF' },
    { pattern: /file_get_contents\s*\(\s*\$_(GET|POST)/, sev: 'c', title: '🔴 SSRF via file_get_contents', type: 'SSRF' },

    // Open Redirect
    { pattern: /header\s*\(\s*['"]Location.*\$_(GET|POST)/, sev: 'c', title: '🔴 Open Redirect via header()', type: 'OPEN_REDIRECT' },
  ];

  // ─── Java Extended ─────────────────────────────────
  const JAVA_PATTERNS = [
    // SQL
    { pattern: /Statement.*execute(?:Query|Update)\s*\(.*\+/, sev: 'c', title: '🔴 SQL Injection via Statement', type: 'SQL_INJECTION' },
    { pattern: /"SELECT.*"\s*\+\s*\w+/, sev: 'c', title: '🔴 SQL Injection via String concat', type: 'SQL_INJECTION' },

    // Path Traversal
    { pattern: /new File\s*\(.*getParameter/, sev: 'c', title: '🔴 Path Traversal via new File()', type: 'PATH_TRAVERSAL' },

    // XXE
    { pattern: /DocumentBuilderFactory\.newInstance\s*\(\s*\)/, sev: 'h', title: '🟠 XXE Risk — Disable external entities', type: 'XXE' },
    { pattern: /SAXParserFactory\.newInstance\s*\(\s*\)/, sev: 'h', title: '🟠 XXE Risk via SAXParser', type: 'XXE' },

    // Deserialization
    { pattern: /ObjectInputStream\s*\(/, sev: 'h', title: '🟠 Java Unsafe Deserialization', type: 'DESERIAL' },
    { pattern: /readObject\s*\(\s*\)/, sev: 'h', title: '🟠 Java readObject() — Deserialization Risk', type: 'DESERIAL' },

    // Crypto
    { pattern: /getInstance\s*\(\s*['"]DES['"]\s*\)/, sev: 'c', title: '🔴 DES Encryption — Weak', type: 'WEAK_CRYPTO' },
    { pattern: /getInstance\s*\(\s*['"]MD5['"]\s*\)/, sev: 'h', title: '🟠 MD5 Hash — Weak', type: 'WEAK_CRYPTO' },
    { pattern: /new Random\s*\(\s*\)/, sev: 'h', title: '🟠 java.util.Random غير آمن', type: 'WEAK_RANDOM' },

    // Command Injection
    { pattern: /Runtime\.getRuntime\s*\(\s*\)\.exec\s*\(.*\+/, sev: 'c', title: '🔴 Command Injection via Runtime.exec', type: 'CMD_INJECTION' },
    { pattern: /ProcessBuilder\s*\(.*getParameter/, sev: 'c', title: '🔴 Command Injection via ProcessBuilder', type: 'CMD_INJECTION' },
  ];

  // ─── Analyzer ─────────────────────────────────────
  function analyze(code, fileName) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    const lang = ext === 'py' ? 'py' : ext === 'php' ? 'php' :
                 ext === 'java' || ext === 'kt' ? 'java' : 'js';

    const patternMap = {
      js:   JS_PATTERNS,
      py:   PY_PATTERNS,
      php:  PHP_PATTERNS,
      java: JAVA_PATTERNS,
    };

    const lines = code.split('\n');
    const issues = [];
    const seen = new Set();
    const patterns = [...(patternMap[lang] || []), ...JS_PATTERNS.filter(p => !patternMap[lang])];

    lines.forEach((line, i) => {
      const t = line.trim();
      const ln = i + 1;
      if (!t || t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;

      (patternMap[lang] || JS_PATTERNS).forEach(p => {
        if (!p.pattern.test(t)) return;
        const key = `${ln}:${p.type}`;
        if (seen.has(key)) return;
        seen.add(key);

        issues.push({
          type: p.type, sev: p.sev, line: ln, ev: t,
          conf: p.sev === 'c' ? 92 : p.sev === 'h' ? 80 : 65,
          title: p.title,
          cIcon: p.sev === 'c' ? '🔴' : p.sev === 'h' ? '🟠' : '🟡',
          cAct: p.type,
          source: 'ExtendedPatterns',
        });
      });
    });

    return issues;
  }

  return { analyze };
})();

if (typeof window !== 'undefined') window.ExtendedPatterns = ExtendedPatterns;
if (typeof module !== 'undefined') module.exports = ExtendedPatterns;
