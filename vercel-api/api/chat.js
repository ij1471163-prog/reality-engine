const chatLimits = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'No token' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  const master = process.env.MASTER_SECRET || '';
  const geminiKey = process.env.GEMINIKEY || '';
  
  if (!master || !geminiKey) return res.status(500).end();

  // تحقق من token — HMAC(master, IP + window)
  const now = Date.now();
  const crypto = await import('crypto');
  let valid = false;
  
  // تحقق من النافذة الحالية والسابقة
  for (let w = 0; w <= 1; w++) {
    const window = Math.floor(now / (10 * 60 * 1000)) - w;
    const expected = crypto.createHmac('sha256', master)
      .update(ip + window)
      .digest('hex');
    if (token === expected) { valid = true; break; }
  }

  if (!valid) return res.status(401).json({ error: 'Invalid token' });

  // Rate limit: 10 requests per token per 10min
  const limits = (chatLimits.get(token) || []).filter(t => now - t < 600000);
  if (limits.length >= 10) return res.status(429).json({ error: 'Rate limit' });
  chatLimits.set(token, [...limits, now]);

  // حد الـ prompt
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'No prompt' });
  if (prompt.length > 50000) return res.status(400).json({ error: 'Prompt too large' });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return res.status(502).json({ error: 'No response from AI' });
    res.status(200).json({ result: text });
  } catch (e) {
    res.status(502).json({ error: 'AI error' });
  }
}
