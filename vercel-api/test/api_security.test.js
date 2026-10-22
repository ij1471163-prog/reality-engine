// ═══════════════════════════════════════════════════════════════════════
// [API-SEC] حماية دوالّ /api — كل نتيجة من التدقيق الأمني باختبارٍ يمنعها
// تشغيل:  node --test vercel-api/test/api_security.test.js
//
// محلي بالكامل: أسرار وهمية، fetch وهمي (Gemini/GitHub في الذاكرة)، ولا شبكة.
// ما لا يُغلَق في الكود يُعلن هنا لا يُخفى:
//   • رمز /api/session ليس مصادقة — أي أحدٍ يطلبه. ربطُه بالـIP وانتهاؤه
//     يمنعان مشاركته ويفصلان العدّادات، لا أكثر.
//   • الحدود داخل الذاكرة احتياطية لنسخةٍ واحدة. الحدُّ المشترك الحقيقي:
//     قاعدة Vercel WAF من اللوحة + حصّة مفتاح Gemini في Google Cloud.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');

const H   = require('./helpers/api_harness.js');
const sec = require('../lib/api_security.js');

const ROOT = path.join(__dirname, '..');
const ipHdr = ip => ({ 'x-real-ip': ip });
const auth = (tok, ip) => Object.assign({ authorization: 'Bearer ' + tok }, ipHdr(ip));
const oldWindowToken = w => crypto.createHmac('sha256', H.FAKE.MASTER_SECRET)
  .update('web_' + (Math.floor(Date.now() / 600000) - w)).digest('hex');

async function sessionFor(ip, session) {
  const r = await H.call(session || H.fresh('session.js'), { headers: ipHdr(ip) });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  return r.body.token;
}

// ═══ 1. المكتبة ════════════════════════════════════════════════════════
test('[LIB] الرمز: صيغة v1، صالح لعنوانه وحده، ينتهي بعد 600 ثانية بالضبط', () => {
  const m = H.FAKE.MASTER_SECRET, now = Date.now();
  const { token, expiresIn } = sec.issueSessionToken(m, '1.2.3.4', now);
  assert.match(token, /^v1\.\d{10}\.[0-9a-f]{64}$/);
  assert.strictEqual(expiresIn, 600);
  assert.deepStrictEqual(sec.verifySessionToken(token, m, '1.2.3.4', now), { ok: true });
  assert.strictEqual(sec.verifySessionToken(token, m, '1.2.3.5', now).reason, 'bad_signature');
  assert.strictEqual(sec.verifySessionToken(token, m, '1.2.3.4', now + 606 * 1000).reason, 'expired');
  assert.strictEqual(sec.verifySessionToken(token, 'other-master', '1.2.3.4', now).reason, 'bad_signature');
  assert.strictEqual(sec.verifySessionToken(token, '', '1.2.3.4', now).reason, 'not_configured');
});

test('[LIB] التلاعب: تغيير exp، تمديدٌ بعيد، صيغةٌ قديمة، أحرفٌ زائدة — كلها مرفوضة', () => {
  const m = H.FAKE.MASTER_SECRET, now = Date.now();
  const { token } = sec.issueSessionToken(m, '1.2.3.4', now);
  const [v, exp, sig] = token.split('.');
  assert.strictEqual(sec.verifySessionToken([v, Number(exp) - 60, sig].join('.'), m, '1.2.3.4', now).reason, 'bad_signature');
  const far = Math.floor(now / 1000) + 86400;
  const forgedFar = 'v1.' + far + '.' + crypto.createHmac('sha256', crypto.createHmac('sha256', m).update('reality-engine/session-token/v1').digest()).update('v1|' + far + '|1.2.3.4').digest('hex');
  assert.strictEqual(sec.verifySessionToken(forgedFar, m, '1.2.3.4', now).reason, 'bad_expiry', 'رمزٌ صلاحيته يوم يُقبل');
  assert.strictEqual(sec.verifySessionToken(oldWindowToken(0), m, '1.2.3.4', now).reason, 'malformed');
  assert.strictEqual(sec.verifySessionToken(token + 'x', m, '1.2.3.4', now).reason, 'malformed');
  assert.strictEqual(sec.verifySessionToken(' ' + token, m, '1.2.3.4', now).reason, 'malformed');
});

test('[LIB] العنوان: x-real-ip أولًا، IPv6 يُطبَّع إلى /64، وبلا ترويسة يُستعمل المقبس', () => {
  assert.strictEqual(sec.clientIp({ headers: { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '6.6.6.6' } }), '9.9.9.9');
  assert.strictEqual(sec.clientIp({ headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' } }), '6.6.6.6');
  assert.strictEqual(sec.clientIp({ headers: {}, socket: { remoteAddress: '::ffff:127.0.0.1' } }), '127.0.0.1');
  assert.strictEqual(sec.clientIp({ headers: {} }), 'unknown');
  const a = sec.normalizeIp('2001:db8:abcd:12:1111:2222:3333:4444');
  const b = sec.normalizeIp('2001:0db8:abcd:0012::99');
  assert.strictEqual(a, '2001:db8:abcd:12::/64');
  assert.strictEqual(a, b, 'عنوانا خصوصية في الشبكة نفسها يجب أن يتطابقا');
  assert.notStrictEqual(sec.normalizeIp('2001:db8:abcd:13::1'), a);
  assert.strictEqual(sec.normalizeIp('::1'), '0:0:0:0::/64');
});

test('[LIB] safeEqual وbearer', () => {
  assert.strictEqual(sec.safeEqual('abc', 'abc'), true);
  assert.strictEqual(sec.safeEqual('abc', 'abcd'), false);
  assert.strictEqual(sec.bearer({ headers: { authorization: 'Bearer  tok ' } }), 'tok');
  assert.strictEqual(sec.bearer({ headers: { authorization: 'tok' } }), '');
  assert.strictEqual(sec.bearer({ headers: { authorization: 'Bearer a b' } }), '');
});

test('[LIB] fetchWithTimeout يُلغي الطلب المعلّق', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  try {
    await assert.rejects(() => sec.fetchWithTimeout('https://x.invalid', {}, 30), e => e.name === 'AbortError');
  } finally { globalThis.fetch = saved; }
});

// ═══ 2. session/chat — S1، S3، S4، S8/S9 ═══════════════════════════════
test('[S1] رمز session يفتح chat من العنوان نفسه فقط — ومن عنوانٍ آخر 401 (لا مشاركة)', async () => {
  const chat = H.fresh('chat.js');
  const tok = await sessionFor('203.0.113.5');
  const ok = await H.call(chat, { headers: auth(tok, '203.0.113.5'), body: { prompt: 'hi' } });
  assert.strictEqual(ok.statusCode, 200);
  assert.strictEqual(ok.body.result, 'GEMINI-OK');
  const other = await H.call(chat, { headers: auth(tok, '203.0.113.6'), body: { prompt: 'hi' } });
  assert.strictEqual(other.statusCode, 401);
});

test('[S3] رمزُ النافذة السابقة/الحالية بالصيغة القديمة لم يعد يُقبل، والرمز ينتهي بعد 600 ثانية', async (t) => {
  t.after(H.resetClock);
  const chat = H.fresh('chat.js');
  for (const w of [0, 1]) {
    const r = await H.call(chat, { headers: auth(oldWindowToken(w), '203.0.113.7'), body: { prompt: 'p' } });
    assert.strictEqual(r.statusCode, 401, 'رمز النافذة ' + w + ' قُبل');
  }
  const tok = await sessionFor('203.0.113.7');
  H.advance(606);
  const late = await H.call(chat, { headers: auth(tok, '203.0.113.7'), body: { prompt: 'p' } });
  assert.strictEqual(late.statusCode, 401, 'رمزٌ منتهٍ قُبل');
});

test('[S8/S9] عشرةُ نداءاتٍ من عميلٍ لا تحجب عميلًا آخر (كان العدُّ لكل رمزٍ مشترك = عام)', async () => {
  const chat = H.fresh('chat.js'), session = H.fresh('session.js');
  const a = await sessionFor('198.51.100.1', session), b = await sessionFor('198.51.100.2', session);
  const codes = [];
  for (let i = 0; i < 11; i++) codes.push((await H.call(chat, { headers: auth(a, '198.51.100.1'), body: { prompt: 'x' } })).statusCode);
  assert.deepStrictEqual(codes.slice(0, 10), Array(10).fill(200));
  assert.strictEqual(codes[10], 429, 'الحد الاحتياطي لم يعمل للعميل نفسه');
  const rb = await H.call(chat, { headers: auth(b, '198.51.100.2'), body: { prompt: 'x' } });
  assert.strictEqual(rb.statusCode, 200, 'عميلٌ آخر حُجب بعدّاد غيره');
});

test('[S4] خطأ المزوّد لا يُعاد للعميل: لا debug ولا نصّ Google', async (t) => {
  const saved = H.net.gemini;
  t.after(() => { H.net.gemini = saved; });
  H.net.gemini = () => ({ status: 403, body: { error: { code: 403, message: 'Permission denied on resource project projects/123456789', status: 'PERMISSION_DENIED' } } });
  const tok = await sessionFor('192.0.2.44');
  const r = await H.call(H.fresh('chat.js'), { headers: auth(tok, '192.0.2.44'), body: { prompt: 'p' } });
  assert.strictEqual(r.statusCode, 502);
  assert.deepStrictEqual(Object.keys(r.body), ['error']);
  assert.doesNotMatch(JSON.stringify(r.body), /123456789|PERMISSION_DENIED|debug/);
});

test('[S3-cost] حدود chat عديمة الحالة: الطلب > 50,000 حرف ⇒ 413 بلا نداء Gemini، والنداء يحمل مهلة', async () => {
  const tok = await sessionFor('192.0.2.45');
  const chat = H.fresh('chat.js');
  const before = H.net.calls.length;
  const big = await H.call(chat, { headers: auth(tok, '192.0.2.45'), body: { prompt: 'x'.repeat(50001) } });
  assert.strictEqual(big.statusCode, 413);
  assert.strictEqual(H.net.calls.length, before, 'خرج نداءٌ إلى Gemini لطلبٍ مرفوض');
  await H.call(chat, { headers: auth(tok, '192.0.2.45'), body: { prompt: 'ok' } });
  assert.strictEqual(H.net.calls[H.net.calls.length - 1].hasSignal, true, 'نداء Gemini بلا مهلة');
});

test('[S3-cost] مهلةُ Gemini تنتهي ⇒ 504 عام', async (t) => {
  const saved = H.net.gemini;
  t.after(() => { H.net.gemini = saved; });
  H.net.gemini = () => { throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }); };
  const tok = await sessionFor('192.0.2.46');
  const r = await H.call(H.fresh('chat.js'), { headers: auth(tok, '192.0.2.46'), body: { prompt: 'p' } });
  assert.strictEqual(r.statusCode, 504);
  assert.deepStrictEqual(r.body, { error: 'AI timeout' });
});

test('[S2] حد session الاحتياطي لكل عنوان، وغياب MASTER_SECRET يفشل مغلقًا', async (t) => {
  const session = H.fresh('session.js');
  for (let i = 0; i < 10; i++) assert.strictEqual((await H.call(session, { headers: ipHdr('198.51.100.7') })).statusCode, 200);
  assert.strictEqual((await H.call(session, { headers: ipHdr('198.51.100.7') })).statusCode, 429);
  assert.strictEqual((await H.call(session, { headers: ipHdr('198.51.100.8') })).statusCode, 200);
  const saved = process.env.MASTER_SECRET;
  t.after(() => { process.env.MASTER_SECRET = saved; });
  delete process.env.MASTER_SECRET;
  assert.strictEqual((await H.call(H.fresh('session.js'), { headers: ipHdr('198.51.100.9') })).statusCode, 500);
  assert.strictEqual((await H.call(H.fresh('chat.js'), { headers: auth('v1.9999999999.' + 'a'.repeat(64), '1.1.1.1'), body: { prompt: 'p' } })).statusCode, 500);
});

// ═══ 3. analyzer — S5 ═══════════════════════════════════════════════════
test('[S5] /api/analyzer لا يُرجع المفتاح أبدًا — ولا يقرؤه', async () => {
  const analyzer = H.fresh('analyzer.js');
  for (const hdr of [{ authorization: 'Bearer ' + H.FAKE.ANALYZER_SECRET }, {}]) {
    const r = await H.call(analyzer, { headers: hdr });
    assert.strictEqual(r.statusCode, 410);
    assert.doesNotMatch(JSON.stringify(r.body), new RegExp(H.FAKE.GEMINIKEY));
  }
  const src = fs.readFileSync(path.join(H.API, 'analyzer.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /process\.env/, 'analyzer.js ما زال يقرأ البيئة');
});

// ═══ 4. analyze — S7 ════════════════════════════════════════════════════
test('[S7] analyze: حدود الحجم والاسم قبل أي تحليل', async () => {
  const analyze = H.fresh('analyze.js');
  const ip = '203.0.113.30';
  const tok = await sessionFor(ip);
  const go = body => H.call(analyze, { headers: auth(tok, ip), body });
  assert.strictEqual((await go({ code: 'x'.repeat(100 * 1024 + 1), fileName: 'a.js' })).statusCode, 413);
  assert.strictEqual((await go({ code: 'x'.repeat(10 * 1024 + 1), fileName: 'a.js', fix: true })).statusCode, 413);
  assert.strictEqual((await go({ code: 'var a=1;', fileName: 'a'.repeat(256) })).statusCode, 400);
  assert.strictEqual((await go({ code: 'var a=1;', fileName: 'a\n.js' })).statusCode, 400);
  assert.strictEqual((await go({ code: { length: 1 }, fileName: 'a.js' })).statusCode, 400);
  assert.strictEqual((await H.call(analyze, { headers: auth(oldWindowToken(0), ip), body: { code: 'x', fileName: 'a.js' } })).statusCode, 401);
});

test('[S7] analyze: الرد بالحقول التي يقرؤها أندرويد، والمنسّق ملخّص، ولا CORS مفتوح', async () => {
  const analyze = H.fresh('analyze.js');
  const ip = '203.0.113.31';
  const tok = await sessionFor(ip);
  const code = 'const password = "hunter2hunter2hunter2";\nmodule.exports = password;\n';
  const r = await H.call(analyze, { headers: auth(tok, ip), body: { code, fileName: 'a.js', fix: true } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  for (const k of ['score', 'stats', 'issues']) assert.ok(k in r.body, 'الحقل ' + k + ' غاب');
  assert.ok(['total', 'critical', 'high'].every(k => typeof r.body.stats[k] === 'number'));
  assert.deepStrictEqual(Object.keys(r.body.orchestrator).sort(), ['decision', 'reason']);
  assert.strictEqual(r.headers['access-control-allow-origin'], undefined);
  const noFix = await H.call(analyze, { headers: auth(tok, ip), body: { code, fileName: 'a.js', fix: false } });
  assert.strictEqual(noFix.body.orchestrator, undefined);
});

test('[S7] analyze: لا e.message ولا تفاصيل داخلية في ردود 500', () => {
  const src = fs.readFileSync(path.join(H.API, 'analyze.js'), 'utf8');
  const responses = src.match(/res\.status\(500\)\.json\([^)]*\)/g) || [];
  assert.ok(responses.length >= 3);
  for (const r of responses) assert.doesNotMatch(r, /e\.message|details\s*:|available\s*:|engineLoadErrors/, r);
});

// ═══ 5. patterns — G1–G3 ════════════════════════════════════════════════
test('[G1-G3] save/verify بلا PATTERNS_WRITE_SECRET ⇒ 503 معطّل، ولا قراءة ولا كتابة على GitHub', async () => {
  delete process.env.PATTERNS_WRITE_SECRET;
  const before = H.net.calls.length, puts = H.net.github.puts;
  const save = H.fresh('patterns/save.js'), verify = H.fresh('patterns/verify.js');
  const s = await H.call(save, { body: { originalCode: 'a', fixedCode: 'b', fileName: 'a.js', pattern: {}, sessionId: 'rotating-session-1' } });
  const v = await H.call(verify, { body: { patternId: 'p', success: true, resultId: 'forged-result-0-xxxxxxxx' } });
  assert.strictEqual(s.statusCode, 503);
  assert.strictEqual(v.statusCode, 503);
  assert.strictEqual(H.net.calls.length, before, 'خرج نداءٌ إلى GitHub');
  assert.strictEqual(H.net.github.puts, puts);
});

test('[G1-G3] مع السرّ مضبوطًا: بلا ترخيص أو بترخيصٍ خاطئ أو برمز جلسة ⇒ 401 بلا لمس GitHub', async (t) => {
  process.env.PATTERNS_WRITE_SECRET = 'patterns-secret-NOT-REAL';
  t.after(() => { delete process.env.PATTERNS_WRITE_SECRET; });
  const save = H.fresh('patterns/save.js'), verify = H.fresh('patterns/verify.js');
  const sessionTok = await sessionFor('203.0.113.40');
  const before = H.net.calls.length;
  for (const hdr of [{}, { authorization: 'Bearer wrong' }, { authorization: 'Bearer ' + sessionTok }, { authorization: 'patterns-secret-NOT-REAL' }]) {
    const s = await H.call(save, { headers: hdr, body: { originalCode: 'a', fixedCode: 'b', fileName: 'a.js', pattern: {}, sessionId: 'rotating-session-2' } });
    const v = await H.call(verify, { headers: hdr, body: { patternId: 'p', success: true, resultId: 'forged-result-1-xxxxxxxx' } });
    assert.strictEqual(s.statusCode, 401, JSON.stringify(hdr));
    assert.strictEqual(v.statusCode, 401, JSON.stringify(hdr));
  }
  assert.strictEqual(H.net.calls.length, before, 'خرج نداءٌ إلى GitHub قبل التحقق');
  // بالسرّ الصحيح يتجاوز طبقة الترخيص (ما بعدها تغطّيه اختبارات verify القائمة)
  const ok = await H.call(verify, { headers: { authorization: 'Bearer patterns-secret-NOT-REAL' }, body: { patternId: 'p', success: true, resultId: 'forged-result-2-xxxxxxxx' } });
  assert.ok(![401, 503].includes(ok.statusCode), 'السرّ الصحيح رُفض: ' + ok.statusCode);
});

// ═══ 6. verify-purchase — P1–P3 ═════════════════════════════════════════
function withFakeGoogleapis(fn) {
  const orig = Module._load;
  const seen = { query: null, throwMsg: null };
  Module._load = function (req) {
    if (req === 'googleapis') return { google: {
      auth: { GoogleAuth: function () {} },
      androidpublisher: () => ({ purchases: { subscriptions: { get: async q => {
        seen.query = q; if (seen.throwMsg) throw new Error(seen.throwMsg);
        return { data: { paymentState: 1, expiryTimeMillis: String(Date.now() + 864e5) } }; } } } }),
    } };
    return orig.apply(this, arguments);
  };
  return Promise.resolve(fn(seen)).finally(() => { Module._load = orig; });
}

test('[P1] verify-purchase معطّل افتراضيًا، ويُحمَّل بلا googleapis، ولا مكتبة جديدة في package.json', async () => {
  delete process.env.PURCHASE_VERIFICATION_ENABLED;
  const vp = H.fresh('verify-purchase.js');          // كان require('googleapis') أعلى الملف يُسقط التحميل
  const r = await H.call(vp, { body: { purchaseToken: 'x' } });
  assert.strictEqual(r.statusCode, 503);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(pkg.dependencies).sort(), ['adm-zip', 'formidable']);
});

test('[P1] مفعّلًا بلا googleapis أو بلا حساب خدمة ⇒ 503 «غير مضبوط» لا انهيار', async (t) => {
  process.env.PURCHASE_VERIFICATION_ENABLED = '1';
  t.after(() => { delete process.env.PURCHASE_VERIFICATION_ENABLED; delete process.env.GOOGLE_SERVICE_ACCOUNT; });
  const r = await H.call(H.fresh('verify-purchase.js'), { body: { purchaseToken: 'x' } });
  assert.strictEqual(r.statusCode, 503);
  assert.deepStrictEqual(r.body, { error: 'Purchase verification is not configured' });
});

test('[P2/P3] مفعّلًا (googleapis وهمية): الحزمة والاشتراك ثابتان، لا رمز Pro، ولا خطأ Google خام', async (t) => {
  process.env.PURCHASE_VERIFICATION_ENABLED = '1';
  process.env.GOOGLE_SERVICE_ACCOUNT = '{"type":"service_account","fake":true}';
  t.after(() => { delete process.env.PURCHASE_VERIFICATION_ENABLED; delete process.env.GOOGLE_SERVICE_ACCOUNT; });
  await withFakeGoogleapis(async seen => {
    const vp = H.fresh('verify-purchase.js');
    const r1 = await H.call(vp, { body: { purchaseToken: 'x', packageName: 'com.other.app', subscriptionId: 'other_sku' } });
    assert.strictEqual(r1.statusCode, 200);
    assert.strictEqual(seen.query.packageName, 'com.naif.realityengine');
    assert.strictEqual(seen.query.subscriptionId, 'reality_engine_monthly');
    assert.deepStrictEqual(r1.body, { pro: true });
    seen.throwMsg = 'Request had invalid authentication credentials. project_number:987654';
    const r2 = await H.call(vp, { body: { purchaseToken: 'x' } });
    assert.strictEqual(r2.statusCode, 502);
    assert.doesNotMatch(JSON.stringify(r2.body), /987654|credentials/);
  });
});

// ═══ 7. unzip — U1، U3، U4 ══════════════════════════════════════════════
test('[U1] unzip معطّل افتراضيًا (410) بلا CORS، ومفعّلًا يتطلب رمز جلسة', async (t) => {
  delete process.env.UNZIP_ENABLED;
  const r = await H.call(H.fresh('unzip.js'), {});
  assert.strictEqual(r.statusCode, 410);
  assert.strictEqual(r.headers['access-control-allow-origin'], undefined);
  process.env.UNZIP_ENABLED = '1';
  t.after(() => { delete process.env.UNZIP_ENABLED; });
  const r2 = await H.call(H.fresh('unzip.js'), { headers: ipHdr('203.0.113.50') });
  assert.strictEqual(r2.statusCode, 401);
});

test('[U3] المسار المُرجَع نسبيٌّ منقّى', () => {
  const { safeRelPath } = require('../api/unzip.js');
  assert.strictEqual(safeRelPath('../../etc/evil.js'), 'etc/evil.js');
  assert.strictEqual(safeRelPath('/abs/a.js'), 'abs/a.js');
  assert.strictEqual(safeRelPath('a\\..\\..\\b.js'), 'a/b.js');
  assert.strictEqual(safeRelPath('src/./x/../y.js'), 'src/x/y.js');
  assert.strictEqual(safeRelPath('../..'), '');
});

// المسار المفعّل كاملًا يحتاج adm-zip وformidable. غير مثبّتتين في المستودع،
// فيُشغَّل حين تُعطى مساراتهما بـAPI_TEST_DEPS (مجلد node_modules) ويُتخطّى صراحةً غير ذلك.
const DEPS = process.env.API_TEST_DEPS || '';
const depsOk = !!DEPS && ['adm-zip', 'formidable'].every(d => { try { require.resolve(d, { paths: [DEPS] }); return true; } catch (e) { return false; } });

test('[U3/U4] unzip مفعّلًا: path منقّى، والملف المؤقت يُحذف', { skip: depsOk ? false : 'API_TEST_DEPS غير مضبوط (adm-zip/formidable)' }, async (t) => {
  process.env.UNZIP_ENABLED = '1';
  const orig = Module._load;
  Module._load = function (req) {
    if (req === 'adm-zip' || req === 'formidable') return orig.call(this, require.resolve(req, { paths: [DEPS] }), arguments[1], arguments[2]);
    return orig.apply(this, arguments);
  };
  t.after(() => { Module._load = orig; delete process.env.UNZIP_ENABLED; });
  const AdmZip = require(require.resolve('adm-zip', { paths: [DEPS] }));
  const z = new AdmZip();
  z.addFile('ok.js', Buffer.from('var a = 1;'));
  z.addFile('../../etc/evil.js', Buffer.from('x'));
  const zipBuf = z.toBuffer();
  const boundary = '----apisec';
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="zip"; filename="a.zip"\r\nContent-Type: application/zip\r\n\r\n`), zipBuf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const { Readable } = require('stream');
  const ip = '203.0.113.51';
  const tok = await sessionFor(ip);
  const req = Readable.from([body]);
  Object.assign(req, { method: 'POST', headers: Object.assign(auth(tok, ip), { 'content-type': 'multipart/form-data; boundary=' + boundary, 'content-length': String(body.length) }) });
  const res = H.mkRes();
  const tmpBefore = new Set(fs.readdirSync(os.tmpdir()));
  await H.fresh('unzip.js')(req, res);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  const evil = res.body.files.find(f => f.name === 'evil.js');
  assert.strictEqual(evil.path, 'etc/evil.js');
  assert.ok(res.body.files.every(f => !f.path.includes('..')));
  assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
  const leftovers = fs.readdirSync(os.tmpdir()).filter(f => !tmpBefore.has(f));
  assert.deepStrictEqual(leftovers, [], 'بقي ملفٌ مؤقت');
});

// ═══ 8. إعداد Vercel ════════════════════════════════════════════════════
test('[CFG] vercel.json: maxDuration لكل دالة ≤ 60، وincludeFiles باقٍ', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const files = [];
  (function walk(d, rel) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p, rel + f + '/');
      else if (f.endsWith('.js')) files.push('api/' + rel + f);
    }
  })(H.API, '');
  for (const f of files) {
    const fc = cfg.functions[f];
    assert.ok(fc && Number.isInteger(fc.maxDuration) && fc.maxDuration <= 60, f + ' بلا maxDuration مناسب');
  }
  assert.strictEqual(cfg.functions['api/analyze.js'].includeFiles, 'public/**');
  assert.strictEqual(cfg.functions['api/patterns/save.js'].includeFiles, 'public/**');
});

test('[NET] لا نداء شبكة خارج Gemini/GitHub الوهميين في هذا الملف', () => {
  assert.ok(H.net.calls.every(c => /generativelanguage\.googleapis\.com|api\.github\.com/.test(c.url)));
});
