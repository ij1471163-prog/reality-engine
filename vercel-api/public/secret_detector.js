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
      regex:   /AKIA[0-9A-Z]{16}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم AWS IAM Roles أو environment variables',
      conf:    97,
    },
    {
      name:    'AWS Secret Access Key',
      regex:   /(?:aws[_\-]?secret|AWS_SECRET)[^=]*=\s*['"]?[A-Za-z0-9/+=]{40}['"]?/i,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم AWS Secrets Manager',
      conf:    95,
    },

    // ─── GitHub ───────────────────────────────────────
    {
      name:    'GitHub Personal Access Token',
      regex:   /ghp_[A-Za-z0-9]{36}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// أضف للـ .env واستبعده من git',
      conf:    99,
    },
    {
      name:    'GitHub OAuth Token',
      regex:   /gho_[A-Za-z0-9]{36}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// أضف للـ .env واستبعده من git',
      conf:    99,
    },
    {
      name:    'GitHub Fine-grained Token',
      regex:   /github_pat_[A-Za-z0-9_]{82}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// لا ترفع tokens في الكود',
      conf:    99,
    },

    // ─── Google ───────────────────────────────────────
    {
      name:    'Google API Key',
      regex:   /AIza[0-9A-Za-z\-_]{35}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// قيّد المفتاح في Google Console واستخدم env vars',
      conf:    96,
    },
    {
      name:    'Google OAuth Client Secret',
      regex:   /GOCSPX-[A-Za-z0-9\-_]{28}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم environment variables',
      conf:    97,
    },

    // ─── Stripe ───────────────────────────────────────
    {
      name:    'Stripe Secret Key',
      regex:   /sk_live_[A-Za-z0-9]{24,}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم sk_test للتطوير وenv vars للإنتاج',
      conf:    99,
    },
    {
      name:    'Stripe Publishable Key',
      regex:   /pk_live_[A-Za-z0-9]{24,}/,
      sev:     'h',
      cwe:     'CWE-798',
      fix:     '// استخدم pk_test للتطوير',
      conf:    95,
    },

    // ─── JWT ──────────────────────────────────────────
    {
      name:    'JWT Token (hardcoded)',
      regex:   /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
      sev:     'h',
      cwe:     'CWE-798',
      fix:     '// لا تضع JWT tokens في الكود',
      conf:    90,
    },
    {
      name:    'JWT Secret (weak)',
      regex:   /jwt[_\-]?secret\s*[:=]\s*['"][^'"]{3,30}['"]/i,
      sev:     'h',
      cwe:     'CWE-330',
      fix:     '// استخدم secret قوي من env vars: process.env.JWT_SECRET',
      conf:    85,
    },

    // ─── Private Keys ─────────────────────────────────
    {
      name:    'RSA Private Key',
      regex:   /-----BEGIN RSA PRIVATE KEY-----/,
      sev:     'c',
      cwe:     'CWE-321',
      fix:     '// لا ترفع private keys في الكود — استخدم key store',
      conf:    99,
    },
    {
      name:    'Private Key (Generic)',
      regex:   /-----BEGIN (?:EC|DSA|OPENSSH|PGP) PRIVATE KEY-----/,
      sev:     'c',
      cwe:     'CWE-321',
      fix:     '// لا ترفع private keys في الكود',
      conf:    99,
    },

    // ─── Slack ────────────────────────────────────────
    {
      name:    'Slack Bot Token',
      regex:   /xoxb-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم Slack App secrets بشكل آمن',
      conf:    98,
    },
    {
      name:    'Slack Webhook URL',
      regex:   /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/,
      sev:     'h',
      cwe:     'CWE-798',
      fix:     '// أضف للـ .env واستبعده من git',
      conf:    97,
    },

    // ─── Database ─────────────────────────────────────
    {
      name:    'Database Connection String',
      regex:   /(?:mongodb|mysql|postgres|postgresql):\/\/[^:]+:[^@]+@[^/\s]+/i,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم DATABASE_URL في env vars',
      conf:    93,
    },

    // ─── Generic Passwords ────────────────────────────
    {
      name:    'Hardcoded Password (strong)',
      regex:   /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i,
      sev:     'h',
      cwe:     'CWE-259',
      fix:     '// استخدم environment variables بدل hardcoded passwords',
      conf:    80,
    },
    {
      name:    'Hardcoded API Key',
      regex:   /(?:api[_\-]?key|apikey|access[_\-]?key)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i,
      sev:     'h',
      cwe:     'CWE-798',
      fix:     '// استخدم environment variables للـ API keys',
      conf:    82,
    },

    // ─── Anthropic / OpenAI ───────────────────────────
    {
      name:    'Anthropic API Key',
      regex:   /sk-ant-[A-Za-z0-9\-_]{40,}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم process.env.ANTHROPIC_API_KEY',
      conf:    99,
    },
    {
      name:    'OpenAI API Key',
      regex:   /sk-[A-Za-z0-9]{48}/,
      sev:     'c',
      cwe:     'CWE-798',
      fix:     '// استخدم process.env.OPENAI_API_KEY',
      conf:    95,
    },

    // ─── Firebase ─────────────────────────────────────
    {
      name:    'Firebase API Key',
      regex:   /AIza[0-9A-Za-z\-_]{35}/,
      sev:     'h',
      cwe:     'CWE-798',
      fix:     '// قيّد Firebase rules وقيّد المفتاح',
      conf:    90,
    },

    // ─── SSH ──────────────────────────────────────────
    {
      name:    'SSH Private Key',
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
    if (/example|sample|test|dummy|placeholder|xxx|yyy|your[_\-]?key/i.test(t)) return;

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
