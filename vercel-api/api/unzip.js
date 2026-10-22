// POST /api/unzip — فكّ أرشيف ZIP على الخادم.
//
// معطّل افتراضيًا (410): لا مستدعي له — الواجهة تفكّ الأرشيف داخل المتصفح
// بـJSZip. ويُفعَّل بـUNZIP_ENABLED=1، وحينها:
//   • يتطلب رمز جلسة صالحًا (ليس مصادقة — lib/api_security.js).
//   • لا CORS مفتوح.
//   • path المُرجَع مسارٌ نسبيٌّ منقّى: لا '..' ولا جذر ولا '\'.
//   • الملف المؤقت يُحذف في كل الأحوال.
//   • لا رسالة خطأ داخلية في الرد.
// الحجم بعد الفك: يُقرأ الحجم المُعلَن ثم يُقاس الفعلي بعد getData()؛ وadm-zip
// يرفض أصلًا مُدخلًا زُوّر حجمه (فحص CRC) — مُقاس في التدقيق.
'use strict';

const fs = require('fs');
const path = require('path');
const sec = require('../lib/api_security.js');

const ALLOWED_EXTENSIONS = ['.py', '.js', '.ts', '.java', '.html', '.jsx', '.tsx', '.kt', '.php'];
const MAX_FILES = 20;
const MAX_FILE_SIZE = 500 * 1024; // 500KB

function safeRelPath(entryName) {
  const parts = String(entryName).replace(/\\/g, '/').split('/')
    .filter(p => p && p !== '.' && p !== '..' && !/[\u0000-\u001f]/.test(p));
  return parts.join('/');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (process.env.UNZIP_ENABLED !== '1') {
    return res.status(410).json({ error: 'This endpoint is disabled' });
  }
  if (!sec.requireSession(req, res)) return;

  let tmpPath = null;
  try {
    const { IncomingForm } = require('formidable');   // كسول: المسار المعطّل لا يحتاجها
    const AdmZip = require('adm-zip');
    const form = new IncomingForm({ maxFileSize: 10 * 1024 * 1024 });

    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const zipFile = files.zip?.[0] || files.zip;
    if (!zipFile) return res.status(400).json({ error: 'No ZIP file provided' });
    tmpPath = zipFile.filepath || zipFile.path || null;

    const zip = new AdmZip(tmpPath);
    const entries = zip.getEntries();

    const result = [];
    let count = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      if (count >= MAX_FILES) break;

      const ext = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) continue;
      if (entry.header.size > MAX_FILE_SIZE) continue;

      const relPath = safeRelPath(entry.entryName);
      if (!relPath) continue;

      try {
        const data = entry.getData();
        if (data.length > MAX_FILE_SIZE) continue;
        result.push({
          name: path.basename(relPath),
          path: relPath,
          content: data.toString('utf8'),
          size: data.length,
          ext: ext.slice(1),
        });
        count++;
      } catch (e) {}
    }

    res.json({
      files: result,
      total: result.length,
      skipped: entries.filter(e => !e.isDirectory).length - result.length,
    });
  } catch (err) {
    console.error('[unzip] failed:', err && err.message);
    res.status(500).json({ error: 'Could not read ZIP file' });
  } finally {
    // متزامن: بعد إرسال الرد قد تُجمَّد الدالة قبل أن يكتمل حذفٌ غير متزامن
    if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (e) {} }
  }
};

module.exports.safeRelPath = safeRelPath;
