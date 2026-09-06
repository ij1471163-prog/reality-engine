// ═══════════════════════════════════════════════════════
// fallback_fixes.js v2.0 — الخط الثاني للإصلاح
// محسّن: SQL أذكى + TypeScript أدق + Optional Chaining صح
// ═══════════════════════════════════════════════════════

"use strict";

function fallbackFix(code, fileName, issues) {
  const ext = fileName.split('.').pop().toLowerCase();
  let fixed = code;
  const repairs = [];

  issues.forEach(issue => {
    const t = (issue.title || '').toLowerCase();
    const ln = (issue.line || 1) - 1;
    let lines = fixed.split('\n');

    // ─── eval / new Function ──────────────────────────
    if (t.includes('eval') || t.includes('new function')) {
      if (ext === 'js' || ext === 'ts') {
        const before = fixed;
        fixed = fallbackFixEval(fixed);
        if (fixed !== before)
          repairs.push({ line: issue.line, title: issue.title, fix: 'eval → safe alternative' });
      } else if (ext === 'py') {
        if (/\beval\s*\(/.test(fixed)) {
          fixed = fixed.replace(/\beval\s*\(/g, 'ast.literal_eval(');
          if (!fixed.includes('import ast')) fixed = 'import ast\n' + fixed;
          repairs.push({ line: issue.line, title: issue.title, fix: 'ast.literal_eval' });
        }
      }
    }

    // ─── SQL Injection ────────────────────────────────
    else if (t.includes('sql') || t.includes('injection')) {
      const before = fixed;
      fixed = fallbackFixSQL(fixed, ext);
      if (fixed !== before)
        repairs.push({ line: issue.line, title: issue.title, fix: 'parameterized query' });
    }

    // ─── Command Injection ────────────────────────────
    else if (t.includes('command') || t.includes('os.system')) {
      if (ext === 'py') {
        const before = fixed;
        fixed = fallbackCommandInjection(fixed);
        if (fixed !== before)
          repairs.push({ line: issue.line, title: issue.title, fix: 'subprocess.run' });
      }
    }

    // ─── TypeScript any ───────────────────────────────
    else if (t.includes('any') && (ext === 'ts' || ext === 'tsx')) {
      lines = fixed.split('\n');
      const line = lines[ln];
      if (line && /:\s*any\b/.test(line)) {
        lines[ln] = fallbackFixAny(line);
        if (lines[ln] !== line) {
          fixed = lines.join('\n');
          repairs.push({ line: issue.line, title: issue.title, fix: 'specific type' });
        }
      }
    }

    // ─── Optional Chaining ────────────────────────────
    else if (t.includes('optional') || t.includes('?.')) {
      // هذه false positives في الغالب — تجاهل
    }

    // ─── JWT ─────────────────────────────────────────
    else if (t.includes('jwt')) {
      const before = fixed;
      fixed = fallbackFixJWT(fixed, ext);
      if (fixed !== before)
        repairs.push({ line: issue.line, title: issue.title, fix: 'process.env.JWT_SECRET' });
    }

    // ─── count unused → تجاهل (false positive) ───────
    else if (t.includes('count') && t.includes('مستخدم')) { /* false positive */ }
    
    // ─── processInput دالة ناقصة → تجاهل (AI يتولى) ─
    else if (t.includes('دالة ناقصة') || t.includes('processInput')) { /* يحتاج AI */ }
  });

  return { fixed, repairs };
}

// ─── eval Fix ─────────────────────────────────────────
function fallbackFixEval(code) {
  let fixed = code;

  // new Function('return ' + input)() → JSON.parse
  fixed = fixed.replace(
    /new\s+Function\s*\(\s*['"]return\s*['"]\s*\+\s*([^)]+)\)\s*\(\)/g,
    (_, arg) => `JSON.parse(${arg.trim()})`
  );

  // new Function(...)() — generic
  fixed = fixed.replace(
    /new\s+Function\s*\([^)]*\)\s*\(\)/g,
    '/* eval removed — implement safe parser */'
  );

  // eval(input) → JSON.parse لو JSON، وإلا احذف
  fixed = fixed.replace(
    /\beval\s*\(([^)]+)\)/g,
    (_, arg) => /json|data|response|result/i.test(arg)
      ? `JSON.parse(${arg.trim()})`
      : `/* SECURITY: eval removed — validate ${arg.trim()} */`
  );

  return fixed;
}

// ─── SQL Fix ──────────────────────────────────────────
function fallbackFixSQL(code, ext) {
  let fixed = code;

  if (ext === 'py') {
    const lines = fixed.split('\n');
    let changed = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('#')) continue;
      if (!/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(line)) continue;
      if (!/["'].*\+|\+.*["']/.test(line)) continue;
      if (/cursor|execute|prepare/.test(line)) continue;
      if (/LIKE/i.test(line)) continue; // LIKE يتولاه emergency_fixes

      const varM = line.match(/(\w+)\s*=/);
      if (!varM) continue;
      const varName = varM[1];
      const indent = ' '.repeat(line.search(/\S/));

      // استخرج params
      const params = [];
      line.replace(/\+\s*(\w+)\b/g, (_, p) => {
        if (!/^(?:SELECT|INSERT|UPDATE|DELETE|WHERE|AND|OR|FROM|JOIN|SET|LIKE)$/i.test(p))
          params.push(p);
      });
      if (!params.length) continue;

      // بناء query نظيف
      const qM = line.match(/["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*?)["']/i);
      if (!qM) continue;
      let q = qM[1]
        .replace(/='\s*$/, '=?')
        .replace(/'\s*$/, '?')
        .replace(/="\s*$/, '=?')
        .trim();
      if (!q.includes('?')) q += '?';

      // احذف conn.execute القديم
      let j = i + 1;
      while (j < lines.length && /cursor.*conn\.execute|conn\.execute|return cursor/.test(lines[j]))
        lines.splice(j, 1);

      lines[i] = `${indent}${varName} = "${q}"`;
      lines.splice(i + 1, 0, `${indent}cursor = conn.cursor()`);
      lines.splice(i + 2, 0, `${indent}cursor.execute(${varName}, (${params.join(', ')},))`);
      lines.splice(i + 3, 0, `${indent}return cursor.fetchall()`);
      changed = true;
      i += 4;
    }

    fixed = changed ? lines.join('\n') : fixed;
  }

  if (ext === 'js' || ext === 'ts') {
    const lines = fixed.split('\n');
    let changed = false;

    lines.forEach((line, i) => {
      if (line.trim().startsWith('//')) return;
      if (!/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(line)) return;
      const params = [];
      const fl = line.replace(/"([^"]*)"\s*\+\s*(\w+)/g, (_, q, p) => {
        params.push(p); return `"${q}?"`;
      });
      if (fl !== line && params.length) {
        lines[i] = fl.replace(/\);\s*$/, `, [${params.join(', ')}]);`);
        changed = true;
      }
    });

    fixed = changed ? lines.join('\n') : fixed;
  }

  if (ext === 'php') {
    const lines = fixed.split('\n');
    let changed = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(line)) continue;
      const m = line.match(/\$(\w+)\s*=\s*["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*?)["']\s*\.\s*\$(\w+)/i);
      if (!m) continue;
      const indent = ' '.repeat(line.search(/\S/));
      lines[i] = `${indent}$stmt = $conn->prepare("${m[2]}?");`;
      lines.splice(i + 1, 0, `${indent}$stmt->bind_param("s", $${m[3]});`);
      lines.splice(i + 2, 0, `${indent}$stmt->execute();`);
      lines.splice(i + 3, 0, `${indent}$result = $stmt->get_result();`);
      changed = true;
      i += 4;
    }

    fixed = changed ? lines.join('\n') : fixed;
  }

  return fixed;
}

// ─── Command Injection Fix ────────────────────────────
function fallbackCommandInjection(code) {
  let fixed = code;

  fixed = fixed.replace(
    /os\.system\s*\(\s*["']([^"']+)["']\s*\+\s*(\w+)\s*\)/g,
    'subprocess.run(shlex.split("$1" + $2), check=True, capture_output=True)'
  );
  fixed = fixed.replace(
    /os\.system\s*\(\s*(\w+)\s*\)/g,
    'subprocess.run(shlex.split($1), check=True, capture_output=True)'
  );
  fixed = fixed.replace(
    /os\.system\s*\(\s*["']([^"']+)["']\s*\)/g,
    'subprocess.run(["$1"], check=True, capture_output=True)'
  );
  fixed = fixed.replace(
    /subprocess\.call\s*\(([^,]+),\s*shell\s*=\s*True\s*\)/g,
    'subprocess.run(shlex.split($1), check=True, capture_output=True)'
  );

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
  // استنتج النوع من القيمة
  if (/:\s*any\s*=\s*-?\d+\.?\d*/.test(line))       return line.replace(/:\s*any\b/, ': number');
  if (/:\s*any\s*=\s*["'`]/.test(line))              return line.replace(/:\s*any\b/, ': string');
  if (/:\s*any\s*=\s*(true|false)/.test(line))       return line.replace(/:\s*any\b/, ': boolean');
  if (/:\s*any\s*=\s*\[/.test(line))                 return line.replace(/:\s*any\b/, ': unknown[]');
  if (/:\s*any\s*=\s*\{/.test(line))                 return line.replace(/:\s*any\b/, ': Record<string, unknown>');
  if (/:\s*any\s*=\s*null/.test(line))               return line.replace(/:\s*any\b/, ': unknown');
  if (/:\s*any\s*=\s*new\s+(\w+)/.test(line)) {
    const cls = line.match(/new\s+(\w+)/)?.[1];
    return cls ? line.replace(/:\s*any\b/, `: ${cls}`) : line.replace(/:\s*any\b/, ': unknown');
  }
  if (/function.*\(.*:\s*any/.test(line))            return line.replace(/:\s*any\b/g, ': unknown');
  return line.replace(/:\s*any\b/g, ': unknown');
}

// ─── JWT Fix ──────────────────────────────────────────
function fallbackFixJWT(code, ext) {
  let fixed = code;

  if (ext === 'js' || ext === 'ts') {
    // hardcoded → process.env (يحافظ على const/let/var)
    fixed = fixed.replace(
      /(const|let|var)\s+(JWT_SECRET|jwtSecret|JWT_KEY|jwt_secret)\s*=\s*["'][^"']+["']/g,
      '$1 $2 = process.env.$2'
    );
    // jwt.sign بدون expiry
    fixed = fixed.replace(
      /jwt\.sign\s*\(([^,]+),\s*["'][^"']+["']\s*\)/g,
      "jwt.sign($1, process.env.JWT_SECRET, { expiresIn: '1h' })"
    );
    fixed = fixed.replace(
      /jwt\.sign\s*\(([^,]+),\s*process\.env\.JWT_SECRET\s*\)(?!\s*,\s*\{)/g,
      "jwt.sign($1, process.env.JWT_SECRET, { expiresIn: '1h' })"
    );
    // jwt.verify
    fixed = fixed.replace(
      /jwt\.verify\s*\(([^,]+),\s*["'][^"']+["']\s*\)/g,
      'jwt.verify($1, process.env.JWT_SECRET)'
    );
  } else if (ext === 'py') {
    fixed = fixed.replace(
      /(SECRET_KEY|JWT_SECRET|jwt_secret)\s*=\s*["'][^"']+["']/g,
      (_, name) => `${name} = os.environ.get('${name}', '')`
    );
    if (fixed !== code && !fixed.includes('import os')) fixed = 'import os\n' + fixed;
  }

  return fixed;
}

// ─── Apply Fallback to All Files ─────────────────────
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

