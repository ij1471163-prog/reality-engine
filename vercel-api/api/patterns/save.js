// ═══════════════════════════════════════════════════════
// api/patterns/save.js — v3
// POST /api/patterns/save
// Server-side verification + server-extracted pattern
// لا يثق بـ signature/transformation من العميل
// © 2025 Naif Lucena — Reality Engine
// ═══════════════════════════════════════════════════════
"use strict";



const vm   = require('vm');
const fs   = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────
const REPO      = process.env.GITHUB_REPO   || 'ij1471163-prog/reality-engine';
const BRANCH    = process.env.GITHUB_BRANCH || 'repair-learning';
const FILE_PATH = process.env.PATTERNS_PATH || 'vercel-api/public/data/patterns.json';
const TOKEN     = process.env.GITHUB_TOKEN;

const MAX_CODE_BYTES     = 50 * 1024;
const SAVE_LIMIT         = 5;
const SAVE_WINDOW_MS     = 60 * 60 * 1000; // 1 hour

// ─── Canonical Issue Type Map ────────────────────────
// مطابقة صارمة — لا includes() في التحقق النهائي
const ISSUE_FAMILIES = {
  // Secret / Hardcoded credentials
  HARDCODED_SECRET:      'secret',
  'CWE-798':             'secret',
  CWE_798:               'secret',
  HARDCODED_PASSWORD:    'secret',
  HARDCODED_TOKEN:       'secret',
  HARDCODED_KEY:         'secret',

  // SQL Injection
  SQL_INJECTION:         'sql',
  'CWE-89':              'sql',
  CWE_89:                'sql',
  SQL_CONCAT:            'sql',

  // XSS
  XSS:                   'xss',
  'CWE-79':              'xss',
  CWE_79:                'xss',
  DOM_XSS:               'xss',
  REFLECTED_XSS:         'xss',

  // Weak Crypto
  WEAK_CRYPTO:           'crypto',
  WEAK_HASH:             'crypto',
  'CWE-327':             'crypto',
  CWE_327:               'crypto',
  MD5_USAGE:             'crypto',
  SHA1_USAGE:            'crypto',

  // Command Injection
  CMD_INJECTION:         'cmd',
  COMMAND_INJECTION:     'cmd',
  'CWE-78':              'cmd',
  CWE_78:                'cmd',
  OS_COMMAND:            'cmd',

  // Accumulation / Counter
  ACCUMULATION:          'accumulation',
  COUNTER_BUG:           'accumulation',

  // Eval
  EVAL_INJECTION:        'eval',
  'CWE-94':              'eval',
  CWE_94:                'eval',
};

function canonicalFamily(issueType) {
  const norm = (issueType || '').toUpperCase().replace(/[-\s]/g, '_');
  return ISSUE_FAMILIES[norm] || null;
}

// ─── Rate Limiting ────────────────────────────────────
// sessionId مطلوب — بدونه نرفض
const saveRateMap = new Map();

function checkSaveRate(sessionId) {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.length < 8) {
    return { allowed: false, reason: 'missing_or_invalid_session' };
  }
  const now   = Date.now();
  const entry = saveRateMap.get(sessionId) || { count: 0, windowStart: now };

  if (now - entry.windowStart > SAVE_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }

  if (entry.count >= SAVE_LIMIT) {
    return { allowed: false, reason: `limit_${SAVE_LIMIT}_per_hour` };
  }

  entry.count++;
  saveRateMap.set(sessionId, entry);
  return { allowed: true };
}

// ─── Load Analyzer (server-side) ─────────────────────
let analyzeCode = null;

function loadAnalyzer() {
  if (analyzeCode) return true;
  try {
    const ctx  = vm.createContext({ console, window: {}, global: {} });
    const base = path.join(process.cwd(), 'public');
    for (const f of ['engine_java.js', 'knowledge_base.js', 'analyzer.js']) {
      vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), ctx);
    }
    analyzeCode = ctx.analyzeCode;
    return typeof analyzeCode === 'function';
  } catch(e) {
    console.error('loadAnalyzer FAIL:', e.message, e.code, e.stack?.slice(0,200));
    return false;
  }
}

// ─── Server-side Verification ────────────────────────
function serverVerify(originalCode, fixedCode, fileName, origIssues) {
  let fixedIssues;
  try {
    fixedIssues = analyzeCode(fixedCode, fileName) || [];
  } catch(e) {
    return { pass: false, reason: 'analysis_failed' };
  }

  const origCritical = origIssues.filter(i => i.sev === 'c' || i.sev === 'h');
  const fixedCritical = fixedIssues.filter(i => i.sev === 'c' || i.sev === 'h');

  // لا regression — canonical comparison
  const origFamilies = new Set(
    origIssues.map(i => canonicalFamily(i.cAct || i.type)).filter(Boolean)
  );
  const newCritical = fixedIssues.filter(i => {
    if (i.sev !== 'c' && i.sev !== 'h') return false;
    const fam = canonicalFamily(i.cAct || i.type);
    return fam && !origFamilies.has(fam);
  });
  if (newCritical.length > 0) return { pass: false, reason: 'regression_new_critical' };

  // تحسن
  if (origCritical.length > 0 && fixedCritical.length >= origCritical.length) {
    return { pass: false, reason: 'no_improvement' };
  }

  return { pass: true, fixedIssues };
}

// ─── Canonical Target Verification ───────────────────
// يستخدم family matching فقط — لا includes()
function verifyTarget(origIssues, fixedIssues, candidateType) {
  const targetFamily = canonicalFamily(candidateType);
  if (!targetFamily) {
    return { valid: false, reason: 'unknown_issue_type' };
  }

  // هل الهدف موجود في origIssues؟
  const realTarget = origIssues.find(i => {
    return canonicalFamily(i.cAct || i.type) === targetFamily;
  });
  if (!realTarget) {
    return { valid: false, reason: 'target_not_in_original_issues' };
  }

  // هل الهدف اختفى من fixedIssues؟
  const stillPresent = fixedIssues.some(i => {
    return canonicalFamily(i.cAct || i.type) === targetFamily;
  });
  if (stillPresent) {
    return { valid: false, reason: 'target_issue_remains_in_fixed' };
  }

  return {
    valid:        true,
    family:       targetFamily,
    resolvedType: realTarget.cAct || realTarget.type,
  };
}

// ─── Server-extracted Pattern ─────────────────────────
// يستخرج signature وtransformation من التحليل الفعلي
// لا يثق بـ client pattern.signature أو pattern.transformation
function extractServerPattern(origIssues, fixedIssues, originalCode, fixedCode, fileName, targetFamily) {
  const origLines  = originalCode.split('\n');
  const fixedLines = fixedCode.split('\n');

  // إيجاد الـ issue المستهدف
  const targetIssue = origIssues.find(i => canonicalFamily(i.cAct || i.type) === targetFamily);
  if (!targetIssue) return null;

  const ln       = (targetIssue.line || 1) - 1;
  const origLine = (origLines[ln] || '').trim();

  // إيجاد أقرب سطر تغيّر في fixedCode
  let fixedLine = '';
  if (fixedLines[ln] && fixedLines[ln].trim() !== origLine) {
    fixedLine = fixedLines[ln].trim();
  } else {
    // ابحث في ±2 سطر
    for (let d = 1; d <= 2; d++) {
      const above = fixedLines[ln - d];
      const below = fixedLines[ln + d];
      if (above && above.trim() !== origLine) { fixedLine = above.trim(); break; }
      if (below && below.trim() !== origLine) { fixedLine = below.trim(); break; }
    }
  }

  if (!origLine || !fixedLine || origLine === fixedLine) return null;

  // استخرج signature من origLine — لا قيم حقيقية
  const signature = buildSignature(targetFamily, origLine, fileName);

  // استخرج transformation من fixedLine
  const transformation = buildTransformation(targetFamily, origLine, fixedLine, fileName);
  if (!transformation) return null;

  return { signature, transformation };
}

function buildSignature(family, line, fileName) {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  const base = { issueFamily: family, fileExt: ext };

  if (family === 'secret') {
    const varM = line.match(/(?:const|let|var|)\s*(\w+)\s*[:=]/);
    const varName = varM ? varM[1].toUpperCase() : '';
    const keywords = ['SECRET','KEY','TOKEN','PASSWORD','PASS','API','AUTH','CREDENTIAL']
      .filter(k => varName.includes(k));
    return {
      ...base,
      nodeType:    'variable_assignment',
      varKeywords: keywords.length ? keywords : ['GENERIC'],
      valueType:   /["'][^"']{8,}["']/.test(line) ? 'string_long' : 'string_short',
    };
  }
  if (family === 'sql') {
    return {
      ...base,
      nodeType:  'sql_query',
      hasConcat: /["'`].*\+\s*\w|f["'].*\{/.test(line),
      queryType: /SELECT/i.test(line) ? 'select'
               : /INSERT/i.test(line) ? 'insert'
               : /UPDATE/i.test(line) ? 'update'
               : /DELETE/i.test(line) ? 'delete' : 'unknown',
    };
  }
  if (family === 'xss') {
    return { ...base, nodeType: 'dom_assignment', useInnerHTML: /innerHTML/.test(line) };
  }
  if (family === 'crypto') {
    return {
      ...base,
      nodeType:  'hash_function',
      algorithm: /md5/i.test(line) ? 'md5' : /sha1/i.test(line) ? 'sha1' : 'weak',
    };
  }
  if (family === 'accumulation') {
    return { ...base, nodeType: 'accumulation', inForEach: /forEach/.test(line) };
  }
  return { ...base, nodeType: 'unknown' };
}

function buildTransformation(family, origLine, fixedLine, fileName) {
  const ext = (fileName || '').split('.').pop().toLowerCase();

  if (family === 'secret') {
    if (/process\.env/.test(fixedLine))    return { type: 'env_substitution', template: 'process.env.{VAR_NAME}' };
    if (/os\.environ/.test(fixedLine))     return { type: 'env_substitution', template: "os.environ.get('{VAR_NAME}')" };
    if (/getenv/.test(fixedLine))          return { type: 'env_substitution', template: 'getenv("{VAR_NAME}")' };
  }
  if (family === 'sql') {
    if (/\?\s*[,\]]/.test(fixedLine))     return { type: 'parameterized_array', template: '? with array' };
    if (/\?/.test(fixedLine))              return { type: 'parameterized', template: '?' };
    if (/%s/.test(fixedLine))              return { type: 'parameterized_format', template: '%s' };
  }
  if (family === 'xss') {
    if (/textContent/.test(fixedLine))    return { type: 'text_content', template: '.textContent = {VAR}' };
    if (/htmlspecialchars/.test(fixedLine)) return { type: 'html_escape', template: 'htmlspecialchars({VAR})' };
  }
  if (family === 'crypto') {
    if (/sha256/.test(fixedLine))         return { type: 'upgrade_hash', template: 'sha256' };
    if (/bcrypt/.test(fixedLine))         return { type: 'upgrade_hash', template: 'bcrypt' };
  }
  if (family === 'accumulation') {
    if (/\+=/.test(fixedLine))            return { type: 'fix_accumulation', template: '+=' };
  }
  return null;
}

// ─── Validate Metadata from Client ───────────────────
// نقبل فقط: issueType + language (للـ metadata)
// نرفض signature + transformation من العميل
function validateClientMeta(meta) {
  if (!meta || typeof meta !== 'object') return 'invalid metadata';
  if (!meta.issueType || typeof meta.issueType !== 'string') return 'missing issueType';
  if (!meta.language  || typeof meta.language  !== 'string') return 'missing language';
  const allowed = ['js','ts','py','php','java','html','css','rb','go'];
  if (!allowed.includes(meta.language)) return `unsupported language: ${meta.language}`;
  return null;
}

// ─── GitHub Helpers ──────────────────────────────────
async function githubGet(filePath) {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${filePath}?ref=${BRANCH}`,
    { headers: { 'Authorization': `token ${TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'reality-engine' } }
  );
  if (res.status === 404) return { content: null, sha: null };
  const data = await res.json();
  return {
    content: data.content
      ? JSON.parse(Buffer.from(data.content.replace(/\n/g,''), 'base64').toString('utf8'))
      : null,
    sha: data.sha || null,
  };
}

async function githubPut(filePath, content, sha, message) {
  const body = {
    message,
    content: Buffer.from(JSON.stringify(content, null, 2), 'utf8').toString('base64'),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json', 'User-Agent': 'reality-engine' },
    body: JSON.stringify(body),
  });
  return { ok: res.status === 200 || res.status === 201, status: res.status };
}

// ─── Main Handler ────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!TOKEN)                return res.status(500).json({ error: 'Server misconfigured' });
  if (!loadAnalyzer())       return res.status(500).json({ error: 'Analyzer unavailable' });

  const { originalCode, fixedCode, fileName, pattern, sessionId } = req.body || {};

  // 1. sessionId مطلوب — rate limit لا يمكن تجاوزه بحذفه
  const rateCheck = checkSaveRate(sessionId);
  if (!rateCheck.allowed) {
    return res.status(429).json({ error: rateCheck.reason });
  }

  // 2. حجم الكود
  if (Buffer.byteLength(originalCode || '', 'utf8') > MAX_CODE_BYTES ||
      Buffer.byteLength(fixedCode   || '', 'utf8') > MAX_CODE_BYTES) {
    return res.status(413).json({ error: 'Code too large (max 50KB)' });
  }

  if (!originalCode || !fixedCode || !fileName || !pattern) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // 3. validate client metadata فقط (issueType + language)
  const metaError = validateClientMeta(pattern);
  if (metaError) return res.status(400).json({ error: metaError });

  // 4. analyzeCode(original) على السيرفر
  let origIssues;
  try {
    origIssues = analyzeCode(originalCode, fileName) || [];
  } catch(e) {
    return res.status(400).json({ error: 'Failed to analyze original code' });
  }

  // 5. canonical target verification — لا includes()
  const targetFamily = canonicalFamily(pattern.issueType);
  if (!targetFamily) {
    return res.status(400).json({ error: `Unknown issue type: ${pattern.issueType}` });
  }

  const targetInOrig = verifyTarget(origIssues, [], pattern.issueType);
  if (!targetInOrig.valid && targetInOrig.reason === 'target_not_in_original_issues') {
    return res.status(400).json({ error: 'Target issue not found in original code' });
  }

  // 6. server verification
  const verification = serverVerify(originalCode, fixedCode, fileName, origIssues);
  // الكود لا يُخزن — لا يظهر في response أو logs
  if (!verification.pass) {
    return res.status(400).json({ error: 'Verification failed', reason: verification.reason });
  }

  // 7. target اختفى في fixedCode؟
  const targetInFixed = verifyTarget(origIssues, verification.fixedIssues, pattern.issueType);
  if (!targetInFixed.valid) {
    return res.status(400).json({ error: 'Target not resolved', reason: targetInFixed.reason });
  }

  // 8. استخرج Pattern من السيرفر — لا من العميل
  const serverPattern = extractServerPattern(
    origIssues, verification.fixedIssues,
    originalCode, fixedCode,
    fileName, targetFamily
  );

  if (!serverPattern) {
    return res.status(400).json({ error: 'Could not extract pattern from code diff' });
  }

  // 9. قراءة + كتابة مع SHA conflict retry
  let patternId, isNew = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    let db, sha;
    try {
      const r = await githubGet(FILE_PATH);
      db  = r.content || { version: '1.0', patterns: [] };
      sha = r.sha;
    } catch(e) {
      if (attempt >= 2) return res.status(500).json({ error: 'Failed to read patterns' });
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }

    // duplicate check بـ server-extracted signature
    const existing = db.patterns?.find(p =>
      p.issueType                  === targetInFixed.resolvedType &&
      p.language                   === pattern.language &&
      p.signature?.issueFamily     === serverPattern.signature.issueFamily &&
      p.signature?.nodeType        === serverPattern.signature.nodeType &&
      p.transformation?.type       === serverPattern.transformation.type
    );

    if (existing) {
      existing.observed = (existing.observed || 0) + 1;
      existing.lastSeen = Date.now();
      patternId = existing.id;
      isNew = false;
    } else {
      patternId = `rl-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
      db.patterns.push({
        id:             patternId,
        issueType:      targetInFixed.resolvedType,  // من السيرفر
        language:       pattern.language,             // من العميل (metadata فقط)
        signature:      serverPattern.signature,      // من السيرفر
        transformation: serverPattern.transformation, // من السيرفر
        // server-managed
        observed: 1, verified: 0, failures: 0,
        confidence: 0, approved: false,
        created: Date.now(), lastSeen: Date.now(),
      });
      isNew = true;
    }

    db.updated = new Date().toISOString();

    const writeResult = await githubPut(
      FILE_PATH, db, sha,
      `rl:${patternId.slice(0,10)} ${targetInFixed.resolvedType} ${pattern.language}`
    );

    if (writeResult.ok) {
      return res.status(200).json({
        saved: true,
        id:    patternId,
        isNew,
        type:  targetInFixed.resolvedType,
        lang:  pattern.language,
        // لا كود لا token في response
      });
    }

    if (writeResult.status === 409) {
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
      continue;
    }
    break;
  }

  return res.status(500).json({ error: 'Failed to save pattern after retries' });
}
