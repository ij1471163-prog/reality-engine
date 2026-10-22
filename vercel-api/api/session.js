// POST /api/session — يُصدر رمز جلسةٍ قصيرًا مربوطًا بعنوان العميل.
// ⚠️ ليس مصادقة: أي أحدٍ يستطيع طلبه. انظر lib/api_security.js.
// شكل الرد ثابت لأن الويب وأندرويد يقرآنه: { token, expiresIn }.
'use strict';

const sec = require('../lib/api_security.js');

// احتياطيٌّ داخل نسخةٍ واحدة — ليس حماية. الحدُّ الحقيقي: قاعدة Vercel WAF.
const perIp = sec.bestEffortLimiter(10, 60 * 60 * 1000);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const master = process.env.MASTER_SECRET || '';
  if (!master) return res.status(500).json({ error: 'Server authentication is not configured' });

  const ip = sec.clientIp(req);
  if (!perIp(ip)) return res.status(429).json({ error: 'Too many requests' });

  res.status(200).json(sec.issueSessionToken(master, ip));
};
