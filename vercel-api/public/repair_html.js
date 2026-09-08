// ═══════════════════════════════════════════════════════
// repair_html.js v1.0 — إصلاح ذكي لملفات HTML
// يصلح JS داخل HTML بدون المساس بـ HTML أو CSS
// ═══════════════════════════════════════════════════════
"use strict";

var HTMLRepair = (() => {

  // ─── تحديد نوع السطر ──────────────────────────────
  function getLineType(line) {
    const t = line.trim();
    if (!t) return 'empty';
    if (t.startsWith('//') || t.startsWith('#')) return 'comment';
    if (t.startsWith('<') && !/(const|let|var|function)\s/.test(t)) return 'html';
    if (t.startsWith('*') || t.startsWith('/*')) return 'comment';
    if (/^\s*(const|let|var|function|class|import|export|if|for|while|return)/.test(t)) return 'js';
    if (/[{};]$/.test(t) && !/</.test(t)) return 'js';
    if (/<[a-z]/.test(t) && !/(const|let|var|function|if|for)\s/.test(t) && !/\.innerHTML/.test(t)) return 'html';
    return 'js'; // default
  }

  // ─── Secrets Fix ───────────────────────────────────
  function fixSecrets(line) {
    const t = line.trim();
    if (getLineType(line) !== 'js') return line;

    // sk_live_ / sk_test_
    if (/["']sk_live_[^"']+["']/.test(t)) {
      const m = line.match(/(const|let|var)\s+(\w+)\s*=\s*["']sk_live_[^"']+["']/);
      if (m) return line.replace(m[0], `${m[1]} ${m[2]} = process.env.${m[2].toUpperCase()}`);
    }
    if (/["']sk_test_[^"']+["']/.test(t)) {
      const m = line.match(/(const|let|var)\s+(\w+)\s*=\s*["']sk_test_[^"']+["']/);
      if (m) return line.replace(m[0], `${m[1]} ${m[2]} = process.env.${m[2].toUpperCase()}`);
    }

    // KEY|SECRET|TOKEN|PASSWORD = "..."
    const secretMatch = line.match(/(const|let|var)\s+(\w*(?:KEY|SECRET|TOKEN|PASSWORD|PASS|JWT)\w*)\s*=\s*["'][^"']{6,}["']/i);
    if (secretMatch) {
      const [full, decl, name] = secretMatch;
      return line.replace(full, `${decl} ${name} = process.env.${name.toUpperCase()}`);
    }

    return line;
  }

  // ─── XSS Fix ───────────────────────────────────────
  function fixXSS(line) {
    const t = line.trim();
    if (getLineType(line) !== 'js') return line;
    if (t.startsWith('//')) return line;

    // innerHTML += var
    if (/\.innerHTML\s*\+=/.test(line)) {
      const vMatch = line.match(/\+\s*(\w+)[^;]*;/);
      const v = vMatch ? vMatch[1] : 'value';
      const ind = line.match(/^\s*/)[0];
      const el = line.match(/([\w.$]+(?:\.[\w$]+|\('[^']*'\)|\("[^"]*"\)|\([^)]*\))*)\.innerHTML/)?.[1] || document.body;
      return `${ind}const _p = document.createElement('span'); _p.textContent = String(${v}).replace(/[<>]/g, ''); ${el}.appendChild(_p);`;
    }

    // innerHTML = anything (حتى بدون +)
    if (/\.innerHTML\s*=/.test(line) && !/textContent/.test(line)) {
      const m = line.match(/\.innerHTML\s*=\s*['"`][^'"`]*['"`]\s*\+\s*(\w+)/);
      if (m) {
        const v = m[1];
        const ind = line.match(/^\s*/)[0];
        const el = line.match(/(\w+(?:\.\w+)*)\s*\.innerHTML/)?.[1] || 'el';
        return `${ind}${el}.textContent = String(${v}).replace(/[<>]/g, '');`;
      }
      return line.replace(/\.innerHTML\s*=/, '.textContent =');
    }

    return line;
  }

  // ─── Eval Fix ──────────────────────────────────────
  function fixEval(line) {
    const t = line.trim();
    if (getLineType(line) !== 'js') return line;
    if (t.startsWith('//')) return line;

    if (/\beval\s*\(/.test(t) && !/SECURITY/.test(t)) {
      const ind = line.match(/^\s*/)[0];
      const vMatch = line.match(/eval\s*\(([^)]+)\)/);
      const v = vMatch ? vMatch[1].trim() : 'input';
      return `${ind}// SECURITY: eval() removed — use JSON.parse or safe alternative for: ${v}`;
    }

    return line;
  }

  // ─── HTTP Fix ──────────────────────────────────────
  function fixHTTP(line) {
    const t = line.trim();
    if (getLineType(line) === 'html') return line;
    if (/["']http:\/\/(?!localhost|127)/.test(t)) {
      return line.replace(/["']http:\/\//g, '"https://');
    }
    return line;
  }

  // ─── Footer Secrets Fix ────────────────────────────
  function fixFooterSecrets(code) {
    return code.replace(
      /(<p[^>]*>)([^<]*(?:JWT_SECRET|DB_PASS(?:WORD)?|API_KEY|SECRET|STRIPE_KEY)=[^|<]+)([^<]*<\/p>)/gi,
      (m, open, content, close) => {
        const cleaned = content.replace(/\s*\|?\s*(?:JWT_SECRET|DB_PASS(?:WORD)?|API_KEY|SECRET|STRIPE_KEY)=[^|<]*/gi, '');
        return open + cleaned + close;
      }
    );
  }

  // ─── SQL Fix ───────────────────────────────────────
  function fixSQL(line) {
    const t = line.trim();
    if (getLineType(line) !== 'js') return line;

    // "SELECT..." + var → comment
    if (/["'`].*(?:SELECT|INSERT|UPDATE|DELETE).*["'`]\s*\+/.test(t)) {
      const ind = line.match(/^\s*/)[0];
      return `${ind}// SQL: use parameterized queries — ${t.slice(0, 60)}`;
    }

    return line;
  }

  // ─── Main Fix ──────────────────────────────────────
  function fix(code, fileName) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    if (ext !== 'html' && ext !== 'htm') return { fixed: code, repairs: [] };

    const repairs = [];
    let lines = code.split('\n');

    lines = lines.map((line, i) => {
      const orig = line;

      // طبّق الإصلاحات بالترتيب
      line = fixSecrets(line);
      line = fixEval(line);
      line = fixXSS(line);
      line = fixHTTP(line);
      line = fixSQL(line);
      if (/createHash\s*\(\s*['"](?:md5|sha1)['"]/i.test(line.trim()))
        line = line.replace(/['"](?:md5|sha1)['"]/i, '"sha256"');
      { const _m = line.match(/(\w+)\s*=(?!=|>|\+|-)\s*(\w+\.\w+)/);
        if (_m && !/(const|let|var)\s/.test(line) && !new RegExp(`\\b${_m[1]}\\b\\s*=>`).test(line) && !/textContent|innerHTML|className|style/.test(line))
          line = line.replace(new RegExp(`\\b${_m[1]}\\b\\s*=(?!=|>|\\+|-)\\s*`), `${_m[1]} += `); }

      if (line !== orig) repairs.push({ line: i + 1, fix: line.trim().slice(0, 50) });
      return line;
    });

    let result = lines.join('\n');

    // صلح Footer secrets
    const beforeFooter = result;
    result = fixFooterSecrets(result);
    if (result !== beforeFooter) repairs.push({ line: 0, fix: 'Footer secrets cleaned' });

    return { fixed: result, repairs, changed: result !== code };
  }

  return { fix, getLineType };
})();

if (typeof window !== 'undefined') window.HTMLRepair = HTMLRepair;
if (typeof module !== 'undefined') module.exports = HTMLRepair;
