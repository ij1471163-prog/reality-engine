// ═══════════════════════════════════════════════════════════════════════
// [API-COMPAT] توافقُ الويب مع /api/session و/api/chat بعد تغيير صيغة الرمز
// تشغيل:  node --test vercel-api/test/api_client_compat.test.js
//
// دوالُّ الصفحة الحقيقية (_fetchSessionToken / getToken / chatAPI) تُستخرج من
// public/index.html كما هي، وتُربط بـhandlers الحقيقية من api/ عبر fetch
// محلي — لا نسخة من المنطق ولا خادمٌ وهمي. Gemini محاكى، ولا شبكة.
// (أندرويد يُختبر بترجمة AIEngine.java الحقيقي خارج المستودع: لا أدوات Java هنا.)
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');
const crypto = require('node:crypto');

const H = require('./helpers/api_harness.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function slice(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  assert.ok(a > 0, 'لم يُعثر على: ' + startMarker);
  const b = html.indexOf(endMarker, a);
  assert.ok(b > a, 'لم يُعثر على نهاية: ' + endMarker);
  return html.slice(a, b);
}
const SESSION_SRC = slice('window._sessionToken = null;', '_fetchSessionToken().catch(');
const API_SRC = slice('async function getToken()', '// ═══════════════════════════════════════════════════════\n// applyAIResult');

// صفحةٌ بعنوان عميلٍ قابل للتغيير، تتصل بالـhandlers الحقيقية
function page(opts) {
  const o = opts || {};
  const handlers = { session: o.session || H.fresh('session.js'), chat: o.chat || H.fresh('chat.js') };
  const counts = { session: 0, chat: 0 };
  const client = { ip: o.ip || '198.51.100.20', sent: [] };
  const fetch = async (url, init) => {
    const name = String(url).replace(/^\/api\//, '');
    counts[name] = (counts[name] || 0) + 1;
    const hdrs = {};
    for (const [k, v] of Object.entries((init && init.headers) || {})) hdrs[k.toLowerCase()] = v;
    hdrs['x-real-ip'] = client.ip;                      // ما يضبطه Vercel، لا ما يرسله العميل
    client.sent.push({ name, auth: hdrs.authorization || null });
    const res = await H.call(handlers[name], { method: (init && init.method) || 'GET', headers: hdrs, body: init && init.body ? JSON.parse(init.body) : {} });
    return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => res.body };
  };
  const ctx = vm.createContext({ window: {}, fetch, Date, Promise, JSON, Error });
  vm.runInContext(SESSION_SRC + '\n' + API_SRC, ctx);
  const run = src => vm.runInContext(src, ctx);
  return { ctx, run, counts, client, chat: p => run('(async () => chatAPI(await getToken(), ' + JSON.stringify(p) + '))()') };
}

test('[W1] الجلب الأول: الرد { token, expiresIn } بالصيغة الجديدة، وchat ينجح به', async () => {
  const p = page();
  assert.strictEqual(await p.chat('hi'), 'GEMINI-OK');
  assert.deepStrictEqual([p.counts.session, p.counts.chat], [1, 1]);
  assert.match(p.client.sent[1].auth, /^Bearer v1\.\d{10}\.[0-9a-f]{64}$/);
  const left = p.run('_sessionExpiry') - Date.now();
  assert.ok(left > 8 * 60 * 1000 && left <= 9 * 60 * 1000, 'الصفحة لا تحترم expiresIn بهامشها: ' + left);
});

test('[W2] انتهاء الرمز على الخادم والصفحة تظنه صالحًا ⇒ 401 ⇒ تجديدٌ مرّةً واحدة ⇒ نجاح', async (t) => {
  t.after(H.resetClock);
  const p = page();
  await p.chat('a');
  H.advance(700);
  p.run('_sessionExpiry = Date.now() + 60000');        // الصفحة متأخرة عن الخادم
  assert.strictEqual(await p.chat('b'), 'GEMINI-OK');
  assert.deepStrictEqual([p.counts.session, p.counts.chat], [2, 3]);
});

test('[W3] انتهاء الصلاحية عند الصفحة ⇒ رمزٌ جديد قبل النداء بلا 401', async () => {
  const p = page();
  await p.chat('a');
  p.run('_sessionExpiry = Date.now() - 1');
  assert.strictEqual(await p.chat('b'), 'GEMINI-OK');
  assert.deepStrictEqual([p.counts.session, p.counts.chat], [2, 2]);
});

test('[W4] تغيّر عنوان الشبكة (الرمز مربوطٌ بالعنوان) ⇒ 401 ⇒ تجديد ⇒ نجاح', async () => {
  const p = page();
  await p.chat('a');
  p.client.ip = '203.0.113.99';
  assert.strictEqual(await p.chat('b'), 'GEMINI-OK');
  assert.deepStrictEqual([p.counts.session, p.counts.chat], [2, 3]);
});

test('[W5] الانتقال عند النشر: رمزٌ مخزَّن بالصيغة القديمة ⇒ 401 ⇒ تجديد ⇒ نجاح', async () => {
  const p = page();
  const old = crypto.createHmac('sha256', H.FAKE.MASTER_SECRET).update('web_' + Math.floor(Date.now() / 600000)).digest('hex');
  p.run('window._sessionToken = ' + JSON.stringify(old) + '; _sessionExpiry = Date.now() + 500000');
  assert.strictEqual(await p.chat('b'), 'GEMINI-OK');
  assert.deepStrictEqual([p.counts.session, p.counts.chat], [1, 2]);
});

test('[W6] 401 دائم يُرفع خطأً بعد إعادةٍ واحدة — لا دوران', async () => {
  // chat يتحقق بسرٍّ غير الذي يوقّع به session ⇒ كل رمزٍ مرفوض دائمًا
  const chatH = H.fresh('chat.js'), saved = process.env.MASTER_SECRET;
  const p = page({ chat: async (req, res) => {
    process.env.MASTER_SECRET = 'other-master-NOT-REAL';
    try { await chatH(req, res); } finally { process.env.MASTER_SECRET = saved; }
  } });
  await assert.rejects(() => p.chat('x'), /خطأ في AI: Invalid token/);
  assert.deepStrictEqual([p.counts.session, p.counts.chat], [2, 2]);
});

test('[W7] 429 من chat يصل رسالةً واضحة، وعميلٌ آخر لا يتأثر (لا حجب عام)', async () => {
  const chat = H.fresh('chat.js'), session = H.fresh('session.js');
  const a = page({ chat, session, ip: '192.0.2.10' });
  const b = page({ chat, session, ip: '192.0.2.11' });
  for (let i = 0; i < 10; i++) assert.strictEqual(await a.chat('x'), 'GEMINI-OK');
  await assert.rejects(() => a.chat('x'), /خطأ في AI: Rate limit/);
  assert.strictEqual(await b.chat('x'), 'GEMINI-OK');
});

test('[W8] طلبٌ أكبر من 50,000 حرف ⇒ 413 رسالةً واضحة بلا تجديد رمز', async () => {
  const p = page();
  await assert.rejects(() => p.chat('x'.repeat(50001)), /خطأ في AI: Prompt too large/);
  assert.deepStrictEqual([p.counts.session, p.counts.chat], [1, 1]);
});

test('[W9] حدّ /api/session ⇒ رسالة «تجاوزت الحد»، والمحاولة التالية لا تتجمّد', async () => {
  const session = H.fresh('session.js');
  const p = page({ session, ip: '192.0.2.30' });
  for (let i = 0; i < 10; i++) { p.run('_invalidateSession()'); await p.run('getToken()'); }
  p.run('_invalidateSession()');
  await assert.rejects(() => p.run('getToken()'), /تجاوزت الحد/);
  p.client.ip = '192.0.2.31';
  assert.match(await p.run('getToken()'), /^v1\./);
});
