// ═══════════════════════════════════════════════════════
// claude_repair_engine.js v0.2
// Claude as a General Repair Engine for Reality Engine
// ═══════════════════════════════════════════════════════
//
// الدور: يولّد candidate patch لأي مشكلة — القرار النهائي لـ FixVerifier.
//
// ضمانات:
//   1. مشكلة واحدة → candidate واحد → FixVerifier يقرر.
//   2. ANTHROPIC_API_KEY من environment فقط.
//   3. لا تطبيق داخل هذا الملف.
//   4. تحقق محلي صارم قبل FIXED.
//   5. repairAll() يجمع candidates فقط — لا تطبيق متسلسل.
//   6. لا dependencies خارجية.
// ═══════════════════════════════════════════════════════

"use strict";

var ClaudeRepairEngine = (() => {

  const VERSION         = '0.2.0';
  const MODEL           = 'claude-sonnet-4-6';
  const API_URL         = 'https://api.anthropic.com/v1/messages';
  const DEFAULT_TIMEOUT = 25000;
  const MAX_TOKENS      = 3000;

  // الملف يُرسل كاملاً حتى هذا الحجم (بالأسطر)
  const FULL_FILE_THRESHOLD = 300;
  // إذا كان الملف أكبر، نرسل سياقاً ذكياً بهذا العدد من الأسطر
  const SMART_CONTEXT_LINES = 40;

  // حد أقصى لنسبة التغيير المقبولة (تغيير أكثر من 60% للملف → مشبوه)
  const MAX_CHANGE_RATIO = 0.40;  // تغيير >40% لمشكلة واحدة مشبوه

  // Completeness: أي سطر أصلي أبعد من هذا عن سطر الهدف يجب أن يبقى في الناتج.
  // أصغر من SMART_CONTEXT_LINES عمدًا: ملف ≤300 سطر يكون أغلبه داخل ±40.
  const EDIT_RADIUS = 10;

  // ─── Status ──────────────────────────────────────────
  const Status = Object.freeze({
    FIXED:          'FIXED',
    CANNOT_FIX:     'CANNOT_FIX',
    PENDING_REVIEW: 'PENDING_REVIEW',
  });

  // ─── API Key ─────────────────────────────────────────
  function _getApiKey() {
    const key = (typeof process !== 'undefined' &&
                 process.env &&
                 process.env.ANTHROPIC_API_KEY) || null;
    if (!key || key.trim().length < 10) return null;
    return key.trim();
  }

  // ─── Smart Context Extractor ─────────────────────────
  // يرسل الملف كاملاً إذا كان صغيراً،
  // وإلا يرسل: imports + الدالة/الكلاس المستهدف + سياق محيط.
  function _extractContext(code, lineNum) {
    const lines   = code.split('\n');
    const total   = lines.length;
    const idx     = Math.max(0, (lineNum || 1) - 1);

    // ملف صغير → أرسله كاملاً
    if (total <= FULL_FILE_THRESHOLD) {
      return {
        snippet:    code,
        fromLine:   1,
        toLine:     total,
        totalLines: total,
        fullFile:   true,
      };
    }

    // ملف كبير → سياق ذكي
    // snippet = target context فقط (ما يعيده Claude).
    // imports ترسل كـ importContext منفصلة في الـprompt — read-only.
    // reconstruction يستبدل targetRange مباشرة بدون الاعتماد على marker.

    // 1. imports في أعلى الملف (أول 20 سطر)
    let importEnd = -1;
    for (let i = 0; i < Math.min(20, total); i++) {
      const t = lines[i].trim();
      if (/^(?:import|require|const\s+\w+\s*=\s*require|from\s+['"]|#include|using\s+)/.test(t) || !t) {
        importEnd = i;
      } else if (importEnd >= 0) {
        break;
      }
    }

    // 2. target context حول السطر المستهدف
    const ctxFrom = Math.max(0, idx - SMART_CONTEXT_LINES);
    const ctxTo   = Math.min(total - 1, idx + SMART_CONTEXT_LINES);
    const targetRange = { from: ctxFrom, to: ctxTo };

    // snippet = target context فقط (Claude يعيد هذا الجزء)
    const snippet = lines.slice(ctxFrom, ctxTo + 1).join('\n');

    // importContext = imports لعرضها كـ reference في الـprompt (لا يعيدها Claude)
    const importContext = (importEnd >= 0 && importEnd < ctxFrom - 1)
      ? lines.slice(0, importEnd + 1).join('\n')
      : null;

    return {
      snippet,
      fromLine:      ctxFrom + 1,
      toLine:        ctxTo + 1,
      totalLines:    total,
      fullFile:      false,
      targetRange,
      importContext, // للـprompt فقط — لا يدخل في reconstruction
    };
  }

  // ─── Prompt builder ───────────────────────────────────
  function _buildPrompt(issue, code, fileName) {
    const ctx        = _extractContext(code, issue.line);
    const issueType  = issue.type  || issue.cAct  || 'UNKNOWN';
    const issueTitle = issue.title || issueType;
    const targetLine = issue.line  || '?';
    const contextLabel = ctx.fullFile
      ? `Full file (${ctx.totalLines} lines)`
      : `Target context (lines ${ctx.fromLine}–${ctx.toLine} of ${ctx.totalLines})`;

    const parts = [
      'You are a precise, minimal code repair assistant for Reality Engine.',
      'Your ONLY job: fix ONE specific issue. Nothing else.',
      '',
      `File: ${fileName}`,
      `Issue type: ${issueType}`,
      `Issue: ${issueTitle}`,
      `Target line: ${targetLine}`,
      issue.ev  ? `Evidence: ${issue.ev}`   : '',
      issue.sev ? `Severity: ${issue.sev}`  : '',
    ];

    // imports كـ reference فقط — لا يعيدها Claude
    if (!ctx.fullFile && ctx.importContext) {
      parts.push('', 'Reference imports (DO NOT include these in your response):');
      parts.push('```');
      parts.push(ctx.importContext);
      parts.push('```');
    }

    parts.push(
      '',
      `${contextLabel} — return ONLY this block fixed:`,
      '```',
      ctx.snippet,
      '```',
      '',
      'STRICT RULES:',
      '1. Return ONLY the complete fixed version of the target context block shown above.',
      '2. Do NOT include the reference imports in your response — they are already in the file.',
      '3. Fix ONLY the reported issue at the target line.',
      '4. You MAY add a new import line at the TOP of your response if the fix strictly requires it.',
      '5. Do NOT fix other issues, refactor, rename, or improve unrelated code.',
      '6. Do NOT add explanations, comments, or prose — code only.',
      '7. If you cannot fix this safely, reply with exactly: CANNOT_FIX',
      '8. If the code shown is already correct for this issue, reply with exactly: CANNOT_FIX',
      // ملف كامل: الرد يستبدل الملف كله، فأي حذف أو اختصار يضيع كودًا سليمًا.
      ctx.fullFile
        ? '9. This is the FULL file: return the COMPLETE file with every other line unchanged. ' +
          'Never omit, shorten, or summarize any part (no "..." or "rest unchanged" placeholders). ' +
          'If you cannot return the complete file safely, reply with exactly: CANNOT_FIX'
        : '',
    );

    return parts.filter(Boolean).join('\n');
  }

  // ─── Longest common subsequence of lines (trimmed) ───
  // عدد الأسطر المشتركة بنفس الترتيب بين نسختين، بغض النظر عن إزاحتها.
  function _commonLineCount(a, b) {
    const A = a.map(l => l.trim()), B = b.map(l => l.trim());
    let prev = new Uint32Array(B.length + 1);
    let cur  = new Uint32Array(B.length + 1);
    for (let i = 1; i <= A.length; i++) {
      for (let j = 1; j <= B.length; j++) {
        cur[j] = A[i - 1] === B[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
      }
      [prev, cur] = [cur, prev];
    }
    return prev[B.length];
  }

  // ─── Local validation before FIXED ───────────────────
  // يرفض: فارغ، CANNOT_FIX، بلا تغيير، نثر بلا كود،
  //        تغيير ضخم غير مبرر لمشكلة صغيرة.
  function _validate(rawText, originalCode, issue) {
    if (!rawText || typeof rawText !== 'string') {
      return { ok: false, reason: 'empty response' };
    }
    const text = rawText.trim();

    if (!text)               return { ok: false, reason: 'empty after trim' };
    if (text === 'CANNOT_FIX') return { ok: false, reason: 'CANNOT_FIX' };

    // استخرج كود من code block إذا وُجد
    const blockMatch = text.match(/```(?:\w*\n?)([\s\S]+?)```/);
    // لا trim() كامل: إزاحة السطر الأول جزء من الكود (Python / بلوك داخل دالة).
    // نحذف فقط الأسطر الفارغة في البداية والفراغات في النهاية.
    const candidate  = (blockMatch ? blockMatch[1] : rawText)
      .replace(/^(?:[ \t]*\r?\n)+/, '')
      .replace(/\s+$/, '');

    if (!candidate || candidate.length < 3) {
      return { ok: false, reason: 'candidate too short' };
    }

    // تأكد أن الرد يحتوي على كود وليس شرحاً
    const looksLikeCode = /[=({};]/.test(candidate) ||
                          /\b(?:function|const|let|var|class|def|import|return|if|for)\b/.test(candidate);
    if (!looksLikeCode) {
      return { ok: false, reason: 'response looks like prose, not code' };
    }

    // يجب أن يختلف عن الأصل
    if (candidate === originalCode.trim()) {
      return { ok: false, reason: 'no change from original' };
    }

    // changeRatio: يقارن snippet المُرسَل لـ Claude بـ candidate المُستَلَم.
    // هذا عادل — لا نقارن بالكود الكامل الذي لم يره Claude.
    // المقارنة بالمحتوى (LCS) لا بالموقع: سطر مُضاف (مثل import في الأعلى)
    // يُحسب تغييرًا واحدًا بدل أن يُزيح كل ما بعده ويُحسب تغييرًا كاملًا.
    // الأسطر المحذوفة أو المُعدَّلة ما زالت تُحسب، فالحماية من الحذف باقية.
    const oLines = originalCode.split('\n');
    const cLines = candidate.split('\n');
    const maxLen = Math.max(oLines.length, cLines.length);
    if (maxLen > 10) {
      const common    = _commonLineCount(oLines, cLines);
      const diffCount = Math.max(oLines.length, cLines.length) - common;
      const changeRatio = diffCount / maxLen;
      if (changeRatio > MAX_CHANGE_RATIO) {
        return {
          ok: false,
          reason: `change ratio too high (${Math.round(changeRatio * 100)}% lines changed for single issue)`,
        };
      }
    }

    return { ok: true, candidate };
  }

  // ─── Reconstruct full code from candidate ─────────────
  // fullFile → candidate هو الكود الكامل الجديد (مباشر).
  // partial  → يستبدل فقط targetRange في الكود الأصلي.
  //            imports التي أُرسلت كـ header لا تُستبدل هنا —
  //            targetRange يحدد بالضبط الأسطر المتعلقة بالمشكلة.
  function _reconstructCode(code, issue, candidate, ctx) {
    if (ctx.fullFile) {
      // Claude رأى الكل وأعاد الكل. _validate يحذف الفراغات في نهاية الرد، فنعيد
      // السطر الأخير الفارغ إن كان في الأصل حتى لا يتغير الملف بلا سبب.
      if (code.endsWith('\n') && !candidate.endsWith('\n')) return candidate + '\n';
      return candidate;
    }

    // snippet = target context فقط → candidate = target context المصلوح فقط.
    // لا markers، لا parsing للرد — نستبدل targetRange مباشرة.
    const lines    = code.split('\n');
    const newLines = candidate.split('\n');
    const from     = ctx.targetRange.from;
    const to       = ctx.targetRange.to;
    lines.splice(from, to - from + 1, ...newLines);
    return lines.join('\n');
  }

  // ─── Completeness check ───────────────────────────────
  // يمنع أن يستبدل جزءٌ من الكود الملفَ كله، وأن يُعدَّل كود بعيد عن الهدف.
  // يحاذي الأصل مع الناتج سطرًا بسطر (LCS) ثم يطبّق قاعدتين:
  //   1. أي سطر أصلي غير فارغ حُذف أو تغيّر يجب أن يكون داخل منطقة الهدف
  //      (السطر ± EDIT_RADIUS) — وإلا INCOMPLETE_FILE.
  //   2. أي سطر مُضاف غير فارغ يجب أن يكون داخل منطقة الهدف، أو import-like
  //      في رأس الملف — وإلا OUT_OF_SCOPE_ADDITION.
  // المقارنة تحفظ الإزاحة في بداية السطر (Python: الإزاحة تغيّر المعنى)،
  // وتتجاهل فقط الفراغات في نهاية السطر.
  // يُرجع null إذا كان الناتج سليمًا، أو سبب الرفض.
  const _HEADER_LINE = /^\s*(?:import\b|from\s+\S+\s+import\b|(?:const|let|var)\s+[\w${},\s]+=\s*require\s*\(|require\s*\(|(['"])use strict\1|#include\b|using\s+[\w.]+\s*;|package\s+[\w.]+)/;

  function _completenessProblem(code, fixedCode, issue) {
    const A   = code.split('\n').map(l => l.replace(/\s+$/, ''));
    const B   = fixedCode.split('\n').map(l => l.replace(/\s+$/, ''));
    const idx = Math.max(0, ((issue && issue.line) || 1) - 1);
    const near = i => Math.abs(i - idx) <= EDIT_RADIUS;

    // رأس الملف: تعليقات/أسطر فارغة/imports قبل أول سطر كود فعلي
    let headerEnd = 0;
    while (headerEnd < A.length &&
           (!A[headerEnd].trim() || _HEADER_LINE.test(A[headerEnd]) ||
            /^\s*(?:\/\/|#|\/\*|\*)/.test(A[headerEnd]))) headerEnd++;

    // البادئة واللاحقة المتطابقتان لا تحتاجان محاذاة (يبقي LCS صغيرًا)
    let pre = 0;
    while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
    let suf = 0;
    while (suf < A.length - pre && suf < B.length - pre &&
           A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;

    const a = A.slice(pre, A.length - suf), b = B.slice(pre, B.length - suf);
    const n = a.length, m = b.length, W = m + 1;
    const L = new Uint32Array((n + 1) * W);            // L[i][j] = LCS(a[i..], b[j..])
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        L[i * W + j] = a[i] === b[j] ? L[(i + 1) * W + j + 1] + 1
                                     : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
      }
    }

    let removed = 0, firstRemoved = -1, added = 0, firstAdded = -1;
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { i++; j++; continue; }
      if (j >= m || (i < n && L[(i + 1) * W + j] >= L[i * W + j + 1])) {
        const orig = pre + i;                           // سطر أصلي حُذف/تغيّر
        if (a[i].trim() && !near(orig)) { removed++; if (firstRemoved < 0) firstRemoved = orig + 1; }
        i++;
      } else {
        const at = pre + i;                             // يُضاف قبل السطر الأصلي at
        const ok = !b[j].trim() ||                      // سطر فارغ
                   near(at) || near(at - 1) ||          // داخل منطقة الهدف
                   (at <= headerEnd && _HEADER_LINE.test(b[j]));   // import في رأس الملف
        if (!ok) { added++; if (firstAdded < 0) firstAdded = at + 1; }
        j++;
      }
    }

    if (removed) {
      return `INCOMPLETE_FILE — ${removed} original line(s) outside the target area are missing ` +
             `or changed (first: line ${firstRemoved})`;
    }
    if (added) {
      return `OUT_OF_SCOPE_ADDITION — ${added} line(s) added outside the target area ` +
             `(first: before original line ${firstAdded})`;
    }
    return null;
  }

  // ─── API call with timeout ────────────────────────────
  async function _callAPI(prompt, apiKey, timeoutMs, fetchFn) {
    if (!fetchFn) throw new Error('fetch not available');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(API_URL, {
        method:  'POST',
        signal:  controller.signal,
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      MODEL,
          max_tokens: MAX_TOKENS,
          messages:   [{ role: 'user', content: prompt }],
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error('HTTP ' + response.status + ': ' + body.slice(0, 150));
      }
      const data = await response.json();
      const text = data && data.content && data.content[0] && data.content[0].text;
      if (!text) throw new Error('Empty content from API');
      return { text: text.trim(), model: data.model || MODEL };
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Result factory ───────────────────────────────────
  function _makeResult(status, fixedCode, originalCode, issue, reason, meta) {
    return Object.freeze({
      version:      VERSION,
      status,
      fixedCode:    (status === Status.FIXED && fixedCode && fixedCode !== originalCode)
                    ? fixedCode : null,
      originalCode: originalCode || null,
      issue:        issue  || null,
      reason:       String(reason || ''),
      model:        (meta && meta.model) || MODEL,
      appliedAt:    null,   // لا تطبيق هنا أبداً
      approvedBy:   null,   // لا موافقة هنا أبداً
    });
  }

  // ─── repairOne: مشكلة واحدة → candidate واحد ─────────
  async function repairOne(code, fileName, issue, options) {
    const opts = options || {};

    if (typeof code !== 'string' || !code.trim()) {
      return _makeResult(Status.PENDING_REVIEW, null, code, issue,
        'repairOne: code must be a non-empty string');
    }
    if (!fileName) {
      return _makeResult(Status.PENDING_REVIEW, null, code, issue,
        'repairOne: fileName is required');
    }
    if (!issue) {
      return _makeResult(Status.PENDING_REVIEW, null, code, issue,
        'repairOne: issue is required');
    }

    const apiKey    = _getApiKey();
    const timeoutMs = Math.max(1000, opts.timeoutMs || DEFAULT_TIMEOUT);
    const fetchFn   = opts._fetchFn ||
                      (typeof fetch === 'function' ? fetch : null);

    if (!apiKey) {
      return _makeResult(Status.PENDING_REVIEW, null, code, issue,
        'ANTHROPIC_API_KEY not set — configure in environment variables');
    }

    const ctx    = _extractContext(code, issue.line);
    const prompt = _buildPrompt(issue, code, fileName);

    try {
      const result  = await _callAPI(prompt, apiKey, timeoutMs, fetchFn);
      const rawText = result.text;

      if (rawText === 'CANNOT_FIX') {
        return _makeResult(Status.CANNOT_FIX, null, code, issue,
          'Claude: cannot safely fix this issue', { model: result.model });
      }

      const validation = _validate(rawText, ctx.snippet, issue);
      if (!validation.ok) {
        return _makeResult(Status.CANNOT_FIX, null, code, issue,
          'Validation failed: ' + validation.reason,
          { model: result.model, raw: rawText.slice(0, 200) });
      }

      const fixedCode = _reconstructCode(code, issue, validation.candidate, ctx);

      if (fixedCode === code) {
        return _makeResult(Status.CANNOT_FIX, null, code, issue,
          'Reconstruction produced no change in full code', { model: result.model });
      }

      // الملف الناقص لا يصبح FIXED أبدًا — CANNOT_FIX بدل patch جزئي.
      const incomplete = _completenessProblem(code, fixedCode, issue);
      if (incomplete) {
        return _makeResult(Status.CANNOT_FIX, null, code, issue,
          incomplete, { model: result.model });
      }

      return _makeResult(Status.FIXED, fixedCode, code, issue,
        'Claude candidate ready — awaiting FixVerifier',
        { model: result.model });

    } catch (err) {
      const reason = err.name === 'AbortError'
        ? 'Timeout after ' + timeoutMs + 'ms'
        : 'API error: ' + err.message;
      return _makeResult(Status.PENDING_REVIEW, null, code, issue, reason);
    }
  }

  // ─── repairAll: جمع candidates فقط — لا تطبيق متسلسل ─
  // كل issue تُعالج على نفس الكود الأصلي.
  // المستدعي هو الذي يقرر ترتيب التطبيق بعد FixVerifier.
  async function repairAll(code, fileName, issues, options) {
    if (!Array.isArray(issues) || issues.length === 0) {
      return { code, results: [], fixedCount: 0 };
    }

    // كل issue تعمل على الكود الأصلي — لا تسلسل
    const rawResults = await Promise.all(
      issues.map(issue =>
        repairOne(code, fileName, issue, options)
          .catch(err => _makeResult(Status.PENDING_REVIEW, null, code, issue,
            'Unexpected: ' + err.message))
      )
    );

    // امنع تكرار نفس Claude candidate عندما تشير عدة issues لنفس الإصلاح.
    const seenSuggestions = new Set();
    const results = rawResults.filter(result => {
      if (
        !result ||
        result.status !== Status.FIXED ||
        typeof result.fixedCode !== 'string'
      ) {
        return true;
      }

      if (seenSuggestions.has(result.fixedCode)) return false;

      seenSuggestions.add(result.fixedCode);
      return true;
    });

    return {
      code,     // الكود الأصلي — لم يتغير هنا
      results,
      fixedCount: results.filter(r => r.status === Status.FIXED).length,
    };
  }

  // ─── Public API ──────────────────────────────────────
  return Object.freeze({
    VERSION,
    MODEL,
    Status,
    repairOne,
    repairAll,
    // للاختبار
    _buildPrompt,
    _validate,
    _extractContext,
    _reconstructCode,
    _completenessProblem,
  });

})();

if (typeof window !== 'undefined') window.ClaudeRepairEngine = ClaudeRepairEngine;
if (typeof module !== 'undefined') module.exports = ClaudeRepairEngine;
