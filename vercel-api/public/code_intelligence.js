// ═══════════════════════════════════════════════════════
// code_intelligence.js v1.0
// Variable Tracking + Taint Analysis
// يتبع البيانات من المصدر للاستخدام
// ═══════════════════════════════════════════════════════

// ─── Taint Sources (مصادر البيانات الخارجية) ─────────
const TAINT_SOURCES = {
  js: [
    /req\.body\b/,    /req\.query\b/,  /req\.params\b/,
    /req\.headers\b/, /req\.cookies\b/,/process\.argv\b/,
    /process\.env\b/, /location\./,    /document\.cookie/,
    /localStorage\./,  /sessionStorage\./, /window\.name/,
    /innerHTML\b/,    /outerHTML\b/,   /document\.URL/,
    /URLSearchParams/,/FormData\b/,
  ],
  py: [
    /request\.form\b/, /request\.args\b/, /request\.json\b/,
    /request\.data\b/, /request\.headers\b/, /sys\.argv\b/,
    /os\.environ\b/,   /input\s*\(/,     /raw_input\s*\(/,
  ],
  java: [
    /getParameter\s*\(/, /getHeader\s*\(/, /getCookie\s*\(/,
    /getQueryString\s*\(/, /getInputStream\s*\(/,
    /request\.getBody\s*\(/, /System\.getenv\s*\(/,
  ],
};

// ─── Taint Sinks (أماكن الاستخدام الخطير) ────────────
const TAINT_SINKS = {
  SQL: {
    patterns: [
      /\bquery\s*\(/, /\bexecute\s*\(/, /\bexecSQL\s*\(/,
      /\bprepare\s*\(/, /\.query\s*`/, /db\.\w+\s*\(/,
    ],
    severity: 'CRITICAL',
    cwe: 'CWE-89',
    title: '🔴 SQL Injection مؤكد (Taint)',
    remediation: 'Prepared Statements + Parameterized Queries',
  },
  XSS: {
    patterns: [
      /\.innerHTML\s*=/, /\.outerHTML\s*=/, /document\.write\s*\(/,
      /\.insertAdjacentHTML\s*\(/, /eval\s*\(/, /setTimeout\s*\([^,)]*,/,
    ],
    severity: 'HIGH',
    cwe: 'CWE-79',
    title: '🟠 XSS مؤكد (Taint)',
    remediation: 'textContent أو DOMPurify.sanitize()',
  },
  CMD: {
    patterns: [
      /exec\s*\(/, /spawn\s*\(/, /execSync\s*\(/,
      /system\s*\(/, /popen\s*\(/, /Runtime\.exec\s*\(/,
    ],
    severity: 'CRITICAL',
    cwe: 'CWE-78',
    title: '🔴 Command Injection مؤكد (Taint)',
    remediation: 'استخدم قائمة arguments بدل string',
  },
  PATH: {
    patterns: [
      /readFile\s*\(/, /writeFile\s*\(/, /readFileSync\s*\(/,
      /createReadStream\s*\(/, /open\s*\(/,
    ],
    severity: 'HIGH',
    cwe: 'CWE-22',
    title: '🟠 Path Traversal مؤكد (Taint)',
    remediation: 'path.normalize() + allowlist validation',
  },
  LOG: {
    patterns: [
      /console\.log\s*\(/, /console\.error\s*\(/,
      /logger\.\w+\s*\(/, /Log\.\w+\s*\(/, /print\s*\(/,
    ],
    severity: 'MEDIUM',
    cwe: 'CWE-532',
    title: '🟡 تسجيل بيانات مستخدم في logs',
    remediation: 'لا تسجّل user input مباشرة',
  },
};

// ═══════════════════════════════════════════════════════
// 1. Variable Tracker — يتبع تعريف المتغيرات
// ═══════════════════════════════════════════════════════

function buildVariableMap(code, ext) {
  const vars = new Map();
  const lines = code.split('\n');

  lines.forEach((line, i) => {
    const t = line.trim();
    const ln = i + 1;

    // JS: const x = ..., let x = ..., var x = ...
    const jsDecl = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*(.+)/);
    if (jsDecl) {
      vars.set(jsDecl[1], {
        name:    jsDecl[1],
        line:    ln,
        value:   jsDecl[2].trim(),
        tainted: false,
        source:  null,
      });
    }

    // JS: function params
    const funcDecl = t.match(/(?:function\s+\w+|=>\s*)\s*\(([^)]+)\)/);
    if (funcDecl) {
      funcDecl[1].split(',').forEach(param => {
        const p = param.trim().replace(/[=:].+$/, '').trim();
        if (p && p !== '...') {
          vars.set(p, { name: p, line: ln, value: 'param', tainted: false, source: null });
        }
      });
    }

    // Python: x = ...
    if (ext === 'py') {
      const pyDecl = t.match(/^(\w+)\s*=\s*(?!={1})(.+)/);
      if (pyDecl && !['if','for','while','return','import'].includes(pyDecl[1])) {
        vars.set(pyDecl[1], {
          name: pyDecl[1], line: ln,
          value: pyDecl[2].trim(), tainted: false, source: null,
        });
      }
    }

    // Java: Type varName = ...
    if (ext === 'java') {
      const javaDecl = t.match(/\b(?:String|int|long|Object|List|Map|\w+)\s+(\w+)\s*=\s*(.+)/);
      if (javaDecl && javaDecl[1] !== 'return') {
        vars.set(javaDecl[1], {
          name: javaDecl[1], line: ln,
          value: javaDecl[2].trim(), tainted: false, source: null,
        });
      }
    }
  });

  return vars;
}

// ═══════════════════════════════════════════════════════
// 2. Taint Propagation — يحدد المصادر الملوثة
// ═══════════════════════════════════════════════════════

function propagateTaint(varMap, code, ext) {
  const sources = TAINT_SOURCES[ext] || TAINT_SOURCES.js;
  const lines = code.split('\n');
  let changed = true;
  let iterations = 0;

  while (changed && iterations < 5) {
    changed = false;
    iterations++;

    varMap.forEach((varInfo, varName) => {
      if (varInfo.tainted) return;

      // تحقق إذا القيمة جاءت من مصدر خارجي
      const isTainted = sources.some(src => src.test(varInfo.value));
      if (isTainted) {
        varInfo.tainted = true;
        varInfo.source  = detectSource(varInfo.value, ext);
        changed = true;
        return;
      }

      // تحقق إذا القيمة تعتمد على متغير ملوث آخر
      varMap.forEach((otherVar, otherName) => {
        if (!otherVar.tainted) return;
        if (new RegExp(`\\b${otherName}\\b`).test(varInfo.value)) {
          varInfo.tainted = true;
          varInfo.source  = `propagated from ${otherName}`;
          changed = true;
        }
      });
    });

    // فحص assignments في الكود
    lines.forEach((line, i) => {
      const t = line.trim();
      const assignMatch = t.match(/(\w+)\s*[+\-*]?=\s*(.+)/);
      if (!assignMatch) return;

      const [, target, value] = assignMatch;
      if (!varMap.has(target)) return;

      const isTainted = sources.some(src => src.test(value));
      if (isTainted && !varMap.get(target).tainted) {
        varMap.get(target).tainted = true;
        varMap.get(target).source  = detectSource(value, ext);
        changed = true;
      }

      // propagation
      varMap.forEach((otherVar, otherName) => {
        if (!otherVar.tainted) return;
        if (new RegExp(`\\b${otherName}\\b`).test(value) && !varMap.get(target).tainted) {
          varMap.get(target).tainted = true;
          varMap.get(target).source  = `propagated from ${otherName}`;
          changed = true;
        }
      });
    });
  }

  return varMap;
}

function detectSource(value, ext) {
  if (/req\.body/.test(value))    return 'HTTP Request Body';
  if (/req\.query/.test(value))   return 'HTTP Query String';
  if (/req\.params/.test(value))  return 'HTTP URL Params';
  if (/req\.headers/.test(value)) return 'HTTP Headers';
  if (/req\.cookies/.test(value)) return 'HTTP Cookies';
  if (/process\.env/.test(value)) return 'Environment Variables';
  if (/localStorage/.test(value)) return 'Local Storage';
  if (/innerHTML/.test(value))    return 'DOM innerHTML';
  if (/request\.form/.test(value))return 'Form Data';
  if (/request\.args/.test(value))return 'URL Args';
  if (/getParameter/.test(value)) return 'HTTP Parameter';
  if (/input\s*\(/.test(value))   return 'User Input';
  return 'External Source';
}

// ═══════════════════════════════════════════════════════
// 3. Sink Detection — يكتشف استخدام المتغيرات الملوثة
// ═══════════════════════════════════════════════════════

function detectTaintedSinks(varMap, code, fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const lines = code.split('\n');
  const issues = [];

  lines.forEach((line, i) => {
    const t = line.trim();
    const ln = i + 1;
    if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;

    Object.entries(TAINT_SINKS).forEach(([sinkType, sinkInfo]) => {
      const isSink = sinkInfo.patterns.some(p => p.test(t));
      if (!isSink) return;

      // تحقق إذا أي متغير ملوث يظهر في هذا السطر
      varMap.forEach((varInfo, varName) => {
        if (!varInfo.tainted) return;
        if (!new RegExp(`\\b${varName}\\b`).test(t)) return;

        // تجنب التكرار
        const dup = issues.some(x => x.line === ln && x.title === sinkInfo.title);
        if (dup) return;

        issues.push({
          type:        'taint',
          sev:         sinkInfo.severity === 'CRITICAL' ? 'c' : sinkInfo.severity === 'HIGH' ? 'h' : 'm',
          line:        ln,
          ev:          t,
          title:       sinkInfo.title,
          fix:         `// ${sinkInfo.remediation}`,
          conf:        92,
          cIcon:       sinkInfo.severity === 'CRITICAL' ? '🔴' : '🟠',
          cAct:        `${sinkInfo.cwe} — Taint Flow Detected`,
          cEv: [
            `المتغير "${varName}" ملوث من: ${varInfo.source}`,
            `تعريفه في السطر: ${varInfo.line}`,
            `الخطر: ${sinkInfo.title}`,
            `الإصلاح: ${sinkInfo.remediation}`,
          ],
          taintInfo: {
            variable:    varName,
            source:      varInfo.source,
            sourceLine:  varInfo.line,
            sink:        sinkType,
            sinkLine:    ln,
            cwe:         sinkInfo.cwe,
            severity:    sinkInfo.severity,
          },
        });
      });

      // كشف inline taint (بدون متغير وسيط)
      const sources = TAINT_SOURCES[ext] || TAINT_SOURCES.js;
      const inlineTainted = sources.some(src => src.test(t));
      if (inlineTainted) {
        const dup = issues.some(x => x.line === ln && x.title === sinkInfo.title);
        if (!dup) {
          issues.push({
            type:  'taint',
            sev:   sinkInfo.severity === 'CRITICAL' ? 'c' : 'h',
            line:  ln,
            ev:    t,
            title: sinkInfo.title + ' (Inline)',
            fix:   `// ${sinkInfo.remediation}`,
            conf:  88,
            cIcon: '🔴',
            cAct:  `${sinkInfo.cwe} — Direct Taint`,
            cEv:   [
              'بيانات خارجية تُستخدم مباشرة في sink خطير',
              `الإصلاح: ${sinkInfo.remediation}`,
            ],
            taintInfo: {
              variable: 'inline', source: 'Direct user input',
              sink: sinkType, sinkLine: ln, cwe: sinkInfo.cwe,
              severity: sinkInfo.severity,
            },
          });
        }
      }
    });
  });

  return issues;
}

// ═══════════════════════════════════════════════════════
// 4. SQL Repair Engine — يصلح SQL Injection تلقائياً
// ═══════════════════════════════════════════════════════

function repairSQLInjection(code) {
  const lines = code.split('\n');
  const repairs = [];
  let repairedCode = code;

  lines.forEach((line, i) => {
    const t = line.trim();
    const ln = i + 1;

    // Pattern 1: "SELECT ... WHERE x='" + var + "'"
    const sqlConcat = t.match(/["'](SELECT[^"']+WHERE[^"']+)['"]\s*\+\s*(\w+)/i);
    if (sqlConcat) {
      const queryTemplate = sqlConcat[1];
      const varName = sqlConcat[2];

      // استخرج كل المتغيرات المدمجة
      const allVars = extractConcatVars(t);
      const params = allVars.map(v => v).join(', ');

      // بناء الـ query الآمن
      let safeQuery = t
        .replace(/["']\s*\+\s*\w+\s*\+\s*["']/g, '?')
        .replace(/\+\s*\w+\s*\+\s*["']/g, '?')
        .replace(/["']\s*\+\s*\w+/g, '?');

      const indent = ' '.repeat(line.search(/\S/));
      const executeLine = `${indent}// ✅ Parameterized: [${params}]`;

      repairs.push({
        line: ln,
        title: 'SQL Injection Fix',
        before: t,
        after: safeQuery.trim(),
        params: allVars,
        confidence: 0.85,
      });

      repairedCode = repairedCode.replace(line, safeQuery + '\n' + executeLine);
    }

    // Pattern 2: f-string SQL (Python)
    const pySqlF = t.match(/f["'](SELECT[^"']+\{[^}]+\}[^"']*)['"]/i);
    if (pySqlF) {
      const vars = [...t.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
      let safeQuery = t.replace(/f["']/, '"').replace(/\{[^}]+\}/g, '%s').replace(/"$/, '"');
      const indent = ' '.repeat(line.search(/\S/));
      const paramsLine = `${indent}# params: (${vars.join(', ')},)`;

      repairs.push({
        line: ln, title: 'Python SQL f-string Fix',
        before: t, after: safeQuery.trim(),
        params: vars, confidence: 0.82,
      });

      repairedCode = repairedCode.replace(line, safeQuery + '\n' + paramsLine);
    }
  });

  return { repairedCode, repairs };
}

function extractConcatVars(line) {
  const vars = [];
  const matches = line.matchAll(/\+\s*(\w+)\s*\+?/g);
  for (const m of matches) {
    if (!['AND','OR','WHERE','LIKE','SELECT','FROM','JOIN','NULL'].includes(m[1].toUpperCase())) {
      vars.push(m[1]);
    }
  }
  return vars;
}

// ═══════════════════════════════════════════════════════
// 5. Refactoring Suggester
// ═══════════════════════════════════════════════════════

function suggestRefactoring(code, fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const lines = code.split('\n');
  const suggestions = [];

  // Extract Method — دالة كبيرة
  let funcStart = -1, funcName = '', braceDepth = 0;
  lines.forEach((line, i) => {
    const t = line.trim();
    const funcMatch = t.match(/(?:function\s+(\w+)|def\s+(\w+)|public\s+\w+\s+(\w+)\s*\()/);
    if (funcMatch) {
      funcStart = i;
      funcName = funcMatch[1] || funcMatch[2] || funcMatch[3] || 'unknown';
      braceDepth = ext === 'py' ? 1 : 0;
    }
    if (ext !== 'py') {
      braceDepth += (t.match(/\{/g)||[]).length - (t.match(/\}/g)||[]).length;
      if (funcStart >= 0 && braceDepth <= 0 && i > funcStart) {
        const len = i - funcStart;
        if (len > 40) {
          suggestions.push({
            type: 'EXTRACT_METHOD',
            line: funcStart + 1,
            title: `♻️ Extract Method: ${funcName}() طويلة (${len} سطر)`,
            description: `قسّم ${funcName}() إلى ${Math.ceil(len/20)} دوال أصغر`,
            priority: len > 80 ? 'HIGH' : 'MEDIUM',
          });
        }
        funcStart = -1;
      }
    }
  });

  // Duplicate Code Detection
  const lineHashes = new Map();
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.length < 20 || t.startsWith('//') || t.startsWith('#')) return;
    if (lineHashes.has(t)) {
      suggestions.push({
        type: 'REMOVE_DUPLICATE',
        line: i + 1,
        title: `🔄 كود مكرر في السطر ${lineHashes.get(t) + 1} و ${i + 1}`,
        description: 'استخرج الكود المكرر إلى دالة مشتركة',
        priority: 'MEDIUM',
      });
    } else {
      lineHashes.set(t, i);
    }
  });

  // Long Parameter List
  lines.forEach((line, i) => {
    const funcDecl = line.match(/function\s+\w+\s*\(([^)]+)\)|def\s+\w+\s*\(([^)]+)\)/);
    if (funcDecl) {
      const params = (funcDecl[1] || funcDecl[2] || '').split(',');
      if (params.length > 4) {
        suggestions.push({
          type: 'REDUCE_PARAMS',
          line: i + 1,
          title: `📦 كثير parameters: ${params.length} معامل`,
          description: 'استخدم Object/config parameter بدل معاملات منفصلة',
          priority: 'LOW',
        });
      }
    }
  });

  return suggestions;
}

// ═══════════════════════════════════════════════════════
// 6. Main Intelligence Function
// ═══════════════════════════════════════════════════════

function analyzeWithIntelligence(code, fileName) {
  const ext = fileName.split('.').pop().toLowerCase();

  // 1. بناء خريطة المتغيرات
  const varMap = buildVariableMap(code, ext);

  // 2. نشر التلوث
  propagateTaint(varMap, code, ext);

  // 3. اكتشاف الـ sinks الخطيرة
  const taintIssues = detectTaintedSinks(varMap, code, fileName);

  // 4. إصلاح SQL
  const sqlRepair = repairSQLInjection(code);

  // 5. اقتراحات refactoring
  const refactoring = suggestRefactoring(code, fileName);

  // 6. إحصائيات التلوث
  const taintedVars = [...varMap.values()].filter(v => v.tainted);

  return {
    taintIssues,
    taintedVars: taintedVars.map(v => ({
      name: v.name, source: v.source, line: v.line,
    })),
    sqlRepair: {
      repairs: sqlRepair.repairs,
      repairedCode: sqlRepair.repairedCode,
    },
    refactoring,
    summary: {
      varsTracked:    varMap.size,
      varsTainted:    taintedVars.length,
      taintIssues:    taintIssues.length,
      sqlFixed:       sqlRepair.repairs.length,
      refactorings:   refactoring.length,
    },
  };
}
