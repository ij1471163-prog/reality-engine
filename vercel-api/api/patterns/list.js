// api/patterns/list.js
// GET /api/patterns/list
// يُرجع approved patterns فقط — بدون بيانات داخلية
"use strict";

const REPO      = process.env.GITHUB_REPO   || 'ij1471163-prog/reality-engine';
const BRANCH    = process.env.GITHUB_BRANCH || 'repair-learning';
const FILE_PATH = process.env.PATTERNS_PATH  || 'vercel-api/public/data/patterns.json';
const TOKEN     = process.env.GITHUB_TOKEN;

const MIN_VERIFIED   = 3;
const MIN_CONFIDENCE = 0.60;
const MAX_FAILURES   = 3;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!TOKEN) return res.status(500).json({ error: 'Server misconfigured' });

  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
      { headers: { 'Authorization': `token ${TOKEN}`, 'User-Agent': 'reality-engine' } }
    );

    if (r.status === 404) return res.status(200).json({ patterns: [] });
    const data = await r.json();
    const db   = JSON.parse(Buffer.from(data.content, 'base64').toString());

    // السيرفر يتحقق — لا يثق بـ approved المخزن وحده
    const approved = (db.patterns || []).filter(p =>
      p.approved === true &&
      (p.verified  || 0) >= MIN_VERIFIED &&
      (p.confidence || 0) >= MIN_CONFIDENCE &&
      (p.failures  || 0)  <  MAX_FAILURES
    );

    // يُرجع فقط ما يحتاجه العميل
    const safe = approved.map(p => ({
      id:             p.id,
      issueType:      p.issueType,
      language:       p.language,
      signature:      p.signature,
      transformation: p.transformation,
    }));

    return res.status(200).json({ patterns: safe, count: safe.length });
  } catch(e) {
    return res.status(500).json({ error: 'Failed to load patterns' });
  }
}
