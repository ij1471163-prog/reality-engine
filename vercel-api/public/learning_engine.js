// ═══════════════════════════════════════════════════════
// learning_engine.js v2.1 — Evidence-based Learning
// يتعلم فقط من إصلاحات تحقق منها Ghost Mode
// ═══════════════════════════════════════════════════════
"use strict";

var LearningEngine = (() => {

  const STORAGE_KEY = 're_learned_patterns_v2';

  const THRESHOLDS = {
    MIN_VERIFIED:   2,     // أدنى تحققات قبل الموافقة
    MIN_CONFIDENCE: 0.20,  // أدنى confidence
    MAX_CONFIDENCE: 0.97,  // حد أقصى
    DECAY_ON_FAIL:  0.15,  // خفض confidence عند الفشل
  };

  // Evidence curve — verified فقط ترفع confidence
  function calcConfidence(verified, failures) {
    if (verified < THRESHOLDS.MIN_VERIFIED) return 0;
    const total = verified + failures;
    const successRate = verified / total;

    let base;
    if (verified >= 50) base = 0.95;
    else if (verified >= 20) base = 0.90;
    else if (verified >= 10) base = 0.80;
    else if (verified >= 5)  base = 0.70;
    else                      base = 0.60;

    return Math.min(THRESHOLDS.MAX_CONFIDENCE, base * successRate);
  }

  // ─── Storage ────────────────────────────────────────
  function load() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : { patterns: [], safe: [], meta: { total: 0 } };
    } catch(e) {
      return { patterns: [], safe: [], meta: { total: 0 } };
    }
  }

  function save(db) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch(e) {}
  }

  // ─── Safe Whitelist ─────────────────────────────────
  const SAFE_SIGNATURES = [
    /process\.env\.\w+/,
    /os\.environ(?:\.get)?\s*\(/,
    /getenv\s*\(/,
    /\.textContent\s*=/,
    /htmlspecialchars/,
    /execFile\s*\(/,
    /sha256|bcrypt|argon2/i,
    /\?\s*\]/,
    /expiresIn/,
    /\.catch\s*\(/,
    /req\.user/,
    /res\.status\(401\)/,
  ];

  function isSafe(line) {
    return SAFE_SIGNATURES.some(p => p.test(line));
  }

  // ─── LCS Diff (blocks) ─────────────────────────────
  function lcsBlocks(before, after) {
    const n = before.length, m = after.length;
    const dp = Array.from({length: n+1}, () => new Array(m+1).fill(0));
    for (let i = 1; i <= n; i++)
      for (let j = 1; j <= m; j++)
        dp[i][j] = before[i-1] === after[j-1]
          ? dp[i-1][j-1]+1
          : Math.max(dp[i-1][j], dp[i][j-1]);

    const ops = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && before[i-1] === after[j-1]) {
        ops.unshift({ type:'eq', bi:i-1, ai:j-1 }); i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
        ops.unshift({ type:'add', ai:j-1, line:after[j-1] }); j--;
      } else {
        ops.unshift({ type:'del', bi:i-1, line:before[i-1] }); i--;
      }
    }

    const blocks = [];
    let cur = null;
    for (const op of ops) {
      if (op.type === 'eq') { cur = null; continue; }
      if (!cur) { cur = { removed:[], added:[] }; blocks.push(cur); }
      if (op.type === 'del') cur.removed.push({ idx:op.bi, line:op.line });
      if (op.type === 'add') cur.added.push({ idx:op.ai, line:op.line });
    }
    return blocks;
  }

  // ─── Language Inference ─────────────────────────────
  function inferLanguage(fileName) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    const map = { js:'js', ts:'ts', py:'py', php:'php', java:'java', html:'html', css:'css', rb:'ruby', go:'go', cs:'csharp' };
    return map[ext] || 'unknown';
  }

  // ─── Context Extraction ──────────────────────────────
  function extractContext(code, lineIdx) {
    const lines = code.split('\n');
    const line = lines[lineIdx] || '';

    // ابحث عن اسم الدالة المحيطة
    let functionName = null;
    for (let i = lineIdx; i >= 0; i--) {
      const m = lines[i].match(/(?:function|def|public|private|async)\s+(\w+)\s*\(/);
      if (m) { functionName = m[1]; break; }
    }

    // scope
    const scope = line.includes('class ') ? 'class'
      : functionName ? 'function'
      : 'module';

    return { functionName: functionName || null, scope };
  }

  // ─── Fingerprint ─────────────────────────────────────
  function makeFingerprint(type, language, before, context) {
    // normalize before — حذف مسافات زائدة وتوحيد
    const norm = (before || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const scope = context ? context.scope : 'global';
    const fn    = context ? (context.functionName || 'global') : 'global';
    const str   = `${type}|${language}|${norm}|${scope}:${fn}`;
    // simple hash بدون مكتبات خارجية
    let h = 0;
    for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    return Math.abs(h).toString(36);
  }

  // ─── Anchor Tokens ───────────────────────────────────
  // معرّفات السطر فقط — بدون القيم النصية ولا الكلمات المفتاحية
  function anchorTokens(line) {
    const KEYWORDS = new Set([
      'const','let','var','function','def','return','new','this','self','class',
      'public','private','protected','static','final','import','from','require',
      'if','else','for','while','try','catch','async','await',
    ]);
    const noStrings = (line || '').replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, ' ');
    const words = noStrings.match(/[A-Za-z_$][\w$]*/g) || [];
    return [...new Set(words.filter(w => !KEYWORDS.has(w)))];
  }

  // ─── Assignment Target ───────────────────────────────
  // هدف الإسناد في السطر: x أو obj.prop، ويشمل الإسناد المركّب (+=).
  // null يعني أن السطر ليس إسناداً (استدعاء أو تعبير).
  function assignTarget(line) {
    const m = (line || '').trim().match(
      /^(?:const|let|var)?\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?:\+|-|\*|\/|\|\||\?\?)?=(?!=)/);
    return m ? m[1] : null;
  }

  // هل يقابل سطر الإصلاح السطرَ الأصلي فعلاً؟
  // بلا هذا الفحص يُربط أول سطر يطابق نوع الثغرة بأي سطر أصلي، فيُخزَّن
  // زوج مثل: console.log(API_KEY);  →  const API_KEY = process.env.API_KEY;
  // وتطبيقه لاحقاً يحذف الاستدعاء ويضع مكانه تصريحاً.
  function corresponds(beforeLine, afterLine) {
    const bt = assignTarget(beforeLine);
    const at = assignTarget(afterLine);
    if (bt && at && bt === at) return true;   // إسناد لنفس الهدف ⇒ تقابل مؤكد
    // [FIX] كان الفحص اتجاهياً: ‎if (!bt && at)‎ يمنع "استدعاء ⇄ تصريح" ولا
    // يمنع العكس. فزوج مثل:
    //     const API_KEY = "sk_live_…";  →  sendKey(process.env.API_KEY);
    // يسقط إلى تقاطع المعرّفات ويمرّ لمجرد تقاسم API_KEY، فيُخزَّن ويُعتمد،
    // وتطبيقه يحذف التصريح ويضع مكانه استدعاءً فتصير بقية استعمالات الاسم
    // غير معرّفة. وهو ضرر من صنف ما أصلحه D2، في الاتجاه المعاكس، ومقيس
    // أنه يجتاز GhostMode و learnedSyntaxOk و FixVerifier كلها.
    // التناظر هو العقد المقصود: تغيّر شكل العبارة ⇒ ليسا متقابلين، أياً كان
    // الأصل. وما يبقى لتقاطع المعرّفات هو الحالتان المتماثلتان شكلاً:
    // إسنادان لهدفين مختلفين، أو سطران غير إسناديين.
    if (!bt !== !at) return false;            // أحدهما إسناد والآخر لا
    const anchors = anchorTokens(beforeLine);
    if (!anchors.length) return false;
    const tokens = new Set(anchorTokens(afterLine));
    return anchors.some(a => tokens.has(a));
  }

  // ─── Corresponding Candidate ─────────────────────────
  // يربط after بالسطر الأصلي نفسه — وليس بأول سطر يطابق نوع الثغرة
  function pickCorresponding(typed, hunk, beforeLine, removedRank) {
    if (!typed.length) return null;
    // بوابة أخيرة على كل المسارات: لا نقبل مرشحاً بلا دليل تقابل،
    // ولو كان المرشح الوحيد.
    const confirm = c => (c && corresponds(beforeLine, c.line)) ? c : null;
    if (typed.length === 1) return confirm(typed[0]);

    // 1) تطابق المعرّفات — الإشارة الأقوى، وتتطلب فائزاً واضحاً
    const anchors = anchorTokens(beforeLine);
    if (anchors.length) {
      const scored = typed
        .map(c => {
          const tokens = new Set(anchorTokens(c.line));
          return { c, score: anchors.filter(a => tokens.has(a)).length };
        })
        .sort((a, b) => b.score - a.score);

      if (scored[0].score > 0 && scored[0].score > (scored[1] ? scored[1].score : 0)) {
        return confirm(scored[0].c);
      }
    }

    // 2) تقابل موضعي — فقط إذا كان الـhunk استبدالاً 1:1 بلا إدراج
    if (removedRank >= 0 && hunk.removed.length === hunk.added.length) {
      const byPos = hunk.added[removedRank];
      if (byPos && typed.indexOf(byPos) !== -1) return confirm(byPos);
    }

    // 3) غير محسوم → Fail Closed: لا نتعلم زوجاً غير مؤكد
    return null;
  }


  // ─── Generalized Pattern Learning ───────────────────
  // يتعلم فكرة الإصلاح بدل نسخ السطر حرفياً.
  function generalizeLinePair(before, after) {
    if (!before || !after || before === after) return null;

    const identifierRe = /\b[A-Za-z_$][\w$]*\b/g;

    const KEYWORDS = new Set([
      'const','let','var','function','def','return','new','this','self',
      'class','public','private','protected','static','final','import',
      'from','require','if','else','for','while','try','catch',
      'async','await','true','false','null','undefined'
    ]);

    function maskStrings(source) {
      let out = '';
      let quote = null;
      let escaped = false;

      for (const ch of String(source)) {
        if (quote !== null) {
          out += ' ';

          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === quote) quote = null;

          continue;
        }

        if (ch === '"' || ch === "'" || ch === '`') {
          quote = ch;
          out += ' ';
        } else {
          out += ch;
        }
      }

      return out;
    }

    const stringRe = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

    // [FIX] لا يُجرَّد إلا ما لم يُغيّره الإصلاح.
    //
    // كانت كل نصوص ومعرّفات السطر تُبدَّل بخانات، بما فيها الرمزُ الذي
    // يُعرِّف الثغرة. فالقالب يفقد ما يميّز الشكل المعيب ويصير يطابق كوداً
    // سليماً. والمقيس على الأزواج الصحيحة الثلاثة المقصود تعلّمها:
    //   secret: const __ID_1__ = __STR_1__;  →  const __ID_1__ = process.env.__ID_1__;
    //     فيحوّل  const APP_NAME = "Reality Engine"  إلى process.env.APP_NAME
    //   md5:    const __ID_1__ = __ID_2__.__ID_3__(__STR_1__);  →  … ("sha256");
    //     فيحوّل  const p = path.join("config")  إلى  path.join("sha256")
    //   xss:    __ID_1__.__ID_2__ = __ID_3__.__ID_4__;  →  __ID_1__.textContent = …
    //     فيحوّل  cfg.timeout = opts.value  إلى  cfg.textContent = opts.value
    // والثلاثة تجتاز GhostMode و learnedSyntaxOk و FixVerifier معاً.
    //
    // الرمز الذي يغيّره الإصلاح هو إشارة الثغرة ("md5"، innerHTML، النص
    // السرّي)، فيبقى حرفياً في القالب فلا يطابق إلا الشكل المعيب. وما يبقى
    // قابلاً للتجريد هو سياق الإصلاح: ما ورد في الطرفين بلا تغيير.
    const afterStrings = new Set(String(after).match(stringRe) || []);
    const afterIds = new Set(
      maskStrings(after).match(/\b[A-Za-z_$][\w$]*\b/g) || []
    );

    const strings = [];
    const beforeWithStringSlots = before.replace(stringRe, value => {
      if (!afterStrings.has(value)) return value; // غيّره الإصلاح ⇒ إشارة
      const id = `STR_${strings.length + 1}`;
      strings.push({
        id,
        kind: 'string',
        value
      });
      return `__LEARN_${id}__`;
    });

    const afterWithStringSlots = after.replace(stringRe, value => {
      const found = strings.find(x => x.value === value);
      return found ? `__LEARN_${found.id}__` : value;
    });

    const placeholderRe = /__LEARN_STR_\d+__/g;
    const beforeForIds = maskStrings(
      beforeWithStringSlots.replace(placeholderRe, ' ')
    );

    const beforeIds = [];
    let m;

    while ((m = identifierRe.exec(beforeForIds)) !== null) {
      const id = m[0];

      // afterIds: المعرّف الذي لم يَرِد في طرف الإصلاح غيّره الإصلاح، فهو
      // إشارة الثغرة لا سياقها ⇒ يبقى حرفياً.
      if (!KEYWORDS.has(id) && !beforeIds.includes(id) && afterIds.has(id)) {
        beforeIds.push(id);
      }
    }

    // بلا رمز واحد قابل للتجريد لا تعميم — والتعلّم بالمطابقة الحرفية يبقى.
    if (!beforeIds.length) return null;

    const idSlots = beforeIds.map((value, i) => ({
      id: `ID_${i + 1}`,
      kind: 'identifier',
      value
    }));

    const slots = [...strings, ...idSlots];

    let beforeTemplate = beforeWithStringSlots;
    let afterTemplate = afterWithStringSlots;

    const sorted = [...beforeIds].sort((a, b) => b.length - a.length);

    for (const value of sorted) {
      const slot = idSlots.find(x => x.value === value);
      const escaped = value.replace(/[.*+?^$()[\]{}|\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`, 'g');

      beforeTemplate = beforeTemplate.replace(
        re,
        `__LEARN_${slot.id}__`
      );

      afterTemplate = afterTemplate.replace(
        re,
        `__LEARN_${slot.id}__`
      );
    }

    const fixedBefore = beforeTemplate
      .replace(/__LEARN_ID_\d+__/g, '')
      .replace(/\s+/g, '');

    if (fixedBefore.length < 3) return null;

    return {
      beforeTemplate: beforeTemplate.replace(/\s+/g, ' ').trim(),
      afterTemplate: afterTemplate.replace(/\s+/g, ' ').trim(),
      beforeSlots: slots,
      afterSlots: slots,
      sharedTokens: beforeIds.filter(id => after.includes(id))
    };
  }

  function isGeneralPatternUsable(pattern, language) {
    if (!pattern || !language || language === 'unknown') return false;
    if (!pattern.beforeTemplate || !pattern.afterTemplate) return false;
    if (!Array.isArray(pattern.beforeSlots)) return false;

    const count =
      (pattern.beforeTemplate.match(/__LEARN_ID_\d+__/g) || []).length;

    if (count > 8) return false;

    // [V4] ترتيب الخانات لا يُبدَّل بين الطرفين.
    // قالب يعيد ترتيب الخانات يُركِّب المعامِلات في مواضع غير مواضعها، فيغيّر
    // دلالة السطر مع ثبات هدف الإسناد — فلا يراه حرس الهدف ولا المرجع الخلفي.
    // والمقيس أن الأزواج الصحيحة الخمسة (secret / md5 / xss / sql parameterized /
    // ذاتي المرجع) تحفظ الترتيب كلها، فالشرط بلا تكلفة ويمنع التبديل.
    const seqOf = src => {
      const out = [];
      for (const tok of (src.match(/__LEARN_(?:ID|STR)_\d+__/g) || [])) {
        if (out.indexOf(tok) === -1) out.push(tok);
      }
      return out;
    };
    const beforeSeq = seqOf(pattern.beforeTemplate);
    const afterSeq  = seqOf(pattern.afterTemplate).filter(x => beforeSeq.indexOf(x) !== -1);
    let seqAt = 0;
    for (const tok of beforeSeq) if (afterSeq[seqAt] === tok) seqAt++;
    if (seqAt !== afterSeq.length) return false;

    const fixed = pattern.beforeTemplate
      .replace(/__LEARN_ID_\d+__/g, '')
      .replace(/\s+/g, '');

    return fixed.length >= 3;
  }

  // ─── Extract Pair (LCS + Fail Closed) ────────────────
  function extractPair(codeBefore, codeAfter, issue) {
    const linesBefore = codeBefore.split('\n');
    const linesAfter  = codeAfter.split('\n');
    const ln          = (issue.line || 1) - 1;
    const beforeLine  = linesBefore[ln]?.trim() || '';

    if (!beforeLine || isSafe(beforeLine)) return null;

    // LCS blocks
    const blocks = lcsBlocks(
      linesBefore.map(l => l.trim()),
      linesAfter.map(l => l.trim())
    );

    // الـ hunk اللي يحتوي issue line
    const hunk = blocks.find(b => b.removed.some(r => r.idx === ln));
    if (!hunk || !hunk.added.length) return null;

    const t = (issue.type || issue.cAct || '').toLowerCase();

    // TYPE_FIXES — ربط نوع الثغرة بـ regex الإصلاح
    const TYPE_FIXES = {
      secret:    /process\.env|os\.environ\.get|getenv/,
      hardcoded: /process\.env|os\.environ\.get|getenv/,
      cwe_798:   /process\.env|os\.environ\.get|getenv/,
      sql:       /\?|prepare|parameterized|db\.query/,
      cwe_89:    /\?|prepare|parameterized/,
      xss:       /textContent|htmlspecialchars|sanitize|DOMPurify/,
      crypto:    /sha256|bcrypt|argon2/,
      cwe_327:   /sha256|bcrypt|argon2/,
      eval:      /JSON\.parse|safeEval/,
      cwe_094:   /JSON\.parse|safeEval/,
      cmd:       /execFile|allowedCmds/,
      accumul:   /\+=/,
      counter:   /\+=/,
    };

    // Fail Closed: لو النوع غير معروف → رفض
    const knownType = Object.keys(TYPE_FIXES).some(k => t.includes(k));
    if (!knownType) return null;

    // فلتر candidates من نفس الـ hunk
    const candidates = hunk.added.filter(a => {
      const l = a.line;
      if (!l || l.length < 5) return false;
      if (/^\/\//.test(l)) return false;
      if (/^[{}();,#]$/.test(l)) return false;
      return true;
    });

    if (!candidates.length) return null;

    // اختر الـ candidate المقابل فعلياً للسطر الأصلي داخل نفس الـhunk
    const removedRank = hunk.removed.findIndex(r => r.idx === ln);

    let afterLine = '';
    for (const [key, regex] of Object.entries(TYPE_FIXES)) {
      if (!t.includes(key)) continue;
      const typed = candidates.filter(c => regex.test(c.line));
      const match = pickCorresponding(typed, hunk, beforeLine, removedRank);
      if (match) { afterLine = match.line; break; }
    }

    // Fail Closed: لو ما في match → رفض
    if (!afterLine || afterLine === beforeLine) return null;

    return {
      type:     issue.type || issue.cAct || 'unknown',
      severity: issue.sev  || 'c',
      before:   beforeLine,
      after:    afterLine,
    };
  }
  // ─── Validate Fix Before Learning ────────────────────
  // لا نخزّن after لا نستطيع إثبات سلامته. لا parser جديد:
  // isBalanced موجودة في analyzer.js:83 ويستخدمها المحلل لنفس الغرض
  // (analyzer.js:129)، وacorn محمّل أصلاً في الصفحة.
  function parsesAsJS(src) {
    for (const sourceType of ['module', 'script']) {
      try { acorn.parse(src, { ecmaVersion: 'latest', sourceType }); return true; }
      catch(e) {}
    }
    return false;
  }

  // التحقق على مستوى الزوج نفسه — لا على مستوى الملف، حتى لا يُرفض
  // نمط صحيح بسبب سطر مكسور آخر يحقنه محرك الإصلاح في مكان بعيد.
  function isPairUsable(pair, fileName) {
    // Fail Closed: بلا أداة تحقق متاحة لا نتعلم شيئاً
    if (typeof isBalanced !== 'function') return false;

    // 1) توازن الأقواس — لكل اللغات (JS/TS/Python/PHP).
    //    لا نحاسب سطراً كان أصلاً غير متوازن (سطر جزئي مثل "items.forEach(i => {")
    if (isBalanced(pair.before) && !isBalanced(pair.after)) return false;

    // 2) JS النقي فقط: تحقق نحوي بـacorn. لا يدعم TS/JSX فتُستثنى،
    //    ونحكم فقط إذا كان before سطراً مكتملاً يُحلَّل وحده — وإلا لا حكم.
    if (/\.(js|mjs|cjs)$/i.test(fileName || '')) {
      if (typeof acorn === 'undefined' || typeof acorn.parse !== 'function') return false;
      if (parsesAsJS(pair.before) && !parsesAsJS(pair.after)) return false;
    }

    return true;
  }

  // ─── Learn ──────────────────────────────────────────
  function learn(codeBefore, codeAfter, issues, fileName) {
    if (!codeBefore || !codeAfter || codeBefore === codeAfter) return 0;

    const db = load();
    const learnedIds = []; // IDs للـ patterns الجديدة أو الموجودة

    issues.forEach(issue => {
      const pair = extractPair(codeBefore, codeAfter, issue);
      if (!pair) return;
      // after مشوّه ⇒ لا يُخزَّن (لا نصلحه ولا نغيّره)
      if (!isPairUsable(pair, fileName)) return;

      // استخرج language + context + fingerprint أولاً
      const lang = inferLanguage(fileName);
      const ctx  = extractContext(codeBefore, (issue.line||1)-1);
      const fp   = makeFingerprint(pair.type, lang, pair.before, ctx);

      // مطابقة existing بـ type + language + fingerprint
      const existing = db.patterns.find(p =>
        p.type === pair.type &&
        p.language === lang &&
        p.fingerprint === fp
      );

      if (existing) {
        existing.observed = (existing.observed || 0) + 1;
        existing.lastSeen = Date.now();
        learnedIds.push(existing.id);
      } else {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
        db.patterns.push({
          id,
          type:        pair.type,
          severity:    pair.severity,
          before:      pair.before,
          after:       pair.after,
          language:    lang,
          context:     { functionName: ctx.functionName, scope: ctx.scope, fileName: fileName || '' },
          fingerprint: fp,
          fileName:    fileName || '',
          generalized: (() => {
            const g = generalizeLinePair(pair.before, pair.after);
            return (g && isGeneralPatternUsable(g, lang)) ? g : null;
          })(),
          observed:    1,
          verified:    0,
          failures:    0,
          confidence:  0,
          approved:    false,
          created:     Date.now(),
          lastSeen:    Date.now(),
        });
        learnedIds.push(id); // أضف ID الجديد
      }
    });

    db.meta.total++;
    save(db);
    return learnedIds;
  }

  // ─── Verify (Ghost Mode calls this with patternId) ──
  function verify(patternId, success) {
    const db = load();
    const p = db.patterns.find(p => p.id === patternId);
    if (!p) return;

    if (success) {
      p.verified = (p.verified || 0) + 1;
    } else {
      p.failures = (p.failures || 0) + 1;
      // revoke approval لو فشل كثير
      if (p.failures >= 3) p.approved = false;
    }

    // calcConfidence هو المصدر النهائي — لا manual decay
    p.confidence = calcConfidence(p.verified || 0, p.failures || 0);

    // موافقة تلقائية — الفشل المتكرر يمنع إعادة الاعتماد
    if (
      p.failures < 3 &&
      p.verified >= THRESHOLDS.MIN_VERIFIED &&
      p.confidence >= THRESHOLDS.MIN_CONFIDENCE
    ) {
      p.approved = true;
    } else if (p.failures >= 3) {
      p.approved = false;
    }

    save(db);
    return p.id;
  }

  // ─── markResult (deprecated — use verify instead) ───
  // @deprecated استخدم verify(patternId, success)
  function markResult(type, success) {
    // intentionally empty — لا يرفع verified بشكل جماعي
    console.warn('[LearningEngine] markResult deprecated. Use verify(patternId, success)');
  }


  // ─── Generalized Pattern Matching ───────────────────
  function matchGeneralPattern(line, pattern) {
    if (!pattern || !pattern.beforeTemplate) return null;

    const template = pattern.beforeTemplate;
    const tokenRe = /__LEARN_(ID_[0-9]+|STR_[0-9]+)__/g;

    // [VBR] خانة تتكرّر في القالب كانت تُنتج مجموعة التقاط مستقلة لكل ظهور،
    // بلا مرجع خلفي. فيترتّب على ذلك أمران مقيسان:
    //   (1) القالب يطابق سطورًا تختلف فيها مواضع الخانة الواحدة، و
    //   (2) حلقة القيم تكتب فوق القيمة فيبقى آخر ظهور وحده فيُركَّب في الكل.
    // المقيس:  a.innerHTML = b.innerHTML + m   ⇒   b.textContent = b.textContent + m
    //          (وجهة الكتابة تبدّلت، والكتابة إلى a اختفت)
    //          db.query("a=" + x + " b=" + y)  ⇒   db.query("a=? b=?", [y, y])
    //          (x فُقد صامتًا)
    // groupOf يربط كل خانة بمجموعتها، فالظهور التالي مرجع خلفي لا مجموعة جديدة،
    // أي أن القالب يشترط تساوي المواضع — وهو المعنى المقصود من تكرار الخانة.
    let regex = "";
    const groupOf = {};
    let groupNo = 0;
    let last = 0;
    let match;

    while ((match = tokenRe.exec(template)) !== null) {
      regex += template.slice(last, match.index)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const slotId = match[1];
      const slot = (pattern.beforeSlots || []).find(x => x.id === slotId);

      if (!slot) return null;

      // ظهور تالٍ لخانة سبقت ⇒ مرجع خلفي، فالموضعان يجب أن يتساويا.
      if (Object.prototype.hasOwnProperty.call(groupOf, slotId)) {
        regex += "\\" + groupOf[slotId];
        last = match.index + match[0].length;
        continue;
      }
      groupNo++;
      groupOf[slotId] = groupNo;

      if (slot.kind === "string") {
        regex += '((?:"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`))';
      } else {
        regex += "([A-Za-z_$][A-Za-z0-9_$]*)";
      }

      last = match.index + match[0].length;
    }

    regex += template.slice(last)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const result = new RegExp("^" + regex + "$").exec(line);
    if (!result) return null;

    // قيمة واحدة لكل خانة، من مجموعتها وحدها — لا كتابة فوق قيمة سابقة.
    const values = {};
    for (const slotId in groupOf) values[slotId] = result[groupOf[slotId]];

    return { values };
  }

  function renderGeneralTemplate(template, values) {
    if (!template || !values) return null;

    return template.replace(
      /__LEARN_(ID_[0-9]+|STR_[0-9]+)__/g,
      function(token) {
        const id = token.slice(8, -2);
        return Object.prototype.hasOwnProperty.call(values, id)
          ? values[id]
          : token;
      }
    );
  }

  // ─── Assignment Target Preservation ─────────────────
  // [V2′] الإصلاح المتعلَّم لا يجوز أن يغيّر وجهة الكتابة.
  // مسار المطابقة الحرفية (t === p.before) لا يعبر matchGeneralPattern أصلًا،
  // فالمرجع الخلفي لا يراه. والمقيس أن زوجًا مثل:
  //     const A_KEY = "sk_live_…";  →  const B_KEY = process.env.A_KEY;
  // تقبله corresponds (إسنادان يتقاسمان معرّفًا، وهي سَعَة موثَّقة) فيُخزَّن
  // ويُعتمد، وتطبيقه يعيد تسمية التصريح فتصير كل استعمالات A_KEY غير معرَّفة.
  // تُقارَن بادئة المسار كاملةً لا جذره وحده: el.innerHTML → el.textContent
  // مقبول (المقطع الأخير هو ما يُصلحه الإصلاح)، و a.b.c → a.z.c مرفوض.
  // وهدفٌ من مقطع واحد يُطابَق تامًّا، لأن الاسم المجرَّد هوية لا خاصية.
  // نقاط عمى مسجَّلة (assignTarget تُرجع null): الفهرسة a[i]= والتفكيك
  // و{**=, &&=, %=, &=, |=, ^=, >>=} — لا حماية ولا رفض، وتوسيعها يمسّ
  // assignTarget المشتركة مع corresponds فيؤجَّل إلى جولة مستقلة.
  function preservesTarget(beforeLine, afterLine) {
    const b = assignTarget(beforeLine);
    const a = assignTarget(afterLine);
    if ((b === null) !== (a === null)) return false;  // تغيّر شكل العبارة
    if (b === null) return true;                      // ليس إسنادًا ⇒ لا حكم
    const bs = b.split('.'), as = a.split('.');
    if (bs.length !== as.length) return false;
    if (bs.length === 1) return bs[0] === as[0];
    return bs.slice(0, -1).join('.') === as.slice(0, -1).join('.');
  }

  // ─── Value Order Preservation ───────────────────────
  // [V4″] ترتيب القيم لا يُبدَّل — على مستوى السطر هذه المرة لا القالب.
  //
  // V4 يحرس القالب وقت التخزين، وV4′ يعيد حرسه وقت التطبيق. لكن المطابقة
  // الحرفية (t === p.before) لا قالب لها أصلاً، فزوجٌ حرفي يعكس وسطاء
  // الاستعلام يُطبَّق كما هو. والمقيس:
  //   before: conn.exec("… a=" + userId + " AND b=" + tenantId);
  //   after : conn.exec("… a=? AND b=?", [tenantId, userId]);
  // صحيح نحويًا، وتقبله البوابات الثلاث (المحلّل يُنتج نفس قائمة البلاغات
  // للمقلوب والسليم)، ودلالته مقلوبة: قيمة العمود a تذهب إلى b والعكس.
  //
  // والفحص على المعرّفات **خارج النصوص** حصرًا: محتوى النص يعيد ترتيب نفسه
  // بطبيعة هذا الإصلاح (‎"… a=" + x + " AND b="‎ ⇒ ‎"… a=? AND b=?"‎)، فقياسه
  // يرفض الإصلاح السليم رفضًا كاذبًا — مقيس قبل الاستقرار على هذه الصيغة.
  // والكلمات المفتاحية تُستثنى كما تفعل generalizeLinePair.
  //
  // يسري على المسارين معًا لأنه عند نقطة الخانق الوحيدة قبل الكتابة.
  // تُبنى مرة واحدة لا في كل نداء: الدالة على المسار الساخن (نداء لكل سطر
  // يُستبدَل)، وبناء الـSet والregex داخلها قاس +184% على حالة "كل سطر
  // يُطبَّق" — مقيس. الثابتان هنا يُلغيان ذلك.
  const VO_KEYWORDS = new Set([
    'const','let','var','function','def','return','new','this','self',
    'class','public','private','protected','static','final','import',
    'from','require','if','else','for','while','try','catch',
    'async','await','true','false','null','undefined'
  ]);
  const VO_STRING_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
  const VO_IDENT_RE  = /\b[A-Za-z_$][\w$]*\b/g;

  function preservesValueOrder(beforeLine, afterLine) {
    const seq = src => {
      const bare = String(src).replace(VO_STRING_RE, ' ');
      const out = [];
      let m;
      VO_IDENT_RE.lastIndex = 0;   // regex مشترك ‎/g‎ ⇒ تصفير lastIndex إلزامي
      while ((m = VO_IDENT_RE.exec(bare)) !== null) {
        if (!VO_KEYWORDS.has(m[0]) && out.indexOf(m[0]) === -1) out.push(m[0]);
      }
      return out;
    };
    const b = seq(beforeLine);
    const a = seq(afterLine).filter(x => b.indexOf(x) !== -1);
    let at = 0;
    for (const tok of b) if (a[at] === tok) at++;
    return at === a.length;
  }

  // ─── Apply Learned ──────────────────────────────────
  function applyLearned(code, fileName, opts) {
    const db = load();
    if (!db.patterns.length) return { fixed: code, applied: 0, uses: [] };

    const fileLang = inferLanguage(fileName);

    // [P2] onlyIds: حصر التطبيق بأنماط بعينها. يُستعمل في التنصيف لعزل النمط
    // المسؤول عن تعديل رفضته البوابة. بلا الخيار لا يتغيّر أي سلوك.
    const onlyIds = (opts && Array.isArray(opts.onlyIds)) ? new Set(opts.onlyIds) : null;

    const goodPatterns = db.patterns.filter(p =>
      p.approved &&
      p.confidence >= THRESHOLDS.MIN_CONFIDENCE &&
      p.verified >= THRESHOLDS.MIN_VERIFIED &&
      (!p.language || p.language === fileLang) &&
      (!onlyIds || onlyIds.has(p.id))
    );

    if (!goodPatterns.length) {
      return { fixed: code, applied: 0, uses: [] };
    }

    // [V4′] سياسة صلاحية القالب المعمَّم تُطبَّق على **الطرفين** لا على طرف.
    //
    // كان isGeneralPatternUsable يُنادى من موضع واحد: داخل learn() وقت
    // التخزين. وapplyLearned يثق بـp.generalized ثقةً مطلقة. فقالبٌ دخل
    // المخزن بطريق لا يمرّ بـlearn() — مخزن أقدم من V4، أو زرع، أو مسار
    // كود آخر — يُطبَّق كما هو. والمقيس على عائلة SQL concat:
    //     قالب "بعد" يعكس وسطاء الاستعلام  ⇒  applied=1، وGhost pass،
    //     والفحص النحوي يقبل، وFixVerifier يقبل («أزال مشكلتين بلا تدهور»)،
    //     ثم يُكتب فعلاً وحكم P2 عليه PASS. والربط مقلوب: قيمة العمود a
    //     تذهب إلى b والعكس. صحيح نحويًا، مُعامَل بالمعامِلات، ودلالته عكسية.
    // ولا تنقذنا البوابة: المحلّل يُنتج نفس قائمة البلاغات بالضبط للنسخة
    // المقلوبة والنسخة السليمة — لا كاشف يمثّل تقابل المعامِل بالعمود.
    //
    // والدالة محضة وحتمية، وlearn() لا يضع generalized إلا بعد اجتيازها
    // ⇒ إعادة الفحص no-op لكل ما خزّنه هذا المحرك، ولا تعضّ إلا على قالب
    // ما كان ليخزّنه. والحساب مرة واحدة لكل نمط لا لكل سطر: القياس المتشابك
    // أعطى النداء لكل سطر +74.8% على applyLearned، وهذه الصيغة +15.3%
    // بمدى متقاطع مع الأصل.
    //
    // ⚠️ النطاق: المسار المعمَّم وحده. المطابقة الحرفية (via='exact') تبقى
    // خارج الحماية — زوجٌ حرفي يعكس الوسطاء يُطبَّق كما كان، وهو حدّ مُعلَن
    // ومُختبَر صراحةً، وتغطيته تحتاج فحص ترتيب على مستوى قيم الخانات.
    const genUsable = new Set(goodPatterns.filter(
      p => p.generalized && isGeneralPatternUsable(p.generalized, fileLang)));

    const lines = code.split('\n');
    const uses = [];
    let applied = 0;

    for (let i = 0; i < lines.length; i++) {
      const originalLine = lines[i];
      const t = originalLine.trim();

      if (!t || t.startsWith('//') || t.startsWith('#')) continue;
      if (isSafe(t)) continue;

      let selected = null;
      let replacement = null;
      let via = null;          // [P2] أي مسار أنتج الاستبدال: حرفي أم معمَّم

      // 1. Exact match first.
      for (const p of goodPatterns) {
        if (t === p.before) {
          selected = p;
          replacement = p.after;
          via = 'exact';
          break;
        }
      }

      // 2. If exact match failed, try generalized learning.
      if (!selected) {
        for (const p of goodPatterns) {
          if (!p.generalized) continue;
          if (!genUsable.has(p)) continue;   // [V4′] عضوية بالهوية لا بالمعرّف

          const match = matchGeneralPattern(t, p.generalized);
          if (!match) continue;

          const rendered = renderGeneralTemplate(
            p.generalized.afterTemplate,
            match.values
          );

          if (!rendered || rendered === t) continue;

          selected = p;
          replacement = rendered;
          via = 'general';
          break;
        }
      }

      if (!selected || !replacement || replacement === t) continue;

      // الخانق الوحيد قبل الكتابة — يسري على المسارين: الحرفي والمعمَّم.
      if (!preservesTarget(t, replacement)) continue;
      if (!preservesValueOrder(t, replacement)) continue;   // [V4″]

      const leading = originalLine.match(/^\s*/)?.[0] || '';
      lines[i] = leading + replacement;
      // [P2] نسبة صريحة: أي نمط أسهم، في أي سطر، عبر أي مسار. ولا يُسجَّل
      // استعمال هنا — الدفتر (lastUsed) صار بعد قرار البوابة عبر markUsed.
      uses.push({ patternId: selected.id, lineIndex: i, via, before: t, after: replacement });
      applied++;
    }

    // [P2] applyLearned صارت قراءة محضة: لا lastUsed ولا save(). كانت تكتب
    // الدفتر داخل الحلقة قبل أن تحكم البوابة، فيُسجَّل استعمالٌ لتعديل قد
    // يُرفض؛ وكانت تكتب المخزن في كل نداء حتى عند applied === 0.
    return {
      fixed: lines.join('\n'),
      applied,
      uses
    };
  }

  // ─── Usage Bookkeeping (post-gate) ──────────────────
  // [P2] يُستدعى من خط الأنابيب **بعد** قبول البوابة حصرًا. يسجّل lastUsed
  // ولا يلمس verified ولا failures ولا confidence ولا approved: نسبة الأدلة
  // في هذه المرحلة تسجيلٌ لا حكم على حالة النمط.
  function markUsed(patternIds) {
    if (!Array.isArray(patternIds) || !patternIds.length) return 0;
    const db = load();
    if (!db || !Array.isArray(db.patterns)) return 0;
    const wanted = new Set(patternIds);
    const now = Date.now();
    let marked = 0;
    for (const p of db.patterns) {
      if (!wanted.has(p.id)) continue;
      p.lastUsed = now;
      marked++;
    }
    if (marked) save(db);
    return marked;
  }

  function learnSafe(code, fileName) {
    const db = load();
    db.safe = db.safe || [];
    let learned = 0;

    code.split('\n').forEach(line => {
      const t = line.trim();
      if (!t || t.startsWith('//')) return;
      if (!isSafe(t)) return;
      if (db.safe.find(s => s.pattern === t.substring(0, 80))) return;

      db.safe.push({ pattern: t.substring(0, 80), created: Date.now() });
      learned++;
    });

    if (learned > 0) save(db);
    return learned;
  }

  // ─── Stats ──────────────────────────────────────────
  function getStats() {
    const db = load();
    return {
      total:    db.patterns.length,
      approved: db.patterns.filter(p => p.approved).length,
      pending:  db.patterns.filter(p => !p.approved).length,
      safe:     (db.safe || []).length,
      patterns: db.patterns.map(p => ({
        id:          p.id,
        type:        p.type,
        before:      p.before?.slice(0, 60),
        after:       p.after?.slice(0, 60),
        language:    p.language || 'unknown',
        context:     p.context || null,
        fingerprint: p.fingerprint || null,
        observed:    p.observed,
        verified:    p.verified,
        failures:    p.failures,
        confidence:  p.confidence?.toFixed(2),
        approved:    p.approved,
      }))
    };
  }

  function getBoosts() {
    const db = load();
    const boosts = new Map();
    db.patterns
      .filter(p => p.approved && p.confidence >= 0.8)
      .forEach(p => {
        const cur = boosts.get(p.type) || 0;
        boosts.set(p.type, Math.max(cur, p.confidence));
      });
    return boosts;
  }

  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
  }

  return { learn, learnSafe, applyLearned, markUsed, verify, markResult, getStats, getBoosts, reset };
})();

if (typeof window !== 'undefined') window.LearningEngine = LearningEngine;
if (typeof module !== 'undefined') module.exports = LearningEngine;

