// ═══════════════════════════════════════════════════════
// csharp_analyzer.js v1.0 — C# / Unity Analysis
// ═══════════════════════════════════════════════════════

function analyzeCSharp(code, fileName) {
  const issues = [];
  const lines  = code.split('\n');

  lines.forEach((line, i) => {
    const t  = line.trim();
    const ln = i + 1;
    if (t.startsWith('//') || t.startsWith('*')) return;

    if (/FindObjectOfType/.test(t)) {
      const ctx = lines.slice(Math.max(0,i-10),i).join('\n');
      if (/void Update|void FixedUpdate|void LateUpdate/.test(ctx)) {
        issues.push({ type:'cs', sev:'h', line:ln, ev:t,
          title:'🟠 FindObjectOfType() في Update() — بطيء جداً',
          fix:'// استخدمه في Start() أو Awake() واحفظ النتيجة',
          conf:90, cIcon:'🟠', cAct:'Unity Performance' });
      }
    }

    if (/GetComponent\s*</.test(t)) {
      const ctx = lines.slice(Math.max(0,i-10),i).join('\n');
      if (/void Update|void FixedUpdate/.test(ctx)) {
        issues.push({ type:'cs', sev:'h', line:ln, ev:t,
          title:'🟠 GetComponent() في Update() — استخدم Cache',
          fix:'// Cache في Start(): _rb = GetComponent<Rigidbody>();',
          conf:88, cIcon:'🟠', cAct:'Unity Performance' });
      }
    }

    if (/Debug\.Log\s*\(/.test(t)) {
      issues.push({ type:'cs', sev:'l', line:ln, ev:t,
        title:'🔵 Debug.Log() — أبطأ في production',
        fix:'// أضف: #if UNITY_EDITOR قبل Debug.Log()',
        conf:72, cIcon:'🔵', cAct:'Unity Performance' });
    }

    if (/Instantiate\s*\(/.test(t)) {
      const ctx = lines.slice(Math.max(0,i-10),i).join('\n');
      if (/void Update/.test(ctx)) {
        issues.push({ type:'cs', sev:'h', line:ln, ev:t,
          title:'🟠 Instantiate() في Update() — استخدم Object Pooling',
          fix:'// استخدم Object Pool بدل Instantiate في كل frame',
          conf:85, cIcon:'🟠', cAct:'Unity Performance' });
      }
    }

    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(t) || /catch\s*\{\s*\}/.test(t)) {
      issues.push({ type:'cs', sev:'m', line:ln, ev:t,
        title:'🟡 Empty catch — أخطاء مخفية',
        fix:'// أضف: Console.WriteLine(e.Message);',
        conf:88, cIcon:'🟡', cAct:'Error Handling' });
    }

    if (/(?:ConnectionString|connectionString)\s*=\s*["'][^"']{10,}["']/.test(t)) {
      issues.push({ type:'cs', sev:'c', line:ln, ev:t,
        title:'🔴 Connection String مكشوفة في الكود',
        fix:'// استخدم: ConfigurationManager.AppSettings["ConnStr"]',
        conf:92, cIcon:'🔴', cAct:'CWE-798' });
    }

    if (/MD5\.Create\(\)|new MD5CryptoServiceProvider/.test(t)) {
      issues.push({ type:'cs', sev:'h', line:ln, ev:t,
        title:'🟠 MD5 ضعيف — استخدم SHA256 أو BCrypt',
        fix:'// استخدم: SHA256.Create() أو BCrypt.Net',
        conf:88, cIcon:'🟠', cAct:'CWE-327' });
    }

    if (/(?:password|passwd|secret)\s*=\s*["'][^"']{4,}["']/i.test(t)) {
      issues.push({ type:'cs', sev:'h', line:ln, ev:t,
        title:'🟠 كلمة مرور مكشوفة في الكود',
        fix:'// استخدم: Environment.GetEnvironmentVariable("PASSWORD")',
        conf:85, cIcon:'🟠', cAct:'CWE-259' });
    }

    if (/new\s+(?:SqlConnection|StreamReader|FileStream|HttpClient)\s*\(/.test(t)) {
      if (!/using\s*\(/.test(t) && !/using\s+var/.test(t)) {
        issues.push({ type:'cs', sev:'m', line:ln, ev:t,
          title:'🟡 استخدم using statement لضمان Dispose()',
          fix:'// using (var conn = new SqlConnection(...)) { ... }',
          conf:80, cIcon:'🟡', cAct:'Resource Leak' });
      }
    }
  });

  return issues;
}
