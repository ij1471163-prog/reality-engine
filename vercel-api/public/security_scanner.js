// ─── Security Scanner ────────────────────────────────
// يكتشف ثغرات أمنية شائعة في الكود

function scanSecurity(code, fileName) {
  const issues = [];
  const lines = code.split('\n');
  const ext = fileName.split('.').pop().toLowerCase();

  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;
    const ln = i + 1;

    // ─── 1. SQL Injection ───────────────────────────
    // [FIX] الشرط كان ‎/query|execute|sql/i.test(t)‎ — الكلمةُ المجرَّدة في أي
    // موضع من السطر. فكل سطر فيه ‎req.query‎ أو ‎queryString‎ أو متغيّر اسمه
    // ‎query‎ يصير «SQL Injection محتمل» متى وُجد تسلسلُ نصّ. والمقيس:
    //     exec("ls " + req.query.dir)      ⇒ 🔴 SQL Injection محتمل   (زائف)
    // وكان ذلك يُطالِب إصلاحَ حقن الأوامر الصحيح بإثبات parameterization
    // لاستعلامٍ لا وجود له، فيُرفض إصلاحٌ سليم.
    //
    // فالشرط الآن دليلٌ على استعلامٍ فعلي: فعلُ SQL في السطر، أو نداءُ
    // تنفيذِ استعلامٍ معروف. و‎req.query.x‎ وحده ليس أيًّا منهما.
    const _sqlVerb = /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE|REPLACE\s+INTO|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE)\b/i.test(t);
    const _sqlCall = /\.\s*(?:query|execute|executemany|exec|prepare)\s*\(|\b(?:mysqli_query|mysql_query|pg_query|sqlite_query|dbQuery)\s*\(|\bcursor\s*\.\s*execute\s*\(/i.test(t);
    // والدمجُ يجب أن يكون دمجَ **نصّ**: ‎/\+\s*\w+/‎ كان يطابق أي جمعٍ في السطر،
    // فحسابٌ عاديٌّ بجوار اسمٍ يُشبه الاستعلام يصير بلاغًا. والمقيس على مصدر
    // المحرك نفسه:
    //     const qLine = …findIndex(l => l.includes('cursor.execute(query')) + 1;
    // ‎+ 1‎ جمعُ أعداد، و‎.execute(‎ داخل نصّ لا نداءٌ. فالشرط: الجمعُ ملاصقٌ
    // لنصٍّ حرفي من أحد طرفيه، أو إقحامُ قالب.
    const _concatStr = /["'`][^"'`]*["'`]\s*\+|\+\s*["'`]|\$\{/.test(t);
    if ((_sqlVerb || _sqlCall) && _concatStr && !/prepared|parameterized/i.test(t)) {
      issues.push({
        type: 'security', sev: 'c',
        title: '🔴 SQL Injection محتمل',
        line: ln, ev: t,
        fix: '// استخدم Prepared Statements بدل string concatenation',
        conf: 85, cIcon: '🔴', cAct: 'ثغرة حرجة',
        cEv: ['لا تدمج input المستخدم مباشرة في SQL']
      });
    }

    // ─── 2. Hardcoded Password/Secret ──────────────
    if (/password|secret|api_key|apikey|token/i.test(t) &&
        /=\s*["'][^"']{4,}["']/.test(t) &&
        !/test|example|placeholder|your_/i.test(t) &&
        !/(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)/i.test(t) &&
        !/[?]/.test(t.split('=')[1] || '')) {
      issues.push({
        type: 'security', sev: 'c',
        title: '🔴 كلمة مرور/مفتاح مُضمَّن في الكود',
        line: ln, ev: t,
        fix: '// استخدم Environment Variables بدل hardcoded secrets',
        conf: 90, cIcon: '🔴', cAct: 'ثغرة حرجة',
        cEv: ['لا تضع secrets في الكود — استخدم .env']
      });
    }

    // ─── 3. XSS ────────────────────────────────────
    if (['js','jsx','ts','html'].includes(ext)) {
      if (/innerHTML|document\.write|\.html\(/.test(t) && /\w+/.test(t)) {
        issues.push({
          type: 'security', sev: 'h',
          title: '🟠 XSS محتمل: innerHTML بدون sanitize',
          line: ln, ev: t,
          fix: t.replace('innerHTML', 'textContent'),
          conf: 80, cIcon: '🟠', cAct: 'ثغرة XSS',
          cEv: ['استخدم textContent أو sanitize الـ input']
        });
      }
    }

    // ─── 4. eval() ─────────────────────────────────
    if (/\beval\s*\(/.test(t)) {
      issues.push({
        type: 'security', sev: 'c',
        title: '🔴 eval() خطير جداً',
        line: ln, ev: t,
        fix: '// احذف eval() — استخدم JSON.parse أو طريقة آمنة',
        conf: 95, cIcon: '🔴', cAct: 'ثغرة حرجة',
        cEv: ['eval() يسمح بتنفيذ أي كود — خطر جداً']
      });
    }

    // ─── 5. Command Injection ───────────────────────
    // [FIX] subprocess بقائمة وسائط وبلا shell=True لا يستدعي شِلًّا، فلا تُحقن
    // metacharacters — وهي بالضبط التوصية في cEv أدناه، فكان الكاشف يُبلّغ عن
    // علاجه الموصى به كثغرة حرجة. يبقى مكشوفًا: shell=True (ولو مع قائمة)،
    // وتمرير command string، و os.system/exec/spawn بلا تغيير.
    // [FIX] ‎\bexec\s*\(‎ و‎\bspawn\s*\(‎ كانا يُطابقان بعد النقطة، فعُدَّ نداءُ
    // قاعدة بيانات مَصرِفَ أوامر:
    //     conn.exec("SELECT * FROM t WHERE a=" + id)   ⇒ 🔴 Command Injection  (زائف)
    //     db.exec(…) · sheet.exec(…) · obj.spawn(…)    ⇒ كذلك
    // فيُطالَب إصلاحُ SQL الصحيح بإثبات علاجِ أوامر لا محلّ له، فيُرفض.
    // والحدّ: ‎exec‎/‎spawn‎ بلا مُستقبِل، أو بمُستقبِل ‎child_process‎/‎cp‎ صريح.
    //
    // و‎spawn‎/‎execFile‎ بقائمة وسائط لا يستدعيان شِلًّا، فلا تُحقن
    // metacharacters — وهما بالضبط العلاج الموصى به في cEv أدناه. فكان
    // الكاشف يُبلّغ عن علاجه كثغرة حرجة:
    //     spawn("ls", [d + "x"])   ⇒ 🔴 Command Injection  (زائف)
    // نفس المنطق المطبَّق على subprocess في التعليق أعلاه. ويبقى مكشوفًا:
    // ‎spawn("ls " + d)‎ بأمرٍ مُسلسَل بلا قائمة، و‎shell: true‎ ولو مع قائمة.
    const _cmdExecRx  = /(?<![.\w$])exec\s*\(|(?:child_process|cp)\s*\.\s*exec\s*\(/i;
    const _cmdSpawnRx = /(?<![.\w$])(?:spawn|execFile)\s*\(|(?:child_process|cp)\s*\.\s*(?:spawn|execFile)\s*\(/i;
    const _cmdArgvList = /,\s*\[/.test(t);                       // وسائط مفصولة
    const _cmdShellOpt = /\bshell\s*:\s*true\b/i.test(t);
    // القائمةُ تُؤمِّن فقط إذا لم يكن المُنفَّذ نفسه شِلًّا: ‎spawn("sh", ["-c", …])‎
    // يستدعي شِلًّا صراحةً فتُحقن فيه metacharacters، والقائمةُ هنا لا تُؤمّن
    // شيئًا. أسقط إغفالُ ذلك اختبارًا قائمًا («يبقى مكشوفًا: spawn JS»).
    const _cmdShellExe = /['"](?:[\w./\\]*[/\\])?(?:sh|bash|zsh|ksh|dash|csh|tcsh|fish|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh)['"]/i.test(t) ||
                         /['"]-c['"]|['"]\/[cC]['"]/.test(t);
    const _cmdSpawnRisky = _cmdSpawnRx.test(t) && (_cmdShellOpt || _cmdShellExe || !_cmdArgvList);
    const _cmdOtherSink = _cmdExecRx.test(t) || _cmdSpawnRisky || /\bos\.system\s*\(/i.test(t);
    const _cmdSubprocess = /\bsubprocess\.(?:run|Popen|call|check_output|check_call)\s*\(/i.test(t);
    const _cmdShellTrue = /\bshell\s*=\s*True\b/i.test(t);
    const _cmdArgList = /\bsubprocess\.\w+\s*\(\s*(?:\[|shlex\.split\s*\()/i.test(t);
    const _cmdSubprocessRisky = _cmdSubprocess && (_cmdShellTrue || !_cmdArgList);
    if ((_cmdOtherSink || _cmdSubprocessRisky) &&
        /\+|f"|f'|\$\{/.test(t)) {
      issues.push({
        type: 'security', sev: 'c',
        title: '🔴 Command Injection محتمل',
        line: ln, ev: t,
        fix: '// لا تدمج input المستخدم في shell commands',
        conf: 85, cIcon: '🔴', cAct: 'ثغرة حرجة',
        cEv: ['استخدم قائمة arguments بدل string']
      });
    }

    // ─── 6. Insecure Random ─────────────────────────
    if (/Math\.random\(\)|random\(\)/.test(t) && /token|password|secret|id|key/i.test(t)) {
      issues.push({
        type: 'security', sev: 'h',
        title: '🟠 Random غير آمن للـ security',
        line: ln, ev: t,
        fix: '// استخدم crypto.randomBytes() أو SecureRandom()',
        conf: 80, cIcon: '🟠', cAct: 'ثغرة أمنية',
        cEv: ['Math.random() ليس آمناً للـ tokens']
      });
    }

    // ─── 7. MD5 / SHA1 ─────────────────────────────
    if (/md5|sha1|sha-1/i.test(t) && /hash|encrypt|password/i.test(t)) {
      issues.push({
        type: 'security', sev: 'h',
        title: '🟠 خوارزمية تشفير ضعيفة: MD5/SHA1',
        line: ln, ev: t,
        fix: '// استخدم SHA-256 أو bcrypt للكلمات السر',
        conf: 85, cIcon: '🟠', cAct: 'تشفير ضعيف',
        cEv: ['MD5/SHA1 ضعيفة — استخدم SHA-256 أو bcrypt']
      });
    }

    // ─── 8. HTTP بدل HTTPS ──────────────────────────
    if (/http:\/\/(?!localhost|127\.0\.0\.1)/.test(t) && !/\/\//i.test(t.slice(0, t.indexOf('http')))) {
      issues.push({
        type: 'security', sev: 'm',
        title: '🟡 HTTP غير مشفر — استخدم HTTPS',
        line: ln, ev: t,
        fix: t.replace('http://', 'https://'),
        conf: 75, cIcon: '🟡', cAct: 'اتصال غير آمن',
        cEv: ['HTTP يرسل البيانات بدون تشفير']
      });
    }

    // ─── 9. Log Sensitive Data ──────────────────────
    if (/console\.log|print|Log\./i.test(t) && /password|token|secret|key|credit/i.test(t)) {
      issues.push({
        type: 'security', sev: 'h',
        title: '🟠 تسجيل بيانات حساسة في الـ logs',
        line: ln, ev: t,
        fix: '// لا تسجّل passwords أو tokens في الـ logs',
        conf: 85, cIcon: '🟠', cAct: 'تسرب بيانات',
        cEv: ['البيانات الحساسة في الـ logs خطر أمني']
      });
    }

    // ─── 10. Weak TLS ───────────────────────────────
    if (/SSLv3|TLSv1\.0|TLSv1\.1|ssl_version|PROTOCOL_TLS/i.test(t)) {
      issues.push({
        type: 'security', sev: 'h',
        title: '🟠 إصدار TLS قديم وغير آمن',
        line: ln, ev: t,
        fix: '// استخدم TLS 1.2 أو 1.3',
        conf: 90, cIcon: '🟠', cAct: 'بروتوكول ضعيف',
        cEv: ['TLS 1.0/1.1 معطوبان — استخدم TLS 1.2+']
      });
    }
  });

  return issues;
}
