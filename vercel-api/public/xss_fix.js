// ═══════════════════════════════════════════════════════
// xss_fix.js v1.0
// متخصص بإصلاح XSS في JS/TS وPHP
// ═══════════════════════════════════════════════════════
"use strict";

var XSSFixer = (() => {

  function fixJS(code) {
    const lines = code.split('\n');
    const fixed = lines.map(line => {
      const t = line.trim();

      // innerHTML += any → createElement
      // eval في HTML
      if (/\beval\s*\(/.test(line) && !/SECURITY/.test(line) && !line.trim().startsWith('//')) {
        const ind = line.match(/^\s*/)[0];
        const vMatch = line.match(/eval\s*\(([^)]+)\)/);
        const v = vMatch ? vMatch[1].trim() : 'input';
        return `${ind}// SECURITY: eval() removed — use JSON.parse or safe alternative for: ${v}`;
      }

      if (/\.innerHTML\s*\+=/.test(line)) {
        const vMatch = line.match(/\+\s*(\w+)[^;]*;/);
        const v = vMatch ? vMatch[1] : 'value';
        const ind = line.match(/^\s*/)[0];
        return `${ind}const _p = document.createElement('span'); _p.textContent = String(${v}).replace(/[<>]/g, ''); document.body.appendChild(_p);`;
      }

      // innerHTML += '<tag>' + var → createElement + textContent
      // eval في HTML
      if (/\beval\s*\(/.test(line) && !/SECURITY/.test(line) && !line.trim().startsWith('//')) {
        const ind = line.match(/^\s*/)[0];
        const vMatch = line.match(/eval\s*\(([^)]+)\)/);
        const v = vMatch ? vMatch[1].trim() : 'input';
        return `${ind}// SECURITY: eval() removed — use JSON.parse or safe alternative for: ${v}`;
      }

      if (/\.innerHTML\s*\+=/.test(line)) {
        const m = line.match(/(\w+(?:\.\w+)*)\s*\.innerHTML\s*\+=\s*['"`][^'"`]*['"`]\s*\+\s*(\w+)[^;]*;/);
        if (m) {
          const [, el, v] = m;
          const ind = line.match(/^\s*/)[0];
          return `${ind}const _el = document.createElement('p'); _el.textContent = String(${v}).replace(/[<>]/g, ''); ${el}.appendChild(_el);`;
        }
      }

      // calcOutput.innerHTML = 'النتيجة: ' + result
      if (/(\.innerHTML\s*=)/.test(line) && !/(textContent)/.test(line)) {
        const m = line.match(/(\w+(?:\.\w+)*)\s*\.innerHTML\s*=\s*['"`][^'"`]*['"`]\s*\+\s*(\w+)/);
        if (m) {
          const [, el, v] = m;
          const ind = line.match(/^\s*/)[0];
          return `${ind}${el}.textContent = String(${v}).replace(/[<>]/g, '');`;
        }
      }
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
    const ext = (fileName||'').split('.').pop().toLowerCase();
    let fixed = code;
    // HTML - نصلح JS داخله
    if (ext === 'html' || ext === 'htm') {
      fixed = fixJS(fixed);
      // صلح Footer secrets
      fixed = fixed.replace(/JWT_SECRET=[^|<"']+/g, '');
      fixed = fixed.replace(/DB_PASS(?:WORD)?=[^|<"']+/g, '');
      // صلح SQL
      fixed = fixed.replace(
        /var query = "SELECT.*?"\s*\+[^;]+;/g,
        '// SQL: use parameterized queries on server'
      );
      // صلح innerHTML بالمتغيرات
      fixed = fixed.replace(
        /(\w+)\.innerHTML\s*\+=?\s*['"`][^'"`]*['"`]\s*\+\s*(\w+)[^;]*;/g,
        (m, el, v) => `${el}.textContent = String(${v}).replace(/[<>]/g, '');`
      );
      fixed = fixed.replace(
        /(\w+)\.innerHTML\s*=\s*['"`][^'"`]*['"`]\s*\+\s*(\w+)[^;]*;/g,
        (m, el, v) => `${el}.textContent = String(${v}).replace(/[<>]/g, '');`
      );
    }
    if (ext === 'js' || ext === 'ts' || ext === 'jsx' || ext === 'tsx' || ext === 'html') fixed = fixJS(fixed);
    else if (ext === 'php') fixed = fixPHP(fixed);
    return { fixed, changed: fixed !== code };
  }

  function canFix(issues) {
    return issues.some(i => /xss|innerhtml/i.test(i.title));
  }

  return { fix, canFix };
})();
