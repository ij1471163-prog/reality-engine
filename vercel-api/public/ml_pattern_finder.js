// ═══════════════════════════════════════════════════════
// ml_pattern_finder.js — يكتشف patterns معقدة
// يحاكي ML-based detection بقواعد متقدمة
// ═══════════════════════════════════════════════════════

function findMLPatterns(code, fileName) {
  const issues = [];
  const lines  = code.split('\n');
  const ext    = fileName.split('.').pop().toLowerCase();

  // ─── 1. Race Condition ───────────────────────────────
  detectRaceConditions(lines, issues, ext);

  // ─── 2. Memory Leaks ─────────────────────────────────
  detectMemoryLeaks(lines, issues, ext);

  // ─── 3. Infinite Loop ────────────────────────────────
  detectInfiniteLoops(lines, issues, ext);

  // ─── 4. Dead Code ────────────────────────────────────
  detectDeadCode(lines, issues, ext);

  // ─── 5. God Function ─────────────────────────────────
  detectGodFunctions(lines, issues, ext);

  // ─── 6. Magic Numbers ────────────────────────────────
  detectMagicNumbers(lines, issues, ext);

  // ─── 7. Callback Hell ────────────────────────────────
  detectCallbackHell(lines, issues, ext);

  // ─── 8. Type Confusion ───────────────────────────────
  detectTypeConfusion(lines, issues, ext);

  return issues;
}

// ─── Race Condition ───────────────────────────────────

function detectRaceConditions(lines, issues, ext) {
  let hasAsync = false;
  let hasSharedState = false;
  const sharedVars = new Set();

  lines.forEach((line, i) => {
    const t = line.trim();
    if (/\basync\b|\bawait\b/.test(t)) hasAsync = true;

    // متغيرات مشتركة في async context
    const varMatch = t.match(/(?:let|var)\s+(\w+)\s*=/);
    if (varMatch && !/const/.test(t)) sharedVars.add(varMatch[1]);

    if (hasAsync && sharedVars.size > 0) {
      sharedVars.forEach(v => {
        if (new RegExp(`\\b${v}\\b\\s*[+\\-*]?=`).test(t) && t.includes('await')) {
          issues.push({
            type: 'pattern', sev: 'h', line: i + 1, ev: t,
            title: '🟠 Race Condition محتمل',
            fix: '// استخدم mutex أو atomic operations',
            conf: 70, cIcon: '🟠', cAct: 'تعديل متغير مشترك في async context',
            cEv: [`المتغير ${v} قد يُعدَّل من عدة async operations في نفس الوقت`],
          });
          sharedVars.delete(v);
        }
      });
    }
  });
}

// ─── Memory Leaks ─────────────────────────────────────

function detectMemoryLeaks(lines, issues, ext) {
  const eventListeners = [];
  const intervals = [];

  lines.forEach((line, i) => {
    const t = line.trim();
    const ln = i + 1;

    // addEventListener بدون removeEventListener
    if (/addEventListener\s*\(/.test(t)) {
      eventListeners.push({ line: ln, ev: t });
    }

    // setInterval بدون clearInterval
    if (/setInterval\s*\(/.test(t)) {
      intervals.push({ line: ln, ev: t });
    }

    // لو نهاية الكود وما في clearInterval
    if (i === lines.length - 1) {
      const hasCleanup = lines.some(l =>
        /clearInterval|removeEventListener|cleanup|destroy|dispose/i.test(l));

      if (!hasCleanup && intervals.length > 0) {
        intervals.forEach(int => {
          issues.push({
            type: 'pattern', sev: 'm', line: int.line, ev: int.ev,
            title: '🟡 Memory Leak محتمل: setInterval بدون clearInterval',
            fix: '// احفظ الـ ID وأضف clearInterval في cleanup',
            conf: 72, cIcon: '🟡', cAct: 'Memory leak',
            cEv: ['setInterval يسبب memory leak إذا لم يُوقف'],
          });
        });
      }
    }
  });
}

// ─── Infinite Loop ────────────────────────────────────

function detectInfiniteLoops(lines, issues, ext) {
  lines.forEach((line, i) => {
    const t = line.trim();
    const ln = i + 1;

    // while(true) بدون break
    if (/while\s*\(\s*true\s*\)/.test(t) || /while\s*\(\s*1\s*\)/.test(t)) {
      const block = lines.slice(i, Math.min(i + 20, lines.length)).join('\n');
      if (!/\bbreak\b|\breturn\b|\bthrow\b/.test(block)) {
        issues.push({
          type: 'pattern', sev: 'h', line: ln, ev: t,
          title: '🟠 Infinite Loop محتمل',
          fix: '// أضف break condition أو return',
          conf: 75, cIcon: '🟠', cAct: 'حلقة لا نهائية',
          cEv: ['while(true) بدون break يسبب تعطل البرنامج'],
        });
      }
    }

    // for loop بـ condition خاطئ
    if (/for\s*\(/.test(t)) {
      const forMatch = t.match(/for\s*\(\s*[^;]*;\s*([^;]*);\s*([^)]*)\)/);
      if (forMatch && !forMatch[2].trim()) {
        issues.push({
          type: 'pattern', sev: 'm', line: ln, ev: t,
          title: '🟡 for loop بدون increment',
          fix: '// أضف increment في الـ for loop',
          conf: 65, cIcon: '🟡', cAct: 'Loop قد يكون لا نهائي',
          cEv: ['for loop بدون increment قد يتسبب في infinite loop'],
        });
      }
    }
  });
}

// ─── Dead Code ────────────────────────────────────────

function detectDeadCode(lines, issues, ext) {
  lines.forEach((line, i) => {
    const t = line.trim();
    const ln = i + 1;

    // كود بعد return
    if (i > 0) {
      const prevLine = lines[i - 1].trim();
      if (/^return\b/.test(prevLine) && t && !t.startsWith('//') &&
          !t.startsWith('*') && !t.startsWith('}') && !t.startsWith('{')) {
        issues.push({
          type: 'pattern', sev: 'l', line: ln, ev: t,
          title: '🔵 Dead Code: كود بعد return',
          fix: '// احذف هذا السطر — لن يُنفَّذ أبداً',
          conf: 85, cIcon: '🔵', cAct: 'Unreachable code',
          cEv: ['الكود بعد return لن يُنفَّذ أبداً'],
        });
      }
    }

    // إسناد بدون استخدام
    if (/^(?:const|let|var)\s+(\w+)\s*=/.test(t)) {
      const varName = t.match(/(?:const|let|var)\s+(\w+)/)?.[1];
      if (varName) {
        const usedLater = lines.slice(i + 1).some(l =>
          new RegExp(`\\b${varName}\\b`).test(l)
        );
        if (!usedLater && !['i', 'j', 'k', '_', 'err', 'e'].includes(varName)) {
          issues.push({
            type: 'pattern', sev: 'l', line: ln, ev: t,
            title: `🔵 متغير غير مستخدم: ${varName}`,
            fix: `// احذف ${varName} أو استخدمه`,
            conf: 68, cIcon: '🔵', cAct: 'Unused variable',
            cEv: [`${varName} مُعرَّف لكن ما يُستخدم`],
          });
        }
      }
    }
  });
}

// ─── God Function ─────────────────────────────────────

function detectGodFunctions(lines, issues, ext) {
  let funcStart = -1;
  let funcName  = '';
  let braceDepth = 0;

  lines.forEach((line, i) => {
    const t = line.trim();
    const ln = i + 1;

    const funcMatch = t.match(/(?:function\s+(\w+)|(\w+)\s*=\s*(?:async\s*)?\()/);
    if (funcMatch && t.includes('{')) {
      funcStart = i;
      funcName  = funcMatch[1] || funcMatch[2] || 'anonymous';
      braceDepth = 1;
      return;
    }

    if (funcStart >= 0) {
      braceDepth += (t.match(/\{/g) || []).length;
      braceDepth -= (t.match(/\}/g) || []).length;

      if (braceDepth <= 0) {
        const funcLength = i - funcStart;
        if (funcLength > 50) {
          issues.push({
            type: 'pattern', sev: 'l', line: funcStart + 1, ev: `function ${funcName}`,
            title: `🔵 God Function: ${funcName}() (${funcLength} سطر)`,
            fix: `// قسّم ${funcName}() إلى دوال أصغر`,
            conf: 80, cIcon: '🔵', cAct: 'دالة كبيرة جداً',
            cEv: [`${funcName} يحتوي ${funcLength} سطر — يجب تقسيمها`],
          });
        }
        funcStart = -1;
        braceDepth = 0;
      }
    }
  });
}

// ─── Magic Numbers ────────────────────────────────────

function detectMagicNumbers(lines, issues, ext) {
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('#')) return;

    const numMatch = t.match(/[^a-zA-Z_$'"]\b(\d{3,})\b[^a-zA-Z_$'"]/);
    if (numMatch) {
      const num = parseInt(numMatch[1]);
      if (![100, 200, 201, 400, 401, 403, 404, 500, 1000].includes(num)) {
        issues.push({
          type: 'pattern', sev: 'l', line: i + 1, ev: t,
          title: `🔵 Magic Number: ${num}`,
          fix: `const LIMIT = ${num}; // ثم استخدم LIMIT`,
          conf: 60, cIcon: '🔵', cAct: 'رقم بدون تفسير',
          cEv: [`الرقم ${num} غير واضح المعنى — استخدم constant مسمى`],
        });
      }
    }
  });
}

// ─── Callback Hell ────────────────────────────────────

function detectCallbackHell(lines, issues, ext) {
  let maxNesting = 0;
  let currentNesting = 0;
  let maxLine = 0;

  lines.forEach((line, i) => {
    const callbacks = (line.match(/function\s*\(|=>\s*\{|\bcallback\b/g) || []).length;
    currentNesting += callbacks;
    currentNesting -= (line.match(/\}\s*\)/g) || []).length;
    if (currentNesting > maxNesting) {
      maxNesting = currentNesting;
      maxLine = i + 1;
    }
    if (currentNesting < 0) currentNesting = 0;
  });

  if (maxNesting >= 4) {
    issues.push({
      type: 'pattern', sev: 'm', line: maxLine, ev: '...',
      title: `🟡 Callback Hell: تداخل ${maxNesting} مستويات`,
      fix: '// استخدم async/await أو Promises',
      conf: 75, cIcon: '🟡', cAct: 'Callback Hell',
      cEv: [`تداخل ${maxNesting} مستويات من الـ callbacks — صعب القراءة والصيانة`],
    });
  }
}

// ─── Type Confusion ───────────────────────────────────

function detectTypeConfusion(lines, issues, ext) {
  if (!['js', 'ts', 'jsx'].includes(ext)) return;

  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//')) return;

    // مقارنة أنواع مختلطة
    if (/parseInt|parseFloat|Number\(/.test(t) && /==(?!=)/.test(t)) {
      issues.push({
        type: 'pattern', sev: 'm', line: i + 1, ev: t,
        title: '🟡 Type Confusion محتمل',
        fix: t.replace(/==/g, '==='),
        conf: 68, cIcon: '🟡', cAct: 'مقارنة بعد type conversion',
        cEv: ['استخدم === بعد parseInt/parseFloat لتجنب type coercion'],
      });
    }

    // typeof بدون ===
    if (/typeof\s+\w+\s*==(?!=)/.test(t)) {
      issues.push({
        type: 'pattern', sev: 'm', line: i + 1, ev: t,
        title: '🟡 typeof يحتاج ===',
        fix: t.replace(/typeof\s+(\w+)\s*==/, 'typeof $1 ==='),
        conf: 82, cIcon: '🟡', cAct: 'typeof مع ==',
        cEv: ['typeof دائماً يرجع string — استخدم ==='],
      });
    }
  });
}
