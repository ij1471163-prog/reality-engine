// ═══════════════════════════════════════════════════════
// c_cpp_analyzer.js v1.0
// C/C++ Static Analysis
// Memory, Security, undefined behavior, best practices
// ═══════════════════════════════════════════════════════

function analyzeCCpp(code, fileName) {
  const lines  = code.split('\n');
  const issues = [];
  const ext    = fileName.split('.').pop().toLowerCase();
  const isCpp  = ext === 'cpp' || ext === 'cc' || ext === 'cxx' || ext === 'hpp';

  lines.forEach((line, i) => {
    const t  = line.trim();
    const ln = i + 1;
    if (t.startsWith('//') || t.startsWith('*')) return;

    // ─── Memory Issues ────────────────────────────────

    // gets() — buffer overflow
    if (/\bgets\s*\(/.test(t)) {
      issues.push({
        type: 'c', sev: 'c', line: ln, ev: t,
        title: '🔴 gets() — Buffer Overflow (CWE-120)',
        fix:   t.replace(/\bgets\s*\(([^)]+)\)/, 'fgets($1, sizeof($1), stdin)'),
        conf:  97, cIcon: '🔴', cAct: 'CWE-120 Buffer Overflow',
        cEv:  ['gets() لا تتحقق من حجم المخزن — استخدم fgets()'],
      });
    }

    // strcpy() — buffer overflow
    if (/\bstrcpy\s*\(/.test(t)) {
      issues.push({
        type: 'c', sev: 'h', line: ln, ev: t,
        title: '🟠 strcpy() — Buffer Overflow محتمل (CWE-120)',
        fix:   t.replace(/\bstrcpy\s*\(([^,]+),\s*([^)]+)\)/, 'strncpy($1, $2, sizeof($1) - 1)'),
        conf:  88, cIcon: '🟠', cAct: 'CWE-120',
        cEv:  ['استخدم strncpy() أو strlcpy() بدل strcpy()'],
      });
    }

    // strcat() — buffer overflow
    if (/\bstrcat\s*\(/.test(t)) {
      issues.push({
        type: 'c', sev: 'h', line: ln, ev: t,
        title: '🟠 strcat() — Buffer Overflow محتمل (CWE-120)',
        fix:   t.replace(/\bstrcat\s*\(([^,]+),\s*([^)]+)\)/, 'strncat($1, $2, sizeof($1) - strlen($1) - 1)'),
        conf:  85, cIcon: '🟠', cAct: 'CWE-120',
        cEv:  ['استخدم strncat() مع حجم المخزن'],
      });
    }

    // sprintf() — buffer overflow
    if (/\bsprintf\s*\(/.test(t)) {
      issues.push({
        type: 'c', sev: 'h', line: ln, ev: t,
        title: '🟠 sprintf() — Buffer Overflow محتمل (CWE-134)',
        fix:   t.replace(/\bsprintf\s*\(/, 'snprintf('),
        conf:  83, cIcon: '🟠', cAct: 'CWE-134',
        cEv:  ['استخدم snprintf() مع تحديد الحجم الأقصى'],
      });
    }

    // malloc بدون free check
    if (/\bmalloc\s*\(/.test(t) && !/=\s*NULL/.test(t)) {
      const nextLines = lines.slice(i + 1, i + 5).join('\n');
      if (!/if\s*\(.*NULL|!.*malloc|free\s*\(/.test(nextLines)) {
        issues.push({
          type: 'c', sev: 'm', line: ln, ev: t,
          title: '🟡 malloc() — تحقق من NULL وتجنب Memory Leak',
          fix:   '// تحقق: if (ptr == NULL) { /* handle error */ }\n// حرر الذاكرة: free(ptr);',
          conf:  75, cIcon: '🟡', cAct: 'CWE-252 Memory Leak',
          cEv:  ['تحقق من malloc() != NULL وتأكد من free()'],
        });
      }
    }

    // double free
    if (/\bfree\s*\(/.test(t)) {
      const prevCode = lines.slice(Math.max(0, i - 10), i).join('\n');
      const freeMatch = t.match(/free\s*\((\w+)\)/);
      if (freeMatch && prevCode.includes('free(' + freeMatch[1] + ')')) {
        issues.push({
          type: 'c', sev: 'c', line: ln, ev: t,
          title: '🔴 Double Free — Use After Free (CWE-415)',
          fix:   t + '\n' + freeMatch[1] + ' = NULL; // بعد free',
          conf:  82, cIcon: '🔴', cAct: 'CWE-415 Double Free',
          cEv:  ['اضبط المؤشر على NULL بعد free()'],
        });
      }
    }

    // ─── Format String ────────────────────────────────

    if (/\bprintf\s*\(\s*\w+\s*\)/.test(t) && !/printf\s*\(\s*["']/.test(t)) {
      issues.push({
        type: 'c', sev: 'c', line: ln, ev: t,
        title: '🔴 Format String Attack (CWE-134)',
        fix:   t.replace(/printf\s*\((\w+)\)/, 'printf("%s", $1)'),
        conf:  93, cIcon: '🔴', cAct: 'CWE-134 Format String',
        cEv:  ['printf(user_input) خطير — استخدم printf("%s", user_input)'],
      });
    }

    // ─── Integer Issues ───────────────────────────────

    // signed/unsigned مشاكل
    if (/\bsizeof\s*\(/.test(t) && /int\s+\w+\s*=\s*sizeof/.test(t)) {
      issues.push({
        type: 'c', sev: 'm', line: ln, ev: t,
        title: '🟡 استخدم size_t بدل int للـ sizeof',
        fix:   t.replace(/\bint\b/, 'size_t'),
        conf:  78, cIcon: '🟡', cAct: 'CWE-195 Signed/Unsigned',
        cEv:  ['sizeof يرجع size_t (unsigned) — استخدم size_t لتجنب overflow'],
      });
    }

    // ─── C++ Specific ─────────────────────────────────

    if (isCpp) {
      // new بدون delete
      if (/\bnew\s+\w+/.test(t) && !/unique_ptr|shared_ptr|make_unique|make_shared/.test(t)) {
        issues.push({
          type: 'c', sev: 'm', line: ln, ev: t,
          title: '🟡 C++: استخدم smart pointers بدل raw new',
          fix:   t.replace(/(\w+)\s*\*\s*(\w+)\s*=\s*new\s+(\w+)/, 'auto $2 = std::make_unique<$3>()'),
          conf:  80, cIcon: '🟡', cAct: 'Memory Management',
          cEv:  ['استخدم unique_ptr أو shared_ptr لتجنب memory leaks'],
        });
      }

      // cout بدون endl أو flush
      if (/std::cin\s*>>/.test(t) && !lines.slice(i - 3, i).join('\n').includes('sync_with_stdio')) {
        issues.push({
          type: 'c', sev: 'l', line: ln, ev: t,
          title: '🔵 C++: أضف ios::sync_with_stdio(false) للأداء',
          fix:   '// أضف في main():\nios::sync_with_stdio(false);\ncin.tie(NULL);',
          conf:  65, cIcon: '🔵', cAct: 'Performance',
          cEv:  ['sync_with_stdio(false) يسرّع cin/cout بشكل كبير'],
        });
      }

      // throw في destructor
      if (/~\w+\s*\(\s*\)/.test(t)) {
        const body = lines.slice(i, i + 10).join('\n');
        if (/\bthrow\b/.test(body)) {
          issues.push({
            type: 'c', sev: 'h', line: ln, ev: t,
            title: '🟠 C++: لا تستخدم throw في Destructor',
            fix:   '// استخدم try/catch داخل الـ destructor',
            conf:  88, cIcon: '🟠', cAct: 'C++ Exception Safety',
            cEv:  ['throw في destructor يسبب terminate() — استخدم noexcept'],
          });
        }
      }

      // using namespace std في header
      if (/using\s+namespace\s+std/.test(t) && (fileName.endsWith('.h') || fileName.endsWith('.hpp'))) {
        issues.push({
          type: 'c', sev: 'm', line: ln, ev: t,
          title: '🟡 C++: لا تستخدم "using namespace std" في headers',
          fix:   '// استخدم std:: explicitly في headers',
          conf:  85, cIcon: '🟡', cAct: 'Namespace Pollution',
          cEv:  ['"using namespace std" في headers يلوث namespace المستخدمين'],
        });
      }

      // reinterpret_cast
      if (/\breinterpret_cast\b/.test(t)) {
        issues.push({
          type: 'c', sev: 'm', line: ln, ev: t,
          title: '🟡 C++: reinterpret_cast خطير',
          fix:   '// تأكد من صحة الـ cast أو استخدم static_cast',
          conf:  72, cIcon: '🟡', cAct: 'Unsafe Cast',
          cEv:  ['reinterpret_cast يتجاوز type system — استخدمه بحذر'],
        });
      }
    }

    // ─── Security ─────────────────────────────────────

    // system() call
    if (/\bsystem\s*\(/.test(t)) {
      issues.push({
        type: 'c', sev: 'c', line: ln, ev: t,
        title: '🔴 system() — Command Injection (CWE-78)',
        fix:   '// استخدم execvp() مع قائمة arguments بدل system()',
        conf:  90, cIcon: '🔴', cAct: 'CWE-78 Command Injection',
        cEv:  ['system() خطير مع user input — استخدم execvp() أو popen()'],
      });
    }

    // rand() للأمان
    if (/\brand\s*\(\s*\)/.test(t) && /(?:key|token|secret|seed|crypto|passwd)/i.test(t)) {
      issues.push({
        type: 'c', sev: 'h', line: ln, ev: t,
        title: '🟠 rand() غير آمن للـ cryptography (CWE-338)',
        fix:   '// استخدم /dev/urandom أو getrandom()',
        conf:  85, cIcon: '🟠', cAct: 'CWE-338 Weak Random',
        cEv:  ['rand() قابل للتنبؤ — استخدم getrandom() أو /dev/urandom'],
      });
    }

    // scanf بدون field width
    if (/\bscanf\s*\(\s*["'][^"']*%s[^"']*["']/.test(t)) {
      issues.push({
        type: 'c', sev: 'h', line: ln, ev: t,
        title: '🟠 scanf %s — Buffer Overflow (CWE-120)',
        fix:   t.replace(/%s/, '%255s'),
        conf:  88, cIcon: '🟠', cAct: 'CWE-120',
        cEv:  ['استخدم %255s مع تحديد الحجم الأقصى في scanf'],
      });
    }
  });

  return {
    issues,
    language: isCpp ? 'C++' : 'C',
    summary: {
      issues:   issues.length,
      critical: issues.filter(i => i.sev === 'c').length,
      high:     issues.filter(i => i.sev === 'h').length,
      medium:   issues.filter(i => i.sev === 'm').length,
    },
  };
}
