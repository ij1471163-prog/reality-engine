const { google } = require('googleapis');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { purchaseToken, packageName, subscriptionId } = req.body;
  if (!purchaseToken) return res.status(400).json({ error: 'Missing token' });

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
      scopes: ['https://www.googleapis.com/auth/androidpublisher']
    });

    const androidpublisher = google.androidpublisher({ version: 'v3', auth });

    const result = await androidpublisher.purchases.subscriptions.get({
      packageName: packageName || 'com.naif.realityengine',
      subscriptionId: subscriptionId || 'reality_engine_monthly',
      token: purchaseToken
    });

    const sub = result.data;
    const isActive = sub.paymentState === 1 && 
                     new Date(parseInt(sub.expiryTimeMillis)) > new Date();

    if (isActive) {
      // أصدر Pro session token
      const crypto = await import('crypto');
      const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
      const now = Date.now();
      const window = Math.floor(now / (60 * 60 * 1000)); // ساعة
      const proToken = crypto.createHmac('sha256', process.env.MASTER_SECRET)
        .update('pro:' + ip + ':' + window)
        .digest('hex');

      return res.status(200).json({ pro: true, token: proToken });
    } else {
      return res.status(200).json({ pro: false });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
