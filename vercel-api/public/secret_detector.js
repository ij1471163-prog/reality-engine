// ═══════════════════════════════════════════════════════
// secret_detector.js v1.0
// Advanced Secret & Credential Detection
// Detects: API keys, tokens, private keys, credentials
// ═══════════════════════════════════════════════════════

function detectSecrets(code, fileName) {
  const lines = code.split('\n');
  const issues = [];

  const patterns = [

    // ─── AWS ──────────────────────────────────────────
    {
      name:    'AWS Access Key ID',
      strategy: null,
      regex:   /AKIA[0-9A-Z]{10,20}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم AWS IAM Roles أو environment variables',
      conf:    97,
    },
    {
      name:    'AWS Secret Access Key',
      strategy: 'HARDCODED_SECRET',
      regex:   /(?:aws[_\-]?secret|AWS_SECRET)[^=]*=\s*['"]?[A-Za-z0-9/+=]{40}['"]?/i,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم AWS Secrets Manager',
      conf:    95,
    },

    // ─── GitHub ───────────────────────────────────────
    {
      name:    'GitHub Personal Access Token',
      strategy: null,
      regex:   /ghp_[A-Za-z0-9]{36}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// أضف للـ .env واستبعده من git',
      conf:    99,
    },
    {
      name:    'GitHub OAuth Token',
      strategy: null,
      regex:   /gho_[A-Za-z0-9]{36}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// أضف للـ .env واستبعده من git',
      conf:    99,
    },
    {
      name:    'GitHub Fine-grained Token',
      strategy: null,
      regex:   /github_pat_[A-Za-z0-9_]{82}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// لا ترفع tokens في الكود',
      conf:    99,
    },

    // ─── Google ───────────────────────────────────────
    {
      name:    'Google API Key',
      strategy: 'API_KEY',
      regex:   /AIza[0-9A-Za-z\-_]{35}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// قيّد المفتاح في Google Console واستخدم env vars',
      conf:    96,
    },
    {
      name:    'Google OAuth Client Secret',
      strategy: 'HARDCODED_SECRET',
      regex:   /GOCSPX-[A-Za-z0-9\-_]{28}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم environment variables',
      conf:    97,
    },

    // ─── Stripe ───────────────────────────────────────
    {
      name:    'Stripe Secret Key',
      strategy: 'HARDCODED_SECRET',
      regex:   /sk_live_[A-Za-z0-9]{20,}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم sk_test للتطوير وenv vars للإنتاج',
      conf:    99,
    },
    {
      name:    'Stripe Publishable Key',
      strategy: 'API_KEY',
      regex:   /pk_live_[A-Za-z0-9]{24,}/,
      sev:     'h',
      cwe:     'CWE-798',
      fix:     '// استخدم pk_test للتطوير',
      conf:    95,
    },

    // ─── JWT ──────────────────────────────────────────
    {
      name:    'JWT Token (hardcoded)',
      strategy: null,
      regex:   /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
      sev:     'h',
      cwe:     'CWE-798',
      fix:     '// لا تضع JWT tokens في الكود',
      conf:    90,
    },
    {
      name:    'JWT Secret (weak)',
      strategy: 'HARDCODED_SECRET',
      regex:   /jwt[_\-]?secret\s*[:=]\s*['"][^'"]{3,30}['"]/i,
      sev:     'h',
      cwe:     'CWE-330',
      fix:     '// استخدم secret قوي من env vars: process.env.JWT_SECRET',
      conf:    85,
    },

    // ─── Private Keys ─────────────────────────────────
    {
      name:    'RSA Private Key',
      strategy: null,
      regex:   /-----BEGIN RSA PRIVATE KEY-----/,
      sev:     'c',
      cwe:     'CWE-321',
      fix:     '// لا ترفع private keys في الكود — استخدم key store',
      conf:    99,
    },
    {
      name:    'Private Key (Generic)',
      strategy: null,
      regex:   /-----BEGIN (?:EC|DSA|OPENSSH|PGP) PRIVATE KEY-----/,
      sev:     'c',
      cwe:     'CWE-321',
      fix:     '// لا ترفع private keys في الكود',
      conf:    99,
    },

    // ─── Slack ────────────────────────────────────────
    {
      name:    'Slack Bot Token',
      strategy: null,
      regex:   /xoxb-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم Slack App secrets بشكل آمن',
      conf:    98,
    },
    {
      name:    'Slack Webhook URL',
      strategy: null,
      regex:   /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/,
      sev:     'h',
      cwe:     'CWE-798',
      fix:     '// أضف للـ .env واستبعده من git',
      conf:    97,
    },

    // ─── Database ─────────────────────────────────────
    {
      name:    'Database Connection String',
      strategy: null,
      regex:   /(?:mongodb|mysql|postgres|postgresql):\/\/[^:]+:[^@]+@[^/\s]+/i,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم DATABASE_URL في env vars',
      conf:    93,
    },

    // ─── Generic Passwords ────────────────────────────
    {
      name:    'Hardcoded Password (strong)',
      strategy: 'HARDCODED_PASS',
      regex:   /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i,
      sev:     'h',
      cwe:     'CWE-259',
      fix:     '// استخدم environment variables بدل hardcoded passwords',
      conf:    80,
    },
    {
      name:    'Hardcoded API Key',
      strategy: 'API_KEY',
      regex:   /(?:api[_\-]?key|apikey|access[_\-]?key)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i,
      sev:     'h',
      cwe:     'CWE-798',
      fix:     '// استخدم environment variables للـ API keys',
      conf:    82,
    },

    // ─── Anthropic / OpenAI ───────────────────────────
    {
      name:    'Anthropic API Key',
      strategy: 'API_KEY',
      regex:   /sk-ant-[A-Za-z0-9\-_]{40,}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم process.env.ANTHROPIC_API_KEY',
      conf:    99,
    },
    {
      name:    'OpenAI API Key',
      strategy: 'API_KEY',
      regex:   /sk-[A-Za-z0-9]{48}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم process.env.OPENAI_API_KEY',
      conf:    95,
    },

    // ─── Firebase ─────────────────────────────────────
    {
      name:    'Firebase API Key',
      strategy: 'API_KEY',
      regex:   /AIza[0-9A-Za-z\-_]{35}/,
      sev:     'h',
      cwe:     'CWE-798',
      fix:     '// قيّد Firebase rules وقيّد المفتاح',
      conf:    90,
    },

    // ─── SSH ──────────────────────────────────────────
    {
      name:    'SSH Private Key',
      strategy: null,
      regex:   /-----BEGIN OPENSSH PRIVATE KEY-----/,
      sev:     'c',
      cwe:     'CWE-321',
      fix:     '// أضف لـ .gitignore ولا ترفع SSH keys',
      conf:    99,
    },
  ];

  lines.forEach((line, i) => {
    const t   = line.trim();
    const ln  = i + 1;

    // تجاهل comments وexample strings
    if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;
    // تجاهل SQL queries
    if (/(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)/i.test(t)) return;
    // فلتر أقل صرامة
    if (/your[_\-]?key|placeholder|xxx_/i.test(t)) return;

    patterns.forEach(pat => {
      if (pat.regex.test(line)) {
        // استخرج القيمة المكتشفة (مع إخفاء معظمها)
        const match = line.match(pat.regex);
        const masked = match ? maskSecret(match[0]) : '';

        issues.push({
          type:  'secret',
          sev:   pat.sev,
          line:  ln,
          ev:    t.length > 80 ? t.substring(0, 77) + '...' : t,
          title: '🔐 ' + pat.name + (masked ? ': ' + masked : ''),
          // strategy من اسم النمط فقط — masked جزء من قيمة الـsecret نفسها (بيانات مستخدم)
          strategy: pat.strategy === undefined ? null : pat.strategy,
          fix:   pat.fix,
          conf:  pat.conf,
          cIcon: '🔐',
          cAct:  pat.cwe,
          cEv:   ['Secret مكشوف في الكود — يجب إزالته فوراً', pat.cwe],
        });
      }
    });
  });

  return issues;
}

function maskSecret(secret) {
  if (!secret || secret.length < 8) return '***';
  const show = Math.min(4, Math.floor(secret.length * 0.2));
  return secret.substring(0, show) + '***' + secret.substring(secret.length - 2);
}
