// ═══════════════════════════════════════════════════════
// project_intelligence.js v1.0
// Project Graph + Framework Detection + API Mapping
// يبني فهم كامل لبنية المشروع
// ═══════════════════════════════════════════════════════

// ─── Framework Signatures ─────────────────────────────
//
// [FW-EVIDENCE] كانت كل بصمة قائمةَ patterns واحدة، وdetectFramework يُصدر
// حكمًا على **مطابقة واحدة** منها (confidence = matches/total، و1/3 = 0.33
// تكفي). ومن ضمن أنماط react كان ‎/jsx/i‎ — نصٌّ حرفي بلا حدّ كلمة ولا سياق.
// والنتيجة المقيسة على هذا المستودع:
//   vercel-api  ⇒ «React»  (6 ملفات، منها unzip.js لأن فيه '.jsx' في مصفوفة
//                 امتدادات، وanalyzer.js و5 غيرها)
//   android     ⇒ «React»  (3 ملفات **جافا**)
//   py fixtures ⇒ «Flask»  (ملف توليد حالات صياغة)
// أي أن أول حكم يُصدره المحرك عن أي مشروع حقيقي كان خاطئًا، وكل ما يُبنى
// عليه — mapAPIEndpoints وcontextPack — مبنيٌّ على خطأ.
//
// فصلنا الأدلة إلى صنفين:
//   anchors — دليل حاسم: استيراد/طلب المكتبة بالاسم، أو تعليق إطارٍ لا يوجد
//             إلا فيه. واحدٌ منها يكفي للحكم.
//   signals — دليل ثانوي: استعمالٌ شائع في الإطار وقد يوجد خارجه
//             (‎app.get(‎ ليست حكرًا على Express). لا تُصدر حكمًا وحدها،
//             ويلزم اثنان منها على الأقل في غياب أي مرساة.
// وlang صار حاجزًا فعليًا: fileName كان يُمرَّر ويُهمَل تمامًا.
const FRAMEWORK_SIGNATURES = {
  express: {
    anchors: [/require\(\s*['"]express['"]\s*\)/, /from\s+['"]express['"]/],
    signals: [/\bapp\.(get|post|put|delete|use)\s*\(/, /\bexpress\s*\(\s*\)/],
    name: 'Express.js', lang: 'js', type: 'backend',
  },
  fastapi: {
    anchors: [/from\s+fastapi\s+import/, /^\s*import\s+fastapi\b/m],
    signals: [/@app\.(get|post|put|delete)\s*\(/, /\bFastAPI\s*\(/],
    name: 'FastAPI', lang: 'py', type: 'backend',
  },
  flask: {
    anchors: [/from\s+flask\s+import/, /^\s*import\s+flask\b/m],
    signals: [/@app\.route\s*\(/, /\bFlask\s*\(\s*__name__/],
    name: 'Flask', lang: 'py', type: 'backend',
  },
  django: {
    anchors: [/from\s+django\b/, /^\s*import\s+django\b/m],
    signals: [/\burlpatterns\s*=\s*\[/, /\bDJANGO_SETTINGS_MODULE\b/],
    name: 'Django', lang: 'py', type: 'backend',
  },
  spring: {
    anchors: [/@SpringBootApplication\b/, /@RestController\b/,
              /\bimport\s+org\.springframework\./],
    signals: [/@RequestMapping\b/, /@(Get|Post|Put|Delete)Mapping\b/],
    name: 'Spring Boot', lang: 'java', type: 'backend',
  },
  react: {
    // ‎/jsx/i‎ أُزيلت: كانت تطابق '.jsx' في مصفوفة امتدادات وكلمة jsx في
    // تعليق أو نصّ. بديلها استعمالٌ لا يكون إلا في React فعلًا.
    anchors: [/from\s+['"]react['"]/, /require\(\s*['"]react['"]\s*\)/, /\bimport\s+React\b/],
    signals: [/\buse(State|Effect|Memo|Callback|Ref|Context|Reducer)\s*\(/,
              /\breact\/jsx-runtime\b/],
    name: 'React', lang: 'js', type: 'frontend',
  },
  nextjs: {
    anchors: [/from\s+['"]next\//, /require\(\s*['"]next[/'"]/],
    signals: [/export\s+default\s+function\s+\w+Page\b/,
              /\bget(ServerSideProps|StaticProps|StaticPaths)\b/],
    name: 'Next.js', lang: 'js', type: 'fullstack',
  },
  vue: {
    anchors: [/from\s+['"]vue['"]/, /require\(\s*['"]vue['"]\s*\)/],
    signals: [/\bcreateApp\s*\(/, /\bdefineComponent\s*\(/],
    name: 'Vue.js', lang: 'js', type: 'frontend',
  },
  laravel: {
    anchors: [/use\s+Illuminate\\/],
    signals: [/\bRoute::(get|post|put|delete)\s*\(/, /\bArtisan::/],
    name: 'Laravel', lang: 'php', type: 'backend',
  },
  // [VERCEL-ROUTE] دالةٌ بلا سطر تسجيل.
  //
  // كل بصمة أعلاه تبحث عن سطرٍ يسجّل المسار (‎app.get('/u')‎، ‎@app.route‎،
  // ‎@GetMapping‎). والدالة عديمة الخادم لا تملك واحدًا: مسارها **موضع ملفها**،
  // وطرائقها ما يفحصه المعالج في ‎req.method‎. فكان مشروع vercel-api كله
  // «Unknown» بعد تشديد الأدلة — وهو حكمٌ صادق، لكنه يعني صفر نقاط نهاية على
  // سبع دوال هي نقاط نهاية فعلًا (مقيس).
  //
  // والاسم «Vercel/Serverless» لا «Vercel» وحدها بقرار: ما تُثبته المراسي هو
  // معالج HTTP عديم الخادم (Vercel أو Netlify أو مشابه)، لا المنصّة بعينها.
  // ودليل المنصّة نفسه يأتي من بيان البناء — vercel.json — في detectEnvironment.
  //
  // [ENDPOINT-DET] ‎module.exports = async function handler(req, res)‎ — الصيغة المسمّاة — لم تكن مرساة
  // (النمط يشترط ‎function\s*\(‎ مباشرة)، فمعالجٌ لا يفحص req.method لا يُكتشف (مقيس: api/analyzer.js).
  // وبالمقابل كانت المرساة المجهولة تقبل ‎(req, res, next)‎ فيُعدّ middleware نقطةَ نهاية (مقيس:
  // src/middleware/auth.js ⇒ serverless). فالمرساة الآن تقبل الاسم وتشترط **معاملين بالضبط**،
  // وvetoes تُسقط الحكم عن ملفٍ يُصدِّر دالة ‎(req, res, X)‎ — توقيع middleware لا معالج Vercel.
  // وunanchoredVetoes: بلا أي مرساة يكفي تعريف دالة ‎(req, res, X)‎ في الملف لإسقاط حكمٍ قائم على
  // الإشارات وحدها (middleware يُصدَّر باسمه: ‎module.exports = auth‎).
  serverless: {
    anchors: [
      /@vercel\/node\b/,
      /export\s+default\s+(?:async\s+)?function\s+handler\s*\(\s*req\b/,
      /export\s+default\s+(?:async\s+)?\(\s*req\s*,\s*res\s*\)\s*=>/,
      /module\.exports\s*=\s*(?:async\s+)?\(\s*req\s*,\s*res\s*\)\s*=>/,
      /module\.exports\s*=\s*(?:async\s+)?function\b\s*(?:[A-Za-z_$][\w$]*\s*)?\(\s*req\s*,\s*res\s*\)/,
    ],
    signals: [
      /\breq\.method\b/,
      /\bres\.status\s*\(\s*\d+\s*\)\s*\.\s*(json|end|send)\s*\(/,
    ],
    vetoes: [
      /(?:module\.exports\s*=|export\s+default)\s*(?:async\s+)?function\b\s*(?:[A-Za-z_$][\w$]*\s*)?\(\s*req\s*,\s*res\s*,\s*[A-Za-z_$]/,
      /(?:module\.exports\s*=|export\s+default)\s*(?:async\s+)?\(\s*req\s*,\s*res\s*,\s*[A-Za-z_$][\w$]*\s*\)\s*=>/,
    ],
    unanchoredVetoes: [
      // ‎(?:\s+name)?‎ لا ‎\s*(?:name\s*)?‎: الثاني يقبل ‎function$x‎ ويتراجع تربيعيًا بلا مرساة (recheck)
      /\bfunction(?:\s+[A-Za-z_$][\w$]*)?\s*\(\s*req\s*,\s*res\s*,\s*[A-Za-z_$]/,
      /\(\s*req\s*,\s*res\s*,\s*[A-Za-z_$][\w$]*\s*\)\s*=>/,
    ],
    name: 'Vercel/Serverless Function', lang: 'js', type: 'backend',
  },
};

// [FW-EVIDENCE] عائلة اللغة من الامتداد. لا يُعلن إطار JS عن ملف جافا.
// وبلا اسم ملف لا دليل على اللغة ⇒ لا حجب (fail-open على الحجب وحده،
// لأن شرط الأدلة أعلاه يبقى قائمًا ويمنع الحكم الضعيف).
const FW_LANG_OF_EXT = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js',
  html: 'js', htm: 'js',
  py: 'py',
  java: 'java', kt: 'java', kts: 'java',
  php: 'php',
};

// ─── API Patterns ──────────────────────────────────────
const API_PATTERNS = {
  express: [
    { rx: /app\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g,   method: 1, path: 2 },
    { rx: /router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g, method: 1, path: 2 },
  ],
  flask: [
    { rx: /@app\.route\s*\(\s*['"]([^'"]+)['"][^)]*methods\s*=\s*\[([^\]]+)\]/g, path: 1, method: 2 },
    { rx: /@app\.route\s*\(\s*['"]([^'"]+)['"]\)/g, path: 1, method: null },
  ],
  fastapi: [
    { rx: /@app\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g, method: 1, path: 2 },
  ],
  django: [
    { rx: /path\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g, path: 1, view: 2 },
  ],
  spring: [
    { rx: /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*['"]([^'"]+)['"]/g, method: 1, path: 2 },
    { rx: /@RequestMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]/g, path: 1 },
  ],
};

// ═══════════════════════════════════════════════════════
// 1. File Parser — يستخرج بنية الملف
// ═══════════════════════════════════════════════════════

function parseFile(code, fileName) {
  const ext  = fileName.split('.').pop().toLowerCase();
  const lines = code.split('\n');

  const imports   = extractImports(lines, ext);
  const exports   = extractExports(lines, ext);
  const functions = extractFunctions(lines, ext);
  const variables = extractVariables(lines, ext);
  const calls     = extractCalls(lines, ext);

  return { fileName, ext, imports, exports, functions, variables, calls, lines: lines.length };
}

function extractImports(lines, ext) {
  const imports = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    // JS/TS
    let m = t.match(/(?:import\s+.*?\s+from\s+|require\s*\(\s*)['"]([^'"]+)['"]/);
    if (m) { imports.push({ module: m[1], line: i + 1, type: 'import' }); return; }
    // Python
    m = t.match(/^(?:import\s+(\w+)|from\s+(\w[\w.]*)\s+import)/);
    if (m) { imports.push({ module: m[1] || m[2], line: i + 1, type: 'import' }); return; }
    // Java
    m = t.match(/^import\s+([\w.]+);/);
    if (m) { imports.push({ module: m[1], line: i + 1, type: 'import' }); }
  });
  return imports;
}

function extractExports(lines, ext) {
  const moduleExports = []; // ✅ بدل exports — يتعارض مع Node.js built-in
  lines.forEach((line, i) => {
    const t = line.trim();
    const m = t.match(/^export\s+(?:default\s+)?(?:function|class|const|let|var)?\s+(\w+)/);
    if (m) moduleExports.push({ name: m[1], line: i + 1 });
    const m2 = t.match(/module\.exports\s*=\s*\{([^}]+)\}/);
    if (m2) {
      m2[1].split(',').forEach(name => {
        const n = name.trim();
        if (n) moduleExports.push({ name: n, line: i + 1 });
      });
    }
  });
  return moduleExports;
}

function extractFunctions(lines, ext) {
  const functions = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    let m;
    // JS
    m = t.match(/(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    if (m) { functions.push({ name: m[1], params: parseParams(m[2]), line: i + 1, async: t.includes('async') }); return; }
    // Arrow function
    m = t.match(/(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/);
    if (m) { functions.push({ name: m[1], params: parseParams(m[2]), line: i + 1, async: t.includes('async') }); return; }
    // Arrow in route handler
    m = t.match(/(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/);
    if (m && !t.includes('function')) {
      const routeMatch = t.match(/app\.\w+\s*\([^,]+,\s*(?:async\s*)?\(([^)]*)\)/);
      if (routeMatch) {
        functions.push({ name: 'handler', params: parseParams(routeMatch[1]), line: i + 1, async: t.includes('async') });
      }
    }
    // Python
    m = t.match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
    if (m) { functions.push({ name: m[1], params: parseParams(m[2]), line: i + 1, async: t.startsWith('async') }); return; }
    // Java
    m = t.match(/(?:public|private|protected)\s+(?:static\s+)?(?:async\s+)?\w[\w<>[\]]*\s+(\w+)\s*\(([^)]*)\)/);
    if (m && !['if','while','for','switch'].includes(m[1])) {
      functions.push({ name: m[1], params: parseParams(m[2]), line: i + 1, async: false });
    }
  });
  return functions;
}

function extractVariables(lines, ext) {
  const vars = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    // JS
    let m = t.match(/(?:const|let|var)\s+(\w+)\s*=\s*(.+)/);
    if (m) { vars.push({ name: m[1], value: m[2].trim(), line: i + 1, kind: 'declaration' }); return; }
    // Python
    m = t.match(/^(\w+)\s*=\s*(?!=)(.+)/);
    if (m && !['if','for','while','return','class','def'].some(k => t.startsWith(k))) {
      vars.push({ name: m[1], value: m[2].trim(), line: i + 1, kind: 'assignment' });
    }
  });
  return vars;
}

function extractCalls(lines, ext) {
  const calls = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    const matches = [...t.matchAll(/(\w+)\s*\(/g)];
    matches.forEach(m => {
      if (!['if','for','while','switch','function','def','class'].includes(m[1])) {
        calls.push({ callee: m[1], line: i + 1 });
      }
    });
  });
  return calls;
}

function parseParams(paramStr) {
  if (!paramStr.trim()) return [];
  return paramStr.split(',').map(p => p.trim().split(/[=:]/)[0].trim()).filter(Boolean);
}

// ═══════════════════════════════════════════════════════
// 2. Framework Detector
// ═══════════════════════════════════════════════════════

// [FW-EVIDENCE] يحذف التعليقات ويُبقي النصوص.
//
// التفريق مقصود ولازم: المراسي تعتمد على النصوص الحرفية — اسم المكتبة في
// ‎require('express')‎ و‎from 'react'‎ نصٌّ — فقناعُ النصوص يُعطِّل الاكتشاف
// كلّه. والتعليقات لا تحمل استيرادًا حقيقيًا أبدًا، فحذفها يُزيل دليلًا زائفًا
// بلا أن يُزيل دليلًا صحيحًا. (مقيس: ‎# from flask import Flask (مثال)‎ كان
// يُنتج حكم Flask.)
//
// والماسح يتخطّى النصوص كي لا يُقرأ ‎"http://x"‎ كبداية تعليق، ويُبقيها كما هي.
// و‎#‎ تعليقٌ في بايثون وPHP وحدهما — وفي JS هي حقل خاص (‎this.#x‎)، وفي PHP
// ‎#[‎ سمةٌ لا تعليق (نفس قاعدة structuralSyntax في fix_verifier.js).
function fwStripComments(src, lang) {
  const hash = (lang === 'py' || lang === 'php');
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out.push(c); i++;
      while (i < n) {
        if (src[i] === '\\') { out.push(src[i], src[i + 1] || ''); i += 2; continue; }
        if (src[i] === q) { out.push(q); i++; break; }
        if (src[i] === '\n' && q !== '`') { out.push('\n'); i++; break; }
        out.push(src[i]); i++;
      }
      continue;
    }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = (e < 0) ? n : e + 2; continue; }
    if (hash && c === '#' && d !== '[') { while (i < n && src[i] !== '\n') i++; continue; }
    out.push(c); i++;
  }
  return out.join('');
}

function detectFramework(code, fileName) {
  const raw = String(code == null ? '' : code);
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  const fileLang = FW_LANG_OF_EXT[ext] || null;
  const src = fwStripComments(raw, fileLang);

  const results = [];
  Object.entries(FRAMEWORK_SIGNATURES).forEach(([key, fw]) => {
    // [FW-EVIDENCE] حاجز اللغة
    if (fileLang && fw.lang !== fileLang) return;

    const anchors = fw.anchors.filter(p => p.test(src)).length;
    const signals = fw.signals.filter(p => p.test(src)).length;

    // [ENDPOINT-DET] أدلة نفي: توقيع middleware يُسقط حكم البصمة (انظر serverless أعلاه)
    if (fw.vetoes && fw.vetoes.some(p => p.test(src))) return;
    if (anchors === 0 && fw.unanchoredVetoes && fw.unanchoredVetoes.some(p => p.test(src))) return;

    // [FW-EVIDENCE] شرط الأدلة: مرساةٌ واحدة، أو إشارتان ثانويتان.
    // دليلٌ ثانويّ واحد ⇒ لا حكم. وهذا ما كان يُنتج «React» و«Flask» زورًا.
    if (anchors === 0 && signals < 2) return;

    const total = fw.anchors.length + fw.signals.length;
    results.push({
      key, name: fw.name, lang: fw.lang, type: fw.type,
      anchored: anchors > 0, anchors, signals,
      confidence: (anchors + signals) / total,
    });
  });

  // المُرسى يسبق غير المُرسى دائمًا، ثم الأعلى ثقةً
  results.sort((a, b) => (Number(b.anchored) - Number(a.anchored)) || (b.confidence - a.confidence));
  return results[0] || null;
}

// ═══════════════════════════════════════════════════════
// 3. API Endpoint Mapper
// ═══════════════════════════════════════════════════════

// [VERCEL-ROUTE] المسار من موضع الملف.
// اصطلاح Vercel: كل ملف تحت ‎api/‎ نقطةُ نهاية على مساره. و‎index‎ يعني الدليل
// نفسه. وبلا مقطع ‎api/‎ لا دليل على مسار ⇒ null، ولا اختراع.
function serverlessRoute(fileName) {
  const p = String(fileName || '').replace(/\\/g, '/');
  if (!p) return null;
  const segs = p.split('/');
  const i = segs.lastIndexOf('api');
  if (i < 0 || i === segs.length - 1) return null;
  const tail = segs.slice(i).join('/').replace(/\.(js|mjs|cjs|ts|tsx|jsx)$/i, '');
  const route = '/' + tail.replace(/\/index$/i, '');
  return route === '/' ? null : route;
}

// [VERCEL-ROUTE] الطرائق من فحوص المعالج نفسه.
//   ‎req.method !== 'POST'‎ ⇒ كل ما عدا POST مرفوض ⇒ المسموح POST
//   ‎req.method === 'OPTIONS'‎ ⇒ OPTIONS مُعالَجة
//   ‎['GET','POST'].includes(req.method)‎ ⇒ الاثنان
// ولا فحص إطلاقًا ⇒ ANY: المعالج يقبل أي طريقة، وهذا ما يُقال لا ما يُخمَّن.
function serverlessMethods(code) {
  const src = String(code || '');
  const set = new Set();
  let m;
  const EQ = /\breq\.method\s*(===?|!==?)\s*['"]([A-Za-z]+)['"]/g;
  while ((m = EQ.exec(src)) !== null) set.add(m[2].toUpperCase());
  const REV = /['"]([A-Za-z]+)['"]\s*(===?|!==?)\s*\breq\.method\b/g;
  while ((m = REV.exec(src)) !== null) set.add(m[1].toUpperCase());
  const LIST = /\[([^\]]*)\]\s*\.\s*(?:includes|indexOf)\s*\(\s*req\.method/g;
  while ((m = LIST.exec(src)) !== null) {
    const inner = m[1].match(/['"]([A-Za-z]+)['"]/g) || [];
    inner.forEach(s => set.add(s.replace(/['"]/g, '').toUpperCase()));
  }
  return set.size ? [...set].sort() : ['ANY'];
}

function mapAPIEndpoints(code, framework, fileName) {
  const endpoints = [];
  if (!framework) return endpoints;

  // [VERCEL-ROUTE] فرعٌ خاص: لا regex على الكود يُعطي المسار هنا
  if (framework.key === 'serverless') {
    const route = serverlessRoute(fileName);
    if (!route) return endpoints;              // بلا اسم ملف لا مسار
    const line = (() => {
      const i = String(code || '').search(/export\s+default|module\.exports\s*=/);
      return i < 0 ? 1 : String(code).slice(0, i).split('\n').length;
    })();
    for (const method of serverlessMethods(code)) {
      endpoints.push({ method, path: route, line, source: 'file-route' });
    }
    return endpoints;
  }

  const patterns = API_PATTERNS[framework.key] || [];

  patterns.forEach(({ rx, method, path, view }) => {
    const regex = new RegExp(rx.source, rx.flags);
    let match;
    while ((match = regex.exec(code)) !== null) {
      const endpoint = {
        method: method ? (match[method] || 'GET').toUpperCase() : 'GET',
        path:   path ? match[path] : match[1],
        line:   code.slice(0, match.index).split('\n').length,
      };
      if (view) endpoint.handler = match[view];
      if (!endpoints.some(e => e.path === endpoint.path && e.method === endpoint.method)) {
        endpoints.push(endpoint);
      }
    }
  });

  return endpoints;
}

// ═══════════════════════════════════════════════════════
// 4. Call Graph Builder
// ═══════════════════════════════════════════════════════

function buildCallGraph(fileInfo) {
  const graph = new Map();
  const { functions, calls } = fileInfo;

  functions.forEach(fn => {
    graph.set(fn.name, { ...fn, calledBy: [], calls: [] });
  });

  // ابنِ العلاقات
  functions.forEach(fn => {
    const nextFn = functions.find(f => f.line > fn.line);
    const fnEnd  = nextFn ? nextFn.line : fileInfo.lines + 1;

    calls.filter(c => c.line >= fn.line && c.line < fnEnd).forEach(call => {
      if (graph.has(call.callee)) {
        graph.get(fn.name).calls.push(call.callee);
        graph.get(call.callee).calledBy.push(fn.name);
      }
    });
  });

  return graph;
}

// ═══════════════════════════════════════════════════════
// 5. Risk Reasoner — يربط الأدلة ببعض
// ═══════════════════════════════════════════════════════

function buildEvidenceChain(taintIssues, callGraph, fileInfo, framework, endpoints) {
  return taintIssues.map(issue => {
    const chain = {
      issue:     issue.title,
      severity:  issue.sev,
      cwe:       issue.taintInfo?.cwe,
      evidence:  [],
      dataFlow:  [],
      context:   {},
    };

    // أضف الأدلة
    if (issue.taintInfo) {
      chain.evidence.push(`Source: ${issue.taintInfo.source} (line ${issue.taintInfo.sourceLine})`);
      chain.evidence.push(`Sink: ${issue.taintInfo.sink} (line ${issue.taintInfo.sinkLine})`);
      chain.evidence.push(`Variable: ${issue.taintInfo.variable}`);

      // Data Flow
      chain.dataFlow = [
        { step: 1, desc: `User input enters via ${issue.taintInfo.source}` },
        { step: 2, desc: `Stored in variable: ${issue.taintInfo.variable}` },
        { step: 3, desc: `Reaches dangerous sink: ${issue.taintInfo.sink}` },
        { step: 4, desc: `Result: ${issue.title}` },
      ];
    }

    // Context من الـ framework
    if (framework) {
      chain.context.framework = framework.name;
    }

    // أضف endpoint إذا موجود
    const relatedEndpoint = endpoints.find(e => Math.abs(e.line - (issue.line || 0)) < 30);
    if (relatedEndpoint) {
      chain.context.endpoint = `${relatedEndpoint.method} ${relatedEndpoint.path}`;
      chain.evidence.push(`Endpoint: ${relatedEndpoint.method} ${relatedEndpoint.path}`);
    }

    return chain;
  });
}

// ═══════════════════════════════════════════════════════
// 6. Context Pack Builder — للـ AI
// ═══════════════════════════════════════════════════════

// ✅ يقبل القيم المُحسبة مسبقاً — بدل إعادة parseFile
function buildContextPack(code, fileName, taintIssues, fileInfo, framework, endpoints, callGraph) {
  // لو استُدعيت مستقلة — احسب القيم
  if (!fileInfo)  fileInfo  = parseFile(code, fileName);
  if (!framework) framework = detectFramework(code, fileName);
  if (!endpoints) endpoints = mapAPIEndpoints(code, framework, fileName);
  if (!callGraph) callGraph = buildCallGraph(fileInfo);

  const evidence = buildEvidenceChain(taintIssues || [], callGraph, fileInfo, framework, endpoints);

  const contextPack = {
    file:       fileName,
    framework:  framework ? framework.name : 'Unknown',
    language:   fileInfo.ext,
    stats: {
      lines:     fileInfo.lines,
      functions: fileInfo.functions.length,
      imports:   fileInfo.imports.length,
      endpoints: endpoints.length,
    },
    endpoints,
    issues: evidence,
    functions: fileInfo.functions.map(f => ({
      name:   f.name,
      params: f.params,
      line:   f.line,
      // ✅ null safety على callGraph.get
      calls:  callGraph instanceof Map
        ? (callGraph.get(f.name)?.calls || [])
        : (callGraph[f.name]?.calls || []),
    })),
    imports: fileInfo.imports,
    aiPromptHint: buildAIPrompt(evidence, framework, endpoints),
  };

  return contextPack;
}

function buildAIPrompt(evidence, framework, endpoints) {
  if (!evidence.length) return null;

  const critical = evidence.filter(e => e.severity === 'c');
  if (!critical.length) return null;

  const issue = critical[0];
  return {
    framework:  framework?.name || 'Unknown',
    endpoint:   issue.context?.endpoint || 'Unknown',
    issue:      issue.issue,
    severity:   'CRITICAL',
    dataFlow:   issue.dataFlow?.map(d => d.desc) || [],
    evidence:   issue.evidence,
    task:       'Fix the vulnerability with minimal code changes. Preserve existing architecture.',
  };
}

// ═══════════════════════════════════════════════════════
// 7. Main Function
// ═══════════════════════════════════════════════════════

function analyzeProject(code, fileName, taintIssues) {
  const fileInfo    = parseFile(code, fileName);
  const framework   = detectFramework(code, fileName);
  const endpoints   = mapAPIEndpoints(code, framework, fileName);
  const callGraph   = buildCallGraph(fileInfo);
  // ✅ مرر fileInfo مباشرة — بدل ما تُعاد الحسبة داخل buildContextPack
  const contextPack = buildContextPack(code, fileName, taintIssues || [], fileInfo, framework, endpoints, callGraph);

  return {
    fileInfo,
    framework,
    endpoints,
    callGraph:   Object.fromEntries(callGraph),
    contextPack,
    summary: {
      framework:   framework?.name || 'Unknown',
      endpoints:   endpoints.length,
      functions:   fileInfo.functions.length,
      imports:     fileInfo.imports.length,
      hasAPI:      endpoints.length > 0,
    },
  };
}

// ═══════════════════════════════════════════════════════
// Multi-File Analysis — Cross-file Intelligence
// ═══════════════════════════════════════════════════════

// [ENV-LINK] env اختياري: ناتج detectEnvironment/readEnvironment.
// بلا env يبقى السلوك كما كان بالحرف (لا منادي قائم يمرّره).
function analyzeMultipleFiles(files, env) {
  if (!files || files.length === 0) return null;

  const fileResults = [];
  const globalImportMap = new Map();
  const globalFunctionMap = new Map();
  const crossFileIssues = [];

  // ─── 1. حلل كل ملف منفرداً ───────────────────────────
  files.forEach(file => {
    const result = analyzeProject(file.code, file.name, []);
    fileResults.push({ file: file.name, result });

    // جمع imports وexports
    result.fileInfo.imports.forEach(imp => {
      if (!globalImportMap.has(file.name)) globalImportMap.set(file.name, []);
      globalImportMap.get(file.name).push(imp.module);
    });

    result.fileInfo.functions.forEach(fn => {
      globalFunctionMap.set(`${file.name}::${fn.name}`, {
        file: file.name, fn, calls: result.callGraph[fn.name]?.calls || []
      });
    });
  });

  // ─── 2. ابنِ Project Graph ────────────────────────────
  const projectGraph = buildProjectGraph(fileResults, globalImportMap);

  // ─── 3. Cross-file Taint ─────────────────────────────
  if (typeof analyzeWithIntelligence === 'function') {
    files.forEach(file => {
      try {
        const taint = analyzeWithIntelligence(file.code, file.name);
        // ✅ تحقق من وجود taintIssues قبل الاستخدام
        const taintIssues = Array.isArray(taint?.taintIssues) ? taint.taintIssues : [];
        taintIssues.forEach(issue => {
          crossFileIssues.push({ ...issue, sourceFile: file.name });
        });
      } catch (e) {
        // تجاهل أخطاء تحليل ملف واحد
      }
    });
  }

  // ─── 4. Framework من أكثر ملف ────────────────────────
  const frameworks = fileResults.map(r => r.result.framework).filter(Boolean);
  const dominantFramework = frameworks.reduce((acc, fw) => {
    // ✅ تحقق من fw و fw.name قبل الاستخدام
    if (!fw || !fw.name) return acc;
    acc[fw.name] = (acc[fw.name] || 0) + 1;
    return acc;
  }, {});
  const topFrameworkEntry = Object.entries(dominantFramework).sort((a, b) => b[1] - a[1])[0];
  const topFramework = topFrameworkEntry ? topFrameworkEntry[0] : null;

  // ─── 5. API Endpoints من كل الملفات ──────────────────
  const allEndpoints = [];
  fileResults.forEach(r => {
    r.result.endpoints.forEach(ep => {
      allEndpoints.push({ ...ep, file: r.file });
    });
  });

  // ─── 6. Context Pack للـ AI ───────────────────────────
  const contextPack = {
    framework:   topFramework || 'Unknown',
    files:       files.map(f => f.name),
    endpoints:   allEndpoints,
    crossFileIssues: crossFileIssues.slice(0, 10),
    projectGraph,
    aiPrompt: crossFileIssues.length > 0 ? {
      issue:    crossFileIssues[0].title,
      severity: 'CRITICAL',
      dataFlow: crossFileIssues[0].cEv || [],
      task:     'Fix cross-file vulnerability with minimal changes',
    } : null,
  };

  // ─── 7. بيئة التشغيل والاعتماديات ────────────────────
  // [ENV-LINK] هنا يُربط المورِّد بالمستهلك: packageJson الذي قرأناه من بيان
  // البناء يُمرَّر إلى analyzeDependencies — وسيطه الثالث الذي كان بلا مصدر.
  // ولا يُنادى المحلل إلا إذا وُجد بيان npm فعلًا: بيئة gradle لا تُفحَص
  // بقائمة ثغرات npm، وذلك يُعلَن لا يُسكَت عنه.
  let environment = null;
  if (env && typeof env === 'object' && env.verdict) {
    const depIssues = [];
    let depsAnalyzed = false;
    if (env.packageJson && typeof analyzeDependencies === 'function') {
      depsAnalyzed = true;
      files.forEach(file => {
        try {
          const d = analyzeDependencies(file.code, file.name, env.packageJson);
          (d.issues || []).forEach(i => depIssues.push({ ...i, sourceFile: file.name }));
          (d.pkgIssues || []).forEach(i => {
            if (!depIssues.some(x => x.package === i.package)) depIssues.push(i);
          });
        } catch (_) { /* ملف واحد لا يُسقط التحليل */ }
      });
    }
    environment = {
      verdict:           env.verdict,
      ecosystems:        env.ecosystems || [],
      manifests:         (env.manifests || []).map(m => ({
                           manifest: m.manifest, ecosystem: m.ecosystem,
                           name: m.name, count: m.count, runtime: m.runtime })),
      unsupported:       env.unsupported || [],
      totalDependencies: env.totalDependencies || 0,
      dependencyIssues:  depIssues,
      dependenciesAnalyzed: depsAnalyzed,
      note: depsAnalyzed ? env.note
        : (env.verdict === 'unknown'
            ? env.note
            : 'لا فحص اعتماديات: المحلل الحالي قائمةُ ثغرات npm، ولا بيان npm هنا'),
    };
  }

  return {
    files:          fileResults.length,
    framework:      topFramework || 'Unknown',
    environment,
    totalEndpoints: allEndpoints.length,
    endpoints:      allEndpoints,
    crossFileIssues,
    projectGraph,
    contextPack,
    summary: {
      filesAnalyzed:  files.length,
      totalIssues:    crossFileIssues.length,
      // ✅ توحيد severity field — سواء sev أو severity
      critical:       crossFileIssues.filter(i => i.sev === 'c' || i.severity === 'CRITICAL').length,
      endpoints:      allEndpoints.length,
      framework:      topFramework || 'Unknown',
    },
  };
}

// [GRAPH-RESOLVE] حلّ مُحدِّد الاستيراد إلى ملف في المجموعة المُحلَّلة.
//
// المطابقة السابقة كانت نصًّا جزئيًا:
//     r.file.includes(imp) || imp.includes(r.file.replace(/\.\w+$/, ''))
// وأثرها المقيس على 30 ملفًا حقيقيًا من هذا المستودع: **صفر حافة صحيحة**
// و**حافة واحدة وهمية**.
//   • الخمس استيرادات النسبية كلها فُقدت: ‎'vercel-api/public/x.js'.includes('./x.js')‎
//     كاذبة بسبب بادئة ‎./‎، والشرط الثاني يقتضي أن يحوي المُحدِّد المسارَ
//     المشروعيّ كاملًا — ولا يحدث عمليًا.
//   • والحافة الوحيدة ‎analyze.js → crypto_scanner.js‎ جاءت من ‎require('crypto')‎
//     لأن ‎'…/crypto_scanner.js'.includes('crypto')‎ صادقة. فكل مكتبة مدمجة أو
//     خارجية كانت مصنعًا لحِواف وهمية.
//
// والحلّ هنا يعمل على **مجموعة الملفات المُعطاة** لا على القرص: نفس الدالة
// تعمل في المتصفح على ملفات ZIP كما تعمل في Node. وقواعده:
//   1. المُحدِّد غير النسبي (‎fs‎، ‎express‎، ‎@scope/pkg‎) لا يُنتج حافة أبدًا —
//      ليس ملفًا في المشروع. وهذا وحده يُلغي صنف الحِواف الوهمية كله.
//   2. النسبي يُحَل مقابل دليل الملف المُستورِد، مع ‎.‎ و‎..‎.
//   3. الامتداد يُستنتَج عند الاقتضاء، و‎dir/‎ تُحَل إلى ‎dir/index.*‎.
//   4. ما لا يوجد في المجموعة لا يُنتج حافة — ويُسجَّل في unresolved بدل أن
//      يُختلَق له هدف.
const GRAPH_EXTS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'];

function resolveImport(fromFile, spec, nameSet) {
  const s = String(spec || '');
  if (!/^\.\.?(?:\/|$)/.test(s)) return null;          // غير نسبي ⇒ خارج المشروع

  const dir = String(fromFile || '').replace(/\\/g, '/').split('/');
  dir.pop();                                           // اطرح اسم الملف
  const out = dir;
  for (const part of s.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!out.length) return null; out.pop(); continue; }
    out.push(part);
  }
  const base = out.join('/');
  if (!base) return null;

  if (nameSet.has(base)) return base;                  // مسار كامل بامتداده
  for (const e of GRAPH_EXTS) if (nameSet.has(base + e)) return base + e;
  for (const e of GRAPH_EXTS) if (nameSet.has(base + '/index' + e)) return base + '/index' + e;
  return null;
}

function buildProjectGraph(fileResults, importMap) {
  const graph = {};

  fileResults.forEach(({ file, result }) => {
    graph[file] = {
      imports:   importMap.get(file) || [],
      exports:   result.fileInfo.exports.map(e => e.name),
      functions: result.fileInfo.functions.map(f => f.name),
      endpoints: result.endpoints,
    };
  });

  const nameSet = new Set(fileResults.map(r => String(r.file).replace(/\\/g, '/')));
  const edges = [];
  const unresolved = [];
  const seen = new Set();

  Object.entries(graph).forEach(([file, info]) => {
    info.imports.forEach(imp => {
      const spec = String(imp);
      const to = resolveImport(file, spec, nameSet);
      if (!to) {
        // النسبي الذي لم يُحَل جديرٌ بالذكر: هدفه خارج المجموعة أو غير موجود.
        // وغير النسبي ليس نقصًا — فلا يُسجَّل ضجيجًا.
        if (/^\.\.?(?:\/|$)/.test(spec)) unresolved.push({ from: file, spec });
        return;
      }
      if (to === file) return;                         // استيراد ذاتي لا حافة
      const key = file + '\u0000' + to;
      if (seen.has(key)) return;                       // لا تكرار
      seen.add(key);
      edges.push({ from: file, to, spec, type: 'import' });
    });
  });

  return { nodes: graph, edges, unresolved };
}

// ═══════════════════════════════════════════════════════
// 7. Runtime Environment — بيانات البناء الموجودة فعلًا
// ═══════════════════════════════════════════════════════
//
// [ENV-LINK] المورِّد المفقود.
// ‎analyzeDependencies(code, fileName, packageJson)‎ في dependency_analyzer.js
// يقبل وسيطًا ثالثًا يفحص اعتماديات المشروع — ولا مورِّد له في المستودع كلّه
// (صفر منادي). فالوسيط موجود، والمستهلك موجود، ولا شيء يقرأ بيان البناء.
//
// وما يُدعَم هنا محدودٌ بما يستطيع المحرك قراءته وتحليله فعلًا، ومُجرَّبٌ على
// بيانات حقيقية في هذا المستودع:
//   package.json   → JSON.parse، اعتماديات باسم ونسخة. وهو ما يُغذّي
//                    analyzeDependencies مباشرة.
//   build.gradle   → أسطر ‎implementation 'group:artifact:version'‎ وما
//                    يجاورها من compileSdk/minSdk/namespace/applicationId.
// ولا يُدَّعى غير ذلك: pom.xml وrequirements.txt وcomposer.json تُرصَد
// كـ«موجودة وغير محلَّلة» لا كبيئة مكتشَفة، لأنه لا عيّنة حقيقية هنا
// لاختبارها — وبيانٌ لم يُجرَّب ليس دعمًا.
// وغياب كل بيان ⇒ verdict:'unknown' مع ذكر السبب، لا تخمين.

const ENV_SUPPORTED   = ['package.json', 'build.gradle', 'build.gradle.kts', 'vercel.json'];
const ENV_UNSUPPORTED = ['pom.xml', 'requirements.txt', 'composer.json',
                         'Pipfile', 'go.mod', 'Cargo.toml', 'pyproject.toml'];

function parsePackageJson(text) {
  let pkg;
  try { pkg = JSON.parse(String(text)); }
  catch (e) { return { ok: false, error: 'JSON غير صالح: ' + e.message }; }
  if (!pkg || typeof pkg !== 'object') return { ok: false, error: 'ليس كائنًا' };
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return {
    ok: true, ecosystem: 'npm', raw: pkg,
    name: typeof pkg.name === 'string' ? pkg.name : null,
    dependencies: deps,
    count: Object.keys(deps).length,
    // runtime: ما يُعلنه المشروع عن بيئة تشغيله، إن أعلن
    runtime: (pkg.engines && typeof pkg.engines === 'object') ? pkg.engines : null,
  };
}

function parseGradle(text) {
  const src = String(text).replace(/\r\n?/g, '\n');
  const deps = {};
  // ‎implementation 'g:a:v'‎ / api("g:a:v") — الشكل الذي يمكن قراءته بثقة.
  // أسطر التعليق تُستثنى، والمتغيّرات ($var) لا تُفَكّ: تُرصَد بلا نسخة.
  const RX = /^\s*(?:implementation|api|compileOnly|runtimeOnly|testImplementation|androidTestImplementation|kapt|annotationProcessor)\s*[\s(]\s*(['"])([^'"]+)\1/gm;
  let m;
  while ((m = RX.exec(src)) !== null) {
    const coord = m[2];
    if (coord.indexOf('$') >= 0) { deps[coord] = null; continue; }
    const parts = coord.split(':');
    if (parts.length >= 3) deps[parts[0] + ':' + parts[1]] = parts[2];
    else deps[coord] = null;
  }
  const pick = (rx) => { const x = rx.exec(src); return x ? x[1] : null; };
  return {
    ok: true, ecosystem: 'gradle',
    name: pick(/^\s*namespace\s+['"]([^'"]+)['"]/m) ||
          pick(/^\s*applicationId\s+['"]([^'"]+)['"]/m),
    dependencies: deps,
    count: Object.keys(deps).length,
    runtime: (() => {
      const r = {};
      const c = pick(/^\s*compileSdk(?:Version)?\s+(\d+)/m);
      const mi = pick(/^\s*minSdk(?:Version)?\s+(\d+)/m);
      const t = pick(/^\s*targetSdk(?:Version)?\s+(\d+)/m);
      if (c) r.compileSdk = c;
      if (mi) r.minSdk = mi;
      if (t) r.targetSdk = t;
      return Object.keys(r).length ? r : null;
    })(),
  };
}

// [VERCEL-ROUTE] vercel.json دليل المنصّة نفسها — لا اعتمادياتٍ فيه، بل
// تهيئةُ نشرٍ ومسارات. فيُعَدّ `platform` لا `ecosystem`: لا يُحسَب بيئةَ
// اعتماديات، ولا يُنادى به محلل اعتماديات، ويُعلن ما فيه فقط.
function parseVercelJson(text) {
  let cfg;
  try { cfg = JSON.parse(String(text)); }
  catch (e) { return { ok: false, error: 'JSON غير صالح: ' + e.message }; }
  if (!cfg || typeof cfg !== 'object') return { ok: false, error: 'ليس كائنًا' };
  return {
    ok: true, ecosystem: null, platform: 'vercel', raw: cfg,
    name: null, dependencies: {}, count: 0,
    runtime: {
      version: cfg.version != null ? String(cfg.version) : null,
      routes: Array.isArray(cfg.routes) ? cfg.routes.length : 0,
      functions: (cfg.functions && typeof cfg.functions === 'object')
        ? Object.keys(cfg.functions) : [],
    },
  };
}

const ENV_PARSERS = {
  'package.json':     parsePackageJson,
  'build.gradle':     parseGradle,
  'build.gradle.kts': parseGradle,
  'vercel.json':      parseVercelJson,
};

/**
 * [ENV-LINK] دالة خالصة: تتلقّى ما قرأه المنادي ولا تلمس قرصًا.
 * manifests = { 'package.json': '<نص>', 'android/app/build.gradle': '<نص>', … }
 * المفتاح قد يكون مسارًا؛ يُطابَق باسم الملف الأخير منه.
 */
function detectEnvironment(manifests) {
  const found = [], unsupported = [], errors = [];
  const platforms = [];
  let packageJson = null;

  Object.keys(manifests || {}).forEach(key => {
    const base = String(key).split(/[\\/]/).pop();
    if (ENV_UNSUPPORTED.indexOf(base) >= 0) {
      unsupported.push({ manifest: key,
        reason: 'موجود وغير محلَّل — لا دعم مُجرَّب لهذا البيان' });
      return;
    }
    const parse = ENV_PARSERS[base];
    if (!parse) return;
    const r = parse(manifests[key]);
    if (!r.ok) { errors.push({ manifest: key, error: r.error }); return; }
    // [VERCEL-ROUTE] المنصّة ليست بيئةَ اعتماديات: تُعلَن ولا تُحسَب ecosystem
    if (r.platform) {
      platforms.push({ manifest: key, platform: r.platform, runtime: r.runtime });
      return;
    }
    found.push({ manifest: key, ecosystem: r.ecosystem, name: r.name,
                 dependencies: r.dependencies, count: r.count, runtime: r.runtime });
    if (r.ecosystem === 'npm' && !packageJson) packageJson = r.raw;
  });

  const ecos = [...new Set(found.map(f => f.ecosystem))];
  const verdict = ecos.length === 0 ? 'unknown' : (ecos.length === 1 ? ecos[0] : 'mixed');

  return {
    verdict,
    ecosystems: ecos,
    platforms,
    manifests: found,
    unsupported,
    errors,
    // ← هذا ما يُمرَّر إلى analyzeDependencies: المورِّد الذي كان مفقودًا
    packageJson,
    totalDependencies: found.reduce((a, f) => a + f.count, 0),
    note: verdict === 'unknown'
      ? (platforms.length
          ? 'منصّة معروفة (' + platforms.map(p => p.platform).join(', ') + ') بلا بيان اعتماديات — لا فحص اعتماديات'
          : unsupported.length
          ? 'بيانات بناء موجودة لكنها غير مدعومة — البيئة غير معروفة، ولا استنتاج'
          : 'لا بيان بناء — البيئة غير معروفة، ولا استنتاج')
      : null,
  };
}

/**
 * [ENV-LINK] قارئ القرص — Node فقط، وبحدود صريحة.
 * يبحث عن البيانات المدعومة حتى عمق maxDepth ولا يتجاوز maxFiles.
 * في المتصفح: يُعيد null بصراحة (المنادي يمرّر النصوص إلى detectEnvironment).
 */
function readEnvironment(dir, opts) {
  if (typeof require !== 'function') return null;
  let fs, path;
  try { fs = require('fs'); path = require('path'); } catch (_) { return null; }
  if (!dir) return null;

  const o = opts || {};
  const maxDepth = Number.isFinite(o.maxDepth) ? o.maxDepth : 3;
  const maxFiles = Number.isFinite(o.maxFiles) ? o.maxFiles : 12;
  const SKIP = new Set(['node_modules', '.git', 'build', '.gradle', 'dist', '.next', 'vendor']);
  const WANT = new Set(ENV_SUPPORTED.concat(ENV_UNSUPPORTED));

  const manifests = {};
  let n = 0;
  (function rec(d, depth) {
    if (depth > maxDepth || n >= maxFiles) return;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (n >= maxFiles) return;
      if (SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { rec(p, depth + 1); continue; }
      if (!WANT.has(e.name)) continue;
      try { manifests[path.relative(dir, p) || e.name] = fs.readFileSync(p, 'utf8'); n++; }
      catch (_) {}
    }
  })(dir, 0);

  return detectEnvironment(manifests);
}

if (typeof globalThis !== 'undefined') {
  globalThis.detectEnvironment = detectEnvironment;
  globalThis.readEnvironment   = readEnvironment;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectFramework, fwStripComments, detectEnvironment, readEnvironment,
                     resolveImport, buildProjectGraph,
                     parsePackageJson, parseGradle, parseVercelJson,
                     mapAPIEndpoints, serverlessRoute, serverlessMethods,
                     analyzeProject, analyzeMultipleFiles,
                     FRAMEWORK_SIGNATURES, API_PATTERNS, ENV_SUPPORTED, ENV_UNSUPPORTED };
}

