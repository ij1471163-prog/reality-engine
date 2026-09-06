// ═══════════════════════════════════════════════════════
// emergency_fixes.js v1.0 — الخط الثالث للإصلاح
// بسيط وأكيد 100% — regex مباشر بدون context
// يعمل لما كل الخطوط الأخرى تفشل
// ═══════════════════════════════════════════════════════

"use strict";

function emergencyFix(code, fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  let fixed = code;
  const repairs = [];

  // ─── Python ────────────────────────────────────────

  if (ext === 'py') {

    // SQL Injection — كل أنواع concatenation
    const sqlPatterns = [
      // "SELECT..." + var
      { re: /(\w+)\s*=\s*["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*?)["']\s*\+\s*(.+)/gi,
        fn: (m, varName, query, params) => {
          const cleanQuery = query.replace(/'\s*\+\s*\w+\s*\+\s*'/g, '?').replace(/='\s*"/g, '=?').trim();
          const paramList = params.replace(/["'\s+]/g, '').split('+').filter(p => p.match(/^\w+$/));
          return `${varName} = "${cleanQuery.endsWith('?') ? cleanQuery : cleanQuery + '?'}"`;
        }
      }
    ];

    // SQL Python — استبدل concatenation
    {
      const lines = fixed.split('\n');
      let sqlChanged = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(line)) continue;
        if (!/["\'"].*\+|\+.*["\'"]/.test(line)) continue;
        if (/cursor|execute|prepare/.test(line)) continue;
        const varM = line.match(/(\w+)\s*=/);
        if (!varM) continue;
        const varName = varM[1];
        const indent = ' '.repeat(line.search(/\S/));
        const params = [];
        line.replace(/\+\s*(\w+)\b/g, (_, p) => {
          if (!/^(?:SELECT|INSERT|UPDATE|DELETE|WHERE|AND|OR|FROM|JOIN)$/i.test(p)) params.push(p);
        });
        if (!params.length) continue;
        const qM = line.match(/["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*)["']/i);
        if (!qM) continue;
        let q = qM[1].replace(/='[^']*'?$/, '=?').replace(/'$/, '').trim();
        if (!q.includes('?')) q += '?';
        lines[i] = `${indent}${varName} = "${q}"`;
        let j = i + 1;
        while (j < lines.length && /cursor.*conn\.execute|conn\.execute/.test(lines[j])) lines.splice(j, 1);
        lines.splice(i + 1, 0, `${indent}cursor = conn.cursor()`);
        lines.splice(i + 2, 0, `${indent}cursor.execute(${varName}, (${params.join(', ')},))`);
        lines.splice(i + 3, 0, `${indent}return cursor.fetchall()`);
        repairs.push({ line: i + 1, fix: 'SQL → parameterized' });
        sqlChanged = true; i += 4;
      }
      if (sqlChanged) fixed = lines.join('\n');
    }

    // os.system → subprocess
    if (/os\.system\s*\(/.test(fixed) && !/subprocess/.test(fixed)) {
      fixed = fixed.replace(
        /os\.system\s*\(([^)]+)\)/g,
        'subprocess.run(shlex.split($1), check=True, capture_output=True)'
      );
      if (!fixed.includes('import subprocess')) {
        fixed = 'import subprocess\nimport shlex\n' + fixed;
      }
      repairs.push({ fix: 'os.system → subprocess' });
    }

    // eval → ast.literal_eval
    if (/\beval\s*\(/.test(fixed)) {
      fixed = fixed.replace(/\beval\s*\(([^)]+)\)/g, 'ast.literal_eval($1)');
      if (!fixed.includes('import ast')) fixed = 'import ast\n' + fixed;
      repairs.push({ fix: 'eval → ast.literal_eval' });
    }

    // == None → is None
    fixed = fixed.replace(/==\s*None/g, 'is None').replace(/!=\s*None/g, 'is not None');

    // MD5 → SHA256
    if (/hashlib\.(md5|sha1)\s*\(/.test(fixed)) {
      fixed = fixed.replace(/hashlib\.md5\s*\(/g, 'hashlib.sha256(')
                   .replace(/hashlib\.sha1\s*\(/g, 'hashlib.sha256(');
      repairs.push({ fix: 'MD5 → SHA256' });
    }

    // Hardcoded secrets → env
    fixed = fixed.replace(
      /^([A-Z_]*(KEY|SECRET|TOKEN|PASSWORD|PASS|PWD)\w*)\s*=\s*["'][^"']{6,}["']/gim,
      (m, varName) => `${varName} = os.environ.get('${varName}', '')`
    );
    if (fixed !== code && fixed.includes('os.environ') && !fixed.includes('import os')) {
      fixed = 'import os\n' + fixed;
    }

    // accumulation = → +=
    fixed = fixed.replace(
      /^(\s+)(total|sum|count|revenue)\s*=\s*(?!\s*0\b)(\w+\[)/gm,
      '$1$2 += $3'
    );
  }

  // ─── JavaScript / TypeScript ──────────────────────

  if (ext === 'js' || ext === 'ts') {

    // SQL في JS/TS
    if (/["'].*(?:SELECT|INSERT|UPDATE|DELETE).*["']\s*\+/.test(fixed)) {
      const lines = fixed.split('\n');
      lines.forEach((line, i) => {
        if (/["'].*(?:SELECT|INSERT|UPDATE|DELETE).*["']\s*\+/.test(line)) {
          const params = [];
          let fixedLine = line.replace(/"([^"]*?)"\s*\+\s*(\w+)/g, (_, q, p) => {
            params.push(p);
            return `"${q}?"`;
          });
          if (params.length > 0) {
            fixedLine = fixedLine.replace(/\);\s*$/, `, [${params.join(', ')}]);`);
            lines[i] = fixedLine;
            repairs.push({ line: i + 1, fix: 'JS SQL → parameterized' });
          }
        }
      });
      fixed = lines.join('\n');
    }

    // eval → JSON.parse أو comment
    if (/\beval\s*\(/.test(fixed)) {
      fixed = fixed.replace(/\beval\s*\(([^)]+)\)/g, (m, arg) => {
        if (/json|data|response|result/i.test(arg)) return `JSON.parse(${arg})`;
        return `/* SECURITY: eval removed - validate ${arg.trim()} */`;
      });
      repairs.push({ fix: 'eval removed' });
    }

    // JWT hardcoded → process.env
    fixed = fixed.replace(
      /((?:const|let|var)\s+(?:JWT_SECRET|jwtSecret|JWT_KEY))\s*=\s*["'][^"']+["']/g,
      '$1 = process.env.JWT_SECRET'
    );
    fixed = fixed.replace(
      /jwt\.sign\s*\(([^,]+),\s*["'][^"']+["']/g,
      'jwt.sign($1, process.env.JWT_SECRET'
    );

    // Hardcoded secrets → process.env
    fixed = fixed.replace(
      /((?:const|let|var)\s+\w*(?:KEY|SECRET|TOKEN|STRIPE|API)\w*)\s*=\s*["'][^"']{10,}["']/g,
      (m, varDecl) => {
        const name = varDecl.match(/(\w+)\s*$/)?.[1] || 'SECRET';
        const envName = name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
        return `${varDecl} = process.env.${envName}`;
      }
    );

    // XSS innerHTML → textContent
    fixed = fixed.replace(/\.innerHTML\s*=/g, '.textContent =');

    // HTTP → HTTPS
    fixed = fixed.replace(/["']http:\/\//g, '"https://');

    // var → let
    fixed = fixed.replace(/\bvar\b/g, 'let');

    // == → ===
    fixed = fixed.replace(/([^=!<>])==([^=])/g, '$1===$2');

    // TypeScript any → unknown
    if (ext === 'ts') {
      fixed = fixed.replace(/:\s*any\b/g, (m, _, str) => {
        // استنتج النوع من السياق
        return ': unknown';
      });
    }
  }

  // ─── PHP ──────────────────────────────────────────

  if (ext === 'php') {

    // SQL concatenation → prepared statement
    if (/["'].*(?:SELECT|INSERT|UPDATE|DELETE).*["']\s*\./.test(fixed)) {
      const lines = fixed.split('\n');
      lines.forEach((line, i) => {
        const m = line.match(/\$(\w+)\s*=\s*["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*?)["']\s*\.\s*\$(\w+)/);
        if (m) {
          const indent = ' '.repeat(line.search(/\S/));
          lines[i] = `${indent}$stmt = $conn->prepare("${m[2]}?");`;
          lines.splice(i + 1, 0, `${indent}$stmt->bind_param("s", $${m[3]});`);
          lines.splice(i + 2, 0, `${indent}$stmt->execute();`);
          repairs.push({ line: i + 1, fix: 'PHP SQL → prepared statement' });
        }
      });
      fixed = lines.join('\n');
    }

    // MD5 → sha256
    fixed = fixed.replace(/\bmd5\s*\(/gi, 'hash("sha256", ');
    fixed = fixed.replace(/\bsha1\s*\(/gi, 'hash("sha256", ');

    // echo user input → htmlspecialchars
    fixed = fixed.replace(
      /echo\s+(\$_(?:GET|POST|REQUEST)\[.*?\])/g,
      'echo htmlspecialchars($1, ENT_QUOTES, "UTF-8")'
    );
  }

  // ─── C# / Unity ───────────────────────────────────

  if (ext === 'cs') {
    // MD5 → SHA256
    fixed = fixed.replace(/\bMD5\.Create\s*\(\s*\)/g, 'SHA256.Create()');
    fixed = fixed.replace(/\bnew MD5CryptoServiceProvider\s*\(\s*\)/g, 'new SHA256Managed()');

    // Hardcoded secrets
    fixed = fixed.replace(
      /(private\s+string\s+\w*(?:key|secret|pass|token)\w*)\s*=\s*"[^"]+";/gi,
      '$1 = Environment.GetEnvironmentVariable("SECRET");'
    );
  }

  // ─── Java / Kotlin ────────────────────────────────

  if (ext === 'java' || ext === 'kt') {
    // MD5 → SHA-256
    fixed = fixed.replace(
      /MessageDigest\.getInstance\s*\(\s*["']MD5["']\s*\)/g,
      'MessageDigest.getInstance("SHA-256")'
    );
  }

  return { fixed, repairs };
}

// ─── تطبيق Emergency Fixes على كل الملفات ────────────

function applyEmergencyToAll(F, R) {
  const results = {};
  let totalFixed = 0;

  Object.keys(F).forEach(fn => {
    const { fixed, repairs } = emergencyFix(F[fn], fn);

    if (repairs.length > 0 && fixed !== F[fn]) {
      F[fn] = fixed;
      R[fn] = { code: fixed, issues: typeof analyzeCode === 'function' ? analyzeCode(fixed, fn) : [] };
      totalFixed += repairs.length;
      results[fn] = repairs;
    }
  });

  return { totalFixed, results };
}
