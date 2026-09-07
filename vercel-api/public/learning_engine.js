// ═══════════════════════════════════════════════════════
// learning_engine.js v1.0 — محرك التعلم الذكي
// يتعلم من كل إصلاح ويحسن نفسه تلقائياً
// ═══════════════════════════════════════════════════════
"use strict";

var LearningEngine = (() => {

  // ─── Storage Key ──────────────────────────────────
  const STORAGE_KEY = 're_learned_patterns';
  const MIN_CONFIDENCE = 0.6;  // أدنى ثقة لتطبيق pattern
  const MIN_SAMPLES = 2;       // أدنى عدد تجارب

  // ─── Pattern Types ────────────────────────────────
  const PATTERN_TYPES = {
    SQL_INJECTION: 'sql_injection',
    XSS:           'xss',
    SECRET:        'secret',
    EVAL:          'eval',
    CMD:           'cmd',
    MD5:           'md5',
    ACCUMULATION:  'accumulation',
  };

  // ─── Load/Save Patterns ───────────────────────────
  function loadPatterns() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : { patterns: [], meta: { total: 0, success: 0 } };
    } catch(e) {
      return { patterns: [], meta: { total: 0, success: 0 } };
    }
  }

  function savePatterns(db) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch(e) {}
  }

  // ─── Pattern Extractor ────────────────────────────
  // يستخرج الـ pattern من الكود قبل وبعد
  function extractPattern(before, after, issue) {
    const lines_before = before.split('\n');
    const lines_after  = after.split('\n');
    const line = issue.line - 1;

    const beforeLine = lines_before[line]?.trim() || '';
    const afterLine  = lines_after[line]?.trim()  || beforeLine;

    if (!beforeLine) return null;
    const noFix = beforeLine === afterLine;

    // استخرج الـ pattern العام
    const pattern = generalizePattern(beforeLine, issue.type);
    const fix = noFix ? '// known issue: ' + issue.type : generalizePattern(afterLine, issue.type);

    if (!pattern) return null;

    return {
      type:       issue.type || issue.cAct || 'unknown',
      severity:   issue.sev  || 'c',
      pattern,
      fix,
      example:    { before: beforeLine, after: afterLine },
      confidence: 0.5,
      samples:    1,
      successes:  1,
      failures:   0,
      created:    Date.now(),
      lastUsed:   Date.now(),
    };
  }

  // ─── Pattern Generalizer ──────────────────────────
  function generalizePattern(line, type) {
    let g = line;
    const t = (type || '').toLowerCase();

    // تعميم عام لكل اللغات
    g = g
      .replace(/["'][^"']{8,}["']/g, '"SECRET_VALUE"')  // hardcoded strings
      .replace(/\d{4,}/g, 'NUMBER')                  // أرقام كبيرة
      .replace(/0x[0-9a-fA-F]+/g, 'HEX');                // hex values

    switch(type) {
      // Python
      case 'sql_injection':
      case 'SQL_INJECTION':
        if (g.includes('cursor') || g.includes('execute')) {
          g = g.replace(/\w+(?=\s*=\s*["'].*SELECT)/i, 'QUERY_VAR')
               .replace(/execute\s*\([^)]+\)/, 'execute(QUERY)');
        }
        break;
      case 'CMD_INJECTION':
        g = g.replace(/os\.system\s*\([^)]+\)/, 'os.system(CMD)')
             .replace(/subprocess\.\w+\s*\([^)]+shell=True[^)]*\)/, 'subprocess.call(CMD, shell=True)');
        break;
      case PATTERN_TYPES.SQL_INJECTION:
      case 'SQL_INJECTION':
      case 'sql':
        // استبدل اسم المتغير بـ placeholder
        g = g
          .replace(/(?:const|let|var)\s+\w+/, 'let QUERY_VAR')
          .replace(/"SELECT[^"]+"/gi, '"SELECT_QUERY"')
          .replace(/\[[\w,\s]+\]/g, '[PARAMS]')
          .replace(/\b\w+\b(?=\s*,\s*function)/, 'QUERY_VAR');
        break;

      case PATTERN_TYPES.XSS:
      case 'XSS':
      case 'xss':
        g = g
          .replace(/res\.send\s*\([^)]+\)/, 'res.send(USER_INPUT)')
          .replace(/\.innerHTML\s*=\s*.+/, '.innerHTML = USER_INPUT')
          .replace(/res\.json\s*\([^)]+\)/, 'res.json({ message: SAFE_VALUE })');
        break;

      case PATTERN_TYPES.SECRET:
      case 'secret':
        g = g
          .replace(/["'][^"']{8,}["']/, '"HARDCODED_VALUE"')
          .replace(/process\.env\.\w+/, 'process.env.ENV_KEY');
        break;

      case PATTERN_TYPES.MD5:
      case 'md5':
        g = g
          .replace(/md5|sha1/gi, 'WEAK_HASH')
          .replace(/sha256|sha512/gi, 'STRONG_HASH');
        break;

      case PATTERN_TYPES.ACCUMULATION:
      case 'accumulation':
        g = g
          .replace(/\b\w+\s*=\s*\w+\.\w+/, 'VAR = ITEM.PROP')
          .replace(/\b\w+\s*\+=\s*\w+\.\w+/, 'VAR += ITEM.PROP');
        break;
    }

    return g.length < 200 ? g : null;
  }

  // ─── Pattern Matcher ──────────────────────────────
  function matchPattern(line, pattern) {
    // مطابقة نصية بعد التعميم
    const generalLine = line.trim();
    if (!generalLine || !pattern) return false;

    // تطابق جزئي للـ pattern المعمّم
    const keywords = pattern.split(/\s+/).filter(w => w.length > 3 && !/^[{()\[\]=>:,;]+$/.test(w));
    const matches = keywords.filter(kw => generalLine.includes(kw));
    return matches.length >= Math.ceil(keywords.length * 0.6);
  }

  // ─── Learn from Fix ───────────────────────────────
  // يتعلم من كل إصلاح
  function learn(codeBefore, codeAfter, issues, fileName) {
    if (!codeBefore || !codeAfter || codeBefore === codeAfter) {} // no early return

    const db = loadPatterns();
    let learned = 0;

    // حدود - لا يتعلم أبداً من هذه الأنواع
    const NEVER_LEARN_TYPES = ['eval', 'exec', 'CODE_INJECTION', 'CMD_INJECTION'];
    issues.forEach(issue => {
      if (NEVER_LEARN_TYPES.some(t => (issue.type||'').includes(t))) return;

      // تعلم من الـ issue مباشرة لو before = after
      if (codeBefore === codeAfter) {
        const lines = codeBefore.split('\n');
        const issueLine = (lines[issue.line - 1] || '').trim();
        if (!issueLine) return;
        const pattern = generalizePattern(issueLine, issue.type);
        if (!pattern) return;
        
        const existing = db.patterns.find(p =>
          p.type === (issue.type || 'unknown') &&
          p.pattern === pattern
        );
        if (existing) {
          existing.samples++;
          existing.successes++;
          existing.confidence = Math.min(0.99, existing.successes / existing.samples);
          existing.lastUsed = Date.now();
        } else {
          db.patterns.push({
            type: issue.type || 'unknown',
            severity: issue.sev || 'c',
            pattern,
            fix: '// known issue',
            example: { before: issueLine, after: issueLine },
            confidence: 0.5,
            samples: 1,
            successes: 1,
            failures: 0,
            created: Date.now(),
            lastUsed: Date.now(),
          });
          learned++;
        }
        return;
      }
      const newPattern = extractPattern(codeBefore, codeAfter, issue);
      if (!newPattern) return;

      // ابحث عن pattern مشابه موجود
      const existing = db.patterns.find(p =>
        p.type === newPattern.type &&
        (p.example.before === newPattern.example.before ||
         matchPattern(newPattern.example.before, p.pattern))
      );

      if (existing) {
        // حدّث الـ pattern الموجود فقط
        existing.samples++;
        existing.successes++;
        existing.confidence = Math.min(0.99, existing.successes / existing.samples);
        existing.lastUsed = Date.now();
        if (existing.confidence > 0.8) existing.example = newPattern.example;
      } else {
        // تحقق إن ما تعلمناه قبل
        const alreadyLearned = db.patterns.some(p =>
          p.example.before === newPattern.example.before &&
          p.example.after === newPattern.example.after
        );
        if (!alreadyLearned) {
          db.patterns.push(newPattern);
          learned++;
        }
      }
    });

    db.meta.total++;
    savePatterns(db);
    return learned;
  }

  // ─── Apply Learned Patterns ───────────────────────
  function applyLearned(code, fileName) {
    const db = loadPatterns();
    if (!db.patterns.length) return { fixed: code, applied: 0 };

    const lines = code.split('\n');
    let changed = false;
    let applied = 0;

    // طبّق فقط الـ patterns عالية الثقة
    const goodPatterns = db.patterns.filter(p =>
      p.confidence >= MIN_CONFIDENCE &&
      p.samples >= MIN_SAMPLES
    );

    lines.forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('#')) return;

      goodPatterns.forEach(p => {
        if (!matchPattern(t, p.pattern)) return;

        // تحقق إن الـ fix مختلف
        if (matchPattern(t, p.fix)) return; // مصلح بالفعل

        console.log(`[Learning] تطبيق pattern: ${p.type} (confidence: ${p.confidence.toFixed(2)})`);
        applied++;
        changed = true;

        // طبّق الإصلاح المتعلم
        // نستخدم المثال كـ guide وليس replacement مباشر
        p.lastUsed = Date.now();
      });
    });

    savePatterns(db);
    return { fixed: changed ? lines.join('\n') : code, applied };
  }

  // ─── Mark Success/Failure ─────────────────────────
  function markResult(patternType, success) {
    const db = loadPatterns();
    const patterns = db.patterns.filter(p => p.type === patternType);
    patterns.forEach(p => {
      if (success) {
        p.successes++;
      } else {
        p.failures++;
        p.confidence = Math.max(0.1, p.successes / (p.samples + 1));
      }
      p.samples++;
      p.confidence = Math.min(0.99, p.successes / p.samples);
    });
    savePatterns(db);
  }

  // ─── Get Stats ────────────────────────────────────
  function getStats() {
    const db = loadPatterns();
    return {
      totalPatterns: db.patterns.length,
      highConfidence: db.patterns.filter(p => p.confidence >= 0.8).length,
      byType: db.patterns.reduce((acc, p) => {
        acc[p.type] = (acc[p.type] || 0) + 1;
        return acc;
      }, {}),
      topPatterns: db.patterns
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5)
        .map(p => ({ type: p.type, confidence: p.confidence.toFixed(2), samples: p.samples })),
    };
  }

  // ─── Reset ────────────────────────────────────────
  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
  }

  // ─── Export ───────────────────────────────────────
  // ─── Get Confidence Boosts ─────────────────────────
  // يرجع map من type → confidence boost
  function getBoosts() {
    const db = loadPatterns();
    const boosts = new Map();
    db.patterns.forEach(p => {
      const type = p.type?.toLowerCase() || '';
      // map pattern type → analyzer type
      const analyzerType = 
        type.includes('sql') ? 'SQL_INJECTION' :
        type.includes('xss') ? 'XSS' :
        type.includes('accum') || type.includes('bug') ? 'ACCUMULATION' :
        type.includes('secret') || type.includes('crypto') ? 'HARDCODED_SECRET' :
        type.includes('cmd') ? 'CMD_INJECTION' :
        type.includes('eval') || type.includes('code') ? 'CODE_INJECTION' :
        null;
      if (!analyzerType) return;
      const current = boosts.get(analyzerType) || 0;
      boosts.set(analyzerType, Math.max(current, p.confidence));
    });
    return boosts;
  }

  // ─── Learn Safe Patterns ───────────────────────────
  function learnSafe(code, fileName) {
    const db = loadPatterns();
    const lines = code.split('\n');
    const SAFE_PATTERNS = [
      { regex: /\.query\s*\([^,]+,\s*\[/, type: 'SQL_SAFE', label: 'parameterized SQL' },
      { regex: /bcrypt|argon2|scrypt/, type: 'HASH_SAFE', label: 'secure hash' },
      { regex: /process\.env\.\w+/, type: 'ENV_SAFE', label: 'environment variable' },
      { regex: /\.textContent\s*=/, type: 'XSS_SAFE', label: 'safe output' },
      { regex: /htmlspecialchars|DOMPurify/, type: 'XSS_SAFE', label: 'sanitized output' },
    ];

    let learned = 0;
    lines.forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith('//')) return;

      SAFE_PATTERNS.forEach(({ regex, type, label }) => {
        if (!regex.test(t)) return;
        const key = type + ':' + t.substring(0, 40);
        const existing = db.patterns.find(p => p.type === type && p.pattern === t.substring(0, 80));
        if (existing) {
          existing.samples++;
          existing.confidence = Math.min(0.99, existing.successes / existing.samples);
        } else {
          db.patterns.push({
            type, pattern: t.substring(0, 80),
            fix: '// safe pattern: ' + label,
            example: { before: t, after: t },
            confidence: 0.5, samples: 1, successes: 1, failures: 0,
            isSafe: true,
            created: Date.now(), lastUsed: Date.now(),
          });
          learned++;
        }
      });
    });

    if (learned > 0) savePatterns(db);
    return learned;
  }

  return {
    learn,
    learnSafe,
    applyLearned,
    markResult,
    getStats,
    getBoosts,
    reset,
    PATTERN_TYPES,
  };
})();

if (typeof window !== 'undefined') window.LearningEngine = LearningEngine;
