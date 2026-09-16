// ═══════════════════════════════════════════════════════
// command_injection_fix.js v2.0
// Conservative, deterministic Command Injection fixer.
//
// Design principles (see audit notes in accompanying report):
//   - Detection (evidence gathering) is fully separate from repair.
//   - A fix is only ever applied automatically when it can be shown
//     to be structurally safe (no shell involvement, no external input).
//     NOTE: auto-fixes may change observable behavior in edge cases
//     (e.g. subprocess.run does NOT raise on non-zero exit by default,
//     unlike os.system which never raises — callers must review).
//     Anything ambiguous is returned as AI_REQUIRED — never guessed.
//   - No naive whole-file regex replace: every candidate is located
//     on a comment/string-masked copy of the source (so we never
//     "fix" text that lives inside a comment or a string literal),
//     then the real call expression is re-extracted from the
//     ORIGINAL source using paren/quote-aware scanning, so nested
//     calls and multiline statements are handled correctly.
//   - Replacements are applied back-to-front by character offset,
//     so earlier offsets never shift under later edits.
// ═══════════════════════════════════════════════════════
"use strict";

var CommandInjectionFixer = (() => {

  const SUPPORTED_EXT = { py: "python", php: "php", java: "java" };

  // ─────────────────────────────────────────────────────
  // Input validation
  // ─────────────────────────────────────────────────────
  function validate(code, fileName) {
    if (typeof code !== "string") {
      return "invalid_code: 'code' must be a string";
    }
    if (typeof fileName !== "string" || fileName.trim() === "") {
      return "invalid_fileName: 'fileName' must be a non-empty string";
    }
    const parts = fileName.split(".");
    if (parts.length < 2) {
      return `invalid_fileName: '${fileName}' has no extension`;
    }
    const ext = parts.pop().toLowerCase();
    if (!SUPPORTED_EXT[ext]) {
      return `unsupported_language: '.${ext}' is not handled by this fixer`;
    }
    return null; // valid
  }

  // ─────────────────────────────────────────────────────
  // Generic paren/quote-aware scanner utilities
  // ─────────────────────────────────────────────────────

  // Returns the index just after the matching close-paren for the
  // open-paren at `openIdx`, respecting nested parens and string
  // literals (single/double quoted, with backslash escapes) so we
  // never stop early on a ')' that lives inside a string argument.
  function findMatchingParenEnd(src, openIdx) {
    let depth = 0;
    let inStr = null; // active quote char, or null
    for (let i = openIdx; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        if (c === "\\") { i++; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return -1; // unbalanced — caller must treat as "cannot safely parse"
  }

  // Masks comments and string CONTENTS with a filler character while
  // preserving overall string length (so offsets found on the masked
  // copy line up exactly with the original source). Used only to
  // decide WHERE it is safe to look for a pattern — the real argument
  // text is always re-read from the original source afterwards.
  function maskSource(code, lang) {
    const out = code.split("");
    const n = out.length;
    let i = 0;
    const isPy = lang === "python";
    const isPhp = lang === "php";
    const isJava = lang === "java";

    function blank(from, to) {
      for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = "z";
    }

    while (i < n) {
      const c = code[i];

      // Python triple-quoted strings / docstrings
      if (isPy && (code.startsWith('"""', i) || code.startsWith("'''", i))) {
        const q = code.substr(i, 3);
        const end = code.indexOf(q, i + 3);
        const stop = end === -1 ? n : end + 3;
        blank(i, stop);
        i = stop;
        continue;
      }
      // Line comments: Python '#', PHP '#' or '//', Java '//'
      if ((isPy || isPhp) && c === "#") {
        const end = code.indexOf("\n", i);
        const stop = end === -1 ? n : end;
        blank(i, stop);
        i = stop;
        continue;
      }
      if ((isPhp || isJava) && c === "/" && code[i + 1] === "/") {
        const end = code.indexOf("\n", i);
        const stop = end === -1 ? n : end;
        blank(i, stop);
        i = stop;
        continue;
      }
      // Block comments: PHP + Java '/* ... */'
      if ((isPhp || isJava) && c === "/" && code[i + 1] === "*") {
        const end = code.indexOf("*/", i + 2);
        const stop = end === -1 ? n : end + 2;
        blank(i, stop);
        i = stop;
        continue;
      }
      // Single/double-quoted strings (all three languages)
      if (c === '"' || c === "'") {
        const quote = c;
        let j = i + 1;
        while (j < n) {
          if (code[j] === "\\") { j += 2; continue; }
          if (code[j] === quote) { j++; break; }
          if (code[j] === "\n" && !isPy) break; // unterminated on this line
          j++;
        }
        blank(i + 1, Math.min(j - 1, n));
        i = j;
        continue;
      }
      i++;
    }
    return out.join("");
  }

  function lineNumberAt(code, idx) {
    let line = 1;
    for (let i = 0; i < idx && i < code.length; i++) if (code[i] === "\n") line++;
    return line;
  }

  function snippetAt(code, idx, len) {
    const s = code.slice(idx, idx + len);
    return s.length > 120 ? s.slice(0, 117) + "..." : s;
  }

  // ─────────────────────────────────────────────────────
  // Argument classification helpers (language-agnostic-ish)
  // ─────────────────────────────────────────────────────

  // A "pure literal" argument is a single quoted string with no
  // concatenation, no interpolation markers, and no embedded
  // expression. If true, there is no external input flowing into the
  // command at all, so a mechanical rewrite cannot change behavior
  // in a way that depends on untrusted data.
  function isPureStringLiteral(arg, lang) {
    const a = arg.trim();
    if (lang === "python") {
      // reject f-strings / byte-strings-with-braces / percent-format
      if (/^[a-zA-Z]*f['"]/.test(a)) return false;
      if (/%\s*\(/.test(a) || /\.format\s*\(/.test(a)) return false;
      return /^['"]([^'"\\]|\\.)*['"]$/.test(a);
    }
    if (lang === "php") {
      if (a.startsWith('"') && /\$\{?\w/.test(a)) return false; // double-quoted interpolation
      return /^['"]([^'"\\]|\\.)*['"]$/.test(a);
    }
    if (lang === "java") {
      return /^"([^"\\]|\\.)*"$/.test(a);
    }
    return false;
  }

  // Deliberately broad blacklist. This is NOT a shell grammar, and it
  // is not meant to be one — it only needs to be conservative enough
  // that anything it lets through can be tokenized correctly by naive
  // whitespace splitting (see splitLiteralTokens / isNaivelyTokenizable
  // below). Quote characters and backslashes are included here because
  // a literal that uses shell quoting (e.g. "echo 'hello world'") is
  // NOT safely splittable by whitespace — the quotes themselves change
  // where argument boundaries fall, and naive splitting would silently
  // produce a different argv than the shell would have produced.
  function containsShellMetacharacters(literalValue) {
    return /['"\\|&;<>`$(){}*?~\n\t]/.test(literalValue);
  }

  function unquote(literal) {
    return literal.trim().slice(1, -1);
  }

  // Splits a whitespace-separated literal into argv tokens.
  //
  // This is only ever called after containsShellMetacharacters() has
  // confirmed the literal contains none of: quotes, backslashes, or
  // shell operators. Under that precondition, whitespace is the only
  // thing that can separate arguments, so naive splitting reproduces
  // exactly what a POSIX shell would have done with shell=True/os.system
  // for that same string. Without that precondition this function must
  // NOT be called — quoted segments such as "echo 'hello world'" contain
  // spaces that are NOT argument separators, and whitespace-splitting
  // them would silently change the resulting argv (this was reported
  // as a real behavior-preservation bug and is why the guard above was
  // widened rather than trying to write a shell tokenizer here).
  function splitLiteralTokens(value) {
    return value.trim().split(/\s+/).filter(Boolean);
  }

  // ─────────────────────────────────────────────────────
  // PYTHON
  // ─────────────────────────────────────────────────────
  const PY_CALL_RE = /\b(os\.system|subprocess\.call|subprocess\.Popen|subprocess\.run)\s*\(/g;

  function detectPython(code, masked) {
    const issues = [];
    let m;
    PY_CALL_RE.lastIndex = 0;
    while ((m = PY_CALL_RE.exec(masked)) !== null) {
      const callName = m[1];
      const openParen = m.index + m[0].length - 1;
      const end = findMatchingParenEnd(code, openParen);
      if (end === -1) {
        issues.push({
          type: "python_unparsable_call",
          language: "python",
          line: lineNumberAt(code, m.index),
          index: m.index,
          endIndex: code.length,
          snippet: snippetAt(code, m.index, 80),
          fixable: false,
          reason: "Could not find a balanced closing parenthesis for this call (possibly inside an unbalanced string); refusing to guess.",
        });
        continue;
      }
      const argsText = code.slice(openParen + 1, end - 1);
      // IMPORTANT: the shell=True check must run on the MASKED slice,
      // not the raw source. Otherwise text that merely contains the
      // substring "shell=True" inside a string literal or comment
      // argument (e.g. a log message, a docstring) would be
      // misdetected as the actual keyword argument.
      const maskedArgsText = masked.slice(openParen + 1, end - 1);
      const hasShellTrue = /\bshell\s*=\s*True\b/.test(maskedArgsText);

      if (callName === "os.system") {
        issues.push(classifyPythonOsSystem(code, m.index, end, argsText));
      } else if (callName === "subprocess.call" && hasShellTrue) {
        issues.push(classifyPythonShellTrue(code, m.index, end, argsText, "subprocess.call"));
      } else if (callName === "subprocess.Popen" && hasShellTrue) {
        issues.push(classifyPythonShellTrue(code, m.index, end, argsText, "subprocess.Popen"));
      } else if (callName === "subprocess.run" && hasShellTrue) {
        // subprocess.run(..., shell=True) is the same risk shape.
        issues.push(classifyPythonShellTrue(code, m.index, end, argsText, "subprocess.run"));
      }
    }
    return issues.filter(Boolean);
  }

  function splitTopLevelArgs(argsText) {
    // Splits on top-level commas only (not inside nested parens/brackets/strings).
    const parts = [];
    let depth = 0, inStr = null, cur = "";
    for (let i = 0; i < argsText.length; i++) {
      const c = argsText[i];
      if (inStr) {
        cur += c;
        if (c === "\\") { i++; cur += argsText[i] || ""; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'") { inStr = c; cur += c; continue; }
      if (c === "(" || c === "[" || c === "{") depth++;
      if (c === ")" || c === "]" || c === "}") depth--;
      if (c === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
      cur += c;
    }
    if (cur.trim() !== "") parts.push(cur);
    return parts.map(s => s.trim());
  }

  function classifyPythonOsSystem(code, start, end, argsText) {
    const args = splitTopLevelArgs(argsText);
    const base = {
      type: "python_os_system",
      language: "python",
      line: lineNumberAt(code, start),
      index: start,
      endIndex: end,
      snippet: snippetAt(code, start, end - start),
    };
    if (args.length !== 1) {
      return { ...base, fixable: false, reason: "os.system called with an unexpected argument shape; not a single command-string argument." };
    }
    const arg = args[0];
    if (!isPureStringLiteral(arg, "python")) {
      return {
        ...base,
        fixable: false,
        reason: "Command argument is not a static string literal (it is built from a variable, f-string, concatenation, or formatting). Whether shlex.split() preserves the intended argument boundaries depends on runtime data this tool cannot see, so this requires human review.",
      };
    }
    const value = unquote(arg);
    if (containsShellMetacharacters(value)) {
      return {
        ...base,
        fixable: false,
        reason: "Literal command contains shell metacharacters (pipes/redirection/substitution). Removing the shell would silently change behavior, so this requires human review.",
      };
    }
    const tokens = splitLiteralTokens(value);
    if (tokens.length === 0) {
      return { ...base, fixable: false, reason: "Empty command literal." };
    }
    const pyList = "[" + tokens.map(t => JSON.stringify(t)).join(", ") + "]";
    return {
      ...base,
      fixable: true,
      // NOTE: os.system() returns the exit code and never raises.
      // subprocess.run() without check=True preserves that contract
      // (returncode is available on the returned CompletedProcess).
      // We deliberately omit check=True to avoid silently changing
      // behavior for callers that inspect the return value or rely
      // on the process completing even when it fails.
      replacement: `subprocess.run(${pyList})`,
      reason: "Argument is a fully static literal with no shell metacharacters; safe to replace with an explicit argv list (shell removed). NOTE: return type changes from int to CompletedProcess — review call sites.",
      requiresImport: "subprocess",
    };
  }

  function classifyPythonShellTrue(code, start, end, argsText, callName) {
    const args = splitTopLevelArgs(argsText);
    const base = {
      type: `python_${callName.replace(".", "_")}_shell_true`,
      language: "python",
      line: lineNumberAt(code, start),
      index: start,
      endIndex: end,
      snippet: snippetAt(code, start, end - start),
    };
    if (args.length === 0) {
      return { ...base, fixable: false, reason: "No command argument found." };
    }
    const cmdArg = args[0];
    if (!isPureStringLiteral(cmdArg, "python")) {
      return {
        ...base,
        fixable: false,
        reason: `${callName}'s command argument is not a static string literal. Converting shell=True to a list/shell=False without knowing the true argument boundaries can either fail to fix the vulnerability (arg-injection) or break the call outright, so this requires human review.`,
      };
    }
    const value = unquote(cmdArg);
    if (containsShellMetacharacters(value)) {
      return {
        ...base,
        fixable: false,
        reason: "Literal command relies on shell features (pipes/redirection/substitution) that would stop working under shell=False. Requires a human to redesign the call (e.g. split into a pipeline).",
      };
    }
    const tokens = splitLiteralTokens(value);
    const pyList = "[" + tokens.map(t => JSON.stringify(t)).join(", ") + "]";
    const restArgs = args.slice(1).filter(a => !/^\s*shell\s*=\s*True\s*$/.test(a));
    const restText = restArgs.length ? ", " + restArgs.join(", ") : "";
    const newCall = callName === "subprocess.call"
      ? `subprocess.call(${pyList}${restText})`
      : callName === "subprocess.run"
        ? `subprocess.run(${pyList}${restText})`
        : `subprocess.Popen(${pyList}${restText})`;
    return {
      ...base,
      fixable: true,
      replacement: newCall,
      reason: "Command is a fully static literal with no shell metacharacters; shell keyword arg removed. NOTE: shell=True/False can affect quoting and error propagation — review the call site to confirm the new form is acceptable.",
      requiresImport: "subprocess",
    };
  }

  function fixPython(code) {
    const masked = maskSource(code, "python");
    const issues = detectPython(code, masked);
    const fixableIssues = issues.filter(i => i.fixable).sort((a, b) => b.index - a.index);
    let fixed = code;
    for (const issue of fixableIssues) {
      fixed = fixed.slice(0, issue.index) + issue.replacement + fixed.slice(issue.endIndex);
    }
    const needsSubprocessImport = fixableIssues.some(i => i.requiresImport === "subprocess");
    if (needsSubprocessImport && !/^\s*import\s+subprocess\b/m.test(fixed)) {
      fixed = "import subprocess\n" + fixed;
    }
    return { fixed, changed: fixed !== code, issues };
  }

  // ─────────────────────────────────────────────────────
  // PHP
  // ─────────────────────────────────────────────────────
  const PHP_CALL_RE = /\b(exec|system|passthru|shell_exec|proc_open)\s*\(/g;

  function detectPHP(code, masked) {
    const issues = [];
    let m;
    PHP_CALL_RE.lastIndex = 0;
    while ((m = PHP_CALL_RE.exec(masked)) !== null) {
      const fn = m[1];
      const openParen = m.index + m[0].length - 1;
      const end = findMatchingParenEnd(code, openParen);
      if (end === -1) {
        issues.push({
          type: "php_unparsable_call",
          language: "php",
          line: lineNumberAt(code, m.index),
          index: m.index,
          endIndex: code.length,
          snippet: snippetAt(code, m.index, 80),
          fixable: false,
          reason: "Could not find a balanced closing parenthesis for this call; refusing to guess.",
        });
        continue;
      }
      const argsText = code.slice(openParen + 1, end - 1);
      const involvesSuperglobal = /\$_(GET|POST|REQUEST|COOKIE|SERVER)\b/.test(argsText);
      if (!involvesSuperglobal) continue; // no evidence of external input reaching this sink

      issues.push(classifyPhpCall(code, m.index, end, fn, argsText));
    }
    return issues;
  }

  function classifyPhpCall(code, start, end, fn, argsText) {
    const args = splitTopLevelArgs(argsText);
    const base = {
      type: "php_command_injection",
      language: "php",
      line: lineNumberAt(code, start),
      index: start,
      endIndex: end,
      snippet: snippetAt(code, start, end - start),
    };
    if (args.length < 1) {
      return { ...base, fixable: false, reason: "No argument found." };
    }
    const first = args[0].trim();
    const isDirectSuperglobal = /^\$_(GET|POST|REQUEST|COOKIE|SERVER)\[[^\]]+\]$/.test(first);

    if (isDirectSuperglobal) {
      // The ENTIRE argument is exactly one superglobal access — the
      // function receives 100% externally-controlled input as the
      // whole command. Wrapping it does not make constructing a
      // command from raw user input safe; per policy this is NOT a
      // "safe deterministic fix" — the surrounding design (letting
      // a request parameter be executed as a command at all) needs
      // human review, so we deliberately do not auto-fix it and
      // do not claim escapeshellarg() makes this safe.
      return {
        ...base,
        fixable: false,
        reason: `${fn}() executes a request parameter (${first}) directly as the entire command. escapeshellarg() is not a complete fix for this pattern (it does not validate the command being run at all), and no deterministic safe rewrite exists without knowing the intended command. Requires human redesign (e.g. allow-list of fixed commands).`,
      };
    }

    // Anything else (concatenation, interpolation, mixed literal +
    // superglobal) is exactly the "complex case" the spec forbids
    // guessing on.
    return {
      ...base,
      fixable: false,
      reason: `${fn}() argument mixes literal text with request data (concatenation/interpolation). A regex-level rewrite cannot reliably determine where to insert escaping without risking broken syntax or incomplete coverage. Requires human review.`,
    };
  }

  function fixPHP(code) {
    const masked = maskSource(code, "php");
    const issues = detectPHP(code, masked);
    // No PHP case is auto-fixed by design (see classifyPhpCall) —
    // every sink that reaches a superglobal is flagged AI_REQUIRED
    // rather than patched with a partial mitigation presented as a
    // complete fix.
    return { fixed: code, changed: false, issues };
  }

  // ─────────────────────────────────────────────────────
  // JAVA
  // ─────────────────────────────────────────────────────
  const JAVA_CALL_RE = /\b(Runtime\.getRuntime\(\)\.exec|new\s+ProcessBuilder)\s*\(/g;

  function detectJava(code, masked) {
    const issues = [];
    let m;
    JAVA_CALL_RE.lastIndex = 0;
    while ((m = JAVA_CALL_RE.exec(masked)) !== null) {
      const kind = m[1].startsWith("Runtime") ? "Runtime.exec" : "ProcessBuilder";
      const openParen = m.index + m[0].length - 1;
      const end = findMatchingParenEnd(code, openParen);
      if (end === -1) {
        issues.push({
          type: "java_unparsable_call",
          language: "java",
          line: lineNumberAt(code, m.index),
          index: m.index,
          endIndex: code.length,
          snippet: snippetAt(code, m.index, 80),
          fixable: false,
          reason: "Could not find a balanced closing parenthesis for this call; refusing to guess.",
        });
        continue;
      }
      const argsText = code.slice(openParen + 1, end - 1);
      const args = splitTopLevelArgs(argsText);
      const base = {
        type: `java_${kind === "Runtime.exec" ? "runtime_exec" : "process_builder"}`,
        language: "java",
        line: lineNumberAt(code, m.index),
        index: m.index,
        endIndex: end,
        snippet: snippetAt(code, m.index, end - m.index),
      };

      if (args.length === 1 && isPureStringLiteral(args[0], "java")) {
        // Fully static command string, no external input at all.
        const value = unquote(args[0]);
        if (containsShellMetacharacters(value)) {
          issues.push({ ...base, fixable: false, reason: "Literal command relies on shell metacharacters; converting to argv form would change behavior. Requires human review." });
          continue;
        }
        const tokens = splitLiteralTokens(value);
        if (kind === "Runtime.exec") {
          const arr = "new String[]{" + tokens.map(t => JSON.stringify(t)).join(", ") + "}";
          issues.push({
            ...base,
            fixable: true,
            replacement: `Runtime.getRuntime().exec(${arr})`,
            reason: "Argument is a fully static literal command with no external input; split into an explicit argv array (removes the JVM's internal naive whitespace-split of the String form). NOTE: if the original string relied on the JVM split, review token boundaries.",
          });
        } else {
          continue; // already a single static literal; ProcessBuilder(String) has no shell-injection surface here
        }
        continue;
      }

      if (args.length >= 1 && args.some(a => !isPureStringLiteral(a, "java"))) {
        // At least one argument is a variable/expression — i.e. some
        // amount of external/non-literal input reaches the sink.
        // We deliberately refuse to fabricate an argv split: the
        // literal fragments may contain more than one token, and we
        // cannot know the intended command structure with certainty.
        issues.push({
          ...base,
          fixable: false,
          reason: `${kind} receives at least one non-literal argument (variable/expression/concatenation). Fabricating an argv array here would guess at command structure the tool cannot verify (e.g. whether a literal fragment is one token or several). Requires human review to define the correct fixed argv.`,
        });
      }
    }
    return issues;
  }

  function fixJava(code) {
    const masked = maskSource(code, "java");
    const issues = detectJava(code, masked);
    const fixableIssues = issues.filter(i => i.fixable).sort((a, b) => b.index - a.index);
    let fixed = code;
    for (const issue of fixableIssues) {
      fixed = fixed.slice(0, issue.index) + issue.replacement + fixed.slice(issue.endIndex);
    }
    return { fixed, changed: fixed !== code, issues };
  }

  // ─────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────

  function fix(code, fileName) {
    const validationError = validate(code, fileName);
    if (validationError) {
      return {
        fixed: typeof code === "string" ? code : "",
        changed: false,
        issues: [],
        error: validationError,
      };
    }

    const ext = fileName.split(".").pop().toLowerCase();
    const lang = SUPPORTED_EXT[ext];
    let result;
    if (lang === "python") result = fixPython(code);
    else if (lang === "php") result = fixPHP(code);
    else result = fixJava(code);

    const metadata = {
      language: lang,
      totalIssues: result.issues.length,
      fixedCount: result.issues.filter(i => i.fixable).length,
      aiRequiredCount: result.issues.filter(i => !i.fixable).length,
    };

    return {
      fixed: result.fixed,
      changed: result.changed,
      issues: result.issues.map(i => ({
        type: i.type,
        language: i.language,
        line: i.line,
        snippet: i.snippet,
        status: i.fixable ? "fixed" : "AI_REQUIRED",
        reason: i.reason,
      })),
      metadata,
    };
  }

  // Decides fixability strictly from this specific issue's own
  // structured metadata (`fixable` / `status`) — never from its
  // `type` name. `type` only says WHAT KIND of call was found; it
  // says nothing about whether THIS PARTICULAR occurrence turned out
  // to be a static literal or a dynamic/ambiguous one, so falling
  // back to a type-name allowlist would let a same-typed but unsafe
  // occurrence be reported as fixable. Absence of explicit metadata
  // means "unknown" and must resolve to false, not to a guess.
  function canFix(issue) {
    if (!issue || typeof issue !== "object") return false;
    if (typeof issue.fixable === "boolean") return issue.fixable;
    if (typeof issue.status === "string") return issue.status === "fixed";
    return false;
  }

  return { fix, canFix, __internal: { maskSource, findMatchingParenEnd, splitTopLevelArgs, isPureStringLiteral } };
})();

// ─── Inline Tests ────────────────────────────────────
// Run with: node command_injection_fix.js
if (typeof require !== "undefined" && require.main === module) {
  let pass = 0, fail = 0;
  function check(name, actual, expected) {
    if (actual === expected) { console.log("✅", name); pass++; }
    else { console.log("❌", name, "\n  got:", JSON.stringify(actual), "\n  exp:", JSON.stringify(expected)); fail++; }
  }

  // Python: static literal → auto-fix, no check=True
  let r = CommandInjectionFixer.fix('import os\nos.system("echo hello")\n', "app.py");
  check("py: static literal is auto-fixed", r.changed, true);
  check("py: no check=True in replacement", /check=True/.test(r.fixed), false);
  check("py: subprocess.run present", /subprocess\.run/.test(r.fixed), true);

  // Python: dynamic arg → AI_REQUIRED
  r = CommandInjectionFixer.fix('import os\nos.system("ping " + host)\n', "app.py");
  check("py: dynamic arg → not auto-fixed", r.changed, false);
  check("py: dynamic flagged AI_REQUIRED", r.issues[0]?.status, "AI_REQUIRED");

  // Python: shell metacharacters → AI_REQUIRED
  r = CommandInjectionFixer.fix('import os\nos.system("ls | grep foo")\n', "app.py");
  check("py: shell metachar → AI_REQUIRED", r.issues[0]?.status, "AI_REQUIRED");

  // Java: static literal → auto-fix
  r = CommandInjectionFixer.fix('Runtime.getRuntime().exec("ls -la");', "App.java");
  check("java: static literal auto-fixed", r.changed, true);
  check("java: String[] form present", /new String\[\]/.test(r.fixed), true);

  // Java: variable arg → AI_REQUIRED
  r = CommandInjectionFixer.fix('Runtime.getRuntime().exec("ping " + host);', "App.java");
  check("java: variable arg → AI_REQUIRED", r.issues[0]?.status, "AI_REQUIRED");

  // PHP: superglobal → AI_REQUIRED (never auto-fixed)
  r = CommandInjectionFixer.fix('<?php system($_GET["cmd"]); ?>', "app.php");
  check("php: superglobal → AI_REQUIRED", r.issues[0]?.status, "AI_REQUIRED");
  check("php: never auto-fixed", r.changed, false);

  // Unsupported extension → error, original code returned
  r = CommandInjectionFixer.fix('eval(x);', "app.js");
  check("unsupported ext → no change", r.changed, false);
  check("unsupported ext → error set", typeof r.error, "string");


  // ─── Comment containing os.system → ignored ─────────
  r = CommandInjectionFixer.fix('# os.system("echo hack")\nx = 1\n', "app.py");
  check("py: os.system in comment → no change", r.changed, false);

  // ─── String containing shell=True text → ignored ─────
  r = CommandInjectionFixer.fix('msg = "use shell=True for subprocess"\n', "app.py");
  check("py: shell=True in string → no detection", r.issues.length, 0);

  // ─── subprocess.call shell=True static → auto-fixed ──
  r = CommandInjectionFixer.fix('subprocess.call("echo hello", shell=True)\n', "app.py");
  check("py: call shell=True static → fixed", r.changed, true);

  // ─── subprocess.call shell=True dynamic → AI_REQUIRED ─
  r = CommandInjectionFixer.fix('subprocess.call("echo " + x, shell=True)\n', "app.py");
  check("py: call shell=True dynamic → AI_REQUIRED", r.issues[0]?.status, "AI_REQUIRED");

  // ─── subprocess.Popen shell=True static → auto-fixed ─
  r = CommandInjectionFixer.fix('subprocess.Popen("ls -la", shell=True)\n', "app.py");
  check("py: Popen shell=True static → fixed", r.changed, true);

  // ─── subprocess.run shell=True static → auto-fixed ───
  r = CommandInjectionFixer.fix('subprocess.run("echo hello", shell=True)\n', "app.py");
  check("py: run shell=True static → fixed", r.changed, true);

  // ─── triple-quoted string masks os.system ────────────
  const tripleCode = 'x = """\nos.system("echo hack")\n"""\n';
  r = CommandInjectionFixer.fix(tripleCode, "app.py");
  check("py: os.system in triple-quote → no change", r.changed, false);

  // ─── shell metacharacters → AI_REQUIRED ──────────────
  r = CommandInjectionFixer.fix('os.system("ls -la | grep foo")\n', "app.py");
  check("py: pipe → AI_REQUIRED", r.issues[0]?.status, "AI_REQUIRED");

  // ─── unbalanced parens → AI_REQUIRED ─────────────────
  r = CommandInjectionFixer.fix('os.system("echo hello"\n', "app.py");
  check("py: unbalanced paren → AI_REQUIRED", r.issues[0]?.status, "AI_REQUIRED");

  // ─── two static calls → both fixed ───────────────────
  r = CommandInjectionFixer.fix('os.system("echo a")\nos.system("ls -la")\n', "app.py");
  check("py: two static calls fixed", r.changed, true);
  check("py: no os.system left", (r.fixed.match(/os\.system/g) || []).length, 0);

  // ─── Java ProcessBuilder → no crash ──────────────────
  r = CommandInjectionFixer.fix('new ProcessBuilder("ls -la");', "App.java");
  check("java: ProcessBuilder no crash", typeof r.changed, "boolean");

  // ─── Java variable → AI_REQUIRED ─────────────────────
  r = CommandInjectionFixer.fix('new ProcessBuilder("ping " + host);', "App.java");
  check("java: ProcessBuilder variable → AI_REQUIRED or no-issue",
    r.issues.length === 0 || r.issues[0]?.status === "AI_REQUIRED", true);

  // ─── PHP exec superglobal → AI_REQUIRED ──────────────
  r = CommandInjectionFixer.fix('<?php exec($_POST["cmd"]); ?>', "app.php");
  check("php: exec superglobal → AI_REQUIRED", r.issues[0]?.status, "AI_REQUIRED");

  // ─── PHP exec no superglobal → not flagged ────────────
  r = CommandInjectionFixer.fix('<?php exec("ls -la"); ?>', "app.php");
  check("php: exec no superglobal → no issue", r.issues.length, 0);

  console.log(`\n${pass}/${pass+fail} passed`);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = CommandInjectionFixer;
}
