// ═══════════════════════════════════════════════════════
// crypto_scanner.js — يكتشف مشاكل التشفير والأمان
// ═══════════════════════════════════════════════════════

function scanCrypto(code, fileName) {
  const issues = [];
  const lines = code.split('\n');
  const ext = fileName.split('.').pop().toLowerCase();

  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;
    const ln = i + 1;

    // 1. MD5 للتشفير الحساس
    if (/\bmd5\b/i.test(t) && /hash|password|encrypt|sign/i.test(t)) {
      issues.push({
        type: 'crypto', sev: 'c', line: ln, ev: t,
        title: '🔴 MD5 ضعيف للتشفير',
        fix: '// استخدم SHA-256 أو bcrypt',
        conf: 90, cIcon: '🔴', cAct: 'خوارزمية مكسورة',
        cEv: ['MD5 مكسور منذ 2004 — لا تستخدمه للتشفير']
      });
    }

    // 2. SHA1 للتشفير الحساس
    if (/\bsha1\b|\bsha-1\b/i.test(t) && /hash|password|sign|cert/i.test(t)) {
      issues.push({
        type: 'crypto', sev: 'c', line: ln, ev: t,
        title: '🔴 SHA-1 ضعيف',
        fix: '// استخدم SHA-256 أو SHA-512',
        conf: 88, cIcon: '🔴', cAct: 'خوارزمية ضعيفة',
        cEv: ['SHA-1 معرض للـ collision attacks']
      });
    }

    // 3. DES / 3DES
    if (/\b(des|3des|triple.?des)\b/i.test(t)) {
      issues.push({
        type: 'crypto', sev: 'c', line: ln, ev: t,
        title: '🔴 DES/3DES ضعيف جداً',
        fix: '// استخدم AES-256-GCM',
        conf: 92, cIcon: '🔴', cAct: 'تشفير مكسور',
        cEv: ['DES مفتاحه 56-bit — مكسور بالكامل']
      });
    }

    // 4. ECB mode
    if (/ecb/i.test(t) && /aes|cipher|encrypt/i.test(t)) {
      issues.push({
        type: 'crypto', sev: 'h', line: ln, ev: t,
        title: '🟠 AES-ECB غير آمن',
        fix: '// استخدم AES-GCM أو AES-CBC مع IV عشوائي',
        conf: 85, cIcon: '🟠', cAct: 'وضع تشفير ضعيف',
        cEv: ['ECB يكشف patterns في البيانات']
      });
    }

    // 5. Math.random() للأمان
    if (/Math\.random\(\)/.test(t) && /token|password|secret|key|salt|nonce|otp|session/i.test(t)) {
      issues.push({
        type: 'crypto', sev: 'h', line: ln, ev: t,
        title: '🟠 Math.random() غير آمن للـ tokens',
        fix: ext === 'py'
          ? t.replace(/random\.random\(\)|Math\.random\(\)/, 'secrets.token_hex(32)')
          : t.replace('Math.random()', 'crypto.randomBytes(32).toString("hex")'),
        conf: 88, cIcon: '🟠', cAct: 'PRNG غير آمن',
        cEv: ['Math.random() قابل للتنبؤ — استخدم crypto.randomBytes']
      });
    }

    // 6. Hardcoded IV/Salt/Nonce
    if (/\b(iv|salt|nonce)\s*=\s*["'][^"']{4,}["']/i.test(t)) {
      issues.push({
        type: 'crypto', sev: 'h', line: ln, ev: t,
        title: '🟠 IV/Salt ثابت في الكود',
        fix: '// استخدم IV عشوائي: crypto.randomBytes(16)',
        conf: 85, cIcon: '🟠', cAct: 'IV ثابت يضعف التشفير',
        cEv: ['IV يجب أن يكون عشوائياً لكل عملية تشفير']
      });
    }

    // 7. JWT بدون expiry
    if (/jwt\.sign\(|JWTBuilder|Jwts\.builder/i.test(t) && !/expir|exp:|expiresIn/i.test(t)) {
      issues.push({
        type: 'crypto', sev: 'h', line: ln, ev: t,
        title: '🟠 JWT بدون وقت انتهاء',
        fix: t.replace('jwt.sign(', 'jwt.sign(').replace(/\)$/, ', { expiresIn: "1h" })'),
        conf: 80, cIcon: '🟠', cAct: 'Token لا ينتهي أبداً',
        cEv: ['JWT بدون expiry يبقى صالحاً للأبد']
      });
    }

    // 8. SSL Verify disabled
    if (/verify\s*=\s*false|ssl_verify\s*=\s*false|rejectUnauthorized\s*:\s*false/i.test(t)) {
      issues.push({
        type: 'crypto', sev: 'c', line: ln, ev: t,
        title: '🔴 تحقق SSL معطّل',
        fix: t.replace(/verify\s*=\s*false/i, 'verify = True')
              .replace(/rejectUnauthorized\s*:\s*false/i, 'rejectUnauthorized: true'),
        conf: 95, cIcon: '🔴', cAct: 'MITM attack ممكن',
        cEv: ['تعطيل SSL verification يفتح باب MITM']
      });
    }

    // 9. Weak key size
    if (/keySize\s*[:=]\s*[0-9]+/.test(t)) {
      const sizeMatch = t.match(/keySize\s*[:=]\s*([0-9]+)/);
      if (sizeMatch && parseInt(sizeMatch[1]) < 256) {
        issues.push({
          type: 'crypto', sev: 'h', line: ln, ev: t,
          title: '🟠 مفتاح تشفير قصير: ' + sizeMatch[1] + ' bit',
          fix: t.replace(/keySize\s*[:=]\s*[0-9]+/, 'keySize: 256'),
          conf: 82, cIcon: '🟠', cAct: 'مفتاح ضعيف',
          cEv: ['استخدم مفتاح 256-bit على الأقل']
        });
      }
    }

    // 10. Base64 كـ encryption
    if (/btoa\(|atob\(|base64\.encode|base64\.decode/i.test(t) && /password|secret|encrypt/i.test(t)) {
      issues.push({
        type: 'crypto', sev: 'h', line: ln, ev: t,
        title: '🟠 Base64 ليس تشفيراً',
        fix: '// استخدم AES-256-GCM للتشفير الحقيقي',
        conf: 88, cIcon: '🟠', cAct: 'ترميز مش تشفير',
        cEv: ['Base64 قابل للعكس بدون مفتاح — ليس تشفيراً']
      });
    }

    // 11. Bcrypt rounds منخفض
    if (/bcrypt|argon2/i.test(t) && /round|cost|factor/i.test(t)) {
      const roundMatch = t.match(/rounds?\s*[:=,]\s*([0-9]+)/i);
      if (roundMatch && parseInt(roundMatch[1]) < 10) {
        issues.push({
          type: 'crypto', sev: 'm', line: ln, ev: t,
          title: '🟡 bcrypt rounds منخفض: ' + roundMatch[1],
          fix: t.replace(/rounds?\s*[:=,]\s*[0-9]+/i, 'rounds: 12'),
          conf: 75, cIcon: '🟡', cAct: 'تشفير سريع يسهل brute force',
          cEv: ['استخدم minimum 10 rounds، يفضل 12']
        });
      }
    }

    // 12. Plaintext password comparison
    if (/password\s*==\s*|password\s*===\s*/i.test(t) && !/hash|bcrypt|encoded/i.test(t)) {
      issues.push({
        type: 'crypto', sev: 'c', line: ln, ev: t,
        title: '🔴 مقارنة كلمة مرور plaintext',
        fix: '// استخدم bcrypt.compare() أو similar',
        conf: 87, cIcon: '🔴', cAct: 'كلمات المرور مخزنة plain text',
        cEv: ['لا تقارن كلمات المرور مباشرة — استخدم hash comparison']
      });
    }
  });

  return issues;
}
