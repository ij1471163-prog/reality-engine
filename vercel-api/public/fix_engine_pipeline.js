// fix_engine_pipeline.js — Ghost + Learning Pipeline
// © 2025 Naif Lucena — Reality Engine
// التدفق: Ghost PASS فقط → learn() → verify(patternId, true)

function fixAllEngine() {
    const origF = {};
    Object.keys(F).forEach(fn => { origF[fn] = F[fn]; });

    if (typeof detectDangerousTypos !== 'undefined') {
        const hasRisk = Object.values(F).some(code => detectDangerousTypos(code).length > 0);
        if (hasRisk) toast('⚠️ الكود يحتوي APIs خطرة — تم الإصلاح تلقائياً');
    }

    let totalFixed = 0;

    Object.keys(R).forEach(fn => {
        if (typeof repairCode !== 'function') return;

        for (let pass = 0; pass < 2; pass++) {
            const beforeCode = F[fn];
            const issues = analyzeCode(beforeCode, fn);
            if (!issues.length) break;

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

            // Ghost Mode
            let finalCode = result.repaired;
            if (typeof GhostMode !== 'undefined') {
                const targetTypes = issues.map(i => i.cAct || i.type).filter(Boolean);
                const ghostResult = GhostMode.fix(beforeCode, result.repaired, fn, analyzeCode, { targetTypes });
                finalCode = ghostResult.code;

                // PASS فقط → تعلم + verify
                if (ghostResult.verdict === 'pass' && typeof LearningEngine !== 'undefined') {
                    const patternIds = LearningEngine.learn(beforeCode, finalCode, issues, fn);
                    if (Array.isArray(patternIds) && patternIds.length > 0) {
                        patternIds.forEach(id => LearningEngine.verify(id, true));
                    }
                }
                // FAIL / REGRESSION / PARTIAL → لا تعلم، لا verify
            }

            F[fn] = finalCode;
            totalFixed += result.repairs.length;
        }

        // applyLearned
        if (typeof LearningEngine !== 'undefined') {
            const lr = LearningEngine.applyLearned(F[fn], fn);
            if (lr.applied > 0) F[fn] = lr.fixed;
        }

        R[fn] = { code: F[fn], issues: analyzeCode(F[fn], fn) };
    });

    // RepairSQL
    if (typeof RepairSQL !== 'undefined') {
        Object.keys(F).forEach(fn => {
            const r = RepairSQL.fix(F[fn], fn);
            if (r.count > 0 && r.code !== F[fn]) {
                F[fn] = r.code;
                totalFixed += r.count;
                R[fn] = { code: r.code, issues: analyzeCode(r.code, fn) };
            }
        });
    }

    // Smart Repair
    if (typeof SmartRepairEngine !== 'undefined') {
        const sr = SmartRepairEngine.applySmartRepair(F, R);
        if (sr && sr.totalFixed > 0) totalFixed += sr.totalFixed;
    }

    // Fallback
    if (typeof applyFallbackToAll === 'function') {
        const fb = applyFallbackToAll(F, R);
        if (fb && fb.totalFixed > 0) totalFixed += fb.totalFixed;
    }

    // Emergency
    if (typeof applyEmergencyToAll === 'function') {
        const em = applyEmergencyToAll(F, R);
        if (em && em.totalFixed > 0) totalFixed += em.totalFixed;
    }

    toast('✅ تم إصلاح ' + totalFixed + ' مشكلة');
    refreshStats();
    document.getElementById('btn-dl').style.display = 'inline-block';
}
