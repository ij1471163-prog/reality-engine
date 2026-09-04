// ═══════════════════════════════════════════════════════
// php_analyzer.js v1.0
// PHP Analysis — Laravel + WordPress + Security
// ═══════════════════════════════════════════════════════

function analyzePHP(code, fileName) {
  const lines = code.split('\n');
  const issues = [];
  const functions = [];
  const classes = [];
  const routes = [];

  // ─── Framework Detection ──────────────────────────────
  const isLaravel   = /Route::|Eloquent|Artisan|Blade|@extends|@section/.test(code);
  const isWordPress = /wp_|get_post|add_action|add_filter|WP_Query|wpdb/.test(code);
  const framework   = isLaravel ? 'Laravel' : isWordPress ? 'WordPress' : 'PHP';

  lines.forEach((line, i) => {
        const t2 = line.trim();
        if (/["\']\s*\.\s*\$_(GET|POST|REQUEST)/.test(t2) && /SELECT|INSERT|UPDATE|DELETE/i.test(t2)) {
            issues.push({
                type:'php', sev:'c', line:i+1, ev:t2,
                title:'🔴 SQL Injection — PHP String Concatenation',
                fix:'// استخدم PDO Prepared Statements',
                conf:90, cIcon:'🔴', cAct:'CWE-89',
                cEv:['استخدم $pdo->prepare() بدل string concatenation'],
            });
        }
    const t = line.trim();
    const ln = i + 1;
    if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;

    // ─── 1. Class/Function extraction ─────────────────
    const classMatch = t.match(/^(?:abstract\s+|final\s+)?class\s+(\w+)/);
    if (classMatch) classes.push({ name: classMatch[1], line: ln });

    const fnMatch = t.match(/^(?:public|private|protected|static)?\s*function\s+(\w+)\s*\(/);
    if (fnMatch) functions.push({ name: fnMatch[1], line: ln });

    // ─── 2. SQL Injection ─────────────────────────────
    if (/mysql_query|mysqli_query|->query\s*\(/.test(t) && /\$_(GET|POST|REQUEST|COOKIE)/.test(t)) {
      issues.push({
        type: 'php', sev: 'c', line: ln, ev: t,
        title: '🔴 SQL Injection مباشر من User Input',
        fix: '// استخدم PDO Prepared Statements',
        conf: 95, cIcon: '🔴', cAct: 'CWE-89 CRITICAL',
        cEv: ['لا تضع $_GET/$_POST مباشرة في SQL — استخدم prepare/bind'],
      });
    }

    // ─── 3. XSS ───────────────────────────────────────
    if (/echo\s+\$_(GET|POST|REQUEST|COOKIE)/.test(t) && !/htmlspecialchars|htmlentities|esc_html/.test(t)) {
      issues.push({
        type: 'php', sev: 'c', line: ln, ev: t,
        title: '🔴 XSS: echo مباشر من User Input',
        fix: t.replace(/echo\s+(\$_\w+\[.*?\])/, 'echo htmlspecialchars($1, ENT_QUOTES, "UTF-8")'),
        conf: 92, cIcon: '🔴', cAct: 'CWE-79 XSS',
        cEv: ['استخدم htmlspecialchars() قبل echo أي user input'],
      });
    }

    // ─── 4. eval() ────────────────────────────────────
    if (/\beval\s*\(/.test(t)) {
      issues.push({
        type: 'php', sev: 'c', line: ln, ev: t,
        title: '🔴 eval() خطير جداً في PHP',
        fix: '// احذف eval() — استخدم بديل آمن',
        conf: 96, cIcon: '🔴', cAct: 'CWE-94 Code Injection',
        cEv: ['eval() في PHP يسمح بتنفيذ أي كود — خطر جداً'],
      });
    }

    // ─── 5. File Include من User Input ────────────────
    if (/(?:include|require)(?:_once)?\s*\(\s*\$_(GET|POST|REQUEST)/.test(t)) {
      issues.push({
        type: 'php', sev: 'c', line: ln, ev: t,
        title: '🔴 File Inclusion من User Input',
        fix: '// لا تستخدم user input في include/require',
        conf: 95, cIcon: '🔴', cAct: 'CWE-98 File Inclusion',
        cEv: ['Remote File Inclusion يسمح بتنفيذ كود خارجي'],
      });
    }

    // ─── 6. Hardcoded Credentials ────────────────────
    if (/(?:password|passwd|pwd|secret|api_key)\s*=\s*['"][^'"]{4,}['"]/i.test(t)) {
      issues.push({
        type: 'php', sev: 'c', line: ln, ev: t,
        title: '🔴 كلمة مرور مُضمَّنة في الكود',
        fix: '// استخدم $_ENV["PASSWORD"] أو .env',
        conf: 90, cIcon: '🔴', cAct: 'CWE-798 Hardcoded Credentials',
        cEv: ['استخدم .env + getenv() بدل hardcoded passwords'],
      });
    }

    // ─── 7. MD5 للكلمات السر ─────────────────────────
    if (/md5\s*\(/.test(t) && /password|passwd|pwd/i.test(t)) {
      issues.push({
        type: 'php', sev: 'c', line: ln, ev: t,
        title: '🔴 MD5 لتشفير كلمة المرور — مكسور',
        fix: t.replace(/md5\s*\(([^)]+)\)/, 'password_hash($1, PASSWORD_BCRYPT)'),
        conf: 92, cIcon: '🔴', cAct: 'Weak password hashing',
        cEv: ['MD5 مكسور — استخدم password_hash() + password_verify()'],
      });
    }

    // ─── 8. WordPress: SQL بدون $wpdb->prepare ────────
    if (isWordPress && /\$wpdb->query\s*\(/.test(t) && /\$_(GET|POST|REQUEST)/.test(t)) {
      issues.push({
        type: 'php', sev: 'c', line: ln, ev: t,
        title: '🔴 WordPress SQL بدون $wpdb->prepare()',
        fix: '// $wpdb->query($wpdb->prepare("SELECT...", $param))',
        conf: 93, cIcon: '🔴', cAct: 'WordPress SQL Injection',
        cEv: ['استخدم $wpdb->prepare() دائماً مع user input'],
      });
    }

    // ─── 9. Laravel Mass Assignment ───────────────────
    if (isLaravel && /::create\s*\(\s*\$request->all\(\)/.test(t)) {
      issues.push({
        type: 'php', sev: 'h', line: ln, ev: t,
        title: '🟠 Laravel Mass Assignment بدون $fillable',
        fix: '// حدد $fillable في الـ Model أو استخدم $request->only([...])',
        conf: 85, cIcon: '🟠', cAct: 'CWE-915 Mass Assignment',
        cEv: ['$request->all() خطير — استخدم $request->only([\'field1\', \'field2\'])'],
      });
    }

    // ─── 10. Laravel Route بدون middleware ────────────
    if (isLaravel && /Route::(get|post|put|delete)\s*\(/.test(t) && !/middleware/.test(t)) {
      const routeMatch = t.match(/Route::(\w+)\s*\(\s*['"]([^'"]+)['"]/);
      if (routeMatch) {
        routes.push({ method: routeMatch[1].toUpperCase(), path: routeMatch[2], line: ln });
        if (/admin|dashboard|user|profile/i.test(routeMatch[2])) {
          issues.push({
            type: 'php', sev: 'm', line: ln, ev: t,
            title: '🟡 Route حساس بدون Auth Middleware',
            fix: '// Route::' + routeMatch[1] + '(...)->middleware("auth")',
            conf: 75, cIcon: '🟡', cAct: 'Missing authentication',
            cEv: ['أضف ->middleware("auth") للـ routes الحساسة'],
          });
        }
      }
    }

    // ─── 11. WordPress: XSS في echo ───────────────────
    if (isWordPress && /echo\s+get_post_meta|echo\s+get_option/.test(t) && !/esc_html|esc_attr|wp_kses/.test(t)) {
      issues.push({
        type: 'php', sev: 'h', line: ln, ev: t,
        title: '🟠 WordPress XSS: echo بدون escaping',
        fix: t.replace(/echo\s+(get_\w+)/, 'echo esc_html($1)'),
        conf: 82, cIcon: '🟠', cAct: 'WordPress XSS',
        cEv: ['استخدم esc_html() أو esc_attr() في WordPress'],
      });
    }

    // ─── 12. Command Injection ────────────────────────
    if (/(?:exec|shell_exec|system|passthru|popen)\s*\(/.test(t) && /\$_(GET|POST|REQUEST)/.test(t)) {
      issues.push({
        type: 'php', sev: 'c', line: ln, ev: t,
        title: '🔴 Command Injection من User Input',
        fix: '// استخدم escapeshellarg() أو escapeshellcmd()',
        conf: 95, cIcon: '🔴', cAct: 'CWE-78 Command Injection',
        cEv: ['لا تمرر user input لـ exec/system — استخدم escapeshellarg()'],
      });
    }
  });

  return {
    issues,
    functions,
    classes,
    routes,
    framework,
    summary: {
      framework,
      classes:   classes.length,
      functions: functions.length,
      routes:    routes.length,
      issues:    issues.length,
      critical:  issues.filter(i => i.sev === 'c').length,
    },
  };
}
