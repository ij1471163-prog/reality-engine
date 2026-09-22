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
  // رد ≈2500 token يحتاج عادة أقل من 45s؛ 25s كانت تقطع الردود الكبيرة.
  const DEFAULT_TIMEOUT = 60000;
  // سقف الرد. أكبر من FULL_FILE_TOKEN_BUDGET بأكثر من الضعف كهامش لخطأ التقدير.
  const MAX_TOKENS      = 6000;

  // الملف يُرسل كاملاً (ويُطلب كاملًا) فقط إذا تحقق الشرطان:
  //   عدد الأسطر ≤ FULL_FILE_THRESHOLD  و  حجم الرد المقدَّر ≤ FULL_FILE_TOKEN_BUDGET
  // وإلا windowed — لا نطلب ردًا لا يتسع له MAX_TOKENS.
  const FULL_FILE_THRESHOLD = 300;
  const FULL_FILE_TOKEN_BUDGET = 2500;
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

  // ─── Reply size estimate (conservative) ──────────────
  // تقدير متحفظ لعدد tokens لو أعاد Claude هذا النص كاملًا. يبالغ عمدًا:
  // ASCII ≈ 3.2 حرف/token، وغير ASCII (عربي، رموز) ≈ 1 token/حرف لأنه أكثف.
  // يُعايَر لاحقًا بـ count_tokens عند توفر مفتاح API.
  function _estimateTokens(text) {
    const s = String(text || '');
    let ascii = 0, other = 0;
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) < 128) ascii++; else other++;
    }
    return Math.ceil(ascii / 3.2 + other);
  }

  // ─── Window boundaries (windowed mode only) ──────────
  // النافذة لا تقطع دالة/بلوك إذا أمكن تحديد حدوده بأمان:
  //   1. أكبر بلوك يحتوي الهدف ويتسع ضمن MAX_WINDOW_LINES و FULL_FILE_TOKEN_BUDGET
  //      (الأولوية للأعلى: top-level، ثم الأعمق إذا لم يتسع).
  //   2. تُكمَّل حوله وحدات شقيقة كاملة حتى تغطي ±SMART_CONTEXT_LINES إن اتسعت.
  //   3. إذا لم يتسع أي بلوك → نافذة ±SMART_CONTEXT_LINES كما كانت (excerpt).
  // الحدود تُستنتج من الإزاحة، بلا parser لكل لغة. أي خطأ في الاستنتاج يبقى آمنًا:
  // الأطراف مقفلة (_windowBoundaryProblem) وما خارج النافذة لا يُلمس (_reconstructCode).
  const MAX_WINDOW_LINES = 160;

  const _indent     = l => l.length - l.replace(/^\s+/, '').length;
  const _structural = l => !!l.trim() && !/^\s*(?:\/\/|#|\/\*|\*|--|<!--)/.test(l);
  // سطر يُكمل statement قبله: إغلاق، else/catch/except، أو تكملة تعبير
  const _continues  = l => /^\s*(?:[}\])]|(?:else|elif|except|finally|catch)\b|end\b(?!\s*[=(.\[])|\.(?!\.)|&&|\|\||\?|:)/.test(l);

  // آخر سطر في statement يبدأ عند s: كل ما هو أعمق، وكل تكملة على نفس المستوى.
  function _blockEnd(lines, s) {
    const base = _indent(lines[s]);
    let last = s;
    for (let k = s + 1; k < lines.length; k++) {
      if (!_structural(lines[k])) continue;
      const ind = _indent(lines[k]);
      if (ind > base || (ind === base && _continues(lines[k]))) { last = k; continue; }
      break;
    }
    return last;
  }

  // بداية الـstatement الذي يحتوي السطر i (يتخطى الإغلاق و else إلى بدايته).
  function _stmtStart(lines, i) {
    let s = i;
    while (s < lines.length && !_structural(lines[s])) s++;
    if (s >= lines.length) { s = i; while (s > 0 && !_structural(lines[s])) s--; }
    const base = _indent(lines[s]);
    while (_continues(lines[s])) {
      let p = s - 1;
      while (p >= 0 && !(_structural(lines[p]) && _indent(lines[p]) <= base)) p--;
      if (p < 0 || _indent(lines[p]) < base) break;
      s = p;
    }
    return s;
  }

  // البلوكات التي تحتوي idx، من الأعمق إلى الأعلى: [{ from, to }] (0-based).
  function _enclosingBlocks(lines, idx) {
    const blocks = [];
    let s = _stmtStart(lines, idx);
    // هدف على تعليق/سطر فارغ قبل statement → يُضم إليه (الحد قبل التعليق آمن)
    if (s > idx) blocks.push({ from: idx, to: _blockEnd(lines, s) });
    for (;;) {
      const e = _blockEnd(lines, s);
      if (s <= idx && e >= idx) blocks.push({ from: s, to: e });
      const ind = _indent(lines[s]);
      let p = s - 1;
      while (p >= 0 && !(_structural(lines[p]) && _indent(lines[p]) < ind)) p--;
      if (p < 0) break;
      s = _stmtStart(lines, p);
    }
    return blocks;
  }

  // النافذة { from, to } أو null إذا لم يتسع أي بلوك يحتوي الهدف.
  function _boundedWindow(lines, idx) {
    if (idx < 0 || idx >= lines.length || !lines.some(_structural)) return null;
    const fits = (f, t) => t - f + 1 <= MAX_WINDOW_LINES &&
      _estimateTokens(lines.slice(f, t + 1).join('\n')) <= FULL_FILE_TOKEN_BUDGET;

    const blocks = _enclosingBlocks(lines, idx);
    let b = blocks.length - 1;
    while (b >= 0 && !fits(blocks[b].from, blocks[b].to)) b--;
    if (b < 0) return null;
    const B = blocks[b];

    // الوحدات الشقيقة: statements بنفس مستوى B داخل البلوك الأب (أو الملف كله)
    const parent    = blocks[b + 1];
    const scopeFrom = parent ? parent.from + 1 : 0;
    const scopeTo   = parent ? parent.to       : lines.length - 1;
    const level     = _indent(lines[_stmtStart(lines, B.from)]);
    const units = [];
    let gap = scopeFrom;                                // تعليقات قبل الوحدة تُضم إليها
    for (let k = scopeFrom; k <= scopeTo; k++) {
      const l = lines[k];
      if (!_structural(l) || _indent(l) !== level || _continues(l)) continue;
      const e = Math.min(_blockEnd(lines, k), scopeTo);
      while (gap < k && !lines[gap].trim()) gap++;
      units.push({ from: gap, to: e });
      k = e;
      gap = e + 1;
    }

    const wantFrom = Math.max(scopeFrom, idx - SMART_CONTEXT_LINES);
    const wantTo   = Math.min(scopeTo,   idx + SMART_CONTEXT_LINES);
    const grow   = units.find(u => u.to >= wantFrom);                  // يحتوي wantFrom أو بعده
    const shrink = units.find(u => u.from >= wantFrom);
    const growE  = [...units].reverse().find(u => u.from <= wantTo);
    const shrinkE = [...units].reverse().find(u => u.to <= wantTo);
    const lo = u => Math.min(u ? u.from : B.from, B.from);
    const hi = u => Math.max(u ? u.to : B.to, B.to);

    const options = [
      [lo(grow),   hi(growE)],
      [lo(grow),   hi(shrinkE)],
      [lo(shrink), hi(growE)],
      [lo(shrink), hi(shrinkE)],
      [B.from,     B.to],
    ];
    const pick = options.find(([f, t]) => fits(f, t));
    return { from: pick[0], to: pick[1] };
  }

  // ─── Smart Context Extractor ─────────────────────────
  // يرسل الملف كاملاً إذا كان صغيراً ويتسع رده ضمن FULL_FILE_TOKEN_BUDGET،
  // وإلا يرسل: imports + الدالة/الكلاس المستهدف + سياق محيط.
  function _extractContext(code, lineNum) {
    const lines   = code.split('\n');
    const total   = lines.length;
    const idx     = Math.max(0, (lineNum || 1) - 1);

    // ملف صغير يتسع رده كاملًا → أرسله كاملاً
    if (total <= FULL_FILE_THRESHOLD && _estimateTokens(code) <= FULL_FILE_TOKEN_BUDGET) {
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

    // 2. target context حول السطر المستهدف: بلوك كامل إن اتسع، وإلا ±SMART_CONTEXT_LINES
    const win     = _boundedWindow(lines, idx);
    const ctxFrom = win ? win.from : Math.max(0, idx - SMART_CONTEXT_LINES);
    const ctxTo   = win ? win.to   : Math.min(total - 1, idx + SMART_CONTEXT_LINES);
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
      // 'enclosing' = الأطراف حدود statements كاملة؛ 'excerpt' = ±SMART_CONTEXT_LINES قد تقطع بلوكًا
      boundary:      win ? 'enclosing' : 'excerpt',
    };
  }

  // ─── Prompt builders ──────────────────────────────────
  // aiNeeded من repair_engine يحمل strategy + reason، و issues الـAnalyzer تحمل type/cAct.
  function _issueHeader(issue, fileName) {
    const issueType  = issue.type || issue.strategy || issue.cAct || 'UNKNOWN';
    const issueTitle = issue.title || issueType;
    const targetLine = issue.line  || '?';
    return [
      'You are a precise, minimal code repair assistant for Reality Engine.',
      'Your ONLY job: fix ONE specific issue. Nothing else.',
      '',
      `File: ${fileName}`,
      `Issue type: ${issueType}`,
      `Issue: ${issueTitle}`,
      `Target line: ${targetLine} (counted from line 1 of the file)`,
      issue.reason ? `Why this needs a manual fix: ${issue.reason}` : '',
      issue.ev     ? `Evidence: ${issue.ev}`   : '',
      issue.sev    ? `Severity: ${issue.sev}`  : '',
    ];
  }

  // ملف كامل: الرد يستبدل الملف كله، فأي حذف أو اختصار يضيع كودًا سليمًا.
  function _buildFullFilePrompt(issue, ctx, fileName) {
    const parts = _issueHeader(issue, fileName);
    parts.push(
      '',
      `Full file (${ctx.totalLines} lines) — this is the ENTIRE file, lines 1–${ctx.totalLines}:`,
      '```',
      ctx.snippet,
      '```',
      '',
      'STRICT RULES:',
      `1. Your response REPLACES the whole file: return the COMPLETE file — all lines from line 1 to line ${ctx.totalLines} — with the fix applied.`,
      '2. Put the entire file in exactly ONE fenced code block. No text before or after it, and no second code block.',
      '3. Never omit, shorten, or summarize any part: no "...", no "rest unchanged", no "existing code", and no other placeholder or omitted section.',
      '4. Fix ONLY the reported issue at the target line. Change only the lines that this fix requires.',
      '5. Keep every unrelated line exactly as it is — same text, same indentation, same order.',
      '6. Keep all imports at the top of the file. If the fix strictly requires a new import, add it at the top with the existing imports, never elsewhere.',
      '7. Do NOT fix other issues, refactor, rename, reformat, or improve unrelated code.',
      '8. Do NOT add explanations, comments, or prose — code only.',
      '9. If you cannot fix this safely, or cannot return the complete file, reply with exactly: CANNOT_FIX',
      '10. If the code shown is already correct for this issue, reply with exactly: CANNOT_FIX',
    );
    return parts.filter(Boolean).join('\n');
  }

  // مقطع فقط: الرد يستبدل الأسطر fromLine–toLine؛ أي import فيه سيقع وسط الملف.
  function _buildWindowedPrompt(issue, ctx, fileName) {
    const parts  = _issueHeader(issue, fileName);
    const range  = `lines ${ctx.fromLine}–${ctx.toLine}`;
    const inExcerpt = issue.line ? issue.line - ctx.fromLine + 1 : null;

    // imports كـ reference فقط — لا يعيدها Claude
    if (ctx.importContext) {
      parts.push('', 'Reference imports from the top of the file (read-only — DO NOT include these in your response):');
      parts.push('```');
      parts.push(ctx.importContext);
      parts.push('```');
    }

    parts.push(
      '',
      `This is an EXCERPT of a larger file, NOT the entire file. It covers ${range} of ${ctx.totalLines}.`,
      inExcerpt && inExcerpt >= 1
        ? `The target line ${issue.line} is line ${inExcerpt} of this excerpt.`
        : '',
      `Target context (${range} of ${ctx.totalLines}) — return ONLY this excerpt fixed:`,
      '```',
      ctx.snippet,
      '```',
      '',
      'STRICT RULES:',
      `1. Return ONLY the excerpt above (${range}) with the fix applied. Your response replaces exactly these lines.`,
      '2. Put the excerpt in exactly ONE fenced code block. No text before or after it, and no second code block.',
      '3. Do NOT return any code outside the excerpt, and do NOT treat the excerpt as the whole file.',
      '4. The excerpt may start or end in the middle of a function: keep its first and last lines, and do not close or complete code that continues outside it.',
      '5. Do NOT add import, require, include, or using lines — the file\'s imports are outside this excerpt. If the fix needs a new import, reply with exactly: CANNOT_FIX',
      '6. Fix ONLY the reported issue at the target line. Change only the lines that this fix requires.',
      '7. Keep every unrelated line of the excerpt exactly as it is — same text, same indentation, same order.',
      '8. Never omit or shorten any part of the excerpt: no "...", no "rest unchanged", and no other placeholder.',
      '9. Do NOT fix other issues, refactor, rename, reformat, or improve unrelated code.',
      '10. Do NOT add explanations, comments, or prose — code only.',
      '11. If you cannot fix this safely within the excerpt, reply with exactly: CANNOT_FIX',
      '12. If the code shown is already correct for this issue, reply with exactly: CANNOT_FIX',
    );
    return parts.filter(Boolean).join('\n');
  }

  function _buildPrompt(issue, code, fileName) {
    const ctx = _extractContext(code, issue.line);
    return ctx.fullFile
      ? _buildFullFilePrompt(issue, ctx, fileName)
      : _buildWindowedPrompt(issue, ctx, fileName);
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

  // ─── Code extraction (line-based fences) ─────────────
  // الـfence سطر كامل فقط (CommonMark): 0–3 مسافات ثم ``` أو ~~~ (3+) ثم وسم
  // لغة اختياري بأي أحرف (c++, python3). الإغلاق: نفس الحرف وبطول ≥ الفتح وحده
  // على السطر. لذلك ``` داخل string في منتصف سطر لا ينهي الكتلة أبدًا.
  //   - بلا fence إطلاقًا      → الرد كله كود (السلوك الحالي).
  //   - كتلة واحدة مكتملة     → محتواها.
  //   - أكثر من كتلة          → MULTIPLE_CODE_BLOCKS (لا نخمّن أيها الملف).
  //   - fence مفتوح بلا إغلاق → UNTERMINATED_CODE_BLOCK (رد مقطوع غالبًا).
  // يُرجع { ok, code } أو { ok: false, reason }.
  const _FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

  function _extractCode(text) {
    const lines = String(text).split('\n');
    const blocks = [];
    let open = null;                                   // { ch, len, start }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\r$/, '');
      if (!open) {
        const m = line.match(_FENCE_OPEN);
        // info string لسياج backtick لا يحتوي backtick (CommonMark)
        if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
          open = { ch: m[1][0], len: m[1].length, start: i + 1 };
        }
        continue;
      }
      const c = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (c && c[1][0] === open.ch && c[1].length >= open.len) {
        blocks.push(lines.slice(open.start, i).join('\n'));
        open = null;
      }
    }

    if (open)              return { ok: false, reason: 'UNTERMINATED_CODE_BLOCK — opening fence without a closing fence (truncated response?)' };
    if (blocks.length > 1) return { ok: false, reason: `MULTIPLE_CODE_BLOCKS — response has ${blocks.length} code blocks, expected one` };
    if (blocks.length === 1) return { ok: true, code: blocks[0] };
    return { ok: true, code: String(text) };
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

    // استخرج كود من code block إذا وُجد (line-based — انظر _extractCode)
    const extracted = _extractCode(rawText);
    if (!extracted.ok) return { ok: false, reason: extracted.reason };
    // لا trim() كامل: إزاحة السطر الأول جزء من الكود (Python / بلوك داخل دالة).
    // نحذف فقط الأسطر الفارغة في البداية والفراغات في النهاية.
    const candidate  = extracted.code
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
  // يُرجع null إذا كانت النافذة لا تطابق الكود (ctx قديم/تالف) — لا تركيب تخميني.
  function _reconstructCode(code, issue, candidate, ctx) {
    if (ctx.fullFile) {
      // Claude رأى الكل وأعاد الكل. _validate يحذف الفراغات في نهاية الرد، فنعيد
      // السطر الأخير الفارغ إن كان في الأصل حتى لا يتغير الملف بلا سبب.
      if (code.endsWith('\n') && !candidate.endsWith('\n')) return candidate + '\n';
      return candidate;
    }

    // snippet = target context فقط → candidate = target context المصلوح فقط.
    // لا markers، لا parsing للرد — نستبدل targetRange مباشرة.
    const lines = code.split('\n');
    const range = ctx.targetRange;
    if (!range || !Number.isInteger(range.from) || !Number.isInteger(range.to) ||
        range.from < 0 || range.to < range.from || range.to >= lines.length) return null;
    const { from, to } = range;
    const win = lines.slice(from, to + 1);
    if (win.join('\n') !== ctx.snippet) return null;
    if (typeof candidate !== 'string' || !candidate.trim()) return null;

    // _validate يحذف الأسطر الفارغة في طرفي الرد → أعد أسطر الطرفين الفارغة كما في الأصل
    let lead = 0;
    while (lead < win.length && !win[lead].trim()) lead++;
    let trail = 0;
    while (trail < win.length - lead && !win[win.length - 1 - trail].trim()) trail++;
    const newLines = [
      ...win.slice(0, lead),
      ...candidate.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '').split('\n'),
      ...win.slice(win.length - trail),
    ];

    const out = [...lines.slice(0, from), ...newLines, ...lines.slice(to + 1)];
    return out.join('\n');
  }

  // ─── Window boundary lock (windowed mode only) ───────
  // الرد يجب أن يبدأ وينتهي بنفس أول/آخر سطر غير فارغ في النافذة. يمنع:
  // رد مقطوع، كود قبل/بعد النافذة (تكرار ما خارجها)، أو "إكمال" بلوك مقطوع بـ}.
  // الطرف المعفى الوحيد: إذا كان هو سطر الهدف نفسه (الإصلاح قد يغيّره).
  // يُرجع null أو سبب الرفض.
  function _windowBoundaryProblem(ctx, candidate, issue) {
    if (!ctx || ctx.fullFile) return null;
    const norm = l => l.replace(/\s+$/, '');
    const orig = ctx.snippet.split('\n');
    const cand = String(candidate).split('\n');
    const firstNE = a => a.findIndex(l => l.trim());
    const lastNE  = a => { for (let i = a.length - 1; i >= 0; i--) if (a[i].trim()) return i; return -1; };
    const fo = firstNE(orig), lo = lastNE(orig), fc = firstNE(cand), lc = lastNE(cand);
    if (fo < 0) return null;                              // نافذة فارغة: لا حدود لقفلها
    if (fc < 0) return 'WINDOW_BOUNDARY_CHANGED — empty excerpt returned';
    const target = ((issue && issue.line) || 0) - ctx.fromLine;   // 0-based داخل النافذة

    if (fo !== target && norm(orig[fo]) !== norm(cand[fc])) {
      return `WINDOW_BOUNDARY_CHANGED — the excerpt must start with its original first line ` +
             `(line ${ctx.fromLine + fo}); the reply changed it or added code before it`;
    }
    if (lo !== target && norm(orig[lo]) !== norm(cand[lc])) {
      return `WINDOW_BOUNDARY_CHANGED — the excerpt must end with its original last line ` +
             `(line ${ctx.fromLine + lo}); the reply changed it, cut it, or added code after it`;
    }
    return null;
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
      // كل كتل النص، لا content[0] فقط (قد تكون الكتلة الأولى من نوع آخر).
      const blocks = (data && Array.isArray(data.content)) ? data.content : [];
      const text = blocks
        .filter(b => b && typeof b.text === 'string' && (b.type === 'text' || b.type === undefined))
        .map(b => b.text)
        .join('');
      // stop_reason: عند max_tokens يعيد الـAPI نصًا مقطوعًا مع HTTP 200 بلا خطأ.
      // غيابه (mocks قديمة) = null ولا يغيّر السلوك الحالي.
      const stopReason   = (data && typeof data.stop_reason === 'string') ? data.stop_reason : null;
      const outputTokens = (data && data.usage && typeof data.usage.output_tokens === 'number')
        ? data.usage.output_tokens : null;
      // رد متوقف بسبب غير end_turn قد يأتي بلا نص (refusal) — يقرر repairOne.
      if (!text && (stopReason === null || stopReason === 'end_turn')) {
        throw new Error('Empty content from API');
      }
      // بلا trim(): إزاحة أول سطر جزء من الكود (رد بلا fence). _validate يتولى الحواف.
      return { text, model: data.model || MODEL, stopReason, outputTokens };
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

      // رد غير مكتمل لا يُعامل ككود أبدًا — يُرفض قبل parsing وقبل FixVerifier.
      if (result.stopReason && result.stopReason !== 'end_turn') {
        const reason = result.stopReason === 'max_tokens'
          ? `TRUNCATED_BY_MAX_TOKENS — response cut at max_tokens=${MAX_TOKENS}` +
            (result.outputTokens != null ? ` (${result.outputTokens} output tokens)` : '')
          : result.stopReason === 'refusal'
            ? 'REFUSED — Claude declined this request (stop_reason=refusal)'
            : `UNEXPECTED_STOP_REASON — ${result.stopReason}`;
        return _makeResult(Status.CANNOT_FIX, null, code, issue, reason, { model: result.model });
      }

      if (rawText.trim() === 'CANNOT_FIX') {
        return _makeResult(Status.CANNOT_FIX, null, code, issue,
          'Claude: cannot safely fix this issue', { model: result.model });
      }

      const validation = _validate(rawText, ctx.snippet, issue);
      if (!validation.ok) {
        return _makeResult(Status.CANNOT_FIX, null, code, issue,
          'Validation failed: ' + validation.reason,
          { model: result.model, raw: rawText.slice(0, 200) });
      }

      // النافذة: الأطراف مقفلة — لا كود قبلها/بعدها، ولا رد مقطوع.
      const boundary = _windowBoundaryProblem(ctx, validation.candidate, issue);
      if (boundary) {
        return _makeResult(Status.CANNOT_FIX, null, code, issue,
          boundary, { model: result.model });
      }

      const fixedCode = _reconstructCode(code, issue, validation.candidate, ctx);
      if (fixedCode === null) {
        return _makeResult(Status.CANNOT_FIX, null, code, issue,
          'MALFORMED_RECONSTRUCTION — the context window does not match the code; nothing was applied',
          { model: result.model });
      }

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
    MAX_TOKENS,
    DEFAULT_TIMEOUT,
    FULL_FILE_THRESHOLD,
    FULL_FILE_TOKEN_BUDGET,
    MAX_WINDOW_LINES,
    repairOne,
    repairAll,
    // للاختبار
    _buildPrompt,
    _buildFullFilePrompt,
    _buildWindowedPrompt,
    _validate,
    _extractContext,
    _reconstructCode,
    _windowBoundaryProblem,
    _enclosingBlocks,
    _completenessProblem,
    _extractCode,
    _estimateTokens,
  });

})();

if (typeof window !== 'undefined') window.ClaudeRepairEngine = ClaudeRepairEngine;
if (typeof module !== 'undefined') module.exports = ClaudeRepairEngine;
