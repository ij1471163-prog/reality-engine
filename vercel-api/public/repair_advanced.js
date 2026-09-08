// ═══════════════════════════════════════════════════════
// repair_advanced.js v1.0 — إصلاح متقدم ذكي
// يصلح: Promise، Command Injection، JWT، Audit Logging
// يدعم: JS/TS/Python/PHP/Java/C#
// ═══════════════════════════════════════════════════════
"use strict";

var AdvancedRepair = (() => {

  // ─── Detect Language ──────────────────────────────
  function detectLang(fileName) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    return { js:'js', ts:'js', jsx:'js', tsx:'js',
             py:'py', php:'php', java:'java',
             cs:'cs', rb:'rb', go:'go' }[ext] || 'js';
  }

  // ─── Promise .catch() Fix ─────────────────────────
  function fixPromise(code, lang) {
    if (lang !== 'js') return code;
    const lines = code.split('\n');
    const result = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      
      // .then() بدون .catch()
      if (/\.then\s*\(/.test(t) && !/\.catch\s*\(/.test(t)) {
        // شوف الأسطر التالية
        let hasCatch = false;
        for (let j = i+1; j < Math.min(i+5, lines.length); j++) {
          if (/\.catch\s*\(/.test(lines[j])) { hasCatch = true; break; }
        }
        if (!hasCatch) {
          result.push(line);
          // أضف .catch() بعد نهاية الـ chain
          const ind = ' '.repeat(line.search(/\S/));
          if (t.endsWith(');')) {
            result[result.length-1] = line.replace(/\)\s*;$/, ')');
            result.push(`${ind}  .catch(err => console.error('Error:', err));`);
            continue;
          }
        }
      }
      result.push(line);
    }
    return result.join('\n');
  }

  // ─── Command Injection Fix ────────────────────────
  function fixCommandInjection(code, lang) {
    if (lang === 'js') {
      // exec(cmd + var) → execFile
      code = code.replace(
        /require\s*\(\s*['"]child_process['"]\s*\)\.exec\s*\(/g,
        "require('child_process').execFile("
      );
      code = code.replace(
        /exec\s*\(\s*(['"`])([^'"`]+)\1\s*\+\s*(\w+)/g,
        (m, q, cmd, v) => `execFile(${q}${cmd.trim()}${q}, [${v}]`
      );
    } else if (lang === 'py') {
      // os.system → subprocess.run
      code = code.replace(
        /os\.system\s*\(\s*["']([^"']+)["']\s*\+\s*(\w+)/g,
        (m, cmd, v) => `subprocess.run(shlex.split("${cmd}" + ${v}), check=True`
      );
      code = code.replace(
        /os\.system\s*\(\s*f["']([^"']+)\{(\w+)\}/g,
        (m, cmd, v) => `subprocess.run(shlex.split(f"${cmd}{${v}}"), check=True`
      );
      // أضف imports لو ما موجودة
      if (/subprocess\.run/.test(code) && !/import subprocess/.test(code)) {
        code = 'import subprocess\nimport shlex\n' + code;
      }
    } else if (lang === 'php') {
      code = code.replace(
        /exec\s*\(\s*\$_(GET|POST|REQUEST)\[/g,
        'exec(escapeshellarg($_$1['
      );
    }
    return code;
  }

  // ─── JWT Expiry Fix ───────────────────────────────
  function fixJWTExpiry(code, lang) {
    if (lang !== 'js') return code;
    
    // jwt.sign(payload, secret) بدون options
    code = code.replace(
      /jwt\.sign\s*\(([^,]+),\s*([^,)]+)\s*\)(?!\s*[,;]?\s*\{)/g,
      (m, payload, secret) => {
        if (m.includes('expiresIn')) return m;
        return `jwt.sign(${payload}, ${secret}, { expiresIn: '1h' })`;
      }
    );
    
    // jwt.sign مع secret ثابت
    code = code.replace(
      /jwt\.sign\s*\(([^,]+),\s*["'][^"']+["']\s*,/g,
      (m, payload) => `jwt.sign(${payload}, process.env.JWT_SECRET,`
    );
    
    return code;
  }

  // ─── Audit Logging Fix ────────────────────────────
  function fixAuditLogging(code, lang) {
    if (lang !== 'js') return code;
    
    const lines = code.split('\n');
    const result = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      
      // app.get/post/put/delete routes
      if (/app\.(get|post|put|delete|patch)\s*\(/.test(t) && !/audit|log\./.test(t)) {
        // ابحث عن callback
        let j = i;
        while (j < Math.min(i+10, lines.length)) {
          if (/\(req,\s*res\)/.test(lines[j]) || /function\s*\(req/.test(lines[j])) {
            const ind = ' '.repeat(lines[j+1]?.search(/\S/) || 4);
            result.push(lines[j]);
            if (j+1 < lines.length && lines[j+1].includes('{')) {
              result.push(lines[j+1]);
              result.push(`${ind}console.log('[AUDIT]', req.method, req.path, req.user?.id || 'anonymous');`);
              j += 2;
              break;
            }
          }
          result.push(lines[j]);
          j++;
        }
        i = j - 1;
        continue;
      }
      result.push(line);
    }
    return result.join('\n');
  }

  // ─── Promise No Catch Fix (Python) ────────────────
  function fixPythonExceptions(code) {
    // bare except → except Exception as e
    code = code.replace(
      /except\s*:/g,
      'except Exception as e:'
    );
    // empty except → log error
    code = code.replace(
      /except\s+Exception\s+as\s+(\w+)\s*:\s*\n(\s*)pass/g,
      (m, v, ind) => `except Exception as ${v}:\n${ind}    logging.error(f"Error: {${v}}")\n${ind}pass`
    );
    return code;
  }

  // ─── PHP XSS Fix ──────────────────────────────────
  function fixPHPXSS(code) {
    // echo $_GET → htmlspecialchars
    code = code.replace(
      /echo\s+\$_(GET|POST|REQUEST)\[([^\]]+)\]/g,
      (m, method, key) => `echo htmlspecialchars($_${method}[${key}], ENT_QUOTES, 'UTF-8')`
    );
    // MD5 → SHA256
    code = code.replace(/md5\s*\(/g, 'hash("sha256", ');
    return code;
  }

  // ─── Secret Fix (all languages) ───────────────────
  function fixSecrets(code, lang) {
    if (lang === 'py') {
      // SECRET_KEY = "..." → os.environ.get
      code = code.replace(
        /^(\s*)(SECRET_KEY|SECRET|DB_URL|AWS_KEY|API_KEY|DB_PASSWORD|DB_PASS)\s*=\s*["'][^"']+["']/gm,
        (m, ind, name) => `${ind}${name} = os.environ.get('${name}', '')`
      );
      if (/os\.environ\.get/.test(code) && !/import os/.test(code)) {
        code = 'import os\n' + code;
      }
    } else if (lang === 'php') {
      code = code.replace(
        /\$(\w*(?:secret|key|password|token)\w*)\s*=\s*["'][^"']{6,}["']/gi,
        (m, name) => `$${name} = getenv('${name.toUpperCase()}')`
      );
    }
    return code;
  }

  // ─── Main Fix ─────────────────────────────────────
  function fix(code, fileName) {
    const lang = detectLang(fileName);
    let fixed = code;
    const repairs = [];

    // 1. Secrets
    const afterSecrets = fixSecrets(fixed, lang);
    if (afterSecrets !== fixed) { repairs.push('Secrets → env vars'); fixed = afterSecrets; }

    // 2. Command Injection
    const afterCmd = fixCommandInjection(fixed, lang);
    if (afterCmd !== fixed) { repairs.push('Command Injection → execFile/subprocess'); fixed = afterCmd; }

    // 3. JWT Expiry
    const afterJWT = fixJWTExpiry(fixed, lang);
    if (afterJWT !== fixed) { repairs.push('JWT → expiresIn added'); fixed = afterJWT; }

    // 4. Promise .catch()
    const afterPromise = fixPromise(fixed, lang);
    if (afterPromise !== fixed) { repairs.push('Promise → .catch() added'); fixed = afterPromise; }

    // 5. PHP XSS
    if (lang === 'php') {
      const afterPHP = fixPHPXSS(fixed);
      if (afterPHP !== fixed) { repairs.push('PHP XSS → htmlspecialchars'); fixed = afterPHP; }
    }

    // 6. Python Exceptions
    if (lang === 'py') {
      const afterPy = fixPythonExceptions(fixed);
      if (afterPy !== fixed) { repairs.push('Python exceptions fixed'); fixed = afterPy; }
    }

    return { fixed, repairs, changed: fixed !== code };
  }

  return { fix, detectLang };
})();

if (typeof window !== 'undefined') window.AdvancedRepair = AdvancedRepair;
if (typeof module !== 'undefined') module.exports = AdvancedRepair;
