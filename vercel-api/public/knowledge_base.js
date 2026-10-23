// ═══════════════════════════════════════════════════════
// knowledge_base.js v1.0 — قاعدة المعرفة الشاملة
// 500+ pattern لكل نوع ثغرة + كل لغة
// ═══════════════════════════════════════════════════════
"use strict";

var KnowledgeBase = (() => {

  // ─── SQL Injection Patterns ───────────────────────
  const SQL_PATTERNS = {
    dangerous: [
      // JavaScript
      { lang: 'js', pattern: /["'`].*(?:SELECT|INSERT|UPDATE|DELETE).*["'`]\s*\+\s*\w+/i, conf: 0.95 },
      { lang: 'js', pattern: /\.query\s*\(\s*["'`].*\$\{/i, conf: 0.95 },
      { lang: 'js', pattern: /\.query\s*\(\s*\w+\s*\+/i, conf: 0.90 },
      { lang: 'js', pattern: /["\`].*(?:WHERE|FROM|SELECT).*["\`]\s*\+\s*\w+/i, conf: 0.93 },
      { lang: 'js', pattern: /["\`].*(?:WHERE|FROM|SELECT).*'\s*"\s*\+/i, conf: 0.95 },
      { lang: 'js', pattern: /execute\s*\(\s*["'`].*\+/i, conf: 0.90 },
      { lang: 'js', pattern: /`SELECT.*\$\{.*\}`/i, conf: 0.95 },
      { lang: 'js', pattern: /`INSERT.*\$\{.*\}`/i, conf: 0.95 },
      { lang: 'js', pattern: /`UPDATE.*\$\{.*\}`/i, conf: 0.95 },
      { lang: 'js', pattern: /`DELETE.*\$\{.*\}`/i, conf: 0.95 },
      // Python
      // [PY-PCT] ‎%‎ **بعد** إغلاق النصّ وحده خطر: ‎execute("… %s" % uid)‎
      // تنسيقٌ يُدمج قبل التنفيذ. أما ‎%s‎ **داخل** النصّ مع وسيطِ معاملات،
      // ‎execute("… id=%s", (uid,))‎، فهو موضعُ معامِلٍ في DB-API — أي الشكل
      // الصحيح نفسه. وكان النمط ‎["'].*%\s*\w+‎ يطابق ‎%s‎ داخل النصّ، فيُبلّغ
      // عن الإصلاح السليم كثغرة: البلاغ يبقى 1→1 فتردّ البوابة إصلاحًا
      // صحيحًا بـNO_IMPROVEMENT (مقيس على مِجسّ gate.sql-parameterized-accepted).
      //
      // وهذا التضييق **ومعه** النمط الآمن أدناه حارسان مستقلّان: قيسَ أن
      // أيًّا منهما وحده يكفي لمنع البلاغ الزائف، وأن إلغاءهما معًا هو ما
      // يُعيده. فهو تعميقُ دفاعٍ بقصد، لا سطرٌ ميت — ولذلك لا يُسقط تحوّرُ
      // أحدهما وحده اختبارًا، وذلك متوقَّع ومُعلَن لا فجوةُ تغطية.
      { lang: 'py', pattern: /cursor\.execute\s*\(\s*(["'])(?:(?!\1)[\s\S])*\1\s*%\s*\w+/i, conf: 0.95 },
      { lang: 'py', pattern: /cursor\.execute\s*\(\s*["'].*\+\s*\w+/i, conf: 0.95 },
      { lang: 'py', pattern: /cursor\.execute\s*\(\s*f["']/i, conf: 0.95 },
      { lang: 'py', pattern: /execute\s*\(\s*["'].*format\s*\(/i, conf: 0.90 },
      { lang: 'py', pattern: /\.execute\s*\(".*\+\s*\w+/i, conf: 0.90 },
      { lang: 'py', pattern: /query\s*=.*["'].*SELECT.*["']\s*\+/i, conf: 0.90 },
      // PHP
      { lang: 'php', pattern: /mysqli_query\s*\(.*\$_(GET|POST|REQUEST)/i, conf: 0.95 },
      { lang: 'php', pattern: /\$conn->query\s*\(.*\$_(GET|POST)/i, conf: 0.95 },
      { lang: 'php', pattern: /mysql_query\s*\(.*\.\s*\$\w+/i, conf: 0.95 },
      { lang: 'php', pattern: /\$query\s*=.*["'].*SELECT.*["']\s*\./i, conf: 0.90 },
      // Java
      { lang: 'java', pattern: /createStatement\(\)\.execute\s*\(/i, conf: 0.90 },
      { lang: 'java', pattern: /Statement.*execute.*\+\s*\w+/i, conf: 0.90 },
      { lang: 'java', pattern: /"SELECT.*"\s*\+\s*\w+/i, conf: 0.90 },
    ],
    safe: [
      { lang: 'js',   pattern: /\.query\s*\(\s*\w+\s*,\s*\[/i, conf: 0.95 },
      { lang: 'js',   pattern: /prepareStatement|prepare\s*\(/i, conf: 0.95 },
      { lang: 'py',   pattern: /cursor\.execute\s*\(\s*\w+\s*,\s*\(/i, conf: 0.95 },
      { lang: 'py',   pattern: /cursor\.execute\s*\(\s*\w+\s*,\s*\[/i, conf: 0.95 },
      // الشكل الأشيع للصحيح: النصّ داخل الاستدعاء ثم وسيطُ المعاملات.
      // كانت الأنماط الآمنة تشترط **متغيّرًا** قبل الفاصلة (‎\w+‎)، فلا تشمل
      // ‎execute("… id=%s", (uid,))‎ — وهو ناتجُ مُصلِحاتنا نفسها.
      { lang: 'py',   pattern: /(?:cursor|cur|crsr|conn|connection|session|db)\s*\.\s*execute\s*\(\s*(["'])(?:(?!\1)[\s\S])*\1\s*,\s*[([]/i, conf: 0.95 },
      { lang: 'js',   pattern: /\.\s*(?:query|execute)\s*\(\s*(["'`])(?:(?!\1)[\s\S])*\1\s*,\s*\[/i, conf: 0.95 },
      { lang: 'php',  pattern: /prepare\s*\(\s*["'][^"']*\?/i, conf: 0.95 },
      { lang: 'java', pattern: /PreparedStatement|prepareStatement/i, conf: 0.95 },
    ],
    fixes: {
      js:   { before: /"SELECT.*"\s*\+\s*(\w+)/, after: '"SELECT...?" , [$1]' },
      py:   { before: /f["']SELECT.*{(\w+)}/, after: '"SELECT...?" , ($1,)' },
      php:  { before: /\$query\s*=.*\.\s*\$(\w+)/, after: '$stmt = $conn->prepare("SELECT...?"); $stmt->bind_param("s", $$1);' },
      java: { before: /"SELECT.*"\s*\+\s*(\w+)/, after: 'PreparedStatement stmt = conn.prepareStatement("SELECT...?"); stmt.setString(1, $1);' },
    }
  };

  // ─── XSS Patterns ─────────────────────────────────
  const XSS_PATTERNS = {
    dangerous: [
      // JavaScript
      { lang: 'js', pattern: /\.innerHTML\s*=\s*(?!['"`])/i, conf: 0.92 },
      { lang: 'js', pattern: /\.innerHTML\s*\+=\s*/i, conf: 0.92 },
      { lang: 'js', pattern: /\.outerHTML\s*=\s*(?!['"`])/i, conf: 0.92 },
      { lang: 'js', pattern: /document\.write\s*\(\s*\w+/i, conf: 0.90 },
      { lang: 'js', pattern: /res\.send\s*\(\s*['"`].*\+\s*\w+/i, conf: 0.90 },
      { lang: 'js', pattern: /res\.send\s*\(\s*\w+\s*\)/i, conf: 0.85 },
      { lang: 'js', pattern: /insertAdjacentHTML\s*\(/i, conf: 0.88 },
      { lang: 'js', pattern: /\.innerHTML\s*=\s*['"`].*<script/i, conf: 0.99 },
      { lang: 'js', pattern: /document\.innerHTML\s*=/i, conf: 0.95 },
      { lang: 'js', pattern: /eval\s*\(\s*\w+/i, conf: 0.95 },
      { lang: 'js', pattern: /setTimeout\s*\(\s*\w+/i, conf: 0.80 },
      { lang: 'js', pattern: /setInterval\s*\(\s*\w+/i, conf: 0.80 },
      // PHP
      { lang: 'php', pattern: /echo\s+\$_(GET|POST|REQUEST)/i, conf: 0.95 },
      { lang: 'php', pattern: /print\s+\$_(GET|POST|REQUEST)/i, conf: 0.95 },
      { lang: 'php', pattern: /echo\s+\$\w+.*\$_(GET|POST)/i, conf: 0.90 },
      // Python
      { lang: 'py', pattern: /render_template_string\s*\(\s*\w+/i, conf: 0.90 },
      { lang: 'py', pattern: /Markup\s*\(\s*request\./i, conf: 0.90 },
    ],
    safe: [
      { lang: 'js',  pattern: /\.textContent\s*=/i, conf: 0.95 },
      { lang: 'js',  pattern: /\.innerText\s*=/i, conf: 0.95 },
      { lang: 'js',  pattern: /DOMPurify\.sanitize/i, conf: 0.95 },
      { lang: 'js',  pattern: /encodeURIComponent/i, conf: 0.90 },
      { lang: 'php', pattern: /htmlspecialchars\s*\(/i, conf: 0.95 },
      { lang: 'php', pattern: /htmlentities\s*\(/i, conf: 0.95 },
      { lang: 'py',  pattern: /escape\s*\(\s*\w+/i, conf: 0.90 },
    ],
    fixes: {
      js:  { innerHTML: 'textContent', 'document.write': '// removed', 'res.send': 'res.json({ message: String(VAR).replace(/[<>]/g,"") })' },
      php: { echo: 'echo htmlspecialchars($VAR, ENT_QUOTES, "UTF-8");' },
      py:  { print: 'print(escape(VAR))' },
    }
  };

  // ─── Hardcoded Secrets ────────────────────────────
  const SECRET_PATTERNS = {
    dangerous: [
      { lang: 'any', pattern: /(?:JWT_SECRET|jwt_secret)\s*=\s*["'][^"']{8,}["']/i, conf: 0.95 },
      { lang: 'any', pattern: /(?:API_KEY|api_key)\s*=\s*["'][^"']{8,}["']/i, conf: 0.95 },
      { lang: 'any', pattern: /(?:PASSWORD|password)\s*=\s*["'][^"']{4,}["']/i, conf: 0.90 },
      { lang: 'any', pattern: /(?:DB_PASS|DB_PASSWORD|PASS)\s*=\s*["'][^"']{4,}["']/i, conf: 0.90 },
      { lang: 'any', pattern: /(?:SECRET|secret)\s*=\s*["'][^"']{8,}["']/i, conf: 0.90 },
      { lang: 'any', pattern: /sk_live_[a-zA-Z0-9]{20,}/i, conf: 0.99 },
      { lang: 'any', pattern: /sk_test_[a-zA-Z0-9]{20,}/i, conf: 0.95 },
      { lang: 'any', pattern: /ghp_[a-zA-Z0-9]{36}/i, conf: 0.99 },
      { lang: 'any', pattern: /AKIA[0-9A-Z]{16}/i, conf: 0.99 },
      { lang: 'any', pattern: /AIzaSy[a-zA-Z0-9_-]{33}/i, conf: 0.99 },
      { lang: 'any', pattern: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/i, conf: 0.99 },
    ],
    safe: [
      { lang: 'js',  pattern: /process\.env\.\w+/i, conf: 0.99 },
      { lang: 'js',  pattern: /jwt\.sign\s*\([^)]+expiresIn/i, conf: 0.99 },
      { lang: 'js',  pattern: /jwt\.sign\s*\([^)]+process\.env[^)]+expiresIn/i, conf: 0.99 },
      { lang: 'py',  pattern: /os\.environ(?:\.get)?\s*\(/i, conf: 0.99 },
      { lang: 'php', pattern: /getenv\s*\(/i, conf: 0.99 },
      { lang: 'java', pattern: /System\.getenv\s*\(/i, conf: 0.99 },
    ],
    fixes: {
      js:   'process.env.VAR_NAME',
      py:   'os.environ.get("VAR_NAME")',
      php:  'getenv("VAR_NAME")',
      java: 'System.getenv("VAR_NAME")',
    }
  };

  // ─── Command Injection ────────────────────────────
  const CMD_PATTERNS = {
    dangerous: [
      { lang: 'js',   pattern: /exec\s*\(\s*\w+\s*\+/i, conf: 0.95 },
      { lang: 'js',   pattern: /exec\s*\(\s*`.*\$\{/i, conf: 0.95 },
      { lang: 'js',   pattern: /spawn\s*\(\s*\w+\s*\+/i, conf: 0.90 },
      { lang: 'py',   pattern: /os\.system\s*\(\s*\w+\s*\+/i, conf: 0.95 },
      { lang: 'py',   pattern: /os\.system\s*\(\s*f["']/i, conf: 0.95 },
      { lang: 'py',   pattern: /subprocess\.call\s*\(.*shell\s*=\s*True/i, conf: 0.90 },
      { lang: 'py',   pattern: /subprocess\.run\s*\(.*shell\s*=\s*True/i, conf: 0.90 },
      { lang: 'php',  pattern: /exec\s*\(\s*\$_(GET|POST)/i, conf: 0.95 },
      { lang: 'php',  pattern: /system\s*\(\s*\$_(GET|POST)/i, conf: 0.95 },
      { lang: 'php',  pattern: /shell_exec\s*\(\s*\$\w+/i, conf: 0.90 },
      // Keylogger
      { lang: 'js', pattern: /onkeypress\s*=.*fetch\s*\(/i, conf: 0.95 },
      { lang: 'js', pattern: /onkeydown\s*=.*fetch\s*\(/i, conf: 0.95 },
      // Data exfiltration
      { lang: 'js', pattern: /fetch\s*\(\s*['"]http.*\+.*cookie/i, conf: 0.95 },
      { lang: 'js', pattern: /document\.cookie.*fetch/i, conf: 0.95 },
      // Dangerous commands
      { lang: 'js', pattern: /exec\s*\(\s*['"]rm\s+-rf/i, conf: 0.99 },
      { lang: 'js', pattern: /exec\s*\(\s*['"]format/i, conf: 0.99 },
      { lang: 'java', pattern: /Runtime\.exec\s*\(\s*\w+\s*\+/i, conf: 0.95 },
    ],
    safe: [
      { lang: 'js',  pattern: /execFile\s*\(\s*\w+\s*,\s*\[/i, conf: 0.90 },
      { lang: 'py',  pattern: /subprocess\.run\s*\(\s*\[/i, conf: 0.95 },
      { lang: 'py',  pattern: /shlex\.split/i, conf: 0.90 },
    ],
    fixes: {
      js:  'execFile(cmd, args, callback) // use array args',
      py:  'subprocess.run(shlex.split(cmd), check=True)',
      php: '// Use escapeshellarg($input)',
    }
  };

  // ─── Weak Crypto ──────────────────────────────────
  const CRYPTO_PATTERNS = {
    dangerous: [
      { lang: 'any', pattern: /createHash\s*\(\s*['"]md5['"]\s*\)/i, conf: 0.95 },
      { lang: 'any', pattern: /createHash\s*\(\s*['"]sha1['"]\s*\)/i, conf: 0.95 },
      { lang: 'any', pattern: /hashlib\.md5/i, conf: 0.95 },
      { lang: 'any', pattern: /hashlib\.sha1/i, conf: 0.95 },
      { lang: 'any', pattern: /md5\s*\(\s*\$\w+/i, conf: 0.95 },
      { lang: 'any', pattern: /Math\.random\(\).*(?:token|key|secret|id)/i, conf: 0.90 },
      { lang: 'any', pattern: /DES|3DES|RC4|RC2/i, conf: 0.90 },
      { lang: 'js',  pattern: /jwt\.sign\s*\((?![^)]*expiresIn)[^)]+\)\s*(?!,\s*\{)/i, conf: 0.85 },
    ],
    safe: [
      { lang: 'any', pattern: /createHash\s*\(\s*['"]sha256['"]\s*\)/i, conf: 0.99 },
      { lang: 'any', pattern: /createHash\s*\(\s*['"]sha512['"]\s*\)/i, conf: 0.99 },
      { lang: 'any', pattern: /bcrypt|argon2|scrypt|pbkdf2/i, conf: 0.99 },
      { lang: 'any', pattern: /hashlib\.sha256|hashlib\.sha512/i, conf: 0.99 },
    ],
    fixes: {
      md5:  'SHA256',
      sha1: 'SHA256',
      jwt:  "jwt.sign(payload, secret, { expiresIn: '1h' })",
    }
  };

  // ─── Accumulation Bugs ────────────────────────────
  const ACCUM_PATTERNS = {
    dangerous: [
      { lang: 'any', pattern: /(\w+)\s*=\s*\w+\.\w+\s*;?\s*\/\/.*loop/i, conf: 0.85 },
      { lang: 'js',  pattern: /forEach.*\{\s*\w+\s*=\s*\w+\.\w+\s*;/i, conf: 0.90 },
      { lang: 'py',  pattern: /for\s+\w+\s+in\s+\w+.*:\s*\n\s+\w+\s*=\s*\w+\.\w+/i, conf: 0.90 },
    ],
    safe: [
      { lang: 'any', pattern: /\w+\s*\+=\s*\w+\.\w+/i, conf: 0.99 },
      { lang: 'js',  pattern: /forEach.*=>.*\{[^}]*\+=[^}]*\}/i, conf: 0.99 },
    ],
    fixes: {
      any: 'total += item.value // use += not ='
    }
  };

  // ─── Path Traversal ───────────────────────────────
  const PATH_PATTERNS = {
    dangerous: [
      { lang: 'js',  pattern: /readFile\s*\(\s*\w+\s*\+/i, conf: 0.90 },
      { lang: 'js',  pattern: /readFileSync\s*\(\s*req\./i, conf: 0.95 },
      { lang: 'py',  pattern: /open\s*\(\s*\w+\s*\+/i, conf: 0.85 },
      { lang: 'php', pattern: /include\s*\(\s*\$_(GET|POST)/i, conf: 0.95 },
      { lang: 'php', pattern: /require\s*\(\s*\$_(GET|POST)/i, conf: 0.95 },
      { lang: 'php', pattern: /fopen\s*\(\s*\$_(GET|POST)/i, conf: 0.95 },
    ],
    safe: [
      { lang: 'js',  pattern: /path\.resolve|path\.normalize/i, conf: 0.90 },
      { lang: 'py',  pattern: /os\.path\.abspath|os\.path\.realpath/i, conf: 0.90 },
    ],
    fixes: {
      js:  "path.resolve(__dirname, 'safe_dir', filename) // validate path",
      py:  'os.path.realpath(os.path.join(base_dir, filename))',
      php: 'realpath(base_dir . "/" . $filename)',
    }
  };

  // ─── SSRF Patterns ────────────────────────────────
  const SSRF_PATTERNS = {
    dangerous: [
      { lang: 'js',  pattern: /fetch\s*\(\s*req\.\w+/i, conf: 0.90 },
      { lang: 'js',  pattern: /axios\.\w+\s*\(\s*req\.\w+/i, conf: 0.90 },
      { lang: 'py',  pattern: /requests\.\w+\s*\(\s*\w+\s*\+/i, conf: 0.85 },
      { lang: 'py',  pattern: /urllib\.request\.urlopen\s*\(\s*\w+/i, conf: 0.85 },
      { lang: 'php', pattern: /curl_setopt.*CURLOPT_URL.*\$_(GET|POST)/i, conf: 0.90 },
    ],
    fixes: {
      any: '// Validate URL against whitelist before fetching'
    }
  };

  // ─── Insecure Deserialization ─────────────────────
  const DESERIAL_PATTERNS = {
    dangerous: [
      { lang: 'py',   pattern: /pickle\.loads\s*\(/i, conf: 0.95 },
      { lang: 'py',   pattern: /pickle\.load\s*\(/i, conf: 0.95 },
      { lang: 'py',   pattern: /yaml\.load\s*\([^)]+\)/i, conf: 0.90 },
      { lang: 'js',   pattern: /eval\s*\(\s*JSON\./i, conf: 0.85 },
      { lang: 'java', pattern: /ObjectInputStream/i, conf: 0.85 },
      { lang: 'php',  pattern: /unserialize\s*\(\s*\$_(GET|POST)/i, conf: 0.95 },
    ],
    fixes: {
      py:  'json.loads(data) // use JSON not pickle',
      php: '// Never unserialize user input',
    }
  };

  // ─── HTTP Security Headers ────────────────────────
  const HEADER_PATTERNS = {
    dangerous: [
      { lang: 'js',  pattern: /fetch\s*\(\s*['"]http:\/\//i, conf: 0.85 },
      { lang: 'any', pattern: /http:\/\/(?!localhost|127\.0\.0\.1)/i, conf: 0.80 },
    ],
    fixes: {
      any: 'https:// // always use HTTPS'
    }
  };

  // ─── Authentication Weaknesses ────────────────────
  const AUTH_PATTERNS = {
    dangerous: [
      { lang: 'js',  pattern: /jwt\.verify\s*\([^)]+,\s*['"][^'"]+['"]\s*\)/i, conf: 0.90 },
      { lang: 'js',  pattern: /jwt\.sign\s*\([^,]+,\s*['"][^'"]+['"]\s*\)(?!.*process\.env)/i, conf: 0.90 },
      { lang: 'any', pattern: /password\s*===?\s*['"][^'"]+['"]/i, conf: 0.90 },
      { lang: 'any', pattern: /if\s*\(\s*password\s*==\s*/i, conf: 0.85 },
      { lang: 'py',  pattern: /check_password\s*==\s*/i, conf: 0.85 },
    ],
    safe: [
      { lang: 'js',  pattern: /bcrypt\.compare|bcrypt\.verify/i, conf: 0.99 },
      { lang: 'py',  pattern: /check_password_hash|bcrypt\.check_password_hash/i, conf: 0.99 },
    ],
    fixes: {
      js:  "bcrypt.compare(password, hash) // never compare plain passwords",
      py:  'check_password_hash(stored_hash, password)',
    }
  };

  // ─── Main Analyzer ────────────────────────────────
  function analyze(code, fileName) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    const lang = ext === 'py' ? 'py' : ext === 'php' ? 'php' : 
                 ext === 'java' || ext === 'kt' ? 'java' : 'js';
    const lines = code.split('\n');
    const issues = [];
    const seen = new Set();

    const allPatterns = [
      { type: 'SQL_INJECTION',  sev: 'c', patterns: SQL_PATTERNS.dangerous,     safe: SQL_PATTERNS.safe },
      { type: 'XSS',            sev: 'c', patterns: XSS_PATTERNS.dangerous,     safe: XSS_PATTERNS.safe },
      { type: 'HARDCODED_SECRET', sev: 'h', patterns: SECRET_PATTERNS.dangerous, safe: SECRET_PATTERNS.safe },
      { type: 'CMD_INJECTION',  sev: 'c', patterns: CMD_PATTERNS.dangerous,     safe: CMD_PATTERNS.safe },
      { type: 'WEAK_CRYPTO',    sev: 'h', patterns: CRYPTO_PATTERNS.dangerous,  safe: CRYPTO_PATTERNS.safe },
      { type: 'ACCUMULATION',   sev: 'c', patterns: ACCUM_PATTERNS.dangerous,   safe: ACCUM_PATTERNS.safe },
      { type: 'PATH_TRAVERSAL', sev: 'c', patterns: PATH_PATTERNS.dangerous,    safe: PATH_PATTERNS.safe },
      { type: 'SSRF',           sev: 'h', patterns: SSRF_PATTERNS.dangerous,    safe: [] },
      { type: 'DESERIAL',       sev: 'c', patterns: DESERIAL_PATTERNS.dangerous, safe: [] },
      { type: 'INSECURE_HTTP',  sev: 'm', patterns: HEADER_PATTERNS.dangerous,  safe: [] },
      { type: 'AUTH_WEAKNESS',  sev: 'h', patterns: AUTH_PATTERNS.dangerous,    safe: AUTH_PATTERNS.safe },
    ];

    lines.forEach((line, i) => {
      const t = line.trim();
      const ln = i + 1;
      if (!t || t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;

      allPatterns.forEach(({ type, sev, patterns, safe }) => {
        // تحقق لو في safe pattern
        const isSafe = safe.some(s => 
          (s.lang === 'any' || s.lang === lang) && s.pattern.test(t)
        );
        if (isSafe) return;

        patterns.forEach(p => {
          if (p.lang !== 'any' && p.lang !== lang) return;
          if (!p.pattern.test(t)) return;

          const key = `${ln}:${type}`;
          if (seen.has(key)) return;
          seen.add(key);

          issues.push({
            type, sev, line: ln, ev: t,
            conf: Math.round(p.conf * 100),
            title: getTitle(type, t),
            fix: getFix(type, lang),
            cIcon: sev === 'c' ? '🔴' : sev === 'h' ? '🟠' : '🟡',
            cAct: type,
            source: 'KnowledgeBase',
          });
        });
      });
    });

    // [XSS-ESCAPED] قاعدة innerHTML أعلاه تبلّغ عن **كل** إسناد (‎\s*‎ يتراجع فيُسقط شرط الاقتباس)،
    // فتعجز عن التمييز بين الثغرة ونسخها المُصلحة. يُستثنى بلاغ واحد فقط حين يُثبت الـAST أنه
    // مُصلَح: انظر _kbEscapedTextSink. كل ما عدا ذلك — ومنه النص الثابت — يبقى مُبلَّغًا كما كان.
    return issues.filter(x => !(x.type === 'XSS' && /\.(?:inner|outer)HTML\s*=(?!=)|\bsend\s*\(/.test(String(x.ev)) &&
                                _kbEscapedTextSink(code, x.line)));
  }

  // ─── [XSS-ESCAPED] إثبات أن إسناد innerHTML/outerHTML في السطر مُهرَّب في سياق نص HTML ───
  // الشروط كلها معًا (أي شك ⇒ يبقى البلاغ):
  //   1. الملف يعرّف __escapeHTML مرة واحدة في المستوى الأعلى، ونصّه مطابق للدالة المعيارية التي يُدخلها
  //      xss_fix.js (تهرّب & < > " ' `) — لا ثقة في الاسم وحده، ولا إسناد آخر لهذا الاسم في الملف.
  //   2. الطرف الأيمن كاملًا (ولو امتد على أسطر) سلسلة + أو template من نصوص ثابتة ونداءات __escapeHTML(x)
  //      فقط، وفيه نداء واحد على الأقل.
  //   3. كل نداء يقع في سياق نص HTML: لا داخل وسم أو قيمة سمة، ولا داخل script/style/textarea/title/تعليق.
  const _KB_ESCAPER = 'function__escapeHTML(v){returnString(v).replace(/[&<>"\'`]/g,function(c){switch(c){case"&":return"&amp;";' +
                      'case"<":return"&lt;";case">":return"&gt;";case\'"\':return"&quot;";case"\'":return"&#39;";default:return"&#96;";}});}';
  const _KB_RAW = /^(?:script|style|textarea|title|noscript|iframe|noembed|noframes|xmp|plaintext)$/i;
  let _kbAstCache = { code: null, ast: null };
  function _kbParse(code) {
    if (_kbAstCache.code === code) return _kbAstCache.ast;
    let A = null, ast = null;
    try { A = (typeof acorn !== 'undefined' && acorn && typeof acorn.parse === 'function') ? acorn : null; } catch (e) { A = null; }
    // وحدة Node (require) لا ترى acorn عامًّا: نفس مسار _proofAcorn في fix_verifier.js
    if (!A) { try { if (typeof require === 'function') { const a = require('./acorn.min.js'); if (a && typeof a.parse === 'function') A = a; } } catch (e) { A = null; } }
    if (A) {
      const o = { ecmaVersion: 'latest', locations: true, allowReturnOutsideFunction: true, allowHashBang: true };
      try { ast = A.parse(code, Object.assign({ sourceType: 'script' }, o)); }
      catch (e) { try { ast = A.parse(code, Object.assign({ sourceType: 'module' }, o)); } catch (e2) { ast = null; } }
    }
    _kbAstCache = { code, ast };
    return ast;
  }
  function _kbWalk(n, fn) {
    if (!n || typeof n.type !== 'string') return;
    fn(n);
    for (const k of Object.keys(n)) {
      if (k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && _kbWalk(c, fn));
      else if (v && typeof v.type === 'string') _kbWalk(v, fn);
    }
  }
  // حالة HTML بعد نص ثابت: 'text' أو 'tag' (داخل وسم/سمة) أو 'raw' (script/style…) أو 'comment'
  function _kbHtmlState(html) {
    let st = 'text', raw = null, i = 0;
    while (i < html.length) {
      if (st === 'comment') { const e = html.indexOf('-->', i); if (e < 0) return 'comment'; st = 'text'; i = e + 3; continue; }
      if (st === 'raw') {
        const re = new RegExp('</' + raw + '\\s*>', 'i'); const m = re.exec(html.slice(i));
        if (!m) return 'raw'; st = 'text'; i += m.index + m[0].length; continue;
      }
      if (st === 'tag') {
        // داخل الوسم: نتخطى قيم السمات المقتبسة حتى >
        const c = html[i];
        if (c === '"' || c === "'") { const e = html.indexOf(c, i + 1); if (e < 0) return 'tag'; i = e + 1; continue; }
        if (c === '>') { st = raw ? 'raw' : 'text'; i++; continue; }
        i++; continue;
      }
      // text
      if (html.startsWith('<!--', i)) { st = 'comment'; i += 4; continue; }
      if (html[i] === '<' && /[A-Za-z\/!?]/.test(html[i + 1] || '')) {
        const m = /^<([A-Za-z][\w-]*)/.exec(html.slice(i));
        raw = m && _KB_RAW.test(m[1]) ? m[1] : null;
        st = 'tag'; i++; continue;
      }
      i++;
    }
    return st;
  }
  // [RES-SEND-PROOF] الإثبات يُستدعى لكل سطر مَصرِف مرشّح، وكان كلُّ استدعاء يمشي الشجرة كلها مرتين ⇒ ملفٌ
  // فيه 300 نداء res.send صار 7.5 ثانية (مقيس؛ 0.12 قبل البند). فيُحفظ لكل كائن AST (WeakMap — _kbParse يُعيد
  // الكائن ذاته للنص ذاته): (1) صلاحية الدالة المساعدة، (2) مَصارِف كل سطر بترتيب المشي نفسه.
  // المنطق حرفيًا كما هو؛ التكافؤ مع النسخة غير المحفوظة مُختبَر في res_send_html_proof.
  const _kbHelperMemo = new WeakMap(), _kbSinkMemo = new WeakMap();
  function _kbHelperOk(code, ast) {
    if (_kbHelperMemo.has(ast)) return _kbHelperMemo.get(ast);
    const r = (() => {
      // 1. الدالة المساعدة
      const decls = [];
      let rebound = false;
      _kbWalk(ast, n => {
        if (n.type === 'FunctionDeclaration' && n.id && n.id.name === '__escapeHTML') decls.push(n);
        if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === '__escapeHTML') rebound = true;
        if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier' && n.left.name === '__escapeHTML') rebound = true;
        if (/^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type) &&
            n.params.some(p => p.type === 'Identifier' && p.name === '__escapeHTML')) rebound = true;
      });
      if (rebound || decls.length !== 1 || !ast.body.includes(decls[0])) return false;
      if (code.slice(decls[0].start, decls[0].end).replace(/\s+/g, '') !== _KB_ESCAPER) return false;
      return true;
    })();
    _kbHelperMemo.set(ast, r);
    return r;
  }
  function _kbSinksAt(ast, lineNo) {
    let idx = _kbSinkMemo.get(ast);
    if (!idx) {
      idx = new Map();
      const add = (line, sink) => { const a = idx.get(line); if (a) a.push(sink); else idx.set(line, [sink]); };
      // 2. المَصرِف في السطر: إسناد innerHTML/outerHTML، أو [RES-SEND] نداء send لرد Express —
      //    المستقبِل R أو R.status(…) وR الوسيط الثاني لدالة المعالج المحيطة ولا يُعاد إسناده.
      const fnStack = [];
      const isFn = n => /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type);
      (function rec(n) {
        if (!n || typeof n.type !== 'string') return;
        if (isFn(n)) fnStack.push(n);
        if (n.type === 'AssignmentExpression' && n.operator === '=' && n.left.type === 'MemberExpression' && !n.left.computed &&
            /^(?:inner|outer)HTML$/.test(n.left.property.name)) add(n.left.property.loc.start.line, { value: n.right });
        if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed &&
            n.callee.property.name === 'send') {
          let recv = n.callee.object;
          if (recv.type === 'CallExpression' && recv.callee.type === 'MemberExpression' && !recv.callee.computed &&
              recv.callee.property.name === 'status') recv = recv.callee.object;
          const fn = fnStack[fnStack.length - 1];
          const p1 = fn && fn.params[1];
          let ok = !!(fn && recv.type === 'Identifier' && p1 && p1.type === 'Identifier' && p1.name === recv.name && n.arguments.length === 1);
          if (ok) _kbWalk(fn.body, m => { if (m.type === 'AssignmentExpression' && m.left.type === 'Identifier' && m.left.name === recv.name) ok = false; });
          add(n.callee.property.loc.start.line, ok ? { value: n.arguments[0] } : { value: null });
        }
        for (const k of Object.keys(n)) {
          if (k === 'loc') continue;
          const v = n[k];
          if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && rec(c));
          else if (v && typeof v.type === 'string') rec(v);
        }
        if (isFn(n)) fnStack.pop();
      })(ast);
      _kbSinkMemo.set(ast, idx);
    }
    return idx.get(lineNo) || [];
  }
  function _kbEscapedTextSink(code, lineNo) {
    const ast = _kbParse(code);
    if (!ast) return false;
    // 1. الدالة المساعدة
    if (!_kbHelperOk(code, ast)) return false;
    // 2. المَصرِف في السطر
    const sinks = _kbSinksAt(ast, lineNo);
    if (sinks.length !== 1 || !sinks[0].value) return false;
    const parts = [];
    let ok = true;
    const leaf = x => {
      if (!ok) return;
      if (x.type === 'BinaryExpression' && x.operator === '+') { leaf(x.left); leaf(x.right); return; }
      if (x.type === 'Literal' && typeof x.value === 'string') { parts.push({ s: x.value }); return; }
      if (x.type === 'TemplateLiteral') {
        x.quasis.forEach((q, k) => { parts.push({ s: q.value.cooked == null ? null : q.value.cooked }); if (k < x.expressions.length) leaf(x.expressions[k]); });
        return;
      }
      if (x.type === 'CallExpression' && x.callee.type === 'Identifier' && x.callee.name === '__escapeHTML' && x.arguments.length === 1) {
        parts.push({ esc: true }); return;
      }
      ok = false;
    };
    leaf(sinks[0].value);
    if (!ok || !parts.some(p => p.esc) || parts.some(p => p.s === null)) return false;
    // 3. السياق: كل نداء في نص HTML
    let html = '';
    for (const p of parts) {
      if (p.esc) { if (_kbHtmlState(html) !== 'text') return false; html += 'x'; }
      else html += p.s;
    }
    return true;
  }

  // ─── Helpers ──────────────────────────────────────
  function getTitle(type, line) {
    const titles = {
      SQL_INJECTION:    '🔴 SQL Injection — user input في query',
      XSS:              '🔴 XSS — user input في output',
      HARDCODED_SECRET: '🟠 Secret مُضمَّن — استخدم environment variables',
      CMD_INJECTION:    '🔴 Command Injection — user input في shell',
      WEAK_CRYPTO:      '🟠 تشفير ضعيف — استخدم SHA256 أو bcrypt',
      ACCUMULATION:     '🔴 خطأ تراكم — استخدم += بدل =',
      PATH_TRAVERSAL:   '🔴 Path Traversal — user input في file path',
      SSRF:             '🟠 SSRF — user input في URL',
      DESERIAL:         '🔴 Insecure Deserialization',
      INSECURE_HTTP:    '🟡 HTTP بدون HTTPS',
      AUTH_WEAKNESS:    '🟠 ضعف في المصادقة',
    };
    return titles[type] || '⚠️ مشكلة أمنية';
  }

  function getFix(type, lang) {
    const fixes = {
      SQL_INJECTION:    { js: 'db.query("SELECT...?", [param])', py: 'cursor.execute("SELECT...?", (param,))', php: '$stmt = $pdo->prepare("SELECT...?");' },
      XSS:              { js: 'textContent = value // بدل innerHTML', php: 'echo htmlspecialchars($val);', py: 'escape(value)' },
      HARDCODED_SECRET: { js: 'process.env.VAR', py: 'os.environ.get("VAR")', php: 'getenv("VAR")' },
      CMD_INJECTION:    { js: 'execFile(cmd, [args])', py: 'subprocess.run([cmd, arg])', php: 'escapeshellarg($input)' },
      WEAK_CRYPTO:      { any: 'SHA256 أو bcrypt بدل MD5/SHA1' },
      ACCUMULATION:     { any: 'total += item.value' },
      PATH_TRAVERSAL:   { js: 'path.resolve(__dirname, "safe", file)', py: 'os.path.realpath(os.path.join(base, file))' },
      SSRF:             { any: '// تحقق من URL قبل الطلب' },
      DESERIAL:         { py: 'json.loads() بدل pickle', php: '// لا تستخدم unserialize مع user input' },
      INSECURE_HTTP:    { any: 'https:// بدل http://' },
      AUTH_WEAKNESS:    { js: 'bcrypt.compare(pass, hash)', py: 'check_password_hash(hash, pass)' },
    };
    const f = fixes[type];
    if (!f) return '// راجع الكود';
    return f[lang] || f.any || '// راجع الكود';
  }

  // ─── Export ───────────────────────────────────────
  return {
    analyze,
    SQL_PATTERNS,
    XSS_PATTERNS,
    SECRET_PATTERNS,
    CMD_PATTERNS,
    CRYPTO_PATTERNS,
    // [XSS-ESCAPED] إثبات مشترك: الكواشف السطرية الأخرى (security_scanner) تستعمله كي لا يحكم كاشفان
    // على السطر نفسه حكمين مختلفين (إخفاء أحدهما يُظهر الآخر).
    escapedTextSink: _kbEscapedTextSink,
  };
})();

if (typeof window !== 'undefined') window.KnowledgeBase = KnowledgeBase;
if (typeof module !== 'undefined') module.exports = KnowledgeBase;
