// ═══════════════════════════════════════════════════════════════════════
// healing_store.js v2 — حفظ/استرجاع مخطط v2 بلا فقد للأختام، وحدود المسؤولية مع السياسة
// تشغيل:  node --test vercel-api/test/healing_store_v2.test.js
//
// ما تُثبته هذه الاختبارات (لا تُخفَّف لتقبل سلوكًا غير آمن):
//  • attempts وأختام SHA-256 وعلاقة testRun بمحاولته تُحفظ وتُستعاد كما هي، ويبقى
//    approvalCheck قادرًا على الحكم بعد الدورة كاملة (حفظ → نص → استرجاع).
//  • أي دليل مشكوك فيه (ختم لا يطابق، تسلسل مكسور…) يُرفض مع حادثته ويظهر صراحةً في
//    dropped/skipped — لا حفظ صامت ولا إسقاط صامت.
//  • حقول المخزن = حقول المخطط (اختبار انحراف).
//  • المخزن لا يُقرّر الاحتفاظ: شبكة أمان فقط، لا تحذف صامتًا، تحمي PENDING_REVIEW أولًا.
//  • الأرشيف يُحفظ ويبقى عند save(list) بلا أرشيف.
// المخزن والمخطط والسياسة غير مربوطة بالمحرك: هذا الملف لا يمسّ المحرك إلا في اختبار
// توافق اختياري يُتخطّى بوضوح إن لم يوفّر المحرك attachStore.
// أسرار الاختبار تُركَّب وقت التشغيل كي لا تُنبّه كاشفات الأسرار.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const S = require(path.join(PUBLIC_DIR, 'healing_log_schema.js'));
const P = require(path.join(PUBLIC_DIR, 'healing_log_policy.js'));
let HS = null;
try { HS = require(path.join(PUBLIC_DIR, 'healing_store.js')); } catch (_) { /* غير موجود */ }
if (!HS) { test('[STORE] healing_store.js غير موجود في الشجرة', { skip: 'الملف غير موجود' }, () => {}); return; }

let _t = 1_700_000_000_000;
const clock = () => (_t += 1000);
const BASE = 'el.innerHTML = u;', PATCH = 'el.textContent = u;';

function makeEntry(over, attemptCount, codes) {
  const id = S.newIncidentId({ now: clock });
  const attempts = [];
  for (let n = 1; n <= (attemptCount || 1); n++) {
    const c = (codes && codes[n - 1]) || { base: BASE, patch: PATCH + ' // v' + n };
    let a = S.makeAttempt({ incidentId: id, n, baseCode: c.base, patchedCode: c.patch, reason: 'r' + n, now: clock });
    a = S.recordTestRun(a, { syntax: { pass: true }, security: { pass: true } }, { passed: true, now: clock });
    attempts.push(a);
  }
  const last = attempts[attempts.length - 1];
  return Object.assign({
    id, timestamp: new Date(_t).toISOString(), type: 'ENGINE_ERROR', engine: 'eng', fileName: 'a.js', detail: 'd',
    status: 'PENDING_REVIEW', healingResult: 'PASS', testResults: { syntax: { pass: true } }, patch: [{ l: 1 }],
    updatedAt: new Date(_t).toISOString(), attempts, currentAttemptId: last.attemptId
  }, over || {});
}
const clone = v => JSON.parse(JSON.stringify(v));
const roundTrip = list => HS.parse(HS.serialize(list));

// ═══ 1) توافق الحقول مع المخطط (اختبار انحراف) ═══════════════════════════
test('[FIELDS-1] حقول المخزن = حقول المخطط (ما عدا patchedCode الذي لا يُحفظ عمدًا)', () => {
  const schemaEntry = S.ENTRY_FIELDS.filter(f => f !== 'patchedCode').sort();
  assert.deepStrictEqual(HS.FIELDS.entry.slice().sort(), schemaEntry);
  assert.deepStrictEqual(HS.FIELDS.attempt.slice().sort(), S.ATTEMPT_FIELDS.slice().sort());
  assert.deepStrictEqual(HS.FIELDS.testRun.slice().sort(), S.TESTRUN_FIELDS.slice().sort());
});
test('[FIELDS-2] التعدادات متطابقة، وFIELDS_DOC يغطّي كل حقل مقبول', () => {
  assert.deepStrictEqual(HS.TYPES, S.TYPES);
  assert.deepStrictEqual(HS.STATUSES, S.STATUSES);
  assert.deepStrictEqual(HS.RESULTS, S.RESULTS);
  for (const f of HS.FIELDS.entry) {
    if (['restored', 'applyFailedAt', 'applyError', 'note', 'patchReason'].includes(f)) continue;   // حقول المحرك القديمة بلا نصّ في القالب
    assert.ok(f in HS.FIELDS_DOC, 'FIELDS_DOC ينقصه ' + f);
  }
});
test('[FIELDS-3] الحقل المجهول لا يُنسخ (حقول بيضاء فقط) ولا يلوّث prototype', () => {
  const e = makeEntry({ evil: 'x', __proto__: { polluted: 1 } });
  const r = HS.normalizeEntry(JSON.parse(JSON.stringify(e).replace('{', '{"__proto__":{"polluted":1},"evil":"x",')));
  assert.ok(r.ok);
  assert.ok(!('evil' in r.entry));
  assert.strictEqual(({}).polluted, undefined);
  const withAttemptExtra = clone(makeEntry());
  withAttemptExtra.attempts[0].secretField = 'x';
  withAttemptExtra.attempts[0].testRun.extra = 'y';
  const r2 = HS.normalizeEntry(withAttemptExtra);
  assert.ok(r2.ok);
  assert.ok(!('secretField' in r2.entry.attempts[0]) && !('extra' in r2.entry.attempts[0].testRun));
});

// ═══ 2) الحفظ والاسترجاع بلا فقد ═════════════════════════════════════════
test('[RT-1] دورة كاملة: الحقول v2 والأختام تبقى مطابقة حرفيًا', () => {
  const e = makeEntry({ redaction: { count: 2, kinds: ['jwt', 'aws-key-id'] } }, 3);
  assert.strictEqual(S.validateEntry(e).ok, true, JSON.stringify(S.validateEntry(e).errors));
  const back = roundTrip([e]);
  assert.ok(back.ok);
  assert.strictEqual(back.dropped.length, 0);
  const got = back.entries[0];
  for (const k of ['updatedAt', 'attempts', 'currentAttemptId', 'redaction']) {
    assert.deepStrictEqual(got[k], e[k], k);
  }
  assert.strictEqual(got.restored, true, 'المستعاد يُوسم restored');
  assert.strictEqual(S.validateEntry(got).ok, true, JSON.stringify(S.validateEntry(got).errors));
});
test('[RT-2] الأختام تبقى حاكمة بعد الدورة: approvalCheck ينجح للتعديل المختبَر ويفشل لغيره', () => {
  const e = makeEntry({}, 1, [{ base: BASE, patch: PATCH }]);
  const got = roundTrip([e]).entries[0];
  // الحادثة المستعادة ما زالت PENDING_REVIEW؛ الدليل وحده هو المختبَر هنا
  assert.deepStrictEqual(S.approvalCheck(got, BASE, PATCH), { ok: true, reasons: [], attemptId: e.attempts[0].attemptId });
  assert.ok(S.approvalCheck(got, BASE, PATCH + 'x').reasons.includes('PATCH_DIFFERS_FROM_TESTED'));
  assert.ok(S.approvalCheck(got, BASE + 'x', PATCH).reasons.includes('BASE_CODE_CHANGED_SINCE_TEST'));
});
test('[RT-3] المحاولة الأحدث تبقى الأحدث بعد الدورة (ATTEMPT_SUPERSEDED محفوظ)', () => {
  const e = makeEntry({}, 2, [{ base: BASE, patch: 'p1' }, { base: BASE, patch: 'p2' }]);
  const got = roundTrip([e]).entries[0];
  assert.deepStrictEqual(S.approvalCheck(got, BASE, 'p1', e.attempts[0].attemptId).reasons, ['ATTEMPT_SUPERSEDED']);
  assert.strictEqual(S.approvalCheck(got, BASE, 'p2').ok, true);
});
test('[RT-4] نتيجة الاختبار الفاشلة تُحفظ فاشلة (لا تتحول إلى ناجحة)', () => {
  let a = S.makeAttempt({ incidentId: 'SH_1700000000000_AAAA', n: 1, baseCode: BASE, patchedCode: PATCH, now: clock });
  a = S.recordTestRun(a, { syntax: { pass: false } }, { passed: false, now: clock });
  const e = makeEntry({ id: 'SH_1700000000000_AAAA', attempts: [a], currentAttemptId: a.attemptId, healingResult: 'FAIL', status: 'ROLLED_BACK' });
  const got = roundTrip([e]).entries[0];
  assert.strictEqual(got.attempts[0].testRun.passed, false);
  assert.ok(S.verifyEvidence(got.attempts[0], BASE, PATCH).reasons.includes('TESTS_NOT_PASSED'));
});
test('[RT-5] السجل المهاجَر (legacy/unbound) يُحفظ ويُستعاد موسومًا ولا يصلح دليل اعتماد', () => {
  const v1 = { id: 'SH_1700000000000_AB12', timestamp: '2023-11-14T22:13:20.000Z', type: 'ENGINE_ERROR', engine: 'e', fileName: 'f',
               detail: '', status: 'PENDING_REVIEW', healingResult: 'PASS', testResults: { syntax: { pass: true } }, patch: [{ l: 1 }], patchedCode: PATCH };
  const m = S.migrateEntry(v1);
  const got = roundTrip([m]).entries[0];
  assert.strictEqual(got.attempts[0].legacy, true);
  assert.strictEqual(got.attempts[0].testRun.unbound, true);
  assert.ok(!('patchedCode' in got));
  assert.ok(S.approvalCheck(got, BASE, PATCH).reasons.includes('LEGACY_UNBOUND'));
  assert.strictEqual(S.validateEntry(got).ok, true, JSON.stringify(S.validateEntry(got).errors));
});
test('[RT-6] patchedCode لا يُحفظ أبدًا (حتى مع attempts) ولا يظهر نصّ كود في الملف', () => {
  const e = makeEntry({ patchedCode: 'SECRET_CODE_MARKER_' + PATCH });
  const text = HS.serialize([e]);
  assert.ok(!text.includes('SECRET_CODE_MARKER_'));
  assert.ok(!('patchedCode' in roundTrip([e]).entries[0]));
});
test('[RT-7] ملف v1 القديم (بلا attempts) يُقرأ كما كان', () => {
  const v1text = JSON.stringify({ _meta: { version: '1.0.0' }, entries: [
    { id: 'SH_1700000000000_AB12', timestamp: '2023-11-14T22:13:20.000Z', type: 'REGRESSION', engine: 'e', fileName: 'f', detail: 'd',
      status: 'PENDING_REVIEW', healingResult: 'SKIPPED', testResults: null, patch: null }] });
  const r = HS.parse(v1text);
  assert.ok(r.ok);
  assert.strictEqual(r.entries.length, 1);
  assert.ok(!('attempts' in r.entries[0]));
  assert.deepStrictEqual(r.archive, []);
});
test('[RT-8] إصدار المخطط: الملف المحفوظ 2.x، و3.x يُرفض، والمصفوفة الخام القديمة تُقبل', () => {
  assert.strictEqual(JSON.parse(HS.serialize([makeEntry()]))._meta.version, '2.0.0');
  const future = JSON.stringify({ _meta: { version: '3.0.0' }, entries: [] });
  assert.strictEqual(HS.parse(future).ok, false);
  assert.ok(HS.parse(JSON.stringify([makeEntry()])).ok);
});

// ═══ 3) دليل مشكوك فيه ⇒ رفض صريح لا صمت ════════════════════════════════
const TAMPER = [
  ['ختم patchSha في testRun لا يطابق المحاولة', e => { e.attempts[0].testRun.patchSha = S.sha256('other'); }, /مختوم بكود غير كود المحاولة/],
  ['ختم baseSha في المحاولة معدَّل بعد الاختبار', e => { e.attempts[0].baseSha = S.sha256('other'); }, /مختوم بكود غير كود المحاولة/],
  ['SHA ليس 64 خانة سداسية', e => { e.attempts[0].patchSha = 'abc'; e.attempts[0].testRun.patchSha = 'abc'; }, /ليس SHA-256/],
  ['testRun لمحاولة أخرى', e => { e.attempts[0].testRun.attemptId = 'SHA_1700000000001_ZZZZZZ'; }, /testRun\.attemptId/],
  ['incidentId في المحاولة لا يطابق الحادثة', e => { e.attempts[0].incidentId = 'SH_1700000000000_ZZZZ'; }, /incidentId/],
  ['تسلسل n مكسور', e => { e.attempts[1].n = 5; }, /n يجب أن يكون 2/],
  ['attemptId مكرر', e => { e.attempts[1].attemptId = e.attempts[0].attemptId; e.attempts[1].testRun.attemptId = e.attempts[0].attemptId; }, /مكرر/],
  ['currentAttemptId غير موجود', e => { e.currentAttemptId = 'SHA_1700000000001_ZZZZZZ'; }, /currentAttemptId/],
  ['runId غير صالح', e => { e.attempts[0].testRun.runId = 'x'; }, /runId/],
  ['passed ليس منطقيًا', e => { e.attempts[0].testRun.passed = 'yes'; }, /passed/],
  ['توقيت ليس بالصيغة الموحّدة', e => { e.attempts[0].startedAt = '2023-11-14 22:13:20'; }, /startedAt/],
  ['redaction غير صالح', e => { e.redaction = { count: -1, kinds: [] }; }, /redaction/],
  ['updatedAt غير صالح', e => { e.updatedAt = 'yesterday'; }, /updatedAt/],
  ['attempts ليست مصفوفة', e => { e.attempts = {}; }, /ليست مصفوفة/],
];
for (const [name, mutate, re] of TAMPER) {
  test('[TAMPER] ' + name + ' ⇒ تُرفض الحادثة صراحةً (restore وsave)', () => {
    const e = makeEntry({}, 2);
    mutate(e);
    const r = HS.normalizeEntry(e);
    assert.strictEqual(r.ok, false, 'قُبل دليل مشكوك فيه');
    assert.match(r.error, re);
    // استرجاع: يظهر في dropped لا يختفي
    const back = HS.parse(JSON.stringify({ _meta: { version: '2.0.0' }, entries: [e] }));
    assert.strictEqual(back.entries.length, 0);
    assert.strictEqual(back.dropped.length, 1);
    assert.match(back.dropped[0].reason, re);
    // حفظ: يظهر في skipped ولا يُحفظ صامتًا
    const d = HS.serializeDetailed([e]);
    assert.strictEqual(d.skipped.length, 1);
    assert.strictEqual(d.skipped[0].id, e.id);
    assert.strictEqual(JSON.parse(d.text).entries.length, 0);
  });
}
test('[TAMPER] تعديل ختم داخل الملف المحفوظ يدويًا ⇒ تُرفض الحادثة عند الاسترجاع', () => {
  const e = makeEntry();
  const text = HS.serialize([e]);
  const tampered = text.split(e.attempts[0].patchSha).join(S.sha256('malicious patch'));
  // تعديل الختم في المكانين يبقيهما متطابقين: الاكتشاف عند approvalCheck (الكود المعروض لا يطابق)
  const got = HS.parse(tampered).entries[0];
  assert.ok(S.approvalCheck(got, BASE, PATCH + ' // v1').reasons.includes('PATCH_DIFFERS_FROM_TESTED'));
  // وتعديل موضع واحد فقط ⇒ رفض عند الاسترجاع
  const one = text.replace(e.attempts[0].testRun.patchSha, S.sha256('x'));
  const r = HS.parse(one);
  assert.strictEqual(r.entries.length, 0);
  assert.strictEqual(r.dropped.length, 1);
});
test('[TAMPER] أكثر من 50 محاولة تُرفض (لا قصّ جزئي يكسر التسلسل)', () => {
  const e = makeEntry({}, 51);
  assert.match(HS.normalizeEntry(e).error, /أكثر من 50/);
});
test('[TAMPER] حقل ضخم في نتائج الاختبار يُقصّ دون المساس بالأختام', () => {
  const e = makeEntry();
  e.attempts[0].testRun.results = { log: 'x'.repeat(200000) };
  const got = roundTrip([e]).entries[0];
  assert.strictEqual(got.attempts[0].testRun.results.truncated, true);
  assert.strictEqual(got.attempts[0].testRun.patchSha, e.attempts[0].patchSha);
  assert.strictEqual(S.validateEntry(got).ok, true);
});

// ═══ 4) حدود المسؤولية: المخزن ≠ السياسة ═════════════════════════════════
function mk(i, ageDays, status, extra) {
  const NOW = Date.UTC(2026, 9, 20);
  return Object.assign({
    id: 'SH_' + (1700000000000 + i) + '_T' + i, timestamp: new Date(NOW - ageDays * 86400000).toISOString(),
    type: 'ENGINE_ERROR', engine: 'e', fileName: 'f' + i + '.js', detail: 'd', status: status || 'REJECTED',
    healingResult: 'PASS', testResults: { big: 'x'.repeat(200) }, patch: [{ l: 1 }]
  }, extra || {});
}
test('[RESP-1] خط السياسة→المخزن: sanitize → applyRetention → save(live, archive) → load يعيد الاثنين، والشبكة الاحتياطية لا تُفعَّل', () => {
  const NOW = Date.UTC(2026, 9, 20);
  const raw = [mk(1, 1, 'PENDING_REVIEW'), mk(2, 2), mk(3, 200), mk(4, 300, 'APPROVED')];
  const clean = raw.map(e => P.sanitizeEntry(e));
  const r = P.applyRetention(clean, [], { maxAgeDays: 90 }, NOW);
  const store = HS.createStore();
  const res = store.save(r.live, r.archive);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.trimmed, 0, 'السياسة طُبّقت قبلًا فلا يتدخّل المخزن');
  assert.deepStrictEqual(res.skipped, []);
  const back = store.load();
  assert.deepStrictEqual(back.entries.map(e => e.id).sort(), r.live.map(e => e.id).sort());
  assert.deepStrictEqual(back.archive.map(a => a.id).sort(), r.archive.map(a => a.id).sort());
  assert.strictEqual(back.archive.length, 2);
});
test('[RESP-2] افتراضات المخزن تساوي افتراضات السياسة (لا سباق قرارات)', () => {
  assert.strictEqual(HS.DEFAULTS.maxEntries, P.DEFAULT_POLICY.maxEntries);
  assert.strictEqual(HS.DEFAULTS.maxBytes, P.DEFAULT_POLICY.maxBytes);
  assert.strictEqual(HS.DEFAULTS.maxArchive, P.DEFAULT_POLICY.archiveMaxEntries);
});
test('[RESP-3] شبكة العدد: لا حذف صامت، يُقدَّم غير المعلّق الأقدم، والمعلّق يُحفظ', () => {
  const list = [mk(1, 1, 'PENDING_REVIEW'), mk(2, 2), mk(3, 3, 'PENDING_REVIEW'), mk(4, 4), mk(5, 5)];
  const store = HS.createStore({ max: 3 });
  const res = store.save(list);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.trimmed, 2);
  assert.deepStrictEqual(res.trimmedIds.sort(), [list[3].id, list[4].id].sort());
  assert.deepStrictEqual(store.lastTrim.ids.sort(), res.trimmedIds.slice().sort());
  const ids = store.load().entries.map(e => e.id);
  assert.ok(ids.includes(list[0].id) && ids.includes(list[2].id), 'المعلّقان محفوظان');
});
test('[RESP-4] لو كلها معلّقة وتجاوزت السقف يُحذف الأقدم ويُبلَّغ عنه (لا صمت)', () => {
  const list = [mk(1, 1, 'PENDING_REVIEW'), mk(2, 2, 'PENDING_REVIEW'), mk(3, 3, 'PENDING_REVIEW')];
  const res = HS.createStore({ max: 2 }).save(list);
  assert.deepStrictEqual(res.trimmedIds, [list[2].id]);
});
test('[RESP-5] شبكة الحجم: تُبلّغ بما حذفت، وتحمي المعلّق أولًا، والنتيجة ضمن الحد', () => {
  const list = [mk(0, 1, 'PENDING_REVIEW')].concat(Array.from({ length: 30 }, (_, i) => mk(i + 1, i + 2)));
  const store = HS.createStore({ maxBytes: 12000 });
  const res = store.save(list);
  assert.strictEqual(res.ok, true);
  assert.ok(res.trimmed > 0 && res.trimmedIds.length === res.trimmed);
  assert.ok(!res.trimmedIds.includes(list[0].id), 'المعلّق لم يُحذف');
  assert.ok(store.serialize(store.load().entries).length <= 12000 + 2000);
});
test('[RESP-6] استعادة ملف أكبر من السقف: يُسقط غير المعلّق أولًا ويُذكر في dropped', () => {
  const list = [mk(1, 1, 'PENDING_REVIEW'), mk(2, 2), mk(3, 3, 'PENDING_REVIEW'), mk(4, 4)];
  const text = HS.serialize(list);
  const r = HS.createStore({ max: 2 }).parse(text);
  assert.deepStrictEqual(r.entries.map(e => e.status), ['PENDING_REVIEW', 'PENDING_REVIEW']);
  assert.strictEqual(r.dropped.length, 2);
});

// ═══ 5) الأرشيف ══════════════════════════════════════════════════════════
const arch = (i, ageDays) => ({
  id: 'SH_' + (1700000000000 + i) + '_A' + i, timestamp: '2026-01-01T00:00:00.000Z', type: 'ENGINE_ERROR', engine: 'e', fileName: 'f',
  status: 'REJECTED', healingResult: 'PASS', approvedAt: null, rejectedAt: '2026-01-02T00:00:00.000Z',
  archivedAt: new Date(Date.UTC(2026, 9, 20) - ageDays * 86400000).toISOString(), archiveReason: 'age>90d'
});
test('[ARCH-1] save(list) بلا أرشيف لا يمحو الأرشيف المحفوظ (سلوك استدعاء المحرك الحالي)', () => {
  const store = HS.createStore();
  store.save([mk(1, 1)], [arch(1, 5), arch(2, 6)]);
  store.save([mk(1, 1), mk(2, 2)]);          // كما يفعل Log._save في المحرك
  assert.strictEqual(store.load().archive.length, 2);
  store.save([mk(1, 1)], []);                // المسح يتطلب تمريرًا صريحًا
  assert.strictEqual(store.load().archive.length, 0);
});
test('[ARCH-2] مخزن جديد لم يحمّل بعد: save(list) يقرأ أرشيف الملف الموجود ويحفظه', () => {
  const backend = HS.memoryBackend();
  HS.createStore({ backend }).save([mk(1, 1)], [arch(1, 5)]);
  const fresh = HS.createStore({ backend });       // لا load()
  fresh.save([mk(1, 1), mk(2, 2)]);
  assert.strictEqual(HS.createStore({ backend }).load().archive.length, 1);
});
test('[ARCH-3] سجل الأرشيف بقائمة بيضاء: لا patch ولا حقول مجهولة، والتالف يُسقط ويُعدّ', () => {
  const dirty = Object.assign(arch(1, 5), { patch: [{ x: 1 }], testResults: { a: 1 }, patchedCode: 'CODE_MARKER', evil: 1 });
  const text = HS.serialize([], null, [dirty, { id: 'bad' }, arch(1, 5)]);
  // الفحص على قسم الأرشيف وحده (توثيق الحقول في _meta يذكر أسماء مثل patch)
  const archText = JSON.stringify(JSON.parse(text).archive);
  assert.ok(!/CODE_MARKER|testResults|"patch"|patchedCode|evil/.test(archText), archText);
  const r = HS.parse(text);
  assert.strictEqual(r.archive.length, 1, 'تالف ومكرر لا يدخلان');
});
test('[ARCH-4] سقف الأرشيف يُحترم (الأحدث أرشفةً يبقى)', () => {
  const list = Array.from({ length: 10 }, (_, i) => arch(i, i + 1));
  const r = HS.createStore({ maxArchive: 4 }).parse(HS.serialize([], null, list));
  assert.strictEqual(r.archive.length, 4);
  assert.deepStrictEqual(r.archive.map(a => a.id), list.slice(0, 4).map(a => a.id));
});
test('[ARCH-5] أرشيف السياسة الفعلي يمرّ كاملًا عبر المخزن (توافق السياسة والمخزن)', () => {
  const NOW = Date.UTC(2026, 9, 20);
  const e = makeEntry({ timestamp: new Date(NOW - 200 * 86400000).toISOString(), status: 'APPROVED' });
  const r = P.applyRetention([e], [], { maxAgeDays: 90 }, NOW);
  assert.strictEqual(r.archive.length, 1);
  const back = HS.parse(HS.serialize([], null, r.archive));
  assert.deepStrictEqual(back.archive, r.archive.map(a => HS.normalizeArchiveRecord(a)));
  assert.strictEqual(back.archive[0].patchSha, e.attempts[0].patchSha, 'ختم التعديل محفوظ في الأرشيف');
});

// ═══ 6) حجب الأسرار داخل المخزن عبر الخطّاف ══════════════════════════════
const fakeKey = 'AKIA' + 'ABCDEFGH' + 'IJKLMNOP';
test('[SAN-1] createStore({sanitize}) يحجب الأسرار قبل الكتابة ويحفظ redaction صالحًا', () => {
  const backend = HS.memoryBackend();
  const store = HS.createStore({ backend, sanitize: e => P.sanitizeEntry(e) });
  const e = makeEntry({ detail: 'فشل مع ' + fakeKey, patchedCode: 'const k = "' + fakeKey + '";' });
  const res = store.save([e]);
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.skipped, []);
  assert.ok(!backend.read().includes(fakeKey), 'تسرّب السرّ إلى الملف');
  const got = store.load().entries[0];
  assert.ok(got.redaction && got.redaction.count >= 1);
  assert.strictEqual(S.validateEntry(got).ok, true, JSON.stringify(S.validateEntry(got).errors));
  // الأختام لا تتأثر بالحجب (هاشات لا أسرار)
  assert.deepStrictEqual(got.attempts, e.attempts);
});
test('[SAN-2] sanitize يُرجع null أو يرمي ⇒ يُبلَّغ في skipped ولا ينهار الحفظ', () => {
  const a = makeEntry(), b = makeEntry();
  const s1 = HS.createStore({ sanitize: e => (e.id === a.id ? null : e) });
  const r1 = s1.save([a, b]);
  assert.strictEqual(r1.ok, true);
  assert.deepStrictEqual(r1.skipped.map(x => x.id), [a.id]);
  const s2 = HS.createStore({ sanitize: () => { throw new Error('boom'); } });
  const r2 = s2.save([a]);
  assert.strictEqual(r2.ok, true);
  assert.match(r2.skipped[0].error, /sanitize فشل: boom/);
});

// ═══ 7) السلامة التشغيلية (لا يرمي) ═══════════════════════════════════════
test('[OPS-1] فشل الكتابة يُرجَع ok:false مع ما حُذف، ولا يرمي', () => {
  const backend = { kind: 'x', read: () => null, write: () => { throw new Error('disk full'); }, clear() {} };
  const res = HS.createStore({ backend }).save([mk(1, 1)]);
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /disk full/);
});
test('[OPS-2] ملف تالف يُنقل لنسخة .bad ولا تُكتب فوقه بيانات', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-'));
  const file = path.join(dir, 'log.json');
  fs.writeFileSync(file, '{ not json');
  const store = HS.createStore({ backend: HS.fileBackend({ fs, file }) });
  const r = store.load();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.quarantined, true);
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('log.json.bad-')));
  fs.rmSync(dir, { recursive: true, force: true });
});
test('[OPS-3] backend ملف: كتابة ذرّية ودورة كاملة للأختام عبر القرص', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-'));
  const file = path.join(dir, 'log.json');
  const store = HS.createStore({ backend: HS.fileBackend({ fs, file }) });
  const e = makeEntry({}, 2);
  assert.strictEqual(store.save([e], [arch(1, 3)]).ok, true);
  assert.deepStrictEqual(fs.readdirSync(dir), ['log.json'], 'لا ملفات tmp متبقية');
  const back = HS.createStore({ backend: HS.fileBackend({ fs, file }) }).load();
  assert.deepStrictEqual(back.entries[0].attempts, e.attempts);
  assert.strictEqual(back.archive.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('[OPS-4] مدخلات غريبة لا ترمي', () => {
  for (const bad of [null, undefined, 5, 'x', [], {}, { id: 1 }]) assert.doesNotThrow(() => HS.normalizeEntry(bad));
  assert.doesNotThrow(() => HS.serialize(null));
  assert.doesNotThrow(() => HS.parse(undefined));
  assert.doesNotThrow(() => HS.createStore().save(undefined));
});

// ═══ 8) توافق اختياري مع المحرك الحالي (يُتخطّى إن لم يوفّر attachStore) ═══
let SH = null;
try { SH = require(path.join(PUBLIC_DIR, 'self_healing_engine.js')).SelfHealing; } catch (_) { /* لا محرك */ }
const NO_ATTACH = SH && typeof SH.attachStore === 'function' ? false : 'المحرك الحالي لا يوفّر attachStore';
test('[ENG-1] المحرك الحالي يعمل مع المخزن v2 كما هو (بلا تعديل المحرك): ربط، heal، حفظ، حقول v1 صالحة', { skip: NO_ATTACH }, () => {
  const backend = HS.memoryBackend();
  const store = HS.createStore({ backend });
  const att = SH.attachStore(store);
  assert.strictEqual(att.ok, true, JSON.stringify(att));
  SH.heal({ type: 'ENGINE_ERROR', engine: 'eng', fileName: 'a.js', code: 'var a = 1;', detail: 'd' });
  const saved = JSON.parse(backend.read());
  assert.strictEqual(saved._meta.version, '2.0.0');
  assert.ok(saved.entries.length >= 1);
  for (const e of saved.entries) {
    assert.strictEqual(S.validateEntry(e).ok, true, JSON.stringify(S.validateEntry(e).errors));
    assert.ok(!('patchedCode' in e));
  }
  SH.detachStore();
});
