// ═══════════════════════════════════════════════════════════════════════
// اختبار الدورة كاملة من البداية للنهاية لـ engine_self_diagnosis.js
// تشغيل:  node --test vercel-api/test/engine_self_diagnosis_e2e.test.js
//
// ليست اختبارات وحدات. كل اختبار أدناه يمرّ **المسار الحقيقي** في الإنتاج:
//   اكتشاف ← تشخيص بالأدلة ← اقتراح ← اختبار في سياق vm معزول ← التحقق من
//   عدم تراجع بقية القدرات ← PENDING_REVIEW في سجل SelfHealing ← approve/reject.
//
// والخلل المستعمل ليس مُصطنعًا في محرك مُصطنع: هو تغيير سطرٍ واحد في
// fix_verifier.js الحقيقي، من النوع الذي يفتح البوابة (available:false ⇒ true
// على PHP غير القابل للحسم) — أي بالضبط السياسة التي قُرِّر إبقاؤها.
// ويُحقَن عبر مصدر كود مُمرَّر (opts.sources)، فلا ملف إنتاج يُعدَّل ولا يُكتب.
//
// ولماذا الحقن أصلًا: البطارية تنجح 13/13 على شجرة اليوم (مقيس، واختبار أدناه
// يثبّته). فلو انتظرنا خللًا حقيقيًا لما اختُبرت مراحل الإصلاح أبدًا. حقنُ خلل
// معروف هو الطريقة المعتادة للتحقق من حلقة إصلاح ذاتي — والمقاس هنا هو سلوك
// الكود الحقيقي تجاهه، لا سلوك نسخة اختبارية منه.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ESD = require(path.join(PUBLIC_DIR, 'engine_self_diagnosis.js'));
const SH  = require(path.join(PUBLIC_DIR, 'self_healing_engine.js'));

const VERIFIER = 'fix_verifier.js';
const REAL_VERIFIER = fs.readFileSync(path.join(PUBLIC_DIR, VERIFIER), 'utf8');

// ─── حقن الخلل ────────────────────────────────────────────────────────
// الكتلة الحقيقية في fix_verifier.js:
//     if (v === "unknown") {
//       return { ok: false, available: false, language,
//         reason: "php structure not decidable (heredoc or close-tag) - no verdict" };
//     }
// تحويل available إلى true يجعل PHP غير القابل للحسم يُعامل كـ«مفحوص ومكسور»
// بدل «لا حكم» — وهو تغيير سطر واحد، وأثره على مِجسّ واحد.

const ANCHOR = 'return { ok: false, available: false, language,\n' +
               '          reason: "php structure not decidable (heredoc or close-tag) - no verdict" };';
const INJECTED = 'return { ok: false, available: true, language,\n' +
                 '          reason: "php structure not decidable (heredoc or close-tag) - no verdict" };';

test('[E2E-0] المرساة موجودة في الإنتاج مرة واحدة — الحقن يصيب ما نقصده', () => {
  const n = REAL_VERIFIER.split(ANCHOR).length - 1;
  assert.strictEqual(n, 1, 'المرساة يجب أن تظهر مرة واحدة بالضبط في fix_verifier.js');
});

const DEFECTIVE_VERIFIER = REAL_VERIFIER.replace(ANCHOR, INJECTED);

// مصدر كود مُمرَّر: «الحالي» = المعطوب، «المرجع» = الحقيقي.
// هذا يحاكي بدقة ما يحدث في الواقع: تغيير في الشجرة لم يُودَع بعد، وgit HEAD
// يحمل النسخة السليمة. وبقية الوحدات تُقرأ من القرص كما هي.
function injectedSources(overrideMap) {
  const map = overrideMap || { [VERIFIER]: DEFECTIVE_VERIFIER };
  return {
    kind: 'test-injected',
    publicDir: PUBLIC_DIR,
    current(mod) {
      if (Object.prototype.hasOwnProperty.call(map, mod)) return map[mod];
      try { return fs.readFileSync(path.join(PUBLIC_DIR, mod), 'utf8'); } catch (_) { return null; }
    },
    reference(mod) {
      try { return fs.readFileSync(path.join(PUBLIC_DIR, mod), 'utf8'); } catch (_) { return null; }
    },
  };
}

const TARGET_PROBE = 'gate.php-heredoc-undecidable';

// اختبارات حلقة الإصلاح تمرّر manifest:false. وهذا تركيزٌ لا إخفاء: انحراف بيان
// الصفحة صنفٌ **اكتشافٌ فقط** (لا إصلاح آلي له بقرار)، وله اختباراه الخاصان
// أدناه [E2E-13] و[E2E-13b] على الشجرة الحقيقية. وإدخاله في كل اختبار يُضيف
// حادثتين ثابتتين تُغرق التأكيدات عن الحادثة المحقونة بلا أن تقيس شيئًا جديدًا.
const FOCUS = { manifest: false };

// ═══════════════════════════════════════════════════════════════════════
// 1. البطارية على محرك اليوم — لا إنذارات كاذبة
// ═══════════════════════════════════════════════════════════════════════

test('[E2E-1] البطارية على الشجرة الحقيقية: كل المِجسّات تنجح وصفر حوادث', () => {
  const b = ESD.runBattery({ publicDir: PUBLIC_DIR });
  assert.strictEqual(b.available, true, b.reason || '');
  assert.deepStrictEqual(b.loadErrors, [], 'لا وحدة تفشل في التحميل');
  assert.deepStrictEqual(b.missingModules, [], 'لا وحدة معلنة غائبة عن القرص');
  assert.strictEqual(b.failed.length, 0, 'فشل مِجسّات على محرك سليم: ' + JSON.stringify(b.failed));
  assert.strictEqual(b.passed, b.total);
  assert.ok(b.total >= 13, 'البطارية ضمرت — عدد المِجسّات ' + b.total);

  const found = ESD.detect({ publicDir: PUBLIC_DIR, battery: b, manifest: false });
  assert.strictEqual(found.incidents.length, 0,
    'حوادث من البطارية على محرك سليم: ' + JSON.stringify(found.incidents));
});

test('[E2E-1b] البطارية تغطي أكثر من وحدة واحدة — وإلا لا معنى لـ«عدم تراجع غيره»', () => {
  const mods = new Set(ESD.PROBES.map(p => p.module));
  assert.ok(mods.size >= 3, 'الوحدات المُستجوَبة: ' + [...mods].join(', '));
  assert.ok(mods.has('fix_verifier.js') && mods.has('learning_engine.js') && mods.has('analyzer.js'));
});

// ═══════════════════════════════════════════════════════════════════════
// 2. الاكتشاف: الخلل المحقون يُكتشف، بدليله
// ═══════════════════════════════════════════════════════════════════════

test('[E2E-2] الاكتشاف: مِجسّ واحد بالضبط يسقط، والدليل يذكر المتوقَّع والفعلي', () => {
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  const b = ESD.runBattery(opts);
  assert.strictEqual(b.available, true);
  assert.deepStrictEqual(b.failed, [TARGET_PROBE],
    'الخلل المحقون يجب أن يُسقط هذا المِجسّ وحده — الساقط فعلًا: ' + JSON.stringify(b.failed));

  const found = ESD.detect(Object.assign({}, opts, { battery: b }));
  assert.strictEqual(found.incidents.length, 1);
  const inc = found.incidents[0];
  assert.strictEqual(inc.probeId, TARGET_PROBE);
  assert.strictEqual(inc.module, VERIFIER, 'الحادثة تُنسب إلى الوحدة الصحيحة');
  assert.strictEqual(inc.kind, 'CONTRACT_VIOLATION', 'خطأ سلوكي بلا استثناء — لا PROBE_THREW');
  assert.match(inc.evidence.expected, /available=false/);
  assert.match(inc.evidence.actual,   /available=true/,
    'الدليل يجب أن يُظهر القيمة الفعلية الخاطئة: ' + inc.evidence.actual);
});

test('[E2E-2b] الخلل غير مكتشَف بالاستثناءات: الوحدة تُحمَّل وتعمل بلا رمي', () => {
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  const b = ESD.runBattery(opts);
  assert.deepStrictEqual(b.loadErrors, [], 'لا خطأ تحميل — monitor() ما كان ليرى شيئًا');
  assert.strictEqual(b.results[TARGET_PROBE].threw, false,
    'المِجسّ لم يرمِ استثناءً: المحرك أعاد جوابًا خاطئًا بصمت');
});

// ═══════════════════════════════════════════════════════════════════════
// 3. التشخيص: السبب بالأدلة، لا تخمين
// ═══════════════════════════════════════════════════════════════════════

test('[E2E-3] التشخيص: HUNK_REGRESSION بـhunk واحد، والعيّنة تُظهر السطر المتغيّر', () => {
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  const found = ESD.detect(opts);
  const dx = ESD.diagnose(found.incidents[0], opts);

  assert.strictEqual(dx.cause, 'HUNK_REGRESSION', dx.reason || '');
  assert.strictEqual(dx.module, VERIFIER);
  assert.strictEqual(dx.revertSet.length, 1, 'أصغر مجموعة تراجع يجب أن تكون hunk واحدًا');
  assert.strictEqual(dx.confidence, 'HIGH');
  assert.ok(dx.hunkCount >= 1);

  const h = dx.hunks[0];
  assert.ok(h.refSample.join('\n').includes('available: false'),
    'عيّنة المرجع يجب أن تحمل القيمة السليمة: ' + JSON.stringify(h.refSample));
  assert.ok(h.curSample.join('\n').includes('available: true'),
    'عيّنة الشجرة يجب أن تحمل القيمة المعطوبة: ' + JSON.stringify(h.curSample));
  assert.ok(Array.isArray(h.curLines) && h.curLines[0] > 0, 'الدليل يحدد موضع السطر');
});

test('[E2E-3b] التشخيص يميّز الخلل القديم: نفس العطب في المرجع ⇒ PRE_EXISTING بلا إصلاح', () => {
  // الحالي والمرجع كلاهما معطوب — ليس تراجعًا، فلا يُقترح إصلاح
  const sources = {
    kind: 'test-both-broken', publicDir: PUBLIC_DIR,
    current(mod) { return mod === VERIFIER ? DEFECTIVE_VERIFIER
      : (fs.existsSync(path.join(PUBLIC_DIR, mod)) ? fs.readFileSync(path.join(PUBLIC_DIR, mod), 'utf8') : null); },
    reference(mod) { return mod === VERIFIER ? DEFECTIVE_VERIFIER
      : (fs.existsSync(path.join(PUBLIC_DIR, mod)) ? fs.readFileSync(path.join(PUBLIC_DIR, mod), 'utf8') : null); },
  };
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources }, FOCUS);
  const found = ESD.detect(opts);
  assert.strictEqual(found.incidents.length, 1, 'الخلل يُكتشف أيضًا حين يكون قديمًا');
  const dx = ESD.diagnose(found.incidents[0], opts);
  assert.strictEqual(dx.cause, 'PRE_EXISTING', 'cause=' + dx.cause);
  assert.strictEqual(ESD.propose(dx), null, 'لا اقتراح إصلاح لخلل غير قابل للعزو إلى تغيير');
});

test('[E2E-3c] بلا نسخة مرجعية ⇒ NO_REFERENCE بلا إصلاح — لا اختراع أساس', () => {
  const sources = Object.assign({}, injectedSources(), { reference() { return null; } });
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources }, FOCUS);
  const dx = ESD.diagnose(ESD.detect(opts).incidents[0], opts);
  assert.strictEqual(dx.cause, 'NO_REFERENCE');
  assert.strictEqual(ESD.propose(dx), null);
});

// ═══════════════════════════════════════════════════════════════════════
// 4. الاقتراح
// ═══════════════════════════════════════════════════════════════════════

test('[E2E-4] الاقتراح: الـcandidate يساوي النسخة السليمة بايتًا، ومصدره git لا مولّد', () => {
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  const dx = ESD.diagnose(ESD.detect(opts).incidents[0], opts);
  const p  = ESD.propose(dx);

  assert.ok(p, 'يجب أن يوجد اقتراح');
  assert.strictEqual(p.module, VERIFIER);
  assert.strictEqual(p.originalCode, DEFECTIVE_VERIFIER, 'الأصل هو نسخة الشجرة المعطوبة');
  assert.strictEqual(p.patchedCode, REAL_VERIFIER,
    'التراجع عن الـhunk الوحيد يجب أن يُعيد النسخة السليمة حرفًا بحرف');
  assert.match(p.reason, /git HEAD/, 'التوثيق يذكر مصدر الإصلاح');
});

// ═══════════════════════════════════════════════════════════════════════
// 5. الاختبار المعزول + عدم تراجع بقية القدرات
// ═══════════════════════════════════════════════════════════════════════

test('[E2E-5] الاختبار المعزول: المِجسّ المستهدف يُصلَح وصفر تراجع، والشكل يلائم allPassed', () => {
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  const baseline = ESD.runBattery(opts);
  const dx = ESD.diagnose(ESD.detect(Object.assign({}, opts, { battery: baseline })).incidents[0], opts);
  const p  = ESD.propose(dx);

  const runner = ESD.makeTestRunner(TARGET_PROBE, baseline, opts);
  const r = runner(p.originalCode, p.patchedCode, VERIFIER, []);

  assert.strictEqual(r.syntax.pass, true, 'الـcandidate يُحلَّل');
  assert.strictEqual(r.engines.targetProbe.pass, true, 'المِجسّ المستهدف صار ناجحًا');
  assert.strictEqual(r.regression.pass, true, r.regression.regressionMsg || '');
  assert.deepStrictEqual(r.regression.regressed, [], 'لا مِجسّ كان ناجحًا سقط');
  assert.deepStrictEqual(r.regression.newLoadErrors, [], 'لا وحدة توقفت عن التحميل');
  assert.strictEqual(r.regression.probesPassedBefore, baseline.total - 1);
  assert.strictEqual(r.regression.probesPassedAfter, baseline.total, 'كل المِجسّات تنجح بعد الإصلاح');
  assert.strictEqual(r.security.pass, true, 'لا نمط خطر جديد');

  // الشكل نفسه الذي يحكم عليه Tests.allPassed في self_healing_engine.js
  assert.strictEqual(SH.Tests.allPassed(r), true, 'allPassed يجب أن يقبل هذا الشكل بلا تعديل عليه');
});

test('[E2E-5b] مُرشَّح يُصلح المستهدف ويكسر غيره ⇒ regression ⇒ allPassed=false', () => {
  // نبني مُرشَّحًا خبيثًا: يُصلح heredoc (يعيد available:false) ويكسر مِجسّ
  // آخر في نفس الوحدة — كشف PHP المكسور. هذا هو الحال الذي من أجله وُجد
  // فحص «عدم تراجع الوظائف الأخرى».
  const BROKEN_ANCHOR = 'if (v === "ok") return { ok: true, available: true, language, reason: null };';
  assert.strictEqual(REAL_VERIFIER.split(BROKEN_ANCHOR).length - 1, 1, 'مرساة ثانية موجودة مرة واحدة');
  const malicious = REAL_VERIFIER.replace(BROKEN_ANCHOR,
    'if (v === "ok" || /^broken/.test(v)) return { ok: true, available: true, language, reason: null };');

  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  const baseline = ESD.runBattery(opts);
  const runner = ESD.makeTestRunner(TARGET_PROBE, baseline, opts);
  const r = runner(DEFECTIVE_VERIFIER, malicious, VERIFIER, []);

  assert.strictEqual(r.engines.targetProbe.pass, true, 'المستهدف صار ناجحًا — ومع ذلك يُرفض');
  assert.strictEqual(r.regression.pass, false, 'كسرُ مِجسّ آخر يجب أن يُسقط الفحص');
  assert.ok(r.regression.regressed.some(x => x.id === 'gate.php-broken-detected'),
    'التراجع المُبلَّغ: ' + JSON.stringify(r.regression.regressed.map(x => x.id)));
  assert.strictEqual(SH.Tests.allPassed(r), false, 'لا قبول مع تراجع');
});

test('[E2E-5d] مُرشَّح لا يُصلح المستهدف ⇒ لا قبول، وإن لم يكسر شيئًا', () => {
  // ثغرة كشفها مسح التحوّرات: تثبيت targetFixed على true كان ينجو من كل
  // الاختبارات، لأن كلها تفحص مُرشَّحًا يُصلح فعلًا. فـpatch خامل كان يمرّ
  // كـPASS: لا يكسر شيئًا ولا يُصلح شيئًا، ويُعرض على المراجعة كإصلاح.
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  const baseline = ESD.runBattery(opts);
  const runner = ESD.makeTestRunner(TARGET_PROBE, baseline, opts);

  const inert = DEFECTIVE_VERIFIER + '\n// تغيير خامل: لا يمسّ الخلل\n';
  const r = runner(DEFECTIVE_VERIFIER, inert, VERIFIER, []);

  assert.strictEqual(r.syntax.pass, true, 'يُحلَّل');
  assert.strictEqual(r.regression.pass, true, 'لم يكسر شيئًا — فالرفض ليس بسبب تراجع');
  assert.strictEqual(r.engines.targetProbe.pass, false, 'المِجسّ المستهدف ما زال فاشلًا');
  assert.strictEqual(r.regression.probesPassedAfter, baseline.total - 1, 'لا تحسّن في العدد');
  assert.strictEqual(SH.Tests.allPassed(r), false, 'لا قبول بلا إصلاح فعلي');

  // وعبر المسار الكامل: heal يجب أن يتراجع لا أن يعرضه للمراجعة
  const token = 'E2E5D';
  const provider = (code, problem) => (problem && problem.__esdToken === token)
    ? { patchedCode: inert, confidence: 'HIGH', reason: 'مُرشَّح خامل', changedCount: 1 } : null;
  SH.SelfHealing.registerPatchProvider(provider);
  try {
    const healed = SH.SelfHealing.heal({
      type: 'ENGINE_SELF_DEFECT', engine: VERIFIER, fileName: VERIFIER,
      code: DEFECTIVE_VERIFIER, detail: 'مُرشَّح لا يُصلح', targetIssues: [], __esdToken: token,
      testRunner: runner,
    });
    assert.strictEqual(healed.status, SH.Status.ROLLED_BACK, 'لا PENDING_REVIEW لمُرشَّح خامل');
    assert.strictEqual(healed.result, SH.HealingResult.FAIL);
    assert.strictEqual(healed.patchedCode, undefined, 'لا يُعرض على المراجعة');
  } finally {
    SH.SelfHealing.unregisterPatchProvider(provider);
  }
});

test('[E2E-5c] مُرشَّح لا يُحلَّل ⇒ يسقط قبل تشغيل البطارية', () => {
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  const baseline = ESD.runBattery(opts);
  const runner = ESD.makeTestRunner(TARGET_PROBE, baseline, opts);
  const r = runner(DEFECTIVE_VERIFIER, 'var FixVerifier = (() => { return {', VERIFIER, []);
  assert.strictEqual(r.syntax.pass, false);
  assert.strictEqual(r.regression.pass, false);
  assert.strictEqual(SH.Tests.allPassed(r), false);
});

// ═══════════════════════════════════════════════════════════════════════
// 6. الدورة كاملة عبر SelfHealing — PENDING_REVIEW، سجل، لقطة، تراجع
// ═══════════════════════════════════════════════════════════════════════

test('[E2E-6] runCycle: PENDING_REVIEW بلا تطبيق، مع سجل ولقطة تحمل الأصل', () => {
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  const out = ESD.runCycle(opts);

  assert.strictEqual(out.available, true, out.reason || '');
  assert.strictEqual(out.incidents, 1);
  assert.strictEqual(out.cycles.length, 1);

  const c = out.cycles[0];
  assert.strictEqual(c.probeId, TARGET_PROBE);
  assert.strictEqual(c.module, VERIFIER);
  assert.strictEqual(c.cause, 'HUNK_REGRESSION');
  assert.strictEqual(c.confidence, 'HIGH');
  assert.strictEqual(c.status, SH.Status.PENDING_REVIEW, 'الحالة الافتراضية يجب أن تكون PENDING_REVIEW');
  assert.strictEqual(c.result, SH.HealingResult.PASS, 'الاختبارات نجحت');
  assert.strictEqual(c.patchedCode, REAL_VERIFIER, 'الـpatch المعروض للمراجعة هو النسخة السليمة');
  assert.ok(c.healingId, 'لا بد من معرّف حادثة في السجل');

  // السجل
  const entry = SH.SelfHealing.getById(c.healingId);
  assert.ok(entry, 'الحادثة مسجَّلة');
  assert.strictEqual(entry.status, SH.Status.PENDING_REVIEW);
  assert.strictEqual(entry.type, 'ENGINE_SELF_DEFECT');
  assert.strictEqual(entry.fileName, VERIFIER);
  assert.ok(String(entry.detail).includes('available=true'), 'السجل يحمل الدليل: ' + entry.detail);
  assert.ok(entry.patch && entry.patch.changedCount >= 1, 'السجل يحمل diff');
  assert.ok(SH.SelfHealing.getPending().some(e => e.id === c.healingId), 'يظهر في قائمة المنتظِرة');

  // اللقطة = مادة التراجع: النسخة **قبل** الإصلاح
  const snap = SH.SelfHealing.getSnapshot(c.healingId);
  assert.ok(snap, 'لا بد من لقطة');
  assert.strictEqual(snap.files[VERIFIER], DEFECTIVE_VERIFIER,
    'اللقطة يجب أن تحفظ نسخة ما قبل الإصلاح كي يكون التراجع ممكنًا');
  assert.ok(snap.patch && typeof snap.patch.patchedCode === 'string');

  // لا شيء كُتب على القرص
  assert.strictEqual(fs.readFileSync(path.join(PUBLIC_DIR, VERIFIER), 'utf8'), REAL_VERIFIER,
    'ملف الإنتاج يجب أن يبقى كما هو — لا تطبيق صامت');

  // التصدير للمراجعة البشرية
  const log = JSON.parse(SH.SelfHealing.exportLog());
  assert.ok(log.entries.some(e => e.id === c.healingId), 'قابل للتصدير');
});

test('[E2E-6b] approve: لا يُطبَّق إلا بنداء صريح، والحالة APPROVED بعد نجاح التطبيق', () => {
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  const c = ESD.runCycle(opts).cycles[0];

  let applied = null;
  const r = SH.SelfHealing.approve(c.healingId, c.patchedCode, (code) => { applied = code; });
  assert.strictEqual(r.status, SH.Status.APPROVED, JSON.stringify(r));
  assert.strictEqual(applied, REAL_VERIFIER, 'applyCallback يتلقّى الـpatch المُعتمد');
  assert.strictEqual(SH.SelfHealing.getById(c.healingId).status, SH.Status.APPROVED);
  // والقرص ما زال بيد المستدعي: الدورة نفسها لا تكتب
  assert.strictEqual(fs.readFileSync(path.join(PUBLIC_DIR, VERIFIER), 'utf8'), REAL_VERIFIER);
});

test('[E2E-6c] approve يرفض patch غير الذي اختُبر — لا تبديل بعد الفحص', () => {
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  const c = ESD.runCycle(opts).cycles[0];

  let applied = null;
  const tampered = c.patchedCode + '\n// حُقِن بعد الفحص\n';
  const r = SH.SelfHealing.approve(c.healingId, tampered, (code) => { applied = code; });
  assert.strictEqual(r.status, 'REJECTED', JSON.stringify(r));
  assert.match(r.error, /لا يطابق ما تم اختباره/);
  assert.strictEqual(applied, null, 'لا تطبيق لِما لم يُفحص');
  assert.strictEqual(SH.SelfHealing.getById(c.healingId).status, SH.Status.PENDING_REVIEW,
    'الحالة تبقى منتظِرة');
});

test('[E2E-6d] reject: الحالة REJECTED ولا تُعتمد بعدها', () => {
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  const c = ESD.runCycle(opts).cycles[0];

  assert.strictEqual(SH.SelfHealing.reject(c.healingId).status, SH.Status.REJECTED);
  const again = SH.SelfHealing.approve(c.healingId, c.patchedCode, () => {});
  assert.strictEqual(again.status, 'REJECTED', 'اعتماد ما رُفض يجب أن يُرفَض');
  assert.match(again.error, /لا يمكن اعتماد غير PENDING_REVIEW/);
});

test('[E2E-6e] فشل applyCallback يُبقي الحالة PENDING_REVIEW ويسجّل الخطأ', () => {
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  const c = ESD.runCycle(opts).cycles[0];

  const r = SH.SelfHealing.approve(c.healingId, c.patchedCode, () => { throw new Error('القرص للقراءة فقط'); });
  assert.strictEqual(r.status, SH.Status.PENDING_REVIEW, JSON.stringify(r));
  assert.match(r.error, /applyCallback فشل/);
  const e = SH.SelfHealing.getById(c.healingId);
  assert.strictEqual(e.status, SH.Status.PENDING_REVIEW);
  assert.match(String(e.applyError), /القرص للقراءة فقط/);
});

// ═══════════════════════════════════════════════════════════════════════
// 7. مسار التراجع التلقائي
// ═══════════════════════════════════════════════════════════════════════

test('[E2E-7] فشل الاختبارات ⇒ ROLLED_BACK، وfinalCode هو الأصل', () => {
  // نُسجّل مزوّد patch يُعيد مُرشَّحًا يكسر مِجسًّا آخر، ونشغّل heal بمُشغِّل ESD.
  // هذا هو مسار الإنتاج نفسه: نفس heal، نفس allPassed، نفس Rollback.
  const BROKEN_ANCHOR = 'if (v === "ok") return { ok: true, available: true, language, reason: null };';
  const malicious = REAL_VERIFIER.replace(BROKEN_ANCHOR,
    'if (v === "ok" || /^broken/.test(v)) return { ok: true, available: true, language, reason: null };');

  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  const baseline = ESD.runBattery(opts);

  const token = 'E2E7';
  const provider = (code, problem) => {
    if (!problem || problem.__esdToken !== token) return null;
    return { patchedCode: malicious, confidence: 'HIGH', reason: 'مُرشَّح اختباري يكسر غيره', changedCount: 1 };
  };
  SH.SelfHealing.registerPatchProvider(provider);
  try {
    const healed = SH.SelfHealing.heal({
      type: 'ENGINE_SELF_DEFECT', engine: VERIFIER, fileName: VERIFIER,
      code: DEFECTIVE_VERIFIER, detail: 'اختبار مسار التراجع',
      targetIssues: [], __esdToken: token,
      testRunner: ESD.makeTestRunner(TARGET_PROBE, baseline, opts),
    });

    assert.strictEqual(healed.status, SH.Status.ROLLED_BACK, JSON.stringify(healed.status));
    assert.strictEqual(healed.result, SH.HealingResult.FAIL);
    assert.strictEqual(healed.finalCode, DEFECTIVE_VERIFIER, 'يُعيد الأصل لا الـpatch');
    assert.strictEqual(healed.patchedCode, undefined, 'لا patch معروض على مسار الفشل');

    const e = SH.SelfHealing.getById(healed.id);
    assert.strictEqual(e.status, SH.Status.ROLLED_BACK);
    assert.match(String(e.rollbackMsg), /Rollback/);
    assert.ok(e.testResults && e.testResults.regression.pass === false, 'سبب الفشل محفوظ في السجل');

    // لا يمكن اعتماد ما تم التراجع عنه
    const r = SH.SelfHealing.approve(healed.id, malicious, () => {});
    assert.strictEqual(r.status, 'REJECTED');
  } finally {
    SH.SelfHealing.unregisterPatchProvider(provider);
  }
});

test('[E2E-7b] استثناء من testRunner ⇒ لا قبول (fail-closed)', () => {
  const token = 'E2E7B';
  const provider = (code, problem) =>
    (problem && problem.__esdToken === token)
      ? { patchedCode: code + '\n// x\n', confidence: 'LOW', reason: 'اختبار', changedCount: 1 }
      : null;
  SH.SelfHealing.registerPatchProvider(provider);
  try {
    const healed = SH.SelfHealing.heal({
      type: 'ENGINE_SELF_DEFECT', engine: VERIFIER, fileName: VERIFIER,
      code: REAL_VERIFIER, detail: 'مُشغِّل يرمي', targetIssues: [], __esdToken: token,
      testRunner() { throw new Error('انهار المُشغِّل'); },
    });
    assert.strictEqual(healed.status, SH.Status.ROLLED_BACK, 'استثناء ⇒ تراجع لا قبول');
    assert.strictEqual(healed.result, SH.HealingResult.FAIL);
  } finally {
    SH.SelfHealing.unregisterPatchProvider(provider);
  }
});

test('[E2E-7c] مُشغِّل يُعيد شكلًا ناقصًا ⇒ لا قبول', () => {
  const token = 'E2E7C';
  const provider = (code, problem) =>
    (problem && problem.__esdToken === token)
      ? { patchedCode: code + '\n// y\n', confidence: 'LOW', reason: 'اختبار', changedCount: 1 }
      : null;
  SH.SelfHealing.registerPatchProvider(provider);
  try {
    const healed = SH.SelfHealing.heal({
      type: 'ENGINE_SELF_DEFECT', engine: VERIFIER, fileName: VERIFIER,
      code: REAL_VERIFIER, detail: 'شكل ناقص', targetIssues: [], __esdToken: token,
      testRunner: () => ({ syntax: { pass: true } }),   // لا regression ولا security
    });
    assert.strictEqual(healed.status, SH.Status.ROLLED_BACK, 'مفتاح ناقص = غير مُثبَت = رفض');
  } finally {
    SH.SelfHealing.unregisterPatchProvider(provider);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 8. حوادث لا يُقترح لها إصلاح آلي — تُسجَّل ولا تُخفى
// ═══════════════════════════════════════════════════════════════════════

test('[E2E-8] وحدة غائبة عن القرص ⇒ حادثة MODULE_MISSING بلا اقتراح', () => {
  const sources = Object.assign({}, injectedSources({}), {
    current(mod) {
      if (mod === 'learning_engine.js') return null;   // نحاكي ملفًا غائبًا
      try { return fs.readFileSync(path.join(PUBLIC_DIR, mod), 'utf8'); } catch (_) { return null; }
    },
  });
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources }, FOCUS);
  const found = ESD.detect(opts);

  const miss = found.incidents.filter(i => i.kind === 'MODULE_MISSING');
  assert.strictEqual(miss.length, 1, JSON.stringify(found.incidents.map(i => i.kind)));
  assert.strictEqual(miss[0].module, 'learning_engine.js');

  const dx = ESD.diagnose(miss[0], opts);
  assert.strictEqual(dx.cause, 'MODULE_MISSING');
  assert.strictEqual(ESD.propose(dx), null, 'لا إصلاح آلي لوحدة غائبة');
});

test('[E2E-8b] وحدة لا تُحمَّل ⇒ MODULE_LOAD_ERROR بدليل الاستثناء، بلا اقتراح', () => {
  const sources = injectedSources({ 'learning_engine.js': 'var LearningEngine = (() => { return {' });
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources }, FOCUS);
  const b = ESD.runBattery(opts);
  assert.strictEqual(b.loadErrors.length, 1, JSON.stringify(b.loadErrors));
  assert.strictEqual(b.loadErrors[0].module, 'learning_engine.js');

  const found = ESD.detect(Object.assign({}, opts, { battery: b }));
  const le = found.incidents.filter(i => i.kind === 'MODULE_LOAD_ERROR');
  assert.strictEqual(le.length, 1);
  assert.ok(le[0].evidence.actual.length > 0, 'نصّ الاستثناء محفوظ كدليل');

  const dx = ESD.diagnose(le[0], opts);
  assert.strictEqual(dx.cause, 'NOT_PROBEABLE');
  assert.strictEqual(ESD.propose(dx), null);
});

// ═══════════════════════════════════════════════════════════════════════
// 9. عزل حقيقي: الدورة لا تتلوّث ولا تُلوِّث
// ═══════════════════════════════════════════════════════════════════════

test('[E2E-9] العزل: الـcandidate لا يصل إلى السياق الحيّ ولا إلى بطارية تالية', () => {
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  ESD.runCycle(opts);

  // بعد دورة كاملة على نسخة معطوبة، البطارية على الشجرة الحقيقية سليمة
  const after = ESD.runBattery({ publicDir: PUBLIC_DIR });
  assert.strictEqual(after.failed.length, 0, 'تلوّث: ' + JSON.stringify(after.failed));

  // والمحرك المُحمَّل في عملية الاختبار نفسها لم يتغيّر
  const FV = require(path.join(PUBLIC_DIR, 'fix_verifier.js'));
  const v = FV.syntaxCheck('<?php\n$s = <<<SQL\nSELECT 1\nSQL;\n', 'a.php');
  assert.strictEqual(v.available, false, 'السياق الحيّ ما زال على السياسة السليمة');
});

test('[E2E-9b] تحديد الوحدة: حقن خلل في learning_engine يُنسب إليها لا إلى غيرها', () => {
  // خلل حقيقي الشكل: خفض عتبة الأدلة من تحقّقين إلى واحد — يصير النمط معتمدًا
  // بدليل واحد. مقيس: approved=1 بعد تحقّق واحد بدل 0.
  //
  // ولماذا ليس `const THRESHOLDS = { MIN_VERIFIED: 0,` كما حاولت أولًا: إضافة
  // المفتاح في أول الكائن يسبقه المفتاح الأصلي لاحقًا، والأخير يغلب في JS —
  // فكان الحقن بلا أثر. قياسٌ أثبت أن الفرضية خاطئة لا الإنتاج.
  const realLE = fs.readFileSync(path.join(PUBLIC_DIR, 'learning_engine.js'), 'utf8');
  const A = 'MIN_VERIFIED:   2,';
  assert.strictEqual(realLE.split(A).length - 1, 1, 'مرساة العتبة موجودة مرة واحدة');
  const defectiveLE = realLE.replace(A, 'MIN_VERIFIED:   1,');

  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources({ 'learning_engine.js': defectiveLE }) }, FOCUS);
  const b = ESD.runBattery(opts);
  assert.deepStrictEqual(b.failed, ['learning.evidence-threshold-holds'],
    'الخلل يجب أن يُسقط مِجسّ العتبة وحده — الساقط: ' + JSON.stringify(b.failed));
  assert.match(b.results['learning.evidence-threshold-holds'].actual, /approved=1/,
    'الدليل يُظهر الاعتماد بدليل واحد');
  for (const id of b.failed) {
    assert.strictEqual(b.results[id].module, 'learning_engine.js',
      'كل فشل يجب أن يُنسب إلى الوحدة المحقونة، لا إلى ' + b.results[id].module);
  }

  const dx = ESD.diagnose(ESD.detect(Object.assign({}, opts, { battery: b })).incidents[0], opts);
  assert.strictEqual(dx.cause, 'HUNK_REGRESSION', dx.reason || '');
  assert.strictEqual(dx.module, 'learning_engine.js');
  const p = ESD.propose(dx);
  assert.strictEqual(p.patchedCode, realLE, 'الإصلاح يُعيد النسخة السليمة');
});

// ═══════════════════════════════════════════════════════════════════════
// 10. أدوات الـdiff — صحة التراجع نفسه
// ═══════════════════════════════════════════════════════════════════════

test('[E2E-10] التراجع عن مجموعة فارغة = الشجرة، وعن كل الـhunks = المرجع', () => {
  const ref = 'a\nb\nc\nd\ne\n';
  const cur = 'a\nB\nc\nd\nE\n';
  const refL = ESD._internals.splitLines(ref), curL = ESD._internals.splitLines(cur);
  const d = ESD._internals.buildHunks(refL, curL);

  assert.strictEqual(d.hunks.length, 2, 'تغييران منفصلان = hunkان');
  assert.strictEqual(ESD._internals.rebuild(d, new Set(), refL, curL), cur);
  assert.strictEqual(ESD._internals.rebuild(d, new Set([0, 1]), refL, curL), ref);
  assert.strictEqual(ESD._internals.rebuild(d, new Set([0]), refL, curL), 'a\nb\nc\nd\nE\n');
  assert.strictEqual(ESD._internals.rebuild(d, new Set([1]), refL, curL), 'a\nB\nc\nd\ne\n');
});

test('[E2E-10b] الإضافة والحذف الصريحان يُعاد بناؤهما بدقة', () => {
  const ref = 'x\ny\n';
  const cur = 'x\nNEW1\nNEW2\ny\n';
  const refL = ESD._internals.splitLines(ref), curL = ESD._internals.splitLines(cur);
  const d = ESD._internals.buildHunks(refL, curL);
  assert.strictEqual(ESD._internals.rebuild(d, new Set(), refL, curL), cur);
  assert.strictEqual(ESD._internals.rebuild(d, new Set(d.hunks.map((_, i) => i)), refL, curL), ref);

  const ref2 = 'x\nGONE\ny\n';
  const cur2 = 'x\ny\n';
  const r2 = ESD._internals.splitLines(ref2), c2 = ESD._internals.splitLines(cur2);
  const d2 = ESD._internals.buildHunks(r2, c2);
  assert.strictEqual(ESD._internals.rebuild(d2, new Set(), r2, c2), cur2);
  assert.strictEqual(ESD._internals.rebuild(d2, new Set(d2.hunks.map((_, i) => i)), r2, c2), ref2);
});

test('[E2E-10d] CRLF محفوظ: الـpatch لا يعيد كتابة كل سطر بصمت', () => {
  const ref = 'a\r\nb\r\nc\r\n';
  const cur = 'a\r\nB\r\nc\r\n';
  const refL = ESD._internals.splitLines(ref), curL = ESD._internals.splitLines(cur);
  assert.strictEqual(ESD._internals.dominantEol(cur), '\r\n', 'كشف نهاية السطر');
  const d = ESD._internals.buildHunks(refL, curL);
  assert.strictEqual(ESD._internals.rebuild(d, new Set([0]), refL, curL, '\r\n'), ref,
    'التراجع يُعيد الملف بنهايات أسطره الأصلية');
  // وبلا تمرير eol يبقى الافتراض LF — وهو ما عليه ملفات public اليوم
  assert.strictEqual(ESD._internals.dominantEol('x\ny\n'), '\n');
});

test('[E2E-10e] سقف الذاكرة: فوق الحد ⇒ hunk واحد للملف كله لا انهيار', () => {
  const big = Array.from({ length: 2100 }, (_, i) => 'line ' + i);
  const big2 = big.slice(); big2[5] = 'CHANGED';
  const d = ESD._internals.buildHunks(big, big2);
  // 2101 × 2101 = 4.41M خلية > السقف ⇒ المسار المحافظ
  assert.strictEqual(d.whole, true, 'يجب أن يسلك المسار المحافظ');
  assert.strictEqual(d.hunks.length, 1);
  assert.strictEqual(ESD._internals.rebuild(d, new Set(), big, big2), big2.join('\n'));
  assert.strictEqual(ESD._internals.rebuild(d, new Set([0]), big, big2), big.join('\n'));

  // وتحت السقف يعمل التحليل الدقيق
  const s1 = Array.from({ length: 300 }, (_, i) => 'L' + i);
  const s2 = s1.slice(); s2[7] = 'X';
  const d2 = ESD._internals.buildHunks(s1, s2);
  assert.strictEqual(d2.whole, false);
  assert.strictEqual(d2.hunks.length, 1, 'تغيير واحد = hunk واحد');
});

test('[E2E-10c] ملفان متطابقان ⇒ صفر hunks، وإعادة البناء محافظة', () => {
  const s = 'p\nq\nr\n';
  const L = ESD._internals.splitLines(s);
  const d = ESD._internals.buildHunks(L, L);
  assert.strictEqual(d.hunks.length, 0);
  assert.strictEqual(ESD._internals.rebuild(d, new Set(), L, L), s);
});

// ═══════════════════════════════════════════════════════════════════════
// 11. لا انحراف عن سياق الخادم
// ═══════════════════════════════════════════════════════════════════════

test('[E2E-11] قائمة الوحدات لا تتباعد عن قائمة api/analyze.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'analyze.js'), 'utf8');
  const m = src.match(/const engines = \[([\s\S]*?)\];/);
  assert.ok(m, 'قائمة محركات الخادم غير موجودة في analyze.js — تغيّر شكلها');
  const serverList = [...m[1].matchAll(/'([^']+\.js)'/g)].map(x => x[1]);

  assert.deepStrictEqual(ESD.MODULES.slice(), serverList,
    'قائمة البطارية يجب أن تطابق قائمة الخادم حرفًا وترتيبًا — وإلا اختُبر محرك غير المُشغَّل');
});

test('[E2E-11c] المِجسّات تُنسب إلى وحدات موجودة في القائمة فعلًا', () => {
  for (const p of ESD.PROBES) {
    assert.ok(ESD.MODULES.includes(p.module), 'مِجسّ ' + p.id + ' ينسب نفسه إلى وحدة خارج القائمة: ' + p.module);
    assert.ok(fs.existsSync(path.join(PUBLIC_DIR, p.module)), 'وحدة غير موجودة: ' + p.module);
  }
  const ids = ESD.PROBES.map(p => p.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'معرّفات المِجسّات مكرّرة');
});

test('[E2E-11b] السِّمتان في self_healing_engine.js مكشوفتان ومثبَّتتان', () => {
  assert.strictEqual(typeof SH.SelfHealing.registerPatchProvider, 'function');
  assert.strictEqual(typeof SH.SelfHealing.unregisterPatchProvider, 'function');
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'self_healing_engine.js'), 'utf8');
  assert.ok(src.includes('[ESD-SEAM-1]'), 'سِمة المزوّد موثّقة في الإنتاج');
  assert.ok(src.includes('[ESD-SEAM-2]'), 'سِمة مُشغِّل الاختبارات موثّقة في الإنتاج');
  assert.ok(/typeof problem\.testRunner === "function"/.test(src), 'heal يحترم testRunner');
});

test('[E2E-11d] السلوك القائم لم يتغيّر: heal بلا مزوّد وبلا مُشغِّل = SKIPPED كما كان', () => {
  const r = SH.SelfHealing.heal({
    type: 'UNKNOWN_KIND', engine: 'x', fileName: 'a.js',
    code: 'var a = 1;', detail: 'نوع بلا fixer',
  });
  assert.strictEqual(r.status, SH.Status.PENDING_REVIEW);
  assert.strictEqual(r.result, SH.HealingResult.SKIPPED, 'المسار الافتراضي كما كان');
});

// ═══════════════════════════════════════════════════════════════════════
// 12. حدود معلنة
// ═══════════════════════════════════════════════════════════════════════

test('[E2E-12] بلا بيئة Node ⇒ available:false بصراحة، لا قدرة مُدّعاة', () => {
  const b = ESD.runBattery({ sources: null, publicDir: null });
  // المسار الافتراضي يعمل في Node؛ المقصود هنا أن غياب المصدر يُعلَن لا يُخمَّن
  if (b.available === false) {
    assert.ok(String(b.reason).length > 0, 'سبب عدم التوفّر معلن');
  } else {
    // في Node المصدر الافتراضي متاح — نتأكد أنه هو ما استُعمل
    assert.strictEqual(b.failed.length, 0);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 13. كاشف انحراف بيان الصفحة — على الشجرة الحقيقية، لا محقونًا
// ═══════════════════════════════════════════════════════════════════════

// ─── كاشف انحراف البيان ────────────────────────────────────────────────
//
// كان [E2E-13] يستند إلى خللٍ حقيقي قائم في الشجرة: وسمان يُعلنان
// sleep_manager.js وengine_ast.js وهما غير موجودين. وقد أُصلح الخلل:
//   engine_ast.js حلّ محلّه ast-engine.js (نفس الدوال الأربع، ويُحمَّل
//     قبله) فإعادته تطمس الأحدث؛ وsleep_manager.js لم يوجد في التاريخ
//     أصلًا ولا رمزٌ يطلبه. فالصحيح في الحالتين حذفُ الوسم، لا إنشاء ملف.
// وتفصيلُ ذلك وحرسُه في test/script_manifest_integrity.test.js.
//
// فالقدرة تُقاس الآن على **بيانٍ محقون** لا على عطبٍ في المُسلَّم: مرآةٌ
// بروابط رمزية لكل ملفات public، وindex.html مُعدَّل يُعلن سكربتًا غائبًا.
// وبهذا تبقى البطارية على المحركات الحقيقية ويصير الخلل مصنوعًا ومعروفًا.
// ويُحرَس الاتجاهان: الشجرة الحقيقية نظيفة، والبيان المعطوب يُكتشف.

let _mirror = null;
function manifestMirror(extraTag) {
  if (_mirror) return _mirror;
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esd-manifest-'));
  for (const f of fs.readdirSync(PUBLIC_DIR)) {
    if (f === 'index.html') continue;
    try { fs.symlinkSync(path.join(PUBLIC_DIR, f), path.join(dir, f)); } catch (_) {}
  }
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const tag = extraTag || '<script src="/__never_shipped__.js"></script>';
  // يُدسّ بعد أول وسم سكربت، فيصير له رقم سطرٍ حقيقي في الوسط لا في الذيل
  const at = html.indexOf('\n', html.indexOf('<script src="/'));
  fs.writeFileSync(path.join(dir, 'index.html'), html.slice(0, at + 1) + tag + '\n' + html.slice(at + 1));
  _mirror = dir;
  return dir;
}

test('[E2E-13] الشجرة الحقيقية نظيفة: كل سكربت معلن موجود على القرص', () => {
  const r = ESD.detectManifestDrift({ publicDir: PUBLIC_DIR });
  assert.strictEqual(r.available, true);
  assert.ok(r.declared >= 60, 'عدد السكربتات المعلنة: ' + r.declared);

  // الحقيقة تُحسب من الملف مباشرة، فلا يصير الاختبار مرآةً للكاشف
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const declared = [...html.matchAll(/<script\s+src="\/([^"]+\.js)"/g)].map(m => m[1]);
  const trulyMissing = declared.filter(f => !fs.existsSync(path.join(PUBLIC_DIR, f)));

  assert.strictEqual(r.declared, declared.length, 'عدّ المعلن يطابق الملف');
  assert.deepStrictEqual(trulyMissing, [], 'سكربتات معلنة وغائبة: ' + JSON.stringify(trulyMissing));
  assert.deepStrictEqual(r.incidents, [], 'حوادث بيان على شجرة نظيفة: ' + JSON.stringify(r.incidents));
});

test('[E2E-13a] والكاشف يجد السكربت الغائب في بيانٍ محقون، بدليله ورقم سطره', () => {
  const dir = manifestMirror();
  const r = ESD.detectManifestDrift({ publicDir: dir });
  assert.strictEqual(r.available, true);

  // العزل: المرآة تحمل سكربتًا واحدًا غائبًا بالضبط، والبقية موجودة
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const declared = [...html.matchAll(/<script\s+src="\/([^"]+\.js)"/g)].map(m => m[1]);
  const trulyMissing = declared.filter(f => !fs.existsSync(path.join(dir, f)));
  assert.deepStrictEqual(trulyMissing, ['__never_shipped__.js'],
    'المرآة ليست كما قُصدت: ' + JSON.stringify(trulyMissing));

  assert.deepStrictEqual(r.incidents.map(i => i.module), ['__never_shipped__.js']);
  const inc = r.incidents[0];
  assert.strictEqual(inc.kind, 'MANIFEST_MISSING_SCRIPT');
  assert.match(inc.evidence.actual, /index\.html:\d+/, 'الدليل يحدد رقم السطر: ' + inc.evidence.actual);
  assert.match(inc.evidence.actual, /صامت/, 'الدليل يذكر طبيعة الفشل');
  // ورقم السطر هو موضعُ الوسم فعلًا لا رقمًا ثابتًا
  const want = html.replace(/\r\n?/g, '\n').split('\n')
    .findIndex(l => /<script\s+src="\/__never_shipped__\.js"/.test(l)) + 1;
  assert.match(inc.evidence.actual, new RegExp('index\\.html:' + want + '\\b'),
    'رقم السطر المُبلَّغ ليس موضع الوسم (' + want + '): ' + inc.evidence.actual);
});

test('[E2E-13b] خلل البيان: اكتشافٌ فقط — يُسجَّل SKIPPED ولا يُقترح له إصلاح', () => {
  const opts = { publicDir: manifestMirror() };   // البيان مُفحوص افتراضًا
  const found = ESD.detect(opts);
  const man = found.incidents.filter(i => i.kind === 'MANIFEST_MISSING_SCRIPT');
  assert.ok(man.length >= 1, 'الكاشف مُفعَّل افتراضًا');
  assert.strictEqual(found.manifest.missing, man.length);

  const dx = ESD.diagnose(man[0], opts);
  assert.strictEqual(dx.cause, 'NOT_PROBEABLE', 'cause=' + dx.cause);
  assert.match(dx.reason, /قرار عن النية/, 'السبب يوضّح لماذا لا إصلاح آلي');
  assert.strictEqual(ESD.propose(dx), null, 'لا patch — حذف وسم أو إضافة ملف قرار بشري');

  // الدورة تسجّلها ولا تخفيها
  const out = ESD.runCycle(opts);
  assert.ok(out.incidents >= man.length);
  const cyc = out.cycles.filter(c => c.kind === 'MANIFEST_MISSING_SCRIPT');
  assert.ok(cyc.length >= 1);
  for (const c of cyc) {
    assert.strictEqual(c.status, SH.Status.PENDING_REVIEW, 'مُسجَّلة بانتظار المراجعة');
    assert.strictEqual(c.result, SH.HealingResult.SKIPPED, 'لا إصلاح — SKIPPED لا PASS');
    assert.strictEqual(c.patchedCode, undefined, 'لا patch معروض');
    const e = SH.SelfHealing.getById(c.healingId);
    assert.ok(e, 'في السجل');
    assert.match(String(e.note || ''), /مراجعة يدوية/, 'السجل يقول إنها تحتاج مراجعة يدوية');
  }
});

test('[E2E-13d] حادثة بلا patch لا تُعتمد — ولا يُنادى applyCallback', () => {
  // ثغرة كشفتها المراجعة النهائية: حادثة SKIPPED (لا إصلاح مقترح) حالتها
  // PENDING_REVIEW وpatchedCode غير موجود. فكان approve(id, undefined, cb)
  // يعبر فحص التطابق — الطرفان undefined — ويُنادي cb(undefined) ويصير
  // APPROVED. ولو كان cb يكتب على القرص لكتب undefined مكان الملف.
  const opts = { publicDir: manifestMirror() };
  const out = ESD.runCycle(opts);
  const skipped = out.cycles.filter(c => c.result === SH.HealingResult.SKIPPED);
  assert.ok(skipped.length >= 1, 'لا حادثة SKIPPED لاختبارها');

  for (const c of skipped) {
    assert.strictEqual(c.patchedCode, undefined, 'لا patch بالفعل');
    let called = false, arg = 'لم يُنادَ';
    const r = SH.SelfHealing.approve(c.healingId, c.patchedCode, (x) => { called = true; arg = x; });
    assert.strictEqual(r.status, 'REJECTED', 'الاعتماد يجب أن يُرفَض: ' + JSON.stringify(r));
    assert.match(r.error, /لا patch مُختبَر/);
    assert.strictEqual(called, false, 'applyCallback نُودي بـ' + String(arg));
    assert.strictEqual(SH.SelfHealing.getById(c.healingId).status, SH.Status.PENDING_REVIEW,
      'الحالة تبقى منتظِرة لا APPROVED');
  }
});

test('[E2E-13e] الحماية لا تمنع اعتماد patch صحيح — fail-closed لا تعطيل', () => {
  const opts = Object.assign({ publicDir: PUBLIC_DIR, sources: injectedSources() }, FOCUS);
  const c = ESD.runCycle(opts).cycles[0];
  assert.strictEqual(c.result, SH.HealingResult.PASS);
  let got = null;
  const r = SH.SelfHealing.approve(c.healingId, c.patchedCode, (x) => { got = x; });
  assert.strictEqual(r.status, SH.Status.APPROVED, JSON.stringify(r));
  assert.strictEqual(got, REAL_VERIFIER);
});

test('[E2E-13c] manifest:false يُقصي الكاشف فقط ولا يمسّ البطارية', () => {
  // على البيان المحقون لا على الشجرة النظيفة: لو قيس على النظيفة لكان
  // ‎missing=0‎ والفرق صفرًا، فيمرّ التأكيد بلا أن يقيس إقصاءً.
  const dir = manifestMirror();
  const withM    = ESD.detect({ publicDir: dir });
  const withoutM = ESD.detect({ publicDir: dir, manifest: false });
  assert.ok(withM.manifest.missing >= 1, 'العزل: لا خلل بيان ⇒ لا شيء يُقصى');
  assert.strictEqual(withoutM.incidents.filter(i => i.kind === 'MANIFEST_MISSING_SCRIPT').length, 0);
  assert.strictEqual(withoutM.manifest.checked, false);
  assert.deepStrictEqual(withM.battery, withoutM.battery, 'البطارية نفسها في الحالين');
  assert.strictEqual(withM.incidents.length - withoutM.incidents.length, withM.manifest.missing);
});

test('[E2E-12d] الدورة بلا SelfHealing ⇒ ترفض العمل بلا سجل', () => {
  const out = ESD.runCycle({
    publicDir: PUBLIC_DIR, sources: injectedSources(),
    selfHealing: { SelfHealing: null },
  });
  assert.strictEqual(out.available, false);
  assert.match(out.reason, /SelfHealing/);
});
