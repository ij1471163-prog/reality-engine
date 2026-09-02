// ═══════════════════════════════════════════════════════
// kotlin_analyzer.js v1.0
// Kotlin Analysis — Android + Coroutines + Patterns
// ═══════════════════════════════════════════════════════

function analyzeKotlin(code, fileName) {
  const lines = code.split('\n');
  const issues = [];
  const functions = [];
  const classes = [];

  lines.forEach((line, i) => {
    const t = line.trim();
    const ln = i + 1;
    if (t.startsWith('//') || t.startsWith('*')) return;

    // ─── 1. Class/Object extraction ───────────────────
    const classMatch = t.match(/^(?:data\s+|sealed\s+|abstract\s+|open\s+)?class\s+(\w+)/);
    if (classMatch) classes.push({ name: classMatch[1], line: ln });

    // ─── 2. Function extraction ───────────────────────
    const fnMatch = t.match(/^(?:suspend\s+)?fun\s+(\w+)\s*\(/);
    if (fnMatch) functions.push({ name: fnMatch[1], line: ln, suspend: t.includes('suspend') });

    // ─── 3. !! (double bang) ──────────────────────────
    if (/\w+!!/.test(t)) {
      issues.push({
        type: 'kotlin', sev: 'h', line: ln, ev: t,
        title: '🟠 !! خطير — يسبب NullPointerException',
        fix: t.replace(/(\w+)!!/g, '$1 ?: return'),
        conf: 88, cIcon: '🟠', cAct: 'Force unwrap crash',
        cEv: ['!! يسبب crash لو القيمة null — استخدم ?: أو let'],
      });
    }

    // ─── 4. Thread.sleep في Coroutine ─────────────────
    if (/Thread\.sleep\s*\(/.test(t)) {
      issues.push({
        type: 'kotlin', sev: 'h', line: ln, ev: t,
        title: '🟠 Thread.sleep في Coroutine — استخدم delay()',
        fix: t.replace('Thread.sleep(', 'delay('),
        conf: 85, cIcon: '🟠', cAct: 'Blocks coroutine thread',
        cEv: ['Thread.sleep يحجب الـ thread — استخدم delay() في Coroutine'],
      });
    }

    // ─── 5. runBlocking في Android Main Thread ─────────
    if (/runBlocking\s*\{/.test(t)) {
      issues.push({
        type: 'kotlin', sev: 'h', line: ln, ev: t,
        title: '🟠 runBlocking على Main Thread — ANR محتمل',
        fix: '// استخدم lifecycleScope.launch { } بدل runBlocking',
        conf: 82, cIcon: '🟠', cAct: 'UI freeze risk',
        cEv: ['runBlocking يجمّد الـ UI thread — استخدم coroutines بشكل صحيح'],
      });
    }

    // ─── 6. GlobalScope ───────────────────────────────
    if (/GlobalScope\.(launch|async)/.test(t)) {
      issues.push({
        type: 'kotlin', sev: 'm', line: ln, ev: t,
        title: '🟡 GlobalScope — Memory Leak محتمل',
        fix: '// استخدم viewModelScope أو lifecycleScope',
        conf: 80, cIcon: '🟡', cAct: 'Coroutine leak',
        cEv: ['GlobalScope لا يُلغى مع lifecycle — استخدم viewModelScope'],
      });
    }

    // ─── 7. lateinit var ──────────────────────────────
    if (/lateinit\s+var\s+/.test(t)) {
      issues.push({
        type: 'kotlin', sev: 'l', line: ln, ev: t,
        title: '🔵 lateinit var — قد يسبب UninitializedPropertyAccessException',
        fix: '// تأكد من التهيئة قبل الاستخدام أو استخدم by lazy {}',
        conf: 65, cIcon: '🔵', cAct: 'Uninitialized property risk',
        cEv: ['استخدم ::field.isInitialized قبل الوصول للـ lateinit var'],
      });
    }

    // ─── 8. Hardcoded strings ──────────────────────────
    if (/setText\s*\(\s*["']/.test(t) || /Toast\.makeText\(.*["'][^"']{10,}["']/.test(t)) {
      issues.push({
        type: 'kotlin', sev: 'l', line: ln, ev: t,
        title: '🔵 String مُضمَّن — استخدم strings.xml',
        fix: '// انقل النص إلى res/values/strings.xml',
        conf: 70, cIcon: '🔵', cAct: 'Hardcoded string',
        cEv: ['استخدم getString(R.string.xxx) لدعم التعريب'],
      });
    }

    // ─── 9. Coroutine بدون exception handler ──────────
    if (/launch\s*\{/.test(t) && !lines.slice(i, i+10).some(l => /CoroutineExceptionHandler|try\s*\{/.test(l))) {
      issues.push({
        type: 'kotlin', sev: 'm', line: ln, ev: t,
        title: '🟡 Coroutine بدون exception handler',
        fix: '// أضف CoroutineExceptionHandler أو try/catch داخل launch',
        conf: 72, cIcon: '🟡', cAct: 'Unhandled coroutine exception',
        cEv: ['exceptions في coroutines تُلغى بصمت — أضف handler'],
      });
    }

    // ─── 10. SharedPreferences بدون apply/commit ──────
    if (/\.edit\(\)/.test(t) && !lines.slice(i, i+5).some(l => /\.apply\(\)|\.commit\(\)/.test(l))) {
      issues.push({
        type: 'kotlin', sev: 'm', line: ln, ev: t,
        title: '🟡 SharedPreferences.edit() بدون apply()',
        fix: t + '.apply()',
        conf: 78, cIcon: '🟡', cAct: 'Changes not saved',
        cEv: ['لازم تستدعي .apply() أو .commit() بعد edit()'],
      });
    }

    // ─── 11. SQL Injection في Room ────────────────────
    if (/@Query\s*\(/.test(t) && /\+\s*\w+|\$\{/.test(t)) {
      issues.push({
        type: 'kotlin', sev: 'c', line: ln, ev: t,
        title: '🔴 SQL Injection في Room Query',
        fix: '// استخدم :parameter بدل string concatenation',
        conf: 90, cIcon: '🔴', cAct: 'CWE-89 SQL Injection',
        cEv: ['استخدم @Query("SELECT * FROM table WHERE id = :userId")'],
      });
    }

    // ─── 12. Log في Production ────────────────────────
    if (/Log\.(d|v|i|e|w)\s*\(/.test(t) && /password|token|secret|key/i.test(t)) {
      issues.push({
        type: 'kotlin', sev: 'h', line: ln, ev: t,
        title: '🟠 تسجيل بيانات حساسة في Log',
        fix: '// احذف هذا الـ log أو استخدم BuildConfig.DEBUG',
        conf: 85, cIcon: '🟠', cAct: 'Sensitive data in logs',
        cEv: ['Log يظهر في logcat — لا تسجّل passwords أو tokens'],
      });
    }
  });

  return {
    issues,
    functions,
    classes,
    summary: {
      classes:   classes.length,
      functions: functions.length,
      suspend:   functions.filter(f => f.suspend).length,
      issues:    issues.length,
    },
  };
}
