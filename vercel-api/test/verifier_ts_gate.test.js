// ═══════════════════════════════════════════════════════
// [TS-GATE] كلُّ إصلاحِ TypeScript كان يموت عند البوابة
// ═══════════════════════════════════════════════════════
//
// ‎syntaxCheck‎ كان يفحص TypeScript بمُترجمِها (‎ts.transpileModule‎) أو
// يُرجع ‎available:false‎. ولا مُترجمَ في المنظومة إطلاقًا: لا في
// ‎index.html‎ (ولا وسمَ نصٍّ واحدٍ لمُترجم؛ و‎typescript_analyzer.js‎ محلّلُ
// المشروع لا المُترجم)، ولا في ‎package.json‎ (‎adm-zip‎ و‎formidable‎ فقط).
// فالفرعُ ميّتٌ دائمًا، والحكمُ ‎REJECTED_NO_SYNTAX_CHECKER [typescript]‎
// لكلِّ مُرشَّح، ثم ‎GHOST_DISCARDED_BATCH — no_candidate_passed_gate‎.
//
// والمقيسُ قبل التعديل: نفسُ الشفرةِ في ‎.js‎ تُصلَح 4/4، وفي ‎.ts‎ صفرٌ
// من أربع — لا لعيبٍ في المُرشَّحات بل لغياب الفاحص. أي أن TypeScript
// كاشفةٌ فقط في المنظومة كلها، مع أن ‎STRATEGY_LANGS‎ تُدرجها في 13
// استراتيجية.
//
// والعلاجُ ليس سياسةً جديدة: مسارُ الخادم يفحص TypeScript بـ
// ‎structuralSyntax‎ نفسِها اليوم (‎server_engine_registration.js‎ في
// ‎check()‎). فنُقِل الفحصُ القائمُ إلى مسار المتصفح، كما فُعل بـ‎[PHP-GATE]‎.
//
// وهذا الملفُّ يُثبّت الحدَّين معًا: أن الإصلاحَ الصحيحَ يَعبُر، وأن
// المكسورَ **لا** يَعبُر — فلا يكون التعديلُ إضعافًا لـFail-Closed.
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const vm     = require('node:vm');
const { execFileSync } = require('node:child_process');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadCtx() {
  const noop = () => {};
  const store = new Map();
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    document: { getElementById: () => ({ style: {} }), addEventListener: noop,
                createElement: () => ({ style: {} }), querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null),
                    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, location: { search: '' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="\/([^"]+)"/g)) {
    const f = path.join(PUBLIC_DIR, m[1]);
    if (!fs.existsSync(f)) continue;
    try { vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: m[1] }); } catch (e) { /* ملف واجهة */ }
  }
  return ctx;
}
const sc = ctx => {
  const f = ctx.FixVerifier && ctx.FixVerifier.syntaxCheck;
  assert.strictEqual(typeof f, 'function', 'tripwire: syntaxCheck غيرُ منشور');
  return f;
};

test('[TSG-0] المُترجمُ غائبٌ فعلًا — فالفرعُ القديم كان ميّتًا لا احتياطيًّا', () => {
  // هذا هو أساسُ القرار: لو كان المُترجمُ موجودًا لَما لزم شيء.
  const ctx = loadCtx();
  assert.strictEqual(typeof ctx.ts, 'undefined',
    'مُترجمُ TypeScript صار متاحًا — فالفرعُ الأوّلُ في syntaxCheck يحكم، ' +
    'ويجب إعادةُ النظر في هذا الملفّ');
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="\/([^"]+)"/g)].map(m => m[1]);
  assert.ok(scripts.length > 50, 'tripwire: بيانُ النصوص لم يُقرأ');
  assert.ok(!scripts.some(f => /^typescript(\.min)?\.js$/.test(f)),
    'وسمُ مُترجمِ TypeScript ظهر في index.html');
});

test('[TSG-1] TypeScript سليمةٌ حقيقية ⇒ حكمٌ متاحٌ ومقبول', () => {
  const ctx = loadCtx(), check = sc(ctx);
  const VALID = [
    ['أنواعٌ ووسائط',    'function f(token: string, n: number): void {\n  console.log(token, n);\n}\n'],
    ['generics',         'function id<T>(x: T): T {\n  return x;\n}\nconst a = id<string>("x");\n'],
    ['interface',        'interface User {\n  name: string;\n  age?: number;\n}\nconst u: User = { name: "a" };\n'],
    ['enum + as',        'enum E { A = 1, B }\nconst v = E.A as number;\n'],
    ['صنفٌ بأعضاءٍ خاصة','class C {\n  private x: string = "a";\n  get y(): string { return this.x; }\n}\n'],
    ['نوعُ اتحاد',       'type R = { a: string } | { b: number };\nfunction g(r: R): string {\n  return JSON.stringify(r);\n}\n'],
    ['عامٌّ غيرُ متزامن','async function h<T>(p: Promise<T>): Promise<T | null> {\n  return await p;\n}\n'],
    ['قالبٌ نصّي',       'const name: string = "x";\nconst s = `hello ${name} ${1 + 2}`;\n'],
    ['regex وقسمة',      'const re = /ab[/]c/g;\nconst q: number = 10 / 2;\n'],
    ['سهمٌ بنوع',        'const f2: (a: number) => number = (a) => a * 2;\n'],
  ];
  for (const [label, code] of VALID) {
    const r = check(code, 'a.ts');
    assert.strictEqual(r.language, 'typescript', label);
    assert.strictEqual(r.available, true, 'لا حكمَ على TypeScript سليمة — ' + label);
    assert.strictEqual(r.ok, true, 'رُفضت TypeScript سليمة — ' + label + ': ' + r.reason);
  }
});

test('[TSG-2] ومُرشَّحٌ مكسورٌ يُرفض بدليلٍ — لا يَعبُر', () => {
  // هذا هو الحدُّ الذي يمنع التعديلَ من أن يكون إضعافًا: الفاحصُ يُدخل
  // تحقّقًا حيث لم يكن، فالمكسورُ مرفوضٌ بسببٍ مُسمَّى.
  const ctx = loadCtx(), check = sc(ctx);
  const BROKEN = [
    ['قوسٌ ناقص',         'function f(token: string) {\n  console.log("[REDACTED]";\n}\n'],
    ['معقوفٌ زائد',       'function f(): void {\n  return;\n}}\n'],
    ['نصٌّ غيرُ منتهٍ',   'function f(): void {\n  console.log("abc);\n}\n'],
    ['تعليقٌ غيرُ منتهٍ', 'function f(): void {\n  /* oops\n}\n'],
    ['قالبٌ غيرُ منتهٍ',  'const s = `abc ${x}\n'],
    ['مربّعٌ مغلوط',      'const a: number[] = [1, 2;\n'],
  ];
  for (const [label, code] of BROKEN) {
    const r = check(code, 'a.ts');
    assert.strictEqual(r.ok, false, 'مُرشَّحٌ مكسورٌ قُبل — ' + label);
    assert.ok(/^broken/.test(String(r.reason || '')),
      'الرفضُ بلا سببٍ بنيويٍّ مُسمَّى — ' + label + ': ' + r.reason);
  }
});

test('[TSG-3] وأحكامُ اللغاتِ الأخرى لم تتغيّر', () => {
  const ctx = loadCtx(), check = sc(ctx);
  // البصمةُ كما قيست على الشفرةِ قبل التعديل وبعده — متطابقة
  const EXPECT = [
    ['a.js',   'function f() { return 1; }\n',           'javascript', true,  true],
    ['a.js',   'function f() { return 1;\n',             'javascript', false, true],
    ['a.py',   'def f():\n    return 1\n',               'python',     true,  true],
    ['a.py',   'def f():\nreturn 1\n',                   'python',     false, true],
    ['a.php',  '<?php\nfunction f() { return 1; }\n',    'php',        true,  true],
    ['a.php',  '<?php\nfunction f() { return 1;\n',      'php',        false, true],
    ['b.php',  '<?php\nfunction f() { return 1; }\n?>\n','php',        false, false],
    ['a.go',   'package main\nfunc main() {}\n',         'go',         false, false],
    ['a.rb',   'def f\n  1\nend\n',                      'ruby',       false, false],
    ['a.java', 'class A { int f() { return 1; } }\n',     'java',       false, false],
  ];
  for (const [file, code, lang, ok, available] of EXPECT) {
    const r = check(code, file);
    assert.strictEqual(r.language, lang, file);
    assert.strictEqual(r.ok, ok, 'تغيّر حكمُ ' + file + ' (' + lang + '): ' + r.reason);
    assert.strictEqual(r.available, available, 'تغيّر توفّرُ الفاحصِ لـ' + file);
  }
});

test('[TSG-4] والمسارُ الكامل: ‎.ts‎ تُصلَح كما تُصلَح ‎.js‎', () => {
  // المقياسُ الذي كان صفرًا: أربعُ استراتيجياتٍ على نفسِ الشفرة.
  const ctx = loadCtx();
  const PAIRS = [
    ['LOG_SECRET',     'function f(token) {\n  console.log(token);\n}\n'],
    ['HTTP_USAGE',     'function g() {\n  return fetch("http://x.example.com/a");\n}\n'],
    ['VAR_USAGE',      'function h() {\n  var n = 1;\n  return n;\n}\n'],
    ['LOOSE_EQUALITY', 'function k(a, b) {\n  return a == b;\n}\n'],
  ];
  for (const [strat, code] of PAIRS) {
    for (const ext of ['js', 'ts']) {
      const file = 'a.' + ext;
      const iss = ctx.analyzeCode(code, file) || [];
      const out = ctx.repairCode(code, iss.map(x => Object.assign({}, x)), file);
      assert.ok((out.repairs || []).some(r => r.strategy === strat),
        strat + ' لم يُطبَّق في .' + ext + ' — رُفض: ' +
        (out.rejected || []).map(r => r.reason).join(' | ').slice(0, 160));
      assert.notStrictEqual(out.repaired, code, strat + ' لم يُغيّر شيئًا في .' + ext);
    }
  }
});

test('[TSG-5] ومُرشَّحٌ مكسورٌ في ‎.ts‎ لا يُطبَّق عبر المسارِ الكامل', () => {
  // ليس فحصَ وحدةٍ بل سلوكُ البوابةِ داخل المسار: نُجبر مُرشَّحًا مكسورًا
  // عبر ‎fullVerify‎ ونتأكّد أن الحكمَ رفضٌ لا قبول.
  const ctx = loadCtx();
  const before = 'function f(token: string): void {\n  console.log(token);\n}\n';
  const broken = 'function f(token: string): void {\n  console.log("[REDACTED]";\n}\n';
  const fv = ctx.FixVerifier;
  assert.strictEqual(typeof fv.fullVerify, 'function', 'tripwire: fullVerify غيرُ منشور');
  const v = fv.fullVerify(before, broken, 'a.ts', ctx.analyzeCode);
  const txt = JSON.stringify(v);
  // ‎valid‎ هو حكمُ البوابة. ولاحظ ‎improved:true‎ معه: عددُ البلاغات نقص
  // (6 ⇒ 2) لأن الشفرةَ صارت غيرَ قابلةٍ للتحليل — وهذا بعينه ما يجعل
  // «انخفاضَ عدد البلاغات» دليلًا باطلًا، والفاحصَ النحويَّ هو ما يحسم.
  assert.strictEqual(v && v.valid, false, 'البوابةُ قبلت مُرشَّحًا مكسورًا: ' + txt.slice(0, 200));
  assert.ok(/REJECTED_SYNTAX_BROKEN \[typescript\]/.test(String(v.reason || '')),
    'الرفضُ لم يُنسب إلى نحوِ TypeScript: ' + String(v.reason).slice(0, 160));
});

// مُترجمُ TypeScript الحقيقيُّ شاهدًا مستقلًّا حين يكون متاحًا في البيئة.
// ‎tsc‎ ليس من تَوابِع المشروع (‎package.json‎: ‎adm-zip‎ و‎formidable‎)، فهو
// شاهدٌ اختباريٌّ لا قدرةٌ وقتَ التشغيل — ولذلك يتجاوَز الاختبارُ نفسَه
// عند غيابه بدل أن يفشل.
const TSC = (() => {
  for (const p of ['/opt/node22/bin/tsc', 'tsc']) {
    try { execFileSync(p, ['--version'], { stdio: 'ignore' }); return p; } catch (e) { /* التالي */ }
  }
  return null;
})();
// أخطاءُ ‎TS1xxx‎ نحويةٌ و‎TS2xxx‎ دلالية — نقيس الاثنين قبل/بعد
function tscErrors(tsc, code, file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsg-'));
  const f = path.join(dir, file);
  fs.writeFileSync(f, code);
  let out = '';
  try { execFileSync(tsc, ['--noEmit', '--skipLibCheck', '--target', 'es2020', f],
        { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  fs.rmSync(dir, { recursive: true, force: true });
  const codes = [...out.matchAll(/error TS(\d{4}):/g)].map(m => Number(m[1]));
  return { syntax: codes.filter(c => c < 2000).length, types: codes.filter(c => c >= 2000).length };
}

test('[TSG-7] حالاتٌ واقعية: تُصلَح، ولا يُدخِل الإصلاحُ خطأً — شاهدُه ‎tsc‎',
  { skip: TSC ? false : 'مُترجمُ TypeScript غيرُ متاحٍ في هذه البيئة' }, () => {
  const ctx = loadCtx();
  const FILES = [
    ['auth.ts',
     'export function login(user: string, password: string): boolean {\n' +
     '  console.log("login attempt", password);\n' +
     '  if (user == "admin") {\n    return true;\n  }\n  return false;\n}\n',
     ['LOG_SECRET', 'LOOSE_EQUALITY']],
    ['api.ts',
     'export async function send(data: Record<string, string>): Promise<Response> {\n' +
     '  var url: string = "http://api.example.com/v1/items";\n' +
     '  return fetch(url, { method: "POST", body: JSON.stringify(data) });\n}\n',
     ['HTTP_USAGE', 'VAR_USAGE']],
    ['cache.ts',
     'export class Cache<T> {\n  private items: Map<string, T> = new Map();\n' +
     '  get(k: string): T | undefined {\n    return this.items.get(k);\n  }\n' +
     '  put(k: string, v: T, token: string): void {\n' +
     '    console.warn("cache put", token);\n    this.items.set(k, v);\n  }\n}\n',
     ['LOG_SECRET']],
  ];
  for (const [name, code, want] of FILES) {
    const iss = ctx.analyzeCode(code, name) || [];
    const out = ctx.repairCode(code, iss.map(x => Object.assign({}, x)), name);
    const got = new Set((out.repairs || []).map(r => r.strategy));
    for (const w of want)
      assert.ok(got.has(w), w + ' لم يُطبَّق على ' + name + ' — رُفض: ' +
        (out.rejected || []).map(r => r.reason).join(' | ').slice(0, 140));

    const b = tscErrors(TSC, code, name), a = tscErrors(TSC, out.repaired, name);
    assert.ok(a.syntax <= b.syntax, name + ': أخطاءُ نحوٍ جديدةٌ ' + b.syntax + ' ⇒ ' + a.syntax);
    assert.ok(a.types <= b.types, name + ': أخطاءُ أنواعٍ جديدةٌ ' + b.types + ' ⇒ ' + a.types);

    // والقيمةُ لا العدد: السرُّ غاب، والبروتوكولُ صار https
    if (want.includes('LOG_SECRET')) {
      assert.ok(/\[REDACTED\]/.test(out.repaired), name + ': لا عَلَمَ تنقيح');
      assert.ok(!/console\.(log|warn)\("[^"]*",\s*(password|token)\)/.test(out.repaired),
        name + ': المُعرِّفُ الحسّاس ما زال يُسجَّل');
    }
    if (want.includes('HTTP_USAGE')) assert.ok(/https:\/\//.test(out.repaired), name + ': ما زال http');
  }
});

test('[TSG-8] وإصلاحٌ غيرُ صالحٍ لا يُمرَّر — حتى لو أنقص البلاغات',
  { skip: TSC ? false : 'مُترجمُ TypeScript غيرُ متاحٍ في هذه البيئة' }, () => {
  // ثلاثةُ مُرشَّحاتٍ تكسر الملفَّ وتُنقص عددَ البلاغاتِ في الوقتِ نفسِه
  // (لأن الشفرةَ المكسورةَ تُحلَّل أقلّ). ‎tsc‎ يُثبت أنها مكسورةٌ فعلًا،
  // والبوابةُ ترفضها — فانخفاضُ العدَّ لا يُمرِّر شيئًا.
  const ctx = loadCtx();
  const before = 'export function login(user: string, password: string): boolean {\n' +
                 '  console.log("attempt", password);\n  return user === "a";\n}\n';
  const BROKEN = [
    ['قوسٌ ناقص',      'export function login(user: string, password: string): boolean {\n  console.log("attempt", "[REDACTED]";\n  return user === "a";\n}\n'],
    ['معقوفٌ زائد',    'export function login(user: string, password: string): boolean {\n  console.log("attempt", "[REDACTED]");\n  return user === "a";\n}}\n'],
    ['نصٌّ غيرُ منتهٍ', 'export function login(user: string, password: string): boolean {\n  console.log("attempt", "[REDACTED);\n  return user === "a";\n}\n'],
  ];
  const base = tscErrors(TSC, before, 'login.ts');
  assert.strictEqual(base.syntax, 0, 'tripwire: الأصلُ مكسورٌ نحويًّا');
  for (const [label, broken] of BROKEN) {
    const t = tscErrors(TSC, broken, 'login.ts');
    assert.ok(t.syntax > 0, 'tripwire: ‎tsc‎ لا يرى الكسرَ في ' + label);
    const v = ctx.FixVerifier.fullVerify(before, broken, 'login.ts', ctx.analyzeCode);
    assert.strictEqual(v.valid, false, 'البوابةُ قبلت مكسورًا (' + label + '): ' + JSON.stringify(v).slice(0, 160));
    assert.ok(/REJECTED_SYNTAX_BROKEN \[typescript\]/.test(String(v.reason || '')),
      label + ': الرفضُ لم يُنسب إلى نحوِ TypeScript: ' + String(v.reason).slice(0, 120));
  }
});

test('[TSG-6] الحدُّ المعلَن: فاحصٌ بنيويٌّ لا مُحلِّلُ أنواع', () => {
  // أمانةُ التسجيل: ما يمرّ من الفاحصِ ويرفضه مُترجمُ TypeScript نحويًّا.
  // سبعةٌ من سبعةٍ تمرّ — وهو حدُّ الفاحصِ الذي يثق به الخادمُ أصلًا.
  // وهذه الأشكالُ ليست ممّا يُنتجه المُصلِحون: تعديلاتُهم على مستوى
  // التعبيرِ (مُعامل، كلمةُ تعريف، نصٌّ حرفيّ) لا على مستوى الأنواع —
  // وقد تحقّق ذلك بمُترجمِ TypeScript الحقيقيِّ على ثلاثةِ ملفاتٍ واقعية:
  // خمسةُ إصلاحاتٍ، وصفرُ أخطاءِ نحوٍ أو أنواعٍ جديدةٍ بعدها.
  const ctx = loadCtx(), check = sc(ctx);
  const TYPE_LEVEL = [
    'const x: = 1;\n',
    'function f(a: ) { return a; }\n',
    'interface A\n',
    'let a: number = ;\n',
  ];
  let passes = 0;
  for (const code of TYPE_LEVEL) if (check(code, 'a.ts').ok === true) passes++;
  assert.strictEqual(passes, TYPE_LEVEL.length,
    'تغيّر حدُّ الفاحصِ المعلَن — إن صار يرفض خطأَ الأنواع فذلك تحسينٌ ' +
    'يجب توثيقُه هنا، وإن صار يرفض بعضَها فقط فالسلوكُ غيرُ متسق');
});
