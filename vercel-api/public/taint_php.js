// ═══════════════════════════════════════════════════════
// taint_php.js v1.0 — Taint Analysis لـ PHP
// ═══════════════════════════════════════════════════════
"use strict";

function analyzeTaintPHP(code, fileName) {
  const engine = new TaintEngine();
  const lines  = code.split('\n');
  const issues = [];

  // ─── Sources ────────────────────────────────────────
  const SOURCES = [
    /\$_(GET|POST|REQUEST|COOKIE|FILES|SERVER)\[['"](\w+)['"]\]/g,
    /\$_(GET|POST|REQUEST)\b/g,
    /filter_input\s*\(\s*INPUT_(GET|POST)/g,
    /\$_SERVER\[['"]HTTP_/g,
  ];

  // ─── Sinks ──────────────────────────────────────────
  const SINKS = [
    { re: /(?:mysqli_query|mysql_query|\$\w+->query)\s*\(([^)]+)\)/g,
      type: 'SQL_INJECTION', sev: 'c', sink: 'mysqli_query',
      fix: (v) => `$stmt = $conn->prepare($sql); $stmt->bind_param("s", ${v});` },
    { re: /echo\s+(.+)/g,
      type: 'XSS', sev: 'c', sink: 'echo',
      fix: (v) => `echo htmlspecialchars(${v}, ENT_QUOTES, 'UTF-8');` },
    { re: /(?:exec|shell_exec|system|passthru|popen)\s*\(([^)]+)\)/g,
      type: 'CMD_INJECTION', sev: 'c', sink: 'exec',
      fix: (v) => `exec(escapeshellarg(${v}))` },
    { re: /eval\s*\(([^)]+)\)/g,
      type: 'CODE_INJECTION', sev: 'c', sink: 'eval',
      fix: (v) => `// SECURITY: eval removed` },
    { re: /include\s*\(([^)]+)\)/g,
      type: 'FILE_INCLUSION', sev: 'c', sink: 'include',
      fix: (v) => `// SECURITY: validate ${v} before include` },
    { re: /header\s*\(\s*["']Location:\s*"\s*\.\s*([^)]+)\)/g,
      type: 'OPEN_REDIRECT', sev: 'h', sink: 'header redirect',
      fix: (v) => `// SECURITY: validate redirect URL` },
  ];

  // ─── Pass 1: Sources ─────────────────────────────────
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;
    const ln = i + 1;

    SOURCES.forEach(re => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        // $var = $_GET['name']
        const assignM = line.match(/(\$\w+)\s*=\s*\$_(GET|POST|REQUEST)/);
        if (assignM) engine.markTainted(assignM[1], `$_${assignM[2]}`, ln);
        // Direct use: $_GET['name']
        engine.markTainted(`$_${m[1] || 'INPUT'}`, `$_${m[1] || 'INPUT'}`, ln);
      }
    });

    // PHP assignment
    const phpAssign = t.match(/(\$\w+)\s*=\s*(.+)/);
    if (phpAssign) {
      const [, target, expr] = phpAssign;
      const vars = expr.match(/\$\w+/g) || [];
      vars.forEach(v => engine.checkAssignment(target, v, ln));
      if (/\$_(GET|POST|REQUEST)/.test(expr)) engine.markTainted(target, 'HTTP input', ln);
    }
  });

  // ─── Pass 2: Sinks ───────────────────────────────────
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('#')) return;
    const ln = i + 1;

    SINKS.forEach(({ re, type, sev, sink, fix }) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const expr = m[1] || '';
        const vars = expr.match(/\$\w+/g) || [];
        const taintedVars = vars.filter(v => engine.isTainted(v));

        // تحقق من $_GET/POST مباشرة
        const directTaint = /\$_(GET|POST|REQUEST)/.test(expr);

        if ((taintedVars.length > 0 || directTaint) && !isSanitized(line, 'php')) {
          const v = taintedVars[0] || '$_INPUT';
          issues.push({
            type: 'taint', sev, line: ln, ev: t,
            title: `🔴 ${type}: ${v} → ${sink}`,
            fix: fix(v),
            conf: 90, cIcon: '🔴', cAct: type,
            cEv: [`${v} مصدره user input`, `يصل لـ ${sink} بدون sanitization`]
          });
        }
      }
    });
  });

  return issues;
}

if (typeof window !== 'undefined') window.analyzeTaintPHP = analyzeTaintPHP;
