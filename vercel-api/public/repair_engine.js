// ═══════════════════════════════════════════════════════
// repair_engine.js v2 — Repair Engine with Confidence
// ═══════════════════════════════════════════════════════

const STRATEGIES = {
  XSS_INNER_HTML:   { fn: fixXSS,            autoFix: true,  confidence: 0.95 },
  HTTP_USAGE:       { fn: fixHTTP,            autoFix: true,  confidence: 0.98 },
  VAR_USAGE:        { fn: fixVar,             autoFix: true,  confidence: 0.95 },
  LOOSE_EQUALITY:   { fn: fixEquality,        autoFix: true,  confidence: 0.90 },
  ACCUMULATION:     { fn: fixAccumulation,    autoFix: true,  confidence: 0.88 },
  HARDCODED_SECRET: { fn: fixHardcodedSecret, autoFix: true,  confidence: 0.85 },
  LOG_SECRET:       { fn: fixLogSecret,       autoFix: true,  confidence: 0.90 },
  EMPTY_CATCH:      { fn: fixEmptyCatch,      autoFix: true,  confidence: 0.80 },
  EMPTY_FUNCTION:   { fn: fixEmptyFunction,   autoFix: false, confidence: 0.20 },
  SQL_INJECTION:    { fn: fixSQLInjection,    autoFix: true,  confidence: 0.75 },
  EVAL_USAGE:       { fn: fixEval,            autoFix: true,  confidence: 0.85 },
  RETURN_NULL:      { fn: null,               autoFix: false, confidence: 0.10 },
  NPE_CHAIN:        { fn: null,               autoFix: false, confidence: 0.15 },
};


// ─── SQL Injection Fix ────────────────────────────────
function fixSQLInjection(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];

  // JS: استبدل string concatenation بـ parameterized query
  const fixed = line
    .replace(/["']\s*\+\s*\w+\s*\+\s*["']/g, '?')
    .replace(/`[^`]*\$\{[^}]+\}[^`]*`/, '?');

  if (fixed === line) return null;
  lines[ln] = fixed + ' // TODO: use parameterized query';
  return lines.join('\n');
}

// ─── eval() Fix ───────────────────────────────────────
function fixEval(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  if (!/\beval\s*\(/.test(line)) return null;
  lines[ln] = '// SECURITY: eval() removed — use safer alternative\n// ' + line.trim();
  return lines.join('\n');
}

// ─── Hardcoded Password Fix ───────────────────────────
function fixHardcodedPassword(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const fixed = line.replace(
    /(["'])([^"']{8,})(["'])/,
    'process.env.SECRET_VALUE // TODO: move to .env'
  );
  if (fixed === line) return null;
  lines[ln] = fixed;
  return lines.join('\n');
}

// ─── Command Injection Fix ────────────────────────────
function fixCommandInjection(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  lines[ln] = '// SECURITY: Command injection risk — validate input\n// ' + line.trim();
  return lines.join('\n');
}

// ─── MD5/SHA1 Fix ─────────────────────────────────────
function fixWeakCrypto(code, issue) {
  const lines = code.split('\n');
  const ln = issue.line - 1;
  if (ln < 0 || ln >= lines.length) return null;
  const line = lines[ln];
  const fixed = line
    .replace(/["']md5["']/gi, '"sha256"')
    .replace(/["']sha1["']/gi, '"sha256"')
    .replace(/createHash\(["']md5["']\)/gi, 'createHash("sha256")')
    .replace(/createHash\(["']sha1["']\)/gi, 'createHash("sha256")');
  if (fixed === line) return null;
  lines[ln] = fixed;
  return lines.join('\n');
}

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

    const result = strat.fn(repairedCode, issue, repairedCode.split('\n'), ext);
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
  if (typeof analyzeCode === 'function') {
    const newIssues = analyzeCode(repairedCode, fileName);
    reAnalysis = {
      issuesBefore: issues.length, issuesAfter: newIssues.length,
      fixed: issues.length - newIssues.length, remaining: newIssues,
    };
  }

  return {
    original: code, repaired: repairedCode,
    repairs, aiNeeded, reAnalysis,
    summary: { autoFixed: repairs.length, aiNeeded: aiNeeded.length, total: issues.length },
  };
}

function detectStrategy(issue) {
  const t = (issue.title || '').toLowerCase();
  if (t.includes('sql'))                                                  return 'SQL_INJECTION';
  if (t.includes('innerhtml') || t.includes('xss'))                      return 'XSS_INNER_HTML';
  if (t.includes('مرور') || t.includes('مفتاح') || t.includes('مُضمَّن')) return 'HARDCODED_SECRET';
  if (t.includes('تراكم') || t.includes('+='))                           return 'ACCUMULATION';
  if (t.includes('===') || t.includes('=='))                             return 'LOOSE_EQUALITY';
  if (t.includes('var'))                                                  return 'VAR_USAGE';
  if (t.includes('eval'))                                                 return 'EVAL_USAGE';
  if (t.includes('catch'))                                                return 'EMPTY_CATCH';
  if (t.includes('http'))                                                 return 'HTTP_USAGE';
  if (t.includes('تسجيل') || t.includes('log'))                          return 'LOG_SECRET';
  if (t.includes('ناقصة') || t.includes('empty'))                        return 'EMPTY_FUNCTION';
  if (t.includes('return null'))                                          return 'RETURN_NULL';
  if (t.includes('npe') || t.includes('null check'))                     return 'NPE_CHAIN';
  return null;
}

function getAIReason(strategy) {
  const reasons = {
    SQL_INJECTION:  'يحتاج تعديل query + execute() معاً',
    EVAL_USAGE:     'يحتاج فهم السلوك المقصود',
    RETURN_NULL:    'يحتاج منطق الدالة الكامل',
    NPE_CHAIN:      'يحتاج فهم السياق لإضافة null check',
    EMPTY_FUNCTION: 'يحتاج فهم وظيفة الدالة',
  };
  return reasons[strategy] || 'يحتاج مراجعة يدوية';
}

function fixXSS(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const fixed = line.replace(/\.innerHTML\s*=/g, '.textContent =').replace(/document\.write\(/g, '// document.write(');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'innerHTML → textContent prevents XSS' };
}

function fixHTTP(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const fixed = line.replace(/http:\/\//g, 'https://');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'Enforce HTTPS' };
}

function fixVar(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const fixed = line.replace(/\bvar\s+/, 'let ');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'var → let' };
}

function fixEquality(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const fixed = line
    .replace(/(^|[^=!<>])==(?!=)/g, '$1===')
    .replace(/(^|[^!<>])!=(?!=)/g, '$1!==');
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'Strict equality' };
}

function fixAccumulation(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const varMatch = (issue.title || '').match(/:\s*(\w+)\s*=/);
  if (!varMatch) return null;
  const varName = varMatch[1];
  const fixed = line.replace(new RegExp(`\\b${varName}\\s*=(?![=+\\-*/<>!])`), `${varName} +=`);
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'Accumulation requires +=' };
}

function fixHardcodedSecret(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const varMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=/);
  if (!varMatch) return null;
  const varName = varMatch[1].toUpperCase();
  let fixed = line;
  if (ext === 'py') { fixed = line.replace(/=\s*["'][^"']*["']/, `= os.environ.get("${varName}")`); }
  else if (ext === 'java') { fixed = line.replace(/=\s*["'][^"']*["']/, `= System.getenv("${varName}")`); }
  else { fixed = line.replace(/=\s*["'][^"']*["']/, `= process.env.${varName}`); }
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'Move secrets to env vars' };
}

function fixLogSecret(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const indent = ' '.repeat(line.search(/\S/));
  const fixed = indent + '// ⚠️ [REMOVED] log of sensitive data';
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: '// log removed', reason: 'Sensitive data must not appear in logs' };
}

function fixEmptyCatch(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  let fixed = line;
  if (ext === 'java') {
    fixed = line.replace(/catch\s*\((\w+)\s+(\w+)\)\s*\{\s*\}/, 'catch ($1 $2) { android.util.Log.e("Error", $2.getMessage()); }');
    if (fixed === line) { fixed = line.replace(/\{\s*\}$/, '{ android.util.Log.e("Error", "exception"); }'); }
  } else if (ext === 'py') {
    fixed = line + '\n' + ' '.repeat(line.search(/\S/) + 4) + 'import logging; logging.error(e)';
  } else {
    fixed = line.replace(/catch\s*\(([^)]+)\)\s*\{\s*\}/, 'catch ($1) { console.error($1); }');
    if (fixed === line) { fixed = line.replace(/\{\s*\}$/, '{ console.error("error"); }'); }
  }
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: fixed.trim(), reason: 'Empty catch hides errors' };
}

function fixEmptyFunction(code, issue, lines, ext) {
  const line = lines[issue.line - 1];
  if (!line) return null;
  const indent = ' '.repeat(line.search(/\S/) + 4);
  let fixed = line;
  if (line.includes('{}')) {
    fixed = line.replace('{}', `{\n${indent}// TODO: implement\n${' '.repeat(line.search(/\S/))}}`);
  }
  if (fixed === line) return null;
  return { fixed: replaceLineInCode(code, issue.line, fixed), patch: 'Added TODO stub', reason: 'Marking empty function' };
}

function replaceLineInCode(code, lineNum, newLine) {
  const lines = code.split('\n');
  lines[lineNum - 1] = newLine;
  return lines.join('\n');
}
