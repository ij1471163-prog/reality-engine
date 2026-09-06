// ═══════════════════════════════════════════════════════
// sql_injection_fix.js v1.0
// متخصص بإصلاح SQL Injection في كل اللغات
// ═══════════════════════════════════════════════════════
"use strict";

const SQLInjectionFixer = (() => {

  function fixPython(code) {
    const lines = code.split('\n');
    let changed = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('#')) continue;
      if (!/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(line)) continue;
      if (!/["'].*\+|\+.*["']/.test(line)) continue;
      if (/cursor|execute|prepare/.test(line)) continue;

      const varM = line.match(/(\w+)\s*=/);
      if (!varM) continue;
      const [, varName] = varM;
      const indent = ' '.repeat(line.search(/\S/));

      const params = [];
      line.replace(/\+\s*(\w+)\b/g, (_, p) => {
        if (!/^(?:SELECT|INSERT|UPDATE|DELETE|WHERE|AND|OR|FROM|JOIN|SET)$/i.test(p)) params.push(p);
      });
      if (!params.length) continue;

      const qM = line.match(/["']([^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*?)["']/i);
      if (!qM) continue;

      let q = qM[1].replace(/='\s*$/, '=?').replace(/'\s*$/, '?').trim();
      if (!q.includes('?')) q += '?';

      // احذف cursor/execute القديم
      let j = i + 1;
      while (j < lines.length && /cursor.*conn\.execute|conn\.execute|return cursor/.test(lines[j]))
        lines.splice(j, 1);

      lines[i] = `${indent}${varName} = "${q}"`;
      lines.splice(i + 1, 0, `${indent}cursor = conn.cursor()`);
      lines.splice(i + 2, 0, `${indent}cursor.execute(${varName}, (${params.join(', ')},))`);
      lines.splice(i + 3, 0, `${indent}return cursor.fetchall()`);
      changed = true; i += 4;
    }

    return changed ? lines.join('\n') : code;
  }

  function fixJS(code) {
    const lines = code.split('\n');
    let changed = false;

    lines.forEach((line, i) => {
      if (line.trim().startsWith('//')) return;
      if (!/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(line)) return;
      const params = [];
      const fixedLine = line.replace(/"([^"]*)"\s*\+\s*(\w+)/g, (_, q, p) => {
        params.push(p); return `"${q}?"`;
      });
      if (fixedLine !== line && params.length) {
        lines[i] = fixedLine.replace(/\);\s*$/, `, [${params.join(', ')}]);`);
        changed = true;
      }
    });

    return changed ? lines.join('\n') : code;
  }

  function fixPHP(code) {
    const lines = code.split('\n');
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
      changed = true; i += 4;
    }

    return changed ? lines.join('\n') : code;
  }

  function fixCSharp(code) {
    let fixed = code;
    const m = code.match(/"([^"]+)"\s*\+\s*(\w+)/);
    if (!m) return code;
    fixed = fixed.replace(/"([^"]+)"\s*\+\s*(\w+)/, '"$1@param"');
    const insertPoint = fixed.indexOf('SqlCommand');
    if (insertPoint > 0) {
      const lineEnd = fixed.indexOf('\n', insertPoint);
      fixed = fixed.slice(0, lineEnd + 1) +
        `    cmd.Parameters.AddWithValue("@param", ${m[2]});\n` +
        fixed.slice(lineEnd + 1);
    }
    return fixed;
  }

  function fixJava(code) {
    return code.replace(
      /("SELECT[^"]+WHERE\s+\w+\s*=\s*)"?\s*\+\s*(\w+)/g,
      '"$1?"'
    );
  }

  // صلح db.query(query, callback) → db.query(query, [params], callback)
  function fixDBQuery(code) {
    return code.replace(
      /db\.query\s*\(\s*(\w+)\s*,\s*function/g,
      'db.query($1, [/* add params */], function'
    );
  }

  function fix(code, fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    let fixed = code;
    if (ext === 'py') fixed = fixPython(fixed);
    else if (ext === 'js' || ext === 'ts') fixed = fixJS(fixed);
    else if (ext === 'php') fixed = fixPHP(fixed);
    else if (ext === 'cs') fixed = fixCSharp(fixed);
    else if (ext === 'java') fixed = fixJava(fixed);
    return { fixed, changed: fixed !== code };
  }

  function canFix(issues) {
    return issues.some(i => /sql/i.test(i.title));
  }

  return { fix, canFix };
})();
