// ═══════════════════════════════════════════════════════
// api/patterns/verify.js — تعارض 409 وفقدان التحديث
// تشغيل:  node --test vercel-api/test/api_patterns_verify_conflict.test.js
//
// الخلل المُستهدف (كشفته مراجعة جاهزية P3):
//   p = db.patterns.find(...)        ← مؤشّر إلى db الأول
//   … تُطبَّق الزيادة على p …
//   عند 409:  db = fresh.content    ← كائن جديد، وp ما زال يؤشّر إلى القديم
//   githubPut(db, …)                ← يُرسل الحالة الطازجة بلا الزيادة
//   return { verified: p.verified }  ← يُبلِّغ قيم الكائن المُهمَل
// فالنتيجة: المخزَّن بلا التحديث، والاستجابة 200 تدّعي أنه مُسجَّل.
//
// العقد الذي يثبّته هذا الملف:
//   (1) ما تُرجعه الاستجابة 200 يطابق ما استقرّ في المخزن — دائمًا.
//   (2) الزيادة تُطبَّق مرة واحدة لكل طلب، ولو تعدّدت المحاولات.
//   (3) فشل الكتابة المستمر أو اختفاء النمط ⇒ لا 200 ولا تحديث.
//
// لا شبكة ولا توكن حقيقي: GitHub API محاكى بالكامل في الذاكرة.
// ملاحظة: TOKEN يُقرأ وقت تحميل الوحدة، فيُضبط قبل require.
// وsessionCounts على مستوى الوحدة والحدّ 5/جلسة، فلكل اختبار جلسته.
//
// [IDEMP] عقد الطلب صار يشترط resultId صالحًا (مرحلة منع تكرار النتائج)،
// فكل نداء هنا يحمل مفتاحًا مستقلًا. هذه بيانات الطلب فقط — ولا تأكيد في
// هذا الملف تغيّر ولا ضُعِّف: هدفه يبقى إصلاح 409 وحده، أي إعادة تطبيق
// التحديث على اللقطة الطازجة، وعدم فقدانه عند التعارض، وعدم الإبلاغ عن
// نجاح كاذب، ومطابقة الاستجابة للبيانات المخزَّنة.
// ═══════════════════════════════════════════════════════
'use strict';

process.env.GITHUB_TOKEN = 'test-token-not-real';

const test   = require('node:test');
const assert = require('node:assert');

const mod     = require('../api/patterns/verify.js');
const handler = (typeof mod === 'function') ? mod : mod.default;

// ─── GitHub API محاكى ──────────────────────────────────
// putScript: تسلسل ردود PUT. 'ok' يعتمد الحمولة، '409' تعارض،
// '403' خطأ غير قابل للإعادة، 'throw' فشل شبكة.
// getScript (اختياري): تسلسل ردود GET. 'ok' يُرجع المخزن،
// 'throw' فشل شبكة، 'gone' يُرجع محتوى بلا النمط، 'null' لا محتوى.
function mockGitHub(initialDb, putScript, getScript) {
  const state = {
    stored: JSON.parse(JSON.stringify(initialDb)),
    puts: [],          // حمولة كل PUT كما أُرسلت
    gets: 0,
    putIdx: 0,
    getIdx: 0,
  };
  const nextPut = () => putScript[Math.min(state.putIdx++, putScript.length - 1)];
  const nextGet = () => (getScript ? getScript[Math.min(state.getIdx++, getScript.length - 1)] : 'ok');

  globalThis.fetch = async (url, opt) => {
    if (!opt || opt.method !== 'PUT') {
      state.gets++;
      const mode = nextGet();
      if (mode === 'throw') throw new Error('ENETDOWN');
      if (mode === 'null')  return { status: 404, ok: false, json: async () => ({}) };
      const body = mode === 'gone'
        ? { version: '1.0', patterns: [] }
        : state.stored;
      return {
        status: 200, ok: true,
        json: async () => ({
          content: Buffer.from(JSON.stringify(body)).toString('base64'),
          sha: 'sha-' + state.gets,
        }),
      };
    }
    const mode = nextPut();
    const sent = JSON.parse(Buffer.from(JSON.parse(opt.body).content, 'base64').toString('utf8'));
    state.puts.push(sent);
    if (mode === 'throw') throw new Error('ECONNRESET');
    if (mode === '409')   return { status: 409, ok: false, json: async () => ({ message: 'sha mismatch' }) };
    if (mode === '403')   return { status: 403, ok: false, json: async () => ({ message: 'forbidden' }) };
    state.stored = sent;
    return { status: 200, ok: true, json: async () => ({ content: { sha: 'sha-put' } }) };
  };
  return state;
}

function mkRes() {
  const r = { _status: null, _json: null };
  r.status = c => { r._status = c; return r; };
  r.json   = o => { r._json = o; return r; };
  return r;
}

const PID = 'rl-fixture-001';
const baseDb = () => ({
  version: '1.0',
  patterns: [{
    id: PID, issueType: 'CWE-798', language: 'js',
    signature: { issueFamily: 'secret', nodeType: 'variable_assignment' },
    transformation: { type: 'env_substitution' },
    observed: 5, verified: 3, failures: 0, confidence: 0.6, approved: true,
    created: 1, lastSeen: 1,
  }],
});
const storedPattern = state => state.stored.patterns.find(p => p.id === PID);

let sessionSeq = 0;
// [IDEMP] كل نداء هنا = نتيجة مستقلة ⇒ مفتاح مختلف، فلا يُحتسب أي نداء
// إعادةَ إرسال لغيره. وإعادة المحاولة بعد 409 داخل الطلب الواحد تحمل
// المفتاح نفسه بالبناء — فهي طلب واحد لا نداءان. وbody يأتي آخرًا في
// Object.assign فيقدر الاختبار أن يفرض مفتاحًا بعينه عند الحاجة.
const call = async (body) => {
  const res = mkRes();
  const n = ++sessionSeq;
  await handler({ method: 'POST', body: Object.assign(
    { sessionId: 'verify-conflict-session-' + n,
      resultId:  'result-conflict-' + String(n).padStart(7, '0') }, body) }, res);
  return res;
};

// ═══ 0. عزل: المحاكاة والمسار السليم ══════════════════

test('tripwire: المحاكاة تعمل والمسار السليم يُحدِّث فعلًا', async () => {
  const state = mockGitHub(baseDb(), ['ok']);
  const res = await call({ patternId: PID, success: true });
  assert.strictEqual(res._status, 200, 'المسار السليم يجب أن ينجح');
  assert.strictEqual(state.puts.length, 1, 'كتابة واحدة');
  assert.strictEqual(storedPattern(state).verified, 4, 'والزيادة استقرّت في المخزن');
  assert.strictEqual(res._json.verified, 4, 'والاستجابة تطابقه');
});

// ═══ 1. إعادة إنتاج الخلل: 409 ثم إعادة محاولة ════════

test('409 ثم نجاح: الزيادة تستقرّ في المخزن ولا تُفقد', async () => {
  const state = mockGitHub(baseDb(), ['409', 'ok']);
  const res = await call({ patternId: PID, success: false });

  assert.strictEqual(res._status, 200, 'إعادة المحاولة يجب أن تنجح');
  assert.strictEqual(state.puts.length, 2, 'محاولتا كتابة: الأولى تعارضت والثانية نجحت');
  assert.strictEqual(state.puts[0].patterns[0].failures, 1,
    'المحاولة الأولى حملت الزيادة');
  assert.strictEqual(state.puts[1].patterns[0].failures, 1,
    'والمحاولة الثانية يجب أن تحملها أيضًا — هنا كان يُفقد التحديث');
  assert.strictEqual(storedPattern(state).failures, 1,
    'والمخزَّن النهائي يحمل الزيادة');
});

test('409 ثم نجاح: الاستجابة تطابق المخزَّن حرفًا بحرف — لا نجاح كاذب', async () => {
  const state = mockGitHub(baseDb(), ['409', 'ok']);
  const res = await call({ patternId: PID, success: false });
  assert.strictEqual(res._status, 200);

  const stored = storedPattern(state);
  assert.strictEqual(res._json.failures, stored.failures,
    `الاستجابة تقول failures=${res._json.failures} والمخزَّن ${stored.failures}`);
  assert.strictEqual(res._json.verified, stored.verified, 'وverified كذلك');
  assert.strictEqual(res._json.approved, stored.approved, 'وحالة الاعتماد كذلك');
  assert.strictEqual(res._json.confidence, +stored.confidence.toFixed(3), 'وconfidence كذلك');
});

test('409 مرتين ثم نجاح: الزيادة مرة واحدة لا ثلاث', async () => {
  const state = mockGitHub(baseDb(), ['409', '409', 'ok']);
  const res = await call({ patternId: PID, success: true });

  assert.strictEqual(res._status, 200);
  assert.strictEqual(state.puts.length, 3, 'ثلاث محاولات كتابة');
  assert.strictEqual(storedPattern(state).verified, 4,
    'الزيادة مرة واحدة لكل طلب — لا تتراكم بتراكم المحاولات');
  assert.strictEqual(res._json.verified, 4, 'والاستجابة تطابقه');
});

// ═══ 2. فشل الكتابة المستمر ════════════════════════════

test('409 ثلاث مرات (فشل مستمر): 500 ولا تحديث في المخزن', async () => {
  const state = mockGitHub(baseDb(), ['409', '409', '409']);
  const res = await call({ patternId: PID, success: false });

  assert.strictEqual(res._status, 500, 'لا يجوز الإبلاغ عن نجاح');
  assert.ok(res._json && res._json.error, 'ورسالة خطأ صريحة');
  assert.ok(!res._json.updated, 'ولا حقل updated');
  assert.strictEqual(storedPattern(state).failures, 0, 'والمخزَّن لم يتغيّر');
  assert.strictEqual(storedPattern(state).verified, 3, 'ولا verified');
});

test('خطأ كتابة غير قابل للإعادة (403): 500 فورًا بمحاولة واحدة', async () => {
  const state = mockGitHub(baseDb(), ['403']);
  const res = await call({ patternId: PID, success: true });

  assert.strictEqual(res._status, 500);
  assert.strictEqual(state.puts.length, 1, 'لا إعادة محاولة على خطأ غير 409');
  assert.strictEqual(storedPattern(state).verified, 3, 'والمخزَّن لم يتغيّر');
});

// ═══ 3. فشل الشبكة ════════════════════════════════════

test('فشل شبكة في القراءة: 500 بلا أي كتابة', async () => {
  const state = mockGitHub(baseDb(), ['ok'], ['throw', 'throw', 'throw']);
  const res = await call({ patternId: PID, success: true });

  assert.strictEqual(res._status, 500);
  assert.match(String(res._json.error), /read/i, 'وسبب الفشل قراءة');
  assert.strictEqual(state.puts.length, 0, 'ولا محاولة كتابة');
  assert.strictEqual(storedPattern(state).verified, 3, 'والمخزَّن لم يتغيّر');
});

test('documented: فشل شبكة في الكتابة يخرج استثناءً من المعالج', async () => {
  // سلوك مسجَّل لا مُصلَح في هذه المرحلة: githubPut لا يلتقط رمي fetch،
  // فالاستثناء يخرج. وهو لا يدّعي نجاحًا — فخارج هدف هذه المرحلة.
  const state = mockGitHub(baseDb(), ['throw']);
  let threw = false;
  try {
    await handler({ method: 'POST', body: {
      patternId: PID, success: true, sessionId: 'net-fail-session',
      resultId: 'result-conflict-netfail-1' } }, mkRes());
  } catch (e) { threw = true; }
  assert.strictEqual(threw, true, 'يخرج استثناءً — مسجَّل كخطر متبقٍّ');
  assert.strictEqual(storedPattern(state).verified, 3, 'والمهم: لا تحديث في المخزن');
});

// ═══ 4. عدم العثور على النمط ══════════════════════════

test('نمط غير موجود: 404 بلا أي كتابة', async () => {
  const state = mockGitHub(baseDb(), ['ok']);
  const res = await call({ patternId: 'rl-does-not-exist', success: true });

  assert.strictEqual(res._status, 404);
  assert.strictEqual(state.puts.length, 0, 'ولا محاولة كتابة');
});

test('النمط يختفي من المحتوى الطازج بعد 409: لا نجاح كاذب', async () => {
  // 409 ثم قراءة طازجة لا تحوي النمط — لا يجوز الإبلاغ عن تحديث
  const state = mockGitHub(baseDb(), ['409', 'ok'], ['ok', 'gone']);
  const res = await call({ patternId: PID, success: false });

  assert.notStrictEqual(res._status, 200,
    'النمط اختفى من الحالة الطازجة ⇒ لا يجوز الإبلاغ عن نجاح');
  assert.ok(!(res._json && res._json.updated), 'ولا حقل updated');
});

// ═══ 5. العقد العام: كل 200 يطابق المخزَّن ═════════════

test('خاصّية: كل استجابة 200 تطابق المخزَّن، في كل تسلسل كتابة', async () => {
  const scripts = [
    ['ok'],
    ['409', 'ok'],
    ['409', '409', 'ok'],
  ];
  for (const script of scripts) {
    for (const success of [true, false]) {
      const state = mockGitHub(baseDb(), script);
      const res = await call({ patternId: PID, success });
      if (res._status !== 200) continue;               // الفشل مغطّى أعلاه
      const stored = storedPattern(state);
      assert.ok(stored, `[${script}/${success}] النمط موجود في المخزَّن`);
      assert.strictEqual(res._json.verified, stored.verified,
        `[${script}/${success}] verified: الاستجابة ${res._json.verified} والمخزَّن ${stored.verified}`);
      assert.strictEqual(res._json.failures, stored.failures,
        `[${script}/${success}] failures: الاستجابة ${res._json.failures} والمخزَّن ${stored.failures}`);
      assert.strictEqual(res._json.approved, stored.approved,
        `[${script}/${success}] approved`);
    }
  }
});

// ═══ 6. العتبات والسياسة لم تُمَسّ ════════════════════

test('سياسة الاعتماد والعتبات كما هي — لم تُغيَّر في هذه المرحلة', async () => {
  const fs  = require('node:fs');
  const src = fs.readFileSync(require.resolve('../api/patterns/verify.js'), 'utf8');
  assert.match(src, /const MIN_VERIFIED\s*=\s*3;/,   'MIN_VERIFIED = 3');
  assert.match(src, /const MIN_CONFIDENCE\s*=\s*0\.60;/, 'MIN_CONFIDENCE = 0.60');
  assert.match(src, /const MAX_FAILURES\s*=\s*3;/,   'MAX_FAILURES = 3');
  assert.match(src, /const MAX_VERIFIES_PER_SESSION\s*=\s*5;/, 'حدّ الجلسة = 5');
  assert.match(src, /if \(verified < MIN_VERIFIED\) return 0;/, 'منحنى الثقة كما هو');
});
