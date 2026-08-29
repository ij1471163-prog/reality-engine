const requests = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Rate limit: 3 tokens per IP per hour
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const ipReqs = (requests.get(ip) || []).filter(t => now - t < hour);
  
  if (ipReqs.length >= 10) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  
  requests.set(ip, [...ipReqs, now]);

  const master = process.env.MASTER_SECRET || '';
  if (!master) return res.status(500).end();

  // Token = HMAC(master, IP + timestamp/10min)
  const window = Math.floor(now / (10 * 60 * 1000));
  const crypto = await import('crypto');
  const token = crypto.createHmac('sha256', master)
    .update(ip + window)
    .digest('hex');

  res.status(200).json({ 
    token, 
    expiresIn: 600 // 10 دقائق
  });
}
