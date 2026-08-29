export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const master = process.env.MASTER_SECRET || '';
  if (!master) return res.status(500).end();
  // token يومي مرتبط بـ master
  const crypto = await import('crypto');
  const today = new Date().toISOString().split('T')[0];
  const token = crypto.createHmac('sha256', master).update('web_'+today).digest('hex').slice(0,16);
  res.status(200).json({ token });
}
