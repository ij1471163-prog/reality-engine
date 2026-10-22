// POST /api/verify-purchase — التحقق من اشتراك Google Play.
//
// معطّل افتراضيًا (503): ميزة Pro لا مستهلك لها في الويب ولا أندرويد،
// والمكتبة googleapis ليست في package.json فكان تحميلُ الملف نفسه يسقط.
// لا تُضاف المكتبة هنا: التفعيل قرارٌ منفصل يتطلب
//   PURCHASE_VERIFICATION_ENABLED=1 + GOOGLE_SERVICE_ACCOUNT + googleapis في package.json.
//
// ما تغيّر عن السابق حتى لو فُعِّل:
//   • packageName وsubscriptionId ثابتان في الخادم — لا يختارهما العميل.
//   • لا رمز Pro في الرد: كان يُصدَر ولا شيء يتحقق منه.
//   • لا رسالة خطأ خام من Google في الرد.
'use strict';

const PACKAGE_NAME = 'com.naif.realityengine';
const SUBSCRIPTION_ID = 'reality_engine_monthly';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (process.env.PURCHASE_VERIFICATION_ENABLED !== '1') {
    return res.status(503).json({ error: 'Purchase verification is disabled' });
  }

  const { purchaseToken } = req.body || {};
  if (typeof purchaseToken !== 'string' || !purchaseToken || purchaseToken.length > 4096) {
    return res.status(400).json({ error: 'Missing token' });
  }

  let google, credentials;
  try {
    ({ google } = require('googleapis'));   // كسول: غيابها لا يُسقط تحميل الملف
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '');
  } catch (e) {
    console.error('[verify-purchase] not configured:', e && e.message);
    return res.status(503).json({ error: 'Purchase verification is not configured' });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    const androidpublisher = google.androidpublisher({ version: 'v3', auth });
    const result = await androidpublisher.purchases.subscriptions.get({
      packageName: PACKAGE_NAME,
      subscriptionId: SUBSCRIPTION_ID,
      token: purchaseToken,
    });

    const sub = result.data || {};
    const isActive = sub.paymentState === 1 &&
                     new Date(parseInt(sub.expiryTimeMillis, 10)) > new Date();
    return res.status(200).json({ pro: isActive });
  } catch (e) {
    console.error('[verify-purchase] failed:', e && e.message);
    return res.status(502).json({ error: 'Purchase verification failed' });
  }
};
