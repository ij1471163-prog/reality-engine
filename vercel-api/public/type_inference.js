// ═══════════════════════════════════════════════════════
// type_inference.js v1.0 — يستنتج نوع كل متغير
// يفهم كل لغات البرمجة
// ═══════════════════════════════════════════════════════
"use strict";

var TypeInference = (() => {

  // ─── أنواع شاملة ──────────────────────────────────
  const TYPES = {
    // مصادر
    USER_INPUT:   'user_input',    // من المستخدم → خطر
    ENV_VAR:      'env_var',       // من environment → آمن
    DB_RESULT:    'db_result',     // من قاعدة بيانات
    FILE_CONTENT: 'file_content',  // من ملف
    API_RESPONSE: 'api_response',  // من API خارجي

    // أنواع القيم
    STRING:    'string',
    NUMBER:    'number',
    BOOLEAN:   'boolean',
    ARRAY:     'array',
    OBJECT:    'object',
    NULL:      'null',
    UNDEFINED: 'undefined',

    // أنواع متخصصة
    HASH:         'hash',         // نتيجة hash → آمن
    ENCRYPTED:    'encrypted',    // مشفر → آمن
    SANITIZED:    'sanitized',    // منظف → آمن
    SQL_SAFE:     'sql_safe',     // SQL parameterized → آمن
    SQL_UNSAFE:   'sql_unsafe',   // SQL concat → خطر
    SECRET:       'secret',       // hardcoded secret → خطر
    VALIDATED:    'validated',    // validated input → آمن نسبياً
    CONSTANT:     'constant',     // ثابت → آمن
    UNKNOWN:      'unknown',
  };

  // ─── Safe Types ────────────────────────────────────
  const SAFE_TYPES = new Set([
    TYPES.ENV_VAR, TYPES.HASH, TYPES.ENCRYPTED,
    TYPES.SANITIZED, TYPES.SQL_SAFE, TYPES.CONSTANT,
    TYPES.NUMBER, TYPES.BOOLEAN, TYPES.VALIDATED,
  ]);

  // ─── Dangerous Types ───────────────────────────────
  const DANGEROUS_TYPES = new Set([
    TYPES.USER_INPUT, TYPES.SQL_UNSAFE, TYPES.SECRET,
  ]);

  // ─── Type Registry ────────────────────────────────
  class TypeRegistry {
    constructor() {
      this.vars = new Map();      // varName → TypeInfo
      this.funcs = new Map();     // funcName → returnType
      this.calls = new Map();     // callSite → TypeInfo
    }

    set(name, type, meta = {}) {
      this.vars.set(name, {
        type,
        safe: SAFE_TYPES.has(type),
        dangerous: DANGEROUS_TYPES.has(type),
        meta,
      });
    }

    get(name) {
      return this.vars.get(name) || { type: TYPES.UNKNOWN, safe: true, dangerous: false };
    }

    isSafe(name) { return this.get(name).safe; }
    isDangerous(name) { return this.get(name).dangerous; }

    // تتبع propagation: x = y
    propagate(target, source) {
      const srcInfo = this.vars.get(source);
      if (srcInfo) this.vars.set(target, { ...srcInfo });
    }

    // merge: x = f(a, b) → إذا أحدهم خطر = الناتج خطر
    merge(target, sources) {
      const dangerous = sources.some(s => this.isDangerous(s));
      const safe = sources.every(s => this.isSafe(s));
      this.set(target, dangerous ? TYPES.USER_INPUT : safe ? TYPES.CONSTANT : TYPES.UNKNOWN);
    }
  }

  // ─── Pattern Matchers per Language ────────────────

  // JavaScript/TypeScript
  function inferJS(code) {
    const registry = new TypeRegistry();
    const lines = code.split('\n');

    // دوال التحويل الآمنة
    const SAFE_FUNCS = /^(?:parseInt|parseFloat|Number|Boolean|String|Math\.|JSON\.parse|encodeURI|escape|sha256|bcrypt|argon2|scrypt|hashlib\.|crypto\.createHash)/;
    const HASH_FUNCS = /sha256|sha512|bcrypt|argon2|scrypt|pbkdf2|createHash|hash/i;
    const SANITIZE_FUNCS = /sanitize|escape|clean|strip|purify|DOMPurify|xss/i;
    const VALIDATE_FUNCS = /validate|verify|check|assert|isValid|isEmail/i;

    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*')) return;

      // ── User Input Sources ─────────────────────────
      // req.body/query/params destructuring
      const destM = t.match(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*req\.(body|query|params)/);
      if (destM) {
        destM[1].split(',').forEach(v => {
          const name = v.trim().split(/[:=]/)[0].trim();
          if (name) registry.set(name, TYPES.USER_INPUT, { source: `req.${destM[2]}`, line: i+1 });
        });
      }

      // req.body.x أو req.query.x
      const reqM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*req\.(body|query|params)\.(\w+)/);
      if (reqM) registry.set(reqM[1], TYPES.USER_INPUT, { source: `req.${reqM[2]}.${reqM[3]}`, line: i+1 });

      // URLSearchParams
      const urlM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:new\s+)?URLSearchParams/);
      if (urlM) registry.set(urlM[1], TYPES.USER_INPUT, { source: 'URL', line: i+1 });

      // document.getElementById + .value
      const domM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*document\.\w+\([^)]+\)\.value/);
      if (domM) registry.set(domM[1], TYPES.USER_INPUT, { source: 'DOM', line: i+1 });

      // ── Environment Variables ──────────────────────
      const envM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*process\.env\.(\w+)/);
      if (envM) registry.set(envM[1], TYPES.ENV_VAR, { key: envM[2], line: i+1 });

      // ── Hardcoded Secrets ──────────────────────────
      const secM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*["'][^"']{8,}["']/);
      if (secM && /KEY|SECRET|TOKEN|PASSWORD|PASS|API|STRIPE|TWILIO/i.test(secM[1])) {
        registry.set(secM[1], TYPES.SECRET, { line: i+1 });
      }

      // ── Constants ─────────────────────────────────
      const constM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*(\d+|true|false|null|undefined)/);
      if (constM) registry.set(constM[1], TYPES.CONSTANT, { value: constM[2], line: i+1 });

      const strM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*["'][^"']*["']/);
      if (strM && !registry.vars.has(strM[1])) registry.set(strM[1], TYPES.CONSTANT, { line: i+1 });

      // ── SQL Types ─────────────────────────────────
      const sqlM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*["'`]([^"'`]*(?:SELECT|INSERT|UPDATE|DELETE)[^"'`]*)/i);
      if (sqlM) {
        const hasParam = sqlM[2].includes('?') || sqlM[2].includes('$');
        registry.set(sqlM[1], hasParam ? TYPES.SQL_SAFE : TYPES.SQL_UNSAFE, { line: i+1 });
      }

      // SQL concat: "SELECT..." + var
      const sqlConcatM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*["'`][^"'`]*(?:SELECT|INSERT|UPDATE|DELETE)[^"'`]*["'`]\s*\+/i);
      if (sqlConcatM) registry.set(sqlConcatM[1], TYPES.SQL_UNSAFE, { line: i+1 });

      // ── Safe Transforms ───────────────────────────
      const callM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?(\w+(?:\.\w+)?)\s*\(/);
      if (callM) {
        const [, varName, funcName] = callM;
        if (HASH_FUNCS.test(funcName)) {
          registry.set(varName, TYPES.HASH, { func: funcName, line: i+1 });
        } else if (SANITIZE_FUNCS.test(funcName)) {
          registry.set(varName, TYPES.SANITIZED, { func: funcName, line: i+1 });
        } else if (VALIDATE_FUNCS.test(funcName)) {
          registry.set(varName, TYPES.VALIDATED, { func: funcName, line: i+1 });
        } else if (SAFE_FUNCS.test(funcName)) {
          registry.set(varName, TYPES.CONSTANT, { func: funcName, line: i+1 });
        } else {
          // propagate من الـ args
          const argsM = t.match(/\(([^)]+)\)/);
          if (argsM) {
            const args = argsM[1].split(',').map(a => a.trim());
            const dangerous = args.some(a => registry.isDangerous(a));
            if (dangerous) registry.set(varName, TYPES.USER_INPUT, { propagated: true, line: i+1 });
          }
        }
      }

      // ── Propagation: x = y ────────────────────────
      const propM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\s*;?\s*$/);
      if (propM && !registry.vars.has(propM[1])) registry.propagate(propM[1], propM[2]);

      // ── DB Results ────────────────────────────────
      const dbM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?(?:\w+\.)?(?:findOne|findAll|find|query|execute|fetch)\s*\(/);
      if (dbM) registry.set(dbM[1], TYPES.DB_RESULT, { line: i+1 });
    });

    return registry;
  }

  // Python
  function inferPY(code) {
    const registry = new TypeRegistry();
    const lines = code.split('\n');

    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('#')) return;

      // Flask request
      const flaskM = t.match(/(\w+)\s*=\s*request\.(?:args|form|json|values)(?:\.get\(['"](\w+)['"]\)|\[['"](\w+)['"]\])/);
      if (flaskM) registry.set(flaskM[1], TYPES.USER_INPUT, { source: 'Flask', line: i+1 });

      // input()
      const inputM = t.match(/(\w+)\s*=\s*input\s*\(/);
      if (inputM) registry.set(inputM[1], TYPES.USER_INPUT, { source: 'input()', line: i+1 });

      // sys.argv
      const argvM = t.match(/(\w+)\s*=\s*sys\.argv/);
      if (argvM) registry.set(argvM[1], TYPES.USER_INPUT, { source: 'sys.argv', line: i+1 });

      // os.environ
      const envM = t.match(/(\w+)\s*=\s*os\.environ(?:\.get\(['"](\w+)['"]\)|\[['"](\w+)['"]\])/);
      if (envM) registry.set(envM[1], TYPES.ENV_VAR, { line: i+1 });

      // hashlib
      if (/hashlib\.(sha256|sha512|sha384|md5)/.test(t)) {
        const m = t.match(/(\w+)\s*=/);
        if (m) registry.set(m[1], TYPES.HASH, { line: i+1 });
      }

      // bcrypt
      if (/bcrypt\.hash|bcrypt\.generate/.test(t)) {
        const m = t.match(/(\w+)\s*=/);
        if (m) registry.set(m[1], TYPES.HASH, { line: i+1 });
      }

      // SQL
      const sqlM = t.match(/(\w+)\s*=\s*["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*)/i);
      if (sqlM) {
        const hasParam = sqlM[2].includes('?') || sqlM[2].includes('%s') || sqlM[2].includes(':');
        registry.set(sqlM[1], hasParam ? TYPES.SQL_SAFE : TYPES.SQL_UNSAFE, { line: i+1 });
      }

      // SQL concat
      const sqlConcatM = t.match(/(\w+)\s*=\s*["'][^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*["']\s*\+/i);
      if (sqlConcatM) registry.set(sqlConcatM[1], TYPES.SQL_UNSAFE, { line: i+1 });

      // Secret
      const secM = t.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*["'][^"']{8,}["']/);
      if (secM && /KEY|SECRET|TOKEN|PASSWORD|AWS|API/i.test(secM[1])) {
        registry.set(secM[1], TYPES.SECRET, { line: i+1 });
      }

      // Function params (auth functions)
      const funcM = t.match(/^def\s+(\w+)\s*\(([^)]+)\)/);
      if (funcM && /login|auth|register|search|get_user|find|handle/i.test(funcM[1])) {
        funcM[2].split(',').forEach(p => {
          const pName = p.trim().split(/[=:]/)[0].trim();
          if (pName && pName !== 'self' && pName !== 'cls') {
            registry.set(pName, TYPES.USER_INPUT, { source: 'function param', line: i+1 });
          }
        });
      }
    });

    return registry;
  }

  // PHP
  function inferPHP(code) {
    const registry = new TypeRegistry();
    const lines = code.split('\n');

    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;

      // $_GET/$_POST/$_REQUEST
      const getM = t.match(/(\$\w+)\s*=\s*\$_(GET|POST|REQUEST|COOKIE)\[['"](\w+)['"]\]/);
      if (getM) registry.set(getM[1], TYPES.USER_INPUT, { source: `$_${getM[2]}`, line: i+1 });

      // filter_input
      const filterM = t.match(/(\$\w+)\s*=\s*filter_input\s*\(\s*INPUT_(GET|POST)/);
      if (filterM) registry.set(filterM[1], TYPES.VALIDATED, { line: i+1 });

      // getenv
      const envM = t.match(/(\$\w+)\s*=\s*getenv\s*\(/);
      if (envM) registry.set(envM[1], TYPES.ENV_VAR, { line: i+1 });

      // password_hash
      if (/password_hash/.test(t)) {
        const m = t.match(/(\$\w+)\s*=/);
        if (m) registry.set(m[1], TYPES.HASH, { line: i+1 });
      }

      // SQL
      const sqlM = t.match(/(\$\w+)\s*=\s*["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*)/i);
      if (sqlM) {
        const hasParam = sqlM[2].includes('?') || sqlM[2].includes('%s');
        registry.set(sqlM[1], hasParam ? TYPES.SQL_SAFE : TYPES.SQL_UNSAFE, { line: i+1 });
      }

      // Propagation
      const propM = t.match(/(\$\w+)\s*=\s*(\$\w+)\s*;?\s*$/);
      if (propM && !registry.vars.has(propM[1])) registry.propagate(propM[1], propM[2]);
    });

    return registry;
  }

  // ─── Main Infer ───────────────────────────────────
  function infer(code, fileName) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    if (ext === 'py') return inferPY(code);
    if (ext === 'php') return inferPHP(code);
    return inferJS(code); // default JS/TS
  }

  // ─── Analyze with Types ───────────────────────────
  function analyze(code, fileName) {
    const registry = infer(code, fileName);
    const issues = [];
    const lines = code.split('\n');

    // Sinks
    const SINKS = {
      SQL:  [/\.(?:query|execute)\s*\(/, /mysqli_query/, /pg_query/, /cursor\.execute/],
      XSS:  [/res\.(?:send|write)\s*\(/, /echo\s+/, /\.innerHTML\s*=/, /document\.write/],
      CMD:  [/(?:exec|system|eval)\s*\(/, /os\.system/, /subprocess\.call.*shell=True/, /child_process/],
      FILE: [/readFile|open\s*\(/, /include\s*\(/, /require\s*\(/],
    };

    lines.forEach((line, i) => {
      const t = line.trim();
      const ln = i + 1;
      if (!t || t.startsWith('//') || t.startsWith('#')) return;

      // SQL Sinks
      if (SINKS.SQL.some(p => p.test(t))) {
        const vars = t.match(/\b([a-zA-Z_$]\w*)\b/g) || [];
        const dangerVars = vars.filter(v => registry.isDangerous(v));
        const queryVar = vars.find(v => registry.get(v).type === TYPES.SQL_UNSAFE);
        const hasSafeParams = /\[/.test(t) && /\?/.test(t);

        if ((dangerVars.length > 0 || queryVar) && !hasSafeParams) {
          issues.push({
            type: 'SQL_INJECTION', sev: 'c', line: ln,
            title: `🔴 SQL Injection: ${queryVar || dangerVars[0]} غير آمن`,
            ev: t, conf: 92, cIcon: '🔴', cAct: 'SQL_INJECTION',
            reason: `${queryVar || dangerVars[0]} من نوع ${registry.get(queryVar || dangerVars[0]).type}`,
          });
        }
      }

      // XSS Sinks
      if (SINKS.XSS.some(p => p.test(t))) {
        const vars = t.match(/\b([a-zA-Z_$]\w*)\b/g) || [];
        const dangerVars = vars.filter(v => registry.isDangerous(v) || registry.get(v).type === TYPES.USER_INPUT);
        if (dangerVars.length > 0) {
          issues.push({
            type: 'XSS', sev: 'c', line: ln,
            title: `🔴 XSS: ${dangerVars[0]} وصل لـ output بدون sanitize`,
            ev: t, conf: 90, cIcon: '🔴', cAct: 'XSS',
            fix: `// sanitize ${dangerVars[0]} before output`,
          });
        }
      }

      // CMD Sinks
      if (SINKS.CMD.some(p => p.test(t))) {
        const vars = t.match(/\b([a-zA-Z_$]\w*)\b/g) || [];
        const dangerVars = vars.filter(v => registry.get(v).type === TYPES.USER_INPUT);
        if (dangerVars.length > 0) {
          issues.push({
            type: 'CMD_INJECTION', sev: 'c', line: ln,
            title: `🔴 Command Injection: ${dangerVars[0]} في system command`,
            ev: t, conf: 93, cIcon: '🔴', cAct: 'CMD_INJECTION',
          });
        }
      }

      // Secrets
      const secVars = [...registry.vars.entries()].filter(([,v]) => v.type === TYPES.SECRET && v.meta?.line === ln);
      secVars.forEach(([name]) => {
        issues.push({
          type: 'HARDCODED_SECRET', sev: 'h', line: ln,
          title: `🟠 ${name} مُضمَّن — استخدم environment variables`,
          ev: t, conf: 88, cIcon: '🟠', cAct: 'HARDCODED_SECRET',
          fix: `${name} = process.env.${name}`,
        });
      });
    });

    return { issues, registry };
  }

  return { infer, analyze, TYPES, TypeRegistry };
})();

if (typeof window !== 'undefined') window.TypeInference = TypeInference;
