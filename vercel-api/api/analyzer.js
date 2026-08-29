export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();

  // تحقق من التوكن — نفس السر المخزن في env
  const secret = process.env.ANALYZER_SECRET || '';
  if (!secret || token !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const key = process.env.GEMINIKEY || '';
  if (!key) {
    return res.status(500).json({ error: 'No API key' });
  }

  res.status(200).json({ key });
}
