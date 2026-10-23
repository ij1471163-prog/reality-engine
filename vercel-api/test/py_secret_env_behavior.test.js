// ═══════════════════════════════════════════════════════════════════════
// [PY-ENV] إصلاح أسرار Python يفشل مغلقًا — اختبارات سلوكية بتشغيل Python فعليًا
// تشغيل:  node --test vercel-api/test/py_secret_env_behavior.test.js
//
// المقيس قبل التغيير: مسارات الخادم (المحوّل وخط الإصلاح) تطبّق تلقائيًا
// ‎SECRET_KEY = os.environ.get('SECRET_KEY', '')‎ والبوابة تقبله. بلا المتغير
// يعمل البرنامج بمفتاح فارغ صامتًا (HMAC يوقّع، والطول 0) — فشلٌ مفتوح.
// المطلوب: ‎os.environ['X']‎ — مع المتغير نفس الناتج بايتًا، وبلاه توقّف صريح
// (KeyError) عند الاستيراد/البدء إن كان السرّ على مستوى الوحدة، وعند النداء إن
// كان داخل دالة. والبوابة ترفض أي قراءة بقيمة افتراضية حرفية من أي مصدر.
//
// Python محلي (python3 -I، بلا شبكة ولا حزم خارجية)؛ يُتخطى صراحةً إن غاب.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const { spawnSync } = require('node:child_process');

const { createRepairEngine } = require('../public/server_repair_adapter.js');
const { FixVerifier: FV, RealityOrchestrator: RO } = require('../public/server_engine_registration.js');

const E = createRepairEngine();
const gate = (b, a, f) => FV.verifyFix(b, a, f, (c, n) => E.analyze(c, n));
const hasPython = spawnSync('python3', ['-c', 'print(1)']).status === 0;
const NO_PY = hasPython ? false : 'python3 غير متوفر';
const LITERAL_DEFAULT = /(?:os\.environ\.get|os\.getenv)\s*\(\s*[^,()]+,\s*(?:'[^']*'|"[^"]*")\s*\)/;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'py-env-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let seq = 0;
function py(code, env, args) {
  const f = path.join(TMP, 'prog_' + (++seq) + '.py');
  fs.writeFileSync(f, code);
  const r = spawnSync('python3', ['-I', ...(args || []), f], { env: Object.assign({ PATH: process.env.PATH }, env || {}), encoding: 'utf8', cwd: TMP });
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function importModule(code, env, after) {
  const name = 'mod_' + (++seq);
  fs.writeFileSync(path.join(TMP, name + '.py'), code);
  const r = spawnSync('python3', ['-I', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(TMP)}); import ${name} as m; print("imported"); ${after || ''}`],
    { env: Object.assign({ PATH: process.env.PATH }, env || {}), encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const envNames = code => [...code.matchAll(/os\.environ\[['"]([A-Za-z_]\w*)['"]\]/g)].map(m => m[1]);

// برامج Python قابلة للتشغيل بمكتبة قياسية فقط؛ secret = القيمة الحرفية الأصلية
const SAMPLES = {
  'module_secret.py': { secret: 's3cr3t-k3y-abcdef123456', level: 'module',
    code: 'import hmac, hashlib\nSECRET_KEY = "s3cr3t-k3y-abcdef123456"\ndef sign(m):\n    return hmac.new(SECRET_KEY.encode(), m, hashlib.sha256).hexdigest()\nprint(sign(b"payload"))\n' },
  'password.py': { secret: 'hunter2secret', level: 'module', code: 'password = "hunter2secret"\nprint(len(password))\n' },
  'api_key.py': { secret: 'sk_live_abcdef1234567890abcd', level: 'module', code: 'API_KEY = "sk_live_abcdef1234567890abcd"\nprint(len(API_KEY))\n' },
  'in_function.py': { secret: 'tok_abcdef1234567890xyz', level: 'function',
    code: 'def connect():\n    api_token = "tok_abcdef1234567890xyz"\n    return api_token\nprint("loaded")\nprint(len(connect()))\n' },
  'app_start.py': { secret: 's3cr3t-k3y-abcdef123456', level: 'module',
    code: 'import hmac, hashlib\nSECRET_KEY = "s3cr3t-k3y-abcdef123456"\ndef sign(m):\n    return hmac.new(SECRET_KEY.encode(), m, hashlib.sha256).hexdigest()\nif __name__ == "__main__":\n    print("started")\n    print(sign(b"x"))\n' },
};

// مخرجات مسارَي الخادم الحقيقيين لكل عيّنة (تُحسب مرة)
const OUT = {};
test.before(async () => {
  for (const [n, s] of Object.entries(SAMPLES)) {
    const adapter = E.repair(s.code, E.analyze(s.code, n), n).repaired;
    const r = await RO.runPipelineAsync(s.code, n, { useFallbackChain: true });
    const d = r && r.decision;
    OUT[n] = { adapter, pipeline: d && d.decision === RO.Decision.SAFE_AUTO_FIX ? d.patch : null, decision: d && d.decision };
  }
});

test('[PY-ENV-1] مسارا الخادم يُصلحان كل العيّنات بـos.environ[\'X\'] ولا يُنتجان قراءة بافتراضي حرفي', () => {
  for (const [n, s] of Object.entries(SAMPLES)) {
    for (const [path_, out] of [['adapter', OUT[n].adapter], ['pipeline', OUT[n].pipeline]]) {
      assert.ok(out && out !== s.code, n + ' @ ' + path_ + ': لم يُصلَح (' + OUT[n].decision + ')');
      assert.doesNotMatch(out, LITERAL_DEFAULT, n + ' @ ' + path_ + ': افتراضي حرفي — فشلٌ مفتوح');
      assert.ok(envNames(out).length >= 1, n + ' @ ' + path_ + ': لا os.environ[...]');
      assert.match(out, /^import os$/m, n + ': import os غائب');
      assert.ok(!out.includes(s.secret), n + ': السرّ ما زال في الكود');
    }
  }
});

test('[PY-ENV-2] صلاحية الكود: كل مخرج يُترجَم (py_compile)', { skip: NO_PY }, () => {
  for (const [n] of Object.entries(SAMPLES)) for (const out of [OUT[n].adapter, OUT[n].pipeline]) {
    const r = py(out, {}, ['-m', 'py_compile']);
    assert.strictEqual(r.status, 0, n + ': ' + r.err);
  }
});

test('[PY-ENV-3] مع المتغير بالقيمة الأصلية: الناتج يطابق البرنامج الأصلي حرفيًا', { skip: NO_PY }, () => {
  for (const [n, s] of Object.entries(SAMPLES)) {
    const before = py(s.code);
    assert.strictEqual(before.status, 0, n + ' الأصل لا يعمل: ' + before.err);
    for (const out of [OUT[n].adapter, OUT[n].pipeline]) {
      const env = Object.fromEntries(envNames(out).map(k => [k, s.secret]));
      const after = py(out, env);
      assert.strictEqual(after.status, 0, n + ': ' + after.err);
      assert.strictEqual(after.out, before.out, n + ': الناتج تغيّر');
    }
  }
});

test('[PY-ENV-4] بلا المتغير: توقّف صريح بـKeyError يسمّي المتغير — لا مفتاح فارغ صامت', { skip: NO_PY }, () => {
  for (const [n, s] of Object.entries(SAMPLES)) for (const out of [OUT[n].adapter, OUT[n].pipeline]) {
    const r = py(out);
    assert.notStrictEqual(r.status, 0, n + ': عمل بلا المتغير');
    assert.match(r.err, new RegExp("KeyError: '" + envNames(out)[0] + "'"), n + ': ' + r.err.split('\n').pop());
  }
});

test('[PY-ENV-5] الاستيراد وبدء التطبيق: سرّ الوحدة يُوقف الاستيراد والبدء؛ سرّ الدالة لا يُوقف الاستيراد بل النداء', { skip: NO_PY }, () => {
  // بدء التطبيق: لا يطبع «started» بلا المتغير، ويبدأ عاديًا معه
  const app = OUT['app_start.py'].pipeline;
  const noEnv = py(app);
  assert.notStrictEqual(noEnv.status, 0);
  assert.ok(!/started/.test(noEnv.out), 'بدأ التطبيق بلا المتغير');
  assert.match(noEnv.err, /KeyError: 'SECRET_KEY'/);
  const withEnv = py(app, { SECRET_KEY: 's3cr3t-k3y-abcdef123456' });
  assert.strictEqual(withEnv.status, 0, withEnv.err);
  assert.strictEqual(withEnv.out, py(SAMPLES['app_start.py'].code).out);
  // الاستيراد: سرّ على مستوى الوحدة
  const modOut = OUT['module_secret.py'].pipeline.replace(/^print\(sign\(b"payload"\)\)\n/m, '');
  const imp = importModule(modOut);
  assert.notStrictEqual(imp.status, 0);
  assert.ok(!/imported/.test(imp.out));
  assert.match(imp.err, /KeyError: 'SECRET_KEY'/);
  assert.strictEqual(importModule(modOut, { SECRET_KEY: 'k' }).status, 0);
  // الاستيراد: سرّ داخل دالة — الاستيراد ينجح، والفشل عند النداء فقط
  const fnOut = OUT['in_function.py'].pipeline.replace(/^print\("loaded"\)\nprint\(len\(connect\(\)\)\)\n/m, '');
  const name = envNames(fnOut)[0];
  const impFn = importModule(fnOut);
  assert.strictEqual(impFn.status, 0, 'استيراد وحدة سرّها داخل دالة فشل: ' + impFn.err);
  const call = importModule(fnOut, {}, 'm.connect()');
  assert.notStrictEqual(call.status, 0);
  assert.match(call.out, /imported/, 'الاستيراد نفسه فشل');
  assert.match(call.err, new RegExp("KeyError: '" + name + "'"));
});

test('[PY-ENV-6] الشكل القديم يفشل مفتوحًا فعلًا (الثغرة حقيقية): بلا المتغير يعمل بمفتاح فارغ', { skip: NO_PY }, () => {
  const old = "import os\nAPI_KEY = os.environ.get('API_KEY', '')\nprint(len(API_KEY))\n";
  const r = py(old);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.out, '0');
});

// ═══ البوابة: الرفض من أي مصدر، والرفض لا يُطبَّق ══════════════════════
const PY_SECRET = SAMPLES['api_key.py'].code;
const JS = 'const jwt = require("jsonwebtoken");\nconst API_KEY = "sk_live_abcdef1234567890abcd";\nmodule.exports = () => jwt.sign({}, API_KEY);\n';

test('[PY-ENV-7] البوابة ترفض القراءة بافتراضي حرفي (Python وJS) وتقبل القراءة الصارمة', () => {
  const reject = [
    ['a.py', PY_SECRET, "import os\nAPI_KEY = os.environ.get('API_KEY', '')\nprint(len(API_KEY))\n"],
    ['a.py', PY_SECRET, "import os\nAPI_KEY = os.environ.get('API_KEY', 'dev-key')\nprint(len(API_KEY))\n"],
    ['a.py', PY_SECRET, "import os\nAPI_KEY = os.getenv('API_KEY', '')\nprint(len(API_KEY))\n"],
    ['a.js', JS, JS.replace('"sk_live_abcdef1234567890abcd"', 'process.env.API_KEY || "dev-key"')],
    ['a.js', JS, JS.replace('"sk_live_abcdef1234567890abcd"', "process.env.API_KEY ?? ''")],
  ];
  for (const [f, b, a] of reject) {
    const v = gate(b, a, f);
    assert.notStrictEqual(v.accepted, true, f + ' قُبل: ' + a.split('\n').find(l => /environ|getenv|process\.env/.test(l)));
    assert.match(String(v.reason), /قيمة افتراضية حرفية/, String(v.reason));
  }
  assert.strictEqual(gate(PY_SECRET, "import os\nAPI_KEY = os.environ['API_KEY']\nprint(len(API_KEY))\n", 'a.py').accepted, true);
  assert.strictEqual(gate(JS, JS.replace('"sk_live_abcdef1234567890abcd"', 'process.env.API_KEY'), 'a.js').accepted, true);
});

test('[PY-ENV-8] الإصلاح المرفوض لا يُطبَّق: قرار خط الإصلاح ليس SAFE_AUTO_FIX لأي مخرج بافتراضي حرفي، والإعادة على المُصلَح لا تغيّر شيئًا', async () => {
  for (const [n] of Object.entries(SAMPLES)) {
    if (OUT[n].pipeline) assert.doesNotMatch(OUT[n].pipeline, LITERAL_DEFAULT, n);
    const again = E.repair(OUT[n].adapter, E.analyze(OUT[n].adapter, n), n).repaired;
    assert.strictEqual(again, OUT[n].adapter, n + ': الإصلاح غير ثابت عند الإعادة');
  }
});
