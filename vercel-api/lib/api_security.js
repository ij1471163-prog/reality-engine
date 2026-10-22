// ═══════════════════════════════════════════════════════════════════════
// lib/api_security.js — أدواتٌ مشتركة لحماية دوالّ /api
//
// خارج api/ عمدًا: Vercel يحوّل كل ملف داخل api/ إلى نقطة نهاية، وهذا
// الملف مكتبة لا مسار. ويُضمَّن في الحزمة لأن الدوالّ تطلبه بـrequire.
//
// ⚠️ حدودٌ معلنة — اقرأها قبل الاعتماد على أي دالة هنا:
//   • رمزُ الجلسة **ليس مصادقة**. أيُّ أحدٍ يستطيع طلبه من /api/session.
//     ربطُه بالـIP وانتهاؤه بعد 600 ثانية يمنعان مشاركته وإعادة استعماله
//     من مكانٍ آخر، ويفصلان عدّاد كل عميل عن غيره — لا أكثر.
//   • bestEffortLimiter يعيش في ذاكرة نسخةٍ واحدة من الدالة: يُصفَّر مع كل
//     تشغيلٍ بارد، ولا يرى النسخ الأخرى. **ليس حماية** ولا يُعتمد عليه.
//     الحدُّ الحقيقي المشترك بين النسخ: قاعدة Vercel WAF من لوحة المشروع،
//     وحصّة مفتاح Gemini في Google Cloud.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');

const SESSION_TTL_SEC = 600;          // يطابق expiresIn الذي يقرؤه الويب وأندرويد
const SESSION_CLOCK_SKEW_SEC = 5;     // سماحٌ صغير لاختلاف ساعات النسخ
const TOKEN_RE = /^v1\.(\d{10})\.([0-9a-f]{64})$/;

// ─── عنوان العميل ──────────────────────────────────────────────────────
// على Vercel: x-real-ip وx-vercel-forwarded-for يضبطهما المنصّة نفسها،
// وx-forwarded-for يُعاد كتابته ولا يُمرَّر ما يرسله العميل.
// IPv6 يُطبَّع إلى /64: عناوين الخصوصية تتبدّل داخل الشبكة نفسها.
function normalizeIp(raw) {
  let ip = String(raw || '').trim();
  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7);   // IPv4 داخل IPv6
  if (!ip.includes(':')) return ip;
  const zoneless = ip.split('%')[0].toLowerCase();
  const [head, tail] = zoneless.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = tail !== undefined ? Array(Math.max(0, 8 - h.length - t.length)).fill('0') : [];
  const full = h.concat(fill, t).map(x => (x || '0').replace(/^0+(?=.)/, ''));
  return full.slice(0, 4).join(':') + '::/64';
}

function clientIp(req) {
  const h = (req && req.headers) || {};
  const pick = v => String(Array.isArray(v) ? v[0] : v || '').split(',')[0].trim();
  const raw = pick(h['x-real-ip']) || pick(h['x-vercel-forwarded-for']) || pick(h['x-forwarded-for']) ||
              (req && req.socket && req.socket.remoteAddress) || '';
  return normalizeIp(raw);
}

function bearer(req) {
  const auth = String(((req && req.headers) || {}).authorization || '');
  const m = auth.match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : '';
}

// مقارنةٌ بزمنٍ ثابت لا تكشف الطول: تُقارَن بصمتا HMAC لا النصّان
function safeEqual(a, b) {
  const k = crypto.randomBytes(32);
  const ha = crypto.createHmac('sha256', k).update(String(a)).digest();
  const hb = crypto.createHmac('sha256', k).update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ─── رمز الجلسة ────────────────────────────────────────────────────────
// مفتاحٌ مشتقّ من MASTER_SECRET لهذا الغرض وحده (فصلُ نطاقات)، فلا يُنتج
// رمزٌ هنا ما يصلح توقيعًا في مكانٍ آخر يستعمل السرّ نفسه (webtoken مثلًا).
function sessionKey(master) {
  return crypto.createHmac('sha256', master).update('reality-engine/session-token/v1').digest();
}
function sign(master, exp, ip) {
  return crypto.createHmac('sha256', sessionKey(master)).update('v1|' + exp + '|' + ip).digest('hex');
}

function issueSessionToken(master, ip, nowMs) {
  const exp = Math.floor((nowMs == null ? Date.now() : nowMs) / 1000) + SESSION_TTL_SEC;
  return { token: 'v1.' + exp + '.' + sign(master, exp, ip), expiresIn: SESSION_TTL_SEC };
}

// يُرجع { ok:true } أو { ok:false, reason } — والسبب للاختبارات والسجلّ لا للعميل
function verifySessionToken(token, master, ip, nowMs) {
  if (!master) return { ok: false, reason: 'not_configured' };
  const m = TOKEN_RE.exec(String(token || ''));
  if (!m) return { ok: false, reason: 'malformed' };
  const exp = Number(m[1]);
  const now = Math.floor((nowMs == null ? Date.now() : nowMs) / 1000);
  if (exp <= now - SESSION_CLOCK_SKEW_SEC) return { ok: false, reason: 'expired' };
  if (exp > now + SESSION_TTL_SEC + SESSION_CLOCK_SKEW_SEC) return { ok: false, reason: 'bad_expiry' };
  if (!safeEqual(m[2], sign(master, exp, ip))) return { ok: false, reason: 'bad_signature' };
  return { ok: true };
}

// يكتب الرد ويُرجع false إن لم يصلح الرمز
function requireSession(req, res) {
  const master = process.env.MASTER_SECRET || '';
  if (!master) { res.status(500).json({ error: 'Server authentication is not configured' }); return false; }
  const token = bearer(req);
  if (!token) { res.status(401).json({ error: 'No token' }); return false; }
  const v = verifySessionToken(token, master, clientIp(req));
  if (!v.ok) { res.status(401).json({ error: 'Invalid token' }); return false; }
  return true;
}

// ─── سرّ الخادم (للكتابة) ─────────────────────────────────────────────
// يفشل مغلقًا: متغيّر البيئة غير مضبوط ⇒ المسار معطّل (503) لا مفتوح.
function requireServerSecret(req, res, envName) {
  const secret = process.env[envName] || '';
  if (!secret) { res.status(503).json({ error: 'This endpoint is disabled' }); return false; }
  const token = bearer(req);
  if (!token || !safeEqual(token, secret)) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

// ─── حدٌّ احتياطي داخل ذاكرة نسخةٍ واحدة — ليس حماية (انظر الترويسة) ──
function bestEffortLimiter(limit, windowMs) {
  const hits = new Map();
  return function hit(key, nowMs) {
    const now = nowMs == null ? Date.now() : nowMs;
    const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (recent.length >= limit) { hits.set(key, recent); return false; }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 10000) hits.delete(hits.keys().next().value);   // لا نموّ بلا حد
    return true;
  };
}

// ─── fetch بمهلة ───────────────────────────────────────────────────────
async function fetchWithTimeout(url, opts, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, Object.assign({}, opts, { signal: ac.signal })); }
  finally { clearTimeout(timer); }
}

module.exports = {
  SESSION_TTL_SEC, normalizeIp, clientIp, bearer, safeEqual,
  issueSessionToken, verifySessionToken, requireSession, requireServerSecret,
  bestEffortLimiter, fetchWithTimeout,
};
