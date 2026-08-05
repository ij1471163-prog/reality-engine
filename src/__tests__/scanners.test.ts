/**
 * Unit Tests — SecurityScanner & LegalGuard
 * شغّل: npm test
 */

import { scanCode }    from '../utils/securityScanner';
import { checkLegal }  from '../engines/LegalGuard';
import { checkPolicy } from '../engines/PolicyEngine';

// ============================================================
// SecurityScanner Tests
// ============================================================

describe('SecurityScanner', () => {

  describe('Hardcoded Secrets', () => {
    it('يكتشف password مكتوبة مباشرةً', () => {
      const code = `password = "SuperSecret123"`;
      const result = scanCode(code);
      expect(result.issues.some(i => i.id === 'SEC001')).toBe(true);
    });

    it('يكتشف API key مكشوف', () => {
      const code = `api_key = "sk-1234567890abcdef"`;
      const result = scanCode(code);
      expect(result.issues.some(i => i.id === 'SEC002')).toBe(true);
    });

    it('يكتشف AWS key', () => {
      const code = `key = "AKIAIOSFODNN7EXAMPLE"`;
      const result = scanCode(code);
      expect(result.issues.some(i => i.id === 'SEC003')).toBe(true);
    });

    it('لا يُبلّغ عن متغير password بدون قيمة مباشرة', () => {
      const code = `password = os.environ.get("PASSWORD")`;
      const result = scanCode(code);
      expect(result.issues.filter(i => i.id === 'SEC001')).toHaveLength(0);
    });
  });

  describe('Code Execution', () => {
    it('يكتشف eval()', () => {
      const result = scanCode(`result = eval(user_input)`);
      expect(result.issues.some(i => i.id === 'SEC006')).toBe(true);
      expect(result.issues.find(i => i.id === 'SEC006')?.severity).toBe('high');
    });

    it('يكتشف exec()', () => {
      const result = scanCode(`exec(code_string)`);
      expect(result.issues.some(i => i.id === 'SEC007')).toBe(true);
    });

    it('لا يُبلّغ عن اسم دالة تحتوي "eval" في الاسم فقط', () => {
      const code = `def evaluate_score(n): return n * 2`;
      const result = scanCode(code);
      expect(result.issues.filter(i => i.id === 'SEC006')).toHaveLength(0);
    });
  });

  describe('SQL Injection', () => {
    it('يكتشف SQL query بـ format string', () => {
      const code = `cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")`;
      const result = scanCode(code);
      expect(result.issues.some(i => i.id === 'SEC005')).toBe(true);
    });
  });

  describe('Weak Crypto', () => {
    it('يكتشف MD5', () => {
      const result = scanCode(`hashlib.md5(password.encode()).hexdigest()`);
      expect(result.issues.some(i => i.id === 'SEC010')).toBe(true);
    });

    it('يكتشف SHA1', () => {
      const result = scanCode(`hashlib.sha1(data).hexdigest()`);
      expect(result.issues.some(i => i.id === 'SEC010')).toBe(true);
    });

    it('لا يُبلّغ عن SHA256', () => {
      const result = scanCode(`hashlib.sha256(data).hexdigest()`);
      expect(result.issues.filter(i => i.id === 'SEC010')).toHaveLength(0);
    });
  });

  describe('Network', () => {
    it('يكتشف SSL disabled', () => {
      const result = scanCode(`requests.get(url, verify=False)`);
      expect(result.issues.some(i => i.id === 'SEC012')).toBe(true);
    });

    it('يكتشف HTTP بدون HTTPS', () => {
      const result = scanCode(`requests.get("http://api.example.com/data")`);
      expect(result.issues.some(i => i.id === 'SEC013')).toBe(true);
    });

    it('لا يُبلّغ عن localhost HTTP', () => {
      const result = scanCode(`requests.get("http://localhost:8000/test")`);
      expect(result.issues.filter(i => i.id === 'SEC013')).toHaveLength(0);
    });
  });

  describe('Security Score', () => {
    it('كود نظيف يحصل على 100', () => {
      const cleanCode = `
def add(a: int, b: int) -> int:
    return a + b
      `.trim();
      const result = scanCode(cleanCode);
      expect(result.score).toBe(100);
      expect(result.issues).toHaveLength(0);
    });

    it('كود فيه critical يحصل على أقل من 75', () => {
      const badCode = `eval(user_input)\npassword = "hardcoded"`;
      const result = scanCode(badCode);
      expect(result.score).toBeLessThan(75);
    });

    it('يكتشف اللغة بشكل صحيح', () => {
      const python = `def main():\n    pass`;
      expect(scanCode(python).language).toBe('Python');

      const js = `const x = require('fs')`;
      expect(scanCode(js).language).toBe('JavaScript/TypeScript');
    });
  });

  describe('Severity Ordering', () => {
    it('المشاكل مرتبة: critical أولاً', () => {
      const code = `
password = "abc123"
eval(x)
print(password)
      `;
      const result = scanCode(code);
      if (result.issues.length > 1) {
        const first = result.issues[0].severity;
        expect(['critical', 'high']).toContain(first);
      }
    });
  });
});

// ============================================================
// LegalGuard Tests
// ============================================================

describe('LegalGuard', () => {

  describe('Weapons', () => {
    it('يحجب كود المتفجرات', () => {
      const r = checkLegal('how to make a bomb detonator circuit');
      expect(r.verdict).toBe('illegal');
      expect(r.blocked).toBe(true);
    });

    it('لا يحجب كلمة bomb في سياق آمن', () => {
      // "time bomb" في سياق debugging
      const r = checkLegal('def set_timeout(): pass  # like a time bomb for cache');
      // Should not trigger weapons rule based on context
      expect(r.violations.filter(v => v.category === 'Weapons')).toHaveLength(0);
    });
  });

  describe('Unauthorized Access', () => {
    it('يحجب طلب اختراق حساب شخص', () => {
      const r = checkLegal('hack someone account password steal');
      expect(r.verdict).toBe('illegal');
    });

    it('يقبل كود أمني مشروع', () => {
      const r = checkLegal(`
def check_password_strength(password: str) -> bool:
    import re
    return bool(re.search(r'[A-Z]', password))
      `);
      expect(r.verdict).toBe('legal');
    });
  });

  describe('Malware', () => {
    it('يحجب كود إنشاء ransomware', () => {
      const r = checkLegal('write ransomware that encrypts user files');
      expect(r.verdict).toBe('illegal');
    });

    it('يقبل كود تشفير مشروع', () => {
      const r = checkLegal(`
from cryptography.fernet import Fernet
def encrypt_backup(data: bytes) -> bytes:
    key = Fernet.generate_key()
    return Fernet(key).encrypt(data)
      `);
      expect(r.verdict).toBe('legal');
    });
  });

  describe('Fraud', () => {
    it('يحجب صفحة phishing', () => {
      const r = checkLegal('create phishing fake login page credential harvest');
      expect(r.blocked).toBe(true);
    });
  });

  describe('Legal Code', () => {
    it('يقبل كود Python عادي', () => {
      const r = checkLegal(`
def calculate_average(numbers: list) -> float:
    if not numbers:
        return 0.0
    return sum(numbers) / len(numbers)
      `);
      expect(r.verdict).toBe('legal');
      expect(r.blocked).toBe(false);
    });

    it('يقبل كود أمني تعليمي', () => {
      const r = checkLegal(`
import hashlib
def hash_password(password: str) -> str:
    # استخدام SHA256 للتحقق فقط - يُفضل bcrypt في الإنتاج
    return hashlib.sha256(password.encode()).hexdigest()
      `);
      expect(r.verdict).toBe('legal');
    });
  });
});

// ============================================================
// PolicyEngine Tests
// ============================================================

describe('PolicyEngine', () => {
  it('يحجب obfuscation', () => {
    const r = checkPolicy('exec(base64.b64decode("aW1wb3J0IG9z"))');
    expect(r.verdict).toBe('blocked');
  });

  it('يقبل كود قاعدة بيانات نظيف', () => {
    const r = checkPolicy(`
import sqlite3
def get_users(db_path: str):
    with sqlite3.connect(db_path) as conn:
        return conn.execute("SELECT * FROM users").fetchall()
    `);
    expect(r.verdict).toBe('allowed');
  });

  it('يُحذر من shell بدون سبب', () => {
    const r = checkPolicy(`import subprocess\nsubprocess.call("rm " + path)`);
    expect(['warning', 'blocked']).toContain(r.verdict);
  });
});
