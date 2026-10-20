// ═══════════════════════════════════════════════════════════════════════
// مخطط سجل الإصلاح v2 + سياسة الأسرار/الاحتفاظ/التدقيق
// تشغيل:  node --test vercel-api/test/healing_log_schema.test.js
//
// الملفان healing_log_schema.js وhealing_log_policy.js غير مربوطين بالمحرك بعد.
// اختبارات التوافق [COMPAT-*] تشغّل self_healing_engine.js الحقيقي وتقارن الحقول التي
// ينتجها فعلًا بالمخطط — فلو أضاف المحرك حقلًا أو نوعًا جديدًا يسقط الاختبار قبل أن
// يتفرّق المخطط عن الواقع.
// أسرار الاختبار تُركَّب وقت التشغيل (لا نصوص كاملة في الملف) كي لا تُنبّه كاشفات الأسرار.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const S  = require(path.join(PUBLIC_DIR, 'healing_log_schema.js'));
const P  = require(path.join(PUBLIC_DIR, 'healing_log_policy.js'));
// healing_store.js اختياري هنا: إن لم يكن في الشجرة تُتخطّى اختبارات التوافق معه بوضوح
let HS = null;
try { HS = require(path.join(PUBLIC_DIR, 'healing_store.js')); } catch (_) { /* غير موجود */ }
const NO_HS = HS ? false : 'healing_store.js غير موجود في الشجرة';
const { SelfHealing, Status } = require(path.join(PUBLIC_DIR, 'self_healing_engine.js'));
const templ = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'healing_log.json'), 'utf8'));

const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
let _t = 1_700_000_000_000;
const clock = () => (_t += 1000);
let _r = 0;
const rnd = () => ((++_r * 7919) % 1000) / 1000 + 0.0005;   // حتمي

// ═══ SHA-256 ═══════════════════════════════════════════════════════════
test('[SHA-1] sha256 يطابق crypto على مدخلات متنوعة (فارغ، حدود الكتلة، Unicode)', () => {
  const inputs = ['', 'a', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65),
                  'x'.repeat(1000), 'مرحبا ⚡ 😀 \u0000 \n', 'el.innerHTML = "<b>" + u + "</b>";'];
  for (const s of inputs) assert.strictEqual(S.sha256(s), sha(s), JSON.stringify(s.slice(0, 20)) + ' len=' + s.length);
});

// ═══ معرّفات وتوقيت ════════════════════════════════════════════════════
test('[ID-1] معرّف الحادثة متوافق مع صيغة المحرك ومع healing_store', { skip: NO_HS }, () => {
  const id = S.newIncidentId({ now: clock, rnd });
  assert.match(id, /^SH_\d{10,16}_[A-Z0-9]{1,8}$/);
  assert.ok(HS.normalizeEntry({ id, timestamp: new Date().toISOString(), type: 'ENGINE_ERROR', status: 'PENDING_REVIEW', healingResult: 'SKIPPED' }).ok);
});
test('[ID-2] معرّف المحاولة مختلف الصيغة عن الحادثة وفريد', () => {
  const ids = new Set();
  for (let i = 0; i < 50; i++) ids.add(S.newAttemptId({ now: clock, rnd }));
  assert.strictEqual(ids.size, 50);
  for (const id of ids) assert.match(id, /^SHA_\d{10,16}_[A-Z0-9]{4,8}$/);
});
test('[TS-1] canonicalTime يوحّد الصيغ ويرفض غير الصالح', () => {
  assert.strictEqual(S.canonicalTime(0), '1970-01-01T00:00:00.000Z');
  assert.strictEqual(S.canonicalTime(new Date(1700000000123)), '2023-11-14T22:13:20.123Z');
  assert.strictEqual(S.canonicalTime('2023-11-14T22:13:20Z'), '2023-11-14T22:13:20.000Z');
  for (const bad of [null, undefined, 'yesterday', NaN, {}, '2023-13-99T00:00:00Z', Infinity]) {
    assert.strictEqual(S.canonicalTime(bad), null, String(bad));
  }
});

// ═══ ربط نتائج الاختبار بالتعديل ═══════════════════════════════════════
const BASE = 'el.innerHTML = u;';
const PATCH = 'el.textContent = u;';
function attemptWithTests(base, patch, passed, n, incidentId) {
  const a = S.makeAttempt({ incidentId, n, baseCode: base, patchedCode: patch, reason: 'r', now: clock, rnd });
  return S.recordTestRun(a, { syntax: { pass: true } }, { passed, now: clock, rnd });
}
function entryWith(attempts, status) {
  const id = S.newIncidentId({ now: clock, rnd });
  const list = attempts.map((a, i) => Object.assign({}, a, { incidentId: id, n: i + 1,
    testRun: a.testRun && Object.assign({}, a.testRun) }));
  return { id, timestamp: new Date(_t).toISOString(), type: 'ENGINE_ERROR', engine: 'x', fileName: 'a.js', detail: '',
           status: status || 'PENDING_REVIEW', healingResult: 'PASS', attempts: list, currentAttemptId: list[list.length - 1].attemptId };
}

test('[EVID-1] الأختام تأتي من المحاولة لا من المنادي، والكود نفسه لا يُخزَّن', () => {
  const a = attemptWithTests(BASE, PATCH, true, 1, 'SH_1700000000000_AAAA');
  assert.strictEqual(a.testRun.baseSha, sha(BASE));
  assert.strictEqual(a.testRun.patchSha, sha(PATCH));
  assert.ok(!JSON.stringify(a).includes('textContent'), 'نصّ الكود يجب ألا يظهر في المحاولة');
  assert.deepStrictEqual(S.verifyEvidence(a, BASE, PATCH), { ok: true, reasons: [] });
});
test('[EVID-2] نتيجة اختبار لا تُنسب إلى تعديل مختلف عمّا اختُبر', () => {
  const a = attemptWithTests(BASE, PATCH, true, 1, 'SH_1700000000000_AAAA');
  const r = S.verifyEvidence(a, BASE, 'el.textContent = u; fetch(evil);');
  assert.strictEqual(r.ok, false);
  assert.ok(r.reasons.includes('PATCH_DIFFERS_FROM_TESTED'));
});
test('[EVID-3] تغيّر الكود الأصلي بعد الاختبار يُبطل الدليل', () => {
  const a = attemptWithTests(BASE, PATCH, true, 1, 'SH_1700000000000_AAAA');
  const r = S.verifyEvidence(a, BASE + ' // edited', PATCH);
  assert.ok(r.reasons.includes('BASE_CODE_CHANGED_SINCE_TEST'));
});
test('[EVID-4] اختبار فاشل ليس دليل اعتماد حتى لو طابقت الأختام', () => {
  const a = attemptWithTests(BASE, PATCH, false, 1, 'SH_1700000000000_AAAA');
  assert.ok(S.verifyEvidence(a, BASE, PATCH).reasons.includes('TESTS_NOT_PASSED'));
});
test('[EVID-5] محاولة بلا اختبارات، أو بلا الكود، ليست دليلًا', () => {
  const a = S.makeAttempt({ incidentId: 'SH_1700000000000_AAAA', baseCode: BASE, patchedCode: PATCH, now: clock, rnd });
  assert.ok(S.verifyEvidence(a, BASE, PATCH).reasons.includes('NO_TESTS'));
  const b = attemptWithTests(BASE, PATCH, true, 1, 'SH_1700000000000_AAAA');
  assert.ok(S.verifyEvidence(b, undefined, PATCH).reasons.includes('CODE_MISSING'));
});
test('[EVID-6] نتيجة محاولة أقدم لا تبرّر تعديلًا أحدث (ATTEMPT_SUPERSEDED)', () => {
  const a1 = attemptWithTests(BASE, PATCH, true, 1, 'x');
  const patch2 = 'el.textContent = String(u);';
  const a2 = attemptWithTests(BASE, patch2, true, 2, 'x');
  const entry = entryWith([a1, a2]);
  // اعتماد المحاولة الأولى بنصّ التعديل الأول بعد وجود محاولة أحدث ⇒ مرفوض
  const old = S.approvalCheck(entry, BASE, PATCH, entry.attempts[0].attemptId);
  assert.deepStrictEqual([old.ok, old.reasons], [false, ['ATTEMPT_SUPERSEDED']]);
  // وبتمرير نصّ التعديل الأول دون معرّف: يُقارن بالأحدث ⇒ يفشل لاختلاف التعديل
  const mixed = S.approvalCheck(entry, BASE, PATCH);
  assert.strictEqual(mixed.ok, false);
  assert.ok(mixed.reasons.includes('PATCH_DIFFERS_FROM_TESTED'));
  // والأحدث بنصّه صحيح
  assert.strictEqual(S.approvalCheck(entry, BASE, patch2).ok, true);
});
test('[EVID-7] approvalCheck يرفض الحالات غير المعلّقة وحادثة بلا محاولات', () => {
  const a = attemptWithTests(BASE, PATCH, true, 1, 'x');
  assert.deepStrictEqual(S.approvalCheck(entryWith([a], 'APPROVED'), BASE, PATCH).reasons, ['STATUS_APPROVED']);
  const e = entryWith([a]); e.attempts = [];
  assert.deepStrictEqual(S.approvalCheck(e, BASE, PATCH).reasons, ['NO_ATTEMPTS']);
  assert.deepStrictEqual(S.approvalCheck(null, BASE, PATCH).reasons, ['NO_ENTRY']);
});
test('[EVID-8] ختم مزوَّر داخل testRun يُكشف في validateEntry', () => {
  const a = attemptWithTests(BASE, PATCH, true, 1, 'x');
  const entry = entryWith([a]);
  assert.strictEqual(S.validateEntry(entry).ok, true, JSON.stringify(S.validateEntry(entry).errors));
  entry.attempts[0].testRun.patchSha = sha('something else');
  const v = S.validateEntry(entry);
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some(e => /testRun مختوم بكود غير كود المحاولة/.test(e)));
});
test('[EVID-9] recordTestRun لا يعدّل المحاولة الأصلية', () => {
  const a = S.makeAttempt({ incidentId: 'x', baseCode: BASE, patchedCode: PATCH, now: clock, rnd });
  const snapshot = JSON.stringify(a);
  S.recordTestRun(a, {}, { passed: true, now: clock, rnd });
  assert.strictEqual(JSON.stringify(a), snapshot);
});

// ═══ التحقق والهجرة ════════════════════════════════════════════════════
test('[VAL-1] validateEntry يرفض enum/id/حقولًا مجهولة ويقبل v1 بلا attempts', () => {
  const v1 = { id: 'SH_1700000000000_AB12', timestamp: new Date().toISOString(), type: 'REGRESSION', engine: 'e', fileName: 'f',
               detail: '', status: 'PENDING_REVIEW', healingResult: 'SKIPPED', testResults: null, patch: null };
  assert.strictEqual(S.validateEntry(v1).ok, true);
  assert.ok(S.validateEntry(Object.assign({}, v1, { type: 'NOPE' })).errors.includes('type غير معروف'));
  assert.ok(S.validateEntry(Object.assign({}, v1, { id: 'bad' })).errors.includes('id غير صالح'));
  assert.ok(S.validateEntry(Object.assign({}, v1, { evil: 1 })).errors.some(e => /حقل غير معروف: evil/.test(e)));
  assert.strictEqual(S.validateEntry(null).ok, false);
});
test('[MIG-1] migrateEntry: v1 بعمل يصير v2 صالحًا لكنه unbound ولا يصلح دليل اعتماد', () => {
  const v1 = { id: 'SH_1700000000000_AB12', timestamp: '2023-11-14T22:13:20.000Z', type: 'ENGINE_ERROR', engine: 'e', fileName: 'f',
               detail: '', status: 'PENDING_REVIEW', healingResult: 'PASS', testResults: { syntax: { pass: true } },
               patch: [{ t: 1 }], patchedCode: PATCH };
  const snapshot = JSON.stringify(v1);
  const m = S.migrateEntry(v1);
  assert.strictEqual(JSON.stringify(v1), snapshot, 'الأصل لم يتغيّر');
  assert.strictEqual(S.validateEntry(m).ok, true, JSON.stringify(S.validateEntry(m).errors));
  assert.strictEqual(m.attempts.length, 1);
  assert.strictEqual(m.attempts[0].legacy, true);
  assert.strictEqual(m.attempts[0].patchSha, sha(PATCH));
  const chk = S.approvalCheck(m, BASE, PATCH);
  assert.strictEqual(chk.ok, false);
  assert.ok(chk.reasons.includes('LEGACY_UNBOUND'));
  assert.deepStrictEqual(S.migrateEntry(m), m, 'الهجرة مرتين لا تغيّر شيئًا');
});
test('[MIG-2] migrateEntry: v1 SKIPPED بلا عمل ⇒ attempts فارغة', () => {
  const v1 = { id: 'SH_1700000000000_AB12', timestamp: '2023-11-14T22:13:20.000Z', type: 'ENGINE_ERROR', engine: 'e', fileName: 'f',
               detail: '', status: 'PENDING_REVIEW', healingResult: 'SKIPPED', testResults: null, patch: null };
  assert.deepStrictEqual(S.migrateEntry(v1).attempts, []);
});
test('[TRANS-1] الانتقالات: المعلّق فقط يتغيّر والحالات الأخرى نهائية', () => {
  for (const to of ['APPROVED', 'REJECTED', 'ROLLED_BACK']) assert.strictEqual(S.canTransition('PENDING_REVIEW', to), true);
  for (const from of ['APPROVED', 'REJECTED', 'ROLLED_BACK']) {
    for (const to of S.STATUSES) assert.strictEqual(S.canTransition(from, to), false, from + '→' + to);
  }
  assert.strictEqual(S.canTransition('PENDING_REVIEW', 'NOPE'), false);
  assert.strictEqual(S.canTransition('toString', 'APPROVED'), false);
});

// ═══ توافق مع المحرك الفعلي ════════════════════════════════════════════
const OK_TESTS = () => ({ syntax: { pass: true }, regression: { pass: true }, security: { pass: true }, engines: {} });
const BAD_TESTS = () => ({ syntax: { pass: false }, regression: { pass: true }, security: { pass: true }, engines: {} });
function runEngineScenarios() {
  const provider = (code, problem) => (problem.usePatch ? { patchedCode: code + '\n// patched', reason: 'test', changedCount: 1 } : null);
  SelfHealing.registerPatchProvider && SelfHealing.registerPatchProvider(provider);
  const base = { engine: 'eng', fileName: 'a.js', code: 'var a = 1;', detail: 'd' };
  const out = {};
  out.skipped  = SelfHealing.heal(Object.assign({ type: 'ENGINE_ERROR' }, base));
  out.rolled   = SelfHealing.heal(Object.assign({ type: 'REGRESSION', usePatch: true, testRunner: BAD_TESTS }, base));
  out.pass     = SelfHealing.heal(Object.assign({ type: 'ENGINE_CONFLICT', usePatch: true, testRunner: OK_TESTS }, base));
  out.passRej  = SelfHealing.heal(Object.assign({ type: 'ENGINE_ERROR', usePatch: true, testRunner: OK_TESTS }, base));
  out.passFail = SelfHealing.heal(Object.assign({ type: 'ENGINE_ERROR', usePatch: true, testRunner: OK_TESTS }, base));
  out.passRej.reject();
  out.passFail.approve(() => { throw new Error('disk full'); });
  out.pass.approve(() => {});
  SelfHealing.registerPatchProvider && null;
  return out;
}
const scenarios = runEngineScenarios();
const engineLog = SelfHealing.getLog();

test('[COMPAT-1] كل الحقول التي ينتجها المحرك موجودة في المخطط', () => {
  const observed = new Set();
  for (const e of engineLog) Object.keys(e).forEach(k => observed.add(k));
  const unknown = [...observed].filter(k => S.ENTRY_FIELDS.indexOf(k) < 0);
  assert.deepStrictEqual(unknown, [], 'حقول ينتجها المحرك وغير معرّفة في المخطط');
  // ضمانة أن السيناريوهات غطّت الحقول الأهم فعلًا (وإلا فالمقارنة فارغة)
  for (const k of ['id', 'timestamp', 'type', 'status', 'healingResult', 'testResults', 'patch', 'patchedCode', 'rollbackMsg',
                   'approvedAt', 'rejectedAt', 'applyError', 'applyFailedAt', 'note', 'patchReason']) {
    assert.ok(observed.has(k), 'السيناريوهات لم تُنتج الحقل ' + k);
  }
});
test('[COMPAT-2] أنواع وحالات ونتائج المحرك ⊆ المخطط، والعكس للحالات والنتائج', () => {
  assert.deepStrictEqual(Object.values(Status).sort(), S.STATUSES.slice().sort());
  for (const e of engineLog) {
    assert.ok(S.TYPES.indexOf(e.type) >= 0, 'type: ' + e.type);
    assert.ok(S.STATUSES.indexOf(e.status) >= 0);
    assert.ok(S.RESULTS.indexOf(e.healingResult) >= 0);
  }
  const statuses = new Set(engineLog.map(e => e.status));
  for (const s of ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ROLLED_BACK']) assert.ok(statuses.has(s), 'لم تُغطَّ الحالة ' + s);
});
test('[COMPAT-3] كل مدخل ينتجه المحرك صالح بالمخطط، وبعد الهجرة أيضًا', () => {
  for (const e of engineLog) {
    const v = S.validateEntry(e);
    assert.strictEqual(v.ok, true, e.id + ': ' + v.errors.join(' | '));
    const m = S.validateEntry(S.migrateEntry(e));
    assert.strictEqual(m.ok, true, 'بعد الهجرة ' + e.id + ': ' + m.errors.join(' | '));
  }
});
test('[COMPAT-4] ids المحرك تطابق صيغة الحادثة، والتوقيتات بالصيغة الموحّدة', () => {
  for (const e of engineLog) {
    assert.match(e.id, /^SH_\d{10,16}_[A-Z0-9]{1,8}$/);
    for (const k of ['timestamp', 'approvedAt', 'rejectedAt', 'applyFailedAt']) {
      if (e[k] !== undefined) assert.strictEqual(S.canonicalTime(e[k]), e[k], k + ' ليس بالصيغة الموحّدة');
    }
  }
});
test('[COMPAT-5] قالب healing_log.json وHealingStore متسقان مع المخطط', { skip: NO_HS }, () => {
  const doc = Object.keys(templ._meta.fields);
  assert.deepStrictEqual(doc.filter(k => S.ENTRY_FIELDS.indexOf(k) < 0), []);
  assert.deepStrictEqual(Object.keys(HS.FIELDS_DOC).filter(k => S.ENTRY_FIELDS.indexOf(k) < 0), []);
  assert.deepStrictEqual(HS.TYPES, S.TYPES);
  assert.deepStrictEqual(HS.STATUSES, S.STATUSES);
  assert.deepStrictEqual(HS.RESULTS, S.RESULTS);
});
test('[COMPAT-6] مدخلات المحرك تمرّ من healing_store.normalizeEntry (لا يسقطها المخطط الجديد)', { skip: NO_HS }, () => {
  for (const e of engineLog) assert.strictEqual(HS.normalizeEntry(e).ok, true, e.id);
});
test('[COMPAT-7] سلوك المحرك الحالي محفوظ: لا اعتماد لحادثة SKIPPED أو لتعديل غير مطابق', () => {
  assert.strictEqual(scenarios.skipped.result, 'SKIPPED');
  assert.strictEqual(SelfHealing.approve(scenarios.skipped.id, 'x').status, 'REJECTED');
  const pending = engineLog.find(e => e.status === 'PENDING_REVIEW' && e.healingResult === 'PASS');
  assert.ok(pending, 'لا حادثة معلّقة ناجحة');
  assert.strictEqual(SelfHealing.approve(pending.id, 'غير ما اختُبر').status, 'REJECTED');
});
test('[COMPAT-8] ربط الدليل يعمل على قيم المحرك الحقيقية: ختم المحاولة يطابق patchedCode المسجَّل', () => {
  const e = engineLog.find(x => x.healingResult === 'PASS' && typeof x.patchedCode === 'string');
  assert.ok(e);
  const a = S.makeAttempt({ incidentId: e.id, baseCode: 'var a = 1;', patchedCode: e.patchedCode, now: clock, rnd });
  const run = S.recordTestRun(a, e.testResults, { passed: true, now: clock, rnd });
  assert.strictEqual(S.verifyEvidence(run, 'var a = 1;', e.patchedCode).ok, true);
  assert.strictEqual(S.verifyEvidence(run, 'var a = 1;', e.patchedCode + ' ').ok, false);
});

// ═══ حماية الأسرار ═════════════════════════════════════════════════════
const fake = {
  aws:    'AKIA' + 'ABCDEFGH' + 'IJKLMNOP',
  gh:     'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8',
  jwt:    ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV'].join('.'),
  pass:   'Sup3r' + 'Secret' + 'Pass!',
  bearer: 'abcdef' + '0123456789' + 'ABCDEF',
  sk:     'sk' + '-live-' + 'abcdefghij' + '0123456789ABCD',
  pem:    '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END ' + 'RSA PRIVATE KEY-----',
  url:    'postgres://admin:' + 'p4ssw0rdX' + '@db.internal/app'
};
test('[SEC-1] redactText يحجب كل فئة نمطية ولا يبقى منها حرف', () => {
  for (const [k, secret] of Object.entries(fake)) {
    if (k === 'pass') continue;   // كلمة مرور مجرّدة بلا اسم تدلّ عليها: لا نمط يكشفها (انظر SEC-2 وSEC-7)
    const r = P.redactText('before ' + (k === 'bearer' ? 'Bearer ' : '') + secret + ' after');
    assert.ok(!r.text.includes(secret.slice(4, 20)), k + ': بقي السرّ: ' + r.text);
    assert.ok(Object.keys(r.findings).length >= 1, k + ' لم يُكتشف');
    assert.ok(r.text.startsWith('before ') && /after$/.test(r.text), k + ': النص المحيط تغيّر');
  }
});
test('[SEC-7] حدّ معروف موثّق: سرّ مجرّد بلا اسم ولا نمط معروف لا يُكتشف (الكشف نمطي لا شامل)', () => {
  assert.strictEqual(P.redactText('value is ' + fake.pass).text, 'value is ' + fake.pass);
});
test('[SEC-2] أسماء توحي بسرّ: تُحجب القيمة ويبقى الاسم', () => {
  const r = P.redactText('const password = "' + fake.pass + '"; const apiKey: "abcd1234efgh";');
  assert.ok(!r.text.includes(fake.pass) && !r.text.includes('abcd1234efgh'), r.text);
  assert.ok(/password = "\[REDACTED:assigned-secret\]"/.test(r.text), r.text);
});
test('[SEC-3] الكود العادي لا يُحجب (لا إيجابيات كاذبة على أنماط شائعة)', () => {
  const code = 'const token = getToken();\nel.innerHTML = "<b>" + user + "</b>";\nconst url = "https://example.com/a/b?x=1";\nfunction f(password) { return password.length; }';
  const r = P.redactText(code);
  assert.strictEqual(r.text, code);
  assert.deepStrictEqual(r.findings, {});
});
test('[SEC-4] redactDeep: يحجب داخل الكائنات والمصفوفات ومفاتيح حساسة، ويقصّ الضخم، ولا يلوّث prototype', () => {
  const evil = JSON.parse('{"__proto__": {"polluted": 1}, "constructor": 5, "password": "' + fake.pass + '", "n": [{"d": "' + fake.gh + '"}], "ok": 1}');
  const r = P.redactDeep(evil);
  assert.strictEqual(r.password, '[REDACTED:secret-key]');
  assert.ok(!JSON.stringify(r).includes(fake.gh));
  assert.strictEqual(r.ok, 1);
  assert.strictEqual(({}).polluted, undefined);
  assert.ok(!Object.prototype.hasOwnProperty.call(r, 'constructor'));
  const big = P.redactDeep('a'.repeat(50000));
  assert.ok(big.length < 21000 && /TRUNCATED:50000/.test(big));
});
test('[SEC-5] sanitizeEntry: يحذف patchedCode ويحجب الأسرار في detail/patch/testResults/attempts ويسجّل الفئات فقط', () => {
  const e = { id: 'SH_1700000000000_AB12', timestamp: '2023-11-14T22:13:20.000Z', type: 'ENGINE_ERROR', engine: 'e', fileName: 'f',
              detail: 'فشل مع ' + fake.aws, status: 'PENDING_REVIEW', healingResult: 'PASS',
              testResults: { log: 'Authorization: Bearer ' + fake.bearer }, patch: [{ line: 'const secret = "' + fake.pass + '";' }],
              patchedCode: 'const k = "' + fake.sk + '";', attempts: [{ patchReason: fake.url }] };
  const snapshot = JSON.stringify(e);
  const s = P.sanitizeEntry(e);
  assert.strictEqual(JSON.stringify(e), snapshot, 'الأصل لم يتغيّر');
  assert.ok(!('patchedCode' in s));
  const text = JSON.stringify(s);
  for (const v of [fake.aws, fake.bearer, fake.pass, fake.sk, 'p4ssw0rdX']) assert.ok(!text.includes(v), 'تسرّب: ' + v.slice(0, 6));
  assert.ok(s.redaction.count >= 4 && s.redaction.kinds.length >= 3);
  assert.ok(!JSON.stringify(s.redaction).includes(fake.pass), 'redaction يحوي فئات فقط');
  const kept = P.sanitizeEntry(e, { keepPatchedCode: true });
  assert.ok('patchedCode' in kept && !kept.patchedCode.includes(fake.sk), 'حتى عند الإبقاء يُحجب');
});
test('[SEC-6] scanSecrets يكشف التسرّب في نص التصدير الفعلي', () => {
  assert.ok(Object.keys(P.scanSecrets('x ' + fake.gh)).length >= 1);
  assert.deepStrictEqual(P.scanSecrets('نص عادي'), {});
});

// ═══ الاحتفاظ والأرشفة ═════════════════════════════════════════════════
const DAYMS = 86400000;
const NOW = Date.UTC(2026, 9, 20);
function mk(i, ageDays, status, extra) {
  return Object.assign({ id: 'SH_' + (1700000000000 + i) + '_T' + i, timestamp: new Date(NOW - ageDays * DAYMS).toISOString(),
    type: 'ENGINE_ERROR', engine: 'e', fileName: 'f' + i + '.js', detail: 'd', status: status || 'REJECTED',
    healingResult: 'PASS', testResults: { big: 'x'.repeat(200) }, patch: [{ l: 1 }], patchedCode: 'code' }, extra || {});
}
test('[RET-1] العمر: القديم يُؤرشف، المعلّق لا ينتهي بالعمر', () => {
  const entries = [mk(1, 1), mk(2, 100), mk(3, 200, 'PENDING_REVIEW'), mk(4, 95, 'APPROVED')];
  const r = P.applyRetention(entries, [], { maxAgeDays: 90 }, NOW);
  assert.deepStrictEqual(r.live.map(e => e.id).sort(), [entries[0].id, entries[2].id].sort());
  assert.deepStrictEqual(r.archived.map(a => a.id).sort(), [entries[1].id, entries[3].id].sort());
});
test('[RET-2] الأرشيف مضغوط: بلا patch ولا testResults ولا كود', () => {
  const r = P.applyRetention([mk(1, 200)], [], { maxAgeDays: 90 }, NOW);
  const rec = r.archive[0];
  for (const k of ['patch', 'testResults', 'patchedCode', 'detail']) assert.ok(!(k in rec), k);
  assert.strictEqual(rec.archiveReason, 'age>90d');
  assert.ok(rec.archivedAt);
});
test('[RET-3] سقف العدد: يُزال الأقدم غير المعلّق أولًا', () => {
  const entries = [mk(1, 1, 'PENDING_REVIEW'), mk(2, 2), mk(3, 3, 'PENDING_REVIEW'), mk(4, 4), mk(5, 5)];
  const r = P.applyRetention(entries, [], { maxEntries: 3, maxAgeDays: 999 }, NOW);
  assert.strictEqual(r.live.length, 3);
  assert.ok(r.live.filter(e => e.status === 'PENDING_REVIEW').length === 2, 'المعلّقة محفوظة');
  assert.deepStrictEqual(r.archived.map(a => a.id).sort(), [entries[3].id, entries[4].id].sort());
});
test('[RET-4] سقف الحجم يُحترم', () => {
  const entries = Array.from({ length: 30 }, (_, i) => mk(i, i + 1));
  const r = P.applyRetention(entries, [], { maxBytes: 3000, maxAgeDays: 999, maxEntries: 999 }, NOW);
  assert.ok(JSON.stringify(r.live).length <= 3000);
  assert.ok(r.archived.length > 0);
});
test('[RET-5] الأرشيف نفسه محدود العمر والعدد ولا يكرّر المعرّفات', () => {
  const old = { id: 'SH_1_OLD', archivedAt: new Date(NOW - 400 * DAYMS).toISOString() };
  const keep = { id: 'SH_2_KEEP', archivedAt: new Date(NOW - 10 * DAYMS).toISOString() };
  const r = P.applyRetention([], [old, keep, keep], { archiveMaxAgeDays: 365 }, NOW);
  assert.deepStrictEqual(r.archive.map(a => a.id), ['SH_2_KEEP']);
  assert.deepStrictEqual(r.purged, ['SH_1_OLD']);
  const cap = P.applyRetention([], Array.from({ length: 10 }, (_, i) => ({ id: 'SH_' + i, archivedAt: new Date(NOW - i * DAYMS).toISOString() })), { archiveMaxEntries: 4 }, NOW);
  assert.strictEqual(cap.archive.length, 4);
  assert.strictEqual(cap.purged.length, 6);
});
test('[RET-6] لا يعدّل المدخلات ولا يرمي على مدخلات سيئة', () => {
  const entries = [mk(1, 500)]; const snap = JSON.stringify(entries);
  P.applyRetention(entries, [], {}, NOW);
  assert.strictEqual(JSON.stringify(entries), snap);
  assert.doesNotThrow(() => P.applyRetention(null, undefined, null, NOW));
});

// ═══ سجل التدقيق ═══════════════════════════════════════════════════════
function trailWithEvents() {
  const t = P.createAuditTrail({ now: clock });
  t.append('incident.created', { incidentId: 'SH_1700000000000_AAAA', actor: 'engine' });
  t.append('attempt.started', { incidentId: 'SH_1700000000000_AAAA', attemptId: 'SHA_1700000000000_BBBBBB' });
  t.append('tests.recorded', { incidentId: 'SH_1700000000000_AAAA', attemptId: 'SHA_1700000000000_BBBBBB', reasons: [] });
  return t;
}
test('[AUD-1] السلسلة سليمة، والحدث الجديد يتصل بهاش السابق', () => {
  const t = trailWithEvents();
  const ev = t.events();
  assert.strictEqual(ev[0].prevHash, P.GENESIS);
  assert.strictEqual(ev[1].prevHash, ev[0].hash);
  assert.deepStrictEqual(t.verify(), { ok: true, index: -1 });
});
test('[AUD-2] التلاعب يُكشف: تعديل، حذف، إعادة ترتيب، إدراج', () => {
  const base = trailWithEvents().export();
  const clone = () => JSON.parse(JSON.stringify(base.events));
  let ev = clone(); ev[1].actor = 'someone-else';
  assert.strictEqual(P.verifyAuditChain(ev, base.anchorHash).ok, false);
  ev = clone(); ev.splice(1, 1);
  assert.strictEqual(P.verifyAuditChain(ev, base.anchorHash).ok, false);
  ev = clone(); [ev[0], ev[1]] = [ev[1], ev[0]];
  assert.strictEqual(P.verifyAuditChain(ev, base.anchorHash).ok, false);
  ev = clone(); ev.splice(1, 0, Object.assign({}, ev[0], { seq: 99 }));
  assert.strictEqual(P.verifyAuditChain(ev, base.anchorHash).ok, false);
});
test('[AUD-3] القصّ بسقف maxEvents يبقي السلسلة قابلة للتحقق عبر الـanchor', () => {
  const t = P.createAuditTrail({ now: clock, maxEvents: 5 });
  for (let i = 0; i < 12; i++) t.append('status.changed', { incidentId: 'SH_1700000000000_AAAA', from: 'PENDING_REVIEW', to: 'REJECTED' });
  assert.strictEqual(t.events().length, 5);
  assert.notStrictEqual(t.anchor(), P.GENESIS);
  assert.strictEqual(t.verify().ok, true);
  const ex = t.export();
  assert.strictEqual(P.verifyAuditChain(ex.events, P.GENESIS).ok, false, 'بلا الـanchor الصحيح يفشل');
});
test('[AUD-4] recordApproval: يُسجّل المنح والرفض، والرفض يحمل الأسباب (تعديل مختلف / محاولة قديمة / legacy)', () => {
  const t = P.createAuditTrail({ now: clock });
  const a1 = attemptWithTests(BASE, PATCH, true, 1, 'x');
  const entry = entryWith([a1]);
  assert.strictEqual(t.recordApproval(entry, BASE, PATCH, { actor: 'naif' }).ok, true);
  assert.strictEqual(t.recordApproval(entry, BASE, PATCH + '!', { actor: 'naif' }).ok, false);
  const legacy = S.migrateEntry({ id: 'SH_1700000000000_AB12', timestamp: '2023-11-14T22:13:20.000Z', type: 'ENGINE_ERROR', engine: 'e', fileName: 'f',
    detail: '', status: 'PENDING_REVIEW', healingResult: 'PASS', testResults: {}, patch: [], patchedCode: PATCH });
  assert.strictEqual(t.recordApproval(legacy, BASE, PATCH).ok, false);
  const ev = t.events();
  assert.deepStrictEqual(ev.map(e => e.action), ['approval.granted', 'approval.denied', 'approval.denied']);
  assert.ok(ev[1].reasons.includes('PATCH_DIFFERS_FROM_TESTED'));
  assert.ok(ev[2].reasons.includes('LEGACY_UNBOUND'));
  assert.strictEqual(ev[0].actor, 'naif');
  assert.strictEqual(t.verify().ok, true);
});
test('[AUD-5] الانتقال غير المشروع يُرفض ويُسجَّل', () => {
  const t = P.createAuditTrail({ now: clock });
  const done = { id: 'SH_1700000000000_AAAA', status: 'APPROVED' };
  assert.strictEqual(t.recordStatusChange(done, 'REJECTED').ok, false);
  assert.strictEqual(t.recordRejection(done).ok, false);
  assert.strictEqual(t.recordRollback(done).ok, false);
  assert.ok(t.events().every(e => e.reasons.includes('TRANSITION_DENIED')));
  const pend = { id: 'SH_1700000000000_AAAA', status: 'PENDING_REVIEW' };
  assert.strictEqual(t.recordRollback(pend, { note: 'tests failed' }).ok, true);
  assert.strictEqual(t.events().pop().action, 'rollback.recorded');
});
test('[AUD-6] الملاحظات تُنظَّف من الأسرار، والـaction المجهول يُرفض', () => {
  const t = P.createAuditTrail({ now: clock });
  t.append('log.exported', { note: 'exported with ' + fake.gh });
  assert.ok(!JSON.stringify(t.events()).includes(fake.gh));
  assert.strictEqual(t.append('delete.everything', {}).ok, false);
  assert.strictEqual(t.events().length, 1);
});

// ═══ استقلالية وعدم الربط ══════════════════════════════════════════════
test('[ISO-1] الملفان يعملان في vm منفصل بلا require (متصفح)', () => {
  const ctx = vm.createContext({ console });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'healing_log_schema.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'healing_log_policy.js'), 'utf8'), ctx);
  assert.strictEqual(vm.runInContext('typeof HealingLogSchema.sha256("a")', ctx), 'string');
  assert.strictEqual(vm.runInContext('HealingLogPolicy.redactText("x").text', ctx), 'x');
});
test('[ISO-2] policy بلا schema يفشل بوضوح لا بصمت', () => {
  const ctx = vm.createContext({ console });
  assert.throws(() => vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'healing_log_policy.js'), 'utf8'), ctx), /healing_log_schema/);
});
test('[ISO-3] ربط عمدي: المخزن والمحوّل لا يشيران للمخطط/السياسة، والمحرك وحده يستعملهما (حُدِّث عند الربط)', () => {
  // المخزن يبقى وحدة مستقلة قائمة بذاتها (لا اعتماد على المخطط/السياسة)، والمحوّل غير معني بهما.
  for (const f of ['public/healing_store.js', 'public/server_repair_adapter.js']) {
    const p = path.join(__dirname, '..', f);
    if (!fs.existsSync(p)) continue;
    assert.ok(!/healing_log_(schema|policy)/.test(fs.readFileSync(p, 'utf8')), f + ' يشير إلى المخطط/السياسة');
  }
  // المحرك هو نقطة الربط الوحيدة: يطلب الوحدات الثلاث بأسمائها
  const eng = fs.readFileSync(path.join(__dirname, '..', 'public/self_healing_engine.js'), 'utf8');
  for (const n of ['healing_log_schema.js', 'healing_log_policy.js', 'healing_store.js']) {
    assert.ok(eng.includes(n), 'المحرك لا يطلب ' + n);
  }
});
function loadOrder(src) {
  // أسماء ملفات .js بالترتيب كما وردت في قائمة تحميل (يقبل ' أو ")
  return Array.from(src.matchAll(/['"]([\w.\-\/]+\.js)['"]/g)).map(m => m[1]);
}
test('[ISO-5] كل قائمة خادم تُحمّل المحرك تُحمّل قبله: المخطط ← السياسة ← المخزن (وإلا انحدر لسلوك قديم بصمت)', () => {
  const lists = ['api/analyze.js', 'api/patterns/save.js', 'public/engine_self_diagnosis.js'];
  for (const f of lists) {
    const names = loadOrder(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
    const at = n => names.indexOf(n);
    assert.ok(at('self_healing_engine.js') >= 0, f + ' لا تحمّل المحرك');
    assert.ok(at('healing_log_schema.js') >= 0 && at('healing_log_schema.js') < at('healing_log_policy.js'), f + ': المخطط قبل السياسة');
    assert.ok(at('healing_log_policy.js') < at('healing_store.js'), f + ': السياسة قبل المخزن');
    assert.ok(at('healing_store.js') < at('self_healing_engine.js'), f + ': المخزن قبل المحرك');
  }
});
test('[ISO-6] الواجهة: إن حُمّل المحرك في index.html فالوحدات الثلاث قبله؛ وإن لم يُحمَّل فلا تُحمَّل وحدها', () => {
  for (const f of ['index.html', 'public/index.html']) {
    const p = path.join(__dirname, '..', f);
    if (!fs.existsSync(p)) continue;
    const html = fs.readFileSync(p, 'utf8');
    const srcs = Array.from(html.matchAll(/<script[^>]*\ssrc="\/?([^"]+)"/g)).map(m => m[1]);
    const at = n => srcs.indexOf(n);
    if (at('self_healing_engine.js') < 0) {
      for (const n of ['healing_log_schema.js', 'healing_log_policy.js', 'healing_store.js']) {
        assert.ok(at(n) < 0, f + ' يحمّل ' + n + ' بلا المحرك (كود ميت)');
      }
    } else {
      assert.ok(at('healing_log_schema.js') >= 0 && at('healing_log_schema.js') < at('healing_log_policy.js') &&
                at('healing_log_policy.js') < at('healing_store.js') && at('healing_store.js') < at('self_healing_engine.js'),
                f + ': ترتيب الوحدات قبل المحرك خاطئ');
    }
  }
});
test('[ISO-4] حجم كل ملف معقول للصيانة (< 400 سطر)', () => {
  for (const f of ['healing_log_schema.js', 'healing_log_policy.js']) {
    const n = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8').split('\n').length;
    assert.ok(n < 400, f + ' = ' + n + ' سطر');
  }
});
