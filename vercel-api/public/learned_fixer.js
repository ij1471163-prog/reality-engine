// ═══════════════════════════════════════════════════════
// learned_fixer.js v2.0 — يطبق ما تعلمه المحرك
// © 2025 Naif Lucena — Reality Engine
// ═══════════════════════════════════════════════════════
"use strict";

var LearnedFixer = (() => {

  // ─── Pattern Generalizers ─────────────────────────
  const GENERALIZERS = {
    accumulation: {
      ext:      ['js', 'ts', 'py', 'php'],
      detect:   /(\w+)\s*=(?!=|\+)\s*(\w+\.\w+)\s*;/,
      fix:      (line, m) => line.replace(`${m[1]} = ${m[2]}`, `${m[1]} += ${m[2]}`),
      validate: (before, after) => after.includes('+=') && !before.includes('+='),
    },
    sql: {
      ext:      ['js', 'ts', 'py', 'php', 'java'],
      detect:   /["'`]([^"'`]*(?:SELECT|INSERT|UPDATE|DELETE)[^"'`]*)["'`]\s*\+\s*(\w+)/i,
      fix:      (line, m) => {
        const base = m[1].replace(/['"]/g, '').trimEnd();
        const param = m[2];
        return line.replace(m[0], `"${base}?" , [${param}]`);
      },
      validate: (before, after) => after.includes('?') && after.includes('['),
    },
    secret: {
      ext:      ['js', 'ts', 'py', 'php', 'java'],
      detect:   /(?:const|let|var)\s+(\w+)\s*=\s*["'][^"']{6,}["']/,
      fix:      (line, m) => {
        if (!/KEY|SECRET|TOKEN|PASSWORD|PASS|API/i.test(m[1])) return line;
        return line.replace(/=\s*["'][^"']+["']/, `= process.env.${m[1]}`);
      },
      validate: (before, after) => after.includes('process.env') && before !== after,
    },
    crypto: {
      ext:      ['js', 'ts'],
      detect:   /createHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)/i,
      fix:      (line) => line.replace(/['"](?:md5|sha1)['"]/i, '"sha256"'),
      validate: (before, after) => after.includes('sha256'),
    },
    xss_dom: {
      ext:      ['js', 'ts', 'html'],
      detect:   /\.innerHTML\s*=\s*(?!['"`])/,
      fix:      (line) => line.replace('.innerHTML', '.textContent'),
      validate: (before, after) => after.includes('textContent'),
    },
  };

  // ─── Apply ─────────────────────────────────────────
  function apply(code, fileName, learnedPatterns) {
    if (!learnedPatterns || learnedPatterns.length === 0) return { code, applied: 0 };

    const ext = (fileName || '').split('.').pop().toLowerCase();
    const lines = code.split('\n');
    let applied = 0;

    // فلتر patterns موثوقة فقط
    const approved = learnedPatterns.filter(p =>
      p.approved === true &&
      p.confidence >= 0.20 &&
      p.verified >= 2 &&
      p.before && p.after &&
      p.before !== p.after
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('#')) continue;

      // 1. Exact match أولاً — مرة وحدة
      const exactMatch = approved.find(p => t === p.before);
      if (exactMatch) {
        lines[i] = line.replace(exactMatch.before, exactMatch.after);
        applied++;
        continue; // لا تكمل Generalizers على نفس السطر
      }

      // 2. Generalizers — فقط لو ext مناسب ولو في pattern موافق
      for (const [type, gen] of Object.entries(GENERALIZERS)) {
        // تحقق ext
        if (gen.ext && !gen.ext.includes(ext)) continue;

        // تحقق وجود approved pattern من نفس النوع
        const hasApproved = approved.some(p =>
          p.type && p.type.toLowerCase().includes(type.split('_')[0])
        );
        if (!hasApproved) continue;

        const m = t.match(gen.detect);
        if (!m) continue;

        const fixed = gen.fix(line, m);
        if (fixed === line) continue;
        if (gen.validate && !gen.validate(line, fixed)) continue;

        lines[i] = fixed;
        applied++;
        break; // سطر واحد → generalizer واحد فقط
      }
    }

    return { code: lines.join('\n'), applied };
  }

  // ─── Smart Apply ──────────────────────────────────
  function smartApply(code, fileName) {
    if (typeof LearningEngine === 'undefined') return { code, applied: 0 };

    try {
      const raw = typeof localStorage !== 'undefined'
        ? localStorage.getItem('re_learned_patterns_v2')
        : null;
      const db = raw ? JSON.parse(raw) : { patterns: [] };
      return apply(code, fileName, db.patterns || []);
    } catch(e) {
      return { code, applied: 0 };
    }
  }

  return { apply, smartApply, GENERALIZERS };
})();

if (typeof window !== 'undefined') window.LearnedFixer = LearnedFixer;
if (typeof module !== 'undefined') module.exports = LearnedFixer;

