import crypto from 'crypto';

const sessions = new Map();
const rateLimits = new Map();

const MAX_SESSIONS_PER_IP = 5;
const SESSION_TTL = 30 * 60 * 1000; // 30 دقيقة

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  
  // Rate limit per IP
  const now = Date.now();
  const ipSessions = rateLimits.get(ip) || [];
  const recentSessions = ipSessions.filter(t => now - t < SESSION_TTL);
  
  if (recentSessions.length >= MAX_SESSIONS_PER_IP) {
    return res.status(429).json({ error: 'Too many sessions' });
  }

  // توليد token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = now + SESSION_TTL;

  sessions.set(token, { ip, expiresAt, requests: 0 });
  rateLimits.set(ip, [...recentSessions, now]);

  // تنظيف sessions منتهية
  for (const [t, s] of sessions.entries()) {
    if (now > s.expiresAt) sessions.delete(t);
  }

  res.status(200).json({ token, expiresAt });
}

export { sessions };
