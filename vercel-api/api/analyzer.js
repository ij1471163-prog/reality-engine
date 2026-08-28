import { sessions } from './session.js';

const RATE_LIMIT_PER_TOKEN = 20; // طلب لكل جلسة

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // تحقق من Authorization header
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();

  if (!token) {
    return res.status(401).json({ error: 'No token' });
  }

  // تحقق من الجلسة
  const session = sessions.get(token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // تحقق من انتهاء الصلاحية
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Token expired' });
  }

  // Rate limit per token
  if (session.requests >= RATE_LIMIT_PER_TOKEN) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  session.requests++;

  // أعد Gemini key
  const key = process.env.GEMINIKEY || '';
  if (!key) {
    return res.status(500).json({ error: 'No API key configured' });
  }

  res.status(200).json({ key, remaining: RATE_LIMIT_PER_TOKEN - session.requests });
}
