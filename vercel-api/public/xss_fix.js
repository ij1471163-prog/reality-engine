// ═══════════════════════════════════════════════════════
// xss_fix.js v1.0
// متخصص بإصلاح XSS في JS/TS وPHP
// ═══════════════════════════════════════════════════════
"use strict";

var XSSFixer = (() => {

  function fixJS(code) {
    const lines = code.split('\n');
    const fixed = lines.map(line => {
      // innerHTML = 'string' + var → textContent = sanitized
      if (/\.innerHTML\s*=/.test(line) && !/\.textContent/.test(line)) {
        // استخرج الـ user variable
        const varMatch = line.match(/\.innerHTML\s*=\s*.*?\+\s*(\w+)/);
        if (varMatch) {
          const v = varMatch[1];
          return line
            .replace(/\.innerHTML\s*=\s*['"`][^'"\`]*['"\`]\s*\+\s*\w+\s*\+\s*['"\`][^'"\`]*['"\`]/, `.textContent = String(${v}).replace(/[<>]/g, '')`)
            .replace(/\.innerHTML\s*=/, '.textContent =');
        }
        return line.replace(/\.innerHTML\s*=/, '.textContent =');
      }
      if (/\.outerHTML\s*=/.test(line)) return line.replace(/\.outerHTML\s*=/, '.textContent =');
      if (/document\.write\s*\(/.test(line)) return line.replace(/document\.write\s*\(/, '// SECURITY: document.write removed — use DOM methods (');
      return line;
    });
    return fixed.join('\n');
  }

  function fixPHP(code) {
    return code
      .replace(
        /echo\s+(\$(?!_SESSION|_COOKIE)[a-zA-Z_]\w*)\s*;/g,
        'echo htmlspecialchars($1, ENT_QUOTES, "UTF-8");'
      )
      .replace(
        /echo\s+(\$_(GET|POST|REQUEST)\[[^\]]+\])\s*;/g,
        'echo htmlspecialchars($1, ENT_QUOTES, "UTF-8");'
      )
      .replace(
        /<\?php echo\s+(\$\w+)/g,
        '<?php echo htmlspecialchars($1, ENT_QUOTES, "UTF-8")'
      );
  }

  function fix(code, fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    let fixed = code;
    if (ext === 'js' || ext === 'ts' || ext === 'jsx' || ext === 'tsx') fixed = fixJS(fixed);
    else if (ext === 'php') fixed = fixPHP(fixed);
    return { fixed, changed: fixed !== code };
  }

  function canFix(issues) {
    return issues.some(i => /xss|innerhtml/i.test(i.title));
  }

  return { fix, canFix };
})();
