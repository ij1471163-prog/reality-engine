// ═══════════════════════════════════════════════════════
// Backlog G3 — password hashing / weak crypto / HTML accumulation
// تشغيل:  node --test vercel-api/test/backlog_g3_crypto.test.js
//
// md5/sha1 → sha256 لـhash كلمة مرور ليس إصلاحًا (يبقى قابلًا للكسر) والمحلل
// يتوقف عن الإبلاغ ⇒ كان يخرج SAFE_AUTO_FIX + fileFullyResolved: true (مزيّف).
// الآن: سياق credential أو مدخل من parameter (مصدره قد يكون ملفًا آخر) ⇒ لا إعادة
// كتابة، والـfinding تبقى في aiNeeded مع السبب. checksum محلي يبقى كما كان.
// Java MessageDigest MD5/SHA-1 صار مكتشفًا (كشف فقط، strategy: null).
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const { RealityOrchestrator: RO } = require(path.join(PUBLIC_DIR, 'server_engine_registration.js'));

function loadUiContext() {
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => null, addEventListener: noop, createElement: () => ({}), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: noop }, navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة فقط */ }
  }
  ctx.GhostMode = undefined;
  return ctx;
}
const ctx = loadUiContext();

const WEAK = /md5|sha1|crypt|hash|تشفير|ضعيف|MessageDigest/i;
const weakLeft = out => (out.phases.fallback.remainingIssues || []).filter(i => WEAK.test(i.title));
const weakInAi = out => (out.phases.fallback.aiNeeded || []).filter(e => WEAK.test(e.title));
const serverRun = (code, file) => RO.runPipeline(code, file, { useFallbackChain: true });

// ═══ 1. لا SAFE_AUTO_FIX مزيّف لـhash كلمة مرور ═════════════
const NO_REWRITE = {
  'password param (js)':     ['pw.js', "const crypto = require('crypto');\nfunction hashPassword(password) {\n  return crypto.createHash('md5').update(password).digest('hex');\n}\nmodule.exports = { hashPassword };\n"],
  'password in line (js)':   ['pw2.js', "const crypto = require('crypto');\nconst hashed = crypto.createHash('sha1').update(req.body.password).digest('hex');\n"],
  'cross-file helper (js)':  ['xfile.js', "const crypto = require('crypto');\nfunction digest(value) {\n  return crypto.createHash('md5').update(value).digest('hex');\n}\nmodule.exports = { digest };\n"],
  'arrow helper (ts)':       ['h.ts', "import crypto from 'crypto';\nexport const digest = (input: string) => {\n  return crypto.createHash('md5').update(input).digest('hex');\n};\n"],
  'password hash (py)':      ['pw.py', "import hashlib\ndef hash_password(password):\n    return hashlib.md5(password.encode()).hexdigest()\n"],
  'cross-file helper (py)':  ['h.py', "import hashlib\ndef file_id(data):\n    return hashlib.md5(data).hexdigest()\n"],
  'password (php)':          ['pw.php', "<?php\n$hash = md5($_POST['password']);\n"],
};

// PHP helper: محلل السيرفر لا يكتشف md5($value) بلا كلمة password/$_GET (فجوة كشف
// موثّقة، لا إصلاح مزيّف). مسار الواجهة يكتشفه ويمنع إعادة الكتابة.
test('weak hash, cross-file helper (php, UI path): no rewrite, reason forwarded to aiNeeded', () => {
  const code = "<?php\nfunction digest($value) {\n  return md5($value);\n}\n";
  const issues = ctx.analyzeCode(code, 'h.php');
  assert.ok(issues.some(i => i.line === 3 && WEAK.test(i.title)), 'precondition: UI detects it');
  const r = ctx.repairCode(code, issues, 'h.php');
  assert.strictEqual(r.repaired, code);
  assert.ok(r.aiNeeded.some(a => a.line === 3 && /WEAK_CRYPTO_INPUT_FROM_CALLER \(value\)/.test(a.reason)));
});
for (const [name, [file, code]] of Object.entries(NO_REWRITE)) {
  test(`weak hash, ${name}: no rewrite, never SAFE_AUTO_FIX, finding stays in aiNeeded`, () => {
    const out = serverRun(code, file);
    assert.notStrictEqual(out.decision.decision, 'SAFE_AUTO_FIX');
    assert.ok(!/sha256|SHA-256/.test(String(out.decision.patch || '')), 'no md5→sha256 rewrite');
    assert.ok(weakLeft(out).length > 0, 'weak hash still reported');
    for (const f of weakLeft(out)) {
      assert.ok(weakInAi(out).some(e => e.line === f.line), `"${f.title}" line ${f.line} must be in aiNeeded`);
    }
  });
}

test('repairCode records the reason (rejected + aiNeeded) instead of a silent skip', () => {
  const code = NO_REWRITE['cross-file helper (js)'][1];
  const r = ctx.repairCode(code, ctx.analyzeCode(code, 'x.js'), 'x.js');
  assert.strictEqual(r.repaired, code);
  assert.ok(r.rejected.some(x => /^WEAK_CRYPTO_INPUT_FROM_CALLER \(value\)/.test(x.reason)));
  assert.ok(r.aiNeeded.some(a => /WEAK_CRYPTO_INPUT_FROM_CALLER/.test(a.reason)));
  const pw = NO_REWRITE['password param (js)'][1];
  const r2 = ctx.repairCode(pw, ctx.analyzeCode(pw, 'p.js'), 'p.js');
  assert.ok(r2.rejected.some(x => /WEAK_CRYPTO_(CREDENTIAL_CONTEXT|PASSWORD_HASH)/.test(x.reason)));
});

// ═══ 2. checksum محلي — السلوك السابق لا يتراجع ═════════════
test('local non-credential checksum is still auto-fixed (unchanged behavior)', () => {
  const code = "const crypto = require('crypto');\nconst etag = crypto.createHash('md5').update(fileBuffer).digest('hex');\n";
  const out = serverRun(code, 'cksum.js');
  assert.strictEqual(out.decision.decision, 'SAFE_AUTO_FIX');
  assert.match(out.decision.patch, /createHash\("sha256"\)\.update\(fileBuffer\)/);
  assert.strictEqual(weakLeft(out).length, 0);
});

test('hash of a local variable inside a function (not a parameter) is still auto-fixed', () => {
  const code = "const crypto = require('crypto');\nfunction etagOf(buf) {\n  const body = render();\n  return crypto.createHash('md5').update(body).digest('hex');\n}\n";
  const r = ctx.repairCode(code, ctx.analyzeCode(code, 'e.js'), 'e.js');
  assert.match(r.repaired, /createHash\("sha256"\)\.update\(body\)/);
});

// ═══ 3. Java — كشف بلا إعادة كتابة آلية ══════════════════════
test('java MessageDigest MD5/SHA-1 is detected; password context is critical CWE-916', () => {
  const pw = 'import java.security.MessageDigest;\nclass Auth {\n  String hash(String password) throws Exception {\n    MessageDigest md = MessageDigest.getInstance("MD5");\n    return new String(md.digest(password.getBytes()));\n  }\n}\n';
  const ck = 'import java.security.MessageDigest;\nclass Etag {\n  static String etag(byte[] buf) throws Exception {\n    MessageDigest md = MessageDigest.getInstance("SHA-1");\n    return hex(md.digest(buf));\n  }\n}\n';
  const a = ctx.analyzeCode(pw, 'Auth.java').find(i => /MessageDigest/.test(i.title));
  const b = ctx.analyzeCode(ck, 'Etag.java').find(i => /MessageDigest/.test(i.title));
  assert.ok(a && a.sev === 'c' && a.cwe === 'CWE-916' && a.line === 4 && a.strategy === null);
  assert.ok(b && b.sev === 'h' && b.cwe === 'CWE-327' && b.line === 4 && b.strategy === null);
  assert.strictEqual(ctx.detectStrategy(a, 'java'), null, 'no deterministic java rewrite path');
  for (const [code, file] of [[pw, 'Auth.java'], [ck, 'Etag.java']]) {
    const out = serverRun(code, file);
    assert.notStrictEqual(out.decision.decision, 'SAFE_AUTO_FIX');
    assert.ok(out.phases.fallback.aiNeeded.some(e => /MessageDigest/.test(e.title) && e.line === 4), file);
  }
});

test('java: commented-out MessageDigest is not reported', () => {
  const code = 'class A {\n  // MessageDigest md = MessageDigest.getInstance("MD5");\n}\n';
  assert.ok(!ctx.analyzeCode(code, 'A.java').some(i => /MessageDigest/.test(i.title)));
});

// ═══ 4. HTML accumulation — لا false positive ═══════════════
// تقرير FP سابق لم يتكرر في هذا الـclone (11 شكلًا). هذه الاختبارات تثبّت السلوك
// الحالي الصحيح كـregression، وليست إصلاحًا.
const HTML_NO_FP = {
  'markup text':        '<html><body>\n<ul>\n  <li>total = price</li>\n  <li>count = 3</li>\n</ul>\n<p>score = value</p>\n</body></html>\n',
  'loop-like text':     '<html><body>\n<p>for (const p of ps) {</p>\n<p>total = p.score;</p>\n<p>}</p>\n</body></html>\n',
  'pre code block':     '<pre>\nfor (const p of ps) {\n  total = p.score;\n}\n</pre>\n',
  'template loop':      '<div>\n{% for item in items %}\n  <span>total = {{ item.price }}</span>\n{% endfor %}\n</div>\n',
  'split scripts':      '<script>\nfor (const p of ps) {\n</script>\n<p>total = price</p>\n<script>\n}\n</script>\n',
  'inline handler':     '<html><body>\n<button onclick="for (const p of ps) { total = p.v }">x</button>\n</body></html>\n',
};
for (const [name, code] of Object.entries(HTML_NO_FP)) {
  test(`html ${name}: no accumulation finding and no repair`, () => {
    const issues = ctx.analyzeCode(code, 'p.html');
    assert.ok(!issues.some(i => /تراكم|accum|counter/i.test(i.title) || i.strategy === 'ACCUMULATION'));
    assert.strictEqual(ctx.repairCode(code, issues, 'p.html').repaired, code);
  });
}

test('html: a real accumulation bug inside <script> is still reported (no false negative)', () => {
  const code = '<html><body>\n<script>\nlet total = 0;\nfor (const p of ps) {\n  total = p.score;\n}\n</script>\n</body></html>\n';
  assert.ok(ctx.analyzeCode(code, 'p.html').some(i => i.line === 5 && /تراكم|counter/.test(i.title)));
});
