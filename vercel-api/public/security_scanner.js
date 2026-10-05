// ─── Security Scanner ────────────────────────────────
// يكتشف ثغرات أمنية شائعة في الكود

// استدعاء exec/spawn الممتد على عدة أسطر: يجمع الأسطر حتى يتوازن القوس (حد 12 سطرًا).
// يرجع null إذا لم يبدأ استدعاء، أو أُغلق في نفس السطر (يعالجه الفحص أحادي السطر)، أو لم يُغلق.
// first = الوسيط الأول فقط (قبل أول فاصلة في المستوى الأعلى)، inner = كل ما بين القوسين.
function __joinMultilineCall(lines, i, nameRe) {
  const m = nameRe.exec(lines[i]);
  if (!m) return null;
  // تجاهل التطابق داخل تعليق // أو داخل نص (عدد فردي من علامات الاقتباس قبله)
  const pre = lines[i].slice(0, m.index);
  if (/(?:^|[^:])\/\//.test(pre) || ["'", '"', '`'].some(c => (pre.split(c).length - 1) % 2 === 1)) return null;
  let depth = 0, q = null, text = '', first = null, started = false;
  for (let k = i; k < lines.length && k < i + 12; k++) {
    const src = k === i ? lines[k].slice(m.index + m[0].length - 1) : lines[k];
    if (k > i && src.trim().startsWith('//')) continue;
    for (let c = 0; c < src.length; c++) {
      const ch = src[c];
      if (q) { text += ch; if (ch === '\\') { text += src[++c] || ''; } else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; text += ch; continue; }
      if ('([{'.includes(ch)) { depth++; if (!started) { started = true; continue; } }
      else if (')]}'.includes(ch)) {
        depth--;
        if (depth === 0) {
          if (first === null) first = text;
          return k === i ? null : { inner: text, first: first.trim(), endLine: k };
        }
      } else if (ch === ',' && depth === 1 && first === null) { first = text; }
      text += ch;
    }
    text += ' ';
  }
  return null;
}

function scanSecurity(code, fileName) {
  const issues = [];
  const lines = code.split('\n');
  const ext = fileName.split('.').pop().toLowerCase();

  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;
    const ln = i + 1;

    // ─── 1. SQL Injection ───────────────────────────
    if (/query|execute|sql/i.test(t) && /\+\s*\w+|\$\{/.test(t) && !/prepared|parameterized/i.test(t)) {
      issues.push({
        type: 'security', sev: 'c',
        title: '🔴 SQL Injection محتمل',
        line: ln, ev: t,
        fix: '// استخدم Prepared Statements بدل string concatenation',
        conf: 85, cIcon: '🔴', cAct: 'ثغرة حرجة',
        cEv: ['لا تدمج input المستخدم مباشرة في SQL']
      });
    }

    // ─── 2. Hardcoded Password/Secret ──────────────
    if (/password|secret|api_key|apikey|token/i.test(t) &&
        /=\s*["'][^"']{4,}["']/.test(t) &&
        !/test|example|placeholder|your_/i.test(t) &&
        !/(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)/i.test(t) &&
        !/[?]/.test(t.split('=')[1] || '')) {
      issues.push({
        type: 'security', sev: 'c',
        title: '🔴 كلمة مرور/مفتاح مُضمَّن في الكود',
        line: ln, ev: t,
        fix: '// استخدم Environment Variables بدل hardcoded secrets',
        conf: 90, cIcon: '🔴', cAct: 'ثغرة حرجة',
        cEv: ['لا تضع secrets في الكود — استخدم .env']
      });
    }

    // ─── 3. XSS ────────────────────────────────────
    if (['js','jsx','ts','html'].includes(ext)) {
      if (/innerHTML|document\.write|\.html\(/.test(t) && /\w+/.test(t)) {
        issues.push({
          type: 'security', sev: 'h',
          title: '🟠 XSS محتمل: innerHTML بدون sanitize',
          line: ln, ev: t,
          fix: t.replace('innerHTML', 'textContent'),
          conf: 80, cIcon: '🟠', cAct: 'ثغرة XSS',
          cEv: ['استخدم textContent أو sanitize الـ input']
        });
      }
    }

    // ─── 4. eval() ─────────────────────────────────
    if (/\beval\s*\(/.test(t)) {
      issues.push({
        type: 'security', sev: 'c',
        title: '🔴 eval() خطير جداً',
        line: ln, ev: t,
        fix: '// احذف eval() — استخدم JSON.parse أو طريقة آمنة',
        conf: 95, cIcon: '🔴', cAct: 'ثغرة حرجة',
        cEv: ['eval() يسمح بتنفيذ أي كود — خطر جداً']
      });
    }

    // ─── 5. Command Injection ───────────────────────
    // exec/spawn ممتد على عدة أسطر: نفحص الوسيط الأول فقط (حتى لا يطابق + داخل الـcallback).
    const mlCmd = __joinMultilineCall(lines, i, /\b(?:exec|spawn)\s*\(/);
    if (mlCmd ? /\+|\$\{/.test(mlCmd.first) :
        (/(?:\bexec\s*\(|\bspawn\s*\(|\bos\.system\s*\(|\bsubprocess\.(?:run|Popen|call|check_output)\s*\()/i.test(t) &&
         /\+|f"|f'|\$\{/.test(t))) {
      issues.push({
        type: 'security', sev: 'c',
        title: '🔴 Command Injection محتمل',
        line: ln, ev: t,
        fix: '// لا تدمج input المستخدم في shell commands',
        conf: 85, cIcon: '🔴', cAct: 'ثغرة حرجة',
        aiRequired: true,
        cEv: ['استخدم قائمة arguments بدل string']
      });
    }

    // ─── 6. Insecure Random ─────────────────────────
    if (/Math\.random\(\)|random\(\)/.test(t) && /token|password|secret|id|key/i.test(t)) {
      issues.push({
        type: 'security', sev: 'h',
        title: '🟠 Random غير آمن للـ security',
        line: ln, ev: t,
        fix: '// استخدم crypto.randomBytes() أو SecureRandom()',
        conf: 80, cIcon: '🟠', cAct: 'ثغرة أمنية',
        cEv: ['Math.random() ليس آمناً للـ tokens']
      });
    }

    // ─── 7. MD5 / SHA1 ─────────────────────────────
    if (/md5|sha1|sha-1/i.test(t) && /hash|encrypt|password/i.test(t)) {
      issues.push({
        type: 'security', sev: 'h',
        title: '🟠 خوارزمية تشفير ضعيفة: MD5/SHA1',
        line: ln, ev: t,
        fix: '// استخدم SHA-256 أو bcrypt للكلمات السر',
        conf: 85, cIcon: '🟠', cAct: 'تشفير ضعيف',
        cEv: ['MD5/SHA1 ضعيفة — استخدم SHA-256 أو bcrypt']
      });
    }

    // ─── 8. HTTP بدل HTTPS ──────────────────────────
    if (/http:\/\/(?!localhost|127\.0\.0\.1)/.test(t) && !/\/\//i.test(t.slice(0, t.indexOf('http')))) {
      issues.push({
        type: 'security', sev: 'm',
        title: '🟡 HTTP غير مشفر — استخدم HTTPS',
        line: ln, ev: t,
        fix: t.replace('http://', 'https://'),
        conf: 75, cIcon: '🟡', cAct: 'اتصال غير آمن',
        cEv: ['HTTP يرسل البيانات بدون تشفير']
      });
    }

    // ─── 9. Log Sensitive Data ──────────────────────
    if (/console\.log|print|Log\./i.test(t) && /password|token|secret|key|credit/i.test(t)) {
      issues.push({
        type: 'security', sev: 'h',
        title: '🟠 تسجيل بيانات حساسة في الـ logs',
        line: ln, ev: t,
        fix: '// لا تسجّل passwords أو tokens في الـ logs',
        conf: 85, cIcon: '🟠', cAct: 'تسرب بيانات',
        cEv: ['البيانات الحساسة في الـ logs خطر أمني']
      });
    }

    // ─── 10. Weak TLS ───────────────────────────────
    if (/SSLv3|TLSv1\.0|TLSv1\.1|ssl_version|PROTOCOL_TLS/i.test(t)) {
      issues.push({
        type: 'security', sev: 'h',
        title: '🟠 إصدار TLS قديم وغير آمن',
        line: ln, ev: t,
        fix: '// استخدم TLS 1.2 أو 1.3',
        conf: 90, cIcon: '🟠', cAct: 'بروتوكول ضعيف',
        cEv: ['TLS 1.0/1.1 معطوبان — استخدم TLS 1.2+']
      });
    }
  });

  return issues;
}
