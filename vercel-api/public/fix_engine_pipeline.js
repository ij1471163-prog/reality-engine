// fix_engine_pipeline.js
// Ghost + Learning pipeline منفصل عن index.html

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
            const issues = analyzeCode(F[fn], fn);
            if (!issues.length) break;

            let result;
            const isHTML = /\.html?$/i.test(fn);

            if (isHTML && typeof HTMLRepair !== 'undefined') {
                const hr = HTMLRepair.fix(F[fn], fn);
                result = { repaired: hr.fixed, repairs: hr.repairs || [] };
            } else {
                result = repairCode(F[fn], issues, fn);
                if (typeof AdvancedRepair !== 'undefined') {
                    const ar = AdvancedRepair.fix(result.repaired || F[fn], fn);
                    if (ar.changed) {
                        result = { repaired: ar.fixed, repairs: [...(result.repairs||[]), ...ar.repairs] };
                    }
                }
            }

            if (!result || result.repaired === F[fn]) break;

            // Ghost Mode
            let finalCode = result.repaired;
            if (typeof GhostMode !== 'undefined') {
                const origIssues = analyzeCode(origF[fn] || F[fn], fn);
                const targetTypes = origIssues.map(i => i.cAct || i.type).filter(Boolean);
                const ghostResult = GhostMode.fix(F[fn], result.repaired, fn, analyzeCode, { targetTypes });
                finalCode = ghostResult.code;

                // verify — PASS أو PARTIAL = نجاح نسبي
                const afterCritical = analyzeCode(finalCode, fn).filter(i=>i.sev==='c'||i.sev==='h').length;
                const isLastPass = afterCritical === 0 || pass === 1;

                if (isLastPass && typeof LearningEngine !== 'undefined') {
                    const ghostSuccess = ghostResult.verdict === 'pass' || ghostResult.verdict === 'partial';
                    LearningEngine.getStats().patterns
                        .filter(p => !p.approved && p.before && (origF[fn]||'').includes(p.before))
                        .forEach(p => LearningEngine.verify(p.id, ghostSuccess));
                }
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
        if (sr.totalFixed > 0) totalFixed += sr.totalFixed;
    }

    // Fallback
    if (typeof applyFallbackToAll === 'function') {
        const fb = applyFallbackToAll(F, R);
        if (fb.totalFixed > 0) totalFixed += fb.totalFixed;
    }

    // Specialized Fixers
    if (typeof applySpecializedFixers === 'function') {
        const sf = applySpecializedFixers(F, R);
        if (sf.totalFixed > 0) totalFixed += sf.totalFixed;
    }

    // Emergency
    if (typeof applyEmergencyToAll === 'function') {
        const em = applyEmergencyToAll(F, R);
        if (em.totalFixed > 0) totalFixed += em.totalFixed;
    }

    // Learning
    if (typeof LearningEngine !== 'undefined') {
        Object.keys(F).forEach(fn => {
            const orig = origF[fn] || F[fn];
            if (orig !== F[fn]) {
                const origIssues = analyzeCode(orig, fn);
                LearningEngine.learn(orig, F[fn], origIssues, fn);
            }
            if ((R[fn]?.issues||[]).length === 0) {
                LearningEngine.learnSafe(F[fn], fn);
            }
        });
    }

    toast('✅ تم إصلاح ' + totalFixed + ' مشكلة');
    refreshStats();
    document.getElementById('btn-dl').style.display = 'inline-block';
}
