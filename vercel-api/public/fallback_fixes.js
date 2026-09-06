// ═══════════════════════════════════════════════════════
// fallback_fixes.js v1.0 — الخط الثاني للإصلاح
// يعمل لما repair_engine يفشل أو AI ما يشتغل
// ═══════════════════════════════════════════════════════

"use strict";

// ─── Main fallbackFix ─────────────────────────────────
function fallbackFix(code, fileName, issues) {
  const ext = fileName.split('.').pop().toLowerCase();
  let fixed = code;
  const repairs = [];

  // صلح حسب المشاكل المكتشفة
  issues.forEach(issue => {
    const t = (issue.title || '').toLowerCase();
    const ln = (issue.line || 1) - 1;
    const lines = fixed.split('\n');

    // ─── Command Injection ────────────────────────────
    if (t.includes('command') || t.includes('os.system')) {
      if (ext === 'py') {
        fixed = fallbackCommandInjection(fixed);
        repairs.push({ line: issue.line, title: issue.title, fix: 'subprocess.run' });
      }
    }

    // ─── TypeScript any ───────────────────────────────
    else if (t.includes('any') && ext === 'ts') {
      const line = lines[ln];
      if (line) {
        const newLine = fallbackFixAny(line);
        if (newLine !== line) {
          lines[ln] = newLine;
          fixed = lines.join('\n');
          repairs.push({ line: issue.line, title: issue.title, fix: 'unknown/specific type' });
        }
      }
    }

    // ─── Optional Chaining ────────────────────────────
    else if (t.includes('optional') || t.includes('chaining') || t.includes('?.')) {
      if (ext === 'ts' || ext === 'js') {
        const line = lines[ln];
        if (line) {
          const newLine = fallbackFixOptional(line);
          if (newLine !== line) {
            lines[ln] = newLine;
            fixed = lines.join('\n');
            repairs.push({ line: issue.line, title: issue.title, fix: 'optional chaining ?.' });
          }
        }
      }
    }

    // ─── JWT Weak Secret ─────────────────────────────
    else if (t.includes('jwt')) {
      fixed = fallbackFixJWT(fixed, ext);
      repairs.push({ line: issue.line, title: issue.title, fix: 'process.env.JWT_SECRET' });
    }

    // ─── count unused ─────────────────────────────────
    else if (t.includes('count') && t.includes('مستخدم')) {
      // false positive — تجاهل
    }
  });

  return { fixed, repairs };
}

// ─── Command Injection Fix ────────────────────────────
function fallbackCommandInjection(code) {
  let fixed = code;

  // os.system("cmd " + var) → subprocess.run(shlex.split(...))
  fixed = fixed.replace(
    /os\.system\s*\(\s*["']([^"']+)["']\s*\+\s*(\w+)\s*\)/g,
    'subprocess.run(shlex.split("$1" + $2), check=True, capture_output=True)'
  );

  // os.system(var) → subprocess.run(shlex.split(var))
  fixed = fixed.replace(
    /os\.system\s*\(\s*(\w+)\s*\)/g,
    'subprocess.run(shlex.split($1), check=True, capture_output=True)'
  );

  // os.system("string") → subprocess.run(["string"])
  fixed = fixed.replace(
    /os\.system\s*\(\s*["']([^"']+)["']\s*\)/g,
    'subprocess.run(["$1"], check=True, capture_output=True)'
  );

  // أضف imports لو ما موجودة
  if (fixed !== code) {
    if (!fixed.includes('import subprocess'))
      fixed = 'import subprocess\nimport shlex\n' + fixed;
    else if (!fixed.includes('import shlex'))
      fixed = fixed.replace('import subprocess', 'import subprocess\nimport shlex');
  }

  return fixed;
}

// ─── TypeScript any Fix ───────────────────────────────
function fallbackFixAny(line) {
  // var name: any = 0 → number
  let fixed = line;

  // number literals
  if (/:\s*any\s*=\s*\d+/.test(fixed))
    fixed = fixed.replace(/:\s*any\b/, ': number');

  // string literals
  else if (/:\s*any\s*=\s*["']/.test(fixed))
    fixed = fixed.replace(/:\s*any\b/, ': string');

  // boolean literals
  else if (/:\s*any\s*=\s*(true|false)/.test(fixed))
    fixed = fixed.replace(/:\s*any\b/, ': boolean');

  // null assignment
  else if (/:\s*any\s*=\s*null/.test(fixed))
    fixed = fixed.replace(/:\s*any\b/, ': unknown');

  // array literal
  else if (/:\s*any\s*=\s*\[/.test(fixed))
    fixed = fixed.replace(/:\s*any\b/, ': unknown[]');

  // function param
  else if (/\(.*:\s*any.*\)/.test(fixed))
    fixed = fixed.replace(/:\s*any\b/g, ': unknown');

  // default fallback
  else
    fixed = fixed.replace(/:\s*any\b/g, ': unknown');

  return fixed;
}

// ─── Optional Chaining Fix ────────────────────────────
function fallbackFixOptional(line) {
  // STRIPE_KEY: any = "..." — مو optional chaining
  if (line.includes('=')) return line;

  // const x: any — استبدل any
  if (/:\s*any/.test(line)) {
    return line.replace(/:\s*any\b/g, ': unknown');
  }

  // لو السطر فيه property access بدون ?.
  // مثل: const x = obj.prop.value
  let fixed = line;

  // استبدل a.b.c بـ a?.b?.c (بحذر)
  // فقط لو في assignment أو return
  if (/=\s*\w+\.\w+\.\w+/.test(fixed)) {
    fixed = fixed.replace(
      /=\s*(\w+)\.(\w+)\.(\w+)/g,
      '= $1?.$2?.$3'
    );
  }

  return fixed;
}

// ─── JWT Fix ──────────────────────────────────────────
function fallbackFixJWT(code, ext) {
  let fixed = code;

  if (ext === 'js' || ext === 'ts') {
    // const JWT_SECRET = "weak"
    fixed = fixed.replace(
      /(?:const|let|var)\s+(JWT_SECRET|jwtSecret|JWT_KEY)\s*=\s*["'][^"']+["']/g,
      'const $1 = process.env.$1'
    );
    // jwt.sign(payload, "weak")
    fixed = fixed.replace(
      /jwt\.sign\s*\(([^,]+),\s*["'][^"']+["']/g,
      'jwt.sign($1, process.env.JWT_SECRET'
    );
    // jwt.verify(token, "weak")
    fixed = fixed.replace(
      /jwt\.verify\s*\(([^,]+),\s*["'][^"']+["']/g,
      'jwt.verify($1, process.env.JWT_SECRET'
    );
  }

  return fixed;
}

// ─── تطبيق Fallback على كل ملفات الـ ZIP ─────────────
function applyFallbackToAll(F, R) {
  const results = {};
  let totalFixed = 0;

  Object.keys(F).forEach(fn => {
    const issues = R[fn]?.issues || [];
    if (!issues.length) return;

    const { fixed, repairs } = fallbackFix(F[fn], fn, issues);

    if (repairs.length > 0 && fixed !== F[fn]) {
      F[fn] = fixed;
      R[fn] = { code: fixed, issues: typeof analyzeCode === 'function' ? analyzeCode(fixed, fn) : [] };
      totalFixed += repairs.length;
      results[fn] = repairs;
    }
  });

  return { totalFixed, results };
}
