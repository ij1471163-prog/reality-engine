// ═══════════════════════════════════════════════════════
// semantic_layer.js v1.0 — فهم النية والسياق الكامل
// يفهم: أسماء المتغيرات + التعليقات + سياق الدوال
// ═══════════════════════════════════════════════════════
"use strict";

var SemanticLayer = (() => {

  // ─── Variable Name Semantics ──────────────────────
  const VAR_SEMANTICS = {
    // User Input
    USER_INPUT: /^(?:user|input|param|query|body|request|req|form|data|payload|search|keyword|term|filter|name|email|phone|address|username|password|pass|pwd|token|key|value|text|msg|message|comment|content|post|get|put|delete|patch)(?:[A-Z_]|$)/i,

    // Admin/Auth
    ADMIN: /^(?:admin|root|super|master|owner|moderator|isAdmin|hasRole|role|permission|privilege|access|auth|authorized|authenticated)/i,

    // Secret/Sensitive
    SECRET: /^(?:secret|key|token|password|pass|pwd|credential|cert|private|api_key|apiKey|jwt|session|cookie|hash|salt|iv|cipher)/i,

    // DB/Query
    DB_QUERY: /^(?:query|sql|stmt|statement|command|execute|cursor|result|row|record|entity|model)/i,

    // Safe/Sanitized
    SAFE: /^(?:safe|clean|sanitized|escaped|encoded|validated|verified|filtered|stripped|purified)/i,

    // Counter/Total
    COUNTER: /^(?:total|sum|count|amount|price|cost|revenue|balance|score|rating|index|offset|limit|page)/i,

    // ID/Reference
    ID: /^(?:id|uid|uuid|guid|ref|handle|slug|key|code|number|num)/i,
  };

  // ─── Comment Semantics ────────────────────────────
  const COMMENT_SEMANTICS = {
    SAFE:      /(?:safe|trusted|validated|sanitized|whitelisted|verified|admin.only|internal.only)/i,
    DANGER:    /(?:TODO|FIXME|HACK|XXX|dangerous|unsafe|vulnerable|injection|XSS|SECURITY)/i,
    DEPRECATED:/(?:deprecated|legacy|old|temp|temporary|workaround|hack)/i,
    AUTH:      /(?:auth|authenticated|authorized|requires.login|admin.only|protected)/i,
    PUBLIC:    /(?:public|open|no.auth|unauthenticated|anonymous)/i,
  };

  // ─── Function Name Semantics ──────────────────────
  const FUNC_SEMANTICS = {
    VALIDATION: /^(?:validate|verify|check|assert|ensure|confirm|isValid|hasValid)/i,
    SANITIZE:   /^(?:sanitize|clean|escape|encode|filter|strip|purify|normalize)/i,
    AUTH:       /^(?:authenticate|authorize|login|logout|isAuth|hasRole|checkPerm)/i,
    HASH:       /^(?:hash|encrypt|sign|hmac|digest|bcrypt|argon)/i,
    DB:         /^(?:query|execute|find|findOne|findAll|save|insert|update|delete|remove|create)/i,
    RENDER:     /^(?:render|display|show|print|output|respond|send|write|emit)/i,
  };

  // ─── Analyze Variable Names ───────────────────────
  function analyzeVarName(name) {
    for (const [type, pattern] of Object.entries(VAR_SEMANTICS)) {
      if (pattern.test(name)) return type;
    }
    return 'UNKNOWN';
  }

  // ─── Analyze Function Name ────────────────────────
  function analyzeFuncName(name) {
    for (const [type, pattern] of Object.entries(FUNC_SEMANTICS)) {
      if (pattern.test(name)) return type;
    }
    return 'UNKNOWN';
  }

  // ─── Analyze Comments ─────────────────────────────
  function analyzeComments(code) {
    const result = {
      hasSafe: false,
      hasDanger: false,
      hasAuth: false,
      hasPublic: false,
      hasDeprecated: false,
      safeLines: [],
      dangerLines: [],
    };

    const lines = code.split('\n');
    lines.forEach((line, i) => {
      const t = line.trim();
      if (!t.startsWith('//') && !t.startsWith('*') && !t.startsWith('#')) return;

      for (const [type, pattern] of Object.entries(COMMENT_SEMANTICS)) {
        if (pattern.test(t)) {
          result['has' + type.charAt(0) + type.slice(1).toLowerCase()] = true;
          if (type === 'SAFE') result.safeLines.push(i + 1);
          if (type === 'DANGER') result.dangerLines.push(i + 1);
        }
      }
    });

    return result;
  }

  // ─── Extract Semantic Context ─────────────────────
  function extractContext(code, fileName) {
    const lines = code.split('\n');
    const context = {
      variables: new Map(),   // varName → semantic type
      functions: new Map(),   // funcName → semantic type
      comments: analyzeComments(code),
      isAuthFile: false,
      isPublicAPI: false,
      hasValidation: false,
      hasSanitization: false,
      framework: 'unknown',
    };

    // Framework detection
    if (/express|app\.(get|post|put|delete)/.test(code)) context.framework = 'express';
    else if (/flask|@app\.route/.test(code)) context.framework = 'flask';
    else if (/django|urlpatterns/.test(code)) context.framework = 'django';
    else if (/laravel|Route::/.test(code)) context.framework = 'laravel';

    // File-level semantics
    const fn = (fileName || '').toLowerCase();
    if (/auth|login|user|account|session/.test(fn)) context.isAuthFile = true;
    if (/route|api|controller|handler/.test(fn)) context.isPublicAPI = true;

    // Parse lines
    lines.forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('#')) return;

      // Extract variable names
      const varMatch = t.match(/(?:const|let|var)\s+(\w+)/g);
      if (varMatch) {
        varMatch.forEach(m => {
          const name = m.replace(/(?:const|let|var)\s+/, '');
          const semantic = analyzeVarName(name);
          context.variables.set(name, semantic);
        });
      }

      // Destructuring
      const destMatch = t.match(/\{([^}]+)\}\s*=/);
      if (destMatch) {
        destMatch[1].split(',').forEach(v => {
          const name = v.trim().split(/[:=]/)[0].trim();
          if (name) context.variables.set(name, analyzeVarName(name));
        });
      }

      // Function names
      const funcMatch = t.match(/(?:function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\())/);
      if (funcMatch) {
        const name = funcMatch[1] || funcMatch[2];
        if (name) {
          const semantic = analyzeFuncName(name);
          context.functions.set(name, semantic);
          if (semantic === 'VALIDATION') context.hasValidation = true;
          if (semantic === 'SANITIZE') context.hasSanitization = true;
        }
      }
    });

    return context;
  }

  // ─── Generate Semantic Issues ─────────────────────
  function analyze(code, fileName) {
    const ctx = extractContext(code, fileName);
    const issues = [];
    const lines = code.split('\n');

    lines.forEach((line, i) => {
      const t = line.trim();
      const ln = i + 1;
      if (!t || t.startsWith('//') || t.startsWith('#')) return;

      // تحقق من تعليق SAFE
      const prevComment = lines[i - 1] ? lines[i - 1].trim() : '';
      const hasSafeComment = COMMENT_SEMANTICS.SAFE.test(prevComment);
      if (hasSafeComment) return;

      // اكتشف: متغير secret يُستخدم في output
      ctx.variables.forEach((semantic, name) => {
        if (semantic !== 'SECRET') return;
        const regex = new RegExp(`\\b${name}\\b`);
        if (!regex.test(t)) return;

        // هل في سطر output؟
        if (/console\.(log|info|warn)|res\.(send|json)|print\s*\(|echo\s+/.test(t)) {
          issues.push({
            type: 'SECRET_EXPOSURE', sev: 'h', line: ln,
            title: `🟠 ${name} (secret) مكشوف في output`,
            ev: t, conf: 85, cIcon: '🟠', cAct: 'SECRET_EXPOSURE',
            source: 'SemanticLayer',
          });
        }
      });

      // اكتشف: user input يصل لـ DB مباشرة بدون validation
      ctx.variables.forEach((semantic, name) => {
        if (semantic !== 'USER_INPUT') return;
        const regex = new RegExp(`\\b${name}\\b`);
        if (!regex.test(t)) return;

        // DB query بدون sanitization
        if (/\.(query|execute|find|save)\s*\(/.test(t) && !ctx.hasSanitization) {
          const alreadyParamterized = /\[\s*\w/.test(t) || /\?\s*[,\]]/.test(t);
          if (!alreadyParamterized) {
            issues.push({
              type: 'UNSANITIZED_DB', sev: 'c', line: ln,
              title: `🔴 ${name} (user input) → DB بدون validation`,
              ev: t, conf: 88, cIcon: '🔴', cAct: 'UNSANITIZED_DB',
              source: 'SemanticLayer',
            });
          }
        }
      });

      // اكتشف: دالة admin بدون auth check
      if (ctx.isPublicAPI && !ctx.isAuthFile) {
        const funcMatch = t.match(/function\s+(\w+)|(?:const|let)\s+(\w+)\s*=.*=>/);
        if (funcMatch) {
          const name = funcMatch[1] || funcMatch[2] || '';
          if (FUNC_SEMANTICS.DB.test(name) && !ctx.comments.hasAuth) {
            issues.push({
              type: 'MISSING_AUTH', sev: 'm', line: ln,
              title: `🟡 ${name}() — تحقق من Auth Middleware`,
              ev: t, conf: 65, cIcon: '🟡', cAct: 'MISSING_AUTH',
              source: 'SemanticLayer',
            });
          }
        }
      }

      // اكتشف: counter يستخدم = بدل +=
      ctx.variables.forEach((semantic, name) => {
        if (semantic !== 'COUNTER') return;
        const assignRegex = new RegExp(`\\b${name}\\s*=(?!=|\\+)\\s*\\w+\\.\\w+`);
        if (assignRegex.test(t) && !/let\s|const\s|var\s/.test(t)) {
          issues.push({
            type: 'COUNTER_ASSIGN', sev: 'c', line: ln,
            title: `🔴 ${name} (counter) يستخدم = بدل += — خطأ تراكم`,
            ev: t,
            fix: t.replace(`${name} =`, `${name} +=`),
            conf: 92, cIcon: '🔴', cAct: 'ACCUMULATION',
            source: 'SemanticLayer',
          });
        }
      });
    });

    return { issues, context: ctx };
  }

  return { analyze, extractContext, analyzeVarName, analyzeFuncName };
})();

if (typeof window !== 'undefined') window.SemanticLayer = SemanticLayer;
if (typeof module !== 'undefined') module.exports = SemanticLayer;
