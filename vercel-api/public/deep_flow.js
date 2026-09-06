// ═══════════════════════════════════════════════════════
// deep_flow.js v1.0 — تحليل عميق للكود
// يفهم: inter-procedural + alias + loop + conditional
// ═══════════════════════════════════════════════════════
"use strict";

var DeepFlow = (() => {

  // ─── Types ────────────────────────────────────────
  const T = {
    USER_INPUT: 'user_input',
    SAFE:       'safe',
    SANITIZED:  'sanitized',
    HASH:       'hash',
    ENV:        'env',
    CONSTANT:   'constant',
    SQL_SAFE:   'sql_safe',
    SQL_UNSAFE: 'sql_unsafe',
    SECRET:     'secret',
    UNKNOWN:    'unknown',
  };

  const SAFE_TYPES = new Set([T.SAFE, T.SANITIZED, T.HASH, T.ENV, T.CONSTANT, T.SQL_SAFE]);
  const DANGER_TYPES = new Set([T.USER_INPUT, T.SQL_UNSAFE, T.SECRET]);

  // ─── Function Analyzer ────────────────────────────
  // يحلل ما تسوي الدالة ويعرف نوع ما ترجعه
  class FunctionAnalyzer {
    constructor() {
      this.funcs = new Map(); // funcName → { params, returnType, transforms }
    }

    // يحلل تعريف الدالة
    analyze(code) {
      const lines = code.split('\n');
      let inFunc = null;
      let depth = 0;
      let funcBody = [];

      lines.forEach((line, i) => {
        const t = line.trim();

        // بداية دالة
        const funcM = t.match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))\s*\(([^)]*)\)/);
        if (funcM && !inFunc) {
          inFunc = funcM[1] || funcM[2];
          const params = (funcM[3] || '').split(',').map(p => p.trim().split(/[=:]/)[0].trim()).filter(Boolean);
          this.funcs.set(inFunc, { params, returnType: T.UNKNOWN, transforms: [], body: [] });
          depth = 0;
        }

        if (inFunc) {
          depth += (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length;
          funcBody.push({ line: t, lineNum: i+1 });

          // اكتشف ما تسوي الدالة
          const funcInfo = this.funcs.get(inFunc);
          if (funcInfo) {
            // sanitization functions
            if (/replace|escape|encode|sanitize|strip|clean|purify/i.test(t)) {
              funcInfo.transforms.push('sanitize');
              funcInfo.returnType = T.SANITIZED;
            }
            // hash functions
            if (/sha256|sha512|bcrypt|hash|md5|crypto/i.test(t)) {
              funcInfo.transforms.push('hash');
              funcInfo.returnType = T.HASH;
            }
            // validation
            if (/isValid|validate|test\(|match\(|regex/i.test(t) && /return/.test(t)) {
              funcInfo.transforms.push('validate');
            }
            // return type
            if (/return\s+/.test(t)) {
              if (/return\s+(?:true|false|\d+)/.test(t)) funcInfo.returnType = T.CONSTANT;
              else if (/return\s+null|return\s+undefined/.test(t)) funcInfo.returnType = T.CONSTANT;
            }
          }

          if (depth < 0) {
            inFunc = null;
            funcBody = [];
          }
        }
      });
    }

    // ما نوع ما ترجعه الدالة؟
    getReturnType(funcName, argTypes) {
      const funcInfo = this.funcs.get(funcName);
      if (!funcInfo) return T.UNKNOWN;

      // لو الدالة تسوي sanitize على user input → sanitized
      if (funcInfo.returnType !== T.UNKNOWN) return funcInfo.returnType;

      // propagate من الـ args
      if (argTypes.some(t => DANGER_TYPES.has(t))) {
        if (funcInfo.transforms.includes('sanitize')) return T.SANITIZED;
        if (funcInfo.transforms.includes('hash')) return T.HASH;
        return T.USER_INPUT; // خطر ينتقل
      }

      return T.UNKNOWN;
    }
  }

  // ─── Alias Tracker ────────────────────────────────
  // يتتبع x = y = z
  class AliasTracker {
    constructor() {
      this.aliases = new Map();
    }

    set(name, source) { this.aliases.set(name, source); }

    // احصل على الـ root source
    resolve(name, visited = new Set()) {
      if (visited.has(name)) return name;
      visited.add(name);
      const alias = this.aliases.get(name);
      if (!alias || alias === name) return name;
      return this.resolve(alias, visited);
    }
  }

  // ─── Conditional Flow ─────────────────────────────
  // يفهم if/else
  class ConditionalFlow {
    constructor() {
      this.conditions = []; // { var, condition, safe }
    }

    // هل المتغير محمي بـ if?
    isProtected(varName, lineNum) {
      return this.conditions.some(c =>
        c.var === varName &&
        c.lineNum <= lineNum &&
        c.safe
      );
    }

    analyze(line, lineNum) {
      // if (user && isValid(user))
      const validM = line.match(/if\s*\(.*(?:isValid|validate|sanitize|typeof.*===|instanceof)\s*\((\w+)\)/);
      if (validM) {
        this.conditions.push({ var: validM[1], lineNum, safe: true });
      }

      // if (!user) return / if (user === null) return
      const nullM = line.match(/if\s*\(!(\w+)|if\s*\((\w+)\s*===?\s*(?:null|undefined)\)/);
      if (nullM) {
        const varName = nullM[1] || nullM[2];
        this.conditions.push({ var: varName, lineNum, safe: false, isNullCheck: true });
      }
    }
  }

  // ─── Loop Analyzer ────────────────────────────────
  class LoopAnalyzer {
    constructor() {
      this.accumulations = new Map(); // varName → { isAccumulating, lineNum }
    }

    analyze(line, lineNum) {
      // total = item.price (accumulation bug)
      const accM = line.match(/(\w+)\s*=\s*\w+\.\w+/);
      if (accM && !line.includes('+=') && !line.includes('let ') && !line.includes('const ')) {
        // تحقق إن في loop
        this.accumulations.set(accM[1], { bug: true, lineNum });
      }

      // total += item.price (صح)
      const okM = line.match(/(\w+)\s*\+=/);
      if (okM) {
        this.accumulations.set(okM[1], { bug: false, lineNum });
      }
    }

    hasAccumulationBug(varName) {
      const info = this.accumulations.get(varName);
      return info?.bug === true;
    }
  }

  // ─── Deep Analyzer ────────────────────────────────
  function analyze(code, fileName) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    const lang = ext === 'py' ? 'py' : ext === 'php' ? 'php' : 'js';

    const lines = code.split('\n');
    const varTypes = new Map();
    const funcAnalyzer = new FunctionAnalyzer();
    const aliasTracker = new AliasTracker();
    const condFlow = new ConditionalFlow();
    const loopAnalyzer = new LoopAnalyzer();
    const issues = [];

    // Pre-pass: تحليل الدوال
    funcAnalyzer.analyze(code);

    // Track loop context
    let inLoop = false;
    let loopDepth = 0;

    // ─── Main Pass ────────────────────────────────
    lines.forEach((line, i) => {
      const t = line.trim();
      const ln = i + 1;
      if (!t || t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;

      // Track loops
      if (/\.forEach\s*\(|for\s*\(|while\s*\(/.test(t)) {
        inLoop = true;
        loopDepth++;
      }
      loopDepth += (t.match(/\{/g)||[]).length - (t.match(/\}/g)||[]).length;
      if (loopDepth <= 0) { inLoop = false; loopDepth = 0; }

      // Conditional analysis
      condFlow.analyze(t, ln);

      // Loop analysis
      if (inLoop) loopAnalyzer.analyze(t, ln);

      // ── Variable Tracking ──────────────────────

      // User inputs
      if (lang === 'js') {
        // destructuring
        const destM = t.match(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*req\.(body|query|params)/);
        if (destM) {
          destM[1].split(',').forEach(v => {
            const name = v.trim().split(/[:=]/)[0].trim();
            if (name) varTypes.set(name, T.USER_INPUT);
          });
        }

        // direct assignment
        const dirM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*req\.(body|query|params)\.(\w+)/);
        if (dirM) varTypes.set(dirM[1], T.USER_INPUT);

        // env
        const envM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*process\.env/);
        if (envM) varTypes.set(envM[1], T.ENV);

        // function call - inter-procedural
        const callM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?(\w+)\s*\(([^)]*)\)/);
        if (callM) {
          const [, varName, funcName, argsStr] = callM;
          const args = argsStr.split(',').map(a => a.trim());
          const argTypes = args.map(a => varTypes.get(a) || T.UNKNOWN);
          const returnType = funcAnalyzer.getReturnType(funcName, argTypes);

          if (returnType !== T.UNKNOWN) {
            varTypes.set(varName, returnType);
          } else if (argTypes.some(t => DANGER_TYPES.has(t))) {
            varTypes.set(varName, T.USER_INPUT);
          }
        }

        // alias: x = y
        const aliasM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\s*;?\s*$/);
        if (aliasM) {
          aliasTracker.set(aliasM[1], aliasM[2]);
          const srcType = varTypes.get(aliasM[2]);
          if (srcType) varTypes.set(aliasM[1], srcType);
        }

        // SQL
        const sqlM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*["'`]([^"'`]*(?:SELECT|INSERT|UPDATE|DELETE)[^"'`]*)/i);
        if (sqlM) {
          varTypes.set(sqlM[1], sqlM[2].includes('?') ? T.SQL_SAFE : T.SQL_UNSAFE);
        }

        const sqlConcatM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*["'][^"']*(?:SELECT|INSERT|UPDATE|DELETE)/i);
        if (sqlConcatM && t.includes('+')) varTypes.set(sqlConcatM[1], T.SQL_UNSAFE);

        // secret
        const secM = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*["'][^"']{8,}["']/);
        if (secM && /KEY|SECRET|TOKEN|PASSWORD|PASS|API/i.test(secM[1])) {
          varTypes.set(secM[1], T.SECRET);
        }
      }

      if (lang === 'py') {
        const flaskM = t.match(/(\w+)\s*=\s*request\.(?:args|form|json)(?:\.get\(['"](\w+)['"]\)|\[['"](\w+)['"]\])/);
        if (flaskM) varTypes.set(flaskM[1], T.USER_INPUT);

        const envM = t.match(/(\w+)\s*=\s*os\.environ/);
        if (envM) varTypes.set(envM[1], T.ENV);

        const hashM = t.match(/(\w+)\s*=.*hashlib\.|(\w+)\s*=.*bcrypt/);
        if (hashM) varTypes.set(hashM[1]||hashM[2], T.HASH);
      }

      // ── Sink Analysis ──────────────────────────

      // SQL Sinks
      if (/\.(?:query|execute)\s*\(|cursor\.execute|mysqli_query/.test(t)) {
        // اكتشف SQL concat مباشر في نفس السطر
        const inlineSQL = t.match(/["'`][^"'`]*(?:SELECT|INSERT|UPDATE|DELETE)[^"'`]*["'`]\s*\+\s*(\w+)/i);
        if (inlineSQL) {
          const dangerVar = inlineSQL[1];
          if (varTypes.get(dangerVar) === T.USER_INPUT) {
            issues.push({
              type: 'SQL_INJECTION', sev: 'c', line: ln,
              title: `🔴 SQL Injection: ${dangerVar} في query مباشر`,
              ev: t, conf: 95, cIcon: '🔴', cAct: 'SQL_INJECTION',
            });
          }
        }
        const vars = (t.match(/\b([a-zA-Z_$]\w*)\b/g) || []);
        const resolvedVars = vars.map(v => aliasTracker.resolve(v));

        const queryVar = vars.find(v => {
          const resolved = aliasTracker.resolve(v);
          return varTypes.get(v) === T.SQL_UNSAFE || varTypes.get(resolved) === T.SQL_UNSAFE;
        });

        const hasParams = /\[/.test(t) && (/\?/.test(t) || /\$\d/.test(t));
        const queryVarType = queryVar ? (varTypes.get(queryVar) || T.UNKNOWN) : T.UNKNOWN;

        if (queryVar && queryVarType === T.SQL_UNSAFE && !hasParams) {
          issues.push({
            type: 'SQL_INJECTION', sev: 'c', line: ln,
            title: `🔴 SQL Injection: ${queryVar} يحتوي user input مباشر`,
            ev: t, conf: 95, cIcon: '🔴', cAct: 'SQL_INJECTION',
            reason: `${queryVar} = SQL_UNSAFE type`,
          });
        }
      }

      // XSS Sinks
      if (/res\.(?:send|write)\s*\(|\.innerHTML\s*=|document\.write\s*\(|echo\s+/.test(t)) {
        const vars = (t.match(/\b([a-zA-Z_$]\w*)\b/g) || []);
        const dangerVars = vars.filter(v => {
          const resolved = aliasTracker.resolve(v);
          const type = varTypes.get(v) || varTypes.get(resolved) || T.UNKNOWN;
          // تجاهل لو sanitized أو hash
          return type === T.USER_INPUT && !condFlow.isProtected(v, ln);
        });

        if (dangerVars.length > 0) {
          issues.push({
            type: 'XSS', sev: 'c', line: ln,
            title: `🔴 XSS: ${dangerVars[0]} وصل لـ output بدون sanitize`,
            ev: t, conf: 90, cIcon: '🔴', cAct: 'XSS',
            fix: `// sanitize ${dangerVars[0]} قبل الإخراج`,
          });
        }
      }

      // CMD Sinks
      if (/(?:exec|system|spawn|popen|os\.system|subprocess)\s*\(/.test(t)) {
        const vars = (t.match(/\b([a-zA-Z_$]\w*)\b/g) || []);
        const dangerVars = vars.filter(v => varTypes.get(v) === T.USER_INPUT);
        if (dangerVars.length > 0) {
          issues.push({
            type: 'CMD_INJECTION', sev: 'c', line: ln,
            title: `🔴 Command Injection: ${dangerVars[0]} في system command`,
            ev: t, conf: 93, cIcon: '🔴', cAct: 'CMD_INJECTION',
          });
        }
      }

      // Secrets
      if (varTypes.get(t.match(/(?:const|let|var)\s+(\w+)/)?.[1]) === T.SECRET) {
        const name = t.match(/(?:const|let|var)\s+(\w+)/)?.[1];
        if (name) {
          issues.push({
            type: 'HARDCODED_SECRET', sev: 'h', line: ln,
            title: `🟠 ${name} مُضمَّن — استخدم process.env.${name}`,
            ev: t, conf: 88, cIcon: '🟠', cAct: 'HARDCODED_SECRET',
            fix: `const ${name} = process.env.${name}`,
          });
        }
      }

      // Accumulation bugs in loops
      if (inLoop) {
        const accM = t.match(/(\w+)\s*=\s*\w+\.\w+/);
        if (accM && !t.includes('+=') && !t.includes('let ') && !t.includes('const ') && !t.includes('=>')) {
          const varName = accM[1];
          // تحقق إن المتغير معرّف قبل الـ loop بـ 0
          const prevDef = lines.slice(0, i).some(l => new RegExp(`\\b${varName}\\s*=\\s*0`).test(l));
          if (prevDef) {
            issues.push({
              type: 'ACCUMULATION', sev: 'c', line: ln,
              title: `🔴 خطأ تراكم: ${varName} = بدل +=`,
              ev: t, conf: 90, cIcon: '🔴', cAct: 'ACCUMULATION',
              fix: t.replace(`${varName} =`, `${varName} +=`),
            });
          }
        }
      }
    });

    return { issues, varTypes, funcAnalyzer, loopAnalyzer };
  }

  return { analyze, TYPES: T };
})();

if (typeof window !== 'undefined') window.DeepFlow = DeepFlow;
