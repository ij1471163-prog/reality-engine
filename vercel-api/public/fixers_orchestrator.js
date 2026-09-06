// ═══════════════════════════════════════════════════════
// fixers_orchestrator.js v1.0
// يجمع كل الـ Fixers ويطبقهم بالترتيب الصح
// ═══════════════════════════════════════════════════════
"use strict";

function applySpecializedFixers(F, R) {
  const allFixers = [
    { name: 'Command Injection', fixer: typeof CommandInjectionFixer !== 'undefined' ? CommandInjectionFixer : null },
    { name: 'SQL Injection',     fixer: typeof SQLInjectionFixer !== 'undefined' ? SQLInjectionFixer : null },
    { name: 'JWT',               fixer: typeof JWTFixer !== 'undefined' ? JWTFixer : null },
    { name: 'XSS',               fixer: typeof XSSFixer !== 'undefined' ? XSSFixer : null },
    { name: 'Secrets',           fixer: typeof SecretsFixer !== 'undefined' ? SecretsFixer : null },
  ].filter(f => f.fixer !== null);

  const results = {};
  let totalFixed = 0;

  Object.keys(F).forEach(fn => {
    const issues = R[fn]?.issues || [];
    if (!issues.length) return;

    let code = F[fn];
    const fileRepairs = [];

    allFixers.forEach(({ name, fixer }) => {
      if (!fixer.canFix(issues)) return;
      const { fixed, changed } = fixer.fix(code, fn);
      if (changed) {
        fileRepairs.push({ fixer: name, file: fn });
        code = fixed;
      }
    });

    if (fileRepairs.length > 0 && code !== F[fn]) {
      F[fn] = code;
      R[fn] = { code, issues: typeof analyzeCode === 'function' ? analyzeCode(code, fn) : [] };
      totalFixed += fileRepairs.length;
      results[fn] = fileRepairs;
    }
  });

  return { totalFixed, results };
}
