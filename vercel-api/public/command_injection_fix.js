// ═══════════════════════════════════════════════════════
// command_injection_fix.js v1.0
// متخصص بإصلاح Command Injection في كل اللغات
// ═══════════════════════════════════════════════════════
"use strict";

const CommandInjectionFixer = (() => {

  const DANGEROUS = /\bos\.system\s*\(|\bsubprocess\.call\s*\(.*shell\s*=\s*True|\bsubprocess\.Popen\s*\(.*shell\s*=\s*True/;
  const PHP_DANGER = /\b(?:exec|system|passthru|shell_exec)\s*\(\s*.*\$_(GET|POST|REQUEST)/;
  const JAVA_DANGER = /Runtime\.getRuntime\(\)\.exec\s*\(\s*["'][^"']+"?\s*\+/;

  function fixPython(code) {
    const lines = code.split('\n');
    let changed = false;

    lines.forEach((line, i) => {
      if (line.trim().startsWith('#')) return;

      if (/os\.system\s*\(/.test(line)) {
        const m = line.match(/os\.system\s*\((.+)\)/);
        if (!m) return;
        const indent = ' '.repeat(line.search(/\S/));
        const arg = m[1].trim();
        lines[i] = /[+"']/.test(arg)
          ? `${indent}subprocess.run(shlex.split(${arg}), check=True, capture_output=True)`
          : `${indent}subprocess.run(${arg} if isinstance(${arg}, list) else shlex.split(${arg}), check=True, capture_output=True)`;
        changed = true;
      }

      if (/subprocess\.call\s*\(.*shell\s*=\s*True/.test(line)) {
        const m = line.match(/subprocess\.call\s*\(([^,]+),\s*shell\s*=\s*True\s*\)/);
        if (!m) return;
        const indent = ' '.repeat(line.search(/\S/));
        lines[i] = `${indent}subprocess.run(shlex.split(${m[1].trim()}), check=True, capture_output=True)`;
        changed = true;
      }

      if (/subprocess\.Popen\s*\(.*shell\s*=\s*True/.test(line)) {
        lines[i] = line.replace('shell=True', 'shell=False');
        changed = true;
      }
    });

    if (!changed) return code;
    let fixed = lines.join('\n');
    if (!fixed.includes('import subprocess')) fixed = 'import subprocess\nimport shlex\n' + fixed;
    else if (!fixed.includes('import shlex')) fixed = fixed.replace('import subprocess', 'import subprocess\nimport shlex');
    return fixed;
  }

  function fixPHP(code) {
    return code.replace(
      /\b(exec|system|passthru|shell_exec)\s*\(\s*(\$_(GET|POST|REQUEST)\[[^\]]+\])\s*\)/g,
      (_, fn, input) => `${fn}(escapeshellarg(${input}))`
    );
  }

  function fixJava(code) {
    return code.replace(
      /Runtime\.getRuntime\(\)\.exec\s*\("([^"]+)"\s*\+\s*(\w+)\)/g,
      (_, cmd, var_) => `Runtime.getRuntime().exec(new String[]{"${cmd}", ${var_}})`
    );
  }

  function fix(code, fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    let fixed = code;
    if (ext === 'py') fixed = fixPython(fixed);
    else if (ext === 'php') fixed = fixPHP(fixed);
    else if (ext === 'java') fixed = fixJava(fixed);
    return { fixed, changed: fixed !== code };
  }

  function canFix(issues) {
    return issues.some(i => /command|os\.system/i.test(i.title));
  }

  return { fix, canFix };
})();
