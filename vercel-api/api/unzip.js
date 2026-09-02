const { IncomingForm } = require('formidable');
const AdmZip = require('adm-zip');
const path = require('path');

const ALLOWED_EXTENSIONS = ['.py', '.js', '.ts', '.java', '.html', '.jsx', '.tsx', '.kt', '.php'];
const MAX_FILES = 20;
const MAX_FILE_SIZE = 500 * 1024; // 500KB

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const form = new IncomingForm({ maxFileSize: 10 * 1024 * 1024 });

    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const zipFile = files.zip?.[0] || files.zip;
    if (!zipFile) return res.status(400).json({ error: 'No ZIP file provided' });

    const zip = new AdmZip(zipFile.filepath || zipFile.path);
    const entries = zip.getEntries();

    const result = [];
    let count = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      if (count >= MAX_FILES) break;

      const ext = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) continue;

      const size = entry.header.size;
      if (size > MAX_FILE_SIZE) continue;

      // تجنب path traversal
      const safeName = path.basename(entry.entryName);

      try {
        const content = entry.getData().toString('utf8');
        result.push({
          name: safeName,
          path: entry.entryName,
          content,
          size,
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
    res.status(500).json({ error: err.message });
  }
}
