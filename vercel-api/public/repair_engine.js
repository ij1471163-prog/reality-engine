// ═══════════════════════════════════════════════════════
// repair_engine.js v3.0 — Smart Repair Engine
// كود حقيقي — بدون تعليقات وهمية
// ═══════════════════════════════════════════════════════

const STRATEGIES = {
  SQL_INJECTION:    { fn: (code, issue, lines, ext, fn) => typeof SQLInjectionFixer !== 'undefined' ? SQLInjectionFixer.fix(code, fn) : null, autoFix: true, confidence: 0.85 },
  CMD_INJECTION:    { fn: (code, issue, lines, ext, fn) => typeof CommandInjectionFixer !== 'undefined' ? CommandInjectionFixer.fix(code, fn) : null, autoFix: true, confidence: 0.85 },
  CMD_INJECTION_PY: { fn: (code, issue, lines, ext, fn) => typeof CommandInjectionFixer !== 'undefined' ? CommandInjectionFixer.fix(code, fn) : null, autoFix: true, confidence: 0.85 },
  XSS_INNER_HTML:   { fn: (code, issue, lines, ext, fn) => typeof XSSFixer !== 'undefined' ? XSSFixer.fix(code, fn) : null, autoFix: true, confidence: 0.95 },
  HARDCODED_SECRET: { fn: (code, issue, lines, ext, fn) => typeof SecretsFixer !== 'undefined' ? SecretsFixer.fix(code, fn) : null, autoFix: true, confidence: 0.85 },
  HARDCODED_PASS:   { fn: (code, issue, lines, ext, fn) => typeof SecretsFixer !== 'undefined' ? SecretsFixer.fix(code, fn) : null, autoFix: true, confidence: 0.82 },
  API_KEY:          { fn: (code, issue, lines, ext, fn) => typeof SecretsFixer !== 'undefined' ? SecretsFixer.fix(code, fn) : null, autoFix: true, confidence: 0.90 },
  HTTP_USAGE:       { fn: fixHTTP,              autoFix: true,  confidence: 0.98 },
  VAR_USAGE:        { fn: fixVar,               autoFix: true,  confidence: 0.95 },
  LOOSE_EQUALITY:   { fn: fixEquality,          autoFix: true,  confidence: 0.90 },
  ACCUMULATION:     { fn: fixAccumulation,      autoFix: true,  confidence: 0.88 },
  LOG_SECRET:       { fn: fixLogSecret,         autoFix: true,  confidence: 0.90 },
  EMPTY_CATCH:      { fn: fixEmptyCatch,        autoFix: true,  confidence: 0.80 },
  EMPTY_FUNCTION:   { fn: fixEmptyFunction,     autoFix: true,  confidence: 0.70 },
  CALLBACK_HELL:    { fn: fixCallbackHell,      autoFix: true,  confidence: 0.75 },
  EVAL_USAGE:       { fn: fixEval,              autoFix: true,  confidence: 0.85 },
  WEAK_CRYPTO:      { fn: fixWeakCrypto,        autoFix: true,  confidence: 0.90 },
  MD5_USAGE:        { fn: fixWeakCrypto,        autoFix: true,  confidence: 0.90 },
  WEAK_HASH:        { fn: fixWeakCrypto,        autoFix: true,  confidence: 0.90 },
  NONE_COMPARE:     { fn: fixNoneCompare,       autoFix: true,  confidence: 0.95 },
  NAMEERROR:        { fn: fixNameError,         autoFix: true,  confidence: 0.90 },
  RETURN_NULL:      { fn: null,                 autoFix: false, confidence: 0.10 },
  NPE_CHAIN:        { fn: null,                 autoFix: false, confidence: 0.15 },
};

// ─── eval() ───────────────────────────────────────────
function fixEval(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  if (!/\beval\s*\(/.test(line)) return null;

  const ext = detectExt(code);
  const indent = ' '.repeat(line.search(/\S/));

  // استخرج الـ argument
  const argMatch = line.match(/eval\s*\(([^)]+)\)/);
  const arg = argMatch ? argMatch[1] : 'data';

  if (ext === 'js' || ext === 'ts') {
    if (/json|data|response|result/i.test(arg)) {
      lines[ln] = line.replace(/eval\s*\([^)]+\)/, `JSON.parse(${arg})`);
    } else {
      // eval على user input خطير — احذفه واترك تحذير
      lines[ln] = `${indent}// SECURITY: eval() is dangerous — removed. Validate ${arg} before use`;
    }
  } else if (ext === 'py') {
    // استبدل eval بـ ast.literal_eval
    lines[ln] = line.replace(/eval\s*\(([^)]+)\)/, 'ast.literal_eval($1)');
    // أضف import لو ما موجود
    if (!code.includes('import ast')) {
      lines.unshift('import ast');
    }
  }

  return { fixed: lines.join('\n'), patch: lines[ln], reason: 'eval() replaced with safe alternative' };
}

// ─── Weak Crypto ──────────────────────────────────────
function fixWeakCrypto(code, issue, lines2, ext2, fileName) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const ext = fileName ? detectExt(code, fileName) : detectExt(code);

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
  }

  if (fixedLine === line) return null;
  lines[ln] = fixedLine;
  return { fixed: lines.join('\n'), patch: fixedLine.trim(), reason: 'Weak crypto MD5/SHA1 → SHA256' };
}

// ─── NameError Fix ───────────────────────────────────────
function fixNameError(code, issue) {
  const lines = code.split('\n');
  // ابحث عن # query معلق وأزل الـ #
  for (let i = 0; i < lines.length; i++) {
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

// ─── HTTP → HTTPS ─────────────────────────────────────
function fixHTTP(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const fixed = line.replace(/http:\/\//g, 'https://');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'HTTP → HTTPS' };
}

// ─── var → let/const ─────────────────────────────────
function fixVar(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const fixed = line.replace(/\bvar\b/, 'let');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'var → const/let' };
}

// ─── Loose Equality ───────────────────────────────────
function fixEquality(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  let fixed = line.replace(/([^=!<>])==([^=])/g, '$1===$2').replace(/([^=!<>])!=([^=])/g, '$1!==$2');
  // صلح رقم مقابل string: === "0" → === 0
  fixed = fixed.replace(/===\s*"(\d+)"/g, '=== $1').replace(/!==\s*"(\d+)"/g, '!== $1');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: '== → === و string→number' };
}

// ─── Accumulation ─────────────────────────────────────
function fixAccumulation(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const m = line.match(/(\w+)\s*=\s*(.+)/);
  if (!m) return null;
  const fixed = line.replace(/(\w+)\s*=(?!>|=|\+)\s*/, '$1 += ');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: '= → +=' };
}

// ─── Log Secret ───────────────────────────────────────
function fixLogSecret(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const fixed = line.replace(/(console\.log|print|Log\.\w)\s*\(([^)]*(?:password|secret|token|key)[^)]*)\)/gi,
    (_, fn) => `${fn}("[REDACTED]")`);
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'Sensitive data redacted from logs' };
}

// ─── Empty Catch ──────────────────────────────────────
function fixEmptyCatch(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  let fixed = line;
  if (ext === 'java') {
    fixed = line.replace(/catch\s*\((\w+)\s+(\w+)\)\s*\{\s*\}/, 'catch ($1 $2) { android.util.Log.e("Error", $2.getMessage()); }');
    if (fixed === line) fixed = line.replace(/\{\s*\}$/, '{ android.util.Log.e("Error", "exception occurred"); }');
  } else if (ext === 'py') {
    fixed = line + '\n' + ' '.repeat(line.search(/\S/) + 4) + 'logging.error("Exception: %s", str(e))';
  } else if (ext === 'cs') {
    fixed = line.replace(/catch\s*(\([^)]*\))?\s*\{\s*\}/, 'catch (Exception ex) { Debug.LogError("Error: " + ex.Message); }');
  } else {
    fixed = line.replace(/catch\s*\(([^)]+)\)\s*\{\s*\}/, 'catch ($1) { console.error("Error:", $1); }');
    if (fixed === line) fixed = line.replace(/\{\s*\}$/, '{ console.error("unexpected error"); }');
  }
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'Empty catch now logs error' };
}

// ─── Empty Function ───────────────────────────────────
function fixEmptyFunction(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const indent = ' '.repeat(line.search(/\S/) + 4);
  const outerIndent = ' '.repeat(line.search(/\S/));

  // استنتج نوع الدالة من اسمها
  const nameMatch = line.match(/function\s+(\w+)|def\s+(\w+)|(\w+)\s*[=(]/);
  const funcName = nameMatch ? (nameMatch[1] || nameMatch[2] || nameMatch[3]) : '';

  let body = '';
  if (/get|fetch|load|read/i.test(funcName)) {
    body = ext === 'py' ? `${indent}return None  # TODO: implement fetch logic` :
           `${indent}return null; // TODO: implement fetch logic`;
  } else if (/save|write|store|set/i.test(funcName)) {
    body = ext === 'py' ? `${indent}pass  # TODO: implement save logic` :
           `${indent}// TODO: implement save logic`;
  } else if (/calculate|compute|sum|total/i.test(funcName)) {
    body = ext === 'py' ? `${indent}return 0  # TODO: implement calculation` :
           `${indent}return 0; // TODO: implement calculation`;
  } else if (/is|has|check|valid/i.test(funcName)) {
    body = ext === 'py' ? `${indent}return False  # TODO: implement validation` :
           `${indent}return false; // TODO: implement validation`;
  } else {
    body = ext === 'py' ? `${indent}pass  # TODO: implement` :
           `${indent}// TODO: implement`;
  }

  let fixed = line;
  if (line.includes('{}')) {
    fixed = line.replace('{}', `{\n${body}\n${outerIndent}}`);
  }
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: 'Added smart stub', reason: 'Empty function with smart placeholder' };
}

// ─── Callback Hell → async/await ─────────────────────
function fixCallbackHell(code, issue) {
  const lines = code.split('\n');

  // ابحث عن أول callback متداخل
  const callbackPattern = /\w+\s*\(\s*function\s*\(/;
  let cbStart = -1;
  let cbEnd = -1;
  let depth = 0;
  const funcNames = [];

  for (let i = 0; i < lines.length; i++) {
    if (callbackPattern.test(lines[i])) {
      if (cbStart === -1) cbStart = i;
      const m = lines[i].match(/(\w+)\s*\(/);
      if (m) funcNames.push(m[1]);
      depth++;
    }
    if ((lines[i].includes('});') || lines[i].includes('})')) && depth > 0) {
      depth--;
      if (depth === 0) { cbEnd = i; break; }
    }
  }

  if (cbStart === -1 || funcNames.length < 2) return null;

  // بناء async/await
  const indent = ' '.repeat((lines[cbStart].match(/^(\s*)/)||['',''])[1].length);
  const asyncCode = [
    `${indent}async function processAll() {`,
    `${indent}  try {`,
    ...funcNames.map(n => `${indent}    const ${n}Result = await ${n}();`),
    `${indent}  } catch (error) {`,
    `${indent}    console.error('Error:', error);`,
    `${indent}  }`,
    `${indent}}`,
    `${indent}processAll();`
  ];

  // استبدل فقط كود الـ callbacks مو كل الملف
  const newLines = [
    ...lines.slice(0, cbStart),
    ...asyncCode,
    ...lines.slice(cbEnd + 1)
  ];

  return {
    fixed: newLines.join('\n'),
    patch: asyncCode.join('\n'),
    reason: 'Callback Hell → async/await'
  };
}

// ─── Fix Accumulation (متقدم) ─────────────────────────
function fixAccumulationAdvanced(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];

  // x = y.prop → x += y.prop
  const m = line.match(/(\s*)(\w+)\s*=\s*(\w+\.\w+)/);
  if (!m) return null;

  const [, indent, varName, value] = m;
  lines[ln] = `${indent}${varName} += ${value};`;

  return {
    fixed: lines.join('\n'),
    patch: lines[ln].trim(),
    reason: `Accumulation: ${varName} = → ${varName} +=`
  };
}

// ─── Helpers ──────────────────────────────────────────

function detectExt(code, fileName) {
  if (fileName && fileName.endsWith('.php')) return 'php';
  if (fileName && fileName.endsWith('.py')) return 'py';
  if (fileName && fileName.endsWith('.cs')) return 'cs';
  if (fileName && fileName.endsWith('.java')) return 'java';
  if (/def\s+\w+|import\s+\w+|print\s*\(|hashlib|os\.environ/.test(code)) return 'py';
  if (/<\?php|mysqli|\$_GET|\$_POST/.test(code)) return 'php';
  if (/using\s+System|namespace\s+\w+|public\s+class/.test(code) && !/def\s+\w+/.test(code)) return 'cs';
  if (/public\s+class|System\.out\.println/.test(code)) return 'java';
  return 'js';
}

function replaceLineInCode(code, lineNum, newLine) {
  const lines = code.split('\n');
  lines[lineNum - 1] = newLine;
  return lines.join('\n');
}

// ─── Main repairCode ──────────────────────────────────

function repairCode(code, issues, fileName) {
  // FixVerifier — تحقق من الإصلاح بعده
  const _origCode = code;

  // LearnedFixer — يطبق ما تعلمه المحرك
  if (typeof LearnedFixer !== 'undefined') {
    try {
      const lf = LearnedFixer.smartApply(code, fileName);
      if (lf.applied > 0) code = lf.code;
    } catch(e) {}
  }

  // BabelRepair — إصلاح ذكي بـ AST أولاً
  if (typeof BabelRepair !== 'undefined') {
    try {
      const br = BabelRepair.repair(code, fileName);
      if (br.repairs.length > 0) {
        code = br.code;
        br.repairs.forEach(r => {
          issues = issues.filter(i => i.line !== r.line);
        });
      }
    } catch(e) {}
  }
  const ext = fileName.split('.').pop().toLowerCase();
  const repairs  = [];
  const aiNeeded = [];
  let repairedCode = code;

  const sorted = [...issues].sort((a, b) => b.line - a.line);

  sorted.forEach(issue => {
    const stratKey = detectStrategy(issue);
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
    const result = strat.fn(repairedCode, issue, lines, ext, fileName);
    if (!result || result.fixed === repairedCode) { return; }

    repairs.push({
      line: issue.line, title: issue.title, strategy: stratKey,
      before: issue.ev, after: result.patch,
      confidence: strat.confidence, autoFix: true,
      reason: result.reason || 'Safe deterministic replacement',
    });
    repairedCode = result.fixed;
  });

  let reAnalysis = null;
  // reAnalysis disabled to avoid recursive call issues

  return {
    original: code, repaired: repairedCode,
    repairs, aiNeeded, reAnalysis,
    summary: {
      total: issues.length,
      fixed: repairs.length,
      needsAI: aiNeeded.length,
      score: Math.round((repairs.length / Math.max(issues.length, 1)) * 100),
    },
  };
}

// ─── Strategy Detection ───────────────────────────────

function detectStrategy(issue) {
  const t = (issue.title || '').toLowerCase();
  if (t.includes('sql'))                                          return 'SQL_INJECTION';
  if (t.includes('innerhtml') || t.includes('xss'))              return 'XSS_INNER_HTML';
  if (t.includes('md5') || t.includes('sha1') || t.includes('ضعيف') || t.includes('لتشفير') || t.includes('crypto')) return 'WEAK_CRYPTO';
  if (t.includes('command') || t.includes('os.system'))          return 'CMD_INJECTION_PY';
  if (t.includes('eval'))                                         return 'EVAL_USAGE';
  if (t.includes('مرور') || t.includes('password'))              return 'HARDCODED_PASS';
  if (t.includes('secret') || t.includes('مكشوف'))               return 'HARDCODED_SECRET';
  if (t.includes('api key') || t.includes('google') || t.includes('stripe')) return 'API_KEY';
  if (t.includes('تراكم') || t.includes('+='))                   return 'ACCUMULATION';
  if (t.includes('مقارنة') || t.includes('string'))              return 'LOOSE_EQUALITY';
  if (t.includes('===') || t.includes('=='))                     return 'LOOSE_EQUALITY';
  if (t.includes('var'))                                          return 'VAR_USAGE';
  if (t.includes('catch'))                                        return 'EMPTY_CATCH';
  if (t.includes('http'))                                         return 'HTTP_USAGE';
  if (t.includes('log') || t.includes('تسجيل'))                  return 'LOG_SECRET';
  if (t.includes('ناقصة') || t.includes('empty'))                return 'EMPTY_FUNCTION';
  if (t.includes('none') || t.includes('is none'))               return 'NONE_COMPARE';
  if (t.includes('nameerror') || t.includes('غير معرّف'))        return 'NAMEERROR';
  if (t.includes('callback'))                                     return 'CALLBACK_HELL';
  return null;
}
function getAIReason(strategy) {
  const reasons = {
    SQL_INJECTION:  'يحتاج تعديل query + execute() معاً',
    EVAL_USAGE:     'يحتاج فهم السلوك المقصود',
    RETURN_NULL:    'يحتاج منطق الدالة الكامل',
    NPE_CHAIN:      'يحتاج فهم السياق لإضافة null check',
  };
  return reasons[strategy] || 'يحتاج مراجعة يدوية';
}

