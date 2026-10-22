// POST /api/chat — وسيطٌ إلى Gemini. يقرأ الويب result/error ويقرأ أندرويد result.
'use strict';

const sec = require('../lib/api_security.js');

const MAX_PROMPT_CHARS = 50000;
const UPSTREAM_TIMEOUT_MS = 50000;   // أقل من maxDuration (60) في vercel.json

// احتياطيٌّ داخل نسخةٍ واحدة — ليس حماية. والمفتاح عنوانُ العميل لا الرمز:
// العدُّ لكل رمزٍ مشترك كان يجعل الحدَّ عامًّا، فعشرةُ طلباتٍ من عميلٍ
// واحد تحجب الجميع.
const perIp = sec.bestEffortLimiter(10, 10 * 60 * 1000);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const geminiKey = process.env.GEMINIKEY || '';
  if (!geminiKey) return res.status(500).json({ error: 'AI is not configured' });
  if (!sec.requireSession(req, res)) return;

  if (!perIp(sec.clientIp(req))) return res.status(429).json({ error: 'Rate limit' });

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'No prompt' });
  if (prompt.length > MAX_PROMPT_CHARS) return res.status(413).json({ error: 'Prompt too large' });

  let data;
  try {
    const response = await sec.fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
      UPSTREAM_TIMEOUT_MS
    );
    data = await response.json();
  } catch (e) {
    const timedOut = e && e.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'AI timeout' : 'AI error' });
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  // ردُّ المزوّد الخام لا يُعاد للعميل: قد يحمل رقم المشروع ونوع المفتاح وتفاصيل الحصة
  if (!text) return res.status(502).json({ error: 'No response from AI' });
  res.status(200).json({ result: text });
};
