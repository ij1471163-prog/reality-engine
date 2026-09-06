// ═══════════════════════════════════════════════════════
// jwt_fix.js v1.0
// متخصص بإصلاح JWT Weak Secret + Missing Expiry
// ═══════════════════════════════════════════════════════
"use strict";

const JWTFixer = (() => {

  function fixJS(code) {
    let fixed = code;

    // hardcoded secret → process.env
    fixed = fixed.replace(
      /((?:const|let|var)\s+(?:JWT_SECRET|jwtSecret|JWT_KEY|jwt_secret))\s*=\s*["'][^"']+["']/g,
      '$1 = process.env.JWT_SECRET'
    );

    // jwt.sign بـ hardcoded secret بدون expiry
    fixed = fixed.replace(
      /jwt\.sign\s*\(([^,]+),\s*["'][^"']+["']\s*\)/g,
      "jwt.sign($1, process.env.JWT_SECRET, { expiresIn: '1h' })"
    );

    // jwt.sign بـ process.env بدون expiry
    fixed = fixed.replace(
      /jwt\.sign\s*\(([^,]+),\s*process\.env\.JWT_SECRET\s*\)(?!\s*,\s*\{)/g,
      "jwt.sign($1, process.env.JWT_SECRET, { expiresIn: '1h' })"
    );

    // jwt.verify بـ hardcoded secret
    fixed = fixed.replace(
      /jwt\.verify\s*\(([^,]+),\s*["'][^"']+["']\s*\)/g,
      'jwt.verify($1, process.env.JWT_SECRET)'
    );

    return fixed;
  }

  function fixPython(code) {
    let fixed = code;
    fixed = fixed.replace(
      /(SECRET_KEY|JWT_SECRET|jwt_secret)\s*=\s*["'][^"']+["']/g,
      (_, name) => `${name} = os.environ.get('${name}', '')`
    );
    if (fixed !== code && !fixed.includes('import os'))
      fixed = 'import os\n' + fixed;
    return fixed;
  }

  function fixJava(code) {
    return code.replace(
      /Jwts\.builder\(\)([^;]+)signWith\s*\(\s*SignatureAlgorithm\.\w+,\s*["'][^"']+["']\)/g,
      (m) => m.replace(/["'][^"']+["']/, 'System.getenv("JWT_SECRET")')
    );
  }

  function fix(code, fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    let fixed = code;
    if (ext === 'js' || ext === 'ts') fixed = fixJS(fixed);
    else if (ext === 'py') fixed = fixPython(fixed);
    else if (ext === 'java') fixed = fixJava(fixed);
    return { fixed, changed: fixed !== code };
  }

  function canFix(issues) {
    return issues.some(i => /jwt/i.test(i.title));
  }

  return { fix, canFix };
})();
