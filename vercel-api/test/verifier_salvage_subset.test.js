// ═══════════════════════════════════════════════════════════════════════
// [SUBSET-SALVAGE] + [DIFF-TRIM] — إنقاذُ أكبر مجموعةٍ جزئية يُثبتها مُتحقِّق
// تشغيل:  node --test vercel-api/test/verifier_salvage_subset.test.js
//
// الدالّةُ مشتركةٌ بين مُستدعيَين: سلسلةُ RealityOrchestrator ومسارُ
// fix_engine_pipeline. ونسختان من منطقٍ كهذا هي بذاتها سببُ تكرار المشكلة:
// يُصلَح أحدهما ويبقى الآخر. فهي في البوابة، وهذا ملفُ عقدِها.
//
// و[DIFF-TRIM]: السقفُ كان يُقاس على **طول الملف** لا على المنطقة المختلفة،
// فيُلغي الإنقاذ كلّه فوق ~2000 سطر (‎null‎ ⇒ تسقط الرُقعة بأكملها وتُفقَد
// إصلاحاتُها المُثبَتة) — وهو عينُ العطب الذي جاء الإنقاذ لعلاجه، عائدًا من
// باب الكلفة. ونفسُ المعايرة أسقطت تشخيصَ engine_self_diagnosis حين نمت
// أكبرُ وحدة إلى 2018 سطرًا.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('node:path');

const FV = require(path.join(__dirname, '..', 'public', 'fix_verifier.js'));

const acceptAll = () => ({ ok: true });
const rejectAll = () => null;

test('[SAL-0] الدالّةُ مكشوفةٌ مع حدودها — مُستدعياها يقرآن نفس العقد', () => {
  assert.strictEqual(typeof FV.salvageVerifiedSubset, 'function');
  assert.strictEqual(typeof FV.SALVAGE_MAX_CELLS, 'number');
  assert.strictEqual(typeof FV.SALVAGE_MAX_HUNKS, 'number');
});

// ═══════════════════════════════════════════════════════════════════════
// 1. السلامة: الاقتصاص لا يُفقد سطرًا ولا يُبدّل ترتيبًا
// ═══════════════════════════════════════════════════════════════════════

test('[SAL-1] قبولُ كلِّ الـhunks يُعيد المُرشَّح بالحرف — 300 تعديل عشوائي', () => {
  // بذرةٌ ثابتة: الإخفاق يُعاد إنتاجه لا يُلاحَق.
  const rnd = seed => { let x = seed; return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; };
  let checked = 0;
  const failures = [];

  for (let trial = 0; trial < 300; trial++) {
    const r = rnd(trial + 1);
    const n = 3 + Math.floor(r() * 40);
    const base = Array.from({ length: n }, (_, i) => 'L' + i + (r() > 0.8 ? ' x' : ''));
    const cand = base.slice();
    const edits = 1 + Math.floor(r() * 5);
    for (let e = 0; e < edits; e++) {
      const at = Math.floor(r() * cand.length);
      const kind = r();
      if (kind < 0.4) cand[at] = 'CHANGED' + e;
      else if (kind < 0.7) cand.splice(at, 1);
      else cand.splice(at, 0, 'ADDED' + e);
    }
    const b = base.join('\n'), c = cand.join('\n');
    if (b === c) continue;
    checked++;

    const all = FV.salvageVerifiedSubset(b, c, acceptAll);
    // ‎null‎ مشروع: hunk واحد (حدُّ كلفةٍ مُعلَن) أو فوق حدّ الـhunks.
    if (all && all.dropped === 0 && all.code !== c) {
      failures.push('trial ' + trial + ': قُبلت كلُّ الـhunks والناتجُ ≠ المُرشَّح');
    }
    // ورفضُ كلِّ شيء لا يُنتج كودًا إطلاقًا
    if (FV.salvageVerifiedSubset(b, c, rejectAll) !== null) {
      failures.push('trial ' + trial + ': رفضٌ كامل لم يُعِد null');
    }
  }

  assert.ok(checked > 250, 'العيّنة صغيرة جدًّا: ' + checked);
  assert.deepStrictEqual(failures.slice(0, 5), [], 'إخفاقات: ' + failures.length);
});

test('[SAL-2] الجزئية هي العقد: الـhunk المُثبَت يُستبقى والآخر يُسقَط', () => {
  const base = ['keep0', 'BAD', 'keep1', 'keep2', 'GOOD', 'keep3'].join('\n');
  const cand = ['keep0', 'bad-fix', 'keep1', 'keep2', 'good-fix', 'keep3'].join('\n');
  // مُتحقِّقٌ يقبل ما لا يحمل bad-fix
  const r = FV.salvageVerifiedSubset(base, cand, (b, c) => (c.includes('bad-fix') ? null : { ok: true }));
  assert.ok(r, 'لم يُنقَذ شيء مع وجود hunk مُثبَت');
  assert.strictEqual(r.kept, 1);
  assert.strictEqual(r.dropped, 1);
  assert.match(r.code, /good-fix/, 'الإصلاح المُثبَت لم يُستبقَ');
  assert.doesNotMatch(r.code, /bad-fix/, 'الإصلاح المرفوض طُبِّق');
  assert.match(r.code, /^keep0\nBAD\nkeep1/, 'سطرُ الـhunk المُسقَط لم يَعُد إلى الأصل');
});

// ═══════════════════════════════════════════════════════════════════════
// 2. [DIFF-TRIM] السقفُ على المنطقة المختلفة لا على طول الملف
// ═══════════════════════════════════════════════════════════════════════

test('[DIFF-TRIM] رُقعةٌ موضعية على ملفٍ كبير تُنقَذ — لا تُلغى بحجّة الكلفة', () => {
  // قبل الاقتصاص: 2100×2100 = 4.41M خلية > 4M ⇒ null ⇒ تُفقَد الرُقعة كلها.
  //
  // والمواضع في الطرفين معًا: الاقتصاص طرفانِ مستقلّان، وكلُّ موضعٍ يُنجيه
  // طرفٌ واحد — فرُقعةٌ قريبةُ البداية تُنجيها اللاحقةُ وحدها، وقريبةُ
  // النهاية تُنجيها البادئةُ وحدها. ورُقعةٌ في موضعٍ واحد لا تُميّز تعطيلَ
  // أحد الطرفين (مقيس بتحوّرٍ نجا على نظيرِ هذا الاختبار في التشخيص).
  for (const n of [2100, 4000]) {
    const base = Array.from({ length: n }, (_, i) => 'const v' + i + ' = ' + i + ';');
    for (const [label, bad, good] of [
      ['البداية والوسط', 10, Math.floor(n / 2)],
      ['الوسط والنهاية', Math.floor(n / 2), n - 3],
    ]) {
      const cand = base.slice();
      cand[bad]  = 'const vBad = 999;';
      cand[good] = 'const vGood = 0;';

      const r = FV.salvageVerifiedSubset(base.join('\n'), cand.join('\n'),
        (b, c) => (c.includes('vBad') ? null : { ok: true }));
      const at = n + ' سطرًا / ' + label + ': ';
      assert.ok(r, at + 'الإنقاذ أُلغي — السقفُ يُقاس على الطول مرّةً أخرى');
      assert.strictEqual(r.kept, 1, at + 'kept=' + r.kept);
      assert.strictEqual(r.dropped, 1, at + 'dropped=' + r.dropped);
      assert.match(r.code, /const vGood = 0;/, at + 'الإصلاح المُثبَت لم يُطبَّق');
      assert.doesNotMatch(r.code, /vBad/, at + 'الـhunk المرفوض لم يَعُد إلى الأصل');
      assert.ok(r.code.includes('const v' + bad + ' = ' + bad + ';'),
        at + 'سطرُ الـhunk المُسقَط لم يُستعَد بنصّه الأصلي');
    }
  }
});

test('[DIFF-TRIM] والصِّمام قائم: رُقعةٌ تُعيد كتابة الملف كله ⇒ لا إنقاذ', () => {
  const a = Array.from({ length: 2100 }, (_, i) => 'a' + i).join('\n');
  const b = Array.from({ length: 2100 }, (_, i) => 'b' + (i * 7)).join('\n');
  assert.strictEqual(FV.salvageVerifiedSubset(a, b, acceptAll), null,
    'اختلافٌ واسع يجب أن يُطلق السقف — وإلا فجدولُ LCS بلا حدّ');
});

test('[DIFF-TRIM] documented: تغييرانِ على طرفَي ملفٍ كبير يبقيان فوق السقف', () => {
  // حدٌّ مُعلَن لا عطبٌ مستور. الاقتصاص يُفيد حين تتجاور التغييرات: تغييرانِ
  // على طرفَي ملفٍ من 2100 سطر يتركان المنطقةَ المختلفة هي الملفَ كلَّه
  // (2098² = 4.40M > 4M)، فيُطلَق السقفُ ويُعاد ‎null‎ — أي **نفسُ** السلوك
  // قبل [DIFF-TRIM]، لا أسوأ منه: تسقط الرُقعة بأكملها.
  //
  // وأصلُ هذا الحدّ جدولُ LCS الرُباعي نفسُه لا موضعُ القياس. وعلاجُه
  // الجذري خوارزميةُ Myers — كلفتُها ‎O((N+M)·D)‎ بمسافة التحرير لا بالطول،
  // فرُقعةٌ متفرّقةٌ على ملفٍ كبير تصير رخيصة. وهو تغييرٌ إنتاجيٌّ قائمٌ
  // بذاته، ولم يُدخَل في هذه الجولة: سلوكُ السقف **آمن** (لا إنقاذ، كما
  // كان) لا خاطئ، فليس عطبًا يُلزِم إصلاحَه مع ما سبق.
  const n = 2100;
  const base = Array.from({ length: n }, (_, i) => 'const v' + i + ' = ' + i + ';');
  const cand = base.slice();
  cand[2]     = 'const vHead = 1;';
  cand[n - 2] = 'const vTail = 1;';
  assert.strictEqual(FV.salvageVerifiedSubset(base.join('\n'), cand.join('\n'), acceptAll), null,
    'لو صار هذا الإنقاذ ممكنًا فقد تغيّر الحدّ — حدِّثْ هذا الاختبار وقِسْ الكلفة');
});

// ═══════════════════════════════════════════════════════════════════════
// 3. الحدود المُعلَنة
// ═══════════════════════════════════════════════════════════════════════

test('[SAL-3] documented: hunk واحد ⇒ null — حدُّ كلفةٍ لا حمايةُ صحة', () => {
  // المجموعةُ الوحيدة الممكنة هي الرُقعة كلها، وقد رُفضت قبل النداء. فالشرط
  // توفيرُ نداءِ مُتحقِّقٍ: بدونه يُجرَّب المُرشَّح نفسه ويُرفض ويُعاد null —
  // نفس النتيجة بكلفةٍ زائدة. ولذلك لا يُسقط تحوّرُه اختبارًا، وهو مُعلَن.
  const base = ['x', 'ONE', 'y'].join('\n');
  const cand = ['x', 'one-fix', 'y'].join('\n');
  assert.strictEqual(FV.salvageVerifiedSubset(base, cand, acceptAll), null);
});

test('[SAL-4] حدودُ المُدخَل: لا مُتحقِّق، أو لا تغيير، أو ليس نصًّا ⇒ null', () => {
  assert.strictEqual(FV.salvageVerifiedSubset('a\nb', 'a\nc', null), null);
  assert.strictEqual(FV.salvageVerifiedSubset('a\nb', 'a\nb', acceptAll), null);
  assert.strictEqual(FV.salvageVerifiedSubset(null, 'a', acceptAll), null);
  assert.strictEqual(FV.salvageVerifiedSubset('a', undefined, acceptAll), null);
});

test('[SAL-5] فوق حدّ الـhunks ⇒ null بدل نداءِ مُتحقِّقٍ لكل واحد', () => {
  const n = FV.SALVAGE_MAX_HUNKS + 5;
  const base = [], cand = [];
  for (let i = 0; i < n; i++) { base.push('H' + i, 'sep' + i); cand.push('h-fix' + i, 'sep' + i); }
  let calls = 0;
  assert.strictEqual(
    FV.salvageVerifiedSubset(base.join('\n'), cand.join('\n'), () => { calls++; return acceptAll(); }),
    null);
  assert.strictEqual(calls, 0, 'نُودِي المُتحقِّق فوق الحدّ: ' + calls);
});
