#!/usr/bin/env node
// ═══════════════════════════════════════════════════════
// سيرفرُ تطويرٍ محلي — يخدم ما يخدمه Vercel، بلا Vercel
// ═══════════════════════════════════════════════════════
//
// الغرضُ تجربةُ المحرّك فعلًا لا اختبارُ وحداته: يُفتح المتصفح على
// الصفحة نفسِها التي يخدمها الإنتاج (public/index.html) بنفس بيان
// السكربتات ونفس ترتيبها، فما يعمل هنا يعمل هناك — وما يسقط هنا كان
// سيسقط هناك.
//
// التشغيل:
//     node vercel-api/tools/dev_server.js [--port 8787]
//     ثم افتح http://localhost:8787/
//
// ما يخدمه:
//   • الملفاتُ الساكنة من public/ (وindex.html على «/»)
//   • دوالُّ api/*.js بغلافٍ متوافقٍ مع توقيع Vercel
//     (req.body مُفكَّك، res.status().json())
//
// ⚠️ حدودٌ معلنة:
//   • /api/unzip يحتاج formidable وadm-zip، وليستا مثبَّتتين. ويُعلَن
//     ذلك في الرد لا يُخفى. (ورفعُ ZIP في المتصفح يجري داخل الصفحة
//     بـjszip، فلا يمرّ بهذا المسار أصلًا.)
//   • /api/chat يحتاج مفاتيحَ مزوّدِ الذكاء من البيئة. وغيابُها يُعلَن
//     في الرد: المسارُ الحتمي كلُّه يعمل بلا ذلك.
'use strict';

const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');
const url  = require('node:url');

const ROOT   = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const API    = path.join(ROOT, 'api');

const argPort = (() => {
  const i = process.argv.indexOf('--port');
  return i > -1 ? Number(process.argv[i + 1]) : Number(process.env.PORT || 8787);
})();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2',
  '.map':  'application/json; charset=utf-8',
};

// نفسُ ترويسات vercel.json — فلا يختلف سياقُ التنفيذ عن الإنتاج
const SEC_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'no-referrer',
};

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 25 * 1024 * 1024) { req.destroy(); return; }   // سقفٌ معلن
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.alloc(0)));
  });
}

// غلافٌ يجعل res يشبه ما تتوقّعه دوالُّ Vercel
function wrapRes(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = body => {
    if (typeof body === 'object' && body !== null) return res.json(body);
    res.end(String(body == null ? '' : body));
    return res;
  };
  return res;
}

async function handleApi(req, res, name, parsed) {
  const file = path.join(API, name + '.js');
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'NOT_FOUND', endpoint: '/api/' + name });
  }

  let handler;
  try {
    delete require.cache[require.resolve(file)];   // تعديلُ الدالة يسري بلا إعادة تشغيل
    handler = require(file);
    if (handler && handler.default) handler = handler.default;
  } catch (e) {
    // اعتمادٌ غائب (formidable/adm-zip) يُعلَن ولا يُخفى
    return res.status(503).json({
      error: 'HANDLER_LOAD_FAILED',
      endpoint: '/api/' + name,
      detail: String(e && e.message),
      hint: 'ثبِّت اعتماداتِ package.json، أو استعمل المسارَ الحتمي الذي لا يحتاجها',
    });
  }
  if (typeof handler !== 'function') {
    return res.status(500).json({ error: 'HANDLER_NOT_A_FUNCTION', endpoint: '/api/' + name });
  }

  const raw = await readBody(req);
  req.query = parsed.query || {};
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('application/json')) {
    try { req.body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; }
    catch (e) { return res.status(400).json({ error: 'BAD_JSON' }); }
  } else {
    req.body = raw.length ? raw.toString('utf8') : undefined;
  }
  req.rawBody = raw;

  try {
    await handler(req, res);
  } catch (e) {
    if (!res.writableEnded) {
      res.status(500).json({ error: 'HANDLER_THREW', detail: String(e && e.message) });
    }
  }
  if (!res.writableEnded) res.end();
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  // منعُ الخروج من public/ — نفسُ ما يفعله المستضيف
  const target = path.normalize(path.join(PUBLIC, rel));
  if (!target.startsWith(PUBLIC + path.sep) && target !== PUBLIC) {
    return res.status(403).end('403');
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return res.status(404).end('404 — ' + rel);
  }

  res.setHeader('Content-Type', TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');   // تطويرٌ: لا ذاكرةَ مؤقتة تُخفي تعديلًا
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
  wrapRes(res);
  for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  if (pathname.startsWith('/api/')) {
    const name = pathname.slice(5).replace(/\/+$/, '');
    if (!/^[a-zA-Z0-9_\/-]+$/.test(name)) return res.status(400).json({ error: 'BAD_ENDPOINT' });
    return handleApi(req, res, name, parsed);
  }
  if (pathname === '/__health') {
    return res.status(200).json({
      ok: true,
      publicDir: PUBLIC,
      scripts: (fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
        .match(/<script src="\/[^"]+"/g) || []).length,
    });
  }
  serveStatic(req, res, pathname);
});

server.listen(argPort, '127.0.0.1', () => {
  console.log('Reality Engine — سيرفرُ تطوير');
  console.log('  الصفحة : http://localhost:' + argPort + '/');
  console.log('  الفحص  : http://localhost:' + argPort + '/__health');
  console.log('  يخدم   : ' + PUBLIC);
});
