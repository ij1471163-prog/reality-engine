// ═══════════════════════════════════════════════════════
// مسارُ جافا في analyzeCode: لا يقتصر على محرّكِ اللغة
// تشغيل:  node --test vercel-api/test/analyzer_java_path.test.js
//
// كان الفرعُ يعود فورًا بما يُنتجه ‎engine_java‎ وحدَه (ثماني قواعد)، فلا
// يرى ملفُّ ‎.java‎ أيًّا من الفاحصاتِ غيرِ المرتبطةِ بلغة. والأثرُ مقيسٌ في
// مصفوفةِ القدرة: ‎LOG_SECRET‎ مُعلَنٌ لجافا في ‎STRATEGY_LANGS‎، و‎fixLogSecret‎
// يُنتج ‎Log.d("TAG", "[REDACTED]")‎ صحيحًا عند ندائه مباشرةً — ومع ذلك صفرُ
// بلاغ، لأن القاعدةَ التي تراه (رقم 9 في ‎security_scanner‎) خلفَ ذلك العود.
//
// و‎[JAVA-PATH]‎ يضمُّ ‎scanSecurity‎ و‎detectSecrets‎ وحدَهما. و‎detectPatterns‎
// خارجٌ عمدًا: قواعدُه محمولةٌ على JavaScript، والمقيسُ أنه يُنتج صفرًا على
// جافا معيبةً كانت أو سليمة — فضمُّه زيادةٌ بلا أثر. ‎[JP-4]‎ يحرس ذلك.
// ═══════════════════════════════════════════════════════
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadUiContext() {
  const store = new Map(), noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => null, addEventListener: noop, createElement: () => ({}),
                querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null),
                    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const p = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة */ }
  }
  return ctx;
}
const ctx = loadUiContext();
const titles = code => (ctx.analyzeCode(code, 'A.java') || []).map(i => String(i.title || ''));

const LOGGING = 'class A {\n  void f(String password) {\n    Log.d("TAG", password);\n  }\n}\n';

test('[JP-1] السجلُّ الحسّاسُ في جافا يُكتشَف', () => {
  const t = titles(LOGGING);
  assert.ok(t.some(x => /logs|Log|سجل/i.test(x) && /حساس|Sensitive/i.test(x)),
    'لا بلاغَ على Log.d بكلمةِ سرّ: ' + JSON.stringify(t));
});

test('[JP-2] ويُصلَح فعلًا من طرفٍ إلى طرف', () => {
  const issues = ctx.analyzeCode(LOGGING, 'A.java') || [];
  const r = ctx.repairCode(LOGGING, issues.map(x => Object.assign({}, x)), 'A.java');
  assert.match(r.repaired, /\[REDACTED\]/, 'لم يُنقَّح: ' + (((r.rejected || [])[0] || {}).reason || ''));
  assert.doesNotMatch(r.repaired, /Log\.d\("TAG", password\)/, 'السرُّ ما زال يُطبَع');
});

test('[JP-3] والأسرارُ المُضمَّنةُ في جافا يراها الفاحصُ العامّ', () => {
  const CASES = [
    ['class A {\n  static final String DB_PASSWORD = "ZZfakeSecretValue123";\n}\n', /secret|password|مفتاح|مُضمَّن/i],
    ['class A {\n  static final String API_KEY = "ZZfakeApiKeyValue456";\n}\n',     /api|key|مفتاح|مُضمَّن/i],
    ['class A {\n  String u = "http://api.example.com/v1";\n}\n',                   /http|https/i],
  ];
  for (const [code, want] of CASES) {
    assert.ok(titles(code).some(t => want.test(t)), 'فات: ' + code.split('\n')[1]);
  }
});

test('[JP-4] ولا إيجابَ كاذبًا على جافا سليمة', () => {
  const CLEAN = [
    'import java.util.*;\nclass A {\n  private final List<String> items = new ArrayList<>();\n  public int size() { return items.size(); }\n  public void add(String s) { if (s != null) items.add(s); }\n}\n',
    'class A {\n  int sum(int[] xs) {\n    int t = 0;\n    for (int x : xs) { t += x; }\n    return t;\n  }\n}\n',
    'class A {\n  static final String K = System.getenv("K");\n}\n',
    'class A {\n  String u = "https://api.example.com/v1";\n}\n',
    'class A {\n  // password handling is delegated\n  int x = 1;\n}\n',
  ];
  for (const code of CLEAN) {
    const t = titles(code).filter(x => /secret|password|key|token|logs|http|مُضمَّن|حساس/i.test(x));
    assert.deepStrictEqual(Array.from(t), [], 'بلاغٌ كاذبٌ على جافا سليمة: ' + code.split('\n')[1]);
  }
});

test('[JP-5] وقواعدُ engine_java نفسُها ما زالت تعمل', () => {
  // الضمُّ إضافةٌ لا إحلال: ما كان يراه محرّكُ اللغةِ ما زال يراه.
  const EMPTY_CATCH = 'class A {\n  void f() {\n    try {\n      g();\n    } catch (Exception e) {}\n  }\n}\n';
  assert.ok(titles(EMPTY_CATCH).some(t => /catch/i.test(t)), 'ضاع بلاغُ catch الفارغ');
  const MD5 = 'class A {\n  void f() throws Exception {\n    MessageDigest md = MessageDigest.getInstance("MD5");\n  }\n}\n';
  assert.ok(titles(MD5).some(t => /md5|تشفير|crypto|327/i.test(t)), 'ضاع بلاغُ MD5');
});

test('[JP-6] ولا بلاغَين متطابقَين بعد الضمّ', () => {
  for (const code of [LOGGING,
                      'class A {\n  static final String API_KEY = "ZZfakeApiKeyValue456";\n}\n',
                      'class A {\n  String u = "http://api.example.com/v1";\n}\n']) {
    const out = ctx.analyzeCode(code, 'A.java') || [];
    const seen = new Set();
    for (const i of out) {
      const key = (i.line || 0) + '\u0000' + String(i.title || '');
      assert.ok(!seen.has(key), 'تكرارٌ تامٌّ عند السطر ' + i.line + ': ' + i.title);
      seen.add(key);
    }
  }
});
