// ═══════════════════════════════════════════════════════
// api/patterns/verify.js — منع تكرار احتساب النتيجة (Idempotency)
// تشغيل:  node --test vercel-api/test/api_patterns_verify_idempotency.test.js
//
// المشكلة المُقاسة قبل هذه المرحلة: أربعة إرسالات لنفس النتيجة تنقل
// verified من 3 إلى 7 — لأن الطلب لا يحمل ما يميّز نتيجةً جديدة من إعادة
// إرسال، فكل وصول يُحتسب دليلًا مستقلًا.
//
// العقد الذي يثبّته هذا الملف:
//   (1) resultId إلزامي، ويُتحقَّق منه قبل أي قراءة أو كتابة.
//   (2) المفتاح الموجود في السجل ⇒ لا احتساب ثانٍ ولا كتابة، والاستجابة
//       replayed=true بالحالة الراهنة المخزَّنة.
//   (3) المفتاح يُسجَّل مع الزيادة في عملية PUT واحدة ⇒ ذرّية بالبناء.
//   (4) عند 409 يُفحَص المفتاح على اللقطة الطازجة قبل إعادة التطبيق.
//   (5) السجل محدود: 500 مدخلة **و** عمر أقصى 7 أيام، ويُطبَّق الشرطان.
//   (6) ⚠️ الحماية نافذة لا ضمان أبدي: مفتاح أُزيل من السجل يُحتسب مرة
//       أخرى إذا أُعيد إرساله بعد إزالته. مُختبَر صراحةً أدناه.
//
// لا شبكة ولا توكن حقيقي: GitHub API محاكى بالكامل في الذاكرة.
// ملاحظة: TOKEN يُقرأ وقت تحميل الوحدة فيُضبط قبل require، وsessionCounts
// على مستوى الوحدة والحدّ 5/جلسة فلكل نداء جلسته.
// ═══════════════════════════════════════════════════════
'use strict';

process.env.GITHUB_TOKEN = 'test-token-not-real';

const test   = require('node:test');
const assert = require('node:assert');

const mod     = require('../api/patterns/verify.js');
const handler = (typeof mod === 'function') ? mod : mod.default;

const PID  = 'rl-fixture-001';
const DAY  = 24 * 60 * 60;
const nowS = () => Math.floor(Date.now() / 1000);

const basePattern = () => ({
  id: PID, issueType: 'CWE-798', language: 'js',
  signature: { issueFamily: 'secret', nodeType: 'variable_assignment' },
  transformation: { type: 'env_substitution' },
  observed: 5, verified: 3, failures: 0, confidence: 0.6, approved: true,
  created: 1, lastSeen: 1,
});
const baseDb = (results) => ({
  version: '1.1',
  patterns: [basePattern()],
  results: results || [],
});

// ─── GitHub API محاكى ──────────────────────────────────
// putScript: تسلسل ردود PUT — 'ok' | '409' | '403' | 'throw'
// getScript: تسلسل ردود GET — 'ok' | 'throw' | 'gone' | كائن صريح
// interleave: يُنفَّذ بعد أول GET لمحاكاة كاتب آخر بين قراءتنا وكتابتنا
//             (وهو ما يُنتج 409 حقيقيًا في بيئة التزامن).
function mockGitHub(initialDb, putScript, opts) {
  const o = opts || {};
  const state = {
    stored: JSON.parse(JSON.stringify(initialDb)),
    sha: 1, puts: [], gets: 0, putIdx: 0, getIdx: 0, interleaved: false,
  };
  const nextPut = () => putScript[Math.min(state.putIdx++, putScript.length - 1)];
  const nextGet = () => (o.getScript ? o.getScript[Math.min(state.getIdx++, o.getScript.length - 1)] : 'ok');

  globalThis.fetch = async (url, opt) => {
    if (!opt || opt.method !== 'PUT') {
      state.gets++;
      const mode = nextGet();
      if (mode === 'throw') throw new Error('ENETDOWN');
      const body = (mode === 'gone') ? { version: '1.1', patterns: [], results: state.stored.results || [] }
                 : (typeof mode === 'object') ? mode
                 : state.stored;
      const payload = {
        content: Buffer.from(JSON.stringify(body)).toString('base64'),
        sha: 'sha-' + state.sha,
      };
      // كاتب آخر يتدخّل بعد قراءتنا الأولى ⇒ sha الذي نحمله صار قديمًا
      if (o.interleave && !state.interleaved) {
        state.interleaved = true;
        o.interleave(state);
        state.sha++;
      }
      return { status: 200, ok: true, json: async () => payload };
    }
    const mode = nextPut();
    const sent = JSON.parse(Buffer.from(JSON.parse(opt.body).content, 'base64').toString('utf8'));
    state.puts.push(sent);
    if (mode === 'throw') throw new Error('ECONNRESET');
    if (mode === '409')   return { status: 409, ok: false, json: async () => ({ message: 'sha mismatch' }) };
    if (mode === '403')   return { status: 403, ok: false, json: async () => ({ message: 'forbidden' }) };
    if (mode === 'sha')   {   // يرفض الـsha القديم كما تفعل GitHub
      const got = JSON.parse(opt.body).sha;
      if (got !== 'sha-' + state.sha) return { status: 409, ok: false, json: async () => ({ message: 'sha mismatch' }) };
    }
    state.stored = sent; state.sha++;
    return { status: 200, ok: true, json: async () => ({ content: { sha: 'sha-' + state.sha } }) };
  };
  return state;
}

function mkRes() {
  const r = { _status: null, _json: null };
  r.status = c => { r._status = c; return r; };
  r.json   = o => { r._json = o; return r; };
  return r;
}

let sessionSeq = 0;
const call = async (body) => {
  const res = mkRes();
  await handler({ method: 'POST', body: Object.assign(
    { sessionId: 'idemp-session-' + (++sessionSeq) }, body) }, res);
  return res;
};
const stored  = state => state.stored.patterns.find(p => p.id === PID);
const ledger  = state => (state.stored.results || []);
const RID     = 'result-fixture-0000001';

// ═══ 0. عزل ═══════════════════════════════════════════

test('tripwire: المحاكاة تعمل والمسار السليم يُحدِّث ويُسجِّل', async () => {
  const state = mockGitHub(baseDb(), ['ok']);
  const res = await call({ patternId: PID, success: true, resultId: RID });

  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._json.updated, true,  'updated=true في النجاح');
  assert.strictEqual(res._json.replayed, false, 'replayed=false في النجاح');
  assert.strictEqual(res._json.resultId, RID, 'والمفتاح في الاستجابة');
  assert.strictEqual(stored(state).verified, 4, 'الزيادة استقرّت');
  assert.strictEqual(ledger(state).length, 1, 'والمفتاح سُجِّل');
  assert.strictEqual(ledger(state)[0].k, RID);
});

test('ذرّية: المفتاح والعدّاد في حمولة PUT واحدة', async () => {
  const state = mockGitHub(baseDb(), ['ok']);
  await call({ patternId: PID, success: true, resultId: 'result-atomic-00000001' });

  assert.strictEqual(state.puts.length, 1, 'عملية كتابة واحدة');
  const sent = state.puts[0];
  assert.strictEqual(sent.patterns[0].verified, 4, 'الحمولة تحمل الزيادة');
  assert.ok((sent.results || []).some(e => e.k === 'result-atomic-00000001'),
    'ونفس الحمولة تحمل المفتاح — لا حالة يُحتسب فيها العدّاد بلا تسجيل');
});

// ═══ 1. إعادة الإرسال لا تُضاعف ═══════════════════════

test('إعادة إرسال نفس resultId أربع مرات ⇒ زيادة واحدة', async () => {
  const state = mockGitHub(baseDb(), ['ok']);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const r = await call({ patternId: PID, success: true, resultId: 'result-repeat-00000001' });
    seen.push({ status: r._status, updated: r._json.updated, replayed: r._json.replayed, verified: r._json.verified });
  }
  assert.strictEqual(stored(state).verified, 4,
    `verified يجب أن يكون 4 لا ${stored(state).verified} — كان 3→7 قبل هذه المرحلة`);
  assert.strictEqual(state.puts.length, 1, 'وكتابة واحدة فقط');

  assert.deepStrictEqual(seen[0], { status: 200, updated: true,  replayed: false, verified: 4 });
  for (let i = 1; i < 4; i++) {
    assert.deepStrictEqual(seen[i], { status: 200, updated: false, replayed: true, verified: 4 },
      `الإرسال ${i + 1} يجب أن يكون إعادة لا احتسابًا`);
  }
  assert.strictEqual(ledger(state).length, 1, 'ومدخلة واحدة في السجل');
});

test('resultId مختلف لكل نتيجة مشروعة ⇒ كل نتيجة تُحتسب', async () => {
  const state = mockGitHub(baseDb(), ['ok']);
  for (let i = 1; i <= 3; i++) {
    const r = await call({ patternId: PID, success: true, resultId: 'result-distinct-000' + i });
    assert.strictEqual(r._json.updated, true, `النتيجة ${i} مشروعة فتُحتسب`);
    assert.strictEqual(r._json.replayed, false);
  }
  assert.strictEqual(stored(state).verified, 6, 'ثلاث زيادات');
  assert.strictEqual(ledger(state).length, 3, 'وثلاث مدخلات');
});

test('الفشل كذلك لا يُحتسب مرتين', async () => {
  const state = mockGitHub(baseDb(), ['ok']);
  for (let i = 0; i < 3; i++) await call({ patternId: PID, success: false, resultId: 'result-failonce-00001' });
  assert.strictEqual(stored(state).failures, 1, 'زيادة فشل واحدة');
  assert.strictEqual(state.puts.length, 1, 'وكتابة واحدة');
});

// ═══ 2. نجاح الكتابة ثم فقدان الاستجابة ═══════════════

test('نجاح الكتابة ثم فقدان الاستجابة ثم إعادة الطلب ⇒ لا تكرار', async () => {
  const RK = 'result-lostreply-00001';
  const state = mockGitHub(baseDb(), ['ok']);

  const first = await call({ patternId: PID, success: false, resultId: RK });
  assert.strictEqual(first._status, 200);
  assert.strictEqual(stored(state).failures, 1, 'الكتابة نجحت فعلًا');
  // الاستجابة ضاعت في الشبكة — العميل لا يعرف، فيُعيد الطلب نفسه
  const again = await call({ patternId: PID, success: false, resultId: RK });

  assert.strictEqual(again._status, 200, 'الإعادة تُجاب بنجاح لا بخطأ');
  assert.strictEqual(again._json.updated, false, 'لكن بلا احتساب');
  assert.strictEqual(again._json.replayed, true, 'وبعلامة إعادة صريحة');
  assert.strictEqual(again._json.failures, 1, 'وبالحالة الراهنة المخزَّنة');
  assert.strictEqual(state.puts.length, 1, 'ولا محاولة كتابة ثانية');
  assert.strictEqual(stored(state).failures, 1, 'والمخزَّن كما هو');
});

// ═══ 3. تعارض 409 ════════════════════════════════════

test('409 والمفتاح موجود في اللقطة الطازجة ⇒ إعادة لا احتساب', async () => {
  const RK = 'result-raceseen-000001';
  // كاتب آخر سجّل نفس النتيجة ورفع العدّاد بين قراءتنا وكتابتنا
  const state = mockGitHub(baseDb(), ['409', 'ok'], {
    interleave: s => {
      s.stored.patterns[0].verified = 4;
      s.stored.results = [{ k: RK, p: PID, o: 1, t: nowS() }];
    },
  });
  const res = await call({ patternId: PID, success: true, resultId: RK });

  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._json.updated, false, 'لا احتساب ثانٍ');
  assert.strictEqual(res._json.replayed, true, 'بل إعادة');
  assert.strictEqual(res._json.verified, 4, 'بالحالة التي كتبها الآخر');
  assert.strictEqual(stored(state).verified, 4, 'والمخزَّن 4 لا 5');
  assert.strictEqual(state.puts.length, 1, 'ومحاولة كتابة واحدة أُجهضت بالـ409');
});

test('409 والمفتاح غائب ⇒ إعادة تطبيق على اللقطة الطازجة بلا فقدان', async () => {
  const RK = 'result-raceunseen-0001';
  // كاتب آخر رفع verified لنتيجة **أخرى** — مفتاحنا غير موجود
  const state = mockGitHub(baseDb(), ['409', 'ok'], {
    interleave: s => {
      s.stored.patterns[0].verified = 9;
      s.stored.results = [{ k: 'result-someoneelse-001', p: PID, o: 1, t: nowS() }];
    },
  });
  const res = await call({ patternId: PID, success: false, resultId: RK });

  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._json.updated, true, 'نتيجتنا جديدة فتُحتسب');
  assert.strictEqual(res._json.replayed, false);
  assert.strictEqual(state.puts.length, 2, 'محاولتان: تعارض ثم نجاح');
  assert.strictEqual(res._json.failures, 1, 'زيادة واحدة');
  assert.strictEqual(res._json.verified, 9, 'وتحديث الكاتب الآخر محفوظ — لا فقدان');
  assert.strictEqual(stored(state).failures, 1, 'والمخزَّن يطابق الاستجابة');
  assert.strictEqual(stored(state).verified, 9);
  assert.strictEqual(ledger(state).length, 2, 'والمفتاحان معًا في السجل');
});

test('نتيجتان متزامنتان: كلتاهما تستقرّ، بلا فقدان ولا احتساب مزدوج', async () => {
  // A تكتب أولًا (interleave)، ثم نتيجتنا B تتعارض وتُعاد على اللقطة الطازجة.
  const A = 'result-concurrentA-001', B = 'result-concurrentB-001';
  const state = mockGitHub(baseDb(), ['409', 'ok'], {
    interleave: s => {
      s.stored.patterns[0].verified = 4;                 // أثر A
      s.stored.results = [{ k: A, p: PID, o: 1, t: nowS() }];
    },
  });
  const res = await call({ patternId: PID, success: false, resultId: B });

  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._json.updated, true, 'B احتُسبت');
  assert.strictEqual(stored(state).verified, 4, 'وA لم تُفقد');
  assert.strictEqual(stored(state).failures, 1, 'وB لم تُحتسب مرتين');
  const keys = ledger(state).map(e => e.k).sort();
  assert.deepStrictEqual(keys, [A, B].sort(), 'والمفتاحان كلاهما مسجَّل');

  // وإعادة إرسال أيٍّ منهما الآن لا تُحتسب
  const rA = await call({ patternId: PID, success: true,  resultId: A });
  const rB = await call({ patternId: PID, success: false, resultId: B });
  assert.strictEqual(rA._json.replayed, true, 'إعادة A');
  assert.strictEqual(rB._json.replayed, true, 'إعادة B');
  assert.strictEqual(stored(state).verified, 4, 'والعدّادات ثابتة');
  assert.strictEqual(stored(state).failures, 1);
});

// ═══ 4. رفض المفتاح الفاسد قبل الكتابة ════════════════

test('resultId مفقود أو غير صالح ⇒ 400 قبل أي قراءة أو كتابة', async () => {
  const cases = [
    ['غائب',        undefined],
    ['فارغ',        ''],
    ['قصير',        'abc'],
    ['15 حرفًا',     'a'.repeat(15)],
    ['رموز ممنوعة', 'bad/key with spaces!!'],
    ['طويل جدًا',    'a'.repeat(65)],
    ['ليس نصًّا',    12345],
  ];
  for (const [label, rid] of cases) {
    const state = mockGitHub(baseDb(), ['ok']);
    const res = await call({ patternId: PID, success: true, resultId: rid });
    assert.strictEqual(res._status, 400, `${label}: يجب أن يُرفض`);
    assert.match(String(res._json.error), /resultId/, `${label}: ورسالة تُسمّي السبب`);
    assert.strictEqual(state.puts.length, 0, `${label}: ولا كتابة`);
    assert.strictEqual(state.gets, 0, `${label}: ولا قراءة أصلًا`);
    assert.strictEqual(stored(state).verified, 3, `${label}: والمخزَّن كما هو`);
  }
});

test('الحدّ الأدنى المقبول 16 حرفًا يعمل', async () => {
  const state = mockGitHub(baseDb(), ['ok']);
  const res = await call({ patternId: PID, success: true, resultId: 'a'.repeat(16) });
  assert.strictEqual(res._status, 200, '16 حرفًا مقبول');
  assert.strictEqual(stored(state).verified, 4);
});

// ═══ 5. اختفاء النمط ⇒ لا نجاح كاذب ══════════════════

test('نمط غير موجود ⇒ 404 بلا كتابة', async () => {
  const state = mockGitHub(baseDb(), ['ok']);
  const res = await call({ patternId: 'rl-nope', success: true, resultId: 'result-nopattern-0001' });
  assert.strictEqual(res._status, 404);
  assert.strictEqual(state.puts.length, 0);
});

test('المفتاح مسجَّل والنمط اختفى ⇒ 410 لا نجاح كاذب', async () => {
  const RK = 'result-patterngone-001';
  const db = baseDb([{ k: RK, p: PID, o: 1, t: nowS() }]);
  db.patterns = [];                       // النمط حُذف بعد تسجيل النتيجة
  const state = mockGitHub(db, ['ok']);
  const res = await call({ patternId: PID, success: true, resultId: RK });

  assert.strictEqual(res._status, 410, 'المورد كان موجودًا وزال');
  assert.ok(!res._json.updated,  'ولا updated');
  assert.ok(!res._json.replayed, 'ولا replayed');
  assert.strictEqual(state.puts.length, 0, 'ولا كتابة');
});

test('النمط يختفي من اللقطة الطازجة بعد 409 ⇒ لا 200', async () => {
  const state = mockGitHub(baseDb(), ['409', 'ok'], { getScript: ['ok', 'gone'] });
  const res = await call({ patternId: PID, success: false, resultId: 'result-vanish-0000001' });
  assert.notStrictEqual(res._status, 200);
  assert.ok(!(res._json && res._json.updated));
});

// ═══ 6. حدود السجل: 500 مدخلة و7 أيام ════════════════

test('تجاوز حدّ 500 مدخلة ⇒ يُقلَّم إلى 500 والأقدم يُزاح', async () => {
  const seedResults = [];
  for (let i = 0; i < 500; i++) {
    seedResults.push({ k: 'result-seed-' + String(i).padStart(10, '0'), p: PID, o: 1, t: nowS() - 10 });
  }
  const state = mockGitHub(baseDb(seedResults), ['ok']);
  const res = await call({ patternId: PID, success: true, resultId: 'result-overflow-00001' });

  assert.strictEqual(res._status, 200);
  const L = ledger(state);
  assert.strictEqual(L.length, 500, 'لا يتجاوز الحدّ');
  assert.strictEqual(L[L.length - 1].k, 'result-overflow-00001', 'والأحدث موجود');
  assert.ok(!L.some(e => e.k === 'result-seed-0000000000'), 'والأقدم أُزيح');
  assert.strictEqual(L[0].k, 'result-seed-0000000001', 'والإزاحة من الأقدم');
});

test('النتائج الأقدم من 7 أيام تُزال', async () => {
  const old1 = { k: 'result-expired-000001', p: PID, o: 1, t: nowS() - 8 * DAY };
  const old2 = { k: 'result-expired-000002', p: PID, o: 0, t: nowS() - 7 * DAY - 60 };
  const fresh = { k: 'result-stillvalid-001', p: PID, o: 1, t: nowS() - 6 * DAY };
  const state = mockGitHub(baseDb([old1, old2, fresh]), ['ok']);
  const res = await call({ patternId: PID, success: true, resultId: 'result-newone-0000001' });

  assert.strictEqual(res._status, 200);
  const keys = ledger(state).map(e => e.k);
  assert.ok(!keys.includes('result-expired-000001'), 'المنتهية (8 أيام) أُزيلت');
  assert.ok(!keys.includes('result-expired-000002'), 'والمنتهية (7 أيام ودقيقة) أُزيلت');
  assert.ok(keys.includes('result-stillvalid-001'), 'وغير المنتهية (6 أيام) بقيت');
  assert.ok(keys.includes('result-newone-0000001'), 'والجديدة أُضيفت');
});

test('مدخلة بلا طابع زمني صحيح تُعتبر غير منتهية (توافق مع سجل أقدم)', async () => {
  const state = mockGitHub(baseDb([{ k: 'result-nostamp-000001', p: PID, o: 1 }]), ['ok']);
  const res = await call({ patternId: PID, success: true, resultId: 'result-nostamp-000001' });
  assert.strictEqual(res._json.replayed, true, 'تُحترم كمسجَّلة لا تُسقَط');
  assert.strictEqual(state.puts.length, 0, 'ولا كتابة');
});

// ═══ 7. حدّ الحماية — موثَّق صراحةً لا مُخفى ══════════

test('حدّ مُعلَن: مفتاح أُزيل من السجل يُحتسب مرة أخرى إذا أُعيد إرساله', async () => {
  const RK = 'result-evicted-000001';
  // النتيجة سُجِّلت قبل 8 أيام ⇒ تُزال بالتقليم، فإعادة إرسالها تُحتسب
  const state = mockGitHub(baseDb([{ k: RK, p: PID, o: 1, t: nowS() - 8 * DAY }]), ['ok']);
  const res = await call({ patternId: PID, success: true, resultId: RK });

  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._json.updated, true,
    'تُحتسب — الحماية نافذة زمنية لا ضمان أبدي');
  assert.strictEqual(res._json.replayed, false);
  assert.strictEqual(stored(state).verified, 4, 'والعدّاد ارتفع فعلًا');
  // وهذا هو الثمن المُعلَن: لا يُدَّعى منع التكرار إلى الأبد.
});

test('حدّ مُعلَن: مفتاح أُزيح بالتقليم العددي يُحتسب مرة أخرى', async () => {
  const RK = 'result-pushedout-00001';
  const seedResults = [{ k: RK, p: PID, o: 1, t: nowS() - 20 }];
  for (let i = 0; i < 500; i++) {
    seedResults.push({ k: 'result-filler-' + String(i).padStart(8, '0'), p: PID, o: 1, t: nowS() - 10 });
  }
  // 501 مدخلة ⇒ التقليم عند القراءة يُزيح الأقدم (وهو مفتاحنا)
  const state = mockGitHub(baseDb(seedResults), ['ok']);
  const res = await call({ patternId: PID, success: true, resultId: RK });

  assert.strictEqual(res._json.updated, true, 'أُزيح فيُحتسب — نفس الحدّ المُعلَن');
  assert.strictEqual(stored(state).verified, 4);
});

// ═══ 8. الفشل: شبكة وكتابة مستمرة ════════════════════

test('فشل شبكة في القراءة ⇒ 500 بلا كتابة', async () => {
  const state = mockGitHub(baseDb(), ['ok'], { getScript: ['throw', 'throw', 'throw'] });
  const res = await call({ patternId: PID, success: true, resultId: 'result-readfail-00001' });
  assert.strictEqual(res._status, 500);
  assert.match(String(res._json.error), /read/i);
  assert.strictEqual(state.puts.length, 0);
  assert.strictEqual(stored(state).verified, 3);
});

test('فشل كتابة مستمر (409×3) ⇒ 500 ولا تحديث ولا تسجيل', async () => {
  const state = mockGitHub(baseDb(), ['409', '409', '409']);
  const res = await call({ patternId: PID, success: false, resultId: 'result-writefail-0001' });

  assert.strictEqual(res._status, 500);
  assert.ok(!res._json.updated, 'لا نجاح كاذب');
  assert.strictEqual(stored(state).failures, 0, 'والمخزَّن لم يتغيّر');
  assert.ok(!ledger(state).some(e => e.k === 'result-writefail-0001'),
    'والمفتاح لم يُسجَّل — لا تسجيل بلا احتساب');
});

test('خطأ كتابة غير قابل للإعادة (403) ⇒ 500 بمحاولة واحدة', async () => {
  const state = mockGitHub(baseDb(), ['403']);
  const res = await call({ patternId: PID, success: true, resultId: 'result-forbidden-0001' });
  assert.strictEqual(res._status, 500);
  assert.strictEqual(state.puts.length, 1);
  assert.strictEqual(stored(state).verified, 3);
});

test('documented: فشل شبكة في الكتابة يخرج استثناءً — ولا تحديث', async () => {
  // سلوك مسجَّل لا مُصلَح: githubPut لا يلتقط رمي fetch. لا يدّعي نجاحًا.
  const state = mockGitHub(baseDb(), ['throw']);
  let threw = false;
  try {
    await handler({ method: 'POST', body: {
      patternId: PID, success: true, resultId: 'result-netthrow-00001', sessionId: 'net-throw-session',
    } }, mkRes());
  } catch (e) { threw = true; }
  assert.strictEqual(threw, true, 'يخرج استثناءً — خطر متبقٍّ مسجَّل');
  assert.strictEqual(stored(state).verified, 3, 'والمهم: لا تحديث');
});

// ═══ 9. العقد الموحَّد وخاصّية التطابق ═══════════════

test('خاصّية: كل 200 يحمل updated/replayed/resultId ويطابق المخزَّن', async () => {
  const scripts = [['ok'], ['409', 'ok']];
  let n = 0;
  for (const script of scripts) {
    for (const success of [true, false]) {
      const state = mockGitHub(baseDb(), script);
      const res = await call({ patternId: PID, success, resultId: 'result-prop-' + String(++n).padStart(10, '0') });
      if (res._status !== 200) continue;
      const p = stored(state);
      assert.strictEqual(typeof res._json.updated, 'boolean', 'updated منطقي دائمًا');
      assert.strictEqual(typeof res._json.replayed, 'boolean', 'replayed منطقي دائمًا');
      assert.ok(res._json.resultId, 'والمفتاح مُعاد');
      assert.strictEqual(res._json.verified, p.verified, `[${script}/${success}] verified`);
      assert.strictEqual(res._json.failures, p.failures, `[${script}/${success}] failures`);
      assert.strictEqual(res._json.approved, p.approved, `[${script}/${success}] approved`);
      assert.strictEqual(res._json.confidence, +p.confidence.toFixed(3), `[${script}/${success}] confidence`);
    }
  }
});

// ═══ 10. العتبات والسياسة لم تُمَسّ ═════════════════

test('سياسة الاعتماد والعتبات كما هي — لم تُغيَّر في هذه المرحلة', () => {
  const fs  = require('node:fs');
  const src = fs.readFileSync(require.resolve('../api/patterns/verify.js'), 'utf8');
  assert.match(src, /const MIN_VERIFIED\s*=\s*3;/,            'MIN_VERIFIED = 3');
  assert.match(src, /const MIN_CONFIDENCE\s*=\s*0\.60;/,       'MIN_CONFIDENCE = 0.60');
  assert.match(src, /const MAX_FAILURES\s*=\s*3;/,             'MAX_FAILURES = 3');
  assert.match(src, /const MAX_VERIFIES_PER_SESSION\s*=\s*5;/, 'حدّ الجلسة = 5');
  assert.match(src, /if \(verified < MIN_VERIFIED\) return 0;/, 'منحنى الثقة كما هو');
  assert.match(src, /const LEDGER_MAX\s*=\s*500;/,             'حدّ السجل 500');
  assert.match(src, /const LEDGER_TTL_SEC\s*=\s*7 \* 24 \* 60 \* 60;/, 'العمر 7 أيام');
});
