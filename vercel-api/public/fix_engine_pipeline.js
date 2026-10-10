// fix_engine_pipeline.js v2.0 — Ghost + Learning Pipeline
// © 2025 Naif Lucena — Reality Engine
//
// ═══════════════════════════════════════════════════════
// القاعدة الحاكمة: لا كتابة على F[fn] بلا بوابة.
//
// كل تعديل — من أي محرك كان — يمر عبر FixVerifier.verifyFix() قبل أن
// يُكتب. لا استثناءات. المحركات التي تعدّل F/R بالمرجع (SmartRepair،
// Fallback، Emergency) تُشغَّل على **نسخة مؤقتة**، ثم يُقارَن كل ملف تغيّر
// ويُمرَّر عبر البوابة قبل الكتابة على F الحقيقي.
//
// ما كان يحدث في v1.0:
//   [1] F[fn] = finalCode كان يُنفَّذ بغض النظر عن verdict الخاص بـGhost.
//       شرط verdict==='pass' كان يحكم **التعلّم فقط**، لا الكتابة. فإذا
//       رجع Ghost FAIL أو REGRESSION يُكتب الكود على أي حال ويصير أساس
//       الـpass التالي. وإذا كان GhostMode غير معرّف أصلًا، يُكتب
//       result.repaired مباشرة بلا أي حكم.
//   [2] totalFixed كان يزيد حتى عند رفض التعديل ⇒ رقم مبالغ فيه للمستخدم.
//   [3] RepairSQL كان يكتب F[fn] = r.code مباشرة.
//   [4] SmartRepair/Fallback/Emergency تكتب داخليًا على F و R بالمرجع.
//   [5] applyLearned كان المسار الوحيد الذي فيه تحقق فعلي.
//
// ⚠️ HTML: لا يوجد فاحص تركيبي موثوق لـHTML في FixVerifier، لذلك تعديلات
//    HTMLRepair سترفضها البوابة حاليًا (Fail-Closed). هذا مقصود. المحرك
//    يبقى يعمل ويقترح، ويُسجَّل الرفض في pipelineReport.rejected حتى
//    يُضاف parser موثوق لاحقًا. لا نفعّل allowUnverifiedLanguages هنا
//    إطلاقًا — تفعيله يهدم الـFail-Closed كله.
//
// ⚠️ Ghost أصبح مرحلة تحقق **إضافية** قبل البوابة، وليس تصريحًا بالكتابة.
//    ترتيب الحكم: Ghost (إن وُجد) ← FixVerifier (إلزامي) ← كتابة.
// ═══════════════════════════════════════════════════════

// ─── ربط بوابة التحقق الوحيدة ───────────────────────────
// [v2.1] Lazy Resolver — يبحث عن FixVerifier **وقت الاستخدام** لا وقت التحميل.
//
// كان: var _PFV = (typeof FixVerifier !== 'undefined') ? FixVerifier : null;
// يُنفَّذ مرة واحدة عند تحميل الملف. فإذا حُمِّل fix_engine_pipeline.js قبل
// fix_verifier.js يبقى _PFV = null إلى الأبد، ويصير كل إصلاح مرفوضًا بـ
// REJECTED_VERIFIER_UNAVAILABLE. النتيجة تعطّل صامت: المحرك لا يصلح شيئًا
// ولا يظهر خطأ — يبدو كأنه "لم يجد مشاكل". أُثبت ذلك بالتشغيل.
//
// الآن البحث يتكرر عند كل استدعاء، فوصول الـVerifier متأخرًا يُلتقط.
// التخزين المؤقت يحدث بعد أول نجاح فقط — لا يُخزَّن الفشل إطلاقًا.
var _PFV = null;

function _getFixVerifier() {
    if (_PFV && typeof _PFV.verifyFix === 'function') return _PFV;
    _PFV = null;

    // 1) متغير عام في نفس النطاق (ترتيب سكربتات المتصفح)
    if (typeof FixVerifier !== 'undefined' && FixVerifier
        && typeof FixVerifier.verifyFix === 'function') {
        _PFV = FixVerifier;
        return _PFV;
    }
    // 2) globalThis (window.FixVerifier أو بيئة أخرى)
    if (typeof globalThis !== 'undefined' && globalThis.FixVerifier
        && typeof globalThis.FixVerifier.verifyFix === 'function') {
        _PFV = globalThis.FixVerifier;
        return _PFV;
    }
    // 3) CommonJS
    if (typeof require === 'function') {
        try {
            const m = require('./fix_verifier.js');
            if (m && typeof m.verifyFix === 'function') { _PFV = m; return _PFV; }
        } catch (e) { /* غير متاح الآن — Fail-Closed لدى المستدعي */ }
    }
    return null;   // قد يتوفر في استدعاء لاحق
}

// ─── Syntax Guard للإصلاح المتعلَّم ─────────────────────
// يبقى كما هو: فحص إضافي رخيص خاص بـJS. ليس بديلاً عن FixVerifier،
// بل طبقة مبكرة تمنع إهدار دورة تحقق كاملة على كود مكسور بوضوح.
function learnedSyntaxOk(fileName, beforeCode, afterCode) {
    if (!/\.(js|mjs|cjs)$/i.test(fileName || '')) return true;
    if (typeof acorn === 'undefined' || typeof acorn.parse !== 'function') return true;

    const parses = src => {
        for (const sourceType of ['module', 'script']) {
            try { acorn.parse(src, { ecmaVersion: 'latest', sourceType }); return true; }
            catch(e) {}
        }
        return false;
    };

    if (!parses(beforeCode)) return true;   // الأصل غير قابل للتحليل ⇒ لا حكم
    return parses(afterCode);
}

// ─── البوابة: نقطة الكتابة الوحيدة على F ────────────────
/**
 * مزامنة R لملف واحد دون أن يُسقط فشلُ التحليل العمليةَ كلها.
 * عند الفشل نُبقي issues السابقة (إن وُجدت) ونسجّل تحذيرًا، بدل الانهيار
 * أو ادّعاء "صفر مشاكل".
 */
function _safeSync(code, fn, prevEntry, report) {
    try {
        if (typeof analyzeCode !== 'function') {
            report.warnings.push({ file: fn, reason: 'ANALYZER_UNAVAILABLE_ON_SYNC' });
            return { code, issues: (prevEntry && prevEntry.issues) || [], staleIssues: true };
        }
        return { code, issues: analyzeCode(code, fn) };
    } catch (e) {
        report.warnings.push({ file: fn, reason: 'ANALYZER_THREW_ON_SYNC: ' + (e && e.message) });
        return { code, issues: (prevEntry && prevEntry.issues) || [], staleIssues: true };
    }
}

/**
 * يحاول اعتماد تعديل مقترح على ملف واحد. **لا يكتب إلا بعد قبول البوابة.**
 *
 * @param {Object} F,R      الخرائط الحقيقية
 * @param {string} fn       اسم الملف
 * @param {string} candidate الكود المقترح
 * @param {string} source   اسم المحرك المقترِح (للتقرير)
 * @param {Object} report   تجميع النتائج
 * @param {number} claimedCount عدد الإصلاحات التي يدّعيها المحرك
 * @returns {boolean} هل قُبل التعديل وكُتب فعلاً
 */
function _gateAndCommit(F, R, fn, candidate, source, report, claimedCount) {
    const before = F[fn];

    if (typeof candidate !== 'string' || candidate === before) return false;

    // Fail-Closed: بلا بوابة لا نكتب شيئًا إطلاقًا
    const _fv = _getFixVerifier();
    if (!_fv) {
        report.rejected.push({
            file: fn, source,
            reason: 'REJECTED_VERIFIER_UNAVAILABLE — fix_verifier.js غير محمّل'
        });
        return false;
    }

    const analyzer = (typeof analyzeCode === 'function') ? analyzeCode : null;
    // ملاحظة: لا نمرر allowUnverifiedLanguages إطلاقًا ⇒ HTML وأي لغة بلا
    // فاحص تُرفض افتراضيًا. هذا مقصود.
    console.log('[DEBUG FIX GATE]', {
        file: fn,
        source,
        hasAnalyzer: typeof analyzer === 'function',
        hasVerifier: !!_fv,
        candidateChanged: candidate !== before
    });
    const v = _fv.verifyFix(before, candidate, fn, analyzer, {});

    if (!v.accepted) {
        report.rejected.push({ file: fn, source, reason: v.reason, syntaxStatus: v.syntaxStatus });
        return false;
    }

    F[fn] = candidate;
    R[fn] = { code: candidate, issues: v.afterIssues };
    report.accepted.push({
        file: fn, source,
        removedIssues: v.removedCount,
        claimedCount: claimedCount != null ? claimedCount : null,
        syntaxStatus: v.syntaxStatus,
        reason: v.reason
    });
    // العدّاد يزيد بما أزالته البوابة فعليًا، لا بما ادّعاه المحرك
    report.totalFixed += (v.removedCount || 0);
    return true;
}

// ═══ [P2] نسبة نتيجة الإصلاح المتعلَّم إلى أنماطه ═══════════════════════
// أربعة أحكام، ولا واحد منها يغيّر عدّادات الأنماط في هذه المرحلة:
//   PASS          قُبل التعديل، وهذا النمط أسهم فيه
//   FAIL          رُفض، وعُزل هذا النمط بعينه مسؤولًا
//   INCONCLUSIVE  رُفض ولم يُعزل مسؤول — أو سبب الرفض خارج النمط
//   SKIPPED       لا تعديل أصلاً فلا حكم
// القيد: لا verify() ولا مسّ لـverified/failures/confidence/approved.
const LEARNED_OUTCOME = {
    PASS: 'PASS', FAIL: 'FAIL', INCONCLUSIVE: 'INCONCLUSIVE', SKIPPED: 'SKIPPED'
};

// حدّ محاولات التنصيف. ما لم يُحسم داخله يبقى INCONCLUSIVE — لا يُخمَّن مسؤول.
const BISECT_MAX_ATTEMPTS = 8;

// [P3] أي رفض يُعدّ ضرراً من النمط نفسه، وأيّه لا؟ الفرق ليس تجميلياً:
// الأول يستحق تسجيل فشل على النمط (وثلاثةٌ منه تحظره)، والثاني لا.
//
//   ضارّ      — التعديل أسوأ من الأصل أو مكسور أو يدّعي إصلاحاً لا يثبته.
//   غير ضارّ  — «بلا تحسّن مقيس»: التعديل سليم ولم يُقِس المحلل تحسناً.
//               وقد يكون السبب عمى في المحلل لا عيباً في النمط (مقيس على
//               الاستيراد المُستعار: hashlib as hl ⇒ hl.sha256، تحقّق منه
//               مفسّر Python فعلاً ورفضه Ghost بـno_improvement).
//   بيئي      — لا بوابة، لا فاحص نحوي للغة، لا محلل، أو تحليل متعذّر.
//               هذه أحكام على البيئة لا على النمط، فتسجيلها فشلاً يحظر
//               خبرة سليمة لأن ملفاً نُشر بلا فاحص لغته.
//   مجهول     — يُعدّ غير ضارّ. فشلٌ مبنيّ على سبب لا نعرفه تخمين.
//
// ⚠️ والقاعدة بالبناء: الضرر يحتاج إثباتاً صريحاً، والافتراضُ عدمُ العقوبة.
// (كانت الصيغة الأولى تعدّ «كل ما تبقّى» رفضَ بوابةٍ ضارًّا، وهو خطأ مقيس
//  على ستة أسباب منشورة من البوابة نفسها — منها REJECTED_NO_IMPROVEMENT
//  وREJECTED_VERIFIER_UNAVAILABLE وREJECTED_NO_SYNTAX_CHECKER — فكانت
//  تعاقب النمط على «لا تحسّن» وعلى غياب أدوات التحقق.)
const HARMFUL_GHOST_REASONS = new Set([
    'structural_invalid', 'syntax_broken', 'analysis_failed', 'verification_unavailable',
]);
const BENIGN_GHOST_REASONS = new Set(['no_change', 'no_improvement']);

// أسباب بوابة FixVerifier التي تُعدّ دليل ضرر. المطابقة ببادئة النص لأن
// البوابة تُلحق بالسبب تفصيلاً (اللغة، العدد، أسماء الفحوص).
const HARMFUL_GATE_PREFIXES = [
    'REJECTED_EMPTY_OUTPUT',            // الناتج فارغ
    'REJECTED_QUICKCHECK',              // فحوص بنيوية سريعة سقطت
    'REJECTED_SYNTAX_BROKEN',           // الفاحص متاح وحكم بالكسر
    'REJECTED_ISSUES_WORSENED',         // أضاف بلاغات
    'REJECTED_SQL_NOT_PARAMETERIZED',   // ادّعى إصلاح SQL ولا يثبته
    'REJECTED_PY_UNREACHABLE_CODE',     // أدخل نصًّا ميتًا
];
// ملاحظة على REJECTED_ANALYZER_THREW: البوابة تحلّل الأصل والمرشّح في نفس
// المحاولة، فالسبب لا يميّز أيّهما أسقط المحلل. عقوبةٌ على انهيارٍ قد يكون
// من الأصل تخمين، فيبقى غير ضارّ — ويبقى الرفض قائماً فلا يُكتب شيء.

function _isHarmfulRejection(rejectReason, ghostReason) {
    if (!rejectReason) return false;
    if (rejectReason === 'LEARNED_SYNTAX_BROKEN') return true;
    if (rejectReason === 'GHOST_' + 'regression') return true;
    if (rejectReason === 'GHOST_fail') {
        if (BENIGN_GHOST_REASONS.has(ghostReason)) return false;
        if (HARMFUL_GHOST_REASONS.has(ghostReason)) return true;
        return false;                       // سبب مجهول ⇒ لا عقوبة
    }
    const r = String(rejectReason);
    return HARMFUL_GATE_PREFIXES.some(p => r.indexOf(p) === 0);
}

// منع التعلّم الدائري: لا يُتعلَّم من تعديل مصدره applyLearned، وإلا عزّز
// المحرك أنماطه بأدلة من نفسه. الشرط مكتوب صراحةً هنا حتى لا يسقط بصمت لو
// نُقل موضع learn() إلى البوابة لاحقًا.
const LEARN_EXCLUDED_SOURCES = ['applyLearned'];
function _learnableSource(source) {
    const s = String(source || '');
    return !LEARN_EXCLUDED_SOURCES.some(ex => s.indexOf(ex) !== -1);
}

/**
 * تقييم جاف لمرشّح متعلَّم: نفس الفحوص الثلاثة التي يعبرها المسار الحقيقي
 * (Ghost ثم نحوي ثم FixVerifier)، وبلا أي كتابة على F أو R.
 */
function _dryCheckLearned(beforeCode, candidate, fn) {
    if (typeof candidate !== 'string' || candidate === beforeCode) {
        return { ok: true, reason: 'NO_CHANGE' };
    }
    if (typeof GhostMode !== 'undefined') {
        const lv = GhostMode.verdict(beforeCode, candidate, fn, analyzeCode);
        if (lv.verdict === GhostMode.VERDICT.FAIL || lv.verdict === GhostMode.VERDICT.REGRESSION) {
            return { ok: false, reason: 'GHOST_' + lv.verdict };
        }
    }
    if (!learnedSyntaxOk(fn, beforeCode, candidate)) {
        return { ok: false, reason: 'LEARNED_SYNTAX_BROKEN' };
    }
    const _fv = _getFixVerifier();
    if (!_fv) return { ok: false, reason: 'REJECTED_VERIFIER_UNAVAILABLE' };
    const analyzer = (typeof analyzeCode === 'function') ? analyzeCode : null;
    const v = _fv.verifyFix(beforeCode, candidate, fn, analyzer, {});
    return { ok: !!v.accepted, reason: v.reason };
}

/**
 * تنصيف: يعزل أصغر مجموعة أنماط ترفضها البوابة. كل تقييم جاف محاولة واحدة،
 * والحدّ BISECT_MAX_ATTEMPTS. culprits فارغة ⇒ لم يُحسم مسؤول، فالجميع
 * INCONCLUSIVE. ولا تُخمَّن مسؤولية: كل نصف مقبول وحده ⇒ الرفض من التجميع.
 */
function _bisectLearned(beforeCode, fn, ids) {
    let attempts = 0;
    const evalSet = set => {
        attempts++;
        const r = LearningEngine.applyLearned(beforeCode, fn, { onlyIds: set });
        if (!r.applied || r.fixed === beforeCode) return { ok: true, reason: 'NO_CHANGE' };
        return _dryCheckLearned(beforeCode, r.fixed, fn);
    };
    const search = set => {
        if (attempts >= BISECT_MAX_ATTEMPTS) return null;
        if (set.length === 1) return evalSet(set).ok ? [] : set.slice();
        const mid = Math.floor(set.length / 2);
        const left = set.slice(0, mid), right = set.slice(mid);
        if (!evalSet(left).ok) return search(left);
        if (attempts >= BISECT_MAX_ATTEMPTS) return null;
        if (!evalSet(right).ok) return search(right);
        return [];
    };
    const culprits = search(ids.slice());
    return {
        culprits: culprits || [],
        attempts,
        exhausted: culprits === null || attempts >= BISECT_MAX_ATTEMPTS
    };
}

/** يسجّل حكمًا واحدًا لكل نمط مُسهم. تسجيلٌ محض: لا عدّاد ولا حالة اعتماد. */
function _recordLearnedOutcomes(report, fn, uses, outcomeOf, extra) {
    if (!Array.isArray(report.learnedOutcomes)) report.learnedOutcomes = [];
    const seen = new Set();
    for (const u of uses) {
        if (seen.has(u.patternId)) continue;
        seen.add(u.patternId);
        report.learnedOutcomes.push(Object.assign({
            file: fn,
            patternId: u.patternId,
            via: u.via,
            lineIndex: u.lineIndex,
            source: 'applyLearned',
            outcome: outcomeOf(u.patternId)
        }, extra || {}));
    }
}

/**
 * يشغّل محركًا يعدّل F/R بالمرجع، على **نسخة مؤقتة**، ثم يمرر كل ملف تغيّر
 * عبر البوابة. المحرك نفسه لا يُعدَّل، ولا يلمس F الحقيقي إطلاقًا.
 */
function _runIsolatedEngine(F, R, runner, source, report) {
    const tmpF = {}, tmpR = {};
    Object.keys(F).forEach(k => { tmpF[k] = F[k]; });
    Object.keys(R).forEach(k => {
        if (!R[k]) { tmpR[k] = R[k]; return; }
        // نسخ عميق للـissues: النسخ السطحي كان يترك المصفوفة مشتركة بالمرجع،
        // فمحرك يعدّل tmpR[fn].issues بالـmutation (push/splice/sort) يلوّث
        // R الحقيقي رغم أننا "عزلناه". العناصر نفسها تُنسخ سطحيًا لأن
        // المحركات تقرأ حقولها ولا تعيد بناءها.
        const issues = Array.isArray(R[k].issues)
            ? R[k].issues.map(it => (it && typeof it === 'object' && !Array.isArray(it)) ? Object.assign({}, it) : it)
            : R[k].issues;
        tmpR[k] = { code: R[k].code, issues };
    });

    let out = null;
    try {
        out = runner(tmpF, tmpR);
    } catch (e) {
        report.rejected.push({ file: '*', source, reason: 'ENGINE_THREW: ' + (e && e.message) });
        return;
    }

    const claimed = (out && typeof out.totalFixed === 'number') ? out.totalFixed : null;

    // [P4] المحرك يُرجع مجموعًا على كل الملفات، وكان يُسجَّل كما هو في سجل
    // **كل** ملف تغيّر، فيقرأ التقرير ادّعاءً مضاعفًا. المقيس: Emergency على
    // ملفَّي py ادّعى 2، فسُجِّل claimedCount=2 لكل ملف — أي 4 ادّعاءً لمحرك
    // ادّعى 2. ولا يُخمَّن توزيع المجموع على الملفات: يُنسب العدد حين يتغيّر
    // ملف واحد فقط، وإلا null أي «غير معروف لهذا الملف». وremovedIssues من
    // البوابة يبقى الرقم الموثوق في الحالتين.
    const changedFiles = Object.keys(tmpF).filter(fn => tmpF[fn] !== F[fn]);
    const perFileClaim = (changedFiles.length === 1) ? claimed : null;

    changedFiles.forEach(fn => {
        _gateAndCommit(F, R, fn, tmpF[fn], source, report, perFileClaim);
    });
    // الملفات التي لم تتغيّر: لا شيء. والنسخة المؤقتة تُرمى بالكامل.
}

/**
 * aiNeeded النهائي لكل ملف — بعد كل المحركات (repairCode، RepairSQL، SmartRepair،
 * Fallback، Emergency) لا بعد repairCode وحده. يُعاد تحليل الكود النهائي ثم:
 * ما زال قائمًا من aiNeeded الخاص بـrepairCode + كل security finding باقية
 * (ضمان P2 نفسه عبر RealityOrchestrator.finalAiNeeded).
 * فشل إعادة التحليل ⇒ آخر issues معروفة (staleIssues) وتحذير، بلا ادّعاء نظافة.
 */
function _collectFinalAiNeeded(F, aiByFile, report) {
    const RO = (typeof RealityOrchestrator !== 'undefined') ? RealityOrchestrator : null;
    const hasFinal = RO && typeof RO.finalAiNeeded === 'function';
    if (!hasFinal) report.warnings.push({ file: '*', reason: 'FINAL_AI_NEEDED_UNAVAILABLE — RealityOrchestrator غير محمّل' });

    Object.keys(F).forEach(fn => {
        let finalIssues = null;
        try {
            if (typeof analyzeCode === 'function') finalIssues = analyzeCode(F[fn], fn);
        } catch (e) {
            report.warnings.push({ file: fn, reason: 'ANALYZER_THREW_ON_FINAL: ' + (e && e.message) });
        }
        const stale = !Array.isArray(finalIssues);
        if (stale) {
            finalIssues = (typeof R !== 'undefined' && R[fn] && Array.isArray(R[fn].issues)) ? R[fn].issues : [];
            report.warnings.push({ file: fn, reason: 'FINAL_REANALYSIS_FAILED — aiNeeded من آخر issues معروفة' });
        }
        const collected = aiByFile[fn] || [];
        // بلا الـhelper: نُبقي كل ما جُمع (محافظ) بدل فلترة تخمينية
        const entries = hasFinal ? RO.finalAiNeeded(collected, finalIssues) : collected;
        entries.forEach(e => report.aiNeeded.push(Object.assign({}, e, { file: fn, staleIssues: stale || undefined })));
    });
}

function fixAllEnginePipeline() {
    const origF = {};
    Object.keys(F).forEach(fn => { origF[fn] = F[fn]; });

    // [P2] learnedOutcomes: حكم لكل نمط أسهم في إصلاح متعلَّم — تسجيل لا حكم.
    const report = { totalFixed: 0, accepted: [], rejected: [], deferred: [], warnings: [], aiNeeded: [], learnedOutcomes: [] };
    const aiByFile = {};   // aiNeeded من repairCode لكل ملف — يُفلتر على الحالة النهائية في الآخر

    if (typeof detectDangerousTypos !== 'undefined') {
        const hasRisk = Object.values(F).some(code => detectDangerousTypos(code).length > 0);
        if (hasRisk) toast('⚠️ الكود يحتوي APIs خطرة — ستُفحص الإصلاحات قبل اعتمادها');
    }

    // [P4] الحلقة تدور على F لا على R. كانت Object.keys(R)، فملفٌ موجود في F
    // وغائب عن R — تحليلُه لم يُنتج مدخلًا، أو رمى المحلل وقت بناء R — لا يراه
    // repairCode ولا applyLearned ولا مزامنة R، بصمت وبلا تحذير. ثم تلمسه
    // محركات ما بعد الحلقة لأنها تدور على F، فيختلف مسار معالجته.
    // المقيس: ملفان متطابقان حرفيًا وأحدهما وحده في R ⇒ الأول أصلحه
    // repairCode+Ghost:pass والثاني Emergency وحده، وخَرجاهما مختلفان،
    // وwarnings فارغة. والحلقة لا تحتاج R أصلًا: issues تُحسب داخلها، و
    // _safeSync يتحمّل غياب المدخل السابق.
    Object.keys(F).forEach(fn => {
        // [P4] غياب repairCode كان يُسقط جسم الملف كله (return)، فيسقط معه
        // مسار التعلّم ومزامنة R، وهما لا يعتمدان عليه. المقيس: بلا repairCode
        // صارت الأحكام المتعلَّمة 0 ولم يُكتب الإصلاح المتعلَّم، ومعه 1 وكُتب.
        // فالشرط صار على مراحل الإصلاح وحدها: شرطُ الحلقة يمنع تكرارها بلا
        // إعادة إزاحة جسمها (تغييرٌ أقل خطرًا من إعادة لفّ ‎88‎ سطرًا).
        for (let pass = 0; typeof repairCode === 'function' && pass < 2; pass++) {
            const beforeCode = F[fn];
            let issues;
            try {
                issues = analyzeCode(beforeCode, fn);
            } catch (e) {
                report.warnings.push({ file: fn, reason: 'ANALYZER_THREW: ' + (e && e.message) });
                break; // بلا تحليل لا نقترح إصلاحًا - Fail-Closed
            }
            if (!Array.isArray(issues) || !issues.length) break;

            let result;
            const _isHTMLFile = /\.html?$/i.test(fn);
            if (_isHTMLFile && typeof HTMLRepair !== 'undefined') {
                const hr = HTMLRepair.fix(beforeCode, fn);
                result = { repaired: hr.fixed, repairs: hr.repairs || [] };
            } else {
                result = repairCode(beforeCode, issues, fn);
                if (result && Array.isArray(result.aiNeeded)) {
                    aiByFile[fn] = (aiByFile[fn] || []).concat(result.aiNeeded);
                }
                if (typeof AdvancedRepair !== 'undefined') {
                    const ar = AdvancedRepair.fix(result.repaired || beforeCode, fn);
                    if (ar.changed) {
                        result = { repaired: ar.fixed, repairs: [...(result.repairs||[]), ...ar.repairs] };
                    }
                }
            }

            if (!result || result.repaired === beforeCode) break;

            // ─── Ghost Mode: مرحلة تحقق إضافية، لا تصريح بالكتابة ───
            let candidate = result.repaired;
            let ghostVerdict = null;

            if (typeof GhostMode !== 'undefined') {
                // الملاحظات الإرشادية (sev='l') ليست هدف إصلاح — محرك الإصلاح
                // لا يعالجها أصلاً، فبقاؤها ضمن الهدف يمنع targetGone فلا يصل
                // أي ملف JS إلى PASS. كشف الارتداد يبقى على كل الشدّات.
                const targetTypes = issues.filter(i => i.sev !== 'l')
                                          .map(i => i.cAct || i.type).filter(Boolean);
                const ghostResult = GhostMode.fix(beforeCode, result.repaired, fn, analyzeCode, { targetTypes });
                candidate = ghostResult.code;
                ghostVerdict = ghostResult.verdict;

                // Ghost رفض صراحةً ⇒ لا نمرره للبوابة أصلاً، ولا نكتب شيئًا
                if (ghostVerdict === 'fail' || ghostVerdict === 'regression') {
                    report.rejected.push({
                        file: fn, source: 'Ghost/repairCode',
                        reason: 'GHOST_' + String(ghostVerdict).toUpperCase()
                    });
                    break;
                }
            }

            // ─── البوابة الإلزامية: هنا فقط تحدث الكتابة ───
            const _src = 'repairCode' + (ghostVerdict ? '+Ghost:' + ghostVerdict : '');
            const committed = _gateAndCommit(
                F, R, fn, candidate, _src,
                report, (result.repairs || []).length
            );

            if (!committed) break; // رُفض ⇒ لا نبني pass تاليًا على كود غير معتمد

            // التعلّم: فقط بعد Ghost PASS **و** قبول البوابة معًا
            // [v2.1] التعلّم مشروط بقبول البوابة، لا بحكم Ghost.
            //
            // كان: if (ghostVerdict === 'pass' && …) وله عيبان مُثبتان:
            //   (أ) بلا GhostMode يبقى ghostVerdict = null، فلا يحدث تعلّم
            //       إطلاقًا رغم أن البوابة قبلت التعديل وكُتب فعلاً.
            //   (ب) بعد GhostMode v2.2 لم تعد fix() تُرجع 'partial'، فصار
            //       'pass' يعني "قبلته بوابة Ghost الداخلية" لا "إصلاح مكتمل"
            //       — أي أن الشرط يقيس شيئًا غير الذي يبدو أنه يقيسه.
            //
            // الوصول إلى هنا يعني committed === true بالضرورة (بسبب
            // `if (!committed) break;` أعلاه)، أي أن FixVerifier قبل التعديل
            // وكُتب فعلاً. Ghost يبقى مرحلة تحقق سابقة لا تمنح قبولاً.
            // ⚠️ رفض FixVerifier ⇒ لا learn() ولا verify() — الكود لا يصل هنا.
            // [P2] ومصدر التعديل يجب أن يكون قابلاً للتعلّم: لا تعلّم دائري من
            // applyLearned. الشرط لا يغيّر شيئًا اليوم (المصدر هنا repairCode)،
            // لكنه يمنع الدائرية بالبناء لو نُقل التعلّم إلى البوابة لاحقًا.
            if (typeof LearningEngine !== 'undefined' && _learnableSource(_src)) {
                // F[fn] هنا هو الكود المعتمد من البوابة حصرًا
                const patternIds = LearningEngine.learn(beforeCode, F[fn], issues, fn);
                if (Array.isArray(patternIds) && patternIds.length > 0) {
                    patternIds.forEach(id => LearningEngine.verify(id, true));
                }
            }
        }

        // ─── applyLearned: Ghost ثم فحص نحوي ثم البوابة ───
        if (typeof LearningEngine !== 'undefined') {
            const beforeLearned = F[fn];
            const lr = LearningEngine.applyLearned(beforeLearned, fn);
            const uses = Array.isArray(lr.uses) ? lr.uses : [];
            const changed = lr.applied > 0 && lr.fixed !== beforeLearned;

            if (!changed) {
                // [P2] لا تعديل ⇒ لا حكم على أي نمط.
                if (uses.length) {
                    _recordLearnedOutcomes(report, fn, uses, () => LEARNED_OUTCOME.SKIPPED);
                }
            } else {
                let rejectReason = null;
                // سبب Ghost الفرعي يُحفظ منفصلاً عن reason المنشور، لأن
                // التمييز بين «ضارّ» و«بلا تحسّن» يحتاجه — ولا يُغيَّر نصّ
                // reason حتى لا يتغيّر عقدٌ تعتمده اختبارات قائمة.
                let ghostReason = null;

                if (typeof GhostMode !== 'undefined') {
                    const lv = GhostMode.verdict(beforeLearned, lr.fixed, fn, analyzeCode);
                    if (lv.verdict === GhostMode.VERDICT.FAIL ||
                        lv.verdict === GhostMode.VERDICT.REGRESSION) {
                        rejectReason = 'GHOST_' + lv.verdict;
                        ghostReason = lv.reason || null;
                        report.rejected.push({ file: fn, source: 'applyLearned', reason: rejectReason });
                    }
                }

                if (!rejectReason && !learnedSyntaxOk(fn, beforeLearned, lr.fixed)) {
                    rejectReason = 'LEARNED_SYNTAX_BROKEN';
                    report.rejected.push({ file: fn, source: 'applyLearned', reason: rejectReason });
                }

                let committed = false;
                if (!rejectReason) {
                    committed = _gateAndCommit(F, R, fn, lr.fixed, 'applyLearned', report, lr.applied);
                    if (!committed) {
                        const last = report.rejected[report.rejected.length - 1];
                        rejectReason = (last && last.reason) || 'GATE_REJECTED';
                    }
                }

                if (committed) {
                    // [P2] الدفتر بعد قرار البوابة حصرًا، ولا عدّاد يُلمَس.
                    if (typeof LearningEngine.markUsed === 'function') {
                        LearningEngine.markUsed(uses.map(u => u.patternId));
                    }
                    _recordLearnedOutcomes(report, fn, uses, () => LEARNED_OUTCOME.PASS);
                } else {
                    // [P2] رُفض: مُسهم واحد ⇒ مسؤول بالضرورة. أكثر من واحد ⇒
                    // تنصيف لعزل المسؤول، وما لم يُحسم يبقى INCONCLUSIVE.
                    const ids = Array.from(new Set(uses.map(u => u.patternId)));
                    let culprits = [];
                    let bis = null;
                    if (ids.length === 1) {
                        culprits = ids.slice();
                    } else if (ids.length > 1) {
                        bis = _bisectLearned(beforeLearned, fn, ids);
                        culprits = bis.culprits;
                    }
                    const cul = new Set(culprits);
                    const harmful = _isHarmfulRejection(rejectReason, ghostReason);
                    _recordLearnedOutcomes(report, fn, uses,
                        id => (cul.has(id) ? LEARNED_OUTCOME.FAIL : LEARNED_OUTCOME.INCONCLUSIVE),
                        {
                            gateReason: rejectReason,
                            ghostReason: ghostReason,
                            harmful: harmful,
                            bisectAttempts: bis ? bis.attempts : 0,
                            bisectExhausted: bis ? bis.exhausted : false
                        });

                    // ─── [P3] إغلاق حلقة التغذية الراجعة ───
                    // كان الحكم يُسجَّل في التقرير ويُفقد بنهاية التشغيل: لا
                    // شيء في الإنتاج ينادي verify(id, false)، فحقل failures
                    // يبقى صفرًا دائمًا، وفرع الفشل في verify والحظر عند
                    // failures ≥ 3 وsuccessRate في calcConfidence كلها كود
                    // غير قابل للوصول. فالمحرك يكرّر النمط المرفوض بلا حدّ.
                    //
                    // ويُسجَّل الفشل على المسؤول المعزول بالتنصيف حصراً، ولا
                    // يُسجَّل على INCONCLUSIVE — فالتخمين أسوأ من الصمت.
                    //
                    // ⚠️ والأهم: لا يُسجَّل إلا على الرفض **الضارّ**.
                    // المقيس: قالب صحيح (hashlib as hl ⇒ sha256، تحقّق منه
                    // مفسّر Python فعلاً) يرفضه Ghost بسبب no_improvement
                    // لأن المحلل لا يرى الاستيراد المُستعار أصلاً. فتسجيل
                    // ذلك فشلاً يعاقب خبرة صحيحة ويسير بها نحو الحظر.
                    // «بلا تحسّن مقيس» ليس «ضرراً»، والتمييز بينهما شرط
                    // لأن تكون الحلقة إصلاحاً لا عقوبة عشوائية.
                    if (harmful && culprits.length &&
                        typeof LearningEngine.verify === 'function') {
                        culprits.forEach(id => LearningEngine.verify(id, false));
                    }
                }
                // مرفوض ⇒ F[fn] لم يُمَس أصلاً (لا كتابة إلا داخل البوابة)
            }
        }

        // مزامنة R مع الحالة النهائية المعتمدة.
        // محاطة بـtry: إذا رمى analyzeCode هنا كان ينهار fixAllEngine بالكامل
        // بعد انتهاء الإصلاحات فعليًا، فيضيع التقرير ولا يُعرض شيء للمستخدم.
        // الكود في F مُعتمَد أصلًا من البوابة، فالفشل هنا فشل تحليل لا فشل إصلاح.
        R[fn] = _safeSync(F[fn], fn, R[fn], report);
    });

    // ─── RepairSQL: عبر البوابة، لا كتابة مباشرة ───
    if (typeof RepairSQL !== 'undefined') {
        Object.keys(F).forEach(fn => {
            const r = RepairSQL.fix(F[fn], fn);
            if (r && r.count > 0 && r.code !== F[fn]) {
                _gateAndCommit(F, R, fn, r.code, 'RepairSQL', report, r.count);
            }
        });
    }

    // ─── محركات تعدّل F/R بالمرجع: تُشغَّل معزولة ثم تمر بالبوابة ───
    if (typeof SmartRepairEngine !== 'undefined') {
        _runIsolatedEngine(F, R,
            (tF, tR) => SmartRepairEngine.applySmartRepair(tF, tR), 'SmartRepair', report);
    }

    if (typeof applyFallbackToAll === 'function') {
        _runIsolatedEngine(F, R,
            (tF, tR) => applyFallbackToAll(tF, tR), 'Fallback', report);
    }

    if (typeof applyEmergencyToAll === 'function') {
        _runIsolatedEngine(F, R,
            (tF, tR) => applyEmergencyToAll(tF, tR), 'Emergency', report);
    }

    // ─── aiNeeded النهائي ───
    _collectFinalAiNeeded(F, aiByFile, report);

    // ─── التقرير ───
    // totalFixed يعكس ما أزالته البوابة فعليًا، لا ما ادّعته المحركات.
    const rejectedCount = report.rejected.length;
    let msg = '✅ تم إصلاح ' + report.totalFixed + ' مشكلة';
    if (rejectedCount > 0) {
      const firstReject = report.rejected[0] || {};
      msg += ' • ' + rejectedCount + ' تعديل مرفوض: ' + (firstReject.reason || 'UNKNOWN');
    }
    if (report.aiNeeded.length > 0) msg += ' • ' + report.aiNeeded.length + ' تحتاج AI';
    toast(msg);

    if (typeof globalThis !== 'undefined') globalThis.lastPipelineReport = report;

    refreshStats();
    document.getElementById('btn-dl').style.display = 'inline-block';

    return report;
}

if (typeof fixAllEngine === 'undefined' && typeof globalThis !== 'undefined') {
    globalThis.fixAllEngine = fixAllEnginePipeline;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        fixAllEnginePipeline, fixAllEngine: fixAllEnginePipeline, learnedSyntaxOk,
        _gateAndCommit, _runIsolatedEngine,
        // [P2] مُصدَّرة للاختبار: النسبة والتنصيف وحرس الدائرية
        LEARNED_OUTCOME, BISECT_MAX_ATTEMPTS, LEARN_EXCLUDED_SOURCES,
        _learnableSource, _dryCheckLearned, _bisectLearned, _recordLearnedOutcomes
    };
}


