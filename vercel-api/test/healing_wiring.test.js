/**
 * healing_wiring.test.js — دورة سجل الإصلاح الذاتي كما يعمل المحرك فعلًا بعد ربطه
 * ══════════════════════════════════════════════════════════════════════════
 * لا يختبر الوحدات منفردة (لها اختباراتها) بل الربط: self_healing_engine.js ↔ المخطط ↔ السياسة ↔ المخزن.
 *
 *   W-*   الدورة: حادثة ← محاولة ← اختبار مختوم ← موافقة/رفض/تراجع/فشل تطبيق، + سجل التدقيق
 *   EV-*  رفض الاعتماد عند أي عدم تطابق بين ما اختُبر وما يُعتمد
 *   P-*   الحفظ والاسترجاع بعد «إعادة التشغيل»، الأسرار، الاحتفاظ، فشل التخزين، تلف السجل
 *   M-*   هجرة v1 وتوحيد الإصدارات
 *   L-*   السلوك عند غياب الوحدات (وضع قديم صريح) وعند تحميلها بترتيب الخادم في vm
 */
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('node:path');
const fs     = require('node:fs');
const vm     = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ENGINE = path.join(PUBLIC_DIR, 'self_healing_engine.js');
const S  = require(path.join(PUBLIC_DIR, 'healing_log_schema.js'));
const P  = require(path.join(PUBLIC_DIR, 'healing_log_policy.js'));
const HS = require(path.join(PUBLIC_DIR, 'healing_store.js'));

// محرك جديد بذاكرة جديدة (الوحدات الثلاث تبقى محمَّلة في global كما في الإنتاج)
function fresh() {
  delete require.cache[ENGINE];
  const SH = require(ENGINE).SelfHealing;
  SH.registerPatchProvider((code, problem) =>
    typeof problem.patchTo === 'string'
      ? { patchedCode: problem.patchTo, confidence: 'HIGH', reason: 'اختبار', changedCount: 1 }
      : null);
  return SH;
}
const GOOD = () => ({ syntax: { pass: true }, engines: {}, taint: { pass: true, skipped: true },
                      regression: { pass: true }, security: { pass: true } });
const BAD  = () => Object.assign(GOOD(), { security: { pass: false, vulnerabilities: ['x'] } });
const BASE  = 'el.innerHTML = u;\n';
const PATCH = 'el.textContent = u;\n';
const UNCH  = '// UNCHANGED_MARKER_LINE\n';

function heal(SH, o) {
  o = o || {};
  return SH.heal({ type: o.type || 'ENGINE_ERROR', engine: 'test', fileName: o.fileName || 'a.js',
                   code: o.code === undefined ? BASE : o.code, detail: o.detail || 'd',
                   patchTo: o.patchTo === undefined ? PATCH : o.patchTo,
                   testRunner: o.testRunner || GOOD });
}
const actions = SH => SH.exportAudit().events.map(e => e.action);
const sleep = ms => { const t = Date.now(); while (Date.now() - t < ms) { /* انتظار قصير لتمايز الأختام الزمنية */ } };

function failingBackend(failWrite) {
  const inner = HS.memoryBackend();
  let fail = !!failWrite;
  const b = Object.assign({}, inner, {
    write: t => { if (fail) throw new Error('القرص ممتلئ'); return inner.write(t); },
    setFail: v => { fail = v; }
  });
  return b;
}
function quiet(fn) {
  const w = console.warn; console.warn = () => {};
  try { return fn(); } finally { console.warn = w; }
}

// ═══ W: الدورة كاملة ═══════════════════════════════════════════════════
test('[W-1] heal ينشئ حادثة ومحاولة بمعرّفات ثابتة وأختام ما اختُبر فعلًا', () => {
  const SH = fresh();
  const r = heal(SH);
  const e = SH.getById(r.id);
  assert.strictEqual(e.attempts.length, 1);
  const a = e.attempts[0];
  assert.match(a.attemptId, /^SHA_\d{10,16}_[A-Z0-9]{4,8}$/);
  assert.strictEqual(a.incidentId, r.id);
  assert.strictEqual(e.currentAttemptId, a.attemptId);
  assert.strictEqual(a.baseSha, S.sha256(BASE));
  assert.strictEqual(a.patchSha, S.sha256(PATCH));
  assert.strictEqual(a.healingResult, 'PASS');
  assert.match(a.testRun.runId, /^SHR_/);
  assert.strictEqual(a.testRun.attemptId, a.attemptId);
  assert.strictEqual(a.testRun.baseSha, a.baseSha, 'الاختبار مختوم بالأصل نفسه');
  assert.strictEqual(a.testRun.patchSha, a.patchSha, 'الاختبار مختوم بالتعديل نفسه');
  assert.strictEqual(a.testRun.passed, true);
  // أوقات موحّدة، والمدخل صالح بمخطط v2
  for (const t of [e.timestamp, e.updatedAt, a.startedAt, a.finishedAt]) assert.strictEqual(S.canonicalTime(t), t);
  assert.deepStrictEqual(S.validateEntry(e), { ok: true, errors: [] });
  assert.ok(!JSON.stringify(a).includes('textContent'), 'المحاولة لا تحمل نص الكود');
});

test('[W-2] الاعتماد الصحيح: يُطبَّق، تصير الحالة APPROVED، ويُسجَّل في التدقيق وتبقى السلسلة سليمة', () => {
  const SH = fresh();
  const r = heal(SH);
  let applied = null;
  const out = SH.approve(r.id, PATCH, c => { applied = c; }, { actor: 'naif' });
  assert.strictEqual(out.status, 'APPROVED');
  assert.strictEqual(applied, PATCH);
  assert.deepStrictEqual(actions(SH), ['incident.created', 'attempt.started', 'tests.recorded', 'approval.granted']);
  const ev = SH.exportAudit().events;
  assert.strictEqual(ev[3].actor, 'naif');
  assert.strictEqual(ev[3].incidentId, r.id);
  assert.deepStrictEqual(SH.verifyAudit(), { ok: true, index: -1 });
});

test('[W-3] فشل الاختبارات ⇒ ROLLED_BACK مع محاولة FAIL مختومة وتدقيق rollback، ولا اعتماد بعدها', () => {
  const SH = fresh();
  const r = heal(SH, { testRunner: BAD });
  assert.strictEqual(r.status, 'ROLLED_BACK');
  const e = SH.getById(r.id);
  assert.strictEqual(e.attempts[0].healingResult, 'FAIL');
  assert.strictEqual(e.attempts[0].testRun.passed, false);
  assert.ok(actions(SH).includes('rollback.recorded'));
  const out = SH.approve(r.id, PATCH, () => { throw new Error('يجب ألا يُنادى'); });
  assert.strictEqual(out.status, 'REJECTED');
  assert.match(out.error, /ROLLED_BACK/);
  assert.ok(actions(SH).includes('approval.denied'));
});

test('[W-4] الرفض يُسجَّل، ولا يُرفض مرتين', () => {
  const SH = fresh();
  const r = heal(SH);
  assert.strictEqual(SH.reject(r.id, { actor: 'naif' }).status, 'REJECTED');
  assert.ok(actions(SH).includes('rejection.recorded'));
  assert.strictEqual(SH.reject(r.id).status, 'ERROR');
  assert.strictEqual(SH.approve(r.id, PATCH, () => {}).status, 'REJECTED');
});

test('[W-5] فشل التطبيق: تبقى PENDING_REVIEW، يُسجَّل APPLY_FAILED، ويمكن إعادة المحاولة بنجاح', () => {
  const SH = fresh();
  const r = heal(SH);
  const bad = SH.approve(r.id, PATCH, () => { throw new Error('القرص للقراءة فقط'); });
  assert.strictEqual(bad.status, 'PENDING_REVIEW');
  assert.strictEqual(SH.getById(r.id).status, 'PENDING_REVIEW');
  assert.match(SH.getById(r.id).applyError, /القرص/);
  const den = SH.exportAudit().events.filter(e => e.action === 'approval.denied');
  assert.deepStrictEqual(den[0].reasons, ['APPLY_FAILED']);
  assert.strictEqual(SH.approve(r.id, PATCH, () => {}).status, 'APPROVED');
});

test('[W-6] حادثة بلا إصلاح: SKIPPED بلا محاولات، ولا اعتماد لها', () => {
  const SH = fresh();
  const r = heal(SH, { patchTo: null });
  assert.strictEqual(r.result, 'SKIPPED');
  assert.deepStrictEqual(SH.getById(r.id).attempts, []);
  const out = SH.approve(r.id, undefined, () => { throw new Error('لا'); });
  assert.strictEqual(out.status, 'REJECTED');
  assert.deepStrictEqual(SH.exportAudit().events.filter(e => e.action === 'approval.denied').pop().reasons, ['NO_TESTED_PATCH']);
});

test('[W-7] ENGINE_SELF_DEFECT (نوع مُشخِّص المحرك) يمر المخزن ولا يُسقط', () => {
  assert.ok(S.TYPES.includes('ENGINE_SELF_DEFECT') && HS.TYPES.includes('ENGINE_SELF_DEFECT'));
  const SH = fresh();
  const backend = HS.memoryBackend();
  assert.strictEqual(SH.attachStore(HS.createStore({ backend })).ok, true);
  heal(SH, { type: 'ENGINE_SELF_DEFECT' });
  const st = SH.storeStatus();
  assert.strictEqual(st.lastPersist.ok, true);
  assert.deepStrictEqual(st.lastPersist.skipped, []);
  assert.strictEqual(JSON.parse(backend.read()).entries[0].type, 'ENGINE_SELF_DEFECT');
});

// ═══ EV: رفض الاعتماد عند عدم تطابق الدليل ═════════════════════════════
function denied(SH, id, code, why) {
  let called = false;
  const out = SH.approve(id, code, () => { called = true; });
  assert.strictEqual(out.status, 'REJECTED');
  assert.strictEqual(called, false, 'لا يُطبَّق شيء عند الرفض');
  assert.strictEqual(SH.getById(id).status, 'PENDING_REVIEW', 'الحالة لا تتغير');
  if (why) assert.ok((out.reasons || []).includes(why) || new RegExp(why).test(out.error), JSON.stringify(out));
  return out;
}

test('[EV-1] patchedCode مختلف عمّا اختُبر ⇒ مرفوض', () => {
  const SH = fresh();
  const r = heal(SH);
  denied(SH, r.id, PATCH + 'fetch(evil);', 'لا يطابق ما تم اختباره');
});

test('[EV-2] تعديل entry.patchedCode في الذاكرة بعد الاختبار ثم اعتماده ⇒ مرفوض بالأختام (المقارنة النصية وحدها تمرّره)', () => {
  const SH = fresh();
  const r = heal(SH);
  const e = SH.getById(r.id);
  const evil = PATCH + 'fetch(evil);';
  e.patchedCode = evil;                       // الكائن حيّ؛ من يعدّله ثم يمرّر النص نفسه يجتاز المقارنة القديمة
  const out = denied(SH, r.id, evil, 'PATCH_DIFFERS_FROM_TESTED');
  assert.ok(out.reasons.includes('PATCH_DIFFERS_FROM_TESTED'));
  assert.ok(actions(SH).includes('approval.denied'));
});

test('[EV-3] تغيّر الكود الأصلي (اللقطة) بعد الاختبار ⇒ مرفوض', () => {
  const SH = fresh();
  const r = heal(SH);
  const snap = SH.getSnapshot(r.id);
  const k = Object.keys(snap.files)[0];
  snap.files[k] = BASE + '// تعديل لاحق\n';
  denied(SH, r.id, PATCH, 'BASE_CODE_CHANGED_SINCE_TEST');
});

test('[EV-4] لقطة الأصل مفقودة ⇒ مرفوض (لا يمكن إثبات ما اختُبر)', () => {
  const SH = fresh();
  const r = heal(SH);
  const snap = SH.getSnapshot(r.id);
  for (const k of Object.keys(snap.files)) delete snap.files[k];
  denied(SH, r.id, PATCH, 'BASE_CODE_UNAVAILABLE');
});

test('[EV-5] ختم نتيجة الاختبار لا يطابق محاولتها، أو الاختبار لم ينجح، أو لا اختبار ⇒ مرفوض', () => {
  let SH = fresh(), r = heal(SH);
  SH.getById(r.id).attempts[0].testRun.patchSha = S.sha256('غيره');
  denied(SH, r.id, PATCH, 'RUN_STAMP_MISMATCH_ATTEMPT');

  SH = fresh(); r = heal(SH);
  SH.getById(r.id).attempts[0].testRun.passed = false;
  denied(SH, r.id, PATCH, 'TESTS_NOT_PASSED');

  SH = fresh(); r = heal(SH);
  SH.getById(r.id).attempts[0].testRun = null;
  denied(SH, r.id, PATCH, 'NO_TESTS');

  SH = fresh(); r = heal(SH);
  SH.getById(r.id).attempts = [];
  denied(SH, r.id, PATCH, 'NO_ATTEMPTS');
});

test('[EV-6] نتيجة محاولة أقدم لا تبرّر تعديلًا أحدث (ATTEMPT_SUPERSEDED)', () => {
  const SH = fresh();
  const r = heal(SH);
  const e = SH.getById(r.id);
  const a2 = S.recordTestRun(S.makeAttempt({ incidentId: r.id, n: 2, baseCode: BASE, patchedCode: PATCH + '//2' }),
                             GOOD(), { passed: true });
  e.attempts.push(a2); e.currentAttemptId = a2.attemptId;       // محاولة أحدث بتعديل آخر
  denied(SH, r.id, PATCH, 'PATCH_DIFFERS_FROM_TESTED');           // الدليل الأحدث لا يخص هذا التعديل
});

test('[EV-7] كل رفض يترك أثرًا في التدقيق والسلسلة سليمة', () => {
  const SH = fresh();
  const r = heal(SH);
  denied(SH, r.id, 'غير ما اختُبر');
  denied(SH, r.id, PATCH + 'x');
  assert.strictEqual(SH.exportAudit().events.filter(e => e.action === 'approval.denied').length, 2);
  assert.strictEqual(SH.verifyAudit().ok, true);
});

test('[EV-8] كشف عبث بالتدقيق: تعديل حدث يكسر السلسلة', () => {
  const SH = fresh();
  heal(SH);
  const ex = SH.exportAudit();
  const forged = JSON.parse(JSON.stringify(ex.events));
  forged[1].actor = 'مزوَّر';
  assert.strictEqual(P.verifyAuditChain(forged, ex.anchorHash).ok, false);
  assert.strictEqual(P.verifyAuditChain(ex.events, ex.anchorHash).ok, true);
});

// ═══ P: الحفظ والاسترجاع ═══════════════════════════════════════════════
test('[P-1] الحفظ ثم «إعادة التشغيل»: الأختام والمحاولات تُستعاد كاملة، بلا patchedCode، ولا يُعتمد المستعاد', () => {
  const backend = HS.memoryBackend();
  const SH1 = fresh();
  assert.strictEqual(SH1.attachStore(HS.createStore({ backend })).ok, true);
  const r = heal(SH1, { code: UNCH + BASE, patchTo: UNCH + PATCH });
  const before = JSON.parse(JSON.stringify(SH1.getById(r.id).attempts));
  const disk = backend.read();
  assert.ok(JSON.parse(disk).entries.every(e => !('patchedCode' in e)), 'حقل patchedCode لا يُحفظ في أي مدخل');
  assert.ok(!disk.includes('UNCHANGED_MARKER'), 'السطور غير المتغيرة (بقية الملف) لا تصل للتخزين — فقط سطور الـdiff');

  const SH2 = fresh();                                   // «إعادة تشغيل»
  const att = SH2.attachStore(HS.createStore({ backend }));
  assert.strictEqual(att.ok, true);
  assert.strictEqual(att.restored, 1);
  const e = SH2.getById(r.id);
  assert.strictEqual(e.restored, true);
  assert.deepStrictEqual(e.attempts, before, 'محاولات v2 وأختامها سليمة بعد الاسترجاع');
  assert.strictEqual(e.patchedCode, undefined);
  assert.strictEqual(SH2.getPending().length, 1, 'تظهر للمراجعة كتاريخ');
  const out = SH2.approve(r.id, PATCH, () => { throw new Error('لا'); });
  assert.strictEqual(out.status, 'REJECTED', 'سجل مستعاد لا يُعتمد');
});

test('[P-2] الأسرار تُحجب من التخزين والتصدير، وتبقى الذاكرة الحيّة للمراجعة الفعلية', () => {
  const KEY = 'AKIAIOSFODNN7EXAMPLE';
  const BEARER = 'Bearer abcdefghijklmnopqrstuvwxyz0123456789';
  const code = `const k = "${KEY}";\nel.innerHTML = u;\n`;
  const patched = `const k = "${KEY}";\nel.textContent = u;\n`;
  const backend = HS.memoryBackend();
  const SH = fresh();
  assert.strictEqual(SH.attachStore(HS.createStore({ backend })).ok, true);   // بلا sanitize في المخزن: المحرك نفسه يحجب
  const r = heal(SH, { code, patchTo: patched, detail: `فشل مع ${BEARER}` });
  for (const text of [backend.read(), SH.exportLog()]) {
    assert.ok(!text.includes(KEY), 'مفتاح AWS ظهر');
    assert.ok(!text.includes('abcdefghijklmnopqrstuvwxyz0123456789'), 'Bearer ظهر');
  }
  const persisted = JSON.parse(backend.read()).entries[0];
  assert.ok(persisted.redaction && persisted.redaction.count > 0 && persisted.redaction.kinds.length > 0);
  assert.ok(SH.getById(r.id).patchedCode.includes(KEY), 'الذاكرة الحيّة لم تُعدَّل');
  assert.strictEqual(SH.approve(r.id, patched, () => {}).status, 'APPROVED', 'الحجب لا يكسر اعتمادًا مشروعًا');
});

test('[P-3] exportLog: بلا patchedCode، إصدار موحّد، ويُستورد في محرك آخر تاريخًا لا يُعتمد', () => {
  const SH = fresh();
  const r = heal(SH, { code: UNCH + BASE, patchTo: UNCH + PATCH });
  const text = SH.exportLog();
  const j = JSON.parse(text);
  assert.ok(!text.includes('UNCHANGED_MARKER'));
  assert.ok(JSON.parse(text).entries.every(e => !('patchedCode' in e)), 'التصدير بلا patchedCode');
  assert.strictEqual(j._meta.version, S.SCHEMA_VERSION);
  assert.strictEqual(j._meta.version, HS.SCHEMA_VERSION);
  assert.strictEqual(j._meta.engineVersion, '2.0.0');
  assert.ok(j.entries.some(e => e.id === r.id) && Array.isArray(j.archive));

  const SH2 = fresh();
  const imp = SH2.importLog(text);
  assert.strictEqual(imp.ok, true);
  assert.strictEqual(imp.imported, 1);
  assert.strictEqual(imp.persisted, null, 'بلا مخزن لا ندّعي حفظًا');
  assert.strictEqual(SH2.approve(r.id, PATCH, () => {}).status, 'REJECTED');
  assert.strictEqual(SH2.importLog(text).imported, 0, 'لا تكرار');
});

test('[P-4] الاحتفاظ: المعلّق محمي والأقدم غير المعلّق يُؤرشف (والذاكرة تتبع)، ويبقى المعلّق قابلًا للاعتماد', () => {
  const backend = HS.memoryBackend();
  const SH = fresh();
  assert.strictEqual(SH.attachStore(HS.createStore({ backend }), { policy: { maxEntries: 2 } }).ok, true);
  const pending = heal(SH, { code: 'a\n', patchTo: 'b\n' });              // الأقدم، معلّق
  const done = [];
  for (let i = 0; i < 3; i++) {
    sleep(3);
    const h = heal(SH, { code: 'c' + i + '\n', patchTo: 'd' + i + '\n' });
    SH.reject(h.id);
    done.push(h.id);
  }
  const disk = JSON.parse(backend.read());
  const liveIds = disk.entries.map(e => e.id);
  assert.ok(liveIds.includes(pending.id), 'المعلّق لا يُؤرشف رغم أنه الأقدم');
  assert.ok(liveIds.length <= 2);
  assert.ok(disk.archive.length >= 2, 'المرفوضات الأقدم أُرشفت');
  assert.ok(disk.archive.every(a => !('patchedCode' in a) && !('testResults' in a)), 'الأرشيف مضغوط بلا كود');
  assert.deepStrictEqual(SH.getLog().map(e => e.id).filter(id => disk.archive.some(a => a.id === id)), [], 'الذاكرة تتبع الأرشفة');
  assert.strictEqual(SH.approve(pending.id, 'b\n', () => {}).status, 'APPROVED');
  assert.ok(actions(SH).includes('retention.archived'));
});

test('[P-5] فشل التخزين ظاهر: لا ادّعاء حفظ، والمحرك يواصل، ويُحفظ عند عودة التخزين', () => {
  const backend = failingBackend(false);
  const SH = fresh();
  assert.strictEqual(SH.attachStore(HS.createStore({ backend })).ok, true);
  backend.setFail(true);
  const r = heal(SH);
  assert.strictEqual(r.status, 'PENDING_REVIEW', 'المحرك لم يتأثر');
  const st = SH.storeStatus();
  assert.strictEqual(st.lastPersist.ok, false);
  assert.match(st.lastPersist.error, /القرص ممتلئ/);
  assert.strictEqual(SH.importLog(SH.exportLog()).persisted, false);
  backend.setFail(false);
  heal(SH);
  assert.strictEqual(SH.storeStatus().lastPersist.ok, true);
  assert.strictEqual(JSON.parse(backend.read()).entries.length, 2, 'الحادثة الأولى لم تضع');
});

test('[P-6] فشل أول حفظ عند الربط ⇒ ok:false وغير مربوط', () => {
  const backend = failingBackend(true);
  const SH = fresh();
  const att = SH.attachStore(HS.createStore({ backend }));
  assert.strictEqual(att.ok, false);
  assert.match(att.reason, /فشل أول حفظ/);
  assert.strictEqual(SH.storeStatus().attached, false);
});

test('[P-7] سجل تالف: لا ربط، ولا نكتب فوقه', () => {
  const backend = HS.memoryBackend();
  backend.write('{ not json');
  const SH = fresh();
  const att = SH.attachStore(HS.createStore({ backend }));
  assert.strictEqual(att.ok, false);
  heal(SH);
  assert.strictEqual(backend.read(), '{ not json', 'الأصل التالف لم يُمسّ');
});

test('[P-8] حادثة نوعها غير معروف للمخزن: لا إسقاط صامت — تظهر في skipped ويُحذَّر', () => {
  const backend = HS.memoryBackend();
  const SH = fresh();
  assert.strictEqual(SH.attachStore(HS.createStore({ backend })).ok, true);
  let warned = 0;
  const w = console.warn; console.warn = () => { warned++; };
  let r;
  try { r = heal(SH, { type: 'NOVEL_TYPE' }); } finally { console.warn = w; }
  const rec = SH.storeStatus().lastPersist;
  assert.ok(rec.skipped.some(s => s.id === r.id && /type/.test(s.error)), JSON.stringify(rec.skipped));
  assert.strictEqual(rec.partial, true);
  assert.ok(warned > 0);
  assert.ok(SH.getById(r.id), 'تبقى في الذاكرة');
  const d = quiet(() => SH.exportLogDetailed());
  assert.ok(d.skipped.some(s => s.id === r.id), 'التصدير يصرّح بما لم يدخله');
});

test('[P-9] الربط يتطلب السياسة: بدونها يُرفض (لا نكتب سجلًّا غير محجوب)', () => {
  const ctx = vm.createContext({ console, window: {}, global: {} });
  for (const f of ['healing_log_schema.js', 'healing_store.js', 'self_healing_engine.js']) {   // بلا السياسة عمدًا
    vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8'), ctx);
  }
  const att = vm.runInContext('window.SelfHealing.attachStore({ load(){return{ok:true,entries:[],dropped:[],archive:[]};}, save(){return{ok:true};} })', ctx);
  assert.strictEqual(att.ok, false);
  assert.match(att.reason, /سياسة/);
});

// ═══ M: هجرة v1 والإصدارات ═════════════════════════════════════════════
test('[M-1] سجل v1 قديم: يُستعاد كتاريخ، أدلته غير موثوقة، ولا يُعتمد', () => {
  const id = 'SH_1700000000000_OLD1';
  const v1 = JSON.stringify({
    _meta: { version: '1.0.0' },
    entries: [{ id, timestamp: '2023-11-14T22:13:20.000Z', type: 'SQL_INJECTION', engine: 'x', fileName: 'a.js', detail: 'd',
               status: 'PENDING_REVIEW', healingResult: 'PASS', testResults: { syntax: { pass: true } }, patch: { changedCount: 1 } }]
  });
  const backend = HS.memoryBackend(); backend.write(v1);
  const SH = fresh();
  const att = SH.attachStore(HS.createStore({ backend }), { policy: { maxAgeDays: 100000 } });
  assert.strictEqual(att.ok, true, JSON.stringify(att));
  const e = SH.getById(id);
  assert.ok(e, 'استُعيد');
  const a = (e.attempts || [])[0];
  if (a) { assert.strictEqual(a.legacy, true); assert.strictEqual(a.testRun.unbound, true); }
  assert.strictEqual(S.approvalCheck(e, BASE, PATCH).ok, false, 'أدلة v1 لا تصلح للاعتماد');
  assert.strictEqual(SH.approve(id, PATCH, () => {}).status, 'REJECTED');
  assert.strictEqual(JSON.parse(backend.read())._meta.version, '2.0.0', 'يُعاد حفظه بصيغة v2');
});

test('[M-2] الإصدارات موحّدة: المخطط = المخزن = التصدير = المحرك.logVersion', () => {
  const SH = fresh();
  assert.strictEqual(S.SCHEMA_VERSION, HS.SCHEMA_VERSION);
  assert.strictEqual(SH.summary().logVersion, S.SCHEMA_VERSION);
  assert.strictEqual(JSON.parse(SH.exportLog())._meta.version, S.SCHEMA_VERSION);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'healing_log.json'), 'utf8'))._meta.version, S.SCHEMA_VERSION);
});

// ═══ L: غياب الوحدات والتحميل ═════════════════════════════════════════
function vmWith(files) {
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} }, window: {}, global: {}, F: {}, R: {} });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
test('[L-1] المحرك وحده في vm (بلا الوحدات): سلوكه القديم يعمل، وغياب الأدلة معلن لا صامت', () => {
  const ctx = vmWith(['self_healing_engine.js']);
  const out = vm.runInContext(`
    const SelfHealing = window.SelfHealing;
    SelfHealing.registerPatchProvider((c, p) => p.patchTo ? { patchedCode: p.patchTo, confidence: 'HIGH', reason: 'r', changedCount: 1 } : null);
    const r = SelfHealing.heal({ type: 'ENGINE_ERROR', engine: 'e', fileName: 'a.js', code: 'x', patchTo: 'y',
      testRunner: () => ({ syntax:{pass:true}, engines:{}, taint:{pass:true}, regression:{pass:true}, security:{pass:true} }) });
    ({ f: SelfHealing.features(), ap: SelfHealing.approve(r.id, 'y', () => {}).status,
       v: JSON.parse(SelfHealing.exportLog())._meta.version, att: SelfHealing.attachStore({ load(){}, save(){} }).ok,
       attempts: SelfHealing.getById(r.id).attempts })
  `, ctx);
  assert.strictEqual(out.f.evidence, false);
  assert.strictEqual(out.f.policy, false);
  assert.strictEqual(out.ap, 'APPROVED', 'السلوك القديم محفوظ');
  assert.strictEqual(out.v, '1.0.0');
  assert.strictEqual(out.att, false, 'الحفظ الدائم مرفوض بلا السياسة');
  assert.strictEqual(out.attempts, undefined);
});

test('[L-2] بترتيب الخادم (مخطط ← سياسة ← مخزن ← محرك) في vm بلا require: الأدلة والتدقيق تعمل', () => {
  const ctx = vmWith(['healing_log_schema.js', 'healing_log_policy.js', 'healing_store.js', 'self_healing_engine.js']);
  const out = vm.runInContext(`
    const SelfHealing = window.SelfHealing;
    SelfHealing.registerPatchProvider((c, p) => p.patchTo ? { patchedCode: p.patchTo, confidence: 'HIGH', reason: 'r', changedCount: 1 } : null);
    const r = SelfHealing.heal({ type: 'ENGINE_ERROR', engine: 'e', fileName: 'a.js', code: 'x', patchTo: 'y',
      testRunner: () => ({ syntax:{pass:true}, engines:{}, taint:{pass:true}, regression:{pass:true}, security:{pass:true} }) });
    const e = SelfHealing.getById(r.id);
    e.patchedCode = 'z';
    const bad = SelfHealing.approve(r.id, 'z', () => {});
    ({ f: SelfHealing.features(), n: e.attempts.length, bad: bad.status, reasons: bad.reasons,
       v: SelfHealing.verifyAudit().ok, acts: SelfHealing.exportAudit().events.map(x => x.action) })
  `, ctx);
  assert.strictEqual(out.f.evidence, true);
  assert.strictEqual(out.f.policy, true);
  assert.strictEqual(out.f.store, true);
  assert.strictEqual(out.n, 1);
  assert.strictEqual(out.bad, 'REJECTED');
  assert.ok(out.reasons.includes('PATCH_DIFFERS_FROM_TESTED'));
  assert.strictEqual(out.v, true);
  assert.ok(out.acts.includes('approval.denied'));
});

test('[L-3] المحرك في Node يجد الوحدات بنفسه (require كسول) فتعمل الأدلة دون تهيئة', () => {
  const SH = fresh();
  assert.deepStrictEqual(Object.assign({}, SH.features(), { storeAttached: undefined }),
    { evidence: true, policy: true, store: true, logVersion: '2.0.0', storeAttached: undefined });
});

test('[L-4] بلا مخزن: سلوك الذاكرة كما كان (سقف 200 قصّ قديم، لا أرشيف، لا كتابة خارجية)', () => {
  const SH = fresh();
  for (let i = 0; i < 205; i++) heal(SH, { patchTo: null, code: 'c' + i });
  assert.strictEqual(SH.getLog().length, 200);
  assert.strictEqual(SH.getArchive().length, 0);
  assert.strictEqual(SH.storeStatus().attached, false);
  assert.strictEqual(SH.storeStatus().lastPersist, null);
});
