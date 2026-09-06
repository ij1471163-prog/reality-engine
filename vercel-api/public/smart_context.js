// ═══════════════════════════════════════════════════════
// smart_context.js v1.0 — محلل السياق المتقدم
// يفهم الكود مثل المطور — يتتبع المتغيرات ويحكم عليها
// ═══════════════════════════════════════════════════════
"use strict";

var SmartContext = (() => {

  // ─── أنواع المتغيرات ──────────────────────────────
  const T = {
    USER_INPUT:  'user_input',   // من req.body/query
    HASH:        'hash',         // نتيجة hash آمن
    SQL_SAFE:    'sql_safe',     // parameterized query
    SQL_UNSAFE:  'sql_unsafe',   // SQL concat خطر
    SECRET:      'secret',       // hardcoded secret
    ENV_VAR:     'env_var',      // من process.env
    CONSTANT:    'constant',     // ثابت
    COMPUTED:    'computed',     // نتيجة عملية
    UNKNOWN:     'unknown',
  };

  // ─── دوال التحويل الآمنة ──────────────────────────
  const SAFE_TRANSFORMS = [
    /sha256|sha512|bcrypt|argon2|scrypt|pbkdf2/i,
    /parseInt|parseFloat|Number\(|Math\./i,
    /encodeURI|escape|DOMPurify/i,
    /\.trim\(\)|\.slice\(|\.substring\(/i,
  ];

  // ─── دوال SQL الآمنة ──────────────────────────────
  const SQL_SAFE_PATTERNS = [
    /["'].*\?.*["']/,           // query مع ?
    /prepare\s*\(/i,            // prepared statement
    /\$\d+/,                    // PostgreSQL $1, $2
    /%s|%d/,                    // Python placeholders
  ];

  // ─── مصادر البيانات الخطرة ────────────────────────
  const SOURCES = {
    js: [
      /req\.(?:body|query|params)\.(\w+)/,
      /req\.(?:body|query|params)\[['"](\w+)['"]\]/,
    ],
    py: [
      /request\.(?:args|form|json)(?:\.get\(['"](\w+)['"]\)|\[['"](\w+)['"]\])/,
      /input\s*\(/,
      /sys\.argv/,
    ],
    php: [
      /\$_(GET|POST|REQUEST)\[['"](\w+)['"]\]/,
    ],
  };

  // ─── Sinks الخطرة ─────────────────────────────────
  const SINKS = {
    SQL:     [/\.query\s*\(/, /\.execute\s*\(/, /mysqli_query/, /pg_query/],
    XSS:     [/res\.send\s*\(/, /innerHTML\s*=/, /document\.write\s*\(/, /echo\s+/],
    CMD:     [/exec\s*\(/, /system\s*\(/, /os\.system/, /subprocess\./],
    CODE:    [/eval\s*\(/, /new\s+Function\s*\(/],
    FILE:    [/readFile\s*\(/, /open\s*\(/, /include\s*\(/],
  };

  // ─── Variable Tracker ─────────────────────────────
  class VarTracker {
    constructor(lang) {
      this.lang = lang;
      this.vars = new Map(); // name → {type, source, line, safe}
      this.calls = new Map(); // funcName → returnType
    }

    // سجّل متغير
    set(name, type, source, line, safe = null) {
      this.vars.set(name, { type, source, line, safe: safe ?? (type !== T.USER_INPUT && type !== T.SQL_UNSAFE) });
    }

    // احصل على نوع متغير
    get(name) {
      return this.vars.get(name) || { type: T.UNKNOWN, safe: true };
    }

    // هل المتغير آمن؟
    isSafe(name) {
      const info = this.get(name);
      return info.safe;
    }

    // تتبع propagation
    propagate(target, source, line) {
      const srcInfo = this.get(source);
      if (srcInfo.type !== T.UNKNOWN) {
        this.set(target, srcInfo.type, `propagated from ${source}`, line, srcInfo.safe);
      }
    }
  }

  // ─── AST-based Analysis ───────────────────────────
  function analyzeCode(code, fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const lang = ext === 'py' ? 'py' : ext === 'php' ? 'php' : 'js';
    const lines = code.split('\n');
    const tracker = new VarTracker(lang);
    const issues = [];
    const safe = [];

    // ─── Pass 1: تتبع تعريف المتغيرات ─────────────
    lines.forEach((line, i) => {
      const t = line.trim();
      const ln = i + 1;
      if (t.startsWith('//') || t.startsWith('#')) return;

      // ── JS: const/let/var ─────────────────────────
      if (lang === 'js') {
        // destructuring: const {username, hash} = req.body
        const destM = t.match(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*req\.(body|query|params)/);
        if (destM) {
          destM[1].split(',').forEach(v => {
            const name = v.trim().split(':')[0].trim().split('=')[0].trim();
            if (name) tracker.set(name, T.USER_INPUT, `req.${destM[2]}`, ln, false);
          });
        }

        // direct: const username = req.body.username
        const dirM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*req\.(body|query|params)\.(\w+)/);
        if (dirM) tracker.set(dirM[1], T.USER_INPUT, `req.${dirM[2]}.${dirM[3]}`, ln, false);

        // env: const KEY = process.env.KEY
        const envM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*process\.env\.(\w+)/);
        if (envM) tracker.set(envM[1], T.ENV_VAR, `process.env.${envM[2]}`, ln, true);

        // hash: const h = sha256(x) أو bcrypt.hash(x)
        const hashM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?(?:sha256|bcrypt|crypto\.createHash|hashlib\.sha|argon2)/);
        if (hashM) tracker.set(hashM[1], T.HASH, 'hash function', ln, true);

        // SQL safe: const q = "SELECT...?"
        const sqlM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*\?[^"']*)["']/i);
        if (sqlM) tracker.set(sqlM[1], T.SQL_SAFE, 'parameterized SQL', ln, true);

        // SQL unsafe: const q = "SELECT..." + var
        const sqlUnsafeM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*["'][^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*["']\s*\+/i);
        if (sqlUnsafeM) tracker.set(sqlUnsafeM[1], T.SQL_UNSAFE, 'SQL concatenation', ln, false);

        // secret: const KEY = "abc123"
        const secM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*["'][^"']{8,}["']/);
        if (secM && /KEY|SECRET|TOKEN|PASSWORD|PASS|API/i.test(secM[1])) {
          tracker.set(secM[1], T.SECRET, 'hardcoded', ln, false);
        }

        // safe transform: const h = hash(x)
        const safeM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\s*\(/);
        if (safeM) {
          const funcName = safeM[2];
          if (SAFE_TRANSFORMS.some(p => p.test(funcName))) {
            tracker.set(safeM[1], T.COMPUTED, `${funcName}()`, ln, true);
          } else {
            // propagate من الـ function return type
            const existing = tracker.get(safeM[1]);
            if (existing.type === T.UNKNOWN) {
              tracker.set(safeM[1], T.COMPUTED, `${funcName}()`, ln, true);
            }
          }
        }

        // propagation: const x = y
        const propM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\s*;?$/);
        if (propM) tracker.propagate(propM[1], propM[2], ln);
      }

      // ── Python ────────────────────────────────────
      if (lang === 'py') {
        // var = request.args.get('name')
        const flaskM = t.match(/(\w+)\s*=\s*request\.(?:args|form|json|values)(?:\.get\(['"](\w+)['"]\)|\[['"](\w+)['"]\])/);
        if (flaskM) tracker.set(flaskM[1], T.USER_INPUT, 'Flask request', ln, false);

        // var = input(...)
        if (/(\w+)\s*=\s*input\s*\(/.test(t)) {
          const m = t.match(/(\w+)\s*=/);
          if (m) tracker.set(m[1], T.USER_INPUT, 'input()', ln, false);
        }

        // os.environ
        const envM = t.match(/(\w+)\s*=\s*os\.environ(?:\.get\(['"](\w+)['"]\)|\[['"](\w+)['"]\])/);
        if (envM) tracker.set(envM[1], T.ENV_VAR, 'os.environ', ln, true);

        // hashlib
        if (/hashlib\.(sha256|sha512|md5)/.test(t)) {
          const m = t.match(/(\w+)\s*=/);
          if (m) tracker.set(m[1], T.HASH, 'hashlib', ln, true);
        }

        // SQL safe: query = "SELECT...?"
        const sqlM = t.match(/(\w+)\s*=\s*["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*\?[^"']*)["']/i);
        if (sqlM) tracker.set(sqlM[1], T.SQL_SAFE, 'parameterized SQL', ln, true);

        // SQL unsafe
        const sqlUnsafeM = t.match(/(\w+)\s*=\s*["'][^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*["']\s*\+/i);
        if (sqlUnsafeM) tracker.set(sqlUnsafeM[1], T.SQL_UNSAFE, 'SQL concatenation', ln, false);

        // secret
        const secM = t.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*["'][^"']{8,}["']/);
        if (secM && /KEY|SECRET|TOKEN|PASSWORD|AWS|API/i.test(secM[1])) {
          tracker.set(secM[1], T.SECRET, 'hardcoded', ln, false);
        }

        // function params (authentication functions)
        const funcM = t.match(/^def\s+(\w+)\s*\(([^)]+)\)/);
        if (funcM && /login|auth|register|search|get_user|find/i.test(funcM[1])) {
          funcM[2].split(',').forEach(p => {
            const pName = p.trim().split('=')[0].trim().split(':')[0].trim();
            if (pName && pName !== 'self') tracker.set(pName, T.USER_INPUT, 'function param', ln, false);
          });
        }
      }
    });

    // ─── Pass 2: تحليل الـ Sinks ──────────────────
    lines.forEach((line, i) => {
      const t = line.trim();
      const ln = i + 1;
      if (t.startsWith('//') || t.startsWith('#')) return;

      // SQL sinks
      SINKS.SQL.forEach(pat => {
        if (!pat.test(t)) return;

        // استخرج الـ args
        const argsM = t.match(/\(([^)]+)\)/);
        if (!argsM) return;
        const args = argsM[1];

        // تحقق لو parameterized
        const hasPlaceholder = /[?]/.test(args) || /\$\d+/.test(args) || /%s/.test(args);
        const hasArray = /\[/.test(args);
        const queryVarM = args.match(/(\w+)/);
        const queryVar = queryVarM ? queryVarM[1] : null;
        const queryInfo = queryVar ? tracker.get(queryVar) : null;
        const isSafeSQL = queryInfo?.type === T.SQL_SAFE ||
                          (hasPlaceholder && hasArray) ||
                          (hasPlaceholder && queryInfo?.type === T.SQL_SAFE);

        if (!isSafeSQL) {
          // تحقق لو فيه user input مباشر
          const vars = args.match(/\b([a-zA-Z_]\w*)\b/g) || [];
          const dangerousVars = vars.filter(v => !tracker.isSafe(v) && tracker.get(v).type !== T.UNKNOWN);
          if (dangerousVars.length > 0 || queryInfo?.type === T.SQL_UNSAFE) {
            issues.push({
              type: 'SQL_INJECTION', sev: 'c', line: ln, ev: t,
              title: `🔴 SQL Injection: ${dangerousVars[0] || queryVar} غير آمن → sink SQL`,
              reason: `${queryVar} من نوع ${queryInfo?.type || 'unknown'} — يجب parameterized query`,
              safe: false,
            });
          }
        } else {
          safe.push({ line: ln, type: 'SQL', reason: 'parameterized query ✅' });
        }
      });

      // XSS sinks
      SINKS.XSS.forEach(pat => {
        if (!pat.test(t)) return;
        const vars = t.match(/\b([a-zA-Z_]\w*)\b/g) || [];
        const dangerousVars = vars.filter(v => {
          const info = tracker.get(v);
          return info.type === T.USER_INPUT && !info.safe;
        });
        if (dangerousVars.length > 0) {
          issues.push({
            type: 'XSS', sev: 'c', line: ln, ev: t,
            title: `🔴 XSS: ${dangerousVars[0]} من user input → output بدون sanitize`,
            reason: `${dangerousVars[0]} مصدره user input ويذهب لـ output مباشرة`,
            safe: false,
          });
        }
      });

      // Command Injection
      SINKS.CMD.forEach(pat => {
        if (!pat.test(t)) return;
        const vars = t.match(/\b([a-zA-Z_]\w*)\b/g) || [];
        const dangerousVars = vars.filter(v => tracker.get(v).type === T.USER_INPUT);
        if (dangerousVars.length > 0) {
          issues.push({
            type: 'CMD_INJECTION', sev: 'c', line: ln, ev: t,
            title: `🔴 Command Injection: ${dangerousVars[0]} يذهب لـ shell command`,
            reason: `${dangerousVars[0]} من user input ويُنفَّذ كـ system command`,
            safe: false,
          });
        }
      });

      // Code Injection (eval)
      SINKS.CODE.forEach(pat => {
        if (!pat.test(t)) return;
        const vars = t.match(/\b([a-zA-Z_]\w*)\b/g) || [];
        const dangerousVars = vars.filter(v => tracker.get(v).type === T.USER_INPUT);
        if (dangerousVars.length > 0) {
          issues.push({
            type: 'CODE_INJECTION', sev: 'c', line: ln, ev: t,
            title: `🔴 Code Injection: ${dangerousVars[0]} في eval()`,
            reason: `${dangerousVars[0]} من user input ويُنفَّذ كـ code`,
            safe: false,
          });
        }
      });

      // Secrets
      const secM = lang === 'js'
        ? t.match(/(?:const|let|var)\s+(\w+)\s*=\s*["'][^"']{8,}["']/)
        : t.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*["'][^"']{8,}["']/);
      if (secM && /KEY|SECRET|TOKEN|PASSWORD|PASS|API/i.test(secM[1])) {
        if (tracker.get(secM[1]).type === T.SECRET) {
          issues.push({
            type: 'HARDCODED_SECRET', sev: 'h', line: ln, ev: t,
            title: `🟠 Secret مُضمَّن: ${secM[1]} يجب في environment variables`,
            reason: `${secM[1]} = hardcoded value — خطر إذا انكشف الكود`,
            safe: false,
          });
        }
      }
    });

    return { issues, safe, vars: tracker.vars };
  }

  // ─── تقرير شامل ───────────────────────────────────
  function report(code, fileName) {
    const result = analyzeCode(code, fileName);
    return {
      issues: result.issues,
      safe: result.safe,
      vars: Object.fromEntries(result.vars),
      summary: {
        critical: result.issues.filter(i => i.sev === 'c').length,
        high: result.issues.filter(i => i.sev === 'h').length,
        safePatterns: result.safe.length,
      }
    };
  }

  return { analyzeCode, report, TYPES: T };
})();

if (typeof window !== 'undefined') window.SmartContext = SmartContext;
