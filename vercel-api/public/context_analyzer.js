// ═══════════════════════════════════════════════════════
// context_analyzer.js v1.0 — محلل السياق الذكي
// يصنف المتغيرات ويمنع الأخطاء قبل الإصلاح
// ═══════════════════════════════════════════════════════
"use strict";

var ContextAnalyzer = (() => {

  // ─── تصنيفات المتغيرات ────────────────────────────
  const TYPES = {
    SQL_QUERY:   'sql_query',   // query, sql, stmt
    DB_CONFIG:   'db_config',   // DB_URL, DB_HOST
    SECRET:      'secret',      // KEY, TOKEN, PASSWORD
    USER_INPUT:  'user_input',  // من req.body/query
    HASH:        'hash',        // نتيجة hash function
    ENV_VAR:     'env_var',     // من process.env أو os.environ
    CONSTANT:    'constant',    // hardcoded string
    UNKNOWN:     'unknown',
  };

  // ─── Patterns ─────────────────────────────────────
  const PATTERNS = {
    SQL_QUERY: /^(?:query|sql|stmt|statement|q|sqlQuery|sqlStr|queryStr|rawQuery)$/i,
    DB_CONFIG: /^(?:DB_URL|DATABASE_URL|DB_HOST|DB_PORT|DB_PASS|DB_USER|DB_NAME|CONNECTION_STRING|CONN_STR)$/i,
    SECRET:    /(?:KEY|SECRET|TOKEN|PASSWORD|PASS|PWD|STRIPE|TWILIO|SENDGRID|AWS|GITHUB|PRIVATE|JWT)/i,
    HASH_FN:   /(?:hash|bcrypt|sha|md5|digest|encode)/i,
  };

  // ─── Source Patterns ──────────────────────────────
  const SOURCES = {
    // JS: req.body, req.query, req.params
    JS_DIRECT:    /\b(\w+)\s*=\s*req\.(?:body|query|params)\.(\w+)/g,
    JS_DESTRUCT:  /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*req\.(?:body|query|params)/g,
    JS_ENV:       /\b(\w+)\s*=\s*process\.env\.(\w+)/g,
    JS_HASH:      /\b(\w+)\s*=\s*(?:bcrypt|crypto|hashlib)\.(?:hash|createHash|hashpw)/g,

    // Python: request.args, request.form
    PY_FLASK:     /\b(\w+)\s*=\s*request\.(?:args|form|json|values)(?:\.get\(['"](\w+)['"]\)|\[['"](\w+)['"]\])/g,
    PY_INPUT:     /\b(\w+)\s*=\s*input\s*\(/g,
    PY_ENV:       /\b(\w+)\s*=\s*os\.environ(?:\.get\(['"](\w+)['"]\)|\[['"](\w+)['"]\])/g,
    PY_HASH:      /\b(\w+)\s*=\s*(?:hashlib|bcrypt)\./g,

    // PHP: $_GET, $_POST
    PHP_GET:      /(\$\w+)\s*=\s*\$_(GET|POST|REQUEST)\[['"](\w+)['"]\]/g,
    PHP_ENV:      /(\$\w+)\s*=\s*getenv\s*\(/g,
  };

  // ─── Main Classifier ──────────────────────────────
  function buildContext(code, fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const vars = new Map(); // varName → { type, source, line }

    const lines = code.split('\n');
    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;
      const ln = i + 1;

      // ─── JS/TS ────────────────────────────────────
      if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) {
        // const {username, hash} = req.body
        let m;
        const dest = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*req\.(body|query|params)/g;
        dest.lastIndex = 0;
        while ((m = dest.exec(line)) !== null) {
          m[1].split(',').forEach(v => {
            const name = v.trim().split(':')[0].trim().split('=')[0].trim();
            if (name) vars.set(name, { type: TYPES.USER_INPUT, source: `req.${m[2]}`, line: ln });
          });
        }

        // let userId = req.query.id
        const dir = /(?:const|let|var)\s+(\w+)\s*=\s*req\.(body|query|params)\.(\w+)/g;
        dir.lastIndex = 0;
        while ((m = dir.exec(line)) !== null)
          vars.set(m[1], { type: TYPES.USER_INPUT, source: `req.${m[2]}.${m[3]}`, line: ln });

        // const KEY = process.env.KEY
        const env = /(?:const|let|var)\s+(\w+)\s*=\s*process\.env\.(\w+)/g;
        env.lastIndex = 0;
        while ((m = env.exec(line)) !== null)
          vars.set(m[1], { type: TYPES.ENV_VAR, source: `process.env.${m[2]}`, line: ln });

        // const hash = bcrypt.hash(...)
        const hsh = /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?(?:bcrypt|crypto)\.(?:hash|createHash)/g;
        hsh.lastIndex = 0;
        while ((m = hsh.exec(line)) !== null)
          vars.set(m[1], { type: TYPES.HASH, source: 'hash function', line: ln });

        // const query = "SELECT..." → SQL_QUERY
        const sqlV = /(?:const|let|var)\s+(\w+)\s*=\s*["'`]([^"'`]*(?:SELECT|INSERT|UPDATE|DELETE)[^"'`]*?)["'`]/gi;
        sqlV.lastIndex = 0;
        while ((m = sqlV.exec(line)) !== null)
          vars.set(m[1], { type: TYPES.SQL_QUERY, source: 'SQL string', line: ln });

        // SECRET_KEY = "abc123" → CONSTANT/SECRET
        const sec = /(?:const|let|var)\s+(\w+)\s*=\s*["'][^"']{6,}["']/g;
        sec.lastIndex = 0;
        while ((m = sec.exec(line)) !== null) {
          if (!vars.has(m[1])) {
            const tp = PATTERNS.SQL_QUERY.test(m[1]) ? TYPES.SQL_QUERY :
                       PATTERNS.DB_CONFIG.test(m[1]) ? TYPES.DB_CONFIG :
                       PATTERNS.SECRET.test(m[1])    ? TYPES.SECRET    : TYPES.CONSTANT;
            vars.set(m[1], { type: tp, source: 'hardcoded', line: ln });
          }
        }
      }

      // ─── Python ───────────────────────────────────
      if (ext === 'py') {
        let m;

        // username = request.args.get('username')
        const flask = /(\w+)\s*=\s*request\.(?:args|form|json|values)(?:\.get\(['"](\w+)['"]\)|\[['"](\w+)['"]\])/g;
        flask.lastIndex = 0;
        while ((m = flask.exec(line)) !== null)
          vars.set(m[1], { type: TYPES.USER_INPUT, source: 'Flask request', line: ln });

        // x = input(...)
        const inp = /(\w+)\s*=\s*input\s*\(/g;
        inp.lastIndex = 0;
        while ((m = inp.exec(line)) !== null)
          vars.set(m[1], { type: TYPES.USER_INPUT, source: 'input()', line: ln });

        // KEY = os.environ.get(...)
        const env = /(\w+)\s*=\s*os\.environ(?:\.get\(['"](\w+)['"]\)|\[['"](\w+)['"]\])/g;
        env.lastIndex = 0;
        while ((m = env.exec(line)) !== null)
          vars.set(m[1], { type: TYPES.ENV_VAR, source: 'os.environ', line: ln });

        // query = "SELECT..."
        const sqlV = /(\w+)\s*=\s*["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*?)["']/gi;
        sqlV.lastIndex = 0;
        while ((m = sqlV.exec(line)) !== null)
          vars.set(m[1], { type: TYPES.SQL_QUERY, source: 'SQL string', line: ln });

        // SECRET_KEY = "abc..."
        const sec = /^([A-Z_][A-Z0-9_]*)\s*=\s*["'][^"']{6,}["']/g;
        sec.lastIndex = 0;
        while ((m = sec.exec(t)) !== null) {
          if (!vars.has(m[1])) {
            const tp = PATTERNS.SQL_QUERY.test(m[1]) ? TYPES.SQL_QUERY :
                       PATTERNS.DB_CONFIG.test(m[1]) ? TYPES.DB_CONFIG :
                       PATTERNS.SECRET.test(m[1])    ? TYPES.SECRET    : TYPES.CONSTANT;
            vars.set(m[1], { type: tp, source: 'hardcoded', line: ln });
          }
        }

        // def login(username, password) → USER_INPUT
        const func = /^def\s+\w+\s*\(([^)]+)\)/g;
        func.lastIndex = 0;
        while ((m = func.exec(t)) !== null) {
          if (/login|auth|register|user|search|get|post/i.test(t)) {
            m[1].split(',').forEach(p => {
              const pName = p.trim().split('=')[0].trim().split(':')[0].trim();
              if (pName && pName !== 'self' && !vars.has(pName))
                vars.set(pName, { type: TYPES.USER_INPUT, source: 'function param', line: ln });
            });
          }
        }
      }

      // ─── PHP ──────────────────────────────────────
      if (ext === 'php') {
        let m;
        const get = /(\$\w+)\s*=\s*\$_(GET|POST|REQUEST)\[['"](\w+)['"]\]/g;
        get.lastIndex = 0;
        while ((m = get.exec(line)) !== null)
          vars.set(m[1], { type: TYPES.USER_INPUT, source: `$_${m[2]}`, line: ln });
      }
    });

    // ─── Classify unresolved vars ──────────────────
    return {
      vars,
      classify(varName) {
        if (vars.has(varName)) return vars.get(varName);
        // بناءً على الاسم
        if (PATTERNS.SQL_QUERY.test(varName)) return { type: TYPES.SQL_QUERY, source: 'name pattern' };
        if (PATTERNS.DB_CONFIG.test(varName)) return { type: TYPES.DB_CONFIG, source: 'name pattern' };
        if (PATTERNS.SECRET.test(varName))    return { type: TYPES.SECRET,    source: 'name pattern' };
        return { type: TYPES.UNKNOWN, source: 'unknown' };
      },
      isSQL(v)      { return this.classify(v).type === TYPES.SQL_QUERY; },
      isSecret(v)   { return this.classify(v).type === TYPES.SECRET; },
      isUserInput(v){ return this.classify(v).type === TYPES.USER_INPUT; },
      isDBConfig(v) { return this.classify(v).type === TYPES.DB_CONFIG; },
      isEnvVar(v)   { return this.classify(v).type === TYPES.ENV_VAR; },
      isHash(v)     { return this.classify(v).type === TYPES.HASH; },
    };
  }

  // ─── Export ───────────────────────────────────────
  return { buildContext, TYPES };
})();

if (typeof window !== 'undefined') window.ContextAnalyzer = ContextAnalyzer;
