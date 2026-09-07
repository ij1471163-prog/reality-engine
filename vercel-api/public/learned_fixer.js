// ═══════════════════════════════════════════════════════
// learned_fixer.js v1.0 — يطبق ما تعلمه المحرك بذكاء
// يفهم النمط العام ويطبقه على كود جديد
// ═══════════════════════════════════════════════════════
"use strict";

var LearnedFixer = (() => {

  // ─── Pattern Generalizers ─────────────────────────
  const GENERALIZERS = {
    // accumulation: x = y.z → x += y.z
    accumulation: {
      detect: /(\w+)\s*=(?!=|\+)\s*(\w+\.\w+)\s*;/,
      fix: (line, m) => line.replace(`${m[1]} = ${m[2]}`, `${m[1]} += ${m[2]}`),
      validate: (before, after) => after.includes('+=') && !before.includes('+='),
    },

    // SQL: "SELECT..." + var → "SELECT...?" , [var]
    sql: {
      detect: /["'`]([^"'`]*(?:SELECT|INSERT|UPDATE|DELETE)[^"'`]*)["'`]\s*\+\s*(\w+)/i,
      fix: (line, m) => {
        const base = m[1].replace(/['"]/g, '').trimEnd();
        const param = m[2];
        return line.replace(m[0], `"${base}?" , [${param}]`);
      },
      validate: (before, after) => after.includes('?') && after.includes('['),
    },

    // secret: const X = "value" → const X = process.env.X
    secret: {
      detect: /(?:const|let|var)\s+(\w+)\s*=\s*["'][^"']{6,}["']/,
      fix: (line, m) => {
        // تحقق إن المتغير secret حقيقي
        if (!/KEY|SECRET|TOKEN|PASSWORD|PASS|API/i.test(m[1])) return line;
        return line.replace(/=\s*["'][^"']+["']/, `= process.env.${m[1]}`);
      },
      validate: (before, after) => after.includes('process.env') && before !== after,
    },

    // crypto: md5/sha1 → sha256
    crypto: {
      detect: /createHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)/i,
      fix: (line) => line.replace(/['"](?:md5|sha1)['"]/i, '"sha256"'),
      validate: (before, after) => after.includes('sha256'),
    },

    // var → let
    var: {
      detect: /^\s*var\s+/,
      fix: (line) => line.replace(/\bvar\b/, 'let'),
      validate: (before, after) => !after.includes('var '),
    },

    // XSS: innerHTML = x → textContent = x
    xss_dom: {
      detect: /\.innerHTML\s*=\s*(?!['"`])/,
      fix: (line) => line.replace('.innerHTML', '.textContent'),
      validate: (before, after) => after.includes('textContent'),
    },

    // JWT no expiry → add expiresIn
    jwt: {
      detect: /jwt\.sign\s*\([^)]+\)\s*(?!.*expiresIn)/,
      fix: (line) => line.replace(/jwt\.sign\s*\(([^)]+)\)/, (m, args) => {
        const parts = args.split(',');
        if (parts.length >= 2 && !args.includes('expiresIn')) {
          return `jwt.sign(${parts[0]}, ${parts[1]}, { expiresIn: '1h' })`;
        }
        return m;
      }),
      validate: (before, after) => after.includes('expiresIn'),
    },
  };

  // ─── Apply Learned Patterns ───────────────────────
  function apply(code, fileName, learnedPatterns) {
    if (!learnedPatterns || learnedPatterns.length === 0) return { code, applied: 0 };

    const ext = (fileName || '').split('.').pop().toLowerCase();
    const lines = code.split('\n');
    let applied = 0;

    // فلتر الـ patterns ذات الـ confidence العالي
    const highConf = learnedPatterns.filter(p => 
      p.confidence >= 0.75 && 
      p.samples >= 2 &&
      p.example && 
      p.example.before !== p.example.after
    );

    lines.forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('#')) return;

      // جرب كل generalizer
      Object.entries(GENERALIZERS).forEach(([type, gen]) => {
        // هل في learned pattern من هذا النوع؟
        const hasLearned = highConf.some(p => 
          p.type && p.type.toLowerCase().includes(type.toLowerCase().split('_')[0])
        );
        if (!hasLearned) return;

        const m = t.match(gen.detect);
        if (!m) return;

        // تطبيق الإصلاح
        const fixed = gen.fix(line, m);
        if (fixed === line) return;

        // تحقق من الإصلاح
        if (gen.validate && !gen.validate(line, fixed)) return;

        lines[i] = fixed;
        applied++;
      });
    });

    return { code: lines.join('\n'), applied };
  }

  // ─── Smart Apply ──────────────────────────────────
  // يطبق الـ patterns المتعلمة بناءً على الـ context
  function smartApply(code, fileName) {
    if (typeof LearningEngine === 'undefined') return { code, applied: 0 };

    try {
      const stats = LearningEngine.getStats();
      if (stats.totalPatterns === 0) return { code, applied: 0 };

      // احصل على الـ patterns
      const db = JSON.parse(
        (typeof localStorage !== 'undefined' ? localStorage.getItem('re_learned_patterns') : null) 
        || '{"patterns":[]}'
      );

      return apply(code, fileName, db.patterns);
    } catch(e) {
      return { code, applied: 0 };
    }
  }

  return { apply, smartApply, GENERALIZERS };
})();

if (typeof window !== 'undefined') window.LearnedFixer = LearnedFixer;
if (typeof module !== 'undefined') module.exports = LearnedFixer;
