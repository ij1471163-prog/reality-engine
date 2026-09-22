// ═══════════════════════════════════════════════════════
// repair_engine.js v3.2 — Language-aware Repair Engine
// ═══════════════════════════════════════════════════════

// ─── Language Allowlists per Strategy ────────────────
const STRATEGY_LANGS = {
  XSS_INNER_HTML:   ['js', 'ts'],
  HTTP_USAGE:       ['js', 'ts', 'py', 'php', 'java', 'cs'],
  VAR_USAGE:        ['js', 'ts'],
  LOOSE_EQUALITY:   ['js', 'ts'],
  ACCUMULATION:     ['js', 'ts', 'py', 'php'],
  HARDCODED_SECRET: ['js', 'ts', 'py', 'php', 'java', 'cs'],
  LOG_SECRET:       ['js', 'ts', 'py', 'java'],
  EMPTY_CATCH:      ['js', 'ts', 'py', 'java', 'cs'],
  EMPTY_FUNCTION:   ['js', 'ts', 'py'],
  CALLBACK_HELL:    ['js', 'ts'],
  API_KEY:          ['js', 'ts', 'py', 'php', 'java', 'cs'],
  SQL_INJECTION:    ['js', 'ts', 'py', 'php', 'cs'],
  EVAL_USAGE:       ['js', 'ts', 'py'],
  WEAK_CRYPTO:      ['js', 'ts', 'py', 'php', 'java', 'cs'],
  MD5_USAGE:        ['js', 'ts', 'py', 'php', 'java', 'cs'],
  WEAK_HASH:        ['js', 'ts', 'py', 'php', 'java', 'cs'],
  HARDCODED_PASS:   ['js', 'ts', 'py', 'java', 'cs'],
  CMD_INJECTION:    ['js', 'ts'],
  CMD_INJECTION_PY: ['py'],
  NONE_COMPARE:     ['py'],
  NAMEERROR:        ['py'],
  MISSING_AUTH:     [],
  RETURN_NULL:      [],
  NPE_CHAIN:        [],
};

const STRATEGIES = {
  XSS_INNER_HTML:   { fn: fixXSS,               autoFix: true,  confidence: 0.95 },
  HTTP_USAGE:       { fn: fixHTTP,               autoFix: true,  confidence: 0.98 },
  VAR_USAGE:        { fn: fixVar,                autoFix: true,  confidence: 0.95 },
  LOOSE_EQUALITY:   { fn: fixEquality,           autoFix: true,  confidence: 0.90 },
  ACCUMULATION:     { fn: fixAccumulation,       autoFix: true,  confidence: 0.88 },
  HARDCODED_SECRET: { fn: fixHardcodedSecret,    autoFix: true,  confidence: 0.85 },
  LOG_SECRET:       { fn: fixLogSecret,          autoFix: true,  confidence: 0.90 },
  EMPTY_CATCH:      { fn: fixEmptyCatch,         autoFix: true,  confidence: 0.80 },
  EMPTY_FUNCTION:   { fn: fixEmptyFunction,      autoFix: true,  confidence: 0.70 },
  CALLBACK_HELL:    { fn: null,                  autoFix: false, confidence: 0.75 },
  MISSING_AUTH:     { fn: null,                  autoFix: false, confidence: 0.70 },
  API_KEY:          { fn: fixApiKeyAdvanced,     autoFix: true,  confidence: 0.90 },
  SQL_INJECTION:    { fn: fixSQLInjection,       autoFix: true,  confidence: 0.75 },
  EVAL_USAGE:       { fn: fixEval,               autoFix: true,  confidence: 0.85 },
  WEAK_CRYPTO:      { fn: fixWeakCrypto,         autoFix: true,  confidence: 0.90 },
  MD5_USAGE:        { fn: fixWeakCrypto,         autoFix: true,  confidence: 0.90 },
  WEAK_HASH:        { fn: fixWeakCrypto,         autoFix: true,  confidence: 0.90 },
  HARDCODED_PASS:   { fn: fixHardcodedPassword,  autoFix: true,  confidence: 0.82 },
  CMD_INJECTION:    { fn: fixCommandInjection,   autoFix: true,  confidence: 0.78 },
  CMD_INJECTION_PY: { fn: fixCommandInjectionPy, autoFix: true,  confidence: 0.85 },
  NONE_COMPARE:     { fn: fixNoneCompare,        autoFix: true,  confidence: 0.95 },
  NAMEERROR:        { fn: fixNameError,          autoFix: true,  confidence: 0.90 },
  RETURN_NULL:      { fn: null,                  autoFix: false, confidence: 0.10 },
  NPE_CHAIN:        { fn: null,                  autoFix: false, confidence: 0.15 },
};

// ─── detectExt — امتداد الملف فقط ───────────────────
function detectExt(code, fileName) {
  if (!fileName) return 'unknown';
  const ext = fileName.split('.').pop().toLowerCase();
  if (ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'js';
  if (ext === 'tsx') return 'ts';
  // detectExt يحدد هوية الملف من الامتداد فقط.
  // دعم الإصلاحات تحدده STRATEGY_LANGS لاحقًا.
  return ext || 'unknown';
}

// ─── Helper ───────────────────────────────────────────
function replaceLineInCode(code, lineNum, newLine) {
  const lines = code.split('\n');
  lines[lineNum - 1] = newLine;
  return lines.join('\n');
}

// ─── SQL Injection ────────────────────────────────────
function fixSQLInjection(code, issue, lines2, ext2, fileName) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const ext = detectExt(code, fileName);

  if (ext === 'py') {
    // Python SQL: السياق والdriver غير معروفَين — نترك للمراجعة اليدوية
    return null;
  } else if (ext === 'js' || ext === 'ts') {
    let fixedLine = line
      .replace(/"([^"']*)'"\s*\+\s*\w+\s*\+\s*"'([^"]*)"/g, '"$1?$2"')
      .replace(/"([^"]*)"\s*\+\s*(\w+)/g, '"$1?"');
    if (fixedLine === line) return null;
    lines[ln] = fixedLine + ' // use: db.query(sql, [param])';
    return { fixed: lines.join('\n'), patch: lines[ln], reason: 'SQL Injection — parameterized query' };
  } else if (ext === 'php') {
    const phpM = line.match(/\$(\w+)\s*=\s*["']([^"']+)["']\s*\.\s*\$(\w+)/);
    if (!phpM) return null;
    const indent = ' '.repeat(line.search(/\S/));
    lines[ln] = `${indent}$stmt = $conn->prepare("${phpM[2]}?");`;
    lines.splice(ln + 1, 0, `${indent}$stmt->bind_param("s", $${phpM[3]});`);
    lines.splice(ln + 2, 0, `${indent}$stmt->execute();`);
    return { fixed: lines.join('\n'), patch: lines[ln], reason: 'PHP SQL Injection — prepared statement' };
  } else if (ext === 'cs') {
    const m = line.match(/"([^"]+)"\s*\+\s*(\w+)/);
    if (!m) return null;
    lines[ln] = line.replace(/"([^"]+)"\s*\+\s*(\w+)/, '"$1@param"');
    const indent = ' '.repeat(line.search(/\S/));
    lines.splice(ln + 1, 0, `${indent}cmd.Parameters.AddWithValue("@param", ${m[2]});`);
    return { fixed: lines.join('\n'), patch: lines[ln], reason: 'C# SQL Injection — SqlParameter' };
  }
  return null;
}

// ─── eval() ───────────────────────────────────────────
function fixEval(code, issue, lines2, ext2, fileName) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  if (!/\beval\s*\(/.test(line)) return null;
  const ext = detectExt(code, fileName);
  const indent = ' '.repeat(line.search(/\S/));
  const argMatch = line.match(/eval\s*\(([^)]+)\)/);
  const arg = argMatch ? argMatch[1] : 'data';

  if (ext === 'js' || ext === 'ts') {
    if (/json|data|response|result/i.test(arg)) {
      lines[ln] = line.replace(/eval\s*\([^)]+\)/, `JSON.parse(${arg})`);
    } else {
      // لا نحذف السطر ولا نغيّر معناه عندما لا يكون المقصود JSON واضحًا.
      // الإصلاح الدلالي يُترك لمسار AI_REQUIRED.
      return null;
    }
    return { fixed: lines.join('\n'), patch: lines[ln], reason: 'eval() replaced with safe alternative' };
  } else if (ext === 'py') {
    lines[ln] = line.replace(/eval\s*\(([^)]+)\)/, 'ast.literal_eval($1)');
    if (!code.includes('import ast')) lines.unshift('import ast');
    return { fixed: lines.join('\n'), patch: lines[ln], reason: 'eval() → ast.literal_eval()' };
  }
  return null;
}

// ─── Hardcoded Password ───────────────────────────────
function fixHardcodedPassword(code, issue, lines2, ext2, fileName) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const ext = detectExt(code, fileName);
  const varMatch = line.match(/(\w+)\s*[:=]/);
  const varName = varMatch ? varMatch[1].toUpperCase() : 'SECRET';

  let fixed = line;
  if (ext === 'py') {
    if (line.includes('os.environ')) return null;
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `os.environ.get('${varName}', '')`);
    if (fixed !== line && !code.includes('import os')) lines.unshift('import os');
  } else if (ext === 'js' || ext === 'ts') {
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `process.env.${varName}`);
  } else if (ext === 'java') {
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `System.getenv("${varName}")`);
  } else if (ext === 'cs') {
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `Environment.GetEnvironmentVariable("${varName}")`);
  } else if (ext === 'php') {
    if (/getenv\s*\(/i.test(line)) return null;
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `getenv('${varName}')`);
  } else {
    return null;
  }

  if (fixed === line) return null;
  lines[ln] = fixed;
  return { fixed: lines.join('\n'), patch: fixed.trim(), reason: 'Hardcoded credential moved to env variable' };
}

// ─── Command Injection JS/TS — splice لا string concat ─
function fixCommandInjection(code, issue, lines2, ext2, fileName) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const ext = detectExt(code, fileName);
  if (ext !== 'js' && ext !== 'ts') return null;

  const indent = ' '.repeat(line.search(/\S/));
  const execArg = line.match(/exec\s*\(([^)]+)\)/)?.[1] || 'command';
  const safeLine = line.replace(/exec\s*\([^)]+\)/, 'exec(safeArgs)');

  // أسطر مضافة بشكل صحيح عبر splice
  lines.splice(ln, 1,
    `${indent}// SECURITY: validate input before exec`,
    `${indent}const safeArgs = ${execArg}.replace(/[^a-zA-Z0-9 ]/g, '');`,
    safeLine
  );
  return { fixed: lines.join('\n'), patch: lines[ln], reason: 'Command injection mitigated' };
}

// ─── Weak Crypto ──────────────────────────────────────
function fixWeakCrypto(code, issue, lines2, ext2, fileName) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const ext = detectExt(code, fileName);
  let fixedLine = line;

  if (ext === 'py') {
    fixedLine = line
      .replace(/hashlib\.md5\s*\(/g, 'hashlib.sha256(')
      .replace(/hashlib\.sha1\s*\(/g, 'hashlib.sha256(');
  } else if (ext === 'js' || ext === 'ts') {
    fixedLine = line
      .replace(/createHash\s*\(\s*["']md5["']\s*\)/gi, 'createHash("sha256")')
      .replace(/createHash\s*\(\s*["']sha1["']\s*\)/gi, 'createHash("sha256")');
  } else if (ext === 'php') {
    fixedLine = line
      .replace(/md5\s*\(/gi, 'hash("sha256", ')
      .replace(/sha1\s*\(/gi, 'hash("sha256", ');
  } else if (ext === 'cs') {
    fixedLine = line
      .replace(/MD5\.Create\s*\(\s*\)/g, 'SHA256.Create()')
      .replace(/new MD5CryptoServiceProvider\s*\(\s*\)/g, 'new SHA256Managed()');
  } else if (ext === 'java') {
    fixedLine = line
      .replace(/MessageDigest\.getInstance\s*\(\s*["']MD5["']\s*\)/g, 'MessageDigest.getInstance("SHA-256")')
      .replace(/MessageDigest\.getInstance\s*\(\s*["']SHA-1["']\s*\)/g, 'MessageDigest.getInstance("SHA-256")');
  } else {
    return null;
  }

  if (fixedLine === line) return null;
  lines[ln] = fixedLine;
  return { fixed: lines.join('\n'), patch: fixedLine.trim(), reason: 'Weak crypto MD5/SHA1 → SHA256' };
}

// ─── NameError Fix — يستخدم issue.line أولاً ─────────
function fixNameError(code, issue) {
  const lines = code.split('\n');
  const ln = (issue.line || 1) - 1;

  // تحقق من السطر المستهدف أولاً
  if (ln >= 0 && ln < lines.length && /^\s*#\s*query\s*=/.test(lines[ln])) {
    lines[ln] = lines[ln].replace(/^(\s*)#\s*/, '$1');
    return { fixed: lines.join('\n'), patch: lines[ln].trim(), reason: 'Uncommented query definition' };
  }

  // بحث في الأسطر المجاورة فقط (±3 أسطر)
  const start = Math.max(0, ln - 3);
  const end   = Math.min(lines.length - 1, ln + 3);
  for (let i = start; i <= end; i++) {
    if (/^\s*#\s*query\s*=/.test(lines[i])) {
      lines[i] = lines[i].replace(/^(\s*)#\s*/, '$1');
      return { fixed: lines.join('\n'), patch: lines[i].trim(), reason: 'Uncommented query definition' };
    }
  }
  return null;
}

// ─── None Compare ─────────────────────────────────────
function fixNoneCompare(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const fixed = line
    .replace(/==\s*None/g, 'is None')
    .replace(/!=\s*None/g, 'is not None');
  if (fixed === line) return null;
  lines[ln] = fixed;
  return { fixed: lines.join('\n'), patch: fixed.trim(), reason: 'Use "is None" instead of "== None"' };
}

// ─── XSS ─────────────────────────────────────────────
function fixXSS(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  let fixed = line.replace(/\.innerHTML\s*=/, '.textContent =');
  if (fixed === line) fixed = line.replace(/\.outerHTML\s*=/, '.textContent =');
  if (fixed === line && /res\.send\s*\(/.test(line)) {
    const m = line.match(/res\.send\s*\(["'`]([^"'`]*?)["'`]\s*\+\s*(\w+)/);
    if (m) {
      fixed = line.replace(/res\.send\s*\([^)]+\)/, `res.json({ message: String(${m[2]}).replace(/[<>]/g, '') })`);
    } else if (/res\.send\s*\([^)]*\+[^)]*\)/.test(line)) {
      const v = line.match(/res\.send\s*\([^)]*\+\s*(\w+)/)?.[1] || 'data';
      fixed = line.replace(/res\.send\s*\([^)]+\)/, `res.json({ message: String(${v}).replace(/[<>]/g, '') })`);
    }
  }
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'XSS fixed' };
}

// ─── HTTP → HTTPS ─────────────────────────────────────
function fixHTTP(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const fixed = line.replace(/http:\/\//g, 'https://');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'HTTP → HTTPS' };
}

// ─── var → let ────────────────────────────────────────
function fixVar(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const fixed = line.replace(/\bvar\b/, 'let');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'var → let' };
}

// ─── Loose Equality ───────────────────────────────────
function fixEquality(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  let fixed = line
    .replace(/([^=!<>])==([^=])/g, '$1===$2')
    .replace(/([^=!<>])!=([^=])/g, '$1!==$2');
  fixed = fixed
    .replace(/===\s*"(\d+)"/g, '=== $1')
    .replace(/!==\s*"(\d+)"/g, '!== $1');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: '== → ===' };
}

// ─── Accumulation ─────────────────────────────────────
function fixAccumulation(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  if (/=>/.test(line)) {
    const fm = line.match(/forEach\s*\(\s*\(?\w+\)?\s*=>\s*\{[^}]*(\w+)\s*=\s*(\w+\.\w+)/);
    if (!fm) return null;
    const fixed2 = line
      .replace(`${fm[1]} = ${fm[2]}`, `${fm[1]} += ${fm[2]}`)
      .replace(`${fm[1]}=${fm[2]}`, `${fm[1]} += ${fm[2]}`);
    if (fixed2 === line) return null;
    return { fixed: replaceLineInCode(code, issue.line, fixed2), patch: fixed2.trim(), reason: `${fm[1]} = → ${fm[1]} +=` };
  }
  const fixed = line.replace(/(\w+)\s*=\s*/, '$1 += ');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: '= → +=' };
}

// ─── Hardcoded Secret ─────────────────────────────────
function fixHardcodedSecret(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const varMatch = line.match(/(\w+)\s*[:=]/);
  const varName = varMatch ? varMatch[1].toUpperCase() : 'SECRET';

  // Idempotency: لا نعيد تغليف قيمة سبق نقلها إلى متغير بيئة.
  if (
    /process\.env\./.test(line) ||
    /os\.environ(?:\.get)?\s*\(/.test(line) ||
    /getenv\s*\(/i.test(line) ||
    /System\.getenv\s*\(/.test(line) ||
    /Environment\.GetEnvironmentVariable\s*\(/.test(line)
  ) {
    return null;
  }

  let fixed = line;

  if (ext === 'py') {
    if (line.includes('os.environ')) return null;
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `os.environ.get('${varName}', '')`);
  } else if (ext === 'php') {
    if (/getenv\s*\(/i.test(line)) return null;
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `getenv('${varName}')`);
  } else if (ext === 'java') {
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `System.getenv("${varName}")`);
  } else if (ext === 'cs') {
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `Environment.GetEnvironmentVariable("${varName}")`);
  } else if (ext === 'js' || ext === 'ts') {
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `process.env.${varName}`);
  } else {
    return null;
  }

  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'Secret moved to env variable' };
}

// ─── Log Secret — يحافظ على توقيع Log.d/e ───────────
function fixLogSecret(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  let fixed = line;

  // helper: يستبدل قيمة حساسة واحدة بـ "[REDACTED]" ويحافظ على باقي arguments
  function redactArg(str) {
    return str.replace(
      /\b(password|secret|token|key|apikey|api_key)\b\s*(?=[,)])/gi,
      '"[REDACTED]"'
    );
  }

  if (ext === 'java') {
    // Log.d("TAG", sensitiveVar) → Log.d("TAG", "[REDACTED]")
    // يحافظ على الوسيطة الأولى (TAG) ويستبدل الحساسة فقط
    fixed = line.replace(
      /((android\.util\.)?Log\.\w+\s*\()([^)]+)\)/,
      (_, fn, _prefix, args) => {
        const parts = args.split(/,(?![^(]*\))/); // split بـ comma خارج الأقواس
        if (parts.length < 2) return _;
        const tag = parts[0];
        const rest = parts.slice(1).map(a =>
          /password|secret|token|key/i.test(a) ? ' "[REDACTED]"' : a
        );
        return `${fn}${tag},${rest.join(',')})`;
      }
    );
  } else if (ext === 'js' || ext === 'ts') {
    // console.log("User:", password) → console.log("User:", "[REDACTED]")
    fixed = line.replace(
      /(console\.(?:log|error|warn|info)\s*\()([^)]+)\)/,
      (_, fn, args) => {
        const redacted = args.replace(
          /(?<=[,\(]\s*)([A-Za-z_$][\w$]*)(?=\s*[,)])/g,
          (m) => /password|secret|token|key/i.test(m) ? '"[REDACTED]"' : m
        );
        return `${fn}${redacted})`;
      }
    );
  } else if (ext === 'py') {
    // print(password) أو logging.info(secret)
    fixed = line.replace(
      /((?:print|logging\.\w+)\s*\()([^)]+)\)/,
      (_, fn, args) => {
        const redacted = args.replace(
          /(?<=[,\(]\s*)([A-Za-z_$][\w$]*)(?=\s*[,)])/g,
          (m) => /password|secret|token|key/i.test(m) ? '"[REDACTED]"' : m
        );
        return `${fn}${redacted})`;
      }
    );
  }

  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'Sensitive data redacted from logs' };
}

// ─── Empty Catch — مع import logging لـ Python ────────
function fixEmptyCatch(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  let fixed = line;

  if (ext === 'java') {
    fixed = line.replace(/catch\s*\((\w+)\s+(\w+)\)\s*\{\s*\}/, 'catch ($1 $2) { android.util.Log.e("Error", $2.getMessage()); }');
    if (fixed === line) fixed = line.replace(/\{\s*\}$/, '{ android.util.Log.e("Error", "exception occurred"); }');
  } else if (ext === 'py') {
    // استخدم splice لإضافة السطر الجديد بشكل صحيح
    const catchLines = code.split('\n');
    const catchLn = issue.line - 1;
    if (catchLn < 0 || catchLn >= catchLines.length) return null;
    const catchLine = catchLines[catchLn];
    // استنتج الـindentation من السطر الحالي
    const baseIndent = catchLine.match(/^(\s*)/)?.[1] || '';
    const bodyIndent = baseIndent + '    ';
    // أضف import logging لو غائب
    if (!code.includes('import logging')) {
      catchLines.unshift('import logging');
    }
    // أضف السطر بعد سطر except
    const targetLn = catchLines.indexOf(catchLine, code.includes('import logging') ? 0 : 1);
    if (targetLn < 0) return null;
    catchLines.splice(targetLn + 1, 0, `${bodyIndent}logging.error("Exception: %s", str(e))`);
    return { fixed: catchLines.join('\n'), patch: `${bodyIndent}logging.error(...)`, reason: 'Empty except now logs error' };
  } else if (ext === 'cs') {
    fixed = line.replace(/catch\s*(\([^)]*\))?\s*\{\s*\}/, 'catch (Exception ex) { Debug.LogError("Error: " + ex.Message); }');
  } else if (ext === 'js' || ext === 'ts') {
    fixed = line.replace(/catch\s*\(([^)]+)\)\s*\{\s*\}/, 'catch ($1) { console.error("Error:", $1); }');
    if (fixed === line) fixed = line.replace(/\{\s*\}$/, '{ console.error("unexpected error"); }');
  } else {
    return null;
  }

  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'Empty catch now logs error' };
}

// ─── Empty Function ───────────────────────────────────
function fixEmptyFunction(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  if (ext !== 'js' && ext !== 'ts' && ext !== 'py' && ext !== 'php') return null;

  const indent = ' '.repeat(line.search(/\S/) + 4);
  const outerIndent = ' '.repeat(line.search(/\S/));
  const nameMatch = line.match(/function\s+(\w+)|def\s+(\w+)|(\w+)\s*[=(]/);
  const funcName = nameMatch ? (nameMatch[1] || nameMatch[2] || nameMatch[3]) : '';

  let body = '';
  if (/get|fetch|load|read/i.test(funcName)) {
    body = ext === 'py' ? `${indent}return None  # TODO: implement` : `${indent}return null; // TODO: implement`;
  } else if (/save|write|store|set/i.test(funcName)) {
    body = ext === 'py' ? `${indent}pass  # TODO: implement` : `${indent}// TODO: implement`;
  } else if (/calculate|compute|sum|total/i.test(funcName)) {
    body = ext === 'py' ? `${indent}return 0  # TODO: implement` : `${indent}return 0; // TODO: implement`;
  } else if (/is|has|check|valid/i.test(funcName)) {
    body = ext === 'py' ? `${indent}return False  # TODO: implement` : `${indent}return false; // TODO: implement`;
  } else {
    body = ext === 'py' ? `${indent}pass  # TODO: implement` : `${indent}// TODO: implement`;
  }

  if (!line.includes('{}')) return null;
  const fixed = line.replace('{}', `{\n${body}\n${outerIndent}}`);
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: 'Added stub', reason: 'Empty function placeholder' };
}

// ─── Callback Hell (autoFix: false) ──────────────────
function fixCallbackHell(code, issue) {
  return null;
}

// ─── Hardcoded API Keys ───────────────────────────────
function fixApiKeyAdvanced(code, issue, lines2, ext2, fileName) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const ext = detectExt(code, fileName);

  const m = line.match(/(?:const|let|var|private|public|string)?\s*(\w+)\s*[:=]\s*["']([^"']+)["']/);
  if (!m) return null;
  const varName = m[1];
  const envName = varName.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();

  if (ext === 'py') {
    lines[ln] = line.replace(/["'][^"']+["']/, `os.environ.get('${envName}', '')`);
    if (!code.includes('import os')) lines.unshift('import os');
    lines.splice(ln + 2, 0, `# Add to .env: ${envName}=your_value`);
  } else if (ext === 'js' || ext === 'ts') {
    lines[ln] = line.replace(/["'][^"']+["']/, `process.env.${envName}`);
    lines.splice(ln + 1, 0, `// Add to .env: ${envName}=your_value`);
  } else if (ext === 'php') {
    lines[ln] = line.replace(/["'][^"']+["']/, `getenv('${envName}')`);
  } else if (ext === 'cs') {
    lines[ln] = line.replace(/["'][^"']+["']/, `Environment.GetEnvironmentVariable("${envName}")`);
  } else if (ext === 'java') {
    lines[ln] = line.replace(/["'][^"']+["']/, `System.getenv("${envName}")`);
  } else {
    return null;
  }

  return { fixed: lines.join('\n'), patch: lines[ln].trim(), reason: `Secret → ${envName} env variable` };
}

// ─── Command Injection Python ─────────────────────────
function fixCommandInjectionPy(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const m = line.match(/os\.system\s*\((.+)\)/);
  if (!m) return null;
  const indent = ' '.repeat(line.search(/\S/));
  const arg = m[1].trim();
  lines[ln] = `${indent}subprocess.run(shlex.split(${arg}), check=True, capture_output=True)`;
  let fixed = lines.join('\n');
  if (!fixed.includes('import subprocess')) fixed = 'import subprocess\nimport shlex\n' + fixed;
  return { fixed, patch: lines[ln].trim(), reason: 'Command Injection → subprocess.run' };
}

// ─── detectStrategy — language-aware ─────────────────
function detectStrategy(issue, lang) {
  // لغة غير معروفة أو غير مدعومة = لا إصلاح
  if (!lang || lang === 'unknown') return null;

  const t = (issue.title || '').toLowerCase();
  let stratKey = null;

  if (t.includes('sql'))                                                    stratKey = 'SQL_INJECTION';
  else if (t.includes('innerhtml') || t.includes('xss'))                   stratKey = 'XSS_INNER_HTML';
  else if (t.includes('md5') || t.includes('sha1') || t.includes('ضعيف') || t.includes('لتشفير') || t.includes('crypto')) stratKey = 'WEAK_CRYPTO';
  else if (t.includes('command') || t.includes('os.system'))               stratKey = (lang === 'py') ? 'CMD_INJECTION_PY' : 'CMD_INJECTION';
  else if (t.includes('eval'))                                              stratKey = 'EVAL_USAGE';
  else if (t.includes('مرور') || t.includes('password'))                   stratKey = 'HARDCODED_PASS';
  else if (t.includes('secret') || t.includes('مكشوف'))                    stratKey = 'HARDCODED_SECRET';
  else if (t.includes('api key') || t.includes('google') || t.includes('stripe')) stratKey = 'API_KEY';
  else if (t.includes('تراكم') || t.includes('+='))                        stratKey = 'ACCUMULATION';
  else if (t.includes('مقارنة') || t.includes('string'))                   stratKey = 'LOOSE_EQUALITY';
  else if (t.includes('===') || t.includes('=='))                          stratKey = 'LOOSE_EQUALITY';
  else if (t.includes('var'))                                               stratKey = 'VAR_USAGE';
  else if (t.includes('catch'))                                             stratKey = 'EMPTY_CATCH';
  else if (t.includes('http'))                                              stratKey = 'HTTP_USAGE';
  else if (t.includes('log') || t.includes('تسجيل'))                       stratKey = 'LOG_SECRET';
  else if (t.includes('ناقصة') || t.includes('empty'))                     stratKey = 'EMPTY_FUNCTION';
  else if (t.includes('none') || t.includes('is none'))                    stratKey = 'NONE_COMPARE';
  else if (t.includes('nameerror') || t.includes('غير معرّف'))             stratKey = 'NAMEERROR';
  else if (t.includes('callback'))                                          stratKey = 'CALLBACK_HELL';
  else if (t.includes('auth') || t.includes('middleware'))                  stratKey = 'MISSING_AUTH';
  else if (t.includes('cwe-798') || t.includes('credential'))              stratKey = 'HARDCODED_SECRET';

  if (!stratKey) return null;

  // تحقق من allowlist اللغة — بدون fallback
  const allowed = STRATEGY_LANGS[stratKey];
  if (!allowed || !allowed.includes(lang)) return null;

  return stratKey;
}

function getAIReason(strategy) {
  const reasons = {
    SQL_INJECTION:  'يحتاج تعديل query + execute() معاً',
    EVAL_USAGE:     'يحتاج فهم السلوك المقصود',
    CALLBACK_HELL:  'يحتاج مراجعة يدوية — إعادة هيكلة',
    RETURN_NULL:    'يحتاج منطق الدالة الكامل',
    NPE_CHAIN:      'يحتاج فهم السياق لإضافة null check',
  };
  return reasons[strategy] || 'يحتاج مراجعة يدوية';
}

// ─── SQL candidate validation ─────────────────────────
// candidate لـSQL_INJECTION يُعتمد فقط إذا أثبت استعلامًا صالحًا مربوط القيم.
// يُرفض (ويبقى السطر الأصلي كما هو) إذا:
//   1. بقي دمج قيمة متغيرة داخل نص SQL (+ أو . أو ${} أو f-string).
//   2. placeholder داخل علامات اقتباس SQL ('?') أو اقتباس غير متوازن.
//   3. الـplaceholders غير مربوطة بقيم، أو عدد القيم لا يطابقها.
//   4. الـAnalyzer ما زال يبلّغ عن نفس عدد ثغرات SQL.
// يُرجع null إذا كان سليمًا، أو سبب الرفض.
const SQL_KEYWORD = /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i;

function _sqlLiterals(line) {
  const out = [];
  const re = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = re.exec(line))) {
    out.push({ quote: m[1], body: m[2], start: m.index, end: re.lastIndex });
  }
  return out;
}

// عدد العناصر داخل [..] أو (..) يبدأ عند open
function _sqlBoundCount(text, open) {
  const close = text[open] === '[' ? ']' : ')';
  let depth = 0, end = -1;
  for (let k = open; k < text.length; k++) {
    if (text[k] === text[open]) depth++;
    else if (text[k] === close && --depth === 0) { end = k; break; }
  }
  if (end < 0) return -1;
  const inner = text.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!inner) return 0;
  let n = 1; depth = 0;
  for (const ch of inner) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) n++;
  }
  return inner.endsWith(',') ? n - 1 : n;
}

function sqlCandidateProblem(beforeCode, afterCode, fileName, ext) {
  const B = beforeCode.split('\n'), A = afterCode.split('\n');
  let pre = 0;
  while (pre < B.length && pre < A.length && B[pre] === A[pre]) pre++;
  let suf = 0;
  while (suf < B.length - pre && suf < A.length - pre &&
         B[B.length - 1 - suf] === A[A.length - 1 - suf]) suf++;
  const regionEnd = A.length - suf;                     // حصري

  // كل literal يُستبدل بـ\u0001 (ليس حرف \w) → literal + literal لا يُحسب دمج متغير
  const concatOp = ext === 'php' ? /\u0001\s*\.\s*\$|\$[\w\[\]'"]+\s*\.\s*\u0001/ : /\u0001\s*\+\s*[A-Za-z_$(]|[\w$)\]]\s*\+\s*\u0001/;
  let sqlLines = 0;

  for (let i = pre; i < regionEnd; i++) {
    const line = A[i];
    const lits = _sqlLiterals(line);
    if (!lits.some(l => SQL_KEYWORD.test(l.body))) continue;
    sqlLines++;

    // 1. دمج قيمة متغيرة في نص SQL
    let masked = '', last = 0;
    for (const l of lits) { masked += line.slice(last, l.start) + '\u0001'; last = l.end; }
    masked += line.slice(last);
    const interpolated = lits.some(l =>
      (l.quote === '`' && /\$\{/.test(l.body)) ||
      (ext === 'php' && l.quote === '"' && /\$\w/.test(l.body)) ||
      (ext === 'py' && /[fF]$/.test(line.slice(0, l.start)) && /\{[^}]+\}/.test(l.body)));
    if (concatOp.test(masked) || interpolated) {
      return `SQL_STILL_CONCATENATED — line ${i + 1} still builds SQL from a variable`;
    }

    // 2. placeholder داخل اقتباس SQL أو اقتباس غير متوازن
    const sqlText = lits.map(l => l.body.replace(/\\'/g, "'")).join('');
    if (/'\s*(?:\?|\$\d+|%s)|(?:\?|\$\d+|%s)\s*'/.test(sqlText)) {
      return `SQL_PLACEHOLDER_QUOTED — line ${i + 1}: a placeholder inside quotes is a literal, not a bound value`;
    }
    if ((sqlText.replace(/''/g, '').match(/'/g) || []).length % 2 !== 0) {
      return `SQL_UNBALANCED_QUOTES — line ${i + 1} produces an invalid query`;
    }

    // 3. ربط الـplaceholders بقيم
    const dollars = (sqlText.match(/\$(\d+)/g) || []).map(s => +s.slice(1));
    const need = (sqlText.match(/\?/g) || []).length + (sqlText.match(/%s/g) || []).length +
                 (dollars.length ? Math.max(...dollars) : 0);
    if (!need) continue;

    if (ext === 'php' || ext === 'cs' || ext === 'java') {
      const region = A.slice(pre, Math.min(A.length, regionEnd + 5)).join('\n');
      const bind = { php: /bind_param\s*\(|->execute\s*\(\s*\[/, cs: /\.Parameters\.Add/, java: /\.set(?:String|Int|Long|Object|Double)\s*\(/ }[ext];
      if (!bind.test(region)) return `SQL_PLACEHOLDERS_UNBOUND — line ${i + 1} has placeholders but no bound values`;
      continue;
    }

    let bound = -1;
    const sameCall = masked.match(/\u0001\s*,\s*([\[(])/);
    if (sameCall) {
      bound = _sqlBoundCount(masked, sameCall.index + sameCall[0].length - 1);
    } else {
      const assign = masked.match(/^\s*(?:(?:var|let|const)\s+)?([A-Za-z_$][\w$]*)\s*=\s*\u0001/);
      if (assign) {
        const call = new RegExp('\\.(?:query|execute|executemany|run|all|get|each|exec|prepare)\\s*\\(\\s*' +
                                assign[1].replace(/\$/g, '\\$') + '\\b\\s*(,\\s*[\\[(])?');
        for (let k = i + 1; k < Math.min(A.length, i + 16); k++) {
          const c = A[k].match(call);
          if (!c) continue;
          bound = c[1] ? _sqlBoundCount(A[k], c.index + c[0].length - 1) : 0;
          break;
        }
      }
    }
    if (bound < 0) return `SQL_PLACEHOLDERS_UNBOUND — line ${i + 1}: no query call binding the placeholders was found`;
    if (bound !== need) {
      return `SQL_PLACEHOLDERS_UNBOUND — line ${i + 1} has ${need} placeholder(s) but ${bound} bound value(s)`;
    }
  }

  if (!sqlLines) return 'SQL_NOT_ADDRESSED — the candidate does not change any SQL statement';

  // 4. الـAnalyzer (إن وُجد) يجب أن يرى ثغرات SQL أقل
  if (typeof analyzeCode === 'function') {
    try {
      const count = c => (analyzeCode(c, fileName) || []).filter(x =>
        /sql injection|sql_injection|cwe-89/i.test([x && x.type, x && x.title, x && x.cAct].join(' '))).length;
      if (count(afterCode) >= count(beforeCode)) {
        return 'SQL_INJECTION_STILL_REPORTED — the analyzer still reports the SQL injection';
      }
    } catch (e) {
      return 'SQL_ANALYSIS_FAILED — could not verify the SQL candidate';
    }
  }
  return null;
}

// ─── Main repairCode ──────────────────────────────────

function getLegacySQLFixer(fileName) {
  const ext = String(fileName || '').split('.').pop().toLowerCase();

  // JS/TS: RepairSQL يُرجع aiRequired بلا تغيير، بينما SQLInjectionFixer يُنتج candidate.
  if (
    (ext === 'js' || ext === 'ts') &&
    typeof SQLInjectionFixer !== 'undefined' &&
    SQLInjectionFixer &&
    typeof SQLInjectionFixer.fix === 'function'
  ) {
    return SQLInjectionFixer;
  }

  if (
    typeof RepairSQL !== 'undefined' &&
    RepairSQL &&
    typeof RepairSQL.fix === 'function'
  ) {
    return RepairSQL;
  }

  if (typeof SQLInjectionFixer !== 'undefined') {
    return SQLInjectionFixer;
  }

  if (
    typeof window !== 'undefined' &&
    window.SQLInjectionFixer
  ) {
    return window.SQLInjectionFixer;
  }

  return null;
}

function repairCode(code, issues, fileName) {
  let ext = 'unknown';
  try {
    ext = detectExt(code, fileName);
  } catch (e) {
    // إذا فشل detector، نستخدم امتداد اسم الملف فقط.
    // لا يوجد هنا أي تخمين من محتوى الكود.
    ext = 'unknown';
    if (fileName) {
      const fallback = String(fileName).split('.').pop().toLowerCase();
      if (fallback) {
        if (fallback === 'jsx' || fallback === 'mjs' || fallback === 'cjs') ext = 'js';
        else if (fallback === 'tsx') ext = 'ts';
        else ext = fallback;
      }
    }
  }

  const repairs  = [];
  const aiNeeded = [];
  const rejected = [];   // candidates رُفضت قبل التطبيق (مثل SQL غير سليم)
  let repairedCode = code;

  const sorted = [...issues].sort((a, b) => b.line - a.line);

  sorted.forEach(issue => {
    const stratKey = detectStrategy(issue, ext);
    const strat = STRATEGIES[stratKey];
    if (!strat) { return; }

    if (!strat.autoFix || !strat.fn) {
      aiNeeded.push({
        line: issue.line, title: issue.title,
        strategy: stratKey, reason: getAIReason(stratKey), ev: issue.ev,
      });
      return;
    }

    const lines = repairedCode.split('\n');

    // حماية من stale-line:
    // إذا كان الدليل لا يطابق السطر، فالـissue قديمة ويجب تجاهلها.
    // الاستثناء الوحيد: إذا حصل إصلاح سابق غيّر أرقام الأسطر
    // (مثل إضافة import في الرأس)، نعيد ربط الدليل بموقعه الجديد.
    if (issue.ev && String(issue.ev).trim()) {
      const evidence = String(issue.ev).trim();
      const originalLineIndex = issue.line - 1;
      const currentLine = lines[originalLineIndex];

      if (!currentLine || !String(currentLine).includes(evidence)) {
        // لا يوجد تعديل سابق: mismatch حقيقي = stale issue.
        if (repairedCode === code) {
          return;
        }

        // حصل تعديل سابق، لذلك قد يكون رقم السطر تحرك.
        const matchIndex = lines.findIndex(line =>
          String(line).includes(evidence)
        );

        if (matchIndex === -1) {
          return;
        }

        issue = { ...issue, line: matchIndex + 1 };
      }
    }

    let result = null;
    try {
      result = strat.fn(repairedCode, issue, lines, ext, fileName);
    } catch (e) {
      // فشل Strategy واحدة لا يجب أن يُسقط باقي الإصلاحات.
      console.warn(`[RepairEngine] Strategy failed: ${stratKey}`, e?.message || e);
      return;
    }

    // SQL: candidate يبقي الثغرة أو ينتج استعلامًا غير صالح لا يُعتمد أبدًا.
    if (stratKey === 'SQL_INJECTION' && result && result.fixed !== repairedCode) {
      const problem = sqlCandidateProblem(repairedCode, result.fixed, fileName, ext);
      if (problem) {
        rejected.push({ line: issue.line, strategy: stratKey, source: 'fixSQLInjection', reason: problem });
        result = null;
      }
    }

    if (!result || result.fixed === repairedCode) {
      // SQL fallback: استخدم الـlegacy fixer فقط كمولّد candidate.
      // لا يتجاوز Ghost/FixVerifier في الطبقة الأعلى.
      if (stratKey === 'SQL_INJECTION') {
        const legacySQL = getLegacySQLFixer(fileName);

        if (
          legacySQL &&
          typeof legacySQL.fix === 'function' &&
          (ext === 'js' || ext === 'py')
        ) {
          try {
            const legacyOut = legacySQL.fix(repairedCode, fileName);

            const legacyFixed =
              typeof legacyOut?.fixed === 'string'
                ? legacyOut.fixed
                : typeof legacyOut?.code === 'string'
                  ? legacyOut.code
                  : null;

            const legacyChanged =
              legacyOut?.changed === true ||
              (typeof legacyOut?.code === 'string' &&
               legacyOut.code !== repairedCode);

            const legacyProblem =
              legacyChanged &&
              typeof legacyFixed === 'string' &&
              legacyFixed !== repairedCode
                ? sqlCandidateProblem(repairedCode, legacyFixed, fileName, ext)
                : null;
            if (legacyProblem) {
              rejected.push({ line: issue.line, strategy: stratKey, source: 'legacy SQL fixer', reason: legacyProblem });
            }

            if (
              legacyChanged &&
              typeof legacyFixed === 'string' &&
              legacyFixed !== repairedCode &&
              !legacyProblem
            ) {
              result = {
                fixed: legacyFixed,
                patch: 'Legacy SQL fixer candidate',
                reason: 'Legacy SQL fixer fallback',
              };
            }
          } catch (e) {
            console.warn(
              '[RepairEngine] Legacy SQL fallback failed:',
              e?.message || e
            );
          }
        }
      }

      if (!result || result.fixed === repairedCode) {
        // إذا فشل الإصلاح الحتمي، لكن Analyzer أعلن أن المشكلة
        // تحتاج AI، فمررها إلى AI بدل إسقاطها بصمت.
        if (issue.aiRequired === true) {
          aiNeeded.push({
            line: issue.line,
            title: issue.title,
            strategy: stratKey,
            reason: getAIReason(stratKey),
            ev: issue.ev,
          });
        }
        return;
      }
    }

    repairs.push({
      line: issue.line, title: issue.title, strategy: stratKey,
      before: issue.ev, after: result.patch,
      confidence: strat.confidence, autoFix: true,
      reason: result.reason || 'Safe deterministic replacement',
    });
    repairedCode = result.fixed;
  });

  // AuthRepair
  if (typeof AuthRepair !== 'undefined') {
    try {
      const ar = AuthRepair.fix(repairedCode, fileName);
      if (ar.changed) repairedCode = ar.fixed;
    } catch(e) {}
  }

  // Ghost Mode
  if (typeof GhostMode !== 'undefined') {
    try {
      const ghost = GhostMode.fix(code, repairedCode, fileName,
        typeof analyzeCode !== 'undefined' ? analyzeCode : null);
      if (ghost.code !== repairedCode) repairedCode = ghost.code;
    } catch(e) {}
  }

  return {
    original: code, repaired: repairedCode,
    repairs, aiNeeded, rejected,
    summary: {
      total: issues.length,
      fixed: repairs.length,
      needsAI: aiNeeded.length,
      score: Math.round((repairs.length / Math.max(issues.length, 1)) * 100),
    },
  };
}

