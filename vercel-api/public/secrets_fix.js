// ═══════════════════════════════════════════════════════
// secrets_fix.js v1.0
// متخصص بنقل الـ secrets من الكود للـ environment
// ═══════════════════════════════════════════════════════
"use strict";

var SecretsFixer = (() => {

  const SECRET_PATTERN = /KEY|SECRET|TOKEN|PASSWORD|PASS|PWD|STRIPE|TWILIO|SENDGRID|AWS|GITHUB/i;
  const SQL_VARS = /\bquery\s*=|\bsql\s*=/i;

  function fixJS(code) {
    const lines = code.split('\n');
    let changed = false;

    lines.forEach((line, i) => {
      if (line.trim().startsWith('//')) return;
      if (SQL_VARS.test(line)) return;
      if (!/(?:const|let|var)\s+\w/.test(line)) return;

      const varName = line.match(/(?:const|let|var)\s+(\w+)/)?.[1];
      if (!varName || !SECRET_PATTERN.test(varName)) return;
      if (line.includes('process.env')) return;

      const hasSecret = /=\s*["'][^"']{8,}["']/.test(line);
      if (!hasSecret) return;

      const envName = varName.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
      lines[i] = line.replace(/=\s*["'][^"']+["']/, `= process.env.${envName}`);
      changed = true;
    });

    return { fixed: changed ? lines.join('\n') : code, changed };
  }

  function fixPython(code) {
    const lines = code.split('\n');
    let changed = false;
    let needOs = false;

    lines.forEach((line, i) => {
      if (line.trim().startsWith('#')) return;
      if (SQL_VARS.test(line)) return;

      const varName = line.trim().match(/^([A-Z_][A-Z0-9_]*)\s*=/)?.[1];
      if (!varName || !SECRET_PATTERN.test(varName)) return;
      if (line.includes('os.environ')) return;

      const hasSecret = /=\s*["'][^"']{6,}["']/.test(line);
      if (!hasSecret) return;

      const indent = ' '.repeat(line.search(/\S/));
      lines[i] = `${indent}${varName} = os.environ.get('${varName}', '')`;
      changed = true;
      needOs = true;
    });

    let fixed = changed ? lines.join('\n') : code;
    if (needOs && !fixed.includes('import os')) fixed = 'import os\n' + fixed;
    return { fixed, changed };
  }

  function fixPHP(code) {
    let fixed = code;
    const before = fixed;

    // define('SECRET', 'value') → define('SECRET', getenv('SECRET'))
    fixed = fixed.replace(
      /define\s*\(\s*(['"])([^'"]*(?:SECRET|KEY|TOKEN|PASSWORD)[^'"]*)\1\s*,\s*(['"])[^'"]{6,}\3\s*\)/gi,
      (_, q, name) => `define(${q}${name}${q}, getenv(${q}${name}${q}))`
    );

    // $secret = 'value' → $secret = getenv('SECRET')
    fixed = fixed.replace(
      /(\$\w*(?:secret|key|token|password)\w*)\s*=\s*['"][^'"]{6,}['"]/gi,
      (_, varName) => {
        const envName = varName.replace('$', '').toUpperCase();
        return `${varName} = getenv('${envName}')`;
      }
    );

    return { fixed, changed: fixed !== before };
  }

  function fixCSharp(code) {
    let fixed = code;
    const before = fixed;

    fixed = fixed.replace(
      /private\s+(?:string|readonly\s+string)\s+(\w*(?:key|secret|pass|token)\w*)\s*=\s*"[^"]{6,}"/gi,
      (_, name) => {
        const envName = name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
        return `private string ${name} = Environment.GetEnvironmentVariable("${envName}")`;
      }
    );

    return { fixed, changed: fixed !== before };
  }

  function fix(code, fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    if (ext === 'js' || ext === 'ts') return fixJS(code);
    if (ext === 'py') return fixPython(code);
    if (ext === 'php') return fixPHP(code);
    if (ext === 'cs') return fixCSharp(code);
    return { fixed: code, changed: false };
  }

  function canFix(issues) {
    return issues.some(i => /secret|مكشوف|hardcoded|api key/i.test(i.title));
  }

  return { fix, canFix };
})();
