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

    Object.keys(tmpF).forEach(fn => {
        if (tmpF[fn] !== F[fn]) {
            _gateAndCommit(F, R, fn, tmpF[fn], source, report, claimed);
        }
    });
    // الملفات التي لم تتغيّر: لا شيء. والنسخة المؤقتة تُرمى بالكامل.
}

function fixAllEnginePipeline() {
    const origF = {};
    Object.keys(F).forEach(fn => { origF[fn] = F[fn]; });

    const report = { totalFixed: 0, accepted: [], rejected: [], deferred: [], warnings: [] };

    if (typeof detectDangerousTypos !== 'undefined') {
        const hasRisk = Object.values(F).some(code => detectDangerousTypos(code).length > 0);
        if (hasRisk) toast('⚠️ الكود يحتوي APIs خطرة — ستُفحص الإصلاحات قبل اعتمادها');
    }

    Object.keys(R).forEach(fn => {
        if (typeof repairCode !== 'function') return;

        for (let pass = 0; pass < 2; pass++) {
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
            const committed = _gateAndCommit(
                F, R, fn, candidate, 'repairCode' + (ghostVerdict ? '+Ghost:' + ghostVerdict : ''),
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
            if (typeof LearningEngine !== 'undefined') {
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
            if (lr.applied > 0 && lr.fixed !== beforeLearned) {
                let preApproved = true;

                if (typeof GhostMode !== 'undefined') {
                    const lv = GhostMode.verdict(beforeLearned, lr.fixed, fn, analyzeCode);
                    preApproved = lv.verdict !== GhostMode.VERDICT.FAIL &&
                                  lv.verdict !== GhostMode.VERDICT.REGRESSION;
                    if (!preApproved) {
                        report.rejected.push({ file: fn, source: 'applyLearned', reason: 'GHOST_' + lv.verdict });
                    }
                }

                if (preApproved && !learnedSyntaxOk(fn, beforeLearned, lr.fixed)) {
                    preApproved = false;
                    report.rejected.push({ file: fn, source: 'applyLearned', reason: 'LEARNED_SYNTAX_BROKEN' });
                }

                if (preApproved) {
                    _gateAndCommit(F, R, fn, lr.fixed, 'applyLearned', report, lr.applied);
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

    // ─── التقرير ───
    // totalFixed يعكس ما أزالته البوابة فعليًا، لا ما ادّعته المحركات.
    const rejectedCount = report.rejected.length;
    let msg = '✅ تم إصلاح ' + report.totalFixed + ' مشكلة';
    if (rejectedCount > 0) msg += ' • ' + rejectedCount + ' تعديل مرفوض (لم يجتز التحقق)';
    toast(msg);

    if (typeof globalThis !== 'undefined') globalThis.lastPipelineReport = report;

    refreshStats();
    document.getElementById('btn-dl').style.display = 'inline-block';

    return report;
}

// الاسم العام fixAllEngine يُربط هنا فقط إذا لم تعرّفه الواجهة قبل تحميل هذا
// الملف. إعلان `function fixAllEngine()` مباشرةً كان يطغى على نسخة index.html
// (التي تمر عبر RealityOrchestrator) لأن هذا الملف يُحمَّل بعدها.
if (typeof fixAllEngine === 'undefined' && typeof globalThis !== 'undefined') {
    globalThis.fixAllEngine = fixAllEnginePipeline;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { fixAllEnginePipeline, fixAllEngine: fixAllEnginePipeline, learnedSyntaxOk, _gateAndCommit, _runIsolatedEngine };
}


