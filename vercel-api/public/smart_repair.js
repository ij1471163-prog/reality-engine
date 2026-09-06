// ═══════════════════════════════════════════════════════
// smart_repair.js v1.0 — المحرك الذكي
// يفهم السياق ويصلح بدقة بدون تعارض
// ═══════════════════════════════════════════════════════

var SmartRepairEngine = (() => {

  // ─── Context Extractor ────────────────────────────────
  // يفهم الكود قبل ما يصلح
  function extractContext(code, fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const lines = code.split('\n');
    const ctx = {
      ext,
      vars: new Map(),      // varName → { line, value, type }
      imports: new Set(),   // import names
      functions: new Map(), // funcName → { line, params }
      sqlVars: new Map(),   // varName → { line, params, query }
    };

    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('#')) return;

      // ─── Python imports ──────────────────────────────
      const pyImport = t.match(/^import\s+(\w+)|^from\s+(\w+)\s+import/);
      if (pyImport) ctx.imports.add(pyImport[1] || pyImport[2]);

      // ─── JS/TS imports ───────────────────────────────
      const jsImport = t.match(/require\(['"](\w+)['"]\)|import.*from\s+['"](\w+)['"]/);
      if (jsImport) ctx.imports.add(jsImport[1] || jsImport[2]);

      // ─── Variables ───────────────────────────────────
      const varJS = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*(.+)/);
      if (varJS) ctx.vars.set(varJS[1], { line: i, value: varJS[2], type: inferType(varJS[2]) });

      const varPY = t.match(/^([a-zA-Z_]\w*)\s*=\s*(.+)/);
      if (varPY && !['if','for','while','return','class','def'].some(k => t.startsWith(k)))
        ctx.vars.set(varPY[1], { line: i, value: varPY[2], type: inferType(varPY[2]) });

      // ─── Functions ───────────────────────────────────
      const funcJS = t.match(/(?:function\s+(\w+)|(?:const|let)\s+(\w+)\s*=.*=>)\s*\(([^)]*)\)/);
      if (funcJS) ctx.functions.set(funcJS[1] || funcJS[2], { line: i, params: funcJS[3].split(',').map(p => p.trim()) });

      const funcPY = t.match(/^def\s+(\w+)\s*\(([^)]*)\)/);
      if (funcPY) ctx.functions.set(funcPY[1], { line: i, params: funcPY[2].split(',').map(p => p.trim()) });

      // ─── SQL Variables ───────────────────────────────
      if (/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(t) && /\+/.test(t)) {
        const sqlVarM = t.match(/(\w+)\s*=/);
        if (sqlVarM) {
          const params = [];
          t.replace(/\+\s*(\w+)\b/g, (_, p) => {
            if (!/^(?:SELECT|INSERT|UPDATE|DELETE|WHERE|AND|OR|FROM|JOIN|SET|LIKE)$/i.test(p))
              params.push(p);
          });
          const queryM = t.match(/["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*)["']/i);
          ctx.sqlVars.set(sqlVarM[1], {
            line: i,
            params,
            query: queryM ? queryM[1] : '',
          });
        }
      }
    });

    return ctx;
  }

  function inferType(value) {
    if (!value) return 'unknown';
    if (/^\d+$/.test(value)) return 'number';
    if (/^["']/.test(value)) return 'string';
    if (/^(true|false)$/.test(value)) return 'boolean';
    if (/^\[/.test(value)) return 'array';
    if (/^\{/.test(value)) return 'object';
    if (/^null$/.test(value)) return 'null';
    return 'unknown';
  }

  // ─── Smart Fixers ─────────────────────────────────────

  // 1. SQL Injection — يفهم السياق ويصلح بدقة
  function fixSQL(code, ctx) {
    const lines = code.split('\n');
    let changed = false;
    const repairs = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('#')) continue;

      // ─── Python ────────────────────────────────────
      if (ctx.ext === 'py') {
        // يكتشف SQL concat في Python
        if (/["'].*(?:SELECT|INSERT|UPDATE|DELETE).*["'].*\+/.test(t) && !/cursor|execute/.test(t)) {
          const varM = t.match(/(\w+)\s*=/);
          if (!varM) continue;
          const varName = varM[1];
          const indent = ' '.repeat(line.search(/\S/));

          // استخرج params من السياق
          const sqlInfo = ctx.sqlVars.get(varName);
          const params = sqlInfo?.params || [];
          if (!params.length) continue;

          // بناء query نظيف
          const queryM = t.match(/["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*?)["']/i);
          if (!queryM) continue;
          let q = queryM[1].replace(/='\s*$/, '=?').replace(/'\s*$/, '?').trim();
          if (!q.includes('?')) q += '?';

          // احذف cursor.execute القديم
          let j = i + 1;
          while (j < lines.length && /cursor.*conn\.execute|conn\.execute|return cursor/.test(lines[j]))
            lines.splice(j, 1);

          lines[i] = `${indent}${varName} = "${q}"`;
          lines.splice(i + 1, 0, `${indent}cursor = conn.cursor()`);
          lines.splice(i + 2, 0, `${indent}cursor.execute(${varName}, (${params.join(', ')},))`);
          lines.splice(i + 3, 0, `${indent}return cursor.fetchall()`);
          repairs.push({ line: i + 1, fix: `${varName} → parameterized (${params.join(', ')})` });
          changed = true;
          i += 4;
        }
      }

      // ─── JS/TS ─────────────────────────────────────
      if (ctx.ext === 'js' || ctx.ext === 'ts') {
        // يكتشف SQL + concatenation
        if (/["'].*(?:SELECT|INSERT|UPDATE|DELETE).*["']/.test(t) && /\+\s*\w+/.test(t)) {
          const params = [];
          const fixedLine = t.replace(/"([^"]*)"\s*\+\s*(\w+)/g, (_, q, p) => {
            params.push(p); return `"${q}?"`;
          });
          if (fixedLine !== t && params.length) {
            const indent = ' '.repeat(line.search(/\S/));
            lines[i] = indent + fixedLine;
            repairs.push({ line: i + 1, fix: `JS SQL → parameterized [${params.join(', ')}]` });
            changed = true;
          }
        }

        // يكتشف db.query(queryVar, callback) بدون params
        const dbM = t.match(/(?:db|conn|pool|client)\.query\s*\(\s*(\w+)\s*,\s*function/);
        if (dbM) {
          const queryVar = dbM[1];
          const sqlInfo = ctx.sqlVars.get(queryVar);
          if (sqlInfo && sqlInfo.params.length) {
            const indent = ' '.repeat(line.search(/\S/));
            lines[i] = indent + t.replace(
              /(?:db|conn|pool|client)\.query\s*\((\w+)\s*,\s*function/,
              `db.query($1, [${sqlInfo.params.join(', ')}], function`
            );
            repairs.push({ line: i + 1, fix: `db.query + [${sqlInfo.params.join(', ')}]` });
            changed = true;
          }
        }
      }

      // ─── PHP ───────────────────────────────────────
      if (ctx.ext === 'php') {
        const m = t.match(/\$(\w+)\s*=\s*["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*?)["']\s*\.\s*\$(\w+)/i);
        if (m) {
          const indent = ' '.repeat(line.search(/\S/));
          lines[i] = `${indent}$stmt = $conn->prepare("${m[2]}?");`;
          lines.splice(i + 1, 0, `${indent}$stmt->bind_param("s", $${m[3]});`);
          lines.splice(i + 2, 0, `${indent}$stmt->execute();`);
          lines.splice(i + 3, 0, `${indent}$result = $stmt->get_result();`);
          repairs.push({ line: i + 1, fix: 'PHP SQL → prepared statement' });
          changed = true;
          i += 4;
        }
      }
    }

    return { fixed: changed ? lines.join('\n') : code, repairs };
  }

  // 2. Command Injection — يفهم os.system بكل أشكاله
  function fixCommandInjection(code, ctx) {
    let fixed = code;
    const repairs = [];

    if (ctx.ext === 'py') {
      const before = fixed;

      // os.system("cmd " + var)
      fixed = fixed.replace(
        /os\.system\s*\(\s*["']([^"']+)["']\s*\+\s*(\w+)\s*\)/g,
        'subprocess.run(shlex.split("$1" + $2), check=True, capture_output=True)'
      );
      // os.system(var)
      fixed = fixed.replace(
        /os\.system\s*\(\s*(\w+)\s*\)/g,
        'subprocess.run(shlex.split($1), check=True, capture_output=True)'
      );
      // subprocess.call(..., shell=True)
      fixed = fixed.replace(
        /subprocess\.call\s*\(([^,]+),\s*shell\s*=\s*True\s*\)/g,
        'subprocess.run(shlex.split($1), check=True, capture_output=True)'
      );

      if (fixed !== before) {
        if (!fixed.includes('import subprocess'))
          fixed = 'import subprocess\nimport shlex\n' + fixed;
        else if (!fixed.includes('import shlex'))
          fixed = fixed.replace('import subprocess', 'import subprocess\nimport shlex');
        repairs.push({ fix: 'Command Injection → subprocess.run' });
      }
    }

    return { fixed, repairs };
  }

  // 3. Secrets — يتجنب SQL variables
  function fixSecrets(code, ctx) {
    const lines = code.split('\n');
    let changed = false;
    const repairs = [];
    const SQL_VARS = /^(?:query|sql|stmt|cursor|q)$/i;

    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('#')) return;

      if (ctx.ext === 'py') {
        const m = t.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*["'][^"']{6,}["']/);
        if (m && !SQL_VARS.test(m[1]) && !ctx.sqlVars.has(m[1]) && !t.includes('os.environ')) {
          const indent = ' '.repeat(line.search(/\S/));
          lines[i] = `${indent}${m[1]} = os.environ.get('${m[1]}', '')`;
          repairs.push({ line: i + 1, fix: `${m[1]} → os.environ` });
          changed = true;
        }
      }

      if (ctx.ext === 'js' || ctx.ext === 'ts') {
        const m = t.match(/(?:const|let|var)\s+(\w+(?:KEY|SECRET|TOKEN|PASSWORD|PASS)\w*)\s*=\s*["'][^"']{8,}["']/i);
        if (m && !SQL_VARS.test(m[1]) && !t.includes('process.env')) {
          lines[i] = line.replace(/=\s*["'][^"']+["']/, `= process.env.${m[1]}`);
          repairs.push({ line: i + 1, fix: `${m[1]} → process.env` });
          changed = true;
        }
      }
    });

    let fixed = changed ? lines.join('\n') : code;
    if (ctx.ext === 'py' && changed && !fixed.includes('import os'))
      fixed = 'import os\n' + fixed;

    return { fixed, repairs };
  }

  // 4. JWT — يصلح secret + يضيف expiry
  function fixJWT(code, ctx) {
    let fixed = code;
    const repairs = [];
    const before = fixed;

    if (ctx.ext === 'js' || ctx.ext === 'ts') {
      fixed = fixed.replace(
        /((?:const|let|var)\s+(?:JWT_SECRET|jwtSecret|JWT_KEY))\s*=\s*["'][^"']+["']/g,
        '$1 = process.env.JWT_SECRET'
      );
      fixed = fixed.replace(
        /jwt\.sign\s*\(([^,]+),\s*["'][^"']+["']\s*\)/g,
        "jwt.sign($1, process.env.JWT_SECRET, { expiresIn: '1h' })"
      );
      fixed = fixed.replace(
        /jwt\.sign\s*\(([^,]+),\s*process\.env\.JWT_SECRET\s*\)(?!\s*,\s*\{)/g,
        "jwt.sign($1, process.env.JWT_SECRET, { expiresIn: '1h' })"
      );
    }

    if (fixed !== before) repairs.push({ fix: 'JWT → process.env + expiresIn' });
    return { fixed, repairs };
  }

  // 5. eval — يصلح بأمان
  function fixEval(code, ctx) {
    let fixed = code;
    const repairs = [];
    const before = fixed;

    if (ctx.ext === 'js' || ctx.ext === 'ts') {
      fixed = fixed.replace(/\beval\s*\(([^)]+)\)/g, (_, arg) =>
        /json|data|response|result/i.test(arg)
          ? `JSON.parse(${arg.trim()})`
          : `/* SECURITY: eval removed — validate ${arg.trim()} */`
      );
      fixed = fixed.replace(
        /new\s+Function\s*\([^)]*\)\s*\(\)/g,
        '/* SECURITY: new Function removed */'
      );
    } else if (ctx.ext === 'py') {
      fixed = fixed.replace(/\beval\s*\(/g, 'ast.literal_eval(');
      if (fixed !== before && !fixed.includes('import ast'))
        fixed = 'import ast\n' + fixed;
    }

    if (fixed !== before) repairs.push({ fix: 'eval → safe alternative' });
    return { fixed, repairs };
  }

  // 6. XSS
  function fixXSS(code, ctx) {
    let fixed = code;
    const repairs = [];
    const before = fixed;

    if (ctx.ext === 'js' || ctx.ext === 'ts') {
      fixed = fixed
        .replace(/\.innerHTML\s*=/g, '.textContent =')
        .replace(/\.outerHTML\s*=/g, '.textContent =');
    }

    if (fixed !== before) repairs.push({ fix: 'innerHTML → textContent' });
    return { fixed, repairs };
  }

  // ─── Main Repair Function ─────────────────────────────
  function repair(code, fileName, issues) {
    const ctx = extractContext(code, fileName);
    let fixed = code;
    const allRepairs = [];

    const titles = issues.map(i => (i.title || '').toLowerCase()).join(' ');

    // رتّب الإصلاحات: secrets أولاً، SQL ثانياً
    const fixOrder = [
      { check: /secret|مكشوف|password|api.key/i, fn: fixSecrets },
      { check: /sql|injection/i, fn: fixSQL },
      { check: /command|os\.system/i, fn: fixCommandInjection },
      { check: /jwt/i, fn: fixJWT },
      { check: /eval/i, fn: fixEval },
      { check: /xss|innerhtml/i, fn: fixXSS },
    ];

    fixOrder.forEach(({ check, fn }) => {
      if (!check.test(titles)) return;
      const { fixed: newFixed, repairs } = fn(fixed, ctx);
      if (newFixed !== fixed) {
        fixed = newFixed;
        allRepairs.push(...repairs);
        // أعد استخراج context بعد كل إصلاح
        Object.assign(ctx, extractContext(fixed, fileName));
      }
    });

    return { fixed, repairs: allRepairs };
  }

  // ─── Apply to All Files ───────────────────────────────
  function applySmartRepair(F, R) {
    const results = {};
    let totalFixed = 0;

    Object.keys(F).forEach(fn => {
      const issues = R[fn]?.issues || [];
      if (!issues.length) return;

      const { fixed, repairs } = repair(F[fn], fn, issues);

      if (repairs.length > 0 && fixed !== F[fn]) {
        F[fn] = fixed;
        R[fn] = { code: fixed, issues: typeof analyzeCode === 'function' ? analyzeCode(fixed, fn) : [] };
        totalFixed += repairs.length;
        results[fn] = repairs;
      }
    });

    return { totalFixed, results };
  }

  return { repair, applySmartRepair };
})();
