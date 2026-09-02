// ═══════════════════════════════════════════════════════
// typescript_analyzer.js v1.0
// TypeScript Analysis — Types, Interfaces, Generics
// ═══════════════════════════════════════════════════════

function analyzeTypeScript(code, fileName) {
  const lines = code.split('\n');
  const issues = [];
  const types = [];
  const interfaces = [];
  const functions = [];

  lines.forEach((line, i) => {
    const t = line.trim();
    const ln = i + 1;
    if (t.startsWith('//') || t.startsWith('*')) return;

    // ─── 1. Interface extraction ──────────────────────
    const ifaceMatch = t.match(/^(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?\s*\{/);
    if (ifaceMatch) {
      interfaces.push({ name: ifaceMatch[1], extends: ifaceMatch[2], line: ln });
    }

    // ─── 2. Type alias ────────────────────────────────
    const typeMatch = t.match(/^(?:export\s+)?type\s+(\w+)\s*(?:<[^>]+>)?\s*=/);
    if (typeMatch) {
      types.push({ name: typeMatch[1], line: ln });
    }

    // ─── 3. Function with return type ─────────────────
    const fnMatch = t.match(/(?:async\s+)?function\s+(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)\s*:\s*([\w<>\[\]|&]+)/);
    if (fnMatch) {
      functions.push({ name: fnMatch[1], returnType: fnMatch[2], line: ln });
    }

    // ─── 4. any type usage ────────────────────────────
    if (/:\s*any\b/.test(t) && !/\/\//.test(t.split(':')[0])) {
      issues.push({
        type: 'ts', sev: 'm', line: ln, ev: t,
        title: '🟡 استخدام any يُفقد فائدة TypeScript',
        fix: '// حدد النوع الصحيح بدل any',
        conf: 80, cIcon: '🟡', cAct: 'Weak typing',
        cEv: ['any يلغي فائدة TypeScript — استخدم نوعاً محدداً'],
      });
    }

    // ─── 5. Type assertion بدون تحقق ─────────────────
    if (/as\s+\w+/.test(t) && !/as\s+const/.test(t) && !/\/\//.test(t)) {
      issues.push({
        type: 'ts', sev: 'l', line: ln, ev: t,
        title: '🔵 Type assertion قد يخفي أخطاء',
        fix: '// تحقق من النوع قبل الـ assertion',
        conf: 65, cIcon: '🔵', cAct: 'Unsafe assertion',
        cEv: ['as Type قد يتسبب في runtime errors لو النوع غلط'],
      });
    }

    // ─── 6. Non-null assertion ────────────────────────
    if (/\w+!\./.test(t) || /\w+!;/.test(t)) {
      issues.push({
        type: 'ts', sev: 'm', line: ln, ev: t,
        title: '🟡 Non-null assertion قد يسبب NPE',
        fix: t.replace(/(\w+)!\./, '$1?.'),
        conf: 75, cIcon: '🟡', cAct: 'Potential null crash',
        cEv: ['! assertion خطير — استخدم ?. بدله'],
      });
    }

    // ─── 7. Missing return type ───────────────────────
    const fnNoType = t.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/);
    if (fnNoType && !/:\s*\w/.test(t)) {
      issues.push({
        type: 'ts', sev: 'l', line: ln, ev: t,
        title: `🔵 دالة بدون return type: ${fnNoType[1]}()`,
        fix: `// أضف return type: function ${fnNoType[1]}(...): ReturnType`,
        conf: 60, cIcon: '🔵', cAct: 'Missing type annotation',
        cEv: ['إضافة return type يحسن safety والـ autocomplete'],
      });
    }

    // ─── 8. Enum بدل const object ─────────────────────
    if (/^(?:export\s+)?enum\s+\w+/.test(t)) {
      issues.push({
        type: 'ts', sev: 'l', line: ln, ev: t,
        title: '🔵 Enum — فكّر في const object بدله',
        fix: '// const STATUS = { ACTIVE: "active" } as const',
        conf: 55, cIcon: '🔵', cAct: 'Enum overhead',
        cEv: ['const object أخف من enum ويدعم tree-shaking'],
      });
    }

    // ─── 9. Promise بدون error handling ──────────────
    if (/\.then\s*\(/.test(t) && !lines.slice(i, i+5).some(l => /\.catch\s*\(|try\s*\{/.test(l))) {
      issues.push({
        type: 'ts', sev: 'm', line: ln, ev: t,
        title: '🟡 Promise بدون .catch()',
        fix: t.replace(/\.then\(/, '.then(').replace(/;$/, '.catch(err => console.error(err));'),
        conf: 72, cIcon: '🟡', cAct: 'Unhandled Promise rejection',
        cEv: ['أضف .catch() أو استخدم try/await/catch'],
      });
    }

    // ─── 10. Optional chaining missing ────────────────
    if (/\w+\.\w+\.\w+/.test(t) && !/\?\./g.test(t) && !/\/\//.test(t)) {
      const chain = t.match(/(\w+\.\w+\.\w+)/);
      if (chain) {
        issues.push({
          type: 'ts', sev: 'l', line: ln, ev: t,
          title: '🔵 استخدم Optional Chaining ?.',
          fix: t.replace(/(\w+)\.(\w+)\.(\w+)/, '$1?.$2?.$3'),
          conf: 58, cIcon: '🔵', cAct: 'Possible undefined access',
          cEv: ['استخدم ?. لتجنب TypeError عند null/undefined'],
        });
      }
    }
  });

  return {
    issues,
    types,
    interfaces,
    functions,
    summary: {
      types:      types.length,
      interfaces: interfaces.length,
      functions:  functions.length,
      issues:     issues.length,
    },
  };
}
