// ═══════════════════════════════════════════════════════
// اختبارات repair_engine.js — صحة الإصلاح حسب لغة الملف
// تشغيل:  node --test vercel-api/test/*.test.js
//         (من جذر المستودع — تمرير المجلد وحده لا يعمل في Node 22)
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

// ─── تحميل محركات داخل سياق معزول ────────────────────
// نفس شكل السياق الذي يستخدمه api/analyze.js في الإنتاج.
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

// قائمة المحركات مقروءة من api/analyze.js — مصدر واحد للحقيقة، بلا نسخ يدوي
function serverEngineList() {
  const src = fs.readFileSync(path.join(API_DIR, 'analyze.js'), 'utf8');
  const m = src.match(/const engines\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, 'تعذّر استخراج قائمة engines من api/analyze.js');
  return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

// استدعاء استراتيجية بنفس طريقة repairCode
function callStrategy(ctx, name, code, line, ext, fileName) {
  const issue = { line, sev: 'c', type: 'security', title: 'test', ev: '' };
  return ctx[name](code, issue, code.split('\n'), ext, fileName);
}

const SECRET_LINE = {
  js:   'const API_KEY = "sk_live_abcdef1234567890";',
  ts:   'const API_KEY: string = "sk_live_abcdef1234567890";',
  py:   'API_KEY = "sk_live_abcdef1234567890"',
  php:  '$API_KEY = "sk_live_abcdef1234567890";',
  java: 'private String API_KEY = "sk_live_abcdef1234567890";',
  cs:   'private string API_KEY = "sk_live_abcdef1234567890";',
  kt:   'val API_KEY = "sk_live_abcdef1234567890"',
  go:   'API_KEY := "sk_live_abcdef1234567890"',
  dart: 'final API_KEY = "sk_live_abcdef1234567890";',
};

// ═══ 1. fixHardcodedSecret — صياغة env لكل لغة ═══════
test('fixHardcodedSecret: يستخدم صياغة اللغة الصحيحة', () => {
  const ctx = loadContext(['repair_engine.js']);
  const expected = {
    js:   'process.env.',
    ts:   'process.env.',
    py:   'os.environ.get(',
    php:  "getenv('",
    java: 'System.getenv("',
    cs:   'Environment.GetEnvironmentVariable("',
  };
  for (const [ext, needle] of Object.entries(expected)) {
    const r = callStrategy(ctx, 'fixHardcodedSecret', SECRET_LINE[ext], 1, ext, 'x.' + ext);
    assert.ok(r, `${ext}: توقعنا إصلاحاً`);
    assert.ok(r.fixed.includes(needle), `${ext}: توقعنا "${needle}" في: ${r.fixed}`);
  }
});

test('fixHardcodedSecret: لا يحقن صياغة JS في لغة غير مدعومة', () => {
  const ctx = loadContext(['repair_engine.js']);
  for (const ext of ['kt', 'go', 'dart']) {
    const r = callStrategy(ctx, 'fixHardcodedSecret', SECRET_LINE[ext], 1, ext, 'x.' + ext);
    assert.strictEqual(r, null, `${ext}: توقعنا null بدل إصلاح بصياغة لغة أخرى`);
  }
});

test('fixHardcodedSecret: لا يحقن process.env في Java أو C#', () => {
  const ctx = loadContext(['repair_engine.js']);
  for (const ext of ['java', 'cs']) {
    const r = callStrategy(ctx, 'fixHardcodedSecret', SECRET_LINE[ext], 1, ext, 'x.' + ext);
    assert.ok(!r.fixed.includes('process.env'), `${ext}: تسرّبت صياغة JS: ${r.fixed}`);
  }
});

test('fixHardcodedSecret: idempotent — لا يعيد تغليف سطر مُصلَح', () => {
  const ctx = loadContext(['repair_engine.js']);
  const already = {
    js:   'const API_KEY = process.env.API_KEY;',
    py:   "API_KEY = os.environ.get('API_KEY', '')",
    php:  "$API_KEY = getenv('API_KEY');",
    java: 'private String API_KEY = System.getenv("API_KEY");',
    cs:   'private string API_KEY = Environment.GetEnvironmentVariable("API_KEY");',
  };
  for (const [ext, line] of Object.entries(already)) {
    assert.strictEqual(
      callStrategy(ctx, 'fixHardcodedSecret', line, 1, ext, 'x.' + ext), null,
      `${ext}: أعاد تغليف سطر مُصلَح سلفاً`);
  }
});

// ═══ 2. fixHardcodedPassword ═════════════════════════
test('fixHardcodedPassword: صياغة صحيحة ولا انهيار على php', () => {
  const ctx = loadContext(['repair_engine.js']);
  const expected = { php: "getenv('", java: 'System.getenv("', cs: 'Environment.GetEnvironmentVariable("' };
  for (const [ext, needle] of Object.entries(expected)) {
    const code = SECRET_LINE[ext];
    let r;
    assert.doesNotThrow(() => { r = callStrategy(ctx, 'fixHardcodedPassword', code, 1, ext, 'x.' + ext); },
      `${ext}: انهارت الاستراتيجية`);
    assert.ok(r && r.fixed.includes(needle), `${ext}: توقعنا "${needle}" في: ${r && r.fixed}`);
  }
});

test('fixHardcodedPassword: لا يلمس لغة بلا صياغة معروفة', () => {
  const ctx = loadContext(['repair_engine.js']);
  for (const ext of ['kt', 'go', 'dart']) {
    assert.strictEqual(
      callStrategy(ctx, 'fixHardcodedPassword', SECRET_LINE[ext], 1, ext, 'x.' + ext), null, ext);
  }
});

test('fixHardcodedPassword: idempotent', () => {
  const ctx = loadContext(['repair_engine.js']);
  assert.strictEqual(
    callStrategy(ctx, 'fixHardcodedPassword', "$API_KEY = getenv('API_KEY');", 1, 'php', 'x.php'),
    null, 'أعاد تغليف getenv');
});

// ═══ 3. fixApiKeyAdvanced ════════════════════════════
test('fixApiKeyAdvanced: لا يحقن صياغة JS في Kotlin/Go', () => {
  const ctx = loadContext(['repair_engine.js']);
  for (const ext of ['kt', 'go']) {
    assert.strictEqual(
      callStrategy(ctx, 'fixApiKeyAdvanced', SECRET_LINE[ext], 1, ext, 'x.' + ext), null, ext);
  }
});

// ═══ 4. fixEmptyCatch / fixEmptyFunction — بلا انهيار ═
test('fixEmptyCatch: لا ينهار على php ولا يحقن JS في لغة غير مدعومة', () => {
  const ctx = loadContext(['repair_engine.js']);
  const phpLine = 'try { g(); } catch (Exception $e) {}';
  let r;
  assert.doesNotThrow(() => { r = callStrategy(ctx, 'fixEmptyCatch', phpLine, 1, 'php', 'x.php'); },
    'php: انهارت (كان ReferenceError: varName is not defined)');
  assert.strictEqual(r, null, 'php: توقعنا null');
  assert.strictEqual(
    callStrategy(ctx, 'fixEmptyCatch', 'try { g(); } catch (e) {}', 1, 'dart', 'x.dart'), null, 'dart');
});

test('fixEmptyCatch: يعمل كما هو للغات المدعومة (بلا انحدار)', () => {
  const ctx = loadContext(['repair_engine.js']);
  const jsR = callStrategy(ctx, 'fixEmptyCatch', 'try { g(); } catch (e) {}', 1, 'js', 'x.js');
  assert.ok(jsR && jsR.fixed.includes('console.error'), 'js: توقعنا console.error');
  const javaR = callStrategy(ctx, 'fixEmptyCatch',
    'try { g(); } catch (Exception e) {}', 1, 'java', 'X.java');
  assert.ok(javaR && javaR.fixed.includes('Log.e'), 'java: توقعنا Log.e');
});

test('fixEmptyFunction: لا ينهار على php', () => {
  const ctx = loadContext(['repair_engine.js']);
  let r;
  assert.doesNotThrow(() => { r = callStrategy(ctx, 'fixEmptyFunction', 'function processPayment() {}', 1, 'php', 'x.php'); },
    'php: انهارت (كان ReferenceError)');
  assert.ok(r && r.fixed.includes('TODO'), 'php: توقعنا stub');
});

// ═══ 5. repairCode — عزل انهيار الاستراتيجية ═════════
test('repairCode: انهيار استراتيجية لا يُسقط باقي الإصلاحات', () => {
  const ctx = loadContext(['repair_engine.js']);
  const code = 'const API_KEY = "sk_live_abcdef1234567890";\nconst u = "http://example.com";\n';
  const issues = [
    { line: 1, sev: 'c', type: 'security', title: '🔴 كلمة مرور/مفتاح مُضمَّن في الكود', ev: '' },
    { line: 2, sev: 'm', type: 'net',      title: 'http غير آمن',                        ev: '' },
  ];
  // حقن خطأ حقيقي: detectExt دالة عامة تستدعيها الاستراتيجيات
  ctx.detectExt = () => { throw new ReferenceError('forced failure'); };
  let r;
  assert.doesNotThrow(() => { r = ctx.repairCode(code, issues, 'x.js'); },
    'repairCode سقط بدل عزل الاستراتيجية المنهارة');
  assert.ok(r.repaired.includes('https://'),
    'لم يُطبَّق إصلاح http بعد انهيار استراتيجية أخرى');
});

// ═══ 6. تكامل: المسار الكامل بلا حقن صياغة لغة ═══════
test('تكامل: analyzeCode + repairCode لا ينتجان صياغة لغة أجنبية', () => {
  const ctx = loadContext(serverEngineList());
  assert.deepStrictEqual(ctx.__loadErrors, [], 'أخطاء تحميل محركات');
  assert.strictEqual(typeof ctx.analyzeCode, 'function');
  assert.strictEqual(typeof ctx.repairCode, 'function');

  const FIXTURES = {
    'Svc.java': 'public class Svc {\n    private String apiKey = "sk_live_9f8a7b6c5d4e";\n}\n',
    'Svc.cs'  : 'using System;\npublic class Svc {\n  private string apiSecret = "secret_value_123456";\n}\n',
    'svc.py'  : 'import hashlib\nAPI_KEY = "sk_live_abcdef1234567890"\n',
    'svc.php' : '<?php\n$password = "hunter2secret";\n',
    'svc.kt'  : 'fun main() {\n  val apiKey = "sk_live_1234567890abc"\n}\n',
  };
  // لكل لغة: الصياغات التي لا يجوز أن تظهر في ملفها
  const FORBIDDEN = {
    java: ['process.env.', 'os.environ', "getenv('", 'console.error'],
    cs:   ['process.env.', 'os.environ', 'System.getenv'],
    py:   ['process.env.', 'System.getenv', 'Environment.GetEnvironmentVariable'],
    php:  ['process.env.', 'os.environ', 'System.getenv'],
    kt:   ['process.env.', 'os.environ', 'System.getenv', 'Environment.GetEnvironmentVariable'],
  };

  for (const [fn, code] of Object.entries(FIXTURES)) {
    const ext = fn.split('.').pop();
    let issues, out;
    assert.doesNotThrow(() => { issues = ctx.analyzeCode(code, fn) || []; }, `${fn}: analyzeCode انهار`);
    assert.doesNotThrow(() => { out = ctx.repairCode(code, issues, fn).repaired; }, `${fn}: repairCode انهار`);
    for (const bad of FORBIDDEN[ext]) {
      assert.ok(!out.includes(bad), `${fn}: تسرّبت صياغة "${bad}" إلى المخرجات:\n${out}`);
    }
  }
});

test('تكامل: Kotlin يبقى دون تعديل بدل إصلاح مكسور', () => {
  const ctx = loadContext(serverEngineList());
  const code = 'fun main() {\n  val apiKey = "sk_live_1234567890abc"\n  println(apiKey)\n}\n';
  const issues = ctx.analyzeCode(code, 'svc.kt') || [];
  assert.ok(issues.length > 0, 'توقعنا أن يكشف المحلل السر في Kotlin');
  assert.strictEqual(ctx.repairCode(code, issues, 'svc.kt').repaired, code,
    'Kotlin تغيّر رغم عدم وجود صياغة env صحيحة له');
});
