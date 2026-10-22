// POST /api/analyzer — معطّل.
// كان يُرجع مفتاح Gemini الخام لحامل ANALYZER_SECRET. لا مستدعي له في
// المستودع، ومفتاحٌ يغادر الخادم لا يُستردّ. فالمسار يُرجع 410 دائمًا،
// ولا يقرأ أي سرٍّ من البيئة أصلًا — فلا مسار في الكود يمكن أن يُخرج المفتاح.
// (التنفيذ السابق في تاريخ git قبل هذا التعديل.)
'use strict';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  res.status(410).json({ error: 'This endpoint has been disabled' });
};
