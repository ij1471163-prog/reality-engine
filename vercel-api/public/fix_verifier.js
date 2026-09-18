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

    function scanLine(raw) {
      let out = "";
      let quote = null;
      let triple = null;
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

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];

      if (!raw.trim()) continue;

      const leadingMatch = raw.match(/^[ \t]*/);
      const leading = leadingMatch ? leadingMatch[0] : "";

      // لا نسمح بخلط tab وspaces داخل نفس indentation.
      if (leading.includes(" ") && leading.includes("\t")) {
        return {
          ok: false,
          available: true,
          language: "python",
          reason: "mixed tabs and spaces in indentation at line " + (i + 1)
        };
      }

      const indent = leading
        .replace(/\t/g, "    ")
        .length;

      const scanned = scanLine(raw.slice(leading.length));

      if (scanned.quote || scanned.triple) {
        return {
          ok: false,
          available: true,
          language: "python",
          reason: "unterminated Python string at line " + (i + 1)
        };
      }

      const clean = scanned.code.trim();

      if (!clean) continue;

      // بعد block header، السطر التالي يجب أن يكون أعمق.
      if (expectIndent) {
        const parentIndent = indentStack[indentStack.length - 1];

        if (indent <= parentIndent) {
          return {
            ok: false,
            available: true,
            language: "python",
            reason: "expected indented block after line " + i
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
              reason: "inconsistent indentation at line " + (i + 1)
            };
          }
        } else {
          // زيادة indentation بدون block header.
          return {
            ok: false,
            available: true,
            language: "python",
            reason: "unexpected indentation at line " + (i + 1)
          };
        }
      }

      // تحقق الأقواس خارج strings/comments.
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

      /*
       * Block header محافظ:
       * نعترف بالـcolon عندما يكون آخر token في السطر.
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
  function issueKey(issue, fallbackFile) {
    if (issue == null) return "unknown";
    if (typeof issue === "string") {
      return "raw|" + String(issue).replace(/\s+/g, "").toLowerCase().replace(/\d+/g, "#").slice(0, 100);
    }
    const stable = issue.ruleId || issue.rule || issue.id || issue.type
      || issue.name || issue.title || issue.category || "issue";
    const file = issue.file || issue.filename || fallbackFile || "";
    return String(stable) + "|" + String(file);
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

  // SQL candidate guard — لا يكفي اختفاء SQL Injection من الـAnalyzer.
  // يجب أن يثبت الـcandidate وجود parameterization مناسب للغة.
  function sqlCandidateLooksParameterized(beforeCode, afterCode, fileName) {
    const ext = String(fileName).split('.').pop().toLowerCase();

    if (ext === 'js' || ext === 'ts') {
      return (
        /\?\s*["'`]\s*,\s*\[[\s\S]*\]/.test(afterCode) ||
        /\$\d+/.test(afterCode) ||
        /\bparams?\s*[,)]/.test(afterCode)
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
  function verifyFix(beforeCode, afterCode, fileName, analyzeFunc, opts) {
    opts = opts || {};
    const allowUnverifiedLanguages = opts.allowUnverifiedLanguages === true;
    const requireImprovement = opts.requireImprovement !== false;

    if (typeof afterCode !== "string" || afterCode.trim().length === 0) {
      return { accepted: false, reason: "REJECTED_EMPTY_OUTPUT", syntaxStatus: "unknown",
               language: detectLanguage(fileName), afterIssues: null };
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
    const originalSqlIssue = normalizeIssues(
      analyzeFunc(beforeCode, fileName)
    ).some(i => {
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

    if (
      originalSqlIssue &&
      !sqlCandidateLooksParameterized(beforeCode, afterCode, fileName)
    ) {
      return {
        accepted: false,
        reason: "REJECTED_SQL_NOT_PARAMETERIZED — اختفت إشارة SQL من المحلل لكن الـcandidate لا يثبت parameterization صحيحًا",
        syntaxStatus,
        language: syn.language,
        afterIssues: null,
        quick,
        diff: deep.diff
      };
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
    // أدوات مشتركة (حتى لا يعيد أحد كتابتها)
    detectLanguage, syntaxCheck, normalizeIssues, normalizeSeverity,
    isHighSeverity, issueKey, issueCounts, diffCounts
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.window !== "undefined") globalThis.window.FixVerifier = FixVerifier;
if (typeof module !== "undefined" && module.exports) module.exports = FixVerifier;
