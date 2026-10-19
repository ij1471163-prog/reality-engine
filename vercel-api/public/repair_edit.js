// ═══════════════════════════════════════════════════════
// [EDIT-LAYER] تحريرُ الشفرةِ على مدى المحارف، بنموذجٍ نحويّ
// ═══════════════════════════════════════════════════════
//
// طبقةُ الإصلاحِ القائمةُ تُعدّل النصَّ سطرًا سطرًا بـ‎lines[i]‎ و‎.replace()‎:
// ثمانيةَ عشرَ مُصلِحًا، ولا واحدٌ منها يعرف أين يبدأ النداءُ وأين ينتهي.
// ومن هنا جاء أحدَ عشرَ عيبًا من تسعةَ عشرَ أُثبتت خلال شهرين — وكلُّها
// نسخةٌ من سببٍ واحد. وثلاثةٌ منها حيّةٌ اليوم على شفرةٍ عاديّة:
//
//     console.log("a) b", password);      بلاغ 6 · إصلاح 0 · السرُّ باقٍ
//     console.log(fmt(1, 2), password);   بلاغ 6 · إصلاح 0 · السرُّ باقٍ
//     console.log(a); console.log(password);   بلاغ 6 · إصلاح 0 · السرُّ باقٍ
//
// والسببُ في الثلاثةِ واحد: ‎\(([^)]+)\)‎ يتوقف عند أوّلِ ‎)‎ أيًّا كان
// موضعُها — داخلَ نصٍّ أو داخلَ نداءٍ متداخل. وهذا لا يُصلَح بنمطٍ أفضل:
// موازنةُ الأقواسِ ليست من اختصاصِ التعبيرِ النمطيّ.
//
// فهذه الطبقةُ تُعطي المُصلِحاتِ ما ينقصها: **مواضعُ محارفَ من مُحلِّلٍ
// حقيقيّ**، وتحريرٌ عليها. وهي آلةٌ عامّةٌ فقط: لا تعرف سرًّا ولا مَصرِفًا
// ولا استراتيجية — المعرفةُ تبقى في ‎repair_engine.js‎.
//
// ── الحدودُ المُعلَنة ──
//   • JavaScript وحدَها في هذه الخطوة. ‎acorn‎ مُضمَّنٌ (111 KB) ومُحمَّلٌ
//     في البيانات الأربعة أصلًا. وTypeScript وبايثون خطوتان لاحقتان.
//   • أيُّ تعذُّرٍ يُرجع ‎null‎، فيعود النداءُ إلى المُصلِحِ القائمِ كما هو.
//     الطبقةُ إضافةٌ أمامَ القديمِ لا بديلٌ عنه، ومفتاحُ الإيقافِ
//     ‎setRepairEditEnabled(false)‎ يُعيد السلوكَ القديمَ بالكامل.
//   • ولا تُطبَّق تحريراتٌ متداخلة، ولا تحريرٌ يُنتج شفرةً لا تُحلَّل.

// مفتاحُ الرجوع: الطبقةُ تُعطَّل كاملةً فيعود كلُّ شيءٍ إلى ما كان.
let _REPAIR_EDIT_ON = true;
function setRepairEditEnabled(on) { _REPAIR_EDIT_ON = !!on; }
function repairEditEnabled() { return _REPAIR_EDIT_ON; }

/** هل لهذه اللغةِ مُحلِّلٌ متاحٌ الآن؟ (js وحدَها في هذه الخطوة) */
function repairEditSupports(ext) {
  if (!_REPAIR_EDIT_ON) return false;
  if (ext !== 'js') return false;
  return typeof acorn !== 'undefined' && acorn && typeof acorn.parse === 'function';
}

/** يُحلّل، أو ‎null‎ عند أيِّ تعذُّر. ‎module‎ ثم ‎script‎ كما تفعل البوابة. */
function repairEditParse(code) {
  if (typeof acorn === 'undefined' || !acorn || typeof acorn.parse !== 'function') return null;
  const opts = { ecmaVersion: 'latest', allowReturnOutsideFunction: true, locations: true };
  try { return acorn.parse(code, Object.assign({ sourceType: 'module' }, opts)); }
  catch (e) {
    try { return acorn.parse(code, Object.assign({ sourceType: 'script' }, opts)); }
    catch (e2) { return null; }
  }
}

/** مرورٌ على كلِّ العُقَد. الزائرُ يتلقّى العُقدةَ وأباها. */
function repairEditWalk(node, visit, parent) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent || null);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' ||
        key === 'range' || key === 'parent') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') repairEditWalk(c, visit, node);
    } else if (v && typeof v.type === 'string') {
      repairEditWalk(v, visit, node);
    }
  }
}

/** نصُّ العُقدةِ كما هو في المصدر. */
function repairEditText(code, node) {
  if (!node || typeof node.start !== 'number' || typeof node.end !== 'number') return '';
  return String(code).slice(node.start, node.end);
}

/**
 * نداءاتُ الدوالِّ التي يقع السطرُ ‎line‎ ضمن مداها.
 * الترتيب: ما يبدأ في السطرِ نفسِه أوّلًا، ثم الأقربُ فالأقرب.
 */
function repairEditCallsAtLine(ast, line) {
  const out = [];
  repairEditWalk(ast, node => {
    if (node.type !== 'CallExpression' && node.type !== 'NewExpression') return;
    if (!node.loc) return;
    if (node.loc.start.line <= line && line <= node.loc.end.line) out.push(node);
  });
  return out.sort((a, b) => (a.loc.start.line === line ? 0 : 1) - (b.loc.start.line === line ? 0 : 1)
                         || a.start - b.start);
}

/**
 * يُطبّق تحريراتٍ ‎[[start, end, text], …]‎ على مدى المحارف.
 * يُرجع ‎null‎ إن تداخلت أو خرجت عن الحدود أو أنتجت شفرةً لا تُحلَّل —
 * فالقرارُ عندئذٍ للمُصلِحِ القائم، ولا يخرج من هنا ناتجٌ غيرُ مفحوص.
 */
function repairEditApply(code, edits, opts) {
  // ‎verify‎: الفحصُ الذاتيُّ بالتحليلِ بعد التحرير. يُطفأ صراحةً للغةٍ لا
  // مُحلِّلَ لها (py / java / php): لا يُحلَّل ناتجُها هنا فيُترك لفحصِ
  // البوابة، كما كان المسارُ النصّيُّ القائم. وحيث يوجد مُحلِّلٌ فالفحصُ لازم.
  const verify = !opts || opts.verify !== false;
  if (!Array.isArray(edits) || !edits.length) return null;
  const src = String(code);
  const sorted = edits.slice().sort((a, b) => a[0] - b[0]);
  let prevEnd = -1;
  for (const e of sorted) {
    if (!Array.isArray(e) || e.length < 3) return null;
    const [s, t, txt] = e;
    if (typeof s !== 'number' || typeof t !== 'number' || typeof txt !== 'string') return null;
    if (s < 0 || t > src.length || s > t) return null;
    if (s < prevEnd) return null;                       // تداخلٌ ⇒ لا تخمين
    prevEnd = t;
  }
  let out = src;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const [s, t, txt] = sorted[i];
    out = out.slice(0, s) + txt + out.slice(t);
  }
  if (out === src) return null;
  // فحصٌ ذاتيّ: ما لا يُحلَّل لا يخرج. وهذا حدٌّ أدنى لا إثباتُ صحّة —
  // إثباتُ الصحّةِ تنفيذُ الشفرةِ، وهو في الاختبارات لا هنا.
  if (verify && repairEditParse(out) === null) return null;
  return out;
}

// ── لاقطُ النداءاتِ النصّيّ: للغاتِ التي لا مُحلِّلَ لها ──────────────
// بايثون وTypeScript وجافا لا مُحلِّلَ لها في الحزمة، وقياسُها يقول إن
// عيوبَ المسارِ النصّيِّ تُصيبها بالتساوي: ثلاثةٌ من خمسةِ أشكالٍ تسقط في
// كلٍّ منها (قوسٌ داخل نصّ، نداءٌ متداخل، نداءان في سطر) — وهي نفسُ
// الأشكالِ التي تسقط في js. فالعيبُ ليس في لغةٍ بل في الأداة.
//
// فهذا ماسحٌ يعي النصوصَ والأقواسَ والتعليقات — نفسُ تقنيةِ
// ‎structuralSyntax‎ التي تثق بها البوابةُ والخادمُ أصلًا — يُعطي مدى كلِّ
// نداءٍ ومدى كلِّ وسيطٍ فيه. وحدُّه معلَن: **سطرٌ واحد**، كما كان المسارُ
// النصّيُّ القائم؛ ونداءٌ موزَّعٌ على أسطرٍ يبقى لمسارِ الشجرةِ وحدَه.
function repairEditTextCalls(text, opts) {
  const s = String(text == null ? '' : text);
  const comment = (opts && opts.comment) || '//';
  const out = [];
  const isIdChar = c => /[A-Za-z0-9_$]/.test(c);
  let i = 0;

  // نهايةُ النصِّ الحرفيِّ المبتدئِ عند ‎p‎، أو ‎-1‎ إن لم يُغلَق
  const skipString = p => {
    const q = s[p];
    let j = p + 1;
    while (j < s.length) {
      if (s[j] === '\\') { j += 2; continue; }
      if (s[j] === q) return j + 1;
      j++;
    }
    return -1;
  };

  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') { const e = skipString(i); if (e < 0) break; i = e; continue; }
    if (s.startsWith(comment, i)) break;                 // تعليقٌ: لا نداءَ بعده
    if (!isIdChar(c) || /[0-9]/.test(c)) { i++; continue; }

    // سلسلةُ مُعرِّفاتٍ مفصولةٌ بنقاط: ‎a.b.c‎
    const chainStart = i;
    let j = i;
    while (j < s.length) {
      while (j < s.length && isIdChar(s[j])) j++;
      if (s[j] === '.' && j + 1 < s.length && isIdChar(s[j + 1]) && !/[0-9]/.test(s[j + 1])) { j++; continue; }
      break;
    }
    const chain = s.slice(chainStart, j);
    let k = j;
    while (k < s.length && /\s/.test(s[k])) k++;
    if (s[k] !== '(') { i = Math.max(j, i + 1); continue; }

    // القوسُ المُطابِق، مع احترامِ النصوصِ والتداخل
    const argsStart = k + 1;
    let depth = 0, p = k, close = -1;
    while (p < s.length) {
      const ch = s[p];
      if (ch === '"' || ch === "'" || ch === '`') { const e = skipString(p); if (e < 0) break; p = e; continue; }
      if (ch === '(' || ch === '[' || ch === '{') { depth++; p++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { depth--; p++; if (depth === 0) { close = p - 1; break; } continue; }
      p++;
    }
    if (close < 0) { i = argsStart; continue; }           // قوسٌ لا يُغلَق في السطر

    // تقسيمُ الوسائطِ على الفواصلِ العليا وحدَها
    const args = [];
    let a = argsStart, d = 0, q = argsStart;
    while (a <= close) {
      const ch = s[a];
      if (a === close || (ch === ',' && d === 0)) {
        const raw = s.slice(q, a);
        if (raw.trim()) {
          const lead = raw.length - raw.replace(/^\s+/, '').length;
          const trail = raw.length - raw.replace(/\s+$/, '').length;
          args.push({ start: q + lead, end: a - trail, text: raw.trim() });
        }
        q = a + 1; a++; continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { const e = skipString(a); if (e < 0) break; a = e; continue; }
      if (ch === '(' || ch === '[' || ch === '{') d++;
      else if (ch === ')' || ch === ']' || ch === '}') d--;
      a++;
    }

    const dot = chain.lastIndexOf('.');
    out.push({
      callStart: chainStart, callEnd: close + 1,
      recv: dot < 0 ? '' : chain.slice(0, dot),
      meth: dot < 0 ? chain : chain.slice(dot + 1),
      args,
    });
    i = argsStart;                                        // ندخل النداءَ لنلتقط المتداخل
  }
  return out;
}

/** رقمُ السطرِ (١-أساس) الذي يقع فيه هذا المَوضع. */
function repairEditLineOf(code, pos) {
  let n = 1;
  const s = String(code);
  for (let i = 0; i < pos && i < s.length; i++) if (s[i] === '\n') n++;
  return n;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    setRepairEditEnabled, repairEditEnabled, repairEditSupports, repairEditParse,
    repairEditWalk, repairEditText, repairEditCallsAtLine, repairEditApply, repairEditLineOf,
    repairEditTextCalls,
  };
}
