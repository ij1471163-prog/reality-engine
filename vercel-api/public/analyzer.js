// ═══════════════════════════════════════════════════════
// analyzer.js v2.0 — إصلاحات:
// ✅ operator precedence bug محلول
// ✅ orders check مكرر محذوف
// ✅ inLoop tracking دقيق بعمق بدل flag واحد
// ✅ NullPointerException check مصلح
// ✅ Regex compiled مرة واحدة (PATTERNS)
// ✅ أسماء واضحة: escapeRegex, findKey
// ✅ Score weights كـ constants
// ✅ extractKeys بدون حد ثابت
// ═══════════════════════════════════════════════════════

"use strict";

// ═══════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════

const SCORE = {
    BASE:            20,
    STUB_CONFIRMED:  20,
    CONTEXT_MATCH:   20,
    PARTIAL_CONTEXT: 10,
    SHORT_FIX:       10,
    BALANCED_PARENS: 25,
    VERIFIED:         5,
    HIGH_THRESHOLD:  90,
    MED_THRESHOLD:   60,
    MIN_CONF:        72,
};

const COLLECTION_WORDS = ['orders','items','users','products','records','entries','list'];
const DICT_WORDS       = ['order','item','user','product','record','entry'];
const RATE_WORDS       = ['rate','ratio','discount','tax','fee','percent','factor','limit'];
const ACCUM_VARS       = ['total','sum','count','revenue','result'];
const SKIP_JAVA_NAMES  = new Set(['main','toString','hashCode','equals']);
const SKIP_JAVA_OBJS   = new Set(['System','Math','String','Integer','Arrays','Collections','Objects']);

// Compiled patterns — مرة واحدة
const PATTERNS = {
    pyFuncDef:      /^def\s+\w+.*:$/,
    pyForLoop:      /^for\s+\w+\s+in\s+/,
    pyAccumAssign:  /^(total|sum|count|revenue|result)\s*=\s*[^=+\-\n]/,
    pyNoneCompare:  /[=!]=\s*None/,
    pyBareExcept:   /^except:$/,
    jsForEach:      /\.forEach\s*\(/,
    jsForLoop:      /for\s*\(/,
    jsAccum:        /\b(total|sum|count|revenue)\s*=\s*[^=+\-]/,
    jsLooseEq:      /[^=!<>]==[^=]/,
    jsBlockClose:   /^\}[\);,]?$/,
    javaEmptyMethod:/^\s*(public|private|protected|static)\s+[\w<>\[\]]+\s+\w+\s*\([^)]*\)\s*\{\s*\}/,
    javaMethodSig:  /^\s*(public|private|protected)\s+\w[\w<>\[\]]*\s+\w+\s*\(/,
    javaStringEq:   /"[^"]*"\s*==|==\s*"[^"]*"/,
    javaCatch:      /catch\s*\(/,
    javaTodo:       /\/\/\s*(TODO|FIXME|HACK|XXX)/i,
    javaUnsupported:/throw new UnsupportedOperationException/,
    dictKey:        /"(\w+)"\s*:/g,
    nestedList:     /"(\w+)"\s*:\s*\[\s*\{([^}]+)\}/g,
};

// ═══════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════

/** Escape special regex characters */
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Return first candidate found in keys array */
function findKey(keys, ...candidates) {
    return candidates.find(c => keys.includes(c)) ?? null;
}

/** Count leading spaces */
function leadingSpaces(line) {
    let n = 0;
    for (const ch of line) { if (ch === ' ') n++; else break; }
    return n;
}

/** Check if parens/brackets are balanced in a string */
function isBalanced(str) {
    const open  = (str.match(/[{[(]/g) ?? []).length;
    const close = (str.match(/[}\])]/g) ?? []).length;
    return open === close;
}

// ═══════════════════════════════════════════════════════
// Confidence Calculator
// ═══════════════════════════════════════════════════════

function calcConf(issue, code) {
    let score = SCORE.BASE;
    const ev  = ['النمط مكتشف +' + SCORE.BASE];

    // نوع المشكلة
    if (issue.type === 'stub') {
        score += SCORE.STUB_CONFIRMED;
        ev.push('pass مؤكد +' + SCORE.STUB_CONFIRMED);
    } else if (issue.title.includes('forEach') && PATTERNS.jsForEach.test(code)) {
        score += SCORE.CONTEXT_MATCH;
        ev.push('forEach موجود +' + SCORE.CONTEXT_MATCH);
    } else if (issue.title.includes('None') && PATTERNS.pyNoneCompare.test(code)) {
        score += SCORE.CONTEXT_MATCH;
        ev.push('None موجودة +' + SCORE.CONTEXT_MATCH);
    } else if (issue.title.includes('التراكم')) {
        const varName = issue.ev?.match(/^(\w+)\s*=/)?.[1];
        if (varName) {
            const zeroPattern = new RegExp('\\b' + escapeRegex(varName) + '\\s*=\\s*0\\b');
            if (zeroPattern.test(code)) {
                score += SCORE.CONTEXT_MATCH;
                ev.push('متغير مهيأ بـ 0 +' + SCORE.CONTEXT_MATCH);
            }
        } else {
            score += SCORE.PARTIAL_CONTEXT;
            ev.push('سياق جزئي +' + SCORE.PARTIAL_CONTEXT);
        }
    } else {
        score += SCORE.PARTIAL_CONTEXT;
        ev.push('سياق جزئي +' + SCORE.PARTIAL_CONTEXT);
    }

    // جودة الـ fix
    if (issue.fix && issue.fix.length < 120 && !issue.fix.startsWith('#')) {
        score += SCORE.SHORT_FIX;
        ev.push('إصلاح مباشر +' + SCORE.SHORT_FIX);
    }
    if (issue.fix && isBalanced(issue.fix)) {
        score += SCORE.BALANCED_PARENS;
        ev.push('أقواس متوازنة +' + SCORE.BALANCED_PARENS);
    }
    if (issue.verified) {
        score += SCORE.VERIFIED;
        ev.push('تم التحقق +' + SCORE.VERIFIED);
    }

    score = Math.min(100, score);
    const icon   = score >= SCORE.HIGH_THRESHOLD ? '🟢' : score >= SCORE.MED_THRESHOLD ? '🟡' : '🔴';
    const action = score >= SCORE.HIGH_THRESHOLD ? 'ثقة عالية' : score >= SCORE.MED_THRESHOLD ? 'مشكلة محتملة' : 'غير مؤكد';
    return { score, icon, action, ev };
}

// ═══════════════════════════════════════════════════════
// Key Extractor — بدون حد ثابت
// ═══════════════════════════════════════════════════════

function extractKeys(code, varName) {
    const keys = [], nested = {};
    const startPat = new RegExp('\\b' + escapeRegex(varName) + '\\s*=\\s*\\[');
    const m = startPat.exec(code);
    if (!m) return { keys, nested };

    // ابحث عن نهاية الـ block بعد ] المقابل بدل حد 1000 ثابت
    let depth = 0, start = m.index, end = m.index;
    for (let i = m.index; i < code.length; i++) {
        if (code[i] === '[') depth++;
        else if (code[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const block = code.slice(start, end);

    // top-level dict keys
    const firstDict = /\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/.exec(block);
    if (firstDict) {
        PATTERNS.dictKey.lastIndex = 0;
        let km;
        while ((km = PATTERNS.dictKey.exec(firstDict[1])) !== null) keys.push(km[1]);
    }

    // nested list-of-dict keys
    PATTERNS.nestedList.lastIndex = 0;
    let nm;
    while ((nm = PATTERNS.nestedList.exec(block)) !== null) {
        const nk = [];
        const re2 = /"(\w+)"\s*:/g;
        let nkm;
        while ((nkm = re2.exec(nm[2])) !== null) nk.push(nkm[1]);
        nested[nm[1]] = nk;
    }
    return { keys, nested };
}

// ═══════════════════════════════════════════════════════
// Main Analyzer
// ═══════════════════════════════════════════════════════

function analyzeCode(code, fileName) {
    if (typeof analyzeJava !== 'undefined' && fileName.endsWith('.java'))
        return analyzeJava(code, fileName);

    const issues = [];
    const ext    = fileName.split('.').pop().toLowerCase();

    if (ext === 'py') analyzePython(code, issues);
    if (['js','ts','jsx','html'].includes(ext)) analyzeJS(code, fileName, ext, issues);

    enhanceStubs(issues, code);
    finalizeIssues(issues, code);
    // Crypto scan
    if (typeof scanCrypto === 'function') {
        const cryptoIssues = scanCrypto(code, fileName);
        cryptoIssues.forEach(ci => {
            const dup = issues.some(x => x.line === ci.line && x.title === ci.title);
            if (!dup) issues.push(ci);
        });
    }
    // TypeScript/Kotlin/PHP analysis
    const ext2 = fileName.split('.').pop().toLowerCase();
    if (ext2 === 'ts' || ext2 === 'tsx') {
        if (typeof analyzeTypeScript === 'function') {
            const tsResult = analyzeTypeScript(code, fileName);
            tsResult.issues.forEach(i => {
                const dup = issues.some(x => x.line === i.line && x.title === i.title);
                if (!dup) issues.push(i);
            });
        }
    }
    if (ext2 === 'kt') {
        if (typeof analyzeKotlin === 'function') {
            const ktResult = analyzeKotlin(code, fileName);
            ktResult.issues.forEach(i => {
                const dup = issues.some(x => x.line === i.line && x.title === i.title);
                if (!dup) issues.push(i);
            });
        }
    }
    if (ext2 === 'php') {
        if (typeof analyzePHP === 'function') {
            const phpResult = analyzePHP(code, fileName);
            phpResult.issues.forEach(i => {
                const dup = issues.some(x => x.line === i.line && x.title === i.title);
                if (!dup) issues.push(i);
            });
        }
    }
    // C/C++ Analysis
    if ((fileName.endsWith('.c') || fileName.endsWith('.cpp') ||
         fileName.endsWith('.cc') || fileName.endsWith('.h') ||
         fileName.endsWith('.hpp')) && typeof analyzeCCpp === 'function') {
        const cResult = analyzeCCpp(code, fileName);
        cResult.issues.forEach(i => {
            if (!issues.some(x => x.line === i.line && x.title === i.title))
                issues.push(i);
        });
    }
    // Secret Detection
    if (typeof detectSecrets === 'function') {
        const secrets = detectSecrets(code, fileName);
        secrets.forEach(s => {
            if (!issues.some(x => x.line === s.line && x.title === s.title))
                issues.push(s);
        });
    }
    // Security scan
    if (typeof scanSecurity === 'function') {
        const secIssues = scanSecurity(code, fileName);
        secIssues.forEach(si => {
            const dup = issues.some(x => x.line === si.line && x.title === si.title);
            if (!dup) issues.push(si);
        });
    }
    // Pattern detection
    if (typeof detectPatterns === 'function') {
        const patternIssues = detectPatterns(code, fileName);
        patternIssues.forEach(pi => {
            const dup = issues.some(x => Math.abs(x.line - pi.line) <= 1 && x.title === pi.title);
            if (!dup) issues.push(pi);
        });
    }
    // Accumulation detection - inline
    const _accumVars = ['total','sum','count','revenue','sales','discount',
      'value','amount','price','cost','profit','balance','score','qty',
      'quantity','inventory','totalRevenue','totalItems','totalDiscount',
      'totalValue','totalSales','total_value','total_cost','total_weight',
      'category_revenue','weight_report','capacity_report'];
    const _lines2 = code.split('\n');
    let _inLoop2 = false, _loopDepth2 = 0;
    const _declaredVars2 = new Set();
    _lines2.forEach((_ln, _i) => {
        const _t = _ln.trim();
        if (_t.startsWith('//') || _t.startsWith('#')) return;
        const _dm = _t.match(/(?:let|var|const|int|double|float)\s+(\w+)\s*=\s*0/) || _t.match(/(\w+)\s*=\s*0$/);
        if (_dm) _declaredVars2.add(_dm[1]);
        if (_t.includes('.forEach(') || /for\s*\(/.test(_t) || /^for\s+\w+\s+in\s+/.test(_t)) {
            _inLoop2=true;
            // عدد { في هذا السطر بس ما نحسب الأقواس التابعة
            const _openInLine = (_t.match(/\{/g)||[]).length;
            const _closeInLine = (_t.match(/\}/g)||[]).length;
            _loopDepth2 += Math.max(1, _openInLine - _closeInLine);
        }
        if (_inLoop2 && !_t.includes('.forEach(') && !(/for\s*\(/.test(_t)) && (_t==='}' || _t==='});' || _t==='})'||_t.startsWith('});'))) {
            _loopDepth2=Math.max(0,_loopDepth2-1);
            if(_loopDepth2===0) _inLoop2=false;
        }
        if (_inLoop2) {
            _accumVars.forEach(_v => {
                const _p = new RegExp('\\b'+_v+'\\s*=(?!=|\\+|-)\\s*\\S');
                if (_p.test(_t) && !/(?:let|var|const)\s+/.test(_t)) {
                    const _known = _declaredVars2.has(_v) || 
                        _lines2.slice(0,_i).some(_l=>new RegExp('\\b'+_v+'\\s*=\\s*0').test(_l));
                    if (_known) {
                        const _dup = issues.some(_x=>Math.abs(_x.line-(_i+1))<=1&&_x.title.includes(_v));
                        if (!_dup) issues.push({type:'bug',sev:'c',
                            title:'خطأ تراكم: '+_v+' = بدل +=',
                            line:_i+1,ev:_t,
                            fix:_t.replace(new RegExp('('+_v+')\\s*=(?!=)'),'$1 +='),
                            conf:90,cIcon:'🟢',cAct:'خطأ تراكم مؤكد',
                            cEv:[_v+' مُهيَّأ بـ 0 قبل الحلقة']});
                    }
                }
            });
        }
    });
    return issues;
}

// ═══════════════════════════════════════════════════════
// Python Analyzer
// ═══════════════════════════════════════════════════════

function analyzePython(code, issues) {
    const lines    = code.split('\n');
    // Stack of loop indents بدل flag واحد
    const loopStack = [];

    lines.forEach((line, i) => {
        const t   = line.trim();
        const ind = leadingSpaces(line);
        if (!t || t.startsWith('#')) return;

        // خرجنا من loops ذات indent أعلى
        while (loopStack.length && loopStack[loopStack.length - 1] >= ind) {
            loopStack.pop();
        }

        // stub: def ... pass
        if (PATTERNS.pyFuncDef.test(t)) {
            const n1 = lines[i + 1]?.trim() ?? '';
            const n2 = lines[i + 2]?.trim() ?? '';
            if (n1 === 'pass' || n2 === 'pass')
                issues.push({ type:'stub', sev:'m', title:'دالة ناقصة', line:i+2, ev:t, fix:null });
            // دالة جديدة تعيد stack الـ loops
            loopStack.length = 0;
            return;
        }

        // for loop → ادفع indent
        if (PATTERNS.pyForLoop.test(t)) {
            loopStack.push(ind);
        }

        // = بدل += داخل loop
        const inLoop = loopStack.length > 0;
        if (inLoop && PATTERNS.pyAccumAssign.test(t)) {
            const varName = t.match(/^(\w+)\s*=/)?.[1];
            if (varName) {
                const zeroRe = new RegExp('\\b' + escapeRegex(varName) + '\\s*=\\s*0\\b');
                if (zeroRe.test(code)) {
                    const fix = line.replace(/^(\s*)(\w+)\s*=\s*(.+)/, '$1$2 += $3').trim();
                    issues.push({ type:'bug', sev:'c', title:'خطأ في التراكم: = بدل +=', line:i+1, ev:t, fix });
                }
            }
        }

        // == None / != None
        if (PATTERNS.pyNoneCompare.test(line)) {
            issues.push({
                type:'bug', sev:'m', title:'قارن بـ is None', line:i+1, ev:t,
                fix: t.replace('== None', 'is None').replace('!= None', 'is not None'),
            });
        }

        // bare except
        if (PATTERNS.pyBareExcept.test(t)) {
            issues.push({ type:'bug', sev:'m', title:'Bare except', line:i+1, ev:t, fix:'except Exception as e:' });
        }
    });
}

// ═══════════════════════════════════════════════════════
// JS / TS / JSX / HTML Analyzer
// ═══════════════════════════════════════════════════════

function analyzeJS(code, fileName, ext, issues) {
    let work = code;
    if (ext === 'html') {
        const scripts = [];
        const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
        let m;
        while ((m = re.exec(code)) !== null) scripts.push(m[1]);
        work = scripts.join('\n') || code;
    }

    const lines = work.split('\n');

    // Stack-based loop tracking بدل flag واحد
    // نعدّ depth الـ braces — لو دخلنا loop نسجّل depth
    let braceDepth  = 0;
    const loopDepths = []; // depths عند دخول loops

    lines.forEach((line, i) => {
        const t = line.trim();
        if (!t || t.startsWith('//')) return;

        const openBraces  = (line.match(/\{/g)  ?? []).length;
        const closeBraces = (line.match(/\}/g)  ?? []).length;

        // forEach detection
        if (PATTERNS.jsForEach.test(line)) {
            loopDepths.push(braceDepth);
            const hasReturn = checkForEachReturn(lines, i);
            const hasSideEffects = checkSideEffects(lines, i);

            if (hasReturn) {
                const fix = hasSideEffects ? null : line.replace('.forEach(', '.find(').trim();
                issues.push({
                    type:'bug', sev:'h',
                    title: hasSideEffects ? 'return داخل forEach مع side effects' : 'return داخل forEach',
                    line: i + 1, ev: t, fix,
                });
            }
        }

        // for loop
        if (PATTERNS.jsForLoop.test(line) && !PATTERNS.jsForEach.test(line)) {
            loopDepths.push(braceDepth);
        }

        braceDepth += openBraces - closeBraces;

        // خرجنا من loop
        while (loopDepths.length && braceDepth <= loopDepths[loopDepths.length - 1]) {
            loopDepths.pop();
        }

        const inLoop = loopDepths.length > 0;

        // = بدل += داخل loop
        if (inLoop
            && PATTERNS.jsAccum.test(line)
            && !/==/.test(line)
            && !/^\s*(let|var|const)\s+/.test(line)) {
            const fix = line.replace(/(\s*)(\w+)\s*=\s*(.+)/, '$1$2 += $3').trim();
            issues.push({ type:'bug', sev:'c', title:'خطأ في التراكم: = بدل +=', line:i+1, ev:t, fix });
        }

        // == بدل ===
        if (PATTERNS.jsLooseEq.test(line) && /if\s*\(/.test(line)) {
            issues.push({
                type:'bug', sev:'m', title:'استخدم ===', line:i+1, ev:t,
                fix: t.replace(/([^=!<>])==([^=])/g, '$1===$2'),
            });
        }
    });
}

/** تحقق من وجود return داخل forEach body */
function checkForEachReturn(lines, startIdx) {
    let depth = 0;
    for (let j = startIdx + 1; j < Math.min(startIdx + 20, lines.length); j++) {
        const jt = lines[j].trim();
        depth += (lines[j].match(/\{/g) ?? []).length - (lines[j].match(/\}/g) ?? []).length;
        if (depth < 0) break; // خرجنا من forEach
        if (/\breturn\s+\w/.test(jt)) return true;
    }
    return false;
}

/** تحقق من وجود side effects داخل forEach body */
function checkSideEffects(lines, startIdx) {
    let depth = 0;
    for (let j = startIdx + 1; j < Math.min(startIdx + 20, lines.length); j++) {
        const jt = lines[j].trim();
        depth += (lines[j].match(/\{/g) ?? []).length - (lines[j].match(/\}/g) ?? []).length;
        if (depth < 0) break;
        if (/^[a-zA-Z_]\w*\s*\(/.test(jt)
            && !jt.startsWith('return')
            && !jt.startsWith('//')
            && !jt.startsWith('if')
            && !jt.startsWith('console')) return true;
    }
    return false;
}

// ═══════════════════════════════════════════════════════
// Semantic Engine — Stub Fix Suggester
// ═══════════════════════════════════════════════════════

function suggestFix(funcName, params, code) {
    const n = funcName.toLowerCase();

    // تصنيف params
    const listP   = params.filter(p =>
        COLLECTION_WORDS.includes(p.toLowerCase())
        || (p.endsWith('s') && p.length > 3 && !RATE_WORDS.some(r => p.toLowerCase().includes(r)))
    );
    const scalarP = params.filter(p => !listP.includes(p));
    const coll    = listP[0] ?? null;
    const scalar  = scalarP.find(p =>
        RATE_WORDS.some(r => p.toLowerCase().includes(r))
        || p.endsWith('_id')
        || p.endsWith('_ref')
    ) ?? scalarP[0] ?? null;
    const dictP   = params.find(p => DICT_WORDS.includes(p.toLowerCase())) ?? null;

    // استخراج keys
    const allColls = [...new Set([...params.filter(p => p.endsWith('s')), ...COLLECTION_WORDS])];
    let keys = [], nested = {}, itemKeys = [];
    for (const c of allColls) {
        const result = extractKeys(code, c);
        if (result.keys.length) { keys = result.keys; nested = result.nested; break; }
    }
    itemKeys = nested.items ?? nested.products ?? nested.entries ?? [];

    // Key shortcuts
    const idKey       = findKey(keys, 'id', 'order_id', 'user_id', 'product_id');
    const customerKey = findKey(keys, 'username', 'customer', 'user', 'owner', 'name');
    const statusKey   = findKey(keys, 'status', 'state', 'type');
    const activeKey   = findKey(keys, 'active', 'enabled', 'is_active');
    const scoreKey    = findKey(keys, 'score', 'rating', 'points', 'value');
    const priceKey    = findKey(itemKeys, 'price', 'cost', 'amount')
                     ?? findKey(keys, 'price', 'cost', 'amount');
    const qtyKey      = findKey(itemKeys, 'qty', 'quantity', 'count', 'units') ?? 'quantity';

    const c = coll   ?? 'items';
    const d = dictP  ?? 'item';
    const s = scalar ?? 'value';

    // ── Intent matching ──

    if (n.includes('best') || n.includes('top')) {
        const k = scoreKey ?? priceKey ?? 'score';
        return `return max(${c}, key=lambda x: x.get("${k}", 0))`;
    }

    if (n.includes('average') || n.includes('avg')) {
        const k = priceKey ?? 'price';
        return `return sum(x["${k}"] for x in ${c}) / len(${c}) if ${c} else 0`;
    }

    if (n.includes('total') || n.includes('revenue') || n.includes('sum')) {
        if (priceKey && itemKeys.length)
            return `return sum(i["${priceKey}"] * i["${qtyKey}"] for i in ${d}["items"])`;
        if (priceKey)
            return `return sum(x["${priceKey}"] * x.get("${qtyKey}", 1) for x in ${c})`;
        return `return sum(x.get("price", 0) * x.get("quantity", 1) for x in ${c})`;
    }

    if (n.includes('expensive') || n.includes('cheap') || n.includes('minimum') || n.includes('maximum')) {
        const pk = priceKey ?? 'price';
        const op = n.includes('cheap') || n.includes('minimum') ? '<=' : '>=';
        return scalar
            ? `return [x for x in ${c} if x.get("${pk}", 0) ${op} ${scalar}]`
            : `return [x for x in ${c} if x.get("${pk}", 0) > 0]`;
    }

    if (n.includes('filter') || n.includes('active') || n.includes('pending') || n.includes('available')) {
        const filterStatuses = ['active','pending','delivered','cancelled','available'];
        const st = filterStatuses.find(fs => n.includes(fs));
        if (st && statusKey) return `return [x for x in ${c} if x.get("${statusKey}") == "${st}"]`;
        if (activeKey)       return `return [x for x in ${c} if x.get("${activeKey}")]`;
        if (statusKey)       return `return [x for x in ${c} if x.get("${statusKey}") == "${st ?? 'active'}"]`;
    }

    // get / find / search — مرة واحدة بدون تكرار
    if (n.includes('find') || n.includes('get') || n.includes('search')) {
        // get_X_orders → filter by customer (returns list)
        if (n.endsWith('_orders') && scalar && customerKey)
            return `return [x for x in ${c} if x.get("${customerKey}") == ${scalar}]`;
        // get_by_id → next()
        if (scalar && idKey)
            return `return next((x for x in ${c} if x.get("${idKey}") == ${scalar}), None)`;
        // scalar name matches a key exactly
        const matchKey = keys.find(k => k === scalar);
        if (scalar && matchKey)
            return `return next((x for x in ${c} if x.get("${matchKey}") == ${scalar}), None)`;
        // fallback: search by customerKey
        if (scalar && customerKey)
            return `return next((x for x in ${c} if x.get("${customerKey}") == ${scalar}), None)`;
    }

    if (n.includes('count')) {
        return activeKey
            ? `return sum(1 for x in ${c} if x.get("${activeKey}"))`
            : `return len(${c})`;
    }

    if (n.includes('discount') || n.includes('tax')) {
        return `return ${d}["price"] * (1 - ${s})`;
    }

    if (n.includes('normalize') || n.includes('format') || n.includes('clean')) {
        const nameK = customerKey ?? 'username';
        return dictP
            ? `return ${d}.get("${nameK}", "").strip().lower() if isinstance(${d}, dict) else str(${d}).strip().lower()`
            : `return ${d}.strip().lower() if isinstance(${d}, str) else str(${d}).strip().lower()`;
    }

    if (n.includes('validate') || n.includes('check') || n.includes('verify')) {
        return `return ${d} is not None and bool(${d})`;
    }

    if (n.includes('email')) {
        const emailKey = findKey(keys, 'email', 'mail', 'contact');
        if (emailKey && scalar)
            return `user = next((x for x in ${c} if x.get("${customerKey ?? 'username'}") == ${scalar}), None)\n    return user["${emailKey}"] if user else None`;
    }

    // orders fallback
    if ((n.includes('orders') || n.includes('by')) && scalar) {
        const searchKey = keys.find(k => k === scalar) ?? customerKey ?? 'customer';
        return `return [x for x in ${c} if x.get("${searchKey}") == ${scalar}]`;
    }

    return null;
}

// ═══════════════════════════════════════════════════════
// Stub Enhancer
// ═══════════════════════════════════════════════════════

function enhanceStubs(issues, code) {
    issues.forEach(issue => {
        if (issue.type !== 'stub') return;
        const m = issue.ev.match(/^def\s+(\w+)\s*\(([^)]*)\)/);
        if (!m) return;
        const funcName = m[1];
        const params   = m[2].split(',')
            .map(p => p.trim().split('=')[0].trim())
            .filter(Boolean);
        const fix = suggestFix(funcName, params, code);
        if (fix) {
            issue.fix   = fix;
            issue.conf  = SCORE.MIN_CONF;
            issue.cIcon = '🟡';
            issue.cAct  = 'اقتراح محرك';
        }
    });
    return issues;
}

// ═══════════════════════════════════════════════════════
// Finalize: calcConf on all issues
// ═══════════════════════════════════════════════════════

function finalizeIssues(issues, code) {
    issues.forEach(iss => {
        const c = calcConf(iss, code);
        // لا تكتب فوق conf لو محدد يدوياً وأعلى
        if (!iss.conf || iss.conf < c.score) {
            iss.conf  = c.score;
            iss.cIcon = c.icon;
            iss.cAct  = c.action;
        }
        iss.cEv = c.ev;
    });
}

// Java analysis handled by engine_java.js
