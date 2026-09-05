// ═══════════════════════════════════════════════════════
// dart_analyzer.js v1.0 — Dart/Flutter Analysis
// ═══════════════════════════════════════════════════════

function analyzeDart(code, fileName) {
  const issues = [];
  const lines  = code.split('\n');

  lines.forEach((line, i) => {
    const t  = line.trim();
    const ln = i + 1;
    if (t.startsWith('//') || t.startsWith('*')) return;

    // Null safety — ! operator
    if (/\w+!\s*[;,).]/.test(t)) {
      issues.push({ type:'dart', sev:'h', line:ln, ev:t,
        title:'🟠 Null assertion ! — قد يسبب Null exception',
        fix:'// تحقق من القيمة قبل استخدام ! أو استخدم ?.',
        conf:82, cIcon:'🟠', cAct:'Null Safety' });
    }

    // setState في async
    if (/setState\s*\(/.test(t)) {
      const prev = lines.slice(Math.max(0,i-5),i).join('\n');
      if (/async\s+\{/.test(prev) || /await\b/.test(prev)) {
        issues.push({ type:'dart', sev:'h', line:ln, ev:t,
          title:'🟠 setState بعد async — قد يسبب crash',
          fix:'// تحقق: if (mounted) setState(() { ... });',
          conf:85, cIcon:'🟠', cAct:'Flutter Lifecycle' });
      }
    }

    // print() في production
    if (/^\s*print\s*\(/.test(line)) {
      issues.push({ type:'dart', sev:'l', line:ln, ev:t,
        title:'🔵 print() في production — استخدم logger',
        fix:'// استخدم: debugPrint() أو logger package',
        conf:75, cIcon:'🔵', cAct:'Best Practice' });
    }

    // Empty catch
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(t)) {
      issues.push({ type:'dart', sev:'m', line:ln, ev:t,
        title:'🟡 Empty catch — أخطاء مخفية',
        fix:'// أضف: print(e); أو logger.error(e);',
        conf:88, cIcon:'🟡', cAct:'Error Handling' });
    }

    // SQL Injection في sqflite
    if (/(?:rawQuery|execute|rawInsert|rawUpdate).*\$\{/.test(t)) {
      issues.push({ type:'dart', sev:'c', line:ln, ev:t,
        title:'🔴 SQL Injection في sqflite',
        fix:'// استخدم: db.query(table, where: "id = ?", whereArgs: [id])',
        conf:92, cIcon:'🔴', cAct:'CWE-89 SQL Injection' });
    }

    // StreamSubscription بدون cancel
    if (/StreamSubscription\s+\w+/.test(t)) {
      const full = lines.join('\n');
      if (!full.includes('.cancel()')) {
        issues.push({ type:'dart', sev:'m', line:ln, ev:t,
          title:'🟡 StreamSubscription — تذكر .cancel() في dispose()',
          fix:'// أضف في dispose(): subscription.cancel();',
          conf:78, cIcon:'🟡', cAct:'Memory Leak' });
      }
    }

    // AnimationController بدون dispose
    if (/AnimationController\s+\w+/.test(t)) {
      const full = lines.join('\n');
      if (!full.includes('dispose()') || !full.includes('controller')) {
        issues.push({ type:'dart', sev:'m', line:ln, ev:t,
          title:'🟡 AnimationController — تذكر dispose()',
          fix:'// أضف في dispose(): _controller.dispose();',
          conf:80, cIcon:'🟡', cAct:'Memory Leak' });
      }
    }
  });

  return issues;
}
