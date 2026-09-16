// ═══════════════════════════════════════════════════════
// c_cpp_analyzer.js v2.0 — تحليل C/C++ ساكن
//
// المبدأ: المحلل يكتشف ويُعطي دليلاً. لا يُصدر إصلاحاً إلا إذا كان
// تحويلاً deterministic يُترجم ولا يغيّر الدلالة، وبعد إثبات الشروط من
// الملف نفسه (مثل كون الهدف مصفوفة مُعلَنة). كل ما عدا ذلك يخرج بـ
// fix: null و aiRequired: true و fixHint يشرح السبب.
//
// العقد كما هو: analyzeCCpp(code, fileName) → { issues, language, summary }
// ═══════════════════════════════════════════════════════

"use strict";

// ─── 1. أدوات نصية ───────────────────────────────────────────
function ccExtOf(fileName) {
  const name = (typeof fileName === 'string') ? fileName : '';
  const dot  = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

// نسخة من كل سطر بنفس الطول، السلاسل والمحارف والتعليقات فيها فراغات.
// تتبع تعليقات البلوك عبر الأسطر، فلا حاجة لحدس "السطر يبدأ بنجمة".
function ccCleanLines(lines) {
  const out = [];
  let inBlock = false;
  for (const raw of lines) {
    const ch = raw.split('');
    let i = 0;
    while (i < ch.length) {
      const c = raw[i], d = raw[i + 1];
      if (inBlock) {
        if (c === '*' && d === '/') { ch[i] = ' '; ch[i + 1] = ' '; i += 2; inBlock = false; continue; }
        ch[i] = ' '; i++; continue;
      }
      if (c === '/' && d === '*') { ch[i] = ' '; ch[i + 1] = ' '; i += 2; inBlock = true; continue; }
      if (c === '/' && d === '/') { for (let k = i; k < ch.length; k++) ch[k] = ' '; break; }
      if (c === '"' || c === "'") {
        const q = c; ch[i] = ' '; i++;
        while (i < ch.length) {
          if (raw[i] === '\\') { ch[i] = ' '; if (i + 1 < ch.length) ch[i + 1] = ' '; i += 2; continue; }
          if (raw[i] === q)    { ch[i] = ' '; i++; break; }
          ch[i] = ' '; i++;
        }
        continue;
      }
      i++;
    }
    out.push(ch.join(''));
  }
  return out;
}

const CC_TYPE_WORD = /\b(?:void|int|char|long|short|unsigned|signed|float|double|bool|size_t|ssize_t|FILE|extern|static|inline|typedef|virtual)\s*\**$/;

// مواضع استدعاء دالة باسم محدد على سطر مُنظَّف.
// تستبعد التصريحات (يسبقها نوع) واستدعاءات الأعضاء obj.name و ptr->name.
function ccFindCalls(clean, name) {
  const out = [];
  const re  = new RegExp('(^|[^\\w])' + name + '\\s*\\(', 'g');
  let m;
  while ((m = re.exec(clean)) !== null) {
    const nameStart = m.index + m[1].length;
    const before    = clean.slice(0, nameStart);
    re.lastIndex = m.index + m[0].length;
    if (/[.]\s*$/.test(before) || /->\s*$/.test(before)) continue;  // استدعاء عضو
    if (CC_TYPE_WORD.test(before)) continue;                         // تصريح أو تعريف
    out.push({ nameStart, openIdx: m.index + m[0].length - 1 });
  }
  return out;
}

// تقسيم وسائط الاستدعاء عند الفواصل في العمق صفر.
// يُقاس العمق على السطر المُنظَّف فلا تخدعه فاصلة داخل سلسلة.
function ccSplitArgsAt(clean, original, openIdx) {
  const args = [];
  let depth = 0, start = openIdx + 1;
  for (let i = openIdx + 1; i < clean.length; i++) {
    const c = clean[i];
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      if (c === ')' && depth === 0) {
        args.push({ text: original.slice(start, i), start, end: i });
        return { args, closeIdx: i };
      }
      depth--; continue;
    }
    if (c === ',' && depth === 0) { args.push({ text: original.slice(start, i), start, end: i }); start = i + 1; }
  }
  return null;                                   // لم يُغلق على هذا السطر
}

const ccTrim = s => String(s == null ? '' : s).trim();
const ccEsc  = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// مصفوفات المحارف المُعلَنة في الملف: char name[N] — الحجم قد يكون غير معروف.
// تُستبعد وسائط الدوال لأن char p[] فيها مؤشر و sizeof عليه خاطئ.
function ccDeclaredArrays(cleanLines) {
  const map = new Map();
  const re  = /\b(?:char|wchar_t|char8_t|char16_t|char32_t)\s+([A-Za-z_]\w*)\s*\[\s*(\d+)?\s*\]/g;
  cleanLines.forEach(line => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      let depth = 0;
      for (let i = 0; i < m.index; i++) { const c = line[i]; if (c === '(') depth++; else if (c === ')') depth--; }
      if (depth !== 0) continue;                 // داخل قائمة وسائط ⇒ مؤشر لا مصفوفة
      if (!map.has(m[1])) map.set(m[1], m[2] ? Number(m[2]) : null);
    }
  });
  return map;
}

// مؤشرات المحارف المُعلَنة: char *name — تكفي لـ printf("%s", name)
function ccDeclaredCharPointers(cleanLines) {
  const set = new Set();
  const re  = /\b(?:const\s+)?char\s*\*\s*(?:const\s+)?([A-Za-z_]\w*)/g;
  cleanLines.forEach(line => { let m; re.lastIndex = 0; while ((m = re.exec(line)) !== null) set.add(m[1]); });
  return set;
}

// كل نداءات free(ident) بمواضعها. نداءان على سطر واحد كلاهما مرئي.
function ccFreeCalls(cleanLines) {
  const out = [];
  const re  = /\bfree\s*\(\s*([A-Za-z_]\w*)\s*\)/g;
  cleanLines.forEach((line, idx) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      const before = line.slice(0, m.index);
      if (/[.]\s*$/.test(before) || /->\s*$/.test(before)) continue;   // استدعاء عضو
      if (CC_TYPE_WORD.test(before)) continue;                          // تصريح
      out.push({ line: idx, start: m.index, end: m.index + m[0].length, ptr: m[1] });
    }
  });
  return out;
}

// نص ما بين نداءين على مستوى المحارف — لا يتأثر بمكان فواصل الأسطر.
function ccGapText(cleanLines, a, b) {
  if (a.line === b.line) return cleanLines[a.line].slice(a.end, b.start);
  const parts = [cleanLines[a.line].slice(a.end)];
  for (let k = a.line + 1; k < b.line; k++) parts.push(cleanLines[k]);
  parts.push(cleanLines[b.line].slice(0, b.start));
  return parts.join('\n');
}

// أقصى مسافة نقبل عندها اقتران نداءين، حدّ كلفة لا حدّ دلالي.
const CC_FREE_WINDOW = 10;
// أي رمز يجعل المسار بين النداءين غير مستقيم. التسمية (label) هدف goto.
const CC_CONTROL = /\b(?:if|else|switch|case|default|while|for|do|goto|return|break|continue)\b|\?|(?:^|[;}])\s*[A-Za-z_]\w*\s*:(?!:)/;

// ─── 2. بناء الثغرة ──────────────────────────────────────────
// إصلاح لا يُقبل إلا إذا كان نصاً حقيقياً مختلفاً عن السطر المصاب وليس تعليقاً.
function ccIssue(o) {
  const raw   = (typeof o.fix === 'string') ? o.fix : '';
  const valid = !!raw.trim() && raw.trim() !== ccTrim(o.ev) && !/^\s*(?:\/\/|\/\*|#)/.test(raw);
  return {
    type: 'c', sev: o.sev, line: o.line, ev: o.ev, title: o.title,
    fix: valid ? raw : null,
    aiRequired: !valid,
    fixHint: o.fixHint || null,
    conf: o.conf, cIcon: o.cIcon, cAct: o.cAct, cEv: o.cEv,
  };
}

// ─── 3. المحلل ───────────────────────────────────────────────
function analyzeCCpp(code, fileName) {
  const issues = [];
  const name   = (typeof fileName === 'string') ? fileName : '';
  const ext    = ccExtOf(name);
  const isCpp  = ext === 'cpp' || ext === 'cc' || ext === 'cxx' || ext === 'hpp';
  const result = () => ({
    issues,
    language: isCpp ? 'C++' : 'C',
    summary: {
      issues:     issues.length,
      critical:   issues.filter(i => i.sev === 'c').length,
      high:       issues.filter(i => i.sev === 'h').length,
      medium:     issues.filter(i => i.sev === 'm').length,
      aiRequired: issues.filter(i => i.aiRequired).length,
    },
  });
  if (typeof code !== 'string' || !code.trim()) return result();

  const isHeader = ext === 'h' || ext === 'hpp';
  const lines    = code.split('\n');
  const clean    = ccCleanLines(lines);
  const arrays   = ccDeclaredArrays(clean);
  const charPtrs = ccDeclaredCharPointers(clean);
  const cleanAll = clean.join('\n');

  const isArray    = n => arrays.has(ccTrim(n));
  const arraySize  = n => arrays.get(ccTrim(n));
  const isCharish  = n => arrays.has(ccTrim(n)) || charPtrs.has(ccTrim(n));
  const plainIdent = n => /^[A-Za-z_]\w*$/.test(ccTrim(n));
  const SPANS = 'والجملة ممتدة على أكثر من سطر فلا يمكن التحقق من التحويل.';

  lines.forEach((line, i) => {
    const c  = clean[i];
    const t  = line.trim();
    const ln = i + 1;
    if (!c.trim()) return;                        // السطر كله تعليق أو سلسلة

    // وسائط أول استدعاء: undefined = لا استدعاء · null = لم يُغلق على السطر
    const callOf = fn => {
      const hits = ccFindCalls(c, fn);
      if (!hits.length) return undefined;
      const split = ccSplitArgsAt(c, line, hits[0].openIdx);
      return split ? { hit: hits[0], split } : null;
    };

    // ─── gets() ───────────────────────────────────────────────
    const gets = callOf('gets');
    if (gets !== undefined) {
      const arg = (gets && gets.split.args.length === 1) ? ccTrim(gets.split.args[0].text) : null;
      const ok  = !!(arg && plainIdent(arg) && isArray(arg));
      issues.push(ccIssue({
        sev: 'c', line: ln, ev: t,
        title: '🔴 gets() — Buffer Overflow (CWE-120)',
        fix: ok ? line.slice(0, gets.hit.nameStart) + 'fgets(' + arg + ', sizeof(' + arg + '), stdin)' +
                  line.slice(gets.split.closeIdx + 1) : null,
        fixHint: ok ? 'fgets تُبقي محرف السطر الجديد بينما gets تحذفه — راجع من يقرأ المخزن.'
                    : (gets === null ? SPANS
                                     : 'الهدف ليس مصفوفة مُعلَنة في هذا الملف، فـsizeof عليه يعطي حجم المؤشر لا حجم المخزن.'),
        conf: 97, cIcon: '🔴', cAct: 'CWE-120 Buffer Overflow',
        cEv: ['gets() لا تتحقق من حجم المخزن — استخدم fgets()'],
      }));
    }

    // ─── strcpy() ─────────────────────────────────────────────
    const scpy = callOf('strcpy');
    if (scpy !== undefined) {
      const a   = (scpy && scpy.split.args.length === 2) ? scpy.split.args : null;
      const dst = a ? ccTrim(a[0].text) : null;
      const ok  = !!(dst && plainIdent(dst) && isArray(dst));
      issues.push(ccIssue({
        sev: 'h', line: ln, ev: t,
        title: '🟠 strcpy() — Buffer Overflow محتمل (CWE-120)',
        fix: ok ? line.slice(0, scpy.hit.nameStart) + 'strncpy(' + dst + ',' + a[1].text +
                  ', sizeof(' + dst + ') - 1); ' + dst + '[sizeof(' + dst + ') - 1] = \'\\0\';' +
                  line.slice(scpy.split.closeIdx + 1).replace(/^\s*;/, '') : null,
        fixHint: ok ? null
                    : (!a ? 'تعذّر تحديد وسيطي الاستدعاء، ' + SPANS
                          : 'الهدف "' + dst + '" ليس مصفوفة مُعلَنة في هذا الملف، فـsizeof عليه يعطي حجم المؤشر لا حجم المخزن، و strncpy لا تُنهي النص عند القصّ.'),
        conf: 88, cIcon: '🟠', cAct: 'CWE-120',
        cEv: ['استخدم strncpy() أو strlcpy() بدل strcpy()'],
      }));
    }

    // ─── strcat() ─────────────────────────────────────────────
    const scat = callOf('strcat');
    if (scat !== undefined) {
      const a   = (scat && scat.split.args.length === 2) ? scat.split.args : null;
      const dst = a ? ccTrim(a[0].text) : null;
      const ok  = !!(dst && plainIdent(dst) && isArray(dst));
      issues.push(ccIssue({
        sev: 'h', line: ln, ev: t,
        title: '🟠 strcat() — Buffer Overflow محتمل (CWE-120)',
        fix: ok ? line.slice(0, scat.hit.nameStart) + 'strncat(' + dst + ',' + a[1].text +
                  ', sizeof(' + dst + ') - strlen(' + dst + ') - 1)' +
                  line.slice(scat.split.closeIdx + 1) : null,
        fixHint: ok ? null
                    : (!a ? 'تعذّر تحديد وسيطي الاستدعاء، ' + SPANS
                          : 'الهدف "' + dst + '" ليس مصفوفة مُعلَنة في هذا الملف، فحساب المتبقي بـsizeof خاطئ وقد ينقلب إلى قيمة ضخمة.'),
        conf: 85, cIcon: '🟠', cAct: 'CWE-120',
        cEv: ['استخدم strncat() مع حجم المخزن'],
      }));
    }

    // ─── sprintf() ────────────────────────────────────────────
    const spf = callOf('sprintf');
    if (spf !== undefined) {
      const a   = (spf && spf.split.args.length >= 2) ? spf.split.args : null;
      const dst = a ? ccTrim(a[0].text) : null;
      const ok  = !!(dst && plainIdent(dst) && isArray(dst));
      issues.push(ccIssue({
        sev: 'h', line: ln, ev: t,
        title: '🟠 sprintf() — Buffer Overflow محتمل (CWE-134)',
        fix: ok ? line.slice(0, spf.hit.nameStart) + 'snprintf(' + dst + ', sizeof(' + dst + '),' +
                  a.slice(1).map(x => x.text).join(',') + ')' + line.slice(spf.split.closeIdx + 1) : null,
        fixHint: ok ? null
                    : (!a ? 'تعذّر تحديد وسائط الاستدعاء، ' + SPANS
                          : 'snprintf تتطلب وسيط حجم بعد المخزن، و"' + dst + '" ليس مصفوفة مُعلَنة هنا فالحجم غير معروف. استبدال الاسم وحده ينتج كوداً لا يُترجم.'),
        conf: 83, cIcon: '🟠', cAct: 'CWE-134',
        cEv: ['استخدم snprintf() مع تحديد الحجم الأقصى'],
      }));
    }

    // ─── scanf("%s") ──────────────────────────────────────────
    if (/\bs?scanf\s*\(/.test(c) || /\bfscanf\s*\(/.test(c)) {
      const sc   = callOf('scanf') || callOf('fscanf') || callOf('sscanf');
      const fmtM = line.match(/scanf\s*\(\s*(?:[^,]*,\s*)?"([^"]*)"/);
      const fmt  = fmtM ? fmtM[1] : null;
      if (fmt && /%[^%]*s/.test(fmt) && !/%\d+s/.test(fmt)) {
        const convs  = (fmt.match(/%(?!%)/g) || []).length;
        const a      = sc ? sc.split.args : null;
        const target = (a && convs === 1 && a.length === 2) ? ccTrim(a[1].text).replace(/^&/, '') : null;
        const size   = (target && plainIdent(target)) ? arraySize(target) : null;
        const ok     = !!(size && size > 1);
        issues.push(ccIssue({
          sev: 'h', line: ln, ev: t,
          title: '🟠 scanf %s — Buffer Overflow (CWE-120)',
          fix: ok ? line.replace('"' + fmt + '"', '"' + fmt.replace('%s', '%' + (size - 1) + 's') + '"') : null,
          fixHint: ok ? null
                      : 'العرض الأقصى يجب أن يساوي حجم المخزن ناقص واحد. ' +
                        (convs > 1 ? 'التنسيق فيه أكثر من محوِّل فلا يمكن ربط كل %s بمخزنه بثقة.'
                                   : 'حجم المخزن الوجهة غير معروف من هذا الملف، ورقم ثابت مثل 255 قد يبقى أكبر من المخزن.'),
          conf: 88, cIcon: '🟠', cAct: 'CWE-120',
          cEv: ['حدّد العرض الأقصى في scanf بحسب حجم المخزن'],
        }));
      }
    }

    // ─── printf(var) — Format String ──────────────────────────
    const pf = callOf('printf');
    if (pf !== undefined && !/printf\s*\(\s*"/.test(c)) {
      const a  = (pf && pf.split.args.length === 1) ? ccTrim(pf.split.args[0].text) : null;
      const ok = !!(a && plainIdent(a) && isCharish(a));
      if (a && plainIdent(a)) {
        issues.push(ccIssue({
          sev: 'c', line: ln, ev: t,
          title: '🔴 Format String Attack (CWE-134)',
          fix: ok ? line.slice(0, pf.hit.nameStart) + 'printf("%s", ' + a + ')' + line.slice(pf.split.closeIdx + 1) : null,
          fixHint: ok ? null
                      : 'التحويل إلى printf("%s", x) صحيح فقط إذا كان x نصاً؛ ونوع "' + a + '" غير مُثبت في هذا الملف، ولو كان عدداً فالنتيجة انهيار وقت التشغيل.',
          conf: 93, cIcon: '🔴', cAct: 'CWE-134 Format String',
          cEv: ['printf(user_input) خطير — استخدم printf("%s", user_input)'],
        }));
      }
    }

    // ─── malloc / calloc / realloc ────────────────────────────
    if (/\b(?:m|c|re)alloc\s*\(/.test(c)) {
      const pm  = c.match(/([A-Za-z_]\w*)\s*=\s*(?:\([^)]*\)\s*)?(?:m|c|re)alloc\s*\(/);
      const ptr = pm ? pm[1] : null;
      let checked = false;
      if (ptr) {
        const e = ccEsc(ptr);
        checked = new RegExp('(?:if|while)\\s*\\(\\s*!\\s*' + e + '\\b').test(cleanAll) ||
                  new RegExp('\\b' + e + '\\s*==\\s*NULL').test(cleanAll) ||
                  new RegExp('NULL\\s*==\\s*' + e + '\\b').test(cleanAll) ||
                  new RegExp('\\b' + e + '\\s*!=\\s*NULL').test(cleanAll) ||
                  new RegExp('assert\\s*\\(\\s*' + e + '\\b').test(cleanAll) ||
                  new RegExp('\\bfree\\s*\\(\\s*' + e + '\\s*\\)').test(cleanAll);
      }
      if (!checked) {
        issues.push(ccIssue({
          sev: 'm', line: ln, ev: t,
          title: '🟡 malloc() — تحقق من NULL وتجنب Memory Leak',
          fix: null,
          fixHint: 'الإصلاح يحتاج فرع معالجة خطأ ومكان تحرير مناسبين للسياق' +
                   (ptr ? '، ولم يُعثر على فحص NULL ولا free للمؤشر "' + ptr + '" في هذا الملف.' : '.'),
          conf: 75, cIcon: '🟡', cAct: 'CWE-252 Memory Leak',
          cEv: ['تحقق من malloc() != NULL وتأكد من free()'],
        }));
      }
    }

    // double free — في مرور مستقل بعد الحلقة، لأنه يقارن نداءات لا أسطراً

    // ─── int = sizeof ─────────────────────────────────────────
    const szM = c.match(/\bint\s+([A-Za-z_]\w*)\s*=\s*sizeof\b/);
    if (szM) {
      const v = ccEsc(szM[1]);
      const signedUse = new RegExp('\\b' + v + '\\s*(?:>=\\s*0|<\\s*0|>\\s*-|<=\\s*-)').test(cleanAll);
      issues.push(ccIssue({
        sev: 'm', line: ln, ev: t,
        title: '🟡 استخدم size_t بدل int للـ sizeof',
        fix: signedUse ? null : line.replace(/\bint\b/, 'size_t'),
        fixHint: signedUse ? 'المتغير يُقارن بقيمة سالبة أو بـ>= 0 في مكان آخر، وتحويله إلى نوع بلا إشارة يقلب المقارنة.' : null,
        conf: 78, cIcon: '🟡', cAct: 'CWE-195 Signed/Unsigned',
        cEv: ['sizeof يرجع size_t (unsigned) — استخدم size_t لتجنب overflow'],
      }));
    }

    // ─── C++ ───────────────────────────────────────────────────
    if (isCpp) {
      if (/\bnew\s+[A-Za-z_]/.test(c) && !/unique_ptr|shared_ptr|make_unique|make_shared/.test(c)) {
        issues.push(ccIssue({
          sev: 'm', line: ln, ev: t,
          title: '🟡 C++: استخدم smart pointers بدل raw new',
          fix: null,
          fixHint: 'التحويل إلى make_unique يحتاج نقل وسائط الـconstructor وحذف delete المقابل، ' +
                   'والاستبدال النصي ينتج make_unique<T>()(args) وهو كود لا يُترجم. والمصفوفات تحتاج make_unique<T[]>(n).',
          conf: 80, cIcon: '🟡', cAct: 'Memory Management',
          cEv: ['استخدم unique_ptr أو shared_ptr لتجنب memory leaks'],
        }));
      }

      if (/std::cin\s*>>/.test(c) && !clean.slice(Math.max(0, i - 3), i).join('\n').includes('sync_with_stdio')) {
        issues.push(ccIssue({
          sev: 'l', line: ln, ev: t,
          title: '🔵 C++: أضف ios::sync_with_stdio(false) للأداء',
          fix: null,
          fixHint: 'السطر يُضاف في main() قبل أي إدخال أو إخراج، لا في مكان هذا السطر.',
          conf: 65, cIcon: '🔵', cAct: 'Performance',
          cEv: ['sync_with_stdio(false) يسرّع cin/cout بشكل كبير'],
        }));
      }

      if (/~\w+\s*\(\s*\)/.test(c)) {
        const body = clean.slice(i, i + 10).join('\n');
        if (/\bthrow\b/.test(body)) {
          issues.push(ccIssue({
            sev: 'h', line: ln, ev: t,
            title: '🟠 C++: لا تستخدم throw في Destructor',
            fix: null,
            fixHint: 'يحتاج تغليف جسم الـdestructor بـtry/catch أو نقل المنطق، وهو تعديل بنيوي لا استبدال سطر.',
            conf: 88, cIcon: '🟠', cAct: 'C++ Exception Safety',
            cEv: ['throw في destructor يسبب terminate() — استخدم noexcept'],
          }));
        }
      }

      if (/\breinterpret_cast\b/.test(c)) {
        issues.push(ccIssue({
          sev: 'm', line: ln, ev: t,
          title: '🟡 C++: reinterpret_cast خطير',
          fix: null,
          fixHint: 'static_cast ليس بديلاً عاماً، وصلاحية التحويل تعتمد على النوعين ولا تُستنتج من السطر.',
          conf: 72, cIcon: '🟡', cAct: 'Unsafe Cast',
          cEv: ['reinterpret_cast يتجاوز type system — استخدمه بحذر'],
        }));
      }
    }

    // using namespace std في header — خارج شرط isCpp لأن امتداد .h كان يُعطِّله
    if (/using\s+namespace\s+std/.test(c) && isHeader) {
      issues.push(ccIssue({
        sev: 'm', line: ln, ev: t,
        title: '🟡 C++: لا تستخدم "using namespace std" في headers',
        fix: null,
        fixHint: 'الإزالة تتطلب تأهيل كل الأسماء المستخدمة بـstd:: في الملف.',
        conf: 85, cIcon: '🟡', cAct: 'Namespace Pollution',
        cEv: ['"using namespace std" في headers يلوث namespace المستخدمين'],
      }));
    }

    // ─── Security ─────────────────────────────────────────────
    if (ccFindCalls(c, 'system').length) {
      issues.push(ccIssue({
        sev: 'c', line: ln, ev: t,
        title: '🔴 system() — Command Injection (CWE-78)',
        fix: null,
        fixHint: 'execvp يحتاج تفكيك الأمر إلى قائمة argv وتغيير معالجة القيمة المرجعة.',
        conf: 90, cIcon: '🔴', cAct: 'CWE-78 Command Injection',
        cEv: ['system() خطير مع user input — استخدم execvp() أو popen()'],
      }));
    }

    if (/\brand\s*\(\s*\)/.test(c) && /(?:key|token|secret|seed|crypto|passwd)/i.test(c)) {
      issues.push(ccIssue({
        sev: 'h', line: ln, ev: t,
        title: '🟠 rand() غير آمن للـ cryptography (CWE-338)',
        fix: null,
        fixHint: 'getrandom() أو قراءة /dev/urandom تتطلبان معالجة أخطاء ورؤوس مختلفة.',
        conf: 85, cIcon: '🟠', cAct: 'CWE-338 Weak Random',
        cEv: ['rand() قابل للتنبؤ — استخدم getrandom() أو /dev/urandom'],
      }));
    }
  });

  // ─── double free — مرور مستقل ────────────────────────────
  // القرار يُبنى على نص الفجوة بين نداءي free على مستوى المحارف، فلا يتغيّر
  // بتحريك فواصل الأسطر. أي قوس في الفجوة يعني أننا عبرنا حدود كتلة — وهذا
  // يشمل if/else وswitch بأقواس والحلقات وحدود الدوال — ولا شيء يمكن إثباته
  // نصياً هناك، فنصمت بدل ادعاء حرج. لا استنتاج لتدفق التحكم ولا للحلقات.
  const freeCalls = ccFreeCalls(clean);
  const lastOf    = new Map();
  for (const cur of freeCalls) {
    const prev = lastOf.get(cur.ptr);
    lastOf.set(cur.ptr, cur);
    if (!prev) continue;
    if (cur.line - prev.line > CC_FREE_WINDOW) continue;

    const e   = ccEsc(cur.ptr);
    const gap = ccGapText(clean, prev, cur);

    // إعادة إسناد أو تمرير بالعنوان ⇒ المؤشر قد يكون تغيّر، فلا ادعاء
    if (new RegExp('\\b' + e + '\\s*(?:=(?!=)|\\+\\+|--|\\+=|-=)|(?:\\+\\+|--)\\s*\\b' + e + '\\b|&\\s*' + e + '\\b').test(gap)) continue;
    // عبور حدود كتلة ⇒ غير قابل للإثبات نصياً
    if (/[{}]/.test(gap)) continue;

    const ev    = lines[cur.line].trim();
    const straight = !CC_CONTROL.test(gap);
    issues.push(ccIssue(straight ? {
      sev: 'c', line: cur.line + 1, ev,
      title: '🔴 Double Free — Use After Free (CWE-415)',
      fix: null,
      fixHint: 'التحريران في نفس الكتلة وعلى مسار مستقيم. الإصلاح عند التحرير الأول في السطر ' +
               (prev.line + 1) + ' بحذفه أو بضبط "' + cur.ptr + '" على NULL بعده، لا عند التحرير الثاني.',
      conf: 82, cIcon: '🔴', cAct: 'CWE-415 Double Free',
      cEv: ['اضبط المؤشر على NULL بعد free()'],
    } : {
      sev: 'm', line: cur.line + 1, ev,
      title: '🟡 تحريران لنفس المؤشر — المسار غير مُثبت (CWE-415)',
      fix: null,
      fixHint: 'المؤشر "' + cur.ptr + '" يُحرَّر أيضاً في السطر ' + (prev.line + 1) +
               ' داخل نفس الكتلة، لكن بينهما تفرّع أو قفز فلا يمكن إثبات وقوع التحريرين معاً نصياً. يحتاج مراجعة.',
      conf: 55, cIcon: '🟡', cAct: 'CWE-415 Double Free (غير مُثبت)',
      cEv: ['تحريران لنفس المؤشر في نفس الكتلة مع تفرّع بينهما'],
    }));
  }

  return result();
}
