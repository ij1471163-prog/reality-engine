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
  for (const n of [2100, 4000]) {
    const base = Array.from({ length: n }, (_, i) => 'const v' + i + ' = ' + i + ';');
    const cand = base.slice();
    cand[10] = 'const v10 = 999;';
    cand[Math.floor(n / 2)] = 'const vMid = 0;';

    const r = FV.salvageVerifiedSubset(base.join('\n'), cand.join('\n'),
      (b, c) => (c.includes('v10 = 999') ? null : { ok: true }));
    assert.ok(r, n + ' سطرًا: الإنقاذ أُلغي — السقفُ يُقاس على الطول مرّةً أخرى');
    assert.strictEqual(r.kept, 1, n + ' سطرًا: kept=' + r.kept);
    assert.strictEqual(r.dropped, 1, n + ' سطرًا: dropped=' + r.dropped);
    assert.match(r.code, /const vMid = 0;/, n + ' سطرًا: الإصلاح المُثبَت لم يُطبَّق');
    assert.match(r.code, /const v10 = 10;/, n + ' سطرًا: الـhunk المرفوض لم يَعُد إلى الأصل');
  }
});

test('[DIFF-TRIM] والصِّمام قائم: رُقعةٌ تُعيد كتابة الملف كله ⇒ لا إنقاذ', () => {
  const a = Array.from({ length: 2100 }, (_, i) => 'a' + i).join('\n');
  const b = Array.from({ length: 2100 }, (_, i) => 'b' + (i * 7)).join('\n');
  assert.strictEqual(FV.salvageVerifiedSubset(a, b, acceptAll), null,
    'اختلافٌ واسع يجب أن يُطلق السقف — وإلا فجدولُ LCS بلا حدّ');
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
