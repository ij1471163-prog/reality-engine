// ═══════════════════════════════════════════════════════
// xss_fix.js v1.0
// متخصص بإصلاح XSS في JS/TS وPHP
// ═══════════════════════════════════════════════════════
"use strict";

const XSSFixer = (() => {

  function fixJS(code) {
    return code
      .replace(/\.innerHTML\s*=/g, '.textContent =')
      .replace(/\.outerHTML\s*=/g, '.textContent =')
      .replace(/document\.write\s*\(/g, '// SECURITY: document.write removed — use DOM methods (');
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
