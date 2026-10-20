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

/** Blank out quoted literals (and, optionally, a trailing # comment) in ONE line.
 *  Length is preserved so column offsets stay valid. */
function maskLiterals(line, hashComment) {
    const src = String(line ?? '');
    let out = '', q = null;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (q) {
            out += ' ';
            if (c === '\\') { out += ' '; i++; continue; }
            if (c === q) q = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') { q = c; out += ' '; continue; }
        if (c === '/' && src[i + 1] === '/') { out += ' '.repeat(src.length - i); break; }
        if (hashComment && c === '#')          { out += ' '.repeat(src.length - i); break; }
        out += c;
    }
    return out;
}

/** true when the whole snippet is nothing but a comment */
function isCommentOnly(str) {
    const t = String(str ?? '').trim();
    return t.startsWith('//') || t.startsWith('#') || t.startsWith('/*');
}

/** Check if parens/brackets are balanced — brackets inside literals are ignored */
function isBalanced(str) {
    const clean = maskLiterals(str, false);
    const open  = (clean.match(/[{[(]/g) ?? []).length;
    const close = (clean.match(/[}\])]/g) ?? []).length;
    return open === close;
}

/** Extension of a file name, '' when there is none. Never throws. */
function extOf(fileName) {
    const name = (typeof fileName === 'string') ? fileName : '';
    const dot  = name.lastIndexOf('.');
    return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Per-line flag: 1 = the line starts inside a template literal or block comment.
 *  Line-based detectors skip those lines so prose is not reported as code. */
function maskedLines(code) {
    const src    = String(code ?? '');
    const masked = new Uint8Array(src.split('\n').length);
    let line = 0, state = 0;                      // 0 none · 1 template · 2 block comment
    for (let i = 0; i < src.length; i++) {
        const c = src[i], d = src[i + 1];
        if (c === '\n') { line++; if (state) masked[line] = 1; continue; }
        if (state === 1) { if (c === '\\') i++; else if (c === '`') state = 0; continue; }
        if (state === 2) { if (c === '*' && d === '/') { i++; state = 0; } continue; }
        if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; i--; continue; }
        if (c === '/' && d === '*') { state = 2; i++; continue; }
        if (c === '`') { state = 1; continue; }
        if (c === '"' || c === "'") {
            const q = c; i++;
            while (i < src.length && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
            continue;
        }
    }
    return masked;
}

/** Keep only <script> bodies; everything else becomes spaces so LINE NUMBERS stay real. */
function htmlScriptOnly(html) {
    const src = String(html ?? '');
    const out = src.split('');
    for (let i = 0; i < out.length; i++) if (out[i] !== '\n') out[i] = ' ';
    const re = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
    let m;
    while ((m = re.exec(src)) !== null) {
        const start = m.index + m[0].indexOf('>') + 1;
        for (let i = start; i < start + m[1].length && i < src.length; i++) out[i] = src[i];
    }
    return out.join('');
}

/** Accept both detector shapes: an array, or { issues: [...] }. */
function engineList(result) {
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.issues)) return result.issues;
    return [];
}

// ═══════════════════════════════════════════════════════
// [ENGINE-FAIL] عطبُ محرّكٍ لا يُقرأ «لا مشكلاتَ في الملف»
// ═══════════════════════════════════════════════════════
// ‎runEngine‎ يعزل كلَّ كاشفٍ كي لا يُسقط عطبُه الملفَ كلَّه — وهذا صحيح.
// لكنّه كان يُرجع ‎[]‎ ويكتفي بـ‎console.warn‎، و‎[]‎ لا يُميَّز عن «فحصتُ
// فلم أجد». فمحرّكٌ ميّتٌ يبدو ملفًا سليمًا.
//
// والعطبُ ليس فرضيًّا: ‎analyzeProject‎ يرمي ‎code.split is not a function‎
// في **كلِّ** نداء (24 من 24 مقيسًا) لتصادمِ ‎extractFunctions‎ بين
// ‎project_intelligence.js‎ و‎test_generator.js‎ — ولم يَظهر ذلك في أيِّ
// مخرَجٍ ولا اختبارٍ ولا واجهة، لأنّه يُبتلع هنا.
//
// فالسجلُّ أدناه يجعل العطبَ **مقروءًا**: المحرّكُ والمرحلةُ والسببُ والملف،
// ويبقى السلوكُ كما هو بتًّا — نفسُ ‎[]‎ ونفسُ استمرارِ بقيةِ المحرّكات.
// ولا يُضاف بلاغٌ إلى النتيجة عن قصد: بلاغٌ يظهر في ‎after‎ وحده (لأن محرّكًا
// يرمي على الشفرةِ المُصلَحة فقط) يرفع العدَّ فترفض البوابةُ إصلاحًا صحيحًا.
// فالقناةُ خارجَ النتيجة: ‎engineFailures()‎ يقرأها الاختبارُ والواجهةُ والخادم.
const ENGINE_FAILURES = [];
const ENGINE_FAILURES_MAX = 200;
const ENGINE_REASON_MAX = 200;
let _engineFile = '';

// [FAIL-SCRUB] رسالةُ العطبِ نصٌّ من المحرّكِ لا سلطةَ لنا عليه، وقد تحمل
// شفرةَ المستخدم: محرّكٌ يرمي ‎new Error('cannot parse: ' + code.split('\n')[0])‎
// يُدخِل سطرَ الإسنادِ كلَّه إلى السجلّ. ومقيسٌ قبل التنقيح: اثنان من أربعةِ
// نواقلَ يُسرّبان ‎sk_live_…‎ و‎Hunter2-Very-Secret‎ إلى ‎engineFailures()‎
// وإلى سطرِ ‎console.warn‎، وطولُ السببِ كان بلا حدٍّ (ملفٌّ كاملٌ محتمل).
//
// فالقيمُ تُنقَّح والطولُ يُحَدّ. وما يُفيد التشخيصَ يبقى: ‎code.split is not a
// function‎ و‎Expected ',' or '}' after property value in JSON at position 20‎
// لا يُمَسّان (نصوصُهما الحرفيةُ أقصرُ من الحدّ).
function _scrubFailureText(s) {
    let t = String(s == null ? '' : s);
    // نصٌّ حرفيٌّ طويلٌ = قيمةٌ من شفرةِ المستخدم، ولا تُفيد في تحديدِ العطب
    t = t.replace(/(['"`])(?:\\.|(?!\1)[^\\\n]){8,}\1/g, '$1[REDACTED]$1');
    // رمزٌ طويلٌ بلا أقواس: مفاتيحُ API وما يشبهها
    t = t.replace(/\b[A-Za-z0-9_\-]{24,}\b/g, '[REDACTED]');
    if (t.length > ENGINE_REASON_MAX) t = t.slice(0, ENGINE_REASON_MAX) + '…';
    return t;
}

/** سجلُّ أعطابِ المحرّكات في آخرِ تحليل (نسخةٌ، فلا يُعدّله القارئ). */
function engineFailures() { return ENGINE_FAILURES.map(r => Object.assign({}, r)); }
function clearEngineFailures() { ENGINE_FAILURES.length = 0; }

/** Run one external detector in isolation — a broken engine must not lose the whole file. */
function runEngine(name, fn, stage) {
    try {
        const raw = fn();
        const list = engineList(raw);
        // [SHAPE] ناتجٌ ليس مصفوفةً ولا ‎{issues}‎ يُفقَد كاملًا بلا أثر:
        // ‎engineList‎ لا تقرأ إلا الاثنين فتُرجع ‎[]‎. ولا محرّكَ اليوم بهذا
        // الشكل (قِيس: 22 من 22 تُرجع مصفوفةً أو ‎{issues}‎)، والسجلُّ حارسٌ
        // كي لا يصير أحدُها كذلك صامتًا.
        if (!list.length && raw && typeof raw === 'object' && !Array.isArray(raw) &&
            !Array.isArray(raw.issues)) {
            const keys = Object.keys(raw).slice(0, 6).join(',');
            if (ENGINE_FAILURES.length < ENGINE_FAILURES_MAX)
                ENGINE_FAILURES.push({
                    engine: String(name), stage: String(stage || 'analyze'),
                    reason: 'SHAPE_NOT_READ — الناتجُ كائنٌ بلا ‎issues‎ فلا يُقرأ منه شيء: {' + keys + '}',
                    file: _engineFile, kind: 'ShapeMismatch',
                });
        }
        return list;
    }
    catch (e) {
        const rec = {
            engine: String(name),
            stage: String(stage || 'analyze'),
            reason: _scrubFailureText((e && e.message) || e),
            file: _engineFile,
            kind: (e && e.name) ? String(e.name) : 'Error',
        };
        if (ENGINE_FAILURES.length < ENGINE_FAILURES_MAX) ENGINE_FAILURES.push(rec);
        if (typeof console !== 'undefined' && console.warn)
            console.warn('[ENGINE-FAIL] ' + rec.engine + ' @' + rec.stage +
                         (rec.file ? ' (' + rec.file + ')' : '') + ' — ' + rec.reason);
        return [];
    }
}

/** Per-line flag: 1 = the line sits inside a loop body (braces for JS, indent for Python). */
function loopLines(code, ext) {
    const lines  = String(code ?? '').split('\n');
    const inLoop = new Uint8Array(lines.length);
    const isPy   = ext === 'py';
    const stack  = [];
    let depth = 0;
    for (let i = 0; i < lines.length; i++) {
        const raw   = lines[i];
        const clean = maskLiterals(raw, isPy);
        const t     = clean.trim();
        if (isPy) {
            const ind = raw.length - raw.replace(/^[ \t]*/, '').length;
            if (t) while (stack.length && ind <= stack[stack.length - 1]) stack.pop();
            inLoop[i] = stack.length ? 1 : 0;
            if (/^(?:for|while)\b.*:\s*$/.test(t)) stack.push(ind);
        } else {
            // [FOREACH-LOOP] ‎foreach (…)‎ حلقةُ PHP وC# الأشيع، ولم تكن
            // تُطابَق: ‎for‎ يليه ‎each‎ لا ‎(‎، و‎\.forEach\s*\(‎ يشترط نقطةً.
            // فكان كلُّ سطرٍ داخلَ ‎foreach‎ يُقرأ خارجَ حلقة، وكاشفُ التراكم
            // لا يعمل إلا داخلَ حلقة — فسقط ‎ACCUMULATION/php‎ كلُّه رغم أن
            // بقيّةَ شروطِه مُستوفاة (مقيسٌ: النمطُ يطابق، والمتغيّرُ مُهيَّأٌ
            // بصفرٍ قبلَها، والسطرُ ليس ضوضاء — والحلقةُ وحدَها كانت صفرًا).
            const opensLoop = /(^|[^\w$])(?:foreach|for|while)\s*\(/.test(clean) || /\.forEach\s*\(/.test(clean);
            inLoop[i] = stack.length ? 1 : 0;
            if (opensLoop) stack.push(depth);
            depth += (clean.match(/\{/g) ?? []).length - (clean.match(/\}/g) ?? []).length;
            while (stack.length && depth <= stack[stack.length - 1]) stack.pop();
        }
    }
    return inLoop;
}

// ── Vulnerability classes — used by the final de-duplication ──────────────
// The key must describe WHAT the problem is, never which language the file is
// written in: two different vulnerabilities on one line have to survive.
const VULN_CLASSES = [
    ['sql_params', /params mismatch|ناقص params|بدون params|missing params/i],
    ['sqli',       /sql injection|cwe-?89|sqli\b/i],
    ['xss',        /\bxss\b|cwe-?79/i],
    ['cmd',        /command injection|cwe-?78|os\.system/i],
    ['code_exec',  /\beval\b|new Function|cwe-?0?94|code injection/i],
    ['weak_hash',  /\bmd5\b|\bsha-?1\b|cwe-?327|cwe-?916|weak hash/i],
    ['accum',      /تراكم|accumulation/i],
    ['stub',       /دالة ناقصة|\bstub\b/i],
    ['secret',     /secret|credential|hardcoded|cwe-?798|jwt|api[_ -]?key|مكشوف/i],
];
function vulnClass(issue) {
    const raw = [issue && issue.cwe, issue && issue.cAct, issue && issue.title].filter(Boolean).join(' ');
    for (const [name, re] of VULN_CLASSES) if (re.test(raw)) return name;
    return 't:' + String((issue && issue.title) || '').trim().toLowerCase();
}

/** Merge reports of the SAME problem on the same line, keeping the most confident one. */
function dedupeIssues(issues) {
    const byKey = new Map();
    issues.forEach(issue => {
        if (!issue || typeof issue !== 'object') return;
        const key      = (issue.line || 0) + ':' + vulnClass(issue);
        const existing = byKey.get(key);
        if (!existing) { byKey.set(key, issue); return; }

        // [MERGE-KEEP] الدمج يُبقي الأعلى ثقةً، وكان **يُسقط ما يحمله الآخر**.
        // وaiRequired قرارُ توجيهٍ لا وصفٌ: إن كان أحد التقريرين يقول «هذا لا
        // يُصلَح حتميًّا فليذهب إلى AI» فإسقاطُه يُفقد المشكلةَ مسارَها.
        // والمقيس: ‎res.send("Hello " + req.query.name)‎
        //   بلا knowledge_base: 🔴 XSS في res.send — aiRequired=true
        //   معه             : 🔴 XSS — user input في output — aiRequired=false
        // فالأعلى ثقةً غلب، ومعه ضاع aiRequired، فلم يبقَ للثغرة مسارٌ.
        // ويُدمَج aiRequired **وحده**. وكانت أول صياغة تنقل strategy وfix من
        // الخاسر أيضًا، فأسقطت ADV-5 (ثابتُ «نفس البلاغ ⇒ نفس الاستراتيجية
        // أيًّا كان المعرّف المحقون): بعضُ البلاغات تحمل ‎strategy: null‎ قيمةً
        // صريحة، و‎!== undefined‎ ينقلها فيطمس استراتيجيةً كان detectStrategy
        // يستنبطها من العنوان. وأيُّ كاشفٍ يكون الخاسر يتوقف على المعرّف،
        // فصار التوجيه يعتمد على الاسم. فلا يُنقَل إلا ما قيس فقدانُه.
        const winner = (issue.conf || 0) > (existing.conf || 0) ? issue : existing;
        const loser   = winner === issue ? existing : issue;
        if (loser.aiRequired === true) winner.aiRequired = true;
        byKey.set(key, winner);
    });
    return Array.from(byKey.values());
}

// ═══════════════════════════════════════════════════════
// Confidence Calculator
// ═══════════════════════════════════════════════════════

function calcConf(issue, code) {
    let score = SCORE.BASE;
    const ev  = ['النمط مكتشف +' + SCORE.BASE];
    issue = issue || {};
    const title = String(issue.title ?? '');

    // نوع المشكلة
    if (issue.type === 'stub') {
        score += SCORE.STUB_CONFIRMED;
        ev.push('pass مؤكد +' + SCORE.STUB_CONFIRMED);
    } else if (title.includes('forEach') && PATTERNS.jsForEach.test(code)) {
        score += SCORE.CONTEXT_MATCH;
        ev.push('forEach موجود +' + SCORE.CONTEXT_MATCH);
    } else if (title.includes('None') && PATTERNS.pyNoneCompare.test(code)) {
        score += SCORE.CONTEXT_MATCH;
        ev.push('None موجودة +' + SCORE.CONTEXT_MATCH);
    } else if (title.includes('التراكم') || title.includes('تراكم')) {
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

    // جودة الـ fix — تعليق ليس إصلاحاً، فلا يأخذ نقاط إصلاح
    const fixText  = (typeof issue.fix === 'string') ? issue.fix : '';
    const realFix  = fixText && !isCommentOnly(fixText);
    if (realFix && fixText.length < 120) {
        score += SCORE.SHORT_FIX;
        ev.push('إصلاح مباشر +' + SCORE.SHORT_FIX);
    }
    if (realFix && isBalanced(fixText)) {
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
    // مُدخلات غير صالحة لا تُسقط التحليل كله — الاسم المفقود يعني "لغة مجهولة"
    if (typeof code !== 'string') code = (code == null) ? '' : String(code);
    fileName = (typeof fileName === 'string') ? fileName : '';
    const ext = extOf(fileName);
    // [ENGINE-FAIL] سجلُّ الأعطابِ يخصُّ هذا التحليل، فيُصفّر عند مدخله
    ENGINE_FAILURES.length = 0;
    _engineFile = fileName;
    if (!code.trim()) return [];

    // ═══════════════════════════════════════════════════
    // [JAVA-PATH] كان هذا الفرعُ يعود فورًا بثماني قواعدَ من ‎engine_java‎
    // وحدَها، فلا يرى ملفُّ ‎.java‎ شيئًا من الفاحصاتِ غيرِ المرتبطةِ بلغة.
    // وأثرُه مقيس: ‎LOG_SECRET‎ مُعلَنٌ لجافا في ‎STRATEGY_LANGS‎ و‎fixLogSecret‎
    // يُنتج له ‎Log.d("TAG", "[REDACTED]")‎ صحيحًا — ولا بلاغَ يصله قطّ، لأن
    // القاعدةَ التي تراه (رقم 9 في ‎security_scanner‎) خلفَ هذا العود.
    // وكذلك ‎HARDCODED_PASS/java‎: صفرُ بلاغ.
    //
    // فيُضَمُّ الفاحصان اللذان لا يفترضان لغةً بعينها. والقياسُ على خمسِ
    // عيّناتِ جافا سليمةٍ تمامًا (مجموعات، حلقات، قراءةٌ من البيئة، https،
    // تعليقٌ فيه كلمةُ password): صفرُ بلاغٍ من كليهما — فلا ثمنَ في
    // الإيجابِ الكاذب. و‎detectPatterns‎ يبقى خارجًا: قواعدُه (‎var‎، ‎==‎،
    // ‎catch‎ بنمطِ JS) محمولةٌ على JavaScript، والمقيسُ أنه يُنتج صفرًا على
    // جافا في الحالتين، فضمُّه زيادةٌ بلا أثرٍ وبمخاطرةِ قواعدَ لا تخصُّها.
    // والدمجُ بمساواةٍ تامّةٍ للسطرِ والعنوان، كما في المسارِ العامّ.
    // ═══════════════════════════════════════════════════
    if (typeof analyzeJava !== 'undefined' && ext === 'java') {
        const javaIssues = runEngine('analyzeJava', () => analyzeJava(code, fileName), 'lang:java');
        if (typeof scanSecurity === 'function') {
            runEngine('scanSecurity', () => scanSecurity(code, fileName), 'security:java').forEach(si => {
                if (!javaIssues.some(x => x.line === si.line && x.title === si.title)) javaIssues.push(si);
            });
        }
        if (typeof detectSecrets === 'function') {
            runEngine('detectSecrets', () => detectSecrets(code, fileName), 'secrets:java').forEach(s => {
                if (!javaIssues.some(x => x.line === s.line && x.title === s.title)) javaIssues.push(s);
            });
        }
        finalizeIssues(javaIssues, code);
        return dedupeIssues(dropRedactedLogFindings(javaIssues, code));
    }

    const issues = [];
    const masked = maskedLines(code);
    const lineIsNoise = i => masked[i] === 1;

    if (ext === 'py') {
        analyzePython(code, issues);
        analyzePythonSecurity(code, issues);

        // اكتشف query معرّف كـ comment
        const queryBound = /^\s*query\s*=/m.test(code) || /\bdef\s+\w+\s*\([^)]*\bquery\b/.test(code) ||
                           /\bfor\s+query\b/.test(code) || /\bas\s+query\b/.test(code) ||
                           /\bquery\s*:/.test(code);
        // [EXEC-RECEIVER] كان الشرطُ نصًّا حرفيًّا: ‎code.includes('cursor.execute(query')‎.
        // واسمُ المؤشِّرِ اصطلاحٌ لا قاعدة — ‎cur‎ و‎db‎ و‎conn‎ شائعةٌ مثلُه،
        // وكانت تمرّ بلا بلاغٍ البتّة (مقيس: ‎cur.execute(query)‎ و
        // ‎db.execute(query)‎ ⇒ صفرُ بلاغ، و‎cursor‎ وحدَه يُبلَّغ عنه).
        // والحارسُ هو ‎queryBound‎ لا اسمُ المُستقبِل: لا يُبلَّغ إلا إذا لم
        // يكن ‎query‎ مُعرَّفًا في الملفِّ أصلًا.
        const _execQ = /\b[\w.]+\.execute\s*\(\s*query\b/;
        if (_execQ.test(code) && !queryBound) {
            const qLine = code.split('\n').findIndex(l => _execQ.test(l)) + 1;
            if (qLine > 0) {
                // [EV-IS-EVIDENCE] كان الدليلُ هنا وصفًا عامًّا —
                // ‎'cursor.execute(query, ...)'‎ — لا نصَّ السطر. وحارسُ
                // ‎stale-line‎ في ‎repairCode‎ يشترط ‎currentLine.includes(ev)‎،
                // فلا يتحقّق أبدًا على سطرٍ كـ‎return cur.execute(query)‎،
                // فيُحكَم على البلاغِ بأنّه قديمٌ ويُترَك بصمتٍ قبل أن يصل
                // المُصلِحُ إليه. و‎fixNameError‎ قائمٌ ويُنتج الإصلاحَ الصحيحَ
                // متى نودي. فالدليلُ صار نصَّ السطرِ كما تقتضيه القاعدة.
                issues.push({ type:'py', sev:'c', line:qLine, ev:String(code.split('\n')[qLine - 1] || '').trim(),
                    title:'🔴 NameError: query غير معرّف — أزل # من query',
                    fix:'query = "SELECT * FROM ... WHERE id=?"',
                    conf:95, cIcon:'🔴', cAct:'NameError' });
            }
        }
    }
    if (['js','ts','jsx','html'].includes(ext)) analyzeJS(code, fileName, ext, issues);

    enhanceStubs(issues, code);
    // ملاحظة: finalizeIssues يعمل في النهاية فقط — قبل ذلك تبقى issues بلا conf/cEv
    // وكل ما يُضاف بعده كان يخرج بلا دليل ثقة إطلاقاً.
    // Crypto scan
    if (typeof scanCrypto === 'function') {
        const cryptoIssues = runEngine('scanCrypto', () => scanCrypto(code, fileName), 'crypto');
        cryptoIssues.forEach(ci => {
            const dup = issues.some(x => x.line === ci.line && x.title === ci.title);
            if (!dup) issues.push(ci);
        });
    }
    // TypeScript/Kotlin/PHP analysis
    const ext2 = ext;
    if (ext2 === 'ts' || ext2 === 'tsx') {
        if (typeof analyzeTypeScript === 'function') {
            const tsResult = runEngine('analyzeTypeScript', () => analyzeTypeScript(code, fileName), 'lang:ts');
            tsResult.forEach(i => {
                const dup = issues.some(x => x.line === i.line && x.title === i.title);
                if (!dup) issues.push(i);
            });
        }
    }
    if (ext2 === 'kt') {
        if (typeof analyzeKotlin === 'function') {
            const ktResult = runEngine('analyzeKotlin', () => analyzeKotlin(code, fileName), 'lang:kt');
            ktResult.forEach(i => {
                const dup = issues.some(x => x.line === i.line && x.title === i.title);
                if (!dup) issues.push(i);
            });
        }
    }
    if (ext2 === 'php') {
        if (typeof analyzePHP === 'function') {
            const phpResult = runEngine('analyzePHP', () => analyzePHP(code, fileName), 'lang:php');
            phpResult.forEach(i => {
                const dup = issues.some(x => x.line === i.line && x.title === i.title);
                if (!dup) issues.push(i);
            });
        }
    }
    // C/C++ Analysis
    if (['c','cpp','cc','h','hpp'].includes(ext) && typeof analyzeCCpp === 'function') {
        const cResult = runEngine('analyzeCCpp', () => analyzeCCpp(code, fileName), 'lang:c');
        cResult.forEach(i => {
            if (!issues.some(x => x.line === i.line && x.title === i.title))
                issues.push(i);
        });
    }
    // Secret Detection — النداء الوحيد (كان مكرراً مرتين على نفس الملف)
    if (typeof detectSecrets === 'function') {
        const secrets = runEngine('detectSecrets', () => detectSecrets(code, fileName), 'secrets');
        secrets.forEach(s => {
            if (!issues.some(x => x.line === s.line && x.title === s.title))
                issues.push(s);
        });
    }
    // Security scan
    if (typeof scanSecurity === 'function') {
        const secIssues = runEngine('scanSecurity', () => scanSecurity(code, fileName), 'security');
        secIssues.forEach(si => {
            const dup = issues.some(x => x.line === si.line && x.title === si.title);
            if (!dup) issues.push(si);
        });
    }
    // Pattern detection
    // ═══════════════════════════════════════════════════
    // [ADJ-MERGE] كان الشرطُ ‎Math.abs(x.line - pi.line) <= 1‎: بلاغٌ على بُعدِ
    // سطرٍ واحدٍ من بلاغٍ بالعنوانِ نفسِه يُعَدّ تكرارًا ويُسقَط. والدمجان
    // فوقَه (‎detectSecrets‎ و‎scanSecurity‎) يستعملان المساواةَ التامّة، فكان
    // التساهلُ خاصًّا بهذا الموضعِ وحدَه لا سياسةً عامّة.
    //
    // ومشكلتان مستقلّتان على سطرَين متلاصقَين لا تجمعهما إلا المجاورة:
    //     try { a(); } catch (e) {}
    //     try { b(); } catch (e) {}
    // فكان الثاني يُسقَط قبل أن يراه مسارُ الإصلاح. والضررُ ليس خفاءَ بلاغٍ
    // فحسب: إعادةُ تحليلِ المُرشَّحِ تُظهر ما كان محجوبًا، فلا ينقص العددُ
    // الكلّيُّ، فتحكم البوابةُ ‎REJECTED_NO_IMPROVEMENT‎ ويطرح Ghost الدفعةَ
    // كلَّها. والمقيس: أربعُ catch متجاورة ⇒ أربعةٌ تُكتشَف، صفرٌ يُصلَح؛
    // وبسطرٍ فارغٍ بينها ⇒ ثلاثةٌ من ثلاثة. المسافةُ هي المتغيّرُ الوحيد.
    //
    // والتكرارُ الحقيقيُّ — السطرُ نفسُه والعنوانُ نفسُه — ما زال يُسقَط هنا،
    // ويُسقَط بعده ثانيةً في ‎dedupeIssues‎ بمفتاحِ ‎line + vulnClass‎ الذي
    // يجمع العناوينَ المختلفةَ للثغرةِ الواحدة. فلم يُفتح بابُ تكرار.
    // ═══════════════════════════════════════════════════
    if (typeof detectPatterns === 'function') {
        const patternIssues = runEngine('detectPatterns', () => detectPatterns(code, fileName), 'patterns');
        patternIssues.forEach(pi => {
            const dup = issues.some(x => x.line === pi.line && x.title === pi.title);
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
    // نطاق الحلقة يُحسب بالأقواس (JS) أو بالإزاحة (Python) بدل عدّاد تقريبي كان
    // يبقى مفتوحاً بعد نهاية الحلقة فيبلّغ عن أسطر خارجها.
    const _inLoopFlags = loopLines(code, ext);
    const _declaredVars2 = new Set();
    _lines2.forEach((_ln, _i) => {
        const _t = _ln.trim();
        if (_t.startsWith('//') || _t.startsWith('#')) return;
        if (lineIsNoise(_i)) return;
        const _dm = _t.match(/(?:let|var|const|int|double|float)\s+(\w+)\s*=\s*0/) || _t.match(/(\w+)\s*=\s*0$/);
        if (_dm) _declaredVars2.add(_dm[1]);
        if (!_inLoopFlags[_i]) return;
        _accumVars.forEach(_v => {
            const _esc = escapeRegex(_v);
            const _p = new RegExp('\\b'+_esc+'\\s*=(?!=|\\+|-)\\s*\\S');
            // [SELF-ACCUM] ‎x = x + 1‎ تراكمٌ مكتوبٌ مطوَّلًا، لا عطبُ ‎=‎ مكانَ
            // ‎+=‎. وكان يُبلَّغ عنه، واقتراحُ إصلاحِه ‎x += x + 1‎ — وهو يُضاعف.
            // فيُستثنى الطرفُ الأيمنُ الذي يبدأ بالمتغيّرِ نفسِه. والعطبُ
            // المقصود (‎total = it.price‎) طرفُه الأيمنُ شيءٌ آخرُ فيبقى.
            const _self = new RegExp('\\b'+_esc+'\\s*=(?!=)\\s*\\$?'+_esc+'\\b');
            if (_p.test(_t) && !_self.test(_t) && !/(?:let|var|const)\s+/.test(_t)) {
                const _known = _declaredVars2.has(_v) ||
                    _lines2.slice(0,_i).some(_l=>new RegExp('\\b'+_esc+'\\s*=\\s*0').test(_l));
                if (_known) {
                    // نفس السطر فقط، وبأي عنوان تراكم — بدل مطابقة اسم جزئية
                    const _dup = issues.some(_x=>_x.line===(_i+1) && /تراكم/.test(String(_x.title)));
                    if (!_dup) issues.push({type:'bug',sev:'c',
                        title:'خطأ تراكم: '+_v+' = بدل +=',
                        strategy:'ACCUMULATION',
                        line:_i+1,ev:_t,
                        fix:_t.replace(new RegExp('('+_esc+')\\s*=(?!=)'),'$1 +='),
                        conf:90,cIcon:'🟢',cAct:'خطأ تراكم مؤكد',
                        cEv:[_v+' مُهيَّأ بـ 0 قبل الحلقة']});
                }
            }
        });
    });

    // ملاحظة: نداءا detectSecrets و analyzePHP المكرران أُزيلا — النداء الأول
    // أعلاه يغطيهما بالكامل (كان كل واحد يمسح الملف مرة ثانية ثم يُلغى بالـdedup).

    // Dart/Flutter Analysis
    if (ext === 'dart' && typeof analyzeDart === 'function') {
        runEngine('analyzeDart', () => analyzeDart(code, fileName), 'lang:dart').forEach(i => {
            if (!issues.some(x => x.line === i.line && x.title === i.title))
                issues.push(i);
        });
    }

    // C# / Unity Analysis
    if (ext === 'cs' && typeof analyzeCSharp === 'function') {
        runEngine('analyzeCSharp', () => analyzeCSharp(code, fileName), 'lang:cs').forEach(i => {
            if (!issues.some(x => x.line === i.line && x.title === i.title))
                issues.push(i);
        });
    }

        // AST Deep Analysis (JS only)
    if (['js','ts','jsx','tsx'].includes(ext)) {
        if (typeof analyzeJSWithAST === 'function') {
            runEngine('analyzeJSWithAST', () => analyzeJSWithAST(code, fileName), 'ast').forEach(i => {
                if (!issues.some(x => x.line === i.line && x.title === i.title))
                    issues.push(i);
            });
        }
    }

        // Deep Analysis (Type Inference + Data Flow + Call Graph + Scope)
    if (typeof deepAnalyze === 'function') {
        runEngine('deepAnalyze', () => deepAnalyze(code, fileName), 'deep').forEach(i => {
            if (!issues.some(x => x.line === i.line && x.title === i.title))
                issues.push(i);
        });
    }

        // var usage detection
    if (['js','ts','jsx','tsx'].includes(ext)) {
        code.split('\n').forEach((line, i) => {
            if (lineIsNoise(i)) return;
            if (/^\s*var\s+\w+/.test(line) && !line.trim().startsWith('//')) {
                issues.push({ type:'js', sev:'l', line:i+1, ev:line.trim(),
                    title:'🔵 استخدام var — استخدم let أو const',
                    fix: line.replace(/\bvar\b/, 'let').trim(),
                    conf:90, cIcon:'🔵', cAct:'VAR_USAGE' });
            }
        });
    }

    // String vs Number comparison
    if (['js','ts','jsx','tsx'].includes(ext)) {
        code.split('\n').forEach((line, i) => {
            if (lineIsNoise(i)) return;
            if (/===\s*["']\d+["']|!==\s*["']\d+["']/.test(line) && !line.trim().startsWith('//')) {
                issues.push({ type:'js', sev:'m', line:i+1, ev:line.trim(),
                    title:'🟡 مقارنة رقم مع string — استخدم === بدون quotes',
                    fix: line.replace(/===\s*["'](\d+)["']/g, '=== $1').replace(/!==\s*["'](\d+)["']/g, '!== $1').trim(),
                    conf:88, cIcon:'🟡', cAct:'Type Coercion' });
            }
        });
    }

        // Callback Hell Detection
        if (['js','ts','jsx','tsx'].includes(ext)) {
            // العدّاد القديم كان ينقص فقط عند "})" فلا يُغلق أبداً عند "};"
            // فتُحسب دوال متتالية غير متداخلة كأنها تداخل. الآن العمق من الأقواس.
            const cbStack = [];
            let cbDepth = 0, cbMax = 0, cbStart = 0;
            code.split('\n').forEach((line, i) => {
                if (lineIsNoise(i)) return;
                const clean = maskLiterals(line, false);
                if (/function\s*\(|=>\s*\{/.test(clean)) {
                    if (!cbStack.length) cbStart = i + 1;
                    cbStack.push(cbDepth);
                    if (cbStack.length > cbMax) cbMax = cbStack.length;
                }
                cbDepth += (clean.match(/\{/g) ?? []).length - (clean.match(/\}/g) ?? []).length;
                while (cbStack.length && cbDepth <= cbStack[cbStack.length - 1]) cbStack.pop();
            });
            if (cbMax >= 3) {
                issues.push({ type:'js', sev:'h', line:cbStart, ev:'Nested callbacks',
                    title:'🟠 Callback Hell — تداخل ' + cbMax + ' مستويات',
                    fix:'async/await', conf:85, cIcon:'🟠', cAct:'Callback Hell' });
            }
        }


    // TypeScript any detection
    if (['ts','tsx'].includes(ext)) {
        code.split('\n').forEach((line, i) => {
            if (lineIsNoise(i)) return;
            if (/:\s*any\b/.test(line) && !line.trim().startsWith('//')) {
                issues.push({ type:'ts', sev:'m', line:i+1, ev:line.trim(),
                    title:'🟡 TypeScript any — استخدم unknown أو type محدد',
                    fix: null, aiRequired: true,
                    fixHint: 'unknown يتطلب narrowing عند كل استخدام — التحويل الأعمى يكسر الترجمة.',
                    conf:85, cIcon:'🟡', cAct:'TypeScript Safety' });
            }
        });
    }



    // SQL Injection JS — يدعم quotes مضمّنة
    if (['js','ts','jsx','tsx'].includes(ext)) {
        code.split('\n').forEach((line, i) => {
            if (lineIsNoise(i) || line.trim().startsWith('//')) return;
            // SELECT + concatenation بأي شكل
            if (/["'].*(?:SELECT|INSERT|UPDATE|DELETE).*["']/.test(line) && /\+\s*\w+|\w+\s*\+/.test(line)) {
                issues.push({ type:'js', sev:'c', line:i+1, ev:line.trim(),
                    title:'🔴 SQL Injection — String Concatenation في JS',
                    fix: null, aiRequired: true,
                    fixHint: 'يحتاج parameterization بحسب driver قاعدة البيانات (؟ أو $n) — ' +
                             'الإصلاح السابق كان نسخة من السطر المصاب نفسه.',
                    conf:90, cIcon:'🔴', cAct:'CWE-89 SQL Injection' });
            }
        });
    }

    // eval() detection
    if (['js','ts','jsx','tsx'].includes(ext)) {
        code.split('\n').forEach((line, i) => {
            if (lineIsNoise(i)) return;
            if (/\beval\s*\(/.test(line) && !line.trim().startsWith('//')) {
                const m = line.match(/eval\s*\(([^)]+)\)/);
                const arg = m ? m[1].trim() : 'input';
                issues.push({ type:'js', sev:'c', line:i+1, ev:line.trim(),
                    title:'🔴 eval() خطير — تنفيذ كود مباشر',
                    fix: null, aiRequired: true,
                    fixHint: 'لا يوجد بديل يحفظ الدلالة: JSON.parse يفترض أن ' + arg +
                             ' نص JSON، واستبدال السطر بتعليق يُسقط الإسناد نفسه.',
                    conf:95, cIcon:'🔴', cAct:'CWE-94 Code Injection' });
            }
        });
    }

    // db.query بدون params array
    if (['js','ts'].includes(ext)) {
        code.split('\n').forEach((line, i) => {
            if (lineIsNoise(i)) return;
            if (/(?:db|conn|pool)\.query\s*\(\s*\w+\s*,\s*function/.test(line) && !/\[/.test(line.split(',')[1] || '')) {
                issues.push({ type:'js', sev:'h', line:i+1, ev:line.trim(),
                    title:'🟠 db.query ناقص params array',
                    fix: null, aiRequired: true,
                    fixHint: 'مصفوفة الـparams يجب أن تُملأ بالقيم الفعلية — [/* params */] تترك الكود غير عامل.',
                    conf:85, cIcon:'🟠', cAct:'SQL Missing Params' });
            }
        });
    }

    // XSS في res.send
    if (['js','ts'].includes(ext)) {
        code.split('\n').forEach((line, i) => {
            if (lineIsNoise(i)) return;
            if (/res\.send\s*\(.*\+/.test(line) && !line.trim().startsWith('//')) {
                issues.push({ type:'js', sev:'c', line:i+1, ev:line.trim(),
                    title:'🔴 XSS في res.send — user input مباشر',
                    fix: null, aiRequired: true,
                    fixHint: 'res.json يغيّر نوع الاستجابة وشكلها (كسر عقد الـAPI) ولا يُرمِّز المخرج؛ ' +
                             'الإصلاح الصحيح هو escape للمخرج مع إبقاء res.send.',
                    conf:88, cIcon:'🔴', cAct:'CWE-79 XSS' });
            }
        });
    }

    // Python cursor.execute params mismatch
    if (ext === 'py') {
        let lastQuery = null;
        code.split('\n').forEach((line, i) => {
            // تتبع query = "SELECT...?"
            const qM = line.match(/\b(\w+)\s*=\s*["']([^"']*)["']\s*$/);
            if (qM && /(?:SELECT|INSERT|UPDATE|DELETE)/i.test(qM[2])) {
                // [PY-PLACEHOLDER] ‎?‎ ليس الشكلَ الوحيد: DB-API يُعرّف
                // paramstyle، وpsycopg2/MySQLdb يستخدمان ‎%s‎، وoracledb
                // وsqlite يقبلان ‎:name‎. فعدُّ ‎?‎ وحده يجعل
                //     q = "SELECT * FROM t WHERE id=%s"
                //     cursor.execute(q, (u,))
                // «عدم تطابق: 0 ? مقابل معامل واحد» — وهو الشكلُ الصحيح
                // نفسه. والبلاغ الزائف يمنع قبول إصلاحٍ سليم في البوابة.
                const qCount = (qM[2].match(/\?|%[sdf]\b|%\(\w+\)s|:\w+/g) || []).length;
                lastQuery = { varName: qM[1], count: qCount, line: i };
            }
            // تحقق cursor.execute(query, (params,))
            const exM = line.match(/cursor\.execute\s*\(\s*(\w+)\s*,\s*\(([^)]+)\)\s*\)/);
            if (exM && lastQuery && exM[1] === lastQuery.varName) {
                const params = exM[2].split(',').filter(p => p.trim()).length;
                if (params !== lastQuery.count) {
                    issues.push({ type:'py', sev:'c', line:i+1, ev:line.trim(),
                        title:`🔴 SQL params mismatch: query فيه ${lastQuery.count} ? لكن execute يمرر ${params}`,
                        fix: line.trim(), conf:90, cIcon:'🔴', cAct:'SQL Params Mismatch' });
                }
            }
        });
    }

    // db.query("SELECT...?") بدون params array
    if (['js','ts'].includes(ext)) {
        code.split('\n').forEach((line, i) => {
            if (lineIsNoise(i)) return;
            if (!/db\.query|pool\.query|conn\.query/.test(line)) return;
            const hasQuestion = /\?/.test(line);
            const hasArray = /\[/.test(line);
            const hasCallback = /function|=>/.test(line);
            if (hasQuestion && !hasArray && hasCallback) {
                issues.push({ type:'js', sev:'c', line:i+1, ev:line.trim(),
                    title:'🔴 db.query فيه ? بدون params array',
                    fix: null, aiRequired: true,
                    fixHint: 'مصفوفة الـparams يجب أن تُملأ بالقيم الفعلية — [/* params */] تترك الكود غير عامل.',
                    conf:88, cIcon:'🔴', cAct:'SQL Missing Params' });
            }
        });
    }

    // JWT weak secret
    if (['js','ts'].includes(ext)) {
        code.split('\n').forEach((line, i) => {
            if (lineIsNoise(i)) return;
            if (/(?:JWT_SECRET|jwtSecret|JWT_KEY)\s*=\s*["'][^"']{4,}["']/.test(line)) {
                const jwtVar  = (line.match(/(JWT_SECRET|jwtSecret|JWT_KEY)/) || [])[1] || 'JWT_SECRET';
                const jwtEnv  = jwtVar.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
                issues.push({ type:'js', sev:'h', line:i+1, ev:line.trim(),
                    title:'🟠 JWT Secret مكشوف — استخدم process.env',
                    fix: line.replace(/=\s*["'][^"']+["']/, '= process.env.' + jwtEnv).trim(),
                    conf:90, cIcon:'🟠', cAct:'CWE-798 JWT' });
            }
        });
    }

        // Taint Analysis
    const ext3 = ext;
    if ((ext3 === 'js' || ext3 === 'ts') && typeof analyzeTaintJS === 'function') {
        runEngine('analyzeTaintJS', () => analyzeTaintJS(code, fileName), 'taint:js').forEach(i => {
            if (!issues.some(x => x.line === i.line && x.title === i.title)) issues.push(i);
        });
    }
    if (ext3 === 'py' && typeof analyzeTaintPY === 'function') {
        runEngine('analyzeTaintPY', () => analyzeTaintPY(code, fileName), 'taint:py').forEach(i => {
            if (!issues.some(x => x.line === i.line && x.title === i.title)) issues.push(i);
        });
    }
    if (ext3 === 'php' && typeof analyzeTaintPHP === 'function') {
        runEngine('analyzeTaintPHP', () => analyzeTaintPHP(code, fileName), 'taint:php').forEach(i => {
            if (!issues.some(x => x.line === i.line && x.title === i.title)) issues.push(i);
        });
    }

  // ملاحظة: النداء الثاني لـ deepAnalyze أُزيل — النداء الأول أعلاه يغطيه.

  // SmartContext — يدرس الكود قبل التحليل
  if (typeof SmartContext !== 'undefined' && SmartContext && typeof SmartContext.analyze === 'function') {
    runEngine('SmartContext', () => SmartContext.analyze(code, fileName), 'context').forEach(i => {
      if (!issues.some(x => x.line === i.line && x.title === i.title)) issues.push(i);
    });
  }

  // SemanticLayer — فهم النية والسياق
  if (typeof SemanticLayer !== 'undefined' && SemanticLayer && typeof SemanticLayer.analyze === 'function') {
    runEngine('SemanticLayer', () => SemanticLayer.analyze(code, fileName), 'semantic').forEach(i => {
      if (!issues.some(x => x.line === i.line && x.title === i.title)) issues.push(i);
    });
  }

  // ProjectIntelligence — فهم السياق الكامل
  if (typeof analyzeProject !== 'undefined') {
    runEngine('analyzeProject', () => analyzeProject(code, fileName, issues), 'project').forEach(i => {
      if (!issues.some(x => x.line === i.line && x.title === i.title)) issues.push(i);
    });
  }

  // ExtendedPatterns Analysis
  if (typeof ExtendedPatterns !== 'undefined' && ExtendedPatterns && typeof ExtendedPatterns.analyze === 'function') {
    runEngine('ExtendedPatterns', () => ExtendedPatterns.analyze(code, fileName), 'extended').forEach(i => {
      if (!issues.some(x => x.line === i.line && x.title === i.title)) issues.push(i);
    });
  }

  // CVEPatterns Analysis
  if (typeof CVEPatterns !== 'undefined' && CVEPatterns && typeof CVEPatterns.analyze === 'function') {
    runEngine('CVEPatterns', () => CVEPatterns.analyze(code, fileName), 'cve').forEach(i => {
      const key = `${i.line}:${i.cwe||i.type}`;
      if (!issues.some(x => `${x.line}:${x.cwe||x.type}` === key)) issues.push(i);
    });
  }

  // KnowledgeBase Analysis
  if (typeof KnowledgeBase !== 'undefined' && KnowledgeBase && typeof KnowledgeBase.analyze === 'function') {
    runEngine('KnowledgeBase', () => KnowledgeBase.analyze(code, fileName), 'knowledge').forEach(i => {
      if (!issues.some(x => x.line === i.line && x.title === i.title)) issues.push(i);
    });
  }

  // كل ثغرة — مهما تأخّر المحرك الذي أضافها — تحصل على conf/cIcon/cAct/cEv
  finalizeIssues(issues, code);

  // Final dedup — بمفتاح نوع الثغرة لا لغة الملف
  // (و‎[LOG-REDACTED]‎ قبله: سطرٌ نُقِّح ولا يُسجّل شيئًا ديناميًّا لا يُبلَّغ
  //  عنه تسريبًا — انظر التعليق عند ‎dropRedactedLogFindings‎.)
  return dedupeIssues(dropRedactedLogFindings(issues, code));
}

// ═══════════════════════════════════════════════════════
// Python Security Analyzer
// ═══════════════════════════════════════════════════════

function analyzePythonSecurity(code, issues) {
    const lines = code.split('\n');
    lines.forEach((line, i) => {
        const t = line.trim();
        const ln = i + 1;
        if (t.startsWith('#')) return;

        // Command Injection
        if (/os\.system\s*\(/.test(t)) {
            const m = t.match(/os\.system\s*\((.+)\)/);
            const arg = m ? m[1] : 'cmd';
            issues.push({ type:'py', sev:'c', line:ln, ev:t,
                title:'🔴 Command Injection Python — os.system خطير',
                fix: null, aiRequired: true,
                fixHint: 'subprocess.run يتطلب import إضافي وقائمة argv؛ و shlex.split على نص مدموج ' +
                         'لا يمنع حقن الوسائط ويغيّر دلالة القيمة المرجعة.',
                conf:92, cIcon:'🔴', cAct:'CWE-78 Command Injection' });
        }

        // Hardcoded secrets
        if (/^[A-Z_]+(KEY|SECRET|TOKEN|PASSWORD|PASS|PWD)\s*=\s*["'][^"']{6,}["']/i.test(t)) {
            issues.push({ type:'py', sev:'c', line:ln, ev:t,
                title:'🔐 ' + (t.match(/^(\w+)/)?.[1] || 'Secret') + ' مكشوف في الكود',
                strategy:'HARDCODED_SECRET',
                fix: t.replace(/["'][^"']+["']/, "os.environ.get('" + (t.match(/^(\w+)/)?.[1] || 'SECRET') + "', '')"),
                fixHint: 'يتطلب import os في الملف — محرك الإصلاح يضيفه، والتطبيق اليدوي يجب أن يضيفه.',
                conf:92, cIcon:'🔐', cAct:'CWE-798' });
        }

        // SQL Injection في Python
        if (/["']\s*SELECT.*["']\s*\+/.test(t) || /["']\s*INSERT.*["']\s*\+/.test(t) ||
            /["']\s*UPDATE.*["']\s*\+/.test(t) || /["']\s*DELETE.*["']\s*\+/.test(t)) {
            issues.push({ type:'py', sev:'c', line:ln, ev:t,
                title:'🔴 SQL Injection — String Concatenation في Python',
                fix: null, aiRequired: true,
                fixHint: 'يحتاج cursor.execute(query, params) بحسب الـdriver؛ إدراج # داخل التعبير يكسر الصياغة.',
                conf:90, cIcon:'🔴', cAct:'CWE-89' });
        }

        // MD5 في Python
        if (/hashlib\s*\.\s*md5\s*\(/.test(t) || /hashlib\s*\.\s*sha1\s*\(/.test(t)) {
            issues.push({ type:'py', sev:'h', line:ln, ev:t,
                title:'🟠 MD5/SHA1 ضعيف — استخدم SHA256',
                fix: null, aiRequired: true,
                fixHint: 'SHA256 ليس بديلاً عاماً: كلمات المرور تحتاج bcrypt/argon2، ' +
                         'وchecksum أو توافق بروتوكول قد ينكسر بالاستبدال.',
                conf:90, cIcon:'🟠', cAct:'CWE-327' });
        }

        // Accumulation في Python
        if (/^\s*(\w+)\s*=\s*\w+\[["']\w+["']\]\s*$/.test(line)) {
            const prevCode = lines.slice(Math.max(0,i-8),i).join('\n');
            if (/for\s+\w+\s+in/.test(prevCode)) {
                const m = line.match(/(\w+)\s*=\s*(\w+\[["']\w+["']\])/);
                if (m) {
                    issues.push({ type:'py', sev:'h', line:ln, ev:t,
                        title:'🟠 خطأ تراكم: ' + m[1] + ' = بدل +=',
                        strategy:'ACCUMULATION',
                        fix: line.replace(/(\w+)\s*=\s*/, '$1 += '),
                        conf:85, cIcon:'🟠', cAct:'Accumulation Error' });
                }
            }
        }
    });
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
                // [NO-DOUBLE] ‎x = x + 1‎ تراكمٌ مكتوبٌ مطوَّلًا، لا عطبُ ‎=‎ مكانَ
                // ‎+=‎. وبناءُ الاقتراحِ هنا ينقل الطرفَ الأيمنَ كما هو، فينتج
                // ‎count += count + 1‎ — ويُضاعف. مقيسٌ بتنفيذِ بايثون:
                // ‎f([1..5])‎ كان 5 فصار 31، والبوابةُ قبلته لأن عدَّ البلاغاتِ
                // نقص. فلا بلاغَ أصلًا حيث الطرفُ الأيمنُ يبدأ بالمتغيّرِ نفسِه.
                const selfRe = new RegExp('^\\s*' + escapeRegex(varName) +
                                          '\\s*=\\s*' + escapeRegex(varName) + '\\b');
                if (zeroRe.test(code) && !selfRe.test(t)) {
                    const fix = line.replace(/^(\s*)(\w+)\s*=\s*(.+)/, '$1$2 += $3').trim();
                    issues.push({ type:'bug', sev:'c', title:'خطأ في التراكم: = بدل +=', line:i+1, ev:t, fix });
                }
            }
        }

        // == None / != None
        if (PATTERNS.pyNoneCompare.test(line)) {
            issues.push({
                type:'bug', sev:'m', title:'قارن بـ is None', line:i+1, ev:t,
                fix: t.replace(/!=\s*None/g, 'is not None').replace(/==\s*None/g, 'is None'),
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
    // HTML: نُبقي أجسام <script> فقط ونستبدل الباقي بفراغات — عدد الأسطر يبقى
    // كما هو فتظل أرقام الأسطر مطابقة للملف الأصلي (الدمج القديم كان يزيحها).
    const work = (ext === 'html') ? htmlScriptOnly(code) : code;

    const lines  = work.split('\n');
    const noise  = maskedLines(work);

    // Stack-based loop tracking بدل flag واحد
    // نعدّ depth الـ braces — لو دخلنا loop نسجّل depth
    let braceDepth  = 0;
    const loopDepths = []; // depths عند دخول loops

    lines.forEach((line, i) => {
        const t = line.trim();
        if (!t || t.startsWith('//') || noise[i] === 1) return;
        const clean = maskLiterals(line, false);

        const openBraces  = (clean.match(/\{/g)  ?? []).length;
        const closeBraces = (clean.match(/\}/g)  ?? []).length;

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
        // [NO-DOUBLE] نفسُ الحارسِ هنا: الطرفُ الأيمنُ الذي يبدأ بالمتغيّرِ
        // نفسِه تراكمٌ قائمٌ، واقتراحُ ‎+=‎ عليه يُضاعف.
        const _selfAcc = /^\s*(\w+)\s*=\s*\1\b/.test(line.replace(/^\s+/, ' '));
        if (inLoop
            && PATTERNS.jsAccum.test(line)
            && !_selfAcc
            && !/==/.test(line)
            && !/^\s*(let|var|const)\s+/.test(line)) {
            const fix = line.replace(/(\s*)(\w+)\s*=\s*(.+)/, '$1$2 += $3').trim();
            issues.push({ type:'bug', sev:'c', title:'خطأ في التراكم: = بدل +=', line:i+1, ev:t, fix });
        }

        // == بدل === — يُقرأ من السطر بعد إخفاء السلاسل والتعليقات
        if (PATTERNS.jsLooseEq.test(clean) && /if\s*\(/.test(clean)) {
            issues.push({
                type:'bug', sev:'m', title:'استخدم ===', line:i+1, ev:t,
                fix: t.replace(/([^=!<>])==([^=])/g, '$1===$2'),
            });
        }
    });
}

/** تحقق من وجود return داخل forEach body */
function checkForEachReturn(lines, startIdx) {
    const startLine = lines[startIdx] || '';
    // لو الـ forEach كامل في سطر واحد - ما في return داخله
    if (/\.forEach\s*\([^)]*\)\s*\{[^}]*\}/.test(startLine)) return false;
    // لو الـ forEach يفتح { في نفس السطر
    const openInStart = (startLine.match(/\{/g) ?? []).length;
    const closeInStart = (startLine.match(/\}/g) ?? []).length;
    let depth = openInStart - closeInStart;
    if (depth <= 0) return false; // forEach مغلق في نفس السطر
    for (let j = startIdx + 1; j < Math.min(startIdx + 20, lines.length); j++) {
        const jt = lines[j].trim();
        depth += (lines[j].match(/\{/g) ?? []).length - (lines[j].match(/\}/g) ?? []).length;
        if (depth <= 0) break; // خرجنا من forEach
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

    // "discount" يحتوي "count" — بلا هذا الاستثناء يُرجَع len() لدالة خصم
    if (n.includes('count') && !n.includes('discount')) {
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
            // اقتراح مبني على اسم الدالة ومفاتيح مُستنتَجة — ليس إصلاحاً مُتحقَّقاً
            issue.fix        = fix;
            issue.suggestion = true;
            issue.aiRequired = true;
            issue.fixHint    = 'اقتراح من اسم الدالة ومفاتيح مُستنتَجة من الكود — يجب مراجعته قبل التطبيق.';
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

// ─── [LOG-REDACTED] السطرُ المُنقَّح لا يُبلَّغ عنه تسريبًا ───────────────
//
// أربعةُ كاشفاتٍ تُطابق الكلمةَ الحسّاسة في **سطرِ** نداء اللوج كلِّه
// (‎cve_patterns‎ مرّتين، و‎extended_patterns‎، و‎security_scanner‎)، فتُطابقها
// داخلَ نصِّ الرسالة لا في القيمة المُسجَّلة وحدها. ونصُّ الرسالة هو عنوانُ
// السرّ لا السرُّ، والتنقيحُ لا يملك أن يحذفه.
//
// والمقيس أن ذلك يُجمّد الإصلاح كاملًا:
//
//     console.log("password:", password)      ⇒ 6 بلاغات
//     console.log("password:", "[REDACTED]")  ⇒ 6 بلاغات   (نفسُها)
//
// فتحكم البوابةُ ‎REJECTED_NO_IMPROVEMENT‎ ثم تُلغي Ghost الدفعةَ كاملةً،
// فيُفقد تنقيحٌ صحيحٌ أزال التسريبَ فعلًا. ومقيسًا على ستّة أشكال: الكلمةُ
// خارجَ نصِّ الرسالة ⇒ يُقبل 3 من 3؛ وداخلَه ⇒ يُحجب 3 من 3.
//
// والحدُّ هنا أضيقُ ما يكفي، فلا يُضعِف اكتشافًا: لا يُكتَم بلاغٌ إلا على
// سطرٍ يحمل عَلَمَ التنقيح ‎[REDACTED]‎ **ولا تبقى فيه وسيطةٌ ديناميّة**، أي
// لا يُسجَّل فيه شيءٌ وقتَ التشغيل إطلاقًا. وما عداه يبقى مُبلَّغًا عنه —
// مقيسًا على ثماني حالات، بلا خطأٍ واحد:
//
//     console.log("password:", userInput)     ⇒ يبقى (وسيطةٌ ديناميّة)
//     console.log("[REDACTED]", realToken)    ⇒ يبقى (وسيطةٌ ديناميّة)
//     console.log("your password is 12345")   ⇒ يبقى (لا عَلَمَ تنقيح)
//
// وآخرُها مقصود: السرُّ الحرفيُّ داخل الرسالة لا يكشفه كاشفٌ آخر (قِيس)،
// فلا يُكتَم.
const LOG_LEAK_TYPE_RX  = /DATA_EXPOSURE|CWE_312|CWE_532/;
const LOG_LEAK_TITLE_RX = /Sensitive Data in (?:Console )?Log|Sensitive Data Logged|تسجيل بيانات حساسة/;
const LOG_CALL_ARGS_RX  = /(?:console\.(?:log|error|warn|info|debug)|print|logging\.\w+|Log\.\w+)\s*\(([^)]*)\)/;

// هل كلُّ ما يُسجَّل في هذا السطر نصوصٌ حرفية؟ (أي لا شيءَ ديناميّ)
function logArgsAllLiteral(line) {
    const m = String(line).match(LOG_CALL_ARGS_RX);
    if (!m) return false;
    const s = m[1];
    const dynamic = [];
    let i = 0, buf = '';
    while (i < s.length) {
        const c = s[i];
        if (c === '"' || c === "'" || c === '`') {
            if (buf) { dynamic.push(buf); buf = ''; }
            let j = i + 1;
            while (j < s.length) {
                if (s[j] === '\\') { j += 2; continue; }
                if (s[j] === c) { j++; break; }
                j++;
            }
            i = j;
            continue;
        }
        buf += c;
        i++;
    }
    if (buf) dynamic.push(buf);
    // ما بين النصوص الحرفية فواصلُ ومعاملاتُ ضمٍّ فقط ⇒ لا وسيطةَ ديناميّة
    return dynamic.join('').replace(/[\s+,.]/g, '').length === 0;
}

function dropRedactedLogFindings(issues, code) {
    if (!Array.isArray(issues) || !issues.length) return issues;
    const lines = String(code == null ? '' : code).split('\n');
    return issues.filter(iss => {
        if (!iss) return true;
        const tag = String(iss.type || '') + ' ' + String(iss.title || '');
        if (!LOG_LEAK_TYPE_RX.test(tag) && !LOG_LEAK_TITLE_RX.test(tag)) return true;
        const line = lines[(Number(iss.line) || 0) - 1];
        if (!line || line.indexOf('[REDACTED]') === -1) return true;   // fail-open
        return !logArgsAllLiteral(line);
    });
}

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
