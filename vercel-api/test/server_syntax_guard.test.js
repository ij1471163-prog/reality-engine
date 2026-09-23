// ═══════════════════════════════════════════════════════
// اختبارات فحص syntax النسبي في VERIFIER السيرفر (server_engine_registration.js)
// تشغيل:  node --test vercel-api/test/server_syntax_guard.test.js
//
// FixVerifier في السيرفر لا يملك acorn ولا compiler لـTS ولا فاحصًا لـPHP، و
// allowUnverifiedLanguages يمرّر هذه اللغات؛ و fallback الـnew Function يعتبر
// أي "Unexpected token" مع كلمة import/export "ESM لا يمكن فحصه". فكان patch
// مكسور يصل SAFE_AUTO_FIX. بعد fullVerify يُفحص الـcandidate نسبيًا: يُرفض فقط
// إذا كان الأصل سليمًا بنفس الفحص والـcandidate مكسورًا (acorn لـJS/ESM، فحص
// توازن بنيوي لـTS/PHP). أصل لا يمر بالفحص ⇒ لا حكم، والقرار كما كان.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

delete process.env.ANTHROPIC_API_KEY;
const { RealityOrchestrator: O } = require('../public/server_engine_registration.js');

const ROOT = path.join(__dirname, '..');
const pipeline = (code, file, opts) => O.runPipelineAsync(code, file, Object.assign({ useFallbackChain: true }, opts || {}));
const verify = (before, after, file) => O.runVerification(before, after, file);

// ═══ 1. runVerification يرفض المكسور في JS/ESM/TS/PHP ═══
const BROKEN = {
  'ESM missing paren': ['a.mjs', 'import x from "y";\nvar a = 1;\nfetch("http://api.example.com/a");\n', 'import x from "y";\nlet a = 1;\nfetch("https://api.example.com/a";\n', /^REJECTED_SYNTAX_BROKEN \[javascript\]/],
  'ESM in .js missing paren': ['a.js', 'import x from "y";\nvar a = 1;\nfetch("http://api.example.com/a");\nexport default a;\n', 'import x from "y";\nlet a = 1;\nfetch("https://api.example.com/a";\nexport default a;\n', /^REJECTED_SYNTAX_BROKEN \[javascript\]/],
  'CommonJS with "import" in a comment, unterminated string': ['a.js', '// TODO: import helpers\nvar x = 1;\nconst s = "http://api.example.com/a";\n', '// TODO: import helpers\nlet x = 1;\nconst s = process.env.S"https://api.example.com/a";\n', /^REJECTED_SYNTAX_BROKEN \[javascript\]/],
  'TS missing paren': ['a.ts', 'var a: number = 1;\nfetch("http://api.example.com/a");\n', 'let a: number = 1;\nfetch("https://api.example.com/a";\n', /^REJECTED_SYNTAX_BROKEN \[typescript\]/],
  'TS unterminated string': ['a.ts', 'const s: string = "http://api.example.com";\nexport default s;\n', 'const s: string = process.env.S"https://api.example.com;\nexport default s;\n', /^REJECTED_SYNTAX_BROKEN \[typescript\]/],
  'PHP unclosed brace': ['a.php', '<?php\nif ($a) {\n  $u = "http://api.example.com";\n}\n', '<?php\nif ($a) {\n  $u = "https://api.example.com";\n\n', /^REJECTED_SYNTAX_BROKEN \[php\]/],
};
for (const [name, [file, before, after, reason]] of Object.entries(BROKEN)) {
  test(`runVerification rejects broken candidate: ${name}`, () => {
    const r = verify(before, after, file);
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.improved, false);
    assert.match(r.reason, reason);
  });
}

// ═══ 2. السليم لا يتغير ═════════════════════════════════
const VALID = {
  'JS':  ['a.js',  'var x = 1;\nfetch("http://api.example.com/a");\n', 'let x = 1;\nfetch("https://api.example.com/a");\n'],
  'ESM': ['a.mjs', 'import x from "y";\nvar a = 1;\nfetch("http://api.example.com/a");\n', 'import x from "y";\nlet a = 1;\nfetch("https://api.example.com/a");\n'],
  'TS':  ['a.ts',  'var a: number = 1;\nfetch("http://api.example.com/a");\n', 'let a: number = 1;\nfetch("https://api.example.com/a");\n'],
  'TS with regex, template, generics': ['b.ts',
    'const re = /a\\/b[/]c/g;\nconst t = `x ${y ? `n${z}` : "q"} w`;\nexport const f = <T,>(v: T): T => v;\nvar u = "http://api.example.com";\n',
    'const re = /a\\/b[/]c/g;\nconst t = `x ${y ? `n${z}` : "q"} w`;\nexport const f = <T,>(v: T): T => v;\nlet u = "https://api.example.com";\n'],
  'PHP': ['a.php', '<?php\n$u = "http://api.example.com";\necho $u;\n', '<?php\n$u = "https://api.example.com";\necho $u;\n'],
};
for (const [name, [file, before, after]] of Object.entries(VALID)) {
  test(`runVerification accepts valid fix: ${name}`, () => {
    const r = verify(before, after, file);
    assert.strictEqual(r.valid, true, r.reason);
    assert.strictEqual(r.improved, true, r.reason);
  });
}

// ═══ 3. فحص نسبي: أصل لا يمر بالفحص ⇒ لا حكم جديد ═══════
test('relative: PHP with heredoc (checker cannot judge) keeps the previous decision', () => {
  const before = '<?php\n$h = <<<EOT\nhello\nEOT;\n$u = "http://api.example.com";\n';
  const after = '<?php\n$h = <<<EOT\nhello\nEOT;\n$u = "https://api.example.com"\n';
  const r = verify(before, after, 'h.php');
  assert.strictEqual(r.valid, true, r.reason);
  assert.match(r.reason, /SYNTAX_UNVERIFIED \[php\]/);
});

test('relative: a candidate already rejected by fullVerify keeps its reason', () => {
  const r = verify('var x = 1;\nfetch("http://api.example.com/a");\n', 'let x = 1;\nfetch("https://api.example.com/a";\n', 'a.js');
  assert.strictEqual(r.valid, false);
  assert.match(r.reason, /^REJECTED_SYNTAX_BROKEN \[javascript\]: SyntaxError/);
});

// ═══ 4. المسار الكامل: الـ9 حالات من الـaudit ═════════════
const DET_BROKEN = {
  'm3.mjs': "import x from 'y';\nconst secret = 'const API_SECRET = \"sk_live_abc123xyz789def456ghi\";';\nexport default secret;\n",
  'm4.js':  "import x from 'y';\nconst secret = 'const API_SECRET = \"sk_live_abc123xyz789def456ghi\";';\nexport default secret;\n",
  'm5.ts':  "const secret: string = 'const API_SECRET = \"sk_live_abc123xyz789def456ghi\";';\nexport default secret;\n",
  'm6.js':  "// import helpers later\nconst secret = 'const API_SECRET = \"sk_live_abc123xyz789def456ghi\";';\nmodule.exports = secret;\n",
  'm8.php': "<?php\n$s = 'const API_SECRET = \"sk_live_abc123xyz789def456ghi\";';\necho $s;\n",
};
for (const [file, code] of Object.entries(DET_BROKEN)) {
  test(`pipeline: broken deterministic patch never reaches SAFE_AUTO_FIX — ${file}`, async () => {
    const r = await pipeline(code, file);
    assert.notStrictEqual(r.decision.decision, 'SAFE_AUTO_FIX');
    // يُرفض إما في repairCode نفسه (حارس السر، فلا patch يصل) أو في الـverifier بـSYNTAX_BROKEN
    assert.ok(r.phases.fallback.stages.every(s => !s.succeeded), 'no deterministic patch was accepted');
    for (const s of r.phases.fallback.stages) {
      if (s.verifyResult && s.verifyResult.valid === false) assert.match(s.verifyResult.reason, /^REJECTED_SYNTAX_BROKEN/);
    }
  });
}

const REAL = [
  'test/claude_repair_completeness.test.js', 'test/repair_cmd_candidate.test.js',
  'test/repair_engine.test.js', 'test/server_verifier_syntax.test.js',
];
for (const rel of REAL) {
  test(`pipeline: real file ${rel} — no SAFE_AUTO_FIX with a patch that fails to parse`, async () => {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const r = await pipeline(code, path.basename(rel));
    if (r.decision.decision === 'SAFE_AUTO_FIX') {
      const p = verify(code, r.decision.patch, path.basename(rel));
      assert.strictEqual(p.valid, true, 'SAFE_AUTO_FIX patch must pass the server verifier');
      assert.doesNotMatch(p.reason, /SYNTAX_UNVERIFIED/);
    }
  });
}

// ═══ 5. المسار الكامل: إصلاحات سليمة تبقى SAFE_AUTO_FIX ═══
const DET_VALID = {
  'a.js':   'var x = 1;\nfetch("http://api.example.com/a");\n',
  'a.mjs':  'import x from "y";\nvar a = 1;\nfetch("http://api.example.com/a");\nexport default a;\n',
  'esm.js': 'import x from "y";\nvar a = 1;\nfetch("http://api.example.com/a");\nexport default a;\n',
  'a.ts':   'var a: number = 1;\nfetch("http://api.example.com/a");\nif (a == 2) {}\n',
  'a.php':  '<?php\n$u = "http://api.example.com";\necho $u;\n',
  's.py':   'import requests\nurl = "http://api.example.com"\nr = requests.get(url)\n',
};
for (const [file, code] of Object.entries(DET_VALID)) {
  test(`pipeline: valid deterministic fix stays SAFE_AUTO_FIX — ${file}`, async () => {
    const r = await pipeline(code, file);
    assert.strictEqual(r.decision.decision, 'SAFE_AUTO_FIX', r.decision.reason);
    assert.notStrictEqual(r.decision.patch, code);
  });
}
