// ═══════════════════════════════════════════════════════
// Regression: Python secret fixers (HARDCODED_PASS / HARDCODED_SECRET) + `import os`
// تشغيل:  node --test vercel-api/test/repair_py_os_import.test.js
//
// الخطأ الأصلي: fixHardcodedPassword كان يضيف `import os` بـ unshift ثم يكتب على الفهرس القديم
// فيستبدل السطر الذي قبل الهدف (يحذف API_KEY ويكرر DB_PASSWORD)، وfixHardcodedSecret لا يضيف
// `import os` أبدًا. الفحص السابق code.includes('import os') كان يخطئ مع osp / osmosis / تعليق.
// الاختبار هنا لا يقارن النص فقط: يشغّل الناتج بـ python3 ويتأكد أن os.environ يعمل
// وأن كل قيمة وصلت لاسمها الصحيح.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const { spawnSync } = require('node:child_process');

const { createRepairEngine } = require('../public/server_repair_adapter.js');
const eng = createRepairEngine();

const SECRETS = [
  ['API_KEY',     'sk-ant-api03-abc123def456ghi789jkl012mno345pqr678'],
  ['DB_PASSWORD', 'admin123'],
  ['SECRET_KEY',  'my_super_secret_jwt_key'],
];
const BODY = SECRETS.map(([n, v]) => `${n} = "${v}"`).join('\n') + '\n';

// [name, header lines, number of bare `import os` lines the fixer must ADD]
const CASES = [
  ['A: no import os',               '',                         1],
  ['B: import os already present',  'import os\n\n',            0],
  ['import os.path (binds os)',     'import os.path\n',         0],
  ['import os, sys (binds os)',     'import os, sys\n',         0],
  ['import os.path as osp (does NOT bind os)', 'import os.path as osp\n', 1],
  ['import osmosis (not os)',       'import osmosis\n',         1],
  ['# import os (comment)',         '# import os\n',            1],
  ['from os import environ (does NOT bind os)', 'from os import environ\n', 1],
];

const STUBS = fs.mkdtempSync(path.join(os.tmpdir(), 'pyos-stub-'));
fs.writeFileSync(path.join(STUBS, 'osmosis.py'), '');
const bareImportOs = s => s.split('\n').filter(l => /^\s*import\s+os\s*$/.test(l)).length;

for (const [name, header, added] of CASES) {
  test(`py secrets + import os: ${name}`, () => {
    const code = header + BODY;
    const issues = eng.analyze(code, 't.py');
    const r = eng.repair(code, issues, 't.py');
    const out = r.repaired;
    const outLines = out.split('\n');

    // 1) كل سر يُصلح مرة واحدة وفي سطره، ولا يبقى literal أصلي
    for (const [n, v] of SECRETS) {
      const hits = outLines.filter(l => new RegExp(`^${n}\\s*=\\s*os\\.environ\\.get\\('${n}', ''\\)\\s*$`).test(l));
      assert.strictEqual(hits.length, 1, `${n} must be fixed exactly once, got ${hits.length}\n${out}`);
      assert.ok(!out.includes(v), `${n} literal must be gone\n${out}`);
    }
    // 2) لا حذف ولا استبدال لسطر آخر: أسطر الـheader الأصلية باقية بترتيبها، والترتيب النسبي للأسرار محفوظ
    for (const h of header.split('\n').filter(Boolean)) {
      assert.ok(outLines.includes(h), `original header line lost: ${JSON.stringify(h)}\n${out}`);
    }
    const pos = SECRETS.map(([n]) => outLines.findIndex(l => l.startsWith(n + ' =')));
    assert.ok(pos.every(p => p >= 0) && pos[0] < pos[1] && pos[1] < pos[2], `secret lines moved/lost: ${pos}\n${out}`);
    // 3) import os يُضاف فقط عند الحاجة، ولا يتكرر
    assert.strictEqual(bareImportOs(out) - bareImportOs(code), added, `bare "import os" lines added\n${out}`);
    assert.ok(bareImportOs(out) <= 1, `duplicate import os\n${out}`);
    // 4) تشغيل فعلي: os مربوط، والقيم تصل لأسمائها الصحيحة
    const f = path.join(STUBS, 'case.py');
    fs.writeFileSync(f, out + '\nprint(API_KEY, DB_PASSWORD, SECRET_KEY)\n');
    const p = spawnSync('python3', [f], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: STUBS, API_KEY: 'k1', DB_PASSWORD: 'p1', SECRET_KEY: 's1' },
    });
    assert.strictEqual(p.status, 0, `python3 failed: ${p.stderr}\n${out}`);
    assert.strictEqual(p.stdout.trim(), 'k1 p1 s1');
  });
}

test('py secrets: HARDCODED_PASS alone and HARDCODED_SECRET alone (no import) both run', () => {
  for (const code of ['DB_PASSWORD = "admin123"\n', 'SECRET_KEY = "my_super_secret_jwt_key"\n']) {
    const r = eng.repair(code, eng.analyze(code, 't.py'), 't.py');
    const f = path.join(STUBS, 'single.py');
    fs.writeFileSync(f, r.repaired);
    const p = spawnSync('python3', [f], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: STUBS } });
    assert.strictEqual(p.status, 0, `${p.stderr}\n${r.repaired}`);
    assert.strictEqual(bareImportOs(r.repaired), 1);
  }
});
