// ═══════════════════════════════════════════════════════
// fix_verifier.js v2.0 — بوابة التحقق الوحيدة
//
// الدور: هذا الملف هو **المصدر الوحيد** لمنطق التحقق من صحة أي إصلاح.
//        fixers_orchestrator.js ينسّق فقط ويستدعي هذا الملف، ولا يملك منطق
//        تحقق مستقلًا. وجود منطقَي تحقق مختلفين كان يعني احتمال أن يقول
//        المنسق ACCEPTED بينما يقول الـVerifier شيئًا آخر.
//
// المشاكل التي يعالجها هذا الإصدار مقارنة بـv1.0:
//   [1] غياب analyzeFunc كان يُنتج **قبولًا صامتًا**: origIssues=[] و
//       fixedIssues=[] ⇒ لا newIssues ولا resolvedIssues ⇒ يسقط في فرع
//       'لا تغيير في المشاكل' مع valid:true. أي أن أي تعديل، مهما كان،
//       يمر بلا تحقق. الآن: غياب المحلل = رفض فوري (Fail-Closed).
//   [2] الهوية كانت `line:type`، فأي إصلاح يُزيح الأسطر يجعل نفس المشكلة
//       تبدو "اختفت وظهرت جديدة". الآن الهوية مستقرة ولا تعتمد على السطر.
//   [3] newIssues كانت تُحسب للـcritical فقط (i.sev === 'c')، فإضافة مشكلة
//       high/medium/low تمر. الآن أي زيادة في أي هوية = تدهور.
//   [4] المقارنة كانت بالعدد الإجمالي + Set. حالة "أصلح واحدة وكسر أخرى من
//       نفس النوع" تعطي 2→2 فتمر بل وتُحسب improved. الآن المقارنة بالعدّ
//       لكل هوية على حدة، فلا تمر.
//   [5] لم يكن هناك أي فحص تركيبي (syntax). الآن يوجد، وحسب لغة الملف.
//   [6] quickCheck كان يفحص /function\s+\w+/ على أي لغة، فملف Python يعطي
//       دائمًا [] ويمر الفحص بلا معنى. الآن الفحوص اللغوية تُطبَّق على
//       لغتها فقط، وما عداها يُتخطى صراحةً بدل ادعاء الفحص.
//
// ⚠️ حدود مُعلنة:
//   - فحص hardcoded secrets هنا **إشارة إضافية لا ضمان**. regex واحد لا
//     يكتشف كل الأسرار. لا تعتمد عليه كضمان أمني.
//   - التحقق يثبت أن "الوضع لم يسُؤ وتحسّن بمقدار ما"، ولا يثبت أن الإصلاح
//     عالج المشكلة المقصودة تحديدًا. لإثبات أدق يجب أن يُصرّح الـfixer
//     بالمشكلة المستهدفة.
//   - لا يوجد فاحص تركيبي لـPython/PHP/Java/C/Ruby/Go. لا نفحصها بأداة
//     JavaScript لأن ذلك ينتج نتيجة خاطئة لا نتيجة ناقصة.
//
// التوافق: الواجهة القديمة (verify / quickCheck / fullVerify) محفوظة بنفس
//          التواقيع. أُضيفت حقول جديدة للقيمة المُعادة وأُضيف verifyFix().
// ═══════════════════════════════════════════════════════
"use strict";

var FixVerifier = (() => {

  // ═══════════════════════════════════════════════
  // اللغة والفحص التركيبي
  // ═══════════════════════════════════════════════

  function detectLanguage(filename) {
    const m = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    if (!m) return "unknown";
    switch (m[1]) {
      case "js": case "mjs": case "cjs": case "jsx": return "javascript";
      case "ts": case "tsx":                          return "typescript";
      case "json":                                    return "json";
      case "py":                                      return "python";
      case "php":                                     return "php";
      case "java":                                    return "java";
      case "cs":                                      return "csharp";
      case "c": case "h":                             return "c";
      case "cpp": case "cc": case "hpp":              return "cpp";
      case "rb":                                      return "ruby";
      case "go":                                      return "go";
      case "html": case "htm":                          return "html";
      default:                                        return "unknown";
    }
  }

  /**
   * @returns {{ok, available, language, reason}}
   *   available=false ⇒ لا فاحص لهذه اللغة. لا يُعتبر نجاحًا أبدًا.
   */
  /**
   * Python structural syntax check — بدون dependency خارجية.
   *
   * هذا ليس Python parser كاملًا.
   * الهدف: منع إصلاحات واضحة الكسر قبل الـdeep verification.
   */
  function pythonStructuralSyntaxCheck(code) {
    const lines = String(code).replace(/\r\n?/g, "\n").split("\n");
    const stack = [];
    const indentStack = [0];
    let expectIndent = false;

    const pairs = { "(": ")", "[": "]", "{": "}" };
    const closing = new Set([")", "]", "}"]);

    // [FIX] تستلم حالة الاقتباس الثلاثي الواردة بدل أن تبدأ من null. بلا
    // ذلك يُرفض كل نص متعدد الأسطر عند سطر افتتاحه.
    function scanLine(raw, carriedTriple) {
      let out = "";
      let quote = null;
      let triple = carriedTriple || null;
      let escaped = false;

      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        const n1 = raw[i + 1];
        const n2 = raw[i + 2];

        if (triple) {
          if (c === triple && n1 === triple && n2 === triple) {
            out += "   ";
            i += 2;
            triple = null;
          } else {
            out += " ";
          }
          continue;
        }

        if (quote) {
          out += " ";

          if (escaped) {
            escaped = false;
          } else if (c === "\\") {
            escaped = true;
          } else if (c === quote) {
            quote = null;
          }

          continue;
        }

        if (
          (c === "'" || c === '"') &&
          n1 === c &&
          n2 === c
        ) {
          triple = c;
          out += "   ";
          i += 2;
          continue;
        }

        if (c === "'" || c === '"') {
          quote = c;
          out += " ";
          continue;
        }

        if (c === "#") break;

        out += c;
      }

      return { code: out, quote, triple };
    }

    /*
     * [FIX] وحدة الفحص هي السطر المنطقي لا الفيزيائي.
     *
     * كان كل سطر فيزيائي يُعامَل كعبارة مستقلة، فسطر الاستمرار — داخل أقواس
     * مفتوحة، أو بعد backslash، أو داخل نص ثلاثي — تُفحَص إزاحته فيُرفض
     * بـ"unexpected indentation"، ويُرفض كل نص متعدد الأسطر بـ"unterminated
     * Python string". سبع حالات كود صحيح مقيسة.
     *
     * والقاعدة مأخوذة من CPython (ast.parse) لا مُستنتجة: داخل الاستمرار
     * الإزاحة بلا معنى نحوي، أما السطر الذي يلي **انتهاء** الاستمرار فيُفحَص
     * كالمعتاد. ولهذا لا يكفي تخطّي الإزاحة عند depth > 0: لو فُعل ذلك وحده
     * لضاع كشف الإزاحة الخاطئة بعد انتهاء الاستمرار. فالضبط على الوحدة:
     *   • السطر المنطقي يبدأ عند سطر فيزيائي ليس استمرارًا.
     *   • إزاحته إزاحة سطره الأول.
     *   • نصه تجميع نصوص أسطره، فترويسة ممتدة مثل  if foo(\n 1\n):  تنتهي
     *     بـcolon فتُعدّ ترويسة كتلة، ومفتاح dict مثل  "a":  وسطُها فلا يُعدّ.
     * ومنطق الإزاحة والكتل أدناه لم يتغيّر — تغيّر ما يُطبَّق عليه فقط.
     */
    const logical = [];
    let current = null;
    let carriedTriple = null;
    let pendingJoin = false;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const isContinuation = !!carriedTriple || pendingJoin || stack.length > 0;

      if (!isContinuation && !raw.trim()) continue;

      const leadingMatch = raw.match(/^[ \t]*/);
      const leading = leadingMatch ? leadingMatch[0] : "";

      // لا نسمح بخلط tab وspaces داخل نفس indentation — لبداية العبارة فقط،
      // فإزاحة سطر الاستمرار بلا معنى نحوي.
      if (!isContinuation && leading.includes(" ") && leading.includes("\t")) {
        return {
          ok: false,
          available: true,
          language: "python",
          reason: "mixed tabs and spaces in indentation at line " + (i + 1)
        };
      }

      const scanned = scanLine(raw.slice(leading.length), carriedTriple);

      // اقتباس مفرد غير منتهٍ على سطر واحد خطأ فعلي. أما الثلاثي فيُحمَل،
      // ويُفحَص عند نهاية الملف.
      if (scanned.quote) {
        return {
          ok: false,
          available: true,
          language: "python",
          reason: "unterminated Python string at line " + (i + 1)
        };
      }

      // تحقق الأقواس خارج strings/comments — بأرقام الأسطر الفيزيائية.
      for (let j = 0; j < scanned.code.length; j++) {
        const c = scanned.code[j];

        if (pairs[c]) {
          stack.push({
            expected: pairs[c],
            line: i + 1
          });
        } else if (closing.has(c)) {
          if (
            !stack.length ||
            stack[stack.length - 1].expected !== c
          ) {
            return {
              ok: false,
              available: true,
              language: "python",
              reason: "unmatched '" + c + "' at line " + (i + 1)
            };
          }

          stack.pop();
        }
      }

      carriedTriple = scanned.triple;
      pendingJoin = !carriedTriple && /\\$/.test(raw.replace(/\s+$/, ""));

      if (isContinuation) {
        if (current) current.text += " " + scanned.code;
        continue;
      }

      current = {
        line: i + 1,
        indent: leading.replace(/\t/g, "    ").length,
        text: scanned.code
      };
      logical.push(current);
    }

    if (carriedTriple) {
      return {
        ok: false,
        available: true,
        language: "python",
        reason: "unterminated Python string at end of file"
      };
    }

    // ── الإزاحة والكتل: نفس المنطق، مطبَّقًا على الأسطر المنطقية ──
    for (const entry of logical) {
      const clean = entry.text.trim();

      if (!clean) continue;

      const indent = entry.indent;

      // بعد block header، السطر التالي يجب أن يكون أعمق.
      if (expectIndent) {
        const parentIndent = indentStack[indentStack.length - 1];

        if (indent <= parentIndent) {
          return {
            ok: false,
            available: true,
            language: "python",
            reason: "expected indented block after line " + (entry.line - 1)
          };
        }

        // مستوى الجسم الجديد يصبح المستوى الحالي.
        indentStack.push(indent);
        expectIndent = false;
      } else {
        const currentIndent = indentStack[indentStack.length - 1];

        if (indent === currentIndent) {
          // نفس مستوى الـblock الحالي — صحيح.
        } else if (indent < currentIndent) {
          // الرجوع إلى مستوى سابق.
          while (
            indentStack.length > 1 &&
            indent < indentStack[indentStack.length - 1]
          ) {
            indentStack.pop();
          }

          if (indent !== indentStack[indentStack.length - 1]) {
            return {
              ok: false,
              available: true,
              language: "python",
              reason: "inconsistent indentation at line " + entry.line
            };
          }
        } else {
          // زيادة indentation بدون block header.
          return {
            ok: false,
            available: true,
            language: "python",
            reason: "unexpected indentation at line " + entry.line
          };
        }
      }

      /*
       * Block header محافظ:
       * نعترف بالـcolon عندما يكون آخر token في السطر المنطقي.
       * هذا يغطي def/if/for/while/class/try/except/with...
       * ولا يعتبر colon داخل expression بداية block.
       */
      if (/:$/.test(clean)) {
        expectIndent = true;
      }
    }

    if (stack.length) {
      return {
        ok: false,
        available: true,
        language: "python",
        reason:
          "unclosed '" +
          stack[stack.length - 1].expected +
          "' opened at line " +
          stack[stack.length - 1].line
      };
    }

    if (expectIndent) {
      return {
        ok: false,
        available: true,
        language: "python",
        reason: "expected indented block at end of file"
      };
    }

    return {
      ok: true,
      available: true,
      language: "python",
      reason: null
    };
  }

  // ─── فاحص بنيوي محافظ لـPHP ──────────────────────────
  // [PHP-GATE] كان كل إصلاح PHP يموت عند البوابة بـ
  //   REJECTED_NO_SYNTAX_CHECKER [php]
  // لا لعيب فيه بل لأن البوابة لا تملك فاحصًا للغة. والمقيس: إصلاح XSS صحيح
  // تمامًا — ‎echo htmlspecialchars($_GET["name"], ENT_QUOTES, "UTF-8")‎ —
  // رفضته البوابة بهذا السبب، ومع تجاوز صريح قبلته وأزال بلاغًا بلا تدهور.
  // أي أن PHP كاشفةٌ فقط في المنظومة كلها: repairCode وSmartRepair وEmergency
  // كلها تتعطّل عند هذه النقطة لا عند منطقها.
  //
  // والفاحص أدناه ليس جديدًا: هو نفسه المستعمل في مسار الخادم
  // (server_engine_registration.js)، منقولٌ هنا حرفًا بحرف ليراه مسار المتصفح
  // أيضًا — وfix_verifier.js مشترك بين المسارين (الخادم يُحمّله بـrequire).
  // واختبار «لا انحراف» يثبّت تطابق النسختين نصًّا كي لا تتباعدا.
  //
  // وهو ليس parser: توازن أقواس ونصوص وتعليقات، يُرجع "unknown" عند أي بنية
  // لا يفهمها بثقة (heredoc، أو ملف فيه ?>) بدل التخمين. والتعيين على البوابة
  // يحفظ Fail-Closed بالحرف:
  //   "ok"       ⇒ available:true,  ok:true   ⇒ يكمل باقي فحوص البوابة
  //   "broken…"  ⇒ available:true,  ok:false  ⇒ REJECTED_SYNTAX_BROKEN
  //   "unknown"  ⇒ available:false            ⇒ REJECTED_NO_SYNTAX_CHECKER
  //                                             (نفس مسار اليوم بالضبط)
  function structuralSyntax(code, lang) {
    const php = lang === "php";
    if (php && (/<<<\s*['"]?\w/.test(code) || /\?>/.test(code))) return "unknown";
    const stack = [];
    const close = { ")": "(", "]": "[", "}": "{" };
    let i = 0, prev = "";           // prev = آخر رمز مهم (لتمييز regex عن القسمة)
    const n = code.length;
    const tpl = [];                 // مستويات ${ داخل template literal
    const exprBefore = () => prev === "" || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) ||
      /^(return|typeof|case|in|of|delete|void|throw|new|instanceof|yield|await)$/.test(prev);
    while (i < n) {
      const c = code[i], d = code[i + 1];
      if (c === "/" && d === "/" || (php && c === "#" && d !== "[")) { while (i < n && code[i] !== "\n") i++; continue; }
      if (c === "/" && d === "*") { const e = code.indexOf("*/", i + 2); if (e < 0) return "broken: unterminated comment"; i = e + 2; continue; }
      if (c === "'" || c === '"' || (!php && c === "`")) {
        const q = c; i++;
        while (i < n) {
          const ch = code[i];
          if (ch === "\\") { i += 2; continue; }
          if (ch === q) break;
          if (!php && q !== "`" && ch === "\n") return "broken: unterminated string";
          if (q === "`" && ch === "$" && code[i + 1] === "{") { tpl.push(stack.length); stack.push("${"); i += 2; break; }
          i++;
        }
        if (i >= n) return "broken: unterminated string";
        if (code[i] === q) { i++; prev = "str"; }
        continue;
      }
      if (!php && c === "/" && exprBefore()) {          // regex literal
        i++; let cls = false;
        while (i < n) {
          const ch = code[i];
          if (ch === "\n") return "unknown";
          if (ch === "\\") { i += 2; continue; }
          if (ch === "[") cls = true; else if (ch === "]") cls = false;
          else if (ch === "/" && !cls) break;
          i++;
        }
        if (i >= n) return "unknown";
        i++; while (i < n && /[a-z]/i.test(code[i])) i++;
        prev = "re"; continue;
      }
      if ("([{".includes(c)) { stack.push(c); prev = c; i++; continue; }
      if (")]}".includes(c)) {
        const top = stack.pop();
        if (c === "}" && top === "${") {                 // عودة إلى داخل template literal
          tpl.pop(); i++;
          while (i < n) {
            const ch = code[i];
            if (ch === "\\") { i += 2; continue; }
            if (ch === "`") break;
            if (ch === "$" && code[i + 1] === "{") { tpl.push(stack.length); stack.push("${"); i += 2; break; }
            i++;
          }
          if (i >= n) return "broken: unterminated template";
          if (code[i] === "`") { i++; prev = "str"; }
          continue;
        }
        if (top !== close[c]) return `broken: unexpected '${c}'`;
        prev = c; i++; continue;
      }
      if (/\s/.test(c)) { i++; continue; }
      if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < n && /[\w$]/.test(code[j])) j++; prev = code.slice(i, j); i = j; continue; }
      prev = c; i++;
    }
    if (stack.length) return `broken: unclosed '${stack[stack.length - 1]}'`;
    return "ok";
  }

  function syntaxCheck(code, filename) {
    const language = detectLanguage(filename);

    if (language === "json") {
      try { JSON.parse(code); return { ok: true, available: true, language, reason: null }; }
      catch (e) { return { ok: false, available: true, language, reason: "JSON parse error: " + e.message }; }
    }

    if (language === "typescript") {
      try {
        if (typeof ts !== "undefined" && ts && typeof ts.transpileModule === "function") {
          const out = ts.transpileModule(code, { reportDiagnostics: true, compilerOptions: { noEmit: true } });
          const errs = (out.diagnostics || []).filter(d => d.category === 1);
          if (errs.length) {
            const msg = typeof ts.flattenDiagnosticMessageText === "function"
              ? ts.flattenDiagnosticMessageText(errs[0].messageText, " ") : String(errs[0].messageText);
            return { ok: false, available: true, language, reason: "TS error: " + msg };
          }
          return { ok: true, available: true, language, reason: null };
        }
      } catch (e) {
        return { ok: false, available: true, language, reason: "TS check failed: " + e.message };
      }
      return { ok: false, available: false, language, reason: "no TypeScript compiler available" };
    }

    if (language === "python") {
      return pythonStructuralSyntaxCheck(code);
    }

    // [PHP-GATE] PHP وحدها في هذه الخطوة. وTypeScript تبقى كما هي (مُترجم أو
    // لا حكم) — تحويلها إلى الفاحص البنيوي يغيّر قبولها بلا قياس يوجبه.
    if (language === "php") {
      const v = structuralSyntax(code, "php");
      if (v === "ok") return { ok: true, available: true, language, reason: null };
      if (v === "unknown") {
        return { ok: false, available: false, language,
          reason: "php structure not decidable (heredoc or close-tag) - no verdict" };
      }
      return { ok: false, available: true, language, reason: v };
    }

    if (language === "javascript") {
      try {
        if (typeof acorn !== "undefined" && acorn && typeof acorn.parse === "function") {
          acorn.parse(code, { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: true });
          return { ok: true, available: true, language, reason: null };
        }
      } catch (e) {
        try {
          acorn.parse(code, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true });
          return { ok: true, available: true, language, reason: null };
        } catch (e2) {
          return { ok: false, available: true, language, reason: "acorn parse error: " + e2.message };
        }
      }

      try {
        if (typeof esprima !== "undefined" && esprima && typeof esprima.parseModule === "function") {
          esprima.parseModule(code, { tolerant: false });
          return { ok: true, available: true, language, reason: null };
        }
      } catch (e) {
        return { ok: false, available: true, language, reason: "esprima parse error: " + e.message };
      }

      try {
        if (typeof Function === "function") {
          // تجميع بدون تنفيذ إطلاقًا
          // eslint-disable-next-line no-new-func
          new Function(code);
          return { ok: true, available: true, language, reason: null };
        }
      } catch (e) {
        if (e instanceof SyntaxError) {
          // new Function لا يفهم import/export رغم أنها صيغة صحيحة
          if (/\b(import|export)\b/.test(code) && /(import|export|Unexpected token)/i.test(e.message)) {
            return { ok: false, available: false, language,
              reason: "ES module syntax - new Function() cannot verify it (needs acorn/esprima)" };
          }
          return { ok: false, available: true, language, reason: "SyntaxError: " + e.message };
        }
        return { ok: true, available: true, language, reason: null };
      }
      return { ok: false, available: false, language, reason: "no JS syntax checker available" };
    }

    return {
      ok: false, available: false, language,
      reason: language === "unknown" ? "unknown file type - no syntax checker"
                                     : "no syntax checker available for language: " + language
    };
  }

  // ═══════════════════════════════════════════════
  // هوية المشكلة + التطبيع
  // ═══════════════════════════════════════════════

  function normalizeIssues(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.issues)) return raw.issues;
    return null; // ⚠️ null ≠ [] : null تعني "تعذّر التحليل" لا "صفر مشاكل"
  }

  /** يوحّد الصيغ المختصرة والكاملة: c/critical، h/high، m/medium، l/low. */
  function normalizeSeverity(issue) {
    const raw = issue && (issue.severity || issue.sev || issue.level || issue.priority);
    if (!raw) return "unknown";
    const s = String(raw).toLowerCase();
    if (s === "c" || s === "critical" || s === "severe") return "critical";
    if (s === "h" || s === "high" || s === "error")      return "high";
    if (s === "m" || s === "medium" || s === "warning" || s === "warn") return "medium";
    if (s === "l" || s === "low" || s === "info" || s === "note")       return "low";
    return s;
  }

  function isHighSeverity(issue) {
    const s = normalizeSeverity(issue);
    return s === "critical" || s === "high";
  }

  /**
   * هوية مستقرة: لا تعتمد على رقم السطر ولا على نص الكود.
   * لا نفترض وجود i.type - نقبل أي معرّف متاح بالترتيب.
   */
  // وسم تصنيف: الأرقام فيه ذات معنى (CWE-89 ليست CWE-78) — تُحفظ
  function _normTag(s) {
    return String(s).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
  }
  // نصّ حر: الأرقام والصياغة لا تصنع هوية جديدة (نفس قاعدة الفرع النصّي)
  function _normText(s) {
    return String(s).toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 80);
  }

  // [FIX] type وحده خشن جدًا: "bug" يغطي == و var و أخطاء التراكم. فمشكلة
  // جديدة كانت تختفي مقابل مشكلة أخرى مختلفة أُصلحت تحت نفس المفتاح
  // (bug|f: 2 → 2 ⇒ worsened = 0 ⇒ "بلا تدهور")، والشدّة لا تدخل القرار
  // حين يكون worsened فارغًا. يُضاف تمييز بنيوي: cwe/cAct/strategy ثوابت
  // تصنيف لا تحمل أسماء المستخدم — بخلاف title ("Dead Assignment: b") الذي
  // لو اعتُمد خامًا صارت إعادة تسمية متغيّر مشكلةً جديدة.
  function issueFacet(issue) {
    // ruleId/rule/id هوية صريحة بذاتها — لا تُجزَّأ أكثر
    if (issue.ruleId || issue.rule || issue.id) return "";
    const structural = issue.cwe || issue.cAct || issue.strategy;
    if (structural) return _normTag(structural);
    const text = issue.title || issue.message || issue.name || "";
    return text ? "t:" + _normText(text) : "";
  }

  function issueKey(issue, fallbackFile) {
    if (issue == null) return "unknown";
    if (typeof issue === "string") {
      return "raw|" + String(issue).replace(/\s+/g, "").toLowerCase().replace(/\d+/g, "#").slice(0, 100);
    }
    // نفس ترتيب الأولوية السابق؛ الفرق أن القيمة النصّية (name/title) تُعيَّر
    // بدل أن تدخل خامًا، فاختلاف الصياغة أو الأرقام لا يصنع هوية جديدة.
    let stable = issue.ruleId || issue.rule || issue.id || issue.type, fromText = false;
    if (!stable) { stable = issue.name || issue.title; fromText = !!stable; }
    if (!stable) stable = issue.category || "issue";
    const base = fromText ? "t:" + _normText(stable) : String(stable);
    const file = issue.file || issue.filename || fallbackFile || "";
    return base + "|" + issueFacet(issue) + "|" + String(file);
  }

  function issueCounts(issues, fallbackFile) {
    const m = new Map();
    (issues || []).forEach(i => {
      const k = issueKey(i, fallbackFile);
      m.set(k, (m.get(k) || 0) + 1);
    });
    return m;
  }

  /**
   * مقارنة بالعدّ لكل هوية. هذا ما يمنع مرور "أصلح واحدة وكسر أخرى من نفس
   * النوع" (2→2)، ويمنع رفض "أصلح واحدة من اثنتين" خطأً (2→1).
   */
  function diffCounts(beforeIssues, afterIssues, fallbackFile) {
    const before = issueCounts(beforeIssues, fallbackFile);
    const after = issueCounts(afterIssues, fallbackFile);
    const keys = new Set([...before.keys(), ...after.keys()]);

    const afterByKey = new Map();
    (afterIssues || []).forEach(i => {
      const k = issueKey(i, fallbackFile);
      if (!afterByKey.has(k)) afterByKey.set(k, []);
      afterByKey.get(k).push(i);
    });

    const worsened = [], improved = [];
    let removedCount = 0, addedCount = 0, addedHighSeverity = 0;

    keys.forEach(k => {
      const b = before.get(k) || 0;
      const a = after.get(k) || 0;
      if (a > b) {
        const delta = a - b;
        const sample = (afterByKey.get(k) || []).slice(0, delta);
        const high = sample.filter(isHighSeverity).length;
        worsened.push({ key: k, before: b, after: a, added: delta, addedHighSeverity: high });
        addedCount += delta;
        addedHighSeverity += high;
      } else if (a < b) {
        const delta = b - a;
        improved.push({ key: k, before: b, after: a, removed: delta });
        removedCount += delta;
      }
    });

    return { worsened, improved, removedCount, addedCount, addedHighSeverity };
  }

  // ═══════════════════════════════════════════════
  // quickCheck — دفاع إضافي فقط، ليس صاحب القرار
  // ═══════════════════════════════════════════════

  /**
   * فحوص بنيوية سريعة. ليست بديلًا عن syntax أو analyzer.
   * الفحوص اللغوية تُطبَّق على لغتها فقط؛ ما عداها يُتخطى صراحةً
   * (skipped) بدل ادعاء فحص لم يحدث.
   */
  function quickCheck(originalCode, fixedCode, fileName) {
    const checks = [];
    const skipped = [];
    const language = detectLanguage(fileName);

    const add = (id, valid, reason) => checks.push({ id, valid, reason });

    // 1) الكود لم يصبح فارغًا — تنطبق على كل اللغات
    if (!fixedCode || String(fixedCode).trim().length < 10) {
      add("not_empty", false, "الكود أصبح فارغاً");
      return { valid: false, language, checks, skipped, failedChecks: checks.filter(c => !c.valid) };
    }
    add("not_empty", true, null);

    // 2) لم يُحذف جزء كبير — تنطبق على كل اللغات
    const origLines = String(originalCode).split("\n").length;
    const fixedLines = String(fixedCode).split("\n").length;
    if (fixedLines < origLines * 0.5) {
      add("no_mass_deletion", false, "حُذف أكثر من 50% من الأسطر");
    } else {
      add("no_mass_deletion", true, null);
    }

    // 3) الدوال الرئيسية ما زالت موجودة — JS/TS فقط.
    //    (v1.0 كانت تطبّق /function\s+\w+/ على أي لغة، فملف Python يعطي []
    //     دائمًا ويمر الفحص بلا أي معنى.)
    if (language === "javascript" || language === "typescript") {
      const origFuncs = String(originalCode).match(/function\s+\w+/g) || [];
      const fixedFuncs = String(fixedCode).match(/function\s+\w+/g) || [];
      const missing = origFuncs.filter(f => !fixedFuncs.includes(f));
      if (origFuncs.length > 0 && missing.length > origFuncs.length * 0.3) {
        add("functions_preserved", false, "دوال محذوفة: " + missing.join(", "));
      } else {
        add("functions_preserved", true, null);
      }
    } else {
      skipped.push({ id: "functions_preserved", reason: "فحص خاص بـJS/TS - لا يُطبَّق على: " + language });
    }

    // 4) لم يُضف eval — JS/TS فقط (الصيغة تختلف جذريًا في لغات أخرى)
    if (language === "javascript" || language === "typescript") {
      const o = (String(originalCode).match(/\beval\s*\(/g) || []).length;
      const f = (String(fixedCode).match(/\beval\s*\(/g) || []).length;
      if (f > o) add("no_new_eval", false, "الإصلاح أضاف eval()");
      else add("no_new_eval", true, null);
    } else {
      skipped.push({ id: "no_new_eval", reason: "فحص خاص بـJS/TS - لا يُطبَّق على: " + language });
    }

    // 5) لم تُضف أسرار مكتوبة في الكود.
    //    ⚠️ إشارة لا ضمان: regex واحد لا يكتشف كل أنماط الأسرار.
    const secretRe = /(?:password|passwd|secret|api[_-]?key|token|private[_-]?key)\s*[:=]\s*["'][^"']{6,}["']/gi;
    const oS = (String(originalCode).match(secretRe) || []).length;
    const fS = (String(fixedCode).match(secretRe) || []).length;
    if (fS > oS) add("no_new_hardcoded_secret", false, "الإصلاح أضاف سرًا مكتوبًا في الكود (إشارة لا ضمان)");
    else add("no_new_hardcoded_secret", true, null);

    const failedChecks = checks.filter(c => !c.valid);
    return { valid: failedChecks.length === 0, language, checks, skipped, failedChecks };
  }

  // ═══════════════════════════════════════════════
  // verify — التحقق العميق (analyzer-based)
  // ═══════════════════════════════════════════════

  /**
   * ⚠️ تغيّر جوهري عن v1.0: غياب analyzeFunc = رفض فوري.
   * في v1.0 كان يعني ضمنيًا "صفر مشاكل قبل وبعد" ⇒ قبول صامت لأي تعديل.
   */
  function verify(originalCode, fixedCode, fileName, analyzeFunc) {
    if (!originalCode || !fixedCode || originalCode === fixedCode) {
      return { valid: true, improved: false, reason: "no change", noChange: true,
               originalIssues: 0, fixedIssues: 0, newIssues: [], resolvedIssues: [] };
    }

    if (typeof analyzeFunc !== "function") {
      return {
        valid: false, improved: false,
        reason: "ANALYZER_UNAVAILABLE — Fail-Closed: لا يمكن التحقق بدون محلل، فلا نقبل الإصلاح",
        originalIssues: 0, fixedIssues: 0, newIssues: [], resolvedIssues: []
      };
    }

    const result = {
      valid: true, improved: false,
      originalIssues: 0, fixedIssues: 0,
      newIssues: [], resolvedIssues: [], reason: "",
      diff: null
    };

    try {
      const origIssues = normalizeIssues(analyzeFunc(originalCode, fileName));
      const fixedIssues = normalizeIssues(analyzeFunc(fixedCode, fileName));

      // تمييز صريح: null = تعذّر التحليل، وليس "صفر مشاكل"
      if (origIssues === null || fixedIssues === null) {
        return { ...result, valid: false, reason: "ANALYSIS_INCONCLUSIVE — المحلل لم يُرجع نتيجة مفهومة" };
      }

      result.originalIssues = origIssues.length;
      result.fixedIssues = fixedIssues.length;

      const diff = diffCounts(origIssues, fixedIssues, fileName);
      result.diff = diff;

      // للتوافق مع الواجهة القديمة: قوائم تمثيلية
      const beforeCounts = issueCounts(origIssues, fileName);
      const afterCounts = issueCounts(fixedIssues, fileName);
      result.newIssues = fixedIssues.filter(i => {
        const k = issueKey(i, fileName);
        return (afterCounts.get(k) || 0) > (beforeCounts.get(k) || 0);
      });
      result.resolvedIssues = origIssues.filter(i => {
        const k = issueKey(i, fileName);
        return (afterCounts.get(k) || 0) < (beforeCounts.get(k) || 0);
      });

      if (diff.worsened.length > 0) {
        result.valid = false;
        result.reason = "ISSUES_WORSENED (+" + diff.addedCount + "): "
          + diff.worsened.slice(0, 3).map(w => w.key + " " + w.before + "→" + w.after).join(" | ")
          + (diff.addedHighSeverity ? " [منها " + diff.addedHighSeverity + " خطيرة أضافها هذا التعديل]" : "");
      } else if (diff.removedCount > 0) {
        result.improved = true;
        result.reason = "✅ حُل " + diff.removedCount + " مشكلة: "
          + diff.improved.slice(0, 3).map(w => w.key + " " + w.before + "→" + w.after).join(" | ");
      } else {
        result.reason = "NO_IMPROVEMENT — تغيّر الكود دون إنقاص أي مشكلة";
      }

    } catch (e) {
      result.valid = false; // Fail-Closed
      result.reason = "ANALYZER_THREW: " + (e && e.message ? e.message : "تعذر التحقق");
    }

    return result;
  }

  // المتغيّر يُحَلّ إلى نص حرفي واحد بلا غموض، أو null.
  // أي إسناد ثانٍ، أو إسناد لغير نص حرفي مفرد (تجميع، template، استدعاء)،
  // يعني أننا لا نعرف ما يحمله المتغيّر عند الاستدعاء ⇒ null (fail-closed).
  function _soleStringLiteralOf(code, varName) {
    const esc = String(varName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[^\\w$.])(?:const|let|var)?\\s*${esc}\\s*=(?!=)([^;\\n]*)`, "g");
    let found = null, seen = 0;
    for (const m of code.matchAll(re)) {
      seen++;
      if (seen > 1) return null;
      // [FIX] الاقتباس الخلفي كان خارج المجموعة، فالاستعلام في قالبٍ نصّي لا
      // يُعرَف أصلًا — وهو الشكل الأشيع لنصوص SQL في JS. والنتيجة أن إصلاحًا
      // صحيحًا تمامًا يُرفض بـREJECTED_SQL_NOT_PARAMETERIZED (مقيس):
      //     const q = `SELECT * FROM users WHERE id = ? AND a = ?`;
      //     return db.query(q, [uid, fl]);
      // ويُشترط خلوّ القالب من الإقحام: ‎`… id = ${uid} …`‎ ليس قيمةً ثابتة،
      // والإقحامُ هو الثغرة نفسها، فلا يُثبَّت عليه ربطٌ بحال.
      const lit = m[1].trim().replace(/;$/, "").match(/^([`'"])((?:\\.|(?!\1)[^\\])*)\1$/);
      if (!lit) return null;
      if (lit[1] === "`" && /\$\{/.test(lit[2])) return null;
      found = lit[2];
    }
    return seen === 1 ? found : null;
  }

  // إثبات parameterization مربوط: الاستعلام في متغيّر، والمعاملات في نفس
  // الاستدعاء، وعدد ? في الاستعلام نفسه يساوي عدد المعاملات نفسها.
  // وجود النصين في الملف لا يكفي — الربط هو ما يُثبَت هنا.
  // أي غموض (spread، مصفوفة غير حرفية، إسناد متعدد، تعبير مركّب، بلا كلمة
  // SQL، بلا placeholders، عدم تطابق العدد) ⇒ لا إثبات.
  function _jsBoundQueryProof(code) {
    const callRe = /\.\s*(?:query|execute)\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*\[([^[\]]*)\]\s*[,)]/g;
    for (const m of code.matchAll(callRe)) {
      const argsRaw = m[2].trim();
      if (!argsRaw || /\.\.\./.test(argsRaw)) continue;
      const argCount = argsRaw.split(",").map(s => s.trim()).filter(Boolean).length;
      if (!argCount) continue;

      const lit = _soleStringLiteralOf(code, m[1]);
      if (lit === null) continue;
      if (!/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(lit)) continue;

      const placeholders = (lit.match(/\?/g) || []).length;
      if (placeholders === 0 || placeholders !== argCount) continue;

      return true;
    }
    return false;
  }

  // ─── Python: الكود غير القابل للوصول ─────────────────
  // معيار القبول في البوابة هو "أنقص بلاغًا بلا تدهور". والكود غير القابل
  // للوصول ليس شيئًا يبلّغ عنه المحلل في بايثون، وفحوص quickCheck البنيوية
  // موسومة "خاص بـJS/TS" وتُتخطّى هناك. فمولِّد يزرع
  //     return cursor.fetchall()
  // قبل سطر الإرجاع الأصلي يُنتج كودًا سليم الصياغة ينقص بلاغ SQL، فيُقبل،
  // مع أن ناتج الدالة تغيّر وما بعد الـreturn صار ميتًا. مقيس أن هذا يحدث
  // حتى بتسليم الناتج مباشرة بلا أي ترتيب مسارات.
  //
  // هذا ماسح مستقل عن pythonStructuralSyntaxCheck عمدًا: ذاك يعيد ضبط حالة
  // الاقتباس الثلاثي عند كل سطر ولا يعرف أسطر الاستمرار، وله بسبب ذلك
  // إيجابيات كاذبة مُثبتة. والبناء عليه يورثها.
  //
  // عقد الماسح، وكل بند منه أثبته كوربوس عدائي:
  //   • حالة """ محمولة بين الأسطر — وإلا صار docstring كودًا.
  //   • أسطر الاستمرار (عمق أقواس > 0 أو نهاية بـ backslash) ليست عبارات.
  //   • التعليقات ليست عبارات.
  //   • elif/else/except/finally/case تفتح مسارًا جديدًا لا عبارة تالية.
  //   • المستويات الأعمق تُنسى عند الرجوع إلى مستوى أقل.
  // حدوده المعروفة ولا يدّعي غيرها: لا يكشف عبارتين على سطر واحد بفاصلة
  // منقوطة، ولا كودًا بعد شرط دائم الصدق (يحتاج تحليل قيم)، ولا تغيّر قيمة
  // الإرجاع بلا كود ميت (هذا فحص وصول لا فحص مكافئة دلالية).
  const PY_TERMINATOR = /^(?:return|raise|break|continue)\b|^(?:sys\.exit|os\._exit)\s*\(/;
  const PY_NEW_BRANCH = /^(?:elif|else|except|finally|case)\b/;
  const PY_SCOPE_HEAD = /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/;

  // يُرجع كل عبارة منطقية مع موضعها وحالة وصولها:
  //   { masked, raw, indent, scope, dead }
  // النصّ وحده لا يكفي: لا يُميّز عبارةً أُسكتت من عبارةٍ كانت ميتة أصلًا في
  // موضع آخر. والنطاق سلسلة أسماء def/class الحاوية مفصولة بـ'>' . وهو تقريب
  // معلن: دالتان بالاسم نفسه على المستوى نفسه تندمجان.
  function pyLogicalStatements(code) {
    const lines = String(code).replace(/\r\n?/g, "\n").split("\n");
    const terminatedAt = new Map();
    const out = [];
    const scopes = new Set(["<module>"]);
    const stack = [];
    let triple = null, depth = 0, continuing = false;

    for (const raw of lines) {
      if (!raw.trim()) continue;

      const startedInTriple = !!triple;
      let clean = "", quote = null, escaped = false;

      for (let k = 0; k < raw.length; k++) {
        const c = raw[k], n1 = raw[k + 1], n2 = raw[k + 2];

        if (triple) {
          if (c === triple && n1 === triple && n2 === triple) { clean += "   "; k += 2; triple = null; }
          else clean += " ";
          continue;
        }
        if (quote) {
          clean += " ";
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === quote) quote = null;
          continue;
        }
        if ((c === "'" || c === '"') && n1 === c && n2 === c) { triple = c; clean += "   "; k += 2; continue; }
        if (c === "'" || c === '"') { quote = c; clean += " "; continue; }
        if (c === "#") break;
        clean += c;
      }

      const wasContinuing = continuing;
      for (const c of clean) {
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
      }
      continuing = depth > 0 || /\\$/.test(raw.replace(/\s+$/, ""));

      const stmt = clean.trim();
      if (!stmt || startedInTriple || wasContinuing) continue;

      const lead = raw.match(/^[ \t]*/)[0];
      const indent = lead.replace(/\t/g, "    ").length;

      while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
      for (const level of Array.from(terminatedAt.keys())) {
        if (level > indent) terminatedAt.delete(level);
      }

      const scope = stack.map(x => x.name).join(">") || "<module>";
      const dead = !!(terminatedAt.get(indent) && !PY_NEW_BRANCH.test(stmt));
      out.push({ masked: stmt, raw: raw.trim(), indent, scope, dead });

      const head = PY_SCOPE_HEAD.exec(stmt);
      if (head) { stack.push({ name: head[1], indent }); scopes.add(stack.map(x => x.name).join(">")); }
      if (PY_TERMINATOR.test(stmt)) terminatedAt.set(indent, true);
      if (PY_NEW_BRANCH.test(stmt)) terminatedAt.delete(indent);
    }

    return { all: out, dead: out.filter(x => x.dead), scopes };
  }

  // العقد القديم محفوظ: قائمة نصوص الأسطر الميتة المُعمَّاة.
  function pyUnreachableStatements(code) {
    const out = pyLogicalStatements(code).dead.map(x => x.masked);
    return out;
  }

  // فارقي: الحكم على ما **يضيفه** التعديل، كما تفعل diffCounts مع البلاغات.
  // كود ميت موجود في الأصل لا يُحاسَب عليه الـcandidate، وإزالته تحسين.
  //
  // أربع قواعد: ثلاث أدلّة وواحدة اشتباه. وكلّها مقيسة على 3,910 أزواج من
  // مكتبة بايثون القياسية، بحقيقة أرضية من شجرة CPython وبذرة ثابتة.
  //
  //   (أ) ارتفاع العدد الكلي للعبارات غير القابلة للوصول.           [دليل]
  //       سطر ميت واحد صار اثنين داخلٌ فيها: العدد ارتفع.
  //   (ب) نصّ **خام** كان قابلًا للوصول ولم يكن ميتًا في أي موضع،    [دليل]
  //       وصار ميتًا ⇒ هذه العبارة بعينها توقّفت. والخام لا المُعمَّى،
  //       وإلا تصادم log("abc") مع log("xyz") فضاع الضرر.
  //   (و) في نطاق واحد ولنصّ واحد: تعداد الأحياء ينقص وتعداد الميت   [دليل]
  //       يرتفع ⇒ العبارة توقّفت **هنا**. وهي التي تفصل نقل الضرر بين
  //       الدوال عن نقل كود ميت سليم: في الثاني لم يكن للنصّ وجود حيّ
  //       في نطاق الوصول، فلا نقص.
  //   (هـ) ظهور نصّ ميت جديد (مُعمَّى) مع نقص في تعداد الأحياء        [اشتباه]
  //       (مُعمَّى) ⇒ الشكل الذي يُنتجه "قتل سطر حيّ وإعادة كتابته"،
  //       وهو نفسه شكل "حذف سطر حيّ وإعادة صياغة سطر ميت" السليم. لا
  //       يفصلهما النص، فنرفض كما يرفض السلوك السابق. والمُعمَّى لا الخام،
  //       وإلا رُفض كل تعديل يمسّ نصًّا حرفيًّا داخل كود ميت.
  //
  // ولا يُعدّ ضررًا: إعادة صياغة كود ميت وحده، ونقل الميت بين النطاقات،
  // وحذف سطر حيّ حذفًا تامًّا (ذاك شأن quickCheck وdiffCounts).
  function pyReachabilityVerdict(beforeCode, afterCode) {
    const B = pyLogicalStatements(beforeCode);
    const A = pyLogicalStatements(afterCode);
    const added = [];
    const push = t => { if (added.indexOf(t) === -1) added.push(t); };

    // (أ)
    if (A.dead.length > B.dead.length) {
      const budget = new Map();
      for (const d of B.dead) budget.set(d.raw, (budget.get(d.raw) || 0) + 1);
      for (const d of A.dead) {
        const left = budget.get(d.raw) || 0;
        if (left > 0) budget.set(d.raw, left - 1);
        else push(d.raw);
      }
      if (!added.length) push(A.dead[A.dead.length - 1].raw);
    }

    // فهارس تُبنى مرّة: الخام للهوية، والمُعمَّى للتعداد.
    const liveRaw = new Set(), deadRaw = new Set();
    const liveAt = new Map(), deadAt = new Map();          // "نطاق\0مُعمَّى" -> عدد
    const liveText = new Map(), deadTextA = new Map();     // مُعمَّى -> عدد
    const index = (src, scoped, flat, rawSet, isAfter) => {
      for (const x of src.all) {
        if (!isAfter) rawSet(x);
        const k = x.scope + "\u0000" + x.masked;
        const m = x.dead ? scoped.dead : scoped.live;
        m.set(k, (m.get(k) || 0) + 1);
        const f = x.dead ? flat.dead : flat.live;
        f.set(x.masked, (f.get(x.masked) || 0) + 1);
      }
    };
    const bScoped = { live: new Map(), dead: new Map() };
    const aScoped = { live: liveAt, dead: deadAt };
    const bFlat = { live: liveText, dead: new Map() };
    const aFlat = { live: new Map(), dead: deadTextA };
    index(B, bScoped, bFlat, x => (x.dead ? deadRaw : liveRaw).add(x.raw), false);
    index(A, aScoped, aFlat, null, true);

    // (ب)
    for (const d of A.dead) {
      if (liveRaw.has(d.raw) && !deadRaw.has(d.raw)) push(d.raw);
    }

    // (و)
    for (const [k, n] of deadAt) {
      if (n <= (bScoped.dead.get(k) || 0)) continue;
      if ((liveAt.get(k) || 0) < (bScoped.live.get(k) || 0)) push(k.split("\u0000")[1]);
    }

    if (added.length) return { added, suspect: [] };

    // (هـ)
    let fresh = null;
    for (const [t, n] of deadTextA) {
      if (n > (bFlat.dead.get(t) || 0)) { fresh = t; break; }
    }
    if (fresh === null) return { added, suspect: [] };
    for (const [t, n] of liveText) {
      if ((aFlat.live.get(t) || 0) < n) return { added, suspect: [fresh] };
    }
    return { added, suspect: [] };
  }

  // العقد القديم محفوظ: أسطر الضرر المؤكَّد وحدها.
  function pyUnreachableAdded(beforeCode, afterCode) {
    const added = pyReachabilityVerdict(beforeCode, afterCode).added;
    return added;
  }

  // هل في الكود نصُّ استعلامٍ أصلًا؟ — شرطُ وجود الدعوى لحارس SQL.
  //
  // [FIX] security_scanner يُبلّغ «🔴 SQL Injection محتمل» على
  // ‎exec("ls " + req.query.dir)‎ — تسلسلُ نصٍّ داخل استدعاء، بلا أي استعلام.
  // وإصلاحُ حقن الأوامر الصحيح ‎execFile("ls", [req.query.dir])‎ يُسقط ذلك
  // البلاغ، فكان حارس SQL يطالبه بإثبات parameterization لاستعلامٍ لا وجود
  // له — مطلبٌ لا يُوفى، فيُرفض إصلاحٌ سليم (مقيس، لا مُفترَض).
  //
  // فالفحص على الكود كله لا على السطر، وبهذا يبقى الحارس فاعلًا متى وُجد أيُّ
  // نصِّ استعلام في الملف — تضييقٌ للـNA لا توسيع، فالخطأ يميل إلى الحراسة.
  const SQL_SINK_RX =
    /\b(?:SELECT|INSERT|UPDATE|DELETE|MERGE|REPLACE)\b[\s\S]{0,400}?\b(?:FROM|INTO|SET|WHERE|VALUES|TABLE)\b/i;
  const sqlSinkPresent = code => SQL_SINK_RX.test(String(code));

  // SQL candidate guard — لا يكفي اختفاء SQL Injection من الـAnalyzer.
  // يجب أن يثبت الـcandidate وجود parameterization مناسب للغة.
  function sqlCandidateLooksParameterized(beforeCode, afterCode, fileName) {
    const ext = String(fileName).split('.').pop().toLowerCase();

    if (ext === 'js' || ext === 'ts') {
      // البدائل الثلاثة الأولى كما هي — لا تضييق ولا توسيع لأي منها.
      // [FIX] أُضيف بديل رابع: البدائل النصّية تشترط أن يلي اقتباسَ نهاية
      // الاستعلام ", [" مباشرة، أي الاستعلام داخل الاستدعاء. فإصلاح صحيح
      // يضع الاستعلام في متغيّر ثم db.query(q, [params]) — وهو الشكل الوحيد
      // الذي يُنتجه SmartRepair، والأشيع في الكود الحقيقي — كان يُرفض رغم
      // أن ربطه مُثبت: نفس الربط بنقل النص داخل الاستدعاء يُقبل. البديل
      // الجديد يُثبت الربط نفسه ويعدّه، ولا يورث سَعَة البحث النصّي.
      return (
        /\?\s*["'`]\s*,\s*\[[\s\S]*\]/.test(afterCode) ||
        /\$\d+/.test(afterCode) ||
        /\bparams?\s*[,)]/.test(afterCode) ||
        _jsBoundQueryProof(afterCode)
      );
    }

    if (ext === 'py') {
      return (
        /\.execute\s*\(\s*[^,]+,\s*\(/.test(afterCode) ||
        /\.execute\s*\(\s*[^,]+,\s*\[[\s\S]*\]\s*\)/.test(afterCode)
      );
    }

    if (ext === 'cs') {
      return (
        /\.Parameters\.Add(?:WithValue)?\s*\(/.test(afterCode) &&
        /(?:CommandText|query|command)\s*=/.test(afterCode) &&
        !/['"`][^'"`]*@param[^'"`]*['"`]\s*\+/.test(afterCode)
      );
    }

    // [PHP-SQL] PHP لم يكن له فرعٌ هنا إطلاقًا، فكان يسقط إلى `return false`:
    // أيُّ إصلاح SQL في PHP — صحيحًا كان أو لا — يُرفض بـ
    // REJECTED_SQL_NOT_PARAMETERIZED. وذلك سببُ توقّف المسار (مقيس:
    // RepairSQL يُنتج مُرشَّحًا بـcount=1 ثم تردّه البوابة).
    //
    // والإثبات بثلاثة شروط مجتمعة، على غرار بقية اللغات:
    //   1. عبارةٌ محضَّرة: ‎->prepare(‎ (PDO وmysqli و$wpdb سواء)
    //   2. موضعُ معامِلٍ في النص: ‎?‎ أو ‎:name‎ أو ‎%s/%d‎ (صيغة $wpdb)
    //   3. ربطُ قيمٍ فعلي: ‎execute([…])‎ أو ‎bind_param‎ أو ‎bindValue/bindParam‎
    //      أو وسيطٌ ثانٍ لـ‎$wpdb->prepare‎
    // فمجرّد ظهور ‎prepare‎ لا يكفي، ولا موضعُ معامِلٍ بلا ربط.
    //
    // الحدّ المُعلَن: البوابة تُثبت **الربط**، لا سلامة تدفّق البرنامج. لا
    // محلّل وصول لـPHP هنا (نظير pyReachabilityVerdict مقصورٌ على بايثون)،
    // فناتجٌ صحيحُ النحو يضع prepare في موضع تعبير يبقى خارج إدراكها — ولذلك
    // عولج ذلك الشكل عند مصدره في repair_sql.js ‎[PHP-PREFIX]‎ لا هنا.
    if (ext === 'php') {
      if (!/->\s*prepare\s*\(/.test(afterCode)) return false;

      // موضعُ المعامِل يُطلب داخل **نصوص الاستعلام** لا في الملف كله:
      // ‎<?php‎ نفسه يحمل ‎?‎، فأي فحصٍ على الملف كله صحيحٌ دائمًا في PHP —
      // فحصٌ خامل لا حارس. وكشفه سحبُ التحوّرات (P3 نجا): المُرشَّح
      //     $stmt = $pdo->prepare("SELECT * FROM t WHERE n = 'fixed'");
      //     $stmt->execute([$name]);
      // كان يُقبل، وهو يربط قيمة باستعلامٍ بلا معامِل والنصُّ مُثبَّت.
      //
      // والبحث في كل نصٍّ يحمل فعلَ استعلام، لا في وسيط prepare وحده: الشكل
      // ‎$sql = "… ?"; $pdo->prepare($sql)‎ صحيحٌ شائع، وحصرُ الفحص بالوسيط
      // كان يرفضه.
      // ولا نصَّ استعلام ⇒ ‎some‎ على قائمةٍ خالية = false، فلا معامِل ولا قبول.
      const sqlLiterals = [...String(afterCode).matchAll(/(["'])((?:\\.|(?!\1)[^\\])*)\1/g)]
        .map(m => m[2])
        .filter(q => /\b(?:SELECT|INSERT|UPDATE|DELETE|MERGE|REPLACE)\b/i.test(q));
      const placeholder = sqlLiterals.some(q =>
        /\?/.test(q) || /:\w+/.test(q) || /%[sdf]\b/.test(q));

      const bound =
        /->\s*execute\s*\(\s*(?:\[|array\s*\()/.test(afterCode) ||
        /->\s*bind_param\s*\(/.test(afterCode) ||
        /->\s*bind(?:Value|Param)\s*\(/.test(afterCode) ||
        /\$wpdb\s*->\s*prepare\s*\([^)]*,/.test(afterCode);
      return placeholder && bound;
    }

    return false;
  }

  // ═══════════════════════════════════════════════
  // verifyFix — البوابة الكاملة (يستدعيها الـOrchestrator)
  // ═══════════════════════════════════════════════

  /**
   * الترتيب: quickCheck → syntax → analyzer diff.
   *
   * @param {Object} opts
   *   opts.allowUnverifiedLanguages  افتراضي false (Fail-Closed). عند true
   *        يُسمح باعتماد تعديل في لغة بلا فاحص تركيبي، ويوسم صراحةً.
   *   opts.requireImprovement        افتراضي true. تعديل لا يُنقص أي مشكلة يُرفض.
   *
   * @returns {{accepted, reason, syntaxStatus, language, afterIssues,
   *            removedCount, addedCount, quick, diff}}
   */
  // ═══════════════════════════════════════════════════════════════════
  // [MINIFIED-VENDOR] حِزَم طرف ثالث مُصغَّرة — تُستثنى من الإصلاح افتراضيًا
  // ═══════════════════════════════════════════════════════════════════
  //
  // القياس على هذا المستودع: 12 من 13 مُرشَّح إصلاح غير تجميلي كانت على
  // jspdf.min.js وjszip.min.js. وتعديل سطرٍ واحد في حِزمة مُصغَّرة يعني تعديل
  // آلاف الرموز في سطر واحد بلا قدرة على مراجعته، وكلّه كودُ طرفٍ ثالث لا
  // يُصلَح هنا بل يُحدَّث من مصدره.
  //
  // والفصل مقيس ولا يلامس ملفات المشروع: أطول سطر في الحِزَم المُصغَّرة
  // 94,671 و97,246 و111,375، وأطول سطر في أي ملف مشروع 587، ومتوسط الأسطر
  // 913–111,375 مقابل ≤46. فالعتبات (2000 و200) بينهما بهامش واسع.
  const VENDOR_PATH = /(?:^|[\\/])(?:node_modules|vendor|third_party|bower_components|dist)[\\/]/i;

  function minifiedVendorProblem(code, fileName) {
    const name = String(fileName || '');
    if (VENDOR_PATH.test(name)) return 'path indicates third-party code: ' + name;
    if (/\.min\.(?:js|mjs|cjs|css)$/i.test(name)) return 'minified bundle by name: ' + name;

    const src = String(code || '');
    if (src.length < 20000) return null;              // صغير ⇒ ليس حِزمة
    const lines = src.split('\n');
    let max = 0;
    for (const l of lines) if (l.length > max) max = l.length;
    const avg = Math.round(src.length / lines.length);
    if (max >= 2000) return 'minified by shape: longest line ' + max + ' chars';
    if (avg >= 200)  return 'minified by shape: average line ' + avg + ' chars';
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // [SIGNAL-PROOF] سجل الإشارة/الإثبات — حارسٌ عام لا استثناء
  // ═══════════════════════════════════════════════════════════════════
  //
  // كان في البوابة حارسٌ واحد بهذا الشكل، خاصٌّ بـSQL: إن اختفت إشارة SQL
  // ولم يُثبت الـcandidate parameterization ⇒ رفض. وهو الشكل الصحيح، وكان
  // حالةً مفردة. وبقية الأصناف كان اختفاء البلاغ وحده دليلَ قبولها.
  //
  // والعطب المقيس: ‎const token = "ESD_" + incident.probeId;‎ صار
  // ‎process.env.TOKEN + incident.probeId‎ — فاختفى البلاغ (زال النصّ الحرفي
  // الذي يكتشفه الكاشف) وقبلته البوابة: accepted=true، «أزال 2 مشكلة، بلا
  // تدهور». والقيمة ليست سرًّا بل بادئة وسمٍ داخلية، وprocess.env.TOKEN غير
  // معرَّف. أي أن البوابة قبلت تغيير معنى لأن الكاشف كفّ عن الإبلاغ.
  //
  // فصار السجل عامًّا: لكل صنف إشارةٌ تُطلقه وإثباتٌ يلزم لقبول اختفائها.
  // والقاعدة واحدة لكل الأصناف: **اختفاء الإشارة بلا إثبات = رفض**، لا قبول.
  // وإضافة صنف جديد تعني إضافة سطرٍ إلى السجل لا حارسًا جديدًا.

  const SECRET_ISSUE_RX =
    /hardcoded[_ -]?(?:secret|pass|password|key)|hardcoded[_ -]?api[_ -]?key|cwe-798(?!\d)|cwe-259(?!\d)|\bsecret\b|مُضمَّن في الكود|مُضمَّنة في الكود|مكشوفة في الكود/i;

  // مصادر القيم السرّية المقبولة كإثبات
  const ENV_SOURCE_RX =
    /process\.env\b|os\.environ\b|os\.getenv\s*\(|\bgetenv\s*\(|System\.getenv\s*\(|Environment\.GetEnvironmentVariable\s*\(|ENV\s*\[|\bdotenv\b|SecretsManager|SecretManager|\bvault\b/i;

  // أسماءٌ تدلّ على سرّ، وقيمٌ تدلّ عليه ولو كان الاسم محايدًا
  const SECRET_KEY_RX =
    /password|passwd|pwd|secret|api[_\-]?key|apikey|access[_\-]?key|token|credential|auth/i;
  const SECRET_VALUE_RX =
    /^(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}$|^AKIA[0-9A-Z]{12,}$|^gh[pousr]_[A-Za-z0-9]{20,}$|^AIza[0-9A-Za-z_\-]{20,}$|^xox[baprs]-[A-Za-z0-9-]{10,}|^eyJ[A-Za-z0-9_\-]{8,}\./;

  // سطرُ إسنادِ سرٍّ: إسنادٌ قيمتُه نصٌّ حرفي، ومفتاحُه أو قيمتُه تدلّ على سرّ.
  //
  // الشرط الحامل هو **التقاط المفتاح** قبل ‎[:=]‎. وكانت أول صياغة لهذا الفحص
  // تجعل كلمةَ السرّ نفسها هي المُطابَق بلا مفتاح، فطابقت ‎password='‎ داخل
  // نصّ SQL —
  //   var query = "SELECT * FROM players WHERE username='" + u + "' AND password='" + p + "'";
  // — فعُدّ سطرُ الاستعلام إسنادَ سرٍّ، ورُفض معه كل إصلاحٍ في الملف. أسقط ذلك
  // اختبارين قائمين، و[SP-2e] يثبّت الآن ألّا يعود.
  //
  // والتثبيت على ‎^\s*‎ اتساقٌ مع مُطابِق البديل (sameKey) المثبَّت كذلك — وليس
  // هو ما يحمي حالة SQL أعلاه: أوّلُ تطابقٍ يقع على ‎var q = "SELECT …"‎ فيُرَدّ
  // لأن ‎q‎ ليس اسمًا سرّيًا، فلا يُجرَّب موضع ‎password='‎ أصلًا. وإزالة
  // التثبيت وحدها لا تُغيّر حكمًا في أي حالة قابلة للبناء (مقيس).
  function secretAssignOf(line) {
    const s = String(line);
    const m = /^\s*(?:(?:const|let|var|public|private|protected|static|final|readonly)\s+)*(\$?[\w$]+(?:\s*[.[][\w$'"\]]+)*)\s*[:=]\s*(['"])((?:(?!\2).)*)\2/.exec(s);
    if (!m) return null;
    const key = m[1], quote = m[2], value = m[3];
    if (!SECRET_KEY_RX.test(key) && !SECRET_VALUE_RX.test(value)) return null;
    return { key, quote, value, rest: s.slice(m.index + m[0].length) };
  }

  // هل النصّ الحرفي المُسنَد هو **القيمة الكاملة**؟
  //
  // سرٌّ مُضمَّن قيمةٌ ثابتة كاملة. والنصّ الذي يُجمَع مع تعبيرٍ آخر
  // (‎"ESD_" + x‎، ‎`${a}x`‎، ‎"a".concat(b)‎) بادئةٌ أو وسمٌ أو جزء مسار —
  // لا سِرّ. فدعوى «هذا سرٌّ مُضمَّن» غير مُثبتة عليه، وما لا يُثبت يُرفض.
  // وهذه خاصية عامة في الدعوى نفسها، لا استثناءٌ لملفٍ أو سطرٍ بعينه.
  function secretLiteralIsWholeValue(line, lang) {
    const a = secretAssignOf(line);
    if (!a) return false;
    if (/\$\{/.test(a.value)) return false;            // ‎${…}‎ إقحام
    // إقحام PHP داخل نصٍّ مزدوج: ‎"sk_live_{$x}abc"‎ قيمةٌ مُركَّبة لا ثابتة.
    // مقصورٌ على php بقرار: ‎"p$ssw0rd"‎ في JS نصٌّ حرفي لا إقحام، فتعميم
    // القاعدة يرفض سرًّا سليمًا فيه ‎$‎. (والقوالب الخلفية وf-strings لا يصلان
    // هنا أصلًا: لا كاشف يُبلّغ عنها — مقيس.)
    if (lang === 'php' && a.quote === '"' && /\{\$[\w$]|\$[A-Za-z_]\w*/.test(a.value)) return false;
    return /^\s*(?:[;,)\]}]|$)/.test(a.rest);          // نهاية عبارة لا عامل تركيب
  }

  function hasSecretIssueIn(issues) {
    return (issues || []).some(i => {
      const text = [i && i.type, i && i.title, i && i.cAct, i && i.strategy, i && i.cwe]
        .map(v => String(v || '')).join(' ');
      return SECRET_ISSUE_RX.test(text);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // تصنيف أسباب الرفض — ليس كلُّ رفضٍ حكمًا على صحة التعديل
  // ═══════════════════════════════════════════════════════════════════
  //
  // ثلاثة أصناف مختلفة جوهريًّا، وخلطُها يُسقط إصلاحات سليمة:
  //
  //   ضارٌّ / غير مُثبت — التعديل نفسه معطوب أو لا دليل على صحته:
  //       كسرٌ نحوي، بلاغاتٌ أُضيفت، ادّعاءُ إصلاحٍ بلا إثبات، ناتجٌ فارغ.
  //   لا تحسّنَ قابلًا للقياس — التعديل قد يكون سليمًا تمامًا، لكن حُبيبيّةَ
  //       المحلل لا تُظهر فرقًا. مقيس: سطرٌ فيه عنوانا ‎http://‎، أحدهما كودٌ
  //       داخل نصّ. الإصلاح يُصحّح العنوان الحقيقي وحده بقصد، والبلاغ يُحسَب
  //       للسطر فيبقى 1→1 ⇒ NO_IMPROVEMENT. وليس ذلك دليل عطب.
  //   تعذُّرٌ بيئي — لا فاحصَ نحوي للغة، أو البوابة/المحلل غير متوفّر.
  //       حكمٌ على البيئة لا على التعديل.
  //
  // ومَن يحتاج إسقاطَ خطوةٍ بعينها (مثل [STEP-SALVAGE]) يُسقطها على الصنف
  // الأول وحده، فلا يكون أشدَّ من الحكم النهائي على الكتلة.
  //
  // والتصنيف مملوكٌ للبوابة لأنها صاحبة الأسباب. كانت نسخةٌ منه في
  // fix_engine_pipeline.js وحدها، فأيُّ سببٍ جديد يُضاف هنا (أسباب الإثبات
  // الخمسة والحِزَم المُصغَّرة) يبقى مجهولًا هناك — وهذا بالضبط ما يُعيد
  // المشكلة في كل جولة.
  const HARMFUL_REJECTION_PREFIXES = [
    'REJECTED_EMPTY_OUTPUT',            // الناتج فارغ
    'REJECTED_QUICKCHECK',              // فحوص بنيوية سريعة سقطت
    'REJECTED_SYNTAX_BROKEN',           // الفاحص متاح وحكم بالكسر
    'REJECTED_ISSUES_WORSENED',         // أضاف بلاغات
    'REJECTED_PY_UNREACHABLE_CODE',     // أدخل كودًا غير قابل للوصول
    'REJECTED_MINIFIED_VENDOR',         // هدفٌ لا يُصلَح تلقائيًا
    // أسباب سجل الإشارة/الإثبات — نقصُ بلاغٍ بلا دليل على إصلاحه
    'REJECTED_SQL_NOT_PARAMETERIZED',
    'REJECTED_SECRET_FIX_UNPROVEN',
    'REJECTED_XSS_FIX_UNPROVEN',
    'REJECTED_CMD_FIX_UNPROVEN',
    'REJECTED_CRYPTO_FIX_UNPROVEN',
    'REJECTED_EVAL_FIX_UNPROVEN',
  ];
  // المطابقة ببادئة النص: البوابة تُلحق بالسبب تفصيلًا (اللغة، العدد، الأسماء).
  function isHarmfulRejection(reason) {
    const r = String(reason == null ? '' : reason);
    return HARMFUL_REJECTION_PREFIXES.some(p => r.indexOf(p) === 0);
  }

  // رفضٌ على **الهدف** لا على التعديل: حكمُه لا يتوقف على الـcandidate إطلاقًا،
  // فكلُّ تعديلٍ على هذا الملف مرفوضٌ بالضرورة. ومَن يجزّئ تعديلًا ليُنقذ منه
  // ما يُثبَت (مثل [STEP-SALVAGE]) لا جدوى من محاولته هنا: لا خطوةَ تمرّ،
  // والثمنُ نداءُ بوابةٍ لكل خطوة على حِزمةٍ قد تكون مئات الكيلوبايتات.
  const TARGET_REJECTION_PREFIXES = ['REJECTED_MINIFIED_VENDOR'];
  function isTargetRejection(reason) {
    const r = String(reason == null ? '' : reason);
    return TARGET_REJECTION_PREFIXES.some(p => r.indexOf(p) === 0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // [SINK-PROOF] إثبات عام لأصناف «مَصرِف غير آمن»
  // ═══════════════════════════════════════════════════════════════════
  //
  // الأصناف XSS وCMD_INJECTION وWEAK_CRYPTO وEVAL_USAGE تشترك في شكل واحد:
  // بلاغُها يأتي من **مَصرِفٍ** غير آمن في سطر، وإصلاحُها الصحيح يُدخل
  // **علاجًا** معروفًا في موضعه. والمقيس قبل هذا الحارس أن كل محوٍ شكلي فيها
  // كان يُقبل:
  //   el.innerHTML = u.bio            ⇒ حذف السطر               → قُبل
  //   el.innerHTML = u.bio            ⇒ ‎el["inner"+"HTML"]‎      → قُبل
  //   exec("ls " + c)                 ⇒ حذف الاستدعاء           → قُبل
  //   createHash("md5")               ⇒ حذف الاستدعاء           → قُبل
  //   eval(s)                         ⇒ ‎window["ev"+"al"](s)‎    → قُبل
  //
  // فالإثبات واحد لها جميعًا: كل سطرِ مَصرِفٍ اختفى يلزمه سطرٌ جديد فيه علاج،
  // وعددُ العلاجات لا يقلّ عن عدد المصارف التي اختفت — فإزالة ثلاثة مصارف
  // بعلاجٍ واحد ليست إصلاحًا. وحذفُ السطر لا يُنتج علاجًا فيُرفض.
  //
  // وهو مُولِّدٌ واحد تُغذّيه بيانات: إضافة صنف = سطرُ بيانات، لا حارس جديد.
  //
  // ─── والحكم ثلاثيٌّ لا ثنائي، وهذا مقيس لا مُفترَض ───────────────────
  // ثنائيّةُ «أُثبت / لم يُثبت» كانت تخلط حالتين مختلفتين جوهريًّا، فترفض
  // إصلاحات صحيحة. فالصنف قد يفقد بلاغًا **ولا مَصرِف له في الكود أصلًا**:
  //   knowledge_base.js يُدرج ‎/eval\s*\(\s*\w+/‎ ضمن أنماط XSS. فالسطر
  //   ‎r = eval(x);‎ يُنتج بلاغين: eval (صنف evalx) وXSS (صنف xss). وإصلاحه
  //   الصحيح ‎r = JSON.parse(x);‎ يُسقط البلاغين معًا — فيُطالَب صنف xss بعلاج
  //   XSS في موضع مَصرِفٍ لم يوجد، وهو مطلبٌ لا يمكن الوفاء به بحالٍ، فيُرفض
  //   إصلاحٌ سليم. وكذلك ‎conn.exec("SELECT …")‎: security_scanner يراه
  //   Command Injection بـ‎\bexec\s*\(‎ (و‎\b‎ تمرّ بعد النقطة)، وإصلاح SQL
  //   الصحيح يُسقط ذلك البلاغ، فيُطالَب صنف cmd بعلاج أوامرَ لا محلّ له.
  //
  // فالتمييز: هل كان للصنف مَصرِفٌ في before؟
  //   • لا مَصرِف إطلاقًا  ⇒ الصنف لم يدّعِ شيئًا، ولا إثبات يُطلَب (PROOF.NA).
  //     وحمايةُ المَصرِف تأتي من الصنف **المالك** له: حذفُ ‎r = eval(x);‎ شكليًّا
  //     يرفضه evalx لأن مَصرِفه هو، لا xss.
  //   • مَصرِفٌ موجود وبقي كما هو والبلاغ اختفى ⇒ محوٌ شكلي، يُرفض.
  //   • مَصرِفٌ اختفى ⇒ يلزمه علاجٌ بعدده، وإلا يُرفض.
  //
  // والحدّ المُعلَن: مدى الحماية = تغطية sinkRx. مَصرِفٌ بشكلٍ لا يعرفه أي صنف
  // يُعَدّ «لا مَصرِف» فيمرّ محوُه الشكلي عبر هذا الحارس (ويبقى عليه
  // requireImprovement وحده). وهذا أسلم من الثنائية التي كانت ترفض الصحيح:
  // ثقبُ تغطيةٍ مُعلَن، لا رفضٌ عامّ لإصلاحات سليمة.
  const PROOF = { NA: 'NA', PROVEN: 'PROVEN', UNPROVEN: 'UNPROVEN' };

  function sinkFixProven(beforeCode, afterCode, sinkRx, remedyRx) {
    const B = String(beforeCode).split('\n');
    const A = String(afterCode).split('\n');
    const aSet = new Set(A.map(l => l.trim()));
    const bSet = new Set(B.map(l => l.trim()));

    const sinksBefore = B.filter(l => sinkRx.test(l));
    if (!sinksBefore.length) return PROOF.NA;   // لا مَصرِف لهذا الصنف ⇒ لا دعوى

    const gone = sinksBefore.filter(l => !aSet.has(l.trim()));
    if (!gone.length) return PROOF.UNPROVEN;    // المَصرِف باقٍ والبلاغ اختفى ⇒ محوٌ شكلي

    const remedies = A.filter(l => !bSet.has(l.trim()) && remedyRx.test(l)).length;
    return remedies >= gone.length ? PROOF.PROVEN : PROOF.UNPROVEN;
  }

  // المصارف والعلاجات — قيست على مُدخلات حقيقية لكل صنف
  const SINK_CLASSES = {
    xss: {
      issue: /\bxss\b|cwe-79(?!\d)|innerhtml|document\.write/i,
      sink: /innerHTML|outerHTML|document\.write\s*\(|\.html\s*\(|insertAdjacentHTML|echo\s+\$_(GET|POST|REQUEST)|<\?=/i,
      remedy: /\btextContent\b|\binnerText\b|htmlspecialchars\s*\(|htmlentities\s*\(|escapeHtml\s*\(|DOMPurify\s*\.\s*sanitize|\bsanitize\s*\(|createTextNode\s*\(|setAttribute\s*\(|encodeURIComponent\s*\(/i,
      reason: "REJECTED_XSS_FIX_UNPROVEN — نقص بلاغ XSS لكن الـcandidate لا يُدخل تهريبًا ولا مَصرِفًا آمنًا في موضع المصرف الذي اختفى",
    },
    cmd: {
      // ‎\bcmd[_ ]?injection\b‎ يلتقط وسمَ محرّكات التتبّع نفسها
      // (‎taint | CMD_INJECTION: d من req input → exec‎) — وهو أقوى إشارة في
      // الصنف، وكانت خارج العدّ: فنقصُها وحده كان يمرّ بلا إثبات.
      issue: /command injection|\bcmd[_ ]?injection\b|cwe-78(?!\d)|shell_exec|os\.popen|shell\s*=\s*true|runtime\.exec|os command/i,
      // ‎exec(‎ بلا مُستقبِل فقط: ‎conn.exec("SELECT …")‎ و‎db.exec(‎ نداءات قاعدة
      // بيانات لا شِل. بلا هذا الاستثناء يُعَدّ سطرُ استعلامٍ مَصرِفَ أوامر،
      // فيُرفض إصلاح SQL سليم — أسقط ذلك اختبارًا قائمًا قبل الاستثناء.
      sink: /(?<![.\w$])exec(?:Sync)?\s*\(|(?:child_process|cp)\s*\.\s*exec(?:Sync)?\s*\(|\bshell_exec\s*\(|\bpassthru\s*\(|(?<![.\w$])system\s*\(|os\s*\.\s*popen\s*\(|os\s*\.\s*system\s*\(|shell\s*=\s*True|Runtime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec|\bcommands\s*\.\s*getoutput\s*\(/i,
      // العلاجات المقبولة — مقيسة على ما يُنتجه repair_engine فعلًا:
      //   js : ‎const safeArgs = "ls " + d.replace(/[^a-zA-Z0-9 ]/g, '')‎ ثم exec
      //   py : ‎subprocess.run(shlex.split("ls " + x), check=True, …)‎
      // والحارس يُثبت أن علاجًا **أُدخِل**، لا أن قائمة السماح كافية — كفايتُها
      // عقدُ fixCmdInjection في repair_engine لا عقدُ البوابة. وهذا حدٌّ معلن.
      remedy: /\bexecFile(?:Sync)?\s*\(|\bspawn(?:Sync)?\s*\(|shell\s*:\s*false|shlex\s*\.\s*(?:quote|split)\s*\(|subprocess\.(?:run|Popen|check_output|check_call)\s*\(\s*\[|escapeshellarg\s*\(|escapeshellcmd\s*\(|new\s+ProcessBuilder\s*\(|\.replace\s*\(\s*\/\[\^[^\]/]*\]\s*\/[a-z]*\s*,/i,
      reason: "REJECTED_CMD_FIX_UNPROVEN — نقص بلاغ Command Injection لكن الـcandidate لا يُدخل تنفيذًا بوسائط مفصولة ولا تهريبًا ولا قائمة سماح",
    },
    crypto: {
      issue: /\bmd5\b|\bsha1\b|sha-1|cwe-327(?!\d)|تشفير ضعيف|weak.?(?:crypto|hash)/i,
      sink: /createHash\s*\(\s*['"](?:md5|sha1)['"]|\bmd5\s*\(|hashlib\s*\.\s*(?:md5|sha1)\s*\(|MessageDigest\s*\.\s*getInstance\s*\(\s*"(?:MD5|SHA-?1)"|\bsha1\s*\(/i,
      remedy: /sha(?:256|384|512)|sha-(?:256|384|512)|\bbcrypt\b|\bscrypt\b|\bargon2\b|pbkdf2/i,
      reason: "REJECTED_CRYPTO_FIX_UNPROVEN — نقص بلاغ التشفير الضعيف لكن الـcandidate لا يُدخل خوارزمية أقوى ولا دالة اشتقاق مفتاح",
    },
    evalx: {
      issue: /\beval\b|code injection|cwe-94(?!\d)/i,
      sink: /\beval\s*\(|\bnew\s+Function\s*\(/i,
      remedy: /JSON\s*\.\s*parse\s*\(|json\s*\.\s*loads\s*\(|ast\s*\.\s*literal_eval\s*\(/i,
      reason: "REJECTED_EVAL_FIX_UNPROVEN — نقص بلاغ eval لكن الـcandidate لا يُدخل تحليلًا آمنًا بديلًا",
    },
  };

  // الإثبات: لكل سطر إسنادِ سرٍّ اختفى، يلزم أن يُستبدَل بقراءةٍ من مصدر
  // بيئة/أسرار، وأن يكون النصّ المُستبدَل قد كان القيمة الكاملة.
  // ‎secretLines‎: أرقام الأسطر التي حملت بلاغَ سرٍّ فعلًا في before.
  //
  // [FIX] بلا هذا القيد كان ‎gone‎ يُبنى على تخمين regex وحده، فيَعُدّ سطرًا لا
  // سرَّ فيه إسنادَ سرٍّ، ويُسقط كل إصلاح في الملف. المقيس على ملف حقيقي
  // (GameServer.js المرفوع):
  //     var sessionToken = "";   ⇒   let sessionToken = "";
  // مفتاحُه يطابق ‎token‎ في SECRET_KEY_RX، وقيمتُه ‎""‎ ليست سرًّا ولا تحمل
  // بلاغًا إطلاقًا، والتغييرُ ‎var→let‎ لا علاقة له بالأسرار. ومع ذلك: السطر
  // «اختفى» (تغيّر نصّه)، وبديلُه لا يقرأ من مصدر بيئة ⇒ الإثبات يفشل ⇒
  // ترفض البوابة الكتلة كلها. وكان ذلك يُلغي 9 إصلاحات صحيحة مجتمعة —
  // قياسًا: إسقاطُ هذا السطر وحده من الكتلة يجعلها ACCEPTED وتُزيل 10 مشاكل.
  //
  // فالقيد يُعيد الحارس إلى دعواه بالحرف: «نقص بلاغُ سرٍّ ⇒ أثبِت أن ذلك
  // السرَّ أُصلح». وسطرٌ لم يحمل بلاغًا ليس جزءًا من الدعوى.
  // وعند غياب القائمة (مُستدعٍ قديم) يُرجَع إلى السلوك السابق تحفّظًا.
  function secretFixProven(beforeCode, afterCode, lang, secretLines) {
    const B = String(beforeCode).split('\n');
    const A = String(afterCode).split('\n');
    const aSet = new Set(A.map(l => l.trim()));
    const bSet = new Set(B.map(l => l.trim()));

    const onClaim = (secretLines && secretLines.size)
      ? (i => secretLines.has(i + 1))
      : (() => true);

    const gone = B.filter((l, i) => onClaim(i) && secretAssignOf(l) && !aSet.has(l.trim()));
    if (!gone.length) return false;          // لا سطر سرٍّ اختفى ⇒ لا شيء مُثبت

    // البديل يُعرَف **بالمفتاح نفسه** لا بطول بادئة مشتركة.
    // (قياسُ البادئة كان يفشل على مفتاح قصير: ‎$k = "sk_live_…"‎ ⇒ ‎$k = getenv("K")‎
    //  بادئتهما ‎$k = ‎ خمسة أحرف فقط، فكان الإصلاح السليم يُرفض — أسقط ذلك
    //  أربعة اختبارات قائمة.)
    const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    for (const line of gone) {
      if (!secretLiteralIsWholeValue(line, lang)) return false;   // الدعوى نفسها غير مُثبتة
      const a = secretAssignOf(line);
      const sameKey = new RegExp(
        '^\\s*(?:(?:const|let|var|public|private|protected|static|final|readonly)\\s+)*' +
        esc(a.key) + '\\s*[:=]');
      // سطرٌ جديد يُسنِد إلى نفس المفتاح ويقرأ من مصدر بيئة/أسرار
      const proven = A.some(l => !bSet.has(l.trim()) && sameKey.test(l) && ENV_SOURCE_RX.test(l));
      if (!proven) return false;
    }
    return true;
  }

  function verifyFix(beforeCode, afterCode, fileName, analyzeFunc, opts) {
    opts = opts || {};
    const allowUnverifiedLanguages = opts.allowUnverifiedLanguages === true;
    const requireImprovement = opts.requireImprovement !== false;
    const allowMinifiedVendor = opts.allowMinifiedVendor === true;

    if (typeof afterCode !== "string" || afterCode.trim().length === 0) {
      return { accepted: false, reason: "REJECTED_EMPTY_OUTPUT", syntaxStatus: "unknown",
               language: detectLanguage(fileName), afterIssues: null };
    }

    // (0) [MINIFIED-VENDOR] حِزمة طرف ثالث مُصغَّرة: لا إصلاح تلقائي افتراضيًا.
    // قبل أي فحص آخر، لأن الرفض هنا ليس عن عطبٍ في الـcandidate بل عن كونِ
    // الهدف كودًا لا يُصلَح في هذا المستودع. وopts.allowMinifiedVendor تجاوزٌ
    // صريح لمن يقصده.
    if (!allowMinifiedVendor) {
      const vendor = minifiedVendorProblem(beforeCode, fileName);
      if (vendor) {
        return { accepted: false,
                 reason: "REJECTED_MINIFIED_VENDOR — " + vendor +
                         " - كود طرف ثالث مُصغَّر لا يُصلَح تلقائيًا. فعّل opts.allowMinifiedVendor لتجاوز ذلك صراحةً.",
                 syntaxStatus: "unknown", language: detectLanguage(fileName), afterIssues: null };
      }
    }

    // (1) دفاع إضافي - ليس صاحب القرار الأساسي، لكنه يمنع كوارث واضحة
    const quick = quickCheck(beforeCode, afterCode, fileName);
    if (!quick.valid) {
      return {
        accepted: false,
        reason: "REJECTED_QUICKCHECK: " + quick.failedChecks.map(c => c.reason).join(", "),
        syntaxStatus: "unknown", language: quick.language, afterIssues: null, quick
      };
    }

    // (2) فحص تركيبي — يبدأ unknown، ولا يصير verified إلا بفحص فعلي ناجح
    const syn = syntaxCheck(afterCode, fileName);
    let syntaxStatus = "unknown";

    if (syn.available && !syn.ok) {
      return { accepted: false, reason: "REJECTED_SYNTAX_BROKEN [" + syn.language + "]: " + syn.reason,
               syntaxStatus: "broken", language: syn.language, afterIssues: null, quick };
    }
    if (syn.available && syn.ok) {
      syntaxStatus = "verified";
    } else {
      const isHtml = syn.language === "html";

      if (!isHtml && !allowUnverifiedLanguages) {
        return {
          accepted: false,
          reason: "REJECTED_NO_SYNTAX_CHECKER [" + syn.language + "]: " + syn.reason
            + " - لا نعتمد تعديلًا لا نستطيع التحقق من سلامته. فعّل opts.allowUnverifiedLanguages لتجاوز ذلك صراحةً.",
          syntaxStatus: "no_checker", language: syn.language, afterIssues: null, quick
        };
      }

      syntaxStatus = "unverified_language";
    }

    if (syntaxStatus === "unknown") { // حارس دفاعي: حالة غير محسومة = رفض
      return { accepted: false, reason: "REJECTED_SYNTAX_STATE_UNRESOLVED",
               syntaxStatus: "unknown", language: syn.language, afterIssues: null, quick };
    }

    // (3) التحقق العميق
    const deep = verify(beforeCode, afterCode, fileName, analyzeFunc);

    if (!deep.valid) {
      return {
        accepted: false,
        reason: "REJECTED_" + deep.reason,
        syntaxStatus, language: syn.language,
        afterIssues: null, quick, diff: deep.diff
      };
    }

    // SQL Injection: لا نقبل candidate لمجرد أن الـAnalyzer توقف عن اكتشافه.
    // نتحقق أن المشكلة الأصلية SQL وأن الناتج يثبت parameterization.
    const hasSqlIssue = code => (normalizeIssues(analyzeFunc(code, fileName)) || []).some(i => {
      const text = [
        i?.type,
        i?.title,
        i?.cAct,
        i?.ev
      ].map(v => String(v || '').toLowerCase()).join(' ');

      return (
        text.includes('sql injection') ||
        text.includes('sql_injection') ||
        text.includes('cwe-89')
      );
    });

    // [SIGNAL-PROOF] سجل الإشارة/الإثبات.
    //
    // كل مُدخَل: إشارةٌ تُطلق الصنف، وإثباتٌ يلزم لقبول اختفائها. والقاعدة
    // واحدة للجميع: الإشارة اختفت ولم يُثبَت الإصلاح ⇒ رفض. وإن بقيت الإشارة
    // في الناتج فالـcandidate لم يدّعِ إصلاح هذا الصنف، فيعود الحكم إلى
    // مقارنة diffCounts وحدها — كما كان حارس SQL يعمل بالحرف.
    // الشرط **نقصُ العدد** لا اختفاء الإشارة.
    //
    // اختفاء الإشارة وحده يترك ثقبًا مقيسًا: المحوُ الجزئي. كاشفان يُبلّغان عن
    // نفس السرّ في نفس السطر، فيُسكِت التغييرُ أحدهما ويبقى الآخر:
    //   const apiKey = "sk_live_…"   ⇒ 2 بلاغ (Stripe Secret Key + مفتاح مُضمَّن)
    //   const apiK3y = "sk_live_…"   ⇒ 1 بلاغ  (إعادة تسمية فقط، والسرّ باقٍ)
    //   const password = "hunter2hunter2"      ⇒ 2 بلاغ
    //   const password = "hunter2" + "hunter2" ⇒ 1 بلاغ (تقطيع فقط، والسرّ باقٍ)
    // الإشارة باقية في الحالين، فحارسُ «اختفت» يسكت — والعدد نقص فيمرّ
    // requireImprovement ويُقبل. أي أن إسكات كاشفٍ واحد كان يشتري القبول.
    //
    // فأي نقصٍ في عدد بلاغات صنفٍ مُسجَّل يلزمه إثبات. ونقصٌ بلا إثبات = رفض.
    const issueText = i => [i && i.type, i && i.title, i && i.cAct, i && i.strategy, i && i.cwe]
      .map(v => String(v || '')).join(' ');
    const matchingIssues = (code, rx) =>
      normalizeIssues(analyzeFunc(code, fileName) || []).filter(i => rx.test(issueText(i)));
    const countOf = (code, rx) => matchingIssues(code, rx).length;

    // أسطرُ before التي حملت بلاغَ سرٍّ فعلًا — دعوى حارس السرّ محصورةٌ بها.
    const linesOf = rx => new Set(
      matchingIssues(beforeCode, rx)
        .map(i => Number(i && i.line)).filter(n => Number.isFinite(n) && n > 0));
    const secretLinesBefore = linesOf(SECRET_ISSUE_RX);

    // ─── [EXPR-REWRITE] أُعيدت كتابةُ التعبير والبلاغُ باقٍ ⇒ ادّعاءٌ لا إصلاح
    //
    // سجلُّ الإشارة/الإثبات يُطلَق على **نقص** العدد. وثَمّ شكلٌ لا ينقص فيه
    // العدد ومع ذلك يُقبل التعديل: أن يُعيد الـcandidate كتابةَ التعبير الذي
    // يحمل البلاغ بلا إصلاحه، ويُقبل على حساب بلاغٍ **آخر** زال عرضًا.
    // والمقيس:
    //     before: db.query("SELECT * FROM users WHERE id = " + req.query.id)
    //     after : const id = String(req.query.id);
    //             db.query("SELECT * FROM users WHERE id = " + id.replace(/x/g, ""))
    //   بلاغا SQL (CWE-89 والتتبّع) باقيان حرفًا، لكن بلاغ IDOR زال لأن
    //   ‎req.query.id‎ لم يُستخدم مباشرةً ⇒ أزال 1 بلا تدهور ⇒ ACCEPTED.
    //   فحقنُ SQL باقٍ، والقبول مُشترًى ببلاغٍ من صنفٍ آخر.
    //
    // والتمييز الحاسم: هل تغيّر **التعبير** أم الإعلانُ وحده؟
    //     var query = "…" + u + "…";   ⇒   let query = "…" + u + "…";
    //   إصلاحٌ سليم لا علاقة له بـSQL، والبلاغ يبقى بحقّ. فلو كان الشرط
    //   «تغيّر السطر» لرُفض هذا الإصلاح — وهو ما يُطبَّق فعلًا على ملفاتٍ
    //   حقيقية. فيُقارَن السطر بعد نزع ‎var|let|const‎ وتوحيد المسافات.
    const _exprOf = l => String(l)
      .replace(/\b(?:var|let|const)\s+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const _afterExprs = new Set(String(afterCode).split('\n').map(_exprOf));
    const _beforeLines = String(beforeCode).split('\n');
    // هل أُعيدت كتابةُ تعبيرِ سطرٍ يحمل بلاغَ هذا الصنف؟
    const exprRewritten = lineSet => {
      for (const n of lineSet) {
        const l = _beforeLines[n - 1];
        if (l === undefined) continue;
        if (!_afterExprs.has(_exprOf(l))) return true;
      }
      return false;
    };

    const SIGNAL_PROOFS = [
      {
        id: "sql",
        count: code => (hasSqlIssue(code) ? 1 : 0),
        lines: () => linesOf(/sql[ _-]?injection|cwe-89(?!\d)/i),
        prove: () => (!sqlSinkPresent(beforeCode) ? PROOF.NA
          : sqlCandidateLooksParameterized(beforeCode, afterCode, fileName)),
        reason: "REJECTED_SQL_NOT_PARAMETERIZED — اختفت إشارة SQL من المحلل لكن الـcandidate لا يثبت parameterization صحيحًا",
      },
      {
        id: "secret",
        count: code => countOf(code, SECRET_ISSUE_RX),
        lines: () => secretLinesBefore,
        prove: () => secretFixProven(beforeCode, afterCode, syn.language, secretLinesBefore),
        reason: "REJECTED_SECRET_FIX_UNPROVEN — نقص بلاغ السرّ لكن الـcandidate لا يثبت أن القيمة كانت سرًّا كاملًا وأنها صارت تُقرأ من مصدر بيئة",
      },
      // [SINK-PROOF] الأصناف الأربعة من مُولِّد واحد — بيانات لا حُرّاس
      ...Object.keys(SINK_CLASSES).map(id => {
        const k = SINK_CLASSES[id];
        return {
          id,
          count: code => countOf(code, k.issue),
          lines: () => linesOf(k.issue),
          prove: () => sinkFixProven(beforeCode, afterCode, k.sink, k.remedy),
          reason: k.reason,
        };
      }),
    ];

    // حكمُ الإثبات موحَّد: الحُرّاس القديمة (sql، secret) تُعيد منطقيًّا،
    // ومُولِّد المصارف يُعيد ثلاثيًّا. والرفض على UNPROVEN وحدها — لا على NA.
    const proofOf = cls => {
      const v = cls.prove();
      if (v === PROOF.NA || v === PROOF.PROVEN || v === PROOF.UNPROVEN) return v;
      return v ? PROOF.PROVEN : PROOF.UNPROVEN;
    };

    for (const cls of SIGNAL_PROOFS) {
      const before = cls.count(beforeCode);
      const after = cls.count(afterCode);
      // العدد لم ينقص، وأُعيدت كتابةُ تعبيرِ سطرٍ يحمل البلاغ ⇒ ادّعاءٌ
      // يلزمه إثبات. (التفصيل عند [EXPR-REWRITE] أعلاه.)
      const claimedButKept = before > 0 && after >= before &&
        typeof cls.lines === 'function' && exprRewritten(cls.lines());
      if ((before > after || claimedButKept) && proofOf(cls) === PROOF.UNPROVEN) {
        // السببُ نفسه، ويُلحَق به أيُّ المُطلِقَين كان — فنصُّ «اختفت الإشارة»
        // لا يصدُق على حالة بقاءِ البلاغ مع إعادة كتابة تعبيره.
        const trigger = before > after
          ? ''
          : ' [أُعيدت كتابة تعبيرِ السطر والبلاغُ باقٍ — ادّعاءُ إصلاحٍ بلا إثبات]';
        return {
          accepted: false,
          reason: cls.reason + trigger,
          syntaxStatus,
          language: syn.language,
          afterIssues: null,
          quick,
          diff: deep.diff
        };
      }
    }

    // بايثون حصرًا: تعديل يُدخل كودًا غير قابل للوصول يُرفض، ولو أنقص بلاغًا.
    // مقصور على python لأن الماسح يعتمد على الإزاحة وعلى عودة عمق الأقواس
    // إلى صفر بين العبارات — وهما صحيحان في بايثون لا في لغات الأقواس. وهو
    // على JS خامل لا خاطئ (كل الأسطر تُعدّ استمرارًا بسبب `{`)، فلا يُعتمد
    // عليه هناك: كشف JS أداته acorn وهو بند منفصل.
    if (syn.language === "python") {
      const reach = pyReachabilityVerdict(beforeCode, afterCode);

      if (reach.added.length) {
        return {
          accepted: false,
          reason: "REJECTED_PY_UNREACHABLE_CODE (+" + reach.added.length + "): "
            + reach.added.slice(0, 3).join(" | ")
            + " — التعديل يُدخل كودًا غير قابل للوصول، فناتج الدالة تغيّر",
          syntaxStatus,
          language: syn.language,
          afterIssues: null,
          quick,
          diff: deep.diff
        };
      }

      // اشتباه لا دليل: الشكل نفسه يحتمل حذفًا سليمًا وقتلًا مُقنّعًا، ولا
      // يفصلهما النص. نرفض كما يرفض السلوك السابق، لكن بسبب مُميَّز كي يظهر
      // الصنف في السجلات ولا يُحسب ضررًا مؤكَّدًا.
      if (reach.suspect.length) {
        return {
          accepted: false,
          reason: "REJECTED_PY_UNREACHABLE_CODE (مشتبه): " + reach.suspect[0]
            + " — نصّ ميت جديد ظهر مع نقص في عبارات قابلة للوصول",
          syntaxStatus,
          language: syn.language,
          afterIssues: null,
          quick,
          diff: deep.diff
        };
      }
    }

    if (requireImprovement && !deep.improved) {
      return {
        accepted: false,
        reason: "REJECTED_NO_IMPROVEMENT (تغيّر الكود دون إنقاص أي مشكلة)",
        syntaxStatus, language: syn.language,
        afterIssues: null, quick, diff: deep.diff
      };
    }

    // نعيد تحليل الناتج لتمريره كأساس للـfixer التالي
    let afterIssues = null;
    try { afterIssues = normalizeIssues(analyzeFunc(afterCode, fileName)); }
    catch (e) { afterIssues = null; }
    if (afterIssues === null) {
      return { accepted: false, reason: "REJECTED_ANALYSIS_INCONCLUSIVE",
               syntaxStatus, language: syn.language, afterIssues: null, quick, diff: deep.diff };
    }

    const d = deep.diff || { removedCount: 0, addedCount: 0 };
    return {
      accepted: true,
      reason: "ACCEPTED (أزال " + d.removedCount + " مشكلة، بلا تدهور)"
        + (syntaxStatus === "verified" ? "" : " ⚠️ SYNTAX_UNVERIFIED [" + syn.language + "]"),
      syntaxStatus,
      syntaxVerified: syntaxStatus === "verified",
      language: syn.language,
      afterIssues,
      removedCount: d.removedCount,
      addedCount: d.addedCount,
      quick,
      diff: deep.diff
    };
  }

  // ═══════════════════════════════════════════════
  // fullVerify — الواجهة القديمة محفوظة
  // ═══════════════════════════════════════════════

  function fullVerify(originalCode, fixedCode, fileName, analyzeFunc, opts) {
    const quick = quickCheck(originalCode, fixedCode, fileName);
    if (!quick.valid) {
      return { valid: false, improved: false,
               reason: quick.failedChecks.map(c => c.reason).join(", "), quick };
    }

    const gate = verifyFix(originalCode, fixedCode, fileName, analyzeFunc, opts);
    const deep = verify(originalCode, fixedCode, fileName, analyzeFunc);

    return {
      valid: gate.accepted,
      improved: deep.improved,
      reason: gate.reason,
      originalIssues: deep.originalIssues,
      fixedIssues: deep.fixedIssues,
      newIssues: deep.newIssues,
      resolvedIssues: deep.resolvedIssues,
      syntaxStatus: gate.syntaxStatus,
      language: gate.language,
      diff: deep.diff,
      quick
    };
  }

  return {
    // الواجهة القديمة
    verify, quickCheck, fullVerify,
    // البوابة الموحّدة التي يستدعيها الـOrchestrator
    verifyFix,
    // تصنيف أسباب الرفض — مالكُه البوابة نفسها
    isHarmfulRejection, HARMFUL_REJECTION_PREFIXES,
    isTargetRejection, TARGET_REJECTION_PREFIXES,
    // أدوات مشتركة (حتى لا يعيد أحد كتابتها)
    detectLanguage, syntaxCheck, normalizeIssues, normalizeSeverity,
    isHighSeverity, issueKey, issueCounts, diffCounts
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.window !== "undefined") globalThis.window.FixVerifier = FixVerifier;
if (typeof module !== "undefined" && module.exports) module.exports = FixVerifier;
