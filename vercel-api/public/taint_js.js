// ═══════════════════════════════════════════════════════
// taint_js.js v1.0 — Taint Analysis لـ JavaScript/TypeScript
// ═══════════════════════════════════════════════════════
"use strict";

// استدعاء exec/spawn الممتد على عدة أسطر: يجمع الأسطر حتى يتوازن القوس (حد 12 سطرًا).
// يرجع null إذا لم يبدأ استدعاء، أو أُغلق في نفس السطر (يعالجه الفحص أحادي السطر)، أو لم يُغلق.
// first = الوسيط الأول فقط (قبل أول فاصلة في المستوى الأعلى)، inner = كل ما بين القوسين.
function __taintJoinMultilineCall(lines, i, nameRe) {
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

function analyzeTaintJS(code, fileName) {
  const engine  = new TaintEngine();
  const lines   = code.split('\n');
  const issues  = [];

  // ─── Sources ────────────────────────────────────────
  const SOURCES = [
    { re: /(?:req\.body|req\.query|req\.params)\.(\w+)/g,         src: 'req input' },
    { re: /(?:req\.body|req\.query|req\.params)\[['"](\w+)['"]\]/g, src: 'req input' },
    { re: /const\s*\{([^}]+)\}\s*=\s*req\.body/g,                src: 'req.body' },
    { re: /const\s*\{([^}]+)\}\s*=\s*req\.query/g,               src: 'req.query' },
    { re: /document\.(?:getElementById|querySelector)\([^)]+\)\.value/g, src: 'DOM input' },
    { re: /location\.(?:search|hash|href)/g,                      src: 'URL input' },
    { re: /URLSearchParams/g,                                      src: 'URL params' },
  ];

  // ─── Sinks ──────────────────────────────────────────
  const SINKS = [
    // SQL
    { re: /(?:db|conn|pool|mysql|pg)\.(?:query|execute)\s*\(\s*([^,)]+)/g,
      type: 'SQL_INJECTION', sev: 'c', sink: 'db.query',
      fix: (v) => `db.query(sql, [${v}]) // use parameterized query` },
    // XSS
    { re: /res\.send\s*\(([^)]+)\)/g,
      type: 'XSS', sev: 'c', sink: 'res.send',
      fix: (v) => `res.json({ message: sanitize(${v}) })` },
    { re: /\.innerHTML\s*=\s*(.+)/g,
      type: 'XSS', sev: 'c', sink: 'innerHTML',
      fix: (v) => `.textContent = ${v}` },
    { re: /document\.write\s*\(([^)]+)\)/g,
      type: 'XSS', sev: 'c', sink: 'document.write',
      fix: (v) => `// SECURITY: document.write removed` },
    // Command Injection
    { re: /(?:exec|spawn|execSync)\s*\(([^)]+)\)/g,
      type: 'CMD_INJECTION', sev: 'c', sink: 'exec',
      fix: (v) => `// SECURITY: validate ${v} before exec` },
    // eval
    { re: /\beval\s*\(([^)]+)\)/g,
      type: 'CODE_INJECTION', sev: 'c', sink: 'eval',
      fix: (v) => `JSON.parse(${v}) // if JSON, else remove eval` },
    // Path traversal
    { re: /(?:readFile|writeFile|readFileSync)\s*\(([^,)]+)/g,
      type: 'PATH_TRAVERSAL', sev: 'h', sink: 'readFile',
      fix: (v) => `path.resolve(basePath, path.basename(${v}))` },
  ];

  // ─── Pass 1: اكتشف Sources ──────────────────────────
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//')) return;
    const ln = i + 1;

    SOURCES.forEach(({ re, src }) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        // destructuring: const {username, hash} = req.body
        if (m[1] && m[1].includes(',')) {
          m[1].split(',').forEach(v => {
            const varName = v.trim().split(':')[0].trim();
            if (varName) engine.markTainted(varName, src, ln);
          });
        } else if (m[1]) {
          engine.markTainted(m[1].trim(), src, ln);
        }
      }
    });

    // allowlist sanitizer ضيّق: <var>.replace(/[^a-zA-Z0-9_ ]/g, '') — المتغير المعقَّم فقط
    // لا ينقل الـtaint (assignment أو concat)؛ باقي المتغيرات تنتقل كالمعتاد.
    const sanM = t.match(/\b([a-zA-Z_]\w*)\s*\.replace\(\s*\/\[\^(?:a-zA-Z0-9|_| ){2,}\]\/g\s*,\s*(['"])\2\s*\)/);
    const sanitizedVar = sanM ? sanM[1] : null;

    // تتبع assignments: let x = tainted
    const assignM = t.match(/(?:let|const|var)\s+(\w+)\s*=\s*(.+)/);
    if (assignM) {
      const [, target, expr] = assignM;
      // استخرج variables من الـ expression
      const vars = expr.match(/\b([a-zA-Z_]\w*)\b/g) || [];
      vars.forEach(v => { if (v !== sanitizedVar) engine.checkAssignment(target, v, ln); });
    }

    // تتبع string concat تضم tainted vars
    const concatM = t.match(/(\w+)\s*=\s*["'`][^"'`]*["'`]\s*\+\s*(\w+)/);
    if (concatM) {
      const [, target, src2] = concatM;
      if (engine.isTainted(src2) && src2 !== sanitizedVar) engine.markTainted(target, engine.tainted.get(src2).source, ln);
    }
  });

  // ─── Pass 2: اكتشف Sinks ────────────────────────────
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//')) return;
    const ln = i + 1;

    // exec/spawn ممتد على عدة أسطر: الـsink يُقرأ من النص المجموع، ويُتجاوز الفحص أحادي السطر لهذا السطر.
    const mlCmd = __taintJoinMultilineCall(lines, i, /\b(?:exec|execSync|spawn)\s*\(/);

    SINKS.forEach(({ re, type, sev, sink, fix }) => {
      re.lastIndex = 0;
      let m;
      const mlSink = type === 'CMD_INJECTION' && mlCmd;
      if (mlSink) m = { 1: mlCmd.inner, index: 0 };
      while (mlSink ? m : (m = re.exec(line)) !== null) {
        const expr = m[1] || '';
        // استخرج variables من الـ expression
        const vars = expr.match(/\b([a-zA-Z_]\w*)\b/g) || [];
        const taintedVars = vars.filter(v => engine.isTainted(v));

        // تجاهل لو الـ query parameterized
        // 1. db.query مع array params مباشرة
        const hasArray = /\[/.test(line);
        // 2. الـ query variable يحتوي ?
        const queryVarM = line.match(/\.query\s*\((\w+)/);
        const queryVar = queryVarM ? queryVarM[1] : null;
        const queryDef = queryVar ? code.split('\n').find(l => 
          new RegExp(queryVar + '\\s*=.*\\?').test(l)) : null;
        const isParameterized = hasArray && (queryDef !== null && queryDef !== undefined);
        if (taintedVars.length > 0 && !isSanitized(expr, 'js') && !isParameterized) {
          taintedVars.forEach(v => {
            engine.addIssue(type, sev, ln, v, sink, fix(v));
            issues.push({
              type: 'taint', sev, line: ln, ev: t,
              title: `🔴 ${type}: ${v} من ${engine.tainted.get(v).source} → ${sink}`,
              fix: fix(v),
              conf: 88, cIcon: '🔴', cAct: type,
              ...(type === 'CMD_INJECTION' ? { aiRequired: true } : {}),
              cEv: [`${v} مصدره: ${engine.tainted.get(v).source}`, `يصل لـ: ${sink} بدون sanitization`]
            });
          });
        }
        if (mlSink) break;
      }
    });
  });

  return issues;
}

if (typeof window !== 'undefined') window.analyzeTaintJS = analyzeTaintJS;
