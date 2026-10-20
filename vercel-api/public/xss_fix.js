// ═══════════════════════════════════════════════════════
// xss_fix.js v2.0
// إصلاح XSS في JS / HTML (سكربتات inline) / PHP — على نفس واجهة v1.0:
//     XSSFixer.canFix(issues) → boolean
//     XSSFixer.fix(code, fileName[, opts]) → { fixed, changed, edits, unresolved }
//
// لماذا أُعيدت الكتابة (v1.0 كان regex سطرًا بسطر):
//   • .replace(/[<>]/g,'') ليس تعقيمًا: مع textContent لا حاجة له أصلًا، ومع غيره
//     لا يكفي، وهو يشوّه البيانات.
//   • innerHTML → textContent بلا تمييز يُسطّح أي markup مقصود (<b>…</b> تصير نصًا).
//   • innerHTML += كان يُحوَّل إلى span يُلحق بـ document.body مهما كان العنصر،
//     ويُسقط الـmarkup؛ وإن لم يكن RHS بصيغة 'نص' + متغيّر صار String(value)
//     (متغيّر غير معرّف ⇒ ReferenceError).
//   • const _p / const _el تتكرر فتنتج SyntaxError عند تكرار الإصلاح في نطاق واحد.
//   • eval / document.write كانت تُحوَّل إلى تعليق فيُحذف السطر (يتبقى متغيّر
//     غير معرّف، أو أقواس يتيمة ⇒ SyntaxError في تعبير متعدد الأسطر).
//   • PHP: القاعدة الثالثة تحوّل أي `<?php echo $arr['k']` إلى
//     htmlspecialchars($arr, …)['k'] (مصفوفة ⇒ TypeError في PHP 8، وفهرسة لناتج
//     دالة)، ومنها $_GET و$_COOKIE.
//   • كتل مكررة ميتة (eval وinnerHTML +=)، وfixJS تُنفَّذ مرتين على ملفات HTML.
//   • حذف أسرار الفوتر وSQL كان هنا خارج اختصاص الملف: لـSecretsFixer
//     وSQLInjectionFixer (والمنسّق يشغّلهما). وحذف السر من الصفحة لا يُبطل
//     تسريبه: يلزم تدويره (rotate).
//
// المبادئ:
//   1. JS: AST حقيقي (acorn) وتعديلات نصية بحسب المواقع (ranges) — لا إعادة
//      توليد للكود، فيبقى التنسيق والتعليقات كما هي.
//   2. لا إصلاح مخترَع: ما لا يمكن إثبات سلامة تحويله يُترك كما هو ويُسجَّل في
//      `unresolved` (eval، تعبير معقّد، سياق غير معروف…).
//   3. بعد التعديل يُعاد تحليل الناتج بـacorn؛ إن انكسر التركيب يُرجَع الكود
//      الأصلي كما هو (لا يُسلَّم تعديل مكسور أبدًا).
//   4. idempotent: تشغيله على ناتجه لا يغيّر شيئًا.
//   5. لا يرمي استثناءً أبدًا.
//
// ما يُحوَّل (JS):
//   el.innerHTML = x                 → el.textContent = x            (x متغيّر/عضو فقط)
//   el.innerHTML = "نص " + x         → el.textContent = "نص " + x    (بلا markup ثابت)
//   el.innerHTML = "<b>" + x + "</b>"→ … + __escapeHTML(x) + …       (markup محفوظ)
//   el.innerHTML += "<li>"+x+"</li>" → el.insertAdjacentHTML("beforeend", …escaped)
//   el.innerHTML += x                → el.insertAdjacentText("beforeend", x)
//   el.outerHTML = …                 → نفس عائلة التعقيم (لا textContent: يغيّر المعنى)
//   el.insertAdjacentHTML(p, …)      → تعقيم المقاطع الديناميكية أو insertAdjacentText
//   document.write/writeln(…)        → تعقيم المقاطع الديناميكية
//   $(…).html("<b>"+x+"</b>")        → تعقيم المقاطع الديناميكية (حالة markup فقط)
// ما يُسجَّل في unresolved ولا يُلمس:
//   eval(x) · new Function(x) · setTimeout("…"+x) · dangerouslySetInnerHTML
//   · أي قيمة HTML ناتجة عن استدعاء/شرط/تعبير معقّد (قد تكون HTML موثوقة).
//
// PHP (بلا parser: ماسح حالة صغير يعرف الـstrings والتعليقات والـheredoc):
//   echo/print/<?= بمقاطع مفصولة بـ . أو , ؛ المتغيّرات $x / $a['k'] / $o->p
//   تُلفّ بـ htmlspecialchars((string)…, ENT_QUOTES, 'UTF-8'). أي مقطع آخر
//   (استدعاء غير معروف، "…$x…" interpolation، عمليات حسابية…) ⇒ العبارة كلها
//   تُترك. وداخل <script> أو on*="" أو style="" أو قيمة attribute بلا اقتباس ⇒
//   تُترك (htmlspecialchars لا يحمي هذه السياقات).
//
// الخيارات (وسيط ثالث اختياري، المنسّق لا يمرّره فيُستخدم الافتراضي):
//   opts.bareHtml = "escape"  يمنع تحويل innerHTML → textContent ويُبقي innerHTML مع
//                             __escapeHTML (للصفحات التي تعتمد على الـmarkup).
//
// نتيجة fix() الإضافية (المنسّق يقرأ fixed/changed فقط):
//   edits[]      ما عُدِّل: { line, kind, before, action, wrapped? }
//   unresolved[] ما لم يُلمس ولماذا: { kind, line, snippet, reason }
//
// حدود مُعلنة:
//   • TS/TSX/JSX لا يفهمها acorn ⇒ لا تعديل (يُسجَّل PARSE_FAILED).
//   • بوابة التحقق في fixers_orchestrator تُعيد تحليل الناتج وتشترط نقص بلاغات؛
//     والمحلّلات الحالية ما زالت تُبلّغ عن innerHTML حتى لو عُقِّم المحتوى،
//     فتعديلات "التعقيم مع الإبقاء على innerHTML" صحيحة لكنها قد تُرفض هناك
//     (REJECTED_NO_IMPROVEMENT) بينما تُقبل تحويلات textContent.
// ═══════════════════════════════════════════════════════
"use strict";

var XSSFixer = (() => {

  // ─── مساعد التعقيم الذي يُحقن في كود المستخدم ───────────────
  // يُكتب كدالة حقيقية هنا ثم يُؤخذ نصها (toString) كي لا نُصارع escaping
  // لنص يحوي كل أنواع الاقتباس. String(v) وليس v ?? "" عمدًا: السلوك الأصلي
  // للـconcatenation يطبع "null"/"undefined" ونحافظ عليه.
  function __escapeHTML(v) {
    return String(v).replace(/[&<>"'`]/g, function (c) {
      switch (c) {
        case "&": return "&amp;";
        case "<": return "&lt;";
        case ">": return "&gt;";
        case '"': return "&quot;";
        case "'": return "&#39;";
        default:  return "&#96;";
      }
    });
  }
  const HELPER = "__escapeHTML";
  // نزيل إزاحة الـIIFE (مسافتان) من كل سطر عدا الأول ليبدو الإعلان مُنسَّقًا في كود المستخدم
  const HELPER_DECL = Function.prototype.toString.call(__escapeHTML)
    .split("\n").map((l, i) => (i === 0 ? l : l.replace(/^ {2}/, ""))).join("\n");
  const HELPER_NOTE = "// [XSSFixer] يعقّم القيم الديناميكية داخل نصوص HTML";
  const HELPER_DECLARED_RE = /\bfunction\s+__escapeHTML\b|\b(?:var|let|const)\s+__escapeHTML\b/;

  const XSS_RE = /xss|innerhtml|outerhtml|document\.write|insertadjacenthtml|cwe-?79/i;

  // اسم دالة تعقيم معروفة (آخر مقطع من المسار): esc / escHtml / escapeHtml / sanitize* / DOMPurify.sanitize …
  const SANITIZER_LAST_RE = /^(?:__escapeHTML|esc\w*|escape\w*|sanitiz\w*|encodeHTML|encodeHtml|encodeURIComponent|encodeURI|purify|filterXSS|xss)$/i;

  const NUMERIC_CALL_RE = /^(?:Number|parseInt|parseFloat|Boolean|Math\.[A-Za-z]+|Date\.now)$/;
  const STRING_METHODS = new Set([
    "trim", "trimStart", "trimEnd", "toString", "toLowerCase", "toUpperCase",
    "slice", "substring", "substr", "toFixed", "padStart", "padEnd"
  ]);

  // ═════════════════════════════════════════════════════
  // أدوات عامة
  // ═════════════════════════════════════════════════════

  function getAcorn() {
    try {
      if (typeof acorn !== "undefined" && acorn && typeof acorn.parse === "function") return acorn;
    } catch (_) { /* غير معرّف */ }
    try {
      if (typeof require === "function") {
        const a = require("./acorn.min.js");
        if (a && typeof a.parse === "function") return a;
      }
    } catch (_) { /* لا acorn */ }
    return null;
  }

  function parseJS(ac, code) {
    const base = {
      ecmaVersion: "latest", ranges: true, locations: true,
      allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true
    };
    try {
      return { ast: ac.parse(code, Object.assign({ sourceType: "module" }, base)) };
    } catch (_) {
      try {
        return { ast: ac.parse(code, Object.assign({ sourceType: "script" }, base)) };
      } catch (e2) {
        return { ast: null, error: String(e2 && e2.message || e2) };
      }
    }
  }

  function walk(node, visit, parent) {
    if (!node || typeof node.type !== "string") return;
    visit(node, parent);
    for (const key in node) {
      if (key === "loc" || key === "range" || key === "type") continue;
      const v = node[key];
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === "string") walk(c, visit, node);
      } else if (v && typeof v.type === "string") {
        walk(v, visit, node);
      }
    }
  }

  function snippet(code, node, max) {
    return code.slice(node.start, node.end).replace(/\s+/g, " ").slice(0, max || 100);
  }

  function lineAt(text, index) {
    let n = 1;
    for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  }

  function countNewlines(text) {
    let n = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  }

  // ═════════════════════════════════════════════════════
  // JS — تصنيف التعبيرات
  // ═════════════════════════════════════════════════════

  function calleeText(code, callee) {
    return code.slice(callee.start, callee.end).replace(/\s+/g, "");
  }

  function isStringLit(n)   { return n.type === "Literal" && typeof n.value === "string"; }
  function isStaticLit(n)   { return n.type === "Literal" && !n.regex; }
  function hasMarkupChars(s) { return /[<&]/.test(s); }

  /** قيمة بيانات بسيطة: قراءة متغيّر/عضو، أو تركيب منطقي بسيط منها. لا استدعاءات. */
  function isSimpleData(n) {
    if (!n) return false;
    switch (n.type) {
      case "Identifier":
      case "ThisExpression":
        return true;
      case "Literal":
        // نصٌّ ثابت فيه markup داخل شرط/منطق ⇒ ليس "بيانات" بل HTML مقصود
        return !(typeof n.value === "string" && /[<>&]/.test(n.value));
      case "MemberExpression":
        return isSimpleData(n.object) && (!n.computed || isSimpleData(n.property));
      case "ChainExpression":
        return isSimpleData(n.expression);
      case "LogicalExpression":
        return isSimpleData(n.left) && isSimpleData(n.right);
      case "ConditionalExpression":
        return isSimpleData(n.test) && isSimpleData(n.consequent) && isSimpleData(n.alternate);
      case "BinaryExpression":
        return isSimpleData(n.left) && isSimpleData(n.right);
      case "UnaryExpression":
        return n.operator !== "delete" && isSimpleData(n.argument);
      case "TemplateLiteral":
        return n.quasis.every(q => !/[<>&]/.test(q.value.cooked || q.value.raw || "")) &&
               n.expressions.every(isSimpleData);
      case "CallExpression": {
        const c = n.callee;
        if (c.type === "Identifier" && c.name === "String") return n.arguments.every(isSimpleData);
        if (c.type === "MemberExpression" && !c.computed && c.property.type === "Identifier" &&
            STRING_METHODS.has(c.property.name)) {
          return isSimpleData(c.object) && n.arguments.every(isSimpleData);
        }
        return false;
      }
      default:
        return false;
    }
  }

  function isSanitizerCallee(text) {
    return SANITIZER_LAST_RE.test(text.split(".").pop()) || /(?:^|\.)DOMPurify\.sanitize$/.test(text);
  }

  function isSafeCall(code, n) {
    if (n.type !== "CallExpression") return false;
    const t = calleeText(code, n.callee);
    return isSanitizerCallee(t) || NUMERIC_CALL_RE.test(t);
  }

  // ═════════════════════════════════════════════════════
  // JS — أصل القيمة (provenance-lite)
  //
  // لماذا: في كود واجهات حقيقي، معظم ${x} داخل قوالب innerHTML إما (أ) أرقام،
  // أو (ب) HTML بُني في مكان آخر (cards = list.map(...).join('')),
  // أو (ج) نصّ عُقِّم مسبقًا (safe = c.replace(/</g,'&lt;')…). تعقيم (ب) يعرض الوسوم
  // نصًّا، وتعقيم (ج) يُعقّم مرتين. وقد ظهر ذلك فعلًا عند تشغيل v2 الأولى على
  // admin.html / index.html في هذا المستودع. لذلك نتتبّع أصل المتغيّر محليًا:
  //   safe    : رقم / منطقي / نصّ ثابت بلا markup / ناتج دالة تعقيم  ⇒ لا يُلمس
  //   html    : يُبنى كـHTML (قالب/نصّ فيه < أو map().join() ببناء وسوم) ⇒ لا يُعقَّم،
  //             ويُسجَّل في unresolved (الإصلاح عند موضع بنائه لا استهلاكه)
  //   unknown : معامل دالة / عضو كائن / عام / غير محلول ⇒ يُعامل كنص ويُعقَّم
  // ═════════════════════════════════════════════════════

  function containsMarkup(node) {
    let found = false;
    walk(node, n => {
      if (found) return;
      if (n.type === "Literal" && typeof n.value === "string" && hasMarkupChars(n.value)) found = true;
      else if (n.type === "TemplateElement" && hasMarkupChars(n.value.cooked || n.value.raw || "")) found = true;
    });
    return found;
  }

  const FN_TYPES = new Set(["Program", "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

  function patternNames(p, out) {
    if (!p) return out;
    switch (p.type) {
      case "Identifier":        out.push(p.name); break;
      case "ObjectPattern":     p.properties.forEach(q => patternNames(q.type === "RestElement" ? q.argument : q.value, out)); break;
      case "ArrayPattern":      p.elements.forEach(e => patternNames(e, out)); break;
      case "RestElement":       patternNames(p.argument, out); break;
      case "AssignmentPattern": patternNames(p.left, out); break;
      default: break;
    }
    return out;
  }

  function buildEnv(ast, code) {
    const parentOf = new WeakMap();
    walk(ast, (n, parent) => { if (parent) parentOf.set(n, parent); });
    const scopeCache = new WeakMap();

    function scopeInfo(fn) {
      let info = scopeCache.get(fn);
      if (info) return info;
      info = { names: new Set(), contribs: new Map() };   // name -> [{init}|{unknown}|{numeric}|{rhs}|{append}]
      const add = (name, c) => {
        info.names.add(name);
        if (!info.contribs.has(name)) info.contribs.set(name, []);
        if (c) info.contribs.get(name).push(c);
      };
      (fn.params || []).forEach(p => patternNames(p, []).forEach(nm => add(nm, { unknown: true })));

      const bodyRoot = fn.type === "Program" ? fn : fn.body;
      // التصريحات: لا ندخل دوالَّ متداخلة (نطاق مستقل)
      (function scan(n, isRoot) {
        if (!n || typeof n.type !== "string") return;
        if (!isRoot && FN_TYPES.has(n.type)) {
          if (n.type === "FunctionDeclaration" && n.id) add(n.id.name, { unknown: true });
          return;
        }
        if (n.type === "VariableDeclarator") {
          const names = patternNames(n.id, []);
          const par = parentOf.get(n);
          const gp = par && parentOf.get(par);
          const isLoopVar = gp && (gp.type === "ForOfStatement" || gp.type === "ForInStatement") && gp.left === par;
          if (n.id.type === "Identifier" && n.init && !isLoopVar) add(n.id.name, { init: n.init });
          else if (n.id.type === "Identifier" && !n.init && !isLoopVar) add(n.id.name, null);
          else names.forEach(nm => add(nm, { unknown: true }));
        }
        for (const key in n) {
          if (key === "loc" || key === "range" || key === "type") continue;
          const v = n[key];
          if (Array.isArray(v)) v.forEach(c => { if (c && typeof c.type === "string") scan(c, false); });
          else if (v && typeof v.type === "string") scan(v, false);
        }
      })(bodyRoot, true);

      // الإسنادات: على كل الشجرة الفرعية (قد تُسنَد من دالة متداخلة) — تقدير محافظ
      walk(bodyRoot, n => {
        if (n.type === "AssignmentExpression" && n.left.type === "Identifier") {
          const nm = n.left.name;
          if (!info.names.has(nm)) return;
          if (n.operator === "=")       info.contribs.get(nm).push({ rhs: n.right });
          else if (n.operator === "+=") info.contribs.get(nm).push({ append: n.right });
          else                          info.contribs.get(nm).push({ numeric: true });
        } else if (n.type === "UpdateExpression" && n.argument.type === "Identifier") {
          const nm = n.argument.name;
          if (info.names.has(nm)) info.contribs.get(nm).push({ numeric: true });
        }
      });

      scopeCache.set(fn, info);
      return info;
    }

    const resolving = new Set();

    function resolveIdent(name, node, depth) {
      for (let a = parentOf.get(node); a; a = parentOf.get(a)) {
        if (!FN_TYPES.has(a.type)) continue;
        const info = scopeInfo(a);
        if (!info.names.has(name)) continue;
        const key = name + "@" + a.start;
        if (resolving.has(key) || depth > 5) return "unknown";
        resolving.add(key);
        try {
          const kinds = (info.contribs.get(name) || []).map(c => {
            if (c.unknown) return "unknown";
            if (c.numeric) return "safe";
            if (c.init)    return originKind(c.init, depth + 1);
            if (c.rhs)     return originKind(c.rhs, depth + 1);
            if (c.append)  return originKind(c.append, depth + 1);
            return "unknown";
          });
          if (!kinds.length) return "unknown";
          if (kinds.every(k => k === "safe")) return "safe";
          if (kinds.some(k => k === "html")) return "html";
          return "unknown";
        } finally {
          resolving.delete(key);
        }
      }
      return "unknown";
    }

    function combine(kinds) {
      if (kinds.every(k => k === "safe")) return "safe";
      if (kinds.some(k => k === "html")) return "html";
      return "unknown";
    }

    /** @returns {"safe"|"html"|"unknown"} */
    function originKind(n, depth) {
      depth = depth || 0;
      if (!n || depth > 6) return "unknown";
      switch (n.type) {
        case "Literal":
          if (typeof n.value === "string") return hasMarkupChars(n.value) ? "html" : "safe";
          return "safe";
        case "TemplateLiteral":
          if (n.quasis.some(q => hasMarkupChars(q.value.cooked || q.value.raw || ""))) return "html";
          return combine(n.expressions.map(e => originKind(e, depth + 1)));
        case "Identifier":
          return n.name === "undefined" ? "safe" : resolveIdent(n.name, n, depth);
        case "MemberExpression":
          return isLengthMember(n) ? "safe" : "unknown";
        case "UnaryExpression":
        case "UpdateExpression":
          return "safe";
        case "BinaryExpression":
          if (n.operator === "+") return combine([originKind(n.left, depth + 1), originKind(n.right, depth + 1)]);
          return "safe";   // - * / % ** مقارنات … ⇒ رقم/منطقي
        case "LogicalExpression":
          return combine([originKind(n.left, depth + 1), originKind(n.right, depth + 1)]);
        case "ConditionalExpression":
          return combine([originKind(n.consequent, depth + 1), originKind(n.alternate, depth + 1)]);
        case "ChainExpression":
          return originKind(n.expression, depth + 1);
        case "CallExpression": {
          const ct = calleeText(code, n.callee);
          if (isSanitizerCallee(ct) || NUMERIC_CALL_RE.test(ct)) return "safe";
          const c = n.callee;
          if (c.type === "MemberExpression" && !c.computed && c.property.type === "Identifier") {
            const m = c.property.name;
            if (m === "toFixed" || m === "toLocaleString") return "safe";
            // سلسلة replace بأنماط تعقيم (/</g → &lt;) ⇒ مُعقَّم مسبقًا
            if (m === "replace" || m === "replaceAll") {
              let cur = n, sanitized = false;
              while (cur && cur.type === "CallExpression" && cur.callee.type === "MemberExpression" &&
                     /^replace(?:All)?$/.test(cur.callee.property.name || "")) {
                const a0 = cur.arguments[0], a1 = cur.arguments[1];
                const pat = a0 && (a0.regex ? a0.regex.pattern : (isStringLit(a0) ? a0.value : ""));
                if (pat && /[<>&"']/.test(pat) && a1 && isStringLit(a1) && /&/.test(a1.value)) sanitized = true;
                cur = cur.callee.object;
              }
              if (sanitized) return "safe";
            }
            // بُني كـHTML: list.map(x => `<li>…</li>`).join('')
            if (m === "join" && containsMarkup(c.object)) return "html";
            if (STRING_METHODS.has(m)) return originKind(c.object, depth + 1);
          }
          if (c.type === "Identifier" && c.name === "String" && n.arguments.length === 1) {
            return originKind(n.arguments[0], depth + 1);
          }
          return "unknown";
        }
        default:
          return "unknown";
      }
    }

    return { originKind };
  }

  function isLengthMember(n) {
    return n.type === "MemberExpression" && !n.computed &&
           n.property.type === "Identifier" && n.property.name === "length";
  }

  // ═════════════════════════════════════════════════════
  // مصنّف سياق HTML (مشترك بين JS وPHP)
  // ═════════════════════════════════════════════════════
  // يقرأ النص الثابت المتراكم حتى نقطة الإدراج (وليس المقطع السابق فقط) ويُرجِع في أيّ
  // سياق سيقع الناتج الديناميكي. التعقيم بالـHTML-escape يُسمح به في سياقين فقط:
  //   • نص HTML عادي (وRCDATA: textarea/title)
  //   • attribute مقتبس عام (ليس URL ولا handler ولا style ولا srcdoc)
  //   • وURL مقتبس بشرط بادئة ثابتة تمنع تغيير المخطط والمضيف (/x… أو #… أو ?…)
  // كل ما عدا ذلك غير مدعوم ⇒ يُترك الكود ويُسجَّل في unresolved.
  // افتراضات معلنة: البدء من حالة "نص"؛ ومخرجات غير معروفة (استدعاءات/HTML جاهز) تُعتبر
  // أجزاء متوازنة إن كانت الحالة "نص"، وإلا يُعتبر السياق مفقودًا (lost) فلا نعدّل بعدها.
  const URL_ATTRS = new Set(["href", "src", "action", "formaction", "data", "poster", "background",
    "cite", "longdesc", "manifest", "icon", "codebase", "archive", "classid", "profile", "usemap",
    "srcset", "imagesrcset", "ping", "xlink:href", "lowsrc", "dynsrc", "code", "object"]);
  const RAW_TAGS = new Set(["script", "style", "iframe", "noembed", "noframes", "noscript", "xmp", "plaintext"]);
  const RCDATA_TAGS = new Set(["textarea", "title"]);
  const URL_UNSAFE_TAGS = new Set(["script", "iframe", "frame", "frameset", "embed", "object",
    "base", "link", "meta", "applet", "portal"]);
  const CTX_REASONS = {
    "script":        "داخل <script> (سياق JavaScript) — HTML-escape لا يحمي هذا السياق",
    "style":         "داخل <style> (سياق CSS) — HTML-escape لا يحمي هذا السياق",
    "raw-other":     "داخل عنصر نصّه خام (iframe/noscript/xmp…) — سياق غير مدعوم",
    "tag-name":      "اسم وسم ديناميكي — لا يمكن تعقيمه بالـescape",
    "attr-name":     "اسم attribute ديناميكي (أو موضع attribute جديد) — لا يمكن تعقيمه بالـescape",
    "attr-unquoted": "قيمة attribute بلا اقتباس — الـescape لا يمنع إضافة attributes (مسافة)",
    "attr-handler":  "داخل معالج حدث on*= (سياق JavaScript) — HTML-escape لا يحمي هذا السياق",
    "attr-css":      "داخل style=\"\" (سياق CSS) — HTML-escape لا يحمي هذا السياق",
    "attr-srcdoc":   "داخل srcdoc= (مستند HTML كامل) — يحتاج تعقيمًا مختلفًا",
    "attr-url":      "قيمة URL (href/src/…) بلا بادئة ثابتة آمنة — الـescape لا يمنع javascript:/data: أو تغيير المضيف؛ يلزم allowlist للمخطط",
    "comment":       "داخل تعليق HTML — سياق غير مدعوم",
    "markup-other":  "داخل بنية HTML غير عادية (end tag / declaration) — سياق غير مدعوم",
    "lost":          "تعذّر إثبات السياق: مخرجات سابقة غير معروفة تركت وسمًا مفتوحًا"
  };

  function makeHtmlScanner() {
    const S = { st: "data", tag: "", attr: "", val: "", raw: "", rbuf: "", cbuf: "", lost: false };
    const isWs = c => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
    const isAlpha = c => /[A-Za-z]/.test(c);
    function closeTag() {
      S.attr = ""; S.val = "";
      if (RAW_TAGS.has(S.tag) || RCDATA_TAGS.has(S.tag)) { S.st = "raw"; S.raw = S.tag; S.rbuf = ""; }
      else S.st = "data";
    }
    function feed(s) {
      for (let i = 0; i < s.length; i++) {
        const c = s.charAt(i);
        switch (S.st) {
          case "data": if (c === "<") S.st = "tagopen"; break;
          case "tagopen":
            if (isAlpha(c)) { S.st = "tagname"; S.tag = c.toLowerCase(); S.attr = ""; S.val = ""; }
            else if (c === "/") S.st = "endopen";
            else if (c === "!") { S.st = "decl"; S.cbuf = ""; }
            else if (c === "?") S.st = "bogus";
            else S.st = c === "<" ? "tagopen" : "data";
            break;
          case "endopen": S.st = isAlpha(c) ? "endtag" : (c === ">" ? "data" : "bogus"); break;
          case "endtag": case "bogus": if (c === ">") S.st = "data"; break;
          case "decl":
            S.cbuf += c;
            if (S.cbuf === "--") { S.st = "comment"; S.cbuf = ""; }
            else if (S.cbuf !== "-") S.st = c === ">" ? "data" : "bogus";
            break;
          case "comment":
            S.cbuf = (S.cbuf + c).slice(-3);
            if (S.cbuf === "-->") S.st = "data";
            break;
          case "tagname":
            if (isWs(c) || c === "/") S.st = "beforeattr";
            else if (c === ">") closeTag();
            else S.tag += c.toLowerCase();
            break;
          case "beforeattr":
            if (isWs(c) || c === "/") break;
            if (c === ">") closeTag(); else { S.st = "attrname"; S.attr = c.toLowerCase(); }
            break;
          case "attrname":
            if (isWs(c)) S.st = "afterattr";
            else if (c === "=") S.st = "beforeval";
            else if (c === ">") closeTag();
            else if (c === "/") S.st = "beforeattr";
            else S.attr += c.toLowerCase();
            break;
          case "afterattr":
            if (isWs(c)) break;
            if (c === "=") S.st = "beforeval";
            else if (c === ">") closeTag();
            else if (c === "/") S.st = "beforeattr";
            else { S.st = "attrname"; S.attr = c.toLowerCase(); }
            break;
          case "beforeval":
            if (isWs(c)) break;
            if (c === '"') { S.st = "dq"; S.val = ""; }
            else if (c === "'") { S.st = "sq"; S.val = ""; }
            else if (c === ">") closeTag();
            else { S.st = "uq"; S.val = c; }
            break;
          case "dq": if (c === '"') S.st = "beforeattr"; else S.val += c; break;
          case "sq": if (c === "'") S.st = "beforeattr"; else S.val += c; break;
          case "uq":
            if (isWs(c)) S.st = "beforeattr";
            else if (c === ">") closeTag();
            else S.val += c;
            break;
          case "raw":
            S.rbuf = (S.rbuf + c).slice(-24);
            if ((c === ">" || c === "/" || isWs(c)) && S.rbuf.toLowerCase().endsWith("</" + S.raw + c)) {
              S.st = c === ">" ? "data" : "endtag";
            }
            break;
          default: S.st = "data";
        }
      }
    }
    function markUnknown() { if (S.st !== "data") S.lost = true; }
    function context() {
      if (S.lost) return { ctx: "lost" };
      switch (S.st) {
        case "data": return { ctx: "text" };
        case "raw":
          if (S.raw === "script") return { ctx: "script" };
          if (S.raw === "style") return { ctx: "style" };
          return RCDATA_TAGS.has(S.raw) ? { ctx: "text" } : { ctx: "raw-other" };
        case "tagopen": case "tagname": return { ctx: "tag-name" };
        case "beforeattr": case "attrname": case "afterattr": return { ctx: "attr-name" };
        case "beforeval": case "uq": return { ctx: "attr-unquoted" };
        case "dq": case "sq": {
          const a = S.attr;
          if (/^on/.test(a)) return { ctx: "attr-handler" };
          if (a === "style") return { ctx: "attr-css" };
          if (a === "srcdoc") return { ctx: "attr-srcdoc" };
          if (URL_ATTRS.has(a) || (S.tag === "meta" && a === "content")) return { ctx: "attr-url", tag: S.tag, val: S.val };
          return { ctx: "attr-quoted" };
        }
        case "comment": return { ctx: "comment" };
        default: return { ctx: "markup-other" };
      }
    }
    return { feed, markUnknown, context };
  }

  /** @returns {{ok: boolean, ctx: string, reason?: string}} */
  function contextVerdict(info) {
    const ctx = info.ctx;
    if (ctx === "text" || ctx === "attr-quoted") return { ok: true, ctx };
    if (ctx === "attr-url" && !URL_UNSAFE_TAGS.has(info.tag) &&
        (/^\/[^\/\\\s&]/.test(info.val) || /^[#?]/.test(info.val))) {
      return { ok: true, ctx };
    }
    return { ok: false, ctx, reason: "سياق " + ctx + ": " + (CTX_REASONS[ctx] || "غير مدعوم") };
  }

  /** عناصر سلسلة + بالترتيب (بدون الدخول في القوالب). */
  function plusOperands(n, out) {
    if (n.type === "BinaryExpression" && n.operator === "+") {
      plusOperands(n.left, out);
      plusOperands(n.right, out);
    } else {
      out.push(n);
    }
    return out;
  }

  /**
   * يحلّل قيمة تُمرَّر إلى HTML sink. rhs: عقدة واحدة، أو مصفوفة وسائط تُدمَج بالترتيب (document.write).
   * @returns {{mode: "none"|"text"|"escape"|"complex", wrap?: Array, trusted?: Array, reason?: string, ctx?: string}}
   *   trusted: عناصر تُبنى كـHTML (لا تُعقَّم ولا تُحوَّل لـtextContent) — تُسجَّل في unresolved.
   *   mode "escape" لا يُرجَع إلا إذا كان كل موضع ديناميكي في سياق يكفيه الـescape (contextVerdict).
   */
  function planValue(code, rhs, allowText, env) {
    const operands = [];
    for (const g of (Array.isArray(rhs) ? rhs : [rhs])) {
      const ops = plusOperands(g, []);
      // x + y + "…" : الجمع الرقمي يسبق أول نصّ، فتغليف كل عنصر بـ__escapeHTML
      // يحوّل 1+2+"x" من "3x" إلى "12x". نشترط أن يكون أحد أول عنصرين نصًّا.
      if (ops.length >= 2) {
        const stringy = o => isStringLit(o) || o.type === "TemplateLiteral";
        if (!stringy(ops[0]) && !stringy(ops[1])) {
          return { mode: "complex", reason: "سلسلة + قد تكون جمعًا رقميًا (لا عنصر نصّي في أول عنصرين)" };
        }
      }
      operands.push.apply(operands, ops);
    }

    const dyn = [];       // مصدره غير معروف ⇒ يُعامل كنص
    const trusted = [];   // يُبنى كـHTML ⇒ لا يُلمس
    const parts = [];     // الترتيب الفعلي للمقاطع: s=ثابت، d=ديناميكي، o=آمن مجهول المحتوى، x=HTML مبني
    let markup = false;
    let complexReason = null;

    function leaf(n) {
      if (isStringLit(n)) { if (hasMarkupChars(n.value)) markup = true; parts.push({ k: "s", t: n.value }); return; }
      if (isStaticLit(n)) { parts.push({ k: "s", t: String(n.value) }); return; }
      if (isSafeCall(code, n) || isLengthMember(n)) { parts.push({ k: "o" }); return; }
      const k = env.originKind(n);
      if (k === "safe") { parts.push({ k: "o" }); return; }          // رقم / نصّ ثابت / مُعقَّم مسبقًا
      if (k === "html") { trusted.push(n); parts.push({ k: "x" }); return; }  // بُني كـHTML
      if (!isSimpleData(n)) {
        complexReason = complexReason ||
          "قيمة ناتجة عن استدعاء/تعبير معقّد — لا يُعرف إن كانت HTML موثوقة أم بيانات";
        return;
      }
      dyn.push(n);
      parts.push({ k: "d", n });
    }

    for (const o of operands) {
      if (o.type === "TemplateLiteral") {
        for (let i = 0; i < o.quasis.length; i++) {
          const q = o.quasis[i].value.cooked || o.quasis[i].value.raw || "";
          if (hasMarkupChars(q)) markup = true;
          parts.push({ k: "s", t: q });
          if (i < o.expressions.length) leaf(o.expressions[i]);
        }
      } else {
        leaf(o);
      }
    }

    if (complexReason) return { mode: "complex", reason: complexReason };
    if (dyn.length === 0 && trusted.length === 0) return { mode: "none" };

    // وجود جزء HTML مبني يعني أن القيمة HTML: لا textContent أبدًا (يكسر العرض)
    if (trusted.length) markup = true;
    if (dyn.length === 0) return { mode: "none", trusted };

    if (allowText && !markup) return { mode: "text" };

    // mode "escape": كل موضع ديناميكي يجب أن يقع في سياق يكفيه الـescape، وإلا تُترك القيمة كلها
    const sc = makeHtmlScanner();
    for (const p of parts) {
      if (p.k === "s") sc.feed(p.t);
      else if (p.k === "o") sc.feed("0");
      else if (p.k === "x") sc.markUnknown();
      else {
        const v = contextVerdict(sc.context());
        if (!v.ok) return { mode: "complex", ctx: v.ctx, ctxUnsupported: true, reason: v.reason, trusted };
        sc.feed("x");
      }
    }
    return { mode: "escape", wrap: dyn, trusted };
  }

  function propNameOf(member) {
    if (!member.computed && member.property.type === "Identifier") return member.property.name;
    if (member.computed && isStringLit(member.property)) return member.property.value;
    return null;
  }

  // ═════════════════════════════════════════════════════
  // JS — جمع المواقع (sites) والتعديلات
  // ═════════════════════════════════════════════════════

  function collectSites(ast, code, opts) {
    const sites = [];
    const unresolved = [];
    const allowTextBase = opts.bareHtml !== "escape";
    const env = buildEnv(ast, code);
    let seq = 0;

    const edit = (start, end, text) => ({ start, end, text, seq: seq++ });
    const wrapEdit = n => edit(n.start, n.end, HELPER + "(" + code.slice(n.start, n.end) + ")");
    const wrappedList = plan => (plan.wrap || []).map(n => snippet(code, n, 40));

    function note(kind, node, reason) {
      unresolved.push({ kind, line: node.loc.start.line, snippet: snippet(code, node, 100), reason });
    }

    // متغيّر يُبنى كـHTML: لا نعقّمه (يعرض الوسوم نصًّا) ولا نحوّله لـtextContent.
    function noteTrusted(node, plan) {
      if (!plan.trusted || !plan.trusted.length) return;
      note("HTML_SINK_TRUSTED_VAR", node,
        "القيمة (" + plan.trusted.map(n => snippet(code, n, 30)).join("، ") +
        ") تُبنى كـHTML في مكان آخر — لم تُعقَّم كي لا يتكسّر العرض؛ افحص موضع بنائها");
    }

    function renameProp(member, newName) {
      const p = member.property;
      if (!member.computed) return edit(p.start, p.end, newName);
      const q = code.charAt(p.start);
      return edit(p.start, p.end, q + newName + q);
    }

    function handleAssign(node, parent) {
      const L = node.left;
      if (L.type !== "MemberExpression") return;
      const prop = propNameOf(L);
      if (prop !== "innerHTML" && prop !== "outerHTML") return;
      if (node.operator !== "=" && node.operator !== "+=") return;

      const isInner = prop === "innerHTML";
      const plan = planValue(code, node.right, isInner && allowTextBase, env);
      noteTrusted(node, plan);
      if (plan.mode === "none") return;
      if (plan.mode === "complex") { note("HTML_SINK_COMPLEX", node, plan.reason); return; }

      const info = { line: node.loc.start.line, before: snippet(code, node, 120) };

      if (node.operator === "=") {
        if (plan.mode === "text") {
          sites.push({ edits: [renameProp(L, "textContent")], info: Object.assign(info, {
            kind: "innerHTML=", action: "innerHTML → textContent" }) });
        } else {
          sites.push({ usesHelper: true, edits: plan.wrap.map(wrapEdit), info: Object.assign(info, {
            kind: prop + "=", action: "تعقيم المقاطع الديناميكية بـ" + HELPER,
            wrapped: wrappedList(plan) }) });
        }
        return;
      }

      // +=  (innerHTML فقط)
      if (!isInner) { note("HTML_SINK_COMPLEX", node, "outerHTML += غير مدعوم تلقائيًا"); return; }
      // قيمة التعبير نفسها مستخدمة (y = (el.innerHTML += x)) ⇒ لا نغيّر نوع القيمة المُعادة
      if (!parent || parent.type !== "ExpressionStatement") {
        note("HTML_SINK_COMPLEX", node, "innerHTML += مستخدمة كقيمة تعبير (ليست عبارة مستقلة)");
        return;
      }
      const opIdx = code.indexOf("+=", L.end);
      if (opIdx < 0 || opIdx >= node.right.start) return;
      const method = plan.mode === "text" ? "insertAdjacentText" : "insertAdjacentHTML";
      // نستهلك المسافات بعد += كي لا تتضاعف بعد الفاصلة
      let opEnd = opIdx + 2;
      while (opEnd < node.right.start && /[ \t]/.test(code.charAt(opEnd))) opEnd++;
      const edits = [
        edit(L.object.end, opEnd, "." + method + "('beforeend', "),
        edit(node.end, node.end, ")")
      ];
      if (plan.mode === "escape") plan.wrap.forEach(n => edits.push(wrapEdit(n)));
      sites.push({ usesHelper: plan.mode === "escape", edits, info: Object.assign(info, {
        kind: "innerHTML+=",
        action: "innerHTML += → " + method + "('beforeend', …)",
        wrapped: wrappedList(plan) }) });
    }

    function handleCall(node) {
      const c = node.callee;
      const args = node.arguments;

      if (c.type === "Identifier") {
        if (c.name === "eval" && args.length && !isStaticLit(args[0])) {
          note("EVAL", node, "eval(x): لا بديل آمن عام (JSON.parse؟ lookup؟) — يحتاج قرار بشري");
        } else if (c.name === "Function" && args.some(a => !isStaticLit(a))) {
          note("NEW_FUNCTION", node, "Function(x): توليد كود ديناميكي");
        } else if ((c.name === "setTimeout" || c.name === "setInterval") && args.length &&
                   (args[0].type === "BinaryExpression" || args[0].type === "TemplateLiteral") &&
                   planValue(code, args[0], false, env).mode !== "none") {
          note("STRING_TIMER", node, c.name + " بنصّ ديناميكي يُنفَّذ كـeval");
        }
        return;
      }

      if (c.type !== "MemberExpression") return;
      const name = propNameOf(c);

      if (name === "insertAdjacentHTML" && args.length >= 2) {
        const plan = planValue(code, args[1], allowTextBase, env);
        noteTrusted(node, plan);
        if (plan.mode === "none") return;
        const info = { line: node.loc.start.line, before: snippet(code, node, 120) };
        if (plan.mode === "complex") { note("HTML_SINK_COMPLEX", node, plan.reason); return; }
        if (plan.mode === "text") {
          sites.push({ edits: [renameProp(c, "insertAdjacentText")], info: Object.assign(info, {
            kind: "insertAdjacentHTML", action: "insertAdjacentHTML → insertAdjacentText" }) });
        } else {
          sites.push({ usesHelper: true, edits: plan.wrap.map(wrapEdit), info: Object.assign(info, {
            kind: "insertAdjacentHTML", action: "تعقيم المقاطع الديناميكية بـ" + HELPER,
            wrapped: wrappedList(plan) }) });
        }
        return;
      }

      if ((name === "write" || name === "writeln") &&
          c.object.type === "Identifier" && c.object.name === "document") {
        const edits = [];
        if (args.length) {
          // الوسائط تُحلَّل معًا: document.write('<a href="', u, '">') سياقها متصل
          const plan = planValue(code, args, false, env);
          noteTrusted(node, plan);
          if (plan.mode === "complex") { note("HTML_SINK_COMPLEX", node, plan.reason); return; }
          if (plan.mode === "escape") plan.wrap.forEach(n => edits.push(wrapEdit(n)));
        }
        if (edits.length) {
          sites.push({ usesHelper: true, edits, info: {
            line: node.loc.start.line, before: snippet(code, node, 120),
            kind: "document.write", action: "تعقيم المقاطع الديناميكية بـ" + HELPER } });
        }
        return;
      }

      // jQuery .html("<b>" + x + "</b>") — حالة markup+ديناميكي فقط، لأن .html(x) المجرّدة
      // قد تكون دالة غير DOM (res.html(x)، markdown.html(x)…) فلا نخمّن.
      if (name === "html" && args.length === 1 &&
          (args[0].type === "BinaryExpression" || args[0].type === "TemplateLiteral")) {
        const plan = planValue(code, args[0], false, env);
        if (plan.mode === "complex" && plan.ctxUnsupported) { note("HTML_SINK_COMPLEX", node, plan.reason); return; }
        if (plan.mode === "escape") {
          const hasLitMarkup = plusOperands(args[0], []).some(o =>
            (isStringLit(o) && hasMarkupChars(o.value)) ||
            (o.type === "TemplateLiteral" && o.quasis.some(q => hasMarkupChars(q.value.cooked || ""))));
          if (hasLitMarkup) {
            sites.push({ usesHelper: true, edits: plan.wrap.map(wrapEdit), info: {
              line: node.loc.start.line, before: snippet(code, node, 120),
              kind: ".html()", action: "تعقيم المقاطع الديناميكية بـ" + HELPER } });
          }
        }
      }
    }

    walk(ast, (node, parent) => {
      switch (node.type) {
        case "AssignmentExpression": handleAssign(node, parent); break;
        case "CallExpression":       handleCall(node); break;
        case "NewExpression":
          if (node.callee.type === "Identifier" && node.callee.name === "Function" &&
              node.arguments.some(a => !isStaticLit(a))) {
            note("NEW_FUNCTION", node, "new Function(x): توليد كود ديناميكي");
          }
          break;
        case "Property":
          if (node.key && ((node.key.type === "Identifier" && node.key.name === "dangerouslySetInnerHTML") ||
                           (isStringLit(node.key) && node.key.value === "dangerouslySetInnerHTML"))) {
            note("REACT_DANGEROUS_HTML", node, "dangerouslySetInnerHTML: يحتاج DOMPurify أو إزالته");
          }
          break;
        default: break;
      }
    });

    return { sites, unresolved };
  }

  function overlaps(a, b) { return a.start < b.end && b.start < a.end; }

  /** يختار المواقع غير المتداخلة؛ موقع يتداخل مع مختار يُؤجَّل للتمريرة التالية كاملًا. */
  function selectSites(sites) {
    const kept = [];
    const keptEdits = [];
    for (const s of sites) {
      const clash = s.edits.some(e => keptEdits.some(k => overlaps(e, k)));
      if (clash) continue;
      kept.push(s);
      s.edits.forEach(e => keptEdits.push(e));
    }
    return kept;
  }

  function applyEdits(code, edits) {
    const sorted = edits.slice().sort((a, b) => a.start - b.start || a.end - b.end || a.seq - b.seq);
    let out = "";
    let pos = 0;
    for (const e of sorted) {
      out += code.slice(pos, e.start) + e.text;
      pos = e.end;
    }
    return out + code.slice(pos);
  }

  function helperInsertion(ast, code) {
    let pos = 0;
    if (code.startsWith("#!")) {
      const nl = code.indexOf("\n");
      pos = nl < 0 ? code.length : nl + 1;
    }
    for (const stmt of ast.body) {
      if (stmt.type === "ExpressionStatement" && typeof stmt.directive === "string") pos = stmt.end;
      else break;
    }
    const text = pos > 0 && code.charAt(pos - 1) !== "\n"
      ? "\n" + HELPER_NOTE + "\n" + HELPER_DECL + "\n"
      : HELPER_NOTE + "\n" + HELPER_DECL + "\n";
    return { start: pos, end: pos, text, seq: -1 };
  }

  /**
   * يصلح مصدر JS واحدًا. يُرجِع دائمًا كودًا سليم التركيب (الأصلي عند أي شك).
   */
  function fixJSSource(code, ac, opts) {
    const report = [];
    let cur = code;
    let unresolved = [];

    for (let pass = 0; pass < 3; pass++) {
      const parsed = parseJS(ac, cur);
      if (!parsed.ast) {
        if (pass === 0) {
          return { fixed: code, edits: [], unresolved: [{
            kind: "PARSE_FAILED", line: 0, snippet: "", reason: parsed.error }] };
        }
        break; // ناتج التمريرة السابقة تحقّقنا منه، فلا يصل هنا فعليًا
      }

      const plan = collectSites(parsed.ast, cur, opts);
      unresolved = plan.unresolved;
      const chosen = selectSites(plan.sites);
      if (chosen.length === 0) break;

      const edits = [];
      chosen.forEach(s => s.edits.forEach(e => edits.push(e)));
      if (chosen.some(s => s.usesHelper) && !HELPER_DECLARED_RE.test(cur)) {
        edits.push(helperInsertion(parsed.ast, cur));
      }

      const next = applyEdits(cur, edits);

      // حارس نهائي: لا نُسلّم تعديلًا يكسر التركيب
      if (!parseJS(ac, next).ast) {
        return { fixed: code, edits: [], unresolved: unresolved.concat([{
          kind: "REWRITE_BROKE_SYNTAX", line: 0, snippet: "",
          reason: "ناتج التعديل لا يُحلَّل بـacorn — أُلغيت كل التعديلات" }]) };
      }

      chosen.forEach(s => report.push(s.info));
      cur = next;
    }

    return { fixed: cur, edits: report, unresolved };
  }

  // ═════════════════════════════════════════════════════
  // HTML — سكربتات inline فقط
  // ═════════════════════════════════════════════════════

  function fixHTML(code, ac, opts) {
    const re = /(<script\b([^>]*)>)([\s\S]*?)(<\/script\s*>)/gi;
    const edits = [];
    const unresolved = [];
    let out = "";
    let last = 0;
    let m;

    while ((m = re.exec(code)) !== null) {
      const attrs = m[2];
      if (/\bsrc\s*=/i.test(attrs)) continue;
      const typeM = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
      const type = typeM ? typeM[1].toLowerCase() : "";
      const isJS = !type || type === "module" ||
        /^(?:text|application)\/(?:x-)?(?:javascript|ecmascript)$/.test(type);
      if (!isJS) continue;

      const body = m[3];
      if (!body.trim()) continue;
      const bodyStart = m.index + m[1].length;
      const lineOffset = countNewlines(code.slice(0, bodyStart));

      const r = fixJSSource(body, ac, opts);
      r.edits.forEach(e => edits.push(Object.assign({}, e, { line: e.line + lineOffset })));
      r.unresolved.forEach(u => unresolved.push(Object.assign({}, u, { line: u.line ? u.line + lineOffset : lineOffset + 1 })));

      if (r.fixed !== body) {
        out += code.slice(last, bodyStart) + r.fixed;
        last = bodyStart + body.length;
      }
    }
    out += code.slice(last);
    return { fixed: out, edits, unresolved };
  }

  // ═════════════════════════════════════════════════════
  // PHP — ماسح حالة صغير (لا parser)
  // ═════════════════════════════════════════════════════

  const PHP_SAFE_FUNCS = new Set([
    "htmlspecialchars", "htmlentities", "esc_html", "esc_attr", "esc_url",
    "intval", "floatval", "count", "strlen", "round", "abs", "number_format",
    "urlencode", "rawurlencode"
  ]);
  const PHP_VAR_RE = /^\$[A-Za-z_]\w*(?:\[[^\[\]]*\]|->[A-Za-z_]\w*)*$/;
  const PHP_HTMLISH_VAR_RE = /html|markup|rendered|\btpl\b|template/i;

  /** يتخطى string أو يُرجِع -1 إن لم تُغلق. i عند علامة الفتح. */
  function skipPhpString(code, i) {
    const q = code.charAt(i);
    for (let j = i + 1; j < code.length; j++) {
      const ch = code.charAt(j);
      if (ch === "\\") { j++; continue; }
      if (ch === q) return j + 1;
    }
    return -1;
  }

  /**
   * يجد مواقع echo / print / <?= في أكواد PHP، متجاهلًا الـstrings والتعليقات.
   * heredoc/nowdoc ⇒ يتوقف الماسح ويُسجَّل (لا نخمّن حدوده).
   */
  function findPhpSites(code) {
    const sites = [];
    const notes = [];
    const islands = [];    // [{start,end}] — حدود كل <?…?> (لتحديد نصّ HTML الخارجي)
    const n = code.length;
    let i = 0;
    let inPhp = false;
    let islandStart = 0;   // بداية <? الحالية
    let regionStart = 0;   // أول موضع بعد <?php / <?

    while (i < n) {
      if (!inPhp) {
        const open = code.indexOf("<?", i);
        if (open < 0) break;
        islandStart = open;
        islands.push({ start: open, end: n });
        if (code.startsWith("<?=", open)) {
          sites.push({ kind: "short", argsStart: open + 3, islandStart: open, kwStart: open, adjacent: true });
          i = open + 3;
        } else if (code.startsWith("<?php", open)) {
          i = open + 5;
        } else {
          i = open + 2;
        }
        regionStart = i;
        inPhp = true;
        continue;
      }

      const ch = code.charAt(i);
      const two = code.substr(i, 2);

      if (two === "?>") { inPhp = false; i += 2; islands[islands.length - 1].end = i; continue; }
      if (ch === "'" || ch === '"') {
        const e = skipPhpString(code, i);
        if (e < 0) break;
        i = e;
        continue;
      }
      if (two === "/*") {
        const e = code.indexOf("*/", i + 2);
        if (e < 0) break;
        i = e + 2;
        continue;
      }
      if (two === "//" || ch === "#") {
        // التعليق ينتهي عند آخر السطر أو عند ?>
        let j = i;
        while (j < n && code.charAt(j) !== "\n" && !(code.charAt(j) === "?" && code.charAt(j + 1) === ">")) j++;
        i = j;
        continue;
      }
      if (code.startsWith("<<<", i)) {
        notes.push({ kind: "PHP_HEREDOC", line: lineAt(code, i), snippet: "",
          reason: "heredoc/nowdoc: توقف الفحص عند هذه النقطة" });
        break;
      }
      if (/[A-Za-z_]/.test(ch) && !/[\w$]/.test(code.charAt(i - 1) || "")) {
        const kw = /^(echo|print)\b/.exec(code.slice(i, i + 6));
        if (kw) {
          // بداية عبارة فقط: قبلها ; { } ) : أو بداية منطقة PHP
          // (print قد تُستخدم كتعبير، وecho بعد -> أو :: ليست كلمة مفتاحية)
          let k = i - 1;
          while (k >= regionStart && /\s/.test(code.charAt(k))) k--;
          const prev = k >= regionStart ? code.charAt(k) : "";
          // else / do تأخذ عبارة بلا { }: "else echo $y;"
          const wordM = /[A-Za-z_]+$/.exec(code.slice(regionStart, k + 1));
          const okStart = k < regionStart || prev === ";" || prev === "{" || prev === "}" ||
            prev === ")" || prev === ":" ||
            (wordM !== null && (wordM[0] === "else" || wordM[0] === "do"));
          const afterKw = code.charAt(i + kw[1].length);
          if (okStart && /[\s$'"(]/.test(afterKw)) {
            let a = i + kw[1].length;
            while (a < n && /\s/.test(code.charAt(a))) a++;
            sites.push({ kind: kw[1], argsStart: a, islandStart, kwStart: i, adjacent: k < regionStart });
          }
          i += kw[1].length;
          continue;
        }
        // تخطّي المعرّف كاملًا (يمنع مطابقة "echo" داخل اسم أطول)
        let j = i + 1;
        while (j < n && /[\w]/.test(code.charAt(j))) j++;
        i = j;
        continue;
      }
      i++;
    }
    return { sites, notes, islands };
  }

  /**
   * يقطّع وسائط echo إلى مقاطع عند . و , في المستوى الأعلى.
   * @returns {{parts: Array<{start,end}>, end: number}|null}
   */
  function parseEchoArgs(code, start) {
    const n = code.length;
    const limit = Math.min(n, start + 4000);
    const parts = [];
    let depth = 0;
    let partStart = start;
    let i = start;

    const pushPart = end => parts.push({ start: partStart, end });

    while (i < limit) {
      const ch = code.charAt(i);
      if (ch === "'" || ch === '"') {
        const e = skipPhpString(code, i);
        if (e < 0) return null;
        i = e;
        continue;
      }
      if (code.startsWith("<<<", i)) return null;
      if (code.startsWith("/*", i) || code.startsWith("//", i) || ch === "#") return null;
      if (depth === 0 && code.startsWith("?>", i)) { pushPart(i); return { parts, end: i }; }
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") { depth--; if (depth < 0) return null; }
      else if (depth === 0 && ch === ";") { pushPart(i); return { parts, end: i }; }
      else if (depth === 0 && ch === ",") { pushPart(i); partStart = i + 1; }
      else if (depth === 0 && ch === ".") {
        const prevDigit = /\d/.test(code.charAt(i - 1));
        const nextDigit = /\d/.test(code.charAt(i + 1));
        if (code.charAt(i + 1) === ".") return null;
        if (!(prevDigit && nextDigit)) { pushPart(i); partStart = i + 1; }
      }
      i++;
    }
    return null;
  }

  function trimmedRange(code, p) {
    let s = p.start, e = p.end;
    while (s < e && /\s/.test(code.charAt(s))) s++;
    while (e > s && /\s/.test(code.charAt(e - 1))) e--;
    return { start: s, end: e, text: code.slice(s, e) };
  }

  /** هل t استدعاء واحد كامل name(...)؟ */
  function singleCallName(t) {
    const m = /^\\?([A-Za-z_]\w*)\s*\(/.exec(t);
    if (!m) return null;
    let depth = 0;
    for (let i = m[0].length - 1; i < t.length; i++) {
      const ch = t.charAt(i);
      if (ch === "'" || ch === '"') {
        const e = skipPhpString(t, i);
        if (e < 0) return null;
        i = e - 1;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") { depth--; if (depth === 0) return i === t.length - 1 ? m[1] : null; }
    }
    return null;
  }

  function classifyPhpPart(t) {
    if (t === "") return "complex";
    if (/^'(?:[^'\\]|\\.)*'$/.test(t)) return "static";
    if (/^"(?:[^"\\$]|\\.)*"$/.test(t)) return "static";
    if (/^-?\d+(?:\.\d+)?$/.test(t)) return "static";
    if (t === "PHP_EOL") return "static";
    if (/^\(\s*(?:int|integer|float|double|bool|boolean)\s*\)\s*\S+$/.test(t)) return "safe";
    const fn = singleCallName(t);
    if (fn && PHP_SAFE_FUNCS.has(fn.toLowerCase())) return "safe";
    if (PHP_VAR_RE.test(t)) {
      return PHP_HTMLISH_VAR_RE.test(t) ? "htmlish" : "var";
    }
    return "complex";
  }

  /** النص الذي يطبعه مقطع PHP ثابت (بين اقتباسين) — فكّ الهروب الشائع فقط. */
  function phpStaticText(t) {
    if (!/^['"]/.test(t)) return t;       // رقم / PHP_EOL
    const q = t.charAt(0);
    return t.slice(1, -1).replace(/\\(.)/g, (m, c) => {
      if (c === "\\" || c === q) return c;
      if (q === '"') { if (c === "n") return "\n"; if (c === "t") return "\t"; if (c === "r") return "\r"; if (c === "$") return "$"; }
      return m;
    });
  }

  function strContent(t) {
    return /^['"]/.test(t) ? t.slice(1, -1) : "";
  }

  function fixPHP(code) {
    const { sites, notes, islands } = findPhpSites(code);
    const unresolved = notes.slice();
    const reports = [];
    const edits = [];
    let seq = 0;

    // HTML خارج الجزر بالترتيب، يُغذّى به المصنّف قبل كل موقع: السياق عند نقطة الإخراج
    // يُحسب من كامل النص المتراكم (HTML خارجي + ما طبعته عبارات echo السابقة + الثوابت داخل العبارة)
    const outside = [];
    let prevEnd = 0;
    for (const isl of islands) { outside.push({ start: prevEnd, end: isl.start }); prevEnd = isl.end; }
    outside.push({ start: prevEnd, end: code.length });
    let segIdx = 0;
    const sc = makeHtmlScanner();

    for (const s of sites) {
      while (segIdx < outside.length && outside[segIdx].end <= s.kwStart) {
        const seg = outside[segIdx++];
        if (seg.end > seg.start) sc.feed(code.slice(seg.start, seg.end));
      }
      const line = lineAt(code, s.kwStart);
      const parsed = parseEchoArgs(code, s.argsStart);
      const mk = (kind, reason) => unresolved.push({
        kind, line, reason, snippet: code.slice(s.kwStart, Math.min(code.length, s.kwStart + 100)).replace(/\s+/g, " ") });
      if (!parsed) { mk("PHP_ECHO_UNPARSEABLE", "تعذّر تقطيع وسائط echo بأمان"); sc.markUnknown(); continue; }

      const wraps = [];
      let bad = null;

      for (let idx = 0; idx < parsed.parts.length; idx++) {
        const r = trimmedRange(code, parsed.parts[idx]);
        const cls = classifyPhpPart(r.text);
        if (cls === "static") { sc.feed(phpStaticText(r.text)); continue; }
        if (cls === "safe")   { sc.feed("0"); continue; }
        if (cls === "var") {
          const v = contextVerdict(sc.context());
          if (!v.ok) {
            if (!bad) bad = { kind: "PHP_UNSAFE_CONTEXT", reason: v.reason + " — htmlspecialchars وحده لا يكفي" };
            sc.markUnknown();      // ناتج هذا المقطع (غير المعقَّم) قد يغيّر السياق
          } else {
            wraps.push(r);
            sc.feed("x");
          }
          continue;
        }
        if (!bad) {
          bad = cls === "htmlish"
            ? { kind: "PHP_POSSIBLY_HTML_VAR", reason: "اسم المتغيّر يوحي بـHTML جاهز — التعقيم سيعرضه نصًّا؛ يحتاج قرارًا" }
            : { kind: "PHP_COMPLEX_EXPR", reason: "مقطع غير مدعوم (استدعاء مجهول / interpolation / عملية) — العبارة كلها تُترك" };
        }
        sc.markUnknown();
      }

      if (bad) { mk(bad.kind, bad.reason); continue; }
      if (!wraps.length) continue;

      const siteEdits = wraps.map(r => ({
        start: r.start, end: r.end, seq: seq++,
        text: "htmlspecialchars((string)" + r.text + ", ENT_QUOTES, 'UTF-8')"
      }));
      siteEdits.forEach(e => edits.push(e));
      reports.push({
        line, kind: "php-" + s.kind,
        before: code.slice(s.kwStart, parsed.end).replace(/\s+/g, " ").slice(0, 120),
        action: "htmlspecialchars(…, ENT_QUOTES, 'UTF-8') على " + wraps.length + " مقطع"
      });
    }

    return { fixed: edits.length ? applyEdits(code, edits) : code, edits: reports, unresolved };
  }

  // ═════════════════════════════════════════════════════
  // الواجهة العامة
  // ═════════════════════════════════════════════════════

  function detectKind(code, fileName) {
    const ext = String(fileName || "").split(".").pop().toLowerCase();
    if (/^(?:php|phtml|php[3-8])$/.test(ext)) return "php";
    if (ext === "html" || ext === "htm" || ext === "xhtml") return "html";
    if (ext === "js" || ext === "mjs" || ext === "cjs") return "js";
    if (ext === "jsx" || ext === "ts" || ext === "tsx") return "unsupported";
    // لغات/صيغ معروفة ليست من اختصاص هذا الـfixer: لا نخمّن أنها JS من محتواها
    if (/^(?:py|java|kt|kts|go|rb|c|h|cc|cpp|hpp|cs|dart|swift|rs|sh|sql|json|md|txt|css|xml|ya?ml|csv)$/.test(ext)) return "skip";
    if (/^\s*<\?php/.test(code)) return "php";
    if (/<\s*(?:!doctype|html|body|script)\b/i.test(code)) return "html";
    return "js";
  }

  function canFix(issues) {
    if (!Array.isArray(issues)) return false;
    return issues.some(i => {
      if (i == null) return false;
      if (typeof i === "string") return XSS_RE.test(i);
      return [i.title, i.name, i.ruleId, i.rule, i.id, i.type, i.message, i.category, i.cAct]
        .some(v => typeof v === "string" && XSS_RE.test(v));
    });
  }

  function fix(code, fileName, opts) {
    const original = code;
    try {
      opts = opts || {};
      if (typeof code !== "string" || code === "") {
        return { fixed: code, changed: false, edits: [], unresolved: [] };
      }

      const kind = detectKind(code, fileName);
      let r;

      if (kind === "skip") {
        r = { fixed: code, edits: [], unresolved: [] };
      } else if (kind === "php") {
        r = fixPHP(code);
      } else if (kind === "unsupported") {
        r = { fixed: code, edits: [], unresolved: [{
          kind: "PARSE_FAILED", line: 0, snippet: "",
          reason: "JSX/TS غير مدعومة (acorn لا يفهمها) — لا تعديل" }] };
      } else {
        const ac = getAcorn();
        if (!ac) {
          r = { fixed: code, edits: [], unresolved: [{
            kind: "NO_PARSER", line: 0, snippet: "", reason: "acorn غير متاح — لا نصلح JS بالـregex" }] };
        } else {
          r = kind === "html" ? fixHTML(code, ac, opts) : fixJSSource(code, ac, opts);
        }
      }

      const changed = r.fixed !== code;
      const out = { fixed: r.fixed, changed, edits: r.edits, unresolved: r.unresolved };
      if (changed) out.reason = "XSSFixer v2: " + r.edits.length + " موضع";
      else if (r.unresolved.length) out.reason = "لا إصلاح آمن؛ " + r.unresolved.length + " موضع يحتاج مراجعة";
      return out;
    } catch (e) {
      return { fixed: original, changed: false, edits: [], unresolved: [{
        kind: "FIXER_ERROR", line: 0, snippet: "", reason: String(e && e.message || e) }] };
    }
  }

  return { fix, canFix, version: "2.0" };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = XSSFixer;
}
