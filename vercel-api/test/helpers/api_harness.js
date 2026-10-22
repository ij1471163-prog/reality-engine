// ═══════════════════════════════════════════════════════════════════════
// حزمةُ اختبارٍ لدوالّ /api — محلية بالكامل
//   • أسرارٌ وهمية فقط (NOT-REAL)، تُضبط قبل تحميل أي دالة.
//   • fetch وهمي: Gemini وGitHub محاكيان في الذاكرة، وأي عنوانٍ آخر يُرمى خطأً
//     — فلا يخرج طلبٌ إلى الشبكة ولا يُكتب شيءٌ على GitHub.
//   • كل دالة تُحمَّل نسخةً جديدة (require.cache يُفرَّغ لها) فلا يتسرّب
//     عدّادُ حدٍّ احتياطي من اختبارٍ إلى آخر.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const path = require('path');

const API = path.join(__dirname, '..', '..', 'api');
const LIB = path.join(__dirname, '..', '..', 'lib');

const FAKE = {
  MASTER_SECRET: 'test-master-NOT-REAL',
  GEMINIKEY: 'FAKE-GEMINI-KEY-NOT-REAL',
  ANALYZER_SECRET: 'test-analyzer-NOT-REAL',
  GITHUB_TOKEN: 'fake-gh-token-NOT-REAL',
};
Object.assign(process.env, FAKE);

const net = {
  calls: [],
  gemini: () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'GEMINI-OK' }] } }] } }),
  github: { content: null, sha: null, puts: 0 },
};

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  net.calls.push({ url: url.replace(/key=[^&]+/, 'key=<REDACTED>'), method: opts.method || 'GET', hasSignal: !!opts.signal });
  if (/generativelanguage\.googleapis\.com/.test(url)) {
    const r = await net.gemini(url, opts);
    return { status: r.status, ok: r.status < 300, json: async () => r.body };
  }
  if (/api\.github\.com/.test(url)) {
    const gh = net.github;
    if ((opts.method || 'GET') === 'PUT') {
      const b = JSON.parse(opts.body);
      gh.content = JSON.parse(Buffer.from(b.content, 'base64').toString());
      gh.sha = 'sha' + (++gh.puts);
      return { status: 200, ok: true, json: async () => ({}) };
    }
    if (!gh.content) return { status: 404, ok: false, json: async () => ({}) };
    return { status: 200, ok: true, json: async () => ({ content: Buffer.from(JSON.stringify(gh.content)).toString('base64'), sha: gh.sha }) };
  }
  throw new Error('unexpected network call in test: ' + url);
};

function fresh(rel) {
  const file = require.resolve(path.join(API, rel));
  delete require.cache[file];
  const m = require(file);
  return typeof m === 'function' ? m : m.default;
}

function mkRes() {
  return {
    statusCode: 200, headers: {}, body: undefined, ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(s) { this.statusCode = s; return this; },
    json(o) { this.body = o; this.ended = true; return this; },
    send(o) { this.body = o; this.ended = true; return this; },
    end() { this.ended = true; return this; },
  };
}

async function call(handler, req) {
  const res = mkRes();
  await handler(Object.assign({ method: 'POST', headers: {}, body: {} }, req), res);
  return res;
}

// يتقدّم بساعة العملية كلها (Date.now) — تستعملها الدوال والمكتبة
let offsetMs = 0;
const realNow = Date.now.bind(Date);
function advance(sec) { offsetMs += sec * 1000; Date.now = () => realNow() + offsetMs; }
function resetClock() { offsetMs = 0; Date.now = realNow; }

module.exports = { API, LIB, FAKE, net, fresh, call, mkRes, advance, resetClock };
