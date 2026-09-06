// ═══════════════════════════════════════════════════════
// taint_py.js v1.0 — Taint Analysis لـ Python
// ═══════════════════════════════════════════════════════
"use strict";

function analyzeTaintPY(code, fileName) {
  const engine = new TaintEngine();
  const lines  = code.split('\n');
  const issues = [];

  // ─── Sources ────────────────────────────────────────
  const SOURCES = [
    { re: /request\.(?:args|form|json|data|values)(?:\.get\(['"](\w+)['"]\)|\[['"](\w+)['"]\])/g, src: 'Flask request' },
    { re: /request\.(?:args|form)\[['"](\w+)['"]\]/g, src: 'Flask input' },
    { re: /input\s*\(/g, src: 'user input()' },
    { re: /sys\.argv\[(\d+)\]/g, src: 'CLI args' },
    { re: /os\.environ(?:\.get\(['"](\w+)['"]\)|\[['"](\w+)['"]\])/g, src: 'env var' },
    { re: /(?:GET|POST)\[['"](\w+)['"]\]/g, src: 'HTTP input' },
  ];

  // ─── Sinks ──────────────────────────────────────────
  const SINKS = [
    { re: /(?:cursor|conn)\.execute\s*\(\s*([^,)]+)\s*\)/g,
      type: 'SQL_INJECTION', sev: 'c', sink: 'cursor.execute',
      fix: (v) => `cursor.execute(query, (${v},)) # parameterized` },
    { re: /os\.system\s*\(([^)]+)\)/g,
      type: 'CMD_INJECTION', sev: 'c', sink: 'os.system',
      fix: (v) => `subprocess.run(shlex.split(${v}), check=True)` },
    { re: /subprocess\.(?:call|run|Popen)\s*\([^)]*shell\s*=\s*True[^)]*\)/g,
      type: 'CMD_INJECTION', sev: 'c', sink: 'subprocess shell=True',
      fix: (v) => `subprocess.run(${v}, shell=False)` },
    { re: /eval\s*\(([^)]+)\)/g,
      type: 'CODE_INJECTION', sev: 'c', sink: 'eval',
      fix: (v) => `ast.literal_eval(${v}) # safe alternative` },
    { re: /exec\s*\(([^)]+)\)/g,
      type: 'CODE_INJECTION', sev: 'c', sink: 'exec',
      fix: (v) => `# SECURITY: exec removed - validate ${v}` },
    { re: /open\s*\(([^,)]+)/g,
      type: 'PATH_TRAVERSAL', sev: 'h', sink: 'open()',
      fix: (v) => `open(os.path.basename(${v}))` },
    { re: /(?:render_template_string|Markup)\s*\(([^)]+)\)/g,
      type: 'XSS', sev: 'c', sink: 'render_template_string',
      fix: (v) => `render_template('safe.html', data=escape(${v}))` },
  ];

  // ─── Pass 1: Sources ─────────────────────────────────
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('#')) return;
    const ln = i + 1;

    SOURCES.forEach(({ re, src }) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const varName = m[1] || m[2];
        if (varName) engine.markTainted(varName, src, ln);
      }
    });

    // Python assignment: x = tainted_var
    const assignM = t.match(/^(\w+)\s*=\s*(.+)/);
    if (assignM) {
      const [, target, expr] = assignM;
      const vars = expr.match(/\b([a-zA-Z_]\w*)\b/g) || [];
      vars.forEach(v => engine.checkAssignment(target, v, ln));

      // تتبع input()
      if (/\binput\s*\(/.test(expr)) engine.markTainted(target, 'input()', ln);
    }

    // function params: def func(username, password)
    const funcM = t.match(/^def\s+\w+\s*\(([^)]+)\)/);
    if (funcM && /login|auth|register|user|search/i.test(t)) {
      funcM[1].split(',').forEach(p => {
        const pName = p.trim().split('=')[0].trim().split(':')[0].trim();
        if (pName && pName !== 'self') engine.markTainted(pName, 'function param', ln);
      });
    }
  });

  // ─── Pass 2: Sinks ───────────────────────────────────
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('#')) return;
    const ln = i + 1;

    SINKS.forEach(({ re, type, sev, sink, fix }) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const expr = m[1] || '';
        const vars = expr.match(/\b([a-zA-Z_]\w*)\b/g) || [];
        const taintedVars = vars.filter(v => engine.isTainted(v));

        if (taintedVars.length > 0 && !isSanitized(line, 'py')) {
          taintedVars.forEach(v => {
            issues.push({
              type: 'taint', sev, line: ln, ev: t,
              title: `🔴 ${type}: ${v} من ${engine.tainted.get(v).source} → ${sink}`,
              fix: fix(v),
              conf: 88, cIcon: '🔴', cAct: type,
              cEv: [`${v} مصدره: ${engine.tainted.get(v).source}`, `يصل لـ ${sink} بدون sanitization`]
            });
          });
        }
      }
    });
  });

  return issues;
}

if (typeof window !== 'undefined') window.analyzeTaintPY = analyzeTaintPY;
