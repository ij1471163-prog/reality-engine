// ═══════════════════════════════════════════════════════
// taint_core.js v1.0 — محرك Taint Analysis المشترك
// يتتبع تدفق البيانات من المصدر للمصب
// ═══════════════════════════════════════════════════════
"use strict";

// ─── Taint Result ─────────────────────────────────────
class TaintIssue {
  constructor(type, sev, line, source, sink, variable, fix) {
    this.type     = type;
    this.sev      = sev;
    this.line     = line;
    this.source   = source;  // req.body, $_GET, etc
    this.sink     = sink;    // db.query, res.send, etc
    this.variable = variable;
    this.fix      = fix;
    this.title    = `🔴 Taint: ${variable} من ${source} → ${sink}`;
    this.cIcon    = '🔴';
    this.cAct     = type;
    this.conf     = 88;
  }
}

// ─── Taint Engine Core ────────────────────────────────
class TaintEngine {
  constructor() {
    this.tainted  = new Map(); // varName → { source, line }
    this.issues   = [];
  }

  // سجّل متغير tainted
  markTainted(varName, source, line) {
    this.tainted.set(varName, { source, line });
  }

  // تحقق لو متغير tainted
  isTainted(varName) {
    return this.tainted.has(varName);
  }

  // أضف issue
  addIssue(type, sev, line, variable, sink, fix) {
    const info = this.tainted.get(variable);
    const source = info ? info.source : 'user input';
    this.issues.push(new TaintIssue(type, sev, line, source, sink, variable, fix));
  }

  // تحقق propagation: x = tainted_var
  checkAssignment(target, source, line) {
    if (this.isTainted(source)) {
      this.markTainted(target, this.tainted.get(source).source, line);
    }
  }

  // تحقق string concat: "..." + tainted_var
  checkConcat(parts, line) {
    return parts.some(p => this.isTainted(p));
  }
}

// ─── Sanitizer Detector ───────────────────────────────
function isSanitized(expr, lang) {
  const sanitizers = {
    js:  /escapeHtml|sanitize|DOMPurify|escape|encodeURI|parameterize|prepared|parseInt|Number\(/,
    py:  /escape|sanitize|literal_eval|shlex\.split|prepared|cursor\.execute\s*\([^,]+,\s*\(/,
    php: /htmlspecialchars|htmlentities|mysqli_real_escape|prepare|PDO|bindParam/,
  };
  const pattern = sanitizers[lang] || sanitizers.js;
  return pattern.test(expr);
}

// ─── Export ───────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.TaintEngine = TaintEngine;
  window.TaintIssue  = TaintIssue;
  window.isSanitized = isSanitized;
}
