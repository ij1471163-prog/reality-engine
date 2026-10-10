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

// [IDEMP] سجل النتائج — يمنع احتساب النتيجة نفسها أكثر من مرة.
//   LEDGER_MAX      حدّ أعلى لعدد المدخلات (يحمي حجم الملف)
//   LEDGER_TTL_SEC  عمر أقصى للمدخلة (يحمي الصحة بإسقاط ما لا يُعاد إرساله)
// يُطبَّق الشرطان معًا: تُسقَط المنتهية أولًا، ثم تُقلَّم الأقدم حتى الحدّ.
// ⚠️ الحماية **نافذة لا ضمان أبدي**: مفتاح أُزيل من السجل — بانتهاء عمره أو
// بالتقليم — يُحتسب مرة أخرى إذا أُعيد إرساله بعد إزالته.
const LEDGER_MAX     = 500;
const LEDGER_TTL_SEC = 7 * 24 * 60 * 60;   // سبعة أيام
const RESULT_ID_RE   = /^[A-Za-z0-9_-]{16,64}$/;

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

  const { patternId, success, sessionId, resultId } = req.body || {};

  if (!patternId) return res.status(400).json({ error: 'Missing patternId' });
  if (typeof success !== 'boolean') return res.status(400).json({ error: 'success must be boolean' });

  // [IDEMP] مفتاح النتيجة إلزامي. بلا مفتاح لا يمكن التمييز بين نتيجة جديدة
  // وإعادة إرسال، فتُحتسب كل إعادة إرسال نتيجةً أخرى — وهو المقيس: أربعة
  // إرسالات لنفس النتيجة كانت تنقل verified من 3 إلى 7.
  // يُتحقَّق قبل أي قراءة أو كتابة، فالطلب الفاسد لا يلمس المخزن.
  if (typeof resultId !== 'string' || !RESULT_ID_RE.test(resultId)) {
    return res.status(400).json({ error: 'invalid resultId' });
  }

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

  // ═══ [IDEMP] سجل النتائج ═══════════════════════════════════════════
  // السجل داخل patterns.json نفسه، فيُكتب **مع العدّاد في عملية PUT واحدة**
  // ⇒ ذرّية بالبناء: لا حالة يُحتسب فيها العدّاد بلا تسجيل المفتاح أو العكس.
  // وبقاؤه في الملف لا في الذاكرة يجعله يصمد أمام إعادة تشغيل الدالة وتغيّر
  // نسختها — خلافًا لـsessionCounts الذي يُصفَّر مع كل نسخة.
  const ledgerOf = d => (Array.isArray(d.results) ? d.results : (d.results = []));

  // تقليم: المنتهية عمرًا أولًا، ثم الأقدم حتى الحدّ العددي.
  // مدخلة بلا طابع زمني صحيح تُعتبر غير منتهية (توافق مع أي سجل أقدم).
  const ledgerPrune = (d) => {
    const floor = Math.floor(Date.now() / 1000) - LEDGER_TTL_SEC;
    let kept = ledgerOf(d).filter(e =>
      e && typeof e.k === 'string' && (typeof e.t !== 'number' || e.t >= floor));
    if (kept.length > LEDGER_MAX) kept = kept.slice(kept.length - LEDGER_MAX);
    d.results = kept;
    return kept;
  };

  const ledgerFind = (d, key) => ledgerOf(d).find(e => e && e.k === key) || null;

  const ledgerAdd = (d, key, pid, ok) => {
    const L = ledgerOf(d);
    if (L.some(e => e && e.k === key)) return;
    L.push({ k: key, p: pid, o: ok ? 1 : 0, t: Math.floor(Date.now() / 1000) });
    ledgerPrune(d);
  };

  // عقد استجابة واحد لمساري النجاح والإعادة، وقيمه من الكائن المخزَّن فعلاً.
  const reply = (target, replayed) => res.status(200).json({
    updated:    !replayed,
    replayed:   !!replayed,
    resultId,
    patternId,
    verified:   target.verified,
    failures:   target.failures,
    confidence: +(target.confidence || 0).toFixed(3),
    approved:   target.approved,
  });

  ledgerPrune(db);

  // إعادة إرسال نتيجة مسجَّلة سابقًا ⇒ لا احتساب ثانٍ ولا كتابة.
  // تُعاد الحالة الراهنة المخزَّنة لا لقطة قديمة.
  {
    const seen = ledgerFind(db, resultId);
    if (seen) {
      const recorded = (db.patterns || []).find(x => x.id === seen.p);
      // سُجِّلت النتيجة ثم حُذف النمط: لا نجاح كاذب، و410 أدقّ من 404 —
      // المورد كان موجودًا وزال.
      if (!recorded) return res.status(410).json({ error: 'Result recorded but pattern gone' });
      return reply(recorded, true);
    }
  }

  // [FIX-409] التحديث يُطبَّق على القاعدة التي ستُكتب فعلاً.
  //
  // كان: p = db.patterns.find(…) يُؤخذ مرة واحدة من db الأول، ثم عند 409
  // تُستبدل db بمحتوى طازج (db = fresh.content) بينما p يبقى مؤشّرًا إلى
  // الكائن المُهمَل. فالمحاولة التالية تُرسل الحالة الطازجة **بلا الزيادة**،
  // ثم تُبلَّغ قيم p القديمة. والمقيس: استجابة 200 تقول failures=1 والمخزَّن 0،
  // أو verified=4 والمخزَّن 3 — فقدان صامت مع إبلاغ نجاح كاذب.
  //
  // والإصلاح: دالة تُطبّق التحديث على قاعدة بعينها وتُرجع النمط منها،
  // تُنادى بعد كل قراءة طازجة، ويُبلَّغ من مرجعها لا من مرجع قديم. والزيادة
  // تبقى واحدة لكل طلب لأن كل نداء يُطبَّق على لقطة جديدة لا على مُحدَّثة.
  const applyUpdate = (database) => {
    const target = (database && Array.isArray(database.patterns))
      ? database.patterns.find(x => x.id === patternId)
      : null;
    if (!target) return null;

    // تحديث — server-side فقط
    if (success) {
      target.verified = (target.verified || 0) + 1;
    } else {
      target.failures = (target.failures || 0) + 1;
      if (target.failures >= MAX_FAILURES) target.approved = false;
    }

    // السيرفر يحسب confidence و approved
    target.confidence = calcConfidence(target.verified || 0, target.failures || 0);
    if (target.verified >= MIN_VERIFIED && target.confidence >= MIN_CONFIDENCE && target.failures < MAX_FAILURES) {
      target.approved = true;
    }

    // [IDEMP] المفتاح يُسجَّل مع الزيادة في نفس الكائن، فيُكتبان معًا.
    ledgerAdd(database, resultId, patternId, success);

    database.updated = new Date().toISOString();
    return target;
  };

  let p = applyUpdate(db);
  if (!p) return res.status(404).json({ error: 'Pattern not found' });

  // كتابة مع SHA conflict handling
  let saved = false;
  for (let i = 0; i < 3; i++) {
    const r = await githubPut(FILE_PATH, db, sha, `Verify pattern ${patternId.slice(0,12)}: ${success?'pass':'fail'}`);
    if (r.ok) { saved = true; break; }
    if (r.status === 409) {
      const fresh = await githubGet(FILE_PATH);
      // [FIX-409] لا يُستبدل db إلا بمحتوى طازج فعلي، ويُعاد تطبيق التحديث
      // عليه. وبلا محتوى طازج تبقى db وsha كما هما ويُعاد المحاولة بهما —
      // كان ‎sha = fresh.sha‎ غير المشروط يجعل sha فارغًا فيصير الطلب
      // إنشاءً لملف قائم، ويجعل إعادة التطبيق على db المُحدَّثة زيادة ثانية.
      if (fresh.content) {
        db  = fresh.content;
        sha = fresh.sha;
        ledgerPrune(db);

        // [IDEMP] نسخة أخرى من الدالة ربما سجّلت هذه النتيجة بين قراءتنا
        // وكتابتنا — وهو سبب الـ409 نفسه في هذه الحالة. فيُفحَص المفتاح على
        // اللقطة الطازجة قبل إعادة التطبيق، وإلا احتُسبت النتيجة مرتين.
        const seen = ledgerFind(db, resultId);
        if (seen) {
          const recorded = (db.patterns || []).find(x => x.id === seen.p);
          if (recorded) return reply(recorded, true);
        }

        p = applyUpdate(db);
        if (!p) break;   // اختفى النمط من الحالة الطازجة ⇒ لا نجاح
      }
      await new Promise(r => setTimeout(r, 300 * (i+1)));
    } else break;
  }

  // !p يعني أن النمط اختفى بين المحاولات — لا يجوز الإبلاغ عن تحديث
  if (!saved || !p) return res.status(500).json({ error: 'Failed to update pattern' });

  // [IDEMP] نفس عقد الاستجابة الموحَّد: updated=true و replayed=false،
  // وقيمه من p — وهو الكائن الذي كُتب فعلاً بعد إصلاح 409.
  return reply(p, false);
}
