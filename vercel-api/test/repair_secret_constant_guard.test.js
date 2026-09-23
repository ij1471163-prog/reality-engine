// ═══════════════════════════════════════════════════════
// اختبارات حارس السر في repair_engine.js: ثوابت enum ومفاتيح التخزين ليست أسرارًا
// تشغيل:  node --test vercel-api/test/repair_secret_constant_guard.test.js
//
// fixHardcodedSecret / fixHardcodedPassword / fixApiKeyAdvanced تستبدل أول string في
// السطر بمتغير بيئة. semanticCandidateProblem كان يقبل الاستبدال إذا كان اسم المفتاح
// "يشبه" credential، أو إذا لم يكن هناك مفتاح أصلًا، فتحوّلت:
//   SECRET: 'secret'                    → SECRET: process.env.SECRET        (ثابت enum)
//   HARDCODED_SECRET: 'SECRET'          → process.env.HARDCODED_SECRET      (وسم)
//   const STORAGE_KEY = 're_learned_…'  → process.env.STORAGE_KEY           (اسم مفتاح تخزين)
//   _key: "sh_log"                      → process.env._KEY
//   if (t.includes('sql'))              → t.includes(process.env.STRATKEY)  (وسيط عادي)
//   'a.py': '…'                          → process.env.NAPI_KEY: '…'         (مفتاح object)
// الآن تُرفض هذه في rejected والكود لا يتغير. الأسرار الحقيقية تبقى تُصلح حرفيًا كما كانت.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const noop = () => {};
const ctx = { console: { log: noop, warn: noop, error: noop, info: noop } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'repair_engine.js'), 'utf8'), ctx, { filename: 'repair_engine.js' });

const TITLES = {
  HARDCODED_SECRET: '🔴 Hardcoded Credential (CWE-798)',
  HARDCODED_PASS: '🔴 كلمة مرور/مفتاح مُضمَّن في الكود',
  API_KEY: '🔴 API Key مكشوف (Stripe)',
};
function run(code, strat, file, line = 1) {
  const issues = [{ line, title: TITLES[strat], ev: code.split('\n')[line - 1].trim() }];
  assert.strictEqual(ctx.detectStrategy(issues[0], (file || 'a.js').split('.').pop()), strat, 'fixture: title routes to ' + strat);
  return ctx.repairCode(code, issues, file || 'a.js');
}

// ═══ 1. ليست أسرارًا → تُرفض، والكود لا يتغير ═══════════════
const REJECT = {
  'enum constant SECRET: \'secret\'':          ['HARDCODED_SECRET', "const TYPES = {\n  SECRET:      'secret',      // KEY, TOKEN, PASSWORD\n};\n", 2, /enum\/tag constant/],
  'enum constant (no comment)':               ['HARDCODED_SECRET', "const T = {\n  SECRET:     'secret',\n};\n", 2, /enum\/tag constant/],
  'enum constant with underscores':           ['HARDCODED_PASS', "const K = {\n  DB_PASSWORD: 'db_password',\n};\n", 2, /enum\/tag constant/],
  'tag value HARDCODED_SECRET: \'SECRET\'':     ['HARDCODED_SECRET', "const G = { HARDCODED_SECRET: 'SECRET', HARDCODED_PASS: 'SECRET', API_KEY: 'SECRET' };\n", 1, /enum\/tag constant/],
  'storage key STORAGE_KEY = \'re_learned_…\'':  ['HARDCODED_SECRET', "const STORAGE_KEY = 're_learned_patterns_v2';\n", 1, /storage\/lookup key/],
  'storage key _key: "sh_log"':               ['HARDCODED_SECRET', 'const S = {\n  _key: "sh_log",\n};\n', 2, /storage\/lookup key/],
  'plain call argument t.includes(\'sql\')':    ['HARDCODED_SECRET', "if (t.includes('sql')) stratKey = 'SQL_INJECTION';\n", 1, /argument of t\.includes\(\)/],
  'plain call argument in a secret-ish line': ['HARDCODED_PASS', "const single = repair(secret, one.filter(i => ctx.detectStrategy(i, 'js') === 'HARDCODED_SECRET'));\n", 1, /argument of ctx\.detectStrategy\(\)/],
  'object key \'a.py\':':                      ['HARDCODED_SECRET', "const F = {\n  'a.py': 'import os\\nAPI_KEY = \"sk_live_abcdef123456\"\\n',\n};\n", 2, /object key/],
  'enum property PASSWORD: "password"':     ['HARDCODED_PASS', 'const K = {\n  PASSWORD: "password",\n};\n', 2, /enum\/tag constant/],
  'quoted key with a tag value (fixer hits the key)': ['HARDCODED_SECRET', "const K = {\n  'API_KEY': 'SECRET',\n};\n", 2, /object key/],
  'storage key assignment LABEL_KEY':       ['HARDCODED_SECRET', 'const LABEL_KEY = "menu.file.open";\n', 1, /storage\/lookup key/],
  'object key \'m8.php\':':                    ['HARDCODED_PASS', "const F = {\n  'm8.php': \"<?php\\n$s = 'x';\\n\",\n};\n", 2, /object key/],
};
for (const [name, [strat, code, line, reason]] of Object.entries(REJECT)) {
  test(`not a secret → rejected, code unchanged: ${name}`, () => {
    const out = run(code, strat, 'a.js', line);
    assert.strictEqual(out.repaired, code);
    const rej = out.rejected.find(r => r.strategy === strat);
    assert.ok(rej, 'a rejection is recorded');
    assert.match(rej.reason, /^SECRET_NOT_CREDENTIAL/);
    assert.match(rej.reason, reason);
    assert.doesNotMatch(out.repaired, /process\.env/);
  });
}

// ═══ 2. أسرار حقيقية → تُصلح كما كانت ══════════════════════
const FIX = {
  'JS const password':            ['HARDCODED_PASS',   'const DB_PASSWORD = "not_a_real_password";\n', 'const DB_PASSWORD = process.env.DB_PASSWORD;\n', 'a.js'],
  'JS Stripe key':                ['HARDCODED_SECRET', 'const API_KEY = "sk_live_abc123xyz789def456ghi";\n', 'const API_KEY = process.env.API_KEY;\n', 'a.js'],
  'JS object password':           ['HARDCODED_PASS',   '  password: "hunter2",\n', '  password: process.env.PASSWORD,\n', 'a.js'],
  'JS enum-like key with a real secret value': ['HARDCODED_SECRET', "  SECRET: 'sk_live_abc123xyz789def456ghi',\n", '  SECRET: process.env.SECRET,\n', 'a.js'],
  'JS key named key with a random value':      ['HARDCODED_SECRET', 'const key = "abc123def456ghi789jkl";\n', 'const key = process.env.KEY;\n', 'a.js'],
  'JS storage-like name with a real token':    ['HARDCODED_SECRET', 'const CACHE_KEY = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n', 'const CACHE_KEY = process.env.CACHE_KEY;\n', 'a.js'],
  'JS jwt.sign argument':         ['HARDCODED_SECRET', 'const t = jwt.sign({ id }, "hardcoded", { expiresIn: "1h" });\n', 'const t = jwt.sign({ id }, process.env.T, { expiresIn: "1h" });\n', 'a.js'],
  'JS call argument that looks like a key':    ['HARDCODED_SECRET', 'const s = stripe("sk_live_abc123xyz789def456ghi");\n', 'const s = stripe(process.env.S);\n', 'a.js'],
  'TS token':                     ['HARDCODED_SECRET', 'const token: string = "tok_9f8e7d6c5b4a39281706";\n', 'const token: string = process.env.TOKEN;\n', 'a.ts'],
  'Python password':              ['HARDCODED_SECRET', 'password = "hunter2secret"\n', "password = os.environ.get('PASSWORD', '')\n", 'a.py'],
  // S1b: قواعد enum/CAPS على خصائص object فقط، والإسناد يبقى يُصلح
  'JS const SECRET = "secret" (assignment, not an enum property)': ['HARDCODED_SECRET', 'const SECRET = "secret";\n', 'const SECRET = process.env.SECRET;\n', 'a.js'],
  'JS all-caps random key in an assignment':  ['HARDCODED_SECRET', 'const apiKey = "ABCDEFGHIJKLMNOPQRST";\n', 'const apiKey = process.env.APIKEY;\n', 'a.js'],
  'JS signing key (signing is a credential name)': ['HARDCODED_SECRET', 'const signingKey = "my-signing-key";\n', 'const signingKey = process.env.SIGNINGKEY;\n', 'a.js'],
  'PHP secret':                   ['HARDCODED_SECRET', "<?php\n$secret = 'sk_live_abc123xyz789def456ghi';\n", "<?php\n$secret = getenv('SECRET');\n", 'a.php', 2],
};
for (const [name, [strat, code, expected, file, line]] of Object.entries(FIX)) {
  test(`real secret still fixed: ${name}`, () => {
    const out = run(code, strat, file, line || 1);
    assert.strictEqual(out.repaired, expected);
    assert.strictEqual(out.rejected.filter(r => r.strategy === strat).length, 0);
  });
}

// ═══ 3. الملفات الحقيقية التي ظهر فيها الخطأ ═══════════════════
// نفس السطر والعنوان كما يبلّغ عنهما المحلل (CWE-798 / "كلمة مرور/مفتاح مُضمَّن")
const REAL = [
  ['context_analyzer.js', /^\s*SECRET:\s+'secret',/],
  ['deep_flow.js',        /^\s*SECRET:\s+'secret',/],
  ['smart_context.js',    /^\s*SECRET:\s+'secret',/],
  ['type_inference.js',   /^\s*SECRET:\s+'secret',/],
  ['learning_engine.js',  /STORAGE_KEY = 're_learned_patterns_v2'/],
  ['self_healing_engine.js', /_key: "sh_(?:log|snaps)"/],
  ['repair_engine.js',    /HARDCODED_SECRET: 'SECRET', HARDCODED_PASS: 'SECRET'/],
];
for (const [file, re] of REAL) {
  test(`real file ${file}: the constant line is not turned into process.env`, () => {
    const code = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    const lines = code.split('\n');
    const at = lines.map((l, i) => (re.test(l) ? i + 1 : 0)).filter(Boolean);
    assert.ok(at.length >= 1, 'fixture: the line exists');
    for (const line of at) {
      for (const strat of ['HARDCODED_SECRET', 'HARDCODED_PASS']) {
        const out = ctx.repairCode(code, [{ line, title: TITLES[strat], ev: lines[line - 1].trim() }], file);
        assert.strictEqual(out.repaired.split('\n')[line - 1], lines[line - 1], `${strat} line ${line}`);
      }
    }
  });
}
