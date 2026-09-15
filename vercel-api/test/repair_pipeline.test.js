// ═══════════════════════════════════════════════════════
// اختبارات مسار الإصلاح: هوية اللغة · صلاحية أرقام الأسطر · حكم Ghost
// تشغيل:  node --test vercel-api/test/*.test.js   (من جذر المستودع)
// بلا أي تبعيات خارجية — node:test مدمج.
// ═══════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const API_DIR    = path.join(__dirname, '..', 'api');

function loadContext(files) {
  const ctx = vm.createContext({ console, window: {}, global: {}, F: {}, R: {} });
  const loadErrors = [];
  for (const f of files) {
    const p = path.join(PUBLIC_DIR, f);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f }); }
    catch (e) { loadErrors.push(`${f}: ${e.message}`); }
  }
  ctx.__loadErrors = loadErrors;
  return ctx;
}

// مجموعة محركات المتصفح — مقروءة من public/index.html، نفس ترتيب الإنتاج.
// مسار المتصفح يحمّل محللات أكثر من مسار الـAPI، وبعض الأعطال لا تظهر إلا فيه.
function browserEngineList() {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const list = [...html.matchAll(/src="\/([A-Za-z0-9_.-]+\.js)"/g)].map(m => m[1]);
  assert.ok(list.length > 20, 'قائمة محركات المتصفح تبدو ناقصة: ' + list.length);
  return list.filter(f => !/\.min\.js$/.test(f));
}

function serverEngineList() {
  const src = fs.readFileSync(path.join(API_DIR, 'analyze.js'), 'utf8');
  const m = src.match(/const engines\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, 'تعذّر استخراج قائمة engines من api/analyze.js');
  return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

// ═══ 1. هوية اللغة من الامتداد، لا من تخمين المحتوى ═══
// ملفات Dart/Kotlin/Ruby تحتوي import/print/require فيصنّفها تخمين المحتوى
// Python، فيُحقن فيها مسار إصلاح Python بالكامل.
test('detectExt: امتداد غير مدعوم لا يُخمَّن Python', () => {
  const ctx = loadContext(['repair_engine.js']);
  const dart = "import 'dart:convert';\nvar x = 1;\n";
  const kt   = 'import java.security.MessageDigest\nval x = 1\n';
  const rb   = "require 'digest'\nx = 1\n";
  assert.strictEqual(ctx.detectExt(dart, 'a.dart'), 'dart');
  assert.strictEqual(ctx.detectExt(kt,   'a.kt'),   'kt');
  assert.strictEqual(ctx.detectExt(rb,   'a.rb'),   'rb');
  // اللغات المدعومة تبقى كما هي — بلا انحدار
  assert.strictEqual(ctx.detectExt('import os\nx = 1\n', 'a.py'), 'py');
  assert.strictEqual(ctx.detectExt('<?php $x = 1;',      'a.php'), 'php');
});

test('repairCode: لا يحقن كود Python في ملف Dart أو Kotlin أو Ruby', () => {
  const ctx = loadContext(serverEngineList());
  const FIXTURES = {
    'a.dart': "import 'dart:convert';\nString f(String u) {\n  var q = \"SELECT * FROM t WHERE id = \" + u;\n  return q;\n}\n",
    'a.kt'  : 'import java.security.MessageDigest\nfun f(u: String): String {\n    val q = "SELECT * FROM t WHERE id = " + u\n    return q\n}\n',
    'a.rb'  : "require 'digest'\ndef f(u)\n  q = \"SELECT * FROM t WHERE id = \" + u\n  eval(u)\n  q\nend\n",
  };
  const PYTHON_MARKERS = [/cursor\.execute/, /conn\.cursor/, /^\s*import ast\s*$/m, /os\.environ/, /^\s*#\s*Add to \.env/m];
  for (const [fn, code] of Object.entries(FIXTURES)) {
    const issues = ctx.analyzeCode(code, fn) || [];
    const out = ctx.repairCode(code, issues, fn).repaired;
    for (const re of PYTHON_MARKERS) {
      assert.ok(!re.test(out), `${fn}: تسرّب كود Python (${re}) إلى المخرجات:\n${out}`);
    }
  }
});

// ═══ 2. صلاحية أرقام الأسطر بعد الإدراج في رأس الملف ═══
test('repairCode: يتخطّى ثغرة لم يعد سطرها يطابق دليلها', () => {
  const ctx = loadContext(['repair_engine.js']);
  const code = 'const A = "secret_value_here";\nconst B = "another_secret_val";\n';
  const title = '🔴 كلمة مرور/مفتاح مُضمَّن في الكود';

  // ضابط: رقم سطر صحيح ⇒ يُصلَح
  const ok = ctx.repairCode(code, [{ line: 1, sev: 'c', title, ev: 'const A = "secret_value_here";' }], 'x.js');
  assert.notStrictEqual(ok.repaired, code, 'رقم سطر صحيح: توقعنا إصلاحاً');

  // قديم: الدليل يصف السطر 1 بينما رقم السطر يشير إلى 2 ⇒ يُتخطّى
  const stale = ctx.repairCode(code, [{ line: 2, sev: 'c', title, ev: 'const A = "secret_value_here";' }], 'x.js');
  assert.strictEqual(stale.repaired, code, 'رقم سطر قديم: أُصلح السطر الخطأ');
});

test('repairCode: إدراج import في الرأس لا يُفسد سطراً بريئاً', () => {
  // يلزم مسار المتصفح: مجموعة الـAPI لا تُنتج تركيبة الثغرات التي تكشف العطل
  const ctx = loadContext(browserEngineList());
  const fn = 'app.py';
  const code = [
    'import hashlib',
    'API_KEY = "sk_live_abcdef1234567890"',
    'url = "http://api.example.com/v1"',
    'def render(user):',
    '    query = "SELECT * FROM users WHERE id = " + user',
    '    h = hashlib.md5(query.encode()).hexdigest()',
    '    os.system("echo " + user)',
    '    eval(user)',
    '    return h',
    '',
  ].join('\n');
  const issues = ctx.analyzeCode(code, fn) || [];
  const out = ctx.repairCode(code, issues, fn).repaired;
  // fixEval يُدرج "import ast" في الرأس فيزيح كل الأسطر. بلا الحارس كان سطر
  // الـSQL يُستبدل بـ os.environ.get('QUERY', '') لأن ثغرة سطر آخر أصابته.
  assert.ok(!/query\s*=\s*os\.environ\.get/.test(out),
    'سطر الـSQL أُفسد بإصلاح موجَّه لسطر آخر:\n' + out);
});

// ═══ 3. حكم Ghost: ملاحظة إرشادية جديدة ليست انحداراً ═══
test('GhostMode: نوع جديد منخفض الشدة لا يُلغي إصلاحاً أزال ثغرات حرجة', () => {
  const ctx = loadContext(['ghost_mode.js']);
  const original = 'const q = "SELECT * FROM t WHERE id = " + id;\nconst k = "sk_live_abcdef1234567890";\nmodule.exports = { q, k };\n';
  const fixed    = 'const q = "SELECT * FROM t WHERE id = ?";\nconst k = process.env.K;\nmodule.exports = { q, k };\n';
  const analyze = (code) => code === original
    ? [{ sev:'c', type:'SQL_INJECTION', line:1 }, { sev:'h', type:'HARDCODED_SECRET', line:2 }]
    : [{ sev:'l', type:'ADVISORY_OPTIONAL_CHAINING', line:1 }];   // نوع جديد، شدة منخفضة

  const v = ctx.GhostMode.verdict(original, fixed, 'x.js', analyze, ['SQL_INJECTION','HARDCODED_SECRET']);
  assert.notStrictEqual(v.verdict, ctx.GhostMode.VERDICT.REGRESSION,
    'ملاحظة sev=l ألغت إصلاحاً أزال c+h: ' + JSON.stringify(v));
  assert.strictEqual(v.verdict, ctx.GhostMode.VERDICT.PASS, JSON.stringify(v));
});

test('GhostMode: نوع جديد حرج ما زال انحداراً (ضابط)', () => {
  const ctx = loadContext(['ghost_mode.js']);
  const original = 'const q = "SELECT * FROM t WHERE id = " + id;\nconst k = "sk_live_abcdef1234567890";\nmodule.exports = { q, k };\n';
  const fixed    = 'const q = "SELECT * FROM t WHERE id = ?";\nconst k = process.env.K;\nmodule.exports = { q, k };\n';
  const analyze = (code) => code === original
    ? [{ sev:'c', type:'SQL_INJECTION', line:1 }, { sev:'h', type:'HARDCODED_SECRET', line:2 }]
    : [{ sev:'c', type:'COMMAND_INJECTION', line:1 }];             // نوع جديد حرج

  const v = ctx.GhostMode.verdict(original, fixed, 'x.js', analyze, ['SQL_INJECTION','HARDCODED_SECRET']);
  assert.strictEqual(v.verdict, ctx.GhostMode.VERDICT.REGRESSION,
    'نوع حرج جديد لم يُرصد كانحدار: ' + JSON.stringify(v));
});

test('GhostMode: زيادة عدد الحرج/العالي ما زالت انحداراً (ضابط)', () => {
  const ctx = loadContext(['ghost_mode.js']);
  const original = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
  const fixed    = 'const a = 1;\nconst b = 9;\nconst c = 3;\n';
  const analyze = (code) => code === original
    ? [{ sev:'c', type:'X', line:1 }]
    : [{ sev:'c', type:'X', line:1 }, { sev:'c', type:'X', line:2 }];
  const v = ctx.GhostMode.verdict(original, fixed, 'x.js', analyze, ['X']);
  assert.strictEqual(v.verdict, ctx.GhostMode.VERDICT.REGRESSION, JSON.stringify(v));
});
