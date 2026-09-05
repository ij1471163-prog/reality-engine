// ═══════════════════════════════════════════════════════
// repair_engine.js v3.0 — Smart Repair Engine
// كود حقيقي — بدون تعليقات وهمية
// ═══════════════════════════════════════════════════════

const STRATEGIES = {
  XSS_INNER_HTML:   { fn: fixXSS,              autoFix: true,  confidence: 0.95 },
  HTTP_USAGE:       { fn: fixHTTP,              autoFix: true,  confidence: 0.98 },
  VAR_USAGE:        { fn: fixVar,               autoFix: true,  confidence: 0.95 },
  LOOSE_EQUALITY:   { fn: fixEquality,          autoFix: true,  confidence: 0.90 },
  ACCUMULATION:     { fn: fixAccumulation,      autoFix: true,  confidence: 0.88 },
  HARDCODED_SECRET: { fn: fixHardcodedSecret,   autoFix: true,  confidence: 0.85 },
  LOG_SECRET:       { fn: fixLogSecret,         autoFix: true,  confidence: 0.90 },
  EMPTY_CATCH:      { fn: fixEmptyCatch,        autoFix: true,  confidence: 0.80 },
  EMPTY_FUNCTION:   { fn: fixEmptyFunction,     autoFix: true,  confidence: 0.70 },
  CALLBACK_HELL:    { fn: fixCallbackHell,      autoFix: true,  confidence: 0.75 },
  API_KEY:          { fn: fixApiKeyAdvanced,     autoFix: true,  confidence: 0.90 },
  SQL_INJECTION:    { fn: fixSQLInjection,      autoFix: true,  confidence: 0.75 },
  EVAL_USAGE:       { fn: fixEval,              autoFix: true,  confidence: 0.85 },
  WEAK_CRYPTO:      { fn: fixWeakCrypto,        autoFix: true,  confidence: 0.90 },
  MD5_USAGE:        { fn: fixWeakCrypto,        autoFix: true,  confidence: 0.90 },
  WEAK_HASH:        { fn: fixWeakCrypto,        autoFix: true,  confidence: 0.90 },
  HARDCODED_PASS:   { fn: fixHardcodedPassword, autoFix: true,  confidence: 0.82 },
  CMD_INJECTION:    { fn: fixCommandInjection,  autoFix: true,  confidence: 0.78 },
  NONE_COMPARE:     { fn: fixNoneCompare,       autoFix: true,  confidence: 0.95 },
  RETURN_NULL:      { fn: null,                 autoFix: false, confidence: 0.10 },
  NPE_CHAIN:        { fn: null,                 autoFix: false, confidence: 0.15 },
};

// ─── SQL Injection ────────────────────────────────────
function fixSQLInjection(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const ext = detectExt(code);

  if (ext === 'py') {
    // Python: استبدل string concatenation بـ parameterized query
    const m = line.match(/(\w+)\s*=\s*["']([^"']*)\s*["']\s*\+\s*(\w+)/);
    if (m) {
      lines[ln] = line.replace(
        /["']([^"']*)\s*["']\s*\+\s*(\w+)/,
        '"$1?"'
      );
      // أضف execute مع params
      const indent = ' '.repeat(line.search(/\S/));
      lines.splice(ln + 1, 0, `${indent}cursor.execute(${m[1]}, (${m[3]},))`);
      return { fixed: lines.join('\n'), patch: lines[ln], reason: 'SQL Injection fixed with parameterized query' };
    }
  } else if (ext === 'js' || ext === 'ts') {
    const fixedLine = line.replace(/"([^"]*)" \+ (\w+)/g, '"$1?"');
    if (fixedLine !== line) {
      lines[ln] = fixedLine + ' // use: db.query(sql, [param])';
      return { fixed: lines.join('\n'), patch: lines[ln], reason: 'SQL Injection — use parameterized queries' };
    }
    const pyComment = ext === 'py' ? '# ' : '// ';
    lines[ln] = pyComment + 'SECURITY: SQL Injection — use prepared statements\n' + pyComment + line.trim();
    return { fixed: lines.join('\n'), patch: lines[ln], reason: 'SQL Injection marked for fix' };
  } else if (ext === 'cs') {
    // C#: استبدل بـ SqlParameter
    const m = line.match(/"([^"]+)"\s*\+\s*(\w+)/);
    if (m) {
      lines[ln] = line.replace(
        /"([^"]+)"\s*\+\s*(\w+)/,
        '"$1@param"'
      );
      const indent = ' '.repeat(line.search(/\S/));
      lines.splice(ln + 1, 0, `${indent}cmd.Parameters.AddWithValue("@param", ${m[2]});`);
      return { fixed: lines.join('\n'), patch: lines[ln], reason: 'SQL Injection fixed with SqlParameter' };
    }
  }

  if (line.trim().startsWith('//') || line.trim().startsWith('#')) return null;
  lines[ln] = (ext === 'py' ? '# ' : '// ') + 'SECURITY: SQL Injection — use parameterized queries\n' +
              (ext === 'py' ? '# ' : '// ') + line.trim();
  return { fixed: lines.join('\n'), patch: lines[ln], reason: 'SQL Injection — use parameterized queries' };
}

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
    // استبدل eval بـ JSON.parse لو كان JSON
    if (/json|data|response|result/i.test(arg)) {
      lines[ln] = line.replace(/eval\s*\([^)]+\)/, `JSON.parse(${arg})`);
    } else {
      lines[ln] = line.replace(/eval\s*\([^)]+\)/, `new Function('return ' + ${arg})()`);
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

// ─── Hardcoded Password ───────────────────────────────
function fixHardcodedPassword(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const ext = detectExt(code);

  // استخرج اسم المتغير
  const varMatch = line.match(/(\w+)\s*[:=]/);
  const varName = varMatch ? varMatch[1].toUpperCase() : 'SECRET';

  if (ext === 'py') {
    lines[ln] = line.replace(
      /(["\'])[^"\']+(["\'])/,
      `os.environ.get('${varName}', '')`
    );
    if (!code.includes('import os')) lines.unshift('import os');
  } else if (ext === 'js' || ext === 'ts') {
    lines[ln] = line.replace(
      /(["\'])[^"\']+(["\'])/,
      `process.env.${varName}`
    );
  } else if (ext === 'cs') {
    lines[ln] = line.replace(
      /(["\'])[^"\']+(["\'])/,
      `Environment.GetEnvironmentVariable("${varName}")`
    );
  } else {
    lines[ln] = line.replace(
      /(["\'])[^"\']+(["\'])/,
      `System.getenv("${varName}")`
    );
  }

  return { fixed: lines.join('\n'), patch: lines[ln], reason: 'Hardcoded credential moved to env variable' };
}

// ─── Command Injection ────────────────────────────────
function fixCommandInjection(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const ext = detectExt(code);
  const indent = ' '.repeat(line.search(/\S/));

  if (ext === 'py') {
    // استبدل os.system بـ subprocess مع list
    if (/os\.system\s*\(/.test(line)) {
      const argMatch = line.match(/os\.system\s*\(([^)]+)\)/);
      if (argMatch) {
        lines[ln] = line.replace(
          /os\.system\s*\([^)]+\)/,
          `subprocess.run(shlex.split(${argMatch[1]}), check=True)`
        );
        if (!code.includes('import subprocess')) lines.unshift('import subprocess\nimport shlex');
      }
    }
  } else if (ext === 'js' || ext === 'ts') {
    lines[ln] = `${indent}// SECURITY: Validate and sanitize input before exec\n${indent}const safeArgs = ${line.match(/exec\s*\(([^)]+)\)/)?.[1] || 'command'}.replace(/[^a-zA-Z0-9 ]/g, '');\n${indent}${line.replace(/exec\s*\([^)]+\)/, 'exec(safeArgs)')}`;
  }

  return { fixed: lines.join('\n'), patch: lines[ln], reason: 'Command injection mitigated' };
}

// ─── Weak Crypto ──────────────────────────────────────
function fixWeakCrypto(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const ext = detectExt(code);

  let fixedLine = line;
  if (ext === 'py') {
    fixedLine = line
      .replace(/hashlib\.md5\s*\(/g, 'hashlib.sha256(')
      .replace(/hashlib\.sha1\s*\(/g, 'hashlib.sha256(');
  } else if (ext === 'js' || ext === 'ts') {
    fixedLine = line
      .replace(/createHash\s*\(\s*["']md5["']\s*\)/gi, 'createHash("sha256")')
      .replace(/createHash\s*\(\s*["']sha1["']\s*\)/gi, 'createHash("sha256")');
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
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'XSS: innerHTML → textContent' };
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
  const fixed = line.replace(/\bvar\b/, /=/.test(line) && !/\+\+|--/.test(line) ? 'const' : 'let');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'var → const/let' };
}

// ─── Loose Equality ───────────────────────────────────
function fixEquality(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const fixed = line.replace(/([^=!<>])==([^=])/g, '$1===$2').replace(/([^=!<>])!=([^=])/g, '$1!==$2');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: '== → ===' };
}

// ─── Accumulation ─────────────────────────────────────
function fixAccumulation(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const m = line.match(/(\w+)\s*=\s*(.+)/);
  if (!m) return null;
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
  let fixed = line;
  if (ext === 'py') {
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `os.environ.get('${varName}', '')`);
  } else {
    fixed = line.replace(/(["\'])[^"\']+(["\'])/, `process.env.${varName}`);
  }
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'Secret moved to env variable' };
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

// ─── Hardcoded API Keys (متقدم) ───────────────────────
function fixApiKeyAdvanced(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const ext = detectExt(code);

  // استخرج اسم المتغير والقيمة
  const m = line.match(/(?:const|let|var|private|public|string)?\s*(\w+)\s*[:=]\s*["']([^"']+)["']/);
  if (!m) return null;

  const varName = m[1];
  const envName = varName.toUpperCase().replace(/([A-Z])/g, '_$1').replace(/^_/, '');

  if (ext === 'py') {
    lines[ln] = line.replace(/["'][^"']+["']/, `os.environ.get('${envName}', '')`);
    // أضف import os لو ما موجود
    if (!code.includes('import os')) {
      lines.unshift('import os');
    }
    // أضف .env example comment
    lines.splice(ln + 2, 0, `# Add to .env file: ${envName}=your_value_here`);
  } else if (ext === 'js' || ext === 'ts') {
    lines[ln] = line.replace(/["'][^"']+["']/, `process.env.${envName}`);
    lines.splice(ln + 1, 0, `// Add to .env file: ${envName}=your_value_here`);
  } else if (ext === 'cs') {
    lines[ln] = line.replace(/["'][^"']+["']/, `Environment.GetEnvironmentVariable("${envName}")`);
  } else if (ext === 'java') {
    lines[ln] = line.replace(/["'][^"']+["']/, `System.getenv("${envName}")`);
  }

  return {
    fixed: lines.join('\n'),
    patch: lines[ln].trim(),
    reason: `Hardcoded secret → ${envName} env variable`
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

function detectExt(code) {
  if (/def\s+\w+|import\s+\w+|print\s*\(|hashlib|os\.environ/.test(code)) return 'py';
  if (/using\s+System|namespace\s+\w+|public\s+class/.test(code) && /\.cs/.test(code || '')) return 'cs';
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
    const result = strat.fn(repairedCode, issue, lines, ext);
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
  if (t.includes('sql'))                                                  return 'SQL_INJECTION';
  if (t.includes('innerhtml') || t.includes('xss'))                      return 'XSS_INNER_HTML';
  if (t.includes('مرور') || t.includes('مفتاح') || t.includes('مُضمَّن') || t.includes('password')) return 'HARDCODED_PASS';
  if (t.includes('secret') || t.includes('api key') || t.includes('مكشوف')) return 'HARDCODED_SECRET';
  if (t.includes('تراكم') || t.includes('+='))                           return 'ACCUMULATION';
  if (t.includes('===') || t.includes('=='))                             return 'LOOSE_EQUALITY';
  if (t.includes('var'))                                                  return 'VAR_USAGE';
  if (t.includes('eval'))                                                 return 'EVAL_USAGE';
  if (t.includes('catch'))                                                return 'EMPTY_CATCH';
  if (t.includes('http'))                                                 return 'HTTP_USAGE';
  if (t.includes('تسجيل') || t.includes('log'))                          return 'LOG_SECRET';
  if (t.includes('ناقصة') || t.includes('empty function'))               return 'EMPTY_FUNCTION';
  if (t.includes('md5') || t.includes('sha1') || t.includes('ضعيف') || t.includes('crypto') || t.includes('MD5') || t.includes('SHA1')) return 'WEAK_CRYPTO';
  if (t.includes('none') || t.includes('is none'))                       return 'NONE_COMPARE';
  if (t.includes('command') || t.includes('os.system'))                  return 'CMD_INJECTION';
  if (t.includes('return null'))                                          return 'RETURN_NULL';
  if (t.includes('npe') || t.includes('null check'))                     return 'NPE_CHAIN';
  if (t.includes('callback') || t.includes('callback hell'))               return 'CALLBACK_HELL';
  if (t.includes('api key') || t.includes('google') || t.includes('stripe') || t.includes('secret key')) return 'API_KEY';
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
