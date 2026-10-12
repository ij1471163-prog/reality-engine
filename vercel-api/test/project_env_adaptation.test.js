// ═══════════════════════════════════════════════════════════════════════
// تكيّف Reality Engine مع المشروع وبيئة تشغيله
// تشغيل:  node --test vercel-api/test/project_env_adaptation.test.js
//
// يغطّي تغييرين في public/project_intelligence.js:
//
//   [FW-EVIDENCE] detectFramework كان يُصدر حكمًا على مطابقة واحدة من قائمة
//     patterns، وفيها ‎/jsx/i‎ — نصٌّ حرفي بلا حدّ كلمة ولا سياق. والمقيس على
//     هذا المستودع قبل الإصلاح: vercel-api ⇒ «React» (6 ملفات)، android ⇒
//     «React» (3 ملفات **جافا**)، عيّنة بايثون ⇒ «Flask». أي أن أول حكم
//     يُصدره المحرك عن أي مشروع حقيقي كان خاطئًا.
//     الإصلاح: مراسٍ (anchors) وإشارات (signals)، وحاجز لغة من اسم الملف
//     (كان يُمرَّر ويُهمَل)، وحذف التعليقات مع إبقاء النصوص.
//
//   [ENV-LINK] ‎analyzeDependencies(code, fileName, packageJson)‎ يقبل وسيطًا
//     ثالثًا لا مورِّد له في المستودع كلّه. فأُضيف قارئ بيانات البناء الموجودة
//     فعلًا، ورُبط بالمحلل القائم عبر analyzeMultipleFiles(files, env).
//
// والمشاريع هنا حقيقية من المستودع: vercel-api، وandroid (قراءة فقط)، و
// tools/project-repair (بلا بيان بناء — حالة «بيئة بلا دليل»).
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const REPO_ROOT  = path.join(__dirname, '..', '..');
const PI = require(path.join(PUBLIC_DIR, 'project_intelligence.js'));

const detect = PI.detectFramework;

// ═══════════════════════════════════════════════════════════════════════
// 1. موجَب صحيح — أطر حقيقية ما زالت تُكتشف بعد تشديد الأدلة
// ═══════════════════════════════════════════════════════════════════════

const TRUE_POSITIVES = [
  ['express/require', 'a.js',
    'const express = require("express");\nconst app = express();\napp.get("/u",(q,s)=>s.json({}));', 'Express.js'],
  ['express/import', 'a.js',
    'import express from "express";\nconst app = express();\napp.post("/x", h);', 'Express.js'],
  ['react/hooks+jsx', 'App.jsx',
    'import React, { useState } from "react";\nexport default function App(){ const [v,setV]=useState(0); return <div/>; }', 'React'],
  ['vue', 'a.js', 'import { createApp } from "vue";\ncreateApp({}).mount("#a");', 'Vue.js'],
  ['nextjs', 'p.js', 'import Head from "next/head";\nexport default function HomePage(){ return null; }', 'Next.js'],
  ['flask', 'm.py', 'from flask import Flask\napp = Flask(__name__)\n@app.route("/")\ndef i(): return "x"', 'Flask'],
  ['fastapi', 'm.py', 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/")\ndef r(): return {}', 'FastAPI'],
  ['django', 'u.py', 'from django.urls import path\nurlpatterns = [path("", v)]', 'Django'],
  ['spring', 'A.java',
    'import org.springframework.boot.SpringApplication;\n@SpringBootApplication\npublic class A {}', 'Spring Boot'],
  ['laravel', 'r.php',
    '<?php\nuse Illuminate\\Support\\Facades\\Route;\nRoute::get("/u", fn() => 1);', 'Laravel'],
  // مسار الإشارتين: بلا مرساة، لكن دليلان ثانويان ⇒ حكم مسموح
  ['express/إشارتان بلا مرساة', 'a.js', 'const app = express();\napp.get("/u", h);', 'Express.js'],
  ['flask/إشارتان بلا مرساة', 'm.py', '@app.route("/")\ndef i(): return Flask(__name__)', 'Flask'],
  ['serverless/module.exports', 'api/x.js',
    'module.exports = async (req, res) => {\n  if (req.method !== "POST") return res.status(405).end();\n  res.json({});\n};',
    'Vercel/Serverless Function'],
  ['serverless/export default handler', 'api/y.js',
    'export default async function handler(req, res) {\n  if (req.method !== "POST") return res.status(405).end();\n}',
    'Vercel/Serverless Function'],
];

for (const [label, fileName, code, want] of TRUE_POSITIVES) {
  test(`[FW-POS] ${label} ⇒ ${want}`, () => {
    const d = detect(code, fileName);
    assert.ok(d, 'لا حكم — تراجعت التغطية على إطار حقيقي');
    assert.strictEqual(d.name, want);
    assert.ok(d.anchors + d.signals >= 1);
    assert.ok(d.confidence > 0 && d.confidence <= 1);
  });
}

test('[FW-POS] كل إطار معروف له مرساة واحدة على الأقل', () => {
  for (const [key, fw] of Object.entries(PI.FRAMEWORK_SIGNATURES)) {
    assert.ok(Array.isArray(fw.anchors) && fw.anchors.length >= 1, key + ' بلا مرساة');
    assert.ok(Array.isArray(fw.signals), key + ' بلا signals');
    assert.ok(fw.lang && fw.name, key + ' ناقص lang/name');
  }
});

test('[FW-POS] كل إطار معروف له عيّنة موجَب صحيح تُكتشف', () => {
  // تَحرُّزٌ ضد إضافة بصمة بلا اختبار: كل مفتاح في FRAMEWORK_SIGNATURES يجب أن
  // تكون له عيّنة في TRUE_POSITIVES، وأن تُكتشف على امتداد لغته.
  const EXT = { js: 'api/x.js', py: 'a.py', java: 'A.java', php: 'a.php' };
  for (const [key, fw] of Object.entries(PI.FRAMEWORK_SIGNATURES)) {
    const sample = TRUE_POSITIVES.find(t => t[3] === fw.name);
    assert.ok(sample, 'لا عيّنة موجَب صحيح لـ' + key + ' — بصمة بلا اختبار');
    const d = detect(sample[2], sample[1] || EXT[fw.lang]);
    assert.ok(d, key + ': لم يُكتشف على عيّنته');
    assert.strictEqual(d.name, fw.name, key + ': كُشف ' + d.name);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 2. سالب صحيح — الحالات التي كانت تُنتج تصنيفًا خاطئًا
// ═══════════════════════════════════════════════════════════════════════

const TRUE_NEGATIVES = [
  ['امتداد .jsx في مصفوفة نصّية', 'unzip.js', 'const EXT = [".js", ".jsx", ".tsx"];'],
  ['الكلمة jsx في تعليق', 'a.js', '// سنتعامل مع jsx لاحقًا'],
  ['الكلمة JSX داخل نصّ', 'a.js', 'const s = "هذا نص فيه JSX فقط";'],
  ['ext في فحص امتداد حقيقي', 'repair_sql.js', "if (['js','mjs','cjs','jsx'].includes(ext)) return 1;"],
  ['نصّ React داخل جافا', 'A.java', 'class A { String s = "import React from react"; }'],
  ['إشارة Express واحدة', 'a.js', 'app.get("/x", h);'],
  ['إشارة Vue واحدة', 'a.js', 'createApp({});'],
  ['flask في تعليق بايثون', 'a.py', '# from flask import Flask (مثال)'],
  ['django في تعليق بايثون', 'a.py', '#from django.urls import path'],
  ['react في تعليق كتلة', 'a.js', '/*\n import React from "react";\n*/\nconst x = 1;'],
  // ملاحظة: ‎module.exports = async (req,res) =>‎ كان في هذه القائمة بوصفه
  // «لا حكم» — وكان ذلك صحيحًا حين لم تكن هناك بصمة serverless. وقد صارت له
  // بصمة الآن ويُكتشف قصدًا، فنُقل إلى [VERCEL] أدناه. تغيّرُ توقّعٍ بسبب قدرة
  // مُضافة، لا إضعافُ اختبار.
  ['Kotlin عادي', 'a.kt', 'val r = db.rawQuery("select 1", null)'],
  ['كود فارغ', 'a.js', ''],
  ['بلا كود', 'a.js', null],
];

for (const [label, fileName, code] of TRUE_NEGATIVES) {
  test(`[FW-NEG] ${label} ⇒ لا حكم`, () => {
    const d = detect(code, fileName);
    assert.strictEqual(d, null,
      'تصنيف خاطئ: ' + (d ? d.name + ' بثقة ' + d.confidence : ''));
  });
}

test('[FW-NEG] حاجز اللغة: إطار JS لا يُعلن عن ملف جافا أو بايثون', () => {
  const reactCode = 'import React, { useState } from "react";\nconst x = useState(0);';
  assert.ok(detect(reactCode, 'a.jsx'), 'يجب أن يُكتشف في ملف js');
  for (const fn of ['A.java', 'a.py', 'a.php', 'a.kt']) {
    assert.strictEqual(detect(reactCode, fn), null, 'كُشف React في ' + fn);
  }
});

test('[FW-NEG] بلا اسم ملف لا دليل على اللغة ⇒ لا حجب، وشرط الأدلة قائم', () => {
  const flask = 'from flask import Flask\napp = Flask(__name__)';
  assert.ok(detect(flask, ''), 'المرساة يجب أن تكفي بلا اسم ملف');
  assert.strictEqual(detect('app.get("/x", h);', ''), null, 'إشارة واحدة لا تكفي ولو بلا اسم ملف');
});

test('[FW-NEG] ‎/jsx/i‎ أُزيلت من بصمات react نهائيًا', () => {
  const srcs = PI.FRAMEWORK_SIGNATURES.react.anchors
    .concat(PI.FRAMEWORK_SIGNATURES.react.signals)
    .map(r => r.source);
  assert.ok(!srcs.includes('jsx'),
    'نمط jsx العاري ما زال موجودًا: ' + JSON.stringify(srcs));
  // الوسم الحقيقي الوحيد المسموح هو react/jsx-runtime
  assert.ok(srcs.some(s => s.indexOf('jsx-runtime') >= 0), 'فقدنا دليل jsx-runtime');
});

// ═══════════════════════════════════════════════════════════════════════
// 3. حاذف التعليقات — يُبقي النصوص بقرار
// ═══════════════════════════════════════════════════════════════════════

test('[FW-STRIP] النصوص تبقى: أسماء المكتبات في المراسي نصوصٌ حرفية', () => {
  const s = PI.fwStripComments('const e = require("express"); // تعليق', 'js');
  assert.ok(s.includes('require("express")'), 'النصّ حُذف فانهار الاكتشاف: ' + s);
  assert.ok(!s.includes('تعليق'), 'التعليق لم يُحذف');
});

test('[FW-STRIP] ‎//‎ داخل نصّ ليست تعليقًا', () => {
  const s = PI.fwStripComments('const u = "http://example.com/x"; const y = 1;', 'js');
  assert.ok(s.includes('http://example.com/x'), 'النصّ قُطع: ' + s);
  assert.ok(s.includes('const y = 1'), 'ما بعد النصّ حُذف: ' + s);
});

test('[FW-STRIP] ‎#‎ تعليقٌ في بايثون وPHP، وحقلٌ خاص في JS', () => {
  assert.ok(!PI.fwStripComments('# import flask\nx = 1', 'py').includes('flask'));
  assert.ok(!PI.fwStripComments('# use Illuminate\\X\n$a=1;', 'php').includes('Illuminate'));
  // في JS لا تُعامل ‎#‎ كتعليق — وإلا أُكل حقلٌ خاص
  const js = PI.fwStripComments('class A { #secret = 1; get(){ return this.#secret; } }', 'js');
  assert.ok(js.includes('#secret = 1'), 'حقل خاص حُذف: ' + js);
  assert.ok(js.includes('this.#secret'), 'استعمال الحقل حُذف: ' + js);
});

test('[FW-STRIP] ‎#[‎ في PHP سمةٌ لا تعليق', () => {
  const s = PI.fwStripComments('#[Attribute]\nuse Illuminate\\Y;', 'php');
  assert.ok(s.includes('#[Attribute]'), 'السمة حُذفت: ' + s);
  assert.ok(s.includes('Illuminate'), 'ما بعد السمة حُذف: ' + s);
});

test('[FW-STRIP] تعليق كتلة غير مُغلق لا يُسقط الماسح', () => {
  const s = PI.fwStripComments('const a = 1;\n/* لم يُغلق\nconst b = 2;', 'js');
  assert.ok(s.includes('const a = 1'), 'ما قبل التعليق حُذف');
  assert.ok(!s.includes('const b'), 'ما بعد تعليق غير مُغلق يُعَدّ تعليقًا');
});

// ═══════════════════════════════════════════════════════════════════════
// 4. بيئة التشغيل — بيانات حقيقية في هذا المستودع
// ═══════════════════════════════════════════════════════════════════════

test('[ENV] vercel-api: package.json الحقيقي يُقرأ وتُستخرج اعتمادياته', () => {
  const e = PI.readEnvironment(path.join(REPO_ROOT, 'vercel-api'));
  assert.ok(e, 'readEnvironment أعاد null في Node');
  assert.strictEqual(e.verdict, 'npm');
  assert.deepStrictEqual(e.ecosystems, ['npm']);
  assert.strictEqual(e.manifests.length, 1);
  assert.strictEqual(e.manifests[0].ecosystem, 'npm');

  // نحسب الحقيقة من الملف مباشرة، فلا يصير الاختبار مرآةً للقارئ
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'vercel-api', 'package.json'), 'utf8'));
  const want = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).sort();
  assert.deepStrictEqual(Object.keys(e.packageJson.dependencies || {}).sort(),
    Object.keys(pkg.dependencies || {}).sort(), 'packageJson المُمرَّر ليس الملف نفسه');
  assert.deepStrictEqual(Object.keys(e.manifests[0].dependencies).sort(), want);
  assert.strictEqual(e.totalDependencies, want.length);
  assert.strictEqual(e.note, null, 'لا ملاحظة عند بيئة معروفة');
});

test('[ENV] android: build.gradle الحقيقي — اعتماديات وبيئة تشغيل (قراءة فقط)', () => {
  const dir = path.join(REPO_ROOT, 'android');
  const before = fs.readFileSync(path.join(dir, 'app', 'build.gradle'), 'utf8');

  const e = PI.readEnvironment(dir);
  assert.strictEqual(e.verdict, 'gradle');
  assert.deepStrictEqual(e.ecosystems, ['gradle']);
  assert.ok(e.manifests.length >= 1);

  const app = e.manifests.find(m => /app[\\/]build\.gradle$/.test(m.manifest));
  assert.ok(app, 'لم يُقرأ app/build.gradle: ' + JSON.stringify(e.manifests.map(m => m.manifest)));

  // الحقيقة من الملف مباشرة
  const coords = [...before.matchAll(/^\s*implementation\s*[\s(]\s*(['"])([^'"]+)\1/gm)].map(m => m[2]);
  assert.ok(coords.length >= 5, 'عدد الاعتماديات في الملف: ' + coords.length);
  for (const c of coords) {
    const ga = c.split(':').slice(0, 2).join(':');
    assert.ok(Object.prototype.hasOwnProperty.call(app.dependencies, ga),
      'اعتمادية مفقودة من القراءة: ' + ga);
  }
  assert.ok(app.runtime && app.runtime.compileSdk && app.runtime.minSdk,
    'بيئة التشغيل غير مُستخرَجة: ' + JSON.stringify(app.runtime));
  assert.strictEqual(app.name, 'com.naif.realityengine');
  assert.strictEqual(e.packageJson, null, 'لا بيان npm في android');

  // قراءة فقط: الملف لم يُلمس
  assert.strictEqual(fs.readFileSync(path.join(dir, 'app', 'build.gradle'), 'utf8'), before);
});

test('[ENV] tools/project-repair: بلا بيان بناء ⇒ unknown بلا أي ادّعاء', () => {
  const dir = path.join(REPO_ROOT, 'tools', 'project-repair');
  assert.ok(fs.existsSync(dir), 'المشروع غير موجود');
  const e = PI.readEnvironment(dir);
  assert.strictEqual(e.verdict, 'unknown');
  assert.deepStrictEqual(e.ecosystems, []);
  assert.strictEqual(e.manifests.length, 0);
  assert.strictEqual(e.totalDependencies, 0);
  assert.strictEqual(e.packageJson, null);
  assert.match(e.note, /البيئة غير معروفة/, 'لا بد من تصريح بعدم المعرفة');
  assert.match(e.note, /لا بيان بناء/);
});

test('[ENV] المستودع كله: بيئتان ⇒ mixed، وكلتاهما مُعلَنتان', () => {
  const e = PI.readEnvironment(REPO_ROOT);
  assert.strictEqual(e.verdict, 'mixed');
  assert.deepStrictEqual(e.ecosystems.slice().sort(), ['gradle', 'npm']);
  assert.ok(e.manifests.length >= 3);
  assert.ok(e.packageJson, 'بيان npm يجب أن يُمرَّر حتى في بيئة مختلطة');
});

test('[ENV] لا يُدَّعى اكتشاف بيان غير مدعوم — يُرصَد ولا يُحسَب بيئةً', () => {
  const e = PI.detectEnvironment({
    'pom.xml': '<project/>',
    'requirements.txt': 'flask==2.0\n',
    'composer.json': '{}',
  });
  assert.strictEqual(e.verdict, 'unknown', 'بيان غير مدعوم لا يُنتج بيئة');
  assert.strictEqual(e.manifests.length, 0);
  assert.strictEqual(e.unsupported.length, 3);
  assert.match(e.note, /غير مدعومة/);
  for (const u of e.unsupported) assert.match(u.reason, /غير محلَّل/);
});

test('[ENV] package.json تالف ⇒ خطأ مُعلَن لا بيئة مُخترَعة', () => {
  const e = PI.detectEnvironment({ 'package.json': '{ هذا ليس JSON' });
  assert.strictEqual(e.verdict, 'unknown');
  assert.strictEqual(e.errors.length, 1);
  assert.match(e.errors[0].error, /JSON غير صالح/);
  assert.strictEqual(e.packageJson, null);
});

test('[ENV] gradle: نسخة من متغيّر تُرصَد بلا نسخة، لا بنسخة مخترعة', () => {
  const g = PI.parseGradle(
    "dependencies {\n" +
    "    implementation 'androidx.core:core:1.2.3'\n" +
    "    implementation \"com.x:y:$ver\"\n" +
    "    // implementation 'should:not:count'\n" +
    "}\n");
  assert.strictEqual(g.dependencies['androidx.core:core'], '1.2.3');
  assert.ok(Object.prototype.hasOwnProperty.call(g.dependencies, 'com.x:y:$ver'));
  assert.strictEqual(g.dependencies['com.x:y:$ver'], null, 'نسخة مُخترَعة لمتغيّر');
  assert.ok(!Object.prototype.hasOwnProperty.call(g.dependencies, 'should:not'),
    'سطر تعليق حُسب اعتمادية');
});

// ═══════════════════════════════════════════════════════════════════════
// 5. الربط — المورِّد يصل إلى المستهلك
// ═══════════════════════════════════════════════════════════════════════

function buildContext() {
  const LIST = ['acorn.min.js', 'engine_java.js', 'c_cpp_analyzer.js', 'analyzer.js',
    'security_scanner.js', 'secret_detector.js', 'taint_core.js', 'taint_js.js', 'taint_py.js',
    'taint_php.js', 'context_analyzer.js', 'code_intelligence.js', 'repair_engine.js',
    'fix_verifier.js', 'project_intelligence.js', 'dependency_analyzer.js'];
  const store = new Map();
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {}, info() {} },
    window: {}, global: {}, F: {}, R: {},
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k), clear: () => store.clear(),
    },
  });
  for (const f of LIST) {
    const p = path.join(PUBLIC_DIR, f);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f }); } catch (_) {}
  }
  return ctx;
}

test('[ENV-LINK] analyzeMultipleFiles يمرّر packageJson إلى analyzeDependencies', () => {
  const ctx = buildContext();
  assert.strictEqual(vm.runInContext('typeof analyzeDependencies', ctx), 'function');

  // نسخة ذات اعتمادية معروفة الخطورة، كي يثبت أن الوسيط وصل وأُستُعمل
  const env = PI.detectEnvironment({
    'package.json': JSON.stringify({ name: 'x', dependencies: { lodash: '4.17.11' } }),
  });
  assert.strictEqual(env.verdict, 'npm');

  const files = [{ name: 'a.js', code: 'const _ = require("lodash");\nmodule.exports = _;\n' }];
  vm.runInContext('__F = ' + JSON.stringify(files) + '; __E = ' + JSON.stringify(env) + ';', ctx);

  const withEnv = JSON.parse(vm.runInContext(
    'JSON.stringify((()=>{const r=analyzeMultipleFiles(__F,__E);return r.environment;})())', ctx));
  assert.ok(withEnv, 'environment غائب من الناتج');
  assert.strictEqual(withEnv.verdict, 'npm');
  assert.strictEqual(withEnv.dependenciesAnalyzed, true, 'المحلل لم يُنادَ');
  assert.strictEqual(withEnv.totalDependencies, 1);

  // وبلا env يبقى السلوك القديم بالحرف
  const noEnv = JSON.parse(vm.runInContext(
    'JSON.stringify((()=>{const r=analyzeMultipleFiles(__F);return {env:r.environment,files:r.files};})())', ctx));
  assert.strictEqual(noEnv.env, null, 'env غير مُمرَّر يجب أن يُنتج null لا تخمينًا');
  assert.strictEqual(noEnv.files, 1, 'بقية الناتج لم تتغيّر');
});

test('[ENV-LINK] بيئة gradle: لا فحص اعتماديات، ويُعلَن السبب', () => {
  const ctx = buildContext();
  const env = PI.readEnvironment(path.join(REPO_ROOT, 'android'));
  assert.strictEqual(env.verdict, 'gradle');

  const files = [{ name: 'A.java', code: 'class A { void f(){} }\n' }];
  vm.runInContext('__F = ' + JSON.stringify(files) + '; __E = ' + JSON.stringify(env) + ';', ctx);
  const r = JSON.parse(vm.runInContext(
    'JSON.stringify(analyzeMultipleFiles(__F,__E).environment)', ctx));

  assert.strictEqual(r.verdict, 'gradle');
  assert.strictEqual(r.dependenciesAnalyzed, false, 'لا يجوز فحص gradle بقائمة ثغرات npm');
  assert.deepStrictEqual(r.dependencyIssues, []);
  assert.match(r.note, /npm/, 'السبب غير مُعلَن: ' + r.note);
  assert.ok(r.totalDependencies >= 5, 'الاعتماديات مقروءة ومعروضة ولو لم تُفحَص');
});

test('[ENV-LINK] بيئة unknown: لا فحص ولا ادّعاء', () => {
  const ctx = buildContext();
  const env = PI.readEnvironment(path.join(REPO_ROOT, 'tools', 'project-repair'));
  const files = [{ name: 'A.java', code: 'class A {}\n' }];
  vm.runInContext('__F = ' + JSON.stringify(files) + '; __E = ' + JSON.stringify(env) + ';', ctx);
  const r = JSON.parse(vm.runInContext(
    'JSON.stringify(analyzeMultipleFiles(__F,__E).environment)', ctx));
  assert.strictEqual(r.verdict, 'unknown');
  assert.strictEqual(r.dependenciesAnalyzed, false);
  assert.strictEqual(r.totalDependencies, 0);
  assert.match(r.note, /غير معروفة/);
});

// ═══════════════════════════════════════════════════════════════════════
// 6. لا تراجع — على المشاريع الحقيقية الثلاثة
// ═══════════════════════════════════════════════════════════════════════

function collect(dir, exts, cap) {
  const out = [];
  (function rec(d) {
    if (out.length >= cap) return;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (out.length >= cap) return;
      if (['node_modules', '.git', 'build', '.gradle'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p);
      else if (exts.includes(path.extname(e.name).toLowerCase())) out.push(p);
    }
  })(dir);
  return out.sort();
}

const REAL_PROJECTS = [
  ['vercel-api', path.join(REPO_ROOT, 'vercel-api'), ['.js'], 25],
  ['android', path.join(REPO_ROOT, 'android'), ['.java', '.kt'], 25],
  ['tools-java', path.join(REPO_ROOT, 'tools'), ['.java'], 25],
];

for (const [id, dir, exts, cap] of REAL_PROJECTS) {
  test(`[REAL] ${id}: صفر تصنيف خاطئ على ملفات المستودع الحقيقية`, () => {
    const paths = collect(dir, exts, cap);
    assert.ok(paths.length >= 10, id + ': ملفات قليلة جدًا — ' + paths.length);

    // الحكم الوحيد المسموح على هذه المشاريع هو serverless على ملفات ‎api/‎:
    // android وtools جافا بلا Spring، وvercel-api دوالُّ عديمة الخادم وما
    // عداها مكتبات. وأي حكم آخر تصنيفٌ خاطئ.
    //
    // (كان هذا الاختبار يشترط صفر أحكام مطلقًا، وكان صحيحًا قبل إضافة بصمة
    // serverless. فصار يشترط صفر أحكامٍ **خاطئة** — والمقيس أن الأحكام
    // الجديدة كلها على ملفات api/ وكلها serverless.)
    const wrong = [], right = [];
    for (const p of paths) {
      const rel = path.relative(REPO_ROOT, p);
      const d = detect(fs.readFileSync(p, 'utf8'), rel);
      if (!d) continue;
      const isHandler = d.key === 'serverless' && /(^|\/)api\//.test(rel.replace(/\\/g, '/'));
      (isHandler ? right : wrong).push(rel + ' ⇒ ' + d.name);
    }
    assert.deepStrictEqual(wrong, [],
      'تصنيفات خاطئة:\n  ' + wrong.join('\n  '));
    if (id === 'vercel-api') {
      assert.ok(right.length >= 5, 'معالجات api/ لم تُكتشف: ' + right.length);
    } else {
      assert.deepStrictEqual(right, [], id + ': لا يُتوقَّع أي حكم');
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 7. [VERCEL-ROUTE] الدالة عديمة الخادم — بصمة ومسار وطرائق
// ═══════════════════════════════════════════════════════════════════════
//
// كل بصمة أخرى تبحث عن سطر تسجيل مسار. والدالة عديمة الخادم لا تملك واحدًا:
// مسارها موضع ملفها، وطرائقها ما يفحصه المعالج في req.method. فكان مشروع
// vercel-api كله «Unknown» وعليه صفر نقاط نهاية — وفيه سبع دوال هي نقاط
// نهاية فعلًا (مقيس).

const API_DIR = path.join(__dirname, '..', 'api');

test('[VERCEL] المعالجات الحقيقية في api/ تُكتشف كلها', () => {
  const handlers = fs.readdirSync(API_DIR).filter(f => f.endsWith('.js'));
  assert.ok(handlers.length >= 6, 'عدد المعالجات: ' + handlers.length);
  const missed = [];
  for (const f of handlers) {
    const code = fs.readFileSync(path.join(API_DIR, f), 'utf8');
    const d = detect(code, 'vercel-api/api/' + f);
    if (!d || d.key !== 'serverless') missed.push(f + ' ⇒ ' + (d ? d.name : 'لا حكم'));
  }
  assert.deepStrictEqual(missed, [], 'معالجات لم تُكتشف:\n  ' + missed.join('\n  '));
});

test('[VERCEL] المسار من موضع الملف، و‎index‎ يعني الدليل', () => {
  const R = PI.serverlessRoute;
  assert.strictEqual(R('vercel-api/api/analyze.js'), '/api/analyze');
  assert.strictEqual(R('api/patterns/save.js'), '/api/patterns/save');
  assert.strictEqual(R('api/users/index.js'), '/api/users');
  assert.strictEqual(R('api/u/[id].ts'), '/api/u/[id]');
  assert.strictEqual(R('a\\b\\api\\x.js'), '/api/x', 'فاصل Windows');
  // بلا دليل على مسار ⇒ null، ولا اختراع
  assert.strictEqual(R('public/helper.js'), null, 'ملف خارج api/ ليس نقطة نهاية');
  assert.strictEqual(R('api'), null);
  // ‎api/index.js‎ نقطةُ نهاية على ‎/api‎ في اصطلاح Vercel. توقّعتُ أولًا null
  // فأخفق الاختبار؛ القياس أثبت أن فرضيتي خاطئة لا الإنتاج.
  assert.strictEqual(R('api/index.js'), '/api');
  assert.strictEqual(R(''), null);
  assert.strictEqual(R(null), null);
});

test('[VERCEL] الطرائق من فحوص المعالج نفسه — ‎!==‎ تعني المسموح', () => {
  const M = PI.serverlessMethods;
  assert.deepStrictEqual(M("if (req.method !== 'POST') return res.status(405).end();"), ['POST']);
  assert.deepStrictEqual(M("if (req.method === 'GET') {}"), ['GET']);
  assert.deepStrictEqual(
    M("if (req.method === 'OPTIONS') return;\nif (req.method !== 'POST') return;"),
    ['OPTIONS', 'POST']);
  assert.deepStrictEqual(M("if (['GET','PUT'].includes(req.method)) {}"), ['GET', 'PUT']);
  assert.deepStrictEqual(M("if ('HEAD' === req.method) {}"), ['HEAD'], 'المقارنة المعكوسة');
  // بلا أي فحص ⇒ ANY: يُقال إن المعالج يقبل أي طريقة، لا يُخمَّن
  assert.deepStrictEqual(M('export default (req,res) => res.end();'), ['ANY']);
});

test('[VERCEL] نقاط النهاية الحقيقية: api/analyze.js يعطي OPTIONS و POST', () => {
  const name = 'vercel-api/api/analyze.js';
  const code = fs.readFileSync(path.join(API_DIR, 'analyze.js'), 'utf8');
  const d = detect(code, name);
  const eps = PI.mapAPIEndpoints(code, d, name);

  assert.deepStrictEqual(eps.map(e => e.method).sort(), ['OPTIONS', 'POST']);
  for (const e of eps) {
    assert.strictEqual(e.path, '/api/analyze');
    assert.strictEqual(e.source, 'file-route', 'مصدر المسار يجب أن يُعلَن');
    assert.ok(e.line >= 1);
  }
  // الحقيقة من الملف مباشرة: الطرائق المفحوصة فيه
  const inFile = [...new Set([...code.matchAll(/req\.method\s*[!=]==?\s*'([A-Z]+)'/g)].map(m => m[1]))].sort();
  assert.deepStrictEqual(eps.map(e => e.method).sort(), inFile);
});

test('[VERCEL] بلا اسم ملف لا نقاط نهاية — لا مسار مُخترَع', () => {
  const code = fs.readFileSync(path.join(API_DIR, 'unzip.js'), 'utf8');
  const d = detect(code, 'vercel-api/api/unzip.js');
  assert.ok(d && d.key === 'serverless');
  assert.deepStrictEqual(PI.mapAPIEndpoints(code, d), [], 'بلا fileName يجب ألا يُنتج مسارًا');
  assert.deepStrictEqual(PI.mapAPIEndpoints(code, d, 'public/x.js'), [], 'ملف خارج api/');
});

test('[VERCEL] لا يُزاحم الأطر الحقيقية: Express يبقى Express', () => {
  const express = 'const express = require("express");\nconst app = express();\n' +
    'app.get("/u",(req,res)=>{ if (req.method !== "GET") return res.status(405).json({}); res.json({}); });';
  const d = detect(express, 'api/server.js');
  assert.ok(d, 'لا حكم على تطبيق Express حقيقي');
  assert.strictEqual(d.name, 'Express.js', 'صُنِّف ' + d.name + ' بدل Express');
  // ومساراته تأتي من سطر التسجيل لا من موضع الملف
  const eps = PI.mapAPIEndpoints(express, d, 'api/server.js');
  assert.ok(eps.some(e => e.path === '/u'), JSON.stringify(eps));
});

test('[VERCEL] شرط الأدلة قائم: إشارة serverless واحدة لا تُنتج حكمًا', () => {
  assert.strictEqual(detect('if (req.method === "POST") {}', 'api/x.js'), null,
    'req.method وحده ليس دليلًا على معالج');
  assert.strictEqual(detect('res.status(200).json({});', 'api/x.js'), null);
  // إشارتان بلا مرساة ⇒ مسموح
  assert.ok(detect('if (req.method !== "POST") return res.status(405).json({});', 'api/x.js'));
});

test('[VERCEL] حاجز اللغة يُطبَّق هنا أيضًا', () => {
  const code = 'export default async function handler(req, res) { res.status(200).end(); }';
  assert.ok(detect(code, 'api/x.js'));
  for (const fn of ['A.java', 'a.py', 'a.php']) {
    assert.strictEqual(detect(code, fn), null, 'كُشف serverless في ' + fn);
  }
});

test('[VERCEL] vercel.json منصّةٌ لا بيئةَ اعتماديات', () => {
  const e = PI.readEnvironment(path.join(REPO_ROOT, 'vercel-api'));
  assert.strictEqual(e.verdict, 'npm', 'البيئة تبقى npm من package.json');
  assert.ok(Array.isArray(e.platforms));
  const v = e.platforms.find(p => p.platform === 'vercel');
  assert.ok(v, 'vercel.json لم يُرصَد: ' + JSON.stringify(e.platforms));

  // الحقيقة من الملف مباشرة
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'vercel-api', 'vercel.json'), 'utf8'));
  assert.strictEqual(v.runtime.version, String(cfg.version));
  assert.strictEqual(v.runtime.routes, (cfg.routes || []).length);
  assert.deepStrictEqual(v.runtime.functions.slice().sort(),
    Object.keys(cfg.functions || {}).sort());

  // ولا يُحسَب ecosystem ولا يزيد عدد الاعتماديات
  assert.ok(!e.ecosystems.includes('vercel'));
  assert.ok(!e.manifests.some(m => /vercel\.json$/.test(m.manifest)),
    'vercel.json أُدرج بين بيانات الاعتماديات');
});

test('[VERCEL] منصّة بلا بيان اعتماديات ⇒ unknown مع تصريح بالمنصّة', () => {
  const e = PI.detectEnvironment({ 'vercel.json': '{"version":2}' });
  assert.strictEqual(e.verdict, 'unknown', 'المنصّة وحدها ليست بيئة اعتماديات');
  assert.strictEqual(e.platforms.length, 1);
  assert.match(e.note, /منصّة معروفة/, 'لا بد من ذكر المنصّة: ' + e.note);
  assert.match(e.note, /vercel/);
  assert.strictEqual(e.packageJson, null);
});

test('[VERCEL] vercel.json تالف ⇒ خطأ مُعلَن', () => {
  const e = PI.detectEnvironment({ 'vercel.json': '{ ليس JSON' });
  assert.strictEqual(e.platforms.length, 0);
  assert.strictEqual(e.errors.length, 1);
  assert.match(e.errors[0].error, /JSON غير صالح/);
});

// ═══════════════════════════════════════════════════════════════════════
// 8. [CI-STUDY] قرار عدم توصيل code_intelligence.js بمسار الخادم
// ═══════════════════════════════════════════════════════════════════════
//
// القياس: إضافته إلى قائمة api/analyze.js تُغيّر ناتج analyzeCode بمقدار صفر
// (42 بلاغًا في الحالتين على 9 عيّنات)، وتكلفتها +0.08ms على التحميل (3.9%)
// و18.1KB. والسبب أن مسار الخادم يستقبل **ملفًا واحدًا** لكل طلب، فالتحليل
// عبر الملفات لا ينطبق عليه أصلًا؛ والمستهلك الوحيد لـanalyzeWithIntelligence
// في القائمة هو SelfHealing.Tests.taint، وSelfHealing لا يُنادى هناك.
//
// فلم يُوصَل. والاختبارات أدناه تثبّت الوقائع التي بُني عليها القرار: إن تغيّر
// أحدها لاحقًا يسقط الاختبار ويُعاد النظر، بدل أن يبقى القرار مدفونًا.

test('[CI-STUDY] api/analyze.js لا يستقبل إلا ملفًا واحدًا', () => {
  const src = fs.readFileSync(path.join(API_DIR, 'analyze.js'), 'utf8');
  assert.match(src, /const \{ code, fileName/, 'شكل الطلب تغيّر — أُعيد النظر في القرار');
  assert.ok(!/analyzeMultipleFiles/.test(src), 'صار هناك مسار متعدد الملفات ⇒ أُعيد النظر');
});

test('[CI-STUDY] لا منادي لـanalyzeWithIntelligence في قائمة الخادم إلا SelfHealing', () => {
  const src = fs.readFileSync(path.join(API_DIR, 'analyze.js'), 'utf8');
  const m = src.match(/const engines = \[([\s\S]*?)\];/);
  assert.ok(m, 'قائمة محركات الخادم غير موجودة');
  const list = [...m[1].matchAll(/'([^']+\.js)'/g)].map(x => x[1]);

  assert.ok(!list.includes('code_intelligence.js'),
    'code_intelligence.js أُضيف — فليُقَس أثره من جديد ويُحدَّث هذا القرار');

  const callers = list.filter(f => {
    const p = path.join(PUBLIC_DIR, f);
    return fs.existsSync(p) && /analyzeWithIntelligence/.test(fs.readFileSync(p, 'utf8'));
  });
  assert.deepStrictEqual(callers, ['self_healing_engine.js'],
    'تغيّر المستهلكون: ' + JSON.stringify(callers));
  assert.ok(!/SelfHealing\s*\.\s*(heal|monitor|checkConflicts|checkRegression)/.test(src),
    'SelfHealing صار يُنادى على مسار الخادم ⇒ أُعيد النظر');
});

test('[CI-STUDY] الملف موجود وسليم — القرار عن الجدوى لا عن الصلاحية', () => {
  const p = path.join(PUBLIC_DIR, 'code_intelligence.js');
  assert.ok(fs.existsSync(p), 'code_intelligence.js غائب');
  const src = fs.readFileSync(p, 'utf8');
  assert.match(src, /function analyzeWithIntelligence/);
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'code_intelligence.js' }),
    'لا يُحلَّل — الرفض يصير عن عطب لا عن جدوى');
  // وهو محمَّل في الصفحة، حيث يُستعمل فعلًا عبر analyzeMultipleFiles
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  assert.match(html, /<script src="\/code_intelligence\.js">/,
    'لو أُزيل من الصفحة لانقطع cross-file taint في المسار المتكامل');
});

// ═══════════════════════════════════════════════════════════════════════
// 9. [INTEGRATED] المسار المتكامل على مشروع حقيقي
// ═══════════════════════════════════════════════════════════════════════

function fullContext() {
  const LIST = ['acorn.min.js', 'engine_java.js', 'c_cpp_analyzer.js', 'analyzer.js',
    'security_scanner.js', 'secret_detector.js', 'taint_core.js', 'taint_js.js', 'taint_py.js',
    'taint_php.js', 'context_analyzer.js', 'code_intelligence.js', 'repair_engine.js',
    'fallback_fixes.js', 'emergency_fixes.js', 'smart_repair.js', 'fixers_orchestrator.js',
    'repair_sql.js', 'self_healing_engine.js', 'repair_html.js', 'repair_advanced.js',
    'fix_verifier.js', 'ghost_mode.js', 'learning_engine.js', 'fix_engine_pipeline.js',
    'project_intelligence.js', 'dependency_analyzer.js'];
  const store = new Map();
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {}, info() {} },
    window: {}, global: {}, F: {}, R: {},
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k), clear: () => store.clear(),
    },
  });
  for (const f of LIST) {
    const p = path.join(PUBLIC_DIR, f);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f }); } catch (_) {}
  }
  vm.runInContext('if (window.RepairSQL) RepairSQL = window.RepairSQL;', ctx);
  return ctx;
}

function projectFiles(cap) {
  const root = path.join(REPO_ROOT, 'vercel-api');
  const out = [];
  (function rec(d) {
    if (out.length >= cap) return;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (out.length >= cap) return;
      if (['node_modules', '.git', 'test', 'fixtures'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p);
      else if (path.extname(e.name) === '.js') out.push(p);
    }
  })(root);
  out.sort();
  return out.map(p => ({ name: path.relative(REPO_ROOT, p), code: fs.readFileSync(p, 'utf8') }));
}

test('[INTEGRATED] vercel-api: بيئة ← تحليل عبر الملفات ← نقاط نهاية حقيقية', () => {
  const ctx = fullContext();
  const env = PI.readEnvironment(path.join(REPO_ROOT, 'vercel-api'));
  const files = projectFiles(30);
  assert.ok(files.length >= 20, 'ملفات المشروع: ' + files.length);

  vm.runInContext('__F = ' + JSON.stringify(files) + '; __E = ' + JSON.stringify(env) + ';', ctx);
  const r = JSON.parse(vm.runInContext('JSON.stringify((()=>{const x=analyzeMultipleFiles(__F,__E);' +
    'return {files:x.files,framework:x.framework,endpoints:x.totalEndpoints,' +
    'eps:x.endpoints.map(e=>e.method+" "+e.path),env:x.environment,' +
    'nodes:Object.keys(x.projectGraph.nodes).length};})())', ctx));

  // ① البيئة
  assert.strictEqual(r.env.verdict, 'npm');
  assert.strictEqual(r.env.dependenciesAnalyzed, true, 'لم يُنادَ محلل الاعتماديات');
  assert.ok(r.env.totalDependencies >= 1);

  // ② الإطار — لم يكن يُكتشف قبل هذه الجولة
  assert.strictEqual(r.framework, 'Vercel/Serverless Function',
    'الإطار: ' + r.framework);

  // ③ نقاط النهاية — كانت صفرًا
  assert.ok(r.endpoints >= 7, 'نقاط النهاية: ' + r.endpoints);
  const paths = new Set(r.eps.map(s => s.split(' ')[1]));
  // الحقيقة من القرص: كل ملف في api/ يجب أن يظهر مساره
  const onDisk = fs.readdirSync(API_DIR).filter(f => f.endsWith('.js'))
    .map(f => '/api/' + f.replace(/\.js$/, ''));
  for (const p of onDisk) assert.ok(paths.has(p), 'مسار مفقود: ' + p);
  assert.ok(r.eps.includes('POST /api/analyze') && r.eps.includes('OPTIONS /api/analyze'),
    JSON.stringify(r.eps));

  assert.strictEqual(r.nodes, files.length);
});

test('[INTEGRATED] اكتشاف مشكلة فعلية، وإصلاح تتحقق منه البوابة، بلا تطبيق', () => {
  const ctx = fullContext();
  const files = projectFiles(30);

  // بصمات قبل — لإثبات أن لا شيء يُكتب
  const root = path.join(REPO_ROOT, 'vercel-api');
  const hash = p => require('node:crypto').createHash('sha256')
    .update(fs.readFileSync(p)).digest('hex');
  const before = new Map(files.map(f => [path.join(REPO_ROOT, f.name),
                                         hash(path.join(REPO_ROOT, f.name))]));

  let withIssues = 0, candidates = 0, acceptedCount = 0;
  const accepted = [];
  for (const f of files) {
    vm.runInContext('__C = ' + JSON.stringify(f.code) + '; __N = ' + JSON.stringify(f.name) + ';', ctx);
    const out = JSON.parse(vm.runInContext('JSON.stringify((()=>{try{' +
      'const issues = analyzeCode(__C,__N) || [];' +
      'if (!issues.length) return {n:0};' +
      'const rep = repairCode(__C, issues, __N);' +
      'const cand = rep && rep.repaired;' +
      'if (typeof cand !== "string" || cand === __C) return {n:issues.length, changed:false};' +
      'const v = FixVerifier.verifyFix(__C, cand, __N, analyzeCode);' +
      'return {n:issues.length, changed:true, accepted:v.accepted===true,' +
      ' reason:String(v.reason||""), after:(analyzeCode(cand,__N)||[]).length,' +
      ' repairs:(rep.repairs||[]).map(x=>x.strategy)};' +
      '}catch(e){return {err:String(e.message)};}})())', ctx));
    if (out.n > 0) withIssues++;
    if (out.changed) {
      candidates++;
      if (out.accepted) {
        acceptedCount++;
        accepted.push({ file: f.name, before: out.n, after: out.after,
                        strategies: out.repairs, reason: out.reason });
      }
    }
  }

  assert.ok(withIssues >= 5, 'ملفات ذات بلاغات: ' + withIssues);
  assert.ok(candidates >= 1, 'لم يُنتج أي مُرشَّح إصلاح على مشروع حقيقي');
  assert.ok(acceptedCount >= 1, 'البوابة رفضت كل المُرشَّحات: ' + candidates);

  for (const a of accepted) {
    assert.ok(a.after < a.before, a.file + ': البلاغات لم تنقص ' + a.before + '→' + a.after);
    assert.match(a.reason, /^ACCEPTED/, a.file + ': ' + a.reason);
    assert.ok(a.strategies.length >= 1, a.file + ': إصلاح مقبول بلا استراتيجية مُعلَنة');
  }

  // ⑤ لا تطبيق تلقائي: ولا بايت على القرص
  const changed = [];
  for (const [p, h] of before) if (hash(p) !== h) changed.push(path.relative(REPO_ROOT, p));
  assert.deepStrictEqual(changed, [], 'ملفات تغيّرت بلا موافقة: ' + changed.join(', '));
  assert.ok(fs.existsSync(root));
});

test('[INTEGRATED] حدٌّ مقيس: تحليل المحرك لنفسه يُنتج إيجابيات كاذبة', () => {
  // المحرك يبحث عن أنماط، ومصدره يحوي تلك الأنماط نصًّا. فتشغيله على ملفاته
  // يُبلّغ عن جداول أنماطه. هذا ليس عطبًا في الإصلاح بل حدُّ تطبيقٍ يجب أن
  // يُقال — ويُثبَّت هنا كي لا يُقرأ «65 بلاغًا» على أنه 65 ثغرة.
  const ctx = fullContext();
  const selfSrc = fs.readFileSync(path.join(PUBLIC_DIR, 'analyzer.js'), 'utf8');
  vm.runInContext('__C = ' + JSON.stringify(selfSrc) + '; __N = "vercel-api/public/analyzer.js";', ctx);
  const issues = JSON.parse(vm.runInContext(
    'JSON.stringify((analyzeCode(__C,__N)||[]).map(i=>({sev:i.sev,line:i.line,t:String(i.title||"")})))', ctx));

  const sqlClaim = issues.find(i => /SQL Injection/.test(i.t));
  assert.ok(sqlClaim, 'توقّعنا بلاغ SQL على مصدر المحلل نفسه');
  const line = selfSrc.split('\n')[sqlClaim.line - 1] || '';
  // السطر المُبلَّغ عنه سطرُ نمطٍ (regex) لا استعلامٌ فعلي
  assert.ok(/\/\\b|test\(|\.source|RegExp|\/[a-z]*\s*[,)]/.test(line) || /\\b/.test(line),
    'السطر المُبلَّغ عنه ليس نمطًا كما توقّعنا: ' + line.trim().slice(0, 120));
});

// ═══════════════════════════════════════════════════════════════════════
// 10. [GRAPH-RESOLVE] علاقات الاستيراد في projectGraph
// ═══════════════════════════════════════════════════════════════════════
//
// المطابقة السابقة كانت نصًّا جزئيًا:
//     r.file.includes(imp) || imp.includes(r.file.replace(/\.\w+$/, ''))
// والمقيس على 149 ملفًا من هذا المشروع: 33 حافة، **صفرٌ منها صحيح**، و16
// علاقة وهمية فريدة. وسببها شِقّان:
//   • النسبي لا يُحَل: ‎'…/x.js'.includes('./x.js')‎ كاذبة ببادئة ‎./‎.
//   • النصّ الجزئي: ‎require('crypto')‎ يطابق ‎crypto_scanner.js‎.

const RESOLVE = PI.resolveImport;

test('[GRAPH] resolveImport: النسبي يُحَل مقابل دليل المُستورِد', () => {
  const S = new Set(['a/b/x.js', 'a/y.js', 'a/b/c/z.js', 'a/b/d/index.js', 'a/b/t.ts']);
  assert.strictEqual(RESOLVE('a/b/main.js', './x.js', S), 'a/b/x.js');
  assert.strictEqual(RESOLVE('a/b/main.js', './x', S), 'a/b/x.js', 'استنتاج الامتداد');
  assert.strictEqual(RESOLVE('a/b/main.js', '../y.js', S), 'a/y.js');
  assert.strictEqual(RESOLVE('a/b/main.js', './c/z.js', S), 'a/b/c/z.js');
  assert.strictEqual(RESOLVE('a/b/c/deep.js', '../../y.js', S), 'a/y.js', '‎..‎ مرتين');
  assert.strictEqual(RESOLVE('a/b/main.js', './d', S), 'a/b/d/index.js', 'الدليل ⇒ index');
  assert.strictEqual(RESOLVE('a/b/main.js', './d/', S), 'a/b/d/index.js');
  assert.strictEqual(RESOLVE('a/b/main.js', './t', S), 'a/b/t.ts', 'امتداد غير .js');
  assert.strictEqual(RESOLVE('a\\b\\main.js', './x.js', S), 'a/b/x.js', 'فاصل Windows');
});

test('[GRAPH] resolveImport: ما لا دليل عليه لا يُحَل', () => {
  const S = new Set(['a/b/x.js', 'a/crypto_scanner.js', 'a/b/fsutil.js', 'a/b/express_helper.js']);
  // غير نسبي ⇒ ليس ملفًا في المشروع، ولو تشابه الاسم
  for (const spec of ['fs', 'path', 'crypto', 'express', '@scope/pkg', 'node:fs', 'lodash/merge'])
    assert.strictEqual(RESOLVE('a/b/main.js', spec, S), null, 'حُلّ مُحدِّد غير نسبي: ' + spec);
  // نسبيّ إلى هدف ليس في المجموعة ⇒ null، لا اختراع
  assert.strictEqual(RESOLVE('a/b/main.js', './nope.js', S), null);
  assert.strictEqual(RESOLVE('a/b/main.js', '../../../outside.js', S), null, 'صعود فوق الجذر');
  assert.strictEqual(RESOLVE('a/b/main.js', '', S), null);
  assert.strictEqual(RESOLVE('a/b/main.js', null, S), null);
  assert.strictEqual(RESOLVE('', './x.js', S), null, 'بلا مُستورِد');
});

test('[GRAPH] منعُ العلاقات الوهمية: المكتبات لا تُنتج حِوافًا ولو تشابهت الأسماء', () => {
  // هذا هو صنف الخطأ الذي أنتج الحافة الوحيدة قبل الإصلاح
  const files = [
    { name: 'p/app.js', code: "const crypto = require('crypto');\nconst fs = require('fs');\n" +
                               "const express = require('express');\nconst _ = require('lodash');\n" },
    { name: 'p/crypto_scanner.js', code: 'module.exports = {};\n' },
    { name: 'p/fsutil.js', code: 'module.exports = {};\n' },
    { name: 'p/express_helper.js', code: 'module.exports = {};\n' },
    { name: 'p/lodash_shim.js', code: 'module.exports = {};\n' },
  ];
  const ctx = fullContext();
  vm.runInContext('__F = ' + JSON.stringify(files) + ';', ctx);
  const g = JSON.parse(vm.runInContext(
    'JSON.stringify(analyzeMultipleFiles(__F).projectGraph)', ctx));
  assert.deepStrictEqual(g.edges, [],
    'حِواف وهمية من مكتبات: ' + JSON.stringify(g.edges.map(e => e.from + '→' + e.to)));
});

test('[GRAPH] مكتبة مدمجة باسم ملفٍ مجاور لا تُنتج حافة', () => {
  // ثغرة كشفها مسح التحوّرات: إسقاط شرط «نسبي فقط» نجا من كل الاختبارات،
  // لأن عيّنتي سمّت الملفات crypto_scanner.js فلم يصادف ‎'crypto'‎ ملفًا
  // باسمه. والحالة التي يحميها الشرط فعلًا هي هذه: ‎require('crypto')‎ يعني
  // وحدة Node المدمجة، لا الملف المجاور ‎crypto.js‎ — ولو تطابق الاسم.
  const files = [
    { name: 'p/app.js', code: "const crypto = require('crypto');\n" +
                               "const path = require('path');\n" +
                               "const lodash = require('lodash');\n" },
    { name: 'p/crypto.js', code: 'module.exports = {};\n' },
    { name: 'p/path.js',   code: 'module.exports = {};\n' },
    { name: 'p/lodash.js', code: 'module.exports = {};\n' },
  ];
  const ctx = fullContext();
  vm.runInContext('__F = ' + JSON.stringify(files) + ';', ctx);
  const g = JSON.parse(vm.runInContext(
    'JSON.stringify(analyzeMultipleFiles(__F).projectGraph)', ctx));
  assert.deepStrictEqual(g.edges, [],
    'حافة وهمية إلى ملف يحمل اسم مكتبة: ' +
    JSON.stringify(g.edges.map(e => e.from + '→' + e.to + ' [' + e.spec + ']')));

  // ومع ‎./‎ صريحة تصير علاقةً صحيحة — فالشرط يميّز القصد لا الاسم
  const files2 = [
    { name: 'p/app.js', code: "const c = require('./crypto');\n" },
    { name: 'p/crypto.js', code: 'module.exports = {};\n' },
  ];
  vm.runInContext('__F2 = ' + JSON.stringify(files2) + ';', ctx);
  const g2 = JSON.parse(vm.runInContext(
    'JSON.stringify(analyzeMultipleFiles(__F2).projectGraph)', ctx));
  assert.strictEqual(g2.edges.length, 1, JSON.stringify(g2.edges));
  assert.strictEqual(g2.edges[0].to, 'p/crypto.js');
});

test('[GRAPH] الاستيراد الذاتي لا يُنتج حافة، ولا تكرار لنفس العلاقة', () => {
  const files = [
    { name: 'p/a.js', code: "require('./a.js');\nrequire('./b.js');\nrequire('./b');\nrequire('./b.js');\n" },
    { name: 'p/b.js', code: 'module.exports = 1;\n' },
  ];
  const ctx = fullContext();
  vm.runInContext('__F = ' + JSON.stringify(files) + ';', ctx);
  const g = JSON.parse(vm.runInContext(
    'JSON.stringify(analyzeMultipleFiles(__F).projectGraph)', ctx));
  assert.strictEqual(g.edges.length, 1, JSON.stringify(g.edges));
  assert.strictEqual(g.edges[0].from, 'p/a.js');
  assert.strictEqual(g.edges[0].to, 'p/b.js');
  assert.ok(g.edges[0].spec, 'المُحدِّد يجب أن يُحفَظ للتتبّع');
});

test('[GRAPH] النسبي غير المحلول يُعلَن ولا يُختلَق له هدف', () => {
  const files = [
    { name: 'p/a.js', code: "require('./missing.js');\nrequire('fs');\n" },
    { name: 'p/b.js', code: 'module.exports = 1;\n' },
  ];
  const ctx = fullContext();
  vm.runInContext('__F = ' + JSON.stringify(files) + ';', ctx);
  const g = JSON.parse(vm.runInContext(
    'JSON.stringify(analyzeMultipleFiles(__F).projectGraph)', ctx));
  assert.deepStrictEqual(g.edges, []);
  assert.strictEqual(g.unresolved.length, 1, JSON.stringify(g.unresolved));
  assert.strictEqual(g.unresolved[0].spec, './missing.js');
  // وغير النسبي ليس نقصًا فلا يُسجَّل ضجيجًا
  assert.ok(!g.unresolved.some(u => u.spec === 'fs'));
});

test('[GRAPH] المشروع الحقيقي: كل علاقة استيراد تُبنى، وصفر وهمية', () => {
  // الحقيقة تُحسَب من القرص باستقلال عن الإنتاج — فلا يصير الاختبار مرآةً
  function allFiles() {
    const root = path.join(REPO_ROOT, 'vercel-api');
    const out = [];
    (function rec(d) {
      let ents;
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
      for (const e of ents) {
        if (['node_modules', '.git'].includes(e.name)) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) rec(p);
        else if (/\.(js|mjs|cjs)$/.test(e.name)) out.push(p);
      }
    })(root);
    out.sort();
    return out.map(p => ({ name: path.relative(REPO_ROOT, p).replace(/\\/g, '/'),
                           code: fs.readFileSync(p, 'utf8') }));
  }
  const files = allFiles();
  assert.ok(files.length >= 100, 'ملفات المشروع: ' + files.length);
  const inSet = new Set(files.map(f => f.name));

  const ctx = fullContext();
  vm.runInContext('__F = ' + JSON.stringify(files) + ';', ctx);
  const g = JSON.parse(vm.runInContext(
    'JSON.stringify((()=>{const x=analyzeMultipleFiles(__F);' +
    'return {edges:x.projectGraph.edges,unresolved:x.projectGraph.unresolved,' +
    'nodes:Object.keys(x.projectGraph.nodes).length};})())', ctx));

  // الحقيقة: نحلّ كل استيراد نسبي بـpath.resolve على القرص
  const expected = new Set();
  for (const f of files) {
    const specs = [];
    for (const line of f.code.split('\n')) {
      const m = line.trim().match(/(?:import\s+.*?\s+from\s+|require\s*\(\s*)['"]([^'"]+)['"]/);
      if (m) specs.push(m[1]);
    }
    for (const s of specs) {
      if (!/^\.\.?(?:\/|$)/.test(s)) continue;
      const abs = path.resolve(path.dirname(path.join(REPO_ROOT, f.name)), s);
      for (const c of [abs, abs + '.js', abs + '.mjs', abs + '.cjs', path.join(abs, 'index.js')]) {
        let ok = false;
        try { ok = fs.existsSync(c) && fs.statSync(c).isFile(); } catch (_) {}
        if (!ok) continue;
        const rel = path.relative(REPO_ROOT, c).replace(/\\/g, '/');
        if (inSet.has(rel) && rel !== f.name) expected.add(f.name + '→' + rel);
        break;
      }
    }
  }
  assert.ok(expected.size >= 20, 'علاقات متوقَّعة: ' + expected.size);

  const got = new Set(g.edges.map(e => e.from + '→' + e.to));
  const phantom = [...got].filter(x => !expected.has(x));
  const missed = [...expected].filter(x => !got.has(x));

  assert.deepStrictEqual(phantom, [], 'علاقات وهمية:\n  ' + phantom.join('\n  '));
  assert.deepStrictEqual(missed, [], 'علاقات مفقودة:\n  ' + missed.join('\n  '));
  assert.strictEqual(got.size, expected.size);
  assert.strictEqual(g.nodes, files.length);

  // الحِواف المعروفة بالاسم — تحرُّزٌ ضد تقلّص صامت
  assert.ok(got.has('vercel-api/api/analyze.js→vercel-api/public/server_engine_registration.js'),
    'العلاقة الحقيقية المعروفة مفقودة');
  assert.ok(got.has('vercel-api/public/engine_self_diagnosis.js→vercel-api/public/self_healing_engine.js'));
});

test('[GRAPH] لا تراجع: الإطار ونقاط النهاية الحقيقية باقية مع الحِواف', () => {
  const ctx = fullContext();
  const env = PI.readEnvironment(path.join(REPO_ROOT, 'vercel-api'));
  const files = projectFiles(30);
  vm.runInContext('__F = ' + JSON.stringify(files) + '; __E = ' + JSON.stringify(env) + ';', ctx);
  const r = JSON.parse(vm.runInContext('JSON.stringify((()=>{const x=analyzeMultipleFiles(__F,__E);' +
    'return {framework:x.framework,endpoints:x.totalEndpoints,crossFile:x.crossFileIssues.length,' +
    'edges:x.projectGraph.edges.length,env:x.environment.verdict};})())', ctx));
  assert.strictEqual(r.framework, 'Vercel/Serverless Function');
  assert.ok(r.endpoints >= 7, 'نقاط النهاية: ' + r.endpoints);
  assert.strictEqual(r.env, 'npm');
  assert.ok(r.edges >= 1, 'حِواف: ' + r.edges);
});

test('[REAL] android: جافا لا تُصنَّف إطارًا جافاسكريبتيًّا بحال', () => {
  const paths = collect(path.join(REPO_ROOT, 'android'), ['.java', '.kt'], 40);
  for (const p of paths) {
    const d = detect(fs.readFileSync(p, 'utf8'), path.basename(p));
    if (d) assert.strictEqual(d.lang, 'java',
      path.basename(p) + ' صُنِّف ' + d.name + ' (lang=' + d.lang + ')');
  }
});
