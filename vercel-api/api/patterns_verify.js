// api/patterns/verify.js
// POST /api/patterns/verify
// يستقبل patternId + Ghost verdict الفعلي
// يحدث verified/failures/confidence على السيرفر فقط
"use strict";

const REPO      = process.env.GITHUB_REPO   || 'ij1471163-prog/reality-engine';
const BRANCH    = process.env.GITHUB_BRANCH || 'repair-learning';
const FILE_PATH = process.env.PATTERNS_PATH  || 'vercel-api/public/data/patterns.json';
const TOKEN     = process.env.GITHUB_TOKEN;

const MIN_VERIFIED   = 3;
const MIN_CONFIDENCE = 0.60;
const MAX_FAILURES   = 3;
const MAX_VERIFIES_PER_SESSION = 5; // rate limit بسيط

// session counter بسيط في memory (يُعاد عند restart)
const sessionCounts = new Map();

function calcConfidence(verified, failures) {
  if (verified < MIN_VERIFIED) return 0;
  const rate = verified / (verified + failures);
  let base;
  if (verified >= 20) base = 0.90;
  else if (verified >= 10) base = 0.80;
  else if (verified >= 5)  base = 0.70;
  else                      base = 0.60;
  return Math.min(0.95, base * rate);
}

async function githubGet(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`, {
    headers: { 'Authorization': `token ${TOKEN}`, 'User-Agent': 'reality-engine' }
  });
  if (res.status === 404) return { content: null, sha: null };
  const data = await res.json();
  return {
    content: data.content ? JSON.parse(Buffer.from(data.content, 'base64').toString()) : null,
    sha: data.sha,
  };
}

async function githubPut(path, content, sha, message) {
  const body = { message, content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'), branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'reality-engine' },
    body: JSON.stringify(body),
  });
  return { ok: res.status === 200 || res.status === 201, status: res.status };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!TOKEN) return res.status(500).json({ error: 'Server misconfigured' });

  const { patternId, success, sessionId } = req.body || {};

  if (!patternId) return res.status(400).json({ error: 'Missing patternId' });
  if (typeof success !== 'boolean') return res.status(400).json({ error: 'success must be boolean' });

  // Rate limit — session لا يقدر يرسل verify أكثر من MAX
  if (sessionId) {
    const count = (sessionCounts.get(sessionId) || 0) + 1;
    if (count > MAX_VERIFIES_PER_SESSION) {
      return res.status(429).json({ error: 'Too many verifications from this session' });
    }
    sessionCounts.set(sessionId, count);
  }

  // قراءة مع retry
  let db, sha, attempts = 0;
  while (attempts < 3) {
    try {
      const r = await githubGet(FILE_PATH);
      db = r.content; sha = r.sha;
      break;
    } catch(e) {
      attempts++;
      if (attempts >= 3) return res.status(500).json({ error: 'Failed to read patterns' });
      await new Promise(r => setTimeout(r, 300 * attempts));
    }
  }

  if (!db) return res.status(404).json({ error: 'No patterns found' });

  const p = db.patterns?.find(p => p.id === patternId);
  if (!p) return res.status(404).json({ error: 'Pattern not found' });

  // تحديث — server-side فقط
  if (success) {
    p.verified = (p.verified || 0) + 1;
  } else {
    p.failures = (p.failures || 0) + 1;
    if (p.failures >= MAX_FAILURES) p.approved = false;
  }

  // السيرفر يحسب confidence و approved
  p.confidence = calcConfidence(p.verified || 0, p.failures || 0);
  if (p.verified >= MIN_VERIFIED && p.confidence >= MIN_CONFIDENCE && p.failures < MAX_FAILURES) {
    p.approved = true;
  }

  db.updated = new Date().toISOString();

  // كتابة مع SHA conflict handling
  let saved = false;
  for (let i = 0; i < 3; i++) {
    const r = await githubPut(FILE_PATH, db, sha, `Verify pattern ${patternId.slice(0,12)}: ${success?'pass':'fail'}`);
    if (r.ok) { saved = true; break; }
    if (r.status === 409) {
      const fresh = await githubGet(FILE_PATH);
      db = fresh.content || db;
      sha = fresh.sha;
      await new Promise(r => setTimeout(r, 300 * (i+1)));
    } else break;
  }

  if (!saved) return res.status(500).json({ error: 'Failed to update pattern' });

  return res.status(200).json({
    updated: true,
    patternId,
    verified: p.verified,
    failures: p.failures,
    confidence: +p.confidence.toFixed(3),
    approved: p.approved,
  });
}
