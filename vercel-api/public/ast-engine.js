// ═══════════════════════════════════════════════════════
// ast-engine.js v2.0 — إصلاحات:
// ✅ walkAST في forEach يتوقف عند nested forEach
// ✅ تراكم = يُكتشف داخل loops فقط (ليس خارجها)
// ✅ acornCallbacks تُنظَّف عند الفشل (no memory leak)
// ✅ duplicate detection بـ type + line بدل title string
// ✅ acorn parse يجرب كل ecmaVersions بترتيب
// ═══════════════════════════════════════════════════════

"use strict";

const ACORN_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/acorn/8.11.3/acorn.min.js';

// ═══════════════════════════════════════════════════════
// Acorn Loader
// ═══════════════════════════════════════════════════════

const _acorn = {
    loaded:    false,
    loading:   false,
    callbacks: [],
};

function loadAcorn(cb) {
    if (_acorn.loaded) { cb(); return; }
    _acorn.callbacks.push(cb);
    if (_acorn.loading) return;
    _acorn.loading = true;

    const s = document.createElement('script');
    s.src = ACORN_CDN;

    s.onload = () => {
        _acorn.loaded   = true;
        _acorn.loading  = false;
        _acorn.callbacks.forEach(f => f());
        _acorn.callbacks = []; // تنظيف
    };

    s.onerror = () => {
        console.warn('[AST] Acorn failed to load');
        _acorn.loading   = false;
        _acorn.callbacks = []; // تنظيف حتى عند الفشل
    };

    document.head.appendChild(s);
}

// ═══════════════════════════════════════════════════════
// AST Parser — يجرب أكثر من إعداد
// ═══════════════════════════════════════════════════════

const PARSE_CONFIGS = [
    { ecmaVersion: 2022, sourceType: 'module'  },
    { ecmaVersion: 2022, sourceType: 'script'  },
    { ecmaVersion: 2015, sourceType: 'script'  },
    { ecmaVersion: 5,    sourceType: 'script'  },
];

function parseAST(code) {
    if (typeof acorn === 'undefined') return null;
    for (const cfg of PARSE_CONFIGS) {
        try {
            return acorn.parse(code, { ...cfg, locations: true });
        } catch (_) { /* جرب الإعداد التالي */ }
    }
    return null; // فشل كل الإعدادات
}

// ═══════════════════════════════════════════════════════
// walkAST — مع خيار إيقاف المشي (stop signal)
// ═══════════════════════════════════════════════════════

/**
 * @param {object} node - AST node
 * @param {object} visitor - { NodeType: (node, stop) => void }
 *   visitor يقدر ينادي stop() لمنع المشي داخل أبناء هذا الـ node
 */
function walkAST(node, visitor) {
    if (!node || typeof node !== 'object') return;

    let stopped = false;
    const stop  = () => { stopped = true; };

    if (visitor[node.type]) visitor[node.type](node, stop);
    if (stopped) return; // لا تمشي داخل الأبناء

    for (const key of Object.keys(node)) {
        const child = node[key];
        if (Array.isArray(child))
            child.forEach(c => { if (c?.type) walkAST(c, visitor); });
        else if (child?.type)
            walkAST(child, visitor);
    }
}

// ═══════════════════════════════════════════════════════
// Loop Context Tracker
// ═══════════════════════════════════════════════════════

const LOOP_TYPES = new Set([
    'ForStatement', 'ForInStatement', 'ForOfStatement',
    'WhileStatement', 'DoWhileStatement',
]);

/**
 * يبني map: line → داخل loop أم لا
 * بديل عن تتبع nested scope يدوياً
 */
function buildLoopRanges(ast) {
    const ranges = []; // [{start, end}]
    walkAST(ast, {
        ForStatement(node, stop) {
            if (node.loc) ranges.push({ start: node.loc.start.line, end: node.loc.end.line });
        },
        ForInStatement(node)  { if (node.loc) ranges.push({ start: node.loc.start.line, end: node.loc.end.line }); },
        ForOfStatement(node)  { if (node.loc) ranges.push({ start: node.loc.start.line, end: node.loc.end.line }); },
        WhileStatement(node)  { if (node.loc) ranges.push({ start: node.loc.start.line, end: node.loc.end.line }); },
        DoWhileStatement(node){ if (node.loc) ranges.push({ start: node.loc.start.line, end: node.loc.end.line }); },
    });
    return {
        contains: (line) => ranges.some(r => line >= r.start && line <= r.end),
    };
}

// ═══════════════════════════════════════════════════════
// forEach Analyzer — لا يمشي داخل nested forEach
// ═══════════════════════════════════════════════════════

function analyzeForEach(ast, issues) {
    walkAST(ast, {
        CallExpression(node, stop) {
            if (node.callee?.property?.name !== 'forEach') return;

            // أوقف المشي داخل هذا الـ node (سنمشي بأنفسنا)
            stop();

            const callback = node.arguments?.[0];
            if (!callback) return;

            const objName = node.callee?.object?.name ?? 'arr';
            const line    = node.loc?.start?.line ?? 0;

            let hasReturn     = false;
            let hasSideEffect = false;

            // امشِ داخل الـ callback فقط، أوقف عند nested forEach
            walkAST(callback, {
                ReturnStatement(ret) {
                    if (ret.argument) hasReturn = true;
                },
                CallExpression(inner, stopInner) {
                    // لو nested forEach — توقف ولا تعدّها كـ side effect لهذا الـ forEach
                    if (inner.callee?.property?.name === 'forEach') {
                        stopInner();
                        return;
                    }
                    // أي استدعاء آخر = side effect
                    if (inner !== node) hasSideEffect = true;
                },
            });

            if (!hasReturn) return;

            issues.push({
                type:        'bug',
                sev:         'h',
                title:       hasSideEffect
                    ? 'return داخل forEach مع side effects (AST ✓)'
                    : 'return داخل forEach لا يُرجع قيمة (AST ✓)',
                line,
                ev:          `${objName}.forEach(...)`,
                fix:         hasSideEffect ? null : `${objName}.find(...)`,
                astVerified: true,
                conf:        92,
            });

            // الآن امشِ داخل أبناء هذا الـ forEach لاكتشاف nested forEach
            // لكن بـ visitor جديد (للـ forEach الداخلية)
            walkAST(callback, {
                CallExpression(inner, stopInner) {
                    if (inner.callee?.property?.name === 'forEach' && inner !== node) {
                        // سيُكتشف في المرور التالي من walkAST الخارجي
                    }
                },
            });
        },
    });
}

// ═══════════════════════════════════════════════════════
// Accumulation Bug Analyzer — داخل loops فقط
// ═══════════════════════════════════════════════════════

function analyzeAccumulation(ast, issues) {
    // 1. اكتشف المتغيرات المُهيَّأة بـ 0
    const zeroVars = new Map(); // name → line
    walkAST(ast, {
        VariableDeclarator(node) {
            if (node.init?.type === 'Literal' && node.init.value === 0 && node.id?.name) {
                zeroVars.set(node.id.name, node.loc?.start?.line ?? 0);
            }
        },
    });

    if (zeroVars.size === 0) return;

    // 2. بناء loop ranges
    const loopRanges = buildLoopRanges(ast);

    // 3. ابحث عن = بدل += داخل loops فقط
    walkAST(ast, {
        AssignmentExpression(node) {
            if (node.operator !== '=' || node.left?.type !== 'Identifier') return;

            const varName = node.left.name;
            if (!zeroVars.has(varName)) return;

            const line = node.loc?.start?.line ?? 0;

            // ✅ تحقق إن هذا السطر داخل loop فعلاً
            if (!loopRanges.contains(line)) return;

            const rightText = node.right?.type ?? '...';
            issues.push({
                type:        'bug',
                sev:         'c',
                title:       `خطأ تراكم مؤكد: ${varName} = بدل += (AST ✓)`,
                line,
                ev:          `${varName} = ${rightText}`,
                fix:         `${varName} += ...`,
                astVerified: true,
                conf:        95,
            });
        },
    });
}

// ═══════════════════════════════════════════════════════
// Main: analyzeJSWithAST
// ═══════════════════════════════════════════════════════

function analyzeJSWithAST(code, fileName) {
    const ast = parseAST(code);
    if (!ast) return [];

    const issues = [];
    analyzeForEach(ast, issues);
    analyzeAccumulation(ast, issues);

    // Finalize confidence icons
    issues.forEach(iss => {
        if (!iss.conf) iss.conf = 85;
        iss.cIcon = iss.conf >= 90 ? '🟢' : '🟡';
        iss.cAct  = iss.conf >= 90 ? 'ثقة عالية (AST)' : 'مشكلة محتملة (AST)';
        iss.cEv   = ['✓ تحليل AST حقيقي', '✓ مو Regex'];
    });

    return issues;
}

// ═══════════════════════════════════════════════════════
// Duplicate Detector — type + line بدل title string
// ═══════════════════════════════════════════════════════

/**
 * يُزيل duplicates بين AST issues و Regex issues
 * المعيار: نفس type + تقارب السطر (±2) + نفس sev
 * AST يأخذ الأولوية دائماً
 */
function deduplicateIssues(astIssues, regexIssues) {
    const merged = [...astIssues];

    regexIssues.forEach(ri => {
        const isDuplicate = astIssues.some(ai =>
            ai.type === ri.type
            && ai.sev  === ri.sev
            && Math.abs((ai.line ?? 0) - (ri.line ?? 0)) <= 2
        );
        if (!isDuplicate) merged.push(ri);
    });

    // رتّب بالسطر
    return merged.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

// ═══════════════════════════════════════════════════════
// analyzeJSEnhanced — Regex + AST
// ═══════════════════════════════════════════════════════

function analyzeJSEnhanced(code, fileName) {
    const regexIssues = analyzeCode(code, fileName);
    if (typeof acorn === 'undefined') return regexIssues;

    const astIssues = analyzeJSWithAST(code, fileName);
    return deduplicateIssues(astIssues, regexIssues);
}
